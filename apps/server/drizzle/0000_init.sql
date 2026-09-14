CREATE TABLE "agent_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"user_id" uuid NOT NULL,
	"agent_type" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"result_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_executions_agent_type_check" CHECK ("agent_executions"."agent_type" IN ('digest', 'evolve', 'weekly_report', 'thread', 'chat')),
	CONSTRAINT "agent_executions_status_check" CHECK ("agent_executions"."status" IN ('pending', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" uuid,
	"type" varchar(16) NOT NULL,
	"raw_content" text NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "captures_type_check" CHECK ("captures"."type" IN ('text', 'ocr', 'voice', 'clip', 'chat')),
	CONSTRAINT "captures_status_check" CHECK ("captures"."status" IN ('pending', 'digested', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "card_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"type" varchar(16) NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_questions_type_check" CHECK ("card_questions"."type" IN ('cloze', 'compare', 'judge'))
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"capture_id" uuid,
	"thread_id" uuid,
	"concept" text NOT NULL,
	"example" text NOT NULL,
	"confusion_point" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" varchar(16) DEFAULT 'agent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cards_source_check" CHECK ("cards"."source" IN ('manual', 'agent', 'chat'))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_type_check" CHECK ("jobs"."type" IN ('digest', 'evolve', 'weekly_report', 'thread', 'chat')),
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" IN ('pending', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "llm_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"model" varchar(128) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"base_url" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_configs_provider_check" CHECK ("llm_configs"."provider" IN ('openai', 'deepseek', 'claude', 'zhipu', 'dashscope'))
);
--> statement-breakpoint
CREATE TABLE "llm_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"execution_id" uuid,
	"provider" varchar(120) NOT NULL,
	"model" varchar(128) NOT NULL,
	"capability" varchar(16) NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_estimate" numeric(14, 8) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_usage_logs_capability_check" CHECK ("llm_usage_logs"."capability" IN ('chat', 'embed', 'rerank'))
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" varchar(16) NOT NULL,
	"scope_id" uuid,
	"layer" varchar(16) NOT NULL,
	"key" varchar(200) NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memories_scope_check" CHECK ("memories"."scope" IN ('user', 'thread')),
	CONSTRAINT "memories_layer_check" CHECK ("memories"."layer" IN ('profile', 'mastery', 'association', 'thread_map')),
	CONSTRAINT "memories_scope_id_check" CHECK (("memories"."scope" = 'user' AND "memories"."scope_id" IS NULL) OR ("memories"."scope" = 'thread' AND "memories"."scope_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"feedback" varchar(16) NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_logs_feedback_check" CHECK ("review_logs"."feedback" IN ('forgot', 'fuzzy', 'remembered'))
);
--> statement-breakpoint
CREATE TABLE "review_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"ease" real DEFAULT 2.5 NOT NULL,
	"interval_days" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() + interval '1 day' NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"last_feedback" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_states_user_card_uidx" UNIQUE("user_id","card_id"),
	CONSTRAINT "review_states_last_feedback_check" CHECK ("review_states"."last_feedback" IS NULL OR "review_states"."last_feedback" IN ('forgot', 'fuzzy', 'remembered'))
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"goal" text,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "threads_status_check" CHECK ("threads"."status" IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_questions" ADD CONSTRAINT "card_questions_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_configs" ADD CONSTRAINT "llm_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage_logs" ADD CONSTRAINT "llm_usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage_logs" ADD CONSTRAINT "llm_usage_logs_execution_id_agent_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."agent_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_states" ADD CONSTRAINT "review_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_states" ADD CONSTRAINT "review_states_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_executions_job" ON "agent_executions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_agent_executions_user_started" ON "agent_executions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_agent_executions_type_status" ON "agent_executions" USING btree ("agent_type","status");--> statement-breakpoint
CREATE INDEX "idx_captures_user" ON "captures" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_captures_user_created" ON "captures" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_captures_user_status" ON "captures" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_captures_thread" ON "captures" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_card_questions_card" ON "card_questions" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "idx_cards_user" ON "cards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_cards_capture" ON "cards" USING btree ("capture_id");--> statement-breakpoint
CREATE INDEX "idx_cards_thread" ON "cards" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_cards_tags" ON "cards" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "idx_jobs_status_run_at" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "idx_jobs_user" ON "jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_user_type" ON "jobs" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "idx_llm_configs_user" ON "llm_configs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_configs_user_default_uidx" ON "llm_configs" USING btree ("user_id") WHERE "llm_configs"."is_default" = true;--> statement-breakpoint
CREATE INDEX "idx_llm_usage_logs_user_created" ON "llm_usage_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_llm_usage_logs_execution" ON "llm_usage_logs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "idx_llm_usage_logs_capability_created" ON "llm_usage_logs" USING btree ("capability","created_at");--> statement-breakpoint
CREATE INDEX "idx_memories_user_layer" ON "memories" USING btree ("user_id","layer");--> statement-breakpoint
CREATE INDEX "idx_memories_user_scope" ON "memories" USING btree ("user_id","scope","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memories_user_scope_layer_key_uidx" ON "memories" USING btree ("user_id","scope","layer","key") WHERE "memories"."scope_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "memories_user_scope_id_layer_key_uidx" ON "memories" USING btree ("user_id","scope","scope_id","layer","key") WHERE "memories"."scope_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_review_logs_user_reviewed" ON "review_logs" USING btree ("user_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "idx_review_logs_card" ON "review_logs" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "idx_review_states_user_due" ON "review_states" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "idx_threads_user" ON "threads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_threads_user_status" ON "threads" USING btree ("user_id","status");