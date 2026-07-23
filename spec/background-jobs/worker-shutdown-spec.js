// @ts-check

import fs from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {fork, spawn} from "node:child_process"
import timeout from "awaitery/build/timeout.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import JsonSocket from "../../src/background-jobs/json-socket.js"

const FORKED_RUNNER_ENTRY_PATH = fileURLToPath(new URL("../../src/background-jobs/forked-runner-child.js", import.meta.url))
const VELOCIOUS_CLI_ENTRY_PATH = fileURLToPath(new URL("../../bin/velocious.js", import.meta.url))
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

/**
 * @returns {Promise<{cleanup: () => Promise<void>, directory: string}>} - Temporary runner project.
 */
async function createStalledTeardownProject() {
  const directory = path.join(REPOSITORY_ROOT, "tmp", `forked-runner-exit-${process.pid}-${Date.now()}`)
  const configurationPath = path.join(directory, "src", "config", "configuration.js")
  const jobsDirectory = path.join(directory, "src", "jobs")
  const frameworkConfigurationPath = new URL("../../src/configuration.js", import.meta.url).href
  const environmentHandlerPath = new URL("../../src/environment-handlers/node.js", import.meta.url).href
  const jobPath = new URL("../../src/background-jobs/job.js", import.meta.url).href

  await fs.mkdir(path.dirname(configurationPath), {recursive: true})
  await fs.mkdir(jobsDirectory, {recursive: true})
  await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))
  await fs.writeFile(configurationPath, `
import Configuration from ${JSON.stringify(frameworkConfigurationPath)}
import EnvironmentHandlerNode from ${JSON.stringify(environmentHandlerPath)}

class StalledTeardownConfiguration extends Configuration {
  async initialize() {}
  async connectBeacon() {}
  async withConnections(_args, callback) { await callback() }
  async disconnectBeacon() { await new Promise(() => {}) }
  async closeDatabaseConnections() { await new Promise(() => {}) }
}

export default new StalledTeardownConfiguration({
  database: {test: {}},
  directory: ${JSON.stringify(directory)},
  environment: "test",
  environmentHandler: new EnvironmentHandlerNode(),
  initializeModels: async () => {},
  locale: "en",
  localeFallbacks: {en: ["en"]},
  locales: ["en"]
})
`)
  await fs.writeFile(path.join(jobsDirectory, "exit-after-completion-job.js"), `
import Job from ${JSON.stringify(jobPath)}
export default class ExitAfterCompletionJob extends Job { async perform() {} }
`)

  return {
    cleanup: async () => await fs.rm(directory, {recursive: true, force: true}),
    directory
  }
}

/**
 * Builds a worker with a tracked fake process-runner child whose `kill()` signals
 * are recorded, so shutdown tests can assert how the child was reaped.
 * @returns {{child: {kill: (signal: string) => boolean}, signals: string[], worker: BackgroundJobsWorker}}
 */
function workerWithTrackedChild() {
  /** @type {string[]} */
  const signals = []
  const child = {
    kill(signal) {
      signals.push(signal)

      return true
    }
  }
  const worker = new BackgroundJobsWorker({forkedChildSigkillGraceMs: 10})

  worker.inflightProcessChildren.add(/** @type {any} */ (child))

  return {child, signals, worker}
}

/**
 * @param {import("node:child_process").ChildProcess} child - Child process.
 * @param {number} [timeoutMs] - Maximum exit wait.
 * @returns {Promise<{code: number | null, signal: NodeJS.Signals | null}>} - Exit result.
 */
async function waitForChildExit(child, timeoutMs = 2000) {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for forked runner child to exit"))
    }, timeoutMs)

    child.once("exit", (code, signal) => {
      clearTimeout(timeout)
      resolve({code, signal})
    })
  })
}

