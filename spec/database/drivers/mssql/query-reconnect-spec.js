// @ts-check

import mssql from "mssql"
import MssqlDriver from "../../../../src/database/drivers/mssql/index.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

describe("Database - drivers - mssql query reconnect", () => {
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
      const driver = new MssqlDriver({sqlConfig: {}}, {debug: false})
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
})
