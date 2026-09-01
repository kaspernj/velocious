import Logger from "../logger.js";
export default class VelociousDatabaseMigrator {
    configuration: import("../configuration.js").default;
    databaseIdentifiers: string[] | undefined;
    logger: Logger;
    /**
     * Migrations versions.
     * @type {Record<string, Record<string, boolean>>} */
    migrationsVersions: Record<string, Record<string, boolean>>;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {string[]} [args.databaseIdentifiers] - Optional database identifiers to migrate.
     */
    constructor({ configuration, databaseIdentifiers, ...restArgs }: {
        configuration: import("../configuration.js").default;
        databaseIdentifiers?: string[];
    });
    /**
     * Runs handles database identifier.
     * @param {string} dbIdentifier - Database identifier.
     * @returns {boolean} - Whether this migrator should touch the database identifier.
     */
    handlesDatabaseIdentifier(dbIdentifier: string): boolean;
    /**
     * Runs prepare.
     * @returns {Promise<void>} - Resolves when complete.
     */
    prepare(): Promise<void>;
    /**
     * Runs create migrations table.
     * @returns {Promise<void>} - Resolves when complete.
     */
    createMigrationsTable(): Promise<void>;
    /**
     * Runs create migrations table for database.
     * @param {object} args - Options object.
     * @param {string} args.dbIdentifier - Database identifier.
     * @param {import("./drivers/base.js").default} args.db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    createMigrationsTableForDatabase({ dbIdentifier, db }: {
        dbIdentifier: string;
        db: import("./drivers/base.js").default;
    }): Promise<void>;
    /**
     * Runs has run migration version.
     * @param {string} dbIdentifier - Db identifier.
     * @param {number} version - Version.
     * @returns {boolean} - Whether it has run migration version.
     */
    hasRunMigrationVersion(dbIdentifier: string, version: number): boolean;
    /**
     * Runs migrate files.
     * @param {import("./migrator/types.js").MigrationObjectType[]} files - Files.
     * @param {import("./migrator/types.js").ImportFullpathCallbackType} importCallback - Import callback.
     * @returns {Promise<number>} - Number of migrations actually applied (not skipped as already-run).
     */
    migrateFiles(files: import("./migrator/types.js").MigrationObjectType[], importCallback: import("./migrator/types.js").ImportFullpathCallbackType): Promise<number>;
    /**
     * Runs migrate files from require context.
     * @param {import("./migrator/types.js").RequireMigrationContextType} requireContext - Require context.
     * @returns {Promise<void>} - Resolves when complete.
     */
    migrateFilesFromRequireContext(requireContext: import("./migrator/types.js").RequireMigrationContextType): Promise<void>;
    /**
     * Migrates exactly one already-captured physical database. This is the
     * frontend/tenant counterpart to the ambient multi-database entrypoints:
     * callers own the captured connection and no configuration fallback is read.
     * @param {object} args - Captured migration arguments.
     * @param {import("../configuration-types.js").DatabaseConfigurationType} args.databaseConfiguration - Captured physical database configuration.
     * @param {string} args.databaseIdentifier - Logical database identifier.
     * @param {import("./drivers/base.js").default} args.db - Captured physical connection.
     * @param {import("./migrator/types.js").RequireMigrationContextType} args.requireContext - Frontend migration require context.
     * @returns {Promise<number>} - Number of newly applied migrations.
     */
    migrateRequireContextForDatabase({ databaseConfiguration, databaseIdentifier, db, requireContext }: {
        databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType;
        databaseIdentifier: string;
        db: import("./drivers/base.js").default;
        requireContext: import("./migrator/types.js").RequireMigrationContextType;
    }): Promise<number>;
    /**
     * Parses and orders migrations from a browser/native require context.
     * @param {import("./migrator/types.js").RequireMigrationContextType} requireContext - Migration require context.
     * @returns {import("./migrator/types.js").MigrationObjectType[]} - Ordered migrations.
     */
    migrationsFromRequireContext(requireContext: import("./migrator/types.js").RequireMigrationContextType): import("./migrator/types.js").MigrationObjectType[];
    /**
     * Runs one migration's upward implementation.
     * @param {object} args - Migration arguments.
     * @param {import("./migrator/types.js").MigrationObjectType} args.migration - Migration descriptor.
     * @param {import("./migration/index.js").default} args.migrationInstance - Migration instance.
     * @returns {Promise<void>} - Resolves after the migration succeeds.
     */
    runMigrationUp({ migration, migrationInstance }: {
        migration: import("./migrator/types.js").MigrationObjectType;
        migrationInstance: import("./migration/index.js").default;
    }): Promise<void>;
    /**
     * Runs after migrations.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _afterMigrations(): Promise<void>;
    /**
     * Runs load migrations versions.
     * @returns {Promise<void>} - Resolves when complete.
     */
    loadMigrationsVersions(): Promise<void>;
    /**
     * Runs load migrations versions for database.
     * @param {object} args - Options object.
     * @param {string} args.dbIdentifier - Database identifier.
     * @param {import("./drivers/base.js").default} args.db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    loadMigrationsVersionsForDatabase({ dbIdentifier, db }: {
        dbIdentifier: string;
        db: import("./drivers/base.js").default;
    }): Promise<void>;
    /**
     * Runs migrations table exist.
     * @param {import("./drivers/base.js").default} db - Database connection.
     * @returns {Promise<boolean>} - Resolves with Whether migrations table exist.
     */
    migrationsTableExist(db: import("./drivers/base.js").default): Promise<boolean>;
    /**
     * Runs execute require context.
     * @param {import("./migrator/types.js").RequireMigrationContextType} requireContext - Require context.
     * @returns {Promise<void>} - Resolves when complete.
     */
    executeRequireContext(requireContext: import("./migrator/types.js").RequireMigrationContextType): Promise<void>;
    /**
     * Runs reset.
     * @returns {Promise<void>} - Resolves when complete.
     */
    reset(): Promise<void>;
    /**
     * Runs rollback.
     * @param {import("./migrator/types.js").MigrationObjectType[]} files - Files.
     * @param {import("./migrator/types.js").ImportFullpathCallbackType} importCallback Function to import a file
     * @returns {Promise<void>} - Resolves when complete.
     */
    rollback(files: import("./migrator/types.js").MigrationObjectType[], importCallback: import("./migrator/types.js").ImportFullpathCallbackType): Promise<void>;
    /**
     * Runs latest migration version.
     * @returns {Promise<string | undefined>} The latest migration version
     */
    _latestMigrationVersion(): Promise<string | undefined>;
    /**
     * Runs run migration file.
     * @param {object} args - Options object.
     * @param {import("./migrator/types.js").MigrationObjectType} args.migration - Migration.
     * @param {import("./migrator/types.js").RequireMigrationType} args.requireMigration - Require migration.
     * @param {string} [args.direction] - Direction.
     * @returns {Promise<boolean>} - Whether the migration ran on at least one database (false if skipped as already-run everywhere).
     */
    runMigrationFile({ migration, requireMigration, direction }: {
        migration: import("./migrator/types.js").MigrationObjectType;
        requireMigration: import("./migrator/types.js").RequireMigrationType;
        direction?: string;
    }): Promise<boolean>;
}
//# sourceMappingURL=migrator.d.ts.map