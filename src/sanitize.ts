import { isRecord } from "./guards.ts";

interface SecretPattern {
	label: string;
	regex: RegExp;
	replace: (match: string, ...groups: string[]) => string;
}

function marker(label: string): string {
	return `[REDACTED:${label}]`;
}

const patterns: SecretPattern[] = [
	{
		label: "PRIVATE_KEY",
		regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]{0,16384}?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
		replace: () => marker("PRIVATE_KEY"),
	},
	{
		label: "AWS_ACCESS_KEY",
		regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
		replace: () => marker("AWS_ACCESS_KEY"),
	},
	{
		label: "GITHUB_TOKEN",
		regex: /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/g,
		replace: () => marker("GITHUB_TOKEN"),
	},
	{
		label: "GITLAB_TOKEN",
		regex: /\bglpat-[A-Za-z0-9_-]{20,255}\b/g,
		replace: () => marker("GITLAB_TOKEN"),
	},
	{
		label: "ANTHROPIC_KEY",
		regex: /\bsk-ant-[A-Za-z0-9_-]{20,255}\b/g,
		replace: () => marker("ANTHROPIC_KEY"),
	},
	{
		label: "OPENAI_KEY",
		regex: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,255}\b/g,
		replace: () => marker("OPENAI_KEY"),
	},
	{
		label: "GOOGLE_KEY",
		regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
		replace: () => marker("GOOGLE_KEY"),
	},
	{
		label: "SLACK_TOKEN",
		regex: /\bxox[baprs]-[A-Za-z0-9-]{10,255}\b/g,
		replace: () => marker("SLACK_TOKEN"),
	},
	{
		label: "NPM_TOKEN",
		regex: /\bnpm_[A-Za-z0-9]{36}\b/g,
		replace: () => marker("NPM_TOKEN"),
	},
	{
		label: "STRIPE_KEY",
		regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,255}\b/g,
		replace: () => marker("STRIPE_KEY"),
	},
	{
		label: "HUGGINGFACE_TOKEN",
		regex: /\bhf_[A-Za-z0-9]{20,255}\b/g,
		replace: () => marker("HUGGINGFACE_TOKEN"),
	},
	{
		label: "SENDGRID_KEY",
		regex: /\bSG\.[A-Za-z0-9_-]{16,64}\.[A-Za-z0-9_-]{16,64}\b/g,
		replace: () => marker("SENDGRID_KEY"),
	},
	{
		label: "JWT",
		regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
		replace: () => marker("JWT"),
	},
	{
		label: "BEARER_TOKEN",
		regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
		replace: (_match, ..._groups) => `Bearer ${marker("BEARER_TOKEN")}`,
	},
	{
		label: "URL_PASSWORD",
		regex: /\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]{3,})(@)/gi,
		replace: (_match, prefix, _password, suffix) => `${prefix}${marker("URL_PASSWORD")}${suffix}`,
	},
	{
		label: "ASSIGNMENT",
		regex:
			/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\b(\s*[:=]\s*)(["']?)([^\s"'`,;]{8,})\3/gi,
		replace: (_match, key, separator, quote, value) => {
			if (value.includes("[REDACTED:")) return `${key}${separator}${quote}${value}${quote}`;
			return `${key}${separator}${quote}${marker("ASSIGNMENT")}${quote}`;
		},
	},
];

export function redactSecrets(input: string): { text: string; count: number } {
	let text = input;
	let count = 0;
	for (const pattern of patterns) {
		pattern.regex.lastIndex = 0;
		text = text.replace(pattern.regex, (match: string, ...groups: string[]) => {
			count += 1;
			return pattern.replace(match, ...groups);
		});
	}
	return { text, count };
}

const OSC_SEQUENCE = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/gu;
const CSI_SEQUENCE = /\u001B\[[0-?]*[ -/]*[@-~]/gu;
const SIMPLE_ESCAPE = /\u001B[@-_]/gu;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu;
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/gu;

export function stripTerminalControls(input: string): string {
	return input
		.replace(OSC_SEQUENCE, "")
		.replace(CSI_SEQUENCE, "")
		.replace(SIMPLE_ESCAPE, "")
		.replace(CONTROL_CHARACTERS, "")
		.replace(BIDI_CONTROLS, "");
}

export function sanitizeText(input: string): { text: string; count: number } {
	const redacted = redactSecrets(input);
	return { text: stripTerminalControls(redacted.text), count: redacted.count };
}

export function redactDeep<T>(value: T): T {
	if (typeof value === "string") {
		return sanitizeText(value).text as T;
	}
	if (Array.isArray(value)) {
		return value.map(item => redactDeep(item)) as T;
	}
	if (isRecord(value)) {
		const output: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			output[key] = redactDeep(item);
		}
		return output as T;
	}
	return value;
}
