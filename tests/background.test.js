const test = require("node:test");
const assert = require("node:assert/strict");

const { loadBackgroundScript } = require("./helpers/loaders");

async function wait(ms = 0) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("background serializes store mutations through a shared queue", async () => {
  const background = loadBackgroundScript();
  const order = [];
  let releaseFirst = null;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let callCount = 0;

  background.context.LodVaultStore.saveNote = async () => {
    callCount += 1;
    const label = String(callCount);
    order.push(`start-${label}`);
    if (callCount === 1) {
      await firstGate;
    }
    order.push(`end-${label}`);
    return { call: callCount };
  };

  const first = background.dispatchStoreMutation({
    type: "lodvault:store-mutate",
    method: "saveNote",
    args: ["HAUS1", "one"]
  });
  const second = background.dispatchStoreMutation({
    type: "lodvault:store-mutate",
    method: "saveNote",
    args: ["BEEM1", "two"]
  });

  await wait(0);
  assert.deepEqual(order, ["start-1"]);

  releaseFirst();

  const [firstResponse, secondResponse] = await Promise.all([first, second]);

  assert.deepEqual(order, ["start-1", "end-1", "start-2", "end-2"]);
  assert.deepEqual(JSON.parse(JSON.stringify(firstResponse)), { ok: true, result: { call: 1 } });
  assert.deepEqual(JSON.parse(JSON.stringify(secondResponse)), { ok: true, result: { call: 2 } });
});

test("background reloads all open LOD tabs on install", async () => {
  const background = loadBackgroundScript();
  let receivedQuery = null;

  background.chrome.tabs.query = async (queryInfo) => {
    receivedQuery = queryInfo;
    return [
      { id: 101 },
      { id: "ignore-me" },
      { id: 202 }
    ];
  };

  background.runtimeOnInstalled.dispatch({ reason: "install" });
  await wait(0);
  await wait(0);

  assert.deepEqual(JSON.parse(JSON.stringify(receivedQuery)), {
    url: ["https://lod.lu/*", "https://www.lod.lu/*"]
  });
  assert.deepEqual(background.reloadedTabIds, [101, 202]);
});

test("background resumes queued history hydration when the service worker starts with pending work", async () => {
  const background = loadBackgroundScript({
    local: {
      "lodVault.historyImport": {
        status: "queued",
        startedAt: "2025-04-02T09:00:00.000Z",
        updatedAt: "2025-04-02T09:00:00.000Z",
        scanned: 1,
        imported: 1,
        skippedExisting: 0,
        ignored: 0,
        queued: 1,
        hydrated: 0,
        failed: 0,
        currentId: "",
        queue: ["BEEM1"],
        failedIds: [],
        addedEntries: [
          {
            id: "BEEM1",
            word: "Beem",
            url: "https://lod.lu/artikel/BEEM1",
            lastVisitedAt: "2025-04-02T09:00:00.000Z"
          }
        ]
      }
    }
  });
  let resumeCalls = 0;

  background.context.LodVaultStore.resumeHistoryImportHydration = async () => {
    resumeCalls += 1;
    return true;
  };

  await wait(70);

  assert.equal(resumeCalls, 1);
});

test("background pushes relevant local storage changes into sync storage", async () => {
  const background = loadBackgroundScript({
    local: {
      "lodVault.entries": {
        HAUS1: {
          id: "HAUS1",
          word: "Haus",
          url: "https://lod.lu/artikel/HAUS1",
          favorite: true,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z"
        }
      },
      "lodVault.settings": {
        autoMode: false,
        syncLanguages: ["en", "fr", "de"]
      }
    }
  });

  await background.chrome.storage.local.set({
    "lodVault.entries": {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        favorite: true,
        translations: { en: "house", fr: "maison", de: "Haus" },
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z"
      }
    }
  });

  await wait(50);

  assert.ok(background.syncStorageData["lodVault.m"]);
  assert.ok(Array.isArray(background.syncStorageData["lodVault.e.0"]));
  assert.deepEqual(background.syncStorageData["lodVault.e.0"][0].t, { e: "house", f: "maison", d: "Haus" });
});

