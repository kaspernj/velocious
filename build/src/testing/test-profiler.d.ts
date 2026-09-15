import { TestProfiler as PackageTestProfiler, roundProfileDuration } from "@velocious/testing/node";
export type TestProfileAsyncContext = import("@velocious/testing/node").TestProfileAsyncContext;
export type TestProfileAttemptHandle = import("@velocious/testing/node").TestProfileAttemptHandle;
export type TestProfileAttemptStatus = import("@velocious/testing/node").TestProfileAttemptStatus;
/** @typedef {import("@velocious/testing/node").TestProfileAsyncContext} TestProfileAsyncContext */
/** @typedef {import("@velocious/testing/node").TestProfileAttemptHandle} TestProfileAttemptHandle */
/** @typedef {import("@velocious/testing/node").TestProfileAttemptStatus} TestProfileAttemptStatus */
export { roundProfileDuration };
/** Velocious compatibility facade around the package-owned profiler. */
export default class TestProfiler extends PackageTestProfiler {
    /**
     * Creates the package profiler with Velocious environment context.
     * @param {object} args - Profiler options.
     * @param {import("../configuration.js").default} args.configuration - Test configuration.
     * @param {string} args.projectDirectory - Project root used for portable paths.
     * @param {Partial<import("@velocious/testing/node").TestProfileSelection>} [args.selection] - Selection metadata.
     */
    constructor({ configuration, projectDirectory, selection, ...restArgs }: {
        configuration: import("../configuration.js").default;
        projectDirectory: string;
        selection?: Partial<import("@velocious/testing/node").TestProfileSelection>;
    });
}
//# sourceMappingURL=test-profiler.d.ts.map