"use client";
import { authController } from "@/lib/auth/client";
import { canonicalJSON, dueDate, statusFor, text } from "./validation";
import { canonicalizeDescriptionV1 } from "./rich-text";
export type TagLabel = { id: string; name: string; revision: number };
export type SavedRecord = {
  id: string;
  revision: number;
  [key: string]: unknown;
};
export type TaskRecord = SavedRecord & {
  title: string;
  progress: number;
  status: string;
  dueDate: string | null;
  description: unknown;
  descriptionVersion: number;
  tags: TagLabel[];
  trashedAt: string | null;
};
type Envelope = {
  data?: unknown;
  error?: {
    code: string;
    latest?: { kind: string; record: SavedRecord };
    fields?: Record<string, string>;
  };
  meta?: { requestId: string; serverNow?: string };
};
export class RequestFailure extends Error {
  constructor(
    public code: string,
    public latest?: SavedRecord,
    public fields?: Record<string, string>,
  ) {
    super(code);
  }
}
function record(value: unknown): value is SavedRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as SavedRecord;
  return (
    typeof r.id === "string" && Number.isInteger(r.revision) && r.revision > 0
  );
}
function validTask(value: unknown): value is TaskRecord {
  if (!record(value)) return false;
  const r = value as TaskRecord;
  return (
    typeof r.title === "string" &&
    typeof r.progress === "number" &&
    Number.isInteger(r.progress) &&
    r.progress >= 0 &&
    r.progress <= 100 &&
    r.status === statusFor(r.progress) &&
    (r.dueDate === null || typeof r.dueDate === "string") &&
    Array.isArray(r.tags) &&
    r.tags.every(
      (t) =>
        typeof t.id === "string" &&
        typeof t.name === "string" &&
        Number.isInteger(t.revision),
    ) &&
    Number.isInteger(r.descriptionVersion) &&
    "description" in r &&
    (r.trashedAt === null || typeof r.trashedAt === "string")
  );
}
async function request(path: string, init?: RequestInit): Promise<Envelope> {
  const value = (await authController.privateJSON(path, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(15000),
  })) as Envelope;
  if (
    !value ||
    typeof value !== "object" ||
    !value.meta ||
    typeof value.meta.requestId !== "string"
  )
    throw new RequestFailure("MALFORMED_RESPONSE");
  if (value.error)
    throw new RequestFailure(
      value.error.code,
      value.error.latest?.record,
      value.error.fields,
    );
  if (
    !("data" in value) ||
    typeof value.meta.serverNow !== "string" ||
    Number.isNaN(Date.parse(value.meta.serverNow))
  )
    throw new RequestFailure("MALFORMED_RESPONSE");
  const data = value.data as {
    items?: unknown[];
    nextCursor?: unknown;
    deleted?: boolean;
    id?: unknown;
  } | null;
  if (!data || typeof data !== "object")
    throw new RequestFailure("MALFORMED_RESPONSE");
  if ("items" in data) {
    if (
      !Array.isArray(data.items) ||
      !data.items.every(record) ||
      !(data.nextCursor === null || typeof data.nextCursor === "string")
    )
      throw new RequestFailure("MALFORMED_RESPONSE");
  } else if (data.deleted === true) {
    if (typeof data.id !== "string")
      throw new RequestFailure("MALFORMED_RESPONSE");
  } else if (!record(data)) throw new RequestFailure("MALFORMED_RESPONSE");
  return value;
}
const floors = new Map<string, number>();
const labels = new Map<string, TagLabel>();
export function currentTag(id: string) {
  return labels.get(id);
}
function entities(value: unknown, kind: string): boolean {
  const visit = (r: SavedRecord, k: string) => {
    if (k === "tag" && typeof r.name === "string") {
      const old = labels.get(r.id);
      if (!old || old.revision < r.revision)
        labels.set(r.id, { id: r.id, name: r.name, revision: r.revision });
    }
    const key = k + ":" + r.id;
    if (Number(r.revision) < (floors.get(key) ?? 0)) return false;
    if (Array.isArray(r.tags))
      for (const t of r.tags as TagLabel[]) {
        if (!labels.has(t.id) || labels.get(t.id)!.revision < t.revision)
          labels.set(t.id, t);
      }
    return true;
  };
  const all = record(value)
    ? [value]
    : value && typeof value === "object" && "items" in value
      ? (value as { items: unknown[] }).items
      : [];
  if (!Array.isArray(all) || !all.every((r) => record(r) && visit(r, kind)))
    return false;
  for (const r of all as SavedRecord[])
    floors.set(kind + ":" + r.id, r.revision);
  return true;
}
type ReadState = { data: unknown; error: string | null; loading: boolean };
class Resource {
  state: ReadState = { data: null, error: null, loading: false };
  listeners = new Set<() => void>();
  generation = 0;
  sequence = 0;
  controller?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  delay = 3000;
  failures = 0;
  running = false;
  constructor(
    public path: string,
    public kind: string,
  ) {}
  emit() {
    this.listeners.forEach((f) => f());
  }
  reset() {
    this.generation++;
    this.controller?.abort();
    clearTimeout(this.timer);
    this.state = { ...this.state, loading: false };
  }
  async refresh() {
    clearTimeout(this.timer);
    if (
      this.running ||
      !this.listeners.size ||
      document.visibilityState === "hidden" ||
      writes ||
      !accessReady()
    )
      return;
    const generation = this.generation,
      sequence = ++this.sequence;
    this.running = true;
    this.controller = new AbortController();
    this.state = { ...this.state, loading: true };
    this.emit();
    const timeout = setTimeout(() => this.controller?.abort(), 15000);
    try {
      const result = await request(this.path, {
        signal: this.controller.signal,
      });
      if (generation !== this.generation || sequence !== this.sequence) return;
      if (!entities(result.data, this.kind))
        throw new RequestFailure("STALE_READ");
      this.state = { data: result.data, error: null, loading: false };
      this.delay = 3000;
      this.failures = 0;
      this.emit();
    } catch (error) {
      if (generation === this.generation) {
        this.state = {
          ...this.state,
          ...(error instanceof RequestFailure &&
          ["NOT_FOUND", "RESOURCE_EXPIRED", "CREATION_GONE"].includes(
            error.code,
          )
            ? { data: null }
            : {}),
          error:
            error instanceof RequestFailure ? error.code : "CONNECTION_FAILED",
          loading: false,
        };
        this.emit();
        this.delay = Math.min(3000 * 2 ** this.failures++, 30000);
      }
    } finally {
      clearTimeout(timeout);
      this.running = false;
      if (
        this.listeners.size &&
        String(document.visibilityState) !== "hidden" &&
        accessReady()
      )
        this.timer = setTimeout(
          () => void this.refresh(),
          generation !== this.generation
            ? 0
            : this.state.error
              ? this.delay
              : 3000,
        );
    }
  }
}
function accessReady() {
  return (
    authController.getSnapshot().status === "ready" &&
    authController.canRender()
  );
}
const resources = new Map<string, Resource>();
let writes = 0;
let installed = false;
function invalidate() {
  for (const resource of resources.values()) resource.reset();
}
function refreshAll() {
  for (const resource of resources.values()) void resource.refresh();
}
function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const wake = () => {
    for (const r of resources.values()) {
      r.delay = 3000;
      r.failures = 0;
      void r.refresh();
    }
  };
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden")
      for (const r of resources.values()) r.reset();
    else wake();
  });
  authController.subscribe(() => {
    if (!accessReady()) invalidate();
    else wake();
  });
}
export function observeResource(
  path: string,
  kind: "task" | "tag" | "comment",
  listener: (state: ReadState) => void,
) {
  install();
  let r = resources.get(path);
  if (!r) {
    r = new Resource(path, kind);
    resources.set(path, r);
  }
  const resource = r;
  const callback = () => listener(resource.state);
  resource.listeners.add(callback);
  callback();
  void resource.refresh();
  return () => {
    resource.listeners.delete(callback);
    if (!resource.listeners.size) {
      resource.reset();
      resources.delete(path);
    }
  };
}
export function refreshResource(path: string) {
  const r = resources.get(path);
  if (r) {
    r.delay = 3000;
    r.failures = 0;
    void r.refresh();
  }
}
export type PageData = { items: SavedRecord[]; nextCursor: string | null };
export class LivePage {
  data: PageData = { items: [], nextCursor: null };
  error: string | null = null;
  loading = false;
  cursor: string | null = null;
  history: (string | null)[] = [];
  private stop?: () => void;
  constructor(
    public path: string,
    public kind: "task" | "tag" | "comment",
    public changed: () => void,
  ) {}
  start() {
    this.stop?.();
    const url =
      this.path +
      (this.path.includes("?") ? "&" : "?") +
      (this.cursor ? "cursor=" + encodeURIComponent(this.cursor) : "");
    this.stop = observeResource(url, this.kind, (state) => {
      this.error = state.error;
      this.loading = state.loading;
      if (state.data) {
        const page = state.data as PageData;
        if (
          !Array.isArray(page.items) ||
          !(page.nextCursor === null || typeof page.nextCursor === "string")
        )
          return;
        if (!page.items.length && this.cursor) {
          this.fromStart();
          return;
        }
        this.data = page;
      }
      this.changed();
    });
  }
  next() {
    if (this.data.nextCursor) {
      this.history.push(this.cursor);
      this.cursor = this.data.nextCursor;
      this.start();
    }
  }
  previous() {
    if (this.history.length) {
      this.cursor = this.history.pop()!;
      this.start();
    }
  }
  fromStart() {
    this.cursor = null;
    this.history = [];
    this.start();
  }
  dispose() {
    this.stop?.();
  }
}
const pages = new Set<LivePage>();
export function displayPage(page: LivePage) {
  pages.add(page);
  page.start();
  return () => {
    pages.delete(page);
    page.dispose();
  };
}
async function mutation(
  path: string,
  method: string,
  body: unknown,
  key?: string,
) {
  writes++;
  invalidate();
  try {
    const result = await request(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: JSON.stringify(body),
    });
    if (record(result.data))
      entities(
        result.data,
        path.includes("/comments")
          ? "comment"
          : path.startsWith("/api/tags")
            ? "tag"
            : "task",
      );
    return result;
  } finally {
    writes--;
    invalidate();
    refreshAll();
  }
}
export type SaveState =
  | "saved"
  | "unsaved"
  | "saving"
  | "invalid"
  | "failed"
  | "conflicting";
