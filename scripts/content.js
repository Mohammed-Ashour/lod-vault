const BANNER_ID = "lod-wrapper-banner";
let contextInvalidated = false;
let refreshDebounce = null;
let domObserver = null;
let locationHooksInstalled = false;
let lastRenderKey = "";
let lastAutoRecordKey = "";
let currentAutoMode = false;

function cleanWord(value) {
  return (value || "")
    .replace(/^[\s"'„“”]+/, "")
    .replace(/[\s"'„“”]+$/, "")
    .trim();
}

function stitchTokens(tokens) {
  return tokens.reduce((result, token) => {
    const part = token.trim();
    if (!part) return result;
    if (!result) return part;

    if (/^[,.;:!?)]/.test(part) || result.endsWith("'") || result.endsWith("’") || part.startsWith("(")) {
      return `${result}${part}`;
    }

    return `${result} ${part}`;
  }, "");
}

function collectText(root) {
  if (!root) return "";
  const nodes = root.querySelectorAll(".content");
  if (!nodes.length) return root.textContent.trim();
  return stitchTokens(Array.from(nodes, (node) => node.textContent || ""));
}

function sanitizeHeading(value) {
  return cleanWord(
    (value || "")
      .replace(/\s+kopéiert\b.*$/i, "")
      .replace(/\s+Artikel deelen\b.*$/i, "")
  );
}

function getHeadingElement() {
  return document.querySelector("main h1") || document.querySelector("h1");
}

function getBanner() {
  return document.getElementById(BANNER_ID);
}

function wordFromUrl() {
  try {
    const params = new URLSearchParams(location.search);
    return cleanWord(params.get("lemma"));
  } catch {
    return "";
  }
}

function extractWord() {
  // The URL's ?lemma= param is always in sync with the URL itself,
  // so it is safe during SPA navigation when DOM hasn't updated yet.
  const lemma = wordFromUrl();
  if (lemma) return lemma;

  const ogTitle = cleanWord(document.querySelector('meta[property="og:title"], meta[name="og:title"]')?.content);
  if (ogTitle) {
    return cleanWord(ogTitle.replace(/[„”"]/g, "").replace(/\s*-\s*LOD$/i, ""));
  }

  const titleMatch = (document.title || "").match(/[„"]?(.+?)[”"]?\s*-\s*LOD/i);
  if (titleMatch?.[1]) {
    return cleanWord(titleMatch[1]);
  }

  const heading = sanitizeHeading(getHeadingElement()?.textContent);
  if (heading) return heading;

  return sanitizeHeading(collectText(getHeadingElement()));
}

function wordMatchesUrlId(word, id) {
  if (!word || !id) return false;
  const normalize = (value) => String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00df/g, "ss");
  return normalize(id).startsWith(normalize(word));
}

function addTranslationValue(translations, lang, value) {
  const text = cleanWord(value);
  if (!lang || !text) return;

  const current = translations[lang] ? translations[lang].split(" · ") : [];
  if (!current.includes(text)) {
    current.push(text);
    translations[lang] = current.join(" · ");
  }
}

function normalizeLanguageKey(value) {
  const key = cleanWord(value).toLowerCase();
  const map = {
    de: "de",
    deutsch: "de",
    fr: "fr",
    français: "fr",
    francais: "fr",
    en: "en",
    english: "en",
    pt: "pt",
    português: "pt",
    portugues: "pt",
    nl: "nl",
    nederlands: "nl"
  };
  return map[key] || "";
}

function extractTranslationsFromStructuredBlocks() {
  const groups = Array.from(document.querySelectorAll(".microstructures .targetLanguages, .targetLanguages"));
  const translations = {};

  for (const group of groups) {
    for (const lang of ["de", "fr", "en", "pt", "nl"]) {
      for (const node of group.querySelectorAll(`.${lang}`)) {
        addTranslationValue(translations, lang, collectText(node));
      }
    }
  }

  return translations;
}

function extractTranslationsFromSplitSections() {
  const sections = Array.from(document.querySelectorAll(".entry-definition__section.entry-definition__section--split"));
  const translations = {};

  for (const section of sections) {
    const lines = (section.innerText || "")
      .split(/\n+/)
      .map((line) => cleanWord(line))
      .filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const directMatch = line.match(/^(de|fr|en|pt|nl)\s+(.+)$/i);
      if (directMatch) {
        addTranslationValue(translations, directMatch[1].toLowerCase(), directMatch[2]);
        continue;
      }

      const lang = normalizeLanguageKey(line);
      if (!lang) continue;

      const value = lines[index + 1];
      if (value) {
        addTranslationValue(translations, lang, value);
        index += 1;
      }
    }
  }

  return translations;
}

function extractTranslations() {
  const merged = { ...extractTranslationsFromStructuredBlocks() };
  for (const [lang, value] of Object.entries(extractTranslationsFromSplitSections())) {
    addTranslationValue(merged, lang, value);
  }
  return merged;
}

function extractCurrentEntry() {
  const id = LodWrapperStore.getIdFromUrl(location.href);
  const word = extractWord();
  if (!id || !word) return null;

  // Defend against SPA navigation race: URL has updated but DOM hasn't.
  // If the URL id and the extracted word disagree, the data is stale —
  // skip this round and wait for the next refresh.
  const lemma = wordFromUrl();
  if (!lemma && !wordMatchesUrlId(word, id)) return null;

  return {
    id,
    word,
    url: location.href,
    pos: document.querySelector('meta[name="description"]')?.content?.trim() || "",
    inflection: collectText(document.querySelector(".microstructures .inflection .forms > div") || document.querySelector(".inflection .forms > div")),
    example: collectText(document.querySelector(".microstructures .examples > div") || document.querySelector(".examples > div") || document.querySelector(".examples")),
    translations: extractTranslations()
  };
}

function isExtensionContextInvalidated(error) {
  return String(error || "").includes("Extension context invalidated") || String(error || "").includes("Extension updated — refresh the page");
}

function statusText(savedEntry) {
  if (!savedEntry) return "Not saved yet";

  const labels = [];
  if (savedEntry.favorite) labels.push("Favorites");
  if (savedEntry.study) labels.push("Study");
  if (savedEntry.history) labels.push("History");

  if (!labels.length) return "Not saved yet";
  if (labels.length === 1) return `Saved in ${labels[0]}`;
  if (labels.length === 2) return `Saved in ${labels[0]} and ${labels[1]}`;
  return `Saved in ${labels[0]}, ${labels[1]}, and ${labels[2]}`;
}

function infoText(entry) {
  const parts = [];
  if (entry?.pos) parts.push(entry.pos);
  if (entry?.translations?.en) parts.push(`English: ${entry.translations.en}`);
  else if (entry?.translations?.fr) parts.push(`Français: ${entry.translations.fr}`);
  else if (entry?.translations?.de) parts.push(`Deutsch: ${entry.translations.de}`);
  return parts.join(" · ");
}

function ensureBanner() {
  const heading = getHeadingElement();
  if (!heading) return null;

  let banner = getBanner();
  if (!banner) {
    banner = document.createElement("section");
    banner.id = BANNER_ID;
    banner.innerHTML = `
      <div class="lodw-banner__main">
        <div class="lodw-banner__copy">
          <div class="lodw-banner__eyebrow">
            LODVault
            <span class="lodw-auto-badge is-hidden">Auto</span>
          </div>
          <div class="lodw-banner__status"></div>
          <div class="lodw-banner__info"></div>
        </div>
        <div class="lodw-banner__actions">
          <button type="button" data-list="favorite"></button>
          <button type="button" data-list="study"></button>
        </div>
      </div>
    `;

    banner.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-list]");
      if (!button) return;
      await handleListToggle(button.dataset.list);
    });
  }

  if (banner.parentElement !== heading.parentElement || banner.previousElementSibling !== heading) {
    heading.insertAdjacentElement("afterend", banner);
  }

  return banner;
}

function setButtonsBusy(isBusy) {
  const banner = getBanner();
  if (!banner) return;
  for (const button of banner.querySelectorAll("button[data-list]")) {
    button.disabled = isBusy;
  }
}

function handleInvalidatedContext() {
  if (contextInvalidated) return;
  contextInvalidated = true;

  if (refreshDebounce) {
    clearTimeout(refreshDebounce);
    refreshDebounce = null;
  }

  if (domObserver) {
    domObserver.disconnect();
    domObserver = null;
  }

  const banner = ensureBanner();
  if (!banner) return;

  banner.classList.add("is-warning");
  banner.querySelector(".lodw-banner__status").textContent = "Extension updated — refresh page";
  banner.querySelector(".lodw-banner__info").textContent = "Reload this page to re-enable save actions.";
  setButtonsBusy(true);
}

function buttonLabel(listName, active) {
  if (listName === "favorite") {
    return active ? "★ Favorited" : "☆ Save to Favorites";
  }
  return active ? "✓ In Study" : "+ Add to Study";
}

function buildRenderKey(entry, savedEntry) {
  return JSON.stringify({
    entry,
    favorite: Boolean(savedEntry?.favorite),
    study: Boolean(savedEntry?.study),
    history: Boolean(savedEntry?.history),
    visitCount: Number(savedEntry?.visitCount || 0),
    lastVisitedAt: savedEntry?.lastVisitedAt || "",
    autoMode: currentAutoMode
  });
}

function notifyPopup(entry, savedEntry) {
  try {
    chrome.runtime.sendMessage({
      type: "lod-wrapper:page-state-changed",
      entry: entry || null,
      savedEntry: savedEntry || null
    });
  } catch {
    // Ignore when no extension page is listening.
  }
}

function applyState(savedEntry, sourceEntry = extractCurrentEntry()) {
  const entry = sourceEntry || savedEntry;
  const banner = ensureBanner();
  if (!banner) return;

  if (!entry) {
    banner.style.display = "none";
    lastRenderKey = "";
    return;
  }

  const renderKey = buildRenderKey(entry, savedEntry);
  if (renderKey === lastRenderKey) return;
  lastRenderKey = renderKey;

  banner.style.display = "block";
  banner.classList.remove("is-warning");
  banner.querySelector(".lodw-banner__status").textContent = statusText(savedEntry);
  banner.querySelector(".lodw-banner__info").textContent = infoText(entry) || "Save this word to your personal lists.";

  const autoBadge = banner.querySelector(".lodw-auto-badge");
  if (autoBadge) autoBadge.classList.toggle("is-hidden", !currentAutoMode);

  for (const button of banner.querySelectorAll("button[data-list]")) {
    const isFavorite = button.dataset.list === "favorite";
    const active = isFavorite ? Boolean(savedEntry?.favorite) : Boolean(savedEntry?.study);
    button.textContent = buttonLabel(button.dataset.list, active);
    button.classList.toggle("is-active", active);
  }
}

async function maybeAutoRecord(entry, savedEntry, autoMode = currentAutoMode) {
  if (!autoMode) {
    lastAutoRecordKey = "";
    return savedEntry;
  }

  const autoRecordKey = `${entry.id}|${entry.url}`;
  if (autoRecordKey === lastAutoRecordKey) {
    return savedEntry;
  }

  lastAutoRecordKey = autoRecordKey;
  return LodWrapperStore.recordAutoVisit(entry);
}

async function refreshUI() {
  if (contextInvalidated) return;

  try {
    const entry = extractCurrentEntry();
    if (!entry) {
      applyState(null, null);
      return;
    }

    let savedEntry = await LodWrapperStore.getEntry(entry.id);
    currentAutoMode = await LodWrapperStore.getAutoMode();
    savedEntry = await maybeAutoRecord(entry, savedEntry, currentAutoMode);
    applyState(savedEntry, entry);
    notifyPopup(entry, savedEntry);
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      handleInvalidatedContext();
      return;
    }

    return;
  }
}

