import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as schema from "../../lib/db/schema/auth";

// Run only on an isolated development branch after db:migrate. This proves
// adapter rollback only. It does not stand in for the Google capability matrix.
async function main() {
  if (process.env.AUTH_PROOF_DEVELOPMENT !== "true") throw new Error("Development acknowledgement required.");
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) throw new Error("Development direct database configuration required.");
  const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000 });
  const id = randomUUID();
  const rollback = new Error("injected rollback");
  const hooks = new Set<string>();
  const writtenIds: Partial<Record<"user" | "account" | "session" | "verification", string>> = {};
  try {
    const db = drizzle(pool, { schema });
    await assert.rejects(db.transaction(async (tx) => {
      const locked = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(8147002001::bigint) AS locked`);
      assert.equal(locked.rows[0]?.locked, true);
      await tx.execute(sql`SET LOCAL statement_timeout = '20s'`);
      const transactionId = await tx.execute<{ id: string }>(sql`SELECT pg_current_xact_id()::text AS id`);
      async function observeWrite(table: "user" | "account" | "session" | "verification", rowId: string) {
        const observed = await tx.execute<{ transaction_id: string }>(sql`SELECT pg_current_xact_id()::text AS transaction_id FROM ${sql.identifier(table)} WHERE id = ${rowId}`);
        assert.equal(observed.rows.length, 1, "The write must be visible on the locked transaction connection.");
        assert.equal(observed.rows[0].transaction_id, transactionId.rows[0].id);
        writtenIds[table] = rowId;
        hooks.add(table);
      }
      const auth = betterAuth({
        baseURL: "http://localhost:3000",
        secret: randomBytes(32).toString("hex"),
        database: drizzleAdapter(tx, { provider: "pg", schema, transaction: true }),
        emailAndPassword: { enabled: false },
        session: { deferSessionRefresh: true, cookieCache: { enabled: false } },
        account: { storeStateStrategy: "database", accountLinking: { enabled: false } },
        databaseHooks: {
          user: { create: { after: async (row) => { await observeWrite("user", row.id); } } },
          account: { create: { after: async (row) => { await observeWrite("account", row.id); } } },
          session: { create: { after: async (row) => { await observeWrite("session", row.id); } } },
          verification: { create: { after: async (row) => { await observeWrite("verification", row.id); } } },
        },
      });
      const { internalAdapter: adapter } = await auth.$context;
      const now = new Date();
      const user = await adapter.createUser({ name: "Rollback proof", email: `${id}@example.invalid`, emailVerified: true }, { method: "oauth", oauth: { providerId: "google" } });
      await adapter.createAccount({ userId: user.id, providerId: "google", accountId: id });
      await adapter.createSession(user.id);
      await adapter.createVerificationValue({ identifier: id, value: id, expiresAt: new Date(now.getTime() + 600000) });
      assert.equal(hooks.size, 4, "All four write hooks must run before rollback.");
      throw rollback;
    }), (error) => error === rollback);
    const rows = await pool.query(`SELECT 1 FROM "user" WHERE email = $1
      UNION ALL SELECT 1 FROM account WHERE account_id = $2
      UNION ALL SELECT 1 FROM verification WHERE identifier = $2
      UNION ALL SELECT 1 FROM session WHERE id = $3`, [`${id}@example.invalid`, id, writtenIds.session]);
    assert.equal(rows.rowCount, 0, "No adapter writes may survive rollback.");
    console.log("Adapter writes and hooks used the locked transaction and rolled back. Other capability matrix rows remain unproved.");
  } finally { await pool.end(); }
}
main().catch(() => { console.error("Rollback capability proof failed or lacks development configuration. No capability pass recorded."); process.exitCode = 1; });
