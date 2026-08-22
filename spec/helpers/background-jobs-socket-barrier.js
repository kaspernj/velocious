// @ts-check

import net from "node:net"

/**
 * Creates an event-driven cross-process barrier for background-job concurrency specs.
 * @param {number} expectedConnections - Number of jobs that must enter the barrier.
 * @returns {Promise<{close: () => Promise<void>, port: number, release: () => void, waiting: Promise<void>}>} - Barrier controls.
 */
export default async function createBackgroundJobsSocketBarrier(expectedConnections) {
  /** @type {Set<import("node:net").Socket>} */
  const sockets = new Set()
  /** @type {() => void} */
  let resolveWaiting = () => {}
  /** @type {(error: Error) => void} */
  let rejectWaiting = () => {}
  const waiting = new Promise((resolve, reject) => {
    resolveWaiting = resolve
    rejectWaiting = reject
  })
  let released = false
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => { sockets.delete(socket) })
    socket.once("error", rejectWaiting)

    if (released) {
      socket.end("release")
    } else if (sockets.size === expectedConnections) {
      resolveWaiting()
    }
  })

  server.once("error", rejectWaiting)
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()

  if (!address || typeof address === "string") throw new Error("Expected background-job barrier TCP address")

  const release = () => {
    released = true
    for (const socket of sockets) socket.end("release")
  }

  return {
    close: async () => {
      release()
      if (!server.listening) return
      await new Promise((resolve) => server.close(() => resolve(undefined)))
    },
    port: address.port,
    release,
    waiting
  }
}
