// @ts-check

import path from "node:path"

import { parseTimingManifestMergeArguments as parsePackageArguments } from "@velocious/testing/node"

import { describe, expect, it } from "../../../src/testing/test.js"
import { parseTimingManifestMergeArguments } from "../../../src/environment-handlers/node/cli/commands/test/timing-manifest/merge.js"

describe("test timing manifest merge arguments", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("adapts the Velocious command-name argument to the package parser", () => {
    const cwd = "/project"
    const argumentsList = ["--output=tmp/timings.json", "tmp/two.json", "tmp/one.json"]

    expect(parseTimingManifestMergeArguments(["test:timing-manifest:merge", ...argumentsList], cwd)).toEqual(
      parsePackageArguments(argumentsList, {cwd})
    )
    expect(parseTimingManifestMergeArguments([
      "test:timing-manifest:merge", "--output", "tmp/timings.json", "tmp/profile.json"
    ], cwd)).toEqual({
      inputPaths: [path.resolve(cwd, "tmp/profile.json")],
      outputPath: path.resolve(cwd, "tmp/timings.json")
    })
  })

  it("preserves strict duplicate overwrite and unknown-option validation", async () => {
    const cwd = "/project"

    await expect(() => parseTimingManifestMergeArguments([
      "test:timing-manifest:merge", "--output", "tmp/out.json", "tmp/profile.json", "tmp/profile.json"
    ], cwd)).toThrow(/provided once/)
    await expect(() => parseTimingManifestMergeArguments([
      "test:timing-manifest:merge", "--output", "tmp/profile.json", "tmp/profile.json"
    ], cwd)).toThrow(/overwrite/)
    await expect(() => parseTimingManifestMergeArguments([
      "test:timing-manifest:merge", "--unknown", "tmp/profile.json"
    ], cwd)).toThrow(/Unknown argument/)
  })
})
