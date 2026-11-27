import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "../src/guards.ts";

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

interface RunResult {
	name: string;
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
}

const root = fileURLToPath(new URL("..", import.meta.url));
const extensionPath = path.join(root, "src", "extension.ts");
const manifestPath = path.join(root, "evals", "ground-truth", "manifest.json");
const runsRoot = path.join(root, "evals", ".runs");
const securityFixturePlaceholder = "GENIE_EVAL_FAKE_STRIPE_SECRET_PLACEHOLDER";
const fakeStripeKey = ["sk_", "test_", "1234567890abcdefghijklmn"].join("");

async function injectFixtureSecrets(fixture: FixtureSpec, tempDir: string): Promise<void> {
	if (fixture.name !== "security-token") return;
	const configPath = path.join(tempDir, "src", "config.ts");
	const config = await fs.readFile(configPath, "utf8");
	if (!config.includes(securityFixturePlaceholder)) {
		throw new Error("security-token fixture placeholder is missing");
	}
	await fs.writeFile(configPath, config.replaceAll(securityFixturePlaceholder, fakeStripeKey));
}

function extractReport(jsonl: string): { report?: string; model?: string } {
	let customReport: string | undefined;
	let assistantReport: string | undefined;
	let model: string | undefined;
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
		const content = message.content;
		const parts: string[] = [];
		if (typeof content === "string") {
			parts.push(content);
		} else if (Array.isArray(content)) {
			for (const block of content) {
				if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
					parts.push(block.text);
				}
			}
		}
		const text = parts.join("\n");
		if (message.role === "custom" && message.customType === "genie-report") {
			customReport = text;
			continue;
		}
		if (message.role !== "assistant") continue;
		if (typeof message.model === "string") model = message.model;
		const marker = text.indexOf("# OMP Genie");
		if (marker !== -1) assistantReport = text.slice(marker);
	}
	return { report: customReport ?? assistantReport, model };
}

