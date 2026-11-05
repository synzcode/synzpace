import assert from "node:assert/strict";
import { authController } from "../../lib/auth/client";

async function main() {
  const data = new Map<string, string>();
  const storage = { get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); }, clear: () => data.clear() };
  const windowEvents = new EventTarget(); const documentEvents = new EventTarget();
  let hidden = false; let navigated = ""; let opened = "";
  const location = { origin: "http://localhost:3000", pathname: "/account/access", search: "?a=1&a=2&_rsc=transport", assign: (target: string) => { navigated = target; } };
  const window = { addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents), location, open: (url: string) => { opened = url; return null; } };
  const document = { get visibilityState() { return hidden ? "hidden" : "visible"; }, addEventListener: documentEvents.addEventListener.bind(documentEvents), removeEventListener: documentEvents.removeEventListener.bind(documentEvents) };
  for (const [key, value] of Object.entries({ window, document, localStorage: storage, location, StorageEvent: class extends Event { key: string | null = null; } })) Object.defineProperty(globalThis, key, { value, configurable: true });
  const originalFetch = globalThis.fetch;
  let requests = 0;
  const dto = { user: { id: "owner", email: "private@example.invalid", name: "Owner" }, session: { expiresAt: "2030-01-30T00:00:00Z", absoluteExpiresAt: "2030-03-01T00:00:00Z", renewAfter: "2030-01-02T00:00:00Z" }, serverNow: "2030-01-01T00:00:00Z" };
  globalThis.fetch = async () => { requests++; return Response.json({ data: dto }); };
  let stop: (() => void) | undefined;
  const prefix = "synzspace.auth.pending-sign-out.";
  try {
    // AC-8, AC-14: effect cleanup and restart must not reuse an invalidated read.
    for (const staleFirst of [true, false]) {
      const pending: Array<(response: Response) => void> = [];
      globalThis.fetch = () => { requests++; return new Promise<Response>(resolve => { pending.push(resolve); }); };
      stop = authController.start();
      const abandoned = authController.refresh();
      stop();
      stop = authController.start();
      const current = authController.refresh();
      assert.equal(pending.length, 2, "A restarted gate must issue a fresh session request.");
      if (staleFirst) {
        pending[0](new Response(null, { status: 401 })); await abandoned;
        assert.equal(authController.getSnapshot().status, "loading", "An abandoned response must not update the restarted gate.");
        assert.equal(authController.refresh(), current, "An abandoned request must not clear the current request.");
        assert.equal(pending.length, 2, "Concurrent checks in the current lifecycle must share its request.");
      }
      pending[1](Response.json({ data: dto })); await current;
      assert.equal(authController.getSnapshot().status, "ready", "A restarted gate must become ready without a heartbeat or manual retry.");
      if (!staleFirst) {
        pending[0](new Response(null, { status: 401 })); await abandoned;
        assert.equal(authController.getSnapshot().status, "ready", "A late abandoned response must not replace the current session.");
      }
      stop(); stop = undefined;
    }
    // One remaining gate still owns the shared startup request.
    let releaseShared!: (response: Response) => void;
    globalThis.fetch = () => { requests++; return new Promise<Response>(resolve => { releaseShared = resolve; }); };
    const stopFirst = authController.start();
    stop = authController.start();
    const shared = authController.refresh();
    stopFirst();
    assert.equal(authController.refresh(), shared);
    releaseShared(Response.json({ data: dto })); await shared;
    assert.equal(authController.getSnapshot().status, "ready");
    stop(); stop = undefined;
    requests = 0;
    globalThis.fetch = async () => { requests++; return Response.json({ data: dto }); };
    storage.setItem(prefix + "all", JSON.stringify({ scope: "all" }));
    stop = authController.start();
    await authController.refresh(); assert.equal(requests, 0); assert.equal(authController.canRender(), false);
    storage.removeItem(prefix + "all");
    await authController.refresh(); assert.equal(requests, 1); assert.equal(authController.getSnapshot().status, "ready");
    authController.signIn(); assert.equal(opened, "/sign-in?returnTo=%2Faccount%2Faccess%3Fa%3D1%26a%3D2");
    hidden = true; documentEvents.dispatchEvent(new Event("visibilitychange")); assert.equal(requests, 1); hidden = false;
    let release!: (response: Response) => void;
    globalThis.fetch = () => { requests++; return new Promise<Response>(resolve => { release = resolve; }); };
    const late = authController.refresh();
    storage.setItem(prefix + "all", JSON.stringify({ scope: "all" }));
    await authController.refresh(); release(Response.json({ data: dto })); await late;
    assert.equal(authController.getSnapshot().dto, null); assert.equal(authController.getSnapshot().status, "locked");
    storage.setItem(prefix + "device", JSON.stringify({ scope: "device" })); await authController.refresh();
    globalThis.fetch = async () => Response.json({ success: true });
    await authController.signOut("device", "device");
    assert.equal(storage.getItem(prefix + "device"), null); assert.notEqual(storage.getItem(prefix + "all"), null); assert.equal(navigated, "/sign-in");
    globalThis.fetch = async (input, init) => { assert.equal(input, "/api/account/sign-out-all"); assert.equal(init?.body, '{"confirmed":true}'); return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }); };
    await authController.signOut("device", "all");
    assert.notEqual(storage.getItem(prefix + "all"), null); assert.equal(authController.getSnapshot().status, "locked");
    storage.setItem(prefix + "corrupt", "not json"); await authController.refresh();
    assert.equal(authController.getSnapshot().intents.find(intent => intent.id === "corrupt")?.scope, "all");
    const oldKey = storage.key;
    storage.key = () => { throw new Error("Storage unavailable"); };
    const beforeBlocked = requests;
    await authController.refresh(); assert.equal(requests, beforeBlocked); assert.equal(authController.getSnapshot().storageUnavailable, true);
    globalThis.fetch = async () => Response.json({ error: { code: "STORAGE_UNAVAILABLE" } }, { status: 503 });
    await authController.signOut("device", "memory-intent");
    assert(authController.getSnapshot().intents.some(intent => intent.id === "memory-intent"));
    assert.equal(authController.canRender(), false); storage.key = oldKey;
    console.log("Client gate proof passed: effect restart checks a fresh session without waiting; abandoned responses cannot replace or clear the current check; shared gates retain their request; pending intents block startup fetches and rendering; hidden tabs send no heartbeat; late reads cannot unlock; older device completion preserves a global intent; global retry cannot downgrade; corrupt intents stay locked.");
  } finally { stop?.(); globalThis.fetch = originalFetch; }
}
main().catch(error => { console.error("Client gate proof failed:", error instanceof assert.AssertionError ? error.message : error instanceof Error ? error.name : "Unknown error"); process.exitCode = 1; });
