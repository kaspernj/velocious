// @ts-check

import fs from "fs/promises"
import path from "path"

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"
import repoRoot from "../helpers/repo-root.js"

describe("Configuration - initialize after close", () => {
  it("reinitializes once per generation after database connections close", async () => {
    const directory = path.join(repoRoot(), "tmp", `initialize-after-close-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(path.join(directory, "src", "jobs"), {recursive: true})
    await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))

    let modelPhases = 0
    let initializerPhases = 0
    const configuration = new Configuration({
      directory,
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => { modelPhases += 1 },
      initializers: async () => {
        initializerPhases += 1
        return {}
      },
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    try {
      for (let generation = 1; generation <= 3; generation += 1) {
        await configuration.initialize({type: "background-jobs-runner"})
        await configuration.initialize({type: "background-jobs-runner"})

        expect(configuration.isInitialized()).toBe(true)
        expect(modelPhases).toEqual(generation)
        expect(initializerPhases).toEqual(1)

        if (generation < 3) {
          await configuration.closeDatabaseConnections()
          expect(configuration.isInitialized()).toBe(false)
        }
      }
    } finally {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {recursive: true, force: true})
    }
  })

  it("waits for an active connection close before starting a new generation", async () => {
    const directory = path.join(repoRoot(), "tmp", `initialize-during-close-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(path.join(directory, "src", "jobs"), {recursive: true})
    await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))

    /** @type {() => void} */
    let signalCloseStarted = () => {}
    const closeStarted = new Promise((resolve) => { signalCloseStarted = resolve })
    /** @type {() => void} */
    let releaseClose = () => {}
    const closeRelease = new Promise((resolve) => { releaseClose = resolve })
    class BlockingClosePool {
      static clearGlobalConnections() {}

      setCurrent() {}

      async closeAll() {
        signalCloseStarted()
        await closeRelease
      }
    }

    let modelPhases = 0
    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: class {},
            poolType: BlockingClosePool,
            type: "fake"
          }
        }
      },
      directory,
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => { modelPhases += 1 },
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    try {
      configuration.getDatabasePool()
      await configuration.initialize({type: "background-jobs-runner"})

      const close = configuration.closeDatabaseConnections()
      await closeStarted
      const reinitialize = configuration.initialize({type: "background-jobs-runner"})

      expect(modelPhases).toEqual(1)

      releaseClose()
      await Promise.all([close, reinitialize])

      expect(configuration.isInitialized()).toBe(true)
      expect(modelPhases).toEqual(2)
    } finally {
      releaseClose()
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {recursive: true, force: true})
    }
  })
})
