// @ts-check

import fs from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"
import Configuration, {CurrentConfigurationNotSetError} from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import JsonSocket from "../../src/background-jobs/json-socket.js"
import runJobPayload from "../../src/background-jobs/job-runner.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"

/** @returns {string} - Repository root. */
function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
}

describe("Background jobs - runner reschedule retry", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("retries a transient persistence rejection with the same reschedule outcome and delay", async () => {
    const directory = path.join(repoRoot(), "tmp", `job-runner-reschedule-${Date.now()}`)
    await fs.mkdir(path.join(directory, "src", "jobs"), {recursive: true})
    await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))
    const jobPath = pathToFileURL(path.join(repoRoot(), "src", "background-jobs", "job.js")).href
    await fs.writeFile(path.join(directory, "src", "jobs", "reschedule-job.js"), `import VelociousJob from ${JSON.stringify(jobPath)}
export default class RescheduleJob extends VelociousJob {
  async perform() { this.rescheduleIn(1234) }
}
`)

    /** @type {Array<import("../../src/background-jobs/types.js").BackgroundJobSocketMessage>} */
    const messages = []
    const server = net.createServer((socket) => {
      const jsonSocket = new JsonSocket(socket)
      jsonSocket.on("message", (message) => {
        if (message?.type !== "job-reschedule" && message?.type !== "job-failed") return
        messages.push(message)
        if (messages.length === 1) {
          jsonSocket.send({type: "job-update-error", jobId: message.jobId, error: "Transient persistence rejection"})
        } else {
          jsonSocket.send({type: "job-updated", jobId: message.jobId})
        }
      })
    })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Expected fake main port")

    const configuration = new Configuration({
      backgroundJobs: {host: "127.0.0.1", port: address.port},
      database: {test: {default: {driver: SqliteDriver, poolType: SingleMultiUsePool, type: "sqlite", name: "job-runner-reschedule", migrations: false}}},
      directory,
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    /** @type {Configuration | undefined} */
    let previousConfiguration
    try {
      previousConfiguration = Configuration.current()
    } catch (error) {
      if (!(error instanceof CurrentConfigurationNotSetError)) throw error
    }

    try {
      configuration.setCurrent()
      expect(await runJobPayload({
        id: "job-1",
        jobName: "RescheduleJob",
        args: [],
        handoffId: "handoff-1",
        handedOffAtMs: 42,
        workerId: "worker-1"
      }, {closeConnections: false})).toEqual("rescheduled")

      expect(messages).toEqual([
        {type: "job-reschedule", jobId: "job-1", delayMs: 1234, handoffId: "handoff-1", handedOffAtMs: 42, workerId: "worker-1"},
        {type: "job-reschedule", jobId: "job-1", delayMs: 1234, handoffId: "handoff-1", handedOffAtMs: 42, workerId: "worker-1"}
      ])
    } finally {
      previousConfiguration?.setCurrent()
      await configuration.disconnectBeacon()
      await configuration.closeDatabaseConnections()
      await new Promise((resolve) => server.close(() => resolve(undefined)))
      await fs.rm(directory, {recursive: true, force: true})
    }
  })
})
