// @ts-check

import fs from "fs/promises"
import path from "path"

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import Initializer from "../../src/initializer.js"
import { describe, expect, it } from "../../src/testing/test.js"
import repoRoot from "../helpers/repo-root.js"

/**
 * @typedef {object} Deferred
 * @property {Promise<void>} promise - Promise released by `resolve`.
 * @property {() => void} resolve - Resolves the promise.
 */

/** @returns {Deferred} - A manually resolved promise. */
function deferred() {
  /** @type {() => void} */
  let resolve = () => {}
  const promise = new Promise((promiseResolve) => { resolve = () => promiseResolve(undefined) })

  return {promise, resolve}
}

/**
 * @param {object} args - Initializer callbacks.
 * @param {(initializer: Initializer) => void | Promise<void>} args.run - Startup callback.
 * @param {(initializer: Initializer) => void | Promise<void>} [args.teardown] - Teardown callback.
 * @returns {typeof Initializer} - Initializer class using the callbacks.
 */
function buildInitializer({run, teardown}) {
  return class TestInitializer extends Initializer {
    async run() { await run(this) }

    async teardown() { await teardown?.(this) }
  }
}

/**
 * @param {Array<typeof Initializer>} initializerClasses - Ordered initializer classes.
 * @returns {Promise<{cleanup: () => Promise<void>, configuration: Configuration}>} - Test configuration and cleanup.
 */
async function buildConfiguration(initializerClasses) {
  const tmpRoot = path.join(repoRoot(), "tmp")
  await fs.mkdir(tmpRoot, {recursive: true})
  const directory = await fs.mkdtemp(path.join(tmpRoot, "application-process-lifecycle-"))
  await fs.mkdir(path.join(directory, "src", "jobs"), {recursive: true})
  await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))

  const initializerContext = (key) => ({default: initializerClasses[Number(key)]})
  initializerContext.keys = () => initializerClasses.map((initializerClass, index) => String(index))
  initializerContext.id = "application-process-lifecycle-spec"

  const configuration = new Configuration({
    directory,
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializers: async () => ({requireContext: initializerContext}),
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })

  return {
    cleanup: async () => {
      await configuration.shutdown()
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {recursive: true, force: true})
    },
    configuration
  }
}

