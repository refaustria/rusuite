// P8-44 pre-release fixes: circular reference status (C-05), Backspace (C-21),
// column widening on entry (C-23), formats inherited by formulas (C-19).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import de from "./locales/de.json";
import { t } from "./i18n";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("C-05 circular reference status", () => {
  it("reads like Excel's status bar, in English and German", () => {
    expect(t("calc.status.circular", { cell: "B8" })).toBe("Circular reference: B8");
    expect(de["calc.status.circular"].replace("{cell}", "B8")).toBe("Zirkelbezug: B8");
  });
});
