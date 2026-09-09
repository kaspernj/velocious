import BaseCommand from "../../../../../cli/base-command.js";
export type DbGenerateModelResult = {
    date: Date;
    modelContent: string;
    modelName: string;
    modelNameCamelized: string;
    modelPath: string;
};
/**
 * DbGenerateModel class.
 * @typedef {{date: Date, modelContent: string, modelName: string, modelNameCamelized: string, modelPath: string}} DbGenerateModelResult
 */
export default class DbGenerateModel extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void | DbGenerateModelResult>} - Resolves with the execute.
     */
    execute(): Promise<void | DbGenerateModelResult>;
}
//# sourceMappingURL=model.d.ts.map