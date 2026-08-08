(() => {
  const core = globalThis.LodVaultStoreCore || {};
  const notes = globalThis.LodVaultNotes || {};
  const presenter = globalThis.LodVaultEntryPresenter || {};

  // Single HTML injection boundary. `markup` must have every dynamic value
  // escaped with LodVaultStore.escapeHtml first. Parsing via DOMParser means
  // script elements never execute and web-ext lint stays warning-free, but
  // event-handler attributes behave as with innerHTML once inserted. (Unlike
  // fragment parsing, leading whitespace text nodes are dropped — irrelevant
  // for the block containers used here.)
  function setHtml(el, markup) {
    const doc = el.ownerDocument;
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
