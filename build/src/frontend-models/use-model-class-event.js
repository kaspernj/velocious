// @ts-check
import debounceFunction from "debounce";
import { useEffect, useMemo, useRef } from "react";
import clearPendingDebouncedCallback from "./clear-pending-debounced-callback.js";
import { frontendModelRemoteRequestContextKey } from "./remote-request-context.js";
/**
 * FrontendModelClass type.
 * @typedef {import("./base.js").FrontendModelClass} FrontendModelClass */
/**
 * FrontendModelInstance type.
 * @typedef {InstanceType<FrontendModelClass>} FrontendModelInstance */
/**
 * FrontendModelClassEventName type.
 * @typedef {"create" | "update" | "destroy"} FrontendModelClassEventName */
/**
 * Defines this typedef.
 * @typedef {{id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue, model: FrontendModelInstance}} FrontendModelCreateUpdateEventPayload */
/**
 * Defines this typedef.
 * @typedef {{id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue}} FrontendModelDestroyEventPayload */
/**
 * FrontendModelClassEventPayload type.
 * @typedef {FrontendModelCreateUpdateEventPayload | FrontendModelDestroyEventPayload} FrontendModelClassEventPayload */
/**
 * FrontendModelClassEventCallback type.
 * @typedef {(payload: FrontendModelClassEventPayload) => void} FrontendModelClassEventCallback */
/**
 * Defines this typedef.
 * @typedef {{active?: boolean, debounce?: boolean | number, onConnected?: () => void} & import("./query.js").FrontendModelEventOptionsObject} UseModelClassEventOptions */
/**
 * Runs assert no unknown options.
 * @param {Record<string, import("./query.js").FrontendModelTransportValue | (() => void) | undefined>} restOptions - Unknown options object.
 * @returns {void}
 */
function assertNoUnknownOptions(restOptions) {
    const unknownOptionNames = Object.keys(restOptions);
    if (unknownOptionNames.length > 0) {
        throw new Error(`Unknown options given to useModelClassEvent: ${unknownOptionNames.join(", ")}`);
    }
}
/**
 * Runs event query dependency payload.
 * @param {import("./query.js").default<FrontendModelClass> | undefined} query - Event query option.
 * @returns {import("./query.js").FrontendModelEventQueryPayload | null} Stable dependency payload.
 */
function eventQueryDependencyPayload(query) {
    if (!query)
        return null;
    return query.eventOptionsPayload();
}
/**
 * Runs normalize event names.
 * @param {FrontendModelClassEventName | FrontendModelClassEventName[]} eventOrEvents - Event name or names.
 * @returns {FrontendModelClassEventName[]} - Normalized event names.
 */
function normalizeEventNames(eventOrEvents) {
    return Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents];
}
/**
 * Runs event names dependency key.
 * @param {FrontendModelClassEventName[]} eventNames - Event names.
 * @returns {string} - Stable dependency key.
 */
function eventNamesDependencyKey(eventNames) {
    return eventNames.join("|");
}
/**
 * Runs subscribe to model class event.
 * @param {FrontendModelClass} modelClass - Frontend model class.
 * @param {FrontendModelClassEventName} eventName - Event name.
 * @param {FrontendModelClassEventCallback} callback - Event callback.
 * @param {import("./query.js").FrontendModelEventOptionsObject} options - Event query or record projection options.
 * @returns {Promise<() => void>} - Unsubscribe callback.
 */
async function subscribeToModelClassEvent(modelClass, eventName, callback, options) {
    if (eventName === "create")
        return await modelClass.onCreate(callback, options);
    if (eventName === "update")
        return await modelClass.onUpdate(callback, options);
    if (eventName === "destroy")
        return await modelClass.onDestroy(callback, options);
    throw new Error(`Unsupported frontend model class event: ${eventName}`);
}
/**
 * React hook for frontend-model class lifecycle events.
 * @param {FrontendModelClass | null | undefined} modelClass - Frontend model class.
 * @param {FrontendModelClassEventName | FrontendModelClassEventName[]} eventOrEvents - Event name or names.
 * @param {FrontendModelClassEventCallback} callback - Event callback.
 * @param {UseModelClassEventOptions} [options] - Hook options.
 * @returns {void}
 */
