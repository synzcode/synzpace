import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { SessionConfig } from "./config";
import { getDb } from "../db";
import * as schema from "../db/schema/auth";
import { databaseNow } from "../db/clock";
import { sessionConfig } from "./config";
import { createRequestAuth, day } from "./request-auth";
import { AuthFailure } from "./errors";

/** Live database authorization, with no persistent or cookie identity cache. */
export async function requirePersonalSession(headers: Headers) {
  let config;
  try { config = sessionConfig(); } catch { throw new AuthFailure(503, "CONFIGURATION_REQUIRED", "Private access needs configuration."); }
  const db = getDb();
  const now = await databaseNow(db);
  return resolvePersonalSession(db, headers, config, now);
}

export async function resolvePersonalSession(db: NodePgDatabase<typeof schema>, headers: Headers, config: SessionConfig, now: Date) {
  let result;
  try {
    result = await createRequestAuth(db, config, now).api.getSession({ headers, query: { disableRefresh: true } });
  } catch (error) {
    if (typeof error === "object" && error && "statusCode" in error && error.statusCode === 401) throw new AuthFailure(401, "UNAUTHENTICATED", "Sign in to continue.");
    throw error;
  }
  if (!result) throw new AuthFailure(401, "UNAUTHENTICATED", "Sign in to continue.");
  if (result.user.id !== config.ownerId) throw new AuthFailure(403, "PERSONAL_ACCOUNT_REQUIRED", "Private access is unavailable.");
  const bindings = await db.select({ provider: schema.account.providerId }).from(schema.account).where(eq(schema.account.userId, config.ownerId));
  if (bindings.length !== 1 || bindings[0].provider !== "google") throw new AuthFailure(403, "PERSONAL_ACCOUNT_REQUIRED", "Private access is unavailable.");
  const absoluteExpiresAt = new Date(result.session.createdAt.getTime() + 90 * day);
  if (result.session.expiresAt <= now || absoluteExpiresAt <= now) throw new AuthFailure(401, "UNAUTHENTICATED", "Sign in to continue.");
  return { userId: result.user.id, sessionId: result.session.id, expiresAt: result.session.expiresAt, absoluteExpiresAt };
}

export async function sessionDTO(db: NodePgDatabase<typeof schema>, session: Awaited<ReturnType<typeof resolvePersonalSession>>, now: Date) {
  const [owner] = await db.select({ id: schema.user.id, email: schema.user.email, name: schema.user.name }).from(schema.user).where(eq(schema.user.id, session.userId));
  const [record] = await db.select({ updatedAt: schema.session.updatedAt }).from(schema.session).where(eq(schema.session.id, session.sessionId));
  if (!owner || !record) throw new AuthFailure(401, "UNAUTHENTICATED", "Sign in to continue.");
  return { user: owner, session: { expiresAt: session.expiresAt.toISOString(), absoluteExpiresAt: session.absoluteExpiresAt.toISOString(), renewAfter: new Date(record.updatedAt.getTime() + day).toISOString() }, serverNow: now.toISOString() };
}
