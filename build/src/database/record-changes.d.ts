export type RecordModelClass = typeof import("./record/index.js").default;
export type RecordChangeOperation = "create" | "update" | "destroy";
export type RecordChangeEvent = {
    /**
     * - Model class whose row changed.
     */
    modelClass: RecordModelClass;
    /**
     * - Opaque physical database identity where the commit occurred.
     */
    databaseIdentity: string;
    /**
     * - The committed operation.
     */
    operation: RecordChangeOperation;
    /**
     * - The committed record instance.
     */
    record: InstanceType<RecordModelClass>;
};
export type RecordChangeListener = (event: RecordChangeEvent) => void;
/**
 * RecordModelClass type.
 * @typedef {typeof import("./record/index.js").default} RecordModelClass */
/**
 * RecordChangeOperation type.
 * @typedef {"create" | "update" | "destroy"} RecordChangeOperation */
/**
 * RecordChangeEvent type.
 * @typedef {object} RecordChangeEvent
 * @property {RecordModelClass} modelClass - Model class whose row changed.
 * @property {string} databaseIdentity - Opaque physical database identity where the commit occurred.
 * @property {RecordChangeOperation} operation - The committed operation.
 * @property {InstanceType<RecordModelClass>} record - The committed record instance.
 */
/**
 * RecordChangeListener type.
 * @typedef {(event: RecordChangeEvent) => void} RecordChangeListener */
/**
 * Framework-level bus for committed local model changes. Records emit here once
 * per commit (see `VelociousDatabaseRecord.save`/`destroy`), so local writes,
 * pull applies, and realtime applies converge on one uniform signal that live
 * queries subscribe to. Emission is keyed by model name; a `batch(...)` window
 * coalesces a burst of commits into a single event per model class.
 */
declare class RecordChanges {
    /**
     * Underlying event bus keyed by model name.
     * @type {import("eventemitter3").EventEmitter} */
    _emitter: import("eventemitter3").EventEmitter;
    /**
     * Number of open batch windows; while positive, emits buffer instead of dispatching.
     * @type {number} */
    _batchDepth: number;
    /**
     * Latest buffered event per model name, dispatched once when the outermost batch ends.
     * @type {Map<string, RecordChangeEvent>} */
    _bufferedEvents: Map<string, RecordChangeEvent>;
    /**
     * Subscribes a listener to committed changes of a model class.
     * @param {RecordModelClass} modelClass - Model class to observe.
     * @param {RecordChangeListener} listener - Listener called with each change event.
     * @param {{databaseIdentity?: string}} [options] - Captured physical identity filter.
     * @returns {() => void} Unsubscribe callback.
     */
    subscribe(modelClass: RecordModelClass, listener: RecordChangeListener, { databaseIdentity }?: {
        databaseIdentity?: string;
    }): () => void;
    /**
     * Whether any listener is currently observing the given model class. Callers on
     * the write path use this to skip emitting entirely when nothing is watching,
     * keeping server-side saves free of live-query overhead.
     * @param {RecordModelClass} modelClass - Model class to check.
     * @returns {boolean} Whether listeners exist for the model class.
     */
    hasListeners(modelClass: RecordModelClass): boolean;
    /**
     * Emits a committed change. While a batch window is open the event is buffered
     * and deduplicated by model class, so a batch of N commits dispatches a single
     * event per model class when the outermost batch ends.
     * @param {RecordChangeEvent} event - Change event to dispatch.
     * @returns {void}
     */
    emit(event: RecordChangeEvent): void;
    /**
     * Runs a callback with change dispatch coalesced: every change committed while
     * the callback runs buffers, and the outermost batch flushes a single event per
     * changed model class after it resolves. Nested batches share one flush. Sync
     * appliers wrap their per-row apply loop in this so a large pull or realtime
     * push triggers one re-run per live query instead of one per applied row.
     * @template T
     * @param {() => Promise<T> | T} callback - Work whose committed changes should coalesce.
     * @returns {Promise<T>} The callback result.
     */
    batch<T>(callback: () => Promise<T> | T): Promise<T>;
    /**
     * Dispatches and clears the buffered per-model events collected during a batch.
     * @returns {void}
     */
    _flushBufferedEvents(): void;
}
/**
 * Shared singleton so record commits and live queries meet on one bus.
 * @type {RecordChanges} */
declare const recordChanges: RecordChanges;
export default recordChanges;
export { RecordChanges };
//# sourceMappingURL=record-changes.d.ts.map