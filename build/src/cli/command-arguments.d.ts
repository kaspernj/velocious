export type CommandArgumentDefinition = {
    /**
     * - Flags that do not accept a value.
     */
    booleanOptions?: string[];
    /**
     * - Flags that require one value.
     */
    valueOptions?: string[];
};
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
export default function commandArguments({ definition, processArgs }: {
    definition: CommandArgumentDefinition;
    processArgs: string[];
}): Record<string, string | boolean>;
//# sourceMappingURL=command-arguments.d.ts.map