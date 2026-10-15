// The desktop `DocStorage`: the Tauri shell's session commands, which keep
// JSON files in the app data directory (`app_common::session::DirStorage`).
// The shell records opened/saved paths in its file dialogs itself.

import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n/locale";
import type { DocStorage, RecentEntry, RecentSource, RecoveryEntry, RecoveryInfo } from "./storage";

export class TauriDocStorage implements DocStorage {
  readonly kind = "fs" as const;

  listRecent(): Promise<RecentEntry[]> {
    return invoke<RecentEntry[]>("recent_list");
  }

  rememberRecent(): Promise<RecentEntry[]> {
    return this.listRecent();
  }

  async openRecent(entry: RecentEntry): Promise<RecentSource> {
    if (entry.path === null) throw new Error(t("recent.noPath", { name: entry.name }));
    const file = await invoke<{ name: string; bytesBase64: string }>("recent_open", { path: entry.path });
    return { file: { name: file.name, bytesBase64: file.bytesBase64 } };
  }

  listRecovery(): Promise<RecoveryInfo[]> {
    return invoke<RecoveryInfo[]>("recovery_list");
  }

  getRecovery(id: string): Promise<RecoveryEntry | null> {
    return invoke<RecoveryEntry | null>("recovery_get", { id });
  }

  putRecovery(entry: RecoveryEntry): Promise<void> {
    return invoke<void>("recovery_put", { entry });
  }

  removeRecovery(id: string): Promise<void> {
    return invoke<void>("recovery_remove", { id });
  }
}
