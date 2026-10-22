'use client';
import { APP_CONFIG } from './config';
import { parseProject } from './project-domain.mjs';
export class ProjectApiError extends Error {
  constructor(message, status, code = '') {
    super(message); this.name = 'ProjectApiError'; this.status = status; this.code = code;
  }
}
function errorMessage(payload, status) {
  if (typeof payload?.detail === 'string') return payload.detail;
  if (typeof payload?.message === 'string') return payload.message;
  if (Array.isArray(payload?.detail)) {
    return payload.detail.map(item => `${Array.isArray(item.loc) ? item.loc.join('.') : 'Request'}: ${typeof item.msg === 'string' ? item.msg : 'Invalid value'}`).join('; ');
  }
  return `Project request failed (${status}).`;
}
async function request(path, { method = 'GET', body, signal, revision } = {}) {
  let response;
  try {
    response = await fetch(`${APP_CONFIG.BACKEND_URL}${path}`, {
      method, credentials: 'include', signal,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ProjectApiError('Could not reach the project service. Check the backend connection.', 0, 'network_error');
  }
  let payload = null;
  try { payload = await response.json(); } catch { /* Response shape is checked below. */ }
  if (!response.ok) throw new ProjectApiError(errorMessage(payload, response.status), response.status, payload?.code ?? '');
  return payload;
}
const itemPath = id => `/v1/projects/${encodeURIComponent(id)}`;
export async function listProjects(signal) {
  const payload = await request('/v1/projects', { signal });
  if (!Array.isArray(payload?.projects)) throw new Error('The project API did not return a projects array.');
  return payload.projects.map(parseProject).filter(item => item.status === 'active');
}
export async function getProject(id, signal) {
  const project = parseProject(await request(itemPath(id), { signal }));
  if (project.id !== id) throw new Error('The project API returned a different project identifier.');
  if (project.status !== 'active') throw new ProjectApiError('This project is no longer available.', 410);
  return project;
}
export async function createProject(body) {
  const project = parseProject(await request('/v1/projects', { method: 'POST', body }));
  if (project.status !== 'active') throw new Error('The created project is not active.');
  return project;
}
export async function updateProject(id, revision, body) {
  const project = parseProject(await request(itemPath(id), { method: 'PATCH', revision, body }));
  if (project.id !== id) throw new Error('The project API returned a different project identifier.');
  if (project.status !== 'active') throw new ProjectApiError('This project is no longer available.', 410);
  return project;
}
export async function softDeleteProject(id, revision) {
  const payload = await request(itemPath(id), { method: 'DELETE', revision });
  if (payload?.id !== id || payload?.status !== 'deleted') throw new Error('The server did not confirm soft deletion. Refresh before retrying.');
  return payload;
}
