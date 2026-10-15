import type { OpenedFile } from "@rusuite/ui-shared";
import type { WriteBackend, WriteRequest, WriteResponseBody } from "./backend";

/** In-memory backend for tests; records every request. */
export class FakeBackend implements WriteBackend {
  readonly kind = "wasm" as const;
  readonly log: WriteRequest[] = [];
  async ping() {
    return "Rusuite Write fake";
  }
  async dispatch<T = WriteResponseBody>(request: WriteRequest) {
    this.log.push(request);
    return { ok: { type: "pong" } as unknown as T };
  }
  async openFile(): Promise<OpenedFile | null> {
    return null;
  }
  async saveFile() {
    return false;
  }
  async setTitle() {}
}
