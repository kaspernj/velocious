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
 * FrontendModelClassDestroyEventPayload type.
 * @typedef {import("./use-model-class-event.js").FrontendModelDestroyEventPayload} FrontendModelClassDestroyEventPayload */
/**
 * Defines this typedef.
 * @typedef {{id: string}} FrontendModelInstanceDestroyEventPayload */
/**
 * FrontendModelDestroyEventPayload type.
 * @typedef {FrontendModelClassDestroyEventPayload | FrontendModelInstanceDestroyEventPayload} FrontendModelDestroyEventPayload */
/**
 * UseDestroyedEventOptions type.
 * @typedef {import("./use-model-class-event.js").UseModelClassEventOptions} UseDestroyedEventOptions */
/**
 * FrontendModelDestroyEventCallback type.
 * @typedef {(payload: FrontendModelDestroyEventPayload) => void} FrontendModelDestroyEventCallback */
/**
 * Runs assert no unknown options.
 * @param {Record<string, import("./query.js").FrontendModelTransportValue | (() => void) | undefined>} restOptions - Unknown options object.
 * @returns {void}
 */
function assertNoUnknownOptions(restOptions) {
    const unknownOptionNames = Object.keys(restOptions);
    if (unknownOptionNames.length === 0)
        return;
    throw new Error(`Unknown options given to useDestroyedEvent: ${unknownOptionNames.join(", ")}`);
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
 * React hook for frontend-model destroy events. Pass a model class for class-level
 * destroy events, or a model / model array for instance-level destroy events.
 * @param {FrontendModelClass | FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelClassOrModels - Model class, model, or models.
 * @param {FrontendModelDestroyEventCallback} callback - Event callback.
 * @param {UseDestroyedEventOptions} [options] - Hook options.
 * @returns {void}
 */
export default function useDestroyedEvent(modelClassOrModels, callback, options = {}) {
    const { active = true, abilities, debounce = false, onConnected, preload, query, queryData, select, selectsExtra, withCount, ...restOptions } = options;
    assertNoUnknownOptions(restOptions);
    const classModel = typeof modelClassOrModels === "function" ? modelClassOrModels : null;
    const instanceModels = typeof modelClassOrModels === "function" ? null : modelClassOrModels;
    const projectionOptions = { abilities, preload, query, queryData, select, selectsExtra, withCount };
    useModelClassEvent(classModel, "destroy", callback, { active: active && Boolean(classModel), debounce, onConnected, ...projectionOptions });
    useInstanceDestroyedEvent(instanceModels, callback, { active: active && !classModel, debounce, onConnected, ...projectionOptions });
}
/**
 * Runs use instance destroyed event.
 * @param {FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelOrModels - Model or models.
 * @param {FrontendModelDestroyEventCallback} callback - Event callback.
 * @param {UseDestroyedEventOptions} options - Hook options.
 * @returns {void}
 */
function useInstanceDestroyedEvent(modelOrModels, callback, options) {
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
        const wrappedCallback = (/** @type {FrontendModelInstanceDestroyEventPayload} */ payload) => {
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
        const subscriptionCallback = (/** @type {FrontendModelInstanceDestroyEventPayload} */ payload) => {
            if (!closed)
                eventCallback(payload);
        };
        void (async () => {
            for (const model of models) {
                const unsubscribe = await model.onDestroy(subscriptionCallback, projectionOptionsRef.current);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXNlLWRlc3Ryb3llZC1ldmVudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbHMvdXNlLWRlc3Ryb3llZC1ldmVudC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxnQkFBZ0IsTUFBTSxVQUFVLENBQUE7QUFDdkMsT0FBTyxFQUFDLFNBQVMsRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFDLE1BQU0sT0FBTyxDQUFBO0FBRWhELE9BQU8sNkJBQTZCLE1BQU0sdUNBQXVDLENBQUE7QUFDakYsT0FBTyxFQUFDLG1CQUFtQixFQUFFLGVBQWUsRUFBQyxNQUFNLHdCQUF3QixDQUFBO0FBQzNFLE9BQU8sa0JBQWtCLE1BQU0sNEJBQTRCLENBQUE7QUFFM0Q7OzBFQUUwRTtBQUMxRTs7a0VBRWtFO0FBQ2xFOzs0SEFFNEg7QUFDNUg7O3NFQUVzRTtBQUN0RTs7a0lBRWtJO0FBQ2xJOzt3R0FFd0c7QUFDeEc7O3NHQUVzRztBQUV0Rzs7OztHQUlHO0FBQ0gsU0FBUyxzQkFBc0IsQ0FBQyxXQUFXO0lBQ3pDLE1BQU0sa0JBQWtCLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQTtJQUVuRCxJQUFJLGtCQUFrQixDQUFDLE1BQU0sS0FBSyxDQUFDO1FBQUUsT0FBTTtJQUUzQyxNQUFNLElBQUksS0FBSyxDQUFDLCtDQUErQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFBO0FBQ2pHLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUywyQkFBMkIsQ0FBQyxLQUFLO0lBQ3hDLElBQUksQ0FBQyxLQUFLO1FBQUUsT0FBTyxJQUFJLENBQUE7SUFFdkIsT0FBTyxLQUFLLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtBQUNwQyxDQUFDO0FBRUQ7Ozs7Ozs7R0FPRztBQUNILE1BQU0sQ0FBQyxPQUFPLFVBQVUsaUJBQWlCLENBQUMsa0JB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LENBQUE7UUFFSixPQUFPLEdBQUcsRUFBRTtZQUNWLE1BQU0sR0FBRyxJQUFJLENBQUE7WUFFYixLQUFLLE1BQU0sV0FBVyxJQUFJLG9CQUFvQixFQUFFLENBQUM7Z0JBQy9DLFdBQVcsRUFBRSxDQUFBO1lBQ2YsQ0FBQztZQUVELDZCQUE2QixDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBQzlDLENBQUMsQ0FBQTtJQUNILENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxhQUFhLEVBQUUsU0FBUyxFQUFFLFdBQVcsRUFBRSxhQUFhLENBQUMsQ0FBQyxDQUFBO0FBQ3BFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IGRlYm91bmNlRnVuY3Rpb24gZnJvbSBcImRlYm91bmNlXCJcbmltcG9ydCB7dXNlRWZmZWN0LCB1c2VNZW1vLCB1c2VSZWZ9IGZyb20gXCJyZWFjdFwiXG5cbmltcG9ydCBjbGVhclBlbmRpbmdEZWJvdW5jZWRDYWxsYmFjayBmcm9tIFwiLi9jbGVhci1wZW5kaW5nLWRlYm91bmNlZC1jYWxsYmFjay5qc1wiXG5pbXBvcnQge21vZGVsc0RlcGVuZGVuY3lLZXksIG1vZGVsc0Zyb21JbnB1dH0gZnJvbSBcIi4vZXZlbnQtaG9vay1tb2RlbHMuanNcIlxuaW1wb3J0IHVzZU1vZGVsQ2xhc3NFdmVudCBmcm9tIFwiLi91c2UtbW9kZWwtY2xhc3MtZXZlbnQuanNcIlxuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDbGFzcyB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3N9IEZyb250ZW5kTW9kZWxDbGFzcyAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsSW5zdGFuY2UgdHlwZS5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuZGVmYXVsdH0gRnJvbnRlbmRNb2RlbEluc3RhbmNlICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDbGFzc0Rlc3Ryb3lFdmVudFBheWxvYWQgdHlwZS5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL3VzZS1tb2RlbC1jbGFzcy1ldmVudC5qc1wiKS5Gcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50UGF5bG9hZH0gRnJvbnRlbmRNb2RlbENsYXNzRGVzdHJveUV2ZW50UGF5bG9hZCAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7aWQ6IHN0cmluZ319IEZyb250ZW5kTW9kZWxJbnN0YW5jZURlc3Ryb3lFdmVudFBheWxvYWQgKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudFBheWxvYWQgdHlwZS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsQ2xhc3NEZXN0cm95RXZlbnRQYXlsb2FkIHwgRnJvbnRlbmRNb2RlbEluc3RhbmNlRGVzdHJveUV2ZW50UGF5bG9hZH0gRnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudFBheWxvYWQgKi9cbi8qKlxuICogVXNlRGVzdHJveWVkRXZlbnRPcHRpb25zIHR5cGUuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi91c2UtbW9kZWwtY2xhc3MtZXZlbnQuanNcIikuVXNlTW9kZWxDbGFzc0V2ZW50T3B0aW9uc30gVXNlRGVzdHJveWVkRXZlbnRPcHRpb25zICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFjayB0eXBlLlxuICogQHR5cGVkZWYgeyhwYXlsb2FkOiBGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50UGF5bG9hZCkgPT4gdm9pZH0gRnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrICovXG5cbi8qKlxuICogUnVucyBhc3NlcnQgbm8gdW5rbm93biBvcHRpb25zLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSB8ICgoKSA9PiB2b2lkKSB8IHVuZGVmaW5lZD59IHJlc3RPcHRpb25zIC0gVW5rbm93biBvcHRpb25zIG9iamVjdC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnROb1Vua25vd25PcHRpb25zKHJlc3RPcHRpb25zKSB7XG4gIGNvbnN0IHVua25vd25PcHRpb25OYW1lcyA9IE9iamVjdC5rZXlzKHJlc3RPcHRpb25zKVxuXG4gIGlmICh1bmtub3duT3B0aW9uTmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gb3B0aW9ucyBnaXZlbiB0byB1c2VEZXN0cm95ZWRFdmVudDogJHt1bmtub3duT3B0aW9uTmFtZXMuam9pbihcIiwgXCIpfWApXG59XG5cbi8qKlxuICogUnVucyBldmVudCBxdWVyeSBkZXBlbmRlbmN5IHBheWxvYWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxGcm9udGVuZE1vZGVsQ2xhc3M+IHwgdW5kZWZpbmVkfSBxdWVyeSAtIEV2ZW50IHF1ZXJ5IG9wdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkIHwgbnVsbH0gU3RhYmxlIGRlcGVuZGVuY3kgcGF5bG9hZC5cbiAqL1xuZnVuY3Rpb24gZXZlbnRRdWVyeURlcGVuZGVuY3lQYXlsb2FkKHF1ZXJ5KSB7XG4gIGlmICghcXVlcnkpIHJldHVybiBudWxsXG5cbiAgcmV0dXJuIHF1ZXJ5LmV2ZW50T3B0aW9uc1BheWxvYWQoKVxufVxuXG4vKipcbiAqIFJlYWN0IGhvb2sgZm9yIGZyb250ZW5kLW1vZGVsIGRlc3Ryb3kgZXZlbnRzLiBQYXNzIGEgbW9kZWwgY2xhc3MgZm9yIGNsYXNzLWxldmVsXG4gKiBkZXN0cm95IGV2ZW50cywgb3IgYSBtb2RlbCAvIG1vZGVsIGFycmF5IGZvciBpbnN0YW5jZS1sZXZlbCBkZXN0cm95IGV2ZW50cy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzIHwgRnJvbnRlbmRNb2RlbEluc3RhbmNlIHwgRnJvbnRlbmRNb2RlbEluc3RhbmNlW10gfCBudWxsIHwgdW5kZWZpbmVkfSBtb2RlbENsYXNzT3JNb2RlbHMgLSBNb2RlbCBjbGFzcywgbW9kZWwsIG9yIG1vZGVscy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICogQHBhcmFtIHtVc2VEZXN0cm95ZWRFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEhvb2sgb3B0aW9ucy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiB1c2VEZXN0cm95ZWRFdmVudChtb2RlbENsYXNzT3JNb2RlbHMsIGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgY29uc3Qge2FjdGl2ZSA9IHRydWUsIGFiaWxpdGllcywgZGVib3VuY2UgPSBmYWxzZSwgb25Db25uZWN0ZWQsIHByZWxvYWQsIHF1ZXJ5LCBxdWVyeURhdGEsIHNlbGVjdCwgc2VsZWN0c0V4dHJhLCB3aXRoQ291bnQsIC4uLnJlc3RPcHRpb25zfSA9IG9wdGlvbnNcbiAgYXNzZXJ0Tm9Vbmtub3duT3B0aW9ucyhyZXN0T3B0aW9ucylcblxuICBjb25zdCBjbGFzc01vZGVsID0gdHlwZW9mIG1vZGVsQ2xhc3NPck1vZGVscyA9PT0gXCJmdW5jdGlvblwiID8gbW9kZWxDbGFzc09yTW9kZWxzIDogbnVsbFxuICBjb25zdCBpbnN0YW5jZU1vZGVscyA9IHR5cGVvZiBtb2RlbENsYXNzT3JNb2RlbHMgPT09IFwiZnVuY3Rpb25cIiA/IG51bGwgOiBtb2RlbENsYXNzT3JNb2RlbHNcbiAgY29uc3QgcHJvamVjdGlvbk9wdGlvbnMgPSB7YWJpbGl0aWVzLCBwcmVsb2FkLCBxdWVyeSwgcXVlcnlEYXRhLCBzZWxlY3QsIHNlbGVjdHNFeHRyYSwgd2l0aENvdW50fVxuXG4gIHVzZU1vZGVsQ2xhc3NFdmVudChjbGFzc01vZGVsLCBcImRlc3Ryb3lcIiwgY2FsbGJhY2ssIHthY3RpdmU6IGFjdGl2ZSAmJiBCb29sZWFuKGNsYXNzTW9kZWwpLCBkZWJvdW5jZSwgb25Db25uZWN0ZWQsIC4uLnByb2plY3Rpb25PcHRpb25zfSlcbiAgdXNlSW5zdGFuY2VEZXN0cm95ZWRFdmVudChpbnN0YW5jZU1vZGVscywgY2FsbGJhY2ssIHthY3RpdmU6IGFjdGl2ZSAmJiAhY2xhc3NNb2RlbCwgZGVib3VuY2UsIG9uQ29ubmVjdGVkLCAuLi5wcm9qZWN0aW9uT3B0aW9uc30pXG59XG5cbi8qKlxuICogUnVucyB1c2UgaW5zdGFuY2UgZGVzdHJveWVkIGV2ZW50LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsSW5zdGFuY2UgfCBGcm9udGVuZE1vZGVsSW5zdGFuY2VbXSB8IG51bGwgfCB1bmRlZmluZWR9IG1vZGVsT3JNb2RlbHMgLSBNb2RlbCBvciBtb2RlbHMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja30gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAqIEBwYXJhbSB7VXNlRGVzdHJveWVkRXZlbnRPcHRpb25zfSBvcHRpb25zIC0gSG9vayBvcHRpb25zLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHVzZUluc3RhbmNlRGVzdHJveWVkRXZlbnQobW9kZWxPck1vZGVscywgY2FsbGJhY2ssIG9wdGlvbnMpIHtcbiAgY29uc3Qge2FjdGl2ZSA9IHRydWUsIGFiaWxpdGllcywgZGVib3VuY2UgPSBmYWxzZSwgb25Db25uZWN0ZWQsIHByZWxvYWQsIHF1ZXJ5LCBxdWVyeURhdGEsIHNlbGVjdCwgc2VsZWN0c0V4dHJhLCB3aXRoQ291bnR9ID0gb3B0aW9uc1xuICBjb25zdCBwcm9qZWN0aW9uS2V5ID0gSlNPTi5zdHJpbmdpZnkoe2FiaWxpdGllcywgcHJlbG9hZCwgcXVlcnk6IGV2ZW50UXVlcnlEZXBlbmRlbmN5UGF5bG9hZChxdWVyeSksIHF1ZXJ5RGF0YSwgc2VsZWN0LCBzZWxlY3RzRXh0cmEsIHdpdGhDb3VudH0pXG4gIGNvbnN0IHByb2plY3Rpb25PcHRpb25zUmVmID0gdXNlUmVmKHthYmlsaXRpZXMsIHByZWxvYWQsIHF1ZXJ5LCBxdWVyeURhdGEsIHNlbGVjdCwgc2VsZWN0c0V4dHJhLCB3aXRoQ291bnR9KVxuICBjb25zdCBjYWxsYmFja1JlZiA9IHVzZVJlZihjYWxsYmFjaylcbiAgY29uc3QgYWN0aXZlUmVmID0gdXNlUmVmKGFjdGl2ZSlcbiAgcHJvamVjdGlvbk9wdGlvbnNSZWYuY3VycmVudCA9IHthYmlsaXRpZXMsIHByZWxvYWQsIHF1ZXJ5LCBxdWVyeURhdGEsIHNlbGVjdCwgc2VsZWN0c0V4dHJhLCB3aXRoQ291bnR9XG4gIGNhbGxiYWNrUmVmLmN1cnJlbnQgPSBjYWxsYmFja1xuICBhY3RpdmVSZWYuY3VycmVudCA9IGFjdGl2ZVxuXG4gIGNvbnN0IG1vZGVsc0tleSA9IG1vZGVsc0RlcGVuZGVuY3lLZXkobW9kZWxPck1vZGVscylcbiAgY29uc3QgZXZlbnRDYWxsYmFjayA9IHVzZU1lbW8oKCkgPT4ge1xuICAgIGNvbnN0IHdyYXBwZWRDYWxsYmFjayA9ICgvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxJbnN0YW5jZURlc3Ryb3lFdmVudFBheWxvYWR9ICovIHBheWxvYWQpID0+IHtcbiAgICAgIGlmIChhY3RpdmVSZWYuY3VycmVudCkgY2FsbGJhY2tSZWYuY3VycmVudChwYXlsb2FkKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZGVib3VuY2UgPT09IFwibnVtYmVyXCIpIHJldHVybiBkZWJvdW5jZUZ1bmN0aW9uKHdyYXBwZWRDYWxsYmFjaywgZGVib3VuY2UpXG4gICAgaWYgKGRlYm91bmNlKSByZXR1cm4gZGVib3VuY2VGdW5jdGlvbih3cmFwcGVkQ2FsbGJhY2spXG5cbiAgICByZXR1cm4gd3JhcHBlZENhbGxiYWNrXG4gIH0sIFtkZWJvdW5jZV0pXG5cbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBpZiAoIWFjdGl2ZSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgbW9kZWxzID0gbW9kZWxzRnJvbUlucHV0KG1vZGVsT3JNb2RlbHMpXG4gICAgaWYgKG1vZGVscy5sZW5ndGggPCAxKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBsZXQgY2xvc2VkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBVbnN1YnNjcmliZSBjYWxsYmFja3MuXG4gICAgICogQHR5cGUge0FycmF5PCgpID0+IHZvaWQ+fSAqL1xuICAgIGNvbnN0IHVuc3Vic2NyaWJlQ2FsbGJhY2tzID0gW11cbiAgICBjb25zdCBzdWJzY3JpcHRpb25DYWxsYmFjayA9ICgvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxJbnN0YW5jZURlc3Ryb3lFdmVudFBheWxvYWR9ICovIHBheWxvYWQpID0+IHtcbiAgICAgIGlmICghY2xvc2VkKSBldmVudENhbGxiYWNrKHBheWxvYWQpXG4gICAgfVxuXG4gICAgdm9pZCAoYXN5bmMgKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCBtb2RlbCBvZiBtb2RlbHMpIHtcbiAgICAgICAgY29uc3QgdW5zdWJzY3JpYmUgPSBhd2FpdCBtb2RlbC5vbkRlc3Ryb3koc3Vic2NyaXB0aW9uQ2FsbGJhY2ssIHByb2plY3Rpb25PcHRpb25zUmVmLmN1cnJlbnQpXG5cbiAgICAgICAgaWYgKGNsb3NlZCkge1xuICAgICAgICAgIHVuc3Vic2NyaWJlKClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB1bnN1YnNjcmliZUNhbGxiYWNrcy5wdXNoKHVuc3Vic2NyaWJlKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICghY2xvc2VkICYmIG9uQ29ubmVjdGVkKSBvbkNvbm5lY3RlZCgpXG4gICAgfSkoKVxuXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIGNsb3NlZCA9IHRydWVcblxuICAgICAgZm9yIChjb25zdCB1bnN1YnNjcmliZSBvZiB1bnN1YnNjcmliZUNhbGxiYWNrcykge1xuICAgICAgICB1bnN1YnNjcmliZSgpXG4gICAgICB9XG5cbiAgICAgIGNsZWFyUGVuZGluZ0RlYm91bmNlZENhbGxiYWNrKGV2ZW50Q2FsbGJhY2spXG4gICAgfVxuICB9LCBbYWN0aXZlLCBldmVudENhbGxiYWNrLCBtb2RlbHNLZXksIG9uQ29ubmVjdGVkLCBwcm9qZWN0aW9uS2V5XSlcbn1cbiJdfQ==