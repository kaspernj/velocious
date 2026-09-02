export type MagnitudeCounterCacheDefinition = {
    belongsTo: string;
    counterColumn: string;
    sourceAttribute: string;
    magnitude: (sourceValue: ReturnType<typeof JSON.parse>) => number;
};
export type PendingMagnitudeDelta = {
    newMagnitude: number;
    oldMagnitude: number;
    newParentId: ReturnType<typeof JSON.parse>;
    oldParentId: ReturnType<typeof JSON.parse>;
};
/**
 * Reactive counter-cache driven by a per-record magnitude.
 *
 * Maintains a counter column on a `belongsTo` parent as the running sum of each
 * child's magnitude — a small number derived from one source attribute (e.g.
 * `1` while a build's `status` is `running`, else `0`). On every create, update
 * and destroy the change in magnitude is applied to the parent as a single
 * atomic increment (`SET col = col + delta`), and when the foreign key changes
 * the magnitude is moved from the old parent to the new one.
 *
 * Because the counter is derived from the source attribute and diffed on every
 * write, it follows that attribute automatically no matter which code path wrote
 * it — there is no per-transition increment/decrement to forget. The old value is
 * captured in `beforeSave` (Velocious clears `changes()` during the post-update
 * reload) and consumed in `afterSave`, so the increment commits atomically with
 * the row it reflects.
 * @typedef {{
 *   belongsTo: string,
 *   counterColumn: string,
 *   sourceAttribute: string,
 *   magnitude: (sourceValue: ReturnType<typeof JSON.parse>) => number
 * }} MagnitudeCounterCacheDefinition
 */
/**
 * Captured pending magnitude change stashed on a record between beforeSave and afterSave.
 * @typedef {{newMagnitude: number, oldMagnitude: number, newParentId: ReturnType<typeof JSON.parse>, oldParentId: ReturnType<typeof JSON.parse>}} PendingMagnitudeDelta
 */
/**
 * Registers a reactive magnitude counter-cache on a model class.
 * @param {typeof import("./index.js").default} modelClass - Model class to add the counter cache to.
 * @param {MagnitudeCounterCacheDefinition} definition - Counter cache definition.
 * @returns {void}
 */
export declare function registerMagnitudeCounterCache(modelClass: typeof import("./index.js").default, definition: MagnitudeCounterCacheDefinition): void;
//# sourceMappingURL=counter-cache-magnitude.d.ts.map