import BaseCommand from "../../../../../cli/base-command.js"
import fileExists from "../../../../../utils/file-exists.js"
import fs from "fs/promises"
import * as inflection from "inflection"

export default class DbGenerateModel extends BaseCommand {
  async execute() {
    await this.getConfiguration().initializeModels()

    const modelsDir = `${process.cwd()}/src/models`
    const baseModelsDir = `${process.cwd()}/src/model-bases`
    const modelClasses = this.getConfiguration().getModelClasses()
    let devMode = false

    if (baseModelsDir.includes("/spec/dummy/src/model-bases")) {
      devMode = true
    }

    if (!await fileExists(baseModelsDir)) {
      await fs.mkdir(baseModelsDir, {recursive: true})
    }

    for (const modelClassName in modelClasses) {
      const modelClass = modelClasses[modelClassName]
      const modelName = inflection.dasherize(modelClassName)
      const modelNameCamelized = inflection.camelize(modelName.replaceAll("-", "_"))
      const modelBaseFileName = `${inflection.dasherize(inflection.underscore(modelName))}.js`
      const modelPath = `${baseModelsDir}/${modelBaseFileName}`

      console.log(`create src/model-bases/${modelBaseFileName}`)

      const sourceModelFullFilePath = `${modelsDir}/${modelBaseFileName}`
      let sourceModelFilePath

      if (await fileExists(sourceModelFullFilePath)) {
        sourceModelFilePath = `../models/${modelBaseFileName}`
      } else {
        sourceModelFilePath = "velocious/build/src/database/record/index.js"
      }

      let fileContent = ""
      let velociousPath

      if (devMode) {
        velociousPath = "../../../../src"
      } else {
        velociousPath = "velocious/build/src"
      }

      fileContent += `import DatabaseRecord from "${velociousPath}/database/record/index.js"\n\n`

      const hasManyRelationFilePath = `${velociousPath}/database/record/instance-relationships/has-many.js`

      fileContent += `export default class ${modelNameCamelized}Base extends DatabaseRecord {\n`

      // --- getModelClass() override (fixes polymorphic typing in JS/JSDoc) ---
      if (await fileExists(sourceModelFullFilePath)) {
        // Model file exists (e.g. src/models/ticket.js) → return typeof Ticket
        fileContent += "  /**\n"
        fileContent += `   * @returns {typeof import("${sourceModelFilePath}").default}\n`
        fileContent += "   */\n"
        fileContent += "  // @ts-ignore - override narrows return type for better IntelliSense in generated model bases\n"
        fileContent += `  getModelClass() { return /** @type {typeof import("${sourceModelFilePath}").default} */ (this.constructor) }\n\n`
      } else {
        // No model file yet → fall back to typeof TicketBase
        fileContent += "  /**\n"
        fileContent += `   * @returns {typeof ${modelNameCamelized}Base}\n`
        fileContent += "   */\n"
        fileContent += "  // @ts-ignore - override narrows return type for better IntelliSense in generated model bases\n"
        fileContent += `  getModelClass() { return /** @type {typeof ${modelNameCamelized}Base} */ (this.constructor) }\n\n`
      }

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

        const setterJsdocType = this.jsDocSetterTypeFromColumn(column)

        if (setterJsdocType) {
          fileContent += "  /**\n"
          fileContent += `   * @param {${setterJsdocType}${column.getNull() ? " | null" : ""}} newValue\n`
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

          fileContent += `  ${name}() { return this._getTranslatedAttributeWithFallback("${name}", this._getConfiguration().getLocale()) ?? null }\n`
          methodsCount++

          const hasName = `has${inflection.camelize(name)}`

          fileContent += `\n`
          fileContent += "  /**\n"
          fileContent += `   * @abstract\n`
          fileContent += `   * @returns {boolean}\n`
          fileContent += "   */\n"
          fileContent += `  ${hasName}() { throw new Error("${hasName} not implemented") }\n`
          methodsCount++

          for (const locale of this.getConfiguration().getLocales()) {
            const localeMethodName = `${name}${inflection.camelize(locale)}`

            if (translationJsdocType) {
              fileContent += `\n`
              fileContent += "  /**\n"
              fileContent += `   * @returns {${translationJsdocType}${column.getNull() ? " | null" : ""}}\n`
              fileContent += "   */\n"
            }

            fileContent += `  ${localeMethodName}() { return this._getTranslatedAttributeWithFallback("${name}", "${locale}") ?? null }\n`
            methodsCount++

            const localeHasName = `has${inflection.camelize(localeMethodName)}`

            fileContent += `\n`
            fileContent += "  /**\n"
            fileContent += `   * @abstract\n`
            fileContent += `   * @returns {boolean}\n`
            fileContent += "   */\n"
            fileContent += `  ${localeHasName}() { throw new Error("${localeHasName} not implemented") }\n`
            methodsCount++
          }
        }
      }

      for (const relationship of modelClass.getRelationships()) {
        let baseFilePath, baseFullFilePath, fileName, fullFilePath

        if (relationship.getPolymorphic()) {
          fileName = "velocious/build/src/database/record/index.js"
        } else {
          fileName = inflection.dasherize(inflection.underscore(relationship.getTargetModelClass().name))
          fullFilePath = `src/models/${fileName}.js`
          baseFilePath = `../model-bases/${fileName}.js`
          baseFullFilePath = `src/model-bases/${fileName}.js`
        }

        if (methodsCount > 0) {
          fileContent += "\n"
        }

        if (relationship.getType() == "belongsTo" || relationship.getType() == "hasOne") {
          let modelFilePath

          if (fullFilePath && await fileExists(fullFilePath)) {
            modelFilePath = `../models/${fileName}.js`
          } else if (baseFullFilePath && await fileExists(baseFullFilePath)) {
            modelFilePath = baseFilePath
          } else {
            modelFilePath = "velocious/build/src/database/record/index.js"
          }

          fileContent += "  /**\n"
          fileContent += `   * @returns {import("${modelFilePath}").default}\n`
          fileContent += "   */\n"
          fileContent += `  ${relationship.getRelationshipName()}() { return /** @type {import("${modelFilePath}").default} */ (this.getRelationshipByName("${relationship.getRelationshipName()}").loaded()) }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += "   * @abstract\n"
          fileContent += "   * @param {Record<string, any>} [attributes]\n"
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
          } else if (baseFullFilePath && await fileExists(baseFullFilePath)) {
            recordImport = `../model-bases/${fileName}.js`
          } else {
            recordImport = `${velociousPath}/database/record/index.js`
          }

          fileContent += "  /**\n"
          fileContent += `   * @returns {import("${hasManyRelationFilePath}").default<typeof import("${sourceModelFilePath}").default, typeof import("${recordImport}").default>}\n`
          fileContent += "   */\n"
          fileContent += `  ${relationship.getRelationshipName()}() { return /** @type {import("${hasManyRelationFilePath}").default<typeof import("${sourceModelFilePath}").default, typeof import("${recordImport}").default>} */ (this.getRelationshipByName("${relationship.getRelationshipName()}")) }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += `   * @returns {Array<import("${recordImport}").default>}\n`
          fileContent += "   */\n"
          fileContent += `  ${relationship.getRelationshipName()}Loaded() { return /** @type {Array<import("${recordImport}").default>} */ (this.getRelationshipByName("${relationship.getRelationshipName()}").loaded()) }\n`

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
   * @param {import("../../../../../database/drivers/base-column.js").default} column - Column.
   * @returns {string | undefined} - The js doc type from column.
   */
  jsDocTypeFromColumn(column) {
    const type = column.getType()

    if (type == "boolean") {
      return "boolean"
    } else if (type == "json") {
      return "Record<string, any>"
    } else if (["blob", "char", "nvarchar", "varchar", "text", "longtext", "uuid"].includes(type)) {
      return "string"
    } else if (["bit", "bigint", "float", "int", "integer", "smallint", "tinyint"].includes(type)) {
      return "number"
    } else if (["date", "datetime"].includes(type)) {
      return "Date"
    } else {
      console.error(`Unknown column type: ${type}`)
    }
  }

  /**
   * @param {import("../../../../../database/drivers/base-column.js").default} column - Column.
   * @returns {string | undefined} - The js doc setter type from column.
   */
  jsDocSetterTypeFromColumn(column) {
    const type = column.getType()

    if (["date", "datetime"].includes(type)) {
      return "Date | string"
    }

    return this.jsDocTypeFromColumn(column)
  }
}
