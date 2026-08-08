CREATE TABLE `schema_migrations` (`version` VARCHAR(255) PRIMARY KEY NOT NULL);

CREATE TABLE `tenant_generator_records` (`id` UUID PRIMARY KEY NOT NULL, `routing_epoch` INTEGER NOT NULL, `tenant_name` VARCHAR(255) NOT NULL);

CREATE TABLE `tenant_only_generator_records` (`id` UUID PRIMARY KEY NOT NULL, `tenant_name` VARCHAR(255) NOT NULL);
INSERT INTO schema_migrations (version) VALUES ('20260808090100');
