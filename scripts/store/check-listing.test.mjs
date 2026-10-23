import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APPS, LANGS, checkDir, checkListing, checkReleaseNotes } from "./check-listing.mjs";

const good = (app) => {
  const name = `Rusuite ${app[0].toUpperCase()}${app.slice(1)}`;
  const ext = { calc: ".xlsx", write: ".docx", show: ".pptx" }[app];
  const text = `${name} opens ${ext}.\n\nNew in 3.1415`;
  return { title: name, shortDescription: "short", subtitle: "sub", fullDescription: text, description: text, keywords: "a,b,c", promotionalText: "promo", whatsNew: "New in 3.1415", privacyAnswer: "none" };
};
const goodFile = () => Object.fromEntries(APPS.map((a) => [a, good(a)]));

test("a complete file passes", () => assert.deepEqual(checkListing("en", goodFile()), []));

test("missing app and empty field are reported", () => {
  const d = goodFile();
  delete d.show;
  d.calc.subtitle = " ";
  const e = checkListing("en", d);
  assert.ok(e.some((m) => m.includes("en/show: missing")));
  assert.ok(e.some((m) => m.includes("calc.subtitle: missing or empty")));
});

test("length limits", () => {
  const d = goodFile();
  d.write.subtitle = "x".repeat(31);
  d.write.shortDescription = "x".repeat(81);
  d.write.keywords = "k".repeat(101);
  d.write.promotionalText = "x".repeat(171);
  const e = checkListing("en", d);
  for (const f of ["subtitle", "shortDescription", "keywords", "promotionalText"]) assert.ok(e.some((m) => m.includes(`write.${f}`)), f);
  d.write.subtitle = "ä".repeat(30);
  assert.ok(!checkListing("en", d).some((m) => m.includes("write.subtitle")));
});

test("placeholder leftovers and unknown fields", () => {
  const d = goodFile();
  d.calc.promotionalText = "Hello {name}";
  d.calc.whatsNew = "TODO 3.1415";
  d.calc.extra = "x";
  const e = checkListing("en", d);
  assert.ok(e.some((m) => m.includes("promotionalText: placeholder")));
  assert.ok(e.some((m) => m.includes("whatsNew: placeholder")));
  assert.ok(e.some((m) => m.includes('unknown field "extra"')));
});

test("title, product name, format and version are enforced", () => {
  const d = goodFile();
  d.calc.title = "Rusuite Tabellen";
  d.write.fullDescription = d.write.description = "Text 3.1415";
  d.show.whatsNew = "New";
  const e = checkListing("de", d);
  assert.ok(e.some((m) => m.includes("calc.title")));
  assert.ok(e.some((m) => m.includes("write.fullDescription: product name")));
  assert.ok(e.some((m) => m.includes("show.whatsNew: version")));
});

test("keywords must not contain spaces around commas", () => {
  const d = goodFile();
  d.calc.keywords = "a, b";
  assert.ok(checkListing("en", d).some((m) => m.includes("keywords")));
});

test("release notes", () => {
  assert.deepEqual(checkReleaseNotes("en", "New in 3.1415\n• a\n"), []);
  assert.equal(checkReleaseNotes("en", "x".repeat(501)).length, 1);
  assert.equal(checkReleaseNotes("en", undefined).length, 1);
});

test("a folder needs all 24 languages, release notes and review notes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "listing-"));
  fs.mkdirSync(path.join(dir, "listing"));
  fs.mkdirSync(path.join(dir, "release-notes"));
  for (const l of LANGS) {
    fs.writeFileSync(path.join(dir, "listing", `${l}.json`), JSON.stringify(goodFile()));
    fs.writeFileSync(path.join(dir, "release-notes", `${l}.txt`), "New in 3.1415\n");
  }
  assert.deepEqual(checkDir(dir), ["review-notes.txt: missing or empty"]);
  fs.writeFileSync(path.join(dir, "review-notes.txt"), "notes");
  assert.deepEqual(checkDir(dir), []);
  fs.rmSync(path.join(dir, "listing", "ga.json"));
  fs.writeFileSync(path.join(dir, "listing", "xx.json"), "{}");
  const e = checkDir(dir);
  assert.ok(e.includes("listing/ga.json: missing"));
  assert.ok(e.some((m) => m.includes("xx.json")));
  fs.rmSync(dir, { recursive: true });
});
