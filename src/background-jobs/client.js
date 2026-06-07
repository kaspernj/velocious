// @ts-check

import configurationResolver from "../configuration-resolver.js"
import BackgroundJobsSocketRequest from "./socket-request.js"

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
    const request = new BackgroundJobsSocketRequest({host, port, role: "client"})

    return await request.run({
      onConnect: (jsonSocket) => {
        jsonSocket.send({
          type: "enqueue",
          jobName,
          args,
          options
        })
      },
      onMessage: ({message, resolve, reject}) => {
        if (message?.type === "enqueued") {
          resolve(message.jobId)
          return
        }

        if (message?.type === "enqueue-error") {
          reject(new Error(message.error || "Failed to enqueue job"))
        }
      }
    })
  }
}
