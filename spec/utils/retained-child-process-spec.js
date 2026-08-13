// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import timeout from "awaitery/build/timeout.js"
import { describe, expect, it } from "../../src/testing/test.js"
import { runRetainedChildProcess } from "../helpers/retained-child-process.js"

/**
 * Waits for a file creation event without polling.
 * @param {string} directory - Watched directory.
 * @param {string} filename - Expected filename.
 * @returns {Promise<void>} - Resolves when the file is created.
 */
async function waitForFile(directory, filename) {
  const watcher = fs.watch(directory)

  try {
    for await (const event of watcher) {
      if (event.filename === filename) return
    }
  } finally {
    await watcher.return()
  }
}

describe("retained child process", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("settles when the owned process exits even if a descendant retains its output descriptors", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-retained-child-"))
    const grandchildPidPath = path.join(temporaryDirectory, "grandchild.pid")
    const outputPath = path.join(temporaryDirectory, "command.log")
    const grandchildScript = "require('node:net').createServer().listen(0)"
    const primaryScript = [
      "const {spawn} = require('node:child_process')",
      "const fs = require('node:fs')",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildScript)}], {detached: true, stdio: ['ignore', 1, 2]})`,
      `fs.writeFileSync(${JSON.stringify(grandchildPidPath)}, String(child.pid))`,
      "child.unref()",
      "process.stdout.write('primary complete\\n')"
    ].join(";")
    const pidCreated = waitForFile(temporaryDirectory, path.basename(grandchildPidPath))
    const command = runRetainedChildProcess({
      commandArgs: ["-e", primaryScript],
      cwd: temporaryDirectory,
      description: "descriptor ownership probe",
      executable: process.execPath,
      outputPath
    })
    let grandchildPid

    try {
      await pidCreated
      grandchildPid = Number(await fs.readFile(grandchildPidPath, "utf8"))

      expect(await timeout({timeout: 1000}, async () => await command)).toEqual("primary complete\n")
    } finally {
      if (grandchildPid) process.kill(grandchildPid, "SIGTERM")
      await command
      await fs.rm(temporaryDirectory, {recursive: true, force: true})
    }
  })
})
