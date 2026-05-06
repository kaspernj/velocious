// @ts-check

import Configuration from "../../src/configuration.js"
import DatabaseDriverBase from "../../src/database/drivers/base.js"
import RequestTiming from "../../src/http-server/client/request-timing.js"
import LoggerArrayOutput from "../../src/logger/outputs/array-output.js"
import Project from "../dummy/src/models/project.js"
import Task from "../dummy/src/models/task.js"
import {describe, expect, it} from "../../src/testing/test.js"

/** @typedef {import("../../src/configuration-types.js").LogLevel} LogLevel */
/** @typedef {import("../../src/configuration-types.js").LoggingConfiguration} LoggingConfiguration */
/** @typedef {Configuration & {_logging?: LoggingConfiguration}} MutableLoggingConfiguration */

class TestDriver extends DatabaseDriverBase {
  /** @type {string | undefined} */
  lastSourceStack = undefined

  async _queryActual() {
    return []
  }

  async _queryActualWithLogging(sql, options, requestTiming, tries) {
    this.lastSourceStack = options.sourceStack

    return await super._queryActualWithLogging(sql, options, requestTiming, tries)
  }

  async connect() {}

  getType() { return "test" }
  primaryKeyType() { return "bigint" }
  queryToSql() { return "" }
}

class TimingDriver extends TestDriver {
  /** @type {function(number): void} */
  advanceTime

  /**
   * @param {import("../../src/configuration-types.js").DatabaseConfigurationType} config - Database config.
   * @param {Configuration} configuration - Configuration.
   * @param {object} args - Options object.
   * @param {function(number): void} args.advanceTime - Advances fake time.
   */
  constructor(config, configuration, {advanceTime}) {
    super(config, configuration)

    this.advanceTime = advanceTime
  }

  async _queryActual() {
    this.advanceTime(5)

    return []
  }

  async _logQuery() {
    this.advanceTime(100)
  }
}

/**
 * @param {function(LoggerArrayOutput): Promise<void>} callback - Callback with captured query logs.
 * @param {object} [args] - Options object.
 * @param {LogLevel[]} [args.levels] - Enabled output levels.
 * @param {boolean | undefined} [args.queryLogging] - Query logging override.
 * @returns {Promise<void>} - Resolves when complete.
 */
async function withQueryLogOutput(callback, args = {}) {
  const configuration = /** @type {MutableLoggingConfiguration} */ (Configuration.current())
  const previousLogging = configuration._logging
  const arrayOutput = new LoggerArrayOutput()
  const levels = args.levels || ["info"]
  const queryLogging = "queryLogging" in args ? args.queryLogging : true
  const logging = /** @type {LoggingConfiguration} */ ({
    console: false,
    file: false,
    outputs: [{output: arrayOutput, levels}]
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

  it("does not prepare source stacks when info logs are filtered", async () => {
    await withQueryLogOutput(async () => {
      const driver = new TestDriver({}, Configuration.current())

      await driver.query("SELECT 1 AS query_logging_filtered_result")

      expect(driver.lastSourceStack).toBeUndefined()
    }, {levels: ["warn"], queryLogging: true})
  })

  it("omits query source lines when the runtime has no project directory", () => {
    const configuration = /** @type {Configuration} */ (Object.create(Configuration.current()))
    const driver = new TestDriver({}, configuration)

    configuration.getDirectoryIfAvailable = () => undefined
    configuration.getDirectory = () => {
      throw new Error("getDirectory should not be called when no directory is available")
    }

    const sourceLine = driver._querySourceLine([
      "Error: Query source",
      "    at VelociousDatabaseDriversBase.query (/bundle/entry.js:700:10)"
    ].join("\n"))

    expect(sourceLine).toBeUndefined()
  })

  it("skips configured framework frames when selecting the query source line", () => {
    const configuration = /** @type {Configuration} */ (Object.create(Configuration.current()))
    const driver = new TestDriver({}, configuration)

    configuration.getDirectoryIfAvailable = () => "/app"
    configuration.getEnvironmentHandler = () => ({
      getFrameworkSourceDirectory: () => "/app/vendor/velocious/src"
    })

    const sourceLine = driver._querySourceLine([
      "Error: Query source",
      "    at VelociousDatabaseDriversBase.query (/app/vendor/velocious/src/database/drivers/base.js:700:10)",
      "    at CountryController.show (/app/src/routes/countries/controller.js:44:8)"
    ].join("\n"))

    expect(sourceLine).toEqual("src/routes/countries/controller.js:44:in CountryController.show")
  })

  it("excludes query log work from request database timing", async () => {
    const configuration = Configuration.current()
    const requestTiming = new RequestTiming()
    const originalNow = Date.now
    let currentTime = 1000
    let summary

    try {
      Date.now = () => currentTime
      requestTiming.startedAtMs = currentTime

      await withQueryLogOutput(async () => {
        const driver = new TimingDriver({}, configuration, {
          advanceTime: (ms) => {
            currentTime += ms
          }
        })

        await configuration.runWithRequestTiming(requestTiming, async () => {
          await driver.query("SELECT 1 AS query_logging_timing_result")
        })
      })

      summary = requestTiming.summary()
    } finally {
      Date.now = originalNow
    }

    expect(summary?.dbMs).toEqual(5)
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
