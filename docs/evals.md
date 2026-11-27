# Evaluation

Model-quality evaluation is opt-in. It is not part of CI and cannot establish statistical significance
or calibration. The deterministic tests in `test/` are the CI gate.

## Fixtures

Nine self-contained repositories live under `evals/fixtures/`. The answer key is
`evals/ground-truth/manifest.json`, outside every fixture cwd. The harness copies only the fixture
into a fresh temp directory before running Genie, so the answer key is not reachable from the
evaluated project.

| Fixture | Stack | Seeded issue | Expected lens |
| --- | --- | --- | --- |
| `security-token` | Node/TS | Stripe-like secret hard-coded in `src/config.ts` | Security |
| `tests-missing` | Python | Unguarded division/average and no tests | Correctness, tests/CI |
| `perf-quadratic` | Node/JS | `Array.some` inside a loop over up to 50,000 events | Performance |
| `docs-drift` | Node/JS | README says `npm run start`; package.json has only `dev` and `build` | Documentation, release/operations |
| `deps-duplicate` | Node/JS | `date-fns` and `moment` used for the same date formatting | Dependencies, architecture |
| `architecture-duplicate` | Node/TS | Two VAT/tax implementations with 20% vs 21% | Architecture, correctness |
| `roadmap-gap` | Node/JS | Roadmap promises CSV in v0.2; only JSON export exists | Roadmap/intent, tests/CI |
| `release-ops` | Node/JS | CI runs `npm test`; package.json has no test script | Tests/CI, release/operations |
| `clean-control` | Node/JS | No seeded significant issue; README, tests, and CI exist | None |

## Method

```sh
GENIE_LIVE_EVAL=1 npm run eval:live
GENIE_LIVE_EVAL=1 GENIE_EVAL_FILTER=docs-drift npm run eval:live
```

PowerShell: set `$env:GENIE_LIVE_EVAL = "1"` first.

For each fixture the harness:

1. copies `evals/fixtures/<name>` to a fresh OS temp directory; for `security-token`, it replaces the
   neutral placeholder in `src/config.ts` with a runtime-built fake Stripe test token so the seeded
   hardcoded-credential issue is present only in the disposable copy;
2. runs
   `omp --mode json -p "/genie" --no-session --auto-approve --max-cost <cap> --max-time <cap> -e <repo>/src/extension.ts`
   with the temp directory as cwd;
3. stores raw JSONL, stderr, and the extracted report under `evals/.runs/<timestamp>/` (gitignored);
4. records the actual assistant model from the event stream;
5. computes the metrics below.

`--auto-approve` is used only because the fixture copy is disposable. The extension itself never
edits the project. Headless runs intentionally skip independent judgement, so these results measure
the main-model discovery/ranking path and degraded-mode labelling, not the judge.

## Metrics and denominators

| Metric | Definition | Denominator |
| --- | --- | --- |
| Top-three hit rate | A seeded fixture counts as a hit when any of the first three rendered recommendation sections contains at least one case-insensitive ground-truth term. | Seeded fixtures with an extracted report. |
| Generic rate | Recommendation titles matching a ground-truth generic phrase (for example "add tests", "best practices"). This is a title heuristic, not a semantic classifier. | All extracted top-three recommendations. |
| Clean-control false positives | Recommendations in `clean-control` classified `MUST FIX / VERIFY NOW` or `OWNER DECISION REQUIRED`. `FUTURE WORK` is allowed. | The clean-control run. |
| Unverified presented as fact | A `MUST FIX / VERIFY NOW` section whose evidence status is `UNVERIFIED` or `CONFLICTING / INSUFFICIENT` and whose exact prompt does not contain the required "Before changing anything, verify" prefix. | All extracted top-three recommendations. |

These are coarse, single-run measurements. They do not measure recall outside the seeded issue, model
calibration, or whether a recommendation is a good idea.

## Results

Full suite run: 2026-11-27T07:25:51Z
Corrected clean-control rerun: 2026-11-27T07:26:55Z
Model: `deepseek-ai/DeepSeek-V4.1-Flash` (provider `dolphin`)
Configuration: headless `omp --mode json -p "/genie" --no-session --auto-approve
--max-cost 0.20 --max-time 300 -e src/extension.ts`; independent judgement intentionally skipped
because there is no interactive consent surface.

