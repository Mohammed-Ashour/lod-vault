(() => {
  const core = globalThis.LodVaultStoreCore || {};
  const notes = globalThis.LodVaultNotes || {};
  const presenter = globalThis.LodVaultEntryPresenter || {};

  globalThis.LodVaultStore = {
    ...core,
    ...notes,
    ...presenter
  };
})();
