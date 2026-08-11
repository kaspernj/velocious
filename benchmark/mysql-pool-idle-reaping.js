// @ts-check

import { performance } from "node:perf_hooks"
import mysql from "mysql"
import Configuration from "../src/configuration.js"
import MysqlDriver from "../src/database/drivers/mysql/index.js"
import AsyncTrackedMultiConnection from "../src/database/pool/async-tracked-multi-connection.js"
import NodeEnvironmentHandler from "../src/environment-handlers/node.js"
import { runIdleReapingBenchmark, summarizeIdleReapingSamples } from "./support/mysql-pool-idle-reaping.js"

const idleTimeoutsMillis = [5000, 60000, null]
const rounds = Number(process.env.BENCHMARK_ROUNDS || 3)
const idleIntervalsMillis = Array.from({length: rounds}, () => [6000, 61000]).flat()
const maxConnections = Number(process.env.BENCHMARK_MAX_CONNECTIONS || 4)
const mysqlOptions = {
  database: process.env.MYSQL_DATABASE || "velocious_benchmark",
  host: process.env.MYSQL_HOST || "mariadb",
  password: process.env.MYSQL_PASSWORD || "benchmark",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "benchmark"
}

/** @returns {Configuration} - Isolated benchmark configuration. */
function createConfiguration() {
  return new Configuration({
    database: {
      benchmark: {
        default: {
          ...mysqlOptions,
          driver: MysqlDriver,
          migrations: false,
          pool: {idleTimeoutMillis: null, max: maxConnections},
          poolType: AsyncTrackedMultiConnection,
          type: "mysql",
          username: mysqlOptions.user
        }
      }
    },
    environment: "benchmark",
    environmentHandler: new NodeEnvironmentHandler(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

/**
 * Reads global status through a persistent observer connection so the observation
 * itself does not add a new server thread to every sample.
 * @param {import("mysql").Pool} observerPool - Dedicated observer pool.
 * @returns {Promise<import("./support/mysql-pool-idle-reaping.js").ServerMetrics>} - Metrics, or null fields when access is denied.
 */
async function readServerMetrics(observerPool) {
  try {
    const rows = await new Promise((resolve, reject) => {
      observerPool.query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected', 'Threads_created')", (error, result) => {
        if (error) reject(error)
        else resolve(result)
      })
    })
    const values = Object.fromEntries(
      /** @type {Array<{Variable_name: string, Value: string}>} */ (rows)
        .map(({Variable_name, Value}) => [Variable_name, Number(Value)])
    )

    return {
      threadsConnected: Number.isFinite(values.Threads_connected) ? values.Threads_connected : null,
      threadsCreated: Number.isFinite(values.Threads_created) ? values.Threads_created : null
    }
  } catch (error) {
    console.warn(`MySQL global status unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return {threadsConnected: null, threadsCreated: null}
  }
}

/** @param {import("mysql").Pool} pool - MySQL pool. @returns {Promise<void>} - Resolves after shutdown. */
async function closeMysqlPool(pool) {
  await new Promise((resolve, reject) => pool.end((error) => error ? reject(error) : resolve(undefined)))
}

/**
 * Saturates the configured cap, then measures one queued checkout released by a holder.
 * @param {AsyncTrackedMultiConnection} pool - Prepared benchmark pool.
 * @returns {Promise<number>} - Queue wait in milliseconds.
 */
async function measureCheckoutWaitUnderCap(pool) {
  const holders = await Promise.all(Array.from({length: maxConnections}, async () => await pool.checkout()))
  const startedAt = performance.now()
  const queuedCheckout = pool.checkout()

  await new Promise((resolve) => setTimeout(resolve, 25))
  const releasedHolder = holders.pop()
  if (!releasedHolder) throw new Error("Expected a checkout holder")
  await pool.checkin(releasedHolder)
  const queuedConnection = await queuedCheckout
  const waitedForMs = performance.now() - startedAt

  await pool.checkin(queuedConnection)
  for (const holder of holders) await pool.checkin(holder)

  return waitedForMs
}

const observerPool = mysql.createPool({...mysqlOptions, connectionLimit: 1, timezone: "Z"})
/** @type {Configuration | undefined} */
let configuration
/** @type {AsyncTrackedMultiConnection | undefined} */
let pool

try {
  const samples = await runIdleReapingBenchmark({
    idleIntervalsMillis,
    idleTimeoutsMillis,
    prepare: async (idleTimeoutMillis) => {
      if (configuration) await configuration.closeDatabaseConnections()
      configuration = createConfiguration()
      configuration.getDatabaseConfiguration().default.pool = {idleTimeoutMillis, max: maxConnections}
      const candidatePool = configuration.getDatabasePool("default")
      if (!(candidatePool instanceof AsyncTrackedMultiConnection)) throw new Error("Expected AsyncTrackedMultiConnection")
      pool = candidatePool
      await pool.withConnection(async (connection) => { await connection.query("SELECT 1") })
      return await readServerMetrics(observerPool)
    },
    sample: async () => {
      if (!pool) throw new Error("Benchmark pool was not prepared")
      const startedAt = performance.now()
      const connection = await pool.checkout()
      let firstQueryMs

      try {
        await connection.query("SELECT 1")
        firstQueryMs = performance.now() - startedAt
      } finally {
        await pool.checkin(connection)
      }

      return {
        checkoutWaitMs: await measureCheckoutWaitUnderCap(pool),
        firstQueryMs,
        idleReapDisposalCount: pool.getDebugSnapshot().telemetry?.idleReapDisposalCount || 0,
        serverMetrics: await readServerMetrics(observerPool)
      }
    },
    sleep: async (milliseconds) => { await new Promise((resolve) => setTimeout(resolve, milliseconds)) }
  })

  console.log(`Node ${process.version}; max=${maxConnections}; rounds=${rounds}; idle schedule=${idleIntervalsMillis.join(",")}ms`)
  console.table(summarizeIdleReapingSamples(samples))
} finally {
  if (configuration) await configuration.closeDatabaseConnections()
  await closeMysqlPool(observerPool)
}
