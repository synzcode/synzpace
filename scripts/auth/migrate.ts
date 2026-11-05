import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED is required for migration.");
  const url = new URL(connectionString);
  if (url.hostname.includes("-pooler")) throw new Error("Migration requires a direct connection.");
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    const result = await pool.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [["user", "account", "session", "verification", "auth_rate_limit"]]);
    if (result.rowCount !== 5) throw new Error("Auth schema verification failed.");
    console.log("Auth migration applied, all five tables confirmed.");
  } finally { await pool.end(); }
}
main().catch(() => { console.error("Migration failed. Check the direct database configuration and migration history."); process.exitCode = 1; });
