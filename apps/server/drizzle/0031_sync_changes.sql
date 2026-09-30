CREATE TABLE "sync_changes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"scope" varchar(16) NOT NULL,
	"resource_id" uuid,
	"op" varchar(8) NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_changes_scope_check" CHECK ("sync_changes"."scope" IN ('document', 'topic', 'map', 'review', 'job', 'report', 'suggest', 'resurface')),
	CONSTRAINT "sync_changes_op_check" CHECK ("sync_changes"."op" IN ('upsert', 'delete'))
);
--> statement-breakpoint
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sync_changes_user_id" ON "sync_changes" USING btree ("user_id","id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_emit(
  p_user uuid,
  p_scope text,
  p_resource uuid,
  p_op text,
  p_at timestamptz
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  -- User row already gone: insert zero rows instead of failing the cascading delete.
  INSERT INTO sync_changes (user_id, scope, resource_id, op, at)
  SELECT p_user, p_scope, p_resource, p_op, p_at
  WHERE EXISTS (SELECT 1 FROM users WHERE id = p_user);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_documents_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_op text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM sync_emit(OLD.user_id, 'document', OLD.id, 'delete', OLD.updated_at);
    IF OLD.topic_id IS NOT NULL THEN
      PERFORM sync_emit(OLD.user_id, 'topic', OLD.topic_id, 'upsert', OLD.updated_at);
      PERFORM sync_emit(OLD.user_id, 'map', OLD.topic_id, 'upsert', OLD.updated_at);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.deleted_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.deleted_at IS NULL) THEN
    v_op := 'delete';
  ELSE
    v_op := 'upsert';
  END IF;
  PERFORM sync_emit(NEW.user_id, 'document', NEW.id, v_op, NEW.updated_at);

  IF NEW.kind = 'weekly_report' AND (TG_OP = 'INSERT' OR OLD.kind IS DISTINCT FROM 'weekly_report') THEN
    PERFORM sync_emit(NEW.user_id, 'report', NULL, 'upsert', NEW.updated_at);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.topic_id IS NOT NULL THEN
      PERFORM sync_emit(NEW.user_id, 'topic', NEW.topic_id, 'upsert', NEW.updated_at);
      PERFORM sync_emit(NEW.user_id, 'map', NEW.topic_id, 'upsert', NEW.updated_at);
    END IF;
  ELSIF OLD.topic_id IS DISTINCT FROM NEW.topic_id THEN
    IF OLD.topic_id IS NOT NULL THEN
      PERFORM sync_emit(NEW.user_id, 'topic', OLD.topic_id, 'upsert', NEW.updated_at);
      PERFORM sync_emit(NEW.user_id, 'map', OLD.topic_id, 'upsert', NEW.updated_at);
    END IF;
    IF NEW.topic_id IS NOT NULL THEN
      PERFORM sync_emit(NEW.user_id, 'topic', NEW.topic_id, 'upsert', NEW.updated_at);
      PERFORM sync_emit(NEW.user_id, 'map', NEW.topic_id, 'upsert', NEW.updated_at);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_documents
AFTER INSERT OR UPDATE OR DELETE ON documents
FOR EACH ROW
EXECUTE FUNCTION sync_documents_row();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_cards_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r cards%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
  ELSE
    r := NEW;
  END IF;
  IF r.document_id IS NOT NULL THEN
    PERFORM sync_emit(r.user_id, 'document', r.document_id, 'upsert', r.updated_at);
  END IF;
  PERFORM sync_emit(r.user_id, 'review', NULL, 'upsert', r.updated_at);
  IF r.topic_id IS NOT NULL THEN
    PERFORM sync_emit(r.user_id, 'topic', r.topic_id, 'upsert', r.updated_at);
    PERFORM sync_emit(r.user_id, 'map', r.topic_id, 'upsert', r.updated_at);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_cards
AFTER INSERT OR UPDATE OR DELETE ON cards
FOR EACH ROW
EXECUTE FUNCTION sync_cards_row();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_card_questions_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_card uuid;
  v_user uuid;
  v_doc uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_card := OLD.card_id;
  ELSE
    v_card := NEW.card_id;
  END IF;
  SELECT user_id, document_id INTO v_user, v_doc FROM cards WHERE id = v_card;
  IF NOT FOUND OR v_doc IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  PERFORM sync_emit(v_user, 'document', v_doc, 'upsert', clock_timestamp());
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_card_questions
AFTER INSERT OR UPDATE OR DELETE ON card_questions
FOR EACH ROW
EXECUTE FUNCTION sync_card_questions_row();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_review_states_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r review_states%ROWTYPE;
  v_doc uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
  ELSE
    r := NEW;
  END IF;
  PERFORM sync_emit(r.user_id, 'review', NULL, 'upsert', r.updated_at);
  SELECT document_id INTO v_doc FROM cards WHERE id = r.card_id;
  IF FOUND AND v_doc IS NOT NULL THEN
    PERFORM sync_emit(r.user_id, 'document', v_doc, 'upsert', r.updated_at);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_review_states
