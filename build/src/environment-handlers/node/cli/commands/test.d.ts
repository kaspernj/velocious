import BaseCommand from "../../../../cli/base-command.js";
export default class VelociousCliCommandsTest extends BaseCommand {
    execute(): Promise<void>;
}
/**
 * Resolves and validates profiling paths before test discovery starts.
 * @param {object} args - Raw profiling options.
 * @param {string} args.cwd - Command working directory.
 * @param {boolean} args.profile - Whether console profiling was requested.
 * @param {string} [args.profileJsonPath] - Rich profile output path.
 * @param {string} [args.timingManifestPath] - Timing manifest input path.
 * @param {string} [args.timingManifestOutputPath] - Timing manifest output path.
 * @returns {{profile: boolean, profileJsonPath: string | undefined, timingManifestPath: string | undefined, timingManifestOutputPath: string | undefined}} - Resolved profiling options.
 */
export declare function resolveTestProfileOptions({ cwd, profile, profileJsonPath, timingManifestPath, timingManifestOutputPath }: {
    cwd: string;
    profile: boolean;
    profileJsonPath?: string;
    timingManifestPath?: string;
    timingManifestOutputPath?: string;
}): {
    profile: boolean;
    profileJsonPath: string | undefined;
    timingManifestPath: string | undefined;
    timingManifestOutputPath: string | undefined;
};
/**
 * Loads and validates an explicitly supplied plain JSON timing manifest.
 * @param {string | undefined} timingManifestPath - Timing manifest path.
 * @returns {Promise<Record<string, number> | undefined>} - Canonical manifest, or undefined when not requested.
 */
export declare function loadTimingManifest(timingManifestPath: string | undefined): Promise<Record<string, number> | undefined>;
/**
 * Resolves how many slowest tests to report from the `VELOCIOUS_SLOW_TEST_COUNT`
 * env value: defaults to 10 when unset; 0 (or an unparseable value) disables the
 * report; otherwise the floored, non-negative integer.
 * @param {string | undefined} rawEnvValue - Raw env value.
 * @returns {number} - Number of slowest tests to report (0 disables).
 */
export declare function resolveSlowTestCount(rawEnvValue: string | undefined): number;
//# sourceMappingURL=test.d.ts.map