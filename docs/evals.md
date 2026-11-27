# Evaluation

Model-quality evaluation is opt-in. It is not part of CI and cannot establish statistical significance
or calibration. The deterministic tests in `test/` are the CI gate.

## Fixtures

Nine self-contained repositories live under `evals/fixtures/`. The answer key is
`evals/ground-truth/manifest.json`, outside every fixture cwd. The harness copies only the fixture
into a fresh temp directory before running either arm, so the answer key is not reachable from the
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

## Two arms

Both arms use the same fixtures, the same model, the same read-only tool set, the same per-run cost
and time caps, and no access to the answer key.

| Arm | Prompt | Tools | Output |
| --- | --- | --- | --- |
| Genie | `/genie` | `read`, `grep`, `glob`, `genie_rank` | Normal Genie report with classifications, evidence status, heuristic score |
| Baseline | `Review this project and recommend the three most valuable next steps.` | `read`, `grep`, `glob` | Plain assistant answer; no lenses, no ranking tool, no rubric |

Commands (per fixture, disposable temp copy as cwd):

```sh
# Genie
omp --mode json -p "/genie" --no-session --auto-approve \
  --tools read,grep,glob,genie_rank --max-cost 0.20 --max-time 300 \
  -e <repo>/src/extension.ts

# Baseline
omp --mode json -p "Review this project and recommend the three most valuable next steps." \
  --no-session --auto-approve --tools read,grep,glob --max-cost 0.20 --max-time 300
```

`--auto-approve` is used only because the fixture copy is disposable and the tool set contains no
execution-capable tools. The safety suite separately proves that default Genie does not activate
`bash`/`eval`/`task` even with `--auto-approve`, and that a marker-writing fixture script is not run.

Headless runs intentionally skip independent judgement, so these results measure the main-model
discovery/ranking path and degraded-mode labelling, not the judge.

## Repetitions and spend

Three repetitions per arm would be 9 fixtures × 2 arms × 3 = 54 runs. At the unchanged $0.20 per-run
cap that is $10.80, not under the stated $10.80 threshold. Per the rule, this run used **1 repetition
per fixture per arm = 18 runs**, with the caps unchanged. Actual reported spend is below.

## Metric extraction

Both arms are scored from the first three rendered recommendations.

- **Genie sections:** split on `## 1.` … `## 3.`.
- **Baseline sections:** join every assistant text message in the run (OMP can split one answer across
  several messages), then find numbered lines matching `1.`, `2.`, `3.` (with optional Markdown
  heading/bold markers); take the first sequence starting at 1; stop each section at the next chosen
  number. If no numbered recommendation sequence exists, the run contributes 0 recommendations and is
  reported as such.
- **Top-three hit rate:** a seeded fixture is a hit when any of the first three sections contains at
  least one case-insensitive ground-truth term. Denominator: seeded runs with an extracted report.
- **Generic recommendations:** a recommendation title contains a ground-truth generic phrase (for
  example "add tests", "best practices"). This is a title heuristic, not a semantic classifier.
  Denominator: all extracted top-three recommendations.
- **Clean-control high-severity false positives:** for Genie, recommendations classified `MUST FIX /
  VERIFY NOW` or `OWNER DECISION REQUIRED`. For the baseline, recommendations containing a defect
  keyword (`vulnerab*`, `security issue/bug/flaw`, `data loss`, `crash*`, `broken`, `incorrect`, `bug`,
  `fails`, `failure`, `does not work`, `is wrong`). Prescriptive words such as "must" are deliberately
  not counted: the baseline's clean-control answer uses them for constructive advice. The baseline has
  no classification field, so this keyword rule is coarser and is labelled as a heuristic.
  Denominator: the clean-control run.
- **Unverified claims presented as fact:** for Genie, a `MUST FIX / VERIFY NOW` section whose evidence
  status is `UNVERIFIED` or `CONFLICTING / INSUFFICIENT` and whose exact prompt lacks the required
  "Before changing anything, verify" prefix. For the baseline, a defect-keyword section with no
  file-path or line reference in the section **or anywhere in the report**; baseline answers often put
  the evidence table before the top-three sections, so counting only the section would overstate this
  metric. This is a proxy, not proof that a claim is unsupported.
- **Actual spend:** sum of `usage.cost.total` from assistant `message_end` events in the JSONL.
- **Model:** the `model` field of the assistant messages; both arms should match.
- **Cases where Genie adds nothing:** both arms hit the seeded issue and Genie has no fewer generic
  titles; the list also reports unverified-as-fact counts and cost. The clean control is listed with
  both arms' recommendation/false-positive counts and cost.

