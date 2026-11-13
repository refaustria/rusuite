// P11-N5b: live sharing of a notebook through the end-to-end encrypted relay, two or three browser contexts (separate
// profiles = separate devices) against a real `notes-relay`. Needs `NOTES_RELAY_DIR` (the relay's storage dir; the
// relay runs behind serve.mjs's `/api/notes/` proxy, `NOTES_RELAY_PORT`) – skipped otherwise.
//   share → invite → admit → concurrent edits in one paragraph → identical; remote cursor with name; typing latency;
//   offline edits on both sides merge without loss or dialog; concurrent moves of one page; read-only member (editor
//   not editable, forged update refused); late joiner with full history; pictures; IME composition during a remote
//   edit; removal (banner, offline edits never reach the others); stop sharing; request audit and no plaintext on the
//   relay's disk. `NOTES_SHOTS=<dir>` saves screenshots (P11-N5b-*.png).

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const relayDir = process.env.NOTES_RELAY_DIR;
const shots = process.env.NOTES_SHOTS;

test.skip(!relayDir, "needs a notes relay (NOTES_RELAY_DIR + NOTES_RELAY_PORT for serve.mjs)");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const MARK = `PLAIN${Date.now().toString(36)}MARK`;

interface User {
  name: string;
  ctx: BrowserContext;
  page: Page;
  requests: string[];
}

type Ctl = {
  getState(): {
    notebook: string | null;
    opened: { docId: string; notebookId: string } | null;
    shares: Record<string, { phase: string; role: string | null; members: { name: string; role: string; device: string }[]; peers: unknown[] }>;
    notebooks: { summary: { id: string; info: { name: string } }; tree: TreeNode[] }[];
    mirror: { doc: { getMap(n: string): { size: number; set(k: string, v: unknown): void }; commit(): void; oplogVersion(): unknown; export(o: unknown): Uint8Array } } | null;
  };
  idle(): Promise<void>;
  history(doc: string): Promise<unknown[]>;
  move(node: string, parent: string | null, index: number): Promise<void>;
  createSection(title: string): Promise<void>;
  sync: { engines: Map<string, { idle(): Promise<unknown>; phase: string; crypto: Record<string, (...a: unknown[]) => Uint8Array>; send(f: Uint8Array): boolean; notebook: string; localId: string }> };
};
interface TreeNode {
  id: string;
  kind: string;
  title: string;
  pageDoc: string | null;
  children: TreeNode[];
}

const editor = (p: Page) => p.getByTestId("page-editor");

async function newUser(browser: Browser, name: string): Promise<User> {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("websocket", (ws) => requests.push(ws.url()));
  page.on("pageerror", (e) => console.warn(`[${name}] pageerror`, e.message));
  await page.goto("notes/");
  await expect(editor(page)).toBeVisible();
  return { name, ctx, page, requests };
}

