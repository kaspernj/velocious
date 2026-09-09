// @ts-check
import sha256Hex from "../utils/sha256-hex.js";
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
export function canonicalTimingManifestPath(filePath) {
    if (typeof filePath !== "string" || filePath.length === 0) {
        throw new Error("Timing manifest keys must be non-empty relative paths");
    }
    const portablePath = filePath.replaceAll("\\", "/");
    if (portablePath.startsWith("/") || /^[A-Za-z]:/.test(portablePath)) {
        throw new Error(`Timing manifest key must be a relative path: ${filePath}`);
    }
    const segments = [];
    for (const segment of portablePath.split("/")) {
        if (!segment || segment === ".")
            continue;
        if (segment === "..") {
            if (segments.length === 0) {
                throw new Error(`Timing manifest key must be a non-escaping relative path: ${filePath}`);
            }
            segments.pop();
            continue;
        }
        segments.push(segment);
    }
    if (segments.length === 0) {
        throw new Error(`Timing manifest key must be a non-empty relative path: ${filePath}`);
    }
    return segments.join("/");
}
/**
 * Compares timing-manifest paths by JavaScript code units without locale rules.
 * @param {string} filePathA - First path.
 * @param {string} filePathB - Second path.
 * @returns {number} - Negative, zero, or positive ordering result.
 */
export function compareTimingManifestPaths(filePathA, filePathB) {
    if (filePathA === filePathB)
        return 0;
    return filePathA < filePathB ? -1 : 1;
}
/**
 * Validates and sorts a plain timing manifest.
 * @param {ReturnType<typeof JSON.parse>} timingManifest - Parsed timing manifest.
 * @param {{source?: string}} [options] - Validation context.
 * @returns {TimingManifest} - Canonical sorted timing manifest.
 */
export function validateTimingManifest(timingManifest, { source = "timing manifest" } = {}) {
    if (!timingManifest || typeof timingManifest !== "object" || Array.isArray(timingManifest)) {
        throw new Error(`${source} must be a plain JSON object mapping relative paths to durations`);
    }
    /** @type {Map<string, {duration: number, originalPath: string}>} */
    const entries = new Map();
    for (const [originalPath, duration] of Object.entries(timingManifest)) {
        if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
            throw new Error(`${source} has an invalid duration for ${originalPath}`);
        }
        const canonicalPath = canonicalTimingManifestPath(originalPath);
        const existing = entries.get(canonicalPath);
        if (existing) {
            throw new Error(`${source} has a normalized path collision between ${existing.originalPath} and ${originalPath}`);
        }
        entries.set(canonicalPath, { duration, originalPath });
    }
    return Object.fromEntries([...entries.entries()]
        .sort(([filePathA], [filePathB]) => compareTimingManifestPaths(filePathA, filePathB))
        .map(([filePath, entry]) => [filePath, entry.duration]));
}
/**
 * Returns an opaque deterministic identity for a complete canonical test-file set.
 * @param {string[]} filePaths - Paths relative to one profiling base.
 * @returns {string} - SHA-256 file-set identity.
 */
export function timingManifestFileSetHash(filePaths) {
    const pathManifest = Object.fromEntries(filePaths.map((filePath) => [filePath, 0]));
    const canonicalPaths = Object.keys(validateTimingManifest(pathManifest, { source: "test file set" }));
    const identity = `velocious.test-file-set.v1\0${canonicalPaths.join("\0")}`;
    return `sha256:${sha256Hex(identity)}`;
}
/**
 * Validates that a parsed JSON value is a non-array object.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate object.
 * @param {string} message - Validation error message.
 * @returns {void}
 */
function assertJsonObject(value, message) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(message);
}
/**
 * Requires unfiltered, non-focused profile selection metadata.
 * @param {ReturnType<typeof JSON.parse>} selection - Rich profile selection.
 * @param {string} source - Input source.
 * @returns {void}
 */
function assertCompleteSelection(selection, source) {
    if (selection.focused !== false)
        throw new Error(`${source} must not be a focused test profile`);
    const selectionFilters = [
        [selection.includeTagCount, 0],
        [selection.excludeTagCount, 0],
        [selection.hasExampleFilters, false],
        [selection.hasLineFilters, false]
    ];
    if (selectionFilters.some(([value, expected]) => value !== expected)) {
        throw new Error(`${source} must not be a filtered test profile`);
    }
}
/**
 * Validates shard numbering metadata.
 * @param {ReturnType<typeof JSON.parse>} shard - Candidate shard selection.
 * @param {string} source - Input source.
 * @returns {{groupNumber: number, groups: number}} - Validated shard numbers.
 */
function validatedShardNumbers(shard, source) {
    assertJsonObject(shard, `${source} is missing shard metadata`);
    if (!Number.isInteger(shard.groups) || shard.groups < 1) {
        throw new Error(`${source} has an invalid shard group count`);
    }
    if (!Number.isInteger(shard.groupNumber) || shard.groupNumber < 1 || shard.groupNumber > shard.groups) {
        throw new Error(`${source} has an invalid shard number`);
    }
    return { groupNumber: shard.groupNumber, groups: shard.groups };
}
/**
 * Validates a non-negative integer selection count.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate count.
 * @param {string} message - Validation error message.
 * @returns {number} - Validated count.
 */
function validatedSelectionCount(value, message) {
    if (!Number.isInteger(value) || value < 0)
        throw new Error(message);
    return value;
}
/**
 * Validates the selection identity used across shard profiles.
 * @param {ReturnType<typeof JSON.parse>} selection - Rich profile selection.
 * @param {string} source - Input source.
 * @returns {{pathBase: string, testFileSetHash: string}} - Validated identity.
 */
function validatedSelectionIdentity(selection, source) {
    if (!["configuration-directory", "test-directory"].includes(selection.pathBase)) {
        throw new Error(`${source} has an invalid timing manifest path base`);
    }
    if (typeof selection.testFileSetHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(selection.testFileSetHash)) {
        throw new Error(`${source} has an invalid test file set identity`);
    }
    return { pathBase: selection.pathBase, testFileSetHash: selection.testFileSetHash };
}
/**
 * Validates one rich profile and returns its aggregation contract.
 * @param {TestProfileTimingManifestInput} input - Profile input.
 * @returns {ValidatedProfileShard} - Validated shard contract.
 */
