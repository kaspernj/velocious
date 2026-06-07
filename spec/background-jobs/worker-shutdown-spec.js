// @ts-check

import {fileURLToPath} from "node:url"
import {fork} from "node:child_process"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"

const FORKED_RUNNER_ENTRY_PATH = fileURLToPath(new URL("../../src/background-jobs/forked-runner-child.js", import.meta.url))

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
 * @returns {Promise<{code: number | null, signal: NodeJS.Signals | null}>} - Exit result.
 */
async function waitForChildExit(child) {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error("Timed out waiting for forked runner child to exit"))
    }, 2000)

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
})
