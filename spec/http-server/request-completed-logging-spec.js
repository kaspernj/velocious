// @ts-check

import Configuration from "../../src/configuration.js"
import Controller from "../../src/controller.js"
import DatabaseDriverBase from "../../src/database/drivers/base.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import LoggerArrayOutput from "../../src/logger/outputs/array-output.js"
import Request from "../../src/http-server/client/request.js"
import RequestRunner from "../../src/http-server/client/request-runner.js"
import RequestTiming from "../../src/http-server/client/request-timing.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import dummyRoutes from "../dummy/src/config/routes.js"
import {describe, expect, it} from "../../src/testing/test.js"

class DbTimingController extends Controller {
  async show() {
    const requestTiming = this.getConfiguration().getCurrentRequestTiming()

    if (!requestTiming) throw new Error("Missing request timing")

    await requestTiming.measureDbQuery(async () => {})
    await this.render({json: {status: "success"}})
  }
}

class TestDriver extends DatabaseDriverBase {
  async _queryActual() {
    return []
  }

  async connect() {}

  getType() { return "test" }
  primaryKeyType() { return "bigint" }
  queryToSql() { return "" }
}

/** @returns {{arrayOutput: LoggerArrayOutput, configuration: Configuration, restore: () => void}} - Test configuration. */
function buildConfiguration() {
  const arrayOutput = new LoggerArrayOutput()
  const configuration = new Configuration({
    database: {test: {}},
    directory: dummyDirectory(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging: {loggers: [arrayOutput]}
  })
  let previousConfiguration

  try {
    previousConfiguration = Configuration.current()
  } catch {
    // Ignore missing current configuration.
  }

  configuration.setCurrent()
  configuration.setRoutes(dummyRoutes.routes)

  return {
    arrayOutput,
    configuration,
    restore: () => {
      if (previousConfiguration) previousConfiguration.setCurrent()
    }
  }
}

/**
 * @param {Configuration} configuration - Configuration.
 * @param {string} path - Request path.
 * @returns {Promise<RequestRunner>} - Completed request runner.
 */
async function runRequest(configuration, path) {
  const request = new Request({client: {remoteAddress: "127.0.0.1"}, configuration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))
  const requestLines = [
    `GET ${path} HTTP/1.1`,
    "Host: example.com",
    "",
    ""
  ].join("\r\n")

  request.feed(Buffer.from(requestLines, "utf8"))
  await donePromise

  const requestRunner = new RequestRunner({configuration, request})

  await requestRunner.run()
  await requestRunner.logCompletedRequest()

  return requestRunner
}

/** @param {import("../../src/configuration-types.js").LoggingOutputPayload[]} logs - Logs. */
function completedMessages(logs) {
  return logs
    .map((log) => log.message)
    .filter((message) => message.includes("Completed "))
}

describe("HttpServer - request completed logging", {databaseCleaning: {transaction: false, truncate: false}}, async () => {
  it("logs completed request metrics after the matching request start log", async () => {
    const {arrayOutput, configuration, restore} = buildConfiguration()

    try {
      await runRequest(configuration, "/ping")
    } finally {
      restore()
    }

    const logs = arrayOutput.getLogs()
    const startedIndex = logs.findIndex((log) => log.message.includes("Started GET \"/ping\""))
    const completedIndex = logs.findIndex((log) => log.message.includes("Completed 200 OK"))
    const completed = logs[completedIndex]

    expect(startedIndex).toBeGreaterThanOrEqual(0)
    expect(completedIndex).toBeGreaterThan(startedIndex)
    expect(completed.subject).toEqual("RootController")
    expect(completed.level).toEqual("debug")
    expect(completed.message).toMatch(/^RootController Completed 200 OK in \d+ms \(Controller: \d+\.\dms \| Views: \d+\.\dms \| DB: 0\.0ms \(0 queries\) \| Velocious: \d+\.\dms\)$/)
  })

  it("includes DB query count in completed request logs", async () => {
    const {arrayOutput, configuration, restore} = buildConfiguration()

    configuration.addRouteResolverHook(({currentPath}) => {
      if (currentPath !== "/db-timing") return null

      return {
        action: "show",
        controller: "db-timing",
        controllerClass: DbTimingController
      }
    })

    try {
      await runRequest(configuration, "/db-timing")
    } finally {
      restore()
    }

    expect(completedMessages(arrayOutput.getLogs())[0]).toMatch(/^DbTimingController Completed 200 OK in \d+ms \(Controller: \d+\.\dms \| Views: \d+\.\dms \| DB: \d+\.\dms \(1 query\) \| Velocious: \d+\.\dms\)$/)
  })

  it("logs completed request metrics for error responses", async () => {
    const {arrayOutput, configuration, restore} = buildConfiguration()

    try {
      const requestRunner = await runRequest(configuration, "/missing-view")

      expect(requestRunner.response.getStatusCode()).toEqual(500)
    } finally {
      restore()
    }

    expect(completedMessages(arrayOutput.getLogs())[0]).toMatch(/^RootController Completed 500 Internal server error in \d+ms \(Controller: \d+\.\dms \| Views: \d+\.\dms \| DB: 0\.0ms \(0 queries\) \| Velocious: \d+\.\dms\)$/)
  })

  it("tracks database driver query metrics through the current request timing context", async () => {
    const {configuration, restore} = buildConfiguration()
    const requestTiming = new RequestTiming()
    const driver = new TestDriver({}, configuration)

    try {
      await configuration.runWithRequestTiming(requestTiming, async () => {
        await driver.query("SELECT 1")
      })
    } finally {
      restore()
    }

    const summary = requestTiming.summary()

    expect(summary.dbQueryCount).toEqual(1)
  })

  it("includes active bucket elapsed time in request timing summaries", () => {
    const requestTiming = new RequestTiming()

    requestTiming.startedAtMs = 1000
    requestTiming.responseServedAtMs = 1500
    requestTiming.buckets.controller = 100
    requestTiming.buckets.db = 25
    requestTiming.buckets.views = 50
    requestTiming.bucketStack.push({bucket: "controller", startedAtMs: 1200})

    const summary = requestTiming.summary()

    expect(summary.totalMs).toEqual(500)
    expect(summary.controllerMs).toEqual(400)
    expect(summary.dbMs).toEqual(25)
    expect(summary.viewsMs).toEqual(50)
    expect(summary.velociousMs).toEqual(25)
    expect(requestTiming.buckets.controller).toEqual(100)
  })
})
