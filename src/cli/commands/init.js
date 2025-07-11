import BaseCommand from "../base-command.js"
import {dirname} from "path"
import fileExists from "../../utils/file-exists.js"
import {fileURLToPath} from "url"
import fs from "node:fs/promises"

export default class VelociousCliCommandsInit extends BaseCommand {
  async execute() {
    const __filename = fileURLToPath(`${import.meta.url}/../../..`)
    const velocipusPath = dirname(__filename)
    const projectPath = this.configuration?.getDirectory() || process.cwd()
    const projectConfigPath = `${projectPath}/src/config`
    const fileMappings = [
      {
        source: `${velocipusPath}/src/templates/configuration.js`,
        target: `${projectConfigPath}/configuration.js`
      },
      {
        source: `${velocipusPath}/src/templates/routes.js`,
        target: `${projectConfigPath}/routes.js`
      }
    ]
    const paths = [
      projectConfigPath,
      `${projectPath}/src/database/migrations`,
      `${projectPath}/src/models`,
      `${projectPath}/src/routes`
    ]

    if (this.args.testing) {
      return {
        fileMappings
      }
    }

    for (const path of paths) {
      if (await fileExists(path)) {
        console.log(`Config dir already exists: ${path}`)
      } else {
        console.log(`Config dir doesn't exists: ${path}`)
        await fs.mkdir(path, {recursive: true})
      }
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

const dontLoadConfiguration = true

export {dontLoadConfiguration}
