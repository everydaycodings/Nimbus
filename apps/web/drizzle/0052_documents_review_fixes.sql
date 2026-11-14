ALTER TABLE "documents" ADD COLUMN "touched" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_dup_of_idx" ON "documents" USING btree ("dup_of");--> statement-breakpoint
CREATE INDEX "documents_sender_idx" ON "documents" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "documents_type_idx" ON "documents" USING btree ("type_id");--> statement-breakpoint
ALTER TABLE "doc_types" ADD CONSTRAINT "doc_types_remind_days_check" CHECK ("doc_types"."remind_days" between 0 and 3650);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_remind_days_check" CHECK ("documents"."remind_days" between 0 and 3650);