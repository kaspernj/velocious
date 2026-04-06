import BaseCommand from "../../../../../cli/base-command.js"
import fs from "fs/promises"
import * as inflection from "inflection"
import {frontendModelResourceClassFromDefinition, frontendModelResourceConfigurationFromDefinition, frontendModelResourcesForBackendProject} from "../../../../../frontend-models/resource-definition.js"

/** Node CLI command that generates frontend model classes from backend project resource config. */
export default class DbGenerateFrontendModels extends BaseCommand {
  /** @returns {Promise<void>} - Resolves when files are generated. */
  async execute() {
    const configuration = this.getConfiguration()
    const backendProjects = configuration.getBackendProjects()

    await configuration.initializeModels()

    const environmentHandler = configuration.getEnvironmentHandler()

    if (typeof environmentHandler.autoDiscoverResources === "function") {
      await environmentHandler.autoDiscoverResources(configuration)
    }

    if (!Array.isArray(backendProjects) || backendProjects.length === 0) {
      throw new Error("No backend projects configured. Configure 'backendProjects' in your configuration first")
    }

    /** @type {Set<string>} */
    const generatedModelNames = new Set()
    /** @type {Set<string>} */
    const ensuredDirectories = new Set()
    /** @type {Map<string, Array<{className: string, fileName: string}>>} */
    const generatedFilesByDirectory = new Map()

    for (const backendProject of backendProjects) {
      const frontendModelsDir = this.frontendModelsDirectoryForBackendProject(backendProject)
      const importPath = this.importPathForFrontendModelsDirectory(frontendModelsDir)

      if (!ensuredDirectories.has(frontendModelsDir)) {
        await fs.mkdir(frontendModelsDir, {recursive: true})
        ensuredDirectories.add(frontendModelsDir)
      }

      if (!generatedFilesByDirectory.has(frontendModelsDir)) {
        generatedFilesByDirectory.set(frontendModelsDir, [])
      }

      const generatedFiles = generatedFilesByDirectory.get(frontendModelsDir)

      if (!generatedFiles) throw new Error(`Generated files list missing for ${frontendModelsDir}`)
      const resources = this.resourcesForBackendProject(backendProject)
      const availableFrontendModelClassNames = this.availableFrontendModelClassNames(resources)

      for (const modelClassName in resources) {
        const modelConfig = frontendModelResourceConfigurationFromDefinition(resources[modelClassName])
        const className = inflection.camelize(modelClassName.replaceAll("-", "_"))
        const fileName = `${inflection.dasherize(inflection.underscore(className))}.js`
        const filePath = `${frontendModelsDir}/${fileName}`

        if (!modelConfig) {
          throw new Error(`Invalid frontend model resource definition for '${className}'`)
        }

        this.validateModelConfig({availableFrontendModelClassNames, className, modelConfig, resourceClass: frontendModelResourceClassFromDefinition(resources[modelClassName])})

        if (generatedModelNames.has(className)) {
          throw new Error(`Duplicate frontend model definition for '${className}'`)
        }

        generatedModelNames.add(className)

        const fileContent = this.buildModelFileContent({
          className,
          importPath,
          modelClass: configuration.getModelClasses()[className],
          modelConfig,
          resourceClass: frontendModelResourceClassFromDefinition(resources[modelClassName])
        })

        await fs.writeFile(filePath, fileContent)
        generatedFiles.push({className, fileName})

        console.log(`create src/frontend-models/${fileName}`)
      }
    }

    for (const [frontendModelsDir, generatedFiles] of generatedFilesByDirectory) {
      const indexContent = this.buildIndexFileContent(generatedFiles)

      await fs.writeFile(`${frontendModelsDir}/index.js`, indexContent)

      console.log("create src/frontend-models/index.js")

      const setupContent = this.buildSetupFileContent(generatedFiles)

      await fs.writeFile(`${frontendModelsDir}/setup.js`, setupContent)

      console.log("create src/frontend-models/setup.js")
    }
  }

