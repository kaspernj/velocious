// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "@velocious/testing"
import repoRoot from "../helpers/repo-root.js"

describe("Expo tenant database proof fixture", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("uses captured tenant handles and the platform SQLite backend without an injected connection", async () => {
    const compatibilityTests = await fs.readFile(path.join(repoRoot(), "examples/expo/src/expo-compatibility-tests.js"), "utf8")
    const runtime = await fs.readFile(path.join(repoRoot(), "examples/expo/src/velocious-runtime.js"), "utf8")

    expect(compatibilityTests).toMatch(/runFrontendTenantDatabaseProof/u)
    expect(compatibilityTests).not.toMatch(/getConnection/u)
    expect(runtime).toMatch(/Tenant\.handle/u)
    expect(runtime).toMatch(/switchesTenantDatabase/u)
    expect(runtime).toMatch(/tenantDatabaseResolver/u)
    expect(runtime).toMatch(/tenantOnly: true/u)
  })
})
