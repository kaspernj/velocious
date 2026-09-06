export type CounterCacheParentUpdateListener = (parent: import("./index.js").default) => void | Promise<void>;
/**
 * Registers an internal listener for committed counter-cache parent updates.
 * @param {typeof import("./index.js").default} parentModelClass - Parent model class.
 * @param {CounterCacheParentUpdateListener} listener - Committed-parent listener.
 * @returns {() => void} - Listener removal callback.
 */
export declare function registerCounterCacheParentUpdateListener(parentModelClass: typeof import("./index.js").default, listener: CounterCacheParentUpdateListener): () => void;
/**
 * Schedules one non-coalesced parent reload and notification on the source record's commit lifecycle.
 * @param {object} args - Parent update arguments.
 * @param {ReturnType<typeof JSON.parse>} args.parentId - Parent relationship identity.
 * @param {typeof import("./index.js").default} args.parentModelClass - Parent model class.
 * @param {string} args.parentPrimaryKey - Parent relationship primary key.
 * @param {import("../query/model-class-query.js").default<typeof import("./index.js").default>} args.parentQuery - Source-owned parent query.
 * @param {import("./index.js").default} args.sourceRecord - Source record that owns the transaction lifecycle.
 * @returns {Promise<void>} - Resolves after registration or immediate delivery.
 */
export declare function scheduleCounterCacheParentUpdate({ parentId, parentModelClass, parentPrimaryKey, parentQuery, sourceRecord }: {
    parentId: ReturnType<typeof JSON.parse>;
    parentModelClass: typeof import("./index.js").default;
    parentPrimaryKey: string;
    parentQuery: import("../query/model-class-query.js").default<typeof import("./index.js").default>;
    sourceRecord: import("./index.js").default;
}): Promise<void>;
//# sourceMappingURL=counter-cache-parent-updates.d.ts.map