test("background pulls relevant sync storage changes into local storage", async () => {
  const background = loadBackgroundScript();

  await background.chrome.storage.sync.set({
    "lodVault.m": { v: 3, n: 1, a: false, l: ["e", "f"], t: 1714564800 },
    "lodVault.s": { a: false, l: ["en", "fr"] },
    "lodVault.e.0": [
      {
        i: "HAUS1",
        w: "Haus",
        u: "HAUS1",
        t: { e: "house", f: "maison" },
        a: 1,
        r: 1735689600,
        o: 1735776000
      }
    ]
  });

  await wait(50);

  assert.equal(background.storageData["lodVault.entries"].HAUS1.word, "Haus");
  assert.deepEqual(background.storageData["lodVault.entries"].HAUS1.translations, { en: "house", fr: "maison" });
});

test("background uses pushEntry for a single-entry local mutation after sync is initialized", async () => {
  const background = loadBackgroundScript();
  let pushEntryId = null;
  let pushAllCalls = 0;

  background.context.LodVaultSync.SyncAdapter.init = async () => ({ ok: true, mode: "noop" });
  background.runtimeOnStartup.dispatch();
  await wait(0);
  await wait(0);

  background.context.LodVaultSync.SyncAdapter.pushEntry = async (id) => {
    pushEntryId = id;
    return { ok: true, mode: "entry" };
  };
  background.context.LodVaultSync.SyncAdapter.pushAll = async () => {
    pushAllCalls += 1;
    return { ok: true, mode: "full" };
  };

  await background.chrome.storage.local.set({
    "lodVault.entries": {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        favorite: true,
        updatedAt: "2025-01-02T00:00:00.000Z"
      }
    }
  });

  await wait(50);

  assert.equal(pushEntryId, "HAUS1");
  assert.equal(pushAllCalls, 0);
});

test("background pushes new words immediately without waiting for debounce", async () => {
  const background = loadBackgroundScript();
  let pushEntryId = null;

  background.context.LodVaultSync.SyncAdapter.init = async () => ({ ok: true, mode: "noop" });
  background.runtimeOnStartup.dispatch();
  await wait(0);
  await wait(0);

  background.context.LodVaultSync.SyncAdapter.pushEntry = async (id) => {
    pushEntryId = id;
    return { ok: true, mode: "entry" };
  };

  await background.chrome.storage.local.set({
    "lodVault.entries": {
      HAUS1: {
        id: "HAUS1",
        word: "Haus",
        url: "https://lod.lu/artikel/HAUS1",
        study: true,
        updatedAt: "2025-01-02T00:00:00.000Z"
      }
    }
  });

  await wait(1);

  assert.equal(pushEntryId, "HAUS1");
});

test("background uses pushSettings for an autoMode-only settings mutation", async () => {
  const background = loadBackgroundScript();
  let pushSettingsCalls = 0;
  let pushAllCalls = 0;

  background.context.LodVaultSync.SyncAdapter.init = async () => ({ ok: true, mode: "noop" });
  background.runtimeOnStartup.dispatch();
  await wait(0);
  await wait(0);

  background.context.LodVaultSync.SyncAdapter.pushSettings = async () => {
    pushSettingsCalls += 1;
    return { ok: true, mode: "settings" };
  };
  background.context.LodVaultSync.SyncAdapter.pushAll = async () => {
    pushAllCalls += 1;
    return { ok: true, mode: "full" };
  };

  await background.chrome.storage.local.set({
    "lodVault.settings": {
      autoMode: true,
      syncLanguages: ["en", "fr", "de"]
    }
  });

  await wait(50);

  assert.equal(pushSettingsCalls, 1);
  assert.equal(pushAllCalls, 0);
});

