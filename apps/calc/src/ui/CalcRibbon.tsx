// Calc's ribbon: File (backstage) / Home / Insert / Formulas / Data / View. The commands
// reuse `calcActions` (shared with the shortcuts and context menus, whose
// dialogs CalcDialogs renders) and, for the dialogs owned by the
// ShortcutLayer (Save As, New with its discard prompt, shortcut help), the
// shortcut map.

import { aiRibbonGroup, HelpMenu } from "@rusuite/ui-shared";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlignmentControls, BordersDropdown, ColorControls, FontControls, RIBBON_SELECT, Ribbon, RibbonButton,
  RibbonMenuButton, RibbonRow, RibbonSplitButton, RibbonStack, StyleToggles, triggerShortcut, type AnySession, type CellStylePatch,
  type FormatControlProps, type RibbonTab, languageRibbonGroup, contextualTabs, CONTEXT_COLORS,
} from "@rusuite/ui-shared";
import { useT } from "../i18n";
import { calcActions } from "../calcActions";
import { sheetMenu } from "../SheetTabs";
import { toolbarValue } from "../grid/style";
import { useCalc, type CalcStore } from "../state/store";
import { CfMenu } from "../condFormat/CfMenu";
import { chartDesignTab, chartFormatTab, chartsInsertGroup } from "../charts/ChartRibbon";
import { formulasTab } from "../formulas/FormulasRibbon";
import { linksInsertGroup, reviewTab } from "../comments/ReviewRibbon";
import { pivotAnalyzeTab, pivotDesignTab, pivotInsertGroup } from "../pivot/PivotRibbon";
import { tableDesignTab, tableInsertButton } from "../tables/TableRibbon";
import { dataTabGroups, getDataGroup, pageLayoutTab, pasteMenu, PicturesButton, workbookViewsGroup } from "../datatools/DataRibbon";
import { NumberGroup } from "./NumberGroup";
import {
  clearFilterIcon, condFormatIcon, filterIcon, freezeIcon, headingsIcon, mergeIcon, reapplyIcon, sortAscIcon, sortDescIcon, sortIcon, unmergeIcon,
} from "./icons";

/** View options of the grid (View tab): zoom (1 = 100 %), gridlines and headings are the active sheet's. */
export interface CalcView {
  zoom: number;
  gridlines: boolean;
  headings: boolean;
  formulaBar: boolean;
}

export const DEFAULT_CALC_VIEW: CalcView = { zoom: 1, gridlines: true, headings: true, formulaBar: true };
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export { changeDecimals } from "../numberFormat";

export interface CalcRibbonProps {
  store: CalcStore;
  session: AnySession;
  onExportPdf: () => void;
  /** File › Print page (settings and preview). */
  print?: ReactNode;
  view: CalcView;
  onViewChange: (v: CalcView) => void;
}

