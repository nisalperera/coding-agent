'use client';

export async function consumeAgentStream(response, handlers) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('data: ')) {
      const payload = trimmed.slice(6).trim();
      if (payload === '[DONE]') {
        handlers.onDone?.();
        return;
      }
      try {
        const parsed = JSON.parse(payload);
        if (parsed.token) handlers.onToken?.(parsed.token);
        if (parsed.type === 'error') handlers.onError?.(parsed);
      } catch {}
      return;
    }

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return;
    }

    switch (event.type) {
      case 'progress':
        handlers.onProgress?.(event);
        break;
      case 'error':
        handlers.onError?.(event);
        break;
      case 'confirmation_required':
        handlers.onConfirmation?.(event);
        break;
      case 'answer_start':
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
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      handleLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
    }
  }

  if (buffer.trim()) handleLine(buffer);
}
