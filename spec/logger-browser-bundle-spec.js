// @ts-check

import path from "node:path"
import {fileURLToPath} from "node:url"

import {build} from "esbuild"

import {describe, it} from "../src/testing/test.js"

describe("Logger browser bundle", {databaseCleaning: {transaction: true}}, () => {
  it("bundles without pulling in the server configuration graph", async () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

    await build({
      bundle: true,
      format: "esm",
      logLevel: "silent",
      platform: "browser",
      stdin: {
        contents: `
          import Logger from "./src/logger.js"
          globalThis.VelociousLogger = Logger
        `,
        loader: "js",
        resolveDir: repoRoot,
        sourcefile: "logger-browser-bundle-entry.js"
      },
      write: false
    })
  })
})
