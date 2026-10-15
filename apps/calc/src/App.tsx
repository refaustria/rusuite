import { useState } from "react";
import type { Backend } from "@rusuite/ui-shared";

export default function App({ backend }: { backend: Backend }) {
  const [reply, setReply] = useState<string | null>(null);

  async function ping() {
    setReply(await backend.ping());
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Rusuite Calc</h1>
      <button
        type="button"
        className="mt-4 rounded bg-blue-700 px-3 py-1 text-white"
        onClick={ping}
      >
        Ping backend
      </button>
      {reply !== null && (
        <p className="mt-4">
          {reply} <span data-testid="backend-kind">({backend.kind})</span>
        </p>
      )}
    </main>
  );
}