type Pending = {
  path: string;
  method: string;
  body: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  permanent?: boolean;
};
export class TaskController {
  base: TaskRecord;
  unavailable: string | null = null;
  draft: Record<string, unknown> = {};
  latest: TaskRecord | null = null;
  state: SaveState = "saved";
  error: string | null = null;
  fields?: Record<string, string>;
  inFlight: Pending | null = null;
  private busy = false;
  private timer?: ReturnType<typeof setTimeout>;
  private stop?: () => void;
  private unregister?: () => void;
  private unwatch?: () => void;
  private disposed = false;
  private authPaused = false;
  constructor(
    base: TaskRecord,
    public changed: () => void = () => {},
  ) {
    this.base = base;
  }
  get dirty() {
    return Object.keys(this.draft).length > 0;
  }
  get savedView() {
    return this.unavailable ? null : this.base;
  }
  start() {
    this.disposed = false;
    this.stop = observeResource("/api/tasks/" + this.base.id, "task", (s) => {
      if (
        s.error &&
        ["NOT_FOUND", "RESOURCE_EXPIRED", "CREATION_GONE"].includes(s.error)
      ) {
        this.unavailable = s.error;
        this.error = s.error;
        this.state = "failed";
        clearTimeout(this.timer);
        this.changed();
      } else if (s.data && validTask(s.data)) {
        this.unavailable = null;
        this.receive(s.data);
      }
    });
    this.unregister = authController.registerWork({
      hasDraft: () => this.dirty || !!this.inFlight,
      copyDraft: () => this.copy(),
      pause: () => {
        this.authPaused = true;
        clearTimeout(this.timer);
      },
      clear: () => {
        this.draft = {};
        this.inFlight = null;
        this.latest = null;
        this.stop?.();
        this.base = {
          id: "",
          revision: 0,
          title: "",
          progress: 0,
          status: "todo",
          dueDate: null,
          description: null,
          descriptionVersion: 1,
          tags: [],
          trashedAt: null,
        };
        clearPrivateData();
        this.changed();
      },
    });
    this.unwatch = authController.subscribe(() => {
      if (accessReady() && this.authPaused) {
        this.authPaused = false;
        this.schedule();
      }
    });
    window.addEventListener("beforeunload", this.leaving);
  }
  private leaving = (event: BeforeUnloadEvent) => {
    if (this.dirty || this.inFlight) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.stop?.();
    this.unregister?.();
    this.unwatch?.();
    window.removeEventListener("beforeunload", this.leaving);
  }
  private validate() {
    try {
      if ("title" in this.draft) text(this.draft.title, 200, "title");
      if ("dueDate" in this.draft) dueDate(this.draft.dueDate);
      if (
        "progress" in this.draft &&
        (!Number.isInteger(this.draft.progress) ||
          Number(this.draft.progress) < 0 ||
          Number(this.draft.progress) > 100)
      )
        throw new Error();
      if (
        "status" in this.draft &&
        !["todo", "in_progress", "done"].includes(String(this.draft.status))
      )
        throw new Error();
      if ("status" in this.draft && "progress" in this.draft) throw new Error();
      if ("description" in this.draft) {
        if (this.draft.descriptionVersion !== 1) throw new Error();
        canonicalizeDescriptionV1(this.draft.description);
      }
      return true;
    } catch {
      return false;
    }
  }
  edit(patch: Record<string, unknown>) {
    if ("status" in patch) delete this.draft.progress;
    if ("progress" in patch) delete this.draft.status;
    Object.assign(this.draft, patch);
    if (this.state !== "failed" && this.state !== "conflicting")
      this.state = this.validate() ? "unsaved" : "invalid";
    this.changed();
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (
      this.dirty &&
      !this.busy &&
      !this.authPaused &&
      !this.disposed &&
      this.state === "unsaved"
    )
      this.timer = setTimeout(() => void this.save(), 750);
  }
  receive(remote: TaskRecord) {
    // Labels can advance independently of the task revision and its dirty draft.
    if (remote.revision < this.base.revision || this.busy) return;
    this.base = {
      ...this.base,
      tags: remote.tags.map((t) => currentTag(t.id) ?? t),
    };
    if (this.dirty || this.inFlight) {
      if (remote.revision > this.base.revision) {
        this.latest = remote;
        if (this.state !== "failed") this.state = "conflicting";
        clearTimeout(this.timer);
      }
    } else {
      this.base = remote;
      this.state = "saved";
    }
    this.changed();
  }
  async save() {
    if (
      this.unavailable ||
      this.busy ||
      this.inFlight ||
      !this.dirty ||
      this.state === "failed" ||
      this.state === "conflicting" ||
      this.authPaused
    )
      return;
    if (!this.validate()) {
      this.state = "invalid";
      this.changed();
      return;
    }
    const snapshot = structuredClone(this.draft);
    this.inFlight = {
      path: "/api/tasks/" + this.base.id,
      method: "PATCH",
      body: { expectedRevision: this.base.revision, ...snapshot },
      snapshot,
    };
    await this.send();
  }
  async explicit(
    action: "trash" | "restore" | "permanent" | "tags",
    tagIds?: string[],
  ) {
    if (this.busy || this.inFlight || this.dirty || this.authPaused)
      throw new Error("Save or deliberately discard pending work first.");
    clearTimeout(this.timer);
    const path =
      "/api/tasks/" +
      this.base.id +
      (action === "trash" ? "" : action === "tags" ? "/tags" : "/" + action);
    this.inFlight = {
      path,
      method:
        action === "restore" ? "POST" : action === "tags" ? "PUT" : "DELETE",
      body: {
        expectedRevision: this.base.revision,
        ...(action === "permanent"
          ? { confirmed: true }
          : action === "tags"
            ? { tagIds }
            : {}),
      },
      snapshot: {},
      permanent: action === "permanent",
    };
    await this.send();
  }
  private async send() {
    if (!this.inFlight || this.busy || this.authPaused) return;
    const pending = this.inFlight;
    this.busy = true;
    this.state = "saving";
    this.changed();
    try {
      const result = await mutation(pending.path, pending.method, pending.body);
      if (pending.permanent) {
        const data = result.data as { id?: string; deleted?: boolean };
        if (data?.id !== this.base.id || data.deleted !== true)
          throw new RequestFailure("MALFORMED_RESPONSE");
        this.inFlight = null;
        this.state = "saved";
        this.stop?.();
      } else {
        if (
          !validTask(result.data) ||
          result.data.id !== this.base.id ||
          result.data.revision < this.base.revision
        )
          throw new RequestFailure("MALFORMED_RESPONSE");
        entities(result.data, "task");
        this.base = result.data;
        for (const k of Object.keys(pending.snapshot))
          if (
            canonicalJSON(this.draft[k]) === canonicalJSON(pending.snapshot[k])
          )
            delete this.draft[k];
        this.inFlight = null;
        this.latest = null;
        this.error = null;
        this.state = this.dirty
          ? this.validate()
            ? "unsaved"
            : "invalid"
          : "saved";
      }
      if (pending.method !== "PATCH")
        for (const page of pages) page.fromStart();
    } catch (error) {
      if (
        error instanceof RequestFailure &&
        error.code === "NOT_FOUND" &&
        pending.permanent
      ) {
        this.inFlight = null;
        this.state = "saved";
        this.stop?.();
      } else {
        this.error =
          error instanceof RequestFailure ? error.code : "CONNECTION_FAILED";
        this.fields =
          error instanceof RequestFailure ? error.fields : undefined;
        if (
          error instanceof RequestFailure &&
          error.code === "REVISION_CONFLICT" &&
          validTask(error.latest)
        ) {
          this.latest = error.latest;
          this.state = "conflicting";
        } else this.state = "failed";
      }
    } finally {
      this.busy = false;
      this.changed();
      this.schedule();
    }
  }
  async retry() {
    if (this.state === "failed" && this.inFlight && !this.authPaused)
      await this.send();
  }
  reapply() {
    if (!this.latest || this.busy || this.latest.trashedAt)
      throw new Error("Review an editable latest task before reapplying.");
    this.base = this.latest;
    this.latest = null;
    this.inFlight = null;
    this.error = null;
    this.state = this.validate() ? "unsaved" : "invalid";
    this.changed();
    this.schedule();
  }
  discard() {
    if (this.busy) throw new Error("Wait for the current request.");
    if (this.latest) this.base = this.latest;
    this.draft = {};
    this.latest = null;
    this.inFlight = null;
    this.error = null;
    this.state = "saved";
    clearTimeout(this.timer);
    this.changed();
  }
  copyText() {
    const value = { ...this.base, ...this.draft };
    const plain = (node: unknown): string => {
      if (!node || typeof node !== "object") return "";
      const n = node as { text?: string; content?: unknown[] };
      return n.text ?? (n.content ?? []).map(plain).join("\n");
    };
    return [
      String(value.title),
      "Progress: " + String(value.progress),
      "Due: " + (value.dueDate ?? "None"),
      plain(value.description),
    ]
      .filter(Boolean)
      .join("\n");
  }
  async copy() {
    const value = this.copyText();
    try {
      if (!navigator.clipboard) throw new Error();
      await navigator.clipboard.writeText(value);
    } catch {
      showCopyFallback(value);
      throw new Error("Select the draft text and copy it.");
    }
  }
  get unsupportedDescription() {
    return this.base.descriptionVersion !== 1;
  }
}
export class CreationRequest {
  readonly key = crypto.randomUUID();
  state: "unsaved" | "saving" | "saved" | "failed" = "unsaved";
  result: unknown;
  error: string | null = null;
  private unregister: () => void;
  private payload: unknown;
  private kind: "task" | "tag" | "comment";
  constructor(
    public path: string,
    payload: unknown,
  ) {
    this.payload = structuredClone(payload);
    this.kind = path.includes("/comments")
      ? "comment"
      : path.startsWith("/api/tags")
        ? "tag"
        : "task";
    this.unregister = registerDraft({
      hasDraft: () => this.state !== "saved",
      copyDraft: () => copyPlain(JSON.stringify(this.payload, null, 2)),
      pause: () => {},
      clear: () => {
        this.payload = null;
        this.result = null;
        clearPrivateData();
      },
    });
  }
  dispose() {
    this.unregister();
  }
  async submit() {
    if (this.state === "saving" || this.state === "saved") return;
    this.state = "saving";
    try {
      const result = await mutation(this.path, "POST", this.payload, this.key);
      if (
        !record(result.data) ||
        (this.kind === "task" && !validTask(result.data)) ||
        (this.kind === "tag" && typeof result.data.name !== "string") ||
        (this.kind === "comment" && typeof result.data.body !== "string")
      )
        throw new RequestFailure("MALFORMED_RESPONSE");
      this.result = result.data;
      this.state = "saved";
      for (const page of pages) page.fromStart();
    } catch (error) {
      this.state = "failed";
      this.error =
        error instanceof RequestFailure ? error.code : "CONNECTION_FAILED";
    }
  }
}
export function isOverdue(
  task: { dueDate: string | null; progress: number },
  clock = new Date(),
) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(clock);
  const part = (key: string) => parts.find((p) => p.type === key)!.value;
  return (
    !!task.dueDate &&
    task.progress < 100 &&
    task.dueDate < `${part("year")}-${part("month")}-${part("day")}`
  );
}

