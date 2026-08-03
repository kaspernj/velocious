// @ts-check

import {beforeEach, describe, expect, it} from "../../src/testing/test.js"
import {buildDeploymentApiController} from "../helpers/deployment-api-controller-helper.js"
import DeploymentRunStore from "../../src/deployment-api/run-store.js"
import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {deploymentMountIdentifier, getDeploymentMount} from "../../src/deployment-api/registry.js"
import {getDeploymentRun, postDeploymentRun} from "../helpers/deployment-api-helper.js"
import {OTHER_REVISION, testDeploymentAdapter, VALID_REVISION} from "../dummy/src/support/test-deployment-adapter.js"
import {waitFor} from "awaitery"

const TOKEN = "test-deployment-token"
const MOUNT_PATH = "/velocious/deployments"
const MOUNT_IDENTIFIER = deploymentMountIdentifier(MOUNT_PATH)
const RUNS_TABLE = "velocious_deployment_runs"

/**
 * @returns {DeploymentRunStore} - Store bound to the dummy configuration.
 */
function runStore() {
  dummyConfiguration.setCurrent()

  return new DeploymentRunStore({configuration: dummyConfiguration, mountIdentifier: MOUNT_IDENTIFIER, staleRunTimeoutMs: 2000})
}

/**
 * Seeds an active run row owned by a (possibly dead) foreign owner, the state a
 * crash leaves behind.
 * @param {object} args - Options.
 * @param {number | null} args.heartbeatAtMs - Last lease heartbeat; null when the run never started.
 * @param {string} args.id - Run id.
 * @param {string} [args.status] - Active status to seed.
 * @returns {Promise<void>} - Resolves when inserted.
 */
