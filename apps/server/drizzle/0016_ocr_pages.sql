CREATE TABLE "ocr_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"page_index" integer NOT NULL,
	"page_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ocr_pages" ADD CONSTRAINT "ocr_pages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_pages" ADD CONSTRAINT "ocr_pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_pages_job_page_uidx" ON "ocr_pages" USING btree ("job_id","page_index");--> statement-breakpoint
CREATE INDEX "idx_ocr_pages_document" ON "ocr_pages" USING btree ("document_id");