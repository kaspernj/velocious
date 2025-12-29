// @ts-check

import fs from "fs/promises"
import os from "os"
import path from "path"
import {pathToFileURL} from "url"
import Cli from "../../src/cli/index.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"

describe("Cli - path arguments", () => {
  it("runs the test command when the first argument is a path", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-cli-path-"))
    const specDir = path.join(tempDirectory, "spec")
    const tempCommandFile = path.join(tempDirectory, "test-command.js")
    const rootDirectory = await fs.realpath(`${process.cwd()}/../..`)
    const baseCommandUrl = pathToFileURL(path.join(rootDirectory, "src/cli/base-command.js")).href

    class StubEnvironmentHandler extends EnvironmentHandlerNode {
      async findCommands() {
        return [{name: "test", file: tempCommandFile}]
      }

      async findMigrations() { return [] }
      async importApplicationRoutes() { return {} }
      importTestFiles() {}
      importTestingConfigPath() {}
      async getVelociousPath() { return "/" }
    }

    try {
      await fs.mkdir(specDir, {recursive: true})
      await fs.writeFile(tempCommandFile, [
        `import BaseCommand from "${baseCommandUrl}"`,
        "export default class DummyCommand extends BaseCommand {",
        "  async execute() {",
        "    return this.args.processArgs",
        "  }",
        "}"
      ].join("\n"))

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

      expect(result).toEqual(["test", "spec"])
    } finally {
      await fs.rm(tempDirectory, {recursive: true, force: true})
    }
  })
})
