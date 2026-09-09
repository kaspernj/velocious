// @ts-check

import net from "node:net"
import promiseBarrier from "./promise-barrier.js"

/**
 * Starts a real TCP or Unix socket that records newline-delimited requests and
 * deliberately never acknowledges them.
 * @param {object} [args] - Listener options.
 * @param {string} [args.socketPath] - Unix socket path; omit for TCP.
 * @returns {Promise<{close: () => Promise<void>, connectionClosed: Promise<void>, host: string, port: number, requestCount: () => number, requests: () => Array<ReturnType<typeof JSON.parse>>, requestReceived: Promise<void>}>} - Stalled listener controls.
 */
export default async function stalledSocketServer({socketPath} = {}) {
  const requestBarrier = promiseBarrier()
  const closeBarrier = promiseBarrier()
  /** @type {Set<net.Socket>} */
  const connections = new Set()
  /** @type {Array<ReturnType<typeof JSON.parse>>} */
  const requests = []
  const server = net.createServer((socket) => {
    connections.add(socket)
    socket.setEncoding("utf8")
    let buffer = ""
    socket.on("data", (chunk) => {
      buffer += chunk
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""
      for (const line of lines) {
        if (!line) continue
        requests.push(JSON.parse(line))
        requestBarrier.entered()
      }
    })
    socket.once("close", () => {
      connections.delete(socket)
      closeBarrier.entered()
    })
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    if (socketPath) server.listen(socketPath, () => resolve(undefined))
    else server.listen(0, "127.0.0.1", () => resolve(undefined))
  })
  const address = server.address()
  const port = address && typeof address === "object" ? address.port : 0

  return {
    close: async () => {
      for (const socket of connections) socket.destroy()
      await new Promise((resolve) => server.close(() => resolve(undefined)))
    },
    connectionClosed: closeBarrier.waiting,
    host: "127.0.0.1",
    port,
    requestCount: () => requests.length,
    requests: () => [...requests],
    requestReceived: requestBarrier.waiting
  }
}
