// @ts-check

import {describe, expect, it} from "../../../../src/testing/test.js"
import Cli from "../../../../src/cli/index.js"
import Configuration from "../../../../src/configuration.js"
import DatabaseRecord from "../../../../src/database/record/index.js"
import dummyDirectory from "../../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import path from "node:path"
import {pathToFileURL} from "node:url"

class LintProject extends DatabaseRecord {}
class LintTask extends DatabaseRecord {}

LintTask.belongsTo("project", {className: "LintProject"})
LintProject.hasMany("lintTasks", {className: "LintTask"})

class LintEvent extends DatabaseRecord {}
class LintOrphanSetting extends DatabaseRecord {}

LintOrphanSetting.belongsTo("lintEvent", {className: "LintEvent"})

class LintArticle extends DatabaseRecord {}
class LintArticleTranslation extends DatabaseRecord {}

LintArticle.setTableName("lint_articles")
LintArticle.translates("title")
LintArticleTranslation.setTableName("lint_article_translations")
LintArticleTranslation.belongsTo("lintArticle", {className: "LintArticle"})

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
 * @param {object} [options] - Run options.
 * @param {string} [options.directory] - CLI project directory.
 * @param {boolean} [options.testing] - Whether to run the CLI in test mode.
 * @returns {Promise<?>} - Resolves with the CLI result.
 */
async function runLint(configuration, processArgs = ["lint:relationships"], {directory = dummyDirectory(), testing = true} = {}) {
  const cli = new Cli({
    configuration,
    directory,
    environmentHandler: configuration.getEnvironmentHandler(),
    processArgs,
    testing
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

  it("accepts the implicit inverse created by translates for concrete translation models", async () => {
    await runLint(buildConfiguration([LintArticle, LintArticleTranslation]))
  })

  it("registers conventional model files without running app initialization", async () => {
    const projectDirectory = path.resolve(dummyDirectory(), "../..")
    const tempDirectory = path.join(dummyDirectory(), "tmp-relationship-lint-static")
    const modelsDirectory = path.join(tempDirectory, "src/models")
    const databaseRecordImportPath = pathToFileURL(path.join(projectDirectory, "src/database/record/index.js")).href

    await fs.rm(tempDirectory, {force: true, recursive: true})
    await fs.mkdir(modelsDirectory, {recursive: true})

    await fs.writeFile(path.join(modelsDirectory, "lint-static-project.js"), [
      `import DatabaseRecord from ${JSON.stringify(databaseRecordImportPath)}`,
      "class LintStaticProject extends DatabaseRecord {}",
      "LintStaticProject.hasMany(\"lintStaticTasks\", {className: \"LintStaticTask\"})",
      "export default LintStaticProject",
      ""
    ].join("\n"))

    await fs.writeFile(path.join(modelsDirectory, "lint-static-task.js"), [
      `import DatabaseRecord from ${JSON.stringify(databaseRecordImportPath)}`,
      "class LintStaticTask extends DatabaseRecord {}",
      "LintStaticTask.belongsTo(\"project\", {className: \"LintStaticProject\"})",
      "export default LintStaticTask",
      ""
    ].join("\n"))

    try {
      const configuration = new Configuration({
        database: {test: {}},
        directory: tempDirectory,
        environment: "test",
        environmentHandler: new EnvironmentHandlerNode(),
        initializeModels: async () => {
          throw new Error("Relationship lint should not run app initialization when src/models exists")
        },
        locale: "en",
        localeFallbacks: {en: ["en"]},
        locales: ["en"]
      })

      await runLint(configuration, ["lint:relationships"], {directory: tempDirectory, testing: false})
    } finally {
      await fs.rm(tempDirectory, {force: true, recursive: true})
    }
  })

  it("falls back to app initialization when the conventional model directory is empty", async () => {
    const tempDirectory = path.join(dummyDirectory(), "tmp-relationship-lint-empty-static")
    const modelsDirectory = path.join(tempDirectory, "src/models")
    let initializeModelsCalled = false

    await fs.rm(tempDirectory, {force: true, recursive: true})
    await fs.mkdir(modelsDirectory, {recursive: true})

    try {
      const configuration = new Configuration({
        database: {test: {}},
        directory: tempDirectory,
        environment: "test",
        environmentHandler: new EnvironmentHandlerNode(),
        initializeModels: async () => {
          initializeModelsCalled = true
        },
        locale: "en",
        localeFallbacks: {en: ["en"]},
        locales: ["en"]
      })

      await runLint(configuration, ["lint:relationships"], {directory: tempDirectory, testing: false})

      expect(initializeModelsCalled).toEqual(true)
    } finally {
      await fs.rm(tempDirectory, {force: true, recursive: true})
    }
  })
})
