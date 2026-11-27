import assert from "node:assert/strict";
import { test } from "node:test";
import { baseCandidate } from "./helpers.ts";
import {
	applyGenericCap,
	buildNextPrompt,
	classify,
	computeScore,
	evidenceStrength,
	finalEvidenceStatus,
	sortEvaluations,
	evaluateCandidate,
} from "../src/scoring.ts";
import type { EvidenceSummary } from "../src/types.ts";

function summary(quoteCount: number, rangeCount: number, failedCount = 0): EvidenceSummary {
	return { quoteCount, rangeCount, failedCount, checks: [] };
}

test("maps citation counts to evidence strength", () => {
	assert.equal(evidenceStrength(summary(0, 0)), 1);
	assert.equal(evidenceStrength(summary(0, 1)), 2);
	assert.equal(evidenceStrength(summary(0, 2)), 3);
	assert.equal(evidenceStrength(summary(1, 0)), 3);
	assert.equal(evidenceStrength(summary(2, 0)), 4);
	assert.equal(evidenceStrength(summary(3, 0)), 5);
});

test("computes the weighted heuristic score", () => {
	const score = computeScore(baseCandidate({ impact: 5, alignment: 5, feasibility: 5 }), 5);
	assert.equal(score.total, 100);
	assert.equal(score.impact, 30);
	assert.equal(score.alignment, 30);
	assert.equal(score.evidence, 25);
	assert.equal(score.feasibility, 15);
});

test("downgrades claimed status from code-side checks", () => {
	assert.equal(finalEvidenceStatus("VERIFIED", summary(0, 0), undefined), "UNVERIFIED");
	assert.equal(finalEvidenceStatus("VERIFIED", summary(1, 0), undefined), "VERIFIED");
	assert.equal(finalEvidenceStatus("VERIFIED", summary(1, 0, 1), undefined), "CONFLICTING / INSUFFICIENT");
	assert.equal(finalEvidenceStatus("UNVERIFIED", summary(1, 0), undefined), "UNVERIFIED");
	assert.equal(finalEvidenceStatus("VERIFIED", summary(1, 0), 0.2), "CONFLICTING / INSUFFICIENT");
});

test("applies the generic cap only with the correct basis", () => {
	assert.deepEqual(applyGenericCap(80, true, 0.7, 0), { total: 40, applied: true, basis: "independent" });
	assert.deepEqual(applyGenericCap(80, false, undefined, 0.8), {
		total: 40,
		applied: true,
		basis: "self_assessment",
	});
	assert.deepEqual(applyGenericCap(80, true, 0.3, 0.9), { total: 80, applied: false });
	assert.deepEqual(applyGenericCap(30, true, 0.9, 0), { total: 30, applied: false, basis: "independent" });
});

test("classifies owner decisions before technical fixes", () => {
	const owner = baseCandidate({ ownerDecision: { question: "Choose a deployment target?", options: ["A", "B"] } });
	assert.equal(classify(owner, 80), "OWNER DECISION REQUIRED");
	assert.equal(classify(owner, 40), "FUTURE WORK");
	assert.equal(classify(baseCandidate({ impact: 4 }), 80), "MUST FIX / VERIFY NOW");
	assert.equal(classify(baseCandidate({ impact: 3 }), 80), "FUTURE WORK");
});

test("prefixes unverified prompts with verification", () => {
	const candidate = baseCandidate({ verifyOrDo: "Run the startup command." });
	assert.equal(buildNextPrompt(candidate, "VERIFIED"), candidate.nextPrompt);
	assert.match(buildNextPrompt(candidate, "UNVERIFIED"), /^Before changing anything, verify: Run the startup command\./u);
	assert.match(buildNextPrompt(candidate, "CONFLICTING / INSUFFICIENT"), /If confirmed:/u);
});

test("evaluates and sorts candidates with judge answers", () => {
	const low = evaluateCandidate(
		baseCandidate({ id: "low", title: "Low", impact: 2, alignment: 2, feasibility: 2 }),
		summary(0, 0),
		undefined,
	);
	const high = evaluateCandidate(
		baseCandidate({ id: "high", title: "High", impact: 5, alignment: 5, feasibility: 5 }),
		summary(2, 0),
		{ generic: 0.1, support: 0.9, impact: { score: 3, confidence: 0.8 } },
	);
	assert.equal(high.finalEvidenceStatus, "VERIFIED");
	assert.equal(high.classification, "MUST FIX / VERIFY NOW");
	assert.equal(sortEvaluations([low, high])[0]?.candidate.id, "high");
});
