// Icons used by the ribbons (20×20 viewBox, stroked like `Icon`).

import type { ReactNode } from "react";

export type RibbonIconName =
  | "cut" | "copy" | "paste" | "undo" | "redo" | "clear" | "find"
  | "insertRows" | "insertCols" | "deleteRows" | "deleteCols" | "rowHeight" | "colWidth" | "insertCells" | "deleteCells" | "format"
  | "sheet" | "percent" | "comma" | "decimalMore" | "decimalLess"
  | "zoom" | "gridlines" | "formulaBar" | "keyboard"
  | "table" | "image" | "pageBreak" | "lineBreak" | "pageSize" | "orientation" | "margins" | "lineSpacing"
  | "newSlide" | "duplicate" | "trash" | "rect" | "roundRect" | "ellipse" | "line" | "textBox" | "arrange" | "shapes"
  | "present" | "presentCurrent"
  | "new" | "open" | "save" | "saveAs" | "pdf" | "print" | "home" | "close" | "back" | "recent"
  | "alignJustify" | "chevronDown" | "chevronUp" | "options";

const P = (d: string) => <path d={d} />;
const page = <path d="M5 2.5h7l3 3v12H5z" />;

const PATHS: Record<RibbonIconName, ReactNode> = {
  options: <><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" /></>,
  cut: <><circle cx="6" cy="15" r="2.2" /><circle cx="14" cy="15" r="2.2" /><path d="M7.5 13.5L14 3M12.5 13.5L6 3" /></>,
  copy: <><rect x="7" y="6" width="9" height="11" rx="1" /><path d="M5 13H4V3h8v2" /></>,
  paste: <><path d="M7 4H4.5v13.5h11V4H13" /><rect x="7" y="2.5" width="6" height="3" rx="1" /><path d="M7.5 10h5M7.5 13h5" /></>,
  undo: P("M7 5L3.5 8.5 7 12M4 8.5h8a4.5 4.5 0 010 9H9"),
  redo: P("M13 5l3.5 3.5L13 12M16 8.5H8a4.5 4.5 0 000 9h3"),
  clear: <><path d="M3 15l7-8 6 6-3.5 4H5z" /><path d="M8.5 9l5 5M3 17.5h14" /></>,
  find: <><circle cx="8.5" cy="8.5" r="5" /><path d="M12.5 12.5L17 17" /></>,
  insertRows: <><rect x="3" y="3" width="14" height="5" /><rect x="3" y="12" width="14" height="5" /><path d="M10 8.5v3M8.5 10h3" /></>,
  insertCols: <><rect x="3" y="3" width="5" height="14" /><rect x="12" y="3" width="5" height="14" /><path d="M10 8.5v3M8.5 10h3" /></>,
  deleteRows: <><rect x="3" y="3" width="14" height="5" /><rect x="3" y="12" width="14" height="5" /><path d="M8.5 10h3" /></>,
  deleteCols: <><rect x="3" y="3" width="5" height="14" /><rect x="12" y="3" width="5" height="14" /><path d="M8.5 10h3" /></>,
  rowHeight: <><path d="M3 6h14M3 14h14M10 7.5v5M8.5 9L10 7.5 11.5 9M8.5 11l1.5 1.5 1.5-1.5" /></>,
  colWidth: <><path d="M6 3v14M14 3v14M7.5 10h5M9 8.5L7.5 10 9 11.5M11 8.5l1.5 1.5-1.5 1.5" /></>,
  insertCells: <><rect x="3" y="3" width="14" height="14" /><path d="M3 10h14M10 3v14" /><path d="M14 12.5v4M12 14.5h4" strokeWidth="2" /></>,
  deleteCells: <><rect x="3" y="3" width="14" height="14" /><path d="M3 10h14M10 3v14" /><path d="M12 14.5h4" strokeWidth="2" /></>,
  format: <><rect x="3" y="3" width="14" height="14" /><path d="M3 8h14M8 3v14" /><path d="M11 12h4M11 14.5h3" /></>,
  sheet: <><rect x="3" y="4" width="14" height="12" /><path d="M3 8h14M3 12h14M8 4v12" /></>,
  percent: <><circle cx="6" cy="6" r="2" /><circle cx="14" cy="14" r="2" /><path d="M15 4L5 16" /></>,
  comma: <><path d="M5 13h1.2v2.2L5 17" strokeWidth="2" /><path d="M10 6h7M10 10h7M10 14h4" /></>,
  decimalMore: <><path d="M2.5 13h1" strokeWidth="2.2" /><path d="M6 10.5a1.8 2.5 0 103.6 0 1.8 2.5 0 10-3.6 0M11.5 10.5a1.8 2.5 0 103.6 0 1.8 2.5 0 10-3.6 0" /><path d="M6 17h10M14 15.5l2 1.5-2 1.5" /></>,
  decimalLess: <><path d="M2.5 13h1" strokeWidth="2.2" /><path d="M6 10.5a1.8 2.5 0 103.6 0 1.8 2.5 0 10-3.6 0" /><path d="M6 17h10M8 15.5L6 17l2 1.5" /></>,
  zoom: <><circle cx="8.5" cy="8.5" r="5" /><path d="M12.5 12.5L17 17M6.5 8.5h4M8.5 6.5v4" /></>,
  gridlines: <><rect x="3" y="3" width="14" height="14" strokeDasharray="2 1.5" /><path d="M3 8h14M3 12.5h14M8 3v14M12.5 3v14" strokeDasharray="2 1.5" /></>,
  formulaBar: <><rect x="2.5" y="6" width="15" height="8" rx="1" /><path d="M5 12l1-4h2M5.2 10h2.3" /></>,
  keyboard: <><rect x="2" y="5" width="16" height="10" rx="1.5" /><path d="M5 8h1M8 8h1M11 8h1M14 8h1M5 11h1M14 11h1M8 11h4" /></>,
  table: <><rect x="3" y="4" width="14" height="12" /><path d="M3 8h14M3 12h14M7.7 4v12M12.3 4v12" /></>,
  image: <><rect x="2.5" y="4" width="15" height="12" rx="1" /><circle cx="7" cy="8" r="1.5" /><path d="M3 15l5-5 4 4 2-2 3.5 3.5" /></>,
  pageBreak: <><path d="M5 2.5v5h10v-5M5 17.5v-5h10v5" /><path d="M2.5 10h2M7 10h2M11 10h2M15.5 10h2" /></>,
  lineBreak: P("M16 4v6a3 3 0 01-3 3H4M7 10l-3 3 3 3"),
  pageSize: <>{page}<path d="M12 2.5v3h3" /></>,
  orientation: <><rect x="3" y="2.5" width="8" height="11" /><rect x="8" y="10" width="9.5" height="7" /></>,
  margins: <><rect x="4" y="2.5" width="12" height="15" /><path d="M7 2.5v15M13 2.5v15M4 5.5h12M4 14.5h12" strokeDasharray="1.5 1.5" /></>,
  lineSpacing: <><path d="M9 5h8M9 10h8M9 15h8M4.5 3v14M2.5 5l2-2 2 2M2.5 15l2 2 2-2" /></>,
  newSlide: <><rect x="2.5" y="4" width="12" height="9" rx="0.5" /><path d="M5 7h7M5 9.5h5" /><path d="M16 12v6M13 15h6" strokeWidth="1.8" /></>,
  duplicate: <><rect x="6.5" y="6.5" width="10" height="8" rx="0.5" /><path d="M4 12V4h10" /></>,
  trash: P("M3.5 5.5h13M8 5.5V3.5h4v2M5 5.5l1 12h8l1-12M8.5 8.5v6M11.5 8.5v6"),
  rect: <rect x="3" y="5" width="14" height="10" />,
  roundRect: <rect x="3" y="5" width="14" height="10" rx="3" />,
  ellipse: <ellipse cx="10" cy="10" rx="7" ry="5" />,
  line: P("M3.5 16.5l13-13"),
  textBox: <><rect x="2.5" y="4" width="15" height="12" strokeDasharray="2 1.5" /><path d="M6.5 7.5h7M10 7.5v6" /></>,
  arrange: <><rect x="2.5" y="2.5" width="9" height="9" /><rect x="8.5" y="8.5" width="9" height="9" fill="currentColor" fillOpacity="0.25" /></>,
  shapes: <><rect x="2.5" y="9" width="7" height="8" /><circle cx="13" cy="7" r="4.5" /></>,
  present: <><rect x="2.5" y="3" width="15" height="10" rx="0.5" /><path d="M10 13v4M7 17h6M8.5 6.2v4.6L12.5 8.5z" /></>,
  presentCurrent: <><rect x="2.5" y="3" width="15" height="10" rx="0.5" /><path d="M10 13v4M7 17h6M6 8h4M8.5 6.5L10 8l-1.5 1.5M12.5 6v4" /></>,
  new: <>{page}<path d="M12 2.5v3h3M10 9v5M7.5 11.5h5" /></>,
  open: P("M2.5 5.5v11h12.5l2.5-7H6l-2.5 7M2.5 5.5h5l1.5 1.5h6v2.5"),
  save: <><path d="M3.5 3.5h10l3 3v10h-13z" /><path d="M6.5 3.5v4h6v-4M6 16.5v-5h8v5" /></>,
  saveAs: <><path d="M3.5 3.5h10l3 3v4M3.5 3.5v13h6" /><path d="M6.5 3.5v4h6v-4" /><path d="M11 17l1-3 4.5-4.5 2 2L14 16z" /></>,
  pdf: <>{page}<path d="M7 11.5h1.2a1 1 0 000-2H7v4M10.5 9.5v4h.8a1.5 2 0 000-4z" /></>,
  print: <><path d="M6 8V3h8v5M6 14H4a1 1 0 01-1-1V9a1 1 0 011-1h12a1 1 0 011 1v4a1 1 0 01-1 1h-2" /><path d="M6 11h8v6H6z" /></>,
  home: P("M3 10l7-6 7 6M5 8.5V16h4v-4h2v4h4V8.5"),
  close: P("M5 5l10 10M15 5L5 15"),
  back: <><circle cx="10" cy="10" r="7.5" /><path d="M10.5 6.5L7 10l3.5 3.5M7 10h6.5" /></>,
  recent: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2.5" /></>,
  alignJustify: P("M3 5h14M3 9h14M3 13h14M3 17h14"),
  chevronDown: P("M6 8l4 4 4-4"),
  chevronUp: P("M6 12l4-4 4 4"),
};

/** A ribbon icon; `size` in px (large buttons use 22). */
export function RibbonIcon({ name, size = 16 }: { name: RibbonIconName; size?: number }) {
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
      {PATHS[name]}
    </svg>
  );
}
