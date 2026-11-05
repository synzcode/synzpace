"use client";

import { privateDestination } from "./destinations";
export type SessionDTO = { user: { id: string; email: string; name: string }; session: { expiresAt: string; absoluteExpiresAt: string; renewAfter: string }; serverNow: string };
type Intent = { id: string; scope: "device" | "all" };
type Snapshot = { status: "loading" | "ready" | "expired" | "restricted" | "locked"; dto: SessionDTO | null; intents: Intent[]; storageUnavailable: boolean; message: string; busy: boolean };
/** Keep the draft controller in memory outside the gated view lifetime. */
export type PrivateWork = { hasDraft: () => boolean; copyDraft: () => Promise<void>; clear: () => void; pause: () => void };
const prefix = "synzspace.auth.pending-sign-out.";
const initial: Snapshot = { status: "loading", dto: null, intents: [], storageUnavailable: false, message: "Checking private access…", busy: false };
function validDTO(value: unknown): value is SessionDTO {
  if (!value || typeof value !== "object") return false;
  const data = value as SessionDTO;
  return typeof data.user?.id === "string" && typeof data.user.email === "string" && typeof data.user.name === "string" && [data.serverNow, data.session?.expiresAt, data.session?.absoluteExpiresAt, data.session?.renewAfter].every(value => typeof value === "string" && Number.isFinite(Date.parse(value)));
}

