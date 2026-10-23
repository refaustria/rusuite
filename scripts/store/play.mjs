#!/usr/bin/env node
// Google Play publishing (P10-M8, docs/store/README.md): Android Publisher API v3 with a service account – Node only,
// no dependencies (RS256 JWT with node:crypto, OAuth2 JWT-bearer token exchange, fetch).
//
// Credentials (environment, never in the repo): PLAY_SERVICE_ACCOUNT_JSON (the key file's JSON content) or
// PLAY_SERVICE_ACCOUNT_FILE (its path). Neither the key, the JWT nor the access token is ever printed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  APPS,
  LANGS,
  PLAY_LOCALES,
  STORE_DIR,
  UsageError,
  appOf,
  isMain,
  langsOf,
  loadListings,
  parseArgs,
  releaseNotes,
  retryingFetch,
  screenshots,
} from "./lib.mjs";

export const USAGE = `usage: node scripts/store/play.mjs <command> [options]

  upload --app calc|write|show --aab <file> --track internal|closed|open|production
         [--rollout 0.1] [--status completed|draft|inProgress|halted] [--notes <dir or <lang>.txt>]
         [--name <release name>] [--resumable] [--changes-not-sent-for-review] [--dry-run]
      edits.insert → bundles.upload → tracks.update (release notes per listing language) → edits.commit
      (--dry-run: edits.validate, then the edit is deleted – nothing changes in the console).
      --notes defaults to docs/store/release-notes/ (<lang>.txt, falling back to en.txt).
  listing push --app calc|write|show [--langs en,de] [--images own|all|none] [--dry-run]
      title/shortDescription/fullDescription from docs/store/listing/<lang>.json for every Play language; images
      (icon, featureGraphic, phone/7"/10" screenshots from docs/store/{graphics,screenshots}/<app>/) with
      images.deleteall + upload. --images own (default): the default language (en-US) and every language with its
      own screenshot folder – Play shows the en-US graphics for the others; all: en screenshots for every language.
  status [--app calc|write|show]      tracks, releases and version codes (review state is not in the API)
  validate                            which of the three apps the service account can open an edit for

Env: PLAY_SERVICE_ACCOUNT_JSON or PLAY_SERVICE_ACCOUNT_FILE. Checklist: docs/store/checklist-play.md.`;

export const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";
export const UPLOAD_API = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3";
export const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
export const TRACKS = { internal: "internal", closed: "alpha", alpha: "alpha", open: "beta", beta: "beta", production: "production" };
export const STATUSES = ["completed", "draft", "inProgress", "halted"];
/** docs/store layout (P10-M7) → Play image types. */
export const IMAGE_FORMS = { phone: "phoneScreenshots", "tablet-7": "sevenInchScreenshots", "tablet-10": "tenInchScreenshots" };
export const LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000, releaseNotes: 500, screenshots: 8 };
const RESUMABLE_ABOVE = 64 * 1024 * 1024;
const CHECKLIST = "docs/store/checklist-play.md";

const b64url = (v) => Buffer.from(v).toString("base64url");

/** The service account key from the environment ({ client_email, private_key, token_uri }). */
export function serviceAccount(env) {
  let text = env.PLAY_SERVICE_ACCOUNT_JSON;
  if (text && !text.trim().startsWith("{")) text = fs.readFileSync(text.trim(), "utf8"); // a path in the JSON variable
  if (!text && env.PLAY_SERVICE_ACCOUNT_FILE) text = fs.readFileSync(env.PLAY_SERVICE_ACCOUNT_FILE, "utf8");
  if (!text) throw new UsageError("set PLAY_SERVICE_ACCOUNT_JSON (key JSON) or PLAY_SERVICE_ACCOUNT_FILE (its path)");
  let key;
  try {
    key = JSON.parse(text);
  } catch {
    throw new UsageError("the Play service account key is not valid JSON");
  }
  if (!key.client_email || !key.private_key) throw new UsageError("the Play service account key has no client_email/private_key");
  return key;
}

