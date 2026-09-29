// front-end/local/hooks/useChat.js
//
// Chat send/receive logic against POST /v1/chat/completions and POST
// /v1/actions for resolving human-in-the-loop confirmations.
//
// Provider credentials are never sent from browser storage. The FastAPI
// backend owns and injects GitHub/GitLab integration tokens for the current
// authenticated user when an approved tool call is executed.

'use client';

import { useCallback, useRef, useState } from 'react';
import { apiFetch, apiStream, ApiError } from '../lib/api';
import { consumeAgentStream } from '../lib/stream';

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
    setMessages((prev) => prev.map((message) => (message.id === id ? { ...message, ...patch } : message)));
  }, []);

  const removeMessage = useCallback((id) => {
    if (id == null) return;
    setMessages((prev) => prev.filter((message) => message.id !== id));
  }, []);

  const resetHistory = useCallback(() => {
    historyRef.current = [];
    setMessages([]);
  }, []);

  const resolvePendingAction = useCallback(
    async (actionId, decision) => {
      setLoading(true);
      try {
        const result = await apiFetch('/v1/actions', {
          method: 'POST',
          body: {
            action: 'action_pending',
            action_id: actionId,
            decision,
          },
        });
        appendMessage('assistant', result.result ?? 'No response from agent.');
      } catch (error) {
        const detail = error instanceof ApiError ? error.message : String(error);
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
            if (answerId != null) updateMessage(answerId, { text: answerText });
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
      } catch (error) {
        removeMessage(progressId);
        const detail = error instanceof ApiError ? error.message : error.message || String(error);
        appendMessage('assistant', `Request failed: ${detail}`);
      } finally {
        setLoading(false);
      }
    },
    [appendMessage, updateMessage, removeMessage]
  );

  const resolveConfirmation = useCallback(
    async (messageId, actionId, decision) => {
      updateMessage(messageId, { resolved: true });
      await resolvePendingAction(actionId, decision);
    },
    [updateMessage, resolvePendingAction]
  );

  return { messages, loading, send, appendMessage, resetHistory, resolveConfirmation };
}
