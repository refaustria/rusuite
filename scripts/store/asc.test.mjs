// Tests of the App Store publisher (P10-M8) with a throwaway P-256 key and a mocked fetch – Apple is never called:
// `node --test scripts/store/*.test.mjs`.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AGE_RATING, run, sameVersion } from "./asc.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const storeDir = path.join(here, "testdata/store");
const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), "p10-m8-asc-"));
fs.writeFileSync(path.join(keyDir, "AuthKey_TEST.p8"), privateKey.export({ type: "pkcs8", format: "pem" }));
const env = { ASC_KEY_ID: "TESTKEY123", ASC_ISSUER_ID: "issuer-1", ASC_KEY_PATH: path.join(keyDir, "AuthKey_TEST.p8") };
const API = "https://api.appstoreconnect.apple.com/v1";

const reply = (status, body) => ({
  ok: status < 300,
  status,
  headers: { get: () => null },
  text: async () => (body === undefined ? "" : JSON.stringify(body)),
});
/** Mocked fetch: `routes(key, body)` with key "METHOD /path?query" (API paths without /v1) or "METHOD <url>" otherwise. */
const mock = (routes) => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const key = `${init.method} ${url.startsWith(API) ? url.slice(API.length) : url}`;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ key, body, init });
    const r = routes(key, body) ?? [404, { errors: [{ status: "404", code: "NOT_FOUND", title: "no route", detail: key }] }];
    return reply(...r);
  };
  return { fetch, calls, keys: () => calls.map((c) => c.key) };
};
const out = () => {
  const lines = [];
  return { lines, log: (l) => lines.push(String(l)) };
};
const APP = [
  200,
  { data: [{ id: "APP1", type: "apps", attributes: { bundleId: "dev.rusuite.calc", name: "Rusuite Calc", sku: "rusuite-calc", primaryLocale: "en-US" } }] },
];
const VERSION = [
  200,
  { data: [{ id: "V1", type: "appStoreVersions", attributes: { versionString: "3.1415", appStoreState: "PREPARE_FOR_SUBMISSION", platform: "IOS" } }] },
];
const base = (key) => {
  if (key === "GET /apps?filter[bundleId]=dev.rusuite.calc&limit=200") return APP;
  if (key === "GET /apps/APP1/appStoreVersions?filter[platform]=IOS&filter[versionString]=3.1415&limit=200") return VERSION;
};
const opts = (fetch, log) => ({ env, fetch, log, storeDir, sleep: async () => {} });

test("apps list, app info", async () => {
  const { fetch } = mock((key) => {
    if (key === "GET /apps?limit=200") return APP;
    if (key === "GET /apps/APP1/appInfos") return [200, { data: [{ id: "I1", attributes: { state: "PREPARE_FOR_SUBMISSION" } }] }];
    if (key === "GET /apps/APP1/appStoreVersions?filter[platform]=IOS&limit=200") return VERSION;
    return base(key);
  });
  const { lines, log } = out();
  await run(["apps", "list"], opts(fetch, log));
  await run(["app", "info", "--bundle-id", "dev.rusuite.calc"], opts(fetch, log));
  assert.deepEqual(lines, [
    "APP1\tdev.rusuite.calc\tRusuite Calc\tsku rusuite-calc\ten-US",
    "app APP1: Rusuite Calc (dev.rusuite.calc), sku rusuite-calc, primary locale en-US",
    "  appInfo I1: PREPARE_FOR_SUBMISSION",
    "  version 3.1415: PREPARE_FOR_SUBMISSION (V1)",
  ]);
  const none = mock(() => [200, { data: [] }]);
  await assert.rejects(run(["app", "info", "--app", "write"], opts(none.fetch, log)), /no app with bundle id dev\.rusuite\.write .*checklist-appstore\.md/);
});

