// @ts-check
import debounceFunction from "debounce";
import { useEffect, useMemo, useRef } from "react";
import clearPendingDebouncedCallback from "./clear-pending-debounced-callback.js";
import { modelsDependencyKey, modelsFromInput } from "./event-hook-models.js";
import useModelClassEvent from "./use-model-class-event.js";
/**
 * FrontendModelClass type.
 * @typedef {import("./base.js").FrontendModelClass} FrontendModelClass */
/**
 * FrontendModelInstance type.
 * @typedef {import("./base.js").default} FrontendModelInstance */
/**
 * FrontendModelClassUpdateEventPayload type.
 * @typedef {import("./use-model-class-event.js").FrontendModelCreateUpdateEventPayload} FrontendModelClassUpdateEventPayload */
/**
 * Defines this typedef.
 * @typedef {{id: string, model: FrontendModelInstance}} FrontendModelInstanceUpdateEventPayload */
/**
 * FrontendModelUpdateEventPayload type.
 * @typedef {FrontendModelClassUpdateEventPayload | FrontendModelInstanceUpdateEventPayload} FrontendModelUpdateEventPayload */
/**
 * UseUpdatedEventOptions type.
 * @typedef {import("./use-model-class-event.js").UseModelClassEventOptions} UseUpdatedEventOptions */
/**
 * FrontendModelUpdateEventCallback type.
 * @typedef {(payload: FrontendModelUpdateEventPayload) => void} FrontendModelUpdateEventCallback */
/**
 * Runs assert no unknown options.
 * @param {Record<string, import("./query.js").FrontendModelTransportValue | (() => void) | undefined>} restOptions - Unknown options object.
 * @returns {void}
 */
function assertNoUnknownOptions(restOptions) {
    const unknownOptionNames = Object.keys(restOptions);
    if (unknownOptionNames.length > 0) {
        throw new Error(`Unknown options given to useUpdatedEvent: ${unknownOptionNames.join(", ")}`);
    }
}
/**
 * Runs event query dependency payload.
 * @param {import("./query.js").default<FrontendModelClass> | undefined} query - Event query option.
 * @returns {import("./query.js").FrontendModelEventOptionsPayload | null} Stable dependency payload.
 */
function eventQueryDependencyPayload(query) {
    if (!query)
        return null;
    return query.eventOptionsPayload();
}
/**
 * React hook for frontend-model update events. Pass a model class for class-level
 * update events, or a model / model array for instance-level update events.
 * @param {FrontendModelClass | FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelClassOrModels - Model class, model, or models.
 * @param {FrontendModelUpdateEventCallback} callback - Event callback.
 * @param {UseUpdatedEventOptions} [options] - Hook options.
 * @returns {void}
 */
export default function useUpdatedEvent(modelClassOrModels, callback, options = {}) {
    const { active = true, abilities, debounce = false, onConnected, preload, query, queryData, select, selectsExtra, withCount, ...restOptions } = options;
    assertNoUnknownOptions(restOptions);
    const classModel = typeof modelClassOrModels === "function" ? modelClassOrModels : null;
    const instanceModels = typeof modelClassOrModels === "function" ? null : modelClassOrModels;
    const projectionOptions = { abilities, preload, query, queryData, select, selectsExtra, withCount };
    useModelClassEvent(classModel, "update", (payload) => {
        callback(/** @type {FrontendModelClassUpdateEventPayload} */ (payload));
    }, { active: active && Boolean(classModel), debounce, onConnected, ...projectionOptions });
    useInstanceUpdatedEvent(instanceModels, callback, { active: active && !classModel, debounce, onConnected, ...projectionOptions });
}
/**
 * Runs use instance updated event.
 * @param {FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelOrModels - Model or models.
 * @param {FrontendModelUpdateEventCallback} callback - Event callback.
 * @param {UseUpdatedEventOptions} options - Hook options.
 * @returns {void}
 */
