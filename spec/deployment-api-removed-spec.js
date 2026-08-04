// @ts-check

import fs from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"

import {describe, expect, it} from "../src/testing/test.js"

describe("Removed core deployment API", () => {
  it("no longer ships the deployment API source, specs, docs, or dummy mounts", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

    for (const removedPath of [
      "docs/deployment-api.md",
      "spec/deployment-api",
      "spec/helpers/deployment-api-controller-helper.js",
      "spec/helpers/deployment-api-helper.js",
      "spec/dummy/src/support/test-deployment-adapter.js",
      "src/deployment-api"
    ]) {
      expect(fs.existsSync(path.join(repoRoot, removedPath))).toBeFalse()
    }
  })

  it("no longer mounts the deployment API from the dummy routes", async () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
    const routesSource = await fs.promises.readFile(path.join(repoRoot, "spec/dummy/src/config/routes.js"), "utf8")

    expect(routesSource).not.toContain("deployment-api")
  })
})
