import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CandidateInput, EvidenceCheck, EvidenceInput, EvidenceSummary } from "./types.ts";

export const MAX_FILE_BYTES = 1_048_576;
export const MAX_TOTAL_BYTES = 4_194_304;

const DENIED_DIRECTORIES = new Set([
	".git",
	".omp",
	"node_modules",
	"dist",
	"build",
	"coverage",
	".next",
	".turbo",
	".cache",
]);

const DENIED_BASENAME_PATTERNS = [
	/^\.env(?:$|\.)/i,
	/\.pem$/i,
	/\.key$/i,
	/\.p12$/i,
	/\.pfx$/i,
	/\.ppk$/i,
	/^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/i,
	/^\.npmrc$/i,
	/^\.pypirc$/i,
	/^\.netrc$/i,
	/^secrets?(?:\.yml|\.yaml|\.json|\.toml)?$/i,
	/^credentials?(?:\.json|\.yml|\.yaml|\.toml)?$/i,
	/\.kdbx$/i,
	/\.jks$/i,
];

const FAILED_CHECKS = new Set<EvidenceCheck["check"]>([
	"missing",
	"out_of_range",
	"excluded",
	"unreadable",
	"binary",
	"too_large",
	"quote_mismatch",
	"outside_project",
]);

export interface EvidenceBudget {
	bytesLeft: number;
}

function isInsideRelative(relative: string): boolean {
	return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function isDeniedRelativePath(relativePath: string): boolean {
	const normalized = relativePath.replaceAll("\\", "/");
	const segments = normalized.split("/").filter(Boolean);
	if (segments.some(segment => DENIED_DIRECTORIES.has(segment.toLowerCase()))) return true;
	const basename = segments.at(-1) ?? "";
	return DENIED_BASENAME_PATTERNS.some(pattern => pattern.test(basename));
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/gu, " ").trim();
}

function resolveLexical(cwd: string, inputPath: string): { abs: string; relative: string } {
	const abs = path.resolve(cwd, inputPath);
	const relative = path.relative(cwd, abs);
	if (!isInsideRelative(relative) && abs !== path.resolve(cwd)) {
		throw new Error("outside_project");
	}
	return { abs, relative };
}

async function resolveReal(cwd: string, abs: string): Promise<{ real: string; relative: string }> {
	const realCwd = await fs.realpath(cwd);
	const real = await fs.realpath(abs);
	const relative = path.relative(realCwd, real);
	if (!isInsideRelative(relative)) throw new Error("outside_project");
	return { real, relative };
}

function failed(check: EvidenceCheck, detail?: string): EvidenceCheck {
	return detail === undefined ? check : { ...check, detail };
}

async function checkFileItem(
	item: EvidenceInput,
	cwd: string,
	budget: EvidenceBudget,
): Promise<EvidenceCheck> {
	const base: EvidenceCheck = {
		kind: "file",
		...(item.path === undefined ? {} : { path: item.path }),
		...(item.startLine === undefined ? {} : { startLine: item.startLine }),
		...(item.endLine === undefined ? {} : { endLine: item.endLine }),
		check: "missing",
	};
	if (item.path === undefined) return failed(base, "path is required for file evidence");

	let resolved: { abs: string; relative: string };
	try {
		resolved = resolveLexical(cwd, item.path);
	} catch {
		return { ...base, check: "outside_project" };
	}
	if (isDeniedRelativePath(resolved.relative)) {
		return { ...base, check: "excluded" };
	}

	let stat;
	try {
		stat = await fs.stat(resolved.abs);
	} catch {
		return { ...base, check: "missing" };
	}
	if (!stat.isFile()) return { ...base, check: "unreadable", detail: "not a regular file" };

	let realPath: string;
	try {
		realPath = (await resolveReal(cwd, resolved.abs)).real;
	} catch {
		return { ...base, check: "outside_project" };
	}
	if (isDeniedRelativePath(path.relative(cwd, realPath))) {
		return { ...base, check: "excluded" };
	}
	if (stat.size > MAX_FILE_BYTES) return { ...base, check: "too_large" };
	if (stat.size > budget.bytesLeft) return { ...base, check: "too_large", detail: "call budget exhausted" };

	let buffer: Buffer;
	try {
		buffer = await fs.readFile(realPath);
	} catch {
		return { ...base, check: "unreadable" };
	}
	budget.bytesLeft -= buffer.byteLength;
	if (buffer.includes(0)) return { ...base, check: "binary" };

	const lines = buffer.toString("utf8").split(/\r?\n/u);
	if (item.startLine === undefined || item.endLine === undefined) {
		return { ...base, check: "range_only", detail: "path exists; no line range supplied" };
	}
	if (item.startLine < 1 || item.endLine < item.startLine || item.endLine > lines.length) {
		return { ...base, check: "out_of_range" };
	}
	const rangeText = lines.slice(item.startLine - 1, item.endLine).join("\n");
	if (item.quote === undefined) {
		return { ...base, check: "range_only" };
	}
	if (!normalizeWhitespace(rangeText).includes(normalizeWhitespace(item.quote))) {
		return { ...base, check: "quote_mismatch" };
	}
	return { ...base, check: "verified" };
}

export async function verifyEvidenceItems(
	items: EvidenceInput[],
	cwd: string,
	budget: EvidenceBudget = { bytesLeft: MAX_TOTAL_BYTES },
): Promise<EvidenceSummary> {
	const checks: EvidenceCheck[] = [];
	let quoteCount = 0;
	let rangeCount = 0;
	let failedCount = 0;
	for (const item of items) {
		const check =
			item.kind === "file"
				? await checkFileItem(item, cwd, budget)
				: {
						kind: item.kind,
						...(item.path === undefined ? {} : { path: item.path }),
						...(item.startLine === undefined ? {} : { startLine: item.startLine }),
						...(item.endLine === undefined ? {} : { endLine: item.endLine }),
						check: "not_locally_checked" as const,
					};
		checks.push(check);
		if (check.check === "verified") quoteCount += 1;
		else if (check.check === "range_only" && item.startLine !== undefined) rangeCount += 1;
		if (FAILED_CHECKS.has(check.check)) failedCount += 1;
	}
	return { quoteCount, rangeCount, failedCount, checks };
}

export async function verifyAllEvidence(
	candidates: CandidateInput[],
	cwd: string,
): Promise<EvidenceSummary[]> {
	const budget: EvidenceBudget = { bytesLeft: MAX_TOTAL_BYTES };
	const summaries: EvidenceSummary[] = [];
	for (const candidate of candidates) {
		summaries.push(await verifyEvidenceItems(candidate.evidence, cwd, budget));
	}
	return summaries;
}
