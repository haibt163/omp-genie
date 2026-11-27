import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { verifyEvidenceItems } from "../src/evidence.ts";
import type { EvidenceInput } from "../src/types.ts";

async function withProject(
	files: Record<string, string | Buffer>,
	run: (cwd: string) => Promise<void>,
): Promise<void> {
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-genie-evidence-"));
	try {
		for (const [relative, content] of Object.entries(files)) {
			const target = path.join(cwd, relative);
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.writeFile(target, content);
		}
		await run(cwd);
	} finally {
		await fs.rm(cwd, { recursive: true, force: true });
	}
}

function fileEvidence(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
	return { kind: "file", path: "README.md", startLine: 1, endLine: 2, quote: "Hello project", ...overrides };
}

test("verifies an exact quote with whitespace normalisation", async () => {
	await withProject({ "README.md": "Hello   project\nsecond line\n" }, async cwd => {
		const summary = await verifyEvidenceItems([fileEvidence()], cwd);
		assert.equal(summary.quoteCount, 1);
		assert.equal(summary.failedCount, 0);
		assert.equal(summary.checks[0]?.check, "verified");
	});
});

test("accepts a verified range without a quote", async () => {
	await withProject({ "README.md": "a\nb\nc\n" }, async cwd => {
		const summary = await verifyEvidenceItems([fileEvidence({ quote: undefined, startLine: 2, endLine: 2 })], cwd);
		assert.equal(summary.rangeCount, 1);
		assert.equal(summary.checks[0]?.check, "range_only");
	});
});

test("marks missing, out-of-range, and quote mismatches as failures", async () => {
	await withProject({ "README.md": "Hello project\n" }, async cwd => {
		const summary = await verifyEvidenceItems(
			[
				fileEvidence({ path: "MISSING.md" }),
				fileEvidence({ startLine: 8, endLine: 9 }),
				fileEvidence({ quote: "not present" }),
			],
			cwd,
		);
		assert.equal(summary.failedCount, 3);
		assert.deepEqual(
			summary.checks.map(check => check.check),
			["missing", "out_of_range", "quote_mismatch"],
		);
	});
});

test("rejects path traversal and sensitive paths", async () => {
	await withProject(
		{
			"README.md": "Hello project\n",
			".env": "TOKEN=abc\n",
			"node_modules/pkg/index.js": "x\n",
			"config.pem": "key\n",
		},
		async cwd => {
			const summary = await verifyEvidenceItems(
				[
					fileEvidence({ path: "../outside.txt" }),
					fileEvidence({ path: ".env", quote: undefined }),
					fileEvidence({ path: "node_modules/pkg/index.js", quote: undefined }),
					fileEvidence({ path: "config.pem", quote: undefined }),
				],
				cwd,
			);
			assert.equal(summary.checks[0]?.check, "outside_project");
			assert.equal(summary.checks[1]?.check, "excluded");
			assert.equal(summary.checks[2]?.check, "excluded");
			assert.equal(summary.checks[3]?.check, "excluded");
			assert.equal(summary.failedCount, 4);
		},
	);
});

test("rejects binary files and exhausted read budgets", async () => {
	await withProject(
		{
			"README.md": "Hello project\n",
			"bin.dat": Buffer.from([0, 1, 2, 3]),
		},
		async cwd => {
			const binary = await verifyEvidenceItems(
				[fileEvidence({ path: "bin.dat", quote: undefined, startLine: 1, endLine: 1 })],
				cwd,
			);
			assert.equal(binary.checks[0]?.check, "binary");

			const budget = await verifyEvidenceItems([fileEvidence()], cwd, { bytesLeft: 2 });
			assert.equal(budget.checks[0]?.check, "too_large");
		},
	);
});

test("does not copy or locally verify non-file evidence", async () => {
	await withProject({ "README.md": "Hello project\n" }, async cwd => {
		const summary = await verifyEvidenceItems(
			[{ kind: "git", note: "commit abc changed the startup path" }],
			cwd,
		);
		assert.equal(summary.checks[0]?.check, "not_locally_checked");
		assert.equal(summary.failedCount, 0);
		assert.equal(summary.quoteCount, 0);
	});
});

test("rejects a symlink that escapes the project", async t => {
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-genie-symlink-"));
	const outside = await fs.mkdtemp(path.join(os.tmpdir(), "omp-genie-outside-"));
	try {
		await fs.writeFile(path.join(outside, "secret.txt"), "outside\n");
		try {
			await fs.symlink(path.join(outside, "secret.txt"), path.join(cwd, "link.txt"), "file");
		} catch {
			t.skip("symlink creation is not permitted on this host");
			return;
		}
		const summary = await verifyEvidenceItems(
			[fileEvidence({ path: "link.txt", quote: undefined, startLine: 1, endLine: 1 })],
			cwd,
		);
		assert.equal(summary.checks[0]?.check, "outside_project");
	} finally {
		await fs.rm(cwd, { recursive: true, force: true });
		await fs.rm(outside, { recursive: true, force: true });
	}
});
