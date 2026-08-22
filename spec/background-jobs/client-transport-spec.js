// @ts-check

import net from "net"
import timeout, {TimeoutError} from "awaitery/build/timeout.js"
import BackgroundJobsClient from "../../src/background-jobs/client.js"
import JsonSocket from "../../src/background-jobs/json-socket.js"
import {clearBackgroundJobs, startBackgroundJobsMain} from "../helpers/background-jobs-helper.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { waitForEvent } from "../../src/testing/test.js"

/**
 * @typedef {object} TcpServerHarness
 * @property {() => Promise<void>} close - Closes all accepted sockets and the server.
 * @property {number} port - Bound TCP port.
 * @property {net.Server} server - TCP server.
 */

/**
 * Starts an owned real TCP server.
 * @param {(socket: net.Socket) => void} onConnection - Connection handler.
 * @returns {Promise<TcpServerHarness>} - Started server harness.
 */
async function startTcpServer(onConnection) {
  const sockets = new Set()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    onConnection(socket)
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve(undefined))
  })

  const address = server.address()

  if (!address || typeof address !== "object") throw new Error("Expected the TCP server address")

  return {
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(() => resolve(undefined)))
    },
    port: address.port,
    server
  }
}

/**
 * Captures a promise rejection without losing the error value.
 * @template T
 * @param {Promise<T>} promise - Promise expected to reject.
 * @returns {Promise<Error>} - Rejection error.
 */
async function rejectionFrom(promise) {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }

  throw new Error("Expected promise to reject")
}

