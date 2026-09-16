ALTER TABLE "users" ADD COLUMN "access_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "access_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "access_token_created_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_access_token_hash_uidx" ON "users" USING btree ("access_token_hash");