class AuthController {
  private snapshot: Snapshot = initial;
  private listeners = new Set<() => void>();
  private work = new Set<PrivateWork>();
  private memory = new Map<string, Intent>();
  private generation = 0;
  private ownerId: string | undefined;
  private inFlight: { generation: number; operation: Promise<void> } | undefined;
  private revoking = new Set<string>();
  private channel: BroadcastChannel | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private users = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => initial;
  private set(patch: Partial<Snapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(listener => listener()); }
  private pause(message: string, status: Snapshot["status"] = "locked") {
    this.generation++; this.work.forEach(work => work.pause()); this.set({ dto: null, status, message });
  }
  canRender = () => {
    if (typeof window === "undefined" || this.memory.size || this.snapshot.storageUnavailable) return false;
    try { for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith(prefix)) return false; return true; }
    catch { return false; }
  };
  private scan(probe = false): boolean {
    try {
      if (probe) { const key = `synzspace.auth.storage-probe.${crypto.randomUUID()}`; localStorage.setItem(key, JSON.stringify({ scope: "all" })); localStorage.removeItem(key); }
      const intents = new Map(this.memory);
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        let scope: Intent["scope"] = "all";
        try { const value = JSON.parse(localStorage.getItem(key) ?? "null"); if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && value.scope === "device") scope = "device"; } catch { /* Corrupt records require global confirmation. */ }
        const id = key.slice(prefix.length); intents.set(id, { id, scope });
      }
      const sorted = [...intents.values()].sort((a, b) => a.scope === b.scope ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.scope === "all" ? -1 : 1);
      if (JSON.stringify(sorted) !== JSON.stringify(this.snapshot.intents)) {
        this.generation++; this.work.forEach(work => work.pause());
        this.set({ intents: sorted, ...(sorted.length ? { dto: null, status: "locked" as const, message: "Sign out is awaiting confirmation. Retry each pending action to continue." } : {}) });
      }
      if (this.snapshot.storageUnavailable) this.set({ storageUnavailable: false });
      return sorted.length === 0;
    } catch {
      this.pause("Browser storage must be available before your private dashboard can open.");
      const pending = new Map(this.snapshot.intents.map(intent => [intent.id, intent]));
      this.memory.forEach((intent, id) => pending.set(id, intent));
      this.set({ storageUnavailable: true, intents: [...pending.values()].sort((a, b) => a.scope === b.scope ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.scope === "all" ? -1 : 1) }); return false;
    }
  }
  private event = (event?: Event) => { if (event instanceof StorageEvent && event.key && !event.key.startsWith(prefix)) return; if (document.visibilityState === "visible") void this.refresh(); else this.scan(); };
  start() {
    if (++this.users === 1) {
      for (const name of ["focus", "online", "storage"]) window.addEventListener(name, this.event);
      document.addEventListener("visibilitychange", this.event);
      try { this.channel = new BroadcastChannel("synzspace.auth"); this.channel.onmessage = event => { if (event.data === "auth-changed") this.event(); }; } catch { /* Storage and focus remain available. */ }
      this.timer = setInterval(this.event, 60000);
      if (this.scan(true)) void this.refresh();
    }
    return () => {
      if (--this.users !== 0) return;
      for (const name of ["focus", "online", "storage"]) window.removeEventListener(name, this.event);
      document.removeEventListener("visibilitychange", this.event);
      clearInterval(this.timer); this.channel?.close(); this.channel = undefined;
      this.generation++; this.set({ status: "loading", dto: null });
    };
  }
  registerWork(work: PrivateWork) { this.work.add(work); return () => { this.work.delete(work); }; }
  hasDraft = () => [...this.work].some(work => work.hasDraft());
  copyDraft = async () => { for (const work of this.work) if (work.hasDraft()) await work.copyDraft(); };
  private denied(status: number) { this.pause(status === 403 ? "This account cannot open your private dashboard." : "Your session ended. Sign in in another tab to continue.", status === 403 ? "restricted" : "expired"); }
  refresh = (): Promise<void> => {
    if (!this.scan(true)) return Promise.resolve();
    const generation = this.generation;
    // Cleanup or a pending intent can invalidate a request before it settles.
    if (this.inFlight?.generation === generation) return this.inFlight.operation;
    const operation = (async () => {
      try {
        let response = await fetch("/api/account/session", { cache: "no-store", credentials: "same-origin" });
        if (!this.scan() || this.generation !== generation) return;
        if (response.status === 401 || response.status === 403) { this.denied(response.status); return; }
        let envelope = await response.json();
        if (!response.ok || !validDTO(envelope.data)) throw new Error();
        let dto: SessionDTO = envelope.data;
        if (document.visibilityState === "visible" && Date.parse(dto.serverNow) >= Date.parse(dto.session.renewAfter)) {
          if (!this.scan() || this.generation !== generation) return;
          response = await fetch("/api/account/session/renew", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store", credentials: "same-origin" });
          if (!this.scan() || this.generation !== generation) return;
          if (response.status === 401 || response.status === 403) { this.denied(response.status); return; }
          envelope = await response.json();
          if (!response.ok || !validDTO(envelope.data)) throw new Error();
          dto = envelope.data;
        }
        if (!this.scan() || this.generation !== generation) return;
        if (this.ownerId && dto.user.id !== this.ownerId) { this.denied(403); return; }
        this.ownerId = dto.user.id; this.set({ status: "ready", dto, message: "", busy: false });
      } catch { if (this.generation === generation) this.pause("Private access could not be checked. Your draft remains in this tab. Try again."); }
    })();
    this.inFlight = { generation, operation };
    void operation.finally(() => { if (this.inFlight?.operation === operation) this.inFlight = undefined; });
    return operation;
  };
  signIn = () => {
    const target = privateDestination(window.location.pathname + window.location.search, window.location.origin);
    window.open(`/sign-in?returnTo=${encodeURIComponent(target)}`, "_blank", "noopener");
  };
  signOut = async (scope: Intent["scope"], existingId?: string) => {
    const id = existingId ?? crypto.randomUUID();
    if (this.revoking.has(id)) return;
    const existing = this.snapshot.intents.find(intent => intent.id === id);
    if (existing) scope = existing.scope;
    const intent = { id, scope };
    this.memory.set(id, intent);
    this.pause("Signing out. Private access is locked until completion is confirmed.");
    try { if (localStorage.getItem(prefix + id) === null) localStorage.setItem(prefix + id, JSON.stringify({ scope })); }
    catch { this.set({ storageUnavailable: true }); }
    this.scan(); this.revoking.add(id); this.set({ busy: true });
    try {
      const response = await fetch(scope === "all" ? "/api/account/sign-out-all" : "/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: scope === "all" ? JSON.stringify({ confirmed: true }) : "{}", cache: "no-store", credentials: "same-origin" });
      const value = await response.json();
      if (!response.ok || (scope === "all" ? value.data?.signedOut !== true : value.success !== true)) {
        this.set({ message: scope === "all" && response.status === 401 ? "Sign in in another tab, then confirm signing out all devices again. Access stays locked." : "Sign out did not confirm completion. Retry this action. Access stays locked." });
        return;
      }
      this.work.forEach(work => work.clear()); this.ownerId = undefined;
      try { localStorage.removeItem(prefix + id); this.memory.delete(id); }
      catch { this.set({ storageUnavailable: true, message: "Sign out succeeded, but browser storage must recover before this pending record can be cleared. Retry safely." }); return; }
      this.channel?.postMessage("auth-changed");
      this.scan();
      // A full navigation clears the old router content after confirmed sign out.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/sign-in");
    } catch { this.set({ message: "The sign out result is uncertain. Retry this action. Access stays locked." }); }
    finally { this.revoking.delete(id); this.set({ busy: this.revoking.size > 0 }); }
  };
  async privateJSON(input: string, init?: RequestInit): Promise<unknown> {
    const generation = this.generation;
    const response = await this.privateFetch(input, init);
    const value: unknown = await response.json();
    if (!this.scan() || generation !== this.generation) throw new Error("Private response discarded.");
    return value;
  }
  private async privateFetch(input: string, init?: RequestInit): Promise<Response> {
    const url = new URL(input, location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) throw new Error("Private request destination unavailable.");
    if (!this.scan() || this.snapshot.status !== "ready") throw new Error("Private access is paused.");
    const generation = this.generation;
    const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
    if (!this.scan() || generation !== this.generation) throw new Error("Private response discarded.");
    if (response.status === 401 || response.status === 403) this.denied(response.status);
    return response;
  }
}
export const authController = new AuthController();
