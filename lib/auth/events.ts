/** Fixed operational fields only. Never pass identity, request input, or secrets. */
export function authEvent(event: "auth.session.created" | "auth.session.revoked" | "auth.sessions.revoked" | "auth.denial" | "auth.throttled", actor: "personal owner" | "anonymous", startedAt: number, affected?: number) {
  console.log(JSON.stringify({ event, requestId: crypto.randomUUID(), at: new Date().toISOString(), actor, result: event === "auth.denial" ? "denied" : event === "auth.throttled" ? "rate_limited" : "success", elapsedMs: Math.max(0, Date.now() - startedAt), ...(affected === undefined ? {} : { affected }) }));
}
