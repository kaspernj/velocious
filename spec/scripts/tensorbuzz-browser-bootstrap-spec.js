// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {describe, expect, it} from "../../src/testing/test.js"

describe("TensorBuzz browser bootstrap", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("uses a Node release that completes cold Chrome runtime extraction before browser tests", async () => {
    const specDirectory = path.dirname(fileURLToPath(import.meta.url))
    const configurationPath = path.resolve(specDirectory, "../..", "tensorbuzz.yml")
    const configuration = await fs.readFile(configurationPath, "utf8")
    const nodeArchiveUrl = "https://nodejs.org/dist/v24.18.1/node-v24.18.1-linux-x64.tar.xz"
    const prewarmCommand = "scripts/tensorbuzz-retry node scripts/prewarm-chromedriver.js"
    const browserTestCommand = "npm run test:browser"
    const prewarmIndex = configuration.indexOf(prewarmCommand)
    const browserTestIndex = configuration.indexOf(browserTestCommand)

    expect(configuration).toContain(nodeArchiveUrl)
    expect(prewarmIndex).toBeGreaterThan(-1)
    expect(browserTestIndex).toBeGreaterThan(prewarmIndex)
    expect(configuration).not.toContain(`scripts/tensorbuzz-retry ${browserTestCommand}`)
  })
})
