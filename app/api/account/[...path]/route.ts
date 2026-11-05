import { authEvent } from "@/lib/auth/events";
import { eq } from "drizzle-orm";
import { getDb, getPool } from "@/lib/db";
import * as schema from "@/lib/db/schema/auth";
import { databaseNow } from "@/lib/db/clock";
import { resolvePersonalSession, sessionDTO } from "@/lib/auth/server";
import { createRequestAuth, day } from "@/lib/auth/request-auth";
import { runAuthMutation } from "@/lib/auth/transaction";
import { browserBody, limitRequest, envelope, methodNotAllowed, runtimeConfig } from "@/lib/auth/http";
import { AuthFailure, authErrorResponse } from "@/lib/auth/errors";

// Cache Components uses the default Node runtime and disallows segment runtime overrides.
async function handle(request: Request) {
  const startedAt = Date.now();
  const path = new URL(request.url).pathname;
  const read = path === "/api/account/session";
  const renew = path === "/api/account/session/renew";
  const all = path === "/api/account/sign-out-all";
  if (!read && !renew && !all) return new Response(null, { status: 404 });
  if (request.method !== (read ? "GET" : "POST")) return methodNotAllowed(read ? "GET" : "POST");
  try {
    const config = runtimeConfig();
    if (!read) {
      const body = await browserBody(request, all ? ["confirmed"] : []);
      if (all && body.confirmed !== true) throw new AuthFailure(422, "VALIDATION_FAILED", "Confirm signing out all devices.");
    }
    const limited = await limitRequest(request, read ? "session" : renew ? "renew" : "sign-out-all");
    if (limited) return limited;
    if (read) {
      const db = getDb(); const now = await databaseNow(db);
      const session = await resolvePersonalSession(db, request.headers, config, now);
      return envelope(await sessionDTO(db, session, now), now);
    }
    const response = await runAuthMutation(getPool(), async (tx, now) => {
      const session = await resolvePersonalSession(tx, request.headers, config, now);
      const auth = createRequestAuth(tx, config, now);
      if (all) {
        await tx.delete(schema.session).where(eq(schema.session.userId, session.userId));
        await tx.delete(schema.verification);
        const signedOut = await auth.handler(new Request(`${config.origin}/api/auth/sign-out`, { method: "POST", headers: request.headers, body: "{}" }));
        if (!signedOut.ok) throw new Error("Sign out did not confirm.");
        return envelope({ signedOut: true }, now, signedOut.headers);
      }
      const [row] = await tx.select({ updatedAt: schema.session.updatedAt }).from(schema.session).where(eq(schema.session.id, session.sessionId));
      let headers: Headers | undefined;
      if (row.updatedAt.getTime() + day <= now.getTime()) {
        const renewed = await auth.handler(new Request(`${config.origin}/api/auth/get-session`, { method: "POST", headers: request.headers, body: "{}" }));
        if (!renewed.ok || !await renewed.json()) throw new AuthFailure(401, "UNAUTHENTICATED", "Sign in to continue.");
        headers = renewed.headers;
      }
      const current = await resolvePersonalSession(tx, request.headers, config, now);
      return envelope(await sessionDTO(tx, current, now), now, headers);
    }, request.signal);
    if (all) authEvent("auth.sessions.revoked", "personal owner", startedAt);
    return response;
  } catch (error) { return authErrorResponse(error); }
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD, handle as OPTIONS };
