/**
 * CliCommandContext type.
 * @typedef {object} CliCommandContext
 * @property {import("../../../../configuration.js").default} configuration - Configuration instance.
 * @property {import("../../../../database/drivers/base.js").default | undefined} db - Default database connection.
 * @property {Record<string, import("../../../../database/drivers/base.js").default>} dbs - Database connections keyed by identifier.
 * @property {string[]} args - CLI args after command-specific leading arguments.
 */

/**
 * Runs build cli command context.
 * @param {import("../../../../cli/base-command.js").default} command - Command building the context.
 * @param {number} argsOffset - Number of process args to omit.
 * @returns {CliCommandContext} - Runtime context passed to CLI command scripts.
 */
export default function buildCliCommandContext(command, argsOffset) {
  const configuration = command.getConfiguration()
  const dbs = configuration.getCurrentConnections()
  const identifiers = Object.keys(dbs)
  /**
 * Process args.
 * @type {string[]} */
  const processArgs = command.processArgs || []

  return {
    configuration,
    db: dbs.default || (identifiers.length > 0 ? dbs[identifiers[0]] : undefined),
    dbs,
    args: processArgs.slice(argsOffset)
  }
}
