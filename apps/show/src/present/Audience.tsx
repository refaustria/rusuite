// The audience window of the presenter view (P7-8): `?audience=<id>` in the
// URL makes main.tsx render this instead of the editor (no backend, no
// document session). It shows what the presenter sends and forwards its own
// keys and clicks to the presenter, which owns the show; the presenter's
// ink, laser pointer and zoom are drawn here too (P9-S5).

import { useCallback, useEffect, useMemo, useState } from "react";
import { isTauri } from "@rusuite/ui-shared";
import type { DeckContext } from "../canvas/SlideView";
import type { Slide } from "../generated/Slide";
import { pathCache } from "../shapes/paths";
import { Presenter } from "./Presenter";
import type { ShowAction, ShowState } from "./showState";
import { openSync, type ShowView, type SyncChannel } from "./sync";
import { INITIAL_TOOLS, type ToolsState } from "./ShowTools";
import { useT } from "../i18n";

function closeWindow() {
  if (isTauri()) {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().close()).catch(() => window.close());
  } else window.close();
}

export interface AudienceProps {
  id: string;
  /** The channel to the presenter (tests pass a fake). */
  channel?: Promise<SyncChannel>;
  /** Called when the presenter ended the show (default: close the window). */
  onEnd?: () => void;
}

export function Audience({ id, channel, onEnd = closeWindow }: AudienceProps) {
  const t = useT();
  const [ch, setCh] = useState<SyncChannel | null>(null);
  const [deck, setDeck] = useState<{ deck: DeckContext; slides: Slide[]; media: Map<number, string>; version: number } | null>(null);
  const [view, setView] = useState<ShowView>({ slideIndex: 0, step: 0, blackout: "none", ended: false });
  const [tools, setTools] = useState<ToolsState>(INITIAL_TOOLS);

  useEffect(() => {
    let alive = true;
    let sync: SyncChannel | null = null;
    let unlisten = () => {};
    const bye = () => sync?.post({ kind: "bye" });
    void (channel ?? openSync(id, "audience")).then((c) => {
      if (!alive) return c.close();
      sync = c;
      unlisten = c.listen((m) => {
        if (m.kind === "deck" && m.paths) pathCache.load(m.paths);
        if (m.kind === "deck") setDeck((d) => ({ deck: m.deck, slides: m.slides, media: new Map(m.media), version: (d?.version ?? 0) + 1 }));
        else if (m.kind === "state") setView({ slideIndex: m.slideIndex, step: m.step ?? 0, blackout: m.blackout, ended: m.ended });
        else if (m.kind === "tools") setTools({ ...INITIAL_TOOLS, ...m.tools, ink: new Map(m.tools.ink) });
        else if (m.kind === "end") onEnd();
      });
      setCh(c);
      c.post({ kind: "hello" });
    });
    window.addEventListener("pagehide", bye);
    return () => {
      alive = false;
      window.removeEventListener("pagehide", bye);
      unlisten();
      sync?.close();
    };
  }, [id, channel, onEnd]);

  useEffect(() => {
    document.title = "Rusuite Show – Slide show";
  }, []);

  const onAction = useCallback((action: ShowAction) => ch?.post({ kind: "action", action }), [ch]);
  const show = useMemo<ShowState>(
    () => ({
      index: view.slideIndex,
      count: deck?.slides.length ?? 0,
      blank: view.blackout,
      ended: view.ended,
      typed: "",
      step: view.step,
      steps: [],
      clickAdvance: [],
      autoStopped: false,
    }),
    [view, deck],
  );

  if (!deck) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black text-sm text-white/60" data-testid="audience-waiting">
        {t("show.waiting")}
      </div>
    );
  }
  return (
    <Presenter
      deck={deck.deck}
      slides={deck.slides}
      media={deck.media}
      mediaVersion={deck.version}
      show={show}
      onAction={onAction}
      fullscreenExits={false}
      mirror={tools}
    />
  );
}
