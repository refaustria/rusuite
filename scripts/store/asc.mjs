#!/usr/bin/env node
// App Store publishing (P10-M8, docs/store/README.md): app metadata, localizations, screenshots, TestFlight builds,
// review details and the review submission through the App Store Connect API. Builds on the JWT/request core of
// scripts/signing/asc.mjs (whose CLI stays as it is); Node only, no dependencies.
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (as scripts/signing/asc.mjs). Nothing secret is printed.
import fs from "node:fs";
import path from "node:path";
import { AscError, client, makeJwt } from "../signing/asc.mjs";
import { ASC_LOCALES, STORE_DIR, UsageError, appOf, isMain, langsOf, loadListings, md5, parseArgs, pngSize, retryingFetch, screenshots } from "./lib.mjs";

export const USAGE = `usage: node scripts/store/asc.mjs <command> [options]

  apps list                                       every app of the account (id, bundle id, sku, primary locale)
  app info --bundle-id dev.rusuite.calc | --app calc
  app-info push --app calc [--langs en,de]        name/subtitle/privacy policy URL per locale, categories
                                                  Productivity + Business, age rating declaration (all "none")
  version ensure --app calc --version 3.1415      create or get the iOS App Store version (release type MANUAL)
  version push --app calc --version 3.1415 [--langs en,de] [--images own|all|none]
                                                  description, keywords, whatsNew, promotionalText, support and
                                                  marketing URL per locale; screenshots (iPhone 6.7"/6.5",
                                                  iPad Pro 12.9") from docs/store/screenshots/<app>/
  build attach --app calc --version 3.1415 --build <number>|latest [--timeout <minutes>] [--interval <seconds>]
                                                  wait until the build is processed (VALID), attach it
  build export-compliance --build <id> | --app calc --build <number>
                                                  usesNonExemptEncryption = false
  review notes --app calc --file docs/store/review-notes.txt [--version 3.1415]
         [--contact-first … --contact-last … --contact-email … --contact-phone …]
                                                  review contact (or ASC_REVIEW_FIRST_NAME, ASC_REVIEW_LAST_NAME,
                                                  ASC_REVIEW_EMAIL, ASC_REVIEW_PHONE) and notes; no demo account
  submit --app calc --version 3.1415 [--yes]      shows what would be submitted; submits for review only with --yes
  testflight groups --app calc
  testflight add --group "Internal" --build <id> | --app calc --group "Internal" --build <number>

--images own (default): en-US and every locale with its own screenshot folder (the App Store shows the primary
locale's screenshots elsewhere); all: the en screenshots for every locale. Env: ASC_KEY_ID, ASC_ISSUER_ID,
ASC_KEY_PATH. Checklist: docs/store/checklist-appstore.md.`;

export const PRIVACY_URL = "https://rusuit.es/privacy.html";
export const SUPPORT_URL = "https://rusuit.es/";
export const MARKETING_URL = "https://rusuit.es/";
export const CATEGORIES = { primary: "PRODUCTIVITY", secondary: "BUSINESS" };
/** The age rating questionnaire for a productivity app: nothing applies (→ 4+). */
export const AGE_RATING = {
  alcoholTobaccoOrDrugUseOrReferences: "NONE",
  contests: "NONE",
  gamblingSimulated: "NONE",
  horrorOrFearThemes: "NONE",
  matureOrSuggestiveThemes: "NONE",
  medicalOrTreatmentInformation: "NONE",
  profanityOrCrudeHumor: "NONE",
  sexualContentGraphicAndNudity: "NONE",
  sexualContentOrNudity: "NONE",
  violenceCartoonOrFantasy: "NONE",
  violenceRealistic: "NONE",
  violenceRealisticProlongedGraphicOrSadistic: "NONE",
  gunsOrOtherWeapons: "NONE",
  gambling: false,
  lootBox: false,
  unrestrictedWebAccess: false,
  messagingAndChat: false,
  userGeneratedContent: false,
  advertising: false,
  parentalControls: false,
  ageAssurance: false,
  healthOrWellnessTopics: false,
  kidsAgeBand: null,
};
/** docs/store screenshot folders (P10-M7) → App Store display types and the pixel sizes Apple accepts for them. */
export const SCREENSHOT_SETS = [
  { form: "phone-67", type: "APP_IPHONE_67", sizes: ["1290x2796", "1320x2868", "2796x1290", "2868x1320"] },
  { form: "phone-65", type: "APP_IPHONE_65", sizes: ["1242x2688", "1284x2778", "2688x1242", "2778x1284"] },
  { form: "tablet-10", type: "APP_IPAD_PRO_3GEN_129", sizes: ["2048x2732", "2732x2048"] },
  { form: "tablet-10", type: "APP_IPAD_PRO_129", sizes: ["2048x2732", "2732x2048"] },
];
export const LIMITS = { name: 30, subtitle: 30, description: 4000, keywords: 100, promotionalText: 170, whatsNew: 4000, notes: 4000, screenshots: 10 };
const EDITABLE = ["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"];
const CHECKLIST = "docs/store/checklist-appstore.md";

