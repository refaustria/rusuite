// Sharing UI (P11-N5b): the Share dialog (turn on, invite links, members, stop sharing), the people bar, the
// "wants to join" toasts, the join screen of an invite link, the sync indicator and the notebook banners.

import { useEffect, useMemo, useState } from "react";
import { Dialog, FOCUS_RING } from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import { canManage, type MemberInfo, type Role } from "../sync/crypto";
import { colorOf, initials, type ShareView } from "../sync/manager";
import type { Peer } from "../sync/engine";
import { PRESENCE_TTL_MS } from "../sync/engine";
import { useT } from "../i18n";
import { useNotes } from "./hooks";
import { NotesIcon } from "./icons";

const BUTTON = `rounded border border-ui-border px-3 py-1 text-sm hover:bg-ui-hover disabled:opacity-50 ${FOCUS_RING}`;
const PRIMARY = `rounded bg-[var(--notes-accent)] px-3 py-1 text-sm text-white hover:brightness-110 disabled:opacity-50 ${FOCUS_RING}`;
const INPUT = "h-8 rounded border border-ui-border bg-ui-bg px-2 text-sm";

/** A person: the devices of one display name grouped (own devices appear under one name). */
export interface Person {
  name: string;
  role: Role;
  devices: MemberInfo[];
  me: boolean;
  online: boolean;
  color: string;
}

const ROLE_RANK: Record<Role, number> = { owner: 0, coOwner: 1, edit: 2, read: 3 };

/** Online devices: presence heard recently (this device always). */
function onlineDevices(view: ShareView, now: number): Set<string> {
  const s = new Set<string>();
  for (const p of view.peers) if (now - p.at < PRESENCE_TTL_MS) s.add(p.device);
  for (const m of view.members) if (m.me) s.add(m.device);
  return s;
}

export function people(view: ShareView, now = Date.now()): Person[] {
  const online = onlineDevices(view, now);
  const by = new Map<string, Person>();
  for (const m of view.members) {
    const key = m.me ? "\u0000me" : m.name;
    let p = by.get(key);
    if (!p) by.set(key, (p = { name: m.name, role: m.role, devices: [], me: m.me, online: false, color: colorOf(m.device) }));
    p.devices.push(m);
    if (ROLE_RANK[m.role] < ROLE_RANK[p.role]) p.role = m.role;
    if (online.has(m.device)) p.online = true;
    if (m.me) p.me = true;
  }
  return [...by.values()].sort((a, b) => Number(b.me) - Number(a.me) || ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.name.localeCompare(b.name));
}

