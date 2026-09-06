// @ts-check
import Logger from "../../logger.js";
import { ensureError } from "typanic";
/** @typedef {(parent: import("./index.js").default) => void | Promise<void>} CounterCacheParentUpdateListener */
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
 * Schedules one non-coalesced parent reload and notification on the source record's commit lifecycle.
 * @param {object} args - Parent update arguments.
 * @param {ReturnType<typeof JSON.parse>} args.parentId - Parent relationship identity.
 * @param {typeof import("./index.js").default} args.parentModelClass - Parent model class.
 * @param {string} args.parentPrimaryKey - Parent relationship primary key.
 * @param {import("../query/model-class-query.js").default<typeof import("./index.js").default>} args.parentQuery - Source-owned parent query.
 * @param {import("./index.js").default} args.sourceRecord - Source record that owns the transaction lifecycle.
 * @returns {Promise<void>} - Resolves after registration or immediate delivery.
 */
export async function scheduleCounterCacheParentUpdate({ parentId, parentModelClass, parentPrimaryKey, parentQuery, sourceRecord }) {
    const canonicalParentModelClass = parentModelClass.canonicalRecordMetadataModelClass();
    const registeredListeners = listenersByParentModelClass.get(canonicalParentModelClass);
    if (!registeredListeners || registeredListeners.size == 0)
        return;
    const listeners = [...registeredListeners];
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
                await listener(parent);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY291bnRlci1jYWNoZS1wYXJlbnQtdXBkYXRlcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9yZWNvcmQvY291bnRlci1jYWNoZS1wYXJlbnQtdXBkYXRlcy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxNQUFNLE1BQU0saUJBQWlCLENBQUE7QUFDcEMsT0FBTyxFQUFDLFdBQVcsRUFBQyxNQUFNLFNBQVMsQ0FBQTtBQUVuQyxpSEFBaUg7QUFFakgsa0dBQWtHO0FBQ2xHLE1BQU0sMkJBQTJCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUVqRDs7Ozs7R0FLRztBQUNILE1BQU0sVUFBVSx3Q0FBd0MsQ0FBQyxnQkFBZ0IsRUFBRSxRQUFRO0lBQ2pGLE1BQU0seUJBQXlCLEdBQUcsZ0JBQWdCLENBQUMsaUNBQWlDLEVBQUUsQ0FBQTtJQUN0RixJQUFJLFNBQVMsR0FBRywyQkFBMkIsQ0FBQyxHQUFHLENBQUMseUJBQXlCLENBQUMsQ0FBQTtJQUUxRSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDZixTQUFTLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUNyQiwyQkFBMkIsQ0FBQyxHQUFHLENBQUMseUJBQXlCLEVBQUUsU0FBUyxDQUFDLENBQUE7SUFDdkUsQ0FBQztJQUVELFNBQVMsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUE7SUFFdkIsT0FBTyxHQUFHLEVBQUUsQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFBO0FBQ3pDLENBQUM7QUFFRDs7Ozs7Ozs7O0dBU0c7QUFDSCxNQUFNLENBQUMsS0FBSyxVQUFVLGdDQUFnQyxDQUFDLEVBQUMsUUFBUSxFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFFLFdBQVcsRUFBRSxZQUFZLEVBQUM7SUFDOUgsTUFBTSx5QkFBeUIsR0FBRyxnQkFBZ0IsQ0FBQyxpQ0FBaUMsRUFBRSxD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QW9ELENBQUMsQ0FBQTtJQUNyRSxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi8uLi9sb2dnZXIuanNcIlxuaW1wb3J0IHtlbnN1cmVFcnJvcn0gZnJvbSBcInR5cGFuaWNcIlxuXG4vKiogQHR5cGVkZWYgeyhwYXJlbnQ6IGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59IENvdW50ZXJDYWNoZVBhcmVudFVwZGF0ZUxpc3RlbmVyICovXG5cbi8qKiBAdHlwZSB7V2Vha01hcDx0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0LCBTZXQ8Q291bnRlckNhY2hlUGFyZW50VXBkYXRlTGlzdGVuZXI+Pn0gKi9cbmNvbnN0IGxpc3RlbmVyc0J5UGFyZW50TW9kZWxDbGFzcyA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBSZWdpc3RlcnMgYW4gaW50ZXJuYWwgbGlzdGVuZXIgZm9yIGNvbW1pdHRlZCBjb3VudGVyLWNhY2hlIHBhcmVudCB1cGRhdGVzLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBwYXJlbnRNb2RlbENsYXNzIC0gUGFyZW50IG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtDb3VudGVyQ2FjaGVQYXJlbnRVcGRhdGVMaXN0ZW5lcn0gbGlzdGVuZXIgLSBDb21taXR0ZWQtcGFyZW50IGxpc3RlbmVyLlxuICogQHJldHVybnMgeygpID0+IHZvaWR9IC0gTGlzdGVuZXIgcmVtb3ZhbCBjYWxsYmFjay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyQ291bnRlckNhY2hlUGFyZW50VXBkYXRlTGlzdGVuZXIocGFyZW50TW9kZWxDbGFzcywgbGlzdGVuZXIpIHtcbiAgY29uc3QgY2Fub25pY2FsUGFyZW50TW9kZWxDbGFzcyA9IHBhcmVudE1vZGVsQ2xhc3MuY2Fub25pY2FsUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKClcbiAgbGV0IGxpc3RlbmVycyA9IGxpc3RlbmVyc0J5UGFyZW50TW9kZWxDbGFzcy5nZXQoY2Fub25pY2FsUGFyZW50TW9kZWxDbGFzcylcblxuICBpZiAoIWxpc3RlbmVycykge1xuICAgIGxpc3RlbmVycyA9IG5ldyBTZXQoKVxuICAgIGxpc3RlbmVyc0J5UGFyZW50TW9kZWxDbGFzcy5zZXQoY2Fub25pY2FsUGFyZW50TW9kZWxDbGFzcywgbGlzdGVuZXJzKVxuICB9XG5cbiAgbGlzdGVuZXJzLmFkZChsaXN0ZW5lcilcblxuICByZXR1cm4gKCkgPT4gbGlzdGVuZXJzLmRlbGV0ZShsaXN0ZW5lcilcbn1cblxuLyoqXG4gKiBTY2hlZHVsZXMgb25lIG5vbi1jb2FsZXNjZWQgcGFyZW50IHJlbG9hZCBhbmQgbm90aWZpY2F0aW9uIG9uIHRoZSBzb3VyY2UgcmVjb3JkJ3MgY29tbWl0IGxpZmVjeWNsZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUGFyZW50IHVwZGF0ZSBhcmd1bWVudHMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnBhcmVudElkIC0gUGFyZW50IHJlbGF0aW9uc2hpcCBpZGVudGl0eS5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5wYXJlbnRNb2RlbENsYXNzIC0gUGFyZW50IG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucGFyZW50UHJpbWFyeUtleSAtIFBhcmVudCByZWxhdGlvbnNoaXAgcHJpbWFyeSBrZXkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdD59IGFyZ3MucGFyZW50UXVlcnkgLSBTb3VyY2Utb3duZWQgcGFyZW50IHF1ZXJ5LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3Muc291cmNlUmVjb3JkIC0gU291cmNlIHJlY29yZCB0aGF0IG93bnMgdGhlIHRyYW5zYWN0aW9uIGxpZmVjeWNsZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJlZ2lzdHJhdGlvbiBvciBpbW1lZGlhdGUgZGVsaXZlcnkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzY2hlZHVsZUNvdW50ZXJDYWNoZVBhcmVudFVwZGF0ZSh7cGFyZW50SWQsIHBhcmVudE1vZGVsQ2xhc3MsIHBhcmVudFByaW1hcnlLZXksIHBhcmVudFF1ZXJ5LCBzb3VyY2VSZWNvcmR9KSB7XG4gIGNvbnN0IGNhbm9uaWNhbFBhcmVudE1vZGVsQ2xhc3MgPSBwYXJlbnRNb2RlbENsYXNzLmNhbm9uaWNhbFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcygpXG4gIGNvbnN0IHJlZ2lzdGVyZWRMaXN0ZW5lcnMgPSBsaXN0ZW5lcnNCeVBhcmVudE1vZGVsQ2xhc3MuZ2V0KGNhbm9uaWNhbFBhcmVudE1vZGVsQ2xhc3MpXG5cbiAgaWYgKCFyZWdpc3RlcmVkTGlzdGVuZXJzIHx8IHJlZ2lzdGVyZWRMaXN0ZW5lcnMuc2l6ZSA9PSAwKSByZXR1cm5cblxuICBjb25zdCBsaXN0ZW5lcnMgPSBbLi4ucmVnaXN0ZXJlZExpc3RlbmVyc11cblxuICBhd2FpdCBzb3VyY2VSZWNvcmQuY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IHtcbiAgICBsZXQgcGFyZW50XG5cbiAgICB0cnkge1xuICAgICAgcGFyZW50ID0gYXdhaXQgcGFyZW50UXVlcnkuZmluZEJ5KHtbcGFyZW50UHJpbWFyeUtleV06IHBhcmVudElkfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXdhaXQgcmVwb3J0Q291bnRlckNhY2hlUGFyZW50VXBkYXRlRXJyb3IoY2Fub25pY2FsUGFyZW50TW9kZWxDbGFzcy5fZ2V0Q29uZmlndXJhdGlvbigpLCBlcnJvcilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICghcGFyZW50KSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgbGlzdGVuZXJzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBsaXN0ZW5lcihwYXJlbnQpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBhd2FpdCByZXBvcnRDb3VudGVyQ2FjaGVQYXJlbnRVcGRhdGVFcnJvcihwYXJlbnQuX2dldENvbmZpZ3VyYXRpb24oKSwgZXJyb3IpXG4gICAgICB9XG4gICAgfVxuICB9KVxufVxuXG4vKipcbiAqIFJlcG9ydHMgYSBwb3N0LWNvbW1pdCBkZWxpdmVyeSBmYWlsdXJlIHdpdGhvdXQgcmVqZWN0aW5nIHRoZSBkdXJhYmxlIHNvdXJjZSBvcGVyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIE93bmluZyBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gY2F1Z2h0RXJyb3IgLSBSZWxvYWQgb3IgbGlzdGVuZXIgZmFpbHVyZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGJlc3QtZWZmb3J0IHJlcG9ydGluZy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcmVwb3J0Q291bnRlckNhY2hlUGFyZW50VXBkYXRlRXJyb3IoY29uZmlndXJhdGlvbiwgY2F1Z2h0RXJyb3IpIHtcbiAgY29uc3QgZXJyb3IgPSBlbnN1cmVFcnJvcihjYXVnaHRFcnJvcilcbiAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICBjb250ZXh0OiB7c3RhZ2U6IFwiY291bnRlci1jYWNoZS1wYXJlbnQtdXBkYXRlLWFmdGVyLWNvbW1pdFwifSxcbiAgICBlcnJvclxuICB9XG4gIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT5bXX0gKi9cbiAgY29uc3QgcmVwb3J0aW5nRXJyb3JzID0gW11cbiAgbGV0IGVycm9yRXZlbnRzXG5cbiAgdHJ5IHtcbiAgICBlcnJvckV2ZW50cyA9IGNvbmZpZ3VyYXRpb24uZ2V0RXJyb3JFdmVudHMoKVxuICB9IGNhdGNoIChyZXBvcnRpbmdFcnJvcikge1xuICAgIHJlcG9ydGluZ0Vycm9ycy5wdXNoKHJlcG9ydGluZ0Vycm9yKVxuICB9XG5cbiAgaWYgKGVycm9yRXZlbnRzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgcGF5bG9hZClcbiAgICB9IGNhdGNoIChyZXBvcnRpbmdFcnJvcikge1xuICAgICAgcmVwb3J0aW5nRXJyb3JzLnB1c2gocmVwb3J0aW5nRXJyb3IpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGVycm9yRXZlbnRzLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLnBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gICAgfSBjYXRjaCAocmVwb3J0aW5nRXJyb3IpIHtcbiAgICAgIHJlcG9ydGluZ0Vycm9ycy5wdXNoKHJlcG9ydGluZ0Vycm9yKVxuICAgIH1cbiAgfVxuXG4gIGlmIChyZXBvcnRpbmdFcnJvcnMubGVuZ3RoID09IDApIHJldHVyblxuXG4gIHRyeSB7XG4gICAgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcihcIkNvdW50ZXJDYWNoZVBhcmVudFVwZGF0ZXNcIiwge2NvbmZpZ3VyYXRpb259KVxuXG4gICAgYXdhaXQgbG9nZ2VyLmVycm9yKFwiQ291bnRlci1jYWNoZSBwYXJlbnQgdXBkYXRlIGVycm9yIHJlcG9ydGluZyBmYWlsZWRcIiwge2Vycm9yLCByZXBvcnRpbmdFcnJvcnN9KVxuICB9IGNhdGNoIHtcbiAgICBjb25zb2xlLmVycm9yKFwiQ291bnRlci1jYWNoZSBwYXJlbnQgdXBkYXRlIGVycm9yIHJlcG9ydGluZyBmYWlsZWRcIilcbiAgfVxufVxuIl19