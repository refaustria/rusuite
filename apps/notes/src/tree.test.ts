import { describe, expect, it } from "vitest";
import type { TreeNode } from "./generated/TreeNode";
import { allSections, ancestors, flatPages, indentTarget, outdentTarget, planPageDrop, sectionOf } from "./tree";

const node = (id: string, kind: TreeNode["kind"], children: TreeNode[] = [], parent: string | null = null): TreeNode => ({
  id,
  parent,
  kind,
  title: id,
  color: null,
  pageDoc: kind === "page" ? `pg-${id}` : null,
  created: 0,
  modified: 0,
  children,
});

// Section S: A, B (B1 (B1a)), C
const tree = [
  node("G", "group", [node("S2", "section")]),
  node("S", "section", [node("A", "page"), node("B", "page", [node("B1", "page", [node("B1a", "page")])]), node("C", "page")]),
];
const S = tree[1]!;
const flat = flatPages(S);

describe("tree helpers", () => {
  it("flattens pages with levels and finds sections", () => {
    expect(flat.map((f) => `${f.node.id}:${f.level}:${f.parent}`)).toEqual(["A:0:S", "B:0:S", "B1:1:B", "B1a:2:B1", "C:0:S"]);
    expect(allSections(tree).map((s) => s.id)).toEqual(["S2", "S"]);
    expect(sectionOf(tree, "B1a")?.id).toBe("S");
    expect(ancestors(tree, "B1a").map((n) => n.id)).toEqual(["S", "B", "B1"]);
  });

  it("plans drops: reorder on level 0", () => {
    // C before A.
    expect(planPageDrop(flat, "S", "C", 0, 0)).toEqual({ parent: "S", index: 0 });
    // A after C (gap at the end).
    expect(planPageDrop(flat, "S", "A", 5, 0)).toEqual({ parent: "S", index: 2 });
    // B (with its sub-pages) after C.
    expect(planPageDrop(flat, "S", "B", 5, 0)).toEqual({ parent: "S", index: 2 });
  });

  it("plans drops into a deeper level, clamped by the entry above and the maximum depth", () => {
    // C dropped under A, asking for level 1 → sub-page of A.
    expect(planPageDrop(flat, "S", "C", 1, 1)).toEqual({ parent: "A", index: 0 });
    // Asking for level 2 right below A is clamped to 1.
    expect(planPageDrop(flat, "S", "C", 1, 2)).toEqual({ parent: "A", index: 0 });
    // C after B1a at level 2 → second child of B1.
    expect(planPageDrop(flat, "S", "C", 4, 2)).toEqual({ parent: "B1", index: 1 });
    // C after B1a at level 1 → second child of B.
    expect(planPageDrop(flat, "S", "C", 4, 1)).toEqual({ parent: "B", index: 1 });
    // B has two levels below it: it can only stay on level 0.
    expect(planPageDrop(flat, "S", "B", 1, 1)).toEqual({ parent: "S", index: 1 });
  });

  it("dropping a page into its own block keeps it in place", () => {
    expect(planPageDrop(flat, "S", "B", 3, 0)).toEqual({ parent: "S", index: 1 });
  });

  it("indents and outdents", () => {
    expect(indentTarget(flat, "A")).toBeNull(); // nothing above
    expect(indentTarget(flat, "C")).toEqual({ parent: "B", index: 1 });
    expect(indentTarget(flat, "B")).toBeNull(); // would exceed level 2
    expect(outdentTarget(flat, "A")).toBeNull();
    expect(outdentTarget(flat, "B1a")).toEqual({ parent: "B", index: 1 });
    expect(outdentTarget(flat, "B1")).toEqual({ parent: "S", index: 2 });
  });
});
