// @ts-check
import EventEmitter from "../utils/event-emitter.js";
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
class RecordChanges {
    /**
     * Underlying event bus keyed by model name.
     * @type {import("eventemitter3").EventEmitter} */
    _emitter = new EventEmitter();
    /**
     * Number of open batch windows; while positive, emits buffer instead of dispatching.
     * @type {number} */
    _batchDepth = 0;
    /**
     * Latest buffered event per model name, dispatched once when the outermost batch ends.
     * @type {Map<string, RecordChangeEvent>} */
    _bufferedEvents = new Map();
    /**
     * Subscribes a listener to committed changes of a model class.
     * @param {RecordModelClass} modelClass - Model class to observe.
     * @param {RecordChangeListener} listener - Listener called with each change event.
     * @param {{databaseIdentity?: string}} [options] - Captured physical identity filter.
     * @returns {() => void} Unsubscribe callback.
     */
    subscribe(modelClass, listener, { databaseIdentity } = {}) {
        if (modelClass.hasTenantDatabaseIdentifierResolver() && !databaseIdentity) {
            throw new Error(`Tenant-scoped record-change subscriptions for ${modelClass.getModelName()} require a captured databaseIdentity`);
        }
        const eventName = modelClass.getModelName();
        const subscribedListener = databaseIdentity
            ? (/** @type {RecordChangeEvent} */ event) => {
                if (event.databaseIdentity === databaseIdentity)
                    listener(event);
            }
            : listener;
        this._emitter.on(eventName, subscribedListener);
        return () => {
            this._emitter.off(eventName, subscribedListener);
        };
    }
    /**
     * Whether any listener is currently observing the given model class. Callers on
     * the write path use this to skip emitting entirely when nothing is watching,
     * keeping server-side saves free of live-query overhead.
     * @param {RecordModelClass} modelClass - Model class to check.
     * @returns {boolean} Whether listeners exist for the model class.
     */
    hasListeners(modelClass) {
        return this._emitter.listenerCount(modelClass.getModelName()) > 0;
    }
    /**
     * Emits a committed change. While a batch window is open the event is buffered
     * and deduplicated by model class, so a batch of N commits dispatches a single
     * event per model class when the outermost batch ends.
     * @param {RecordChangeEvent} event - Change event to dispatch.
     * @returns {void}
     */
    emit(event) {
        if (this._batchDepth > 0) {
            const modelName = event.modelClass.getModelName();
            const eventKey = `${modelName.length}:${modelName}:${event.databaseIdentity}`;
            this._bufferedEvents.set(eventKey, event);
            return;
        }
        this._emitter.emit(event.modelClass.getModelName(), event);
    }
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
    async batch(callback) {
        this._batchDepth++;
        try {
            return await callback();
        }
        finally {
            this._batchDepth--;
            if (this._batchDepth === 0)
                this._flushBufferedEvents();
        }
    }
    /**
     * Dispatches and clears the buffered per-model events collected during a batch.
     * @returns {void}
     */
    _flushBufferedEvents() {
        const bufferedEvents = this._bufferedEvents;
        this._bufferedEvents = new Map();
        for (const event of bufferedEvents.values()) {
            this._emitter.emit(event.modelClass.getModelName(), event);
        }
    }
}
/**
 * Shared singleton so record commits and live queries meet on one bus.
 * @type {RecordChanges} */
