// Daily study activity: how many reviews and new words each local calendar day
// had, kept locally for a year and synced for the last 60 days under its own key
// ("lodVault.a"). The streak is computed from these day totals, so every device
// that syncs shows the same streak, even though only the latest review per word
// travels with progress.
//
// Record shape (local "lodVault.activity" and sync "lodVault.a"):
//   { v: 1,
//     d: { [dayNumber]: [reviews, newWords, flags] },  // flags: 1 = queue cleared
//     b: [day, streak, freezes, towardsFreeze],         // streak state at the end of `day`
//     w: [restDayMask, updatedAtMs],                     // optional rest days (bit 0 = Sunday)
//     s: day }                                           // first day the stricter rule applied
// Days before `s` were filled in from older review logs, which never recorded
// whether the queue was cleared, so any review on them keeps the streak the way
// it did before this module existed.
// A day number is the learner's local date counted in days since 1970-01-01.
(() => {
  const ACTIVITY_KEY = "lodVault.activity";
  const SYNC_ACTIVITY_KEY = "lodVault.a";
  const LOCAL_DAYS = 400;
  const SYNC_DAYS = 60;
  const STREAK_MIN_REVIEWS = 10;
  const FREEZE_EVERY_DAYS = 7;
  const MAX_FREEZES = 2;
  const FLAG_CLEARED = 1;
  const DAY_MS = 86400000;

  function store() {
    return globalThis.LodVaultStore || globalThis.LodVaultStoreCore || {};
  }

  function toDayNumber(value = new Date()) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split("-").map(Number);
      return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
    }
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
  }

  // Local midnight of a day number, as a Date.
  function dayToDate(day) {
    const utc = new Date(day * DAY_MS);
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  }

  function dayToKey(day) {
    return new Date(day * DAY_MS).toISOString().slice(0, 10);
  }

  // 0 = Sunday … 6 = Saturday. Day 0 (1970-01-01) was a Thursday.
  function weekdayOf(day) {
    return ((day + 4) % 7 + 7) % 7;
  }

  function toCount(value) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? Math.min(number, 1e6) : 0;
  }

  function normalizeDay(value) {
    if (!Array.isArray(value)) return null;
    const result = [toCount(value[0]), toCount(value[1]), toCount(value[2]) & FLAG_CLEARED];
    return result[0] || result[1] || result[2] ? result : null;
  }

  function normalizeAnchor(value) {
    if (!Array.isArray(value)) return null;
    const day = Math.floor(Number(value[0]));
    if (!Number.isFinite(day) || day <= 0) return null;
    return [
      day,
      toCount(value[1]),
      Math.min(MAX_FREEZES, toCount(value[2])),
      Math.min(FREEZE_EVERY_DAYS - 1, toCount(value[3]))
    ];
  }

  function normalizeRestDays(value) {
    if (!Array.isArray(value)) return null;
    const mask = toCount(value[0]) & 0x7f;
    const at = Number(value[1]);
    return [mask, Number.isFinite(at) && at > 0 ? at : 0];
  }

  function normalizeActivity(raw) {
    const result = { v: 1, d: {} };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
    const days = raw.d && typeof raw.d === "object" && !Array.isArray(raw.d) ? raw.d : {};
    for (const [key, value] of Object.entries(days)) {
      const day = Number(key);
      if (!Number.isInteger(day) || day <= 0) continue;
      const normalized = normalizeDay(value);
      if (normalized) result.d[day] = normalized;
    }
    const anchor = normalizeAnchor(raw.b);
    if (anchor) result.b = anchor;
    const rest = normalizeRestDays(raw.w);
    if (rest) result.w = rest;
    const since = Math.floor(Number(raw.s));
    if (Number.isFinite(since) && since > 0) result.s = since;
    return result;
  }

  function pickAnchor(left, right) {
    if (!left) return right || null;
    if (!right) return left;
    if (left[0] !== right[0]) return left[0] < right[0] ? left : right;
    return right[1] > left[1] ? right : left;
  }

  // Day totals only grow: a merge keeps the larger count for each day, so two
  // devices converge whatever order they sync in. Reviews from another device
  // reach this one's review log with progress, so the larger count is usually
  // the full one.
  function mergeActivity(localRaw, remoteRaw) {
    const local = normalizeActivity(localRaw);
    const remote = normalizeActivity(remoteRaw);
    const merged = { v: 1, d: { ...local.d } };
    for (const [day, value] of Object.entries(remote.d)) {
      const current = merged.d[day];
      merged.d[day] = current
        ? [Math.max(current[0], value[0]), Math.max(current[1], value[1]), current[2] | value[2]]
        : value;
    }
    const anchor = pickAnchor(local.b || null, remote.b || null);
    if (anchor) merged.b = anchor;
    const rest = !local.w ? remote.w : !remote.w ? local.w : (remote.w[1] > local.w[1] ? remote.w : local.w);
    if (rest) merged.w = rest;
    const since = [local.s, remote.s].filter(Boolean);
    if (since.length) merged.s = Math.min(...since);
    return merged;
  }

  function isSameActivity(left, right) {
    return JSON.stringify(normalizeActivity(left)) === JSON.stringify(normalizeActivity(right));
  }

  // Day totals from the review logs on this device. A word counts as new on the
  // day of its first review, as long as the log still holds that review.
  function computeDailyFromMeta(meta = {}, { sinceDay = -Infinity } = {}) {
    const days = {};
    for (const card of Object.values(meta || {})) {
      const reviews = Array.isArray(card?.reviews) ? card.reviews : [];
      let firstDay = null;
      for (const review of reviews) {
        const time = Date.parse(review?.date || "");
        if (!Number.isFinite(time)) continue;
        const day = toDayNumber(new Date(time));
        if (firstDay === null || day < firstDay) firstDay = day;
        if (day < sinceDay) continue;
        days[day] = days[day] || [0, 0, 0];
        days[day][0] += 1;
      }
      const total = Number(card?.totalReviews) || 0;
      if (firstDay !== null && firstDay >= sinceDay && reviews.length >= total) {
        days[firstDay] = days[firstDay] || [0, 0, 0];
        days[firstDay][1] += 1;
      }
    }
    return days;
  }

  function dayQualifies(value, day = Infinity, strictFrom = -Infinity) {
    if (!value) return false;
    if (day < strictFrom) return value[0] > 0 || value[1] > 0;
    return value[0] >= STREAK_MIN_REVIEWS || Boolean(value[2] & FLAG_CLEARED && (value[0] || value[1]));
  }

  function isRestDay(day, mask) {
    return Boolean(mask & (1 << weekdayOf(day)));
  }

  // Walks day by day from `start` to `today`. Rules:
  // - a day counts when it had at least 10 reviews or the Today queue was cleared;
  // - today stays open until it ends, so an unfinished today never breaks a streak;
  // - a chosen rest day neither counts nor breaks;
  // - every 7 counted days earn a freeze (at most 2 banked), and a missed day
  //   spends one automatically instead of ending the streak.
  function walk(days, { startDay, state, today, restMask, statuses, strictFrom }) {
    let { streak, freezes, towards } = state;
    let best = streak;
    for (let day = startDay; day <= today; day += 1) {
      const value = days[day];
      if (dayQualifies(value, day, strictFrom)) {
        streak += 1;
        towards += 1;
        if (towards >= FREEZE_EVERY_DAYS) {
          towards = 0;
          freezes = Math.min(MAX_FREEZES, freezes + 1);
        }
        if (statuses) statuses[day] = "done";
      } else if (day === today) {
        if (statuses && value) statuses[day] = "partial";
      } else if (isRestDay(day, restMask)) {
        if (statuses) statuses[day] = "rest";
      } else if (streak > 0 && freezes > 0) {
        freezes -= 1;
        if (statuses) statuses[day] = "frozen";
      } else {
        streak = 0;
        towards = 0;
        if (statuses && value) statuses[day] = "partial";
      }
      best = Math.max(best, streak);
    }
    return { streak, freezes, towards, best };
  }

  function computeStreak(raw, { now = new Date(), withStatuses = false } = {}) {
    const record = normalizeActivity(raw);
    const today = toDayNumber(now);
    const restMask = record.w ? record.w[0] : 0;
    const strictFrom = record.s || today;
    const dayNumbers = Object.keys(record.d).map(Number).filter((day) => day <= today);
    const firstDay = dayNumbers.length ? Math.min(...dayNumbers) : today;

    // Two starting points: the stored anchor (which remembers streaks older
    // than the kept days), and the oldest kept day. The longer streak wins, so
    // a device that knows less can't shorten what another device knows.
    const candidates = [];
    const fromScratch = { startDay: firstDay, state: { streak: 0, freezes: 0, towards: 0 } };
    candidates.push(fromScratch);
    if (record.b && record.b[0] < today) {
      candidates.push({
        startDay: record.b[0] + 1,
        state: { streak: record.b[1], freezes: record.b[2], towards: record.b[3] }
      });
    }

    let bestResult = null;
    let bestStatuses = null;
    for (const candidate of candidates) {
      const statuses = withStatuses ? {} : null;
      const result = walk(record.d, { ...candidate, today, restMask, statuses, strictFrom });
      if (!bestResult || result.streak > bestResult.streak) {
        bestResult = result;
        bestStatuses = statuses;
      }
    }

    return {
      streak: bestResult.streak,
      best: Math.max(bestResult.best, record.b ? record.b[1] : 0),
      freezes: bestResult.freezes,
      towardsFreeze: bestResult.towards,
      todayDone: dayQualifies(record.d[today], today, strictFrom),
      today: record.d[today] ? [...record.d[today]] : [0, 0, 0],
      restMask,
      ...(withStatuses ? { statuses: bestStatuses } : {})
    };
  }

  // Streak state at the end of `day`, used to keep long streaks once their
  // oldest days are dropped.
  function anchorAt(record, day) {
    const shifted = { ...record, d: {} };
    for (const [key, value] of Object.entries(record.d)) {
      if (Number(key) <= day) shifted.d[key] = value;
    }
    const state = computeStreak(shifted, { now: dayToDate(day + 1) });
    // computeStreak treats `day + 1` as an open today, so the result is the
    // state carried into it.
    return [day, state.streak, state.freezes, state.towardsFreeze];
  }

  function pruneActivity(raw, { now = new Date(), keepDays = LOCAL_DAYS } = {}) {
    const record = normalizeActivity(raw);
    const cutoff = toDayNumber(now) - keepDays;
    const dropped = Object.keys(record.d).map(Number).filter((day) => day <= cutoff);
    if (!dropped.length) return record;
    const pruned = { ...record, d: {} };
    for (const [key, value] of Object.entries(record.d)) {
      if (Number(key) > cutoff) pruned.d[key] = value;
    }
    // An anchor newer than the cutoff already accounts for the dropped days.
    pruned.b = record.b && record.b[0] > cutoff ? record.b : anchorAt(record, cutoff);
    return pruned;
  }

  // What travels in sync: the last 60 days plus the streak state just before
  // them, about 1 KB.
  function buildSyncValue(raw, { now = new Date() } = {}) {
    const record = normalizeActivity(raw);
    if (!Object.keys(record.d).length && !record.b && !record.w && !record.s) return null;
    return pruneActivity(record, { now, keepDays: SYNC_DAYS });
  }

  async function readLocal() {
    const data = await chrome.storage.local.get([ACTIVITY_KEY]);
    return normalizeActivity(data[ACTIVITY_KEY]);
  }

  let writeQueue = Promise.resolve();
  function enqueue(task) {
    const result = writeQueue.then(task, task);
    writeQueue = result.catch(() => {});
    return result;
  }

  async function writeIfChanged(previous, next) {
    if (isSameActivity(previous, next)) return { changed: false, activity: previous };
    await chrome.storage.local.set({ [ACTIVITY_KEY]: next });
    return { changed: true, activity: next };
  }

  function isQueueCleared(entries, meta, settings, now) {
    const buildTodayQueue = store().buildTodayQueue;
    if (typeof buildTodayQueue !== "function") return false;
    const dailyTarget = store().normalizeFlashcardDailyTarget?.(settings) ?? 10;
    const today = buildTodayQueue(entries, meta, {
      now,
      dailyTarget,
      newPerDay: settings?.newPerDay
    });
    const learning = Array.isArray(today.learning) ? today.learning.length : 0;
    return !today.dueCount && !today.newCount && !learning;
  }

  // Folds this device's review logs into the day totals. Called by the
  // background worker whenever review progress changes, and on startup.
  async function recordFromLocal({ now = new Date() } = {}) {
    return enqueue(async () => {
      const s = store();
      const metaKey = s.FLASHCARD_META_KEY || "lodVault.flashcardMeta";
      const settingsKey = s.FLASHCARD_SETTINGS_KEY || "lodVault.flashcardSettings";
      const [previous, data] = await Promise.all([
        readLocal(),
        chrome.storage.local.get([metaKey, settingsKey])
      ]);
      const meta = s.normalizeFlashcardMetaMap
        ? s.normalizeFlashcardMetaMap(data[metaKey])
        : (data[metaKey] || {});
      const today = toDayNumber(now);
      const derived = computeDailyFromMeta(meta, { sinceDay: today - SYNC_DAYS });
      // Nothing studied yet: no record, and no sync write for it.
      if (!Object.keys(derived).length && !Object.keys(previous.d).length) {
        return { changed: false, activity: previous };
      }

      if (derived[today]?.[0] && typeof s.getEntries === "function") {
        try {
          const entries = await s.getEntries();
          if (isQueueCleared(entries, meta, data[settingsKey], now)) derived[today][2] |= FLAG_CLEARED;
        } catch {
          // Without entries the 10-review rule still applies.
        }
      }

      const next = pruneActivity(mergeActivity(previous, { d: derived, s: previous.s || today }), { now });
      return writeIfChanged(previous, next);
    });
  }

  async function applyRemote(remoteRaw, { now = new Date() } = {}) {
    if (!remoteRaw) return { changed: false };
    return enqueue(async () => {
      const previous = await readLocal();
      const next = pruneActivity(mergeActivity(previous, remoteRaw), { now });
      return writeIfChanged(previous, next);
    });
  }

  async function setRestDays(mask) {
    return enqueue(async () => {
      const previous = await readLocal();
      const next = { ...previous, w: [toCount(mask) & 0x7f, Date.now()] };
      return writeIfChanged(previous, next);
    });
  }

  // For display: the stored totals plus whatever this device's log adds that
  // the background worker hasn't folded in yet.
  async function getStreakInfo({ meta = null, now = new Date(), withStatuses = false } = {}) {
    const record = await readLocal();
    const merged = meta
      ? mergeActivity(record, { d: computeDailyFromMeta(meta, { sinceDay: toDayNumber(now) - SYNC_DAYS }) })
      : record;
    return computeStreak(merged, { now, withStatuses });
  }

  function watch(callback) {
    const metaKey = store().FLASHCARD_META_KEY || "lodVault.flashcardMeta";
    const listener = (changes, areaName) => {
      if (areaName !== "local") return;
      if (changes?.[ACTIVITY_KEY] || changes?.[metaKey]) callback();
    };
    chrome.storage?.onChanged?.addListener?.(listener);
    return () => chrome.storage?.onChanged?.removeListener?.(listener);
  }

  // Keeps an element showing the synced streak, for pages that already show one.
  function watchStreak(onStreak) {
    let token = 0;
    const refresh = async () => {
      const current = ++token;
      try {
        const metaKey = store().FLASHCARD_META_KEY || "lodVault.flashcardMeta";
        const data = await chrome.storage.local.get([metaKey]);
        const meta = store().normalizeFlashcardMetaMap?.(data[metaKey]) || data[metaKey] || {};
        const info = await getStreakInfo({ meta });
        if (current === token) onStreak(info);
      } catch {
        // Keep whatever the page showed before.
      }
    };
    void refresh();
    return watch(refresh);
  }

  function exportBackupSection() {
    return readLocal();
  }

  async function importBackupSection(value) {
    return applyRemote(value);
  }

  store().registerBackupSection?.("activity", {
    exportData: exportBackupSection,
    importData: importBackupSection
  });

  globalThis.LodVaultActivity = {
    ACTIVITY_KEY,
    SYNC_ACTIVITY_KEY,
    LOCAL_DAYS,
    SYNC_DAYS,
    STREAK_MIN_REVIEWS,
    FREEZE_EVERY_DAYS,
    MAX_FREEZES,
    FLAG_CLEARED,
    toDayNumber,
    dayToDate,
    dayToKey,
    weekdayOf,
    normalizeActivity,
    mergeActivity,
    isSameActivity,
    computeDailyFromMeta,
    computeStreak,
    pruneActivity,
    buildSyncValue,
    readLocal,
    recordFromLocal,
    applyRemote,
    setRestDays,
    getStreakInfo,
    watch,
    watchStreak
  };
})();
