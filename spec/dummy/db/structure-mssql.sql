CREATE TABLE [accounts] ([id] bigint NOT NULL, [name] varchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [authentication_tokens] ([id] bigint NOT NULL, [user_token] varchar(255) DEFAULT (newid()), [user_id] bigint, [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [comments] ([id] bigint NOT NULL, [task_id] bigint NOT NULL, [body] varchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [interactions] ([id] bigint NOT NULL, [subject_id] bigint NOT NULL, [subject_type] varchar(255), [kind] varchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [project_details] ([id] bigint NOT NULL, [project_id] bigint NOT NULL, [note] text, [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [project_translations] ([id] bigint NOT NULL, [project_id] bigint NOT NULL, [locale] varchar(255) NOT NULL, [name] varchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [projects] ([id] bigint NOT NULL, [creating_user_reference] varchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [schema_migrations] ([version] varchar(255) NOT NULL, PRIMARY KEY ([version]));

CREATE TABLE [string_subject_interactions] ([id] bigint NOT NULL, [subject_id] varchar(255) NOT NULL, [subject_type] varchar(255), [kind] varchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [string_subjects] ([id] varchar(255) NOT NULL, [name] varchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [tasks] ([id] bigint NOT NULL, [project_id] bigint NOT NULL, [name] varchar(255), [description] text, [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [users] ([id] bigint NOT NULL, [email] varchar(255) NOT NULL, [encrypted_password] varchar(255) NOT NULL, [reference] varchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [uuid_interactions] ([id] bigint NOT NULL, [subject_id] varchar(36) NOT NULL, [subject_type] varchar(255), [kind] varchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));

CREATE TABLE [uuid_items] ([id] varchar(36) DEFAULT (newid()) NOT NULL, [title] varchar(255), [created_at] datetime, [updated_at] datetime, PRIMARY KEY ([id]));
