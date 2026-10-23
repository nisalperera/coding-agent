import test from "node:test";
import assert from "node:assert/strict";
import { createChatController } from "../lib/chat-controller.mjs";
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const authenticated = id => ({ status: "authenticated", identityKey: id, user: { user_id: id } });
function fixture(options = {}) {
  let authState = options.auth ?? { status: "anonymous", identityKey: null, user: null };
  const subscribers = new Set(), calls = [], streams = [];
  let count = 0;
  const auth = { getSnapshot: () => authState, subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); } };
  const request = async (path, args = {}) => {
    calls.push({ path, ...args });
    if (options.request) { const r = options.request(path, args); if (r !== undefined) return r; }
    if (path === "/v1/actions") return { result: "ok" };
    if (args.method === "POST") return { id: args.body.conversation_id, status: "active" };
    if (args.method === "DELETE") return {};
    if (path === "/v1/conversations") return { conversations: options.remote ? [{ id: "remote", status: "active" }] : [] };
    return { id: path.split("/").at(-1), messages: [] };
  };
  const c = createChatController({ auth, request, uuid: () => `c-${++count}`,
    stream: async (path, body, args) => { streams.push({ path, body, ...args }); return options.stream ? options.stream(path,body,args) : {}; },
    consume: options.consume ?? (async (_response,h) => { h.onAnswerStart(); h.onToken("hello"); h.onDone(); }),
  });
  c.start();
  return { c, calls, streams, setAuth(next) { authState=next; for (const s of subscribers) s(); } };
}
test("signed-in bootstrap loads private detail and sends server conversation id", async () => {
  const f = fixture({ auth: authenticated("a"), remote: true }); await tick();
  assert.equal(f.c.getSnapshot().activeConversationId, "remote");
  await f.c.send("hi", []); assert.equal(f.streams[0].body.conversation_id,"remote");
  assert.equal(f.c.getSnapshot().messages.at(-1).text,"hello");
});
test("A to B immediately hides private state", async () => {
  const f = fixture({ auth: authenticated("a"), remote: true }); await tick();
  f.setAuth(authenticated("b")); assert.equal(f.c.getSnapshot().messages.length,0);
});
test("A anonymous A rejects late index even when user id repeats", async () => {
  const old = deferred(); let indexes=0;
  const f = fixture({ auth: authenticated("a"), request: p => p === "/v1/conversations" && ++indexes === 1 ? old.promise : undefined });
  f.setAuth({ status:"anonymous", identityKey:null,user:null }); f.setAuth(authenticated("a")); await tick();
  old.resolve({ conversations:[{id:"private-old",status:"active"}] }); await tick();
  assert.equal(f.c.getSnapshot().conversations.some(c=>c.id === "private-old"),false);
});
test("same-user re-verification conservatively invalidates old private operations", async () => {
  const d=deferred(); const f=fixture({consume:async (_r,h)=>{await d.promise;h.onToken("old");h.onDone();}});
  const send=f.c.send("old",[]);await tick(); f.setAuth(authenticated("a"));await tick();
  d.resolve();await send;assert.equal(f.c.getSnapshot().messages.length,0);
});
test("late stream callback, catch and finally cannot clear newer loading", async () => {
  const old=deferred(), newer=deferred();let calls=0;
  const f=fixture({consume:async (_r,h)=>{if(++calls===1){await old.promise;h.onToken("old");throw new Error("old failure");}await newer.promise;h.onToken("new");h.onDone();}});
  const p=f.c.send("old",[]);await tick();f.setAuth(authenticated("b"));await tick();
  const q=f.c.send("new",[]);await tick();old.resolve();await p;
  assert.equal(f.c.getSnapshot().loading,true);assert.equal(f.c.getSnapshot().messages.some(m=>m.text.includes("old failure")),false);
  newer.resolve();await q;assert.equal(f.c.getSnapshot().messages.at(-1).text,"new");
});
test("late conversation creation cannot issue a stream under replacement identity", async () => {
  const d=deferred();const f=fixture({auth:authenticated("a"),request:(p,o)=>o.method==="POST"?d.promise:undefined});await tick();
  const p=f.c.send("hi",[]);await tick();f.setAuth(authenticated("b"));await tick();
  d.resolve({id:"c-1"});await p;assert.equal(f.streams.length,0);
});
test("send acquires busy state before awaiting create", async () => {
  const d=deferred();const f=fixture({auth:authenticated("a"),request:(_p,o)=>o.method==="POST"?d.promise:undefined});await tick();
  const id=f.c.getSnapshot().activeConversationId;const p=f.c.send("one",[]);const q=f.c.send("two",[]);
  assert.equal(f.c.getSnapshot().loading,true);d.resolve({id});await Promise.all([p,q]);assert.equal(f.streams.length,1);
});
test("retry reuses one user message and original pre-turn history", async () => {
  let attempts=0;const f=fixture({consume:async (_r,h)=>{if(++attempts===1)h.onError({message:"failed",status:500});else{h.onToken("ok");h.onDone();}}});
  await f.c.send("hi",[]);const failed=f.c.getSnapshot().messages.at(-1);await f.c.retryFailedMessage(failed.id);
  const state=f.c.getSnapshot(), c=state.conversations[0];
  assert.equal(state.messages.filter(m=>m.role==="user").length,1);
  assert.equal(c.history.filter(m=>m.role==="user").length,1);
  assert.deepEqual(f.streams[0].body.history,f.streams[1].body.history);
  assert.equal(JSON.stringify(f.streams[1].body).includes("localTurnId"),false);
});
test("retry older than a subsequent user turn is refused", async () => {
  const f=fixture({consume:async (_r,h)=>h.onError({message:"failed",status:500})});
  await f.c.send("one",[]);const failed=f.c.getSnapshot().messages.at(-1);await f.c.send("two",[]);
  await f.c.retryFailedMessage(failed.id);assert.equal(f.streams.length,2);assert.match(f.c.getSnapshot().conversationsError,/latest/);
});
test("stream terminal latch rejects all subsequent outcome callbacks", async () => {
  const f=fixture({consume:async (_r,h)=>{h.onToken("ok");h.onDone();h.onDone();h.onToken("BAD");h.onError({message:"BAD"});h.onConfirmation({action_id:"BAD"});h.onFallback({result:"BAD"});}});
  await f.c.send("hi",[]);const s=f.c.getSnapshot();assert.equal(s.messages.at(-1).text,"ok");
  assert.equal(s.messages.length,2);assert.equal(s.conversations[0].history.length,2);
});
test("duplicate answer_start creates only one assistant message", async () => {
  const f=fixture({consume:async (_r,h)=>{h.onAnswerStart();h.onAnswerStart();h.onToken("ok");h.onDone();}});
  await f.c.send("hi",[]);assert.equal(f.c.getSnapshot().messages.length,2);
});
test("EOF without terminal is uncertain failure, not successful history", async () => {
  const f=fixture({consume:async (_r,h)=>h.onToken("partial")});await f.c.send("hi",[]);
  assert.match(f.c.getSnapshot().messages.at(-1).text,/outcome is unknown/);
  assert.equal(f.c.getSnapshot().conversations[0].history.length,1);
});
async function confirmation(f) {await f.c.send("do it",[]);return f.c.getSnapshot().messages.at(-1);}
const confirmConsume=async (_r,h)=>h.onConfirmation({action_id:"action",tool_name:"write",args:{}});
test("confirmation is pending, not resolved, until successful response", async () => {
  const d=deferred();const f=fixture({consume:confirmConsume,request:p=>p==="/v1/actions"?d.promise:undefined});
  const card=await confirmation(f);const p=f.c.resolveConfirmation(card.id,card.actionId,"approve");
  assert.equal(f.c.getSnapshot().messages.at(-1).resolutionStatus,"pending");assert.equal(f.c.getSnapshot().messages.at(-1).resolved,false);
  d.resolve({result:"done"});await p;assert.equal(f.c.getSnapshot().messages.find(m=>m.id===card.id).resolutionStatus,"confirmed");
});
test("ambiguous action outcome remains unresolved and cannot be replayed", async () => {
  const f=fixture({consume:confirmConsume,request:p=>{if(p==="/v1/actions")throw new Error("network");}});
  const card=await confirmation(f);await f.c.resolveConfirmation(card.id,card.actionId,"approve");await f.c.resolveConfirmation(card.id,card.actionId,"approve");
  const next=f.c.getSnapshot().messages.find(m=>m.id===card.id);assert.equal(next.resolved,false);assert.equal(next.resolutionStatus,"uncertain");
  assert.equal(f.calls.filter(c=>c.path==="/v1/actions").length,1);
});
test("explicit validation rejection remains failed, not successful", async () => {
  const f=fixture({consume:confirmConsume,request:p=>{if(p==="/v1/actions")throw Object.assign(new Error("invalid"),{status:422});}});
  const card=await confirmation(f);await f.c.resolveConfirmation(card.id,card.actionId,"deny");
  assert.equal(f.c.getSnapshot().messages.find(m=>m.id===card.id).resolutionStatus,"failed");
});
test("late action result cannot add history to replacement account", async () => {
  const d=deferred();const f=fixture({consume:confirmConsume,request:p=>p==="/v1/actions"?d.promise:undefined});
  const card=await confirmation(f);const p=f.c.resolveConfirmation(card.id,card.actionId,"approve");f.setAuth(authenticated("b"));await tick();d.resolve({result:"OLD"});await p;
  assert.equal(f.c.getSnapshot().messages.length,0);
});
test("late deletion cannot start another request or mutate new state", async () => {
  const d=deferred();const f=fixture({auth:authenticated("a"),remote:true,request:(_p,o)=>o.method==="DELETE"?d.promise:undefined});await tick();
  const p=f.c.deleteConversation("remote");f.setAuth({status:"anonymous",identityKey:null,user:null});const n=f.calls.length;d.resolve({});await p;
  assert.equal(f.calls.length,n);assert.equal(f.c.getSnapshot().conversations[0].persisted,false);
});
test("late detail cannot restore old account data", async () => {
  const d=deferred();const f=fixture({auth:authenticated("a"),remote:true,request:p=>p.endsWith("/remote")?d.promise:undefined});await tick();
  f.setAuth({status:"anonymous",identityKey:null,user:null});d.resolve({id:"remote",messages:[]});await tick();assert.notEqual(f.c.getSnapshot().activeConversationId,"remote");
});
test("stop/start lifecycle invalidates old callbacks without poisoned controller", async () => {
  const d=deferred();const f=fixture({consume:async (_r,h)=>{await d.promise;h.onToken("old");h.onDone();}});
  const p=f.c.send("old",[]);await tick();f.c.stop();assert.equal(f.c.getSnapshot().messages.length,0);f.c.start();d.resolve();await p;
  assert.equal(f.c.getSnapshot().loading,false);assert.equal(f.c.getSnapshot().messages.length,0);
});
test("verification errors deny chat sends instead of becoming guest work", async () => {
  const f=fixture({auth:{status:"error",identityKey:null,user:null}});await f.c.send("private",[]);assert.equal(f.streams.length,0);
});
test("callbacks retained from old render cannot submit as replacement account", async () => {
  const f=fixture();const old=f.c.getActions();f.setAuth(authenticated("b"));await tick();
  await old.send("old draft",[]);assert.equal(f.streams.length,0);
  await f.c.getActions().send("new draft",[]);assert.equal(f.streams.length,1);
});
test("transport receives abort signals and replacement invalidates active stream", async () => {
  const d=deferred();const f=fixture({consume:async()=>d.promise});const p=f.c.send("hi",[]);await tick();
  const signal=f.streams[0].signal;assert.equal(signal.aborted,false);f.setAuth(authenticated("b"));assert.equal(signal.aborted,true);d.resolve();await p;
});
test("late explicit refresh cannot overwrite replacement account", async () => {
  const d=deferred();let n=0;
  const f=fixture({auth:authenticated("a"),request:p=>p==="/v1/conversations"&&++n===2?d.promise:undefined});await tick();
  const p=f.c.refreshConversationIndex();f.setAuth(authenticated("b"));await tick();d.resolve({conversations:[{id:"old",status:"active"}]});await p;
  assert.equal(f.c.getSnapshot().conversations.some(c=>c.id==="old"),false);
});
test("late explicit new conversation cannot add private result", async () => {
  const d=deferred();const f=fixture({auth:authenticated("a"),request:(_p,o)=>o.method==="POST"?d.promise:undefined});await tick();
  const id=f.c.getSnapshot().activeConversationId;const p=f.c.startNewConversation();await tick();f.setAuth(authenticated("b"));await tick();d.resolve({id});await p;
  assert.equal(f.c.getSnapshot().messages.length,0);assert.equal(f.c.getSnapshot().loading,false);
});
