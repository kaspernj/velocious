/**
 * Creates a sorted plain timing manifest.
 * @param {ReturnType<typeof JSON.parse>} profile - Rich profile document.
 * @returns {Record<string, number>} - Sorted file-duration map.
 */
export declare function timingManifestFromProfile(profile: ReturnType<typeof JSON.parse>): Record<string, number>;
/**
 * Atomically writes a canonical splitter-compatible timing manifest.
 * @param {object} args - Output arguments.
 * @param {string} args.outputPath - Final output path.
 * @param {Record<string, number>} args.timingManifest - Validated or candidate timing manifest.
 * @returns {Promise<void>} - Resolves after atomic replacement.
 */
export declare function writeTimingManifest({ outputPath, timingManifest }: {
    outputPath: string;
    timingManifest: Record<string, number>;
}): Promise<void>;
/**
 * Atomically writes requested test profile outputs.
 * @param {object} args - Output options.
 * @param {ReturnType<typeof JSON.parse>} args.profile - Rich profile document.
 * @param {string} [args.profileJsonPath] - Rich JSON path.
 * @param {string} [args.timingManifestOutputPath] - Plain timing manifest path.
 * @returns {Promise<void>} - Resolves after all requested writes.
 */
export declare function writeTestProfileOutputs({ profile, profileJsonPath, timingManifestOutputPath }: {
    profile: ReturnType<typeof JSON.parse>;
    profileJsonPath?: string;
    timingManifestOutputPath?: string;
}): Promise<void>;
/**
 * Formats a compact Benchmark-style console summary.
 * @param {ReturnType<typeof JSON.parse>} profile - Rich profile document.
 * @param {{profileJsonPath?: string, timingManifestOutputPath?: string}} [outputs] - Written output paths.
 * @returns {string} - Console summary.
 */
export declare function formatTestProfileSummary(profile: ReturnType<typeof JSON.parse>, outputs?: {
    profileJsonPath?: string;
    timingManifestOutputPath?: string;
}): string;
//# sourceMappingURL=test-profile-output.d.ts.map