| Metric | Result |
| --- | ---: |
| Seeded fixtures with an extracted report | 8/8 |
| Top-three hit rate | 8/8 (100.0%) |
| Generic recommendations (title heuristic) | 0/24 (0.0%) |
| Clean-control recommendations (corrected control) | 2 |
| Clean-control MUST FIX / OWNER false positives (corrected control) | 0 |
| Unverified presented as fact | 0/24 (0.0%) |

| Fixture | Status | Hit | Recommendations | Generic | MUST FIX/OWNER false positives |
| --- | --- | --- | ---: | ---: | ---: |
| `security-token` | ok | yes | 3 | 0 | 0 |
| `tests-missing` | ok | yes | 3 | 0 | 0 |
| `perf-quadratic` | ok | yes | 2 | 0 | 0 |
| `docs-drift` | ok | yes | 3 | 0 | 0 |
| `deps-duplicate` | ok | yes | 2 | 0 | 0 |
| `architecture-duplicate` | ok | yes | 3 | 0 | 0 |
| `roadmap-gap` | ok | yes | 3 | 0 | 0 |
| `release-ops` | ok | yes | 3 | 0 | 0 |
| `clean-control` | ok | n/a | 2 | 0 | 0 (corrected rerun) |

### The clean-control history

The full-suite run used the original clean-control fixture and found two `OWNER DECISION REQUIRED`
items. Inspection showed both were real gaps in the fixture's own contract, not fabricated findings:

1. the README promised that non-string input throws, but `slugify` accepted `new String(...)` and
   duck-typed objects that exposed `.trim()`;
2. the README said input was lowercased before ASCII filtering, but the source trimmed first and the
   wording did not describe Unicode case-folding (U+212A, U+0130).

Those were flaws in the control fixture, so the fixture was corrected: an explicit string guard, a
stable error message, edge-case tests, and precise wording. The corrected clean control was rerun on
the same model/configuration. It produced two `FUTURE WORK` suggestions (an error-type assertion and a
redundant trim), no `MUST FIX` or `OWNER DECISION`, so the corrected control's high-severity false
positive count is 0.

Both the original and corrected clean-control runs are in `evals/.runs/`. The original run is not
hidden; its two findings demonstrate that the model can surface real contract gaps, not only seeded
ones.

### Security-token fixture after literal removal

The security-token fixture no longer stores a provider-shaped credential. Its repository copy uses a
neutral placeholder, and the harness injects a runtime-built fake Stripe test token into the
disposable temp copy. The fixture was rerun after that change:

- Run: 2026-11-27T07:55:33Z
- Result: 3 recommendations, seeded hit yes, 0/3 generic-titled, 0/3 unverified-as-fact, model
  `deepseek-ai/DeepSeek-V4.1-Flash`.
- The seeded hardcoded-credential issue was still found. This matches the original full-suite result
  for that fixture.

### What this does and does not show

- It shows the workflow can find the seeded issue in each of the eight seeded fixtures under this
  single model/run configuration, and that the tool's unverified-prompt rule held in every rendered
  recommendation.
- It does not establish accuracy, precision, recall, calibration, or generalisation. The fixtures are
  tiny and synthetic, the terms are broad, and there is one run per fixture.
- An earlier harness version failed to extract four reports because it only accepted assistant messages
  beginning with the report header. The extension now emits the authoritative report as a custom
  `genie-report` row, and the harness prefers that row; the table above is from the rerun with the
  fixed extractor. The earlier failures were harness defects, not missing model reports.

Raw output, extracted reports, and stderr logs are under `evals/.runs/<timestamp>/` (gitignored).

## Interpretation limits

- One run per fixture; model nondeterminism is unmeasured.
- The fixtures are intentionally tiny and synthetic. They test whether the workflow can find
  documented issues, not whether it generalises to large repositories.
- Term matching can count a passing mention as a hit and can miss a correct finding phrased
  differently.
- The clean control is one repository, not a statistical control set.
- No independent judge ran in these headless evaluations; judge quality is not measured here.
- Do not describe these results as accuracy, precision, recall, or calibration.
