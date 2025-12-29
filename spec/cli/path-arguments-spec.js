// @ts-check

import fs from "fs/promises"
import os from "os"
import path from "path"
import BaseCommand from "../../src/cli/base-command.js"
import Cli from "../../src/cli/index.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerBase from "../../src/environment-handlers/base.js"

describe("Cli - path arguments", () => {
  it("runs the test command when the first argument is a path", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-cli-path-"))
    const specDir = path.join(tempDirectory, "spec")
    let receivedProcessArgs
    let receivedCommandParts

    class DummyCommand extends BaseCommand {
      async execute() {
        receivedProcessArgs = this.args.processArgs
        return receivedProcessArgs
      }
    }

    class StubEnvironmentHandler extends EnvironmentHandlerBase {
      async findCommands() {
        return [{name: "test", file: "stub-test.js"}]
      }

      async requireCommand({commandParts}) {
        receivedCommandParts = commandParts
        return DummyCommand
      }

      async findMigrations() { return [] }
      async importApplicationRoutes() { return {} }
      importTestFiles() {}
      importTestingConfigPath() {}
      async getVelociousPath() { return "/" }
    }

    try {
      await fs.mkdir(specDir, {recursive: true})

      const environmentHandler = new StubEnvironmentHandler()
      const configuration = new Configuration({
        database: {test: {}},
        directory: tempDirectory,
        environment: "test",
        environmentHandler,
        initializeModels: async () => {},
        locale: "en",
        localeFallbacks: {en: ["en"]},
        locales: ["en"]
      })

      const cli = new Cli({
        configuration,
        processArgs: ["spec"]
      })

      const result = await cli.execute()

      expect(receivedCommandParts).toEqual(["test"])
      expect(receivedProcessArgs).toEqual(["test", "spec"])
      expect(result).toEqual(["test", "spec"])
    } finally {
      await fs.rm(tempDirectory, {recursive: true, force: true})
    }
  })
})
