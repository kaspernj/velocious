import BaseCommand from "../base-command.mjs"
import {digg} from "diggerize"
import {dirname} from "path"
import fileExists from "../../utils/file-exists.mjs"
import {fileURLToPath} from "url"
import fs from "node:fs/promises"

export default class VelociousCliCommandsInit extends BaseCommand {
  async execute() {
    const __filename = fileURLToPath(`${import.meta.url}/../../..`)
    const velocipusPath = dirname(__filename)
    const projectPath = digg(this.configuration, "directory")
    const configPath = `${velocipusPath}/src/config`
    const fileMappings = [
      {
        source: `${velocipusPath}/src/templates/configuration.mjs`,
        target: `${projectPath}/src/config/configuration.mjs`
      },
      {
        source: `${velocipusPath}/src/templates/routes.mjs`,
        target: `${projectPath}/src/config/routes.mjs`
      }
    ]

    if (this.args.testing) {
      return {
        fileMappings
      }
    }

    if (await fileExists(configPath)) {
      console.log(`Config dir already exists: ${configPath}`)
    } else {
      console.log(`Config dir doesn't exists: ${configPath}`)
      await fs.mkdir(configPath, {recursive: true})
    }

    for (const fileMapping of fileMappings) {
      if (!await fileExists(fileMapping.source)) {
        throw new Error(`Template doesn't exist: ${fileMapping.source}`)
      }

      if (await fileExists(fileMapping.target)) {
        console.log(`File already exists: ${fileMapping.target}`)
      } else {
        console.log(`File doesnt exist: ${fileMapping.target}`)
        await fs.copyFile(fileMapping.source, fileMapping.target)
      }
    }
  }
}
