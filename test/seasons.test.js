import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardServer } from '../src/server.js';

/** The comparison form reads round names from the local season cache. This
 *  store records every lookup so the tests can prove the route never collects. */
function seasonStore(seasons = {}) {
  const asked = [];
  return {
    asked,
    async listRuns() { return []; },
    async putRun(comparison) { return `memory://${comparison.id}`; },
    async getSeason(year) {
      asked.push(year);
      return seasons[year] ?? null;
    },
  };
}

const season2025 = {
  collectedAt: '2026-01-01T00:00:00.000Z',
  races: [
    {
      round: 1,
      name: 'Australian Grand Prix',
      circuit: { id: 'albert_park', name: 'Albert Park Grand Prix Circuit', country: 'Australia' },
      startsAt: '2025-03-16T04:00:00.000Z',
      results: [{ driverId: 'norris', finishPosition: 1 }],
    },
    {
      round: 2,
      name: 'Chinese Grand Prix',
      circuit: { id: 'shanghai', name: 'Shanghai International Circuit', country: 'China' },
      startsAt: '2025-03-23T07:00:00.000Z',
      results: [],
    },
  ],
};

async function serve(t, store) {
  const app = createDashboardServer({ store });
  const address = await app.listen({ port: 0 });
  t.after(() => app.close());
  return address.url;
}

test('a collected season answers with named rounds and a flattened circuit label', async t => {
  const store = seasonStore({ 2025: season2025 });
  const url = await serve(t, store);

  const response = await fetch(`${url}/api/seasons/2025`);
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.year, 2025);
  assert.deepEqual(
    body.races.map(race => race.name),
    ['Australian Grand Prix', 'Chinese Grand Prix'],
  );
  // The cache holds a circuit object; the form renders text, so a raw object
  // here would be thrown straight at React as a child and crash the page.
  assert.equal(body.races[0].circuit, 'Albert Park Grand Prix Circuit, Australia');
  assert.equal(typeof body.races[0].circuit, 'string');
  // Only a finished race can be scored, so the form needs to tell them apart.
  assert.equal(body.races[0].hasResult, true);
  assert.equal(body.races[1].hasResult, false);
});

test('an uncollected season reports 404 and never triggers a download', async t => {
  const store = seasonStore({});
  const url = await serve(t, store);

  const response = await fetch(`${url}/api/seasons/1975`);
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /not been collected/);
  // Reading the cache is the whole contract: typing a year in the form must
  // never be able to start a Jolpica collection (invariant 14).
  assert.deepEqual(store.asked, [1975]);
});

test('an out-of-range or non-numeric season is rejected before touching the store', async t => {
  const store = seasonStore({});
  const url = await serve(t, store);

  for (const path of ['abc', '1949', '2101', '', '2025.5']) {
    const response = await fetch(`${url}/api/seasons/${path}`);
    assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(path)}`);
  }
  assert.deepEqual(store.asked, []);
});
