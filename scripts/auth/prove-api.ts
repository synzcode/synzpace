import assert from "node:assert/strict";
import { GET as authGet, POST as authPost } from "../../app/api/auth/[...path]/route";
import { GET as accountGet, POST as accountPost } from "../../app/api/account/[...path]/route";
import { sessionConfig } from "../../lib/auth/config";
import { privateDestination } from "../../lib/auth/destinations";
import { getPool } from "../../lib/db";

async function main() {
  const { origin } = sessionConfig();
  const request = (path: string, body: string, headers?: Record<string, string>) => new Request(origin + path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body });
  assert.equal((await authGet(new Request(`${origin}/api/auth/get-session`))).status, 404);
  const method = await authGet(new Request(`${origin}/api/auth/sign-out`));
  assert.equal(method.status, 405); assert.equal(method.headers.get("allow"), "POST");
  assert.equal((await authPost(request("/api/auth/sign-in/social", '{"provider":"google"}', { Origin: "https://example.invalid" }))).status, 403);
  assert.equal((await authPost(request("/api/auth/sign-out", "{}", { "Content-Type": "text/plain" }))).status, 415);
  assert.equal((await authPost(request("/api/auth/sign-out", "not json"))).status, 400);
  assert.equal((await authPost(request("/api/auth/sign-out", JSON.stringify({ token: "forged" })))).status, 422);
  assert.equal((await authPost(request("/api/auth/sign-out", " ".repeat(16385)))).status, 413);
  assert.equal((await accountPost(request("/api/account/sign-out-all", "{}"))).status, 422);
  assert.equal((await accountPost(request("/api/account/session/renew", JSON.stringify({ userId: "forged" })))).status, 422);
  const session = await accountGet(new Request(`${origin}/api/account/session`));
  assert.equal(session.status, 401); assert.equal((await session.json()).error.code, "UNAUTHENTICATED");
  assert.equal(session.headers.get("cache-control"), "private, no-store");
  const first = await authPost(request("/api/auth/sign-out", "{}"));
  const second = await authPost(request("/api/auth/sign-out", "{}"));
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal((await second.json()).success, true);
  for (const query of ["state=x&%73tate=y&code=x", "code=x", "state=x&code=%FF", `state=x&code=${"x".repeat(8193)}`]) {
    const malformed = await authGet(new Request(`${origin}/api/auth/callback/google?${query}`));
    assert.equal(malformed.status, 302);
    assert.equal(malformed.headers.get("location"), `${origin}/sign-in?reason=failed`);
    assert.equal(malformed.headers.get("cache-control"), "private, no-store", "Malformed callback redirects must prevent caching.");
    assert.equal(malformed.headers.get("set-cookie"), null);
  }
  for (const value of ["https://example.invalid", "//example.invalid", "/api/auth/sign-out", "/sign-in", "/%2fexample.invalid", "/account/access#fragment", "/\\evil", "/account/access?x=%FF"]) assert.equal(privateDestination(value, origin), "/");
  assert.equal(privateDestination("/account/access?a=1&a=2&_rsc=transport", origin), "/account/access?a=1&a=2");
  console.log("Permanent API checks passed: closed endpoints, exact origin, bounded JSON, method restrictions, signed out denial, idempotent device sign out, callback rejection, and local destination validation.");
}
main().catch(error => { console.error("Permanent API proof failed:", error instanceof assert.AssertionError ? error.message : "Check configuration and database availability."); process.exitCode = 1; }).finally(async () => { await getPool().end(); });
