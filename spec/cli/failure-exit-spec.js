// @ts-check

import {spawnSync} from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {describe, expect, it} from "../../src/testing/test.js"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const cliEntryPath = path.join(repositoryRoot, "bin", "velocious.js")

/**
 * Creates an isolated app whose error reporter consumes uncaught exceptions.
 * @param {{failFinalCleanup?: boolean}} [options] - Fixture behavior.
 * @returns {Promise<{cleanup: () => Promise<void>, directory: string}>} - Fixture helpers.
 */
async function createFixture({failFinalCleanup = false} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-cli-failure-exit-"))
  const configurationPath = path.join(directory, "src", "config", "configuration.js")
  const configurationImportPath = new URL("../../src/configuration.js", import.meta.url).href
  const environmentHandlerImportPath = new URL("../../src/environment-handlers/node.js", import.meta.url).href

  await fs.mkdir(path.dirname(configurationPath), {recursive: true})
  await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({type: "module"}))
  await fs.writeFile(configurationPath, `
import Configuration from ${JSON.stringify(configurationImportPath)}
import NodeEnvironmentHandler from ${JSON.stringify(environmentHandlerImportPath)}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

process.on("uncaughtException", (error) => {
  const cause = error instanceof Error ? error.cause : undefined

  console.error(JSON.stringify({
    causeMessage: cause === undefined ? null : errorMessage(cause),
    errorMessages: error instanceof AggregateError ? error.errors.map(errorMessage) : [],
    message: errorMessage(error),
    name: error instanceof Error ? error.name : typeof error,
    stack: error instanceof Error ? error.stack : null
  }))
})

let closeDatabaseConnectionsCalls = 0

class CliFailureExitConfiguration extends Configuration {
  async closeDatabaseConnections() {
    closeDatabaseConnectionsCalls += 1

    if (${JSON.stringify(failFinalCleanup)} && closeDatabaseConnectionsCalls == 3) {
      throw new Error("Intentional CLI cleanup failure")
    }
  }

  isDatabasePoolInitialized() { return true }
}

export default new CliFailureExitConfiguration({
  autoload: false,
  database: {test: {}},
  directory: ${JSON.stringify(directory)},
  environment: "test",
  environmentHandler: new NodeEnvironmentHandler(),
  initializeModels: async () => {},
  locale: () => "en",
  localeFallbacks: {en: ["en"]},
  locales: ["en"]
})
`)
  await fs.writeFile(path.join(directory, "throwing-script.js"), `
export default async function throwingScript() {
  throw new Error("Intentional CLI failure")
}
`)
  await fs.writeFile(path.join(directory, "successful-script.js"), `
export default async function successfulScript() {}
`)

  return {
    cleanup: async () => await fs.rm(directory, {recursive: true, force: true}),
    directory
  }
}

describe("Velocious CLI failure exit", () => {
  it("exits nonzero when an application uncaughtException listener consumes a command failure", {databaseCleaning: {transaction: false, truncate: false}}, async () => {
    const {cleanup, directory} = await createFixture()

    try {
      const result = spawnSync(process.execPath, [cliEntryPath, "run-script", "throwing-script.js"], {
        cwd: directory,
        encoding: "utf8",
        env: {...process.env, VELOCIOUS_ENV: "test"}
      })

      expect(result.error).toEqual(undefined)
      expect(result.signal).toEqual(null)
      expect(result.stderr.includes("Intentional CLI failure")).toBeTrue()
      expect(result.stderr.includes("throwing-script.js")).toBeTrue()
      expect(result.status).toEqual(1)
    } finally {
      await cleanup()
    }
  })

  it("preserves the command failure as primary when command execution and final cleanup both fail", {databaseCleaning: {transaction: false, truncate: false}}, async () => {
    const {cleanup, directory} = await createFixture({failFinalCleanup: true})

    try {
      const result = spawnSync(process.execPath, [cliEntryPath, "run-script", "throwing-script.js"], {
        cwd: directory,
        encoding: "utf8",
        env: {...process.env, VELOCIOUS_ENV: "test"}
      })

      expect(result.error).toEqual(undefined)
      expect(result.signal).toEqual(null)
      expect(result.status).toEqual(1)
      expect(result.stderr.includes("\"name\":\"AggregateError\"")).toBeTrue()
      expect(result.stderr.includes("\"causeMessage\":\"Intentional CLI failure\"")).toBeTrue()
      expect(result.stderr.includes("\"errorMessages\":[\"Intentional CLI failure\",\"Intentional CLI cleanup failure\"]")).toBeTrue()
    } finally {
      await cleanup()
    }
  })

  it("exits nonzero and surfaces a final cleanup failure after successful command execution", {databaseCleaning: {transaction: false, truncate: false}}, async () => {
    const {cleanup, directory} = await createFixture({failFinalCleanup: true})

    try {
      const result = spawnSync(process.execPath, [cliEntryPath, "run-script", "successful-script.js"], {
        cwd: directory,
        encoding: "utf8",
        env: {...process.env, VELOCIOUS_ENV: "test"}
      })

      expect(result.error).toEqual(undefined)
      expect(result.signal).toEqual(null)
      expect(result.status).toEqual(1)
      expect(result.stderr.includes("\"name\":\"Error\"")).toBeTrue()
      expect(result.stderr.includes("\"message\":\"Intentional CLI cleanup failure\"")).toBeTrue()
      expect(result.stderr.includes("\"causeMessage\":null")).toBeTrue()
      expect(result.stderr.includes("\"errorMessages\":[]")).toBeTrue()
    } finally {
      await cleanup()
    }
  })
})