function useInstanceUpdatedEvent(modelOrModels, callback, options) {
    const { active = true, abilities, debounce = false, onConnected, preload, query, queryData, select, selectsExtra, withCount } = options;
    const projectionKey = JSON.stringify({ abilities, preload, query: eventQueryDependencyPayload(query), queryData, select, selectsExtra, withCount });
    const projectionOptionsRef = useRef({ abilities, preload, query, queryData, select, selectsExtra, withCount });
    const callbackRef = useRef(callback);
    const activeRef = useRef(active);
    projectionOptionsRef.current = { abilities, preload, query, queryData, select, selectsExtra, withCount };
    callbackRef.current = callback;
    activeRef.current = active;
    const modelsKey = modelsDependencyKey(modelOrModels);
    const eventCallback = useMemo(() => {
        const wrappedCallback = (/** @type {FrontendModelInstanceUpdateEventPayload} */ payload) => {
            if (activeRef.current)
                callbackRef.current(payload);
        };
        if (typeof debounce === "number")
            return debounceFunction(wrappedCallback, debounce);
        if (debounce)
            return debounceFunction(wrappedCallback);
        return wrappedCallback;
    }, [debounce]);
    useEffect(() => {
        if (!active)
            return undefined;
        const models = modelsFromInput(modelOrModels);
        if (models.length < 1)
            return undefined;
        let closed = false;
        /**
         * Unsubscribe callbacks.
         * @type {Array<() => void>} */
        const unsubscribeCallbacks = [];
        const subscriptionCallback = (/** @type {FrontendModelInstanceUpdateEventPayload} */ payload) => {
            if (!closed)
                eventCallback(payload);
        };
        void (async () => {
            for (const model of models) {
                const unsubscribe = await model.onUpdate(subscriptionCallback, projectionOptionsRef.current);
                if (closed) {
                    unsubscribe();
                }
                else {
                    unsubscribeCallbacks.push(unsubscribe);
                }
            }
            if (!closed && onConnected)
                onConnected();
        })();
        return () => {
            closed = true;
            for (const unsubscribe of unsubscribeCallbacks) {
                unsubscribe();
            }
            clearPendingDebouncedCallback(eventCallback);
        };
    }, [active, eventCallback, modelsKey, onConnected, projectionKey]);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXNlLXVwZGF0ZWQtZXZlbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZnJvbnRlbmQtbW9kZWxzL3VzZS11cGRhdGVkLWV2ZW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGdCQUFnQixNQUFNLFVBQVUsQ0FBQTtBQUN2QyxPQUFPLEVBQUMsU0FBUyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUMsTUFBTSxPQUFPLENBQUE7QUFFaEQsT0FBTyw2QkFBNkIsTUFBTSx1Q0FBdUMsQ0FBQTtBQUNqRixPQUFPLEVBQUMsbUJBQW1CLEVBQUUsZUFBZSxFQUFDLE1BQU0sd0JBQXdCLENBQUE7QUFDM0UsT0FBTyxrQkFBa0IsTUFBTSw0QkFBNEIsQ0FBQTtBQUUzRDs7MEVBRTBFO0FBQzFFOztrRUFFa0U7QUFDbEU7O2dJQUVnSTtBQUNoSTs7bUdBRW1HO0FBQ25HOzsrSEFFK0g7QUFDL0g7O3NHQUVzRztBQUN0Rzs7b0dBRW9HO0FBRXBHOzs7O0dBSUc7QUFDSCxTQUFTLHNCQUFzQixDQUFDLFdBQVc7SUFDekMsTUFBTSxrQkFBa0IsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFBO0lBRW5ELElBQUksa0JBQWtCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ2xDLE1BQU0sSUFBSSxLQUFLLENBQUMsNkNBQTZDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUE7SUFDL0YsQ0FBQztBQUNILENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUywyQkFBMkIsQ0FBQyxLQUFLO0lBQ3hDLElBQUksQ0FBQyxLQUFLO1FBQUUsT0FBTyxJQUFJLENBQUE7SUFFdkIsT0FBTyxLQUFLLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtBQUNwQyxDQUFDO0FBRUQ7Ozs7Ozs7R0FPRztBQUNILE1BQU0sQ0FBQyxPQUFPLFVBQVUsZUFBZSxDQUFD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QztZQUNILENBQUM7WUFFRCxJQUFJLENBQUMsTUFBTSxJQUFJLFdBQVc7Z0JBQUUsV0FBVyxFQUFFLENBQUE7UUFDM0MsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUVKLE9BQU8sR0FBRyxFQUFFO1lBQ1YsTUFBTSxHQUFHLElBQUksQ0FBQTtZQUViLEtBQUssTUFBTSxXQUFXLElBQUksb0JBQW9CLEVBQUUsQ0FBQztnQkFDL0MsV0FBVyxFQUFFLENBQUE7WUFDZixDQUFDO1lBRUQsNkJBQTZCLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDOUMsQ0FBQyxDQUFBO0lBQ0gsQ0FBQyxFQUFFLENBQUMsTUFBTSxFQUFFLGFBQWEsRUFBRSxTQUFTLEVBQUUsV0FBVyxFQUFFLGFBQWEsQ0FBQyxDQUFDLENBQUE7QUFDcEUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgZGVib3VuY2VGdW5jdGlvbiBmcm9tIFwiZGVib3VuY2VcIlxuaW1wb3J0IHt1c2VFZmZlY3QsIHVzZU1lbW8sIHVzZVJlZn0gZnJvbSBcInJlYWN0XCJcblxuaW1wb3J0IGNsZWFyUGVuZGluZ0RlYm91bmNlZENhbGxiYWNrIGZyb20gXCIuL2NsZWFyLXBlbmRpbmctZGVib3VuY2VkLWNhbGxiYWNrLmpzXCJcbmltcG9ydCB7bW9kZWxzRGVwZW5kZW5jeUtleSwgbW9kZWxzRnJvbUlucHV0fSBmcm9tIFwiLi9ldmVudC1ob29rLW1vZGVscy5qc1wiXG5pbXBvcnQgdXNlTW9kZWxDbGFzc0V2ZW50IGZyb20gXCIuL3VzZS1tb2RlbC1jbGFzcy1ldmVudC5qc1wiXG5cbi8qKlxuICogRnJvbnRlbmRNb2RlbENsYXNzIHR5cGUuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzc30gRnJvbnRlbmRNb2RlbENsYXNzICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxJbnN0YW5jZSB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5kZWZhdWx0fSBGcm9udGVuZE1vZGVsSW5zdGFuY2UgKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbENsYXNzVXBkYXRlRXZlbnRQYXlsb2FkIHR5cGUuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi91c2UtbW9kZWwtY2xhc3MtZXZlbnQuanNcIikuRnJvbnRlbmRNb2RlbENyZWF0ZVVwZGF0ZUV2ZW50UGF5bG9hZH0gRnJvbnRlbmRNb2RlbENsYXNzVXBkYXRlRXZlbnRQYXlsb2FkICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tpZDogc3RyaW5nLCBtb2RlbDogRnJvbnRlbmRNb2RlbEluc3RhbmNlfX0gRnJvbnRlbmRNb2RlbEluc3RhbmNlVXBkYXRlRXZlbnRQYXlsb2FkICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxVcGRhdGVFdmVudFBheWxvYWQgdHlwZS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsQ2xhc3NVcGRhdGVFdmVudFBheWxvYWQgfCBGcm9udGVuZE1vZGVsSW5zdGFuY2VVcGRhdGVFdmVudFBheWxvYWR9IEZyb250ZW5kTW9kZWxVcGRhdGVFdmVudFBheWxvYWQgKi9cbi8qKlxuICogVXNlVXBkYXRlZEV2ZW50T3B0aW9ucyB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vdXNlLW1vZGVsLWNsYXNzLWV2ZW50LmpzXCIpLlVzZU1vZGVsQ2xhc3NFdmVudE9wdGlvbnN9IFVzZVVwZGF0ZWRFdmVudE9wdGlvbnMgKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFVwZGF0ZUV2ZW50Q2FsbGJhY2sgdHlwZS5cbiAqIEB0eXBlZGVmIHsocGF5bG9hZDogRnJvbnRlbmRNb2RlbFVwZGF0ZUV2ZW50UGF5bG9hZCkgPT4gdm9pZH0gRnJvbnRlbmRNb2RlbFVwZGF0ZUV2ZW50Q2FsbGJhY2sgKi9cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBubyB1bmtub3duIG9wdGlvbnMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlIHwgKCgpID0+IHZvaWQpIHwgdW5kZWZpbmVkPn0gcmVzdE9wdGlvbnMgLSBVbmtub3duIG9wdGlvbnMgb2JqZWN0LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydE5vVW5rbm93bk9wdGlvbnMocmVzdE9wdGlvbnMpIHtcbiAgY29uc3QgdW5rbm93bk9wdGlvbk5hbWVzID0gT2JqZWN0LmtleXMocmVzdE9wdGlvbnMpXG5cbiAgaWYgKHVua25vd25PcHRpb25OYW1lcy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG9wdGlvbnMgZ2l2ZW4gdG8gdXNlVXBkYXRlZEV2ZW50OiAke3Vua25vd25PcHRpb25OYW1lcy5qb2luKFwiLCBcIil9YClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZXZlbnQgcXVlcnkgZGVwZW5kZW5jeSBwYXlsb2FkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8RnJvbnRlbmRNb2RlbENsYXNzPiB8IHVuZGVmaW5lZH0gcXVlcnkgLSBFdmVudCBxdWVyeSBvcHRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZCB8IG51bGx9IFN0YWJsZSBkZXBlbmRlbmN5IHBheWxvYWQuXG4gKi9cbmZ1bmN0aW9uIGV2ZW50UXVlcnlEZXBlbmRlbmN5UGF5bG9hZChxdWVyeSkge1xuICBpZiAoIXF1ZXJ5KSByZXR1cm4gbnVsbFxuXG4gIHJldHVybiBxdWVyeS5ldmVudE9wdGlvbnNQYXlsb2FkKClcbn1cblxuLyoqXG4gKiBSZWFjdCBob29rIGZvciBmcm9udGVuZC1tb2RlbCB1cGRhdGUgZXZlbnRzLiBQYXNzIGEgbW9kZWwgY2xhc3MgZm9yIGNsYXNzLWxldmVsXG4gKiB1cGRhdGUgZXZlbnRzLCBvciBhIG1vZGVsIC8gbW9kZWwgYXJyYXkgZm9yIGluc3RhbmNlLWxldmVsIHVwZGF0ZSBldmVudHMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzcyB8IEZyb250ZW5kTW9kZWxJbnN0YW5jZSB8IEZyb250ZW5kTW9kZWxJbnN0YW5jZVtdIHwgbnVsbCB8IHVuZGVmaW5lZH0gbW9kZWxDbGFzc09yTW9kZWxzIC0gTW9kZWwgY2xhc3MsIG1vZGVsLCBvciBtb2RlbHMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxVcGRhdGVFdmVudENhbGxiYWNrfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICogQHBhcmFtIHtVc2VVcGRhdGVkRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBIb29rIG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gdXNlVXBkYXRlZEV2ZW50KG1vZGVsQ2xhc3NPck1vZGVscywgY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICBjb25zdCB7YWN0aXZlID0gdHJ1ZSwgYWJpbGl0aWVzLCBkZWJvdW5jZSA9IGZhbHNlLCBvbkNvbm5lY3RlZCwgcHJlbG9hZCwgcXVlcnksIHF1ZXJ5RGF0YSwgc2VsZWN0LCBzZWxlY3RzRXh0cmEsIHdpdGhDb3VudCwgLi4ucmVzdE9wdGlvbnN9ID0gb3B0aW9uc1xuICBhc3NlcnROb1Vua25vd25PcHRpb25zKHJlc3RPcHRpb25zKVxuXG4gIGNvbnN0IGNsYXNzTW9kZWwgPSB0eXBlb2YgbW9kZWxDbGFzc09yTW9kZWxzID09PSBcImZ1bmN0aW9uXCIgPyBtb2RlbENsYXNzT3JNb2RlbHMgOiBudWxsXG4gIGNvbnN0IGluc3RhbmNlTW9kZWxzID0gdHlwZW9mIG1vZGVsQ2xhc3NPck1vZGVscyA9PT0gXCJmdW5jdGlvblwiID8gbnVsbCA6IG1vZGVsQ2xhc3NPck1vZGVsc1xuICBjb25zdCBwcm9qZWN0aW9uT3B0aW9ucyA9IHthYmlsaXRpZXMsIHByZWxvYWQsIHF1ZXJ5LCBxdWVyeURhdGEsIHNlbGVjdCwgc2VsZWN0c0V4dHJhLCB3aXRoQ291bnR9XG5cbiAgdXNlTW9kZWxDbGFzc0V2ZW50KGNsYXNzTW9kZWwsIFwidXBkYXRlXCIsIChwYXlsb2FkKSA9PiB7XG4gICAgY2FsbGJhY2soLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQ2xhc3NVcGRhdGVFdmVudFBheWxvYWR9ICovIChwYXlsb2FkKSlcbiAgfSwge2FjdGl2ZTogYWN0aXZlICYmIEJvb2xlYW4oY2xhc3NNb2RlbCksIGRlYm91bmNlLCBvbkNvbm5lY3RlZCwgLi4ucHJvamVjdGlvbk9wdGlvbnN9KVxuICB1c2VJbnN0YW5jZVVwZGF0ZWRFdmVudChpbnN0YW5jZU1vZGVscywgY2FsbGJhY2ssIHthY3RpdmU6IGFjdGl2ZSAmJiAhY2xhc3NNb2RlbCwgZGVib3VuY2UsIG9uQ29ubmVjdGVkLCAuLi5wcm9qZWN0aW9uT3B0aW9uc30pXG59XG5cbi8qKlxuICogUnVucyB1c2UgaW5zdGFuY2UgdXBkYXRlZCBldmVudC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEluc3RhbmNlIHwgRnJvbnRlbmRNb2RlbEluc3RhbmNlW10gfCBudWxsIHwgdW5kZWZpbmVkfSBtb2RlbE9yTW9kZWxzIC0gTW9kZWwgb3IgbW9kZWxzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsVXBkYXRlRXZlbnRDYWxsYmFja30gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAqIEBwYXJhbSB7VXNlVXBkYXRlZEV2ZW50T3B0aW9uc30gb3B0aW9ucyAtIEhvb2sgb3B0aW9ucy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiB1c2VJbnN0YW5jZVVwZGF0ZWRFdmVudChtb2RlbE9yTW9kZWxzLCBjYWxsYmFjaywgb3B0aW9ucykge1xuICBjb25zdCB7YWN0aXZlID0gdHJ1ZSwgYWJpbGl0aWVzLCBkZWJvdW5jZSA9IGZhbHNlLCBvbkNvbm5lY3RlZCwgcHJlbG9hZCwgcXVlcnksIHF1ZXJ5RGF0YSwgc2VsZWN0LCBzZWxlY3RzRXh0cmEsIHdpdGhDb3VudH0gPSBvcHRpb25zXG4gIGNvbnN0IHByb2plY3Rpb25LZXkgPSBKU09OLnN0cmluZ2lmeSh7YWJpbGl0aWVzLCBwcmVsb2FkLCBxdWVyeTogZXZlbnRRdWVyeURlcGVuZGVuY3lQYXlsb2FkKHF1ZXJ5KSwgcXVlcnlEYXRhLCBzZWxlY3QsIHNlbGVjdHNFeHRyYSwgd2l0aENvdW50fSlcbiAgY29uc3QgcHJvamVjdGlvbk9wdGlvbnNSZWYgPSB1c2VSZWYoe2FiaWxpdGllcywgcHJlbG9hZCwgcXVlcnksIHF1ZXJ5RGF0YSwgc2VsZWN0LCBzZWxlY3RzRXh0cmEsIHdpdGhDb3VudH0pXG4gIGNvbnN0IGNhbGxiYWNrUmVmID0gdXNlUmVmKGNhbGxiYWNrKVxuICBjb25zdCBhY3RpdmVSZWYgPSB1c2VSZWYoYWN0aXZlKVxuICBwcm9qZWN0aW9uT3B0aW9uc1JlZi5jdXJyZW50ID0ge2FiaWxpdGllcywgcHJlbG9hZCwgcXVlcnksIHF1ZXJ5RGF0YSwgc2VsZWN0LCBzZWxlY3RzRXh0cmEsIHdpdGhDb3VudH1cbiAgY2FsbGJhY2tSZWYuY3VycmVudCA9IGNhbGxiYWNrXG4gIGFjdGl2ZVJlZi5jdXJyZW50ID0gYWN0aXZlXG5cbiAgY29uc3QgbW9kZWxzS2V5ID0gbW9kZWxzRGVwZW5kZW5jeUtleShtb2RlbE9yTW9kZWxzKVxuICBjb25zdCBldmVudENhbGxiYWNrID0gdXNlTWVtbygoKSA9PiB7XG4gICAgY29uc3Qgd3JhcHBlZENhbGxiYWNrID0gKC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbEluc3RhbmNlVXBkYXRlRXZlbnRQYXlsb2FkfSAqLyBwYXlsb2FkKSA9PiB7XG4gICAgICBpZiAoYWN0aXZlUmVmLmN1cnJlbnQpIGNhbGxiYWNrUmVmLmN1cnJlbnQocGF5bG9hZClcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGRlYm91bmNlID09PSBcIm51bWJlclwiKSByZXR1cm4gZGVib3VuY2VGdW5jdGlvbih3cmFwcGVkQ2FsbGJhY2ssIGRlYm91bmNlKVxuICAgIGlmIChkZWJvdW5jZSkgcmV0dXJuIGRlYm91bmNlRnVuY3Rpb24od3JhcHBlZENhbGxiYWNrKVxuXG4gICAgcmV0dXJuIHdyYXBwZWRDYWxsYmFja1xuICB9LCBbZGVib3VuY2VdKVxuXG4gIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgaWYgKCFhY3RpdmUpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IG1vZGVscyA9IG1vZGVsc0Zyb21JbnB1dChtb2RlbE9yTW9kZWxzKVxuICAgIGlmIChtb2RlbHMubGVuZ3RoIDwgMSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgbGV0IGNsb3NlZCA9IGZhbHNlXG4gICAgLyoqXG4gICAgICogVW5zdWJzY3JpYmUgY2FsbGJhY2tzLlxuICAgICAqIEB0eXBlIHtBcnJheTwoKSA9PiB2b2lkPn0gKi9cbiAgICBjb25zdCB1bnN1YnNjcmliZUNhbGxiYWNrcyA9IFtdXG4gICAgY29uc3Qgc3Vic2NyaXB0aW9uQ2FsbGJhY2sgPSAoLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsSW5zdGFuY2VVcGRhdGVFdmVudFBheWxvYWR9ICovIHBheWxvYWQpID0+IHtcbiAgICAgIGlmICghY2xvc2VkKSBldmVudENhbGxiYWNrKHBheWxvYWQpXG4gICAgfVxuXG4gICAgdm9pZCAoYXN5bmMgKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCBtb2RlbCBvZiBtb2RlbHMpIHtcbiAgICAgICAgY29uc3QgdW5zdWJzY3JpYmUgPSBhd2FpdCBtb2RlbC5vblVwZGF0ZShzdWJzY3JpcHRpb25DYWxsYmFjaywgcHJvamVjdGlvbk9wdGlvbnNSZWYuY3VycmVudClcblxuICAgICAgICBpZiAoY2xvc2VkKSB7XG4gICAgICAgICAgdW5zdWJzY3JpYmUoKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHVuc3Vic2NyaWJlQ2FsbGJhY2tzLnB1c2godW5zdWJzY3JpYmUpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKCFjbG9zZWQgJiYgb25Db25uZWN0ZWQpIG9uQ29ubmVjdGVkKClcbiAgICB9KSgpXG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgY2xvc2VkID0gdHJ1ZVxuXG4gICAgICBmb3IgKGNvbnN0IHVuc3Vic2NyaWJlIG9mIHVuc3Vic2NyaWJlQ2FsbGJhY2tzKSB7XG4gICAgICAgIHVuc3Vic2NyaWJlKClcbiAgICAgIH1cblxuICAgICAgY2xlYXJQZW5kaW5nRGVib3VuY2VkQ2FsbGJhY2soZXZlbnRDYWxsYmFjaylcbiAgICB9XG4gIH0sIFthY3RpdmUsIGV2ZW50Q2FsbGJhY2ssIG1vZGVsc0tleSwgb25Db25uZWN0ZWQsIHByb2plY3Rpb25LZXldKVxufVxuIl19