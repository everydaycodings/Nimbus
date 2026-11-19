CREATE TABLE "s3_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket_id" uuid NOT NULL,
	"key_id" uuid,
	"hour" timestamp with time zone NOT NULL,
	"granularity" text NOT NULL,
	"reads" bigint DEFAULT 0 NOT NULL,
	"writes" bigint DEFAULT 0 NOT NULL,
	"lists" bigint DEFAULT 0 NOT NULL,
	"deletes" bigint DEFAULT 0 NOT NULL,
	"bytes_in" bigint DEFAULT 0 NOT NULL,
	"bytes_out" bigint DEFAULT 0 NOT NULL,
	"e4xx" bigint DEFAULT 0 NOT NULL,
	"e5xx" bigint DEFAULT 0 NOT NULL,
	"agents" jsonb DEFAULT '{}' NOT NULL,
	"ips" jsonb DEFAULT '{}' NOT NULL,
	CONSTRAINT "s3_usage_row_idx" UNIQUE NULLS NOT DISTINCT("bucket_id","key_id","hour","granularity"),
	CONSTRAINT "s3_usage_granularity_check" CHECK ("s3_usage"."granularity" in ('h', 'd'))
);
--> statement-breakpoint
CREATE TABLE "s3_activity" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "s3_activity_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"bucket_id" uuid NOT NULL,
	"key_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"op" text NOT NULL,
	"object_key" text,
	"status" integer NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"ip" text,
	"agent" text
);
--> statement-breakpoint
CREATE TABLE "s3_storage_daily" (
	"bucket_id" uuid NOT NULL,
	"day" date NOT NULL,
	"bytes" bigint NOT NULL,
	"objects" bigint NOT NULL,
	CONSTRAINT "s3_storage_daily_bucket_id_day_pk" PRIMARY KEY("bucket_id","day")
);
--> statement-breakpoint
ALTER TABLE "s3_usage" ADD CONSTRAINT "s3_usage_bucket_id_s3_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."s3_buckets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s3_activity" ADD CONSTRAINT "s3_activity_bucket_id_s3_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."s3_buckets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s3_storage_daily" ADD CONSTRAINT "s3_storage_daily_bucket_id_s3_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."s3_buckets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "s3_usage_hour_idx" ON "s3_usage" USING btree ("hour");--> statement-breakpoint
CREATE INDEX "s3_activity_bucket_idx" ON "s3_activity" USING btree ("bucket_id","at");--> statement-breakpoint
CREATE INDEX "s3_activity_key_idx" ON "s3_activity" USING btree ("key_id","at");
