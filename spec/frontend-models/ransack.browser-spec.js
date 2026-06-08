// @ts-check

import Configuration from "../../src/configuration.js"
import {describe, expect, it} from "../../src/testing/test.js"
import UserRecord from "../dummy/src/models/user.js"
import {configureRansackTransport, RansackUser, resetRansackTransport} from "./ransack-test-support.js"

/** @returns {boolean} - Whether browser HTTP integration is active. */
function shouldRunBrowserRansackSpec() {
  return process.env.VELOCIOUS_BROWSER_TESTS === "true"
}

/** @returns {Promise<void>} */
async function seedBrowserRansackUsers() {
  const backendConfig = /** @type {import("../../src/configuration.js").default} */ (globalThis.__velocious_browser_test_backend_configuration)

  await backendConfig.ensureConnections(async (dbs) => {
    await UserRecord.initializeRecord({configuration: backendConfig})
    await dbs.default.truncateAllTables()
    await UserRecord.create({
      createdAt: "2026-02-18T08:00:00.000Z",
      email: "jane@example.com",
      encryptedPassword: "password",
      reference: "browser-john-reference"
    })
    await UserRecord.create({
      createdAt: "2026-02-19T08:00:00.000Z",
      email: "john@example.com",
      encryptedPassword: "password",
      reference: "browser-user-2"
    })
  })

  await Configuration.current().ensureConnections(async () => {
    await UserRecord.initializeRecord({configuration: Configuration.current()})
  })
}

describe("Frontend model Ransack browser integration", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("counts and paginates grouped Ransack filters over browser HTTP", async () => {
    if (!shouldRunBrowserRansackSpec()) return

    const configuredPort = Number(process.env.VELOCIOUS_BROWSER_BACKEND_PORT)
    const backendPort = Number.isFinite(configuredPort) ? configuredPort : 4501

    configureRansackTransport(`http://127.0.0.1:${backendPort}`)

    try {
      await seedBrowserRansackUsers()

      const groupedCount = await RansackUser
        .ransack({
          c: [
            {a: ["email", "reference"], m: "or", p: "cont", v: ["john"]},
            {a: "reference", p: "cont", v: ["browser-user-2"]}
          ],
          m: "or"
        })
        .count()
      const groupedPage = await RansackUser
        .ransack({
          c: [
            {a: ["email", "reference"], m: "or", p: "cont", v: ["john"]},
            {a: "reference", p: "cont", v: ["browser-user-2"]}
          ],
          m: "or"
        })
        .sort([["email", "asc"]])
        .limit(1)
        .offset(1)
        .toArray()

      expect(groupedCount).toEqual(2)
      expect(groupedPage.map((user) => user.email())).toEqual(["john@example.com"])
    } finally {
      resetRansackTransport()
    }
  })
})
