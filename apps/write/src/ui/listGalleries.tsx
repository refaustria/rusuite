// Home › Bullets ▾ / Numbering ▾ / Multilevel List ▾ (P9-W1): Word's list
// libraries as galleries, plus Define New Number Format…, Define New
// Bullet… and Set Numbering Value… (the dialogs also open from the list
// item's context menu). The choices are Rust `ApplyNumbering` /
// `RestartList` / `ContinueList` commands (features/listGallery.ts).

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { Dialog, RibbonGallery, RibbonMenuButton, type RibbonGalleryItem } from "@rusuite/ui-shared";
import type { Level } from "../generated/Level";
import type { LevelKind } from "../generated/LevelKind";
import type { ListPreset } from "../generated/ListPreset";
import type { WriteFeatures, WriteUi } from "../features/WriteFeatures";
import {
  applyListChoice, BULLET_PRESETS, hasNumberToken, levelAtCaret, levelFromFormat, listTargets, MULTILEVEL_PRESETS, MULTILEVEL_SAMPLES,
  numberedParagraphAtCaret, NUMBERING_PRESETS, presetSamples, sampleLabel,
} from "../features/listGallery";
import type { SyncController } from "../sync/SyncPlugin";
import { useT } from "../i18n";
import { Buttons, INPUT, Row } from "./dialogs";

const BULLETS_ICON = (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <circle cx="4" cy="5" r="1.2" fill="currentColor" />
    <circle cx="4" cy="10" r="1.2" fill="currentColor" />
    <circle cx="4" cy="15" r="1.2" fill="currentColor" />
    <path d="M8 5h9M8 10h9M8 15h9" />
  </svg>
);
const NUMBERING_ICON = (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M3 3.5h1.2v3M3 8.5h2.2l-2.2 3h2.2M3 13.5h2v1.5h-1.5h1.5v1.5h-2" strokeWidth="1" />
    <path d="M8 5h9M8 10h9M8 15h9" />
  </svg>
);
const MULTILEVEL_ICON = (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M3 4.5h1M7 4.5h10M5 10h1M9 10h8M7 15.5h1M11 15.5h6" />
  </svg>
);

/** A gallery preview: three lines, each a label and a grey bar (`indent` steps per line for multilevel lists). */
function Preview({ lines, indent = 0 }: { lines: { label: string; heading?: string | null }[]; indent?: number }) {
  return (
    <span className="flex w-full flex-col gap-1 px-1 py-1 text-left text-[10px] leading-3">
      {lines.map((l, i) => (
        <span key={i} className="flex items-center gap-1 whitespace-nowrap" style={{ paddingLeft: i * indent }}>
          <span>{l.label}</span>
          {l.heading ? <span className="text-ui-muted">{l.heading}</span> : <span className="h-px flex-1 bg-ui-border" />}
        </span>
      ))}
    </span>
  );
}

function presetLabel(t: ReturnType<typeof useT>, preset: ListPreset): string {
  if (MULTILEVEL_PRESETS.includes(preset)) return t(`write.listPreset.${preset}`);
  const sample = presetSamples(preset).join(" ");
  return BULLET_PRESETS.includes(preset) ? t("write.bulletChoice", { sample: presetSamples(preset)[0] ?? "" }) : t("write.numberingChoice", { sample });
}

/** The gallery items of `presets` (`none`: Word's "None" first). */
function galleryItems(t: ReturnType<typeof useT>, presets: ListPreset[], none: boolean): RibbonGalleryItem[] {
  const items: RibbonGalleryItem[] = presets.map((p) => {
    const multi = MULTILEVEL_SAMPLES[p];
    const lines = multi
      ? multi.map(([label, h]) => ({ label, heading: h ? t("write.style.heading", { n: h }) : null }))
      : presetSamples(p).map((label) => ({ label }));
    return { id: p, label: presetLabel(t, p), preview: <Preview lines={lines} indent={multi ? 6 : 0} /> };
  });
  if (none) items.unshift({ id: "none", label: t("write.listNone"), preview: <span className="text-xs">{t("write.listNone")}</span> });
  return items;
}

