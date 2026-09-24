CREATE TABLE "card_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" uuid,
	"document_id" uuid,
	"verdict" varchar(16) NOT NULL,
	"reason" text,
	"snapshot" jsonb NOT NULL,
	"consumed_at" timestamp with time zone,
	"organize_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_feedback_verdict_check" CHECK ("card_feedback"."verdict" IN ('accepted', 'rejected')),
	CONSTRAINT "card_feedback_reason_len_check" CHECK (char_length("card_feedback"."reason") <= 500)
);
--> statement-breakpoint
CREATE TABLE "memory_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(40) NOT NULL,
	"description" varchar(280) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"index_dirty" boolean DEFAULT true NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_collections_status_check" CHECK ("memory_collections"."status" IN ('active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "memory_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"body" varchar(500) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"index_dirty" boolean DEFAULT true NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_entries_status_check" CHECK ("memory_entries"."status" IN ('active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "memory_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"execution_id" uuid,
	"batch_key" varchar(64) NOT NULL,
	"summary" varchar(300) NOT NULL,
	"diff" jsonb NOT NULL,
	"feedback_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_revisions_user_batch_key_uidx" UNIQUE("user_id","batch_key")
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "acceptance" varchar(16) DEFAULT 'accepted' NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "card_feedback" ADD CONSTRAINT "card_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_feedback" ADD CONSTRAINT "card_feedback_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_feedback" ADD CONSTRAINT "card_feedback_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_feedback" ADD CONSTRAINT "card_feedback_organize_job_id_jobs_id_fk" FOREIGN KEY ("organize_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_collections" ADD CONSTRAINT "memory_collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_collection_id_memory_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."memory_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_revisions" ADD CONSTRAINT "memory_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_revisions" ADD CONSTRAINT "memory_revisions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_revisions" ADD CONSTRAINT "memory_revisions_execution_id_agent_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."agent_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_card_feedback_unconsumed" ON "card_feedback" USING btree ("user_id","created_at") WHERE "card_feedback"."consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_card_feedback_user_created" ON "card_feedback" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_memory_collections_user_status" ON "memory_collections" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_memory_entries_collection_status" ON "memory_entries" USING btree ("collection_id","status");--> statement-breakpoint
CREATE INDEX "idx_memory_entries_user_status" ON "memory_entries" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_memory_entries_index_dirty" ON "memory_entries" USING btree ("updated_at") WHERE "memory_entries"."index_dirty" = true;--> statement-breakpoint
CREATE INDEX "idx_memory_revisions_user_created" ON "memory_revisions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_cards_user_acceptance" ON "cards" USING btree ("user_id","acceptance") WHERE "cards"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_acceptance_check" CHECK ("cards"."acceptance" IN ('proposed', 'accepted', 'rejected'));--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_reject_reason_len_check" CHECK (char_length("cards"."reject_reason") <= 500);