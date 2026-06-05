// @ts-check

import AsyncTrackedMultiConnection from "../../src/database/pool/async-tracked-multi-connection.js"
import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {describe, expect, it} from "../../src/testing/test.js"

/** @returns {AsyncTrackedMultiConnection | null} */
function getDefaultPool() {
  const pool = dummyConfiguration.getDatabasePool("default")

  if (!(pool instanceof AsyncTrackedMultiConnection)) return null

  return pool
}

describe("connection checkout names", () => {
  it("sets and clears names for configuration connection scopes", async () => {
    await Dummy.run(async () => {
      /** @type {import("../../src/database/drivers/base.js").default | undefined} */
      let checkedOutConnection

      await dummyConfiguration.withConnections(async (dbs) => {
        checkedOutConnection = dbs.default

        expect(checkedOutConnection.getConnectionCheckoutName()).toBe("configuration spec checkout")
      }, {name: "configuration spec checkout"})

      expect(checkedOutConnection?.getConnectionCheckoutName()).toBeUndefined()
    }, {fresh: true})
  })

  it("sets and clears names for direct pool checkouts", async () => {
    await Dummy.run(async () => {
      const pool = getDefaultPool()

      if (!pool) return

      /** @type {import("../../src/database/drivers/base.js").default | undefined} */
      let checkedOutConnection

      await pool.withConnection(async (db) => {
        checkedOutConnection = db

        expect(db.getConnectionCheckoutName()).toBe("pool spec checkout")
      }, {name: "pool spec checkout"})

      expect(checkedOutConnection?.getConnectionCheckoutName()).toBeUndefined()
    }, {fresh: true})
  })
})
