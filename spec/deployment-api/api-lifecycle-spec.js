// @ts-check

import {beforeEach, describe, expect, it} from "../../src/testing/test.js"
import DeploymentRunStore from "../../src/deployment-api/run-store.js"
import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {deploymentMountIdentifier} from "../../src/deployment-api/registry.js"
import {getDeploymentRun, postDeploymentRun} from "../helpers/deployment-api-helper.js"
import {OTHER_REVISION, testDeploymentAdapter, VALID_REVISION} from "../dummy/src/support/test-deployment-adapter.js"
import {waitFor} from "awaitery"

const TOKEN = "test-deployment-token"
const MOUNT_IDENTIFIER = deploymentMountIdentifier("/velocious/deployments")

/**
 * @param {Record<string, ?>} overrides - Field overrides.
 * @returns {Record<string, ?>} - A valid run creation payload with overrides applied.
 */
function payload(overrides = {}) {
  return {
    idempotencyKey: `lifecycle-spec-${Math.random().toString(36).slice(2)}`,
    project: "dummy-project",
    revision: VALID_REVISION,
    stage: "production",
    ...overrides
  }
}

/**
 * @param {string} id - Run id.
 * @param {string} status - Expected terminal status.
 * @returns {Promise<Record<string, ?>>} - The run once it reaches the status.
 */
async function waitForRunStatus(id, status) {
  /** @type {Record<string, ?> | undefined} */
  let run

  await waitFor(async () => {
    const {body} = await getDeploymentRun({id, token: TOKEN})

    run = /** @type {Record<string, ?>} */ (body.run)

    if (run.status === status) return true
    throw new Error(`Run status is ${run.status}`)
  })

  return /** @type {Record<string, ?>} */ (run)
}

/**
 * @returns {DeploymentRunStore} - Store bound to the dummy configuration.
 */
function runStore() {
  dummyConfiguration.setCurrent()

  return new DeploymentRunStore({configuration: dummyConfiguration, mountIdentifier: MOUNT_IDENTIFIER})
}

