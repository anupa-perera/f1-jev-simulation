import { spawn } from 'node:child_process';
import { buildPredictionCase, buildUpcomingRace } from './evidence.js';
import { JolpicaClient } from './jolpica.js';
import { compareProviders, benchmarkSummary, formatBenchmark, formatComparison } from './compare.js';
import { runRoundsLoop, formatRoundsTrace } from './rounds.js';
import { Store } from './store.js';
import { renderDashboard } from './dashboard.js';
import { loadSeasonRange, normalizeComparisonRequest, providersForRequest } from './application.js';
import { startDashboardServer } from './server.js';
import { DemoProvider } from './providers/demo.js';
import { withPredictionCache } from './providers/cached.js';
import { codexInvocation } from './providers/codex.js';
import { demoRaces } from './demo-data.js';
import { assert, hash, integerOption, parseArgs } from './util.js';

function help() {
  return `f1-jev-simulation

Commands:
  npm run demo
  npm run status
  npm run collect -- -- --from=2023 --to=2026
  npm run compare -- -- --season=2025 --round=12 --history-from=2021 --providers=jev,codex --models=gpt-5.6-luna
  npm run next -- -- --history-from=2022 --providers=jev,codex --models=gpt-5.6-luna,gpt-5.6-terra
  npm run benchmark -- -- --season=2025 --from-round=10 --to-round=12 --max-races=3 --providers=jev,codex
  npm run rounds -- -- --season=2025 --round=20 --ladder=4 --providers=jev
  npm run rounds -- -- --next --ladder=4 --providers=jev
  npm run rounds -- -- --demo
  add --cache to any live command to replay answers already measured for identical evidence
  npm run dashboard -- -- --port=4317
  npm run dashboard:export     (add -- -- --demo to export simulated data)

Data and run records default to ~/.codex/f1-jev-simulation.`;
}

