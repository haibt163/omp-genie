import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { FOCUS_AREAS, type StoredReport } from "./types.ts";
import { sanitizeText } from "./sanitize.ts";
import { rankCandidates } from "./tool.ts";
import {
	GENIE_TOOL,
	HOST_SPECIAL_TOOLS,
	activeToolsForMode,
	isStaticTool,
	parseGenieArgs,
	unexpectedActiveTools,
	type GenieMode,
} from "./safety.ts";

interface ActiveRun {
	sessionId: string;
	snapshot: string[];
	mode: GenieMode;
}

function loadPrompt(focus: string, mode: GenieMode): string {
	const promptDir = new URL("../prompts/", import.meta.url);
	const genie = readFileSync(fileURLToPath(new URL("genie.md", promptDir)), "utf8");
	const rubric = readFileSync(fileURLToPath(new URL("rubric.md", promptDir)), "utf8");
	const modeInstruction =
		mode === "verify"
			? "Propose up to three exact verification commands in `verificationCommands`. They are listed in the report and are not executed by Genie."
			: "Do not propose verification commands in this mode; the report is a static-analysis result.";
	return `${genie}\n\n${modeInstruction}\n\n---\n\n${rubric}`
		.replaceAll("{{FOCUS}}", focus)
		.replaceAll("{{MODE}}", mode === "verify" ? "verification proposal" : "static-only");
}

function errorText(error: unknown): string {
	return sanitizeText(error instanceof Error ? error.message : String(error)).text;
}