describe("Deployment API - run lifecycle", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  beforeEach(() => {
    testDeploymentAdapter.reset()
  })

  it("activates a deployment and reports bounded run state", async () => {
    await Dummy.run(async () => {
      const created = await postDeploymentRun({payload: payload(), token: TOKEN})

      expect(created.status).toEqual(202)

      const createdRun = /** @type {Record<string, ?>} */ (created.body.run)
      const run = await waitForRunStatus(/** @type {string} */ (createdRun.id), "succeeded")
      const result = /** @type {Record<string, ?>} */ (run.result)

      expect(run.project).toEqual("dummy-project")
      expect(run.stage).toEqual("production")
      expect(run.revision).toEqual(VALID_REVISION)
      expect(result.activeRevision).toEqual(VALID_REVISION)
      expect(result.releaseId).toEqual("20260803000000")
      expect(/** @type {Record<string, ?>} */ (result.previousRelease).activeRevision).toEqual(OTHER_REVISION)
      expect(result.health).toEqual([{name: "public-edge", ok: true}])
      expect(/** @type {Record<string, ?>} */ (result.publicEdge).status).toEqual(200)
      expect(typeof run.requestedAtMs).toEqual("number")
      expect(typeof run.startedAtMs).toEqual("number")
      expect(typeof run.finishedAtMs).toEqual("number")
      expect(run.error).toEqual(null)
    })
  })

  it("includes the adapter-provided live status in readback", async () => {
    await Dummy.run(async () => {
      const created = await postDeploymentRun({payload: payload(), token: TOKEN})
      const createdRun = /** @type {Record<string, ?>} */ (created.body.run)
      const {body} = await getDeploymentRun({id: /** @type {string} */ (createdRun.id), token: TOKEN})
      const current = /** @type {Record<string, ?>} */ (body.current)

      expect(current.activeRevision).toEqual(VALID_REVISION)
      expect(current.currentRelease).toEqual("20260803000000")
    })
  })

  it("reports restoration of the previous release when activation fails", async () => {
    await Dummy.run(async () => {
      testDeploymentAdapter.deployBehavior = "fail"

      const created = await postDeploymentRun({payload: payload(), token: TOKEN})

      expect(created.status).toEqual(202)

      const createdRun = /** @type {Record<string, ?>} */ (created.body.run)
      const run = await waitForRunStatus(/** @type {string} */ (createdRun.id), "failed")
      const error = /** @type {Record<string, ?>} */ (run.error)
      const recovery = /** @type {Record<string, ?>} */ (error.recovery)

      expect(error.message).toContain("health check failed")
      expect(recovery.restored).toEqual(true)
      expect(recovery.activeRevision).toEqual(OTHER_REVISION)
      expect(run.result).toEqual(null)
      expect(typeof run.finishedAtMs).toEqual("number")
    })
  })

  it("redacts configured tokens from adapter reports and failure messages", async () => {
    await Dummy.run(async () => {
      testDeploymentAdapter.includeTokenInReport = true

      const created = await postDeploymentRun({payload: payload(), token: TOKEN})
      const createdRun = /** @type {Record<string, ?>} */ (created.body.run)
      const run = await waitForRunStatus(/** @type {string} */ (createdRun.id), "succeeded")

      expect(JSON.stringify(run)).not.toContain(TOKEN)
      expect(JSON.stringify(run)).toContain("[redacted]")

      testDeploymentAdapter.deployBehavior = "fail"

      const failedCreate = await postDeploymentRun({payload: payload(), token: TOKEN})
      const failedCreatedRun = /** @type {Record<string, ?>} */ (failedCreate.body.run)
      const failedRun = await waitForRunStatus(/** @type {string} */ (failedCreatedRun.id), "failed")

      expect(JSON.stringify(failedRun)).not.toContain(TOKEN)
      expect(JSON.stringify(failedRun)).toContain("[redacted]")
    })
  })

  it("redacts nested secret-bearing object keys without losing colliding values in persisted and API-visible results", async () => {
    await Dummy.run(async () => {
      testDeploymentAdapter.includeTokenInKeys = true

      const created = await postDeploymentRun({payload: payload(), token: TOKEN})
      const createdRun = /** @type {Record<string, ?>} */ (created.body.run)
      const runId = /** @type {string} */ (createdRun.id)
      const apiRun = await waitForRunStatus(runId, "succeeded")
      const persistedRun = await runStore().findRunById(runId)

      if (!persistedRun) throw new Error(`Expected deployment run ${runId} to be persisted`)

      for (const result of [apiRun.result, persistedRun.result]) {
        const serialized = JSON.stringify(result)
        const payload = /** @type {Record<string, ?>} */ (/** @type {Record<string, ?>} */ (result).secretKeyPayload)
        const nested = /** @type {Record<string, ?>} */ (payload.nested)

        expect(serialized).not.toContain(TOKEN)
        expect(Object.values(payload)).toContain("literal-redacted-key")
        expect(Object.values(payload)).toContain("secret-bearing-key")
        expect(Object.keys(nested)).toEqual(["nested-[redacted]"])
        expect(nested["nested-[redacted]"]).toEqual("nested-secret-bearing-key")
      }
    })
  })

  it("records sanitized audit events for the run lifecycle", async () => {
    await Dummy.run(async () => {
      const created = await postDeploymentRun({payload: payload(), token: TOKEN})
      const createdRun = /** @type {Record<string, ?>} */ (created.body.run)
      const runId = /** @type {string} */ (createdRun.id)

      await waitForRunStatus(runId, "succeeded")

      const events = await runStore().listAuditEvents({runId})
      const eventNames = events.map((event) => event.event)

      expect(eventNames).toContain("run_requested")
      expect(eventNames).toContain("run_started")
      expect(eventNames).toContain("run_succeeded")

      for (const event of events) {
        expect(JSON.stringify(event.payload)).not.toContain(TOKEN)
      }
    })
  })

  it("keeps run state readable across an application restart", async () => {
    await Dummy.run(async () => {
      const created = await postDeploymentRun({payload: payload(), token: TOKEN})
      const createdRun = /** @type {Record<string, ?>} */ (created.body.run)
      const runId = /** @type {string} */ (createdRun.id)

      await waitForRunStatus(runId, "succeeded")

      await Dummy.run(async () => {
        const {body, status} = await getDeploymentRun({id: runId, token: TOKEN})
        const run = /** @type {Record<string, ?>} */ (body.run)

        expect(status).toEqual(200)
        expect(run.id).toEqual(runId)
        expect(run.status).toEqual("succeeded")
        expect(/** @type {Record<string, ?>} */ (run.result).activeRevision).toEqual(VALID_REVISION)
      }, {fresh: true})
    })
  })
})
