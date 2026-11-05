import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import { Pool } from "pg";

async function main() {
  const origin = new URL(process.env.AUTH_PROOF_ORIGIN ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
  if (process.env.AUTH_PROOF_DEVELOPMENT !== "true" || !process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET || origin.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("A local development server and database are required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15000 });
  // Development resolves loopback; a local production server has no platform address.
  const buckets = ["127.0.0.1", "unknown"].map(address => `callback:%:${createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(address).digest("hex")}`);
  const count = async () => (await pool.query<{ count: number }>("SELECT coalesce(sum(count), 0)::integer AS count FROM auth_rate_limit WHERE key LIKE ANY($1::text[])", [buckets])).rows[0].count;
  async function callback(query: string) {
    return new Promise<{ status: number | undefined; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const request = http.get({ hostname: origin.hostname, port: origin.port, path: `/api/auth/callback/google?${query}` }, response => {
        response.resume(); response.on("end", () => resolve({ status: response.statusCode, headers: response.headers }));
      });
      request.on("error", reject);
    });
  }
  try {
    const malformed = ["state=x&code=%FF", "state=x&code=%C0%AF", "state=x&code=%ED%A0%80", "state=x&code=%", "state=x&code=valid&ignored=%FF", "state=x&code=valid&%FF=ignored", "state=x&%73tate=y&code=valid", `state=x&code=${"x".repeat(8193)}`];
    for (const query of malformed) {
      const before = await count();
      const response = await callback(query);
      assert.equal(response.status, 302);
      assert.equal(new URL(String(response.headers.location), origin).href, `${process.env.AUTH_PROOF_REDIRECT_ORIGIN ?? origin.origin}/sign-in?reason=failed`);
      assert.equal(response.headers["cache-control"], "private, no-store");
      assert.equal(response.headers["set-cookie"], undefined);
      assert.equal(await count(), before, "Malformed raw callback input must be rejected before counter mutation.");
    }
    // A real, correctly encoded replacement character is valid UTF8. It must
    // reach state verification rather than being confused with invalid bytes.
    for (const code of ["valid-code", "%EF%BF%BD"]) {
      const before = await count();
      const response = await callback(`state=nonexistent-proof&code=${code}`);
      assert.equal(response.status, 302);
      assert.equal(response.headers["cache-control"], "private, no-store");
      assert.equal(await count(), before + 1, "Valid encoding must reach the normal callback boundary.");
    }
    console.log("Running HTTP callback proof passed: malformed raw input never changes the counter; valid ASCII and encoded Unicode reach normal state verification. Redirects retain private, no-store.");
  } finally { await pool.end(); }
}
main().catch(error => { console.error("Running HTTP callback proof failed:", error instanceof assert.AssertionError ? error.message : "Check the local server and development database."); process.exitCode = 1; });
