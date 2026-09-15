import BaseCommand from "../../../../cli/base-command.js";
import { loadTimingManifest, resolveTestProfileOptions } from "../../../../testing/test-profile-output.js";
export default class VelociousCliCommandsTest extends BaseCommand {
    execute(): Promise<void>;
}
export { loadTimingManifest, resolveTestProfileOptions };
/**
 * Resolves how many slowest tests to report from the `VELOCIOUS_SLOW_TEST_COUNT`
 * env value: defaults to 10 when unset; 0 (or an unparseable value) disables the
 * report; otherwise the floored, non-negative integer.
 * @param {string | undefined} rawEnvValue - Raw env value.
 * @returns {number} - Number of slowest tests to report (0 disables).
 */
export declare function resolveSlowTestCount(rawEnvValue: string | undefined): number;
//# sourceMappingURL=test.d.ts.map