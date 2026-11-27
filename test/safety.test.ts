import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { z } from "@oh-my-pi/omptype/zod";
import genieExtension from "../src/extension.ts";
import {
	GENIE_TOOL,
	activeToolsForMode,
	isExecutionCapableTool,
	parseGenieArgs,
	unexpectedActiveTools,
} from "../src/safety.ts";

interface FakeState {
	active: string[];
	sent: string[];
	tools: Map<string, unknown>;
	commands: Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>;
	handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
	restrictTo?: string[];
	restoreError?: boolean;
	sendError?: Error;
	notifications: Array<{ message: string; kind?: string }>;
}

function fakePi(initial: string[]): { pi: ExtensionAPI; state: FakeState } {
	const state: FakeState = {
		active: [...initial],
		sent: [],
		tools: new Map(),
		commands: new Map(),
		handlers: new Map(),
		notifications: [],
	};
	let calls = 0;
	const pi = {
		zod: z,
		pi: { VERSION: "19.2.1" },
		setLabel: () => {},
		registerTool: (tool: { name: string }) => {
			state.tools.set(tool.name, tool);
		},
		registerCommand: (
			name: string,
			definition: { handler: (args: string, ctx: unknown) => Promise<void> },
		) => {
			state.commands.set(name, definition);
		},
		on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
			const handlers = state.handlers.get(event) ?? [];
			handlers.push(handler);
			state.handlers.set(event, handlers);
		},
		getActiveTools: () => [...state.active],
		setActiveTools: async (names: string[]) => {
			calls += 1;
			if (calls > 1 && state.restoreError === true) throw new Error("restore failed");
			state.active = [...(calls === 1 && state.restrictTo !== undefined ? state.restrictTo : names)];
		},
		sendUserMessage: async (text: string) => {
			if (state.sendError !== undefined) throw state.sendError;
			state.sent.push(text);
		},
		sendMessage: () => {},
	};
	return { pi: pi as unknown as ExtensionAPI, state };
}

function fakeCtx(sessionId = "session-1") {
	const notifications: Array<{ message: string; kind?: string }> = [];
	return {
		ctx: {
			agent: { kind: "main" },
			mode: "print",
			hasUI: false,
			cwd: process.cwd(),
			waitForIdle: async () => {},
			sessionManager: { getSessionId: () => sessionId },
			ui: {
				notify: (message: string, kind?: string) => {
					notifications.push({ message, kind });
				},
				confirm: async () => false,
				select: async () => undefined,
			},
		} as unknown as Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1],
		notifications,
	};
}

async function runCommand(state: FakeState, args: string, sessionId = "session-1") {
	const command = state.commands.get("genie");
	assert.ok(command);
	const { ctx, notifications } = fakeCtx(sessionId);
	await command.handler(args, ctx);
	return { ctx, notifications };
}

async function emit(state: FakeState, event: string, payload: unknown, sessionId = "session-1") {
	const handlers = state.handlers.get(event) ?? [];
	const { ctx } = fakeCtx(sessionId);
	const results: unknown[] = [];
	for (const handler of handlers) results.push(await handler(payload, ctx));
	return results;
}

test("parses focus and the --verify opt-in", () => {
	assert.deepEqual(parseGenieArgs(""), { ok: true, value: { mode: "static", focus: "all" } });
	assert.deepEqual(parseGenieArgs("security"), { ok: true, value: { mode: "static", focus: "security" } });
	assert.deepEqual(parseGenieArgs("--verify security"), {
		ok: true,
		value: { mode: "verify", focus: "security" },
	});
	assert.deepEqual(parseGenieArgs("security --verify"), {
		ok: true,
		value: { mode: "verify", focus: "security" },
	});
	assert.equal(parseGenieArgs("--verify --yolo").ok, false);
	assert.equal(parseGenieArgs("quality").ok, false);
	assert.equal(parseGenieArgs("security tests").ok, false);
});

test("the active set is only read, grep, glob, and genie_rank in both modes", () => {
	for (const mode of ["static", "verify"] as const) {
		const active = activeToolsForMode(mode);
		assert.deepEqual(active.sort(), ["genie_rank", "glob", "grep", "read"]);
		assert.deepEqual(
			active.filter(name => isExecutionCapableTool(name)),
			[],
		);
	}
	assert.deepEqual(unexpectedActiveTools(["read", "grep", "glob", GENIE_TOOL, "report_issue"], "static"), []);
	assert.deepEqual(unexpectedActiveTools(["read", "grep", "glob", GENIE_TOOL, "bash", "mcp__x"], "static"), [
		"bash",
		"mcp__x",
	]);
});

