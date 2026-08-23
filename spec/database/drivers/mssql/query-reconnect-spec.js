// @ts-check

import mssql from "mssql"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

describe("Database - drivers - mssql query reconnect", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("recreates requests after reconnecting", async () => {
    const originalRequest = mssql.Request
    let tries = 0

    class FakeRequest {
      constructor(connection) {
        this.connection = connection
      }

      async query() {
        tries += 1

        if (tries === 1) {
          throw new Error("No connection is specified for that request.")
        }

        return {recordsets: [[{connection: this.connection}]]}
      }
    }

    mssql.Request = FakeRequest

    try {
      const configuration = /** @type {any} */ ({
        debug: false,
        getCurrentRequestTiming: () => undefined,
        getQueryLoggingEnabled: () => false
      })
      const driver = new MssqlDriver({sqlConfig: {}}, configuration)
      driver.connection = undefined

      driver.connect = async () => {
        driver.connection = {connected: true}
      }

      const rows = await driver.query("SELECT 1")

      expect(tries).toBe(2)
      expect(rows[0].connection).toEqual(driver.connection)
    } finally {
      mssql.Request = originalRequest
    }
  })

  it("serializes concurrent requests on one physical session", async () => {
    const originalRequest = mssql.Request
    let activeRequests = 0
    let maxActiveRequests = 0
    /** @type {() => void} */
    let releaseFirstRequest = () => {}
    const firstRequestGate = new Promise((resolve) => { releaseFirstRequest = resolve })

    class FakeRequest {
      async query(sql) {
        activeRequests++
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests)

        try {
          if (activeRequests > 1) throw new Error("Requests can only be made in the LoggedIn state, not the SentClientRequest state")
          if (sql == "SELECT first") await firstRequestGate

          return {recordsets: [[{sql}]]}
        } finally {
          activeRequests--
        }
      }
    }

    mssql.Request = FakeRequest

    try {
      const configuration = /** @type {any} */ ({
        debug: false,
        getCurrentRequestTiming: () => undefined,
        getQueryLoggingEnabled: () => false
      })
      const driver = new MssqlDriver({sqlConfig: {}}, configuration)
      driver.connection = {connected: true}

      const firstQuery = driver.query("SELECT first")
      const secondQuery = driver.query("SELECT second")

      setImmediate(releaseFirstRequest)

      expect(await Promise.all([firstQuery, secondQuery])).toEqual([
        [{sql: "SELECT first"}],
        [{sql: "SELECT second"}]
      ])
      expect(maxActiveRequests).toEqual(1)
    } finally {
      releaseFirstRequest()
      mssql.Request = originalRequest
    }
  })

  it("serializes a replay query behind transaction rollback on the same session", async () => {
    const originalRequest = mssql.Request
    let activeRequests = 0
    /** @type {() => void} */
    let releaseRollback = () => {}
    const rollbackGate = new Promise((resolve) => { releaseRollback = resolve })
    /** @type {() => void} */
    let resolveRollbackStarted = () => {}
    const rollbackStarted = new Promise((resolve) => { resolveRollbackStarted = resolve })

    class FakeRequest {
      async query() {
        if (activeRequests > 0) throw new Error("Requests can only be made in the LoggedIn state, not the SentClientRequest state")

        return {recordsets: [[]]}
      }
    }

    mssql.Request = FakeRequest

    try {
      const configuration = /** @type {any} */ ({
        debug: false,
        getCurrentRequestTiming: () => undefined,
        getQueryLoggingEnabled: () => false
      })
      const driver = new MssqlDriver({sqlConfig: {}}, configuration)
      driver.connection = {connected: true}
      driver._currentTransaction = {
        async rollback() {
          activeRequests++
          resolveRollbackStarted()

          try {
            await rollbackGate
          } finally {
            activeRequests--
          }
        }
      }
      driver._transactionsCount = 1

      const rollback = driver.rollbackTransaction()

      await rollbackStarted

      const replayQuery = driver.query("SELECT * FROM websocket_replay_channels")

      setImmediate(releaseRollback)
      await Promise.all([rollback, replayQuery])

      expect(activeRequests).toEqual(0)
    } finally {
      releaseRollback()
      mssql.Request = originalRequest
    }
  })
})
