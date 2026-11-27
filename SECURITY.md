# Security and privacy

## Reporting a vulnerability

Open a private report with the repository owner or use the project's configured security contact. Do
not include real credentials, private project files, or personal data in a report. Use synthetic
evidence.

## Execution model

Default `/genie` is **static-only at the OMP tool level**, not by prompt wording:

- Before the turn starts, Genie snapshots the user's active tools and replaces them with an explicit
  allowlist: `read`, `grep`, `glob`, and `genie_rank`.
- `bash`, `eval` (Python/JS), `debug`, `task`/subagents, `lsp`, `find`, `web_search`, `write`, `edit`,
  `ast_edit`, `github`, checkpoint/rewind, MCP tools, and every extension tool are excluded.
- OMP 19.2.1 may add host-managed command tools such as `report_issue`; they do not run project code.
- After setting the allowlist, Genie reads the active set back. If any unexpected tool remains, it
  restores the snapshot and refuses to start. It fails closed rather than claiming protection it does
  not have.
- The original set is restored after terminal completion, send failure, session clear, session
  switch/branch/tree (the transition is cancelled if restoration fails), and shutdown. A tool the
  user had already enabled is never removed by the restore.
- A `tool_call` guard blocks any non-allowlisted tool that is somehow invoked during the run.

`/genie --verify` remains static-only. It asks the main model to propose at most three exact
verification commands and prints them in the report. **Genie does not execute them.** OMP's extension
API can observe tool calls and request approvals, but it does not let an extension force a normal
approval prompt when the host was started with `--auto-approve`. Rather than add a second, weaker
approval and call it OMP's, verification mode stops at a proposal. The user runs a command under
their own OMP approval policy.

The default mode has no git or `gh` evidence. Those would require executing an external program;
Genie does not keep a fixed-argument runner in the static allowlist. The model can still read files
and infer what is documented, but it must mark git-history, issue/PR, test, build, and runtime lenses
as `not_inspected` or UNVERIFIED. This is a real evidence loss, stated in every report.

## What Genie accesses

- Local project files under the current OMP session's `cwd`, read-only, for model inspection and
  citation checks.
- The OMP session's model registry and settings, only to resolve the configured judge route.
- The optional independent judge, only inside a user-invoked `/genie` turn and only after an
  affirmative interactive TUI confirmation.

Genie does not add an MCP server, auth system, provider registry, telemetry, background job, or
network listener.

## What the main provider sees

File contents and tool results the main model reads go to the user's configured main provider as in
any ordinary OMP turn. That is the normal OMP data path; Genie does not add a second copy. The main
provider also sees the Genie prompt, the project goals summary, and the model's own candidates.

## Evidence sent to the judge

The sanitised judge payload contains project goals, lens results, and per-candidate evidence (paths,
line ranges, short quotes, citation status). It excludes the conversation, full files, images, system
prompts, and exact next prompts. It is capped at 16 KiB. Oversize input is rejected.

Path exclusions include `.env*`, private keys, credential stores, `.git`, `node_modules`, build output,
and common secret filenames. Content redaction covers common credential shapes, connection-URL
passwords, and password/token assignments.

**This is best-effort.** It cannot guarantee that every secret is found, that every redaction is
correct, or that quoted project content is free of sensitive information. A false negative is possible.
Do not run Genie on a project whose evidence you are not prepared to send to the configured judge
destination after reviewing the consent dialog.

## Consent

Independent judgement is skipped entirely in headless, RPC, ACP, and no-UI sessions. In the TUI, the
dialog shows:

- the primary provider/model/API and the sanitised endpoint host;
- the configured fallback candidates OMP could try, or, when they cannot be enumerated, the exact
  source of candidates (`modelRoles.judge`, `retry.fallbackChains.judge`, OMP role defaults, and the
  session-model fallback);
- the evidence categories and approximate sanitised byte count;
- that another provider may answer and that the actual returned backend is reported afterwards.

It never shows credentials or URL secrets. Declining sends nothing. Invoking `/genie` is not consent
to send evidence to an additional provider.

If the OMP version is not the tested 19.2.1, the dialog and report say **UNTESTED OMP VERSION**.
Capability checks must still pass; any failure means **NOT INDEPENDENTLY JUDGED**.

## Prompt injection

Project content is untrusted. Evidence quotes can contain instructions aimed at a model. Genie
delimits and caps evidence and instructs the judge to treat it as data, but prompt injection cannot be
fully prevented. Judge answers are advisory, not proof.

## Terminal output

Report text is stripped of ANSI/OSC/CSI sequences, C0/C1 controls (except newline and tab), DEL, and
bidi controls before display. Secret redaction is applied again to displayed text and stored prompts.

## No automatic execution

Default Genie never runs a recommendation, project script, test, build, package manager, edit, commit,
push, PR, or background job. `/genie-run` is an explicit TUI command and only sends the selected exact
prompt through `pi.sendUserMessage` under the user's normal tools and approval policy. It is not
Genie executing the recommendation.

## Limitations

- OMP's own secret obfuscation is disabled by default, conversation-scoped, and not used as a safety
  net for Genie's custom payload.
- The independent judge adapter uses an internal OMP export. Compatibility is decided by runtime
  capability checks, not a version number. The tested release is 19.2.1.
- The judge backend and its data-handling terms are outside this project. The consent dialog identifies
  the primary route and known fallbacks; OMP may still route differently, and the actual backend is
  reported afterwards.
- Static-only means no execution, not no network: the `read` tool can open URLs, and the main model
  call goes to the configured provider.
