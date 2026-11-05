import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { createRequestAuth } from "../../lib/auth/request-auth";
import { googleConfig, sessionConfig } from "../../lib/auth/config";
import { parseOAuthCallback } from "../../lib/auth/callback";
import { consumeAuthAttempt } from "../../lib/auth/attempts";
import { runAuthMutation } from "../../lib/auth/transaction";
import * as schema from "../../lib/db/schema/auth";

const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Private access integration proof</title><body><main><h1>Private access integration proof</h1><p>This local proof checks Google sign in for your provisioned dashboard account.</p><button id="start">Continue with Google</button><p id="status" role="status" aria-live="polite"></p></main><script>document.getElementById('start').onclick=async()=>{const b=document.getElementById('start');b.disabled=true;try{const r=await fetch('/api/auth/sign-in/social',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'google'})});const v=await r.json();if(!r.ok||typeof v.url!=='string')throw Error();location.assign(v.url)}catch{document.getElementById('status').textContent='Sign in could not start. Check your terminal and try again.';b.disabled=false}};</script></body></html>`;

async function body(request: IncomingMessage) {
  if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new Error();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16384) throw new Error();
    chunks.push(Buffer.from(chunk));
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || parsed.provider !== "google" || Object.keys(parsed).length !== 1) throw new Error();
}

async function main() {
  if (!process.stdin.isTTY || process.env.AUTH_PROOF_DEVELOPMENT !== "true" || !process.env.DATABASE_URL) throw new Error("Run this proof from your own development terminal.");
  const config = sessionConfig();
  if (config.origin !== "http://localhost:3000") throw new Error("This local proof requires BETTER_AUTH_URL=http://localhost:3000.");
  const google = googleConfig();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 15000 });
  let stopped = false;
  let successful = false;
  const server = createServer(async (incoming, outgoing) => {
    outgoing.setHeader("Cache-Control", "private, no-store");
    outgoing.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
    outgoing.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (incoming.headers.host !== "localhost:3000" || stopped) throw new Error();
      const raw = incoming.url ?? "";
      if (incoming.method === "GET" && (raw === "/" || raw === "/?reason=failed")) {
        outgoing.setHeader("Content-Type", "text/html; charset=utf-8");
        outgoing.end(successful ? "<!doctype html><html lang=en><meta charset=utf-8><title>Google proof passed</title><h1>Google integration proof passed</h1><p>Return to your terminal. This proof is ready to close.</p></html>" : page);
        return;
      }
      const start = incoming.method === "POST" && raw === "/api/auth/sign-in/social";
      const callback = incoming.method === "GET" && raw.startsWith("/api/auth/callback/google?");
      if (!start && !callback) { outgoing.writeHead(404); outgoing.end("Unavailable."); return; }
      if (start) {
        if (incoming.headers.origin !== config.origin) throw new Error();
        await body(incoming);
      } else parseOAuthCallback(raw.slice(raw.indexOf("?") + 1));
      const allowance = await consumeAuthAttempt(pool, start ? "sign-in" : "callback", "127.0.0.1", config.secret);
      if (!allowance.allowed) { outgoing.writeHead(429, { "Retry-After": String(allowance.retryAfter) }); outgoing.end("Please wait, then start sign in again."); return; }
      const headers = new Headers();
      for (const name of ["cookie", "origin", "user-agent"]) { const value = incoming.headers[name]; if (typeof value === "string") headers.set(name, value); }
      headers.set("Content-Type", "application/json");
      const request = new Request(`${config.origin}${raw}`, { method: incoming.method, headers, ...(start ? { body: JSON.stringify({ provider: "google", callbackURL: config.origin, errorCallbackURL: `${config.origin}/sign-in` }) } : {}) });
      let proved = false;
      const response = await runAuthMutation(pool, async (tx, now) => {
        const auth = createRequestAuth(tx, config, now, google);
        const result = await auth.handler(request);
        if (callback) {
          const location = new URL(result.headers.get("location") ?? "/sign-in", config.origin);
          if (location.origin === config.origin && location.pathname === "/" && !location.search) {
            const cookie = result.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
            const resolved = await createRequestAuth(tx, config, now).api.getSession({ headers: new Headers({ Cookie: cookie }), query: { disableRefresh: true } });
            assert.equal(resolved?.user.id, config.ownerId);
            const [binding] = await tx.select().from(schema.account).where(and(eq(schema.account.userId, config.ownerId), eq(schema.account.providerId, "google")));
            assert(binding);
            for (const key of ["accessToken", "refreshToken", "idToken", "scope", "password", "accessTokenExpiresAt", "refreshTokenExpiresAt"] as const) assert.equal(binding[key], null, "Provider credentials must not persist.");
            const [owner] = await tx.select().from(schema.user).where(eq(schema.user.id, config.ownerId));
            assert.equal(owner.image, null);
            assert.equal(owner.emailVerified, true);
            proved = true;
          } else {
            return new Response(null, { status: 302, headers: { Location: `${config.origin}/?reason=failed` } });
          }
        }
        return result;
      });
      if (proved) { successful = true; console.log("PASS: Real Google callback, bound identity, database session, empty provider token columns, discarded avatar, and response after commit. No credentials or identity details were logged."); }
      outgoing.statusCode = response.status;
      response.headers.forEach((value, name) => { if (name !== "set-cookie") outgoing.setHeader(name, value); });
      outgoing.setHeader("Set-Cookie", response.headers.getSetCookie());
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      console.error("Google proof request did not confirm success. Restart sign in after checking your registered callback and configuration.");
      outgoing.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }); outgoing.end("Proof unavailable. Return to your terminal and restart sign in.");
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 20000;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    server.close(); server.closeAllConnections();
    await pool.end();
    process.stdin.pause();
  };
  const timer = setTimeout(() => { console.log("Proof time limit reached."); void stop(); }, 10 * 60 * 1000);
  process.once("SIGINT", () => { clearTimeout(timer); void stop(); });
  process.once("SIGTERM", () => { clearTimeout(timer); void stop(); });
  server.once("error", () => { clearTimeout(timer); console.error("Port 3000 is unavailable. Stop your development server and retry this proof."); void stop(); process.exitCode = 1; });
  server.listen(3000, "127.0.0.1", () => {
    console.log("Register http://localhost:3000/api/auth/callback/google on your development Google client.");
    console.log("Your browser is opening http://localhost:3000. Continue with Google there. Ctrl+C closes the proof.");
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
    const browser = spawn(command, process.platform === "win32" ? ["url.dll,FileProtocolHandler", config.origin] : [config.origin], { stdio: "ignore" });
    browser.on("error", () => console.log("Open http://localhost:3000 in your browser to continue."));
  });
}
main().catch(() => { console.error("Google proof needs your development configuration and an interactive terminal."); process.exitCode = 1; });
