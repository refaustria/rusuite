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
