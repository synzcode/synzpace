import { timingSafeEqual } from "node:crypto";
import { cleanupAuth } from "@/lib/db/auth-cleanup";
import { getPool } from "@/lib/db";
import { AuthFailure, authErrorResponse } from "@/lib/auth/errors";
import { methodNotAllowed } from "@/lib/auth/http";

// Cache Components uses the default Node runtime and disallows segment runtime overrides.
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new AuthFailure(503, "CONFIGURATION_REQUIRED", "Maintenance needs configuration.");
    const actual = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AuthFailure(401, "UNAUTHENTICATED", "Maintenance authorization is required.");
    const counts = await cleanupAuth(getPool());
    console.log(JSON.stringify({ event: "auth.maintenance", requestId: crypto.randomUUID(), at: new Date().toISOString(), actor: "operator", result: "success", affected: counts.sessions + counts.proofs + counts.counters }));
    return Response.json(counts, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return authErrorResponse(error); }
}
function unsupported() { return methodNotAllowed("GET"); }
export { unsupported as POST, unsupported as PUT, unsupported as PATCH, unsupported as DELETE, unsupported as HEAD, unsupported as OPTIONS };
