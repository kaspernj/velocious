// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import Dummy from "../../dummy/index.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import SingleMultiUsePool from "../../../src/database/pool/single-multi-use.js"

describe("SingleMultiUsePool context handling", () => {
  it("releases held advisory locks only after the shared connection's final check-in", async () => {
    const lockName = "single-multi-use-final-checkin"

    await Dummy.run(async () => {
      const pool = new SingleMultiUsePool({configuration: dummyConfiguration, identifier: "default"})
      const firstCheckout = await pool.checkout()
      const secondCheckout = await pool.checkout()
      const probeConnection = await pool.spawnConnection()

      try {
        expect(firstCheckout).toBe(secondCheckout)
        expect(await firstCheckout.tryAcquireAdvisoryLock(lockName)).toBe(true)

        await pool.checkin(firstCheckout)

        expect(await probeConnection.tryAcquireAdvisoryLock(lockName)).toBe(false)

        await pool.checkin(secondCheckout)

        expect(await probeConnection.tryAcquireAdvisoryLock(lockName)).toBe(true)
      } finally {
        await firstCheckout.releaseAdvisoryLock(lockName)
        await probeConnection.releaseAdvisoryLock(lockName)
        await probeConnection.close()
        await pool.closeAll()
      }
    })
  })

  it("suppresses the shared current connection across async callbacks", async () => {
    await Dummy.run(async () => {
      const pool = dummyConfiguration.getDatabasePool("default")

      if (!(pool instanceof SingleMultiUsePool)) return

      const sharedConnection = pool.getCurrentConnection()
      let contextConnection
      let configurationConnectionCount = 0

      await dummyConfiguration.withoutCurrentConnectionContexts(async () => {
        await Promise.resolve()
        contextConnection = pool.getCurrentContextConnection()
        configurationConnectionCount = Object.keys(dummyConfiguration.getCurrentConnections()).length
      })

      expect(sharedConnection).toBeDefined()
      expect(contextConnection).toBeUndefined()
      expect(configurationConnectionCount).toEqual(0)
    })
  })
})
