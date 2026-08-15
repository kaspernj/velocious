// @ts-check

import path from "node:path"
import {fileURLToPath} from "node:url"
import initSqlJs from "sql.js"

import LocalBackgroundJobsStore from "../../src/background-jobs/local-store.js"
import Configuration from "../../src/configuration.js"
import ConnectionSqlJs from "../../src/database/drivers/sqlite/connection-sql-js.js"
import SqliteWebDriver from "../../src/database/drivers/sqlite/index.web.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import BrowserEnvironmentHandler from "../../src/environment-handlers/browser.js"
import {describe, expect, it} from "../../src/testing/test.js"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
/** @type {Map<string, Uint8Array>} */
const persistedDatabases = new Map()
/** @type {import("sql.js").SqlJsStatic | undefined} */
let SQL

/** Test driver retaining production ConnectionSqlJs persistence semantics across configurations. */
class PersistentLocalJobsSqliteWebDriver extends SqliteWebDriver {
  /** @returns {Promise<void>} - Resolves after restoring persisted SQL.js bytes. */
  async connect() {
    this.args = this.getArgs()
    SQL ||= await initSqlJs({locateFile: (file) => path.join(projectRoot, "node_modules/sql.js/dist", file)})

    const databaseName = this.databaseName()
    const bytes = persistedDatabases.get(databaseName)
    const persistence = {
      name: /** @type {"localstorage"} */ ("localstorage"),
      delete: async () => { persistedDatabases.delete(databaseName) },
      load: async () => persistedDatabases.get(databaseName),
      save: async (content) => { persistedDatabases.set(databaseName, new Uint8Array(content)) }
    }

    this._connection = new ConnectionSqlJs(this, new SQL.Database(bytes), persistence)
  }
}

/** @param {string} databaseName - Persisted database name. @returns {Configuration} - Isolated browser configuration. */
function buildConfiguration(databaseName) {
  return new Configuration({
    backgroundJobs: {databaseIdentifier: "default", jobClasses: []},
    database: {
      test: {
        default: {
          driver: PersistentLocalJobsSqliteWebDriver,
          migrations: false,
          name: databaseName,
          poolType: SingleMultiUsePool,
          type: "sqlite"
        }
      }
    },
    directory: projectRoot,
    environment: "test",
    environmentHandler: new BrowserEnvironmentHandler(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

describe("Local background jobs store - SQL.js persistence", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("retains queued local jobs across a configured SQL.js persistence reopen", async () => {
    const databaseName = `local-background-jobs-persistence-${Date.now()}`
    const firstConfiguration = buildConfiguration(databaseName)
    const firstStore = new LocalBackgroundJobsStore({configuration: firstConfiguration})
    let secondConfiguration

    try {
      const jobId = await firstStore.enqueue({jobName: "PersistedLocalJob", args: ["saved"]})

      await firstConfiguration.closeDatabaseConnections()

      secondConfiguration = buildConfiguration(databaseName)

      const reopenedStore = new LocalBackgroundJobsStore({configuration: secondConfiguration})
      const reopenedJob = await reopenedStore.getJob(jobId)

      expect(reopenedJob?.status).toEqual("queued")
      expect(reopenedJob?.args).toEqual(["saved"])
    } finally {
      await firstConfiguration.closeDatabaseConnections()
      if (secondConfiguration) await secondConfiguration.closeDatabaseConnections()
      persistedDatabases.delete(databaseName)
    }
  })
})
