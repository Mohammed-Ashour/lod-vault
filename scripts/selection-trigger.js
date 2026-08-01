(() => {
  const BUTTON_ID = "lodvault-selection-trigger";
  const OPEN_LENS_OVERLAY_MESSAGE_TYPE = "lodvault:open-lens-overlay";
  const LOGO_URL = globalThis.chrome?.runtime?.getURL?.("icons/icon32.png") || "";
  const LB_TEXT_MARKERS = ["déi", "gëtt", "ass", "net", "och", "vun", "fir", "mat", "eng", "hunn", "wéi", "wat", "ëmmer", "kënnt", "lëtzebuergesch", "letzebuergesch"];
  let hideTimer = null;
  let lastSelectionText = "";
  let hadSelectionRect = false;
  let languageHeuristicDirty = true;
  let cachedLanguageHeuristicHref = "";
  let cachedLanguageHeuristicResult = false;

  function getButton() {
    return document.getElementById(BUTTON_ID);
  }

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalizeSelection(value) {
    return cleanText(value)
      .replace(/^[\s'"„“”‚‘’«»()[\]{}<>.,;:!?/\\|]+/, "")
      .replace(/[\s'"„“”‚‘’«»()[\]{}<>.,;:!?/\\|]+$/, "")
      .trim();
  }

  function isLuxembourgishLangTag(value) {
    const normalized = String(value || "").toLowerCase();
    return normalized === "lb"
      || normalized.startsWith("lb-")
      || normalized.startsWith("lb_")
      || normalized.includes("lux")
      || normalized.includes("letz");
  }

  function collectLanguageSignals() {
    return [
      document.documentElement?.lang,
      document.body?.lang,
      document.querySelector('meta[property="og:locale"], meta[name="og:locale"]')?.content,
      document.querySelector('meta[http-equiv="content-language"], meta[name="content-language"]')?.content,
      document.querySelector('link[hreflang="lb"]')?.hreflang,
      document.querySelector('[data-lang]')?.getAttribute?.("data-lang")
    ].filter(Boolean);
  }

  function hasLuxembourgishUrlHint() {
    const href = String(location.href || "").toLowerCase();
    return /([?&](lang|locale)=lb)\b/.test(href)
      || /(^|\/)lb(\/|$|[?#])/.test(location.pathname.toLowerCase())
      || /\b(letzebuergesch|luxembourgish|lëtzebuergesch)\b/.test(href);
  }

  function escapeRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function hasMarkerWord(text, marker) {
    const pattern = new RegExp(`(^|[^\\p{L}])${escapeRegex(marker)}(?=$|[^\\p{L}])`, "u");
    return pattern.test(text);
  }

  function getBodyTextSample() {
    const bodyText = document.body?.textContent || "";
    return String(bodyText).toLowerCase().slice(0, 6000);
  }

  function countLuxembourgishMarkers(text) {
    const normalized = String(text || "").toLowerCase();
    return LB_TEXT_MARKERS.reduce((count, marker) => count + (hasMarkerWord(normalized, marker) ? 1 : 0), 0);
  }

  function selectionLooksLuxembourgish(selectionText) {
    const normalized = normalizeSelection(selectionText).toLowerCase();
    if (!normalized) {
      return false;
    }

    if (/[äëéèêïîôöûü]/u.test(normalized)) {
      return true;
    }

    return countLuxembourgishMarkers(normalized) >= 1;
  }

  function pageLooksLuxembourgish() {
    const href = String(location.href || "");
    if (!languageHeuristicDirty && cachedLanguageHeuristicHref === href) {
      return cachedLanguageHeuristicResult;
    }

    const langSignals = collectLanguageSignals();
    if (langSignals.some(isLuxembourgishLangTag)) {
      cachedLanguageHeuristicHref = href;
      cachedLanguageHeuristicResult = true;
      languageHeuristicDirty = false;
      return true;
    }

    if (hasLuxembourgishUrlHint()) {
      cachedLanguageHeuristicHref = href;
      cachedLanguageHeuristicResult = true;
      languageHeuristicDirty = false;
      return true;
    }

    const textSample = getBodyTextSample();
    if (!textSample) {
      cachedLanguageHeuristicHref = href;
      cachedLanguageHeuristicResult = false;
      languageHeuristicDirty = false;
      return false;
    }

    const markerCount = countLuxembourgishMarkers(textSample);
    const host = String(location.hostname || "").toLowerCase();
    cachedLanguageHeuristicHref = href;
    cachedLanguageHeuristicResult = markerCount >= 4
      || (markerCount >= 2 && (host.endsWith(".lu") || host.includes("rtl.lu") || host.includes("wort.lu")));
    languageHeuristicDirty = false;
    return cachedLanguageHeuristicResult;
  }

  function ensureButton() {
    let button = getButton();
    if (button) return button;

    button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "lodvault-selection-trigger is-hidden";
    button.setAttribute("aria-label", "Translate with LODVault");
    button.innerHTML = `<img class="lodvault-selection-trigger-logo" src="${LOGO_URL}" alt="LODVault">`;

    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideButton();
      await openLensOverlay(lastSelectionText);
    });

    document.documentElement.appendChild(button);
    return button;
  }

  function clearHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function hideButton() {
    const button = getButton();
    if (!button) return;
    button.classList.add("is-hidden");
  }

  function scheduleHide(delay = 120) {
    clearHideTimer();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      hideButton();
    }, delay);
  }

  function getSelectionRect() {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

    try {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) return null;
      return rect;
    } catch {
      return null;
    }
  }

  async function requestLensOverlay(selectionText) {
    const runtime = globalThis.chrome?.runtime;
    if (!selectionText || typeof runtime?.sendMessage !== "function") {
      return false;
    }

    try {
      const response = await runtime.sendMessage({
        type: OPEN_LENS_OVERLAY_MESSAGE_TYPE,
        selectionText
      });
      return Boolean(response?.ok);
    } catch {
      return false;
    }
  }

  async function openLensOverlay(selectionText) {
    if (!selectionText) {
      return;
    }

    await requestLensOverlay(selectionText);
  }

  function updateSelectionState() {
    const selectionText = normalizeSelection(window.getSelection?.()?.toString?.() || "");
    const rect = getSelectionRect();
    const shouldEnableForPage = pageLooksLuxembourgish() || selectionLooksLuxembourgish(selectionText);

    if (!shouldEnableForPage) {
      lastSelectionText = "";
      hadSelectionRect = false;
      hideButton();
      return;
    }

    lastSelectionText = selectionText;
    hadSelectionRect = Boolean(rect);

    if (!selectionText || !rect) {
      scheduleHide(80);
      return;
    }

    if (rect.width < 4 && rect.height < 4) {
      scheduleHide(80);
      return;
    }

    const button = ensureButton();
    const top = Math.max(8, rect.top + window.scrollY - 34);
    const left = Math.max(8, Math.min(rect.left + window.scrollX, window.scrollX + window.innerWidth - 44));
    button.style.top = `${top}px`;
    button.style.left = `${left}px`;
    button.classList.remove("is-hidden");
  }

  document.addEventListener("selectionchange", () => {
    clearHideTimer();
    queueMicrotask(updateSelectionState);
  });

  document.addEventListener("mouseup", () => {
    clearHideTimer();
    setTimeout(updateSelectionState, 0);
  });

  document.addEventListener("keyup", (event) => {
    const key = typeof event.key === "string" ? event.key : "";
    if (key === "Shift" || key.startsWith("Arrow")) {
      clearHideTimer();
      setTimeout(updateSelectionState, 0);
    }
  });

  document.addEventListener("mousedown", (event) => {
    if (event.target?.closest?.(`#${BUTTON_ID}, #lodvault-lens-overlay-root`)) return;
    scheduleHide(0);
  });

  window.addEventListener("scroll", () => {
    if (!lastSelectionText || !hadSelectionRect) return;
    updateSelectionState();
  }, { passive: true });

  const languageObserver = globalThis.MutationObserver
    ? new MutationObserver(() => {
        languageHeuristicDirty = true;
      })
    : null;

  languageObserver?.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["lang"]
  });

  globalThis.__LodVaultSelectionTriggerTest = {
    countLuxembourgishMarkers,
    pageLooksLuxembourgish,
    selectionLooksLuxembourgish,
    markLanguageHeuristicDirty() {
      languageHeuristicDirty = true;
    }
  };

  globalThis.LodVaultSelectionTrigger = {
    loaded: true,
    contract: "1"
  };
})();
