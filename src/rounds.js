import { buildPredictionCase } from './evidence.js';
import { buildRecord } from './compare.js';
import { assert } from './util.js';

/**
 * The closed set of reasons a prediction can miss. The model only ever selects a
 * slug from this table; every lesson string that re-enters a later prompt is
 * written here, so no model-authored text is ever fed back as instructions.
 *
 * Derived from 615 Jolpica races, 1994-2026 (13,094 entries). Each `support`
 * field records the measurement that earned the entry its place and is never
 * sent to a model, and `npm run audit` regenerates every one of them. Two earlier
 * rules were deleted outright because the data contradicted them: lifetime
 * aggregates beat a three-race window in every era measured, and circuit
 * specialists hold no edge over their own career form. Re-measure before changing
 * a lesson; one that names a signal the data does not contain teaches the next
 * round to fit noise.
 */
export const MISS_CAUSES = {
  leading_group_not_separated: {
    criterion: 'The driver who won was already among the two or three strongest in the supplied form evidence. The prediction identified the right group but committed to the wrong member of it.',
    lesson: 'The strongest driver on recent form wins about a third of races. Unless one driver has been winning outright, keep the leading two or three close together rather than committing to one.',
    support: 'Largest single bucket: 102 of 415 missed races (24.6%). The recent-form leader won 197 of 612 races (32.2%).',
  },
  constructor_pace_ignored: {
    criterion: 'The winner drives for the same constructor as the driver the prediction favoured. The car was right and the driver within it was wrong.',
    lesson: 'Rate the constructor before the driver. A teammate\'s recent results describe a driver\'s likely finish almost as well as their own, so when one constructor is fastest, rank both of its cars above a quicker-looking driver in a slower car.',
    support: '73 of 415 misses (17.6%). Teammate recent form predicts a finish at 4.69 mean absolute positions versus 4.47 for the driver\'s own; one constructor holds two of the top three form places in 54.7% of races.',
  },
  short_window_overweighted: {
    criterion: 'The prediction followed a short recent streak — a driver\'s last two or three results — over their longer record, and the streak did not continue.',
    lesson: 'A three-race window is noisier than the full record. When the recent window and the lifetime aggregate disagree, follow the lifetime aggregate and treat the streak as weak evidence.',
    support: 'Career average predicts finishing position at 4.37 mean absolute positions versus 4.47 for the last three races, and wins in all four eras measured (1994-2005, 2006-2013, 2014-2021, 2022-2026). Covers 70 of 415 misses (16.9%) where the winner sat fourth to sixth on recent form.',
  },
  favourite_mechanical_risk_ignored: {
    criterion: 'The favoured driver did not finish because of a car failure: power unit, transmission, suspension, brakes or similar. Their record already showed retirements the prediction did not discount.',
    lesson: 'Mechanical retirement is partly predictable. A driver whose record shows frequent car failures retires from more than a quarter of races, against roughly one in sixteen for a clean record. Discount a favourite with a poor completion rate and leave that probability with the rest of the field.',
    support: '39 of 415 misses (9.4%). Frequent prior mechanical retirements: 27.4% retirement in the next race (n=2,437), versus 13.2% for some (n=4,323) and 6.2% for a clean record (n=4,745).',
  },
  circuit_history_overweighted: {
    criterion: 'Results at this specific circuit drove the prediction while the driver\'s general current pace pointed elsewhere.',
    lesson: 'Circuit history is the weakest of the aggregates supplied and carries no edge of its own. Use it only to separate drivers whose current pace is otherwise equal, never as a reason to move a driver up the order.',
    support: '17 of 415 misses (4.1%). Circuit average predicts a finish at 5.52 mean absolute positions, the worst of the three aggregates; drivers with a circuit record three or more positions better than their career form beat that career form 55.4% of the time, below the 57.0% base rate.',
  },
  favourite_incident_risk_ignored: {
    criterion: 'The favoured driver did not finish because of a collision, accident or spin. Their record already showed such incidents the prediction did not discount.',
    lesson: 'Collisions recur. A driver with a frequent incident record is involved in one about three times as often as a clean driver, so a favourite with that record needs probability moved to the rest of the field even when their pace is best.',
    support: '30 of 415 misses (7.2%). Frequent prior collisions: 15.4% in the next race, versus 10.9% for some and 5.8% for a clean record. Collisions account for 9.6% of all 13,094 entries, against 14.5% for mechanical retirements.',
  },
  overconfident_in_the_favourite: {
    criterion: 'The leading pick was defensible, but the probability given to it was far above what the evidence supports for a single driver.',
    lesson: 'Even the strongest possible case supports roughly a 46% chance for one driver, and the ordinary case is about a third. Probability above one half for a single driver needs a record of recent outright wins, not merely the best average finish.',
    support: 'The recent-form leader won 32.2% of 612 races; at best, with two or three wins in their last three races, 46.1%.',
  },
  underconfident_in_a_dominant_driver: {
    criterion: 'One driver had been winning races outright in the supplied evidence, and probability was still spread almost evenly across the field.',
    lesson: 'Recent outright wins are the strongest signal available. A leader who won two of their last three races wins about 46% of the time, against roughly one in ten for a leader who has won none. Concentrate probability when that pattern is present.',
    support: 'Favourite win rate by recent wins: two or three wins 46.1% (n=323), one win 19.8% (n=192), none 10.3% (n=97).',
  },
  stale_constructor_pairing: {
    criterion: 'The winner\'s recent results were scored with a different constructor from the one they are entered with for this race, and the prediction carried the old pairing forward.',
    lesson: 'Judge every driver by the constructor named in the target field. Results scored in a different car describe that car, not this one. This matters most at the first race of a season, where all recent form comes from last year\'s cars.',
    support: '7 of 415 misses (1.7%), concentrated at season-opening races after off-season driver moves.',
  },
  evidence_did_not_contain_cause: {
    criterion: 'Nothing in the supplied pre-race evidence points to what decided this race. The winner had no supporting form, or the result turned on something the evidence does not carry, such as weather, a safety car, a penalty, a pit-stop strategy or a first-lap incident.',
    lesson: null,
    support: '77 of 415 misses (18.6%): a winner outside the form top six with nothing supporting them, or a favourite lost to a penalty, a withdrawal or an unclassified retirement. Qualifying position is not in the evidence at all and 49.3% of winners start from pole, so a large share of the remainder is structurally invisible.',
  },
};

