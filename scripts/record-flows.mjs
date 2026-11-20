// Flows for scripts/record-flow.mjs: fixtures and the steps to record for PR
// screenshots and GIFs. Fixture data only, never a real vault.
const DAY = 86400e3;
const iso = (offsetDays, hour = 9) => {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString();
};
const todayNumber = () => {
  const now = new Date();
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY);
};

const WORDS = [
  ["HAUS1", "Haus", "SUBST+N", "house", "GWS A1"],
  ["FRA1", "Fra", "SUBST+F", "woman", "GWS A1"],
  ["MANN1", "Mann", "SUBST+M", "man", "GWS A1"],
  ["GOEN1", "goen", "VRB", "to go", "GWS A1"],
  ["MAACHEN1", "maachen", "VRB", "to do, to make", "GWS A1"],
  ["GROUSS2", "grouss", "ADJ", "big, tall", "GWS A1"],
  ["KAND1", "Kand", "SUBST+N", "child", "GWS A1"],
  ["SCHOUL1", "Schoul", "SUBST+F", "school", "GWS A2"],
  ["DAG1", "Dag", "SUBST+M", "day", "GWS A1"],
  ["SCHEIN1", "schéin", "ADJ", "beautiful", "GWS A2"],
  ["IESSEN1", "iessen", "VRB", "to eat", "GWS A1"],
  ["DRENKEN1", "drénken", "VRB", "to drink", "GWS A1"],
  ["BUCH1", "Buch", "SUBST+N", "book", "GWS A2"],
  ["STAD1", "Stad", "SUBST+F", "city, town", "GWS B1"],
  ["WAASSER1", "Waasser", "SUBST+N", "water", "GWS A1"],
  ["KAFFI1", "Kaffi", "SUBST+M", "coffee", "GWS A1"]
];

function baseEntries() {
  const entries = {};
  WORDS.forEach(([id, word, pos, en], index) => {
    entries[id] = {
      id, word, pos, url: `https://lod.lu/artikel/${id}`,
      translations: { en, fr: "", de: "" },
      study: true, history: true, favorite: index % 4 === 0,
      createdAt: iso(-90 + index), updatedAt: iso(-10)
    };
  });
  return entries;
}

// 9 reviews today, 3 words still due, and a year of activity with one missed
// day covered by a freeze four days ago.
export function studySeed({ reviewsToday = 9 } = {}) {
  const entries = baseEntries();
  const meta = {};
  WORDS.forEach(([id], index) => {
    if (index < reviewsToday) {
      meta[id] = {
        totalReviews: 4,
        reviews: [{ date: iso(-30), rating: 2 }, { date: iso(-12), rating: 2 }, { date: iso(-5), rating: index % 5 ? 2 : 1 }, { date: iso(0, 8), rating: 2 }],
        lastReviewedAt: iso(0, 8), dueAt: iso(3 + (index % 9) * 3, 0), interval: 3 + index * 2
      };
    } else if (index < reviewsToday + 3) {
      meta[id] = {
        totalReviews: 3,
        reviews: [{ date: iso(-40), rating: 2 }, { date: iso(-25), rating: 2 }, { date: iso(-3), rating: 2 }],
        lastReviewedAt: iso(-3), dueAt: iso(-1, 0), interval: 2
      };
    }
  });
  const today = todayNumber();
  const days = {};
  for (let offset = 300; offset >= 1; offset -= 1) {
    const reviews = (offset * 37) % 53;
    if (offset > 40 && offset % 9 === 4) continue;
    days[today - offset] = [reviews, reviews % 4, reviews % 3 === 0 ? 1 : 0];
  }
  for (let offset = 12; offset >= 1; offset -= 1) days[today - offset] = [12 + offset, 2, 0];
  delete days[today - 4];
  const lexicon = {};
  WORDS.slice(0, 12).forEach(([id, , pos, , level]) => {
    lexicon[`lodVault.lx.${id}`] = { v: 1, id, pos, cats: [level] };
  });
  return {
    local: {
      "lodVault.entries": entries,
      "lodVault.settings": { autoMode: true, syncLanguages: ["en", "fr", "de"] },
      "lodVault.flashcardMeta": meta,
      "lodVault.flashcardSettings": { dailyTarget: 10 },
      "lodVault.activity": { v: 1, d: days, s: today - 60 },
      ...lexicon
    },
    sync: {}
  };
}

