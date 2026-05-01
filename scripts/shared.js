(() => {
  const core = globalThis.LodWrapperStoreCore || {};
  const notes = globalThis.LodWrapperNotes || {};
  const presenter = globalThis.LodWrapperEntryPresenter || {};

  globalThis.LodWrapperStore = {
    ...core,
    ...notes,
    ...presenter
  };
})();
