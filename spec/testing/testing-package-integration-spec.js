// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { waitForEvent as packageWaitForEvent } from "@velocious/testing"
import { build } from "esbuild"

import { describe, expect, it, waitForEvent as facadeWaitForEvent } from "../../src/testing/test.js"

const repositoryDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

describe("@velocious/testing integration", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("exports the package waitForEvent through the Velocious testing facade", () => {
    expect(facadeWaitForEvent).toEqual(packageWaitForEvent)
  })

  it("uses the exact package version as a runtime dependency", async () => {
    const packageJson = JSON.parse(await fs.readFile(path.join(repositoryDirectory, "package.json"), "utf8"))

    expect(packageJson.dependencies["@velocious/testing"]).toEqual("0.0.0")
    expect(packageJson.devDependencies["@velocious/testing"]).toEqual(undefined)
  })

  it("bundles the package root import for browsers without Node built-ins or raw import.meta", async () => {
    const result = await build({
      bundle: true,
      format: "esm",
      logLevel: "silent",
      metafile: true,
      platform: "browser",
      stdin: {
        contents: 'import {waitForEvent} from "@velocious/testing"; globalThis.waitForEvent = waitForEvent',
        loader: "js",
        resolveDir: repositoryDirectory,
        sourcefile: "testing-package-browser-bundle-entry.js"
      },
      write: false
    })

    if (!result.metafile) throw new Error("Expected esbuild metafile")
    if (!result.outputFiles || !result.outputFiles[0]) throw new Error("Expected esbuild output")

    const inputs = Object.keys(result.metafile.inputs)
    const output = result.outputFiles[0].text

    expect(inputs.some((input) => input.startsWith("node:"))).toEqual(false)
    expect(output.includes("import.meta")).toEqual(false)
  })
})
