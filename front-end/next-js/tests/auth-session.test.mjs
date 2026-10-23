import test from "node:test";
import assert from "node:assert/strict";
import { createAuthSession, safeUser } from "../lib/auth-session.mjs";
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const response = (id="A") => ({ user: { user_id:id }, settings: { github:{enabled:true} } });
const failure = (status) => Object.assign(new Error("failure"), {status});
const setup = (request) => {
  const settings = [], users = []; let clears = 0;
  const session = createAuthSession({ request, clearSettings: () => { clears++; }, hydrateSettings: (x) => settings.push(x), writeUser: (x) => users.push(x) });
  return {session, settings, users, clears: () => clears};
};
test("initialization and concurrent consumers make one canonical request", async () => {
  const d=deferred(); let calls=0; const {session}=setup(() => {calls++;return d.promise;});
  const a=session.initialize(), b=session.initialize(), c=session.refresh();
  assert.equal(a,b); assert.equal(b,c); d.resolve(response()); await a;
  await session.initialize(); assert.equal(calls,1); assert.equal(session.getSnapshot().identityKey,"A");
});
test("401 means anonymous", async () => {
  const {session}=setup(async()=>{throw failure(401);}); await session.initialize();
  assert.equal(session.getSnapshot().status,"anonymous"); assert.equal(session.getSnapshot().error,null);
});
for (const status of [undefined,403,500]) test(`failure ${status} is not anonymous`,async()=>{
  const {session}=setup(async()=>{throw failure(status);}); await session.initialize();
  assert.equal(session.getSnapshot().status,"error"); assert.ok(session.getSnapshot().error);
});
test("retry recovers after transport failure",async()=>{
  let fail=true; const {session}=setup(async()=>{if(fail)throw failure(500);return response();});
  await session.initialize(); fail=false; await session.refresh(); assert.equal(session.getSnapshot().status,"authenticated");
});
test("late verification cannot restore logged-out identity or settings",async()=>{
  const d=deferred(); const {session,settings}=setup((path)=>path.endsWith('/me')?d.promise:Promise.resolve());
  const p=session.initialize(); await session.logout(); d.resolve(response()); await p;
  assert.equal(session.getSnapshot().user,null); assert.equal(settings.length,0);
});
test("late old verification cannot overwrite replacement login",async()=>{
  const d=deferred(); let count=0;
  const {session}=setup(async(path)=>path.endsWith('/me')?(++count===1?d.promise:response('B')):{});
  const old=session.initialize(); await session.login({email:' b@example.com ',password:'x'});
  d.resolve(response('A')); await old; assert.equal(session.getSnapshot().identityKey,'B');
});
test("logout failure records unconfirmed server revocation",async()=>{
  const {session}=setup(async()=>{throw failure(503);});
  assert.deepEqual(await session.logout(),{confirmed:false});
  assert.equal(session.getSnapshot().logoutStatus,'unconfirmed'); assert.equal(session.getSnapshot().user,null);
});
test("logout 401 confirms no authenticated session",async()=>{
  const {session}=setup(async()=>{throw failure(401);}); assert.deepEqual(await session.logout(),{confirmed:true});
});
test("malformed successful response is a verification error",async()=>{
  const {session}=setup(async()=>({settings:{}})); await session.initialize(); assert.equal(session.getSnapshot().status,'error');
});
test("cached user projection drops credentials and unrelated fields",()=>{
  assert.deepEqual(safeUser({user_id:'A',email:'a',access_token:'secret',settings:{api_key:'secret'}}),{user_id:'A',email:'a'});
  assert.equal(safeUser([]),null); assert.equal(safeUser({email:'a'}),null);
});
test("account replacement without settings clears old flags",async()=>{
  let id='A'; const {session,settings,clears}=setup(async()=>({user:{user_id:id}}));
  await session.initialize(); id='B'; await session.refresh();
  assert.equal(session.getSnapshot().identityKey,'B'); assert.ok(clears()>=2); assert.deepEqual(settings.at(-1),{});
});
test("logout invalidates a pending login",async()=>{
  const d=deferred(); const {session}=setup((path)=>path.endsWith('/login')?d.promise:Promise.resolve({}));
  const p=session.login({email:'a',password:'x'}); const logout=session.logout();
  assert.equal(session.getSnapshot().user,null);
  d.resolve(response()); assert.equal(await p,null); await logout;
  assert.equal(session.getSnapshot().status,'anonymous');
});
test("subscribers share state and unsubscribe",async()=>{
  const {session}=setup(async()=>response());let n=0;const stop=session.subscribe(()=>n++);
  await session.initialize(); assert.equal(n,1); stop(); await session.refresh(); assert.equal(n,1);
});
