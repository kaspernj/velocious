import BaseCommand from "../../../../../cli/base-command.js"
import fileExists from "../../../../../utils/file-exists.js"
import fs from "fs/promises"
import * as inflection from "inflection"

export default class DbGenerateModel extends BaseCommand {
  async execute() {
    await this.getConfiguration().initializeModels()

    const modelsDir = `${process.cwd()}/src/model-bases`
    const modelClasses = this.getConfiguration().getModelClasses()

    if (!await fileExists(modelsDir)) {
      await fs.mkdir(modelsDir, {recursive: true})
    }

    for (const modelClassName in modelClasses) {
      const modelClass = modelClasses[modelClassName]
      const modelName = inflection.dasherize(modelClassName)
      const modelNameCamelized = inflection.camelize(modelName.replaceAll("-", "_"))
      const modelBaseFileName = `${inflection.dasherize(inflection.underscore(modelName))}.js`
      const modelPath = `${modelsDir}/${modelBaseFileName}`

      console.log(`create src/model-bases/${modelBaseFileName}`)

      let fileContent = `import Record from "velocious/src/database/record/index.js"\n\n`

      fileContent += `export default class ${modelNameCamelized}Base extends Record {\n`

      const columns = await modelClass._getTable().getColumns()
      let methodsCount = 0

      for (const column of columns) {
        const camelizedColumnName = inflection.camelize(column.getName(), true)
        const camelizedColumnNameBigFirst = inflection.camelize(column.getName())
        let jsdocType

        if (column.getType() == "varchar") {
          jsdocType = "string"
        } else if (["bigint", "int", "integer", "smallint"].includes(column.getType())) {
          jsdocType = "number"
        } else if (["date", "datetime"].includes(column.getType())) {
          jsdocType = "Date"
        }

        if (methodsCount > 0) {
          fileContent += "\n"
        }

        if (jsdocType) {
          fileContent += "  /**\n"
          fileContent += `   * @returns {${jsdocType}}\n`
          fileContent += "   */\n"
        }

        fileContent += `  ${camelizedColumnName}() { return this.readAttribute("${camelizedColumnName}") }\n\n`

        if (jsdocType) {
          fileContent += "  /**\n"
          fileContent += `   * @param {${jsdocType}} newValue\n`
          fileContent += "   * @returns {void}\n"
          fileContent += "   */\n"
        }

        fileContent += `  set${camelizedColumnNameBigFirst}(newValue) { return this._setColumnAttribute("${camelizedColumnName}", newValue) }\n\n`

        fileContent += "  /**\n"
        fileContent += "   * @returns {boolean}\n"
        fileContent += "   */\n"
        fileContent += `  has${camelizedColumnNameBigFirst}() { return this._hasAttribute(this.${camelizedColumnName}()) }\n`

        methodsCount++
      }

      for (const relationship of modelClass.getRelationships()) {
        let fileName, fullFilePath

        if (relationship.getPolymorphic()) {
          fileName = "velocious/src/database/record/index.js"
        } else {
          fileName = inflection.dasherize(inflection.underscore(relationship.getTargetModelClass().name))
          fullFilePath = `src/models/${fileName}.js`
        }

        if (methodsCount > 0) {
          fileContent += "\n"
        }

        if (relationship.getType() == "belongsTo" || relationship.getType() == "hasOne") {
          let modelFilePath

          if (fullFilePath && await fileExists(fullFilePath)) {
            modelFilePath = `../models/${fileName}.js`
          } else {
            modelFilePath = "velocious/src/database/record/index.js"
          }

          fileContent += "  /**\n"
          fileContent += "   * @interface\n"
          fileContent += `   * @returns {import("${modelFilePath}").default}\n`
          fileContent += "   */\n"
          fileContent += `  ${relationship.getRelationshipName()}() { return this.getRelationshipByName("${relationship.getRelationshipName()}").loaded() }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += "   * @interface\n"
          fileContent += `   * @returns {import("${modelFilePath}").default}\n`
          fileContent += "   */\n"
          fileContent += `  build${inflection.camelize(relationship.getRelationshipName())}() { throw new Error("Not implemented") }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += "   * @interface\n"
          fileContent += "   * @returns {Promise<void>}\n"
          fileContent += "   */\n"
          fileContent += `  load${inflection.camelize(relationship.getRelationshipName())}() { throw new Error("Not implemented") }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += "   * @interface\n"
          fileContent += `   * @param {import("${modelFilePath}").default} newModel\n`
          fileContent += `   * @returns {void}\n`
          fileContent += "   */\n"
          fileContent += `  set${inflection.camelize(relationship.getRelationshipName())}() { throw new Error("Not implemented") }\n`
        } else if (relationship.getType() == "hasMany") {
          let recordImport

          if (fullFilePath && await fileExists(fullFilePath)) {
            recordImport = `../models/${fileName}.js`
          } else {
            recordImport = "velocious/src/database/record/index.js"
          }

          fileContent += "  /**\n"
          fileContent += "   * @interface\n"
          fileContent += `   * @returns {import("velocious/src/database/query/index.js").default<import("${recordImport}").default>}\n`
          fileContent += "   */\n"
          fileContent += `  ${relationship.getRelationshipName()}() { return this.getRelationshipByName("${relationship.getRelationshipName()}") }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += "   * @interface\n"
          fileContent += `   * @returns {Array<import("${recordImport}").default>}\n`
          fileContent += "   */\n"
          fileContent += `  ${relationship.getRelationshipName()}Loaded() { return this.getRelationshipByName("${relationship.getRelationshipName()}").loaded() }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += "   * @interface\n"
          fileContent += "   * @returns {Promise<void>}\n"
          fileContent += "   */\n"
          fileContent += `  load${inflection.camelize(relationship.getRelationshipName())}() { throw new Error("Not implemented") }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += "   * @interface\n"
          fileContent += `   * @param {Array<import("${recordImport}").default>} newModels\n`
          fileContent += "   * @returns {void>}\n"
          fileContent += "   */\n"
          fileContent += `  set${inflection.camelize(relationship.getRelationshipName())}() { throw new Error("Not implemented") }\n`
        } else {
          throw new Error(`Unknown relationship type: ${relationship.getType()}`)
        }

        methodsCount++
      }

      fileContent += "}\n"

      await fs.writeFile(modelPath, fileContent)
    }
  }
}
