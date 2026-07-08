// @ts-check

import timeout from "awaitery/build/timeout.js"

import VelociousDatabaseRecord, {AdvisoryLockHoldTimeoutError} from "../../../src/database/record/index.js"

describe("Record - advisory lock hold timeout", () => {
  it("returns the callback value when it settles within the hold timeout", async () => {
    const result = await VelociousDatabaseRecord.runWithAdvisoryLockHoldTimeout("lock-name", async () => "done", 1000)

    expect(result).toEqual("done")
  })

  it("does not apply a timeout when holdTimeoutMs is falsy", async () => {
    const result = await VelociousDatabaseRecord.runWithAdvisoryLockHoldTimeout("lock-name", async () => "ok", 0)

    expect(result).toEqual("ok")
  })

  it("rejects with AdvisoryLockHoldTimeoutError when the callback outlives the hold timeout", async () => {
    const neverSettles = () => new Promise(() => {})
    let thrown

    try {
      await VelociousDatabaseRecord.runWithAdvisoryLockHoldTimeout("lock-name", neverSettles, 20)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AdvisoryLockHoldTimeoutError)
  })

  it("uses a dedicated advisory-lock connection without replacing the callback connection", async () => {
    const events = []
    const appConnection = {
      async releaseAdvisoryLock() {
        events.push("app release")

        return true
      },

      async tryAcquireAdvisoryLock() {
        events.push("app acquire")

        return true
      }
    }
    const lockConnection = {
      async close() {
        events.push("lock close")
      },

      getArgs() {
        return {}
      },

      async releaseAdvisoryLock(name) {
        events.push(`lock release ${name}`)

        return true
      },

      async tryAcquireAdvisoryLock(name) {
        events.push(`lock acquire ${name}`)

        return true
      }
    }
    const lockPool = {
      async spawnConnection() {
        events.push("spawn lock connection")

        return /** @type {import("../../../src/database/drivers/base.js").default} */ (lockConnection)
      }
    }
    const configuration = {
      getDatabasePool(identifier) {
        events.push(`pool ${identifier}`)

        return /** @type {import("../../../src/database/pool/base.js").default} */ (lockPool)
      }
    }
    class DedicatedConnectionRecord extends VelociousDatabaseRecord {
      static async ensureInitialized() {}

      static _getConfiguration() {
        return /** @type {import("../../../src/configuration.js").default} */ (configuration)
      }

      static connection() {
        return /** @type {import("../../../src/database/drivers/base.js").default} */ (appConnection)
      }

      static getDatabaseIdentifier() {
        return "default"
      }
    }

    const result = await DedicatedConnectionRecord.withAdvisoryLockOrFail("dedicated-lock", async () => {
      events.push(DedicatedConnectionRecord.connection() === appConnection ? "callback app connection" : "callback lock connection")

      return "done"
    })

    expect(result).toEqual("done")
    expect(events).toEqual([
      "pool default",
      "spawn lock connection",
      "lock acquire dedicated-lock",
      "callback app connection",
      "lock release dedicated-lock",
      "lock close"
    ])
  })

  it("does not close externally-owned advisory-lock connections", async () => {
    const events = []
    const externalConnection = {}
    const lockConnection = {
      async close() {
        events.push("lock close")
      },

      getArgs() {
        return {
          getConnection: () => externalConnection
        }
      },

      async releaseAdvisoryLock(name) {
        events.push(`lock release ${name}`)

        return true
      },

      async tryAcquireAdvisoryLock(name) {
        events.push(`lock acquire ${name}`)

        return true
      }
    }
    const lockPool = {
      async spawnConnection() {
        events.push("spawn lock connection")

        return /** @type {import("../../../src/database/drivers/base.js").default} */ (lockConnection)
      }
    }
    const configuration = {
      getDatabasePool(identifier) {
        events.push(`pool ${identifier}`)

        return /** @type {import("../../../src/database/pool/base.js").default} */ (lockPool)
      }
    }
    class ExternallyOwnedConnectionRecord extends VelociousDatabaseRecord {
      static async ensureInitialized() {}

      static _getConfiguration() {
        return /** @type {import("../../../src/configuration.js").default} */ (configuration)
      }

      static getDatabaseIdentifier() {
        return "default"
      }
    }

    const result = await ExternallyOwnedConnectionRecord.withAdvisoryLockOrFail("shared-lock", async () => "done")

    expect(result).toEqual("done")
    expect(events).toEqual([
      "pool default",
      "spawn lock connection",
      "lock acquire shared-lock",
      "lock release shared-lock"
    ])
  })

  it("releases a hold-timed-out lock through the dedicated advisory-lock connection", async () => {
    const neverSettles = () => new Promise(() => {})
    const events = []
    const appConnection = {
      async releaseAdvisoryLock() {
        await neverSettles()

        return true
      },

      async tryAcquireAdvisoryLock() {
        throw new Error("App connection must not acquire advisory locks")
      }
    }
    const lockConnection = {
      async close() {
        events.push("lock close")
      },

      getArgs() {
        return {}
      },

      async releaseAdvisoryLock(name) {
        events.push(`lock release ${name}`)

        return true
      },

      async tryAcquireAdvisoryLock(name) {
        events.push(`lock acquire ${name}`)

        return true
      }
    }
    const lockPool = {
      async spawnConnection() {
        events.push("spawn lock connection")

        return /** @type {import("../../../src/database/drivers/base.js").default} */ (lockConnection)
      }
    }
    const configuration = {
      getDatabasePool(identifier) {
        events.push(`pool ${identifier}`)

        return /** @type {import("../../../src/database/pool/base.js").default} */ (lockPool)
      }
    }
    class DedicatedConnectionRecord extends VelociousDatabaseRecord {
      static async ensureInitialized() {}

      static _getConfiguration() {
        return /** @type {import("../../../src/configuration.js").default} */ (configuration)
      }

      static connection() {
        return /** @type {import("../../../src/database/drivers/base.js").default} */ (appConnection)
      }

      static getDatabaseIdentifier() {
        return "default"
      }
    }
    let thrown

    try {
      await timeout({timeout: 1000}, async () => {
        await DedicatedConnectionRecord.withAdvisoryLockOrFail("timed-out-lock", neverSettles, {holdTimeoutMs: 50})
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AdvisoryLockHoldTimeoutError)
    expect(events).toEqual([
      "pool default",
      "spawn lock connection",
      "lock acquire timed-out-lock",
      "lock release timed-out-lock",
      "lock close"
    ])
  })

})
