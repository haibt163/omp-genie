import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { isRecord } from "./guards.ts";
import { redactDeep } from "./sanitize.ts";
import type {
	CandidateEvaluation,
	GenieInput,
	JudgeCandidateAnswers,
	JudgeOutcome,
	JudgeUsage,
} from "./types.ts";

type HostModel = Parameters<ExtensionContext["models"]["family"]>[0];

export interface JudgeModelInfo {
	provider: string;
	id: string;
	api: string;
	baseUrl: string;
}

interface RawJudgmentResult {
	api?: unknown;
	provider?: unknown;
	model?: unknown;
	answers?: unknown;
	usage?: unknown;
}

interface CandidateJudge {
	judge(
		request: { state: unknown; questions: Record<string, unknown> },
		options?: { signal?: AbortSignal },
	): Promise<RawJudgmentResult>;
}

interface JudgeHandle {
	primaryModel?: () => unknown;
	withCandidate?: <T>(
		run: (judge: CandidateJudge, kind: string) => Promise<T>,
		options?: { signal?: AbortSignal },
	) => Promise<T>;
	judge?: (
		request: { state: unknown; questions: Record<string, unknown> },
		options?: { signal?: AbortSignal },
	) => Promise<RawJudgmentResult>;
}

interface JudgeModule {
	resolveJudge?: (deps: {
		settings: unknown;
		registry: unknown;
		sessionModel?: unknown;
		sessionId?: string;
		purpose: string;
	}) => JudgeHandle;
}

export interface JudgeProbe {
	available: boolean;
	reason?: string;
	primary?: JudgeModelInfo;
	judge?: JudgeHandle;
}

export const JUDGE_TIMEOUT_MS = 30_000;

export function isSupportedJudgeVersion(version: string): boolean {
	return /^19\.2\.\d+(?:[-+].*)?$/u.test(version.trim());
}

function modelInfo(model: unknown): JudgeModelInfo | undefined {
	if (!isRecord(model)) return undefined;
	const provider = model.provider;
	const id = model.id;
	const api = model.api;
	const baseUrl = model.baseUrl;
	if (
		typeof provider !== "string" ||
		typeof id !== "string" ||
		typeof api !== "string" ||
		typeof baseUrl !== "string"
	) {
		return undefined;
	}
	return { provider, id, api, baseUrl };
}

function sameFamily(ctx: ExtensionContext, primary: JudgeModelInfo): boolean {
	if (ctx.model === undefined) return false;
	try {
		return ctx.models.family(primary as HostModel) === ctx.models.family(ctx.model);
	} catch {
		return false;
	}
}

export async function probeJudge(ctx: ExtensionContext, version: string): Promise<JudgeProbe> {
	if (!isSupportedJudgeVersion(version)) {
		return { available: false, reason: `independent judge is not validated for OMP ${version}` };
	}
	let module: JudgeModule;
	try {
		// Static import cannot work here: `./judgment` is an internal OMP package export that may not
		// exist or may change shape in a different OMP build, and a static import failure would stop
		// the whole extension from loading before its degraded path can run.
		module = (await import("@oh-my-pi/pi-coding-agent/judgment")) as unknown as JudgeModule;
	} catch {
		return { available: false, reason: "independent judge module is unavailable in this OMP build" };
	}
	if (typeof module.resolveJudge !== "function") {
		return { available: false, reason: "independent judge API shape is incompatible" };
	}
	let settings: unknown;
	try {
		settings = ctx.modelRegistry.mirrorInputs().settings;
	} catch {
		return { available: false, reason: "session settings are unavailable to the judge adapter" };
	}
	if (settings === undefined || settings === null) {
		return { available: false, reason: "session settings are unavailable to the judge adapter" };
	}
	let judge: JudgeHandle;
	try {
		judge = module.resolveJudge({
			settings,
			registry: ctx.modelRegistry,
			sessionModel: ctx.model,
			sessionId: ctx.sessionManager.getSessionId(),
			purpose: "genie",
		});
	} catch {
		return { available: false, reason: "judge role could not be resolved" };
	}
	let primary: JudgeModelInfo | undefined;
	try {
		primary = modelInfo(typeof judge.primaryModel === "function" ? judge.primaryModel() : undefined);
	} catch {
		return { available: false, reason: "judge route could not report its primary model" };
	}
	if (primary === undefined) {
		return { available: false, reason: "no judge model is available for the configured route" };
	}
	if (sameFamily(ctx, primary)) {
		return { available: false, reason: "judge resolves to the active model family; it is not independent" };
	}
	return { available: true, primary, judge };
}

export function buildJudgeState(input: GenieInput, evaluations: CandidateEvaluation[]): Record<string, unknown> {
	const state = {
		projectGoals: input.projectGoals,
		focus: input.focus,
		assumptions: input.assumptions,
		lenses: input.lenses,
		candidates: input.candidates.map((candidate, index) => {
			const evaluation = evaluations[index];
			const checks = evaluation?.evidence.checks ?? [];
			return {
				id: candidate.id,
				title: candidate.title,
				lens: candidate.lens,
				observed: candidate.observed,
				whyItMatters: candidate.whyItMatters,
				verifyOrDo: candidate.verifyOrDo,
				evidence: candidate.evidence.map((item, evidenceIndex) => ({
					kind: item.kind,
					path: item.path,
					startLine: item.startLine,
					endLine: item.endLine,
					quote: item.quote,
					check: checks[evidenceIndex]?.check ?? "not_locally_checked",
				})),
				citationStatus: evaluation?.finalEvidenceStatus ?? "UNVERIFIED",
			};
		}),
	};
	return redactDeep(state);
}

