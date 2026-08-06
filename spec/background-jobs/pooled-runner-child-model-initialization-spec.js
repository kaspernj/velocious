// @ts-check

import fs from "fs/promises"
import net from "net"
import path from "path"
import { fork } from "child_process"
import { fileURLToPath, pathToFileURL } from "url"

import JsonSocket from "../../src/background-jobs/json-socket.js"
import waitForEvent from "../../src/testing/wait-for-event.js"
import { describe, expect, it } from "../../src/testing/test.js"

const POOLED_RUNNER_ENTRY_PATH = fileURLToPath(new URL("../../src/background-jobs/pooled-runner-child.js", import.meta.url))

/** @returns {string} - Repository root. */
function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
}

/**
 * @param {?} message - IPC message.
 * @returns {{type?: string, attempt?: number, jobId?: string, label?: string, acknowledged?: boolean, status?: string, error?: string}} - Narrowed IPC record.
 */
function ipcRecord(message) {
  if (!message || typeof message !== "object") return {}

  return /** @type {{type?: string, attempt?: number, jobId?: string, label?: string, acknowledged?: boolean, status?: string, error?: string}} */ (message)
}

/**
 * @param {import("child_process").ChildProcess} child - Pooled child.
 * @param {(record: ReturnType<typeof ipcRecord>) => boolean} predicate - Message predicate.
 * @returns {Promise<ReturnType<typeof ipcRecord>>} - Matching IPC record.
 */
async function waitForChildMessage(child, predicate) {
  /** @type {ReturnType<typeof ipcRecord> | undefined} */
  let matchedRecord

  await waitForEvent(child, "message", {
    filter: (candidate) => {
      const record = ipcRecord(candidate)

      if (!predicate(record)) return false
      matchedRecord = record
      return true
    },
    timeoutMs: 5000
  })
  if (!matchedRecord) throw new Error("Child message matched without a record")

  return matchedRecord
}

/**
 * @param {import("child_process").ChildProcess} child - Pooled child.
 * @param {string[]} jobIds - Job ids whose outcomes must arrive.
 * @returns {Promise<ReturnType<typeof ipcRecord>[]>} - Outcomes in job-id order.
 */
async function waitForJobOutcomes(child, jobIds) {
  /** @type {Map<string, ReturnType<typeof ipcRecord>>} */
  const outcomesByJobId = new Map()
  const expectedJobIds = new Set(jobIds)

  await waitForEvent(child, "message", {
    filter: (candidate) => {
      const record = ipcRecord(candidate)

      if (record.type !== "job-outcome" || !record.jobId || !expectedJobIds.has(record.jobId)) return false
      outcomesByJobId.set(record.jobId, record)

      return outcomesByJobId.size === expectedJobIds.size
    },
    timeoutMs: 5000
  })

  return jobIds.map((jobId) => {
    const outcome = outcomesByJobId.get(jobId)
    if (!outcome) throw new Error(`Missing outcome for ${jobId}`)

    return outcome
  })
}

/**
 * @param {string} directory - Temporary app directory.
 * @returns {Promise<void>} - Resolves after writing the app.
 */
async function writeTemporaryApp(directory) {
  const configurationPath = pathToFileURL(path.join(repoRoot(), "src", "configuration.js")).href
  const environmentHandlerPath = pathToFileURL(path.join(repoRoot(), "src", "environment-handlers", "node.js")).href
  const initializerPath = pathToFileURL(path.join(repoRoot(), "src", "database", "initializer-from-require-context.js")).href
  const jobPath = pathToFileURL(path.join(repoRoot(), "src", "background-jobs", "job.js")).href
  const recordPath = pathToFileURL(path.join(repoRoot(), "src", "database", "record", "index.js")).href

  await fs.mkdir(path.join(directory, "src", "config"), {recursive: true})
  await fs.mkdir(path.join(directory, "src", "jobs"), {recursive: true})
  await fs.mkdir(path.join(directory, "src", "models"), {recursive: true})
  await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))
  await fs.writeFile(path.join(directory, "src", "models", "cold-record.js"), `import DatabaseRecord from ${JSON.stringify(recordPath)}

export default class ColdRecord extends DatabaseRecord {
  static async initializeRecord({configuration}) {
    this.registerRecordClass({configuration})
    this._columns = []
    this._columnsAsHash = {}
    this._initialized = true
  }

  static async hasTranslationsTable() {
    return false
  }
}
`)
  await fs.writeFile(path.join(directory, "src", "jobs", "query-cold-record-job.js"), `import VelociousJob from ${JSON.stringify(jobPath)}
import ColdRecord from "../models/cold-record.js"

export default class QueryColdRecordJob extends VelociousJob {
  static databaseIdentifiers = []

  async perform(label) {
    ColdRecord.where({label})
    process.send?.({type: "cold-record-query-completed", label})
  }
}
`)
  await fs.writeFile(path.join(directory, "src", "config", "configuration.js"), `import Configuration from ${JSON.stringify(configurationPath)}
import EnvironmentHandlerNode from ${JSON.stringify(environmentHandlerPath)}
import InitializerFromRequireContext from ${JSON.stringify(initializerPath)}
import ColdRecord from "../models/cold-record.js"

let modelInitializationAttempts = 0
let releaseFirstAttempt
const firstAttemptReleased = new Promise((resolve) => { releaseFirstAttempt = resolve })

process.on("message", (message) => {
  if (message?.type === "release-first-model-initialization") releaseFirstAttempt()
})

const requireContext = (fileName) => {
  if (fileName !== "./cold-record.js") throw new Error(\`Unexpected model path: \${fileName}\`)
  return {default: ColdRecord}
}
requireContext.keys = () => ["./cold-record.js"]
requireContext.id = "pooled-runner-child-model-initialization-spec"

const configuration = new Configuration({
  database: {test: {}},
  directory: ${JSON.stringify(directory)},
  environment: "test",
  environmentHandler: new EnvironmentHandlerNode(),
  initializeModels: async ({configuration}) => {
    modelInitializationAttempts += 1
    process.send?.({type: "model-initialization-started", attempt: modelInitializationAttempts})

    if (modelInitializationAttempts === 1) {
      await firstAttemptReleased
      throw new Error("Injected model initialization failure")
    }

    await new InitializerFromRequireContext({requireContext}).initialize({configuration})
  },
  locale: "en",
  localeFallbacks: {en: ["en"]},
  locales: ["en"]
})

export default configuration
`)
}

