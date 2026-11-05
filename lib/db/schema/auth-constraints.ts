import { index, pgTable, bigint, integer, text } from "drizzle-orm/pg-core";

export const authRateLimit = pgTable("auth_rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
}, (table) => [index("auth_rate_limit_last_request_idx").on(table.lastRequest)]);
