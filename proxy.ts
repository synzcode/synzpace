import { NextResponse, type NextRequest } from "next/server";
import { parseOAuthCallback } from "@/lib/auth/callback";
import { sessionConfig } from "@/lib/auth/config";

/** Validate raw bytes before Next.js reserializes the query for Route Handlers. */
export function proxy(request: NextRequest) {
  if (request.method !== "GET") return NextResponse.next();
  const start = request.url.indexOf("?");
  try {
    parseOAuthCallback(start < 0 ? "" : request.url.slice(start + 1));
  } catch {
    let origin: string;
    try { origin = sessionConfig().origin; }
    catch { return new Response(null, { status: 503, headers: { "Cache-Control": "private, no-store" } }); }
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/sign-in?reason=failed`, "Cache-Control": "private, no-store" },
    });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/auth/callback/google" };
