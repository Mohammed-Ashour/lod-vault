(() => {
  const store = globalThis.LodWrapperStore || globalThis.LodWrapperStoreCore || {};
  const getIdFromUrl = typeof store.getIdFromUrl === "function"
    ? store.getIdFromUrl
    : (value) => {
        const match = String(value || "").match(/\/artikel\/([^/?#]+)/i);
        return match ? decodeURIComponent(match[1]) : "";
      };
  const getPrimaryMeaning = globalThis.LodWrapperEntryPresenter?.getPrimaryMeaning || ((entry) => {
    if (entry?.translations?.en) return { lang: "en", label: "English", value: entry.translations.en };
    if (entry?.translations?.fr) return { lang: "fr", label: "Français", value: entry.translations.fr };
    if (entry?.translations?.de) return { lang: "de", label: "Deutsch", value: entry.translations.de };
    if (entry?.translations?.pt) return { lang: "pt", label: "Português", value: entry.translations.pt };
    if (entry?.translations?.nl) return { lang: "nl", label: "Nederlands", value: entry.translations.nl };
    return null;
  });

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

  function wordFromUrl() {
    try {
      const params = new URLSearchParams(location.search);
      return cleanWord(params.get("lemma"));
    } catch {
      return "";
    }
  }

  function extractWord() {
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
    const id = getIdFromUrl(location.href);
    const word = extractWord();
    if (!id || !word) return null;

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

  /**
   * Full info text for title attribute (POS + all translations).
   */
  function infoTextFull(entry) {
    const parts = [];
    if (entry?.pos) parts.push(entry.pos);
    const translations = entry?.translations || {};
    if (translations.en) parts.push(`English: ${translations.en}`);
    if (translations.fr) parts.push(`Français: ${translations.fr}`);
    if (translations.de) parts.push(`Deutsch: ${translations.de}`);
    return parts.join(" · ");
  }

  /**
   * Compact info text for the banner display line.
   * Shows POS + primary translation (truncated if long) + "+N" for remaining languages.
   * The full text is available via infoTextFull() for the title attribute.
   */
  function infoText(entry) {
    const parts = [];
    if (entry?.pos) parts.push(entry.pos);

    const meaning = getPrimaryMeaning(entry);
    if (meaning?.label && meaning?.value) {
      let value = meaning.value;
      if (value.length > 30) value = value.slice(0, 28) + "…";
      parts.push(`${meaning.label}: ${value}`);
    }

    const labelToLang = {
      english: "en",
      français: "fr",
      francais: "fr",
      deutsch: "de",
      português: "pt",
      portugues: "pt",
      nederlands: "nl"
    };
    const primaryLang = cleanWord(meaning?.lang).toLowerCase()
      || labelToLang[cleanWord(meaning?.label).toLowerCase()]
      || "";
    const otherCount = Object.keys(entry?.translations || {}).filter(
      (lang) => cleanWord(lang).toLowerCase() !== primaryLang
    ).length;
    if (otherCount > 0) parts.push(`+${otherCount}`);

    return parts.join(" · ");
  }

  globalThis.LodWrapperArticleReader = {
    cleanWord,
    stitchTokens,
    collectText,
    sanitizeHeading,
    getHeadingElement,
    extractTranslations,
    extractCurrentEntry,
    infoText,
    infoTextFull
  };
})();
