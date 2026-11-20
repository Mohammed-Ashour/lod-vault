// Stats page: activity heatmap, 30-day forecast, retention, words you know and
// breakdowns by part of speech and level. Everything is computed locally from
// the vault, the review log, the synced day totals (activity.js) and, when
// present, the downloaded LOD word details (lodVault.lx.<ID>).
//
// FSRS fields (srs, s) and the lexicon come from later work. Until a card has
// them, memory is estimated from its review interval and labelled as such.
(() => {
  const DAY_MS = 86400000;
  const FSRS_FACTOR = 19 / 81;
  const FSRS_DECAY = -0.5;
  const KNOWN_THRESHOLD = 0.9;
  const MATURE_GAP_DAYS = 21;
  const RETENTION_WINDOW_DAYS = 30;
  const FORECAST_DAYS = 30;
  const HEATMAP_DAYS = 365;
  const LEXICON_PREFIX = "lodVault.lx.";
  const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

  function activity() {
    return globalThis.LodVaultActivity;
  }

  function toDay(value) {
    return activity().toDayNumber(value);
  }

  function reviewGrade(review) {
    const grade = Number(review?.grade);
    if ([1, 2, 3, 4].includes(grade)) return grade;
    // Legacy 1..3 scale: 1 was Hard, which already acted as Again.
    const rating = Number(review?.rating);
    return rating === 1 ? 1 : rating === 3 ? 4 : 3;
  }

  function hasFsrs(card) {
    return Number(card?.srs) >= 1 && Number(card?.s) > 0;
  }

  // Probability of recall now. FSRS cards use their stability; older cards
  // use the scheduled interval as a stand-in, so it's only an estimate.
  function retrievability(card, now = new Date()) {
    if (!card?.totalReviews) return null;
    const srs = globalThis.LodVaultSrs;
    if (hasFsrs(card) && typeof srs?.retrievability === "function") {
      const value = Number(srs.retrievability(card, now));
      if (Number.isFinite(value)) return value;
    }
    const last = Date.parse(card.lastReviewedAt || "");
    if (!Number.isFinite(last)) return null;
    const stability = hasFsrs(card) ? Number(card.s) : Math.max(1, Number(card.interval) || 0);
    const elapsed = Math.max(0, (now.getTime() - last) / DAY_MS);
    return Math.pow(1 + FSRS_FACTOR * elapsed / stability, FSRS_DECAY);
  }

  function isSuspended(card) {
    return Boolean(card?.suspended);
  }

  function computeKnown(entries = [], meta = {}, now = new Date()) {
    let known = 0;
    let studied = 0;
    let estimated = 0;
    for (const entry of entries) {
      const card = meta[entry.id];
      if (!card?.totalReviews) continue;
      studied += 1;
      if (!hasFsrs(card)) estimated += 1;
      const value = retrievability(card, now);
      if (value !== null && value >= KNOWN_THRESHOLD) known += 1;
    }
    return { known, studied, estimated, exact: studied > 0 && estimated === 0 };
  }

  // Due cards per day for the next 30 days. Overdue cards count today.
  function computeForecast(entries = [], meta = {}, now = new Date(), days = FORECAST_DAYS) {
    const today = toDay(now);
    const counts = Array.from({ length: days }, () => 0);
    for (const entry of entries) {
      const card = meta[entry.id];
      if (!card?.totalReviews || isSuspended(card)) continue;
      const due = Date.parse(card.dueAt || "");
      const offset = Number.isFinite(due) ? Math.max(0, toDay(new Date(due)) - today) : 0;
      if (offset < days) counts[offset] += 1;
    }
    return counts.map((count, offset) => ({ day: today + offset, count }));
  }

  // Recall on reviews of the last 30 days that came at least 21 days after the
  // previous review of the same word. This is a long-gap recall proxy, not
  // retention selected by pre-review stability. Practice
  // reviews (kind "p") don't count. Again is a fail; anything else a pass.
  function computeRetention(meta = {}, now = new Date()) {
    const since = now.getTime() - RETENTION_WINDOW_DAYS * DAY_MS;
    const result = { mature: 0, maturePassed: 0, all: 0, allPassed: 0 };
    for (const card of Object.values(meta || {})) {
      const reviews = (Array.isArray(card?.reviews) ? card.reviews : [])
        .map((review) => ({ review, time: Date.parse(review?.date || "") }))
        .filter((item) => Number.isFinite(item.time))
        .sort((left, right) => left.time - right.time);
      for (let index = 0; index < reviews.length; index += 1) {
        const { review, time } = reviews[index];
        if (time < since || review.kind === "p") continue;
        const passed = reviewGrade(review) > 1;
        result.all += 1;
        if (passed) result.allPassed += 1;
        const previous = reviews[index - 1];
        if (previous && (time - previous.time) / DAY_MS >= MATURE_GAP_DAYS) {
          result.mature += 1;
          if (passed) result.maturePassed += 1;
        }
      }
    }
    return {
      ...result,
      matureRate: result.mature ? result.maturePassed / result.mature : null,
      allRate: result.all ? result.allPassed / result.all : null
    };
  }

  function computeAverageTime(meta = {}, now = new Date()) {
    const since = now.getTime() - RETENTION_WINDOW_DAYS * DAY_MS;
    let total = 0;
    let count = 0;
    for (const card of Object.values(meta || {})) {
      for (const review of Array.isArray(card?.reviews) ? card.reviews : []) {
        const ms = Number(review?.ms);
        const time = Date.parse(review?.date || "");
        if (!Number.isFinite(ms) || ms <= 0 || ms > 10 * 60000 || !(time >= since)) continue;
        total += ms;
        count += 1;
      }
    }
    return count ? { seconds: total / count / 1000, count } : null;
  }

  function posGroup(value) {
    const text = String(value || "").trim().toUpperCase();
    if (!text) return "Other";
    if (text.startsWith("SUBST") || text.startsWith("NOUN") || text.startsWith("SUBSTANTIV")) return "Nouns";
    if (text.startsWith("VRB") || text.startsWith("VERB")) return "Verbs";
    if (text.startsWith("ADJ")) return "Adjectives";
    if (text.startsWith("ADV")) return "Adverbs";
    return "Other";
  }

  function levelOf(lexicon) {
    const cats = Array.isArray(lexicon?.cats) ? lexicon.cats : [];
    let best = null;
    for (const cat of cats) {
      const code = typeof cat === "string" ? cat : cat?.code;
      const match = /^GWS\s+(A1|A2|B1|B2|C1|C2)\b/i.exec(String(code || ""));
      if (!match) continue;
      const level = match[1].toUpperCase();
      if (best === null || LEVELS.indexOf(level) < LEVELS.indexOf(best)) best = level;
    }
    return best;
  }

  function computeBreakdown(entries = [], meta = {}, lexicon = {}, now = new Date()) {
    const byPos = {};
    const byLevel = {};
    let withLexicon = 0;
    const bump = (map, key, status) => {
      map[key] = map[key] || { total: 0, known: 0, learning: 0, fresh: 0 };
      map[key].total += 1;
      map[key][status] += 1;
    };
    for (const entry of entries) {
      const card = meta[entry.id];
      const lx = lexicon[entry.id] || null;
      if (lx) withLexicon += 1;
      let status = "fresh";
      if (card?.totalReviews) {
        const value = retrievability(card, now);
        status = value !== null && value >= KNOWN_THRESHOLD ? "known" : "learning";
      }
      bump(byPos, posGroup(lx?.pos || entry.pos), status);
      if (lx) bump(byLevel, levelOf(lx) || "No level", status);
    }
    return { byPos, byLevel, withLexicon, total: entries.length };
  }

  function computeHeatmap(activityRecord, now = new Date(), days = HEATMAP_DAYS) {
    const act = activity();
    const record = act.normalizeActivity(activityRecord);
    const info = act.computeStreak(record, { now, withStatuses: true });
    const today = toDay(now);
    const cells = [];
    for (let day = today - days + 1; day <= today; day += 1) {
      const value = record.d[day] || [0, 0, 0];
      cells.push({
        day,
        key: act.dayToKey(day),
        reviews: value[0],
        fresh: value[1],
        status: info.statuses?.[day] || (value[0] ? "partial" : "none"),
        level: value[0] === 0 ? 0 : value[0] < 10 ? 1 : value[0] < 25 ? 2 : value[0] < 50 ? 3 : 4
      });
    }
    const activeDays = cells.filter((cell) => cell.reviews > 0).length;
    const totalReviews = cells.reduce((sum, cell) => sum + cell.reviews, 0);
    return { cells, info, activeDays, totalReviews };
  }

  async function readLexicon(ids = []) {
    if (!ids.length) return {};
    const keys = ids.map((id) => `${LEXICON_PREFIX}${id}`);
    const data = await chrome.storage.local.get(keys);
    const result = {};
    for (const id of ids) {
      const value = data[`${LEXICON_PREFIX}${id}`];
      if (value && typeof value === "object" && !Array.isArray(value)) result[id] = value;
    }
    return result;
  }

  async function loadData() {
    const store = globalThis.LodVaultStore;
    const settingsKey = store.FLASHCARD_SETTINGS_KEY || "lodVault.flashcardSettings";
    const [entries, meta, activityRecord, settingsData] = await Promise.all([
      store.getEntries(),
      store.getFlashcardMeta(),
      activity().readLocal(),
      chrome.storage.local.get([settingsKey])
    ]);
    const merged = activity().mergeActivity(activityRecord, {
      d: activity().computeDailyFromMeta(meta, { sinceDay: toDay(new Date()) - activity().SYNC_DAYS })
    });
    const lexicon = await readLexicon(entries.map((entry) => entry.id));
    const target = Number(settingsData[settingsKey]?.desiredRetention);
    return {
      entries,
      meta,
      activity: merged,
      lexicon,
      targetRetention: target > 0 && target < 1 ? target : 0.9
    };
  }

  // ── Rendering ───────────────────────────────────────────────
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "text") node.textContent = value;
      else if (key === "className") node.className = value;
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of [].concat(children)) {
      if (child) node.append(child);
    }
    return node;
  }

  function percent(value) {
    return value === null ? "—" : `${Math.round(value * 100)}%`;
  }

  function formatDate(day) {
    return activity().dayToDate(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  function renderSummary(root, data, now) {
    const { info } = data.heatmap;
    const known = data.known;
    const retention = data.retention;
    const avg = data.averageTime;
    const tiles = [
      { value: info.streak, label: "day streak", detail: info.todayDone ? "Today counts" : "Today still open" },
      { value: info.best, label: "best streak" },
      { value: `${"❄".repeat(info.freezes) || "0"}`, label: "streak freezes", detail: `${info.towardsFreeze}/7 days to the next` },
      {
        value: known.known,
        label: "words you know",
        detail: known.studied
          ? known.exact
            ? `of ${known.studied} studied · recall ≥ 90% now`
            : `of ${known.studied} studied · estimated from review intervals`
          : "Study a few words first"
      },
      {
        value: percent(retention.matureRate),
        label: "long-gap recall proxy",
        detail: retention.mature
          ? `${retention.maturePassed}/${retention.mature} reviews after 21+ day gaps · target ${percent(data.targetRetention)}`
          : retention.all
            ? `All reviews: ${percent(retention.allRate)} · no 21+ day gaps yet`
            : "No reviews in the last 30 days"
      },
      {
        value: avg ? `${avg.seconds.toFixed(1)}s` : "—",
        label: "per card",
        detail: avg ? `average of ${avg.count} reviews, last 30 days` : "Not recorded by this version yet"
      }
    ];
    root.replaceChildren(...tiles.map((tile) => el("div", { className: "stat-tile" }, [
      el("b", { text: String(tile.value) }),
      el("span", { className: "stat-label", text: tile.label }),
      tile.detail ? el("span", { className: "stat-detail", text: tile.detail }) : null
    ])));
    root.dataset.generated = String(now.getTime());
  }

  function renderHeatmap(root, heatmap) {
    const { cells } = heatmap;
    // Pad the first column so each column is one week, Sunday on top.
    const leading = activity().weekdayOf(cells[0].day);
    const grid = el("div", {
      className: "heatmap-grid",
      role: "img",
      "aria-label": `Study activity over the last year: ${heatmap.activeDays} active days, ${heatmap.totalReviews} reviews. Current streak ${heatmap.info.streak} days.`
    });
    for (let index = 0; index < leading; index += 1) grid.append(el("span", { className: "heat-cell is-pad", "aria-hidden": "true" }));
    for (const cell of cells) {
      const parts = [`${cell.key}: ${cell.reviews} review${cell.reviews === 1 ? "" : "s"}`];
      if (cell.fresh) parts.push(`${cell.fresh} new`);
      if (cell.status === "frozen") parts.push("streak freeze used");
      if (cell.status === "rest") parts.push("rest day");
      grid.append(el("span", {
        className: `heat-cell level-${cell.level} is-${cell.status}`,
        title: parts.join(" · "),
        "data-day": cell.key
      }, cell.status === "frozen" ? [document.createTextNode("❄")] : []));
    }
    const legend = el("div", { className: "heat-legend" }, [
      el("span", { text: "Less" }),
      ...[0, 1, 2, 3, 4].map((level) => el("span", { className: `heat-cell level-${level}`, "aria-hidden": "true" })),
      el("span", { text: "More" }),
      el("span", { className: "heat-cell is-frozen level-0", "aria-hidden": "true" }, [document.createTextNode("❄")]),
      el("span", { text: "Freeze" }),
      el("span", { className: "heat-cell is-rest level-0", "aria-hidden": "true" }),
      el("span", { text: "Rest day" })
    ]);
    root.replaceChildren(el("div", { className: "heatmap-scroll" }, grid), legend);
  }

  function renderForecast(root, forecast) {
    const max = Math.max(1, ...forecast.map((item) => item.count));
    const total = forecast.reduce((sum, item) => sum + item.count, 0);
    const list = el("ol", {
      className: "forecast-bars",
      "aria-label": `Reviews due over the next 30 days: ${total} in total.`
    });
    forecast.forEach((item, index) => {
      const label = index === 0 ? "Today" : index === 1 ? "Tomorrow" : formatDate(item.day);
      const bar = el("span", { className: "forecast-bar", "aria-hidden": "true" });
      bar.style.height = `${Math.round((item.count / max) * 100)}%`;
      list.append(el("li", { className: "forecast-day", title: `${label}: ${item.count} due` }, [
        el("span", { className: "forecast-count", text: item.count ? String(item.count) : "" }),
        bar,
        el("span", { className: "sr-only", text: `${label}: ${item.count} due` })
      ]));
    });
    const week = forecast.slice(0, 7).reduce((sum, item) => sum + item.count, 0);
    root.replaceChildren(
      el("p", { className: "section-note", text: `${forecast[0].count} due today · ${week} this week · ${total} in 30 days` }),
      list
    );
  }

  function renderBreakdownTable(caption, map, order) {
    const keys = Object.keys(map).sort((left, right) => {
      const a = order.indexOf(left);
      const b = order.indexOf(right);
      return (a === -1 ? 99 : a) - (b === -1 ? 99 : b) || left.localeCompare(right);
    });
    const table = el("table", { className: "breakdown" }, [
      el("caption", { text: caption }),
      el("thead", {}, el("tr", {}, ["", "Words", "Know", "Learning", "New"].map((text) => el("th", { scope: "col", text })))),
      el("tbody", {}, keys.map((key) => el("tr", {}, [
        el("th", { scope: "row", text: key }),
        el("td", { text: String(map[key].total) }),
        el("td", { text: String(map[key].known) }),
        el("td", { text: String(map[key].learning) }),
        el("td", { text: String(map[key].fresh) })
      ])))
    ]);
    return table;
  }

  function renderBreakdown(root, breakdown) {
    const children = [];
    if (!breakdown.total) {
      root.replaceChildren(el("p", { className: "section-note", text: "Save some words to see them by type and level." }));
      return;
    }
    children.push(renderBreakdownTable("By part of speech", breakdown.byPos, ["Nouns", "Verbs", "Adjectives", "Adverbs", "Other"]));
    if (breakdown.withLexicon) {
      children.push(renderBreakdownTable("By level (Schwätzt Dir Lëtzebuergesch?)", breakdown.byLevel, [...LEVELS, "No level"]));
      if (breakdown.withLexicon < breakdown.total) {
        children.push(el("p", { className: "section-note", text: `Levels known for ${breakdown.withLexicon} of ${breakdown.total} words. The rest appear once their LOD details are downloaded.` }));
      }
    } else {
      children.push(el("p", { className: "section-note", text: "Levels appear once LOD word details are downloaded for your words." }));
    }
    root.replaceChildren(...children);
  }

  function renderRestDays(root, mask) {
    const order = [1, 2, 3, 4, 5, 6, 0];
    const fieldset = el("fieldset", { className: "rest-days" }, [
      el("legend", { text: "Rest days" }),
      el("p", { className: "section-note", text: "A rest day doesn't count towards your streak and doesn't break it. Changes apply from today." })
    ]);
    const row = el("div", { className: "rest-day-row" });
    for (const weekday of order) {
      const id = `rest-day-${weekday}`;
      const input = el("input", { type: "checkbox", id, value: String(weekday), checked: Boolean(mask & (1 << weekday)) });
      row.append(el("label", { className: "rest-day", for: id }, [input, document.createTextNode(WEEKDAYS[weekday])]));
    }
    fieldset.append(row);
    root.replaceChildren(fieldset);
  }

  async function onRestDayChange(event) {
    if (!event.target.matches?.("input[type=checkbox]")) return;
    let mask = 0;
    event.currentTarget.querySelectorAll("input[type=checkbox]").forEach((input) => {
      if (input.checked) mask |= 1 << Number(input.value);
    });
    await activity().setRestDays(mask);
  }

  async function render() {
    const now = new Date();
    const data = await loadData();
    const view = {
      ...data,
      heatmap: computeHeatmap(data.activity, now),
      forecast: computeForecast(data.entries, data.meta, now),
      retention: computeRetention(data.meta, now),
      known: computeKnown(data.entries, data.meta, now),
      averageTime: computeAverageTime(data.meta, now),
      breakdown: computeBreakdown(data.entries, data.meta, data.lexicon, now)
    };
    renderSummary(document.getElementById("stats-summary"), view, now);
    renderHeatmap(document.getElementById("stats-heatmap"), view.heatmap);
    renderForecast(document.getElementById("stats-forecast"), view.forecast);
    renderBreakdown(document.getElementById("stats-breakdown"), view.breakdown);
    const restRoot = document.getElementById("stats-rest-days");
    // Don't redraw the checkboxes under the learner's pointer.
    if (!restRoot.contains(document.activeElement)) renderRestDays(restRoot, view.heatmap.info.restMask);
    const status = document.getElementById("stats-status");
    if (status) status.textContent = `${data.entries.length} saved words`;
    return view;
  }

  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      render().catch((error) => console.warn("[LODVault] Could not refresh stats:", error?.message || error));
    }, 150);
  }

  let initPromise = null;
  function init() {
    if (initPromise) return initPromise;
    if (!document.getElementById("stats-summary")) return null;
    initPromise = start();
    return initPromise;
  }

  function start() {
    globalThis.LodVaultReminders?.bindSettingsForm?.(document.getElementById("reminder-settings"));
    document.getElementById("stats-rest-days")?.addEventListener("change", (event) => {
      onRestDayChange(event).catch(() => {});
    });
    document.getElementById("open-flashcards")?.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("pages/flashcards.html") });
    });
    document.getElementById("open-preview")?.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("pages/preview.html") });
    });
    chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
      if (areaName !== "local") return;
      const keys = Object.keys(changes || {});
      if (keys.some((key) => key === "lodVault.entries" || key === "lodVault.flashcardMeta"
        || key === activity().ACTIVITY_KEY || key.startsWith(LEXICON_PREFIX))) {
        scheduleRender();
      }
    });
    return render();
  }

  globalThis.LodVaultStats = {
    KNOWN_THRESHOLD,
    retrievability,
    computeKnown,
    computeForecast,
    computeRetention,
    computeAverageTime,
    computeBreakdown,
    computeHeatmap,
    posGroup,
    levelOf,
    readLexicon,
    render,
    init
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => { void init(); });
    } else {
      void init();
    }
  }
})();
