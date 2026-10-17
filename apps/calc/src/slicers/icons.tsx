// Slicer icons (20×20 viewBox, stroked like the shared `RibbonIcon`).

import type { ReactNode } from "react";

function svg(size: number, body: ReactNode) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {body}
    </svg>
  );
}

/** Insert Slicer: a panel with a header and buttons, one pressed. */
export const slicerIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="3" y="2.5" width="14" height="15" rx="1" />
      <path d="M3 6h14" />
      <rect x="5" y="8" width="10" height="2.5" fill="currentColor" stroke="none" opacity="0.5" />
      <rect x="5" y="12" width="10" height="2.5" />
    </>
  ));

/** Multi-Select: a checklist. */
export const multiSelectIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M3 5l1.5 1.5L7 4M3 11l1.5 1.5L7 10M10 5.5h7M10 11.5h7M3 16h4M10 16h7" />
    </>
  ));

/** Clear Filter: a funnel with a cross. */
export const clearFilterIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M2.5 3.5h11l-4.5 5.5v5l-2 1.5v-6.5z" />
      <path d="M13 12l4 4M17 12l-4 4" />
    </>
  ));

/** Report Connections. */
export const connectionsIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="6" height="5" />
      <rect x="11.5" y="12" width="6" height="5" />
      <path d="M8.5 5.5h3v9h0" />
    </>
  ));

/** Slicer Settings. */
export const slicerSettingsIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="3" y="2.5" width="10" height="13" rx="1" />
      <circle cx="14.5" cy="14.5" r="2.5" />
      <path d="M14.5 10.5v1.5M14.5 17v1.5M10.5 14.5h1.5M17 14.5h1.5" />
    </>
  ));
