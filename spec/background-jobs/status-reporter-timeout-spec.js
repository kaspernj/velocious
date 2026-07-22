// @ts-check

import net from "net"
import { TimeoutError } from "awaitery/build/timeout.js"
import BackgroundJobsStatusReporter from "../../src/background-jobs/status-reporter.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import waitForEvent from "../../src/testing/wait-for-event.js"

describe("BackgroundJobsStatusReporter timeout", () => {
  it("times out a stalled report and forcibly destroys (rather than gracefully closing) the pending socket", async () => {
    // A server that accepts the connection and consumes incoming data but never
    // replies, so the reporter's request stalls waiting for a "job-updated".
    const server = net.createServer((socket) => {
      // Draining incoming data keeps the client's write flowing so that a later
      // destroy() is observed here as a reliable "close" rather than stalling.
      socket.on("data", () => {})
      socket.on("error", () => {})
    })

    /** @type {import("net").Socket | undefined} */
    let serverSocket

    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => resolve(undefined))
      })

      const address = server.address()

      if (!address || typeof address !== "object") throw new Error("Expected the server address to be available.")

      const reporter = new BackgroundJobsStatusReporter({
        configuration: dummyConfiguration,
        host: "127.0.0.1",
        port: address.port,
        attemptTimeoutMs: 100
      })

      // Resolves with the server-side socket once the reporter connects. Bounded so a
      // regression that never accepts the connection fails fast instead of hanging.
      const serverSocketPromise = waitForEvent(server, "connection", {timeoutMs: 1000})

      /** @type {Error | undefined} */
      let reportError

      const reportPromise = reporter.report({jobId: "stalled-job", status: "completed"}).catch((error) => {
        reportError = error
      })

      serverSocket = /** @type {import("net").Socket} */ (await serverSocketPromise)

      // Bounded so the exact regression (socket left alive) surfaces as a timeout here
      // and still lets the finally block run, rather than awaiting a close that never comes.
      const serverSocketClosed = waitForEvent(serverSocket, "close", {timeoutMs: 1000})

      await reportPromise

      // The timeout must surface as the public TimeoutError from awaitery.
      expect(reportError).toBeInstanceOf(TimeoutError)

      // Test-only white-box assertion: read the JsonSocket wrapper's own call
      // counters directly (the underscore fields are internal, not public API). These
      // are incremented inside the actual JsonSocket.destroy()/close() bodies, so they
      // are direct evidence of which teardown method ran — not a self-reported flag
      // that a regression could keep truthful while calling the wrong method. The abort
      // path must have forcibly destroyed the socket exactly once and never gracefully
      // closed it; a server-side "close" watcher alone could not rule the latter out
      // because with allowHalfOpen=false a graceful end() ALSO surfaces as a server "close".
      const jsonSocket = reporter._lastRequest?._jsonSocket

      expect(jsonSocket?._destroyCallCount).toEqual(1)
      expect(jsonSocket?._closeCallCount).toEqual(0)

      // The real stalled socket must actually be torn down (integration assertion).
      await serverSocketClosed
    } finally {
      // Destroy the accepted socket if a failed assertion left it open, otherwise
      // server.close() would hang waiting for the still-open connection to end.
      if (serverSocket && !serverSocket.destroyed) serverSocket.destroy()
      await new Promise((resolve) => server.close(() => resolve(undefined)))
    }
  })
})
