// The assistant panel and File › Options… › AI against a scripted provider.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Assistant, type AiAction } from "../controller";
import type { AiAppAdapter } from "../adapter";
import { MemoryAiStore } from "../settings";
import type { AiProvider, Delta } from "../types";
import { AssistantPane } from "./AssistantPane";
import { SettingsDialog } from "../../settings/SettingsDialog";

afterEach(cleanup);

function setup(opts: { enabled?: boolean; key?: string; selection?: boolean; answer?: Delta[] } = {}) {
  const store = new MemoryAiStore();
  if (opts.key) store.keys.set("anthropic", opts.key);
  store.settings = { ...store.settings, enabled: opts.enabled ?? false };
  const requests: unknown[] = [];
  const tested: string[] = [];
  const provider: AiProvider = {
    kind: "anthropic",
    name: "Anthropic",
    origin: "https://api.anthropic.com",
    models: () => [{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }, { id: "claude-opus-5-5", name: "Claude Opus 5.5" }],
    test: async () => [{ id: "a", name: "a" }, { id: "b", name: "b" }],
    async *complete(req) {
      requests.push(req);
      yield* opts.answer ?? [{ type: "text", text: "Fixed text." }, { type: "usage", inputTokens: 7, outputTokens: 3 }, { type: "stop", reason: "end_turn" }];
    },
  };
  const ai = new Assistant({ store, provider: (_k, key) => (tested.push(key), provider) });
  const applied: string[] = [];
  const fix: AiAction<string> = { id: "fix", label: "Fix grammar", needsSelection: true, task: () => "Fix", apply: [{ label: "Replace selection", run: async (v) => (applied.push(v), "Replaced.") }] };
  const adapter: AiAppAdapter = {
    app: "write",
    actions: () => [fix],
    context: async (doc) => ({ app: "write", title: "T", description: "d", selectionLabel: "sel", selection: "teh", ...(doc ? { document: "whole" } : {}) }),
    selectionLabel: () => (opts.selection === false ? "nothing selected" : "selection, 3 characters"),
    hasSelection: () => opts.selection !== false,
    documentSize: () => 60_000,
    subscribe: () => () => undefined,
    textApply: [],
  };
  render(
    <>
      <AssistantPane ai={ai} adapter={adapter} />
      <SettingsDialog ai={ai} />
    </>,
  );
  return { ai, store, requests, applied, tested };
}

