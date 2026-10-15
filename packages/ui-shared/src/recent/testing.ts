// A fake app core + backend for session tests (also used by app tests).

import type { Backend, Response } from "../backend";
import { MemoryDocStorage, type DocStorage } from "./storage";

type Req = { type: string; [k: string]: unknown };

/** A minimal core: a text value with revision, dirty flag and name. */
export class FakeCore {
  revision = 0;
  dirty = false;
  name: string | null = null;
  text = "";
  readonly requests: string[] = [];

  handle(req: Req): Response {
    this.requests.push(req.type);
    const env = () => ({ revision: this.revision, patch: {}, canUndo: false, canRedo: false, dirty: this.dirty });
    switch (req.type) {
      case "apply":
        this.text += String(req.text ?? "x");
        this.revision++;
        this.dirty = true;
        return { ok: { type: "patch", envelope: env() } };
      case "newDocument":
        this.text = "";
        this.revision++;
        this.dirty = false;
        this.name = null;
        return { ok: { type: "document", envelope: env() } };
      case "openXlsx":
        this.text = String(req.bytesBase64);
        this.revision++;
        this.dirty = false;
        this.name = String(req.name);
        return { ok: { type: "opened", warnings: [], envelope: env() } };
      case "saveXlsx":
        return { ok: { type: "saved", bytesBase64: "UEs=", suggestedName: this.name ?? "Untitled.xlsx" } };
      case "markSaved":
        this.dirty = false;
        if (typeof req.name === "string") this.name = req.name;
        return { ok: { type: "documentState", dirty: false, revision: this.revision, name: this.name } };
      case "recoverySnapshot":
        return { ok: { type: "recoverySnapshot", json: JSON.stringify({ text: this.text }), revision: this.revision, dirty: this.dirty, name: this.name } };
      case "restoreRecovery": {
        let text: unknown;
        try {
          text = (JSON.parse(String(req.json)) as { text?: unknown }).text;
        } catch {
          text = undefined;
        }
        if (typeof text !== "string") return { err: { code: "invalid_snapshot", message: "bad" } };
        this.text = text;
        this.revision++;
        this.dirty = true;
        this.name = typeof req.name === "string" ? req.name : null;
        return { ok: { type: "document", envelope: env() } };
      }
      default:
        return { err: { code: "bad_request", message: req.type } };
    }
  }
}

/** A backend over a `FakeCore` with the given storage. */
export function fakeBackend(core = new FakeCore(), storage: DocStorage | null = new MemoryDocStorage()): Backend & { core: FakeCore } {
  return {
    kind: "wasm",
    core,
    ...(storage ? { storage } : {}),
    ping: async () => "Rusuite Fake 0.1.0",
    dispatch: async <T,>(request: unknown) => core.handle(request as Req) as Response<T>,
    openFile: async () => ({ name: "picked.xlsx", bytesBase64: "picked" }),
    saveFile: async () => true,
    setTitle: async () => {},
  };
}
