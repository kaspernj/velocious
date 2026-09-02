// @ts-check

import Configuration from "../../src/configuration.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelController from "../../src/frontend-model-controller.js"
import LoggerArrayOutput from "../../src/logger/outputs/array-output.js"
import RequestTiming from "../../src/http-server/client/request-timing.js"
import Response from "../../src/http-server/client/response.js"
import WebsocketRequest from "../../src/http-server/client/websocket-request.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("Frontend model controller log redaction", () => {
  it("preserves error diagnostics while redacting request values and structured context", async () => {
    const secret = "SYNTHETIC_FRONTEND_ERROR_SECRET_6993A903"
    const output = new LoggerArrayOutput()
    const configuration = new Configuration({
      database: {test: {}},
      directory: dummyDirectory(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {outputs: [{levels: ["error"], output}]}
    })
    const request = new WebsocketRequest({method: "POST", params: {serviceToken: secret}, path: "/frontend-models"})
    const response = new Response({configuration})

    const previousConfiguration = Configuration.current()

    configuration.setCurrent()
    try {
      const controller = new FrontendModelController({
        action: "frontendApi",
        configuration,
        controller: "frontend-models",
        params: request.params(),
        request: /** @type {import("../../src/http-server/client/request.js").default} */ (request),
        response,
        viewPath: `${dummyDirectory()}/src/routes/frontend-models`
      })
      const requestTiming = new RequestTiming()

      requestTiming.registerLogSensitiveValues(configuration.getLogRedactor().requestSensitiveValues(request))

      /** @type {Array<{context: Record<string, ReturnType<typeof JSON.parse>>, error: Error, requestDetails: import("../../src/configuration-types.js").ErrorRequestDetails}>} */
      const frameworkErrors = []

      configuration.getErrorEvents().on("framework-error", (payload) => {
        frameworkErrors.push(/** @type {{context: Record<string, ReturnType<typeof JSON.parse>>, error: Error, requestDetails: import("../../src/configuration-types.js").ErrorRequestDetails}} */ (payload))
      })

      const error = new Error(`Synthetic frontend failure ${secret}`)
      const errorContext = /** @type {import("../../src/configuration-types.js").ClientErrorPayloadContext & {action: string, expectedError: boolean, frontendModelEndpoint: true}} */ ({
        action: "frontendApi",
        commandType: "index",
        correlationId: "visible-correlation-id",
        expectedError: false,
        frontendModelEndpoint: true,
        model: "Task",
        requestId: "visible-request-id",
        safeContext: "visible-frontend-context",
        serviceToken: secret
      })

      await configuration.runWithRequestTiming(requestTiming, async () => {
        await controller.frontendModelLogEndpointError({error, errorContext})
      })

      const message = output.getLogs()[0].message
      const serializedContext = JSON.stringify(frameworkErrors[0].context)
      const serializedRequestDetails = JSON.stringify(frameworkErrors[0].requestDetails)

      expect(message.includes(secret)).toEqual(false)
      expect(message).toContain("[REDACTED]")
      expect(message).toContain("Error")
      expect(message).toContain("frontend-model-log-redaction-spec.js")
      expect(message).toContain("visible-correlation-id")
      expect(serializedContext.includes(secret)).toEqual(false)
      expect(serializedContext).toContain("visible-frontend-context")
      expect(frameworkErrors[0].error.message.includes(secret)).toEqual(false)
      expect(serializedRequestDetails.includes(secret)).toEqual(false)
    } finally {
      previousConfiguration.setCurrent()
    }
  })
})
