(() => {
  const lookup = globalThis.LodVaultLensLookup;
  const store = globalThis.LodVaultStore;
  const sessionNamespace = globalThis.LodVaultLensSession;
  const renderers = globalThis.LodVaultLensRender;
  const shellNamespace = globalThis.LodVaultLensOverlayShell;
  const sentenceNamespace = globalThis.LodVaultLensSentenceMode;
  const controllerNamespace = globalThis.LodVaultLensController;

  if (
    globalThis.LodVaultLensRuntime
    || !lookup
    || !store
    || !sessionNamespace
    || !renderers
    || !shellNamespace
    || !sentenceNamespace
    || !controllerNamespace?.createController
  ) {
    return;
  }

  globalThis.LodVaultLensRuntime = controllerNamespace.createController({
    lookup,
    store,
    sessions: sessionNamespace.createSessionController(),
    renderers,
    shellNamespace,
    sentenceNamespace
  });
})();
