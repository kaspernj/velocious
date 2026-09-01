// @ts-check

import { migrationExecutionPhase } from "../database/migration-execution-phase.js"

/**
 * Reads an optional `--phase` value from one command's raw arguments.
 * @param {string[]} processArgs - Raw command arguments including the command name.
 * @returns {import("../database/migration-execution-phase.js").MigrationExecutionPhase | undefined} - Selected phase.
 */
export default function migrationExecutionPhaseArgument(processArgs) {
  const phaseArgumentIndex = processArgs.indexOf("--phase")

  if (phaseArgumentIndex < 0) return undefined

  const phase = processArgs[phaseArgumentIndex + 1]

  if (!phase || phase.startsWith("-")) throw new Error("Missing value for --phase")

  return migrationExecutionPhase(phase)
}
