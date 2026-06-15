import BaseCommand from "../../../../../cli/base-command.js"
import fs from "fs/promises"
import path from "node:path"
import * as inflection from "inflection"
import {frontendModelResourceClassFromDefinition, frontendModelResourceConfigurationFromDefinition, frontendModelResourcesForBackendProject} from "../../../../../frontend-models/resource-definition.js"

/**
 * Attribute metadata used for generated frontend-model JSDoc.
 * @typedef {object} FrontendAttributeConfig
 * @property {string} [type] - Column type.
 * @property {string} [columnType] - Column type.
 * @property {string} [sqlType] - SQL type.
 * @property {string} [dataType] - Data type.
 * @property {string} [jsDocType] - Exact JSDoc type.
 * @property {string} [name] - Attribute name when configured as an array entry.
 * @property {boolean} [null] - Whether null is allowed.
 * @property {boolean} [selectedByDefault] - Whether the attribute is selected by default.
 * @property {() => string} [getType] - Returns column type.
 * @property {() => boolean} [getNull] - Returns whether null is allowed.
 */
/**
 * Permit spec returned by frontend-model resources during generation.
 * @typedef {Array<string | Record<string, object>>} FrontendModelGeneratorPermitSpec
 */

/** Node CLI command that generates frontend model classes from backend project resource config. */
export default class DbGenerateFrontendModels extends BaseCommand {
  /** @type {Map<string, string> | null} */
  _resourceMethodReturnTypes = null

  /**
   * Runs execute.
   * @returns {Promise<void>} - Resolves when files are generated.
   */
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

    /**
     * Ensured directories.
     * @type {Set<string>} */
    const ensuredDirectories = new Set()
    /**
     * Generated model names by directory.
     * @type {Map<string, Set<string>>} */
    const generatedModelNamesByDirectory = new Map()
    /**
     * Generated files by directory.
     * @type {Map<string, Array<{className: string, fileName: string}>>} */
    const generatedFilesByDirectory = new Map()

