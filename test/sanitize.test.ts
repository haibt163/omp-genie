import assert from "node:assert/strict";
import { test } from "node:test";
import {
	fakeAnthropicKey,
	fakeAwsKey,
	fakeGitlabToken,
	fakeGithubToken,
	fakeGoogleKey,
	fakeHuggingFaceToken,
	fakeJwt,
	fakeNpmToken,
	fakeOpenAiKey,
	fakePrivateKey,
	fakeSendGridKey,
	fakeSlackToken,
	fakeStripeKey,
} from "./fake-secrets.ts";
import { redactDeep, redactSecrets, sanitizeText, stripTerminalControls } from "../src/sanitize.ts";

const planted: Array<{ label: string; value: string }> = [
	{ label: "AWS_ACCESS_KEY", value: fakeAwsKey },
	{ label: "GITHUB_TOKEN", value: fakeGithubToken },
	{ label: "GITLAB_TOKEN", value: fakeGitlabToken },
	{ label: "OPENAI_KEY", value: fakeOpenAiKey },
	{ label: "ANTHROPIC_KEY", value: fakeAnthropicKey },
	{ label: "GOOGLE_KEY", value: fakeGoogleKey },
	{ label: "SLACK_TOKEN", value: fakeSlackToken },
	{ label: "NPM_TOKEN", value: fakeNpmToken },
	{ label: "STRIPE_KEY", value: fakeStripeKey },
	{ label: "HUGGINGFACE_TOKEN", value: fakeHuggingFaceToken },
	{ label: "SENDGRID_KEY", value: fakeSendGridKey },
	{ label: "JWT", value: fakeJwt },
	{ label: "PRIVATE_KEY", value: fakePrivateKey },
];

test("redacts every planted credential pattern", () => {
	for (const item of planted) {
		const result = redactSecrets(`prefix ${item.value} suffix`);
		assert.equal(result.count > 0, true, item.label);
		assert.equal(result.text.includes(item.value), false, item.label);
		assert.match(result.text, /\[REDACTED:/u, item.label);
	}
});

test("redacts connection-URL passwords and assignments", () => {
	const url = redactSecrets("DATABASE_URL=postgres://user:supersecret@localhost:5432/db");
	assert.equal(url.text.includes("supersecret"), false);
	assert.match(url.text, /URL_PASSWORD/u);

	const assignment = redactSecrets('password = "hunter2hunter2"');
	assert.equal(assignment.text.includes("hunter2hunter2"), false);
	assert.match(assignment.text, /ASSIGNMENT/u);

	const bearer = redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz");
	assert.equal(bearer.text.includes("abcdefghijklmnopqrstuvwxyz"), false);
	assert.match(bearer.text, /BEARER_TOKEN/u);
});

test("does not redact ordinary prose or short type-like assignments", () => {
	const prose = "The project has a password reset flow and a session token.";
	assert.equal(redactSecrets(prose).text, prose);
	const typeLike = "interface Options { password: string; token: string; }";
	assert.equal(redactSecrets(typeLike).text, typeLike);
});

test("redacts nested objects without mutating the input", () => {
	const input = {
		message: `use ${fakeAwsKey}`,
		nested: [fakeGithubToken],
		count: 3,
	};
	const output = redactDeep(input);
	assert.equal(input.message.includes(fakeAwsKey), true);
	assert.equal(output.message.includes(fakeAwsKey), false);
	assert.equal(output.nested[0]?.includes("ghp_"), false);
	assert.equal(output.count, 3);
});

test("redaction is deterministic", () => {
	const first = redactSecrets(fakeAwsKey).text;
	const second = redactSecrets(fakeAwsKey).text;
	assert.equal(first, second);
});

test("strips terminal control sequences from display text", () => {
	const input = "\u001B[31mred\u001B[0m and \u001B]52;c;ZXZpbA==\u0007safe\nnext";
	const output = sanitizeText(input).text;
	assert.equal(output.includes("\u001B"), false);
	assert.equal(output.includes("ZXZpbA=="), false);
	assert.match(output, /red and safe\nnext/u);
	assert.equal(stripTerminalControls("plain text"), "plain text");
});
