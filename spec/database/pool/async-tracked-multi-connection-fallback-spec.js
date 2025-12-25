// @ts-check

import AsyncTrackedMultiConnection from "../../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../../src/configuration.js"
import NodeEnvironmentHandler from "../../../src/environment-handlers/node.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import fs from "fs/promises"
import path from "path"
import {afterEach, describe, expect, it} from "../../../src/testing/test.js"

/**
 * @typedef {{pool: AsyncTrackedMultiConnection, dbFilePath: string}} PoolContext
 */

/** @type {PoolContext[]} */
const poolsToCleanup = []

/**
 * @returns {Promise<PoolContext>}
 */
async function createPool() {
  const previousEnvironment = dummyConfiguration.getEnvironment()

  dummyConfiguration.setEnvironment("test")
  const baseDbConfig = {...dummyConfiguration.getDatabaseConfiguration().default}
  dummyConfiguration.setEnvironment(previousEnvironment)

  const dbName = `${baseDbConfig.name || "fallback"}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const configuration = new Configuration({
    database: {
      test: {
        default: {
          ...baseDbConfig,
          name: dbName,
          poolType: AsyncTrackedMultiConnection
        }
      }
    },
    directory: dummyConfiguration.getDirectory(),
    environment: "test",
    environmentHandler: new NodeEnvironmentHandler(),
    initializeModels: async () => {},
    locale: () => dummyConfiguration.getLocale(),
    localeFallbacks: dummyConfiguration.getLocaleFallbacks() || {en: ["en"]},
    locales: dummyConfiguration.getLocales()
  })

  const pool = /** @type {AsyncTrackedMultiConnection} */ (configuration.getDatabasePool("default"))
  const dbFilePath = path.join(configuration.getDirectory(), "db", `VelociousDatabaseDriversSqlite---${dbName}.sqlite`)

  return {pool, dbFilePath}
}

/**
 * @param {PoolContext} poolContext
 */
async function cleanupPool(/** @type {PoolContext} */ {pool, dbFilePath}) {
  const connections = new Set()

  const globalConn = pool.getGlobalConnection()

  if (globalConn) connections.add(globalConn)

  for (const conn of pool.connections) connections.add(conn)
  for (const conn of Object.values(pool.connectionsInUse)) connections.add(conn)

  for (const conn of connections) {
    if (conn && typeof conn.close === "function") {
      try {
        await conn.close()
      } catch {
        /* ignore */
      }
    }
  }

  await fs.rm(dbFilePath, {force: true})
}

describe("database - pool - async tracked multi connection", () => {
  afterEach(async () => {
    AsyncTrackedMultiConnection.clearGlobalConnections()

    for (const ctx of poolsToCleanup) {
      await cleanupPool(ctx)
    }

    poolsToCleanup.splice(0)
  })

  it("returns a global fallback connection when no async context has been set", async () => {
    const poolContext = await createPool()
    const {pool} = poolContext

    poolsToCleanup.push(poolContext)

    const fallbackConnection = await pool.ensureGlobalConnection()
    const currentConnection = pool.getCurrentConnection()

    expect(pool.connections.includes(fallbackConnection)).toBeTrue()
    expect(currentConnection).toBe(fallbackConnection)
  })

  it("prefers the async-context connection and falls back to the global connection outside the context", async () => {
    const poolContext = await createPool()
    const {pool} = poolContext

    poolsToCleanup.push(poolContext)

    const fallbackConnection = await pool.ensureGlobalConnection()
    const contextConnection = await pool.spawnConnection()

    pool.connections.unshift(contextConnection)

    await pool.withConnection(async () => {
      const currentConnection = pool.getCurrentConnection()

      expect(currentConnection).toBe(contextConnection)
    })

    const outsideConnection = pool.getCurrentConnection()

    expect(outsideConnection).toBe(fallbackConnection)
  })

  it("ensures a global connection is created when missing", async () => {
    const poolContext = await createPool()
    const {pool} = poolContext

    poolsToCleanup.push(poolContext)

    const connection = await pool.ensureGlobalConnection()

    expect(connection).toBe(pool.getGlobalConnection())
    expect(pool.connections.includes(connection)).toBeTrue()
  })

  it("does not replace an existing global connection when ensuring", async () => {
    const poolContext = await createPool()
    const {pool} = poolContext

    poolsToCleanup.push(poolContext)

    const existing = await pool.spawnConnection()

    pool.setGlobalConnection(existing)

    const connection = await pool.ensureGlobalConnection()

    expect(connection).toBe(existing)
    expect(pool.connections.includes(existing)).toBeTrue()
  })
})
