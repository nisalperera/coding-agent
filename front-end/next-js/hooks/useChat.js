"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { apiFetch, apiStream } from "../lib/api";
import { consumeAgentStream } from "../lib/stream";
import { authSession } from "../lib/auth";
import { createChatController } from "../lib/chat-controller.mjs";

// Authentication comes only from the verified shared controller, not a caller boolean.
export function useChat() {
  const [controller] = useState(() => createChatController({
    request: apiFetch, stream: apiStream, consume: consumeAgentStream, auth: authSession,
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  return { ...state, ...controller.getActions() };
}
