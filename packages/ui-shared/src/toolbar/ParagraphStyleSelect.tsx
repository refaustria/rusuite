import { FOCUS_RING } from "../Popover";

export interface ParagraphStyleOption {
  id: string;
  label: string;
}

export interface ParagraphStyleSelectProps {
  /** Style id of the current paragraph (`""` = mixed selection). */
  value: string;
  styles: ParagraphStyleOption[];
  onChange: (styleId: string) => void;
  disabled?: boolean;
}

/** Paragraph style picker (Write): Normal, Title, Heading 1–6, … */
export function ParagraphStyleSelect({ value, styles, onChange, disabled }: ParagraphStyleSelectProps) {
  const known = styles.some((s) => s.id === value);
  return (
    <select
      aria-label="Paragraph style"
      className={`h-7 w-32 rounded border border-ui-border bg-ui-bg px-1 text-sm text-ui-fg disabled:opacity-40 ${FOCUS_RING}`}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {!known && <option value={value}>{value === "" ? "" : value}</option>}
      {styles.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
