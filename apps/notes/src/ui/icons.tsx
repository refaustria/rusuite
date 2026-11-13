// Notes' own ribbon icons (20×20, stroked like ui-shared's).

import type { ReactNode } from "react";

const P = (d: string) => <path d={d} />;

const PATHS = {
  bullets: <><circle cx="4" cy="5.5" r="1" fill="currentColor" /><circle cx="4" cy="10" r="1" fill="currentColor" /><circle cx="4" cy="14.5" r="1" fill="currentColor" /><path d="M7.5 5.5h9M7.5 10h9M7.5 14.5h9" /></>,
  numbers: <><path d="M3 4.5h1.5v3M3 7.5h3M3 12.5c0-1 2.5-1 2.5 0S3 14 3 15.5h2.5" /><path d="M8.5 5.5h8M8.5 10h8M8.5 14.5h8" /></>,
  checklist: <><rect x="2.5" y="3.5" width="4" height="4" rx="0.8" /><path d="M3.3 5.6l1 1 1.6-2" /><rect x="2.5" y="12" width="4" height="4" rx="0.8" /><path d="M9 5.5h8M9 14h8" /></>,
  indent: P("M3 4h14M9 8h8M9 12h8M3 16h14M3 8l3 2-3 2z"),
  outdent: P("M3 4h14M9 8h8M9 12h8M3 16h14M6 8l-3 2 3 2z"),
  highlight: <><path d="M5 13l7-8 3 3-8 7H5z" /><path d="M3 17.5h14" strokeWidth="2.5" stroke="#f5d90a" /></>,
  textColor: <><path d="M6 13l4-9 4 9M7.4 10h5.2" /><path d="M3 17.5h14" strokeWidth="2.5" /></>,
  clearFormat: P("M5 4h10M10 4l-3 12M12 11l5 5M17 11l-5 5"),
  tag: <><path d="M3 3h6.5l7.5 7.5-6.5 6.5L3 9.5z" /><circle cx="6.5" cy="6.5" r="1.2" /></>,
  link: P("M8.5 11.5a3 3 0 004.2 0l2.6-2.6a3 3 0 00-4.2-4.2l-1 1M11.5 8.5a3 3 0 00-4.2 0l-2.6 2.6a3 3 0 004.2 4.2l1-1"),
  pageLink: <><path d="M5 2.5h7l3 3v12H5z" /><path d="M8 11h4M8 13.5h3" /><path d="M7.5 7.5h1.5M11 7.5h1.5" strokeWidth="2" /></>,
  divider: <><path d="M3 10h14" strokeWidth="2" /><path d="M5 5h10M5 15h10" opacity="0.4" /></>,
  code: P("M7 6l-4 4 4 4M13 6l4 4-4 4M11 4l-2 12"),
  date: <><rect x="3" y="4.5" width="14" height="12" rx="1.5" /><path d="M3 8h14M7 3v3M13 3v3" /></>,
  time: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l3 2" /></>,
  nav: <><rect x="2.5" y="3.5" width="15" height="13" rx="1.5" /><path d="M7.5 3.5v13" /></>,
  width: P("M3 10h14M6 7l-3 3 3 3M14 7l3 3-3 3"),
  zoomIn: <><circle cx="8.5" cy="8.5" r="5" /><path d="M12.5 12.5L17 17M6.5 8.5h4M8.5 6.5v4" /></>,
  zoomOut: <><circle cx="8.5" cy="8.5" r="5" /><path d="M12.5 12.5L17 17M6.5 8.5h4" /></>,
  moon: P("M15.5 12.5A6.5 6.5 0 017.5 4.5a6.5 6.5 0 108 8z"),
  quote: P("M4 8.5h4v4H5.5L4 15zM11 8.5h4v4h-1.5L12 15z"),
  newPage: <><path d="M5 2.5h7l3 3v12H5z" /><path d="M10 8.5v5M7.5 11h5" /></>,
  subPage: <><path d="M3 4h7M7 9h10M7 14h10M4 4v7.5h2" /></>,
  section: <><rect x="3" y="3" width="14" height="14" rx="1.5" /><path d="M7 3v14" /></>,
  history: <><path d="M3.5 10a6.5 6.5 0 102-4.7" /><path d="M3 3.5v3h3" /><path d="M10 6.5V10l2.5 1.5" /></>,
} satisfies Record<string, ReactNode>;

export type NotesIconName = keyof typeof PATHS;

export function NotesIcon({ name, size = 16 }: { name: NotesIconName; size?: number }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}
