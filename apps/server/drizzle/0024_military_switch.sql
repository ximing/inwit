ALTER TABLE "documents" ADD COLUMN "kind" varchar(16) DEFAULT 'document' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "report_week_start" varchar(10);--> statement-breakpoint
CREATE INDEX "idx_documents_user_kind_week" ON "documents" USING btree ("user_id","kind","report_week_start");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_kind_check" CHECK ("documents"."kind" IN ('document', 'weekly_report'));--> statement-breakpoint
-- Durable identity from weekly mastery memory, including renamed reports.
UPDATE documents AS d
SET kind = 'weekly_report', report_week_start = substring(m.key from 15 for 10)
FROM memories AS m
WHERE m.user_id = d.user_id AND m.scope = 'user' AND m.layer = 'mastery'
  AND m.key ~ '^weekly_report:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  AND m.content->>'documentId' = d.id::text;
--> statement-breakpoint
-- Older regenerated reports may no longer be referenced by the week's memory.
-- Recover the period from the title; a delayed job's created_at is not its week.
WITH legacy AS (
  SELECT id, created_at::date AS created_date,
    split_part(split_part(title, '–', 1), '/', 1)::int AS month,
    split_part(split_part(title, '–', 1), '/', 2)::int AS day
  FROM documents
  WHERE kind = 'document' AND source = 'agent'
    AND title ~ '^[0-9]{1,2}/[0-9]{1,2}–[0-9]{1,2}/[0-9]{1,2} 学习复盘$'
), periods AS (
  SELECT legacy.id, candidate.week_start
  FROM legacy
  CROSS JOIN LATERAL (
    SELECT to_date(y::text || '-' || month::text || '-' || day::text, 'YYYY-MM-DD') AS week_start
    FROM generate_series(extract(year from created_date)::int - 1, extract(year from created_date)::int + 1) AS y
    ORDER BY abs(to_date(y::text || '-' || month::text || '-' || day::text, 'YYYY-MM-DD') - created_date)
    LIMIT 1
  ) AS candidate
)
UPDATE documents AS d
SET kind = 'weekly_report', report_week_start = to_char(periods.week_start, 'YYYY-MM-DD')
FROM periods WHERE d.id = periods.id;
