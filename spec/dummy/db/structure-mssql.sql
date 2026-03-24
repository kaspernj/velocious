CREATE TABLE [accounts] ([id] bigint NOT NULL, [name] varchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [schema_migrations] ([version] varchar(255) NOT NULL, PRIMARY KEY ([version]));
