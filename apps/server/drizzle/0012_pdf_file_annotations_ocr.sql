CREATE TABLE "ocr_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"model" varchar(128) DEFAULT 'qwen-vl-ocr' NOT NULL,
	"base_url" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "kind" varchar(16) DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "page_index" integer;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "geometry" jsonb;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "image_key" text;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "position_ms" integer;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "image_key" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "file_key" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "file_mime" varchar(64);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "file_size" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "page_count" integer;--> statement-breakpoint
ALTER TABLE "ocr_configs" ADD CONSTRAINT "ocr_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_configs_user_uidx" ON "ocr_configs" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_kind_check" CHECK ("annotations"."kind" IN ('text', 'pdf', 'media'));