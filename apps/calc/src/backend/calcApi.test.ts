import { describe, expect, it } from "vitest";
import type { Backend } from "@rusuite/ui-shared";
import { CalcApi, CalcApiError, parseResponse } from "./calcApi";

const fileStubs = { openFile: async () => null, saveFile: async () => false, setTitle: async () => {} };

function backendReturning(reply: unknown | (() => unknown)): Backend & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    kind: "wasm",
    sent,
    ping: async () => "",
    ...fileStubs,
    dispatch: async <T,>(req: unknown) => {
      sent.push(req);
      return (typeof reply === "function" ? (reply as () => unknown)() : reply) as T;
    },
  };
}

const envelope = { revision: 3, patch: { sheets: null, cells: [], cols: [], rows: [], styles: null, cycle: null, structural: [] }, canUndo: true, canRedo: false, dirty: true };

describe("calcApi", () => {
  it("sends typed requests and unwraps the body", async () => {
    const b = backendReturning({ ok: { type: "patch", envelope } });
    const api = new CalcApi(b);
    const env = await api.apply({ type: "setInput", sheet: 0, row: 1, col: 2, input: "x" });
    expect(env.revision).toBe(3);
    expect(b.sent[0]).toEqual({ type: "apply", command: { type: "setInput", sheet: 0, row: 1, col: 2, input: "x" } });
    await api.undo();
    expect(b.sent[1]).toEqual({ type: "undo" });
  });

  it("maps an err reply to CalcApiError with the backend code", async () => {
    const api = new CalcApi(backendReturning({ err: { code: "unknown_sheet", message: "sheet 9" } }));
    const e = await api.snapshot(9, 0, 0, 1, 1).catch((x) => x);
    expect(e).toBeInstanceOf(CalcApiError);
    expect(e.code).toBe("unknown_sheet");
    expect(e.message).toBe("sheet 9");
  });

  it("rejects replies that do not match the Response union", () => {
    const bad = (raw: unknown, type: "patch" | "info" = "patch") => {
      try {
        parseResponse(raw, type);
      } catch (e) {
        return (e as CalcApiError).code;
      }
      return "ok";
    };
    expect(bad(null)).toBe("bad_response");
    expect(bad({ ok: { type: "info", info: {} } })).toBe("bad_response"); // wrong kind
    expect(bad({ ok: { type: "patch" } })).toBe("bad_response"); // no envelope
    expect(bad({ ok: { type: "patch", envelope: { patch: {} } } })).toBe("bad_response"); // no revision
    expect(bad({ err: { code: 1 } })).toBe("bad_response");
    expect(bad({ ok: {}, err: {} })).toBe("bad_response");
    expect(bad({ ok: { type: "patch", envelope } })).toBe("ok");
    const b = (raw: unknown, type: "opened" | "saved" | "documentState") => {
      try {
        parseResponse(raw, type);
      } catch (e) {
        return (e as CalcApiError).code;
      }
      return "ok";
    };
    expect(b({ ok: { type: "opened", info: {}, warnings: [], envelope } }, "opened")).toBe("ok");
    expect(b({ ok: { type: "opened", info: {}, envelope } }, "opened")).toBe("bad_response");
    expect(b({ ok: { type: "saved", bytesBase64: "", suggestedName: "a.xlsx" } }, "saved")).toBe("ok");
    expect(b({ ok: { type: "saved", bytesBase64: 1 } }, "saved")).toBe("bad_response");
    expect(b({ ok: { type: "documentState", dirty: false, revision: 2, name: null } }, "documentState")).toBe("ok");
  });

  it("maps a throwing transport to code 'transport'", async () => {
    const api = new CalcApi(backendReturning(() => {
      throw new Error("ipc down");
    }));
    const e = await api.info().catch((x) => x);
    expect(e).toBeInstanceOf(CalcApiError);
    expect(e.code).toBe("transport");
    expect(e.message).toBe("ipc down");
  });
});
