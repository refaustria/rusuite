// AI assistant polish (P9-A2): per-action model overrides, conversation export, reasoning_effort for
// OpenAI-compatible models, translated badResponse errors.
import { afterEach, describe, expect, it } from "vitest";
import { Assistant, errorParts, errorText, translateBadResponse, type AiAction, type AiTurn } from "./controller";
import { conversationMarkdown, exportFileName, isoDay } from "./export";
import { modelTakesEffort, resolveAction } from "./overrides";
import { openAiBody, openAiReasoningEffort } from "./providers/openai";
import { DEFAULT_AI_SETTINGS, MemoryAiStore, parseAiSettings } from "./settings";
import { setLocale } from "../i18n/locale";
import { AiError } from "./types";
import { ask, ctx, enabled, req } from "./round2.test";

afterEach(() => setLocale("en", { persist: false }));

const settings = (over: Partial<typeof DEFAULT_AI_SETTINGS> = {}) => parseAiSettings({ ...DEFAULT_AI_SETTINGS, ...over });
const done = [{ type: "text", text: "Hello." }, { type: "usage", inputTokens: 5, outputTokens: 2 }, { type: "stop", reason: "end_turn" }] as const;

describe("per-action model override", () => {
  it("resolves to the general model and effort without an override", () => {
    const r = resolveAction(settings(), "fix");
    expect(r).toMatchObject({ model: "claude-sonnet-5-5", pinned: false, setting: "low", effort: "low" });
  });

  it("an override pins the model and / or the reasoning of that action only", () => {
    const s = settings({ actionOverrides: { anthropic: { fix: { model: "claude-haiku-5-5", effort: "off" }, draft: { model: "claude-opus-5-5" } }, openai: {} } });
    expect(resolveAction(s, "fix")).toMatchObject({ model: "claude-haiku-5-5", pinned: true, setting: "off" });
    expect(resolveAction(s, "draft")).toMatchObject({ model: "claude-opus-5-5", pinned: true, setting: "low" });
    expect(resolveAction(s, "rewrite").pinned).toBe(false);
  });

  it("the action's minimum effort still applies; Off stays off", () => {
    const s = settings({ actionOverrides: { anthropic: { formula: { effort: "low" } }, openai: {} } });
    expect(resolveAction(s, "formula", "medium").effort).toBe("medium");
    const off = settings({ actionOverrides: { anthropic: { formula: { effort: "off" } }, openai: {} } });
    expect(resolveAction(off, "formula", "medium").effort).toBe("off");
  });

  it("overrides are per provider", () => {
    const s = settings({ provider: "openai", actionOverrides: { anthropic: { fix: { model: "claude-haiku-5-5" } }, openai: {} } });
    expect(resolveAction(s, "fix").model).toBe("gpt-5-mini");
  });

  it("settings parsing drops broken overrides and persists good ones", () => {
    const p = parseAiSettings({ actionOverrides: { anthropic: { a: { model: " m ", effort: "high" }, b: { model: "", effort: "wild" }, c: 5 }, openai: "x" } });
    expect(p.actionOverrides).toEqual({ anthropic: { a: { model: "m", effort: "high" } }, openai: {} });
    const store = new MemoryAiStore();
    store.saveSettings(p);
    expect(store.loadSettings().actionOverrides.anthropic.a?.model).toBe("m");
  });

  it("a run sends the pinned model and records it on the turn", async () => {
    const { ai, requests } = await enabled([...done]);
    ai.saveSettings({ actionOverrides: { anthropic: { ask: { model: "claude-haiku-5-5" } }, openai: {} } });
    const turn = await ai.run(ask, "hi", ctx());
    expect(requests[0]!.model).toBe("claude-haiku-5-5");
    expect(turn.model).toBe("claude-haiku-5-5");
    expect(turn.modelPinned).toBe(true);
    const other: AiAction<string> = { ...ask, id: "other" };
    const t2 = await ai.run(other, "hi", ctx());
    expect(requests[1]!.model).toBe("claude-sonnet-5-5");
    expect(t2.modelPinned).toBeUndefined();
  });
});

describe("reasoning_effort for OpenAI-compatible models", () => {
  it("maps the Reasoning setting", () => {
    expect(openAiReasoningEffort("high", true)).toBe("high");
    expect(openAiReasoningEffort("medium", false)).toBe("medium");
    expect(openAiReasoningEffort("off", true)).toBe("minimal");
    expect(openAiReasoningEffort("off", false)).toBe("none");
  });

  it("is in the body only when the request carries an effort", () => {
    expect(openAiBody(req({ model: "gpt-oss:20b" }), false)).not.toHaveProperty("reasoning_effort");
    expect(openAiBody(req({ model: "gpt-oss:20b", effort: "low" }), false)).toHaveProperty("reasoning_effort", "low");
    expect(openAiBody(req({ model: "gpt-5", effort: "off" }), true)).toHaveProperty("reasoning_effort", "minimal");
    expect(openAiBody(req({ effort: "low" }), false, new Set(["reasoning_effort"]))).not.toHaveProperty("reasoning_effort");
  });

  it("only models marked in the settings take an effort", () => {
    const s = settings({ provider: "openai", reasoningModels: ["gpt-oss:20b"] });
    expect(modelTakesEffort(s, "gpt-oss:20b")).toBe(true);
    expect(modelTakesEffort(s, "llama3.2")).toBe(false);
    expect(modelTakesEffort(settings(), "claude-sonnet-5-5")).toBe(true);
  });

  it("a run sends the effort for a marked model and none for others", async () => {
    const { ai, requests } = await enabled([...done], "openai");
    ai.saveSettings({ models: { anthropic: "x", openai: "gpt-oss:20b" }, reasoningModels: ["gpt-oss:20b"], effort: "high" });
    await ai.run(ask, "hi", ctx());
    expect(requests[0]!.effort).toBe("high");
    ai.saveSettings({ reasoningModels: [] });
    await ai.run(ask, "hi", ctx());
    expect(requests[1]!.effort).toBeUndefined();
  });
});

