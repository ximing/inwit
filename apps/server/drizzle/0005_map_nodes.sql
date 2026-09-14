-- T17: knowledge map nodes + cards/documents.map_node_id.
CREATE TABLE "map_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"parent_id" uuid,
	"title" text NOT NULL,
	"status" varchar(16) DEFAULT 'uncovered' NOT NULL,
	"note" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_nodes_status_check" CHECK ("map_nodes"."status" IN ('uncovered', 'learning', 'covered')),
	CONSTRAINT "map_nodes_not_self_parent_check" CHECK ("map_nodes"."parent_id" IS NULL OR "map_nodes"."parent_id" <> "map_nodes"."id")
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "map_node_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "map_node_id" uuid;--> statement-breakpoint
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_parent_id_map_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."map_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_map_nodes_topic_parent" ON "map_nodes" USING btree ("topic_id","parent_id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_map_node_id_map_nodes_id_fk" FOREIGN KEY ("map_node_id") REFERENCES "public"."map_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_map_node_id_map_nodes_id_fk" FOREIGN KEY ("map_node_id") REFERENCES "public"."map_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cards_map_node" ON "cards" USING btree ("map_node_id");--> statement-breakpoint
CREATE INDEX "idx_documents_map_node" ON "documents" USING btree ("map_node_id");