CREATE TABLE "canvas_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"card_id" uuid,
	"annotation_id" uuid,
	"text" text,
	"image_key" text,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canvas_nodes_kind_check" CHECK ("canvas_nodes"."kind" IN ('card', 'annotation', 'text', 'image')),
	CONSTRAINT "canvas_nodes_not_self_check" CHECK ("canvas_nodes"."parent_id" IS NULL OR "canvas_nodes"."parent_id" <> "canvas_nodes"."id"),
	CONSTRAINT "canvas_nodes_shape_check" CHECK ((
        ("canvas_nodes"."kind" = 'card' AND "canvas_nodes"."card_id" IS NOT NULL AND "canvas_nodes"."annotation_id" IS NULL AND "canvas_nodes"."text" IS NULL AND "canvas_nodes"."image_key" IS NULL AND "canvas_nodes"."id" = "canvas_nodes"."card_id")
        OR ("canvas_nodes"."kind" = 'annotation' AND "canvas_nodes"."annotation_id" IS NOT NULL AND "canvas_nodes"."card_id" IS NULL AND "canvas_nodes"."text" IS NULL AND "canvas_nodes"."image_key" IS NULL AND "canvas_nodes"."id" = "canvas_nodes"."annotation_id")
        OR ("canvas_nodes"."kind" = 'text' AND "canvas_nodes"."text" IS NOT NULL AND char_length("canvas_nodes"."text") BETWEEN 1 AND 4000 AND "canvas_nodes"."card_id" IS NULL AND "canvas_nodes"."annotation_id" IS NULL AND "canvas_nodes"."image_key" IS NULL)
        OR ("canvas_nodes"."kind" = 'image' AND "canvas_nodes"."image_key" IS NOT NULL AND char_length("canvas_nodes"."image_key") BETWEEN 1 AND 512 AND "canvas_nodes"."card_id" IS NULL AND "canvas_nodes"."annotation_id" IS NULL AND "canvas_nodes"."text" IS NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "canvas_nodes" ADD CONSTRAINT "canvas_nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_nodes" ADD CONSTRAINT "canvas_nodes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_nodes" ADD CONSTRAINT "canvas_nodes_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_nodes" ADD CONSTRAINT "canvas_nodes_annotation_id_annotations_id_fk" FOREIGN KEY ("annotation_id") REFERENCES "public"."annotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_nodes" ADD CONSTRAINT "canvas_nodes_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."canvas_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_canvas_nodes_document" ON "canvas_nodes" USING btree ("document_id","parent_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_nodes_card_id_unique" ON "canvas_nodes" USING btree ("card_id") WHERE "canvas_nodes"."card_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_nodes_annotation_id_unique" ON "canvas_nodes" USING btree ("annotation_id") WHERE "canvas_nodes"."annotation_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "canvas_nodes" ("id", "user_id", "document_id", "kind", "card_id", "parent_id", "position")
SELECT c.id, c.user_id, c.document_id, 'card', c.id, NULL, c.outline_position
FROM "cards" c
WHERE c.deleted_at IS NULL
  AND c.document_id IS NOT NULL
  AND c.acceptance <> 'rejected'
  AND (
    c.outline_parent_id IS NOT NULL
    OR c.outline_position <> 0
    OR EXISTS (
      SELECT 1 FROM "cards" ch
      WHERE ch.outline_parent_id = c.id AND ch.deleted_at IS NULL
    )
  );
--> statement-breakpoint
UPDATE "canvas_nodes" n
SET "parent_id" = c.outline_parent_id
FROM "cards" c
WHERE n.card_id = c.id
  AND c.outline_parent_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM "canvas_nodes" p WHERE p.id = c.outline_parent_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_canvas_nodes_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r canvas_nodes%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
  ELSE
    r := NEW;
  END IF;
  PERFORM sync_emit(r.user_id, 'document', r.document_id, 'upsert', r.updated_at);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_canvas_nodes
AFTER INSERT OR UPDATE OR DELETE ON canvas_nodes
FOR EACH ROW
EXECUTE FUNCTION sync_canvas_nodes_row();