async function codexLoginStatus() {
  const invocation = codexInvocation();
  return new Promise(resolve => {
    const child = spawn(invocation.command, [...invocation.prefixArgs, 'login', 'status'], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', chunk => { text += chunk; });
    child.stderr.on('data', chunk => { text += chunk; });
    child.on('error', error => resolve(`unavailable (${error.message})`));
    child.on('close', () => resolve(text.trim() || 'unknown'));
  });
}

function providersFrom(options, store) {
  const names = String(options.providers || 'jev,codex').split(',').map(value => value.trim()).filter(Boolean);
  const models = String(options.models || process.env.CODEX_MODEL || 'gpt-5.6-luna').split(',').map(value => value.trim()).filter(Boolean);
  const request = normalizeComparisonRequest({ mode: 'next', providers: names, models, reasoning: options.reasoning || process.env.CODEX_REASONING_EFFORT || 'low' });
  const providers = providersForRequest(request);
  // Off by default: a replayed answer carries the timing and tokens of the call
  // that produced it, which is exactly what this tool exists to measure.
  if (options.cache !== true) return providers;
  console.log('Prediction cache ON: repeated questions are replayed, and timing and token counts come from the original calls.');
  return providers.map(provider => withPredictionCache(provider, store));
}

async function seasonRange(from, to, { store, client, refresh = false, refreshCurrent = false } = {}) {
  return loadSeasonRange(from, to, { store, client, refresh, refreshCurrent, onProgress(progress) {
    if (progress.stage === 'season.collected') console.log(`Collected ${progress.year}: ${progress.races} races`);
  } });
}

async function run() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);
  const store = new Store();
  if (command === 'help' || options.help) return console.log(help());
  if (command === 'status') {
    console.log(`TypeSafe key: ${process.env.TYPESAFE_API_KEY ? 'configured' : 'missing'}`);
    console.log(`TypeSafe model: ${process.env.TYPESAFE_MODEL || 'jev-1.13.0'}`);
    console.log(`Codex: ${await codexLoginStatus()}`);
    console.log(`Data directory: ${store.root}`);
    return;
  }
  if (command === 'demo') {
    const races = demoRaces();
    const predictionCase = buildPredictionCase(races.slice(0, 3), races[3]);
    const comparison = await compareProviders(predictionCase, [new DemoProvider('demo-jev'), new DemoProvider('demo-openai', 1)]);
    console.log(formatComparison(comparison));
    return;
  }
  if (command === 'dashboard') {
    const port = integerOption(options.port, Number(process.env.F1_JEV_PORT || 4317), 'port', 1, 65535);
    const dashboardServer = await startDashboardServer({ store, port, host: '127.0.0.1' });
    console.log(`Live dashboard: ${dashboardServer.address.url}`);
    console.log('Press Ctrl+C to stop.');
    const shutdown = async () => {
      await dashboardServer.close();
      process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return;
  }
  if (command === 'export-dashboard') {
    const comparisons = options.demo === true
      ? [await compareProviders(buildPredictionCase(demoRaces().slice(0, 3), demoRaces()[3]), [new DemoProvider('demo-jev'), new DemoProvider('demo-openai', 1)])]
      : await store.listRuns();
    const path = await store.putDashboard(renderDashboard(comparisons));
    console.log(`Dashboard: ${comparisons.length} run record(s) rendered to ${path}`);
    return;
  }
  const client = new JolpicaClient();
  if (command === 'collect') {
    const current = new Date().getUTCFullYear();
    const from = integerOption(options.from, current - 4, 'from', 1950, 2100);
    const to = integerOption(options.to, current, 'to', from, 2100);
    const races = await seasonRange(from, to, { store, client, refresh: options.refresh === true });
    console.log(`Available locally: ${races.length} races from ${from}–${to}`);
    return;
  }
  if (command === 'compare') {
    const season = integerOption(options.season, NaN, 'season', 1950, 2100);
    const round = integerOption(options.round, NaN, 'round', 1, 40);
    const historyFrom = integerOption(options['history-from'], Math.max(1950, season - 4), 'history-from', 1950, season);
    const races = await seasonRange(historyFrom, season, { store, client });
    const target = races.find(race => race.season === season && race.round === round);
    assert(target, `No result found for ${season} round ${round}.`);
    const comparison = await compareProviders(buildPredictionCase(races, target), providersFrom(options, store));
    const path = await store.putRun(comparison);
    console.log(formatComparison(comparison));
    console.log(`Saved: ${path}`);
    return;
  }
  if (command === 'next') {
    const next = await client.nextRace();
    const historyFrom = integerOption(options['history-from'], Math.max(1950, next.season - 4), 'history-from', 1950, next.season);
    const races = await seasonRange(historyFrom, next.season, { store, client, refreshCurrent: true });
    const target = buildUpcomingRace(next, races);
    const comparison = await compareProviders(buildPredictionCase(races, target), providersFrom(options, store));
    const path = await store.putRun(comparison);
    console.log(`${target.fieldSource}\n`);
    console.log(formatComparison(comparison));
    console.log(`Saved: ${path}`);
    return;
  }
  if (command === 'benchmark') {
    const season = integerOption(options.season, NaN, 'season', 1950, 2100);
    const historyFrom = integerOption(options['history-from'], Math.max(1950, season - 4), 'history-from', 1950, season);
    const fromRound = integerOption(options['from-round'], 1, 'from-round', 1, 40);
    const toRound = integerOption(options['to-round'], 40, 'to-round', fromRound, 40);
    const maxRaces = integerOption(options['max-races'], 3, 'max-races', 1, 30);
    const races = await seasonRange(historyFrom, season, { store, client });
    const targets = races.filter(race => race.season === season && race.round >= fromRound && race.round <= toRound).slice(0, maxRaces);
    assert(targets.length > 0, 'No benchmark races match the requested range.');
    const providers = providersFrom(options, store);
    const comparisons = [];
    for (const target of targets) {
      const comparison = await compareProviders(buildPredictionCase(races, target), providers);
      await store.putRun(comparison);
      comparisons.push(comparison);
      console.log(formatComparison(comparison));
    }
    console.log(formatBenchmark(benchmarkSummary(comparisons)));
    return;
  }
  if (command === 'rounds') {
    const ladder = integerOption(options.ladder, 4, 'ladder', 1, 20);
    const recentWindow = integerOption(options['recent-window'], 3, 'recent-window', 1, 30);
    let races;
    let target;
    let providers;
    if (options.demo === true) {
      races = demoRaces();
      target = races[races.length - 1];
      // Two simulated providers so the offline demo exercises the concurrent
      // multi-provider fan-out, not just a single ladder.
      providers = [new DemoProvider('demo-jev'), new DemoProvider('demo-openai', 1)];
    } else if (options.next === true) {
      const next = await client.nextRace();
      const historyFrom = integerOption(options['history-from'], Math.max(1950, next.season - 4), 'history-from', 1950, next.season);
      races = await seasonRange(historyFrom, next.season, { store, client, refreshCurrent: true });
      target = buildUpcomingRace(next, races);
      providers = providersFrom(options, store);
      console.log(`${target.fieldSource}
`);
    } else {
      const season = integerOption(options.season, NaN, 'season', 1950, 2100);
      const round = integerOption(options.round, NaN, 'round', 1, 40);
      const historyFrom = integerOption(options['history-from'], Math.max(1950, season - 4), 'history-from', 1950, season);
      races = await seasonRange(historyFrom, season, { store, client });
      target = races.find(race => race.season === season && race.round === round);
      assert(target, `No result found for ${season} round ${round}.`);
      providers = providersFrom(options, store);
    }
    // The cold case is built without lessons. Its hash is the comparison-level
    // identity; each provider's own primed evidence hash lives on its record.
    const coldCase = buildPredictionCase(races, target, { recentWindow });
    // A ladder must walk its own rounds in order, because each round learns from
    // the one before it. The ladders themselves are independent, so providers run
    // concurrently and the command costs the slowest ladder, not their sum.
    const many = providers.length > 1;
    const settled = await Promise.allSettled(providers.map(provider => runRoundsLoop(provider, { races, target, recentWindow, ladder,
      onEvent: event => { if (event.type === 'round.started') console.log(`  ${many ? `${event.model} · ` : ''}round ${event.round}: ${event.raceName}`); } })));
    const loops = [];
    const failures = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') loops.push(result.value);
      // One provider failing must not discard the rounds its siblings already paid for.
      else failures.push({ index, provider: providers[index].name, model: providers[index].model, message: result.reason.message });
    });
    assert(loops.length > 0, `Every provider failed: ${failures.map(failure => `${failure.provider}/${failure.model}: ${failure.message}`).join('; ')}`);
    // Traces print after every ladder settles so each block stays intact.
    for (const loop of loops) {
      console.log('');
      console.log(formatRoundsTrace(loop));
      console.log('');
    }
    for (const failure of failures) console.log(`${failure.provider} / ${failure.model} failed: ${failure.message}`);
    const records = loops.map(loop => loop.record);
    const comparison = {
      id: `comparison-${hash({ evidenceHash: coldCase.evidenceHash, records }).slice(0, 24)}`,
      protocol: 'rounds',
      target: coldCase.evidence.target,
      snapshotAt: coldCase.evidence.snapshotAt,
      evidenceHash: coldCase.evidenceHash,
      outcome: coldCase.outcome,
      records,
      failures,
      rounds: loops.map(({ record, predictionCase, ...rest }) => rest),
    };
    console.log(formatComparison(comparison));
    console.log('Each provider carried its own corrections, so these records share a protocol, not identical evidence.');
    if (options.demo === true) console.log('Simulated run: nothing was saved.');
    else console.log(`Saved: ${await store.putRun(comparison)}`);
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${help()}`);
}

run().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
