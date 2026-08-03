// @ts-check

import {beforeEach, describe, expect, it} from "../../src/testing/test.js"
import {buildDeploymentApiController} from "../helpers/deployment-api-controller-helper.js"
import DeploymentRunStore from "../../src/deployment-api/run-store.js"
import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {deploymentMountIdentifier, getDeploymentMount} from "../../src/deployment-api/registry.js"
import {postDeploymentRun} from "../helpers/deployment-api-helper.js"
import {testDeploymentAdapter, VALID_REVISION} from "../dummy/src/support/test-deployment-adapter.js"

const TOKEN = "test-deployment-token"
const MOUNT_PATH = "/velocious/deployments"
const MOUNT_IDENTIFIER = deploymentMountIdentifier(MOUNT_PATH)
const SUCCESS_PERSISTENCE_ERROR = new Error("Injected success-state persistence failure")

class SuccessPersistenceFailingRunStore extends DeploymentRunStore {
  /** @returns {Promise<void>} - Rejects to simulate success-state persistence failure. */
  async markSucceeded() {
    throw SUCCESS_PERSISTENCE_ERROR
  }
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

      const store = new SuccessPersistenceFailingRunStore({configuration: dummyConfiguration, mountIdentifier: MOUNT_IDENTIFIER})
      const outcome = await store.createRunIfPossible({
        idempotencyKey: "success-persistence-failure",
        project: "dummy-project",
        revision: VALID_REVISION,
        stage: "production"
      })
      const run = outcome.run

      if (!run) throw new Error("Expected deployment run to be created")

      const controller = await buildDeploymentApiController({store})
      let deployCalls = 0
      const executionOptions = {
        ...options,
        adapter: {
          deploy: async () => {
            deployCalls++

            return {activeRevision: VALID_REVISION}
          },
          validateRevision: async () => true
        }
      }

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
        await controller._executeRun({options: executionOptions, run})

        const persisted = await store.findRunById(run.id)

        if (!persisted) throw new Error(`Expected deployment run ${run.id} to remain persisted`)

        expect(deployCalls).toEqual(1)
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
        expect(deployCalls).toEqual(1)

        const events = await store.listAuditEvents({runId: run.id})
        const recordSuccessFrameworkErrors = frameworkErrors.filter((payload) => {
          return payload.context === "deployment-api-record-success" && payload.error === SUCCESS_PERSISTENCE_ERROR
        })
        const recordSuccessAllErrors = allErrors.filter((payload) => {
          return payload.context === "deployment-api-record-success" && payload.error === SUCCESS_PERSISTENCE_ERROR
        })

        expect(events.map((event) => event.event)).toContain("run_reconciliation_required")
        expect(recordSuccessFrameworkErrors.length).toEqual(1)
        expect(recordSuccessAllErrors.length).toEqual(1)
        expect(recordSuccessAllErrors[0].errorType).toEqual("framework-error")
      } finally {
        errorEvents.removeListener("framework-error", listener)
        errorEvents.removeListener("all-error", allErrorListener)
      }
    })
  })
})
