import BaseCommand from "../../../../../cli/base-command.js"
import deburrColumnName from "../../../../../utils/deburr-column-name.js"
import fileExists from "../../../../../utils/file-exists.js"
import fs from "fs/promises"
import generatedFileBanner from "./generated-file-banner.js"
import * as inflection from "inflection"

const BASE_MODELS_REGENERATE_COMMAND = "velocious generate:base-models"

/**
 * Maps an effective column type to the JSDoc type used in generated base models.
 * @type {Record<string, string>}
 */
const jsDocTypeByColumnType = {
  bigint: "number",
  bit: "number",
  blob: "string",
  boolean: "boolean",
  char: "string",
  "character varying": "string",
  date: "Date",
  datetime: "Date",
  decimal: "number",
  float: "number",
  int: "number",
  integer: "number",
  json: "Record<string, ?>",
  longtext: "string",
  mediumtext: "string",
  numeric: "number",
  nvarchar: "string",
  smallint: "number",
  text: "string",
  "timestamp without time zone": "Date",
  tinyint: "number",
  tinytext: "string",
  uuid: "string",
  varchar: "string"
}

/** Effective column types whose generated setter additionally accepts a string. */
const setterStringInputColumnTypes = new Set(["date", "datetime", "timestamp without time zone"])

/**
 * Generates a base-model relationship method.
 * @param {{abstract?: boolean, body: string, name: string, param?: {name: string, type: string}, returns: string}} args - Method parts.
 * @returns {string} - Generated method source.
 */
function generatedRelationshipMethod({abstract = false, body, name, param, returns}) {
  let fileContent = "  /**\n"

  if (abstract) fileContent += "   * @abstract\n"
  if (param) fileContent += `   * @param {${param.type}} ${param.name}\n`
  fileContent += `   * @returns {${returns}}\n`
  fileContent += "   */\n"
  fileContent += `  ${name}(${param ? param.name : ""}) { ${body} }\n`

  return fileContent
}

