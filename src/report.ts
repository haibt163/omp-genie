import { sanitizeText } from "./sanitize.ts";
import {
	LENS_LABELS,
	focusLabel,
	type CandidateEvaluation,
	type EvidenceCheck,
	type GenieInput,
	type JudgeOutcome,
	type StoredReport,
} from "./types.ts";
import type { GenieMode } from "./safety.ts";

const CHECK_LABELS: Record<EvidenceCheck["check"], string> = {
	verified: "verified quote",
	range_only: "range verified; no quote",
	missing: "file missing",
	out_of_range: "line range outside file",
	excluded: "path excluded from evidence reads",
	unreadable: "file unreadable",
	binary: "binary file ignored",
	too_large: "file or call budget exceeded",
	quote_mismatch: "quote did not match the cited range",
	outside_project: "path outside the project",
	not_locally_checked: "not locally checked",
};

function clean(text: string): string {
	return sanitizeText(text).text;
}

function percent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

function fence(text: string): string {
	const runs = text.match(/`+/gu) ?? [];
	let longest = 2;
	for (const run of runs) longest = Math.max(longest, run.length);
	const marker = "`".repeat(longest + 1);
	return `${marker}text\n${text}\n${marker}`;
}

function lensSummary(input: GenieInput): { inspected: string[]; skipped: string[] } {
	const inspected: string[] = [];
	const skipped: string[] = [];
	for (const report of input.lenses) {
		if (report.status === "not_inspected") skipped.push(LENS_LABELS[report.lens]);
		else inspected.push(LENS_LABELS[report.lens]);
	}
	return { inspected, skipped };
}

function evidenceLines(evaluation: CandidateEvaluation): string[] {
	if (evaluation.candidate.evidence.length === 0) {
		return ["- No evidence supplied. This cannot be **VERIFIED**."];
	}
	return evaluation.candidate.evidence.map((item, index) => {
		const check = evaluation.evidence.checks[index];
		const label = check === undefined ? "not checked" : CHECK_LABELS[check.check];
		const location = item.path === undefined
			? `${item.kind} source`
			: item.startLine === undefined
				? `\`${clean(item.path)}\``
				: `\`${clean(item.path)}:${item.startLine}-${item.endLine}\``;
		return `- ${location} — ${label}`;
	});
}

function judgeSection(evaluation: CandidateEvaluation, outcome: JudgeOutcome): string[] {
	if (outcome.status !== "judged") {
		return [`**Independent judge:** NOT INDEPENDENTLY JUDGED — ${clean(outcome.reason ?? "unavailable")}.`];
	}
	const answers = evaluation.judge;
	if (answers === undefined) {
		return ["**Independent judge:** NOT INDEPENDENTLY JUDGED for this candidate — missing answers."];
	}
	const backend = `${clean(outcome.api ?? "unknown")} / ${clean(outcome.provider ?? "unknown")} / ${clean(outcome.model ?? "unknown")}`;
	const kind = outcome.kind === "native" ? "native judgment API" : outcome.kind === "prompted" ? "prompted model; probabilities are not calibrated" : "unknown backend kind";
	const lines = [
		`**Independent judge:** ${backend} — ${kind}.`,
		`- Generic-advice probability: ${percent(answers.generic)} (cap applies at 65.0%).`,
		`- Evidence-support probability: ${percent(answers.support)}.`,
		`- Impact score: ${answers.impact.score.toFixed(2)}/4 (confidence ${answers.impact.confidence.toFixed(2)}). Advisory/display-only; it is not used in the heuristic total.`,
	];
	if (outcome.answerIds !== undefined) {
		lines.push(`- Answer ids: ${outcome.answerIds.length} expected, all present and validated.`);
	}
	if (outcome.untestedVersion === true) {
		lines.push(`- ${clean(outcome.versionWarning ?? "UNTESTED OMP VERSION")}. Capability checks passed.`);
	}
	if (outcome.usage !== undefined) {
		const cost = outcome.usage.costUsd === undefined
			? "cost not reported"
			: `reported cost $${outcome.usage.costUsd.toFixed(6)}`;
		lines.push(
			`- Usage: ${outcome.usage.input} input / ${outcome.usage.output} output tokens; ${cost}. Not included in OMP session totals.`,
		);
	} else {
		lines.push("- Usage: not reported by the judge backend.");
	}
	return lines;
}

function uncertainty(evaluation: CandidateEvaluation): string {
	switch (evaluation.finalEvidenceStatus) {
		case "VERIFIED":
			return "Citations and quotes were checked locally. This does not prove the finding is correct or that the independent judge is calibrated.";
		case "UNVERIFIED":
			return "No verified file citation supports this yet; treat it as a lead to investigate, not a confirmed problem.";
		case "CONFLICTING / INSUFFICIENT":
			return "Citations failed, or the independent judge did not find support. Inspect the cited evidence before acting.";
	}
}

function recommendationSection(
	evaluation: CandidateEvaluation,
	index: number,
	outcome: JudgeOutcome,
): string[] {
	const candidate = evaluation.candidate;
	const lines: string[] = [];
	lines.push(`## ${index + 1}. ${clean(candidate.title)}`);
	lines.push("");
	lines.push(`**Classification:** ${evaluation.classification}`);
	lines.push(`**Evidence status:** ${evaluation.finalEvidenceStatus}`);
	lines.push(`**Priority score (heuristic):** ${evaluation.score.total}/100`);
	lines.push("");
	lines.push("| Component | Input | Weighted |");
	lines.push("| --- | ---: | ---: |");
	lines.push(`| Impact | ${candidate.impact}/5 | ${evaluation.score.impact.toFixed(1)} |`);
	lines.push(`| Alignment | ${candidate.alignment}/5 | ${evaluation.score.alignment.toFixed(1)} |`);
	lines.push(`| Evidence strength | ${evaluation.evidenceStrength}/5 | ${evaluation.score.evidence.toFixed(1)} |`);
	lines.push(`| Feasibility | ${candidate.feasibility}/5 | ${evaluation.score.feasibility.toFixed(1)} |`);
	lines.push("");
	if (evaluation.genericCapApplied && evaluation.genericCapBasis !== undefined) {
		const basis = evaluation.genericCapBasis === "independent"
			? "independent judge"
			: "main-model self-assessment in degraded mode";
		lines.push(`> Generic-advice cap applied at 40 using the ${basis}.`);
		lines.push("");
	}
	lines.push(`**Main-model confidence (self-assessment):** ${candidate.confidence.toFixed(2)}`);
	lines.push("");
	lines.push(...judgeSection(evaluation, outcome));
	lines.push("");
	lines.push("**Evidence:**");
	lines.push(...evidenceLines(evaluation));
	lines.push("");
	lines.push(`**What was observed:** ${clean(candidate.observed)}`);
	lines.push("");
	lines.push(`**Why it matters:** ${clean(candidate.whyItMatters)}`);
	lines.push("");
	lines.push(`**Verification step:** ${clean(candidate.verifyOrDo)}`);
	lines.push("");
	if (evaluation.classification === "OWNER DECISION REQUIRED" && candidate.ownerDecision !== undefined) {
		lines.push(`**Owner decision:** ${clean(candidate.ownerDecision.question)}`);
		lines.push("");
		lines.push("Options:");
		for (const option of candidate.ownerDecision.options) lines.push(`- ${clean(option)}`);
		lines.push("");
	}
	lines.push("**Exact next prompt:**");
	lines.push("");
	lines.push(fence(clean(evaluation.nextPrompt)));
	lines.push("");
	lines.push(`**Remaining uncertainty:** ${uncertainty(evaluation)}`);
	lines.push("");
	lines.push(`**What would change this ranking:** ${clean(candidate.whatWouldChangeRanking)}`);
	lines.push("");
	return lines;
}

function verificationSection(input: GenieInput, mode: GenieMode): string[] {
	if (mode !== "verify") return [];
	const commands = input.verificationCommands ?? [];
	const lines = ["**Proposed verification commands (not executed by Genie):**", ""];
	if (commands.length === 0) {
		lines.push("None proposed. The findings remain static-analysis leads.");
		lines.push("");
		return lines;
	}
	for (let index = 0; index < commands.length; index += 1) {
		const entry = commands[index];
		if (entry === undefined) continue;
		lines.push(`${index + 1}. ${clean(entry.purpose)}`);
		lines.push("");
		lines.push(fence(clean(entry.command)));
		lines.push("");
	}
	lines.push("Run these yourself. OMP Genie did not start a shell, package manager, or project script.");
	lines.push("");
	return lines;
}

export function formatReport(
	input: GenieInput,
	evaluations: CandidateEvaluation[],
	outcome: JudgeOutcome,
	interactive: boolean,
	mode: GenieMode,
	version: string,
	mainModel?: { provider: string; id: string },
): string {
	const lines: string[] = [];
	lines.push(`# OMP Genie — ${focusLabel(input.focus)}`);
	lines.push("");
	lines.push(
		mode === "verify"
			? "**Execution mode:** static-only analysis. Proposed commands are listed below for you to run; Genie did not execute them."
			: "**Execution mode:** static-only. Genie activated only read, grep, and glob; no shell, package manager, or project script was available.",
	);
	lines.push(`**OMP version:** ${clean(version)}.`);
	lines.push(
		`**Main model:** ${mainModel === undefined ? "unknown" : `${clean(mainModel.provider)}/${clean(mainModel.id)}`}.`,
	);
	lines.push("");
	lines.push(`**Project goals (as understood):** ${clean(input.projectGoals)}`);
	lines.push("");
	lines.push(`**Assumptions:** ${clean(input.assumptions.length > 0 ? input.assumptions : "None stated.")}`);
	lines.push("");
	const summary = lensSummary(input);
	lines.push(`**Inspected lenses:** ${summary.inspected.length > 0 ? summary.inspected.join(", ") : "none"}.`);
	lines.push(`**Not inspected / unavailable:** ${summary.skipped.length > 0 ? summary.skipped.join(", ") : "none"}.`);
	lines.push("");
	lines.push(...verificationSection(input, mode));
	lines.push("| Lens | Result |");
	lines.push("| --- | --- |");
	for (const report of input.lenses) {
		const note = report.note === undefined ? "" : ` — ${clean(report.note).replaceAll("|", "\\|")}`;
		lines.push(`| ${LENS_LABELS[report.lens]} | ${report.status}${note} |`);
	}
	lines.push("");
	if (outcome.status === "judged") {
		lines.push(
			`**Independent judgement used:** ${clean(outcome.api ?? "unknown")} / ${clean(outcome.provider ?? "unknown")} / ${clean(outcome.model ?? "unknown")}.`,
		);
		if (outcome.untestedVersion === true) {
			lines.push(
				`**Judge compatibility:** ${clean(outcome.versionWarning ?? "UNTESTED OMP VERSION")}. Capability checks passed; the adapter is not validated on this version.`,
			);
		}
	} else if (evaluations.length === 0) {
		lines.push("**Independent judgement:** not requested — no candidates to judge.");
	} else {
		lines.push(`**Independent judgement:** NOT INDEPENDENTLY JUDGED — ${clean(outcome.reason ?? "unavailable")}.`);
	}
	lines.push("");
	if (evaluations.length === 0) {
		lines.push("No evidence-backed candidates met the bar. No generic checklist was generated.");
		lines.push("");
	} else {
		const top = evaluations.slice(0, 3);
		for (let index = 0; index < top.length; index += 1) {
			const evaluation = top[index];
			if (evaluation !== undefined) lines.push(...recommendationSection(evaluation, index, outcome));
		}
	}
	if (interactive) {
		lines.push("Use `/genie-run <n>` to run one of these exact prompts. Nothing is run automatically.");
	} else {
		lines.push("Copy a prompt to run it. Pick-to-run requires the interactive TUI.");
	}
	lines.push("");
	lines.push("_Priority scores are heuristic, not probabilities or calibrated risk estimates._");
	return `${lines.join("\n")}\n`;
}

export function storedReport(
	input: GenieInput,
	evaluations: CandidateEvaluation[],
): StoredReport {
	return {
		focus: input.focus,
		createdAt: Date.now(),
		recommendations: evaluations.slice(0, 3).map(evaluation => ({
			title: clean(evaluation.candidate.title),
			classification: evaluation.classification,
			prompt: clean(evaluation.nextPrompt),
		})),
		verificationCommands: (input.verificationCommands ?? []).map(entry => ({
			command: clean(entry.command),
			purpose: clean(entry.purpose),
		})),
	};
}
