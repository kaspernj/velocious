// @ts-check
import { digg } from "diggerize";
import TableData from "./table-data/index.js";
const TABLE_NAME = "schema_migrations";
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
     * Creates the ledger table if it does not exist. This is the single definition of
     * the `schema_migrations` table shape.
     * @param {import("./drivers/base.js").default} db - Database that should contain the ledger table.
     * @returns {Promise<void>}
     */
    static async ensureTable(db) {
        if (await MigrationsLedger.tableExists(db))
            return;
        const tableData = new TableData(TABLE_NAME, { ifNotExists: true });
        tableData.string("version", { null: false, primaryKey: true });
        for (const sql of await db.createTableSql(tableData)) {
            await db.query(sql);
        }
        db.clearSchemaCache();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlncmF0aW9ucy1sZWRnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvbWlncmF0aW9ucy1sZWRnZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxTQUFTLE1BQU0sdUJBQXVCLENBQUE7QUFFN0MsTUFBTSxVQUFVLEdBQUcsbUJBQW1CLENBQUE7QUFFdEM7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxnQkFBZ0I7SUFDbkM7OztPQUdHO0lBQ0gsTUFBTSxDQUFDLFNBQVM7UUFDZCxPQUFPLFVBQVUsQ0FBQTtJQUNuQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLEVBQUU7UUFDekIsTUFBTSxLQUFLLEdBQUcsTUFBTSxFQUFFLENBQUMsY0FBYyxDQUFDLFVBQVUsRUFBRSxFQUFDLFVBQVUsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBRXRFLE9BQU8sT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQ3ZCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLEVBQUU7UUFDekIsSUFBSSxNQUFNLGdCQUFnQixDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7WUFBRSxPQUFNO1FBRWxELE1BQU0sU0FBUyxHQUFHLElBQUksU0FBUyxDQUFDLFVBQVUsRUFBRSxFQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBRWhFLFNBQVMsQ0FBQyxNQUFNLENBQUMsU0FBUyxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUU1RCxLQUFLLE1BQU0sR0FBRyxJQUFJLE1BQU0sRUFBRSxDQUFDLGNBQWMsQ0FBQyxTQUFT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QUMsQ0FBQTtJQUNyRSxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4vdGFibGUtZGF0YS9pbmRleC5qc1wiXG5cbmNvbnN0IFRBQkxFX05BTUUgPSBcInNjaGVtYV9taWdyYXRpb25zXCJcblxuLyoqXG4gKiBTaW5nbGUgb3duZXIgb2YgdGhlIGBzY2hlbWFfbWlncmF0aW9uc2AgbGVkZ2VyIHNoYXBlIGFuZCB0aGUgb25seSBwbGFjZSB0aGF0IHJlYWRzXG4gKiBvciB3cml0ZXMgYXBwbGllZCBtaWdyYXRpb24gdmVyc2lvbnMgZm9yIGEgZGF0YWJhc2UgY29ubmVjdGlvbi4gVGhlIG1pZ3JhdG9yIHVzZXNcbiAqIGl0IHRvIHJlY29yZCB2ZXJzaW9ucyBhcyBpdCBydW5zIG1pZ3JhdGlvbnM7IHByb3Zpc2lvbmluZyAvIHNjaGVtYS1jbG9uZSBwYXRocyB1c2VcbiAqIGBtYXJrQXBwbGllZGAgLyBgYmFzZWxpbmVGcm9tRGF0YWJhc2VgIHRvIHJlY29yZCB2ZXJzaW9ucyBhcyBhcHBsaWVkIFdJVEhPVVRcbiAqIHJlLXJ1bm5pbmcgdGhlbSAodGhlIFJhaWxzIGBzY2hlbWE6bG9hZGAgLyBGbHl3YXkgYGJhc2VsaW5lYCBpZGVhKS4gVGhhdCBrZWVwcyB0aGVcbiAqIGxlZGdlciBob25lc3Qgd2hlbiBhIGRhdGFiYXNlJ3Mgc2NoZW1hIHdhcyBhZHZhbmNlZCBvdXQgb2YgYmFuZCDigJQgZS5nLiBieSBjbG9uaW5nXG4gKiB0YWJsZSBzdHJ1Y3R1cmUgYmV0d2VlbiBkYXRhYmFzZXMg4oCUIHNvIHRoZSBtaWdyYXRvciBkb2VzIG5vdCBsYXRlciByZS1ydW4gYVxuICogbWlncmF0aW9uIHdob3NlIHNjaGVtYSBvYmplY3QgYWxyZWFkeSBleGlzdHMuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIE1pZ3JhdGlvbnNMZWRnZXIge1xuICAvKipcbiAgICogVGhlIGxlZGdlciB0YWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIExlZGdlciB0YWJsZSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIHRhYmxlTmFtZSgpIHtcbiAgICByZXR1cm4gVEFCTEVfTkFNRVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIGxlZGdlciB0YWJsZSBleGlzdHMgb24gdGhlIGdpdmVuIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2Ugd2hvc2UgbWlncmF0aW9uIGxlZGdlciBpcyBpbnNwZWN0ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGxlZGdlciB0YWJsZSBleGlzdHMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgdGFibGVFeGlzdHMoZGIpIHtcbiAgICBjb25zdCB0YWJsZSA9IGF3YWl0IGRiLmdldFRhYmxlQnlOYW1lKFRBQkxFX05BTUUsIHt0aHJvd0Vycm9yOiBmYWxzZX0pXG5cbiAgICByZXR1cm4gQm9vbGVhbih0YWJsZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBsZWRnZXIgdGFibGUgaWYgaXQgZG9lcyBub3QgZXhpc3QuIFRoaXMgaXMgdGhlIHNpbmdsZSBkZWZpbml0aW9uIG9mXG4gICAqIHRoZSBgc2NoZW1hX21pZ3JhdGlvbnNgIHRhYmxlIHNoYXBlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgdGhhdCBzaG91bGQgY29udGFpbiB0aGUgbGVkZ2VyIHRhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIHN0YXRpYyBhc3luYyBlbnN1cmVUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLnRhYmxlRXhpc3RzKGRiKSkgcmV0dXJuXG5cbiAgICBjb25zdCB0YWJsZURhdGEgPSBuZXcgVGFibGVEYXRhKFRBQkxFX05BTUUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZURhdGEuc3RyaW5nKFwidmVyc2lvblwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuY3JlYXRlVGFibGVTcWwodGFibGVEYXRhKSkge1xuICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgIH1cblxuICAgIGRiLmNsZWFyU2NoZW1hQ2FjaGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIEV2ZXJ5IGFwcGxpZWQgbWlncmF0aW9uIHZlcnNpb24gcmVjb3JkZWQgaW4gdGhlIGxlZGdlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIHdob3NlIGFwcGxpZWQgdmVyc2lvbnMgYXJlIGxvYWRlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIEFwcGxpZWQgbWlncmF0aW9uIHZlcnNpb25zLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGFwcGxpZWRWZXJzaW9ucyhkYikge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYi5zZWxlY3QoVEFCTEVfTkFNRSlcblxuICAgIHJldHVybiByb3dzLm1hcCgocm93KSA9PiBgJHtkaWdnKHJvdywgXCJ2ZXJzaW9uXCIpfWApXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgZ2l2ZW4gdmVyc2lvbiBpcyByZWNvcmRlZCBhcyBhcHBsaWVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2Ugd2hvc2UgbGVkZ2VyIGlzIHF1ZXJpZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2ZXJzaW9uIC0gTWlncmF0aW9uIHZlcnNpb24gdG8gbG9vayB1cC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgbWlncmF0aW9uIHZlcnNpb24gaXMgYXBwbGllZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBoYXNWZXJzaW9uKGRiLCB2ZXJzaW9uKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKFRBQkxFX05BTUUpXG4gICAgICAud2hlcmUoe3ZlcnNpb259KVxuICAgICAgLnJlc3VsdHMoKVxuXG4gICAgcmV0dXJuIHJvd3MubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBzaW5nbGUgdmVyc2lvbiBhcyBhcHBsaWVkLiBUaGUgdGFyZ2V0ZWQgZXhpc3RlbmNlIGNoZWNrIGtlZXBzIHRoZVxuICAgKiBtaWdyYXRvcidzIHBlci1taWdyYXRpb24gaG90IHBhdGggY2hlYXAgKG5vIGZ1bGwtdGFibGUgbG9hZCBwZXIgbWlncmF0aW9uKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIHdob3NlIGxlZGdlciByZWNlaXZlcyB0aGUgdmVyc2lvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZlcnNpb24gLSBNaWdyYXRpb24gdmVyc2lvbiB0byByZWNvcmQgYXMgYXBwbGllZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcmVjb3JkVmVyc2lvbihkYiwgdmVyc2lvbikge1xuICAgIGlmIChhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLmhhc1ZlcnNpb24oZGIsIHZlcnNpb24pKSByZXR1cm5cblxuICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBUQUJMRV9OQU1FLCBkYXRhOiB7dmVyc2lvbn19KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYSB2ZXJzaW9uIGZyb20gdGhlIGxlZGdlciAodXNlZCB3aGVuIG1pZ3JhdGluZyBkb3duKS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIHdob3NlIGxlZGdlciBsb3NlcyB0aGUgdmVyc2lvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZlcnNpb24gLSBNaWdyYXRpb24gdmVyc2lvbiB0byBtYXJrIGFzIHVuYXBwbGllZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcmVtb3ZlVmVyc2lvbihkYiwgdmVyc2lvbikge1xuICAgIGF3YWl0IGRiLmRlbGV0ZSh7dGFibGVOYW1lOiBUQUJMRV9OQU1FLCBjb25kaXRpb25zOiB7dmVyc2lvbn19KVxuICB9XG5cbiAgLyoqXG4gICAqIEJhc2VsaW5lcyBhIGRhdGFiYXNlJ3MgbGVkZ2VyOiByZWNvcmRzIGVhY2ggdmVyc2lvbiBhcyBhcHBsaWVkIHdpdGhvdXQgcnVubmluZ1xuICAgKiBpdHMgbWlncmF0aW9uLiBJZGVtcG90ZW50IOKAlCBhbHJlYWR5LXJlY29yZGVkIHZlcnNpb25zIGFyZSBza2lwcGVkLiBFbnN1cmVzIHRoZVxuICAgKiBsZWRnZXIgdGFibGUgZXhpc3RzIGZpcnN0LCB0aGVuIGxvYWRzIHRoZSBleGlzdGluZyBzZXQgb25jZSBmb3IgdGhlIHdob2xlIGJhdGNoLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2Ugd2hvc2UgbGVkZ2VyIHNob3VsZCBiZSBiYXNlbGluZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHZlcnNpb25zIC0gTWlncmF0aW9uIHZlcnNpb25zIHRvIHJlY29yZCB3aXRob3V0IHJ1bm5pbmcgdGhlbS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSBUaGUgdmVyc2lvbnMgdGhhdCB3ZXJlIG5ld2x5IHJlY29yZGVkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIG1hcmtBcHBsaWVkKGRiLCB2ZXJzaW9ucykge1xuICAgIGF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIuZW5zdXJlVGFibGUoZGIpXG5cbiAgICBjb25zdCBleGlzdGluZyA9IG5ldyBTZXQoYXdhaXQgTWlncmF0aW9uc0xlZGdlci5hcHBsaWVkVmVyc2lvbnMoZGIpKVxuICAgIGNvbnN0IHJlY29yZGVkID0gW11cblxuICAgIGZvciAoY29uc3QgdmVyc2lvbiBvZiB2ZXJzaW9ucykge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZFZlcnNpb24gPSBgJHt2ZXJzaW9ufWBcblxuICAgICAgaWYgKGV4aXN0aW5nLmhhcyhub3JtYWxpemVkVmVyc2lvbikpIGNvbnRpbnVlXG5cbiAgICAgIGF3YWl0IGRiLmluc2VydCh7dGFibGVOYW1lOiBUQUJMRV9OQU1FLCBkYXRhOiB7dmVyc2lvbjogbm9ybWFsaXplZFZlcnNpb259fSlcbiAgICAgIGV4aXN0aW5nLmFkZChub3JtYWxpemVkVmVyc2lvbilcbiAgICAgIHJlY29yZGVkLnB1c2gobm9ybWFsaXplZFZlcnNpb24pXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlY29yZGVkXG4gIH1cblxuICAvKipcbiAgICogQmFzZWxpbmVzIGB0YXJnZXREYmAgdG8gbWF0Y2ggdGhlIGFwcGxpZWQgdmVyc2lvbnMgb2YgYHNvdXJjZURiYC4gVXNlIHdoZW4gYVxuICAgKiBwcm92aXNpb25pbmcgcGF0aCBhZHZhbmNlZCBgdGFyZ2V0RGJgJ3Mgc2NoZW1hIHRvIG1hdGNoIGBzb3VyY2VEYmAgb3V0IG9mIGJhbmRcbiAgICogKGUuZy4gY2xvbmluZyB0YWJsZSBzdHJ1Y3R1cmUgYmV0d2VlbiBkYXRhYmFzZXMpOiB0aGUgbWlncmF0aW9ucyBhcmUsIGJ5XG4gICAqIGNvbnN0cnVjdGlvbiwgYWxyZWFkeSBhcHBsaWVkIG9uIHRoZSB0YXJnZXQsIHNvIHJlY29yZCB0aGVtIHdpdGhvdXQgcmUtcnVubmluZy5cbiAgICogQHBhcmFtIHt7c291cmNlRGI6IGltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIHRhcmdldERiOiBpbXBvcnQoXCIuL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fX0gYXJncyAtIFNvdXJjZSBsZWRnZXIgYW5kIHRhcmdldCBkYXRhYmFzZSB0byBiYXNlbGluZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSBUaGUgdmVyc2lvbnMgdGhhdCB3ZXJlIG5ld2x5IHJlY29yZGVkIG9uIHRoZSB0YXJnZXQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgYmFzZWxpbmVGcm9tRGF0YWJhc2Uoe3NvdXJjZURiLCB0YXJnZXREYn0pIHtcbiAgICBjb25zdCBzb3VyY2VWZXJzaW9ucyA9IGF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIuYXBwbGllZFZlcnNpb25zKHNvdXJjZURiKVxuXG4gICAgcmV0dXJuIGF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIubWFya0FwcGxpZWQodGFyZ2V0RGIsIHNvdXJjZVZlcnNpb25zKVxuICB9XG59XG4iXX0=