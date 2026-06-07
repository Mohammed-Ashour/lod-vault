const popupApp = LodVaultPopupApp.createApp({ store: LodVaultStore, chrome });

document.addEventListener("DOMContentLoaded", () => {
  popupApp.init();
});

window.addEventListener("unload", () => {
  popupApp.destroy();
});
