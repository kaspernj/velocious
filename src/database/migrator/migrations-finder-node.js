import fs from "fs/promises"
import * as inflection from "inflection"
import path from "path"
import restArgsError from "../../utils/rest-args-error.js"

/**
 * @returns {Promise<Array<{name: string, file: string}>>}
 */
export default async function migrationsFinderNode({args, configuration, ...restArgs}) {
  restArgsError(restArgs)

  const migrationsPath = `${configuration.getDirectory()}/src/database/migrations`
  const glob = await fs.glob(`${migrationsPath}/**/*.js`)
  const files = []

  for await (const fullPath of glob) {
    const file = await path.basename(fullPath)

    files.push(file)
  }

  const migrationFiles = files
    .map((file) => {
      const match = file.match(/^(\d{14})-(.+)\.js$/)

      if (!match) return null

      const date = parseInt(match[1])
      const migrationName = match[2]
      const migrationClassName = inflection.camelize(migrationName.replaceAll("-", "_"))

      return {
        file,
        fullPath: `${migrationsPath}/${file}`,
        date,
        migrationClassName
      }
    })
    .filter((migration) => Boolean(migration))
    .sort((migration1, migration2) => migration1.date - migration2.date)

  return migrationFiles
}