const recordChanges = new RecordChanges();
export default recordChanges;
export { RecordChanges };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVjb3JkLWNoYW5nZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkLWNoYW5nZXMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sWUFBWSxNQUFNLDJCQUEyQixDQUFBO0FBRXBEOzs0RUFFNEU7QUFFNUU7O3NFQUVzRTtBQUV0RTs7Ozs7OztHQU9HO0FBRUg7O3dFQUV3RTtBQUV4RTs7Ozs7O0dBTUc7QUFDSCxNQUFNLGFBQWE7SUFDakI7O3NEQUVrRDtJQUNsRCxRQUFRLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQTtJQUU3Qjs7d0JBRW9CO0lBQ3BCLFdBQVcsR0FBRyxDQUFDLENBQUE7SUFFZjs7Z0RBRTRDO0lBQzVDLGVBQWUsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO0lBRTNCOzs7Ozs7T0FNRztJQUNILFNBQVMsQ0FBQyxVQUFVLEVBQUUsUUFBUSxFQUFFLEVBQUMsZ0JBQWdCLEVBQUMsR0FBRyxFQUFFO1FBQ3JELElBQUksVUFBVSxDQUFDLG1DQUFtQyxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1lBQzFFLE1BQU0sSUFBSSxLQUFLLENBQUMsaURBQWlELFVBQVUsQ0FBQyxZQUFZLEVBQUUsc0NBQXNDLENBQUMsQ0FBQTtRQUNuSSxDQUFDO1FBRUQsTUFBTSxTQUFTLEdBQUcsVUFBVSxDQUFDLFlBQVksRUFBRSxDQUFBO1FBQzNDLE1BQU0sa0JBQWtCLEdBQUcsZ0JBQWdCO1lBQ3pDLENBQUMsQ0FBQyxDQUFDLGdDQUFnQyxDQUFDLEtBQUssRUFBRSxFQUFFO2dCQUMzQyxJQUFJLEtBQUssQ0FBQyxnQkFBZ0IsS0FBSyxnQkFBZ0I7b0JBQUUsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ2xFLENBQUM7WUFDRCxDQUFDLENBQUMsUUFBUSxDQUFBO1FBRVosSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLGtCQUFrQixDQUFDLENBQUE7UUFFL0MsT0FBTyxHQUFHLEVBQUU7WUFDVixJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsa0JBQWtCLENBQUMsQ0FBQTtRQUNsRCxDQUFDLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsWUFBWSxDQUFDLFVBQVU7UUFDckIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUMsWUFBWSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUE7SUFDbkUsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILElBQUksQ0FBQyxLQUFLO1FBQ1IsSUFBSSxJQUFJLENBQUMsV0FBVyxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3pCLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxVQUFVLENBQUMsWUFBWSxFQUFFLENBQUE7WUFDakQsTUFBTSxRQUFRLEdBQUcsR0FBRyxTQUFTLENBQUMsTUFBTSxJQUFJLFNBQVMsSUFBSSxLQUFLLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtZQUU3RSxJQUFJLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsS0FBSyxDQUFDLENBQUE7WUFFekMsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO0lBQzVELENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCxLQUFLLENBQUMsS0FBSyxDQUFDLFFBQVE7UUFDbEIsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBRWxCLElBQUksQ0FBQztZQUNILE9BQU8sTUFBTSxRQUFRLEVBQUUsQ0FBQTtRQUN6QixDQUFDO2dCQUFTLENBQUM7WUFDVCxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7WUFFbEIsSUFBSSxJQUFJLENBQUMsV0FBVyxLQUFLLENBQUM7Z0JBQUUsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUE7UUFDekQsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxvQkFBb0I7UUFDbEIsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQTtRQUUzQyxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFaEMsS0FBSyxNQUFNLEtBQUssSUFBSSxjQUFjLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQztZQUM1QyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO1FBQzVELENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFFRDs7MkJBRTJCO0FBQzNCLE1BQU0sYUFBYSxHQUFHLElBQUksYUFBYSxFQUFFLENBQUE7QUFFekMsZUFBZSxhQUFhLENBQUE7QUFDNUIsT0FBTyxFQUFDLGFBQWEsRUFBQyxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBFdmVudEVtaXR0ZXIgZnJvbSBcIi4uL3V0aWxzL2V2ZW50LWVtaXR0ZXIuanNcIlxuXG4vKipcbiAqIFJlY29yZE1vZGVsQ2xhc3MgdHlwZS5cbiAqIEB0eXBlZGVmIHt0eXBlb2YgaW1wb3J0KFwiLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gUmVjb3JkTW9kZWxDbGFzcyAqL1xuXG4vKipcbiAqIFJlY29yZENoYW5nZU9wZXJhdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IFJlY29yZENoYW5nZU9wZXJhdGlvbiAqL1xuXG4vKipcbiAqIFJlY29yZENoYW5nZUV2ZW50IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBSZWNvcmRDaGFuZ2VFdmVudFxuICogQHByb3BlcnR5IHtSZWNvcmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3Mgd2hvc2Ugcm93IGNoYW5nZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZGF0YWJhc2VJZGVudGl0eSAtIE9wYXF1ZSBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eSB3aGVyZSB0aGUgY29tbWl0IG9jY3VycmVkLlxuICogQHByb3BlcnR5IHtSZWNvcmRDaGFuZ2VPcGVyYXRpb259IG9wZXJhdGlvbiAtIFRoZSBjb21taXR0ZWQgb3BlcmF0aW9uLlxuICogQHByb3BlcnR5IHtJbnN0YW5jZVR5cGU8UmVjb3JkTW9kZWxDbGFzcz59IHJlY29yZCAtIFRoZSBjb21taXR0ZWQgcmVjb3JkIGluc3RhbmNlLlxuICovXG5cbi8qKlxuICogUmVjb3JkQ2hhbmdlTGlzdGVuZXIgdHlwZS5cbiAqIEB0eXBlZGVmIHsoZXZlbnQ6IFJlY29yZENoYW5nZUV2ZW50KSA9PiB2b2lkfSBSZWNvcmRDaGFuZ2VMaXN0ZW5lciAqL1xuXG4vKipcbiAqIEZyYW1ld29yay1sZXZlbCBidXMgZm9yIGNvbW1pdHRlZCBsb2NhbCBtb2RlbCBjaGFuZ2VzLiBSZWNvcmRzIGVtaXQgaGVyZSBvbmNlXG4gKiBwZXIgY29tbWl0IChzZWUgYFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnNhdmVgL2BkZXN0cm95YCksIHNvIGxvY2FsIHdyaXRlcyxcbiAqIHB1bGwgYXBwbGllcywgYW5kIHJlYWx0aW1lIGFwcGxpZXMgY29udmVyZ2Ugb24gb25lIHVuaWZvcm0gc2lnbmFsIHRoYXQgbGl2ZVxuICogcXVlcmllcyBzdWJzY3JpYmUgdG8uIEVtaXNzaW9uIGlzIGtleWVkIGJ5IG1vZGVsIG5hbWU7IGEgYGJhdGNoKC4uLilgIHdpbmRvd1xuICogY29hbGVzY2VzIGEgYnVyc3Qgb2YgY29tbWl0cyBpbnRvIGEgc2luZ2xlIGV2ZW50IHBlciBtb2RlbCBjbGFzcy5cbiAqL1xuY2xhc3MgUmVjb3JkQ2hhbmdlcyB7XG4gIC8qKlxuICAgKiBVbmRlcmx5aW5nIGV2ZW50IGJ1cyBrZXllZCBieSBtb2RlbCBuYW1lLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiZXZlbnRlbWl0dGVyM1wiKS5FdmVudEVtaXR0ZXJ9ICovXG4gIF9lbWl0dGVyID0gbmV3IEV2ZW50RW1pdHRlcigpXG5cbiAgLyoqXG4gICAqIE51bWJlciBvZiBvcGVuIGJhdGNoIHdpbmRvd3M7IHdoaWxlIHBvc2l0aXZlLCBlbWl0cyBidWZmZXIgaW5zdGVhZCBvZiBkaXNwYXRjaGluZy5cbiAgICogQHR5cGUge251bWJlcn0gKi9cbiAgX2JhdGNoRGVwdGggPSAwXG5cbiAgLyoqXG4gICAqIExhdGVzdCBidWZmZXJlZCBldmVudCBwZXIgbW9kZWwgbmFtZSwgZGlzcGF0Y2hlZCBvbmNlIHdoZW4gdGhlIG91dGVybW9zdCBiYXRjaCBlbmRzLlxuICAgKiBAdHlwZSB7TWFwPHN0cmluZywgUmVjb3JkQ2hhbmdlRXZlbnQ+fSAqL1xuICBfYnVmZmVyZWRFdmVudHMgPSBuZXcgTWFwKClcblxuICAvKipcbiAgICogU3Vic2NyaWJlcyBhIGxpc3RlbmVyIHRvIGNvbW1pdHRlZCBjaGFuZ2VzIG9mIGEgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIG9ic2VydmUuXG4gICAqIEBwYXJhbSB7UmVjb3JkQ2hhbmdlTGlzdGVuZXJ9IGxpc3RlbmVyIC0gTGlzdGVuZXIgY2FsbGVkIHdpdGggZWFjaCBjaGFuZ2UgZXZlbnQuXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlSWRlbnRpdHk/OiBzdHJpbmd9fSBbb3B0aW9uc10gLSBDYXB0dXJlZCBwaHlzaWNhbCBpZGVudGl0eSBmaWx0ZXIuXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIHN1YnNjcmliZShtb2RlbENsYXNzLCBsaXN0ZW5lciwge2RhdGFiYXNlSWRlbnRpdHl9ID0ge30pIHtcbiAgICBpZiAobW9kZWxDbGFzcy5oYXNUZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlcigpICYmICFkYXRhYmFzZUlkZW50aXR5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudC1zY29wZWQgcmVjb3JkLWNoYW5nZSBzdWJzY3JpcHRpb25zIGZvciAke21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9IHJlcXVpcmUgYSBjYXB0dXJlZCBkYXRhYmFzZUlkZW50aXR5YClcbiAgICB9XG5cbiAgICBjb25zdCBldmVudE5hbWUgPSBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG4gICAgY29uc3Qgc3Vic2NyaWJlZExpc3RlbmVyID0gZGF0YWJhc2VJZGVudGl0eVxuICAgICAgPyAoLyoqIEB0eXBlIHtSZWNvcmRDaGFuZ2VFdmVudH0gKi8gZXZlbnQpID0+IHtcbiAgICAgICAgaWYgKGV2ZW50LmRhdGFiYXNlSWRlbnRpdHkgPT09IGRhdGFiYXNlSWRlbnRpdHkpIGxpc3RlbmVyKGV2ZW50KVxuICAgICAgfVxuICAgICAgOiBsaXN0ZW5lclxuXG4gICAgdGhpcy5fZW1pdHRlci5vbihldmVudE5hbWUsIHN1YnNjcmliZWRMaXN0ZW5lcilcblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICB0aGlzLl9lbWl0dGVyLm9mZihldmVudE5hbWUsIHN1YnNjcmliZWRMaXN0ZW5lcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhbnkgbGlzdGVuZXIgaXMgY3VycmVudGx5IG9ic2VydmluZyB0aGUgZ2l2ZW4gbW9kZWwgY2xhc3MuIENhbGxlcnMgb25cbiAgICogdGhlIHdyaXRlIHBhdGggdXNlIHRoaXMgdG8gc2tpcCBlbWl0dGluZyBlbnRpcmVseSB3aGVuIG5vdGhpbmcgaXMgd2F0Y2hpbmcsXG4gICAqIGtlZXBpbmcgc2VydmVyLXNpZGUgc2F2ZXMgZnJlZSBvZiBsaXZlLXF1ZXJ5IG92ZXJoZWFkLlxuICAgKiBAcGFyYW0ge1JlY29yZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB0byBjaGVjay5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgbGlzdGVuZXJzIGV4aXN0IGZvciB0aGUgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBoYXNMaXN0ZW5lcnMobW9kZWxDbGFzcykge1xuICAgIHJldHVybiB0aGlzLl9lbWl0dGVyLmxpc3RlbmVyQ291bnQobW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSkgPiAwXG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgYSBjb21taXR0ZWQgY2hhbmdlLiBXaGlsZSBhIGJhdGNoIHdpbmRvdyBpcyBvcGVuIHRoZSBldmVudCBpcyBidWZmZXJlZFxuICAgKiBhbmQgZGVkdXBsaWNhdGVkIGJ5IG1vZGVsIGNsYXNzLCBzbyBhIGJhdGNoIG9mIE4gY29tbWl0cyBkaXNwYXRjaGVzIGEgc2luZ2xlXG4gICAqIGV2ZW50IHBlciBtb2RlbCBjbGFzcyB3aGVuIHRoZSBvdXRlcm1vc3QgYmF0Y2ggZW5kcy5cbiAgICogQHBhcmFtIHtSZWNvcmRDaGFuZ2VFdmVudH0gZXZlbnQgLSBDaGFuZ2UgZXZlbnQgdG8gZGlzcGF0Y2guXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgZW1pdChldmVudCkge1xuICAgIGlmICh0aGlzLl9iYXRjaERlcHRoID4gMCkge1xuICAgICAgY29uc3QgbW9kZWxOYW1lID0gZXZlbnQubW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuICAgICAgY29uc3QgZXZlbnRLZXkgPSBgJHttb2RlbE5hbWUubGVuZ3RofToke21vZGVsTmFtZX06JHtldmVudC5kYXRhYmFzZUlkZW50aXR5fWBcblxuICAgICAgdGhpcy5fYnVmZmVyZWRFdmVudHMuc2V0KGV2ZW50S2V5LCBldmVudClcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fZW1pdHRlci5lbWl0KGV2ZW50Lm1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksIGV2ZW50KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayB3aXRoIGNoYW5nZSBkaXNwYXRjaCBjb2FsZXNjZWQ6IGV2ZXJ5IGNoYW5nZSBjb21taXR0ZWQgd2hpbGVcbiAgICogdGhlIGNhbGxiYWNrIHJ1bnMgYnVmZmVycywgYW5kIHRoZSBvdXRlcm1vc3QgYmF0Y2ggZmx1c2hlcyBhIHNpbmdsZSBldmVudCBwZXJcbiAgICogY2hhbmdlZCBtb2RlbCBjbGFzcyBhZnRlciBpdCByZXNvbHZlcy4gTmVzdGVkIGJhdGNoZXMgc2hhcmUgb25lIGZsdXNoLiBTeW5jXG4gICAqIGFwcGxpZXJzIHdyYXAgdGhlaXIgcGVyLXJvdyBhcHBseSBsb29wIGluIHRoaXMgc28gYSBsYXJnZSBwdWxsIG9yIHJlYWx0aW1lXG4gICAqIHB1c2ggdHJpZ2dlcnMgb25lIHJlLXJ1biBwZXIgbGl2ZSBxdWVyeSBpbnN0ZWFkIG9mIG9uZSBwZXIgYXBwbGllZCByb3cuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPiB8IFR9IGNhbGxiYWNrIC0gV29yayB3aG9zZSBjb21taXR0ZWQgY2hhbmdlcyBzaG91bGQgY29hbGVzY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBUaGUgY2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgYmF0Y2goY2FsbGJhY2spIHtcbiAgICB0aGlzLl9iYXRjaERlcHRoKytcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9iYXRjaERlcHRoLS1cblxuICAgICAgaWYgKHRoaXMuX2JhdGNoRGVwdGggPT09IDApIHRoaXMuX2ZsdXNoQnVmZmVyZWRFdmVudHMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNwYXRjaGVzIGFuZCBjbGVhcnMgdGhlIGJ1ZmZlcmVkIHBlci1tb2RlbCBldmVudHMgY29sbGVjdGVkIGR1cmluZyBhIGJhdGNoLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9mbHVzaEJ1ZmZlcmVkRXZlbnRzKCkge1xuICAgIGNvbnN0IGJ1ZmZlcmVkRXZlbnRzID0gdGhpcy5fYnVmZmVyZWRFdmVudHNcblxuICAgIHRoaXMuX2J1ZmZlcmVkRXZlbnRzID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGJ1ZmZlcmVkRXZlbnRzLnZhbHVlcygpKSB7XG4gICAgICB0aGlzLl9lbWl0dGVyLmVtaXQoZXZlbnQubW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSwgZXZlbnQpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogU2hhcmVkIHNpbmdsZXRvbiBzbyByZWNvcmQgY29tbWl0cyBhbmQgbGl2ZSBxdWVyaWVzIG1lZXQgb24gb25lIGJ1cy5cbiAqIEB0eXBlIHtSZWNvcmRDaGFuZ2VzfSAqL1xuY29uc3QgcmVjb3JkQ2hhbmdlcyA9IG5ldyBSZWNvcmRDaGFuZ2VzKClcblxuZXhwb3J0IGRlZmF1bHQgcmVjb3JkQ2hhbmdlc1xuZXhwb3J0IHtSZWNvcmRDaGFuZ2VzfVxuIl19