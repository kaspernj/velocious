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
})
