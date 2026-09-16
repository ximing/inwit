ALTER TABLE "annotations" ADD COLUMN "anchor_block_index" integer;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "anchor_block_index" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "content_json" jsonb DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "anchor_block";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "content_md";