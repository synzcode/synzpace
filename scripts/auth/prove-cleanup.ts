import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { cleanupAuth } from "../../lib/db/auth-cleanup";
async function main() {
  if (process.env.AUTH_PROOF_DEVELOPMENT !== "true" || !process.env.DATABASE_URL || !process.env.PERSONAL_ACCOUNT_ID) throw new Error();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 15000 });
  const ids = Array.from({ length: 8 }, () => randomUUID());
  try {
    await pool.query(`INSERT INTO session(id,user_id,token,created_at,updated_at,expires_at) VALUES
      ($1,$4,$1,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '30 days'),
      ($2,$4,$2,clock_timestamp()-interval '40 days',clock_timestamp()-interval '40 days',clock_timestamp()-interval '10 days'),
      ($3,$4,$3,clock_timestamp()-interval '91 days',clock_timestamp(),clock_timestamp()+interval '10 days')`, [ids[0],ids[1],ids[2],process.env.PERSONAL_ACCOUNT_ID]);
    await pool.query(`INSERT INTO verification(id,identifier,value,expires_at) VALUES
      ($1,$1,'proof',clock_timestamp()-interval '1 hour'),($2,$2,'proof',clock_timestamp()+interval '1 hour')`, [ids[3],ids[4]]);
    await pool.query(`INSERT INTO auth_rate_limit(id,key,count,last_request) VALUES
      ($1,$1,1,floor(extract(epoch FROM clock_timestamp()-interval '25 hours')*1000)),
      ($2,$2,1,floor(extract(epoch FROM clock_timestamp())*1000))`, [ids[5],ids[6]]);
    // Hold a renewal lock during a sweep. Cleanup must skip the locked
    // session, then preserve it after renewal commits and sweeps overlap.
    await pool.query(`INSERT INTO session(id,user_id,token,created_at,updated_at,expires_at)
      VALUES ($1,$2,$1,clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 second')`, [ids[7], process.env.PERSONAL_ACCOUNT_ID]);
    const renewal = await pool.connect();
    try {
      await renewal.query("BEGIN");
      await renewal.query("SELECT id FROM session WHERE id=$1 FOR UPDATE", [ids[7]]);
      await renewal.query("UPDATE session SET expires_at=clock_timestamp()+interval '30 days',updated_at=clock_timestamp() WHERE id=$1", [ids[7]]);
      const counts = await cleanupAuth(pool);
      assert(counts.sessions >= 2 && counts.proofs >= 1 && counts.counters >= 1);
      assert.equal((await renewal.query("SELECT id FROM session WHERE id=$1", [ids[7]])).rowCount, 1);
      await renewal.query("COMMIT");
    } finally { await renewal.query("ROLLBACK"); renewal.release(); }
    const runs = await Promise.all([cleanupAuth(pool), cleanupAuth(pool)]);
    assert(runs.every(run => !run.remainingEligible));
    const sessions = await pool.query('SELECT id FROM session WHERE id=ANY($1::text[])', [ids]);
    assert.deepEqual(sessions.rows.map(row=>row.id).sort(), [ids[0], ids[7]].sort());
    const proofs = await pool.query('SELECT id FROM verification WHERE id=ANY($1::text[])', [ids]); assert.deepEqual(proofs.rows.map(row=>row.id),[ids[4]]);
    const counters = await pool.query('SELECT id FROM auth_rate_limit WHERE id=ANY($1::text[])', [ids]); assert.deepEqual(counters.rows.map(row=>row.id),[ids[6]]);
    console.log("Bounded cleanup removes expired sessions, sessions beyond 90 days, expired proofs, and stale counters. Active session, proof, and counter fixtures survived. Overlapping sweeps passed, and a locked session survived concurrent renewal and subsequent cleanup.");
  } finally {
    try { for (const table of ['session','verification','auth_rate_limit']) await pool.query(`DELETE FROM ${table} WHERE id=ANY($1::text[])`,[ids]); }
    finally { await pool.end(); }
  }
}
main().catch(error => { console.error("Cleanup proof failed:", error instanceof assert.AssertionError ? error.message : "Check database availability."); process.exitCode = 1; });
