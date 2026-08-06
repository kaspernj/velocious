// @ts-check

import fs from "fs/promises"
import os from "os"
import path from "path"
import BackgroundJobRecord from "../../src/background-jobs/job-record.js"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/**
 * Runs a stable-key mutation while an independently serialized store has won
 * queued-to-handed-off but has not committed yet.
 * @param {"cancel" | "replace"} mutation - Stable-key mutation.
 * @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobCancellationResult | import("../../src/background-jobs/types.js").BackgroundJobReplacementResult>} - Mutation result.
 */
async function runHandoffRace(mutation) {
  dummyConfiguration.setCurrent()
  await new BackgroundJobsStore({configuration: dummyConfiguration}).ensureReady()

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-stable-schedule-race-"))
  const databaseName = "stable-schedule-handoff-race"
  const databaseOptions = {
    driver: SqliteDriver,
    migrations: false,
    name: databaseName,
    poolType: SingleMultiUsePool,
    type: "sqlite"
  }
  const configuration = new Configuration({
    database: {test: {handoff: {...databaseOptions}, mutation: {...databaseOptions}}},
    directory,
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
  const handoffCanCommit = Promise.withResolvers()
  const handoffUpdated = Promise.withResolvers()
  const ownerReadCanContinue = Promise.withResolvers()
  const raceObserved = Promise.withResolvers()
  let raceObservation

  class ReadyOnceStore extends BackgroundJobsStore {
    _raceReady = false

    async ensureReady() {
      if (this._raceReady) return

      await super.ensureReady()
      this._raceReady = true
    }
  }

  class PausedHandoffStore extends ReadyOnceStore {
    async _updateAffectedRows(db, args) {
      const affectedRows = await super._updateAffectedRows(db, args)

      if (affectedRows === 1 && args.data.status === "handed_off") {
        handoffUpdated.resolve()
        await handoffCanCommit.promise
      }

      return affectedRows
    }
  }

  class ObservedMutationStore extends ReadyOnceStore {
    async _getJobRowById(db, jobId) {
      const job = await super._getJobRowById(db, jobId)

      if (!raceObservation && job?.status === "queued") {
        raceObservation = "owner-read"
        raceObserved.resolve(raceObservation)
        await ownerReadCanContinue.promise
      }

      return job
    }

    async _lockCountRevision(db) {
      if (!raceObservation) {
        raceObservation = "count-lock"
        raceObserved.resolve(raceObservation)
      }

      await super._lockCountRevision(db)
    }
  }

  const setupStore = new BackgroundJobsStore({configuration, databaseIdentifier: "mutation"})
  const handoffStore = new PausedHandoffStore({configuration, databaseIdentifier: "handoff"})
  const mutationStore = new ObservedMutationStore({configuration, databaseIdentifier: "mutation"})

  try {
    await setupStore.clearAll()
    await handoffStore.ensureReady()
    await mutationStore.ensureReady()
    const scheduleKey = `event:handoff-race:${mutation}`
    const scheduled = await setupStore.replaceScheduled({scheduleKey, jobName: "EventReminderJob", args: [mutation]})
    const handoffPromise = handoffStore.markHandedOff({jobId: scheduled.jobId, workerId: "race-worker"})

    await Promise.race([
      handoffUpdated.promise,
      handoffPromise.then((handoff) => {
        if (!handoff) throw new Error("Competing store didn't hand off the queued owner")
      })
    ])

    const mutationPromise = (mutation === "cancel"
      ? mutationStore.cancelScheduled(scheduleKey)
      : mutationStore.replaceScheduled({scheduleKey, jobName: "EventReminderJob", args: ["replacement"]}))
      .then((result) => ({result}), (error) => ({error}))
    const observed = await raceObserved.promise

    handoffCanCommit.resolve()
    const handoff = await handoffPromise

    if (!handoff) throw new Error("Expected competing handoff to win")

    ownerReadCanContinue.resolve()
    const mutationOutcome = await mutationPromise

    if ("error" in mutationOutcome) throw mutationOutcome.error

    expect(observed).toEqual("count-lock")

    return mutationOutcome.result
  } finally {
    handoffCanCommit.resolve()
    ownerReadCanContinue.resolve()
    await configuration.closeDatabaseConnections()
    dummyConfiguration.setCurrent()
    await dummyConfiguration.initializeModels()
    await fs.rm(directory, {force: true, recursive: true})
  }
}

describe("Background jobs - stable schedule handoff races", {databaseCleaning: {transaction: false}}, () => {
  it("keeps the initialized background job record on its configured database", async () => {
    const databaseIdentifier = BackgroundJobRecord.getConfiguredDatabaseIdentifier()

    await runHandoffRace("cancel")

    expect(BackgroundJobRecord.getConfiguredDatabaseIdentifier()).toEqual(databaseIdentifier)
  })

  it("reports handed_off when cancellation loses to an independent store handoff", async () => {
    const result = await runHandoffRace("cancel")

    expect(result).toMatchObject({outcome: "handed_off"})
    expect(result.jobId).not.toBeNull()
  })

  it("reports handed_off when replacement loses to an independent store handoff", async () => {
    const result = await runHandoffRace("replace")

    expect(result).toMatchObject({previousStatus: "handed_off"})
    expect(result.previousJobId).not.toBeNull()
  })
})
