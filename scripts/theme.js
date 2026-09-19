// Theme controls shared by popup, Vault and Flashcards. theme-init.js restores
// the saved class before paint; this file updates controls and handles changes.
(() => {
  const KEY = "blueNightTheme";
  const SWITCHING_CLASS = "theme-switching";
  let fade = null;

  function syncControls(light) {
    const label = light ? "Switch to dark" : "Switch to light";
    document.querySelectorAll(".theme-btn").forEach((button) => {
      button.textContent = light ? "☾" : "☀";
      button.title = label;
      button.setAttribute("aria-label", label);
    });
  }

  // Compositor-only crossfade: the old page colour is painted once on a fixed
  // overlay and its opacity animates out, so the palette swap underneath never
  // has to animate a single painted property.
  function fadeOut(oldPageColor) {
    fade?.remove();
    const overlay = document.createElement("div");
    overlay.className = "theme-fade";
    overlay.style.background = oldPageColor;
    overlay.addEventListener("animationend", () => {
      overlay.remove();
      if (fade === overlay) fade = null;
    }, { once: true });
    document.body.appendChild(overlay);
    fade = overlay;
  }

  function applyTheme(light, { animate = false } = {}) {
    const root = document.documentElement;
    const changed = root.classList.contains("light") !== light;

    if (changed) {
      const oldPage = animate
        ? getComputedStyle(root).getPropertyValue("--page").trim() ||
          getComputedStyle(document.body).backgroundColor
        : "";
      // Suppress transitions for the one paint that carries the palette change;
      // otherwise every themed property animates on the main thread for ~150ms.
      root.classList.add(SWITCHING_CLASS);
      root.classList.toggle("light", light);
      if (animate && oldPage) fadeOut(oldPage);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => root.classList.remove(SWITCHING_CLASS))
      );
      try {
        localStorage.setItem(KEY, light ? "light" : "dark");
      } catch {
        // Theme still works for this page when storage is unavailable.
      }
    }

    syncControls(light);
  }

  applyTheme(document.documentElement.classList.contains("light"));
  document.querySelectorAll(".theme-btn").forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(!document.documentElement.classList.contains("light"), { animate: true });
    });
  });
})();
