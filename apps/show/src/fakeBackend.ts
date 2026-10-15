import type { OpenedFile } from "@rusuite/ui-shared";
import type { ShowBackend, ShowRequest, ShowResponseBody } from "./backend";

/** In-memory backend for tests; records every request. */
export class FakeBackend implements ShowBackend {
  readonly kind = "wasm" as const;
  readonly log: ShowRequest[] = [];
  async ping() {
    return "Rusuite Show fake";
  }
  async dispatch<T = ShowResponseBody>(request: ShowRequest) {
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
