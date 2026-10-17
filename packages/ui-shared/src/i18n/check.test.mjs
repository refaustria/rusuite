// P9-L0: the rules of scripts/i18n-check.mjs (parity, plural completeness, informal register, untranslated values,
// allow-lists) with small fixtures, and the whole check on the repository. P9-L0b: pending keys and `--strict`.
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES, PACKAGES, PORTAL, REGISTER, checkCatalog, isStrict, looksUntranslated, pendingLines, pluralCategories, registerHit, run, staleEntries } from "../../../../scripts/i18n-check.mjs";
import { LOCALES } from "./locales";

const dir = "apps/x/locales";
const en = { "a.save": "Save", "a.hello": "Hello {name}", "a.files.one": "{count} file", "a.files.other": "{count} files", "a.err.other": "Other error" };
const check = (lang, msgs, allow) => checkCatalog({ dir, lang, en, msgs, allow });

describe("i18n-check", () => {
  it("lists the same 24 languages as the registry", () => {
    expect(LANGUAGES).toEqual(LOCALES.map((l) => l.id));
    expect(Object.keys(REGISTER).sort()).toEqual(LANGUAGES);
  });

  it("reports missing (core languages) and extra keys and changed placeholders", () => {
    const { findings, pending } = check("de", { "a.save": "Speichern", "a.hello": "Hallo {vorname}", "a.files.one": "{count} Datei", "a.files.other": "{count} Dateien", "a.extra": "x" });
    expect(pending).toEqual([]);
    expect([...findings].sort()).toEqual(
      [`${dir}/de.json: "a.hello" has other placeholders than en.json`, `${dir}/de.json: missing key "a.err.other"`, `${dir}/de.json: extra key "a.extra" (not in en.json)`].sort(),
    );
  });

  it("a key missing in a translated language is pending, not a finding", () => {
    const { findings, pending } = check("fr", { "a.save": "Enregistrer", "a.hello": "Salut {nom}", "a.files.one": "{count} fichier", "a.files.many": "{count} de fichiers", "a.files.other": "{count} fichiers", "a.extra": "x" });
    expect([...findings].sort()).toEqual(
      [
        `${dir}/fr.json: "a.hello" has other placeholders than en.json`,
        `${dir}/fr.json: extra key "a.extra" (not in en.json)`,
      ].sort(),
    );
    expect(pending).toEqual(["a.err.other"]);
  });

  it("a whole missing plural group is pending, a partial one fails", () => {
    const msgs = { "a.save": "Zapisz", "a.hello": "Cześć {name}", "a.err.other": "Inny błąd" };
    expect(check("pl", msgs)).toMatchObject({ findings: [], pending: ["a.files"] });
    expect(check("pl", { ...msgs, "a.files.one": "{count} plik", "a.files.few": "{count} pliki", "a.files.other": "{count} pliku" })).toMatchObject({
      findings: [`${dir}/pl.json: missing plural form "a.files.many" (pl: few/many/one/other)`],
      pending: [],
    });
  });

  it("--strict or I18N_STRICT=1 turns pending keys into findings", () => {
    expect(isStrict([], {})).toBe(false);
    expect(isStrict(["--strict"], {})).toBe(true);
    expect(isStrict([], { I18N_STRICT: "1" })).toBe(true);
    expect(isStrict([], { I18N_STRICT: "0" })).toBe(false);
  });

  it("needs every plural category of the language", () => {
    expect(pluralCategories("pl")).toEqual(["few", "many", "one", "other"]);
    const { findings } = check("pl", { "a.save": "Zapisz", "a.hello": "Cześć {name}", "a.err.other": "Inny błąd", "a.files.one": "{count} plik", "a.files.other": "{count} pliku" });
    expect(findings).toEqual([`${dir}/pl.json: missing plural form "a.files.few" (pl: few/many/one/other)`, `${dir}/pl.json: missing plural form "a.files.many" (pl: few/many/one/other)`]);
  });

  it("rejects plural categories the language does not have", () => {
    const { findings } = check("de", { "a.save": "Speichern", "a.hello": "Hallo {name}", "a.err.other": "Anderer Fehler", "a.files.one": "{count} Datei", "a.files.few": "{count} Dateien", "a.files.other": "{count} Dateien" });
    expect(findings).toEqual([`${dir}/de.json: extra key "a.files.few" (de has no plural category "few")`]);
  });

  it("a lone .other is an ordinary key, not a plural group", () => {
    const { findings } = check("de", { "a.save": "Speichern", "a.hello": "Hallo {name}", "a.err.other": "Anderer Fehler", "a.files.one": "1 Datei", "a.files.other": "{count} Dateien" });
    expect(findings).toEqual([]);
  });

  it.each([
    ["de", "Speichern Sie die Datei", "Speichere die Datei"],
    ["fr", "Enregistrez votre fichier", "Enregistre ton fichier"],
    ["es", "¿Desea usted guardar?", "¿Quieres guardar?"],
    ["it", "La preghiamo di salvare", "Salva il tuo file"],
    ["nl", "Sla uw bestand op", "Sla je bestand op"],
    ["pl", "Czy Pan chce zapisać?", "Czy chcesz zapisać?"],
    ["hu", "Ön menti a fájlt", "Mentsd a fájlt"],
    ["ro", "Salvați dumneavoastră fișierul", "Salvează fișierul tău"],
    ["cs", "Uložte Váš soubor", "Ulož svůj soubor"],
    ["sv", "Spara Er fil", "Spara din fil"],
    ["fi", "Tallentakaa Teidän tiedosto", "Tallenna tiedostosi"],
    ["el", "Αποθηκεύστε το αρχείο σας", "Αποθήκευσε το αρχείο σου"],
    ["bg", "Запазете Вашия файл", "Запази файла си"],
    ["hr", "Spremite Vaš dokument", "Spremi svoj dokument"],
    ["lt", "Išsaugokite jūsų failą", "Išsaugok savo failą"],
    ["pt", "Você pode guardar", "Podes guardar"],
  ])("flags the formal address in %s", (lang, formal, informal) => {
    expect(registerHit(lang, formal), formal).not.toBeNull();
    expect(registerHit(lang, informal), informal).toBeNull();
  });

  it("matches whole words only, outside placeholders and markup", () => {
    expect(registerHit("nl", "Sluit het venster")).toBeNull(); // "u" inside words
    expect(registerHit("de", "Die Zellen werden geleert; sie bleiben leer")).toBeNull(); // lower-case third person
    expect(registerHit("fr", "Ouvre {vous}")).toBeNull();
    expect(registerHit("fr", '<a href="vous">Ouvre</a>')).toBeNull();
    expect(registerHit("en", "You can save")).toBeNull();
  });

  it("allow-lists a genuine third-person use and reports stale entries", () => {
    const msgs = { "a.save": "Speichern", "a.hello": "Hallo {name}", "a.err.other": "Sie werden geleert", "a.files.one": "{count} Datei", "a.files.other": "{count} Dateien" };
    expect(check("de", msgs).findings[0]).toMatch(/"a\.err\.other" uses the formal "Sie"/);
    const allow = { register: { [`${dir}:a.err.other`]: "Sie = they", [`${dir}:a.gone`]: "old" } };
    const { findings, used } = check("de", msgs, allow);
    expect(findings).toEqual([]);
    expect(staleEntries("de", allow, used)).toEqual([`scripts/i18n-allow/de.json: stale register entry "${dir}:a.gone"`]);
  });

  it("flags untranslated values of two or more words, except brand names and the allow-list", () => {
    expect(looksUntranslated("Save As", "Save As")).toBe(true);
    expect(looksUntranslated("Layout", "Layout")).toBe(false);
    expect(looksUntranslated("Horizontal (cm)", "Horizontal (cm)")).toBe(false); // a unit is not a second word
    expect(looksUntranslated("Width (cm)", "Width (cm)")).toBe(false);
    expect(looksUntranslated("Unicode (UTF-8)", "Unicode (UTF-8)")).toBe(false);
    expect(looksUntranslated("Apple Silicon (.dmg)", "Apple Silicon (.dmg)")).toBe(false);
    expect(looksUntranslated("Save As", "Enregistrer sous")).toBe(false);
    const en2 = { "b.saveAs": "Save As…", "b.close": "Close the file", "b.other": "Other error", "b.ok": "OK" };
    const msgs = { "b.saveAs": "Enregistrer sous…", "b.close": "Close the file", "b.other": "Other error", "b.ok": "OK" };
    const { findings, used } = checkCatalog({ dir, lang: "fr", en: en2, msgs, allow: { untranslated: { [`${dir}:b.other`]: "test", [`${dir}:b.gone`]: "old" } } });
    expect(findings).toEqual([`${dir}/fr.json: "b.close" is identical to English – untranslated? (allow-list scripts/i18n-allow/fr.json)`]);
    expect(staleEntries("fr", { untranslated: { [`${dir}:b.other`]: "test", [`${dir}:b.gone`]: "old" } }, used)).toEqual([`scripts/i18n-allow/fr.json: stale untranslated entry "${dir}:b.gone"`]);
  });

  describe("on a fixture repository", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-check-"));
    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const enAll = { "x.save": "Save", "x.open": "Open the file", "x.files.one": "{count} file", "x.files.other": "{count} files" };
    const deAll = { "x.save": "Speichern", "x.open": "Öffne die Datei", "x.files.one": "{count} Datei", "x.files.other": "{count} Dateien" };
    const frAll = { "x.save": "Enregistrer", "x.open": "Ouvre le fichier", "x.files.one": "{count} fichier", "x.files.many": "{count} de fichiers", "x.files.other": "{count} fichiers" };
    /** A repository with every locales dir holding en/de/fr; `fr` overrides the French catalog of the calc dir. */
    const repo = (name, fr) => {
      const root = path.join(tmp, name);
      for (const pkg of PACKAGES) fs.mkdirSync(path.join(root, pkg.src), { recursive: true });
      for (const d of [...PACKAGES.map((p) => p.locales), PORTAL.locales]) {
        fs.mkdirSync(path.join(root, d), { recursive: true });
        const write = (lang, msgs) => fs.writeFileSync(path.join(root, d, `${lang}.json`), JSON.stringify(msgs));
        write("en", enAll);
        write("de", deAll);
        write("fr", d === "apps/calc/src/locales" ? fr : frAll);
      }
      fs.writeFileSync(path.join(root, PORTAL.dir, "i18n.js"), 'const CATALOGS = ["de", "en", "fr"];\n');
      return root;
    };

    it("a missing key passes by default and fails with --strict", () => {
      const root = repo("missing", { "x.save": "Enregistrer" });
      const lax = run(root);
      expect(lax.findings).toEqual([]);
      expect(lax.pending).toEqual({ fr: { "apps/calc/src/locales/fr.json": ["x.open", "x.files"] } });
      expect(pendingLines(lax.pending)).toEqual(["fr: 2 keys pending (apps/calc/src/locales/fr.json 2)"]);
      expect(run(root, { strict: true }).findings).toEqual([
        'apps/calc/src/locales/fr.json: missing key "x.open" (pending; --strict)',
        'apps/calc/src/locales/fr.json: missing key "x.files" (pending; --strict)',
      ]);
    });

    it("an extra key fails in both modes", () => {
      const root = repo("extra", { ...frAll, "x.gone": "Parti" });
      const finding = 'apps/calc/src/locales/fr.json: extra key "x.gone" (not in en.json)';
      expect(run(root).findings).toEqual([finding]);
      expect(run(root, { strict: true }).findings).toEqual([finding]);
      expect(run(root).pending).toEqual({});
    });
  });

  it("passes on the repository with English and German only", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    const { findings, languages } = run(root);
    expect(findings).toEqual([]);
    expect(languages.en).toBe(5);
    expect(languages.de).toBe(5);
  });
});
