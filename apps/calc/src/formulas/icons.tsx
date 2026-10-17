// Icons of the Formulas tab's Calculation and auditing tools (P9-C4), in
// the line style of `ui/icons.tsx`.

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
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {body}
    </svg>
  );
}

/** Calculation Options: a calculator with a gear. */
export const calcOptionsIcon = (size = 22) =>
  svg(size, (
    <>
      <rect x="3" y="2.5" width="10" height="14" rx="1" />
      <path d="M5 5h6M5.5 8.5h1M8.5 8.5h1M5.5 11.5h1M8.5 11.5h1" />
      <circle cx="15" cy="14.5" r="2.5" />
      <path d="M15 10.8v1.2M15 17v1.2M11.3 14.5h1.2M17.5 14.5h1.2" />
    </>
  ));

/** Calculate Now: a calculator with a circular arrow. */
export const calcNowIcon = (size = 16) =>
  svg(size, (
    <>
      <rect x="2.5" y="2.5" width="9" height="13" rx="1" />
      <path d="M4.5 5h5M5 8.5h1M8 8.5h1M5 11.5h1M8 11.5h1" />
      <path d="M17 11a3.5 3.5 0 1 1-1-2.5M17 7.5V9.5h-2" />
    </>
  ));

/** Calculate Sheet: a sheet with a circular arrow. */
export const calcSheetIcon = (size = 16) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="10" height="12" />
      <path d="M2.5 7h10M2.5 11h10M6 3v12" />
      <path d="M17.5 12.5a3 3 0 1 1-.9-2.2M17.5 9.5v2h-2" />
    </>
  ));

/** Error Checking: a cell with a warning triangle. */
export const errorCheckIcon = (size = 16) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="10" height="9" />
      <path d="M14 9.5l3.5 6.5h-7z" />
      <path d="M14 12v1.5M14 15v.1" />
    </>
  ));

/** Evaluate Formula: fx with a magnifier. */
export const evaluateIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M3 13.5c1.5 0 1.5-1 2-4.5s1-5 2.5-5M3.5 8h4.5" />
      <circle cx="13" cy="11" r="3.2" />
      <path d="M15.3 13.3l2.5 2.5" />
    </>
  ));

/** Watch Window: a window with glasses. */
export const watchIcon = (size = 22) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="15" height="11" />
      <path d="M2.5 6h15" />
      <circle cx="7" cy="16.5" r="2" />
      <circle cx="13" cy="16.5" r="2" />
      <path d="M9 16.5h2" />
    </>
  ));