function validatedProfileShard(input) {
    const { profile, source } = input;
    assertJsonObject(profile, `${source} must be a rich Velocious test profile`);
    if (profile.schema !== "velocious.test-profile" || profile.schemaVersion !== 1) {
        throw new Error(`${source} has an incompatible Velocious test profile schema`);
    }
    if (profile.status !== "passed")
        throw new Error(`${source} must have passed status for timing aggregation`);
    const selection = profile.selection;
    assertJsonObject(selection, `${source} is missing test profile selection metadata`);
    assertCompleteSelection(selection, source);
    const { groupNumber, groups } = validatedShardNumbers(selection.shard, source);
    const discoveredFileCount = validatedSelectionCount(selection.discoveredFileCount, `${source} has an invalid pre-shard discovered file count`);
    const fileCount = validatedSelectionCount(selection.fileCount, `${source} has an invalid post-shard file count`);
    const { pathBase, testFileSetHash } = validatedSelectionIdentity(selection, source);
    const timingManifest = validateTimingManifest(profile.timingManifest, { source: `${source} timing manifest` });
    if (Object.keys(timingManifest).length !== fileCount) {
        throw new Error(`${source} timing manifest does not match its post-shard file count`);
    }
    return {
        discoveredFileCount,
        fileCount,
        groupNumber,
        groups,
        pathBase,
        testFileSetHash,
        timingManifest
    };
}
/**
 * Requires one shard to describe the same complete selection as the first.
 * @param {ValidatedProfileShard} shard - Candidate shard.
 * @param {ValidatedProfileShard} expected - First shard contract.
 * @param {string} source - Candidate source.
 * @returns {void}
 */
function assertCompatibleShard(shard, expected, source) {
    if (shard.groups !== expected.groups)
        throw new Error(`${source} has a different shard group count`);
    if (shard.pathBase !== expected.pathBase)
        throw new Error(`${source} has a different timing manifest path base`);
    if (shard.discoveredFileCount !== expected.discoveredFileCount)
        throw new Error(`${source} has a different discovered file count`);
    if (shard.testFileSetHash !== expected.testFileSetHash)
        throw new Error(`${source} has a different test file set identity`);
}
/**
 * Adds one validated shard timing map without allowing duplicate canonical keys.
 * @param {object} args - Merge state.
 * @param {Map<string, {duration: number, source: string}>} args.mergedEntries - Destination timing entries.
 * @param {ValidatedProfileShard} args.shard - Candidate shard.
 * @param {string} args.source - Candidate source.
 * @returns {void}
 */
function mergeShardTimingManifest({ mergedEntries, shard, source }) {
    for (const [filePath, duration] of Object.entries(shard.timingManifest)) {
        const existingEntry = mergedEntries.get(filePath);
        if (existingEntry) {
            throw new Error(`Duplicate timing path ${filePath} in ${existingEntry.source} and ${source}`);
        }
        mergedEntries.set(filePath, { duration, source });
    }
}
/**
 * Merges a complete compatible set of rich Velocious shard profiles.
 * @param {TestProfileTimingManifestInput[]} inputs - Parsed profile documents and sources.
 * @returns {TimingManifest} - Complete sorted plain timing manifest.
 */
