// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import { describe, expect, it } from "../../src/testing/test.js"
import TestProfiler from "../../src/testing/test-profiler.js"
import TestRunner from "../../src/testing/test-runner.js"

describe("test profiler lifecycle", () => {
  it("records nested hook invocations, retry attempts, custom activity, and detached late work", async () => {
    const environmentHandler = new EnvironmentHandlerNode()
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler,
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    const filePath = `${process.cwd()}/spec/example-profile-spec.js`
    const profiler = new TestProfiler({configuration, projectDirectory: process.cwd()})
    const testRunner = new TestRunner({configuration, profiler, testFiles: [filePath]})
    let attemptCount = 0
    let resolveLateActivity
    /** @type {Promise<void> | undefined} */
    let lateActivity
    const lateGate = new Promise((resolve) => { resolveLateActivity = resolve })
    const parentBeforeEach = {callback: async () => {}, declarationIndex: 0, ownerFilePath: filePath}
    const childBeforeEach = {callback: async () => {}, declarationIndex: 0, ownerFilePath: filePath}
    const childAfterEach = {callback: async () => {}, declarationIndex: 0, ownerFilePath: filePath}
    const tests = {
      args: {},
      afterAlls: [],
      afterEaches: [],
      beforeAlls: [],
      beforeEaches: [parentBeforeEach],
      filePath,
      ownerFilePath: filePath,
      subs: {
        child: {
          args: {},
          afterAlls: [],
          afterEaches: [childAfterEach],
          beforeAlls: [],
          beforeEaches: [childBeforeEach],
          filePath,
          ownerFilePath: filePath,
          subs: {},
          tests: {
            "retries once": {
              args: {retry: 1},
              filePath,
              line: 42,
              ownerFilePath: filePath,
              function: async () => {
                attemptCount++

                await configuration.profileTestActivity("cache-warmup", async () => {})

                if (attemptCount === 1) throw new Error("expected first-attempt failure")

                lateActivity = lateGate.then(async () => {
                  await configuration.profileTestActivity("detached-cleanup", async () => {})
                })
              }
            }
          }
        }
      },
      tests: {}
    }

    await testRunner.runTests({afterEaches: [], beforeEaches: [], tests, descriptions: [], indentLevel: 0})
    resolveLateActivity()
    await lateActivity

    const profile = profiler.finish({
      counts: {discovered: 1, executed: 1, failed: 0, passed: 1},
      focused: false,
      status: "passed"
    })
    const profiledTest = profile.tests[0]

    expect(profile.unattributedLateEventCount).toBe(1)
    expect(profile.counts.attempts).toBe(2)
    expect(profiledTest.attempts.map((attempt) => attempt.status)).toEqual(["failed", "passed"])
    expect(profiledTest.attempts.every((attempt) => {
      return attempt.spans.map((span) => span.phase).join(",") === "beforeEach,beforeEach,test body,custom,afterEach"
    })).toBe(true)

    const secondAttemptHookSpans = profiledTest.attempts[1].spans.filter((span) => span.phase === "beforeEach")

    expect(secondAttemptHookSpans.map((span) => span.declarationIndex)).toEqual([0, 0])
    expect(secondAttemptHookSpans[0].declarationScopeId).not.toBe(secondAttemptHookSpans[1].declarationScopeId)
    expect(profiledTest.attempts[1].spans.map((span) => span.executionOrder)).toEqual([6, 7, 8, 9, 10])
    expect(profiledTest.attempts[1].spans.some((span) => span.activity === "detached-cleanup")).toBe(false)
  })

  it("validates activity names but remains a no-op when profiling is inactive", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    let callbackRan = false

    await configuration.profileTestActivity("cache-cleanup", async () => { callbackRan = true })

    expect(callbackRan).toBe(true)
    await expect(() => configuration.profileTestActivity("tenant=user@example.com", async () => {})).toThrow(/activity name/)
  })

  it("bounds distinct custom activity labels", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    const profiler = new TestProfiler({configuration, projectDirectory: process.cwd()})
    const filePath = `${process.cwd()}/spec/custom-activity-profile-spec.js`
    const attempt = profiler.startAttempt({
      attemptNumber: 1,
      descriptions: ["custom activities"],
      testData: {args: {}, filePath, line: 12, ownerFilePath: filePath, function: async () => {}},
      testDescription: "caps labels"
    })

    await profiler.runAttempt(attempt, async () => {
      for (let index = 0; index < 22; index++) {
        await configuration.profileTestActivity(`activity-${index}`, async () => {})
      }
    })
    profiler.finishAttempt(attempt, "passed")

    const profile = profiler.finish({
      counts: {discovered: 1, executed: 1, failed: 0, passed: 1},
      focused: false,
      status: "passed"
    })
    const activities = profile.tests[0].attempts[0].spans.map((span) => span.activity)

    expect(new Set(activities).size).toBe(21)
    expect(activities.slice(20)).toEqual(["other", "other"])
  })

  it("closes nested span attribution as soon as an attempt times out", async () => {
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    const profiler = new TestProfiler({configuration, projectDirectory: process.cwd()})
    const filePath = `${process.cwd()}/spec/timed-out-profile-spec.js`
    const attempt = profiler.startAttempt({
      attemptNumber: 1,
      descriptions: ["timed out activity"],
      testData: {args: {}, filePath, line: 12, ownerFilePath: filePath, function: async () => {}},
      testDescription: "stops attribution"
    })
    let releaseSpan
    let markSpanStarted
    const spanStarted = new Promise((resolve) => { markSpanStarted = resolve })
    const spanGate = new Promise((resolve) => { releaseSpan = resolve })
    const runningSpan = profiler.runAttempt(attempt, async () => {
      await profiler.runSpan({phase: "test body"}, async () => {
        markSpanStarted()
        await spanGate
        await configuration.profileTestActivity("late-timeout-work", async () => {})
      })
    })

    await spanStarted
    profiler.finishAttempt(attempt, "timed-out")
    releaseSpan()
    await runningSpan

    const profile = profiler.finish({
      counts: {discovered: 1, executed: 1, failed: 1, passed: 0},
      focused: false,
      status: "failed"
    })
    const profiledAttempt = profile.tests[0].attempts[0]

    expect(profiledAttempt.status).toBe("timed-out")
    expect(profiledAttempt.spans.some((span) => span.activity === "late-timeout-work")).toBe(false)
    expect(profile.unattributedLateEventCount).toBeGreaterThanOrEqual(1)
  })
})
