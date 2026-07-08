// @ts-check

import path from "node:path"
import {fileURLToPath} from "node:url"

import {build} from "esbuild"

import {describe, expect, it} from "../../src/testing/test.js"

describe("useLiveQuery browser bundle", {databaseCleaning: {transaction: true}}, () => {
  it("bundles for the browser without pulling in the server configuration graph", async () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

    const result = await build({
      bundle: true,
      external: ["react"],
      format: "esm",
      logLevel: "silent",
      metafile: true,
      platform: "browser",
      stdin: {
        contents: `
          import useLiveQuery from "./src/database/use-live-query.js"
          globalThis.VelociousUseLiveQuery = useLiveQuery
        `,
        loader: "js",
        resolveDir: repoRoot,
        sourcefile: "use-live-query-browser-bundle-entry.js"
      },
      write: false
    })

    const inputs = Object.keys(result.metafile.inputs)

    expect(inputs.some((filePath) => filePath.includes("routes/resolver") || filePath.includes("frontend-model-controller"))).toBeFalse()
  })
})
