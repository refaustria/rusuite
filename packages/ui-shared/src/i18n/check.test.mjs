// P9-L0: the rules of scripts/i18n-check.mjs (parity, plural completeness, informal register, untranslated values,
// allow-lists) with small fixtures, and the whole check on the repository.
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES, REGISTER, checkCatalog, looksUntranslated, pluralCategories, registerHit, run, staleEntries } from "../../../../scripts/i18n-check.mjs";
import { LOCALES } from "./locales";

const dir = "apps/x/locales";
const en = { "a.save": "Save", "a.hello": "Hello {name}", "a.files.one": "{count} file", "a.files.other": "{count} files", "a.err.other": "Other error" };
const check = (lang, msgs, allow) => checkCatalog({ dir, lang, en, msgs, allow });

describe("i18n-check", () => {
  it("lists the same 24 languages as the registry", () => {
    expect(LANGUAGES).toEqual(LOCALES.map((l) => l.id));
    expect(Object.keys(REGISTER).sort()).toEqual(LANGUAGES);
  });

  it("reports missing and extra keys and changed placeholders", () => {
    const { findings } = check("fr", { "a.save": "Enregistrer", "a.hello": "Salut {nom}", "a.files.one": "{count} fichier", "a.files.many": "{count} de fichiers", "a.files.other": "{count} fichiers", "a.extra": "x" });
    expect([...findings].sort()).toEqual(
      [
        `${dir}/fr.json: "a.hello" has other placeholders than en.json`,
        `${dir}/fr.json: missing key "a.err.other"`,
        `${dir}/fr.json: extra key "a.extra" (not in en.json)`,
      ].sort(),
    );
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
    expect(looksUntranslated("Unicode (UTF-8)", "Unicode (UTF-8)")).toBe(false);
    expect(looksUntranslated("Apple Silicon (.dmg)", "Apple Silicon (.dmg)")).toBe(false);
    expect(looksUntranslated("Save As", "Enregistrer sous")).toBe(false);
    const en2 = { "b.saveAs": "Save As…", "b.close": "Close the file", "b.other": "Other error", "b.ok": "OK" };
    const msgs = { "b.saveAs": "Enregistrer sous…", "b.close": "Close the file", "b.other": "Other error", "b.ok": "OK" };
    const { findings, used } = checkCatalog({ dir, lang: "fr", en: en2, msgs, allow: { untranslated: { [`${dir}:b.other`]: "test", [`${dir}:b.gone`]: "old" } } });
    expect(findings).toEqual([`${dir}/fr.json: "b.close" is identical to English – untranslated? (allow-list scripts/i18n-allow/fr.json)`]);
    expect(staleEntries("fr", { untranslated: { [`${dir}:b.other`]: "test", [`${dir}:b.gone`]: "old" } }, used)).toEqual([`scripts/i18n-allow/fr.json: stale untranslated entry "${dir}:b.gone"`]);
  });

  it("passes on the repository with English and German only", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    const { findings, languages } = run(root);
    expect(findings).toEqual([]);
    expect(languages.en).toBe(5);
    expect(languages.de).toBe(5);
  });
});
