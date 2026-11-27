# Phase 0 verification (historical)

Date: 2026-11-27
Target host: OMP 19.2.1
Repository: local `omp-genie` (historical branch `feat/genie-mvp`)
Status at the gate: **PROCEED WITH LIMITATIONS**

> **Historical record.** The branch, status, and design statements below describe the Phase 0 gate
> and early implementation. They are not the current branch or current release status. Do not treat
> "read-only git commands are allowed" or "version-gated judge" as current behaviour; the hardening
> update at the end of this file supersedes them. Phase 0 findings are preserved, not rewritten.

This document records Phase 0 only. No implementation code, OMP configuration, credentials, or
other project repositories were changed.

## Method

| Source type | What was used |
| --- | --- |
| Installed host | `omp --version`; `omp plugin --help`; read-only CLI inspection |
| Official source | `can1357/oh-my-pi` at tag `v19.2.1`, commit `b55cd1bb664d8ab46ddc77f2a34eb47555dbf1ac` |
| Official documentation | `docs/extensions.md`, `docs/extension-loading.md`, `docs/secrets.md`, `docs/tools/find.md`, `docs/tools/eval.md`, `docs/plugin-manager-installer-plumbing.md`, `docs/cli-reference.md`, `docs/skills.md` at that tag |
| Official source interfaces | `packages/coding-agent/src/extensibility/extensions/types.ts`, `packages/coding-agent/src/judgment/index.ts`, `packages/coding-agent/src/session/agent-session.ts`, `packages/coding-agent/src/config/model-registry.ts`, `packages/ai/src/judgment/types.ts` |
| Registries | GitHub REST API; npm registry |
| Prior art | Shallow clones of the five brief-listed projects; API metadata; source inspection |

Line citations below refer to the `v19.2.1` checkout unless stated otherwise. The checkout is not
part of this repository.

Classifications: **VERIFIED** (source read or command observed), **FAILED** (attempted and failed),
**UNVERIFIED** (not yet confirmed), **OWNER DECISION**.

---

## 1. Target OMP version

| Check | Result | Status |
| --- | --- | --- |
| Installed binary | `omp/19.2.1` (`omp --version`) | VERIFIED |
| Latest stable GitHub release | `v19.2.1`, published 2026-11-25T17:10:03Z, not prerelease/draft | VERIFIED |
| Installed version equals latest stable | Yes | VERIFIED |
| Source tag inspected | `v19.2.1`, commit `b55cd1bb664d8ab46ddc77f2a34eb47555dbf1ac` | VERIFIED |
| OMP licence | MIT (`LICENSE:1-5`; root `package.json` `"license": "MIT"`) | VERIFIED |
| Workspace package licences sampled | All `packages/*` manifests inspected declare MIT | VERIFIED |

No API from OMP `main` is assumed. All design decisions below target `v19.2.1`, with an explicit
compatibility boundary for anything that is not a stable public contract.

---

## 2. Prior art

### 2.1 Named projects

