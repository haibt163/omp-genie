import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { verifyAllEvidence } from "./evidence.ts";
import {
	FALLBACK_SOURCE,
	buildJudgeQuestions,
	buildJudgeState,
	judgeDestination,
	probeJudge as defaultProbeJudge,
	runJudge,
	type JudgeModelInfo,
	type JudgeProbe,
} from "./judge.ts";
import { formatReport, storedReport } from "./report.ts";
import { evaluateCandidate, sortEvaluations } from "./scoring.ts";
import type { CandidateEvaluation, GenieInput, JudgeOutcome, RankingResult } from "./types.ts";
import { parseGenieInput } from "./validate.ts";
import { sanitizeText } from "./sanitize.ts";
import type { GenieMode } from "./safety.ts";

export const MAX_JUDGE_STATE_BYTES = 16 * 1024;

export interface RankOptions {
	version: string;
	mode?: GenieMode;
	probeJudge?: (ctx: ExtensionContext, version: string) => Promise<JudgeProbe>;
}

function validationFailure(errors: string[]): RankingResult {
	const text = [
		"OMP Genie could not validate the input. Correct these fields and call `genie_rank` once more:",
		"",
		...errors.map(error => `- ${error}`),
	].join("\n");
	return {
		ok: false,
		report: text,
		details: { errors },
	};
}

function degraded(reason: string): JudgeOutcome {
	return { status: "degraded", reason };
}

function sameJudgeRoute(left: JudgeModelInfo, right: JudgeModelInfo): boolean {
	return (
		left.provider === right.provider &&
		left.id === right.id &&
		left.api === right.api &&
		left.baseUrl === right.baseUrl
	);
}

function consensusMessage(
	input: GenieInput,
	probe: JudgeProbe,
	bytes: number,
): string {
	const destination = probe.primary === undefined ? "unknown" : judgeDestination(probe.primary);
	const lines = [
		"OMP Genie will send sanitised project evidence to OMP's configured independent judge.",
		"",
	];
	if (probe.untestedVersion === true) {
		lines.push(
			`**${probe.versionWarning ?? "UNTESTED OMP VERSION"}**`,
			"All capability checks passed, but this adapter has not been exercised on this OMP version.",
			"",
		);
	}
	lines.push(`Primary destination: ${destination}`);
	const fallbacks = (probe.fallbacks ?? []).filter(
		candidate => probe.primary === undefined || !sameJudgeRoute(candidate, probe.primary),
	);
	if (fallbacks.length > 0) {
		lines.push("", "Configured candidates OMP may try next:");
		for (const candidate of fallbacks.slice(0, 5)) lines.push(`- ${judgeDestination(candidate)}`);
		if (fallbacks.length > 5) lines.push(`- and ${fallbacks.length - 5} more configured candidate(s)`);
		lines.push("Another provider may answer if an earlier candidate fails.");
	} else {
		lines.push("", `Fallback route: ${probe.fallbackSource ?? FALLBACK_SOURCE}.`, "Another provider may answer.");
	}
	lines.push(
		"If the configured chain has no native judge candidate, OMP may append the active session model.",
		"",
		`Evidence: project goals, lens results, and ${input.candidates.length} candidate(s) with paths, line ranges, and short redacted quotes (about ${bytes} bytes).`,
		"No conversation, full files, images, or next prompts are sent.",
		"Redaction is best-effort; secrets may remain.",
		"",
		"Proceed?",
	);
	return lines.join("\n");
}

function detailsFor(
	input: GenieInput,
	evaluations: CandidateEvaluation[],
	outcome: JudgeOutcome,
	interactive: boolean,
	mode: GenieMode,
): Record<string, unknown> {
	return {
		focus: input.focus,
		mode,
		interactive,
		verificationCommands: input.verificationCommands ?? [],
		candidateCount: input.candidates.length,
		recommendations: evaluations.slice(0, 3).map(evaluation => ({
			title: sanitizeText(evaluation.candidate.title).text,
			classification: evaluation.classification,
			evidenceStatus: evaluation.finalEvidenceStatus,
			score: evaluation.score.total,
			evidenceStrength: evaluation.evidenceStrength,
			genericCapApplied: evaluation.genericCapApplied,
			nextPrompt: sanitizeText(evaluation.nextPrompt).text,
		})),
		judge: {
			status: outcome.status,
			...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
			...(outcome.api === undefined ? {} : { api: outcome.api }),
			...(outcome.provider === undefined ? {} : { provider: outcome.provider }),
			...(outcome.model === undefined ? {} : { model: outcome.model }),
			...(outcome.kind === undefined ? {} : { kind: outcome.kind }),
			...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
			...(outcome.answerIds === undefined ? {} : { answerIds: outcome.answerIds }),
			...(outcome.validation === undefined ? {} : { validation: outcome.validation }),
			...(outcome.untestedVersion === undefined ? {} : { untestedVersion: outcome.untestedVersion }),
			...(outcome.versionWarning === undefined ? {} : { versionWarning: outcome.versionWarning }),
		},
	};
}

