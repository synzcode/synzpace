import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: jsonb("description"),
  descriptionVersion: smallint("description_version").notNull().default(1),
  progress: smallint("progress").notNull().default(0),
  dueDate: date("due_date", { mode: "string" }),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  trashedAt: timestamp("trashed_at", { withTimezone: true }),
}, t => [
  unique("tasks_owner_id_id_unique").on(t.ownerId, t.id),
  check("tasks_title_length", sql`char_length(${t.title}) between 1 and 200`),
  check("tasks_progress_bounds", sql`${t.progress} between 0 and 100`),
  check("tasks_revision_positive", sql`${t.revision} > 0`),
  index("tasks_active_page_idx").on(t.ownerId, t.createdAt.desc(), t.id.desc()).where(sql`${t.trashedAt} is null`),
  index("tasks_trash_page_idx").on(t.ownerId, t.trashedAt.desc(), t.id.desc()).where(sql`${t.trashedAt} is not null`),
  index("tasks_cleanup_idx").on(t.trashedAt, t.id).where(sql`${t.trashedAt} is not null`),
]);

export const creationReceipts = pgTable("creation_receipts", {
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull(),
  operation: text("operation").notNull(),
  requestHash: text("request_hash").notNull(),
  resourceId: uuid("resource_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.ownerId, t.requestId] }),
  check("creation_receipts_operation", sql`${t.operation} in ('create_task', 'create_tag', 'create_comment')`),
  check("creation_receipts_hash", sql`${t.requestHash} ~ '^[0-9a-f]{64}$'`),
]);