/** The RS256 assertion of the OAuth2 JWT-bearer grant (RFC 7523), valid for one hour. */
export function makeServiceJwt({ clientEmail, privateKey, aud, scope = SCOPE, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: clientEmail, scope, aud, iat, exp: iat + 3600 };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  return `${input}.${b64url(crypto.sign("sha256", Buffer.from(input), privateKey))}`;
}

export class PlayError extends Error {
  constructor(status, body, what) {
    const e = body?.error ?? {};
    const reason = e.errors?.[0]?.reason ?? e.status ?? "";
    let msg = `Google Play ${status}${reason ? ` ${reason}` : ""}: ${e.message ?? "request failed"}${what ? ` (${what})` : ""}`;
    const m = e.message ?? "";
    if (/draft app/i.test(m)) msg += " – the app is still a draft: upload with --status draft until its first release is out";
    else if (/version code .*already been used/i.test(m)) msg += " – bump the version (scripts/set-version.sh) or upload a newer build";
    else if (status === 404 || status === 403) {
      msg += ` – the app does not exist in Play Console yet, its first bundle was not uploaded in the console, or the service account has no permission for it (${CHECKLIST})`;
    }
    super(msg);
    this.status = status;
    this.body = body;
  }
}

/** OAuth2 access token for the service account (one per CLI run; lives one hour). */
export async function accessToken({ account, fetch: fetchImpl, now = Date.now() }) {
  const aud = account.token_uri || "https://oauth2.googleapis.com/token";
  const assertion = makeServiceJwt({ clientEmail: account.client_email, privateKey: account.private_key, aud, now });
  const res = await fetchImpl(aud, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    throw new Error(`Google OAuth ${res.status}: ${json?.error ?? "token request failed"}${json?.error_description ? ` – ${json.error_description}` : ""}`);
  }
  return json.access_token;
}

