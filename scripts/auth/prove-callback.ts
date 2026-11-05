import assert from "node:assert/strict";
import { createServer } from "node:http";
import { parseOAuthCallback } from "../../lib/auth/callback";
import { verifyOperatorIdentity } from "./google-identity";

async function main() {
  assert.deepEqual(parseOAuthCallback("code=valid&state=expected"), { code: "valid", state: "expected" });
  assert.deepEqual(parseOAuthCallback("error=access_denied&state=expected&error_uri=https%3A%2F%2Fexample.invalid"), { error: "access_denied", state: "expected" });
  assert.equal(parseOAuthCallback(`code=${"x".repeat(4096)}&state=${"s".repeat(2048)}`).state.length, 2048);
  for (const input of [
    "code=x", "state=x", "code=&state=x", "code=x&state=", "error=&state=x",
    "code=x&state=x&error=access_denied", "code=x&state=a&%73tate=b",
    "code=x&state=a&code=y", "error=a&error=b&state=x",
    "code=x&state=a&error_description=x&error_description=y",
    "code=%&state=x", "code=%FF&state=x", "code=x&state=x&ignored=%C0%AF",
    `code=${"x".repeat(4097)}&state=x`, `code=x&state=${"x".repeat(2049)}`,
    `error=${"x".repeat(129)}&state=x`, `code=x&state=x&error_description=${"x".repeat(1025)}`,
    `code=x&state=x&ignored=${"x".repeat(8192)}`,
    `code=x&state=x&error_description=${encodeURIComponent("é".repeat(513))}`,
  ]) assert.throws(() => parseOAuthCallback(input), "Unsafe callback must fail before provider work.");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(verifyOperatorIdentity(controller.signal), /expired|canceled/);
  const occupied = createServer();
  await new Promise<void>((resolve, reject) => { occupied.once("error", reject); occupied.listen(43871, "127.0.0.1", resolve); });
  try { await assert.rejects(verifyOperatorIdentity(new AbortController().signal), /Cannot listen/); }
  finally { await new Promise<void>((resolve, reject) => occupied.close(error => error ? reject(error) : resolve())); }
  console.log("Callback bounds, strict decoding, duplicate security keys, cancellation, and occupied operator port checks passed. No identity or account was created.");
}
main().catch(() => { console.error("Callback capability checks failed."); process.exitCode = 1; });
