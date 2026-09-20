import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { preparePrediction, normalizeComparisonRequest, providersForRequest } from './application.js';
import { compareProviders } from './compare.js';
import { readDashboardFont, renderLiveDashboard, runData } from './dashboard.js';
import { JolpicaClient } from './jolpica.js';
import { Store } from './store.js';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function respondJson(response, status, value) {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(value));
}

function progressMessage(progress) {
  if (progress.stage === 'next-race.loading') return 'Loading the next scheduled race';
  if (progress.stage === 'season.collecting') return `Downloading ${progress.year} race history`;
  if (progress.stage === 'season.collected') return `Collected ${progress.races} races from ${progress.year}`;
  if (progress.stage === 'season.cached') return `Loaded ${progress.races} cached races from ${progress.year}`;
  return 'Preparing race evidence';
}

async function readJson(request, maximumBytes = 64 * 1024) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maximumBytes) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

export function createDashboardServer({
  store = new Store(),
  client = new JolpicaClient(),
  prepare = preparePrediction,
  createProviders = providersForRequest,
  compare = compareProviders,
} = {}) {
  const eventClients = new Set();
  let activeRun = null;
  let lastRun = null;
  let activeEventLog = [];

  function sendLive(type, payload) {
    const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of eventClients) response.write(frame);
    return frame;
  }

  function broadcast(type, payload) {
    const frame = sendLive(type, payload);
    if (payload.runId && activeRun?.runId === payload.runId) activeEventLog.push(frame);
  }

  async function executeRun(runId, request, providers) {
    try {
      const prepared = await prepare(request, {
        store,
        client,
        onProgress(progress) {
          broadcast('run.progress', { runId, ...progress, message: progressMessage(progress) });
        },
      });
      activeRun = { ...activeRun, target: prepared.predictionCase.evidence.target, stage: 'predicting' };
      broadcast('run.started', {
        runId,
        target: prepared.predictionCase.evidence.target,
        snapshotAt: prepared.predictionCase.evidence.snapshotAt,
        evidenceHash: prepared.predictionCase.evidenceHash,
        note: prepared.note,
      });
      const comparison = await compare(prepared.predictionCase, providers, {
        continueOnError: true,
        onEvent(event) {
          if (event.type === 'provider.started' || event.type === 'provider.completed' || event.type === 'provider.failed') {
            broadcast(event.type, { runId, ...event });
          } else if (event.type === 'provider.activity') {
            // A high-rate live ticker. Connected clients get it, but it stays out
            // of the replay log so a late subscriber rebuilds from run state
            // instead of thousands of stale frames.
            sendLive(event.type, { runId, ...event });
          }
        },
      });
      const path = await store.putRun(comparison);
      lastRun = {
        runId,
        status: 'completed',
        comparisonId: comparison.id,
        successfulProviders: comparison.records.length,
        failures: comparison.failures,
        completedAt: new Date().toISOString(),
      };
      broadcast('run.completed', {
        runId,
        comparisonId: comparison.id,
        successfulProviders: comparison.records.length,
        failures: comparison.failures,
        savedTo: path,
      });
    } catch (error) {
      lastRun = { runId, status: 'failed', message: error.message, completedAt: new Date().toISOString() };
      broadcast('run.failed', { runId, message: error.message });
    } finally {
      activeRun = null;
    }
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/') {
        const html = renderLiveDashboard();
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          // font-src must be explicit: the bundled Inter weights are data: URIs,
          // and without it they fall back to default-src 'self' and are blocked.
          'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self' data:",
          'x-content-type-options': 'nosniff',
        });
        response.end(html);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/health') {
        respondJson(response, 200, { ok: true, active: Boolean(activeRun) });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        respondJson(response, 200, { activeRun, lastRun });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/runs') {
        respondJson(response, 200, runData(await store.listRuns()));
        return;
      }
      // Round names for the comparison form. Reads the local season cache only
      // and never collects: typing in a year field must not be able to trigger
      // a Jolpica download (invariant 14). An uncollected season answers 404 and
      // the form falls back to a plain round number.
      if (request.method === 'GET' && url.pathname.startsWith('/api/seasons/')) {
        const year = Number(url.pathname.slice('/api/seasons/'.length));
        if (!Number.isInteger(year) || year < 1950 || year > 2100) {
          respondJson(response, 400, { error: 'season must be an integer between 1950 and 2100.' });
          return;
        }
        const record = await store.getSeason(year);
        if (!record) {
          respondJson(response, 404, { error: `Season ${year} has not been collected yet.`, year });
          return;
        }
        respondJson(response, 200, {
          year,
          collectedAt: record.collectedAt ?? null,
          races: record.races.map(race => ({
            round: race.round,
            name: race.name,
            // Flattened to a label here: the cache holds {id,name,country} and
            // the form only ever renders it as text.
            circuit: [race.circuit?.name, race.circuit?.country].filter(Boolean).join(', ') || null,
            startsAt: race.startsAt,
            // Only a finished race can be scored, so the form marks the rest.
            hasResult: Array.isArray(race.results) && race.results.length > 0,
          })),
        });
        return;
      }
      // Netflix Sans is never bundled. If a licensed copy is dropped into
      // ui/public/fonts it is served from here; otherwise the browser falls back.
      if (request.method === 'GET' && url.pathname.startsWith('/fonts/')) {
        const font = readDashboardFont(url.pathname.slice('/fonts/'.length));
        if (!font) {
          respondJson(response, 404, { error: 'Not found.' });
          return;
        }
        response.writeHead(200, {
          'content-type': 'font/woff2',
          'cache-control': 'public, max-age=86400',
          'x-content-type-options': 'nosniff',
        });
        response.end(font);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        response.write(`event: connected\ndata: ${JSON.stringify({ activeRun, lastRun })}\n\n`);
        if (activeRun) for (const frame of activeEventLog) response.write(frame);
        eventClients.add(response);
        request.on('close', () => eventClients.delete(response));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/compare') {
        if (activeRun) {
          respondJson(response, 409, { error: 'A comparison is already running.', activeRun });
          return;
        }
        const comparisonRequest = normalizeComparisonRequest(await readJson(request));
        // Providers are built before the run is accepted so the browser can draw
        // one panel per model immediately, and so a misconfigured provider fails
        // the request instead of failing silently minutes later.
        const providers = createProviders(comparisonRequest);
        const roster = providers.map((provider, index) => ({ index, provider: provider.name, model: provider.model }));
        const runId = `run-${randomUUID()}`;
        activeRun = { runId, request: comparisonRequest, roster, stage: 'preparing', acceptedAt: new Date().toISOString() };
        activeEventLog = [];
        respondJson(response, 202, { runId, status: 'accepted', roster });
        broadcast('run.accepted', { runId, roster });
        setImmediate(() => executeRun(runId, comparisonRequest, providers));
        return;
      }
      respondJson(response, 404, { error: 'Not found.' });
    } catch (error) {
      respondJson(response, error.statusCode || 400, { error: error.message });
    }
  });

  const heartbeat = setInterval(() => {
    for (const response of eventClients) response.write(': heartbeat\n\n');
  }, 15_000);
  heartbeat.unref();

  return {
    server,
    getActiveRun: () => activeRun,
    getLastRun: () => lastRun,
    listen({ host = '127.0.0.1', port = 4317 } = {}) {
      return new Promise((resolve, reject) => {
        const onError = error => reject(error);
        server.once('error', onError);
        server.listen(port, host, () => {
          server.off('error', onError);
          const address = server.address();
          resolve({ host, port: address.port, url: `http://${host}:${address.port}` });
        });
      });
    },
    close() {
      clearInterval(heartbeat);
      for (const response of eventClients) response.end();
      eventClients.clear();
      return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

export async function startDashboardServer(options = {}) {
  const dashboardServer = createDashboardServer(options);
  const address = await dashboardServer.listen(options);
  return { ...dashboardServer, address };
}
