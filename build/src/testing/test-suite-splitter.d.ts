export type SplitterFileEntry = {
    /**
     * - Absolute file path.
     */
    filePath: string;
    /**
     * - Computed weight for load balancing.
     */
    weight: number;
};
export type GroupBucket = {
    /**
     * - Accumulated weight.
     */
    totalWeight: number;
    /**
     * - Files assigned to this group.
     */
    files: string[];
};
/**
 * Splits a list of test files into balanced groups using a greedy load-balancing algorithm.
 * Modeled after test_suite_splitter for RSpec.
 */
export default class TestSuiteSplitter {
    _groups: number;
    _groupNumber: number;
    _testFiles: string[];
    _baseDirectory: string;
    _timingManifest: Record<string, number>;
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {number} args.groups - Total number of groups.
     * @param {number} args.groupNumber - Which group to return (1-indexed).
     * @param {string[]} args.testFiles - All discovered test file paths.
     * @param {string} [args.baseDirectory] - Base directory for relative path computation.
     * @param {ReturnType<typeof JSON.parse>} [args.timingManifest] - Relative test paths mapped to durations.
     */
    constructor({ groups, groupNumber, testFiles, baseDirectory, timingManifest, ...restArgs }: {
        groups: number;
        groupNumber: number;
        testFiles: string[];
        baseDirectory?: string;
        timingManifest?: ReturnType<typeof JSON.parse>;
    });
    /**
     * Returns the test files assigned to this group.
     * @returns {string[]} - File paths for the requested group.
     */
    getGroupFiles(): string[];
    /**
     * Computes weight for each test file based on directory type and file suffix.
     * @returns {SplitterFileEntry[]} - Weighted file entries.
     */
    computeWeightedFiles(): SplitterFileEntry[];
    /**
     * Computes the weight for a single file.
     * @param {string} filePath - Absolute file path.
     * @returns {number} - Weight value.
     */
    computeWeight(filePath: string): number;
    /**
     * Keeps only usable positive finite duration entries keyed by normalized relative path.
     * @param {ReturnType<typeof JSON.parse>} timingManifest - Parsed timing manifest.
     * @returns {Record<string, number>} - Valid normalized duration weights.
     */
    normalizeTimingManifest(timingManifest: ReturnType<typeof JSON.parse>): Record<string, number>;
    /**
     * Normalizes a relative test path to the manifest's portable slash format.
     * @param {string} filePath - Relative test path.
     * @returns {string} - Normalized relative test path.
     */
    normalizeRelativePath(filePath: string): string;
    /**
     * Returns the permissive relative path used only for heuristic classification.
     * @param {string} filePath - Absolute test file path.
     * @returns {string} - Portable relative path which may escape the profiling base.
     */
    heuristicRelativePath(filePath: string): string;
    /**
     * Returns a canonical manifest key when the file is representable under the profiling base.
     * @param {string} filePath - Absolute test file path.
     * @returns {string | undefined} - Canonical relative path, or undefined for an external file.
     */
    manifestRelativePath(filePath: string): string | undefined;
    /**
     * Returns the first manifest entry matching a discovered test file.
     * @param {string} filePath - Absolute test file path.
     * @returns {number | undefined} - Recorded duration, including zero.
     */
    timingManifestDuration(filePath: string): number | undefined;
    /**
     * Returns compatible manifest keys for one discovered file.
     * @param {string} filePath - Absolute test file path.
     * @returns {string[]} - Canonical keys in matching priority order.
     */
    timingManifestPaths(filePath: string): string[];
    /**
     * Summarizes timing-history coverage for the complete discovered suite.
     * @returns {{heuristicFiles: number, measuredFiles: number, staleEntries: number}} - Compact coverage counts.
     */
    getTimingManifestCoverage(): {
        heuristicFiles: number;
        measuredFiles: number;
        staleEntries: number;
    };
    /**
     * Sorts files by weight descending, then by path for determinism.
     * @param {SplitterFileEntry[]} files - Weighted files.
     * @returns {SplitterFileEntry[]} - Sorted files.
     */
    sortByWeightDescending(files: SplitterFileEntry[]): SplitterFileEntry[];
    /**
     * Distributes files greedily into N balanced groups.
     * Each file is assigned to the group with the least accumulated weight.
     * @param {SplitterFileEntry[]} sortedFiles - Files sorted by weight descending.
     * @returns {GroupBucket[]} - Array of group buckets.
     */
    distributeGreedily(sortedFiles: SplitterFileEntry[]): GroupBucket[];
    /**
     * Finds the bucket with the least accumulated weight.
     * Ties are broken by bucket index (earlier bucket wins) for determinism.
     * @param {GroupBucket[]} buckets - Group buckets.
     * @returns {GroupBucket} - The lightest bucket.
     */
    findLightestBucket(buckets: GroupBucket[]): GroupBucket;
}
//# sourceMappingURL=test-suite-splitter.d.ts.map