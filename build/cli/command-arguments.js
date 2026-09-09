// @ts-check

/**
 * @typedef {object} CommandArgumentDefinition
 * @property {string[]} [booleanOptions] - Flags that do not accept a value.
 * @property {string[]} [valueOptions] - Flags that require one value.
 */

/**
 * Parses and validates one command's arguments.
 * @param {object} args - Parser arguments.
 * @param {CommandArgumentDefinition} args.definition - Accepted command options.
 * @param {string[]} args.processArgs - Raw command arguments including the command name.
 * @returns {Record<string, string | boolean>} - Values keyed by long option name without `--`.
 */
export default function commandArguments({definition, processArgs}) {
  const commandName = processArgs[0] || "command"
  const booleanOptions = new Set(definition.booleanOptions || [])
  const valueOptions = new Set(definition.valueOptions || [])
  /** @type {Record<string, string | boolean>} */
  const parsed = {}

  for (let index = 1; index < processArgs.length; index++) {
    const argument = processArgs[index]

    if (booleanOptions.has(argument)) {
      parsed[argument.slice(2)] = true
      continue
    }

    if (valueOptions.has(argument)) {
      const value = processArgs[index + 1]

      if (!value || value.startsWith("-")) throw new Error(`Missing value for ${argument}`)

      parsed[argument.slice(2)] = value
      index++
      continue
    }

    throw new Error(`Unknown argument for ${commandName}: ${argument}`)
  }

  return parsed
}
