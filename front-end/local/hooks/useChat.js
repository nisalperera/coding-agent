'use client';

import { useCallback, useRef, useState } from 'react';
import { apiFetch, apiStream, ApiError } from '../lib/api';
import { consumeAgentStream } from '../lib/stream';
import { getGitLabAccessToken } from '../lib/integrations';

let nextId = 1;
function makeId() {
  return nextId++;
}

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const historyRef = useRef([]);

  const appendMessage = useCallback((role, text, extra = {}) => {
    const id = makeId();
    setMessages((prev) => [...prev, { id, role, text, ...extra }]);
    return id;
  }, []);

  const updateMessage = useCallback((id, patch) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const removeMessage = useCallback((id) => {
    if (id == null) return;
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const resetHistory = useCallback(() => {
    historyRef.current = [];
    setMessages([]);
  }, []);

  const resolvePendingAction = useCallback(
    async (actionId, decision, toolName) => {
      setLoading(true);
      try {
        const isGitlabTool = toolName && toolName.startsWith('gitlab_');
        const result = await apiFetch('/v1/actions', {
          method: 'POST',
          body: {
            action: 'action_pending',
            action_id: actionId,
            decision,
            gitlab_token: isGitlabTool ? getGitLabAccessToken() : null,
          },
        });
        appendMessage('assistant', result.result ?? 'No response from agent.');
      } catch (err) {
        const detail = err instanceof ApiError ? err.message : String(err);
        appendMessage('assistant', `Could not resolve that action: ${detail}`);
      } finally {
        setLoading(false);
      }
    },
    [appendMessage]
  );

  const send = useCallback(
    async (message, attachments) => {
      if (!message && attachments.length === 0) return;

      const filesForRequest = attachments.map(({ name, content }) => ({ name, content }));
      const filesForDisplay = attachments.map(({ name, size }) => ({ name, size }));

      historyRef.current = [
        ...historyRef.current,
        { role: 'user', content: message, attachments: filesForRequest },
      ];
      appendMessage('user', message || '(sent files only)', { files: filesForDisplay });

      setLoading(true);

      let progressId = null;
      let answerId = null;
      let answerText = '';
      let handledTerminalEvent = false;

      try {
        const response = await apiStream('/v1/chat/completions', {
          message,
          history: historyRef.current.slice(0, -1),
          attachments: filesForRequest,
        });

        await consumeAgentStream(response, {
          onProgress: (event) => {
            if (progressId == null) {
              progressId = appendMessage('progress', event.message, { percent: event.percent });
            } else {
              updateMessage(progressId, { text: event.message, percent: event.percent });
            }
          },
          onError: (event) => {
            removeMessage(progressId);
            appendMessage('assistant', event.message ?? 'The agent hit an error.');
            handledTerminalEvent = true;
          },
          onConfirmation: (event) => {
            removeMessage(progressId);
            appendMessage('confirmation', '', {
              toolName: event.tool_name,
              args: event.args,
              actionId: event.action_id,
              resolved: false,
            });
            handledTerminalEvent = true;
          },
          onAnswerStart: () => {
            removeMessage(progressId);
            answerId = appendMessage('assistant', '');
          },
          onToken: (token) => {
            answerText += token;
            if (answerId != null) {
              updateMessage(answerId, { text: answerText });
            }
          },
          onFallback: (event) => {
            removeMessage(progressId);
            const reply = event.result ?? event.error ?? 'No response from agent.';
            appendMessage('assistant', reply);
            historyRef.current = [...historyRef.current, { role: 'assistant', content: reply }];
            handledTerminalEvent = true;
          },
        });

        if (answerId != null) {
          historyRef.current = [...historyRef.current, { role: 'assistant', content: answerText }];
        } else if (!handledTerminalEvent) {
          removeMessage(progressId);
          appendMessage('assistant', 'No response from agent.');
        }
      } catch (err) {
        removeMessage(progressId);
        const detail = err instanceof ApiError ? err.message : err.message || String(err);
        appendMessage('assistant', `Request failed: ${detail}`);
      } finally {
        setLoading(false);
      }
    },
    [appendMessage, updateMessage, removeMessage]
  );

  const resolveConfirmation = useCallback(
    async (messageId, actionId, decision, toolName) => {
      updateMessage(messageId, { resolved: true });
      await resolvePendingAction(actionId, decision, toolName);
    },
    [updateMessage, resolvePendingAction]
  );

  return { messages, loading, send, appendMessage, resetHistory, resolveConfirmation };
}
