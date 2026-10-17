import { describe, expect, it } from "vitest";
import { fromR1C1, toR1C1 } from "./r1c1";

describe("R1C1 reference style (P9-C4)", () => {
  it("shows A1 formulas in R1C1 style", () => {
    expect(toR1C1("=SUM(A1:A3)*$B$2+C:C", 3, 3)).toBe("=SUM(R[-3]C[-3]:R[-1]C[-3])*R2C2+C[-1]");
    expect(toR1C1("=Sheet2!B5&\"A1\"", 4, 1)).toBe("=Sheet2!RC&\"A1\"");
    expect(toR1C1("=SUM($2:$3)", 0, 0)).toBe("=SUM(R2:R3)");
    expect(toR1C1("12", 0, 0)).toBe("12");
  });

  it("reads R1C1 entries back", () => {
    expect(fromR1C1("=SUM(R[-3]C[-3]:R[-1]C[-3])*R2C2+C[-1]", 3, 3)).toBe("=SUM(A1:A3)*$B$2+C:C");
    expect(fromR1C1("=RC[-1]*2", 4, 1)).toBe("=A5*2");
    expect(fromR1C1("=ROUND(R1C1,0)+COUNT(C2)", 0, 0)).toBe("=ROUND($A$1,0)+COUNT($B:$B)");
    expect(fromR1C1("=Table1[R1]", 0, 0)).toBe("=Table1[R1]");
    expect(fromR1C1("=R[-5]C", 0, 0)).toBeNull();
    for (const [f, r, c] of [["=A1+$B2*Sheet2!C$3", 5, 5], ["=SUM(B:$D)", 0, 2]] as const) {
      expect(fromR1C1(toR1C1(f, r, c), r, c)).toBe(f);
    }
  });
});
