// @ts-check

import Configuration from "../../../src/configuration.js"
import DatabaseRecord from "../../../src/database/record/index.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"
import Migration from "../../../src/database/migration/index.js"
import SingleMultiUsePool from "../../../src/database/pool/single-multi-use.js"
import SqliteDriver from "../../../src/database/drivers/sqlite/index.js"
import fs from "fs/promises"
import os from "os"
import path from "path"

class AuditOperationGuardSqliteDriver extends SqliteDriver {
  /**
   * Fails focused coverage instead of hanging if audit work escapes its operation lease.
   * @param {symbol | undefined} operationOwner - Candidate operation owner.
   * @returns {Promise<void>} - Resolves when access is operation-owned.
   */
  async _waitForOperationLease(operationOwner) {
    const operationLease = this._operationLease

    if (operationLease && operationOwner !== operationLease.owner) {
      throw new Error("AUDIT_QUERY_ESCAPED_OPERATION")
    }

    await super._waitForOperationLease(operationOwner)
  }
}

class OperationAuditedWidget extends DatabaseRecord {
  /** @returns {string} - Table name. */
  static tableName() { return "operation_audited_widgets" }
}

OperationAuditedWidget.audited()

describe("database - operation-scoped transactions - auditing", () => {
  it("resolves uncached audit schema through the record-owned connection", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-operation-auditing-"))
    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: AuditOperationGuardSqliteDriver,
            migrations: false,
            name: "operation-auditing",
            poolType: SingleMultiUsePool,
            schemaCache: false,
            type: "sqlite"
          }
        }
      },
      directory,
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    try {
      await configuration.withConnections(async (dbs) => {
        const migration = new Migration({configuration, databaseIdentifier: "default", db: dbs.default})

        await migration.createSharedAuditTables()
        await migration.createTable("operation_audited_widgets", (table) => {
          table.string("name")
          table.timestamps()
        })
        await OperationAuditedWidget.initializeRecord({configuration})
        dbs.default.clearSchemaCache()
      })

      await expect(async () => {
        await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
          await operation.forModel(OperationAuditedWidget).create({name: "rolled back audited widget"})
          throw new Error("ROLLBACK_AUDITED_OPERATION")
        })
      }).toThrowError("ROLLBACK_AUDITED_OPERATION")

      await configuration.withConnections(async (dbs) => {
        expect(await dbs.default.query("SELECT name FROM operation_audited_widgets")).toEqual([])
        expect(await dbs.default.query("SELECT auditable_type FROM audits WHERE auditable_type = 'OperationAuditedWidget'")).toEqual([])
      })

      await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
        await operation.forModel(OperationAuditedWidget).create({name: "committed audited widget"})
      })

      await configuration.withConnections(async (dbs) => {
        expect(await dbs.default.query("SELECT name FROM operation_audited_widgets")).toEqual([{name: "committed audited widget"}])
        expect(await dbs.default.query("SELECT auditable_type FROM audits WHERE auditable_type = 'OperationAuditedWidget'")).toEqual([{auditable_type: "OperationAuditedWidget"}])
      })
    } finally {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    }
  })
})
