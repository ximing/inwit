ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_check";--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "file_size" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_check" CHECK ("jobs"."type" IN ('digest', 'evolve', 'weekly_report', 'topic', 'chat', 'selection', 'extract', 'ocr'));