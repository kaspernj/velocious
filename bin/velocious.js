#!/usr/bin/env node

import Cli from "../src/cli/index.js"
import configurationResolver from "../src/configuration-resolver.js"

const processArgs = process.argv.slice(2)
/** @type {Record<string, string | boolean | undefined>} */
const parsedProcessArgs = {}

for (let i = 0; i < processArgs.length; i++) {
  const processArg = processArgs[i]
  const singleLetterArgMatch = processArg.match(/^-([a-z])$/)
  const multiLetterArgMatch = processArg.match(/^--([a-z]+)$/)
  const nextArg = processArgs[i + 1]
  const hasValue = typeof nextArg === "string" && !nextArg.startsWith("-")
  const parsedValue = hasValue ? nextArg : true

  if (singleLetterArgMatch) {
    parsedProcessArgs[singleLetterArgMatch[1]] = parsedValue
    if (hasValue) i++
  } else if (multiLetterArgMatch) {
    parsedProcessArgs[multiLetterArgMatch[1]] = parsedValue
    if (hasValue) i++
  }
}

const configuration = await configurationResolver()
const debugEnabled = Boolean(parsedProcessArgs.d || parsedProcessArgs.debug)

if (debugEnabled) {
  configuration.debug = true
}

configuration.setCurrent()

const cli = new Cli({
  configuration,
  parsedProcessArgs,
  processArgs
})

let commandError
let commandFailed = false

try {
  await cli.execute()
} catch (error) {
  commandError = error
  commandFailed = true
  process.exitCode = 1
}

let cleanupError
let cleanupFailed = false

try {
  await configuration.closeDatabaseConnections()
} catch (error) {
  cleanupError = error
  cleanupFailed = true
  process.exitCode = 1
}

if (commandFailed && cleanupFailed) {
  throw new AggregateError(
    [commandError, cleanupError],
    "Velocious CLI command execution and database cleanup both failed",
    {cause: commandError}
  )
}

if (commandFailed) throw commandError
if (cleanupFailed) throw cleanupError

process.exit(0)
