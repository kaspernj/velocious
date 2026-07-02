CREATE TABLE [accounts] ([id] bigint NOT NULL, [name] nvarchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [schema_migrations] ([version] nvarchar(255) NOT NULL, PRIMARY KEY ([version]));

CREATE TABLE [velocious_attachments] ([id] nvarchar(255) NOT NULL, [record_type] nvarchar(255) NOT NULL, [record_id] nvarchar(255) NOT NULL, [name] nvarchar(255) NOT NULL, [position] int NOT NULL, [filename] nvarchar(255) NOT NULL, [content_type] nvarchar(255), [byte_size] bigint NOT NULL, [driver] nvarchar(255), [storage_key] nvarchar(255), [content_base64] nvarchar(max), [created_at_ms] bigint NOT NULL, [updated_at_ms] bigint NOT NULL, PRIMARY KEY ([id]));
