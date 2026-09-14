-- T16: threads → topics. Table/column/index/constraint rename + enum value rewrite.
-- No compatibility layer. Historical jobs.payload.threadId is left as-is.
ALTER TABLE "threads" RENAME TO "topics";
--> statement-breakpoint
ALTER INDEX "idx_threads_user" RENAME TO "idx_topics_user";
--> statement-breakpoint
ALTER INDEX "idx_threads_user_status" RENAME TO "idx_topics_user_status";
--> statement-breakpoint
ALTER TABLE "topics" RENAME CONSTRAINT "threads_user_id_users_id_fk" TO "topics_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "topics" RENAME CONSTRAINT "threads_status_check" TO "topics_status_check";
--> statement-breakpoint
ALTER TABLE "documents" RENAME COLUMN "thread_id" TO "topic_id";
--> statement-breakpoint
ALTER INDEX "idx_documents_thread" RENAME TO "idx_documents_topic";
--> statement-breakpoint
ALTER TABLE "documents" RENAME CONSTRAINT "documents_thread_id_threads_id_fk" TO "documents_topic_id_topics_id_fk";
--> statement-breakpoint
ALTER TABLE "cards" RENAME COLUMN "thread_id" TO "topic_id";
--> statement-breakpoint
ALTER INDEX "idx_cards_thread" RENAME TO "idx_cards_topic";
--> statement-breakpoint
ALTER TABLE "cards" RENAME CONSTRAINT "cards_thread_id_threads_id_fk" TO "cards_topic_id_topics_id_fk";
--> statement-breakpoint
ALTER TABLE "memories" DROP CONSTRAINT "memories_scope_check";
--> statement-breakpoint
ALTER TABLE "memories" DROP CONSTRAINT "memories_layer_check";
--> statement-breakpoint
ALTER TABLE "memories" DROP CONSTRAINT "memories_scope_id_check";
--> statement-breakpoint
UPDATE "memories" SET "scope" = 'topic' WHERE "scope" = 'thread';
--> statement-breakpoint
UPDATE "memories" SET "layer" = 'topic_map' WHERE "layer" = 'thread_map';
--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_scope_check" CHECK ("memories"."scope" IN ('user', 'topic'));
--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_layer_check" CHECK ("memories"."layer" IN ('profile', 'mastery', 'association', 'topic_map'));
--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_scope_id_check" CHECK (("memories"."scope" = 'user' AND "memories"."scope_id" IS NULL) OR ("memories"."scope" = 'topic' AND "memories"."scope_id" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_check";
--> statement-breakpoint
UPDATE "jobs" SET "type" = 'topic' WHERE "type" = 'thread';
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_check" CHECK ("jobs"."type" IN ('digest', 'evolve', 'weekly_report', 'topic', 'chat'));
--> statement-breakpoint
ALTER TABLE "agent_executions" DROP CONSTRAINT "agent_executions_agent_type_check";
--> statement-breakpoint
UPDATE "agent_executions" SET "agent_type" = 'topic' WHERE "agent_type" = 'thread';
--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_agent_type_check" CHECK ("agent_executions"."agent_type" IN ('digest', 'evolve', 'weekly_report', 'topic', 'chat'));
