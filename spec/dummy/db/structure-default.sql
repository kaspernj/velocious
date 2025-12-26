CREATE TABLE "authentication_tokens" ("id" integer DEFAULT nextval('authentication_tokens_id_seq'::regclass) NOT NULL, "user_token" varchar(255) DEFAULT gen_random_uuid(), "user_id" bigint NOT NULL, "created_at" timestamp without time zone, "updated_at" timestamp without time zone, PRIMARY KEY ("id"));

CREATE TABLE "comments" ("id" integer DEFAULT nextval('comments_id_seq'::regclass) NOT NULL, "task_id" bigint NOT NULL, "body" varchar(255), "created_at" timestamp without time zone, "updated_at" timestamp without time zone, PRIMARY KEY ("id"));

CREATE TABLE "interactions" ("id" integer DEFAULT nextval('interactions_id_seq'::regclass) NOT NULL, "subject_id" bigint NOT NULL, "subject_type" varchar(255), "kind" varchar(255), "created_at" timestamp without time zone, "updated_at" timestamp without time zone, PRIMARY KEY ("id"));

CREATE TABLE "project_details" ("id" integer DEFAULT nextval('project_details_id_seq'::regclass) NOT NULL, "project_id" bigint NOT NULL, "note" text, "created_at" timestamp without time zone, "updated_at" timestamp without time zone, PRIMARY KEY ("id"));

CREATE TABLE "project_translations" ("id" integer DEFAULT nextval('project_translations_id_seq'::regclass) NOT NULL, "project_id" bigint NOT NULL, "locale" varchar(255) NOT NULL, "name" varchar(255), "created_at" timestamp without time zone, "updated_at" timestamp without time zone, PRIMARY KEY ("id"));

CREATE TABLE "projects" ("id" integer DEFAULT nextval('projects_id_seq'::regclass) NOT NULL, "creating_user_reference" varchar(255), "created_at" timestamp without time zone, "updated_at" timestamp without time zone, PRIMARY KEY ("id"));

CREATE TABLE "schema_migrations" ("version" varchar(255) NOT NULL, PRIMARY KEY ("version"));

CREATE TABLE "string_subject_interactions" ("id" integer DEFAULT nextval('string_subject_interactions_id_seq'::regclass) NOT NULL, "subject_id" varchar(255) NOT NULL, "subject_type" varchar(255), "kind" varchar(255), "created_at" timestamp without time zone, "updated_at" timestamp without time zone, PRIMARY KEY ("id"));

CREATE TABLE "string_subjects" ("id" varchar(255) NOT NULL, "name" varchar(255), "created_at" timestamp without time zone, "updated_at" timestamp without time zone, PRIMARY KEY ("id"));

CREATE TABLE "tasks" ("id" integer DEFAULT nextval('tasks_id_seq'::regclass) NOT NULL, "project_id" bigint NOT NULL, "name" varchar(255), "description" text, "created_at" timestamp without time zone, "updated_at" timestamp without time zone, PRIMARY KEY ("id"));

CREATE TABLE "users" ("id" integer DEFAULT nextval('users_id_seq'::regclass) NOT NULL, "email" varchar(255) NOT NULL, "encrypted_password" varchar(255) NOT NULL, "reference" varchar(255), "created_at" timestamp without time zone, "updated_at" timestamp without time zone, PRIMARY KEY ("id"));

CREATE TABLE "uuid_interactions" ("id" integer DEFAULT nextval('uuid_interactions_id_seq'::regclass) NOT NULL, "subject_id" uuid NOT NULL, "subject_type" varchar(255), "kind" varchar(255), "created_at" timestamp without time zone, "updated_at" timestamp without time zone, PRIMARY KEY ("id"));

CREATE TABLE "uuid_items" ("id" uuid DEFAULT gen_random_uuid() NOT NULL, "title" varchar(255), "created_at" timestamp without time zone, "updated_at" timestamp without time zone, PRIMARY KEY ("id"));
