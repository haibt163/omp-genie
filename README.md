# OMP Genie

User-invoked, evidence-grounded opportunity discovery and prioritisation for
[OMP](https://github.com/can1357/oh-my-pi).

Genie reads the project, sweeps nine diagnostic lenses, proposes at most five evidence-backed
candidates, checks the citations locally, ranks the survivors with a transparent heuristic, and
returns the top three with an exact next prompt for each.

Default `/genie` is **static-only at the OMP tool level**: it activates only `read`, `grep`, `glob`,
and its own ranking tool. It cannot run shell commands, project scripts, tests, builds, package
managers, git, `gh`, subagents, MCP tools, or other extensions. `/genie --verify` proposes exact
verification commands for you to run; Genie does not execute them.

Tested against **OMP 19.2.1** on Windows. See [compatibility](#compatibility).

## 30-second demonstration

Actual headless run on the public [`jonschlinkert/is-odd`](https://github.com/jonschlinkert/is-odd)
repository at commit `a80ee0d831a8ee69f1fad5b4673491847975eb26` (MIT), OMP 19.2.1, main model
`dolphin/deepseek-ai/DeepSeek-V4.1-Flash`, default static-only mode. Command:
`omp --mode json -p "/genie" --no-session --auto-approve --max-cost 0.20 --max-time 300 -e <repo>/src/extension.ts`
with that clone as cwd. Actual `tool_execution_start` events: `read` 19, `glob` 1, `genie_rank` 2
(the first call was a validation retry), no `bash`/`eval`/`task`.

```text
> /genie

# OMP Genie — all lenses

**Execution mode:** static-only. Genie activated only read, grep, and glob; no shell,
package manager, or project script was available.
**OMP version:** 19.2.1.
**Main model:** dolphin/deepseek-ai/DeepSeek-V4.1-Flash.

**Independent judgement:** NOT INDEPENDENTLY JUDGED — interactive consent is unavailable
in this host mode.

## 1. is-odd input validation runs after Math.abs coercion, so non-numbers bypass the TypeError contract

**Classification:** MUST FIX / VERIFY NOW
**Evidence status:** VERIFIED
**Priority score (heuristic):** 93/100

**Evidence:**
- `index.js:12-16` — verified quote
- `test.js:28-31` — verified quote
- `README.md:17-17` — verified quote

**What was observed:** index.js computes Math.abs(value) first and only then checks isNumber(n).
Because Math.abs applies ECMAScript ToNumber, isOdd(true) becomes isOdd(1) and returns true;
isOdd(false), isOdd(null), isOdd(''), isOdd([]) and isOdd(' ') all become 0 and return false
without throwing. isOdd('foo') still throws, so behavior is inconsistent across invalid inputs.
**Exact next prompt:**
In is-odd, verify the input-validation bypass: add negative tests to test.js for true, false,
null, '', [] and ' ', confirm the current behavior, then fix index.js so only numbers and
numeric strings are coerced (e.g. gate on typeof value before Math.abs) and update the README
input contract.
```

The run produced three recommendations (one MUST FIX, two FUTURE WORK); the third was correctly
downgraded to **CONFLICTING / INSUFFICIENT** after a quote did not match its cited range. The full
verbatim report is in [docs/demo-is-odd.md](docs/demo-is-odd.md).

Independent judging was skipped because headless mode has no interactive consent surface.
`/genie` did not run the project's `npm test`; the finding is static and the prompt starts with
verification.

## Install

Genie is source-only. It is not published to npm, and `npm install omp-genie` is not available.

### Windows (PowerShell)

Clone and try it for one OMP session:

```powershell
git clone https://github.com/haibt163/omp-genie.git
cd omp-genie
omp -e .\src\extension.ts
```

Install the clone as a persistent local plugin:

```powershell
omp plugin install $PWD
omp plugin list
```

Remove it cleanly:

```powershell
omp plugin uninstall omp-genie
```

### macOS / Linux

Clone and try it for one OMP session:

```sh
git clone https://github.com/haibt163/omp-genie.git
cd omp-genie
omp -e ./src/extension.ts
```

Install the clone as a persistent local plugin:

```sh
omp plugin install "$PWD"
omp plugin list
```

Remove:

```sh
omp plugin uninstall omp-genie
```

`omp -e <path>` is the method exercised during development. `omp plugin install <local path>` is
OMP's local-link install path; it was not installed into the owner's OMP environment during this
hardening pass. Restart OMP after installing a plugin.

## Usage

```text
/genie                    # all lenses, static-only
/genie security           # focus: architecture, security, performance, roadmap, tests, dependencies
/genie --verify           # static analysis plus exact proposed verification commands (not run)
/genie --verify security  # both
/genie-run 1              # run the exact next prompt for recommendation 1 (interactive TUI only)
```

`/genie` snapshots your active tools, replaces them with the static allowlist plus `genie_rank`,
verifies the host applied the restriction, and only then starts one normal OMP turn. If OMP keeps an
execution-capable tool active, Genie restores your tools and refuses to start. After completion,
cancel, failure, session clear, or session change, it restores the exact original set.

The main model reads the project, records every lens as `finding`, `no_finding`, `not_inspected`, or
`not_applicable`, and calls `genie_rank` once. The tool validates the input, checks file citations
(path, line range, exact quote), sanitises the judge payload, optionally requests independent
judgement after explicit consent, computes the score and classification in code, and returns the
report.

If the project-goal summary is wrong, reply with the correction and run `/genie` again. If a material
ambiguity exists, Genie asks one focused question and stops instead of ranking on a guess.

Static-only has a real evidence cost: git history, issue/PR metadata, tests, builds, and runtime
behaviour are unavailable. Genie marks those lenses `not_inspected` and frames dependent findings as
UNVERIFIED. It does not pretend to have run them.

If the project is clean, Genie returns fewer than three recommendations or none. It does not pad with
generic advice.

## What Genie does and does not do

It finds project-specific next steps with checked citations, a heuristic ranking, and copy-ready
prompts. It is not a code reviewer, task runner, autonomous coding agent, Jev wrapper, MCP server, or a
replacement for OMP's tools.

The extension never edits project files, commits, pushes, opens PRs, installs packages, or runs a
recommendation automatically. `/genie-run` is an explicit TUI command that sends the selected exact
prompt through OMP under your normal tools and approval policy; it is not Genie executing the
recommendation. There are no background hooks, scheduled analysis, vector databases, multi-agent
orchestration, or persistent recommendation caches.

## Privacy

- **Main provider:** file contents and tool results the main model reads go to your configured main
  provider as in any ordinary OMP turn. Genie does not add a second copy.
- **Judge:** the independent judge gets only a sanitised, bounded payload: project goals, lens results,
  and candidate evidence (paths, line ranges, short quotes). It does not get the conversation, full
  files, images, or exact next prompts. The cap is **16 KiB** after sanitisation; oversize input is
  rejected, not silently truncated.
- **Consent:** the judge call happens only after an affirmative `ctx.ui.confirm` in the interactive
  TUI. Headless, RPC, ACP, and no-UI sessions send nothing and report **NOT INDEPENDENTLY JUDGED**.
  The dialog shows the primary provider/model/API and sanitised endpoint host, configured fallback
  candidates where enumerable (otherwise the exact OMP route source), evidence categories, and size.
- **Redaction:** before sending, Genie redacts common credential shapes, connection-URL passwords, and
  password/token assignments; it denies `.env*`, private keys, credential stores, `.git`,
  `node_modules`, and build output. **This is best-effort, not comprehensive secret detection.** False
  positives and negatives are possible. Do not treat it as a guarantee.
- **No telemetry, analytics, background timers, persistent recommendation database, or file writes.**
- The only in-memory state is the last top-three report for `/genie-run`, keyed by session and cleared
  on switch/clear/shutdown.

See [SECURITY.md](SECURITY.md) and [docs/architecture.md](docs/architecture.md).

## How is this different?

| Project | What it does | Difference from Genie |
| --- | --- | --- |
| [Blindspot Audit](https://github.com/MJL-ren/blindspot-audit) | Portable agent skill: profiles a project, sweeps lenses, reports ranked findings, keeps a ledger | Closest broad overlap. No OMP-native command, code-checked citations, exact next prompt/pick-to-run, or consent-gated judge; uses a persistent ledger Genie deliberately excludes. |
| [Next Prompt](https://github.com/gamaraan/next-prompt-extension) | OMP/Pi extension that suggests one next prompt from the recent conversation | Conversation-local follow-up. No project-wide sweep, diagnostic lenses, evidence citations, ranking, or judge. |
| [Jev Tools](https://github.com/NomenAK/jev-tools) / [OMP Jev Tools](https://github.com/gnoviawan/omp-jev-tools) | Judgment/evidence primitives exposed as tools | Complementary primitives. No project opportunity discovery, lens sweep, top-three ranking, or exact next prompt. |
| OMP Genie | OMP-native static-only discovery, code-checked citations, transparent heuristic, exact prompts, optional consent-gated judge | The bundle above; scores are heuristic, not calibrated. |

These comparisons are from the public project descriptions and Phase 0 source/metadata inspection in
[docs/verification.md](docs/verification.md) §2. No claim is made that Genie is better for every user;
if a reusable prompt or a judgment primitive is all you need, those projects may be sufficient.

## Judge role and limits

- The main model supplies impact, alignment, and feasibility (75% of the score). Code computes
  evidence strength (25%), the weighted total, and the classification.
- The judge is a **secondary check**: it can cap generic advice and downgrade evidence support. Its own
  impact rating is advisory/display-only and is not used in the total.
- The judge adapter uses an internal OMP export. It is allowed only when runtime capability checks
  pass: import, `resolveJudge`, settings, judge resolution, required methods, primary model,
  question/answer shape, and a different model family. Any failure → **NOT INDEPENDENTLY JUDGED**.
- 19.2.1 is the tested version. On another version the same checks apply, but the dialog and report say
  **UNTESTED OMP VERSION**.
- Judge usage is reported when the backend returns it; it is not included in OMP's session cost totals.
- A real consent-based judge call was **not** observed during this hardening pass. The capability probe
  passed on 19.2.1; the network path remains UNVERIFIED. The owner acceptance script is
  [`scripts/judge-acceptance.ps1`](scripts/judge-acceptance.ps1):

  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\judge-acceptance.ps1
  ```

  It copies a disposable fixture, launches the real TUI, asks you to run `/genie` and decide the
  consent dialog, then records the actual judge provider/model/API, answer-id validation, and usage
  outside tracked docs. It never calls the judge for you.

## Compatibility

No range is labelled tested because one release passed.

| OMP version | Core extension | Judge capability probe | Judge network | Classification |
| --- | --- | --- | --- | --- |
| 19.2.1 | Tested: deterministic + live static | Passed 2026-11-27 | UNVERIFIED (no consent-based live call observed) | **Tested / probe passed** |
| 19.2.2–19.2.x | Expected, not run | Not run | Allowed only if probe passes | **Expected-unverified** |
| 19.3–19.x | Untested, warning | Not run | Allowed only if probe passes; **UNTESTED OMP VERSION** | **Untested-with-warning** |
| < 19.2.1 | Unsupported | Not run | Disabled if probe fails | **Capability-failing (expected)** |
| >= 20 | Untested, warning; peer range excludes npm install | Not run | Source `-e` only; allowed only if probe passes; **UNTESTED OMP VERSION** | **Untested-with-warning (source only)** |
| Any version where import, `resolveJudge`, settings, methods, primary model, or answer-shape checks fail | Core report still works | Fails | **NOT INDEPENDENTLY JUDGED** | **Capability-failing** |

`npm run check` passing is not proof that the full extension runtime works on each OS. The remote CI
matrix runs the deterministic suite on Windows, macOS, and Linux; full runtime was exercised on
Windows only. See [docs/compatibility.md](docs/compatibility.md).

OMP can consume Claude plugin content, but this is an OMP extension module that imports OMP/Pi host
packages. It is not a Claude Code extension and makes no Claude compatibility claim.

## Limitations

- **Static-only by default.** No git, `gh`, shell, tests, builds, or runtime checks. This prevents
  project code execution but loses evidence. Verification mode proposes commands; it does not run them.
- **Heuristic scores are not probabilities or calibrated risk.** They are a transparent ranking aid.
- **Citations can be wrong.** A verified quote proves the cited lines exist; it does not prove the
  interpretation or that the finding matters. Unverified findings are framed as things to verify.
- **No independent judge** (headless, no UI, no credentials, same model family, declined consent,
  capability failure, missing answer id, missing attribution, error) → **NOT INDEPENDENTLY JUDGED**;
  no invented scores, backends, or probabilities.
- **Judge impact is advisory.** It is displayed but does not affect the score.
- **`/genie-run` is TUI-only** and requires a prior report in the same session. Headless users copy
  the prompt.
- **Evaluation is not calibration.** The fixture suite is small, single-run, and measured with term
  matching; it cannot establish statistical significance. See [docs/evals.md](docs/evals.md).
- **Platform testing.** Deterministic CI runs on Windows, macOS, and Linux. Full extension runtime was
  exercised on Windows only.

## Development

Requires Node.js 22+ for tests (`--experimental-strip-types`) and Bun 1.4.4+ for OMP itself.

```sh
npm ci
npm run check          # typecheck + deterministic tests
```

Opt-in live checks (model-backed; not CI):

```sh
GENIE_SAFETY_EVAL=1 npm run safety:live   # marker fixture, default vs --verify, no execution
GENIE_LIVE_EVAL=1 npm run eval:live       # Genie vs plain-prompt baseline
```

PowerShell: set `$env:GENIE_SAFETY_EVAL = "1"` or `$env:GENIE_LIVE_EVAL = "1"` first. Live runs use
`omp --auto-approve` on disposable temp copies, keep output outside the fixture, and are not part of
CI. The safety check proves the extension's tool restriction, not that a model is obedient.

- [docs/architecture.md](docs/architecture.md) — flow, APIs, execution safety, privacy, scoring,
  failure handling
- [docs/compatibility.md](docs/compatibility.md) — tested/probe/untested/capability-failing record
- [docs/verification.md](docs/verification.md) — historical Phase 0 plus hardening update
- [docs/evals.md](docs/evals.md) — fixture suite and actual Genie-vs-baseline results
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution rules

## Licence

MIT. OMP is MIT. No code or text was copied from the unlicensed Genie-Prompt project. Dependency
licences are listed in [CONTRIBUTING.md](CONTRIBUTING.md).
