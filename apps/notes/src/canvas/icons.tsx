// Draw tab icons (20×20, stroked like ui-shared's).

import type { ReactNode } from "react";

const PATHS = {
  type: <path d="M7 4h6M10 4v12M7 16h6" />,
  pen: (
    <>
      <path d="M13.5 3.5l3 3-9 9-4 1 1-4z" />
      <path d="M11.5 5.5l3 3" />
    </>
  ),
  highlighter: (
    <>
      <path d="M12.5 3.5l4 4-6.5 6.5h-3v-3z" />
      <path d="M7 14l-3 3h4" />
    </>
  ),
  eraser: (
    <>
      <path d="M3.5 13l7.5-8.5 5.5 5L10 16.5H6z" />
      <path d="M8 7.5l5.5 5M10 16.5h7" />
    </>
  ),
  lasso: (
    <>
      <ellipse cx="10" cy="8" rx="6.5" ry="4.5" strokeDasharray="2.2 1.8" />
      <path d="M6 11.5c-1 2 0 4 2 4.5" />
    </>
  ),
  canvas: (
    <>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <rect x="5" y="6" width="5" height="3" rx="0.5" />
      <path d="M11 12.5c1.5-2 3-2 4 0" />
    </>
  ),
  front: (
    <>
      <rect x="7" y="7" width="9" height="9" rx="1" fill="currentColor" fillOpacity="0.25" />
      <path d="M4 12V4h8" />
    </>
  ),
  back: (
    <>
      <rect x="4" y="4" width="9" height="9" rx="1" fill="currentColor" fillOpacity="0.25" />
      <path d="M16 8v8H8" />
    </>
  ),
  color: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="7.5" cy="8" r="1" fill="currentColor" />
      <circle cx="11.5" cy="7" r="1" fill="currentColor" />
      <circle cx="13" cy="10.8" r="1" fill="currentColor" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type DrawIconName = keyof typeof PATHS;

export function DrawIcon({ name, size = 16, color }: { name: DrawIconName; size?: number; color?: string }) {
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {PATHS[name]}
      </svg>
      {color && <span className="absolute -bottom-0.5 left-0 right-0 h-1 rounded-sm" style={{ background: color }} />}
    </span>
  );
}

export function Swatch({ color, size = 12 }: { color: string; size?: number }) {
  return <span className="inline-block rounded-sm border border-black/20" style={{ width: size, height: size, background: color }} />;
}
