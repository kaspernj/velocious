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

      fileContent += `export default class ${modelNameCamelized} extends Record {\n`

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

      fileContent += "}\n"

      await fs.writeFile(modelPath, fileContent)
    }
  }
}
