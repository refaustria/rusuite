// Object URLs of a notebook's blobs for canvas image items: the controller's blob URL cache (`BlobUrls`: one
// IndexedDB read per blob id, P11-N3).

import { useEffect, useState } from "react";
import type { NotesController } from "../controller";

/** The object URL of a blob of `notebook` (null while loading or when it is not stored). */
export function useBlobUrl(ctl: NotesController, notebook: string | null, blob: string | null): string | null {
  const cached = notebook && blob ? ctl.blobs.cached(notebook, blob) : null;
  const [url, setUrl] = useState<string | null>(cached);
  useEffect(() => {
    if (!notebook || !blob) {
      setUrl(null);
      return;
    }
    let gone = false;
    void ctl.blobs.url(notebook, blob).then((u) => !gone && setUrl(u));
    return () => {
      gone = true;
    };
  }, [ctl, notebook, blob]);
  return cached ?? url;
}