| Project | Purpose / functionality | Maintenance | Licence | OMP compatibility | Overlap with Genie |
| --- | --- | --- | --- | --- | --- |
| [Genie-Prompt](https://github.com/jconorgrogan/Genie-Prompt) | Plain prompt asking a model to propose the next questions to ask; no project inspection | Last push 2025-05-19; 8 stars; not archived | **No licence file; GitHub licence `null`** | None; host-agnostic prompt | Conceptual next-step ideation only. No evidence gathering, scoring, code, command, or OMP integration. |
| [Next Prompt](https://github.com/gamaraan/next-prompt-extension) | OMP/Pi extension; after a settled turn (or manually) asks a model for one next user prompt and renders it in the editor/widget | Last push 2026-09-15; npm `@gamaraan/next-prompt@0.3.0`; 4 stars | MIT | OMP supported (own OMP branch, `completeSimple` + registry auth) | Suggests a prompt from recent conversation. No project-wide sweep, no diagnostic lenses, no evidence citations, no ranking, no independent judge. |
| [Jev Harness](https://github.com/Talya1412/jev-harness) | OMP adapter over TypeSafe/Jev: one advisory `jev` tool plus opt-in auto-hooks | Last push 2026-11-22; 1 star | Apache-2.0 | OMP package `@jev-harness/omp`, manifest `omp.extensions` | Judgment/gating primitives and session hooks. Not project opportunity discovery or prioritisation. |
| [Jev Tools](https://github.com/NomenAK/jev-tools) | Six evidence-oriented Jev tools (`jev_ask`, file search, diff review, test selection, …) | Last push 2026-10-07; npm `jev-agent-tools@0.4.0`; 14 stars | MIT | OMP 18.4.10 stated support baseline; `omp.extensions` | Provides evidence/judgment tools; no project-wide lens sweep, no user-ranked top-three or exact next prompt. |
| [OMP Jev Tools](https://github.com/gnoviawan/omp-jev-tools) | Five Jev judgment tools (`jev_judge`, `jev_route`, `jev_rerank`, `jev_verify`, `jev_models`) plus `/jev` | Last push 2026-09-18; 5 stars; README claims npm install but npm registry returned no package | MIT text in `LICENSE`; GitHub API reports `NOASSERTION` | Native OMP extension | Judgment primitives. No project discovery, ranking, or next-prompt execution. |
| [Blindspot Audit](https://github.com/MJL-ren/blindspot-audit) | Portable agent skill for project blind spots: profiles project, sweeps lenses, reports 3–7 ranked findings with evidence, keeps a durable ledger | Last push 2026-07-26; 2 stars; not archived | MIT | Not explicitly OMP; portable skill format, host-agnostic | **Closest adjacent product.** Same broad value: project-wide, evidence-grounded discovery. Differs: not an OMP extension/command; persistent ledger (deliberately excluded here); no exact next prompt or pick-to-run; no independent judge/consent flow; no code-enforced scoring/citation verification; includes an external web scan. |
| [claude-audit](https://github.com/teddytennant/claude-audit) | Claude Code skill that fans out reviewer/verifier subagents and writes a ranked audit report | Last push 2026-11-17; 0 stars | MIT | Claude Code, not OMP | Code review/audit with adversarial verification, not opportunity discovery. No OMP command, scoring, or next-prompt flow. |

### 2.2 Assessment

- Genie-Prompt is conceptual inspiration only. It has **no licence**, so no code or text from it may
  be copied. This repository will use original prompts and rubrics.
- Next Prompt is the only named project that already produces a "next prompt", but it is
  conversation-local and follow-up-oriented. It does not inspect the project, rank opportunities, or
  send a selected recommendation through a host message API. It is not a kill.
- The Jev projects provide judgment/evidence primitives. They are complementary and do not perform
  project-wide discovery. Genie will not depend on them.
- Blindspot Audit is the strongest value-overlap found outside the brief. It is a maintained,
  MIT-licensed, portable skill. It does not deliver the OMP-native user-invoked command, code-enforced
  scoring/citation checks, independent judge with consent, or pick-to-run behaviour. It also uses a
  persistent ledger, which this brief explicitly excludes. This is a genuine differentiation but not
  a dramatic one; it is recorded as a limitation, not hidden.
- If the Owner's actual goal is only "a reusable prompt that finds project blind spots", Blindspot
  Audit may already be sufficient and Genie's extra machinery may not be worth building. That is the
  one product-level judgement the evidence leaves open; see §9.

### 2.3 Name collision checks (2026-11-27)

| Check | Result | Status |
| --- | --- | --- |
| npm `omp-genie` | HTTP 404 (unpublished) | VERIFIED |
| npm `omp-genie-extension` | HTTP 404 | VERIFIED |
| GitHub repository search `"omp-genie" OR "omp genie"` | 0 results | VERIFIED |
| GitHub repository search `genie oh-my-pi` | 0 results | VERIFIED |
| Web search for `"OMP Genie" OR "omp-genie"` | No matching product/project found | VERIFIED |
| OMP command `genie` reserved? | No `genie` in built-in command registry or docs | VERIFIED |

The preferred names `OMP Genie` and `omp-genie` are available at the time of checking. This is not a
trademark clearance; no legal advice is implied.

---

## 3. Extension interaction verification

### 3.1 Can a slash-command handler start a normal, tool-capable OMP turn?

**Yes — VERIFIED.**

- A registered command receives `(args, ctx: ExtensionCommandContext)`:
  `types.ts:1859-1863`.
- Extension commands are executed locally by the session, not sent as prompts:
  `agent-session.ts:10325-10341` parses `/name args`, calls the registered handler, and catches errors.
- `pi.sendUserMessage(content)` starts a prompt when idle; while streaming it queues as steer unless
  `deliverAs` is set: `docs/extensions.md:399-408`, `types.ts:2236-2240`.
- The implementation calls the normal `prompt()` path with `expandPromptTemplates: false`:
  `agent-session.ts:11664-11715`.
- A normal prompt turn has the session's tool catalog. Nothing in this path disables tools. The
  command handler itself is local; the model turn is a separate normal turn.
- `sendUserMessage` can reject with `PromptDroppedError` (abort/cost cap), so the command handler must
  catch and notify.

**Design consequence:** `/genie [focus]` must only start the turn. It must not attempt to inspect the
project from the command handler.

### 3.2 Does `ctx.runEphemeralTurn` discard tool calls?

**Yes — VERIFIED.**

- Documentation: "Tool calls are always discarded rather than executed"; `tools: false` removes tool
  definitions: `docs/extensions.md:493`.
- The type comment also says the side turn executes no tool calls: `types.ts:905-911`.
- It uses the current conversation snapshot and current model, not supplied evidence only:
  `docs/extensions.md:471-489`.

**Design consequence:** do not use `runEphemeralTurn` for evidence gathering. Use the normal turn
started by `/genie`.

### 3.3 Does a registered tool's `execute` receive UI, model, and cwd context?

**Yes — VERIFIED.**

`ToolDefinition.execute(toolCallId, params, signal, onUpdate, ctx)` receives an
`ExtensionContext`: `types.ts:1094-1101`. That context contains:
`ui`, `mode`, `hasUI`, `cwd`, `sessionManager`, `modelRegistry`, `model`, `models`, `isIdle`,
`abort`, timers, and optional `runEphemeralTurn`: `types.ts:825-911`.

**Design consequence:** `genie_rank` can validate evidence against `ctx.cwd`, read the session's
model registry, show a consent dialog, and report which backend answered.

### 3.4 Are `ctx.hasUI` and `ctx.ui.confirm` supported?

**Yes, with mode caveats — VERIFIED.**

- `hasUI: boolean` exists on `ExtensionContext`: `types.ts:836-837`.
- `ctx.ui.confirm(title, message, options?): Promise<boolean>` exists: `types.ts:393-394`.
- Interactive TUI supports `select`, `confirm`, `input`, `editor`, and optional `askDialog`:
  `docs/extensions.md:1044-1049`.
- In print/headless/subagent paths `hasUI` is `false` and UI methods are no-ops; the no-op
  `confirm` returns `false`: `docs/extensions.md:1245-1247`,
  `packages/coding-agent/src/extensibility/extensions/runner.ts:546-549`.
- RPC supports dialogs; ACP supports elicitations but reports `ctx.mode === "rpc"` and `hasUI === true`:
  `docs/extensions.md:1227-1254`.

**Design consequence:** require `ctx.mode === "tui" && ctx.hasUI` for consent and pick-to-run. Treat
every other mode as headless for this feature. A no-op `confirm` must never be interpreted as consent.

### 3.5 Does `ctx.models` expose model information, resolution, and families?

**Yes, read-only — VERIFIED.**

`ExtensionModelQuery` exposes `list()`, `current()`, `resolve(spec)`, and `family(model)`:
`types.ts:601-619`; `docs/extensions.md:542-555`.

It does **not** expose a method to invoke a model with supplied evidence. The docs describe model
selection, not completion. Any independent model call needs a separate compatible mechanism.

**Design consequence:** `ctx.models` is usable for choosing/inspecting the judge model, not for
invoking it. No invented completion API.

### 3.6 Is there a supported extension-accessible secret-obfuscation facility?

**No documented extension API — VERIFIED for absence in the extension surface.**

- OMP secret obfuscation is disabled by default and operates on conversation messages sent to model
  providers: `docs/secrets.md:1-12`.
- Its scope is provider-visible conversation text, and it explicitly excludes static system prompts,
  static tool definitions, and binary payloads: `docs/secrets.md:3`.
- Extension context types, handlers, and tool definitions expose no obfuscator or redaction method:
  `types.ts:825-911` and `types.ts:1052-1101`.
- It is not a general-purpose sanitiser for a custom payload assembled by an extension.

**Design consequence:** implement a local, deterministic evidence sanitiser in Genie. Do not claim it
is comprehensive. Do not rely on `secrets.enabled`. Do not modify project files while sanitising.

---

## 4. Judgement integration

### 4.1 Is `./judgment` (`resolveJudge`) a documented public extension contract?

**No — it is a package export over internal code. VERIFIED.**

- `@oh-my-pi/pi-coding-agent` exports `./judgment` in `packages/coding-agent/package.json:360-363`.
- The coding-agent root entry point does **not** re-export `resolveJudge`; a grep of
  `packages/coding-agent/src/index.ts` found no judgment export.
- Extension documentation does not mention judgment, `resolveJudge`, `Judge`, or the judge role:
  `docs/extensions.md` contains no such section; only `docs/tools/eval.md` documents eval helpers.
- `docs/extensions.md:38` states deeper coding-agent paths resolve but name internal files, and a move
  breaks a static import of them.

**Design consequence:** treat this as an internal, version-gated adapter. Load it with a dynamic
`import()` behind feature detection. If the import or shape is unavailable, degrade honestly. Do not
make the extension fail to load because of it.

### 4.2 Does `Judge.judge()` support one shared state with multiple independent typed questions?

**Yes — VERIFIED.**

- `Questions = Record<string, Question>`; `Question` is `choice | noul | score | box`
  (`packages/ai/src/judgment/types.ts:57-60`).
- `JudgmentRequest` is `{ state, questions, images? }` — one state, many questions:
  `types.ts:116-121`.
- `Judge.judge(request)` returns `JudgmentResult`:
  `types.ts:123-143`.
- The doc comment states every question sees the same state and is answered independently:
  `types.ts:1-8`.
- `ChainJudge` implements `Judge` and passes the request through:
  `judgment/index.ts:510-560`.

**Design consequence:** one judge request can ask the generic-advice question and an
evidence-support question for each candidate, with all sanitised candidate evidence in a single
bounded state.

### 4.3 Is `judge_batch` reachable and supported from external extensions?

**No supported route — VERIFIED.**

- `judge_batch` is an eval-prelude helper, documented in `docs/tools/eval.md:168-174`.
- Its host handler is the synthetic `__judge_batch__` bridge
  (`packages/coding-agent/src/eval/judgment-batch-bridge.ts:40`), called by the eval prelude
  (`packages/coding-agent/src/eval/js/shared/prelude.txt:514,606,617`).
- No registered tool named `judge_batch` or `judge` was found in the tool registry.
- `ctx.invokeTool` is same-tool delegation only: it runs the native built-in of the same name as the
  registering tool, not an arbitrary built-in (`docs/extensions.md:836-861`, `types.ts:948-962`).

**Design consequence:** do not try to call `judge_batch` from the extension. Use one `judge()` call
with multiple typed questions, or degrade.

### 4.4 Can an extension invoke a one-shot judgement with only the evidence it supplies, without the full conversation?

**Yes, through the internal judge adapter — interface and compiled-host capability VERIFIED; actual
network call UNVERIFIED.**

`resolveJudge(deps).judge({ state, questions })` sends exactly `state` and `questions`. There is no
conversation field in `JudgmentRequest` (`packages/ai/src/judgment/types.ts:116-121`). The judge
implementation renders the supplied state/questions for the backend.

The deps needed by `resolveJudge` are `settings`, `registry`, and optional `sessionModel`,
`sessionId`, `onUsage`, `cache`, `costGate`, `purpose` (`judgment/index.ts:97-135`).

The session's live settings are reachable from the extension context through the public
`ModelRegistry.mirrorInputs()` accessor, whose returned object includes `settings`:
`packages/coding-agent/src/config/model-registry.ts:881-883,5268-5277`. The registry itself is
`ctx.modelRegistry` (`types.ts:841-843`). This avoids creating a second auth store or provider
registry.

**Runtime status:** verified in Phase 2 on the compiled `omp` 19.2.1 binary: a probe extension
imported the subpath, read `ctx.modelRegistry.mirrorInputs().settings`, resolved the judge route, and
reported the primary `typesafe/jev-1.14.0` model. The actual network judgement call was not made
without a consenting interactive session, so that part remains UNVERIFIED and is exercised by a fake
judge in deterministic tests.

### 4.5 Which backend actually answered?

The result carries `api`, `provider`, `model`, `answers`, and `usage`:
`judgment/index.ts:1023-1029`; `packages/ai/src/judgment/types.ts:123-130`.

`ChainJudge` reports the actual fresh response model where available:
`fresh?.model ?? model.id` (`judgment/index.ts:1026`).

**Design consequence:** report the returned provider/model/api, not the configured role, and say when
the result came from cache with zero usage.

### 4.6 How does an extension obtain actual provider, model, API identity, answers, and usage?

From the `JudgmentResult` above. `ChainJudge.primaryModel()` exposes the first candidate a judgment
would route to (`judgment/index.ts:567-574`). The public `withCandidate()` callback receives only the
judge and its kind (`native` / prompted), not the candidate model
(`judgment/index.ts:576-578`). There is therefore **no public way to pin** the judge to that exact
candidate; OMP may fall through its configured route on failure.

**Design consequence:** consent must describe OMP's configured judge route and name the primary
destination where known, state that fallback candidates may answer, and report the actual returned
backend afterwards. Do not claim the primary model answered when a fallback might have. Whether a
prompted judge's probabilities are calibrated must not be implied.

### 4.7 How are usage and cost accounted for? Does a direct judgement call bypass normal OMP reporting?

**It bypasses the session ledger unless the caller wires it — VERIFIED.**

- Every billed judge attempt is reported to `deps.onUsage` and telemetry:
  `judgment/index.ts:689-708`.
- The session normally journals judgment usage via `journalJudgmentUsage`, which requires a
  `ModelUsageLedger` with `appendModelUsage` (`judgment/index.ts:178-186`).
- The extension context exposes `ReadonlySessionManager` (`types.ts:840-841`), whose type does not
  include `appendModelUsage` (`packages/coding-agent/src/session/session-manager.ts:858-883`).
- `onUsage` is therefore collectable by the adapter, but it cannot be written to the session ledger
  through a documented extension API.

**Design consequence:** collect and display judge usage from the result, state that it is not included
in OMP's session cost totals, and do not claim complete cost accounting.

### 4.8 How are authentication and credentials resolved?

**Through the existing session registry; no new auth — VERIFIED.**

- `ChainJudge` obtains a key from `deps.registry.getApiKey(model, sessionId)` and a resolver from
  `deps.registry.resolver(model, sessionId)` before creating the backend:
  `judgment/index.ts:785-804`.
- The judge role resolution uses `deps.settings` and `deps.registry`:
  `judgment/index.ts:459-461, 740-780`.
- Genie will pass `ctx.modelRegistry` and `ctx.modelRegistry.mirrorInputs().settings`; it will not
  create an auth store, provider registry, or credential file.

**Runtime status:** the compiled-host probe confirmed that `resolveJudge` receives the live registry
and settings and resolves a primary judge model. The actual credential-bearing network call remains
UNVERIFIED until a consenting TUI run (not performed during development).

### 4.9 What happens when judgement is unavailable, incompatible, or unauthenticated?

`ChainJudge` throws after exhausting candidates:
- `judgment: no judge model available` when no candidate resolves;
- `judgment: every judge candidate failed: ...` when all attempts fail:
  `judgment/index.ts:679-686`.

The adapter must catch these errors, withhold judge scores, and label the result
**NOT INDEPENDENTLY JUDGED** with a short reason. It must not invent a score or backend.

---

## 5. Distribution and installation

| Question | Finding | Status |
| --- | --- | --- |
| Extension format | TS/JS module exporting a default factory | VERIFIED |
| Native project discovery | `<cwd>/.omp/extensions` | VERIFIED (`docs/extension-loading.md:36-42`) |
| Native user discovery | active agent dir's `extensions/` (default `~/.omp/agent/extensions`) | VERIFIED |
| Explicit file | `omp -e <path>` / `--extension <path>` (repeatable) | VERIFIED (`docs/cli-reference.md:163`) |
| Explicit plugin dir | `--plugin-dir <dir>` | VERIFIED (`docs/cli-reference.md:166`) |
| Local package install | `omp plugin install ./path` routes local paths to `PluginManager.link()` (directory symlink / Windows junction) | VERIFIED (`docs/plugin-manager-installer-plumbing.md:12,156-168`) |
| Plugin manifest | `package.json#omp.extensions` (or legacy `pi.extensions`) | VERIFIED (`docs/extension-loading.md:55-59`) |
| Removal | `omp plugin uninstall <name>`; or remove the file/symlink from the extensions directory | VERIFIED (`docs/plugin-manager-installer-plumbing.md:131-140`) |
| npm distribution | Supported by OMP in general, but this package is not published; do not present it as installable from npm | VERIFIED |
| Windows/macOS/Linux | Local development ran on Windows. Remote CI on `7882b64` passed the deterministic suite on `ubuntu-latest`, `macos-latest`, and `windows-latest`. Full extension runtime on macOS/Linux was not exercised. | PARTIAL |
| Claude Code compatibility | OMP can consume Claude plugin *content* (skills/commands/etc.) through its marketplaces, but extension modules import OMP/Pi host packages and are not Claude Code extensions. Do not claim Claude Code compatibility. | VERIFIED (`docs/marketplace.md:3`, `docs/extensions.md:17-38`) |

**Install design:** source/local plugin only. README will document:
1. one-off `omp -e <repo>/src/extension.ts` (for verification), and
2. `omp plugin install <repo-path>` for a proper local install,
3. removal by `omp plugin uninstall omp-genie`.

No publishing, remote, release, or user-config mutation during development.

---

## 6. Secret and privacy findings

| Check | Finding | Status |
| --- | --- | --- |
| `secrets.enabled` default | Disabled | VERIFIED (`docs/secrets.md:5-12`) |
| Protection scope | Conversation messages/provider-visible text; not static prompts/tool definitions/binary payloads | VERIFIED (`docs/secrets.md:1-3`) |
| Extension access to obfuscator | No documented extension API | VERIFIED by source/type inspection |
| Path denylist alone sufficient | No; content-level detection is required | VERIFIED by `docs/secrets.md` scope and the brief |
| OMP secrets API suitable for custom evidence | No; custom evidence assembled by Genie is outside its documented contract | VERIFIED |

**Required local sanitiser behaviour (design):** path exclusions, content pattern redaction, binary/
oversize rejection, explicit byte limits, deterministic replacement, never modify source files, tests
with fake credentials. Must be labelled as best-effort, not comprehensive.

---

## 7. Scoring, classification, and output feasibility

- Composite scoring can be ordinary extension code; no OMP API is needed. The tool can accept 1–5
  component scores and compute the weighted total itself.
- Evidence status can be partly code-derived: path existence, line-range bounds, and exact-quote
  presence can be checked locally. The model's claimed status is not trusted blindly.
- Independent generic-advice control can be a `noul` question in the same judge request. If no judge
  is available, a self-assessed generic-risk flag can only be a clearly labelled fallback, never an
  independent judgement.
- Pick-to-run cannot be safely triggered from inside `genie_rank` while the turn is streaming:
  `sendUserMessage` queues a steer in that state (`agent-session.ts:11688-11700`). A separate explicit
  `/genie-run` command after the turn is the safe design.
- In-memory last-result storage for `/genie-run` is necessary and is not a database or persistent
  cache. It will be keyed by session and cleared on switch/shutdown.

All of the above are design consequences, not yet implemented.

---

## 8. Objections and limitations of the brief

1. **"The command starts a normal OMP turn" is sound, but the slash handler cannot gather evidence
   itself.** The brief's flow is feasible only because `sendUserMessage` starts a separate normal
   turn. This is now verified and will be the design.
2. **Independent judgement is not a documented extension contract.** `resolveJudge` is a package
   export into internal code. The honest options are (a) a version-gated adapter with a tested
   fallback, or (b) no independent judgement. This document chooses (a), with degraded mode as the
   default when anything is missing. The product does not become "independently validated" by
   importing internal code; it becomes independent only when the adapter actually runs and returns a
   real backend/model.
3. **Usage/cost accounting cannot be complete through the public extension context.** The judge call
   can return usage, but it cannot be appended to the session ledger via `ReadonlySessionManager`.
   The report must say so. This is a limitation, not a reason to fake totals.
4. **The OMP secret subsystem must not be treated as a safety net.** It is off by default and does
   not cover custom evidence. Local sanitisation is mandatory, and it still cannot guarantee complete
   secret removal.
5. **The brief's "pick-to-run" cannot happen inside the ranking tool during a live turn.** A separate
   explicit command is the correct interpretation of "requires an explicit user action".
6. **The brief excludes persistent recommendation storage.** `/genie-run` therefore uses an in-memory
   last-result map only; it will not survive a session restart. This is a UX limitation, but it
   respects the exclusion.
7. **The closest external product (Blindspot Audit) already covers broad project blind-spot
   discovery.** Genie's defensible difference is OMP-native execution, code-checked citations,
   explicit ranking, consent-gated independent judgement, and exact prompt/pick-to-run. If those
   differences are not valued, the product is not worth building. This is the main "not worth
   building" objection and is recorded honestly.
8. **Model-quality evaluation is inherently model-dependent.** The repository can provide fixtures,
   deterministic harness checks, and an opt-in live evaluation runner, but it must not claim
   statistical significance or calibration. Actual live results will be recorded as run, not
   predicted.

None of these is a stop condition under §14 of the brief.

---

## 9. Stop-condition review and verdict

| Stop condition | Finding | Status |
| --- | --- | --- |
| 1. A maintained alternative delivers substantially the same project-wide value | Closest is Blindspot Audit (MIT, maintained, portable skill). It does not provide the OMP-native command, code-enforced scoring/citation checks, independent judge/consent, or pick-to-run, and it uses a persistent ledger excluded here. No maintained OMP extension delivers the same bundle. | Does not stop; documented limitation |
| 2. No supported way to start a normal tool-capable turn | `pi.sendUserMessage` starts a normal prompt when idle; verified in docs and source. | Does not stop |
| 3. Material licence conflict | OMP MIT; Genie can be MIT. Prior-art licences reviewed; Genie-Prompt is unlicensed and will not be copied. | Does not stop |
| 4. Required operation modifies an existing project or OMP config | Development and tests will use the new repository, temp dirs, and isolated fixtures. Installation is documented only. | Does not stop |
| 5. External transmission outside the user-invoked flow | Only the judge call inside `/genie`, with TUI consent; headless runs never call the judge. | Does not stop |
| 6. Evidence sent without affirmative consent | Design requires an interactive TUI `confirm` for every judge call; otherwise it degrades. | Does not stop |
| 7. Significant excluded component required | No MCP server, vector DB, orchestration, multi-agent system, database, or persistent cache is required. | Does not stop |

### Verdict

**PROCEED WITH LIMITATIONS.**

The core product is feasible:
`/genie` → normal OMP turn → evidence gathering with normal tools → structured `genie_rank` tool →
code-checked citations + heuristic ranking → top three with exact prompts → explicit `/genie-run`.

Limitations to carry into design and documentation:

- Independent judgement uses an internal OMP export behind a version-gated adapter. The adapter's
  import, settings access, and primary-route resolution are now VERIFIED on the compiled 19.2.1
  binary; the actual network judgement call is still UNVERIFIED (no consent-based live call was made).
  It must degrade cleanly.
- Judge usage is reportable but not ledger-integrated.
- Local secret sanitisation is best-effort, not comprehensive.
- Consent and pick-to-run are TUI-only; headless runs degrade/display prompts.
- The closest prior art overlaps in broad discovery value; Genie's differentiation must be real in the
  implementation, not just in the README.
- Model-quality evaluation is opt-in and cannot establish calibration.

Proceed to Phase 1 design only after this verdict. No implementation had begun at the Phase 0 gate; the
appendix records later verification evidence without rewriting the gate.

---

## Appendix — Phase 2 compiled-host and live-run evidence (2026-11-27)

These checks were run after the Phase 0 verdict, during implementation, and are recorded here so the
verification document stays honest.

| Check | Command / evidence | Result | Status |
| --- | --- | --- | --- |
| Extension loads in the compiled host | `omp --mode rpc --no-ui --no-session -e src/extension.ts` | Exit 0; no extension load errors; RPC ready | VERIFIED |
| Commands register | same run's `available_commands_update` | `genie` and `genie-run` present | VERIFIED |
| Tool registers | `pi.getAllTools()` from a probe extension on 19.2.1 | `genie_rank` present, inactive by default | VERIFIED |
| Per-run activation | `pi.setActiveTools([...before, "genie_rank"])` then removal | Added and removed correctly | VERIFIED |
| `resolveJudge` subpath import | Probe extension calling `probeJudge(ctx, VERSION)` on 19.2.1 | `available: true`; primary `typesafe/jev-1.14.0` (`typesafe`) | VERIFIED |
| Session settings access | same probe via `ctx.modelRegistry.mirrorInputs().settings` | Non-null; judge resolved | VERIFIED |
| Actual network judgement call | not run | No consent-based live call; fake judge tested deterministically | UNVERIFIED |
| Live `/genie` turn | `omp --mode json -p "/genie"` on a copied fixture, headless | Completed; full report in final assistant message; 2–3 recommendations; `genie_rank` called | VERIFIED |
| Headless degraded mode | same live run | Report says **NOT INDEPENDENTLY JUDGED — interactive consent is unavailable** | VERIFIED |
| Full live fixture suite | `scripts/eval-live.ts` | Results recorded in `docs/evals.md` and `evals/.runs/` (local) | See `docs/evals.md` |
| First remote CI run | GitHub Actions run `45961924163` on `7882b64` | `ubuntu-latest`, `macos-latest`, `windows-latest` all passed; 41 tests each, 0 failures | VERIFIED |

The live run also showed that the main model can execute read-only verification commands (`npm run
start`, `npm run build`, a port check) during the Genie turn. The extension itself did not modify the
fixture; the fixture was a disposable temp copy.

---

## Hardening update (2026-11-27)

This section supersedes the Phase 0/Phase 2 behaviour statements above. The old findings are kept
as history; the current branch is `hardening/pre-announce` from `main` at `962cb55`.

### Execution safety

The earlier live run executed `npm run start`, `npm run build`, and a port check because `/genie`
left the normal active tools enabled and the model chose to run them. That is now removed at the OMP
tool level.

| Check | Evidence | Result | Status |
| --- | --- | --- | --- |
| Static allowlist unit tests | `test/safety.test.ts` | Default and `--verify` activate only `read`, `grep`, `glob`, `genie_rank`; execution tool blocked; snapshot restored after completion, continue, send failure, and session switch | VERIFIED |
| Live marker fixture | `GENIE_SAFETY_EVAL=1 npm run safety:live` on 19.2.1 | Default `/genie`: tools `genie_rank, glob, grep, read`; marker file absent; no bash/eval/task call with `--auto-approve`. `--verify`: same, proposed-command section present, marker absent | VERIFIED |
| Fail-closed host check | extension reads active set after `setActiveTools` | Unexpected tool → restore and refuse to start | VERIFIED in unit tests |
| Git/gh evidence | removed from default mode | Static-only cannot run external programs; reports mark dependent lenses `not_inspected`/UNVERIFIED | VERIFIED (loss documented) |
| Verification execution | not implemented in-extension | Report prints exact proposed commands; Genie does not run them | OWNER DECISION: proposal-only is the fail-closed choice |

### Independent judge

The 19.2.x version regex is replaced by runtime capability checks. 19.2.1 passes the probe; the
network call remains unverified because no consent-based interactive owner run was performed.

| Check | Evidence | Result | Status |
| --- | --- | --- | --- |
| Capability probe | `omp --mode json -p "/genie-canary" --no-session -e scripts/omp-capability-probe.ts` | Import, `resolveJudge`, settings, judge resolution, methods, primary model, adapter shape all true | VERIFIED |
| Primary judge route | same probe | `typesafe/jev-1.14.0` via `typesafe`, endpoint host `api.typesafe.ai` | VERIFIED |
| Fallback enumeration | same probe | `resolveRoleChain("judge", …)` returned the configured chain (one candidate); internal subpaths may be absent on other builds, in which case the dialog states the route source | VERIFIED on 19.2.1 |
| Answer-id and attribution validation | deterministic tests | Missing answer id or missing provider/model/API → degraded, never invented | VERIFIED |
| Consent disclosure | deterministic tests and code | Primary provider/model/API/host, fallbacks or route source, evidence bytes, redaction warning | VERIFIED (mocked UI) |
| Real consent-based judge call | `scripts/judge-acceptance.ps1` | Script written; not run in this pass | UNVERIFIED |
| CI canary | `.github/workflows/omp-canary.yml` | Manual workflow; not run in this pass | UNVERIFIED |

### Evaluation

The live harness now has Genie and plain-prompt arms with the same fixtures, model, read-only tools,
budget, timeout, and hidden ground truth. The final 18-run comparison (1 repetition per fixture per
arm, $0.20 cap, $0.135296 actual spend) found:

- top-three hit rate: Genie 8/8, baseline 8/8;
- generic titles: 0/25 vs 0/27;
- clean-control high-severity flags: 1 vs 1 (both constructive, per the saved reports);
- unverified-as-fact: 0/25 vs 0/27;
- actual spend: $0.100310 vs $0.034986 (Genie about 2.9x).

This is a negative result for "demonstrably more useful" on these fixtures: the plain prompt matched
every seeded hit and the coarse evidence metrics. Genie's structure, citation checks, exact prompts,
and safety boundary are not scored by these metrics. See `docs/evals.md` for the full side-by-side,
per-fixture costs, metric limits, and every case where Genie adds nothing.

### Installation and CI

`README.md` now documents `git clone`, `omp -e`, `omp plugin install`, `omp plugin list`, and
`omp plugin uninstall` for Windows and macOS/Linux. `omp plugin install` was not exercised against the
owner's OMP environment. `npm run check` is the deterministic gate. GitHub Actions run `45970384648`
on `88a1081` passed 57/57 tests on ubuntu-latest, macos-latest, and windows-latest. That is a test
result, not proof that the full extension runtime works on macOS/Linux; full runtime remains exercised
on Windows only.
