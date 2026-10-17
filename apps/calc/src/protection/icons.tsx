// Protection icons (20×20 viewBox, stroked like the shared `RibbonIcon`).

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

/** Protect Sheet / Lock Cell / the status bar: a padlock. */
export const lockIcon = (size = 20) =>
  svg(size, <><rect x="4.5" y="9" width="11" height="8" rx="1" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /><path d="M10 12v2" /></>);
/** Protect Workbook: a book with a padlock. */
export const protectBookIcon = (size = 20) =>
  svg(size, <><path d="M3 4h7v12H3z" /><path d="M5 7h3M5 9.5h3" /><rect x="11" y="11" width="6" height="5" rx="0.8" /><path d="M12.5 11V9.5a1.5 1.5 0 0 1 3 0V11" /></>);