test("background keeps the local verification timestamp out of sync writes", async () => {
  const background = loadBackgroundScript();
  let pushCalls = 0;

  background.context.LodVaultSync.SyncAdapter.init = async () => ({ ok: true, mode: "noop" });
  background.runtimeOnStartup.dispatch();
  await wait(0);
  await wait(0);

  background.context.LodVaultSync.SyncAdapter.pushAll = async () => {
    pushCalls += 1;
    return { ok: true };
  };
  background.context.LodVaultSync.SyncAdapter.pushSettings = async () => {
    pushCalls += 1;
    return { ok: true };
  };

  await background.chrome.storage.local.set({
    "lodVault.settings": {
      autoMode: false,
      syncLanguages: ["en", "fr", "de"],
      lastVerifiedSyncAt: "2026-07-30T12:34:56.000Z"
    }
  });

  await wait(50);
  assert.equal(pushCalls, 0);
});

test("background registers the lens context menu during boot", () => {
  const background = loadBackgroundScript();
  const menu = background.createdContextMenus[background.createdContextMenus.length - 1];

  assert.equal(background.removedContextMenus.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(menu)), {
    id: "lodvault-open-lens",
    title: "Translate with LODVault",
    contexts: ["selection"]
  });
});

test("background opens the lens overlay for content-script requests from the sender tab", async () => {
  const background = loadBackgroundScript();

  const response = await background.dispatchRuntimeMessage(
    {
      type: "lodvault:open-lens-overlay",
      selectionText: "  Moien   alleguer  "
    },
    {
      tab: { id: 77 },
      url: "https://www.rtl.lu/news"
    }
  );

  assert.deepEqual(JSON.parse(JSON.stringify(response)), { ok: true });
  assert.deepEqual(background.permissionRequests, [["https://www.rtl.lu/*"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(background.registeredContentScripts.at(-1))), [{
    id: "lodvault-selection-trigger",
    matches: ["https://www.rtl.lu/*"],
    js: ["scripts/selection-trigger.js"],
    css: ["styles/selection-trigger.css"],
    runAt: "document_idle"
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(background.insertedCss)), [{
    target: { tabId: 77 },
    files: ["styles/selection-trigger.css"]
  }, {
    target: { tabId: 77 },
    files: ["styles/lens-overlay.css"]
  }]);
  const filesCalls = background.executedScripts.filter((call) => Array.isArray(call.files));
  assert.equal(filesCalls.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(filesCalls[0].files)), ["scripts/selection-trigger.js"]);
  assert.deepEqual(JSON.parse(JSON.stringify(filesCalls[1].files)), [
    "scripts/store-core.js",
    "scripts/entry-presenter.js",
    "scripts/shared.js",
    "scripts/lens-lookup.js",
    "scripts/lens-session.js",
    "scripts/lens-render.js",
    "scripts/lens-overlay-shell.js",
    "scripts/lens-sentence-mode.js",
    "scripts/lens-overlay-controller.js",
    "scripts/lens-runtime.js"
  ]);
  assert.equal(typeof background.executedScripts[0].func, "function");
  assert.deepEqual(JSON.parse(JSON.stringify(background.executedScripts[0].target)), { tabId: 77 });
  const openCall = background.executedScripts.find((call) => Array.isArray(call.args));
  assert.deepEqual(JSON.parse(JSON.stringify(openCall.args)), ["Moien alleguer"]);
});

test("background preserves long sentence selections when opening the lens overlay", async () => {
  const background = loadBackgroundScript();
  const longSelection = "  Dëst ass eng zimlech laang Auswiel mat villen Wierder déi net soll gekierzt ginn wann de Benotzer de Lens iwwer de Kontextmenü opmécht fir e komplette Saz nozeschloen.  ";

  const response = await background.dispatchRuntimeMessage(
    {
      type: "lodvault:open-lens-overlay",
      selectionText: longSelection
    },
    {
      tab: { id: 77 },
      url: "https://www.rtl.lu/news"
    }
  );

  assert.deepEqual(JSON.parse(JSON.stringify(response)), { ok: true });
  const openCall = background.executedScripts.find((call) => Array.isArray(call.args));
  assert.deepEqual(JSON.parse(JSON.stringify(openCall.args)), [
    "Dëst ass eng zimlech laang Auswiel mat villen Wierder déi net soll gekierzt ginn wann de Benotzer de Lens iwwer de Kontextmenü opmécht fir e komplette Saz nozeschloen."
  ]);
});

test("background requests optional site access before injecting the lens runtime from the floating trigger", async () => {
  const background = loadBackgroundScript();
  let granted = false;
  const executeScriptCalls = [];

  background.chrome.permissions.contains = async () => granted;
  background.chrome.permissions.request = async (details = {}) => {
    granted = true;
    background.permissionRequests.push(JSON.parse(JSON.stringify(details.origins || [])));
    return true;
  };
  background.chrome.scripting.insertCSS = async (details) => {
    if (!granted) {
      throw new Error("Missing host permission");
    }
    background.insertedCss.push(JSON.parse(JSON.stringify(details)));
  };
  background.chrome.scripting.executeScript = async (details) => {
    executeScriptCalls.push(details);
    if (!granted) {
      throw new Error("Missing host permission");
    }
    if (typeof details?.func === "function") {
      return [{ result: false }];
    }
    return [];
  };

  const response = await background.dispatchRuntimeMessage({
    type: "lodvault:open-lens-overlay",
    selectionText: "Moien"
  }, {
    tab: { id: 77 },
    url: "https://www.rtl.lu/news"
  });

  assert.deepEqual(JSON.parse(JSON.stringify(response)), { ok: true });
  assert.deepEqual(background.permissionRequests, [["https://www.rtl.lu/*"]]);
  assert.equal(executeScriptCalls.filter((call) => Array.isArray(call.files)).length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(background.insertedCss)), [{
    target: { tabId: 77 },
    files: ["styles/selection-trigger.css"]
  }, {
    target: { tabId: 77 },
    files: ["styles/lens-overlay.css"]
  }]);
});

