import { scorePrediction, aggregateMetrics } from './metrics.js';
import { assert, hash, normalizeDistribution, rankedEntries } from './util.js';

// Shared by the single-shot comparison and the round-by-round ladder so every
// stored prediction carries the same validated shape, hash, and metrics.
export function buildRecord(prediction, predictionCase) {
  const ids = predictionCase.evidence.field.map(driver => driver.driverId);
  const probabilities = normalizeDistribution(prediction.probabilities, ids);
  return {
    ...prediction,
    probabilities,
    evidenceHash: predictionCase.evidenceHash,
    generatedAt: new Date().toISOString(),
    ranking: rankedEntries(probabilities, predictionCase.evidence.field),
    metrics: predictionCase.outcome ? scorePrediction(probabilities, predictionCase.outcome) : null,
  };
}

export async function compareProviders(predictionCase, providers, { onEvent = () => {}, continueOnError = false } = {}) {
  assert(providers.length > 0, 'Select at least one provider.');
  const serializedEvidence = JSON.stringify(predictionCase.evidence);
  await onEvent({ type: 'comparison.started', target: predictionCase.evidence.target, snapshotAt: predictionCase.evidence.snapshotAt, evidenceHash: predictionCase.evidenceHash });
  // Providers run concurrently so a four-model comparison costs one model's
  // wall clock instead of four. Results are collected by index, which keeps the
  // record order (and therefore the comparison hash) independent of who finishes first.
  const settled = await Promise.all(providers.map(async (provider, index) => {
    const input = JSON.parse(serializedEvidence);
    await onEvent({ type: 'provider.started', index, provider: provider.name, model: provider.model, startedAt: new Date().toISOString() });
    try {
      const prediction = await provider.predict(input, {
        onActivity: activity => onEvent({ type: 'provider.activity', index, provider: provider.name, model: provider.model, ...activity }),
      });
      const record = buildRecord(prediction, predictionCase);
      await onEvent({ type: 'provider.completed', index, record });
      return { record };
    } catch (error) {
      const failure = { index, provider: provider.name, model: provider.model, message: error.message };
      await onEvent({ type: 'provider.failed', ...failure });
      if (!continueOnError) throw error;
      return { failure };
    }
  }));
  const records = settled.filter(result => result.record).map(result => result.record);
  const failures = settled.filter(result => result.failure).map(result => result.failure);
  assert(records.length > 0, `Every provider failed: ${failures.map(failure => `${failure.provider}/${failure.model}: ${failure.message}`).join('; ')}`);
  const comparison = {
    id: `comparison-${hash({ evidenceHash: predictionCase.evidenceHash, records, failures }).slice(0, 24)}`,
    target: predictionCase.evidence.target,
    snapshotAt: predictionCase.evidence.snapshotAt,
    evidenceHash: predictionCase.evidenceHash,
    outcome: predictionCase.outcome,
    records,
    failures,
  };
  await onEvent({ type: 'comparison.completed', comparison });
  return comparison;
}

export function benchmarkSummary(comparisons) {
  const byProvider = new Map();
  for (const comparison of comparisons) {
    for (const record of comparison.records) {
      const key = `${record.provider}:${record.model}`;
      if (!byProvider.has(key)) byProvider.set(key, []);
      byProvider.get(key).push(record);
    }
  }
  return [...byProvider].map(([providerModel, records]) => ({ providerModel, ...aggregateMetrics(records) }));
}

const percentage = value => `${(value * 100).toFixed(2)}%`;

export function formatComparison(comparison) {
  const lines = [
    `${comparison.target.season} round ${comparison.target.round}: ${comparison.target.raceName}`,
    `Snapshot: ${comparison.snapshotAt} | evidence ${comparison.evidenceHash.slice(0, 12)}`,
    '',
  ];
  for (const record of comparison.records) {
    lines.push(`${record.provider} / ${record.model}`);
    lines.push(`  Time: ${record.durationMs.toFixed(0)} ms`);
    lines.push(`  Tokens: ${record.usage.totalTokens} total (${record.usage.inputTokens} input, ${record.usage.cachedInputTokens} cached input, ${record.usage.outputTokens} output, ${record.usage.reasoningOutputTokens} reasoning output)`);
    record.ranking.slice(0, 5).forEach((entry, index) => lines.push(`  ${index + 1}. ${entry.name}: ${percentage(entry.probability)}`));
    if (record.metrics) {
      lines.push(`  Result metrics: log loss ${record.metrics.winnerLogLoss.toFixed(4)}, Brier ${record.metrics.brier.toFixed(4)}, top pick ${record.metrics.topPickCorrect ? 'correct' : 'wrong'}, rank rho ${record.metrics.rankCorrelation?.toFixed(3) ?? 'n/a'}`);
    }
    if (record.metadata?.simulated) lines.push('  SIMULATED PROVIDER — no live model was called.');
    if (record.metadata?.cached) lines.push(`  REPLAYED FROM CACHE — no model was called. Time and tokens are from the original call${record.metadata.measuredAt ? ` on ${record.metadata.measuredAt.slice(0, 10)}` : ''}.`);
    lines.push('');
  }
  return lines.join('\n');
}

export function formatBenchmark(rows) {
  const headings = ['provider/model', 'races', 'log loss', 'Brier', 'top pick', 'rank rho', 'tokens', 'mean ms'];
  const body = rows.map(row => [
    row.providerModel,
    String(row.races),
    row.meanWinnerLogLoss.toFixed(4),
    row.meanBrier.toFixed(4),
    percentage(row.topPickAccuracy),
    row.meanRankCorrelation.toFixed(3),
    String(row.totalTokens),
    row.meanDurationMs.toFixed(0),
  ]);
  const widths = headings.map((heading, index) => Math.max(heading.length, ...body.map(row => row[index].length)));
  return [headings, ...body].map(row => row.map((cell, index) => cell.padEnd(widths[index])).join('  ')).join('\n');
}
