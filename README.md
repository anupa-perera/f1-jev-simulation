# F1 Jev Simulation

This project compares TypeSafe Jev with one or more OpenAI models on chronological Formula 1 winner forecasts. Every provider receives the same pre-race evidence. The evaluator records field probabilities, prediction quality after the result is revealed, provider-reported token use, and end-to-end execution time.

Jolpica supplies public Formula 1 results. Full-history aggregates use every collected race before the target. The prompt also includes the latest three race details per driver so context size does not grow forever.

## The prediction boundary

A historical result contains both legitimate pre-race facts and the answer. The adapter creates two separate objects:

- `evidence`: target identity, known entrants, full prior-history aggregates, circuit history, and recent prior races.
- `outcome`: target winner and finishing order.

Providers see only `evidence`. The evaluator reads `outcome` after every prediction is complete. The same rule applies during a multi-race benchmark.

## Rounds: learning race by race before answering

`npm run rounds` answers "who wins race X" by walking the races before it instead of predicting X directly. Each round is one turn of the same cycle:

```
predict round N  ->  reveal result  ->  evaluate  ->  material miss?
      ^                                                    |
      |                                                    v
  next round  <-  fold correction into ledger  <-  diagnose the root cause
```

The target race is predicted last, with whatever corrections the ladder accumulated, and is never evaluated back into the loop.

- **Material miss** means the top pick was wrong, or the actual winner was given less probability than an uninformed uniform split. A round that clears that bar costs one call and teaches nothing, which is the intended outcome.
- **Diagnosis is a Choice, not generated text.** The model selects one slug from the closed taxonomy in `src/rounds.js`; the lesson wording that re-enters the next prompt was written in this repository. A model can never author its own next prompt.
- **`evidence_did_not_contain_cause` produces no correction.** Motorsport contains irreducible upsets, and a loop without that option invents lessons from noise.
- **Corrections deduplicate by cause.** A repeat reinforces one entry instead of growing the ledger, and at most five reach a prompt.
- **This is in-context correction, not training.** Jev has no memory between calls and no fine-tuning hook. Improvement lives entirely in `state.priorLessons`, which is part of the hashed evidence, so a primed prediction can never be pooled with a cold one.

```powershell
npm run rounds -- -- --demo                                        # offline, no API calls
npm run rounds -- -- --next --ladder=4 --providers=jev             # an upcoming race
npm run rounds -- -- --season=2025 --round=20 --ladder=4 --providers=jev
```

A ladder of N rounds costs up to 2N + 1 model calls, and the printed loop cost reports the total. Compare a target under `npm run rounds` against the same target under `npm run compare` before assuming the ladder pays for itself; a longer ladder is not automatically a better prediction.

Under this protocol each provider carries its own ledger, so the records in one saved run share a protocol rather than identical evidence. They are marked `protocol: "rounds"`.

### Repeating a run without paying for it again

Building evidence is not the slow part. Every evidence object for a five-round ladder over 1994-2026 costs about 85 ms, against roughly one to five seconds for a Jev call and twenty to sixty for a Codex one. A four-round ladder is up to nine calls per provider, so a repeat run costs minutes of model time, not milliseconds of assembly.

`--cache` replays answers that were already measured:

```powershell
npm run rounds -- -- --season=2025 --round=20 --ladder=4 --providers=jev --cache
```

The key covers the provider, the model and the whole evidence object, and the evidence object already carries `priorLessons`. Editing a lesson, changing `--recent-window` or adding a rung therefore invalidates exactly the entries it should and nothing else. There is no cache to expire by hand; to discard everything, delete `predictions/` in the data directory.

It is off by default, because a replayed record keeps the duration and token counts of the call that produced it, and measuring those is what this tool is for. Replayed records are marked `cached` and labelled in the output. Caching also freezes one sample of a non-deterministic model, which makes a run reproducible and hides run-to-run variance. Use it while iterating; turn it off to measure.

### Where the root causes come from

The taxonomy is measured, not invented. `npm run audit` rebuilds every number in it from the seasons already cached by `npm run collect`, and reads the cache only:

```powershell
npm run collect -- -- --from=1994 --to=2026
npm run audit -- -- --from=1994 --to=2026
```

Across 615 races and 13,094 entries from 1994 to 2026:

