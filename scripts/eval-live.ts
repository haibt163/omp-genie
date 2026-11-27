import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "../src/guards.ts";

type Arm = "genie" | "baseline";

interface FixtureSpec {
	name: string;
	seeded: boolean;
	expectedLenses: string[];
	hitTerms: string[];
	issue: string;
}

interface Manifest {
	version: number;
	fixtures: FixtureSpec[];
	genericTerms: string[];
}

interface UsageTotals {
	input: number;
	output: number;
	total: number;
	costUsd: number;
}

interface RunResult {
	name: string;
	arm: Arm;
	repetition: number;
	seeded: boolean;
	status: "ok" | "error";
	error?: string;
	model?: string;
	reportPath?: string;
	report?: string;
	top: string[];
	hit?: boolean;
	genericRecommendations: number;
	recommendationCount: number;
	falsePositives: number;
	unverifiedAsFact: number;
	usage: UsageTotals;
}

const root = fileURLToPath(new URL("..", import.meta.url));
const extensionPath = path.join(root, "src", "extension.ts");
const manifestPath = path.join(root, "evals", "ground-truth", "manifest.json");
const runsRoot = path.join(root, "evals", ".runs");
const securityFixturePlaceholder = "GENIE_EVAL_FAKE_STRIPE_SECRET_PLACEHOLDER";
const fakeStripeKey = ["sk_", "test_", "1234567890abcdefghijklmn"].join("");
const BASELINE_PROMPT = "Review this project and recommend the three most valuable next steps.";
const MAX_COST = process.env.GENIE_MAX_COST ?? "0.20";
const MAX_TIME = process.env.GENIE_MAX_TIME ?? "300";

async function injectFixtureSecrets(fixture: FixtureSpec, tempDir: string): Promise<void> {
	if (fixture.name !== "security-token") return;
	const configPath = path.join(tempDir, "src", "config.ts");
	const config = await fs.readFile(configPath, "utf8");
	if (!config.includes(securityFixturePlaceholder)) {
		throw new Error("security-token fixture placeholder is missing");
	}
	await fs.writeFile(configPath, config.replaceAll(securityFixturePlaceholder, fakeStripeKey));
}

function messageText(message: Record<string, unknown>): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		}
	}
	return parts.join("\n");
}

function extractReport(jsonl: string, arm: Arm): { report?: string; model?: string; usage: UsageTotals } {
	let customReport: string | undefined;
	let assistantReport: string | undefined;
	let model: string | undefined;
	const usage: UsageTotals = { input: 0, output: 0, total: 0, costUsd: 0 };
	for (const line of jsonl.split(/\r?\n/u)) {
		if (line.trim() === "") continue;
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(event) || event.type !== "message_end" || !isRecord(event.message)) continue;
		const message = event.message;
		const text = messageText(message);
		if (message.role === "custom" && message.customType === "genie-report") {
			customReport = text;
			continue;
		}
		if (message.role !== "assistant") continue;
		if (typeof message.model === "string") model = message.model;
		const rawUsage = isRecord(message.usage) ? message.usage : undefined;
		if (rawUsage !== undefined) {
			usage.input += typeof rawUsage.input === "number" ? rawUsage.input : 0;
			usage.output += typeof rawUsage.output === "number" ? rawUsage.output : 0;
			usage.total += typeof rawUsage.totalTokens === "number" ? rawUsage.totalTokens : 0;
			usage.costUsd +=
				isRecord(rawUsage.cost) && typeof rawUsage.cost.total === "number" ? rawUsage.cost.total : 0;
		}
		if (text.trim().length > 0) assistantReport = text;
	}
	return {
		report: arm === "genie" ? customReport ?? assistantReport : assistantReport,
		model,
		usage,
	};
}

