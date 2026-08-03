// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import DeploymentRunStore from "../../src/deployment-api/run-store.js"
import Dummy from "../dummy/index.js"
import TableData from "../../src/database/table-data/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {deploymentMountIdentifier} from "../../src/deployment-api/registry.js"
import {OTHER_REVISION, VALID_REVISION} from "../dummy/src/support/test-deployment-adapter.js"

const AUDIT_TABLE = "velocious_deployment_api_audit_events"
const PRIMARY_MOUNT_IDENTIFIER = deploymentMountIdentifier("/velocious/deployments")
const RUNS_TABLE = "velocious_deployment_runs"
const SECONDARY_MOUNT_IDENTIFIER = deploymentMountIdentifier("/velocious/other-deployments")

/**
 * Recreates the lazily-owned tables at their pre-mount-scope schema.
 * @returns {Promise<void>} - Resolves when the legacy schema and row exist.
 */
async function createLegacySchema() {
  const pool = dummyConfiguration.getDatabasePool("default")

  await pool.withConnection({name: "deployment-api-run-store-mount-upgrade-spec"}, async (db) => {
    if (await db.tableExists(AUDIT_TABLE)) await db.dropTable(AUDIT_TABLE)
    if (await db.tableExists(RUNS_TABLE)) await db.dropTable(RUNS_TABLE)

    const runs = new TableData(RUNS_TABLE)

    runs.string("id", {null: false, primaryKey: true})
    runs.string("project", {null: false, index: true})
    runs.string("stage", {null: false})
    runs.string("revision", {null: false})
    runs.string("idempotency_key", {null: false, index: {unique: true}})
    runs.string("status", {null: false, index: true})
    runs.text("result_json", {null: true})
    runs.text("error_json", {null: true})
    runs.bigint("requested_at_ms", {null: false})
    runs.bigint("started_at_ms", {null: true})
    runs.bigint("finished_at_ms", {null: true})
    runs.string("owner_token", {null: true})
    runs.bigint("heartbeat_at_ms", {null: true})
    await db.createTable(runs)

    const audit = new TableData(AUDIT_TABLE)

    audit.string("id", {null: false, primaryKey: true})
    audit.string("run_id", {null: true, index: true})
    audit.string("event", {null: false, index: true})
    audit.text("payload_json", {null: true})
    audit.bigint("created_at_ms", {null: false})
    await db.createTable(audit)

    await db.insert({
      tableName: RUNS_TABLE,
      data: {
        error_json: null,
        finished_at_ms: Date.now(),
        heartbeat_at_ms: null,
        id: "legacy-unscoped-run",
        idempotency_key: "legacy-shared-key",
        owner_token: null,
        project: "dummy-project",
        requested_at_ms: Date.now() - 1000,
        result_json: JSON.stringify({activeRevision: OTHER_REVISION}),
        revision: OTHER_REVISION,
        stage: "production",
        started_at_ms: Date.now() - 900,
        status: "succeeded"
      }
    })

    db.clearSchemaCache()
  })
}

describe("Deployment API - mount schema upgrade", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("quarantines unattributable legacy rows and replaces global idempotency uniqueness portably", async () => {
    await Dummy.run(async () => {
      dummyConfiguration.setCurrent()
      await createLegacySchema()

      const primaryStore = new DeploymentRunStore({
        configuration: dummyConfiguration,
        mountIdentifier: PRIMARY_MOUNT_IDENTIFIER
      })
      const secondaryStore = new DeploymentRunStore({
        configuration: dummyConfiguration,
        mountIdentifier: SECONDARY_MOUNT_IDENTIFIER
      })

      await primaryStore.ensureReady()

      expect(await primaryStore.findRunById("legacy-unscoped-run")).toEqual(null)
      expect(await secondaryStore.findRunById("legacy-unscoped-run")).toEqual(null)

      const primary = await primaryStore.createRunIfPossible({
        idempotencyKey: "legacy-shared-key",
        project: "dummy-project",
        revision: VALID_REVISION,
        stage: "production"
      })
      const secondary = await secondaryStore.createRunIfPossible({
        idempotencyKey: "legacy-shared-key",
        project: "dummy-project",
        revision: VALID_REVISION,
        stage: "production"
      })

      expect(primary.outcome).toEqual("created")
      expect(secondary.outcome).toEqual("created")
      expect(primary.run?.id).not.toEqual(secondary.run?.id)
      expect(await primaryStore.findRunById(/** @type {string} */ (secondary.run?.id))).toEqual(null)
      expect(await secondaryStore.findRunById(/** @type {string} */ (primary.run?.id))).toEqual(null)
    })
  })
})
