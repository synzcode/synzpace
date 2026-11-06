CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"task_id" uuid NOT NULL,
	"body" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "comments_body_length" CHECK (char_length("comments"."body") between 1 and 10000),
	CONSTRAINT "comments_revision_positive" CHECK ("comments"."revision">0)
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "tags_owner_name_unique" UNIQUE("owner_id","normalized_name"),
	CONSTRAINT "tags_name_length" CHECK (char_length("tags"."name") between 1 and 50),
	CONSTRAINT "tags_revision_positive" CHECK ("tags"."revision">0)
);
--> statement-breakpoint
CREATE TABLE "task_tags" (
	"owner_id" text NOT NULL,
	"task_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_tags_task_id_tag_id_pk" PRIMARY KEY("task_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_owner_id_task_id_tasks_owner_id_id_fk" FOREIGN KEY ("owner_id","task_id") REFERENCES "public"."tasks"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_owner_id_task_id_tasks_owner_id_id_fk" FOREIGN KEY ("owner_id","task_id") REFERENCES "public"."tasks"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_owner_id_tag_id_tags_owner_id_id_fk" FOREIGN KEY ("owner_id","tag_id") REFERENCES "public"."tags"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_page_idx" ON "comments" USING btree ("owner_id","task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "task_tags_tag_idx" ON "task_tags" USING btree ("owner_id","tag_id","task_id");