// Tests of the App Store Connect client (P10-S1) with a throwaway P-256 key and a mocked fetch – Apple is never
// called: `node --test scripts/signing/*.test.mjs`.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { API, AscError, client, makeJwt, run } from "./asc.mjs";

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

test("makeJwt: ES256 header, App Store Connect claims, raw r‖s signature that verifies", () => {
  const jwt = makeJwt({ keyId: "ABC123DEFG", issuerId: "57246542-96fe-1a63-e053-0824d011072a", privateKey: pem, now: 1_700_000_000_000 });
  const [h, p, s] = jwt.split(".");
  assert.deepEqual(decode(h), { alg: "ES256", kid: "ABC123DEFG", typ: "JWT" });
  assert.deepEqual(decode(p), { iss: "57246542-96fe-1a63-e053-0824d011072a", iat: 1_700_000_000, exp: 1_700_001_200, aud: "appstoreconnect-v1" });
  const sig = Buffer.from(s, "base64url");
  assert.equal(sig.length, 64, "JOSE signature, not DER");
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig));
  assert.throws(() => makeJwt({ keyId: "x", issuerId: "y", privateKey: pem, lifetime: 1201 }), /20 minutes/);
  assert.throws(() => makeJwt({ keyId: "", issuerId: "y", privateKey: pem }), /ASC_KEY_ID/);
});

/** A fetch mock: records requests, answers from `routes` ("METHOD /path" → [status, body]). */
const mockFetch = (routes) => {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    const key = `${init.method} ${u.pathname.replace("/v1", "")}${u.search}`;
    calls.push({ key, init, body: init.body ? JSON.parse(init.body) : undefined });
    const [status, body] = routes[key] ?? [404, { errors: [{ status: "404", code: "NOT_FOUND", title: "no route", detail: key }] }];
    return { ok: status < 300, status, text: async () => JSON.stringify(body) };
  };
  return { fetch, calls };
};

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p10-s1-asc-"));
  const keyPath = path.join(dir, "AuthKey_TEST.p8");
  fs.writeFileSync(keyPath, pem);
  const env = { ASC_KEY_ID: "TESTKEY123", ASC_ISSUER_ID: "issuer-1", ASC_KEY_PATH: keyPath };
  const lines = [];
  return { dir, env, lines, log: (l) => lines.push(l) };
};

