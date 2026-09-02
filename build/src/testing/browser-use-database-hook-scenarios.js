// @ts-check
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Configuration, { CurrentConfigurationNotSetError } from "../configuration.js";
import BrowserEnvironmentHandler from "../environment-handlers/browser.js";
import Migration from "../database/migration/index.js";
import SingleMultiUsePool from "../database/pool/single-multi-use.js";
import SqliteWebDriver from "../database/drivers/sqlite/index.web.js";
import TenantHandle from "../tenants/tenant-handle.js";
import useDatabase from "../database/use-database.js";
/**
 * Returns the current configuration without requiring one to exist.
 * @returns {Configuration | undefined} - Current configuration when installed.
 */
function currentConfigurationOrUndefined() {
    try {
        return Configuration.current();
    }
    catch (error) {
        if (!(error instanceof CurrentConfigurationNotSetError))
            throw error;
        return undefined;
    }
}
/**
 * Builds the scoped browser configuration used by the real hook scenario.
 * @returns {Configuration} - Browser test configuration.
 */
function buildHookConfiguration() {
    return new Configuration({
        database: {
            test: {
                projectTenant: {
                    driver: SqliteWebDriver,
                    getConnection: async () => { throw new Error("Hook scenario must not open a physical database"); },
                    migrations: true,
                    name: "use-database-hook-template",
                    poolType: SingleMultiUsePool,
                    tenantOnly: true,
                    type: "sqlite"
                }
            }
        },
        directory: "/use-database-hook-scenario",
        environment: "test",
        environmentHandler: new BrowserEnvironmentHandler(),
        initializeModels: async () => { },
        locale: "en",
        localeFallbacks: { en: ["en"] },
        locales: ["en"],
        tenantDatabaseResolver: ({ identifier, tenant }) => {
            if (identifier !== "projectTenant" || !tenant || typeof tenant !== "object")
                return;
            return { name: `use-database-hook-${String(/** @type {{slug?: string}} */ (tenant).slug)}` };
        }
    });
}
/**
 * Flushes real React hook transitions and reports synchronous selection state,
 * inline loader stability, and stale completion suppression.
 * @returns {Promise<{firstChangedLoaded: boolean, initialLoaded: boolean, loaderCalls: string[], loadedAfterInlineLoaderRerender: boolean, thirdAfterStaleCompletion: {error: string | null, loaded: boolean}}>} - Render observations.
 */
