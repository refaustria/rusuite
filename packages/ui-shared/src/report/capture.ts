// "Capture this window": the app's view as a PNG (html-to-image, MIT), without the report dialog. It includes the
// visible document content – the dialog says so. Falls back to JPEG when the PNG is over the 2 MB limit.

import { base64Bytes } from "./validate";
import { REPORT_LIMITS, type ReportScreenshot } from "./types";

/** Elements with this attribute (the report dialog) are left out of the capture. */
export const CAPTURE_EXCLUDE_ATTR = "data-report-exclude";

const PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

export type Capture = () => Promise<ReportScreenshot | null>;

export const captureWindow: Capture = async () => {
  if (typeof document === "undefined") return null;
  const { toPng, toJpeg } = await import("html-to-image");
  const root = document.body;
  const options = {
    pixelRatio: 1,
    cacheBust: false,
    skipFonts: true,
    imagePlaceholder: PLACEHOLDER,
    backgroundColor: getComputedStyle(root).backgroundColor || "#ffffff",
    width: window.innerWidth,
    height: window.innerHeight,
    filter: (node: HTMLElement) => !(node instanceof Element && node.hasAttribute(CAPTURE_EXCLUDE_ATTR)),
  };
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const png = (await toPng(root, options)).replace(/^data:image\/png;base64,/, "");
  if (base64Bytes(png) <= REPORT_LIMITS.screenshotBytesMax) return { name: `window-${stamp}.png`, mime: "image/png", dataBase64: png };
  for (const quality of [0.85, 0.6]) {
    const jpg = (await toJpeg(root, { ...options, quality })).replace(/^data:image\/jpeg;base64,/, "");
    if (base64Bytes(jpg) <= REPORT_LIMITS.screenshotBytesMax) return { name: `window-${stamp}.jpg`, mime: "image/jpeg", dataBase64: jpg };
  }
  return null;
};