/** "3.1415.0" and "3.1415" name the same version train. */
export const sameVersion = (a, b) => String(a).replace(/(\.0)+$/, "") === String(b).replace(/(\.0)+$/, "");

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stateOf = (v) => v?.attributes?.appVersionState ?? v?.attributes?.appStoreState;

function checkLengths(what, attrs) {
  const bad = Object.entries(attrs).filter(([k, v]) => typeof v === "string" && LIMITS[k] && v.length > LIMITS[k]);
  if (bad.length) throw new UsageError(`${what}: ${bad.map(([k, v]) => `${k} ${v.length} > ${LIMITS[k]}`).join(", ")}`);
}

/** The App Store layer over the signing client (`request`). `http` is the raw (retrying) fetch for upload URLs. */
export function storeApi({ request, http, log, sleep = defaultSleep }) {
  const list = async (p) => {
    const out = [];
    let next = p;
    while (next) {
      const page = await request("GET", next);
      out.push(...(page?.data ?? []));
      const link = page?.links?.next;
      next = link ? link.replace(/^https:\/\/api\.appstoreconnect\.apple\.com\/v1/, "") : null;
      if (next && /^https?:/.test(next)) next = null; // never follow a link to another host
    }
    return out;
  };

  /**
   * POST/PATCH that drops attributes Apple refuses (unknown in this API version, or not editable – e.g. whatsNew
   * on an app's first version) and sends the rest again. `droppable`: attribute names, or "*".
   */
  const sendDropping = async (method, p, body, droppable) => {
    const attrs = body.data.attributes;
    for (;;) {
      try {
        return await request(method, p, body);
      } catch (e) {
        if (!(e instanceof AscError) || ![400, 409, 422].includes(e.status)) throw e;
        const refused = e.errors.map((x) => /^\/data\/attributes\/(\w+)/.exec(x.source?.pointer ?? "")?.[1]).filter((k) => k && k in attrs);
        const drop = refused.filter((k) => droppable === "*" || droppable.includes(k));
        if (!drop.length || drop.length < refused.length) throw e;
        for (const k of drop) delete attrs[k];
        log(`notice: App Store Connect refused ${drop.join(", ")} (${e.errors[0]?.code ?? e.status}) – sent without`);
      }
    }
  };

  const api = {
    list,
    sendDropping,
    async findApp(bundleId) {
      const found = await list(`/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=200`);
      const app = found.find((a) => a.attributes?.bundleId === bundleId);
      if (!app) throw new Error(`no app with bundle id ${bundleId} in App Store Connect – create it first (${CHECKLIST})`);
      return app;
    },
    async editableAppInfo(appId) {
      const infos = await list(`/apps/${appId}/appInfos`);
      const live = (i) => /READY_FOR_(SALE|DISTRIBUTION)|REPLACED_WITH_NEW_INFO/.test(i.attributes?.state ?? i.attributes?.appStoreState ?? "");
      const info = infos.find((i) => !live(i)) ?? infos[0];
      if (!info) throw new Error("the app has no appInfo record");
      return info;
    },
    async findVersion(appId, versionString, { required = true } = {}) {
      const q = `/apps/${appId}/appStoreVersions?filter[platform]=IOS${versionString ? `&filter[versionString]=${encodeURIComponent(versionString)}` : ""}&limit=200`;
      const all = await list(q);
      const v = versionString ? all.find((x) => x.attributes?.versionString === versionString) : all.find((x) => EDITABLE.includes(stateOf(x)));
      if (!v && required)
        throw new Error(
          versionString
            ? `no iOS App Store version ${versionString} – run: asc.mjs version ensure --version ${versionString}`
            : "no editable iOS App Store version – pass --version",
        );
      return v;
    },
    async findBuild(appId, number) {
      const q =
        number === "latest"
          ? `/builds?filter[app]=${appId}&sort=-uploadedDate&limit=1&include=preReleaseVersion`
          : `/builds?filter[app]=${appId}&filter[version]=${encodeURIComponent(number)}&limit=1&include=preReleaseVersion`;
      const r = await request("GET", q);
      const build = r?.data?.[0];
      if (!build) return null;
      const pre = build.relationships?.preReleaseVersion?.data;
      const train = (r.included ?? []).find((i) => i.type === "preReleaseVersions" && (!pre || i.id === pre.id))?.attributes?.version;
      return { build, train };
    },
    /** Polls until the build exists and is VALID; FAILED/INVALID and the timeout are errors. */
    async waitForBuild(appId, number, { timeoutMs = 60 * 60_000, intervalMs = 30_000 } = {}) {
      const polls = Math.max(1, Math.ceil(timeoutMs / intervalMs));
      for (let i = 0; ; i++) {
        const found = await api.findBuild(appId, number);
        const state = found?.build.attributes?.processingState;
        if (state === "VALID") return found;
        if (state === "FAILED" || state === "INVALID")
          throw new Error(`build ${found.build.attributes?.version} is ${state} (App Store Connect › TestFlight shows why)`);
        if (i + 1 >= polls)
          throw new Error(`build ${number} not processed after ${Math.round(timeoutMs / 60_000)} min (${found ? state : "not uploaded yet"})`);
        log(`build ${number}: ${found ? state : "not visible yet"} – waiting ${Math.round(intervalMs / 1000)} s`);
        await sleep(intervalMs);
      }
    },
    async resolveBuildId(appId, build) {
      if (!/^\d+$/.test(String(build)) && build !== "latest") return build;
      if (!appId) throw new UsageError("--app is required when --build is a build number");
      const found = await api.findBuild(appId, build);
      if (!found) throw new Error(`no build ${build} for this app`);
      return found.build.id;
    },
    async uploadScreenshot(setId, file) {
      const data = fs.readFileSync(file);
      const r = await request("POST", "/appScreenshots", {
        data: {
          type: "appScreenshots",
          attributes: { fileName: path.basename(file), fileSize: data.length },
          relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } },
        },
      });
      const shot = r.data;
      for (const op of shot.attributes?.uploadOperations ?? []) {
        const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
        const res = await http(op.url, { method: op.method, headers, body: data.subarray(op.offset, op.offset + op.length) });
        if (!res.ok) throw new Error(`screenshot ${path.basename(file)}: upload part at ${op.offset} failed with HTTP ${res.status}`);
      }
      await request("PATCH", `/appScreenshots/${shot.id}`, {
        data: { type: "appScreenshots", id: shot.id, attributes: { uploaded: true, sourceFileChecksum: md5(data) } },
      });
      for (let i = 0; i < 15; i++) {
        const s = (await request("GET", `/appScreenshots/${shot.id}`))?.data?.attributes?.assetDeliveryState;
        if (s?.state === "COMPLETE") return shot.id;
        if (s?.state === "FAILED")
          throw new Error(`screenshot ${path.basename(file)} refused: ${(s.errors ?? []).map((x) => x.description ?? x.code).join("; ") || "FAILED"}`);
        await sleep(2000);
      }
      log(`notice: screenshot ${path.basename(file)} is still processing`);
      return shot.id;
    },
  };
  return api;
}

