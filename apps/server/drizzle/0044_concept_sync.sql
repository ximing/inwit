-- 概念与关系领域的 sync 触发器（T10）。scope='concept'；resourceId 优先 topicId，
-- 文档范围的行（refs/evidence/batches）额外发 documentId 事件；练习绑定同时发 review 事件。
ALTER TABLE "sync_changes" DROP CONSTRAINT "sync_changes_scope_check";--> statement-breakpoint
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_scope_check" CHECK ("sync_changes"."scope" IN ('document', 'topic', 'map', 'review', 'job', 'report', 'suggest', 'resurface', 'concept'));--> statement-breakpoint

CREATE OR REPLACE FUNCTION sync_concept_scope_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid;
  v_topic uuid;
  v_doc uuid;
  v_card uuid;
  v_op text;
  v_at timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_op := 'delete';
    v_user := OLD.user_id;
    v_at := clock_timestamp();
    IF TG_TABLE_NAME = 'concept_batches' THEN
      v_doc := OLD.document_id;
    END IF;
    v_topic := OLD.topic_id;
    v_card := NULL;
  ELSE
    v_op := 'upsert';
    v_user := NEW.user_id;
    -- card_knowledge_links 只有 created_at；其余表有 updated_at
    IF TG_TABLE_NAME = 'card_knowledge_links' THEN
      v_at := COALESCE(NEW.created_at, clock_timestamp());
    ELSE
      v_at := COALESCE(NEW.updated_at, NEW.created_at, clock_timestamp());
    END IF;
    IF TG_TABLE_NAME = 'concept_batches' THEN
      v_doc := NEW.document_id;
    END IF;
    v_topic := NEW.topic_id;
    v_card := NULL;
  END IF;

  -- 练习绑定：resourceId=cardId 并额外发 review，供复习页失效
  IF TG_TABLE_NAME = 'concept_practice_bindings' THEN
    IF TG_OP = 'DELETE' THEN
      v_card := OLD.card_id;
    ELSE
      v_card := NEW.card_id;
    END IF;
    PERFORM sync_emit(v_user, 'review', v_card, 'upsert', v_at);
  END IF;

  PERFORM sync_emit(v_user, 'concept', COALESCE(v_topic, v_card), v_op, v_at);
  IF v_doc IS NOT NULL THEN
    PERFORM sync_emit(v_user, 'concept', v_doc, v_op, v_at);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER sync_concepts AFTER INSERT OR UPDATE OR DELETE ON concepts FOR EACH ROW EXECUTE FUNCTION sync_concept_scope_row();--> statement-breakpoint
CREATE TRIGGER sync_concept_relations AFTER INSERT OR UPDATE OR DELETE ON concept_relations FOR EACH ROW EXECUTE FUNCTION sync_concept_scope_row();--> statement-breakpoint
CREATE TRIGGER sync_concept_notes AFTER INSERT OR UPDATE OR DELETE ON concept_notes FOR EACH ROW EXECUTE FUNCTION sync_concept_scope_row();--> statement-breakpoint
CREATE TRIGGER sync_document_knowledge_refs AFTER INSERT OR UPDATE OR DELETE ON document_knowledge_refs FOR EACH ROW EXECUTE FUNCTION sync_concept_scope_row();--> statement-breakpoint
CREATE TRIGGER sync_card_knowledge_links AFTER INSERT OR UPDATE OR DELETE ON card_knowledge_links FOR EACH ROW EXECUTE FUNCTION sync_concept_scope_row();--> statement-breakpoint
CREATE TRIGGER sync_concept_batches AFTER INSERT OR UPDATE OR DELETE ON concept_batches FOR EACH ROW EXECUTE FUNCTION sync_concept_scope_row();--> statement-breakpoint
CREATE TRIGGER sync_concept_practice_proposals AFTER INSERT OR UPDATE OR DELETE ON concept_practice_proposals FOR EACH ROW EXECUTE FUNCTION sync_concept_scope_row();--> statement-breakpoint
CREATE TRIGGER sync_concept_practice_bindings AFTER INSERT OR UPDATE OR DELETE ON concept_practice_bindings FOR EACH ROW EXECUTE FUNCTION sync_concept_scope_row();--> statement-breakpoint

-- 证据表没有 topic_id：按目标查主题后发 concept 事件（resourceId=topicId；文档证据另发 documentId）
CREATE OR REPLACE FUNCTION sync_concept_evidence_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid;
  v_topic uuid;
  v_doc uuid;
  v_op text;
  v_at timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_op := 'delete';
    v_user := OLD.user_id;
    v_doc := OLD.document_id;
    v_at := clock_timestamp();
    IF OLD.concept_id IS NOT NULL THEN
      SELECT topic_id INTO v_topic FROM concepts WHERE id = OLD.concept_id;
    ELSE
      SELECT topic_id INTO v_topic FROM concept_relations WHERE id = OLD.relation_id;
    END IF;
  ELSE
    v_op := 'upsert';
    v_user := NEW.user_id;
    v_doc := NEW.document_id;
    v_at := COALESCE(NEW.updated_at, NEW.created_at, clock_timestamp());
    IF NEW.concept_id IS NOT NULL THEN
      SELECT topic_id INTO v_topic FROM concepts WHERE id = NEW.concept_id;
    ELSE
      SELECT topic_id INTO v_topic FROM concept_relations WHERE id = NEW.relation_id;
    END IF;
  END IF;
  PERFORM sync_emit(v_user, 'concept', v_topic, v_op, v_at);
  IF v_doc IS NOT NULL THEN
    PERFORM sync_emit(v_user, 'concept', v_doc, v_op, v_at);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_concept_evidence AFTER INSERT OR UPDATE OR DELETE ON concept_evidence FOR EACH ROW EXECUTE FUNCTION sync_concept_evidence_row();--> statement-breakpoint
