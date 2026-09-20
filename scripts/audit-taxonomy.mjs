// Regenerates every number in the `support` fields of MISS_CAUSES from the
// seasons already cached by `npm run collect`. Run it before changing a lesson:
// a lesson that names a signal this audit cannot find teaches the loop to fit noise.
//
//   npm run audit -- -- --from=1994 --to=2026
//
// It reads the cache only and never calls a model or a network API.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { MISS_CAUSES } from '../src/rounds.js';
import { assert, integerOption, parseArgs } from '../src/util.js';

const options = parseArgs(process.argv.slice(2));
const from = integerOption(options.from, 1994, 'from', 1950, 2100);
const to = integerOption(options.to, 2100, 'to', from, 2100);
const seasons = join(new Store().root, 'seasons');

const races = [];
for (const name of (await readdir(seasons)).filter(file => /^\d{4}\.json$/.test(file))) {
  const year = Number(name.slice(0, 4));
  if (year >= from && year <= to) races.push(...JSON.parse(await readFile(join(seasons, name), 'utf8')).races);
}
assert(races.length > 50, `Only ${races.length} races are cached. Run collect first.`);
races.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

const WINDOW = 3;
const finished = status => /^Finished$|^\+\d+ Laps?$/i.test(status);
const collision = status => /Accident|Collision|Spun off|Damage|Puncture|Debris/i.test(status);
const mechanical = status => !finished(status) && !collision(status) && !/Disqualified|Excluded|Withdrew|Did not|Lapped|Not classified|Retired/i.test(status);
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const pct = (part, whole) => `${(part / whole * 100).toFixed(1)}%`;

function historyBefore(index, driverId, limit = 40) {
  const runs = [];
  for (let position = index - 1; position >= 0 && runs.length < limit; position--) {
    const row = races[position].results.find(item => item.driverId === driverId);
    if (row) runs.push({ ...row, circuitId: races[position].circuit.id });
  }
  return runs;
}

const buckets = new Map();
const bump = key => buckets.set(key, (buckets.get(key) || 0) + 1);
const error = { recent: [], career: [], circuit: [], teammate: [] };
const eraError = new Map();
const eraOf = season => season < 2006 ? '1994-2005' : season < 2014 ? '2006-2013' : season < 2022 ? '2014-2021' : '2022-2026';
const families = [
  ['finished', status => finished(status)],
  ['collision', status => collision(status)],
  ['mechanical', status => mechanical(status)],
  ['lapped or unclassified', status => /^Lapped$|^Not classified$|^Retired$/i.test(status)],
  ['penalty', status => /Disqualified|Excluded/i.test(status)],
  ['withdrawal', status => /Withdrew|Did not/i.test(status)],
];
const familyCounts = new Map();
const recurrence = {
  collision: { clean: [0, 0], some: [0, 0], frequent: [0, 0] },
  mechanical: { clean: [0, 0], some: [0, 0], frequent: [0, 0] },
};
const dominance = { dominant: [0, 0], strong: [0, 0], ordinary: [0, 0] };
const specialist = { hit: 0, n: 0, baseHit: 0, baseN: 0 };
let analyzed = 0;
let favouriteWon = 0;
let poleWon = 0;
let sharedTopThree = 0;

for (const race of races) {
  for (const row of race.results) {
    const key = families.find(([, test]) => test(row.status))?.[0] ?? 'other';
    familyCounts.set(key, (familyCounts.get(key) || 0) + 1);
  }
}

