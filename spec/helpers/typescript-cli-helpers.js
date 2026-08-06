// @ts-check

import {execFile} from "node:child_process"
import path from "node:path"
import {promisify} from "node:util"

/**
 * @typedef {object} TypeScriptCliDiagnostic
 * @property {number} code - TypeScript diagnostic code.
 * @property {{fileName: string} | undefined} file - Source file associated with the diagnostic.
 * @property {string} messageText - Flattened diagnostic message.
 */

const execFileAsync = promisify(execFile)
const TYPESCRIPT_CLI_PATH = path.resolve(import.meta.dirname, "../../node_modules/typescript/bin/tsc")

/**
 * Typechecks JavaScript source files through the supported TypeScript CLI.
 * @param {Array<string>} sourcePaths - Entry points to typecheck.
 * @returns {Promise<Array<TypeScriptCliDiagnostic>>} - Parsed CLI diagnostics.
 */
export async function typescriptCliDiagnostics(sourcePaths) {
  let output

  try {
    const result = await execFileAsync(process.execPath, [
      TYPESCRIPT_CLI_PATH,
      "--allowJs",
      "--checkJs",
      "--ignoreConfig",
      "--module", "nodenext",
      "--moduleResolution", "nodenext",
      "--noEmit",
      "--target", "es2024",
      "--types", "node",
      ...sourcePaths
    ])
    output = `${result.stdout}${result.stderr}`
  } catch (error) {
    const cliError = /** @type {{code?: number, stdout?: string, stderr?: string}} */ (error)

    if (typeof cliError.code != "number") throw error

    output = `${cliError.stdout || ""}${cliError.stderr || ""}`
  }

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*)\(\d+,\d+\): error TS(\d+): (.*)$/)

      if (match) return {code: Number(match[2]), file: {fileName: path.resolve(match[1])}, messageText: match[3]}

      const globalMatch = line.match(/^error TS(\d+): (.*)$/)

      return {code: Number(globalMatch?.[1] || 0), file: undefined, messageText: globalMatch?.[2] || line}
    })
}
