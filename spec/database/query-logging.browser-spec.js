// @ts-check

import Configuration from "../../src/configuration.js"
import LoggerArrayOutput from "../../src/logger/outputs/array-output.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"
import {describe, expect, it} from "../../src/testing/test.js"

/** @typedef {import("../../src/configuration-types.js").LoggingConfiguration} LoggingConfiguration */
/** @typedef {Configuration & {_logging?: LoggingConfiguration}} MutableLoggingConfiguration */

/**
 * @param {function(LoggerArrayOutput): Promise<void>} callback - Callback with captured query logs.
 * @param {object} [args] - Options object.
 * @param {boolean | undefined} [args.queryLogging] - Query logging override.
 * @returns {Promise<void>} - Resolves when complete.
 */
async function withQueryLogOutput(callback, args = {}) {
  const configuration = /** @type {MutableLoggingConfiguration} */ (Configuration.current())
  const previousLogging = configuration._logging
  const arrayOutput = new LoggerArrayOutput()
  const queryLogging = "queryLogging" in args ? args.queryLogging : true
  const logging = /** @type {LoggingConfiguration} */ ({
    console: false,
    file: false,
    outputs: [{output: arrayOutput, levels: ["info"]}]
  })

  if (queryLogging !== undefined) logging.queryLogging = queryLogging

  configuration._logging = logging

  try {
    await callback(arrayOutput)
  } finally {
    configuration._logging = previousLogging
  }
}

/** @param {LoggerArrayOutput} arrayOutput - Log output. */
function logMessages(arrayOutput) {
  return arrayOutput.getLogs().map((log) => log.message)
}

describe("Database - query logging", {tags: ["dummy"]}, () => {
  it("does not log database queries by default in test", async () => {
    await withQueryLogOutput(async (arrayOutput) => {
      await Configuration.current().ensureConnections(async (dbs) => {
        await dbs.default.query("SELECT 1 AS query_logging_disabled_result")
      })

      const messages = logMessages(arrayOutput)

      expect(messages.some((message) => message.includes("query_logging_disabled_result"))).toBeFalse()
    }, {queryLogging: undefined})
  })

  it("logs model loads with elapsed time at info level", async () => {
    const project = await Project.create({name: "Query logging project"})
    const task = await Task.create({name: "Query logging task", project})

    await withQueryLogOutput(async (arrayOutput) => {
      await Task.find(task.id())

      const logs = arrayOutput.getLogs()
      const loadLog = logs.find((log) => log.subject == "Task Load")

      expect(loadLog?.level).toEqual("info")
      expect(loadLog?.message).toMatch(/^Task Load \(\d+\.\dms\) {2}SELECT /)
      expect(loadLog?.message).toContain("tasks")
    })
  })

  it("logs raw driver queries as SQL", async () => {
    await withQueryLogOutput(async (arrayOutput) => {
      await Configuration.current().ensureConnections(async (dbs) => {
        await dbs.default.query("SELECT 1 AS query_logging_result")
      })

      const messages = logMessages(arrayOutput)

      expect(messages.some((message) => /^SQL \(\d+\.\dms\) {2}SELECT 1 AS query_logging_result/.test(message))).toBeTrue()
    })
  })

  it("logs model write operation names", async () => {
    const project = await Project.create({name: "Query logging write project"})

    await withQueryLogOutput(async (arrayOutput) => {
      const task = await Task.create({name: "Query logging write task", project})

      task.setName("Query logging write task updated")
      await task.save()
      await task.destroy()

      const subjects = arrayOutput.getLogs().map((log) => log.subject)

      expect(subjects).toContain("Task Create")
      expect(subjects).toContain("Task Update")
      expect(subjects).toContain("Task Destroy")
    })
  })
})
