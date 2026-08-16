// @ts-check

import path from "node:path"
import { describe, expect, it } from "../../../src/testing/test.js"
import { resolveTestProfileOptions } from "../../../src/environment-handlers/node/cli/commands/test.js"

describe("test profile CLI options", () => {
  it("resolves relative output paths from the command cwd", () => {
    const cwd = path.join(path.sep, "workspace", "application")
    const options = resolveTestProfileOptions({
      cwd,
      profile: false,
      profileJsonPath: "tmp/profile.json",
      timingManifestOutputPath: "tmp/timings.json"
    })

    expect(options.profile).toBe(true)
    expect(options.profileJsonPath).toBe(path.join(cwd, "tmp/profile.json"))
    expect(options.timingManifestOutputPath).toBe(path.join(cwd, "tmp/timings.json"))
  })

  it("rejects output collisions", async () => {
    await expect(() => resolveTestProfileOptions({
      cwd: "/workspace",
      profile: true,
      profileJsonPath: "tmp/result.json",
      timingManifestOutputPath: "./tmp/result.json"
    })).toThrow(/profiling output paths must be different/)
  })

  it("rejects an output that aliases the timing manifest input", async () => {
    await expect(() => resolveTestProfileOptions({
      cwd: "/workspace",
      profile: true,
      profileJsonPath: "tmp/timings.json",
      timingManifestPath: "./tmp/timings.json"
    })).toThrow(/must not overwrite --timing-manifest input/)
  })
})
