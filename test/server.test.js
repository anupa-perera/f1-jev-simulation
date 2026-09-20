import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPredictionCase } from '../src/evidence.js';
import { demoRaces } from '../src/demo-data.js';
import { DemoProvider } from '../src/providers/demo.js';
import { createDashboardServer } from '../src/server.js';

function memoryStore() {
  const runs = [];
  return {
    runs,
    async listRuns() { return [...runs]; },
    async putRun(comparison) { runs.push(comparison); return `memory://${comparison.id}`; },
  };
}

async function readUntil(reader, pattern, timeoutMs = 2_000) {
  const decoder = new TextDecoder();
  let output = '';
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}`)), timeoutMs));
  const consume = (async () => {
    while (!pattern.test(output)) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    return output;
  })();
  return Promise.race([consume, timeout]);
}

test('dashboard API streams provider progress and stores the completed comparison', async t => {
  const store = memoryStore();
  const races = demoRaces();
  const predictionCase = buildPredictionCase(races.slice(0, 3), races[3]);
  const app = createDashboardServer({
    store,
    async prepare(request, { onProgress }) {
      await onProgress({ stage: 'season.cached', year: 2026, races: 3 });
      return { request, predictionCase, note: null };
    },
    createProviders() { return [new DemoProvider('demo-jev'), new DemoProvider('demo-openai', 1)]; },
  });
  const address = await app.listen({ port: 0 });
  t.after(() => app.close());

  const page = await fetch(address.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /F1 Jev Live Bench/);

  const stream = await fetch(`${address.url}/api/events`);
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  const reader = stream.body.getReader();
  t.after(() => reader.cancel());

  const response = await fetch(`${address.url}/api/compare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'next', historyFrom: 2022, providers: ['jev'] }),
  });
  assert.equal(response.status, 202);
  const accepted = await response.json();
  assert.match(accepted.runId, /^run-/);
  // The roster is returned before any model runs, so the browser can draw one
  // panel per provider while race evidence is still loading.
  assert.deepEqual(accepted.roster, [
    { index: 0, provider: 'demo-jev', model: 'simulated-demo-jev-v1' },
    { index: 1, provider: 'demo-openai', model: 'simulated-demo-openai-v1' },
  ]);

  const events = await readUntil(reader, /event: run\.completed/);
  assert.match(events, /event: run\.accepted/);
  assert.ok(events.indexOf('event: run.accepted') < events.indexOf('event: provider.started'), 'roster must reach clients before any provider starts');
  assert.match(events, /event: run\.started/);
  assert.match(events, /event: provider\.started/);
  assert.match(events, /event: provider\.completed/);
  assert.equal(store.runs.length, 1);
  assert.equal(store.runs[0].records.length, 2);

  const state = await fetch(`${address.url}/api/state`).then(result => result.json());
  assert.equal(state.activeRun, null);
  assert.equal(state.lastRun.status, 'completed');
  assert.equal(state.lastRun.successfulProviders, 2);

  const runs = await fetch(`${address.url}/api/runs`);
  assert.equal(runs.status, 200);
  const payload = await runs.json();
  assert.equal(payload.comparisons.length, 1);
  assert.equal(payload.comparisons[0].target.raceName, 'Demo Grand Prix 4');
});

test('the server runs every model at once, not one after another', async t => {
  const races = demoRaces();
  const predictionCase = buildPredictionCase(races.slice(0, 3), races[3]);
  // Each model takes the same visible time, so a sequential server would finish
  // the first before the third had started.
  const slow = index => {
    const demo = new DemoProvider(`model-${index}`, index);
    return { name: 'openai-codex', model: `model-${index}`, async predict(evidence) {
      await new Promise(resolve => setTimeout(resolve, 150));
      return { ...(await demo.predict(evidence)), provider: 'openai-codex', model: `model-${index}` };
    } };
  };
  const app = createDashboardServer({
    store: memoryStore(),
    async prepare(request) { return { request, predictionCase, note: null }; },
    createProviders() { return [slow(0), slow(1), slow(2)]; },
  });
  const address = await app.listen({ port: 0 });
  t.after(() => app.close());

  const stream = await fetch(`${address.url}/api/events`);
  const reader = stream.body.getReader();
  t.after(() => reader.cancel());

  await fetch(`${address.url}/api/compare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'next', historyFrom: 2022, providers: ['codex'], models: ['a', 'b', 'c'] }),
  });
  const events = await readUntil(reader, /event: run\.completed/, 5_000);
  const starts = [...events.matchAll(/event: provider\.started/g)].map(match => match.index);
  const firstCompletion = events.indexOf('event: provider.completed');
  assert.equal(starts.length, 3);
  assert.ok(starts[2] < firstCompletion, 'every model must start before any of them finishes');
});

test('a client connecting mid-run still receives the provider roster', async t => {
  const races = demoRaces();
  const predictionCase = buildPredictionCase(races.slice(0, 3), races[3]);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const slow = new DemoProvider('demo-openai', 1);
  const app = createDashboardServer({
    store: memoryStore(),
    async prepare(request) { return { request, predictionCase, note: null }; },
    createProviders() {
      return [{ name: slow.name, model: slow.model, async predict(evidence) { await held; return slow.predict(evidence); } }];
    },
  });
  const address = await app.listen({ port: 0 });
  t.after(() => { release(); return app.close(); });

  await fetch(`${address.url}/api/compare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'next', historyFrom: 2022, providers: ['jev'] }),
  });

  // Subscribing after the run was accepted: the roster arrives through the
  // replayed event log, so a reloaded tab draws the same panels.
  const stream = await fetch(`${address.url}/api/events`);
  const reader = stream.body.getReader();
  t.after(() => reader.cancel());
  const events = await readUntil(reader, /event: run\.accepted/);
  assert.match(events, /"model":"simulated-demo-openai-v1"/);
  release();
});

test('dashboard API rejects invalid comparisons before accepting a run', async t => {
  const app = createDashboardServer({ store: memoryStore() });
  const address = await app.listen({ port: 0 });
  t.after(() => app.close());
  const response = await fetch(`${address.url}/api/compare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'historical' }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /season/);
});
