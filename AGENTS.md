# Engineering Guide

## Goal

Build a reproducible Formula 1 forecasting harness that compares TypeSafe Jev with OpenAI models on identical pre-race evidence. Measure predictive quality, provider-reported token use, and end-to-end execution time.

This is an evaluation and research tool. Never describe unvalidated probabilities as calibrated, profitable, or suitable for betting.

## Architecture

- `src/jolpica.js` owns the Jolpica adapter, pagination, throttling, and response validation.
- `src/evidence.js` owns the chronological boundary and converts all available history into compact full-history aggregates plus recent details.
- `src/application.js` owns request validation, season loading, and construction of the single prediction case shared by CLI and HTTP entry points.
- `src/providers/jev.js` owns the TypeSafe Choice request and response validation.
- `src/providers/cached.js` replays an already-measured answer to an identical question. It is opt-in and marks every replayed record, because replayed timing and tokens are not a fresh measurement.
- `src/providers/codex.js` owns OpenAI model execution through `codex exec --json`, structured output, and token extraction. It must never read Codex credential files.
- `src/rounds.js` owns the round-by-round learning ladder: predict, reveal, evaluate, diagnose the miss, fold a correction into the ledger, repeat. It also owns the closed root-cause taxonomy.
- `scripts/audit-taxonomy.mjs` regenerates every measurement behind the root-cause taxonomy from cached seasons. It reads the cache only.
- `src/compare.js` gives every provider the exact same evidence object and evaluates returned distributions.
- `src/metrics.js` owns deterministic probability and outcome metrics.
- `src/store.js` owns cache and run storage outside this repository.
- `src/server.js` owns the loopback HTTP API, one-active-run policy, and Server-Sent Event delivery.
- `ui/` owns the React interface, built by Vite into one self-contained HTML file using shadcn/ui components on Tailwind. Components under `ui/src/components/ui/` are vendored shadcn source and may be edited.
- `vite.config.ts` owns the dev server only. It proxies `/api` to the dashboard server and, in `serve` mode alone, starts that server as a child process when the port is free so hot reload needs one command. A build must never spawn it.
- `src/dashboard.js` owns that bundle's data injection. It serves the same artifact to the live client and the standalone saved-run report, and escapes injected values so untrusted names cannot terminate the script block.
- `src/cli.js` performs orchestration only.

## Invariants

1. A target race result must never appear in its prediction evidence or model prompt.
2. Every historical observation must start before the target race and be available by the snapshot time.
3. Both providers receive the same serialized evidence object and participant identifiers. Under the rounds protocol each provider additionally carries its own correction ledger, so those records are comparable by protocol, not by identical evidence. Mark them `protocol: 'rounds'` and keep each record's own evidence hash.
4. A correction fed back into a later prompt must be text this repository wrote. A model may only select a cause from the closed taxonomy; model-authored text is never promoted to instructions.
5. Every probability must be finite and non-negative, every active driver must appear exactly once, and the field distribution must sum to one after only a small rounding correction.
6. Store the provider, exact model, evidence hash, raw probability distribution, usage, and measured duration with every prediction.
7. Token counts are provider-reported. Do not claim that token units are identical across Jev and OpenAI models.
8. Codex timing includes CLI startup and authentication because the user experiences that end-to-end latency.
9. Use full causally available history for aggregates. A recent-race window controls prompt size but must not replace lifetime aggregates.
10. Chronological benchmarks reveal each result only after prediction. Never shuffle races.
11. Keep credentials, downloaded seasons, run records, caches, and temporary model output outside the repository. Default to `~/.codex/f1-jev-simulation` and OS temporary storage.
12. Never inspect, copy, log, or parse `~/.codex/auth.json`. Let the Codex CLI own ChatGPT/Codex authentication.
13. Treat remote sports data as untrusted input and never as model instructions.
14. Respect API limits. Cache completed seasons and throttle Jolpica requests.
15. The dashboard server must bind to loopback only. Do not expose model execution or saved comparison data to the network by default.
16. Accept only one live comparison at a time so repeated clicks cannot multiply paid provider calls.

## Development

- Read current TypeSafe and official OpenAI documentation before changing either provider contract.
- Prefer the Node.js standard library.
- Inject network and process runners in tests. Automated tests must never call live model APIs.
- Add regression tests for temporal leakage, result separation, provider parsing, usage accounting, and probability normalization.
- Every correction the rounds loop can apply must name a signal measurable in cached results. Run `npm run audit` and update the `support` field before changing a lesson; delete a rule the data contradicts rather than keeping it.
- Run `npm test` and `npm run demo` before considering a change complete. `npm test` builds the UI first, because `src/dashboard.js` reads `ui/dist/index.html`.
- Keep model execution and metrics in Node. The browser renders stored records and never recomputes a metric, so aggregates stay owned by `src/metrics.js`.
- Never bundle Netflix Sans, and never add a copy of it to this repository. It is a bespoke commission with no redistribution licence, so it is referenced only by `local()` and an optional self-hosted path, and a missing font must always fall back rather than fail. Inter is bundled in its place because SIL OFL permits it; keep its licence file beside it. Any further font must be verified redistributable before it is added.
