import { assert } from './util.js';

const floor = 1e-15;

export function scorePrediction(probabilities, outcome) {
  const ids = Object.keys(probabilities);
  assert(ids.includes(outcome.winnerDriverId), 'Winner is absent from the predicted field.');
  const winnerProbability = Math.max(floor, probabilities[outcome.winnerDriverId]);
  const predictedWinner = ids.sort((a, b) => probabilities[b] - probabilities[a] || a.localeCompare(b))[0];
  const brier = ids.reduce((sum, id) => sum + (probabilities[id] - (id === outcome.winnerDriverId ? 1 : 0)) ** 2, 0);
  return {
    winnerLogLoss: -Math.log(winnerProbability),
    brier,
    topPickCorrect: predictedWinner === outcome.winnerDriverId,
    rankCorrelation: spearman(probabilities, outcome.finishOrder),
  };
}

function averageRanks(rows, value) {
  const sorted = [...rows].sort((a, b) => value(a) - value(b));
  const ranks = new Map();
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && value(sorted[end]) === value(sorted[start])) end++;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index++) ranks.set(sorted[index].id, rank);
    start = end;
  }
  return ranks;
}

export function spearman(probabilities, finishOrder) {
  const finish = new Map(finishOrder.map(row => [row.driverId, row.finishPosition]));
  const rows = Object.keys(probabilities)
    .filter(id => Number.isFinite(finish.get(id)))
    .map(id => ({ id, predicted: -probabilities[id], actual: finish.get(id) }));
  if (rows.length < 2) return null;
  const predictedRanks = averageRanks(rows, row => row.predicted);
  const actualRanks = averageRanks(rows, row => row.actual);
  const predictedMean = [...predictedRanks.values()].reduce((a, b) => a + b, 0) / rows.length;
  const actualMean = [...actualRanks.values()].reduce((a, b) => a + b, 0) / rows.length;
  let numerator = 0;
  let predictedVariance = 0;
  let actualVariance = 0;
  for (const row of rows) {
    const x = predictedRanks.get(row.id) - predictedMean;
    const y = actualRanks.get(row.id) - actualMean;
    numerator += x * y;
    predictedVariance += x * x;
    actualVariance += y * y;
  }
  if (predictedVariance === 0 || actualVariance === 0) return 0;
  return numerator / Math.sqrt(predictedVariance * actualVariance);
}

export function aggregateMetrics(records) {
  assert(records.length > 0, 'Cannot aggregate an empty benchmark.');
  const withMetrics = records.filter(record => record.metrics);
  assert(withMetrics.length > 0, 'Benchmark has no revealed outcomes.');
  const mean = key => withMetrics.reduce((sum, record) => sum + record.metrics[key], 0) / withMetrics.length;
  return {
    races: withMetrics.length,
    meanWinnerLogLoss: mean('winnerLogLoss'),
    meanBrier: mean('brier'),
    topPickAccuracy: withMetrics.filter(record => record.metrics.topPickCorrect).length / withMetrics.length,
    meanRankCorrelation: withMetrics.filter(record => record.metrics.rankCorrelation !== null)
      .reduce((sum, record, _, rows) => sum + record.metrics.rankCorrelation / rows.length, 0),
    totalTokens: withMetrics.reduce((sum, record) => sum + record.usage.totalTokens, 0),
    meanDurationMs: withMetrics.reduce((sum, record) => sum + record.durationMs, 0) / withMetrics.length,
  };
}
