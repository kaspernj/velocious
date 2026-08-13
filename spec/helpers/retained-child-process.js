// @ts-check

import { spawn } from "node:child_process"
import fs from "node:fs/promises"

/**
 * Runs a child command while retaining its combined output for diagnostics.
 * @param {object} args - Command options.
 * @param {string[]} args.commandArgs - Command arguments.
 * @param {string} args.cwd - Working directory.
 * @param {string} args.description - Command description for failures.
 * @param {string} args.executable - Executable path.
 * @param {string} args.outputPath - Retained combined output path.
 * @returns {Promise<string>} - Combined stdout and stderr.
 */
export async function runRetainedChildProcess({commandArgs, cwd, description, executable, outputPath}) {
  const outputFile = await fs.open(outputPath, "w")
  /** @type {{code: number | null, signal: NodeJS.Signals | null} | undefined} */
  let result
  /** @type {Error | undefined} */
  let spawnError

  try {
    const child = spawn(executable, commandArgs, {
      cwd,
      stdio: ["ignore", outputFile.fd, outputFile.fd],
      windowsHide: true
    })

    try {
      result = await new Promise((resolve, reject) => {
        child.once("error", reject)
        child.once("close", (code, signal) => resolve({code, signal}))
      })
    } catch (error) {
      spawnError = error instanceof Error ? error : new Error(String(error))
    }
  } finally {
    await outputFile.close()
  }

  const output = await fs.readFile(outputPath, "utf8")

  if (spawnError) {
    throw new Error(`${description} could not start: ${spawnError.message}\n${output}`, {cause: spawnError})
  }
  if (!result || result.code !== 0) {
    const exit = result?.signal ? `signal ${result.signal}` : `exit code ${result?.code ?? "unknown"}`

    throw new Error(`${description} failed with ${exit}\n${output}`)
  }
  return output
}
