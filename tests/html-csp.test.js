const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const htmlFiles = ["index.html", "porto.html", "public-forms.html", "side-tasks.html", "meos.html"];

test("html files do not use inline scripts or inline event handlers", () => {
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    assert.doesNotMatch(html, /<script(?:\s[^>]*)?>\s*(?!<\/script>)/i, `${file} contains inline script code`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${file} contains inline event handlers`);
  }
});