async function seedInterruptedRun({heartbeatAtMs, id, status = "running"}) {
  const store = runStore()

  await store.ensureReady()

  const pool = dummyConfiguration.getDatabasePool("default")

  await pool.withConnection({name: "deployment-api-interruption-spec"}, async (db) => {
    await db.insert({
      tableName: RUNS_TABLE,
      data: {
        id,
        mount_identifier: MOUNT_IDENTIFIER,
        project: "dummy-project",
        stage: "production",
        revision: OTHER_REVISION,
        idempotency_key: `interrupted-${id}`,
        status,
        result_json: null,
        error_json: null,
        requested_at_ms: Date.now() - 10000,
        started_at_ms: Date.now() - 9500,
        finished_at_ms: null,
        owner_token: "dead-owner-token",
        heartbeat_at_ms: heartbeatAtMs
      }
    })
  })
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

describe("Deployment API - interrupted run recovery", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  beforeEach(() => {
    testDeploymentAdapter.reset()
  })

  it("terminally reconciles a stale pending run whose owner lease expired and lets a new deployment proceed", async () => {
    await Dummy.run(async () => {
      await seedInterruptedRun({heartbeatAtMs: null, id: "stale-run-1", status: "pending"})

      const created = await postDeploymentRun({
        payload: {
          idempotencyKey: "after-stale",
          project: "dummy-project",
          revision: VALID_REVISION,
          stage: "production"
        },
        token: TOKEN
      })

      expect(created.status).toEqual(202)

      const createdRun = /** @type {Record<string, ?>} */ (created.body.run)

      await waitForRunStatus(/** @type {string} */ (createdRun.id), "succeeded")

      const {body} = await getDeploymentRun({id: "stale-run-1", token: TOKEN})
      const staleRun = /** @type {Record<string, ?>} */ (body.run)

      expect(staleRun.status).toEqual("interrupted")
      expect(typeof staleRun.finishedAtMs).toEqual("number")
      expect(JSON.stringify(staleRun.error)).not.toContain(TOKEN)

      const events = await runStore().listAuditEvents({runId: "stale-run-1"})

      expect(events.map((event) => event.event)).toContain("run_interrupted")
    })
  })

  it("requires reconciliation for a stale running deployment and blocks another deployment", async () => {
    await Dummy.run(async () => {
      await seedInterruptedRun({heartbeatAtMs: Date.now() - 10000, id: "stale-running-1"})

      const created = await postDeploymentRun({
        payload: {
          idempotencyKey: "blocked-by-stale-running",
          project: "dummy-project",
          revision: VALID_REVISION,
          stage: "production"
        },
        token: TOKEN
      })

      expect(created.status).toEqual(409)
      expect(created.body.error).toEqual("deployment_reconciliation_required")
      expect(created.body.runId).toEqual("stale-running-1")
      expect(testDeploymentAdapter.deployCalls.length).toEqual(0)

      const run = await runStore().findRunById("stale-running-1")

      expect(run?.status).toEqual("reconciliation_required")

      const events = await runStore().listAuditEvents({runId: "stale-running-1"})

      expect(events.map((event) => event.event)).toContain("run_reconciliation_required")
    })
  })

  it("does not let stale success overwrite a reconciled run", async () => {
    await Dummy.run(async () => {
      const store = runStore()

      await seedInterruptedRun({heartbeatAtMs: Date.now() - 10000, id: "reconciled-before-success"})

      const pool = dummyConfiguration.getDatabasePool("default")

      await pool.withConnection({name: "deployment-api-interruption-spec"}, async (db) => {
        await db.affectedRows(db.updateSql({
          tableName: RUNS_TABLE,
          data: {status: "reconciliation_required"},
          conditions: {id: "reconciled-before-success", owner_token: "dead-owner-token", status: "running"}
        }))
      })

      await expect(async () => await store.markSucceeded({
        finishedAtMs: Date.now(),
        id: "reconciled-before-success",
        ownerToken: "dead-owner-token",
        result: {activeRevision: OTHER_REVISION}
      })).toThrow(/Expected to transition exactly one running deployment run/)

      const run = await store.findRunById("reconciled-before-success")

      expect(run?.status).toEqual("reconciliation_required")
      expect(run?.result).toEqual(null)
    })
  })

  it("does not let stale failure overwrite a reconciled run", async () => {
    await Dummy.run(async () => {
      const store = runStore()

      await seedInterruptedRun({heartbeatAtMs: Date.now() - 10000, id: "reconciled-before-failure"})

      const pool = dummyConfiguration.getDatabasePool("default")

      await pool.withConnection({name: "deployment-api-interruption-spec"}, async (db) => {
        await db.affectedRows(db.updateSql({
          tableName: RUNS_TABLE,
          data: {status: "reconciliation_required"},
          conditions: {id: "reconciled-before-failure", owner_token: "dead-owner-token", status: "running"}
        }))
      })

      await expect(async () => await store.markFailed({
        error: {message: "late adapter failure"},
        finishedAtMs: Date.now(),
        id: "reconciled-before-failure",
        ownerToken: "dead-owner-token"
      })).toThrow(/Expected to transition exactly one running deployment run/)

      const run = await store.findRunById("reconciled-before-failure")

      expect(run?.status).toEqual("reconciliation_required")
      expect(run?.error).toEqual(null)
    })
  })

  it("does not let a different execution owner finish a running deployment", async () => {
    await Dummy.run(async () => {
      const store = runStore()

      await seedInterruptedRun({heartbeatAtMs: Date.now(), id: "owned-by-another-worker"})

      await expect(async () => await store.markSucceeded({
        finishedAtMs: Date.now(),
        id: "owned-by-another-worker",
        ownerToken: "stale-owner-token",
        result: {activeRevision: OTHER_REVISION}
      })).toThrow(/Expected to transition exactly one running deployment run/)

      const run = await store.findRunById("owned-by-another-worker")

      expect(run?.status).toEqual("running")
      expect(run?.result).toEqual(null)
    })
  })

  it("stops stale worker A before deployment when pending ownership moved to worker B", async () => {
    await Dummy.run(async () => {
      const store = runStore()
      const outcome = await store.createRunIfPossible({
        idempotencyKey: "pending-owner-race",
        project: "dummy-project",
        revision: VALID_REVISION,
        stage: "production"
      })
      const staleRun = outcome.run

      if (!staleRun) throw new Error("Expected deployment run to be created")

      const pool = dummyConfiguration.getDatabasePool("default")

      await pool.withConnection({name: "deployment-api-interruption-spec"}, async (db) => {
        const affected = await db.affectedRows(db.updateSql({
          tableName: RUNS_TABLE,
          data: {owner_token: "worker-b-owner-token"},
          conditions: {id: staleRun.id, owner_token: staleRun.ownerToken, status: "pending"}
        }))

        expect(affected).toEqual(1)
      })

      const options = getDeploymentMount(dummyConfiguration, MOUNT_PATH)

      if (!options) throw new Error(`Expected deployment API mount at ${MOUNT_PATH}`)

      const controller = await buildDeploymentApiController({store})

      await expect(async () => await controller._executeRun({options, run: staleRun})).toThrow(/Expected to mark exactly one pending deployment run/)

      const persisted = await store.findRunById(staleRun.id)

      expect(persisted?.status).toEqual("pending")
      expect(persisted?.ownerToken).toEqual("worker-b-owner-token")
      expect(testDeploymentAdapter.deployCalls.length).toEqual(0)
    })
  })

  it("does not reclaim a run with a fresh lease owned by another process", async () => {
    await Dummy.run(async () => {
      await seedInterruptedRun({heartbeatAtMs: Date.now(), id: "fresh-run-1"})

      const created = await postDeploymentRun({
        payload: {
          idempotencyKey: "blocked-by-fresh",
          project: "dummy-project",
          revision: VALID_REVISION,
          stage: "production"
        },
        token: TOKEN
      })

      expect(created.status).toEqual(409)
      expect(created.body.error).toEqual("deployment_in_progress")
      expect(created.body.runId).toEqual("fresh-run-1")
      expect(testDeploymentAdapter.deployCalls.length).toEqual(0)

      const seeded = await runStore().findRunById("fresh-run-1")

      expect(seeded?.status).toEqual("running")
    })
  })

  it("does not reclaim a recently requested pending run that never heartbeated", async () => {
    await Dummy.run(async () => {
      const store = runStore()

      await store.ensureReady()

      const pool = dummyConfiguration.getDatabasePool("default")

      await pool.withConnection({name: "deployment-api-interruption-spec"}, async (db) => {
        await db.insert({
          tableName: RUNS_TABLE,
          data: {
            id: "fresh-pending-1",
            mount_identifier: MOUNT_IDENTIFIER,
            project: "dummy-project",
            stage: "production",
            revision: OTHER_REVISION,
            idempotency_key: "interrupted-fresh-pending-1",
            status: "pending",
            result_json: null,
            error_json: null,
            requested_at_ms: Date.now(),
            started_at_ms: null,
            finished_at_ms: null,
            owner_token: "other-worker-token",
            heartbeat_at_ms: null
          }
        })
      })

      const created = await postDeploymentRun({
        payload: {
          idempotencyKey: "blocked-by-pending",
          project: "dummy-project",
          revision: VALID_REVISION,
          stage: "production"
        },
        token: TOKEN
      })

      expect(created.status).toEqual(409)
      expect(created.body.error).toEqual("deployment_in_progress")
      expect(testDeploymentAdapter.deployCalls.length).toEqual(0)
    })
  })
})
