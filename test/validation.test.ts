import assert from "node:assert/strict";
import { test } from "node:test";
import { baseCandidate, baseInput, baseLenses } from "./helpers.ts";
import { normalizeClaimedEvidenceStatus, normalizeFocus, parseGenieInput } from "../src/validate.ts";

test("accepts a valid input", () => {
	const result = parseGenieInput(structuredClone(baseInput()));
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value.candidates.length, 1);
		assert.equal(result.value.lenses.length, 9);
	}
});

test("normalizes focus and evidence status", () => {
	assert.equal(normalizeFocus(" Security "), "security");
	assert.equal(normalizeFocus(""), "all");
	assert.equal(normalizeFocus("unknown"), undefined);
	assert.equal(normalizeClaimedEvidenceStatus("conflicting / insufficient"), "CONFLICTING_INSUFFICIENT");
	assert.equal(normalizeClaimedEvidenceStatus("verified"), "VERIFIED");
});

test("rejects missing and duplicate lenses", () => {
	const missing = structuredClone(baseInput());
	missing.lenses = baseLenses().slice(0, 8);
	const missingResult = parseGenieInput(missing);
	assert.equal(missingResult.ok, false);
	if (!missingResult.ok) assert.ok(missingResult.errors.some(error => error.includes("missing lens")));

	const duplicate = structuredClone(baseInput());
	duplicate.lenses = baseLenses();
	duplicate.lenses[1] = { lens: "correctness", status: "finding" };
	const duplicateResult = parseGenieInput(duplicate);
	assert.equal(duplicateResult.ok, false);
	if (!duplicateResult.ok) assert.ok(duplicateResult.errors.some(error => error.includes("repeat")));
});

test("rejects too many candidates and bad focus", () => {
	const tooMany = structuredClone(baseInput());
	tooMany.candidates = Array.from({ length: 6 }, (_, index) =>
		baseCandidate({ id: `c${index + 1}` }),
	);
	const result = parseGenieInput(tooMany);
	assert.equal(result.ok, false);
	if (!result.ok) assert.ok(result.errors.includes("candidates: must contain at most 5 items"));

	const badFocus = structuredClone(baseInput());
	badFocus.focus = "nonsense" as never;
	const focusResult = parseGenieInput(badFocus);
	assert.equal(focusResult.ok, false);
	if (!focusResult.ok) assert.ok(focusResult.errors.some(error => error.startsWith("focus:")));
});

test("allows zero candidates and rejects invalid owner decisions", () => {
	const empty = structuredClone(baseInput());
	empty.candidates = [];
	assert.equal(parseGenieInput(empty).ok, true);

	const invalidOwner = structuredClone(baseInput());
	invalidOwner.candidates[0] = baseCandidate({
		ownerDecision: { question: "Short?", options: ["only one"] },
	});
	const result = parseGenieInput(invalidOwner);
	assert.equal(result.ok, false);
	if (!result.ok) assert.ok(result.errors.some(error => error.includes("options")));
});

test("enforces field limits and quote line requirements", () => {
	const longTitle = structuredClone(baseInput());
	longTitle.candidates[0] = baseCandidate({ title: "x".repeat(161) });
	assert.equal(parseGenieInput(longTitle).ok, false);

	const quoteWithoutLines = structuredClone(baseInput());
	quoteWithoutLines.candidates[0] = baseCandidate({
		evidence: [{ kind: "file", path: "README.md", quote: "Hello" }],
	});
	const result = parseGenieInput(quoteWithoutLines);
	assert.equal(result.ok, false);
	if (!result.ok) assert.ok(result.errors.some(error => error.includes("quote requires")));
});

test("rejects duplicate candidate ids", () => {
	const duplicate = structuredClone(baseInput());
	duplicate.candidates = [baseCandidate({ id: "same" }), baseCandidate({ id: "same", title: "Other" })];
	const result = parseGenieInput(duplicate);
	assert.equal(result.ok, false);
	if (!result.ok) assert.ok(result.errors.some(error => error.includes("unique")));
});
