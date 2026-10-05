ALTER TABLE "annotations" DROP CONSTRAINT "annotations_kind_check";--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_kind_check" CHECK ("annotations"."kind" IN ('text', 'pdf', 'media', 'note'));--> statement-breakpoint

-- 存量脑图孤儿节点归并进批注体系（幂等：二次执行 WHERE 为空集）。
-- 文本节点 → note 批注（id 复用 canvas 行 id，无映射问题）。
INSERT INTO "annotations" ("id","user_id","document_id","quote","note","kind","created_at","updated_at")
SELECT "id","user_id","document_id",'',"text",'note',"created_at","updated_at"
FROM "canvas_nodes" WHERE "kind"='text';--> statement-breakpoint

-- 图片节点 → note 批注（imageKey 为 doc-asset key，依赖批注取图谓词已覆盖 doc-asset 家族）。
INSERT INTO "annotations" ("id","user_id","document_id","quote","note","kind","image_key","created_at","updated_at")
SELECT "id","user_id","document_id",'','','note',"image_key","created_at","updated_at"
FROM "canvas_nodes" WHERE "kind"='image';--> statement-breakpoint

-- canvas 行改指批注（annotations 行与 canvas 行同 id；check 约束要求 text/image_key 置空）。
UPDATE "canvas_nodes"
SET "kind"='annotation',"annotation_id"="id","text"=NULL,"image_key"=NULL,"updated_at"=now()
WHERE "kind" IN ('text','image');