// Review tab and Link icons (20×20 viewBox, stroked like the shared `RibbonIcon`).

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

const bubble = <path d="M3 4.5h14v9H9l-3.5 3v-3H3z" />;

/** New Comment: a speech bubble with a plus. */
export const newCommentIcon = (size = 20) => svg(size, <>{bubble}<path d="M10 6.5v4.5M7.75 8.75h4.5" /></>);
/** Delete: a bubble with a cross. */
export const deleteCommentIcon = (size = 20) => svg(size, <>{bubble}<path d="M8 7l4 3.5M12 7l-4 3.5" /></>);
/** Previous / Next Comment. */
export const prevCommentIcon = (size = 20) => svg(size, <>{bubble}<path d="M11.5 6.5L9 9l2.5 2.5" /></>);
export const nextCommentIcon = (size = 20) => svg(size, <>{bubble}<path d="M8.5 6.5L11 9l-2.5 2.5" /></>);
/** Show Comments: stacked bubbles. */
export const showCommentsIcon = (size = 20) =>
  svg(size, (
    <>
      <path d="M2.5 3.5h10v6.5H7l-2.5 2v-2h-2z" />
      <path d="M14.5 7h3v7.5h-2v2l-2.5-2h-4.5v-2.5" />
    </>
  ));
/** Notes: a sticky note with a folded corner. */
export const noteIcon = (size = 20) =>
  svg(size, (
    <>
      <path d="M3.5 3.5h13v9l-4 4h-9z" fill="#fff4a3" />
      <path d="M12.5 16.5v-4h4M6 7h7M6 10h5" />
    </>
  ));
/** Link: two chain links. */
export const linkIcon = (size = 20) =>
  svg(size, (
    <>
      <path d="M8.5 11.5a3 3 0 004.2 0l3-3a3 3 0 00-4.2-4.2l-1 1" />
      <path d="M11.5 8.5a3 3 0 00-4.2 0l-3 3a3 3 0 004.2 4.2l1-1" />
    </>
  ));
/** Resolve: a check mark. */
export const resolveIcon = (size = 16) => svg(size, <path d="M4 10.5l4 4 8-9" />);
