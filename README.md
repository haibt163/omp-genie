# OMP Genie

User-invoked, evidence-grounded opportunity discovery and prioritisation for [OMP](https://github.com/can1357/oh-my-pi).

Genie reads the project, sweeps nine diagnostic lenses, proposes at most five evidence-backed
candidates, checks the citations locally, ranks the survivors with a transparent heuristic, and
returns the top three with an exact next prompt for each. It does not edit files, run a
recommendation, or call a background service.

Tested against **OMP 19.2.1** on Windows. See [compatibility](#compatibility).

## 30-second demonstration

Actual headless run on the `docs-drift` fixture. Independent judgement is correctly shown as skipped
because there is no interactive consent surface in this mode.

```text
> /genie

# OMP Genie — all lenses

**Project goals (as understood):** Widget Service is a minimal Node ESM scaffold ...
**Inspected lenses:** Correctness, Security, Architecture, Performance, Tests and CI,
Documentation, Dependencies, Roadmap and intent, Release and operations.
**Not inspected / unavailable:** Roadmap and intent.
**Independent judgement:** NOT INDEPENDENTLY JUDGED — interactive consent is unavailable
in this host mode.

## 1. Build step is a placeholder: `npm run build` exits 0 with no artifacts

**Classification:** MUST FIX / VERIFY NOW
**Evidence status:** VERIFIED
**Priority score (heuristic):** 93/100

**Evidence:**
- `README.md:14-14` — verified quote
- `package.json:8-8` — verified quote
- `src/build.js:1-1` — verified quote

**What was observed:** README.md presents `npm run build` as the project's build step.
package.json wires it to `node src/build.js`, whose entire body is a single console call.
Executing `npm run build` exits 0, prints "build placeholder", and writes no artifact.
**Exact next prompt:**
Decide the build contract for widget-service: either delete src/build.js plus the `build`
script and the README Build section, or implement a real build. Verify `npm run build` either
no longer exists or produces the documented artifacts.
```

The full report also ranked the README/start-script mismatch. Every citation in the report was
checked locally; the exact prompt is copyable. `/genie-run 1` runs it from the interactive TUI, and
only after the user selects it.

## Install

No runtime dependencies are installed by Genie. Do not install an unpublished npm package; this
repository is source-only.

### Windows (PowerShell)

Shortest verified method, load the extension for one OMP session:

```powershell
omp -e C:\Projects\omp-genie\src\extension.ts
```

Persistent local plugin (uses OMP's local link support; not run against the owner's environment
during development):

```powershell
omp plugin install C:\Projects\omp-genie
omp plugin list
```

Remove it cleanly:

```powershell
omp plugin uninstall omp-genie
```

If you copied the repository instead, use its actual path. Restart OMP after installing a plugin.

### macOS / Linux

One session:

```sh
omp -e "$HOME/src/omp-genie/src/extension.ts"
```

Persistent local plugin:

```sh
omp plugin install "$HOME/src/omp-genie"
omp plugin list
```

Remove:

```sh
omp plugin uninstall omp-genie
```

The one-off `-e` path is the method verified on the development host. `omp plugin install <local
path>` is documented by OMP 19.2.1 as a local link; it was not installed into the owner's OMP
environment.

## Usage

```text
/genie                 # all lenses
/genie security        # focus: architecture, security, performance, roadmap, tests, dependencies
/genie-run 1           # run the exact prompt for recommendation 1 (interactive TUI only)
```

`/genie` starts one normal tool-capable OMP turn. The main model reads the project, records every
lens as `finding`, `no_finding`, `not_inspected`, or `not_applicable`, and calls `genie_rank` once.
The tool validates the input, checks file citations (path, line range, exact quote), sanitises the
judge payload, optionally requests independent judgement after explicit consent, computes the score
and classification in code, and returns the report.

If the project-goal summary is wrong, reply with the correction and run `/genie` again. If a material
ambiguity exists, Genie asks one focused question and stops instead of ranking on a guess.

If the project is clean, Genie returns fewer than three recommendations or none. It does not pad with
generic advice.

## Privacy

- The extension itself makes **no network request** except the optional independent-judge call.
- The judge call happens only after an affirmative `ctx.ui.confirm` in the interactive TUI. Headless,
  RPC, ACP, and no-UI sessions always return **NOT INDEPENDENTLY JUDGED** and send nothing.
- The judge receives a bounded, sanitised payload: project goals, lens results, and candidate
  evidence (paths, line ranges, short quotes). It does **not** receive the conversation, full files,
  images, or the exact next prompts.
- Evidence is capped at **16 KiB** after sanitisation. Oversize input is rejected, not silently
  truncated.
- Before sending, Genie redacts common credential shapes, connection-URL passwords, and
  password/token assignments; it denies `.env*`, private keys, credential stores, `.git`,
  `node_modules`, and build output. **This is best-effort, not comprehensive secret detection.** False
  positives and false negatives are possible. Do not treat it as a guarantee.
- No telemetry, analytics, background timers, persistent recommendation database, or file writes.
- The only in-memory state is the last top-three report for `/genie-run`, keyed by session and cleared
  on switch/shutdown.

See [SECURITY.md](SECURITY.md) and [docs/architecture.md](docs/architecture.md).

## What Genie does not do

It is not a code reviewer, task runner, autonomous coding agent, Jev wrapper, MCP server, or a
replacement for OMP's tools. The extension never edits project files, commits, pushes, opens PRs,
installs packages, or runs a recommendation automatically. The Genie prompt also instructs the main
model to stay read-only. There are no background hooks, scheduled analysis, vector databases,
multi-agent orchestration, or persistent recommendation caches.

## Limitations and degraded mode

- **Independent judgement is version-gated and internal.** OMP's `./judgment` export is not a
  documented public extension contract. Genie isolates it in `src/judge.ts`, requires OMP `19.2.x`,
  and degrades with a visible reason if the import, settings, judge route, credentials, or answers are
  unavailable. The compiled-host adapter was verified on 19.2.1; an actual network judgement call was
  not made without consent. The interface is not guaranteed across OMP versions.
- **Judge usage is not in OMP's session ledger.** The report shows the usage returned by the judge and
  says it is not included in session cost totals.
- **No independent judge** (headless, no UI, no credentials, same model family, declined consent,
  error, partial answers) → the report says **NOT INDEPENDENTLY JUDGED** and does not invent scores,
  backends, or probabilities.
- **Heuristic scores are not probabilities or calibrated risk.** They are a transparent ranking aid.
- **Citations can be wrong.** A verified quote proves the cited lines exist; it does not prove the
  interpretation or that the finding matters. Unverified findings are framed as things to verify.
- **`/genie-run` is TUI-only** and requires a prior report in the same session. Headless users copy
  the prompt.
- **Evaluation is not calibration.** The opt-in fixture suite is small, single-run, and measured with
  term matching; it cannot establish statistical significance.
- **Platform testing** Local development ran on Windows. The first remote CI run on commit `7882b64`
  passed all three jobs (`ubuntu-latest`, `macos-latest`, `windows-latest`), each with 41 tests and 0
  failures. The Windows runner could create symlinks, so its suite ran 41 tests; the local Windows run
  skipped the symlink-creation test. Full extension runtime on macOS/Linux has not been exercised.

## Compatibility

| OMP | Core extension | Independent judge |
| --- | --- | --- |
| 19.2.1 | Tested | Adapter capability tested; actual network call unverified |
| 19.2.x | Expected | Version-gated, best-effort |
| < 19.2.1 | Unsupported | Disabled |
| >= 20 | Unsupported until revalidated | Disabled |

OMP can consume Claude plugin content, but this is an OMP extension module that imports OMP/Pi host
packages. It is not a Claude Code extension and makes no Claude compatibility claim.

## Development

Requires Node.js 22+ for tests (`--experimental-strip-types`) and Bun 1.4.4+ for OMP itself.

```sh
npm install
npm run check          # typecheck + deterministic tests
```

The opt-in fixture suite is documented in [docs/evals.md](docs/evals.md). The latest single-run
headless evaluation (DeepSeek V4.1 Flash) hit the seeded issue in 8/8 seeded fixtures, produced 0/24
generic-titled recommendations, and produced 0 MUST FIX/OWNER recommendations on the corrected clean
control. The original control had two real contract gaps, which were fixed before the control was
rerun; both runs are recorded in `docs/evals.md`. These are tiny synthetic fixtures and one run per
fixture; the numbers are not accuracy or calibration.

Model-backed evaluation is opt-in:

```sh
GENIE_LIVE_EVAL=1 npm run eval:live
# or one fixture:
GENIE_LIVE_EVAL=1 GENIE_EVAL_FILTER=docs-drift npm run eval:live
```

On PowerShell, set `$env:GENIE_LIVE_EVAL = "1"` first. Live runs use `omp --auto-approve` on
disposable temp copies, keep output outside the fixture, and are not part of CI. Results are recorded
in [docs/evals.md](docs/evals.md).

- [docs/verification.md](docs/verification.md) — Phase 0 evidence and stop-condition review
- [docs/architecture.md](docs/architecture.md) — flow, APIs, privacy, scoring, failure handling
- [docs/evals.md](docs/evals.md) — fixture suite and actual results
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution rules

## Licence

MIT. OMP is MIT. No code or text was copied from the unlicensed Genie-Prompt project. Dependency
licences are listed in [CONTRIBUTING.md](CONTRIBUTING.md).
