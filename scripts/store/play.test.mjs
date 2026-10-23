// Tests of the Google Play publisher (P10-M8) with a throwaway RSA key and a mocked fetch – Google is never called:
// `node --test scripts/store/*.test.mjs`.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { API, PlayError, UPLOAD_API, accessToken, makeServiceJwt, notesFor, releaseBody, run } from "./play.mjs";
import { UsageError } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const storeDir = path.join(here, "testdata/store");
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const account = {
  type: "service_account",
  client_email: "rusuite-ci@example.iam.gserviceaccount.com",
  private_key: pem,
  token_uri: "https://oauth2.example.test/token",
};
const env = { PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(account) };
const TOKEN = "ya29.test-access-token";

/** Mocked fetch: `handler(method, url, init)` → [status, body, headers?] or undefined (→ 404). Records every call. */
const mock = (handler) => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, init });
    if (url === account.token_uri) return reply(200, { access_token: TOKEN, expires_in: 3599 });
    const r = handler(method, url, init) ?? [404, { error: { code: 404, message: `no route ${method} ${url}`, status: "NOT_FOUND" } }];
    return reply(...r);
  };
  return {
    fetch,
    calls,
    api: () => calls.filter((c) => c.url !== account.token_uri).map((c) => `${c.method} ${c.url.replace(API, "").replace(UPLOAD_API, "UP")}`),
  };
};
const reply = (status, body, headers = {}) => ({
  ok: status < 300,
  status,
  headers: { get: (n) => headers[n.toLowerCase()] ?? null },
  text: async () => (body === undefined ? "" : JSON.stringify(body)),
  json: async () => body,
});
const out = () => {
  const lines = [];
  return { lines, log: (l) => lines.push(String(l)) };
};
const aab = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p10-m8-play-"));
  const f = path.join(dir, "app.aab");
  fs.writeFileSync(f, Buffer.from("PK fake bundle"));
  return f;
};

