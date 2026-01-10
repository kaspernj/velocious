CREATE UNIQUE INDEX `index_on_authentication_tokens_token` ON `authentication_tokens` (`user_token`);

CREATE INDEX `index_on_authentication_tokens_user_id` ON `authentication_tokens` (`user_id`);

CREATE INDEX `index_on_background_jobs_created_at_ms` ON `background_jobs` (`created_at_ms`);

CREATE INDEX `index_on_background_jobs_handed_off_at_ms` ON `background_jobs` (`handed_off_at_ms`);

CREATE INDEX `index_on_background_jobs_job_name` ON `background_jobs` (`job_name`);

CREATE INDEX `index_on_background_jobs_orphaned_at_ms` ON `background_jobs` (`orphaned_at_ms`);

CREATE INDEX `index_on_background_jobs_scheduled_at_ms` ON `background_jobs` (`scheduled_at_ms`);

CREATE INDEX `index_on_background_jobs_status` ON `background_jobs` (`status`);

CREATE INDEX `index_on_comments_task_id` ON `comments` (`task_id`);

CREATE INDEX `index_on_interactions_subject_id` ON `interactions` (`subject_id`);

CREATE INDEX `index_on_project_details_project_id` ON `project_details` (`project_id`);

CREATE INDEX `index_on_project_translations_project_id` ON `project_translations` (`project_id`);

CREATE INDEX `index_on_string_subject_interactions_subject_id` ON `string_subject_interactions` (`subject_id`);

CREATE INDEX `index_on_tasks_project_id` ON `tasks` (`project_id`);

CREATE UNIQUE INDEX `index_on_users_email` ON `users` (`email`);

CREATE INDEX `index_on_uuid_interactions_subject_id` ON `uuid_interactions` (`subject_id`);

CREATE TABLE "authentication_tokens" (`id` INTEGER PRIMARY KEY NOT NULL, `user_token` VARCHAR(255) DEFAULT '''UUID()''', `user_id` BIGINT REFERENCES `users`(`id`), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `background_jobs` (`id` VARCHAR(255) PRIMARY KEY, `job_name` VARCHAR(255) NOT NULL, `args_json` TEXT NOT NULL, `forked` BOOLEAN NOT NULL, `max_retries` INTEGER NOT NULL, `attempts` INTEGER NOT NULL, `status` VARCHAR(255) NOT NULL, `scheduled_at_ms` BIGINT NOT NULL, `created_at_ms` BIGINT NOT NULL, `handed_off_at_ms` BIGINT, `completed_at_ms` BIGINT, `failed_at_ms` BIGINT, `orphaned_at_ms` BIGINT, `worker_id` VARCHAR(255), `last_error` TEXT);

CREATE TABLE `comments` (`id` INTEGER PRIMARY KEY NOT NULL, `task_id` BIGINT NOT NULL REFERENCES `tasks`(`id`), `body` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `interactions` (`id` INTEGER PRIMARY KEY NOT NULL, `subject_id` BIGINT NOT NULL, `subject_type` VARCHAR(255), `kind` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE "project_details" (`id` INTEGER PRIMARY KEY NOT NULL, `project_id` BIGINT NOT NULL REFERENCES `projects`(`id`), `note` TEXT, `created_at` DATETIME, `updated_at` DATETIME, `is_active` BOOLEAN);

CREATE TABLE `project_translations` (`id` INTEGER PRIMARY KEY NOT NULL, `project_id` BIGINT NOT NULL REFERENCES `projects`(`id`), `locale` VARCHAR(255) NOT NULL, `name` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `projects` (`id` INTEGER PRIMARY KEY NOT NULL, `creating_user_reference` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `schema_migrations` (`version` VARCHAR(255) PRIMARY KEY NOT NULL);

CREATE TABLE `string_subject_interactions` (`id` INTEGER PRIMARY KEY NOT NULL, `subject_id` VARCHAR(255) NOT NULL, `subject_type` VARCHAR(255), `kind` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `string_subjects` (`id` VARCHAR(255) PRIMARY KEY NOT NULL, `name` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE "tasks" (`id` INTEGER PRIMARY KEY NOT NULL, `project_id` BIGINT NOT NULL REFERENCES `projects`(`id`), `name` VARCHAR(255), `description` TEXT, `created_at` DATETIME, `updated_at` DATETIME, `is_done` BOOLEAN);

CREATE TABLE `users` (`id` INTEGER PRIMARY KEY NOT NULL, `email` VARCHAR(255) NOT NULL, `encrypted_password` VARCHAR(255) NOT NULL, `reference` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `uuid_interactions` (`id` INTEGER PRIMARY KEY NOT NULL, `subject_id` UUID NOT NULL, `subject_type` VARCHAR(255), `kind` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `uuid_items` (`id` UUID PRIMARY KEY NOT NULL, `title` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `velocious_internal_migrations` (`key` VARCHAR(255) PRIMARY KEY NOT NULL, `scope` VARCHAR(255) NOT NULL, `version` VARCHAR(255) NOT NULL, `applied_at_ms` BIGINT NOT NULL);
