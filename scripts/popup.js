const popupApp = LodVaultPopupApp.createApp({ store: LodVaultStore, chrome });

document.addEventListener("DOMContentLoaded", () => {
  popupApp.init();
});

window.addEventListener("unload", () => {
  popupApp.destroy();
});

// Blue Night — popup tabs (Words / Stats & data) and the settings gear.
// Wired here as an external script: extension pages run under MV3 CSP
// (script-src 'self'), so inline event handlers are not allowed.
document.addEventListener("DOMContentLoaded", () => {
  const tabs = Array.from(document.querySelectorAll(".popup-tab"));
  const panes = Array.from(document.querySelectorAll(".popup-pane"));

  function showPane(name) {
    tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.pane === name));
    panes.forEach((pane) => pane.classList.toggle("is-active", pane.dataset.pane === name));
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => showPane(tab.dataset.pane));
  });

  document.getElementById("open-settings")?.addEventListener("click", () => {
    showPane("stats");
    const details = document.getElementById("data-settings");
    if (details) details.open = true;
  });
});
