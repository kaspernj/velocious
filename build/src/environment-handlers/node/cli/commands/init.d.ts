import BaseCommand from "../../../../cli/base-command.js";
export type FileMappingType = {
    source: string;
    target: string;
};
/**
 * VelociousCliCommandsInit class.
 * @typedef {{source: string, target: string}} FileMappingType
 */
export default class VelociousCliCommandsInit extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void | {fileMappings: FileMappingType[]}>} - Resolves with generated file mappings, if any.
     */
    execute(): Promise<void | {
        fileMappings: FileMappingType[];
    }>;
}
declare const dontLoadConfiguration = true;
export { dontLoadConfiguration };
//# sourceMappingURL=init.d.ts.map