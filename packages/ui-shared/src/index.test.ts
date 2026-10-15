import { describe, expect, it } from "vitest";
import { UI_SHARED_VERSION } from "./index";

describe("ui-shared", () => {
  it("exports a version", () => {
    expect(UI_SHARED_VERSION).toBe("0.1.0");
  });
});
