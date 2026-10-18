// P9-X2: the reader warnings of Calc and Show in the UI language (coded warnings of fmt-xlsx / fmt-pptx, W-26) and
// F12 = Save As in every app (Office's key; Calc and Show keep Ctrl+Shift+S as well).
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { crc32 } from "node:zlib";
import { downloadBuffer, testdata, trackErrors } from "../support/common";
import { unzip } from "../support/zip";

/** A zip of `files` (stored entries), enough for the readers. */
function zip(files: Map<string, Buffer>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(n.length, 26);
    local.push(head, n, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, n);
    offset += 30 + n.length + data.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

/** A copy of a testdata file with one part edited. */
function edited(kind: string, file: string, part: string, edit: (xml: string) => string): Buffer {
  const files = unzip(fs.readFileSync(testdata(kind, file)));
  const xml = files.get(part)!.toString("utf8");
  const next = edit(xml);
  expect(next).not.toBe(xml);
  files.set(part, Buffer.from(next, "utf8"));
  return zip(files);
}

async function openFile(page: Page, tab: string, open: RegExp, name: string, buffer: Buffer, mimeType: string) {
  await page.getByRole("tab", { name: tab, exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("backstage").getByRole("button", { name: open }).click();
  await (await chooser).setFiles({ name, mimeType, buffer });
}

test.describe("P9-X2 in German", () => {
  test.use({ locale: "de-DE" });

  test("Calc: the reader's warning (OLE objects of sheet Data) is shown in German", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("calc/");
    await page.getByTestId("grid").waitFor();
    const xlsx = edited("xlsx", "provisional-basic.xlsx", "xl/worksheets/sheet1.xml", (x) => x.replace("</worksheet>", "<oleObjects/></worksheet>"));
    await openFile(page, "Datei", /^Öffnen/, "ole.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const w = page.getByTestId("open-warnings");
    await expect(w).toHaveText("Blatt „Data“: OLE-Objekte verworfen");
    expect(await w.getAttribute("title")).toBe("Blatt „Data“: OLE-Objekte verworfen");
    errors.expectNone();
  });

  test("Show: the reader's warning (WordArt text warp) is shown in German", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("show/");
    await page.getByTestId("editor-stage").waitFor();
    const pptx = edited("pptx", "provisional-10-text-box.pptx", "ppt/slides/slide1.xml", (x) =>
      x.replace(/(<a:bodyPr[^>]*[^/]>)/, '$1<a:prstTxWarp prst="textArchUp"><a:avLst/></a:prstTxWarp>'),
    );
    await openFile(page, "Datei", /^Öffnen/, "warp.pptx", pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    await expect(page.getByTestId("doc-name")).toHaveText("warp.pptx");
    const w = page.getByTestId("warnings");
    await expect(w).toHaveText("1 Warnung: Textverzerrung (WordArt) verworfen");
    expect(await w.getAttribute("title")).not.toContain("dropped");
    errors.expectNone();
  });
});

test.describe("P9-X2: F12 is Save As", () => {
  const apps = [
    { name: "calc", ready: (p: Page) => p.getByTestId("grid"), file: "Workbook.xlsx", saved: "f12.xlsx" },
    { name: "write", ready: (p: Page) => p.locator(".ProseMirror"), file: "Document.docx", saved: "f12.docx" },
    { name: "show", ready: (p: Page) => p.getByTestId("editor-stage"), file: "Presentation.pptx", saved: "f12.pptx" },
  ] as const;
  for (const app of apps) {
    test(`${app.name}: F12 asks for a file name and downloads under it; the backstage and Ctrl+/ show F12`, async ({ page }) => {
      await page.goto(`${app.name}/`);
      await app.ready(page).waitFor();
      await app.ready(page).click();
      await page.keyboard.press("F12");
      const name = page.getByLabel("File name");
      await expect(name).toHaveValue(new RegExp(`^${app.file.split(".")[0]}`));
      await name.fill("f12");
      const [dl] = await Promise.all([page.waitForEvent("download"), name.press("Enter")]);
      expect(dl.suggestedFilename()).toBe(app.saved);
      expect((await downloadBuffer(dl)).subarray(0, 2).toString()).toBe("PK");
      await page.getByRole("tab", { name: "File", exact: true }).click();
      await expect(page.getByTestId("backstage").getByRole("button", { name: /^Save As/ })).toHaveAttribute("title", "Save As… (F12)");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Control+/");
      const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
      await expect(help).toContainText("F12");
      if (app.name !== "write") await expect(help).toContainText("Ctrl+Shift+S");
    });
  }
});
