import BaseCommand from "../../base-command.js"
import fileExists from "../../../utils/file-exists.js"
import fs from "node:fs/promises"
import * as inflection from "inflection"

export default class DbGenerateModel extends BaseCommand {
  async execute() {
    const modelName = this.processArgs[1]
    const modelNameCamelized = inflection.camelize(modelName.replaceAll("-", "_"))
    const date = new Date()
    const modelFileName = `${inflection.dasherize(inflection.underscore(modelName))}.js`
    const velociousPath = await this.getEnvironmentHandler().getVelociousPath()
    const templateFilePath = `${velociousPath}/src/templates/generate-model.js`
    const modelContentBuffer = await fs.readFile(templateFilePath)
    const modelContent = modelContentBuffer.toString().replaceAll("__MODEL_NAME__", modelNameCamelized)
    const modelsDir = `${process.cwd()}/src/models`
    const modelPath = `${modelsDir}/${modelFileName}`

    if (await fileExists(modelPath)) throw new Error(`Model file already exists: ${modelPath}`)

    if (this.args.testing) {
      return {date, modelContent, modelName, modelNameCamelized, modelPath}
    } else {
      if (!await fileExists(modelsDir)) {
        await fs.mkdir(modelsDir, {recursive: true})
      }

      await fs.writeFile(modelPath, modelContent)

      console.log(`create src/models/${modelFileName}`)
    }
  }
}
