// Hand-drawn 20 × 20 icons of the design, master and picture commands
// (own artwork, docs/legal-notes.md).

import type { ReactNode } from "react";

const I = ({ children }: { children: ReactNode }) => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const DI = {
  colors: <I><circle cx="7" cy="7" r="3.5" fill="#c2410c" stroke="none" /><circle cx="13" cy="7" r="3.5" fill="#2563eb" stroke="none" /><circle cx="10" cy="12.5" r="3.5" fill="#16a34a" stroke="none" /></I>,
  fonts: <I><path d="M3 15l4-10 4 10M4.5 11.5h5" /><path d="M13 15V9.5a2 2 0 014 0V15M13 12h4" /></I>,
  bgStyles: <I><rect x="2.5" y="4" width="15" height="12" rx="1" /><path d="M2.5 13l4-4 3 3 3-3 5 5" /></I>,
  bgFormat: <I><rect x="2.5" y="4" width="15" height="12" rx="1" /><path d="M6 13l3-5 2 3 1.5-2L15 13z" fill="currentColor" stroke="none" /></I>,
  slideSize: <I><rect x="2.5" y="5" width="15" height="10" rx="1" /><path d="M6 8v4M14 8v4M6 10h8" /></I>,
  master: <I><rect x="2.5" y="3" width="15" height="9" rx="1" /><path d="M5 15h10M7 17.5h6M5 6h10" /></I>,
  close: <I><rect x="2.5" y="3" width="15" height="14" rx="1" /><path d="M7 7l6 6M13 7l-6 6" /></I>,
  insertLayout: <I><rect x="2.5" y="3.5" width="11" height="8" rx="1" /><path d="M15 12v5M12.5 14.5h5" /></I>,
  reset: <I><path d="M4 10a6 6 0 106-6H7M7 1.8L4.8 4 7 6.2" /></I>,
  headerFooter: <I><rect x="3.5" y="2.5" width="13" height="15" rx="1" /><path d="M5.5 5h9M5.5 15h5M13 15h1.5" /></I>,
  slideNumber: <I><rect x="2.5" y="4" width="15" height="12" rx="1" /><path d="M12 9.5l1.5-1V13" /></I>,
  dateTime: <I><rect x="3" y="4" width="14" height="13" rx="1" /><path d="M3 8h14M7 2.5v3M13 2.5v3M7 12h2M11 12h2" /></I>,
  section: <I><path d="M3 4h14M3 9h9M3 14h9" /><path d="M14 12l3 2-3 2z" fill="currentColor" stroke="none" /></I>,
  crop: <I><path d="M5.5 2v12.5H18M2 5.5h12.5V18" /></I>,
  corrections: <I><circle cx="10" cy="10" r="6.5" /><path d="M10 3.5v13a6.5 6.5 0 000-13z" fill="currentColor" stroke="none" /></I>,
  color: <I><path d="M10 2.5c3 4 5 6.5 5 9a5 5 0 01-10 0c0-2.5 2-5 5-9z" /><path d="M10 16.5a5 5 0 005-5H5a5 5 0 005 5z" fill="currentColor" stroke="none" /></I>,
  transparency: <I><rect x="3" y="3" width="14" height="14" /><path d="M3 3h3.5v3.5H3zM10 3h3.5v3.5H10zM6.5 6.5H10V10H6.5zM13.5 6.5H17V10h-3.5zM3 10h3.5v3.5H3zM10 10h3.5v3.5H10zM6.5 13.5H10V17H6.5zM13.5 13.5H17V17h-3.5z" fill="currentColor" stroke="none" opacity="0.5" /></I>,
  border: <I><rect x="3" y="3" width="14" height="14" strokeWidth="2.4" /></I>,
  shadow: <I><rect x="6" y="6" width="11" height="11" fill="currentColor" stroke="none" opacity="0.35" /><rect x="3" y="3" width="11" height="11" fill="white" /></I>,
  styles: <I><rect x="2.5" y="2.5" width="6.5" height="6.5" /><ellipse cx="14.25" cy="5.75" rx="3.25" ry="3.25" /><rect x="2.5" y="11" width="6.5" height="6.5" rx="2" /><path d="M11 11h6.5v6.5H11z" strokeWidth="2.2" /></I>,
  change: <I><rect x="2.5" y="4" width="11" height="9" rx="1" /><path d="M5 11l2.5-3 2 2 1.5-1.5 2.5 2.5M13 15.5h4.5M15.5 13.5l2 2-2 2" /></I>,
  placeholder: <I><rect x="2.5" y="3.5" width="15" height="13" rx="1" strokeDasharray="2 1.5" /></I>,
  // P8-28: views, rulers, guides, selection, slide show
  normalView: <I><rect x="2.5" y="3.5" width="15" height="13" rx="1" /><path d="M6 3.5v13M3.5 6h1.5M3.5 9h1.5M3.5 12h1.5" /></I>,
  outlineView: <I><path d="M3 4.5h9M5 8h10M5 11.5h8M3 15h9" /></I>,
  sorterView: <I><rect x="2.5" y="3" width="6.5" height="5" rx="0.5" /><rect x="11" y="3" width="6.5" height="5" rx="0.5" /><rect x="2.5" y="11" width="6.5" height="5" rx="0.5" /><rect x="11" y="11" width="6.5" height="5" rx="0.5" /></I>,
  notesPageView: <I><rect x="4" y="2" width="12" height="16" rx="1" /><rect x="6" y="4" width="8" height="5.5" /><path d="M6 12.5h8M6 15h6" /></I>,
  readingView: <I><path d="M2.5 5c2.5-1.5 5-1.5 7.5 0 2.5-1.5 5-1.5 7.5 0v10c-2.5-1.5-5-1.5-7.5 0-2.5-1.5-5-1.5-7.5 0zM10 5v10" /></I>,
  ruler: <I><path d="M2.5 13.5l11-11 4 4-11 11z" /><path d="M6 10l1.5 1.5M8 8l1 1M10 6l1.5 1.5M12 4l1 1" /></I>,
  guides: <I><rect x="2.5" y="3" width="15" height="14" rx="1" /><path d="M10 3v14M2.5 10h15" strokeDasharray="2 1.5" /></I>,
  select: <I><path d="M4 3l9 6.5-4 .8 2.4 4.6-1.6.8-2.4-4.6L4 14z" /></I>,
  selectionPane: <I><rect x="2.5" y="3" width="15" height="14" rx="1" /><path d="M5 7h6M5 10h6M5 13h6" /><circle cx="14" cy="7" r="0.8" fill="currentColor" /><circle cx="14" cy="10" r="0.8" fill="currentColor" /><circle cx="14" cy="13" r="0.8" fill="currentColor" /></I>,
  effects: <I><rect x="3" y="3" width="10" height="10" rx="1.5" /><path d="M13 6h3v10H6v-3" /></I>,
  customShow: <I><rect x="2.5" y="4" width="11" height="8" rx="1" /><rect x="6.5" y="8" width="11" height="8" rx="1" /><path d="M10 11l3 1.5-3 1.5z" /></I>,
  setUpShow: <I><rect x="2.5" y="3" width="15" height="10" rx="1" /><path d="M10 13v3M6.5 17h7" /><circle cx="10" cy="8" r="2" /></I>,
  rehearse: <I><circle cx="10" cy="11" r="6" /><path d="M10 7.5V11l2.5 1.5M8 2.5h4" /></I>,
  record: <I><rect x="2.5" y="4.5" width="15" height="11" rx="1.5" /><circle cx="10" cy="10" r="2.5" fill="currentColor" /></I>,
  hideSlide: <I><rect x="2.5" y="4" width="15" height="11" rx="1" strokeDasharray="2 1.5" /><path d="M4 16L16 3" /></I>,
  regroup: <I><rect x="2.5" y="2.5" width="15" height="15" rx="1" strokeDasharray="2 1.5" /><rect x="5" y="5" width="5" height="5" /><circle cx="12.5" cy="12.5" r="2.5" /></I>,
};
