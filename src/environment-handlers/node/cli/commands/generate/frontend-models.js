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

    const rootDirectory = this.directory()
    const frontendModelsDir = `${rootDirectory}/src/frontend-models`
    const devMode = frontendModelsDir.includes("/spec/dummy/src/frontend-models")
    const importPath = devMode ? "../../../../src/frontend-models/base.js" : "velocious/build/src/frontend-models/base.js"

    await fs.mkdir(frontendModelsDir, {recursive: true})

    /** @type {Set<string>} */
    const generatedModelNames = new Set()

    for (const backendProject of backendProjects) {
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
   * @param {object} args - Method args.
   * @param {string} args.className - Model class name.
   * @param {string} args.importPath - Base class import path.
   * @param {Record<string, any>} args.modelConfig - Model configuration.
   * @returns {string} - Generated file content.
   */
  buildModelFileContent({className, importPath, modelConfig}) {
    const attributes = this.attributeNamesForModel(modelConfig)
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

    fileContent += `import FrontendModelBase from "${importPath}"\n\n`
    fileContent += "/**\n"
    fileContent += ` * @typedef {object} ${attributesTypeName}\n`
    for (const attributeName of attributes) {
      fileContent += ` * @property {unknown} ${attributeName} - Attribute value.\n`
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
}
