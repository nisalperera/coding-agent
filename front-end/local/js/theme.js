// front-end/js/theme.js
//
// Dark/light theme toggle, persisted to localStorage with a system-
// preference fallback on first load.

export function applyTheme(dark) {
  document.documentElement.classList.toggle("dark", dark);
  const icon = document.getElementById("theme-icon");
  if (icon) icon.textContent = dark ? "\u2600\uFE0F" : "\uD83C\uDF19";
  localStorage.setItem("theme", dark ? "dark" : "light");
}

export function toggleTheme() {
  applyTheme(!document.documentElement.classList.contains("dark"));
}

export function initTheme() {
  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved ? saved === "dark" : prefersDark);
}
