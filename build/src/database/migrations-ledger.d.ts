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
     * Creates the ledger table if it does not exist. This is the single definition of
     * the `schema_migrations` table shape.
     * @param {import("./drivers/base.js").default} db - Database that should contain the ledger table.
     * @returns {Promise<void>}
     */
    static ensureTable(db: import("./drivers/base.js").default): Promise<void>;
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