import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema/auth";
import { databaseNow } from "../db/clock";

type Database = ReturnType<typeof drizzle<typeof schema>>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Better Auth can replace a cookie in an after hook. Forward its final value. */
export function finalAuthResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  const cookies = new Map<string, string>();
  for (const cookie of headers.getSetCookie()) cookies.set(cookie.slice(0, cookie.indexOf("=")), cookie);
  headers.delete("set-cookie");
  for (const cookie of cookies.values()) headers.append("set-cookie", cookie);
  headers.set("cache-control", "private, no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** No response headers, cookies, or body leave this function before commit. */
export async function runAuthMutation(pool: Pool, operation: (tx: Transaction, now: Date) => Promise<Response>, signal?: AbortSignal): Promise<Response> {
  const startedAt = Date.now();
  if (signal?.aborted) throw new Error("REQUEST_TIMEOUT");
  const client = await pool.connect();
  const remaining = 20000 - (Date.now() - startedAt);
  if (remaining <= 0 || signal?.aborted) { client.release(true); throw new Error("REQUEST_TIMEOUT"); }
  let released = false;
  let expired = false;
  let rejectDeadline!: (error: Error) => void;
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const expire = () => {
    if (expired) return;
    expired = true; released = true;
    // Destroying the transaction connection prevents a delayed provider result
    // from committing writes after the response deadline or cancellation.
    client.release(true); rejectDeadline(new Error("REQUEST_TIMEOUT"));
  };
  const timer = setTimeout(expire, remaining);
  signal?.addEventListener("abort", expire, { once: true });
  try {
    const db = drizzle(client, { schema });
    const transaction = db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '20s'`);
      const lock = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(8147002001::bigint) AS locked`);
      if (!lock.rows[0]?.locked) throw new Error("AUTH_BUSY");
      const result = await operation(tx, await databaseNow(tx));
      const buffered = await result.arrayBuffer();
      if (expired) throw new Error("REQUEST_TIMEOUT");
      return new Response(buffered, { status: result.status, statusText: result.statusText, headers: result.headers });
    });
    const response = await Promise.race([transaction, deadline]);
    if (expired) throw new Error("REQUEST_TIMEOUT");
    return finalAuthResponse(response);
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", expire);
    if (!released) client.release();
  }
}