test("app-info push: localizations (update + create), unsupported locales reported, categories, age rating drops unknown fields", async () => {
  let ageTries = 0;
  const { calls, fetch } = mock((key, body) => {
    if (key === "GET /apps/APP1/appInfos")
      return [
        200,
        {
          data: [
            { id: "LIVE", attributes: { state: "READY_FOR_DISTRIBUTION" } },
            { id: "I1", attributes: { state: "PREPARE_FOR_SUBMISSION" } },
          ],
        },
      ];
    if (key === "GET /appInfos/I1/appInfoLocalizations?limit=200") return [200, { data: [{ id: "AIL-en", attributes: { locale: "en-US" } }] }];
    if (key === "PATCH /appInfoLocalizations/AIL-en") return [200, { data: {} }];
    if (key === "POST /appInfoLocalizations") return [201, { data: { id: "AIL-de" } }];
    if (key === "PATCH /appInfos/I1") return [200, { data: {} }];
    if (key === "GET /appInfos/I1/ageRatingDeclaration") return [200, { data: { id: "AR1" } }];
    if (key === "PATCH /ageRatingDeclarations/AR1") {
      ageTries++;
      if ("ageAssurance" in body.data.attributes) {
        return [
          409,
          {
            errors: [
              { code: "ENTITY_ERROR.ATTRIBUTE.UNKNOWN", title: "unknown attribute", source: { pointer: "/data/attributes/ageAssurance" } },
              { code: "ENTITY_ERROR.ATTRIBUTE.UNKNOWN", source: { pointer: "/data/attributes/parentalControls" } },
            ],
          },
        ];
      }
      return [200, { data: {} }];
    }
    return base(key);
  });
  const { lines, log } = out();
  assert.equal(await run(["app-info", "push", "--app", "calc"], opts(fetch, log)), 0);
  assert.equal(lines[0], "not sent (no App Store localization): bg, et, ga, lt, lv, mt");
  assert.match(lines[1], /^not sent \(no docs\/store\/listing\/<lang>\.json entry\): cs, da, el, es/);
  const post = calls.find((c) => c.key === "POST /appInfoLocalizations").body;
  assert.deepEqual(post, {
    data: {
      type: "appInfoLocalizations",
      attributes: { locale: "de-DE", name: "Rusuite Calc", subtitle: "Tabellen offline", privacyPolicyUrl: "https://rusuit.es/privacy.html" },
      relationships: { appInfo: { data: { type: "appInfos", id: "I1" } } },
    },
  });
  assert.deepEqual(calls.find((c) => c.key === "PATCH /appInfoLocalizations/AIL-en").body.data.attributes, {
    name: "Rusuite Calc",
    subtitle: "Offline spreadsheets",
    privacyPolicyUrl: "https://rusuit.es/privacy.html",
  });
  assert.deepEqual(calls.find((c) => c.key === "PATCH /appInfos/I1").body.data.relationships, {
    primaryCategory: { data: { type: "appCategories", id: "PRODUCTIVITY" } },
    secondaryCategory: { data: { type: "appCategories", id: "BUSINESS" } },
  });
  assert.equal(ageTries, 2);
  const sent = calls.filter((c) => c.key === "PATCH /ageRatingDeclarations/AR1").at(-1).body.data.attributes;
  assert.equal(sent.violenceRealistic, "NONE");
  assert.equal(sent.unrestrictedWebAccess, false);
  assert.ok(!("ageAssurance" in sent) && !("parentalControls" in sent));
  assert.equal(Object.keys(sent).length, Object.keys(AGE_RATING).length - 2);
  assert.ok(lines.some((l) => /refused ageAssurance, parentalControls/.test(l)));
  assert.equal(lines.at(-1), "age rating declaration: nothing applies (4+)");
});

