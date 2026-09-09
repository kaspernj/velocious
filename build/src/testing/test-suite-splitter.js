// @ts-check
import path from "path";
import restArgsError from "../utils/rest-args-error.js";
import { canonicalTimingManifestPath, compareTimingManifestPaths } from "./timing-manifest.js";
/**
 * SplitterFileEntry type.
 * @typedef {object} SplitterFileEntry
 * @property {string} filePath - Absolute file path.
 * @property {number} weight - Computed weight for load balancing.
 */
/**
 * GroupBucket type.
 * @typedef {object} GroupBucket
 * @property {number} totalWeight - Accumulated weight.
 * @property {string[]} files - Files assigned to this group.
 */
/** Default weight for a regular test file. */
const DEFAULT_WEIGHT = 1;
/**
 * Weight multipliers by spec directory name.
 * Heavier test types get higher weights so greedy distribution balances wall-clock time.
 * @type {Record<string, number>}
 */
const DIRECTORY_WEIGHTS = {
    system: 20,
    "frontend-models": 10,
    controller: 3
};
/** Extra multiplier applied to browser spec files on top of directory weight. */
const BROWSER_SPEC_MULTIPLIER = 2;
/**
 * Splits a list of test files into balanced groups using a greedy load-balancing algorithm.
 * Modeled after test_suite_splitter for RSpec.
 */
