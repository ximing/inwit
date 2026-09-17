ALTER TABLE "documents" ADD COLUMN "fail_reason" text;--> statement-breakpoint
ALTER TABLE "agent_executions" DROP CONSTRAINT "agent_executions_agent_type_check";--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_agent_type_check" CHECK ("agent_executions"."agent_type" IN ('digest', 'evolve', 'weekly_report', 'topic', 'chat', 'selection', 'extract', 'ocr'));