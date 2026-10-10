// @ts-check

import fs from "node:fs/promises"
import net from "node:net"
import promiseBarrier from "./promise-barrier.js"

/**
 * Starts a real Unix socket whose listener is created only when `start` is
 * called, mirroring a coordinator whose lifecycle control socket opens
 * asynchronously after its process starts. Each request the server receives is
 * counted and answered once — with a definitive protocol error when
 * `errorMessage` is set, or with an exact-identity acknowledgement otherwise.
 * @param {object} args - Listener options.
 * @param {string} args.socketPath - Unix socket path.
 * @param {string} [args.generationId] - Generation identity for responses (default: "release-delayed-control").
 * @param {string} [args.errorMessage] - When set, respond with a definitive lifecycle error instead of an acknowledgement.
 * @returns {Promise<{close: () => Promise<void>, firstConnection: Promise<void>, requests: () => number, start: () => Promise<void>}>} - Delayed listener controls.
 */
export default async function delayedLifecycleSocketServer({generationId = "release-delayed-control", socketPath, errorMessage}) {
  const firstConnection = promiseBarrier()
  /** @type {Set<net.Socket>} */
  const sockets = new Set()
  let requestCount = 0
  /** @type {net.Server | undefined} */
  let server

  return {
    close: async () => {
      for (const socket of sockets) socket.destroy()
      const listening = server
      if (listening) await new Promise((resolve) => listening.close(() => resolve(undefined)))
      await fs.rm(socketPath, {force: true})
    },
    firstConnection: firstConnection.waiting,
    requests: () => requestCount,
    start: async () => {
      const created = net.createServer((socket) => {
        sockets.add(socket)
        firstConnection.entered()
        socket.setEncoding("utf8")
        let buffer = ""
        socket.on("data", (chunk) => {
          buffer += chunk
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""
          for (const line of lines) {
            if (!line) continue
            /** @type {ReturnType<typeof JSON.parse>} */
            const message = JSON.parse(line)
            requestCount += 1
            const response = errorMessage
              ? {action: message?.action, error: {message: errorMessage, name: "Error", stack: ""}, generationId, requestId: message?.requestId, type: "background-jobs-lifecycle-error"}
              : {action: message?.action, generationId, lifecycleState: message?.action === "retire" ? "retired" : "active", requestId: message?.requestId, type: "background-jobs-lifecycle-ack"}
            socket.end(`${JSON.stringify(response)}\n`)
          }
        })
        socket.once("close", () => sockets.delete(socket))
      })
      await new Promise((resolve, reject) => {
        created.once("error", reject)
        created.listen(socketPath, () => resolve(undefined))
      })
      server = created
    }
  }
}
