// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @returns {Promise<Record<string, string>>} - Package scripts.
 */
async function readPackageScripts() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const packageJsonPath = path.join(__dirname, "..", "..", "package.json")
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"))

  return packageJson.scripts
}

/**
 * @param {Record<string, string>} scripts - Script map.
 * @returns {void} - No return value.
 */
function expectNoPosixOnlyCommands(scripts) {
  expect(scripts.build.includes("rm -rf")).toEqual(false)
  expect(scripts.compile.includes("chmod +x build/bin/velocious.js")).toEqual(false)
  expect(scripts.prepublishOnly.includes("chmod +x build/bin/velocious.js")).toEqual(false)
  expect(scripts.test.includes("VELOCIOUS_TEST_DIR=$(pwd)/..")).toEqual(false)
}

describe("package scripts", () => {
  it("uses cross-platform scripts for build and test", async () => {
    const scripts = await readPackageScripts()

    expectNoPosixOnlyCommands(scripts)
    expect(scripts.build).toEqual("node scripts/clean-build.js && npm run compile")
    expect(scripts.compile).toEqual("tsc -b && npm run copy:ejs && npm run copy:templates && npm run copy:sqljs-wasm && node scripts/ensure-bin-executable.js")
    expect(scripts.prepublishOnly).toEqual("npm run build && node scripts/ensure-bin-executable.js")
    expect(scripts.test).toEqual("node scripts/run-tests.js")
  })
})
