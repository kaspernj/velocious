// @ts-check

import path from "node:path"
import {fileURLToPath} from "node:url"
import {describe, expect, it} from "../../../src/testing/test.js"
import {loadTimingManifest} from "../../../src/environment-handlers/node/cli/commands/test.js"

const repositoryDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

describe("test timing manifest loading", {databaseCleaning: {transaction: true}}, () => {
  it("loads valid JSON", async () => {
    const manifest = await loadTimingManifest(path.join(repositoryDirectory, "package.json"))

    expect(manifest.name).toBe("velocious")
  })

  it("returns undefined for malformed JSON", async () => {
    expect(await loadTimingManifest(path.join(repositoryDirectory, "AGENTS.md"))).toBe(undefined)
  })

  it("returns undefined for an unreadable path", async () => {
    expect(await loadTimingManifest(path.join(repositoryDirectory, "missing-test-timing-manifest.json"))).toBe(undefined)
  })
})