| Measurement | Result |
| --- | --- |
| Strongest driver on recent form wins | 32.2% of races |
| ...after winning two of their last three | 46.1% |
| ...after winning none of their last three | 10.3% |
| Winner started from pole | 49.3% |
| Predicting a finish from the career average | 4.37 mean absolute positions |
| ...from the last three races | 4.47 |
| ...from the teammate's last three races | 4.69 |
| ...from results at this circuit | 5.52 |
| Retirement after a record of frequent car failures | 27.4%, against 6.2% for a clean record |
| Collision after a record of frequent incidents | 15.4%, against 5.8% |
| Entries by outcome | 70.0% finished, 14.5% mechanical, 9.6% collision, 5.2% lapped or unclassified, 0.8% penalty or withdrawal |

Two rules that seemed obvious were deleted because the data contradicted them. Preferring recent form to the lifetime record makes predictions worse, in every era measured. Circuit specialists beat their own career form 55.4% of the time against a 57.0% base rate, so circuit history earns no promotion of its own.

One gap is structural rather than a lesson: qualifying position is not in the evidence at all, and 49.3% of winners start from pole. No correction can recover a signal the evidence never carried.

## Providers

### TypeSafe Jev

Jev receives one Choice question whose options are the drivers. Its option distribution becomes the field win-probability distribution. Token counts come from TypeSafe's `usage.input_tokens` and `usage.output_tokens` fields.

### OpenAI through Codex

The OpenAI provider launches `codex exec --json` with a strict JSON Schema. Codex reuses its own saved login. The application never opens, copies, or parses Codex OAuth credentials.

The `turn.completed` JSONL event supplies input, cached-input, output, and reasoning-output token counts. Timing includes process startup, authentication, model execution, and structured output because that is the end-to-end latency of this route. OpenAI models default to `low` reasoning effort so repeated comparisons use the same setting; pass `--reasoning=medium` or set `CODEX_REASONING_EFFORT` to change it.

Provider token units and runtime stacks differ. Compare reported consumption and latency as operational measurements; do not assume one Jev token is identical to one OpenAI token.

## Setup

Requirements:

- Node.js 22 or newer
- A TypeSafe API key
- Codex CLI for the OpenAI comparison

Copy `.env.example` to `.env` and set the TypeSafe key:

```powershell
Copy-Item .env.example .env
```

Authenticate the Codex CLI using its supported browser login:

```powershell
codex login
codex login status
```

The application delegates authentication to the CLI. Do not copy `.codex/auth.json` into this project and do not put a browser OAuth token in `.env`.

Check both providers:

```powershell
npm run status
```

## Commands

Run the offline demonstration. Its provider outputs are explicitly simulated:

```powershell
npm run demo
```

Download and cache several seasons:

```powershell
npm run collect -- -- --from=2021 --to=2026
```

Compare Jev with one OpenAI model on a completed race:

```powershell
npm run compare -- -- --season=2025 --round=12 --history-from=2021 --providers=jev,codex --models=gpt-5.6-luna
```

Compare Jev with several OpenAI models:

```powershell
npm run compare -- -- --season=2025 --round=12 --history-from=2021 --providers=jev,codex --models=gpt-5.6-luna,gpt-5.6-terra
```

Predict the next scheduled Grand Prix:

```powershell
npm run next -- -- --history-from=2021 --providers=jev,codex --models=gpt-5.6-luna
```

Jolpica's next-race endpoint does not publish a confirmed entry list. Until an entry-list source is added, `next` estimates the field from the most recent completed race and labels that assumption in its output.

Run a bounded chronological benchmark:

```powershell
npm run benchmark -- -- --season=2025 --from-round=10 --to-round=12 --max-races=3 --history-from=2021 --providers=jev,codex --models=gpt-5.6-luna
```

Start with one race. Every live benchmark race calls every selected provider and can consume paid quota.

Start the live dashboard:

```powershell
npm run dashboard
```

