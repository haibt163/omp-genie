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

export interface JudgeCapability {
	imported: boolean;
	resolveJudge: boolean;
	settings: boolean;
	judgeResolved: boolean;
	methods: boolean;
	primaryModel: boolean;
	adapterShapes: boolean;
}

export interface JudgeProbe {
	available: boolean;
	reason?: string;
	primary?: JudgeModelInfo;
	judge?: JudgeHandle;
	untestedVersion?: boolean;
	versionWarning?: string;
	fallbacks?: JudgeModelInfo[];
	fallbackSource?: string;
	capability?: JudgeCapability;
}

export const JUDGE_TIMEOUT_MS = 30_000;

/**
 * The only OMP release this adapter has been exercised against. A different
 * version is allowed through the same capability checks, but the consent
 * dialog and report must say it is untested.
 */
export const TESTED_OMP_VERSION = "19.2.1";

export function isTestedJudgeVersion(version: string): boolean {
	return version.trim() === TESTED_OMP_VERSION;
}

export const FALLBACK_SOURCE =
	"OMP's judge model-role chain: modelRoles.judge, then retry.fallbackChains.judge or OMP role defaults; the active session model can be appended when the chain has no native judge candidate";

export function endpointHost(baseUrl: string): string | undefined {
	try {
		const url = new URL(baseUrl);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		return url.host.length > 0 ? url.host : undefined;
	} catch {
		return undefined;
	}
}

export function judgeDestination(primary: JudgeModelInfo): string {
	const host = endpointHost(primary.baseUrl);
	return `${primary.provider}/${primary.id} (${primary.api})${host === undefined ? "" : ` at ${host}`}`;
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
		// If the host cannot compare families, independence cannot be established.
		return true;
	}
}

function shapeProbePasses(): boolean {
	const candidate = {
		id: "shape_probe",
		title: "Shape probe",
		lens: "correctness",
		observed: "Probe.",
		evidence: [],
		whyItMatters: "Probe.",
		verifyOrDo: "Probe.",
		nextPrompt: "Probe.",
		impact: 1,
		alignment: 1,
		feasibility: 1,
		confidence: 0,
		evidenceStatus: "UNVERIFIED",
		genericRisk: 0,
		whatWouldChangeRanking: "Probe.",
	} as GenieInput["candidates"][number];
	const input: GenieInput = {
		projectGoals: "Probe.",
		focus: "all",
		assumptions: "",
		lenses: [],
		candidates: [candidate],
	};
	try {
		const questions = buildJudgeQuestions(input);
		const answers: Record<string, unknown> = {};
		for (const [id, question] of Object.entries(questions)) {
			if (!isRecord(question)) return false;
			if (question.type === "noul") answers[id] = { type: "noul", noul: 0.5 };
			else if (question.type === "score") {
				answers[id] = { type: "score", score: 2, confidence: 0.5, probabilities: {} };
			} else return false;
		}
		const outcome = interpretJudgeResult(
			{ api: "probe", provider: "probe", model: "probe", answers },
			input,
			"native",
		);
		return outcome.byCandidate?.length === 1 && outcome.answerIds?.length === 3;
	} catch {
		return false;
	}
}

async function enumerateJudgeFallbacks(
	ctx: ExtensionContext,
	settings: unknown,
): Promise<{ models: JudgeModelInfo[]; source: string }> {
	try {
		// These are internal subpaths used only for a user-facing fallback list. A build without
		// them must keep the judge working and fall back to the textual route description.
		const resolver = await import("@oh-my-pi/pi-coding-agent/config/model-resolver");
		const roles = await import("@oh-my-pi/pi-coding-agent/config/model-roles");
		if (typeof resolver.resolveRoleChain !== "function" || typeof roles.roleCandidatePool !== "function") {
			return { models: [], source: FALLBACK_SOURCE };
		}
		const pool = roles.roleCandidatePool("judge", settings as never, ctx.modelRegistry as never);
		const chain = resolver.resolveRoleChain("judge", settings as never, pool);
		const models: JudgeModelInfo[] = [];
		for (const candidate of chain) {
			const info = modelInfo(candidate.model);
			if (info !== undefined) models.push(info);
		}
		return { models, source: FALLBACK_SOURCE };
	} catch {
		return { models: [], source: FALLBACK_SOURCE };
	}
}