  /**
   * @param {object} args - Arguments.
   * @param {Set<string>} args.availableFrontendModelClassNames - Available frontend model class names in backend project.
   * @param {string} args.className - Model class name.
   * @param {Record<string, any>} args.modelConfig - Model configuration.
   * @param {typeof import("../../../../../frontend-model-resource/base-resource.js").default | null} [args.resourceClass]
   * @returns {void} - No return value.
   */
  validateModelConfig({availableFrontendModelClassNames, className, modelConfig, resourceClass}) {
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

    const normalizedRelationships = this.relationshipsForModel({className, modelConfig, resourceClass})

    for (const relationship of normalizedRelationships) {
      if (!availableFrontendModelClassNames.has(relationship.targetClassName)) {
        throw new Error(`Model '${className}' relationship '${relationship.relationshipName}' references '${relationship.targetClassName}', but no frontend model resource exists for that target in this backend project`)
      }
    }
  }

  /**
   * @param {import("../../../../../configuration-types.js").BackendProjectConfiguration} backendProject - Backend project config.
   * @returns {Record<string, import("../../../../../configuration-types.js").FrontendModelResourceDefinition>} - Resource definitions keyed by model class name.
   */
  resourcesForBackendProject(backendProject) {
    return frontendModelResourcesForBackendProject(backendProject)
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
   * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
   * @param {Record<string, any>} args.modelConfig - Model configuration.
   * @param {typeof import("../../../../../frontend-model-resource/base-resource.js").default | null} [args.resourceClass]
   * @returns {string} - Generated file content.
   */
  buildModelFileContent({className, importPath, modelClass, modelConfig, resourceClass}) {
    const attributes = this.attributeDefinitionsForModel({modelClass, modelConfig})
    const relationships = this.relationshipsForModel({className, modelConfig, resourceClass})
    const attachments = modelConfig.attachments && typeof modelConfig.attachments === "object"
      ? modelConfig.attachments
      : {}
    const attributesTypeName = `${className}Attributes`
    const attributeNames = attributes.map((attribute) => attribute.name)
    const builtInCollectionCommands = {
      create: modelConfig.builtInCollectionCommands.create || "create",
      index: modelConfig.builtInCollectionCommands.index || "index"
    }
    const builtInMemberCommands = {
      attach: modelConfig.builtInMemberCommands.attach || "attach",
      destroy: modelConfig.builtInMemberCommands.destroy || "destroy",
      download: modelConfig.builtInMemberCommands.download || "download",
      find: modelConfig.builtInMemberCommands.find || "find",
      update: modelConfig.builtInMemberCommands.update || "update",
      url: modelConfig.builtInMemberCommands.url || "url"
    }
    const collectionCommands = modelConfig.collectionCommands
    const memberCommands = modelConfig.memberCommands
    const builtInCollectionCommandsAreDefault = builtInCollectionCommands.create === "create" && builtInCollectionCommands.index === "index"
    const builtInMemberCommandsAreDefault = builtInMemberCommands.attach === "attach"
      && builtInMemberCommands.destroy === "destroy"
      && builtInMemberCommands.download === "download"
      && builtInMemberCommands.find === "find"
      && builtInMemberCommands.update === "update"
      && builtInMemberCommands.url === "url"

    let fileContent = ""

    fileContent += `import FrontendModelBase from "${importPath}"\n`

    fileContent += "\n"
    fileContent += "/**\n"
    fileContent += ` * @typedef {object} ${attributesTypeName}\n`
    for (const attribute of attributes) {
      fileContent += ` * @property {${attribute.jsDocType}} ${attribute.name} - Attribute value.\n`
    }
    fileContent += " */\n"
    fileContent += `/** Frontend model for ${className}. */\n`
    fileContent += `export default class ${className} extends FrontendModelBase {\n`
    fileContent += "  /** @returns {{attachments?: Record<string, {type: \"hasOne\" | \"hasMany\"}>, attributes: string[], builtInCollectionCommands?: Record<string, string>, builtInMemberCommands?: Record<string, string>, collectionCommands?: Record<string, string>, memberCommands?: Record<string, string>, primaryKey?: string}} - Resource config. */\n"
    fileContent += "  static resourceConfig() {\n"
    fileContent += "    return {\n"
    fileContent += `      modelName: ${JSON.stringify(className)},\n`
    if (modelConfig.path) {
      fileContent += `      path: ${JSON.stringify(modelConfig.path)},\n`
    }
    if (Object.keys(attachments).length > 0) {
      fileContent += "      attachments: {\n"
      for (const [attachmentName, attachmentConfig] of Object.entries(attachments)) {
        const attachmentType = attachmentConfig && typeof attachmentConfig === "object" && attachmentConfig.type === "hasMany"
          ? "hasMany"
          : "hasOne"

        fileContent += `        ${attachmentName}: {type: ${JSON.stringify(attachmentType)}},\n`
      }
      fileContent += "      },\n"
    }
    fileContent += this.formattedArrayProperty({
      indent: "      ",
      propertyName: "attributes",
      values: attributeNames
    })
    if (!builtInCollectionCommandsAreDefault) {
      fileContent += this.formattedObjectProperty({
        filterDefaultValues: {create: "create", index: "index"},
        indent: "      ",
        propertyName: "builtInCollectionCommands",
        values: builtInCollectionCommands
      })
    }
    if (!builtInMemberCommandsAreDefault) {
      fileContent += this.formattedObjectProperty({
        filterDefaultValues: {
          attach: "attach",
          destroy: "destroy",
          download: "download",
          find: "find",
          update: "update",
          url: "url"
        },
        indent: "      ",
        propertyName: "builtInMemberCommands",
        values: builtInMemberCommands
      })
    }
    if (Object.keys(collectionCommands).length > 0) {
      fileContent += this.formattedCommandsProperty({
        indent: "      ",
        propertyName: "collectionCommands",
        values: collectionCommands
      })
    }
    if (Object.keys(memberCommands).length > 0) {
      fileContent += this.formattedCommandsProperty({
        indent: "      ",
        propertyName: "memberCommands",
        values: memberCommands
      })
    }
    if (modelClass && modelClass.primaryKey() !== "id") {
      fileContent += `      primaryKey: ${JSON.stringify(modelClass.primaryKey())},\n`
    }
    fileContent += "    }\n"
    fileContent += "  }\n"

    if (relationships.length > 0) {
      fileContent += "\n"
      fileContent += "  /** @returns {Record<string, {type: \"belongsTo\" | \"hasOne\" | \"hasMany\"}>} - Relationship definitions. */\n"
      fileContent += "  static relationshipDefinitions() {\n"
      fileContent += "    return {\n"
      for (const relationship of relationships) {
        fileContent += `      ${relationship.relationshipName}: {type: ${JSON.stringify(relationship.type)}},\n`
      }
      fileContent += "    }\n"
      fileContent += "  }\n"

      fileContent += "\n"
      fileContent += "  /** @returns {Record<string, string>} - Relationship model class names. */\n"
      fileContent += "  static relationshipModelClasses() {\n"
      fileContent += "    return {\n"
      for (const relationship of relationships) {
        fileContent += `      ${relationship.relationshipName}: ${JSON.stringify(relationship.targetClassName)},\n`
      }
      fileContent += "    }\n"
      fileContent += "  }\n"
    }

    for (const attribute of attributes) {
      const camelizedAttribute = inflection.camelize(attribute.name, true)
      const camelizedAttributeUpper = inflection.camelize(attribute.name)

      fileContent += "\n"
      fileContent += `  /** @returns {${attributesTypeName}[${JSON.stringify(attribute.name)}]} - Attribute value. */\n`
      fileContent += `  ${camelizedAttribute}() { return this.readAttribute(${JSON.stringify(attribute.name)}) }\n`

      fileContent += "\n"
      fileContent += "  /**\n"
      fileContent += `   * @param {${attributesTypeName}[${JSON.stringify(attribute.name)}]} newValue - New attribute value.\n`
      fileContent += `   * @returns {${attributesTypeName}[${JSON.stringify(attribute.name)}]} - Assigned value.\n`
      fileContent += "   */\n"
      fileContent += `  set${camelizedAttributeUpper}(newValue) { return this.setAttribute(${JSON.stringify(attribute.name)}, newValue) }\n`
    }

    for (const methodName of Object.keys(collectionCommands)) {
      fileContent += "\n"
      fileContent += "  /**\n"
      fileContent += "   * @param {...any} commandArguments - Custom command arguments.\n"
      fileContent += "   * @returns {Promise<Record<string, any>>} - Command response.\n"
      fileContent += "   */\n"
      fileContent += `  static async ${methodName}(...commandArguments) {\n`
      fileContent += "    return await this.executeCustomCommand({\n"
      fileContent += `      commandName: ${JSON.stringify(collectionCommands[methodName])},\n`
      fileContent += `      commandType: ${JSON.stringify(collectionCommands[methodName])},\n`
      fileContent += `      payload: ${className}.normalizeCustomCommandPayloadArguments(commandArguments),\n`
      fileContent += "      resourcePath: this.resourcePath()\n"
      fileContent += "    })\n"
      fileContent += "  }\n"
    }

    for (const methodName of Object.keys(memberCommands)) {
      fileContent += "\n"
      fileContent += "  /**\n"
      fileContent += "   * @param {...any} commandArguments - Custom command arguments.\n"
      fileContent += "   * @returns {Promise<Record<string, any>>} - Command response.\n"
      fileContent += "   */\n"
      fileContent += `  async ${methodName}(...commandArguments) {\n`
      fileContent += `    return await ${className}.executeCustomCommand({\n`
      fileContent += `      commandName: ${JSON.stringify(memberCommands[methodName])},\n`
      fileContent += `      commandType: ${JSON.stringify(memberCommands[methodName])},\n`
      fileContent += "      memberId: this.primaryKeyValue(),\n"
      fileContent += `      payload: ${className}.normalizeCustomCommandPayloadArguments(commandArguments),\n`
      fileContent += `      resourcePath: ${className}.resourcePath()\n`
      fileContent += "    })\n"
      fileContent += "  }\n"
    }

    for (const relationship of relationships) {
      const relationshipNameCamelized = inflection.camelize(relationship.relationshipName)
      const targetImportPath = `./${relationship.targetFileName}.js`

      if (relationship.type == "hasMany") {
        fileContent += "\n"
        fileContent += `  /** @returns {import(${JSON.stringify(importPath)}).FrontendModelHasManyRelationship<typeof import(${JSON.stringify(`./${inflection.dasherize(inflection.underscore(className))}.js`)}).default, typeof import(${JSON.stringify(targetImportPath)}).default>} - Relationship helper. */\n`
        fileContent += `  ${relationship.relationshipName}() { return /** @type {import(${JSON.stringify(importPath)}).FrontendModelHasManyRelationship<typeof import(${JSON.stringify(`./${inflection.dasherize(inflection.underscore(className))}.js`)}).default, typeof import(${JSON.stringify(targetImportPath)}).default>} */ (this.getRelationshipByName(${JSON.stringify(relationship.relationshipName)})) }\n`

        fileContent += "\n"
        fileContent += `  /** @returns {Array<import(${JSON.stringify(targetImportPath)}).default>} - Loaded related models. */\n`
        fileContent += `  ${relationship.relationshipName}Loaded() { return /** @type {Array<import(${JSON.stringify(targetImportPath)}).default>} */ (this.getRelationshipByName(${JSON.stringify(relationship.relationshipName)}).loaded()) }\n`

        fileContent += "\n"
        fileContent += `  /** @returns {Promise<Array<import(${JSON.stringify(targetImportPath)}).default>>} - Loaded related models. */\n`
        fileContent += `  async load${relationshipNameCamelized}() { return /** @type {Promise<Array<import(${JSON.stringify(targetImportPath)}).default>>} */ (this.loadRelationship(${JSON.stringify(relationship.relationshipName)})) }\n`
      } else {
        fileContent += "\n"
        fileContent += `  /** @returns {import(${JSON.stringify(targetImportPath)}).default | null} - Loaded related model. */\n`
        fileContent += `  ${relationship.relationshipName}() { return /** @type {import(${JSON.stringify(targetImportPath)}).default | null} */ (this.getRelationshipByName(${JSON.stringify(relationship.relationshipName)}).loaded()) }\n`

        fileContent += "\n"
        fileContent += "  /**\n"
        fileContent += `   * @param {Record<string, any>} [attributes] - Attributes for the new related model.\n`
        fileContent += `   * @returns {import(${JSON.stringify(targetImportPath)}).default} - Built related model.\n`
        fileContent += "   */\n"
        fileContent += `  build${relationshipNameCamelized}(attributes = {}) { return /** @type {import(${JSON.stringify(targetImportPath)}).default} */ (this.getRelationshipByName(${JSON.stringify(relationship.relationshipName)}).build(attributes)) }\n`

        fileContent += "\n"
        fileContent += `  /** @returns {Promise<import(${JSON.stringify(targetImportPath)}).default | null>} - Loaded related model. */\n`
        fileContent += `  async load${relationshipNameCamelized}() { return /** @type {Promise<import(${JSON.stringify(targetImportPath)}).default | null>} */ (this.loadRelationship(${JSON.stringify(relationship.relationshipName)})) }\n`

        fileContent += "\n"
        fileContent += `  /** @returns {Promise<import(${JSON.stringify(targetImportPath)}).default | null>} - Loaded related model. */\n`
        fileContent += `  async ${relationship.relationshipName}OrLoad() { return /** @type {Promise<import(${JSON.stringify(targetImportPath)}).default | null>} */ (this.relationshipOrLoad(${JSON.stringify(relationship.relationshipName)})) }\n`

        fileContent += "\n"
        fileContent += `  /** @param {import(${JSON.stringify(targetImportPath)}).default | null} model - Related model. @returns {import(${JSON.stringify(targetImportPath)}).default | null} - Assigned related model. */\n`
        fileContent += `  set${relationshipNameCamelized}(model) { return /** @type {import(${JSON.stringify(targetImportPath)}).default | null} */ (this.setRelationship(${JSON.stringify(relationship.relationshipName)}, model)) }\n`
      }
    }

    fileContent += "}\n"
    fileContent += "\n"
    fileContent += `FrontendModelBase.registerModel(${className})\n`

    return fileContent
  }

  /**
   * @param {Array<{className: string, fileName: string}>} generatedFiles - Generated model files.
   * @returns {string} - Index file content that imports and re-exports all models.
   */
  buildIndexFileContent(generatedFiles) {
    let content = ""

    for (const {className, fileName} of generatedFiles) {
      content += `export {default as ${className}} from "./${fileName}"\n`
    }

    return content
  }

  /**
   * @param {Array<{className: string, fileName: string}>} generatedFiles - Generated model files.
   * @returns {string} - Setup file content with side-effect imports for model registration.
   */
  buildSetupFileContent(generatedFiles) {
    let content = "// This file is auto-generated by Velocious. Do not edit manually.\n"

    content += "// Run `velocious g:frontend-models` to regenerate.\n"

    for (const {fileName} of generatedFiles) {
      content += `import "./${fileName}"\n`
    }

    return content
  }

  /**
   * @param {object} args - Formatting args.
   * @param {string} args.indent - Base indentation.
   * @param {string} args.propertyName - Object property name.
   * @param {string[]} args.values - String values.
   * @returns {string} - Formatted multiline array property.
   */
  formattedArrayProperty({indent, propertyName, values}) {
    let output = `${indent}${propertyName}: [\n`

    for (const value of values) {
      output += `${indent}  ${JSON.stringify(value)},\n`
    }

    output += `${indent}],\n`

    return output
  }

  /**
   * @param {object} args - Formatting args.
   * @param {string} args.indent - Base indentation.
   * @param {string} args.propertyName - Object property name.
   * @param {Record<string, string>} args.values - Object key-values.
   * @param {Record<string, string>} [args.filterDefaultValues] - Default values to omit from output.
   * @returns {string} - Formatted multiline object property.
   */
  /**
   * @param {object} args - Formatting args.
   * @param {string} args.indent - Base indentation.
   * @param {string} args.propertyName - Object property name.
   * @param {Record<string, string>} args.values - Command key-values.
   * @returns {string} - Formatted property (array when keys match values, object otherwise).
   */
  formattedCommandsProperty({indent, propertyName, values}) {
    const allKeysMatchValues = Object.entries(values).every(([key, value]) => key === value)

    if (allKeysMatchValues) {
      return this.formattedArrayProperty({indent, propertyName, values: Object.keys(values)})
    }

    return this.formattedObjectProperty({indent, propertyName, values})
  }

  /**
   * @param {object} args - Formatting args.
   * @param {string} args.indent - Base indentation.
   * @param {string} args.propertyName - Object property name.
   * @param {Record<string, string>} args.values - Object key-values.
   * @param {Record<string, string>} [args.filterDefaultValues] - Default values to omit from output.
   * @returns {string} - Formatted multiline object property.
   */
  formattedObjectProperty({filterDefaultValues, indent, propertyName, values}) {
    let output = `${indent}${propertyName}: {\n`

    for (const objectKey of Object.keys(values)) {
      if (filterDefaultValues && filterDefaultValues[objectKey] === values[objectKey]) continue

      output += `${indent}  ${objectKey}: ${JSON.stringify(values[objectKey])},\n`
    }

    output += `${indent}},\n`

    return output
  }

  /**
   * @param {object} args - Arguments.
   * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
   * @param {Record<string, any>} args.modelConfig - Model configuration.
   * @returns {Array<{jsDocType: string, name: string}>} - Attribute definitions.
   */
  attributeDefinitionsForModel({modelClass, modelConfig}) {
    let attributes = modelConfig.attributes

    // Auto-derive attributes from model columns when not explicitly defined
    if ((!attributes || (Array.isArray(attributes) && attributes.length === 0)) && modelClass) {
      try {
        const columns = modelClass.getColumns()

        if (Array.isArray(columns)) {
          attributes = columns.map((column) => inflection.camelize(column.getName(), true))
        }
      } catch {
        // Model may not be initialized yet
      }
    }

    if (Array.isArray(attributes)) {
      return attributes.map((attributeName) => ({
        jsDocType: this.jsDocTypeForFrontendAttribute({
          attributeConfig: this.frontendAttributeConfigForModelAttribute({attributeName, modelClass})
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
    } else if (type == "json" || type == "jsonb") {
      return "Record<string, any>"
    } else if (type && ["blob", "char", "nvarchar", "varchar", "text", "longtext", "uuid", "character varying"].includes(type)) {
      return "string"
    } else if (type && ["bit", "bigint", "decimal", "double", "double precision", "float", "int", "integer", "numeric", "real", "smallint", "tinyint"].includes(type)) {
      return "number"
    } else if (type && ["date", "datetime", "timestamp", "timestamp without time zone", "timestamptz"].includes(type)) {
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

    if (typeof attributeConfig.getNull == "function") {
      return attributeConfig.getNull() === true
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
   * @param {string} args.attributeName - Frontend model attribute name.
   * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
   * @returns {any} - Attribute config inferred from the backend model when available.
   */
  frontendAttributeConfigForModelAttribute({attributeName, modelClass}) {
    if (!modelClass) {
      return null
    }

    const columnName = modelClass.getAttributeNameToColumnNameMap()[attributeName]

    if (!columnName) {
      return null
    }

    return modelClass.getColumnsHash()[columnName] || null
  }

  /**
   * @param {object} args - Arguments.
   * @param {string} args.className - Model class name.
   * @param {Record<string, any>} args.modelConfig - Model configuration.
   * @param {typeof import("../../../../../frontend-model-resource/base-resource.js").default | null} [args.resourceClass]
   * @returns {Array<{relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}>} - Relationships.
   */
  relationshipsForModel({className, modelConfig, resourceClass}) {
    const relationships = modelConfig.relationships

    if (relationships === undefined || relationships === null) {
      return []
    }

    if (!Array.isArray(relationships)) {
      throw new Error(`Model '${className}' has invalid relationships config — must be an array of relationship names, got ${typeof relationships}`)
    }

    return relationships.map((relationshipName) => this.inferredRelationshipDefinition({className, relationshipName, resourceClass}))
  }

  /**
   * @param {object} args - Arguments.
   * @param {string} args.className - Model class name.
   * @param {string} args.relationshipName - Relationship name.
   * @param {typeof import("../../../../../frontend-model-resource/base-resource.js").default | null} [args.resourceClass]
   * @returns {{relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}} Inferred relationship definition.
   */
  inferredRelationshipDefinition({className, relationshipName, resourceClass}) {
    const modelClass = resourceClass?.ModelClass || this.getConfiguration().getModelClass(className)

    if (!modelClass) {
      throw new Error(`Could not find backend model class '${className}' for relationship '${relationshipName}'`)
    }

    const relationship = modelClass.getRelationshipByName(relationshipName)
    const relationshipType = relationship.getType()

    if (relationshipType !== "belongsTo" && relationshipType !== "hasOne" && relationshipType !== "hasMany") {
      throw new Error(`Model '${className}' relationship '${relationshipName}' has unsupported type '${relationshipType}'`)
    }

    let targetClassName

    try {
      const targetModelClass = relationship.getTargetModelClass()

      targetClassName = targetModelClass?.getModelName()
    } catch {
      // Model class not registered yet — fall back to className from relationship definition
    }

    if (!targetClassName) {
      targetClassName = relationship.className

      if (!targetClassName) {
        throw new Error(`Model '${className}' relationship '${relationshipName}' has no target model class`)
      }
    }

    return {
      relationshipName,
      targetClassName,
      targetFileName: inflection.dasherize(inflection.underscore(targetClassName)),
      type: relationshipType
    }
  }
}
