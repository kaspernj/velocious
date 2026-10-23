// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import {fileURLToPath} from "node:url"

import {build} from "esbuild"

import {describe, expect, it} from "../src/testing/test.js"

describe("Configuration browser bundle", {databaseCleaning: {transaction: true}}, () => {
  it("bundles operation-scoped transactions without Node async context or server routes", async () => {
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
    expect(inputs.some((filePath) => filePath.includes("operation.js"))).toBeTrue()
    expect(inputs.some((filePath) => filePath.includes("async-tracked-multi-connection") || filePath.includes("async_hooks"))).toBeFalse()

    for (const operationFile of ["operation.js", "operation-connection.js", "operation-lease.js"]) {
      const source = await fs.readFile(path.join(repoRoot, "src/database", operationFile), "utf8")

      expect(source).not.toContain("import.meta")
      expect(source).not.toContain("async_hooks")
    }
  })

  it("keeps the Node-only lock-server advisory-lock transport out of the browser bundle", async () => {
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
        sourcefile: "configuration-browser-bundle-lock-server-entry.js"
      },
      write: false
    })

    const inputs = Object.keys(result.metafile.inputs)

    // The lock-server backend's websocket transport depends on the Node-only `ws`
    // package. Metro cannot bundle it (`ws/lib/stream.js` requires the Node core
    // `stream` module), so the Expo export fails as soon as `Configuration`
    // statically or dynamically reaches that backend. Creation must stay behind
    // the Node environment handler, like the Beacon clients.
    expect(inputs.some((filePath) => filePath.includes("advisory-lock-lock-server-backend"))).toBeFalse()
    expect(inputs.some((filePath) => filePath.includes("/ws/"))).toBeFalse()
    expect(inputs.some((filePath) => filePath.includes("environment-handlers/node"))).toBeFalse()
    expect(inputs.some((filePath) => filePath.endsWith("src/configuration.js"))).toBeTrue()
  })

  it("refuses the lock-server tier loudly in the browser environment handler", async () => {
    const handler = new (await import("../src/environment-handlers/browser.js")).default({})

    await expect(handler.createAdvisoryLockLockServerBackend({url: "ws://127.0.0.1:3006/websocket"})).rejects.toThrow(
      "The advisory-lock lock-server tier requires the Node environment handler"
    )
  })
})
