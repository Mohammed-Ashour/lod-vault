(() => {
  const API_LOCALE = "lb";
  const API_ROOT = `https://lod.lu/api/${API_LOCALE}`;

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalizeSelection(value) {
    return cleanText(value)
      .replace(/^[\s'"„“”‚‘’«»()[\]{}<>.,;:!?/\\|]+/, "")
      .replace(/[\s'"„“”‚‘’«»()[\]{}<>.,;:!?/\\|]+$/, "")
      .trim();
  }

  function normalizeComparable(value) {
    return cleanText(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ß/g, "ss");
  }

  function buildSearchUrl(query) {
    const url = new URL(`${API_ROOT}/search`);
    url.searchParams.set("lang", API_LOCALE);
    url.searchParams.set("query", normalizeSelection(query));
    return url.toString();
  }

  function buildEntryUrl(id) {
    return `${API_ROOT}/entry/${encodeURIComponent(cleanText(id))}`;
  }

  function buildSuggestionUrl(query) {
    const url = new URL(`${API_ROOT}/suggest`);
    url.searchParams.set("query", normalizeSelection(query));
    return url.toString();
  }

  function buildSearchPageUrl(query) {
    return `https://lod.lu/search/${encodeURIComponent(normalizeSelection(query))}/${API_LOCALE}`;
  }

  function stripDiacritics(value) {
    return cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  async function runtimeProxyFetch(url, options = {}) {
    const runtime = globalThis.chrome?.runtime;
    if (typeof runtime?.sendMessage !== "function") {
      throw new Error("Runtime proxy fetch is unavailable.");
    }

    const response = await runtime.sendMessage({
      type: "lod-wrapper:lens-fetch",
      url: String(url || "")
    });

    if (!response?.ok) {
      throw new Error(response?.error || `LOD request failed (${response?.status || 0}).`);
    }

    return {
      ok: true,
      status: response.status,
      json: async () => response.json,
      text: async () => response.text || ""
    };
  }

  function getFetchImplementation(preferredFetch) {
    if (typeof preferredFetch === "function") {
      return preferredFetch;
    }

    if (typeof globalThis.chrome?.runtime?.sendMessage === "function") {
      return runtimeProxyFetch;
    }

    if (typeof globalThis.fetch === "function") {
      return globalThis.fetch.bind(globalThis);
    }

    return null;
  }

  async function fetchJson(url, fetchImpl) {
    const resolvedFetch = getFetchImplementation(fetchImpl);
    if (typeof resolvedFetch !== "function") {
      throw new Error("Fetch is unavailable.");
    }

    let response;
    try {
      response = await resolvedFetch(url, {
        headers: {
          Accept: "application/json"
        }
      });
    } catch (primaryError) {
      if (resolvedFetch !== runtimeProxyFetch || typeof globalThis.fetch !== "function") {
        throw primaryError;
      }

      response = await globalThis.fetch(url, {
        headers: {
          Accept: "application/json"
        }
      });
    }

    if (!response?.ok) {
      throw new Error(`LOD request failed (${response?.status || 0}).`);
    }

    return response.json();
  }

  function mapCandidate(result = {}) {
    const id = cleanText(result.article_id || result.id);
    return {
      id,
      articleId: id,
      word: cleanText(result.word_lb || result.lemma),
      pos: cleanText(result.pos),
      matches: Array.isArray(result.matches) ? result.matches.slice() : [],
      url: id ? `https://lod.lu/artikel/${encodeURIComponent(id)}` : ""
    };
  }

  function partsToText(parts) {
    if (!Array.isArray(parts)) return "";

    return parts.reduce((result, part) => {
      const nested = Array.isArray(part?.parts) ? partsToText(part.parts) : cleanText(part?.content);
      if (!nested) return result;
      if (!result) return nested;
      if (/^[,.;:!?)]/.test(nested) || result.endsWith("'") || result.endsWith("’")) {
        return `${result}${nested}`;
      }
      return `${result} ${nested}`;
    }, "");
  }

  function appendTranslationValue(translations, language, value) {
    const text = cleanText(value);
    if (!language || !text) return;

    const existing = translations[language] ? translations[language].split(" · ") : [];
    if (!existing.includes(text)) {
      existing.push(text);
      translations[language] = existing.join(" · ");
    }
  }

  function extractTranslations(apiEntry = {}) {
    const translations = {};

    for (const micro of apiEntry.microStructures || []) {
      for (const unit of micro.grammaticalUnits || []) {
        for (const meaning of unit.meanings || []) {
          for (const [language, definition] of Object.entries(meaning.targetLanguages || {})) {
            appendTranslationValue(translations, language, partsToText(definition?.parts));
          }
        }
      }
    }

    return translations;
  }

  function extractInflection(apiEntry = {}) {
    for (const micro of apiEntry.microStructures || []) {
      for (const unit of micro.grammaticalUnits || []) {
        for (const meaning of unit.meanings || []) {
          const forms = Array.isArray(meaning?.inflection?.forms)
            ? meaning.inflection.forms.map((form) => cleanText(form?.content)).filter(Boolean)
            : [];
          if (forms.length) return forms.join(" · ");
        }
      }
    }

    return "";
  }

  function extractExample(apiEntry = {}) {
    for (const micro of apiEntry.microStructures || []) {
      for (const unit of micro.grammaticalUnits || []) {
        for (const meaning of unit.meanings || []) {
          for (const example of meaning.examples || []) {
            const text = partsToText(example?.parts);
            if (text) return text;
          }
        }
      }
    }

    return "";
  }

  function normalizeEntryFromApi(apiEntry = {}) {
    const id = cleanText(apiEntry.lod_id);
    const word = cleanText(apiEntry.lemma);

    if (!id || !word) {
      return null;
    }

    return {
      id,
      word,
      url: `https://lod.lu/artikel/${encodeURIComponent(id)}`,
      pos: cleanText(apiEntry.partOfSpeechLabel || apiEntry.partOfSpeech),
      inflection: extractInflection(apiEntry),
      example: extractExample(apiEntry),
      translations: extractTranslations(apiEntry)
    };
  }

  async function search(query, options = {}) {
    const normalizedQuery = normalizeSelection(query);
    if (!normalizedQuery) {
      return { query: "", candidates: [] };
    }

    const data = await fetchJson(buildSearchUrl(normalizedQuery), options.fetch);
    const candidates = Array.isArray(data?.results) ? data.results.map(mapCandidate).filter((candidate) => candidate.id) : [];
    return { query: normalizedQuery, candidates };
  }

  async function fetchEntry(id, options = {}) {
    const data = await fetchJson(buildEntryUrl(id), options.fetch);
    return normalizeEntryFromApi(data?.entry || {});
  }

  async function suggest(query, options = {}) {
    const normalizedQuery = normalizeSelection(query);
    if (!normalizedQuery) return [];

    const suggestionQueries = [...new Set([
      normalizedQuery,
      normalizedQuery.toLowerCase(),
      stripDiacritics(normalizedQuery).toLowerCase()
    ].filter(Boolean))];

    const suggestions = [];
    for (const suggestionQuery of suggestionQueries) {
      const data = await fetchJson(buildSuggestionUrl(suggestionQuery), options.fetch);
      const items = Array.isArray(data?.items) ? data.items : [];
      for (const item of items) {
        const word = normalizeSelection(item?.word || item?.lemma || item);
        if (!word || suggestions.some((suggestion) => suggestion.word === word)) {
          continue;
        }

        suggestions.push({
          word,
          type: cleanText(item?.type),
          url: buildSearchPageUrl(word)
        });

        if (suggestions.length >= 5) {
          return suggestions;
        }
      }
    }

    for (const suggestion of suggestions) {
      try {
        const result = await search(suggestion.word, options);
        const exactCandidate = result.candidates.find((candidate) => scoreCandidate(candidate, suggestion.word) >= 4);
        if (exactCandidate?.id) {
          suggestion.entryId = exactCandidate.id;
          suggestion.url = exactCandidate.url || suggestion.url;
        }
      } catch {
        // Leave this suggestion as a search-page fallback.
      }
    }

    return suggestions;
  }

  function scoreCandidate(candidate, query) {
    const word = normalizeComparable(candidate?.word);
    const normalizedQuery = normalizeComparable(query);
    const matches = Array.isArray(candidate?.matches)
      ? candidate.matches.map((value) => normalizeComparable(String(value).replace(/<[^>]+>/g, ""))).filter(Boolean)
      : [];
    if (!word || !normalizedQuery) return 0;
    if (word === normalizedQuery) return 5;
    if (matches.some((value) => value === normalizedQuery)) return 4;
    if (word.startsWith(normalizedQuery)) return 3;
    if (word.includes(normalizedQuery) || matches.some((value) => value.includes(normalizedQuery))) return 2;
    return 1;
  }

  async function lookup(query, options = {}) {
    const result = await search(query, options);
    const { candidates } = result;

    if (!candidates.length) {
      return {
        ...result,
        status: "not-found",
        entry: null,
        suggestions: await suggest(result.query, options)
      };
    }

    const exactCandidates = candidates.filter((candidate) => scoreCandidate(candidate, result.query) >= 4);

    if (candidates.length === 1) {
      return {
        ...result,
        status: "resolved",
        entry: await fetchEntry(candidates[0].id, options)
      };
    }

    if (exactCandidates.length === 1) {
      return {
        ...result,
        status: "resolved",
        entry: await fetchEntry(exactCandidates[0].id, options)
      };
    }

    return {
      ...result,
      status: "ambiguous",
      entry: null,
      candidates: [...candidates].sort((left, right) => scoreCandidate(right, result.query) - scoreCandidate(left, result.query))
    };
  }

  globalThis.LodWrapperLensLookup = {
    API_ROOT,
    normalizeSelection,
    buildSearchUrl,
    buildEntryUrl,
    mapCandidate,
    extractTranslations,
    extractInflection,
    extractExample,
    normalizeEntryFromApi,
    search,
    fetchEntry,
    suggest,
    lookup,
    buildSuggestionUrl,
    buildSearchPageUrl,
    runtimeProxyFetch,
    getFetchImplementation
  };
})();
