// @ts-check

import Configuration from "../../src/configuration.js"
import MssqlDriver from "../../src/database/drivers/mssql/index.js"
import MysqlDriver from "../../src/database/drivers/mysql/index.js"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import { createSharedTransactionProxyDriver } from "../../src/testing/shared-transaction-proxy-driver.js"
import SharedTransactionBroker from "../../src/testing/shared-transaction-broker.js"

describe("Shared transaction proxy checkout cleanup", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("keeps the broker transport usable across inherited MySQL checkout cleanup", async () => {
    const configuration = new Configuration({database: {test: {}}, environmentHandler: new NodeEnvironmentHandler()})
    const broker = await SharedTransactionBroker.start({connections: {default: {query: async (sql) => `broker:${sql}`}}})
    const proxy = createSharedTransactionProxyDriver(MysqlDriver, {type: "mysql"}, configuration, "default", {address: broker.address(), capability: broker.capability()})
    await proxy.connect()

    try {
      await proxy.cleanupSessionStateAfterCheckout()

      expect(await proxy.sharedTransactionClient.call("query", ["after checkout"])).toEqual("broker:after checkout")
    } finally {
      await proxy.close()
      await broker.close()
    }
  })

  it("uses the broker session for MS-SQL advisory locks", async () => {
    const configuration = new Configuration({database: {test: {}}, environmentHandler: new NodeEnvironmentHandler()})
    /** @type {string[]} */
    const queries = []
    const connection = {
      _queryActual: async (/** @type {string} */ sql) => {
        queries.push(sql)

        return [{velocious_advisory_lock_result: 0}]
      }
    }
    const broker = await SharedTransactionBroker.start({connections: {default: connection}})
    const proxy = createSharedTransactionProxyDriver(MssqlDriver, {type: "mssql"}, configuration, "default", {address: broker.address(), capability: broker.capability()})
    await proxy.connect()

    try {
      expect(await proxy.acquireAdvisoryLock("attachment-schema")).toEqual(true)
      expect(await proxy.releaseAdvisoryLock("attachment-schema")).toEqual(true)
      expect(queries).toHaveLength(2)
      expect(queries[0]).toContain("sp_getapplock")
      expect(queries[1]).toContain("sp_releaseapplock")
    } finally {
      await proxy.close()
      await broker.close()
    }
  })
})