function GalleryPanel({ label, items, onSelect, footer, testId }: { label: string; items: RibbonGalleryItem[]; onSelect: (id: string) => void; footer: ReactNode; testId: string }) {
  return (
    <div className="flex flex-col gap-1 p-1" data-testid={testId}>
      <RibbonGallery label={label} items={items} onSelect={onSelect} columns={4} itemClassName="h-16 w-20 p-0.5" hideLabels autoFocus />
      <div className="flex flex-col border-t border-ui-border pt-1">{footer}</div>
    </div>
  );
}

function FooterButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="rounded px-2 py-1 text-left text-xs hover:bg-ui-hover" onClick={onClick}>
      {label}
    </button>
  );
}

/** Removes the numbering of the selected paragraphs (the galleries' "None"). */
function removeNumbering(editor: Editor, ctl: SyncController): void {
  const blocks = listTargets(editor.state).map((x) => x.id);
  if (blocks.length) void ctl.run({ type: "applyList", blocks, kind: "none" });
}

/** The three gallery buttons of Home › Paragraph. */
export function ListGalleries({ editor, ctl, features }: { editor: Editor; ctl: SyncController; features: WriteFeatures }) {
  const t = useT();
  const pick = (close: () => void) => (id: string) => {
    close();
    if (id === "none") removeNumbering(editor, ctl);
    else void applyListChoice(editor, ctl, { preset: id as ListPreset }).catch((e) => ctl.pushError(e));
  };
  const open = (close: () => void, dialog: "numberFormat" | "bulletFormat" | "numberingValue") => () => {
    close();
    features.ui.openDialog(dialog);
  };
  return (
    <>
      <RibbonMenuButton
        label={t("write.bulletLibrary")}
        icon={BULLETS_ICON}
        menu={(close) => (
          <GalleryPanel
            label={t("write.bulletLibrary")}
            testId="bullet-gallery"
            items={galleryItems(t, BULLET_PRESETS, true)}
            onSelect={pick(close)}
            footer={<FooterButton label={t("write.defineBullet")} onClick={open(close, "bulletFormat")} />}
          />
        )}
      />
      <RibbonMenuButton
        label={t("write.numberingLibrary")}
        icon={NUMBERING_ICON}
        menu={(close) => (
          <GalleryPanel
            label={t("write.numberingLibrary")}
            testId="numbering-gallery"
            items={galleryItems(t, NUMBERING_PRESETS, true)}
            onSelect={pick(close)}
            footer={
              <>
                <FooterButton label={t("write.defineNumberFormat")} onClick={open(close, "numberFormat")} />
                <FooterButton label={t("write.setNumberingValue")} onClick={open(close, "numberingValue")} />
              </>
            }
          />
        )}
      />
      <RibbonMenuButton
        label={t("write.multilevel")}
        icon={MULTILEVEL_ICON}
        menu={(close) => (
          <GalleryPanel label={t("write.multilevel")} testId="multilevel-gallery" items={galleryItems(t, MULTILEVEL_PRESETS, false)} onSelect={pick(close)} footer={null} />
        )}
      />
    </>
  );
}

// ----- dialogs --------------------------------------------------------------------------------

const NUMBER_STYLES: { id: LevelKind; sample: string }[] = [
  { id: "decimal", sample: "1, 2, 3" },
  { id: "upperRoman", sample: "I, II, III" },
  { id: "lowerRoman", sample: "i, ii, iii" },
  { id: "upperLetter", sample: "A, B, C" },
  { id: "lowerLetter", sample: "a, b, c" },
  { id: "ordinal", sample: "1st, 2nd, 3rd" },
  { id: "decimalZero", sample: "01, 02, 03" },
  { id: "none", sample: "–" },
];

