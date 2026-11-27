import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { baseCandidate, baseInput, fakeContext, fakeProbe } from "./helpers.ts";
import { rankCandidates } from "../src/tool.ts";
import type { GenieInput } from "../src/types.ts";

async function withProject(run: (cwd: string) => Promise<void>): Promise<void> {
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-genie-tool-"));
	try {
		await fs.writeFile(path.join(cwd, "README.md"), "Hello project\n");
		await run(cwd);
	} finally {
		await fs.rm(cwd, { recursive: true, force: true });
	}
}

function options(probe = fakeProbe(["c1"])) {
	return {
		version: "19.2.1",
		probeJudge: async () => probe,
	};
}

test("degrades without calling the judge in headless mode", async () => {
	await withProject(async cwd => {
		const { ctx, ui } = fakeContext({ cwd, mode: "print", hasUI: false });
		let probed = false;
		const result = await rankCandidates(structuredClone(baseInput()), ctx, undefined, {
			version: "19.2.1",
			probeJudge: async () => {
				probed = true;
				return fakeProbe(["c1"]);
			},
		});
		assert.equal(result.ok, true);
		assert.equal(probed, false);
		assert.equal(ui.confirmCalls, 0);
		assert.match(result.report, /NOT INDEPENDENTLY JUDGED/u);
		assert.match(result.report, /interactive consent is unavailable/u);
	});
});

test("degrades when consent is declined", async () => {
	await withProject(async cwd => {
		const { ctx, ui } = fakeContext({ cwd, confirmResult: false });
		let judged = false;
		const probe = fakeProbe(["c1"]);
		const result = await rankCandidates(structuredClone(baseInput()), ctx, undefined, {
			version: "19.2.1",
			probeJudge: async () => {
				judged = true;
				return probe;
			},
		});
		assert.equal(result.ok, true);
		assert.equal(judged, true);
		assert.equal(ui.confirmCalls, 1);
		assert.match(result.report, /consent declined/u);
		assert.match(result.report, /NOT INDEPENDENTLY JUDGED/u);
	});
});

test("reports the actual backend after affirmative consent", async () => {
	await withProject(async cwd => {
		const { ctx, ui } = fakeContext({ cwd, confirmResult: true });
		const result = await rankCandidates(structuredClone(baseInput()), ctx, undefined, options());
		assert.equal(result.ok, true);
		assert.equal(ui.confirmCalls, 1);
		assert.match(result.report, /Independent judgement used/u);
		assert.match(result.report, /judge-provider/u);
		assert.match(result.report, /Generic-advice probability/u);
		assert.match(result.report, /Not included in OMP session totals/u);
		const judge = result.details.judge;
		assert.equal(typeof judge, "object");
		if (typeof judge === "object" && judge !== null && "status" in judge) {
			assert.equal(judge.status, "judged");
		}
	});
});

test("degrades when the judge fails", async () => {
	await withProject(async cwd => {
		const { ctx } = fakeContext({ cwd, confirmResult: true });
		const result = await rankCandidates(
			structuredClone(baseInput()),
			ctx,
			undefined,
			options(fakeProbe(["c1"], { fail: true })),
		);
		assert.equal(result.ok, true);
		assert.match(result.report, /NOT INDEPENDENTLY JUDGED — independent judge request failed/u);
	});
});

test("downgrades evidence when the judge does not support it", async () => {
	await withProject(async cwd => {
		const { ctx } = fakeContext({ cwd, confirmResult: true });
		const result = await rankCandidates(
			structuredClone(baseInput()),
			ctx,
			undefined,
			options(fakeProbe(["c1"], { support: 0.1 })),
		);
		assert.equal(result.ok, true);
		assert.match(result.report, /Evidence status:\*\* CONFLICTING \/ INSUFFICIENT/u);
	});
});

test("applies the independent generic cap", async () => {
	await withProject(async cwd => {
		const { ctx } = fakeContext({ cwd, confirmResult: true });
		const input = baseInput({
			candidates: [baseCandidate({ id: "c1", impact: 5, alignment: 5, feasibility: 5 })],
		});
		const result = await rankCandidates(
			structuredClone(input),
			ctx,
			undefined,
			options(fakeProbe(["c1"], { generic: 0.9 })),
		);
		assert.equal(result.ok, true);
		assert.match(result.report, /Generic-advice cap applied at 40/u);
		assert.match(result.report, /Priority score \(heuristic\):\*\* 40\/100/u);
	});
});

