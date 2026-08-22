// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "../../src/testing/test.js"
import { ManagedChromeDriverProcess } from "../../scripts/browser-test-session.js"

/**
 * @param {string} driverPath - Fake driver executable path.
 * @param {string} temporaryDirectory - Diagnostic directory.
 * @returns {ManagedChromeDriverProcess} - Managed fake driver process.
 */
function buildManagedDriver(driverPath, temporaryDirectory) {
  return new ManagedChromeDriverProcess({
    browserPath: process.execPath,
    browserVersion: process.version.slice(1),
    driverPath,
    driverVersion: process.version.slice(1)
  }, temporaryDirectory)
}

describe("browser test ChromeDriver process", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("terminates the ChromeDriver process group and retains process output", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-chromedriver-process-"))
    const driverPath = path.join(temporaryDirectory, "fake-chromedriver.js")
    const parentStoppedPath = path.join(temporaryDirectory, "parent-stopped")
    const childStoppedPath = path.join(temporaryDirectory, "child-stopped")
    const previousParentStoppedPath = process.env.FAKE_CHROMEDRIVER_PARENT_STOPPED_PATH
    const previousChildStoppedPath = process.env.FAKE_CHROMEDRIVER_CHILD_STOPPED_PATH
    const childScript = [
      "const fs = require('node:fs')",
      "process.once('SIGTERM', () => { fs.writeFileSync(process.env.FAKE_CHROMEDRIVER_CHILD_STOPPED_PATH, 'stopped'); process.exit(0) })",
      "process.on('message', () => {})",
      "process.send('ready')"
    ].join(";")
    const driverScript = [
      "#!/usr/bin/env node",
      "const {spawn} = require('node:child_process')",
      "const fs = require('node:fs')",
      "const http = require('node:http')",
      "const port = Number(process.argv.find((arg) => arg.startsWith('--port=')).split('=')[1])",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], {stdio: ['ignore', 1, 2, 'ipc']})`,
      "let stopping = false",
      "const server = http.createServer((request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({value: {ready: true}})) })",
      "const finish = () => server.close(() => process.exit(0))",
      "child.once('exit', () => { if (stopping) finish() })",
      "process.once('SIGTERM', () => { stopping = true; fs.writeFileSync(process.env.FAKE_CHROMEDRIVER_PARENT_STOPPED_PATH, 'stopped'); if (child.exitCode !== null) finish() })",
      "child.once('message', () => { process.stderr.write('fake chromedriver ready\\n'); server.listen(port, '127.0.0.1') })"
    ].join("\n")
    const service = buildManagedDriver(driverPath, temporaryDirectory)

    process.env.FAKE_CHROMEDRIVER_PARENT_STOPPED_PATH = parentStoppedPath
    process.env.FAKE_CHROMEDRIVER_CHILD_STOPPED_PATH = childStoppedPath

    try {
      await fs.writeFile(driverPath, `${driverScript}\n`)
      await fs.chmod(driverPath, 0o755)
      await service.start()
      await service.stop()

      expect(await fs.readFile(parentStoppedPath, "utf8")).toBe("stopped")
      expect(await fs.readFile(childStoppedPath, "utf8")).toBe("stopped")
      expect(await service.diagnostics()).toContain("fake chromedriver ready")
    } finally {
      await service.stop()

      if (previousParentStoppedPath === undefined) {
        delete process.env.FAKE_CHROMEDRIVER_PARENT_STOPPED_PATH
      } else {
        process.env.FAKE_CHROMEDRIVER_PARENT_STOPPED_PATH = previousParentStoppedPath
      }

      if (previousChildStoppedPath === undefined) {
        delete process.env.FAKE_CHROMEDRIVER_CHILD_STOPPED_PATH
      } else {
        process.env.FAKE_CHROMEDRIVER_CHILD_STOPPED_PATH = previousChildStoppedPath
      }

      await fs.rm(temporaryDirectory, {recursive: true, force: true})
    }
  })

  it("reports an early ChromeDriver process error and retained stderr", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-chromedriver-exit-"))
    const driverPath = path.join(temporaryDirectory, "failing-chromedriver.js")
    const service = buildManagedDriver(driverPath, temporaryDirectory)
    let startupError

    try {
      await fs.writeFile(driverPath, "#!/usr/bin/env node\nprocess.stderr.write('driver startup exploded\\n')\nprocess.exit(23)\n")
      await fs.chmod(driverPath, 0o755)

      try {
        await service.start()
      } catch (error) {
        startupError = error
      }

      await service.stop()

      expect(startupError?.message).toContain("exit code 23")
      expect(await service.diagnostics()).toContain("driver startup exploded")
    } finally {
      await service.stop()
      await fs.rm(temporaryDirectory, {recursive: true, force: true})
    }
  })
})
