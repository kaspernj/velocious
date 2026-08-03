// @ts-check

import {beforeEach, describe, expect, it} from "../../src/testing/test.js"
import {buildDeploymentApiController} from "../helpers/deployment-api-controller-helper.js"
import DeploymentRunStore from "../../src/deployment-api/run-store.js"
import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {deploymentMountIdentifier, getDeploymentMount} from "../../src/deployment-api/registry.js"
import {testDeploymentAdapter, VALID_REVISION} from "../dummy/src/support/test-deployment-adapter.js"
import {waitFor} from "awaitery"

const EXECUTE_ERROR = new Error("Injected pending-to-running persistence failure")
const FAILURE_PERSISTENCE_ERROR = new Error("Injected failure-state persistence failure")
const HEARTBEAT_ERROR = new Error("Injected heartbeat persistence failure")
const MOUNT_PATH = "/velocious/deployments"
const MOUNT_IDENTIFIER = deploymentMountIdentifier(MOUNT_PATH)

class MarkRunningFailingRunStore extends DeploymentRunStore {
  /** @returns {Promise<void>} - Rejects to simulate pending-to-running persistence failure. */
  async markRunning() {
    throw EXECUTE_ERROR
  }
}

class HeartbeatFailingRunStore extends DeploymentRunStore {
  /** @returns {Promise<void>} - Rejects to simulate heartbeat persistence failure. */
  async heartbeat() {
    throw HEARTBEAT_ERROR
  }
}

class FailurePersistenceFailingRunStore extends DeploymentRunStore {
  /** @returns {Promise<void>} - Rejects to simulate failure-state persistence failure. */
  async markFailed() {
    throw FAILURE_PERSISTENCE_ERROR
  }
}

/**
 * Captures both documented framework-failure channels.
 * @returns {{allErrors: Array<Record<string, ?>>, frameworkErrors: Array<Record<string, ?>>, stop: () => void}} - Capture state.
 */
function captureErrors() {
  /** @type {Array<Record<string, ?>>} */
  const allErrors = []
  /** @type {Array<Record<string, ?>>} */
  const frameworkErrors = []
  const errorEvents = dummyConfiguration.getErrorEvents()
  const allErrorListener = (payload) => allErrors.push(/** @type {Record<string, ?>} */ (payload))
  const frameworkErrorListener = (payload) => frameworkErrors.push(/** @type {Record<string, ?>} */ (payload))

  errorEvents.on("all-error", allErrorListener)
  errorEvents.on("framework-error", frameworkErrorListener)

  return {
    allErrors,
    frameworkErrors,
    stop: () => {
      errorEvents.removeListener("all-error", allErrorListener)
      errorEvents.removeListener("framework-error", frameworkErrorListener)
    }
  }
}

/**
 * Expects one error to have been emitted on both framework channels.
 * @param {object} args - Options.
 * @param {ReturnType<typeof captureErrors>} args.capture - Captured events.
 * @param {string} args.context - Expected deployment API context.
 * @param {Error} args.error - Expected error object.
 * @returns {void} - No return value.
 */
function expectErrorPair({capture, context, error}) {
  const frameworkPayload = capture.frameworkErrors.find((payload) => payload.context === context)
  const allErrorPayload = capture.allErrors.find((payload) => payload.context === context)

  expect(frameworkPayload?.error).toEqual(error)
  expect(allErrorPayload?.error).toEqual(error)
  expect(allErrorPayload?.errorType).toEqual("framework-error")
}

/**
 * Creates a pending run in the given store.
 * @param {DeploymentRunStore} store - Run store.
 * @param {string} idempotencyKey - Unique key.
 * @returns {Promise<import("../../src/deployment-api/run-store.js").DeploymentRunRow>} - Created run.
 */
async function createPendingRun(store, idempotencyKey) {
  const outcome = await store.createRunIfPossible({
    idempotencyKey,
    project: "dummy-project",
    revision: VALID_REVISION,
    stage: "production"
  })

  if (!outcome.run) throw new Error("Expected deployment run to be created")

  return outcome.run
}

describe("Deployment API - framework failure events", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  beforeEach(() => {
    testDeploymentAdapter.reset()
  })

  it("emits execute-run rejection on framework-error and all-error without deploying", async () => {
    await Dummy.run(async () => {
      dummyConfiguration.setCurrent()

      const store = new MarkRunningFailingRunStore({configuration: dummyConfiguration, mountIdentifier: MOUNT_IDENTIFIER})
      const controller = await buildDeploymentApiController({
        params: {
          idempotencyKey: "execute-run-rejection",
          project: "dummy-project",
          revision: VALID_REVISION,
          stage: "production"
        },
        store
      })
      const capture = captureErrors()

      try {
        await controller.create()
        await waitFor(() => {
          if (capture.frameworkErrors.some((payload) => payload.context === "deployment-api-execute-run")) return true
          throw new Error("Execute-run failure not emitted")
        })

        expectErrorPair({capture, context: "deployment-api-execute-run", error: EXECUTE_ERROR})
        expect(testDeploymentAdapter.deployCalls.length).toEqual(0)
      } finally {
        capture.stop()
      }
    })
  })

  it("emits heartbeat persistence failure on framework-error and all-error while preserving execution", async () => {
    await Dummy.run(async () => {
      dummyConfiguration.setCurrent()
      testDeploymentAdapter.deployBehavior = "hold"

      const store = new HeartbeatFailingRunStore({configuration: dummyConfiguration, mountIdentifier: MOUNT_IDENTIFIER})
      const run = await createPendingRun(store, "heartbeat-persistence-failure")
      const controller = await buildDeploymentApiController({store})
      const options = getDeploymentMount(dummyConfiguration, MOUNT_PATH)

      if (!options) throw new Error(`Expected deployment API mount at ${MOUNT_PATH}`)

      const capture = captureErrors()
      const execution = controller._executeRun({options, run})

      try {
        await waitFor(() => {
          if (capture.frameworkErrors.some((payload) => payload.context === "deployment-api-heartbeat")) return true
          throw new Error("Heartbeat failure not emitted")
        })

        expectErrorPair({capture, context: "deployment-api-heartbeat", error: HEARTBEAT_ERROR})
        expect(testDeploymentAdapter.deployCalls.length).toEqual(1)
      } finally {
        testDeploymentAdapter.releaseHold()
        await execution
        capture.stop()
      }
    })
  })

  it("emits failure-state persistence failure on framework-error and all-error", async () => {
    await Dummy.run(async () => {
      dummyConfiguration.setCurrent()
      testDeploymentAdapter.deployBehavior = "fail"

      const store = new FailurePersistenceFailingRunStore({configuration: dummyConfiguration, mountIdentifier: MOUNT_IDENTIFIER})
      const run = await createPendingRun(store, "failure-persistence-failure")
      const controller = await buildDeploymentApiController({store})
      const options = getDeploymentMount(dummyConfiguration, MOUNT_PATH)

      if (!options) throw new Error(`Expected deployment API mount at ${MOUNT_PATH}`)

      const capture = captureErrors()

      try {
        await controller._executeRun({options, run})

        expectErrorPair({capture, context: "deployment-api-record-failure", error: FAILURE_PERSISTENCE_ERROR})
        expect(testDeploymentAdapter.deployCalls.length).toEqual(1)
      } finally {
        capture.stop()
      }
    })
  })
})
