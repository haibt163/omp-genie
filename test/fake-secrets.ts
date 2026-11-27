// Runtime-built fake credentials. The source deliberately keeps each provider shape split across
// fragments so the repository and its history contain no token-shaped literals.
function fake(...parts: string[]): string {
	return parts.join("");
}

export const fakeAwsKey = fake("AKIA", "IOSFODNN7EXAMPLE");
export const fakeGithubToken = fake("ghp_", "1234567890abcdefghij", "1234567890abcdef");
export const fakeGitlabToken = fake("glpat-", "1234567890abcdefghij");
export const fakeOpenAiKey = fake("sk-", "proj-", "1234567890abcdefghijklmnopqrstuv");
export const fakeAnthropicKey = fake("sk-", "ant-", "api03-", "1234567890abcdefghij");
export const fakeGoogleKey = fake("AIza", "1234567890abcdefghijklmnopqrstuvwxy");
export const fakeSlackToken = fake("xoxb-", "1234567890-", "abcdefghij");
export const fakeNpmToken = fake("npm_", "1234567890abcdefghijklmnopqrstuvwxyz");
export const fakeStripeKey = fake("sk_", "live_", "1234567890abcdefghijklmn");
export const fakeHuggingFaceToken = fake("hf_", "1234567890abcdefghijklmnopqrstuv");
export const fakeSendGridKey = fake("SG.", "1234567890abcdef", ".", "1234567890abcdef");
export const fakeJwt = fake(
	"eyJhbGciOiJIUzI1NiJ9",
	".",
	"eyJzdWIiOiIxMjM0NTY3ODkwIn0",
	".",
	"signature123",
);
export const fakePrivateKey = fake(
	"-----BEGIN ",
	"PRIVATE KEY-----",
	"\n",
	"MIIEfakefakefake",
	"\n",
	"-----END ",
	"PRIVATE KEY-----",
);
