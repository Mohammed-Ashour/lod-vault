const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runScripts, loadSharedStore, loadBackgroundScript } = require("./helpers/loaders");
const { loadStatsPage } = require("./helpers/stats-page");

const DAY = 86400e3;
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
// Background work is asynchronous; poll instead of guessing how long it takes.
async function until(check, timeoutMs = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) return false;
    await wait(10);
  }
  return true;
}
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadReminders() {
  const loaded = loadSharedStore();
  runScripts(loaded.context, ["scripts/activity.js", "scripts/reminders.js"]);
  return loaded.context.LodVaultReminders;
}

function entry(id, extra = {}) {
  return { id, word: id.toLowerCase(), url: `https://lod.lu/artikel/${id}`, history: true, ...extra };
}

function dueCard(daysAgo = 1) {
  const reviewedAt = new Date(Date.now() - 3 * DAY).toISOString();
  return {
    totalReviews: 1,
    reviews: [{ date: reviewedAt, rating: 2 }],
    lastReviewedAt: reviewedAt,
    dueAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
    interval: 1
  };
}

// The background loader has no notification or tab APIs; add recording stubs.
function withNotifications(background) {
  const notifications = [];
  const clicked = [];
  const tabs = [];
  background.chrome.notifications = {
    async create(id, options) {
      notifications.push({ id, ...options });
    },
    async clear(id) {
      clicked.push(id);
    },
    onClicked: { addListener() {} }
  };
  background.chrome.tabs.create = async ({ url }) => tabs.push(url);
  background.chrome.runtime.getURL = (relative) => `chrome-extension://test/${relative}`;
  return { notifications, clicked, tabs };
}

test("the next reminder is today if the time is still ahead, else tomorrow", () => {
  const reminders = loadReminders();
  const morning = new Date(2026, 10, 20, 8, 30);
  assert.equal(reminders.nextReminderTime("19:00", morning).getTime(), new Date(2026, 10, 20, 19, 0).getTime());
  const evening = new Date(2026, 10, 20, 19, 0);
  assert.equal(reminders.nextReminderTime("19:00", evening).getTime(), new Date(2026, 10, 21, 19, 0).getTime());
  assert.equal(reminders.normalizeTime("7:05"), "07:05");
  assert.equal(reminders.normalizeTime("25:00"), "19:00");
  assert.deepEqual(plain(reminders.normalizeReminderSettings({ enabled: 1, time: "x" })), {
    enabled: true,
    time: "19:00",
    badgeIncludesNew: false
  });
});

test("the reminder text gives due and new counts and an estimated time", () => {
  const reminders = loadReminders();
  assert.equal(reminders.buildReminderMessage({ dueCount: 0, newCount: 0 }), null);
  assert.deepEqual(plain(reminders.buildReminderMessage({ dueCount: 12, newCount: 0, minutes: 2 })), {
    title: "12 words to study today",
    message: "12 due · about 2 min"
  });
  assert.equal(reminders.buildReminderMessage({ dueCount: 1, newCount: 3, minutes: 5 }).message, "1 due · 3 new · about 5 min");
  // 12 reviews × 10 s + 3 new × 25 s ≈ 3 min.
  assert.equal(reminders.estimateMinutes(12, 3, {}), 3);
  const timed = { A: { reviews: Array.from({ length: 10 }, () => ({ ms: 30000 })) } };
  assert.equal(reminders.estimateMinutes(4, 0, timed), 2);
});

test("turning reminders on schedules one alarm, and turning them off clears it", async () => {
  const background = loadBackgroundScript();
  const cleared = [];
  background.chrome.alarms.clear = async (name) => {
    cleared.push(name);
  };
  await wait();
  assert.equal(background.createdAlarms.filter((alarm) => alarm.name === "lodvault-reminder").length, 0, "off by default");

  await background.chrome.storage.local.set({ "lodVault.reminders": { enabled: true, time: "07:30" } });
  await until(() => background.createdAlarms.some((item) => item.name === "lodvault-reminder"));
  const alarm = background.createdAlarms.filter((item) => item.name === "lodvault-reminder").at(-1);
  assert.ok(alarm, "alarm created");
  const when = new Date(alarm.when);
  assert.equal(when.getHours(), 7);
  assert.equal(when.getMinutes(), 30);
  assert.ok(alarm.when > Date.now());

  const createdBefore = background.createdAlarms.length;
  await background.chrome.storage.local.set({ "lodVault.reminders": { enabled: false, time: "07:30" } });
  await until(() => cleared.includes("lodvault-reminder"));
  assert.ok(cleared.includes("lodvault-reminder"));
  assert.equal(background.createdAlarms.length, createdBefore);
});

test("an enabled reminder is re-created when the browser starts", async () => {
  const background = loadBackgroundScript({ local: { "lodVault.reminders": { enabled: true, time: "21:15" } } });
  await wait();
  background.createdAlarms.length = 0;
  background.chrome.alarms.get = async () => undefined;
  background.runtimeOnStartup.dispatch();
  await until(() => background.createdAlarms.some((alarm) => alarm.name === "lodvault-reminder"));
  assert.equal(background.createdAlarms.filter((alarm) => alarm.name === "lodvault-reminder").length, 1);

  // An alarm that's still pending isn't moved.
  background.createdAlarms.length = 0;
  background.chrome.alarms.get = async () => ({ name: "lodvault-reminder", scheduledTime: Date.now() + DAY });
  background.runtimeOnInstalled.dispatch({ reason: "update" });
  await wait();
  assert.equal(background.createdAlarms.filter((alarm) => alarm.name === "lodvault-reminder").length, 0);
});

