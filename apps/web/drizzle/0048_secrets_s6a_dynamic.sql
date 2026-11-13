CREATE TABLE "secret_db_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"engine" text NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"database" text DEFAULT '' NOT NULL,
	"tls" boolean DEFAULT false NOT NULL,
	"admin_enc" text NOT NULL,
	"create_sql" text NOT NULL,
	"revoke_sql" text NOT NULL,
	"default_ttl" integer NOT NULL,
	"max_ttl" integer NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_db_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"issued_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_rotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"secret_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"username" text NOT NULL,
	"username_b" text,
	"username_key" text,
	"active" text,
	"interval_days" integer,
	"next_at" timestamp with time zone,
	"last_at" timestamp with time zone,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "secret_db_connections" ADD CONSTRAINT "secret_db_connections_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_db_connections" ADD CONSTRAINT "secret_db_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_db_leases" ADD CONSTRAINT "secret_db_leases_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_db_leases" ADD CONSTRAINT "secret_db_leases_connection_id_secret_db_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."secret_db_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_rotations" ADD CONSTRAINT "secret_rotations_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_rotations" ADD CONSTRAINT "secret_rotations_secret_id_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_rotations" ADD CONSTRAINT "secret_rotations_connection_id_secret_db_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."secret_db_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_rotations" ADD CONSTRAINT "secret_rotations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "secret_db_connections_name_idx" ON "secret_db_connections" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "secret_db_leases_conn_idx" ON "secret_db_leases" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "secret_rotations_secret_idx" ON "secret_rotations" USING btree ("secret_id");