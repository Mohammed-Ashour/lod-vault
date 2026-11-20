(() => {
  const API_LOCALE = "lb";
  const API_ROOT = `https://lod.lu/api/${API_LOCALE}`;
  const SEARCH_LANGUAGES = Object.freeze(["lb", "en", "fr", "de", "pt", "nl"]);
  const DEFAULT_SENTENCE_LOOKUP_CONCURRENCY = 6;

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  const cleanDictionaryText = globalThis.LodVaultStoreCore?.cleanDictionaryText || cleanText;

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

  function buildSearchUrl(query, language = API_LOCALE) {
    if (!SEARCH_LANGUAGES.includes(language)) throw new Error("Unsupported search language.");
    const url = new URL(`${API_ROOT}/search`);
    url.searchParams.set("lang", language);
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

  function buildSearchPageUrl(query, language = API_LOCALE) {
    if (!SEARCH_LANGUAGES.includes(language)) throw new Error("Unsupported search language.");
    return `https://lod.lu/search/${encodeURIComponent(normalizeSelection(query))}/${language}`;
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
      type: "lodvault:lens-fetch",
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

    const response = await resolvedFetch(url, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response?.ok) {
      const error = new Error(`LOD request failed (${response?.status || 0}).`);
      error.status = response?.status || 0;
      throw error;
    }

    return response.json();
  }

  function mapCandidate(result = {}, language = API_LOCALE) {
    const id = cleanText(result.article_id || result.id);
    return {
      id,
      articleId: id,
      word: cleanDictionaryText(result.word_lb || result.lemma),
      pos: cleanDictionaryText(result.pos),
      matches: Array.isArray(result.matches) ? result.matches.slice() : [],
      translations: language === "lb" ? {} : {
        [language]: [...new Set((result.meanings || []).map((meaning) => cleanDictionaryText(meaning.translation)).filter(Boolean))].join(" · ")
      },
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

  // ── Lexicon parser ──────────────────────────────────────────────────────
  // parseLexicon keeps the structure the flattened entry above throws away:
  // gender, plurals, participles and each sense with its own translations and
  // examples. The result is a local-only record (scripts/lexicon-store.js), so it
  // can be richer than the synced entry. The API is undocumented: unknown part
  // types are ignored and every field is optional.
  const LEXICON_VERSION = 1;
  const LEXICON_LANGUAGES = Object.freeze(["en", "fr", "de", "pt", "nl"]);
  const LEXICON_LIMITS = Object.freeze({
    senses: 12,
    examplesPerSense: 3,
    translationsPerLanguage: 4,
    synonymsPerSense: 6,
    categories: 12
  });
  const GENDER_BY_LABEL = Object.freeze({ M: "m", F: "f", N: "n" });

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function uniqueTexts(values) {
    const result = [];
    for (const value of values) {
      const text = cleanDictionaryText(value);
      if (text && !result.includes(text)) result.push(text);
    }
    return result;
  }

  function splitAlternatives(value) {
    return uniqueTexts(String(value ?? "").split(/\s+\/\s+/));
  }

  function lexiconGender(label) {
    const match = /^SUBST\+([MFN])$/i.exec(cleanText(label));
    return match ? GENDER_BY_LABEL[match[1].toUpperCase()] : null;
  }

  // [[translation, clarifier?], ...]. A clarifier qualifies the translations
  // before it ("marcher, aller (à pied)"), so it is kept on the last one, which
  // renders the same way LOD does.
  function lexiconTranslations(parts) {
    const pairs = [];
    for (const part of asArray(parts)) {
      const text = cleanDictionaryText(Array.isArray(part?.parts) ? partsToText(part.parts) : part?.content);
      if (!text) continue;
      if (part?.type === "translation") {
        pairs.push([text]);
      } else if (part?.type === "semanticClarifier") {
        if (!pairs.length) pairs.push([""]);
        const last = pairs[pairs.length - 1];
        last[1] = last[1] ? `${last[1]}; ${text}` : text;
      }
    }
    return pairs.filter((pair) => pair[0] || pair[1]).slice(0, LEXICON_LIMITS.translationsPerLanguage);
  }

  // Joins word tokens the way LOD renders them and records where each
  // inflected headword sits, so a cloze can blank it without guessing.
  function lexiconTokens(parts, spans = null) {
    let text = "";
    for (const part of asArray(parts)) {
      if (!part || typeof part !== "object") continue;
      if (!["text", "word", "inflectedHeadword"].includes(part.type)) continue;
      if (part.type === "text" && Array.isArray(part.parts)) {
        const nested = lexiconTokens(part.parts, spans ? [] : null);
        if (!nested.text) continue;
        const offset = text ? text.length + 1 : 0;
        text = text ? `${text} ${nested.text}` : nested.text;
        if (spans) for (const [start, end] of nested.spans) spans.push([start + offset, end + offset]);
        continue;
      }
      if (part.type !== "word" && part.type !== "inflectedHeadword") continue;
      const content = cleanText(part.content);
      if (!content) continue;
      const join = !text || part.joinWithPreviousWord === true || /['’]$/.test(text);
      const start = join ? text.length : text.length + 1;
      text = join ? `${text}${content}` : `${text} ${content}`;
      if (spans && part.type === "inflectedHeadword") spans.push([start, start + content.length]);
    }
    return { text, spans: spans || [] };
  }

  function lexiconExample(example) {
    let text = "";
    let spans = [];
    let gloss = "";
    const labels = [];
    for (const part of asArray(example?.parts)) {
      if (part?.type === "text") {
        for (const child of asArray(part.parts)) {
          if (child?.type === "attribute") labels.push(child.content);
        }
        const tokens = lexiconTokens(part.parts, []);
        if (!tokens.text) continue;
        const offset = text ? text.length + 1 : 0;
        text = text ? `${text} ${tokens.text}` : tokens.text;
        spans = spans.concat(tokens.spans.map(([start, end]) => [start + offset, end + offset]));
      } else if (part?.type === "gloss") {
        const glossText = lexiconTokens(part.parts).text || cleanText(part.content);
        if (glossText) gloss = gloss ? `${gloss}; ${glossText}` : glossText;
      }
    }
    if (!text) return null;
    const record = { t: text, h: spans };
    const audio = cleanText(example?.audioFiles?.ogg || example?.audioFiles?.aac);
    if (audio) record.a = audio;
    if (gloss) record.g = gloss;
    const exampleLabels = uniqueTexts(labels);
    if (exampleLabels.length) record.l = exampleLabels;
    return record;
  }

  function lexiconForms(inflection) {
    const forms = [];
    const nRule = {};
    for (const form of asArray(inflection?.forms)) {
      const content = cleanDictionaryText(form?.content);
      if (!content) continue;
      if (!forms.includes(content)) forms.push(content);
      const nRuleForm = cleanDictionaryText(form?.nRuleForm);
      if (nRuleForm && nRuleForm !== content) nRule[content] = nRuleForm;
    }
    return { forms, nRule };
  }

  function synonymsBySense(apiEntry) {
    const bySense = new Map();
    for (const group of asArray(apiEntry?.allSynonyms?.synonymGroups)) {
      const number = Number(group?.number);
      if (!Number.isInteger(number)) continue;
      const list = bySense.get(number) || [];
      for (const synonym of asArray(group?.toSynonyms)) list.push(synonym?.syn);
      bySense.set(number, list);
    }
    return bySense;
  }

  function lexiconSense(meaning, unit, index, groupSynonyms) {
    const number = Number.isInteger(meaning?.number) && meaning.number > 0 ? meaning.number : index + 1;
    const sense = {
      id: cleanText(meaning?.meaningID) || `S${number}`,
      n: number
    };
    const gram = uniqueTexts(asArray(unit?.grammaticalInformation));
    if (gram.length) sense.gram = gram;
    const governs = cleanDictionaryText(meaning?.grammaticalInformation);
    if (governs) sense.gov = governs;
    const phrase = cleanDictionaryText(meaning?.secondaryHeadword);
    if (phrase) sense.phrase = phrase;
    const labels = uniqueTexts(asArray(meaning?.attributes));
    if (labels.length) sense.labels = labels;
    const synonyms = uniqueTexts([
      ...asArray(meaning?.synonyms).map((value) => (typeof value === "string" ? value : value?.syn)),
      ...(groupSynonyms.get(number) || [])
    ]).slice(0, LEXICON_LIMITS.synonymsPerSense);
    if (synonyms.length) sense.syn = synonyms;

    const tr = {};
    for (const language of LEXICON_LANGUAGES) {
      const pairs = lexiconTranslations(meaning?.targetLanguages?.[language]?.parts);
      if (pairs.length) tr[language] = pairs;
    }
    sense.tr = tr;

    const { forms } = lexiconForms(meaning?.inflection);
    if (forms.length) sense.plurals = forms;
    const declension = cleanDictionaryText(meaning?.declensionInfo);
    if (declension) sense.decl = declension;

    sense.ex = asArray(meaning?.examples)
      .map(lexiconExample)
      .filter(Boolean)
      .slice(0, LEXICON_LIMITS.examplesPerSense);
    return sense;
  }

  function lexiconConjugation(rows, persons) {
    if (!rows || typeof rows !== "object") return null;
    const forms = persons.map((person) => cleanDictionaryText(rows[person]));
    return forms.some(Boolean) ? forms : null;
  }

  function parseLexicon(apiEntry = {}, options = {}) {
    const id = cleanText(apiEntry?.lod_id);
    const lemma = cleanDictionaryText(apiEntry?.lemma);
    if (!id || !lemma) return null;

    const micros = asArray(apiEntry.microStructures);
    const posLabel = cleanText(apiEntry.partOfSpeechLabel || micros[0]?.partOfSpeechLabel || apiEntry.partOfSpeech);
    const posBase = posLabel.split("+")[0].toUpperCase();
    const fetchedAt = Number.isFinite(options.now) ? options.now : Date.now();
    const record = {
      v: LEXICON_VERSION,
      id,
      fetchedAt,
      lemma,
      pos: posLabel,
      gender: lexiconGender(posLabel)
    };

    const ipa = cleanText(apiEntry.ipa);
    if (ipa) record.ipa = ipa;
    const audio = cleanText(apiEntry.audioFiles?.ogg || apiEntry.audioFiles?.aac);
    if (audio) record.audio = audio;
    const categories = uniqueTexts(asArray(apiEntry.categories).map((category) => category?.code))
      .slice(0, LEXICON_LIMITS.categories);
    if (categories.length) record.cats = categories;
    const nRule = cleanDictionaryText(apiEntry.nRuleForm);
    if (nRule) record.nRule = nRule;

    const groupSynonyms = synonymsBySense(apiEntry);
    const senses = [];
    const nounPlurals = [];
    const pluralNRule = {};
    for (const micro of micros) {
      const microForms = lexiconForms(micro?.inflection);
      nounPlurals.push(...microForms.forms);
      Object.assign(pluralNRule, microForms.nRule);
      for (const unit of asArray(micro?.grammaticalUnits)) {
        for (const meaning of asArray(unit?.meanings)) {
          if (!meaning || typeof meaning !== "object") continue;
          const sense = lexiconSense(meaning, unit, senses.length, groupSynonyms);
          senses.push(sense);
          if (sense.plurals) nounPlurals.push(...sense.plurals);
          Object.assign(pluralNRule, lexiconForms(meaning.inflection).nRule);
        }
      }
    }

    // Keep the first senses plus any the learner chose to focus on.
    const keep = new Set(asArray(options.keepSenses).map(Number));
    const limit = Number.isInteger(options.maxSenses) && options.maxSenses > 0 ? options.maxSenses : LEXICON_LIMITS.senses;
    record.senses = senses.filter((sense, index) => index < limit || keep.has(sense.n));
    if (senses.length > record.senses.length) record.moreSenses = senses.length - record.senses.length;

    if (posBase === "SUBST") {
      const plurals = uniqueTexts(nounPlurals);
      record.noun = {
        plurals,
        noPlural: !plurals.length && senses.some((sense) => /kee\s+plural/i.test(sense.decl || ""))
      };
      if (Object.keys(pluralNRule).length) record.noun.pluralNRule = pluralNRule;
    }

    const conjugation = apiEntry.tables?.verbConjugation;
    const verbMicro = micros.find((micro) => micro?.auxiliaryVerb || micro?.pastParticiple);
    if (posBase === "VRB" || conjugation || verbMicro) {
      const participles = uniqueTexts([
        ...asArray(verbMicro?.pastParticiple),
        ...splitAlternatives(conjugation?.pastParticiple)
      ]);
      const verb = {
        aux: cleanDictionaryText(conjugation?.auxiliaryVerb || verbMicro?.auxiliaryVerb) || null,
        pp: participles,
        separable: cleanText(conjugation?.["@attributes"]?.separableVerb).toLowerCase() === "yes"
      };
      const persons = ["p1", "p2", "p3", "p4", "p5", "p6"];
      const present = lexiconConjugation(conjugation?.indicative?.present, persons);
      if (present) verb.present = present;
      const pastSimple = lexiconConjugation(conjugation?.indicative?.pastSimple, persons);
      if (pastSimple) verb.pastSimple = pastSimple;
      const imperative = lexiconConjugation(conjugation?.imperative?.present, ["p2", "p5"]);
      if (imperative) verb.imperative = imperative;
      record.verb = verb;
    }

    const basicForms = apiEntry.tables?.adjDeclension?.basicForms;
    if (posBase === "ADJ" || basicForms) {
      record.adj = {
        comp: cleanDictionaryText(basicForms?.comparative) || null,
        sup: cleanDictionaryText(basicForms?.superlative) || null
      };
    }

    return record;
  }

  function normalizeEntryFromApi(apiEntry = {}) {
    const id = cleanText(apiEntry.lod_id);
    const word = cleanDictionaryText(apiEntry.lemma);

    if (!id || !word) {
      return null;
    }

    const entry = {
      id,
      word,
      url: `https://lod.lu/artikel/${encodeURIComponent(id)}`,
      pos: cleanText(apiEntry.partOfSpeechLabel || apiEntry.partOfSpeech),
      inflection: extractInflection(apiEntry),
      example: extractExample(apiEntry),
      translations: extractTranslations(apiEntry)
    };
    const normalizeEntry = globalThis.LodVaultStoreCore?.normalizeEntry;
    return typeof normalizeEntry === "function" ? normalizeEntry(entry) : entry;
  }

  async function search(query, options = {}) {
    const normalizedQuery = normalizeSelection(query);
    if (!normalizedQuery) {
      return { query: "", candidates: [] };
    }

    const languages = options.language === "all" ? SEARCH_LANGUAGES : [options.language || API_LOCALE];
    const responses = await Promise.all(languages.map(async (language) => {
      const data = await fetchJson(buildSearchUrl(normalizedQuery, language), options.fetch);
      if (!Array.isArray(data?.results)) throw new Error("Invalid LOD search response.");
      return data.results.map((result) => mapCandidate(result, language)).filter((candidate) => candidate.id && candidate.word);
    }));
    const merged = new Map();
    for (const candidates of responses) {
      for (const candidate of candidates) {
        const existing = merged.get(candidate.id);
        if (existing) {
          Object.assign(existing.translations, candidate.translations);
        } else {
          merged.set(candidate.id, candidate);
        }
      }
    }
    return { query: normalizedQuery, candidates: [...merged.values()] };
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
        const word = normalizeSelection(cleanDictionaryText(item?.word || item?.lemma || item));
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

    if (candidates.length === 1 && exactCandidates.length === 1) {
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

  async function mapWithConcurrency(items, limit, mapper) {
    const normalizedLimit = Math.max(1, Math.floor(Number(limit) || 1));
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(normalizedLimit, items.length) }, () => worker())
    );

    return results;
  }

  function cloneLookupWordResult(result = {}, tokenText = result.text || "") {
    return {
      text: tokenText,
      word: cleanText(result.word),
      status: cleanText(result.status) || "error",
      entry: result.entry
        ? {
            ...result.entry,
            translations: { ...(result.entry.translations || {}) }
          }
        : null,
      candidates: Array.isArray(result.candidates)
        ? result.candidates.map((candidate) => ({
            ...candidate,
            matches: Array.isArray(candidate.matches) ? candidate.matches.slice() : []
          }))
        : [],
      suggestions: Array.isArray(result.suggestions)
        ? result.suggestions.map((suggestion) => ({ ...suggestion }))
        : []
    };
  }

  function isSentence(text) {
    const normalized = normalizeSelection(text);
    if (!normalized) return false;
    const words = normalized.split(/\s+/).filter(Boolean);
    return words.length > 1;
  }

  function splitSentence(text) {
    const normalized = normalizeSelection(text);
    if (!normalized) return [];
    return normalized
      .split(/(\s+)/)
      .filter((chunk) => chunk.length > 0)
      .map((chunk) => ({
        text: chunk,
        isWord: Boolean(normalizeSelection(chunk))
      }));
  }

  async function lookupSentence(text, options = {}) {
    const normalizedQuery = normalizeSelection(text);
    if (!normalizedQuery) {
      return { words: [], query: "" };
    }

    const tokens = splitSentence(normalizedQuery);
    const wordTokens = tokens.filter((t) => t.isWord);
    const uniqueWords = [...new Set(wordTokens.map((token) => normalizeSelection(token.text)).filter(Boolean))];
    const lookupByWord = new Map();

    await mapWithConcurrency(
      uniqueWords,
      options.sentenceConcurrency || DEFAULT_SENTENCE_LOOKUP_CONCURRENCY,
      async (word) => {
        try {
          const result = await lookup(word, options);
          lookupByWord.set(word, {
            text: word,
            word: result.query,
            status: result.status,
            entry: result.entry || null,
            candidates: result.candidates || [],
            suggestions: result.suggestions || []
          });
        } catch {
          lookupByWord.set(word, {
            text: word,
            word,
            status: "error",
            entry: null,
            candidates: [],
            suggestions: []
          });
        }
      }
    );

    const wordResults = wordTokens.map((token) => {
      const word = normalizeSelection(token.text);
      if (!word) {
        return { text: token.text, word, status: "skipped", entry: null, candidates: [], suggestions: [] };
      }

      return cloneLookupWordResult(lookupByWord.get(word), token.text);
    });

    return {
      query: normalizedQuery,
      tokens,
      words: wordResults
    };
  }

  globalThis.LodVaultLensLookup = {
    API_ROOT,
    SEARCH_LANGUAGES,
    normalizeSelection,
    buildSearchUrl,
    buildEntryUrl,
    mapCandidate,
    extractTranslations,
    extractInflection,
    extractExample,
    normalizeEntryFromApi,
    parseLexicon,
    LEXICON_VERSION,
    LEXICON_LIMITS,
    search,
    fetchEntry,
    suggest,
    lookup,
    lookupSentence,
    isSentence,
    splitSentence,
    buildSuggestionUrl,
    buildSearchPageUrl,
    runtimeProxyFetch,
    getFetchImplementation,
    mapWithConcurrency
  };
})();
