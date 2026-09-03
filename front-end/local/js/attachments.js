// front-end/js/attachments.js
//
// File attachment handling: selection, size validation, drag & drop, and
// the small "chip" UI showing files staged for the next message.

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB per file; keep in sync with any reverse-proxy body-size limit.

let attachments = []; // [{ name, size, content }]
let onWarning = () => {};

export function initAttachments({ onWarning: warningHandler } = {}) {
  if (warningHandler) onWarning = warningHandler;

  const dropOverlay = document.getElementById("drop-overlay");
  let dragCounter = 0;

  ["dragenter", "dragover"].forEach((evt) => {
    document.body.addEventListener(evt, (e) => {
      e.preventDefault();
      dragCounter++;
      dropOverlay?.classList.remove("hidden");
      dropOverlay?.classList.add("flex");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    document.body.addEventListener(evt, (e) => {
      e.preventDefault();
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) {
        dropOverlay?.classList.add("hidden");
        dropOverlay?.classList.remove("flex");
      }
    });
  });

  document.body.addEventListener("drop", (e) => {
    if (e.dataTransfer?.files?.length) handleFileSelect(e.dataTransfer.files);
  });
}

export function getAttachments() {
  return attachments;
}

export function clearAttachments() {
  attachments = [];
  renderFileChips();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function renderFileChips() {
  const box = document.getElementById("file-chips");
  if (!box) return;
  box.innerHTML = "";
  box.classList.toggle("hidden", attachments.length === 0);

  attachments.forEach((file, idx) => {
    const chip = document.createElement("div");
    chip.className =
      "file-chip flex items-center gap-1.5 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full pl-3 pr-1.5 py-1";

    const label = document.createElement("span");
    label.className = "max-w-[10rem] truncate";
    label.textContent = file.name;
    chip.appendChild(label);

    const size = document.createElement("span");
    size.className = "text-slate-400";
    size.textContent = formatBytes(file.size);
    chip.appendChild(size);

    const removeBtn = document.createElement("button");
    removeBtn.className = "h-5 w-5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center";
    removeBtn.innerHTML = "&times;";
    removeBtn.onclick = () => {
      attachments.splice(idx, 1);
      renderFileChips();
    };
    chip.appendChild(removeBtn);

    box.appendChild(chip);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export async function handleFileSelect(fileList) {
  for (const file of Array.from(fileList)) {
    if (file.size > MAX_FILE_BYTES) {
      onWarning(`Skipped **${file.name}** \u2014 exceeds the ${formatBytes(MAX_FILE_BYTES)} limit.`);
      continue;
    }
    try {
      const content = await readFileAsText(file);
      attachments.push({ name: file.name, size: file.size, content });
    } catch {
      onWarning(`Could not read **${file.name}** as text.`);
    }
  }

  const fileInput = document.getElementById("file-input");
  if (fileInput) fileInput.value = "";
  renderFileChips();
}