export default async function runUseDatabaseSelectionTransitionScenario() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    /** @type {{error: string | null, loaded: boolean, selection: "first" | "second" | "third"}[]} */
    const renders = [];
    /** @type {string[]} */
    const loaderCalls = [];
    /**
     * Releases the deliberately stale second initialization.
     * @type {() => void}
     */
    let releaseSecondInitialization = () => { };
    const secondInitializationRelease = new Promise((resolve) => { releaseSecondInitialization = () => resolve(undefined); });
    /**
     * Signals that the deliberately stale second initialization started.
     * @type {() => void}
     */
    let signalSecondInitialization = () => { };
    const secondInitializationStarted = new Promise((resolve) => { signalSecondInitialization = () => resolve(undefined); });
    class HookTenantHandle extends TenantHandle {
        /**
         * Runs test initialization without touching a physical database.
         * @param {{migrations: import("../database/migrator/types.js").RequireMigrationContextType}} args - Hook initialization arguments.
         * @returns {Promise<Readonly<ReturnType<TenantHandle["inspect"]>>>} - Ready test snapshot.
         */
        async initialize({ migrations }) {
            loaderCalls.push(migrations.id);
            if (this.tenant().slug === "second") {
                signalSecondInitialization();
                await secondInitializationRelease;
                throw new Error("SECOND_SELECTION_FAILED");
            }
            return Object.freeze({ databaseIdentifier: "projectTenant", dirty: false, lastUsed: 0, pinCount: 0, ready: true, schemaGeneration: "generation-1", state: "open" });
        }
    }
    const previousConfiguration = currentConfigurationOrUndefined();
    const restorationConfiguration = previousConfiguration || buildHookConfiguration();
    const configuration = buildHookConfiguration();
    configuration.setCurrent();
    const firstHandle = new HookTenantHandle({ configuration, tenant: { slug: "first" } });
    const secondHandle = new HookTenantHandle({ configuration, tenant: { slug: "second" } });
    const thirdHandle = new HookTenantHandle({ configuration, tenant: { slug: "third" } });
    const renderCounts = { first: 0, second: 0, third: 0 };
    /**
     * Runs hook probe.
     * @param {{selection: "first" | "second" | "third", tenantHandle: HookTenantHandle}} props - Probe props.
     * @returns {React.ReactElement} - Empty host element.
     */
    function HookProbe({ selection, tenantHandle }) {
        const state = useDatabase({
            databaseIdentifier: "projectTenant",
            migrationsRequireContextCallback: async () => {
                /**
                 * Looks up an empty migration context entry recreated by every probe render.
                 * @param {string} fileName - Requested migration file.
                 * @returns {{default: typeof Migration}} - Placeholder migration module.
                 * @type {import("../database/migrator/types.js").RequireMigrationContextType}
                 */
                const emptyMigrations = (fileName) => {
                    if (!fileName)
                        throw new Error("Migration context lookup requires a file name");
                    return { default: Migration };
                };
                emptyMigrations.keys = () => [];
                emptyMigrations.id = selection;
                return emptyMigrations;
            },
            schemaGeneration: "generation-1",
            tenantHandle
        });
        renderCounts[selection]++;
        if (renderCounts[selection] > 20)
            throw new Error(`useDatabase render loop for ${selection}`);
        renders.push({ error: state.error?.message || null, loaded: state.loaded, selection });
        return React.createElement("div");
    }
    try {
        await act(async () => {
            root.render(React.createElement(HookProbe, { selection: "first", tenantHandle: firstHandle }));
        });
        const initialRender = renders.at(-1);
        await act(async () => {
            root.render(React.createElement(HookProbe, { selection: "first", tenantHandle: firstHandle }));
        });
        const loadedAfterInlineLoaderRerender = renders.at(-1)?.loaded;
        act(() => {
            root.render(React.createElement(HookProbe, { selection: "second", tenantHandle: secondHandle }));
        });
        const firstChangedRender = renders.find((render) => render.selection === "second");
        await secondInitializationStarted;
        await act(async () => {
            root.render(React.createElement(HookProbe, { selection: "third", tenantHandle: thirdHandle }));
        });
        releaseSecondInitialization();
        await act(async () => { await secondInitializationRelease; });
        const thirdAfterStaleCompletion = renders.at(-1);
        if (!initialRender || !firstChangedRender || !thirdAfterStaleCompletion || loadedAfterInlineLoaderRerender === undefined) {
            throw new Error("useDatabase hook scenario did not render every selection");
        }
        return {
            firstChangedLoaded: firstChangedRender.loaded,
            initialLoaded: initialRender.loaded,
            loaderCalls,
            loadedAfterInlineLoaderRerender,
            thirdAfterStaleCompletion: {
                error: thirdAfterStaleCompletion.error,
                loaded: thirdAfterStaleCompletion.loaded
            }
        };
    }
    finally {
        releaseSecondInitialization();
        await act(async () => { root.unmount(); });
        container.remove();
        restorationConfiguration.setCurrent();
        await configuration.closeDatabaseConnections();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnJvd3Nlci11c2UtZGF0YWJhc2UtaG9vay1zY2VuYXJpb3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy9icm93c2VyLXVzZS1kYXRhYmFzZS1ob29rLXNjZW5hcmlvcy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxLQUFLLEVBQUUsRUFBRSxHQUFHLEVBQUUsTUFBTSxPQUFPLENBQUE7QUFDbEMsT0FBTyxFQUFDLFVBQVUsRUFBQyxNQUFNLGtCQUFrQixDQUFBO0FBRTNDLE9BQU8sYUFBYSxFQUFFLEVBQUMsK0JBQStCLEVBQUMsTUFBTSxxQkFBcUIsQ0FBQTtBQUNsRixPQUFPLHlCQUF5QixNQUFNLG9DQUFvQyxDQUFBO0FBQzFFLE9BQU8sU0FBUyxNQUFNLGdDQUFnQyxDQUFBO0FBQ3RELE9BQU8sa0JBQWtCLE1BQU0sc0NBQXNDLENBQUE7QUFDckUsT0FBTyxlQUFlLE1BQU0seUNBQXlDLENBQUE7QUFDckUsT0FBTyxZQUFZLE1BQU0sNkJBQTZCLENBQUE7QUFDdEQsT0FBTyxXQUFXLE1BQU0sNkJBQTZCLENBQUE7QUFFckQ7OztHQUdHO0FBQ0gsU0FBUywrQkFBK0I7SUFDdEMsSUFBSSxDQUFDO1FBQ0gsT0FBTyxhQUFhLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDaEMsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixJQUFJLENBQUMsQ0FBQyxLQUFLLFlBQVksK0JBQStCLENBQUM7WUFBRSxNQUFNLEtBQUssQ0FBQTtRQUVwRSxPQUFPLFNBQVMsQ0FBQTtJQUNsQixDQUFDO0FBQ0gsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQVMsc0JBQXNCO0lBQzdCLE9BQU8sSUFBSSxhQUFhLENBQUM7UUFDdkIsUUFBUSxFQUFFO1lBQ1IsSUFBSSxFQUFFO2dCQUNKLGFBQWEsRUFBRTtvQkFDYixNQUFNLEVBQUUsZUFBZTtvQkFDdkIsYUFBYSxFQUFFLEtBQUss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QztRQUVELE9BQU87WUFDTCxrQkFBa0IsRUFBRSxrQkFBa0IsQ0FBQyxNQUFNO1lBQzdDLGFBQWEsRUFBRSxhQUFhLENBQUMsTUFBTTtZQUNuQyxXQUFXO1lBQ1gsK0JBQStCO1lBQy9CLHlCQUF5QixFQUFFO2dCQUN6QixLQUFLLEVBQUUseUJBQXlCLENBQUMsS0FBSztnQkFDdEMsTUFBTSxFQUFFLHlCQUF5QixDQUFDLE1BQU07YUFDekM7U0FDRixDQUFBO0lBQ0gsQ0FBQztZQUFTLENBQUM7UUFDVCwyQkFBMkIsRUFBRSxDQUFBO1FBQzdCLE1BQU0sR0FBRyxDQUFDLEtBQUssSUFBSSxFQUFFLEdBQUcsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFBLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDekMsU0FBUyxDQUFDLE1BQU0sRUFBRSxDQUFBO1FBQ2xCLHdCQUF3QixDQUFDLFVBQVUsRUFBRSxDQUFBO1FBQ3JDLE1BQU0sYUFBYSxDQUFDLHdCQUF3QixFQUFFLENBQUE7SUFDaEQsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFJlYWN0LCB7IGFjdCB9IGZyb20gXCJyZWFjdFwiXG5pbXBvcnQge2NyZWF0ZVJvb3R9IGZyb20gXCJyZWFjdC1kb20vY2xpZW50XCJcblxuaW1wb3J0IENvbmZpZ3VyYXRpb24sIHtDdXJyZW50Q29uZmlndXJhdGlvbk5vdFNldEVycm9yfSBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi5qc1wiXG5pbXBvcnQgQnJvd3NlckVudmlyb25tZW50SGFuZGxlciBmcm9tIFwiLi4vZW52aXJvbm1lbnQtaGFuZGxlcnMvYnJvd3Nlci5qc1wiXG5pbXBvcnQgTWlncmF0aW9uIGZyb20gXCIuLi9kYXRhYmFzZS9taWdyYXRpb24vaW5kZXguanNcIlxuaW1wb3J0IFNpbmdsZU11bHRpVXNlUG9vbCBmcm9tIFwiLi4vZGF0YWJhc2UvcG9vbC9zaW5nbGUtbXVsdGktdXNlLmpzXCJcbmltcG9ydCBTcWxpdGVXZWJEcml2ZXIgZnJvbSBcIi4uL2RhdGFiYXNlL2RyaXZlcnMvc3FsaXRlL2luZGV4LndlYi5qc1wiXG5pbXBvcnQgVGVuYW50SGFuZGxlIGZyb20gXCIuLi90ZW5hbnRzL3RlbmFudC1oYW5kbGUuanNcIlxuaW1wb3J0IHVzZURhdGFiYXNlIGZyb20gXCIuLi9kYXRhYmFzZS91c2UtZGF0YWJhc2UuanNcIlxuXG4vKipcbiAqIFJldHVybnMgdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbiB3aXRob3V0IHJlcXVpcmluZyBvbmUgdG8gZXhpc3QuXG4gKiBAcmV0dXJucyB7Q29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IGNvbmZpZ3VyYXRpb24gd2hlbiBpbnN0YWxsZWQuXG4gKi9cbmZ1bmN0aW9uIGN1cnJlbnRDb25maWd1cmF0aW9uT3JVbmRlZmluZWQoKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIENvbmZpZ3VyYXRpb24uY3VycmVudCgpXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgaWYgKCEoZXJyb3IgaW5zdGFuY2VvZiBDdXJyZW50Q29uZmlndXJhdGlvbk5vdFNldEVycm9yKSkgdGhyb3cgZXJyb3JcblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkcyB0aGUgc2NvcGVkIGJyb3dzZXIgY29uZmlndXJhdGlvbiB1c2VkIGJ5IHRoZSByZWFsIGhvb2sgc2NlbmFyaW8uXG4gKiBAcmV0dXJucyB7Q29uZmlndXJhdGlvbn0gLSBCcm93c2VyIHRlc3QgY29uZmlndXJhdGlvbi5cbiAqL1xuZnVuY3Rpb24gYnVpbGRIb29rQ29uZmlndXJhdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBDb25maWd1cmF0aW9uKHtcbiAgICBkYXRhYmFzZToge1xuICAgICAgdGVzdDoge1xuICAgICAgICBwcm9qZWN0VGVuYW50OiB7XG4gICAgICAgICAgZHJpdmVyOiBTcWxpdGVXZWJEcml2ZXIsXG4gICAgICAgICAgZ2V0Q29ubmVjdGlvbjogYXN5bmMgKCkgPT4geyB0aHJvdyBuZXcgRXJyb3IoXCJIb29rIHNjZW5hcmlvIG11c3Qgbm90IG9wZW4gYSBwaHlzaWNhbCBkYXRhYmFzZVwiKSB9LFxuICAgICAgICAgIG1pZ3JhdGlvbnM6IHRydWUsXG4gICAgICAgICAgbmFtZTogXCJ1c2UtZGF0YWJhc2UtaG9vay10ZW1wbGF0ZVwiLFxuICAgICAgICAgIHBvb2xUeXBlOiBTaW5nbGVNdWx0aVVzZVBvb2wsXG4gICAgICAgICAgdGVuYW50T25seTogdHJ1ZSxcbiAgICAgICAgICB0eXBlOiBcInNxbGl0ZVwiXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuICAgIGRpcmVjdG9yeTogXCIvdXNlLWRhdGFiYXNlLWhvb2stc2NlbmFyaW9cIixcbiAgICBlbnZpcm9ubWVudDogXCJ0ZXN0XCIsXG4gICAgZW52aXJvbm1lbnRIYW5kbGVyOiBuZXcgQnJvd3NlckVudmlyb25tZW50SGFuZGxlcigpLFxuICAgIGluaXRpYWxpemVNb2RlbHM6IGFzeW5jICgpID0+IHt9LFxuICAgIGxvY2FsZTogXCJlblwiLFxuICAgIGxvY2FsZUZhbGxiYWNrczoge2VuOiBbXCJlblwiXX0sXG4gICAgbG9jYWxlczogW1wiZW5cIl0sXG4gICAgdGVuYW50RGF0YWJhc2VSZXNvbHZlcjogKHtpZGVudGlmaWVyLCB0ZW5hbnR9KSA9PiB7XG4gICAgICBpZiAoaWRlbnRpZmllciAhPT0gXCJwcm9qZWN0VGVuYW50XCIgfHwgIXRlbmFudCB8fCB0eXBlb2YgdGVuYW50ICE9PSBcIm9iamVjdFwiKSByZXR1cm5cblxuICAgICAgcmV0dXJuIHtuYW1lOiBgdXNlLWRhdGFiYXNlLWhvb2stJHtTdHJpbmcoLyoqIEB0eXBlIHt7c2x1Zz86IHN0cmluZ319ICovICh0ZW5hbnQpLnNsdWcpfWB9XG4gICAgfVxuICB9KVxufVxuXG4vKipcbiAqIEZsdXNoZXMgcmVhbCBSZWFjdCBob29rIHRyYW5zaXRpb25zIGFuZCByZXBvcnRzIHN5bmNocm9ub3VzIHNlbGVjdGlvbiBzdGF0ZSxcbiAqIGlubGluZSBsb2FkZXIgc3RhYmlsaXR5LCBhbmQgc3RhbGUgY29tcGxldGlvbiBzdXBwcmVzc2lvbi5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHtmaXJzdENoYW5nZWRMb2FkZWQ6IGJvb2xlYW4sIGluaXRpYWxMb2FkZWQ6IGJvb2xlYW4sIGxvYWRlckNhbGxzOiBzdHJpbmdbXSwgbG9hZGVkQWZ0ZXJJbmxpbmVMb2FkZXJSZXJlbmRlcjogYm9vbGVhbiwgdGhpcmRBZnRlclN0YWxlQ29tcGxldGlvbjoge2Vycm9yOiBzdHJpbmcgfCBudWxsLCBsb2FkZWQ6IGJvb2xlYW59fT59IC0gUmVuZGVyIG9ic2VydmF0aW9ucy5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgYXN5bmMgZnVuY3Rpb24gcnVuVXNlRGF0YWJhc2VTZWxlY3Rpb25UcmFuc2l0aW9uU2NlbmFyaW8oKSB7XG4gIGNvbnN0IGNvbnRhaW5lciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIilcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChjb250YWluZXIpXG4gIGNvbnN0IHJvb3QgPSBjcmVhdGVSb290KGNvbnRhaW5lcilcbiAgLyoqIEB0eXBlIHt7ZXJyb3I6IHN0cmluZyB8IG51bGwsIGxvYWRlZDogYm9vbGVhbiwgc2VsZWN0aW9uOiBcImZpcnN0XCIgfCBcInNlY29uZFwiIHwgXCJ0aGlyZFwifVtdfSAqL1xuICBjb25zdCByZW5kZXJzID0gW11cbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3QgbG9hZGVyQ2FsbHMgPSBbXVxuICAvKipcbiAgICogUmVsZWFzZXMgdGhlIGRlbGliZXJhdGVseSBzdGFsZSBzZWNvbmQgaW5pdGlhbGl6YXRpb24uXG4gICAqIEB0eXBlIHsoKSA9PiB2b2lkfVxuICAgKi9cbiAgbGV0IHJlbGVhc2VTZWNvbmRJbml0aWFsaXphdGlvbiA9ICgpID0+IHt9XG4gIGNvbnN0IHNlY29uZEluaXRpYWxpemF0aW9uUmVsZWFzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7IHJlbGVhc2VTZWNvbmRJbml0aWFsaXphdGlvbiA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKSB9KVxuICAvKipcbiAgICogU2lnbmFscyB0aGF0IHRoZSBkZWxpYmVyYXRlbHkgc3RhbGUgc2Vjb25kIGluaXRpYWxpemF0aW9uIHN0YXJ0ZWQuXG4gICAqIEB0eXBlIHsoKSA9PiB2b2lkfVxuICAgKi9cbiAgbGV0IHNpZ25hbFNlY29uZEluaXRpYWxpemF0aW9uID0gKCkgPT4ge31cbiAgY29uc3Qgc2Vjb25kSW5pdGlhbGl6YXRpb25TdGFydGVkID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHsgc2lnbmFsU2Vjb25kSW5pdGlhbGl6YXRpb24gPSAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkgfSlcblxuICBjbGFzcyBIb29rVGVuYW50SGFuZGxlIGV4dGVuZHMgVGVuYW50SGFuZGxlIHtcbiAgICAvKipcbiAgICAgKiBSdW5zIHRlc3QgaW5pdGlhbGl6YXRpb24gd2l0aG91dCB0b3VjaGluZyBhIHBoeXNpY2FsIGRhdGFiYXNlLlxuICAgICAqIEBwYXJhbSB7e21pZ3JhdGlvbnM6IGltcG9ydChcIi4uL2RhdGFiYXNlL21pZ3JhdG9yL3R5cGVzLmpzXCIpLlJlcXVpcmVNaWdyYXRpb25Db250ZXh0VHlwZX19IGFyZ3MgLSBIb29rIGluaXRpYWxpemF0aW9uIGFyZ3VtZW50cy5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWFkb25seTxSZXR1cm5UeXBlPFRlbmFudEhhbmRsZVtcImluc3BlY3RcIl0+Pj59IC0gUmVhZHkgdGVzdCBzbmFwc2hvdC5cbiAgICAgKi9cbiAgICBhc3luYyBpbml0aWFsaXplKHttaWdyYXRpb25zfSkge1xuICAgICAgbG9hZGVyQ2FsbHMucHVzaChtaWdyYXRpb25zLmlkKVxuXG4gICAgICBpZiAodGhpcy50ZW5hbnQoKS5zbHVnID09PSBcInNlY29uZFwiKSB7XG4gICAgICAgIHNpZ25hbFNlY29uZEluaXRpYWxpemF0aW9uKClcbiAgICAgICAgYXdhaXQgc2Vjb25kSW5pdGlhbGl6YXRpb25SZWxlYXNlXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlNFQ09ORF9TRUxFQ1RJT05fRkFJTEVEXCIpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBPYmplY3QuZnJlZXplKHtkYXRhYmFzZUlkZW50aWZpZXI6IFwicHJvamVjdFRlbmFudFwiLCBkaXJ0eTogZmFsc2UsIGxhc3RVc2VkOiAwLCBwaW5Db3VudDogMCwgcmVhZHk6IHRydWUsIHNjaGVtYUdlbmVyYXRpb246IFwiZ2VuZXJhdGlvbi0xXCIsIHN0YXRlOiBcIm9wZW5cIn0pXG4gICAgfVxuICB9XG4gIGNvbnN0IHByZXZpb3VzQ29uZmlndXJhdGlvbiA9IGN1cnJlbnRDb25maWd1cmF0aW9uT3JVbmRlZmluZWQoKVxuICBjb25zdCByZXN0b3JhdGlvbkNvbmZpZ3VyYXRpb24gPSBwcmV2aW91c0NvbmZpZ3VyYXRpb24gfHwgYnVpbGRIb29rQ29uZmlndXJhdGlvbigpXG4gIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSBidWlsZEhvb2tDb25maWd1cmF0aW9uKClcblxuICBjb25maWd1cmF0aW9uLnNldEN1cnJlbnQoKVxuXG4gIGNvbnN0IGZpcnN0SGFuZGxlID0gbmV3IEhvb2tUZW5hbnRIYW5kbGUoe2NvbmZpZ3VyYXRpb24sIHRlbmFudDoge3NsdWc6IFwiZmlyc3RcIn19KVxuICBjb25zdCBzZWNvbmRIYW5kbGUgPSBuZXcgSG9va1RlbmFudEhhbmRsZSh7Y29uZmlndXJhdGlvbiwgdGVuYW50OiB7c2x1ZzogXCJzZWNvbmRcIn19KVxuICBjb25zdCB0aGlyZEhhbmRsZSA9IG5ldyBIb29rVGVuYW50SGFuZGxlKHtjb25maWd1cmF0aW9uLCB0ZW5hbnQ6IHtzbHVnOiBcInRoaXJkXCJ9fSlcbiAgY29uc3QgcmVuZGVyQ291bnRzID0ge2ZpcnN0OiAwLCBzZWNvbmQ6IDAsIHRoaXJkOiAwfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhvb2sgcHJvYmUuXG4gICAqIEBwYXJhbSB7e3NlbGVjdGlvbjogXCJmaXJzdFwiIHwgXCJzZWNvbmRcIiB8IFwidGhpcmRcIiwgdGVuYW50SGFuZGxlOiBIb29rVGVuYW50SGFuZGxlfX0gcHJvcHMgLSBQcm9iZSBwcm9wcy5cbiAgICogQHJldHVybnMge1JlYWN0LlJlYWN0RWxlbWVudH0gLSBFbXB0eSBob3N0IGVsZW1lbnQuXG4gICAqL1xuICBmdW5jdGlvbiBIb29rUHJvYmUoe3NlbGVjdGlvbiwgdGVuYW50SGFuZGxlfSkge1xuICAgIGNvbnN0IHN0YXRlID0gdXNlRGF0YWJhc2Uoe1xuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiBcInByb2plY3RUZW5hbnRcIixcbiAgICAgIG1pZ3JhdGlvbnNSZXF1aXJlQ29udGV4dENhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBMb29rcyB1cCBhbiBlbXB0eSBtaWdyYXRpb24gY29udGV4dCBlbnRyeSByZWNyZWF0ZWQgYnkgZXZlcnkgcHJvYmUgcmVuZGVyLlxuICAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZU5hbWUgLSBSZXF1ZXN0ZWQgbWlncmF0aW9uIGZpbGUuXG4gICAgICAgICAqIEByZXR1cm5zIHt7ZGVmYXVsdDogdHlwZW9mIE1pZ3JhdGlvbn19IC0gUGxhY2Vob2xkZXIgbWlncmF0aW9uIG1vZHVsZS5cbiAgICAgICAgICogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL21pZ3JhdG9yL3R5cGVzLmpzXCIpLlJlcXVpcmVNaWdyYXRpb25Db250ZXh0VHlwZX1cbiAgICAgICAgICovXG4gICAgICAgIGNvbnN0IGVtcHR5TWlncmF0aW9ucyA9IChmaWxlTmFtZSkgPT4ge1xuICAgICAgICAgIGlmICghZmlsZU5hbWUpIHRocm93IG5ldyBFcnJvcihcIk1pZ3JhdGlvbiBjb250ZXh0IGxvb2t1cCByZXF1aXJlcyBhIGZpbGUgbmFtZVwiKVxuXG4gICAgICAgICAgcmV0dXJuIHtkZWZhdWx0OiBNaWdyYXRpb259XG4gICAgICAgIH1cblxuICAgICAgICBlbXB0eU1pZ3JhdGlvbnMua2V5cyA9ICgpID0+IFtdXG4gICAgICAgIGVtcHR5TWlncmF0aW9ucy5pZCA9IHNlbGVjdGlvblxuXG4gICAgICAgIHJldHVybiBlbXB0eU1pZ3JhdGlvbnNcbiAgICAgIH0sXG4gICAgICBzY2hlbWFHZW5lcmF0aW9uOiBcImdlbmVyYXRpb24tMVwiLFxuICAgICAgdGVuYW50SGFuZGxlXG4gICAgfSlcblxuICAgIHJlbmRlckNvdW50c1tzZWxlY3Rpb25dKytcbiAgICBpZiAocmVuZGVyQ291bnRzW3NlbGVjdGlvbl0gPiAyMCkgdGhyb3cgbmV3IEVycm9yKGB1c2VEYXRhYmFzZSByZW5kZXIgbG9vcCBmb3IgJHtzZWxlY3Rpb259YClcbiAgICByZW5kZXJzLnB1c2goe2Vycm9yOiBzdGF0ZS5lcnJvcj8ubWVzc2FnZSB8fCBudWxsLCBsb2FkZWQ6IHN0YXRlLmxvYWRlZCwgc2VsZWN0aW9ufSlcblxuICAgIHJldHVybiBSZWFjdC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpXG4gIH1cblxuICB0cnkge1xuICAgIGF3YWl0IGFjdChhc3luYyAoKSA9PiB7XG4gICAgICByb290LnJlbmRlcihSZWFjdC5jcmVhdGVFbGVtZW50KEhvb2tQcm9iZSwge3NlbGVjdGlvbjogXCJmaXJzdFwiLCB0ZW5hbnRIYW5kbGU6IGZpcnN0SGFuZGxlfSkpXG4gICAgfSlcblxuICAgIGNvbnN0IGluaXRpYWxSZW5kZXIgPSByZW5kZXJzLmF0KC0xKVxuXG4gICAgYXdhaXQgYWN0KGFzeW5jICgpID0+IHtcbiAgICAgIHJvb3QucmVuZGVyKFJlYWN0LmNyZWF0ZUVsZW1lbnQoSG9va1Byb2JlLCB7c2VsZWN0aW9uOiBcImZpcnN0XCIsIHRlbmFudEhhbmRsZTogZmlyc3RIYW5kbGV9KSlcbiAgICB9KVxuXG4gICAgY29uc3QgbG9hZGVkQWZ0ZXJJbmxpbmVMb2FkZXJSZXJlbmRlciA9IHJlbmRlcnMuYXQoLTEpPy5sb2FkZWRcblxuICAgIGFjdCgoKSA9PiB7XG4gICAgICByb290LnJlbmRlcihSZWFjdC5jcmVhdGVFbGVtZW50KEhvb2tQcm9iZSwge3NlbGVjdGlvbjogXCJzZWNvbmRcIiwgdGVuYW50SGFuZGxlOiBzZWNvbmRIYW5kbGV9KSlcbiAgICB9KVxuXG4gICAgY29uc3QgZmlyc3RDaGFuZ2VkUmVuZGVyID0gcmVuZGVycy5maW5kKChyZW5kZXIpID0+IHJlbmRlci5zZWxlY3Rpb24gPT09IFwic2Vjb25kXCIpXG4gICAgYXdhaXQgc2Vjb25kSW5pdGlhbGl6YXRpb25TdGFydGVkXG5cbiAgICBhd2FpdCBhY3QoYXN5bmMgKCkgPT4ge1xuICAgICAgcm9vdC5yZW5kZXIoUmVhY3QuY3JlYXRlRWxlbWVudChIb29rUHJvYmUsIHtzZWxlY3Rpb246IFwidGhpcmRcIiwgdGVuYW50SGFuZGxlOiB0aGlyZEhhbmRsZX0pKVxuICAgIH0pXG5cbiAgICByZWxlYXNlU2Vjb25kSW5pdGlhbGl6YXRpb24oKVxuICAgIGF3YWl0IGFjdChhc3luYyAoKSA9PiB7IGF3YWl0IHNlY29uZEluaXRpYWxpemF0aW9uUmVsZWFzZSB9KVxuXG4gICAgY29uc3QgdGhpcmRBZnRlclN0YWxlQ29tcGxldGlvbiA9IHJlbmRlcnMuYXQoLTEpXG5cbiAgICBpZiAoIWluaXRpYWxSZW5kZXIgfHwgIWZpcnN0Q2hhbmdlZFJlbmRlciB8fCAhdGhpcmRBZnRlclN0YWxlQ29tcGxldGlvbiB8fCBsb2FkZWRBZnRlcklubGluZUxvYWRlclJlcmVuZGVyID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInVzZURhdGFiYXNlIGhvb2sgc2NlbmFyaW8gZGlkIG5vdCByZW5kZXIgZXZlcnkgc2VsZWN0aW9uXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGZpcnN0Q2hhbmdlZExvYWRlZDogZmlyc3RDaGFuZ2VkUmVuZGVyLmxvYWRlZCxcbiAgICAgIGluaXRpYWxMb2FkZWQ6IGluaXRpYWxSZW5kZXIubG9hZGVkLFxuICAgICAgbG9hZGVyQ2FsbHMsXG4gICAgICBsb2FkZWRBZnRlcklubGluZUxvYWRlclJlcmVuZGVyLFxuICAgICAgdGhpcmRBZnRlclN0YWxlQ29tcGxldGlvbjoge1xuICAgICAgICBlcnJvcjogdGhpcmRBZnRlclN0YWxlQ29tcGxldGlvbi5lcnJvcixcbiAgICAgICAgbG9hZGVkOiB0aGlyZEFmdGVyU3RhbGVDb21wbGV0aW9uLmxvYWRlZFxuICAgICAgfVxuICAgIH1cbiAgfSBmaW5hbGx5IHtcbiAgICByZWxlYXNlU2Vjb25kSW5pdGlhbGl6YXRpb24oKVxuICAgIGF3YWl0IGFjdChhc3luYyAoKSA9PiB7IHJvb3QudW5tb3VudCgpIH0pXG4gICAgY29udGFpbmVyLnJlbW92ZSgpXG4gICAgcmVzdG9yYXRpb25Db25maWd1cmF0aW9uLnNldEN1cnJlbnQoKVxuICAgIGF3YWl0IGNvbmZpZ3VyYXRpb24uY2xvc2VEYXRhYmFzZUNvbm5lY3Rpb25zKClcbiAgfVxufVxuIl19