describe("Background jobs worker - shutdown", () => {
  it("terminates process runners that outlast a bounded drain instead of orphaning them", async () => {
    const {signals, worker} = workerWithTrackedChild()

    // An in-flight process runner whose job never finishes within the drain
    // window (e.g. a build still running when a deploy drains the worker).
    worker.inflightProcessJobs.add(new Promise(() => {}))

    await worker.stop({timeoutMs: 10})

    expect(signals).toEqual(["SIGTERM", "SIGKILL"])
  })

  it("does not terminate process runners that finish within the drain window", async () => {
    const {child, signals, worker} = workerWithTrackedChild()

    // The runner finishes during the drain, so its child handle is removed
    // before reaping runs — no signal should be sent.
    const finished = Promise.resolve()

    worker.inflightProcessJobs.add(finished)
    void finished.then(() => worker.inflightProcessChildren.delete(/** @type {any} */ (child)))

    await worker.stop({timeoutMs: 1000})

    expect(signals).toEqual([])
  })

  it("closes database connections after disconnecting beacon", async () => {
    /** @type {string[]} */
    const events = []
    const worker = new BackgroundJobsWorker({
      configuration: /** @type {import("../../src/configuration.js").default} */ ({
        closeDatabaseConnections: async () => { events.push("close-db") },
        disconnectBeacon: async () => { events.push("disconnect-beacon") }
      })
    })
    worker.configuration = await worker.configurationPromise

    await worker.stop()

    expect(events).toEqual(["disconnect-beacon", "close-db"])
  })

  it("preserves externally owned database connections on stop", async () => {
    /** @type {string[]} */
    const events = []
    const worker = new BackgroundJobsWorker({
      closeDatabaseConnectionsOnStop: false,
      configuration: /** @type {import("../../src/configuration.js").default} */ ({
        closeDatabaseConnections: async () => { events.push("close-db") },
        disconnectBeacon: async () => { events.push("disconnect-beacon") }
      })
    })
    worker.configuration = await worker.configurationPromise

    await worker.stop()

    expect(events).toEqual(["disconnect-beacon"])
  })

  it("does not make externally terminated forked children look like clean exits", async () => {
    const child = fork(FORKED_RUNNER_ENTRY_PATH, [], {
      execArgv: [],
      stdio: ["ignore", "ignore", "ignore", "ipc"]
    })
    const exitPromise = waitForChildExit(child)

    await new Promise((resolve) => setTimeout(resolve, 50))
    child.kill("SIGTERM")

    const exit = await exitPromise

    expect(exit.code === 0 && !exit.signal).toBeFalse()
  })

  it("exits after durable completion without waiting for graceful teardown", async () => {
    const {cleanup, directory} = await createStalledTeardownProject()
    const server = net.createServer()
    const jobId = `job-${Date.now()}`
    let durableReportReceived = false
    /** @type {import("node:child_process").ChildProcess | undefined} */
    let child

    try {
      server.on("connection", (socket) => {
        const jsonSocket = new JsonSocket(socket)
        jsonSocket.on("message", (message) => {
          if (message?.type !== "job-complete" || message.jobId !== jobId) return

          durableReportReceived = true
          jsonSocket.send({type: "job-updated", jobId})
        })
      })
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Runner status server did not bind to a TCP port")
      child = fork(FORKED_RUNNER_ENTRY_PATH, [], {
        cwd: directory,
        execArgv: [],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: {
          ...process.env,
          VELOCIOUS_ENV: "test",
          VELOCIOUS_BACKGROUND_JOBS_HOST: "127.0.0.1",
          VELOCIOUS_BACKGROUND_JOBS_PORT: `${address.port}`
        }
      })

      child.send({type: "job", payload: {id: jobId, jobName: "ExitAfterCompletionJob", args: []}})
      const exit = await timeout({timeout: 2000}, async () => await waitForChildExit(child))

      expect(durableReportReceived).toBe(true)
      expect(exit).toEqual({code: 0, signal: null})
    } finally {
      if (child && !child.killed && child.exitCode === null) child.kill("SIGKILL")
      await new Promise((resolve) => server.close(resolve))
      await cleanup()
    }
  })

  it("exits a spawned CLI runner after durable completion without waiting for outer cleanup", async () => {
    const {cleanup, directory} = await createStalledTeardownProject()
    const server = net.createServer()
    const jobId = `spawned-job-${Date.now()}`
    let durableReportReceived = false
    /** @type {import("node:child_process").ChildProcess | undefined} */
    let child

    try {
      server.on("connection", (socket) => {
        const jsonSocket = new JsonSocket(socket)
        jsonSocket.on("message", (message) => {
          if (message?.type !== "job-complete" || message.jobId !== jobId) return

          durableReportReceived = true
          jsonSocket.send({type: "job-updated", jobId})
        })
      })
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Runner status server did not bind to a TCP port")
      const jobPayload = Buffer.from(JSON.stringify({
        id: jobId,
        jobName: "ExitAfterCompletionJob",
        args: []
      })).toString("base64")
      child = spawn(process.execPath, [VELOCIOUS_CLI_ENTRY_PATH, "background-jobs-runner"], {
        cwd: directory,
        stdio: "ignore",
        env: {
          ...process.env,
          VELOCIOUS_ENV: "test",
          VELOCIOUS_BACKGROUND_JOBS_HOST: "127.0.0.1",
          VELOCIOUS_BACKGROUND_JOBS_PORT: `${address.port}`,
          VELOCIOUS_JOB_PAYLOAD: jobPayload
        }
      })

      const exit = await timeout({timeout: 2000}, async () => await waitForChildExit(child))

      expect(durableReportReceived).toBe(true)
      expect(exit).toEqual({code: 0, signal: null})
    } finally {
      if (child && !child.killed && child.exitCode === null) child.kill("SIGKILL")
      await new Promise((resolve) => server.close(resolve))
      await cleanup()
    }
  })

  it("does not exit a forked runner cleanly without a durable completion acknowledgement", async () => {
    const {cleanup, directory} = await createStalledTeardownProject()
    const server = net.createServer()
    const jobId = `unacknowledged-job-${Date.now()}`
    let completionReports = 0
    /** @type {import("node:child_process").ChildProcess | undefined} */
    let child

    try {
      server.on("connection", (socket) => {
        const jsonSocket = new JsonSocket(socket)
        jsonSocket.on("message", (message) => {
          if (message?.type !== "job-complete" || message.jobId !== jobId) return

          completionReports += 1
          socket.destroy()
        })
      })
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Runner status server did not bind to a TCP port")
      child = fork(FORKED_RUNNER_ENTRY_PATH, [], {
        cwd: directory,
        execArgv: [],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: {
          ...process.env,
          VELOCIOUS_ENV: "test",
          VELOCIOUS_BACKGROUND_JOBS_HOST: "127.0.0.1",
          VELOCIOUS_BACKGROUND_JOBS_PORT: `${address.port}`
        }
      })

      child.send({type: "job", payload: {id: jobId, jobName: "ExitAfterCompletionJob", args: []}})
      const exit = await waitForChildExit(child, 40000)

      expect(completionReports).toBeGreaterThan(0)
      expect(exit.signal).toBe(null)
      expect(exit.code).toBeGreaterThan(0)
    } finally {
      if (child && !child.killed && child.exitCode === null) child.kill("SIGKILL")
      await new Promise((resolve) => server.close(resolve))
      await cleanup()
    }
  })

  it("does not exit a spawned CLI runner cleanly without a durable completion acknowledgement", async () => {
    const {cleanup, directory} = await createStalledTeardownProject()
    const server = net.createServer()
    const jobId = `unacknowledged-spawned-job-${Date.now()}`
    let completionReports = 0
    /** @type {import("node:child_process").ChildProcess | undefined} */
    let child

    try {
      server.on("connection", (socket) => {
        const jsonSocket = new JsonSocket(socket)
        jsonSocket.on("message", (message) => {
          if (message?.type !== "job-complete" || message.jobId !== jobId) return

          completionReports += 1
          socket.destroy()
        })
      })
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Runner status server did not bind to a TCP port")
      const jobPayload = Buffer.from(JSON.stringify({
        id: jobId,
        jobName: "ExitAfterCompletionJob",
        args: []
      })).toString("base64")
      child = spawn(process.execPath, [VELOCIOUS_CLI_ENTRY_PATH, "background-jobs-runner"], {
        cwd: directory,
        stdio: "ignore",
        env: {
          ...process.env,
          VELOCIOUS_ENV: "test",
          VELOCIOUS_BACKGROUND_JOBS_HOST: "127.0.0.1",
          VELOCIOUS_BACKGROUND_JOBS_PORT: `${address.port}`,
          VELOCIOUS_JOB_PAYLOAD: jobPayload
        }
      })

      const exit = await waitForChildExit(child, 40000)

      expect(completionReports).toBeGreaterThan(0)
      expect(exit.signal).toBe(null)
      expect(exit.code).toBeGreaterThan(0)
    } finally {
      if (child && !child.killed && child.exitCode === null) child.kill("SIGKILL")
      await new Promise((resolve) => server.close(resolve))
      await cleanup()
    }
  })

  it("exits a forked runner nonzero when durable completion is rejected", async () => {
    const {cleanup, directory} = await createStalledTeardownProject()
    const server = net.createServer()
    const jobId = `rejected-job-${Date.now()}`
    let completionReports = 0
    /** @type {import("node:child_process").ChildProcess | undefined} */
    let child

    try {
      server.on("connection", (socket) => {
        const jsonSocket = new JsonSocket(socket)
        jsonSocket.on("message", (message) => {
          if (message?.type !== "job-complete" || message.jobId !== jobId) return

          completionReports += 1
          jsonSocket.send({type: "job-update-error", jobId, error: "Completion update rejected"})
        })
      })
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Runner status server did not bind to a TCP port")
      child = fork(FORKED_RUNNER_ENTRY_PATH, [], {
        cwd: directory,
        execArgv: [],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: {
          ...process.env,
          VELOCIOUS_ENV: "test",
          VELOCIOUS_BACKGROUND_JOBS_HOST: "127.0.0.1",
          VELOCIOUS_BACKGROUND_JOBS_PORT: `${address.port}`
        }
      })

      child.send({type: "job", payload: {id: jobId, jobName: "ExitAfterCompletionJob", args: []}})
      const exit = await waitForChildExit(child, 5000)

      expect(completionReports).toBe(1)
      expect(exit.signal).toBe(null)
      expect(exit.code).toBeGreaterThan(0)
    } finally {
      if (child && !child.killed && child.exitCode === null) child.kill("SIGKILL")
      await new Promise((resolve) => server.close(resolve))
      await cleanup()
    }
  })

  it("exits a spawned CLI runner nonzero when durable completion is rejected", async () => {
    const {cleanup, directory} = await createStalledTeardownProject()
    const server = net.createServer()
    const jobId = `rejected-spawned-job-${Date.now()}`
    let completionReports = 0
    /** @type {import("node:child_process").ChildProcess | undefined} */
    let child

    try {
      server.on("connection", (socket) => {
        const jsonSocket = new JsonSocket(socket)
        jsonSocket.on("message", (message) => {
          if (message?.type !== "job-complete" || message.jobId !== jobId) return

          completionReports += 1
          jsonSocket.send({type: "job-update-error", jobId, error: "Completion update rejected"})
        })
      })
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Runner status server did not bind to a TCP port")
      const jobPayload = Buffer.from(JSON.stringify({
        id: jobId,
        jobName: "ExitAfterCompletionJob",
        args: []
      })).toString("base64")
      child = spawn(process.execPath, [VELOCIOUS_CLI_ENTRY_PATH, "background-jobs-runner"], {
        cwd: directory,
        stdio: "ignore",
        env: {
          ...process.env,
          VELOCIOUS_ENV: "test",
          VELOCIOUS_BACKGROUND_JOBS_HOST: "127.0.0.1",
          VELOCIOUS_BACKGROUND_JOBS_PORT: `${address.port}`,
          VELOCIOUS_JOB_PAYLOAD: jobPayload
        }
      })

      const exit = await waitForChildExit(child, 5000)

      expect(completionReports).toBe(1)
      expect(exit.signal).toBe(null)
      expect(exit.code).toBeGreaterThan(0)
    } finally {
      if (child && !child.killed && child.exitCode === null) child.kill("SIGKILL")
      await new Promise((resolve) => server.close(resolve))
      await cleanup()
    }
  })
})

