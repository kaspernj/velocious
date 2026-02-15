// @ts-check

import fs from "fs/promises"
import {describe, expect, it} from "../../../src/testing/test.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"

describe("EnvironmentHandlerNode find commands", () => {
  it("parses command names from Windows command file paths", async () => {
    const originalGlob = fs.glob
    const environmentHandler = new EnvironmentHandlerNode()
    const filePaths = [
      "C:\\Users\\steve\\GithubProjects\\auraline\\backend\\node_modules\\velocious\\src\\cli\\commands\\server.js",
      "C:\\Users\\steve\\GithubProjects\\auraline\\backend\\node_modules\\velocious\\src\\cli\\commands\\db\\schema\\dump.js",
      "C:\\Users\\steve\\GithubProjects\\auraline\\backend\\node_modules\\velocious\\src\\cli\\commands\\db\\index.js"
    ]

    try {
      fs.glob = async function* () {
        for (const filePath of filePaths) {
          yield filePath
        }
      }
      environmentHandler.getBasePath = async () => "C:\\Users\\steve\\GithubProjects\\auraline\\backend\\node_modules\\velocious"

      const commands = await environmentHandler._actualFindCommands()

      expect(commands).toEqual([
        {name: "server", file: filePaths[0]},
        {name: "db:schema:dump", file: filePaths[1]},
        {name: "db", file: filePaths[2]}
      ])
    } finally {
      fs.glob = originalGlob
    }
  })
})
