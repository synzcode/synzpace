import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "../../lib/db/schema/auth";
import { databaseNow } from "../../lib/db/clock";
import { sessionConfig } from "../../lib/auth/config";
import { createRequestAuth } from "../../lib/auth/request-auth";

async function main() {
  if (process.env.AUTH_PROOF_DEVELOPMENT !== "true" || !process.env.DATABASE_URL) throw new Error("Development database required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15000 });
  const config = sessionConfig();
  const rollback = new Error("Expected proof rollback");
  try {
    await assert.rejects(drizzle(pool, { schema }).transaction(async tx => {
      assert.equal((await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(8147002001::bigint) AS locked`)).rows[0]?.locked, true);
      const [owner] = await tx.select().from(schema.user).where(eq(schema.user.id, config.ownerId));
      const [binding] = await tx.select().from(schema.account).where(and(eq(schema.account.userId, config.ownerId), eq(schema.account.providerId, "google")));
      assert(owner && binding);
      const auth = createRequestAuth(tx, config, await databaseNow(tx));
      const context = await auth.$context;
      const validate = auth.options.user.validateUserInfo;
      const profile = { sub: binding.accountId, email: owner.email, email_verified: true, name: owner.name };
      const policy = (claims: Record<string, unknown>, userId = owner.id) => validate({ user: { id: userId, email: owner.email }, source: { action: "sign-in", method: "oauth", oauth: { providerId: "google", profile: claims } } });
      assert((await policy({ ...profile, sub: randomUUID() }))?.error, "Matching email cannot replace a different subject.");
      assert((await policy({ ...profile, email_verified: false }))?.error);
      assert((await policy(profile, randomUUID()))?.error, "A forged owner input must fail.");
      await assert.rejects(context.internalAdapter.createSession(owner.id));
      assert.equal(await policy(profile), undefined);
      const session = await context.internalAdapter.createSession(owner.id);
      assert.equal(session.userId, owner.id);
      await context.internalAdapter.updateAccount(binding.id, { accessToken: "proof access token", refreshToken: "proof refresh token", idToken: "proof identity token", scope: "proof" });
      const [updated] = await tx.select().from(schema.account).where(eq(schema.account.id, binding.id));
      for (const field of ["accessToken", "refreshToken", "idToken", "scope"] as const) assert.equal(updated[field], null);
      assert((await policy({ ...profile, sub: randomUUID() }))?.error);
      await assert.rejects(context.internalAdapter.createSession(owner.id), "Rejected identity must clear any earlier request identity.");
      throw rollback;
    }), error => error === rollback);
    console.log("Identity policy rejects another subject with matching email, unverified profiles, forged owners, and missing request identity. Token suppression hooks passed. All test changes rolled back. Real Google callback proof remains separate.");
  } finally { await pool.end(); }
}
main().catch(error => { console.error("Identity policy proof failed:", error instanceof assert.AssertionError ? error.message : "Check the pinned integration."); process.exitCode = 1; });
