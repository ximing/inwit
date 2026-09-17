ALTER TABLE "annotations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_states" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_review_states_user_due_active" ON "review_states" USING btree ("user_id","due_at") WHERE "review_states"."suspended_at" IS NULL;