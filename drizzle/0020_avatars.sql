ALTER TABLE "user" ADD COLUMN "provider_image" text;--> statement-breakpoint
UPDATE "user" SET "provider_image" = "image" WHERE "image" IS NOT NULL;--> statement-breakpoint
UPDATE "user" SET "image" = '/avatars/' || (ARRAY['11','12','21','22','23','24','25','26','27','28'])[floor(random() * 10)::int + 1] || '.webp' WHERE "image" IS NULL;
