import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { parseOAuthCallback } from "../../lib/auth/callback";

export type VerifiedIdentity = { subject: string; email: string; name: string };
export const operatorCallback = "http://127.0.0.1:43871/oauth/google/callback";

export async function verifyOperatorIdentity(signal: AbortSignal): Promise<VerifiedIdentity> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google client configuration is required.");
  const client = new OAuth2Client(clientId, clientSecret, operatorCallback);
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const url = client.generateAuthUrl({
    scope: ["openid", "email", "profile"], prompt: "select_account", state, nonce,
    code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256,
  });
  return new Promise<VerifiedIdentity>((resolve, reject) => {
    let consumed = false;
    let finished = false;
    const finish = (error?: Error, identity?: VerifiedIdentity) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", abort);
      server.close();
      if (error) reject(error); else resolve(identity!);
    };
    const abort = () => finish(new Error("Identity verification expired or was canceled. No account change was made."));
    const server = createServer(async (request, response) => {
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
      if (request.method !== "GET") { response.writeHead(405, { Allow: "GET" }); response.end("Method unavailable."); return; }
      try {
        if (consumed || finished || signal.aborted || request.headers.host !== "127.0.0.1:43871") throw new Error();
        const raw = request.url ?? "";
        const queryStart = raw.indexOf("?");
        if (queryStart < 0 || raw.slice(0, queryStart) !== "/oauth/google/callback" || raw.includes("#")) throw new Error();
        const callback = parseOAuthCallback(raw.slice(queryStart + 1));
        const received = Buffer.from(callback.state);
        const expected = Buffer.from(state);
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error();
        consumed = true;
        if ("error" in callback) throw new Error();
        const { tokens } = await client.getToken({ code: callback.code, codeVerifier, redirect_uri: operatorCallback });
        if (!tokens.id_token) throw new Error();
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
        const claims = ticket.getPayload();
        if (!claims || claims.nonce !== nonce || !claims.sub || !claims.email || claims.email_verified !== true || !claims.name?.trim() || !claims.exp || claims.exp * 1000 <= Date.now() || signal.aborted || finished) throw new Error();
        response.end("Identity verified. Return to your terminal to review and confirm. No account change has been made yet.");
        finish(undefined, { subject: claims.sub, email: claims.email, name: claims.name.trim() });
      } catch {
        response.writeHead(400); response.end("Identity verification failed. Restart the command to try again.");
        finish(new Error("Google identity verification failed. No account change was made."));
      }
    });
    server.headersTimeout = 10000;
    server.requestTimeout = 20000;
    server.on("error", () => finish(new Error("Cannot listen on 127.0.0.1:43871. Close the process using that port and retry.")));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    server.listen(43871, "127.0.0.1", () => {
      if (finished) { server.close(); return; }
      const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
      const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
      const browser = spawn(command, args, { stdio: "ignore" });
      browser.on("error", () => finish(new Error("Could not open your browser. Run this command on your computer with a default browser.")));
      browser.on("exit", code => { if (code !== 0) finish(new Error("Could not open your browser. Check your default browser and retry.")); });
      console.log("Your browser is opening Google account selection. This attempt expires after ten minutes.");
    });
  });
}
