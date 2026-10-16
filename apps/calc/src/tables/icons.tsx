// Table and data tool ribbon icons (20×20 viewBox, stroked like the shared `RibbonIcon`).

import type { ReactNode } from "react";

function svg(size: number, body: ReactNode) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {body}
    </svg>
  );
}

/** Table: a grid with a filled header row and stripes. */
export const tableIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M2.5 7h15M2.5 11h15M2.5 14h15M7.5 3v14M12.5 3v14" />
      <path d="M3 3.5h14v3H3zM3 11.5h14v2.5H3z" fill="currentColor" stroke="none" opacity="0.25" />
    </>
  ));

/** Summarize with PivotTable. */
export const tableDesignIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M2.5 7h15M7 3v14" />
      <path d="M10 10l3 3 4-6" />
    </>
  ));

export const convertIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="4" width="8" height="9" />
      <path d="M2.5 7h8M12 9h5M15 7l2 2-2 2" />
    </>
  ));

export const duplicatesIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="10" height="4" />
      <rect x="2.5" y="9" width="10" height="4" />
      <path d="M14 10l4 4M18 10l-4 4" />
    </>
  ));

export const resizeIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="9" height="8" />
      <path d="M11.5 11l5 5M16.5 12.5V16h-3.5" />
    </>
  ));

export const textToColumnsIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="6" height="14" />
      <path d="M11 6h6M11 10h6M11 14h6M9.5 10h1" />
    </>
  ));

export const whatIfIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M7 8a3 3 0 1 1 3 3v1.5M10 15v.5" />
    </>
  ));

export const groupIcon = (size = 24) =>
  svg(size, (
    <>
      <path d="M4 3v14M4 3h2M4 17h2M8 5h9M8 9h9M8 13h9" />
      <path d="M2 8.5h4" />
    </>
  ));

export const ungroupIcon = (size = 24) =>
  svg(size, (
    <>
      <path d="M4 3v5M4 12v5M8 5h9M8 9h9M8 13h9" />
      <path d="M2 9l4 2M2 11l4-2" />
    </>
  ));

export const subtotalIcon = (size = 24) =>
  svg(size, (
    <>
      <path d="M3 4h10M3 8h10M3 14h10" />
      <path d="M15 4l2 3-2 3M15 11h3" />
      <path d="M3 11h10" strokeDasharray="2 1" />
    </>
  ));

export const showDetailIcon = (size = 16) =>
  svg(size, (
    <>
      <rect x="3" y="3" width="14" height="14" />
      <path d="M7 10h6M10 7v6" />
    </>
  ));

export const hideDetailIcon = (size = 16) =>
  svg(size, (
    <>
      <rect x="3" y="3" width="14" height="14" />
      <path d="M7 10h6" />
    </>
  ));

export const pictureIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="4" width="15" height="12" />
      <path d="M2.5 14l4-4 3 3 3-4 5 5" />
      <circle cx="13.5" cy="7.5" r="1" />
    </>
  ));

export const pageBreakIcon = (size = 24) =>
  svg(size, (
    <>
      <path d="M4 2.5v5h12v-5M4 17.5v-5h12v5" />
      <path d="M2 10h3M7 10h2M11 10h2M15 10h3" />
    </>
  ));

export const printAreaIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="3" y="3" width="14" height="14" strokeDasharray="2 1.5" />
      <rect x="6" y="6" width="8" height="8" />
    </>
  ));

export const printTitlesIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="3" y="3" width="14" height="14" />
      <path d="M3 6.5h14M6.5 3v14" />
      <path d="M3.5 3.5h13v2.5h-13z" fill="currentColor" stroke="none" opacity="0.3" />
    </>
  ));

export const breakPreviewIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M10 3v14M2.5 10h15" stroke="#2a62d6" strokeDasharray="2 1.5" />
    </>
  ));

/** Paste gallery icons: a clipboard with a mark. */
export const pasteIcon = (mark: "fx" | "123" | "%" | "T" | "↔" | "link" | "brush" | "nob" | "w", size = 24) =>
  svg(size, (
    <>
      <path d="M6 4H4.5v13h8" />
      <rect x="7" y="2.5" width="4" height="3" />
      <rect x="9" y="8" width="8.5" height="9.5" />
      <text x="13.25" y="15.5" fontSize="6" textAnchor="middle" fill="currentColor" stroke="none">
        {mark === "link" ? "∞" : mark === "brush" ? "✎" : mark === "nob" ? "□" : mark === "w" ? "⟷" : mark}
      </text>
    </>
  ));
