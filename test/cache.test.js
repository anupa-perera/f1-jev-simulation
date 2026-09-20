import test from 'node:test';
import assert from 'node:assert/strict';
import { withPredictionCache } from '../src/providers/cached.js';
import { buildPredictionCase } from '../src/evidence.js';
import { demoRaces } from '../src/demo-data.js';
import { runRoundsLoop } from '../src/rounds.js';

function memoryStore() {
  const files = new Map();
  return {
    files,
    async getPrediction(key) { return files.get(key) ?? null; },
    async putPrediction(key, value) { files.set(key, JSON.parse(JSON.stringify(value))); },
  };
}

function countingProvider() {
  let calls = 0;
  return {
    name: 'fake',
    model: 'fake-1',
    get calls() { return calls; },
    async predict(evidence) {
      calls += 1;
      return {
        provider: 'fake',
        model: 'fake-1',
        probabilities: Object.fromEntries(evidence.field.map((driver, index) => [driver.driverId, index === 0 ? 0.7 : 0.1])),
        durationMs: 4200,
        usage: { inputTokens: 9, cachedInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0, totalTokens: 10 },
      };
    },
    async diagnose() {
      calls += 1;
      return { cause: 'leading_group_not_separated', confidence: 0.5, durationMs: 100, usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0, totalTokens: 2 } };
    },
  };
}

test('an identical question is answered from the cache and marked as replayed', async () => {
  const store = memoryStore();
  const provider = countingProvider();
  const cached = withPredictionCache(provider, store);
  const { evidence } = buildPredictionCase(demoRaces(), demoRaces()[3]);

  const first = await cached.predict(evidence);
  assert.equal(provider.calls, 1);
  assert.equal(first.metadata?.cached, undefined, 'the measured call is not a replay');

  const second = await cached.predict(evidence);
  assert.equal(provider.calls, 1, 'the second identical question must not reach the provider');
  assert.equal(second.metadata.cached, true);
  assert.deepEqual(second.probabilities, first.probabilities);
  assert.equal(second.durationMs, 4200, 'a replay keeps the duration of the original call');
});

test('a changed lesson or window misses the cache', async () => {
  const store = memoryStore();
  const provider = countingProvider();
  const cached = withPredictionCache(provider, store);
  const races = demoRaces();
  await cached.predict(buildPredictionCase(races, races[3]).evidence);
  await cached.predict(buildPredictionCase(races, races[3], { priorLessons: [{ cause: 'x', lesson: 'y', timesObserved: 1 }] }).evidence);
  assert.equal(provider.calls, 2, 'priorLessons are part of the evidence, so they change the key');
  await cached.predict(buildPredictionCase(races, races[3], { recentWindow: 2 }).evidence);
  assert.equal(provider.calls, 3);
});

test('a second identical ladder costs no provider calls', async () => {
  const store = memoryStore();
  const provider = countingProvider();
  const cached = withPredictionCache(provider, store);
  const races = demoRaces();
  const first = await runRoundsLoop(cached, { races, target: races[3], ladder: 3 });
  const spent = provider.calls;
  assert.ok(spent >= 4, 'the first ladder pays for its rounds');

  const second = await runRoundsLoop(cached, { races, target: races[3], ladder: 3 });
  assert.equal(provider.calls, spent, 'the repeat ladder must not call the provider at all');
  assert.deepEqual(second.record.probabilities, first.record.probabilities);
  assert.deepEqual(second.ledger, first.ledger, 'the same diagnoses produce the same corrections');
  assert.equal(second.record.metadata.cached, true);
});

test('a provider without diagnose keeps no diagnose method through the wrapper', () => {
  const bare = { name: 'bare', model: 'bare-1', async predict() {} };
  assert.equal(typeof withPredictionCache(bare, memoryStore()).diagnose, 'undefined');
});