/** Define New Bullet's symbols (Word's Symbol dialog, reduced to the common bullets). */
export const BULLET_SYMBOLS = ["•", "○", "■", "□", "◆", "◇", "➢", "►", "✓", "✔", "★", "☆", "♦", "❖", "⇒", "–"];

type Align = "left" | "center" | "right";

export interface NumberFormatValues {
  kind: LevelKind;
  /** The format text; `%1` stands for the number. */
  text: string;
  font: string;
  alignment: Align;
}

/** The format text shown for a level template (its own token as `%1`). */
function templateOf(level: Level | null, index: number): string {
  return level && level.kind !== "bullet" ? level.text.replace(new RegExp(`%${index + 1}`, "g"), "%1") : "%1.";
}

export function NumberFormatDialog({ open, initial, onSubmit, onClose }: {
  open: boolean;
  initial: NumberFormatValues;
  onSubmit: (v: NumberFormatValues) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [v, setV] = useState(initial);
  useEffect(() => {
    if (open) setV(initial);
  }, [open, initial]);
  const valid = v.kind === "none" || hasNumberToken(v.text);
  const sample = [1, 2, 3].map((n) => sampleLabel(v.kind, v.text, n)).join("  ");
  return (
    <Dialog open={open} title={t("write.defineNumberFormat")} onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(v);
        }}
      >
        <Row label={t("write.numberStyle")}>
          <select aria-label={t("write.numberStyle")} className={`${INPUT} w-36`} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as LevelKind })}>
            {NUMBER_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.sample}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t("write.numberFormatText")}>
          <input aria-label={t("write.numberFormatText")} className={`${INPUT} w-36`} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} />
        </Row>
        <p className="text-xs text-ui-muted">{t("write.numberFormatHint")}</p>
        <Row label={t("write.listFont")}>
          <input aria-label={t("write.listFont")} className={`${INPUT} w-36`} value={v.font} placeholder={t("write.listFontDefault")} onChange={(e) => setV({ ...v, font: e.target.value })} />
        </Row>
        <Row label={t("write.listAlignment")}>
          <select aria-label={t("write.listAlignment")} className={`${INPUT} w-36`} value={v.alignment} onChange={(e) => setV({ ...v, alignment: e.target.value as Align })}>
            <option value="left">{t("write.left")}</option>
            <option value="center">{t("write.centered")}</option>
            <option value="right">{t("write.right")}</option>
          </select>
        </Row>
        <div className="rounded border border-ui-border p-2" data-testid="number-format-preview" aria-label={t("write.preview")}>
          {sample}
        </div>
        <Buttons onClose={onClose} disabled={!valid} />
      </form>
    </Dialog>
  );
}

export function BulletDialog({ open, initial, onSubmit, onClose }: {
  open: boolean;
  initial: { symbol: string; font: string };
  onSubmit: (v: { symbol: string; font: string }) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [v, setV] = useState(initial);
  useEffect(() => {
    if (open) setV(initial);
  }, [open, initial]);
  return (
    <Dialog open={open} title={t("write.defineBullet")} onClose={onClose}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (v.symbol) onSubmit(v);
        }}
      >
        <div role="group" aria-label={t("write.bulletSymbol")} className="grid grid-cols-8 gap-1">
          {BULLET_SYMBOLS.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={s}
              aria-pressed={v.symbol === s}
              className={`h-7 rounded border text-base ${v.symbol === s ? "border-ui-focus bg-ui-hover" : "border-ui-border"}`}
              onClick={() => setV({ ...v, symbol: s })}
            >
              {s}
            </button>
          ))}
        </div>
        <Row label={t("write.listFont")}>
          <input aria-label={t("write.listFont")} className={`${INPUT} w-36`} value={v.font} placeholder={t("write.listFontDefault")} onChange={(e) => setV({ ...v, font: e.target.value })} />
        </Row>
        <div className="rounded border border-ui-border p-2" data-testid="bullet-preview">
          {v.symbol} {t("write.preview")}
        </div>
        <Buttons onClose={onClose} disabled={!v.symbol} />
      </form>
    </Dialog>
  );
}

