import { setTimeout as sleep } from 'node:timers/promises';
import { assert, finiteNumber, isoRaceTime } from './util.js';

function participant(row) {
  return {
    driverId: row.Driver.driverId,
    name: [row.Driver.givenName, row.Driver.familyName].filter(Boolean).join(' '),
    constructorId: row.Constructor.constructorId,
    constructorName: row.Constructor.name,
  };
}

function result(row) {
  const entry = participant(row);
  const parsedPosition = Number(row.position);
  return {
    ...entry,
    finishPosition: Number.isInteger(parsedPosition) && parsedPosition > 0 ? parsedPosition : null,
    grid: finiteNumber(row.grid, 'grid'),
    points: finiteNumber(row.points, 'points'),
    laps: finiteNumber(row.laps, 'laps'),
    status: String(row.status || 'Unknown'),
  };
}

function baseRace(row) {
  return {
    id: `${row.season}-${row.round}`,
    season: Number(row.season),
    round: Number(row.round),
    name: row.raceName,
    startsAt: isoRaceTime(row),
    circuit: {
      id: row.Circuit.circuitId,
      name: row.Circuit.circuitName,
      country: row.Circuit.Location?.country || 'Unknown',
    },
  };
}

export function mergeJolpicaPages(pages) {
  const races = new Map();
  for (const page of pages) {
    const rows = page?.MRData?.RaceTable?.Races;
    assert(Array.isArray(rows), 'Unexpected Jolpica response shape.');
    for (const row of rows) {
      const id = `${row.season}-${row.round}`;
      if (!races.has(id)) races.set(id, { ...baseRace(row), entrants: [], results: [] });
      const race = races.get(id);
      for (const rawResult of row.Results || []) {
        const normalized = result(rawResult);
        if (!race.results.some(item => item.driverId === normalized.driverId)) race.results.push(normalized);
      }
    }
  }
  for (const race of races.values()) {
    race.results.sort((a, b) => (a.finishPosition ?? 999) - (b.finishPosition ?? 999));
    race.entrants = race.results.map(({ driverId, name, constructorId, constructorName }) => ({ driverId, name, constructorId, constructorName }));
  }
  return [...races.values()].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export function normalizeNextRace(body) {
  const row = body?.MRData?.RaceTable?.Races?.[0];
  assert(row, 'Jolpica returned no upcoming race.');
  return { ...baseRace(row), entrants: [], results: [] };
}

export class JolpicaClient {
  constructor({ fetchImpl = fetch, sleepImpl = sleep, minIntervalMs = 300, retries = 3 } = {}) {
    this.fetch = fetchImpl;
    this.sleep = sleepImpl;
    this.minIntervalMs = minIntervalMs;
    this.retries = retries;
    this.lastRequestAt = 0;
  }

  async request(path, parameters = {}) {
    const url = new URL(`https://api.jolpi.ca/ergast/f1/${path}`);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      await this.sleep(Math.max(0, this.minIntervalMs - (Date.now() - this.lastRequestAt)));
      this.lastRequestAt = Date.now();
      let response;
      try {
        response = await this.fetch(url, {
          headers: { 'User-Agent': 'f1-jev-simulation/0.1.0' },
          signal: AbortSignal.timeout(30000),
          redirect: 'error',
        });
      } catch {
        throw new Error('Jolpica connection failed or timed out.');
      }
      if (response.ok) return response.json();
      await response.body?.cancel();
      const retryable = [429, 500, 502, 503, 504].includes(response.status);
      assert(retryable && attempt < this.retries, `Jolpica HTTP ${response.status}.`);
      const retryAfter = Number(response.headers.get('retry-after'));
      await this.sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * 2 ** attempt);
    }
  }

  async season(year) {
    assert(Number.isInteger(year) && year >= 1950 && year <= 2100, 'Season must be between 1950 and 2100.');
    const pages = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const page = await this.request(`${year}/results.json`, { limit: 100, offset });
      const mr = page?.MRData;
      assert(mr && Number.isFinite(Number(mr.total)), 'Jolpica response is missing pagination metadata.');
      pages.push(page);
      total = Number(mr.total);
      const count = [...(page.MRData.RaceTable?.Races || [])].reduce((sum, race) => sum + (race.Results?.length || 0), 0);
      assert(count > 0 || offset >= total, 'Jolpica pagination ended before total results were received.');
      offset += count;
    }
    return mergeJolpicaPages(pages);
  }

  async nextRace() {
    return normalizeNextRace(await this.request('current/next.json'));
  }
}
