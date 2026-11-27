import assert from "node:assert/strict";
import { test } from "node:test";
import { baseCandidate, baseInput, fakeJudgeAnswers } from "./helpers.ts";
import { fakeAwsKey } from "./fake-secrets.ts";
import { isRecord } from "../src/guards.ts";
import {
	buildJudgeQuestions,
	buildJudgeState,
	describeJudgeFailure,
	endpointHost,
	expectedAnswerIds,
	interpretJudgeResult,
	isTestedJudgeVersion,
	missingJudgeAnswerIds,
} from "../src/judge.ts";
import { evaluateCandidate } from "../src/scoring.ts";
import type { EvidenceSummary } from "../src/types.ts";

const emptySummary: EvidenceSummary = { quoteCount: 1, rangeCount: 0, failedCount: 0, checks: [] };

test("records the tested OMP version without gating on the minor", () => {
	assert.equal(isTestedJudgeVersion("19.2.1"), true);
	assert.equal(isTestedJudgeVersion("19.2.9"), false);
	assert.equal(isTestedJudgeVersion("19.3.0"), false);
	assert.equal(isTestedJudgeVersion("20.0.0"), false);
	assert.equal(isTestedJudgeVersion("omp/19.2.1"), false);
});

test("sanitises endpoint disclosure to a host without credentials or path", () => {
	assert.equal(endpointHost("https://user:secret@api.example.test/v1?key=abc"), "api.example.test");
	assert.equal(endpointHost("http://127.0.0.1:8080/v1"), "127.0.0.1:8080");
	assert.equal(endpointHost("file:///etc/passwd"), undefined);
	assert.equal(endpointHost("not a url"), undefined);
});

test("builds three typed questions per candidate", () => {
	const input = baseInput({
		candidates: [baseCandidate({ id: "first" }), baseCandidate({ id: "second", title: "Second" })],
	});
	const questions = buildJudgeQuestions(input);
	assert.equal(Object.keys(questions).length, 6);
	assert.deepEqual(Object.keys(questions).sort(), [
		"first_generic",
		"first_impact",
		"first_support",
		"second_generic",
		"second_impact",
		"second_support",
	]);
	const genericQuestion = questions.first_generic;
	const impactQuestion = questions.first_impact;
	assert.equal(isRecord(genericQuestion) ? genericQuestion.type : undefined, "noul");
	assert.equal(isRecord(impactQuestion) ? impactQuestion.type : undefined, "score");
});

test("builds a sanitized judge state without conversation or next prompts", () => {
	const input = baseInput({
		candidates: [
			baseCandidate({
				nextPrompt: "do the secret thing",
				evidence: [
					{
						kind: "file",
						path: "README.md",
						startLine: 1,
						endLine: 1,
						quote: fakeAwsKey,
					},
				],
			}),
		],
	});
	const evaluation = evaluateCandidate(input.candidates[0]!, emptySummary, undefined);
	const state = buildJudgeState(input, [evaluation]);
	const text = JSON.stringify(state);
	assert.equal(text.includes(fakeAwsKey), false);
	assert.equal(text.includes("do the secret thing"), false);
	assert.match(text, /REDACTED/u);
});

test("interprets complete answers and usage", () => {
	const input = baseInput({ candidates: [baseCandidate({ id: "c1" })] });
	const outcome = interpretJudgeResult(
		{
			api: "typesafe",
			provider: "typesafe",
			model: "jev-1.14.0",
			answers: fakeJudgeAnswers(["c1"]),
			usage: { input: 10, output: 2, totalTokens: 12, cost: { total: 0.0001 } },
		},
		input,
		"native",
	);
	assert.equal(outcome.status, "judged");
	assert.equal(outcome.api, "typesafe");
	assert.equal(outcome.model, "jev-1.14.0");
	assert.equal(outcome.kind, "native");
	assert.equal(outcome.byCandidate?.[0]?.generic, 0.2);
	assert.equal(outcome.usage?.total, 12);
	assert.deepEqual(outcome.answerIds, ["c1_generic", "c1_support", "c1_impact"]);
	assert.equal(outcome.validation, "all_answer_ids_present");
});

test("identifies every missing answer id", () => {
	const input = baseInput({ candidates: [baseCandidate({ id: "c1" })] });
	assert.deepEqual(expectedAnswerIds(input), ["c1_generic", "c1_support", "c1_impact"]);
	const answers = fakeJudgeAnswers(["c1"]);
	delete answers.c1_support;
	assert.deepEqual(missingJudgeAnswerIds(answers, input), ["c1_support"]);
	assert.throws(
		() => interpretJudgeResult({ api: "x", provider: "x", model: "x", answers }, input, "native"),
		/incomplete_judgment: missing c1_support/u,
	);
});

test("rejects incomplete judgement answers instead of inventing scores", () => {
	const input = baseInput({ candidates: [baseCandidate({ id: "c1" })] });
	assert.throws(
		() =>
			interpretJudgeResult(
				{ api: "x", provider: "x", model: "x", answers: {}, usage: {} },
				input,
				"native",
			),
		/incomplete_judgment/u,
	);
	assert.match(describeJudgeFailure(new Error("incomplete_judgment")), /incomplete/u);
	assert.match(describeJudgeFailure(new Error("judgment: no judge model available")), /no judge model/u);
	assert.match(describeJudgeFailure(new Error("judgment: every judge candidate failed: x")), /every judge/u);
	assert.match(describeJudgeFailure(new Error("unattributed_judgment")), /did not identify/u);
	assert.equal(describeJudgeFailure(new Error("https://secret.example/?key=abc")), "independent judge request failed");
});

test("rejects a result that does not identify its provider, model, and API", () => {
	const input = baseInput({ candidates: [baseCandidate({ id: "c1" })] });
	assert.throws(
		() =>
			interpretJudgeResult(
				{ provider: "p", model: "m", answers: fakeJudgeAnswers(["c1"]) },
				input,
				"native",
			),
		/unattributed_judgment/u,
	);
});