function scheduleRefresh(delay = 120) {
  if (contextInvalidated) return;
  if (refreshDebounce) clearTimeout(refreshDebounce);
  refreshDebounce = setTimeout(() => {
    refreshDebounce = null;
    refreshUI();
  }, delay);
}

async function handleListToggle(listName) {
  if (contextInvalidated) return;

  const entry = extractCurrentEntry();
  if (!entry) return;

  setButtonsBusy(true);
  try {
    const savedEntry = await LodWrapperStore.toggleList(entry, listName);
    lastRenderKey = "";
    applyState(savedEntry, entry);
    notifyPopup(entry, savedEntry);
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      handleInvalidatedContext();
      return;
    }

    const banner = ensureBanner();
    if (banner) {
      banner.querySelector(".lodw-banner__status").textContent = "Could not save this word";
    }
    return;
  } finally {
    if (!contextInvalidated) {
      setButtonsBusy(false);
    }
  }
}

function installDomObserver() {
  if (domObserver || typeof MutationObserver === "undefined") return;

  domObserver = new MutationObserver(() => {
    if (getHeadingElement()) scheduleRefresh(80);
  });

  domObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function installLocationHooks() {
  if (locationHooksInstalled) return;
  locationHooksInstalled = true;

  const notifyLocationChange = () => window.dispatchEvent(new Event("lod-wrapper:locationchange"));

  for (const methodName of ["pushState", "replaceState"]) {
    const original = history[methodName];
    history[methodName] = function (...args) {
      const result = original.apply(this, args);
      notifyLocationChange();
      return result;
    };
  }

  window.addEventListener("popstate", notifyLocationChange);
  window.addEventListener("hashchange", notifyLocationChange);
  window.addEventListener("lod-wrapper:locationchange", () => {
    lastRenderKey = "";
    lastAutoRecordKey = "";
    scheduleRefresh(0);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "lod-wrapper:get-current-entry") {
    sendResponse({ entry: extractCurrentEntry() });
    return;
  }

  if (message?.type === "lod-wrapper:sync-state") {
    lastRenderKey = "";
    applyState(message.entry || null, extractCurrentEntry());
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "lod-wrapper:refresh-ui") {
    lastRenderKey = "";
    if (typeof message.autoRecordKey === "string") {
      lastAutoRecordKey = message.autoRecordKey;
    } else if (message.resetAutoCapture) {
      lastAutoRecordKey = "";
    }
    scheduleRefresh(0);
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "lod-wrapper:toggle-list") {
    const entry = extractCurrentEntry();
    if (!entry) {
      sendResponse({ entry: null, sourceEntry: null });
      return;
    }

    LodWrapperStore.toggleList(entry, message.listName)
      .then((savedEntry) => {
        lastRenderKey = "";
        applyState(savedEntry, entry);
        notifyPopup(entry, savedEntry);
        sendResponse({ entry: savedEntry, sourceEntry: entry });
      })
      .catch((error) => {
        if (isExtensionContextInvalidated(error)) {
          handleInvalidatedContext();
        }
        sendResponse({ entry: null, sourceEntry: entry, error: String(error) });
      });

    return true;
  }
});

installDomObserver();
installLocationHooks();
refreshUI();
window.addEventListener("load", () => scheduleRefresh(0), { once: true });