describe("Configuration application process lifecycle", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("shares one startup promise and frozen process context", async () => {
    const runStarted = deferred()
    const runRelease = deferred()
    /** @type {Array<import("../../src/configuration-types.js").ApplicationProcessContext>} */
    const contexts = []
    class TestInitializer extends Initializer {
      async run() {
        runStarted.resolve()
        contexts.push(this.getProcessContext())
        await runRelease.promise
      }
    }
    const {cleanup, configuration} = await buildConfiguration([TestInitializer])

    try {
      const first = configuration.initialize({type: "server"})
      const second = configuration.initialize({type: "server"})

      expect(second).toBe(first)
      await runStarted.promise
      expect(contexts).toHaveLength(1)
      expect(Object.isFrozen(contexts[0])).toBe(true)
      expect(contexts[0].type).toEqual("server")
      expect(contexts[0].instanceId.length > 0).toBe(true)

      runRelease.resolve()
      await first
    } finally {
      runRelease.resolve()
      await cleanup()
    }
  })

  it("tears successful initializers down once in reverse order and shares shutdown", async () => {
    const events = []
    const FirstInitializer = buildInitializer({
      run: (initializer) => events.push(`first:start:${initializer.getProcessContext().instanceId}`),
      teardown: () => events.push("first:teardown")
    })
    const SecondInitializer = buildInitializer({
      run: (initializer) => events.push(`second:start:${initializer.getProcessContext().instanceId}`),
      teardown: () => events.push("second:teardown")
    })
    const {cleanup, configuration} = await buildConfiguration([FirstInitializer, SecondInitializer])

    try {
      await configuration.initialize({type: "background-jobs-worker"})
      const firstInstanceId = events[0].split(":")[2]
      expect(events[1].split(":")[2]).toEqual(firstInstanceId)

      const first = configuration.shutdown()
      const second = configuration.shutdown()

      expect(second).toBe(first)
      await first
      expect(configuration.shutdown()).toBe(first)
      expect(events).toEqual([
        `first:start:${firstInstanceId}`,
        `second:start:${firstInstanceId}`,
        "second:teardown",
        "first:teardown"
      ])

      await configuration.initialize({type: "worker-handler"})
      const replacementInstanceId = events[4].split(":")[2]
      expect(replacementInstanceId === firstInstanceId).toBe(false)
      expect(events[5]).toEqual(`second:start:${replacementInstanceId}`)
    } finally {
      await cleanup()
    }
  })

  it("excludes a failed initializer and unwinds the successful prefix", async () => {
    const startupError = new Error("second initializer failed")
    const events = []
    let shouldFail = true
    const FirstInitializer = buildInitializer({
      run: () => events.push("first:start"),
      teardown: () => events.push("first:teardown")
    })
    const SecondInitializer = buildInitializer({
      run: () => {
        events.push("second:start")
        if (shouldFail) throw startupError
      },
      teardown: () => events.push("second:teardown")
    })
    const {cleanup, configuration} = await buildConfiguration([FirstInitializer, SecondInitializer])

    try {
      let error
      try {
        await configuration.initialize({type: "server"})
      } catch (caughtError) {
        error = caughtError
      }

      expect(error).toBe(startupError)
      expect(events).toEqual(["first:start", "second:start", "first:teardown"])

      shouldFail = false
      await configuration.initialize({type: "server"})
      expect(events).toEqual([
        "first:start",
        "second:start",
        "first:teardown",
        "first:start",
        "second:start"
      ])
    } finally {
      await cleanup()
    }
  })

  it("preserves startup and reverse cleanup failures in causal order", async () => {
    const firstTeardownError = new Error("first teardown failed")
    const secondStartupError = new Error("second startup failed")
    const FirstInitializer = buildInitializer({
      run: () => {},
      teardown: () => { throw firstTeardownError }
    })
    const SecondInitializer = buildInitializer({
      run: () => { throw secondStartupError }
    })
    const {cleanup, configuration} = await buildConfiguration([FirstInitializer, SecondInitializer])

    try {
      let error
      try {
        await configuration.initialize({type: "server"})
      } catch (caughtError) {
        error = caughtError
      }

      expect(error).toBeInstanceOf(AggregateError)
      expect(/** @type {AggregateError} */ (error).errors).toEqual([secondStartupError, firstTeardownError])
      expect(error.cause).toBe(secondStartupError)
    } finally {
      await cleanup()
    }
  })

  it("keeps framework-only database close separate from application teardown", async () => {
    let runs = 0
    let teardowns = 0
    const TestInitializer = buildInitializer({
      run: () => { runs += 1 },
      teardown: () => { teardowns += 1 }
    })
    const {cleanup, configuration} = await buildConfiguration([TestInitializer])

    try {
      await configuration.initialize({type: "server"})
      await configuration.closeDatabaseConnections()
      await configuration.initialize({type: "server"})

      expect(runs).toEqual(1)
      expect(teardowns).toEqual(0)

      await configuration.shutdown()
      expect(teardowns).toEqual(1)
    } finally {
      await cleanup()
    }
  })

  it("serializes initialize during shutdown behind the finishing lifecycle", async () => {
    const firstRunStarted = deferred()
    const firstRunRelease = deferred()
    const firstTeardownStarted = deferred()
    const firstTeardownRelease = deferred()
    const replacementRunStarted = deferred()
    const replacementRunRelease = deferred()
    const contexts = []
    let runs = 0
    const TestInitializer = buildInitializer({
      run: async (initializer) => {
        runs += 1
        if (runs === 1) {
          firstRunStarted.resolve()
          await firstRunRelease.promise
        } else {
          replacementRunStarted.resolve()
          await replacementRunRelease.promise
        }
        contexts.push(initializer.getProcessContext())
      },
      teardown: async () => {
        if (runs === 1) {
          firstTeardownStarted.resolve()
          await firstTeardownRelease.promise
        }
      }
    })
    const {cleanup, configuration} = await buildConfiguration([TestInitializer])

    try {
      const firstStartup = configuration.initialize({type: "server"})
      await firstRunStarted.promise
      const shutdown = configuration.shutdown()
      const replacementStartup = configuration.initialize({type: "worker-handler"})
      const concurrentReplacementStartup = configuration.initialize({type: "worker-handler"})

      expect(concurrentReplacementStartup).toBe(replacementStartup)
      expect(replacementStartup === firstStartup).toBe(false)
      expect(runs).toEqual(1)

      firstRunRelease.resolve()
      await firstTeardownStarted.promise
      expect(runs).toEqual(1)

      firstTeardownRelease.resolve()
      await replacementRunStarted.promise
      const lateReplacementStartup = configuration.initialize({type: "worker-handler"})
      expect(lateReplacementStartup).toBe(replacementStartup)
      replacementRunRelease.resolve()
      await Promise.all([firstStartup, shutdown, replacementStartup, lateReplacementStartup])

      expect(runs).toEqual(2)
      expect(contexts[0].type).toEqual("server")
      expect(contexts[1].type).toEqual("worker-handler")
      expect(contexts[1].instanceId === contexts[0].instanceId).toBe(false)
    } finally {
      firstRunRelease.resolve()
      firstTeardownRelease.resolve()
      replacementRunRelease.resolve()
      await cleanup()
    }
  })
})
