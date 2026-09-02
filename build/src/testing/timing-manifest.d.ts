export type TimingManifest = Record<string, number>;
export type ValidatedProfileShard = {
    /**
     * - Complete pre-shard file count.
     */
    discoveredFileCount: number;
    /**
     * - Selected post-shard file count.
     */
    fileCount: number;
    /**
     * - One-indexed shard number.
     */
    groupNumber: number;
    /**
     * - Complete shard count.
     */
    groups: number;
    /**
     * - Profiling path-base semantics.
     */
    pathBase: string;
    /**
     * - Complete canonical file-set identity.
     */
    testFileSetHash: string;
    /**
     * - Canonical shard timing map.
     */
    timingManifest: TimingManifest;
};
export type TestProfileTimingManifestInput = {
    /**
     * - Parsed rich test profile.
     */
    profile: ReturnType<typeof JSON.parse>;
    /**
     * - Human-readable input source for validation errors.
     */
    source: string;
};
/** @typedef {Record<string, number>} TimingManifest */
/**
 * ValidatedProfileShard type.
 * @typedef {object} ValidatedProfileShard
 * @property {number} discoveredFileCount - Complete pre-shard file count.
 * @property {number} fileCount - Selected post-shard file count.
 * @property {number} groupNumber - One-indexed shard number.
 * @property {number} groups - Complete shard count.
 * @property {string} pathBase - Profiling path-base semantics.
 * @property {string} testFileSetHash - Complete canonical file-set identity.
 * @property {TimingManifest} timingManifest - Canonical shard timing map.
 */
/**
 * TestProfileTimingManifestInput type.
 * @typedef {object} TestProfileTimingManifestInput
 * @property {ReturnType<typeof JSON.parse>} profile - Parsed rich test profile.
 * @property {string} source - Human-readable input source for validation errors.
 */
/**
 * Canonicalizes a timing-manifest path relative to its profiling base.
 * @param {string} filePath - Candidate relative path.
 * @returns {string} - Portable canonical path.
 */
export declare function canonicalTimingManifestPath(filePath: string): string;
/**
 * Compares timing-manifest paths by JavaScript code units without locale rules.
 * @param {string} filePathA - First path.
 * @param {string} filePathB - Second path.
 * @returns {number} - Negative, zero, or positive ordering result.
 */
export declare function compareTimingManifestPaths(filePathA: string, filePathB: string): number;
/**
 * Validates and sorts a plain timing manifest.
 * @param {ReturnType<typeof JSON.parse>} timingManifest - Parsed timing manifest.
 * @param {{source?: string}} [options] - Validation context.
 * @returns {TimingManifest} - Canonical sorted timing manifest.
 */
export declare function validateTimingManifest(timingManifest: ReturnType<typeof JSON.parse>, { source }?: {
    source?: string;
}): TimingManifest;
/**
 * Returns an opaque deterministic identity for a complete canonical test-file set.
 * @param {string[]} filePaths - Paths relative to one profiling base.
 * @returns {string} - SHA-256 file-set identity.
 */
export declare function timingManifestFileSetHash(filePaths: string[]): string;
/**
 * Merges a complete compatible set of rich Velocious shard profiles.
 * @param {TestProfileTimingManifestInput[]} inputs - Parsed profile documents and sources.
 * @returns {TimingManifest} - Complete sorted plain timing manifest.
 */
export declare function mergeTestProfileTimingManifests(inputs: TestProfileTimingManifestInput[]): TimingManifest;
//# sourceMappingURL=timing-manifest.d.ts.map