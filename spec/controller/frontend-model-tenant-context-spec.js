// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelController from "../../src/frontend-model-controller.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "../../src/frontend-models/transport-serialization.js"

class TenantAwareFrontendModelController extends FrontendModelController {
  /**
   * @param {string} commandType
   * @returns {Promise<Record<string, any>>}
   */
  async frontendModelCommandPayload(commandType) {
    return {
      commandType,
      model: this.frontendModelParams().model,
      status: "success",
      tenantSlug: /** @type {{slug?: string} | undefined} */ (this.getConfiguration().getCurrentTenant())?.slug
    }
  }
}

/**
 * @param {Record<string, any>} params
 * @returns {Promise<Record<string, any>>}
 */
async function runFrontendApi(params) {
  const configuration = new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    tenantResolver: async ({params: requestParams}) => {
      const projectSlug = requestParams.where?.project_slug
        || requestParams.attributes?.project_slug
        || requestParams.project_slug

      if (!projectSlug) return

      return {slug: projectSlug}
    }
  })
  const client = {remoteAddress: "127.0.0.1"}
  const request = new Request({client, configuration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))

  request.feed(Buffer.from([
    "POST /frontend-models HTTP/1.1",
    "Host: example.com",
    "Content-Length: 0",
    "",
    ""
  ].join("\r\n"), "utf8"))

  await donePromise

  const controller = new TenantAwareFrontendModelController({
    action: "frontendApi",
    configuration,
    controller: "frontend-models",
    params,
    request,
    response: new Response({configuration}),
    viewPath: process.cwd()
  })

  await controller.frontendApi()

  return /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(JSON.parse(controller.response().getBody())))
}

describe("Controller frontend model tenant context", () => {
  it("resolves tenant context from each batched shared frontend-model request entry", async () => {
    const response = await runFrontendApi(serializeFrontendModelTransportValue({
      requests: [{
        commandType: "index",
        model: "Task",
        payload: {
          where: {
            project_slug: "alpha"
          }
        },
        requestId: "request-1"
      }]
    }))

    expect(response.status).toEqual("success")
    expect(response.responses[0].requestId).toEqual("request-1")
    expect(response.responses[0].response.commandType).toEqual("index")
    expect(response.responses[0].response.model).toEqual("Task")
    expect(response.responses[0].response.status).toEqual("success")
    expect(response.responses[0].response.tenantSlug).toEqual("alpha")
  })
})
