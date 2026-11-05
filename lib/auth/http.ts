import { ipAddress } from "@vercel/functions";
import { consumeAuthAttempt, type attemptLimits } from "./attempts";
import { getPool } from "../db";
import { sessionConfig } from "./config";
import { authEvent } from "./events";
import { AuthFailure } from "./errors";

export function runtimeConfig() {
  try { return sessionConfig(); }
  catch { throw new AuthFailure(503, "CONFIGURATION_REQUIRED", "Private access needs configuration."); }
}
export function envelope(data: unknown, now: Date, headers?: HeadersInit) {
  const merged = new Headers(headers); merged.set("cache-control", "private, no-store");
  return Response.json({ data, meta: { requestId: crypto.randomUUID(), serverNow: now.toISOString() } }, { headers: merged });
}
export async function browserBody(request: Request, fields: string[]) {
  const config = runtimeConfig();
  if (request.headers.get("origin") !== config.origin) throw new AuthFailure(403, "ORIGIN_FORBIDDEN", "This request origin is unavailable.");
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new AuthFailure(415, "UNSUPPORTED_MEDIA_TYPE", "Use a JSON request.");
  const reader = request.body?.getReader();
  let size = 0; const chunks: Uint8Array[] = [];
  if (reader) try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 16384) { await reader.cancel(); throw new AuthFailure(413, "PAYLOAD_TOO_LARGE", "This request is too large."); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new AuthFailure(400, "INVALID_JSON", "This request needs valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).some(key => !fields.includes(key))) throw new AuthFailure(422, "VALIDATION_FAILED", "Check the request fields.");
  return parsed as Record<string, unknown>;
}
export async function limitRequest(request: Request, rule: keyof typeof attemptLimits) {
  const config = runtimeConfig();
  const address = process.env.NODE_ENV !== "production" ? "127.0.0.1" : process.env.VERCEL ? ipAddress(request) : undefined;
  const result = await consumeAuthAttempt(getPool(), rule, address, config.secret);
  if (!result.allowed) {
    authEvent("auth.throttled", "anonymous", Date.now());
    const response = Response.json({ error: { code: "RATE_LIMITED", message: "Please wait before trying again." }, meta: { requestId: crypto.randomUUID() } }, { status: 429, headers: { "Retry-After": String(result.retryAfter), "Cache-Control": "private, no-store" } });
    return response;
  }
}
export function methodNotAllowed(method: string) {
  return Response.json({ error: { code: "METHOD_NOT_ALLOWED", message: "This method is unavailable." }, meta: { requestId: crypto.randomUUID() } }, { status: 405, headers: { Allow: method, "Cache-Control": "private, no-store" } });
}
