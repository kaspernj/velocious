#!/usr/bin/env node

import Cli from "../src/cli/index.js"
import commandsFinderNode from "../src/cli/commands-finder-node.js"
import commandsRequireNode from "../src/cli/commands-require-node.js"
import configurationResolver from "../src/configuration-resolver.js"
import migrationsFinderNode from "../src/database/migrator/migrations-finder-node.js"
import migrationsRequireNode from "../src/database/migrator/migrations-require-node.js"

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

const commands = await commandsFinderNode()
const cli = new Cli({
  commands,
  configuration,
  migrationsFinder: migrationsFinderNode,
  migrationsRequire: migrationsRequireNode,
  parsedProcessArgs,
  processArgs,
  requireCommand: commandsRequireNode,
  requireContextMigrations
})

await cli.execute()
process.exit(0)
