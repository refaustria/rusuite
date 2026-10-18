// A comment text field with @mention suggestions (reply box, New Comment).

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";
import { insertMention, mentionCandidates, mentionQuery } from "./mentions";
import type { Person } from "../generated/Person";

type Field = HTMLInputElement | HTMLTextAreaElement;

/** The people a comment can mention: the document's person list plus the comment authors. */
export function mentionPeople(store: CalcStore): Person[] {
  const info = store.getState().info;
  const out: Person[] = [...(info?.persons ?? [])];
  const user = store.comments.currentUser();
  if (user && !out.some((p) => p.name === user.name)) out.push({ name: user.name });
  return out;
}

/**
 * Wraps a text field: `render(props)` draws the field with the given value
 * handlers; a suggestion list opens under it while `@name` is typed
 * (↑/↓, Enter or Tab picks, Esc closes).
 */
export function MentionField({
  store, value, onChange, onKeyDown, render,
}: {
  store: CalcStore;
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: KeyboardEvent<Field>) => void;
  render: (props: {
    value: string;
    onChange: (e: { target: { value: string; selectionEnd: number | null } }) => void;
    onKeyDown: (e: KeyboardEvent<Field>) => void;
    onSelect: (e: { currentTarget: Field }) => void;
    ref: (el: Field | null) => void;
    "aria-autocomplete": "list";
  }) => ReactNode;
}) {
  const t = useT();
  useCalc(store, (s) => s.info);
  const field = useRef<Field | null>(null);
  const [caret, setCaret] = useState(value.length);
  const [index, setIndex] = useState(0);
  const [closed, setClosed] = useState(false);
  const q = closed ? null : mentionQuery(value, caret);
  const list = q ? mentionCandidates(mentionPeople(store), q.query) : [];
  const pick = (p: Person) => {
    if (!q) return;
    const next = insertMention(value, q.start, caret, p.name);
    onChange(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => field.current?.setSelectionRange(next.caret, next.caret));
  };
  return (
    <div className="relative min-w-0 flex-1">
      {render({
        value,
        "aria-autocomplete": "list",
        ref: (el) => {
          field.current = el;
        },
        onChange: (e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionEnd ?? e.target.value.length);
          setClosed(false);
          setIndex(0);
        },
        onSelect: (e) => setCaret(e.currentTarget.selectionEnd ?? value.length),
        onKeyDown: (e) => {
          if (list.length > 0) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              e.stopPropagation();
              setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              e.stopPropagation();
              pick(list[Math.min(index, list.length - 1)]!);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setClosed(true);
              return;
            }
          }
          onKeyDown?.(e);
        },
      })}
      {list.length > 0 && (
        <ul role="listbox" aria-label={t("calc.comments.mention")} className="absolute left-0 top-full z-30 mt-0.5 max-h-48 w-56 overflow-auto rounded border border-ui-border bg-ui-panel py-1 text-sm shadow-lg">
          {list.map((p, i) => (
            <li
              key={p.name}
              role="option"
              aria-selected={i === index}
              className={`cursor-pointer px-2 py-0.5 ${i === index ? "bg-ui-active" : "hover:bg-ui-hover"}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
            >
              {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
