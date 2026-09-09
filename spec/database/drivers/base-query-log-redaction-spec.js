// @ts-check

import Configuration from "../../../src/configuration.js"
import DatabaseDriverBase from "../../../src/database/drivers/base.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"
import EventEmitter from "../../../src/utils/event-emitter.js"
import LoggerArrayOutput from "../../../src/logger/outputs/array-output.js"
import path from "node:path"
import RequestTiming from "../../../src/http-server/client/request-timing.js"
import WebsocketSession from "../../../src/http-server/client/websocket-session.js"
import WebsocketRequest from "../../../src/http-server/client/websocket-request.js"
import { describe, expect, it } from "../../../src/testing/test.js"

class QueryLogRedactionDriver extends DatabaseDriverBase {
  /** @type {string} */
  failureSecret = ""

  async connect() {}

  /** @returns {string} - Driver type. */
  getType() { return "test" }

  /** @returns {string} - Primary key type. */
  primaryKeyType() { return "bigint" }

  /** @returns {string} - Query SQL. */
  queryToSql() { return "" }

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<import("../../../src/database/drivers/base.js").QueryResultType>} - Query rows.
   */
  async _queryActual(sql) {
    if (sql.includes("FAIL_AUTH_LOOKUP")) throw new Error(`Synthetic lookup failure ${this.failureSecret}`)

    return []
  }
}

/**
 * @param {LoggerArrayOutput} output - Captured query logs.
 * @returns {Configuration} - Query logging configuration.
 */
function buildConfiguration(output) {
  return new Configuration({
    database: {test: {}},
    directory: path.resolve(import.meta.dirname, "../../.."),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging: {
      outputs: [{levels: ["info"], output}],
      queryLogging: true
    }
  })
}

describe("Database drivers - query log redaction", () => {
  it("redacts request credentials from successful and failed SQL diagnostics", async () => {
    const secret = "SYNTHETIC_SQL_SECRET_6993A903"
    const safeValue = "visible-sql-value"
    const output = new LoggerArrayOutput()
    const configuration = buildConfiguration(output)
    const driver = new QueryLogRedactionDriver({}, configuration)

    driver.failureSecret = secret

    const requestTiming = new RequestTiming()
    const request = new WebsocketRequest({method: "GET", params: {serviceToken: secret}, path: "/authentication"})
    const sensitiveValues = configuration.getLogRedactor().requestSensitiveValues(request)

    requestTiming.registerLogSensitiveValues(sensitiveValues)

    await configuration.runWithRequestTiming(requestTiming, async () => {
      await driver.query(`SELECT * FROM authentication_tokens WHERE token = '${secret}' AND label = '${safeValue}'`, {sourceStack: Error().stack})

      await expect(async () => {
        await driver.query(`SELECT * FROM authentication_tokens WHERE token = '${secret}' AND label = '${safeValue}' /* FAIL_AUTH_LOOKUP */`, {retry: false, sourceStack: Error().stack})
      }).toThrow(/Synthetic lookup failure/u)
    })

    const messages = output.getLogs().map((entry) => entry.message)

    expect(messages.length).toEqual(2)
    expect(messages.filter((message) => message.includes(secret)).length).toEqual(0)
    expect(messages.filter((message) => message.includes("[REDACTED]")).length).toEqual(2)
    expect(messages.filter((message) => message.includes("authentication_tokens")).length).toEqual(2)
    expect(messages.filter((message) => message.includes(safeValue)).length).toEqual(2)
    expect(messages.filter((message) => /\(\d+\.\dms\)/u.test(message)).length).toEqual(2)
    expect(messages.filter((message) => message.includes("base-query-log-redaction-spec.js")).length).toEqual(2)
    expect(messages[1]).toContain("FAILED Error")
  })

  it("registers websocket authentication params before message-handler queries", async () => {
    const secret = "SYNTHETIC_WEBSOCKET_SQL_SECRET_6993A903"
    const safeValue = "visible-websocket-sql-value"
    const output = new LoggerArrayOutput()
    const configuration = buildConfiguration(output)
    const driver = new QueryLogRedactionDriver({}, configuration)
    const session = new WebsocketSession({
      client: /** @type {import("../../../src/http-server/client/index.js").default} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
      configuration,
      messageHandler: {
        onMessage: async ({message}) => {
          const authenticationToken = /** @type {{params: {authenticationToken: string}}} */ (message).params.authenticationToken

          await driver.query(`SELECT * FROM authentication_tokens WHERE token = '${authenticationToken}' AND label = '${safeValue}'`)
        }
      }
    })

    await session._dispatchMessage({params: {authenticationToken: secret}, type: "authentication-lookup"})

    const messages = output.getLogs().map((entry) => entry.message)

    expect(messages.length).toEqual(1)
    expect(messages[0].includes(secret)).toEqual(false)
    expect(messages[0]).toContain("[REDACTED]")
    expect(messages[0]).toContain(safeValue)
  })

  it("uses isolated redaction contexts when an async handler resolver flushes queued messages", async () => {
    const firstSecret = "SYNTHETIC_QUEUED_FIRST_6993A903"
    const secondSecret = "SYNTHETIC_QUEUED_SECOND_6993A903"
    const output = new LoggerArrayOutput()
    const configuration = buildConfiguration(output)
    const driver = new QueryLogRedactionDriver({}, configuration)
    /** @type {(handler: import("../../../src/configuration-types.js").WebsocketMessageHandler) => void} */
    let resolveHandler = () => {}
    const messageHandlerPromise = new Promise((resolve) => { resolveHandler = resolve })
    const session = new WebsocketSession({
      client: /** @type {import("../../../src/http-server/client/index.js").default} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
      configuration,
      messageHandlerPromise
    })
    const initializePromise = session.initializeChannel()

    await session._handleMessage({params: {authenticationToken: firstSecret, visibleValue: secondSecret}, type: "authentication-lookup"})
    await session._handleMessage({params: {authenticationToken: secondSecret, visibleValue: firstSecret}, type: "authentication-lookup"})

    resolveHandler({
      onMessage: async ({message}) => {
        const params = /** @type {{params: {authenticationToken: string, visibleValue: string}}} */ (message).params

        await driver.query(`SELECT * FROM authentication_tokens WHERE token = '${params.authenticationToken}' AND label = '${params.visibleValue}'`)
      }
    })
    await initializePromise

    const messages = output.getLogs().map((entry) => entry.message)
    const leakedValueCounts = {
      first: messages[0].includes(firstSecret) ? 1 : 0,
      second: messages[1].includes(secondSecret) ? 1 : 0
    }

    expect(messages.length).toEqual(2)
    expect(leakedValueCounts).toEqual({first: 0, second: 0})
    expect(messages[0]).toContain(secondSecret)
    expect(messages[0]).toContain("[REDACTED]")
    expect(messages[1]).toContain(firstSecret)
    expect(messages[1]).toContain("[REDACTED]")
  })
})
