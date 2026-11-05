import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** Raw Drizzle timestamp results need decoding before timestamp column writes. */
export async function databaseNow(db: Pick<NodePgDatabase, "execute">): Promise<Date> {
  const result = await db.execute<{ now: string | Date }>(sql`SELECT clock_timestamp() AS now`);
  const value = result.rows[0]?.now;
  if (value === undefined) throw new Error("Database clock is unavailable.");
  const now = new Date(value);
  if (!Number.isFinite(now.getTime())) throw new Error("Database clock is unavailable.");
  return now;
}
