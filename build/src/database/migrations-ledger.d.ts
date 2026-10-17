/**
 * Single owner of the `schema_migrations` ledger shape and the only place that reads
 * or writes applied migration versions for a database connection. The migrator uses
 * it to record versions as it runs migrations; provisioning / schema-clone paths use
 * `markApplied` / `baselineFromDatabase` to record versions as applied WITHOUT
 * re-running them (the Rails `schema:load` / Flyway `baseline` idea). That keeps the
 * ledger honest when a database's schema was advanced out of band — e.g. by cloning
 * table structure between databases — so the migrator does not later re-run a
 * migration whose schema object already exists.
 */
export default class MigrationsLedger {
    /**
     * The ledger table name.
     * @returns {string} - Ledger table name.
     */
    static tableName(): string;
    /**
     * Whether the ledger table exists on the given database.
     * @param {import("./drivers/base.js").default} db - Database whose migration ledger is inspected.
     * @returns {Promise<boolean>} - Whether the ledger table exists.
     */
    static tableExists(db: import("./drivers/base.js").default): Promise<boolean>;
    /**
     * Whether the error means a concurrent session already created the ledger table.
     *
     * Several processes bootstrap the same database at the same time (for example every
     * CI test shard), and the MSSQL `IF NOT EXISTS (...) BEGIN CREATE TABLE ... END` guard
     * is NOT atomic: two sessions can both evaluate the check as false and then both
     * create, so the loser is rejected. Walks the wrapped-error cause chain because
     * `db.query` re-wraps the driver's `RequestError` in a plain `Error`, and matches the
     * stable numeric error number instead of the localized message text.
     * @param {unknown} error - Error thrown while creating the ledger table.
     * @returns {boolean} - True if the table was created by a concurrent session.
     */
    static isConcurrentCreationError(error: unknown): boolean;
    /**
     * Whether the error is a transient deadlock that should be retried.
     *
     * Concurrent boots also deadlock on the `INFORMATION_SCHEMA` metadata scan that
     * `getTableByName` performs on SQL Server; the victim transaction rolled back cleanly,
     * so retrying it is safe. Matched by numeric error number, never by message text.
     * @param {unknown} error - Error thrown while inspecting or creating the ledger table.
     * @returns {boolean} - True if the error is a retryable deadlock.
     */
    static isDeadlockError(error: unknown): boolean;
    /**
     * Creates the ledger table if it does not exist. This is the single definition of
     * the `schema_migrations` table shape.
     *
     * Safe under concurrency: a session that loses the create race (or deadlocks on the
     * catalog read) converges on the existing table instead of failing its caller. That
     * matters because this runs on every boot of a database configured for migrations
     * (see `Migrator#createMigrationsTableForDatabase` and
     * `migrateRequireContextForDatabase`), so a crash here takes down a whole test shard
     * or deployment over a table that provably already exists.
     * @param {import("./drivers/base.js").default} db - Database that should contain the ledger table.
     * @param {{maxAttempts?: number}} [args] - Retry budget for transient catalog deadlocks.
     * @returns {Promise<void>}
     */
    static ensureTable(db: import("./drivers/base.js").default, { maxAttempts }?: {
        maxAttempts?: number;
    }): Promise<void>;
    /**
     * Every applied migration version recorded in the ledger.
     * @param {import("./drivers/base.js").default} db - Database whose applied versions are loaded.
     * @returns {Promise<string[]>} - Applied migration versions.
     */
    static appliedVersions(db: import("./drivers/base.js").default): Promise<string[]>;
    /**
     * Whether the given version is recorded as applied.
     * @param {import("./drivers/base.js").default} db - Database whose ledger is queried.
     * @param {string} version - Migration version to look up.
     * @returns {Promise<boolean>} - Whether the migration version is applied.
     */
    static hasVersion(db: import("./drivers/base.js").default, version: string): Promise<boolean>;
    /**
     * Records a single version as applied. The targeted existence check keeps the
     * migrator's per-migration hot path cheap (no full-table load per migration).
     * @param {import("./drivers/base.js").default} db - Database whose ledger receives the version.
     * @param {string} version - Migration version to record as applied.
     * @returns {Promise<void>}
     */
    static recordVersion(db: import("./drivers/base.js").default, version: string): Promise<void>;
    /**
     * Removes a version from the ledger (used when migrating down).
     * @param {import("./drivers/base.js").default} db - Database whose ledger loses the version.
     * @param {string} version - Migration version to mark as unapplied.
     * @returns {Promise<void>}
     */
    static removeVersion(db: import("./drivers/base.js").default, version: string): Promise<void>;
    /**
     * Baselines a database's ledger: records each version as applied without running
     * its migration. Idempotent — already-recorded versions are skipped. Ensures the
     * ledger table exists first, then loads the existing set once for the whole batch.
     * @param {import("./drivers/base.js").default} db - Database whose ledger should be baselined.
     * @param {string[]} versions - Migration versions to record without running them.
     * @returns {Promise<string[]>} The versions that were newly recorded.
     */
    static markApplied(db: import("./drivers/base.js").default, versions: string[]): Promise<string[]>;
    /**
     * Baselines `targetDb` to match the applied versions of `sourceDb`. Use when a
     * provisioning path advanced `targetDb`'s schema to match `sourceDb` out of band
     * (e.g. cloning table structure between databases): the migrations are, by
     * construction, already applied on the target, so record them without re-running.
     * @param {{sourceDb: import("./drivers/base.js").default, targetDb: import("./drivers/base.js").default}} args - Source ledger and target database to baseline.
     * @returns {Promise<string[]>} The versions that were newly recorded on the target.
     */
    static baselineFromDatabase({ sourceDb, targetDb }: {
        sourceDb: import("./drivers/base.js").default;
        targetDb: import("./drivers/base.js").default;
    }): Promise<string[]>;
}
//# sourceMappingURL=migrations-ledger.d.ts.map