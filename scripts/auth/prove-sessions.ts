import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { serializeSignedCookie } from "better-call";
import * as schema from "../../lib/db/schema/auth";
import { databaseNow } from "../../lib/db/clock";
import { createRequestAuth, day } from "../../lib/auth/request-auth";
import { finalAuthResponse } from "../../lib/auth/transaction";
import { sessionConfig } from "../../lib/auth/config";

async function main() {
  if (process.env.AUTH_PROOF_DEVELOPMENT !== "true" || !process.env.DATABASE_URL) throw new Error("Development database required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15000 });
  const db = drizzle(pool, { schema });
  const rollback = new Error("Expected proof rollback");
  try {
    await assert.rejects(db.transaction(async tx => {
      const locked = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(8147002001::bigint) AS locked`);
      assert.equal(locked.rows[0]?.locked, true);
      const now = await databaseNow(tx);
      const config = sessionConfig();
      // No Google or Cron configuration is passed to this session instance.
      const auth = createRequestAuth(tx, config, now);
      const context = await auth.$context;
      const token = randomUUID();
      const id = randomUUID();
      const createdAt = new Date(now.getTime() - 89 * day);
      const updatedAt = new Date(now.getTime() - 29 * day);
      const expiresAt = new Date(now.getTime() + day);
      await tx.insert(schema.session).values({ id, userId: config.ownerId, token, createdAt, updatedAt, expiresAt });
      const cookie = (await serializeSignedCookie(context.authCookies.sessionToken.name, token, config.secret, context.authCookies.sessionToken.attributes)).split(";")[0];
      const request = (method: string) => new Request(`${config.origin}/api/auth/get-session`, { method, headers: { Cookie: cookie, Origin: config.origin, "Content-Type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) });
      const read = await auth.handler(request("GET"));
      assert.equal(read.status, 200);
      const readBody = await read.json();
      assert.equal(readBody.user.id, config.ownerId);
      assert.equal(readBody.needsRefresh, true);
      const [afterRead] = await tx.select().from(schema.session).where(eq(schema.session.id, id));
      assert.equal(afterRead.updatedAt.getTime(), updatedAt.getTime(), "GET must not renew.");
      const renewed = finalAuthResponse(await auth.handler(request("POST")));
      assert.equal(renewed.status, 200);
      await renewed.json();
      const [afterRenewal] = await tx.select().from(schema.session).where(eq(schema.session.id, id));
      assert.equal(afterRenewal.createdAt.getTime(), createdAt.getTime());
      assert.equal(afterRenewal.expiresAt.getTime(), createdAt.getTime() + 90 * day);
      assert.equal(afterRenewal.updatedAt.getTime(), now.getTime());
      const cookies = renewed.headers.getSetCookie();
      const sessionCookies = cookies.filter(value => value.startsWith(`${context.authCookies.sessionToken.name}=`));
      assert(sessionCookies.length >= 1, "Renewal must stage a persistent signed cookie.");
      for (const value of sessionCookies) {
        const maxAge = /max-age=(\d+)/i.exec(value);
        assert(maxAge && Number(maxAge[1]) <= 86400, "No final session cookie may outlive the absolute cap.");
        assert(/httponly/i.test(value) && /samesite=lax/i.test(value));
      }
      const again = await auth.handler(request("POST"));
      assert.equal(again.status, 200);
      const [afterAgain] = await tx.select().from(schema.session).where(eq(schema.session.id, id));
      assert.equal(afterAgain.expiresAt.getTime(), afterRenewal.expiresAt.getTime());
      await tx.update(schema.session).set({ createdAt: new Date(now.getTime() - 90 * day), expiresAt: new Date(now.getTime() + day) }).where(eq(schema.session.id, id));
      assert.equal((await auth.handler(request("GET"))).status, 401);
      await tx.update(schema.session).set({ createdAt, expiresAt: now }).where(eq(schema.session.id, id));
      assert.equal((await auth.handler(request("POST"))).status, 401);
      await tx.update(schema.session).set({ createdAt, expiresAt: new Date(now.getTime() + day) }).where(eq(schema.session.id, id));
      const revokeRequest = () => new Request(`${config.origin}/api/auth/sign-out`, { method: "POST", headers: { Cookie: cookie, Origin: config.origin, "Content-Type": "application/json" }, body: "{}" });
      const revoked = await auth.handler(revokeRequest());
      assert.equal(revoked.status, 200);
      assert.equal((await revoked.json()).success, true);
      assert(revoked.headers.getSetCookie().some(value => /max-age=0/i.test(value)));
      assert.equal((await tx.select().from(schema.session).where(eq(schema.session.id, id))).length, 0);
      assert.equal((await auth.handler(revokeRequest())).status, 200);
      assert.equal(await (await auth.handler(request("GET"))).json(), null);
      await assert.rejects(context.internalAdapter.createSession(config.ownerId), /Private access/);
      await assert.rejects(context.internalAdapter.createUser({ name: "Forbidden", email: `${randomUUID()}@example.invalid` }, { method: "admin" }), /Private access|User validation requires an endpoint context/);
      throw rollback;
    }), error => error === rollback);
    console.log("Live database sessions work without Google or Cron settings. GET does not renew; POST renewal and its cookie respect the 90 day cap; expiry, revocation, and missing verified identity reject access. Proof writes rolled back.");
  } finally { await pool.end(); }
}
main().catch(error => { console.error("Session capability proof failed:", error instanceof assert.AssertionError ? error.message : "Check the pinned integration."); process.exitCode = 1; });
