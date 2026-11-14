CREATE TABLE "doc_senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"patterns" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text,
	"key" text,
	"name" text NOT NULL,
	"remind_days" integer
);
--> statement-breakpoint
CREATE TABLE "doc_watch" (
	"owner_id" text NOT NULL,
	"node_id" uuid NOT NULL,
	CONSTRAINT "doc_watch_owner_id_node_id_pk" PRIMARY KEY("owner_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"version_id" uuid,
	"status" text DEFAULT 'review' NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"type_id" uuid,
	"sender_id" uuid,
	"doc_date" date,
	"amount" numeric(14, 2),
	"currency" text,
	"expires_at" date,
	"remind_days" integer,
	"reminded_at" timestamp with time zone,
	"notes" text,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"guess" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dup_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "documents_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "docs_ml" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_senders" ADD CONSTRAINT "doc_senders_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_types" ADD CONSTRAINT "doc_types_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_watch" ADD CONSTRAINT "doc_watch_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_watch" ADD CONSTRAINT "doc_watch_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_id_doc_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."doc_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_sender_id_doc_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."doc_senders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_dup_of_nodes_id_fk" FOREIGN KEY ("dup_of") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_senders_owner_name_idx" ON "doc_senders" USING btree ("owner_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "doc_types_owner_name_idx" ON "doc_types" USING btree (coalesce("owner_id", ''),lower("name"));--> statement-breakpoint
CREATE INDEX "documents_owner_status_idx" ON "documents" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "documents_owner_expires_idx" ON "documents" USING btree ("owner_id","expires_at");--> statement-breakpoint
CREATE INDEX "documents_owner_date_idx" ON "documents" USING btree ("owner_id","doc_date");--> statement-breakpoint
INSERT INTO "doc_types" ("key", "name", "remind_days") VALUES
	('invoice', 'Invoice', 3),
	('bill', 'Bill', 3),
	('receipt', 'Receipt', NULL),
	('contract', 'Contract', 30),
	('warranty', 'Warranty', 30),
	('id', 'ID', 90),
	('insurance', 'Insurance', 30),
	('tax', 'Tax', NULL),
	('statement', 'Statement', NULL),
	('medical', 'Medical', NULL),
	('certificate', 'Certificate', 30),
	('other', 'Other', NULL);
