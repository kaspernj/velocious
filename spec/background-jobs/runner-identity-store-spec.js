// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/** @returns {Promise<BackgroundJobsStore>} - Empty background jobs store. */
async function createClearedStore() {
  dummyConfiguration.setCurrent()
  const store = new BackgroundJobsStore({configuration: dummyConfiguration})
  await store.clearAll()

  return store
}

describe("Background jobs - runner identity", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("records the accepting runner's hostname, instance id and pid", async () => {
    const store = await createClearedStore()
    const jobId = await store.enqueue({jobName: "TestJob", args: []})
    const handoff = await store.markHandedOff({jobId, workerId: "worker-1"})

    if (!handoff) throw new Error("Expected the job to be handed off")

    const receivedAtMs = Date.now()
    const accepted = await store.markChildAccepted({
      childInstanceId: "child-1",
      childPid: process.pid,
      handoffId: handoff.handoffId,
      jobId,
      receivedAtMs,
      runnerHostname: "builder-1",
      startedAtMs: receivedAtMs + 5
    })

    expect(accepted).toEqual(true)

    const job = await store.getJob(jobId)

    if (!job) throw new Error("Expected the job to exist")

    expect(job.childInstanceId).toEqual("child-1")
    expect(job.childPid).toEqual(process.pid)
    expect(job.runnerHostname).toEqual("builder-1")
  })

  it("keeps runner identity null when no acceptance arrived", async () => {
    const store = await createClearedStore()
    const jobId = await store.enqueue({jobName: "TestJob", args: []})
    const job = await store.getJob(jobId)

    if (!job) throw new Error("Expected the job to exist")

    expect(job.childInstanceId).toBeNull()
    expect(job.childPid).toBeNull()
    expect(job.runnerHostname).toBeNull()
  })
})
