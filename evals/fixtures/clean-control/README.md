# Tiny Slug

A deliberately small, well-tested slug helper.

Input is lowercased first, then only ASCII letters (`a-z`) and digits are kept. Every other character
becomes a separator. Because lowercasing happens first, Unicode characters that case-fold to ASCII
survive in folded form (for example, U+212A KELVIN SIGN becomes `k`), while U+0130 dotted capital I
produces `i` plus a combining dot that becomes a separator. Non-string input throws a TypeError with
a stable message.

## Usage

```js
import { slugify } from "./src/slug.js";
slugify("Hello World"); // "hello-world"
slugify("Café"); // "caf"
slugify("日本語"); // ""
slugify("\u212A"); // "k"
slugify("\u0130stanbul"); // "i-stanbul"
```

## Test

```sh
npm test
```
