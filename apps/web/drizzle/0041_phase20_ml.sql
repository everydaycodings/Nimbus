DO $$ BEGIN
	CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
	RAISE NOTICE 'pgvector is not available: skipping picture search and People tables';
END $$;--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "ml_done" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "node_text_parts" ADD COLUMN "source" text DEFAULT 'ocr' NOT NULL;
--> statement-breakpoint
ALTER TABLE "node_text_parts" ADD COLUMN "end_ms" integer;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ml_url" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ml_speech" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ml_clip" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ml_faces" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "whisper_model" text DEFAULT 'base' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "clip_model" text DEFAULT 'vitb32' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "faces_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ai_access" text DEFAULT 'everyone' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "faces_on" boolean;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ai_allowed" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "node_speech" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"lang" text,
	"model" text NOT NULL,
	"body" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED NOT NULL,
	"no_speech" boolean DEFAULT false NOT NULL,
	"failed" text,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "node_speech" ADD CONSTRAINT "node_speech_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "node_speech_tsv_idx" ON "node_speech" USING gin ("tsv");--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
		EXECUTE $ddl$
			CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"memories" boolean DEFAULT true NOT NULL,
	"cover_face_id" uuid,
	"centroid" vector(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
			CREATE TABLE "faces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"person_id" uuid,
	"suggest_person_id" uuid,
	"rejected" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"box" jsonb NOT NULL,
	"score" double precision NOT NULL,
	"vec" vector(128) NOT NULL
);
			CREATE TABLE "node_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"t_ms" integer,
	"model" text NOT NULL,
	"vec" vector(512) NOT NULL
);
			ALTER TABLE "faces" ADD CONSTRAINT "faces_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;
			ALTER TABLE "faces" ADD CONSTRAINT "faces_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
			ALTER TABLE "faces" ADD CONSTRAINT "faces_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
			ALTER TABLE "faces" ADD CONSTRAINT "faces_suggest_person_id_people_id_fk" FOREIGN KEY ("suggest_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
			ALTER TABLE "node_embeddings" ADD CONSTRAINT "node_embeddings_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;
			ALTER TABLE "people" ADD CONSTRAINT "people_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
			CREATE INDEX "faces_node_idx" ON "faces" USING btree ("node_id");
			CREATE INDEX "faces_owner_person_idx" ON "faces" USING btree ("owner_id","person_id");
			CREATE INDEX "faces_vec_idx" ON "faces" USING hnsw ("vec" vector_cosine_ops);
			CREATE INDEX "node_embeddings_node_idx" ON "node_embeddings" USING btree ("node_id");
			CREATE INDEX "node_embeddings_vec_idx" ON "node_embeddings" USING hnsw ("vec" vector_cosine_ops);
			CREATE INDEX "people_owner_idx" ON "people" USING btree ("owner_id");
		$ddl$;
	END IF;
END $$;
