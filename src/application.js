import { buildPredictionCase, buildUpcomingRace } from './evidence.js';
import { JolpicaClient } from './jolpica.js';
import { Store } from './store.js';
import { JevProvider } from './providers/jev.js';
import { CodexProvider } from './providers/codex.js';
import { assert, integerOption } from './util.js';

const allowedProviders = new Set(['jev', 'codex']);
const allowedReasoning = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

export function normalizeComparisonRequest(input = {}) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'Comparison request must be a JSON object.');
  const mode = input.mode || 'next';
  assert(mode === 'next' || mode === 'historical', 'mode must be next or historical.');
  const current = new Date().getUTCFullYear();
  const season = mode === 'historical' ? integerOption(input.season, NaN, 'season', 1950, 2100) : null;
  const round = mode === 'historical' ? integerOption(input.round, NaN, 'round', 1, 40) : null;
  const upperYear = season ?? current;
  const historyFrom = integerOption(input.historyFrom, Math.max(1950, upperYear - 4), 'historyFrom', 1950, upperYear);
  const providers = Array.isArray(input.providers) ? [...new Set(input.providers)] : ['jev', 'codex'];
  assert(providers.length >= 1 && providers.length <= 2 && providers.every(name => allowedProviders.has(name)), 'providers must contain jev, codex, or both.');
  const models = Array.isArray(input.models) && input.models.length ? [...new Set(input.models)] : [process.env.CODEX_MODEL || 'gpt-5.6-luna'];
  assert(models.length <= 4 && models.every(model => typeof model === 'string' && /^[A-Za-z0-9._-]+$/.test(model)), 'Supply at most four valid OpenAI model ids.');
  const reasoning = input.reasoning || process.env.CODEX_REASONING_EFFORT || 'low';
  assert(allowedReasoning.has(reasoning), 'Unsupported OpenAI reasoning effort.');
  return { mode, season, round, historyFrom, providers, models, reasoning };
}

export function providersForRequest(request) {
  const providers = [];
  if (request.providers.includes('jev')) providers.push(new JevProvider());
  if (request.providers.includes('codex')) {
    providers.push(...request.models.map(model => new CodexProvider({ model, reasoningEffort: request.reasoning })));
  }
  return providers;
}

export async function loadSeasonRange(from, to, { store = new Store(), client = new JolpicaClient(), refresh = false, refreshCurrent = false, onProgress = () => {} } = {}) {
  const races = [];
  for (let year = from; year <= to; year++) {
    let record = refresh || (refreshCurrent && year === new Date().getUTCFullYear()) ? null : await store.getSeason(year);
    if (!record) {
      await onProgress({ stage: 'season.collecting', year });
      const collected = await client.season(year);
      await store.putSeason(year, collected);
      record = { races: collected };
      await onProgress({ stage: 'season.collected', year, races: collected.length });
    } else {
      await onProgress({ stage: 'season.cached', year, races: record.races.length });
    }
    races.push(...record.races);
  }
  return races.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export async function preparePrediction(requestInput, { store = new Store(), client = new JolpicaClient(), onProgress = () => {} } = {}) {
  const request = normalizeComparisonRequest(requestInput);
  if (request.mode === 'historical') {
    const races = await loadSeasonRange(request.historyFrom, request.season, { store, client, onProgress });
    const target = races.find(race => race.season === request.season && race.round === request.round);
    assert(target, `No result found for ${request.season} round ${request.round}.`);
    return { request, predictionCase: buildPredictionCase(races, target), note: null };
  }
  await onProgress({ stage: 'next-race.loading' });
  const next = await client.nextRace();
  const historyFrom = Math.min(request.historyFrom, next.season);
  const races = await loadSeasonRange(historyFrom, next.season, { store, client, refreshCurrent: true, onProgress });
  const target = buildUpcomingRace(next, races);
  return { request: { ...request, historyFrom }, predictionCase: buildPredictionCase(races, target), note: target.fieldSource };
}