test("the reminder shows due words, then schedules the next one", async () => {
  const background = loadBackgroundScript({
    local: {
      "lodVault.reminders": { enabled: true, time: "19:00" },
      "lodVault.entries": { HAUS1: entry("HAUS1", { study: true }), FRA1: entry("FRA1", { study: true }) },
      "lodVault.flashcardMeta": { HAUS1: dueCard() }
    }
  });
  const { notifications } = withNotifications(background);
  await wait();
  background.createdAlarms.length = 0;
  background.alarmsOnAlarm.dispatch({ name: "lodvault-reminder" });
  await until(() => notifications.length && background.createdAlarms.some((alarm) => alarm.name === "lodvault-reminder"));
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].id, "lodvault-reminder");
  assert.equal(notifications[0].title, "2 words to study today");
  assert.equal(notifications[0].message, "1 due · 1 new · about 1 min");
  assert.equal(background.createdAlarms.filter((alarm) => alarm.name === "lodvault-reminder").length, 1);
});

test("the reminder stays quiet when nothing is due or today is already done", async () => {
  const quiet = loadBackgroundScript({
    local: {
      "lodVault.reminders": { enabled: true, time: "19:00" },
      "lodVault.entries": { HAUS1: entry("HAUS1") }
    }
  });
  const quietCalls = withNotifications(quiet);
  await wait();
  const result = await quiet.context.LodVaultReminders.showReminder();
  assert.equal(result.reason, "nothing-due");
  assert.equal(quietCalls.notifications.length, 0);

  const today = quiet.context.LodVaultActivity.toDayNumber(new Date());
  const studied = loadBackgroundScript({
    local: {
      "lodVault.reminders": { enabled: true, time: "19:00" },
      "lodVault.entries": { HAUS1: entry("HAUS1", { study: true }) },
      "lodVault.flashcardMeta": { HAUS1: dueCard() },
      "lodVault.activity": { d: { [today]: [15, 0, 0] }, s: today - 5 }
    }
  });
  const studiedCalls = withNotifications(studied);
  await wait();
  assert.equal((await studied.context.LodVaultReminders.showReminder()).reason, "studied");
  assert.equal(studiedCalls.notifications.length, 0);
});

test("without the notifications permission the reminder does nothing", async () => {
  const background = loadBackgroundScript({
    local: {
      "lodVault.reminders": { enabled: true, time: "19:00" },
      "lodVault.entries": { HAUS1: entry("HAUS1", { study: true }) }
    }
  });
  const { notifications } = withNotifications(background);
  background.chrome.permissions.contains = async () => false;
  await wait();
  assert.equal((await background.context.LodVaultReminders.showReminder()).reason, "off");
  assert.equal(notifications.length, 0);
});

test("clicking the reminder opens today's flashcards", async () => {
  const background = loadBackgroundScript();
  const { tabs, clicked } = withNotifications(background);
  await background.context.LodVaultReminders.handleNotificationClick("lodvault-reminder");
  assert.deepEqual(tabs, ["chrome-extension://test/pages/flashcards.html?deck=today"]);
  assert.deepEqual(clicked, ["lodvault-reminder"]);
  await background.context.LodVaultReminders.handleNotificationClick("other");
  assert.equal(tabs.length, 1);
});

test("the badge can count today's new words too", async () => {
  const background = loadBackgroundScript({
    local: {
      "lodVault.entries": {
        HAUS1: entry("HAUS1", { study: true }),
        FRA1: entry("FRA1", { study: true }),
        MANN1: entry("MANN1", { study: true })
      },
      "lodVault.flashcardMeta": { HAUS1: dueCard() },
      "lodVault.flashcardSettings": { dailyTarget: 5 }
    }
  });
  await until(() => background.badgeTexts.at(-1) === "1");
  assert.equal(background.badgeTexts.at(-1), "1");
  await background.chrome.storage.local.set({ "lodVault.reminders": { enabled: false, badgeIncludesNew: true } });
  await until(() => background.badgeTexts.at(-1) === "3");
  assert.equal(background.badgeTexts.at(-1), "3");
});

test("turning reminders on asks for the notifications permission first", async () => {
  const granted = await loadStatsPage({});
  const document = granted.dom.window.document;
  const toggle = document.getElementById("reminder-enabled");
  toggle.checked = true;
  toggle.dispatchEvent(new granted.dom.window.Event("change", { bubbles: true }));
  await until(() => granted.storageData["lodVault.reminders"]?.enabled);
  assert.deepEqual(plain(granted.permissionRequests), [{ permissions: ["notifications"] }]);
  assert.equal(granted.storageData["lodVault.reminders"].enabled, true);
  assert.equal(document.getElementById("reminder-time").disabled, false);
  assert.match(document.getElementById("reminder-status").textContent, /Daily at 19:00/);

  const time = document.getElementById("reminder-time");
  time.value = "08:15";
  time.dispatchEvent(new granted.dom.window.Event("change", { bubbles: true }));
  await until(() => granted.storageData["lodVault.reminders"]?.time === "08:15");
  assert.equal(granted.storageData["lodVault.reminders"].time, "08:15");

  const denied = await loadStatsPage({}, { permissionGranted: false });
  const deniedToggle = denied.dom.window.document.getElementById("reminder-enabled");
  deniedToggle.checked = true;
  deniedToggle.dispatchEvent(new denied.dom.window.Event("change", { bubbles: true }));
  await wait();
  assert.equal(deniedToggle.checked, false);
  assert.equal(denied.storageData["lodVault.reminders"], undefined);
  assert.match(denied.dom.window.document.getElementById("reminder-status").textContent, /weren't allowed/);
});

test("notifications is optional, never a required permission", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  assert.ok(manifest.optional_permissions.includes("notifications"));
  assert.ok(!manifest.permissions.includes("notifications"));
});
