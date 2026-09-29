'use client';

import { useCallback, useRef, useState } from 'react';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function useAttachments(onWarning) {
  const [attachments, setAttachments] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const dragCounter = useRef(0);

  const clearAttachments = useCallback(() => setAttachments([]), []);

  const removeAttachment = useCallback((idx) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleFileSelect = useCallback(
    async (fileList) => {
      const next = [];
      for (const file of Array.from(fileList)) {
        if (file.size > MAX_FILE_BYTES) {
          onWarning?.(`Skipped **${file.name}** \u2014 exceeds the ${formatBytes(MAX_FILE_BYTES)} limit.`);
          continue;
        }
        try {
          const content = await readFileAsText(file);
          next.push({ name: file.name, size: file.size, content });
        } catch {
          onWarning?.(`Could not read **${file.name}** as text.`);
        }
      }
      setAttachments((prev) => [...prev, ...next]);
    },
    [onWarning]
  );

  const onDragEnter = useCallback((e) => {
    e.preventDefault();
    dragCounter.current += 1;
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragActive(false);
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragActive(false);
      if (e.dataTransfer?.files?.length) handleFileSelect(e.dataTransfer.files);
    },
    [handleFileSelect]
  );

  return {
    attachments,
    dragActive,
    clearAttachments,
    removeAttachment,
    handleFileSelect,
    onDragEnter,
    onDragOver: onDragEnter,
    onDragLeave,
    onDrop,
  };
}
