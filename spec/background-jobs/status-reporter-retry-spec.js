// @ts-check

import net from "node:net"
import BackgroundJobsStatusReporter from "../../src/background-jobs/status-reporter.js"
import JsonSocket from "../../src/background-jobs/json-socket.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/**
 * Starts a fake background-jobs-main that replies to each `job-complete` via
 * `respond(attempt, jsonSocket, jobId)`, so a spec can answer `job-update-error`
 * (a transient DB failure) for the first attempts and then `job-updated`.
 * @param {(attempt: number, jsonSocket: JsonSocket, jobId: string) => void} respond
 * @returns {Promise<{port: number, attempts: () => number, close: () => Promise<void>}>}
 */
async function startFakeMain(respond) {
  let attempts = 0
  const server = net.createServer((socket) => {
    const jsonSocket = new JsonSocket(socket)

    jsonSocket.on("message", (message) => {
      if (message?.type !== "job-complete") return

      attempts += 1
      respond(attempts, jsonSocket, message.jobId)
    })
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))

  const address = server.address()

  if (!address || typeof address === "string") throw new Error("Fake main did not bind to a TCP port")

  return {
    port: address.port,
    attempts: () => attempts,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined)))
  }
}

describe("BackgroundJobsStatusReporter retry", () => {
  it("retries a job-update-error (transient persist failure) until it succeeds when retryPersistErrors is set", async () => {
    // Real path: main answers `job-update-error`, so `report()` rejects with the
    // module's BackgroundJobUpdateError. Reject once (transient), then persist.
    const main = await startFakeMain((attempt, jsonSocket, jobId) => {
      if (attempt < 2) {
        jsonSocket.send({type: "job-update-error", jobId, error: "Completion update rejected"})
      } else {
        jsonSocket.send({type: "job-updated", jobId})
      }
    })

    try {
      const reporter = new BackgroundJobsStatusReporter({configuration: dummyConfiguration, host: "127.0.0.1", port: main.port})

      await reporter.reportWithRetry({jobId: "job-1", status: "completed", retryPersistErrors: true})

      // It retried the transient update error rather than dropping the completion.
      expect(main.attempts()).toEqual(2)
    } finally {
      await main.close()
    }
  })

  it("throws a job-update-error immediately by default so forked/spawned runners exit non-zero to be reclaimed", async () => {
    const main = await startFakeMain((attempt, jsonSocket, jobId) => {
      jsonSocket.send({type: "job-update-error", jobId, error: "Completion update rejected"})
    })

    try {
      const reporter = new BackgroundJobsStatusReporter({configuration: dummyConfiguration, host: "127.0.0.1", port: main.port})

      /** @type {Error | undefined} */
      let caught

      try {
        await reporter.reportWithRetry({jobId: "job-2", status: "completed"})
      } catch (error) {
        caught = /** @type {Error} */ (error)
      }

      // Reported exactly once, then threw — no retry (the existing forked-runner contract).
      expect(caught).toBeInstanceOf(Error)
      expect(main.attempts()).toEqual(1)
    } finally {
      await main.close()
    }
  })
})
