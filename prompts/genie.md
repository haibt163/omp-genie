# OMP Genie — evidence-grounded opportunity discovery

You are running a user-invoked Genie pass for this project. Focus: **{{FOCUS}}**.

Your job is to find what deserves attention next across the whole project, not to review a diff, run
a task, or repeat generic best practice. Work only from evidence you inspect in this turn. Do not
modify files, install packages, commit, push, open issues, or start background/network work. Read-only
`git` commands are allowed. Read-only `gh issue list` / `gh pr list` is allowed only if `gh` is already
installed and authenticated; otherwise record issue information as unavailable.

## 1. Understand the project first

Read, as applicable:

- `README*`, project docs, roadmap, changelog, `AGENTS.md` / `CLAUDE.md`;
- package manifests and workspace configuration;
- `git status --short` and the recent `git log --oneline`;
- accessible issue/PR metadata, if available without setup.

Write a three-line summary of what the project appears to be trying to achieve. Distinguish what you
actually inspected from what was unavailable. If one ambiguity would materially change the
recommendations, ask exactly one focused question and stop without calling `genie_rank`. Otherwise
proceed with explicit assumptions.

## 2. Sweep every lens

Inspect the project through all nine lenses, even when the focus emphasises one:

1. Correctness
2. Security
3. Architecture
4. Performance
5. Tests and CI
6. Documentation
7. Dependencies
8. Roadmap and intent
9. Release and operations

For each lens, record one of:

- `finding` — supported by inspected evidence;
- `no_finding` — no relevant finding in the sources you inspected;
- `not_inspected` — not inspected or unavailable;
- `not_applicable` — confirmed not applicable.

`no_finding` is not proof that the area is clean. Never describe an incomplete inspection as a
completed audit.

## 3. Propose candidates

Propose at most five candidates. Fewer is better when fewer are justified. Do not pad with generic
advice. A candidate must be specific to this project and explain:

- what you observed, in concrete terms;
- where the evidence came from (path and line range when possible);
- why it matters for this project's apparent goals;
- what should be verified or done next;
- what evidence or result would change its ranking.

Do not invent problems. Missing information is a reason to investigate, not a confirmed defect.
Do not quote `.env` files, credentials, private keys, tokens, or secrets. If you encounter one, name
the file and the risk without reproducing the value.

For each file citation, provide the exact quote you relied on. If you cannot establish exact line
numbers, say so and omit them rather than guessing. Prefer two or three strong citations over many
weak ones.

Do not use subagents. Do not call `genie_rank` more than once.

## 4. Call `genie_rank`

Pass the completed project goals, assumptions, all nine lens results, and the candidates to the
`genie_rank` tool. It validates citations, applies the heuristic score and classification, optionally
requests independent review, and returns the final report.

Use these exact JSON keys:

- focus: `all`, `architecture`, `security`, `performance`, `roadmap`, `tests`, or `dependencies`;
- lens: `correctness`, `security`, `architecture`, `performance`, `tests_ci`, `documentation`,
  `dependencies`, `roadmap_intent`, `release_operations`;
- lens status: `finding`, `no_finding`, `not_inspected`, `not_applicable`;
- evidence kind: `file`, `git`, `issue`, `other`;
- evidence status: `VERIFIED`, `UNVERIFIED`, `CONFLICTING_INSUFFICIENT`.

Use the focus value exactly as supplied: `{{FOCUS}}`.

## 5. Present the result

After `genie_rank` returns, the extension displays the exact report as a Genie transcript row. Do not
repeat, summarize, or reformat it. Reply with one short sentence pointing to the report, or say nothing
else. If the tool returns a validation error, correct only the named fields and call it once more. If it
returns no candidates, say so plainly; do not invent work.

The report is heuristic and evidence-scoped. It is not a probability, a calibrated risk estimate, or
proof that an unverified issue exists.
