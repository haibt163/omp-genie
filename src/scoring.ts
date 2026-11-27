import type {
	CandidateEvaluation,
	CandidateInput,
	Classification,
	EvidenceSummary,
	FinalEvidenceStatus,
	JudgeCandidateAnswers,
	ScoreBreakdown,
} from "./types.ts";

export const WEIGHTS = {
	impact: 30,
	alignment: 30,
	evidence: 25,
	feasibility: 15,
} as const;

export const GENERIC_PROBABILITY_CAP = 0.65;
export const GENERIC_SELF_RISK_CAP = 0.7;
export const GENERIC_SCORE_CAP = 40;
export const OWNER_DECISION_MIN_SCORE = 50;
export const MUST_FIX_MIN_SCORE = 70;
export const MUST_FIX_MIN_IMPACT = 4;
export const JUDGE_SUPPORT_CONFLICT_MAX = 0.35;

export function evidenceStrength(summary: EvidenceSummary): number {
	if (summary.quoteCount >= 3) return 5;
	if (summary.quoteCount === 2) return 4;
	if (summary.quoteCount === 1) return 3;
	if (summary.rangeCount >= 2) return 3;
	if (summary.rangeCount === 1) return 2;
	return 1;
}

export function finalEvidenceStatus(
	claimed: CandidateInput["evidenceStatus"],
	summary: EvidenceSummary,
	judgeSupport: number | undefined,
): FinalEvidenceStatus {
	if (summary.failedCount > 0) return "CONFLICTING / INSUFFICIENT";
	if (judgeSupport !== undefined && judgeSupport <= JUDGE_SUPPORT_CONFLICT_MAX) {
		return "CONFLICTING / INSUFFICIENT";
	}
	if (claimed === "CONFLICTING_INSUFFICIENT") return "CONFLICTING / INSUFFICIENT";
	if (claimed === "UNVERIFIED") return "UNVERIFIED";
	if (summary.quoteCount + summary.rangeCount === 0) return "UNVERIFIED";
	return "VERIFIED";
}

export function computeScore(candidate: CandidateInput, strength: number): ScoreBreakdown {
	const impact = ((candidate.impact - 1) / 4) * WEIGHTS.impact;
	const alignment = ((candidate.alignment - 1) / 4) * WEIGHTS.alignment;
	const evidence = ((strength - 1) / 4) * WEIGHTS.evidence;
	const feasibility = ((candidate.feasibility - 1) / 4) * WEIGHTS.feasibility;
	return { impact, alignment, evidence, feasibility, total: Math.round(impact + alignment + evidence + feasibility) };
}

export function applyGenericCap(
	score: number,
	judged: boolean,
	genericProbability: number | undefined,
	selfRisk: number,
): { total: number; applied: boolean; basis?: "independent" | "self_assessment" } {
	if (judged && genericProbability !== undefined && genericProbability >= GENERIC_PROBABILITY_CAP) {
		return { total: Math.min(score, GENERIC_SCORE_CAP), applied: score > GENERIC_SCORE_CAP, basis: "independent" };
	}
	if (!judged && selfRisk >= GENERIC_SELF_RISK_CAP) {
		return { total: Math.min(score, GENERIC_SCORE_CAP), applied: score > GENERIC_SCORE_CAP, basis: "self_assessment" };
	}
	return { total: score, applied: false };
}

export function classify(
	candidate: CandidateInput,
	score: number,
): Classification {
	if (candidate.ownerDecision !== undefined && score >= OWNER_DECISION_MIN_SCORE) {
		return "OWNER DECISION REQUIRED";
	}
	if (score >= MUST_FIX_MIN_SCORE && candidate.impact >= MUST_FIX_MIN_IMPACT) {
		return "MUST FIX / VERIFY NOW";
	}
	return "FUTURE WORK";
}

export function buildNextPrompt(
	candidate: CandidateInput,
	status: FinalEvidenceStatus,
): string {
	if (status === "VERIFIED") return candidate.nextPrompt;
	const verification = candidate.verifyOrDo
		.replace(/^before changing anything,?\s*verify:\s*/i, "")
		.trim();
	return `Before changing anything, verify: ${verification}\n\nIf confirmed: ${candidate.nextPrompt}`;
}

export function evaluateCandidate(
	candidate: CandidateInput,
	summary: EvidenceSummary,
	judge: JudgeCandidateAnswers | undefined,
): CandidateEvaluation {
	const judged = judge !== undefined;
	const status = finalEvidenceStatus(candidate.evidenceStatus, summary, judge?.support);
	const strength = evidenceStrength(summary);
	const base = computeScore(candidate, strength);
	const capped = applyGenericCap(base.total, judged, judge?.generic, candidate.genericRisk);
	return {
		candidate,
		evidence: summary,
		finalEvidenceStatus: status,
		evidenceStrength: strength,
		score: { ...base, total: capped.total },
		genericCapApplied: capped.applied,
		...(capped.basis === undefined ? {} : { genericCapBasis: capped.basis }),
		classification: classify(candidate, capped.total),
		nextPrompt: buildNextPrompt(candidate, status),
		...(judge === undefined ? {} : { judge }),
	};
}

export function sortEvaluations(evaluations: CandidateEvaluation[]): CandidateEvaluation[] {
	return [...evaluations].sort((left, right) => {
		if (right.score.total !== left.score.total) return right.score.total - left.score.total;
		if (right.evidenceStrength !== left.evidenceStrength) return right.evidenceStrength - left.evidenceStrength;
		if (right.candidate.impact !== left.candidate.impact) return right.candidate.impact - left.candidate.impact;
		return left.candidate.title.localeCompare(right.candidate.title);
	});
}
