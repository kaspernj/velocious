// @ts-check

import fs from "fs/promises"
import path from "path"

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"
import repoRoot from "../helpers/repo-root.js"

describe("Configuration - initialize close races", () => {
  it("retries the current generation after a stale model phase finishes", async () => {
    const directory = path.join(repoRoot(), "tmp", `initialize-model-close-race-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(path.join(directory, "src", "jobs"), {recursive: true})
    await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))

    let modelPhases = 0
    /** @type {() => void} */
    let signalFirstModelPhaseStarted = () => {}
    const firstModelPhaseStarted = new Promise((resolve) => { signalFirstModelPhaseStarted = resolve })
    /** @type {() => void} */
    let releaseFirstModelPhase = () => {}
    const firstModelPhaseRelease = new Promise((resolve) => { releaseFirstModelPhase = resolve })
    const configuration = new Configuration({
      directory,
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {
        modelPhases += 1
        if (modelPhases !== 1) return

        signalFirstModelPhaseStarted()
        await firstModelPhaseRelease
      },
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    const staleInitialize = configuration.initialize({type: "background-jobs-runner"})
    /** @type {Promise<void> | undefined} */
    let reinitialize

    try {
      await firstModelPhaseStarted
      await configuration.closeDatabaseConnections()

      reinitialize = configuration.initialize({type: "background-jobs-runner"})
      expect(modelPhases).toEqual(1)

      releaseFirstModelPhase()
      await Promise.all([staleInitialize, reinitialize])

      expect(configuration.isInitialized()).toBe(true)
      expect(modelPhases).toEqual(2)
    } finally {
      releaseFirstModelPhase()
      await staleInitialize
      if (reinitialize) await reinitialize
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {recursive: true, force: true})
    }
  })

  it("serializes a new bootstrap behind stale application initializers", async () => {
    const directory = path.join(repoRoot(), "tmp", `initialize-initializer-close-race-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(path.join(directory, "src", "jobs"), {recursive: true})
    await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))

    let activeInitializers = 0
    let initializerPhases = 0
    let maximumActiveInitializers = 0
    let modelPhases = 0
    /** @type {() => void} */
    let signalFirstInitializerStarted = () => {}
    const firstInitializerStarted = new Promise((resolve) => { signalFirstInitializerStarted = resolve })
    /** @type {() => void} */
    let releaseFirstInitializer = () => {}
    const firstInitializerRelease = new Promise((resolve) => { releaseFirstInitializer = resolve })
    const configuration = new Configuration({
      directory,
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => { modelPhases += 1 },
      initializers: async () => {
        initializerPhases += 1
        activeInitializers += 1
        maximumActiveInitializers = Math.max(maximumActiveInitializers, activeInitializers)

        try {
          if (initializerPhases === 1) {
            signalFirstInitializerStarted()
            await firstInitializerRelease
          }
        } finally {
          activeInitializers -= 1
        }

        return {}
      },
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    const staleInitialize = configuration.initialize({type: "background-jobs-runner"})
    /** @type {Promise<void> | undefined} */
    let reinitialize

    try {
      await firstInitializerStarted
      await configuration.closeDatabaseConnections()

      reinitialize = configuration.initialize({type: "background-jobs-runner"})
      expect(modelPhases).toEqual(1)

      releaseFirstInitializer()
      await Promise.all([staleInitialize, reinitialize])

      expect(configuration.isInitialized()).toBe(true)
      expect(modelPhases).toEqual(2)
      expect(initializerPhases).toEqual(2)
      expect(maximumActiveInitializers).toEqual(1)
    } finally {
      releaseFirstInitializer()
      await staleInitialize
      if (reinitialize) await reinitialize
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {recursive: true, force: true})
    }
  })
})
