// Home › Tags › Customize tags…: the notebook's tags (stored in the notebook doc, notes-format §3). Custom tags can
// be renamed, recoloured and get another icon; new ones are plain tags or to-do tags (with a check box, listed in
// the tasks view). Built-in tags keep their catalog name.

import { useState } from "react";
import { BTN, Dialog, FOCUS_RING } from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import type { TagDef } from "../generated/TagDef";
import { CUSTOM_TAG_ICONS, isToDoKind, TAG_COLORS, tagIconSvg, tagLook } from "../tags";
import { useT } from "../i18n";
import { tagLabel } from "./editorEnv";
import { useNotes } from "./hooks";

function Icon({ icon, color, checked = false }: { icon: string; color: string; checked?: boolean }) {
  return <span className="inline-flex" aria-hidden="true" dangerouslySetInnerHTML={{ __html: tagIconSvg(icon, color, checked, 18) }} />;
}

function Swatches({ value, onPick, label }: { value: string | undefined; onPick: (c: string) => void; label: string }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {TAG_COLORS.map((c, i) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value?.toLowerCase() === c.toLowerCase()}
          aria-label={t("notes.color.n", { n: i + 1 })}
          className={`h-5 w-5 rounded-full border-2 ${value?.toLowerCase() === c.toLowerCase() ? "border-ui-fg" : "border-transparent"} ${FOCUS_RING}`}
          style={{ background: c }}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

function Icons({ value, color, onPick, label }: { value: string | undefined; color: string; onPick: (i: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {CUSTOM_TAG_ICONS.map((i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={i} title={i} className={`rounded p-0.5 ${value === i ? "bg-ui-active ring-1 ring-ui-fg" : "hover:bg-ui-hover"} ${FOCUS_RING}`} onClick={() => onPick(i)}>
          <Icon icon={i} color={color} />
        </button>
      ))}
    </div>
  );
}

function CustomTagRow({ ctl, tag }: { ctl: NotesController; tag: TagDef }) {
  const t = useT();
  const [label, setLabel] = useState(tag.label);
  const look = tagLook(tag);
  return (
    <li className="flex flex-col gap-1 border-t border-ui-border py-2" data-testid="custom-tag">
      <div className="flex items-center gap-2">
        <Icon icon={look.icon} color={look.color} />
        <input
          className="h-7 min-w-0 flex-1 rounded border border-ui-border bg-ui-bg px-2"
          aria-label={t("notes.tags.name")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label.trim() && label !== tag.label && void ctl.updateTag(tag.id, { label: label.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        />
        <span className="text-xs text-ui-muted">{isToDoKind(tag.kind) ? t("notes.tags.kindToDo") : t("notes.tags.kindTag")}</span>
      </div>
      <Swatches value={look.color} label={t("notes.tags.color")} onPick={(c) => void ctl.updateTag(tag.id, { color: c })} />
      <Icons value={look.icon} color={look.color} label={t("notes.tags.icon")} onPick={(i) => void ctl.updateTag(tag.id, { icon: i })} />
    </li>
  );
}

export function CustomizeTagsDialog({ ctl, onClose }: { ctl: NotesController; onClose: () => void }) {
  const t = useT();
  const tags = useNotes(ctl, (s) => (s.notebook ? s.tags[s.notebook] : undefined)) ?? [];
  const [name, setName] = useState("");
  const [todo, setTodo] = useState(false);
  const [icon, setIcon] = useState("star");
  const [color, setColor] = useState(TAG_COLORS[0]!);
  const builtins = tags.filter((x) => x.kind !== "custom" && x.kind !== "customToDo");
  const custom = tags.filter((x) => x.kind === "custom" || x.kind === "customToDo");
  return (
    <Dialog open title={t("notes.tags.customize")} onClose={onClose}>
      <div className="flex max-h-[70vh] w-[26rem] flex-col gap-3 overflow-auto text-sm" data-testid="tags-dialog">
        <form
          className="flex flex-col gap-2 rounded border border-ui-border p-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void ctl.addTag(name.trim(), todo ? "customToDo" : "custom", todo ? "checkbox" : icon, color);
            setName("");
          }}
        >
          <h3 className="font-semibold">{t("notes.tags.new")}</h3>
          <label className="flex items-center gap-2">
            {t("notes.tags.name")}
            <input className="h-7 min-w-0 flex-1 rounded border border-ui-border bg-ui-bg px-2" value={name} onChange={(e) => setName(e.target.value)} data-testid="new-tag-name" />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={todo} onChange={(e) => setTodo(e.target.checked)} data-testid="new-tag-todo" />
            {t("notes.tags.withCheckbox")}
          </label>
          <Swatches value={color} onPick={setColor} label={t("notes.tags.color")} />
          {!todo && <Icons value={icon} color={color} onPick={setIcon} label={t("notes.tags.icon")} />}
          <div className="flex justify-end">
            <button type="submit" className={BTN} disabled={!name.trim()} data-testid="new-tag-create">
              {t("notes.create")}
            </button>
          </div>
        </form>
        {custom.length > 0 && (
          <section>
            <h3 className="font-semibold">{t("notes.tags.custom")}</h3>
            <ul>
              {custom.map((x) => (
                <CustomTagRow key={x.id} ctl={ctl} tag={x} />
              ))}
            </ul>
          </section>
        )}
        <section>
          <h3 className="font-semibold">{t("notes.tags.builtin")}</h3>
          <ul className="grid grid-cols-2 gap-1">
            {builtins.map((x) => {
              const look = tagLook(x);
              return (
                <li key={x.id} className="flex items-center gap-2">
                  <Icon icon={look.icon} color={look.color} />
                  {tagLabel(ctl, x.id)}
                </li>
              );
            })}
          </ul>
        </section>
        <div className="flex justify-end">
          <button type="button" className={BTN} onClick={onClose}>
            {t("notes.close")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
