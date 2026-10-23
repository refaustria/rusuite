#!/usr/bin/env node
// App Store Connect API client for the PM's signing chores (P10-S1, docs/signing.md) – Node only, no dependencies.
//
// Env: ASC_KEY_ID (key id), ASC_ISSUER_ID (issuer id), ASC_KEY_PATH (the AuthKey_<id>.p8 file). Nothing secret is
// printed: not the key, not the JWT; API errors show Apple's status, code and message only.
//
//   asc.mjs certificates list
//   asc.mjs certificates create --type DEVELOPER_ID_APPLICATION|IOS_DISTRIBUTION|DISTRIBUTION --csr <file> --out <cer>
//   asc.mjs bundle-ids list
//   asc.mjs bundle-ids register --id dev.rusuite.calc --name "Rusuite Calc" --platform IOS
//   asc.mjs profiles list
//   asc.mjs profiles create --bundle-id <identifier or resource id> --type IOS_APP_STORE --certificate <certId>
//     --out <file.mobileprovision> [--name <profile name>]
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const API = "https://api.appstoreconnect.apple.com/v1";
export const CERT_TYPES = ["DEVELOPER_ID_APPLICATION", "IOS_DISTRIBUTION", "DISTRIBUTION"];
export const PLATFORMS = ["IOS", "MAC_OS", "UNIVERSAL"];
export const PROFILE_TYPES = ["IOS_APP_STORE", "IOS_APP_ADHOC", "IOS_APP_DEVELOPMENT", "MAC_APP_DIRECT", "MAC_APP_STORE"];

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/**
 * The ES256 JWT App Store Connect expects (lifetime ≤ 20 minutes). `privateKey`: the .p8 PEM text or a KeyObject.
 * The signature is the raw r‖s pair (JOSE), not DER.
 */
export function makeJwt({ keyId, issuerId, privateKey, now = Date.now(), lifetime = 1200 }) {
  if (!keyId || !issuerId || !privateKey) throw new Error("ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH are required");
  if (lifetime > 1200) throw new Error("App Store Connect tokens live at most 20 minutes");
  const iat = Math.floor(now / 1000);
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = { iss: issuerId, iat, exp: iat + lifetime, aud: "appstoreconnect-v1" };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(sig)}`;
}

export class AscError extends Error {
  constructor(status, errors) {
    const first = errors?.[0] ?? {};
    super(`App Store Connect ${status}${first.code ? ` ${first.code}` : ""}: ${first.title ?? "request failed"}${first.detail ? ` – ${first.detail}` : ""}`);
    this.status = status;
    this.errors = errors ?? [];
  }
}

/** A minimal client: `token()` returns a fresh JWT, `fetch` is injectable (tests). */
export function client({ token, fetch: fetchImpl = globalThis.fetch }) {
  const request = async (method, path, body) => {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token()}`, accept: "application/json", ...(body && { "content-type": "application/json" }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) throw new AscError(res.status, json?.errors);
    return json;
  };
  /** All pages of a list endpoint (follows `links.next` on the same host only). */
  const list = async (path) => {
    const out = [];
    let next = path;
    while (next) {
      const page = await request("GET", next);
      out.push(...(page?.data ?? []));
      const link = page?.links?.next;
      next = link && link.startsWith(API) ? link.slice(API.length) : null;
    }
    return out;
  };
  return {
    request,
    listCertificates: () => list("/certificates?limit=200"),
    createCertificate: async ({ type, csr }) => {
      if (!CERT_TYPES.includes(type)) throw new Error(`--type must be one of ${CERT_TYPES.join(", ")}`);
      return request("POST", "/certificates", {
        data: { type: "certificates", attributes: { certificateType: type, csrContent: csr } },
      }).then((r) => r.data);
    },
    listBundleIds: () => list("/bundleIds?limit=200"),
    registerBundleId: async ({ identifier, name, platform }) => {
      if (!identifier || !name) throw new Error("--id and --name are required");
      if (!PLATFORMS.includes(platform)) throw new Error(`--platform must be one of ${PLATFORMS.join(", ")}`);
      return request("POST", "/bundleIds", { data: { type: "bundleIds", attributes: { identifier, name, platform } } }).then((r) => r.data);
    },
    /** The resource id of a bundle id given as identifier (dev.rusuite.calc) or as resource id. */
    async resolveBundleId(idOrIdentifier) {
      if (!String(idOrIdentifier).includes(".")) return idOrIdentifier;
      const found = await list(`/bundleIds?limit=200&filter[identifier]=${encodeURIComponent(idOrIdentifier)}`);
      const exact = found.find((b) => b.attributes?.identifier === idOrIdentifier);
      if (!exact) throw new Error(`bundle id ${idOrIdentifier} is not registered (bundle-ids register first)`);
      return exact.id;
    },
    listProfiles: () => list("/profiles?limit=200"),
    createProfile: async ({ name, type, bundleId, certificateIds }) => {
      if (!PROFILE_TYPES.includes(type)) throw new Error(`--type must be one of ${PROFILE_TYPES.join(", ")}`);
      if (!certificateIds?.length) throw new Error("--certificate is required");
      return request("POST", "/profiles", {
        data: {
          type: "profiles",
          attributes: { name, profileType: type },
          relationships: {
            bundleId: { data: { type: "bundleIds", id: bundleId } },
            certificates: { data: certificateIds.map((id) => ({ type: "certificates", id })) },
          },
        },
      }).then((r) => r.data);
    },
  };
}