/** CLI entry (tests pass env, fetch, log, sleep, now and storeDir). Returns the exit code. */
export async function run(
  argv,
  { env = process.env, fetch: fetchImpl = globalThis.fetch, log = console.log, sleep = defaultSleep, now = () => Date.now(), storeDir = STORE_DIR } = {},
) {
  const { _: pos, opts } = parseArgs(argv, ["yes", "help"]);
  if (opts.help || pos[0] === "help" || pos.length === 0) {
    log(USAGE);
    return 0;
  }
  if (!env.ASC_KEY_ID || !env.ASC_ISSUER_ID || !env.ASC_KEY_PATH) throw new UsageError("set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH");
  let privateKey;
  const token = () => {
    privateKey ??= fs.readFileSync(env.ASC_KEY_PATH, "utf8");
    return makeJwt({ keyId: env.ASC_KEY_ID, issuerId: env.ASC_ISSUER_ID, privateKey, now: now() });
  };
  const http = retryingFetch(fetchImpl, { sleep, log });
  const { request } = client({ token, fetch: http });
  const api = storeApi({ request, http, log, sleep });
  const need = (name) => {
    if (!opts[name]) throw new UsageError(`--${name} is required`);
    return opts[name];
  };
  const cmd = pos.join(" ");
  const appRecord = async () => api.findApp(appOf(opts.app).id);
  const failed = [];
  /** Runs one locale's requests; an API error is recorded and the next locale goes on. */
  const perLocale = async (locale, body) => {
    try {
      await body();
    } catch (e) {
      if (!(e instanceof AscError)) throw e;
      failed.push(locale);
      log(`FAILED ${locale}: ${e.message}`);
    }
  };
  const localesOf = (langs, listings) => {
    const unsupported = langs.filter((l) => !ASC_LOCALES[l]);
    const missing = langs.filter((l) => ASC_LOCALES[l] && !listings[l]);
    if (unsupported.length) log(`not sent (no App Store localization): ${unsupported.join(", ")}`);
    if (missing.length) log(`not sent (no docs/store/listing/<lang>.json entry): ${missing.join(", ")}`);
    return langs.filter((l) => ASC_LOCALES[l] && listings[l]);
  };

  if (cmd === "apps list") {
    for (const a of await api.list("/apps?limit=200")) {
      const x = a.attributes ?? {};
      log(`${a.id}\t${x.bundleId}\t${x.name}\tsku ${x.sku ?? "–"}\t${x.primaryLocale ?? "–"}`);
    }
  } else if (cmd === "app info") {
    const app = await api.findApp(opts["bundle-id"] ?? appOf(opts.app).id);
    const x = app.attributes ?? {};
    log(`app ${app.id}: ${x.name} (${x.bundleId}), sku ${x.sku ?? "–"}, primary locale ${x.primaryLocale ?? "–"}`);
    for (const i of await api.list(`/apps/${app.id}/appInfos`)) log(`  appInfo ${i.id}: ${i.attributes?.state ?? i.attributes?.appStoreState ?? "?"}`);
    for (const v of await api.list(`/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=200`))
      log(`  version ${v.attributes?.versionString}: ${stateOf(v)} (${v.id})`);
  } else if (cmd === "app-info push") {
    const app = await appRecord();
    const info = await api.editableAppInfo(app.id);
    const listings = loadListings(storeDir, opts.app, langsOf(opts.langs));
    const langs = localesOf(langsOf(opts.langs), listings);
    const existing = new Map((await api.list(`/appInfos/${info.id}/appInfoLocalizations?limit=200`)).map((l) => [l.attributes?.locale, l]));
    for (const lang of langs) {
      const locale = ASC_LOCALES[lang];
      const l = listings[lang];
      const attrs = { name: l.title, subtitle: l.subtitle, privacyPolicyUrl: opts["privacy-url"] ?? PRIVACY_URL };
      checkLengths(`listing/${lang}.json`, attrs);
      await perLocale(locale, async () => {
        const cur = existing.get(locale);
        if (cur) await request("PATCH", `/appInfoLocalizations/${cur.id}`, { data: { type: "appInfoLocalizations", id: cur.id, attributes: attrs } });
        else
          await request("POST", "/appInfoLocalizations", {
            data: { type: "appInfoLocalizations", attributes: { locale, ...attrs }, relationships: { appInfo: { data: { type: "appInfos", id: info.id } } } },
          });
        log(`${locale}: ${cur ? "updated" : "created"} (${attrs.name} – ${attrs.subtitle})`);
      });
    }
    await request("PATCH", `/appInfos/${info.id}`, {
      data: {
        type: "appInfos",
        id: info.id,
        relationships: {
          primaryCategory: { data: { type: "appCategories", id: CATEGORIES.primary } },
          secondaryCategory: { data: { type: "appCategories", id: CATEGORIES.secondary } },
        },
      },
    });
    log(`categories: ${CATEGORIES.primary} / ${CATEGORIES.secondary}`);
    const decl = (await request("GET", `/appInfos/${info.id}/ageRatingDeclaration`))?.data;
    if (!decl) throw new Error("the appInfo has no age rating declaration");
    await api.sendDropping(
      "PATCH",
      `/ageRatingDeclarations/${decl.id}`,
      { data: { type: "ageRatingDeclarations", id: decl.id, attributes: { ...AGE_RATING } } },
      "*",
    );
    log("age rating declaration: nothing applies (4+)");
  } else if (cmd === "version ensure") {
    const app = await appRecord();
    const versionString = need("version");
    const v = await api.findVersion(app.id, versionString, { required: false });
    if (v) log(`version ${versionString} exists: ${v.id} (${stateOf(v)})`);
    else {
      let r;
      try {
        r = await request("POST", "/appStoreVersions", {
          data: {
            type: "appStoreVersions",
            attributes: { platform: "IOS", versionString, releaseType: opts["release-type"] ?? "MANUAL" },
            relationships: { app: { data: { type: "apps", id: app.id } } },
          },
        });
      } catch (e) {
        if (e instanceof AscError && e.status === 409)
          e.message += " – another iOS version may still be in preparation (asc.mjs app info lists them; rename or remove it in App Store Connect)";
        throw e;
      }
      log(`version ${versionString} created: ${r.data.id} (${stateOf(r.data) ?? "PREPARE_FOR_SUBMISSION"}, release MANUAL)`);
    }
  } else if (cmd === "version push") {
    const app = await appRecord();
    const version = await api.findVersion(app.id, need("version"));
    const images = opts.images ?? "own";
    if (!["own", "all", "none"].includes(images)) throw new UsageError("--images must be own, all or none");
    const listings = loadListings(storeDir, opts.app, langsOf(opts.langs));
    const langs = localesOf(langsOf(opts.langs), listings);
    const existing = new Map((await api.list(`/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=200`)).map((l) => [l.attributes?.locale, l]));
    for (const lang of langs) {
      const locale = ASC_LOCALES[lang];
      const l = listings[lang];
      const attrs = {
        description: l.description,
        keywords: l.keywords,
        whatsNew: l.whatsNew,
        promotionalText: l.promotionalText,
        supportUrl: SUPPORT_URL,
        marketingUrl: MARKETING_URL,
      };
      for (const k of Object.keys(attrs)) if (attrs[k] === undefined) delete attrs[k];
      checkLengths(`listing/${lang}.json`, attrs);
      await perLocale(locale, async () => {
        let loc = existing.get(locale);
        if (loc)
          await api.sendDropping(
            "PATCH",
            `/appStoreVersionLocalizations/${loc.id}`,
            { data: { type: "appStoreVersionLocalizations", id: loc.id, attributes: attrs } },
            ["whatsNew"],
          );
        else
          loc = (
            await api.sendDropping(
              "POST",
              "/appStoreVersionLocalizations",
              {
                data: {
                  type: "appStoreVersionLocalizations",
                  attributes: { locale, ...attrs },
                  relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } },
                },
              },
              ["whatsNew"],
            )
          ).data;
        const done = [];
        if (images !== "none") {
          const primary = lang === "en";
          const sets = new Map(
            (await api.list(`/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).map((s) => [s.attributes?.screenshotDisplayType, s]),
          );
          for (const def of SCREENSHOT_SETS) {
            const { files } = screenshots(storeDir, opts.app, def.form, lang, { reuse: primary || images === "all" });
            const fit = files.filter((f) => {
              const s = pngSize(fs.readFileSync(f));
              const ok = s && def.sizes.includes(`${s.width}x${s.height}`);
              if (!ok)
                log(
                  `notice: ${path.relative(storeDir, f)} is ${s ? `${s.width}×${s.height}` : "not a PNG"} – not a ${def.type} size (${def.sizes[0]}), skipped`,
                );
              return ok;
            });
            if (!fit.length) continue;
            let set = sets.get(def.type);
            if (set) for (const s of await api.list(`/appScreenshotSets/${set.id}/appScreenshots`)) await request("DELETE", `/appScreenshots/${s.id}`);
            else
              set = (
                await request("POST", "/appScreenshotSets", {
                  data: {
                    type: "appScreenshotSets",
                    attributes: { screenshotDisplayType: def.type },
                    relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: loc.id } } },
                  },
                })
              ).data;
            for (const f of fit.slice(0, LIMITS.screenshots)) await api.uploadScreenshot(set.id, f);
            done.push(`${def.type} ×${Math.min(fit.length, LIMITS.screenshots)}`);
          }
        }
        log(`${locale}: texts${done.length ? `, ${done.join(", ")}` : ""}`);
      });
    }
  } else if (cmd === "build attach") {
    const app = await appRecord();
    const version = await api.findVersion(app.id, need("version"));
    const number = need("build");
    const { build, train } = await api.waitForBuild(app.id, number, {
      timeoutMs: Number(opts.timeout ?? 60) * 60_000,
      intervalMs: Number(opts.interval ?? 30) * 1000,
    });
    const versionString = version.attributes?.versionString;
    if (train && !sameVersion(train, versionString)) {
      throw new Error(
        `build ${build.attributes?.version} belongs to version ${train}, not ${versionString} (CFBundleShortVersionString must match the App Store version)`,
      );
    }
    await request("PATCH", `/appStoreVersions/${version.id}/relationships/build`, { data: { type: "builds", id: build.id } });
    log(`build ${build.attributes?.version} (${build.id}, ${train ?? "?"}) attached to version ${versionString}`);
  } else if (cmd === "build export-compliance") {
    const appId = opts.app ? (await appRecord()).id : undefined;
    const id = await api.resolveBuildId(appId, need("build"));
    try {
      await request("PATCH", `/builds/${id}`, { data: { type: "builds", id, attributes: { usesNonExemptEncryption: false } } });
      log(`build ${id}: usesNonExemptEncryption = false`);
    } catch (e) {
      if (!(e instanceof AscError && e.status === 409)) throw e;
      log(`build ${id}: export compliance already set (Info.plist ITSAppUsesNonExemptEncryption) – ${e.message}`);
    }
  } else if (cmd === "review notes") {
    const app = await appRecord();
    const version = await api.findVersion(app.id, opts.version);
    const notes = fs.readFileSync(need("file"), "utf8").trim();
    const contact = {
      contactFirstName: opts["contact-first"] ?? env.ASC_REVIEW_FIRST_NAME,
      contactLastName: opts["contact-last"] ?? env.ASC_REVIEW_LAST_NAME,
      contactEmail: opts["contact-email"] ?? env.ASC_REVIEW_EMAIL,
      contactPhone: opts["contact-phone"] ?? env.ASC_REVIEW_PHONE,
    };
    for (const k of Object.keys(contact)) if (!contact[k]) delete contact[k];
    if (Object.keys(contact).length < 4) log("notice: review contact incomplete (first/last name, e-mail, phone are needed before submitting)");
    const attrs = { ...contact, demoAccountRequired: false, notes };
    checkLengths("review notes", { notes });
    let cur = null;
    try {
      cur = (await request("GET", `/appStoreVersions/${version.id}/appStoreReviewDetail`))?.data ?? null;
    } catch (e) {
      if (!(e instanceof AscError && e.status === 404)) throw e;
    }
    if (cur) await request("PATCH", `/appStoreReviewDetails/${cur.id}`, { data: { type: "appStoreReviewDetails", id: cur.id, attributes: attrs } });
    else
      await request("POST", "/appStoreReviewDetails", {
        data: { type: "appStoreReviewDetails", attributes: attrs, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } },
      });
    log(
      `review details ${cur ? "updated" : "created"} for version ${version.attributes?.versionString} (${notes.length} characters of notes, no demo account)`,
    );
  } else if (cmd === "submit") {
    const app = await appRecord();
    const version = await api.findVersion(app.id, need("version"));
    const build = (await request("GET", `/appStoreVersions/${version.id}/build`))?.data ?? null;
    const locs = await api.list(`/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=200`);
    let review = null;
    try {
      review = (await request("GET", `/appStoreVersions/${version.id}/appStoreReviewDetail`))?.data ?? null;
    } catch (e) {
      if (!(e instanceof AscError && e.status === 404)) throw e;
    }
    log(`${app.attributes?.name} ${version.attributes?.versionString}: ${stateOf(version)}`);
    log(`  build: ${build ? `${build.attributes?.version} (${build.id})` : "none attached"}`);
    log(`  localizations: ${locs.map((l) => l.attributes?.locale).join(", ") || "none"}`);
    log(`  review details: ${review ? "set" : "missing"}`);
    if (!build) throw new Error("attach a build first (asc.mjs build attach)");
    if (!opts.yes) {
      log("not submitted – run again with --yes to submit this version for App Review");
      return 0;
    }
    const open = await api.list(`/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW`);
    const sub =
      open[0] ??
      (
        await request("POST", "/reviewSubmissions", {
          data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: app.id } } } },
        })
      ).data;
    try {
      await request("POST", "/reviewSubmissionItems", {
        data: {
          type: "reviewSubmissionItems",
          relationships: {
            reviewSubmission: { data: { type: "reviewSubmissions", id: sub.id } },
            appStoreVersion: { data: { type: "appStoreVersions", id: version.id } },
          },
        },
      });
    } catch (e) {
      if (!(e instanceof AscError && e.status === 409)) throw e;
      log(`notice: ${e.message} (the version is probably in this submission already)`);
    }
    const done = await request("PATCH", `/reviewSubmissions/${sub.id}`, { data: { type: "reviewSubmissions", id: sub.id, attributes: { submitted: true } } });
    log(`review submission ${sub.id}: ${done?.data?.attributes?.state ?? "submitted"}`);
  } else if (cmd === "testflight groups") {
    const app = await appRecord();
    for (const g of await api.list(`/apps/${app.id}/betaGroups?limit=200`)) {
      const x = g.attributes ?? {};
      log(`${g.id}\t${x.name}\t${x.isInternalGroup ? "internal" : "external"}${x.hasAccessToAllBuilds ? "\tall builds" : ""}`);
    }
  } else if (cmd === "testflight add") {
    const group = need("group");
    const appId = opts.app ? (await appRecord()).id : undefined;
    let groupId = group;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(group)) {
      if (!appId) throw new UsageError("--app is required when --group is a name");
      const g = (await api.list(`/apps/${appId}/betaGroups?limit=200`)).find((x) => x.attributes?.name === group);
      if (!g) throw new Error(`no TestFlight group "${group}" (asc.mjs testflight groups --app ${opts.app})`);
      groupId = g.id;
    }
    const buildId = await api.resolveBuildId(appId, need("build"));
    await request("POST", `/betaGroups/${groupId}/relationships/builds`, { data: [{ type: "builds", id: buildId }] });
    log(`build ${buildId} added to TestFlight group ${group}`);
  } else {
    throw new UsageError(`unknown command: ${cmd}`);
  }
  if (failed.length) {
    log(`${failed.length} locale(s) failed: ${failed.join(", ")}`);
    return 1;
  }
  return 0;
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`asc: ${e.message}`);
      if (e instanceof UsageError) console.error("run with --help for the commands");
      process.exit(e instanceof UsageError ? 2 : 1);
    },
  );
}
