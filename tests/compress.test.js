const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");

function loadCompressModule() {
  const source = fs.readFileSync(path.join(repoRoot, "scripts/compress.js"), "utf8");
  const context = {
    TextEncoder,
    TextDecoder,
    CompressionStream,
    DecompressionStream,
    ReadableStream,
    WritableStream,
    console,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    globalThis: null
  };

  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "scripts/compress.js" });
  return context.LodWrapperCompress;
}

test("LodWrapperCompress round-trips short text", async () => {
  const compress = loadCompressModule();
  const original = "Hello, LODVault!";
  const compressed = await compress.compress(original);
  const decompressed = await compress.decompress(compressed);

  assert.equal(decompressed, original);
  assert.ok(typeof compressed === "string");
});

test("LodWrapperCompress round-trips long JSON-like text", async () => {
  const compress = loadCompressModule();

  const shared = {
    i: "HAUS1",
    w: "Haus",
    u: "HAUS1",
    p: "SUBST",
    t: { e: "house", f: "maison", d: "Haus" },
    a: 7,
    c: 5,
    l: 1736166896,
    r: 1735689600,
    o: 1736208000
  };

  const entries = [];
  for (let index = 0; index < 50; index += 1) {
    entries.push(structuredClone({ ...shared, i: `WORD${String(index).padStart(4, "0")}` }));
  }

  const original = JSON.stringify(entries);
  const compressed = await compress.compress(original);
  const decompressed = await compress.decompress(compressed);

  assert.equal(decompressed, original);
  assert.ok(typeof compressed === "string");
});

test("LodWrapperCompress achieves meaningful compression on JSON arrays", async () => {
  const compress = loadCompressModule();

  const shared = {
    i: "HAUS1",
    w: "Haus",
    u: "HAUS1",
    p: "SUBST",
    t: { e: "house", f: "maison", d: "Haus" },
    a: 7,
    c: 5,
    l: 1736166896,
    r: 1735689600,
    o: 1736208000,
    n: "A repeating note with some content that appears in many entries.",
    e: "An example sentence with the word Haus in context."
  };

  const entries = [];
  for (let index = 0; index < 100; index += 1) {
    entries.push(structuredClone({ ...shared, i: `WORD${String(index).padStart(4, "0")}` }));
  }

  const original = JSON.stringify(entries);
  const compressed = await compress.compress(original);

  // Compression should reduce significantly for repetitive JSON.
  const originalLength = new TextEncoder().encode(original).length;
  const compressedLength = compressed.length;
  const ratio = compressedLength / originalLength;

  // For repetitive JSON with 100 similar entries, expect at least 40% reduction
  assert.ok(ratio < 0.60, `compression ratio ${ratio.toFixed(2)} should be < 0.60 (original=${originalLength}B, compressed=${compressedLength}B)`);
});

test("LodWrapperCompress handles empty string", async () => {
  const compress = loadCompressModule();
  const compressed = await compress.compress("");
  const decompressed = await compress.decompress(compressed);

  assert.equal(decompressed, "");
});

test("LodWrapperCompress handles Unicode characters", async () => {
  const compress = loadCompressModule();
  const original = "Lëtzebuergesch — Haiser, Beem, a Schoulen.";
  const compressed = await compress.compress(original);
  const decompressed = await compress.decompress(compressed);

  assert.equal(decompressed, original);
});

test("LodWrapperCompress reports availability", () => {
  const compress = loadCompressModule();
  assert.equal(compress.isAvailable(), true);
});

test("LodWrapperCompress decompress returns input unchanged on invalid base64", async () => {
  const compress = loadCompressModule();
  const result = await compress.decompress("not-valid-base64!!!");
  // Catch path returns the original value
  assert.equal(result, "not-valid-base64!!!");
});

test("LodWrapperCompress base64 round-trips custom implementation", async () => {
  const compress = loadCompressModule();

  // Verify internal base64 by round-tripping through compress/decompress
  // with known-size input.
  const original = "abcdefghij";
  const compressed = await compress.compress(original);
  const decompressed = await compress.decompress(compressed);

  assert.equal(decompressed, original);
});

test("LodWrapperCompress fallback when _setAvailableForTest(false)", async () => {
  const compress = loadCompressModule();

  compress._setAvailableForTest(false);

  const original = '{"test":"should pass through unchanged"}';
  const compressed = await compress.compress(original);

  assert.equal(compressed, original);

  const decompressed = await compress.decompress(compressed);
  assert.equal(decompressed, original);

  assert.equal(compress.isAvailable(), false);

  // Restore
  compress._setAvailableForTest(true);
});
