// The sharing half of `app-notes-wasm` (src-wasm/src/sync.rs): device keys, member chains, keyrings, envelopes and
// relay frames. Everything that needs a key or a signature runs in the wasm module; this file only types it. The
// engine (`engine.ts`) moves opaque frames and envelopes and reacts to the JSON events.

import { splitRecords } from "../effects";

export type Role = "owner" | "coOwner" | "edit" | "read";

export const canWrite = (r: Role | null | undefined): boolean => r === "owner" || r === "coOwner" || r === "edit";
export const canManage = (r: Role | null | undefined): boolean => r === "owner" || r === "coOwner";

export interface MemberInfo {
  device: string;
  name: string;
  role: Role;
  me: boolean;
}

export interface JoinInfo {
  inviteId: string;
  device: string;
  name: string;
  role: Role;
}

/** `sync_status`: what this device knows about a shared notebook. */
export interface ShareStatus {
  notebook: string;
  localId: string;
  member: boolean;
  removed?: boolean;
  joining?: boolean;
  requested?: boolean;
  inviteRole?: Role | null;
  role?: Role | null;
  epoch?: number;
  version?: number;
  hasKey?: boolean;
  members?: MemberInfo[];
  /** Every device ever listed → its display name (history, last editor). */
  names?: Record<string, string>;
  joins?: JoinInfo[];
  invites?: number;
}

/** One relay frame, handled (`sync_handle`). */
export type RelayEvent =
  | { type: "challenge" }
  | { type: "subscribed"; docs: [string, number][]; newJoins: JoinInfo[] }
  | { type: "pending"; requested: boolean }
  | { type: "admitted" }
  | { type: "revoked" }
  | { type: "deleted" }
  | { type: "deliver"; doc: string; seq: number; kind: "update" | "snapshot"; target: "notebook" | "page"; id: string; author: string }
  | { type: "dropped"; doc?: string; seq?: number; reason: string }
  | { type: "caughtUp"; doc: string; last: number }
  | { type: "presence"; author: string }
  | { type: "members" }
  | { type: "keys"; epoch: number }
  | { type: "joinRequest"; join: JoinInfo }
  | { type: "ignored" }
  | { type: "blob"; sha: string }
  | { type: "blobMissing"; blob: string }
  | { type: "accepted"; tag: number; seq: number }
  | { type: "rejected"; tag: number; code: string }
  | { type: "error"; code: string }
  | { type: "invalid"; reason: string };

/** The relay-facing crypto the engine uses (the wasm module; tests use a fake). */
export interface SyncCrypto {
  deviceCreate(): Uint8Array;
  deviceLoad(bytes: Uint8Array): string;
  bookLoad(bytes: Uint8Array): ShareStatus;
  bookSave(nb: string): Uint8Array;
  bookForget(nb: string): void;
  setLocalId(nb: string, localId: string): void;
  shareCreate(localId: string, name: string): { notebook: string; genesis: Uint8Array };
  joinStart(fragment: string, nowSecs: number): { notebook: string; role: Role; expiresAt: number };
  joinRequest(nb: string, name: string, nowSecs: number): Uint8Array;
  status(nb: string): ShareStatus;
  docId(nb: string, doc: string): string;
  blobDocId(nb: string, sha: string): string;
  subscribe(nb: string, docs: [string, number][]): Uint8Array;
  publish(tag: number, envelope: Uint8Array): Uint8Array;
  fetchBlob(nb: string, sha: string): Uint8Array;
  stopSharing(nb: string, nowSecs: number): Uint8Array;
  sealDoc(nb: string, doc: string, covers: number, data: Uint8Array): Uint8Array;
  sealBlob(nb: string, sha: string, data: Uint8Array): Uint8Array;
  sealPresence(nb: string, data: Uint8Array): Uint8Array;
  reencrypt(nb: string, envelope: Uint8Array): Uint8Array;
  envelopeEpoch(envelope: Uint8Array): number;
  inviteCreate(nb: string, role: Role, relayHint: string, nowSecs: number): { fragment: string; inviteId: string; expiresAt: number };
  admit(nb: string, inviteId: string): Uint8Array[];
  decline(nb: string, inviteId: string): void;
  remove(nb: string, device: string): Uint8Array[];
  setRole(nb: string, device: string, role: Role): Uint8Array;
  handle(nb: string, frame: Uint8Array, nowSecs: number): RelayEvent;
  takePayload(): Uint8Array;
}

