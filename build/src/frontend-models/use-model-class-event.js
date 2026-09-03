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
 * @typedef {{id: string, model: FrontendModelInstance}} FrontendModelCreateUpdateEventPayload */
/**
 * Defines this typedef.
 * @typedef {{id: string}} FrontendModelDestroyEventPayload */
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXNlLW1vZGVsLWNsYXNzLWV2ZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2Zyb250ZW5kLW1vZGVscy91c2UtbW9kZWwtY2xhc3MtZXZlbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sZ0JBQWdCLE1BQU0sVUFBVSxDQUFBO0FBQ3ZDLE9BQU8sRUFBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBQyxNQUFNLE9BQU8sQ0FBQTtBQUVoRCxPQUFPLDZCQUE2QixNQUFNLHVDQUF1QyxDQUFBO0FBQ2pGLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDZCQUE2QixDQUFBO0FBRWhGOzswRUFFMEU7QUFDMUU7O3VFQUV1RTtBQUN2RTs7NEVBRTRFO0FBQzVFOztpR0FFaUc7QUFDakc7OzhEQUU4RDtBQUM5RDs7d0hBRXdIO0FBQ3hIOztrR0FFa0c7QUFDbEc7OzJLQUUySztBQUUzSzs7OztHQUlHO0FBQ0gsU0FBUyxzQkFBc0IsQ0FBQyxXQUFXO0lBQ3pDLE1BQU0sa0JBQWtCLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQTtJQUVuRCxJQUFJLGtCQUFrQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNsQyxNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQ2xHLENBQUM7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsMkJBQTJCLENBQUMsS0FBSztJQUN4QyxJQUFJLENBQUMsS0FBSztRQUFFLE9BQU8sSUFBSSxDQUFBO0lBRXZCLE9BQU8sS0FBSyxDQUFDLG1CQUFtQixFQUFFLENBQUE7QUFDcEMsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLG1CQUFtQixDQUFDLGFBQWE7SUFDeEMsT0FBTyxLQUFLLENBQUMsT0FBTyxDQUFDLGFB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QVcsRUFBRSxDQUFBO1lBQ2YsQ0FBQztZQUVELDZCQUE2QixDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBQzlDLENBQUMsQ0FBQTtJQUNILENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsYUFBYSxFQUFFLFVBQVUsRUFBRSxXQUFXLEVBQUUsYUFBYSxDQUFDLENBQUMsQ0FBQTtBQUNoRixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBkZWJvdW5jZUZ1bmN0aW9uIGZyb20gXCJkZWJvdW5jZVwiXG5pbXBvcnQge3VzZUVmZmVjdCwgdXNlTWVtbywgdXNlUmVmfSBmcm9tIFwicmVhY3RcIlxuXG5pbXBvcnQgY2xlYXJQZW5kaW5nRGVib3VuY2VkQ2FsbGJhY2sgZnJvbSBcIi4vY2xlYXItcGVuZGluZy1kZWJvdW5jZWQtY2FsbGJhY2suanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHRLZXl9IGZyb20gXCIuL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDbGFzcyB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3N9IEZyb250ZW5kTW9kZWxDbGFzcyAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsSW5zdGFuY2UgdHlwZS5cbiAqIEB0eXBlZGVmIHtJbnN0YW5jZVR5cGU8RnJvbnRlbmRNb2RlbENsYXNzPn0gRnJvbnRlbmRNb2RlbEluc3RhbmNlICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDbGFzc0V2ZW50TmFtZSB0eXBlLlxuICogQHR5cGVkZWYge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IEZyb250ZW5kTW9kZWxDbGFzc0V2ZW50TmFtZSAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7aWQ6IHN0cmluZywgbW9kZWw6IEZyb250ZW5kTW9kZWxJbnN0YW5jZX19IEZyb250ZW5kTW9kZWxDcmVhdGVVcGRhdGVFdmVudFBheWxvYWQgKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2lkOiBzdHJpbmd9fSBGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50UGF5bG9hZCAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsQ2xhc3NFdmVudFBheWxvYWQgdHlwZS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsQ3JlYXRlVXBkYXRlRXZlbnRQYXlsb2FkIHwgRnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudFBheWxvYWR9IEZyb250ZW5kTW9kZWxDbGFzc0V2ZW50UGF5bG9hZCAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsQ2xhc3NFdmVudENhbGxiYWNrIHR5cGUuXG4gKiBAdHlwZWRlZiB7KHBheWxvYWQ6IEZyb250ZW5kTW9kZWxDbGFzc0V2ZW50UGF5bG9hZCkgPT4gdm9pZH0gRnJvbnRlbmRNb2RlbENsYXNzRXZlbnRDYWxsYmFjayAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7YWN0aXZlPzogYm9vbGVhbiwgZGVib3VuY2U/OiBib29sZWFuIHwgbnVtYmVyLCBvbkNvbm5lY3RlZD86ICgpID0+IHZvaWR9ICYgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0fSBVc2VNb2RlbENsYXNzRXZlbnRPcHRpb25zICovXG5cbi8qKlxuICogUnVucyBhc3NlcnQgbm8gdW5rbm93biBvcHRpb25zLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSB8ICgoKSA9PiB2b2lkKSB8IHVuZGVmaW5lZD59IHJlc3RPcHRpb25zIC0gVW5rbm93biBvcHRpb25zIG9iamVjdC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnROb1Vua25vd25PcHRpb25zKHJlc3RPcHRpb25zKSB7XG4gIGNvbnN0IHVua25vd25PcHRpb25OYW1lcyA9IE9iamVjdC5rZXlzKHJlc3RPcHRpb25zKVxuXG4gIGlmICh1bmtub3duT3B0aW9uTmFtZXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBvcHRpb25zIGdpdmVuIHRvIHVzZU1vZGVsQ2xhc3NFdmVudDogJHt1bmtub3duT3B0aW9uTmFtZXMuam9pbihcIiwgXCIpfWApXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGV2ZW50IHF1ZXJ5IGRlcGVuZGVuY3kgcGF5bG9hZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PEZyb250ZW5kTW9kZWxDbGFzcz4gfCB1bmRlZmluZWR9IHF1ZXJ5IC0gRXZlbnQgcXVlcnkgb3B0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50UXVlcnlQYXlsb2FkIHwgbnVsbH0gU3RhYmxlIGRlcGVuZGVuY3kgcGF5bG9hZC5cbiAqL1xuZnVuY3Rpb24gZXZlbnRRdWVyeURlcGVuZGVuY3lQYXlsb2FkKHF1ZXJ5KSB7XG4gIGlmICghcXVlcnkpIHJldHVybiBudWxsXG5cbiAgcmV0dXJuIHF1ZXJ5LmV2ZW50T3B0aW9uc1BheWxvYWQoKVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGV2ZW50IG5hbWVzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3NFdmVudE5hbWUgfCBGcm9udGVuZE1vZGVsQ2xhc3NFdmVudE5hbWVbXX0gZXZlbnRPckV2ZW50cyAtIEV2ZW50IG5hbWUgb3IgbmFtZXMuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbENsYXNzRXZlbnROYW1lW119IC0gTm9ybWFsaXplZCBldmVudCBuYW1lcy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRXZlbnROYW1lcyhldmVudE9yRXZlbnRzKSB7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KGV2ZW50T3JFdmVudHMpID8gZXZlbnRPckV2ZW50cyA6IFtldmVudE9yRXZlbnRzXVxufVxuXG4vKipcbiAqIFJ1bnMgZXZlbnQgbmFtZXMgZGVwZW5kZW5jeSBrZXkuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc0V2ZW50TmFtZVtdfSBldmVudE5hbWVzIC0gRXZlbnQgbmFtZXMuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFN0YWJsZSBkZXBlbmRlbmN5IGtleS5cbiAqL1xuZnVuY3Rpb24gZXZlbnROYW1lc0RlcGVuZGVuY3lLZXkoZXZlbnROYW1lcykge1xuICByZXR1cm4gZXZlbnROYW1lcy5qb2luKFwifFwiKVxufVxuXG4vKipcbiAqIFJ1bnMgc3Vic2NyaWJlIHRvIG1vZGVsIGNsYXNzIGV2ZW50LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzRXZlbnROYW1lfSBldmVudE5hbWUgLSBFdmVudCBuYW1lLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3NFdmVudENhbGxiYWNrfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3R9IG9wdGlvbnMgLSBFdmVudCBxdWVyeSBvciByZWNvcmQgcHJvamVjdGlvbiBvcHRpb25zLlxuICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHN1YnNjcmliZVRvTW9kZWxDbGFzc0V2ZW50KG1vZGVsQ2xhc3MsIGV2ZW50TmFtZSwgY2FsbGJhY2ssIG9wdGlvbnMpIHtcbiAgaWYgKGV2ZW50TmFtZSA9PT0gXCJjcmVhdGVcIikgcmV0dXJuIGF3YWl0IG1vZGVsQ2xhc3Mub25DcmVhdGUoY2FsbGJhY2ssIG9wdGlvbnMpXG4gIGlmIChldmVudE5hbWUgPT09IFwidXBkYXRlXCIpIHJldHVybiBhd2FpdCBtb2RlbENsYXNzLm9uVXBkYXRlKGNhbGxiYWNrLCBvcHRpb25zKVxuICBpZiAoZXZlbnROYW1lID09PSBcImRlc3Ryb3lcIikgcmV0dXJuIGF3YWl0IG1vZGVsQ2xhc3Mub25EZXN0cm95KGNhbGxiYWNrLCBvcHRpb25zKVxuXG4gIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgZnJvbnRlbmQgbW9kZWwgY2xhc3MgZXZlbnQ6ICR7ZXZlbnROYW1lfWApXG59XG5cbi8qKlxuICogUmVhY3QgaG9vayBmb3IgZnJvbnRlbmQtbW9kZWwgY2xhc3MgbGlmZWN5Y2xlIGV2ZW50cy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzIHwgbnVsbCB8IHVuZGVmaW5lZH0gbW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3NFdmVudE5hbWUgfCBGcm9udGVuZE1vZGVsQ2xhc3NFdmVudE5hbWVbXX0gZXZlbnRPckV2ZW50cyAtIEV2ZW50IG5hbWUgb3IgbmFtZXMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc0V2ZW50Q2FsbGJhY2t9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gKiBAcGFyYW0ge1VzZU1vZGVsQ2xhc3NFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEhvb2sgb3B0aW9ucy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiB1c2VNb2RlbENsYXNzRXZlbnQobW9kZWxDbGFzcywgZXZlbnRPckV2ZW50cywgY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICBjb25zdCB7YWN0aXZlID0gdHJ1ZSwgYWJpbGl0aWVzLCBkZWJvdW5jZSA9IGZhbHNlLCBvbkNvbm5lY3RlZCwgcHJlbG9hZCwgcXVlcnksIHF1ZXJ5RGF0YSwgcmVxdWVzdENvbnRleHQsIHNlbGVjdCwgc2VsZWN0c0V4dHJhLCB3aXRoQ291bnQsIC4uLnJlc3RPcHRpb25zfSA9IG9wdGlvbnNcbiAgYXNzZXJ0Tm9Vbmtub3duT3B0aW9ucyhyZXN0T3B0aW9ucylcblxuICBjb25zdCBwcm9qZWN0aW9uS2V5ID0gSlNPTi5zdHJpbmdpZnkoe2FiaWxpdGllcywgcHJlbG9hZCwgcXVlcnk6IGV2ZW50UXVlcnlEZXBlbmRlbmN5UGF5bG9hZChxdWVyeSksIHF1ZXJ5RGF0YSwgcmVxdWVzdENvbnRleHQ6IGZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dEtleShyZXF1ZXN0Q29udGV4dCksIHNlbGVjdCwgc2VsZWN0c0V4dHJhLCB3aXRoQ291bnR9KVxuICBjb25zdCBwcm9qZWN0aW9uT3B0aW9uc1JlZiA9IHVzZVJlZih7YWJpbGl0aWVzLCBwcmVsb2FkLCBxdWVyeSwgcXVlcnlEYXRhLCByZXF1ZXN0Q29udGV4dCwgc2VsZWN0LCBzZWxlY3RzRXh0cmEsIHdpdGhDb3VudH0pXG4gIGNvbnN0IGNhbGxiYWNrUmVmID0gdXNlUmVmKGNhbGxiYWNrKVxuICBjb25zdCBhY3RpdmVSZWYgPSB1c2VSZWYoYWN0aXZlKVxuICBwcm9qZWN0aW9uT3B0aW9uc1JlZi5jdXJyZW50ID0ge2FiaWxpdGllcywgcHJlbG9hZCwgcXVlcnksIHF1ZXJ5RGF0YSwgcmVxdWVzdENvbnRleHQsIHNlbGVjdCwgc2VsZWN0c0V4dHJhLCB3aXRoQ291bnR9XG4gIGNhbGxiYWNrUmVmLmN1cnJlbnQgPSBjYWxsYmFja1xuICBhY3RpdmVSZWYuY3VycmVudCA9IGFjdGl2ZVxuXG4gIGNvbnN0IGV2ZW50TmFtZXMgPSBub3JtYWxpemVFdmVudE5hbWVzKGV2ZW50T3JFdmVudHMpXG4gIGNvbnN0IGV2ZW50c0tleSA9IGV2ZW50TmFtZXNEZXBlbmRlbmN5S2V5KGV2ZW50TmFtZXMpXG4gIGNvbnN0IGV2ZW50Q2FsbGJhY2sgPSB1c2VNZW1vKCgpID0+IHtcbiAgICBjb25zdCB3cmFwcGVkQ2FsbGJhY2sgPSAoLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQ2xhc3NFdmVudFBheWxvYWR9ICovIHBheWxvYWQpID0+IHtcbiAgICAgIGlmIChhY3RpdmVSZWYuY3VycmVudCkgY2FsbGJhY2tSZWYuY3VycmVudChwYXlsb2FkKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZGVib3VuY2UgPT09IFwibnVtYmVyXCIpIHJldHVybiBkZWJvdW5jZUZ1bmN0aW9uKHdyYXBwZWRDYWxsYmFjaywgZGVib3VuY2UpXG4gICAgaWYgKGRlYm91bmNlKSByZXR1cm4gZGVib3VuY2VGdW5jdGlvbih3cmFwcGVkQ2FsbGJhY2spXG5cbiAgICByZXR1cm4gd3JhcHBlZENhbGxiYWNrXG4gIH0sIFtkZWJvdW5jZV0pXG5cbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBpZiAoIWFjdGl2ZSB8fCAhbW9kZWxDbGFzcykgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgbGV0IGNsb3NlZCA9IGZhbHNlXG4gICAgLyoqXG4gICAgICogVW5zdWJzY3JpYmUgY2FsbGJhY2tzLlxuICAgICAqIEB0eXBlIHtBcnJheTwoKSA9PiB2b2lkPn0gKi9cbiAgICBjb25zdCB1bnN1YnNjcmliZUNhbGxiYWNrcyA9IFtdXG4gICAgY29uc3Qgc3Vic2NyaXB0aW9uQ2FsbGJhY2sgPSAoLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQ2xhc3NFdmVudFBheWxvYWR9ICovIHBheWxvYWQpID0+IHtcbiAgICAgIGlmICghY2xvc2VkKSBldmVudENhbGxiYWNrKHBheWxvYWQpXG4gICAgfVxuXG4gICAgdm9pZCAoYXN5bmMgKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCBldmVudE5hbWUgb2YgZXZlbnROYW1lcykge1xuICAgICAgICBjb25zdCB1bnN1YnNjcmliZSA9IGF3YWl0IHN1YnNjcmliZVRvTW9kZWxDbGFzc0V2ZW50KG1vZGVsQ2xhc3MsIGV2ZW50TmFtZSwgc3Vic2NyaXB0aW9uQ2FsbGJhY2ssIHByb2plY3Rpb25PcHRpb25zUmVmLmN1cnJlbnQpXG5cbiAgICAgICAgaWYgKGNsb3NlZCkge1xuICAgICAgICAgIHVuc3Vic2NyaWJlKClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB1bnN1YnNjcmliZUNhbGxiYWNrcy5wdXNoKHVuc3Vic2NyaWJlKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICghY2xvc2VkICYmIG9uQ29ubmVjdGVkKSBvbkNvbm5lY3RlZCgpXG4gICAgfSkoKVxuXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIGNsb3NlZCA9IHRydWVcblxuICAgICAgZm9yIChjb25zdCB1bnN1YnNjcmliZSBvZiB1bnN1YnNjcmliZUNhbGxiYWNrcykge1xuICAgICAgICB1bnN1YnNjcmliZSgpXG4gICAgICB9XG5cbiAgICAgIGNsZWFyUGVuZGluZ0RlYm91bmNlZENhbGxiYWNrKGV2ZW50Q2FsbGJhY2spXG4gICAgfVxuICB9LCBbYWN0aXZlLCBldmVudHNLZXksIGV2ZW50Q2FsbGJhY2ssIG1vZGVsQ2xhc3MsIG9uQ29ubmVjdGVkLCBwcm9qZWN0aW9uS2V5XSlcbn1cbiJdfQ==