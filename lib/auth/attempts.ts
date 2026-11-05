import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { Pool } from "pg";

export const attemptLimits = {
  "sign-in": 10, callback: 20, session: 120, renew: 120, "sign-out": 120, "sign-out-all": 120,
} as const;

export function canonicalAddress(address: string | undefined): string {
  if (!address || !isIP(address)) return "unknown";
  if (isIP(address) === 4) return address;
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const halves = normalized.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  const words = groups.map(group => parseInt(group, 16));
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
    return [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join(".");
  }
  return `${words.slice(0, 4).map(word => word.toString(16)).join(":")}::/64`;
}

/** Call on the pool before opening the auth transaction, never on its client. */
export async function consumeAuthAttempt(pool: Pool, rule: keyof typeof attemptLimits, address: string | undefined, secret: string) {
  if (secret.length < 32) throw new Error("Auth secret configuration required.");
  const digest = createHmac("sha256", secret).update(canonicalAddress(address)).digest("hex");
  const result = await pool.query<{ allowed: boolean; retry_after: number }>(`
    WITH clock AS MATERIALIZED (
      SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
    ), attempt_window AS (
      SELECT now_ms, (now_ms / 60000) * 60000 AS start_ms FROM clock
    ), consumed AS (
      INSERT INTO auth_rate_limit (id, key, count, last_request)
      SELECT $1, $2 || ':' || start_ms::text || ':' || $3, 1, now_ms FROM attempt_window
      ON CONFLICT (key) DO UPDATE
        SET count = auth_rate_limit.count + 1, last_request = EXCLUDED.last_request
        WHERE auth_rate_limit.count < $4
      RETURNING 1
    )
    SELECT EXISTS(SELECT 1 FROM consumed) AS allowed,
      greatest(1, ceil((start_ms + 60000 - now_ms)::numeric / 1000))::integer AS retry_after
    FROM attempt_window`, [randomUUID(), rule, digest, attemptLimits[rule]]);
  if (!result.rows[0]) throw new Error("Attempt counter unavailable.");
  return { allowed: result.rows[0].allowed, retryAfter: result.rows[0].retry_after };
}
