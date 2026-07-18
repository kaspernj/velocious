// @ts-check

import fs from "fs/promises"
import path from "path"
import {fileURLToPath} from "url"

import Configuration, {CurrentConfigurationNotSetError} from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"

/** @returns {string} - Repository root. */
function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
}

describe("Configuration - concurrent initialize", () => {
  it("bootstraps once when called concurrently and marks initialized only after it completes", async () => {
    const directory = path.join(repoRoot(), "tmp", `initialize-concurrency-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(path.join(directory, "src", "jobs"), {recursive: true})
    await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))

    /** @type {Configuration | undefined} */
    let previousConfiguration
    try {
      previousConfiguration = Configuration.current()
    } catch (error) {
      if (!(error instanceof CurrentConfigurationNotSetError)) throw error
    }

    let modelsStarted = 0
    let modelsFinished = 0
    /** @type {() => void} */
    let releaseModels = () => {}

    const configuration = new Configuration({
      directory,
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {
        modelsStarted += 1
        await new Promise((resolve) => { releaseModels = resolve })
        modelsFinished += 1
      },
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    try {
      configuration.setCurrent()

      // Two concurrent callers, as a cold pooled child does with
      // pooledRunnerConcurrency > 1, must share one bootstrap.
      const first = configuration.initialize({type: "background-jobs-runner"})
      const second = configuration.initialize({type: "background-jobs-runner"})
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(modelsStarted).toEqual(1)
      // Not marked initialized while the first bootstrap is still loading models —
      // the previous code set the flag up front, letting the second caller run early.
      expect(configuration.isInitialized()).toEqual(false)

      releaseModels()
      await Promise.all([first, second])

      expect(modelsFinished).toEqual(1)
      expect(configuration.isInitialized()).toEqual(true)

      // A call after completion is a no-op.
      await configuration.initialize({type: "background-jobs-runner"})
      expect(modelsStarted).toEqual(1)
    } finally {
      previousConfiguration?.setCurrent()
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {recursive: true, force: true})
    }
  })
})
