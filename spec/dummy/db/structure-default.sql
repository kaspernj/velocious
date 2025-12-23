CREATE TABLE [authentication_tokens] ([id] bigint NOT NULL, [user_token] varchar(255) DEFAULT (newid()), [user_id] bigint, [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [project_details] ([id] bigint NOT NULL, [project_id] bigint NOT NULL, [note] text, [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [project_translations] ([id] bigint NOT NULL, [project_id] bigint NOT NULL, [locale] varchar(255) NOT NULL, [name] varchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [projects] ([id] bigint NOT NULL, [creating_user_reference] varchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [schema_migrations] ([version] varchar(255) NOT NULL, PRIMARY KEY ([version]));

CREATE TABLE [tasks] ([id] bigint NOT NULL, [project_id] bigint NOT NULL, [name] varchar(255), [description] text, [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [users] ([id] bigint NOT NULL, [email] varchar(255) NOT NULL, [encrypted_password] varchar(255) NOT NULL, [reference] varchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));