export default class DbGenerateModel extends BaseCommand {
  async execute() {
    await this.getConfiguration().initializeModels()

    const enforceTenantDatabaseScopes = this.getConfiguration().getEnforceTenantDatabaseScopes()

    const rootDirectory = this.directory()
    const modelsDir = `${rootDirectory}/src/models`
    const baseModelsDir = `${rootDirectory}/src/model-bases`
    const modelClasses = this.getConfiguration().getModelClasses()
    const allowMissingTables = Boolean(this.processArgs?.includes("--allow-missing-tables"))
    let devMode = false

    if (baseModelsDir.includes("/spec/dummy/src/model-bases")) {
      devMode = true
    }

    if (!await fileExists(baseModelsDir)) {
      await fs.mkdir(baseModelsDir, {recursive: true})
    }

    this.getConfiguration().setEnforceTenantDatabaseScopes(false)

    try {
      await this.getConfiguration().ensureConnections({name: "Generate base models"}, async () => {
        for (const modelClassName in modelClasses) {
        const modelClass = modelClasses[modelClassName]
        const table = await modelClass.connection().getTableByName(modelClass.tableName(), {throwError: !allowMissingTables})

        if (!table) {
          console.warn(`Skipping base model for '${modelClass.name}': table '${modelClass.tableName()}' was not found (--allow-missing-tables). Keeping any existing base model.`)

          continue
        }

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

        let fileContent = generatedFileBanner(BASE_MODELS_REGENERATE_COMMAND)
        let velociousPath

        if (devMode) {
          velociousPath = "../../../../src"
        } else {
          velociousPath = "velocious/build/src"
        }

        const columns = await table.getColumns()
        const writeAttributeTypeName = `${modelNameCamelized}WriteAttributes`
        const belongsToWriteAttributes = await this.belongsToWriteAttributesForModel({modelClass, modelsDir})
        const nestedWriteAttributes = this.nestedWriteAttributesForModel({modelClass})

        fileContent += `import DatabaseRecord from "${velociousPath}/database/record/index.js"\n\n`
        fileContent += "/**\n"
        fileContent += ` * Attributes accepted when creating or updating ${modelNameCamelized} records.\n`
        fileContent += ` * @typedef {object} ${writeAttributeTypeName}\n`
        for (const column of columns) {
          const deburredColumnName = deburrColumnName(column.getName())
          const camelizedColumnName = inflection.camelize(deburredColumnName, true)
          const setterJsdocType = this.jsDocSetterTypeFromColumn(column, modelClass)

          if (setterJsdocType) {
            fileContent += ` * @property {${setterJsdocType}${column.getNull() ? " | null" : ""}} [${camelizedColumnName}] - Value for the ${camelizedColumnName} attribute.\n`
          }
        }
        for (const belongsToWriteAttribute of belongsToWriteAttributes) {
          fileContent += ` * @property {${belongsToWriteAttribute.propertyType}} [${belongsToWriteAttribute.propertyName}] - Related ${belongsToWriteAttribute.relationshipName} record.\n`
        }
        for (const nestedWriteAttribute of nestedWriteAttributes) {
          fileContent += ` * @property {${nestedWriteAttribute.propertyType}} [${nestedWriteAttribute.propertyName}] - Nested ${nestedWriteAttribute.relationshipName} attributes.\n`
        }
        fileContent += " */\n\n"

        const hasManyRelationFilePath = `${velociousPath}/database/record/instance-relationships/has-many.js`

        fileContent += `/** @augments {DatabaseRecord<${writeAttributeTypeName}>} */\n`
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

      let methodsCount = 0

      for (const column of columns) {
        const deburredColumnName = deburrColumnName(column.getName())
        const camelizedColumnName = inflection.camelize(deburredColumnName, true)
        const camelizedColumnNameBigFirst = inflection.camelize(deburredColumnName)
        const jsdocType = this.jsDocTypeFromColumn(column, modelClass)

        if (methodsCount > 0) {
          fileContent += "\n"
        }

        if (jsdocType) {
          fileContent += "  /**\n"
          fileContent += `   * @returns {${jsdocType}${column.getNull() ? " | null" : ""}}\n`
          fileContent += "   */\n"
        }

        fileContent += `  ${camelizedColumnName}() { return this.readAttribute("${camelizedColumnName}") }\n\n`

        const setterJsdocType = this.jsDocSetterTypeFromColumn(column, modelClass)

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

      if (Object.prototype.hasOwnProperty.call(modelClass, "_translations") && modelClass._translations && Object.keys(modelClass._translations).length > 0) {
        const TranslationClass = modelClass.getTranslationClass()
        const translationColumns = TranslationClass.getColumns()

        for (const name in modelClass._translations) {
          const nameUnderscore = inflection.underscore(name)
          const column = translationColumns.find((translationColumn) => translationColumn.getName() === nameUnderscore)
          let translationJsdocType

          if (column) {
            translationJsdocType = this.jsDocTypeFromColumn(column, TranslationClass)
          }

          if (translationJsdocType && column) {
            fileContent += `\n`
            fileContent += "  /**\n"
            fileContent += `   * @returns {${translationJsdocType}${column.getNull() ? " | null" : ""}}\n`
            fileContent += "   */\n"
          }

          fileContent += `  ${name}() { return this._getTranslatedAttributeWithFallback("${name}", this._getConfiguration().getLocale()) ?? null }\n`
          methodsCount++

          const hasName = `has${inflection.camelize(name)}`
          const setterName = `set${inflection.camelize(name)}`
          const setterParamType = translationJsdocType || "?"

          fileContent += `\n`
          fileContent += "  /**\n"
          fileContent += `   * @abstract\n`
          fileContent += `   * @returns {boolean}\n`
          fileContent += "   */\n"
          fileContent += `  ${hasName}() { throw new Error("${hasName} not implemented") }\n`
          methodsCount++

          fileContent += `\n`
          fileContent += "  /**\n"
          fileContent += `   * @param {${setterParamType}} newValue\n`
          fileContent += `   * @returns {void}\n`
          fileContent += "   */\n"
          fileContent += `  ${setterName}(newValue) { return this._setTranslatedAttribute("${name}", this._getConfiguration().getLocale(), newValue) }\n`
          methodsCount++

          for (const locale of this.getConfiguration().getLocales()) {
            const localeMethodName = `${name}${inflection.camelize(locale)}`

            if (translationJsdocType && column) {
              fileContent += `\n`
              fileContent += "  /**\n"
              fileContent += `   * @returns {${translationJsdocType}${column.getNull() ? " | null" : ""}}\n`
              fileContent += "   */\n"
            }

            fileContent += `  ${localeMethodName}() { return this._getTranslatedAttributeWithFallback("${name}", "${locale}") ?? null }\n`
            methodsCount++

            const localeSetterName = `${setterName}${inflection.camelize(locale)}`

            fileContent += `\n`
            fileContent += "  /**\n"
            fileContent += `   * @param {${setterParamType}} newValue\n`
            fileContent += `   * @returns {void}\n`
            fileContent += "   */\n"
            fileContent += `  ${localeSetterName}(newValue) { return this._setTranslatedAttribute("${name}", "${locale}", newValue) }\n`
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
          const targetModelClass = relationship.getTargetModelClass()

          if (!targetModelClass) throw new Error(`Relationship '${relationship.getRelationshipName()}' on '${modelClass.getModelName()}' has no target model class`)

          fileName = inflection.dasherize(inflection.underscore(targetModelClass.getModelName()))
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
          fileContent += "   * @param {Record<string, ?>} [attributes]\n"
          fileContent += `   * @returns {import("${modelFilePath}").default}\n`
          fileContent += "   */\n"
          fileContent += `  build${inflection.camelize(relationship.getRelationshipName())}(attributes) { void attributes; throw new Error("Not implemented") }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += "   * @abstract\n"
          fileContent += `   * @returns {Promise<import("${modelFilePath}").default | undefined>}\n`
          fileContent += "   */\n"
          fileContent += `  load${inflection.camelize(relationship.getRelationshipName())}() { throw new Error("Not implemented") }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += `   * @returns {Promise<import("${modelFilePath}").default | undefined>}\n`
          fileContent += "   */\n"
          fileContent += `  ${relationship.getRelationshipName()}OrLoad() { return /** @type {Promise<import("${modelFilePath}").default | undefined>} */ (this.relationshipOrLoad("${relationship.getRelationshipName()}", {preloadTranslations: true})) }\n`

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += "   * @abstract\n"
          fileContent += `   * @param {import("${modelFilePath}").default} newModel\n`
          fileContent += `   * @returns {void}\n`
          fileContent += "   */\n"
          fileContent += `  set${inflection.camelize(relationship.getRelationshipName())}(newModel) { void newModel; throw new Error("Not implemented") }\n`
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
          fileContent += generatedRelationshipMethod({
            abstract: true,
            body: "throw new Error(\"Not implemented\")",
            name: `load${inflection.camelize(relationship.getRelationshipName())}`,
            returns: `Promise<Array<import("${recordImport}").default>>`
          })

          fileContent += "\n"
          fileContent += generatedRelationshipMethod({
            body: `return /** @type {Promise<Array<import("${recordImport}").default>>} */ (this.relationshipOrLoad("${relationship.getRelationshipName()}"))`,
            name: `${relationship.getRelationshipName()}OrLoad`,
            returns: `Promise<Array<import("${recordImport}").default>>`
          })

          fileContent += "\n"
          fileContent += "  /**\n"
          fileContent += "   * @abstract\n"
          fileContent += `   * @param {Array<import("${recordImport}").default>} newModels\n`
          fileContent += "   * @returns {void}\n"
          fileContent += "   */\n"
          fileContent += `  set${inflection.camelize(relationship.getRelationshipName())}(newModels) { void newModels; throw new Error("Not implemented") }\n`
        } else {
          throw new Error(`Unknown relationship type: ${relationship.getType()}`)
        }

        methodsCount++
      }

      fileContent += "}\n"

        await fs.writeFile(modelPath, fileContent)
        }
      })
    } finally {
      this.getConfiguration().setEnforceTenantDatabaseScopes(enforceTenantDatabaseScopes)
    }
  }

  /**
   * Runs js doc type from column.
   * @param {import("../../../../../database/drivers/base-column.js").default} column - Column.
   * @param {typeof import("../../../../../database/record/index.js").default} modelClass - Model class owning the column (for declared attribute casts).
   * @returns {string | undefined} - The js doc type from column.
   */
  jsDocTypeFromColumn(column, modelClass) {
    const type = modelClass.getColumnTypeByName(column.getName())
    const jsDocType = type ? jsDocTypeByColumnType[type] : undefined

    if (!jsDocType) {
      console.error(`Unknown column type: ${type}`)

      return undefined
    }

    return jsDocType
  }

  /**
   * Runs js doc setter type from column.
   * @param {import("../../../../../database/drivers/base-column.js").default} column - Column.
   * @param {typeof import("../../../../../database/record/index.js").default} modelClass - Model class owning the column (for declared attribute casts).
   * @returns {string | undefined} - The js doc setter type from column.
   */
  jsDocSetterTypeFromColumn(column, modelClass) {
    const type = modelClass.getColumnTypeByName(column.getName())

    if (type && setterStringInputColumnTypes.has(type)) {
      return "Date | string"
    }

    return this.jsDocTypeFromColumn(column, modelClass)
  }

  /**
   * Runs belongs to write attributes for model.
   * @param {object} args - Arguments.
   * @param {typeof import("../../../../../database/record/index.js").default} args.modelClass - Model class.
   * @param {string} args.modelsDir - Source models directory.
   * @returns {Promise<Array<{propertyName: string, propertyType: string, relationshipName: string}>>} - Belongs-to write attributes.
   */
  async belongsToWriteAttributesForModel({modelClass, modelsDir}) {
    const writeAttributes = []

    for (const relationship of modelClass.getRelationships()) {
      if (relationship.getType() !== "belongsTo") continue
      if (relationship.getPolymorphic()) continue

      const targetModelClass = relationship.getTargetModelClass()

      if (!targetModelClass) throw new Error(`Relationship '${relationship.getRelationshipName()}' on '${modelClass.getModelName()}' has no target model class`)

      const targetModelFileName = inflection.dasherize(inflection.underscore(targetModelClass.getModelName()))
      const targetModelPath = `${modelsDir}/${targetModelFileName}.js`
      const targetImportPath = await fileExists(targetModelPath) ? `../models/${targetModelFileName}.js` : `./${targetModelFileName}.js`

      writeAttributes.push({
        propertyName: relationship.getRelationshipName(),
        propertyType: `import("${targetImportPath}").default`,
        relationshipName: relationship.getRelationshipName()
      })
    }

    return writeAttributes
  }

  /**
   * Runs nested write attributes for model.
   * @param {object} args - Arguments.
   * @param {typeof import("../../../../../database/record/index.js").default} args.modelClass - Model class.
   * @returns {Array<{propertyName: string, propertyType: string, relationshipName: string}>} - Nested write attributes.
   */
  nestedWriteAttributesForModel({modelClass}) {
    const acceptedNestedAttributes = modelClass._acceptedNestedAttributes || {}
    const nestedWriteAttributes = []

    for (const relationshipName of Object.keys(acceptedNestedAttributes)) {
      const relationship = modelClass.getRelationshipByName(relationshipName)
      const relationshipType = relationship.getType()
      const targetModelClass = relationship.getTargetModelClass()

      if (!targetModelClass) throw new Error(`Relationship '${relationshipName}' on '${modelClass.getModelName()}' has no target model class`)

      const targetModelFileName = inflection.dasherize(inflection.underscore(targetModelClass.getModelName()))
      const targetWriteTypeName = `${inflection.camelize(targetModelClass.getModelName().replaceAll("-", "_"))}WriteAttributes`
      const nestedType = `import("./${targetModelFileName}.js").${targetWriteTypeName}${acceptedNestedAttributes[relationshipName]?.allowDestroy ? " & {_destroy?: boolean}" : ""}`

      nestedWriteAttributes.push({
        propertyName: `${relationshipName}Attributes`,
        propertyType: relationshipType == "hasMany" ? `Array<${nestedType}>` : nestedType,
        relationshipName
      })
    }

    return nestedWriteAttributes
  }
}
