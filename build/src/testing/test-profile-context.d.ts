/**
 * Enables profile-context lookup for one configuration only when a collector exists.
 * @param {import("../configuration.js").default} configuration - Configuration identity.
 * @param {() => import("./test-profiler.js").TestProfileAsyncContext | undefined} reader - Async-context reader.
 * @returns {void}
 */
export declare function registerTestProfileContextReader(configuration: import("../configuration.js").default, reader: () => import("./test-profiler.js").TestProfileAsyncContext | undefined): void;
/**
 * Gets an active profile context without requiring configuration doubles to
 * implement profiling APIs and without reading async context in normal runs.
 * @param {import("../configuration.js").default} configuration - Configuration identity.
 * @returns {import("./test-profiler.js").TestProfileAsyncContext | undefined} - Active context.
 */
export declare function currentTestProfileContext(configuration: import("../configuration.js").default): import("./test-profiler.js").TestProfileAsyncContext | undefined;
//# sourceMappingURL=test-profile-context.d.ts.map