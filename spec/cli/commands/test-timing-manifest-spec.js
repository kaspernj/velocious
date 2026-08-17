// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "../../../src/testing/test.js"
import { loadTimingManifest } from "../../../src/environment-handlers/node/cli/commands/test.js"

describe("test timing manifest loading", () => {
  it("loads and validates a canonical plain timing map", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-timing-loader-"))
    const manifestPath = path.join(directory, "timings.json")

    try {
      await fs.writeFile(manifestPath, JSON.stringify({"./spec//task-spec.js": 0}), "utf8")
      expect(await loadTimingManifest(manifestPath)).toEqual({"spec/task-spec.js": 0})
      expect(await loadTimingManifest(undefined)).toBe(undefined)
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it("fails for explicitly supplied missing malformed and invalid manifests", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-timing-loader-errors-"))
    const malformedPath = path.join(directory, "malformed.json")
    const invalidPath = path.join(directory, "invalid.json")

    try {
      await fs.writeFile(malformedPath, "not json", "utf8")
      await fs.writeFile(invalidPath, JSON.stringify({"spec/task-spec.js": "12"}), "utf8")

      await expect(() => loadTimingManifest(path.join(directory, "missing.json"))).toThrow(/read timing manifest/)
      await expect(() => loadTimingManifest(malformedPath)).toThrow(/parse timing manifest/)
      await expect(() => loadTimingManifest(invalidPath)).toThrow(/duration/)
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })
})