const day = (iso) => String(iso ?? "").slice(0, 10) || "–";

/** CLI entry (tests call it with a fake env, fetch and writer). Returns the exit code. */
export async function run(argv, { env = process.env, fetch: fetchImpl = globalThis.fetch, log = console.log, now = () => Date.now() } = {}) {
  const [group, cmd, ...rest] = argv;
  const opt = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const optAll = (name) => rest.flatMap((v, i) => (rest[i - 1] === name ? [v] : []));
  const needOpt = (name) => {
    const v = opt(name);
    if (!v) throw new Error(`${name} is required`);
    return v;
  };
  let privateKey;
  const token = () => {
    privateKey ??= fs.readFileSync(env.ASC_KEY_PATH ?? "", "utf8");
    return makeJwt({ keyId: env.ASC_KEY_ID, issuerId: env.ASC_ISSUER_ID, privateKey, now: now() });
  };
  if (!env.ASC_KEY_ID || !env.ASC_ISSUER_ID || !env.ASC_KEY_PATH) throw new Error("set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH");
  const asc = client({ token, fetch: fetchImpl });
  const key = `${group} ${cmd}`;
  if (key === "certificates list") {
    for (const c of await asc.listCertificates()) {
      const a = c.attributes ?? {};
      log(`${c.id}\t${a.certificateType}\t${a.displayName ?? a.name ?? ""}\texpires ${day(a.expirationDate)}`);
    }
  } else if (key === "certificates create") {
    const type = needOpt("--type");
    const out = needOpt("--out");
    const csr = fs.readFileSync(needOpt("--csr"), "utf8");
    const c = await asc.createCertificate({ type, csr });
    const content = c.attributes?.certificateContent;
    if (!content) throw new Error("the response carries no certificateContent");
    fs.writeFileSync(out, Buffer.from(content, "base64"));
    log(`certificate ${c.id} (${type}) expires ${day(c.attributes?.expirationDate)} – DER written to ${out}`);
  } else if (key === "bundle-ids list") {
    for (const b of await asc.listBundleIds()) log(`${b.id}\t${b.attributes?.identifier}\t${b.attributes?.platform}\t${b.attributes?.name}`);
  } else if (key === "bundle-ids register") {
    const b = await asc.registerBundleId({ identifier: needOpt("--id"), name: needOpt("--name"), platform: opt("--platform") ?? "IOS" });
    log(`bundle id ${b.id} registered: ${b.attributes?.identifier}`);
  } else if (key === "profiles list") {
    for (const p of await asc.listProfiles()) {
      const a = p.attributes ?? {};
      log(`${p.id}\t${a.profileType}\t${a.name}\t${a.profileState ?? ""}\texpires ${day(a.expirationDate)}`);
    }
  } else if (key === "profiles create") {
    const bundle = needOpt("--bundle-id");
    const type = needOpt("--type");
    const out = needOpt("--out");
    const certificateIds = optAll("--certificate");
    const bundleId = await asc.resolveBundleId(bundle);
    const p = await asc.createProfile({ name: opt("--name") ?? `Rusuite ${bundle} ${type}`, type, bundleId, certificateIds });
    const content = p.attributes?.profileContent;
    if (!content) throw new Error("the response carries no profileContent");
    fs.writeFileSync(out, Buffer.from(content, "base64"));
    log(`profile ${p.id} (${type}) expires ${day(p.attributes?.expirationDate)} – written to ${out}`);
  } else {
    throw new Error(`unknown command: ${key.trim() || "(none)"}`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`asc: ${e.message}`);
      console.error("usage: see the header of scripts/signing/asc.mjs (docs/signing.md)");
      process.exit(1);
    },
  );
}
