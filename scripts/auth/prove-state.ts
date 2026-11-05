import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import * as schema from "../../lib/db/schema/auth";
import { databaseNow } from "../../lib/db/clock";
import { createRequestAuth } from "../../lib/auth/request-auth";
import { googleConfig, sessionConfig } from "../../lib/auth/config";

async function main() {
  if (process.env.AUTH_PROOF_DEVELOPMENT !== "true" || !process.env.DATABASE_URL) throw new Error("Development database required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15000 });
  const rollback = new Error("Expected proof rollback");
  try {
    await assert.rejects(drizzle(pool, { schema }).transaction(async tx => {
      assert.equal((await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(8147002001::bigint) AS locked`)).rows[0]?.locked, true);
      const config = sessionConfig();
      const auth = createRequestAuth(tx, config, await databaseNow(tx), googleConfig());
      const start = async () => {
        const response = await auth.handler(new Request(`${config.origin}/api/auth/sign-in/social`, { method: "POST", headers: { Origin: config.origin, "Content-Type": "application/json" }, body: JSON.stringify({ provider: "google", callbackURL: config.origin, errorCallbackURL: `${config.origin}/sign-in` }) }));
        assert.equal(response.status, 200);
        const body = await response.json();
        const state = new URL(body.url).searchParams.get("state")!;
        const [proof] = await tx.select().from(schema.verification).where(eq(schema.verification.identifier, `auth-state:${state}`));
        assert(proof);
        const value = JSON.parse(proof.value);
        assert(value.expiresAt > Date.now() + 590000 && value.expiresAt <= Date.now() + 600000);
        assert.equal(value.callbackURL, config.origin);
        const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
        assert(cookie);
        return { state, proof, cookie };
      };
      const callback = (state: string, cookie?: string) => auth.handler(new Request(`${config.origin}/api/auth/callback/google?error=access_denied&state=${encodeURIComponent(state)}`, { headers: cookie ? { Cookie: cookie } : {} }));
      const first = await start();
      const missing = await callback(first.state);
      assert(missing.headers.get("location")?.includes("state_mismatch"));
      const denied = await callback(first.state, first.cookie);
      assert(denied.headers.get("location")?.includes("access_denied"));
      assert.equal((await tx.select().from(schema.verification).where(eq(schema.verification.id, first.proof.id))).length, 0);
      const replay = await callback(first.state, first.cookie);
      assert(replay.headers.get("location")?.includes("state_mismatch"));
      const expired = await start();
      await tx.update(schema.verification).set({ expiresAt: new Date(0), value: JSON.stringify({ ...JSON.parse(expired.proof.value), expiresAt: 0 }) }).where(eq(schema.verification.id, expired.proof.id));
      assert((await callback(expired.state, expired.cookie)).headers.get("location")?.includes("state_mismatch"));
      const invalidated = await start();
      await tx.delete(schema.verification).where(eq(schema.verification.id, invalidated.proof.id));
      assert((await callback(invalidated.state, invalidated.cookie)).headers.get("location")?.includes("state_mismatch"));
      const tokenInput = await auth.handler(new Request(`${config.origin}/api/auth/sign-in/social`, { method: "POST", headers: { Origin: config.origin, "Content-Type": "application/json" }, body: JSON.stringify({ provider: "google", idToken: { token: "untrusted" } }) }));
      assert.equal(tokenInput.status, 403);
      throw rollback;
    }), error => error === rollback);
    console.log("Database OAuth proof expiry, signed cookie requirement, consumption, replay rejection, invalidation, and direct token rejection passed. Proof writes rolled back.");
  } finally { await pool.end(); }
}
main().catch(error => { console.error("OAuth state capability proof failed:", error instanceof assert.AssertionError ? error.message : "Check the pinned integration."); process.exitCode = 1; });
