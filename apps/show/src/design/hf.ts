// Header & Footer (Insert › Header & Footer, P8-19's `SetHeaderFooter`)
// and Insert › Slide Number / Date & Time (`TextRun.field`).

import type { HfDate } from "../generated/HfDate";
import type { HfTarget } from "../generated/HfTarget";
import type { Presentation } from "../generated/Presentation";
import type { ResolvedFooter } from "../generated/ResolvedFooter";
import type { ShowCommand } from "../generated/ShowCommand";
import type { Slide } from "../generated/Slide";
import type { TextBody } from "../generated/TextBody";
import type { TextField } from "../generated/TextField";
import type { TextRun } from "../generated/TextRun";
import { charLen, paragraphText, textOf } from "../model";

/**
 * What a slide shows in its date, footer and slide-number placeholders
 * (`Presentation::resolved_footer`): the date field's format or the fixed
 * text, the footer text, the slide's 1-based position.
 */
export function resolvedFooter(slide: Slide, index: number): ResolvedFooter {
  const out: ResolvedFooter = { date: null, footer: null, slideNumber: null };
  for (const shape of slide.shapes) {
    const body = textOf(shape);
    const text = body ? body.paragraphs.map(paragraphText).join("\n") : "";
    if (shape.placeholder === "dateTime") {
      const field = body?.paragraphs.flatMap((p) => p.runs).find((r) => r.field?.kind === "dateTime")?.field;
      out.date = field?.kind === "dateTime" ? { kind: "auto", value: { format: field.value.format } } : { kind: "fixed", value: text };
    } else if (shape.placeholder === "footer") out.footer = text;
    else if (shape.placeholder === "slideNumber") out.slideNumber = index + 1;
  }
  return out;
}

/** The Slide tab of the Header & Footer dialog. */
export interface HfValues {
  dateOn: boolean;
  auto: boolean;
  /** `datetimeN` of the automatic date. */
  format: number;
  fixed: string;
  slideNumber: boolean;
  footerOn: boolean;
  footer: string;
  notOnTitle: boolean;
}

/** Nothing on. */
export const DEFAULT_HF: HfValues = { dateOn: false, auto: true, format: 1, fixed: "", slideNumber: false, footerOn: false, footer: "", notOnTitle: false };

/** The dialog's values for the current slide (else the master's settings). */
export function hfValuesOf(pres: Presentation, slideId: number | null): HfValues {
  const hf = pres.master?.headerFooter ?? {};
  const i = slideId === null ? -1 : pres.slides.findIndex((s) => s.id === slideId);
  const r = i >= 0 ? resolvedFooter(pres.slides[i]!, i) : null;
  const has = !!r && (r.date !== null || r.footer !== null || r.slideNumber !== null);
  const d = has ? r!.date : hf.date && hf.date.kind !== "off" ? (hf.date.kind === "auto" ? { kind: "auto" as const, value: hf.date.value } : { kind: "fixed" as const, value: hf.date.value.text }) : null;
  return {
    dateOn: d !== null,
    auto: d?.kind !== "fixed",
    format: d?.kind === "auto" ? d.value.format || 1 : 1,
    fixed: d?.kind === "fixed" ? d.value : "",
    slideNumber: has ? r!.slideNumber !== null : !!hf.slideNumber,
    footerOn: has ? r!.footer !== null : hf.footer !== undefined && hf.footer !== null,
    footer: (has ? r!.footer : hf.footer) ?? "",
    notOnTitle: !!hf.notOnTitle,
  };
}

/** `SetHeaderFooter` of the dialog's values (Apply: the current slide; Apply to All). */
export function hfCommand(v: HfValues, applyTo: HfTarget): ShowCommand {
  const date: HfDate = !v.dateOn ? { kind: "off" } : v.auto ? { kind: "auto", value: { format: v.format } } : { kind: "fixed", value: { text: v.fixed } };
  return { type: "setHeaderFooter", date, footer: v.footerOn ? v.footer : null, slideNumber: v.slideNumber, applyTo, notOnTitle: v.notOnTitle };
}

/**
 * `body` with a field run inserted at char `offset` of paragraph
 * `paragraph` (runs split there; the field takes the formatting of the
 * run it is inserted into).
 */
export function insertField(body: TextBody, paragraph: number, offset: number, field: TextField, text: string): TextBody {
  const paragraphs = body.paragraphs.map((p, i) => {
    if (i !== paragraph) return p;
    const runs: TextRun[] = [];
    let at = 0;
    let done = false;
    let lastProps = p.runs[0]?.props;
    for (const r of p.runs) {
      const len = charLen(r.text);
      lastProps = r.props;
      if (!done && !r.field && offset >= at && offset <= at + len) {
        const chars = Array.from(r.text);
        const before = chars.slice(0, offset - at).join("");
        const after = chars.slice(offset - at).join("");
        if (before) runs.push({ ...r, text: before });
        runs.push(r.props ? { props: r.props, text, field } : { text, field });
        if (after) runs.push({ ...r, text: after });
        done = true;
      } else runs.push(r);
      at += len;
    }
    if (!done) runs.push(lastProps ? { props: lastProps, text, field } : { text, field });
    return { ...p, runs };
  });
  if (!paragraphs.length) paragraphs.push({ runs: [{ text, field }] });
  return { ...body, paragraphs };
}
