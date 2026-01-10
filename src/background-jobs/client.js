// @ts-check

import net from "net"
import configurationResolver from "../configuration-resolver.js"
import JsonSocket from "./json-socket.js"

export default class BackgroundJobsClient {
  /**
   * @param {object} [args] - Options.
   * @param {import("../configuration.js").default} [args.configuration] - Configuration.
   */
  constructor({configuration} = {}) {
    this.configurationPromise = configuration ? Promise.resolve(configuration) : configurationResolver()
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.jobName - Job name.
   * @param {any[]} args.args - Job args.
   * @param {import("./types.js").BackgroundJobOptions} [args.options] - Job options.
   * @returns {Promise<string>} - Job id.
   */
  async enqueue({jobName, args, options}) {
    const configuration = await this.configurationPromise
    const {host, port} = configuration.getBackgroundJobsConfig()
    const socket = net.createConnection({host, port})
    const jsonSocket = new JsonSocket(socket)

    return await new Promise((resolve, reject) => {
      const cleanup = () => {
        jsonSocket.removeAllListeners()
      }

      jsonSocket.on("error", (error) => {
        cleanup()
        reject(error)
      })

      jsonSocket.on("message", (message) => {
        if (message?.type === "enqueued") {
          cleanup()
          jsonSocket.close()
          resolve(message.jobId)
          return
        }

        if (message?.type === "enqueue-error") {
          cleanup()
          jsonSocket.close()
          reject(new Error(message.error || "Failed to enqueue job"))
        }
      })

      socket.on("connect", () => {
        jsonSocket.send({type: "hello", role: "client"})
        jsonSocket.send({
          type: "enqueue",
          jobName,
          args,
          options
        })
      })
    })
  }
}
