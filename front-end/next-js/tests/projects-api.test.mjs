import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const original = await readFile(new URL('../lib/projects.js', import.meta.url), 'utf8');
const code = original.replace("import { APP_CONFIG } from './config';", "const APP_CONFIG = { BACKEND_URL: 'https://test.invalid' };")
  .replace("'./project-domain.mjs'", JSON.stringify(new URL('../lib/project-domain.mjs', import.meta.url).href));
const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const item = { id: 'p1', name: 'Test', description: '', revision: 3, status: 'active', project_type: 'general', languages: ['cpp'], frameworks: [], runtimes: [], database_categories: [] };
function mock(t, status, payload, inspect = () => {}) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options) => { inspect(url, options); return new Response(payload === null ? null : JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }); };
  t.after(() => { globalThis.fetch = previous; });
}
test('list propagates signal and uses credentialed noncached request', async t => {
  const controller = new AbortController();
  mock(t, 200, { projects: [item] }, (url, options) => { assert.equal(url, 'https://test.invalid/v1/projects'); assert.equal(options.signal, controller.signal); assert.equal(options.credentials, 'include'); assert.equal(options.cache, 'no-store'); });
  assert.equal((await api.listProjects(controller.signal))[0].id, 'p1');
});
test('missing API is an error rather than a fake empty list', async t => { mock(t, 404, { detail: 'Not Found' }); await assert.rejects(api.listProjects(), error => error.status === 404); });
test('incompatible responses fail validation', async t => { mock(t, 200, { items: [] }); await assert.rejects(api.listProjects(), /projects array/); });
test('update binds current revision with If-Match', async t => { mock(t, 200, { ...item, revision: 4 }, (url, options) => { assert.equal(options.headers['If-Match'], '"3"'); assert.equal(options.method, 'PATCH'); }); assert.equal((await api.updateProject('p1', 3, { name: 'Test' })).revision, 4); });
test('conflict remains distinguishable', async t => { mock(t, 412, { detail: 'Revision conflict' }); await assert.rejects(api.updateProject('p1', 3, {}), error => error.status === 412); });
test('delete requires explicit soft-deletion acknowledgement', async t => { mock(t, 200, { id: 'p1', status: 'deleted' }, (url, options) => assert.equal(options.headers['If-Match'], '"3"')); assert.equal((await api.softDeleteProject('p1', 3)).status, 'deleted'); });
test('ambiguous delete is not reported as success', async t => { mock(t, 204, null); await assert.rejects(api.softDeleteProject('p1', 3), /did not confirm/); });
test('deleted project cannot load as active', async t => { mock(t, 200, { ...item, status: 'deleted' }); await assert.rejects(api.getProject('p1'), error => error.status === 410); });
test('validation arrays become readable messages', async t => { mock(t, 422, { detail: [{ loc: ['body', 'name'], msg: 'Required' }] }); await assert.rejects(api.createProject({}), /body.name: Required/); });