test("service account JWT: RS256, Google's claims, signature verifies; the token exchange is a JWT-bearer grant", async () => {
  const jwt = makeServiceJwt({ clientEmail: account.client_email, privateKey: pem, aud: account.token_uri, now: 1_700_000_000_000 });
  const [h, p, s] = jwt.split(".");
  const dec = (x) => JSON.parse(Buffer.from(x, "base64url"));
  assert.deepEqual(dec(h), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(dec(p), {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: account.token_uri,
    iat: 1_700_000_000,
    exp: 1_700_003_600,
  });
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url")));
  const { fetch, calls } = mock(() => undefined);
  assert.equal(await accessToken({ account, fetch }), TOKEN);
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  assert.equal(form.get("assertion").split(".").length, 3);
  const bad = async () => reply(400, { error: "invalid_grant", error_description: "Invalid JWT Signature." });
  await assert.rejects(accessToken({ account, fetch: bad }), /Google OAuth 400: invalid_grant – Invalid JWT Signature/);
});

test("upload --dry-run: edit → bundle → notes only for listed languages → track → validate → delete (no commit)", async () => {
  const { fetch, calls, api } = mock((m, url) => {
    if (m === "POST" && url.endsWith("/applications/dev.rusuite.calc/edits")) return [200, { id: "E1", expiryTimeSeconds: "1700003600" }];
    if (m === "POST" && url.includes("/bundles?uploadType=media")) return [200, { versionCode: 4415000, sha256: "ab12" }];
    if (m === "GET" && url.endsWith("/edits/E1/listings")) return [200, { listings: [{ language: "en-US" }, { language: "de-DE" }] }];
    if (m === "PUT" && url.endsWith("/edits/E1/tracks/internal")) return [200, {}];
    if (m === "POST" && url.endsWith("/edits/E1:validate")) return [200, { id: "E1" }];
    if (m === "DELETE" && url.endsWith("/edits/E1")) return [204];
  });
  const { lines, log } = out();
  const code = await run(["upload", "--app", "calc", "--aab", aab(), "--track", "internal", "--dry-run"], { env, fetch, log, storeDir });
  assert.equal(code, 0);
  assert.deepEqual(api(), [
    "POST /applications/dev.rusuite.calc/edits",
    "POST UP/applications/dev.rusuite.calc/edits/E1/bundles?uploadType=media",
    "GET /applications/dev.rusuite.calc/edits/E1/listings",
    "PUT /applications/dev.rusuite.calc/edits/E1/tracks/internal",
    "POST /applications/dev.rusuite.calc/edits/E1:validate",
    "DELETE /applications/dev.rusuite.calc/edits/E1",
  ]);
  const upload = calls.find((c) => c.url.includes("uploadType=media"));
  assert.equal(upload.init.headers["content-type"], "application/octet-stream");
  assert.equal(upload.init.headers.authorization, `Bearer ${TOKEN}`);
  const track = JSON.parse(calls.find((c) => c.url.endsWith("/tracks/internal")).init.body);
  assert.deepEqual(track, {
    track: "internal",
    releases: [
      {
        versionCodes: ["4415000"],
        status: "completed",
        releaseNotes: [
          { language: "de-DE", text: "Apps für Handy und Tablet, Bearbeiten mit Touch." },
          { language: "en-US", text: "Phone and tablet apps, touch editing." },
        ],
      },
    ],
  });
  assert.ok(
    lines.some((l) => /release notes not sent .*cs-CZ/.test(l)),
    "languages without a listing are reported",
  );
  assert.ok(lines.some((l) => /dry run: edit E1 validated and deleted/.test(l)));
  assert.ok(!lines.join("\n").includes(TOKEN), "the access token is never logged");
});

test("upload to production with a staged rollout and commit; resumable upload; closed → alpha", async () => {
  const { fetch, calls, api } = mock((m, url) => {
    if (m === "POST" && url.endsWith("/edits")) return [200, { id: "E2" }];
    if (m === "POST" && url.includes("uploadType=resumable")) return [200, {}, { location: "https://upload.example.test/session/1" }];
    if (m === "PUT" && url === "https://upload.example.test/session/1") return [200, { versionCode: 4415001 }];
    if (url.endsWith("/listings")) return [200, {}];
    if (m === "PUT" && url.includes("/tracks/")) return [200, {}];
    if (m === "POST" && url.endsWith(":commit")) return [200, { id: "E2" }];
  });
  const { log } = out();
  await run(
    [
      "upload",
      "--app",
      "write",
      "--aab",
      aab(),
      "--track",
      "production",
      "--rollout",
      "0.1",
      "--resumable",
      "--notes",
      path.join(storeDir, "release-notes/de.txt"),
    ],
    { env, fetch, log, storeDir },
  );
  assert.deepEqual(api().slice(-2), ["PUT /applications/dev.rusuite.write/edits/E2/tracks/production", "POST /applications/dev.rusuite.write/edits/E2:commit"]);
  const start = calls.find((c) => c.url.includes("uploadType=resumable"));
  assert.equal(start.init.headers["x-upload-content-length"], String(Buffer.from("PK fake bundle").length));
  const body = JSON.parse(calls.find((c) => c.url.endsWith("/tracks/production")).init.body);
  // No listing languages yet (new app): only the en-US notes may be sent – the single de file is held back.
  assert.deepEqual(body.releases[0], { versionCodes: ["4415001"], status: "inProgress", userFraction: 0.1 });

  const m2 = mock((m, url) =>
    m === "POST" && url.endsWith("/edits") ? [200, { id: "E3" }] : url.includes("uploadType") ? [200, { versionCode: 7 }] : [200, {}],
  );
  await run(["upload", "--app", "show", "--aab", aab(), "--track", "closed", "--status", "draft", "--notes", "/nonexistent"], {
    env,
    fetch: m2.fetch,
    log,
    storeDir,
  });
  assert.ok(m2.api().includes("PUT /applications/dev.rusuite.show/edits/E3/tracks/alpha"));
  assert.deepEqual(JSON.parse(m2.calls.find((c) => c.url.endsWith("/tracks/alpha")).init.body).releases[0], { versionCodes: ["7"], status: "draft" });
});

test("option errors are found before any request; 5xx/429 are retried; 404 points to the checklist and the edit is deleted", async () => {
  const { fetch, calls } = mock(() => [200, {}]);
  const { log } = out();
  await assert.rejects(run(["upload", "--app", "calc", "--aab", aab(), "--track", "beta2"], { env, fetch, log, storeDir }), /--track must be one of/);
  await assert.rejects(
    run(["upload", "--app", "calc", "--aab", aab(), "--track", "production", "--rollout", "2"], { env, fetch, log, storeDir }),
    /--rollout must be a fraction/,
  );
  await assert.rejects(run(["upload", "--app", "excel", "--aab", "x", "--track", "internal"], { env, fetch, log, storeDir }), UsageError);
  await assert.rejects(run(["status"], { env: {}, fetch, log, storeDir }), /PLAY_SERVICE_ACCOUNT_JSON/);
  assert.equal(calls.length, 0);

  let n = 0;
  const sleeps = [];
  const flaky = mock((m, url) => {
    if (m === "POST" && url.endsWith("/edits"))
      return ++n < 3 ? [n === 1 ? 503 : 429, { error: { message: "busy" } }, { "retry-after": "2" }] : [200, { id: "E4" }];
    if (url.includes("uploadType=media"))
      return [403, { error: { code: 403, message: "APK specifies a version code that has already been used.", errors: [{ reason: "forbidden" }] } }];
    if (m === "DELETE") return [204];
  });
  await assert.rejects(
    run(["upload", "--app", "calc", "--aab", aab(), "--track", "internal"], { env, fetch: flaky.fetch, log, storeDir, sleep: async (ms) => sleeps.push(ms) }),
    (e) => e instanceof PlayError && e.status === 403 && /already been used.*bump the version/.test(e.message) && !/checklist/.test(e.message),
  );
  assert.deepEqual(sleeps, [2000, 2000]);
  assert.equal(flaky.api().at(-1), "DELETE /applications/dev.rusuite.calc/edits/E4", "the failed edit is cleaned up");
  assert.throws(() => releaseBody({ track: "production", versionCode: 1, rollout: "0.5", status: "completed", notes: [] }), /needs --status inProgress/);
});

test("listing push: texts per Play language, ga reported, images replaced for en-US and de-DE only (own)", async () => {
  const { fetch, calls, api } = mock((m, url) => {
    if (m === "POST" && url.endsWith("/edits")) return [200, { id: "L1" }];
    return [200, {}];
  });
  const { lines, log } = out();
  await run(["listing", "push", "--app", "calc"], { env, fetch, log, storeDir });
  const listings = calls.filter((c) => c.method === "PUT" && c.url.includes("/listings/"));
  assert.deepEqual(
    listings.map((c) => c.url.split("/").at(-1)),
    ["de-DE", "en-US"],
  );
  assert.deepEqual(JSON.parse(listings[1].init.body), {
    language: "en-US",
    title: "Rusuite Calc",
    shortDescription: "Spreadsheets that open and save Excel files. Free, offline, no account.",
    fullDescription: "Rusuite Calc opens and saves .xlsx files on your device.",
  });
  assert.ok(lines.some((l) => l === "not sent (no Play listing language): ga, mt"));
  const img = api().filter((k) => /listings\/[a-zA-Z-]+\/\w+/.test(k));
  assert.deepEqual(img, [
    "DELETE /applications/dev.rusuite.calc/edits/L1/listings/de-DE/phoneScreenshots",
    "POST UP/applications/dev.rusuite.calc/edits/L1/listings/de-DE/phoneScreenshots?uploadType=media",
    "DELETE /applications/dev.rusuite.calc/edits/L1/listings/en-US/icon",
    "POST UP/applications/dev.rusuite.calc/edits/L1/listings/en-US/icon?uploadType=media",
    "DELETE /applications/dev.rusuite.calc/edits/L1/listings/en-US/featureGraphic",
    "POST UP/applications/dev.rusuite.calc/edits/L1/listings/en-US/featureGraphic?uploadType=media",
    "DELETE /applications/dev.rusuite.calc/edits/L1/listings/en-US/phoneScreenshots",
    "POST UP/applications/dev.rusuite.calc/edits/L1/listings/en-US/phoneScreenshots?uploadType=media",
    "POST UP/applications/dev.rusuite.calc/edits/L1/listings/en-US/phoneScreenshots?uploadType=media",
    "DELETE /applications/dev.rusuite.calc/edits/L1/listings/en-US/sevenInchScreenshots",
    "POST UP/applications/dev.rusuite.calc/edits/L1/listings/en-US/sevenInchScreenshots?uploadType=media",
    "DELETE /applications/dev.rusuite.calc/edits/L1/listings/en-US/tenInchScreenshots",
    "POST UP/applications/dev.rusuite.calc/edits/L1/listings/en-US/tenInchScreenshots?uploadType=media",
  ]);
  assert.equal(calls.find((c) => c.url.includes("/icon?")).init.headers["content-type"], "image/png");
  assert.equal(api().at(-1), "POST /applications/dev.rusuite.calc/edits/L1:commit");

  const sub = mock((m, url) => (m === "POST" && url.endsWith("/edits") ? [200, { id: "L2" }] : [200, {}]));
  await run(["listing", "push", "--app", "calc", "--langs", "de", "--images", "none", "--dry-run"], { env, fetch: sub.fetch, log, storeDir });
  assert.deepEqual(sub.api(), [
    "POST /applications/dev.rusuite.calc/edits",
    "PUT /applications/dev.rusuite.calc/edits/L2/listings/de-DE",
    "POST /applications/dev.rusuite.calc/edits/L2:validate",
    "DELETE /applications/dev.rusuite.calc/edits/L2",
  ]);
});

test("status and validate", async () => {
  const { fetch } = mock((m, url) => {
    if (m === "POST" && url.endsWith("/dev.rusuite.calc/edits")) return [200, { id: "S1" }];
    if (m === "POST" && url.endsWith("/dev.rusuite.write/edits")) return [200, { id: "S2" }];
    if (m === "POST" && url.endsWith("/dev.rusuite.show/edits"))
      return [404, { error: { code: 404, message: "Package not found: dev.rusuite.show.", status: "NOT_FOUND" } }];
    if (url.endsWith("/S1/tracks"))
      return [
        200,
        {
          tracks: [
            { track: "internal", releases: [{ name: "3.1415.0", status: "completed", versionCodes: ["4415000"] }] },
            { track: "production", releases: [] },
          ],
        },
      ];
    if (url.endsWith("/S1/bundles")) return [200, { bundles: [{ versionCode: 4415000 }, { versionCode: 3141000 }] }];
    if (m === "DELETE") return [204];
  });
  const { lines, log } = out();
  await run(["status", "--app", "calc"], { env, fetch, log, storeDir });
  assert.deepEqual(lines.splice(0), [
    "dev.rusuite.calc: latest uploaded versionCode 4415000",
    "  internal: 3.1415.0 – completed – versionCodes 4415000",
    "  production: no release",
    "  review state: not exposed by the API – Play Console › Publishing overview",
  ]);
  assert.equal(await run(["validate"], { env, fetch, log, storeDir }), 1);
  assert.equal(lines[0], `service account: ${account.client_email}`);
  assert.equal(lines[1], "ok      dev.rusuite.calc (Rusuite Calc)");
  assert.match(lines[3], /^MISSING dev\.rusuite\.show \(Rusuite Show\): HTTP 404 – .*checklist-play\.md/);
  assert.equal(lines[4], "2/3 apps visible");
});

test("notesFor: directory with en fallback for every Play language, length limit", () => {
  const notes = notesFor(path.join(storeDir, "release-notes"));
  assert.equal(notes.length, 22, "24 languages minus ga and mt");
  assert.equal(notes.find((n) => n.language === "fr-FR").text, "Phone and tablet apps, touch editing.");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p10-m8-notes-"));
  fs.writeFileSync(path.join(dir, "en.txt"), "x".repeat(501));
  assert.throws(() => notesFor(dir), /501 characters \(Play allows 500\)/);
  assert.deepEqual(notesFor(path.join(dir, "missing")), []);
});

test("--help prints the usage without credentials", async () => {
  const { lines, log } = out();
  assert.equal(await run(["--help"], { env: {}, log }), 0);
  assert.match(lines[0], /^usage: node scripts\/store\/play\.mjs/);
});
