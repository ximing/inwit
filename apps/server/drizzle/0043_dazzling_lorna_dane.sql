CREATE TABLE "card_knowledge_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"concept_id" uuid,
	"relation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_knowledge_links_target_check" CHECK ((("card_knowledge_links"."concept_id" IS NOT NULL)::int + ("card_knowledge_links"."relation_id" IS NOT NULL)::int) = 1)
);
--> statement-breakpoint
CREATE TABLE "concept_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"document_id" uuid,
	"document_hash" varchar(64) NOT NULL,
	"scope" varchar(16) DEFAULT 'document' NOT NULL,
	"selection_snapshot" jsonb,
	"content_snapshot" jsonb,
	"job_id" uuid,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"draft" jsonb,
	"coverage" jsonb,
	"error_code" varchar(64),
	"result_note" text,
	"commit_request_hash" varchar(64),
	"commit_result" jsonb,
	"committed_at" timestamp with time zone,
	"retry_of_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_batches_status_check" CHECK ("concept_batches"."status" IN ('queued', 'running', 'ready', 'failed', 'cancelled', 'committed', 'discarded')),
	CONSTRAINT "concept_batches_scope_check" CHECK ("concept_batches"."scope" IN ('document', 'selection'))
);
--> statement-breakpoint
CREATE TABLE "concept_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"concept_id" uuid,
	"relation_id" uuid,
	"document_id" uuid,
	"document_title_snapshot" text DEFAULT '' NOT NULL,
	"document_hash" varchar(64) NOT NULL,
	"quote" text NOT NULL,
	"locator" jsonb NOT NULL,
	"basis" varchar(16) NOT NULL,
	"availability" varchar(16) DEFAULT 'active' NOT NULL,
	"evidence_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_evidence_target_check" CHECK ((("concept_evidence"."concept_id" IS NOT NULL)::int + ("concept_evidence"."relation_id" IS NOT NULL)::int) = 1),
	CONSTRAINT "concept_evidence_basis_check" CHECK ("concept_evidence"."basis" IN ('explicit', 'inferred', 'user')),
	CONSTRAINT "concept_evidence_availability_check" CHECK ("concept_evidence"."availability" IN ('active', 'stale', 'unavailable')),
	CONSTRAINT "concept_evidence_quote_len_check" CHECK (char_length("concept_evidence"."quote") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE TABLE "concept_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"concept_id" uuid,
	"relation_id" uuid,
	"document_id" uuid,
	"text" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"basis" varchar(16) NOT NULL,
	"created_by" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_notes_target_check" CHECK ((("concept_notes"."concept_id" IS NOT NULL)::int + ("concept_notes"."relation_id" IS NOT NULL)::int) = 1),
	CONSTRAINT "concept_notes_basis_check" CHECK ("concept_notes"."basis" IN ('explicit', 'inferred', 'user')),
	CONSTRAINT "concept_notes_created_by_check" CHECK ("concept_notes"."created_by" IN ('manual', 'agent')),
	CONSTRAINT "concept_notes_text_len_check" CHECK (char_length("concept_notes"."text") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "concept_operation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"operation" varchar(40) NOT NULL,
	"request_id" varchar(80) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"response_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_operation_requests_uidx" UNIQUE("user_id","operation","request_id")
);
--> statement-breakpoint
CREATE TABLE "concept_practice_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"concept_id" uuid,
	"relation_id" uuid,
	"card_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"exercise_kind" varchar(16) NOT NULL,
	"target_version" integer NOT NULL,
	"needs_refresh" boolean DEFAULT false NOT NULL,
	"resume_required" boolean DEFAULT false NOT NULL,
	"epoch_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_practice_bindings_target_check" CHECK ((("concept_practice_bindings"."concept_id" IS NOT NULL)::int + ("concept_practice_bindings"."relation_id" IS NOT NULL)::int) = 1),
	CONSTRAINT "concept_practice_bindings_kind_check" CHECK ("concept_practice_bindings"."exercise_kind" IN ('recall', 'compare', 'scenario'))
);
--> statement-breakpoint
CREATE TABLE "concept_practice_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"concept_id" uuid,
	"relation_id" uuid,
	"target_version" integer NOT NULL,
	"exercise_kind" varchar(16) NOT NULL,
	"job_id" uuid,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"question" text,
	"answer" text,
	"error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_practice_proposals_target_check" CHECK ((("concept_practice_proposals"."concept_id" IS NOT NULL)::int + ("concept_practice_proposals"."relation_id" IS NOT NULL)::int) = 1),
	CONSTRAINT "concept_practice_proposals_kind_check" CHECK ("concept_practice_proposals"."exercise_kind" IN ('recall', 'compare', 'scenario')),
	CONSTRAINT "concept_practice_proposals_status_check" CHECK ("concept_practice_proposals"."status" IN ('queued', 'running', 'ready', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "concept_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"from_concept_id" uuid NOT NULL,
	"to_concept_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"predicate" text NOT NULL,
	"normalized_predicate" text NOT NULL,
	"context" text,
	"normalized_context" text DEFAULT '' NOT NULL,
	"explanation" text,
	"example" text,
	"origin" varchar(16) NOT NULL,
	"basis" varchar(16) NOT NULL,
	"identity_hash" varchar(64) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_relations_not_self_check" CHECK ("concept_relations"."from_concept_id" <> "concept_relations"."to_concept_id"),
	CONSTRAINT "concept_relations_kind_check" CHECK ("concept_relations"."kind" IN ('composition', 'execution', 'evaluation', 'dependency', 'contrast', 'other')),
	CONSTRAINT "concept_relations_origin_check" CHECK ("concept_relations"."origin" IN ('manual', 'agent')),
	CONSTRAINT "concept_relations_basis_check" CHECK ("concept_relations"."basis" IN ('explicit', 'inferred', 'user')),
	CONSTRAINT "concept_relations_predicate_len_check" CHECK (char_length("concept_relations"."predicate") BETWEEN 1 AND 100),
	CONSTRAINT "concept_relations_context_len_check" CHECK ("concept_relations"."context" IS NULL OR char_length("concept_relations"."context") BETWEEN 1 AND 500),
	CONSTRAINT "concept_relations_explanation_len_check" CHECK ("concept_relations"."explanation" IS NULL OR char_length("concept_relations"."explanation") BETWEEN 1 AND 4000),
	CONSTRAINT "concept_relations_example_len_check" CHECK ("concept_relations"."example" IS NULL OR char_length("concept_relations"."example") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"sense" text,
	"definition" text,
	"example" text,
	"origin" varchar(16) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concepts_id_user_topic_uidx" UNIQUE("id","user_id","topic_id"),
	CONSTRAINT "concepts_origin_check" CHECK ("concepts"."origin" IN ('manual', 'agent')),
	CONSTRAINT "concepts_name_len_check" CHECK (char_length("concepts"."name") BETWEEN 1 AND 200),
	CONSTRAINT "concepts_sense_len_check" CHECK ("concepts"."sense" IS NULL OR char_length("concepts"."sense") BETWEEN 1 AND 500),
	CONSTRAINT "concepts_definition_len_check" CHECK ("concepts"."definition" IS NULL OR char_length("concepts"."definition") BETWEEN 1 AND 4000),
	CONSTRAINT "concepts_example_len_check" CHECK ("concepts"."example" IS NULL OR char_length("concepts"."example") BETWEEN 1 AND 4000),
	CONSTRAINT "concepts_aliases_count_check" CHECK (cardinality("concepts"."aliases") <= 10)
);
--> statement-breakpoint
CREATE TABLE "document_knowledge_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"concept_id" uuid,
	"relation_id" uuid,
	"origin" varchar(16) NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_knowledge_refs_target_check" CHECK ((("document_knowledge_refs"."concept_id" IS NOT NULL)::int + ("document_knowledge_refs"."relation_id" IS NOT NULL)::int) = 1),
	CONSTRAINT "document_knowledge_refs_origin_check" CHECK ("document_knowledge_refs"."origin" IN ('manual', 'agent'))
);
--> statement-breakpoint
ALTER TABLE "agent_executions" DROP CONSTRAINT "agent_executions_agent_type_check";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_check";--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "review_revision" integer;--> statement-breakpoint
ALTER TABLE "review_logs" ADD COLUMN "binding_id" uuid;--> statement-breakpoint
ALTER TABLE "review_logs" ADD COLUMN "epoch_id" uuid;--> statement-breakpoint
ALTER TABLE "review_logs" ADD COLUMN "target_version" integer;--> statement-breakpoint
ALTER TABLE "review_logs" ADD COLUMN "question_id" uuid;--> statement-breakpoint
ALTER TABLE "review_logs" ADD COLUMN "review_revision" integer;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "concept_graph_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "card_knowledge_links" ADD CONSTRAINT "card_knowledge_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_knowledge_links" ADD CONSTRAINT "card_knowledge_links_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_knowledge_links" ADD CONSTRAINT "card_knowledge_links_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_knowledge_links" ADD CONSTRAINT "card_knowledge_links_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_knowledge_links" ADD CONSTRAINT "card_knowledge_links_relation_id_concept_relations_id_fk" FOREIGN KEY ("relation_id") REFERENCES "public"."concept_relations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_batches" ADD CONSTRAINT "concept_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_batches" ADD CONSTRAINT "concept_batches_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_batches" ADD CONSTRAINT "concept_batches_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_batches" ADD CONSTRAINT "concept_batches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_batches" ADD CONSTRAINT "concept_batches_retry_of_fk" FOREIGN KEY ("retry_of_batch_id") REFERENCES "public"."concept_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_evidence" ADD CONSTRAINT "concept_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_evidence" ADD CONSTRAINT "concept_evidence_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_evidence" ADD CONSTRAINT "concept_evidence_relation_id_concept_relations_id_fk" FOREIGN KEY ("relation_id") REFERENCES "public"."concept_relations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_evidence" ADD CONSTRAINT "concept_evidence_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_notes" ADD CONSTRAINT "concept_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_notes" ADD CONSTRAINT "concept_notes_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_notes" ADD CONSTRAINT "concept_notes_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_notes" ADD CONSTRAINT "concept_notes_relation_id_concept_relations_id_fk" FOREIGN KEY ("relation_id") REFERENCES "public"."concept_relations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_notes" ADD CONSTRAINT "concept_notes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_operation_requests" ADD CONSTRAINT "concept_operation_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_practice_bindings" ADD CONSTRAINT "concept_practice_bindings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_practice_bindings" ADD CONSTRAINT "concept_practice_bindings_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_practice_bindings" ADD CONSTRAINT "concept_practice_bindings_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_practice_bindings" ADD CONSTRAINT "concept_practice_bindings_relation_id_concept_relations_id_fk" FOREIGN KEY ("relation_id") REFERENCES "public"."concept_relations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_practice_bindings" ADD CONSTRAINT "concept_practice_bindings_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_practice_proposals" ADD CONSTRAINT "concept_practice_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_practice_proposals" ADD CONSTRAINT "concept_practice_proposals_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_practice_proposals" ADD CONSTRAINT "concept_practice_proposals_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_practice_proposals" ADD CONSTRAINT "concept_practice_proposals_relation_id_concept_relations_id_fk" FOREIGN KEY ("relation_id") REFERENCES "public"."concept_relations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_practice_proposals" ADD CONSTRAINT "concept_practice_proposals_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_relations" ADD CONSTRAINT "concept_relations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_relations" ADD CONSTRAINT "concept_relations_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_relations" ADD CONSTRAINT "concept_relations_from_concept_fk" FOREIGN KEY ("from_concept_id","user_id","topic_id") REFERENCES "public"."concepts"("id","user_id","topic_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_relations" ADD CONSTRAINT "concept_relations_to_concept_fk" FOREIGN KEY ("to_concept_id","user_id","topic_id") REFERENCES "public"."concepts"("id","user_id","topic_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_knowledge_refs" ADD CONSTRAINT "document_knowledge_refs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_knowledge_refs" ADD CONSTRAINT "document_knowledge_refs_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_knowledge_refs" ADD CONSTRAINT "document_knowledge_refs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_knowledge_refs" ADD CONSTRAINT "document_knowledge_refs_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_knowledge_refs" ADD CONSTRAINT "document_knowledge_refs_relation_id_concept_relations_id_fk" FOREIGN KEY ("relation_id") REFERENCES "public"."concept_relations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_card_knowledge_links_card" ON "card_knowledge_links" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "idx_card_knowledge_links_concept" ON "card_knowledge_links" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "idx_card_knowledge_links_relation" ON "card_knowledge_links" USING btree ("relation_id");--> statement-breakpoint
CREATE INDEX "idx_card_knowledge_links_user" ON "card_knowledge_links" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "card_knowledge_links_card_concept_uidx" ON "card_knowledge_links" USING btree ("card_id","concept_id") WHERE "card_knowledge_links"."concept_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "card_knowledge_links_card_relation_uidx" ON "card_knowledge_links" USING btree ("card_id","relation_id") WHERE "card_knowledge_links"."relation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_concept_batches_user_created" ON "concept_batches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_concept_batches_document" ON "concept_batches" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_concept_batches_topic" ON "concept_batches" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_concept_batches_status" ON "concept_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_concept_evidence_concept" ON "concept_evidence" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "idx_concept_evidence_relation" ON "concept_evidence" USING btree ("relation_id");--> statement-breakpoint
CREATE INDEX "idx_concept_evidence_document" ON "concept_evidence" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_concept_evidence_user" ON "concept_evidence" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_concept_notes_concept" ON "concept_notes" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "idx_concept_notes_relation" ON "concept_notes" USING btree ("relation_id");--> statement-breakpoint
CREATE INDEX "idx_concept_notes_document" ON "concept_notes" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_concept_notes_user_topic" ON "concept_notes" USING btree ("user_id","topic_id");--> statement-breakpoint
CREATE INDEX "idx_concept_operation_requests_user" ON "concept_operation_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_concept_practice_bindings_card" ON "concept_practice_bindings" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "idx_concept_practice_bindings_concept" ON "concept_practice_bindings" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "idx_concept_practice_bindings_relation" ON "concept_practice_bindings" USING btree ("relation_id");--> statement-breakpoint
CREATE INDEX "idx_concept_practice_bindings_user" ON "concept_practice_bindings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_practice_bindings_active_card_uidx" ON "concept_practice_bindings" USING btree ("card_id") WHERE "concept_practice_bindings"."ended_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "concept_practice_bindings_active_concept_kind_uidx" ON "concept_practice_bindings" USING btree ("concept_id","exercise_kind") WHERE "concept_practice_bindings"."concept_id" IS NOT NULL AND "concept_practice_bindings"."ended_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "concept_practice_bindings_active_relation_kind_uidx" ON "concept_practice_bindings" USING btree ("relation_id","exercise_kind") WHERE "concept_practice_bindings"."relation_id" IS NOT NULL AND "concept_practice_bindings"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_concept_practice_proposals_user" ON "concept_practice_proposals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_concept_practice_proposals_concept" ON "concept_practice_proposals" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "idx_concept_practice_proposals_relation" ON "concept_practice_proposals" USING btree ("relation_id");--> statement-breakpoint
CREATE INDEX "idx_concept_relations_topic" ON "concept_relations" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_concept_relations_from" ON "concept_relations" USING btree ("from_concept_id");--> statement-breakpoint
CREATE INDEX "idx_concept_relations_to" ON "concept_relations" USING btree ("to_concept_id");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_relations_active_identity_uidx" ON "concept_relations" USING btree ("user_id","identity_hash") WHERE "concept_relations"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_concepts_topic" ON "concepts" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_concepts_user_topic" ON "concepts" USING btree ("user_id","topic_id");--> statement-breakpoint
CREATE INDEX "idx_concepts_topic_normalized_name" ON "concepts" USING btree ("topic_id","normalized_name");--> statement-breakpoint
CREATE INDEX "idx_document_knowledge_refs_document" ON "document_knowledge_refs" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_document_knowledge_refs_topic" ON "document_knowledge_refs" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_document_knowledge_refs_concept" ON "document_knowledge_refs" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "idx_document_knowledge_refs_relation" ON "document_knowledge_refs" USING btree ("relation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_knowledge_refs_concept_uidx" ON "document_knowledge_refs" USING btree ("document_id","concept_id") WHERE "document_knowledge_refs"."concept_id" IS NOT NULL AND "document_knowledge_refs"."removed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "document_knowledge_refs_relation_uidx" ON "document_knowledge_refs" USING btree ("document_id","relation_id") WHERE "document_knowledge_refs"."relation_id" IS NOT NULL AND "document_knowledge_refs"."removed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_agent_type_check" CHECK ("agent_executions"."agent_type" IN ('digest', 'evolve', 'weekly_report', 'topic', 'chat', 'selection', 'extract', 'ocr', 'memory_organize', 'conversation', 'concept_extract', 'concept_practice'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_check" CHECK ("jobs"."type" IN ('digest', 'evolve', 'weekly_report', 'topic', 'chat', 'selection', 'extract', 'ocr', 'annotation_resurface', 'memory_organize', 'conversation', 'concept_extract', 'concept_practice'));