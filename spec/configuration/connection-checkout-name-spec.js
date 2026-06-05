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

      await dummyConfiguration.withConnections({name: "configuration spec checkout"}, async (dbs) => {
        checkedOutConnection = dbs.default

        expect(checkedOutConnection._connectionCheckoutName).toBe("configuration spec checkout")
      })

      expect(checkedOutConnection?._connectionCheckoutName).toBeUndefined()
    }, {fresh: true})
  })

  it("sets and clears names for direct pool checkouts", async () => {
    await Dummy.run(async () => {
      const pool = getDefaultPool()

      if (!pool) return

      /** @type {import("../../src/database/drivers/base.js").default | undefined} */
      let checkedOutConnection

      await pool.withConnection({name: "pool spec checkout"}, async (db) => {
        checkedOutConnection = db

        expect(db._connectionCheckoutName).toBe("pool spec checkout")
      })

      expect(checkedOutConnection?._connectionCheckoutName).toBeUndefined()
    }, {fresh: true})
  })

  it("clears names when direct checkouts are checked in", async () => {
    await Dummy.run(async () => {
      const pool = getDefaultPool()

      if (!pool) return

      const connection = await pool.checkout({name: "direct checkout spec"})

      expect(connection._connectionCheckoutName).toBe("direct checkout spec")

      await pool.checkin(connection)

      expect(connection._connectionCheckoutName).toBeUndefined()
    }, {fresh: true})
  })
})
