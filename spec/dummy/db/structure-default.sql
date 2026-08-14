CREATE TABLE `acts_as_list_items` (`id` INTEGER PRIMARY KEY NOT NULL, `project_id` BIGINT NOT NULL, `position` INTEGER, `name` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `audit_actions` (`id` UUID PRIMARY KEY NOT NULL, `action` VARCHAR(255) NOT NULL, `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `audit_auditable_types` (`id` UUID PRIMARY KEY NOT NULL, `name` VARCHAR(255) NOT NULL, `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `audits` (`id` UUID PRIMARY KEY NOT NULL, `audit_action_id` UUID NOT NULL REFERENCES `audit_actions`(`id`), `audit_auditable_type_id` UUID NOT NULL REFERENCES `audit_auditable_types`(`id`), `auditable_id` UUID NOT NULL, `auditable_type` VARCHAR(255), `audited_changes` JSON, `params` JSON, `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE "authentication_tokens" (`id` INTEGER PRIMARY KEY NOT NULL, `user_token` VARCHAR(255) DEFAULT '''UUID()''', `user_id` BIGINT, `created_at` DATETIME, `updated_at` DATETIME, CONSTRAINT `authentication_tokens_user_id_0` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`));

CREATE TABLE `background_job_concurrency` (`concurrency_key` VARCHAR(255) PRIMARY KEY, `max_concurrency` INTEGER NOT NULL, `active_count` INTEGER NOT NULL);

CREATE TABLE `background_job_count_revisions` (`key` VARCHAR(255) PRIMARY KEY, `revision` BIGINT NOT NULL);

CREATE TABLE `background_job_idempotency_keys` (`scope_digest` VARCHAR(255) PRIMARY KEY, `job_name` VARCHAR(255) NOT NULL, `queue` VARCHAR(255) NOT NULL, `idempotency_key` TEXT NOT NULL, `job_id` VARCHAR(255) NOT NULL, `request_digest` VARCHAR(255) NOT NULL, `created_at_ms` BIGINT NOT NULL);

CREATE TABLE `background_job_schedule_keys` (`schedule_key` VARCHAR(255) PRIMARY KEY, `job_id` VARCHAR(255) NOT NULL);

CREATE TABLE "background_jobs" (`id` VARCHAR(255) PRIMARY KEY, `job_name` VARCHAR(255) NOT NULL, `args_json` TEXT NOT NULL, `execution_mode` VARCHAR(255) NOT NULL, `queue` VARCHAR(255), `max_retries` INTEGER NOT NULL, `attempts` INTEGER NOT NULL, `status` VARCHAR(255) NOT NULL, `scheduled_at_ms` BIGINT NOT NULL, `created_at_ms` BIGINT NOT NULL, `handed_off_at_ms` BIGINT, `handoff_id` VARCHAR(255), `completed_at_ms` BIGINT, `failed_at_ms` BIGINT, `orphaned_at_ms` BIGINT, `worker_id` VARCHAR(255), `last_error` TEXT, `concurrency_key` VARCHAR(255), `max_concurrency` INTEGER, `schedule_key` VARCHAR(255));

CREATE TABLE `comments` (`id` INTEGER PRIMARY KEY NOT NULL, `task_id` BIGINT NOT NULL REFERENCES `tasks`(`id`), `body` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `interactions` (`id` INTEGER PRIMARY KEY NOT NULL, `subject_id` BIGINT NOT NULL, `subject_type` VARCHAR(255), `kind` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `mailer_delivery_operations` (`operation_key` VARCHAR(255) PRIMARY KEY, `operation_id` TEXT NOT NULL, `payload_digest` VARCHAR(255) NOT NULL, `background_job_id` VARCHAR(255) NOT NULL, `first_attempt_started_at_ms` BIGINT, `provider_kind` VARCHAR(255) NOT NULL, `provider_retention_ms` BIGINT NOT NULL, `created_at_ms` BIGINT NOT NULL);

CREATE TABLE "project_details" (`id` INTEGER PRIMARY KEY NOT NULL, `project_id` BIGINT NOT NULL, `note` TEXT, `created_at` DATETIME, `updated_at` DATETIME, `is_active` BOOLEAN, CONSTRAINT `project_details_project_id_0` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`));

CREATE TABLE `project_translations` (`id` INTEGER PRIMARY KEY NOT NULL, `project_id` BIGINT NOT NULL REFERENCES `projects`(`id`), `locale` VARCHAR(255) NOT NULL, `name` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE "projects" (`id` INTEGER PRIMARY KEY NOT NULL, `creating_user_reference` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME, `tasks_count` INTEGER DEFAULT 0 NOT NULL);

CREATE TABLE `schema_migrations` (`version` VARCHAR(255) PRIMARY KEY NOT NULL);

CREATE TABLE `string_subject_interactions` (`id` INTEGER PRIMARY KEY NOT NULL, `subject_id` VARCHAR(255) NOT NULL, `subject_type` VARCHAR(255), `kind` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `string_subjects` (`id` VARCHAR(255) PRIMARY KEY NOT NULL, `name` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE "sync_entries" (`id` UUID PRIMARY KEY NOT NULL, `authentication_token_id` VARCHAR(255), `resource_id` VARCHAR(255) NOT NULL, `resource_type` VARCHAR(255) NOT NULL, `sync_type` VARCHAR(255) NOT NULL, `client_updated_at` DATETIME, `data` TEXT, `server_sequence` INTEGER, `created_at` DATETIME, `updated_at` DATETIME, `project_id` VARCHAR(255));

CREATE TABLE `task_board_cards` (`id` INTEGER PRIMARY KEY NOT NULL, `task_board_id` BIGINT NOT NULL REFERENCES `task_boards`(`id`), `task_id` BIGINT NOT NULL REFERENCES `tasks`(`id`), `board_column_id` VARCHAR(255) NOT NULL, `position` INTEGER NOT NULL, `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `task_boards` (`id` INTEGER PRIMARY KEY NOT NULL, `project_id` BIGINT NOT NULL REFERENCES `projects`(`id`), `name` VARCHAR(255) NOT NULL, `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE "tasks" (`id` INTEGER PRIMARY KEY NOT NULL, `project_id` BIGINT NOT NULL, `name` VARCHAR(255), `description` TEXT, `created_at` DATETIME, `updated_at` DATETIME, `is_done` BOOLEAN, CONSTRAINT `tasks_project_id_0` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`));

CREATE TABLE `tenant_generator_records` (`id` UUID PRIMARY KEY NOT NULL, `control_name` VARCHAR(255) NOT NULL);

CREATE TABLE `users` (`id` INTEGER PRIMARY KEY NOT NULL, `email` VARCHAR(255) NOT NULL, `encrypted_password` VARCHAR(255) NOT NULL, `reference` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `uuid_acts_as_list_items` (`id` UUID PRIMARY KEY NOT NULL, `scope_id` INTEGER NOT NULL, `position` INTEGER, `name` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `uuid_interactions` (`id` INTEGER PRIMARY KEY NOT NULL, `subject_id` UUID NOT NULL, `subject_type` VARCHAR(255), `kind` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `uuid_items` (`id` UUID PRIMARY KEY NOT NULL, `title` VARCHAR(255), `created_at` DATETIME, `updated_at` DATETIME);

CREATE TABLE `velocious_attachments` (`id` VARCHAR(255) PRIMARY KEY NOT NULL, `record_type` VARCHAR(255) NOT NULL, `record_id` VARCHAR(255) NOT NULL, `name` VARCHAR(255) NOT NULL, `position` INTEGER NOT NULL, `filename` VARCHAR(255) NOT NULL, `content_type` VARCHAR(255), `byte_size` BIGINT NOT NULL, `driver` VARCHAR(255), `storage_key` VARCHAR(255), `content_base64` TEXT, `created_at_ms` BIGINT NOT NULL, `updated_at_ms` BIGINT NOT NULL);

CREATE TABLE `velocious_internal_migrations` (`key` VARCHAR(255) PRIMARY KEY NOT NULL, `scope` VARCHAR(255) NOT NULL, `version` VARCHAR(255) NOT NULL, `applied_at_ms` BIGINT NOT NULL);

CREATE TABLE `velocious_server_sequences` (`id` INTEGER PRIMARY KEY NOT NULL, `created_at` DATETIME NOT NULL);

CREATE TABLE `velocious_sync_scopes` (`id` VARCHAR(255) PRIMARY KEY NOT NULL, `scope_digest` VARCHAR(255) NOT NULL, `resource_type` VARCHAR(255) NOT NULL, `conditions_json` TEXT NOT NULL, `cursor_json` TEXT, `state` VARCHAR(255) NOT NULL, `created_at` DATETIME NOT NULL, `updated_at` DATETIME NOT NULL);

CREATE INDEX `index_on_acts_as_list_items_project_id` ON `acts_as_list_items` (`project_id`);

CREATE UNIQUE INDEX `index_on_acts_as_list_items_project_id_and_position` ON `acts_as_list_items` (`project_id`, `position`);

CREATE UNIQUE INDEX `index_on_audit_actions_action` ON `audit_actions` (`action`);

CREATE UNIQUE INDEX `index_on_audit_auditable_types_name` ON `audit_auditable_types` (`name`);

CREATE INDEX `index_on_audits_audit_action_id` ON `audits` (`audit_action_id`);

CREATE INDEX `index_on_audits_audit_auditable_type_id` ON `audits` (`audit_auditable_type_id`);

CREATE INDEX `index_on_audits_auditable_id` ON `audits` (`auditable_id`);

CREATE UNIQUE INDEX `index_on_authentication_tokens_token` ON `authentication_tokens` (`user_token`);

CREATE INDEX `index_on_authentication_tokens_user_id` ON `authentication_tokens` (`user_id`);

CREATE INDEX `index_on_background_job_idempotency_keys_job_id` ON `background_job_idempotency_keys` (`job_id`);

CREATE INDEX `index_on_background_job_schedule_keys_job_id` ON `background_job_schedule_keys` (`job_id`);

CREATE INDEX `index_on_background_jobs_concurrency_key` ON `background_jobs` (`concurrency_key`);

CREATE INDEX `index_on_background_jobs_created_at_ms` ON `background_jobs` (`created_at_ms`);

CREATE INDEX `index_on_background_jobs_handed_off_at_ms` ON `background_jobs` (`handed_off_at_ms`);

CREATE INDEX `index_on_background_jobs_job_name` ON `background_jobs` (`job_name`);

CREATE INDEX `index_on_background_jobs_orphaned_at_ms` ON `background_jobs` (`orphaned_at_ms`);

CREATE INDEX `index_on_background_jobs_queue` ON `background_jobs` (`queue`);

CREATE INDEX `index_on_background_jobs_schedule_key` ON "background_jobs" (`schedule_key`);

CREATE INDEX `index_on_background_jobs_scheduled_at_ms` ON `background_jobs` (`scheduled_at_ms`);

CREATE INDEX `index_on_background_jobs_status` ON `background_jobs` (`status`);

CREATE INDEX `index_on_comments_task_id` ON `comments` (`task_id`);

CREATE INDEX `index_on_interactions_subject_id` ON `interactions` (`subject_id`);

CREATE INDEX `index_on_mailer_delivery_operations_background_job_id` ON `mailer_delivery_operations` (`background_job_id`);

CREATE INDEX `index_on_project_details_project_id` ON `project_details` (`project_id`);

CREATE INDEX `index_on_project_translations_project_id` ON `project_translations` (`project_id`);

CREATE INDEX `index_on_string_subject_interactions_subject_id` ON `string_subject_interactions` (`subject_id`);

CREATE INDEX `index_on_sync_entries_authentication_token_id` ON `sync_entries` (`authentication_token_id`);

CREATE INDEX `index_on_sync_entries_project_id` ON `sync_entries` (`project_id`);

CREATE INDEX `index_on_sync_entries_resource_id` ON `sync_entries` (`resource_id`);

CREATE INDEX `index_on_sync_entries_resource_type` ON `sync_entries` (`resource_type`);

CREATE INDEX `index_on_sync_entries_server_sequence` ON `sync_entries` (`server_sequence`);

CREATE INDEX `index_on_task_board_cards_task_board_id` ON `task_board_cards` (`task_board_id`);

CREATE UNIQUE INDEX `index_on_task_board_cards_task_board_id_and_board_column_id_and_position` ON `task_board_cards` (`task_board_id`, `board_column_id`, `position`);

CREATE UNIQUE INDEX `index_on_task_board_cards_task_id` ON `task_board_cards` (`task_id`);

CREATE INDEX `index_on_task_boards_project_id` ON `task_boards` (`project_id`);

CREATE INDEX `index_on_tasks_project_id` ON `tasks` (`project_id`);

CREATE UNIQUE INDEX `index_on_users_email` ON `users` (`email`);

CREATE UNIQUE INDEX `index_on_uuid_acts_as_list_items_scope_id_and_position` ON `uuid_acts_as_list_items` (`scope_id`, `position`);

CREATE INDEX `index_on_uuid_interactions_subject_id` ON `uuid_interactions` (`subject_id`);

CREATE INDEX `index_on_velocious_attachments_name` ON `velocious_attachments` (`name`);

CREATE INDEX `index_on_velocious_attachments_record_id` ON `velocious_attachments` (`record_id`);

CREATE INDEX `index_on_velocious_attachments_record_type` ON `velocious_attachments` (`record_type`);

CREATE INDEX `index_on_velocious_sync_scopes_resource_type` ON `velocious_sync_scopes` (`resource_type`);

CREATE INDEX `index_on_velocious_sync_scopes_scope_digest` ON `velocious_sync_scopes` (`scope_digest`);

CREATE INDEX `index_on_velocious_sync_scopes_state` ON `velocious_sync_scopes` (`state`);
INSERT INTO schema_migrations (version) VALUES ('20230728075328');
INSERT INTO schema_migrations (version) VALUES ('20230728075329');
INSERT INTO schema_migrations (version) VALUES ('20250605133926');
INSERT INTO schema_migrations (version) VALUES ('20250912183605');
INSERT INTO schema_migrations (version) VALUES ('20250912183606');
INSERT INTO schema_migrations (version) VALUES ('20250915085450');
INSERT INTO schema_migrations (version) VALUES ('20250916111330');
INSERT INTO schema_migrations (version) VALUES ('20250921121002');
INSERT INTO schema_migrations (version) VALUES ('20251223194400');
INSERT INTO schema_migrations (version) VALUES ('20251223210800');
INSERT INTO schema_migrations (version) VALUES ('20251223214200');
INSERT INTO schema_migrations (version) VALUES ('20251225230806');
INSERT INTO schema_migrations (version) VALUES ('20251228090000');
INSERT INTO schema_migrations (version) VALUES ('20251228090010');
INSERT INTO schema_migrations (version) VALUES ('20260418090000');
INSERT INTO schema_migrations (version) VALUES ('20260601052206');
INSERT INTO schema_migrations (version) VALUES ('20260629160000');
INSERT INTO schema_migrations (version) VALUES ('20260702150000');
INSERT INTO schema_migrations (version) VALUES ('20260706120000');
INSERT INTO schema_migrations (version) VALUES ('20260726132000');
INSERT INTO schema_migrations (version) VALUES ('20260803120000');
INSERT INTO schema_migrations (version) VALUES ('20260808090000');
