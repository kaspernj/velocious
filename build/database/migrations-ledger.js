// @ts-check

import {digg} from "diggerize"
import TableData from "./table-data/index.js"

const TABLE_NAME = "schema_migrations"
/** SQL Server "There is already an object named ..." — raised when two sessions race to create the same table. */
const MSSQL_OBJECT_ALREADY_EXISTS_ERROR_NUMBER = 2714
/** SQL Server deadlock victim — raised when concurrent sessions deadlock on the same catalog reads. */
const MSSQL_DEADLOCK_VICTIM_ERROR_NUMBER = 1205


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
    let current = error

    while (current instanceof Error) {
      const errorNumber = /** @type {{number?: unknown}} */ (current).number

      if (typeof errorNumber === "number" && errorNumber === MSSQL_OBJECT_ALREADY_EXISTS_ERROR_NUMBER) return true

      current = current.cause
    }

    return false
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
    let current = error

    while (current instanceof Error) {
      const errorNumber = /** @type {{number?: unknown}} */ (current).number

      if (typeof errorNumber === "number" && errorNumber === MSSQL_DEADLOCK_VICTIM_ERROR_NUMBER) return true

      current = current.cause
    }

    return false
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
  static async ensureTable(db, {maxAttempts = 3} = {}) {
    let attempt = 0

    while (true) {
      attempt++

      try {
        if (await MigrationsLedger.tableExists(db)) return

        const tableData = new TableData(TABLE_NAME, {ifNotExists: true})

        tableData.string("version", {null: false, primaryKey: true})

        for (const sql of await db.createTableSql(tableData)) {
          await db.query(sql)
        }

        db.clearSchemaCache()

        return
      } catch (error) {
        if (MigrationsLedger.isConcurrentCreationError(error)) {
          // Another session created the ledger between our check and our create. The
          // table exists with exactly this shape, so the goal state is already reached.
          db.clearSchemaCache()

          return
        }

        if (MigrationsLedger.isDeadlockError(error) && attempt < maxAttempts) {
          db.clearSchemaCache()

          continue
        }

        throw error
      }
    }
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
