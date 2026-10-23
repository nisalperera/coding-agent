import test from "node:test";
import assert from "node:assert/strict";
import { GUARD } from "../scripts/harden-braces.mjs";
const testModule={exports:{}};
new Function("module","exports",GUARD)(testModule,testModule.exports);
const {assertDepth,assertAst}=testModule.exports;
test("parse nesting budget permits 100 and rejects 101",()=>{assert.doesNotThrow(()=>assertDepth(100));assert.throws(()=>assertDepth(101),SyntaxError);});
test("iterative AST validation rejects deep hand-built AST",()=>{
 let node={type:"text",value:"x"};for(let i=0;i<5000;i++)node={type:"root",nodes:[node]};assert.throws(()=>assertAst(node),SyntaxError);
});
test("cyclic child graph is rejected without engine stack exhaustion",()=>{const a={nodes:[]};a.nodes.push(a);assert.throws(()=>assertAst(a),SyntaxError);});
test("cyclic parent graph is rejected",()=>{const a={nodes:[]};a.parent=a;assert.throws(()=>assertAst(a),SyntaxError);});
test("valid parent backreferences and shared leaf nodes remain supported",()=>{
 const leaf={type:"text",value:"a"};const root={type:"root",nodes:[leaf,leaf]};leaf.parent=root;assert.doesNotThrow(()=>assertAst(root));
});
test("wide hand-built AST is bounded",()=>{assert.throws(()=>assertAst({nodes:Array(50001).fill({value:"x"})}),SyntaxError);});
