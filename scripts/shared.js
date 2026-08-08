(() => {
  const core = globalThis.LodVaultStoreCore || {};
  const notes = globalThis.LodVaultNotes || {};
  const presenter = globalThis.LodVaultEntryPresenter || {};

  // Single HTML injection boundary. `markup` must have every dynamic value
  // escaped with LodVaultStore.escapeHtml first. DOMParser keeps the parsed
  // markup inert (no script execution) and keeps web-ext lint warning-free.
  function setHtml(el, markup) {
    const doc = el.ownerDocument || document;
    const parsed = new doc.defaultView.DOMParser().parseFromString(markup || "", "text/html");
    el.replaceChildren(...parsed.body.childNodes);
  }

  globalThis.LodVaultStore = {
    ...core,
    ...notes,
    ...presenter,
    setHtml
  };
})();