export function buildJudgeQuestions(input: GenieInput): Record<string, unknown> {
	const questions: Record<string, unknown> = {};
	for (const candidate of input.candidates) {
		const id = candidate.id;
		questions[`${id}_generic`] = {
			type: "noul",
			instructions: `For candidate ${id} ("${candidate.title}"): Would this recommendation apply to almost any repository, rather than being materially specific to this project?`,
			criteria: {
				true: "It would apply to almost any repository with little or no change.",
				false: "It depends on this project's specific files, goals, or constraints.",
			},
		};
		questions[`${id}_support`] = {
			type: "noul",
			instructions: `For candidate ${id} ("${candidate.title}"): Does the supplied evidence support the stated observation without relying on assumptions?`,
			criteria: {
				true: "The cited evidence directly supports the observation.",
				false: "The observation is unsupported, contradicted, or relies on assumptions.",
			},
		};
		questions[`${id}_impact`] = {
			type: "score",
			instructions: `For candidate ${id} ("${candidate.title}"): If acted on, how much would this improve the project's stated goals?`,
			criteria: ["Negligible", "Minor", "Material", "Major", "Critical"],
		};
	}
	return questions;
}

function readProbability(answer: unknown): number {
	if (!isRecord(answer) || answer.type !== "noul" || typeof answer.noul !== "number") {
		throw new Error("incomplete_judgment");
	}
	if (!Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
		throw new Error("incomplete_judgment");
	}
	return answer.noul;
}

function readImpact(answer: unknown): JudgeCandidateAnswers["impact"] {
	if (
		!isRecord(answer) ||
		answer.type !== "score" ||
		typeof answer.score !== "number" ||
		typeof answer.confidence !== "number" ||
		!Number.isFinite(answer.score) ||
		!Number.isFinite(answer.confidence) ||
		answer.score < 0 ||
		answer.score > 4 ||
		answer.confidence < 0 ||
		answer.confidence > 1
	) {
		throw new Error("incomplete_judgment");
	}
	return { score: answer.score, confidence: answer.confidence };
}

function readUsage(raw: unknown): JudgeUsage | undefined {
	if (!isRecord(raw)) return undefined;
	const input = typeof raw.input === "number" && Number.isFinite(raw.input) ? raw.input : 0;
	const output = typeof raw.output === "number" && Number.isFinite(raw.output) ? raw.output : 0;
	const total =
		typeof raw.totalTokens === "number" && Number.isFinite(raw.totalTokens)
			? raw.totalTokens
			: input + output;
	const cost = isRecord(raw.cost) && typeof raw.cost.total === "number" && Number.isFinite(raw.cost.total)
		? raw.cost.total
		: undefined;
	return { input, output, total, ...(cost === undefined ? {} : { costUsd: cost }) };
}

export function interpretJudgeResult(
	result: RawJudgmentResult,
	input: GenieInput,
	kind: string,
): JudgeOutcome {
	const answers = result.answers;
	if (!isRecord(answers)) throw new Error("incomplete_judgment");
	const byCandidate: JudgeCandidateAnswers[] = input.candidates.map(candidate => {
		const generic = readProbability(answers[`${candidate.id}_generic`]);
		const support = readProbability(answers[`${candidate.id}_support`]);
		const impact = readImpact(answers[`${candidate.id}_impact`]);
		return { generic, support, impact };
	});
	const api = typeof result.api === "string" ? result.api : "unknown";
	const provider = typeof result.provider === "string" ? result.provider : "unknown";
	const model = typeof result.model === "string" ? result.model : "unknown";
	const mappedKind = kind === "native" ? "native" : kind === "text" || kind === "local" ? "prompted" : "unknown";
	const usage = readUsage(result.usage);
	return {
		status: "judged",
		api,
		provider,
		model,
		kind: mappedKind,
		...(usage === undefined ? {} : { usage }),
		byCandidate,
	};
}

export async function runJudge(
	probe: JudgeProbe,
	state: Record<string, unknown>,
	questions: Record<string, unknown>,
	input: GenieInput,
	signal: AbortSignal | undefined,
): Promise<JudgeOutcome> {
	if (!probe.available || probe.judge === undefined) {
		return { status: "degraded", reason: probe.reason ?? "independent judge is unavailable" };
	}
	const timeout = AbortSignal.timeout(JUDGE_TIMEOUT_MS);
	const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
	const safeQuestions = redactDeep(questions);
	try {
		if (typeof probe.judge.withCandidate === "function") {
			const outcome = await probe.judge.withCandidate(async (candidateJudge, kind) => {
				const result = await candidateJudge.judge({ state, questions: safeQuestions }, { signal: combined });
				return interpretJudgeResult(result, input, kind);
			}, { signal: combined });
			return outcome;
		}
		if (typeof probe.judge.judge === "function") {
			const result = await probe.judge.judge({ state, questions: safeQuestions }, { signal: combined });
			return interpretJudgeResult(result, input, "unknown");
		}
		return { status: "degraded", reason: "judge API shape is incompatible" };
	} catch (error) {
		return { status: "degraded", reason: describeJudgeFailure(error) };
	}
}

export function describeJudgeFailure(error: unknown): string {
	const name = error instanceof Error ? error.name : "";
	if (name === "AbortError" || name === "TimeoutError") return "judge request timed out or was aborted";
	const message = error instanceof Error ? error.message : "";
	if (message === "incomplete_judgment" || message.includes("incomplete")) return "judge returned incomplete answers";
	if (message.includes("no judge model")) return "no judge model available";
	if (message.includes("no API key")) return "judge credentials unavailable";
	if (message.includes("every judge candidate failed")) return "every judge candidate failed";
	return "independent judge request failed";
}

export function judgeDestination(primary: JudgeModelInfo): string {
	return `${primary.provider}/${primary.id} (${primary.api})`;
}