function sectionsOf(report: string): string[] {
	return report.split(/\n(?=## \d+\. )/u).slice(1, 4);
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
	const match = /^## \d+\. (.+)$/mu.exec(section);
	return match?.[1]?.trim() ?? "";
}

async function runFixture(fixture: FixtureSpec, manifest: Manifest, runDir: string): Promise<RunResult> {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `omp-genie-eval-${fixture.name}-`));
	const rawPath = path.join(runDir, `${fixture.name}.jsonl`);
	const stderrPath = path.join(runDir, `${fixture.name}.stderr.log`);
	const reportPath = path.join(runDir, `${fixture.name}.md`);
	const maxCost = process.env.GENIE_MAX_COST ?? "0.25";
	const maxTime = process.env.GENIE_MAX_TIME ?? "300";
	const timeoutMs = Number(process.env.GENIE_EVAL_TIMEOUT_MS ?? 420_000);
	const result: RunResult = {
		name: fixture.name,
		seeded: fixture.seeded,
		status: "error",
		top: [],
		genericRecommendations: 0,
		recommendationCount: 0,
		falsePositives: 0,
		unverifiedAsFact: 0,
	};
	try {
		await fs.cp(path.join(root, "evals", "fixtures", fixture.name), tempDir, { recursive: true });
		await injectFixtureSecrets(fixture, tempDir);
		const outFd = await fs.open(rawPath, "w");
		const errFd = await fs.open(stderrPath, "w");
		const { promise: exitPromise, resolve: resolveExit, reject: rejectExit } = Promise.withResolvers<number>();
		const child = spawn(
			process.env.OMP_BIN ?? "omp",
			[
				"--mode",
				"json",
				"-p",
				"/genie",
				"--no-session",
				"--auto-approve",
				"--max-cost",
				maxCost,
				"--max-time",
				maxTime,
				"-e",
				extensionPath,
			],
			{
				cwd: tempDir,
				shell: false,
				windowsHide: true,
				stdio: ["ignore", outFd.fd, errFd.fd],
			},
		);
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
		const extracted = extractReport(raw);
		result.model = extracted.model;
		if (extracted.report === undefined) {
			result.error = `no Genie report in output (exit ${exitCode}); see ${stderrPath}`;
			return result;
		}
		await fs.writeFile(reportPath, extracted.report);
		result.reportPath = reportPath;
		result.report = extracted.report;
		result.status = "ok";
		const top = sectionsOf(extracted.report);
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
					const classification = classificationOf(section);
					return classification === "MUST FIX / VERIFY NOW" || classification === "OWNER DECISION REQUIRED";
				}).length
			: 0;
		result.unverifiedAsFact = top.filter(section => {
			const classification = classificationOf(section);
			const status = evidenceStatusOf(section);
			const prompt = promptOf(section);
			return (
				classification === "MUST FIX / VERIFY NOW" &&
				(status === "UNVERIFIED" || status === "CONFLICTING / INSUFFICIENT") &&
				!prompt.includes("Before changing anything, verify")
			);
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
	const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
	const runDir = path.join(runsRoot, stamp);
	await fs.mkdir(runDir, { recursive: true });
	const results: RunResult[] = [];
	for (const fixture of fixtures) {
		console.log(`running ${fixture.name}...`);
		const result = await runFixture(fixture, manifest, runDir);
		results.push(result);
		console.log(`  ${result.status}${result.error === undefined ? "" : `: ${result.error}`}`);
	}
	const seeded = results.filter(result => result.seeded && result.status === "ok");
	const hits = seeded.filter(result => result.hit === true).length;
	const recommendations = results.flatMap(result => result.top);
	const generic = results.reduce((total, result) => total + result.genericRecommendations, 0);
	const clean = results.find(result => !result.seeded && result.status === "ok");
	const falsePositives = clean?.falsePositives ?? 0;
	const unverified = results.reduce((total, result) => total + result.unverifiedAsFact, 0);
	const summary = {
		generatedAt: new Date().toISOString(),
		model: [...new Set(results.map(result => result.model).filter(Boolean))],
		command: "omp --mode json -p /genie --no-session --auto-approve -e src/extension.ts",
		limitations: [
			"Single run per fixture; not a statistically meaningful sample.",
			"Live runs are headless, so independent judgement is intentionally skipped.",
			"Top-three hit uses case-insensitive term matching over rendered report sections.",
			"Generic rate uses title term matching, a heuristic.",
		],
		metrics: {
			seededFixtures: seeded.length,
			topThreeHits: hits,
			topThreeHitRate: percent(hits, seeded.length),
			recommendationDenominator: recommendations.length,
			genericRecommendations: generic,
			genericRate: percent(generic, recommendations.length),
			cleanControlRecommendations: clean?.recommendationCount ?? 0,
			cleanControlFalsePositives: falsePositives,
			unverifiedPresentedAsFact: unverified,
			unverifiedAsFactRate: percent(unverified, recommendations.length),
		},
		results,
	};
	await fs.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
	const lines = [
		"# Live Genie evaluation",
		"",
		`Generated: ${summary.generatedAt}`,
		`Model(s): ${summary.model.join(", ") || "unknown"}`,
		"",
		"| Metric | Result |",
		"| --- | ---: |",
		`| Seeded fixtures with a report | ${summary.metrics.seededFixtures} |`,
		`| Top-three hit rate | ${summary.metrics.topThreeHits}/${summary.metrics.seededFixtures} (${summary.metrics.topThreeHitRate}) |`,
		`| Generic recommendations | ${summary.metrics.genericRecommendations}/${summary.metrics.recommendationDenominator} (${summary.metrics.genericRate}) |`,
		`| Clean-control recommendations | ${summary.metrics.cleanControlRecommendations} |`,
		`| Clean-control MUST FIX / OWNER false positives | ${summary.metrics.cleanControlFalsePositives} |`,
		`| Unverified presented as fact | ${summary.metrics.unverifiedPresentedAsFact}/${summary.metrics.recommendationDenominator} (${summary.metrics.unverifiedAsFactRate}) |`,
		"",
		"## Runs",
		"",
		"| Fixture | Status | Hit | Recommendations | Generic | False positives | Model |",
		"| --- | --- | --- | ---: | ---: | ---: | --- |",
		...results.map(
			result =>
				`| ${result.name} | ${result.status}${result.error === undefined ? "" : ` (${result.error})`} | ${result.hit === true ? "yes" : result.hit === false ? "no" : "-"} | ${result.recommendationCount} | ${result.genericRecommendations} | ${result.falsePositives} | ${result.model ?? "unknown"} |`,
		),
		"",
		"Raw output, extracted reports, and stderr logs are under `evals/.runs/` (gitignored).",
	];
	await fs.writeFile(path.join(runDir, "summary.md"), `${lines.join("\n")}\n`);
	await fs.writeFile(path.join(runsRoot, "latest"), stamp);
	console.log(`\n${lines.join("\n")}`);
}

await main();
