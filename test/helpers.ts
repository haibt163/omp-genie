import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { LENSES, type CandidateInput, type GenieInput, type LensReport } from "../src/types.ts";
import type { JudgeProbe } from "../src/judge.ts";

export function baseCandidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
	return {
		id: "c1",
		title: "Check the startup contract",
		lens: "correctness",
		observed: "The documented startup path is not covered by a test.",
		evidence: [{ kind: "file", path: "README.md", startLine: 1, endLine: 1, quote: "Hello project" }],
		whyItMatters: "A regression would be silent for new users.",
		verifyOrDo: "Run the documented startup command and inspect the result.",
		nextPrompt: "Add a startup smoke test and run it.",
		impact: 4,
		alignment: 4,
		feasibility: 4,
		confidence: 0.7,
		evidenceStatus: "VERIFIED",
		genericRisk: 0.2,
		whatWouldChangeRanking: "A passing startup test would lower this.",
		...overrides,
	};
}

export function baseLenses(): LensReport[] {
	return LENSES.map(lens => ({ lens, status: "no_finding" as const }));
}

export function baseInput(overrides: Partial<GenieInput> = {}): GenieInput {
	return {
		projectGoals: "Ship a small, reliable project.",
		focus: "all",
		assumptions: "The README describes the intended behaviour.",
		lenses: baseLenses(),
		candidates: [baseCandidate()],
		...overrides,
	};
}

export interface FakeUi {
	confirmCalls: number;
	selectCalls: number;
	confirmResult: boolean;
	confirmTitle?: string;
	confirmMessage?: string;
	notifications: string[];
	confirm: (title: string, message: string) => Promise<boolean>;
	select: (title: string, options: string[]) => Promise<string | undefined>;
	notify: (message: string, kind?: string) => void;
}

export function fakeUi(confirmResult = true): FakeUi {
	const state: FakeUi = {
		confirmCalls: 0,
		selectCalls: 0,
		confirmResult,
		notifications: [],
		confirm: async (title, message) => {
			state.confirmCalls += 1;
			state.confirmTitle = title;
			state.confirmMessage = message;
			return state.confirmResult;
		},
		select: async () => {
			state.selectCalls += 1;
			return undefined;
		},
		notify: message => {
			state.notifications.push(message);
		},
	};
	return state;
}

export interface FakeContextOptions {
	cwd: string;
	mode?: "tui" | "rpc" | "json" | "print";
	hasUI?: boolean;
	kind?: "main" | "sub";
	confirmResult?: boolean;
	sessionId?: string;
	model?: { provider: string; id: string };
}

export function fakeContext(options: FakeContextOptions): { ctx: ExtensionContext; ui: FakeUi } {
	const ui = fakeUi(options.confirmResult ?? true);
	const ctx = {
		agent: { kind: options.kind ?? "main", id: "Main", name: "main", depth: 0 },
		mode: options.mode ?? "tui",
		hasUI: options.hasUI ?? true,
		cwd: options.cwd,
		ui,
		...(options.model === undefined ? {} : { model: options.model }),
		sessionManager: {
			getSessionId: () => options.sessionId ?? "session-1",
		},
	} as unknown as ExtensionContext;
	return { ctx, ui };
}

export function fakeJudgeAnswers(candidateIds: string[]): Record<string, unknown> {
	const answers: Record<string, unknown> = {};
	for (const id of candidateIds) {
		answers[`${id}_generic`] = { type: "noul", noul: 0.2 };
		answers[`${id}_support`] = { type: "noul", noul: 0.9 };
		answers[`${id}_impact`] = { type: "score", score: 3.5, confidence: 0.8, probabilities: {} };
	}
	return answers;
}

export function fakeProbe(
	candidateIds: string[],
	overrides: { generic?: number; support?: number; fail?: boolean } = {},
): JudgeProbe {
	const answers = fakeJudgeAnswers(candidateIds);
	if (overrides.generic !== undefined) {
		for (const id of candidateIds) {
			answers[`${id}_generic`] = { type: "noul", noul: overrides.generic };
		}
	}
	if (overrides.support !== undefined) {
		for (const id of candidateIds) {
			answers[`${id}_support`] = { type: "noul", noul: overrides.support };
		}
	}
	const candidateJudge = {
		judge: async (_request: { state: unknown; questions: Record<string, unknown> }) => ({
			api: "test",
			provider: "judge-provider",
			model: "judge-model",
			answers,
			usage: { input: 100, output: 20, totalTokens: 120, cost: { total: 0.001 } },
		}),
	};
	return {
		available: true,
		primary: { provider: "judge-provider", id: "judge-model", api: "test", baseUrl: "https://judge.example/v1" },
		judge: {
			withCandidate: async <T>(run: (judge: typeof candidateJudge, kind: string) => Promise<T>): Promise<T> => {
				if (overrides.fail === true) throw new Error("judge failed");
				return run(candidateJudge, "native");
			},
		},
	};
}
