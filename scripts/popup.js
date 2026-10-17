const popupApp = LodVaultPopupApp.createApp({ store: LodVaultStore, chrome });

document.addEventListener("DOMContentLoaded", () => {
  void popupApp.init();

  const tabs = document.querySelector(".popup-tabs");
  const showPane = (name) => {
    document.querySelectorAll(".popup-tab").forEach((tab) => {
      const active = tab.dataset.pane === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
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

  tabs?.addEventListener("keydown", (event) => {
    if (!event.target.matches(".popup-tab") || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [...tabs.querySelectorAll(".popup-tab")];
    const index = items.indexOf(event.target);
    const next = event.key === "Home" ? items[0] : event.key === "End" ? items.at(-1)
      : items[(index + (event.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
    showPane(next.dataset.pane);
    next.focus();
  });

  showPane(tabs?.querySelector(".is-active")?.dataset.pane || "words");
}, { once: true });

window.addEventListener("unload", () => popupApp.destroy());
