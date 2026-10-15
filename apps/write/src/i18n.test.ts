import { describe, expect, it } from "vitest";
import { compareCatalogs } from "@rusuite/ui-shared";
import de from "./locales/de.json";
import en from "./locales/en.json";

describe("catalogs", () => {
  it("de.json has exactly the keys of en.json", () => {
    expect(compareCatalogs(en, de)).toEqual({ missing: [], extra: [] });
  });
});
