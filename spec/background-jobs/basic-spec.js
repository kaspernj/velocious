// @ts-check

import net from "net"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import JsonSocket from "../../src/background-jobs/json-socket.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsStatusReporter from "../../src/background-jobs/status-reporter.js"
import { outputPathFor, startBackgroundJobs, startBackgroundJobsMain, waitForJobCompleted, waitForOutputJson } from "../helpers/background-jobs-helper.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import SlowTestJob from "../dummy/src/jobs/slow-test-job.js"
import TestJob from "../dummy/src/jobs/test-job.js"

/**
 * @param {object} args - Options.
 * @param {number} args.port - Background jobs main port.
 * @param {boolean} [args.supportsHandoffIdReporting] - Whether the worker advertises handoff-id reporting.
 * @param {string} args.workerId - Worker id.
 * @returns {Promise<{jsonSocket: JsonSocket, nextJob: () => Promise<import("../../src/background-jobs/types.js").BackgroundJobPayload>, receivedJobs: import("../../src/background-jobs/types.js").BackgroundJobPayload[]}>} - Connected controllable worker.
 */
async function connectControllableWorker({port, supportsHandoffIdReporting = true, workerId, acceptsPooled = false}) {
  const socket = net.createConnection({host: "127.0.0.1", port})
  const jsonSocket = new JsonSocket(socket)
  /** @type {import("../../src/background-jobs/types.js").BackgroundJobPayload[]} */
  const jobs = []

  jsonSocket.on("message", (message) => {
    if (message?.type === "job") jobs.push(message.payload)
  })

  await new Promise((resolve, reject) => {
    socket.once("error", reject)
    socket.once("connect", resolve)
  })

  if (supportsHandoffIdReporting) {
    jsonSocket.send({type: "hello", role: "worker", supportsHandoffIdReporting: true, workerId})
  } else {
    jsonSocket.send({type: "hello", role: "worker", workerId})
  }
  jsonSocket.send({type: "ready", acceptsForked: true, acceptsInline: true, acceptsPooled, acceptsSpawned: true})

  return {
    jsonSocket,
    nextJob: async () => await timeout({timeout: 2000}, async () => {
      while (jobs.length === 0) await wait(0.01)

      const payload = jobs.shift()

      if (!payload) throw new Error("Expected a background job payload")

      return payload
    }),
    receivedJobs: jobs
  }
}

