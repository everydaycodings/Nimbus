CREATE TABLE "health_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" text NOT NULL,
	"outcome" text NOT NULL,
	"latency_ms" integer,
	"detail" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_checks_outcome_check" CHECK ("health_checks"."outcome" in ('ok', 'slow', 'fail', 'off'))
);
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "bell" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "health_interval_min" integer DEFAULT 5;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "health_failures" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "health_retention_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "health_disabled" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "health_slow_ms" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "health_checks_service_idx" ON "health_checks" USING btree ("service","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "health_checks_checked_idx" ON "health_checks" USING btree ("checked_at");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_health_positive" CHECK (("settings"."health_interval_min" is null or "settings"."health_interval_min" > 0) and "settings"."health_failures" > 0 and "settings"."health_retention_days" > 0);