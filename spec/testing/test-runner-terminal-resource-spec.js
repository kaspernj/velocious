// @ts-check

import {fileURLToPath} from "node:url"
import {createMockScope, createTestContext} from "@velocious/testing"
import {describe, expect, it, testEvents} from "../../src/testing/test.js"
import {buildTestingRunner} from "../helpers/testing-runner-parity.js"

describe("TestRunner terminal resource failures", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("keeps one originating failure, full causes and distinct not-run cases without retry or duplicate cleanup", async () => {
    const context = createTestContext()
    const runner = buildTestingRunner({context})
    const calls = []
    const attempts = []
    const notRun = []
    const cause = new Error("original command failure")
    const primary = Object.assign(new Error("notification deadline", {cause}), {
      terminalResource: {scope: "run", name: "webdriver-session"}
    })
    const cleanup = new Error("secondary cleanup failure")
    const doubles = createMockScope()
    const errors = doubles.spyOn(console, "error").mockImplementation(() => {})
    const onAttempt = (event) => attempts.push(event)
    const onNotRun = (event) => notRun.push(event)

    context.describe("browser", {databaseCleaning: {transaction: false, truncate: false}}, () => {
      context.afterEach(() => { calls.push("afterEach"); throw cleanup })
      context.afterAll(() => calls.push("afterAll"))
      context.it("origin", {retry: 2}, () => { calls.push("origin"); throw primary })
      context.it("later", () => calls.push("later"))
      context.describe("unentered", () => {
        context.beforeAll(() => calls.push("child setup"))
        context.it("child", () => calls.push("child"))
      })
    })
    testEvents.on("testAttemptFailed", onAttempt)
    testEvents.on("testNotRun", onNotRun)
    try {
      runner.analyzeDeclarations()
      await runner.runPackageTests()
      await runner._packageRunner.cleanupActiveSuites()
      const output = errors.mock.calls.map((args) => args.join(" ")).join("\n")
      expect(calls).toEqual(["origin", "afterEach", "afterAll"])
      expect(attempts.length).toBe(1)
      expect(attempts[0].willRetry).toBeFalse()
      expect(notRun.length).toBe(2)
      expect(runner.getFailedTests()).toBe(1)
      expect(runner.getSuccessfulTests()).toBe(0)
      expect(runner.isFailed()).toBeTrue()
      expect(runner._packageResult.counts.notRun).toBe(2)
      expect(runner.getFailedTestDetails()[0].error.cause).toBe(primary)
      expect(output).toContain(cause.stack)
      expect(output).toContain(cleanup.stack)
    } finally {
      testEvents.off("testAttemptFailed", onAttempt)
      testEvents.off("testNotRun", onNotRun)
      doubles.restoreAll()
    }
  })
  it("attributes declarations to the originating case with a linked shared runner", () => {
    const context = createTestContext()
    const runner = buildTestingRunner({context})
    context.setDeclarationLocator(runner.captureTestDeclarationLocation.bind(runner, undefined))
    context.describe("attribution", () => context.it("origin", () => {}))
    expect(context.registry.suites[0].tests[0].location.filePath).toBe(fileURLToPath(import.meta.url))
  })

  it("reports terminal suite setup as the originating error while leaving its tests not run", async () => {
    const context = createTestContext()
    const runner = buildTestingRunner({context})
    const cause = new Error("setup command cause")
    const primary = Object.assign(new Error("setup resource lost", {cause}), {
      terminalResource: {scope: "run", name: "fixture"}
    })
    const doubles = createMockScope()
    const errors = doubles.spyOn(console, "error").mockImplementation(() => {})
    let cleaned = 0
    context.describe("setup", () => {
      context.beforeAll(() => { throw primary })
      context.afterAll(() => { cleaned++ })
      context.it("not executed", () => { throw new Error("later callback ran") })
    })
    try {
      runner.analyzeDeclarations()
      await runner.runPackageTests()
      expect(runner.isFailed()).toBeTrue()
      expect(runner.getFailedTests()).toBe(0)
      expect(runner.getNotRunTests()).toBe(1)
      expect(cleaned).toBe(1)
      expect(errors.mock.calls.map((args) => args.join(" ")).join("\n")).toContain(cause.stack)
    } finally {
      doubles.restoreAll()
    }
  })

})
