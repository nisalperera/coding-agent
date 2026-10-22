'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getProject } from '../lib/projects';

const INVALID_PROJECT_ID = new Error(
  'The project route did not provide a valid project ID.'
);

export function useProject(projectId) {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState(null);
  const requestRef = useRef(null);
  const validId = typeof projectId === 'string' && Boolean(projectId.trim()) &&
    projectId !== 'undefined' && projectId !== 'null';

  useEffect(() => {
    if (!validId) return;

    const controller = new AbortController();
    const request = { id: projectId, version, controller };
    requestRef.current = request;

    getProject(projectId, controller.signal).then(project => {
      if (!controller.signal.aborted) {
        setResult({ id: projectId, version, project, error: null });
      }
    }).catch(error => {
      if (!controller.signal.aborted) {
        setResult({ id: projectId, version, project: null, error });
      }
    });

    return () => {
      controller.abort();
      if (requestRef.current === request) requestRef.current = null;
    };
  }, [projectId, validId, version]);

  const reload = useCallback(() => setVersion(value => value + 1), []);
  const replace = useCallback(project => {
    if (project?.id !== projectId) return;
    const request = requestRef.current;
    if (request && (request.id !== projectId || request.version !== version)) return;
    request?.controller.abort();
    setResult({ id: projectId, version, project, error: null });
  }, [projectId, version]);

  if (!validId) {
    return { project: null, loading: false, error: INVALID_PROJECT_ID, reload, replace };
  }
  if (result?.id !== projectId || result.version !== version) {
    return { project: null, loading: true, error: null, reload, replace };
  }
  return { project: result.project, loading: false, error: result.error, reload, replace };
}
