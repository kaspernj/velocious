// @ts-check
import Logger from "../../logger.js";
import { ensureError } from "typanic";
/** @typedef {(parent: import("./index.js").default, previousParent: import("./index.js").default | undefined) => void | Promise<void>} CounterCacheParentUpdateListener */
/** @typedef {{canonicalParentModelClass: typeof import("./index.js").default, listeners: CounterCacheParentUpdateListener[], parentId: ReturnType<typeof JSON.parse>, parentPrimaryKey: string, parentQuery: import("../query/model-class-query.js").default<typeof import("./index.js").default>, previousParent: import("./index.js").default | undefined}} PreparedCounterCacheParentUpdate */
/** @type {WeakMap<typeof import("./index.js").default, Set<CounterCacheParentUpdateListener>>} */
const listenersByParentModelClass = new WeakMap();
/**
 * Registers an internal listener for committed counter-cache parent updates.
 * @param {typeof import("./index.js").default} parentModelClass - Parent model class.
 * @param {CounterCacheParentUpdateListener} listener - Committed-parent listener.
 * @returns {() => void} - Listener removal callback.
 */
export function registerCounterCacheParentUpdateListener(parentModelClass, listener) {
    const canonicalParentModelClass = parentModelClass.canonicalRecordMetadataModelClass();
    let listeners = listenersByParentModelClass.get(canonicalParentModelClass);
    if (!listeners) {
        listeners = new Set();
        listenersByParentModelClass.set(canonicalParentModelClass, listeners);
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
}
/**
 * Captures one counter-cache parent's pre-mutation state when listeners are registered.
 * @param {object} args - Parent update arguments.
 * @param {ReturnType<typeof JSON.parse>} args.parentId - Parent relationship identity.
 * @param {typeof import("./index.js").default} args.parentModelClass - Parent model class.
 * @param {string} args.parentPrimaryKey - Parent relationship primary key.
 * @param {import("../query/model-class-query.js").default<typeof import("./index.js").default>} args.parentQuery - Source-owned parent query.
 * @returns {Promise<PreparedCounterCacheParentUpdate | undefined>} - Prepared delivery, or undefined when no listener is registered.
 */
export async function prepareCounterCacheParentUpdate({ parentId, parentModelClass, parentPrimaryKey, parentQuery }) {
    const canonicalParentModelClass = parentModelClass.canonicalRecordMetadataModelClass();
    const registeredListeners = listenersByParentModelClass.get(canonicalParentModelClass);
    if (!registeredListeners || registeredListeners.size == 0)
        return;
    const previousParent = await parentQuery.findBy({ [parentPrimaryKey]: parentId }) || undefined;
    return {
        canonicalParentModelClass,
        listeners: [...registeredListeners],
        parentId,
        parentPrimaryKey,
        parentQuery,
        previousParent
    };
}
/**
 * Schedules one non-coalesced parent reload and notification on the source record's commit lifecycle.
 * @param {object} args - Parent update arguments.
 * @param {PreparedCounterCacheParentUpdate | undefined} args.preparedUpdate - Pre-mutation parent delivery state.
 * @param {import("./index.js").default} args.sourceRecord - Source record that owns the transaction lifecycle.
 * @returns {Promise<void>} - Resolves after registration or immediate delivery.
 */
export async function scheduleCounterCacheParentUpdate({ preparedUpdate, sourceRecord }) {
    if (!preparedUpdate)
        return;
    const { canonicalParentModelClass, listeners, parentId, parentPrimaryKey, parentQuery, previousParent } = preparedUpdate;
    await sourceRecord.connection().afterCommit(async () => {
        let parent;
        try {
            parent = await parentQuery.findBy({ [parentPrimaryKey]: parentId });
        }
        catch (error) {
            await reportCounterCacheParentUpdateError(canonicalParentModelClass._getConfiguration(), error);
            return;
        }
        if (!parent)
            return;
        for (const listener of listeners) {
            try {
                await listener(parent, previousParent);
            }
            catch (error) {
                await reportCounterCacheParentUpdateError(parent._getConfiguration(), error);
            }
        }
    });
}
/**
 * Reports a post-commit delivery failure without rejecting the durable source operation.
 * @param {import("../../configuration.js").default} configuration - Owning configuration.
 * @param {ReturnType<typeof JSON.parse>} caughtError - Reload or listener failure.
 * @returns {Promise<void>} - Resolves after best-effort reporting.
 */
async function reportCounterCacheParentUpdateError(configuration, caughtError) {
    const error = ensureError(caughtError);
    const payload = {
        context: { stage: "counter-cache-parent-update-after-commit" },
        error
    };
    /** @type {ReturnType<typeof JSON.parse>[]} */
    const reportingErrors = [];
    let errorEvents;
    try {
        errorEvents = configuration.getErrorEvents();
    }
    catch (reportingError) {
        reportingErrors.push(reportingError);
    }
    if (errorEvents) {
        try {
            errorEvents.emit("framework-error", payload);
        }
        catch (reportingError) {
            reportingErrors.push(reportingError);
        }
        try {
            errorEvents.emit("all-error", { ...payload, errorType: "framework-error" });
        }
        catch (reportingError) {
            reportingErrors.push(reportingError);
        }
    }
    if (reportingErrors.length == 0)
        return;
    try {
        const logger = new Logger("CounterCacheParentUpdates", { configuration });
        await logger.error("Counter-cache parent update error reporting failed", { error, reportingErrors });
    }
    catch {
        console.error("Counter-cache parent update error reporting failed");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY291bnRlci1jYWNoZS1wYXJlbnQtdXBkYXRlcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9yZWNvcmQvY291bnRlci1jYWNoZS1wYXJlbnQtdXBkYXRlcy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxFQUFDLFdBQVcsRUFBQyxNQUFNLFNBQVMsQ0FBQTtBQUVuQywyS0FBMks7QUFDM0ssa1lBQWtZO0FBRWxZLGtHQUFrRztBQUNsRyxNQUFNLDJCQUEyQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFakQ7Ozs7O0dBS0c7QUFDSCxNQUFNLFVBQVUsd0NBQXdDLENBQUMsZ0JBQWdCLEVBQUUsUUFBUTtJQUNqRixNQUFNLHlCQUF5QixHQUFHLGdCQUFnQixDQUFDLGlDQUFpQyxFQUFFLENBQUE7SUFDdEYsSUFBSSxTQUFTLEdBQUcsMkJBQTJCLENBQUMsR0FBRyxDQUFDLHlCQUF5QixDQUFDLENBQUE7SUFFMUUsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ2YsU0FBUyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDckIsMkJBQTJCLENBQUMsR0FBRyxDQUFDLHlCQUF5QixFQUFFLFNBQVMsQ0FBQyxDQUFBO0lBQ3ZFLENBQUM7SUFFRCxTQUFTLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBRXZCLE9BQU8sR0FBRyxFQUFFLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQTtBQUN6QyxDQUFDO0FBRUQ7Ozs7Ozs7O0dBUUc7QUFDSCxNQUFNLENBQUMsS0FBSyxVQUFVLCtCQUErQixDQUFDLEVBQUMsUUFBUSxFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFFLFdBQVcsRUFBQztJQUMvRyxNQUFNLHlCQUF5QixHQUFHLGdCQUFnQixDQUFDLGlDQUFpQyxFQUFFLENBQUE7SUFDdEYsTUFBTSxtQkFBbUIsR0FBRywyQkFBMkIsQ0FBQyxHQUFHLENBQUMseUJBQXlCLENBQUMsQ0FBQTtJQUV0RixJQUFJLENBQUMsbUJBQW1CLElBQUksbUJBQW1CLENBQUMsSUFBSSxJQUFJLENBQUM7UUFBRSxPQUFNO0lBQ2pFLE1BQU0sY0FBYyxHQUFHLE1BQU0sV0FBVyxDQUFDLE1BQU0sQ0FBQyxFQUFDLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxRQUFRLEVBQUMsQ0FBQyxJQUFJLFNBQVMsQ0FBQTtJQUU1RixPQUFPO1FBQ0wseUJBQXlCO1FBQ3pCLFNBQVMsRUFBRSxDQUFDLEdBQUcsbUJBQW1CLENBQUM7UUFDbkMsUUFBUTtRQUNSLGdCQUFnQjtRQUNoQixXQUFXO1FBQ1gsY0FBYztLQUNmLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsTUFBTSxDQUFDLEtBQUssVUFBVSxnQ0FBZ0MsQ0FBQyxFQUFDLGNBQWMsRUFBRSxZQUFZLEVBQUM7SUFDbkYsSUFBSSxDQUFDLGNBQWM7UUFBRSxPQUFNO0lBRTNCLE1BQU0sRUFBQyx5QkFBeUIsRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLGdCQUFnQixFQUFFLFdBQVcsRUFBRSxjQUFjLEVBQUMsR0FBRyxjQUFjLENBQUE7SUFFdEgsTUFBTSxZQUFZLENBQUMsVUFBVSxFQUFFLENBQUMsV0FBVyxDQUFDLEtBQUssSUFBSSxFQUFFO1FBQ3JELElBQUksTUFBTSxDQUFBO1FBRVYsSUFBSSxDQUFDO1lBQ0gsTUFBTSxHQUFHLE1BQU0sV0FBVyxDQUFDLE1BQU0sQ0FBQyxFQUFDLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxRQUFRLEVBQUMsQ0FBQyxDQUFBO1FBQ25FLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsTUFBTSxtQ0FBbUMsQ0FBQyx5QkFBeUIsQ0FBQyxpQkFBaUIsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO1lBQy9GLE9BQU07UUFDUixDQUFDO1FBRUQsSUFBSSxDQUFDLE1BQU07WUFBRSxPQUFNO1FBRW5CLEtBQUssTUFBTSxRQUFRLElBQUksU0FBUyxFQUFFLENBQUM7WUFDakMsSUFBSSxDQUFDO2dCQUNILE1BQU0sUUFBUSxDQUFDLE1BQU0sRUFBRSxjQUFjLENBQUMsQ0FBQTtZQUN4QyxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixNQUFNLG1DQUFtQyxDQUFDLE1BQU0sQ0FBQyxpQkFBaUIsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO1lBQzlFLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxLQUFLLFVBQVUsbUNBQW1DLENBQUMsYUFBYSxFQUFFLFdBQVc7SUFDM0UsTUFBTSxLQUFLLEdBQUcsV0FBVyxDQUFDLFdBQVcsQ0FBQyxDQUFBO0lBQ3RDLE1BQU0sT0FBTyxHQUFHO1FBQ2QsT0FBTyxFQUFFLEVBQUMsS0FBSyxFQUFFLDBDQUEwQyxFQUFDO1FBQzVELEtBQUs7S0FDTixDQUFBO0lBQ0QsOENBQThDO0lBQzlDLE1BQU0sZUFBZSxHQUFHLEVBQUUsQ0FBQTtJQUMxQixJQUFJLFdBQVcsQ0FBQTtJQUVmLElBQUksQ0FBQztRQUNILFdBQVcsR0FBRyxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUE7SUFDOUMsQ0FBQztJQUFDLE9BQU8sY0FBYyxFQUFFLENBQUM7UUFDeEIsZUFBZSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQTtJQUN0QyxDQUFDO0lBRUQsSUFBSSxXQUFXLEVBQUUsQ0FBQztRQUNoQixJQUFJLENBQUM7WUFDSCxXQUFXLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQzlDLENBQUM7UUFBQyxPQUFPLGNBQWMsRUFBRSxDQUFDO1lBQ3hCLGVBQWUsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUE7UUFDdEMsQ0FBQztRQUVELElBQUksQ0FBQztZQUNILFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtRQUMzRSxDQUFDO1FBQUMsT0FBTyxjQUFjLEVBQUUsQ0FBQztZQUN4QixlQUFlLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBQ3RDLENBQUM7SUFDSCxDQUFDO0lBRUQsSUFBSSxlQUFlLENBQUMsTUFBTSxJQUFJLENBQUM7UUFBRSxPQUFNO0lBRXZDLElBQUksQ0FBQztRQUNILE1BQU0sTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLDJCQUEyQixFQUFFLEVBQUMsYUFBYSxFQUFDLENBQUMsQ0FBQTtRQUV2RSxNQUFNLE1BQU0sQ0FBQyxLQUFLLENBQUMsb0RBQW9ELEVBQUUsRUFBQyxLQUFLLEVBQUUsZUFBZSxFQUFDLENBQUMsQ0FBQTtJQUNwRyxDQUFDO0lBQUMsTUFBTSxDQUFDO1FBQ1AsT0FBTyxDQUFDLEtBQUssQ0FBQyxvREFBb0QsQ0FBQyxDQUFBO0lBQ3JFLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uLy4uL2xvZ2dlci5qc1wiXG5pbXBvcnQge2Vuc3VyZUVycm9yfSBmcm9tIFwidHlwYW5pY1wiXG5cbi8qKiBAdHlwZWRlZiB7KHBhcmVudDogaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0LCBwcmV2aW91c1BhcmVudDogaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gQ291bnRlckNhY2hlUGFyZW50VXBkYXRlTGlzdGVuZXIgKi9cbi8qKiBAdHlwZWRlZiB7e2Nhbm9uaWNhbFBhcmVudE1vZGVsQ2xhc3M6IHR5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQsIGxpc3RlbmVyczogQ291bnRlckNhY2hlUGFyZW50VXBkYXRlTGlzdGVuZXJbXSwgcGFyZW50SWQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBwYXJlbnRQcmltYXJ5S2V5OiBzdHJpbmcsIHBhcmVudFF1ZXJ5OiBpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQ+LCBwcmV2aW91c1BhcmVudDogaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfX0gUHJlcGFyZWRDb3VudGVyQ2FjaGVQYXJlbnRVcGRhdGUgKi9cblxuLyoqIEB0eXBlIHtXZWFrTWFwPHR5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQsIFNldDxDb3VudGVyQ2FjaGVQYXJlbnRVcGRhdGVMaXN0ZW5lcj4+fSAqL1xuY29uc3QgbGlzdGVuZXJzQnlQYXJlbnRNb2RlbENsYXNzID0gbmV3IFdlYWtNYXAoKVxuXG4vKipcbiAqIFJlZ2lzdGVycyBhbiBpbnRlcm5hbCBsaXN0ZW5lciBmb3IgY29tbWl0dGVkIGNvdW50ZXItY2FjaGUgcGFyZW50IHVwZGF0ZXMuXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHBhcmVudE1vZGVsQ2xhc3MgLSBQYXJlbnQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0NvdW50ZXJDYWNoZVBhcmVudFVwZGF0ZUxpc3RlbmVyfSBsaXN0ZW5lciAtIENvbW1pdHRlZC1wYXJlbnQgbGlzdGVuZXIuXG4gKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gLSBMaXN0ZW5lciByZW1vdmFsIGNhbGxiYWNrLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXJDb3VudGVyQ2FjaGVQYXJlbnRVcGRhdGVMaXN0ZW5lcihwYXJlbnRNb2RlbENsYXNzLCBsaXN0ZW5lcikge1xuICBjb25zdCBjYW5vbmljYWxQYXJlbnRNb2RlbENsYXNzID0gcGFyZW50TW9kZWxDbGFzcy5jYW5vbmljYWxSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MoKVxuICBsZXQgbGlzdGVuZXJzID0gbGlzdGVuZXJzQnlQYXJlbnRNb2RlbENsYXNzLmdldChjYW5vbmljYWxQYXJlbnRNb2RlbENsYXNzKVxuXG4gIGlmICghbGlzdGVuZXJzKSB7XG4gICAgbGlzdGVuZXJzID0gbmV3IFNldCgpXG4gICAgbGlzdGVuZXJzQnlQYXJlbnRNb2RlbENsYXNzLnNldChjYW5vbmljYWxQYXJlbnRNb2RlbENsYXNzLCBsaXN0ZW5lcnMpXG4gIH1cblxuICBsaXN0ZW5lcnMuYWRkKGxpc3RlbmVyKVxuXG4gIHJldHVybiAoKSA9PiBsaXN0ZW5lcnMuZGVsZXRlKGxpc3RlbmVyKVxufVxuXG4vKipcbiAqIENhcHR1cmVzIG9uZSBjb3VudGVyLWNhY2hlIHBhcmVudCdzIHByZS1tdXRhdGlvbiBzdGF0ZSB3aGVuIGxpc3RlbmVycyBhcmUgcmVnaXN0ZXJlZC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUGFyZW50IHVwZGF0ZSBhcmd1bWVudHMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnBhcmVudElkIC0gUGFyZW50IHJlbGF0aW9uc2hpcCBpZGVudGl0eS5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5wYXJlbnRNb2RlbENsYXNzIC0gUGFyZW50IG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucGFyZW50UHJpbWFyeUtleSAtIFBhcmVudCByZWxhdGlvbnNoaXAgcHJpbWFyeSBrZXkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdD59IGFyZ3MucGFyZW50UXVlcnkgLSBTb3VyY2Utb3duZWQgcGFyZW50IHF1ZXJ5LlxuICogQHJldHVybnMge1Byb21pc2U8UHJlcGFyZWRDb3VudGVyQ2FjaGVQYXJlbnRVcGRhdGUgfCB1bmRlZmluZWQ+fSAtIFByZXBhcmVkIGRlbGl2ZXJ5LCBvciB1bmRlZmluZWQgd2hlbiBubyBsaXN0ZW5lciBpcyByZWdpc3RlcmVkLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcHJlcGFyZUNvdW50ZXJDYWNoZVBhcmVudFVwZGF0ZSh7cGFyZW50SWQsIHBhcmVudE1vZGVsQ2xhc3MsIHBhcmVudFByaW1hcnlLZXksIHBhcmVudFF1ZXJ5fSkge1xuICBjb25zdCBjYW5vbmljYWxQYXJlbnRNb2RlbENsYXNzID0gcGFyZW50TW9kZWxDbGFzcy5jYW5vbmljYWxSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MoKVxuICBjb25zdCByZWdpc3RlcmVkTGlzdGVuZXJzID0gbGlzdGVuZXJzQnlQYXJlbnRNb2RlbENsYXNzLmdldChjYW5vbmljYWxQYXJlbnRNb2RlbENsYXNzKVxuXG4gIGlmICghcmVnaXN0ZXJlZExpc3RlbmVycyB8fCByZWdpc3RlcmVkTGlzdGVuZXJzLnNpemUgPT0gMCkgcmV0dXJuXG4gIGNvbnN0IHByZXZpb3VzUGFyZW50ID0gYXdhaXQgcGFyZW50UXVlcnkuZmluZEJ5KHtbcGFyZW50UHJpbWFyeUtleV06IHBhcmVudElkfSkgfHwgdW5kZWZpbmVkXG5cbiAgcmV0dXJuIHtcbiAgICBjYW5vbmljYWxQYXJlbnRNb2RlbENsYXNzLFxuICAgIGxpc3RlbmVyczogWy4uLnJlZ2lzdGVyZWRMaXN0ZW5lcnNdLFxuICAgIHBhcmVudElkLFxuICAgIHBhcmVudFByaW1hcnlLZXksXG4gICAgcGFyZW50UXVlcnksXG4gICAgcHJldmlvdXNQYXJlbnRcbiAgfVxufVxuXG4vKipcbiAqIFNjaGVkdWxlcyBvbmUgbm9uLWNvYWxlc2NlZCBwYXJlbnQgcmVsb2FkIGFuZCBub3RpZmljYXRpb24gb24gdGhlIHNvdXJjZSByZWNvcmQncyBjb21taXQgbGlmZWN5Y2xlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQYXJlbnQgdXBkYXRlIGFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7UHJlcGFyZWRDb3VudGVyQ2FjaGVQYXJlbnRVcGRhdGUgfCB1bmRlZmluZWR9IGFyZ3MucHJlcGFyZWRVcGRhdGUgLSBQcmUtbXV0YXRpb24gcGFyZW50IGRlbGl2ZXJ5IHN0YXRlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3Muc291cmNlUmVjb3JkIC0gU291cmNlIHJlY29yZCB0aGF0IG93bnMgdGhlIHRyYW5zYWN0aW9uIGxpZmVjeWNsZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlZ2lzdHJhdGlvbiBvciBpbW1lZGlhdGUgZGVsaXZlcnkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzY2hlZHVsZUNvdW50ZXJDYWNoZVBhcmVudFVwZGF0ZSh7cHJlcGFyZWRVcGRhdGUsIHNvdXJjZVJlY29yZH0pIHtcbiAgaWYgKCFwcmVwYXJlZFVwZGF0ZSkgcmV0dXJuXG5cbiAgY29uc3Qge2Nhbm9uaWNhbFBhcmVudE1vZGVsQ2xhc3MsIGxpc3RlbmVycywgcGFyZW50SWQsIHBhcmVudFByaW1hcnlLZXksIHBhcmVudFF1ZXJ5LCBwcmV2aW91c1BhcmVudH0gPSBwcmVwYXJlZFVwZGF0ZVxuXG4gIGF3YWl0IHNvdXJjZVJlY29yZC5jb25uZWN0aW9uKCkuYWZ0ZXJDb21taXQoYXN5bmMgKCkgPT4ge1xuICAgIGxldCBwYXJlbnRcblxuICAgIHRyeSB7XG4gICAgICBwYXJlbnQgPSBhd2FpdCBwYXJlbnRRdWVyeS5maW5kQnkoe1twYXJlbnRQcmltYXJ5S2V5XTogcGFyZW50SWR9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhd2FpdCByZXBvcnRDb3VudGVyQ2FjaGVQYXJlbnRVcGRhdGVFcnJvcihjYW5vbmljYWxQYXJlbnRNb2RlbENsYXNzLl9nZXRDb25maWd1cmF0aW9uKCksIGVycm9yKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKCFwYXJlbnQpIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBsaXN0ZW5lciBvZiBsaXN0ZW5lcnMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGxpc3RlbmVyKHBhcmVudCwgcHJldmlvdXNQYXJlbnQpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBhd2FpdCByZXBvcnRDb3VudGVyQ2FjaGVQYXJlbnRVcGRhdGVFcnJvcihwYXJlbnQuX2dldENvbmZpZ3VyYXRpb24oKSwgZXJyb3IpXG4gICAgICB9XG4gICAgfVxuICB9KVxufVxuXG4vKipcbiAqIFJlcG9ydHMgYSBwb3N0LWNvbW1pdCBkZWxpdmVyeSBmYWlsdXJlIHdpdGhvdXQgcmVqZWN0aW5nIHRoZSBkdXJhYmxlIHNvdXJjZSBvcGVyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIE93bmluZyBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gY2F1Z2h0RXJyb3IgLSBSZWxvYWQgb3IgbGlzdGVuZXIgZmFpbHVyZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGJlc3QtZWZmb3J0IHJlcG9ydGluZy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcmVwb3J0Q291bnRlckNhY2hlUGFyZW50VXBkYXRlRXJyb3IoY29uZmlndXJhdGlvbiwgY2F1Z2h0RXJyb3IpIHtcbiAgY29uc3QgZXJyb3IgPSBlbnN1cmVFcnJvcihjYXVnaHRFcnJvcilcbiAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICBjb250ZXh0OiB7c3RhZ2U6IFwiY291bnRlci1jYWNoZS1wYXJlbnQtdXBkYXRlLWFmdGVyLWNvbW1pdFwifSxcbiAgICBlcnJvclxuICB9XG4gIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT5bXX0gKi9cbiAgY29uc3QgcmVwb3J0aW5nRXJyb3JzID0gW11cbiAgbGV0IGVycm9yRXZlbnRzXG5cbiAgdHJ5IHtcbiAgICBlcnJvckV2ZW50cyA9IGNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuICB9IGNhdGNoIChyZXBvcnRpbmdFcnJvcikge1xuICAgIHJlcG9ydGluZ0Vycm9ycy5wdXNoKHJlcG9ydGluZ0Vycm9yKVxuICB9XG5cbiAgaWYgKGVycm9yRXZlbnRzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICB9IGNhdGNoIChyZXBvcnRpbmdFcnJvcikge1xuICAgICAgcmVwb3J0aW5nRXJyb3JzLnB1c2gocmVwb3J0aW5nRXJyb3IpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgfSBjYXRjaCAocmVwb3J0aW5nRXJyb3IpIHtcbiAgICAgIHJlcG9ydGluZ0Vycm9ycy5wdXNoKHJlcG9ydGluZ0Vycm9yKVxuICAgIH1cbiAgfVxuXG4gIGlmIChyZXBvcnRpbmdFcnJvcnMubGVuZ3RoID09IDApIHJldHVyblxuXG4gIHRyeSB7XG4gICAgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcihcIkNvdW50ZXJDYWNoZVBhcmVudFVwZGF0ZXNcIiwge2NvbmZpZ3VyYXRpb259KVxuXG4gICAgYXdhaXQgbG9nZ2VyLmVycm9yKFwiQ291bnRlci1jYWNoZSBwYXJlbnQgdXBkYXRlIGVycm9yIHJlcG9ydGluZyBmYWlsZWRcIiwge2Vycm9yLCByZXBvcnRpbmdFcnJvcnN9KVxuICB9IGNhdGNoIHtcbiAgICBjb25zb2xlLmVycm9yKFwiQ291bnRlci1jYWNoZSBwYXJlbnQgdXBkYXRlIGVycm9yIHJlcG9ydGluZyBmYWlsZWRcIilcbiAgfVxufVxuIl19