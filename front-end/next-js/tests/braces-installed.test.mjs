import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { harden, installedRoots } from "../scripts/harden-braces.mjs";
// Do not run adversarial inputs if source-integrity verification fails.
assert.ok(harden({check:true}) > 0, "Expected Braces installed in development test lane");
const roots=installedRoots();
const require=createRequire(import.meta.url);
const instances=roots.map(root=>({root,braces:require(root)}));
const deep="{".repeat(3500)+"a,b"+"}".repeat(3500);
function deepAst() { let node={type:"text",value:"x"};for(let i=0;i<3000;i++)node={type:"root",nodes:[node]};return node; }
test("all installed Braces copies retain verified project hardening",()=>{assert.equal(harden({check:true}),roots.length);});
test("ordinary brace alternatives, ranges, nesting, quoting and AST APIs work",()=>{
 for(const {braces} of instances) {
  assert.deepEqual(braces.expand("src/*.{js,jsx}"),["src/*.js","src/*.jsx"]);
  assert.deepEqual(braces.expand("{01..03}"),["01","02","03"]);
  assert.deepEqual(braces.expand("{a,{b,c}}"),["a","b","c"]);
  assert.equal(braces.compile("{a,b}"),"(a|b)");
  assert.equal(braces.stringify(braces.parse("a/{b,c}")),"a/{b,c}");
  assert.deepEqual(braces.expand('"{literal}"'),["{literal}"]);
 }
});
for(const method of ["parse","compile","expand","stringify","default"]) {
 test(`deep string rejected with controlled SyntaxError via ${method}`,()=>{
  for(const {braces} of instances)assert.throws(()=>method==="default"?braces(deep):braces[method](deep),error=>error instanceof SyntaxError&&/Braces safety limit/.test(error.message));
 });
}
test("deep parentheses also have a parser nesting budget",()=>{
 for(const {braces} of instances)assert.throws(()=>braces.parse("(".repeat(3500)+"x"+")".repeat(3500)),SyntaxError);
});
for(const method of ["compile","expand","stringify"]) {
 test(`direct ${method} AST entry rejects deep hand-built nodes`,()=>{
  for(const {braces,root} of instances) {
   assert.throws(()=>braces[method](deepAst()),SyntaxError);
   const direct=require(join(root,"lib",`${method}.js`));assert.throws(()=>direct(deepAst()),SyntaxError);
  }
 });
}
test("cyclic children and parent links fail before recursive walkers",()=>{
 for(const {braces} of instances)for(const method of ["compile","expand","stringify"]) {
  const child={type:"root",nodes:[]};child.nodes.push(child);assert.throws(()=>braces[method](child),SyntaxError);
  const parent={type:"root",nodes:[]};parent.parent=parent;assert.throws(()=>braces[method](parent),SyntaxError);
 }
});
test("Micromatch keeps normal brace matching and rejects deep explicit expansion",()=>{
 const mm=require("micromatch");assert.deepEqual(mm(["a.js","b.jsx","c.py"],"*.{js,jsx}"),["a.js","b.jsx"]);
 assert.throws(()=>mm.braces(deep,{expand:true}),SyntaxError);
});
test("both installed Fast-glob consumers retain file selection behavior",()=>{
 const directory=mkdtempSync(join(tmpdir(),"coding-agent-glob-"));
 try {
  for(const name of ["a.js","b.jsx","c.py",".hidden.js"])writeFileSync(join(directory,name),"");
  const fgPaths=new Set([require.resolve("fast-glob"),createRequire(require.resolve("tailwindcss" )).resolve("fast-glob")]);
  for(const path of fgPaths)assert.deepEqual(require(path).sync("*.{js,jsx}",{cwd:directory}).sort(),["a.js","b.jsx"]);
 } finally {rmSync(directory,{recursive:true,force:true});}
});
