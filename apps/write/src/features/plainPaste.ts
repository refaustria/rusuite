// Plain text from other programs (P8-38, W-06): every line becomes a paragraph, as in Word – empty lines too
// (ProseMirror's default parser merges runs of line breaks). The new paragraphs take the formatting of the
// paragraph they are pasted into (its style and properties, not its id); inside a list each line is a list item.

import { Fragment, Slice, type Node as PMNode, type ResolvedPos, type Schema } from "@tiptap/pm/model";

/** The lines of `text` (a final line break ends the last line instead of adding an empty one). */
export function plainLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The slice ProseMirror inserts for pasted plain `text` at `$context`. */
export function plainTextSlice(text: string, $context: ResolvedPos, schema: Schema): Slice {
  const lines = plainLines(text);
  const marks = $context.marks();
  const host = $context.parent;
  const type = host.isTextblock ? host.type : schema.nodes.paragraph!;
  const { id: _id, ...attrs } = (host.isTextblock ? host.attrs : {}) as Record<string, unknown>;
  const para = (line: string): PMNode => type.create(attrs, line ? schema.text(line, marks) : null);
  let item = -1;
  for (let d = $context.depth; d > 0; d--) {
    if ($context.node(d).type.name === "listItem") {
      item = d;
      break;
    }
  }
  // The text block directly in a list item: one item per line.
  if (item >= 0 && item === $context.depth - 1) {
    const li = $context.node(item);
    const items = lines.map((l) => li.type.create(null, para(l)));
    return new Slice(Fragment.from(items), 2, 2);
  }
  return new Slice(Fragment.from(lines.map(para)), 1, 1);
}
