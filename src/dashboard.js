import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmarkSummary } from './compare.js';

// The React UI is built once into a single self-contained HTML file. The live
// server and the exported report are the same artifact; only the payload
// injected at the marker differs, so there is one UI implementation to maintain.
const shellPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'dist', 'index.html');
const marker = '<!--f1:data-->';

export function dashboardShell() {
  try {
    return readFileSync(shellPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`The dashboard bundle is missing. Run \`npm run ui:build\` first (expected ${shellPath}).`);
  }
}

/** Serves a self-hosted font file, or null when none was provided. The name is
 *  matched against a strict allowlist rather than joined straight onto the
 *  path, so a traversal like `../../.env` can never reach the filesystem. */
export function readDashboardFont(name) {
  if (!/^[A-Za-z0-9._-]+\.woff2$/.test(name) || name.includes('..')) return null;
  try {
    return readFileSync(join(dirname(shellPath), 'fonts', name));
  } catch {
    return null;
  }
}

// Run records carry remote sports data, which is untrusted (invariant 12). A
// driver or race name containing `</script>` would otherwise close the block and
// execute, so every character that can terminate it is escaped to \u form.
// Built from char codes rather than written as a regex literal: U+2028/U+2029
// are line terminators, so pasting them raw into source is a syntax error.
const scriptBreakers = new RegExp('[<>&' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

function inlineJson(value) {
  return JSON.stringify(value).replace(scriptBreakers, character =>
    '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}

function inject(assignments) {
  const shell = dashboardShell();
  if (!shell.includes(marker)) throw new Error('The dashboard bundle has no data marker. Rebuild the UI.');
  const script = Object.entries(assignments)
    .map(([name, value]) => `window.${name}=${inlineJson(value)};`)
    .join('');
  return shell.replace(marker, `<script>${script}</script>`);
}

/** Aggregates stay in src/metrics.js, so the payload ships the summary rather
 *  than asking the browser to recompute metrics from raw probabilities. */
export function runData(comparisons, { generatedAt = new Date().toISOString() } = {}) {
  const scored = comparisons.filter(comparison => comparison.outcome && comparison.records.some(record => record.metrics));
  return { generatedAt, comparisons, summary: scored.length ? benchmarkSummary(scored) : [] };
}

/** Standalone saved-run report: data inline, no server, opens from disk. */
export function renderDashboard(comparisons, { generatedAt = new Date().toISOString() } = {}) {
  return inject({ __F1_RUNS__: runData(comparisons, { generatedAt }) });
}

/** Live client: no run data inline, it fetches /api/runs and streams /api/events. */
export function renderLiveDashboard({
  model = process.env.CODEX_MODEL || 'gpt-5.6-luna',
  reasoning = process.env.CODEX_REASONING_EFFORT || 'low',
} = {}) {
  return inject({ __F1_DEFAULTS__: { model, reasoning } });
}
