import { readFileSync, writeFileSync, existsSync, realpathSync, unlinkSync } from "node:fs";
import { dirname, resolve, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
export const GUARD="\"use strict\";\n// Project-owned backport for GHSA-vfj7-8cjw-p6xm. No upstream version relabeling.\nconst MAX_PARSE_DEPTH = 100;\nconst MAX_AST_DEPTH = 128;\nconst MAX_NODES = 50000;\nfunction fail(reason) { throw new SyntaxError(`Braces safety limit: ${reason}`); }\nfunction assertDepth(depth) { if (depth > MAX_PARSE_DEPTH) fail(\"nesting exceeds 100 levels\"); }\nfunction assertAst(root) {\n  const stack = [{ node: root, depth: 0, exit: false }];\n  const ancestry = new WeakSet();\n  let count = 0;\n  while (stack.length) {\n    const {node,depth,exit} = stack.pop();\n    if (!node || typeof node !== \"object\") fail(\"invalid AST node\");\n    if (exit) { ancestry.delete(node); continue; }\n    if (++count > MAX_NODES || depth > MAX_AST_DEPTH) fail(\"AST budget exceeded\");\n    if (ancestry.has(node)) fail(\"cyclic AST children\");\n    // expand follows parent chains independently of child traversal.\n    const parents = new WeakSet();\n    let parent = node, length = 0;\n    while (parent?.parent) {\n      if (typeof parent !== \"object\" || parents.has(parent) || ++length > MAX_AST_DEPTH) fail(\"invalid AST parent chain\");\n      parents.add(parent); parent = parent.parent;\n    }\n    if (node.nodes !== undefined) {\n      if (!Array.isArray(node.nodes)) fail(\"invalid AST children\");\n      if (node.nodes.length > MAX_NODES) fail(\"AST width exceeded\");\n      ancestry.add(node); stack.push({node,depth,exit:true});\n      for (let i=node.nodes.length-1;i>=0;i--) stack.push({node:node.nodes[i],depth:depth+1,exit:false});\n    }\n  }\n}\nmodule.exports = { assertDepth, assertAst, MAX_PARSE_DEPTH, MAX_AST_DEPTH, MAX_NODES };\n";
export const PATCHES={"parse.js": {"blob": "3a6988e629f52aee6609dc5ec290a5e9ff47cecb", "old": "      stack.push(block);", "new": "      require('./.coding-agent-hardening.cjs').assertDepth(stack.length);\n      stack.push(block);", "count": 2}, "compile.js": {"blob": "dce69beb90ece5c3b0ca234a949418f9f34eedbc", "old": "const compile = (ast, options = {}) => {\n", "new": "const compile = (ast, options = {}) => {\n  require('./.coding-agent-hardening.cjs').assertAst(ast);\n", "count": 1}, "expand.js": {"blob": "35b2c41d6afdb8f0197959e26079f266e48370d3", "old": "const expand = (ast, options = {}) => {\n", "new": "const expand = (ast, options = {}) => {\n  require('./.coding-agent-hardening.cjs').assertAst(ast);\n", "count": 1}, "stringify.js": {"blob": "8bcf872c31894f81a8c64d9202fd607e4fd7ea2b", "old": "module.exports = (ast, options = {}) => {\n", "new": "module.exports = (ast, options = {}) => {\n  require('./.coding-agent-hardening.cjs').assertAst(ast);\n", "count": 1}};
const blob=text=>createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
export function planFile(text,patch) {
  let original=text;
  if(text.includes(".coding-agent-hardening.cjs")) {
    if(text.split(patch.new).length-1!==patch.count)throw Error("Incomplete or altered previous hardening");
    original=text.split(patch.new).join(patch.old);
  }
  if(blob(original)!==patch.blob)throw Error("Unexpected upstream source hash");
  if(original.split(patch.old).length-1!==patch.count)throw Error("Unexpected upstream source anchor");
  return original.split(patch.old).join(patch.new);
}
export function installedRoots(front=root) {
  const lock=JSON.parse(readFileSync(join(front,"package-lock.json"),"utf8"));
  const locations=Object.keys(lock.packages??{}).filter(name=>/(^|\/)node_modules\/braces$/.test(name));
  const roots=[];
  for(const location of locations) {
    if(!location.startsWith("node_modules/") || location.split("/").includes(".."))throw Error("Unsafe lockfile path");
    const dir=resolve(front,location);
    if(!existsSync(dir))continue; // e.g. production installs omit dev tooling.
    if(realpathSync(dir)!==dir || !dir.startsWith(join(front,"node_modules")+sep))throw Error("Linked or unsafe Braces directory");
    const meta=JSON.parse(readFileSync(join(dir,"package.json"),"utf8"));
    if(meta.name!=="braces"||meta.version!=="3.0.3")throw Error("New Braces source needs review before hardening");
    roots.push(dir);
  }
  return roots;
}
export function harden({check=false,front=root}={}) {
  const changes=[];const roots=installedRoots(front);
  for(const dir of roots) {
    for(const [name,patch] of Object.entries(PATCHES)) {
      const file=join(dir,"lib",name);
      if(realpathSync(file)!==file)throw Error("Linked source file");
      const previous=readFileSync(file,"utf8"),next=planFile(previous,patch);
      if(check&&previous!==next)throw Error(`Missing hardening: ${file}`);
      if(previous!==next)changes.push({file,previous,next});
    }
    const file=join(dir,"lib/.coding-agent-hardening.cjs");
    if(existsSync(file)&&realpathSync(file)!==file)throw Error("Linked guard file");
    const previous=existsSync(file)?readFileSync(file,"utf8"):null;
    if(previous!==null&&previous!==GUARD)throw Error("Unexpected guard content");
    if(check&&previous!==GUARD)throw Error("Missing security guard");
    if(previous!==GUARD)changes.push({file,previous,next:GUARD});
  }
  const written=[];
  try {
    for(const entry of changes) {
      if(entry.previous!==null&&readFileSync(entry.file,"utf8")!==entry.previous)throw Error("Concurrent source edit");
      if(entry.previous===null&&existsSync(entry.file))throw Error("Concurrent guard creation");
      writeFileSync(entry.file,entry.next);written.push(entry);
    }
  } catch(error) {
    for(const entry of written.reverse()) {
      if(entry.previous===null)unlinkSync(entry.file);else writeFileSync(entry.file,entry.previous);
    }
    throw error;
  }
  return roots.length;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.slice(2).some(arg=>arg!=="--check"))throw Error("Unknown hardening argument");
  const count=harden({check:process.argv.includes("--check")});
  console.log(`${process.argv.includes("--check")?"Verified":"Hardened"} ${count} installed Braces instance(s).`);
}
