ALTER TABLE "documents" ALTER COLUMN "title" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "description" text;