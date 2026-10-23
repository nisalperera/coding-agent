import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../lib/stream.js", import.meta.url), "utf8");
const { consumeAgentStream } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
async function parse(chunks) {
  const events=[];
  const body=new ReadableStream({start(c){for(const s of chunks)c.enqueue(new TextEncoder().encode(s));c.close();}});
  const handlers=Object.fromEntries(["onProgress","onAnswerStart","onToken","onError","onConfirmation","onFallback","onDone"].map(k=>[k,x=>events.push([k,x])]));
  await consumeAgentStream({body},handlers);return events;
}
test("finish_reason followed by DONE emits done once and discards trailing tokens",async()=>{
 const e=await parse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"BAD"}}]}\n\n']);
 assert.deepEqual(e.map(x=>x[0]),["onToken","onDone"]);assert.equal(e[0][1],"ok");
});
test("SSE errors reach onError and terminate",async()=>{
 const e=await parse(['data: {"error":{"message":"failed","status":500}}\n\ndata: [DONE]\n\n']);
 assert.equal(e.length,1);assert.equal(e[0][0],"onError");assert.equal(e[0][1].status,500);
});
test("confirmation is terminal even with later answer controls",async()=>{
 const e=await parse(['{"type":"confirmation_required","action_id":"a"}\n{"type":"answer_start"}\n']);assert.equal(e.length,1);assert.equal(e[0][0],"onConfirmation");
});
test("chunk-split CRLF SSE and NDJSON are accepted",async()=>{
 const e=await parse(['{"type":"progress","message":"work"}\r','\ndata: {"choices":[{"delta":{"content":"ok"}}]}\r','\n\r','\ndata: [DONE]\r\n\r\n']);
 assert.deepEqual(e.map(x=>x[0]),["onProgress","onToken","onDone"]);
});
test("trailing NDJSON without newline is consumed",async()=>{
 const e=await parse(['{"type":"done"}']);assert.equal(e[0][0],"onDone");
});
test("malformed record fails instead of silently implying completion",async()=>{
 await assert.rejects(parse(['data: not-json\n\n']),/Malformed/);
});
test("fallback is terminal and not followed by duplicate done",async()=>{
 const e=await parse(['{"type":"fallback","result":"ok"}\n{"type":"done"}\n']);assert.equal(e.length,1);assert.equal(e[0][0],"onFallback");
});
test("EOF does not invent a done event",async()=>{
 const e=await parse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']);assert.deepEqual(e.map(x=>x[0]),["onToken"]);
});
