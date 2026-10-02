"use client";

export async function consumeAgentStream(response, handlers) {
    const reader = response.body?.getReader();

    if (!reader) {
        throw new Error("The response body is not readable.");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let receivedDone = false;

    const handleLine = (line) => {
        const trimmed = line.trim();

        if (!trimmed) {
            return;
        }

        if (trimmed.startsWith("data:")) {
            const payload = trimmed.slice(5).trim();

            if (payload === "[DONE]") {
                receivedDone = true;
                handlers.onDone?.();
                return;
            }

            try {
                const parsed = JSON.parse(payload);

                if (parsed.token) {
                    handlers.onToken?.(parsed.token);
                }

                if (parsed.type === "error") {
                    handlers.onError?.(parsed);
                }
            } catch {
                // Ignore malformed incremental SSE payloads.
            }

            return;
        }

        try {
            const event = JSON.parse(trimmed);

            switch (event.type) {
                case "progress":
                    handlers.onProgress?.(event);
                    break;

                case "error":
                    handlers.onError?.(event);
                    break;

                case "confirmation_required":
                    handlers.onConfirmation?.(event);
                    break;

                case "answer_start":
                    handlers.onAnswerStart?.();
                    break;

                default:
                    handlers.onFallback?.(event);
            }
        } catch {
            // Ignore non-JSON non-SSE lines.
        }
    };

    try {
        while (!receivedDone) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });

            let newlineIndex;

            while (
                !receivedDone &&
                (newlineIndex = buffer.indexOf("\n")) !== -1
            ) {
                handleLine(buffer.slice(0, newlineIndex));
                buffer = buffer.slice(newlineIndex + 1);
            }
        }

        if (!receivedDone && buffer.trim()) {
            handleLine(buffer);
        }
    } finally {
        reader.releaseLock();
    }
}
