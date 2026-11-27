# Compatibility record

Last updated: 2026-11-27. Core extension and judge adapter are separate claims.

## Tested

| Check | Version | Evidence | Status |
| --- | --- | --- | --- |
| Deterministic suite (`npm run check`) | 19.2.1 on Windows | 57 tests, 56 pass, 1 symlink test skipped on this host | VERIFIED |
| Remote CI matrix | 19.2.1 | GitHub Actions run `45970384648` on `88a1081`: ubuntu-latest, macos-latest, windows-latest all 57 tests / 57 pass / 0 fail | VERIFIED |
| Extension loads headless | 19.2.1 | `omp --mode json -p "/genie" --no-session -e src/extension.ts` completed | VERIFIED |
| Default static-only live run | 19.2.1 | `npm run safety:live`; no bash/eval/task call, marker file absent with `--auto-approve` | VERIFIED |
| Verification proposal mode | 19.2.1 | same live check; proposed-command section present; no execution tool ran | VERIFIED |
| Judge capability probe | 19.2.1 | `omp --mode json -p "/genie-canary" --no-session -e scripts/omp-capability-probe.ts`; import/settings/resolve/methods/primary/shape all true; primary `typesafe/jev-1.14.0` | VERIFIED (probe only) |
| Consent-gated real judge request | 19.2.1 | `scripts/judge-acceptance.ps1` exists; no interactive owner run was performed in this hardening pass | UNVERIFIED |

The capability probe is not a judge request. It does not spend judge tokens and does not prove the
remote backend answers. Only an observed consent-based call can make the judge network path VERIFIED.

## Version table

| Version | Core extension | Judge capability probe | Judge network | Classification |
| --- | --- | --- | --- | --- |
| 19.2.1 | Tested: deterministic + live static | Passed 2026-11-27 | UNVERIFIED (no consent-based live call) | Tested / probe passed |
| 19.2.2–19.2.x | Expected, not run | Not run | Allowed only if probe passes | Expected-unverified |
| 19.3–19.x | Untested, warning | Not run | Allowed only if probe passes; dialog/report say **UNTESTED OMP VERSION** | Untested-with-warning |
| < 19.2.1 | Unsupported | Not run | Disabled if probe fails | Capability-failing (expected) |
| >= 20 | Untested, warning; peer range excludes npm install | Not run | Source `-e` only; allowed only if probe passes; dialog/report say **UNTESTED OMP VERSION** | Untested-with-warning (source only) |
| Any version where import, `resolveJudge`, settings, judge resolution, required methods, primary model, or adapter-shape checks fail | Core report still works | Fails | **NOT INDEPENDENTLY JUDGED** | Capability-failing |

No range is labelled tested because one release passed. The tested claim is 19.2.1 only.

## Probe definition

`src/judge.ts:probeJudge` checks, in order:

1. `@oh-my-pi/pi-coding-agent/judgment` imports.
2. `resolveJudge` is a function.
3. `ctx.modelRegistry.mirrorInputs().settings` is non-null.
4. `resolveJudge({ settings, registry, sessionModel, sessionId, purpose: "genie" })` returns a handle.
5. The handle has `withCandidate` or `judge`, and `primaryModel` is callable.
6. `primaryModel()` returns provider, model id, API, and base URL.
7. The adapter's own `noul`/`score` question and answer shape round-trips through the interpreter.
8. The primary model is not the active model's family.

Steps 1–7 are required for any judge use. Step 8 refuses a non-independent answer. The actual result
must separately contain provider, model, API, and every expected answer id; otherwise the run is
**NOT INDEPENDENTLY JUDGED**.

## Reproduce

```sh
npm ci
npm run check
GENIE_SAFETY_EVAL=1 npm run safety:live
omp --mode json -p "/genie-canary" --no-session -e scripts/omp-capability-probe.ts
```

The manual GitHub Actions canary (`.github/workflows/omp-canary.yml`) installs the latest OMP and
records the same probe without credentials. It has not been run in this pass; its result is UNVERIFIED.
