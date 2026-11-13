-- Photos tagged with a person by hand have no detected face: box and vec may be null.
-- The faces table only exists where pgvector is installed (see 0041).
DO $$
BEGIN
	IF to_regclass('public.faces') IS NOT NULL THEN
		ALTER TABLE "faces" ALTER COLUMN "box" DROP NOT NULL;
		ALTER TABLE "faces" ALTER COLUMN "vec" DROP NOT NULL;
	END IF;
END $$;
