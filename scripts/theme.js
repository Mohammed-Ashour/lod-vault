// Theme controls shared by popup, Vault and Flashcards. theme-init.js restores
// the saved class before paint; this file updates controls and handles changes.
(() => {
  const KEY = "blueNightTheme";

  function applyTheme(light) {
    document.documentElement.classList.toggle("light", light);
    const label = light ? "Switch to dark" : "Switch to light";
    document.querySelectorAll(".theme-btn").forEach((button) => {
      button.textContent = light ? "☾" : "☀";
      button.title = label;
      button.setAttribute("aria-label", label);
    });
    try {
      localStorage.setItem(KEY, light ? "light" : "dark");
    } catch {
      // Theme still works for this page when storage is unavailable.
    }
  }

  applyTheme(document.documentElement.classList.contains("light"));
  document.querySelectorAll(".theme-btn").forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(!document.documentElement.classList.contains("light"));
    });
  });
})();
