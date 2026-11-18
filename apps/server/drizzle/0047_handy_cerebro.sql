ALTER TABLE "pdf_translation_jobs" ADD COLUMN "stream_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "pdf_translation_jobs" ADD COLUMN "draft_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdf_translation_jobs" ADD COLUMN "draft_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdf_translation_jobs" ADD COLUMN "draft_updated_at" timestamp with time zone;--> statement-breakpoint
CREATE FUNCTION pdf_translation_stream_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state IS DISTINCT FROM NEW.state AND NEW.draft_seq = OLD.draft_seq THEN
    NEW.draft_seq := OLD.draft_seq + 1;
  END IF;
  IF TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM NEW.state OR OLD.draft_seq IS DISTINCT FROM NEW.draft_seq THEN
    PERFORM pg_notify('pdf_translation_changed', json_build_object('userId', NEW.user_id, 'jobId', NEW.id)::text);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pdf_translation_stream_notify BEFORE INSERT OR UPDATE ON pdf_translation_jobs FOR EACH ROW EXECUTE FUNCTION pdf_translation_stream_notify();