describe("BackgroundJobsClient transport", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  afterEach(async () => {
    await clearBackgroundJobs()
  })

  it("promptly rejects every request when the peer ends or closes before acknowledging", async () => {
    const harness = await startTcpServer((socket) => {
      const jsonSocket = new JsonSocket(socket)

      jsonSocket.on("message", (message) => {
        if (message?.type !== "enqueue") return

        if (message.args?.[0] === "end") {
          socket.end()
        } else {
          socket.destroy()
        }
      })
    })

    try {
      dummyConfiguration.setBackgroundJobsConfig({host: "127.0.0.1", port: harness.port})
      const client = new BackgroundJobsClient({configuration: dummyConfiguration})
      const requests = [
        client.enqueue({args: ["end"], jobName: "TransportTestJob"}),
        client.enqueue({args: ["close"], jobName: "TransportTestJob"})
      ]
      const results = await timeout(
        {errorMessage: "Prematurely closed enqueue requests did not settle", timeout: 1000},
        async () => await Promise.allSettled(requests)
      )

      expect(results).toHaveLength(2)
      for (const result of results) {
        expect(result.status).toEqual("rejected")
        if (result.status === "rejected") {
          expect(result.reason).toBeInstanceOf(Error)
          expect(result.reason.message).toMatch(/closed before.*acknowledged/i)
        }
      }
    } finally {
      await harness.close()
    }
  })

  it("times out a stalled acknowledgement and destroys the socket before a later request succeeds", async () => {
    let requestCount = 0
    const harness = await startTcpServer((socket) => {
      const jsonSocket = new JsonSocket(socket)

      jsonSocket.on("message", (message) => {
        if (message?.type !== "enqueue") return
        requestCount += 1
        if (requestCount === 1) return

        jsonSocket.send({jobId: "recovered-job", type: "enqueued"})
      })
    })

    try {
      dummyConfiguration.setBackgroundJobsConfig({host: "127.0.0.1", port: harness.port})
      const client = new BackgroundJobsClient({configuration: dummyConfiguration, enqueueTimeoutMs: 40})
      const serverSocketPromise = waitForEvent(harness.server, "connection", {timeoutMs: 1000})
      const firstRequest = client.enqueue({args: ["stalled"], jobName: "TransportTestJob"})
      const serverSocket = /** @type {net.Socket} */ (await serverSocketPromise)
      const socketClosed = waitForEvent(serverSocket, "close", {timeoutMs: 1000}).then(
        () => true,
        (error) => error
      )
      const error = await rejectionFrom(timeout(
        {errorMessage: "Stalled enqueue request did not settle", timeout: 1000},
        async () => await firstRequest
      ))
      const socketCloseResult = await socketClosed

      expect(error).toBeInstanceOf(TimeoutError)
      expect(error.message).toEqual("Background job enqueue acknowledgement timed out after 40ms")
      expect(socketCloseResult).toEqual(true)
      expect(serverSocket.destroyed).toEqual(true)
      expect(await client.enqueue({args: ["recovered"], jobName: "TransportTestJob"})).toEqual("recovered-job")
    } finally {
      await harness.close()
    }
  })

  it("replays an ambiguously acknowledged idempotent enqueue to the original durable job", async () => {
    const {main, store} = await startBackgroundJobsMain()
    let droppedJobId
    let proxyConnectionCount = 0
    const proxy = await startTcpServer((downstream) => {
      proxyConnectionCount += 1
      const dropAcknowledgement = proxyConnectionCount === 1
      const upstream = net.createConnection({host: "127.0.0.1", port: main.getPort()})

      downstream.pipe(upstream)
      downstream.once("close", () => upstream.destroy())
      upstream.once("error", () => downstream.destroy())

      if (!dropAcknowledgement) {
        upstream.pipe(downstream)
        return
      }

      let buffer = ""
      upstream.setEncoding("utf8")
      upstream.on("data", (chunk) => {
        buffer += String(chunk)

        while (true) {
          const newlineIndex = buffer.indexOf("\n")
          if (newlineIndex === -1) return

          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          if (!line) continue

          const message = JSON.parse(line)
          if (message?.type !== "enqueued") {
            downstream.write(`${line}\n`)
            continue
          }

          droppedJobId = message.jobId
          downstream.end()
          upstream.destroy()
          return
        }
      })
    })

    try {
      dummyConfiguration.setBackgroundJobsConfig({host: "127.0.0.1", port: proxy.port})
      const client = new BackgroundJobsClient({configuration: dummyConfiguration, enqueueTimeoutMs: 500})
      const request = {
        args: [{projectId: "project-7"}],
        jobName: "ProjectedMailJob",
        options: {idempotencyKey: "projected-mail:command-41"}
      }
      const firstError = await rejectionFrom(timeout(
        {errorMessage: "Dropped acknowledgement did not settle", timeout: 1000},
        async () => await client.enqueue(request)
      ))
      const replayedJobId = await client.enqueue(request)

      expect(firstError.message).toMatch(/closed before.*acknowledged/i)
      expect(replayedJobId).toEqual(droppedJobId)
      expect(await store.countJobs({jobName: "ProjectedMailJob"})).toEqual(1)
    } finally {
      await proxy.close()
      await main.stop()
    }
  })

  it("keeps concurrent requests isolated when one connection fails", async () => {
    let connectionCount = 0
    const harness = await startTcpServer((socket) => {
      connectionCount += 1
      const jsonSocket = new JsonSocket(socket)

      jsonSocket.on("message", (message) => {
        if (message?.type !== "enqueue") return
        if (message.args?.[0] === "failed") {
          socket.destroy()
          return
        }

        jsonSocket.send({jobId: `job-${message.args?.[0]}`, type: "enqueued"})
      })
    })

    try {
      dummyConfiguration.setBackgroundJobsConfig({host: "127.0.0.1", port: harness.port})
      const client = new BackgroundJobsClient({configuration: dummyConfiguration})
      const results = await timeout(
        {errorMessage: "Concurrent enqueue requests did not settle", timeout: 1000},
        async () => await Promise.allSettled([
          client.enqueue({args: ["first"], jobName: "TransportTestJob"}),
          client.enqueue({args: ["failed"], jobName: "TransportTestJob"}),
          client.enqueue({args: ["third"], jobName: "TransportTestJob"})
        ])
      )

      expect(connectionCount).toEqual(3)
      expect(results[0]).toEqual({status: "fulfilled", value: "job-first"})
      expect(results[1]?.status).toEqual("rejected")
      if (results[1]?.status === "rejected") {
        expect(results[1].reason.message).toMatch(/closed before.*acknowledged/i)
      }
      expect(results[2]).toEqual({status: "fulfilled", value: "job-third"})
    } finally {
      await harness.close()
    }
  })
})
