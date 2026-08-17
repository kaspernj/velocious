// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {describe, expect, it} from "../../src/testing/test.js"

describe("TensorBuzz MS-SQL sharding", () => {
  it("runs the complete suite across four groups", async () => {
    const specDirectory = path.dirname(fileURLToPath(import.meta.url))
    const configurationPath = path.resolve(specDirectory, "../..", "tensorbuzz.yml")
    const configuration = await fs.readFile(configurationPath, "utf8")
    const mssqlBuilds = configuration
      .split(/\n(?= {2}[a-z0-9_]+:\n)/u)
      .filter((build) => /^ {2}mssql_\d+:/u.test(build))

    expect(mssqlBuilds).toHaveLength(4)

    for (let groupNumber = 1; groupNumber <= 4; groupNumber += 1) {
      const build = mssqlBuilds[groupNumber - 1]

      expect(build).toContain(`  mssql_${groupNumber}:`)
      expect(build).toContain(`name: "MS-SQL (${groupNumber}/4)"`)
      expect(build).toContain(`npm run test -- --groups 4 --group-number ${groupNumber}`)
    }
  })
})