const ctl = (p: Page) => p.evaluateHandle(() => (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes);

async function shareState(p: Page) {
  return p.evaluate(() => {
    const c = (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes;
    const s = c.getState();
    return s.notebook ? (s.shares[s.notebook] ?? null) : null;
  });
}

async function synced(...users: User[]) {
  for (const u of users) await expect(u.page.getByTestId("sync-state")).toHaveAttribute("data-state", "synced", { timeout: 20_000 });
}

/** The open page's text (all blocks). */
const text = (p: Page) =>
  editor(p).evaluate((el) => {
    // The editor's document (DOM text would include the remote cursors' labels).
    const doc = (el as unknown as { editor: { state: { doc: { content: { size: number }; textBetween(a: number, b: number, sep: string, leaf: string): string } } } }).editor.state.doc;
    return doc.textBetween(0, doc.content.size, "\n", " ");
  });

/** Waits until all users show the same text of the open page; returns it. */
async function converged(users: User[], timeout = 20_000): Promise<string> {
  let last: string[] = [];
  await expect
    .poll(
      async () => {
        last = await Promise.all(users.map((u) => text(u.page).then((s) => s.replace(/[⁠\s]+$/g, ""))));
        return last.every((s) => s === last[0]);
      },
      { timeout },
    )
    .toBe(true)
    .catch((e: unknown) => {
      console.log("not converged:\n" + last.map((l) => JSON.stringify(l.slice(0, 400))).join("\n"));
      throw e;
    });
  return last[0]!;
}

async function shot(p: Page, name: string) {
  if (shots) await p.screenshot({ path: path.join(shots, `P11-N5b-${name}.png`) });
}

async function createLink(owner: User, kind: "edit" | "read" | "self"): Promise<string> {
  const dialog = owner.page.getByTestId("share-dialog");
  if (!(await dialog.isVisible())) await owner.page.getByTestId("share-button").click();
  await dialog.getByTestId(`invite-create-${kind}`).click();
  const link = await dialog.getByTestId(`invite-link-${kind}`).inputValue();
  expect(link).toMatch(/#i=[A-Za-z0-9_-]+&n=/);
  return link;
}

async function closeDialog(p: Page) {
  await p.getByTestId("share-dialog").getByRole("button", { name: "Close" }).last().click();
  await expect(p.getByTestId("share-dialog")).toHaveCount(0);
}

/** Opens an invite link in `u`, waits for "Waiting for …", the owner admits from the toast; the notebook opens. */
async function joinWith(owner: User, u: User, link: string, inviter = owner.name) {
  await u.page.goto(link);
  await expect(editor(u.page)).toBeVisible();
  const nameDialog = u.page.getByTestId("join-name");
  await expect(nameDialog).toBeVisible();
  await nameDialog.getByTestId("share-name").fill(u.name);
  await nameDialog.getByTestId("share-name-ok").click();
  await expect(u.page.getByTestId("join-wait-text")).toContainText(`Waiting for ${inviter} to let you in`);
  const toast = owner.page.getByTestId("join-toast").filter({ hasText: u.name });
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await toast.getByTestId("join-admit").click();
  await expect(u.page.getByTestId("join-waiting")).toHaveCount(0, { timeout: 20_000 });
  await synced(u);
}

/** Opens the page `from` has open in `to`. */
async function openSamePage(from: User, to: User) {
  const doc = await from.page.evaluate(() => (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes.getState().opened!.docId);
  await to.page.evaluate((d) => (window as unknown as { __rusuiteNotes: { openPageByDoc(d: string): Promise<boolean> } }).__rusuiteNotes.openPageByDoc(d), doc);
  await expect(to.page.getByTestId("page")).toHaveAttribute("data-doc", doc);
}

/** Opens the page titled `title` of the current notebook. */
async function openPageTitled(u: User, title: string) {
  const doc = allPages(await tree(u.page)).find((p) => p.title === title)!.pageDoc!;
  await u.page.evaluate((d) => (window as unknown as { __rusuiteNotes: { openPageByDoc(d: string): Promise<boolean> } }).__rusuiteNotes.openPageByDoc(d), doc);
  await expect(u.page.getByTestId("page")).toHaveAttribute("data-doc", doc);
}

/** The page docs of the current notebook, by title. */
async function tree(p: Page): Promise<TreeNode[]> {
  return p.evaluate(() => {
    const s = (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes.getState();
    return s.notebooks.find((n) => n.summary.id === s.notebook)!.tree;
  });
}

function allPages(t: TreeNode[]): TreeNode[] {
  return t.flatMap((n) => [...(n.kind === "page" ? [n] : []), ...allPages(n.children)]);
}

function shape(t: TreeNode[]): unknown {
  return t.map((n) => ({ kind: n.kind, title: n.title, children: shape(n.children) }));
}

/** Every character of `s`, in order, somewhere in `t`. */
function expectSubsequence(t: string, s: string) {
  let at = 0;
  for (const c of s) {
    const i = t.indexOf(c, at);
    expect(i, `"${c}" of "${s}" in "${t}"`).toBeGreaterThanOrEqual(0);
    at = i + 1;
  }
}

async function typeAtEndOfFirstParagraph(u: User, s: string, delay = 0) {
  await editor(u.page).locator("p").first().click();
  await u.page.keyboard.press("End");
  await u.page.keyboard.type(s, { delay });
}

test.describe("notes sharing", () => {
  let anna: User;
  let ben: User;
  let rita: User | null = null;
  const latency: number[] = [];

  test.beforeAll(async ({ browser }) => {
    anna = await newUser(browser, "Anna");
    ben = await newUser(browser, "Ben");
  });
  test.afterAll(async () => {
    await anna?.ctx.close();
    await ben?.ctx.close();
    await rita?.ctx.close();
  });

  test("an unshared notebook never contacts the relay", async () => {
    await typeAtEndOfFirstParagraph(anna, " private");
    await anna.page.evaluate(() => (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes.idle());
    expect(anna.requests.filter((u) => u.includes("/api/notes/"))).toEqual([]);
    expect(ben.requests.filter((u) => u.includes("/api/notes/"))).toEqual([]);
  });

  test("share → invite → admit → concurrent edits in one paragraph converge; remote cursor with the name", async () => {
    await anna.page.getByTestId("share-button").click();
    const dialog = anna.page.getByTestId("share-dialog");
    await dialog.getByTestId("share-name").fill("Anna");
    await dialog.getByTestId("share-name-ok").click();
    await dialog.getByTestId("share-on").click();
    await expect(dialog.getByTestId("share-members")).toContainText("Anna");
    await expect(dialog.getByTestId("share-coowner-hint")).toBeVisible();
    await synced(anna);
    const link = await createLink(anna, "edit");
    await shot(anna.page, "share-dialog");
    await closeDialog(anna.page);
    await joinWith(anna, ben, link);
    // Ben has Anna's notebook and page.
    const a0 = await converged([anna, ben]);
    expect(a0).toContain("private");
    await expect(anna.page.getByTestId("people-bar").getByTestId("person")).toHaveAttribute("data-name", "Ben", { timeout: 15_000 });
    // Both type into the same paragraph at the same time.
    await Promise.all([typeAtEndOfFirstParagraph(anna, ` ${MARK}-anna-one-two-three`, 15), typeAtEndOfFirstParagraph(ben, " ben-alpha-beta-gamma", 15)]);
    const t = await converged([anna, ben]);
    // Both runs are there in order (they may interleave where both typed at the same spot), nothing doubled.
    const first = t.split("\n")[0]!;
    expectSubsequence(first, `${MARK}-anna-one-two-three`);
    expectSubsequence(first, "ben-alpha-beta-gamma");
    expect(first.length).toBe(a0.split("\n")[0]!.length + ` ${MARK}-anna-one-two-three`.length + " ben-alpha-beta-gamma".length);
    // Ben's caret is shown on Anna's page with his name.
    await editor(ben.page).locator("p").first().click();
    await expect(anna.page.getByTestId("remote-cursor").filter({ hasText: "Ben" })).toBeVisible({ timeout: 10_000 });
    await expect(ben.page.getByTestId("remote-cursor").filter({ hasText: "Anna" })).toBeVisible({ timeout: 10_000 });
    // The last editor of a block on hover.
    await editor(anna.page).locator("p").first().hover();
    await expect(anna.page.getByTestId("last-editor")).toHaveAttribute("aria-label", /^Edited by (Ben|you), /);
    // Navigation: a dot for Ben on the page.
    await expect(anna.page.getByTestId("page-dot").first()).toBeVisible();
    if (shots) {
      await shot(anna.page, "two-windows-anna");
      await shot(ben.page, "two-windows-ben");
    }
  });

  test("typing latency keystroke → visible on the other context", async () => {
    await editor(ben.page).locator("p").first().click();
    await ben.page.keyboard.press("End");
    await anna.page.evaluate(() => {
      const w = window as unknown as { __keys: Record<string, number> };
      w.__keys = {};
      document.addEventListener("keydown", (e) => (w.__keys[e.key] ??= Date.now()), true);
    });
    const seq = "QWERTZUIOPASDFGHJKLYXCVBNM";
    await ben.page.evaluate((seq) => {
      const w = window as unknown as { __seen: Record<string, number> };
      w.__seen = {};
      const el = document.querySelector('[data-testid="page-editor"]')!;
      new MutationObserver(() => {
        const s = (el as HTMLElement).innerText;
        for (const c of seq) if (!(c in w.__seen) && s.includes(`~${c}`)) w.__seen[c] = Date.now();
      }).observe(el, { subtree: true, childList: true, characterData: true });
    }, seq);
    await editor(anna.page).locator("p").first().click();
    await anna.page.keyboard.press("End");
    for (const c of seq) {
      await anna.page.keyboard.type(`~${c}`);
      await anna.page.waitForTimeout(60);
    }
    await converged([anna, ben]);
    const keys = await anna.page.evaluate(() => (window as unknown as { __keys: Record<string, number> }).__keys);
    const seen = await ben.page.evaluate(() => (window as unknown as { __seen: Record<string, number> }).__seen);
    for (const c of seq) if (seen[c] && keys[c]) latency.push(seen[c]! - keys[c]!);
    latency.sort((a, b) => a - b);
    const median = latency[Math.floor(latency.length / 2)]!;
    const p95 = latency[Math.min(latency.length - 1, Math.floor(latency.length * 0.95))]!;
    console.log(`notes-sharing latency keystroke → remote visible: median ${median} ms, p95 ${p95} ms (n=${latency.length})`);
    test.info().annotations.push({ type: "latency", description: `median ${median} ms, p95 ${p95} ms, n=${latency.length}` });
    fs.mkdirSync(test.info().project.outputDir, { recursive: true });
    fs.writeFileSync(path.join(test.info().project.outputDir, "notes-sharing-latency.json"), JSON.stringify({ median, p95, samples: latency }));
    expect(latency.length).toBeGreaterThan(seq.length / 2);
    expect(median).toBeLessThan(500);
  });

  test("offline edits on both sides merge: identical, no lost characters, no dialog", async () => {
    await synced(anna, ben);
    const before = await text(anna.page);
    await ben.ctx.setOffline(true);
    await expect(ben.page.getByTestId("sync-state")).toHaveAttribute("data-state", "offline", { timeout: 10_000 });
    const benText = " offline-ben-0123456789-abcdefghij-klmnopqrst";
    const annaText = " online-anna-ZYXWVUTSRQ-9876543210";
    await Promise.all([typeAtEndOfFirstParagraph(ben, benText, 5), typeAtEndOfFirstParagraph(anna, annaText, 5)]);
    // Ben also adds a paragraph while offline.
    await ben.page.keyboard.press("Enter");
    await ben.page.keyboard.type("Second paragraph written offline");
    await ben.page.waitForTimeout(500);
    expect(await text(anna.page)).not.toContain("offline-ben");
    await expect(ben.page.getByTestId("sync-state")).toHaveText(/Offline – changes will sync/);
    await ben.ctx.setOffline(false);
    const t = await converged([anna, ben], 30_000);
    expect(t).toContain("Second paragraph written offline");
    // No character lost (the two runs may interleave but each keeps its order).
    for (const r of [benText.trim(), annaText.trim()]) expectSubsequence(t, r);
    expect(t.length).toBeGreaterThanOrEqual(before.length + benText.length + annaText.length);
    await expect(anna.page.getByRole("dialog")).toHaveCount(0);
    await expect(ben.page.getByRole("dialog")).toHaveCount(0);
    await synced(anna, ben);
  });

  test("concurrent moves of one page to different sections leave one page", async () => {
    await openSamePage(anna, ben);
    // Two sections and a page to move, synced to Ben.
    await anna.page.evaluate(async () => {
      const c = (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes;
      await c.createSection("Left");
      await c.createSection("Right");
    });
    await expect.poll(async () => JSON.stringify(shape(await tree(ben.page)))).toBe(JSON.stringify(shape(await tree(anna.page))));
    await openPageTitled(anna, "Welcome to Rusuite Notes");
    await openSamePage(anna, ben);
    const t0 = await tree(anna.page);
    const sections = t0.filter((n) => n.kind === "section");
    const left = sections.find((s) => s.title === "Left")!;
    const right = sections.find((s) => s.title === "Right")!;
    const page = allPages(sections[0]!.children)[0]!;
    await ben.ctx.setOffline(true);
    await expect(ben.page.getByTestId("sync-state")).toHaveAttribute("data-state", "offline", { timeout: 10_000 });
    await anna.page.evaluate(([p, s]) => (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes.move(p!, s!, 0), [page.id, left.id]);
    await ben.page.evaluate(([p, s]) => (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes.move(p!, s!, 0), [page.id, right.id]);
    await ben.ctx.setOffline(false);
    await synced(anna, ben);
    await expect.poll(async () => JSON.stringify(shape(await tree(ben.page))), { timeout: 15_000 }).toBe(JSON.stringify(shape(await tree(anna.page))));
    const t1 = await tree(anna.page);
    expect(allPages(t1).filter((p) => p.id === page.id)).toHaveLength(1);
    // And the navigation shows it once.
    const parent = t1.find((s) => allPages(s.children).some((p) => p.id === page.id))!;
    expect(["Left", "Right"]).toContain(parent.title);
  });

  test("read-only member: editor not editable, forged updates refused", async ({ browser }) => {
    rita = await newUser(browser, "Rita");
    const link = await createLink(anna, "read");
    await closeDialog(anna.page);
    await joinWith(anna, rita, link);
    await openSamePage(anna, rita);
    await expect(rita.page.getByTestId("readonly-banner")).toBeVisible();
    await expect(editor(rita.page)).toHaveAttribute("contenteditable", "false");
    const before = await text(anna.page);
    await editor(rita.page).click();
    await rita.page.keyboard.type("rita was here");
    await rita.page.waitForTimeout(300);
    expect(await text(rita.page)).not.toContain("rita was here");
    // A forged update straight to the relay (bypassing the UI): the relay refuses it, Anna never sees it.
    await rita.page.evaluate(() => {
      const c = (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes;
      const s = c.getState();
      const e = [...c.sync.engines.values()].find((x) => x.localId === s.notebook)!;
      const doc = s.mirror!.doc;
      const from = doc.oplogVersion();
      doc.getMap("forged").set("x", 1);
      doc.commit();
      const bytes = doc.export({ mode: "update", from });
      const env = e.crypto.sealDoc!(e.notebook, s.opened!.docId, 0, bytes);
      e.send(e.crypto.publish!(4242, env));
    });
    await expect(rita.page.getByTestId("sync-state")).toHaveAttribute("data-state", "error", { timeout: 10_000 });
    await anna.page.waitForTimeout(500);
    expect(await anna.page.evaluate(() => (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes.getState().mirror!.doc.getMap("forged").size)).toBe(0);
    expect(await text(anna.page)).toBe(before);
  });

  test("a late joiner gets the full history; history shows names", async ({ browser }) => {
    const carl = await newUser(browser, "Carl");
    try {
      const link = await createLink(anna, "edit");
      await closeDialog(anna.page);
      await joinWith(anna, carl, link);
      const docA = await anna.page.evaluate(() => (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes.getState().opened!.docId);
      await openSamePage(anna, carl);
      await converged([anna, carl]);
      const h = (p: Page) => p.evaluate((doc) => (window as unknown as { __rusuiteNotes: Ctl }).__rusuiteNotes.history(doc).then((x) => x.length), docA);
      await expect.poll(() => h(carl.page), { timeout: 15_000 }).toBe(await h(anna.page));
      await carl.page.getByRole("tab", { name: "View" }).click();
      await carl.page.getByRole("button", { name: "Page history" }).click();
      await expect(carl.page.getByTestId("history-panel")).toContainText("Ben");
      await expect(carl.page.getByTestId("history-panel")).toContainText("Anna");
    } finally {
      await carl.ctx.close();
    }
  });

  test("pictures sync (blob envelopes, fetched on demand)", async () => {
    await openSamePage(anna, ben);
    const png = await anna.page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 60;
      const g = c.getContext("2d")!;
      g.fillStyle = "#2a7";
      g.fillRect(0, 0, 120, 60);
      const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    });
    await editor(anna.page).locator("p").first().click();
    await anna.page.getByRole("tab", { name: "Insert" }).click();
    const chooser = anna.page.waitForEvent("filechooser");
    await anna.page.getByRole("button", { name: "Picture", exact: true }).click();
    await (await chooser).setFiles({ name: "green.png", mimeType: "image/png", buffer: Buffer.from(png) });
    const img = editor(ben.page).getByTestId("image").locator("img");
    await expect(img).toHaveCount(1, { timeout: 15_000 });
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 15_000 }).toBe(120);
  });

  test("IME composition during a remote edit stays clean (German dead key)", async () => {
    await synced(anna, ben);
    await editor(anna.page).locator("p").first().click();
    await anna.page.keyboard.press("End");
    await anna.page.keyboard.type(" ime:");
    const cdp = await anna.ctx.newCDPSession(anna.page);
    await cdp.send("Input.imeSetComposition", { text: "^", selectionStart: 1, selectionEnd: 1 });
    await editor(ben.page).locator("p").first().click();
    await ben.page.keyboard.press("Home");
    await ben.page.keyboard.type("REMOTE");
    await anna.page.waitForTimeout(400);
    await cdp.send("Input.insertText", { text: "ê" });
    const t = await converged([anna, ben]);
    expect(t.split("ê").length - 1).toBe(1);
    expect(t).toContain("ime:ê");
    expect(t).toContain("REMOTE");
    expect(t).not.toContain("^");
  });

  test("a removed member gets the banner; their offline edits never reach the others", async () => {
    await synced(anna, ben);
    await ben.ctx.setOffline(true);
    await expect(ben.page.getByTestId("sync-state")).toHaveAttribute("data-state", "offline", { timeout: 10_000 });
    await typeAtEndOfFirstParagraph(ben, " ben-secret-after-removal");
    // Anna removes Ben (with the explanation).
    await anna.page.getByTestId("share-button").click();
    const member = anna.page.getByTestId("member").filter({ hasText: "Ben" });
    await member.getByTestId("member-remove").click();
    await expect(anna.page.getByTestId("member-remove-confirm")).toContainText("keep the copy");
    await anna.page.getByTestId("member-remove-ok").click();
    await expect(anna.page.getByTestId("member").filter({ hasText: "Ben" })).toHaveCount(0, { timeout: 10_000 });
    await closeDialog(anna.page);
    await synced(anna);
    await ben.ctx.setOffline(false);
    await expect(ben.page.getByTestId("removed-banner")).toBeVisible({ timeout: 20_000 });
    await expect(ben.page.getByTestId("removed-banner")).toContainText("You were removed from this notebook. Your copy stays on this device.");
    await expect(editor(ben.page)).toHaveAttribute("contenteditable", "false");
    // Ben keeps his copy (with his unsent edit) …
    expect(await text(ben.page)).toContain("ben-secret-after-removal");
    await shot(ben.page, "removed-banner");
    // … Anna (and Rita) never get it.
    await anna.page.waitForTimeout(1500);
    expect(await text(anna.page)).not.toContain("ben-secret-after-removal");
    if (rita) expect(await text(rita.page)).not.toContain("ben-secret-after-removal");
  });

  test("offline banner screenshot; stop sharing deletes the server copy, everybody keeps theirs", async () => {
    if (rita) {
      await rita.ctx.setOffline(true);
      await expect(rita.page.getByTestId("sync-state")).toHaveAttribute("data-state", "offline", { timeout: 10_000 });
      await shot(rita.page, "offline");
      await rita.ctx.setOffline(false);
      await synced(rita);
    }
    const nbHex = (await shareState(anna.page))!;
    expect(nbHex.role).toBe("owner");
    const dirsBefore = fs.readdirSync(relayDir!).length;
    expect(dirsBefore).toBeGreaterThan(0);
    await anna.page.getByTestId("share-button").click();
    await anna.page.getByTestId("share-stop").click();
    await anna.page.getByTestId("share-stop-confirm").click();
    await expect(anna.page.getByTestId("toast")).toContainText("Sharing stopped", { timeout: 10_000 });
    await expect(anna.page.getByTestId("sync-state")).toHaveCount(0);
    if (rita) await expect(rita.page.getByTestId("stopped-banner")).toBeVisible({ timeout: 10_000 });
    expect(fs.readdirSync(relayDir!).length).toBe(dirsBefore - 1);
    // Anna's notebook is local again and still editable.
    await expect(anna.page.getByTestId("share-on")).toBeVisible();
    await closeDialog(anna.page);
    await typeAtEndOfFirstParagraph(anna, " still mine");
    await expect(editor(anna.page)).toContainText("still mine");
  });

  test("privacy: shared notebooks only use /api/notes/ws; the relay's disk holds no plaintext", async () => {
    for (const u of [anna, ben, ...(rita ? [rita] : [])]) {
      const api = u.requests.filter((r) => /\/api\//.test(r));
      expect(api.length, u.name).toBeGreaterThan(0);
      for (const r of api) expect(new URL(r).pathname, u.name).toBe("/api/notes/ws");
    }
    const needles = [MARK, "anna-one-two-three", "offline-ben", "Second paragraph", "Anna", "Ben", "Rita", "Welcome to Rusuite Notes", "nodeName"].map((s) => Buffer.from(s));
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) (f.isDirectory() ? walk : (p: string) => files.push(p))(path.join(d, f.name));
    };
    walk(relayDir!);
    for (const f of files) {
      const b = fs.readFileSync(f);
      for (const n of needles) expect(b.includes(n), `${n} in ${f}`).toBe(false);
    }
  });
});
