// @ts-check

import Configuration from "../../src/configuration.js"
import Controller from "../../src/controller.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import FrontendModelBase from "../../src/frontend-models/base.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {deserializeFrontendModelTransportValue} from "../../src/frontend-models/transport-serialization.js"

/** Test frontend model for controller render specs. */
class RenderTask extends FrontendModelBase {
  /** @returns {{attributes: string[], modelName: string, path: string, primaryKey: string}} - Resource config. */
  static resourceConfig() {
    return {
      attributes: ["id", "name"],
      modelName: "RenderTask",
      path: "/render-tasks",
      primaryKey: "id"
    }
  }

  /** @returns {number} - Task id. */
  id() { return this.readAttribute("id") }

  /** @returns {string} - Task name. */
  name() { return this.readAttribute("name") }
}

FrontendModelBase.registerModel(RenderTask)

class JsonRenderController extends Controller {
  /**
   * @param {{attributes: () => Record<string, any>, constructor: {getModelName: () => string}, getModelClass: () => {getRelationshipsMap: () => Record<string, any>}, getRelationshipByName: (relationshipName: string) => {getPreloaded: () => boolean, loaded: () => any}}} task
   * @returns {Promise<void>}
   */
  async renderTask(task) {
    await this.render({
      json: {
        task,
        tasks: [task]
      }
    })
  }
}

/**
 * @returns {Promise<{controller: JsonRenderController, response: Response}>}
 */
async function buildController() {
  const configuration = new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
  const client = {remoteAddress: "127.0.0.1"}
  const request = new Request({client, configuration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))

  request.feed(Buffer.from([
    "GET /tasks HTTP/1.1",
    "Host: example.com",
    "Content-Length: 0",
    "",
    ""
  ].join("\r\n"), "utf8"))

  await donePromise

  const response = new Response({configuration})
  const controller = new JsonRenderController({
    action: "index",
    configuration,
    controller: "tasks",
    params: {},
    request,
    response,
    viewPath: process.cwd()
  })

  return {controller, response}
}

describe("Controller JSON render frontend models", () => {
  it("auto-serializes backend models rendered in json payloads", async () => {
    const {controller, response} = await buildController()
    const task = {
      attributes: () => ({
        id: 7,
        name: "Rendered task"
      }),
      constructor: {
        getModelName: () => "RenderTask"
      },
      getModelClass: () => ({
        getRelationshipsMap: () => ({})
      }),
      getRelationshipByName: () => {
        throw new Error("No relationships should be read in this spec")
      }
    }

    await controller.renderTask(task)

    const payload = /** @type {{task: RenderTask, tasks: RenderTask[]}} */ (
      deserializeFrontendModelTransportValue(JSON.parse(String(response.getBody())))
    )

    expect(payload.task instanceof RenderTask).toEqual(true)
    expect(payload.task.id()).toEqual(7)
    expect(payload.tasks[0] instanceof RenderTask).toEqual(true)
    expect(payload.tasks[0].name()).toEqual("Rendered task")
  })
})
