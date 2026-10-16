// What an app gives the assistant panel: its actions, the context of a request, the selection summary and the
// buttons under free-form answers (Insert / Replace selection).

import type { AiAction, AiApply } from "./controller";
import type { AiApp, DocContext } from "./prompts";
import { PLAIN_TEXT_RULE } from "./prompts";

export interface AiAppAdapter {
  app: AiApp;
  /** The action chips (re-read on every render: labels follow the UI language). */
  actions(): AiAction<any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** The context for a request; `includeDocument`: with the whole document. */
  context(includeDocument: boolean): Promise<DocContext>;
  /** "Selection, 120 characters", "Sheet1!B2:D9", "Slide 3" – a primitive, re-read after `subscribe` events. */
  selectionLabel(): string;
  hasSelection(): boolean;
  /** Characters of the whole document (the size warning). */
  documentSize(): number;
  subscribe(fn: () => void): () => void;
  /** What a result refers to (e.g. Write's selection range), captured when the request starts. */
  anchor?(): unknown;
  /** Buttons under free-form answers (Copy is always there). */
  textApply: AiApply<string>[];
}

/** The free-form prompt ("Ask the assistant"): a text answer with the app's Insert / Replace buttons. */
export function askAction(label: string, apply: AiApply<string>[]): AiAction<string> {
  return {
    id: "ask",
    label,
    task: (input) => input,
    system:
      "Answer the user's request about their document. If the answer is text meant for the document, write it as plain text without Markdown. " +
      PLAIN_TEXT_RULE.replace("it is inserted", "it may be inserted"),
    apply,
  };
}
