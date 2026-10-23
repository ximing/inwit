ALTER TABLE "sync_changes" DROP CONSTRAINT "sync_changes_scope_check";--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "file_mime" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_scope_check" CHECK ("sync_changes"."scope" IN ('document', 'topic', 'map', 'review', 'job', 'report', 'suggest', 'resurface', 'concept'));