const emptyUsage = () => ({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 });

function addUsage(total, usage) {
  for (const key of Object.keys(total)) total[key] += Number(usage?.[key] || 0);
  return total;
}

function causeCriteria() {
  return Object.fromEntries(Object.entries(MISS_CAUSES).map(([cause, entry]) => [cause, entry.criterion]));
}

/** Folds a diagnosed cause into the ledger. A repeat reinforces the existing
 * entry instead of adding one, so the carried correction set stays small. */
function applyLesson(ledger, cause, raceId) {
  const lesson = MISS_CAUSES[cause].lesson;
  if (!lesson) return false;
  const existing = ledger.find(entry => entry.cause === cause);
  if (existing) {
    existing.timesObserved += 1;
    existing.afterRaces.push(raceId);
    return true;
  }
  ledger.push({ cause, lesson, timesObserved: 1, afterRaces: [raceId] });
  return true;
}

export function lessonsForPrompt(ledger, limit = 5) {
  return [...ledger]
    .sort((a, b) => b.timesObserved - a.timesObserved || a.cause.localeCompare(b.cause))
    .slice(0, limit)
    .map(({ cause, lesson, timesObserved }) => ({ cause, lesson, timesObserved }));
}

/** A miss worth learning from: the top pick was wrong, or the actual winner was
 * given less probability than an uninformed uniform split would have. */
function isMaterialMiss(record, predictionCase) {
  if (!record.metrics) return false;
  const uniform = 1 / predictionCase.evidence.field.length;
  return !record.metrics.topPickCorrect || record.probabilities[predictionCase.outcome.winnerDriverId] < uniform;
}

async function diagnoseRung(provider, predictionCase, record) {
  const winnerId = predictionCase.outcome.winnerDriverId;
  const winner = predictionCase.evidence.field.find(driver => driver.driverId === winnerId);
  const review = {
    schemaVersion: 1,
    race: predictionCase.evidence.target,
    field: predictionCase.evidence.field,
    priorLessons: predictionCase.evidence.priorLessons ?? [],
    prediction: record.ranking.slice(0, 5).map(entry => ({ driverId: entry.driverId, name: entry.name, probability: entry.probability })),
    actual: {
      winnerDriverId: winnerId,
      winnerName: winner?.name ?? winnerId,
      probabilityAssignedToWinner: record.probabilities[winnerId],
      finishOrder: predictionCase.outcome.finishOrder,
    },
  };
  const answer = await provider.diagnose(review, causeCriteria());
  assert(answer && MISS_CAUSES[answer.cause], `Diagnosis returned an unknown cause: ${answer?.cause}.`);
  return {
    cause: answer.cause,
    lesson: MISS_CAUSES[answer.cause].lesson,
    confidence: Number.isFinite(answer.confidence) ? answer.confidence : null,
    durationMs: Number(answer.durationMs || 0),
    usage: answer.usage ?? emptyUsage(),
  };
}

/**
 * Walks the races before the target in order: predict, reveal, evaluate, diagnose
 * the miss, fold the correction into the ledger, move to the next race. The ledger
 * is the only thing that crosses a round boundary. The target race is predicted
 * last and never evaluated back into the loop, so its result cannot reach a prompt.
 */
