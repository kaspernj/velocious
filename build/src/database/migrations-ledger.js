// @ts-check
import { digg } from "diggerize";
import TableData from "./table-data/index.js";
const TABLE_NAME = "schema_migrations";
/** SQL Server "There is already an object named ..." — raised when two sessions race to create the same table. */
const MSSQL_OBJECT_ALREADY_EXISTS_ERROR_NUMBER = 2714;
/** SQL Server deadlock victim — raised when concurrent sessions deadlock on the same catalog reads. */
const MSSQL_DEADLOCK_VICTIM_ERROR_NUMBER = 1205;
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
    static tableName() {
        return TABLE_NAME;
    }
    /**
     * Whether the ledger table exists on the given database.
     * @param {import("./drivers/base.js").default} db - Database whose migration ledger is inspected.
     * @returns {Promise<boolean>} - Whether the ledger table exists.
     */
    static async tableExists(db) {
        const table = await db.getTableByName(TABLE_NAME, { throwError: false });
        return Boolean(table);
    }
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
    static isConcurrentCreationError(error) {
        let current = error;
        while (current instanceof Error) {
            const errorNumber = /** @type {{number?: unknown}} */ (current).number;
            if (typeof errorNumber === "number" && errorNumber === MSSQL_OBJECT_ALREADY_EXISTS_ERROR_NUMBER)
                return true;
            current = current.cause;
        }
        return false;
    }
    /**
     * Whether the error is a transient deadlock that should be retried.
     *
     * Concurrent boots also deadlock on the `INFORMATION_SCHEMA` metadata scan that
     * `getTableByName` performs on SQL Server; the victim transaction rolled back cleanly,
     * so retrying it is safe. Matched by numeric error number, never by message text.
     * @param {unknown} error - Error thrown while inspecting or creating the ledger table.
     * @returns {boolean} - True if the error is a retryable deadlock.
     */
    static isDeadlockError(error) {
        let current = error;
        while (current instanceof Error) {
            const errorNumber = /** @type {{number?: unknown}} */ (current).number;
            if (typeof errorNumber === "number" && errorNumber === MSSQL_DEADLOCK_VICTIM_ERROR_NUMBER)
                return true;
            current = current.cause;
        }
        return false;
    }
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
    static async ensureTable(db, { maxAttempts = 3 } = {}) {
        let attempt = 0;
        while (true) {
            attempt++;
            try {
                if (await MigrationsLedger.tableExists(db))
                    return;
                const tableData = new TableData(TABLE_NAME, { ifNotExists: true });
                tableData.string("version", { null: false, primaryKey: true });
                for (const sql of await db.createTableSql(tableData)) {
                    await db.query(sql);
                }
                db.clearSchemaCache();
                return;
            }
            catch (error) {
                if (MigrationsLedger.isConcurrentCreationError(error)) {
                    // Another session created the ledger between our check and our create. The
                    // table exists with exactly this shape, so the goal state is already reached.
                    db.clearSchemaCache();
                    return;
                }
                if (MigrationsLedger.isDeadlockError(error) && attempt < maxAttempts) {
                    db.clearSchemaCache();
                    continue;
                }
                throw error;
            }
        }
    }
    /**
     * Every applied migration version recorded in the ledger.
     * @param {import("./drivers/base.js").default} db - Database whose applied versions are loaded.
     * @returns {Promise<string[]>} - Applied migration versions.
     */
    static async appliedVersions(db) {
        const rows = await db.select(TABLE_NAME);
        return rows.map((row) => `${digg(row, "version")}`);
    }
    /**
     * Whether the given version is recorded as applied.
     * @param {import("./drivers/base.js").default} db - Database whose ledger is queried.
     * @param {string} version - Migration version to look up.
     * @returns {Promise<boolean>} - Whether the migration version is applied.
     */
    static async hasVersion(db, version) {
        const rows = await db.newQuery()
            .from(TABLE_NAME)
            .where({ version })
            .results();
        return rows.length > 0;
    }
    /**
     * Records a single version as applied. The targeted existence check keeps the
     * migrator's per-migration hot path cheap (no full-table load per migration).
     * @param {import("./drivers/base.js").default} db - Database whose ledger receives the version.
     * @param {string} version - Migration version to record as applied.
     * @returns {Promise<void>}
     */
    static async recordVersion(db, version) {
        if (await MigrationsLedger.hasVersion(db, version))
            return;
        await db.insert({ tableName: TABLE_NAME, data: { version } });
    }
    /**
     * Removes a version from the ledger (used when migrating down).
     * @param {import("./drivers/base.js").default} db - Database whose ledger loses the version.
     * @param {string} version - Migration version to mark as unapplied.
     * @returns {Promise<void>}
     */
    static async removeVersion(db, version) {
        await db.delete({ tableName: TABLE_NAME, conditions: { version } });
    }
    /**
     * Baselines a database's ledger: records each version as applied without running
     * its migration. Idempotent — already-recorded versions are skipped. Ensures the
     * ledger table exists first, then loads the existing set once for the whole batch.
     * @param {import("./drivers/base.js").default} db - Database whose ledger should be baselined.
     * @param {string[]} versions - Migration versions to record without running them.
     * @returns {Promise<string[]>} The versions that were newly recorded.
     */
    static async markApplied(db, versions) {
        await MigrationsLedger.ensureTable(db);
        const existing = new Set(await MigrationsLedger.appliedVersions(db));
        const recorded = [];
        for (const version of versions) {
            const normalizedVersion = `${version}`;
            if (existing.has(normalizedVersion))
                continue;
            await db.insert({ tableName: TABLE_NAME, data: { version: normalizedVersion } });
            existing.add(normalizedVersion);
            recorded.push(normalizedVersion);
        }
        return recorded;
    }
    /**
     * Baselines `targetDb` to match the applied versions of `sourceDb`. Use when a
     * provisioning path advanced `targetDb`'s schema to match `sourceDb` out of band
     * (e.g. cloning table structure between databases): the migrations are, by
     * construction, already applied on the target, so record them without re-running.
     * @param {{sourceDb: import("./drivers/base.js").default, targetDb: import("./drivers/base.js").default}} args - Source ledger and target database to baseline.
     * @returns {Promise<string[]>} The versions that were newly recorded on the target.
     */
    static async baselineFromDatabase({ sourceDb, targetDb }) {
        const sourceVersions = await MigrationsLedger.appliedVersions(sourceDb);
        return await MigrationsLedger.markApplied(targetDb, sourceVersions);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlncmF0aW9ucy1sZWRnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvbWlncmF0aW9ucy1sZWRnZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxTQUFTLE1BQU0sdUJBQXVCLENBQUE7QUFFN0MsTUFBTSxVQUFVLEdBQUcsbUJBQW1CLENBQUE7QUFDdEMsa0hBQWtIO0FBQ2xILE1BQU0sd0NBQXdDLEdBQUcsSUFBSSxDQUFBO0FBQ3JELHVHQUF1RztBQUN2RyxNQUFNLGtDQUFrQyxHQUFHLElBQUksQ0FBQTtBQUcvQzs7Ozs7Ozs7O0dBU0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLGdCQUFnQjtJQUNuQzs7O09BR0c7SUFDSCxNQUFNLENBQUMsU0FBUztRQUNkLE9BQU8sVUFBVSxDQUFBO0lBQ25CLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsRUFBRTtRQUN6QixNQUFNLEtBQUssR0FBRyxNQUFNLEVBQUUsQ0FBQyxjQUFjLENBQUMsVUFBVSxFQUFFLEVBQUMsVUFBVSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFFdEUsT0FBTyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUE7SUFDdkIsQ0FBQztJQUVEOzs7Ozs7Ozs7OztPQVdHO0lBQ0gsTUFBTSxDQUFDLHlCQUF5QixDQUFDLEtBQUs7UUFDcEMsSUFBSSxPQUFPLEdBQUcsS0FBSyxDQUFBO1FBRW5CLE9BQU8sT0FBTyxZQUFZLEtBQUssRUFBRSxDQUFDO1lBQ2hDLE1BQU0sV0FBVyxHQUFHLGlDQUFpQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsTUFBTSxDQUFBO1lBRXRFLElBQUksT0FBTyxXQUFXLEtBQUssUUFBUSxJQUFJLFdBQVcsS0FBSyx3Q0FBd0M7Z0JBQUUsT0FBTyxJ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RUFBRSxpQkFBaUIsRUFBQyxFQUFDLENBQUMsQ0FBQTtZQUM1RSxRQUFRLENBQUMsR0FBRyxDQUFDLGlCQUFpQixDQUFDLENBQUE7WUFDL0IsUUFBUSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO1FBQ2xDLENBQUM7UUFFRCxPQUFPLFFBQVEsQ0FBQTtJQUNqQixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsb0JBQW9CLENBQUMsRUFBQyxRQUFRLEVBQUUsUUFBUSxFQUFDO1FBQ3BELE1BQU0sY0FBYyxHQUFHLE1BQU0sZ0JBQWdCLENBQUMsZUFBZSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZFLE9BQU8sTUFBTSxnQkFBZ0IsQ0FBQyxXQUFXLENBQUMsUUFBUSxFQUFFLGNBQWMsQ0FBQyxDQUFBO0lBQ3JFLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi90YWJsZS1kYXRhL2luZGV4LmpzXCJcblxuY29uc3QgVEFCTEVfTkFNRSA9IFwic2NoZW1hX21pZ3JhdGlvbnNcIlxuLyoqIFNRTCBTZXJ2ZXIgXCJUaGVyZSBpcyBhbHJlYWR5IGFuIG9iamVjdCBuYW1lZCAuLi5cIiDigJQgcmFpc2VkIHdoZW4gdHdvIHNlc3Npb25zIHJhY2UgdG8gY3JlYXRlIHRoZSBzYW1lIHRhYmxlLiAqL1xuY29uc3QgTVNTUUxfT0JKRUNUX0FMUkVBRFlfRVhJU1RTX0VSUk9SX05VTUJFUiA9IDI3MTRcbi8qKiBTUUwgU2VydmVyIGRlYWRsb2NrIHZpY3RpbSDigJQgcmFpc2VkIHdoZW4gY29uY3VycmVudCBzZXNzaW9ucyBkZWFkbG9jayBvbiB0aGUgc2FtZSBjYXRhbG9nIHJlYWRzLiAqL1xuY29uc3QgTVNTUUxfREVBRExPQ0tfVklDVElNX0VSUk9SX05VTUJFUiA9IDEyMDVcblxuXG4vKipcbiAqIFNpbmdsZSBvd25lciBvZiB0aGUgYHNjaGVtYV9taWdyYXRpb25zYCBsZWRnZXIgc2hhcGUgYW5kIHRoZSBvbmx5IHBsYWNlIHRoYXQgcmVhZHNcbiAqIG9yIHdyaXRlcyBhcHBsaWVkIG1pZ3JhdGlvbiB2ZXJzaW9ucyBmb3IgYSBkYXRhYmFzZSBjb25uZWN0aW9uLiBUaGUgbWlncmF0b3IgdXNlc1xuICogaXQgdG8gcmVjb3JkIHZlcnNpb25zIGFzIGl0IHJ1bnMgbWlncmF0aW9uczsgcHJvdmlzaW9uaW5nIC8gc2NoZW1hLWNsb25lIHBhdGhzIHVzZVxuICogYG1hcmtBcHBsaWVkYCAvIGBiYXNlbGluZUZyb21EYXRhYmFzZWAgdG8gcmVjb3JkIHZlcnNpb25zIGFzIGFwcGxpZWQgV0lUSE9VVFxuICogcmUtcnVubmluZyB0aGVtICh0aGUgUmFpbHMgYHNjaGVtYTpsb2FkYCAvIEZseXdheSBgYmFzZWxpbmVgIGlkZWEpLiBUaGF0IGtlZXBzIHRoZVxuICogbGVkZ2VyIGhvbmVzdCB3aGVuIGEgZGF0YWJhc2UncyBzY2hlbWEgd2FzIGFkdmFuY2VkIG91dCBvZiBiYW5kIOKAlCBlLmcuIGJ5IGNsb25pbmdcbiAqIHRhYmxlIHN0cnVjdHVyZSBiZXR3ZWVuIGRhdGFiYXNlcyDigJQgc28gdGhlIG1pZ3JhdG9yIGRvZXMgbm90IGxhdGVyIHJlLXJ1biBhXG4gKiBtaWdyYXRpb24gd2hvc2Ugc2NoZW1hIG9iamVjdCBhbHJlYWR5IGV4aXN0cy5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTWlncmF0aW9uc0xlZGdlciB7XG4gIC8qKlxuICAgKiBUaGUgbGVkZ2VyIHRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTGVkZ2VyIHRhYmxlIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgdGFibGVOYW1lKCkge1xuICAgIHJldHVybiBUQUJMRV9OQU1FXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgbGVkZ2VyIHRhYmxlIGV4aXN0cyBvbiB0aGUgZ2l2ZW4gZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSB3aG9zZSBtaWdyYXRpb24gbGVkZ2VyIGlzIGluc3BlY3RlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgbGVkZ2VyIHRhYmxlIGV4aXN0cy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB0YWJsZUV4aXN0cyhkYikge1xuICAgIGNvbnN0IHRhYmxlID0gYXdhaXQgZGIuZ2V0VGFibGVCeU5hbWUoVEFCTEVfTkFNRSwge3Rocm93RXJyb3I6IGZhbHNlfSlcblxuICAgIHJldHVybiBCb29sZWFuKHRhYmxlKVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIGVycm9yIG1lYW5zIGEgY29uY3VycmVudCBzZXNzaW9uIGFscmVhZHkgY3JlYXRlZCB0aGUgbGVkZ2VyIHRhYmxlLlxuICAgKlxuICAgKiBTZXZlcmFsIHByb2Nlc3NlcyBib290c3RyYXAgdGhlIHNhbWUgZGF0YWJhc2UgYXQgdGhlIHNhbWUgdGltZSAoZm9yIGV4YW1wbGUgZXZlcnlcbiAgICogQ0kgdGVzdCBzaGFyZCksIGFuZCB0aGUgTVNTUUwgYElGIE5PVCBFWElTVFMgKC4uLikgQkVHSU4gQ1JFQVRFIFRBQkxFIC4uLiBFTkRgIGd1YXJkXG4gICAqIGlzIE5PVCBhdG9taWM6IHR3byBzZXNzaW9ucyBjYW4gYm90aCBldmFsdWF0ZSB0aGUgY2hlY2sgYXMgZmFsc2UgYW5kIHRoZW4gYm90aFxuICAgKiBjcmVhdGUsIHNvIHRoZSBsb3NlciBpcyByZWplY3RlZC4gV2Fsa3MgdGhlIHdyYXBwZWQtZXJyb3IgY2F1c2UgY2hhaW4gYmVjYXVzZVxuICAgKiBgZGIucXVlcnlgIHJlLXdyYXBzIHRoZSBkcml2ZXIncyBgUmVxdWVzdEVycm9yYCBpbiBhIHBsYWluIGBFcnJvcmAsIGFuZCBtYXRjaGVzIHRoZVxuICAgKiBzdGFibGUgbnVtZXJpYyBlcnJvciBudW1iZXIgaW5zdGVhZCBvZiB0aGUgbG9jYWxpemVkIG1lc3NhZ2UgdGV4dC5cbiAgICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIEVycm9yIHRocm93biB3aGlsZSBjcmVhdGluZyB0aGUgbGVkZ2VyIHRhYmxlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBUcnVlIGlmIHRoZSB0YWJsZSB3YXMgY3JlYXRlZCBieSBhIGNvbmN1cnJlbnQgc2Vzc2lvbi5cbiAgICovXG4gIHN0YXRpYyBpc0NvbmN1cnJlbnRDcmVhdGlvbkVycm9yKGVycm9yKSB7XG4gICAgbGV0IGN1cnJlbnQgPSBlcnJvclxuXG4gICAgd2hpbGUgKGN1cnJlbnQgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgY29uc3QgZXJyb3JOdW1iZXIgPSAvKiogQHR5cGUge3tudW1iZXI/OiB1bmtub3dufX0gKi8gKGN1cnJlbnQpLm51bWJlclxuXG4gICAgICBpZiAodHlwZW9mIGVycm9yTnVtYmVyID09PSBcIm51bWJlclwiICYmIGVycm9yTnVtYmVyID09PSBNU1NRTF9PQkpFQ1RfQUxSRUFEWV9FWElTVFNfRVJST1JfTlVNQkVSKSByZXR1cm4gdHJ1ZVxuXG4gICAgICBjdXJyZW50ID0gY3VycmVudC5jYXVzZVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIGVycm9yIGlzIGEgdHJhbnNpZW50IGRlYWRsb2NrIHRoYXQgc2hvdWxkIGJlIHJldHJpZWQuXG4gICAqXG4gICAqIENvbmN1cnJlbnQgYm9vdHMgYWxzbyBkZWFkbG9jayBvbiB0aGUgYElORk9STUFUSU9OX1NDSEVNQWAgbWV0YWRhdGEgc2NhbiB0aGF0XG4gICAqIGBnZXRUYWJsZUJ5TmFtZWAgcGVyZm9ybXMgb24gU1FMIFNlcnZlcjsgdGhlIHZpY3RpbSB0cmFuc2FjdGlvbiByb2xsZWQgYmFjayBjbGVhbmx5LFxuICAgKiBzbyByZXRyeWluZyBpdCBpcyBzYWZlLiBNYXRjaGVkIGJ5IG51bWVyaWMgZXJyb3IgbnVtYmVyLCBuZXZlciBieSBtZXNzYWdlIHRleHQuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBFcnJvciB0aHJvd24gd2hpbGUgaW5zcGVjdGluZyBvciBjcmVhdGluZyB0aGUgbGVkZ2VyIHRhYmxlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBUcnVlIGlmIHRoZSBlcnJvciBpcyBhIHJldHJ5YWJsZSBkZWFkbG9jay5cbiAgICovXG4gIHN0YXRpYyBpc0RlYWRsb2NrRXJyb3IoZXJyb3IpIHtcbiAgICBsZXQgY3VycmVudCA9IGVycm9yXG5cbiAgICB3aGlsZSAoY3VycmVudCBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvck51bWJlciA9IC8qKiBAdHlwZSB7e251bWJlcj86IHVua25vd259fSAqLyAoY3VycmVudCkubnVtYmVyXG5cbiAgICAgIGlmICh0eXBlb2YgZXJyb3JOdW1iZXIgPT09IFwibnVtYmVyXCIgJiYgZXJyb3JOdW1iZXIgPT09IE1TU1FMX0RFQURMT0NLX1ZJQ1RJTV9FUlJPUl9OVU1CRVIpIHJldHVybiB0cnVlXG5cbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50LmNhdXNlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyB0aGUgbGVkZ2VyIHRhYmxlIGlmIGl0IGRvZXMgbm90IGV4aXN0LiBUaGlzIGlzIHRoZSBzaW5nbGUgZGVmaW5pdGlvbiBvZlxuICAgKiB0aGUgYHNjaGVtYV9taWdyYXRpb25zYCB0YWJsZSBzaGFwZS5cbiAgICpcbiAgICogU2FmZSB1bmRlciBjb25jdXJyZW5jeTogYSBzZXNzaW9uIHRoYXQgbG9zZXMgdGhlIGNyZWF0ZSByYWNlIChvciBkZWFkbG9ja3Mgb24gdGhlXG4gICAqIGNhdGFsb2cgcmVhZCkgY29udmVyZ2VzIG9uIHRoZSBleGlzdGluZyB0YWJsZSBpbnN0ZWFkIG9mIGZhaWxpbmcgaXRzIGNhbGxlci4gVGhhdFxuICAgKiBtYXR0ZXJzIGJlY2F1c2UgdGhpcyBydW5zIG9uIGV2ZXJ5IGJvb3Qgb2YgYSBkYXRhYmFzZSBjb25maWd1cmVkIGZvciBtaWdyYXRpb25zXG4gICAqIChzZWUgYE1pZ3JhdG9yI2NyZWF0ZU1pZ3JhdGlvbnNUYWJsZUZvckRhdGFiYXNlYCBhbmRcbiAgICogYG1pZ3JhdGVSZXF1aXJlQ29udGV4dEZvckRhdGFiYXNlYCksIHNvIGEgY3Jhc2ggaGVyZSB0YWtlcyBkb3duIGEgd2hvbGUgdGVzdCBzaGFyZFxuICAgKiBvciBkZXBsb3ltZW50IG92ZXIgYSB0YWJsZSB0aGF0IHByb3ZhYmx5IGFscmVhZHkgZXhpc3RzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgdGhhdCBzaG91bGQgY29udGFpbiB0aGUgbGVkZ2VyIHRhYmxlLlxuICAgKiBAcGFyYW0ge3ttYXhBdHRlbXB0cz86IG51bWJlcn19IFthcmdzXSAtIFJldHJ5IGJ1ZGdldCBmb3IgdHJhbnNpZW50IGNhdGFsb2cgZGVhZGxvY2tzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIHN0YXRpYyBhc3luYyBlbnN1cmVUYWJsZShkYiwge21heEF0dGVtcHRzID0gM30gPSB7fSkge1xuICAgIGxldCBhdHRlbXB0ID0gMFxuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGF0dGVtcHQrK1xuXG4gICAgICB0cnkge1xuICAgICAgICBpZiAoYXdhaXQgTWlncmF0aW9uc0xlZGdlci50YWJsZUV4aXN0cyhkYikpIHJldHVyblxuXG4gICAgICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoVEFCTEVfTkFNRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgICAgICB0YWJsZURhdGEuc3RyaW5nKFwidmVyc2lvblwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuXG4gICAgICAgIGZvciAoY29uc3Qgc3FsIG9mIGF3YWl0IGRiLmNyZWF0ZVRhYmxlU3FsKHRhYmxlRGF0YSkpIHtcbiAgICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICAgIH1cblxuICAgICAgICBkYi5jbGVhclNjaGVtYUNhY2hlKClcblxuICAgICAgICByZXR1cm5cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChNaWdyYXRpb25zTGVkZ2VyLmlzQ29uY3VycmVudENyZWF0aW9uRXJyb3IoZXJyb3IpKSB7XG4gICAgICAgICAgLy8gQW5vdGhlciBzZXNzaW9uIGNyZWF0ZWQgdGhlIGxlZGdlciBiZXR3ZWVuIG91ciBjaGVjayBhbmQgb3VyIGNyZWF0ZS4gVGhlXG4gICAgICAgICAgLy8gdGFibGUgZXhpc3RzIHdpdGggZXhhY3RseSB0aGlzIHNoYXBlLCBzbyB0aGUgZ29hbCBzdGF0ZSBpcyBhbHJlYWR5IHJlYWNoZWQuXG4gICAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG5cbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChNaWdyYXRpb25zTGVkZ2VyLmlzRGVhZGxvY2tFcnJvcihlcnJvcikgJiYgYXR0ZW1wdCA8IG1heEF0dGVtcHRzKSB7XG4gICAgICAgICAgZGIuY2xlYXJTY2hlbWFDYWNoZSgpXG5cbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRXZlcnkgYXBwbGllZCBtaWdyYXRpb24gdmVyc2lvbiByZWNvcmRlZCBpbiB0aGUgbGVkZ2VyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2Ugd2hvc2UgYXBwbGllZCB2ZXJzaW9ucyBhcmUgbG9hZGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gQXBwbGllZCBtaWdyYXRpb24gdmVyc2lvbnMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgYXBwbGllZFZlcnNpb25zKGRiKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLnNlbGVjdChUQUJMRV9OQU1FKVxuXG4gICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IGAke2RpZ2cocm93LCBcInZlcnNpb25cIil9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBnaXZlbiB2ZXJzaW9uIGlzIHJlY29yZGVkIGFzIGFwcGxpZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSB3aG9zZSBsZWRnZXIgaXMgcXVlcmllZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZlcnNpb24gLSBNaWdyYXRpb24gdmVyc2lvbiB0byBsb29rIHVwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBtaWdyYXRpb24gdmVyc2lvbiBpcyBhcHBsaWVkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGhhc1ZlcnNpb24oZGIsIHZlcnNpb24pIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGIubmV3UXVlcnkoKVxuICAgICAgLmZyb20oVEFCTEVfTkFNRSlcbiAgICAgIC53aGVyZSh7dmVyc2lvbn0pXG4gICAgICAucmVzdWx0cygpXG5cbiAgICByZXR1cm4gcm93cy5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIHNpbmdsZSB2ZXJzaW9uIGFzIGFwcGxpZWQuIFRoZSB0YXJnZXRlZCBleGlzdGVuY2UgY2hlY2sga2VlcHMgdGhlXG4gICAqIG1pZ3JhdG9yJ3MgcGVyLW1pZ3JhdGlvbiBob3QgcGF0aCBjaGVhcCAobm8gZnVsbC10YWJsZSBsb2FkIHBlciBtaWdyYXRpb24pLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2Ugd2hvc2UgbGVkZ2VyIHJlY2VpdmVzIHRoZSB2ZXJzaW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmVyc2lvbiAtIE1pZ3JhdGlvbiB2ZXJzaW9uIHRvIHJlY29yZCBhcyBhcHBsaWVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIHN0YXRpYyBhc3luYyByZWNvcmRWZXJzaW9uKGRiLCB2ZXJzaW9uKSB7XG4gICAgaWYgKGF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIuaGFzVmVyc2lvbihkYiwgdmVyc2lvbikpIHJldHVyblxuXG4gICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IFRBQkxFX05BTUUsIGRhdGE6IHt2ZXJzaW9ufX0pXG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlcyBhIHZlcnNpb24gZnJvbSB0aGUgbGVkZ2VyICh1c2VkIHdoZW4gbWlncmF0aW5nIGRvd24pLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2Ugd2hvc2UgbGVkZ2VyIGxvc2VzIHRoZSB2ZXJzaW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmVyc2lvbiAtIE1pZ3JhdGlvbiB2ZXJzaW9uIHRvIG1hcmsgYXMgdW5hcHBsaWVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIHN0YXRpYyBhc3luYyByZW1vdmVWZXJzaW9uKGRiLCB2ZXJzaW9uKSB7XG4gICAgYXdhaXQgZGIuZGVsZXRlKHt0YWJsZU5hbWU6IFRBQkxFX05BTUUsIGNvbmRpdGlvbnM6IHt2ZXJzaW9ufX0pXG4gIH1cblxuICAvKipcbiAgICogQmFzZWxpbmVzIGEgZGF0YWJhc2UncyBsZWRnZXI6IHJlY29yZHMgZWFjaCB2ZXJzaW9uIGFzIGFwcGxpZWQgd2l0aG91dCBydW5uaW5nXG4gICAqIGl0cyBtaWdyYXRpb24uIElkZW1wb3RlbnQg4oCUIGFscmVhZHktcmVjb3JkZWQgdmVyc2lvbnMgYXJlIHNraXBwZWQuIEVuc3VyZXMgdGhlXG4gICAqIGxlZGdlciB0YWJsZSBleGlzdHMgZmlyc3QsIHRoZW4gbG9hZHMgdGhlIGV4aXN0aW5nIHNldCBvbmNlIGZvciB0aGUgd2hvbGUgYmF0Y2guXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSB3aG9zZSBsZWRnZXIgc2hvdWxkIGJlIGJhc2VsaW5lZC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gdmVyc2lvbnMgLSBNaWdyYXRpb24gdmVyc2lvbnMgdG8gcmVjb3JkIHdpdGhvdXQgcnVubmluZyB0aGVtLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IFRoZSB2ZXJzaW9ucyB0aGF0IHdlcmUgbmV3bHkgcmVjb3JkZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgbWFya0FwcGxpZWQoZGIsIHZlcnNpb25zKSB7XG4gICAgYXdhaXQgTWlncmF0aW9uc0xlZGdlci5lbnN1cmVUYWJsZShkYilcblxuICAgIGNvbnN0IGV4aXN0aW5nID0gbmV3IFNldChhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLmFwcGxpZWRWZXJzaW9ucyhkYikpXG4gICAgY29uc3QgcmVjb3JkZWQgPSBbXVxuXG4gICAgZm9yIChjb25zdCB2ZXJzaW9uIG9mIHZlcnNpb25zKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkVmVyc2lvbiA9IGAke3ZlcnNpb259YFxuXG4gICAgICBpZiAoZXhpc3RpbmcuaGFzKG5vcm1hbGl6ZWRWZXJzaW9uKSkgY29udGludWVcblxuICAgICAgYXdhaXQgZGIuaW5zZXJ0KHt0YWJsZU5hbWU6IFRBQkxFX05BTUUsIGRhdGE6IHt2ZXJzaW9uOiBub3JtYWxpemVkVmVyc2lvbn19KVxuICAgICAgZXhpc3RpbmcuYWRkKG5vcm1hbGl6ZWRWZXJzaW9uKVxuICAgICAgcmVjb3JkZWQucHVzaChub3JtYWxpemVkVmVyc2lvbilcbiAgICB9XG5cbiAgICByZXR1cm4gcmVjb3JkZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBCYXNlbGluZXMgYHRhcmdldERiYCB0byBtYXRjaCB0aGUgYXBwbGllZCB2ZXJzaW9ucyBvZiBgc291cmNlRGJgLiBVc2Ugd2hlbiBhXG4gICAqIHByb3Zpc2lvbmluZyBwYXRoIGFkdmFuY2VkIGB0YXJnZXREYmAncyBzY2hlbWEgdG8gbWF0Y2ggYHNvdXJjZURiYCBvdXQgb2YgYmFuZFxuICAgKiAoZS5nLiBjbG9uaW5nIHRhYmxlIHN0cnVjdHVyZSBiZXR3ZWVuIGRhdGFiYXNlcyk6IHRoZSBtaWdyYXRpb25zIGFyZSwgYnlcbiAgICogY29uc3RydWN0aW9uLCBhbHJlYWR5IGFwcGxpZWQgb24gdGhlIHRhcmdldCwgc28gcmVjb3JkIHRoZW0gd2l0aG91dCByZS1ydW5uaW5nLlxuICAgKiBAcGFyYW0ge3tzb3VyY2VEYjogaW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgdGFyZ2V0RGI6IGltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9fSBhcmdzIC0gU291cmNlIGxlZGdlciBhbmQgdGFyZ2V0IGRhdGFiYXNlIHRvIGJhc2VsaW5lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IFRoZSB2ZXJzaW9ucyB0aGF0IHdlcmUgbmV3bHkgcmVjb3JkZWQgb24gdGhlIHRhcmdldC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBiYXNlbGluZUZyb21EYXRhYmFzZSh7c291cmNlRGIsIHRhcmdldERifSkge1xuICAgIGNvbnN0IHNvdXJjZVZlcnNpb25zID0gYXdhaXQgTWlncmF0aW9uc0xlZGdlci5hcHBsaWVkVmVyc2lvbnMoc291cmNlRGIpXG5cbiAgICByZXR1cm4gYXdhaXQgTWlncmF0aW9uc0xlZGdlci5tYXJrQXBwbGllZCh0YXJnZXREYiwgc291cmNlVmVyc2lvbnMpXG4gIH1cbn1cbiJdfQ==