#!/usr/bin/env node

import Cli from "../src/cli/index.js"

const processArgs = process.argv.slice(2)
const cli = new Cli({processArgs})

await cli.execute()

process.exit(0)