test("certificates create: posts the CSR, writes the DER certificate, prints id and expiry, never the token", async () => {
  const { dir, env, lines, log } = setup();
  const csr = "-----BEGIN CERTIFICATE REQUEST-----\nFAKE\n-----END CERTIFICATE REQUEST-----\n";
  fs.writeFileSync(path.join(dir, "r.csr"), csr);
  const der = Buffer.from([0x30, 0x82, 0x01, 0x0a]);
  const { fetch, calls } = mockFetch({
    "POST /certificates": [201, { data: { id: "CERT1", type: "certificates", attributes: { certificateContent: der.toString("base64"), expirationDate: "2031-10-22T00:00:00.000+00:00" } } }],
  });
  const out = path.join(dir, "devid.cer");
  await run(["certificates", "create", "--type", "DEVELOPER_ID_APPLICATION", "--csr", path.join(dir, "r.csr"), "--out", out], { env, fetch, log });
  assert.deepEqual(calls[0].body, { data: { type: "certificates", attributes: { certificateType: "DEVELOPER_ID_APPLICATION", csrContent: csr } } });
  assert.match(calls[0].init.headers.authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.deepEqual(fs.readFileSync(out), der);
  assert.deepEqual(lines, [`certificate CERT1 (DEVELOPER_ID_APPLICATION) expires 2031-10-22 – DER written to ${out}`]);
  assert.ok(!lines.join("").includes(calls[0].init.headers.authorization.slice(7)));
  await assert.rejects(run(["certificates", "create", "--type", "NOPE", "--csr", path.join(dir, "r.csr"), "--out", out], { env, fetch, log }), /--type must be one of/);
});

test("certificates list follows pagination; bundle-ids register and list", async () => {
  const { env, lines, log } = setup();
  const { fetch, calls } = mockFetch({
    "GET /certificates?limit=200": [200, { data: [{ id: "C1", attributes: { certificateType: "DISTRIBUTION", displayName: "Rusuite", expirationDate: "2027-10-22T00:00:00Z" } }], links: { next: `${API}/certificates?limit=200&cursor=Mg` } }],
    "GET /certificates?limit=200&cursor=Mg": [200, { data: [{ id: "C2", attributes: { certificateType: "DEVELOPER_ID_APPLICATION", name: "Dev ID", expirationDate: "2031-01-01T00:00:00Z" } }], links: {} }],
    "POST /bundleIds": [201, { data: { id: "B1", attributes: { identifier: "dev.rusuite.calc" } } }],
    "GET /bundleIds?limit=200": [200, { data: [{ id: "B1", attributes: { identifier: "dev.rusuite.calc", platform: "IOS", name: "Rusuite Calc" } }] }],
  });
  await run(["certificates", "list"], { env, fetch, log });
  assert.deepEqual(lines.splice(0), ["C1\tDISTRIBUTION\tRusuite\texpires 2027-10-22", "C2\tDEVELOPER_ID_APPLICATION\tDev ID\texpires 2031-01-01"]);
  await run(["bundle-ids", "register", "--id", "dev.rusuite.calc", "--name", "Rusuite Calc", "--platform", "IOS"], { env, fetch, log });
  assert.deepEqual(calls.at(-1).body, { data: { type: "bundleIds", attributes: { identifier: "dev.rusuite.calc", name: "Rusuite Calc", platform: "IOS" } } });
  await run(["bundle-ids", "list"], { env, fetch, log });
  assert.deepEqual(lines.splice(0), ["bundle id B1 registered: dev.rusuite.calc", "B1\tdev.rusuite.calc\tIOS\tRusuite Calc"]);
});

test("profiles create resolves the bundle identifier and writes the .mobileprovision", async () => {
  const { dir, env, lines, log } = setup();
  const profile = Buffer.from("fake provisioning profile");
  const { fetch, calls } = mockFetch({
    "GET /bundleIds?limit=200&filter[identifier]=dev.rusuite.calc": [200, { data: [
      { id: "B2", attributes: { identifier: "dev.rusuite.calc.widget" } },
      { id: "B1", attributes: { identifier: "dev.rusuite.calc" } },
    ] }],
    "POST /profiles": [201, { data: { id: "P1", attributes: { profileContent: profile.toString("base64"), expirationDate: "2027-10-22T00:00:00Z" } } }],
  });
  const out = path.join(dir, "calc.mobileprovision");
  await run(["profiles", "create", "--bundle-id", "dev.rusuite.calc", "--type", "IOS_APP_STORE", "--certificate", "C1", "--out", out], { env, fetch, log });
  assert.equal(calls[0].key, "GET /bundleIds?limit=200&filter[identifier]=dev.rusuite.calc");
  assert.deepEqual(calls[1].body.data.relationships, {
    bundleId: { data: { type: "bundleIds", id: "B1" } },
    certificates: { data: [{ type: "certificates", id: "C1" }] },
  });
  assert.deepEqual(calls[1].body.data.attributes, { name: "Rusuite dev.rusuite.calc IOS_APP_STORE", profileType: "IOS_APP_STORE" });
  assert.deepEqual(fs.readFileSync(out), profile);
  assert.deepEqual(lines, [`profile P1 (IOS_APP_STORE) expires 2027-10-22 – written to ${out}`]);
});

test("API errors surface Apple's code and message; missing env is reported", async () => {
  const { env, log } = setup();
  const { fetch } = mockFetch({
    "GET /profiles?limit=200": [401, { errors: [{ status: "401", code: "NOT_AUTHORIZED", title: "Authentication credentials are missing or invalid.", detail: "Provide a properly configured and signed bearer token" }] }],
  });
  await assert.rejects(run(["profiles", "list"], { env, fetch, log }), (e) => e instanceof AscError && e.status === 401 && /NOT_AUTHORIZED/.test(e.message) && !/Bearer/.test(e.message));
  await assert.rejects(run(["profiles", "list"], { env: {}, fetch, log }), /ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH/);
  await assert.rejects(run(["nope"], { env, fetch, log }), /unknown command/);
  await assert.rejects(client({ token: () => "t", fetch }).createProfile({ name: "x", type: "IOS_APP_STORE", bundleId: "B1", certificateIds: [] }), /--certificate/);
});
