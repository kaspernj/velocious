import BaseCommand from "../../../../../cli/base-command.js"
import fs from "fs/promises"
import * as inflection from "inflection"

/** Node CLI command that generates frontend model classes from backend project resource config. */
export default class DbGenerateFrontendModels extends BaseCommand {
  /** @returns {Promise<void>} - Resolves when files are generated. */
  async execute() {
    const configuration = this.getConfiguration()
    const backendProjects = configuration.getBackendProjects()

    if (!Array.isArray(backendProjects) || backendProjects.length === 0) {
      throw new Error("No backend projects configured. Configure 'backendProjects' in your configuration first")
    }

    /** @type {Set<string>} */
    const generatedModelNames = new Set()
    /** @type {Set<string>} */
    const ensuredDirectories = new Set()

    for (const backendProject of backendProjects) {
      const frontendModelsDir = this.frontendModelsDirectoryForBackendProject(backendProject)
      const importPath = this.importPathForFrontendModelsDirectory(frontendModelsDir)

      if (!ensuredDirectories.has(frontendModelsDir)) {
        await fs.mkdir(frontendModelsDir, {recursive: true})
        ensuredDirectories.add(frontendModelsDir)
      }

      const resources = this.resourcesForBackendProject(backendProject)
      const availableFrontendModelClassNames = this.availableFrontendModelClassNames(resources)

      for (const modelClassName in resources) {
        const modelConfig = resources[modelClassName]
        const className = inflection.camelize(modelClassName.replaceAll("-", "_"))
        const fileName = `${inflection.dasherize(inflection.underscore(className))}.js`
        const filePath = `${frontendModelsDir}/${fileName}`

        this.validateModelConfig({availableFrontendModelClassNames, className, modelConfig})

        if (generatedModelNames.has(className)) {
          throw new Error(`Duplicate frontend model definition for '${className}'`)
        }

        generatedModelNames.add(className)

        const fileContent = this.buildModelFileContent({
          className,
          importPath,
          modelConfig
        })

        await fs.writeFile(filePath, fileContent)

        console.log(`create src/frontend-models/${fileName}`)
      }
    }
  }

  /**
   * @param {object} args - Arguments.
   * @param {Set<string>} args.availableFrontendModelClassNames - Available frontend model class names in backend project.
   * @param {string} args.className - Model class name.
   * @param {Record<string, any>} args.modelConfig - Model configuration.
   * @returns {void} - No return value.
   */
  validateModelConfig({availableFrontendModelClassNames, className, modelConfig}) {
    const abilities = modelConfig.abilities

    if (!abilities || typeof abilities !== "object") {
      throw new Error(`Model '${className}' is missing required 'abilities' config`)
    }

    const readActions = ["index", "find"]

    for (const action of readActions) {
      const abilityAction = abilities[action]

      if (typeof abilityAction !== "string" || abilityAction.length < 1) {
        throw new Error(`Model '${className}' is missing required abilities.${action} config`)
      }
    }

    const relationships = modelConfig.relationships

    if (relationships === undefined) return

    const normalizedRelationships = this.relationshipsForModel({className, modelConfig})

    for (const relationship of normalizedRelationships) {
      if (!availableFrontendModelClassNames.has(relationship.targetClassName)) {
        throw new Error(`Model '${className}' relationship '${relationship.relationshipName}' references '${relationship.targetClassName}', but no frontend model resource exists for that target in this backend project`)
      }
    }
  }

  /**
   * @param {{frontendModels?: Record<string, any>, resources?: Record<string, any>}} backendProject - Backend project config.
   * @returns {Record<string, any>} - Resource definitions keyed by model class name.
   */
  resourcesForBackendProject(backendProject) {
    const resources = backendProject.frontendModels || backendProject.resources || {}

    if (!resources || typeof resources !== "object") {
      throw new Error(`Expected backend project resources object but got: ${resources}`)
    }

    return resources
  }

