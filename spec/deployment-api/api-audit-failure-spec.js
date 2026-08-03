// @ts-check

import {beforeEach, describe, expect, it} from "../../src/testing/test.js"
import DeploymentRunStore from "../../src/deployment-api/run-store.js"
import Dummy from "../dummy/index.js"
import TableData from "../../src/database/table-data/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {deploymentMountIdentifier} from "../../src/deployment-api/registry.js"
import {getDeploymentRun, postDeploymentRun} from "../helpers/deployment-api-helper.js"
import {testDeploymentAdapter, VALID_REVISION} from "../dummy/src/support/test-deployment-adapter.js"
import {waitFor} from "awaitery"

const TOKEN = "test-deployment-token"
const AUDIT_TABLE = "velocious_deployment_api_audit_events"
const MOUNT_IDENTIFIER = deploymentMountIdentifier("/velocious/deployments")

describe("Deployment API - audit failure resilience", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  beforeEach(() => {
    testDeploymentAdapter.reset()
  })

  it("still executes the deployment and reports audit persistence failure on framework-error and all-error", async () => {
    await Dummy.run(async () => {
      dummyConfiguration.setCurrent()

      const store = new DeploymentRunStore({configuration: dummyConfiguration, mountIdentifier: MOUNT_IDENTIFIER})

      await store.ensureReady()

      const pool = dummyConfiguration.getDatabasePool("default")

      // Break audit persistence: the table exists (so the store does not
      // re-create it) but no longer accepts event inserts.
      await pool.withConnection({name: "deployment-api-audit-failure-spec"}, async (db) => {
        await db.dropTable(AUDIT_TABLE)

        const brokenAuditTable = new TableData(AUDIT_TABLE)

        brokenAuditTable.string("id", {null: false, primaryKey: true})
        await db.createTable(brokenAuditTable)
        db.clearSchemaCache()
      })

      /** @type {Array<Record<string, ?>>} */
      const allErrors = []
      /** @type {Array<Record<string, ?>>} */
      const frameworkErrors = []
      const errorEvents = dummyConfiguration.getErrorEvents()
      const allErrorListener = (payload) => {
        allErrors.push(/** @type {Record<string, ?>} */ (payload))
      }
      const frameworkErrorListener = (payload) => {
        frameworkErrors.push(/** @type {Record<string, ?>} */ (payload))
      }

      errorEvents.on("all-error", allErrorListener)
      errorEvents.on("framework-error", frameworkErrorListener)

      try {
        const created = await postDeploymentRun({
          payload: {
            idempotencyKey: "audit-broken",
            project: "dummy-project",
            revision: VALID_REVISION,
            stage: "production"
          },
          token: TOKEN
        })

        expect(created.status).toEqual(202)

        const createdRun = /** @type {Record<string, ?>} */ (created.body.run)
        const runId = /** @type {string} */ (createdRun.id)

        await waitFor(async () => {
          const {body} = await getDeploymentRun({id: runId, token: TOKEN})
          const run = /** @type {Record<string, ?>} */ (body.run)

          if (run.status === "succeeded") return true
          throw new Error(`Run status is ${run.status}`)
        })

        expect(testDeploymentAdapter.deployCalls.length).toEqual(1)
        expect(frameworkErrors.length).toBeGreaterThan(0)

        for (const payload of frameworkErrors) {
          expect(payload.context).toEqual("deployment-api-audit")
        }

        expect(allErrors.length).toEqual(frameworkErrors.length)

        for (const payload of allErrors) {
          expect(payload.context).toEqual("deployment-api-audit")
          expect(payload.errorType).toEqual("framework-error")
        }
      } finally {
        errorEvents.removeListener("all-error", allErrorListener)
        errorEvents.removeListener("framework-error", frameworkErrorListener)

        // Drop the broken table so the store re-creates the real schema.
        await pool.withConnection({name: "deployment-api-audit-failure-spec"}, async (db) => {
          await db.dropTable(AUDIT_TABLE)
          db.clearSchemaCache()
        })
        await store.ensureReady()
      }
    })
  })
})
