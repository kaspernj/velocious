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

      for (const modelClassName in resources) {
        const modelConfig = resources[modelClassName]
        const className = inflection.camelize(modelClassName.replaceAll("-", "_"))
        const fileName = `${inflection.dasherize(inflection.underscore(className))}.js`
        const filePath = `${frontendModelsDir}/${fileName}`

        this.validateModelConfig({className, modelConfig})

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
   * @param {string} args.className - Model class name.
   * @param {Record<string, any>} args.modelConfig - Model configuration.
   * @returns {void} - No return value.
   */
  validateModelConfig({className, modelConfig}) {
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

    if (!relationships || typeof relationships !== "object" || Array.isArray(relationships)) {
      throw new Error(`Model '${className}' has invalid relationships config`)
    }

    for (const relationshipName in relationships) {
      const relationship = relationships[relationshipName]

      if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) {
        throw new Error(`Model '${className}' relationship '${relationshipName}' must be an object`)
      }

      const relationshipType = relationship.type

      if (relationshipType !== "belongsTo" && relationshipType !== "hasOne" && relationshipType !== "hasMany") {
        throw new Error(`Model '${className}' relationship '${relationshipName}' has invalid type '${relationshipType}'`)
      }

      const relationshipModelName = relationship.modelClassName || relationship.className || relationship.model

      if (typeof relationshipModelName !== "string" || relationshipModelName.length < 1) {
        throw new Error(`Model '${className}' relationship '${relationshipName}' must define model/className/modelClassName`)
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
    const attributes = this.attributeNamesForModel(modelConfig)
    const relationships = this.relationshipsForModel(modelConfig)
    const attributesTypeName = `${className}Attributes`
    const commands = {
      destroy: modelConfig.commands?.destroy || "destroy",
      find: modelConfig.commands?.find || "find",
      index: modelConfig.commands?.index || "index",
      update: modelConfig.commands?.update || "update"
    }

    if (!modelConfig.path) {
      throw new Error(`Model '${className}' is missing required 'path' config`)
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
    for (const attributeName of attributes) {
      fileContent += ` * @property {any} ${attributeName} - Attribute value.\n`
    }
    fileContent += " */\n"
    fileContent += `/** Frontend model for ${className}. */\n`
    fileContent += `export default class ${className} extends FrontendModelBase {\n`
    fileContent += "  /**\n"
    fileContent += "   * @returns {{attributes: string[], commands: {destroy: string, find: string, index: string, update: string}, path: string, primaryKey: string}} - Resource config.\n"
    fileContent += "   */\n"
    fileContent += "  static resourceConfig() {\n"
    fileContent += "    return {\n"
    fileContent += `      attributes: ${JSON.stringify(attributes)},\n`
    fileContent += `      commands: ${JSON.stringify(commands)},\n`
    fileContent += `      path: ${JSON.stringify(modelConfig.path)},\n`
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

    for (const attributeName of attributes) {
      const camelizedAttribute = inflection.camelize(attributeName, true)
      const camelizedAttributeUpper = inflection.camelize(attributeName)

      fileContent += "\n"
      fileContent += "  /**\n"
      fileContent += `   * @returns {${attributesTypeName}[${JSON.stringify(attributeName)}]} - Attribute value.\n`
      fileContent += "   */\n"
      fileContent += `  ${camelizedAttribute}() { return this.readAttribute(${JSON.stringify(attributeName)}) }\n`

      fileContent += "\n"
      fileContent += "  /**\n"
      fileContent += `   * @param {${attributesTypeName}[${JSON.stringify(attributeName)}]} newValue - New attribute value.\n`
      fileContent += `   * @returns {${attributesTypeName}[${JSON.stringify(attributeName)}]} - Assigned value.\n`
      fileContent += "   */\n"
      fileContent += `  set${camelizedAttributeUpper}(newValue) { return this.setAttribute(${JSON.stringify(attributeName)}, newValue) }\n`
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
   * @param {Record<string, any>} modelConfig - Model configuration.
   * @returns {string[]} - Attribute names.
   */
  attributeNamesForModel(modelConfig) {
    const attributes = modelConfig.attributes

    if (Array.isArray(attributes)) {
      return attributes
    }

    if (!attributes || typeof attributes !== "object") {
      throw new Error(`Expected 'attributes' as array or object but got: ${attributes}`)
    }

    return Object.keys(attributes)
  }

  /**
   * @param {Record<string, any>} modelConfig - Model configuration.
   * @returns {Array<{relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}>} - Relationships.
   */
  relationshipsForModel(modelConfig) {
    const relationships = modelConfig.relationships

    if (!relationships || typeof relationships !== "object" || Array.isArray(relationships)) {
      return []
    }

    /** @type {Array<{relationshipName: string, targetClassName: string, targetFileName: string, type: "belongsTo" | "hasOne" | "hasMany"}>} */
    const normalized = []

    for (const relationshipName in relationships) {
      const relationship = relationships[relationshipName]
      const targetModelName = relationship.modelClassName || relationship.className || relationship.model
      const targetClassName = inflection.camelize(String(targetModelName).replaceAll("-", "_"))

      normalized.push({
        relationshipName,
        targetClassName,
        targetFileName: inflection.dasherize(inflection.underscore(targetClassName)),
        type: relationship.type
      })
    }

    return normalized
  }
}
