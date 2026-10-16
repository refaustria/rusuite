// Home › Number (P8-23): the Number Format box with Excel's eleven entries
// and a preview of the active cell's value in each, Accounting ▾ (€ $ £ ¥),
// Percent Style, Comma Style and Increase / Decrease Decimal (every family
// with digits: number, currency, accounting, percentage, scientific).

import { useEffect, useState } from "react";
import { RibbonButton, RibbonMenuButton, RibbonRow, RibbonSplitButton, RibbonStack, useLocale, type CellStylePatch } from "@rusuite/ui-shared";
import {
  accountingCode, changeDecimals, previewValue, shownDecimals, QUICK_FORMATS, quickCode, quickOf, SAMPLE_VALUE, type CurrencySymbol, type QuickFormat,
} from "../numberFormat";
import { useT } from "../i18n";
import type { CalcStore } from "../state/store";
import { accountingIcon } from "./icons";

/** The UI language's currency (`€` in German, `$` in English). */
export function localCurrency(locale: string): CurrencySymbol {
  return locale === "de" ? "€" : "$";
}

/** Excel's Comma Style: the accounting format without symbol. */
export const COMMA_STYLE = accountingCode("", 2);

function QuickFormatMenu({ store, close, onPick }: { store: CalcStore; close: () => void; onPick: (code: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const symbol = localCurrency(locale);
  const german = locale === "de";
  const cell = store.activeCell();
  const value = previewValue(cell) ?? SAMPLE_VALUE;
  const [samples, setSamples] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    void Promise.all(QUICK_FORMATS.map((q) => store.api.formatPreview(value, quickCode(q, symbol, german)).then((s) => [q, s] as const, () => [q, ""] as const))).then(
      (list) => live && setSamples(Object.fromEntries(list)),
    );
    return () => {
      live = false;
    };
  }, [store, value, symbol, german]);
  return (
    <div role="menu" aria-label={t("fmt.number")} className="flex w-60 flex-col py-0.5" data-testid="number-format-menu">
      {QUICK_FORMATS.map((q) => (
        <button
          key={q}
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-ui-hover focus:bg-ui-hover focus:outline-none"
          onClick={() => {
            close();
            onPick(quickCode(q, symbol, german));
          }}
        >
          <span className="flex-1">{t(`calc.quick.${q}`)}</span>
          <span className="max-w-28 truncate font-mono text-xs text-ui-muted">{samples[q] ?? ""}</span>
        </button>
      ))}
      <div role="separator" className="my-1 border-t border-ui-border" />
      <button
        type="button"
        role="menuitem"
        className="rounded px-2 py-1 text-left text-sm hover:bg-ui-hover"
        onClick={() => {
          close();
          store.openDialog({ kind: "numberFormat" });
        }}
      >
        {t("calc.quick.more")}
      </button>
    </div>
  );
}

export function NumberGroup({ store, disabled, onChange }: { store: CalcStore; disabled: boolean; onChange: (patch: CellStylePatch) => void }) {
  const t = useT();
  const locale = useLocale();
  const symbol = localCurrency(locale);
  const code = store.activeStyle().numberFormat ?? "General";
  const quick: QuickFormat | null = quickOf(code, symbol, locale === "de");
  const accounting = (s: CurrencySymbol) => onChange({ numberFormat: accountingCode(s, 2) });
  return (
    <RibbonStack>
      <RibbonRow>
        <RibbonMenuButton
          label={quick ? t(`calc.quick.${quick}`) : t("calc.cat.custom")}
          tooltip={t("calc.quick.box")}
          showLabel
          disabled={disabled}
          menu={(close) => <QuickFormatMenu store={store} close={close} onPick={(c) => onChange({ numberFormat: c })} />}
        />
      </RibbonRow>
      <RibbonRow>
        <RibbonSplitButton
          label={t("calc.accounting")}
          icon={accountingIcon()}
          disabled={disabled}
          onClick={() => accounting(symbol)}
          menuLabel={t("calc.accountingMenu")}
          menu={[
            { id: "eur", label: t("calc.accounting.eur"), onSelect: () => accounting("€") },
            { id: "usd", label: t("calc.accounting.usd"), onSelect: () => accounting("$") },
            { id: "gbp", label: t("calc.accounting.gbp"), onSelect: () => accounting("£") },
            { id: "jpy", label: t("calc.accounting.jpy"), onSelect: () => accounting("¥") },
            { separator: true },
            { id: "more", label: t("calc.accounting.more"), onSelect: () => store.openDialog({ kind: "numberFormat" }) },
          ]}
        />
        <RibbonButton label={t("calc.percentStyle")} icon="percent" shortcut="Mod+Shift+5" disabled={disabled} onClick={() => onChange({ numberFormat: "0%" })} />
        <RibbonButton label={t("calc.commaStyle")} icon="comma" disabled={disabled} onClick={() => onChange({ numberFormat: COMMA_STYLE })} />
        <RibbonButton label={t("calc.decimalMore")} icon="decimalMore" disabled={disabled} onClick={() => onChange({ numberFormat: changeDecimals(code, 1, shownDecimals(store.activeCell()?.display)) })} />
        <RibbonButton label={t("calc.decimalLess")} icon="decimalLess" disabled={disabled} onClick={() => onChange({ numberFormat: changeDecimals(code, -1, shownDecimals(store.activeCell()?.display)) })} />
      </RibbonRow>
    </RibbonStack>
  );
}
