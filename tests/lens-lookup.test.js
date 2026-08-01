const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { loadSharedStore } = require("./helpers/loaders");

const repoRoot = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "scripts/lens-lookup.js"), "utf8");

function loadLensLookup(fetchImpl = async () => ({ ok: true, json: async () => ({}) }), extraContext = {}) {
  const context = {
    fetch: fetchImpl,
    URL,
    console,
    ...extraContext,
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "scripts/lens-lookup.js" });
  return context.LodVaultLensLookup;
}

test("normalizeSelection trims punctuation around selected text", () => {
  const lensLookup = loadLensLookup();

  assert.equal(lensLookup.normalizeSelection(' „Haus.” '), "Haus");
  assert.equal(lensLookup.normalizeSelection("\n gees! \t"), "gees");
});

test("splitSentence preserves spaces and punctuation for rendering", () => {
  const lensLookup = loadLensLookup();

  assert.deepEqual(JSON.parse(JSON.stringify(lensLookup.splitSentence(" Haus, geet! "))), [
    { text: "Haus,", isWord: true },
    { text: " ", isWord: false },
    { text: "geet", isWord: true }
  ]);
});

test("lookup resolves a single search result into a vault entry", async () => {
  const calls = [];
  const lensLookup = loadLensLookup(async (url) => {
    calls.push(url);
    if (String(url).includes("/search?")) {
      return {
        ok: true,
        json: async () => ({
          results: [
            { article_id: "HAUS1", word_lb: "Haus", pos: "SUBST+N" }
          ]
        })
      };
    }

    return {
      ok: true,
      json: async () => ({
        entry: {
          lod_id: "HAUS1",
          lemma: "Haus",
          partOfSpeechLabel: "SUBST+N",
          microStructures: [
            {
              grammaticalUnits: [
                {
                  meanings: [
                    {
                      inflection: { forms: [{ content: "Haiser" }] },
                      targetLanguages: {
                        en: { parts: [{ content: "house" }, { content: "building" }] },
                        fr: { parts: [{ content: "maison" }] }
                      },
                      examples: [
                        { parts: [{ parts: [{ content: "Dëst" }, { content: "ass" }, { content: "en" }, { content: "Haus" }] }] }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      })
    };
  });

  const result = await lensLookup.lookup("Haus");

  assert.equal(result.status, "resolved");
  assert.equal(result.entry.id, "HAUS1");
  assert.equal(result.entry.word, "Haus");
  assert.equal(result.entry.pos, "SUBST+N");
  assert.equal(result.entry.inflection, "Haiser");
  assert.equal(result.entry.example, "Dëst ass en Haus");
  assert.deepEqual({ ...result.entry.translations }, {
    en: "house building",
    fr: "maison"
  });
  assert.equal(calls.length, 2);
});

test("normalizes encoded dictionary strings from the API", () => {
  const { store } = loadSharedStore();
  const lensLookup = loadLensLookup(undefined, { LodVaultStoreCore: store });

  const entry = lensLookup.normalizeEntryFromApi({
    lod_id: "HAUS1",
    lemma: "Haus",
    partOfSpeechLabel: "Substantiv,&#x20;Neutrum",
    microStructures: [{
      grammaticalUnits: [{
        meanings: [{
          inflection: { forms: [{ content: "Haiser &amp; Haisercher" }] },
          targetLanguages: { en: { parts: [{ content: "house &amp; home" }] } },
          examples: [{ parts: [{ content: "D&#xEB;st Haus" }] }]
        }]
      }]
    }]
  });

  assert.equal(entry.pos, "Substantiv, Neutrum");
  assert.equal(entry.inflection, "Haiser & Haisercher");
  assert.equal(entry.example, "Dëst Haus");
  assert.deepEqual({ ...entry.translations }, { en: "house & home" });
});

test("lookupSentence resolves each word while keeping render tokens", async () => {
  const seenQueries = [];
  const lensLookup = loadLensLookup(async (url) => {
    const href = String(url);
    if (href.includes("/search?")) {
      const query = new URL(href).searchParams.get("query");
      seenQueries.push(query);
      return {
        ok: true,
        json: async () => ({
          results: [
            { article_id: `${query.toUpperCase()}1`, word_lb: query, pos: "X" }
          ]
        })
      };
    }

    const id = decodeURIComponent(href.split("/entry/")[1] || "");
    const word = id.replace(/1$/, "").toLowerCase();
    return {
      ok: true,
      json: async () => ({
        entry: {
          lod_id: id,
          lemma: word,
          partOfSpeechLabel: "X",
          microStructures: []
        }
      })
    };
  });

  const result = await lensLookup.lookupSentence("Haus, geet");

  assert.deepEqual(seenQueries, ["Haus", "geet"]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.tokens)), [
    { text: "Haus,", isWord: true },
    { text: " ", isWord: false },
    { text: "geet", isWord: true }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.words.map((word) => word.status))), ["resolved", "resolved"]);
});

test("lookupSentence deduplicates repeated words and limits request concurrency", async () => {
  const searchQueries = [];
  let activeFetches = 0;
  let maxActiveFetches = 0;
  const delayMs = 10;
  const wait = () => new Promise((resolve) => setTimeout(resolve, delayMs));
  const lensLookup = loadLensLookup(async (url) => {
    activeFetches += 1;
    maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
    await wait();
    const href = String(url);

    try {
      if (href.includes("/search?")) {
        const query = new URL(href).searchParams.get("query");
        searchQueries.push(query);
        return {
          ok: true,
          json: async () => ({
            results: [
              { article_id: `${query.toUpperCase()}1`, word_lb: query, pos: "X" }
            ]
          })
        };
      }

      const id = decodeURIComponent(href.split("/entry/")[1] || "");
      return {
        ok: true,
        json: async () => ({
          entry: {
            lod_id: id,
            lemma: id.replace(/1$/, ""),
            partOfSpeechLabel: "X",
            microStructures: []
          }
        })
      };
    } finally {
      activeFetches -= 1;
    }
  });

  const sentence = "Haus Haus geet geet ass ass mat mat an an haut haut moien moien";
  const result = await lensLookup.lookupSentence(sentence);

  assert.deepEqual(searchQueries, ["Haus", "geet", "ass", "mat", "an", "haut", "moien"]);
  assert.ok(maxActiveFetches <= 6, `expected max concurrency <= 6, got ${maxActiveFetches}`);
  assert.equal(result.words.length, 14);
  assert.ok(result.words.every((word) => word.status === "resolved"));
});

test("lookup returns candidates when multiple exact matches are found", async () => {
  const lensLookup = loadLensLookup(async () => ({
    ok: true,
    json: async () => ({
      results: [
        { article_id: "GINN1", word_lb: "ginn", pos: "VRB" },
        { article_id: "GINN2", word_lb: "ginn", pos: "VRB" }
      ]
    })
  }));

  const result = await lensLookup.lookup("ginn");

  assert.equal(result.status, "ambiguous");
  assert.equal(result.entry, null);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].id, "GINN1");
});

test("lookup does not auto-resolve a single fuzzy search hit", async () => {
  const lensLookup = loadLensLookup(async () => ({
    ok: true,
    json: async () => ({
      results: [
        { article_id: "MOIEN1", word_lb: "moien", pos: "INTJ" }
      ]
    })
  }));

  const result = await lensLookup.lookup("moi");

  assert.equal(result.status, "ambiguous");
  assert.equal(result.entry, null);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].id, "MOIEN1");
});

test("lookup returns first 5 suggestions when no exact result is found", async () => {
  const lensLookup = loadLensLookup(async (url) => ({
    ok: true,
    json: async () => String(url).includes("/search?")
      ? { results: [] }
      : {
          items: [
            { word: "moien" },
            { word: "moies" },
            { word: "mouer" },
            { word: "moin" },
            { word: "Moyen" },
            { word: "extra" }
          ]
        }
  }));

  const result = await lensLookup.lookup("moi");

  assert.equal(result.status, "not-found");
  assert.deepEqual(Array.from(result.suggestions, (item) => item.word), ["moien", "moies", "mouer", "moin", "Moyen"]);
});

test("lookup retries suggestions with a lowercase de-accented query when needed", async () => {
  const seenUrls = [];
  const lensLookup = loadLensLookup(async (url) => {
    seenUrls.push(String(url));
    return {
      ok: true,
      json: async () => {
        const href = String(url);
        if (href.includes("/search?lang=lb&query=d%C3%A9idlechen")) return { results: [] };
        if (href.includes("query=d%C3%A9idlechen")) return { items: [] };
        if (href.includes("query=deidlechen")) return { items: [{ word: "déidlechen" }] };
        return { items: [] };
      }
    };
  });

  const result = await lensLookup.lookup("déidlechen");

  assert.equal(result.status, "not-found");
  assert.deepEqual(Array.from(result.suggestions, (item) => item.word), ["déidlechen"]);
  assert.ok(result.suggestions[0].url.includes("/search/"));
  assert.ok(seenUrls.some((url) => url.includes("query=d%C3%A9idlechen")));
  assert.ok(seenUrls.some((url) => url.includes("query=deidlechen")));
});

test("lookup can resolve an inflected form through the search endpoint", async () => {
  const lensLookup = loadLensLookup(async (url) => {
    const href = String(url);
    if (href.includes("/search?lang=lb&query=d%C3%A9idlechen")) {
      return {
        ok: true,
        json: async () => ({
          results: [
            { article_id: "DEIDLECH1", word_lb: "déidlech", pos: "ADJ", matches: ["<strong>déidlechen</strong>"] }
          ]
        })
      };
    }

    return {
      ok: true,
      json: async () => ({
        entry: {
          lod_id: "DEIDLECH1",
          lemma: "déidlech",
          partOfSpeechLabel: "ADJ",
          microStructures: []
        }
      })
    };
  });

  const result = await lensLookup.lookup("déidlechen");

  assert.equal(result.status, "resolved");
  assert.equal(result.entry.id, "DEIDLECH1");
  assert.equal(result.entry.word, "déidlech");
});

test("lookup does not fall back to page fetch when the runtime proxy fails", async () => {
  let directFetchCalled = false;
  const lensLookup = loadLensLookup(
    async () => {
      directFetchCalled = true;
      return { ok: true, json: async () => ({ results: [] }) };
    },
    {
      chrome: {
        runtime: {
          async sendMessage() {
            return { ok: false, status: 0, error: "proxy unavailable" };
          }
        }
      }
    }
  );

  await assert.rejects(() => lensLookup.search("Haus"), /proxy unavailable/);
  assert.equal(directFetchCalled, false);
});

test("lookup prefers the runtime proxy fetch when available", async () => {
  const seen = [];
  const lensLookup = loadLensLookup(
    async () => {
      throw new Error("direct fetch should not be used");
    },
    {
      chrome: {
        runtime: {
          async sendMessage(message) {
            seen.push(message);
            if (String(message.url).includes("/search?")) {
              return {
                ok: true,
                status: 200,
                json: {
                  results: [
                    { article_id: "HAUS1", word_lb: "Haus", pos: "SUBST+N" }
                  ]
                },
                text: ""
              };
            }

            return {
              ok: true,
              status: 200,
              json: {
                entry: {
                  lod_id: "HAUS1",
                  lemma: "Haus",
                  partOfSpeechLabel: "SUBST+N",
                  microStructures: []
                }
              },
              text: ""
            };
          }
        }
      }
    }
  );

  const result = await lensLookup.lookup("Haus");

  assert.equal(result.status, "resolved");
  assert.equal(result.entry.id, "HAUS1");
  assert.equal(seen.length, 2);
  assert.ok(seen.every((message) => message.type === "lodvault:lens-fetch"));
});
