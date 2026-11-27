# Genie demo: jonschlinkert/is-odd

- Repository: <https://github.com/jonschlinkert/is-odd>
- Commit: `a80ee0d831a8ee69f1fad5b4673491847975eb26`
- Licence: MIT
- Host: OMP 19.2.1
- Main model: `dolphin/deepseek-ai/DeepSeek-V4.1-Flash`
- Mode: default `/genie` (static-only; `read`, `grep`, `glob`, `genie_rank`)
- Command: `omp --mode json -p "/genie" --no-session --auto-approve --max-cost 0.20 --max-time 300 -e <repo>/src/extension.ts` with the pinned clone as cwd
- Judging: **NOT INDEPENDENTLY JUDGED** because headless mode has no interactive consent surface
- Actual `tool_execution_start` events: `read` 19, `glob` 1, `genie_rank` 2 (one retry); no `bash`, `eval`, or `task` call

The report below is the custom `genie-report` row, verbatim.

---

# OMP Genie — all lenses

**Execution mode:** static-only. Genie activated only read, grep, and glob; no shell, package manager, or project script was available.
**OMP version:** 19.2.1.
**Main model:** dolphin/deepseek-ai/DeepSeek-V4.1-Flash.

**Project goals (as understood):** is-odd 3.0.1 is a tiny published npm predicate: return true iff the input is an odd integer that does not exceed Number.MAX_SAFE_INTEGER, documented to work with numbers and numeric strings, and to throw for invalid input. The repo ships index.js, a mocha suite, a verb-generated README from .verb.md, and legacy Travis configuration.

**Assumptions:** Static-only run: no execution, no git history, no issue/PR metadata, no registry or network checks. node_modules is absent, so is-number v6 internals are not inspected; no finding depends on is-number's string handling because it only ever receives the already-coerced number. Runtime consequences are derived from ECMAScript ToNumber/Math.abs semantics plus the in-repo tests demonstrating that the number 1 passes the isNumber gate, not from executing the code.

**Inspected lenses:** Correctness, Security, Architecture, Performance, Tests and CI, Documentation, Dependencies, Roadmap and intent.
**Not inspected / unavailable:** Release and operations.

| Lens | Result |
| --- | --- |
| Correctness | finding — index.js:13 coerces value with Math.abs before the type gate at index.js:14, so the type check runs on the coerced number. true -> 1 and returns true; false/null/''/[]/' ' -> 0 and return false without throwing, despite the 'expected a number' contract for 'foo'. |
| Security | no_finding — No secrets, network access, eval, or credential material in inspected files; .npmrc contains only package-lock=false. Coercion side effects (valueOf/toString) are caller-supplied input, not an internal trust boundary, and are reported under correctness. |
| Architecture | no_finding — Single-function module in index.js with one runtime dependency used as a finite-number predicate; no layering, coupling, or module-boundary problem to address in a 24-line package. |
| Performance | no_finding — Per call: one Math.abs, three Number predicates, one modulo; no allocation, I/O, or loops. Nothing measurable to improve at this size. |
| Tests and CI | finding — Only test entry point is 'mocha' (package.json:25-27). The only hosted-CI config is .travis.yml ending at Node 10; the root listing contains no .github directory or other CI file. Negative tests (test.js:28-34) omit coercible non-numbers, so the validation bypass has no guard. |
| Documentation | finding — README documents no thrown-error behavior although index.js has three throw sites; .verb.md contains only the Usage section; regeneration requires a global install of the moving verbose/verb#dev branch with no local script. |
| Dependencies | finding — .eslintrc.json extends eslint:recommended but eslint is absent from devDependencies and no lint script exists; mocha is pinned at ^3.5.3 and gulp-format-md at ^1.0.0; .npmrc disables package-lock so installs are unpinned. |
| Roadmap and intent | no_finding — No roadmap, changelog, or release-plan artifact exists in the tree; git history and issues/PRs are unavailable in static-only mode, so intent is inferred only from README, package.json, and .verb.md. This is an incomplete inspection, not proof of absence of direction. |
| Release and operations | not_inspected — Publish state, npm dist-tags, and whether the travis-ci.org build still reports cannot be checked statically. In-tree signals: no prepublish/prepublishOnly test hook and no lockfile, so release gates are not visible from the repo. |