export default class TestSuiteSplitter {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {number} args.groups - Total number of groups.
     * @param {number} args.groupNumber - Which group to return (1-indexed).
     * @param {string[]} args.testFiles - All discovered test file paths.
     * @param {string} [args.baseDirectory] - Base directory for relative path computation.
     * @param {ReturnType<typeof JSON.parse>} [args.timingManifest] - Relative test paths mapped to durations.
     */
    constructor({ groups, groupNumber, testFiles, baseDirectory, timingManifest, ...restArgs }) {
        restArgsError(restArgs);
        if (!Number.isInteger(groups) || groups < 1) {
            throw new Error(`--groups must be a positive integer, got: ${groups}`);
        }
        if (!Number.isInteger(groupNumber) || groupNumber < 1 || groupNumber > groups) {
            throw new Error(`--group-number must be between 1 and ${groups}, got: ${groupNumber}`);
        }
        this._groups = groups;
        this._groupNumber = groupNumber;
        this._testFiles = testFiles;
        this._baseDirectory = baseDirectory || process.cwd();
        this._timingManifest = this.normalizeTimingManifest(timingManifest);
    }
    /**
     * Returns the test files assigned to this group.
     * @returns {string[]} - File paths for the requested group.
     */
    getGroupFiles() {
        const weighted = this.computeWeightedFiles();
        const sorted = this.sortByWeightDescending(weighted);
        const buckets = this.distributeGreedily(sorted);
        return buckets[this._groupNumber - 1].files;
    }
    /**
     * Computes weight for each test file based on directory type and file suffix.
     * @returns {SplitterFileEntry[]} - Weighted file entries.
     */
    computeWeightedFiles() {
        return this._testFiles.map((filePath) => ({
            filePath,
            weight: this.computeWeight(filePath)
        }));
    }
    /**
     * Computes the weight for a single file.
     * @param {string} filePath - Absolute file path.
     * @returns {number} - Weight value.
     */
    computeWeight(filePath) {
        const duration = this.timingManifestDuration(filePath);
        if (duration !== undefined && duration > 0) {
            return duration;
        }
        const relativePath = this.heuristicRelativePath(filePath);
        let weight = DEFAULT_WEIGHT;
        // Extract the type directory from the relative path.
        // Matches both "spec/system/..." (base is project root) and "system/..." (base is spec/ itself).
        const specDirMatch = relativePath.match(/^(?:(?:spec|__tests__|tests)\/)?([^/]+)\//);
        if (specDirMatch) {
            const dirName = specDirMatch[1];
            if (DIRECTORY_WEIGHTS[dirName] !== undefined) {
                weight = DIRECTORY_WEIGHTS[dirName];
            }
        }
        // Browser spec files are heavier
        if (filePath.endsWith(".browser-spec.js") || filePath.endsWith(".browser-spec.mjs")) {
            weight *= BROWSER_SPEC_MULTIPLIER;
        }
        return weight;
    }
    /**
     * Keeps only usable positive finite duration entries keyed by normalized relative path.
     * @param {ReturnType<typeof JSON.parse>} timingManifest - Parsed timing manifest.
     * @returns {Record<string, number>} - Valid normalized duration weights.
     */
    normalizeTimingManifest(timingManifest) {
        /** @type {Record<string, number>} */
        const normalized = {};
        if (!timingManifest || typeof timingManifest !== "object" || Array.isArray(timingManifest)) {
            return normalized;
        }
        for (const [filePath, duration] of Object.entries(timingManifest)) {
            if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0)
                continue;
            try {
                normalized[this.normalizeRelativePath(filePath)] = duration;
            }
            catch (error) {
                if (!(error instanceof Error))
                    throw error;
            }
        }
        return normalized;
    }
    /**
     * Normalizes a relative test path to the manifest's portable slash format.
     * @param {string} filePath - Relative test path.
     * @returns {string} - Normalized relative test path.
     */
    normalizeRelativePath(filePath) {
        return canonicalTimingManifestPath(filePath);
    }
    /**
     * Returns the permissive relative path used only for heuristic classification.
     * @param {string} filePath - Absolute test file path.
     * @returns {string} - Portable relative path which may escape the profiling base.
     */
    heuristicRelativePath(filePath) {
        return path.relative(this._baseDirectory, filePath)
            .replaceAll("\\", "/")
            .replace(/^\.\//, "");
    }
    /**
     * Returns a canonical manifest key when the file is representable under the profiling base.
     * @param {string} filePath - Absolute test file path.
     * @returns {string | undefined} - Canonical relative path, or undefined for an external file.
     */
    manifestRelativePath(filePath) {
        const relativePath = path.relative(this._baseDirectory, filePath);
        if (!relativePath || path.isAbsolute(relativePath))
            return;
        if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`))
            return;
        return this.normalizeRelativePath(relativePath);
    }
    /**
     * Returns the first manifest entry matching a discovered test file.
     * @param {string} filePath - Absolute test file path.
     * @returns {number | undefined} - Recorded duration, including zero.
     */
    timingManifestDuration(filePath) {
        for (const manifestPath of this.timingManifestPaths(filePath)) {
            if (Object.hasOwn(this._timingManifest, manifestPath))
                return this._timingManifest[manifestPath];
        }
        return undefined;
    }
    /**
     * Returns compatible manifest keys for one discovered file.
     * @param {string} filePath - Absolute test file path.
     * @returns {string[]} - Canonical keys in matching priority order.
     */
    timingManifestPaths(filePath) {
        const relativePath = this.manifestRelativePath(filePath);
        if (!relativePath)
            return [];
        const projectRelativePath = this.normalizeRelativePath(path.join(path.basename(this._baseDirectory), relativePath));
        return relativePath === projectRelativePath ? [relativePath] : [relativePath, projectRelativePath];
    }
    /**
     * Summarizes timing-history coverage for the complete discovered suite.
     * @returns {{heuristicFiles: number, measuredFiles: number, staleEntries: number}} - Compact coverage counts.
     */
    getTimingManifestCoverage() {
        const matchedManifestPaths = new Set();
        let measuredFiles = 0;
        for (const filePath of this._testFiles) {
            let matchedDuration;
            for (const manifestPath of this.timingManifestPaths(filePath)) {
                if (!Object.hasOwn(this._timingManifest, manifestPath))
                    continue;
                matchedManifestPaths.add(manifestPath);
                matchedDuration = this._timingManifest[manifestPath];
                break;
            }
            if (matchedDuration !== undefined && matchedDuration > 0)
                measuredFiles++;
        }
        return {
            heuristicFiles: this._testFiles.length - measuredFiles,
            measuredFiles,
            staleEntries: Object.keys(this._timingManifest).length - matchedManifestPaths.size
        };
    }
    /**
     * Sorts files by weight descending, then by path for determinism.
     * @param {SplitterFileEntry[]} files - Weighted files.
     * @returns {SplitterFileEntry[]} - Sorted files.
     */
    sortByWeightDescending(files) {
        return [...files].sort((a, b) => {
            if (b.weight !== a.weight) {
                return b.weight - a.weight;
            }
            return compareTimingManifestPaths(a.filePath, b.filePath);
        });
    }
    /**
     * Distributes files greedily into N balanced groups.
     * Each file is assigned to the group with the least accumulated weight.
     * @param {SplitterFileEntry[]} sortedFiles - Files sorted by weight descending.
     * @returns {GroupBucket[]} - Array of group buckets.
     */
    distributeGreedily(sortedFiles) {
        /**
         * Buckets.
         * @type {GroupBucket[]} */
        const buckets = [];
        for (let i = 0; i < this._groups; i++) {
            buckets.push({ totalWeight: 0, files: [] });
        }
        for (const entry of sortedFiles) {
            const lightest = this.findLightestBucket(buckets);
            lightest.files.push(entry.filePath);
            lightest.totalWeight += entry.weight;
        }
        return buckets;
    }
    /**
     * Finds the bucket with the least accumulated weight.
     * Ties are broken by bucket index (earlier bucket wins) for determinism.
     * @param {GroupBucket[]} buckets - Group buckets.
     * @returns {GroupBucket} - The lightest bucket.
     */
    findLightestBucket(buckets) {
        let lightest = buckets[0];
        for (let i = 1; i < buckets.length; i++) {
            if (buckets[i].totalWeight < lightest.totalWeight) {
                lightest = buckets[i];
            }
        }
        return lightest;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1zdWl0ZS1zcGxpdHRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy90ZXN0aW5nL3Rlc3Qtc3VpdGUtc3BsaXR0ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sSUFBSSxNQUFNLE1BQU0sQ0FBQTtBQUN2QixPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUN2RCxPQUFPLEVBQUUsMkJBQTJCLEVBQUUsMEJBQTBCLEVBQUUsTUFBTSxzQkFBc0IsQ0FBQTtBQUU5Rjs7Ozs7R0FLRztBQUVIOzs7OztHQUtHO0FBRUgsOENBQThDO0FBQzlDLE1BQU0sY0FBYyxHQUFHLENBQUMsQ0FBQTtBQUV4Qjs7OztHQUlHO0FBQ0gsTUFBTSxpQkFBaUIsR0FBRztJQUN4QixNQUFNLEVBQUUsRUFBRTtJQUNWLGlCQUFpQixFQUFFLEVBQUU7SUFDckIsVUFBVSxFQUFFLENBQUM7Q0FDZCxDQUFBO0FBRUQsaUZBQWlGO0FBQ2pGLE1BQU0sdUJBQXVCLEdBQUcsQ0FBQyxDQUFBO0FBRWpDOzs7R0FHRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8saUJBQWlCO0lBQ3BDOzs7Ozs7OztPQVFHO0lBQ0gsWUFBWSxFQUFDLE1BQU0sRUFBRSxXQUFXLEVBQUUsU0FBUyxFQUFFLGFBQWEsRUFBRSxjQUFjLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDdEYsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZCLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxJQUFJLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUM1QyxNQUFNLElBQUksS0FBSyxDQUFDLDZDQUE2QyxNQUFNLEVBQUUsQ0FBQyxDQUFBO1FBQ3hFLENBQUM7UUFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsSUFBSSxXQUFXLEdBQUcsQ0FBQyxJQUFJLFdBQVcsR0FBRyxNQUFNLEVBQUUsQ0FBQztZQUM5RSxNQUFNLElBQUksS0FBSyxDQUFDLHdDQUF3QyxNQUFNLFVBQVUsV0FBVyxFQUFFLENBQUMsQ0FBQTtRQUN4RixDQUFDO1FBRUQsSUFBSSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUE7UUFDckIsSUFBSSxDQUFDLFlBQVksR0FBRyxXQUFXLENBQUE7UUFDL0IsSUFBSSxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUE7UUFDM0IsSUFBSSxDQUFDLGNBQWMsR0FBRyxhQUFhLElBQUksT0FBTyxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBQ3BELElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSSxDQUFDLHVCQUF1QixDQUFDLGNBQWMsQ0FBQyxDQUFBO0lBQ3JFLENBQUM7SUFFRDs7O09BR0c7SUFDSCxhQUFhO1FBQ1gsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUE7UUFDNUMsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3BELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUUvQyxPQUFPLE9BQU8sQ0FBQyxJQUFJLENBQUMsWUFBWSxHQUFHLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQTtJQUM3QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsb0JBQW9CO1FBQ2xCLE9BQU8sSUFBSSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxRQUFRLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDeEMsUUFBUTtZQUNSLE1BQU0sRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQztTQUNyQyxDQUFDLENBQUMsQ0FBQTtJQUNMLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsYUFBYSxDQUFDLFFBQVE7UUFDcEIsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXRELElBQUksUUFBUSxLQUFLLFNBQVMsSUFBSSxRQUFRLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDM0MsT0FBTyxRQUFRLENBQUE7UUFDakIsQ0FBQztRQUVELE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUN6RCxJQUFJLE1BQU0sR0FBRyxjQUFjLENBQUE7UUFFM0IscURBQXFEO1FBQ3JELGlHQUFpRztRQUNqRyxNQUFNLFlBQVksR0FBRyxZQUFZLENBQUMsS0FBSyxDQUFDLDJDQUEyQyxDQUFDLENBQUE7UUFFcEYsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUNqQixNQUFNLE9BQU8sR0FBRyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFFL0IsSUFBSSxpQkFBaUIsQ0FBQyxPQUFPLENBQUMsS0FBSyxTQUFTLEVBQUUsQ0FBQztnQkFDN0MsTUFBTSxHQUFHLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBQ3JDLENBQUM7UUFDSCxDQUFDO1FBRUQsaUNBQWlDO1FBQ2pDLElBQUksUUFBUSxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLFFBQVEsQ0FBQyxRQUFRLENBQUMsbUJBQW1CLENBQUMsRUFBRSxDQUFDO1lBQ3BGLE1BQU0sSUFBSSx1QkFBdUIsQ0FBQTtRQUNuQyxDQUFDO1FBRUQsT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHVCQUF1QixDQUFDLGNBQWM7UUFDcEMscUNBQXFDO1FBQ3JDLE1BQU0sVUFBVSxHQUFHLEVBQUUsQ0FBQTtRQUVyQixJQUFJLENBQUMsY0FBYyxJQUFJLE9BQU8sY0FBYyxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUM7WUFDM0YsT0FBTyxVQUFVLENBQUE7UUFDbkIsQ0FBQztRQUVELEtBQUssTUFBTSxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUM7WUFDbEUsSUFBSSxPQUFPLFFBQVEsS0FBSyxRQUFRLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFFBQVEsR0FBRyxDQUFDO2dCQUFFLFNBQVE7WUFFeEYsSUFBSSxDQUFDO2dCQUNILFVBQVUsQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsUUFBUSxDQUFDLENBQUMsR0FBRyxRQUFRLENBQUE7WUFDN0QsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsSUFBSSxDQUFDLENBQUMsS0FBSyxZQUFZLEtBQUssQ0FBQztvQkFBRSxNQUFNLEtBQUssQ0FBQTtZQUM1QyxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sVUFBVSxDQUFBO0lBQ25CLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gscUJBQXFCLENBQUMsUUFBUTtRQUM1QixPQUFPLDJCQUEyQixDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBQzlDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gscUJBQXFCLENBQUMsUUFBUTtRQUM1QixPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxRQUFRLENBQUM7YUFDaEQsVUFBVSxDQUFDLElBQUksRUFBRSxHQUFHLENBQUM7YUFDckIsT0FBTyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUN6QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILG9CQUFvQixDQUFDLFFBQVE7UUFDM0IsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLFFBQVEsQ0FBQyxDQUFBO1FBRWpFLElBQUksQ0FBQyxZQUFZLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxZQUFZLENBQUM7WUFBRSxPQUFNO1FBQzFELElBQUksWUFBWSxLQUFLLElBQUksSUFBSSxZQUFZLENBQUMsVUFBVSxDQUFDLEtBQUssSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1lBQUUsT0FBTTtRQUU3RSxPQUFPLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxZQUFZLENBQUMsQ0FBQTtJQUNqRCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHNCQUFzQixDQUFDLFFBQVE7UUFDN0IsS0FBSyxNQUFNLFlBQVksSUFBSSxJQUFJLENBQUMsbUJBQW1CLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQztZQUM5RCxJQUFJLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGVBQWUsRUFBRSxZQUFZLENBQUM7Z0JBQUUsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFDLFlBQVksQ0FBQyxDQUFBO1FBQ2xHLENBQUM7UUFFRCxPQUFPLFNBQVMsQ0FBQTtJQUNsQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILG1CQUFtQixDQUFDLFFBQVE7UUFDMUIsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXhELElBQUksQ0FBQyxZQUFZO1lBQUUsT0FBTyxFQUFFLENBQUE7UUFFNUIsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLENBQUMscUJBQXFCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBRSxZQUFZLENBQUMsQ0FBQyxDQUFBO1FBRW5ILE9BQU8sWUFBWSxLQUFLLG1CQUFtQixDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksRUFBRSxtQkFBbUIsQ0FBQyxDQUFBO0lBQ3BHLENBQUM7SUFFRDs7O09BR0c7SUFDSCx5QkFBeUI7UUFDdkIsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQ3RDLElBQUksYUFBYSxHQUFHLENBQUMsQ0FBQTtRQUVyQixLQUFLLE1BQU0sUUFBUSxJQUFJLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUN2QyxJQUFJLGVBQWUsQ0FBQTtZQUVuQixLQUFLLE1BQU0sWUFBWSxJQUFJLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO2dCQUM5RCxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsZUFBZSxFQUFFLFlBQVksQ0FBQztvQkFBRSxTQUFRO2dCQUVoRSxvQkFBb0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUE7Z0JBQ3RDLGVBQWUsR0FBRyxJQUFJLENBQUMsZUFBZSxDQUFDLFlBQVksQ0FBQyxDQUFBO2dCQUNwRCxNQUFLO1lBQ1AsQ0FBQztZQUVELElBQUksZUFBZSxLQUFLLFNBQVMsSUFBSSxlQUFlLEdBQUcsQ0FBQztnQkFBRSxhQUFhLEVBQUUsQ0FBQTtRQUMzRSxDQUFDO1FBRUQsT0FBTztZQUNMLGNBQWMsRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sR0FBRyxhQUFhO1lBQ3RELGFBQWE7WUFDYixZQUFZLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUMsTUFBTSxHQUFHLG9CQUFvQixDQUFDLElBQUk7U0FDbkYsQ0FBQTtJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsc0JBQXNCLENBQUMsS0FBSztRQUMxQixPQUFPLENBQUMsR0FBRyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUU7WUFDOUIsSUFBSSxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDMUIsT0FBTyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUE7WUFDNUIsQ0FBQztZQUVELE9BQU8sMEJBQTBCLENBQUMsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDM0QsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxrQkFBa0IsQ0FBQyxXQUFXO1FBQzVCOzttQ0FFMkI7UUFDM0IsTUFBTSxPQUFPLEdBQUcsRUFBRSxDQUFBO1FBRWxCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDdEMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFDLFdBQVcsRUFBRSxDQUFDLEVBQUUsS0FBSyxFQUFFLEVBQUUsRUFBQyxDQUFDLENBQUE7UUFDM0MsQ0FBQztRQUVELEtBQUssTUFBTSxLQUFLLElBQUksV0FBVyxFQUFFLENBQUM7WUFDaEMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLE9BQU8sQ0FBQyxDQUFBO1lBRWpELFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUNuQyxRQUFRLENBQUMsV0FBVyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUE7UUFDdEMsQ0FBQztRQUVELE9BQU8sT0FBTyxDQUFBO0lBQ2hCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILGtCQUFrQixDQUFDLE9BQU87UUFDeEIsSUFBSSxRQUFRLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRXpCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxPQUFPLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDeEMsSUFBSSxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxHQUFHLFFBQVEsQ0FBQyxXQUFXLEVBQUUsQ0FBQztnQkFDbEQsUUFBUSxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUN2QixDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sUUFBUSxDQUFBO0lBQ2pCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCB7IGNhbm9uaWNhbFRpbWluZ01hbmlmZXN0UGF0aCwgY29tcGFyZVRpbWluZ01hbmlmZXN0UGF0aHMgfSBmcm9tIFwiLi90aW1pbmctbWFuaWZlc3QuanNcIlxuXG4vKipcbiAqIFNwbGl0dGVyRmlsZUVudHJ5IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTcGxpdHRlckZpbGVFbnRyeVxuICogQHByb3BlcnR5IHtzdHJpbmd9IGZpbGVQYXRoIC0gQWJzb2x1dGUgZmlsZSBwYXRoLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHdlaWdodCAtIENvbXB1dGVkIHdlaWdodCBmb3IgbG9hZCBiYWxhbmNpbmcuXG4gKi9cblxuLyoqXG4gKiBHcm91cEJ1Y2tldCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gR3JvdXBCdWNrZXRcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSB0b3RhbFdlaWdodCAtIEFjY3VtdWxhdGVkIHdlaWdodC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IGZpbGVzIC0gRmlsZXMgYXNzaWduZWQgdG8gdGhpcyBncm91cC5cbiAqL1xuXG4vKiogRGVmYXVsdCB3ZWlnaHQgZm9yIGEgcmVndWxhciB0ZXN0IGZpbGUuICovXG5jb25zdCBERUZBVUxUX1dFSUdIVCA9IDFcblxuLyoqXG4gKiBXZWlnaHQgbXVsdGlwbGllcnMgYnkgc3BlYyBkaXJlY3RvcnkgbmFtZS5cbiAqIEhlYXZpZXIgdGVzdCB0eXBlcyBnZXQgaGlnaGVyIHdlaWdodHMgc28gZ3JlZWR5IGRpc3RyaWJ1dGlvbiBiYWxhbmNlcyB3YWxsLWNsb2NrIHRpbWUuXG4gKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn1cbiAqL1xuY29uc3QgRElSRUNUT1JZX1dFSUdIVFMgPSB7XG4gIHN5c3RlbTogMjAsXG4gIFwiZnJvbnRlbmQtbW9kZWxzXCI6IDEwLFxuICBjb250cm9sbGVyOiAzXG59XG5cbi8qKiBFeHRyYSBtdWx0aXBsaWVyIGFwcGxpZWQgdG8gYnJvd3NlciBzcGVjIGZpbGVzIG9uIHRvcCBvZiBkaXJlY3Rvcnkgd2VpZ2h0LiAqL1xuY29uc3QgQlJPV1NFUl9TUEVDX01VTFRJUExJRVIgPSAyXG5cbi8qKlxuICogU3BsaXRzIGEgbGlzdCBvZiB0ZXN0IGZpbGVzIGludG8gYmFsYW5jZWQgZ3JvdXBzIHVzaW5nIGEgZ3JlZWR5IGxvYWQtYmFsYW5jaW5nIGFsZ29yaXRobS5cbiAqIE1vZGVsZWQgYWZ0ZXIgdGVzdF9zdWl0ZV9zcGxpdHRlciBmb3IgUlNwZWMuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRlc3RTdWl0ZVNwbGl0dGVyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuZ3JvdXBzIC0gVG90YWwgbnVtYmVyIG9mIGdyb3Vwcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuZ3JvdXBOdW1iZXIgLSBXaGljaCBncm91cCB0byByZXR1cm4gKDEtaW5kZXhlZCkuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MudGVzdEZpbGVzIC0gQWxsIGRpc2NvdmVyZWQgdGVzdCBmaWxlIHBhdGhzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuYmFzZURpcmVjdG9yeV0gLSBCYXNlIGRpcmVjdG9yeSBmb3IgcmVsYXRpdmUgcGF0aCBjb21wdXRhdGlvbi5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3MudGltaW5nTWFuaWZlc3RdIC0gUmVsYXRpdmUgdGVzdCBwYXRocyBtYXBwZWQgdG8gZHVyYXRpb25zLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2dyb3VwcywgZ3JvdXBOdW1iZXIsIHRlc3RGaWxlcywgYmFzZURpcmVjdG9yeSwgdGltaW5nTWFuaWZlc3QsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIoZ3JvdXBzKSB8fCBncm91cHMgPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYC0tZ3JvdXBzIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyLCBnb3Q6ICR7Z3JvdXBzfWApXG4gICAgfVxuXG4gICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKGdyb3VwTnVtYmVyKSB8fCBncm91cE51bWJlciA8IDEgfHwgZ3JvdXBOdW1iZXIgPiBncm91cHMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgLS1ncm91cC1udW1iZXIgbXVzdCBiZSBiZXR3ZWVuIDEgYW5kICR7Z3JvdXBzfSwgZ290OiAke2dyb3VwTnVtYmVyfWApXG4gICAgfVxuXG4gICAgdGhpcy5fZ3JvdXBzID0gZ3JvdXBzXG4gICAgdGhpcy5fZ3JvdXBOdW1iZXIgPSBncm91cE51bWJlclxuICAgIHRoaXMuX3Rlc3RGaWxlcyA9IHRlc3RGaWxlc1xuICAgIHRoaXMuX2Jhc2VEaXJlY3RvcnkgPSBiYXNlRGlyZWN0b3J5IHx8IHByb2Nlc3MuY3dkKClcbiAgICB0aGlzLl90aW1pbmdNYW5pZmVzdCA9IHRoaXMubm9ybWFsaXplVGltaW5nTWFuaWZlc3QodGltaW5nTWFuaWZlc3QpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgdGVzdCBmaWxlcyBhc3NpZ25lZCB0byB0aGlzIGdyb3VwLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gRmlsZSBwYXRocyBmb3IgdGhlIHJlcXVlc3RlZCBncm91cC5cbiAgICovXG4gIGdldEdyb3VwRmlsZXMoKSB7XG4gICAgY29uc3Qgd2VpZ2h0ZWQgPSB0aGlzLmNvbXB1dGVXZWlnaHRlZEZpbGVzKClcbiAgICBjb25zdCBzb3J0ZWQgPSB0aGlzLnNvcnRCeVdlaWdodERlc2NlbmRpbmcod2VpZ2h0ZWQpXG4gICAgY29uc3QgYnVja2V0cyA9IHRoaXMuZGlzdHJpYnV0ZUdyZWVkaWx5KHNvcnRlZClcblxuICAgIHJldHVybiBidWNrZXRzW3RoaXMuX2dyb3VwTnVtYmVyIC0gMV0uZmlsZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wdXRlcyB3ZWlnaHQgZm9yIGVhY2ggdGVzdCBmaWxlIGJhc2VkIG9uIGRpcmVjdG9yeSB0eXBlIGFuZCBmaWxlIHN1ZmZpeC5cbiAgICogQHJldHVybnMge1NwbGl0dGVyRmlsZUVudHJ5W119IC0gV2VpZ2h0ZWQgZmlsZSBlbnRyaWVzLlxuICAgKi9cbiAgY29tcHV0ZVdlaWdodGVkRmlsZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3Rlc3RGaWxlcy5tYXAoKGZpbGVQYXRoKSA9PiAoe1xuICAgICAgZmlsZVBhdGgsXG4gICAgICB3ZWlnaHQ6IHRoaXMuY29tcHV0ZVdlaWdodChmaWxlUGF0aClcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wdXRlcyB0aGUgd2VpZ2h0IGZvciBhIHNpbmdsZSBmaWxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBBYnNvbHV0ZSBmaWxlIHBhdGguXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gV2VpZ2h0IHZhbHVlLlxuICAgKi9cbiAgY29tcHV0ZVdlaWdodChmaWxlUGF0aCkge1xuICAgIGNvbnN0IGR1cmF0aW9uID0gdGhpcy50aW1pbmdNYW5pZmVzdER1cmF0aW9uKGZpbGVQYXRoKVxuXG4gICAgaWYgKGR1cmF0aW9uICE9PSB1bmRlZmluZWQgJiYgZHVyYXRpb24gPiAwKSB7XG4gICAgICByZXR1cm4gZHVyYXRpb25cbiAgICB9XG5cbiAgICBjb25zdCByZWxhdGl2ZVBhdGggPSB0aGlzLmhldXJpc3RpY1JlbGF0aXZlUGF0aChmaWxlUGF0aClcbiAgICBsZXQgd2VpZ2h0ID0gREVGQVVMVF9XRUlHSFRcblxuICAgIC8vIEV4dHJhY3QgdGhlIHR5cGUgZGlyZWN0b3J5IGZyb20gdGhlIHJlbGF0aXZlIHBhdGguXG4gICAgLy8gTWF0Y2hlcyBib3RoIFwic3BlYy9zeXN0ZW0vLi4uXCIgKGJhc2UgaXMgcHJvamVjdCByb290KSBhbmQgXCJzeXN0ZW0vLi4uXCIgKGJhc2UgaXMgc3BlYy8gaXRzZWxmKS5cbiAgICBjb25zdCBzcGVjRGlyTWF0Y2ggPSByZWxhdGl2ZVBhdGgubWF0Y2goL14oPzooPzpzcGVjfF9fdGVzdHNfX3x0ZXN0cylcXC8pPyhbXi9dKylcXC8vKVxuXG4gICAgaWYgKHNwZWNEaXJNYXRjaCkge1xuICAgICAgY29uc3QgZGlyTmFtZSA9IHNwZWNEaXJNYXRjaFsxXVxuXG4gICAgICBpZiAoRElSRUNUT1JZX1dFSUdIVFNbZGlyTmFtZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB3ZWlnaHQgPSBESVJFQ1RPUllfV0VJR0hUU1tkaXJOYW1lXVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEJyb3dzZXIgc3BlYyBmaWxlcyBhcmUgaGVhdmllclxuICAgIGlmIChmaWxlUGF0aC5lbmRzV2l0aChcIi5icm93c2VyLXNwZWMuanNcIikgfHwgZmlsZVBhdGguZW5kc1dpdGgoXCIuYnJvd3Nlci1zcGVjLm1qc1wiKSkge1xuICAgICAgd2VpZ2h0ICo9IEJST1dTRVJfU1BFQ19NVUxUSVBMSUVSXG4gICAgfVxuXG4gICAgcmV0dXJuIHdlaWdodFxuICB9XG5cbiAgLyoqXG4gICAqIEtlZXBzIG9ubHkgdXNhYmxlIHBvc2l0aXZlIGZpbml0ZSBkdXJhdGlvbiBlbnRyaWVzIGtleWVkIGJ5IG5vcm1hbGl6ZWQgcmVsYXRpdmUgcGF0aC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdGltaW5nTWFuaWZlc3QgLSBQYXJzZWQgdGltaW5nIG1hbmlmZXN0LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gLSBWYWxpZCBub3JtYWxpemVkIGR1cmF0aW9uIHdlaWdodHMuXG4gICAqL1xuICBub3JtYWxpemVUaW1pbmdNYW5pZmVzdCh0aW1pbmdNYW5pZmVzdCkge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBub3JtYWxpemVkID0ge31cblxuICAgIGlmICghdGltaW5nTWFuaWZlc3QgfHwgdHlwZW9mIHRpbWluZ01hbmlmZXN0ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodGltaW5nTWFuaWZlc3QpKSB7XG4gICAgICByZXR1cm4gbm9ybWFsaXplZFxuICAgIH1cblxuICAgIGZvciAoY29uc3QgW2ZpbGVQYXRoLCBkdXJhdGlvbl0gb2YgT2JqZWN0LmVudHJpZXModGltaW5nTWFuaWZlc3QpKSB7XG4gICAgICBpZiAodHlwZW9mIGR1cmF0aW9uICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUoZHVyYXRpb24pIHx8IGR1cmF0aW9uIDwgMCkgY29udGludWVcblxuICAgICAgdHJ5IHtcbiAgICAgICAgbm9ybWFsaXplZFt0aGlzLm5vcm1hbGl6ZVJlbGF0aXZlUGF0aChmaWxlUGF0aCldID0gZHVyYXRpb25cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpKSB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBub3JtYWxpemVkXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIHJlbGF0aXZlIHRlc3QgcGF0aCB0byB0aGUgbWFuaWZlc3QncyBwb3J0YWJsZSBzbGFzaCBmb3JtYXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFJlbGF0aXZlIHRlc3QgcGF0aC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBOb3JtYWxpemVkIHJlbGF0aXZlIHRlc3QgcGF0aC5cbiAgICovXG4gIG5vcm1hbGl6ZVJlbGF0aXZlUGF0aChmaWxlUGF0aCkge1xuICAgIHJldHVybiBjYW5vbmljYWxUaW1pbmdNYW5pZmVzdFBhdGgoZmlsZVBhdGgpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgcGVybWlzc2l2ZSByZWxhdGl2ZSBwYXRoIHVzZWQgb25seSBmb3IgaGV1cmlzdGljIGNsYXNzaWZpY2F0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBBYnNvbHV0ZSB0ZXN0IGZpbGUgcGF0aC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBQb3J0YWJsZSByZWxhdGl2ZSBwYXRoIHdoaWNoIG1heSBlc2NhcGUgdGhlIHByb2ZpbGluZyBiYXNlLlxuICAgKi9cbiAgaGV1cmlzdGljUmVsYXRpdmVQYXRoKGZpbGVQYXRoKSB7XG4gICAgcmV0dXJuIHBhdGgucmVsYXRpdmUodGhpcy5fYmFzZURpcmVjdG9yeSwgZmlsZVBhdGgpXG4gICAgICAucmVwbGFjZUFsbChcIlxcXFxcIiwgXCIvXCIpXG4gICAgICAucmVwbGFjZSgvXlxcLlxcLy8sIFwiXCIpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIGNhbm9uaWNhbCBtYW5pZmVzdCBrZXkgd2hlbiB0aGUgZmlsZSBpcyByZXByZXNlbnRhYmxlIHVuZGVyIHRoZSBwcm9maWxpbmcgYmFzZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gQWJzb2x1dGUgdGVzdCBmaWxlIHBhdGguXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQ2Fub25pY2FsIHJlbGF0aXZlIHBhdGgsIG9yIHVuZGVmaW5lZCBmb3IgYW4gZXh0ZXJuYWwgZmlsZS5cbiAgICovXG4gIG1hbmlmZXN0UmVsYXRpdmVQYXRoKGZpbGVQYXRoKSB7XG4gICAgY29uc3QgcmVsYXRpdmVQYXRoID0gcGF0aC5yZWxhdGl2ZSh0aGlzLl9iYXNlRGlyZWN0b3J5LCBmaWxlUGF0aClcblxuICAgIGlmICghcmVsYXRpdmVQYXRoIHx8IHBhdGguaXNBYnNvbHV0ZShyZWxhdGl2ZVBhdGgpKSByZXR1cm5cbiAgICBpZiAocmVsYXRpdmVQYXRoID09PSBcIi4uXCIgfHwgcmVsYXRpdmVQYXRoLnN0YXJ0c1dpdGgoYC4uJHtwYXRoLnNlcH1gKSkgcmV0dXJuXG5cbiAgICByZXR1cm4gdGhpcy5ub3JtYWxpemVSZWxhdGl2ZVBhdGgocmVsYXRpdmVQYXRoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGZpcnN0IG1hbmlmZXN0IGVudHJ5IG1hdGNoaW5nIGEgZGlzY292ZXJlZCB0ZXN0IGZpbGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIEFic29sdXRlIHRlc3QgZmlsZSBwYXRoLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIFJlY29yZGVkIGR1cmF0aW9uLCBpbmNsdWRpbmcgemVyby5cbiAgICovXG4gIHRpbWluZ01hbmlmZXN0RHVyYXRpb24oZmlsZVBhdGgpIHtcbiAgICBmb3IgKGNvbnN0IG1hbmlmZXN0UGF0aCBvZiB0aGlzLnRpbWluZ01hbmlmZXN0UGF0aHMoZmlsZVBhdGgpKSB7XG4gICAgICBpZiAoT2JqZWN0Lmhhc093bih0aGlzLl90aW1pbmdNYW5pZmVzdCwgbWFuaWZlc3RQYXRoKSkgcmV0dXJuIHRoaXMuX3RpbWluZ01hbmlmZXN0W21hbmlmZXN0UGF0aF1cbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBjb21wYXRpYmxlIG1hbmlmZXN0IGtleXMgZm9yIG9uZSBkaXNjb3ZlcmVkIGZpbGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIEFic29sdXRlIHRlc3QgZmlsZSBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gQ2Fub25pY2FsIGtleXMgaW4gbWF0Y2hpbmcgcHJpb3JpdHkgb3JkZXIuXG4gICAqL1xuICB0aW1pbmdNYW5pZmVzdFBhdGhzKGZpbGVQYXRoKSB7XG4gICAgY29uc3QgcmVsYXRpdmVQYXRoID0gdGhpcy5tYW5pZmVzdFJlbGF0aXZlUGF0aChmaWxlUGF0aClcblxuICAgIGlmICghcmVsYXRpdmVQYXRoKSByZXR1cm4gW11cblxuICAgIGNvbnN0IHByb2plY3RSZWxhdGl2ZVBhdGggPSB0aGlzLm5vcm1hbGl6ZVJlbGF0aXZlUGF0aChwYXRoLmpvaW4ocGF0aC5iYXNlbmFtZSh0aGlzLl9iYXNlRGlyZWN0b3J5KSwgcmVsYXRpdmVQYXRoKSlcblxuICAgIHJldHVybiByZWxhdGl2ZVBhdGggPT09IHByb2plY3RSZWxhdGl2ZVBhdGggPyBbcmVsYXRpdmVQYXRoXSA6IFtyZWxhdGl2ZVBhdGgsIHByb2plY3RSZWxhdGl2ZVBhdGhdXG4gIH1cblxuICAvKipcbiAgICogU3VtbWFyaXplcyB0aW1pbmctaGlzdG9yeSBjb3ZlcmFnZSBmb3IgdGhlIGNvbXBsZXRlIGRpc2NvdmVyZWQgc3VpdGUuXG4gICAqIEByZXR1cm5zIHt7aGV1cmlzdGljRmlsZXM6IG51bWJlciwgbWVhc3VyZWRGaWxlczogbnVtYmVyLCBzdGFsZUVudHJpZXM6IG51bWJlcn19IC0gQ29tcGFjdCBjb3ZlcmFnZSBjb3VudHMuXG4gICAqL1xuICBnZXRUaW1pbmdNYW5pZmVzdENvdmVyYWdlKCkge1xuICAgIGNvbnN0IG1hdGNoZWRNYW5pZmVzdFBhdGhzID0gbmV3IFNldCgpXG4gICAgbGV0IG1lYXN1cmVkRmlsZXMgPSAwXG5cbiAgICBmb3IgKGNvbnN0IGZpbGVQYXRoIG9mIHRoaXMuX3Rlc3RGaWxlcykge1xuICAgICAgbGV0IG1hdGNoZWREdXJhdGlvblxuXG4gICAgICBmb3IgKGNvbnN0IG1hbmlmZXN0UGF0aCBvZiB0aGlzLnRpbWluZ01hbmlmZXN0UGF0aHMoZmlsZVBhdGgpKSB7XG4gICAgICAgIGlmICghT2JqZWN0Lmhhc093bih0aGlzLl90aW1pbmdNYW5pZmVzdCwgbWFuaWZlc3RQYXRoKSkgY29udGludWVcblxuICAgICAgICBtYXRjaGVkTWFuaWZlc3RQYXRocy5hZGQobWFuaWZlc3RQYXRoKVxuICAgICAgICBtYXRjaGVkRHVyYXRpb24gPSB0aGlzLl90aW1pbmdNYW5pZmVzdFttYW5pZmVzdFBhdGhdXG4gICAgICAgIGJyZWFrXG4gICAgICB9XG5cbiAgICAgIGlmIChtYXRjaGVkRHVyYXRpb24gIT09IHVuZGVmaW5lZCAmJiBtYXRjaGVkRHVyYXRpb24gPiAwKSBtZWFzdXJlZEZpbGVzKytcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgaGV1cmlzdGljRmlsZXM6IHRoaXMuX3Rlc3RGaWxlcy5sZW5ndGggLSBtZWFzdXJlZEZpbGVzLFxuICAgICAgbWVhc3VyZWRGaWxlcyxcbiAgICAgIHN0YWxlRW50cmllczogT2JqZWN0LmtleXModGhpcy5fdGltaW5nTWFuaWZlc3QpLmxlbmd0aCAtIG1hdGNoZWRNYW5pZmVzdFBhdGhzLnNpemVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU29ydHMgZmlsZXMgYnkgd2VpZ2h0IGRlc2NlbmRpbmcsIHRoZW4gYnkgcGF0aCBmb3IgZGV0ZXJtaW5pc20uXG4gICAqIEBwYXJhbSB7U3BsaXR0ZXJGaWxlRW50cnlbXX0gZmlsZXMgLSBXZWlnaHRlZCBmaWxlcy5cbiAgICogQHJldHVybnMge1NwbGl0dGVyRmlsZUVudHJ5W119IC0gU29ydGVkIGZpbGVzLlxuICAgKi9cbiAgc29ydEJ5V2VpZ2h0RGVzY2VuZGluZyhmaWxlcykge1xuICAgIHJldHVybiBbLi4uZmlsZXNdLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgIGlmIChiLndlaWdodCAhPT0gYS53ZWlnaHQpIHtcbiAgICAgICAgcmV0dXJuIGIud2VpZ2h0IC0gYS53ZWlnaHRcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGNvbXBhcmVUaW1pbmdNYW5pZmVzdFBhdGhzKGEuZmlsZVBhdGgsIGIuZmlsZVBhdGgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXN0cmlidXRlcyBmaWxlcyBncmVlZGlseSBpbnRvIE4gYmFsYW5jZWQgZ3JvdXBzLlxuICAgKiBFYWNoIGZpbGUgaXMgYXNzaWduZWQgdG8gdGhlIGdyb3VwIHdpdGggdGhlIGxlYXN0IGFjY3VtdWxhdGVkIHdlaWdodC5cbiAgICogQHBhcmFtIHtTcGxpdHRlckZpbGVFbnRyeVtdfSBzb3J0ZWRGaWxlcyAtIEZpbGVzIHNvcnRlZCBieSB3ZWlnaHQgZGVzY2VuZGluZy5cbiAgICogQHJldHVybnMge0dyb3VwQnVja2V0W119IC0gQXJyYXkgb2YgZ3JvdXAgYnVja2V0cy5cbiAgICovXG4gIGRpc3RyaWJ1dGVHcmVlZGlseShzb3J0ZWRGaWxlcykge1xuICAgIC8qKlxuICAgICAqIEJ1Y2tldHMuXG4gICAgICogQHR5cGUge0dyb3VwQnVja2V0W119ICovXG4gICAgY29uc3QgYnVja2V0cyA9IFtdXG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuX2dyb3VwczsgaSsrKSB7XG4gICAgICBidWNrZXRzLnB1c2goe3RvdGFsV2VpZ2h0OiAwLCBmaWxlczogW119KVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc29ydGVkRmlsZXMpIHtcbiAgICAgIGNvbnN0IGxpZ2h0ZXN0ID0gdGhpcy5maW5kTGlnaHRlc3RCdWNrZXQoYnVja2V0cylcblxuICAgICAgbGlnaHRlc3QuZmlsZXMucHVzaChlbnRyeS5maWxlUGF0aClcbiAgICAgIGxpZ2h0ZXN0LnRvdGFsV2VpZ2h0ICs9IGVudHJ5LndlaWdodFxuICAgIH1cblxuICAgIHJldHVybiBidWNrZXRzXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIGJ1Y2tldCB3aXRoIHRoZSBsZWFzdCBhY2N1bXVsYXRlZCB3ZWlnaHQuXG4gICAqIFRpZXMgYXJlIGJyb2tlbiBieSBidWNrZXQgaW5kZXggKGVhcmxpZXIgYnVja2V0IHdpbnMpIGZvciBkZXRlcm1pbmlzbS5cbiAgICogQHBhcmFtIHtHcm91cEJ1Y2tldFtdfSBidWNrZXRzIC0gR3JvdXAgYnVja2V0cy5cbiAgICogQHJldHVybnMge0dyb3VwQnVja2V0fSAtIFRoZSBsaWdodGVzdCBidWNrZXQuXG4gICAqL1xuICBmaW5kTGlnaHRlc3RCdWNrZXQoYnVja2V0cykge1xuICAgIGxldCBsaWdodGVzdCA9IGJ1Y2tldHNbMF1cblxuICAgIGZvciAobGV0IGkgPSAxOyBpIDwgYnVja2V0cy5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKGJ1Y2tldHNbaV0udG90YWxXZWlnaHQgPCBsaWdodGVzdC50b3RhbFdlaWdodCkge1xuICAgICAgICBsaWdodGVzdCA9IGJ1Y2tldHNbaV1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbGlnaHRlc3RcbiAgfVxufVxuIl19