describe("AssistantPane", () => {
  it("Ctrl+Shift+A toggles it; off by default, with a way to the settings", async () => {
    const { ai } = setup();
    expect(screen.queryByTestId("ai-pane")).toBeNull();
    fireEvent.keyDown(window, { key: "A", code: "KeyA", ctrlKey: true, shiftKey: true });
    expect(await screen.findByTestId("ai-off")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "AI settings…" }));
    expect(ai.getState().settingsOpen).toBe(true);
    fireEvent.keyDown(window, { key: "A", code: "KeyA", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.queryByTestId("ai-pane")).toBeNull());
  });

  it("runs an action, shows the answer and usage, applies it", async () => {
    const { ai, requests, applied } = setup({ enabled: true, key: "sk" });
    act(() => ai.openPanel());
    const chip = await screen.findByRole("button", { name: "Fix grammar" });
    await waitFor(() => expect((chip as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(chip);
    expect(await screen.findByText("Fixed text.")).toBeTruthy();
    expect(requests).toHaveLength(1);
    expect(screen.getByTestId("ai-usage").textContent).toContain("7 input · 3 output");
    fireEvent.click(screen.getByRole("button", { name: "Replace selection" }));
    expect(await screen.findByText("Replaced.")).toBeTruthy();
    expect(applied).toEqual(["Fixed text."]);
  });

  it("actions needing a selection are disabled without one; the whole-document toggle warns about size", async () => {
    const { ai } = setup({ enabled: true, key: "sk", selection: false });
    act(() => ai.openPanel());
    const chip = await screen.findByRole("button", { name: "Fix grammar" });
    expect((chip as HTMLButtonElement).disabled).toBe(true);
    expect(chip.getAttribute("title")).toBe("Select something first");
    fireEvent.click(screen.getByTestId("ai-include-document"));
    expect((await screen.findByTestId("ai-doc-warning")).textContent).toMatch(/^Large document: about 60,000 characters/);
  });
});

describe("AssistantPane round 2 (P9-A1)", () => {
  it("the reasoning summary is a collapsed expander apart from the answer; cache and effort in the usage line", async () => {
    const { ai, applied } = setup({
      enabled: true,
      key: "sk",
      answer: [
        { type: "model", model: "claude-sonnet-5-5" },
        { type: "thinking", text: "Checking the spelling." },
        { type: "text", text: "Fixed text." },
        { type: "usage", inputTokens: 2100, outputTokens: 3, cacheReadTokens: 2048, cacheWriteTokens: 0 },
        { type: "stop", reason: "end_turn" },
      ],
    });
    act(() => ai.openPanel());
    const chip = await screen.findByRole("button", { name: "Fix grammar" });
    await waitFor(() => expect((chip as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(chip);
    const details = (await screen.findByTestId("ai-thinking")) as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")!.textContent).toBe("Thinking…");
    expect(screen.getByTestId("ai-thinking-text").textContent).toBe("Checking the spelling.");
    expect(screen.getByTestId("ai-answer").textContent).toBe("Fixed text.");
    expect(screen.getByTestId("ai-turn-cache").textContent).toBe(" · 2,048 from cache · 0 written to cache");
    expect(screen.getByTestId("ai-turn-effort").textContent).toBe(" · reasoning: Low");
    expect(screen.getByTestId("ai-usage").textContent).toContain("(2,048 from cache)");
    fireEvent.click(screen.getByRole("button", { name: "Replace selection" }));
    await waitFor(() => expect(applied).toEqual(["Fixed text."]));
  });

  it("pending pictures are listed with a remove button", async () => {
    const { ai } = setup({ enabled: true, key: "sk" });
    act(() => ai.openPanel());
    act(() => ai.attach({ mediaType: "image/png", data: "iVBORw0KGgo=", width: 640, height: 480, label: "Slide 2" }));
    const list = await screen.findByTestId("ai-pending-pictures");
    expect(list.textContent).toContain("Slide 2");
    expect(list.textContent).toContain("640×480");
    fireEvent.click(screen.getByRole("button", { name: "Remove Slide 2" }));
    await waitFor(() => expect(screen.queryByTestId("ai-pending-pictures")).toBeNull());
  });
});

describe("Settings › AI", () => {
  it("enable, key (masked), Test with the typed key, Save; Forget key", async () => {
    const { ai, store, tested } = setup();
    act(() => ai.openSettings());
    const dlg = await screen.findByTestId("ai-settings");
    expect(dlg).toBeTruthy();
    fireEvent.click(screen.getByTestId("ai-enabled"));
    const key = screen.getByLabelText("API key") as HTMLInputElement;
    expect(key.type).toBe("password");
    fireEvent.change(key, { target: { value: "sk-new" } });
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect((await screen.findByTestId("ai-test-result")).textContent).toBe("Connected. The provider lists 2 models. claude-sonnet-5-5 answered.");
    expect(tested).toContain("sk-new");
    expect(store.keys.size).toBe(0); // not saved before Save
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(store.keys.get("anthropic")).toBe("sk-new"));
    expect(store.settings.enabled).toBe(true);
    expect(JSON.stringify(store.settings)).not.toContain("sk-new");
    act(() => ai.openSettings());
    fireEvent.click(await screen.findByRole("button", { name: "Forget key" }));
    await waitFor(() => expect(store.keys.size).toBe(0));
  });
});

describe("unavailable assistant (web build)", () => {
  it("has no ribbon group content, panel, shortcut or status; Options shows the desktop note", async () => {
    const { aiRibbonGroup } = await import("./ribbon");
    const { AiStatus } = await import("./AiStatus");
    const ai = new Assistant({ store: new MemoryAiStore(), available: false });
    expect(aiRibbonGroup(ai).items).toBeNull();
    expect(aiRibbonGroup(null).items).toBeNull();
    const adapter = { app: "write", actions: () => [], textApply: [], subscribe: () => () => undefined } as unknown as AiAppAdapter;
    ai.saveSettings({ ...ai.getState().settings, enabled: true });
    render(<><AssistantPane ai={ai} adapter={adapter} /><AiStatus ai={ai} /><SettingsDialog ai={ai} /></>);
    fireEvent.keyDown(window, { key: "a", code: "KeyA", ctrlKey: true, shiftKey: true });
    expect(ai.getState().panelOpen).toBe(false);
    expect(screen.queryByTestId("ai-status")).toBeNull();
    act(() => ai.openSettings());
    expect(screen.getByTestId("ai-desktop-only").textContent).toContain("available in the desktop apps");
    expect(screen.getByTestId("ai-desktop-downloads").getAttribute("href")).toMatch(/^https:\/\/github\.com\//);
    expect(screen.queryByLabelText(/API key/i)).toBeNull();
  });
});