export function CalcRibbon({ store, session, onExportPdf, print, view, onViewChange }: CalcRibbonProps) {
  const t = useT();
  useCalc(store, (s) => s.version);
  useCalc(store, (s) => s.selection);
  const activeSheet = useCalc(store, (s) => s.activeSheet);
  useCalc(store, (s) => s.info?.sheets);
  const ready = useCalc(store, (s) => s.info !== null);
  const canUndo = useCalc(store, (s) => s.canUndo);
  const canRedo = useCalc(store, (s) => s.canRedo);
  const name = useCalc(store, (s) => s.name);
  const dirty = useCalc(store, (s) => s.dirty);
  const actions = useMemo(() => calcActions(store), [store]);
  // Controlled tab: inserting a chart shows Chart Design (store.requestRibbonTab).
  const [tab, setTab] = useState<string | undefined>(undefined);
  const ribbonRequest = useCalc(store, (s) => s.ribbonRequest);
  useEffect(() => {
    if (ribbonRequest) setTab(ribbonRequest.tab);
  }, [ribbonRequest]);

  const off = !ready;
  const done = () => store.focusGrid();
  const run = (fn: () => unknown) => () => {
    void fn();
    done();
  };
  const fmt: FormatControlProps = {
    value: toolbarValue(store.activeStyle()),
    disabled: off,
    onChange: (patch: CellStylePatch) => {
      void store.applyStyle(patch);
      done();
    },
  };

  const filterOn = actions.hasAutoFilter();
  const filtered = actions.hasFilters();
  // Home › Editing › Sort & Filter ▾ (Excel's menu; the Data tab has the same commands as buttons).
  const sortFilterMenu = [
    { id: "sortAsc", label: t("calc.sortAsc"), icon: sortAscIcon(), onSelect: run(actions.sortAsc) },
    { id: "sortDesc", label: t("calc.sortDesc"), icon: sortDescIcon(), onSelect: run(actions.sortDesc) },
    { id: "customSort", label: t("calc.customSort"), icon: sortIcon(16), onSelect: actions.customSort },
    { separator: true as const },
    { id: "filter", label: t("calc.filter"), icon: filterIcon(16), shortcut: "Mod+Shift+L", checked: filterOn, onSelect: run(actions.toggleFilter) },
    { id: "clear", label: t("calc.filter.clear"), icon: clearFilterIcon(), disabled: !filtered, onSelect: run(actions.clearFilters) },
    { id: "reapply", label: t("calc.filter.reapply"), icon: reapplyIcon(), disabled: !filterOn, onSelect: run(actions.reapplyFilter) },
  ];

  const home: RibbonTab = {
    id: "home",
    label: t("tab.home"),
    toolbarLabel: t("fmt.toolbar"),
    groups: [
      {
        label: t("group.undo"),
        items: (
          <RibbonStack>
            <RibbonButton label={t("group.undo")} icon="undo" shortcut="Mod+Z" disabled={off || !canUndo} onClick={run(() => store.undo())} />
            <RibbonButton label={t("cmd.redo")} icon="redo" shortcut="Mod+Y" disabled={off || !canRedo} onClick={run(() => store.redo())} />
          </RibbonStack>
        ),
      },
      {
        label: t("group.clipboard"),
        items: (
          <>
            <RibbonSplitButton
              label={t("cmd.paste")}
              icon="paste"
              size="large"
              shortcut="Mod+V"
              disabled={off}
              onClick={run(actions.paste)}
              menu={pasteMenu(store, t, actions.paste, run)}
            />
            <RibbonStack>
              <RibbonButton label={t("cmd.cut")} icon="cut" shortcut="Mod+X" showLabel disabled={off} onClick={run(actions.cut)} />
              <RibbonButton label={t("cmd.copy")} icon="copy" shortcut="Mod+C" showLabel disabled={off} onClick={run(actions.copy)} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("group.font"),
        items: (
          <RibbonStack>
            <RibbonRow>
              <FontControls {...fmt} />
            </RibbonRow>
            <RibbonRow>
              <StyleToggles {...fmt} />
              <BordersDropdown onChange={fmt.onChange} disabled={off} />
              <ColorControls {...fmt} />
            </RibbonRow>
          </RibbonStack>
        ),
      },
      {
        label: t("fmt.alignment"),
        items: (
          <RibbonStack>
            <RibbonRow>
              <AlignmentControls {...fmt} parts={["vertical"]} />
              <RibbonButton label={t("fmt.wrapText")} icon="lineBreak" pressed={!!fmt.value.alignment?.wrapText} disabled={off} onClick={run(actions.toggleWrap)} />
            </RibbonRow>
            <RibbonRow>
              <AlignmentControls {...fmt} parts={["horizontal"]} />
              <RibbonSplitButton
                label={t("calc.mergeCenter")}
                icon={mergeIcon()}
                showLabel
                disabled={off}
                onClick={run(() => store.toggleMergeCenter())}
                menuLabel={t("calc.mergeOptions")}
                menu={[
                  { id: "mergeCenter", label: t("calc.mergeCenter"), icon: mergeIcon(), onSelect: run(() => store.mergeSelection("center")) },
                  { id: "mergeAcross", label: t("calc.mergeAcross"), onSelect: run(() => store.mergeSelection("across")) },
                  { id: "mergeCells", label: t("calc.mergeCells"), onSelect: run(() => store.mergeSelection("cells")) },
                  { id: "unmerge", label: t("calc.unmergeCells"), icon: unmergeIcon(), disabled: !store.selectionHasMerge(), onSelect: run(() => store.unmergeSelection()) },
                ]}
              />
            </RibbonRow>
          </RibbonStack>
        ),
      },
      {
        label: t("fmt.number"),
        items: <NumberGroup store={store} disabled={off} onChange={fmt.onChange} />,
      },
      {
        label: t("calc.styles"),
        items: (
          <RibbonMenuButton
            label={t("calc.cf.menu")}
            icon={condFormatIcon()}
            size="large"
            disabled={off}
            menu={(close) => <CfMenu store={store} close={close} />}
          />
        ),
      },
      {
        label: t("calc.cells"),
        items: (
          <>
            <RibbonMenuButton
              label={t("tab.insert")}
              icon="insertCells"
              size="large"
              disabled={off}
              menu={[
                { id: "rows", label: t("calc.insertSheetRows"), icon: "insertRows", onSelect: run(actions.insertRows) },
                { id: "cols", label: t("calc.insertSheetCols"), icon: "insertCols", onSelect: run(actions.insertCols) },
                { separator: true },
                { id: "sheet", label: t("calc.insertSheet"), icon: "sheet", onSelect: run(() => store.addSheet()) },
              ]}
            />
            <RibbonMenuButton
              label={t("cmd.delete")}
              icon="deleteCells"
              size="large"
              disabled={off}
              menu={[
                { id: "rows", label: t("calc.deleteSheetRows"), icon: "deleteRows", onSelect: run(actions.deleteRows) },
                { id: "cols", label: t("calc.deleteSheetCols"), icon: "deleteCols", onSelect: run(actions.deleteCols) },
                { separator: true },
                { id: "sheet", label: t("calc.deleteSheet"), icon: "sheet", onSelect: () => void store.deleteSheet(activeSheet) },
              ]}
            />
            <RibbonMenuButton
              label={t("sc.format")}
              icon="format"
              size="large"
              disabled={off}
              menu={[
                { separator: true, label: t("calc.cellSize") },
                { id: "rowHeight", label: t("calc.rowHeightDots"), icon: "rowHeight", onSelect: actions.rowHeight },
                { id: "autofit", label: t("calc.autofitColWidth"), onSelect: run(actions.autofitCols) },
                { id: "colWidth", label: t("calc.colWidthDots"), icon: "colWidth", onSelect: actions.colWidth },
                { separator: true, label: t("calc.visibility") },
                { id: "hideRows", label: t("calc.hideRows"), onSelect: run(actions.hideRows) },
                { id: "hideCols", label: t("calc.hideCols"), onSelect: run(actions.hideCols) },
                { id: "unhideRows", label: t("calc.unhideRows"), onSelect: run(actions.unhideRows) },
                { id: "unhideCols", label: t("calc.unhideCols"), onSelect: run(actions.unhideCols) },
                { id: "hideSheet", label: t("calc.hideSheet"), disabled: !actions.canHideSheet(), onSelect: run(actions.hideSheet) },
                { id: "unhideSheet", label: t("calc.unhideSheetDots"), disabled: !actions.canUnhideSheet(), onSelect: actions.unhideSheet },
                { separator: true },
                { id: "formatCells", label: t("calc.formatCellsDots"), icon: "format", shortcut: "Mod+1", onSelect: actions.formatCells },
              ]}
            />
          </>
        ),
      },
      {
        label: t("group.editing"),
        items: (
          <>
            <RibbonButton label={t("calc.clear")} icon="clear" size="large" shortcut="Delete" tooltip={t("calc.clearContents")} disabled={off} onClick={run(actions.clearContents)} />
            <RibbonSplitButton
              label={t("cmd.find")}
              icon="find"
              size="large"
              shortcut="Mod+F"
              disabled={off}
              onClick={actions.find}
              menuLabel={t("cmd.findOptions")}
              menu={[
                { id: "find", label: t("cmd.findDots"), icon: "find", shortcut: "Mod+F", onSelect: actions.find },
                { id: "replace", label: t("cmd.replaceDots"), shortcut: "Mod+H", onSelect: actions.replace },
              ]}
            />
            <RibbonMenuButton label={t("calc.sortFilter")} icon={sortIcon()} size="large" disabled={off} menu={sortFilterMenu} />
          </>
        ),
      },
      { ...aiRibbonGroup(session.ai), collapsePriority: 2 },
    ],
  };

  const insert: RibbonTab = {
    id: "insert",
    label: t("tab.insert"),
    groups: [
      {
        ...pivotInsertGroup(store, t, off),
        items: (
          <>
            {pivotInsertGroup(store, t, off).items}
            {tableInsertButton(store, t, off)}
          </>
        ),
      },
      {
        label: t("calc.illustrations"),
        items: <PicturesButton store={store} t={t} off={off} />,
      },
      {
        label: t("calc.sheets"),
        items: (
          <>
            <RibbonButton label={t("calc.newSheet")} icon="sheet" size="large" disabled={off} onClick={run(() => store.addSheet())} />
            <RibbonMenuButton
              label={t("calc.sheet")}
              icon="sheet"
              size="large"
              disabled={off}
              menu={sheetMenu(store, activeSheet, () => store.openDialog({ kind: "renameSheet", sheet: activeSheet }))}
            />
          </>
        ),
      },
      {
        label: t("calc.rowsCols"),
        items: (
          <RibbonStack>
            <RibbonButton label={t("calc.insertRows")} icon="insertRows" showLabel disabled={off} onClick={run(actions.insertRows)} />
            <RibbonButton label={t("calc.insertCols")} icon="insertCols" showLabel disabled={off} onClick={run(actions.insertCols)} />
          </RibbonStack>
        ),
      },
      chartsInsertGroup(store, t, off),
      linksInsertGroup(store, t, off),
    ],
  };
  // Chart Design and Format while a chart is selected.
  const chartTabs = contextualTabs([chartDesignTab(store, t), chartFormatTab(store, t)].filter((x): x is RibbonTab => x !== null), t("ribbon.ctx.chartTools"), CONTEXT_COLORS.chart);
  // PivotTable Analyze and Design while a cell of a pivot table is selected (P8-33).
  const pivotTabs = chartTabs.length
    ? []
    : contextualTabs([pivotAnalyzeTab(store, t), pivotDesignTab(store, t)].filter((x): x is RibbonTab => x !== null), t("calc.pivot.tools"), CONTEXT_COLORS.table);
  // Table Design while a cell of an Excel table is selected (P8-35).
  const tableTabs = chartTabs.length || pivotTabs.length
    ? []
    : contextualTabs([tableDesignTab(store, t)].filter((x): x is RibbonTab => x !== null), t("calc.table.tools"), CONTEXT_COLORS.table);
  const contextual = [...chartTabs, ...pivotTabs, ...tableTabs];
  const contextualTab = tab !== undefined && ["chartDesign", "chartFormat", "pivotAnalyze", "pivotDesign", "tableDesign"].includes(tab);
  const available = contextual.some((x) => x.id === tab);
  // A new pivot table's tab is requested before its sheet and field list have arrived.
  const pending = tab !== undefined && store.pivots.pendingTab === tab;
  const shownTab = contextualTab && !available && !pending;
  useEffect(() => {
    if (available && pending) store.pivots.pendingTab = null;
    // Leaving the chart (or the pivot table) leaves its tabs.
    if (shownTab) setTab("home");
  }, [shownTab, available, pending, store]);

  const data: RibbonTab = {
    id: "data",
    label: t("calc.tab.data"),
    groups: [
      getDataGroup(store, t, off),
      {
        label: t("calc.sortFilter"),
        items: (
          <>
            <RibbonStack>
              <RibbonButton label={t("calc.sortAsc")} icon={sortAscIcon()} disabled={off} onClick={run(actions.sortAsc)} />
              <RibbonButton label={t("calc.sortDesc")} icon={sortDescIcon()} disabled={off} onClick={run(actions.sortDesc)} />
            </RibbonStack>
            <RibbonButton label={t("calc.sort")} icon={sortIcon()} size="large" tooltip={t("calc.customSort")} disabled={off} onClick={actions.customSort} />
            <RibbonButton
              label={t("calc.filter")}
              icon={filterIcon()}
              size="large"
              shortcut="Mod+Shift+L"
              pressed={filterOn}
              disabled={off}
              onClick={run(actions.toggleFilter)}
            />
            <RibbonStack>
              <RibbonButton label={t("calc.filter.clear")} icon={clearFilterIcon()} showLabel disabled={off || !filtered} onClick={run(actions.clearFilters)} />
              <RibbonButton label={t("calc.filter.reapply")} icon={reapplyIcon()} showLabel disabled={off || !filterOn} onClick={run(actions.reapplyFilter)} />
            </RibbonStack>
          </>
        ),
      },
      ...dataTabGroups(store, t, off, actions.dataValidation),
    ],
  };

  const frozen = store.sheetView();
  const isFrozen = frozen.frozenRows > 0 || frozen.frozenCols > 0;
  // Excel's menu: the first entry freezes at the active cell, or unfreezes when something is frozen.
  const freezeMenu = [
    isFrozen
      ? { id: "unfreeze", label: t("calc.unfreezePanes"), onSelect: run(() => store.freezePanes("none")) }
      : { id: "freeze", label: t("calc.freezePanes"), onSelect: run(() => store.freezePanes("selection")) },
    { id: "topRow", label: t("calc.freezeTopRow"), onSelect: run(() => store.freezePanes("topRow")) },
    { id: "firstCol", label: t("calc.freezeFirstCol"), onSelect: run(() => store.freezePanes("firstCol")) },
  ];

  const viewTab: RibbonTab = {
    id: "view",
    label: t("tab.view"),
    groups: [
      workbookViewsGroup(store, t, off),
      {
        label: t("group.show"),
        items: (
          <>
            <RibbonStack>
              <RibbonButton label={t("calc.gridlines")} icon="gridlines" showLabel pressed={view.gridlines} disabled={off} onClick={() => onViewChange({ ...view, gridlines: !view.gridlines })} />
              <RibbonButton label={t("calc.headings")} icon={headingsIcon()} showLabel pressed={view.headings} disabled={off} onClick={() => onViewChange({ ...view, headings: !view.headings })} />
            </RibbonStack>
            <RibbonStack>
              <RibbonButton label={t("calc.formulaBar")} icon="formulaBar" showLabel pressed={view.formulaBar} onClick={() => onViewChange({ ...view, formulaBar: !view.formulaBar })} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("group.zoom"),
        items: (
          <>
            <RibbonStack>
              <select
                aria-label={t("group.zoom")}
                className={`${RIBBON_SELECT} w-20`}
                value={String(view.zoom)}
                disabled={off}
                onChange={(e) => onViewChange({ ...view, zoom: Number(e.target.value) })}
              >
                {(ZOOM_LEVELS.includes(view.zoom) ? ZOOM_LEVELS : [...ZOOM_LEVELS, view.zoom].sort((a, b) => a - b)).map((z) => (
                  <option key={z} value={String(z)}>
                    {Math.round(z * 100)} %
                  </option>
                ))}
              </select>
              <RibbonButton label="100 %" icon="zoom" showLabel tooltip={t("cmd.zoomTo100")} disabled={off} onClick={() => onViewChange({ ...view, zoom: 1 })} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("calc.window"),
        items: <RibbonMenuButton label={t("calc.freezePanes")} icon={freezeIcon()} size="large" disabled={off} menu={freezeMenu} />,
      },
      languageRibbonGroup(t),
      {
        label: t("group.help"),
        items: <RibbonButton label={t("shortcuts.title")} icon="keyboard" size="large" shortcut="Mod+/" onClick={() => triggerShortcut("Mod+/")} />,
      },
    ],
  };

  return (
    <Ribbon
      appName="Rusuite Calc"
      documentTitle={`${name ?? t("doc.untitled")}${dirty ? " •" : ""}`}
      accent="#217346"
      tabs={[home, insert, pageLayoutTab(store, t, off), formulasTab(store, t, off), data, reviewTab(store, t, off), viewTab, ...contextual]}
      activeTab={tab}
      rightSlot={<HelpMenu docStats={() => ({ cells: [...store.cache(store.getState().activeSheet).cells.values()].reduce((n, row) => n + row.size, 0) })} />}
      onTabChange={setTab}
      backstage={{
        session,
        onNew: () => triggerShortcut("Mod+N"),
        onOpen: () => triggerShortcut("Mod+O"),
        onSave: () => void store.saveFile(),
        onSaveAs: () => triggerShortcut("Mod+Shift+S"),
        onExportPdf,
        print,
        onCloseDocument: () => triggerShortcut("Mod+N"),
      }}
    />
  );
}
