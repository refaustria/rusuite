import { describe, expect, it } from "vitest";
import { NO_ENV } from "./editor/env";
import { changedBlocks, imageBlobs, renderContent } from "./render";

describe("history diff and static rendering", () => {
  it("marks the blocks of the older version that the current page does not have", () => {
    expect(changedBlocks(["a", "b", "c"], ["a", "b", "c"])).toEqual([false, false, false]);
    expect(changedBlocks(["a", "old", "c"], ["a", "new", "c"])).toEqual([false, true, false]);
    expect(changedBlocks(["a", "b"], ["x", "a", "y", "b", "z"])).toEqual([false, false]);
    expect(changedBlocks(["gone"], [])).toEqual([true]);
  });

  it("renders pictures from blob URLs, attachments as cards, live page titles, tag icons and changed marks", () => {
    const json = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { tags: ["todo"], checked: true }, content: [{ type: "text", text: "done " }, { type: "pageLink", attrs: { pageId: "pg-a", title: "Old title" } }, { type: "pageLink", attrs: { pageId: "pg-gone", title: "Gone" } }] },
        { type: "image", attrs: { blob: "b1", alt: "cat", width: 150, height: 75, align: "center" } },
        { type: "attachment", attrs: { blob: "b2", name: "report.pdf", size: 1_250_000 } },
      ],
    };
    expect(imageBlobs(json)).toEqual(["b1"]);
    const env = { ...NO_ENV, pageTitle: (id: string) => (id === "pg-a" ? "New title" : null), tagLabel: () => "To Do" };
    const el = renderContent(json, { env, urls: new Map([["b1", "blob:x/1"]]), changed: [false, true, false] });
    const links = el.querySelectorAll("a.page-link");
    expect(links[0]!.textContent).toBe("New title");
    expect(links[1]!.classList.contains("broken")).toBe(true);
    const img = el.querySelector("figure img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("blob:x/1");
    expect(img.style.width).toBe("150pt");
    expect(el.querySelector("figure")!.getAttribute("data-align")).toBe("center");
    expect(el.querySelector("figure")!.classList.contains("notes-changed")).toBe(true);
    expect(el.querySelector(".notes-attachment-name")!.textContent).toBe("report.pdf");
    expect(el.querySelector(".notes-attachment-icon")!.textContent).toBe("PDF");
    expect(el.querySelector("p .notes-tag-icon")!.getAttribute("title")).toBe("To Do");
    expect(el.querySelector("p")!.classList.contains("notes-done")).toBe(true);
  });
});
