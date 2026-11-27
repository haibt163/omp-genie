import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VERSION, type ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { FOCUS_AREAS, type Focus, type StoredReport } from "./types.ts";
import { sanitizeText } from "./sanitize.ts";
import { rankCandidates } from "./tool.ts";

interface ActiveRun {
	wasActive: boolean;
}

function parseFocus(args: string): Focus | undefined {
	const text = args.trim().toLowerCase();
	if (text === "" || text === "all") return "all";
	return (FOCUS_AREAS as readonly string[]).includes(text) ? (text as Focus) : undefined;
}

function loadPrompt(focus: Focus): string {
	const promptDir = new URL("../prompts/", import.meta.url);
	const genie = readFileSync(fileURLToPath(new URL("genie.md", promptDir)), "utf8");
	const rubric = readFileSync(fileURLToPath(new URL("rubric.md", promptDir)), "utf8");
	return `${genie}\n\n---\n\n${rubric}`.replaceAll("{{FOCUS}}", focus);
}

function errorText(error: unknown): string {
	return sanitizeText(error instanceof Error ? error.message : String(error)).text;
}

export default function genieExtension(pi: ExtensionAPI): void {
	pi.setLabel("OMP Genie");
	const z = pi.zod;
	const lastBySession = new Map<string, StoredReport>();
	const activeRuns = new Map<string, ActiveRun>();

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

	pi.registerTool({
		name: "genie_rank",
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
		}),
		approval: "read",
		defaultInactive: true,
		loadMode: "essential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			try {
				const result = await rankCandidates(params, ctx, signal, { version: VERSION });
				if (result.stored !== undefined) {
					lastBySession.set(ctx.sessionManager.getSessionId(), result.stored);
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
		description: "Find and rank project opportunities; optional focus: architecture, security, performance, roadmap, tests, dependencies",
		handler: async (args, ctx) => {
			if (ctx.agent.kind !== "main") {
				ctx.ui.notify("OMP Genie runs only in the main session.", "warning");
				return;
			}
			const focus = parseFocus(args);
			if (focus === undefined) {
				ctx.ui.notify(`Unknown focus. Use one of: ${FOCUS_AREAS.join(", ")}`, "error");
				return;
			}
			await ctx.waitForIdle();
			let prompt: string;
			try {
				prompt = loadPrompt(focus);
			} catch {
				ctx.ui.notify("OMP Genie could not read its prompt files. Reinstall or check the package.", "error");
				return;
			}
			const sessionId = ctx.sessionManager.getSessionId();
			const wasActive = pi.getActiveTools().includes("genie_rank");
			if (!wasActive) {
				try {
					await pi.setActiveTools([...pi.getActiveTools(), "genie_rank"]);
				} catch {
					ctx.ui.notify("OMP Genie could not activate its ranking tool.", "error");
					return;
				}
			}
			activeRuns.set(sessionId, { wasActive });
			try {
				await pi.sendUserMessage(prompt, { attribution: "agent" });
			} catch (error) {
				activeRuns.delete(sessionId);
				if (!wasActive) {
					try {
						await pi.setActiveTools(pi.getActiveTools().filter(name => name !== "genie_rank"));
					} catch {
						// The session may be shutting down.
					}
				}
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

	pi.on("agent_end", async (event, ctx) => {
		if (event.willContinue || event.awaitingAsyncWork) return;
		const sessionId = ctx.sessionManager.getSessionId();
		const run = activeRuns.get(sessionId);
		if (run === undefined) return;
		activeRuns.delete(sessionId);
		if (run.wasActive) return;
		try {
			const active = pi.getActiveTools();
			if (active.includes("genie_rank")) {
				await pi.setActiveTools(active.filter(name => name !== "genie_rank"));
			}
		} catch {
			// The session may be shutting down; the tool remains inactive next session.
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		activeRuns.delete(sessionId);
		lastBySession.delete(sessionId);
	});

	pi.on("session_switch", () => {
		activeRuns.clear();
		lastBySession.clear();
	});

	pi.on("session_clear", () => {
		activeRuns.clear();
		lastBySession.clear();
	});
}
