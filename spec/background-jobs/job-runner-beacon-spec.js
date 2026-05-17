// @ts-check

import fs from "fs/promises"
import path from "path"
import {fileURLToPath, pathToFileURL} from "url"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"

import BeaconServer from "../../src/beacon/server.js"
import Configuration, {CurrentConfigurationNotSetError} from "../../src/configuration.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import runJobPayload from "../../src/background-jobs/job-runner.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @returns {string} - Repository root.
 */
function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
}

/**
 * @returns {Promise<{cleanup: () => Promise<void>, directory: string}>} - Temporary project.
 */
async function createTempProjectDir() {
  const directory = path.join(repoRoot(), "tmp", `job-runner-beacon-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await fs.mkdir(path.join(directory, "src", "jobs"), {recursive: true})
  await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))

  return {
    cleanup: async () => {
      await fs.rm(directory, {recursive: true, force: true})
    },
    directory
  }
}

/**
 * @param {string} directory - Temporary project directory.
 * @returns {Promise<void>}
 */
async function writeBroadcastJob(directory) {
  const jobPath = pathToFileURL(path.join(repoRoot(), "src", "background-jobs", "job.js")).href
  const configurationPath = pathToFileURL(path.join(repoRoot(), "src", "configuration.js")).href
  const contents = `import VelociousJob from ${JSON.stringify(jobPath)}
import Configuration from ${JSON.stringify(configurationPath)}

export default class BroadcastBuildLogJob extends VelociousJob {
  async perform() {
    Configuration.current().broadcastToChannel("frontend-models", {model: "BuildLog"}, {action: "create", id: "runner-log"})
  }
}
`

  await fs.writeFile(path.join(directory, "src", "jobs", "broadcast-build-log-job.js"), contents)
}

/**
 * @param {object} args - Options.
 * @param {import("../../src/configuration-types.js").BeaconConfiguration} args.beacon - Beacon configuration.
 * @param {string} args.directory - App directory.
 * @param {string} args.name - Database name.
 * @returns {Configuration}
 */
function createConfiguration({beacon, directory, name}) {
  return new Configuration({
    beacon,
    database: {
      test: {
        default: {
          driver: SqliteDriver,
          poolType: SingleMultiUsePool,
          type: "sqlite",
          name,
          migrations: false
        }
      }
    },
    directory,
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

/**
 * @returns {{matches: (broadcastParams: Record<string, unknown>) => boolean, sendMessage: (body: unknown) => void, isClosed: () => boolean, received: Array<unknown>, subscriptionId: string}}
 */
function makeSubscription() {
  /** @type {Array<unknown>} */
  const received = []

  return {
    isClosed: () => false,
    matches: (broadcastParams) => broadcastParams.model === "BuildLog",
    received,
    sendMessage: (body) => received.push(body),
    subscriptionId: `s-${Math.random().toString(36).slice(2)}`
  }
}

describe("Background jobs - runner Beacon", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("connects forked job runners to Beacon before performing jobs", async () => {
    const {cleanup, directory} = await createTempProjectDir()
    await writeBroadcastJob(directory)

    /** @type {Configuration | undefined} */
    let previousConfiguration

    try {
      previousConfiguration = Configuration.current()
    } catch (error) {
      if (!(error instanceof CurrentConfigurationNotSetError)) throw error
    }

    const beacon = new BeaconServer({
      configuration: createConfiguration({
        beacon: {host: "127.0.0.1", port: 0},
        directory,
        name: "job-runner-beacon-server"
      }),
      host: "127.0.0.1",
      port: 0
    })
    await beacon.start()

    const port = beacon.getPort()
    const subscriberConfiguration = createConfiguration({
      beacon: {host: "127.0.0.1", port},
      directory,
      name: "job-runner-beacon-subscriber"
    })
    const runnerConfiguration = createConfiguration({
      beacon: {host: "127.0.0.1", port},
      directory,
      name: "job-runner-beacon-runner"
    })
    const subscription = makeSubscription()

    try {
      subscriberConfiguration._registerWebsocketChannelSubscription("frontend-models", /** @type {any} */ (subscription))
      const subscriberClient = await subscriberConfiguration.connectBeacon({peerType: "subscriber"})
      await subscriberClient?.waitForReady({timeoutMs: 1000})

      runnerConfiguration.setCurrent()
      await runJobPayload({jobName: "BroadcastBuildLogJob", args: []})

      await timeout({timeout: 1000}, async () => {
        while (subscription.received.length === 0) await wait(0.01)
      })

      expect(subscription.received[0]).toEqual({action: "create", id: "runner-log"})
    } finally {
      previousConfiguration?.setCurrent()
      await runnerConfiguration.disconnectBeacon()
      await runnerConfiguration.closeDatabaseConnections()
      await subscriberConfiguration.disconnectBeacon()
      await subscriberConfiguration.closeDatabaseConnections()
      await beacon.stop()
      await cleanup()
    }
  })
})
