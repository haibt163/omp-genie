import {
	CLAIMED_EVIDENCE_STATUSES,
	FOCUS_AREAS,
	LENSES,
	LENS_STATUSES,
	type CandidateInput,
	type ClaimedEvidenceStatus,
	type EvidenceInput,
	type Focus,
	type GenieInput,
	type Lens,
	type LensReport,
	type LensStatus,
	type OwnerDecisionInput,
} from "./types.ts";
import { isRecord } from "./guards.ts";

export const LIMITS = {
	projectGoals: 1200,
	assumptions: 800,
	lensNote: 400,
	candidates: 5,
	title: 160,
	observed: 800,
	whyItMatters: 800,
	verifyOrDo: 800,
	nextPrompt: 4000,
	whatWouldChangeRanking: 500,
	evidenceItems: 6,
	evidencePath: 500,
	evidenceQuote: 400,
	evidenceNote: 300,
	ownerQuestion: 400,
	ownerOption: 120,
} as const;

export type ValidationResult =
	| { ok: true; value: GenieInput }
	| { ok: false; errors: string[] };

class Reader {
	readonly errors: string[] = [];
	readonly #maxErrors: number;

	constructor(maxErrors = 30) {
		this.#maxErrors = maxErrors;
	}

	fail(path: string, message: string): void {
		if (this.errors.length < this.#maxErrors) this.errors.push(`${path}: ${message}`);
	}

	string(
		value: unknown,
		path: string,
		minLength: number,
		maxLength: number,
		required = true,
	): string | undefined {
		if (value === undefined || value === null) {
			if (required) this.fail(path, "is required");
			return undefined;
		}
		if (typeof value !== "string") {
			this.fail(path, "must be a string");
			return undefined;
		}
		const text = value.trim();
		if (text.length < minLength) {
			this.fail(path, `must be at least ${minLength} characters`);
			return undefined;
		}
		if (text.length > maxLength) {
			this.fail(path, `must be at most ${maxLength} characters`);
			return undefined;
		}
		return text;
	}

	integer(value: unknown, path: string, min: number, max: number): number | undefined {
		if (typeof value !== "number" || !Number.isInteger(value)) {
			this.fail(path, "must be an integer");
			return undefined;
		}
		if (value < min || value > max) {
			this.fail(path, `must be between ${min} and ${max}`);
			return undefined;
		}
		return value;
	}

	number(value: unknown, path: string, min: number, max: number): number | undefined {
		if (typeof value !== "number" || !Number.isFinite(value)) {
			this.fail(path, "must be a finite number");
			return undefined;
		}
		if (value < min || value > max) {
			this.fail(path, `must be between ${min} and ${max}`);
			return undefined;
		}
		return value;
	}
}

export function normalizeFocus(value: unknown): Focus | undefined {
	if (typeof value !== "string") return undefined;
	const focus = value.trim().toLowerCase();
	if (focus === "" || focus === "all") return "all";
	return (FOCUS_AREAS as readonly string[]).includes(focus) ? (focus as Focus) : undefined;
}

export function normalizeClaimedEvidenceStatus(value: unknown): ClaimedEvidenceStatus | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value
		.trim()
		.toUpperCase()
		.replace(/[\s/]+/g, "_")
		.replace(/_+/g, "_");
	const aliases: Record<string, ClaimedEvidenceStatus> = {
		VERIFIED: "VERIFIED",
		UNVERIFIED: "UNVERIFIED",
		CONFLICTING: "CONFLICTING_INSUFFICIENT",
		INSUFFICIENT: "CONFLICTING_INSUFFICIENT",
		CONFLICTING_INSUFFICIENT: "CONFLICTING_INSUFFICIENT",
	};
	const status = aliases[normalized];
	return status && (CLAIMED_EVIDENCE_STATUSES as readonly string[]).includes(status) ? status : undefined;
}

function readEvidence(reader: Reader, raw: unknown, path: string): EvidenceInput | undefined {
	if (!isRecord(raw)) {
		reader.fail(path, "must be an object");
		return undefined;
	}
	const kindRaw = raw.kind;
	if (kindRaw !== "file" && kindRaw !== "git" && kindRaw !== "issue" && kindRaw !== "other") {
		reader.fail(`${path}.kind`, "must be file, git, issue, or other");
		return undefined;
	}
	const kind = kindRaw;
	const filePath = reader.string(raw.path, `${path}.path`, 1, LIMITS.evidencePath, kind === "file");
	const startLine =
		raw.startLine === undefined || raw.startLine === null
			? undefined
			: reader.integer(raw.startLine, `${path}.startLine`, 1, 10_000_000);
	const endLine =
		raw.endLine === undefined || raw.endLine === null
			? undefined
			: reader.integer(raw.endLine, `${path}.endLine`, 1, 10_000_000);
	const quote = reader.string(raw.quote, `${path}.quote`, 1, LIMITS.evidenceQuote, false);
	const note = reader.string(raw.note, `${path}.note`, 1, LIMITS.evidenceNote, false);

	if ((startLine === undefined) !== (endLine === undefined)) {
		reader.fail(path, "startLine and endLine must be supplied together");
	}
	if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
		reader.fail(path, "endLine must be greater than or equal to startLine");
	}
	if (quote !== undefined && startLine === undefined) {
		reader.fail(path, "quote requires startLine and endLine");
	}
	if (kind === "file" && filePath === undefined) return undefined;

	return {
		kind,
		...(filePath === undefined ? {} : { path: filePath }),
		...(startLine === undefined ? {} : { startLine }),
		...(endLine === undefined ? {} : { endLine }),
		...(quote === undefined ? {} : { quote }),
		...(note === undefined ? {} : { note }),
	};
}

