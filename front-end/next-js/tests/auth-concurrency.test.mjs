import test from "node:test";
import assert from "node:assert/strict";
import { createAuthSession } from "../lib/auth-session.mjs";
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const reply=(id="A")=>({user:{user_id:id},settings:{github:{enabled:true}}});
const credentials={email:"a@example.com",password:"x"};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test("logout waits for in-flight login before mutating the cookie",async()=>{
 const d=deferred(),calls=[];const s=createAuthSession({request:path=>{calls.push(path);return path.endsWith('/login')?d.promise:Promise.resolve({});}});
 const login=s.login(credentials),logout=s.logout();assert.deepEqual(calls,['/v1/auth/login']);assert.equal(s.getSnapshot().user,null);
 d.resolve({});assert.equal(await login,null);assert.deepEqual(await logout,{confirmed:true});
 assert.deepEqual(calls,['/v1/auth/login','/v1/auth/logout']);assert.equal(s.getSnapshot().operationBusy,false);
});
test("login waits for in-flight logout before mutating the cookie",async()=>{
 const d=deferred(),calls=[];const s=createAuthSession({request:path=>{calls.push(path);return path.endsWith('/logout')?d.promise:Promise.resolve(reply('B'));}});
 const logout=s.logout(),login=s.login(credentials);assert.deepEqual(calls,['/v1/auth/logout']);d.resolve({});await logout;await login;
 assert.deepEqual(calls,['/v1/auth/logout','/v1/auth/login','/v1/auth/me']);assert.equal(s.getSnapshot().identityKey,'B');
});
test("refresh during logout does not restore transitional identity",async()=>{
 const d=deferred(),calls=[];const s=createAuthSession({request:path=>{calls.push(path);return d.promise;}});
 const logout=s.logout(),refresh=s.refresh(),initialize=s.initialize();assert.deepEqual(calls,['/v1/auth/logout']);d.resolve({});await logout;
 assert.equal(await refresh,null);assert.equal(await initialize,null);assert.equal(s.getSnapshot().status,'anonymous');
});
test("refresh during login shares canonical verification",async()=>{
 const d=deferred(),calls=[];const s=createAuthSession({request:path=>{calls.push(path);return path.endsWith('/login')?d.promise:Promise.resolve(reply());}});
 const login=s.login(credentials),a=s.refresh(),b=s.initialize();d.resolve({});await Promise.all([login,a,b]);
 assert.equal(calls.filter(x=>x.endsWith('/me')).length,1);assert.equal(s.getSnapshot().identityKey,'A');
});
test("superseded queued mutation is skipped",async()=>{
 const d=deferred(),calls=[];const s=createAuthSession({request:path=>{calls.push(path);return path.endsWith('/login')?d.promise:Promise.resolve({});}});
 const login=s.login(credentials),registration=s.register({...credentials,name:'A'}),logout=s.logout();d.resolve({});
 assert.equal(await login,null);assert.equal(await registration,null);await logout;assert.deepEqual(calls,['/v1/auth/login','/v1/auth/logout']);
});
test("failed earlier mutation does not poison queued logout",async()=>{
 const d=deferred(),calls=[];const s=createAuthSession({request:path=>{calls.push(path);return path.endsWith('/login')?d.promise:Promise.resolve({});}});
 const login=s.login(credentials),logout=s.logout();d.reject(new Error('network'));
 assert.equal(await login,null);assert.deepEqual(await logout,{confirmed:true});assert.equal(calls.length,2);
});
test("current login failure leaves queue reusable",async()=>{
 let fail=true;const s=createAuthSession({request:async path=>{if(path.endsWith('/login')&&fail)throw new Error('denied');return reply();}});
 await assert.rejects(s.login(credentials),/denied/);assert.equal(s.getSnapshot().operationBusy,false);fail=false;await s.login(credentials);assert.equal(s.getSnapshot().identityKey,'A');
});
test("busy stays true until latest queued operation finishes",async()=>{
 const first=deferred(),last=deferred();const s=createAuthSession({request:path=>path.endsWith('/login')?first.promise:last.promise});
 const login=s.login(credentials),logout=s.logout();first.resolve({});await login;await tick();assert.equal(s.getSnapshot().operationBusy,true);
 last.resolve({});await logout;assert.equal(s.getSnapshot().operationBusy,false);
});
test("late initial verification cannot overwrite logout",async()=>{
 const d=deferred();const s=createAuthSession({request:path=>path.endsWith('/me')?d.promise:Promise.resolve({})});
 const initial=s.initialize();await s.logout();d.resolve(reply());await initial;assert.equal(s.getSnapshot().user,null);
});
test("multiple consumers coalesce initialization and refresh",async()=>{
 const d=deferred();let n=0;const s=createAuthSession({request:()=>{n++;return d.promise;}});
 const a=s.initialize(),b=s.initialize(),c=s.refresh();assert.equal(a,b);assert.equal(b,c);d.resolve(reply());await a;assert.equal(n,1);
});
