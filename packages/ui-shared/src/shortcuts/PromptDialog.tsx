import { useEffect, useState } from "react";
import { Dialog } from "../Dialog";
import { useT } from "../i18n/react";

export interface PromptDialogProps {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

/** A modal asking for one line of text (Save As: the file name). */
export function PromptDialog({ open, title, label, initial = "", confirmLabel, onSubmit, onClose }: PromptDialogProps) {
  const t = useT();
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const v = value.trim();
          if (v) onSubmit(v);
        }}
      >
        <label className="flex flex-col gap-1">
          {label}
          <input
            className="h-7 rounded border border-ui-border bg-ui-bg px-2 text-ui-fg"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="h-7 rounded border border-ui-border bg-ui-bg px-3 hover:bg-ui-hover" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="h-7 rounded border border-ui-border bg-ui-bg px-3 hover:bg-ui-hover">
            {confirmLabel ?? t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Adds `ext` (with the dot) unless the name already ends in it. */
export function withExtension(name: string, ext: string): string {
  return name.toLowerCase().endsWith(ext.toLowerCase()) ? name : `${name}${ext}`;
}
