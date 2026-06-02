CREATE TABLE [accounts] ([id] bigint NOT NULL, [name] nvarchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [schema_migrations] ([version] nvarchar(255) NOT NULL, PRIMARY KEY ([version]));
