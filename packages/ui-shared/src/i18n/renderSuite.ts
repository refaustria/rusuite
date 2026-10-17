// The per-language render test of every app (P9-L0): `apps/*/src/i18n.test.tsx` calls `localeRenderTests` with a
// function mounting the app; for each UI language with catalogs it renders the app in that language and checks the
// ribbon and the File backstage (translated File/Home tabs and Save command, `<html lang>`, no raw catalog keys).
// Languages whose catalogs have not landed yet are skipped and counted in a "pending" test title. Test-only module:
// not exported from the package index.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { LOCALES } from "./locales";
import { getLocale, hasCatalog, i18n, setLocale, switchLocale } from "./locale";

/** Text that looks like an untranslated catalog key (`backstage.save`, `calc.fmt.title`). */
const RAW_KEY = /\b(?:ribbon|backstage|tab|group|cmd|language|print|dialog|calc|write|show)\.[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*\b/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function localeRenderTests(app: string, mount: () => Promise<unknown>): void {
  const pending = LOCALES.filter((l) => !hasCatalog(l.id));
  describe(`${app} in every UI language`, () => {
    afterEach(() => {
      cleanup();
      setLocale("en", { persist: false });
    });

    it(`pending: ${pending.length} of ${LOCALES.length} languages without catalogs yet${pending.length ? ` (${pending.map((l) => l.id).join(", ")})` : ""}`, () => {
      expect(LOCALES.length - pending.length).toBeGreaterThanOrEqual(2);
    });

    for (const l of LOCALES) {
      it.skipIf(!hasCatalog(l.id))(`${l.id} (${l.english}): ribbon and backstage`, async () => {
        await switchLocale(l.id, { persist: false });
        expect(getLocale()).toBe(l.id);
        await mount();
        const tr = i18n.bind(l.id);
        expect(document.documentElement.lang).toBe(l.id);
        expect(screen.getByRole("tab", { name: tr("tab.home") })).toBeTruthy();
        const toolbar = document.body.textContent ?? "";
        expect(toolbar).not.toMatch(RAW_KEY);
        fireEvent.click(screen.getByRole("tab", { name: tr("ribbon.file") }));
        const backstage = screen.getByTestId("backstage");
        expect(within(backstage).getAllByRole("button", { name: new RegExp(`^${escape(tr("backstage.save"))}`) }).length).toBeGreaterThan(0);
        expect(within(backstage).getByRole("combobox", { name: tr("language.label") })).toBeTruthy();
        expect(backstage.textContent ?? "").not.toMatch(RAW_KEY);
      });
    }
  });
}
