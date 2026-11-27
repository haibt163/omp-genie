import { FOCUS_AREAS, type Focus } from "./types.ts";

/**
 * The only project-facing tools Genie may activate. They read files and search
 * text; none of them starts a process, writes a file, loads an extension, or
 * calls a model.
 *
 * Deliberately absent: bash, eval, debug, task, lsp, find, web_search, write,
 * edit, ast_edit, github, checkpoint/rewind, MCP tools, and every extension
 * tool. `read` can open archives and databases in-process; it does not execute
 * project code.
 */
export const STATIC_TOOL_ALLOWLIST = ["read", "grep", "glob"] as const;

export const GENIE_TOOL = "genie_rank";

/**
 * Host-managed command tools that OMP may add beside the selected set. OMP
 * 19.2.1 adds `report_issue` in every mode; the deferred-change commands are
 * inert without write/edit tools. None of them runs a project script.
 */
export const HOST_SPECIAL_TOOLS: Readonly<Record<string, true>> = {
	resolve: true,
	reject: true,
	propose: true,
	report_issue: true,
	// Hidden host state/scratchpad tools. They do not start a process or write
	// project files; they may appear when goal mode or external thinking is on.
	goal: true,
	think: true,
	yield: true,
};

export type GenieMode = "static" | "verify";

export interface GenieArgs {
	mode: GenieMode;
	focus: Focus;
}

export type GenieArgsResult =
	| { ok: true; value: GenieArgs }
	| { ok: false; error: string };

export function parseGenieArgs(args: string): GenieArgsResult {
	const tokens = args.trim().split(/\s+/u).filter(Boolean);
	let mode: GenieMode = "static";
	let focus: Focus | undefined;
	for (const token of tokens) {
		const lower = token.toLowerCase();
		if (lower === "--verify") {
			mode = "verify";
			continue;
		}
		if (lower.startsWith("-")) {
			return { ok: false, error: `Unknown option: ${token}` };
		}
		if (focus !== undefined) {
			return { ok: false, error: "Use one focus at a time." };
		}
		if (lower === "all") {
			focus = "all";
		} else if ((FOCUS_AREAS as readonly string[]).includes(lower)) {
			focus = lower as Focus;
		} else {
			return {
				ok: false,
				error: `Unknown focus. Use one of: all, ${FOCUS_AREAS.join(", ")}`,
			};
		}
	}
	return { ok: true, value: { mode, focus: focus ?? "all" } };
}

export function activeToolsForMode(_mode: GenieMode): string[] {
	// Verification mode is also static-only. It collects proposed commands and
	// prints them; it never activates a shell or a runner.
	return [...STATIC_TOOL_ALLOWLIST, GENIE_TOOL];
}

export function isStaticTool(name: string): boolean {
	return (STATIC_TOOL_ALLOWLIST as readonly string[]).includes(name);
}

export function isExecutionCapableTool(name: string): boolean {
	return !isStaticTool(name) && name !== GENIE_TOOL && HOST_SPECIAL_TOOLS[name] !== true;
}

/**
 * Names that the host added despite the requested set. Anything outside the
 * explicit allowlist, Genie's own tool, and the verified host-managed command
 * tools makes the run fail closed: a host that cannot restrict execution must
 * not be treated as static-only.
 */
export function unexpectedActiveTools(active: readonly string[], mode: GenieMode): string[] {
	const allowed = new Set(activeToolsForMode(mode));
	return active.filter(name => !allowed.has(name) && HOST_SPECIAL_TOOLS[name] !== true);
}
