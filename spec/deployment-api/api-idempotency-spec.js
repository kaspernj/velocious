// @ts-check

import {beforeEach, describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import {OTHER_REVISION, testDeploymentAdapter, VALID_REVISION} from "../dummy/src/support/test-deployment-adapter.js"
import {postDeploymentRun} from "../helpers/deployment-api-helper.js"
import {waitFor} from "awaitery"

const TOKEN = "test-deployment-token"

/**
 * @param {Record<string, ?>} overrides - Field overrides.
 * @returns {Record<string, ?>} - A valid run creation payload with overrides applied.
 */
function payload(overrides = {}) {
  return {
    idempotencyKey: `idempotency-spec-${Math.random().toString(36).slice(2)}`,
    project: "dummy-project",
    revision: VALID_REVISION,
    stage: "production",
    ...overrides
  }
}

describe("Deployment API - idempotency and concurrency", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  beforeEach(() => {
    testDeploymentAdapter.reset()
  })

  it("replays the original run for a retried idempotency key without deploying twice", async () => {
    await Dummy.run(async () => {
      const requestPayload = payload({idempotencyKey: "retry-me-once"})
      const first = await postDeploymentRun({payload: requestPayload, token: TOKEN})

      expect(first.status).toEqual(202)

      await waitFor(() => {
        if (testDeploymentAdapter.deployCalls.length === 1) return true
        throw new Error("Deploy not started")
      })

      const replay = await postDeploymentRun({payload: requestPayload, token: TOKEN})
      const firstRun = /** @type {Record<string, ?>} */ (first.body.run)
      const replayRun = /** @type {Record<string, ?>} */ (replay.body.run)

      expect(replay.status).toEqual(200)
      expect(replay.body.replayed).toEqual(true)
      expect(replayRun.id).toEqual(firstRun.id)
      expect(testDeploymentAdapter.deployCalls.length).toEqual(1)
    })
  })

  it("returns a bounded conflict when an idempotency key is reused with a different payload", async () => {
    await Dummy.run(async () => {
      const first = await postDeploymentRun({payload: payload({idempotencyKey: "conflict-me"}), token: TOKEN})

      expect(first.status).toEqual(202)

      const conflict = await postDeploymentRun({
        payload: payload({idempotencyKey: "conflict-me", revision: OTHER_REVISION}),
        token: TOKEN
      })

      expect(conflict.status).toEqual(409)
      expect(conflict.body.error).toEqual("idempotency_conflict")
    })
  })

  it("returns a bounded conflict while another run is active for the same project and stage", async () => {
    await Dummy.run(async () => {
      testDeploymentAdapter.deployBehavior = "hold"

      const first = await postDeploymentRun({payload: payload(), token: TOKEN})

      expect(first.status).toEqual(202)

      const second = await postDeploymentRun({payload: payload(), token: TOKEN})

      expect(second.status).toEqual(409)
      expect(second.body.error).toEqual("deployment_in_progress")
      expect(typeof second.body.runId).toEqual("string")

      testDeploymentAdapter.releaseHold()
    })
  })

  it("allows exactly one run when concurrent requests race for the same project and stage", async () => {
    await Dummy.run(async () => {
      testDeploymentAdapter.deployBehavior = "hold"

      const [first, second] = await Promise.all([
        postDeploymentRun({payload: payload({idempotencyKey: "race-a"}), token: TOKEN}),
        postDeploymentRun({payload: payload({idempotencyKey: "race-b"}), token: TOKEN})
      ])
      const statuses = [first.status, second.status].sort()

      expect(statuses).toEqual([202, 409])

      // The winning run executes asynchronously; its deploy is held by the
      // adapter, so exactly one deploy call must eventually arrive.
      await waitFor(() => {
        if (testDeploymentAdapter.deployCalls.length === 1) return true
        throw new Error("Deploy not started")
      })

      testDeploymentAdapter.releaseHold()
    })
  })

  it("returns a deterministic idempotency conflict when one key races across different stages", async () => {
    await Dummy.run(async () => {
      const [first, second] = await Promise.all([
        postDeploymentRun({payload: payload({idempotencyKey: "global-race", stage: "production"}), token: TOKEN}),
        postDeploymentRun({payload: payload({idempotencyKey: "global-race", stage: "staging"}), token: TOKEN})
      ])
      const statuses = [first.status, second.status].sort()
      const conflict = first.status === 409 ? first : second

      expect(statuses).toEqual([202, 409])
      expect(conflict.body.error).toEqual("idempotency_conflict")

      await waitFor(() => {
        if (testDeploymentAdapter.deployCalls.length === 1) return true
        throw new Error("Deploy not started")
      })
    })
  })

  it("reads the original run state on replay even after the run finished", async () => {
    await Dummy.run(async () => {
      const requestPayload = payload({idempotencyKey: "replay-after-finish"})
      const first = await postDeploymentRun({payload: requestPayload, token: TOKEN})

      expect(first.status).toEqual(202)

      const firstRun = /** @type {Record<string, ?>} */ (first.body.run)

      await waitFor(async () => {
        const {body} = await postDeploymentRun({payload: requestPayload, token: TOKEN})
        const run = /** @type {Record<string, ?>} */ (body.run)

        if (run.status === "succeeded" && body.replayed === true && run.id === firstRun.id) return true
        throw new Error("Run not finished yet")
      })

      expect(testDeploymentAdapter.deployCalls.length).toEqual(1)
    })
  })
})
