// @ts-check

import MysqlDriver from "../../../../src/database/drivers/mysql/index.js"
import {describe, expect, it} from "../../../../src/testing/test.js"

describe("Database - drivers - mysql reconnect", () => {
  it("connects when the pool is missing", async () => {
    const driver = new MysqlDriver({}, {debug: false})
    let didConnect = false

    driver.connect = async () => {
      didConnect = true
      driver.pool = {
        escape: (value) => `'${value}'`,
        query: (sql, callback) => {
          callback(null, [{result: 1}], [{name: "result"}])
        }
      }
    }

    const rows = await driver.query("SELECT 1")

    expect(didConnect).toBeTrue()
    expect(rows).toEqual([{result: 1}])
  })

  it("escapes values without a pool", () => {
    const driver = new MysqlDriver({}, {debug: false})

    const escaped = driver.escape("hello")
    const quoted = driver.quote("hello")

    expect(escaped).toEqual("hello")
    expect(quoted).toEqual("'hello'")
  })

  it("retries and reconnects after connection failures", async () => {
    const driver = new MysqlDriver({}, {debug: false})
    let connectCount = 0
    let closeCount = 0
    let attempts = 0

    driver.connect = async () => {
      connectCount++
      driver.pool = {
        escape: (value) => `'${value}'`,
        query: (sql, callback) => {
          attempts++

          if (attempts < 3) {
            callback(new Error("connect ECONNREFUSED 127.0.0.1:3306"))
          } else {
            callback(null, [{result: 1}], [{name: "result"}])
          }
        }
      }
    }

    driver.close = async () => {
      closeCount++
      driver.pool = undefined
    }

    const rows = await driver.query("SELECT 1")

    expect(rows).toEqual([{result: 1}])
    expect(attempts).toEqual(3)
    expect(connectCount).toEqual(3)
    expect(closeCount).toEqual(2)
  })
})
