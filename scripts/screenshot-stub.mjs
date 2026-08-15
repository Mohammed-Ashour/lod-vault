// screenshot-stub.mjs — chrome.* stub + seeded vault data for dev screenshots
// and render verification. Shared by dev-screenshots.mjs.
const now = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const hoursFromNow = (h) => new Date(Date.now() + h * 36e5).toISOString();

// Seeded vault — the same sample words used across the design prototypes.
export const seed = {
  local: {
    "lodVault.entries": {
      HAUS1: {
        id: "HAUS1", word: "Haus", url: "https://lod.lu/artikel/HAUS1", pos: "n",
        example: "mir hunn nach vill Aarbecht ronderëm eist neit Haus",
        note: "Practice: eist neit Haus — our new house.",
        translations: { en: "house, building · household, family", fr: "maison · foyer, famille", de: "Haus · Gebäude; Haushalt, Familie" },
        favorite: true, study: true, history: true,
        visitCount: 18, createdAt: daysAgo(40), updatedAt: daysAgo(1), lastVisitedAt: daysAgo(1)
      },
      SCHEIN1: {
        id: "SCHEIN1", word: "schéin", url: "https://lod.lu/artikel/SCHEIN1", pos: "adj",
        example: "ech hunn d' Bild vun deem schéine Sonnenënnergang nach haut virun Aen",
        translations: { en: "beautiful · nice, good, well", fr: "beau · agréable", de: "schön · gut" },
        favorite: true, study: true, history: true,
        visitCount: 25, createdAt: daysAgo(34), updatedAt: daysAgo(2), lastVisitedAt: daysAgo(2)
      },
      WAASSER2: {
        id: "WAASSER2", word: "Waasser", url: "https://lod.lu/artikel/WAASSER2", pos: "n",
        example: "dëse Stoft léisst kee Waasser duerch",
        translations: { en: "water · glass of water", fr: "eau", de: "Wasser" },
        favorite: true, study: true, history: true,
        visitCount: 13, createdAt: daysAgo(21), updatedAt: daysAgo(4), lastVisitedAt: daysAgo(4)
      },
      LIEWEN2: {
        id: "LIEWEN2", word: "liewen", url: "https://lod.lu/artikel/LIWEN2", pos: "v",
        example: "ären Hond gesäit schlecht aus, ech mengen, dee lieft net méi laang",
        translations: { en: "to live · to lead one's life", fr: "vivre", de: "leben" },
        favorite: false, study: true, history: true,
        visitCount: 21, createdAt: daysAgo(15), updatedAt: daysAgo(6), lastVisitedAt: daysAgo(6)
      },
      GUTT3: {
        id: "GUTT3", word: "gutt", url: "https://lod.lu/artikel/GUTT3", pos: "adv",
        example: "d' Grompere loossen sech mam neie Messer gutt schielen",
        translations: { en: "easily · without difficulty", fr: "facilement", de: "leicht" },
        favorite: false, study: false, history: true,
        visitCount: 9, createdAt: daysAgo(9), updatedAt: daysAgo(9), lastVisitedAt: daysAgo(9)
      }
    },
    "lodVault.settings": { autoMode: true, syncLanguages: ["en", "fr", "de"], lastVerifiedSyncAt: "" },
    "lodVault.flashcardMeta": {
      HAUS1: { totalReviews: 12, hardCount: 2, goodCount: 8, easyCount: 2, lastReviewedAt: daysAgo(1), dueAt: daysAgo(1), interval: 1 },
      SCHEIN1: { totalReviews: 8, hardCount: 1, goodCount: 5, easyCount: 2, lastReviewedAt: daysAgo(2), dueAt: daysAgo(2), interval: 2 },
      WAASSER2: { totalReviews: 4, hardCount: 1, goodCount: 3, easyCount: 0, lastReviewedAt: daysAgo(3), dueAt: hoursFromNow(3), interval: 5 }
    }
  },
  sync: {}
};

export const stubSource = `
(() => {
  const seed = ${JSON.stringify(seed)};
  const store = { local: { ...seed.local }, sync: { ...seed.sync } };
  const keyed = (keys, area) => Promise.resolve(keys == null
    ? { ...area }
    : [].concat(keys).reduce((out, k) => { out[k] = area[k]; return out; }, {}));
  window.chrome = {
    storage: {
      local: {
        get: (keys) => keyed(keys, store.local),
        set: (items) => { Object.assign(store.local, items); return Promise.resolve(); },
        remove: (keys) => { for (const k of [].concat(keys)) delete store.local[k]; return Promise.resolve(); }
      },
      sync: {
        get: (keys) => keyed(keys, store.sync),
        set: (items) => { Object.assign(store.sync, items); return Promise.resolve(); },
        remove: () => Promise.resolve()
      },
      onChanged: { addListener() {} }
    },
    tabs: {
      query: () => Promise.resolve([{ id: 7, url: "https://lod.lu/artikel/HAUS1", active: true, windowId: 1 }]),
      sendMessage: () => Promise.resolve({ entry: { id: "HAUS1", word: "Haus", url: "https://lod.lu/artikel/HAUS1" } }),
      create: () => Promise.resolve({}),
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} }
    },
    runtime: {
      getURL: (p) => p,
      onMessage: { addListener() {} }
    }
  };
})();
`;