**Independent judgement:** NOT INDEPENDENTLY JUDGED — interactive consent is unavailable in this host mode.

## 1. is-odd input validation runs after Math.abs coercion, so non-numbers bypass the TypeError contract

**Classification:** MUST FIX / VERIFY NOW
**Evidence status:** VERIFIED
**Priority score (heuristic):** 93/100

| Component | Input | Weighted |
| --- | ---: | ---: |
| Impact | 4/5 | 22.5 |
| Alignment | 5/5 | 30.0 |
| Evidence strength | 5/5 | 25.0 |
| Feasibility | 5/5 | 15.0 |

**Main-model confidence (self-assessment):** 0.88

**Independent judge:** NOT INDEPENDENTLY JUDGED — interactive consent is unavailable in this host mode.

**Evidence:**
- `index.js:12-16` — verified quote
- `test.js:28-31` — verified quote
- `README.md:17-17` — verified quote

**What was observed:** index.js computes Math.abs(value) first and only then checks isNumber(n). Because Math.abs applies ECMAScript ToNumber, isOdd(true) becomes isOdd(1) and returns true; isOdd(false), isOdd(null), isOdd(''), isOdd([]) and isOdd(' ') all become 0 and return false without throwing; an object with a numeric valueOf is also admitted. isOdd('foo') still throws 'expected a number', so behavior is inconsistent across invalid input types. The negative tests cover only undefined, 'foo', '1.1e0' and out-of-range integers.

**Why it matters:** The package's only job is input classification/validation. A caller using the throw as a guard gets false negatives for null/''/[] (silently treated as 0, hence 'even') and a surprising true for true, so bad data passes validation instead of raising. This is a public-contract defect in a published package whose README and tests present the TypeError as the invalid-input behavior.

**Verification step:** Add negative assertions for true, false, null, '', [] and ' ' to test.js and run the existing mocha suite: the current code fails them by returning booleans instead of throwing. Fix by gating on the original value (typeof value === 'number', or a numeric-string test before coercion) so only documented inputs reach Math.abs, then align the tests and README.

**Exact next prompt:**

```text
In is-odd, verify the input-validation bypass: add negative tests to test.js for true, false, null, '', [] and ' ', confirm the current behavior, then fix index.js so only numbers and numeric strings are coerced (e.g. gate on typeof value before Math.abs) and update the README input contract.
```

**Remaining uncertainty:** Citations and quotes were checked locally. This does not prove the finding is correct or that the independent judge is calibrated.

**What would change this ranking:** If the maintainers explicitly intend ToNumber coercion for any input (docs and tests say otherwise), this becomes a documentation change and drops in rank. A consumer report of isOdd(null) masking invalid data would raise it. Executing the proposed assertions would confirm the runtime claim, which this static pass did not run.

## 2. Only CI config is a Travis matrix ending at Node 10; no current-CI workflow exists

**Classification:** FUTURE WORK
**Evidence status:** VERIFIED
**Priority score (heuristic):** 68/100

| Component | Input | Weighted |
| --- | ---: | ---: |
| Impact | 3/5 | 15.0 |
| Alignment | 4/5 | 22.5 |
| Evidence strength | 4/5 | 18.8 |
| Feasibility | 4/5 | 11.3 |

**Main-model confidence (self-assessment):** 0.85

**Independent judge:** NOT INDEPENDENTLY JUDGED — interactive consent is unavailable in this host mode.

**Evidence:**
- `.travis.yml:5-14` — verified quote
- `package.json:25-27` — verified quote

**What was observed:** The only test entry point is the mocha script in package.json. The only hosted-CI configuration in the tree is .travis.yml, whose node_js matrix lists node, 10, 9, 8, 7, 6, 5 and 4; the root listing shows no .github directory and no other CI file. README line 1 carries a build-status badge pointing at travis-ci.org. Whether that service still builds this repository is not verifiable statically; what is verifiable is that no workflow for a current hosted CI provider exists and no Node 12+ LTS is pinned.