export const flows = {
  "tags-decks": {
    page: "pages/preview.html",
    width: 1000, height: 720,
    seed: () => studySeed(),
    gif: "tags-decks.gif",
    async run(page) {
      await page.sleep(1000);
      await page.shot("tags-before.png");
      await page.eval(`(() => { const d = document.querySelector('iframe').contentDocument; d.querySelector('.lv-tag-add').click(); const i = d.querySelector('.lv-tag-input'); i.value = 'family'; i.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); })()`);
      await page.sleep(1000);
      await page.shot("tags-dark.png");
      await page.click("#open-decks", 1000);
      await page.shot("decks-dialog.png");
    }
  },
  "tags-light-narrow": {
    page: "pages/preview.html", width: 400, height: 850,
    seed: () => studySeed(),
    async run(page) {
      await page.sleep(1000);
      await page.click(".theme-btn", 1000);
      await page.shot("tags-light-narrow.png");
      await page.click("#open-decks", 1000);
      await page.shot("decks-light-narrow.png");
    }
  },
  // PR 1: the streak counts today once the 10th review is in.
  "activity-flashcards": {
    page: "pages/flashcards.html?deck=today",
    width: 1000,
    height: 640,
    seed: () => studySeed(),
    gif: "activity-streak.gif",
    async run(page) {
      await page.shot("activity-flashcards-before.png", ".statline");
      await page.sleep(900);
      await page.key(" ", 900);
      await page.key("2", 1600);
      await page.shot("activity-flashcards-after.png", ".statline");
      await page.sleep(600);
    }
  },
  "activity-popup": {
    page: "pages/popup.html",
    width: 420,
    height: 600,
    seed: () => studySeed({ reviewsToday: 10 }),
    async run(page) {
      await page.sleep(500);
      await page.shot("activity-popup-today.png", "#study-card");
    }
  },
  // PR 2: the Progress page in both themes.
  "stats-tour": {
    page: "pages/stats.html",
    width: 1100,
    height: 720,
    seed: () => studySeed(),
    gif: "stats-tour.gif",
    async run(page) {
      await page.shot("stats-dark.png");
      await page.shot("stats-heatmap-freeze.png", ".stats-card");
      await page.sleep(1200);
      await page.scrollTo("#forecast-heading", 1400);
      await page.scrollTo("#breakdown-heading", 1400);
      await page.scrollTo("#streak-heading", 900);
      await page.click("#rest-day-6", 1400);
      await page.scrollTo("#heatmap-heading", 1500);
      await page.click(".theme-btn", 1300);
      await page.shot("stats-light.png");
      await page.scrollTo("#forecast-heading", 1300);
      await page.scrollTo("#summary-heading", 900);
    }
  },
  "stats-narrow": {
    page: "pages/stats.html",
    width: 400,
    height: 900,
    seed: () => studySeed(),
    async run(page) {
      await page.shot("stats-narrow.png");
    }
  },
  "stats-light-full": {
    page: "pages/stats.html",
    width: 1100,
    height: 1500,
    seed: () => studySeed(),
    stubOptions: { theme: "light" },
    async run(page) {
      await page.shot("stats-light-full.png");
    }
  },
  // PR 3: turning the reminder on, first refusing then allowing the prompt.
  // Headless Chromium can't show the browser's own permission prompt, so the
  // stub answers it after a pause while the page shows its waiting state.
  "reminders-opt-in": {
    page: "pages/stats.html",
    width: 1000,
    height: 560,
    seed: () => studySeed(),
    stubOptions: { permission: "deny", permissionDelayMs: 1600 },
    gif: "reminders-opt-in.gif",
    async run(page) {
      await page.eval(`window.scrollTo(0, document.body.scrollHeight)`);
      await page.sleep(900);
      await page.shot("reminders-off.png", "#reminder-settings");
      await page.click("#reminder-enabled", 500);
      await page.shot("reminders-waiting.png", "#reminder-settings");
      await page.sleep(1600);
      await page.shot("reminders-denied.png", "#reminder-settings");
      await page.sleep(800);
      await page.eval(`window.__recorder.options = { permission: "allow", permissionDelayMs: 1600 }`);
      await page.click("#reminder-enabled", 2200);
      await page.eval(`(() => { const t = document.getElementById("reminder-time"); t.value = "08:30"; t.dispatchEvent(new Event("change", { bubbles: true })); window.__markClick(t); })()`);
      await page.sleep(1200);
      await page.click("#badge-includes-new", 1200);
      await page.shot("reminders-on.png", "#reminder-settings");
      await page.sleep(600);
    }
  },
  "reminders-light": {
    page: "pages/stats.html",
    width: 1000,
    height: 560,
    seed: () => ({ ...studySeed(), local: { ...studySeed().local, "lodVault.reminders": { enabled: true, time: "19:30", badgeIncludesNew: true } } }),
    stubOptions: { theme: "light" },
    async run(page) {
      await page.eval(`window.scrollTo(0, document.body.scrollHeight)`);
      await page.sleep(600);
      await page.shot("reminders-on-light.png", "#reminder-settings");
    }
  }
};
