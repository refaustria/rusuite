import { useEffect, useState } from "react";
import { pingCore, type WriteBackend } from "./backend";
import { Editor } from "./Editor";

function StatusBar({ backend }: { backend: WriteBackend }) {
  const [ping, setPing] = useState("…");
  useEffect(() => {
    let live = true;
    (async () => {
      const text = await backend.ping();
      const ok = await pingCore(backend);
      if (live) setPing(`${text}${ok ? "" : " (core not answering)"}`);
    })().catch((e) => live && setPing(`ping failed: ${String(e)}`));
    return () => {
      live = false;
    };
  }, [backend]);
  return (
    <div className="flex items-center gap-4 border-t border-ui-border bg-ui-panel px-3 py-0.5 text-xs text-ui-muted" data-testid="status-bar">
      <span data-testid="backend-kind">{backend.kind}</span>
      <span data-testid="ping">{ping}</span>
    </div>
  );
}

export default function App({ backend }: { backend: WriteBackend }) {
  useEffect(() => {
    void backend.setTitle("Rusuite Write").catch(() => undefined);
  }, [backend]);
  return (
    <main className="flex h-screen flex-col bg-ui-bg text-ui-fg">
      <Editor />
      <StatusBar backend={backend} />
    </main>
  );
}
