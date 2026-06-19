// @ts-check

import BaseCommand from "../../../../../cli/base-command.js"
import fs from "node:fs/promises"
import path from "node:path"
import requireContext from "require-context"

/**
 * @typedef {(id: string) => {default: typeof import("../../../../../database/record/index.js").default}} ModelFileRequireContextIdFunctionType
 * @typedef {ModelFileRequireContextIdFunctionType & {keys: () => string[]}} ModelFileRequireContextType
 */

/**
 * Lints model relationships: every non-polymorphic belongs-to relationship should have an inverse
 * has-many or has-one relationship declared on its target model class. A missing inverse usually
 * means the target model was never told about the association (e.g. an Event model missing
 * `hasMany("priceCategorySettings")` while PriceCategorySetting declares `belongsTo("event")`).
 *
 * Specific relationships can be ignored through a JSON config file (default:
 * `relationship-lint.json` in the project directory, overridable with `--config <path>`):
 *
 *   {"ignore": ["PriceCategorySetting#event"]}
 *
 * where each entry is `<model class name>#<belongs-to relationship name>`.
 */
export default class VelociousCliCommandsLintRelationships extends BaseCommand {
  /**
   * Runs execute.
   * @returns {Promise<{offences: Array<{ignoreKey: string, message: string}>}>} - Resolves with the found offences (empty when the lint passes).
   */
  async execute() {
    // Relationship target resolution (getTargetModelClass) looks model classes up through the
    // current configuration, so make this command's configuration the current one.
    this.getConfiguration().setCurrent()

    if (!await this._registerStaticModelFiles()) {
      await this.getConfiguration().initializeModels()
    }

    const ignoredRelationships = await this._loadIgnoredRelationships()
    const offences = []
    const modelClasses = Object.values(this.getConfiguration().getModelClasses())

    for (const modelClass of modelClasses) {
      for (const relationship of modelClass.getRelationships()) {
        if (relationship.getType() != "belongsTo") continue
        if (relationship.getPolymorphic()) continue

        const ignoreKey = `${modelClass.name}#${relationship.getRelationshipName()}`

        if (ignoredRelationships.has(ignoreKey)) continue

        let targetModelClass

        try {
          targetModelClass = relationship.getTargetModelClass()
        } catch (error) {
          offences.push({
            ignoreKey,
            message: `${ignoreKey}: couldn't resolve the target model class: ${error instanceof Error ? error.message : error}`
          })

          continue
        }

        if (!targetModelClass) {
          offences.push({ignoreKey, message: `${ignoreKey}: couldn't resolve the target model class`})

          continue
        }

        const inverseRelationship = targetModelClass.getRelationships().find((candidate) => {
          if (candidate.getType() != "hasMany" && candidate.getType() != "hasOne") return false
          if (candidate.through) return false

          try {
            const candidateTargetModelClass = candidate.getTargetModelClass()

            if (!candidateTargetModelClass) return false

            return this._modelClassesMatch(candidateTargetModelClass, modelClass)
          } catch {
            // A has-many/has-one with an unresolvable target can't be the inverse of this belongs-to.
            // It is reported separately when its own model's belongs-to relationships are linted.
            return false
          }
        })

        if (inverseRelationship) continue

        offences.push({
          ignoreKey,
          message: `${targetModelClass.name} is missing an inverse hasMany/hasOne relationship for ${ignoreKey} (belongsTo). ` +
            `Declare the inverse on ${targetModelClass.name} or add "${ignoreKey}" to the ignore config.`
        })
      }
    }

    for (const offence of offences) {
      console.error(offence.message)
    }

    if (offences.length > 0) {
      throw new Error(`Relationship lint failed with ${offences.length} offence(s):\n${offences.map((offence) => offence.message).join("\n")}`)
    }

    console.log(`Relationship lint passed for ${modelClasses.length} model(s).`)

    return {offences}
  }

