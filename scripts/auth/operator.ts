import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "../../lib/db/schema/auth";
import { databaseNow } from "../../lib/db/clock";
import { verifyOperatorIdentity, operatorCallback } from "./google-identity";

import { mutatePersonalBinding, OperatorRefusal } from "../../lib/auth/operator-data";

async function main() {
  const recovery = process.argv[2] === "recover";
  if (!recovery && process.argv[2] !== "setup") throw new Error("Choose setup or recover.");
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run this command in your own interactive terminal. Confirmation cannot be bypassed.");
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED is required.");
  const target = new URL(connectionString);
  if (target.hostname.includes("-pooler")) throw new Error("Use the direct database connection for operator commands.");
  const ownerId = process.env.PERSONAL_ACCOUNT_ID;
  if (recovery && !ownerId) throw new Error("PERSONAL_ACCOUNT_ID is required for recovery.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  let pool: Pool | undefined;
  let commitStarted = false;
  try {
    console.log(`Database: ${target.hostname}, ${decodeURIComponent(target.pathname.slice(1))}`);
    console.log(`Google must have this exact callback registered: ${operatorCallback}`);
    const identity = await verifyOperatorIdentity(controller.signal);
    console.log(`Verified Google email: ${identity.email}`);
    console.log(`Verified Google subject: ${identity.subject}`);
    console.log(recovery ? `Replace the Google identity for dashboard user ${ownerId}. All dashboard sessions will end. Task ownership stays unchanged.` : "Create the personal dashboard user, or return its existing ID for this same Google identity.");
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    let answer: string;
    try { answer = await terminal.question("Type CONFIRM to continue, or anything else to cancel: ", { signal: controller.signal }); }
    finally { terminal.close(); }
    if (answer !== "CONFIRM" || controller.signal.aborted) { console.log("Canceled. No account change was made."); return; }
    pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
    const db = drizzle(pool, { schema });
    commitStarted = true;
    const userId = await db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '20s'`);
      const lock = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(8147002001::bigint) AS locked`);
      if (!lock.rows[0]?.locked) throw new OperatorRefusal("Auth is busy. Retry the command.");
      if (controller.signal.aborted) throw new OperatorRefusal("Confirmation expired. Retry the command.");
      const result = await mutatePersonalBinding(tx, identity, recovery, ownerId, await databaseNow(tx));
      if (controller.signal.aborted) throw new OperatorRefusal("Confirmation expired. Retry the command.");
      return result;
    });
    console.log(JSON.stringify({ event: recovery ? "auth.recovery" : "auth.setup", requestId: randomUUID(), at: new Date().toISOString(), actor: "operator", result: "success" }));
    console.log(`PERSONAL_ACCOUNT_ID=${userId}`);
    if (recovery) console.log("Recovery committed. Dashboard user ID and task ownership are unchanged. All sessions have ended.");
  } catch (error) {
    if (error instanceof OperatorRefusal) throw error;
    if (commitStarted) throw new Error("The account operation did not confirm completion. A connection failure may have left its outcome uncertain. Rerun the same command with the same identity to resolve it safely.");
    throw error;
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    await pool?.end();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Operator command failed."); process.exitCode = 1; });
