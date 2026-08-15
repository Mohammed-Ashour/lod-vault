// theme-init.js — pre-paint theme restore, loaded in <head> so the saved
// theme applies before first paint. Must stay an external file: extension
// pages run under MV3 CSP (script-src 'self'), which forbids inline scripts.
try {
  if (localStorage.getItem("blueNightTheme") === "light") {
    document.documentElement.classList.add("light");
  }
} catch (e) {
  // private mode or restricted storage: keep the default dark theme
}
