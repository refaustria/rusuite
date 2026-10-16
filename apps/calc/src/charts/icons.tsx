// Chart ribbon icons (own drawings, 20×20 viewBox, stroked like the shared
// `RibbonIcon`; a few coloured accents as in the other galleries).

import type { ReactNode } from "react";

function svg(size: number, body: ReactNode) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {body}
    </svg>
  );
}

const BLUE = "#4472C4";
const ORANGE = "#ED7D31";
const GRAY = "#A5A5A5";

/** Recommended Charts: columns with a check mark. */
export const recommendedIcon = (size = 22) =>
  svg(size, (
    <>
      <path d="M2.5 17.5h15" />
      <rect x="4" y="9" width="2.5" height="8.5" fill={BLUE} stroke="none" />
      <rect x="8" y="5.5" width="2.5" height="12" fill={ORANGE} stroke="none" />
      <path d="M12.5 6.5l2 2 3.5-4" stroke={BLUE} />
    </>
  ));

export const columnIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M2.5 17.5h15" />
      <rect x="4" y="8" width="3" height="9.5" fill={BLUE} stroke="none" />
      <rect x="8.5" y="4" width="3" height="13.5" fill={ORANGE} stroke="none" />
      <rect x="13" y="10" width="3" height="7.5" fill={GRAY} stroke="none" />
    </>
  ));

export const lineIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M2.5 17.5h15M2.5 2.5v15" />
      <path d="M4 13l4-4 3 2.5 5.5-6" stroke={BLUE} strokeWidth="1.8" />
      <path d="M4 15.5l4-2 3 1 5.5-3" stroke={ORANGE} strokeWidth="1.8" />
    </>
  ));

export const pieIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M10 3a7 7 0 1 0 7 7h-7z" fill={BLUE} stroke="none" />
      <path d="M11.5 1.6a7 7 0 0 1 6.9 6.9h-6.9z" fill={ORANGE} stroke="none" />
    </>
  ));

export const scatterIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M2.5 17.5h15M2.5 2.5v15" />
      {[[6, 13], [8.5, 10.5], [11, 11.5], [13, 7.5], [15.5, 5]].map(([x, y]) => (
        <circle key={`${x}`} cx={x} cy={y} r="1.3" fill={BLUE} stroke="none" />
      ))}
    </>
  ));

export const comboIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M2.5 17.5h15" />
      <rect x="4" y="10" width="3" height="7.5" fill={BLUE} stroke="none" />
      <rect x="8.5" y="8" width="3" height="9.5" fill={BLUE} stroke="none" />
      <rect x="13" y="11" width="3" height="6.5" fill={BLUE} stroke="none" />
      <path d="M5.5 7l4.5-3 4.5 4" stroke={ORANGE} strokeWidth="1.8" />
    </>
  ));

/** Add Chart Element: a chart with a plus. */
export const addElementIcon = (size = 22) =>
  svg(size, (
    <>
      <rect x="2.5" y="3.5" width="12" height="12" />
      <path d="M5 13V9.5M8 13V7M11 13v-2" stroke={BLUE} />
      <path d="M16.5 12v6M13.5 15h6" />
    </>
  ));

/** Quick Layout: a chart frame with title bar and legend blocks. */
export const quickLayoutIcon = (size = 22) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="15" height="14" />
      <path d="M6 5.5h8" />
      <rect x="4.5" y="8" width="8" height="7" stroke={BLUE} />
      <path d="M14.5 9h1.5M14.5 11.5h1.5" stroke={ORANGE} />
    </>
  ));

/** Change Colors: three swatches. */
export const colorsIcon = (size = 22) =>
  svg(size, (
    <>
      <circle cx="6" cy="7" r="3" fill={BLUE} stroke="none" />
      <circle cx="13.5" cy="7" r="3" fill={ORANGE} stroke="none" />
      <circle cx="9.75" cy="13.5" r="3" fill={GRAY} stroke="none" />
    </>
  ));

/** Chart Styles: a chart with a brush stroke. */
export const stylesIcon = (size = 22) =>
  svg(size, (
    <>
      <rect x="2.5" y="3.5" width="15" height="13" />
      <rect x="5" y="9" width="2.5" height="5" fill={BLUE} stroke="none" />
      <rect x="9" y="6.5" width="2.5" height="7.5" fill={ORANGE} stroke="none" />
      <path d="M13.5 14l3-6" stroke={GRAY} strokeWidth="2" />
    </>
  ));

/** Switch Row/Column: a grid with crossing arrows. */
export const switchIcon = (size = 22) =>
  svg(size, (
    <>
      <rect x="2.5" y="2.5" width="9" height="9" />
      <path d="M2.5 5.5h9M5.5 2.5v9" />
      <path d="M14 6.5h3.5V10M16 8.5l1.5 1.5L19 8.5" />
      <path d="M6.5 14v3.5H10M8.5 16l1.5 1.5L8.5 19" />
    </>
  ));

/** Select Data: a table next to columns. */
export const selectDataIcon = (size = 22) =>
  svg(size, (
    <>
      <rect x="2.5" y="3" width="8" height="12" />
      <path d="M2.5 7h8M2.5 11h8M6.5 3v12" />
      <path d="M12.5 17.5h6" />
      <rect x="13" y="11" width="2" height="6.5" fill={BLUE} stroke="none" />
      <rect x="16" y="8" width="2" height="9.5" fill={ORANGE} stroke="none" />
    </>
  ));

/** Change Chart Type: a column chart and a pie with an arrow. */
export const changeTypeIcon = (size = 22) =>
  svg(size, (
    <>
      <path d="M2 10h7" />
      <rect x="3" y="5" width="2" height="5" fill={BLUE} stroke="none" />
      <rect x="6" y="3" width="2" height="7" fill={ORANGE} stroke="none" />
      <path d="M14.5 10a4 4 0 1 0 4-4h-4z" fill={BLUE} stroke="none" transform="translate(-2 4)" />
      <path d="M7 14.5c0 2 1.5 3 3.5 3M9 16l1.5 1.5L9 19" />
    </>
  ));

/** Move Chart: a chart going to another sheet tab. */
export const moveChartIcon = (size = 22) =>
  svg(size, (
    <>
      <rect x="2.5" y="2.5" width="10" height="9" />
      <rect x="4.5" y="6" width="2" height="4" fill={BLUE} stroke="none" />
      <rect x="8" y="4.5" width="2" height="5.5" fill={ORANGE} stroke="none" />
      <path d="M10 17.5h7.5M15 15l2.5 2.5L15 20" />
      <path d="M7.5 11.5v6h2.5" />
    </>
  ));

/** Format Selection: a pane with sliders. */
export const formatPaneIcon = (size = 16) =>
  svg(size, (
    <>
      <rect x="3" y="2.5" width="14" height="15" />
      <path d="M6 7h8M6 10.5h8M6 14h5" />
      <circle cx="9" cy="7" r="1" fill="currentColor" />
      <circle cx="12" cy="10.5" r="1" fill="currentColor" />
    </>
  ));

/** Reset to Match Style. */
export const resetStyleIcon = (size = 16) =>
  svg(size, (
    <>
      <path d="M4 10a6 6 0 1 0 2-4.5" />
      <path d="M3.5 3v3.5H7" />
    </>
  ));
