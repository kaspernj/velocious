import BaseCommand from "../../../../../cli/base-command.js"
import fileExists from "../../../../../utils/file-exists.js"
import fs from "fs/promises"
import * as inflection from "inflection"

export default class DbGenerateModel extends BaseCommand {
  async execute() {
    await this.getConfiguration().initializeModels()

    const modelsDir = `${process.cwd()}/src/model-bases`
    const modelClasses = this.getConfiguration().getModelClasses()
    let devMode = false

    if (modelsDir.endsWith("velocious/spec/dummy/src/model-bases")) {
      devMode = true
    }

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

      let fileContent = ""

      if (devMode) {
        fileContent += `import Record from "../../../../src/database/record/index.js"\n\n`
      } else {
        fileContent += `import Record from "velocious/src/database/record/index.js"\n\n`
      }

      fileContent += `export default class ${modelNameCamelized}Base extends Record {\n`

      const columns = await modelClass._getTable().getColumns()
      let methodsCount = 0

      for (const column of columns) {
        const camelizedColumnName = inflection.camelize(column.getName(), true)
        const camelizedColumnNameBigFirst = inflection.camelize(column.getName())
        const jsdocType = this.jsDocTypeFromColumn(column)

        if (methodsCount > 0) {
          fileContent += "\n"
        }

        if (jsdocType) {
          fileContent += "  /**\n"
          fileContent += `   * @returns {${jsdocType}${column.getNull() ? " | null" : ""}}\n`
          fileContent += "   */\n"
        }

        fileContent += `  ${camelizedColumnName}() { return this.readAttribute("${camelizedColumnName}") }\n\n`

        if (jsdocType) {
          fileContent += "  /**\n"
          fileContent += `   * @param {${jsdocType}${column.getNull() ? " | null" : ""}} newValue\n`
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

      if (modelClass._translations) {
        const TranslationClass = modelClass.getTranslationClass()
        const translationColumns = TranslationClass.getColumns()

        for (const name in modelClass._translations) {
          const nameUnderscore = inflection.underscore(name)
          const column = translationColumns.find((translationColumn) => translationColumn.getName() === nameUnderscore)
          let translationJsdocType

          if (column) {
            translationJsdocType = this.jsDocTypeFromColumn(column)
          }

          if (translationJsdocType) {
            fileContent += `\n`
            fileContent += "  /**\n"
            fileContent += `   * @returns {${translationJsdocType}${column.getNull() ? " | null" : ""}}\n`
            fileContent += "   */\n"
          }

          fileContent += `  ${name}() { return this._getTranslatedAttributeWithFallback("${name}", this._getConfiguration().getLocale()) }\n`
          methodsCount++

          for (const locale of this.getConfiguration().getLocales()) {
            const localeMethodName = `${name}${inflection.camelize(locale)}`

            if (translationJsdocType) {
              fileContent += `\n`
              fileContent += "  /**\n"
              fileContent += `   * @returns {${translationJsdocType}${column.getNull() ? " | null" : ""}}\n`
              fileContent += "   */\n"
            }

            fileContent += `  ${localeMethodName}() { return this._getTranslatedAttributeWithFallback("${name}", "${locale}") }\n`

            methodsCount++
          }
        }
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
          fileContent += `   * @returns {import("${modelFilePath}").default}\n`
          fileContent += "   */\n"
          fileContent += `  ${relationship.getRelationshipName()}() { return this.getRelationshipByName("${relationship.getRelationshipName()}").loaded() }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += "   * @abstract\n"
          fileContent += "   * @param {Record<string, any>} attributes\n"
          fileContent += `   * @returns {import("${modelFilePath}").default}\n`
          fileContent += "   */\n"
          fileContent += `  build${inflection.camelize(relationship.getRelationshipName())}(attributes) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += "   * @abstract\n"
          fileContent += "   * @returns {Promise<void>}\n"
          fileContent += "   */\n"
          fileContent += `  load${inflection.camelize(relationship.getRelationshipName())}() { throw new Error("Not implemented") }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += "   * @abstract\n"
          fileContent += `   * @param {import("${modelFilePath}").default} newModel\n`
          fileContent += `   * @returns {void}\n`
          fileContent += "   */\n"
          fileContent += `  set${inflection.camelize(relationship.getRelationshipName())}(newModel) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars\n`
        } else if (relationship.getType() == "hasMany") {
          let recordImport

          if (fullFilePath && await fileExists(fullFilePath)) {
            recordImport = `../models/${fileName}.js`
          } else {
            recordImport = "velocious/src/database/record/index.js"
          }

          fileContent += "  /**\n"
          fileContent += `   * @returns {import("velocious/src/database/query/index.js").default<import("${recordImport}").default>}\n`
          fileContent += "   */\n"
          fileContent += `  ${relationship.getRelationshipName()}() { return this.getRelationshipByName("${relationship.getRelationshipName()}") }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += `   * @returns {Array<import("${recordImport}").default>}\n`
          fileContent += "   */\n"
          fileContent += `  ${relationship.getRelationshipName()}Loaded() { return this.getRelationshipByName("${relationship.getRelationshipName()}").loaded() }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += "   * @abstract\n"
          fileContent += "   * @returns {Promise<void>}\n"
          fileContent += "   */\n"
          fileContent += `  load${inflection.camelize(relationship.getRelationshipName())}() { throw new Error("Not implemented") }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += "   * @abstract\n"
          fileContent += `   * @param {Array<import("${recordImport}").default>} newModels\n`
          fileContent += "   * @returns {void}\n"
          fileContent += "   */\n"
          fileContent += `  set${inflection.camelize(relationship.getRelationshipName())}(newModels) { throw new Error("Not implemented") } // eslint-disable-line no-unused-vars\n`
        } else {
          throw new Error(`Unknown relationship type: ${relationship.getType()}`)
        }

        methodsCount++
      }

      fileContent += "}\n"

      await fs.writeFile(modelPath, fileContent)
    }
  }

  /**
   * @param {import("../../../../../database/drivers/base-column.js").default} column
   * @returns {string | undefined}
   */
  jsDocTypeFromColumn(column) {
    if (column.getType() == "varchar") {
      return "string"
    } else if (["bigint", "int", "integer", "smallint"].includes(column.getType())) {
      return "number"
    } else if (["date", "datetime"].includes(column.getType())) {
      return "Date"
    }
  }
}
