const popupApp = LodWrapperPopupApp.createApp({ store: LodWrapperStore, chrome });

document.addEventListener("DOMContentLoaded", () => {
  popupApp.init();
});

window.addEventListener("unload", () => {
  popupApp.destroy();
});
