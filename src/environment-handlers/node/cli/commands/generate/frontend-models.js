import BaseCommand from "../../../../../cli/base-command.js"
import fs from "fs/promises"
import path from "node:path"
import * as inflection from "inflection"
import {frontendModelResourceIsBuiltIn, frontendModelResourcesWithBuiltInsForBackendProject} from "../../../../../frontend-models/built-in-resources.js"
import {frontendModelResourceClassFromDefinition, frontendModelResourceConfigurationFromDefinition} from "../../../../../frontend-models/resource-definition.js"

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
 * @typedef {Array<string | Record<string, FrontendModelGeneratorPermitSpec>>} FrontendModelGeneratorPermitSpec
 */
/**
 * JSDoc import alias extracted from a backend resource source file.
 * @typedef {object} ResourceJsDocImportAlias
 * @property {string} importedName - Exported type name.
 * @property {string} specifier - Import specifier from the source file.
 */
/**
 * JSDoc return type extracted from a backend resource method.
 * @typedef {object} ResourceMethodReturnType
 * @property {Map<string, ResourceJsDocImportAlias>} importAliases - Import aliases visible in the source file.
 * @property {string | null} sourceFile - Source file that declared the method.
 * @property {string} type - JSDoc return type.
 */
/**
 * JSDoc parameter type extracted from a backend resource method.
 * @typedef {object} ResourceMethodParameterType
 * @property {Map<string, ResourceJsDocImportAlias>} importAliases - Import aliases visible in the source file.
 * @property {string | null} name - Parameter name.
 * @property {string | null} sourceFile - Source file that declared the method.
 * @property {string} type - JSDoc parameter type.
 */

/** Node CLI command that generates frontend model classes from backend project resource config. */
export default class DbGenerateFrontendModels extends BaseCommand {
  /** @type {Map<string, ResourceMethodReturnType> | null} */
  _resourceMethodReturnTypes = null

  /** @type {Map<string, ResourceMethodParameterType[]> | null} */
  _resourceMethodParameterTypes = null

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

        const resolvedResourceClass = frontendModelResourceClassFromDefinition(resources[modelClassName])
        // An abstract base resource (no static ModelClass — e.g. an app's shared
        // `BaseResource` that other resources extend) can't back a generated
        // frontend model. Treat it as resource-less so the generator falls back
        // to by-name model lookup + empty write params instead of throwing when
        // it eagerly calls `modelClass()` / `permittedParams()` on it.
        const resourceClass = resolvedResourceClass && resolvedResourceClass.ModelClass ? resolvedResourceClass : null

        this.validateModelConfig({availableFrontendModelClassNames, className, modelConfig, resourceClass})

        if (generatedModelNames.has(className)) {
          if (frontendModelResourceIsBuiltIn({modelName: modelClassName, resourceDefinition: resources[modelClassName]})) {
            continue
          }

          throw new Error(`Duplicate frontend model definition for '${className}'`)
        }

        generatedModelNames.add(className)

