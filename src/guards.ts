/** Canonical object guard for JSON-shaped tool input. Fields still require their own checks. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
