export type SyncUpstreamImportResult<T> = {
    /**
     * - Whether the upstream import ran (coalesced callers share the one run's outcome); false only when the throttle window suppressed the run.
     */
    imported: boolean;
    /**
     * - The importer's return value, or undefined when skipped.
     */
    result: T | undefined;
};
/**
 * The outcome of an SyncUpstreamImporter import call.
 * @template T
 * @typedef {object} SyncUpstreamImportResult
 * @property {boolean} imported - Whether the upstream import ran (coalesced callers share the one run's outcome); false only when the throttle window suppressed the run.
 * @property {T | undefined} result - The importer's return value, or undefined when skipped.
 */
/**
 * Coalesces and throttles upstream imports that keep a sync feed self-sustaining.
 *
 * Apps serving a sync changes feed often need a slow upstream (for example a
 * legacy database) imported before the feed is served, so a pull returns fresh
 * data without the client calling a bespoke trigger endpoint first. This
 * importer owns the two generic mechanics that kind of trigger needs:
 *
 * - Coalescing: concurrent imports for the same key share one in-flight run, so
 *   a burst of pulls (sign-in, reconnect, several devices) starts exactly one
 *   upstream import.
 * - Throttling: callers that may pull very frequently (auto-resync, statistics
 *   screens) declare `throttleMs` and repeats inside the window skip the
 *   upstream run, because the feed already holds everything the last import
 *   found. A caller that must always import (for example an explicit legacy
 *   endpoint) simply omits `throttleMs`; its successful run still freshens the
 *   shared timestamp, so subsequent throttled callers see the feed as fresh.
 *
 * Failures propagate to every awaiter and never start the throttle window, so
 * the next call retries the upstream import.
 */
export default class SyncUpstreamImporter {
    maxSuccessAgeMs: number;
    now: () => number;
    /** @type {Map<string, Promise<SyncUpstreamImportResult<unknown>>>} In-flight import per key; the cast back to the caller's T happens at the await site. */
    inFlightByKey: Map<string, Promise<SyncUpstreamImportResult<unknown>>>;
    /** @type {Map<string, number>} Last successful import finish time per key. */
    lastSuccessAtByKey: Map<string, number>;
    /**
     * Runs constructor.
     * @param {object} [args] - Options.
     * @param {number} [args.maxSuccessAgeMs] - How long a success timestamp is retained before being swept on the next successful import (default 24 hours, far beyond any sane throttle window). Bounds the shared importer's memory when keys vary over the server lifetime (for example `tickets:<eventId>`).
     * @param {() => number} [args.now] - Clock override for specs.
     */
    constructor({ maxSuccessAgeMs, now }?: {
        maxSuccessAgeMs?: number;
        now?: () => number;
    });
    /**
     * Runs the upstream import for the key, coalescing concurrent callers and
     * skipping throttled callers while the last successful run is still fresh.
     * @template T
     * @param {object} args - Import args.
     * @param {string} args.key - What is being imported (for example `tickets:<eventId>`); coalescing and throttling are scoped per key.
     * @param {() => Promise<T>} args.importer - Performs the upstream import.
     * @param {number} [args.throttleMs] - Skip the run when the last successful import for the key finished less than this long ago.
     * @returns {Promise<SyncUpstreamImportResult<T>>} Import outcome.
     */
    import<T>({ key, importer, throttleMs }: {
        key: string;
        importer: () => Promise<T>;
        throttleMs?: number;
    }): Promise<SyncUpstreamImportResult<T>>;
    /**
     * Drops success timestamps past the maximum age. Runs on each successful
     * import so long-lived processes do not accumulate one map entry per key
     * ever imported.
     * @returns {void}
     */
    sweepStaleSuccessTimestamps(): void;
}
/**
 * Returns the shared upstream importer for a configuration, so every sync
 * resource instance and legacy endpoint serving the same backend coalesces and
 * throttles upstream imports together.
 * @param {import("../configuration.js").default} configuration - Configuration owning the importer.
 * @returns {SyncUpstreamImporter} Shared importer for the configuration.
 */
export declare function syncUpstreamImporterForConfiguration(configuration: import("../configuration.js").default): SyncUpstreamImporter;
//# sourceMappingURL=sync-upstream-importer.d.ts.map