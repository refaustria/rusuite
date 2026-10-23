// The ribbon in the compact layout (P10-M2): the top bar, the bottom command bar and the full-screen backstage,
// from the same `RibbonProps` (tabs → groups → controls) as the desktop ribbon.

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Backstage, backstageOptions, type BackstageActions, type BackstagePage } from "../ribbon/Backstage";
import type { RibbonTab } from "../ribbon/Ribbon";
import { CommandBar } from "./CommandBar";
import { TopBar, type CompactUndo } from "./TopBar";
import { installViewportVars } from "./visualViewport";

export interface CompactRibbonProps {
  /** The visible tabs (`visibleTabs`). */
  tabs: RibbonTab[];
  activeTab?: string;
  defaultTab?: string;
  onTabChange?: (id: string) => void;
  appName: string;
  documentTitle?: string;
  rightSlot?: ReactNode;
  backstage?: BackstageActions;
  accent: string;
  undo?: CompactUndo;
  /** Window event that opens the backstage on a page (`OPEN_BACKSTAGE_EVENT`). */
  openEvent: string;
}

export function CompactRibbon({ tabs, activeTab, defaultTab, onTabChange, appName, documentTitle, rightSlot, backstage, accent, undo, openEvent }: CompactRibbonProps) {
  const [innerTab, setInnerTab] = useState(defaultTab ?? tabs[0]?.id ?? "");
  const requested = activeTab ?? innerTab;
  const active = tabs.find((x) => x.id === requested) ?? tabs[0];
  const [backstageOpen, setBackstageOpen] = useState(false);
  const [page, setPage] = useState<BackstagePage>("home");

  // <html data-compact>: the app's layout follows the visual viewport and leaves room for the bars (styles.css).
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-compact", "");
    const stop = installViewportVars(root);
    return () => {
      stop();
      root.removeAttribute("data-compact");
    };
  }, []);

  // `openBackstage(page)` (e.g. the app's Ctrl+P).
  const hasBackstage = !!backstage;
  useEffect(() => {
    if (!hasBackstage) return;
    const onOpen = (e: Event) => {
      e.preventDefault();
      setPage((e as CustomEvent<BackstagePage>).detail ?? "home");
      setBackstageOpen(true);
    };
    window.addEventListener(openEvent, onOpen);
    return () => window.removeEventListener(openEvent, onOpen);
  }, [hasBackstage, openEvent]);

  const select = (id: string) => {
    setInnerTab(id);
    if (id !== active?.id) onTabChange?.(id);
  };

  return (
    <>
      <TopBar
        documentTitle={documentTitle}
        accent={accent}
        onFile={
          backstage
            ? () => {
                setPage("home");
                setBackstageOpen(true);
              }
            : undefined
        }
        fileExpanded={backstageOpen}
        undo={undo}
        rightSlot={rightSlot}
        onOptions={backstage ? backstageOptions(backstage.session, backstage.onOptions) : undefined}
      />
      <CommandBar tabs={tabs} activeId={active?.id} onSelect={select} accent={accent} />
      {backstage && (
        <Backstage {...backstage} open={backstageOpen} page={page} onPage={setPage} onClose={() => setBackstageOpen(false)} appName={appName} documentTitle={documentTitle} accent={accent} />
      )}
    </>
  );
}