    for (const backendProject of backendProjects) {
      // Canonicalize the output directory so equivalent spellings (a trailing
      // slash, `.`/`..` segments, duplicate separators, relative vs absolute)
      // resolve to a single key. Otherwise the per-directory maps below treat
      // them as different directories, duplicate class names slip past detection,
      // and the split buckets write incomplete index.js/setup.js for files that
      // actually land in the same directory on disk.
      const frontendModelsDir = path.resolve(this.frontendModelsDirectoryForBackendProject(backendProject))
      const importPath = this.importPathForFrontendModelsDirectory(frontendModelsDir)

      if (!ensuredDirectories.has(frontendModelsDir)) {
        await fs.mkdir(frontendModelsDir, {recursive: true})
        ensuredDirectories.add(frontendModelsDir)
      }

      if (!generatedFilesByDirectory.has(frontendModelsDir)) {
        generatedFilesByDirectory.set(frontendModelsDir, [])
      }

      if (!generatedModelNamesByDirectory.has(frontendModelsDir)) {
        generatedModelNamesByDirectory.set(frontendModelsDir, new Set())
      }

      const generatedFiles = generatedFilesByDirectory.get(frontendModelsDir)
      const generatedModelNames = generatedModelNamesByDirectory.get(frontendModelsDir)

      if (!generatedFiles) throw new Error(`Generated files list missing for ${frontendModelsDir}`)
      if (!generatedModelNames) throw new Error(`Generated model names set missing for ${frontendModelsDir}`)
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

        const resourceClass = frontendModelResourceClassFromDefinition(resources[modelClassName])

        this.validateModelConfig({availableFrontendModelClassNames, className, modelConfig, resourceClass})

        if (generatedModelNames.has(className)) {
          throw new Error(`Duplicate frontend model definition for '${className}'`)
        }

        generatedModelNames.add(className)

        const fileContent = await this.buildModelFileContent({
          className,
          importPath,
          modelClass: resourceClass?.ModelClass || configuration.getModelClasses()[className],
          modelConfig,
          resourceClass
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
   * Runs validate model config.
   * @param {object} args - Arguments.
   * @param {Set<string>} args.availableFrontendModelClassNames - Available frontend model class names in backend project.
   * @param {string} args.className - Model class name.
   * @param {import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.modelConfig - Model configuration.
   * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} [args.resourceClass] - Resource class.
   * @returns {void} - No return value.
   */
  validateModelConfig({availableFrontendModelClassNames, className, modelConfig, resourceClass}) {
    const abilities = modelConfig.abilities

    if (!abilities || typeof abilities !== "object") {
      throw new Error(`Model '${className}' is missing required 'abilities' config`)
    }

    const readActions = [
      {action: "index", abilityAction: abilities.index},
      {action: "find", abilityAction: abilities.find}
    ]

    for (const {action, abilityAction} of readActions) {
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
   * Runs resources for backend project.
   * @param {import("../../../../../configuration-types.js").BackendProjectConfiguration} backendProject - Backend project config.
   * @returns {Record<string, import("../../../../../configuration-types.js").FrontendModelResourceDefinition>} - Resource definitions keyed by model class name.
   */
  resourcesForBackendProject(backendProject) {
    return frontendModelResourcesForBackendProject(backendProject)
  }

  /**
   * Runs available frontend model class names.
   * @param {Record<string, import("../../../../../configuration-types.js").FrontendModelResourceDefinition>} resources - Resource configuration keyed by model name.
   * @returns {Set<string>} - Available frontend model class names.
   */
  availableFrontendModelClassNames(resources) {
    /**
     * Class names.
     * @type {Set<string>} */
    const classNames = new Set()

    for (const resourceModelName in resources) {
      classNames.add(inflection.camelize(resourceModelName.replaceAll("-", "_")))
    }

    return classNames
  }

  /**
   * Runs frontend models directory for backend project.
   * @param {{frontendModelsOutputPath?: string}} backendProject - Backend project config.
   * @returns {string} - Absolute frontend models output directory.
   */
  frontendModelsDirectoryForBackendProject(backendProject) {
    const outputPath = backendProject.frontendModelsOutputPath || this.directory()

    return `${outputPath}/src/frontend-models`
  }

  /**
   * Runs import path for frontend models directory.
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
   * Runs build model file content.
   * @param {object} args - Method args.
   * @param {string} args.className - Model class name.
   * @param {string} args.importPath - Base class import path.
   * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
   * @param {import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.modelConfig - Model configuration.
   * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} [args.resourceClass] - Resource class.
   * @returns {Promise<string>} - Generated file content.
   */
  async buildModelFileContent({className, importPath, modelClass, modelConfig, resourceClass}) {
    const attributes = await this.attributeDefinitionsForModel({className, modelClass, modelConfig, resourceClass})
    const relationships = this.relationshipsForModel({className, modelConfig, resourceClass})
    const attachments = modelConfig.attachments && typeof modelConfig.attachments === "object"
      ? modelConfig.attachments
      : {}
    const attributesTypeName = `${className}Attributes`
    const createAttributesTypeName = `${className}CreateAttributes`
    const updateAttributesTypeName = `${className}UpdateAttributes`
    const attributeNames = attributes.map((attribute) => attribute.name)
    const permittedCreateParams = this.permittedParamsForGenerator(resourceClass || null, "create")
    const permittedUpdateParams = this.permittedParamsForGenerator(resourceClass || null, "update")
    const nestedWriteTypes = this.nestedWriteTypesForModel({className, permittedParams: permittedCreateParams.concat(permittedUpdateParams), relationships})
    const usesTransportValue = attributes.some((attribute) => attribute.jsDocType.includes("FrontendModelTransportValue"))
      || nestedWriteTypes.some((nestedWriteType) => nestedWriteType.attributes.some((attribute) => attribute.type.includes("FrontendModelTransportValue")))
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
    fileContent += ` * Frontend model resource config.\n`
    fileContent += ` * @typedef {import("${importPath}").FrontendModelResourceConfig} FrontendModelResourceConfig\n`
    fileContent += " */\n"
    fileContent += "/**\n"
    fileContent += " * Fallback attribute value type for generated fields without narrower metadata.\n"
    fileContent += ` * @typedef {import("${importPath}").FrontendModelAttributeValue} FrontendModelAttributeValue\n`
    fileContent += " */\n"
    if (usesTransportValue) {
      fileContent += "/**\n"
      fileContent += " * Value supported by frontend-model transport serialization and deserialization.\n"
      fileContent += ` * @typedef {import("${importPath}").FrontendModelTransportValue} FrontendModelTransportValue\n`
      fileContent += " */\n"
    }
    fileContent += "\n"
    fileContent += "/**\n"
    fileContent += ` * ${attributesTypeName} type.\n`
    fileContent += ` * @typedef {object} ${attributesTypeName}\n`
    for (const attribute of attributes) {
      fileContent += ` * @property {${attribute.jsDocType}} ${attribute.name} - Attribute value.\n`
    }
    fileContent += " */\n"
    for (const nestedWriteType of nestedWriteTypes) {
      fileContent += "/**\n"
      fileContent += ` * Attributes accepted for nested ${nestedWriteType.relationshipName} writes.\n`
      fileContent += ` * @typedef {object} ${nestedWriteType.typeName}\n`
      for (const nestedAttribute of nestedWriteType.attributes) {
        fileContent += ` * @property {${nestedAttribute.type}} [${nestedAttribute.name}] - Nested ${nestedAttribute.name} value.\n`
      }
      fileContent += " */\n"
    }
    fileContent += this.writeAttributesTypedef({attributes, attributesTypeName, modelClass, nestedWriteTypes, permittedParams: permittedCreateParams, typeName: createAttributesTypeName})
    fileContent += this.writeAttributesTypedef({attributes, attributesTypeName, modelClass, nestedWriteTypes, permittedParams: permittedUpdateParams, typeName: updateAttributesTypeName})
    fileContent += "/**\n"
    fileContent += ` * Frontend model for ${className}.\n`
    fileContent += ` * @augments {FrontendModelBase<${attributesTypeName}, ${createAttributesTypeName}, ${updateAttributesTypeName}>}\n`
    fileContent += " */\n"
    fileContent += `class ${className} extends FrontendModelBase {\n`
    fileContent += "  /** @returns {FrontendModelResourceConfig} - Resource config. */\n"
    fileContent += "  static resourceConfig() {\n"
    fileContent += "    return {\n"
    fileContent += `      modelName: ${JSON.stringify(className)},\n`
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
    const nestedRelationshipNames = this.nestedRelationshipNamesForGenerator(resourceClass || null)
    if (nestedRelationshipNames.length > 0) {
      fileContent += "      nestedAttributes: {\n"
      for (const relationshipName of nestedRelationshipNames) {
        fileContent += `        ${relationshipName}: {},\n`
      }
      fileContent += "      },\n"
    }
    fileContent += "    }\n"
    fileContent += "  }\n"

    if (relationships.length > 0) {
      fileContent += "\n"
      fileContent += "  /** @returns {Record<string, {type: \"belongsTo\" | \"hasOne\" | \"hasMany\", autoload?: boolean}>} - Relationship definitions. */\n"
      fileContent += "  static relationshipDefinitions() {\n"
      fileContent += "    return {\n"
      for (const relationship of relationships) {
        const parts = [`type: ${JSON.stringify(relationship.type)}`]

        if (relationship.autoload === false) parts.push("autoload: false")

        fileContent += `      ${relationship.relationshipName}: {${parts.join(", ")}},\n`
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
      fileContent += `  ${camelizedAttribute}() { return /** @type {${attributesTypeName}[${JSON.stringify(attribute.name)}]} */ (this.readAttribute(${JSON.stringify(attribute.name)})) }\n`

      fileContent += "\n"
      fileContent += "  /**\n"
      fileContent += `   * @param {${attributesTypeName}[${JSON.stringify(attribute.name)}]} newValue - New attribute value.\n`
      fileContent += `   * @returns {${attributesTypeName}[${JSON.stringify(attribute.name)}]} - Assigned value.\n`
      fileContent += "   */\n"
      fileContent += `  set${camelizedAttributeUpper}(newValue) { return /** @type {${attributesTypeName}[${JSON.stringify(attribute.name)}]} */ (this.setAttribute(${JSON.stringify(attribute.name)}, newValue)) }\n`
    }

    for (const methodName of Object.keys(collectionCommands)) {
      fileContent += "\n"
      fileContent += "  /**\n"
      fileContent += `   * Runs ${methodName}.\n`
      fileContent += "   * @param {...FrontendModelAttributeValue} commandArguments - Custom command arguments.\n"
      fileContent += "   * @returns {Promise<Record<string, FrontendModelAttributeValue>>} - Command response.\n"
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
      fileContent += `   * Runs ${methodName}.\n`
      fileContent += "   * @param {...FrontendModelAttributeValue} commandArguments - Custom command arguments.\n"
      fileContent += "   * @returns {Promise<Record<string, FrontendModelAttributeValue>>} - Command response.\n"
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
      const targetInstanceType = `import(${JSON.stringify(targetImportPath)}).${relationship.targetClassName}`
      const targetCreateAttributesType = `import(${JSON.stringify(targetImportPath)}).${relationship.targetClassName}CreateAttributes`

      if (relationship.type == "hasMany") {
        fileContent += "\n"
        fileContent += "  /**\n"
        fileContent += `   * Returns ${relationship.relationshipName} relationship helper.\n`
        fileContent += `   * @returns {import(${JSON.stringify(importPath)}).FrontendModelHasManyRelationship<${className}, ${targetInstanceType}, ${targetCreateAttributesType}>} - Relationship helper.\n`
        fileContent += "   */\n"
        fileContent += `  ${relationship.relationshipName}Relationship() { return /** @type {import(${JSON.stringify(importPath)}).FrontendModelHasManyRelationship<${className}, ${targetInstanceType}, ${targetCreateAttributesType}>} */ (this.getRelationshipByName(${JSON.stringify(relationship.relationshipName)})) }\n`

        fileContent += "\n"
        fileContent += "  /**\n"
        fileContent += `   * Returns ${relationship.relationshipName}.\n`
        fileContent += `   * @returns {import(${JSON.stringify(importPath)}).FrontendModelHasManyRelationship<${className}, ${targetInstanceType}, ${targetCreateAttributesType}>} - Relationship helper.\n`
        fileContent += "   */\n"
        fileContent += `  ${relationship.relationshipName}() { return this.${relationship.relationshipName}Relationship() }\n`

        fileContent += "\n"
        fileContent += "  /**\n"
        fileContent += `   * Returns loaded ${relationship.relationshipName}.\n`
        fileContent += `   * @returns {Array<${targetInstanceType}>} - Loaded related models.\n`
        fileContent += "   */\n"
        fileContent += `  ${relationship.relationshipName}Loaded() { return this.${relationship.relationshipName}Relationship().loaded() }\n`

        fileContent += "\n"
        fileContent += "  /**\n"
        fileContent += `   * Loads ${relationship.relationshipName}.\n`
        fileContent += `   * @returns {Promise<Array<${targetInstanceType}>>} - Loaded related models.\n`
        fileContent += "   */\n"
        fileContent += `  async load${relationshipNameCamelized}() { return await this.${relationship.relationshipName}Relationship().load() }\n`
      } else {
        fileContent += "\n"
        fileContent += "  /**\n"
        fileContent += `   * Returns ${relationship.relationshipName} relationship helper.\n`
        fileContent += `   * @returns {import(${JSON.stringify(importPath)}).FrontendModelSingularRelationship<${className}, ${targetInstanceType}, ${targetCreateAttributesType}>} - Relationship helper.\n`
        fileContent += "   */\n"
        fileContent += `  ${relationship.relationshipName}Relationship() { return /** @type {import(${JSON.stringify(importPath)}).FrontendModelSingularRelationship<${className}, ${targetInstanceType}, ${targetCreateAttributesType}>} */ (this.getRelationshipByName(${JSON.stringify(relationship.relationshipName)})) }\n`

        fileContent += "\n"
        fileContent += "  /**\n"
        fileContent += `   * Returns ${relationship.relationshipName}.\n`
        fileContent += `   * @returns {${targetInstanceType} | null} - Loaded related model.\n`
        fileContent += "   */\n"
        fileContent += `  ${relationship.relationshipName}() { return this.${relationship.relationshipName}Relationship().loaded() }\n`

        fileContent += "\n"
        fileContent += "  /**\n"
        fileContent += `   * Builds ${relationship.relationshipName}.\n`
        fileContent += `   * @param {${targetCreateAttributesType}} [attributes] - Attributes for the new related model.\n`
        fileContent += `   * @returns {${targetInstanceType}} - Built related model.\n`
        fileContent += "   */\n"
        fileContent += `  build${relationshipNameCamelized}(attributes = {}) { return this.${relationship.relationshipName}Relationship().build(attributes) }\n`

        fileContent += "\n"
        fileContent += "  /**\n"
        fileContent += `   * Loads ${relationship.relationshipName}.\n`
        fileContent += `   * @returns {Promise<${targetInstanceType} | null>} - Loaded related model.\n`
        fileContent += "   */\n"
        fileContent += `  async load${relationshipNameCamelized}() { return await this.${relationship.relationshipName}Relationship().load() }\n`

        fileContent += "\n"
        fileContent += "  /**\n"
        fileContent += `   * Returns or loads ${relationship.relationshipName}.\n`
        fileContent += `   * @returns {Promise<${targetInstanceType} | null>} - Loaded related model.\n`
        fileContent += "   */\n"
        fileContent += `  async ${relationship.relationshipName}OrLoad() { return await this.${relationship.relationshipName}Relationship().orLoad() }\n`

        fileContent += "\n"
        fileContent += "  /**\n"
        fileContent += `   * Sets ${relationship.relationshipName}.\n`
        fileContent += `   * @param {${targetInstanceType} | null} model - Related model.\n`
        fileContent += "   * @returns {void}\n"
        fileContent += "   */\n"
        fileContent += `  set${relationshipNameCamelized}(model) { this.${relationship.relationshipName}Relationship().setLoaded(model) }\n`
      }
    }

    fileContent += "}\n"
    fileContent += "\n"
    fileContent += `FrontendModelBase.registerModel(${className})\n`
    fileContent += "\n"
    fileContent += `export {${className}}\n`
    fileContent += "\n"
    fileContent += `export default ${className}\n`

    return fileContent
  }

  /**
   * Runs build index file content.
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
   * Runs build setup file content.
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
   * Runs write attributes typedef.
   * @param {object} args - Arguments.
   * @param {Array<{jsDocType: string, name: string}>} args.attributes - Generated read attributes.
   * @param {string} args.attributesTypeName - Generated read attributes typedef name.
   * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
   * @param {Array<{attributes: Array<{name: string, type: string}>, relationshipName: string, typeName: string}>} args.nestedWriteTypes - Nested write typedefs.
   * @param {Array<string | Record<string, object>>} args.permittedParams - Resource permitted params spec.
   * @param {string} args.typeName - Typedef name.
   * @returns {string} - Generated typedef source.
   */
  writeAttributesTypedef({attributes, attributesTypeName, modelClass, nestedWriteTypes, permittedParams, typeName}) {
    const attributeLines = []

    let output = "/**\n"

    const attributesByName = new Map(attributes.map((attribute) => [attribute.name, attribute]))
    const nestedWriteTypesByKey = new Map(nestedWriteTypes.map((nestedWriteType) => [`${nestedWriteType.relationshipName}Attributes`, nestedWriteType]))
    const emittedAttributeNames = new Set()

    for (const entry of permittedParams) {
      if (typeof entry == "string") {
        const attributeName = this.frontendWriteAttributeName({attributeName: entry, attributesByName, modelClass})

        if (emittedAttributeNames.has(attributeName)) continue

        emittedAttributeNames.add(attributeName)

        const attribute = attributesByName.get(attributeName)
        const type = attribute ? `${attributesTypeName}[${JSON.stringify(attribute.name)}]` : "FrontendModelAttributeValue"

        attributeLines.push(` * @property {${type}} [${attributeName}] - Permitted ${attributeName} value.\n`)
      } else if (entry && typeof entry == "object" && !Array.isArray(entry)) {
        for (const key of Object.keys(entry)) {
          const nestedWriteType = nestedWriteTypesByKey.get(key)
          const type = nestedWriteType ? `Array<${nestedWriteType.typeName}>` : "Array<object>"

          attributeLines.push(` * @property {${type}} [${key}] - Permitted nested ${key} values.\n`)
        }
      }
    }

    output += ` * Attributes accepted by ${typeName}.\n`
    if (attributeLines.length === 0) {
      output += ` * @typedef {Record<string, never>} ${typeName}\n`
    } else {
      output += ` * @typedef {object} ${typeName}\n`
      output += attributeLines.join("")
    }
    output += " */\n"

    return output
  }

  /**
   * Resolves a permitted write attribute to the generated frontend attribute name.
   * @param {{attributeName: string, attributesByName: Map<string, {jsDocType: string, name: string}>, modelClass: typeof import("../../../../../database/record/index.js").default | undefined}} args - Arguments.
   * @returns {string} - Frontend attribute name used by generated accessors.
   */
  frontendWriteAttributeName({attributeName, attributesByName, modelClass}) {
    if (attributesByName.has(attributeName)) return attributeName

    if (modelClass) {
      const resolvedAttributeName = modelClass.resolveAttributeName(attributeName)

      if (resolvedAttributeName && attributesByName.has(resolvedAttributeName)) return resolvedAttributeName
    }

    const normalizedAttributeName = inflection.camelize(attributeName, true).toLowerCase()
    const matchingAttributeName = Array.from(attributesByName.keys()).find((candidateName) => candidateName.toLowerCase() === normalizedAttributeName)

    if (matchingAttributeName) return matchingAttributeName

    // Write-only virtual params are valid permitted params even when they have no read attribute.
    return attributeName
  }

  /**
   * Runs nested write types for model.
   * @param {object} args - Arguments.
   * @param {string} args.className - Frontend model class name.
   * @param {FrontendModelGeneratorPermitSpec} args.permittedParams - Combined permitted params specs.
   * @param {Array<{autoload: boolean, relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}>} args.relationships - Generated relationships.
   * @returns {Array<{attributes: Array<{name: string, type: string}>, relationshipName: string, typeName: string}>} - Nested write typedefs.
   */
  nestedWriteTypesForModel({className, permittedParams, relationships}) {
    const relationshipsByName = new Map(relationships.map((relationship) => [relationship.relationshipName, relationship]))
    const nestedWriteTypesByName = new Map()

    for (const entry of permittedParams) {
      if (!entry || typeof entry != "object" || Array.isArray(entry)) continue

      for (const key of Object.keys(entry)) {
        if (!key.endsWith("Attributes")) continue
        const relationshipName = key.slice(0, -"Attributes".length)
        const nestedSpec = entry[key]
        const relationship = relationshipsByName.get(relationshipName)
        let targetModelClass

        if (relationship) {
          try {
            targetModelClass = this.getConfiguration().getModelClass(relationship.targetClassName)
          } catch {
            targetModelClass = undefined
          }
        }

        if (nestedWriteTypesByName.has(relationshipName)) continue

        nestedWriteTypesByName.set(relationshipName, {
          attributes: this.nestedWriteAttributesForSpec({nestedSpec, targetModelClass}),
          relationshipName,
          typeName: `${className}${inflection.camelize(relationshipName)}NestedAttributes`
        })
      }
    }

    return Array.from(nestedWriteTypesByName.values())
  }

  /**
   * Runs nested write attributes for spec.
   * @param {object} args - Arguments.
   * @param {Array<string | Record<string, object>> | object | string | null | undefined} args.nestedSpec - Nested permit spec.
   * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.targetModelClass - Target backend model class.
   * @returns {Array<{name: string, type: string}>} - Nested write attributes.
   */
  nestedWriteAttributesForSpec({nestedSpec, targetModelClass}) {
    if (!Array.isArray(nestedSpec)) return []

    return nestedSpec.filter((entry) => typeof entry == "string").map((attributeName) => {
      const resolvedAttributeName = targetModelClass?.resolveAttributeName(attributeName) || attributeName
      const attributeConfig = this.frontendAttributeConfigForModelAttribute({attributeName: resolvedAttributeName, modelClass: targetModelClass})

      return {
        name: resolvedAttributeName,
        type: attributeConfig ? this.jsDocTypeForFrontendAttribute({attributeConfig}) : "FrontendModelAttributeValue"
      }
    })
  }

  /**
   * Runs permitted params for generator.
   * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} resourceClass - Resource class.
   * @param {"create" | "update"} action - Write action.
   * @returns {FrontendModelGeneratorPermitSpec} - Permitted params spec.
   */
  permittedParamsForGenerator(resourceClass, action) {
    if (!resourceClass || typeof resourceClass !== "function") return []

    const prototypeWithMethod = /**
                                 * Resource prototype.
                                 * @type {{permittedParams?: (arg?: object) => FrontendModelGeneratorPermitSpec}}
                                 */ (resourceClass.prototype)

    if (typeof prototypeWithMethod?.permittedParams !== "function") return []

    try {
      const instance = new resourceClass({
        ability: undefined,
        context: {},
        locals: {},
        modelClass: resourceClass.ModelClass,
        modelName: resourceClass.ModelClass?.getModelName?.() || resourceClass.name,
        params: {},
        resourceConfiguration: /**
                                * Resource configuration.
                                * @type {import("../../../../../configuration-types.js").FrontendModelResourceConfiguration}
                                */ ({attributes: []})
      })
      const spec = instance.permittedParams({action, ability: undefined, locals: {}, params: {}})

      return Array.isArray(spec) ? spec : []
    } catch (error) {
      throw new Error(`Failed to invoke ${resourceClass.name}.permittedParams() while generating frontend model write types: ${error instanceof Error ? error.message : String(error)}`, {cause: error})
    }
  }

  /**
   * Invokes a backend resource's `permittedParams()` instance method at
   * generation time and extracts the relationship names that accept
   * nested writes (`{fooAttributes: [...]}` entries). The generator
   * emits those names into the frontend model's `resourceConfig()` so
   * the client `save()` walker knows which relationships to ship.
   *
   * Constructed with no controller/ability so resource overrides must
   * support being called without a request context.
   * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} resourceClass - Resource class.
   * @returns {string[]} - Relationship names that accept nested writes (empty when none).
   */
  nestedRelationshipNamesForGenerator(resourceClass) {
    if (!resourceClass || typeof resourceClass !== "function") return []

    const prototypeWithMethod = /**
                                 * Resource prototype.
                                 * @type {{permittedParams?: (arg?: object) => FrontendModelGeneratorPermitSpec}}
                                 */ (resourceClass.prototype)

    if (typeof prototypeWithMethod?.permittedParams !== "function") return []

    let spec

    try {
      const instance = new resourceClass({
        ability: undefined,
        context: {},
        locals: {},
        modelClass: resourceClass.ModelClass,
        modelName: resourceClass.ModelClass?.getModelName?.() || resourceClass.name,
        params: {},
        resourceConfiguration: /**
                                * Resource configuration.
                                * @type {import("../../../../../configuration-types.js").FrontendModelResourceConfiguration}
                                */ ({attributes: []})
      })
      spec = instance.permittedParams()
    } catch (error) {
      throw new Error(`Failed to invoke ${resourceClass.name}.permittedParams() while generating frontend models: ${error instanceof Error ? error.message : String(error)}`, {cause: error})
    }

    if (!Array.isArray(spec)) return []

    /**
     * Relationship names.
     * @type {string[]} */
    const relationshipNames = []

    for (const entry of spec) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue

      for (const key of Object.keys(entry)) {
        if (!key.endsWith("Attributes")) continue
        const name = key.slice(0, -"Attributes".length)
        if (name) relationshipNames.push(name)
      }
    }

    return relationshipNames
  }

  /**
   * Runs formatted array property.
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
   * Runs formatted commands property.
   * @param {object} args - Formatting args.
   * @param {string} args.indent - Base indentation.
   * @param {string} args.propertyName - Object property name.
   * @param {Record<string, string>} args.values - Command key-values.
   * @returns {string} - Formatted multiline array property. Always emits
   *   the camelCase method-name array form (`memberCommands: ["updateAccess"]`)
   *   so the generated config matches the canonical
   *   `FrontendModelResourceConfig.{collection,member}Commands: string[]`
   *   shape. The runtime derives the command slug from the camelCase
   *   method name; consumers never need to write out
   *   `{updateAccess: "update-access"}` by hand.
   */
  formattedCommandsProperty({indent, propertyName, values}) {
    return this.formattedArrayProperty({indent, propertyName, values: Object.keys(values)})
  }

  /**
   * Runs formatted object property.
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
   * Runs attribute definitions for model.
   * @param {object} args - Arguments.
   * @param {string} args.className - Frontend model class name.
   * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
   * @param {import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.modelConfig - Model configuration.
   * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} [args.resourceClass] - Resource class.
   * @returns {Promise<Array<{jsDocType: string, name: string}>>} - Attribute definitions.
   */
  async attributeDefinitionsForModel({className, modelClass, modelConfig, resourceClass}) {
    let attributes = modelConfig.attributes

    // Auto-derive attributes from model columns when not explicitly defined
    if ((!attributes || (Array.isArray(attributes) && attributes.length === 0)) && modelClass) {
      const columns = modelClass.getColumns()

      if (Array.isArray(columns)) {
        attributes = columns.map((column) => inflection.camelize(column.getName(), true))
      }
    }

    if (Array.isArray(attributes)) {
      const attributeDefinitions = []

      for (const attributeDefinition of attributes) {
        /** @type {FrontendAttributeConfig | null} */
        let configuredAttributeConfig = null
        let attributeName

        if (typeof attributeDefinition == "string") {
          attributeName = attributeDefinition
        } else if (attributeDefinition && typeof attributeDefinition == "object" && !Array.isArray(attributeDefinition)) {
          configuredAttributeConfig = /** @type {FrontendAttributeConfig} */ (attributeDefinition)
          attributeName = configuredAttributeConfig.name
        }

        if (typeof attributeName != "string" || attributeName.length < 1) {
          throw new Error(`Expected frontend model attribute array entries to be strings or objects with a name, got: ${JSON.stringify(attributeDefinition)}`)
        }

        const attributeConfig = await this.resolvedFrontendAttributeConfig({
          attributeName,
          className,
          configuredAttributeConfig,
          modelClass,
          resourceClass
        })

        attributeDefinitions.push({
          jsDocType: this.jsDocTypeForFrontendAttribute({attributeConfig}),
          name: attributeName
        })
      }

      return attributeDefinitions
    }

    if (!attributes || typeof attributes !== "object") {
      throw new Error(`Expected 'attributes' as array or object but got: ${attributes}`)
    }

    const attributeDefinitions = []

    for (const attributeName of Object.keys(attributes)) {
      const attributeConfig = attributes[attributeName]
      const configuredAttributeConfig = attributeConfig && typeof attributeConfig === "object"
        ? /** @type {FrontendAttributeConfig} */ (attributeConfig)
        : null
      const normalizedAttributeConfig = await this.resolvedFrontendAttributeConfig({
        attributeName,
        className,
        configuredAttributeConfig,
        modelClass,
        resourceClass
      })

      attributeDefinitions.push({
        jsDocType: this.jsDocTypeForFrontendAttribute({attributeConfig: normalizedAttributeConfig}),
        name: attributeName
      })
    }

    return attributeDefinitions
  }

  /**
   * Resolves frontend attribute config from explicit metadata, model columns, or resource method JSDoc.
   * @param {object} args - Arguments.
   * @param {string} args.attributeName - Frontend attribute name.
   * @param {string} args.className - Frontend model class name.
   * @param {FrontendAttributeConfig | null} args.configuredAttributeConfig - Resource-provided attribute config.
   * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
   * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
   * @returns {Promise<FrontendAttributeConfig>} - Resolved frontend attribute config.
   */
  async resolvedFrontendAttributeConfig({attributeName, className, configuredAttributeConfig, modelClass, resourceClass}) {
    const inferredColumnConfig = this.frontendAttributeConfigForModelAttribute({attributeName, modelClass})
    const inferredModelAccessorConfig = inferredColumnConfig
      ? null
      : await this.frontendAttributeConfigForModelAccessor({attributeName, modelClass})
    const inferredJsDocConfig = inferredColumnConfig
      ? null
      : await this.frontendAttributeConfigForResourceAttribute({attributeName, resourceClass})
    const inferredConfig = inferredColumnConfig || inferredModelAccessorConfig || inferredJsDocConfig

    if (configuredAttributeConfig && this.frontendAttributeConfigHasType(configuredAttributeConfig)) {
      return inferredConfig
        ? {...inferredConfig, ...configuredAttributeConfig}
        : configuredAttributeConfig
    }

    if (inferredConfig) {
      return configuredAttributeConfig
        ? {...inferredConfig, ...configuredAttributeConfig}
        : inferredConfig
    }

    throw new Error(`Could not infer JSDoc type for frontend model attribute '${className}#${attributeName}'. Add a backend model column, explicit resource metadata, or a @returns JSDoc type on ${resourceClass?.name || "the resource"}.${attributeName}Attribute().`)
  }

  /**
   * Runs frontend attribute config has type.
   * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute config.
   * @returns {boolean} - Whether the config declares a type source.
   */
  frontendAttributeConfigHasType(attributeConfig) {
    return typeof this.frontendAttributeTypeValue(attributeConfig) == "string"
      || typeof attributeConfig?.jsDocType == "string"
  }

  /**
   * Runs js doc type for frontend attribute.
   * @param {object} args - Arguments.
   * @param {FrontendAttributeConfig | null | undefined} args.attributeConfig - Attribute configuration value.
   * @returns {string} - JSDoc type.
   */
  jsDocTypeForFrontendAttribute({attributeConfig}) {
    if (attributeConfig && typeof attributeConfig.jsDocType == "string" && attributeConfig.jsDocType.length > 0) {
      return attributeConfig.jsDocType
    }

    const jsDocType = this.jsDocTypeForFrontendAttributeBaseType(attributeConfig)

    if (!this.frontendAttributeCanBeNull(attributeConfig)) {
      return jsDocType
    }

    return `${jsDocType} | null`
  }

  /**
   * Runs js doc type for frontend attribute base type.
   * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute configuration value.
   * @returns {string} - Non-nullable JSDoc type.
   */
  jsDocTypeForFrontendAttributeBaseType(attributeConfig) {
    if (!attributeConfig || typeof attributeConfig !== "object") {
      return "FrontendModelAttributeValue"
    }

    const type = this.frontendAttributeTypeValue(attributeConfig)

    if (type == "boolean") {
      return "boolean"
    } else if (type == "json" || type == "jsonb") {
      return "FrontendModelTransportValue"
    } else if (type && ["blob", "char", "nvarchar", "varchar", "text", "longtext", "mediumtext", "tinytext", "uuid", "character varying"].includes(type)) {
      return "string"
    } else if (type && ["bit", "bigint", "decimal", "double", "double precision", "float", "int", "integer", "numeric", "real", "smallint", "tinyint"].includes(type)) {
      return "number"
    } else if (type && ["date", "datetime", "timestamp", "timestamp without time zone", "timestamptz"].includes(type)) {
      return "Date"
    } else {
      return "FrontendModelAttributeValue"
    }
  }

  /**
   * Runs frontend attribute can be null.
   * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute configuration value.
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
   * Runs frontend attribute type value.
   * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute configuration value.
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
   * Runs frontend attribute config for resource attribute.
   * @param {object} args - Arguments.
   * @param {string} args.attributeName - Frontend model attribute name.
   * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
   * @returns {Promise<FrontendAttributeConfig | null>} - Attribute config inferred from resource method JSDoc.
   */
  async frontendAttributeConfigForResourceAttribute({attributeName, resourceClass}) {
    if (!resourceClass) return null

    const methodName = `${attributeName}Attribute`
    const ownerClassName = this.methodOwnerClassName({methodName, targetClass: resourceClass})

    if (!ownerClassName) return null

    const jsDocType = await this.resourceMethodReturnType({
      methodName,
      sourceClassName: ownerClassName
    })

    return jsDocType ? {jsDocType: this.unwrappedPromiseJsDocType({jsDocType})} : null
  }

  /**
   * Runs frontend attribute config for model accessor.
   * @param {object} args - Arguments.
   * @param {string} args.attributeName - Frontend model attribute name.
   * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
   * @returns {Promise<FrontendAttributeConfig | null>} - Attribute config inferred from model accessor JSDoc.
   */
  async frontendAttributeConfigForModelAccessor({attributeName, modelClass}) {
    if (!modelClass) return null

    const ownerClassName = this.methodOwnerClassName({methodName: attributeName, targetClass: modelClass})

    if (!ownerClassName) return null

    const jsDocType = await this.resourceMethodReturnType({
      methodName: attributeName,
      sourceClassName: ownerClassName
    })

    return jsDocType ? {jsDocType} : null
  }

  /**
   * Runs unwrapped promise js doc type.
   * @param {object} args - Arguments.
   * @param {string} args.jsDocType - JSDoc type to normalize.
   * @returns {string} - The resolved value type for serialized frontend attributes.
   */
  unwrappedPromiseJsDocType({jsDocType}) {
    const promisePrefix = "Promise<"

    if (!jsDocType.startsWith(promisePrefix)) return jsDocType

    if (!jsDocType.endsWith(">")) {
      throw new Error(`Expected Promise JSDoc type to end with '>': ${jsDocType}`)
    }

    const resolvedType = jsDocType.slice(promisePrefix.length, -1).trim()

    if (resolvedType.length < 1) {
      throw new Error(`Expected Promise JSDoc type to contain a resolved type: ${jsDocType}`)
    }

    return resolvedType
  }

  /**
   * Runs method owner class name.
   * @param {object} args - Arguments.
   * @param {string} args.methodName - Method name.
   * @param {typeof import("../../../../../database/record/index.js").default | import("../../../../../configuration-types.js").FrontendModelResourceClassType} args.targetClass - Target class.
   * @returns {string | null} - Class name that declares the method.
   */
  methodOwnerClassName({methodName, targetClass}) {
    let prototype = targetClass.prototype

    while (prototype && prototype !== Object.prototype) {
      if (Object.prototype.hasOwnProperty.call(prototype, methodName)) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName)

        if (typeof descriptor?.value != "function") return null

        const constructorName = prototype.constructor?.name

        if (typeof constructorName == "string" && constructorName.length > 0) return constructorName

        return null
      }

      prototype = Object.getPrototypeOf(prototype)
    }

    return null
  }

  /**
   * Runs resource method return type.
   * @param {object} args - Arguments.
   * @param {string} args.methodName - Method name.
   * @param {string} args.sourceClassName - Source class name.
   * @returns {Promise<string | null>} - JSDoc return type when documented.
   */
  async resourceMethodReturnType({methodName, sourceClassName}) {
    const resourceMethodReturnTypes = await this.resourceMethodReturnTypes()
    const returnTypeKey = `${sourceClassName}.${methodName}`

    if (!resourceMethodReturnTypes.has(returnTypeKey)) return null

    const returnType = resourceMethodReturnTypes.get(returnTypeKey)

    if (typeof returnType != "string" || returnType.length < 1) {
      throw new Error(`Expected non-empty JSDoc return type for ${returnTypeKey}`)
    }

    return returnType
  }

  /**
   * Runs resource method return types.
   * @returns {Promise<Map<string, string>>} - Resource method return types keyed by ClassName.methodName.
   */
  async resourceMethodReturnTypes() {
    if (this._resourceMethodReturnTypes) return this._resourceMethodReturnTypes

    const sourceDirectory = path.join(this.directory(), "src")
    const sourceFiles = await this.javascriptFilesInDirectory(sourceDirectory)
    const returnTypes = new Map()

    for (const sourceFile of sourceFiles) {
      const sourceText = await fs.readFile(sourceFile, "utf8")

      this.addResourceMethodReturnTypesFromSource({returnTypes, sourceText})
    }

    this._resourceMethodReturnTypes = returnTypes

    return returnTypes
  }

  /**
   * Adds resource method return types from source.
   * @param {object} args - Arguments.
   * @param {Map<string, string>} args.returnTypes - Mutable return types map.
   * @param {string} args.sourceText - Source text.
   * @returns {void}
   */
  addResourceMethodReturnTypesFromSource({returnTypes, sourceText}) {
    const classRegex = /class\s+([A-Za-z_$][\w$]*)\s+(?:extends\s+[^{]+)?\{/g
    let classMatch

    while ((classMatch = classRegex.exec(sourceText))) {
      const className = classMatch[1]
      const classBodyStart = classRegex.lastIndex
      const classBodyEnd = this.matchingBraceIndex({openIndex: classBodyStart - 1, sourceText})

      if (classBodyEnd == null) {
        throw new Error(`Could not find closing brace for resource class '${className}' while reading frontend attribute JSDoc`)
      }

      const classBody = sourceText.slice(classBodyStart, classBodyEnd)
      const jsDocRegex = /\/\*\*([\s\S]*?)\*\//g
      let jsDocMatch

      while ((jsDocMatch = jsDocRegex.exec(classBody))) {
        const sourceAfterJsDoc = classBody.slice(jsDocRegex.lastIndex)
        const methodMatch = sourceAfterJsDoc.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/)

        if (!methodMatch) continue

        const methodName = methodMatch[1]

        const returnType = this.jsDocReturnType(jsDocMatch[1])

        if (returnType) {
          returnTypes.set(`${className}.${methodName}`, returnType)
        }
      }

      classRegex.lastIndex = classBodyEnd + 1
    }
  }

  /**
   * Runs js doc return type.
   * @param {string} jsDocText - JSDoc text inside comment markers.
   * @returns {string | null} - JSDoc return type when present.
   */
  jsDocReturnType(jsDocText) {
    const returnsMatch = jsDocText.match(/@returns?\s*\{/)

    if (!returnsMatch || returnsMatch.index == null) return null

    const typeOpenIndex = returnsMatch.index + returnsMatch[0].length - 1
    const typeCloseIndex = this.matchingBraceIndex({openIndex: typeOpenIndex, sourceText: jsDocText})

    if (typeCloseIndex == null) {
      throw new Error(`Could not parse JSDoc return type from: ${jsDocText}`)
    }

    const returnType = jsDocText.slice(typeOpenIndex + 1, typeCloseIndex).trim()

    if (returnType.length < 1) {
      throw new Error(`Expected non-empty JSDoc return type in: ${jsDocText}`)
    }

    return returnType
  }

  /**
   * Runs javascript files in directory.
   * @param {string} directory - Directory path.
   * @returns {Promise<string[]>} - JavaScript source file paths.
   */
  async javascriptFilesInDirectory(directory) {
    let entries

    try {
      entries = await fs.readdir(directory, {withFileTypes: true})
    } catch (error) {
      if (error && typeof error == "object" && "code" in error && error.code === "ENOENT") return []

      throw error
    }

    const filePaths = []

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        filePaths.push(...await this.javascriptFilesInDirectory(entryPath))
      } else if (entry.isFile() && /\.(mjs|js|jsx|ts)$/.test(entry.name)) {
        filePaths.push(entryPath)
      }
    }

    return filePaths
  }

  /**
   * Finds a matching closing brace while respecting JavaScript strings and comments.
   * @param {object} args - Arguments.
   * @param {number} args.openIndex - Opening brace index.
   * @param {string} args.sourceText - Source text.
   * @returns {number | null} - Closing brace index when found.
   */
  matchingBraceIndex({openIndex, sourceText}) {
    if (sourceText[openIndex] !== "{") {
      throw new Error(`Expected opening brace at index ${openIndex}`)
    }

    let depth = 0
    let inBlockComment = false
    let inLineComment = false
    let inString = ""

    for (let index = openIndex; index < sourceText.length; index++) {
      const char = sourceText[index]
      const nextChar = sourceText[index + 1]
      const previousChar = sourceText[index - 1]

      if (inLineComment) {
        if (char === "\n") inLineComment = false

        continue
      }

      if (inBlockComment) {
        if (char === "*" && nextChar === "/") {
          inBlockComment = false
          index++
        }

        continue
      }

      if (inString) {
        if (char === inString && previousChar !== "\\") inString = ""

        continue
      }

      if (char === "/" && nextChar === "/") {
        inLineComment = true
        index++
        continue
      }

      if (char === "/" && nextChar === "*") {
        inBlockComment = true
        index++
        continue
      }

      if (char === "\"" || char === "'" || char === "`") {
        inString = char
        continue
      }

      if (char === "{") {
        depth++
      } else if (char === "}") {
        depth--

        if (depth === 0) return index
      }
    }

    return null
  }

  /**
   * Runs frontend attribute config for model attribute.
   * @param {object} args - Arguments.
   * @param {string} args.attributeName - Frontend model attribute name.
   * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
   * @returns {FrontendAttributeConfig | null} - Attribute config inferred from the backend model when available.
   */
  frontendAttributeConfigForModelAttribute({attributeName, modelClass}) {
    if (!modelClass) {
      return null
    }

    const resolvedAttributeName = modelClass.resolveAttributeName(attributeName)

    if (!resolvedAttributeName) return null

    let columnName

    try {
      columnName = modelClass.getAttributeNameToColumnNameMap()[resolvedAttributeName]
    } catch (error) {
      if (error instanceof Error && error.message.includes("used before initialization")) return null

      throw error
    }

    if (!columnName) {
      return null
    }

    let column

    try {
      column = modelClass.getColumnsHash()[columnName]
    } catch (error) {
      if (error instanceof Error && error.message.includes("used before initialization")) return null

      throw error
    }

    if (!column) return null

    return {
      null: column.getNull(),
      type: String(column.getType())
    }
  }

  /**
   * Runs relationships for model.
   * @param {object} args - Arguments.
   * @param {string} args.className - Model class name.
   * @param {import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.modelConfig - Model configuration.
   * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} [args.resourceClass] - Resource class.
   * @returns {Array<{autoload: boolean, relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}>} - Relationships.
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
   * Runs inferred relationship definition.
   * @param {object} args - Arguments.
   * @param {string} args.className - Model class name.
   * @param {string} args.relationshipName - Relationship name.
   * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} [args.resourceClass] - Resource class.
   * @returns {{autoload: boolean, relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}} Inferred relationship definition.
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
      autoload: relationship.getAutoload(),
      relationshipName,
      targetClassName,
      targetFileName: inflection.dasherize(inflection.underscore(targetClassName)),
      type: relationshipType
    }
  }
}
