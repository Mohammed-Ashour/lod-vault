// Optional daily study reminder. Settings are per device (local storage):
//   lodVault.reminders = { enabled, time: "HH:MM", badgeIncludesNew }
// The background worker keeps one "lodvault-reminder" alarm at the next chosen
// time and re-creates it after it fires and whenever the worker starts, since
// MV3 workers come and go. A reminder only shows when something is due and
// today's study isn't done yet. The notifications permission is optional and
// only requested when the learner turns reminders on.
(() => {
  const REMINDER_SETTINGS_KEY = "lodVault.reminders";
  const REMINDER_ALARM = "lodvault-reminder";
  const NOTIFICATION_ID = "lodvault-reminder";
  const DEFAULT_TIME = "19:00";
  const DEFAULT_SETTINGS = { enabled: false, time: DEFAULT_TIME, badgeIncludesNew: false };
  // Rough pace when the review log has no timings yet.
  const SECONDS_PER_REVIEW = 10;
  const SECONDS_PER_NEW = 25;

  function store() {
    return globalThis.LodVaultStore || {};
  }

  function normalizeTime(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
    if (!match) return DEFAULT_TIME;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return DEFAULT_TIME;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  function normalizeReminderSettings(raw) {
    const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
      enabled: Boolean(value.enabled),
      time: normalizeTime(value.time),
      badgeIncludesNew: Boolean(value.badgeIncludesNew)
    };
  }

  async function getReminderSettings() {
    const data = await chrome.storage.local.get([REMINDER_SETTINGS_KEY]);
    return normalizeReminderSettings(data[REMINDER_SETTINGS_KEY]);
  }

  async function saveReminderSettings(patch = {}) {
    const next = normalizeReminderSettings({ ...(await getReminderSettings()), ...patch });
    await chrome.storage.local.set({ [REMINDER_SETTINGS_KEY]: next });
    return next;
  }

  // The next local time matching "HH:MM", strictly after `now`.
  function nextReminderTime(time, now = new Date()) {
    const [hours, minutes] = normalizeTime(time).split(":").map(Number);
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1);
      next.setHours(hours, minutes, 0, 0);
    }
    return next;
  }

  function averageSecondsPerReview(meta = {}) {
    let total = 0;
    let count = 0;
    for (const card of Object.values(meta || {})) {
      for (const review of Array.isArray(card?.reviews) ? card.reviews : []) {
        const ms = Number(review?.ms);
        if (Number.isFinite(ms) && ms > 0 && ms < 10 * 60000) {
          total += ms;
          count += 1;
        }
      }
    }
    return count >= 10 ? total / count / 1000 : null;
  }

  function estimateMinutes(dueCount, newCount, meta = {}) {
    const measured = averageSecondsPerReview(meta);
    const seconds = measured
      ? (dueCount + newCount * 2) * measured
      : dueCount * SECONDS_PER_REVIEW + newCount * SECONDS_PER_NEW;
    return Math.max(1, Math.round(seconds / 60));
  }

  function buildReminderMessage({ dueCount = 0, newCount = 0, minutes = 1 } = {}) {
    const total = dueCount + newCount;
    if (!total) return null;
    const parts = [];
    if (dueCount) parts.push(`${dueCount} due`);
    if (newCount) parts.push(`${newCount} new`);
    return {
      title: `${total} word${total === 1 ? "" : "s"} to study today`,
      message: `${parts.join(" · ")} · about ${minutes} min`
    };
  }

  async function getTodayState(now = new Date()) {
    const s = store();
    const [entries, meta, dailyTarget] = await Promise.all([
      s.getEntries(),
      s.getFlashcardMeta(),
      typeof s.getFlashcardDailyTarget === "function" ? s.getFlashcardDailyTarget() : 10
    ]);
    const today = s.buildTodayQueue(entries, meta, { now, dailyTarget });
    let studied = false;
    const activity = globalThis.LodVaultActivity;
    if (activity) {
      try {
        studied = (await activity.getStreakInfo({ meta, now })).todayDone;
      } catch {
        studied = false;
      }
    }
    return { today, meta, studied };
  }

  async function hasNotificationPermission() {
    try {
      return Boolean(await chrome.permissions?.contains?.({ permissions: ["notifications"] }));
    } catch {
      return false;
    }
  }

  // Background: keep exactly one alarm for the next reminder, or none.
  async function scheduleReminder(now = new Date()) {
    const settings = await getReminderSettings();
    await chrome.alarms?.clear?.(REMINDER_ALARM);
    if (!settings.enabled) return null;
    const when = nextReminderTime(settings.time, now).getTime();
    chrome.alarms?.create?.(REMINDER_ALARM, { when });
    return when;
  }

  // Alarms usually survive worker restarts, but not always browser restarts or
  // updates. Re-create a missing one without moving an existing one.
  async function ensureReminderScheduled(now = new Date()) {
    const settings = await getReminderSettings();
    const existing = await chrome.alarms?.get?.(REMINDER_ALARM);
    if (!settings.enabled) {
      if (existing) await chrome.alarms?.clear?.(REMINDER_ALARM);
      return null;
    }
    if (existing && existing.scheduledTime > now.getTime()) return existing.scheduledTime;
    return scheduleReminder(now);
  }

  async function showReminder(now = new Date()) {
    const settings = await getReminderSettings();
    if (!settings.enabled || !(await hasNotificationPermission()) || !chrome.notifications?.create) {
      return { shown: false, reason: "off" };
    }
    const { today, meta, studied } = await getTodayState(now);
    if (studied) return { shown: false, reason: "studied" };
    const dueCount = Number(today.dueCount) || 0;
    const newCount = Number(today.newCount) || 0;
    const content = buildReminderMessage({
      dueCount,
      newCount,
      minutes: estimateMinutes(dueCount, newCount, meta)
    });
    if (!content) return { shown: false, reason: "nothing-due" };
    await chrome.notifications.create(NOTIFICATION_ID, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: content.title,
      message: content.message,
      priority: 0
    });
    return { shown: true, ...content };
  }

  async function handleAlarm(alarm, now = new Date()) {
    if (alarm?.name !== REMINDER_ALARM) return null;
    let result = null;
    try {
      result = await showReminder(now);
    } finally {
      // The next reminder is scheduled whatever happened to this one.
      await scheduleReminder(new Date(now.getTime() + 60000));
    }
    return result;
  }

  async function handleNotificationClick(notificationId) {
    if (notificationId !== NOTIFICATION_ID) return;
    await chrome.tabs.create({ url: chrome.runtime.getURL("pages/flashcards.html?deck=today") });
    await chrome.notifications?.clear?.(NOTIFICATION_ID);
  }

  // chrome.notifications only exists once the permission is granted, which
  // can happen while the worker is running.
  let clickListenerAdded = false;
  function ensureNotificationListener() {
    if (clickListenerAdded || !chrome.notifications?.onClicked?.addListener) return false;
    chrome.notifications.onClicked.addListener((id) => {
      handleNotificationClick(id).catch(() => {});
    });
    clickListenerAdded = true;
    return true;
  }

  // ── Settings form (Progress page) ───────────────────────────
  function bindSettingsForm(root, { permissions = chrome.permissions } = {}) {
    if (!root) return null;
    const enabled = root.querySelector("#reminder-enabled");
    const time = root.querySelector("#reminder-time");
    const badgeNew = root.querySelector("#badge-includes-new");
    const status = root.querySelector("#reminder-status");

    const setStatus = (text, isError = false) => {
      if (!status) return;
      status.textContent = text;
      status.classList.toggle("is-error", isError);
    };

    const paint = (settings) => {
      enabled.checked = settings.enabled;
      time.value = settings.time;
      time.disabled = !settings.enabled;
      badgeNew.checked = settings.badgeIncludesNew;
      setStatus(settings.enabled
        ? `Daily at ${settings.time}, only when words are due and you haven't studied yet.`
        : "Reminders are off.");
    };

    enabled.addEventListener("change", async () => {
      if (enabled.checked) {
        // Must be the first await: the permission prompt needs the click.
        let granted = false;
        try {
          granted = Boolean(await permissions?.request?.({ permissions: ["notifications"] }));
        } catch {
          granted = false;
        }
        if (!granted) {
          enabled.checked = false;
          setStatus("Notifications weren't allowed, so reminders stay off.", true);
          return;
        }
      }
      paint(await saveReminderSettings({ enabled: enabled.checked }));
    });
    time.addEventListener("change", async () => {
      paint(await saveReminderSettings({ time: time.value }));
    });
    badgeNew.addEventListener("change", async () => {
      paint(await saveReminderSettings({ badgeIncludesNew: badgeNew.checked }));
    });

    const ready = getReminderSettings().then(paint);
    return { ready };
  }

  globalThis.LodVaultReminders = {
    REMINDER_SETTINGS_KEY,
    REMINDER_ALARM,
    NOTIFICATION_ID,
    DEFAULT_TIME,
    DEFAULT_SETTINGS,
    normalizeTime,
    normalizeReminderSettings,
    getReminderSettings,
    saveReminderSettings,
    nextReminderTime,
    estimateMinutes,
    buildReminderMessage,
    scheduleReminder,
    ensureReminderScheduled,
    showReminder,
    handleAlarm,
    handleNotificationClick,
    ensureNotificationListener,
    bindSettingsForm
  };
})();