Open [http://127.0.0.1:4317](http://127.0.0.1:4317). The server binds to loopback, so it is available only on this computer. The page opens on the comparison form: pick the next race or a completed season and round, the history range, Jev, and up to four OpenAI models from the model list.

Choosing a historical season lists that season's rounds by name, read from the local season cache through `GET /api/seasons/<year>`. That route never collects, so typing a year cannot start a download; a season you have not collected yet falls back to a plain round number. Rounds that have not been raced are marked, because a race without a result cannot be scored. Submitting replaces the form with the live execution view, which returns to the form through **New comparison** once the run has settled.

The browser sends one `POST /api/compare` request and listens to `GET /api/events` with Server-Sent Events. Evidence collection, provider start, provider completion, failures, execution time, tokens, and the top five are shown as they happen. Each model gets its own panel from the moment the run is accepted, with a live clock and a streaming token estimate; the estimate is labelled as one and is replaced by the provider-reported total on completion. Only one run can be active, which prevents repeated clicks from multiplying paid calls.

The live page shows the run in progress and nothing else. Completed comparisons are still saved to the data directory — read them back with `GET /api/runs`, or render every saved run with `npm run dashboard:export` below.

You can submit the same API from PowerShell:

```powershell
$body = @{
  mode = 'next'
  historyFrom = 2022
  providers = @('jev', 'codex')
  models = @('gpt-5.6-luna')
  reasoning = 'low'
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4317/api/compare -ContentType application/json -Body $body
```

The OpenAI card can fail independently when the Codex CLI is not logged in; a successful Jev result is still saved. Run `codex login` before starting the dashboard to enable the OpenAI side.

To write every saved run as a self-contained file instead, use:

```powershell
npm run dashboard:export
```

The file is written to `dashboard.html` inside the data directory and needs no server. Add `-- -- --demo` to export a simulated comparison instead of saved runs.

### The interface

The interface is a React application in `ui/`, built with Vite and using [shadcn/ui](https://ui.shadcn.com) components on Tailwind CSS. shadcn components are copied into `ui/src/components/ui/` rather than installed, so they are ordinary project source and can be edited freely; `npx shadcn@latest add <name>` adds more.

Vite emits one self-contained HTML file. `src/dashboard.js` serves that same file for both modes and only changes what it injects at the `<!--f1:data-->` marker: the live client receives the configured model defaults and fetches `GET /api/runs`, while the exported report receives the run data inline and never calls the server. Injected values are escaped so that a driver or race name coming from remote data cannot terminate the script block.

The build runs automatically before `npm test`, `npm run dashboard`, and `npm run dashboard:export`. Build it directly, or start Vite with hot reload against a dashboard already running on 4317:

```powershell
npm run ui:build
npm run ui:dev
```

Theme tokens live in `ui/src/index.css`, which maps the Netflix (Hawkins) palette onto shadcn's semantic variables.

The type stack is `"Netflix Sans", "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif`, in that order:

- **Netflix Sans** is the intended face. It is a bespoke commission and is not licensed for redistribution, so it is never bundled and no copy of it is in this repository. The page uses a system install if there is one, or a self-hosted file you place in `ui/public/fonts/` (`NetflixSans-Regular.woff2`, `-Medium`, `-Bold`, `-Black`), served by the dashboard's `/fonts/` route. A missing file 404s and the stack moves on; it never fails the build.
- **Inter** is the bundled fallback, under SIL OFL, which does permit redistribution. It lives in `ui/src/fonts/` with its licence so Vite inlines the four weights into the bundle, which is what lets the exported report render correctly with no network. Without it the page lands on Arial, because Windows has no Helvetica Neue either.

Because those weights are inlined as `data:` URIs, the page's CSP sets `font-src 'self' data:`. Dropping that directive silently returns the page to the system fallback, so a test asserts it.

## Measurements

For each provider and race, the report records:

- end-to-end execution time in milliseconds;
- input, cached-input, output, reasoning-output, and total reported tokens;
- complete field win probabilities and ranking;
- winner log loss, where lower is better;
- multiclass Brier score, where lower is better;
- whether the highest-probability driver won;
- Spearman correlation between predicted and actual finishing ranks, where higher is better.

A single race cannot establish which model is better. Use a later chronological set of races, keep the evidence and prompt versions fixed, and compare aggregate metrics.

## Storage

Downloaded seasons and prediction records default to:

```text
~/.codex/f1-jev-simulation
```

Set `F1_JEV_DATA_DIR` to change this. Credentials and generated records do not belong in the repository.

## Tests

```powershell
npm test
```

Tests inject fake HTTP and process runners. They do not call Jolpica, TypeSafe, Codex, or OpenAI.

## Primary documentation

- [Jolpica F1 API](https://github.com/jolpica/jolpica-f1/blob/main/docs/README.md)
- [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)
- [TypeSafe Choice primitive](https://docs.typesafe.ai/primitives/choice)
- [Codex non-interactive mode](https://developers.openai.com/es-419/docs/non-interactive-mode)
