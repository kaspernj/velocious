// @ts-check

import {describe, expect, it} from "../../../../src/testing/test.js"
import Cli from "../../../../src/cli/index.js"
import Configuration from "../../../../src/configuration.js"
import DatabaseRecord from "../../../../src/database/record/index.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import path from "node:path"

class LintProject extends DatabaseRecord {}
class LintTask extends DatabaseRecord {}

LintTask.belongsTo("project", {className: "LintProject"})
LintProject.hasMany("lintTasks", {className: "LintTask"})

class LintEvent extends DatabaseRecord {}
class LintOrphanSetting extends DatabaseRecord {}

LintOrphanSetting.belongsTo("lintEvent", {className: "LintEvent"})

/**
 * @param {Array<typeof DatabaseRecord>} modelClasses - Model classes to register.
 * @returns {Configuration} - Configuration instance.
 */
function buildConfiguration(modelClasses) {
  return new Configuration({
    database: {test: {}},
    directory: dummyDirectory(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async ({configuration}) => {
      for (const modelClass of modelClasses) {
        configuration.registerModelClass(modelClass)
      }
    },
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

/**
 * @param {Configuration} configuration - Configuration instance.
 * @param {string[]} processArgs - CLI arguments.
 * @returns {Promise<?>} - Resolves with the CLI result.
 */
async function runLint(configuration, processArgs = ["lint:relationships"]) {
  const cli = new Cli({
    configuration,
    directory: dummyDirectory(),
    environmentHandler: configuration.getEnvironmentHandler(),
    processArgs,
    testing: true
  })

  return await cli.execute()
}

describe("Cli - lint - relationships", () => {
  it("passes when every belongs-to relationship has an inverse on the target model", async () => {
    await runLint(buildConfiguration([LintProject, LintTask]))
  })

  it("fails when a belongs-to relationship has no inverse on the target model", async () => {
    let lintError

    try {
      await runLint(buildConfiguration([LintEvent, LintOrphanSetting]))
    } catch (error) {
      lintError = error
    }

    expect(lintError?.message).toContain("Relationship lint failed with 1 offence(s)")
    expect(lintError?.message).toContain("LintEvent is missing an inverse hasMany/hasOne relationship for LintOrphanSetting#lintEvent")
  })

  it("ignores relationships listed in the config file", async () => {
    const configPath = path.join(dummyDirectory(), "tmp-relationship-lint.json")

    await fs.writeFile(configPath, JSON.stringify({ignore: ["LintOrphanSetting#lintEvent"]}))

    try {
      await runLint(buildConfiguration([LintEvent, LintOrphanSetting]), ["lint:relationships", "--config", configPath])
    } finally {
      await fs.rm(configPath, {force: true})
    }
  })
})
