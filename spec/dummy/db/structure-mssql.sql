CREATE TABLE [accounts] ([id] bigint NOT NULL, [name] nvarchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [background_jobs] ([id] nvarchar(255) NOT NULL, [job_name] nvarchar(255) NOT NULL, [args_json] nvarchar(max) NOT NULL, [forked] bit NOT NULL, [max_retries] int NOT NULL, [attempts] int NOT NULL, [status] nvarchar(255) NOT NULL, [scheduled_at_ms] bigint NOT NULL, [created_at_ms] bigint NOT NULL, [handed_off_at_ms] bigint, [completed_at_ms] bigint, [failed_at_ms] bigint, [orphaned_at_ms] bigint, [worker_id] nvarchar(255), [last_error] nvarchar(max), PRIMARY KEY ([id]));

CREATE TABLE [schema_migrations] ([version] nvarchar(255) NOT NULL, PRIMARY KEY ([version]));

CREATE TABLE [velocious_attachments] ([id] nvarchar(255) NOT NULL, [record_type] nvarchar(255) NOT NULL, [record_id] nvarchar(255) NOT NULL, [name] nvarchar(255) NOT NULL, [position] int NOT NULL, [filename] nvarchar(255) NOT NULL, [content_type] nvarchar(255), [byte_size] bigint NOT NULL, [driver] nvarchar(255), [storage_key] nvarchar(255), [content_base64] nvarchar(max), [created_at_ms] bigint NOT NULL, [updated_at_ms] bigint NOT NULL, PRIMARY KEY ([id]));

CREATE TABLE [velocious_internal_migrations] ([key] nvarchar(255) NOT NULL, [scope] nvarchar(255) NOT NULL, [version] nvarchar(255) NOT NULL, [applied_at_ms] bigint NOT NULL, PRIMARY KEY ([key]));

CREATE TABLE [websocket_channel_events] ([sequence] int NOT NULL, [id] nvarchar(255) NOT NULL, [channel] nvarchar(255) NOT NULL, [payload_json] nvarchar(max) NOT NULL, [created_at] datetime NOT NULL, PRIMARY KEY ([sequence]));

CREATE TABLE [websocket_replay_channels] ([channel] nvarchar(255) NOT NULL, [interested_until] datetime NOT NULL, PRIMARY KEY ([channel]));