// Explicit saves for tag names and comment bodies, with their own revisions.
export class RecordEditor {
  draft: Record<string, unknown> = {};
  latest: SavedRecord | null = null;
  pending: Record<string, unknown> | null = null;
  state: SaveState = "saved";
  error: string | null = null;
  private busy = false;
  private unregister: () => void;
  constructor(
    public path: string,
    public kind: "tag" | "comment",
    public base: SavedRecord,
    public changed: () => void = () => {},
  ) {
    this.unregister = registerDraft({
      hasDraft: () => this.dirty || !!this.pending,
      copyDraft: () =>
        copyPlain(String(this.draft.name ?? this.draft.body ?? "")),
      pause: () => {},
      clear: () => {
        this.draft = {};
        this.pending = null;
        this.latest = null;
        this.base = { id: "", revision: 0 };
        clearPrivateData();
        this.changed();
      },
    });
  }
  dispose() {
    this.unregister();
  }
  get dirty() {
    return Object.keys(this.draft).length > 0;
  }
  edit(patch: Record<string, unknown>) {
    Object.assign(this.draft, patch);
    if (this.state !== "failed" && this.state !== "conflicting")
      this.state = "unsaved";
    this.changed();
  }
  receive(remote: SavedRecord) {
    if (this.busy || remote.revision < this.base.revision) return;
    if (this.dirty || this.pending) {
      if (remote.revision > this.base.revision) {
        this.latest = remote;
        if (this.state !== "failed") this.state = "conflicting";
      }
    } else this.base = remote;
    this.changed();
  }
  start(sourcePath: string) {
    return observeResource(sourcePath, this.kind, (s) => {
      const rows = (s.data as PageData | null)?.items;
      const remote = rows?.find((r) => r.id === this.base.id);
      if (remote) this.receive(remote);
    });
  }
  async save() {
    if (
      this.busy ||
      this.pending ||
      this.state === "conflicting" ||
      this.state === "failed"
    )
      return;
    try {
      if (this.kind === "tag") text(this.draft.name, 50, "name");
      else text(this.draft.body, 10000, "body");
    } catch {
      this.state = "invalid";
      this.changed();
      return;
    }
    this.pending = {
      expectedRevision: this.base.revision,
      ...structuredClone(this.draft),
    };
    await this.send();
  }
  private async send() {
    if (!this.pending || this.busy) return;
    const pending = this.pending;
    this.busy = true;
    this.state = "saving";
    this.changed();
    try {
      const result = await mutation(this.path, "PATCH", pending);
      if (!record(result.data) || result.data.id !== this.base.id)
        throw new RequestFailure("MALFORMED_RESPONSE");
      this.base = result.data;
      for (const k of Object.keys(this.draft))
        if (canonicalJSON(this.draft[k]) === canonicalJSON(pending[k]))
          delete this.draft[k];
      this.pending = null;
      this.latest = null;
      this.error = null;
      this.state = this.dirty ? "unsaved" : "saved";
      if (this.kind === "tag") for (const p of pages) p.fromStart();
    } catch (error) {
      this.error =
        error instanceof RequestFailure ? error.code : "CONNECTION_FAILED";
      if (
        error instanceof RequestFailure &&
        error.code === "REVISION_CONFLICT" &&
        record(error.latest)
      ) {
        this.latest = error.latest;
        this.state = "conflicting";
      } else this.state = "failed";
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  async retry() {
    if (this.state === "failed") await this.send();
  }
  reapply() {
    if (!this.latest || this.busy)
      throw new Error("Review the latest saved record first.");
    this.base = this.latest;
    this.latest = null;
    this.pending = null;
    this.state = "unsaved";
    this.changed();
  }
  discard() {
    if (this.busy) throw new Error("Wait for the current request.");
    if (this.latest) this.base = this.latest;
    this.latest = null;
    this.pending = null;
    this.draft = {};
    this.state = "saved";
    this.changed();
  }
}

export function showCopyFallback(value: string) {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "Copy your draft");
  const label = document.createElement("p");
  label.textContent = "Select and copy your unsaved draft before leaving.";
  const area = document.createElement("textarea");
  area.readOnly = true;
  area.value = value;
  area.rows = 12;
  area.cols = 50;
  area.setAttribute("aria-label", "Unsaved draft text");
  const close = document.createElement("button");
  close.textContent = "Close";
  close.onclick = () => dialog.close();
  dialog.append(label, area, close);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  area.focus();
  area.select();
}

function clearPrivateData() {
  floors.clear();
  labels.clear();
  for (const r of resources.values()) {
    r.reset();
    r.state = { data: null, error: null, loading: false };
    r.emit();
  }
  for (const p of pages) {
    p.data = { items: [], nextCursor: null };
    p.cursor = null;
    p.history = [];
    p.changed();
  }
}
async function copyPlain(value: string) {
  try {
    if (!navigator.clipboard) throw new Error();
    await navigator.clipboard.writeText(value);
  } catch {
    showCopyFallback(value);
    throw new Error("Select and copy the draft.");
  }
}
function registerDraft(work: {
  hasDraft: () => boolean;
  copyDraft: () => Promise<void>;
  pause: () => void;
  clear: () => void;
}) {
  const remove = authController.registerWork(work);
  const leaving = (event: BeforeUnloadEvent) => {
    if (work.hasDraft()) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", leaving);
  return () => {
    remove();
    window.removeEventListener("beforeunload", leaving);
  };
}
export class ExplicitDeletion {
  state: "unsaved" | "saving" | "saved" | "failed" = "unsaved";
  error: string | null = null;
  private payload: Record<string, unknown>;
  constructor(
    public path: string,
    expectedRevision: number,
  ) {
    this.payload = { expectedRevision };
  }
  async submit() {
    if (this.state === "saving" || this.state === "saved") return;
    this.state = "saving";
    try {
      const result = await mutation(this.path, "DELETE", this.payload);
      const data = result.data as { deleted?: boolean };
      if (data?.deleted !== true)
        throw new RequestFailure("MALFORMED_RESPONSE");
      this.state = "saved";
      for (const page of pages) page.fromStart();
    } catch (error) {
      if (error instanceof RequestFailure && error.code === "NOT_FOUND")
        this.state = "saved";
      else {
        this.state = "failed";
        this.error =
          error instanceof RequestFailure ? error.code : "CONNECTION_FAILED";
      }
    }
  }
}
