// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {buildConfiguration, buildFakeSyncModel, buildTransport} from "./sync-client-fakes.js"
import Project from "../dummy/src/models/project.js"
import SyncClient from "../../src/sync/sync-client.js"
import Task from "../dummy/src/models/task.js"

/**
 * Builds a sync client tracking the real dummy Task model (static sync = true)
 * with a fake pending-sync model capturing queued rows.
 * @returns {{client: SyncClient, syncModel: ?}} Commit-tracking harness.
 */
function buildTaskTrackingHarness() {
  const syncModel = buildFakeSyncModel()
  const transport = buildTransport()
  const configuration = buildConfiguration({
    modelClasses: [Task],
    sync: {client: {authenticationToken: () => "token-1", isOnline: () => false, transport}}
  })

  return {client: new SyncClient({configuration, syncModel}), syncModel}
}

describe("sync client - commit tracking", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("queues tracked syncs only after the save transaction commits", async () => {
    const {client, syncModel} = buildTaskTrackingHarness()

    await client.start()

    const project = await Project.create({name: "Commit tracking project"})

    try {
      await Task.transaction(async () => {
        await Task.create({name: "Tracked task", projectId: project.id()})

        expect(syncModel.rows.length).toEqual(0)
      })

      expect(syncModel.rows.length).toEqual(1)
      expect(syncModel.rows[0].attributes.resourceType).toEqual("Task")
      expect(syncModel.rows[0].attributes.syncType).toEqual("create")
      expect(syncModel.rows[0].attributes.data.name).toEqual("Tracked task")
    } finally {
      client.stop()
    }
  })

  it("does not queue tracked syncs for rolled-back saves", async () => {
    const {client, syncModel} = buildTaskTrackingHarness()

    await client.start()

    const project = await Project.create({name: "Rollback tracking project"})

    try {
      await expect(async () => {
        await Task.transaction(async () => {
          await Task.create({name: "Rolled back task", projectId: project.id()})

          throw new Error("Roll the save back")
        })
      }).toThrow(/Roll the save back/u)

      expect(syncModel.rows.length).toEqual(0)
      expect(await Task.findBy({name: "Rolled back task"})).toEqual(null)
    } finally {
      client.stop()
    }
  })

  it("queues the payload committed by the save even when an afterSave hook assigns unsaved drift", async () => {
    const {client, syncModel} = buildTaskTrackingHarness()

    await client.start()

    const project = await Project.create({name: "Drift project"})
    /** @param {?} record - Saved task. @returns {Promise<void>} Assigns an unsaved attribute after the tracked callback ran. */
    const driftAfterSave = async (record) => {
      record.assign({name: "Drifted name"})
    }

    Task.afterSave(driftAfterSave)

    try {
      await Task.create({name: "Committed name", projectId: project.id()})

      expect(syncModel.rows.length).toEqual(1)
      expect(syncModel.rows[0].attributes.data.name).toEqual("Committed name")
    } finally {
      Task.unregisterLifecycleCallback("afterSave", driftAfterSave)
      client.stop()
    }
  })

  it("does not queue tracked syncs for real saves inside withoutTracking", async () => {
    const {client, syncModel} = buildTaskTrackingHarness()

    await client.start()

    const project = await Project.create({name: "Backfill project"})

    try {
      await client.withoutTracking(async () => {
        await Task.create({name: "Backfilled task", projectId: project.id()})
      })

      expect(syncModel.rows.length).toEqual(0)

      await Task.create({name: "Device task", projectId: project.id()})

      expect(syncModel.rows.length).toEqual(1)
      expect(syncModel.rows[0].attributes.data.name).toEqual("Device task")
    } finally {
      client.stop()
    }
  })
})
