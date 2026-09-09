export type ModelClassRequireContextIDFunctionType = (id: string) => {
    default: typeof import("./record/index.js").default;
};
export type ModelClassRequireContextType = ModelClassRequireContextIDFunctionType & {
    keys: () => string[];
    id: string;
};
/**
 * Defines this typedef.
 * @typedef {(id: string) => {default: typeof import("./record/index.js").default}} ModelClassRequireContextIDFunctionType
 * @typedef {ModelClassRequireContextIDFunctionType & {
 *   keys: () => string[],
 *   id: string
 * }} ModelClassRequireContextType
 */
import Logger from "../logger.js";
export default class VelociousDatabaseInitializerFromRequireContext {
    requireContext: ModelClassRequireContextType;
    logger: Logger;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {ModelClassRequireContextType} args.requireContext - Require context.
     */
    constructor({ requireContext, ...restArgs }: {
        requireContext: ModelClassRequireContextType;
    });
    /**
     * Runs initialize.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @returns {Promise<void>} - Resolves when complete.
     */
    initialize({ configuration, ...restArgs }: {
        configuration: import("../configuration.js").default;
    }): Promise<void>;
    /**
     * Initializes a model's record metadata and its translation table (if any).
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {typeof import("./record/index.js").default} args.modelClass - Model class to initialize.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _initializeModelRecord({ configuration, modelClass }: {
        configuration: import("../configuration.js").default;
        modelClass: typeof import("./record/index.js").default;
    }): Promise<void>;
    /**
     * Models opting out of eager metadata loading (`setEagerLoadRecordMetadata(false)`)
     * are still initialized at startup when their (optional) table is present, so that
     * synchronous query building such as `.where(...)` works without callers having to
     * call `ensureInitialized()` first. When the table — or its connection — is not
     * available the model is left deferred so startup still succeeds; it can then
     * initialize lazily the first time a terminal query method (find/create/etc.) runs.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {typeof import("./record/index.js").default} args.modelClass - Model class to initialize.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _bestEffortInitializeDeferredModel({ configuration, modelClass }: {
        configuration: import("../configuration.js").default;
        modelClass: typeof import("./record/index.js").default;
    }): Promise<void>;
}
//# sourceMappingURL=initializer-from-require-context.d.ts.map