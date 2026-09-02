// @ts-check

import {digg} from "diggerize"
import TableData from "./table-data/index.js"

const TABLE_NAME = "schema_migrations"

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
    return TABLE_NAME
  }

  /**
   * Whether the ledger table exists on the given database.
   * @param {import("./drivers/base.js").default} db - Database whose migration ledger is inspected.
   * @returns {Promise<boolean>} - Whether the ledger table exists.
   */
  static async tableExists(db) {
    const table = await db.getTableByName(TABLE_NAME, {throwError: false})

    return Boolean(table)
  }

  /**
   * Creates the ledger table if it does not exist. This is the single definition of
   * the `schema_migrations` table shape.
   * @param {import("./drivers/base.js").default} db - Database that should contain the ledger table.
   * @returns {Promise<void>}
   */
  static async ensureTable(db) {
    if (await MigrationsLedger.tableExists(db)) return

    const tableData = new TableData(TABLE_NAME, {ifNotExists: true})

    tableData.string("version", {null: false, primaryKey: true})

    for (const sql of await db.createTableSql(tableData)) {
      await db.query(sql)
    }

    db.clearSchemaCache()
  }

  /**
   * Every applied migration version recorded in the ledger.
   * @param {import("./drivers/base.js").default} db - Database whose applied versions are loaded.
   * @returns {Promise<string[]>} - Applied migration versions.
   */
  static async appliedVersions(db) {
    const rows = await db.select(TABLE_NAME)

    return rows.map((row) => `${digg(row, "version")}`)
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
      .where({version})
      .results()

    return rows.length > 0
  }

  /**
   * Records a single version as applied. The targeted existence check keeps the
   * migrator's per-migration hot path cheap (no full-table load per migration).
   * @param {import("./drivers/base.js").default} db - Database whose ledger receives the version.
   * @param {string} version - Migration version to record as applied.
   * @returns {Promise<void>}
   */
  static async recordVersion(db, version) {
    if (await MigrationsLedger.hasVersion(db, version)) return

    await db.insert({tableName: TABLE_NAME, data: {version}})
  }

  /**
   * Removes a version from the ledger (used when migrating down).
   * @param {import("./drivers/base.js").default} db - Database whose ledger loses the version.
   * @param {string} version - Migration version to mark as unapplied.
   * @returns {Promise<void>}
   */
  static async removeVersion(db, version) {
    await db.delete({tableName: TABLE_NAME, conditions: {version}})
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
    await MigrationsLedger.ensureTable(db)

    const existing = new Set(await MigrationsLedger.appliedVersions(db))
    const recorded = []

    for (const version of versions) {
      const normalizedVersion = `${version}`

      if (existing.has(normalizedVersion)) continue

      await db.insert({tableName: TABLE_NAME, data: {version: normalizedVersion}})
      existing.add(normalizedVersion)
      recorded.push(normalizedVersion)
    }

    return recorded
  }

  /**
   * Baselines `targetDb` to match the applied versions of `sourceDb`. Use when a
   * provisioning path advanced `targetDb`'s schema to match `sourceDb` out of band
   * (e.g. cloning table structure between databases): the migrations are, by
   * construction, already applied on the target, so record them without re-running.
   * @param {{sourceDb: import("./drivers/base.js").default, targetDb: import("./drivers/base.js").default}} args - Source ledger and target database to baseline.
   * @returns {Promise<string[]>} The versions that were newly recorded on the target.
   */
  static async baselineFromDatabase({sourceDb, targetDb}) {
    const sourceVersions = await MigrationsLedger.appliedVersions(sourceDb)

    return await MigrationsLedger.markApplied(targetDb, sourceVersions)
  }
}
