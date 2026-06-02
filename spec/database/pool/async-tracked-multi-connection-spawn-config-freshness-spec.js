// @ts-check

import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import {createTenantTestConfiguration} from "../../helpers/tenant-test-helpers.js"
import {describe, expect, it} from "../../../src/testing/test.js"

// Regression test for a per-request isolation bug: checkout() used to capture the
// tenant-resolved database configuration at the very top of the method and then reuse
// that captured value to spawn a connection AFTER `await reapIdleConnections()`. If the
// resolved configuration changed across that await boundary, the connection was bound to
// a stale database/tenant, which broke per-request isolation (observed as test-truncation
// appearing not to take effect against multi-database backends). checkout() must resolve
// the configuration fresh at spawn time for the immediate (non-queued) spawn path.
describe("database - pool - async tracked multi connection spawn config freshness", () => {
  it("spawns the immediate checkout connection with the configuration resolved at spawn time, not one captured before reaping", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("pool-spawn-config-freshness")

    try {
      const pool = configuration.getDatabasePool("default")

      if (!(pool instanceof AsyncTrackedMultiConnection)) return

      // Force the spawn path: no idle connection is available to reuse.
      pool.connections = []

      const baseConfiguration = pool.getConfiguration()
      const spawnTimeConfiguration = {...baseConfiguration, velociousSpawnFreshnessMarker: "spawn-time"}
      let configurationHasChanged = false

      // Resolve to the base config until the reap-await boundary, then to the spawn-time
      // config. The connection must be spawned with the spawn-time configuration.
      pool.getConfiguration = () => (configurationHasChanged ? spawnTimeConfiguration : baseConfiguration)

      // Flip the resolved configuration during the awaited reap that checkout() performs
      // before it spawns. The old code captured the configuration before this ran.
      const originalReapIdleConnections = pool.reapIdleConnections.bind(pool)

      pool.reapIdleConnections = async () => {
        configurationHasChanged = true

        return await originalReapIdleConnections()
      }

      /** @type {Array<unknown>} */
      const spawnedWithConfigurations = []
      const originalSpawnWithConfiguration = pool.spawnConnectionWithConfiguration.bind(pool)

      pool.spawnConnectionWithConfiguration = async (config) => {
        spawnedWithConfigurations.push(config)

        return await originalSpawnWithConfiguration(config)
      }

      await pool.withConnection(async () => {})

      expect(spawnedWithConfigurations.length).toEqual(1)
      expect(spawnedWithConfigurations[0]).toEqual(spawnTimeConfiguration)
    } finally {
      await cleanup()
    }
  })
})
