ALTER TABLE "documents" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_documents_user_deleted" ON "documents" USING btree ("user_id","deleted_at");