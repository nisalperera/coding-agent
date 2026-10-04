// front-end/local/lib/stream.js
//
// Parses the mixed agent response stream:
//
// 1. NDJSON control records:
//    {"type":"progress","message":"...","percent":40}
//    {"type":"answer_start"}
//    {"type":"confirmation_required", ...}
//    {"type":"error","message":"..."}
//
// 2. OpenAI-compatible SSE token frames:
//    data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n
//    data: [DONE]\n\n

function getTokenFromSsePayload(payload) {
    const choices = payload?.choices;

    if (!Array.isArray(choices) || choices.length === 0) {
        return "";
    }

    const delta = choices[0]?.delta;

    if (!delta || typeof delta !== "object") {
        return "";
    }

    const content = delta.content;

    if (typeof content === "string") {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === "string") {
                    return part;
                }

                if (part && typeof part.text === "string") {
                    return part.text;
                }

                return "";
            })
            .join("");
    }

    return "";
}

function parseControlEvent(rawLine, handlers) {
    let event;

    try {
        event = JSON.parse(rawLine);
    } catch {
        return false;
    }

    if (!event || typeof event !== "object" || !event.type) {
        return false;
    }

    switch (event.type) {
        case "progress":
            handlers.onProgress?.(event);
            return true;

        case "error":
            handlers.onError?.(event);
            return true;

        case "confirmation_required":
            handlers.onConfirmation?.(event);
            return true;

        case "answer_start":
            handlers.onAnswerStart?.(event);
            return true;

        case "fallback":
            handlers.onFallback?.(event);
            return true;

        case "done":
            handlers.onDone?.(event);
            return true;

        default:
            return false;
    }
}

function parseSseFrame(frame, handlers) {
    const dataLines = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) {
        return false;
    }

    const data = dataLines.join("\n").trim();

    if (!data) {
        return false;
    }

    if (data === "[DONE]") {
        handlers.onDone?.();
        return true;
    }

    let payload;

    try {
        payload = JSON.parse(data);
    } catch {
        return false;
    }

    const token = getTokenFromSsePayload(payload);

    if (token) {
        handlers.onToken?.(token, payload);
    }

    const finishReason = payload?.choices?.[0]?.finish_reason;

    if (finishReason) {
        handlers.onDone?.(payload);
    }

    return true;
}

export async function consumeAgentStream(response, handlers = {}) {
    if (!response?.body) {
        throw new Error("The server returned an empty response stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let buffer = "";
    let streamFinished = false;

    try {
        while (!streamFinished) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });

            while (buffer.length > 0) {
                const firstNewlineIndex = buffer.indexOf("\n");
                const firstSseBoundaryIndex = buffer.indexOf("\n\n");

                if (buffer.startsWith("data:")) {
                    if (firstSseBoundaryIndex === -1) {
                        break;
                    }

                    const frame = buffer.slice(0, firstSseBoundaryIndex);
                    buffer = buffer.slice(firstSseBoundaryIndex + 2);

                    const handled = parseSseFrame(frame, handlers);

                    if (handled && frame.includes("data: [DONE]")) {
                        streamFinished = true;
                    }

                    continue;
                }

                if (firstNewlineIndex === -1) {
                    break;
                }

                const line = buffer.slice(0, firstNewlineIndex).trim();
                buffer = buffer.slice(firstNewlineIndex + 1);

                if (!line) {
                    continue;
                }

                parseControlEvent(line, handlers);
            }
        }

        const trailingText = decoder.decode();

        if (trailingText) {
            buffer += trailingText;
        }

        if (buffer.startsWith("data:")) {
            parseSseFrame(buffer.trim(), handlers);
        } else if (buffer.trim()) {
            parseControlEvent(buffer.trim(), handlers);
        }
    } finally {
        reader.releaseLock();
    }
}
