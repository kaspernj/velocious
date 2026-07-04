import {describe, expect, it} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"

/** @returns {TestRunner} A runner with a stub configuration (recordAsyncCrash touches no config). */
function buildRunner() {
  return new TestRunner({
    configuration: /** @type {any} */ ({}),
    excludeTags: [],
    includeTags: [],
    testFiles: []
  })
}

describe("TestRunner - async crash reporting", () => {
  it("turns an unhandled rejection into a visible failure instead of a silent process death", () => {
    const runner = buildRunner()

    expect(runner.getFailedTests()).toEqual(0)

    // Simulates run()'s process.on("unhandledRejection") handler firing for a
    // detached fire-and-forget rejection (the "silent test-runner death" cause).
    runner.recordAsyncCrash("unhandledRejection", new Error("detached async boom"))

    expect(runner.getFailedTests()).toEqual(1)

    const details = runner.getFailedTestDetails()

    expect(details.length).toEqual(1)
    expect(details[0].error.message).toEqual("detached async boom")
    expect(details[0].fullDescription.includes("unhandledRejection")).toEqual(true)
  })

  it("wraps a non-Error rejection reason in an Error so the run still reports it", () => {
    const runner = buildRunner()

    runner.recordAsyncCrash("unhandledRejection", "string reason")

    expect(runner.getFailedTests()).toEqual(1)
    expect(runner.getFailedTestDetails()[0].error.message.includes("string reason")).toEqual(true)
  })

  it("turns an uncaught exception into a visible failure instead of a silent process death", () => {
    const runner = buildRunner()

    // Simulates run()'s process.on("uncaughtException") handler firing for a
    // synchronous throw inside a detached callback (e.g. a driver socket or
    // timer callback) — the remaining silent-death mode after #847 covered
    // unhandled rejections.
    runner.recordAsyncCrash("uncaughtException", new Error("sync boom in callback"))

    expect(runner.getFailedTests()).toEqual(1)

    const details = runner.getFailedTestDetails()

    expect(details[0].error.message).toEqual("sync boom in callback")
    expect(details[0].fullDescription.includes("uncaughtException")).toEqual(true)
  })

  it("registers an uncaughtException handler for the duration of the run", async () => {
    const runner = buildRunner()
    const listenersBefore = process.listenerCount("uncaughtException")

    /** @type {number | null} */
    let listenersDuringRun = null

    runner.runTests = async () => {
      listenersDuringRun = process.listenerCount("uncaughtException")
    }
    runner.getConfiguration = () => /** @type {any} */ ({ensureConnections: async (_name, callback) => await callback()})

    await runner.run()

    expect(listenersDuringRun).toEqual(listenersBefore + 1)
    expect(process.listenerCount("uncaughtException")).toEqual(listenersBefore)
  })
})