describe("Background jobs main - shutdown", () => {
  it("closes database connections after disconnecting beacon", async () => {
    /** @type {string[]} */
    const events = []
    const main = new BackgroundJobsMain({
      configuration: /** @type {import("../../src/configuration.js").default} */ ({
        closeDatabaseConnections: async () => { events.push("close-db") },
        disconnectBeacon: async () => { events.push("disconnect-beacon") },
        getBackgroundJobsConfig: () => ({
          databaseIdentifier: "default",
          dispatchStrategy: "beacon",
          host: "127.0.0.1",
          pollIntervalMs: 1000,
          port: 0
        })
      })
    })
    main.server = /** @type {import("net").Server} */ ({
      close: (callback) => {
        events.push("close-server")
        callback()
      }
    })

    await main.stop()

    expect(events).toEqual(["disconnect-beacon", "close-server", "close-db"])
  })

  it("preserves externally owned database connections on stop", async () => {
    /** @type {string[]} */
    const events = []
    const main = new BackgroundJobsMain({
      closeDatabaseConnectionsOnStop: false,
      configuration: /** @type {import("../../src/configuration.js").default} */ ({
        closeDatabaseConnections: async () => { events.push("close-db") },
        disconnectBeacon: async () => { events.push("disconnect-beacon") },
        getBackgroundJobsConfig: () => ({
          databaseIdentifier: "default",
          dispatchStrategy: "beacon",
          host: "127.0.0.1",
          pollIntervalMs: 1000,
          port: 0
        })
      })
    })
    main.server = /** @type {import("net").Server} */ ({
      close: (callback) => {
        events.push("close-server")
        callback()
      }
    })

    await main.stop()

    expect(events).toEqual(["disconnect-beacon", "close-server"])
  })
})
