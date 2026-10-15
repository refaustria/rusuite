import type { ReactNode } from "react";

export type IconName =
  | "bold" | "italic" | "underline" | "strike"
  | "alignLeft" | "alignCenter" | "alignRight"
  | "alignTop" | "alignMiddle" | "alignBottom"
  | "wrap" | "textColor" | "fillColor" | "borders" | "chevronDown"
  | "borderAll" | "borderOutline" | "borderBottom" | "borderTop" | "borderLeft" | "borderRight" | "borderNone"
  | "close";

const P = (d: string) => <path d={d} />;
const box = <rect x="3" y="3" width="14" height="14" strokeDasharray="1.5 1.5" opacity="0.4" />;

const PATHS: Record<IconName, ReactNode> = {
  bold: P("M6 4h5a3 3 0 010 6H6zM6 10h6a3 3 0 010 6H6z"),
  italic: P("M8 4h7M5 16h7M11 4L9 16"),
  underline: P("M6 4v6a4 4 0 008 0V4M4 17h12"),
  strike: P("M4 10h12M13 6a4 3 0 00-6-1c-2 1-2 3 0 4M7 14a4 3 0 006 1c2-1 2-3 0-4"),
  alignLeft: P("M3 5h14M3 9h9M3 13h14M3 17h9"),
  alignCenter: P("M3 5h14M5.5 9h9M3 13h14M5.5 17h9"),
  alignRight: P("M3 5h14M8 9h9M3 13h14M8 17h9"),
  alignTop: P("M3 3h14M10 17V7M6.5 10.5L10 7l3.5 3.5"),
  alignMiddle: P("M3 10h14M10 3v4M7.5 5.5L10 8l2.5-2.5M10 17v-4M7.5 14.5L10 12l2.5 2.5"),
  alignBottom: P("M3 17h14M10 3v10M6.5 9.5L10 13l3.5-3.5"),
  wrap: P("M3 5h14M3 10h11a3 3 0 010 6H9M11 14l-2 2 2 2M3 15h3"),
  textColor: P("M6 14l4-10 4 10M7.5 10.5h5"),
  fillColor: P("M4 10l5-6 6 6-5 5zM16 13c1 1.5 1.5 2.5 0 3.5-1.5-1-1-2 0-3.5z"),
  borders: <><rect x="3" y="3" width="14" height="14" /><path d="M10 3v14M3 10h14" /></>,
  chevronDown: P("M6 8l4 4 4-4"),
  borderAll: <><rect x="3" y="3" width="14" height="14" /><path d="M10 3v14M3 10h14" /></>,
  borderOutline: <rect x="3" y="3" width="14" height="14" />,
  borderBottom: <>{box}<path d="M3 17h14" /></>,
  borderTop: <>{box}<path d="M3 3h14" /></>,
  borderLeft: <>{box}<path d="M3 3v14" /></>,
  borderRight: <>{box}<path d="M17 3v14" /></>,
  borderNone: box,
  close: P("M5 5l10 10M15 5L5 15"),
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