function readOwnerDecision(
	reader: Reader,
	raw: unknown,
	path: string,
): OwnerDecisionInput | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (!isRecord(raw)) {
		reader.fail(path, "must be an object or null");
		return undefined;
	}
	const question = reader.string(raw.question, `${path}.question`, 8, LIMITS.ownerQuestion);
	const optionsRaw = raw.options;
	const options: string[] = [];
	if (!Array.isArray(optionsRaw)) {
		reader.fail(`${path}.options`, "must be an array of 2 to 5 strings");
	} else if (optionsRaw.length < 2 || optionsRaw.length > 5) {
		reader.fail(`${path}.options`, "must contain 2 to 5 strings");
	} else {
		for (let index = 0; index < optionsRaw.length; index += 1) {
			const option = reader.string(
				optionsRaw[index],
				`${path}.options[${index}]`,
				1,
				LIMITS.ownerOption,
			);
			if (option !== undefined) options.push(option);
		}
		if (new Set(options.map(option => option.toLowerCase())).size !== options.length) {
			reader.fail(`${path}.options`, "must not contain duplicates");
		}
	}
	if (question === undefined || options.length < 2) return undefined;
	return { question, options };
}

function readCandidate(reader: Reader, raw: unknown, index: number): CandidateInput | undefined {
	const path = `candidates[${index}]`;
	if (!isRecord(raw)) {
		reader.fail(path, "must be an object");
		return undefined;
	}
	const id = reader.string(raw.id, `${path}.id`, 1, 40, false) ?? `c${index + 1}`;
	if (!/^[A-Za-z0-9_-]+$/u.test(id)) {
		reader.fail(`${path}.id`, "must contain only letters, digits, underscores, or hyphens");
	}
	const title = reader.string(raw.title, `${path}.title`, 1, LIMITS.title);
	const lensRaw = raw.lens;
	const lens = (LENSES as readonly string[]).includes(String(lensRaw ?? ""))
		? (lensRaw as Lens)
		: undefined;
	if (lens === undefined) {
		reader.fail(`${path}.lens`, `must be one of: ${LENSES.join(", ")}`);
	}
	const observed = reader.string(raw.observed, `${path}.observed`, 1, LIMITS.observed);
	const evidenceRaw = raw.evidence;
	const evidence: EvidenceInput[] = [];
	if (!Array.isArray(evidenceRaw)) {
		reader.fail(`${path}.evidence`, "must be an array (0 to 6 items)");
	} else if (evidenceRaw.length > LIMITS.evidenceItems) {
		reader.fail(`${path}.evidence`, `must contain at most ${LIMITS.evidenceItems} items`);
	} else {
		for (let evidenceIndex = 0; evidenceIndex < evidenceRaw.length; evidenceIndex += 1) {
			const item = readEvidence(reader, evidenceRaw[evidenceIndex], `${path}.evidence[${evidenceIndex}]`);
			if (item !== undefined) evidence.push(item);
		}
	}
	const whyItMatters = reader.string(raw.whyItMatters, `${path}.whyItMatters`, 1, LIMITS.whyItMatters);
	const verifyOrDo = reader.string(raw.verifyOrDo, `${path}.verifyOrDo`, 1, LIMITS.verifyOrDo);
	const nextPrompt = reader.string(raw.nextPrompt, `${path}.nextPrompt`, 1, LIMITS.nextPrompt);
	const impact = reader.integer(raw.impact, `${path}.impact`, 1, 5);
	const alignment = reader.integer(raw.alignment, `${path}.alignment`, 1, 5);
	const feasibility = reader.integer(raw.feasibility, `${path}.feasibility`, 1, 5);
	const confidence = reader.number(raw.confidence, `${path}.confidence`, 0, 1);
	const evidenceStatus = normalizeClaimedEvidenceStatus(raw.evidenceStatus);
	if (evidenceStatus === undefined) {
		reader.fail(`${path}.evidenceStatus`, "must be VERIFIED, UNVERIFIED, or CONFLICTING_INSUFFICIENT");
	}
	const genericRisk = reader.number(raw.genericRisk, `${path}.genericRisk`, 0, 1);
	const ownerDecision = readOwnerDecision(reader, raw.ownerDecision, `${path}.ownerDecision`);
	const whatWouldChangeRanking = reader.string(
		raw.whatWouldChangeRanking,
		`${path}.whatWouldChangeRanking`,
		1,
		LIMITS.whatWouldChangeRanking,
	);

	if (
		title === undefined ||
		lens === undefined ||
		observed === undefined ||
		whyItMatters === undefined ||
		verifyOrDo === undefined ||
		nextPrompt === undefined ||
		impact === undefined ||
		alignment === undefined ||
		feasibility === undefined ||
		confidence === undefined ||
		evidenceStatus === undefined ||
		genericRisk === undefined ||
		whatWouldChangeRanking === undefined
	) {
		return undefined;
	}
	return {
		id,
		title,
		lens,
		observed,
		evidence,
		whyItMatters,
		verifyOrDo,
		nextPrompt,
		impact,
		alignment,
		feasibility,
		confidence,
		evidenceStatus,
		genericRisk,
		...(ownerDecision === undefined ? {} : { ownerDecision }),
		whatWouldChangeRanking,
	};
}