export async function probeJudge(ctx: ExtensionContext, version: string): Promise<JudgeProbe> {
	const untestedVersion = !isTestedJudgeVersion(version);
	const versionWarning = untestedVersion
		? `UNTESTED OMP VERSION ${version}; the judge adapter is validated only on ${TESTED_OMP_VERSION}`
		: undefined;
	const capability: JudgeCapability = {
		imported: false,
		resolveJudge: false,
		settings: false,
		judgeResolved: false,
		methods: false,
		primaryModel: false,
		adapterShapes: false,
	};
	const unavailable = (reason: string): JudgeProbe => ({
		available: false,
		reason,
		capability,
		...(untestedVersion ? { untestedVersion, versionWarning } : {}),
	});
	let module: JudgeModule;
	try {
		// Static import cannot work here: `./judgment` is an internal OMP package export that may not
		// exist or may change shape in a different OMP build, and a static import failure would stop
		// the whole extension from loading before its degraded path can run.
		module = (await import("@oh-my-pi/pi-coding-agent/judgment")) as unknown as JudgeModule;
		capability.imported = true;
	} catch {
		return unavailable("independent judge module is unavailable in this OMP build");
	}
	if (typeof module.resolveJudge !== "function") {
		return unavailable("independent judge API shape is incompatible");
	}
	capability.resolveJudge = true;
	let settings: unknown;
	try {
		settings = ctx.modelRegistry.mirrorInputs().settings;
	} catch {
		return unavailable("session settings are unavailable to the judge adapter");
	}
	if (settings === undefined || settings === null) {
		return unavailable("session settings are unavailable to the judge adapter");
	}
	capability.settings = true;
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
		return unavailable("judge role could not be resolved");
	}
	capability.judgeResolved = true;
	if (typeof judge.withCandidate !== "function" && typeof judge.judge !== "function") {
		return unavailable("judge API shape is incompatible");
	}
	capability.methods = true;
	if (typeof judge.primaryModel !== "function") {
		return unavailable("judge API shape is incompatible");
	}
	let primary: JudgeModelInfo | undefined;
	try {
		primary = modelInfo(judge.primaryModel());
	} catch {
		return unavailable("judge route could not report its primary model");
	}
	if (primary === undefined) {
		return unavailable("no judge model is available for the configured route");
	}
	capability.primaryModel = true;
	capability.adapterShapes = shapeProbePasses();
	if (!capability.adapterShapes) {
		return unavailable("judge question/answer shapes are incompatible with this adapter");
	}
	if (sameFamily(ctx, primary)) {
		return {
			available: false,
			reason: "judge resolves to the active model family; it is not independent",
			capability,
			...(untestedVersion ? { untestedVersion, versionWarning } : {}),
		};
	}
	const fallbacks = await enumerateJudgeFallbacks(ctx, settings);
	return {
		available: true,
		primary,
		judge,
		capability,
		fallbacks: fallbacks.models,
		fallbackSource: fallbacks.source,
		...(untestedVersion ? { untestedVersion, versionWarning } : {}),
	};
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

export function expectedAnswerIds(input: GenieInput): string[] {
	return input.candidates.flatMap(candidate => [
		`${candidate.id}_generic`,
		`${candidate.id}_support`,
		`${candidate.id}_impact`,
	]);
}

export function missingJudgeAnswerIds(answers: unknown, input: GenieInput): string[] {
	if (!isRecord(answers)) return expectedAnswerIds(input);
	return expectedAnswerIds(input).filter(id => !Object.hasOwn(answers, id));
}

export function interpretJudgeResult(
	result: RawJudgmentResult,
	input: GenieInput,
	kind: string,
): JudgeOutcome {
	const answers = result.answers;
	if (!isRecord(answers)) throw new Error("incomplete_judgment");
	const missing = missingJudgeAnswerIds(answers, input);
	if (missing.length > 0) throw new Error(`incomplete_judgment: missing ${missing.join(", ")}`);
	const byCandidate: JudgeCandidateAnswers[] = input.candidates.map(candidate => {
		const generic = readProbability(answers[`${candidate.id}_generic`]);
		const support = readProbability(answers[`${candidate.id}_support`]);
		const impact = readImpact(answers[`${candidate.id}_impact`]);
		return { generic, support, impact };
	});
	const api = typeof result.api === "string" ? result.api.trim() : "";
	const provider = typeof result.provider === "string" ? result.provider.trim() : "";
	const model = typeof result.model === "string" ? result.model.trim() : "";
	if (api.length === 0 || provider.length === 0 || model.length === 0) {
		throw new Error("unattributed_judgment");
	}
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
		answerIds: expectedAnswerIds(input),
		validation: "all_answer_ids_present",
	};
}

function withProbeVersion(outcome: JudgeOutcome, probe: JudgeProbe): JudgeOutcome {
	if (probe.untestedVersion !== true) return outcome;
	return {
		...outcome,
		untestedVersion: true,
		...(probe.versionWarning === undefined ? {} : { versionWarning: probe.versionWarning }),
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
		return withProbeVersion(
			{ status: "degraded", reason: probe.reason ?? "independent judge is unavailable" },
			probe,
		);
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
			return withProbeVersion(outcome, probe);
		}
		if (typeof probe.judge.judge === "function") {
			const result = await probe.judge.judge({ state, questions: safeQuestions }, { signal: combined });
			return withProbeVersion(interpretJudgeResult(result, input, "unknown"), probe);
		}
		return withProbeVersion({ status: "degraded", reason: "judge API shape is incompatible" }, probe);
	} catch (error) {
		return withProbeVersion({ status: "degraded", reason: describeJudgeFailure(error) }, probe);
	}
}

export function describeJudgeFailure(error: unknown): string {
	const name = error instanceof Error ? error.name : "";
	if (name === "AbortError" || name === "TimeoutError") return "judge request timed out or was aborted";
	const message = error instanceof Error ? error.message : "";
	if (message === "incomplete_judgment" || message.includes("incomplete")) return "judge returned incomplete answers";
	if (message === "unattributed_judgment") return "judge result did not identify its provider, model, and API";
	if (message.includes("no judge model")) return "no judge model available";
	if (message.includes("no API key")) return "judge credentials unavailable";
	if (message.includes("every judge candidate failed")) return "every judge candidate failed";
	return "independent judge request failed";
}
