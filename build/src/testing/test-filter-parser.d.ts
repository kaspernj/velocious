/**
 * ParseFiltersResult type.
 * @typedef {object} ParseFiltersResult
 * @property {string[]} includeTags - Tags to include.
 * @property {string[]} excludeTags - Tags to exclude.
 * @property {string[]} examplePatterns - Example name patterns.
 * @property {string[]} filteredProcessArgs - Remaining process args with filter flags removed.
 * @property {number | undefined} groups - Total number of groups for test splitting.
 * @property {number | undefined} groupNumber - Which group to run (1-indexed).
 * @property {boolean} profile - Whether test profiling is enabled.
 * @property {string | undefined} profileJsonPath - Rich profile output path.
 * @property {string | undefined} timingManifestPath - JSON timing manifest path.
 * @property {string | undefined} timingManifestOutputPath - Timing manifest output path.
 */
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
     * - Remaining process args with filter flags removed.
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
};
/**
 * Runs the normalizeExamplePatterns helper.
 * @param {string[]} patterns - Patterns.
 * @returns {RegExp[]} - Normalized patterns.
 */
export declare function normalizeExamplePatterns(patterns: string[]): RegExp[];
/**
 * Runs the parseFilters helper.
 * @param {string[]} processArgs - Process args.
 * @returns {ParseFiltersResult} - Parsed tags, group options, and process args.
 */
export declare function parseFilters(processArgs: string[]): ParseFiltersResult;
//# sourceMappingURL=test-filter-parser.d.ts.map