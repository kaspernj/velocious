import { normalizeExamplePatterns } from "@velocious/testing/node";
export type ParseFiltersResult = {
    /**
     * - Tags to include.
     */
    includeTags: string[];
    /**
     * - Tags to exclude.
     */
    excludeTags: string[];
    /**
     * - Example name patterns.
     */
    examplePatterns: string[];
    /**
     * - Remaining process args with package-owned flags removed.
     */
    filteredProcessArgs: string[];
    /**
     * - Total number of groups for test splitting.
     */
    groups: number | undefined;
    /**
     * - Which group to run (1-indexed).
     */
    groupNumber: number | undefined;
    /**
     * - Whether test profiling is enabled.
     */
    profile: boolean;
    /**
     * - Rich profile output path.
     */
    profileJsonPath: string | undefined;
    /**
     * - JSON timing manifest path.
     */
    timingManifestPath: string | undefined;
    /**
     * - Timing manifest output path.
     */
    timingManifestOutputPath: string | undefined;
    /**
     * - Default retry count.
     */
    retries: number | undefined;
    /**
     * - Setup files imported before test files.
     */
    setupFiles: string[];
    /**
     * - Default lifecycle timeout.
     */
    timeoutMs: number | undefined;
};
/**
 * @typedef {object} ParseFiltersResult
 * @property {string[]} includeTags - Tags to include.
 * @property {string[]} excludeTags - Tags to exclude.
 * @property {string[]} examplePatterns - Example name patterns.
 * @property {string[]} filteredProcessArgs - Remaining process args with package-owned flags removed.
 * @property {number | undefined} groups - Total number of groups for test splitting.
 * @property {number | undefined} groupNumber - Which group to run (1-indexed).
 * @property {boolean} profile - Whether test profiling is enabled.
 * @property {string | undefined} profileJsonPath - Rich profile output path.
 * @property {string | undefined} timingManifestPath - JSON timing manifest path.
 * @property {string | undefined} timingManifestOutputPath - Timing manifest output path.
 * @property {number | undefined} retries - Default retry count.
 * @property {string[]} setupFiles - Setup files imported before test files.
 * @property {number | undefined} timeoutMs - Default lifecycle timeout.
 */
export { normalizeExamplePatterns };
/**
 * Preserves the Velocious parser result while delegating package-owned option parsing.
 * @param {string[]} processArgs - Raw process arguments including the command name.
 * @returns {ParseFiltersResult} - Package options and downstream process arguments.
 */
export declare function parseFilters(processArgs: string[]): ParseFiltersResult;
//# sourceMappingURL=test-filter-parser.d.ts.map