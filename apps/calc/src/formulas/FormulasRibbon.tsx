// Calc's Formulas tab (P8-23): Function Library (Insert Function, AutoSum ▾,
// Recently Used and the category menus from functions.json), Defined
// Names (Name Manager, Define Name ▾, Use in Formula ▾, Create from
// Selection) and Formula Auditing (Trace Precedents / Dependents, Remove
// Arrows ▾, Show Formulas). Error Checking, Evaluate Formula and the
// Calculation group are not offered (the core recalculates
// automatically and has no manual mode).

import { RibbonButton, RibbonMenuButton, RibbonSplitButton, RibbonStack, type RibbonTab, type TFunction as T } from "@rusuite/ui-shared";
import type { FunctionInfo } from "../formula/functions";
import type { CalcStore } from "../state/store";
import {
  createNamesIcon, defineNameIcon, fxIcon, libraryIcon, nameManagerIcon, removeArrowsIcon, showFormulasIcon, sigmaIcon, traceDependentsIcon,
  tracePrecedentsIcon, useNameIcon,
} from "../ui/icons";
import { categoryFunctions } from "./InsertFunctionDialog";

/** AutoSum ▾'s functions (Excel's list). */
export const AUTOSUM_FUNCTIONS = ["SUM", "AVERAGE", "COUNT", "MAX", "MIN"] as const;

/** A scrollable function menu (categories hold up to 66 functions). */
function FunctionMenu({ label, functions, onPick, footer }: { label: string; functions: FunctionInfo[]; onPick: (name: string) => void; footer?: { label: string; onSelect: () => void } }) {
  return (
    <div role="menu" aria-label={label} className="flex max-h-80 min-w-44 flex-col overflow-auto py-0.5">
      {functions.map((f) => (
        <button
          key={f.name}
          type="button"
          role="menuitem"
          title={`${f.signature}\n${f.description}`}
          className="rounded px-2 py-0.5 text-left font-mono text-sm text-ui-fg hover:bg-ui-hover focus:bg-ui-hover focus:outline-none"
          onClick={() => onPick(f.name)}
          onKeyDown={(e) => {
            const items = Array.from((e.currentTarget.parentElement?.querySelectorAll("button") ?? []) as NodeListOf<HTMLButtonElement>);
            const i = items.indexOf(e.currentTarget);
            if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
            else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
            else return;
            e.preventDefault();
          }}
        >
          {f.name}
        </button>
      ))}
      {footer && (
        <>
          <div role="separator" className="my-1 border-t border-ui-border" />
          <button type="button" role="menuitem" className="rounded px-2 py-0.5 text-left text-sm hover:bg-ui-hover" onClick={footer.onSelect}>
            {footer.label}
          </button>
        </>
      )}
    </div>
  );
}