test("rejects oversize judge evidence before consent", async () => {
	await withProject(async cwd => {
		const { ctx, ui } = fakeContext({ cwd, confirmResult: true });
		const big = "x".repeat(800);
		const input: GenieInput = baseInput({
			candidates: Array.from({ length: 5 }, (_, index) =>
				baseCandidate({
					id: `c${index + 1}`,
					title: `Candidate ${index + 1}`,
					observed: big,
					whyItMatters: big,
					verifyOrDo: big,
					evidence: Array.from({ length: 6 }, () => ({
						kind: "file" as const,
						path: "README.md",
						startLine: 1,
						endLine: 1,
						quote: "y".repeat(400),
					})),
				}),
			),
		});
		const result = await rankCandidates(
			structuredClone(input),
			ctx,
			undefined,
			options(fakeProbe(["c1", "c2", "c3", "c4", "c5"])),
		);
		assert.equal(result.ok, false);
		assert.match(result.report, /sanitised judge evidence is .* limit is 16384/u);
		assert.equal(ui.confirmCalls, 0);
	});
});

test("rejects a judge answer from the active model", async () => {
	await withProject(async cwd => {
		const { ctx } = fakeContext({
			cwd,
			confirmResult: true,
			model: { provider: "judge-provider", id: "judge-model" },
		});
		const result = await rankCandidates(
			structuredClone(baseInput()),
			ctx,
			undefined,
			options(fakeProbe(["c1"])),
		);
		assert.equal(result.ok, true);
		assert.match(result.report, /judge answered with the active model/u);
	});
});

test("rejects subagents and handles zero candidates", async () => {
	await withProject(async cwd => {
		const sub = fakeContext({ cwd, kind: "sub" });
		const subResult = await rankCandidates(structuredClone(baseInput()), sub.ctx, undefined, options());
		assert.equal(subResult.ok, false);
		assert.match(subResult.report, /main session/u);

		const main = fakeContext({ cwd });
		const empty = baseInput({ candidates: [] });
		const emptyResult = await rankCandidates(structuredClone(empty), main.ctx, undefined, options());
		assert.equal(emptyResult.ok, true);
		assert.match(emptyResult.report, /No evidence-backed candidates/u);
		assert.equal(main.ui.confirmCalls, 0);
	});
});

test("verification mode lists proposed commands and never claims execution", async () => {
	await withProject(async cwd => {
		const { ctx } = fakeContext({ cwd, mode: "print", hasUI: false });
		const input = baseInput({
			verificationCommands: [
				{ command: "npm test", purpose: "Run the documented test command." },
				{ command: "npm run build", purpose: "Check whether the build writes an artifact." },
			],
		});
		const result = await rankCandidates(structuredClone(input), ctx, undefined, {
			version: "19.2.1",
			mode: "verify",
			probeJudge: async () => fakeProbe(["c1"]),
		});
		assert.equal(result.ok, true);
		assert.match(result.report, /Proposed verification commands \(not executed by Genie\)/u);
		assert.match(result.report, /npm test/u);
		assert.match(result.report, /npm run build/u);
		assert.match(result.report, /Genie did not start a shell, package manager, or project script/u);
		assert.match(result.report, /\*\*OMP version:\*\* 19\.2\.1/u);
		assert.match(result.report, /\*\*Main model:\*\* unknown/u);
		assert.equal(result.stored?.verificationCommands.length, 2);
	});
});

test("static mode omits the proposed-command section", async () => {
	await withProject(async cwd => {
		const { ctx } = fakeContext({ cwd, mode: "print", hasUI: false });
		const input = baseInput({
			verificationCommands: [{ command: "npm test", purpose: "Should not be printed in static mode." }],
		});
		const result = await rankCandidates(structuredClone(input), ctx, undefined, options());
		assert.equal(result.ok, true);
		assert.doesNotMatch(result.report, /Proposed verification commands/u);
	});
});

test("discloses an untested OMP version and the configured fallback candidates", async () => {
	await withProject(async cwd => {
		const { ctx, ui } = fakeContext({ cwd, confirmResult: true });
		const probe = {
			...fakeProbe(["c1"]),
			untestedVersion: true,
			versionWarning: "UNTESTED OMP VERSION 19.3.0; the judge adapter is validated only on 19.2.1",
			fallbacks: [
				{
					provider: "judge-provider",
					id: "judge-model",
					api: "test",
					baseUrl: "https://judge.example/v1",
				},
				{
					provider: "fallback-provider",
					id: "fallback-model",
					api: "openai-completions",
					baseUrl: "https://fallback.example/v1?key=secret",
				},
			],
			fallbackSource: "OMP's judge model-role chain",
		};
		const result = await rankCandidates(structuredClone(baseInput()), ctx, undefined, {
			version: "19.3.0",
			probeJudge: async () => probe,
		});
		assert.equal(result.ok, true);
		assert.match(ui.confirmMessage ?? "", /UNTESTED OMP VERSION 19\.3\.0/u);
		assert.match(ui.confirmMessage ?? "", /Configured candidates OMP may try next/u);
		assert.match(ui.confirmMessage ?? "", /fallback-provider\/fallback-model/u);
		assert.match(ui.confirmMessage ?? "", /fallback\.example/u);
		assert.doesNotMatch(ui.confirmMessage ?? "", /key=secret/u);
		assert.match(result.report, /Judge compatibility:\*\* UNTESTED OMP VERSION 19\.3\.0/u);
	});
});
