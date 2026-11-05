import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";

// Schema generation only. This module opens no database connection and is never
// imported by the application. Runtime auth awaits the capability proof.
export const auth = betterAuth({
  baseURL: "http://localhost:3000",
  database: drizzleAdapter(drizzle.mock(), {
    provider: "pg",
    transaction: true,
  }),
  emailAndPassword: { enabled: false },
  session: {
    expiresIn: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
    deferSessionRefresh: true,
    cookieCache: { enabled: false },
  },
  account: {
    storeStateStrategy: "database",
    accountLinking: { enabled: false },
  },
  rateLimit: { enabled: false },
});
