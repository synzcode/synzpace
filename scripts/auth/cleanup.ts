import { Pool } from "pg";
import { cleanupAuth } from "../../lib/db/auth-cleanup";
async function main() {
  if (!process.env.DATABASE_URL) throw new Error();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15000 });
  try { console.log(JSON.stringify(await cleanupAuth(pool))); }
  finally { await pool.end(); }
}
main().catch(() => { console.error("Auth maintenance did not confirm completion. Check database availability, then retry."); process.exitCode = 1; });
