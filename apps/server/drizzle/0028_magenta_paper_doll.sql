DROP INDEX "idx_jobs_user";--> statement-breakpoint
CREATE INDEX "idx_agent_executions_status_started" ON "agent_executions" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "idx_jobs_user_created" ON "jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_jobs_status_created" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_llm_usage_logs_created" ON "llm_usage_logs" USING btree ("created_at");