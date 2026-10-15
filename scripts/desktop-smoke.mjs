// Real-window smoke test of the three desktop shells (P7-7), run by
// scripts/desktop-smoke.sh under xvfb with `tauri-driver` (WebKitWebDriver).
// Plain W3C WebDriver over fetch, no dependencies.
//
// Per app (release binary):
//  1. close guard: edit → the window title gets the dirty marker → a close
//     request (`Window.close()`, which raises CloseRequested exactly like
//     the window manager's close button) → the "Save changes to …?" dialog
//     → "Don't save" → the process exits.
//  2. Save to the remembered file: the app data dir is seeded with a recent
//     entry for a copy of a testdata file; File › recent entry opens it by
//     path, an edit, then Ctrl+S must rewrite that file without any dialog
//     (a GTK save dialog would block and time out), the title shows the file
//     name, and closing the now clean window needs no question.
// GTK's native file dialogs cannot be driven through WebDriver, so Save As
// itself is covered by the unit tests (shell `DocPath`, the stores' flows).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN_DIR = process.env.SMOKE_BIN_DIR ?? path.join(ROOT, "target/release");
const WORK = process.env.SMOKE_WORK;
const DATA = process.env.XDG_DATA_HOME;
const BASE = `http://127.0.0.1:${process.env.SMOKE_PORT ?? 4444}`;
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
const CTRL = "";
const ENTER = "";
if (!WORK || !DATA) throw new Error("run through scripts/desktop-smoke.sh");

const APPS = [
  {
    app: "calc",
    id: "dev.rusuite.calc",
    fixture: "xlsx/provisional-basic.xlsx",
    ready: '[data-testid="grid"]',
    // Typing on the grid starts the cell editor; Enter commits.
    edit: async (s) => {
      const grid = await s.find('[data-testid="grid"]');
      await s.click(grid);
      await s.keys(["7", ENTER]);
    },
  },
  {
    app: "write",
    id: "dev.rusuite.write",
    fixture: "docx/provisional-01-heading-1.docx",
    ready: '[data-testid="editor"]',
    // WebKitWebDriver's key events reach keydown handlers but insert no
    // text (no beforeinput); Enter is a ProseMirror keymap command.
    edit: async (s) => {
      const editor = await s.find('[data-testid="editor"]');
      await s.click(editor);
      await s.keys([ENTER]);
    },
  },
  {
    app: "show",
    id: "dev.rusuite.show",
    fixture: "pptx/provisional-25-pitch-deck.pptx",
    ready: '[data-testid="editor-stage"]',
    edit: async (s) => s.click(await s.find('button[aria-label="New slide"]')),
  },
];

// --- WebDriver ---------------------------------------------------------------

async function wd(method, url, body) {
  const r = await fetch(BASE + url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(json.value ?? json).slice(0, 300)}`);
  return json.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEBUG = process.env.SMOKE_DEBUG === "1";
const T0 = Date.now();

async function until(what, fn, timeoutMs = 20_000) {
  if (DEBUG) console.log(`  [${Date.now() - T0} ms] waiting for ${what}`);
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}${last ? ` (${last.message})` : ""}`);
}

class Session {
  static async start(binary) {
    const s = await wd("POST", "/session", { capabilities: { alwaysMatch: { "tauri:options": { application: binary } } } });
    return new Session(s.sessionId);
  }

  constructor(id) {
    this.id = id;
  }

  cmd(method, url, body) {
    return wd(method, `/session/${this.id}${url}`, body);
  }

  async find(css) {
    return (await this.cmd("POST", "/element", { using: "css selector", value: css }))[ELEMENT];
  }

  async findXPath(xpath) {
    return (await this.cmd("POST", "/element", { using: "xpath", value: xpath }))[ELEMENT];
  }

  click(el) {
    return this.cmd("POST", `/element/${el}/click`, {});
  }

  /** Types `keys` (single characters / WebDriver key codes) into the focused element. */
  keys(keys) {
    const actions = keys.flatMap((k) => [
      { type: "keyDown", value: k },
      { type: "keyUp", value: k },
    ]);
    return this.cmd("POST", "/actions", { actions: [{ type: "key", id: "kbd", actions }] });
  }

  /** Presses Ctrl+`key`. */
  ctrl(key) {
    const actions = [
      { type: "keyDown", value: CTRL },
      { type: "keyDown", value: key },
      { type: "keyUp", value: key },
      { type: "keyUp", value: CTRL },
    ];
    return this.cmd("POST", "/actions", { actions: [{ type: "key", id: "kbd", actions }] });
  }

