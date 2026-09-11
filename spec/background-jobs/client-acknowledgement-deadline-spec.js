// @ts-check

import net from "net"

import BackgroundJobsClient from "../../src/background-jobs/client.js"
import JsonSocket from "../../src/background-jobs/json-socket.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import { describe, expect, it } from "../../src/testing/test.js"

const STAGE_DELAY_MS = 300

/**
 * Starts a generation-aware peer that delays each independent protocol stage.
 * @returns {Promise<{close: () => Promise<void>, port: number}>} - Server handle.
 */
async function startStagedAcknowledgementServer() {
  /** @type {Set<net.Socket>} */
  const sockets = new Set()
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set()
  const server = net.createServer((socket) => {
    const jsonSocket = new JsonSocket(socket)

    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    jsonSocket.on("message", (message) => {
      if (message?.type === "hello") {
        const timer = setTimeout(() => {
          timers.delete(timer)
          jsonSocket.send({
            type: "generation-accepted",
            generationId: "acknowledgement-deadline",
            lifecycleState: "active"
          })
        }, STAGE_DELAY_MS)

        timers.add(timer)
        return
      }

      if (message?.type === "enqueue") {
        const timer = setTimeout(() => {
          timers.delete(timer)
          jsonSocket.send({type: "enqueued", jobId: "staged-job"})
        }, STAGE_DELAY_MS)

        timers.add(timer)
      }
    })
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve(undefined))
  })
  const address = server.address()

  if (!address || typeof address === "string") throw new Error("Expected staged acknowledgement server address")

  return {
    close: async () => {
      for (const timer of timers) clearTimeout(timer)
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(() => resolve(undefined)))
    },
    port: address.port
  }
}

/**
 * Builds an isolated generation client configuration.
 * @param {{port: number}} args - Server endpoint.
 * @returns {Configuration} - Client configuration.
 */
function clientConfiguration({port}) {
  return new Configuration({
    backgroundJobs: {host: "127.0.0.1", port},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]}
  })
}

describe("BackgroundJobsClient acknowledgement deadline", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("starts the enqueue deadline after the generation handshake sends the request", {timeoutMs: 2000}, async () => {
    const server = await startStagedAcknowledgementServer()

    try {
      const client = new BackgroundJobsClient({
        configuration: clientConfiguration({port: server.port}),
        enqueueTimeoutMs: 500,
        generationHandshakeTimeoutMs: 1000,
        generationId: "acknowledgement-deadline"
      })

      expect(await client.enqueue({args: [], jobName: "StagedAcknowledgementJob"})).toEqual("staged-job")
    } finally {
      await server.close()
    }
  })
})
