const popupApp = LodVaultPopupApp.createApp({ store: LodVaultStore, chrome });

document.addEventListener("DOMContentLoaded", () => {
  void popupApp.init();

  const tabs = document.querySelector(".popup-tabs");
  const showPane = (name) => {
    document.querySelectorAll(".popup-tab").forEach((tab) => {
      const active = tab.dataset.pane === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".popup-pane").forEach((pane) => {
      pane.classList.toggle("is-active", pane.dataset.pane === name);
    });
    if (name === "stats") void popupApp.refreshDataStatus();
  };

  tabs?.addEventListener("click", (event) => {
    const tab = event.target.closest(".popup-tab");
    if (tab) showPane(tab.dataset.pane);
  });

  showPane(tabs?.querySelector(".is-active")?.dataset.pane || "words");
}, { once: true });

window.addEventListener("unload", () => popupApp.destroy());