export function mergeTestProfileTimingManifests(inputs) {
    if (inputs.length === 0)
        throw new Error("At least one rich test profile is required");
    const shards = inputs.map((input) => validatedProfileShard(input));
    const expected = shards[0];
    /** @type {Map<number, string>} */
    const shardSources = new Map();
    /** @type {Map<string, {duration: number, source: string}>} */
    const mergedEntries = new Map();
    let selectedFileCount = 0;
    for (let index = 0; index < shards.length; index++) {
        const shard = shards[index];
        const source = inputs[index].source;
        assertCompatibleShard(shard, expected, source);
        const existingShardSource = shardSources.get(shard.groupNumber);
        if (existingShardSource) {
            throw new Error(`Duplicate shard ${shard.groupNumber} in ${existingShardSource} and ${source}`);
        }
        shardSources.set(shard.groupNumber, source);
        selectedFileCount += shard.fileCount;
        mergeShardTimingManifest({ mergedEntries, shard, source });
    }
    const missingShardNumbers = [];
    for (let groupNumber = 1; groupNumber <= expected.groups; groupNumber++) {
        if (!shardSources.has(groupNumber))
            missingShardNumbers.push(groupNumber);
    }
    if (missingShardNumbers.length > 0) {
        throw new Error(`Missing shard profiles: ${missingShardNumbers.join(", ")}`);
    }
    if (selectedFileCount !== expected.discoveredFileCount || mergedEntries.size !== expected.discoveredFileCount) {
        throw new Error("Merged timing manifest does not cover the complete file universe");
    }
    const merged = Object.fromEntries([...mergedEntries].map(([filePath, entry]) => [filePath, entry.duration]));
    if (timingManifestFileSetHash(Object.keys(merged)) !== expected.testFileSetHash) {
        throw new Error("Merged timing manifest does not match the complete file universe");
    }
    return validateTimingManifest(merged, { source: "merged timing manifest" });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGltaW5nLW1hbmlmZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3Rlc3RpbmcvdGltaW5nLW1hbmlmZXN0LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFNBQVMsTUFBTSx3QkFBd0IsQ0FBQTtBQUU5Qyx1REFBdUQ7QUFFdkQ7Ozs7Ozs7Ozs7R0FVRztBQUVIOzs7OztHQUtHO0FBRUg7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSwyQkFBMkIsQ0FBQyxRQUFRO0lBQ2xELElBQUksT0FBTyxRQUFRLEtBQUssUUFBUSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDMUQsTUFBTSxJQUFJLEtBQUssQ0FBQyx1REFBdUQsQ0FBQyxDQUFBO0lBQzFFLENBQUM7SUFFRCxNQUFNLFlBQVksR0FBRyxRQUFRLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQTtJQUVuRCxJQUFJLFlBQVksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLElBQUksWUFBWSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDO1FBQ3BFLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0RBQWdELFFBQVEsRUFBRSxDQUFDLENBQUE7SUFDN0UsQ0FBQztJQUVELE1BQU0sUUFBUSxHQUFHLEVBQUUsQ0FBQTtJQUVuQixLQUFLLE1BQU0sT0FBTyxJQUFJLFlBQVksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUM5QyxJQUFJLENBQUMsT0FBTyxJQUFJLE9BQU8sS0FBSyxHQUFHO1lBQUUsU0FBUTtRQUV6QyxJQUFJLE9BQU8sS0FBSyxJQUFJLEVBQUUsQ0FBQztZQUNyQixJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQzFCLE1BQU0sSUFBSSxLQUFLLENBQUMsNkRBQTZELFFBQVEsRUFBRSxDQUFDLENBQUE7WUFDMUYsQ0FB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LENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFBO0lBQzNFLENBQUM7SUFFRCxJQUFJLG1CQUFtQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNuQyxNQUFNLElBQUksS0FBSyxDQUFDLDJCQUEyQixtQkFBbUIsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQzlFLENBQUM7SUFFRCxJQUFJLGlCQUFpQixLQUFLLFFBQVEsQ0FBQyxtQkFBbUIsSUFBSSxhQUFhLENBQUMsSUFBSSxLQUFLLFFBQVEsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1FBQzlHLE1BQU0sSUFBSSxLQUFLLENBQUMsa0VBQWtFLENBQUMsQ0FBQTtJQUNyRixDQUFDO0lBRUQsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FDL0IsQ0FBQyxHQUFHLGFBQWEsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLEtBQUssQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLFFBQVEsRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FDMUUsQ0FBQTtJQUVELElBQUkseUJBQXlCLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxLQUFLLFFBQVEsQ0FBQyxlQUFlLEVBQUUsQ0FBQztRQUNoRixNQUFNLElBQUksS0FBSyxDQUFDLGtFQUFrRSxDQUFDLENBQUE7SUFDckYsQ0FBQztJQUVELE9BQU8sc0JBQXNCLENBQUMsTUFBTSxFQUFFLEVBQUMsTUFBTSxFQUFFLHdCQUF3QixFQUFDLENBQUMsQ0FBQTtBQUMzRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBzaGEyNTZIZXggZnJvbSBcIi4uL3V0aWxzL3NoYTI1Ni1oZXguanNcIlxuXG4vKiogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIG51bWJlcj59IFRpbWluZ01hbmlmZXN0ICovXG5cbi8qKlxuICogVmFsaWRhdGVkUHJvZmlsZVNoYXJkIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBWYWxpZGF0ZWRQcm9maWxlU2hhcmRcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBkaXNjb3ZlcmVkRmlsZUNvdW50IC0gQ29tcGxldGUgcHJlLXNoYXJkIGZpbGUgY291bnQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gZmlsZUNvdW50IC0gU2VsZWN0ZWQgcG9zdC1zaGFyZCBmaWxlIGNvdW50LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGdyb3VwTnVtYmVyIC0gT25lLWluZGV4ZWQgc2hhcmQgbnVtYmVyLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IGdyb3VwcyAtIENvbXBsZXRlIHNoYXJkIGNvdW50LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHBhdGhCYXNlIC0gUHJvZmlsaW5nIHBhdGgtYmFzZSBzZW1hbnRpY3MuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gdGVzdEZpbGVTZXRIYXNoIC0gQ29tcGxldGUgY2Fub25pY2FsIGZpbGUtc2V0IGlkZW50aXR5LlxuICogQHByb3BlcnR5IHtUaW1pbmdNYW5pZmVzdH0gdGltaW5nTWFuaWZlc3QgLSBDYW5vbmljYWwgc2hhcmQgdGltaW5nIG1hcC5cbiAqL1xuXG4vKipcbiAqIFRlc3RQcm9maWxlVGltaW5nTWFuaWZlc3RJbnB1dCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVGVzdFByb2ZpbGVUaW1pbmdNYW5pZmVzdElucHV0XG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBwcm9maWxlIC0gUGFyc2VkIHJpY2ggdGVzdCBwcm9maWxlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHNvdXJjZSAtIEh1bWFuLXJlYWRhYmxlIGlucHV0IHNvdXJjZSBmb3IgdmFsaWRhdGlvbiBlcnJvcnMuXG4gKi9cblxuLyoqXG4gKiBDYW5vbmljYWxpemVzIGEgdGltaW5nLW1hbmlmZXN0IHBhdGggcmVsYXRpdmUgdG8gaXRzIHByb2ZpbGluZyBiYXNlLlxuICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gQ2FuZGlkYXRlIHJlbGF0aXZlIHBhdGguXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFBvcnRhYmxlIGNhbm9uaWNhbCBwYXRoLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2Fub25pY2FsVGltaW5nTWFuaWZlc3RQYXRoKGZpbGVQYXRoKSB7XG4gIGlmICh0eXBlb2YgZmlsZVBhdGggIT09IFwic3RyaW5nXCIgfHwgZmlsZVBhdGgubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiVGltaW5nIG1hbmlmZXN0IGtleXMgbXVzdCBiZSBub24tZW1wdHkgcmVsYXRpdmUgcGF0aHNcIilcbiAgfVxuXG4gIGNvbnN0IHBvcnRhYmxlUGF0aCA9IGZpbGVQYXRoLnJlcGxhY2VBbGwoXCJcXFxcXCIsIFwiL1wiKVxuXG4gIGlmIChwb3J0YWJsZVBhdGguc3RhcnRzV2l0aChcIi9cIikgfHwgL15bQS1aYS16XTovLnRlc3QocG9ydGFibGVQYXRoKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgVGltaW5nIG1hbmlmZXN0IGtleSBtdXN0IGJlIGEgcmVsYXRpdmUgcGF0aDogJHtmaWxlUGF0aH1gKVxuICB9XG5cbiAgY29uc3Qgc2VnbWVudHMgPSBbXVxuXG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBwb3J0YWJsZVBhdGguc3BsaXQoXCIvXCIpKSB7XG4gICAgaWYgKCFzZWdtZW50IHx8IHNlZ21lbnQgPT09IFwiLlwiKSBjb250aW51ZVxuXG4gICAgaWYgKHNlZ21lbnQgPT09IFwiLi5cIikge1xuICAgICAgaWYgKHNlZ21lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRpbWluZyBtYW5pZmVzdCBrZXkgbXVzdCBiZSBhIG5vbi1lc2NhcGluZyByZWxhdGl2ZSBwYXRoOiAke2ZpbGVQYXRofWApXG4gICAgICB9XG5cbiAgICAgIHNlZ21lbnRzLnBvcCgpXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIHNlZ21lbnRzLnB1c2goc2VnbWVudClcbiAgfVxuXG4gIGlmIChzZWdtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFRpbWluZyBtYW5pZmVzdCBrZXkgbXVzdCBiZSBhIG5vbi1lbXB0eSByZWxhdGl2ZSBwYXRoOiAke2ZpbGVQYXRofWApXG4gIH1cblxuICByZXR1cm4gc2VnbWVudHMuam9pbihcIi9cIilcbn1cblxuLyoqXG4gKiBDb21wYXJlcyB0aW1pbmctbWFuaWZlc3QgcGF0aHMgYnkgSmF2YVNjcmlwdCBjb2RlIHVuaXRzIHdpdGhvdXQgbG9jYWxlIHJ1bGVzLlxuICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoQSAtIEZpcnN0IHBhdGguXG4gKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGhCIC0gU2Vjb25kIHBhdGguXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIE5lZ2F0aXZlLCB6ZXJvLCBvciBwb3NpdGl2ZSBvcmRlcmluZyByZXN1bHQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wYXJlVGltaW5nTWFuaWZlc3RQYXRocyhmaWxlUGF0aEEsIGZpbGVQYXRoQikge1xuICBpZiAoZmlsZVBhdGhBID09PSBmaWxlUGF0aEIpIHJldHVybiAwXG5cbiAgcmV0dXJuIGZpbGVQYXRoQSA8IGZpbGVQYXRoQiA/IC0xIDogMVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhbmQgc29ydHMgYSBwbGFpbiB0aW1pbmcgbWFuaWZlc3QuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB0aW1pbmdNYW5pZmVzdCAtIFBhcnNlZCB0aW1pbmcgbWFuaWZlc3QuXG4gKiBAcGFyYW0ge3tzb3VyY2U/OiBzdHJpbmd9fSBbb3B0aW9uc10gLSBWYWxpZGF0aW9uIGNvbnRleHQuXG4gKiBAcmV0dXJucyB7VGltaW5nTWFuaWZlc3R9IC0gQ2Fub25pY2FsIHNvcnRlZCB0aW1pbmcgbWFuaWZlc3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVRpbWluZ01hbmlmZXN0KHRpbWluZ01hbmlmZXN0LCB7c291cmNlID0gXCJ0aW1pbmcgbWFuaWZlc3RcIn0gPSB7fSkge1xuICBpZiAoIXRpbWluZ01hbmlmZXN0IHx8IHR5cGVvZiB0aW1pbmdNYW5pZmVzdCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHRpbWluZ01hbmlmZXN0KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtzb3VyY2V9IG11c3QgYmUgYSBwbGFpbiBKU09OIG9iamVjdCBtYXBwaW5nIHJlbGF0aXZlIHBhdGhzIHRvIGR1cmF0aW9uc2ApXG4gIH1cblxuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIHtkdXJhdGlvbjogbnVtYmVyLCBvcmlnaW5hbFBhdGg6IHN0cmluZ30+fSAqL1xuICBjb25zdCBlbnRyaWVzID0gbmV3IE1hcCgpXG5cbiAgZm9yIChjb25zdCBbb3JpZ2luYWxQYXRoLCBkdXJhdGlvbl0gb2YgT2JqZWN0LmVudHJpZXModGltaW5nTWFuaWZlc3QpKSB7XG4gICAgaWYgKHR5cGVvZiBkdXJhdGlvbiAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKGR1cmF0aW9uKSB8fCBkdXJhdGlvbiA8IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtzb3VyY2V9IGhhcyBhbiBpbnZhbGlkIGR1cmF0aW9uIGZvciAke29yaWdpbmFsUGF0aH1gKVxuICAgIH1cblxuICAgIGNvbnN0IGNhbm9uaWNhbFBhdGggPSBjYW5vbmljYWxUaW1pbmdNYW5pZmVzdFBhdGgob3JpZ2luYWxQYXRoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gZW50cmllcy5nZXQoY2Fub25pY2FsUGF0aClcblxuICAgIGlmIChleGlzdGluZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3NvdXJjZX0gaGFzIGEgbm9ybWFsaXplZCBwYXRoIGNvbGxpc2lvbiBiZXR3ZWVuICR7ZXhpc3Rpbmcub3JpZ2luYWxQYXRofSBhbmQgJHtvcmlnaW5hbFBhdGh9YClcbiAgICB9XG5cbiAgICBlbnRyaWVzLnNldChjYW5vbmljYWxQYXRoLCB7ZHVyYXRpb24sIG9yaWdpbmFsUGF0aH0pXG4gIH1cblxuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIFsuLi5lbnRyaWVzLmVudHJpZXMoKV1cbiAgICAgIC5zb3J0KChbZmlsZVBhdGhBXSwgW2ZpbGVQYXRoQl0pID0+IGNvbXBhcmVUaW1pbmdNYW5pZmVzdFBhdGhzKGZpbGVQYXRoQSwgZmlsZVBhdGhCKSlcbiAgICAgIC5tYXAoKFtmaWxlUGF0aCwgZW50cnldKSA9PiBbZmlsZVBhdGgsIGVudHJ5LmR1cmF0aW9uXSlcbiAgKVxufVxuXG4vKipcbiAqIFJldHVybnMgYW4gb3BhcXVlIGRldGVybWluaXN0aWMgaWRlbnRpdHkgZm9yIGEgY29tcGxldGUgY2Fub25pY2FsIHRlc3QtZmlsZSBzZXQuXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBmaWxlUGF0aHMgLSBQYXRocyByZWxhdGl2ZSB0byBvbmUgcHJvZmlsaW5nIGJhc2UuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNIQS0yNTYgZmlsZS1zZXQgaWRlbnRpdHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0aW1pbmdNYW5pZmVzdEZpbGVTZXRIYXNoKGZpbGVQYXRocykge1xuICBjb25zdCBwYXRoTWFuaWZlc3QgPSBPYmplY3QuZnJvbUVudHJpZXMoZmlsZVBhdGhzLm1hcCgoZmlsZVBhdGgpID0+IFtmaWxlUGF0aCwgMF0pKVxuICBjb25zdCBjYW5vbmljYWxQYXRocyA9IE9iamVjdC5rZXlzKHZhbGlkYXRlVGltaW5nTWFuaWZlc3QocGF0aE1hbmlmZXN0LCB7c291cmNlOiBcInRlc3QgZmlsZSBzZXRcIn0pKVxuICBjb25zdCBpZGVudGl0eSA9IGB2ZWxvY2lvdXMudGVzdC1maWxlLXNldC52MVxcMCR7Y2Fub25pY2FsUGF0aHMuam9pbihcIlxcMFwiKX1gXG5cbiAgcmV0dXJuIGBzaGEyNTY6JHtzaGEyNTZIZXgoaWRlbnRpdHkpfWBcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgdGhhdCBhIHBhcnNlZCBKU09OIHZhbHVlIGlzIGEgbm9uLWFycmF5IG9iamVjdC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIG9iamVjdC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gVmFsaWRhdGlvbiBlcnJvciBtZXNzYWdlLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydEpzb25PYmplY3QodmFsdWUsIG1lc3NhZ2UpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihtZXNzYWdlKVxufVxuXG4vKipcbiAqIFJlcXVpcmVzIHVuZmlsdGVyZWQsIG5vbi1mb2N1c2VkIHByb2ZpbGUgc2VsZWN0aW9uIG1ldGFkYXRhLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc2VsZWN0aW9uIC0gUmljaCBwcm9maWxlIHNlbGVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzb3VyY2UgLSBJbnB1dCBzb3VyY2UuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0Q29tcGxldGVTZWxlY3Rpb24oc2VsZWN0aW9uLCBzb3VyY2UpIHtcbiAgaWYgKHNlbGVjdGlvbi5mb2N1c2VkICE9PSBmYWxzZSkgdGhyb3cgbmV3IEVycm9yKGAke3NvdXJjZX0gbXVzdCBub3QgYmUgYSBmb2N1c2VkIHRlc3QgcHJvZmlsZWApXG5cbiAgY29uc3Qgc2VsZWN0aW9uRmlsdGVycyA9IFtcbiAgICBbc2VsZWN0aW9uLmluY2x1ZGVUYWdDb3VudCwgMF0sXG4gICAgW3NlbGVjdGlvbi5leGNsdWRlVGFnQ291bnQsIDBdLFxuICAgIFtzZWxlY3Rpb24uaGFzRXhhbXBsZUZpbHRlcnMsIGZhbHNlXSxcbiAgICBbc2VsZWN0aW9uLmhhc0xpbmVGaWx0ZXJzLCBmYWxzZV1cbiAgXVxuXG4gIGlmIChzZWxlY3Rpb25GaWx0ZXJzLnNvbWUoKFt2YWx1ZSwgZXhwZWN0ZWRdKSA9PiB2YWx1ZSAhPT0gZXhwZWN0ZWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3NvdXJjZX0gbXVzdCBub3QgYmUgYSBmaWx0ZXJlZCB0ZXN0IHByb2ZpbGVgKVxuICB9XG59XG5cbi8qKlxuICogVmFsaWRhdGVzIHNoYXJkIG51bWJlcmluZyBtZXRhZGF0YS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHNoYXJkIC0gQ2FuZGlkYXRlIHNoYXJkIHNlbGVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzb3VyY2UgLSBJbnB1dCBzb3VyY2UuXG4gKiBAcmV0dXJucyB7e2dyb3VwTnVtYmVyOiBudW1iZXIsIGdyb3VwczogbnVtYmVyfX0gLSBWYWxpZGF0ZWQgc2hhcmQgbnVtYmVycy5cbiAqL1xuZnVuY3Rpb24gdmFsaWRhdGVkU2hhcmROdW1iZXJzKHNoYXJkLCBzb3VyY2UpIHtcbiAgYXNzZXJ0SnNvbk9iamVjdChzaGFyZCwgYCR7c291cmNlfSBpcyBtaXNzaW5nIHNoYXJkIG1ldGFkYXRhYClcblxuICBpZiAoIU51bWJlci5pc0ludGVnZXIoc2hhcmQuZ3JvdXBzKSB8fCBzaGFyZC5ncm91cHMgPCAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3NvdXJjZX0gaGFzIGFuIGludmFsaWQgc2hhcmQgZ3JvdXAgY291bnRgKVxuICB9XG5cbiAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHNoYXJkLmdyb3VwTnVtYmVyKSB8fCBzaGFyZC5ncm91cE51bWJlciA8IDEgfHwgc2hhcmQuZ3JvdXBOdW1iZXIgPiBzaGFyZC5ncm91cHMpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7c291cmNlfSBoYXMgYW4gaW52YWxpZCBzaGFyZCBudW1iZXJgKVxuICB9XG5cbiAgcmV0dXJuIHtncm91cE51bWJlcjogc2hhcmQuZ3JvdXBOdW1iZXIsIGdyb3Vwczogc2hhcmQuZ3JvdXBzfVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyIHNlbGVjdGlvbiBjb3VudC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIGNvdW50LlxuICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBWYWxpZGF0aW9uIGVycm9yIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIFZhbGlkYXRlZCBjb3VudC5cbiAqL1xuZnVuY3Rpb24gdmFsaWRhdGVkU2VsZWN0aW9uQ291bnQodmFsdWUsIG1lc3NhZ2UpIHtcbiAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8IDApIHRocm93IG5ldyBFcnJvcihtZXNzYWdlKVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyB0aGUgc2VsZWN0aW9uIGlkZW50aXR5IHVzZWQgYWNyb3NzIHNoYXJkIHByb2ZpbGVzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc2VsZWN0aW9uIC0gUmljaCBwcm9maWxlIHNlbGVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzb3VyY2UgLSBJbnB1dCBzb3VyY2UuXG4gKiBAcmV0dXJucyB7e3BhdGhCYXNlOiBzdHJpbmcsIHRlc3RGaWxlU2V0SGFzaDogc3RyaW5nfX0gLSBWYWxpZGF0ZWQgaWRlbnRpdHkuXG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlZFNlbGVjdGlvbklkZW50aXR5KHNlbGVjdGlvbiwgc291cmNlKSB7XG4gIGlmICghW1wiY29uZmlndXJhdGlvbi1kaXJlY3RvcnlcIiwgXCJ0ZXN0LWRpcmVjdG9yeVwiXS5pbmNsdWRlcyhzZWxlY3Rpb24ucGF0aEJhc2UpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3NvdXJjZX0gaGFzIGFuIGludmFsaWQgdGltaW5nIG1hbmlmZXN0IHBhdGggYmFzZWApXG4gIH1cblxuICBpZiAodHlwZW9mIHNlbGVjdGlvbi50ZXN0RmlsZVNldEhhc2ggIT09IFwic3RyaW5nXCIgfHwgIS9ec2hhMjU2OlthLWYwLTldezY0fSQvLnRlc3Qoc2VsZWN0aW9uLnRlc3RGaWxlU2V0SGFzaCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7c291cmNlfSBoYXMgYW4gaW52YWxpZCB0ZXN0IGZpbGUgc2V0IGlkZW50aXR5YClcbiAgfVxuXG4gIHJldHVybiB7cGF0aEJhc2U6IHNlbGVjdGlvbi5wYXRoQmFzZSwgdGVzdEZpbGVTZXRIYXNoOiBzZWxlY3Rpb24udGVzdEZpbGVTZXRIYXNofVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBvbmUgcmljaCBwcm9maWxlIGFuZCByZXR1cm5zIGl0cyBhZ2dyZWdhdGlvbiBjb250cmFjdC5cbiAqIEBwYXJhbSB7VGVzdFByb2ZpbGVUaW1pbmdNYW5pZmVzdElucHV0fSBpbnB1dCAtIFByb2ZpbGUgaW5wdXQuXG4gKiBAcmV0dXJucyB7VmFsaWRhdGVkUHJvZmlsZVNoYXJkfSAtIFZhbGlkYXRlZCBzaGFyZCBjb250cmFjdC5cbiAqL1xuZnVuY3Rpb24gdmFsaWRhdGVkUHJvZmlsZVNoYXJkKGlucHV0KSB7XG4gIGNvbnN0IHtwcm9maWxlLCBzb3VyY2V9ID0gaW5wdXRcblxuICBhc3NlcnRKc29uT2JqZWN0KHByb2ZpbGUsIGAke3NvdXJjZX0gbXVzdCBiZSBhIHJpY2ggVmVsb2Npb3VzIHRlc3QgcHJvZmlsZWApXG5cbiAgaWYgKHByb2ZpbGUuc2NoZW1hICE9PSBcInZlbG9jaW91cy50ZXN0LXByb2ZpbGVcIiB8fCBwcm9maWxlLnNjaGVtYVZlcnNpb24gIT09IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7c291cmNlfSBoYXMgYW4gaW5jb21wYXRpYmxlIFZlbG9jaW91cyB0ZXN0IHByb2ZpbGUgc2NoZW1hYClcbiAgfVxuXG4gIGlmIChwcm9maWxlLnN0YXR1cyAhPT0gXCJwYXNzZWRcIikgdGhyb3cgbmV3IEVycm9yKGAke3NvdXJjZX0gbXVzdCBoYXZlIHBhc3NlZCBzdGF0dXMgZm9yIHRpbWluZyBhZ2dyZWdhdGlvbmApXG5cbiAgY29uc3Qgc2VsZWN0aW9uID0gcHJvZmlsZS5zZWxlY3Rpb25cblxuICBhc3NlcnRKc29uT2JqZWN0KHNlbGVjdGlvbiwgYCR7c291cmNlfSBpcyBtaXNzaW5nIHRlc3QgcHJvZmlsZSBzZWxlY3Rpb24gbWV0YWRhdGFgKVxuICBhc3NlcnRDb21wbGV0ZVNlbGVjdGlvbihzZWxlY3Rpb24sIHNvdXJjZSlcbiAgY29uc3Qge2dyb3VwTnVtYmVyLCBncm91cHN9ID0gdmFsaWRhdGVkU2hhcmROdW1iZXJzKHNlbGVjdGlvbi5zaGFyZCwgc291cmNlKVxuICBjb25zdCBkaXNjb3ZlcmVkRmlsZUNvdW50ID0gdmFsaWRhdGVkU2VsZWN0aW9uQ291bnQoXG4gICAgc2VsZWN0aW9uLmRpc2NvdmVyZWRGaWxlQ291bnQsXG4gICAgYCR7c291cmNlfSBoYXMgYW4gaW52YWxpZCBwcmUtc2hhcmQgZGlzY292ZXJlZCBmaWxlIGNvdW50YFxuICApXG4gIGNvbnN0IGZpbGVDb3VudCA9IHZhbGlkYXRlZFNlbGVjdGlvbkNvdW50KFxuICAgIHNlbGVjdGlvbi5maWxlQ291bnQsXG4gICAgYCR7c291cmNlfSBoYXMgYW4gaW52YWxpZCBwb3N0LXNoYXJkIGZpbGUgY291bnRgXG4gIClcbiAgY29uc3Qge3BhdGhCYXNlLCB0ZXN0RmlsZVNldEhhc2h9ID0gdmFsaWRhdGVkU2VsZWN0aW9uSWRlbnRpdHkoc2VsZWN0aW9uLCBzb3VyY2UpXG5cbiAgY29uc3QgdGltaW5nTWFuaWZlc3QgPSB2YWxpZGF0ZVRpbWluZ01hbmlmZXN0KHByb2ZpbGUudGltaW5nTWFuaWZlc3QsIHtzb3VyY2U6IGAke3NvdXJjZX0gdGltaW5nIG1hbmlmZXN0YH0pXG5cbiAgaWYgKE9iamVjdC5rZXlzKHRpbWluZ01hbmlmZXN0KS5sZW5ndGggIT09IGZpbGVDb3VudCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJHtzb3VyY2V9IHRpbWluZyBtYW5pZmVzdCBkb2VzIG5vdCBtYXRjaCBpdHMgcG9zdC1zaGFyZCBmaWxlIGNvdW50YClcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZGlzY292ZXJlZEZpbGVDb3VudCxcbiAgICBmaWxlQ291bnQsXG4gICAgZ3JvdXBOdW1iZXIsXG4gICAgZ3JvdXBzLFxuICAgIHBhdGhCYXNlLFxuICAgIHRlc3RGaWxlU2V0SGFzaCxcbiAgICB0aW1pbmdNYW5pZmVzdFxuICB9XG59XG5cbi8qKlxuICogUmVxdWlyZXMgb25lIHNoYXJkIHRvIGRlc2NyaWJlIHRoZSBzYW1lIGNvbXBsZXRlIHNlbGVjdGlvbiBhcyB0aGUgZmlyc3QuXG4gKiBAcGFyYW0ge1ZhbGlkYXRlZFByb2ZpbGVTaGFyZH0gc2hhcmQgLSBDYW5kaWRhdGUgc2hhcmQuXG4gKiBAcGFyYW0ge1ZhbGlkYXRlZFByb2ZpbGVTaGFyZH0gZXhwZWN0ZWQgLSBGaXJzdCBzaGFyZCBjb250cmFjdC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzb3VyY2UgLSBDYW5kaWRhdGUgc291cmNlLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydENvbXBhdGlibGVTaGFyZChzaGFyZCwgZXhwZWN0ZWQsIHNvdXJjZSkge1xuICBpZiAoc2hhcmQuZ3JvdXBzICE9PSBleHBlY3RlZC5ncm91cHMpIHRocm93IG5ldyBFcnJvcihgJHtzb3VyY2V9IGhhcyBhIGRpZmZlcmVudCBzaGFyZCBncm91cCBjb3VudGApXG4gIGlmIChzaGFyZC5wYXRoQmFzZSAhPT0gZXhwZWN0ZWQucGF0aEJhc2UpIHRocm93IG5ldyBFcnJvcihgJHtzb3VyY2V9IGhhcyBhIGRpZmZlcmVudCB0aW1pbmcgbWFuaWZlc3QgcGF0aCBiYXNlYClcbiAgaWYgKHNoYXJkLmRpc2NvdmVyZWRGaWxlQ291bnQgIT09IGV4cGVjdGVkLmRpc2NvdmVyZWRGaWxlQ291bnQpIHRocm93IG5ldyBFcnJvcihgJHtzb3VyY2V9IGhhcyBhIGRpZmZlcmVudCBkaXNjb3ZlcmVkIGZpbGUgY291bnRgKVxuICBpZiAoc2hhcmQudGVzdEZpbGVTZXRIYXNoICE9PSBleHBlY3RlZC50ZXN0RmlsZVNldEhhc2gpIHRocm93IG5ldyBFcnJvcihgJHtzb3VyY2V9IGhhcyBhIGRpZmZlcmVudCB0ZXN0IGZpbGUgc2V0IGlkZW50aXR5YClcbn1cblxuLyoqXG4gKiBBZGRzIG9uZSB2YWxpZGF0ZWQgc2hhcmQgdGltaW5nIG1hcCB3aXRob3V0IGFsbG93aW5nIGR1cGxpY2F0ZSBjYW5vbmljYWwga2V5cy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTWVyZ2Ugc3RhdGUuXG4gKiBAcGFyYW0ge01hcDxzdHJpbmcsIHtkdXJhdGlvbjogbnVtYmVyLCBzb3VyY2U6IHN0cmluZ30+fSBhcmdzLm1lcmdlZEVudHJpZXMgLSBEZXN0aW5hdGlvbiB0aW1pbmcgZW50cmllcy5cbiAqIEBwYXJhbSB7VmFsaWRhdGVkUHJvZmlsZVNoYXJkfSBhcmdzLnNoYXJkIC0gQ2FuZGlkYXRlIHNoYXJkLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc291cmNlIC0gQ2FuZGlkYXRlIHNvdXJjZS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZVNoYXJkVGltaW5nTWFuaWZlc3Qoe21lcmdlZEVudHJpZXMsIHNoYXJkLCBzb3VyY2V9KSB7XG4gIGZvciAoY29uc3QgW2ZpbGVQYXRoLCBkdXJhdGlvbl0gb2YgT2JqZWN0LmVudHJpZXMoc2hhcmQudGltaW5nTWFuaWZlc3QpKSB7XG4gICAgY29uc3QgZXhpc3RpbmdFbnRyeSA9IG1lcmdlZEVudHJpZXMuZ2V0KGZpbGVQYXRoKVxuXG4gICAgaWYgKGV4aXN0aW5nRW50cnkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRHVwbGljYXRlIHRpbWluZyBwYXRoICR7ZmlsZVBhdGh9IGluICR7ZXhpc3RpbmdFbnRyeS5zb3VyY2V9IGFuZCAke3NvdXJjZX1gKVxuICAgIH1cblxuICAgIG1lcmdlZEVudHJpZXMuc2V0KGZpbGVQYXRoLCB7ZHVyYXRpb24sIHNvdXJjZX0pXG4gIH1cbn1cblxuLyoqXG4gKiBNZXJnZXMgYSBjb21wbGV0ZSBjb21wYXRpYmxlIHNldCBvZiByaWNoIFZlbG9jaW91cyBzaGFyZCBwcm9maWxlcy5cbiAqIEBwYXJhbSB7VGVzdFByb2ZpbGVUaW1pbmdNYW5pZmVzdElucHV0W119IGlucHV0cyAtIFBhcnNlZCBwcm9maWxlIGRvY3VtZW50cyBhbmQgc291cmNlcy5cbiAqIEByZXR1cm5zIHtUaW1pbmdNYW5pZmVzdH0gLSBDb21wbGV0ZSBzb3J0ZWQgcGxhaW4gdGltaW5nIG1hbmlmZXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VUZXN0UHJvZmlsZVRpbWluZ01hbmlmZXN0cyhpbnB1dHMpIHtcbiAgaWYgKGlucHV0cy5sZW5ndGggPT09IDApIHRocm93IG5ldyBFcnJvcihcIkF0IGxlYXN0IG9uZSByaWNoIHRlc3QgcHJvZmlsZSBpcyByZXF1aXJlZFwiKVxuXG4gIGNvbnN0IHNoYXJkcyA9IGlucHV0cy5tYXAoKGlucHV0KSA9PiB2YWxpZGF0ZWRQcm9maWxlU2hhcmQoaW5wdXQpKVxuICBjb25zdCBleHBlY3RlZCA9IHNoYXJkc1swXVxuICAvKiogQHR5cGUge01hcDxudW1iZXIsIHN0cmluZz59ICovXG4gIGNvbnN0IHNoYXJkU291cmNlcyA9IG5ldyBNYXAoKVxuICAvKiogQHR5cGUge01hcDxzdHJpbmcsIHtkdXJhdGlvbjogbnVtYmVyLCBzb3VyY2U6IHN0cmluZ30+fSAqL1xuICBjb25zdCBtZXJnZWRFbnRyaWVzID0gbmV3IE1hcCgpXG4gIGxldCBzZWxlY3RlZEZpbGVDb3VudCA9IDBcblxuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgc2hhcmRzLmxlbmd0aDsgaW5kZXgrKykge1xuICAgIGNvbnN0IHNoYXJkID0gc2hhcmRzW2luZGV4XVxuICAgIGNvbnN0IHNvdXJjZSA9IGlucHV0c1tpbmRleF0uc291cmNlXG5cbiAgICBhc3NlcnRDb21wYXRpYmxlU2hhcmQoc2hhcmQsIGV4cGVjdGVkLCBzb3VyY2UpXG5cbiAgICBjb25zdCBleGlzdGluZ1NoYXJkU291cmNlID0gc2hhcmRTb3VyY2VzLmdldChzaGFyZC5ncm91cE51bWJlcilcblxuICAgIGlmIChleGlzdGluZ1NoYXJkU291cmNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYER1cGxpY2F0ZSBzaGFyZCAke3NoYXJkLmdyb3VwTnVtYmVyfSBpbiAke2V4aXN0aW5nU2hhcmRTb3VyY2V9IGFuZCAke3NvdXJjZX1gKVxuICAgIH1cblxuICAgIHNoYXJkU291cmNlcy5zZXQoc2hhcmQuZ3JvdXBOdW1iZXIsIHNvdXJjZSlcbiAgICBzZWxlY3RlZEZpbGVDb3VudCArPSBzaGFyZC5maWxlQ291bnRcbiAgICBtZXJnZVNoYXJkVGltaW5nTWFuaWZlc3Qoe21lcmdlZEVudHJpZXMsIHNoYXJkLCBzb3VyY2V9KVxuICB9XG5cbiAgY29uc3QgbWlzc2luZ1NoYXJkTnVtYmVycyA9IFtdXG5cbiAgZm9yIChsZXQgZ3JvdXBOdW1iZXIgPSAxOyBncm91cE51bWJlciA8PSBleHBlY3RlZC5ncm91cHM7IGdyb3VwTnVtYmVyKyspIHtcbiAgICBpZiAoIXNoYXJkU291cmNlcy5oYXMoZ3JvdXBOdW1iZXIpKSBtaXNzaW5nU2hhcmROdW1iZXJzLnB1c2goZ3JvdXBOdW1iZXIpXG4gIH1cblxuICBpZiAobWlzc2luZ1NoYXJkTnVtYmVycy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHNoYXJkIHByb2ZpbGVzOiAke21pc3NpbmdTaGFyZE51bWJlcnMuam9pbihcIiwgXCIpfWApXG4gIH1cblxuICBpZiAoc2VsZWN0ZWRGaWxlQ291bnQgIT09IGV4cGVjdGVkLmRpc2NvdmVyZWRGaWxlQ291bnQgfHwgbWVyZ2VkRW50cmllcy5zaXplICE9PSBleHBlY3RlZC5kaXNjb3ZlcmVkRmlsZUNvdW50KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTWVyZ2VkIHRpbWluZyBtYW5pZmVzdCBkb2VzIG5vdCBjb3ZlciB0aGUgY29tcGxldGUgZmlsZSB1bml2ZXJzZVwiKVxuICB9XG5cbiAgY29uc3QgbWVyZ2VkID0gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIFsuLi5tZXJnZWRFbnRyaWVzXS5tYXAoKFtmaWxlUGF0aCwgZW50cnldKSA9PiBbZmlsZVBhdGgsIGVudHJ5LmR1cmF0aW9uXSlcbiAgKVxuXG4gIGlmICh0aW1pbmdNYW5pZmVzdEZpbGVTZXRIYXNoKE9iamVjdC5rZXlzKG1lcmdlZCkpICE9PSBleHBlY3RlZC50ZXN0RmlsZVNldEhhc2gpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJNZXJnZWQgdGltaW5nIG1hbmlmZXN0IGRvZXMgbm90IG1hdGNoIHRoZSBjb21wbGV0ZSBmaWxlIHVuaXZlcnNlXCIpXG4gIH1cblxuICByZXR1cm4gdmFsaWRhdGVUaW1pbmdNYW5pZmVzdChtZXJnZWQsIHtzb3VyY2U6IFwibWVyZ2VkIHRpbWluZyBtYW5pZmVzdFwifSlcbn1cbiJdfQ==