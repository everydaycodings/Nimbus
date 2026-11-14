CREATE TABLE "s3_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"node_id" uuid NOT NULL,
	"name" text NOT NULL,
	"quiet" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "s3_key_buckets" (
	"key_id" uuid NOT NULL,
	"bucket_id" uuid NOT NULL,
	CONSTRAINT "s3_key_buckets_key_id_bucket_id_pk" PRIMARY KEY("key_id","bucket_id")
);
--> statement-breakpoint
CREATE TABLE "s3_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"access_key_id" text NOT NULL,
	"secret_enc" text NOT NULL,
	"access" text NOT NULL,
	"all_buckets" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_ip" text,
	CONSTRAINT "s3_keys_access_key_id_unique" UNIQUE("access_key_id"),
	CONSTRAINT "s3_keys_access_check" CHECK ("s3_keys"."access" in ('rw', 'ro'))
);
--> statement-breakpoint
CREATE TABLE "s3_multipart" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"bucket_id" uuid NOT NULL,
	"key" text NOT NULL,
	"backing_key" text NOT NULL,
	"backing_upload_id" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "etag" text;--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "s3_api" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "s3_rps_limit" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "s3_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "s3_buckets" ADD CONSTRAINT "s3_buckets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s3_buckets" ADD CONSTRAINT "s3_buckets_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s3_key_buckets" ADD CONSTRAINT "s3_key_buckets_key_id_s3_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."s3_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s3_key_buckets" ADD CONSTRAINT "s3_key_buckets_bucket_id_s3_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."s3_buckets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s3_keys" ADD CONSTRAINT "s3_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s3_multipart" ADD CONSTRAINT "s3_multipart_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s3_multipart" ADD CONSTRAINT "s3_multipart_bucket_id_s3_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."s3_buckets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "s3_buckets_user_name_idx" ON "s3_buckets" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "s3_buckets_user_node_idx" ON "s3_buckets" USING btree ("user_id","node_id");--> statement-breakpoint
CREATE INDEX "s3_buckets_node_idx" ON "s3_buckets" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "s3_keys_user_idx" ON "s3_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "s3_multipart_bucket_idx" ON "s3_multipart" USING btree ("bucket_id");--> statement-breakpoint
CREATE INDEX "s3_multipart_created_idx" ON "s3_multipart" USING btree ("created_at");