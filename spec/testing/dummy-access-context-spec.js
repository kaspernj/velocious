// @ts-check

import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../src/testing/test.js"

class ObservedDummy extends Dummy {
  /** @type {Record<string, import("../../src/database/drivers/base.js").default>} */
  startupConnections = {}
  /** @type {{revoked: boolean} | undefined} */
  startupScope

  async start() {
    this.startupConnections = dummyConfiguration.getCurrentConnections()
    this.startupScope = dummyConfiguration.getEnvironmentHandler().currentTestDatabaseAccessScope()
  }
}

describe("Dummy access context", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("starts persistent infrastructure outside the caller's database and revocable access contexts", async () => {
    const dummy = new ObservedDummy()
    const accessScope = {revoked: false}
    /** @type {Record<string, import("../../src/database/drivers/base.js").default>} */
    let callbackConnections = {}
    /** @type {{revoked: boolean} | undefined} */
    let callbackScope
    /** @type {Record<string, import("../../src/database/drivers/base.js").default>} */
    let callerConnections = {}

    await dummyConfiguration.ensureConnections(async (connections) => {
      callerConnections = connections
      await dummyConfiguration.runWithTestDatabaseAccessScope(accessScope, async () => {
        await dummy.run(async () => {
          callbackConnections = dummyConfiguration.getCurrentConnections()
          callbackScope = dummyConfiguration.getEnvironmentHandler().currentTestDatabaseAccessScope()
        })
      })
    })

    expect(dummy.startupConnections).toEqual({})
    expect(dummy.startupScope).toBeUndefined()
    expect(callbackConnections.default).toBe(callerConnections.default)
    expect(callbackScope).toBe(accessScope)
  })
})
