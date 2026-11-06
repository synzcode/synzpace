import "server-only";
import { transaction, type Query, type Row } from "./database";
import {
  active,
  creation,
  expectRevision,
  increment,
  now,
  page,
  paged,
  parent,
  taskDTO,
} from "./service";
import {
  DataFailure,
  canonicalJSON,
  invalid,
  text,
  uuid,
} from "@/lib/tasks/validation";
import { normalizeTag } from "@/lib/tasks/normalize-tag";
const iso = (value: unknown) =>
  value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
export const tagDTO = (r: Row) => ({
  id: r.id,
  name: r.name,
  revision: r.revision,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});
export const commentDTO = (r: Row) => ({
  id: r.id,
  taskId: r.task_id,
  body: r.body,
  revision: r.revision,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});
async function ownerLock(q: Query, owner: string) {
  await q("select pg_advisory_xact_lock(hashtextextended($1,8147002002))", [
    owner,
  ]);
}
async function tag(
  q: Query,
  owner: string,
  id: string,
  lock = false,
  replay = false,
) {
  const [r] = await q(
    `select * from tags where owner_id=$1 and id=$2 ${lock ? "for update" : ""}`,
    [owner, id],
  );
  if (!r)
    throw new DataFailure(
      replay ? 410 : 404,
      replay ? "CREATION_GONE" : "NOT_FOUND",
    );
  return r;
}
async function uniqueName(
  q: Query,
  owner: string,
  normalized: string,
  id?: string,
) {
  const [r] = await q(
    "select * from tags where owner_id=$1 and normalized_name=$2 and id<>$3::uuid",
    [owner, normalized, id ?? "00000000-0000-0000-0000-000000000000"],
  );
  if (r)
    throw new DataFailure(
      409,
      "DUPLICATE_TAG_NAME",
      { name: "Choose another name or use this tag." },
      { kind: "tag", record: tagDTO(r) },
    );
}
export async function tagOperation(
  owner: string,
  method: string,
  id: string | undefined,
  input: Record<string, unknown>,
  url: URL,
  key?: string,
) {
  return transaction(async (q) => {
    const serverNow = await now(q);
    if (method === "GET") {
      const p = page(url, "tags", ["limit", "cursor"]);
      const rows = await q(
        `select *,normalized_name as boundary from tags where owner_id=$1 ${p.boundary ? "and (normalized_name,id)>($2,$3::uuid)" : ""} order by normalized_name,id limit $${p.boundary ? 4 : 2}`,
        [
          owner,
          ...(p.boundary ? [p.boundary.value, p.boundary.id] : []),
          p.limit + 1,
        ],
      );
      return { data: paged(rows, p, tagDTO), serverNow };
    }
    await ownerLock(q, owner);
    if (!id) {
      const normalized = normalizeTag(input.name);
      const result = await creation(
        q,
        owner,
        key!,
        "create_tag",
        normalized,
        async (newId) => {
          await uniqueName(q, owner, normalized.normalizedName);
          return tagDTO(
            (
              await q(
                "insert into tags(id,owner_id,name,normalized_name) values ($1,$2,$3,$4) returning *",
                [newId, owner, normalized.name, normalized.normalizedName],
              )
            )[0],
          );
        },
        async (resource) => tagDTO(await tag(q, owner, resource, false, true)),
      );
      return { ...result, serverNow };
    }
    const row = await tag(q, owner, id, true);
    expectRevision(row, input.expectedRevision, "tag", tagDTO(row));
    if (method === "DELETE") {
      const affected = await q(
        "select t.* from tasks t join task_tags a on a.owner_id=t.owner_id and a.task_id=t.id where a.owner_id=$1 and a.tag_id=$2 order by t.id for update of t",
        [owner, id],
      );
      affected.forEach(increment);
      await q(
        "update tasks set revision=revision+1,updated_at=clock_timestamp() where owner_id=$1 and id in (select task_id from task_tags where owner_id=$1 and tag_id=$2)",
        [owner, id],
      );
      await q("delete from tags where owner_id=$1 and id=$2 and revision=$3", [
        owner,
        id,
        row.revision,
      ]);
      return { data: { id, deleted: true }, serverNow };
    }
    const normalized = normalizeTag(input.name);
    if (normalized.name === row.name) return { data: tagDTO(row), serverNow };
    increment(row);
    await uniqueName(q, owner, normalized.normalizedName, id);
    const [updated] = await q(
      "update tags set name=$4,normalized_name=$5,revision=revision+1,updated_at=clock_timestamp() where owner_id=$1 and id=$2 and revision=$3 returning *",
      [owner, id, row.revision, normalized.name, normalized.normalizedName],
    );
    return { data: tagDTO(updated), serverNow };
  });
}
export async function assignmentOperation(
  owner: string,
  taskId: string,
  input: Record<string, unknown>,
) {
  return transaction(async (q) => {
    await ownerLock(q, owner);
    const { row, serverNow } = await parent(q, owner, taskId, true);
    const dto = taskDTO(row);
    active(row, dto);
    expectRevision(row, input.expectedRevision, "task", dto);
    if (!Array.isArray(input.tagIds) || input.tagIds.length > 100)
      invalid("tagIds");
    const ids = input.tagIds.map((value) => uuid(value, "tagIds")).sort();
    if (new Set(ids).size !== ids.length) invalid("tagIds");
    const valid = await q(
      "select id from tags where owner_id=$1 and id=any($2::uuid[])",
      [owner, ids],
    );
    if (valid.length !== ids.length) invalid("tagIds");
    const current = await q(
      "select tag_id from task_tags where owner_id=$1 and task_id=$2 order by tag_id",
      [owner, taskId],
    );
    if (canonicalJSON(current.map((r) => r.tag_id)) === canonicalJSON(ids))
      return { data: dto, serverNow };
    increment(row);
    await q("delete from task_tags where owner_id=$1 and task_id=$2", [
      owner,
      taskId,
    ]);
    if (ids.length)
      await q(
        "insert into task_tags(owner_id,task_id,tag_id) select $1,$2,value from unnest($3::uuid[]) as value",
        [owner, taskId, ids],
      );
    await q(
      "update tasks set revision=revision+1,updated_at=clock_timestamp() where owner_id=$1 and id=$2 and revision=$3",
      [owner, taskId, row.revision],
    );
    return { data: taskDTO((await parent(q, owner, taskId)).row), serverNow };
  });
}
export async function commentOperation(
  owner: string,
  method: string,
  taskId: string,
  id: string | undefined,
  input: Record<string, unknown>,
  url: URL,
  key?: string,
) {
  return transaction(async (q) => {
    const receipts =
      method === "POST"
        ? await q(
            "select resource_id from creation_receipts where owner_id=$1 and request_id=$2",
            [owner, key],
          )
        : [];
    const { row, serverNow } = await parent(
      q,
      owner,
      taskId,
      method !== "GET",
      receipts.length > 0,
    );
    if (method === "GET") {
      const p = page(url, "comments:" + taskId, ["cursor", "limit"]);
      const rows = await q(
        `select *,created_at::text as boundary from comments where owner_id=$1 and task_id=$2 ${p.boundary ? "and (created_at,id)>($3::timestamptz,$4::uuid)" : ""} order by created_at,id limit $${p.boundary ? 5 : 3}`,
        [
          owner,
          taskId,
          ...(p.boundary ? [p.boundary.value, p.boundary.id] : []),
          p.limit + 1,
        ],
      );
      return { data: paged(rows, p, commentDTO), serverNow };
    }
    if (method === "POST") {
      const body = text(input.body, 10000, "body");
      const result = await creation(
        q,
        owner,
        key!,
        "create_comment",
        { body },
        async (newId) => {
          active(row, taskDTO(row));
          return commentDTO(
            (
              await q(
                "insert into comments(id,owner_id,task_id,body) values ($1,$2,$3,$4) returning *",
                [newId, owner, taskId, body],
              )
            )[0],
          );
        },
        async (resource) => {
          await parent(q, owner, taskId, false, true);
          const [record] = await q(
            "select * from comments where owner_id=$1 and task_id=$2 and id=$3",
            [owner, taskId, resource],
          );
          if (!record) throw new DataFailure(410, "CREATION_GONE");
          return commentDTO(record);
        },
        taskId,
      );
      return { ...result, serverNow };
    }
    const [comment] = await q(
      "select * from comments where owner_id=$1 and task_id=$2 and id=$3 for update",
      [owner, taskId, id],
    );
    if (!comment) throw new DataFailure(404, "NOT_FOUND");
    active(row, taskDTO(row));
    expectRevision(
      comment,
      input.expectedRevision,
      "comment",
      commentDTO(comment),
    );
    if (method === "DELETE") {
      await q(
        "delete from comments where owner_id=$1 and task_id=$2 and id=$3 and revision=$4",
        [owner, taskId, id, comment.revision],
      );
      return { data: { id, deleted: true }, serverNow };
    }
    const body = text(input.body, 10000, "body");
    if (body === comment.body) return { data: commentDTO(comment), serverNow };
    increment(comment);
    const [updated] = await q(
      "update comments set body=$5,revision=revision+1,updated_at=clock_timestamp() where owner_id=$1 and task_id=$2 and id=$3 and revision=$4 returning *",
      [owner, taskId, id, comment.revision, body],
    );
    return { data: commentDTO(updated), serverNow };
  });
}