  /**
   * @param {Record<string, any>} resources - Resource configuration keyed by model name.
   * @returns {Set<string>} - Available frontend model class names.
   */
  availableFrontendModelClassNames(resources) {
    /** @type {Set<string>} */
    const classNames = new Set()

    for (const resourceModelName in resources) {
      classNames.add(inflection.camelize(resourceModelName.replaceAll("-", "_")))
    }

    return classNames
  }

  /**
   * @param {{frontendModelsOutputPath?: string}} backendProject - Backend project config.
   * @returns {string} - Absolute frontend models output directory.
   */
  frontendModelsDirectoryForBackendProject(backendProject) {
    const outputPath = backendProject.frontendModelsOutputPath || this.directory()

    return `${outputPath}/src/frontend-models`
  }

  /**
   * @param {string} frontendModelsDir - Frontend models output directory.
   * @returns {string} - Base class import path.
   */
  importPathForFrontendModelsDirectory(frontendModelsDir) {
    const devMode = frontendModelsDir.includes("/spec/dummy/src/frontend-models")

    if (devMode) {
      return "../../../../src/frontend-models/base.js"
    }

    return "velocious/build/src/frontend-models/base.js"
  }

  /**
   * @param {object} args - Method args.
   * @param {string} args.className - Model class name.
   * @param {string} args.importPath - Base class import path.
   * @param {Record<string, any>} args.modelConfig - Model configuration.
   * @returns {string} - Generated file content.
   */
  buildModelFileContent({className, importPath, modelConfig}) {
    const attributes = this.attributeDefinitionsForModel({className, modelConfig})
    const relationships = this.relationshipsForModel({className, modelConfig})
    const attributesTypeName = `${className}Attributes`
    const commands = {
      destroy: modelConfig.commands?.destroy || "destroy",
      find: modelConfig.commands?.find || "find",
      index: modelConfig.commands?.index || "index",
      update: modelConfig.commands?.update || "update"
    }

    let fileContent = ""

    fileContent += `import FrontendModelBase from "${importPath}"\n`

    if (relationships.length > 0) {
      /** @type {Set<string>} */
      const importedTargetClasses = new Set()

      for (const relationship of relationships) {
        if (relationship.targetClassName == className) continue
        if (importedTargetClasses.has(relationship.targetClassName)) continue

        fileContent += `import ${relationship.targetClassName} from "./${relationship.targetFileName}.js"\n`
        importedTargetClasses.add(relationship.targetClassName)
      }
    }

    fileContent += "\n"
    fileContent += "/**\n"
    fileContent += ` * @typedef {object} ${attributesTypeName}\n`
    for (const attribute of attributes) {
      fileContent += ` * @property {${attribute.jsDocType}} ${attribute.name} - Attribute value.\n`
    }
    fileContent += " */\n"
    fileContent += `/** Frontend model for ${className}. */\n`
    fileContent += `export default class ${className} extends FrontendModelBase {\n`
    fileContent += "  /**\n"
    fileContent += "   * @returns {{attributes: string[], commands: {destroy: string, find: string, index: string, update: string}, primaryKey: string}} - Resource config.\n"
    fileContent += "   */\n"
    fileContent += "  static resourceConfig() {\n"
    fileContent += "    return {\n"
    fileContent += `      attributes: ${JSON.stringify(attributes.map((attribute) => attribute.name))},\n`
    fileContent += `      commands: ${JSON.stringify(commands)},\n`
    fileContent += `      primaryKey: ${JSON.stringify(modelConfig.primaryKey || "id")}\n`
    fileContent += "    }\n"
    fileContent += "  }\n"

    if (relationships.length > 0) {
      fileContent += "\n"
      fileContent += "  /**\n"
      fileContent += "   * @returns {Record<string, {type: \"belongsTo\" | \"hasOne\" | \"hasMany\"}>} - Relationship definitions.\n"
      fileContent += "   */\n"
      fileContent += "  static relationshipDefinitions() {\n"
      fileContent += "    return {\n"
      for (const relationship of relationships) {
        fileContent += `      ${relationship.relationshipName}: {type: ${JSON.stringify(relationship.type)}},\n`
      }
      fileContent += "    }\n"
      fileContent += "  }\n"

      fileContent += "\n"
      fileContent += "  /**\n"
      fileContent += "   * @returns {Record<string, typeof FrontendModelBase>} - Relationship model classes.\n"
      fileContent += "   */\n"
      fileContent += "  static relationshipModelClasses() {\n"
      fileContent += "    return {\n"
      for (const relationship of relationships) {
        const targetClassReference = relationship.targetClassName == className ? className : relationship.targetClassName
        fileContent += `      ${relationship.relationshipName}: ${targetClassReference},\n`
      }
      fileContent += "    }\n"
      fileContent += "  }\n"
    }

    for (const attribute of attributes) {
      const camelizedAttribute = inflection.camelize(attribute.name, true)
      const camelizedAttributeUpper = inflection.camelize(attribute.name)

      fileContent += "\n"
      fileContent += "  /**\n"
      fileContent += `   * @returns {${attributesTypeName}[${JSON.stringify(attribute.name)}]} - Attribute value.\n`
      fileContent += "   */\n"
      fileContent += `  ${camelizedAttribute}() { return this.readAttribute(${JSON.stringify(attribute.name)}) }\n`

      fileContent += "\n"
      fileContent += "  /**\n"
      fileContent += `   * @param {${attributesTypeName}[${JSON.stringify(attribute.name)}]} newValue - New attribute value.\n`
      fileContent += `   * @returns {${attributesTypeName}[${JSON.stringify(attribute.name)}]} - Assigned value.\n`
      fileContent += "   */\n"
      fileContent += `  set${camelizedAttributeUpper}(newValue) { return this.setAttribute(${JSON.stringify(attribute.name)}, newValue) }\n`
    }

    for (const relationship of relationships) {
      const relationshipNameCamelized = inflection.camelize(relationship.relationshipName)
      const targetImportPath = `./${relationship.targetFileName}.js`

      if (relationship.type == "hasMany") {
        fileContent += "\n"
        fileContent += "  /**\n"
        fileContent += `   * @returns {import(${JSON.stringify(importPath)}).FrontendModelHasManyRelationship<typeof import(${JSON.stringify(`./${inflection.dasherize(inflection.underscore(className))}.js`)}).default, typeof import(${JSON.stringify(targetImportPath)}).default>} - Relationship helper.\n`
        fileContent += "   */\n"
        fileContent += `  ${relationship.relationshipName}() { return /** @type {import(${JSON.stringify(importPath)}).FrontendModelHasManyRelationship<typeof import(${JSON.stringify(`./${inflection.dasherize(inflection.underscore(className))}.js`)}).default, typeof import(${JSON.stringify(targetImportPath)}).default>} */ (this.getRelationshipByName(${JSON.stringify(relationship.relationshipName)})) }\n`

        fileContent += "\n"
        fileContent += "  /**\n"
        fileContent += `   * @returns {Array<import(${JSON.stringify(targetImportPath)}).default>} - Loaded related models.\n`
        fileContent += "   */\n"
        fileContent += `  ${relationship.relationshipName}Loaded() { return /** @type {Array<import(${JSON.stringify(targetImportPath)}).default>} */ (this.getRelationshipByName(${JSON.stringify(relationship.relationshipName)}).loaded()) }\n`
      } else {
        fileContent += "\n"
        fileContent += "  /**\n"
        fileContent += `   * @returns {import(${JSON.stringify(targetImportPath)}).default | null} - Loaded related model.\n`
        fileContent += "   */\n"
        fileContent += `  ${relationship.relationshipName}() { return /** @type {import(${JSON.stringify(targetImportPath)}).default | null} */ (this.getRelationshipByName(${JSON.stringify(relationship.relationshipName)}).loaded()) }\n`

        fileContent += "\n"
        fileContent += "  /**\n"
        fileContent += `   * @param {Record<string, any>} [attributes] - Attributes for the new related model.\n`
        fileContent += `   * @returns {import(${JSON.stringify(targetImportPath)}).default} - Built related model.\n`
        fileContent += "   */\n"
        fileContent += `  build${relationshipNameCamelized}(attributes = {}) { return /** @type {import(${JSON.stringify(targetImportPath)}).default} */ (this.getRelationshipByName(${JSON.stringify(relationship.relationshipName)}).build(attributes)) }\n`
      }
    }

    fileContent += "}\n"

    return fileContent
  }

