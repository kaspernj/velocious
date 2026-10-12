// @ts-check

import DatabaseDriverBase from "../../../src/database/drivers/base.js"
import MysqlDriver from "../../../src/database/drivers/mysql/index.js"
import NodeEnvironmentHandler from "../../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../../src/testing/test.js"

const TRANSIENT_CODE = "ER_TEST_TRANSIENT_SCHEMA_METADATA"

class DdlRetryTestDriver extends DatabaseDriverBase {
  /** @type {number} */
  metadataAttempts = 0

  /** @type {number} */
  transientFailuresRemaining = 0

  /** @type {boolean} */
  alwaysTransient = false

  async connect() {}

  /** @returns {string} - Driver type. */
  getType() { return "test" }

  /** @returns {string} - Primary key type. */
  primaryKeyType() { return "bigint" }

  /** @returns {string} - Query SQL. */
  queryToSql() { return "" }

  /**
   * @param {string} _sql - SQL string.
   * @returns {Promise<import("../../../src/database/drivers/base.js").QueryResultType>} - Query result.
   */
  async _queryActual(_sql) {
    return []
  }

  /**
   * @param {Error} error - Error to classify.
   * @returns {boolean} - Whether this test driver treats the sentinel code as transient.
   */
  _isTransientSchemaMetadataError(error) {
    return /** @type {{code?: string}} */ (error).code === TRANSIENT_CODE
  }

  /**
   * Reads cached metadata while failing the first N attempts with the transient code.
   * @param {object} args - Options.
   * @param {number} args.transientFailures - Failures to raise before succeeding.
   * @param {boolean} [args.alwaysTransient] - Keep failing forever when true.
   * @returns {Promise<string[]>} - Resolves with the metadata rows.
   */
  async readMetadataWithFailures({transientFailures, alwaysTransient = false}) {
    this.metadataAttempts = 0
    this.transientFailuresRemaining = transientFailures
    this.alwaysTransient = alwaysTransient

    return await this._cachedSchemaMetadata("tables", async () => {
      this.metadataAttempts++

      if (alwaysTransient || this.transientFailuresRemaining > 0) {
        this.transientFailuresRemaining--
        const error = /** @type {Error & {code: string}} */ (new Error("metadata read skipped by concurrent DDL"))
        error.code = TRANSIENT_CODE
        throw error
      }

      return ["row"]
    })
  }
}

/**
 * @param {Record<string, unknown>} driverArgs - Driver arguments.
 * @returns {DdlRetryTestDriver} - Driver instance.
 */
function buildDriver(driverArgs) {
  const environmentHandler = new NodeEnvironmentHandler()
  // Narrows this deliberately minimal driver-test boundary to the framework
  // configuration contract after binding its owning environment handler.
  const configuration = /** @type {import("../../../src/configuration.js").default} */ (/** @type {unknown} */ ({
    getEnvironment() {
      return "test"
    },
    getEnvironmentHandler() {
      return environmentHandler
    },
    getSchemaCacheReuseKey() {
      return undefined
    },
    getTestMode() {
      return false
    }
  }))

  return new DdlRetryTestDriver(Object.assign({configuration}, driverArgs))
}

describe("database driver schema-metadata DDL retry", () => {
  it("retries a transient schema-metadata read until it succeeds", async () => {
    const driver = buildDriver({schemaMetadataRetryDeadlineMs: 2000})

    const rows = await driver.readMetadataWithFailures({transientFailures: 2})

    expect(rows).toEqual(["row"])
    expect(driver.metadataAttempts).toEqual(3)
  })

  it("does not retry a non-transient schema-metadata failure", async () => {
    const driver = buildDriver({schemaMetadataRetryDeadlineMs: 2000})

    await expect(async () => {
      await driver._cachedSchemaMetadata("tables", async () => {
        driver.metadataAttempts++
        throw new Error("real schema error")
      })
    }).toThrow(/real schema error/)

    expect(driver.metadataAttempts).toEqual(1)
  })

  it("rethrows after the retry deadline when the DDL conflict never clears", async () => {
    const driver = buildDriver({schemaMetadataRetryDeadlineMs: 1000})

    await expect(async () => {
      await driver.readMetadataWithFailures({transientFailures: 0, alwaysTransient: true})
    }).toThrow(/metadata read skipped by concurrent DDL/)

    expect(driver.metadataAttempts).toBeGreaterThan(1)
    expect(driver.metadataAttempts).toBeLessThan(100)
  })

  it("classifies MariaDB concurrent-DDL metadata skips as transient", () => {
    const driver = new MysqlDriver({host: "127.0.0.1"})

    const skipped = new Error("Query failed: Query failed because of Error: Table was skipped: SHOW FULL COLUMNS", {
      cause: new Error("Query failed because of Error: Table was skipped: SHOW FULL COLUMNS", {
        cause: Object.assign(new Error("Table was skipped"), {code: "ER_WARN_I_S_SKIPPED_TABLE"})
      })
    })

    expect(driver._isTransientSchemaMetadataError(skipped)).toEqual(true)
    expect(driver._isTransientSchemaMetadataError(new Error("Query failed: other"))).toEqual(false)
  })
})
