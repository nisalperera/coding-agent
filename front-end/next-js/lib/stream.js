// Mixed NDJSON controls and OpenAI SSE, one terminal outcome per response.
export async function consumeAgentStream(response, handlers = {}) {
  if (!response?.body) throw new Error("The server returned an empty response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", data = [], terminal = false, eof = false;
  const emit = (name, value) => { if (!terminal) handlers[name]?.(value); };
  const end = (name, value) => {
    if (terminal) return;
    terminal = true;
    handlers[name]?.(value);
  };
  function control(event) {
    if (!event || typeof event !== "object") return;
    switch (event.type) {
      case "progress": emit("onProgress", event); break;
      case "answer_start": emit("onAnswerStart", event); break;
      case "error": end("onError", event); break;
      case "confirmation_required": end("onConfirmation", event); break;
      case "fallback": end("onFallback", event); break;
      case "done": end("onDone", event); break;
      default: break;
    }
  }
  function json(text) {
    try { return JSON.parse(text); }
    catch { throw new Error("Malformed agent stream record."); }
  }
  function flush() {
    if (!data.length || terminal) { data = []; return; }
    const text = data.join("\n").trim(); data = [];
    if (!text) return;
    if (text === "[DONE]") { end("onDone"); return; }
    const payload = json(text);
    if (payload.error || payload.type === "error") {
      const error = payload.error ?? payload;
      end("onError", { message: typeof error === "string" ? error : error.message ?? "Agent stream failed.",
        status: error.status ?? error.status_code ?? payload.status }); return;
    }
    if (payload.type) { control(payload); return; }
    const choice = payload.choices?.[0];
    const content = choice?.delta?.content;
    const token = typeof content === "string" ? content : Array.isArray(content)
      ? content.map(part => typeof part === "string" ? part : part?.text ?? "").join("") : "";
    if (token) emit("onToken", token);
    if (choice?.finish_reason) end("onDone", payload);
  }
  function line(raw) {
    if (terminal) return;
    const value = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (value === "") { flush(); return; }
    if (value.startsWith("data:")) { data.push(value.slice(5).trimStart()); return; }
    if (value.startsWith(":") || /^(event|id|retry):/.test(value)) return;
    if (data.length) flush();
    if (!terminal && value.trim()) control(json(value.trim()));
  }
  try {
    while (!terminal) {
      const chunk = await reader.read();
      if (chunk.done) { eof = true; break; }
      buffer += decoder.decode(chunk.value, { stream: true });
      let next;
      while (!terminal && (next = buffer.indexOf("\n")) !== -1) {
        const raw = buffer.slice(0, next); buffer = buffer.slice(next + 1); line(raw);
      }
    }
    if (!terminal) {
      buffer += decoder.decode();
      if (buffer) line(buffer);
      flush();
    }
  } finally {
    // Detach browser reads, not server execution. Never wait indefinitely for cancel.
    if (!eof) { try { void reader.cancel().catch(() => {}); } catch { /* Already closed. */ } }
    reader.releaseLock();
  }
}