  /**
   * Registers model classes from the conventional src/models directory without
   * running the application's full database/server initialization.
   * @returns {Promise<boolean>} Whether static model files were registered.
   */
  async _registerStaticModelFiles() {
    if (this.args.testing) return false

    const modelsDirectory = path.join(this.directory(), "src/models")

    try {
      const stats = await fs.stat(modelsDirectory)

      if (!stats.isDirectory()) return false
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code == "ENOENT") return false

      throw error
    }

    if ((await this._javascriptFilesInDirectory(modelsDirectory)).length === 0) return false

    /** @type {ModelFileRequireContextType} */
    const requireContextModels = requireContext(modelsDirectory, true, /^(.+)\.js$/)

    const modelFileNames = requireContextModels.keys()
    for (const fileName of modelFileNames) {
      const modelClassImport = requireContextModels(fileName)
      const modelClass = modelClassImport.default

      if (!modelClass) {
        throw new Error(`Model wasn't exported from: ${fileName}`)
      }

      modelClass.registerRecordClass({configuration: this.getConfiguration()})
    }

    return true
  }

  /**
   * Finds JavaScript files below a directory.
   * @param {string} directory - Directory to scan.
   * @returns {Promise<string[]>} JavaScript file paths.
   */
  async _javascriptFilesInDirectory(directory) {
    const filePaths = []
    const entries = await fs.readdir(directory, {withFileTypes: true})

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        filePaths.push(...await this._javascriptFilesInDirectory(entryPath))
        continue
      }

      if (entry.isFile() && entry.name.endsWith(".js")) {
        filePaths.push(entryPath)
      }
    }

    return filePaths
  }

  /**
   * Checks whether two model class objects describe the same registered model.
   * @param {typeof import("../../../../../database/record/index.js").default} leftModelClass - Candidate target model class.
   * @param {typeof import("../../../../../database/record/index.js").default} rightModelClass - Belongs-to source model class.
   * @returns {boolean} Whether both model classes represent the same model identity.
   */
  _modelClassesMatch(leftModelClass, rightModelClass) {
    if (leftModelClass === rightModelClass) return true
    // `translates()` creates an internal translation class; apps may also define
    // a concrete class for the same model/table so generated code has a stable
    // file and type name.
    if (leftModelClass.getModelName() != rightModelClass.getModelName()) return false

    return leftModelClass.tableName() == rightModelClass.tableName()
  }

  /**
   * Loads the ignored relationship keys from the lint config file. The file is optional; when the
   * default path doesn't exist, no relationships are ignored. An explicitly passed `--config` path
   * must exist.
   * @returns {Promise<Set<string>>} - Ignored `<model>#<relationship>` keys.
   */
  async _loadIgnoredRelationships() {
    const configArgIndex = this.processArgs?.indexOf("--config") ?? -1
    const explicitConfigPath = configArgIndex >= 0 ? this.processArgs?.[configArgIndex + 1] : undefined

    if (configArgIndex >= 0 && !explicitConfigPath) {
      throw new Error("--config was given without a path argument")
    }

    const configPath = explicitConfigPath
      ? path.resolve(this.directory(), explicitConfigPath)
      : path.join(this.directory(), "relationship-lint.json")

    let configContent

    try {
      configContent = await fs.readFile(configPath, "utf8")
    } catch (error) {
      if (!explicitConfigPath && /** @type {NodeJS.ErrnoException} */ (error).code == "ENOENT") {
        return new Set()
      }

      throw error
    }

    const config = JSON.parse(configContent)

    if (config === null || typeof config != "object" || Array.isArray(config)) {
      throw new Error(`Relationship lint config must be a JSON object: ${configPath}`)
    }

    const ignore = config.ignore ?? []

    if (!Array.isArray(ignore) || ignore.some((entry) => typeof entry != "string")) {
      throw new Error(`Relationship lint config "ignore" must be an array of "<model>#<relationship>" strings: ${configPath}`)
    }

    return new Set(ignore)
  }
}