export async function rankCandidates(
	raw: unknown,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	options: RankOptions,
): Promise<RankingResult> {
	if (ctx.agent.kind !== "main") {
		return {
			ok: false,
			report: "OMP Genie runs only in the main session, not in a subagent.",
			details: { error: "subagent" },
		};
	}
	const parsed = parseGenieInput(raw);
	if (!parsed.ok) return validationFailure(parsed.errors);
	const input = parsed.value;
	const interactive = ctx.mode === "tui" && ctx.hasUI;
	const mode = options.mode ?? "static";

	let summaries;
	try {
		summaries = await verifyAllEvidence(input.candidates, ctx.cwd);
	} catch {
		return {
			ok: false,
			report: "OMP Genie could not check citations against the project. No report was produced.",
			details: { error: "citation_check_failed" },
		};
	}
	const preliminary = input.candidates.map((candidate, index) =>
		evaluateCandidate(
			candidate,
			summaries[index] ?? { quoteCount: 0, rangeCount: 0, failedCount: 0, checks: [] },
			undefined,
		),
	);

	let outcome = degraded(
		interactive
			? "independent judge is unavailable"
			: "interactive consent is unavailable in this host mode",
	);
	if (input.candidates.length === 0) {
		outcome = degraded("no candidates to judge");
	} else if (interactive) {
		let probe: JudgeProbe;
		try {
			probe = await (options.probeJudge ?? defaultProbeJudge)(ctx, options.version);
		} catch {
			probe = { available: false, reason: "judge capability check failed" };
		}
		if (!probe.available) {
			outcome = degraded(probe.reason ?? "independent judge is unavailable");
		} else {
			const state = buildJudgeState(input, preliminary);
			const questions = buildJudgeQuestions(input);
			const bytes = Buffer.byteLength(JSON.stringify(state), "utf8");
			if (bytes > MAX_JUDGE_STATE_BYTES) {
				return validationFailure([
					`sanitised judge evidence is ${bytes} bytes; the limit is ${MAX_JUDGE_STATE_BYTES}. Shorten observed/whyItMatters/verifyOrDo text or use fewer/shorter evidence quotes.`,
				]);
			}
			let approved = false;
			let consentError = false;
			try {
				approved = await ctx.ui.confirm(
					"OMP Genie — independent review consent",
					consensusMessage(input, probe, bytes),
				);
			} catch {
				consentError = true;
			}
			if (approved) {
				outcome = await runJudge(probe, state, questions, input, signal);
			} else {
				outcome = degraded(consentError ? "consent dialog failed" : "consent declined");
			}
		}
	}

	if (
		outcome.status === "judged" &&
		(outcome.byCandidate?.length ?? 0) !== input.candidates.length
	) {
		outcome = degraded("judge returned incomplete answers");
	}
	if (
		outcome.status === "judged" &&
		ctx.model !== undefined &&
		outcome.provider === ctx.model.provider &&
		outcome.model === ctx.model.id
	) {
		outcome = degraded("judge answered with the active model; it is not independent");
	}

	const evaluations = sortEvaluations(
		input.candidates.map((candidate, index) => {
			const judge = outcome.status === "judged" ? outcome.byCandidate?.[index] : undefined;
			return evaluateCandidate(
				candidate,
				summaries[index] ?? { quoteCount: 0, rangeCount: 0, failedCount: 0, checks: [] },
				judge,
			);
		}),
	);
	const report = formatReport(
		input,
		evaluations,
		outcome,
		interactive,
		mode,
		options.version,
		ctx.model === undefined ? undefined : { provider: ctx.model.provider, id: ctx.model.id },
	);
	return {
		ok: true,
		report,
		stored: storedReport(input, evaluations),
		details: detailsFor(input, evaluations, outcome, interactive, mode),
	};
}
