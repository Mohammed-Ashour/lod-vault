// Shared fixture data for recorded flows: lexicon records parsed from the
// trimmed LOD responses in tests/fixtures/lod, never real user data.
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function loadGlobals(scripts) {
  const context = { console, Date, Intl, URL, TextEncoder };
  context.globalThis = context;
  for (const script of scripts) {
    vm.runInNewContext(readFileSync(path.join(root, script), "utf8"), context, { filename: script });
  }
  return context;
}

export const globals = loadGlobals(["scripts/lens-lookup.js"]);

export function rawEntry(id) {
  return JSON.parse(readFileSync(path.join(root, "tests", "fixtures", "lod", `${id}.json`), "utf8")).entry;
}

export function lexicon(id, now = Date.now() - 3 * 864e5) {
  return JSON.parse(JSON.stringify(globals.LodVaultLensLookup.parseLexicon(rawEntry(id), { now })));
}

export const FIXTURE_IDS = ["HAUS1", "MANN1", "FRA1", "GROUSS2", "GOEN1", "MAACHEN1"];

export function lexiconSeed(ids = FIXTURE_IDS) {
  const local = {};
  const index = {};
  for (const id of ids) {
    const record = lexicon(id);
    local[`lodVault.lx.${id}`] = record;
    index[id] = [record.fetchedAt, JSON.stringify(record).length];
  }
  local["lodVault.lxIndex"] = index;
  return local;
}

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

// Saved entries for the fixture words, as the flattened parser would store them.
export function entrySeed(ids = FIXTURE_IDS) {
  const entries = {};
  for (const id of ids) {
    const entry = globals.LodVaultLensLookup.normalizeEntryFromApi(rawEntry(id));
    entries[id] = {
      ...JSON.parse(JSON.stringify(entry)),
      favorite: true, study: true, history: false,
      createdAt: daysAgo(30), updatedAt: daysAgo(2)
    };
  }
  return entries;
}
