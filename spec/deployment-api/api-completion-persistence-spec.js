// @ts-check

import {beforeEach, describe, expect, it} from "../../src/testing/test.js"
import DeploymentRunStore from "../../src/deployment-api/run-store.js"
import Dummy from "../dummy/index.js"
import Request from "../../src/http-server/client/request.js"
import Response from "../../src/http-server/client/response.js"
import VelociousDeploymentApiController from "../../src/deployment-api/controller.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {getDeploymentMount} from "../../src/deployment-api/registry.js"
import {postDeploymentRun} from "../helpers/deployment-api-helper.js"
import {testDeploymentAdapter, VALID_REVISION} from "../dummy/src/support/test-deployment-adapter.js"

const TOKEN = "test-deployment-token"
const MOUNT_PATH = "/velocious/deployments"
const SUCCESS_PERSISTENCE_ERROR = new Error("Injected success-state persistence failure")

class SuccessPersistenceFailingRunStore extends DeploymentRunStore {
  /** @returns {Promise<void>} - Rejects to simulate success-state persistence failure. */
  async markSucceeded() {
    throw SUCCESS_PERSISTENCE_ERROR
  }
}

/**
 * Builds a parsed request suitable for direct controller execution.
 * @returns {Promise<Request>} - Parsed request.
 */
async function deploymentRequest() {
  const request = new Request({client: {remoteAddress: "127.0.0.1"}, configuration: dummyConfiguration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))

  request.feed(Buffer.from([
    `GET ${MOUNT_PATH}/runs HTTP/1.1`,
    "Host: example.com",
    "Content-Length: 0",
    "",
    ""
  ].join("\r\n"), "utf8"))

  await donePromise

  return request
}

describe("Deployment API - completion persistence safety", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  beforeEach(() => {
    testDeploymentAdapter.reset()
  })

  it("keeps a successful external activation truthful and duplicate-safe when success persistence fails", async () => {
    await Dummy.run(async () => {
      dummyConfiguration.setCurrent()

      const options = getDeploymentMount(dummyConfiguration, MOUNT_PATH)

      if (!options) throw new Error(`Expected deployment API mount at ${MOUNT_PATH}`)

      const store = new SuccessPersistenceFailingRunStore({configuration: dummyConfiguration})
      const outcome = await store.createRunIfPossible({
        idempotencyKey: "success-persistence-failure",
        project: "dummy-project",
        revision: VALID_REVISION,
        stage: "production"
      })
      const run = outcome.run

      if (!run) throw new Error("Expected deployment run to be created")

      const controller = new VelociousDeploymentApiController({
        action: "create",
        configuration: dummyConfiguration,
        controller: "velocious-deployment-api",
        params: {velociousDeploymentMountAt: MOUNT_PATH},
        request: await deploymentRequest(),
        response: new Response({configuration: dummyConfiguration}),
        viewPath: process.cwd()
      })

      controller._deploymentRunStore = store

      /** @type {Array<Record<string, ?>>} */
      const frameworkErrors = []
      /** @type {Array<Record<string, ?>>} */
      const allErrors = []
      const errorEvents = dummyConfiguration.getErrorEvents()
      const listener = (payload) => {
        frameworkErrors.push(/** @type {Record<string, ?>} */ (payload))
      }
      const allErrorListener = (payload) => {
        allErrors.push(/** @type {Record<string, ?>} */ (payload))
      }

      errorEvents.on("framework-error", listener)
      errorEvents.on("all-error", allErrorListener)

      try {
        await controller._executeRun({options, run})

        const persisted = await store.findRunById(run.id)

        if (!persisted) throw new Error(`Expected deployment run ${run.id} to remain persisted`)

        expect(testDeploymentAdapter.deployCalls.length).toEqual(1)
        expect(persisted.status).toEqual("reconciliation_required")
        expect(persisted.result).toEqual(null)
        expect(/** @type {Record<string, ?>} */ (persisted.error).message).toContain("activation succeeded")

        const second = await postDeploymentRun({
          payload: {
            idempotencyKey: "must-not-deploy-after-success-persistence-failure",
            project: "dummy-project",
            revision: VALID_REVISION,
            stage: "production"
          },
          token: TOKEN
        })

        expect(second.status).toEqual(409)
        expect(second.body.error).toEqual("deployment_reconciliation_required")
        expect(second.body.runId).toEqual(run.id)
        expect(testDeploymentAdapter.deployCalls.length).toEqual(1)

        const events = await store.listAuditEvents({runId: run.id})

        expect(events.map((event) => event.event)).toContain("run_reconciliation_required")
        expect(frameworkErrors.length).toEqual(1)
        expect(frameworkErrors[0].context).toEqual("deployment-api-record-success")
        expect(frameworkErrors[0].error).toEqual(SUCCESS_PERSISTENCE_ERROR)
        expect(allErrors.length).toEqual(1)
        expect(allErrors[0].context).toEqual("deployment-api-record-success")
        expect(allErrors[0].error).toEqual(SUCCESS_PERSISTENCE_ERROR)
        expect(allErrors[0].errorType).toEqual("framework-error")
      } finally {
        errorEvents.removeListener("framework-error", listener)
        errorEvents.removeListener("all-error", allErrorListener)
      }
    })
  })
})
