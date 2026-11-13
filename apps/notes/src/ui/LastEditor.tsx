// The last editor of the block under the pointer (shared notebooks): a thin bar in the gutter in the editor's
// colour with the tooltip "Edited by Anna, 2 min ago".

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { getLocale } from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import { lastEditorOfBlock, relativeTime } from "../editor/lastEditor";
import type { PageMirror } from "../editor/mirror";
import { colorOf } from "../sync/manager";
import { useT } from "../i18n";

interface Hover {
  top: number;
  height: number;
  color: string;
  text: string;
}

export function LastEditorGutter({ ctl, editor, mirror, docId }: { ctl: NotesController; editor: Editor; mirror: PageMirror; docId: string }) {
  const t = useT();
  const [hover, setHover] = useState<Hover | null>(null);
  const [tip, setTip] = useState(false);
  const devices = useRef<Map<string, string | null>>(new Map());
  const loadedAt = useRef(0);

  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    // The editor and its gutter (the bar itself keeps the hover).
    const area = dom.closest(".notes-editor")?.parentElement ?? dom;
    let last: Element | null = null;
    const deviceOf = async (peer: string): Promise<string | null> => {
      if (!devices.current.has(peer) && Date.now() - loadedAt.current > 2000) {
        loadedAt.current = Date.now();
        try {
          for (const e of await ctl.history(docId)) devices.current.set(e.peer, e.deviceId);
        } catch {
          // history unavailable: names stay unknown
        }
      }
      return devices.current.get(peer) ?? null;
    };
    const onMove = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target?.closest("[data-testid=last-editor]")) return;
      let el: Element | null = target;
      while (el && el.parentElement !== dom) el = el.parentElement;
      if (!el || el === last) return;
      last = el;
      setTip(false);
      const index = Array.prototype.indexOf.call(dom.children, el);
      const info = index >= 0 ? lastEditorOfBlock(mirror.doc, index) : null;
      if (!info) {
        setHover(null);
        return;
      }
      const box = el as HTMLElement;
      void deviceOf(info.peer).then((device) => {
        if (last !== el) return;
        const mine = info.peer === mirror.doc.peerIdStr;
        const name = mine ? t("notes.share.you") : (ctl.nameOf(device) ?? t("notes.share.someone"));
        setHover({
          top: box.offsetTop,
          height: box.offsetHeight,
          color: colorOf(mine ? (ctl.getState().device ?? "") : (device ?? info.peer)),
          text: t("notes.lastEdit.by", { name, when: relativeTime(info.at, Date.now(), t, getLocale()) }),
        });
      });
    };
    const onLeave = () => {
      last = null;
      setHover(null);
    };
    area.addEventListener("mousemove", onMove);
    area.addEventListener("mouseleave", onLeave);
    return () => {
      area.removeEventListener("mousemove", onMove);
      area.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, mirror, ctl, docId, t]);

  if (!hover) return null;
  return (
    <div
      className="absolute -left-5 w-3 cursor-default"
      style={{ top: hover.top, height: hover.height }}
      data-testid="last-editor"
      aria-label={hover.text}
      title={hover.text}
      onMouseEnter={() => setTip(true)}
      onMouseLeave={() => setTip(false)}
    >
      <span className="absolute left-1 top-0 h-full w-1 rounded" style={{ background: hover.color, opacity: 0.55 }} aria-hidden="true" />
      {tip && (
        <span className="absolute bottom-full left-0 z-10 mb-1 whitespace-nowrap rounded bg-ui-fg px-1.5 py-0.5 text-[11px] text-ui-bg shadow" data-testid="last-editor-tip">
          {hover.text}
        </span>
      )}
    </div>
  );
}
