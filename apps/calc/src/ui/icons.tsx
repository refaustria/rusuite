// Calc-only ribbon icons (20×20 viewBox, stroked like the shared `RibbonIcon`).

import type { ReactNode } from "react";

function svg(size: number, body: ReactNode) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {body}
    </svg>
  );
}

/** Merge & Center: a row of cells joined, arrows pointing to the centre. */
export const mergeIcon = (size = 16) =>
  svg(size, (
    <>
      <rect x="2.5" y="5" width="15" height="10" />
      <path d="M4.5 10h3.5M6.5 8.5L8 10l-1.5 1.5M15.5 10H12M13.5 8.5L12 10l1.5 1.5" />
    </>
  ));

/** Unmerge: the cell split again. */
export const unmergeIcon = (size = 16) =>
  svg(size, (
    <>
      <rect x="2.5" y="5" width="15" height="10" />
      <path d="M10 5v10" />
    </>
  ));

/** Freeze Panes: a sheet with the top row and first column set off. */
export const freezeIcon = (size = 22) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M2.5 7h15M7 3v14" strokeWidth="2.2" />
      <path d="M11 11h4M11 14h4" />
    </>
  ));

/** Headings: column letters and row numbers around a sheet. */
export const headingsIcon = (size = 16) =>
  svg(size, (
    <>
      <rect x="2.5" y="2.5" width="15" height="15" />
      <path d="M2.5 6.5h15M6.5 2.5v15" />
    </>
  ));

/** Sort A to Z: letters A over Z and a down arrow. */
export const sortAscIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M3 8l2-5 2 5M3.7 6.5h2.6M3 12h4l-4 5h4" />
      <path d="M14 3v14M11 14l3 3 3-3" />
    </>
  ));

/** Sort Z to A: letters Z over A and a down arrow. */
export const sortDescIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M3 3h4l-4 5h4M3 17l2-5 2 5M3.7 15.5h2.6" />
      <path d="M14 3v14M11 14l3 3 3-3" />
    </>
  ));

/** Custom Sort: stacked bars of different lengths and an arrow. */
export const sortIcon = (size = 22) =>
  svg(size, (
    <>
      <path d="M3 4h6M3 8h8M3 12h10M3 16h12" />
      <path d="M16 3v10M14 11l2 2 2-2" />
    </>
  ));

/** Filter: a funnel. */
export const filterIcon = (size = 22) => svg(size, <path d="M3 4h14l-5.5 6.5V16l-3 1.5v-7z" />);

/** Clear filter: a funnel with a cross. */
export const clearFilterIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M2 4h11l-4 5v5l-3 1.5V9z" />
      <path d="M13 12l4 4M17 12l-4 4" />
    </>
  ));

/** Reapply: a funnel with a circular arrow. */
export const reapplyIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M2 4h11l-4 5v5l-3 1.5V9z" />
      <path d="M17 13a2.5 2.5 0 1 1-1-2M16 9.5v1.5h1.5" />
    </>
  ));

/** Conditional Formatting: a table with a highlighted cell and a data bar. */
export const condFormatIcon = (size = 22) =>
  svg(size, (
    <>
      <rect x="2.5" y="2.5" width="15" height="15" />
      <path d="M2.5 7.5h15M2.5 12.5h15M10 2.5v15" />
      <rect x="3.5" y="8.5" width="5.5" height="3" fill="#F8696B" stroke="none" />
      <rect x="11" y="13.5" width="4" height="3" fill="#638EC6" stroke="none" />
    </>
  ));

/** Data Validation: a cell with a check mark and a stop sign. */
export const validationIcon = (size = 22) =>
  svg(size, (
    <>
      <rect x="2.5" y="4.5" width="10" height="7" />
      <path d="M4.5 8l2 2 4-4" stroke="#2E9E48" />
      <circle cx="14.5" cy="14.5" r="3.5" stroke="#E0393E" />
      <path d="M12.5 16.5l4-4" stroke="#E0393E" />
    </>
  ));

// --- Formulas tab (P8-23) ---------------------------------------------------

/** Insert Function: fx. */
export const fxIcon = (size = 20) =>
  svg(size, (
    <>
      <path d="M8 3.5c-1.5 0-2 1-2.3 2.5L4.5 16.5" />
      <path d="M3.5 8h5" />
      <path d="M10.5 9l5 6M15.5 9l-5 6" />
    </>
  ));

/** AutoSum: Σ. */
export const sigmaIcon = (size = 20) => svg(size, <path d="M14.5 4h-9l5 6-5 6h9" />);

/** A function category: a small book. */
export const libraryIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M4 4.5h8.5v11H4z" />
      <path d="M6.5 4.5v11M14.5 6v10.5H6.5" />
    </>
  ));

/** Name Manager: a tag over a grid. */
export const nameManagerIcon = (size = 20) =>
  svg(size, (
    <>
      <rect x="2.5" y="8.5" width="15" height="9" />
      <path d="M2.5 13h15M7.5 8.5v9" />
      <path d="M5 2.5h7l2 2.5-2 2.5H5z" />
    </>
  ));

/** Define Name: a tag with a plus. */
export const defineNameIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M3 6h8.5l3 3-3 3H3z" />
      <path d="M15.5 13v4M13.5 15h4" />
    </>
  ));

/** Use in Formula: a tag and an equals sign. */
export const useNameIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M3 4h8l2.5 2.5L11 9H3z" />
      <path d="M5 13h8M5 16h8" />
    </>
  ));

/** Create from Selection: a range with a label row. */
export const createNamesIcon = (size = 16) =>
  svg(size, (
    <>
      <rect x="3" y="3.5" width="14" height="13" />
      <path d="M3 7.5h14M8 3.5v13" />
    </>
  ));

/** Trace Precedents: an arrow into a cell. */
export const tracePrecedentsIcon = (size = 16) =>
  svg(size, (
    <>
      <circle cx="4" cy="5" r="1.5" />
      <path d="M5 6l7.5 7" />
      <path d="M12.5 10v3.5H9" />
      <rect x="13" y="13" width="4.5" height="4" />
    </>
  ));

/** Trace Dependents: an arrow out of a cell. */
export const traceDependentsIcon = (size = 16) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="4.5" height="4" />
      <path d="M7 7l7 7" />
      <path d="M14 10.5V14h-3.5" />
      <circle cx="16" cy="16" r="1.5" />
    </>
  ));

/** Remove Arrows: an arrow struck through. */
export const removeArrowsIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M3 10h11M11 7l3 3-3 3" />
      <path d="M4 16L16 4" />
    </>
  ));

/** Show Formulas: a sheet with fx. */
export const showFormulasIcon = (size = 16) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M7 7c-.7 0-1 .5-1.2 1.2L5 14M4.5 10h3M10 9l4 5M14 9l-4 5" />
    </>
  ));

/** Accounting number format: a banknote. */
export const accountingIcon = (size = 16) =>
  svg(size, (
    <>
      <rect x="2" y="5" width="16" height="10" rx="1" />
      <circle cx="10" cy="10" r="2.5" />
    </>
  ));
