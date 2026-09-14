-- T11: captures → documents (same uuid) + card_links + cards.document_id/anchors.
-- Data copy is inlined here so schema change + backfill + drop are one atomic migrate.
-- jobs.payload.captureId is intentionally unchanged (finished jobs are not re-run;
-- new jobs write documentId; processors accept either key because documents keep the old ids).
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" uuid,
	"title" text NOT NULL,
	"content_md" text NOT NULL,
	"source" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_source_check" CHECK ("documents"."source" IN ('editor', 'paste', 'chat')),
	CONSTRAINT "documents_status_check" CHECK ("documents"."status" IN ('pending', 'digested', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_documents_user_created" ON "documents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_documents_user_status" ON "documents" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_documents_thread" ON "documents" USING btree ("thread_id");--> statement-breakpoint
INSERT INTO "documents" (
	"id",
	"user_id",
	"thread_id",
	"title",
	"content_md",
	"source",
	"status",
	"answer",
	"created_at",
	"updated_at"
)
SELECT
	"id",
	"user_id",
	"thread_id",
	LEFT(
		COALESCE(
			NULLIF(btrim(split_part(replace("raw_content", E'\r\n', E'\n'), E'\n', 1)), ''),
			NULLIF(btrim("raw_content"), ''),
			'未命名文档'
		),
		40
	),
	"raw_content",
	CASE WHEN "type" = 'chat' THEN 'chat' ELSE 'paste' END,
	"status",
	"answer",
	"created_at",
	"updated_at"
FROM "captures";
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "anchor_text" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "anchor_block" text;--> statement-breakpoint
UPDATE "cards" AS c
SET "document_id" = c."capture_id"
WHERE c."capture_id" IS NOT NULL
	AND EXISTS (SELECT 1 FROM "documents" d WHERE d."id" = c."capture_id");
--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT "cards_capture_id_captures_id_fk";
--> statement-breakpoint
DROP INDEX "idx_cards_capture";--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "capture_id";--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cards_document" ON "cards" USING btree ("document_id");--> statement-breakpoint
CREATE TABLE "card_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_card_id" uuid NOT NULL,
	"to_card_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"origin" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_links_from_to_type_uidx" UNIQUE("from_card_id","to_card_id","type"),
	CONSTRAINT "card_links_type_check" CHECK ("card_links"."type" IN ('same_concept', 'confusable', 'prerequisite', 'related')),
	CONSTRAINT "card_links_origin_check" CHECK ("card_links"."origin" IN ('agent', 'user')),
	CONSTRAINT "card_links_not_self_check" CHECK ("card_links"."from_card_id" <> "card_links"."to_card_id")
);
--> statement-breakpoint
ALTER TABLE "card_links" ADD CONSTRAINT "card_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_links" ADD CONSTRAINT "card_links_from_card_id_cards_id_fk" FOREIGN KEY ("from_card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_links" ADD CONSTRAINT "card_links_to_card_id_cards_id_fk" FOREIGN KEY ("to_card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_card_links_user" ON "card_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_card_links_from" ON "card_links" USING btree ("from_card_id");--> statement-breakpoint
CREATE INDEX "idx_card_links_to" ON "card_links" USING btree ("to_card_id");--> statement-breakpoint
DROP TABLE "captures";
