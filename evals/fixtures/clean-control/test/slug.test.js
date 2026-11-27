import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "../src/slug.js";

test("lowercases and joins words", () => {
	assert.equal(slugify("Hello World"), "hello-world");
});

test("trims separators and repeated punctuation", () => {
	assert.equal(slugify("  Hello,   World!  "), "hello-world");
});

test("handles an empty string and all-punctuation input", () => {
	assert.equal(slugify(""), "");
	assert.equal(slugify("!!!"), "");
});

test("keeps only ASCII letters and digits after lowercasing", () => {
	assert.equal(slugify("Café"), "caf");
	assert.equal(slugify("日本語"), "");
	assert.equal(slugify("\u212A"), "k");
	assert.equal(slugify("\u0130stanbul"), "i-stanbul");
});

test("rejects non-string input with a stable error", () => {
	assert.throws(() => slugify(null), /slugify expects a string/u);
	assert.throws(() => slugify(123), /slugify expects a string/u);
	assert.throws(() => slugify(new String("Hi")), /slugify expects a string/u);
	assert.throws(() => slugify({ trim: () => "Hi" }), /slugify expects a string/u);
});
