#!/usr/bin/env node

import Cli from "../src/cli/index.js"
import configurationResolver from "../src/configuration-resolver.js"
import NodeEnvironmentHandler from "../src/environment-handlers/node.js"

const processArgs = process.argv.slice(2)
const parsedProcessArgs = {}

for (let i = 0; i < processArgs.length; i++) {
  const processArg = processArgs[i]
  const singleLetterArgMatch = processArg.match(/^-([a-z])$/)
  const multiLetterArgMatch = processArg.match(/^--([a-z]+)$/)

  if (singleLetterArgMatch) {
    parsedProcessArgs[singleLetterArgMatch[1]] = processArgs[i + 1]
    i++
  } else if (multiLetterArgMatch) {
    parsedProcessArgs[multiLetterArgMatch[1]] = processArgs[i + 1]
    i++
  }
}

const configuration = await configurationResolver()

configuration.setCurrent()

const cli = new Cli({
  configuration,
  parsedProcessArgs,
  processArgs,
  environmentHandler: NodeEnvironmentHandler
})

await cli.execute()
process.exit(0)
