import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const entries = Object.entries(lock.packages ?? {}).filter(([name]) => /(^|\/)node_modules\/postcss-selector-parser$/.test(name));
function installed() {
  assert.ok(entries.length, "Expected installed selector-parser dependencies");
  return entries.map(([location]) => {
    const packagePath = join(root, location, "package.json");
    const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
    const parser = createRequire(packagePath)(join(root, location));
    return { parser, location, version: metadata.version };
  });
}
test("every installed selector-parser copy has a patched version", () => {
  for (const item of installed()) {
    const [major,minor,patch] = item.version.split(".").map(Number);
    const safe = major === 6 ? minor > 1 || (minor === 1 && patch >= 5)
      : major === 7 ? minor > 1 || (minor === 1 && patch >= 6) : major > 7;
    assert.equal(safe, true, `${item.location}: unpatched ${item.version}`);
  }
});
test("patched parsers preserve representative Tailwind and typography selectors", () => {
  const selectors = [
    ".prose :where(p):not(:where([class~=not-prose],[class~=not-prose] *))",
    ".dark .dark\\:bg-slate-950", ".sm\\:grid-cols-2",
    ".hover\\:bg-blue-700:hover", ".focus-visible\\:outline-blue-500:focus-visible",
    ".group:hover .group-hover\\:opacity-100", "[aria-selected=true]", ".brand-600::before",
  ];
  for (const {parser} of installed()) for (const selector of selectors) {
    assert.equal(parser().astSync(selector).toString(), selector);
  }
});
test("flat class-selector stress case completes in an isolated bounded subprocess", {timeout:20000}, () => {
  for (const {location} of installed()) {
    const code = `const parser = require(${JSON.stringify(join(root,location))});
      const ast = parser().astSync('.a'.repeat(200000));
      if (ast.first.nodes.length !== 200000) process.exit(2);`;
    const result = spawnSync(process.execPath, ["-e", code], {timeout:15000, encoding:"utf8", maxBuffer:1024*1024});
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  }
});