**Why it matters:** Tests protect a release only if something runs them. With the sole CI config pinned to a decade-old Node range and no current workflow, a regression in the throw paths or the odd/even result can ship with no automated signal on current runtimes. The engines field claims Node >=4, so the supported floor and the tested ceiling are both unverified by the repo itself.

**Verification step:** Check whether the travis-ci.org badge for jonschlinkert/is-odd still reports a build and whether the default branch has any CI workflow; if not, add a GitHub Actions matrix covering the claimed minimum Node and current LTS, update the README badge, and add a prepublish test hook.

**Exact next prompt:**

```text
Verify whether is-odd still has a running CI: check the travis-ci.org badge/build page for jonschlinkert/is-odd and the default branch for any workflow file; if builds no longer run, add a GitHub Actions test matrix spanning the claimed Node >=4 floor and current LTS, replace the Travis badge, and add a prepublishOnly test script.
```

**Remaining uncertainty:** Citations and quotes were checked locally. This does not prove the finding is correct or that the independent judge is calibrated.

**What would change this ranking:** If travis-ci.org still builds this repo on the floating 'node' job, modern-Node coverage would be partially present and the finding drops. Evidence of recent releases validated only by manual local runs would raise it.

## 3. README/.verb.md omit the thrown-error contract and doc builds depend on a global verbose/verb#dev install

**Classification:** FUTURE WORK
**Evidence status:** CONFLICTING / INSUFFICIENT
**Priority score (heuristic):** 64/100

| Component | Input | Weighted |
| --- | ---: | ---: |
| Impact | 2/5 | 7.5 |
| Alignment | 4/5 | 22.5 |
| Evidence strength | 4/5 | 18.8 |
| Feasibility | 5/5 | 15.0 |

**Main-model confidence (self-assessment):** 0.85

**Independent judge:** NOT INDEPENDENTLY JUDGED — interactive consent is unavailable in this host mode.

**Evidence:**
- `README.md:17-17` — verified quote
- `README.md:56-56` — quote did not match the cited range
- `.verb.md:1-3` — verified quote

**What was observed:** README states only 'Works with strings or numbers.' and shows happy-path examples; it documents none of the three throw sites in index.js (expected a number, expected an integer, value exceeds maximum safe integer). .verb.md contains only the Usage section, so regenerating cannot add API detail beyond that template. The build instruction installs verbose/verb#dev globally with no local, pinned script, and the generated README footer says verb-generate-readme v0.6.0 on May 31, 2018 while the package is version 3.0.1.

**Why it matters:** For a validation helper, the accepted input domain and failure modes are the API. Leaving the throws undocumented makes callers guess whether errors are TypeError or Error and which boundary triggers them, and the moving-branch doc toolchain makes any correction hard to reproduce or review.

**Verification step:** Add an Errors section and edge-case examples (numeric strings, non-integers, unsafe integers, negative values) to .verb.md, pin or scriptify the doc build, regenerate README, and cross-check it against the throw sites in index.js.

**Exact next prompt:**

```text
Before changing anything, verify: Add an Errors section and edge-case examples (numeric strings, non-integers, unsafe integers, negative values) to .verb.md, pin or scriptify the doc build, regenerate README, and cross-check it against the throw sites in index.js.

If confirmed: Update is-odd's .verb.md and regenerate README to document the accepted input domain and all three thrown errors (expected a number, expected an integer, value exceeds maximum safe integer) with edge-case examples, and replace the global verbose/verb#dev instruction with a pinned or local doc build.
```

**Remaining uncertainty:** Citations failed, or the independent judge did not find support. Inspect the cited evidence before acting.

**What would change this ranking:** If the project treats README as marketing only and consumers rely on the test suite for semantics, impact drops. A report of a consumer catching the wrong error type for an out-of-range value would raise it.

Copy a prompt to run it. Pick-to-run requires the interactive TUI.

_Priority scores are heuristic, not probabilities or calibrated risk estimates._

