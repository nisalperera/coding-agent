// front-end/js/stream.js
//
// Parses the /v1/chat/completions response stream as it actually arrives
// from the backend (see back-end/app/api/chat.py), instead of assuming a
// single JSON document. The backend writes, in order and only as needed:
//
//   1. Zero or more newline-terminated {"type": "progress", ...} lines
//      while waiting for the local vLLM server to become healthy
//      (see app/services/backend_readiness_service.py).
//   2. Either a single non-streamed {"type": "error" | "confirmation_required", ...}
//      NDJSON line, and the response ends there; OR
//   3. {"type": "answer_start"} followed by a newline, then a series of
//      "data: {\"token\": ...}\n\n" SSE-style frames, ending in
//      "data: [DONE]\n\n".
//
// This function dispatches each event to the matching handler as it
// arrives, so the UI can render backend-readiness progress, human-in-the-
// loop confirmations, and streamed tokens without waiting for the whole
// response to finish.

/**
 * @param {Response} response - a fetch() Response whose body is the stream.
 * @param {{
 *   onProgress?: (event: object) => void,
 *   onError?: (event: object) => void,
 *   onConfirmation?: (event: object) => void,
 *   onAnswerStart?: () => void,
 *   onToken?: (token: string) => void,
 *   onDone?: () => void,
 *   onFallback?: (event: object) => void,
 * }} handlers
 */
export async function consumeAgentStream(response, handlers) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith("data: ")) {
      const payload = trimmed.slice(6).trim();
      if (payload === "[DONE]") {
        handlers.onDone?.();
        return;
      }
      try {
        const parsed = JSON.parse(payload);
        if (parsed.token) handlers.onToken?.(parsed.token);
        if (parsed.type === "error") handlers.onError?.(parsed);
      } catch {
        // Ignore an unparseable/partial SSE chunk; more data may follow.
      }
      return;
    }

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return;
    }

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
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      handleLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
    }
  }

  if (buffer.trim()) handleLine(buffer);
}
