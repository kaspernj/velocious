// @ts-check

import {beforeEach, describe, expect, it} from "../../src/testing/test.js"
import DeploymentRunStore from "../../src/deployment-api/run-store.js"
import Dummy from "../dummy/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {getDeploymentRun, postDeploymentRun} from "../helpers/deployment-api-helper.js"
import {testDeploymentAdapter, VALID_REVISION} from "../dummy/src/support/test-deployment-adapter.js"
import {waitFor} from "awaitery"

const TOKEN = "test-deployment-token"
const AUDIT_TABLE = "velocious_deployment_api_audit_events"

describe("Deployment API - audit failure resilience", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  beforeEach(() => {
    testDeploymentAdapter.reset()
  })

  it("still executes the deployment and reports the failure on the framework-error channel when audit persistence fails", async () => {
    await Dummy.run(async () => {
      dummyConfiguration.setCurrent()

      const store = new DeploymentRunStore({configuration: dummyConfiguration})

      await store.ensureReady()

      const pool = dummyConfiguration.getDatabasePool("default")

      // Break audit persistence: the table exists (so the store does not
      // re-create it) but no longer accepts event inserts.
      await pool.withConnection({name: "deployment-api-audit-failure-spec"}, async (db) => {
        await db.query(`DROP TABLE ${AUDIT_TABLE}`)
        await db.query(`CREATE TABLE ${AUDIT_TABLE} (id TEXT PRIMARY KEY)`)
        db.clearSchemaCache()
      })

      /** @type {Array<Record<string, ?>>} */
      const frameworkErrors = []
      const errorEvents = dummyConfiguration.getErrorEvents()
      const listener = (payload) => {
        frameworkErrors.push(/** @type {Record<string, ?>} */ (payload))
      }

      errorEvents.on("framework-error", listener)

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
      } finally {
        errorEvents.removeListener("framework-error", listener)

        // Drop the broken table so the store re-creates the real schema.
        await pool.withConnection({name: "deployment-api-audit-failure-spec"}, async (db) => {
          await db.query(`DROP TABLE ${AUDIT_TABLE}`)
          db.clearSchemaCache()
        })
        await store.ensureReady()
      }
    })
  })
})
