import { Dialog } from "../Dialog";
import { formatCombo } from "./keys";
import type { ShortcutMap } from "./useShortcuts";

export interface HelpRow {
  combo: string;
  label: string;
  group?: string;
}

export interface ShortcutHelpProps {
  open: boolean;
  onClose: () => void;
  shortcuts: ShortcutMap;
  /** Additional rows for keys the app handles outside the map. */
  extra?: HelpRow[];
}

/** Groups the map (and extra rows) by section, in first-seen order. */
export function helpSections(shortcuts: ShortcutMap, extra: HelpRow[] = []): [string, HelpRow[]][] {
  const rows: HelpRow[] = [
    ...Object.entries(shortcuts).map(([combo, e]) => ({ combo, label: e.label, group: e.group })),
    ...extra,
  ];
  const sections = new Map<string, HelpRow[]>();
  for (const r of rows) {
    const g = r.group ?? "General";
    sections.set(g, [...(sections.get(g) ?? []), r]);
  }
  return [...sections];
}

/** Dialog listing every shortcut (opened with Ctrl+/). */
export function ShortcutHelp({ open, onClose, shortcuts, extra }: ShortcutHelpProps) {
  return (
    <Dialog open={open} title="Keyboard shortcuts" onClose={onClose}>
      <div className="max-h-96 overflow-auto pr-2 text-sm" data-testid="shortcut-help">
        {helpSections(shortcuts, extra).map(([group, rows]) => (
          <section key={group} className="mb-3">
            <h3 className="mb-1 font-medium text-ui-muted">{group}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
              {rows.map((r) => (
                <div key={r.combo + r.label} className="contents">
                  <dt className="font-mono text-xs">{formatCombo(r.combo)}</dt>
                  <dd>{r.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <button type="button" className="h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