export default function genieExtension(pi: ExtensionAPI): void {
	pi.setLabel("OMP Genie");
	const z = pi.zod;
	const lastBySession = new Map<string, StoredReport>();
	const activeRuns = new Map<string, ActiveRun>();

	const restoreTools = async (snapshot: readonly string[]): Promise<boolean> => {
		try {
			await pi.setActiveTools([...snapshot]);
			return true;
		} catch {
			return false;
		}
	};

	const failClosed = async (
		ctx: ExtensionCommandContext,
		snapshot: readonly string[],
		reason: string,
	): Promise<void> => {
		await restoreTools(snapshot);
		ctx.ui.notify(`OMP Genie did not start: ${reason}`, "error");
	};

	const evidenceSchema = z.object({
		kind: z.string(),
		path: z.string().optional(),
		startLine: z.number().optional(),
		endLine: z.number().optional(),
		quote: z.string().optional(),
		note: z.string().optional(),
	});

	const candidateSchema = z.object({
		id: z.string().optional(),
		title: z.string(),
		lens: z.string(),
		observed: z.string(),
		evidence: z.array(evidenceSchema),
		whyItMatters: z.string(),
		verifyOrDo: z.string(),
		nextPrompt: z.string(),
		impact: z.number(),
		alignment: z.number(),
		feasibility: z.number(),
		confidence: z.number(),
		evidenceStatus: z.string(),
		genericRisk: z.number(),
		ownerDecision: z
			.object({
				question: z.string(),
				options: z.array(z.string()),
			})
			.optional(),
		whatWouldChangeRanking: z.string(),
	});

	const verificationCommandSchema = z.object({
		command: z.string(),
		purpose: z.string(),
	});

	pi.registerTool({
		name: GENIE_TOOL,
		label: "Genie Rank",
		description:
			"Validate, score, classify, and optionally independently review Genie candidates. Call exactly once with the project goals, all nine lens results, and 0-5 evidence-backed candidates. Returns the final top-three report and exact next prompts.",
		parameters: z.object({
			projectGoals: z.string(),
			focus: z.string(),
			assumptions: z.string(),
			lenses: z.array(
				z.object({
					lens: z.string(),
					status: z.string(),
					note: z.string().optional(),
				}),
			),
			candidates: z.array(candidateSchema),
			verificationCommands: z.array(verificationCommandSchema).max(3).optional(),
		}),
		approval: "read",
		defaultInactive: true,
		loadMode: "essential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			try {
				const sessionId = ctx.sessionManager.getSessionId();
				const mode = activeRuns.get(sessionId)?.mode ?? "static";
				const result = await rankCandidates(params, ctx, signal, {
					version: pi.pi.VERSION,
					mode,
				});
				if (result.stored !== undefined) {
					lastBySession.set(sessionId, result.stored);
				}
				if (result.ok) {
					try {
						pi.sendMessage({
							customType: "genie-report",
							content: result.report,
							display: true,
							attribution: "agent",
							excludeFromContext: true,
						});
					} catch {
						// The tool result still carries the report if the custom row cannot be queued.
					}
				}
				return {
					content: [{ type: "text", text: result.report }],
					details: result.details,
					...(result.ok ? {} : { isError: true }),
				};
			} catch {
				return {
					content: [
						{
							type: "text",
							text: "OMP Genie failed unexpectedly while ranking. No external request was made after the failure; inspect OMP's extension error log.",
						},
					],
					details: { error: "unexpected_failure" },
					isError: true,
				};
			}
		},
	});

	pi.registerCommand("genie", {
		description:
			"Static-only project opportunity discovery. Optional --verify proposes exact commands without running them. Focus: architecture, security, performance, roadmap, tests, dependencies",
		handler: async (args, ctx) => {
			if (ctx.agent.kind !== "main") {
				ctx.ui.notify("OMP Genie runs only in the main session.", "warning");
				return;
			}
			const parsed = parseGenieArgs(args);
			if (!parsed.ok) {
				ctx.ui.notify(parsed.error, "error");
				return;
			}
			await ctx.waitForIdle();
			const sessionId = ctx.sessionManager.getSessionId();
			if (activeRuns.has(sessionId)) {
				ctx.ui.notify("OMP Genie is already running in this session.", "warning");
				return;
			}
			let prompt: string;
			try {
				prompt = loadPrompt(parsed.value.focus, parsed.value.mode);
			} catch {
				ctx.ui.notify("OMP Genie could not read its prompt files. Reinstall or check the package.", "error");
				return;
			}

			const snapshot = pi.getActiveTools();
			const requested = activeToolsForMode(parsed.value.mode);
			try {
				await pi.setActiveTools(requested);
			} catch {
				await failClosed(ctx, snapshot, "OMP could not restrict the active tools.");
				return;
			}
			const active = pi.getActiveTools();
			const unexpected = unexpectedActiveTools(active, parsed.value.mode);
			if (!active.includes(GENIE_TOOL)) {
				await failClosed(ctx, snapshot, "the ranking tool is not active after tool restriction.");
				return;
			}
			if (unexpected.length > 0) {
				await failClosed(
					ctx,
					snapshot,
					`OMP kept execution-capable tools active: ${unexpected.join(", ")}.`,
				);
				return;
			}

			activeRuns.set(sessionId, { sessionId, snapshot, mode: parsed.value.mode });
			try {
				await pi.sendUserMessage(prompt, { attribution: "agent" });
			} catch (error) {
				activeRuns.delete(sessionId);
				await restoreTools(snapshot);
				ctx.ui.notify(`OMP Genie could not start: ${errorText(error)}`, "error");
			}
		},
	});

	pi.registerCommand("genie-run", {
		description: "Run one exact prompt from the last Genie report (interactive TUI only)",
		handler: async (args, ctx) => {
			if (ctx.agent.kind !== "main") {
				ctx.ui.notify("OMP Genie runs only in the main session.", "warning");
				return;
			}
			if (ctx.mode !== "tui" || !ctx.hasUI) {
				ctx.ui.notify("Pick-to-run requires the interactive TUI. Copy one of the prompts above instead.", "info");
				return;
			}
			await ctx.waitForIdle();
			const stored = lastBySession.get(ctx.sessionManager.getSessionId());
			if (stored === undefined || stored.recommendations.length === 0) {
				ctx.ui.notify("No Genie report to run. Use /genie first.", "warning");
				return;
			}
			let selectedIndex: number | undefined;
			const text = args.trim();
			if (text !== "") {
				if (!/^\d+$/u.test(text)) {
					ctx.ui.notify("Use /genie-run with a number from 1 to 3.", "error");
					return;
				}
				selectedIndex = Number.parseInt(text, 10) - 1;
			} else {
				const options = stored.recommendations.map(
					(recommendation, index) => `${index + 1}. ${recommendation.title} — ${recommendation.classification}`,
				);
				const selected = await ctx.ui.select("Run a Genie recommendation", options);
				if (selected === undefined) return;
				const match = /^(\d+)\./u.exec(selected);
				selectedIndex = match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10) - 1;
			}
			const recommendation = selectedIndex === undefined
				? undefined
				: stored.recommendations[selectedIndex];
			if (recommendation === undefined) {
				ctx.ui.notify("That Genie recommendation does not exist.", "error");
				return;
			}
			try {
				await pi.sendUserMessage(recommendation.prompt, { attribution: "agent" });
			} catch (error) {
				ctx.ui.notify(`OMP Genie could not start that prompt: ${errorText(error)}`, "error");
			}
		},
	});

	pi.on("tool_call", (event, ctx) => {
		const run = activeRuns.get(ctx.sessionManager.getSessionId());
		if (run === undefined) return;
		if (isStaticTool(event.toolName) || event.toolName === GENIE_TOOL || HOST_SPECIAL_TOOLS[event.toolName]) {
			return;
		}
		return {
			block: true,
			reason:
				"OMP Genie is static-only. Shell, eval, debugger, package managers, subagents, MCP, and extension tools are unavailable during a Genie run.",
		};
	});

	pi.on("agent_end", async (event, ctx) => {
		if (event.willContinue || event.awaitingAsyncWork) return;
		const sessionId = ctx.sessionManager.getSessionId();
		const run = activeRuns.get(sessionId);
		if (run === undefined) return;
		activeRuns.delete(sessionId);
		if (!(await restoreTools(run.snapshot))) {
			ctx.ui.notify(
				"OMP Genie could not restore the previous active tools. Restart the session or set them explicitly.",
				"warning",
			);
		}
	});

	const restoreBeforeTransition = async (ctx: ExtensionContext): Promise<boolean> => {
		const sessionId = ctx.sessionManager.getSessionId();
		const run = activeRuns.get(sessionId);
		if (run === undefined) return true;
		if (!(await restoreTools(run.snapshot))) {
			ctx.ui.notify("OMP Genie could not restore tools; the session change was cancelled.", "error");
			return false;
		}
		activeRuns.delete(sessionId);
		return true;
	};

	pi.on("session_before_switch", async (_event, ctx) => {
		const restored = await restoreBeforeTransition(ctx);
		return restored ? undefined : { cancel: true };
	});

	pi.on("session_before_branch", async (_event, ctx) => {
		const restored = await restoreBeforeTransition(ctx);
		return restored ? undefined : { cancel: true };
	});

	pi.on("session_before_tree", async (_event, ctx) => {
		const restored = await restoreBeforeTransition(ctx);
		return restored ? undefined : { cancel: true };
	});

	pi.on("session_clear", async (_event, ctx) => {
		await restoreBeforeTransition(ctx);
		lastBySession.delete(ctx.sessionManager.getSessionId());
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		const run = activeRuns.get(sessionId);
		if (run !== undefined) await restoreTools(run.snapshot);
		activeRuns.delete(sessionId);
		lastBySession.delete(sessionId);
	});

	pi.on("session_switch", () => {
		activeRuns.clear();
		lastBySession.clear();
	});
}
