globalThis.__LOD_VAULT_DIRECT_STORE__ = true;
importScripts(
  chrome.runtime.getURL("scripts/store-core.js"),
  chrome.runtime.getURL("scripts/note-autosave.js"),
  chrome.runtime.getURL("scripts/entry-presenter.js"),
  chrome.runtime.getURL("scripts/shared.js"),
  chrome.runtime.getURL("scripts/lod-article.js"),
  chrome.runtime.getURL("scripts/compress.js"),
  chrome.runtime.getURL("scripts/sync.js"),
  chrome.runtime.getURL("scripts/sync-coordinator.js"),
  chrome.runtime.getURL("scripts/background-impl.js")
);
