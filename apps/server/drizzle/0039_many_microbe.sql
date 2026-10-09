CREATE TABLE "canvas_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"summary" varchar(200) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canvas_revisions_summary_len_check" CHECK (char_length("canvas_revisions"."summary") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "canvas_revisions" ADD CONSTRAINT "canvas_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_revisions" ADD CONSTRAINT "canvas_revisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_canvas_revisions_document_created" ON "canvas_revisions" USING btree ("document_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);