function readLenses(reader: Reader, raw: unknown): LensReport[] {
	if (!Array.isArray(raw)) {
		reader.fail("lenses", "must be an array with all nine lenses");
		return [];
	}
	if (raw.length !== LENSES.length) {
		reader.fail("lenses", `must contain exactly ${LENSES.length} entries`);
	}
	const byLens = new Map<Lens, LensReport>();
	for (let index = 0; index < raw.length; index += 1) {
		const path = `lenses[${index}]`;
		const item = raw[index];
		if (!isRecord(item)) {
			reader.fail(path, "must be an object");
			continue;
		}
		const lensRaw = item.lens;
		const lens = (LENSES as readonly string[]).includes(String(lensRaw ?? ""))
			? (lensRaw as Lens)
			: undefined;
		if (lens === undefined) {
			reader.fail(`${path}.lens`, `must be one of: ${LENSES.join(", ")}`);
			continue;
		}
		const statusRaw = item.status;
		const status = (LENS_STATUSES as readonly string[]).includes(String(statusRaw ?? ""))
			? (statusRaw as LensStatus)
			: undefined;
		if (status === undefined) {
			reader.fail(`${path}.status`, `must be one of: ${LENS_STATUSES.join(", ")}`);
			continue;
		}
		const note = reader.string(item.note, `${path}.note`, 1, LIMITS.lensNote, false);
		if (byLens.has(lens)) {
			reader.fail(`${path}.lens`, "must not repeat a lens");
			continue;
		}
		byLens.set(lens, {
			lens,
			status,
			...(note === undefined ? {} : { note }),
		});
	}
	for (const lens of LENSES) {
		if (!byLens.has(lens)) reader.fail("lenses", `missing lens: ${lens}`);
	}
	return LENSES.flatMap(lens => {
		const entry = byLens.get(lens);
		return entry === undefined ? [] : [entry];
	});
}

export function parseGenieInput(raw: unknown): ValidationResult {
	if (!isRecord(raw)) return { ok: false, errors: ["input: must be an object"] };
	const reader = new Reader();
	const projectGoals = reader.string(raw.projectGoals, "projectGoals", 1, LIMITS.projectGoals);
	const assumptions = reader.string(raw.assumptions, "assumptions", 0, LIMITS.assumptions) ?? "";
	const focus = normalizeFocus(raw.focus);
	if (focus === undefined) {
		reader.fail("focus", `must be all or one of: ${FOCUS_AREAS.join(", ")}`);
	}
	const lenses = readLenses(reader, raw.lenses);
	const candidatesRaw = raw.candidates;
	const candidates: CandidateInput[] = [];
	if (!Array.isArray(candidatesRaw)) {
		reader.fail("candidates", "must be an array (0 to 5 items)");
	} else if (candidatesRaw.length > LIMITS.candidates) {
		reader.fail("candidates", `must contain at most ${LIMITS.candidates} items`);
	} else {
		for (let index = 0; index < candidatesRaw.length; index += 1) {
			const candidate = readCandidate(reader, candidatesRaw[index], index);
			if (candidate !== undefined) candidates.push(candidate);
		}
		const ids = candidates.map(candidate => candidate.id.toLowerCase());
		if (new Set(ids).size !== ids.length) reader.fail("candidates", "candidate ids must be unique");
	}
	if (reader.errors.length > 0) return { ok: false, errors: reader.errors };
	if (projectGoals === undefined || focus === undefined) {
		return { ok: false, errors: ["input: incomplete after validation"] };
	}
	return {
		ok: true,
		value: { projectGoals, focus, assumptions, lenses, candidates },
	};
}
