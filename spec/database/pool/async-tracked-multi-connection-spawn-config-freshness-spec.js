// @ts-check

import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import sha256Hex from "../../../src/utils/sha256-hex.js"
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
      let configurationResolutionCount = 0

      // Return a distinct physical configuration object on every resolution. Checkout may
      // refresh once after reaping, but the spawn configuration and reuse identity must both
      // come from that same exact captured object.
      pool.getConfiguration = () => {
        configurationResolutionCount++

        return {
          ...baseConfiguration,
          name: `${baseConfiguration.name}-resolution-${configurationResolutionCount}`,
          velociousSpawnFreshnessMarker: configurationResolutionCount
        }
      }

      /** @type {Array<unknown>} */
      const spawnedWithConfigurations = []
      const originalSpawnWithConfiguration = pool.spawnConnectionWithConfiguration.bind(pool)

      pool.spawnConnectionWithConfiguration = async (config) => {
        spawnedWithConfigurations.push(config)

        return await originalSpawnWithConfiguration(config)
      }

      let spawnedDatabaseIdentifier
      let spawnedDatabaseIdentityFingerprint
      let spawnedReuseKey

      await pool.withConnection(async (connection) => {
        spawnedDatabaseIdentifier = connection._databaseIdentifier
        spawnedDatabaseIdentityFingerprint = connection._databaseIdentityFingerprint
        spawnedReuseKey = pool.getConnectionConfigurationReuseKey(connection)
      })

      expect(spawnedWithConfigurations.length).toEqual(1)
      expect(spawnedWithConfigurations[0].velociousSpawnFreshnessMarker > 1).toBeTrue()
      expect(spawnedReuseKey).toEqual(pool.getConfigurationReuseKey(spawnedWithConfigurations[0]))
      expect(spawnedDatabaseIdentifier).toEqual("default")
      expect(spawnedDatabaseIdentityFingerprint).toEqual(`sha256:${sha256Hex(`database-configuration-reuse:v1\0${spawnedReuseKey}`)}`)
    } finally {
      await cleanup()
    }
  })
})
