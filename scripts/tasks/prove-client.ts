import assert from "node:assert/strict";
import { authController } from "../../lib/auth/client";
import {
  TaskController,
  CreationRequest,
  observeResource,
  type TaskRecord,
} from "../../lib/tasks/client";
const tick = () => new Promise((resolve) => setImmediate(resolve));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const events = new EventTarget(),
    documentEvents = new EventTarget();
  let hidden = false;
  const window = {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  const document = {
    get visibilityState() {
      return hidden ? "hidden" : "visible";
    },
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener:
      documentEvents.removeEventListener.bind(documentEvents),
  };
  Object.defineProperties(globalThis, {
    window: { value: window, configurable: true },
    document: { value: document, configurable: true },
    localStorage: { value: { length: 0 }, configurable: true },
  });
  const saved: TaskRecord = {
    id: "proof-task",
    revision: 1,
    title: "Base",
    progress: 0,
    status: "todo",
    dueDate: null,
    description: null,
    descriptionVersion: 1,
    tags: [],
    trashedAt: null,
  };
  const envelope = (data: unknown) => ({
    data,
    meta: { requestId: "proof", serverNow: "2026-11-06T00:00:00Z" },
  });
  const original = authController.privateJSON;
  const snapshot = authController.getSnapshot;
  authController.getSnapshot = () => ({ ...snapshot(), status: "ready" });
  let writes = 0;
  let polls = 0;
  const pending: Array<{
    init?: RequestInit;
    resolve: (value: unknown) => void;
  }> = [];
  authController.privateJSON = async (_path, init) => {
    if (init?.method) writes++;
    else polls++;
    return new Promise((resolve) => pending.push({ init, resolve }));
  };
  const c = new TaskController(saved);
  let stop: (() => void) | undefined;
  try {
    c.start();
    assert.equal(polls, 1);
    const oldPoll = pending.shift()!;
    c.edit({ title: "First" });
    await wait(400);
    assert.equal(writes, 0);
    await wait(400);
    assert.equal(writes, 1);
    const first = pending.shift()!;
    assert.equal(c.state, "saving");
    c.edit({ title: "Newer" });
    first.resolve(envelope({ ...saved, title: "First", revision: 2 }));
    await tick();
    assert.equal(c.base.title, "First");
    assert.equal(c.draft.title, "Newer");
    oldPoll.resolve(envelope(saved));
    await tick();
    assert.equal(c.base.revision, 2);
    assert.notEqual(c.state, "conflicting");
    c.dispose();
    const secondSave = c.save();
    await tick();
    const failed = pending.find((p) => p.init?.method === "PATCH");
    assert(failed);
    const exact = String(failed.init!.body);
    failed.resolve({
      error: { code: "STORAGE_UNAVAILABLE" },
      meta: { requestId: "proof" },
    });
    await secondSave;
    assert.equal(c.state, "failed");
    c.edit({ title: "Newest" });
    await wait(800);
    assert.equal(writes, 2);
    const retry = c.retry();
    await tick();
    const repeated = pending.filter((p) => p.init?.method === "PATCH").at(-1)!;
    assert.equal(String(repeated.init!.body), exact);
    repeated.resolve(envelope({ ...saved, title: "Newer", revision: 3 }));
    await retry;
    assert.equal(c.draft.title, "Newest");
    assert.equal(c.state, "unsaved");
    c.receive({ ...saved, title: "Remote", revision: 4 });
    assert.equal(c.state, "conflicting");
    assert.equal(c.draft.title, "Newest");
    assert.equal(c.base.revision, 3);
    c.reapply();
    assert.equal(c.base.revision, 4);
    assert.equal(c.draft.title, "Newest");
    c.dispose();
    const create = new CreationRequest("/api/tasks", { title: "Create once" });
    const one = create.submit();
    await tick();
    const firstCreate = pending.at(-1)!;
    firstCreate.resolve({
      error: { code: "STORAGE_UNAVAILABLE" },
      meta: { requestId: "proof" },
    });
    await one;
    const two = create.submit();
    await tick();
    const secondCreate = pending.at(-1)!;
    assert.equal(
      String(firstCreate.init?.body),
      String(secondCreate.init?.body),
    );
    assert.deepEqual(firstCreate.init?.headers, secondCreate.init?.headers);
    secondCreate.resolve(envelope(saved));
    await two;
    assert.equal(create.state, "saved");
    hidden = true;
    const before = polls;
    stop = observeResource("/api/tasks/hidden", "task", () => {});
    assert.equal(polls, before);
    stop();
    stop = undefined;
    console.log(
      "Autosave debounce, newer typing preservation, stale poll rejection, exact failed request retry, conflict review and reapplication, stable creation keys, and hidden polling passed.",
    );
  } finally {
    c.dispose();
    stop?.();
    authController.privateJSON = original;
    authController.getSnapshot = snapshot;
  }
}
main().catch((error) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : "Client proof failed.",
  );
  process.exitCode = 1;
});
