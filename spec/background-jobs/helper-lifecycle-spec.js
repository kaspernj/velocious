// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {startBackgroundJobsMain, withBackgroundJobs} from "../helpers/background-jobs-helper.js"

describe("Background jobs test helper lifecycle", {tags: ["dummy"], databaseCleaning: {truncate: true}}, () => {
  it("restores the default background jobs configuration between owned mains", async () => {
    const first = await startBackgroundJobsMain({
      backgroundJobsConfig: {
        dispatchStrategy: "polling",
        pollIntervalMs: 60_000,
        retention: {completedTtlMs: 1000, failedTtlMs: null, sweepIntervalMs: 60_000}
      }
    })

    await first.main.stop()

    const second = await startBackgroundJobsMain()

    try {
      expect(second.main.dispatchStrategy).toEqual("beacon")
      expect(second.main.pollIntervalMs).toEqual(1000)
      expect(second.main.retention).toEqual({
        batchSize: 1000,
        completedTtlMs: 7 * 24 * 60 * 60 * 1000,
        failedTtlMs: 30 * 24 * 60 * 60 * 1000,
        sweepIntervalMs: 60 * 60 * 1000
      })
    } finally {
      await second.main.stop()
    }
  })

  it("stops the worker and main before propagating an owning test failure", async () => {
    const ownerError = new Error("planned owning test failure")
    let releaseWorkerStop
    const workerStopBarrier = new Promise((resolve) => { releaseWorkerStop = resolve })
    let reportWorkerStopStarted
    const workerStopStarted = new Promise((resolve) => { reportWorkerStopStarted = resolve })
    let releaseMainStop
    const mainStopBarrier = new Promise((resolve) => { releaseMainStop = resolve })
    let reportMainStopStarted
    const mainStopStarted = new Promise((resolve) => { reportMainStopStarted = resolve })
    const order = []
    let ownerSettled = false
    const owner = withBackgroundJobs(async () => {
      order.push("callback")
      throw ownerError
    }, {
      start: async () => ({
        main: {
          stop: async () => {
            order.push("main-stop-start")
            reportMainStopStarted()
            await mainStopBarrier
            order.push("main-stop-end")
          }
        },
        store: {},
        worker: {
          stop: async () => {
            order.push("worker-stop-start")
            reportWorkerStopStarted()
            await workerStopBarrier
            order.push("worker-stop-end")
          }
        }
      })
    }).then(() => undefined, (error) => error).finally(() => { ownerSettled = true })

    await workerStopStarted
    expect(ownerSettled).toEqual(false)
    expect(order).toEqual(["callback", "worker-stop-start"])
    releaseWorkerStop()

    await mainStopStarted
    expect(ownerSettled).toEqual(false)
    expect(order).toEqual(["callback", "worker-stop-start", "worker-stop-end", "main-stop-start"])
    releaseMainStop()

    expect(await owner).toBe(ownerError)
    expect(order).toEqual(["callback", "worker-stop-start", "worker-stop-end", "main-stop-start", "main-stop-end"])
  })
})
