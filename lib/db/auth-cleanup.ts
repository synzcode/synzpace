import type { Pool, QueryConfig } from "pg";

const rules = {
  sessions: { table: '"session"', eligible: "expires_at <= clock_timestamp() OR created_at + interval '90 days' <= clock_timestamp()" },
  proofs: { table: '"verification"', eligible: "expires_at <= clock_timestamp()" },
  counters: { table: '"auth_rate_limit"', eligible: "last_request < floor(extract(epoch FROM clock_timestamp() - interval '24 hours') * 1000)::bigint" },
} as const;

/** Pure bounded maintenance, independent of auth, Google, owner, and Cron config. */
export async function cleanupAuth(pool: Pool) {
  const deadline = Date.now() + 18000;
  const counts = { sessions: 0, proofs: 0, counters: 0 };
  let removed = true;
  while (removed && Date.now() < deadline - 1000) {
    removed = false;
    for (const [kind, { table, eligible }] of Object.entries(rules)) {
      if (Date.now() >= deadline - 1000) break;
      const query: QueryConfig & { query_timeout: number } = { text: `WITH batch AS (
        SELECT id FROM ${table} WHERE ${eligible} LIMIT 100 FOR UPDATE SKIP LOCKED
      ) DELETE FROM ${table} WHERE id IN (SELECT id FROM batch) AND (${eligible}) RETURNING id`, query_timeout: Math.max(1, deadline - Date.now()) };
      const result = await pool.query(query);
      const count = result.rowCount ?? 0;
      counts[kind as keyof typeof counts] += count;
      if (count) removed = true;
    }
  }
  const remainingQuery: QueryConfig & { query_timeout: number } = { text: `SELECT (${Object.values(rules).map(({ table, eligible }) => `EXISTS(SELECT 1 FROM ${table} WHERE ${eligible})`).join(" OR ")}) AS eligible`, query_timeout: Math.max(1, deadline - Date.now()) };
  const remaining = await pool.query<{ eligible: boolean }>(remainingQuery);
  return { ...counts, remainingEligible: remaining.rows[0].eligible };
}
