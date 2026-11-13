// Canvas pages and ink (P11-N4): what the page view and the ribbon use.

import type { PageMirror } from "../editor/mirror";
import { canvasStepsFor } from "./hooks";
import { CanvasLayout } from "./layout";
import "./canvas.css";

export { CanvasView } from "./CanvasView";
export { useDrawTab } from "./DrawTab";
export { useCanvasMode } from "./hooks";
export { InkHiddenNotice } from "./InkNotice";

/** The editor extension laying out a canvas page's text boxes (installed on every page; idle while it flows). */
export const canvasExtension = (mirror: PageMirror) => CanvasLayout.configure({ steps: canvasStepsFor(mirror) });
