ALTER TABLE "agent_messages" ADD COLUMN "thinking" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD COLUMN "activity" varchar(40);