describe("Background jobs - pooled child model initialization", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("re-initializes models after a shared cold-bootstrap failure before admitting later jobs", async () => {
    const directory = path.join(repoRoot(), "tmp", `pooled-child-model-initialization-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const reports = []
    const ipcMessages = []
    const server = net.createServer()
    /** @type {import("child_process").ChildProcess | undefined} */
    let child

    try {
      await writeTemporaryApp(directory)
      server.on("connection", (socket) => {
        const jsonSocket = new JsonSocket(socket)

        jsonSocket.on("message", (message) => {
          if (message?.type !== "job-complete" && message?.type !== "job-failed") return

          reports.push(message)
          jsonSocket.send({type: "job-updated", jobId: message.jobId})
        })
      })
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Runner status server did not bind to a TCP port")

      child = fork(POOLED_RUNNER_ENTRY_PATH, [], {
        cwd: directory,
        execArgv: [],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: {
          ...process.env,
          VELOCIOUS_ENV: "test",
          VELOCIOUS_BACKGROUND_JOBS_HOST: "127.0.0.1",
          VELOCIOUS_BACKGROUND_JOBS_PORT: `${address.port}`
        }
      })
      child.on("message", (message) => ipcMessages.push(ipcRecord(message)))

      const initialJobIds = Array.from({length: 19}, (_, index) => `cold-${index + 1}`)
      const firstInitializationStarted = waitForChildMessage(child, (record) => record.type === "model-initialization-started" && record.attempt === 1)

      child.send({type: "job", payload: {id: initialJobIds[0], jobName: "QueryColdRecordJob", args: [initialJobIds[0]]}})
      await firstInitializationStarted

      const initialOutcomesPromise = waitForJobOutcomes(child, initialJobIds)
      for (const jobId of initialJobIds.slice(1)) {
        child.send({type: "job", payload: {id: jobId, jobName: "QueryColdRecordJob", args: [jobId]}})
      }
      child.send({type: "release-first-model-initialization"})

      const settledInitialOutcomes = await initialOutcomesPromise

      expect(settledInitialOutcomes.map((outcome) => outcome.jobId)).toEqual(initialJobIds)
      expect(settledInitialOutcomes.every((outcome) => outcome.acknowledged === false)).toEqual(true)
      expect(settledInitialOutcomes.every((outcome) => outcome.status === undefined)).toEqual(true)
      expect(settledInitialOutcomes.every((outcome) => outcome.error === "Injected model initialization failure")).toEqual(true)

      const recoveryJobId = "recovery"
      const recoveryOutcomePromise = waitForChildMessage(child, (record) => record.type === "job-outcome" && record.jobId === recoveryJobId)
      child.send({type: "job", payload: {id: recoveryJobId, jobName: "QueryColdRecordJob", args: [recoveryJobId]}})
      const recoveryOutcome = await recoveryOutcomePromise
      const recoveryReport = reports.find((report) => report.jobId === recoveryJobId)

      expect(recoveryReport?.error).toEqual(undefined)
      expect(recoveryOutcome.jobId).toEqual(recoveryJobId)
      expect(recoveryOutcome.acknowledged).toEqual(true)
      expect(recoveryOutcome.status).toEqual("completed")
      expect(recoveryOutcome.error).toEqual(undefined)
      expect(ipcMessages.filter((message) => message.type === "model-initialization-started").map((message) => message.attempt)).toEqual([1, 2])
      expect(ipcMessages.some((message) => message.type === "cold-record-query-completed" && message.label === recoveryJobId)).toEqual(true)
      expect(reports).toEqual([{type: "job-complete", jobId: recoveryJobId}])
    } finally {
      if (child && child.exitCode === null && !child.killed) {
        const childExit = waitForEvent(child, "exit", {timeoutMs: 5000})
        child.kill("SIGTERM")
        await childExit
      }
      await new Promise((resolve) => server.close(resolve))
      await fs.rm(directory, {recursive: true, force: true})
    }
  })
})
