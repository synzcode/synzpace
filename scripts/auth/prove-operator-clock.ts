import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { databaseNow } from "../../lib/db/clock";
import * as schema from "../../lib/db/schema/auth";

async function main() {
  if (process.env.AUTH_PROOF_DEVELOPMENT !== "true" || !process.env.DATABASE_URL_UNPOOLED) throw new Error("Development database configuration required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1, connectionTimeoutMillis: 15000 });
  const db = drizzle(pool, { schema });
  const id = randomUUID();
  const rollback = new Error("Expected proof rollback");
  try {
    await assert.rejects(db.transaction(async tx => {
      const locked = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(8147002001::bigint) AS locked`);
      assert.equal(locked.rows[0]?.locked, true);
      const now = await databaseNow(tx);
      assert(now instanceof Date, "The database clock must be decoded into a Date before Drizzle timestamp writes.");
      assert(Number.isFinite(now.getTime()));
      await tx.insert(schema.user).values({ id, email: `${id}@example.invalid`, name: "Clock proof", emailVerified: true, createdAt: now, updatedAt: now });
      await tx.insert(schema.account).values({ id: randomUUID(), userId: id, providerId: "google", accountId: id, createdAt: now, updatedAt: now });
      await tx.update(schema.user).set({ updatedAt: await databaseNow(tx) }).where(eq(schema.user.id, id));
      throw rollback;
    }), error => error === rollback);
    const result = await pool.query('SELECT 1 FROM "user" WHERE id = $1 UNION ALL SELECT 1 FROM account WHERE user_id = $1', [id]);
    assert.equal(result.rowCount, 0);
    console.log("Database clock is a valid Date. Operator timestamp inserts and updates passed and rolled back without creating an account.");
  } finally { await pool.end(); }
}
main().catch(() => { console.error("Operator clock regression proof failed."); process.exitCode = 1; });
