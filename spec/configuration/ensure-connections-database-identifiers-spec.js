// @ts-check

import {ConnectionCountingSqliteDriver, createMultiDatabaseConfiguration} from "../helpers/selective-connections-helper.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("Configuration connection database identifiers", () => {
  it("checks out only requested identifiers through withConnections", async () => {
    const {cleanup, configuration} = await createMultiDatabaseConfiguration()

    try {
      await configuration.withConnections({databaseIdentifiers: ["default"]}, async (dbs) => {
        expect(Object.keys(dbs)).toEqual(["default"])
      })

      expect(ConnectionCountingSqliteDriver.connectionAttempts).toEqual(0)
    } finally {
      await cleanup()
    }
  })

  it("checks out only requested database identifiers", async () => {
    const {cleanup, configuration} = await createMultiDatabaseConfiguration()

    try {
      await configuration.ensureConnections({databaseIdentifiers: ["default"]}, async (dbs) => {
        expect(Object.keys(dbs)).toEqual(["default"])
        await dbs.default.query("SELECT 1")
      })

      expect(ConnectionCountingSqliteDriver.connectionAttempts).toEqual(0)
    } finally {
      await cleanup()
    }
  })

  it("returns only requested connections when reusing an existing scope", async () => {
    const {cleanup, configuration} = await createMultiDatabaseConfiguration()

    try {
      await configuration.withConnections(async (outerDbs) => {
        await configuration.ensureConnections({databaseIdentifiers: ["default"]}, async (dbs) => {
          expect(Object.keys(dbs)).toEqual(["default"])
          expect(dbs.default).toBe(outerDbs.default)
        })
      })
    } finally {
      await cleanup()
    }
  })
})
