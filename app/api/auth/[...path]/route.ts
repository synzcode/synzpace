import { authEvent } from "@/lib/auth/events";
import { getPool } from "@/lib/db";
import { createRequestAuth } from "@/lib/auth/request-auth";
import { runAuthMutation } from "@/lib/auth/transaction";
import { browserBody, limitRequest, methodNotAllowed, runtimeConfig } from "@/lib/auth/http";
import { privateDestination } from "@/lib/auth/destinations";
import { googleConfig } from "@/lib/auth/config";
import { parseOAuthCallback } from "@/lib/auth/callback";
import { AuthFailure, authErrorResponse } from "@/lib/auth/errors";

// Cache Components uses the default Node runtime and disallows segment runtime overrides.
async function handle(request: Request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const start = url.pathname === "/api/auth/sign-in/social";
  const callback = url.pathname === "/api/auth/callback/google";
  const signOut = url.pathname === "/api/auth/sign-out";
  if (!start && !callback && !signOut) return new Response(null, { status: 404 });
  if (request.method !== (callback ? "GET" : "POST")) return methodNotAllowed(callback ? "GET" : "POST");
  try {
    const config = runtimeConfig();
    let body: Record<string, unknown> = {};
    if (callback) {
      try { parseOAuthCallback(request.url.slice(request.url.indexOf("?") + 1)); }
      catch { return new Response(null, { status: 302, headers: { Location: `${config.origin}/sign-in?reason=failed`, "Cache-Control": "private, no-store" } }); }
    } else body = await browserBody(request, start ? ["provider", "returnTo"] : []);
    if (start && (body.provider !== "google" || (body.returnTo !== undefined && typeof body.returnTo !== "string"))) throw new AuthFailure(422, "VALIDATION_FAILED", "Check the sign in request.");
    const limited = await limitRequest(request, callback ? "callback" : start ? "sign-in" : "sign-out");
    if (limited) {
      if (callback) return new Response('<!doctype html><html lang="en"><title>Please wait</title><h1>Please wait</h1><a href="/sign-in?reason=throttled">Return to sign in</a></html>', { status: 429, headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": limited.headers.get("retry-after")!, "Cache-Control": "private, no-store" } });
      return limited;
    }
    let google: ReturnType<typeof googleConfig> | undefined;
    if (!signOut) try { google = googleConfig(); } catch { throw new AuthFailure(503, "CONFIGURATION_REQUIRED", "Sign in is temporarily unavailable."); }
    const response = await runAuthMutation(getPool(), async (tx, now) => {
      const auth = createRequestAuth(tx, config, now, google);
      const destination = privateDestination(body.returnTo, config.origin);
      const internal = new Request(request.url, { method: request.method, headers: request.headers, ...(!callback ? { body: JSON.stringify(start ? { provider: "google", callbackURL: `${config.origin}${destination}`, errorCallbackURL: `${config.origin}/sign-in` } : {}) } : {}) });
      return auth.handler(internal);
    }, request.signal);
    if (callback) {
      const location = new URL(response.headers.get("location") ?? "/sign-in?reason=failed", config.origin);
      if (location.pathname === "/sign-in" || location.pathname.startsWith("/api/") || location.searchParams.has("error")) {
        const error = location.searchParams.get("error");
        const reason = error === "access_denied" ? (url.searchParams.has("error") ? "canceled" : "denied") : "failed";
        authEvent("auth.denial", "anonymous", startedAt);
        const headers = new Headers(response.headers); headers.set("location", `${config.origin}/sign-in?reason=${reason}`);
        return new Response(null, { status: 302, headers });
      }
      authEvent("auth.session.created", "personal owner", startedAt, 1);
      const headers = new Headers(response.headers); headers.set("location", `${config.origin}${privateDestination(location.pathname + location.search, config.origin)}`);
      return new Response(null, { status: 302, headers });
    }
    if (signOut && response.ok) authEvent("auth.session.revoked", "anonymous", startedAt);
    return response;
  } catch (error) {
    if (callback) {
      const reason = error instanceof Error && error.message === "AUTH_BUSY" ? "busy" : "unavailable";
      return new Response(null, { status: 302, headers: { Location: `/sign-in?reason=${reason}`, "Cache-Control": "private, no-store" } });
    }
    return authErrorResponse(error);
  }
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD, handle as OPTIONS };
