// Tests of the shared store helpers (P10-M8): `node --test scripts/store/*.test.mjs`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ASC_LOCALES, LANGS, PLAY_LOCALES, UsageError, langsOf, loadListings, parseArgs, pngSize, releaseNotes, retryingFetch, screenshots } from "./lib.mjs";

const storeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "testdata/store");

test("locale maps cover the 24 languages; Play lacks ga/mt, the App Store lacks bg/et/ga/lt/lv/mt", () => {
  assert.equal(LANGS.length, 24);
  assert.deepEqual(Object.keys(PLAY_LOCALES).sort(), [...LANGS].sort());
  assert.deepEqual(Object.keys(ASC_LOCALES).sort(), [...LANGS].sort());
  assert.deepEqual(
    LANGS.filter((l) => !PLAY_LOCALES[l]),
    ["ga", "mt"],
  );
  assert.deepEqual(
    LANGS.filter((l) => !ASC_LOCALES[l]),
    ["bg", "et", "ga", "lt", "lv", "mt"],
  );
  assert.equal(PLAY_LOCALES.pt, "pt-PT");
  assert.equal(ASC_LOCALES.pt, "pt-PT");
});

test("parseArgs, langsOf", () => {
  assert.deepEqual(parseArgs(["upload", "--app", "calc", "--dry-run", "--track=internal"], ["dry-run"]), {
    _: ["upload"],
    opts: { app: "calc", "dry-run": true, track: "internal" },
  });
  assert.throws(() => parseArgs(["--app"]), UsageError);
  assert.throws(() => parseArgs(["--app", "--track", "x"]), /--app needs a value/);
  assert.deepEqual(langsOf("en, de"), ["en", "de"]);
  assert.equal(langsOf(undefined).length, 24);
  assert.throws(() => langsOf("en,xx"), /unknown language\(s\): xx/);
});

test("docs/store layout: listings, notes with en fallback, screenshots per language with en reuse, PNG sizes", () => {
  assert.deepEqual(Object.keys(loadListings(storeDir, "calc")), ["de", "en", "ga"]);
  assert.deepEqual(loadListings(storeDir, "write"), {});
  assert.equal(releaseNotes(path.join(storeDir, "release-notes"), "fr"), "Phone and tablet apps, touch editing.");
  assert.equal(releaseNotes(path.join(storeDir, "nope"), "fr"), null);
  const de = screenshots(storeDir, "calc", "phone", "de");
  assert.equal(de.own, true);
  assert.deepEqual(
    de.files.map((f) => path.basename(f)),
    ["1-sheet.png"],
  );
  assert.deepEqual(screenshots(storeDir, "calc", "phone", "fr"), { files: [], own: false });
  assert.deepEqual(
    screenshots(storeDir, "calc", "phone", "fr", { reuse: true }).files.map((f) => path.basename(f)),
    ["1-sheet.png", "2-chart.png"],
  );
  assert.deepEqual(pngSize(fs.readFileSync(de.files[0])), { width: 1080, height: 2340 });
  assert.equal(pngSize(Buffer.from("not a png at all, really not")), null);
});

test("retryingFetch: network errors and 5xx are retried with backoff, 4xx is not", async () => {
  const sleeps = [];
  let n = 0;
  const f = retryingFetch(
    async () => {
      n++;
      if (n === 1) throw new TypeError("fetch failed");
      if (n === 2) return { status: 502, headers: { get: () => null } };
      return { status: 400, headers: { get: () => null } };
    },
    { sleep: async (ms) => sleeps.push(ms) },
  );
  assert.equal((await f("https://example.test/x", {})).status, 400);
  assert.deepEqual(sleeps, [1000, 2000]);
  const always = retryingFetch(async () => ({ status: 500, headers: { get: () => null } }), { retries: 2, sleep: async () => {} });
  assert.equal((await always("https://example.test/x", {})).status, 500);
});
