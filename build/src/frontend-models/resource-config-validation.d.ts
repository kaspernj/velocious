/**
 * Runs the validateFrontendModelResourceCommandName helper.
 * @param {object} args - Args.
 * @param {string} args.commandName - Command name candidate.
 * @param {string} args.modelName - Model class name.
 * @param {string} args.commandType - Command type key.
 * @returns {string} - Validated command name.
 */
export declare function validateFrontendModelResourceCommandName({ commandName, modelName, commandType }: {
    commandName: string;
    modelName: string;
    commandType: string;
}): string;
/**
 * Runs the validateFrontendModelResourcePath helper.
 * @param {object} args - Args.
 * @param {string} args.resourcePath - Resource path candidate.
 * @param {string} args.modelName - Model class name.
 * @returns {string} - Validated resource path.
 */
export declare function validateFrontendModelResourcePath({ resourcePath, modelName }: {
    resourcePath: string;
    modelName: string;
}): string;
//# sourceMappingURL=resource-config-validation.d.ts.map