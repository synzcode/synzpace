import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { taskOperation } from "../../lib/data/tasks/service";
import { getPool } from "../../lib/db";
const owner = process.env.PERSONAL_ACCOUNT_ID!;
async function main() {
  if (process.env.AUTH_PROOF_DEVELOPMENT !== "true" || !owner)
    throw new Error();
  const key = randomUUID();
  const secondKey = randomUUID();
  let secondId: string | undefined;
  let id: string | undefined;
  const url = new URL("http://localhost/api/tasks");
  try {
    const created = await taskOperation(
      owner,
      "POST",
      undefined,
      undefined,
      { title: "Persistence proof" },
      url,
      key,
    );
    id = (created.data as { id: string }).id;
    assert.equal(created.replayed, false);
    const replay = await taskOperation(
      owner,
      "POST",
      undefined,
      undefined,
      { title: " Persistence proof " },
      url,
      key,
    );
    assert.equal(replay.replayed, true);
    const read = await taskOperation(owner, "GET", id, undefined, {}, url);
    assert.equal((read.data as { title: string }).title, "Persistence proof");
    await assert.rejects(
      taskOperation(
        owner,
        "POST",
        undefined,
        undefined,
        { title: "Different" },
        url,
        key,
      ),
      (e) => (e as { code: string }).code === "IDEMPOTENCY_KEY_REUSED",
    );
    const extra = await taskOperation(
      owner,
      "POST",
      undefined,
      undefined,
      { title: "Pagination proof" },
      url,
      secondKey,
    );
    secondId = (extra.data as { id: string }).id;
    const firstPage = await taskOperation(
      owner,
      "GET",
      undefined,
      undefined,
      {},
      new URL("http://localhost/api/tasks?limit=1"),
    );
    const boundary = firstPage.data as { items: unknown[]; nextCursor: string };
    assert.equal(boundary.items.length, 1);
    assert.equal(typeof boundary.nextCursor, "string");
    const nextPage = await taskOperation(
      owner,
      "GET",
      undefined,
      undefined,
      {},
      new URL(
        "http://localhost/api/tasks?limit=1&cursor=" + boundary.nextCursor,
      ),
    );
    assert.equal(
      (nextPage.data as { items: { id: string }[] }).items[0].id,
      id,
    );
    await assert.rejects(
      taskOperation(
        owner,
        "GET",
        undefined,
        undefined,
        {},
        new URL(
          "http://localhost/api/tasks?state=trash&cursor=" +
            boundary.nextCursor,
        ),
      ),
      (e) => (e as { code: string }).code === "VALIDATION_FAILED",
    );
    const races = await Promise.allSettled(
      [37, 42].map((progress) =>
        taskOperation(
          owner,
          "PATCH",
          id,
          undefined,
          { expectedRevision: 1, progress, dueDate: "2028-02-29" },
          url,
        ),
      ),
    );
    assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(races.filter((r) => r.status === "rejected").length, 1);
    await assert.rejects(
      taskOperation(randomUUID(), "GET", id, undefined, {}, url),
      (e) => (e as { code: string }).code === "NOT_FOUND",
    );
    const saved = await taskOperation(owner, "GET", id, undefined, {}, url);
    assert.equal((saved.data as { revision: number }).revision, 2);
    const trash = await taskOperation(
      owner,
      "DELETE",
      id,
      undefined,
      { expectedRevision: 2 },
      url,
    );
    assert.equal((trash.data as { revision: number }).revision, 3);
    await taskOperation(
      owner,
      "DELETE",
      id,
      "permanent",
      { expectedRevision: 3, confirmed: true },
      url,
    );
    await assert.rejects(
      taskOperation(
        owner,
        "POST",
        undefined,
        undefined,
        { title: "Persistence proof" },
        url,
        key,
      ),
      (e) => (e as { code: string }).code === "CREATION_GONE",
    );
    console.log(
      "Committed task create, reload read, creation replay, concurrent revision race, owner isolation, and receipt retention after deletion passed.",
    );
  } finally {
    if (secondId)
      await getPool().query("delete from tasks where id=$1 and owner_id=$2", [
        secondId,
        owner,
      ]);
    await getPool().query(
      "delete from creation_receipts where owner_id=$1 and request_id=$2",
      [owner, secondKey],
    );
    if (id)
      await getPool().query("delete from tasks where id=$1 and owner_id=$2", [
        id,
        owner,
      ]);
    await getPool().query(
      "delete from creation_receipts where owner_id=$1 and request_id=$2",
      [owner, key],
    );
    await getPool().end();
  }
}
main().catch(() => {
  console.error("Task thread proof failed.");
  process.exitCode = 1;
});
