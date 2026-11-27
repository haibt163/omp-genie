export const FOCUS_AREAS = [
	"architecture",
	"security",
	"performance",
	"roadmap",
	"tests",
	"dependencies",
] as const;

export type FocusArea = (typeof FOCUS_AREAS)[number];
export type Focus = FocusArea | "all";

export const LENSES = [
	"correctness",
	"security",
	"architecture",
	"performance",
	"tests_ci",
	"documentation",
	"dependencies",
	"roadmap_intent",
	"release_operations",
] as const;

export type Lens = (typeof LENSES)[number];

export const LENS_LABELS: Record<Lens, string> = {
	correctness: "Correctness",
	security: "Security",
	architecture: "Architecture",
	performance: "Performance",
	tests_ci: "Tests and CI",
	documentation: "Documentation",
	dependencies: "Dependencies",
	roadmap_intent: "Roadmap and intent",
	release_operations: "Release and operations",
};

export const LENS_STATUSES = ["finding", "no_finding", "not_inspected", "not_applicable"] as const;
export type LensStatus = (typeof LENS_STATUSES)[number];

export const CLAIMED_EVIDENCE_STATUSES = [
	"VERIFIED",
	"UNVERIFIED",
	"CONFLICTING_INSUFFICIENT",
] as const;
export type ClaimedEvidenceStatus = (typeof CLAIMED_EVIDENCE_STATUSES)[number];

export type FinalEvidenceStatus =
	| "VERIFIED"
	| "UNVERIFIED"
	| "CONFLICTING / INSUFFICIENT";

export type Classification =
	| "MUST FIX / VERIFY NOW"
	| "OWNER DECISION REQUIRED"
	| "FUTURE WORK";

export type EvidenceKind = "file" | "git" | "issue" | "other";

export interface EvidenceInput {
	kind: EvidenceKind;
	path?: string;
	startLine?: number;
	endLine?: number;
	quote?: string;
	note?: string;
}

export interface OwnerDecisionInput {
	question: string;
	options: string[];
}

export interface CandidateInput {
	id: string;
	title: string;
	lens: Lens;
	observed: string;
	evidence: EvidenceInput[];
	whyItMatters: string;
	verifyOrDo: string;
	nextPrompt: string;
	impact: number;
	alignment: number;
	feasibility: number;
	confidence: number;
	evidenceStatus: ClaimedEvidenceStatus;
	genericRisk: number;
	ownerDecision?: OwnerDecisionInput;
	whatWouldChangeRanking: string;
}

export interface LensReport {
	lens: Lens;
	status: LensStatus;
	note?: string;
}

export interface GenieInput {
	projectGoals: string;
	focus: Focus;
	assumptions: string;
	lenses: LensReport[];
	candidates: CandidateInput[];
}

export type EvidenceCheckCode =
	| "verified"
	| "range_only"
	| "missing"
	| "out_of_range"
	| "excluded"
	| "unreadable"
	| "binary"
	| "too_large"
	| "quote_mismatch"
	| "outside_project"
	| "not_locally_checked";

export interface EvidenceCheck {
	kind: EvidenceKind;
	path?: string;
	startLine?: number;
	endLine?: number;
	check: EvidenceCheckCode;
	detail?: string;
}

export interface EvidenceSummary {
	quoteCount: number;
	rangeCount: number;
	failedCount: number;
	checks: EvidenceCheck[];
}

export interface JudgeImpactAnswer {
	score: number;
	confidence: number;
}

export interface JudgeCandidateAnswers {
	generic: number;
	support: number;
	impact: JudgeImpactAnswer;
}

export interface JudgeUsage {
	input: number;
	output: number;
	total: number;
	costUsd?: number;
}

export interface JudgeOutcome {
	status: "judged" | "degraded";
	reason?: string;
	api?: string;
	provider?: string;
	model?: string;
	kind?: "native" | "prompted" | "unknown";
	usage?: JudgeUsage;
	byCandidate?: JudgeCandidateAnswers[];
}

export interface ScoreBreakdown {
	impact: number;
	alignment: number;
	evidence: number;
	feasibility: number;
	total: number;
}

export interface CandidateEvaluation {
	candidate: CandidateInput;
	evidence: EvidenceSummary;
	finalEvidenceStatus: FinalEvidenceStatus;
	evidenceStrength: number;
	score: ScoreBreakdown;
	genericCapApplied: boolean;
	genericCapBasis?: "independent" | "self_assessment";
	classification: Classification;
	nextPrompt: string;
	judge?: JudgeCandidateAnswers;
}

export interface StoredRecommendation {
	title: string;
	classification: Classification;
	prompt: string;
}

export interface StoredReport {
	focus: Focus;
	createdAt: number;
	recommendations: StoredRecommendation[];
}

export interface RankingResult {
	ok: boolean;
	report: string;
	stored?: StoredReport;
	details: Record<string, unknown>;
}

export function focusLabel(focus: Focus): string {
	return focus === "all" ? "all lenses" : focus;
}
