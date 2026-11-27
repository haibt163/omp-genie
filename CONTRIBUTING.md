# Contributing

## Scope

Genie is a small OMP extension for project-wide opportunity discovery. Keep changes inside that
scope: no code review bot, task runner, autonomous agent, Jev integration, MCP server, vector
database, orchestration framework, persistent recommendation store, background hook, or automatic
repository change.

## Setup

- Node.js 22+ for the deterministic tests.
- OMP 19.2.1 / Bun 1.4.4+ for host smoke checks.
- No runtime npm dependencies.

```sh
npm install
npm run check
```

`npm run check` runs `tsc --noEmit` and the Node test suite. The CI workflow is configured to run the
same command on Windows, macOS, and Linux.

## Rules

1. Do not copy text or code from unlicensed projects. Prompts and rubrics must be original writing.
2. Keep every internal OMP import isolated and capability-gated. The judge adapter must stay in
   `src/judge.ts`; do not scatter internal imports. Do not add a version regex as a substitute for a
   runtime capability check.
3. Do not send evidence outside the user-invoked `/genie` flow. Do not bypass the TUI consent check.
   Do not show credentials or URL secrets in the dialog.
4. Never present an unverified or conflicting finding as a confirmed defect. The next prompt for an
   unverified finding must start with verification.
5. Keep default `/genie` static-only. Do not add `bash`, `eval`, `debug`, `task`, MCP, or another
   execution-capable tool to the allowlist. Do not execute proposed verification commands in-extension
   unless OMP exposes a verified way to force its normal approval prompt.
6. Do not make the independent judge's impact answer a scoring input without an evaluation and an
   explicit design decision. It is advisory/display-only.
7. Do not claim comprehensive secret protection. Add planted-secret tests for new patterns and
   document false positives.
8. Do not add a database, persistent cache, telemetry, background timer, or network listener.
9. Candidate validation, citation checks, scoring, classification, and evidence-status downgrades
   belong in code, not in model prose.
10. Keep `prompts/genie.md` and `prompts/rubric.md` readable and editable by users.
11. Do not publish, create releases, or configure a remote as part of normal development.

## Tests

Deterministic tests cover:

- input validation and size limits;
- path exclusions, traversal, symlink escapes, binary/oversize files;
- quote/range checks;
- secret redaction and terminal-control stripping;
- scoring, generic cap, classification, evidence status;
- judge interpretation, incomplete answers, missing answer ids, missing attribution, degraded mode;
- consent refusal, unavailable UI, backend attribution, endpoint-host sanitisation;
- static allowlist parsing, fail-closed activation, tool-call blocking, restoration after
  completion/continue/failure/session transition;
- verification mode never activating an execution tool.

Live model evaluation is opt-in and never part of CI:

```sh
GENIE_SAFETY_EVAL=1 npm run safety:live
GENIE_LIVE_EVAL=1 npm run eval:live
GENIE_LIVE_EVAL=1 GENIE_EVAL_FILTER=docs-drift npm run eval:live
GENIE_LIVE_EVAL=1 GENIE_EVAL_REPETITIONS=3 npm run eval:live
```

PowerShell: `$env:GENIE_LIVE_EVAL = "1"` before the command. Live runs copy fixtures to temp
directories, use `--auto-approve` only for disposable fixtures, and must not write into the fixture.

## Compatibility changes

Any change to the OMP API boundary must update:

- the tested OMP version and classification in `README.md` and `docs/compatibility.md`;
- the capability checks in `src/judge.ts` if the judge contract changes;
- `docs/verification.md` with a new source citation or observed result;
- tests that fail closed when the API is missing.

Do not silently widen a version range based on a `main`-branch API or a single probe pass.

## Dependency licences

| Dependency | Use | Licence |
| --- | --- | --- |
| `@oh-my-pi/pi-coding-agent` 19.2.1 | dev typecheck/peer host imports | MIT |
| `typescript` | dev typecheck | Apache-2.0 |
| `@types/node` | dev typecheck | MIT |
| Node.js | test runtime | MIT |
| OMP | host runtime | MIT |

No runtime dependency is bundled. OMP imports resolve to the host's own copy at runtime.
`npm ls --omit=dev` is empty.

The transitive dev tree in `package-lock.json` contains 43 MIT, 22 Apache-2.0, 5 ISC, 1 BSD-3-Clause,
and 1 MPL-2.0 package (as of 2026-11-27). `axe-core` is the MPL-2.0 package; it is a development
dependency, is not modified, and is not bundled or distributed with the extension. Its file-level
obligations apply to its own files; re-check the inventory after dependency updates.

## Pull request expectations

- One focused change per commit.
- Tests pass on the available platform; say which platform you actually ran.
- State any remaining UNVERIFIED behaviour explicitly.
- Update `docs/evals.md` only with actual run results, including the model and configuration used.
