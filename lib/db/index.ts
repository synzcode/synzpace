import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema/auth";

let pool: Pool | undefined;
export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString)
      throw new Error("Database configuration is required.");
    pool = new Pool({
      connectionString,
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
    });
    if (process.env.VERCEL) attachDatabasePool(pool);
  }
  return pool;
}
export function getDb() {
  return drizzle(getPool(), { schema });
}
