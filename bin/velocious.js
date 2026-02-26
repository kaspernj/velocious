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

await cli.execute()
process.exit(0)
