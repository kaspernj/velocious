// @ts-check

import path from "node:path"
import {fileURLToPath} from "node:url"

import {build} from "esbuild"

import {describe, expect, it} from "../src/testing/test.js"

describe("Configuration browser bundle", {databaseCleaning: {transaction: true}}, () => {
  it("bundles without pulling in the server route resolver", async () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

    const result = await build({
      bundle: true,
      format: "esm",
      logLevel: "silent",
      metafile: true,
      platform: "browser",
      stdin: {
        contents: `
          import Configuration from "./src/configuration.js"
          import BrowserEnvironmentHandler from "./src/environment-handlers/browser.js"
          globalThis.VelociousConfiguration = Configuration
          globalThis.VelociousBrowserEnvironmentHandler = BrowserEnvironmentHandler
        `,
        loader: "js",
        resolveDir: repoRoot,
        sourcefile: "configuration-browser-bundle-entry.js"
      },
      write: false
    })

    const inputs = Object.keys(result.metafile.inputs)

    expect(inputs.some((filePath) => filePath.includes("routes/resolver") || filePath.includes("frontend-model-controller"))).toBeFalse()
  })
})
