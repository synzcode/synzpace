import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../../lib/db/schema/auth";
import { sessionConfig, googleConfig } from "../../lib/auth/config";
import { createRequestAuth } from "../../lib/auth/request-auth";
import { runAuthMutation } from "../../lib/auth/transaction";

async function main() {
  if (process.env.AUTH_PROOF_DEVELOPMENT !== "true" || !process.env.DATABASE_URL) throw new Error("Development database required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 15000 });
  const config = sessionConfig();
  const google = googleConfig();
  const identifiers: string[] = [];
  const injected = new Error("Expected precommit failure");
  let escaped: Response | undefined;
  try {
    const operation = async (fail: boolean) => runAuthMutation(pool, async (tx, now) => {
      const auth = createRequestAuth(tx, config, now, google);
      const response = await auth.handler(new Request(`${config.origin}/api/auth/sign-in/social`, { method: "POST", headers: { Origin: config.origin, "Content-Type": "application/json" }, body: JSON.stringify({ provider: "google", callbackURL: config.origin }) }));
      assert.equal(response.status, 200);
      assert(response.headers.getSetCookie().length > 0);
      const body = await response.clone().json();
      identifiers.push(`auth-state:${new URL(body.url).searchParams.get("state")}`);
      if (fail) throw injected;
      return response;
    });
    await assert.rejects(async () => { escaped = await operation(true); }, error => error === injected);
    assert.equal(escaped, undefined, "No response or headers may escape an unsuccessful transaction.");
    const db = drizzle(pool, { schema });
    assert.equal((await db.select().from(schema.verification).where(eq(schema.verification.identifier, identifiers[0]))).length, 0);
    const committed = await operation(false);
    assert(committed.headers.getSetCookie().length > 0);
    assert.equal(committed.headers.get("cache-control"), "private, no-store");
    assert.equal((await db.select().from(schema.verification).where(eq(schema.verification.identifier, identifiers[1]))).length, 1);
    console.log("The real auth handler staged proof writes and cookies. Injected failure rolled back its proof and returned no response. Successful response became available only after its proof committed.");
  } finally {
    try {
      await runAuthMutation(pool, async tx => {
        for (const identifier of identifiers) await tx.delete(schema.verification).where(eq(schema.verification.identifier, identifier));
        return Response.json({ success: true });
      });
    } finally { await pool.end(); }
  }
}
main().catch(() => { console.error("Response and commit ordering capability proof failed."); process.exitCode = 1; });
