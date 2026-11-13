// loro-crdt's wasm, instantiated before anything uses Loro. In the app build `loro-crdt` resolves to its `web`
// entry (vite.config.ts), whose default export fetches the hashed wasm asset; the Node build of the tests needs no
// initialisation (no default export).

import * as loro from "loro-crdt";

export async function initLoro(): Promise<void> {
  const init = (loro as unknown as { default?: () => Promise<unknown> }).default;
  if (typeof init === "function") await init();
}