  /**
   * @param {object} args - Arguments.
   * @param {string} args.className - Model class name.
   * @param {Record<string, any>} args.modelConfig - Model configuration.
   * @returns {Array<{jsDocType: string, name: string}>} - Attribute definitions.
   */
  attributeDefinitionsForModel({className, modelConfig}) {
    const attributes = modelConfig.attributes

    if (Array.isArray(attributes)) {
      return attributes.map((attributeName) => ({
        jsDocType: this.jsDocTypeForFrontendAttribute({
          attributeConfig: this.inferredFrontendAttributeConfiguration({
            attributeName,
            className
          })
        }),
        name: attributeName
      }))
    }

    if (!attributes || typeof attributes !== "object") {
      throw new Error(`Expected 'attributes' as array or object but got: ${attributes}`)
    }

    return Object.keys(attributes).map((attributeName) => {
      const attributeConfig = attributes[attributeName]

      return {
        jsDocType: this.jsDocTypeForFrontendAttribute({attributeConfig}),
        name: attributeName
      }
    })
  }

  /**
   * @param {object} args - Arguments.
   * @param {string} args.className - Model class name.
   * @param {string} args.attributeName - Attribute name.
   * @returns {{type: string, null?: boolean} | null} Inferred frontend attribute configuration from backend model columns.
   */
  inferredFrontendAttributeConfiguration({className, attributeName}) {
    const modelClass = this.getConfiguration().getModelClass(className)

    if (!modelClass) return null

    let attributeNameToColumnName
    let columnsHash

    try {
      attributeNameToColumnName = modelClass.getAttributeNameToColumnNameMap()
      columnsHash = modelClass.getColumnsHash()
    } catch {
      return null
    }

    const columnName = attributeNameToColumnName[attributeName]

    if (typeof columnName !== "string") return null

    const column = columnsHash[columnName]

    if (!column) return null

    const type = column.getType()
    const canBeNull = column.getNull()

    if (typeof type !== "string" || type.length < 1) return null

    return {
      null: canBeNull === true || undefined,
      type
    }
  }

