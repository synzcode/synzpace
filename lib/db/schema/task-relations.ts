import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  primaryKey,
  unique,
  foreignKey,
  index,
  check,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { tasks } from "./tasks";
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("tags_owner_id_id_unique").on(t.ownerId, t.id),
    unique("tags_owner_name_unique").on(t.ownerId, t.normalizedName),
    check("tags_name_length", sql`char_length(${t.name}) between 1 and 50`),
    check("tags_revision_positive", sql`${t.revision}>0`),
  ],
);
export const taskTags = pgTable(
  "task_tags",
  {
    ownerId: text("owner_id").notNull(),
    taskId: uuid("task_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.tagId] }),
    foreignKey({
      columns: [t.ownerId, t.taskId],
      foreignColumns: [tasks.ownerId, tasks.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.ownerId, t.tagId],
      foreignColumns: [tags.ownerId, tags.id],
    }).onDelete("cascade"),
    index("task_tags_tag_idx").on(t.ownerId, t.tagId, t.taskId),
  ],
);
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    body: text("body").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("comments_owner_id_id_unique").on(t.ownerId, t.id),
    foreignKey({
      columns: [t.ownerId, t.taskId],
      foreignColumns: [tasks.ownerId, tasks.id],
    }).onDelete("cascade"),
    check(
      "comments_body_length",
      sql`char_length(${t.body}) between 1 and 10000`,
    ),
    check("comments_revision_positive", sql`${t.revision}>0`),
    index("comments_page_idx").on(t.ownerId, t.taskId, t.createdAt, t.id),
  ],
);