AFTER INSERT OR UPDATE OR DELETE ON review_states
FOR EACH ROW
EXECUTE FUNCTION sync_review_states_row();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_annotations_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r annotations%ROWTYPE;
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
CREATE TRIGGER sync_annotations
AFTER INSERT OR UPDATE OR DELETE ON annotations
FOR EACH ROW
EXECUTE FUNCTION sync_annotations_row();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_card_links_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid;
  v_at timestamptz;
  v_from_card uuid;
  v_to_card uuid;
  v_from_doc uuid;
  v_to_doc uuid;
  v_from_found boolean;
  v_to_found boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user := OLD.user_id;
    v_at := clock_timestamp();
    v_from_card := OLD.from_card_id;
    v_to_card := OLD.to_card_id;
  ELSE
    v_user := NEW.user_id;
    v_at := NEW.created_at;
    v_from_card := NEW.from_card_id;
    v_to_card := NEW.to_card_id;
  END IF;

  SELECT document_id INTO v_from_doc FROM cards WHERE id = v_from_card;
  v_from_found := FOUND;
  SELECT document_id INTO v_to_doc FROM cards WHERE id = v_to_card;
  v_to_found := FOUND;

  IF v_from_found AND v_from_doc IS NOT NULL THEN
    PERFORM sync_emit(v_user, 'document', v_from_doc, 'upsert', v_at);
  END IF;
  IF v_to_found AND v_to_doc IS NOT NULL AND (NOT v_from_found OR v_from_doc IS DISTINCT FROM v_to_doc) THEN
    PERFORM sync_emit(v_user, 'document', v_to_doc, 'upsert', v_at);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_card_links
AFTER INSERT OR DELETE ON card_links
FOR EACH ROW
EXECUTE FUNCTION sync_card_links_row();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_topics_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r topics%ROWTYPE;
  v_op text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    v_op := 'delete';
  ELSE
    r := NEW;
    v_op := 'upsert';
  END IF;
  PERFORM sync_emit(r.user_id, 'topic', r.id, v_op, r.updated_at);
  PERFORM sync_emit(r.user_id, 'map', r.id, v_op, r.updated_at);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_topics
AFTER INSERT OR UPDATE OR DELETE ON topics
FOR EACH ROW
EXECUTE FUNCTION sync_topics_row();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_map_nodes_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_topic uuid;
  v_user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_topic := OLD.topic_id;
  ELSE
    v_topic := NEW.topic_id;
  END IF;
  SELECT user_id INTO v_user FROM topics WHERE id = v_topic;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  PERFORM sync_emit(v_user, 'map', v_topic, 'upsert', clock_timestamp());
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_map_nodes
AFTER INSERT OR UPDATE OR DELETE ON map_nodes
FOR EACH ROW
EXECUTE FUNCTION sync_map_nodes_row();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_jobs_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  PERFORM sync_emit(NEW.user_id, 'job', NEW.id, 'upsert', NEW.updated_at);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_jobs_insert
AFTER INSERT ON jobs
FOR EACH ROW
EXECUTE FUNCTION sync_jobs_row();
--> statement-breakpoint
CREATE TRIGGER sync_jobs
AFTER UPDATE ON jobs
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.payload IS DISTINCT FROM NEW.payload
  OR OLD.run_at IS DISTINCT FROM NEW.run_at
  OR OLD.last_error IS DISTINCT FROM NEW.last_error
  OR OLD.finished_at IS DISTINCT FROM NEW.finished_at
)
EXECUTE FUNCTION sync_jobs_row();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_memories_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid;
  v_key text;
  v_at timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user := OLD.user_id;
    v_key := OLD.key;
    v_at := OLD.updated_at;
  ELSE
    v_user := NEW.user_id;
    v_key := NEW.key;
    v_at := NEW.updated_at;
  END IF;
  IF starts_with(v_key, 'topic_suggestion_') THEN
    PERFORM sync_emit(v_user, 'suggest', NULL, 'upsert', v_at);
  ELSIF v_key ~ '^annotation_resurface_[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    PERFORM sync_emit(v_user, 'resurface', NULL, 'upsert', v_at);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_memories
AFTER INSERT OR UPDATE OR DELETE ON memories
FOR EACH ROW
EXECUTE FUNCTION sync_memories_row();
