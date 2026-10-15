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
