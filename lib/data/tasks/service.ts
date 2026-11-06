import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { transaction, type Query, type Row } from "./database";
import {
  DataFailure,
  canonicalJSON,
  dueDate,
  invalid,
  object,
  revision,
  statusFor,
  text,
  uuid,
} from "@/lib/tasks/validation";
import { canonicalizeDescriptionV1 } from "@/lib/tasks/rich-text";

const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
export function taskDTO(r: Row) {
  return {
    id: r.id,
    title: r.title,
    progress: r.progress,
    status: statusFor(Number(r.progress)),
    dueDate: r.due_date,
    revision: r.revision,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    trashedAt: r.trashed_at ? iso(r.trashed_at) : null,
    expiresAt: r.trashed_at
      ? new Date(
          new Date(String(r.trashed_at)).getTime() + 720 * 3600000,
        ).toISOString()
      : null,
    tags: r.tags ?? [],
    description: r.description,
    descriptionVersion: r.description_version,
  };
}
export async function now(q: Query) {
  return iso((await q("select clock_timestamp() as now"))[0].now);
}
export const tagProjection =
  "coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'revision',g.revision) order by g.id) from task_tags a join tags g on g.owner_id=a.owner_id and g.id=a.tag_id where a.owner_id=tasks.owner_id and a.task_id=tasks.id),'[]'::jsonb) as tags";
