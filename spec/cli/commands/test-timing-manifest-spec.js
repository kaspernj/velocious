// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import {loadTimingManifest} from "../../../src/environment-handlers/node/cli/commands/test.js"

describe("test timing manifest loading", {databaseCleaning: {transaction: true}}, () => {
  it("loads valid JSON", async () => {
    const manifest = await loadTimingManifest("package.json")

    expect(manifest.name).toBe("velocious")
  })

  it("returns undefined for malformed JSON", async () => {
    expect(await loadTimingManifest("AGENTS.md")).toBe(undefined)
  })

  it("returns undefined for an unreadable path", async () => {
    expect(await loadTimingManifest("missing-test-timing-manifest.json")).toBe(undefined)
  })
})
