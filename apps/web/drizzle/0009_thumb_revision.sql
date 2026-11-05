ALTER TABLE "file_versions" ALTER COLUMN "thumb" SET DATA TYPE text USING CASE WHEN "thumb" THEN '1' WHEN NOT "thumb" THEN '' END;
