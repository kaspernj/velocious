import PreloaderSelection from "./preloader/selection.js";
export default class VelociousDatabaseQueryPreloader {
    modelClass: typeof import("../record/index.js").default;
    models: import("../record/index.js").default<Record<string, any>>[];
    preload: import("../query/index.js").NestedPreloadRecord;
    selection: PreloaderSelection;
    /**
     * Preloads relationship(s) onto one or more already-loaded model instances.
     * Accepts either a query built via `Model.preload(...).select(...)` (its
     * preload graph and selects are used) or a raw preload spec
     * (string / array / nested object).
     * @param {Array<import("../record/index.js").default>} models - Model instances to preload onto.
     * @param {import("./model-class-query.js").default | import("./index.js").NestedPreloadRecord | string | Array<string | import("./index.js").NestedPreloadRecord>} queryOrSpec - Preload source.
     * @param {{force?: boolean}} [options] - Options.
     * @returns {Promise<void>} - Resolves when preloading completes.
     */
    static preload(models: Array<import("../record/index.js").default>, queryOrSpec: import("./model-class-query.js").default | import("./index.js").NestedPreloadRecord | string | Array<string | import("./index.js").NestedPreloadRecord>, { force }?: {
        force?: boolean;
    }): Promise<void>;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
     * @param {import("../record/index.js").default[]} args.models - Model instances.
     * @param {import("../query/index.js").NestedPreloadRecord} args.preload - Preload.
     * @param {Record<string, string[]>} [args.preloadSelects] - Narrowing selects keyed by target model name.
     * @param {Record<string, string[]>} [args.preloadSelectsExtra] - Extra selects keyed by target model name.
     * @param {PreloaderSelection} [args.selection] - Pre-built selection (takes precedence over the select maps when given).
     */
    constructor({ modelClass, models, preload, preloadSelects, preloadSelectsExtra, selection, ...restArgs }: {
        modelClass: typeof import("../record/index.js").default;
        models: import("../record/index.js").default[];
        preload: import("../query/index.js").NestedPreloadRecord;
        preloadSelects?: Record<string, string[]>;
        preloadSelectsExtra?: Record<string, string[]>;
        selection?: PreloaderSelection;
    });
    run(): Promise<void>;
}
//# sourceMappingURL=preloader.d.ts.map