function Avatar({ name, color, size = 26, online, title }: { name: string; color: string; size?: number; online?: boolean; title?: string }) {
  return (
    <span className="relative inline-flex shrink-0" title={title ?? name}>
      <span
        className="inline-flex items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-ui-panel"
        style={{ width: size, height: size, background: color }}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      {online !== undefined && (
        <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-ui-panel ${online ? "bg-green-500" : "bg-gray-400"}`} aria-hidden="true" />
      )}
    </span>
  );
}

function useTicker(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** The people bar (title area): who else is in this notebook right now. */
export function PeopleBar({ ctl }: { ctl: NotesController }) {
  const t = useT();
  const view = useNotes(ctl, (s) => (s.notebook ? s.shares[s.notebook] : undefined));
  const now = useTicker(5000);
  if (!view) return null;
  const list = people(view, now).filter((p) => p.online && !p.me);
  if (list.length === 0) return null;
  return (
    <div className="mr-1 flex items-center -space-x-1" data-testid="people-bar" aria-label={t("notes.share.peopleHere")} role="group">
      {list.slice(0, 5).map((p) => (
        <span key={p.name} data-testid="person" data-name={p.name}>
          <Avatar name={p.name} color={p.color} />
        </span>
      ))}
      {list.length > 5 && <span className="pl-2 text-xs text-ui-muted">+{list.length - 5}</span>}
    </div>
  );
}

/** The "Share" button top right. */
export function ShareButton({ ctl, onOpen }: { ctl: NotesController; onOpen: () => void }) {
  const t = useT();
  const notebook = useNotes(ctl, (s) => s.notebook);
  const shared = useNotes(ctl, (s) => !!(s.notebook && s.shares[s.notebook]));
  if (!notebook || !ctl.sync) return null;
  return (
    <button
      type="button"
      data-testid="share-button"
      className={`mr-1 inline-flex h-7 items-center gap-1.5 rounded px-2 text-sm ${shared ? "border border-ui-border hover:bg-ui-hover" : "bg-[var(--notes-accent)] text-white hover:brightness-110"} ${FOCUS_RING}`}
      onClick={onOpen}
    >
      <NotesIcon name="share" size={16} />
      {t("notes.share.button")}
    </button>
  );
}

/** Synced / Syncing / Offline / Error (status bar). */
export function SyncIndicator({ ctl }: { ctl: NotesController }) {
  const t = useT();
  const view = useNotes(ctl, (s) => (s.notebook ? s.shares[s.notebook] : undefined));
  if (!view) return null;
  const label =
    view.phase === "synced"
      ? t("notes.sync.synced")
      : view.phase === "syncing" || view.phase === "connecting"
        ? t("notes.sync.syncing")
        : view.phase === "offline"
          ? t("notes.sync.offline")
          : view.phase === "waiting"
            ? t("notes.sync.waiting")
            : view.phase === "removed"
              ? t("notes.sync.removed")
              : view.phase === "stopped"
                ? t("notes.sync.stopped")
                : t("notes.sync.error", { reason: errorText(t, view.error) });
  const dot = view.phase === "synced" ? "bg-green-500" : view.phase === "error" || view.phase === "removed" ? "bg-red-500" : view.phase === "offline" ? "bg-gray-400" : "bg-amber-500";
  return (
    <span data-testid="sync-state" data-state={view.phase} className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function errorText(t: (k: string, p?: Record<string, string | number>) => string, code: string | null): string {
  switch (code) {
    case "QuotaExceeded":
      return t("notes.sync.err.quota");
    case "Forbidden":
      return t("notes.sync.err.readOnly");
    case "Removed":
    case "NotMember":
      return t("notes.sync.err.removed");
    case "InviteUsed":
      return t("notes.sync.err.inviteUsed");
    case "TooLarge":
      return t("notes.sync.err.tooLarge");
    default:
      return code ?? t("notes.sync.err.unknown");
  }
}

/** Banners above the page: removed from the notebook, sharing stopped by the owner, read-only member. */
export function ShareBanner({ ctl }: { ctl: NotesController }) {
  const t = useT();
  const notebook = useNotes(ctl, (s) => s.notebook);
  const notice = useNotes(ctl, (s) => (s.notebook ? s.shareNotice[s.notebook] : undefined));
  const view = useNotes(ctl, (s) => (s.notebook ? s.shares[s.notebook] : undefined));
  if (!notebook) return null;
  const removed = notice === "removed" || view?.phase === "removed";
  const cls = "flex items-center gap-3 border-b px-3 py-1.5 text-sm";
  if (removed)
    return (
      <div role="status" data-testid="removed-banner" className={`${cls} border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100`}>
        <span className="flex-1">{t("notes.share.removedBanner")}</span>
      </div>
    );
  if (notice === "stopped")
    return (
      <div role="status" data-testid="stopped-banner" className={`${cls} border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100`}>
        <span className="flex-1">{t("notes.share.stoppedBanner")}</span>
        <button type="button" className={BUTTON} onClick={() => ctl.dismissShareNotice(notebook)}>
          {t("cmd.dismiss")}
        </button>
      </div>
    );
  if (view?.role === "read")
    return (
      <div role="status" data-testid="readonly-banner" className={`${cls} border-ui-border bg-ui-panel text-ui-muted`}>
        <span className="flex-1">{t("notes.share.readOnlyBanner")}</span>
      </div>
    );
  return null;
}

/** "Anna wants to join – Admit / Decline" (owners and co-owners). */
export function JoinRequestToasts({ ctl }: { ctl: NotesController }) {
  const t = useT();
  const requests = useNotes(ctl, (s) => s.joinRequests);
  const notebooks = useNotes(ctl, (s) => s.notebooks);
  if (requests.length === 0) return null;
  return (
    <div className="fixed bottom-10 right-4 z-50 flex w-80 flex-col gap-2" data-testid="join-toasts">
      {requests.map(({ localId, join }) => (
        <div key={join.inviteId} role="alert" className="rounded border border-ui-border bg-ui-panel p-3 text-sm shadow-lg" data-testid="join-toast">
          <p className="mb-2">
            {t("notes.share.wantsToJoin", { name: join.name || t("notes.share.someone"), notebook: notebooks.find((n) => n.summary.id === localId)?.summary.info.name ?? "" })}
            <span className="ml-1 text-ui-muted">({t(`notes.share.role.${join.role}`)})</span>
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={BUTTON} data-testid="join-decline" onClick={() => ctl.declineJoin(localId, join.inviteId)}>
              {t("notes.share.decline")}
            </button>
            <button type="button" className={PRIMARY} data-testid="join-admit" onClick={() => ctl.admitJoin(localId, join.inviteId)}>
              {t("notes.share.admit")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Asks for the display name (first share or join). */
function NameForm({ ctl, onDone, intro }: { ctl: NotesController; onDone?: () => void; intro: string }) {
  const t = useT();
  const profile = useNotes(ctl, (s) => s.profile);
  const [name, setName] = useState(profile?.name ?? "");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void ctl.setDisplayName(name).then(() => onDone?.());
      }}
    >
      <p className="text-sm">{intro}</p>
      <label className="flex flex-col gap-1 text-sm">
        {t("notes.share.yourName")}
        <input className={INPUT} data-testid="share-name" value={name} autoFocus maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="flex justify-end">
        <button type="submit" className={PRIMARY} data-testid="share-name-ok" disabled={!name.trim()}>
          {t("notes.share.continue")}
        </button>
      </div>
    </form>
  );
}

/** The join screen of an invite link: name, then "Waiting for Anna to let you in…". */
export function JoinOverlay({ ctl }: { ctl: NotesController }) {
  const t = useT();
  const joining = useNotes(ctl, (s) => Object.values(s.shares).find((v) => v.localId === ""));
  const profile = useNotes(ctl, (s) => s.profile);
  const [pending, setPending] = useState<string | null>(null);
  const phase = useNotes(ctl, (s) => s.phase);
  // An invite link opened: ask for the name first, then join.
  useEffect(() => {
    if (phase !== "ready") return;
    const go = () => {
      if (!/^#i=/.test(location.hash)) return;
      const hash = location.hash;
      history.replaceState(null, "", location.pathname + location.search);
      if (ctl.getState().profile?.name) void ctl.joinFromHash(hash);
      else setPending(hash);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [ctl, phase]);
  if (pending && !profile?.name)
    return (
      <Dialog open title={t("notes.share.joinTitle")} onClose={() => setPending(null)}>
        <div className="w-96" data-testid="join-name">
          <NameForm
            ctl={ctl}
            intro={t("notes.share.joinIntro")}
            onDone={() => {
              const h = pending;
              setPending(null);
              void ctl.joinFromHash(h);
            }}
          />
        </div>
      </Dialog>
    );
  if (!joining) return null;
  const who = joining.inviter || t("notes.share.theOwner");
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30" data-testid="join-waiting">
      <div className="flex w-96 flex-col gap-3 rounded border border-ui-border bg-ui-panel p-5 shadow-xl">
        <h2 className="text-lg font-semibold">{t("notes.share.joinTitle")}</h2>
        {joining.error ? (
          <p className="text-sm text-red-700 dark:text-red-300" data-testid="join-error">
            {errorText(t, joining.error)}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm" data-testid="join-wait-text">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-ui-border border-t-[var(--notes-accent)]" aria-hidden="true" />
            {joining.phase === "offline" ? t("notes.share.joinOffline") : joining.phase === "syncing" ? t("notes.share.joinLoading") : t("notes.share.waiting", { name: who })}
          </p>
        )}
        <div className="flex justify-end">
          <button type="button" className={BUTTON} onClick={() => void ctl.forgetShare(joining.notebook)}>
            {t("notes.share.cancelJoin")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Share › Share notebook. */
export function ShareDialog({ ctl, onClose }: { ctl: NotesController; onClose: () => void }) {
  const t = useT();
  const notebook = useNotes(ctl, (s) => s.notebook);
  const name = useNotes(ctl, (s) => s.notebooks.find((n) => n.summary.id === s.notebook)?.summary.info.name ?? "");
  const view = useNotes(ctl, (s) => (s.notebook ? s.shares[s.notebook] : undefined));
  const profile = useNotes(ctl, (s) => s.profile);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  return (
    <Dialog open title={t("notes.share.title", { name })} onClose={onClose}>
      <div className="flex w-[34rem] max-w-full flex-col gap-4 text-sm" data-testid="share-dialog">
        {!profile?.name ? (
          <NameForm ctl={ctl} intro={t("notes.share.nameIntro")} />
        ) : !view ? (
          <div className="flex flex-col gap-3">
            <p>{t("notes.share.offIntro")}</p>
            <p className="text-ui-muted">{t("notes.share.privacy")}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className={BUTTON} onClick={onClose}>
                {t("notes.close")}
              </button>
              <button
                type="button"
                className={PRIMARY}
                data-testid="share-on"
                disabled={busy || !notebook}
                onClick={() => {
                  setBusy(true);
                  void ctl.shareNotebook().finally(() => setBusy(false));
                }}
              >
                {t("notes.share.turnOn")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {canManage(view.role) && <InviteSection ctl={ctl} view={view} />}
            {canManage(view.role) && view.joins.length > 0 && <JoinsSection ctl={ctl} view={view} />}
            <MembersSection ctl={ctl} view={view} />
            {view.role === "owner" && (
              <section className="flex flex-col gap-2 border-t border-ui-border pt-3">
                {confirmStop ? (
                  <>
                    <p>{t("notes.share.stopConfirm")}</p>
                    <div className="flex justify-end gap-2">
                      <button type="button" className={BUTTON} onClick={() => setConfirmStop(false)}>
                        {t("notes.cancel")}
                      </button>
                      <button
                        type="button"
                        className={`${PRIMARY} bg-red-600`}
                        data-testid="share-stop-confirm"
                        onClick={() => {
                          setConfirmStop(false);
                          void ctl.stopSharing();
                        }}
                      >
                        {t("notes.share.stop")}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ui-muted">{t("notes.share.stopHint")}</span>
                    <button type="button" className={BUTTON} data-testid="share-stop" onClick={() => setConfirmStop(true)}>
                      {t("notes.share.stop")}
                    </button>
                  </div>
                )}
              </section>
            )}
            <div className="flex justify-end">
              <button type="button" className={BUTTON} onClick={onClose}>
                {t("notes.close")}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function InviteSection({ ctl, view }: { ctl: NotesController; view: ShareView }) {
  const t = useT();
  const [links, setLinks] = useState<{ role: Role | "self"; url: string }[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const make = (role: Role | "self") => {
    // Your other device gets your own management rights (owners' devices become co-owners).
    const r: Role = role === "self" ? (view.role === "owner" || view.role === "coOwner" ? "coOwner" : "edit") : role;
    const url = ctl.createInvite(r, view.localId);
    if (url) setLinks((l) => [{ role, url }, ...l.filter((x) => x.role !== role)]);
  };
  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(
      () => setCopied(url),
      () => setCopied(null),
    );
  };
  const kinds: (Role | "self")[] = ["edit", "read", "self"];
  return (
    <section className="flex flex-col gap-2" data-testid="share-invites">
      <h3 className="font-semibold">{t("notes.share.invite")}</h3>
      <p className="text-ui-muted">{t("notes.share.inviteHint")}</p>
      {kinds.map((k) => {
        const link = links.find((l) => l.role === k);
        return (
          <div key={k} className="flex flex-col gap-1" data-testid={`invite-${k}`}>
            <div className="flex items-center justify-between gap-2">
              <span>{t(`notes.share.link.${k}`)}</span>
              <button type="button" className={BUTTON} data-testid={`invite-create-${k}`} onClick={() => make(k)}>
                {link ? t("notes.share.anotherLink") : t("notes.share.createLink")}
              </button>
            </div>
            {link && (
              <div className="flex gap-2">
                <input className={`${INPUT} flex-1 font-mono text-xs`} readOnly value={link.url} data-testid={`invite-link-${k}`} onFocus={(e) => e.currentTarget.select()} aria-label={t(`notes.share.link.${k}`)} />
                <button type="button" className={BUTTON} data-testid={`invite-copy-${k}`} onClick={() => copy(link.url)}>
                  {copied === link.url ? t("notes.share.copied") : t("notes.share.copy")}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function JoinsSection({ ctl, view }: { ctl: NotesController; view: ShareView }) {
  const t = useT();
  return (
    <section className="flex flex-col gap-2" data-testid="share-joins">
      <h3 className="font-semibold">{t("notes.share.requests")}</h3>
      {view.joins.map((j) => (
        <div key={j.inviteId} className="flex items-center justify-between gap-2">
          <span>
            {j.name || t("notes.share.someone")} <span className="text-ui-muted">({t(`notes.share.role.${j.role}`)})</span>
          </span>
          <span className="flex gap-2">
            <button type="button" className={BUTTON} onClick={() => ctl.declineJoin(view.localId, j.inviteId)}>
              {t("notes.share.decline")}
            </button>
            <button type="button" className={PRIMARY} data-testid="share-admit" onClick={() => ctl.admitJoin(view.localId, j.inviteId)}>
              {t("notes.share.admit")}
            </button>
          </span>
        </div>
      ))}
    </section>
  );
}

function MembersSection({ ctl, view }: { ctl: NotesController; view: ShareView }) {
  const t = useT();
  const now = useTicker(5000);
  const list = useMemo(() => people(view, now), [view, now]);
  const [removing, setRemoving] = useState<Person | null>(null);
  const manager = canManage(view.role);
  const managers = view.members.filter((m) => m.role === "owner" || m.role === "coOwner");
  const lonely = manager && new Set(managers.map((m) => m.name)).size < 2;
  return (
    <section className="flex flex-col gap-2" data-testid="share-members">
      <h3 className="font-semibold">{t("notes.share.members")}</h3>
      <ul className="flex flex-col gap-1">
        {list.map((p) => {
          // Owners may change everyone else; co-owners only non-owners (notes-sync rule 5).
          const editable = manager && !p.me && p.role !== "owner" && !(view.role === "coOwner" && p.role === "coOwner");
          return (
            <li key={`${p.me}-${p.name}`} className="flex items-center gap-2" data-testid="member" data-name={p.name}>
              <Avatar name={p.name} color={p.color} online={p.online} title={p.online ? t("notes.share.online") : t("notes.share.notOnline")} />
              <span className="flex-1 truncate">
                {p.name || t("notes.share.someone")}
                {p.me && <span className="ml-1 text-ui-muted">({t("notes.share.you")})</span>}
                <span className="ml-2 text-xs text-ui-muted">{t("notes.share.devices", { count: p.devices.length })}</span>
              </span>
              {editable ? (
                <>
                  <select
                    className="h-7 rounded border border-ui-border bg-ui-bg px-1"
                    aria-label={t("notes.share.roleOf", { name: p.name })}
                    data-testid="member-role"
                    value={p.role}
                    onChange={(e) => {
                      for (const d of p.devices) ctl.setMemberRole(view.localId, d.device, e.target.value as Role);
                    }}
                  >
                    {view.role === "owner" && <option value="coOwner">{t("notes.share.role.coOwner")}</option>}
                    <option value="edit">{t("notes.share.role.edit")}</option>
                    <option value="read">{t("notes.share.role.read")}</option>
                  </select>
                  <button type="button" className={BUTTON} data-testid="member-remove" onClick={() => setRemoving(p)}>
                    {t("notes.share.remove")}
                  </button>
                </>
              ) : (
                <span className="text-ui-muted" data-testid="member-role-label">
                  {t(`notes.share.role.${p.role}`)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {lonely && <p className="rounded bg-ui-hover p-2 text-xs" data-testid="share-coowner-hint">{t("notes.share.coOwnerHint")}</p>}
      {removing && (
        <div className="flex flex-col gap-2 rounded border border-red-300 p-2 dark:border-red-800" data-testid="member-remove-confirm">
          <p>{t("notes.share.removeExplain", { name: removing.name })}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={BUTTON} onClick={() => setRemoving(null)}>
              {t("notes.cancel")}
            </button>
            <button
              type="button"
              className={`${PRIMARY} bg-red-600`}
              data-testid="member-remove-ok"
              onClick={() => {
                for (const d of removing.devices) ctl.removeMember(view.localId, d.device);
                setRemoving(null);
              }}
            >
              {t("notes.share.remove")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Peers on a page (navigation dots). */
export function peersOn(view: ShareView | undefined, page: string | null | undefined, now = Date.now()): Peer[] {
  if (!view || !page) return [];
  return view.peers.filter((p) => p.page === page && now - p.at < PRESENCE_TTL_MS);
}