export default function useModelClassEvent(modelClass, eventOrEvents, callback, options = {}) {
    const { active = true, abilities, debounce = false, onConnected, preload, query, queryData, requestContext, select, selectsExtra, withCount, ...restOptions } = options;
    assertNoUnknownOptions(restOptions);
    const projectionKey = JSON.stringify({ abilities, preload, query: eventQueryDependencyPayload(query), queryData, requestContext: frontendModelRemoteRequestContextKey(requestContext), select, selectsExtra, withCount });
    const projectionOptionsRef = useRef({ abilities, preload, query, queryData, requestContext, select, selectsExtra, withCount });
    const callbackRef = useRef(callback);
    const activeRef = useRef(active);
    projectionOptionsRef.current = { abilities, preload, query, queryData, requestContext, select, selectsExtra, withCount };
    callbackRef.current = callback;
    activeRef.current = active;
    const eventNames = normalizeEventNames(eventOrEvents);
    const eventsKey = eventNamesDependencyKey(eventNames);
    const eventCallback = useMemo(() => {
        const wrappedCallback = (/** @type {FrontendModelClassEventPayload} */ payload) => {
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
        if (!active || !modelClass)
            return undefined;
        let closed = false;
        /**
         * Unsubscribe callbacks.
         * @type {Array<() => void>} */
        const unsubscribeCallbacks = [];
        const subscriptionCallback = (/** @type {FrontendModelClassEventPayload} */ payload) => {
            if (!closed)
                eventCallback(payload);
        };
        void (async () => {
            for (const eventName of eventNames) {
                const unsubscribe = await subscribeToModelClassEvent(modelClass, eventName, subscriptionCallback, projectionOptionsRef.current);
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
    }, [active, eventsKey, eventCallback, modelClass, onConnected, projectionKey]);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXNlLW1vZGVsLWNsYXNzLWV2ZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2Zyb250ZW5kLW1vZGVscy91c2UtbW9kZWwtY2xhc3MtZXZlbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sZ0JBQWdCLE1BQU0sVUFBVSxDQUFBO0FBQ3ZDLE9BQU8sRUFBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBQyxNQUFNLE9BQU8sQ0FBQTtBQUVoRCxPQUFPLDZCQUE2QixNQUFNLHVDQUF1QyxDQUFBO0FBQ2pGLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDZCQUE2QixDQUFBO0FBRWhGOzswRUFFMEU7QUFDMUU7O3VFQUV1RTtBQUN2RTs7NEVBRTRFO0FBQzVFOzt5S0FFeUs7QUFDeks7O3NJQUVzSTtBQUN0STs7d0hBRXdIO0FBQ3hIOztrR0FFa0c7QUFDbEc7OzJLQUUySztBQUUzSzs7OztHQUlHO0FBQ0gsU0FBUyxzQkFBc0IsQ0FBQyxXQUFXO0lBQ3pDLE1BQU0sa0JBQWtCLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQTtJQUVuRCxJQUFJLGtCQUFrQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNsQyxNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQ2xHLENBQUM7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsMkJBQTJCLENBQUMsS0FBSztJQUN4QyxJQUFJLENBQUMsS0FBSztRQUFFLE9BQU8sSUFBSSxDQUFBO0lBRXZCLE9BQU8sS0FBSyxDQUFDLG1CQUFtQixFQUFFLENBQUE7QUFDcEMsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLG1CQUFtQixDQUFDLGFBQWE7SUFDeEMsT0FBTyxLQUFLLENBQUMsT0FBTyxDQUFDLGFB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QVcsRUFBRSxDQUFBO1lBQ2YsQ0FBQztZQUVELDZCQUE2QixDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBQzlDLENBQUMsQ0FBQTtJQUNILENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsYUFBYSxFQUFFLFVBQVUsRUFBRSxXQUFXLEVBQUUsYUFBYSxDQUFDLENBQUMsQ0FBQTtBQUNoRixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBkZWJvdW5jZUZ1bmN0aW9uIGZyb20gXCJkZWJvdW5jZVwiXG5pbXBvcnQge3VzZUVmZmVjdCwgdXNlTWVtbywgdXNlUmVmfSBmcm9tIFwicmVhY3RcIlxuXG5pbXBvcnQgY2xlYXJQZW5kaW5nRGVib3VuY2VkQ2FsbGJhY2sgZnJvbSBcIi4vY2xlYXItcGVuZGluZy1kZWJvdW5jZWQtY2FsbGJhY2suanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHRLZXl9IGZyb20gXCIuL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDbGFzcyB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3N9IEZyb250ZW5kTW9kZWxDbGFzcyAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsSW5zdGFuY2UgdHlwZS5cbiAqIEB0eXBlZGVmIHtJbnN0YW5jZVR5cGU8RnJvbnRlbmRNb2RlbENsYXNzPn0gRnJvbnRlbmRNb2RlbEluc3RhbmNlICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDbGFzc0V2ZW50TmFtZSB0eXBlLlxuICogQHR5cGVkZWYge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IEZyb250ZW5kTW9kZWxDbGFzc0V2ZW50TmFtZSAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7aWQ6IHN0cmluZyB8IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLkNvbXBvc2l0ZU1vZGVsUHJpbWFyeUtleVZhbHVlLCBtb2RlbDogRnJvbnRlbmRNb2RlbEluc3RhbmNlfX0gRnJvbnRlbmRNb2RlbENyZWF0ZVVwZGF0ZUV2ZW50UGF5bG9hZCAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7aWQ6IHN0cmluZyB8IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLkNvbXBvc2l0ZU1vZGVsUHJpbWFyeUtleVZhbHVlfX0gRnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudFBheWxvYWQgKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbENsYXNzRXZlbnRQYXlsb2FkIHR5cGUuXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbENyZWF0ZVVwZGF0ZUV2ZW50UGF5bG9hZCB8IEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRQYXlsb2FkfSBGcm9udGVuZE1vZGVsQ2xhc3NFdmVudFBheWxvYWQgKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbENsYXNzRXZlbnRDYWxsYmFjayB0eXBlLlxuICogQHR5cGVkZWYgeyhwYXlsb2FkOiBGcm9udGVuZE1vZGVsQ2xhc3NFdmVudFBheWxvYWQpID0+IHZvaWR9IEZyb250ZW5kTW9kZWxDbGFzc0V2ZW50Q2FsbGJhY2sgKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2FjdGl2ZT86IGJvb2xlYW4sIGRlYm91bmNlPzogYm9vbGVhbiB8IG51bWJlciwgb25Db25uZWN0ZWQ/OiAoKSA9PiB2b2lkfSAmIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdH0gVXNlTW9kZWxDbGFzc0V2ZW50T3B0aW9ucyAqL1xuXG4vKipcbiAqIFJ1bnMgYXNzZXJ0IG5vIHVua25vd24gb3B0aW9ucy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUgfCAoKCkgPT4gdm9pZCkgfCB1bmRlZmluZWQ+fSByZXN0T3B0aW9ucyAtIFVua25vd24gb3B0aW9ucyBvYmplY3QuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0Tm9Vbmtub3duT3B0aW9ucyhyZXN0T3B0aW9ucykge1xuICBjb25zdCB1bmtub3duT3B0aW9uTmFtZXMgPSBPYmplY3Qua2V5cyhyZXN0T3B0aW9ucylcblxuICBpZiAodW5rbm93bk9wdGlvbk5hbWVzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gb3B0aW9ucyBnaXZlbiB0byB1c2VNb2RlbENsYXNzRXZlbnQ6ICR7dW5rbm93bk9wdGlvbk5hbWVzLmpvaW4oXCIsIFwiKX1gKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBldmVudCBxdWVyeSBkZXBlbmRlbmN5IHBheWxvYWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxGcm9udGVuZE1vZGVsQ2xhc3M+IHwgdW5kZWZpbmVkfSBxdWVyeSAtIEV2ZW50IHF1ZXJ5IG9wdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudFF1ZXJ5UGF5bG9hZCB8IG51bGx9IFN0YWJsZSBkZXBlbmRlbmN5IHBheWxvYWQuXG4gKi9cbmZ1bmN0aW9uIGV2ZW50UXVlcnlEZXBlbmRlbmN5UGF5bG9hZChxdWVyeSkge1xuICBpZiAoIXF1ZXJ5KSByZXR1cm4gbnVsbFxuXG4gIHJldHVybiBxdWVyeS5ldmVudE9wdGlvbnNQYXlsb2FkKClcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBldmVudCBuYW1lcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzRXZlbnROYW1lIHwgRnJvbnRlbmRNb2RlbENsYXNzRXZlbnROYW1lW119IGV2ZW50T3JFdmVudHMgLSBFdmVudCBuYW1lIG9yIG5hbWVzLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxDbGFzc0V2ZW50TmFtZVtdfSAtIE5vcm1hbGl6ZWQgZXZlbnQgbmFtZXMuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV2ZW50TmFtZXMoZXZlbnRPckV2ZW50cykge1xuICByZXR1cm4gQXJyYXkuaXNBcnJheShldmVudE9yRXZlbnRzKSA/IGV2ZW50T3JFdmVudHMgOiBbZXZlbnRPckV2ZW50c11cbn1cblxuLyoqXG4gKiBSdW5zIGV2ZW50IG5hbWVzIGRlcGVuZGVuY3kga2V5LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3NFdmVudE5hbWVbXX0gZXZlbnROYW1lcyAtIEV2ZW50IG5hbWVzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBTdGFibGUgZGVwZW5kZW5jeSBrZXkuXG4gKi9cbmZ1bmN0aW9uIGV2ZW50TmFtZXNEZXBlbmRlbmN5S2V5KGV2ZW50TmFtZXMpIHtcbiAgcmV0dXJuIGV2ZW50TmFtZXMuam9pbihcInxcIilcbn1cblxuLyoqXG4gKiBSdW5zIHN1YnNjcmliZSB0byBtb2RlbCBjbGFzcyBldmVudC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc0V2ZW50TmFtZX0gZXZlbnROYW1lIC0gRXZlbnQgbmFtZS5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzRXZlbnRDYWxsYmFja30gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0fSBvcHRpb25zIC0gRXZlbnQgcXVlcnkgb3IgcmVjb3JkIHByb2plY3Rpb24gb3B0aW9ucy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICovXG5hc3luYyBmdW5jdGlvbiBzdWJzY3JpYmVUb01vZGVsQ2xhc3NFdmVudChtb2RlbENsYXNzLCBldmVudE5hbWUsIGNhbGxiYWNrLCBvcHRpb25zKSB7XG4gIGlmIChldmVudE5hbWUgPT09IFwiY3JlYXRlXCIpIHJldHVybiBhd2FpdCBtb2RlbENsYXNzLm9uQ3JlYXRlKGNhbGxiYWNrLCBvcHRpb25zKVxuICBpZiAoZXZlbnROYW1lID09PSBcInVwZGF0ZVwiKSByZXR1cm4gYXdhaXQgbW9kZWxDbGFzcy5vblVwZGF0ZShjYWxsYmFjaywgb3B0aW9ucylcbiAgaWYgKGV2ZW50TmFtZSA9PT0gXCJkZXN0cm95XCIpIHJldHVybiBhd2FpdCBtb2RlbENsYXNzLm9uRGVzdHJveShjYWxsYmFjaywgb3B0aW9ucylcblxuICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGZyb250ZW5kIG1vZGVsIGNsYXNzIGV2ZW50OiAke2V2ZW50TmFtZX1gKVxufVxuXG4vKipcbiAqIFJlYWN0IGhvb2sgZm9yIGZyb250ZW5kLW1vZGVsIGNsYXNzIGxpZmVjeWNsZSBldmVudHMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzcyB8IG51bGwgfCB1bmRlZmluZWR9IG1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzRXZlbnROYW1lIHwgRnJvbnRlbmRNb2RlbENsYXNzRXZlbnROYW1lW119IGV2ZW50T3JFdmVudHMgLSBFdmVudCBuYW1lIG9yIG5hbWVzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3NFdmVudENhbGxiYWNrfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICogQHBhcmFtIHtVc2VNb2RlbENsYXNzRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBIb29rIG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gdXNlTW9kZWxDbGFzc0V2ZW50KG1vZGVsQ2xhc3MsIGV2ZW50T3JFdmVudHMsIGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgY29uc3Qge2FjdGl2ZSA9IHRydWUsIGFiaWxpdGllcywgZGVib3VuY2UgPSBmYWxzZSwgb25Db25uZWN0ZWQsIHByZWxvYWQsIHF1ZXJ5LCBxdWVyeURhdGEsIHJlcXVlc3RDb250ZXh0LCBzZWxlY3QsIHNlbGVjdHNFeHRyYSwgd2l0aENvdW50LCAuLi5yZXN0T3B0aW9uc30gPSBvcHRpb25zXG4gIGFzc2VydE5vVW5rbm93bk9wdGlvbnMocmVzdE9wdGlvbnMpXG5cbiAgY29uc3QgcHJvamVjdGlvbktleSA9IEpTT04uc3RyaW5naWZ5KHthYmlsaXRpZXMsIHByZWxvYWQsIHF1ZXJ5OiBldmVudFF1ZXJ5RGVwZW5kZW5jeVBheWxvYWQocXVlcnkpLCBxdWVyeURhdGEsIHJlcXVlc3RDb250ZXh0OiBmcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHRLZXkocmVxdWVzdENvbnRleHQpLCBzZWxlY3QsIHNlbGVjdHNFeHRyYSwgd2l0aENvdW50fSlcbiAgY29uc3QgcHJvamVjdGlvbk9wdGlvbnNSZWYgPSB1c2VSZWYoe2FiaWxpdGllcywgcHJlbG9hZCwgcXVlcnksIHF1ZXJ5RGF0YSwgcmVxdWVzdENvbnRleHQsIHNlbGVjdCwgc2VsZWN0c0V4dHJhLCB3aXRoQ291bnR9KVxuICBjb25zdCBjYWxsYmFja1JlZiA9IHVzZVJlZihjYWxsYmFjaylcbiAgY29uc3QgYWN0aXZlUmVmID0gdXNlUmVmKGFjdGl2ZSlcbiAgcHJvamVjdGlvbk9wdGlvbnNSZWYuY3VycmVudCA9IHthYmlsaXRpZXMsIHByZWxvYWQsIHF1ZXJ5LCBxdWVyeURhdGEsIHJlcXVlc3RDb250ZXh0LCBzZWxlY3QsIHNlbGVjdHNFeHRyYSwgd2l0aENvdW50fVxuICBjYWxsYmFja1JlZi5jdXJyZW50ID0gY2FsbGJhY2tcbiAgYWN0aXZlUmVmLmN1cnJlbnQgPSBhY3RpdmVcblxuICBjb25zdCBldmVudE5hbWVzID0gbm9ybWFsaXplRXZlbnROYW1lcyhldmVudE9yRXZlbnRzKVxuICBjb25zdCBldmVudHNLZXkgPSBldmVudE5hbWVzRGVwZW5kZW5jeUtleShldmVudE5hbWVzKVxuICBjb25zdCBldmVudENhbGxiYWNrID0gdXNlTWVtbygoKSA9PiB7XG4gICAgY29uc3Qgd3JhcHBlZENhbGxiYWNrID0gKC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbENsYXNzRXZlbnRQYXlsb2FkfSAqLyBwYXlsb2FkKSA9PiB7XG4gICAgICBpZiAoYWN0aXZlUmVmLmN1cnJlbnQpIGNhbGxiYWNrUmVmLmN1cnJlbnQocGF5bG9hZClcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGRlYm91bmNlID09PSBcIm51bWJlclwiKSByZXR1cm4gZGVib3VuY2VGdW5jdGlvbih3cmFwcGVkQ2FsbGJhY2ssIGRlYm91bmNlKVxuICAgIGlmIChkZWJvdW5jZSkgcmV0dXJuIGRlYm91bmNlRnVuY3Rpb24od3JhcHBlZENhbGxiYWNrKVxuXG4gICAgcmV0dXJuIHdyYXBwZWRDYWxsYmFja1xuICB9LCBbZGVib3VuY2VdKVxuXG4gIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgaWYgKCFhY3RpdmUgfHwgIW1vZGVsQ2xhc3MpIHJldHVybiB1bmRlZmluZWRcblxuICAgIGxldCBjbG9zZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIFVuc3Vic2NyaWJlIGNhbGxiYWNrcy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8KCkgPT4gdm9pZD59ICovXG4gICAgY29uc3QgdW5zdWJzY3JpYmVDYWxsYmFja3MgPSBbXVxuICAgIGNvbnN0IHN1YnNjcmlwdGlvbkNhbGxiYWNrID0gKC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbENsYXNzRXZlbnRQYXlsb2FkfSAqLyBwYXlsb2FkKSA9PiB7XG4gICAgICBpZiAoIWNsb3NlZCkgZXZlbnRDYWxsYmFjayhwYXlsb2FkKVxuICAgIH1cblxuICAgIHZvaWQgKGFzeW5jICgpID0+IHtcbiAgICAgIGZvciAoY29uc3QgZXZlbnROYW1lIG9mIGV2ZW50TmFtZXMpIHtcbiAgICAgICAgY29uc3QgdW5zdWJzY3JpYmUgPSBhd2FpdCBzdWJzY3JpYmVUb01vZGVsQ2xhc3NFdmVudChtb2RlbENsYXNzLCBldmVudE5hbWUsIHN1YnNjcmlwdGlvbkNhbGxiYWNrLCBwcm9qZWN0aW9uT3B0aW9uc1JlZi5jdXJyZW50KVxuXG4gICAgICAgIGlmIChjbG9zZWQpIHtcbiAgICAgICAgICB1bnN1YnNjcmliZSgpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdW5zdWJzY3JpYmVDYWxsYmFja3MucHVzaCh1bnN1YnNjcmliZSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoIWNsb3NlZCAmJiBvbkNvbm5lY3RlZCkgb25Db25uZWN0ZWQoKVxuICAgIH0pKClcblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBjbG9zZWQgPSB0cnVlXG5cbiAgICAgIGZvciAoY29uc3QgdW5zdWJzY3JpYmUgb2YgdW5zdWJzY3JpYmVDYWxsYmFja3MpIHtcbiAgICAgICAgdW5zdWJzY3JpYmUoKVxuICAgICAgfVxuXG4gICAgICBjbGVhclBlbmRpbmdEZWJvdW5jZWRDYWxsYmFjayhldmVudENhbGxiYWNrKVxuICAgIH1cbiAgfSwgW2FjdGl2ZSwgZXZlbnRzS2V5LCBldmVudENhbGxiYWNrLCBtb2RlbENsYXNzLCBvbkNvbm5lY3RlZCwgcHJvamVjdGlvbktleV0pXG59XG4iXX0=