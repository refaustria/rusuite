// Pivot table ribbon icons (20×20 viewBox, stroked like the shared `RibbonIcon`).

import type { ReactNode } from "react";

function svg(size: number, body: ReactNode) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {body}
    </svg>
  );
}

/** PivotTable: a grid with a highlighted header row and label column. */
export const pivotIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M2.5 7h15M7 3v14M7 11h10.5M12 7v10" />
      <path d="M3 3.5h14v3H3zM3 7.5h3.5v9H3z" fill="currentColor" stroke="none" opacity="0.25" />
    </>
  ));

export const refreshIcon = (size = 24) =>
  svg(size, (
    <>
      <path d="M16 10a6 6 0 1 1-1.8-4.3" />
      <path d="M16 3.5v3.2h-3.2" />
    </>
  ));

export const sourceIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="10" height="11" />
      <path d="M2.5 6.5h10M6 3v11" />
      <path d="M11 12l6 5M17 13v4h-4" />
    </>
  ));

export const clearIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="11" height="11" />
      <path d="M12 12l5 5M17 12l-5 5" />
    </>
  ));

export const selectIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="15" height="14" strokeDasharray="2 2" />
      <path d="M8 8l6 3-2.5 1 2 3-1 .6-2-3L8.5 14z" fill="currentColor" stroke="none" />
    </>
  ));

export const moveIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="8" height="7" />
      <path d="M9 13h8M14.5 10.5L17 13l-2.5 2.5M6 10v5h4" />
    </>
  ));

export const fieldListIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="3" y="2.5" width="14" height="15" />
      <path d="M6 6.5h8M6 10h8M6 13.5h5" />
    </>
  ));

export const buttonsIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="3" y="3.5" width="6" height="6" />
      <path d="M4.5 6.5h3M11 6.5h6M3 13.5h6M6 11v5M11 13.5h6" />
    </>
  ));

export const headersIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M2.5 7h15" />
      <path d="M3 3.5h14v3H3z" fill="currentColor" stroke="none" opacity="0.35" />
    </>
  ));

export const settingsIcon = (size = 16) =>
  svg(size, (
    <>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5v2.5M10 15v2.5M2.5 10H5M15 10h2.5M4.7 4.7l1.8 1.8M13.5 13.5l1.8 1.8M4.7 15.3l1.8-1.8M13.5 6.5l1.8-1.8" />
    </>
  ));

export const expandIcon = (size = 16) =>
  svg(size, (
    <>
      <rect x="4" y="4" width="12" height="12" />
      <path d="M7 10h6M10 7v6" />
    </>
  ));

export const collapseIcon = (size = 16) =>
  svg(size, (
    <>
      <rect x="4" y="4" width="12" height="12" />
      <path d="M7 10h6" />
    </>
  ));

export const subtotalsIcon = (size = 24) =>
  svg(size, (
    <>
      <path d="M3 4h14M5 7.5h12M5 11h12M3 14.5h14" />
      <path d="M3 13.5h14v2H3z" fill="currentColor" stroke="none" opacity="0.3" />
    </>
  ));

export const grandTotalsIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M2.5 13h15M13 3v14" />
      <path d="M3 13.5h14v3H3zM13.5 3.5h3.5v9.5h-3.5z" fill="currentColor" stroke="none" opacity="0.3" />
    </>
  ));

export const layoutIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M2.5 7h15M7 7v10M4.5 10h1M8.5 12.5h1M4.5 15h1" />
    </>
  ));

export const optionsIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M5.5 7h9M5.5 10h9M5.5 13h5" />
    </>
  ));

/** Group Selection / Group Field: two rows bracketed together. */
export const groupIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M8 5h9M8 10h9M8 15h9" />
      <path d="M5 4H3.5v7H5" />
    </>
  ));

/** Ungroup: the bracket opened. */
export const ungroupIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M8 5h9M8 10h9M8 15h9" />
      <path d="M3.5 4v3M3.5 9v2" />
    </>
  ));

/** Fields, Items & Sets: fx over a column. */
export const calcIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="11" y="3" width="6" height="14" />
      <path d="M8 4.5c-1.5 0-2 1-2 2.5v7c0 1.5-.6 2.5-2 2.5M3.5 9.5h5" />
    </>
  ));

/** PivotChart: columns with the pivot grid behind. */
export const pivotChartIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="15" height="14" opacity="0.4" />
      <path d="M6 15v-5M10 15V7M14 15v-3" strokeWidth="2.5" />
    </>
  ));

/** Recommended PivotTables: the grid with a star. */
export const recommendedPivotIcon = (size = 24) =>
  svg(size, (
    <>
      <rect x="2.5" y="5" width="11" height="12" />
      <path d="M2.5 9h11M6.5 5v12" />
      <path d="M16 2l.9 1.9 2.1.3-1.5 1.4.4 2.1L16 6.7l-1.9 1 .4-2.1L13 4.2l2.1-.3z" fill="currentColor" stroke="none" />
    </>
  ));

/** Blank Rows: rows with a gap. */
export const blankRowsIcon = (size = 24) =>
  svg(size, (
    <>
      <path d="M3 4h14M3 7h14M3 13h14M3 16h14" />
      <path d="M3 10h14" strokeDasharray="1.5 1.5" />
    </>
  ));