export function formulasTab(store: CalcStore, t: T, off: boolean): RibbonTab {
  const st = store.getState();
  const insertFn = (category?: string) => () => store.openDialog({ kind: "insertFunction", ...(category ? { category } : {}) });
  const fnMenu = (id: string, label: string, list: () => FunctionInfo[]) => (
    <RibbonMenuButton
      key={id}
      label={label}
      icon={libraryIcon()}
      showLabel
      disabled={off}
      menu={(close) => (
        <FunctionMenu
          label={label}
          functions={list()}
          onPick={(name) => {
            close();
            store.insertIntoFormula(name, true);
          }}
          footer={{
            label: t("calc.fn.insertDots"),
            onSelect: () => {
              close();
              store.openDialog({ kind: "insertFunction", category: id });
            },
          }}
        />
      )}
    />
  );
  const names = store.names.formulaNames();
  const arrows = store.trace.arrows.length > 0;
  return {
    id: "formulas",
    label: t("calc.tab.formulas"),
    groups: [
      {
        label: t("calc.fn.library"),
        items: (
          <>
            <RibbonButton label={t("calc.fn.insert")} icon={fxIcon()} size="large" shortcut="Shift+F3" disabled={off} onClick={insertFn()} />
            <RibbonSplitButton
              label={t("calc.fn.autoSum")}
              icon={sigmaIcon()}
              size="large"
              shortcut="Alt+="
              disabled={off}
              onClick={() => store.autoSum("SUM")}
              menuLabel={t("calc.fn.autoSumMenu")}
              menu={[
                ...AUTOSUM_FUNCTIONS.map((f) => ({ id: f, label: t(`calc.fn.auto.${f.toLowerCase()}`), onSelect: () => store.autoSum(f) })),
                { separator: true as const },
                { id: "more", label: t("calc.fn.moreFunctions"), onSelect: insertFn("all") },
              ]}
            />
            <RibbonStack>
              {fnMenu("recent", t("calc.fn.cat.recent"), () => categoryFunctions("recent", store.recentFunctions()))}
              {fnMenu("financial", t("calc.fn.cat.financial"), () => categoryFunctions("financial", []))}
            </RibbonStack>
            <RibbonStack>
              {fnMenu("logical", t("calc.fn.cat.logical"), () => categoryFunctions("logical", []))}
              {fnMenu("text", t("calc.fn.cat.text"), () => categoryFunctions("text", []))}
            </RibbonStack>
            <RibbonStack>
              {fnMenu("datetime", t("calc.fn.cat.datetime"), () => categoryFunctions("datetime", []))}
              {fnMenu("lookup", t("calc.fn.cat.lookup"), () => categoryFunctions("lookup", []))}
            </RibbonStack>
            <RibbonStack>
              {fnMenu("math", t("calc.fn.cat.math"), () => categoryFunctions("math", []))}
              <RibbonMenuButton
                label={t("calc.fn.more")}
                icon={libraryIcon()}
                showLabel
                disabled={off}
                menu={(close) => (
                  <FunctionMenu
                    label={t("calc.fn.more")}
                    functions={[...categoryFunctions("statistical", []), ...categoryFunctions("info", [])]}
                    onPick={(name) => {
                      close();
                      store.insertIntoFormula(name, true);
                    }}
                    footer={{
                      label: t("calc.fn.insertDots"),
                      onSelect: () => {
                        close();
                        store.openDialog({ kind: "insertFunction", category: "statistical" });
                      },
                    }}
                  />
                )}
              />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("calc.names.group"),
        items: (
          <>
            <RibbonButton label={t("calc.names.manager")} icon={nameManagerIcon()} size="large" shortcut="Mod+F3" disabled={off} onClick={() => store.openDialog({ kind: "nameManager" })} />
            <RibbonStack>
              <RibbonSplitButton
                label={t("calc.names.define")}
                icon={defineNameIcon()}
                showLabel
                disabled={off}
                onClick={() => store.openDialog({ kind: "defineName" })}
                menuLabel={t("calc.names.defineMenu")}
                menu={[{ id: "define", label: t("calc.names.defineDots"), onSelect: () => store.openDialog({ kind: "defineName" }) }]}
              />
              <RibbonMenuButton
                label={t("calc.names.useInFormula")}
                icon={useNameIcon()}
                showLabel
                disabled={off || names.length === 0}
                menu={names.map((n) => ({ id: `${n.sheet ?? ""}:${n.name}`, label: n.name, onSelect: () => store.insertIntoFormula(n.name) }))}
              />
            </RibbonStack>
            <RibbonStack>
              <RibbonButton label={t("calc.names.createFromSelection")} icon={createNamesIcon()} showLabel shortcut="Mod+Shift+F3" disabled={off} onClick={() => store.openDialog({ kind: "createNames" })} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("calc.audit.group"),
        items: (
          <>
            <RibbonStack>
              <RibbonButton label={t("calc.audit.tracePrecedents")} icon={tracePrecedentsIcon()} showLabel disabled={off} onClick={() => void store.trace.precedents()} />
              <RibbonButton label={t("calc.audit.traceDependents")} icon={traceDependentsIcon()} showLabel disabled={off} onClick={() => void store.trace.dependents()} />
            </RibbonStack>
            <RibbonStack>
              <RibbonSplitButton
                label={t("calc.audit.removeArrows")}
                icon={removeArrowsIcon()}
                showLabel
                disabled={off || !arrows}
                onClick={() => store.trace.clear()}
                menuLabel={t("calc.audit.removeArrowsMenu")}
                menu={[
                  { id: "all", label: t("calc.audit.removeArrows"), onSelect: () => store.trace.clear() },
                  { id: "precedents", label: t("calc.audit.removePrecedentArrows"), onSelect: () => store.trace.clear("precedents") },
                  { id: "dependents", label: t("calc.audit.removeDependentArrows"), onSelect: () => store.trace.clear("dependents") },
                ]}
              />
              <RibbonButton
                label={t("calc.audit.showFormulas")}
                icon={showFormulasIcon()}
                showLabel
                shortcut="Mod+`"
                pressed={st.showFormulas}
                disabled={off}
                onClick={() => store.toggleShowFormulas()}
              />
            </RibbonStack>
          </>
        ),
      },
    ],
  };
}
