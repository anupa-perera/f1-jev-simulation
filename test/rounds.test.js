import test from 'node:test';
import assert from 'node:assert/strict';
import { demoRaces } from '../src/demo-data.js';
import { buildPredictionCase } from '../src/evidence.js';
import { runRoundsLoop, lessonsForPrompt, MISS_CAUSES } from '../src/rounds.js';

const usage = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 12 };

/** Records every evidence object it is shown and answers with a fixed pick, so a
 * test can force a hit, a miss, or a specific diagnosed cause. */
class FakeProvider {
  constructor({ pick, cause = 'leading_group_not_separated', diagnose = true } = {}) {
    this.name = 'fake';
    this.model = 'fake-1';
    this.pick = pick;
    this.cause = cause;
    this.seen = [];
    this.reviews = [];
    if (!diagnose) this.diagnose = undefined;
  }
  async predict(evidence) {
    this.seen.push(evidence);
    const chosen = this.pick(evidence);
    const share = 0.1 / (evidence.field.length - 1);
    return {
      provider: this.name,
      model: this.model,
      probabilities: Object.fromEntries(evidence.field.map(driver => [driver.driverId, driver.driverId === chosen ? 0.9 : share])),
      durationMs: 1,
      usage,
    };
  }
  async diagnose(review, criteria) {
    this.reviews.push({ review, criteria });
    return { cause: this.cause, confidence: 0.6, durationMs: 1, usage };
  }
}

const alwaysWinner = races => new FakeProvider({ pick: evidence => races.find(race => race.id === evidence.target.raceId)?.results[0].driverId ?? evidence.field[0].driverId });
const alwaysLast = () => new FakeProvider({ pick: evidence => evidence.field[evidence.field.length - 1].driverId });

test('the rounds loop never shows a provider a target result', async () => {
  const races = demoRaces();
  const target = races[3];
  const provider = alwaysLast();
  const loop = await runRoundsLoop(provider, { races, target, ladder: 3 });
  const serialized = JSON.stringify(provider.seen);
  assert.equal(serialized.includes('winnerDriverId'), false);
  assert.equal(serialized.includes('finishOrder'), false);
  for (const evidence of provider.seen) {
    for (const driver of evidence.field) {
      assert.equal(driver.recentRaces.some(run => run.race === evidence.target.raceName), false);
    }
  }
  // Every round predicted a race that starts before the one it was learning for.
  const finalEvidence = provider.seen.at(-1);
  assert.equal(finalEvidence.target.raceId, target.id);
  for (const driver of finalEvidence.field) {
    assert.equal(driver.recentRaces.some(run => run.race === target.name), false);
  }
  assert.equal(loop.record.metrics.topPickCorrect, false);
});

test('rounds run in chronological order and stop before the target', async () => {
  const races = demoRaces();
  const loop = await runRoundsLoop(alwaysLast(), { races, target: races[3], ladder: 10 });
  assert.deepEqual(loop.rungs.map(rung => rung.round), [1, 2, 3]);
  assert.equal(loop.rungs.some(rung => rung.raceId === races[3].id), false);
});

test('a hit adds no correction and a miss adds one', async () => {
  const races = demoRaces();
  const hitting = alwaysWinner(races);
  const hitLoop = await runRoundsLoop(hitting, { races, target: races[3], ladder: 3 });
  assert.deepEqual(hitLoop.ledger, []);
  assert.equal(hitting.reviews.length, 0);
  assert.equal(hitLoop.rungs.every(rung => rung.missed === false), true);

  const missing = alwaysLast();
  const missLoop = await runRoundsLoop(missing, { races, target: races[3], ladder: 3 });
  assert.equal(missing.reviews.length, 3);
  assert.equal(missLoop.ledger.length, 1);
  assert.equal(missLoop.ledger[0].timesObserved, 3, 'a repeated cause reinforces one entry instead of adding more');
  assert.equal(missLoop.ledger[0].lesson, MISS_CAUSES.leading_group_not_separated.lesson);
});

