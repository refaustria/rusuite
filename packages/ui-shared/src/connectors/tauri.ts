// The desktop transport and store: the shells' `connector_*` commands (`app_common::connectors_tauri`). Requests
// are made by the Rust WebDAV client (no browser CSP or CORS involved); records live in `connections.json` in the
// app data directory without secrets, remembered passwords in the OS keyring.

import { invoke } from "@tauri-apps/api/core";
import { base64ToBytes, bytesToBase64 } from "../base64";
import type { ConnectorFile } from "../generated/ConnectorFile";
import type { ConnectorTarget, Entry, FileProvider, ReadResult, WriteOptions } from "./provider";
import { toConnectorError } from "./provider";
import { emptyData, parseData, type ConnectionStore, type StoredData } from "./store";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

const call = async <T,>(inv: Invoke, cmd: string, args: Record<string, unknown>): Promise<T> => {
  try {
    return await inv<T>(cmd, args);
  } catch (e) {
    throw toConnectorError(e);
  }
};

export class TauriProvider implements FileProvider {
  constructor(
    private readonly target: ConnectorTarget,
    private readonly inv: Invoke = invoke,
  ) {}

  list(path: string): Promise<Entry[]> {
    return call(this.inv, "connector_list", { target: this.target, path });
  }

  stat(path: string): Promise<Entry> {
    return call(this.inv, "connector_stat", { target: this.target, path });
  }

  async read(path: string): Promise<ReadResult> {
    const f = await call<ConnectorFile>(this.inv, "connector_read", { target: this.target, path });
    return { bytes: base64ToBytes(f.bytesBase64), etag: f.etag };
  }

  write(path: string, bytes: Uint8Array, options: WriteOptions = {}): Promise<string | null> {
    return call(this.inv, "connector_write", {
      target: this.target,
      path,
      bytesBase64: bytesToBase64(bytes),
      ifMatch: options.ifMatch ?? null,
      ifNoneMatch: options.ifNoneMatch ?? false,
    });
  }

  mkdir(path: string): Promise<void> {
    return call(this.inv, "connector_mkdir", { target: this.target, path });
  }

  delete(path: string): Promise<void> {
    return call(this.inv, "connector_delete", { target: this.target, path });
  }

  rename(from: string, to: string, options: { overwrite?: boolean } = {}): Promise<void> {
    return call(this.inv, "connector_rename", { target: this.target, from, to, overwrite: options.overwrite ?? false });
  }
}

export class TauriConnectionStore implements ConnectionStore {
  readonly kind = "desktop" as const;

  constructor(private readonly inv: Invoke = invoke) {}

  async load(): Promise<StoredData> {
    const json = await call<string | null>(this.inv, "connector_store_load", {});
    return json ? parseData(json) : emptyData();
  }

  async save(data: StoredData): Promise<void> {
    await call(this.inv, "connector_store_save", { json: JSON.stringify(data) });
  }

  getSecret(id: string): Promise<string | null> {
    return call(this.inv, "connector_secret_get", { id });
  }

  async setSecret(id: string, secret: string): Promise<void> {
    await call(this.inv, "connector_secret_set", { id, secret });
  }

  async deleteSecret(id: string): Promise<void> {
    await call(this.inv, "connector_secret_delete", { id });
  }

  async clear(): Promise<void> {
    const data = await this.load();
    for (const c of data.connections) await this.deleteSecret(c.id).catch(() => undefined);
    await call(this.inv, "connector_store_save", { json: "null" });
  }
}