  /**
   * @param {object} args - Arguments.
   * @param {any} args.attributeConfig - Attribute configuration value.
   * @returns {string} - JSDoc type.
   */
  jsDocTypeForFrontendAttribute({attributeConfig}) {
    const jsDocType = this.jsDocTypeForFrontendAttributeBaseType(attributeConfig)

    if (!this.frontendAttributeCanBeNull(attributeConfig)) {
      return jsDocType
    }

    return `${jsDocType} | null`
  }

  /**
   * @param {any} attributeConfig - Attribute configuration value.
   * @returns {string} - Non-nullable JSDoc type.
   */
  jsDocTypeForFrontendAttributeBaseType(attributeConfig) {
    if (!attributeConfig || typeof attributeConfig !== "object") {
      return "any"
    }

    const type = this.frontendAttributeTypeValue(attributeConfig)

    if (type == "boolean") {
      return "boolean"
    } else if (type == "json") {
      return "Record<string, any>"
    } else if (["blob", "char", "nvarchar", "varchar", "text", "longtext", "uuid", "character varying"].includes(type)) {
      return "string"
    } else if (["bit", "bigint", "float", "int", "integer", "smallint", "tinyint"].includes(type)) {
      return "number"
    } else if (["date", "datetime", "timestamp without time zone"].includes(type)) {
      return "Date"
    } else {
      return "any"
    }
  }