describe("Background jobs", {databaseCleaning: {truncate: true}}, () => {
  it("reuses a pooled runner for sequential jobs", async () => {
    const {main, store, worker} = await startBackgroundJobs({workerOptions: {pooledRunnerCount: 1, pooledRunnerMaxJobs: 10}})
    const outputPath = await outputPathFor("pooled-runner-reuse")
    try {
      const firstId = await store.enqueue({jobName: "PooledRunnerTestJob", args: [outputPath]})
      await main._drain()
      await waitForJobCompleted({jobId: firstId, store})
      const secondId = await store.enqueue({jobName: "PooledRunnerTestJob", args: [outputPath]})
      await main._drain()
      await waitForJobCompleted({jobId: secondId, store})

      const pids = await waitForOutputJson({outputPath, predicate: (value) => value.length === 2})
      expect(pids[0]).toEqual(pids[1])
    } finally {
      await worker.stop({timeoutMs: 1000})
      expect(worker.pooledChildren.size).toEqual(0)
      expect(worker.inflightProcessChildren.size).toEqual(0)
      await main.stop()
    }
  })

  it("routes pooled jobs only to workers advertising pooled capacity", async () => {
    const {main, store} = await startBackgroundJobsMain()
    const legacy = await connectControllableWorker({port: main.getPort(), workerId: "legacy"})
    const pooled = await connectControllableWorker({port: main.getPort(), workerId: "pooled", acceptsPooled: true})

    try {
      const jobId = await store.enqueue({jobName: "TestJob", args: []})

      await main._drain()
      const payload = await pooled.nextJob()
      expect(payload.id).toEqual(jobId)
      expect(legacy.receivedJobs).toEqual([])
    } finally {
      legacy.jsonSocket.close()
      pooled.jsonSocket.close()
      await main.stop()
    }
  })

  it("drains a later eligible job when no ready worker accepts an earlier pooled job", async () => {
    const {main, store} = await startBackgroundJobsMain()
    const worker = await connectControllableWorker({port: main.getPort(), workerId: "non-pooled-worker"})

    try {
      const pooledJobId = await store.enqueue({jobName: "TestJob", args: []})
      const inlineJobId = await store.enqueue({jobName: "TestJob", args: [], options: {executionMode: "inline"}})

      await main._drain()

      const payload = await worker.nextJob()
      expect(payload.id).toEqual(inlineJobId)
      expect(payload.options.executionMode).toEqual("inline")
      expect((await store.getJob(pooledJobId))?.status).toEqual("queued")
      expect(worker.receivedJobs).toEqual([])
    } finally {
      worker.jsonSocket.close()
      await main.stop()
    }
  })

  it("gracefully drains a busy pooled job and then retires its child", async () => {
    const {main, store, worker} = await startBackgroundJobs({workerOptions: {pooledRunnerCount: 1}})
    const outputPath = await outputPathFor("pooled-runner-drain")

    try {
      const jobId = await store.enqueue({jobName: "SlowTestJob", args: ["drained", outputPath, 100]})
      await main._drain()
      await timeout({timeout: 2000}, async () => {
        while (worker.inflightPooledJobs.size === 0) await wait(0.01)
      })

      await worker.stop({timeoutMs: 2000})

      expect((await store.getJob(jobId))?.status).toEqual("completed")
      expect(await waitForOutputJson({outputPath})).toEqual({message: "drained"})
      expect(worker.pooledChildren.size).toEqual(0)
      expect(worker.inflightProcessChildren.size).toEqual(0)
    } finally {
      await main.stop()
    }
  })

  it("dispatches fenced handoffs only to workers that advertise handoff-id reporting", async () => {
    const {main, store} = await startBackgroundJobsMain()
    const legacyWorker = await connectControllableWorker({
      port: main.getPort(),
      supportsHandoffIdReporting: false,
      workerId: "legacy-worker"
    })
    const capableWorker = await connectControllableWorker({port: main.getPort(), workerId: "capable-worker"})
    const jobId = await store.enqueue({jobName: "TestJob", args: [], options: {forked: false}})

    await main._drain()

    const payload = await capableWorker.nextJob()

    expect(payload.id).toEqual(jobId)
    expect(payload.handoffId).toBeTruthy()
    expect(legacyWorker.receivedJobs).toEqual([])

    const reporter = new BackgroundJobsStatusReporter({
      configuration: dummyConfiguration,
      host: "127.0.0.1",
      port: main.getPort()
    })

    await reporter.report({
      jobId,
      status: "completed",
      handoffId: payload.handoffId,
      handedOffAtMs: payload.handedOffAtMs,
      workerId: payload.workerId
    })

    const job = await store.getJob(jobId)

    expect(job?.status).toEqual("completed")

    legacyWorker.jsonSocket.close()
    capableWorker.jsonSocket.close()
    await main.stop()
  })

  it("immediately requeues a disconnected worker's exact handoff to another socket", async () => {
    const {main, store} = await startBackgroundJobsMain()
    const firstWorker = await connectControllableWorker({port: main.getPort(), workerId: "shared-worker-id"})
    const jobId = await store.enqueue({jobName: "TestJob", args: [], options: {forked: false}})

    await main._drain()

    const firstPayload = await firstWorker.nextJob()

    expect(firstPayload.id).toEqual(jobId)
    expect(firstPayload.handoffId).toBeTruthy()

    const secondWorker = await connectControllableWorker({port: main.getPort(), workerId: "shared-worker-id"})

    firstWorker.jsonSocket.close()

    const secondPayload = await secondWorker.nextJob()

    expect(secondPayload.id).toEqual(jobId)
    expect(secondPayload.handoffId).toBeTruthy()
    expect(secondPayload.handoffId).not.toEqual(firstPayload.handoffId)

    const reporter = new BackgroundJobsStatusReporter({
      configuration: dummyConfiguration,
      host: "127.0.0.1",
      port: main.getPort()
    })

    await reporter.report({
      jobId,
      status: "completed",
      handoffId: firstPayload.handoffId,
      handedOffAtMs: firstPayload.handedOffAtMs,
      workerId: firstPayload.workerId
    })
    await reporter.report({
      jobId,
      status: "failed",
      error: "late failure",
      handoffId: firstPayload.handoffId,
      handedOffAtMs: firstPayload.handedOffAtMs,
      workerId: firstPayload.workerId
    })

    let job = await store.getJob(jobId)

    expect(job?.status).toEqual("handed_off")
    expect(job?.handoffId).toEqual(secondPayload.handoffId)
    expect(job?.attempts).toEqual(0)

    await reporter.report({
      jobId,
      status: "completed",
      handoffId: secondPayload.handoffId,
      handedOffAtMs: secondPayload.handedOffAtMs,
      workerId: secondPayload.workerId
    })

    job = await store.getJob(jobId)
    expect(job?.status).toEqual("completed")

    secondWorker.jsonSocket.close()
    await main.stop()
  })

  it("enqueues and runs a job in a worker", async () => {
    const {main, store, worker} = await startBackgroundJobs()
    const outputPath = await outputPathFor("job")

    const jobId = await TestJob.performLaterWithOptions({
      args: ["hello", outputPath],
      options: {forked: false}
    })

    const result = await waitForOutputJson({outputPath})

    expect(result).toEqual({message: "hello"})

    await waitForJobCompleted({jobId, store})

    await worker.stop()
    await main.stop()
  })

  it("runs a job in a true forked worker child", async () => {
    const {main, store, worker} = await startBackgroundJobs()
    const outputPath = await outputPathFor("forked-job")

    const jobId = await TestJob.performLaterWithOptions({
      args: ["forked", outputPath],
      options: {executionMode: "forked"}
    })

    const result = await waitForOutputJson({outputPath, timeoutSeconds: 4})

    expect(result).toEqual({message: "forked"})

    await waitForJobCompleted({jobId, store, timeoutSeconds: 4})

    await worker.stop()
    await main.stop()
  })

  it("enqueues scheduled jobs from the background jobs main process", async () => {
    dummyConfiguration.setCurrent()
    const outputPath = await outputPathFor("scheduled-job")
    dummyConfiguration.setScheduledBackgroundJobsConfig({
      jobs: {
        scheduledTestJob: {
          args: ["scheduled", outputPath],
          class: TestJob,
          every: ["1 hour", {firstIn: "25ms"}],
          options: {forked: false}
        }
      }
    })

    const {main, worker} = await startBackgroundJobs()

    const result = await waitForOutputJson({outputPath})

    expect(result).toEqual({message: "scheduled"})

    dummyConfiguration.setScheduledBackgroundJobsConfig(undefined)
    await worker.stop()
    await main.stop()
  })

  it("cleans up its listener and scheduled timers when scheduler startup fails", async () => {
    dummyConfiguration.setCurrent()
    const reservedServer = net.createServer()
    await new Promise((resolve, reject) => {
      reservedServer.once("error", reject)
      reservedServer.listen(0, "127.0.0.1", () => resolve(undefined))
    })
    const reservedAddress = reservedServer.address()

    if (!reservedAddress || typeof reservedAddress !== "object") {
      throw new Error("Expected reserved server address to be available.")
    }

    const reservedPort = reservedAddress.port
    await new Promise((resolve) => reservedServer.close(() => resolve(undefined)))

    dummyConfiguration.setScheduledBackgroundJobsConfig({
      jobs: {
        validScheduledTestJob: {
          class: TestJob,
          every: ["1 hour", {firstIn: "25ms"}],
          options: {forked: false}
        },
        invalidScheduledTestJob: {
          every: "1m"
        }
      }
    })

    const main = new BackgroundJobsMain({configuration: dummyConfiguration, host: "127.0.0.1", port: reservedPort})

    let error = null

    try {
      await main.start()
    } catch (newError) {
      error = newError
    }

    expect(error).toBeTruthy()

    expect(main.scheduler?.timeoutIds).toEqual([])
    expect(main.scheduler?.intervalIds).toEqual([])

    const rebindingServer = net.createServer()

    try {
      await new Promise((resolve, reject) => {
        rebindingServer.once("error", reject)
        rebindingServer.listen(reservedPort, "127.0.0.1", () => resolve(undefined))
      })
    } finally {
      await new Promise((resolve) => rebindingServer.close(() => resolve(undefined)))
      dummyConfiguration.setScheduledBackgroundJobsConfig(undefined)
    }
  })

  it("waits for in-flight inline jobs to finish during a graceful stop", async () => {
    const {main, store, worker} = await startBackgroundJobs()
    const outputPath = await outputPathFor("slow-job")

    const jobId = await SlowTestJob.performLaterWithOptions({
      args: ["graceful", outputPath, 400],
      options: {forked: false}
    })

    // Wait until the worker has actually picked the job up; otherwise
    // stop() might race ahead before there's anything in flight.
    await timeout({timeout: 2000}, async () => {
      while (worker.inflightInlineJobs.size === 0) {
        await wait(0.01)
      }
    })

    const stopStartedAtMs = Date.now()

    await worker.stop()

    const stopElapsedMs = Date.now() - stopStartedAtMs

    // The job pauses for 400ms inside `perform`, so a graceful stop should
    // have waited at least that long before resolving.
    expect(stopElapsedMs).toBeGreaterThanOrEqual(300)

    // The job should have written its output and been marked completed.
    const result = await waitForOutputJson({outputPath})
    expect(result).toEqual({message: "graceful"})

    await waitForJobCompleted({jobId, store})

    await main.stop()
  })
})