/** Android Publisher client: `token()` resolves the access token; `fetch` is injectable (tests). */
export function playClient({ token, fetch: fetchImpl }) {
  const call = async (method, url, { json, body, contentType, headers = {}, what, raw = false } = {}) => {
    const res = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${await token()}`,
        accept: "application/json",
        ...(json !== undefined && { "content-type": "application/json" }),
        ...(contentType && { "content-type": contentType }),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : body,
    });
    if (raw && res.ok) return res;
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) throw new PlayError(res.status, parsed, what);
    return parsed;
  };
  const app = (pkg) => `${API}/applications/${pkg}`;
  const edit = (pkg, id) => `${app(pkg)}/edits/${id}`;
  return {
    call,
    insertEdit: (pkg) => call("POST", `${app(pkg)}/edits`, { json: {}, what: `${pkg} edits.insert` }),
    deleteEdit: (pkg, id) => call("DELETE", edit(pkg, id), { what: `${pkg} edits.delete` }),
    validateEdit: (pkg, id) => call("POST", `${edit(pkg, id)}:validate`, { what: `${pkg} edits.validate` }),
    commitEdit: (pkg, id, { changesNotSentForReview = false } = {}) =>
      call("POST", `${edit(pkg, id)}:commit${changesNotSentForReview ? "?changesNotSentForReview=true" : ""}`, { what: `${pkg} edits.commit` }),
    async uploadBundle(pkg, id, data, { resumable = data.length > RESUMABLE_ABOVE } = {}) {
      const url = `${UPLOAD_API}/applications/${pkg}/edits/${id}/bundles`;
      if (!resumable) return call("POST", `${url}?uploadType=media`, { body: data, contentType: "application/octet-stream", what: `${pkg} bundles.upload` });
      const start = await call("POST", `${url}?uploadType=resumable`, {
        json: {},
        headers: { "x-upload-content-type": "application/octet-stream", "x-upload-content-length": String(data.length) },
        what: `${pkg} bundles.upload (resumable start)`,
        raw: true,
      });
      const session = start.headers.get("location");
      if (!session) throw new Error("bundles.upload: no resumable session URL in the answer");
      return call("PUT", session, { body: data, contentType: "application/octet-stream", what: `${pkg} bundles.upload (resumable)` });
    },
    listBundles: (pkg, id) => call("GET", `${edit(pkg, id)}/bundles`, { what: `${pkg} bundles.list` }),
    listTracks: (pkg, id) => call("GET", `${edit(pkg, id)}/tracks`, { what: `${pkg} tracks.list` }),
    updateTrack: (pkg, id, track, body) => call("PUT", `${edit(pkg, id)}/tracks/${track}`, { json: body, what: `${pkg} tracks.update ${track}` }),
    listListings: (pkg, id) => call("GET", `${edit(pkg, id)}/listings`, { what: `${pkg} listings.list` }),
    updateListing: (pkg, id, language, body) =>
      call("PUT", `${edit(pkg, id)}/listings/${language}`, { json: body, what: `${pkg} listings.update ${language}` }),
    deleteImages: (pkg, id, language, type) =>
      call("DELETE", `${edit(pkg, id)}/listings/${language}/${type}`, { what: `${pkg} images.deleteall ${language} ${type}` }),
    uploadImage: (pkg, id, language, type, data) =>
      call("POST", `${UPLOAD_API}/applications/${pkg}/edits/${id}/listings/${language}/${type}?uploadType=media`, {
        body: data,
        contentType: "image/png",
        what: `${pkg} images.upload ${language} ${type}`,
      }),
  };
}

/** Release notes per Play language: a directory of <lang>.txt (en fallback) or a single <lang>.txt file. */
export function notesFor(notes, langs = LANGS) {
  if (!notes || !fs.existsSync(notes)) return [];
  const out = [];
  if (fs.statSync(notes).isDirectory()) {
    for (const lang of langs) {
      const text = PLAY_LOCALES[lang] && releaseNotes(notes, lang);
      if (text) out.push({ language: PLAY_LOCALES[lang], text });
    }
  } else {
    const lang = path.basename(notes, ".txt");
    out.push({ language: PLAY_LOCALES[lang] ?? "en-US", text: fs.readFileSync(notes, "utf8").trim() });
  }
  for (const n of out) {
    if (n.text.length > LIMITS.releaseNotes)
      throw new UsageError(`release notes ${n.language}: ${n.text.length} characters (Play allows ${LIMITS.releaseNotes})`);
  }
  return out;
}

/** The track release body of `upload` (status/userFraction rules of tracks.update). */
export function releaseBody({ track, versionCode, rollout, status, notes, name }) {
  const fraction = rollout !== undefined ? Number(rollout) : undefined;
  if (fraction !== undefined && !(fraction > 0 && fraction < 1)) throw new UsageError("--rollout must be a fraction between 0 and 1 (e.g. 0.1)");
  const st = status ?? (fraction !== undefined ? "inProgress" : "completed");
  if (!STATUSES.includes(st)) throw new UsageError(`--status must be one of ${STATUSES.join(", ")}`);
  if (fraction !== undefined && !["inProgress", "halted"].includes(st)) throw new UsageError("--rollout needs --status inProgress (or halted)");
  const release = { versionCodes: [String(versionCode)], status: st };
  if (name) release.name = name;
  if (fraction !== undefined) release.userFraction = fraction;
  if (notes.length) release.releaseNotes = notes;
  return { track, releases: [release] };
}

function checkListing(lang, l) {
  const problems = [];
  for (const f of ["title", "shortDescription", "fullDescription"]) {
    if (!l[f]) problems.push(`${f} missing`);
    else if (l[f].length > LIMITS[f]) problems.push(`${f} ${l[f].length} > ${LIMITS[f]}`);
  }
  if (problems.length) throw new UsageError(`listing/${lang}.json: ${problems.join(", ")}`);
}

/** CLI entry (tests pass env, fetch, log, sleep and storeDir). Returns the exit code. */
export async function run(
  argv,
  { env = process.env, fetch: fetchImpl = globalThis.fetch, log = console.log, sleep, now = () => Date.now(), storeDir = STORE_DIR } = {},
) {
  const { _: pos, opts } = parseArgs(argv, ["dry-run", "resumable", "changes-not-sent-for-review", "help"]);
  if (opts.help || pos[0] === "help" || pos.length === 0) {
    log(USAGE);
    return 0;
  }
  const http = retryingFetch(fetchImpl, { sleep, log });
  const account = serviceAccount(env);
  let cached;
  const token = async () => (cached ??= await accessToken({ account, fetch: http, now: now() }));
  const play = playClient({ token, fetch: http });
  const cmd = pos.join(" ");
  // Runs `body` inside a fresh edit; an edit left behind by a failure is deleted (Play keeps one open edit per app).
  const inEdit = async (pkg, body) => {
    const { id } = await play.insertEdit(pkg);
    log(`${pkg}: edit ${id}`);
    try {
      await body(id);
    } catch (e) {
      await play.deleteEdit(pkg, id).catch(() => {});
      throw e;
    }
    await finish(pkg, id);
  };
  const finish = async (pkg, id) => {
    if (opts["dry-run"]) {
      await play.validateEdit(pkg, id);
      await play.deleteEdit(pkg, id);
      log(`dry run: edit ${id} validated and deleted – nothing was committed`);
    } else {
      await play.commitEdit(pkg, id, { changesNotSentForReview: !!opts["changes-not-sent-for-review"] });
      log(`edit ${id} committed`);
    }
  };

  if (cmd === "upload") {
    const app = appOf(opts.app);
    if (!opts.aab) throw new UsageError("--aab is required");
    const track = TRACKS[opts.track];
    if (!track) throw new UsageError("--track must be one of internal, closed, open, production");
    const data = fs.readFileSync(opts.aab);
    const notesSource = opts.notes ?? path.join(storeDir, "release-notes");
    const allNotes = notesFor(notesSource);
    // Validate the options before anything changes on Google's side.
    releaseBody({ track, versionCode: 0, rollout: opts.rollout, status: opts.status, notes: [], name: opts.name });
    await inEdit(app.id, async (id) => {
      const bundle = await play.uploadBundle(app.id, id, data, { resumable: opts.resumable ? true : undefined });
      log(`${app.id}: bundle uploaded – versionCode ${bundle.versionCode}, sha256 ${bundle.sha256 ?? "?"}`);
      // Play accepts release notes only in the app's listing languages; the others are reported, not sent.
      const listed = new Set(((await play.listListings(app.id, id))?.listings ?? []).map((l) => l.language));
      const notes = listed.size ? allNotes.filter((n) => listed.has(n.language)) : allNotes.filter((n) => n.language === "en-US");
      const skipped = allNotes.filter((n) => !notes.includes(n)).map((n) => n.language);
      if (!allNotes.length) log(`notice: no release notes (${notesSource} missing)`);
      if (skipped.length) log(`release notes not sent (no store listing in that language yet – run listing push first): ${skipped.join(", ")}`);
      const body = releaseBody({ track, versionCode: bundle.versionCode, rollout: opts.rollout, status: opts.status, notes, name: opts.name });
      await play.updateTrack(app.id, id, track, body);
      const r = body.releases[0];
      log(
        `${app.id}: track ${track} ← versionCode ${bundle.versionCode} (${r.status}${r.userFraction ? `, ${r.userFraction * 100} %` : ""}, notes: ${notes.map((n) => n.language).join(", ") || "none"})`,
      );
    });
  } else if (cmd === "listing push") {
    const app = appOf(opts.app);
    const langs = langsOf(opts.langs);
    const images = opts.images ?? "own";
    if (!["own", "all", "none"].includes(images)) throw new UsageError("--images must be own, all or none");
    const listings = loadListings(storeDir, app.key, langs);
    const unsupported = langs.filter((l) => !PLAY_LOCALES[l]);
    const missing = langs.filter((l) => PLAY_LOCALES[l] && !listings[l]);
    for (const [lang, l] of Object.entries(listings)) if (PLAY_LOCALES[lang]) checkListing(lang, l);
    if (unsupported.length) log(`not sent (no Play listing language): ${unsupported.join(", ")}`);
    if (missing.length) log(`not sent (no docs/store/listing/<lang>.json entry for ${app.key}): ${missing.join(", ")}`);
    await inEdit(app.id, async (id) => {
      let sent = 0;
      let uploaded = 0;
      for (const lang of langs) {
        const language = PLAY_LOCALES[lang];
        const l = listings[lang];
        if (!language || !l) continue;
        await play.updateListing(app.id, id, language, { language, title: l.title, shortDescription: l.shortDescription, fullDescription: l.fullDescription });
        sent++;
        if (images === "none") continue;
        const isDefault = lang === "en";
        const plan = [];
        if (isDefault) {
          for (const [type, file] of [
            ["icon", "icon-512.png"],
            ["featureGraphic", "feature-1024x500.png"],
          ]) {
            const f = path.join(storeDir, "graphics", app.key, file);
            if (fs.existsSync(f)) plan.push([type, [f]]);
            else log(`notice: ${path.relative(storeDir, f)} missing – ${type} not changed`);
          }
        }
        for (const [form, type] of Object.entries(IMAGE_FORMS)) {
          const shots = screenshots(storeDir, app.key, form, lang, { reuse: isDefault || images === "all" });
          if (shots.files.length) plan.push([type, shots.files.slice(0, LIMITS.screenshots)]);
          if (shots.files.length > LIMITS.screenshots) log(`notice: ${app.key}/${form}/${lang}: only the first ${LIMITS.screenshots} screenshots are uploaded`);
        }
        for (const [type, files] of plan) {
          await play.deleteImages(app.id, id, language, type);
          for (const f of files) {
            await play.uploadImage(app.id, id, language, type, fs.readFileSync(f));
            uploaded++;
          }
        }
        if (plan.length) log(`${language}: ${plan.map(([t, f]) => `${t} ×${f.length}`).join(", ")}`);
      }
      log(`${app.id}: ${sent} listing(s), ${uploaded} image(s)`);
    });
  } else if (cmd === "status") {
    const apps = opts.app ? [appOf(opts.app)] : Object.keys(APPS).map(appOf);
    for (const app of apps) {
      const { id } = await play.insertEdit(app.id);
      try {
        const tracks = (await play.listTracks(app.id, id))?.tracks ?? [];
        const codes = ((await play.listBundles(app.id, id))?.bundles ?? []).map((b) => Number(b.versionCode));
        log(`${app.id}: latest uploaded versionCode ${codes.length ? Math.max(...codes) : "–"}`);
        for (const t of tracks) {
          const rel = t.releases ?? [];
          if (!rel.length) log(`  ${t.track}: no release`);
          for (const r of rel) {
            log(
              `  ${t.track}: ${r.name ?? "(unnamed)"} – ${r.status}${r.userFraction ? ` ${r.userFraction * 100} %` : ""} – versionCodes ${(r.versionCodes ?? []).join(", ") || "–"}`,
            );
          }
        }
        log("  review state: not exposed by the API – Play Console › Publishing overview");
      } finally {
        await play.deleteEdit(app.id, id);
      }
    }
  } else if (cmd === "validate") {
    log(`service account: ${account.client_email}`);
    let ok = 0;
    for (const app of Object.keys(APPS).map(appOf)) {
      try {
        const { id } = await play.insertEdit(app.id);
        await play.deleteEdit(app.id, id);
        log(`ok      ${app.id} (${app.name})`);
        ok++;
      } catch (e) {
        if (!(e instanceof PlayError)) throw e;
        log(`MISSING ${app.id} (${app.name}): HTTP ${e.status} – create the app / grant the service account access (${CHECKLIST})`);
      }
    }
    log(`${ok}/3 apps visible`);
    return ok === 3 ? 0 : 1;
  } else {
    throw new UsageError(`unknown command: ${cmd}`);
  }
  return 0;
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`play: ${e.message}`);
      if (e instanceof UsageError) console.error("run with --help for the commands");
      process.exit(e instanceof UsageError ? 2 : 1);
    },
  );
}