const turn = (over: Partial<AiTurn> = {}): AiTurn => ({
  id: 1,
  action: ask,
  prompt: "Fix grammar & spelling",
  contextLabel: "Selection, 11 characters",
  text: "Fixed.",
  status: "done",
  usage: { input: 120, output: 30, cacheRead: 100, cacheWrite: 0 },
  model: "claude-haiku-5-5",
  effort: "low",
  ...over,
});

describe("conversation export", () => {
  const now = new Date(2026, 9, 18, 12);

  it("names the file by day", () => {
    expect(isoDay(now)).toBe("2026-10-18");
    expect(exportFileName(now)).toBe("ai-conversation-2026-10-18.md");
  });

  it("writes the turns with model, reasoning and tokens", () => {
    const md = conversationMarkdown([turn(), turn({ id: 2, prompt: "Shorter", text: "Short." })], { app: "Rusuite Write", provider: "Anthropic", now });
    expect(md).toContain("# AI conversation – Rusuite Write");
    expect(md).toContain("Exported 2026-10-18 · Provider: Anthropic · 2 turns");
    expect(md).toContain("## 1. Fix grammar & spelling");
    expect(md).toContain("Model: claude-haiku-5-5 · Reasoning: Low · 120 in / 30 out tokens (cache: 100 read, 0 written)");
    expect(md).toContain("> Fix grammar & spelling");
    expect(md).toContain("**Assistant**\n\nFixed.");
    expect(md).toContain("## 2. Shorter");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("marks attached pictures with placeholders, never their data", () => {
    const md = conversationMarkdown([turn({ images: ["Picture 1", "Slide 3"] })], { now });
    expect(md).toContain("> [Picture sent: Picture 1]");
    expect(md).toContain("> [Picture sent: Slide 3]");
    expect(md).not.toContain("base64");
  });

  it("structured results become a JSON block; errors and stopped turns are noted", () => {
    const md = conversationMarkdown([turn({ text: "", value: { formula: "=A1+1" } }), turn({ id: 2, status: "error", text: "", error: "Server problem.", errorDetail: "overloaded" }), turn({ id: 3, status: "stopped" })], { now });
    expect(md).toContain('```\n{\n  "formula": "=A1+1"\n}\n```');
    expect(md).toContain("**Error:** Server problem. (overloaded)");
    expect(md).toContain("*Stopped.*");
  });

  it("an answer containing a code fence gets a longer fence", () => {
    const md = conversationMarkdown([turn({ text: "", value: { code: "```x```" } })], { now });
    expect(md).toContain("````\n");
  });

  it("is German in the German interface", () => {
    setLocale("de", { persist: false });
    const md = conversationMarkdown([turn()], { app: "Rusuite Write", now });
    expect(md).toContain("# KI-Unterhaltung – Rusuite Write");
    expect(md).toContain("**Du**");
    expect(md).toContain("**Assistent**");
  });
});

describe("badResponse translation", () => {
  it("translates the known provider and schema messages", () => {
    expect(translateBadResponse("The provider sent an unreadable stream")).toBe("The provider sent a response that could not be read.");
    expect(translateBadResponse("Anthropic sent no answer")).toBe("Anthropic sent no answer.");
    expect(translateBadResponse("The answer has 5000 cells; at most 2000 are applied")).toBe("The answer has 5000 cells; at most 2000 are applied.");
    expect(translateBadResponse("The model's answer is not a valid formula")).toBe("The answer did not have the expected form.");
    expect(translateBadResponse("The draft has 90 blocks; at most 60 are inserted")).toContain("90");
    expect(translateBadResponse("Something new")).toBeNull();
  });

  it("keeps the raw English text in the details, in German too", () => {
    setLocale("de", { persist: false });
    const p = errorParts(new AiError("badResponse", "The provider sent an unreadable stream"));
    expect(p.text).toBe("Die Antwort des Modells ist nicht verwendbar. Der Anbieter hat eine Antwort gesendet, die nicht gelesen werden konnte.");
    expect(p.detail).toBe("The provider sent an unreadable stream");
  });

  it("an unknown message shows only the head, the raw text in the details", () => {
    const p = errorParts(new AiError("badResponse", "Weird thing"));
    expect(p).toEqual({ text: "The model's answer could not be used.", detail: "Weird thing" });
  });

  it("other kinds put the provider's message in the details; errorText joins them", () => {
    const e = new AiError("rateLimit", "x", 429, 20, "slow down");
    expect(errorParts(e)).toEqual({ text: "The provider's rate limit was reached. Try again in 20 s.", detail: "slow down" });
    expect(errorText(e)).toBe("The provider's rate limit was reached. Try again in 20 s. (slow down)");
  });

  it("a failed turn carries the translated text and the details apart", async () => {
    const { ai } = await enabled(() => {
      throw new AiError("badResponse", "The provider sent an unreadable stream");
    });
    const t = await ai.run(ask, "hi", ctx());
    expect(t.error).toContain("could not be read");
    expect(t.errorDetail).toBe("The provider sent an unreadable stream");
    expect(Assistant).toBeTruthy();
  });
});
