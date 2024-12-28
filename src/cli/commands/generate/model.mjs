import BaseCommand from "../../base-command.mjs"
import {dirname} from "path"
import {fileURLToPath} from "url"
import fileExists from "../../../utils/file-exists.mjs"
import fs from "node:fs/promises"
import inflection from "inflection"

export default class DbGenerateModel extends BaseCommand {
  async execute() {
    const modelName = this.processArgs[1]
    const modelNameCamelized = inflection.camelize(modelName.replaceAll("-", "_"))
    const date = new Date()
    const modelFileName = `${inflection.dasherize(inflection.underscore(modelName))}.mjs`
    const __filename = fileURLToPath(`${import.meta.url}/../../..`)
    const __dirname = dirname(__filename)
    const templateFilePath = `${__dirname}/templates/generate-model.mjs`
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
