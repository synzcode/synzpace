import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema/auth";
import type { SessionConfig } from "./config";

export const day = 24 * 60 * 60 * 1000;
const denied = () => new APIError("FORBIDDEN", { code: "PERSONAL_ACCOUNT_REQUIRED", message: "Private access is unavailable." });

/** One instance per request and transaction. Never publish its raw handler. */
export function createRequestAuth(db: NodePgDatabase<typeof schema>, config: SessionConfig, now: Date, google?: { clientId: string; clientSecret: string }) {
  let verified: { subject: string; email: string; name: string } | undefined;
  async function bindingMatches(subject: string) {
    const rows = await db.select({ id: schema.account.id }).from(schema.account).where(and(eq(schema.account.userId, config.ownerId), eq(schema.account.providerId, "google"), eq(schema.account.accountId, subject)));
    return rows.length === 1;
  }
  async function requireVerified() {
    if (!verified || !await bindingMatches(verified.subject)) throw denied();
    return verified;
  }
  return betterAuth({
    baseURL: config.origin,
    secret: config.secret,
    trustedOrigins: [config.origin],
    database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
    logger: { disabled: true },
    emailAndPassword: { enabled: false },
    user: {
      changeEmail: { enabled: false }, deleteUser: { enabled: false },
      validateUserInfo: async ({ user, source }) => {
        verified = undefined;
        const profile = source.oauth?.profile;
        if (source.action !== "sign-in" || source.method !== "oauth" || source.oauth?.providerId !== "google" || user.id !== config.ownerId || typeof profile?.sub !== "string" || typeof profile.email !== "string" || profile.email_verified !== true || typeof profile.name !== "string" || !profile.name.trim() || !await bindingMatches(profile.sub)) return { error: "access_denied" };
        verified = { subject: profile.sub, email: profile.email, name: profile.name.trim() };
      },
    },
    socialProviders: google ? {
      google: {
        ...google, disableSignUp: true, disableImplicitSignUp: true,
        overrideUserInfoOnSignIn: true, prompt: "select_account", accessType: "online",
        mapProfileToUser: () => ({ image: undefined }),
      },
    } : {},
    account: { storeStateStrategy: "database", skipStateCookieCheck: false, storeAccountCookie: false, accountLinking: { enabled: false, disableImplicitLinking: true } },
    session: { expiresIn: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60, deferSessionRefresh: true, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: config.origin.startsWith("https:"), defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" } },
    rateLimit: { enabled: false },
    databaseHooks: {
      user: {
        create: { before: async () => { throw denied(); } },
        update: { before: async () => {
          const identity = await requireVerified();
          return { data: { email: identity.email, name: identity.name, emailVerified: true, image: null, updatedAt: now } };
        } },
      },
      account: {
        create: { before: async () => { throw denied(); } },
        update: { before: async () => {
          await requireVerified();
          return { data: { accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null, scope: null, password: null, updatedAt: now } };
        } },
      },
      session: {
        create: { before: async data => {
          await requireVerified();
          if (data.userId !== config.ownerId) throw denied();
          return { data: { ...data, createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 30 * day) } };
        } },
        update: { before: async (data, ctx) => {
          const current = ctx?.context.session?.session;
          if (!current || current.userId !== config.ownerId) throw denied();
          const rows = await db.select().from(schema.session).where(eq(schema.session.id, current.id));
          const row = rows[0];
          if (!row || row.expiresAt <= now || row.createdAt.getTime() + 90 * day <= now.getTime()) throw denied();
          return { data: { ...data, createdAt: row.createdAt, updatedAt: now, expiresAt: new Date(Math.min(now.getTime() + 30 * day, row.createdAt.getTime() + 90 * day)) } };
        } },
      },
    },
    hooks: {
      before: createAuthMiddleware(async ctx => {
        if (ctx.path === "/sign-out") {
          // The library swallows deletion errors. Delete first so failure cannot
          // become a confirmed sign out or release cookie deletion headers.
          const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
          if (token) await db.delete(schema.session).where(eq(schema.session.token, token));
        }
        if (ctx.path === "/sign-in/social" && ctx.body?.idToken) throw denied();
        if (ctx.path === "/get-session") {
          const value = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
          if (value) {
            const rows = await db.select().from(schema.session).where(eq(schema.session.token, value));
            const row = rows[0];
            if (row && (row.expiresAt <= now || row.createdAt.getTime() + 90 * day <= now.getTime())) throw new APIError("UNAUTHORIZED", { code: "UNAUTHENTICATED", message: "Sign in to continue." });
          }
        }
      }),
      after: createAuthMiddleware(async ctx => {
        if (!(ctx.path.startsWith("/callback/") || (ctx.path === "/get-session" && ctx.method === "POST"))) return;
        const active = ctx.context.newSession ?? ctx.context.session;
        if (!active) return;
        const rows = await db.select().from(schema.session).where(eq(schema.session.id, active.session.id));
        const row = rows[0];
        if (!row || row.userId !== config.ownerId || row.expiresAt <= now) throw denied();
        await setSessionCookie(ctx, { session: row, user: active.user }, false, { maxAge: Math.max(0, Math.floor((row.expiresAt.getTime() - now.getTime()) / 1000)), expires: row.expiresAt });
      }),
    },
  });
}
