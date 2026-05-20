// @ts-check

import Net from "node:net"

import HttpServer from "../../src/http-server/index.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @param {Net.Server} server - Server to bind.
 * @returns {Promise<number>} - Bound port.
 */
async function listenOnRandomPort(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })

  const address = server.address()
  if (!address || typeof address === "string") throw new Error(`Unexpected server address: ${address}`)

  return address.port
}

describe("HttpServer - listen errors", () => {
  it("rejects startup and stops workers when the port is already in use", async () => {
    const occupiedServer = Net.createServer()
    const port = await listenOnRandomPort(occupiedServer)
    const stoppedWorkers = []

    const server = new HttpServer({
      configuration: {debug: false},
      host: "127.0.0.1",
      port
    })

    server._ensureAtLeastOneWorker = async () => {
      server.workerHandlers = [
        {
          stop: async () => {
            stoppedWorkers.push("worker")
          }
        }
      ]
    }
    server._startDevelopmentReloader = async () => {}

    let startupError
    try {
      await server.start()
    } catch (error) {
      startupError = error
    }

    await new Promise((resolve, reject) => {
      occupiedServer.close((error) => {
        if (error) {
          reject(error)
        } else {
          resolve(undefined)
        }
      })
    })

    expect(startupError.code).toEqual("EADDRINUSE")
    expect(stoppedWorkers).toEqual(["worker"])
    expect(server.isActive()).toBeFalse()
  })
})
