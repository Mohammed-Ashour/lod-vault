const test = require("node:test");
const assert = require("node:assert/strict");

const { loadBackgroundScript } = require("./helpers/loaders");

test("background serializes store mutations through a shared queue", async () => {
  const background = loadBackgroundScript();
  const order = [];
  let releaseFirst = null;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let callCount = 0;

  background.context.LodWrapperStore.saveNote = async () => {
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
    type: "lod-wrapper:store-mutate",
    method: "saveNote",
    args: ["HAUS1", "one"]
  });
  const second = background.dispatchStoreMutation({
    type: "lod-wrapper:store-mutate",
    method: "saveNote",
    args: ["BEEM1", "two"]
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ["start-1"]);

  releaseFirst();

  const [firstResponse, secondResponse] = await Promise.all([first, second]);

  assert.deepEqual(order, ["start-1", "end-1", "start-2", "end-2"]);
  assert.deepEqual(JSON.parse(JSON.stringify(firstResponse)), { ok: true, result: { call: 1 } });
  assert.deepEqual(JSON.parse(JSON.stringify(secondResponse)), { ok: true, result: { call: 2 } });
});

test("background reloads LOD article tabs on install", async () => {
  const background = loadBackgroundScript();

  background.chrome.tabs.query = async () => [
    { id: 101 },
    { id: "ignore-me" },
    { id: 202 }
  ];

  background.runtimeOnInstalled.dispatch({ reason: "install" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(background.reloadedTabIds, [101, 202]);
});
