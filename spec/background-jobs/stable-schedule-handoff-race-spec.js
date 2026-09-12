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
 * Builds independent pools over one SQLite file so process-local store
 * serialization cannot hide cross-process ordering bugs.
 * @param {string} directory - Isolated database directory.
 * @returns {Configuration} - Race configuration.
 */
function raceConfiguration(directory) {
  const databaseName = "stable-schedule-handoff-race"
  const databaseOptions = {
    driver: SqliteDriver,
    migrations: false,
    name: databaseName,
    poolType: SingleMultiUsePool,
    type: "sqlite"
  }

  return new Configuration({
    database: {test: {handoff: {...databaseOptions}, mutation: {...databaseOptions}}},
    directory,
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

class ReadyOnceStore extends BackgroundJobsStore {
  _raceReady = false

  async ensureReady() {
    if (this._raceReady) return

    await super.ensureReady()
    this._raceReady = true
  }
}

/**
 * Runs a stable-key mutation while an independently serialized store has won
 * queued-to-handed-off but has not committed yet.
 * @param {"cancel" | "replace" | "wake"} mutation - Stable-key mutation.
 * @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobCancellationResult | import("../../src/background-jobs/types.js").BackgroundJobReplacementResult | import("../../src/background-jobs/types.js").BackgroundJobWakeResult>} - Mutation result.
 */
async function runHandoffRace(mutation) {
  dummyConfiguration.setCurrent()
  await new BackgroundJobsStore({configuration: dummyConfiguration}).ensureReady()

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-stable-schedule-race-"))
  const configuration = raceConfiguration(directory)
  const handoffCanCommit = Promise.withResolvers()
  const handoffUpdated = Promise.withResolvers()
  const ownerReadCanContinue = Promise.withResolvers()
  const raceObserved = Promise.withResolvers()
  let raceObservation

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

    const mutationRequest = mutation === "cancel"
      ? mutationStore.cancelScheduled(scheduleKey)
      : mutation === "replace"
        ? mutationStore.replaceScheduled({scheduleKey, jobName: "EventReminderJob", args: ["replacement"]})
        : mutationStore.wakeScheduled(scheduleKey)
    const mutationPromise = mutationRequest
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

/**
 * Models PostgreSQL/MSSQL read-committed statement snapshots while an
 * independent store commits a terminal transition between lookup reads.
 * @returns {Promise<{firstCommitBoundary: string, lookup: import("../../src/background-jobs/types.js").BackgroundJobScheduledLookupResult}>} - Lookup snapshot and ordering evidence.
 */
async function runLookupTerminalRace() {
  dummyConfiguration.setCurrent()
  await new BackgroundJobsStore({configuration: dummyConfiguration}).ensureReady()

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-stable-schedule-lookup-race-"))
  const configuration = raceConfiguration(directory)
  const lookupCanContinue = Promise.withResolvers()
  const lookupCountLocked = Promise.withResolvers()
  const ownerRead = Promise.withResolvers()
  let countMutationDepth = 0
  let pauseOwnerRead = true

  class ReadCommittedLookupStore extends ReadyOnceStore {
    async _serializedCountMutation(callback, options = {}) {
      countMutationDepth += 1

      try {
        return await super._serializedCountMutation(callback, options)
      } finally {
        countMutationDepth -= 1
      }
    }

    async _serializedTransactionMutation(callback, options = {}) {
      if (countMutationDepth > 0) return await super._serializedTransactionMutation(callback, options)

      return await this._serializedConnectionMutation(callback, options)
    }

    async _lockCountRevision(db) {
      await super._lockCountRevision(db)
      lookupCountLocked.resolve()
    }

    async _scheduledOwnerJob(db, scheduleKey) {
      const job = await super._scheduledOwnerJob(db, scheduleKey)

      if (pauseOwnerRead && job?.status === "handed_off") {
        pauseOwnerRead = false
        ownerRead.resolve()
        await lookupCanContinue.promise
      }

      return job
    }
  }

  const setupStore = new BackgroundJobsStore({configuration, databaseIdentifier: "mutation"})
  const lookupStore = new ReadCommittedLookupStore({configuration, databaseIdentifier: "mutation"})
  const terminalStore = new ReadyOnceStore({configuration, databaseIdentifier: "handoff"})

  try {
    await setupStore.clearAll()
    await lookupStore.ensureReady()
    await terminalStore.ensureReady()

    const scheduleKey = "event:lookup-terminal-race"
    const scheduled = await setupStore.replaceScheduled({scheduleKey, jobName: "EventReminderJob", args: []})
    const handoff = await setupStore.markHandedOff({jobId: scheduled.jobId, workerId: "lookup-race-worker"})

    if (!handoff) throw new Error("Expected lookup race handoff")

    const lookupPromise = lookupStore.getScheduledJob(scheduleKey, {includeLatestTerminal: true})

    await ownerRead.promise

    const completionPromise = terminalStore.markCompleted({jobId: scheduled.jobId, workerId: "lookup-race-worker", ...handoff})
    const firstCommitBoundary = await Promise.race([
      lookupCountLocked.promise.then(() => "lookup-fenced"),
      completionPromise.then(() => "terminal-committed")
    ])

    lookupCanContinue.resolve()
    const lookup = await lookupPromise

    expect(await completionPromise).toEqual(true)
    return {firstCommitBoundary, lookup}
  } finally {
    lookupCanContinue.resolve()
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

  it("reports handed_off without changing the row when wake loses to an independent store handoff", async () => {
    const result = await runHandoffRace("wake")

    expect(result).toMatchObject({outcome: "handed_off"})
    expect(result.jobId).not.toBeNull()
  })

  it("returns one fenced lookup snapshot when an independent store completes its handed-off owner", async () => {
    const {firstCommitBoundary, lookup} = await runLookupTerminalRace()

    expect(lookup).toMatchObject({currentJob: {status: "handed_off"}, latestTerminalJob: null})
    expect(firstCommitBoundary).toEqual("lookup-fenced")
  })
})
