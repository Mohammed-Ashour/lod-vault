// theme.js — dark/light theme toggle shared by all LODVault pages.
//
// The <html class="light"> class switches the palette via CSS variables
// (styles/blue-night.css). A tiny inline script in each page <head> applies
// the saved theme before first paint; this file wires the ☀/☾ buttons,
// keeps every .theme-btn glyph in sync, and persists the choice.
//
// Usage: <button class="icon-btn theme-btn" onclick="toggleTheme()" ...>☀</button>
(() => {
  const KEY = "blueNightTheme";

  function applyTheme(theme) {
    const light = theme === "light";
    document.documentElement.classList.toggle("light", light);
    const glyph = light ? "☾" : "☀";
    const label = light ? "Switch to dark" : "Switch to light";
    document.querySelectorAll(".theme-btn").forEach((button) => {
      button.textContent = glyph;
      button.title = label;
      button.setAttribute("aria-label", label);
    });
    try {
      localStorage.setItem(KEY, light ? "light" : "dark");
    } catch {
      /* private mode: theme still applies for this session */
    }
  }

  function toggleTheme() {
    const light = document.documentElement.classList.contains("light");
    applyTheme(light ? "dark" : "light");
  }

  let saved = "dark";
  try {
    saved = localStorage.getItem(KEY) || "dark";
  } catch {
    /* ignore */
  }
  applyTheme(saved);

  // CSP-safe wiring: no inline onclick handlers in extension pages.
  document.querySelectorAll(".theme-btn").forEach((button) => {
    button.addEventListener("click", toggleTheme);
  });

  globalThis.toggleTheme = toggleTheme;
  globalThis.applyTheme = applyTheme;
})();
