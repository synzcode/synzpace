import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import { Pool } from "pg";
import { consumeAuthAttempt, canonicalAddress } from "../../lib/auth/attempts";

async function main() {
  if (process.env.AUTH_PROOF_DEVELOPMENT !== "true" || !process.env.DATABASE_URL) throw new Error("Development database required.");
  const pools = [0, 1].map(() => new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 15000 }));
  const secret = randomBytes(32).toString("hex");
  const digest = createHmac("sha256", secret).update("127.0.0.1").digest("hex");
  try {
    assert.equal(canonicalAddress("::ffff:192.0.2.128"), "192.0.2.128");
    assert.equal(canonicalAddress("0:0:0:0:0:ffff:c000:280"), "192.0.2.128");
    assert.equal(canonicalAddress("2001:db8:abcd:1234:1:2:3:4"), canonicalAddress("2001:db8:abcd:1234::99"));
    assert.equal(canonicalAddress(undefined), "unknown");
    const attempts = await Promise.all(Array.from({ length: 24 }, (_, index) => consumeAuthAttempt(pools[index % 2], "sign-in", "127.0.0.1", secret)));
    assert(attempts.every(attempt => attempt.retryAfter >= 1 && attempt.retryAfter <= 60));
    const rows = await pools[0].query('SELECT count FROM auth_rate_limit WHERE key LIKE $1', [`sign-in:%:${digest}`]);
    assert(rows.rows.every(row => row.count <= 10));
    assert.equal(attempts.filter(attempt => attempt.allowed).length, rows.rows.reduce((sum, row) => sum + row.count, 0));
    assert(attempts.some(attempt => !attempt.allowed));
    const client = await pools[0].connect();
    try {
      await client.query('BEGIN');
      await consumeAuthAttempt(pools[1], "session", "127.0.0.1", secret);
      await client.query('ROLLBACK');
    } finally { client.release(); }
    const retained = await pools[1].query('SELECT count FROM auth_rate_limit WHERE key LIKE $1', [`session:%:${digest}`]);
    assert.equal(retained.rows.length, 1);
    assert.equal(retained.rows[0].count, 1);
    console.log("Atomic counters across two pools respect their window limit, return bounded retry delays, and stay committed after auth rollback. Address normalization checks passed.");
  } finally {
    try { await pools[0].query('DELETE FROM auth_rate_limit WHERE key LIKE $1', [`%:${digest}`]); }
    finally { await Promise.all(pools.map(pool => pool.end())); }
  }
}
main().catch(() => { console.error("Shared attempt counter capability proof failed."); process.exitCode = 1; });
