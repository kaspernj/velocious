// @ts-check

import path from "node:path"
import {fileURLToPath} from "node:url"

import {build} from "esbuild"

import {describe, expect, it} from "../../src/testing/test.js"

describe("Background jobs - public browser bundle", {databaseCleaning: {transaction: true}}, () => {
  it("bundles the public job runtime without Node-only background-job modules", async () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

    const result = await build({
      bundle: true,
      format: "esm",
      logLevel: "silent",
      metafile: true,
      platform: "browser",
      stdin: {
        contents: `
          import VelociousJob from "./src/background-jobs/platform-job.js"
          import Configuration from "./src/configuration.js"
          import BrowserEnvironmentHandler from "./src/environment-handlers/browser.js"
          globalThis.VelociousJob = VelociousJob
          globalThis.VelociousConfiguration = Configuration
          globalThis.VelociousBrowserEnvironmentHandler = BrowserEnvironmentHandler
        `,
        loader: "js",
        resolveDir: repoRoot,
        sourcefile: "background-jobs-browser-bundle-entry.js"
      },
      write: false
    })

    const inputs = Object.keys(result.metafile.inputs)

    for (const nodeOnlyPath of [
      "background-jobs/client.js",
      "background-jobs/job.js",
      "background-jobs/main.js",
      "background-jobs/socket-request.js",
      "background-jobs/store.js",
      "background-jobs/worker.js",
      "configuration-resolver.js",
      "environment-handlers/node.js"
    ]) {
      expect(inputs.some((filePath) => filePath.includes(nodeOnlyPath))).toBeFalse()
    }
  })
})
