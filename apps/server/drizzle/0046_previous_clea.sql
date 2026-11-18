CREATE TABLE "llm_credential_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"config_id" uuid,
	"api_key_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdf_segment_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"file_revision" text NOT NULL,
	"parser_version" text NOT NULL,
	"page_index" integer NOT NULL,
	"geometry" jsonb,
	"state" text NOT NULL,
	"diagnostics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdf_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"file_revision" text NOT NULL,
	"parser_version" text NOT NULL,
	"page_index" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"source_text" text NOT NULL,
	"text_hash" text NOT NULL,
	"rects" jsonb NOT NULL,
	"quality_state" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdf_translation_contents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"file_revision" text NOT NULL,
	"page_index" integer NOT NULL,
	"source_kind" text NOT NULL,
	"segment_id" text,
	"anchor_key" text,
	"source_text" text NOT NULL,
	"text_hash" text NOT NULL,
	"rects" jsonb NOT NULL,
	"generation_revision" integer DEFAULT 0 NOT NULL,
	"current_translation_id" uuid,
	"active_job_id" uuid,
	"latest_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pdf_translation_contents_content_key_unique" UNIQUE("content_key")
);
--> statement-breakpoint
CREATE TABLE "pdf_translation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"generation_key" text NOT NULL,
	"generation_revision" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" varchar(16) DEFAULT 'queued' NOT NULL,
	"model_snapshot" jsonb NOT NULL,
	"credential_version_id" uuid NOT NULL,
	"prompt_version" text NOT NULL,
	"context_hash" text NOT NULL,
	"context_text" text DEFAULT '' NOT NULL,
	"execution_token" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"error_code" text,
	"translation_id" uuid,
	"usage" jsonb DEFAULT '{"usageStatus":"unknown","inputTokens":null,"outputTokens":null,"totalTokens":null}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "pdf_translation_jobs_job_id_unique" UNIQUE("job_id"),
	CONSTRAINT "pdf_translation_jobs_generation_key_unique" UNIQUE("generation_key"),
	CONSTRAINT "pdf_translation_jobs_state_check" CHECK ("pdf_translation_jobs"."state" IN ('queued', 'preparing', 'dispatched', 'succeeded', 'failed', 'unknown', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "pdf_translation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"content_id" uuid NOT NULL,
	"job_id" uuid,
	"translation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdf_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"generation_key" text NOT NULL,
	"generation_revision" integer NOT NULL,
	"file_revision" text NOT NULL,
	"page_index" integer NOT NULL,
	"source_text" text NOT NULL,
	"translated_text" text NOT NULL,
	"model_snapshot" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"context_hash" text NOT NULL,
	"usage" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pdf_translations_generation_key_unique" UNIQUE("generation_key")
);
--> statement-breakpoint
CREATE TABLE "user_translation_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"llm_config_id" uuid,
	"credential_version_id" uuid,
	"target_language" text DEFAULT 'zh-CN' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_check";--> statement-breakpoint
ALTER TABLE "llm_usage_logs" DROP CONSTRAINT "llm_usage_logs_capability_check";--> statement-breakpoint
ALTER TABLE "llm_usage_logs" ALTER COLUMN "prompt_tokens" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_usage_logs" ALTER COLUMN "completion_tokens" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_usage_logs" ALTER COLUMN "total_tokens" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "file_revision" varchar(64);--> statement-breakpoint
ALTER TABLE "llm_configs" ADD COLUMN "purpose" varchar(16) DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_usage_logs" ADD COLUMN "translation_task_id" uuid;--> statement-breakpoint
ALTER TABLE "llm_usage_logs" ADD COLUMN "usage_status" varchar(16) DEFAULT 'known' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_credential_versions" ADD CONSTRAINT "llm_credential_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_credential_versions" ADD CONSTRAINT "llm_credential_versions_config_id_llm_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."llm_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_segment_pages" ADD CONSTRAINT "pdf_segment_pages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_segment_pages" ADD CONSTRAINT "pdf_segment_pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_segments" ADD CONSTRAINT "pdf_segments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_segments" ADD CONSTRAINT "pdf_segments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_translation_contents" ADD CONSTRAINT "pdf_translation_contents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_translation_contents" ADD CONSTRAINT "pdf_translation_contents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_translation_jobs" ADD CONSTRAINT "pdf_translation_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_translation_jobs" ADD CONSTRAINT "pdf_translation_jobs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_translation_jobs" ADD CONSTRAINT "pdf_translation_jobs_content_id_pdf_translation_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."pdf_translation_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_translation_jobs" ADD CONSTRAINT "pdf_translation_jobs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_translation_jobs" ADD CONSTRAINT "pdf_translation_jobs_credential_version_id_llm_credential_versions_id_fk" FOREIGN KEY ("credential_version_id") REFERENCES "public"."llm_credential_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_translation_requests" ADD CONSTRAINT "pdf_translation_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_translation_requests" ADD CONSTRAINT "pdf_translation_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_translation_requests" ADD CONSTRAINT "pdf_translation_requests_content_id_pdf_translation_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."pdf_translation_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_translations" ADD CONSTRAINT "pdf_translations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_translations" ADD CONSTRAINT "pdf_translations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_translations" ADD CONSTRAINT "pdf_translations_content_id_pdf_translation_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."pdf_translation_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_translation_settings" ADD CONSTRAINT "user_translation_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_translation_settings" ADD CONSTRAINT "user_translation_settings_llm_config_id_llm_configs_id_fk" FOREIGN KEY ("llm_config_id") REFERENCES "public"."llm_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_translation_settings" ADD CONSTRAINT "user_translation_settings_credential_version_id_llm_credential_versions_id_fk" FOREIGN KEY ("credential_version_id") REFERENCES "public"."llm_credential_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdf_segment_pages_identity" ON "pdf_segment_pages" USING btree ("document_id","file_revision","parser_version","page_index");--> statement-breakpoint
CREATE UNIQUE INDEX "pdf_segments_identity" ON "pdf_segments" USING btree ("document_id","file_revision","parser_version","page_index","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "pdf_translation_jobs_idempotency" ON "pdf_translation_jobs" USING btree ("user_id","document_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "pdf_translation_jobs_active_content" ON "pdf_translation_jobs" USING btree ("content_id") WHERE "pdf_translation_jobs"."state" IN ('queued','preparing','dispatched');--> statement-breakpoint
CREATE INDEX "pdf_translation_jobs_credential" ON "pdf_translation_jobs" USING btree ("credential_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pdf_translation_requests_idempotency" ON "pdf_translation_requests" USING btree ("user_id","document_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "llm_usage_logs" ADD CONSTRAINT "llm_usage_logs_translation_task_id_unique" UNIQUE("translation_task_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_check" CHECK ("jobs"."type" IN ('digest', 'evolve', 'weekly_report', 'topic', 'chat', 'selection', 'extract', 'ocr', 'annotation_resurface', 'memory_organize', 'conversation', 'concept_extract', 'concept_practice', 'pdf_translate'));--> statement-breakpoint
ALTER TABLE "llm_configs" ADD CONSTRAINT "llm_configs_purpose_check" CHECK ("llm_configs"."purpose" IN ('chat', 'translation'));--> statement-breakpoint
ALTER TABLE "llm_usage_logs" ADD CONSTRAINT "llm_usage_logs_capability_check" CHECK ("llm_usage_logs"."capability" IN ('chat', 'embed', 'rerank', 'ocr', 'translation'));