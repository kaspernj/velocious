CREATE TABLE [accounts] ([id] bigint NOT NULL, [name] nvarchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [authentication_tokens] ([id] bigint NOT NULL, [user_token] nvarchar(255) DEFAULT (newid()), [user_id] bigint, [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [background_jobs] ([id] nvarchar(255) NOT NULL, [job_name] nvarchar(255) NOT NULL, [args_json] nvarchar(max) NOT NULL, [forked] bit NOT NULL, [max_retries] int NOT NULL, [attempts] int NOT NULL, [status] nvarchar(255) NOT NULL, [scheduled_at_ms] bigint NOT NULL, [created_at_ms] bigint NOT NULL, [handed_off_at_ms] bigint, [completed_at_ms] bigint, [failed_at_ms] bigint, [orphaned_at_ms] bigint, [worker_id] nvarchar(255), [last_error] nvarchar(max), PRIMARY KEY ([id]));

CREATE TABLE [comments] ([id] bigint NOT NULL, [task_id] bigint NOT NULL, [body] nvarchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [interactions] ([id] bigint NOT NULL, [subject_id] bigint NOT NULL, [subject_type] nvarchar(255), [kind] nvarchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [project_details] ([id] bigint NOT NULL, [project_id] bigint NOT NULL, [note] nvarchar(max), [created_at] datetime, [updated_at] datetime, [is_active] bit, PRIMARY KEY ([id]));

CREATE TABLE [project_translations] ([id] bigint NOT NULL, [project_id] bigint NOT NULL, [locale] nvarchar(255) NOT NULL, [name] nvarchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [projects] ([id] bigint NOT NULL, [creating_user_reference] nvarchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [schema_migrations] ([version] nvarchar(255) NOT NULL, PRIMARY KEY ([version]));

CREATE TABLE [string_subject_interactions] ([id] bigint NOT NULL, [subject_id] nvarchar(255) NOT NULL, [subject_type] nvarchar(255), [kind] nvarchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [string_subjects] ([id] nvarchar(255) NOT NULL, [name] nvarchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [tasks] ([id] bigint NOT NULL, [project_id] bigint NOT NULL, [name] nvarchar(255), [description] nvarchar(max), [created_at] datetime, [updated_at] datetime, [is_done] bit, PRIMARY KEY ([id]));

CREATE TABLE [users] ([id] bigint NOT NULL, [email] nvarchar(255) NOT NULL, [encrypted_password] nvarchar(255) NOT NULL, [reference] nvarchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [uuid_interactions] ([id] bigint NOT NULL, [subject_id] varchar(36) NOT NULL, [subject_type] nvarchar(255), [kind] nvarchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [uuid_items] ([id] varchar(36) DEFAULT (newid()) NOT NULL, [title] nvarchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [velocious_attachments] ([id] nvarchar(255) NOT NULL, [record_type] nvarchar(255) NOT NULL, [record_id] nvarchar(255) NOT NULL, [name] nvarchar(255) NOT NULL, [position] int NOT NULL, [filename] nvarchar(255) NOT NULL, [content_type] nvarchar(255), [byte_size] bigint NOT NULL, [driver] nvarchar(255), [storage_key] nvarchar(255), [content_base64] nvarchar(max), [created_at_ms] bigint NOT NULL, [updated_at_ms] bigint NOT NULL, PRIMARY KEY ([id]));

CREATE TABLE [velocious_internal_migrations] ([key] nvarchar(255) NOT NULL, [scope] nvarchar(255) NOT NULL, [version] nvarchar(255) NOT NULL, [applied_at_ms] bigint NOT NULL, PRIMARY KEY ([key]));

CREATE TABLE [websocket_channel_events] ([sequence] int NOT NULL, [id] nvarchar(255) NOT NULL, [channel] nvarchar(255) NOT NULL, [payload_json] nvarchar(max) NOT NULL, [created_at] datetime NOT NULL, PRIMARY KEY ([sequence]));

CREATE TABLE [websocket_replay_channels] ([channel] nvarchar(255) NOT NULL, [interested_until] datetime NOT NULL, PRIMARY KEY ([channel]));
