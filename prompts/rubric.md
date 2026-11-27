# Genie rubric

This file is editable by users. The extension code enforces the limits, scoring formula,
classification order, and citation checks; this rubric explains what good input looks like.

Default `/genie` is static-only: `read`, `grep`, `glob`, and `genie_rank` are the only project tools.
Git history, `gh`, shells, package managers, tests, builds, debuggers, subagents, MCP, and extension
tools are unavailable. `/genie --verify` stays static and additionally asks for exact commands to
print; Genie does not execute them.

## Candidate fields

| Field | Meaning |
| --- | --- |
| `title` | Specific, short, project-named. Not "improve tests". |
| `lens` | One of the nine fixed lenses: `correctness`, `security`, `architecture`, `performance`, `tests_ci`, `documentation`, `dependencies`, `roadmap_intent`, `release_operations`. |
| `observed` | What was actually seen. No speculation presented as fact. |
| `evidence` | File citations with path, optional 1-based line range, optional exact quote. Non-file sources are allowed but are not locally verified. |
| `whyItMatters` | Consequence for this project's apparent goals, not a generic benefit. |
| `verifyOrDo` | The cheapest concrete check or action that would settle the finding. |
| `nextPrompt` | The exact prompt the user can run after verification. |
| `impact` | 1–5: consequence if true. |
| `alignment` | 1–5: connection to the project's stated/observed goals. |
| `feasibility` | 1–5: how practically the next step can be taken now. |
| `confidence` | 0–1 self-assessment. Not a calibrated probability. |
| `evidenceStatus` | `VERIFIED`, `UNVERIFIED`, or `CONFLICTING_INSUFFICIENT`. The tool may downgrade this. |
| `genericRisk` | 0–1 self-assessment that the advice would apply to almost any repository. |
| `ownerDecision` | Only for a genuine project-owner choice: a specific question and 2–5 real options. |
| `whatWouldChangeRanking` | A concrete observation or result that would move this candidate up or down. |
| `verificationCommands` | Verification-proposal mode only: 0–3 `{ command, purpose }` objects. Single-line commands for the user to run; never executed by Genie. |

## Evidence standard

- A file citation is locally checked: the path must stay inside the project, the line range must
  exist, and a quote must match the cited range after whitespace normalisation.
- Any missing, excluded, unreadable, out-of-range, or mismatched file citation downgrades the
  candidate to **CONFLICTING / INSUFFICIENT**.
- No verified file citation means **UNVERIFIED**, even if the model says `VERIFIED`.
- Git, issue, and other sources are not verified by the extension. In static-only mode they are also
  unavailable, so a lens that depends on them is `not_inspected`, not `no_finding`.
- Do not cite generated/vendor trees, `.git`, `node_modules`, build output, credential files, or
  secrets.

## How the heuristic score is computed

Component inputs are 1–5. Evidence strength is computed from citation checks, not supplied by the
model.

| Component | Weight | Normalisation |
| --- | ---: | --- |
| Impact | 30 | `(impact - 1) / 4 * 30` |
| Alignment | 30 | `(alignment - 1) / 4 * 30` |
| Evidence strength | 25 | `(strength - 1) / 4 * 25` |
| Feasibility | 15 | `(feasibility - 1) / 4 * 15` |

Evidence strength:

- 5: three or more verified quotes;
- 4: two verified quotes;
- 3: one verified quote, or two verified ranges without quotes;
- 2: one verified range without a quote;
- 1: no verified file citation.

Impact, alignment, and feasibility (75% combined) come from the main model; evidence strength (25%)
is computed by code from citation checks. The label is always **Priority score (heuristic)**. It is
not a probability or expected value.

The independent judge does not supply any of those four components. It can only cap a generic item
and downgrade evidence support; its impact rating is advisory/display-only and is not used in the
total.

## Generic-advice control

The independent judge is asked: "Would this recommendation apply to almost any repository, rather
than being materially specific to this project?"

- Independent probability ≥ 0.65 caps the score at 40.
- Without an independent judge, a self-assessed `genericRisk` ≥ 0.70 caps it at 40, labelled as a
  self-assessment, never as independent.

A generic item is future work, not a project-specific priority.

## Classification

Code applies this order:

1. Valid `ownerDecision` and score ≥ 50 → **OWNER DECISION REQUIRED**.
2. Score ≥ 70 and impact ≥ 4 → **MUST FIX / VERIFY NOW**.
3. Otherwise → **FUTURE WORK**.

Difficulty alone never makes something an owner decision. Evidence status is separate:
**VERIFIED**, **UNVERIFIED**, or **CONFLICTING / INSUFFICIENT**. Unverified items are always framed
as something to verify, and their next prompt starts with the verification step.

## Independent judge

The judge is a secondary check, not a second ranker. It is requested only after affirmative
interactive consent and only with the sanitised, bounded evidence payload. Its answers are shown
with the actual returned provider/model/API. A missing answer id, missing attribution, capability
failure, or same-model-family answer is **NOT INDEPENDENTLY JUDGED**, never a fabricated score.

On an OMP version other than 19.2.1, the judge is allowed only if the capability probe passes and
the dialog/report say **UNTESTED OMP VERSION**.

## Output discipline

- At most three recommendations.
- No padding and no generic checklist.
- Exact next prompt, ready to copy.
- Separate the main-model self-confidence, independent judge answers, and the heuristic score.
- Never imply that agreement between models proves a finding.
- Never present a heuristic score as calibrated or a judge probability as proof.
