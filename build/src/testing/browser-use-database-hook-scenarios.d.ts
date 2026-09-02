/**
 * Flushes real React hook transitions and reports synchronous selection state,
 * inline loader stability, and stale completion suppression.
 * @returns {Promise<{firstChangedLoaded: boolean, initialLoaded: boolean, loaderCalls: string[], loadedAfterInlineLoaderRerender: boolean, thirdAfterStaleCompletion: {error: string | null, loaded: boolean}}>} - Render observations.
 */
export default function runUseDatabaseSelectionTransitionScenario(): Promise<{
    firstChangedLoaded: boolean;
    initialLoaded: boolean;
    loaderCalls: string[];
    loadedAfterInlineLoaderRerender: boolean;
    thirdAfterStaleCompletion: {
        error: string | null;
        loaded: boolean;
    };
}>;
//# sourceMappingURL=browser-use-database-hook-scenarios.d.ts.map