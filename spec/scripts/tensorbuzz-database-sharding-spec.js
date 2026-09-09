// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "../../src/testing/test.js"

const configurationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..", "tensorbuzz.yml")

/**
 * Returns exact build blocks for one database shard family.
 * @param {string} configuration - TensorBuzz configuration.
 * @param {string} buildPrefix - Build key prefix.
 * @returns {string[]} - Matching build blocks in declaration order.
 */
function databaseShardBuilds(configuration, buildPrefix) {
  return configuration
    .split(/\n(?= {2}[a-z0-9_]+:\n)/u)
    .filter((build) => new RegExp(`^ {2}${buildPrefix}_\\d+:`, "u").test(build))
}

describe("TensorBuzz database sharding", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("keeps slow database suites below the build timeout with complete shard sets", async () => {
    const configuration = await fs.readFile(configurationPath, "utf8")
    const shardFamilies = [
      {buildPrefix: "mariadb", groups: 4, name: "MariaDB"},
      {buildPrefix: "mssql", groups: 8, name: "MS-SQL"}
    ]

    for (const {buildPrefix, groups, name} of shardFamilies) {
      const builds = databaseShardBuilds(configuration, buildPrefix)

      expect(builds).toHaveLength(groups)

      for (let groupNumber = 1; groupNumber <= groups; groupNumber += 1) {
        const build = builds[groupNumber - 1]

        expect(build).toContain(`  ${buildPrefix}_${groupNumber}:`)
        expect(build).toContain(`name: "${name} (${groupNumber}/${groups})"`)
        expect(build).toContain(
          `cp spec/dummy/src/config/configuration.peakflow.${buildPrefix}.js spec/dummy/src/config/configuration.js`
        )
        expect(build).toContain(`npm run test -- --groups ${groups} --group-number ${groupNumber}`)
      }
    }
  })
})