  /** Runs a Tauri IPC command from the page (window plugin: title, close). */
  ipc(cmd, args) {
    return this.cmd("POST", "/execute/async", {
      script: "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then((v) => done({ ok: v ?? null }), (e) => done({ err: String(e) }));",
      args: [cmd, args],
    }).then((r) => {
      if (r && "err" in r) throw new Error(`${cmd}: ${r.err}`);
      return r?.ok;
    });
  }

  /** The native window title (the apps put "•" there while dirty). */
  windowTitle() {
    return this.ipc("plugin:window|title", { label: "main" });
  }

  /**
   * A close request as from the window manager (CloseRequested; the shell
   * holds it while the document is dirty). When the window really closes,
   * the page goes away before the script can answer.
   */
  async requestClose() {
    try {
      await this.ipc("plugin:window|close", { label: "main" });
    } catch (e) {
      if (!/terminated|no such window/i.test(e.message)) throw e;
    }
  }

  async end() {
    await this.cmd("DELETE", "").catch(() => undefined);
  }
}

// --- helpers -----------------------------------------------------------------

function running(binary) {
  try {
    execFileSync("pgrep", ["-f", `^${binary}`], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const sha = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Fresh app data dir, optionally with one recent entry. */
function resetData(app, recentPath) {
  const dir = path.join(DATA, app.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (recentPath) {
    const entry = { name: path.basename(recentPath), path: recentPath, blobId: null, openedAt: Date.now() };
    fs.writeFileSync(path.join(dir, "recent.json"), JSON.stringify([entry]));
  }
}

async function launch(app) {
  const binary = path.join(BIN_DIR, `app-${app.app}`);
  const s = await Session.start(binary);
  await until(`${app.app} UI`, () => s.find(app.ready));
  return { s, binary };
}

async function waitExit(binary, s) {
  await until("the window to close and the process to exit", async () => !running(binary), 15_000);
  await s.end();
}

// --- tests -------------------------------------------------------------------

async function closeGuard(app) {
  resetData(app);
  const { s, binary } = await launch(app);
  try {
    await app.edit(s);
    await until("the dirty marker in the window title", async () => (await s.windowTitle()).includes("•"));
    await s.requestClose();
    const dialog = await until("the unsaved-changes dialog", () => s.find('[data-testid="confirm-discard"]'));
    if (!dialog) throw new Error("no dialog");
    if (!running(binary)) throw new Error("the window closed without asking");
    await s.click(await s.findXPath(`//button[normalize-space(.)="Don't save"]`));
    await waitExit(binary, s);
  } catch (e) {
    await s.end();
    throw e;
  }
}

async function saveToRememberedFile(app) {
  const file = path.join(WORK, "docs", `smoke-${app.app}${path.extname(app.fixture)}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "testdata", app.fixture), file);
  const before = sha(file);
  resetData(app, file);
  const { s, binary } = await launch(app);
  try {
    await s.click(await s.findXPath('//*[@role="tab" and normalize-space(.)="File"]'));
    await s.click(await until("the recent entry", () => s.find('[data-testid="recent-entry"]')));
    const name = path.basename(file);
    await until(`the title "${name}"`, async () => (await s.windowTitle()).includes(name));
    await app.edit(s);
    await until("the dirty marker", async () => (await s.windowTitle()).includes("•"));
    await s.ctrl("s");
    await until("the file to be rewritten (no dialog)", async () => sha(file) !== before);
    const title = await until("a clean title", async () => {
      const t = await s.windowTitle();
      return !t.includes("•") && t;
    });
    if (!title.includes(name)) throw new Error(`title "${title}" lacks ${name}`);
    if (fs.readFileSync(file).subarray(0, 2).toString() !== "PK") throw new Error("the saved file is not a zip");
    await s.requestClose();
    await waitExit(binary, s);
  } catch (e) {
    await s.end();
    throw e;
  }
}

// --- main --------------------------------------------------------------------

await until("tauri-driver", () => wd("GET", "/status").then(() => true), 15_000);
const only = process.argv.slice(2);
let failed = 0;
for (const app of APPS.filter((a) => only.length === 0 || only.includes(a.app))) {
  for (const [label, test] of [
    ["close guard: dirty → close → Don't save → closed", closeGuard],
    ["Save writes the remembered file without a dialog", saveToRememberedFile],
  ]) {
    const t0 = Date.now();
    try {
      await test(app);
      console.log(`ok   ${app.app}: ${label} (${Date.now() - t0} ms)`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${app.app}: ${label}: ${e.message}`);
      try {
        execFileSync("pkill", ["-f", `^${path.join(BIN_DIR, `app-${app.app}`)}`], { stdio: "ignore" });
      } catch {
        // nothing left running
      }
    }
  }
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
