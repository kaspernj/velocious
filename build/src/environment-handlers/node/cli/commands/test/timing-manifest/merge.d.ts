import BaseCommand from "../../../../../../cli/base-command.js";
export type TimingManifestMergeArguments = {
    /**
     * - Rich profile input paths.
     */
    inputPaths: string[];
    /**
     * - Plain timing manifest output path.
     */
    outputPath: string;
};
/**
 * @typedef {object} TimingManifestMergeArguments
 * @property {string[]} inputPaths - Rich profile input paths.
 * @property {string} outputPath - Plain timing manifest output path.
 */
/** Node implementation for timing-manifest aggregation. */
export default class TestTimingManifestMerge extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<Record<string, number>>} - Complete merged timing manifest.
     */
    execute(): Promise<Record<string, number>>;
}
/**
 * Parses strict merge arguments and resolves their paths.
 * @param {string[]} processArgs - Raw CLI arguments, including command name.
 * @param {string} cwd - Command working directory.
 * @returns {TimingManifestMergeArguments} - Validated resolved paths.
 */
export declare function parseTimingManifestMergeArguments(processArgs: string[], cwd: string): TimingManifestMergeArguments;
//# sourceMappingURL=merge.d.ts.map