test("default /genie activates only the static set and restores the original after completion", async () => {
	const original = ["read", "grep", "glob", "bash", "eval", "task", "write", "mcp__server_tool", "genie_rank"];
	const { pi, state } = fakePi(original);
	genieExtension(pi);
	await runCommand(state, "");
	assert.deepEqual(state.active.sort(), ["genie_rank", "glob", "grep", "read"]);
	assert.equal(state.sent.length, 1);
	assert.match(state.sent[0] ?? "", /static-only/);
	assert.match(state.sent[0] ?? "", /Do not propose verification commands/);

	await emit(state, "agent_end", { willContinue: false, awaitingAsyncWork: false });
	assert.deepEqual(state.active, original);
});

test("does not restore while the turn will continue, then restores on the terminal end", async () => {
	const original = ["read", "bash"];
	const { pi, state } = fakePi(original);
	genieExtension(pi);
	await runCommand(state, "");
	await emit(state, "agent_end", { willContinue: true });
	assert.ok(state.active.includes(GENIE_TOOL));
	assert.equal(state.active.includes("bash"), false);
	await emit(state, "agent_end", { willContinue: false });
	assert.deepEqual(state.active, original);
});

test("restores the original set when sendUserMessage fails", async () => {
	const original = ["read", "grep", "glob", "bash"];
	const { pi, state } = fakePi(original);
	state.sendError = new Error("send failed");
	genieExtension(pi);
	const { notifications } = await runCommand(state, "");
	assert.deepEqual(state.active, original);
	assert.ok(notifications.some(notification => notification.kind === "error"));
});

test("fails closed and restores when the host keeps an execution tool active", async () => {
	const original = ["read", "bash"];
	const { pi, state } = fakePi(original);
	state.restrictTo = ["read", "grep", "glob", "genie_rank", "bash"];
	genieExtension(pi);
	const { notifications } = await runCommand(state, "");
	assert.deepEqual(state.active, original);
	assert.equal(state.sent.length, 0);
	assert.ok(
		notifications.some(notification => notification.message.includes("execution-capable tools")),
	);
});

test("blocks an execution tool even if it is invoked during a static run", async () => {
	const { pi, state } = fakePi(["read", "grep", "glob"]);
	genieExtension(pi);
	await runCommand(state, "");
	const results = await emit(state, "tool_call", { type: "tool_call", toolName: "bash", input: {} });
	assert.deepEqual(results[0], {
		block: true,
		reason:
			"OMP Genie is static-only. Shell, eval, debugger, package managers, subagents, MCP, and extension tools are unavailable during a Genie run.",
	});
	const allowed = await emit(state, "tool_call", { type: "tool_call", toolName: "read", input: {} });
	assert.equal(allowed[0], undefined);
});

test("session transitions restore the original set and cancel if restoration fails", async () => {
	const { pi, state } = fakePi(["read", "bash"]);
	genieExtension(pi);
	await runCommand(state, "");
	const switched = await emit(state, "session_before_switch", { type: "session_before_switch" });
	assert.deepEqual(state.active, ["read", "bash"]);
	assert.equal(switched[0], undefined);

	const second = fakePi(["read", "bash"]);
	second.state.restoreError = true;
	genieExtension(second.pi);
	await runCommand(second.state, "");
	const cancelled = await emit(second.state, "session_before_switch", { type: "session_before_switch" });
	assert.deepEqual(cancelled[0], { cancel: true });
});

test("verification mode is still static and never activates bash", async () => {
	const original = ["read", "grep", "glob", "bash"];
	const { pi, state } = fakePi(original);
	genieExtension(pi);
	await runCommand(state, "--verify");
	assert.deepEqual(state.active.sort(), ["genie_rank", "glob", "grep", "read"]);
	assert.match(state.sent[0] ?? "", /verification proposal/);
	assert.match(state.sent[0] ?? "", /not executed by Genie/);
	assert.equal(state.active.includes("bash"), false);
});
