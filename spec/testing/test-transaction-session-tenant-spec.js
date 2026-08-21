// @ts-check

import TestTransactionSession from "../../src/testing/test-transaction-session.js"
import { createTenantTestConfiguration, readTenantValue, seedTenantValue } from "../helpers/tenant-test-helpers.js"
import { fork } from "node:child_process"

/** @param {import("node:child_process").ChildProcess} child - IPC child. */
function nextChildMessage(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("message", resolve)
  })
}

describe("Test transaction session tenant enrollment", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("shares a lazily enrolled tenant connection with in-process request work and rolls it back", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-test-transaction-session")
    await seedTenantValue(configuration, "projectTenant", "alpha", "committed")
    const session = await TestTransactionSession.begin({configuration})

    try {
      await session.enrollDatabase({databaseIdentifier: "projectTenant", tenant: {slug: "alpha"}})
      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.getDatabasePool("projectTenant").runWithTestSharedConnection(async () => {
          await configuration.ensureConnections({databaseIdentifiers: ["projectTenant"]}, async (dbs) => {
            await dbs.projectTenant.query("UPDATE tenant_values SET value = 'in-session'")
          })
        })
      })
      const inSession = await configuration.runWithTenant({slug: "alpha"}, async () => {
        return await configuration.getDatabasePool("projectTenant").runWithTestSharedConnection(async () => {
          return await readTenantValue(configuration, "projectTenant", "alpha")
        })
      })
      expect(inSession).toEqual("in-session")
      await session.cleanup()
      expect(await readTenantValue(configuration, "projectTenant", "alpha")).toEqual("committed")
    } finally {
      await session.cleanup()
      await cleanup()
    }
  })

  it("propagates an ephemeral join to an already-running external backend", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-external-test-transaction-session")
    await seedTenantValue(configuration, "projectTenant", "alpha", "committed")
    const child = fork(new URL("../helpers/test-transaction-session-backend-child.js", import.meta.url), {stdio: ["ignore", "ignore", "ignore", "ipc"]})
    await nextChildMessage(child)
    const session = await TestTransactionSession.begin({configuration})

    try {
      await session.enrollDatabase({databaseIdentifier: "projectTenant", tenant: {slug: "alpha"}})
      const pool = configuration.getDatabasePool("projectTenant")
      const reuseKey = pool.getConfigurationReuseKey(configuration.resolveDatabaseConfiguration("projectTenant", {slug: "alpha"}))
      child.send({
        type: "join",
        databaseIdentifier: "projectTenant",
        reuseKey,
        session: session.joinMessage(),
        sql: "UPDATE tenant_values SET value = 'external'"
      })
      expect(await nextChildMessage(child)).toEqual({type: "completed"})
      await session.cleanup()
      expect(await readTenantValue(configuration, "projectTenant", "alpha")).toEqual("committed")
    } finally {
      await session.cleanup()
      child.kill()
      await cleanup()
    }
  })
})
