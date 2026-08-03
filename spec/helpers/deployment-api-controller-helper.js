// @ts-check

import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import VelociousDeploymentApiController from "../../src/deployment-api/controller.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

const MOUNT_PATH = "/velocious/deployments"
const TOKEN = "test-deployment-token"

/**
 * Builds a direct deployment API controller with an injected run store.
 * @param {object} args - Options.
 * @param {Record<string, ?>} [args.params] - Action parameters.
 * @param {import("../../src/deployment-api/run-store.js").default} args.store - Store injected into the controller.
 * @returns {Promise<VelociousDeploymentApiController>} - Controller.
 */
export async function buildDeploymentApiController({params = {}, store}) {
  const request = new Request({client: {remoteAddress: "127.0.0.1"}, configuration: dummyConfiguration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))

  request.feed(Buffer.from([
    `GET ${MOUNT_PATH}/runs HTTP/1.1`,
    "Host: example.com",
    `Authorization: Bearer ${TOKEN}`,
    "Content-Length: 0",
    "",
    ""
  ].join("\r\n"), "utf8"))

  await donePromise

  const controller = new VelociousDeploymentApiController({
    action: "create",
    configuration: dummyConfiguration,
    controller: "velocious-deployment-api",
    params: {...params, velociousDeploymentMountAt: MOUNT_PATH},
    request,
    response: new Response({configuration: dummyConfiguration}),
    viewPath: process.cwd()
  })

  controller._deploymentRunStore = store

  return controller
}