test("version ensure: get the existing record or create it with release type MANUAL", async () => {
  const exists = mock(base);
  const { lines, log } = out();
  await run(["version", "ensure", "--app", "calc", "--version", "3.1415"], opts(exists.fetch, log));
  assert.equal(lines.at(-1), "version 3.1415 exists: V1 (PREPARE_FOR_SUBMISSION)");
  const create = mock((key) => {
    if (key.startsWith("GET /apps/APP1/appStoreVersions")) return [200, { data: [] }];
    if (key === "POST /appStoreVersions") return [201, { data: { id: "V2", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" } } }];
    return base(key);
  });
  await run(["version", "ensure", "--app", "calc", "--version", "3.1415"], opts(create.fetch, log));
  assert.deepEqual(create.calls.at(-1).body, {
    data: {
      type: "appStoreVersions",
      attributes: { platform: "IOS", versionString: "3.1415", releaseType: "MANUAL" },
      relationships: { app: { data: { type: "apps", id: "APP1" } } },
    },
  });
  assert.equal(lines.at(-1), "version 3.1415 created: V2 (PREPARE_FOR_SUBMISSION, release MANUAL)");
});

test("version push: texts per locale (whatsNew dropped when refused), screenshot sets reserved → uploaded in chunks → committed with md5", async () => {
  const uploads = [];
  const { calls, fetch } = mock((key, body) => {
    if (key === "GET /appStoreVersions/V1/appStoreVersionLocalizations?limit=200") return [200, { data: [{ id: "L-en", attributes: { locale: "en-US" } }] }];
    if (key === "PATCH /appStoreVersionLocalizations/L-en") {
      if (body.data.attributes.whatsNew)
        return [
          409,
          {
            errors: [
              {
                code: "ENTITY_ERROR.ATTRIBUTE.INVALID",
                title: "An attribute value is not acceptable for the current resource state.",
                source: { pointer: "/data/attributes/whatsNew" },
              },
            ],
          },
        ];
      return [200, { data: { id: "L-en" } }];
    }
    if (key === "POST /appStoreVersionLocalizations") return [201, { data: { id: "L-de", attributes: { locale: body.data.attributes.locale } } }];
    if (key === "GET /appStoreVersionLocalizations/L-en/appScreenshotSets")
      return [200, { data: [{ id: "SET-67", attributes: { screenshotDisplayType: "APP_IPHONE_67" } }] }];
    if (key === "GET /appStoreVersionLocalizations/L-de/appScreenshotSets") return [200, { data: [] }];
    if (key === "GET /appScreenshotSets/SET-67/appScreenshots") return [200, { data: [{ id: "OLD1" }] }];
    if (key === "DELETE /appScreenshots/OLD1") return [204];
    if (key === "POST /appScreenshotSets") return [201, { data: { id: `SET-${body.data.attributes.screenshotDisplayType}` } }];
    if (key === "POST /appScreenshots") {
      const size = body.data.attributes.fileSize;
      const half = Math.floor(size / 2);
      return [
        201,
        {
          data: {
            id: `SHOT${calls.length}`,
            attributes: {
              uploadOperations: [
                {
                  method: "PUT",
                  url: "https://upload.example.test/a",
                  offset: 0,
                  length: half,
                  requestHeaders: [{ name: "Content-Type", value: "image/png" }],
                },
                {
                  method: "PUT",
                  url: "https://upload.example.test/b",
                  offset: half,
                  length: size - half,
                  requestHeaders: [{ name: "Content-Type", value: "image/png" }],
                },
              ],
            },
          },
        },
      ];
    }
    if (key.startsWith("PUT https://upload.example.test/")) {
      uploads.push(key);
      return [200];
    }
    if (/^PATCH \/appScreenshots\/SHOT\d+$/.test(key)) return [200, { data: {} }];
    if (/^GET \/appScreenshots\/SHOT\d+$/.test(key)) return [200, { data: { attributes: { assetDeliveryState: { state: "COMPLETE" } } } }];
    return base(key);
  });
  const { lines, log } = out();
  assert.equal(await run(["version", "push", "--app", "calc", "--version", "3.1415", "--langs", "en,de,bg"], opts(fetch, log)), 0);
  const en = calls.filter((c) => c.key === "PATCH /appStoreVersionLocalizations/L-en");
  assert.equal(en.length, 2);
  assert.deepEqual(en[1].body.data.attributes, {
    description: "Rusuite Calc opens and saves .xlsx files on your device.",
    keywords: "spreadsheet,excel,xlsx,office,offline,open source",
    promotionalText: "Free and open source.",
    supportUrl: "https://rusuit.es/",
    marketingUrl: "https://rusuit.es/",
  });
  assert.equal(calls.find((c) => c.key === "POST /appStoreVersionLocalizations").body.data.attributes.whatsNew, "Apps für Handy und Tablet.");
  // en: the 6.7" set exists (old screenshot deleted), iPad sets are created; phone-65 has a wrong size → skipped.
  assert.ok(calls.some((c) => c.key === "DELETE /appScreenshots/OLD1"));
  const sets = calls.filter((c) => c.key === "POST /appScreenshotSets").map((c) => c.body.data.attributes.screenshotDisplayType);
  assert.deepEqual(sets, ["APP_IPAD_PRO_3GEN_129", "APP_IPAD_PRO_129", "APP_IPHONE_67"], 'en: two iPad sets; de: its own 6.7" set');
  assert.ok(lines.some((l) => /phone-65\/en\/1-sheet\.png is 1080×2340 – not a APP_IPHONE_65 size/.test(l)));
  assert.equal(uploads.length, 8, "4 screenshots × 2 parts");
  const shot = path.join(storeDir, "screenshots/calc/phone-67/en/1-sheet.png");
  const commit = calls.find((c) => /^PATCH \/appScreenshots\//.test(c.key)).body.data.attributes;
  assert.deepEqual(commit, { uploaded: true, sourceFileChecksum: crypto.createHash("md5").update(fs.readFileSync(shot)).digest("hex") });
  const part = calls.find((c) => c.key === "PUT https://upload.example.test/a");
  assert.equal(part.init.headers["Content-Type"], "image/png");
  assert.equal(part.init.headers.authorization, undefined, "the upload URLs never get the bearer token");
  assert.deepEqual(
    lines.filter((l) => /^(en-US|de-DE):/.test(l)),
    ["en-US: texts, APP_IPHONE_67 ×1, APP_IPAD_PRO_3GEN_129 ×1, APP_IPAD_PRO_129 ×1", "de-DE: texts, APP_IPHONE_67 ×1"],
  );
  assert.equal(lines[0], "not sent (no App Store localization): bg");
});

test("version push: a refused locale is reported and the others go on (exit 1)", async () => {
  const { fetch } = mock((key) => {
    if (key === "GET /appStoreVersions/V1/appStoreVersionLocalizations?limit=200") return [200, { data: [] }];
    if (key === "POST /appStoreVersionLocalizations")
      return [409, { errors: [{ code: "ENTITY_ERROR.ATTRIBUTE.INVALID", title: "invalid locale", source: { pointer: "/data/attributes/locale" } }] }];
    return base(key);
  });
  const { lines, log } = out();
  assert.equal(await run(["version", "push", "--app", "calc", "--version", "3.1415", "--langs", "en,de", "--images", "none"], opts(fetch, log)), 1);
  assert.equal(lines.at(-1), "2 locale(s) failed: en-US, de-DE");
});

test("build attach: polls until VALID, checks the version train, sets the relationship", async () => {
  const states = ["PROCESSING", "PROCESSING", "VALID"];
  let polls = 0;
  const sleeps = [];
  const { calls, fetch } = mock((key) => {
    if (key === "GET /builds?filter[app]=APP1&filter[version]=4415000&limit=1&include=preReleaseVersion") {
      const st = polls === 0 ? null : states[polls - 1];
      polls++;
      if (!st) return [200, { data: [] }];
      return [
        200,
        {
          data: [{ id: "B1", attributes: { version: "4415000", processingState: st }, relationships: { preReleaseVersion: { data: { id: "PRV1" } } } }],
          included: [{ type: "preReleaseVersions", id: "PRV1", attributes: { version: "3.1415.0" } }],
        },
      ];
    }
    if (key === "PATCH /appStoreVersions/V1/relationships/build") return [204];
    return base(key);
  });
  const { lines, log } = out();
  await run(["build", "attach", "--app", "calc", "--version", "3.1415", "--build", "4415000", "--interval", "5"], {
    ...opts(fetch, log),
    sleep: async (ms) => sleeps.push(ms),
  });
  assert.equal(polls, 4);
  assert.deepEqual(sleeps, [5000, 5000, 5000]);
  assert.deepEqual(lines.slice(0, 2), ["build 4415000: not visible yet – waiting 5 s", "build 4415000: PROCESSING – waiting 5 s"]);
  assert.deepEqual(calls.at(-1).body, { data: { type: "builds", id: "B1" } });
  assert.equal(lines.at(-1), "build 4415000 (B1, 3.1415.0) attached to version 3.1415");

  const failed = mock((key) =>
    key.startsWith("GET /builds") ? [200, { data: [{ id: "B2", attributes: { version: "9", processingState: "INVALID" } }] }] : base(key),
  );
  await assert.rejects(run(["build", "attach", "--app", "calc", "--version", "3.1415", "--build", "latest"], opts(failed.fetch, log)), /build 9 is INVALID/);
  const slow = mock((key) => (key.startsWith("GET /builds") ? [200, { data: [] }] : base(key)));
  await assert.rejects(
    run(["build", "attach", "--app", "calc", "--version", "3.1415", "--build", "1", "--timeout", "1", "--interval", "30"], opts(slow.fetch, log)),
    /not processed after 1 min \(not uploaded yet\)/,
  );
  assert.equal(slow.keys().filter((k) => k.startsWith("GET /builds")).length, 2);
  const other = mock((key) =>
    key.startsWith("GET /builds")
      ? [
          200,
          {
            data: [{ id: "B3", attributes: { version: "3141000", processingState: "VALID" } }],
            included: [{ type: "preReleaseVersions", id: "P", attributes: { version: "3.141.0" } }],
          },
        ]
      : base(key),
  );
  await assert.rejects(
    run(["build", "attach", "--app", "calc", "--version", "3.1415", "--build", "latest"], opts(other.fetch, log)),
    /belongs to version 3\.141\.0, not 3\.1415/,
  );
  assert.ok(sameVersion("3.1415.0", "3.1415") && !sameVersion("3.141.0", "3.1415"));
});

test("build export-compliance, review notes, testflight groups/add", async () => {
  const { calls, fetch } = mock((key) => {
    if (key === "GET /builds?filter[app]=APP1&filter[version]=4415000&limit=1&include=preReleaseVersion")
      return [200, { data: [{ id: "B1", attributes: { version: "4415000" } }] }];
    if (key === "PATCH /builds/B1") return [200, { data: {} }];
    if (key === "GET /appStoreVersions/V1/appStoreReviewDetail") return [200, { data: null }];
    if (key === "POST /appStoreReviewDetails") return [201, { data: { id: "R1" } }];
    if (key === "GET /apps/APP1/betaGroups?limit=200")
      return [200, { data: [{ id: "4b0c1c2e-0000-4000-8000-000000000001", attributes: { name: "Internal", isInternalGroup: true } }] }];
    if (key === "POST /betaGroups/4b0c1c2e-0000-4000-8000-000000000001/relationships/builds") return [204];
    return base(key);
  });
  const { lines, log } = out();
  await run(["build", "export-compliance", "--app", "calc", "--build", "4415000"], opts(fetch, log));
  assert.deepEqual(calls.find((c) => c.key === "PATCH /builds/B1").body, {
    data: { type: "builds", id: "B1", attributes: { usesNonExemptEncryption: false } },
  });
  await run(
    [
      "review",
      "notes",
      "--app",
      "calc",
      "--version",
      "3.1415",
      "--file",
      path.join(storeDir, "review-notes.txt"),
      "--contact-first",
      "Ada",
      "--contact-last",
      "Lovelace",
    ],
    {
      ...opts(fetch, log),
      env: { ...env, ASC_REVIEW_EMAIL: "review@example.test", ASC_REVIEW_PHONE: "+43 1 000000" },
    },
  );
  assert.deepEqual(calls.find((c) => c.key === "POST /appStoreReviewDetails").body, {
    data: {
      type: "appStoreReviewDetails",
      attributes: {
        contactFirstName: "Ada",
        contactLastName: "Lovelace",
        contactEmail: "review@example.test",
        contactPhone: "+43 1 000000",
        demoAccountRequired: false,
        notes: "Rusuite Calc opens .xlsx files. No account needed, no data collected.",
      },
      relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: "V1" } } },
    },
  });
  await run(["testflight", "groups", "--app", "calc"], opts(fetch, log));
  await run(["testflight", "add", "--app", "calc", "--group", "Internal", "--build", "4415000"], opts(fetch, log));
  assert.deepEqual(calls.at(-1).body, { data: [{ type: "builds", id: "B1" }] });
  assert.deepEqual(lines.slice(-3), [
    "review details created for version 3.1415 (69 characters of notes, no demo account)",
    "4b0c1c2e-0000-4000-8000-000000000001\tInternal\tinternal",
    "build B1 added to TestFlight group Internal",
  ]);
  await assert.rejects(run(["testflight", "add", "--group", "Internal", "--build", "B1"], opts(fetch, log)), /--app is required when --group is a name/);
});

test("submit: shows the state and changes nothing without --yes; with --yes creates the submission, adds the version, submits", async () => {
  const routes = (key) => {
    if (key === "GET /appStoreVersions/V1/build") return [200, { data: { id: "B1", attributes: { version: "4415000" } } }];
    if (key === "GET /appStoreVersions/V1/appStoreVersionLocalizations?limit=200")
      return [200, { data: [{ attributes: { locale: "en-US" } }, { attributes: { locale: "de-DE" } }] }];
    if (key === "GET /appStoreVersions/V1/appStoreReviewDetail") return [200, { data: { id: "R1" } }];
    if (key === "GET /reviewSubmissions?filter[app]=APP1&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW") return [200, { data: [] }];
    if (key === "POST /reviewSubmissions") return [201, { data: { id: "RS1" } }];
    if (key === "POST /reviewSubmissionItems") return [201, { data: { id: "RSI1" } }];
    if (key === "PATCH /reviewSubmissions/RS1") return [200, { data: { id: "RS1", attributes: { state: "WAITING_FOR_REVIEW" } } }];
    return base(key);
  };
  const dry = mock(routes);
  const { lines, log } = out();
  await run(["submit", "--app", "calc", "--version", "3.1415"], opts(dry.fetch, log));
  assert.ok(
    dry.calls.every((c) => c.key.startsWith("GET ")),
    "no write without --yes",
  );
  assert.deepEqual(lines.splice(0), [
    "Rusuite Calc 3.1415: PREPARE_FOR_SUBMISSION",
    "  build: 4415000 (B1)",
    "  localizations: en-US, de-DE",
    "  review details: set",
    "not submitted – run again with --yes to submit this version for App Review",
  ]);
  const real = mock(routes);
  await run(["submit", "--app", "calc", "--version", "3.1415", "--yes"], opts(real.fetch, log));
  assert.deepEqual(
    real.keys().filter((k) => !k.startsWith("GET ")),
    ["POST /reviewSubmissions", "POST /reviewSubmissionItems", "PATCH /reviewSubmissions/RS1"],
  );
  assert.deepEqual(real.calls.find((c) => c.key === "POST /reviewSubmissionItems").body.data.relationships, {
    reviewSubmission: { data: { type: "reviewSubmissions", id: "RS1" } },
    appStoreVersion: { data: { type: "appStoreVersions", id: "V1" } },
  });
  assert.deepEqual(real.calls.at(-1).body, { data: { type: "reviewSubmissions", id: "RS1", attributes: { submitted: true } } });
  assert.equal(lines.at(-1), "review submission RS1: WAITING_FOR_REVIEW");
});

test("--help without credentials; missing env; the bearer token is never logged", async () => {
  const { lines, log } = out();
  assert.equal(await run(["--help"], { env: {}, log }), 0);
  assert.match(lines[0], /^usage: node scripts\/store\/asc\.mjs/);
  await assert.rejects(run(["apps", "list"], { env: {}, log }), /ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH/);
  const { calls, fetch } = mock((key) => (key === "GET /apps?limit=200" ? APP : undefined));
  await run(["apps", "list"], opts(fetch, log));
  const jwt = calls[0].init.headers.authorization.slice(7);
  assert.ok(!lines.join("\n").includes(jwt));
});
