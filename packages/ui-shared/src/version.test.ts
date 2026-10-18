import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { publicVersion, RUSUITE_VERSION } from "./version";

describe("publicVersion", () => {
  it("drops a trailing .0 patch (π numbering, docs/versioning.md)", () => {
    expect(publicVersion("3.141.0")).toBe("3.141");
    expect(publicVersion("3.1415.0")).toBe("3.1415");
    expect(publicVersion("v3.141.0")).toBe("3.141");
    expect(publicVersion("3.141.0-rc.1")).toBe("3.141.0-rc.1");
  });
  it("keeps hotfix numbers and anything that is not a semver", () => {
    expect(publicVersion("3.141.1")).toBe("3.141.1");
    expect(publicVersion("3.141.10")).toBe("3.141.10");
    expect(publicVersion("3.140.0")).toBe("3.140");
    expect(publicVersion("unknown")).toBe("unknown");
  });
  it("the build version is the package version", () => {
    expect(RUSUITE_VERSION).toBe(pkg.version);
    expect(RUSUITE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
