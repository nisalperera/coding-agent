'use client';

import { useCallback, useEffect, useState } from 'react';
import Header from '../components/Header';
import ChatLog from '../components/ChatLog';
import TypingIndicator from '../components/TypingIndicator';
import Composer from '../components/Composer';
import IntegrationsModal from '../components/IntegrationsModal';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useAttachments } from '../hooks/useAttachments';
import { useChat } from '../hooks/useChat';
import { getIntegrationsStatus } from '../lib/integrations';

const EMPTY_INTEGRATIONS = {
    github: {
        connected: false,
        username: null,
        connectedAt: null,
    },
    gitlab: {
        connected: false,
        username: null,
        connectedAt: null,
    },
};

export default function Page() {

    const auth = useAuth();
    const { loginWithGoogle, user } = auth;
    
    const theme = useTheme();

    const {
        messages,
        loading,
        send,
        appendMessage,
        resolveConfirmation,
    } = useChat();

    const [integrationsOpen, setIntegrationsOpen] = useState(false);
    const [integrations, setIntegrations] = useState(EMPTY_INTEGRATIONS);
    const [integrationsLoading, setIntegrationsLoading] = useState(false);
    const [integrationsError, setIntegrationsError] = useState(false);

    const onAttachmentWarning = useCallback(
        (message) => appendMessage('assistant', message),
        [appendMessage],
    );

    const attachmentsState = useAttachments(onAttachmentWarning);

    const refreshIntegrations = useCallback(async () => {
        if (!user) {
            setIntegrations(EMPTY_INTEGRATIONS);
            setIntegrationsError(false);
            return;
        }

        setIntegrationsLoading(true);
        setIntegrationsError(false);

        try {
            const status = await getIntegrationsStatus();
            setIntegrations(status);
        } catch {
            setIntegrationsError(true);
        } finally {
            setIntegrationsLoading(false);
        }
    }, [user]);

    useEffect(() => {
        document.getElementById('input')?.focus();
    }, []);

    useEffect(() => {
        if (user) {
            refreshIntegrations();
            return;
        }

        setIntegrations(EMPTY_INTEGRATIONS);
        setIntegrationsError(false);
    }, [user, refreshIntegrations]);

    const handleUnauthenticatedIntegrationRequest = useCallback(() => {
        setIntegrationsOpen(false);
        loginWithGoogle();
    }, [loginWithGoogle]);

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

            <Composer
                attachmentsState={attachmentsState}
                onSend={send}
                loading={loading}
            />

            <IntegrationsModal
                open={integrationsOpen}
                onClose={() => setIntegrationsOpen(false)}
                integrations={integrations}
                loading={integrationsLoading}
                error={integrationsError}
                onRefresh={refreshIntegrations}
                onUnauthenticated={handleUnauthenticatedIntegrationRequest}
            />
        </>
    );
}