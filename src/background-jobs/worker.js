// @ts-check

import net from "net"
import {spawn} from "node:child_process"
import JsonSocket from "./json-socket.js"
import BackgroundJobRegistry from "./job-registry.js"
import configurationResolver from "../configuration-resolver.js"
import BackgroundJobsStatusReporter from "./status-reporter.js"
import {randomUUID} from "crypto"

export default class BackgroundJobsWorker {
  /**
   * @param {object} [args] - Options.
   * @param {import("../configuration.js").default} [args.configuration] - Configuration.
   * @param {string} [args.host] - Hostname.
   * @param {number} [args.port] - Port.
   */
  constructor({configuration, host, port} = {}) {
    this.configurationPromise = configuration ? Promise.resolve(configuration) : configurationResolver()
    this.host = host
    this.port = port
    this.shouldStop = false
    this.workerId = randomUUID()
  }

  /**
   * @returns {Promise<void>} - Resolves when connected.
   */
  async start() {
    this.configuration = await this.configurationPromise
    this.configuration.setCurrent()
    await this.configuration.initialize({type: "background-jobs-worker"})
    this.statusReporter = new BackgroundJobsStatusReporter({
      configuration: this.configuration,
      host: this.host,
      port: this.port
    })
    await this._connect()
  }

  /**
   * @returns {Promise<void>} - Resolves when stopped.
   */
  async stop() {
    this.shouldStop = true
    if (this.jsonSocket) this.jsonSocket.close()
  }

  async _connect() {
    const config = this.configuration.getBackgroundJobsConfig()
    const host = this.host || config.host
    const port = typeof this.port === "number" ? this.port : config.port
    const socket = net.createConnection({host, port})
    const jsonSocket = new JsonSocket(socket)
    this.jsonSocket = jsonSocket

    jsonSocket.on("message", async (message) => {
      if (message?.type === "job") {
        await this._handleJob(message.payload)
      }
    })

    jsonSocket.on("error", (error) => {
      console.error("Background jobs worker socket error:", error)
    })

    jsonSocket.on("close", () => {
      if (this.shouldStop) return
      setTimeout(() => { void this._connect() }, 1000)
    })

    socket.on("connect", () => {
      jsonSocket.send({type: "hello", role: "worker", workerId: this.workerId})
      jsonSocket.send({type: "ready"})
    })
  }

  /**
   * @param {object} payload - Payload.
   * @returns {Promise<void>} - Resolves when done.
   */
  async _handleJob(payload) {
    const options = payload.options || {}
    const shouldFork = options.forked !== false

    if (shouldFork) {
      await this._spawnDetachedJob(payload)
      this.jsonSocket?.send({type: "ready"})
      return
    }

    try {
      await this._runJobInline(payload)
      void this._reportJobResult({jobId: payload.id, status: "completed"})
    } catch (error) {
      void this._reportJobResult({jobId: payload.id, status: "failed", error})
    }
    this.jsonSocket?.send({type: "ready"})
  }

  /**
   * @param {object} payload - Payload.
   * @returns {Promise<void>} - Resolves when done.
   */
  async _runJobInline(payload) {
    const registry = new BackgroundJobRegistry({configuration: this.configuration})
    await registry.load()
    const JobClass = registry.getJobByName(payload.jobName)
    const jobInstance = new JobClass()

    await jobInstance.perform.apply(jobInstance, payload.args || [])
  }

  /**
   * @param {object} payload - Payload.
   * @returns {Promise<void>} - Resolves when spawned.
   */
  async _spawnDetachedJob(payload) {
    const directory = this.configuration.getDirectory()
    const argvCommand = process.argv[1]
    const command = argvCommand ? argvCommand : `${directory}/bin/velocious.js`
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64")
    const backgroundJobsConfig = this.configuration.getBackgroundJobsConfig()
    const child = spawn(process.execPath, [command, "background-jobs-runner"], {
      cwd: directory,
      detached: true,
      stdio: "ignore",
      env: Object.assign({}, process.env, {
        VELOCIOUS_BACKGROUND_JOBS_HOST: backgroundJobsConfig.host,
        VELOCIOUS_BACKGROUND_JOBS_PORT: `${backgroundJobsConfig.port}`,
        VELOCIOUS_JOB_PAYLOAD: encodedPayload
      })
    })

    child.unref()
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.jobId - Job id.
   * @param {"completed" | "failed"} args.status - Status.
   * @param {unknown} [args.error] - Error.
   * @returns {Promise<void>} - Resolves when reported.
   */
  async _reportJobResult({jobId, status, error}) {
    if (!this.statusReporter) return

    try {
      await this.statusReporter.reportWithRetry({jobId, status, error})
    } catch (reportError) {
      console.error("Background job status reporting failed:", reportError)
    }
  }
}
