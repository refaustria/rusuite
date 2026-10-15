import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function App() {
  const [reply, setReply] = useState<string | null>(null);

  async function ping() {
    setReply(await invoke<string>("ping"));
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
      {reply !== null && <p className="mt-4">{reply}</p>}
    </main>
  );
}
