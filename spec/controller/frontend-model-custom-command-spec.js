// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Configuration from "../../src/configuration.js"
import Controller from "../../src/controller.js"
import dummyDirectory from "../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelController from "../../src/frontend-model-controller.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"

class CustomFrontendModelCommandController extends Controller {
  /** @returns {Promise<void>} */
  async ping() {
    await this.render({
      json: {
        receivedId: this.params().id,
        receivedName: this.params().name,
        status: "success"
      }
    })
  }

  /** @returns {Promise<void>} */
  async explode() {
    throw new Error("Custom frontend model command exploded.")
  }
}

describe("Controller frontend model custom commands", () => {
  it("dispatches custom frontend-model command paths through configured routes", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: dummyDirectory(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    configuration.routes((routes) => {
      routes.post("/custom-frontend-models/tasks/:id/ping", {to: [CustomFrontendModelCommandController, "ping"]})
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

    const controller = new FrontendModelController({
      action: "frontendApi",
      configuration,
      controller: "frontend-models",
      params: {},
      request,
      response: new Response({configuration}),
      viewPath: `${dummyDirectory()}/src/routes/frontend-models`
    })

    const response = await controller.frontendApiCustomCommandPayload({
      customPath: "/custom-frontend-models/tasks/123/ping",
      payload: {name: "John"}
    })

    expect(response.status).toEqual("success")
    expect(response.receivedId).toEqual("123")
    expect(response.receivedName).toEqual("John")
  })

  it("returns debug details for unexpected custom frontend-model command failures in test", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: dummyDirectory(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    configuration.routes((routes) => {
      routes.post("/custom-frontend-models/tasks/:id/explode", {to: [CustomFrontendModelCommandController, "explode"]})
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

    const response = new Response({configuration})
    const controller = new FrontendModelController({
      action: "frontendApi",
      configuration,
      controller: "frontend-models",
      params: {
        requests: [{
          commandType: "explode",
          customPath: "/custom-frontend-models/tasks/123/explode",
          model: "Task",
          payload: {},
          requestId: "request-1"
        }]
      },
      request,
      response,
      viewPath: `${dummyDirectory()}/src/routes/frontend-models`
    })

    await controller.frontendApi()
    const responsePayload = JSON.parse(String(response.getBody()))

    expect(responsePayload.status).toEqual("success")
    expect(responsePayload.responses[0].response.status).toEqual("error")
    expect(responsePayload.responses[0].response.errorMessage).toEqual("Request failed.")
    expect(responsePayload.responses[0].response.debugErrorClass).toEqual("Error")
    expect(responsePayload.responses[0].response.debugErrorMessage).toEqual("Custom frontend model command exploded.")
    expect(Array.isArray(responsePayload.responses[0].response.debugBacktrace)).toEqual(true)
    expect(responsePayload.responses[0].response.debugBacktrace[0]).toMatch(/Custom frontend model command exploded\./)
  })
})