test("background context menu grants site access before opening the lens overlay", async () => {
  const background = loadBackgroundScript();

  background.contextMenusOnClicked.dispatch({
    menuItemId: "lodvault-open-lens",
    selectionText: "  Haus  "
  }, {
    id: 42,
    url: "https://www.rtl.lu/news"
  });
  await wait(0);
  await wait(0);
  await wait(0);

  assert.deepEqual(background.permissionRequests, [["https://www.rtl.lu/*"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(background.registeredContentScripts.at(-1))), [{
    id: "lodvault-selection-trigger",
    matches: ["https://www.rtl.lu/*"],
    js: ["scripts/selection-trigger.js"],
    css: ["styles/selection-trigger.css"],
    runAt: "document_idle"
  }]);
  const openCall = background.executedScripts.find((call) => Array.isArray(call.args));
  assert.deepEqual(JSON.parse(JSON.stringify(openCall.args)), ["Haus"]);
});

test("background reuses previously injected lens scripts in the same tab", async () => {
  const background = loadBackgroundScript();
  let triggerAvailable = false;
  let overlayAvailable = false;
  const executeScriptCalls = [];

  background.chrome.scripting.executeScript = async (details) => {
    executeScriptCalls.push(details);

    if (typeof details?.func === "function" && !Array.isArray(details.args)) {
      return [{ result: triggerAvailable && overlayAvailable }];
    }

    if (Array.isArray(details.files)) {
      if (details.files.includes("scripts/selection-trigger.js")) {
        triggerAvailable = true;
      } else {
        overlayAvailable = true;
      }
      return [];
    }

    return [];
  };

  await background.dispatchRuntimeMessage({
    type: "lodvault:open-lens-overlay",
    selectionText: "Haus"
  }, {
    tab: { id: 77 },
    url: "https://example.com/"
  });

  await background.dispatchRuntimeMessage({
    type: "lodvault:open-lens-overlay",
    selectionText: "Moien"
  }, {
    tab: { id: 77 },
    url: "https://example.com/"
  });

  const lensFileCalls = executeScriptCalls.filter((call) => Array.isArray(call.files) && !call.files.includes("scripts/selection-trigger.js"));
  assert.equal(lensFileCalls.length, 1);
  const openCalls = executeScriptCalls.filter((call) => Array.isArray(call.args));
  assert.deepEqual(JSON.parse(JSON.stringify(openCalls.at(-1).args)), ["Moien"]);
});

test("background command reads the current selection before opening the lens overlay", async () => {
  const background = loadBackgroundScript();
  const executeScriptCalls = [];

  background.chrome.tabs.query = async () => [{ id: 55 }];
  background.chrome.scripting.executeScript = async (details) => {
    executeScriptCalls.push(details);
    if (typeof details?.func === "function" && !Array.isArray(details.args)) {
      if (String(details.func).includes("window.getSelection")) {
        return [{ result: "  déidlechen!  " }];
      }
      return [{ result: false }];
    }
    return [];
  };

  background.commandsOnCommand.dispatch("open-lod-lens");
  await wait(0);
  await wait(0);
  await wait(0);

  assert.deepEqual(JSON.parse(JSON.stringify(executeScriptCalls[0].target)), { tabId: 55 });
  const lensFileCalls = executeScriptCalls.filter((call) => Array.isArray(call.files) && !call.files.includes("scripts/selection-trigger.js"));
  assert.deepEqual(JSON.parse(JSON.stringify(lensFileCalls[0].files)), [
    "scripts/store-core.js",
    "scripts/entry-presenter.js",
    "scripts/shared.js",
    "scripts/lens-lookup.js",
    "scripts/lens-session.js",
    "scripts/lens-render.js",
    "scripts/lens-overlay-shell.js",
    "scripts/lens-sentence-mode.js",
    "scripts/lens-overlay-controller.js",
    "scripts/lens-runtime.js"
  ]);
  const openCalls = executeScriptCalls.filter((call) => Array.isArray(call.args));
  assert.deepEqual(JSON.parse(JSON.stringify(openCalls[0].args)), ["déidlechen!"]);
});

test("background command preserves long selections for sentence lookup", async () => {
  const background = loadBackgroundScript();
  const executeScriptCalls = [];
  const longSelection = "  Dëst ass eng aner laang Auswiel déi iwwer d'Tastaturkommando opgemaach gëtt an dowéinst och komplett beim Overlay ukomme muss ouni an der Mëtt ofgeschnidden ze ginn.  ";

  background.chrome.tabs.query = async () => [{ id: 55 }];
  background.chrome.scripting.executeScript = async (details) => {
    executeScriptCalls.push(details);
    if (typeof details?.func === "function" && !Array.isArray(details.args)) {
      if (String(details.func).includes("window.getSelection")) {
        return [{ result: longSelection }];
      }
      return [{ result: false }];
    }
    return [];
  };

  background.commandsOnCommand.dispatch("open-lod-lens");
  await wait(0);
  await wait(0);
  await wait(0);

  const openCalls = executeScriptCalls.filter((call) => Array.isArray(call.args));
  assert.deepEqual(JSON.parse(JSON.stringify(openCalls[0].args)), [
    "Dëst ass eng aner laang Auswiel déi iwwer d'Tastaturkommando opgemaach gëtt an dowéinst och komplett beim Overlay ukomme muss ouni an der Mëtt ofgeschnidden ze ginn."
  ]);
});

test("background re-registers the selection trigger when site permissions are added", async () => {
  const background = loadBackgroundScript();

  background.chrome.permissions.getAll = async () => ({
    origins: [
      "https://www.rtl.lu/*",
      "https://lod.lu/*",
      "ftp://example.com/*",
      "https://*.wildcard.example/*"
    ]
  });

  background.permissionsOnAdded.dispatch();
  await wait(0);
  await wait(0);

  assert.deepEqual(JSON.parse(JSON.stringify(background.registeredContentScripts.at(-1))), [{
    id: "lodvault-selection-trigger",
    matches: ["https://www.rtl.lu/*"],
    js: ["scripts/selection-trigger.js"],
    css: ["styles/selection-trigger.css"],
    runAt: "document_idle"
  }]);
});

test("background keeps the selection trigger unregistered until site access is granted", async () => {
  const background = loadBackgroundScript();
  await wait(0);
  await wait(0);

  assert.deepEqual(JSON.parse(JSON.stringify(background.unregisteredContentScripts.at(-1))), {
    ids: ["lodvault-selection-trigger"]
  });
  assert.equal(background.registeredContentScripts.length, 0);
});

test("background only proxies the approved LOD Lens API endpoints", async () => {
  const background = loadBackgroundScript();
  const fetchCalls = [];
  const bodies = [
    { results: [{ article_id: "HAUS1" }] },
    { items: [{ word: "Haus" }] },
    { entry: { lod_id: "HAUS1" } }
  ];
  let bodyIndex = 0;

  background.context.fetch = async (url, options) => {
    fetchCalls.push({ url, options: JSON.parse(JSON.stringify(options)) });
    const body = JSON.stringify(bodies[bodyIndex] || {});
    bodyIndex += 1;
    return {
      ok: true,
      status: 200,
      async text() {
        return body;
      }
    };
  };

  const responses = [];
  for (const url of [
    "https://lod.lu/api/lb/search?lang=lb&query=Haus",
    "https://lod.lu/api/lb/suggest?query=Haus",
    "https://lod.lu/api/lb/entry/HAUS1"
  ]) {
    responses.push(await background.dispatchRuntimeMessage({
      type: "lodvault:lens-fetch",
      url
    }));
  }

  assert.equal(fetchCalls.length, 3);
  assert.deepEqual(fetchCalls.map((call) => call.url), [
    "https://lod.lu/api/lb/search?lang=lb&query=Haus",
    "https://lod.lu/api/lb/suggest?query=Haus",
    "https://lod.lu/api/lb/entry/HAUS1"
  ]);
  assert.ok(fetchCalls.every((call) => call.options.method === "GET"));
  assert.ok(fetchCalls.every((call) => call.options.headers.Accept === "application/json"));
  assert.deepEqual(JSON.parse(JSON.stringify(responses)), [
    { ok: true, status: 200, json: { results: [{ article_id: "HAUS1" }] }, text: '{"results":[{"article_id":"HAUS1"}]}' },
    { ok: true, status: 200, json: { items: [{ word: "Haus" }] }, text: '{"items":[{"word":"Haus"}]}' },
    { ok: true, status: 200, json: { entry: { lod_id: "HAUS1" } }, text: '{"entry":{"lod_id":"HAUS1"}}' }
  ]);
});

test("background rejects non-whitelisted lens proxy URLs before fetching", async () => {
  const background = loadBackgroundScript();
  let fetchCalls = 0;

  background.context.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch should not be called for blocked URLs");
  };

  for (const url of [
    "https://example.com/api/lb/search?lang=lb&query=Haus",
    "https://lod.lu/artikel/HAUS1",
    "https://lod.lu/api/lb/search?lang=en&query=Haus",
    "https://lod.lu/api/lb/suggest?query=Haus&extra=1",
    "https://lod.lu/api/lb/entry/HAUS1?foo=bar",
    "https://lod.lu/api/lb/entry/HAUS%2F1",
    "https://lod.lu/api/lb/entry/HAUS%5C1"
  ]) {
    const response = await background.dispatchRuntimeMessage({
      type: "lodvault:lens-fetch",
      url
    });

    assert.equal(response.ok, false);
    assert.equal(response.status, 400);
    assert.match(response.error, /Blocked unauthorized LOD Lens request URL\./);
  }

  assert.equal(fetchCalls, 0);
});