  /**
   * @param {any} attributeConfig - Attribute configuration value.
   * @returns {boolean} - Whether the attribute allows null values.
   */
  frontendAttributeCanBeNull(attributeConfig) {
    if (!attributeConfig || typeof attributeConfig !== "object") {
      return false
    }

    return attributeConfig.null === true
  }

  /**
   * @param {any} attributeConfig - Attribute configuration value.
   * @returns {string | null} - Normalized column type.
   */
  frontendAttributeTypeValue(attributeConfig) {
    if (!attributeConfig || typeof attributeConfig !== "object") {
      return null
    }

    if (typeof attributeConfig.getType == "function") {
      return String(attributeConfig.getType())
    }

    const typeValue = attributeConfig.type || attributeConfig.columnType || attributeConfig.sqlType || attributeConfig.dataType

    if (typeof typeValue !== "string") {
      return null
    }

    return typeValue
  }

  /**
   * @param {object} args - Arguments.
   * @param {string} args.className - Model class name.
   * @param {Record<string, any>} args.modelConfig - Model configuration.
   * @returns {Array<{relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}>} - Relationships.
   */
  relationshipsForModel({className, modelConfig}) {
    const relationships = modelConfig.relationships

    if (relationships === undefined || relationships === null) {
      return []
    }

    if (Array.isArray(relationships)) {
      return relationships.map((relationshipName) => this.inferredRelationshipDefinition({className, relationshipName}))
    }

    if (typeof relationships !== "object") {
      throw new Error(`Model '${className}' has invalid relationships config`)
    }

    /** @type {Array<{relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}>} */
    const normalized = []

    for (const relationshipName in relationships) {
      const relationship = relationships[relationshipName]

      if (relationship === true) {
        normalized.push(this.inferredRelationshipDefinition({className, relationshipName}))
        continue
      }

      if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) {
        throw new Error(`Model '${className}' relationship '${relationshipName}' must be an object or true`)
      }

      const inferredRelationship = this.inferredRelationshipDefinition({className, relationshipName})
      const relationshipType = relationship.type || inferredRelationship.type

      if (relationshipType !== "belongsTo" && relationshipType !== "hasOne" && relationshipType !== "hasMany") {
        throw new Error(`Model '${className}' relationship '${relationshipName}' has invalid type '${relationshipType}'`)
      }

      const relationshipModelName = relationship.modelClassName || relationship.className || relationship.model
      const targetClassName = typeof relationshipModelName === "string" && relationshipModelName.length > 0
        ? inflection.camelize(String(relationshipModelName).replaceAll("-", "_"))
        : inferredRelationship.targetClassName

      normalized.push({
        relationshipName,
        targetClassName,
        targetFileName: inflection.dasherize(inflection.underscore(targetClassName)),
        type: relationshipType
      })
    }

    return normalized
  }

  /**
   * @param {object} args - Arguments.
   * @param {string} args.className - Model class name.
   * @param {string} args.relationshipName - Relationship name.
   * @returns {{relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}} Inferred relationship definition.
   */
  inferredRelationshipDefinition({className, relationshipName}) {
    const modelClass = this.getConfiguration().getModelClass(className)

    if (!modelClass) {
      throw new Error(`Could not find backend model class '${className}' for relationship '${relationshipName}'`)
    }

    const relationship = modelClass.getRelationshipByName(relationshipName)
    const targetModelClass = relationship.getTargetModelClass()
    const relationshipType = relationship.getType()

    if (relationshipType !== "belongsTo" && relationshipType !== "hasOne" && relationshipType !== "hasMany") {
      throw new Error(`Model '${className}' relationship '${relationshipName}' has unsupported type '${relationshipType}'`)
    }

    if (!targetModelClass) {
      throw new Error(`Model '${className}' relationship '${relationshipName}' has no target model class`)
    }

    const targetClassName = targetModelClass.name

    return {
      relationshipName,
      targetClassName,
      targetFileName: inflection.dasherize(inflection.underscore(targetClassName)),
      type: relationshipType
    }
  }
}
