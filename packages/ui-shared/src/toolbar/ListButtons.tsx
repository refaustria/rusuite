import type { ReactNode } from "react";
import { BTN } from "../Popover";

export type ListKindChoice = "bullet" | "decimal";

export interface ListButtonsProps {
  /** The selection is in a bulleted / numbered list. */
  bullet: boolean;
  ordered: boolean;
  onToggle: (kind: ListKindChoice) => void;
  /** +1 indent (list level or left indent), −1 outdent. */
  onIndent: (delta: 1 | -1) => void;
  disabled?: boolean;
}

const Svg = ({ children }: { children: ReactNode }) => (
  <svg aria-hidden="true" focusable="false" width={16} height={16} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    {children}
  </svg>
);

const ICONS = {
  bullet: (
    <Svg>
      <circle cx="4" cy="5" r="1" fill="currentColor" />
      <circle cx="4" cy="10" r="1" fill="currentColor" />
      <circle cx="4" cy="15" r="1" fill="currentColor" />
      <path d="M8 5h9M8 10h9M8 15h9" />
    </Svg>
  ),
  ordered: (
    <Svg>
      <path d="M3 3.5h1.5v4M3 7.5h3M3 12.5h3l-3 4h3M9 5h8M9 10h8M9 15h8" strokeWidth="1.2" />
    </Svg>
  ),
  indent: (
    <Svg>
      <path d="M3 4h14M9 8h8M9 12h8M3 16h14M3 8l3 2-3 2" />
    </Svg>
  ),
  outdent: (
    <Svg>
      <path d="M3 4h14M9 8h8M9 12h8M3 16h14M6 8l-3 2 3 2" />
    </Svg>
  ),
};

/** Bulleted/numbered list toggles and indent/outdent (Write). */
export function ListButtons({ bullet, ordered, onToggle, onIndent, disabled }: ListButtonsProps) {
  return (
    <div role="group" aria-label="Lists" className="flex items-center gap-0.5 border-r border-ui-border px-1 last:border-r-0">
      <button type="button" className={BTN} aria-label="Bulleted list" aria-pressed={bullet} disabled={disabled} onClick={() => onToggle("bullet")}>
        {ICONS.bullet}
      </button>
      <button type="button" className={BTN} aria-label="Numbered list" aria-pressed={ordered} disabled={disabled} onClick={() => onToggle("decimal")}>
        {ICONS.ordered}
      </button>
      <button type="button" className={BTN} aria-label="Decrease indent" disabled={disabled} onClick={() => onIndent(-1)}>
        {ICONS.outdent}
      </button>
      <button type="button" className={BTN} aria-label="Increase indent" disabled={disabled} onClick={() => onIndent(1)}>
        {ICONS.indent}
      </button>
    </div>
  );
}
