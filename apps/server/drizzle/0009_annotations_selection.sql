CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"quote" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_executions" DROP CONSTRAINT "agent_executions_agent_type_check";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_check";--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_annotations_user" ON "annotations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_annotations_document" ON "annotations" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_agent_type_check" CHECK ("agent_executions"."agent_type" IN ('digest', 'evolve', 'weekly_report', 'topic', 'chat', 'selection'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_check" CHECK ("jobs"."type" IN ('digest', 'evolve', 'weekly_report', 'topic', 'chat', 'selection'));