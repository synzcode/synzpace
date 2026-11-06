import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { serializeSignedCookie } from "better-call";
import { GET as cleanup } from "../../app/api/internal/auth/cleanup/route";
import { requirePersonalSession } from "../../lib/auth/server";
import { getPool } from "../../lib/db";

async function main() {
  if (process.env.AUTH_PROOF_DEVELOPMENT !== "true") throw new Error("Development acknowledgement required.");
  const names = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "CRON_SECRET", "DATABASE_URL_UNPOOLED", "PERSONAL_ACCOUNT_ID", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const restore = () => { for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } };
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT token FROM session WHERE user_id=$1
      AND expires_at>clock_timestamp() AND created_at+interval '90 days'>clock_timestamp() LIMIT 1`, [saved.PERSONAL_ACCOUNT_ID]);
    assert.equal(rows.length, 1, "A real Google session is required for capability isolation proof.");
    const cookieName = saved.BETTER_AUTH_URL?.startsWith("https:") ? "__Secure-better-auth.session_token" : "better-auth.session_token";
    const cookie = (await serializeSignedCookie(cookieName, rows[0].token, saved.BETTER_AUTH_SECRET!, { path: "/", httpOnly: true, sameSite: "lax" })).split(";")[0];
    for (const name of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "CRON_SECRET", "DATABASE_URL_UNPOOLED"]) delete process.env[name];
    assert.equal((await requirePersonalSession(new Headers({ Cookie: cookie }))).userId, saved.PERSONAL_ACCOUNT_ID);
    const absent = await cleanup(new Request("http://localhost/api/internal/auth/cleanup"));
    assert.equal(absent.status, 503);
    assert.equal((await absent.json()).error.code, "CONFIGURATION_REQUIRED");
    // This ephemeral bearer is confined to this direct handler proof.
    const secret = randomBytes(32).toString("hex");
    process.env.CRON_SECRET = secret;
    for (const name of ["PERSONAL_ACCOUNT_ID", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"]) delete process.env[name];
    for (const authorization of [undefined, "Bearer incorrect"]) {
      const denied = await cleanup(new Request("http://localhost/api/internal/auth/cleanup", { headers: authorization ? { Authorization: authorization } : {} }));
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.get("cache-control"), "private, no-store");
    }
    const allowed = await cleanup(new Request("http://localhost/api/internal/auth/cleanup", { headers: { Authorization: `Bearer ${secret}` } }));
    assert.equal(allowed.status, 200);
    const body = await allowed.json();
    assert.equal(typeof body.remainingEligible, "boolean");
    for (const field of ["sessions", "proofs", "counters"]) assert(Number.isInteger(body[field]) && body[field] >= 0);
    assert.equal(allowed.headers.get("cache-control"), "private, no-store");
    console.log("Capability isolation passed: real session without Google, Cron, or migration settings; maintenance without auth, Google, owner, or migration settings; missing and wrong bearer rejected.");
  } finally { restore(); await getPool().end(); }
}
main().catch(error => { console.error("Configuration proof failed:", error instanceof assert.AssertionError ? error.message : "Check development database and real Google session availability."); process.exitCode = 1; });