for (let index = 0; index < races.length; index++) {
  const race = races[index];
  const winner = race.results.find(row => row.finishPosition === 1);
  if (!winner || race.results.length < 5) continue;
  const profiles = [];
  for (const row of race.results) {
    const history = historyBefore(index, row.driverId);
    if (history.length < WINDOW) continue;
    const classified = history.filter(run => Number.isFinite(run.finishPosition));
    if (!classified.length) continue;
    const circuit = classified.filter(run => run.circuitId === race.circuit.id);
    const careerAverage = mean(classified.map(run => run.finishPosition));
    const profile = {
      driverId: row.driverId, name: row.name, constructorId: row.constructorId, row,
      recentAverage: mean(history.slice(0, WINDOW).map(run => run.finishPosition ?? 20)),
      recentWins: history.slice(0, WINDOW).filter(run => run.finishPosition === 1).length,
      careerAverage,
      circuitAverage: circuit.length >= 2 ? mean(circuit.map(run => run.finishPosition)) : null,
      priorConstructor: history[WINDOW]?.constructorId ?? row.constructorId,
      collisionRate: history.filter(run => collision(run.status)).length / history.length,
      mechanicalRate: history.filter(run => mechanical(run.status)).length / history.length,
    };
    profiles.push(profile);

    if (history.length >= 10) {
      const collisionKey = profile.collisionRate < 0.08 ? 'clean' : profile.collisionRate < 0.2 ? 'some' : 'frequent';
      recurrence.collision[collisionKey][0] += 1;
      if (collision(row.status)) recurrence.collision[collisionKey][1] += 1;
      const mechanicalKey = profile.mechanicalRate < 0.1 ? 'clean' : profile.mechanicalRate < 0.25 ? 'some' : 'frequent';
      recurrence.mechanical[mechanicalKey][0] += 1;
      if (mechanical(row.status)) recurrence.mechanical[mechanicalKey][1] += 1;
    }
    if (Number.isFinite(row.finishPosition) && history.length >= 10) {
      error.recent.push(Math.abs(profile.recentAverage - row.finishPosition));
      error.career.push(Math.abs(careerAverage - row.finishPosition));
      const era = eraOf(race.season);
      if (!eraError.has(era)) eraError.set(era, { recent: [], career: [] });
      eraError.get(era).recent.push(Math.abs(profile.recentAverage - row.finishPosition));
      eraError.get(era).career.push(Math.abs(careerAverage - row.finishPosition));
      if (profile.circuitAverage !== null) {
        error.circuit.push(Math.abs(profile.circuitAverage - row.finishPosition));
        const target = careerAverage - profile.circuitAverage >= 3 ? specialist : null;
        if (target) { target.n += 1; if (row.finishPosition < careerAverage) target.hit += 1; }
        else { specialist.baseN += 1; if (row.finishPosition < careerAverage) specialist.baseHit += 1; }
      }
    }
  }
  if (profiles.length < 5) continue;
  for (const profile of profiles) {
    const mate = profiles.find(other => other.constructorId === profile.constructorId && other.driverId !== profile.driverId);
    if (mate && Number.isFinite(profile.row.finishPosition)) error.teammate.push(Math.abs(mate.recentAverage - profile.row.finishPosition));
  }

  const ranked = [...profiles].sort((a, b) => a.recentAverage - b.recentAverage || a.careerAverage - b.careerAverage);
  const favourite = ranked[0];
  const winnerRank = ranked.findIndex(profile => profile.driverId === winner.driverId) + 1;
  if (!winnerRank) continue;
  analyzed += 1;
  if (winner.grid === 1) poleWon += 1;
  if (new Set(ranked.slice(0, 3).map(profile => profile.constructorId)).size < 3) sharedTopThree += 1;
  const tier = favourite.recentWins >= 2 ? 'dominant' : favourite.recentWins === 1 ? 'strong' : 'ordinary';
  dominance[tier][0] += 1;
  if (winnerRank === 1) { dominance[tier][1] += 1; favouriteWon += 1; continue; }

  const winnerProfile = ranked[winnerRank - 1];
  if (!finished(favourite.row.status)) {
    if (collision(favourite.row.status)) bump('favourite_incident_risk_ignored');
    else if (mechanical(favourite.row.status)) bump('favourite_mechanical_risk_ignored');
    else bump('evidence_did_not_contain_cause');
  } else if (winnerProfile.constructorId === favourite.constructorId) bump('constructor_pace_ignored');
  else if (winnerRank <= 3) bump('leading_group_not_separated');
  else if (winnerProfile.priorConstructor !== winnerProfile.constructorId) bump('stale_constructor_pairing');
  else if (winnerProfile.circuitAverage !== null && winnerProfile.careerAverage - winnerProfile.circuitAverage >= 3) bump('circuit_history_overweighted');
  else if (winnerRank <= 6) bump('short_window_overweighted');
  else bump('evidence_did_not_contain_cause');
}

const misses = analyzed - favouriteWon;
console.log(`races ${races.length} (${races[0].season}-${races.at(-1).season}), analyzed ${analyzed}, entries ${races.reduce((sum, race) => sum + race.results.length, 0)}\n`);

console.log('=== observed cause frequency ===');
for (const cause of Object.keys(MISS_CAUSES)) {
  const count = buckets.get(cause) || 0;
  const note = count ? `${String(count).padStart(4)} of ${misses} misses  ${pct(count, misses).padStart(6)}` : '   — not separable from race data alone (calibration rule)';
  console.log(`  ${cause.padEnd(36)} ${note}`);
}
for (const [cause, count] of buckets) {
  if (!MISS_CAUSES[cause]) console.log(`  UNLISTED ${cause}: ${count}`);
}

console.log('\n=== calibration: how often the recent-form leader actually wins ===');
console.log(`  overall ${pct(favouriteWon, analyzed)} of ${analyzed} races; winner started from pole ${pct(poleWon, analyzed)}`);
for (const [tier, [n, won]] of Object.entries(dominance)) console.log(`  leader with ${tier === 'dominant' ? '2-3' : tier === 'strong' ? '1' : '0'} wins in last ${WINDOW}: ${pct(won, n)} (n=${n})`);

console.log('\n=== predictor accuracy, mean absolute finishing positions (lower is better) ===');
for (const [key, values] of Object.entries(error)) console.log(`  ${key.padEnd(9)} ${mean(values).toFixed(2)}  (n=${values.length})`);

console.log('  by era:');
for (const [era, rows] of [...eraError].sort()) {
  console.log(`    ${era}  recent ${mean(rows.recent).toFixed(2)}  career ${mean(rows.career).toFixed(2)}  -> ${mean(rows.career) < mean(rows.recent) ? 'career' : 'recent'} wins  (n=${rows.recent.length})`);
}

console.log('\n=== every entry by incident family ===');
const entryTotal = [...familyCounts.values()].reduce((a, b) => a + b, 0);
for (const [key, count] of [...familyCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${key.padEnd(23)} ${String(count).padStart(6)}  ${pct(count, entryTotal).padStart(6)}`);

console.log('\n=== incident recurrence ===');
for (const [kind, rows] of Object.entries(recurrence)) {
  for (const [key, [n, hit]] of Object.entries(rows)) console.log(`  ${kind.padEnd(11)} prior ${key.padEnd(9)} ${pct(hit, n).padStart(6)} recur next race (n=${n})`);
}

console.log('\n=== circuit specialists versus their own career form ===');
console.log(`  specialists ${pct(specialist.hit, specialist.n)} (n=${specialist.n})   everyone else ${pct(specialist.baseHit, specialist.baseN)} (n=${specialist.baseN})`);
console.log(`\n  one constructor holds two of the top three form places in ${pct(sharedTopThree, analyzed)} of races`);