        const fileContent = await this.buildModelFileContent({
          className,
          frontendModelFilePath: filePath,
          importPath,
          modelClass: resourceClass ? resourceClass.modelClass() : configuration.getModelClasses()[className],
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
    return frontendModelResourcesWithBuiltInsForBackendProject(backendProject)
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
   * @param {string} args.frontendModelFilePath - Generated frontend model file path.
   * @param {string} args.importPath - Base class import path.
   * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
   * @param {import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.modelConfig - Model configuration.
   * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null} [args.resourceClass] - Resource class.
   * @returns {Promise<string>} - Generated file content.
   */
  async buildModelFileContent({className, frontendModelFilePath, importPath, modelClass, modelConfig, resourceClass}) {
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
    const declaredCommandMetadata = modelConfig.commandMetadata || {}
    const commandMetadata = await this.commandMetadataWithResourceJsDoc({
      commandMetadata: declaredCommandMetadata,
      commandNames: [...Object.keys(collectionCommands), ...Object.keys(memberCommands)],
      frontendModelFilePath,
      resourceClass
    })
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
    fileContent += await this.writeAttributesTypedef({attributes, attributesTypeName, modelClass, nestedWriteTypes, permittedParams: permittedCreateParams, resourceClass, typeName: createAttributesTypeName})
    fileContent += await this.writeAttributesTypedef({attributes, attributesTypeName, modelClass, nestedWriteTypes, permittedParams: permittedUpdateParams, resourceClass, typeName: updateAttributesTypeName})
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
    const primaryKey = this.frontendModelPrimaryKeyForResource({attributeNames, modelClass, modelConfig})

    if (primaryKey !== "id") {
      fileContent += `      primaryKey: ${JSON.stringify(primaryKey)},\n`
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
      const attributeType = `${attributesTypeName}[${JSON.stringify(attribute.name)}]`
      const setterAttributeType = await this.frontendWriteAttributeType({
        attribute,
        attributeName: attribute.name,
        attributesTypeName,
        resourceClass
      })

      fileContent += "\n"
      fileContent += `  /** @returns {${attributeType}} - Attribute value. */\n`
      fileContent += `  ${camelizedAttribute}() { return /** @type {${attributeType}} */ (this.readAttribute(${JSON.stringify(attribute.name)})) }\n`

      fileContent += "\n"
      fileContent += "  /**\n"
      fileContent += `   * @param {${setterAttributeType}} newValue - New attribute value.\n`
      fileContent += `   * @returns {${setterAttributeType}} - Assigned value.\n`
      fileContent += "   */\n"
      fileContent += `  set${camelizedAttributeUpper}(newValue) { return /** @type {${setterAttributeType}} */ (this.setAttribute(${JSON.stringify(attribute.name)}, newValue)) }\n`
    }

    for (const methodName of Object.keys(collectionCommands)) {
      const signature = this.customCommandMethodSignature({commandMetadata, methodName})

      fileContent += "\n"
      fileContent += "  /**\n"
      fileContent += `   * Runs ${methodName}.\n`
      fileContent += signature.paramDocs
      fileContent += `   * @returns {Promise<${signature.returnType}>} - Command response.\n`
      fileContent += "   */\n"
      fileContent += `  static async ${methodName}(${signature.parameters}) {\n`
      fileContent += `    return /** @type {${signature.returnType}} */ (await this.executeCustomCommand({\n`
      fileContent += `      commandName: ${JSON.stringify(collectionCommands[methodName])},\n`
      fileContent += `      commandType: ${JSON.stringify(collectionCommands[methodName])},\n`
      fileContent += `      payload: ${className}.normalizeCustomCommandPayloadArguments(${signature.payloadArguments}),\n`
      fileContent += "      resourcePath: this.resourcePath()\n"
      fileContent += "    }))\n"
      fileContent += "  }\n"
    }

    for (const methodName of Object.keys(memberCommands)) {
      const signature = this.customCommandMethodSignature({commandMetadata, methodName})

      fileContent += "\n"
      fileContent += "  /**\n"
      fileContent += `   * Runs ${methodName}.\n`
      fileContent += signature.paramDocs
      fileContent += `   * @returns {Promise<${signature.returnType}>} - Command response.\n`
      fileContent += "   */\n"
      fileContent += `  async ${methodName}(${signature.parameters}) {\n`
      fileContent += `    return /** @type {${signature.returnType}} */ (await ${className}.executeCustomCommand({\n`
      fileContent += `      commandName: ${JSON.stringify(memberCommands[methodName])},\n`
      fileContent += `      commandType: ${JSON.stringify(memberCommands[methodName])},\n`
      fileContent += "      memberId: this.primaryKeyValue(),\n"
      fileContent += `      payload: ${className}.normalizeCustomCommandPayloadArguments(${signature.payloadArguments}),\n`
      fileContent += `      resourcePath: ${className}.resourcePath()\n`
      fileContent += "    }))\n"
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
   * @param {Array<{jsDocType: string, name: string, writeJsDocType: string}>} args.attributes - Generated read attributes.
   * @param {string} args.attributesTypeName - Generated read attributes typedef name.
   * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
   * @param {Array<{attributes: Array<{name: string, type: string}>, relationshipName: string, typeName: string}>} args.nestedWriteTypes - Nested write typedefs.
   * @param {FrontendModelGeneratorPermitSpec} args.permittedParams - Resource permitted params spec.
   * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
   * @param {string} args.typeName - Typedef name.
   * @returns {Promise<string>} - Generated typedef source.
   */
  async writeAttributesTypedef({attributes, attributesTypeName, modelClass, nestedWriteTypes, permittedParams, resourceClass, typeName}) {
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

        const type = await this.frontendWriteAttributeType({
          attribute: attributesByName.get(attributeName),
          attributeName,
          attributesTypeName,
          resourceClass
        })

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
   * Runs frontend write attribute type.
   * @param {{attribute: {jsDocType: string, name: string, writeJsDocType: string} | undefined, attributeName: string, attributesTypeName: string, resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined}} args - Arguments.
   * @returns {Promise<string>} - JSDoc type for the permitted write field.
   */
  async frontendWriteAttributeType({attribute, attributeName, attributesTypeName, resourceClass}) {
    const setterParameterType = await this.frontendWriteAttributeSetterParameterType({attributeName, resourceClass})

    if (setterParameterType) return `${setterParameterType} | null`

    if (!attribute) return "FrontendModelAttributeValue"

    if (attribute.jsDocType.trim() === "null") return "FrontendModelAttributeValue"

    if (attribute.writeJsDocType !== attribute.jsDocType) return attribute.writeJsDocType

    return `${attributesTypeName}[${JSON.stringify(attribute.name)}] | null`
  }

  /**
   * Runs frontend write attribute setter parameter type.
   * @param {{attributeName: string, resourceClass: import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined}} args - Arguments.
   * @returns {Promise<string | null>} - Setter value parameter type when it is useful for generation.
   */
  async frontendWriteAttributeSetterParameterType({attributeName, resourceClass}) {
    if (!resourceClass?.name) return null

    const methodName = `set${inflection.camelize(attributeName)}Attribute`
    const parameterType = await this.resourceMethodParameterType({
      methodName,
      parameterIndex: 1,
      sourceClassName: resourceClass.name
    })

    if (!parameterType) return null
    if (this.isBroadGeneratedType(parameterType)) return null

    return parameterType
  }

  /**
   * Runs is broad generated type.
   * @param {string} jsDocType - JSDoc type.
   * @returns {boolean} - Whether the type is too broad to improve generated write typing.
   */
  isBroadGeneratedType(jsDocType) {
    const normalizedType = jsDocType.trim()

    return normalizedType === "?"
      || normalizedType === "any"
      || normalizedType === "object"
      || normalizedType === "unknown"
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
        type: attributeConfig ? this.jsDocTypeForFrontendWriteAttribute({attributeConfig}) : "FrontendModelAttributeValue"
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
    if (!resourceClass) return []

    try {
      const modelClass = resourceClass.modelClass()

      const instance = new resourceClass({
        ability: undefined,
        context: {},
        locals: {},
        modelClass,
        modelName: modelClass.getModelName(),
        params: {},
        resourceConfiguration: /** @type {import("../../../../../configuration-types.js").FrontendModelResourceConfiguration} */ ({attributes: []})
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
    if (!resourceClass) return []

    let spec

    try {
      const modelClass = resourceClass.modelClass()

      const instance = new resourceClass({
        ability: undefined,
        context: {},
        locals: {},
        modelClass,
        modelName: modelClass.getModelName(),
        params: {},
        resourceConfiguration: /** @type {import("../../../../../configuration-types.js").FrontendModelResourceConfiguration} */ ({attributes: []})
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
   * @returns {Promise<Array<{jsDocType: string, name: string, writeJsDocType: string}>>} - Attribute definitions.
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

        const frontendAttributeConfig = this.frontendAttributeConfigForGeneratedAttribute({
          attributeConfig,
          attributeName,
          modelClass
        })

        attributeDefinitions.push({
          jsDocType: this.jsDocTypeForFrontendAttribute({attributeConfig: frontendAttributeConfig}),
          name: attributeName,
          writeJsDocType: this.jsDocTypeForFrontendWriteAttribute({attributeConfig: frontendAttributeConfig})
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
      const frontendAttributeConfig = this.frontendAttributeConfigForGeneratedAttribute({
        attributeConfig: normalizedAttributeConfig,
        attributeName,
        modelClass
      })

      attributeDefinitions.push({
        jsDocType: this.jsDocTypeForFrontendAttribute({attributeConfig: frontendAttributeConfig}),
        name: attributeName,
        writeJsDocType: this.jsDocTypeForFrontendWriteAttribute({attributeConfig: frontendAttributeConfig})
      })
    }

    return attributeDefinitions
  }

  /**
   * Runs frontend attribute config for generated attribute.
   * @param {{attributeConfig: FrontendAttributeConfig, attributeName: string, modelClass: typeof import("../../../../../database/record/index.js").default | undefined}} args - Arguments.
   * @returns {FrontendAttributeConfig} - Attribute config used for generated JSDoc.
   */
  frontendAttributeConfigForGeneratedAttribute({attributeConfig, attributeName, modelClass}) {
    if (!this.frontendAttributeIsModelPrimaryKey({attributeName, modelClass})) return attributeConfig
    if (this.frontendAttributeConfigHasNullability(attributeConfig)) return attributeConfig

    return {...attributeConfig, null: false}
  }

  /**
   * Runs frontend attribute is model primary key.
   * @param {{attributeName: string, modelClass: typeof import("../../../../../database/record/index.js").default | undefined}} args - Arguments.
   * @returns {boolean} - Whether the attribute is the model primary key.
   */
  frontendAttributeIsModelPrimaryKey({attributeName, modelClass}) {
    if (!modelClass) return false

    const primaryKey = modelClass.primaryKey()

    if (typeof primaryKey != "string" || primaryKey.length < 1) return false
    if (attributeName === primaryKey) return true

    return modelClass.resolveAttributeName(primaryKey) === attributeName
  }

  /**
   * Resolves the primary key from explicit resource config or the backend model.
   * @param {{attributeNames: Array<string>, modelClass: typeof import("../../../../../database/record/index.js").default | undefined, modelConfig: import("../../../../../configuration-types.js").NormalizedFrontendModelResourceConfiguration}} args - Primary key resolution args.
   * @returns {string | Array<string>} - Frontend-model primary key attribute name.
   */
  frontendModelPrimaryKeyForResource({attributeNames, modelClass, modelConfig}) {
    if (modelConfig.primaryKey) {
      return this.validatedConfiguredPrimaryKey({attributeNames, primaryKey: modelConfig.primaryKey})
    }

    if (!modelClass) return "id"

    return this.frontendModelPrimaryKeyForModelClass({attributeNames, modelClass})
  }

  /**
   * Validates an explicitly configured frontend-model primary key.
   * @param {{attributeNames: Array<string>, primaryKey: string}} args - Configured primary key args.
   * @returns {string} - Configured primary key.
   */
  validatedConfiguredPrimaryKey({attributeNames, primaryKey}) {
    if (attributeNames.includes(primaryKey)) return primaryKey

    throw new Error(`Configured frontend model primary key "${primaryKey}" is not a generated frontend model attribute.`)
  }

  /**
   * Resolves the backend primary key to generated frontend-model attribute names.
   * @param {{attributeNames: Array<string>, modelClass: typeof import("../../../../../database/record/index.js").default}} args - Primary key resolution args.
   * @returns {string | Array<string>} - Frontend-model primary key attribute name.
   */
  frontendModelPrimaryKeyForModelClass({attributeNames, modelClass}) {
    const primaryKey = modelClass.primaryKey()

    if (primaryKey === "id") return "id"

    if (Array.isArray(primaryKey)) {
      return primaryKey.map((columnName) => this.frontendModelPrimaryKeyAttributeName({attributeNames, columnName, modelClass}))
    }

    return this.frontendModelPrimaryKeyAttributeName({attributeNames, columnName: primaryKey, modelClass})
  }

  /**
   * Resolves one backend primary key column to a generated frontend-model attribute name.
   * @param {{attributeNames: Array<string>, columnName: string, modelClass: typeof import("../../../../../database/record/index.js").default}} args - Primary key args.
   * @returns {string} - Frontend-model primary key attribute name.
   */
  frontendModelPrimaryKeyAttributeName({attributeNames, columnName, modelClass}) {
    if (attributeNames.includes(columnName)) return columnName

    const attributeName = modelClass.resolveAttributeName(columnName)

    if (attributeName && attributeNames.includes(attributeName)) {
      return attributeName
    }

    throw new Error(`${modelClass.name}.primaryKey() column "${columnName}" does not resolve to a generated frontend model attribute.`)
  }

  /**
   * Resolves frontend attribute config from explicit metadata, resource methods, model columns, translated columns, or model accessor JSDoc.
   * @param {object} args - Arguments.
   * @param {string} args.attributeName - Frontend attribute name.
   * @param {string} args.className - Frontend model class name.
   * @param {FrontendAttributeConfig | null} args.configuredAttributeConfig - Resource-provided attribute config.
   * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
   * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
   * @returns {Promise<FrontendAttributeConfig>} - Resolved frontend attribute config.
   */
  async resolvedFrontendAttributeConfig({attributeName, className, configuredAttributeConfig, modelClass, resourceClass}) {
    const inferredResourceConfig = await this.frontendAttributeConfigForResourceAttribute({attributeName, resourceClass})
    const inferredColumnConfig = inferredResourceConfig
      ? null
      : this.frontendAttributeConfigForModelAttribute({attributeName, modelClass})
    const inferredTranslatedConfig = inferredResourceConfig || inferredColumnConfig
      ? null
      : this.frontendAttributeConfigForTranslatedAttribute({attributeName, modelClass, resourceClass})
    const inferredModelAccessorConfig = inferredResourceConfig || inferredColumnConfig || inferredTranslatedConfig
      ? null
      : await this.frontendAttributeConfigForModelAccessor({attributeName, modelClass})
    const inferredConfig = inferredResourceConfig || inferredColumnConfig || inferredTranslatedConfig || inferredModelAccessorConfig

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

    throw new Error(`Could not infer JSDoc type for frontend model attribute '${className}#${attributeName}'. Add a backend model column, translation table column, explicit resource metadata, or a @returns JSDoc type on ${resourceClass?.name || "the resource"}.${attributeName}Attribute().`)
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
   * Runs frontend attribute config has nullability.
   * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute config.
   * @returns {boolean} - Whether the config declares nullability.
   */
  frontendAttributeConfigHasNullability(attributeConfig) {
    if (!attributeConfig || typeof attributeConfig !== "object") return false
    if (Object.prototype.hasOwnProperty.call(attributeConfig, "null")) return true

    return typeof attributeConfig.getNull == "function"
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
   * Runs js doc type for frontend write attribute.
   * @param {object} args - Arguments.
   * @param {FrontendAttributeConfig | null | undefined} args.attributeConfig - Attribute configuration value.
   * @returns {string} - JSDoc type accepted by create/update payloads.
   */
  jsDocTypeForFrontendWriteAttribute({attributeConfig}) {
    if (attributeConfig && typeof attributeConfig.jsDocType == "string" && attributeConfig.jsDocType.length > 0) {
      return attributeConfig.jsDocType
    }

    const jsDocType = this.jsDocTypeForFrontendWriteAttributeBaseType(attributeConfig)

    if (!this.frontendAttributeCanBeNull(attributeConfig)) {
      return jsDocType
    }

    return `${jsDocType} | null`
  }

  /**
   * Runs js doc type for frontend write attribute base type.
   * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute configuration value.
   * @returns {string} - Non-nullable JSDoc type accepted by create/update payloads.
   */
  jsDocTypeForFrontendWriteAttributeBaseType(attributeConfig) {
    const readType = this.jsDocTypeForFrontendAttributeBaseType(attributeConfig)

    if (!this.frontendAttributeTypeIsTemporal(attributeConfig)) return readType

    return `${readType} | string`
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
    } else if (this.frontendAttributeTypeIsTemporal(attributeConfig)) {
      return "Date"
    } else {
      return "FrontendModelAttributeValue"
    }
  }

  /**
   * Runs frontend attribute type is temporal.
   * @param {FrontendAttributeConfig | null | undefined} attributeConfig - Attribute configuration value.
   * @returns {boolean} - Whether the attribute represents a date/time value.
   */
  frontendAttributeTypeIsTemporal(attributeConfig) {
    if (!attributeConfig || typeof attributeConfig !== "object") return false

    const type = this.frontendAttributeTypeValue(attributeConfig)

    return type ? ["date", "datetime", "timestamp", "timestamp without time zone", "timestamptz"].includes(type) : false
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
   * Runs frontend attribute config for translated attribute.
   * @param {object} args - Arguments.
   * @param {string} args.attributeName - Frontend model attribute name.
   * @param {typeof import("../../../../../database/record/index.js").default | undefined} args.modelClass - Backend model class.
   * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
   * @returns {FrontendAttributeConfig | null} - Attribute config inferred from translated attribute columns.
   */
  frontendAttributeConfigForTranslatedAttribute({attributeName, modelClass, resourceClass}) {
    if (!modelClass) return null
    if (!this.frontendAttributeIsTranslated({attributeName, modelClass, resourceClass})) return null

    const TranslationClass = modelClass.getTranslationClass()
    const columnName = inflection.underscore(attributeName)

    let column

    try {
      column = TranslationClass.getColumnsHash()[columnName]
    } catch (error) {
      if (error instanceof Error && (error.message.includes("hasn't been initialized yet") || error.message.includes("used before initialization"))) return null

      throw error
    }

    return column ? this.frontendAttributeConfigForColumn({column}) : null
  }

  /**
   * Runs frontend attribute is translated.
   * @param {object} args - Arguments.
   * @param {string} args.attributeName - Frontend model attribute name.
   * @param {typeof import("../../../../../database/record/index.js").default} args.modelClass - Backend model class.
   * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
   * @returns {boolean} - Whether the frontend attribute is translated.
   */
  frontendAttributeIsTranslated({attributeName, modelClass, resourceClass}) {
    if (resourceClass) {
      const translatedAttributes = resourceClass.translatedAttributes

      if (Array.isArray(translatedAttributes) && translatedAttributes.includes(attributeName)) return true
    }

    const translations = modelClass._translations

    return Boolean(translations && typeof translations == "object" && Object.prototype.hasOwnProperty.call(translations, attributeName))
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

    // Frontend attributes hold the serialized (resolved) value, so an async
    // backend accessor typed `Promise<number>` must surface as `number` — the
    // same unwrapping the resource-method inference path applies.
    return jsDocType
      ? {jsDocType: this.frontendResolvableAttributeJsDocType(this.unwrappedPromiseJsDocType({jsDocType}))}
      : null
  }

  /**
   * A backend accessor's `@returns` can reference types that exist only on the
   * backend (e.g. a model-local `@typedef AgentRunPlanningArtifact`). The frontend
   * model can't resolve those, so fall back to `any` rather than emitting an
   * undefined type name. Types built only from primitives and known generic
   * builtins pass through unchanged.
   * @param {string} jsDocType - Resolved (Promise-unwrapped) attribute type.
   * @returns {string} - A frontend-resolvable attribute type.
   */
  frontendResolvableAttributeJsDocType(jsDocType) {
    const safeTypeIdentifiers = this.frontendResolvableTypeIdentifiers()
    const referencedIdentifiers = jsDocType.match(/[A-Z][A-Za-z0-9_$]*/g) || []

    if (referencedIdentifiers.some((identifier) => !safeTypeIdentifiers.has(identifier))) {
      return "any"
    }

    return jsDocType
  }

  /**
   * Capitalized identifiers a generated frontend model can resolve on its own
   * (primitives are lower-case and matched separately), so only framework-owned
   * and builtin generic types are listed.
   * @returns {Set<string>} - Frontend-resolvable type identifiers.
   */
  frontendResolvableTypeIdentifiers() {
    return new Set([
      "Array", "Date", "Exclude", "Extract", "FrontendModelAttributeValue", "FrontendModelTransportValue",
      "Map", "NonNullable", "Omit", "Partial", "Pick", "Promise", "Readonly", "ReadonlyArray", "Record",
      "Required", "ReturnType", "Set"
    ])
  }

  /**
   * Rewrites a custom-command param/return JSDoc type so it resolves in the generated
   * frontend model: each model-class (or otherwise non-frontend-resolvable) identifier
   * becomes `any` in place, keeping the surrounding object fields typed. A command-result
   * field holding a model arrives as a serialized transport value, so the consumer hydrates
   * it with `Model.instantiateFromResponse(...)`. The word boundary avoids matching the
   * capitalized middle of a camelCase property name (e.g. `adjustedTotalCents`).
   * @param {object} args - Arguments.
   * @param {string | null} args.frontendModelFilePath - Generated frontend model file path.
   * @param {Map<string, ResourceJsDocImportAlias>} args.importAliases - Import aliases visible to the source method.
   * @param {string} args.jsDocType - Resolved (Promise-unwrapped) JSDoc type.
   * @param {string | null} args.sourceFile - Source file that declared the method.
   * @returns {string} - A frontend-resolvable JSDoc type.
   */
  frontendResolvableCommandJsDocType({frontendModelFilePath, importAliases, jsDocType, sourceFile}) {
    const safeTypeIdentifiers = this.frontendResolvableTypeIdentifiers()
    /** @type {string[]} */
    const preservedImports = []
    /**
     * Stores an import expression behind a lowercase placeholder while generic
     * identifier cleanup runs.
     * @param {string} importExpression - Import expression to preserve.
     * @returns {string} Placeholder inserted into the type string.
     */
    const preserveImportExpression = (importExpression) => {
      const placeholder = `__velocious_import_placeholder_${preservedImports.length}__`

      preservedImports.push(importExpression)

      return placeholder
    }

    this.assertNoBackendLocalCommandTypeExpressions(jsDocType)

    const withRewrittenInlineImports = jsDocType
      // A type that reaches into a backend source file via `import("...")` (optionally
      // `.Member` and `[]`) can't resolve from the generated frontend model and would type
      // a serialized result as a backend model instance, so collapse it to `any`.
      .replace(/import\(\s*["']([^"']*)["']\s*\)((?:\s*\.\s*[A-Za-z_$][\w$]*)*)((?:\s*\[\s*\])*)/g, (_match, specifier, memberChain, arraySuffix) => {
        const rewrittenSpecifier = this.frontendResolvableJsDocImportSpecifier({
          frontendModelFilePath,
          sourceFile,
          specifier
        })

        if (!rewrittenSpecifier) return "any"

        return preserveImportExpression(`import(${JSON.stringify(rewrittenSpecifier)})${memberChain.replace(/\s+/g, "")}${arraySuffix.replace(/\s+/g, "")}`)
      })

    let withRewrittenAliases = withRewrittenInlineImports

    for (const [aliasName, importAlias] of importAliases) {
      const rewrittenSpecifier = this.frontendResolvableJsDocImportSpecifier({
        frontendModelFilePath,
        sourceFile,
        specifier: importAlias.specifier
      })

      if (!rewrittenSpecifier) continue

      const aliasRegex = new RegExp(`\\b${this.escapeRegExp(aliasName)}\\b`, "g")

      withRewrittenAliases = withRewrittenAliases.replace(aliasRegex, preserveImportExpression(`import(${JSON.stringify(rewrittenSpecifier)}).${importAlias.importedName}`))
    }

    const sanitized = withRewrittenAliases
      // Remaining capitalized identifiers are model classes or otherwise non-resolvable
      // types; downgrade each in place so sibling scalar fields keep their real types.
      .replace(/\b[A-Z][A-Za-z0-9_$]*/g, (identifier) => safeTypeIdentifiers.has(identifier) ? identifier : "any")

    return preservedImports.reduce(
      (type, importExpression, index) => type.replaceAll(`__velocious_import_placeholder_${index}__`, importExpression),
      sanitized
    )
  }

  /**
   * Raises when a command JSDoc type references a backend-local helper expression.
   * @param {string} jsDocType - Command JSDoc type.
   * @returns {void} No return value.
   */
  assertNoBackendLocalCommandTypeExpressions(jsDocType) {
    const localReturnTypeMatch = jsDocType.match(/\b(?:Awaited\s*<\s*)?ReturnType\s*<\s*typeof\s+[A-Za-z_$][\w$]*\s*>\s*>?/)

    if (!localReturnTypeMatch) return

    throw new Error(`Custom command JSDoc type cannot use backend-local ReturnType expressions in generated frontend models: ${localReturnTypeMatch[0]}. Move the payload shape to a shared typedef and return that type from the command method.`)
  }

  /**
   * Runs frontend resolvable js doc import specifier.
   * @param {object} args - Arguments.
   * @param {string | null} args.frontendModelFilePath - Generated frontend model file path.
   * @param {string | null} args.sourceFile - Source file that declared the JSDoc type.
   * @param {string} args.specifier - Source-file import specifier.
   * @returns {string | null} - Rewritten frontend-model import specifier, or null when backend-local.
   */
  frontendResolvableJsDocImportSpecifier({frontendModelFilePath, sourceFile, specifier}) {
    if (!sourceFile || !frontendModelFilePath) return null
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) return specifier

    const importedPath = path.resolve(path.dirname(sourceFile), specifier)

    if (this.filePathIsWithinAnyDirectory({directories: this.frontendModelJsDocSourceDirectories(), filePath: importedPath})) {
      return null
    }

    return this.relativeImportSpecifier({fromFile: frontendModelFilePath, toFile: importedPath})
  }

  /**
   * Runs relative import specifier.
   * @param {object} args - Arguments.
   * @param {string} args.fromFile - Source file that will contain the import expression.
   * @param {string} args.toFile - File being imported.
   * @returns {string} - Relative import specifier.
   */
  relativeImportSpecifier({fromFile, toFile}) {
    let relativeSpecifier = path.relative(path.dirname(fromFile), toFile).split(path.sep).join("/")

    if (!relativeSpecifier.startsWith(".")) {
      relativeSpecifier = `./${relativeSpecifier}`
    }

    return relativeSpecifier
  }

  /**
   * Runs file path is within any directory.
   * @param {object} args - Arguments.
   * @param {string[]} args.directories - Candidate parent directories.
   * @param {string} args.filePath - File path to test.
   * @returns {boolean} - Whether the file path is under one candidate directory.
   */
  filePathIsWithinAnyDirectory({directories, filePath}) {
    return directories.some((directory) => {
      const relativePath = path.relative(path.resolve(directory), path.resolve(filePath))

      return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
    })
  }

  /**
   * Escapes text for use inside a RegExp.
   * @param {string} value - Value to escape.
   * @returns {string} - RegExp-safe value.
   */
  escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  /**
   * Builds the JSDoc param block, parameter list, payload-argument expression, and
   * return type for a custom command method. With declared `args` each becomes a
   * named, typed parameter mapped positionally into the command payload; without
   * them the method stays variadic.
   * @param {object} args - Arguments.
   * @param {Record<string, {args: Array<{name: string, type: string}>, returnType: string | null}>} args.commandMetadata - Per-command metadata.
   * @param {string} args.methodName - Command method name.
   * @returns {{paramDocs: string, parameters: string, payloadArguments: string, returnType: string}} - Generation pieces.
   */
  customCommandMethodSignature({commandMetadata, methodName}) {
    const metadata = commandMetadata[methodName] || {args: [], returnType: null}
    const returnType = metadata.returnType || "Record<string, FrontendModelAttributeValue>"

    if (metadata.args.length > 0) {
      const parameterNames = metadata.args.map((arg) => arg.name)
      // A single args object whose every field is optional accepts `{}`, so default
      // the parameter and mark it optional — callers can then omit it entirely
      // (`record.command()` instead of `record.command({})`). Required-field args keep
      // the mandatory parameter (a `{}` default wouldn't satisfy their type).
      const defaultsToEmptyObject = metadata.args.length === 1 && this.argTypeAcceptsEmptyObject(metadata.args[0].type)

      return {
        paramDocs: metadata.args.map((arg) => `   * @param {${arg.type}} ${defaultsToEmptyObject ? `[${arg.name}]` : arg.name} - Command argument.\n`).join(""),
        parameters: defaultsToEmptyObject ? `${parameterNames[0]} = {}` : parameterNames.join(", "),
        payloadArguments: `[${parameterNames.join(", ")}]`,
        returnType
      }
    }

    return {
      paramDocs: "   * @param {...FrontendModelAttributeValue} commandArguments - Custom command arguments.\n",
      parameters: "...commandArguments",
      payloadArguments: "commandArguments",
      returnType
    }
  }

  /**
   * Whether a single command-args JSDoc type is known to accept an empty object `{}`:
   * a single balanced object literal whose top-level members are all optional (`name?:`)
   * or index signatures (`[k: ...]:`). Anything else returns false so the parameter stays
   * required — including a required member, a non-object-literal (a positional `number`,
   * a `Record<...>` / `Partial<...>` whose key/wrapper may still require data), and any
   * intersection/union (e.g. `{a?: x} & {b: string}`), where `{}` is not assignable.
   * @param {string} type - The arg's JSDoc type string.
   * @returns {boolean} - Whether the generated parameter can default to `{}`.
   */
  argTypeAcceptsEmptyObject(type) {
    const trimmedType = type.trim()

    // Must be a single balanced object literal: starts with `{`, ends with `}`, and the
    // opening brace closes only at the final character. This rejects intersections/unions
    // like `{a?: x} & {b: string}` that merely happen to start `{` and end `}`.
    if (!(trimmedType.startsWith("{") && trimmedType.endsWith("}"))) return false
    if (!this.isSingleBalancedObjectLiteral(trimmedType)) return false

    const inner = trimmedType.slice(1, -1)

    for (const member of this.splitTopLevelTypeMembers(inner)) {
      const colonIndex = this.topLevelColonIndex(member)

      // No top-level colon: a call/construct/mapped signature or malformed member —
      // can't confirm it's optional, so treat the type as not empty-defaultable.
      if (colonIndex < 0) return false

      const key = member.slice(0, colonIndex).trim()

      // Index signatures (`[k: string]`) don't require a value; optional props end in `?`.
      // Anything else is a required property, so `{}` would not satisfy the type.
      if (!key.startsWith("[") && !key.endsWith("?")) return false
    }

    return true
  }

  /**
   * Splits the inner body of an object-literal type into its top-level members,
   * respecting nested `{}` / `[]` / `<>` / `()` so field types like `string[] | null`
   * or `{a: b}` aren't split mid-type. Members are separated by `,` or `;`.
   * @param {string} inner - Object-literal body (without the outer braces).
   * @returns {string[]} - Trimmed non-empty top-level members.
   */
  splitTopLevelTypeMembers(inner) {
    const members = []
    let depth = 0
    let start = 0

    for (let index = 0; index < inner.length; index += 1) {
      const character = inner[index]

      if (character === "{" || character === "[" || character === "<" || character === "(") {
        depth += 1
      } else if (character === "}" || character === "]" || character === ">" || character === ")") {
        depth -= 1
      } else if ((character === "," || character === ";") && depth === 0) {
        members.push(inner.slice(start, index))
        start = index + 1
      }
    }

    members.push(inner.slice(start))

    return members.map((member) => member.trim()).filter((member) => member.length > 0)
  }

  /**
   * Index of the first top-level `:` in an object-literal member, ignoring colons
   * nested inside `{}` / `[]` / `<>` / `()` (e.g. an index signature `[k: string]`).
   * @param {string} member - A single object-literal member.
   * @returns {number} - The colon index, or -1 when none is found at the top level.
   */
  topLevelColonIndex(member) {
    let depth = 0

    for (let index = 0; index < member.length; index += 1) {
      const character = member[index]

      if (character === "{" || character === "[" || character === "<" || character === "(") {
        depth += 1
      } else if (character === "}" || character === "]" || character === ">" || character === ")") {
        depth -= 1
      } else if (character === ":" && depth === 0) {
        return index
      }
    }

    return -1
  }

  /**
   * Whether the type is a single balanced object literal — its leading `{` closes only
   * at the final character. Rejects top-level intersections/unions like `{a?: x} & {b: y}`
   * or `{a?: x} | string` whose brace depth returns to 0 before the end.
   * @param {string} type - A trimmed type string that starts with `{` and ends with `}`.
   * @returns {boolean} - Whether the braces wrap the whole type.
   */
  isSingleBalancedObjectLiteral(type) {
    let depth = 0

    for (let index = 0; index < type.length; index += 1) {
      const character = type[index]

      if (character === "{" || character === "[" || character === "<" || character === "(") {
        depth += 1
      } else if (character === "}" || character === "]" || character === ">" || character === ")") {
        depth -= 1

        // The opening brace balanced before the end, so something follows the literal.
        if (depth === 0 && index < type.length - 1) return false
      }
    }

    return depth === 0
  }

  /**
   * Enriches custom-command metadata by deriving a command's typed args and return
   * type from the backend resource method's `@param`/`@returns` JSDoc when they are
   * not already declared in `resourceConfig`. Precedence: explicit `resourceConfig`
   * `{args, returnType}` wins, then the derived backend-method JSDoc, then the generic
   * default. Model-class identifiers in the derived types are downgraded to `any`
   * because the frontend receives a serialized record, not a model instance, which the
   * consumer hydrates with `Model.instantiateFromResponse(...)`.
   * @param {object} args - Arguments.
   * @param {Record<string, {args: Array<{name: string, type: string}>, returnType: string | null}>} args.commandMetadata - Declared per-command metadata.
   * @param {string[]} args.commandNames - Command method names to resolve.
   * @param {string} args.frontendModelFilePath - Generated frontend model file path.
   * @param {import("../../../../../configuration-types.js").FrontendModelResourceClassType | null | undefined} args.resourceClass - Resource class.
   * @returns {Promise<Record<string, {args: Array<{name: string, type: string}>, returnType: string | null}>>} - Enriched metadata.
   */
  async commandMetadataWithResourceJsDoc({commandMetadata, commandNames, frontendModelFilePath, resourceClass}) {
    if (!resourceClass) return commandMetadata

    /** @type {Record<string, {args: Array<{name: string, type: string}>, returnType: string | null}>} */
    const enriched = {...commandMetadata}

    for (const commandName of commandNames) {
      const declared = commandMetadata[commandName] || {args: [], returnType: null}
      const sourceClassName = this.methodOwnerClassName({methodName: commandName, targetClass: resourceClass})

      if (!sourceClassName) {
        enriched[commandName] = declared

        continue
      }

      let returnType = declared.returnType

      if (!returnType) {
        const jsDocReturnType = await this.resourceMethodReturnTypeDefinition({methodName: commandName, sourceClassName})

        if (jsDocReturnType) {
          returnType = this.frontendResolvableCommandJsDocType({
            frontendModelFilePath,
            importAliases: jsDocReturnType.importAliases,
            jsDocType: this.unwrappedPromiseJsDocType({jsDocType: jsDocReturnType.type}),
            sourceFile: jsDocReturnType.sourceFile
          })
        }
      }

      let args = declared.args

      if (!args || args.length === 0) {
        const jsDocParameters = await this.resourceMethodParameters({methodName: commandName, sourceClassName})
        // Skip object-property tags (`@param {string} args.message`); only the
        // top-level parameters map to method arguments, otherwise the shared
        // `@param {object} args` + property style would emit `name(args, args)`.
        const topLevelParameters = (jsDocParameters || []).filter((parameter) => typeof parameter.name === "string" && !parameter.name.includes("."))

        if (topLevelParameters.length > 0) {
          args = topLevelParameters.map((parameter) => ({
            name: /** @type {string} */ (parameter.name),
            type: this.frontendResolvableCommandJsDocType({
              frontendModelFilePath,
              importAliases: parameter.importAliases,
              jsDocType: parameter.type,
              sourceFile: parameter.sourceFile
            })
          }))
        }
      }

      enriched[commandName] = {args: args || [], returnType: returnType || null}
    }

    return enriched
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
    const returnType = await this.resourceMethodReturnTypeDefinition({methodName, sourceClassName})

    return returnType ? returnType.type : null
  }

  /**
   * Runs resource method return type definition.
   * @param {object} args - Arguments.
   * @param {string} args.methodName - Method name.
   * @param {string} args.sourceClassName - Source class name.
   * @returns {Promise<ResourceMethodReturnType | null>} - JSDoc return type definition when documented.
   */
  async resourceMethodReturnTypeDefinition({methodName, sourceClassName}) {
    const resourceMethodReturnTypes = await this.resourceMethodReturnTypes()
    const returnTypeKey = `${sourceClassName}.${methodName}`

    if (!resourceMethodReturnTypes.has(returnTypeKey)) return null

    const returnType = resourceMethodReturnTypes.get(returnTypeKey)

    if (!returnType) {
      throw new Error(`Expected JSDoc return type for ${returnTypeKey}`)
    }

    if (typeof returnType.type != "string" || returnType.type.length < 1) {
      throw new Error(`Expected non-empty JSDoc return type for ${returnTypeKey}`)
    }

    return returnType
  }

  /**
   * Runs resource method parameter type.
   * @param {{methodName: string, parameterIndex: number, sourceClassName: string}} args - Arguments.
   * @returns {Promise<string | null>} - JSDoc parameter type when documented.
   */
  async resourceMethodParameterType({methodName, parameterIndex, sourceClassName}) {
    const parameters = await this.resourceMethodParameters({methodName, sourceClassName})

    if (!parameters) return null

    const parameter = parameters[parameterIndex]

    if (parameter === undefined) return null

    if (parameter.type.length < 1) {
      throw new Error(`Expected non-empty JSDoc parameter type for ${sourceClassName}.${methodName} parameter ${parameterIndex}`)
    }

    return parameter.type
  }

  /**
   * Runs resource method parameters.
   * @param {{methodName: string, sourceClassName: string}} args - Arguments.
   * @returns {Promise<ResourceMethodParameterType[] | null>} - JSDoc parameters (name + type) when documented.
   */
  async resourceMethodParameters({methodName, sourceClassName}) {
    const resourceMethodParameterTypes = await this.resourceMethodParameterTypes()
    const parameterTypesKey = `${sourceClassName}.${methodName}`

    if (!resourceMethodParameterTypes.has(parameterTypesKey)) return null

    const parameters = resourceMethodParameterTypes.get(parameterTypesKey)

    if (!parameters) {
      throw new Error(`Expected JSDoc parameters for ${parameterTypesKey}`)
    }

    return parameters
  }

  /**
   * Runs resource method return types.
   * @returns {Promise<Map<string, ResourceMethodReturnType>>} - Resource method return types keyed by ClassName.methodName.
   */
  async resourceMethodReturnTypes() {
    if (this._resourceMethodReturnTypes) return this._resourceMethodReturnTypes

    const sourceFiles = await this.frontendModelJsDocSourceFiles()
    const returnTypes = new Map()

    for (const sourceFile of sourceFiles) {
      const sourceText = await fs.readFile(sourceFile, "utf8")

      this.addResourceMethodReturnTypesFromSource({returnTypes, sourceFile, sourceText})
    }

    this._resourceMethodReturnTypes = returnTypes

    return returnTypes
  }

  /**
   * Runs resource method parameter types.
   * @returns {Promise<Map<string, ResourceMethodParameterType[]>>} - Resource method parameters keyed by ClassName.methodName.
   */
  async resourceMethodParameterTypes() {
    if (this._resourceMethodParameterTypes) return this._resourceMethodParameterTypes

    const sourceFiles = await this.frontendModelJsDocSourceFiles()
    const parameterTypes = new Map()

    for (const sourceFile of sourceFiles) {
      const sourceText = await fs.readFile(sourceFile, "utf8")

      this.addResourceMethodParameterTypesFromSource({parameterTypes, sourceFile, sourceText})
    }

    this._resourceMethodParameterTypes = parameterTypes

    return parameterTypes
  }

  /**
   * Runs frontend model JSDoc source files.
   * @returns {Promise<string[]>} - JavaScript source files that can define frontend-model resources and model accessors.
   */
  async frontendModelJsDocSourceFiles() {
    const sourceFiles = []

    for (const sourceDirectory of this.frontendModelJsDocSourceDirectories()) {
      sourceFiles.push(...await this.javascriptFilesInDirectory(sourceDirectory))
    }

    return sourceFiles
  }

  /**
   * Runs frontend model JSDoc source directories.
   * @returns {string[]} - Source directories to scan for generated frontend-model JSDoc.
   */
  frontendModelJsDocSourceDirectories() {
    const sourceDirectories = new Set([path.join(this.directory(), "src")])

    for (const backendProject of this.getConfiguration().getBackendProjects()) {
      if (typeof backendProject.path == "string" && backendProject.path.length > 0) {
        sourceDirectories.add(path.join(backendProject.path, "src"))
      }
    }

    return Array.from(sourceDirectories)
  }

  /**
   * Adds resource method return types from source.
   * @param {object} args - Arguments.
   * @param {Map<string, ResourceMethodReturnType>} args.returnTypes - Mutable return types map.
   * @param {string | null} [args.sourceFile] - Source file path.
   * @param {string} args.sourceText - Source text.
   * @returns {void}
   */
  addResourceMethodReturnTypesFromSource({returnTypes, sourceFile = null, sourceText}) {
    const classRegex = /class\s+([A-Za-z_$][\w$]*)\s+(?:extends\s+[^{]+)?\{/g
    const importAliases = this.jsDocImportAliasesFromSource(sourceText)
    let classMatch

    while ((classMatch = classRegex.exec(sourceText))) {
      const className = classMatch[1]
      const classBodyStart = classRegex.lastIndex
      const classBodyEnd = this.matchingBraceIndex({openIndex: classBodyStart - 1, sourceText})

      if (classBodyEnd == null) {
        // The brace matcher can't tokenize every construct (e.g. a regex literal
        // whose quotes look like string delimiters), so it can fail to locate a
        // class body. Skip metadata extraction for that class rather than
        // aborting the whole frontend-model generation; resources that parse
        // cleanly still get their JSDoc-derived return/param types.
        continue
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
          returnTypes.set(`${className}.${methodName}`, {importAliases, sourceFile, type: returnType})
        }
      }

      classRegex.lastIndex = classBodyEnd + 1
    }
  }

  /**
   * Adds resource method parameter types from source.
   * @param {{parameterTypes: Map<string, ResourceMethodParameterType[]>, sourceFile?: string | null, sourceText: string}} args - Arguments.
   * @returns {void}
   */
  addResourceMethodParameterTypesFromSource({parameterTypes, sourceFile = null, sourceText}) {
    const classRegex = /class\s+([A-Za-z_$][\w$]*)\s+(?:extends\s+[^{]+)?\{/g
    const importAliases = this.jsDocImportAliasesFromSource(sourceText)
    let classMatch

    while ((classMatch = classRegex.exec(sourceText))) {
      const className = classMatch[1]
      const classBodyStart = classRegex.lastIndex
      const classBodyEnd = this.matchingBraceIndex({openIndex: classBodyStart - 1, sourceText})

      if (classBodyEnd == null) {
        // The brace matcher can't tokenize every construct (e.g. a regex literal
        // whose quotes look like string delimiters), so it can fail to locate a
        // class body. Skip metadata extraction for that class rather than
        // aborting the whole frontend-model generation; resources that parse
        // cleanly still get their JSDoc-derived return/param types.
        continue
      }

      const classBody = sourceText.slice(classBodyStart, classBodyEnd)
      const jsDocRegex = /\/\*\*([\s\S]*?)\*\//g
      let jsDocMatch

      while ((jsDocMatch = jsDocRegex.exec(classBody))) {
        const sourceAfterJsDoc = classBody.slice(jsDocRegex.lastIndex)
        const methodMatch = sourceAfterJsDoc.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/)

        if (!methodMatch) continue

        const methodName = methodMatch[1]
        const jsDocParameters = this.jsDocParameters(jsDocMatch[1])

        if (jsDocParameters.length > 0) {
          parameterTypes.set(`${className}.${methodName}`, jsDocParameters.map((parameter) => ({...parameter, importAliases, sourceFile})))
        }
      }

      classRegex.lastIndex = classBodyEnd + 1
    }
  }

  /**
   * Runs JSDoc import aliases from source.
   * @param {string} sourceText - Source text.
   * @returns {Map<string, ResourceJsDocImportAlias>} - Import aliases keyed by local name.
   */
  jsDocImportAliasesFromSource(sourceText) {
    const importAliases = new Map()
    const importRegex = /@import\s*\{\s*([^}]+?)\s*\}\s*from\s*["']([^"']+)["']/g
    let importMatch

    while ((importMatch = importRegex.exec(sourceText))) {
      const importList = importMatch[1]
      const specifier = importMatch[2]

      for (const rawImportEntry of importList.split(",")) {
        const importEntry = rawImportEntry.trim()

        if (importEntry.length < 1) continue

        const entryMatch = importEntry.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/)

        if (!entryMatch) {
          throw new Error(`Could not parse JSDoc @import entry: ${importEntry}`)
        }

        const importedName = entryMatch[1]
        const aliasName = entryMatch[2] || importedName

        importAliases.set(aliasName, {importedName, specifier})
      }
    }

    return importAliases
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

    const returnType = this.normalizeJsDocType(jsDocText.slice(typeOpenIndex + 1, typeCloseIndex))

    if (returnType.length < 1) {
      throw new Error(`Expected non-empty JSDoc return type in: ${jsDocText}`)
    }

    return returnType
  }

  /**
   * Collapses a JSDoc type spanning multiple comment lines into a single line so it can
   * be emitted into an inline type-assertion cast. A multiline backend return type keeps
   * its leading continuation asterisks in the captured substring, which are invalid inside
   * an inline cast and make TypeScript read the asserted type as `undefined`.
   * @param {string} jsDocType - Raw captured JSDoc type, possibly multiline.
   * @returns {string} - Single-line JSDoc type.
   */
  normalizeJsDocType(jsDocType) {
    return jsDocType.replace(/\s*\n\s*\*?[ \t]*/g, " ").trim()
  }

  /**
   * Runs js doc parameters.
   * @param {string} jsDocText - JSDoc text inside comment markers.
   * @returns {Array<{name: string | null, type: string}>} - JSDoc parameters (name + type) in declaration order.
   */
  jsDocParameters(jsDocText) {
    const parameters = []
    const paramRegex = /@param\s*\{/g
    let _paramMatch

    while ((_paramMatch = paramRegex.exec(jsDocText))) {
      const typeOpenIndex = paramRegex.lastIndex - 1
      const typeCloseIndex = this.matchingBraceIndex({openIndex: typeOpenIndex, sourceText: jsDocText})

      if (typeCloseIndex == null) {
        throw new Error(`Could not parse JSDoc parameter type from: ${jsDocText}`)
      }

      const type = this.normalizeJsDocType(jsDocText.slice(typeOpenIndex + 1, typeCloseIndex))

      if (type.length < 1) {
        throw new Error(`Expected non-empty JSDoc parameter type in: ${jsDocText}`)
      }

      // After the closing brace the parameter name follows (optionally bracketed
      // for `@param {type} [name]`). Capture the leading name token — including any
      // dotted path so object-property tags like `@param {string} args.message` stay
      // distinguishable from the top-level `@param {object} args` parameter.
      const nameMatch = jsDocText.slice(typeCloseIndex + 1).match(/^\s*\[?\s*([A-Za-z_$][\w$.]*)/)

      parameters.push({name: nameMatch ? nameMatch[1] : null, type})
      paramRegex.lastIndex = typeCloseIndex + 1
    }

    return parameters
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

    return column ? this.frontendAttributeConfigForColumn({column}) : null
  }

  /**
   * Runs frontend attribute config for column.
   * @param {object} args - Arguments.
   * @param {import("../../../../../database/drivers/base-column.js").default} args.column - Database column.
   * @returns {FrontendAttributeConfig} - Attribute config inferred from the database column.
   */
  frontendAttributeConfigForColumn({column}) {
    const type = column.getType()

    if (typeof type != "string" || type.length < 1) {
      throw new Error(`Expected non-empty column type for frontend model attribute inference, got: ${type}`)
    }

    return {
      null: column.getNull(),
      type
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
    const modelClass = resourceClass ? resourceClass.modelClass() : this.getConfiguration().getModelClass(className)

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
