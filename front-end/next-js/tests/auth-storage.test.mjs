import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createAuthSession, safeUser } from "../lib/auth-session.mjs";
function load(mode) {
  const values = new Map();
  const storage = {
    getItem(key) { if(mode==='read')throw new Error('denied');return values.get(key)??null; },
    setItem(key,value) { if(mode==='write')throw new Error('quota');values.set(key,value); },
    removeItem(key) { if(mode==='remove')throw new Error('denied');values.delete(key); },
  };
  const context = vm.createContext({
    window: { get localStorage() { if(mode==='access')throw new Error('denied');return storage; }, dispatchEvent(){} },
    CustomEvent: class {}, useCallback: x=>x, useSyncExternalStore: (subscribe,get)=>get(),
    createAuthSession,safeUser, APP_CONFIG:{BACKEND_URL:'http://test'}, apiFetch:async()=>({user:{user_id:'A'},settings:{github:{enabled:true}}}),
  });
  const integration = readFileSync(new URL('../hooks/useIntegrationSettings.js',import.meta.url),'utf8')
    .replace(/^import .*;$/gm,'').replace(/export /g,'');
  vm.runInContext(integration,context);
  const auth = readFileSync(new URL('../lib/auth.js',import.meta.url),'utf8')
    .replace(/^import .*;$/gm,'').replace(/export /g,'');
  vm.runInContext(auth,context);
  return {context, values, run:code=>vm.runInContext(code,context)};
}
for(const mode of ['access','read','write','remove']) test(`storage ${mode} errors do not break verification or cleanup`,async()=>{
  const x=load(mode);
  assert.doesNotThrow(()=>x.run('getCachedUser()'));
  await x.run('authSession.initialize()');
  assert.equal(x.run('authSession.getSnapshot().identityKey'),'A');
  assert.equal(x.run('useIntegrationSettings().githubIntegrationEnabled'),true);
  await x.run('authSession.logout()');
  assert.equal(x.run('authSession.getSnapshot().user'),null);
  assert.equal(x.run('useIntegrationSettings().githubIntegrationEnabled'),false);
});
test('malformed user cache is ignored',()=>{
  const x=load();x.values.set('agent_user','{bad'); assert.equal(x.run('getCachedUser()'),null);
});
test('provider persistence contains flags only',()=>{
  const x=load();x.run('hydrateIntegrationSettingsFromAuthResponse({github:{enabled:true,token:"secret"},api_key:"secret"})');
  const raw=x.values.get('coding-agent-integration-settings');assert.equal(raw.includes('secret'),false);
});
