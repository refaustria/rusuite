// Inline editing of a chart title / axis title (text only): an input over
// the title's box, positioned by the grid on every frame. Enter or leaving
// the field commits, Esc cancels.

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useT } from "../i18n";
import type { CalcStore } from "../state/store";

export function ChartTextEditor({ store, boxRef, onMount }: { store: CalcStore; boxRef: RefObject<HTMLDivElement>; onMount: () => void }) {
  const t = useT();
  const [text, setText] = useState(store.charts.textEdit?.text ?? "");
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    onMount();
    input.current?.focus();
    input.current?.select();
  }, [onMount]);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    void store.charts.commitTextEdit(text);
    store.focusGrid();
  };
  return (
    <div ref={boxRef} className="absolute z-10" style={{ left: -9999 }}>
      <input
        ref={input}
        data-testid="chart-text-editor"
        aria-label={t("calc.chart.editTitle")}
        className="h-full w-full rounded-sm border border-[#217346] bg-white px-1 text-center text-base text-[#595959] outline-none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            done.current = true;
            store.charts.textEdit = null;
            store.notify();
            store.focusGrid();
          }
        }}
      />
    </div>
  );
}
