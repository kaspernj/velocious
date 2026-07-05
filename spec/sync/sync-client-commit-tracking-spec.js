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
})
