// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import EventEmitter from "../../src/utils/event-emitter.js"
import LoggerArrayOutput from "../../src/logger/outputs/array-output.js"
import WebsocketSession from "../../src/http-server/client/websocket-session.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @typedef {object} ErrorEventPayload
 * @property {Record<string, ReturnType<typeof JSON.parse>>} context - Structured failure context.
 * @property {Error} error - Redacted reported error.
 * @property {string} [errorType] - All-error classification.
 */

describe("WebSocket message log redaction", () => {
  it("redacts handler failures in logs and framework error events while retaining diagnostics", async () => {
    const secret = "SYNTHETIC_WEBSOCKET_HANDLER_SECRET_6993A903"
    const output = new LoggerArrayOutput()
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {outputs: [{levels: ["error"], output}]}
    })
    /** @type {ErrorEventPayload[]} */
    const frameworkErrors = []
    /** @type {ErrorEventPayload[]} */
    const allErrors = []
    /** @type {Error | undefined} */
    let handlerError

    configuration.getErrorEvents().on("framework-error", (payload) => {
      frameworkErrors.push(/** @type {ErrorEventPayload} */ (payload))
    })
    configuration.getErrorEvents().on("all-error", (payload) => {
      allErrors.push(/** @type {ErrorEventPayload} */ (payload))
    })

    const session = new WebsocketSession({
      client: /** @type {import("../../src/http-server/client/index.js").default} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
      configuration,
      messageHandler: {
        onError: ({error}) => { handlerError = error },
        onMessage: ({message}) => {
          const authenticationToken = /** @type {{params: {authenticationToken: string}}} */ (message).params.authenticationToken
          const error = new Error(`Safe authentication diagnostic ${authenticationToken}`)

          error.name = "SyntheticAuthenticationError"
          throw error
        }
      }
    })

    await session._dispatchMessage({params: {authenticationToken: secret}, type: "authentication-lookup"})

    const message = output.getLogs()[0].message
    const leakedValueCounts = {
      allError: allErrors.filter((payload) => payload.error.message.includes(secret)).length,
      frameworkError: frameworkErrors.filter((payload) => payload.error.message.includes(secret)).length,
      logger: message.includes(secret) ? 1 : 0
    }

    expect(leakedValueCounts).toEqual({allError: 0, frameworkError: 0, logger: 0})
    expect(message).toContain("[REDACTED]")
    expect(message).toContain("SyntheticAuthenticationError")
    expect(message).toContain("Safe authentication diagnostic")
    expect(message).toContain("websocket-message-log-redaction-spec.js")
    expect(frameworkErrors.length).toEqual(1)
    expect(frameworkErrors[0].error.message.includes(secret)).toEqual(false)
    expect(frameworkErrors[0].error.message).toContain("[REDACTED]")
    expect(frameworkErrors[0].error.name).toEqual("SyntheticAuthenticationError")
    expect(frameworkErrors[0].error.stack).toContain("websocket-message-log-redaction-spec.js")
    expect(frameworkErrors[0].context).toEqual({stage: "websocket-message-handler"})
    expect(allErrors.length).toEqual(1)
    expect(allErrors[0].error.message.includes(secret)).toEqual(false)
    expect(allErrors[0].error.message).toContain("[REDACTED]")
    expect(allErrors[0].context).toEqual({stage: "websocket-message-handler"})
    expect(allErrors[0].errorType).toEqual("framework-error")
    expect(handlerError?.message).toContain(secret)
  })
})
