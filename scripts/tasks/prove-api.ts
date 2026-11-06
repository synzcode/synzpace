import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { serializeSignedCookie } from "better-call";
import { tasksRoute } from "../../lib/data/tasks/http";
import { getPool } from "../../lib/db";
async function main() {
  if (process.env.AUTH_PROOF_DEVELOPMENT !== "true") throw new Error();
  const origin = process.env.BETTER_AUTH_URL!;
  let id: string | undefined;
  const key = randomUUID();
  try {
    const signedOut = await tasksRoute(new Request(origin + "/api/tasks"));
    assert.equal(signedOut.status, 401);
    assert.equal(signedOut.headers.get("cache-control"), "private, no-store");
    const { rows } = await getPool().query(
      "select token from session where user_id=$1 and expires_at>clock_timestamp() and created_at+interval '90 days'>clock_timestamp() limit 1",
      [process.env.PERSONAL_ACCOUNT_ID],
    );
    assert.equal(
      rows.length,
      1,
      "Sign in at localhost:3000 and leave that session active before this proof.",
    );
    const name = origin.startsWith("https:")
      ? "__Secure-better-auth.session_token"
      : "better-auth.session_token";
    const cookie = (
      await serializeSignedCookie(
        name,
        rows[0].token,
        process.env.BETTER_AUTH_SECRET!,
        { path: "/", httpOnly: true, sameSite: "lax" },
      )
    ).split(";")[0];
    const req = (
      method: string,
      payload?: unknown,
      overrides?: Record<string, string>,
    ) =>
      new Request(origin + "/api/tasks", {
        method,
        headers: {
          Cookie: cookie,
          Origin: origin,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          ...overrides,
        },
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      });
    const create = await tasksRoute(
      req("POST", { title: "Real session task proof" }),
    );
    assert.equal(create.status, 201);
    const data = await create.json();
    id = data.data.id;
    assert.equal(data.data.revision, 1);
    assert(!("ownerId" in data.data));
    assert.equal(data.meta.replayed, false);
    const read = await tasksRoute(req("GET"), { taskId: id });
    assert.equal(read.status, 200);
    assert.equal((await read.json()).data.title, "Real session task proof");
    const replay = await tasksRoute(
      req("POST", { title: "Real session task proof" }),
    );
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).meta.replayed, true);
    assert.equal(
      (
        await tasksRoute(
          req("POST", { title: "x" }, { Origin: "https://example.invalid" }),
        )
      ).status,
      403,
    );
    assert.equal(
      (await tasksRoute(req("POST", { title: "x", ownerId: "forged" }))).status,
      422,
    );
    assert.equal(
      (
        await tasksRoute(
          req("POST", { title: "x" }, { "Content-Type": "text/plain" }),
        )
      ).status,
      415,
    );
    assert.equal(
      (await tasksRoute(req("POST", { title: "x".repeat(270000) }))).status,
      413,
    );
    const malformed = new Request(origin + "/api/tasks", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: "{",
    });
    assert.equal((await tasksRoute(malformed)).status, 400);
    const patch = await tasksRoute(
      req("PATCH", { expectedRevision: 1, title: "Edited with real session" }),
      { taskId: id },
    );
    assert.equal(patch.status, 200);
    const stale = await tasksRoute(
      req("PATCH", { expectedRevision: 1, title: "Stale" }),
      { taskId: id },
    );
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error.latest.record.revision, 2);
    console.log(
      "Real Better Auth session task create, read, replay, edit, conflict, owner omission, signed out denial, Origin, media type, byte limit, and JSON validation passed.",
    );
  } finally {
    if (id)
      await getPool().query("delete from tasks where id=$1 and owner_id=$2", [
        id,
        process.env.PERSONAL_ACCOUNT_ID,
      ]);
    await getPool().query(
      "delete from creation_receipts where owner_id=$1 and request_id=$2",
      [process.env.PERSONAL_ACCOUNT_ID, key],
    );
    await getPool().end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : "Task API proof failed.",
  );
  process.exitCode = 1;
});
