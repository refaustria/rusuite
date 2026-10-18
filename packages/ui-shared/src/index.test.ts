import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { UI_SHARED_VERSION } from "./index";

describe("ui-shared", () => {
  it("exports a version", () => {
    expect(UI_SHARED_VERSION).toBe(pkg.version);
  });
});
