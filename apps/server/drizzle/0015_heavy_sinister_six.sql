CREATE TABLE "access_token_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token_id" uuid NOT NULL,
	"method" varchar(16) NOT NULL,
	"path" varchar(512) NOT NULL,
	"status" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(64) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"token_encrypted" text NOT NULL,
	"token_preview" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "users_access_token_hash_uidx";--> statement-breakpoint
ALTER TABLE "access_token_logs" ADD CONSTRAINT "access_token_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_token_logs" ADD CONSTRAINT "access_token_logs_access_token_id_access_tokens_id_fk" FOREIGN KEY ("access_token_id") REFERENCES "public"."access_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_access_token_logs_user_created" ON "access_token_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_access_token_logs_token_created" ON "access_token_logs" USING btree ("access_token_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_access_token_logs_created" ON "access_token_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_access_tokens_user" ON "access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_tokens_hash_uidx" ON "access_tokens" USING btree ("token_hash");--> statement-breakpoint
INSERT INTO "access_tokens" ("user_id", "name", "token_hash", "token_encrypted", "token_preview", "created_at")
SELECT "id", '默认', "access_token_hash", "access_token_encrypted", '', COALESCE("access_token_created_at", now())
FROM "users"
WHERE "access_token_hash" IS NOT NULL AND "access_token_encrypted" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "access_token_hash";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "access_token_encrypted";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "access_token_created_at";