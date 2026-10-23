import test from "node:test";
import assert from "node:assert/strict";
import { createIdentityLease, preferenceStorageKey, readPreferences } from "../lib/identity-lease.mjs";
function fixture() {
  let state = { status: "authenticated", identityKey: "a", user: { user_id: "a" } };
  const expected = state;
  const scope = createIdentityLease(() => state, expected);
  scope.activate();
  return { scope, set(next) { state = next; scope.observe(); }, expected };
}
test("current verified identity accepts operations", () => {
 const f=fixture(), op=f.scope.begin();assert.equal(op.isCurrent(),true);op.close();assert.equal(op.isCurrent(),false);
});
test("identity replacement aborts pending reads and mutations synchronously", () => {
 const f=fixture(), a=f.scope.begin(),b=f.scope.begin();f.set({status:"authenticated",identityKey:"b",user:{user_id:"b"}});
 assert.equal(a.signal.aborted,true);assert.equal(b.signal.aborted,true);assert.equal(a.isCurrent(),false);
});
test("same id after anonymous transition cannot revive an old lease", () => {
 const f=fixture(),op=f.scope.begin();f.set({status:"anonymous",identityKey:null,user:null});f.set(f.expected);f.scope.activate();
 assert.equal(op.isCurrent(),false);assert.equal(f.scope.begin().isCurrent(),true);
});
test("unmount/remount Strict Mode replay invalidates previous epoch", () => {
 const f=fixture(),op=f.scope.begin();f.scope.deactivate();f.scope.activate();assert.equal(op.isCurrent(),false);assert.equal(f.scope.begin().isCurrent(),true);
});
test("same-user reverified user object invalidates prior scope", () => {
 const f=fixture(),op=f.scope.begin();f.set({...f.expected,user:{user_id:"a"}});assert.equal(op.isCurrent(),false);assert.throws(()=>f.scope.begin(),/superseded/);
});
test("live auth mismatch is rejected even before observer delivery", () => {
 let state={status:"authenticated",identityKey:"a",user:{user_id:"a"}};
 const scope=createIdentityLease(()=>state,state);scope.activate();const op=scope.begin();
 state={status:"error",identityKey:null,user:null};assert.equal(op.isCurrent(),false);
});
test("cancelled operation remains invalid after scope is active again", () => {
 const f=fixture(),op=f.scope.begin();op.cancel();assert.equal(op.signal.aborted,true);assert.equal(op.isCurrent(),false);
});
test("account preference keys are isolated and encode identifiers", () => {
 assert.notEqual(preferenceStorageKey("a"),preferenceStorageKey("b"));assert.equal(preferenceStorageKey(null),null);
 assert.equal(preferenceStorageKey("a:b"),"coding-agent-settings:account:a%3Ab");
});
test("preferences never import the legacy global key or another account", () => {
 const defaults={compactMode:false};const values=new Map([["coding-agent-settings",'{"compactMode":true}'],[preferenceStorageKey("a"),'{"compactMode":true}']]);
 const storage={getItem:key=>values.get(key)};
 assert.deepEqual(readPreferences(storage,preferenceStorageKey("b"),defaults),defaults);
 assert.equal(readPreferences(storage,preferenceStorageKey("a"),defaults).compactMode,true);
});
test("preference parsing allowlists boolean fields and ignores unexpected content", () => {
 const storage={getItem:()=>'{"compactMode":true,"apiKey":"DO-NOT-IMPORT","showSources":"false"}'};
 assert.deepEqual(readPreferences(storage,"a",{compactMode:false,showSources:true}),{compactMode:true,showSources:true});
});
test("storage denial and malformed JSON use defaults", () => {
 const defaults={compactMode:false};assert.deepEqual(readPreferences({getItem(){throw Error("denied");}},"a",defaults),defaults);
 assert.deepEqual(readPreferences({getItem:()=>"{"},"a",defaults),defaults);
});
