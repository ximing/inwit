ALTER TABLE "cards" ADD COLUMN "outline_parent_id" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "outline_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_outline_parent_id_cards_id_fk" FOREIGN KEY ("outline_parent_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cards_document_outline" ON "cards" USING btree ("document_id","outline_parent_id","outline_position");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_outline_not_self_check" CHECK ("cards"."outline_parent_id" IS NULL OR "cards"."outline_parent_id" <> "cards"."id");