import { describe, expect, it } from "vitest";
import { designFixture } from "../test/fixture";
import { canMoveSection, moveToSectionCommand, removeAllSectionsCommand, sectionOf, sectionRanges } from "./sections";

describe("sections in the slide panel", () => {
  const pres = designFixture(); // Intro: 1, 4 · Body: 7, 20

  it("ranges and membership", () => {
    expect(sectionRanges(pres).map((r) => [r.name, r.start, r.count])).toEqual([["Intro", 0, 2], ["Body", 2, 2]]);
    expect(sectionRanges({ sections: undefined })).toEqual([]);
    expect(sectionOf(pres, 7)).toBe(1);
    expect(sectionOf(pres, 99)).toBe(-1);
  });

  it("dropping a slide at the start of another section: MoveSlide + RestoreSections in one step", () => {
    // at the same deck position (last of Intro → first of Body): only the sections change
    expect(moveToSectionCommand(pres, 4, 1, 0)).toEqual({
      type: "restoreSections",
      sections: [{ name: "Intro", slideIds: [1] }, { name: "Body", slideIds: [4, 7, 20] }],
    });
    expect(moveToSectionCommand(pres, 20, 0, 0)).toEqual({
      type: "compound",
      commands: [
        { type: "moveSlide", id: 20, toIndex: 0 },
        { type: "restoreSections", sections: [{ name: "Intro", slideIds: [20, 1, 4] }, { name: "Body", slideIds: [7] }] },
      ],
    });
  });

  it("no change → no command; into an empty section", () => {
    expect(moveToSectionCommand(pres, 1, 0, 0)).toBeNull();
    const p = { ...pres, sections: [...pres.sections!, { name: "Empty", slideIds: [] }] };
    expect(moveToSectionCommand(p, 7, 2, 0)).toEqual({
      type: "compound",
      commands: [
        { type: "moveSlide", id: 7, toIndex: 3 },
        { type: "restoreSections", sections: [{ name: "Intro", slideIds: [1, 4] }, { name: "Body", slideIds: [20] }, { name: "Empty", slideIds: [7] }] },
      ],
    });
    expect(moveToSectionCommand(pres, 7, 5, 0)).toBeNull();
  });

  it("remove all, move up / down bounds", () => {
    expect(removeAllSectionsCommand()).toEqual({ type: "restoreSections", sections: [] });
    expect(canMoveSection(pres, 0, -1)).toBe(false);
    expect(canMoveSection(pres, 0, 1)).toBe(true);
    expect(canMoveSection(pres, 1, 1)).toBe(false);
  });
});