function genieSections(report: string): string[] {
	return report.split(/\n(?=## \d+\. )/u).slice(1, 4);
}

function baselineSections(report: string): string[] {
	const lines = report.split(/\r?\n/u);
	const matches: Array<{ index: number; number: number; title: string }> = [];
	for (let index = 0; index < lines.length; index += 1) {
		const match = /^\s*(?:#{1,6}\s*)?(?:\*\*)?(\d+)[.)]\s+(.+?)\s*$/u.exec(lines[index] ?? "");
		if (match?.[1] === undefined || match[2] === undefined) continue;
		matches.push({ index, number: Number.parseInt(match[1], 10), title: match[2] });
	}
	if (matches.length === 0) return [];
	let start = matches.findIndex(match => match.number === 1);
	if (start === -1) start = 0;
	const chosen: typeof matches = [];
	for (let index = start; index < matches.length && chosen.length < 3; index += 1) {
		const match = matches[index];
		if (match === undefined) continue;
		if (match.number === chosen.length + 1) chosen.push(match);
	}
	if (chosen.length === 0) return [];
	return chosen.map((match, index) => {
		const next = chosen[index + 1];
		return lines.slice(match.index, next?.index ?? lines.length).join("\n");
	});
}

function sectionsOf(report: string, arm: Arm): string[] {
	return arm === "genie" ? genieSections(report) : baselineSections(report);
}

function classificationOf(section: string): string {
	const match = /\*\*Classification:\*\* (.+)/u.exec(section);
	return match?.[1]?.trim() ?? "";
}

function evidenceStatusOf(section: string): string {
	const match = /\*\*Evidence status:\*\* (.+)/u.exec(section);
	return match?.[1]?.trim() ?? "";
}

function promptOf(section: string): string {
	const marker = "**Exact next prompt:**";
	const index = section.indexOf(marker);
	return index === -1 ? "" : section.slice(index + marker.length);
}

function titleOf(section: string): string {
	const genie = /^## \d+\. (.+)$/mu.exec(section);
	if (genie?.[1] !== undefined) return genie[1].trim();
	const baseline = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\d+[.)]\s+(.+?)\s*$/mu.exec(section);
	return (baseline?.[1] ?? "").replaceAll("**", "").replace(/[`*_]/gu, "").trim();
}

const BASELINE_SEVERITY =
	/\b(vulnerab\w*|security (?:issue|bug|flaw)|data loss|crash\w*|broken|incorrect|bug|fails?|failure|does not work|is wrong)\b/iu;
const FILE_REFERENCE =
	/\b[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|md|json|ya?ml|toml)\b|:\d+(?:-\d+)?\b/u;

/**
 * The baseline has no classification or evidence checker. To compare fairly we
 * use the same severity words and a concrete-file-reference heuristic, and we
 * label every result below as a heuristic. This is not a semantic judgement.
 */
function baselineFalsePositive(section: string): boolean {
	return BASELINE_SEVERITY.test(section);
}

function baselineUnverifiedAsFact(section: string, report: string): boolean {
	return BASELINE_SEVERITY.test(section) && !FILE_REFERENCE.test(section) && !FILE_REFERENCE.test(report);
}

async function runFixture(
	fixture: FixtureSpec,
	manifest: Manifest,
	runDir: string,
	arm: Arm,
	repetition: number,
): Promise<RunResult> {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `omp-genie-eval-${fixture.name}-${arm}-`));
	const stem = `${fixture.name}.${arm}.r${repetition}`;
	const rawPath = path.join(runDir, `${stem}.jsonl`);
	const stderrPath = path.join(runDir, `${stem}.stderr.log`);
	const reportPath = path.join(runDir, `${stem}.md`);
	const result: RunResult = {
		name: fixture.name,
		arm,
		repetition,
		seeded: fixture.seeded,
		status: "error",
		top: [],
		genericRecommendations: 0,
		recommendationCount: 0,
		falsePositives: 0,
		unverifiedAsFact: 0,
		usage: { input: 0, output: 0, total: 0, costUsd: 0 },
	};
	try {
		await fs.cp(path.join(root, "evals", "fixtures", fixture.name), tempDir, { recursive: true });
		await injectFixtureSecrets(fixture, tempDir);
		const outFd = await fs.open(rawPath, "w");
		const errFd = await fs.open(stderrPath, "w");
		const args =
			arm === "genie"
				? [
						"--mode",
						"json",
						"-p",
						"/genie",
						"--no-session",
						"--auto-approve",
						"--tools",
						"read,grep,glob,genie_rank",
						"--max-cost",
						MAX_COST,
						"--max-time",
						MAX_TIME,
						"-e",
						extensionPath,
					]
				: [
						"--mode",
						"json",
						"-p",
						BASELINE_PROMPT,
						"--no-session",
						"--auto-approve",
						"--tools",
						"read,grep,glob",
						"--max-cost",
						MAX_COST,
						"--max-time",
						MAX_TIME,
					];
		const { promise: exitPromise, resolve: resolveExit, reject: rejectExit } = Promise.withResolvers<number>();
		const child = spawn(process.env.OMP_BIN ?? "omp", args, {
			cwd: tempDir,
			shell: false,
			windowsHide: true,
			stdio: ["ignore", outFd.fd, errFd.fd],
		});
		const timeoutMs = Number(process.env.GENIE_EVAL_TIMEOUT_MS ?? 420_000);
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			rejectExit(new Error(`timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.on("error", error => {
			clearTimeout(timer);
			rejectExit(error);
		});
		child.on("close", code => {
			clearTimeout(timer);
			resolveExit(code ?? -1);
		});
		const exitCode = await exitPromise;
		await outFd.close();
		await errFd.close();
		const raw = await fs.readFile(rawPath, "utf8");
		const extracted = extractReport(raw, arm);
		result.model = extracted.model;
		result.usage = extracted.usage;
		if (extracted.report === undefined) {
			result.error = `no report in output (exit ${exitCode}); see ${stderrPath}`;
			return result;
		}
		await fs.writeFile(reportPath, extracted.report);
		result.reportPath = reportPath;
		result.report = extracted.report;
		result.status = "ok";
		const top = sectionsOf(extracted.report, arm);
		result.top = top;
		result.recommendationCount = top.length;
		const lower = (text: string) => text.toLowerCase();
		result.hit = fixture.seeded
			? top.some(section => fixture.hitTerms.some(term => lower(section).includes(lower(term))))
			: undefined;
		result.genericRecommendations = top.filter(section =>
			manifest.genericTerms.some(term => lower(titleOf(section)).includes(lower(term))),
		).length;
		result.falsePositives = !fixture.seeded
			? top.filter(section => {
					if (arm === "genie") {
						const classification = classificationOf(section);
						return (
							classification === "MUST FIX / VERIFY NOW" ||
							classification === "OWNER DECISION REQUIRED"
						);
					}
					return baselineFalsePositive(section);
				}).length
			: 0;
		result.unverifiedAsFact = top.filter(section => {
			if (arm === "genie") {
				const classification = classificationOf(section);
				const status = evidenceStatusOf(section);
				return (
					classification === "MUST FIX / VERIFY NOW" &&
					(status === "UNVERIFIED" || status === "CONFLICTING / INSUFFICIENT") &&
					!promptOf(section).includes("Before changing anything, verify")
				);
			}
			return baselineUnverifiedAsFact(section, result.report ?? "");
		}).length;
		return result;
	} catch (error) {
		result.error = error instanceof Error ? error.message : String(error);
		return result;
	} finally {
		await fs.rm(tempDir, { recursive: true, force: true });
	}
}

function percent(numerator: number, denominator: number): string {
	return denominator === 0 ? "n/a" : `${((numerator / denominator) * 100).toFixed(1)}%`;
}

interface ArmSummary {
	arm: Arm;
	runs: number;
	reportedRuns: number;
	seededRuns: number;
	topThreeHits: number;
	topThreeHitRate: string;
	recommendationDenominator: number;
	genericRecommendations: number;
	genericRate: string;
	cleanControlRecommendations: number;
	cleanControlFalsePositives: number;
	unverifiedPresentedAsFact: number;
	unverifiedAsFactRate: string;
	costUsd: number;
	models: string[];
	errors: string[];
}

function summarizeArm(results: RunResult[], arm: Arm): ArmSummary {
	const armResults = results.filter(result => result.arm === arm);
	const reported = armResults.filter(result => result.status === "ok");
	const seeded = reported.filter(result => result.seeded);
	const recommendations = reported.flatMap(result => result.top);
	const clean = reported.find(result => !result.seeded);
	const hits = seeded.filter(result => result.hit === true).length;
	const generic = reported.reduce((total, result) => total + result.genericRecommendations, 0);
	const unverified = reported.reduce((total, result) => total + result.unverifiedAsFact, 0);
	return {
		arm,
		runs: armResults.length,
		reportedRuns: reported.length,
		seededRuns: seeded.length,
		topThreeHits: hits,
		topThreeHitRate: percent(hits, seeded.length),
		recommendationDenominator: recommendations.length,
		genericRecommendations: generic,
		genericRate: percent(generic, recommendations.length),
		cleanControlRecommendations: clean?.recommendationCount ?? 0,
		cleanControlFalsePositives: clean?.falsePositives ?? 0,
		unverifiedPresentedAsFact: unverified,
		unverifiedAsFactRate: percent(unverified, recommendations.length),
		costUsd: reported.reduce((total, result) => total + result.usage.costUsd, 0),
		models: [...new Set(reported.map(result => result.model).filter((model): model is string => Boolean(model)))],
		errors: armResults.filter(result => result.status === "error").map(result => `${result.name}: ${result.error}`),
	};
}

function comparisonRows(genie: ArmSummary, baseline: ArmSummary): string[] {
	return [
		"| Metric | Genie | Baseline |",
		"| --- | ---: | ---: |",
		`| Runs with a report | ${genie.reportedRuns}/${genie.runs} | ${baseline.reportedRuns}/${baseline.runs} |`,
		`| Seeded runs scored | ${genie.seededRuns} | ${baseline.seededRuns} |`,
		`| Top-three hit rate | ${genie.topThreeHits}/${genie.seededRuns} (${genie.topThreeHitRate}) | ${baseline.topThreeHits}/${baseline.seededRuns} (${baseline.topThreeHitRate}) |`,
		`| Generic recommendations (title heuristic) | ${genie.genericRecommendations}/${genie.recommendationDenominator} (${genie.genericRate}) | ${baseline.genericRecommendations}/${baseline.recommendationDenominator} (${baseline.genericRate}) |`,
		`| Clean-control recommendations | ${genie.cleanControlRecommendations} | ${baseline.cleanControlRecommendations} |`,
		`| Clean-control high-severity false positives | ${genie.cleanControlFalsePositives} | ${baseline.cleanControlFalsePositives} |`,
		`| Unverified claims presented as fact | ${genie.unverifiedPresentedAsFact}/${genie.recommendationDenominator} (${genie.unverifiedAsFactRate}) | ${baseline.unverifiedPresentedAsFact}/${baseline.recommendationDenominator} (${baseline.unverifiedAsFactRate}) |`,
		`| Actual reported spend | $${genie.costUsd.toFixed(6)} | $${baseline.costUsd.toFixed(6)} |`,
	];
}

function addsNothingCases(results: RunResult[]): string[] {
	const byFixture = new Map<string, { genie?: RunResult; baseline?: RunResult }>();
	for (const result of results) {
		const entry = byFixture.get(result.name) ?? {};
		entry[result.arm] = result;
		byFixture.set(result.name, entry);
	}
	const lines: string[] = [];
	for (const [name, entry] of byFixture) {
		if (entry.genie?.status !== "ok" || entry.baseline?.status !== "ok") continue;
		const genie = entry.genie;
		const baseline = entry.baseline;
		if (genie.seeded && baseline.seeded) {
			if (genie.hit === baseline.hit && genie.genericRecommendations >= baseline.genericRecommendations) {
				lines.push(
					`- \`${name}\`: both ${genie.hit === true ? "hit" : "missed"} the seeded issue; generic titles ${genie.genericRecommendations} vs ${baseline.genericRecommendations}; unverified-as-fact ${genie.unverifiedAsFact} vs ${baseline.unverifiedAsFact}; cost $${genie.usage.costUsd.toFixed(6)} vs $${baseline.usage.costUsd.toFixed(6)}.`,
				);
			}
		} else if (!genie.seeded && !baseline.seeded) {
			lines.push(
				`- \`${name}\` (clean control): Genie produced ${genie.recommendationCount} recommendations, baseline ${baseline.recommendationCount}; high-severity false positives ${genie.falsePositives} vs ${baseline.falsePositives}; cost $${genie.usage.costUsd.toFixed(6)} vs $${baseline.usage.costUsd.toFixed(6)}.`,
			);
		}
	}
	return lines;
}

async function main(): Promise<void> {
	if (process.env.GENIE_LIVE_EVAL !== "1") {
		console.log("Live evaluation is opt-in. Set GENIE_LIVE_EVAL=1 to run model-backed fixtures.");
		return;
	}
	const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Manifest;
	const filter = new Set(
		(process.env.GENIE_EVAL_FILTER ?? "")
			.split(",")
			.map(value => value.trim())
			.filter(Boolean),
	);
	const fixtures = manifest.fixtures.filter(fixture => filter.size === 0 || filter.has(fixture.name));
	const requestedArms = new Set(
		(process.env.GENIE_EVAL_ARMS ?? "genie,baseline")
			.split(",")
			.map(value => value.trim())
			.filter((value): value is Arm => value === "genie" || value === "baseline"),
	);
	const repetitions = Math.max(1, Number.parseInt(process.env.GENIE_EVAL_REPETITIONS ?? "1", 10));
	const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
	const runDir = path.join(runsRoot, stamp);
	await fs.mkdir(runDir, { recursive: true });
	const results: RunResult[] = [];
	for (let repetition = 1; repetition <= repetitions; repetition += 1) {
		for (const fixture of fixtures) {
			for (const arm of ["genie", "baseline"] as const) {
				if (!requestedArms.has(arm)) continue;
				console.log(`running ${fixture.name} [${arm}] repetition ${repetition}...`);
				const result = await runFixture(fixture, manifest, runDir, arm, repetition);
				results.push(result);
				console.log(
					`  ${result.status}${result.error === undefined ? "" : `: ${result.error}`} (cost $${result.usage.costUsd.toFixed(6)})`,
				);
			}
		}
	}
	const genie = summarizeArm(results, "genie");
	const baseline = summarizeArm(results, "baseline");
	const summary = {
		generatedAt: new Date().toISOString(),
		ompVersion: execFileSync(process.env.OMP_BIN ?? "omp", ["--version"], { encoding: "utf8" }).trim(),
		command: {
			genie: `omp --mode json -p /genie --no-session --auto-approve --tools read,grep,glob,genie_rank --max-cost ${MAX_COST} --max-time ${MAX_TIME} -e src/extension.ts`,
			baseline: `omp --mode json -p "${BASELINE_PROMPT}" --no-session --auto-approve --tools read,grep,glob --max-cost ${MAX_COST} --max-time ${MAX_TIME}`,
		},
		repetitions,
		limitations: [
			"Term matching over rendered sections is not semantic accuracy.",
			"Generic advice uses title term matching, a heuristic.",
			"The baseline has no classification or evidence checker; severity and citation absence are keyword heuristics.",
			"Live runs are headless, so independent judgement is intentionally skipped.",
			"One run per fixture per arm unless GENIE_EVAL_REPETITIONS is raised before running.",
		],
		arms: { genie, baseline },
		addsNothing: addsNothingCases(results),
		results,
	};
	await fs.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
	const lines = [
		"# Live Genie evaluation",
		"",
		`Generated: ${summary.generatedAt}`,
		`OMP: ${summary.ompVersion}`,
		`Repetitions: ${repetitions} per fixture per arm`,
		`Genie model(s): ${genie.models.join(", ") || "unknown"}`,
		`Baseline model(s): ${baseline.models.join(", ") || "unknown"}`,
		"",
		"## Side-by-side",
		"",
		...comparisonRows(genie, baseline),
		"",
		"## Cases where Genie adds nothing over the plain prompt",
		"",
		...(summary.addsNothing.length === 0 ? ["None detected by the coarse tie rule."] : summary.addsNothing),
		"",
		"## Runs",
		"",
		"| Fixture | Arm | Rep | Status | Hit | Recs | Generic | False positives | Unverified as fact | Cost | Model |",
		"| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
		...results.map(
			result =>
				`| ${result.name} | ${result.arm} | ${result.repetition} | ${result.status}${result.error === undefined ? "" : ` (${result.error})`} | ${result.hit === true ? "yes" : result.hit === false ? "no" : "-"} | ${result.recommendationCount} | ${result.genericRecommendations} | ${result.falsePositives} | ${result.unverifiedAsFact} | $${result.usage.costUsd.toFixed(6)} | ${result.model ?? "unknown"} |`,
		),
		"",
		"Raw output, extracted reports, and stderr logs are under `evals/.runs/` (gitignored).",
		"",
		"Metric limits: term matching is not semantic accuracy; the baseline severity/citation checks are keyword heuristics; the clean control is one repository.",
	];
	await fs.writeFile(path.join(runDir, "summary.md"), `${lines.join("\n")}\n`);
	await fs.writeFile(path.join(runsRoot, "latest"), stamp);
	console.log(`\n${lines.join("\n")}`);
}

await main();