export function NumberingValueDialog({ open, initial, onSubmit, onClose }: {
  open: boolean;
  initial: number;
  onSubmit: (v: { restart: boolean; value: number }) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [restart, setRestart] = useState(true);
  const [value, setValue] = useState(String(initial));
  useEffect(() => {
    if (!open) return;
    setRestart(true);
    setValue(String(initial));
  }, [open, initial]);
  const n = Number(value);
  const valid = !restart || (Number.isInteger(n) && n >= 0);
  return (
    <Dialog open={open} title={t("write.setNumberingValue")} onClose={onClose}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit({ restart, value: n });
        }}
      >
        <label className="flex items-center gap-2">
          <input type="radio" name="nv-mode" checked={restart} onChange={() => setRestart(true)} />
          <span>{t("write.startNewList")}</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="nv-mode" checked={!restart} onChange={() => setRestart(false)} />
          <span>{t("write.continuePrevious")}</span>
        </label>
        <Row label={t("write.setValueTo")}>
          <input aria-label={t("write.setValueTo")} className={`${INPUT} w-20`} value={value} disabled={!restart} onChange={(e) => setValue(e.target.value)} />
        </Row>
        <Buttons onClose={onClose} disabled={!valid} />
      </form>
    </Dialog>
  );
}

const fontName = (l: Level | null | undefined) => (l?.font?.kind === "named" ? l.font.value : "");

/** The list dialogs the UI store asks for. */
export function ListDialogs({ ui, ctl, editor }: { ui: WriteUi; ctl: SyncController; editor: Editor | null }) {
  const { dialog } = useSyncExternalStore(ui.subscribe, ui.getState);
  const at = useMemo(
    () => (editor && (dialog === "numberFormat" || dialog === "bulletFormat" || dialog === "numberingValue") ? levelAtCaret(editor.state, ctl.numbering, ctl.styles) : null),
    [editor, dialog, ctl],
  );
  const index = at?.index ?? 0;
  const numberInitial = useMemo<NumberFormatValues>(() => {
    const l = at?.level && at.level.kind !== "bullet" ? at.level : null;
    return { kind: l?.kind ?? "decimal", text: templateOf(l, index), font: fontName(l), alignment: l?.alignment ?? "left" };
  }, [at, index]);
  const bulletInitial = useMemo(() => {
    const l = at?.level?.kind === "bullet" ? at.level : null;
    return { symbol: l?.text ?? "•", font: l && !/^(symbol|wingdings)/i.test(fontName(l)) ? fontName(l) : "" };
  }, [at]);
  const close = () => {
    ui.openDialog(null);
    editor?.commands.focus();
  };
  const apply = (format: Level) => {
    if (editor) void applyListChoice(editor, ctl, { format }).catch((e) => ctl.pushError(e));
  };
  const block = editor ? numberedParagraphAtCaret(editor.state) : null;
  return (
    <>
      <NumberFormatDialog
        open={dialog === "numberFormat"}
        initial={numberInitial}
        onClose={close}
        onSubmit={(v) => {
          close();
          apply(levelFromFormat({ ...v, start: at?.level.start ?? 1 }, index));
        }}
      />
      <BulletDialog
        open={dialog === "bulletFormat"}
        initial={bulletInitial}
        onClose={close}
        onSubmit={(v) => {
          close();
          apply(levelFromFormat({ kind: "bullet", text: v.symbol, font: v.font, alignment: "left" }, index));
        }}
      />
      <NumberingValueDialog
        open={dialog === "numberingValue" && block != null && block > 0}
        initial={at?.level.start ?? 1}
        onClose={close}
        onSubmit={(v) => {
          close();
          if (block == null || block <= 0) return;
          void ctl.run(v.restart ? { type: "restartList", block, start: v.value } : { type: "continueList", block });
        }}
      />
    </>
  );
}

