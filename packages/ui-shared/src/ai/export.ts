// Conversation export (P9-A2): the turns of the panel as a Markdown document (prompt, answer, model / reasoning /
// tokens, placeholders for attached pictures), saved as a file or copied. An export is not the document: it never
// touches the document's file binding (no `Backend.saveFile`: that one would write over a document's file or
// connection).

import { t } from "../i18n/locale";
import type { AiTurn } from "./controller";

export interface ExportOptions {
  /** "Rusuite Write". */
  app?: string;
  /** The provider's display name. */
  provider?: string;
  /** The time of the export (tests pass a fixed one). */
  now?: Date;
}

const two = (n: number) => String(n).padStart(2, "0");

/** `2026-10-18`. */
export const isoDay = (d: Date): string => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

/** `ai-conversation-2026-10-18.md`. */
export const exportFileName = (now = new Date()): string => `ai-conversation-${isoDay(now)}.md`;

/** A fenced block that survives backticks in `body`. */
function fence(body: string): string {
  const longest = Math.max(2, ...(body.match(/`+/g) ?? []).map((r) => r.length));
  const f = "`".repeat(longest + 1);
  return `${f}\n${body}\n${f}`;
}

/** The text of a finished turn: the answer, or the structured result as JSON. */
function answerOf(turn: AiTurn): string {
  if (turn.text.trim()) return turn.text.trim();
  if (turn.value !== undefined && typeof turn.value !== "string") return fence(JSON.stringify(turn.value, null, 2));
  return "";
}

function turnMarkdown(turn: AiTurn, index: number): string {
  const lines: string[] = [`## ${index + 1}. ${turn.prompt.replace(/\s*\n\s*/g, " ")}`, ""];
  lines.push(`*${turn.contextLabel}*`, "");
  const meta: string[] = [];
  if (turn.model) meta.push(t("ai.export.model", { model: turn.model }));
  if (turn.effort) meta.push(t("ai.export.reasoning", { level: t(`ai.effort.${turn.effort}`) }));
  const u = turn.usage;
  if (u.input > 0 || u.output > 0) {
    let tokens = t("ai.export.tokens", { input: u.input, output: u.output });
    if (u.cacheRead > 0 || u.cacheWrite > 0) tokens += ` (${t("ai.export.cache", { read: u.cacheRead, write: u.cacheWrite })})`;
    meta.push(tokens);
  }
  if (meta.length) lines.push(meta.join(" · "), "");
  for (const label of turn.images ?? []) lines.push(`> ${t("ai.export.picture", { name: label })}`, "");
  lines.push(`**${t("ai.export.you")}**`, "", ...turn.prompt.split("\n").map((l) => `> ${l}`), "");
  const answer = answerOf(turn);
  if (answer) lines.push(`**${t("ai.export.assistant")}**`, "", answer, "");
  if (turn.status === "stopped") lines.push(`*${t("ai.pane.stopped")}*`, "");
  if (turn.error) lines.push(`**${t("ai.export.error")}** ${turn.error}${turn.errorDetail ? ` (${turn.errorDetail})` : ""}`, "");
  if (turn.applied) lines.push(`*${turn.applied}*`, "");
  return lines.join("\n");
}

/** The conversation as Markdown (empty turns list: just the header). */
export function conversationMarkdown(turns: readonly AiTurn[], options: ExportOptions = {}): string {
  const now = options.now ?? new Date();
  const head = [`# ${t("ai.export.title", { app: options.app ?? "Rusuite" })}`, ""];
  const meta = [t("ai.export.date", { date: isoDay(now) })];
  if (options.provider) meta.push(t("ai.export.provider", { provider: options.provider }));
  meta.push(t("ai.export.turns", { count: turns.length }));
  head.push(meta.join(" · "), "");
  return `${head.join("\n")}\n${turns.map(turnMarkdown).join("\n")}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Saves a text file: the desktop shell's save dialog where it has one (`export_file`), else a browser download. */
export async function saveTextFile(name: string, text: string, mime = "text/markdown"): Promise<boolean> {
  const bytes = new TextEncoder().encode(text);
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      const written = await invoke<string | null>("export_file", { suggestedName: name, bytesBase64: btoa(bin), filterName: "Markdown", extension: "md" });
      return written !== null;
    } catch {
      // a shell without `export_file`: the webview's download below
    }
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
