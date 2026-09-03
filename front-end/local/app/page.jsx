'use client';

import { useCallback, useEffect, useState } from 'react';
import Header from '../components/Header';
import ChatLog from '../components/ChatLog';
import TypingIndicator from '../components/TypingIndicator';
import Composer from '../components/Composer';
import IntegrationsModal from '../components/IntegrationsModal';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useIntegrations } from '../hooks/useIntegrations';
import { useAttachments } from '../hooks/useAttachments';
import { useChat } from '../hooks/useChat';

export default function Page() {
  const [integrationsOpen, setIntegrationsOpen] = useState(false);

  const { messages, loading, send, appendMessage, resolveConfirmation } = useChat();
  const auth = useAuth();
  const theme = useTheme();

  const onIntegrationMessage = useCallback((message) => appendMessage('assistant', message), [appendMessage]);
  const integrations = useIntegrations(onIntegrationMessage);

  const onAttachmentWarning = useCallback((message) => appendMessage('assistant', message), [appendMessage]);
  const attachmentsState = useAttachments(onAttachmentWarning);

  useEffect(() => {
    const pending = sessionStorage.getItem('pending_integration_message');
    if (pending) {
      sessionStorage.removeItem('pending_integration_message');
      appendMessage('assistant', pending);
    }
    integrations.refresh();
    document.getElementById('input')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Header
        auth={auth}
        integrations={integrations}
        onOpenIntegrations={() => setIntegrationsOpen(true)}
        theme={theme}
      />

      <ChatLog
        messages={messages}
        onResolveConfirmation={resolveConfirmation}
        dragProps={{
          onDragEnter: attachmentsState.onDragEnter,
          onDragOver: attachmentsState.onDragOver,
          onDragLeave: attachmentsState.onDragLeave,
          onDrop: attachmentsState.onDrop,
        }}
        dragActive={attachmentsState.dragActive}
      />

      <TypingIndicator visible={loading} />

      <Composer attachmentsState={attachmentsState} onSend={send} loading={loading} />

      <IntegrationsModal
        open={integrationsOpen}
        onClose={() => setIntegrationsOpen(false)}
        integrations={integrations}
      />
    </>
  );
}
