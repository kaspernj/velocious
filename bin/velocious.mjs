#!/usr/bin/node

import Cli from "../src/cli/index.mjs"

const processArgs = process.argv.slice(2)
const cli = new Cli({processArgs})

cli.execute()