/** The `sync_*` exports of `app-notes-wasm`. */
export interface SyncWasmModule {
  sync_device_create(): Uint8Array;
  sync_device_load(bytes: Uint8Array): string;
  sync_book_load(bytes: Uint8Array): string;
  sync_book_save(nb: string): Uint8Array;
  sync_book_forget(nb: string): void;
  sync_set_local_id(nb: string, localId: string): void;
  sync_share_create(localId: string, name: string): Uint8Array;
  sync_join_start(fragment: string, nowSecs: number): string;
  sync_join_request(nb: string, name: string, nowSecs: number): Uint8Array;
  sync_status(nb: string): string;
  sync_doc_id(nb: string, doc: string): string;
  sync_blob_doc_id(nb: string, sha: string): string;
  sync_subscribe(nb: string, docs: string): Uint8Array;
  sync_publish(tag: number, envelope: Uint8Array): Uint8Array;
  sync_fetch_blob(nb: string, sha: string): Uint8Array;
  sync_stop_sharing(nb: string, nowSecs: number): Uint8Array;
  sync_seal_doc(nb: string, doc: string, covers: number, data: Uint8Array): Uint8Array;
  sync_seal_blob(nb: string, sha: string, data: Uint8Array): Uint8Array;
  sync_seal_presence(nb: string, data: Uint8Array): Uint8Array;
  sync_reencrypt(nb: string, envelope: Uint8Array): Uint8Array;
  sync_envelope_epoch(envelope: Uint8Array): number;
  sync_invite_create(nb: string, role: string, relayHint: string, nowSecs: number): string;
  sync_admit(nb: string, inviteId: string): Uint8Array;
  sync_decline(nb: string, inviteId: string): void;
  sync_remove(nb: string, device: string): Uint8Array;
  sync_set_role(nb: string, device: string, role: string): Uint8Array;
  sync_handle(nb: string, frame: Uint8Array, nowSecs: number): string;
  sync_take_payload(): Uint8Array;
}

const text = new TextDecoder();

/** Wraps the wasm exports (errors are thrown as `Error`s with the module's message). */
export function wasmCrypto(m: SyncWasmModule): SyncCrypto {
  const call = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  };
  return {
    deviceCreate: () => m.sync_device_create(),
    deviceLoad: (b) => call(() => m.sync_device_load(b)),
    bookLoad: (b) => call(() => JSON.parse(m.sync_book_load(b)) as ShareStatus),
    bookSave: (nb) => call(() => m.sync_book_save(nb)),
    bookForget: (nb) => call(() => m.sync_book_forget(nb)),
    setLocalId: (nb, id) => call(() => m.sync_set_local_id(nb, id)),
    shareCreate: (localId, name) =>
      call(() => {
        const [status, genesis] = splitRecords(m.sync_share_create(localId, name));
        return { notebook: (JSON.parse(text.decode(status!)) as { notebook: string }).notebook, genesis: genesis! };
      }),
    joinStart: (f, now) => call(() => JSON.parse(m.sync_join_start(f, now)) as { notebook: string; role: Role; expiresAt: number }),
    joinRequest: (nb, name, now) => call(() => m.sync_join_request(nb, name, now)),
    status: (nb) => call(() => JSON.parse(m.sync_status(nb)) as ShareStatus),
    docId: (nb, doc) => call(() => m.sync_doc_id(nb, doc)),
    blobDocId: (nb, sha) => call(() => m.sync_blob_doc_id(nb, sha)),
    subscribe: (nb, docs) => call(() => m.sync_subscribe(nb, JSON.stringify(docs))),
    publish: (tag, env) => call(() => m.sync_publish(tag, env)),
    fetchBlob: (nb, sha) => call(() => m.sync_fetch_blob(nb, sha)),
    stopSharing: (nb, now) => call(() => m.sync_stop_sharing(nb, now)),
    sealDoc: (nb, doc, covers, data) => call(() => m.sync_seal_doc(nb, doc, covers, data)),
    sealBlob: (nb, sha, data) => call(() => m.sync_seal_blob(nb, sha, data)),
    sealPresence: (nb, data) => call(() => m.sync_seal_presence(nb, data)),
    reencrypt: (nb, env) => call(() => m.sync_reencrypt(nb, env)),
    envelopeEpoch: (env) => call(() => m.sync_envelope_epoch(env)),
    inviteCreate: (nb, role, hint, now) => call(() => JSON.parse(m.sync_invite_create(nb, role, hint, now)) as { fragment: string; inviteId: string; expiresAt: number }),
    admit: (nb, id) => call(() => splitRecords(m.sync_admit(nb, id))),
    decline: (nb, id) => call(() => m.sync_decline(nb, id)),
    remove: (nb, device) => call(() => splitRecords(m.sync_remove(nb, device))),
    setRole: (nb, device, role) => call(() => m.sync_set_role(nb, device, role)),
    handle: (nb, frame, now) => JSON.parse(m.sync_handle(nb, frame, now)) as RelayEvent,
    takePayload: () => m.sync_take_payload(),
  };
}

/** The doc id of notebook-level envelopes (the notebook doc, presence). */
export const NOTEBOOK_DOC = "00000000000000000000000000000000";
