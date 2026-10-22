'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getProject } from '../lib/projects';
export function useProject(projectId) {
    const [version, setVersion] = useState(0);
    const [state, setState] = useState({ id: null, project: null, loading: true, error: null });
    const controller = useRef(null);
    useEffect(() => {
        if (
            typeof projectId !== "string" ||
            !projectId.trim() ||
            projectId === "undefined" ||
            projectId === "null"
        ) {
            setState({
                id: projectId,
                project: null,
                loading: false,
                error: new Error(
                    "The project route did not provide a valid project ID."
                ),
            });

            return;
        }
        const current = new AbortController(); controller.current = current;
        setState({ id: projectId, project: null, loading: true, error: null });
        getProject(projectId, current.signal).then(project => {
            if (!current.signal.aborted) setState({ id: projectId, project, loading: false, error: null });
        }).catch(error => {
            if (!current.signal.aborted) setState({ id: projectId, project: null, loading: false, error });
        });
        return () => current.abort();
    }, [projectId, version]);
    const reload = useCallback(() => setVersion(value => value + 1), []);
    const replace = useCallback(project => {
        controller.current?.abort();
        setState({ id: project.id, project, loading: false, error: null });
    }, []);
    return { ...(state.id === projectId ? state : { project: null, loading: true, error: null }), reload, replace };
}
