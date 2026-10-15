import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: { request: string }) =>
    cmd === "ping" ? "tauri-pong" : JSON.stringify({ ok: { echo: args?.request } }),
  ),
}));

import {
  TauriBackend,
  WasmBackend,
  createBackend,
  isTauri,
  type WasmModule,
} from "./backend";
import { invoke } from "@tauri-apps/api/core";

const fake: WasmModule = {
  ping: () => "wasm-pong",
  dispatch: (json) => JSON.stringify({ ok: { got: JSON.parse(json) } }),
};

afterEach(() => vi.unstubAllGlobals());

describe("isTauri", () => {
  it("is false without window", () => {
    expect(isTauri()).toBe(false);
  });
  it("detects __TAURI_INTERNALS__", () => {
    vi.stubGlobal("window", {});
    expect(isTauri()).toBe(false);
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    expect(isTauri()).toBe(true);
  });
});

describe("WasmBackend", () => {
  it("pings and roundtrips JSON", async () => {
    const b = new WasmBackend(fake);
    expect(b.kind).toBe("wasm");
    expect(await b.ping()).toBe("wasm-pong");
    expect(await b.dispatch({ type: "ping" })).toEqual({
      ok: { got: { type: "ping" } },
    });
  });
});

describe("TauriBackend", () => {
  it("invokes ping and dispatch", async () => {
    const b = new TauriBackend();
    expect(b.kind).toBe("tauri");
    expect(await b.ping()).toBe("tauri-pong");
    const r = await b.dispatch<{ ok: { echo: string } }>({ type: "ping" });
    expect(r.ok.echo).toBe('{"type":"ping"}');
    expect(invoke).toHaveBeenCalledWith("dispatch", { request: '{"type":"ping"}' });
  });
});

describe("createBackend", () => {
  it("uses wasm outside Tauri", async () => {
    const load = vi.fn(async () => fake);
    expect((await createBackend(load)).kind).toBe("wasm");
    expect(load).toHaveBeenCalled();
  });
  it("uses tauri inside Tauri without loading wasm", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const load = vi.fn(async () => fake);
    expect((await createBackend(load)).kind).toBe("tauri");
    expect(load).not.toHaveBeenCalled();
  });
});
