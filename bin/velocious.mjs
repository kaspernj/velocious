#!/usr/bin/env node

import Cli from "../src/cli/index.js"

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

const cli = new Cli({parsedProcessArgs, processArgs})

await cli.execute()

process.exit(0)
