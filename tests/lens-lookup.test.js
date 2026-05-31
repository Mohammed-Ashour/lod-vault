const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
  return context.LodWrapperLensLookup;
}

test("normalizeSelection trims punctuation around selected text", () => {
  const lensLookup = loadLensLookup();

  assert.equal(lensLookup.normalizeSelection(' „Haus.” '), "Haus");
  assert.equal(lensLookup.normalizeSelection("\n gees! \t"), "gees");
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
  assert.ok(seen.every((message) => message.type === "lod-wrapper:lens-fetch"));
});
