import { describe, expect, it } from "vitest";
import { audienceIdOf, audienceLabel } from "./sync";

describe("audience windows (P11-D2)", () => {
  it("gives each document window its own slide show window", () => {
    expect(audienceLabel("main")).toBe("audience");
    expect(audienceLabel("doc-3")).toBe("audience-doc-3");
  });

  it("reads the audience id of the URL", () => {
    expect(audienceIdOf("?audience=abc1")).toBe("abc1");
    expect(audienceIdOf("?audience=../x")).toBeNull();
  });
});
