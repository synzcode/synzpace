CREATE TABLE "creation_receipts" (
	"owner_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"request_hash" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creation_receipts_owner_id_request_id_pk" PRIMARY KEY("owner_id","request_id"),
	CONSTRAINT "creation_receipts_operation" CHECK ("creation_receipts"."operation" in ('create_task', 'create_tag', 'create_comment')),
	CONSTRAINT "creation_receipts_hash" CHECK ("creation_receipts"."request_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"description" jsonb,
	"description_version" smallint DEFAULT 1 NOT NULL,
	"progress" smallint DEFAULT 0 NOT NULL,
	"due_date" date,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trashed_at" timestamp with time zone,
	CONSTRAINT "tasks_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "tasks_title_length" CHECK (char_length("tasks"."title") between 1 and 200),
	CONSTRAINT "tasks_progress_bounds" CHECK ("tasks"."progress" between 0 and 100),
	CONSTRAINT "tasks_revision_positive" CHECK ("tasks"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "creation_receipts" ADD CONSTRAINT "creation_receipts_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_active_page_idx" ON "tasks" USING btree ("owner_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "tasks"."trashed_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_trash_page_idx" ON "tasks" USING btree ("owner_id","trashed_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "tasks"."trashed_at" is not null;--> statement-breakpoint
CREATE INDEX "tasks_cleanup_idx" ON "tasks" USING btree ("trashed_at","id") WHERE "tasks"."trashed_at" is not null;