export async function runRoundsLoop(provider, { races, target, recentWindow = 3, ladder = 4, snapshotAt, onEvent = () => {} }) {
  assert(Number.isInteger(ladder) && ladder >= 1 && ladder <= 20, 'ladder must be an integer from 1 to 20.');
  const targetStart = Date.parse(target.startsAt);
  const cutoff = snapshotAt ? Date.parse(snapshotAt) : targetStart - 1;
  assert(Number.isFinite(cutoff) && cutoff < targetStart, 'Snapshot must be before the target race.');
  const rungRaces = races
    .filter(race => race.id !== target.id && Date.parse(race.startsAt) < cutoff && race.results?.length)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(-ladder);
  assert(rungRaces.length > 0, 'No completed race before the snapshot is available to learn from.');
  const diagnosisSupported = typeof provider.diagnose === 'function';

  const ledger = [];
  const rungs = [];
  const usage = emptyUsage();
  let durationMs = 0;
  let calls = 0;

  for (const race of rungRaces) {
    const priorLessons = lessonsForPrompt(ledger);
    const rung = { raceId: race.id, round: race.round, raceName: race.name, priorLessonCount: priorLessons.length };
    await onEvent({ type: 'round.started', provider: provider.name, model: provider.model, ...rung });
    try {
      const rungCase = buildPredictionCase(races, race, { recentWindow, priorLessons });
      const record = buildRecord(await provider.predict(rungCase.evidence), rungCase);
      calls += 1;
      durationMs += record.durationMs;
      addUsage(usage, record.usage);
      rung.record = record;
      rung.actualWinnerName = rungCase.evidence.field.find(driver => driver.driverId === rungCase.outcome.winnerDriverId)?.name ?? rungCase.outcome.winnerDriverId;
      rung.winnerProbability = record.probabilities[rungCase.outcome.winnerDriverId];
      rung.missed = isMaterialMiss(record, rungCase);
      if (rung.missed && diagnosisSupported) {
        const diagnosis = await diagnoseRung(provider, rungCase, record);
        calls += 1;
        durationMs += diagnosis.durationMs;
        addUsage(usage, diagnosis.usage);
        rung.diagnosis = diagnosis;
        rung.corrected = applyLesson(ledger, diagnosis.cause, race.id);
      }
    } catch (error) {
      // A learning round is best effort. Losing one must not discard the rounds
      // already paid for, or block the prediction the user actually asked for.
      rung.error = error.message;
    }
    rungs.push(rung);
    await onEvent({ type: 'round.completed', provider: provider.name, model: provider.model, rung });
  }

  const finalLessons = lessonsForPrompt(ledger);
  const predictionCase = buildPredictionCase(races, target, { recentWindow, snapshotAt, priorLessons: finalLessons });
  await onEvent({ type: 'round.final.started', provider: provider.name, model: provider.model, priorLessonCount: finalLessons.length });
  const record = buildRecord(await provider.predict(predictionCase.evidence), predictionCase);
  calls += 1;
  durationMs += record.durationMs;
  addUsage(usage, record.usage);
  const loop = {
    provider: provider.name,
    model: provider.model,
    protocol: 'rounds',
    diagnosisSupported,
    target: predictionCase.evidence.target,
    snapshotAt: predictionCase.evidence.snapshotAt,
    ladder: rungs.length,
    rungs,
    ledger,
    record,
    predictionCase,
    totals: { calls, durationMs, usage },
  };
  await onEvent({ type: 'round.final.completed', provider: provider.name, model: provider.model, record, ledger });
  return loop;
}

const percentage = value => `${(value * 100).toFixed(2)}%`;

export function formatRoundsTrace(loop) {
  const lines = [`${loop.provider} / ${loop.model} — ${loop.ladder} learning round(s) before the target`];
  if (!loop.diagnosisSupported) lines.push('  This provider has no diagnosis step, so no correction can be learned.');
  for (const rung of loop.rungs) {
    lines.push(`  R${rung.round} ${rung.raceName}${rung.priorLessonCount ? ` (carrying ${rung.priorLessonCount} correction(s))` : ''}`);
    if (rung.error) {
      lines.push(`    round failed: ${rung.error}`);
      continue;
    }
    const top = rung.record.ranking[0];
    lines.push(`    predicted ${top.name} ${percentage(top.probability)} | actual ${rung.actualWinnerName} ${percentage(rung.winnerProbability)} | ${rung.missed ? 'MISS' : 'HIT'}`);
    if (rung.diagnosis) {
      lines.push(`    cause ${rung.diagnosis.cause}${rung.diagnosis.confidence === null ? '' : ` (confidence ${rung.diagnosis.confidence.toFixed(2)})`}`);
      lines.push(`    fix   ${rung.diagnosis.lesson ?? 'none — the evidence did not contain the cause, so nothing was changed'}`);
    }
  }
  lines.push(`  Carried into the target: ${loop.ledger.length} correction(s)${loop.ledger.length ? ` — ${loop.ledger.map(entry => `${entry.cause} x${entry.timesObserved}`).join(', ')}` : ''}`);
  const replayed = loop.rungs.filter(rung => rung.record?.metadata?.cached).length + (loop.record.metadata?.cached ? 1 : 0);
  lines.push(`  Loop cost: ${loop.totals.calls} model call(s), ${loop.totals.usage.totalTokens} provider-reported tokens, ${loop.totals.durationMs.toFixed(0)} ms${replayed ? ` (${replayed} replayed from cache, so that time was not spent now)` : ''}`);
  return lines.join('\n');
}
