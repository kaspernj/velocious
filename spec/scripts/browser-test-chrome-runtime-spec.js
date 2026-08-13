// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "../../src/testing/test.js"
import {
  loadBrowserTestChromeRuntime,
  prewarmBrowserTestChromeRuntime
} from "../../scripts/browser-test-session.js"

describe("browser test Chrome runtime", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("persists the exact prewarmed Chrome runtime for the browser test process", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-browser-runtime-"))
    const browserPath = path.join(temporaryDirectory, "chrome")
    const driverPath = path.join(temporaryDirectory, "chromedriver")
    const manifestPath = path.join(temporaryDirectory, "runtime.json")

    try {
      await fs.writeFile(browserPath, "browser")
      await fs.writeFile(driverPath, "driver")
      await fs.chmod(browserPath, 0o755)
      await fs.chmod(driverPath, 0o755)

      await prewarmBrowserTestChromeRuntime({
        binaryPathsResolver: () => ({browserPath, driverPath}),
        manifestPath,
        versionReader: async (executablePath) => executablePath === browserPath
          ? "Google Chrome 145.0.7632.117"
          : "ChromeDriver 145.0.7632.117"
      })

      expect(await loadBrowserTestChromeRuntime({manifestPath})).toEqual({
        browserPath,
        browserVersion: "145.0.7632.117",
        driverPath,
        driverVersion: "145.0.7632.117"
      })
    } finally {
      await fs.rm(temporaryDirectory, {recursive: true, force: true})
    }
  })
})
