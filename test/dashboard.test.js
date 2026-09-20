import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPredictionCase } from '../src/evidence.js';
import { demoRaces } from '../src/demo-data.js';
import { compareProviders } from '../src/compare.js';
import { DemoProvider } from '../src/providers/demo.js';
import { dashboardShell, renderDashboard, renderLiveDashboard, runData } from '../src/dashboard.js';
import { createDashboardServer } from '../src/server.js';

async function demoComparison() {
  const races = demoRaces();
  return compareProviders(buildPredictionCase(races.slice(0, 3), races[3]), [
    new DemoProvider('demo-jev'),
    new DemoProvider('demo-openai', 1),
  ]);
}

/** The injected data script is the first one in the document, because the marker
 *  sits ahead of the bundle. Assertions target it rather than the whole file:
 *  the bundle's own source mentions these globals, so a plain `html.includes`
 *  would pass or fail for reasons that have nothing to do with the payload. */
function injectedScript(html) {
  const match = html.match(/<script>(.*?)<\/script>/s);
  assert.ok(match, 'no data script was injected');
  return match[1];
}

/** Recovers the payload the browser would see, so assertions test what actually
 *  reaches `window`, not merely what appears somewhere in the HTML text. */
function injectedPayload(html, name) {
  const match = injectedScript(html).match(new RegExp(`window\\.${name}=(.*?);(?:window\\.|$)`, 's'));
  assert.ok(match, `${name} was not injected`);
  return JSON.parse(match[1]);
}

test('the exported report inlines run data the browser can parse back', async () => {
  const comparison = await demoComparison();
  const html = renderDashboard([comparison], { generatedAt: '2026-01-01T00:00:00.000Z' });
  const payload = injectedPayload(html, '__F1_RUNS__');

  assert.equal(payload.generatedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(payload.comparisons.length, 1);
  assert.deepEqual(
    payload.summary.map(row => row.providerModel).sort(),
    ['demo-jev:simulated-demo-jev-v1', 'demo-openai:simulated-demo-openai-v1'],
  );
  // The static report must not depend on a server being there to answer.
  assert.equal(injectedScript(html).includes('__F1_DEFAULTS__'), false);
});

test('untrusted names cannot break out of the injected script block', async () => {
  const comparison = await demoComparison();
  const breakout = '</script><img src=x onerror=alert(1)>';
  comparison.target.raceName = breakout;
  comparison.records[0].ranking[0].name = breakout;

  const html = renderDashboard([comparison]);
  const script = injectedScript(html);

  // The payload may well contain the words `onerror=alert(1)` — inert text is
  // harmless. What must never survive is a tag that ends the block early, so
  // the angle brackets are what this asserts on.
  assert.equal(script.includes('</script'), false);
  assert.equal(script.includes('<img'), false);
  assert.match(script, /\\u003c\/script/);
  // Escaping must still round-trip to the original string, not mangle the name.
  assert.equal(injectedPayload(html, '__F1_RUNS__').comparisons[0].target.raceName, breakout);
});

test('line separators that would terminate the script are escaped too', async () => {
  const comparison = await demoComparison();
  const separators = `Alex${String.fromCharCode(0x2028)}Atlas${String.fromCharCode(0x2029)}`;
  comparison.records[0].ranking[0].name = separators;

  const html = renderDashboard([comparison]);

  assert.equal(injectedScript(html).includes(String.fromCharCode(0x2028)), false);
  assert.equal(injectedScript(html).includes(String.fromCharCode(0x2029)), false);
  assert.equal(injectedPayload(html, '__F1_RUNS__').comparisons[0].records[0].ranking[0].name, separators);
});

test('the live client ships form defaults and no run data', () => {
  const html = renderLiveDashboard({ model: 'gpt-test', reasoning: 'medium' });
  assert.deepEqual(injectedPayload(html, '__F1_DEFAULTS__'), { model: 'gpt-test', reasoning: 'medium' });
  // History arrives over /api/runs, so inlining it would only serve it twice.
  assert.equal(injectedScript(html).includes('__F1_RUNS__'), false);
});

test('runData summarises only races whose result has been revealed', async () => {
  const revealed = await demoComparison();
  const pending = await demoComparison();
  pending.outcome = null;
  pending.records.forEach(record => { record.metrics = null; });

  assert.equal(runData([pending]).summary.length, 0);
  assert.equal(runData([revealed, pending]).summary.length, 2);
  assert.equal(runData([revealed]).summary[0].races, 1);
});

test('an empty dashboard still renders and carries no comparisons', () => {
  const payload = injectedPayload(renderDashboard([]), '__F1_RUNS__');
  assert.deepEqual(payload.comparisons, []);
  assert.deepEqual(payload.summary, []);
});

test('the page CSP allows the bundled data: fonts it ships', async t => {
  const app = createDashboardServer({ store: { async listRuns() { return []; } } });
  const address = await app.listen({ port: 0 });
  t.after(() => app.close());

  const policy = (await fetch(address.url)).headers.get('content-security-policy');
  // Inter is inlined as data: URIs. Without an explicit font-src these fall
  // back to default-src 'self', which blocks them, and the page silently
  // renders in the system fallback instead. The build cannot catch that.
  assert.match(policy, /font-src[^;]*data:/);
  assert.match(policy, /default-src 'self'/);
});

test('the built shell exposes exactly one data marker before the bundle', () => {
  const shell = dashboardShell();
  assert.equal(shell.split('<!--f1:data-->').length - 1, 1);
  // Injected data has to be assigned before the bundle executes and reads it.
  assert.ok(shell.indexOf('<!--f1:data-->') < shell.indexOf('<script'));
});