test('an undiagnosable upset records the cause but changes nothing', async () => {
  const races = demoRaces();
  const provider = new FakeProvider({ pick: evidence => evidence.field.at(-1).driverId, cause: 'evidence_did_not_contain_cause' });
  const loop = await runRoundsLoop(provider, { races, target: races[3], ladder: 3 });
  assert.deepEqual(loop.ledger, []);
  assert.equal(loop.rungs[0].diagnosis.cause, 'evidence_did_not_contain_cause');
  assert.equal(loop.rungs[0].corrected, false);
  assert.equal(JSON.stringify(provider.seen).includes('priorLessons'), false);
});

test('corrections reach later rounds and change the evidence hash', async () => {
  const races = demoRaces();
  const provider = alwaysLast();
  const loop = await runRoundsLoop(provider, { races, target: races[3], ladder: 3 });
  assert.equal(provider.seen[0].priorLessons, undefined, 'the first round starts cold');
  assert.deepEqual(provider.seen[1].priorLessons, lessonsForPrompt(loop.ledger).map(entry => ({ ...entry, timesObserved: 1 })));
  assert.equal(provider.seen.at(-1).priorLessons.length, 1);
  assert.equal(provider.seen.at(-1).priorLessons[0].lesson.includes('instructions'), false);
  const cold = buildPredictionCase(races, races[3]);
  assert.notEqual(loop.record.evidenceHash, cold.evidenceHash, 'a primed prediction must not share a hash with a cold one');
});

test('a provider without a diagnosis step still predicts, and a failed round does not stop the loop', async () => {
  const races = demoRaces();
  const blind = new FakeProvider({ pick: evidence => evidence.field.at(-1).driverId, diagnose: false });
  const blindLoop = await runRoundsLoop(blind, { races, target: races[3], ladder: 3 });
  assert.equal(blindLoop.diagnosisSupported, false);
  assert.deepEqual(blindLoop.ledger, []);
  assert.ok(blindLoop.record.probabilities);

  const flaky = alwaysLast();
  const inner = flaky.predict.bind(flaky);
  let call = 0;
  flaky.predict = async evidence => {
    call += 1;
    if (call === 2) throw new Error('provider exploded');
    return inner(evidence);
  };
  const flakyLoop = await runRoundsLoop(flaky, { races, target: races[3], ladder: 3 });
  assert.equal(flakyLoop.rungs[1].error, 'provider exploded');
  assert.equal(flakyLoop.rungs[2].error, undefined);
  assert.ok(flakyLoop.record.metrics);
});

test('loop totals count every call including diagnoses', async () => {
  const races = demoRaces();
  const loop = await runRoundsLoop(alwaysLast(), { races, target: races[3], ladder: 3 });
  assert.equal(loop.totals.calls, 7, '3 round predictions + 3 diagnoses + 1 target prediction');
  assert.equal(loop.totals.usage.totalTokens, 7 * usage.totalTokens);
});

test('the cause taxonomy stays usable as a Choice and keeps exactly one no-fix option', async () => {
  const entries = Object.entries(MISS_CAUSES);
  assert.ok(entries.length >= 2, 'a Choice needs at least two options');
  const withoutLesson = entries.filter(([, entry]) => entry.lesson === null);
  assert.equal(withoutLesson.length, 1, 'exactly one cause must produce no correction, or the loop fits noise');
  assert.equal(withoutLesson[0][0], 'evidence_did_not_contain_cause');
  for (const [cause, entry] of entries) {
    assert.match(cause, /^[a-z][a-z_]+$/);
    assert.ok(entry.criterion.length > 40, `${cause} needs a criterion that stands on its own`);
    assert.ok(entry.support?.length > 20, `${cause} must record the measurement that justifies it`);
  }
  // Provenance is for readers of this repository, never for a prompt.
  const provider = alwaysLast();
  await runRoundsLoop(provider, { races: demoRaces(), target: demoRaces()[3], ladder: 3 });
  const sentCriteria = provider.reviews[0].criteria;
  assert.deepEqual(Object.keys(sentCriteria).sort(), entries.map(([cause]) => cause).sort());
  assert.equal(JSON.stringify(sentCriteria).includes('misses'), false, 'support notes must not reach the model');
});
