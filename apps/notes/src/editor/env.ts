// What the page editor's node views and plugins need from the app (blob URLs, tag definitions, live page titles,
// attachment actions). The page view passes one `EditorEnv`; tests and the controller's schema use the defaults.

import type { TagDef } from "../generated/TagDef";

export interface EditorEnv {
  /** The object URL of a blob of the open notebook (`null`: not stored). */
  blobUrl(sha: string): Promise<string | null>;
  /** The open notebook's tag definitions by id. */
  tag(id: string): TagDef | undefined;
  /** The display label of a tag (built-ins: the catalog text). */
  tagLabel(id: string): string;
  /** The live title of a page (page doc id); `null` when the page does not exist (deleted or unknown). */
  pageTitle(pageId: string): string | null;
  /** A page link was clicked. */
  openPage(pageId: string): void;
  /** Attachment card buttons. */
  attachment(action: "open" | "download", attrs: { blob: string; name: string; size: number }): void;
  /** UI text. */
  t(key: string, params?: Record<string, string | number>): string;
}

export const NO_ENV: EditorEnv = {
  blobUrl: async () => null,
  tag: () => undefined,
  tagLabel: (id) => id,
  pageTitle: () => null,
  openPage: () => undefined,
  attachment: () => undefined,
  t: (key) => key,
};

/** Re-render hooks of node views showing live data (page titles, tags) – the page view calls `refresh` on changes. */
export class LiveViews {
  private views = new Set<() => void>();
  add(refresh: () => void): () => void {
    this.views.add(refresh);
    return () => this.views.delete(refresh);
  }
  refresh(): void {
    for (const v of this.views) v();
  }
}
