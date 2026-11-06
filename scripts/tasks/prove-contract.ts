import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { taskOperation } from "../../lib/data/tasks/service";
import {
  tagOperation,
  assignmentOperation,
  commentOperation,
} from "../../lib/data/tasks/related";
import { cleanupTasks } from "../../lib/data/tasks/cleanup";
import { canonicalizeDescriptionV1 } from "../../lib/tasks/rich-text";
import { normalizeTag } from "../../lib/tasks/normalize-tag";
import { dueDate } from "../../lib/tasks/validation";
import { getPool } from "../../lib/db";
const owner = process.env.PERSONAL_ACCOUNT_ID!;
const url = new URL("http://localhost/api/tasks");
const code = (name: string) => (e: unknown) =>
  (e as { code: string }).code === name;
const rec = (r: { data: unknown }) => r.data as Record<string, unknown>;
async function main() {
  if (process.env.AUTH_PROOF_DEVELOPMENT !== "true" || !owner)
    throw new Error();
  const keys = Array.from({ length: 5 }, () => randomUUID());
  let task: string | undefined,
    tag: string | undefined,
    comment: string | undefined;
  try {
    const schema = await getPool().query(
      "select table_name from information_schema.tables where table_schema='public' and table_name=any($1::text[])",
      [["tasks", "tags", "task_tags", "comments", "creation_receipts"]],
    );
    assert.equal(schema.rowCount, 5);
    for (const [a, b] of [
      ["Work", " work "],
      ["Straße", "STRASSE"],
      ["ＡＢＣ", "abc"],
      ["É", "E\u0301"],
    ])
      assert.equal(
        normalizeTag(a).normalizedName,
        normalizeTag(b).normalizedName,
      );
    assert.throws(() => dueDate("2025-02-29"));
    assert.equal(dueDate("0001-01-01"), "0001-01-01");
    assert.equal(dueDate("2000-02-29"), "2000-02-29");
    assert.equal(
      canonicalizeDescriptionV1({
        type: "doc",
        content: [{ type: "paragraph" }],
      }),
      null,
    );
    const rich = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "a",
              marks: [{ type: "italic" }, { type: "bold" }],
            },
            {
              type: "text",
              text: "b",
              marks: [{ type: "bold" }, { type: "italic" }],
            },
          ],
        },
      ],
    };
    assert.equal(
      canonicalizeDescriptionV1(rich)!.content![0].content![0].text,
      "ab",
    );
    for (const doc of [
      { type: "doc", content: null },
      { type: "doc", content: [{ type: "heading" }] },
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "x",
                marks: [
                  { type: "link", attrs: { href: "javascript:alert(1)" } },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "x",
                marks: [{ type: "bold" }, { type: "bold" }],
              },
            ],
          },
        ],
      },
    ])
      assert.throws(() => canonicalizeDescriptionV1(doc));
    task = String(
      rec(
        await taskOperation(
          owner,
          "POST",
          undefined,
          undefined,
          { title: "Contract proof" },
          url,
          keys[0],
        ),
      ).id,
    );
    let r = rec(
      await taskOperation(
        owner,
        "PATCH",
        task,
        undefined,
        {
          expectedRevision: 1,
          progress: 45,
          dueDate: "0001-01-01",
          description: rich,
          descriptionVersion: 1,
        },
        url,
      ),
    );
    assert.equal(r.revision, 2);
    assert.equal(r.dueDate, "0001-01-01");
    r = rec(
      await taskOperation(
        owner,
        "PATCH",
        task,
        undefined,
        { expectedRevision: 2, status: "in_progress" },
        url,
      ),
    );
    assert.equal(r.progress, 45);
    assert.equal(r.revision, 2);
    await assert.rejects(
      taskOperation(
        owner,
        "PATCH",
        task,
        undefined,
        { expectedRevision: 2, description: rich, descriptionVersion: 2 },
        url,
      ),
      code("UNSUPPORTED_DESCRIPTION_VERSION"),
    );
    const tagName = "Straße " + randomUUID();
    tag = String(
      rec(
        await tagOperation(
          owner,
          "POST",
          undefined,
          { name: tagName },
          url,
          keys[1],
        ),
      ).id,
    );
    await assert.rejects(
      tagOperation(
        owner,
        "POST",
        undefined,
        { name: tagName.toUpperCase() },
        url,
        keys[2],
      ),
      code("DUPLICATE_TAG_NAME"),
    );
    r = rec(
      await assignmentOperation(owner, task, {
        expectedRevision: 2,
        tagIds: [tag],
      }),
    );
    assert.equal(r.revision, 3);
    assert.equal((r.tags as unknown[]).length, 1);
    await assert.rejects(
      assignmentOperation(owner, task, {
        expectedRevision: 3,
        tagIds: [randomUUID()],
      }),
      code("VALIDATION_FAILED"),
    );
    comment = String(
      rec(
        await commentOperation(
          owner,
          "POST",
          task,
          undefined,
          { body: " A personal comment\nsecond line " },
          url,
          keys[3],
        ),
      ).id,
    );
    const commentReplay = await commentOperation(
      owner,
      "POST",
      task,
      undefined,
      { body: "A personal comment\nsecond line" },
      url,
      keys[3],
    );
    assert("replayed" in commentReplay && commentReplay.replayed);
    const commentPage = rec(
      await commentOperation(owner, "GET", task, undefined, {}, url),
    );
    assert.equal((commentPage.items as unknown[]).length, 1);
    await tagOperation(
      owner,
      "PATCH",
      tag,
      { expectedRevision: 1, name: "Renamed " + randomUUID() },
      url,
    );
    r = rec(await taskOperation(owner, "GET", task, undefined, {}, url));
    assert.equal(r.revision, 3);
    assert.equal((r.tags as Record<string, unknown>[])[0].revision, 2);
    await getPool().query("update tasks set revision=2147483647 where id=$1", [
      task,
    ]);
    await assert.rejects(
      tagOperation(owner, "DELETE", tag, { expectedRevision: 2 }, url),
      code("REVISION_EXHAUSTED"),
    );
    assert.equal(
      (await getPool().query("select id from tags where id=$1", [tag]))
        .rowCount,
      1,
    );
    await getPool().query("update tasks set revision=3 where id=$1", [task]);
    // Revision reset here is confined to this disposable proof fixture.
    await taskOperation(
      owner,
      "DELETE",
      task,
      undefined,
      { expectedRevision: 3 },
      url,
    );
    await assert.rejects(
      commentOperation(
        owner,
        "PATCH",
        task,
        comment,
        { expectedRevision: 1, body: "Changed" },
        url,
      ),
      code("TASK_IN_TRASH"),
    );
    await tagOperation(owner, "DELETE", tag, { expectedRevision: 2 }, url);
    tag = undefined;
    r = rec(await taskOperation(owner, "GET", task, undefined, {}, url));
    assert.equal(r.revision, 5);
    assert.deepEqual(r.tags, []);
    r = rec(
      await taskOperation(
        owner,
        "POST",
        task,
        "restore",
        { expectedRevision: 5 },
        url,
      ),
    );
    assert.equal(r.revision, 6);
    assert.equal(r.progress, 45);
    assert.equal(
      (
        rec(await commentOperation(owner, "GET", task, undefined, {}, url))
          .items as unknown[]
      ).length,
      1,
    );
    const held = await getPool().connect();
    try {
      await held.query("BEGIN");
      await held.query(
        "update tasks set trashed_at=clock_timestamp()-interval '720 hours'+interval '600 milliseconds',revision=7 where owner_id=$1 and id=$2",
        [owner, task],
      );
      const waiting = commentOperation(
        owner,
        "PATCH",
        task,
        comment,
        { expectedRevision: 1, body: "Must not leak" },
        url,
      );
      const expired = assert.rejects(waiting, code("RESOURCE_EXPIRED"));
      await new Promise((resolve) => setTimeout(resolve, 900));
      await held.query("COMMIT");
      await expired;
    } finally {
      await held.query("ROLLBACK");
      held.release();
    }
    for (const [method, action, input] of [
      ["GET", undefined, {}],
      ["PATCH", undefined, { expectedRevision: 1, title: "x" }],
      ["POST", "restore", { expectedRevision: 7 }],
      ["DELETE", "permanent", { expectedRevision: 7, confirmed: true }],
    ] as const)
      await assert.rejects(
        taskOperation(owner, method, task, action, input, url),
        code("RESOURCE_EXPIRED"),
      );
    for (const method of ["GET", "PATCH", "DELETE"])
      await assert.rejects(
        commentOperation(
          owner,
          method,
          task,
          comment,
          { expectedRevision: 1, body: "x" },
          url,
        ),
        code("RESOURCE_EXPIRED"),
      );
    await assert.rejects(
      assignmentOperation(owner, task, { expectedRevision: 7, tagIds: [] }),
      code("RESOURCE_EXPIRED"),
    );
    await assert.rejects(
      taskOperation(
        owner,
        "POST",
        undefined,
        undefined,
        { title: "Contract proof" },
        url,
        keys[0],
      ),
      code("CREATION_GONE"),
    );
    await assert.rejects(
      commentOperation(
        owner,
        "POST",
        task,
        undefined,
        { body: "A personal comment\nsecond line" },
        url,
        keys[3],
      ),
      code("CREATION_GONE"),
    );
    const cleaned = await cleanupTasks();
    assert(cleaned.purged >= 1);
    assert.equal(
      (await getPool().query("select id from comments where id=$1", [comment]))
        .rowCount,
      0,
    );
    assert.equal(
      (
        await getPool().query(
          "select resource_id from creation_receipts where owner_id=$1 and request_id=$2",
          [owner, keys[0]],
        )
      ).rowCount,
      1,
    );
    await cleanupTasks();
    console.log(
      "Live schema, Unicode folding, rich text, calendar dates, no ops, tags, comments, revision exhaustion rollback, recovery, expiry guards, cleanup cascades, and retained receipts passed.",
    );
  } finally {
    if (task)
      await getPool().query("delete from tasks where owner_id=$1 and id=$2", [
        owner,
        task,
      ]);
    if (tag)
      await getPool().query("delete from tags where owner_id=$1 and id=$2", [
        owner,
        tag,
      ]);
    await getPool().query(
      "delete from creation_receipts where owner_id=$1 and request_id=any($2::uuid[])",
      [owner, keys],
    );
    await getPool().end();
  }
}
main().catch((error) => {
  console.error(
    "Contract proof failed:",
    error instanceof assert.AssertionError
      ? error.message
      : ((error as { code?: string }).code ??
          "Check the development database."),
  );
  process.exitCode = 1;
});
