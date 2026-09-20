import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPredictionCase } from '../src/evidence.js';
import { demoRaces } from '../src/demo-data.js';
import { normalizeDistribution } from '../src/util.js';
import { scorePrediction, spearman } from '../src/metrics.js';
import { compareProviders } from '../src/compare.js';

test('prediction evidence includes prior history and excludes target result', () => {
  const races = demoRaces();
  const predictionCase = buildPredictionCase(races, races[3]);
  const serialized = JSON.stringify(predictionCase.evidence);
  assert.equal(serialized.includes('winnerDriverId'), false);
  assert.equal(serialized.includes('Demo Grand Prix 4'), true);
  assert.equal(predictionCase.evidence.field[0].historySummary.careerStartsInDataset, 3);
  assert.equal(predictionCase.evidence.field[0].recentRaces.some(run => run.race === races[3].name), false);
  assert.equal(predictionCase.outcome.winnerDriverId, 'chen');
});

test('future races are excluded by the target cutoff', () => {
  const races = demoRaces();
  const predictionCase = buildPredictionCase([races[0], races[2]], races[1]);
  for (const driver of predictionCase.evidence.field) {
    assert.equal(driver.recentRaces.some(run => run.race === races[2].name), false);
  }
});

test('probability normalization accepts rounding and rejects missing drivers', () => {
  const result = normalizeDistribution({ a: 0.49, b: 0.50 }, ['a', 'b']);
  assert.ok(Math.abs(result.a + result.b - 1) < 1e-12);
  assert.throws(() => normalizeDistribution({ a: 1 }, ['a', 'b']), /every driver/);
});

test('outcome metrics reward correct ranking', () => {
  const probabilities = { a: 0.7, b: 0.2, c: 0.1 };
  const outcome = { winnerDriverId: 'a', finishOrder: [
    { driverId: 'a', finishPosition: 1 }, { driverId: 'b', finishPosition: 2 }, { driverId: 'c', finishPosition: 3 },
  ] };
  const metrics = scorePrediction(probabilities, outcome);
  assert.equal(metrics.topPickCorrect, true);
  assert.equal(spearman(probabilities, outcome.finishOrder), 1);
  assert.ok(metrics.winnerLogLoss < 0.36);
});

test('all providers receive an identical cloned evidence object', async () => {
  const races = demoRaces();
  const predictionCase = buildPredictionCase(races, races[3]);
  const seen = [];
  const provider = name => ({ name, model: name, async predict(evidence) {
    seen.push(JSON.stringify(evidence));
    evidence.field[0].name = 'mutated';
    const probability = 1 / evidence.field.length;
    return { provider: name, model: name, probabilities: Object.fromEntries(evidence.field.map(row => [row.driverId, probability])), durationMs: 1, usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0, totalTokens: 2 } };
  } });
  await compareProviders(predictionCase, [provider('one'), provider('two')]);
  assert.equal(seen[0], seen[1]);
  assert.notEqual(predictionCase.evidence.field[0].name, 'mutated');
});

test('comparison emits provider progress and can retain a successful partial result', async () => {
  const races = demoRaces();
  const predictionCase = buildPredictionCase(races, races[3]);
  const events = [];
  const probability = 1 / predictionCase.evidence.field.length;
  const good = { name: 'good', model: 'good-v1', async predict(evidence) {
    return { provider: 'good', model: 'good-v1', probabilities: Object.fromEntries(evidence.field.map(row => [row.driverId, probability])), durationMs: 2, usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0, totalTokens: 2 } };
  } };
  const bad = { name: 'bad', model: 'bad-v1', async predict() { throw new Error('offline'); } };
  const comparison = await compareProviders(predictionCase, [bad, good], { continueOnError: true, onEvent: event => events.push(event.type) });
  // Every provider starts before any of them settles: that is the concurrency
  // guarantee. Which one settles first is a race, so only the set is asserted.
  assert.deepEqual(events.slice(0, 3), ['comparison.started', 'provider.started', 'provider.started']);
  assert.deepEqual(events.slice(3, 5).sort(), ['provider.completed', 'provider.failed']);
  assert.equal(events.at(-1), 'comparison.completed');
  assert.equal(comparison.records.length, 1);
  assert.equal(comparison.failures[0].message, 'offline');
});

test('providers run concurrently and records keep provider order, not finish order', async () => {
  const races = demoRaces();
  const predictionCase = buildPredictionCase(races, races[3]);
  const probability = 1 / predictionCase.evidence.field.length;
  const sleeper = (name, delayMs) => ({ name, model: `${name}-v1`, async predict(evidence) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return { provider: name, model: `${name}-v1`, probabilities: Object.fromEntries(evidence.field.map(row => [row.driverId, probability])), durationMs: delayMs, usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0, totalTokens: 2 } };
  } });
  const started = Date.now();
  const comparison = await compareProviders(predictionCase, [sleeper('slow', 120), sleeper('quick', 10)]);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 200, `expected overlapping execution, took ${elapsed}ms`);
  assert.deepEqual(comparison.records.map(record => record.provider), ['slow', 'quick']);
});

test('providers receive an activity channel that reaches the comparison event stream', async () => {
  const races = demoRaces();
  const predictionCase = buildPredictionCase(races, races[3]);
  const probability = 1 / predictionCase.evidence.field.length;
  const ticks = [];
  const chatty = { name: 'chatty', model: 'chatty-v1', async predict(evidence, { onActivity }) {
    onActivity({ phase: 'thinking', streamedChars: 40, estimatedOutputTokens: 10 });
    return { provider: 'chatty', model: 'chatty-v1', probabilities: Object.fromEntries(evidence.field.map(row => [row.driverId, probability])), durationMs: 1, usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0, totalTokens: 2 } };
  } };
  await compareProviders(predictionCase, [chatty], { onEvent: event => event.type === 'provider.activity' && ticks.push(event) });
  assert.deepEqual(ticks, [{ type: 'provider.activity', index: 0, provider: 'chatty', model: 'chatty-v1', phase: 'thinking', streamedChars: 40, estimatedOutputTokens: 10 }]);
});