These are coarse, single-run measurements. Term matching can count a passing mention as a hit and can
miss a correct finding phrased differently. They do not measure recall outside the seeded issue,
model calibration, whether a recommendation is a good idea, or semantic accuracy.

## Results

Run: 2026-11-27T08:58:43Z
OMP: 19.2.1
Model: `deepseek-ai/DeepSeek-V4.1-Flash` (both arms)
Repetitions: 1 per fixture per arm (18 runs)
Caps: `--max-cost 0.20 --max-time 300`, unchanged
Ground truth: hidden; only each fixture was copied to a temp cwd

| Metric | Genie | Baseline |
| --- | ---: | ---: |
| Runs with a report | 9/9 | 9/9 |
| Seeded runs scored | 8 | 8 |
| Top-three hit rate | 8/8 (100.0%) | 8/8 (100.0%) |
| Generic recommendations (title heuristic) | 0/25 (0.0%) | 0/27 (0.0%) |
| Clean-control recommendations | 2 | 3 |
| Clean-control high-severity false positives | 1 | 1 |
| Unverified claims presented as fact | 0/25 (0.0%) | 0/27 (0.0%) |
| Actual reported spend | $0.100310 | $0.034986 |
| **Total actual spend** | **$0.135296** | |

Per-fixture hit and cost:

| Fixture | Genie hit | Baseline hit | Genie cost | Baseline cost |
| --- | --- | --- | ---: | ---: |
| `security-token` | yes | yes | $0.013573 | $0.003347 |
| `tests-missing` | yes | yes | $0.014820 | $0.007208 |
| `perf-quadratic` | yes | yes | $0.009907 | $0.005084 |
| `docs-drift` | yes | yes | $0.010224 | $0.001885 |
| `deps-duplicate` | yes | yes | $0.008788 | $0.002904 |
| `architecture-duplicate` | yes | yes | $0.008629 | $0.002084 |
| `roadmap-gap` | yes | yes | $0.011901 | $0.002686 |
| `release-ops` | yes | yes | $0.009448 | $0.000997 |
| `clean-control` | n/a | n/a | $0.013022 | $0.008790 |

### What this shows

- **No measured discovery advantage on this tiny suite.** The plain prompt found the seeded issue in
  all eight seeded fixtures, exactly like Genie. Genie also did not reduce generic titles or
  unverified-as-fact claims on these fixtures: both were 0.
- **Genie produced fewer recommendations** (25 vs 27) and cost about **2.9×** more
  ($0.100310 vs $0.034986).
- **The clean-control high-severity counts are 1 vs 1.** Genie's flag was an `OWNER DECISION
  REQUIRED` about Unicode normalization policy; the baseline's was a section containing "fails"
  about a missing package `exports` field. Both are constructive, not fabricated defects. The
  keyword/classification rules are coarse; inspect the saved reports rather than treating either
  count as precision.
- **What the metrics do not score:** evidence-citation checking, exact copy-ready prompts, the
  structured lens sweep, the static-only safety boundary, or consent-gated judge disclosure. Those
  are product properties, not measured recommendation quality.

### Cases where Genie adds nothing over the plain prompt

All eight seeded fixtures: both arms hit the seeded issue, both had 0 generic titles, both had 0
unverified-as-fact claims. Clean control: Genie 2 recommendations and 1 heuristic high-severity
flag; baseline 3 and 1. This is a negative result for the claim that Genie is demonstrably more
useful on these fixtures, and it is reported as such.

### Interpretation

These numbers do not establish that Genie is worse either: the fixture set is tiny, synthetic, and
single-run, and the plain prompt is a strong baseline on a repository whose README names the seeded
problem. They do establish that the repository cannot claim a measured top-three or evidence-discipline
advantage from this run. Do not describe Genie as more accurate, more precise, or calibrated.


## Interpretation limits

- One run per fixture per arm. Model nondeterminism is unmeasured.
- The fixtures are intentionally tiny and synthetic. They test whether the workflow can find
  documented issues, not whether it generalises to large repositories.
- The baseline severity/citation rules are keyword heuristics, not a semantic judge.
- The clean control is one repository, not a statistical control set.
- No independent judge ran in these headless evaluations; judge quality is not measured here.
- Do not describe these results as accuracy, precision, recall, or calibration.
