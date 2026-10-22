// @ts-check

import fs from "fs/promises"
import os from "os"
import path from "path"

import AsyncTrackedMultiConnection from "../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("Configuration initializeModels process context", () => {
  it("hands the frozen application process context to the initializeModels hook", async () => {
    /** @type {Array<{processContext: import("../../src/configuration-types.js").ApplicationProcessContext | undefined, type: string}>} */
    const hookCalls = []
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-initialize-models-context-"))
    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: SqliteDriver,
            migrations: false,
            name: "initialize-models-process-context",
            poolType: AsyncTrackedMultiConnection,
            type: "sqlite"
          }
        }
      },
      directory,
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async ({processContext, type}) => {
        hookCalls.push({processContext, type})
      },
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      logging: {console: false, file: false}
    })

    try {
      await configuration.initialize({type: "worker-handler"})

      expect(hookCalls.length).toEqual(1)
      expect(hookCalls[0].type).toEqual("worker-handler")
      expect(hookCalls[0].processContext?.type).toEqual("worker-handler")
      expect(typeof hookCalls[0].processContext?.instanceId).toEqual("string")
      expect(configuration.getApplicationProcessContext()).toEqual(hookCalls[0].processContext)
      expect(Object.isFrozen(hookCalls[0].processContext)).toEqual(true)
    } finally {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    }
  })
})
