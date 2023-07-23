#!/usr/bin/node

import Cli from "../src/cli/index.mjs"

const cli = new Cli()
const processArgs = process.argv.slice(2)

cli.execute({processArgs})
