import { assert, hash } from './util.js';

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function summarize(history, circuitId) {
  const classified = history.filter(run => Number.isFinite(run.finishPosition));
  const completed = history.filter(run => /^Finished$|^\+\d+ Laps?$/i.test(run.status));
  const circuit = classified.filter(run => run.circuitId === circuitId);
  const finishes = classified.map(run => run.finishPosition);
  return {
    careerStartsInDataset: history.length,
    wins: classified.filter(run => run.finishPosition === 1).length,
    podiums: classified.filter(run => run.finishPosition <= 3).length,
    topTenFinishes: classified.filter(run => run.finishPosition <= 10).length,
    classifiedFinishes: classified.length,
    nonFinishes: history.length - completed.length,
    averageFinish: mean(finishes),
    bestFinish: finishes.length ? Math.min(...finishes) : null,
    completionRate: history.length ? completed.length / history.length : null,
    totalPoints: history.reduce((sum, run) => sum + run.points, 0),
    circuitStarts: circuit.length,
    circuitAverageFinish: mean(circuit.map(run => run.finishPosition)),
    circuitBestFinish: circuit.length ? Math.min(...circuit.map(run => run.finishPosition)) : null,
  };
}

function historyForDriver(races, driverId, cutoff) {
  const result = [];
  for (const race of races) {
    assert(Date.parse(race.startsAt) < cutoff, `History race ${race.id} is not before the target.`);
    const row = race.results.find(item => item.driverId === driverId);
    if (!row) continue;
    result.push({
      raceId: race.id,
      startsAt: race.startsAt,
      raceName: race.name,
      circuitId: race.circuit.id,
      circuitName: race.circuit.name,
      constructorId: row.constructorId,
      constructorName: row.constructorName,
      grid: row.grid,
      finishPosition: row.finishPosition,
      points: row.points,
      status: row.status,
      laps: row.laps,
    });
  }
  return result.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export function buildPredictionCase(races, targetRace, { recentWindow = 3, snapshotAt, priorLessons = [] } = {}) {
  assert(targetRace && Array.isArray(targetRace.entrants) && targetRace.entrants.length >= 2, 'Target race needs at least two entrants.');
  assert(Array.isArray(priorLessons), 'priorLessons must be an array of corrections.');
  assert(Number.isInteger(recentWindow) && recentWindow >= 1 && recentWindow <= 30, 'recentWindow must be 1–30.');
  const targetStart = Date.parse(targetRace.startsAt);
  assert(Number.isFinite(targetStart), 'Target race needs a valid startsAt timestamp.');
  const cutoff = snapshotAt ? Date.parse(snapshotAt) : targetStart - 1;
  assert(Number.isFinite(cutoff) && cutoff < targetStart, 'Snapshot must be before the target race.');
  const priorRaces = races
    .filter(race => Date.parse(race.startsAt) < cutoff && race.id !== targetRace.id)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const field = targetRace.entrants.map((entrant, index) => {
    const history = historyForDriver(priorRaces, entrant.driverId, cutoff);
    return {
      slotId: `driver_${index}`,
      driverId: entrant.driverId,
      name: entrant.name,
      constructorId: entrant.constructorId,
      constructorName: entrant.constructorName,
      historySummary: summarize(history, targetRace.circuit.id),
      recentRaces: history.slice(-recentWindow).map(run => ({
        race: run.raceName,
        date: run.startsAt.slice(0, 10),
        circuit: run.circuitName,
        constructor: run.constructorName,
        grid: run.grid,
        finish: run.finishPosition,
        points: run.points,
        status: run.status,
      })),
    };
  });
  const evidence = {
    schemaVersion: 1,
    snapshotAt: new Date(cutoff).toISOString(),
    target: {
      raceId: targetRace.id,
      season: targetRace.season,
      round: targetRace.round,
      raceName: targetRace.name,
      startsAt: targetRace.startsAt,
      circuitId: targetRace.circuit.id,
      circuitName: targetRace.circuit.name,
      country: targetRace.circuit.country,
    },
    field,
    // Corrections carried in from earlier rounds. They are part of the hashed
    // evidence, so a lesson-primed prediction can never be pooled with a cold one.
    ...(priorLessons.length ? { priorLessons } : {}),
    evidenceRules: [
      'Use only supplied pre-race evidence.',
      'Full-history aggregates use every available race before snapshotAt.',
      `recentRaces contains at most the latest ${recentWindow} races for context.`,
      'Missing evidence is unknown, not negative evidence.',
      ...(priorLessons.length ? ['priorLessons are corrections derived from earlier misses in this sequence. They are guidance for weighing evidence, never facts about the target race.'] : []),
    ],
  };
  const outcome = targetRace.results?.length ? {
    winnerDriverId: targetRace.results.find(row => row.finishPosition === 1)?.driverId,
    finishOrder: targetRace.results
      .filter(row => Number.isFinite(row.finishPosition))
      .map(row => ({ driverId: row.driverId, finishPosition: row.finishPosition })),
  } : null;
  if (outcome) assert(outcome.winnerDriverId, 'Target result has no winner.');
  return { evidence, evidenceHash: hash(evidence), outcome };
}

export function buildUpcomingRace(nextRace, historyRaces) {
  const latest = [...historyRaces]
    .filter(race => Date.parse(race.startsAt) < Date.parse(nextRace.startsAt) && race.entrants.length)
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0];
  assert(latest, 'No completed race is available to estimate the upcoming field.');
  return {
    ...nextRace,
    entrants: latest.entrants,
    fieldSource: `Estimated from the most recent completed field: ${latest.name}`,
    results: [],
  };
}