export async function parent(
  q: Query,
  owner: string,
  id: string,
  lock = false,
  replay = false,
) {
  const [row] = await q(
    `select *, due_date::text as due_date, ${tagProjection} from tasks where owner_id=$1 and id=$2 ${lock ? "for update" : ""}`,
    [owner, id],
  );
  if (!row)
    throw new DataFailure(
      replay ? 410 : 404,
      replay ? "CREATION_GONE" : "NOT_FOUND",
    );
  const serverNow = await now(q);
  if (
    row.trashed_at &&
    new Date(serverNow).getTime() >=
      new Date(String(row.trashed_at)).getTime() + 720 * 3600000
  )
    throw new DataFailure(410, replay ? "CREATION_GONE" : "RESOURCE_EXPIRED");
  return { row, serverNow };
}
export function expectRevision(
  row: Row,
  expected: unknown,
  kind: string,
  dto: unknown,
) {
  if (row.revision !== revision(expected))
    throw new DataFailure(409, "REVISION_CONFLICT", undefined, {
      kind,
      record: dto,
    });
}
export function increment(row: Row) {
  if (Number(row.revision) >= 2147483647)
    throw new DataFailure(503, "REVISION_EXHAUSTED");
}
export function active(row: Row, dto: unknown) {
  if (row.trashed_at)
    throw new DataFailure(409, "TASK_IN_TRASH", undefined, {
      kind: "task",
      record: dto,
    });
}
export async function creation(
  q: Query,
  owner: string,
  key: string,
  operation: string,
  payload: unknown,
  create: (id: string) => Promise<unknown>,
  read: (id: string) => Promise<unknown>,
  taskId?: string,
) {
  const hash = createHash("sha256")
    .update(
      canonicalJSON({ operation, ...(taskId ? { taskId } : {}), payload }),
    )
    .digest("hex");
  const id = randomUUID();
  const inserted = await q(
    "insert into creation_receipts(owner_id,request_id,operation,request_hash,resource_id) values ($1,$2,$3,$4,$5) on conflict do nothing returning resource_id",
    [owner, key, operation, hash, id],
  );
  if (inserted.length) return { data: await create(id), replayed: false };
  const [receipt] = await q(
    "select * from creation_receipts where owner_id=$1 and request_id=$2",
    [owner, key],
  );
  if (receipt.operation !== operation || receipt.request_hash !== hash)
    throw new DataFailure(409, "IDEMPOTENCY_KEY_REUSED");
  return { data: await read(String(receipt.resource_id)), replayed: true };
}
export type Page = {
  limit: number;
  boundary?: { value: string; id: string };
  dataset: string;
};
export function page(
  url: URL,
  dataset: string,
  allowed = ["cursor", "limit", "state"],
): Page {
  if (
    [...url.searchParams.keys()].some((k) => !allowed.includes(k)) ||
    [...url.searchParams.keys()].some(
      (k) => url.searchParams.getAll(k).length !== 1,
    )
  )
    invalid("cursor");
  const value = url.searchParams.get("limit") ?? "50";
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100)
    invalid("limit");
  const raw = url.searchParams.get("cursor");
  let boundary: Page["boundary"];
  if (raw) {
    try {
      if (raw.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(raw)) invalid("cursor");
      const b = object(
        JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
        ["v", "dataset", "value", "id"],
      );
      if (
        b.v !== 1 ||
        b.dataset !== dataset ||
        typeof b.value !== "string" ||
        b.value.length > 1024
      )
        invalid("cursor");
      uuid(b.id, "cursor");
      if (
        !dataset.startsWith("tags") &&
        (!/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(
          b.value,
        ) ||
          Number.isNaN(Date.parse(b.value)))
      )
        invalid("cursor");
      if (!dataset.startsWith("tags")) dueDate(b.value.slice(0, 10));
      boundary = { value: b.value, id: String(b.id) };
    } catch {
      invalid("cursor");
    }
  }
  return { limit: Number(value), boundary, dataset };
}
export function paged(rows: Row[], p: Page, dto: (r: Row) => unknown) {
  const selected = rows.slice(0, p.limit);
  const last = selected.at(-1);
  return {
    items: selected.map(dto),
    nextCursor:
      rows.length > p.limit && last
        ? Buffer.from(
            JSON.stringify({
              v: 1,
              dataset: p.dataset,
              value: last.boundary,
              id: last.id,
            }),
          ).toString("base64url")
        : null,
  };
}
export function taskPatch(input: Record<string, unknown>, current: Row) {
  const patch: Record<string, unknown> = {};
  if ("title" in input) patch.title = text(input.title, 200, "title");
  if ("dueDate" in input) patch.due_date = dueDate(input.dueDate);
  if ("progress" in input && "status" in input) invalid("status");
  if ("progress" in input) {
    if (
      !Number.isInteger(input.progress) ||
      Number(input.progress) < 0 ||
      Number(input.progress) > 100
    )
      invalid("progress");
    patch.progress = input.progress;
  }
  if ("status" in input) {
    if (!["todo", "in_progress", "done"].includes(String(input.status)))
      invalid("status");
    patch.progress =
      input.status === statusFor(Number(current.progress))
        ? current.progress
        : input.status === "todo"
          ? 0
          : input.status === "done"
            ? 100
            : 1;
  }
  if ("description" in input) {
    if (current.description_version !== 1 || input.descriptionVersion !== 1)
      throw new DataFailure(422, "UNSUPPORTED_DESCRIPTION_VERSION", {
        descriptionVersion: "This format is unsupported.",
      });
    patch.description = canonicalizeDescriptionV1(input.description);
    patch.description_version = 1;
  } else if ("descriptionVersion" in input) invalid("description");
  if (!Object.keys(patch).length) invalid();
  return patch;
}
export async function taskOperation(
  owner: string,
  method: string,
  id: string | undefined,
  action: string | undefined,
  input: Record<string, unknown>,
  url: URL,
  key?: string,
): Promise<{ data: unknown; serverNow: string; replayed?: boolean }> {
  return transaction(async (q) => {
    let serverNow = await now(q);
    if (!id) {
      if (method === "POST") {
        const title = text(input.title, 200, "title");
        const result = await creation(
          q,
          owner,
          key!,
          "create_task",
          { title },
          async (newId) => {
            await q("insert into tasks(id,owner_id,title) values ($1,$2,$3)", [
              newId,
              owner,
              title,
            ]);
            return taskDTO((await parent(q, owner, newId)).row);
          },
          async (resource) =>
            taskDTO((await parent(q, owner, resource, false, true)).row),
        );
        return { ...result, serverNow };
      }
      const state = url.searchParams.get("state") ?? "active";
      if (!["active", "trash"].includes(state)) invalid("state");
      const p = page(url, "tasks:" + state);
      const column = state === "active" ? "created_at" : "trashed_at";
      const rows = await q(
        `select id,title,progress,due_date::text as due_date,revision,created_at,updated_at,trashed_at, ${tagProjection}, ${column}::text as boundary from tasks where owner_id=$1 and ${state === "active" ? "trashed_at is null" : "trashed_at is not null and trashed_at + interval '720 hours' > clock_timestamp()"} ${p.boundary ? `and (${column},id)<($2::timestamptz,$3::uuid)` : ""} order by ${column} desc,id desc limit $${p.boundary ? 4 : 2}`,
        [
          owner,
          ...(p.boundary ? [p.boundary.value, p.boundary.id] : []),
          p.limit + 1,
        ],
      );
      return {
        data: paged(rows, p, (r) => {
          const dto = taskDTO(r);
          const { description, descriptionVersion, ...summary } = dto;
          void description;
          void descriptionVersion;
          return summary;
        }),
        serverNow,
      };
    }
    const guarded = await parent(q, owner, id, method !== "GET");
    const row = guarded.row;
    serverNow = guarded.serverNow;
    const dto = taskDTO(row);
    if (method === "GET") return { data: dto, serverNow };
    if (!action && method === "PATCH") active(row, dto);
    if (action === "permanent" && !row.trashed_at)
      throw new DataFailure(409, "TASK_NOT_IN_TRASH", undefined, {
        kind: "task",
        record: dto,
      });
    // Only an unchanged prior lifecycle response is eligible for a safe replay.
    if (
      ((!action && method === "DELETE" && row.trashed_at) ||
        (action === "restore" && !row.trashed_at)) &&
      Number(input.expectedRevision) === Number(row.revision) - 1
    )
      return { data: dto, serverNow };
    expectRevision(row, input.expectedRevision, "task", dto);
    if (action === "permanent") {
      if (input.confirmed !== true) invalid("confirmed");
      await q("delete from tasks where owner_id=$1 and id=$2 and revision=$3", [
        owner,
        id,
        row.revision,
      ]);
      return { data: { id, deleted: true }, serverNow };
    }
    let patch: Record<string, unknown>;
    if (action === "restore") patch = { trashed_at: null };
    else if (method === "DELETE")
      patch = { trashed_at: row.trashed_at ?? serverNow };
    else patch = taskPatch(input, row);
    const changed = Object.keys(patch).filter(
      (k) =>
        canonicalJSON(patch[k]) !==
        canonicalJSON(
          row[k] instanceof Date ? (row[k] as Date).toISOString() : row[k],
        ),
    );
    if (!changed.length) return { data: dto, serverNow };
    increment(row);
    const values = changed.map((k) =>
      k === "description" ? JSON.stringify(patch[k]) : patch[k],
    );
    const [updated] = await q(
      `update tasks set ${changed.map((k, i) => `${k}=$${i + 4}${k === "description" ? "::jsonb" : ""}`).join(",")},revision=revision+1,updated_at=clock_timestamp() where owner_id=$1 and id=$2 and revision=$3 returning *,due_date::text as due_date`,
      [owner, id, row.revision, ...values],
    );
    return { data: taskDTO({ ...updated, tags: row.tags }), serverNow };
  });
}
