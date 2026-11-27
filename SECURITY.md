# Security and privacy

## Reporting a vulnerability

Open a private report with the repository owner or use the project's configured security contact. Do
not include real credentials, private project files, or personal data in a report. Use synthetic
evidence.

## What Genie accesses

- Local project files under the current OMP session's `cwd`, read-only, for citation checks.
- The OMP session's model registry and settings, only to resolve the configured judge route.
- The optional independent judge, only inside a user-invoked `/genie` turn and only after an
  affirmative interactive TUI confirmation.

Genie does not add an MCP server, auth system, provider registry, telemetry, background job, or
network listener.

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
dialog names the primary destination, states that OMP's configured judge route may fall back, lists the
evidence categories, and shows the approximate byte count. Declining sends nothing.

Invoking `/genie` is not consent to send evidence to an additional provider.

## Prompt injection

Project content is untrusted. Evidence quotes can contain instructions aimed at a model. Genie
delimits and caps evidence and instructs the judge to treat it as data, but prompt injection cannot be
fully prevented. Judge answers are advisory, not proof.

## Terminal output

Report text is stripped of ANSI/OSC/CSI sequences, C0/C1 controls (except newline and tab), DEL, and
bidi controls before display. Secret redaction is applied again to displayed text and stored prompts.

## No automatic execution

The extension never runs a recommendation, edits a project file, commits, pushes, opens a PR, installs
a package, or schedules background work. `/genie-run` is an explicit TUI command and only sends the
selected exact prompt through `pi.sendUserMessage`. The Genie prompt also instructs the main model to
stay read-only.

## Limitations

- OMP's own secret obfuscation is disabled by default, conversation-scoped, and not used as a safety
  net for Genie's custom payload.
- The independent judge adapter uses an internal OMP export; compatibility is limited to the tested
  OMP minor and requires a visible degraded mode otherwise.
- The judge backend and its data-handling terms are outside this project. The consent dialog identifies
  the primary route where known; OMP may fall back, and the actual backend is reported afterwards.
