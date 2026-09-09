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
 * @typedef {{id: import("./base.js").FrontendModelEventPrimaryKeyValue, model: FrontendModelInstance}} FrontendModelCreateUpdateEventPayload */
/**
 * Defines this typedef.
 * @typedef {{id: import("./base.js").FrontendModelEventPrimaryKeyValue}} FrontendModelDestroyEventPayload */
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXNlLW1vZGVsLWNsYXNzLWV2ZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2Zyb250ZW5kLW1vZGVscy91c2UtbW9kZWwtY2xhc3MtZXZlbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sZ0JBQWdCLE1BQU0sVUFBVSxDQUFBO0FBQ3ZDLE9BQU8sRUFBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBQyxNQUFNLE9BQU8sQ0FBQTtBQUVoRCxPQUFPLDZCQUE2QixNQUFNLHVDQUF1QyxDQUFBO0FBQ2pGLE9BQU8sRUFBQyxvQ0FBb0MsRUFBQyxNQUFNLDZCQUE2QixDQUFBO0FBRWhGOzswRUFFMEU7QUFDMUU7O3VFQUV1RTtBQUN2RTs7NEVBRTRFO0FBQzVFOztnSkFFZ0o7QUFDaEo7OzZHQUU2RztBQUM3Rzs7d0hBRXdIO0FBQ3hIOztrR0FFa0c7QUFDbEc7OzJLQUUySztBQUUzSzs7OztHQUlHO0FBQ0gsU0FBUyxzQkFBc0IsQ0FBQyxXQUFXO0lBQ3pDLE1BQU0sa0JBQWtCLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQTtJQUVuRCxJQUFJLGtCQUFrQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNsQyxNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQ2xHLENBQUM7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsMkJBQTJCLENBQUMsS0FBSztJQUN4QyxJQUFJLENBQUMsS0FBSztRQUFFLE9BQU8sSUFBSSxDQUFBO0lBRXZCLE9BQU8sS0FBSyxDQUFDLG1CQUFtQixFQUFFLENBQUE7QUFDcEMsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLG1CQUFtQixDQUFDLGFBQWE7SUFDeEMsT0FBTyxLQUFLLENBQUMsT0FBTyxDQUFDLGFB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QVcsRUFBRSxDQUFBO1lBQ2YsQ0FBQztZQUVELDZCQUE2QixDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBQzlDLENBQUMsQ0FBQTtJQUNILENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsYUFBYSxFQUFFLFVBQVUsRUFBRSxXQUFXLEVBQUUsYUFBYSxDQUFDLENBQUMsQ0FBQTtBQUNoRixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBkZWJvdW5jZUZ1bmN0aW9uIGZyb20gXCJkZWJvdW5jZVwiXG5pbXBvcnQge3VzZUVmZmVjdCwgdXNlTWVtbywgdXNlUmVmfSBmcm9tIFwicmVhY3RcIlxuXG5pbXBvcnQgY2xlYXJQZW5kaW5nRGVib3VuY2VkQ2FsbGJhY2sgZnJvbSBcIi4vY2xlYXItcGVuZGluZy1kZWJvdW5jZWQtY2FsbGJhY2suanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHRLZXl9IGZyb20gXCIuL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDbGFzcyB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsQ2xhc3N9IEZyb250ZW5kTW9kZWxDbGFzcyAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsSW5zdGFuY2UgdHlwZS5cbiAqIEB0eXBlZGVmIHtJbnN0YW5jZVR5cGU8RnJvbnRlbmRNb2RlbENsYXNzPn0gRnJvbnRlbmRNb2RlbEluc3RhbmNlICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDbGFzc0V2ZW50TmFtZSB0eXBlLlxuICogQHR5cGVkZWYge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IEZyb250ZW5kTW9kZWxDbGFzc0V2ZW50TmFtZSAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7aWQ6IGltcG9ydChcIi4vYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRQcmltYXJ5S2V5VmFsdWUsIG1vZGVsOiBGcm9udGVuZE1vZGVsSW5zdGFuY2V9fSBGcm9udGVuZE1vZGVsQ3JlYXRlVXBkYXRlRXZlbnRQYXlsb2FkICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tpZDogaW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudFByaW1hcnlLZXlWYWx1ZX19IEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRQYXlsb2FkICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDbGFzc0V2ZW50UGF5bG9hZCB0eXBlLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxDcmVhdGVVcGRhdGVFdmVudFBheWxvYWQgfCBGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50UGF5bG9hZH0gRnJvbnRlbmRNb2RlbENsYXNzRXZlbnRQYXlsb2FkICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDbGFzc0V2ZW50Q2FsbGJhY2sgdHlwZS5cbiAqIEB0eXBlZGVmIHsocGF5bG9hZDogRnJvbnRlbmRNb2RlbENsYXNzRXZlbnRQYXlsb2FkKSA9PiB2b2lkfSBGcm9udGVuZE1vZGVsQ2xhc3NFdmVudENhbGxiYWNrICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3thY3RpdmU/OiBib29sZWFuLCBkZWJvdW5jZT86IGJvb2xlYW4gfCBudW1iZXIsIG9uQ29ubmVjdGVkPzogKCkgPT4gdm9pZH0gJiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3R9IFVzZU1vZGVsQ2xhc3NFdmVudE9wdGlvbnMgKi9cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBubyB1bmtub3duIG9wdGlvbnMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlIHwgKCgpID0+IHZvaWQpIHwgdW5kZWZpbmVkPn0gcmVzdE9wdGlvbnMgLSBVbmtub3duIG9wdGlvbnMgb2JqZWN0LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydE5vVW5rbm93bk9wdGlvbnMocmVzdE9wdGlvbnMpIHtcbiAgY29uc3QgdW5rbm93bk9wdGlvbk5hbWVzID0gT2JqZWN0LmtleXMocmVzdE9wdGlvbnMpXG5cbiAgaWYgKHVua25vd25PcHRpb25OYW1lcy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG9wdGlvbnMgZ2l2ZW4gdG8gdXNlTW9kZWxDbGFzc0V2ZW50OiAke3Vua25vd25PcHRpb25OYW1lcy5qb2luKFwiLCBcIil9YClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZXZlbnQgcXVlcnkgZGVwZW5kZW5jeSBwYXlsb2FkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8RnJvbnRlbmRNb2RlbENsYXNzPiB8IHVuZGVmaW5lZH0gcXVlcnkgLSBFdmVudCBxdWVyeSBvcHRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRRdWVyeVBheWxvYWQgfCBudWxsfSBTdGFibGUgZGVwZW5kZW5jeSBwYXlsb2FkLlxuICovXG5mdW5jdGlvbiBldmVudFF1ZXJ5RGVwZW5kZW5jeVBheWxvYWQocXVlcnkpIHtcbiAgaWYgKCFxdWVyeSkgcmV0dXJuIG51bGxcblxuICByZXR1cm4gcXVlcnkuZXZlbnRPcHRpb25zUGF5bG9hZCgpXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZXZlbnQgbmFtZXMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc0V2ZW50TmFtZSB8IEZyb250ZW5kTW9kZWxDbGFzc0V2ZW50TmFtZVtdfSBldmVudE9yRXZlbnRzIC0gRXZlbnQgbmFtZSBvciBuYW1lcy5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQ2xhc3NFdmVudE5hbWVbXX0gLSBOb3JtYWxpemVkIGV2ZW50IG5hbWVzLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVFdmVudE5hbWVzKGV2ZW50T3JFdmVudHMpIHtcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkoZXZlbnRPckV2ZW50cykgPyBldmVudE9yRXZlbnRzIDogW2V2ZW50T3JFdmVudHNdXG59XG5cbi8qKlxuICogUnVucyBldmVudCBuYW1lcyBkZXBlbmRlbmN5IGtleS5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzRXZlbnROYW1lW119IGV2ZW50TmFtZXMgLSBFdmVudCBuYW1lcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RhYmxlIGRlcGVuZGVuY3kga2V5LlxuICovXG5mdW5jdGlvbiBldmVudE5hbWVzRGVwZW5kZW5jeUtleShldmVudE5hbWVzKSB7XG4gIHJldHVybiBldmVudE5hbWVzLmpvaW4oXCJ8XCIpXG59XG5cbi8qKlxuICogUnVucyBzdWJzY3JpYmUgdG8gbW9kZWwgY2xhc3MgZXZlbnQuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3NFdmVudE5hbWV9IGV2ZW50TmFtZSAtIEV2ZW50IG5hbWUuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc0V2ZW50Q2FsbGJhY2t9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc09iamVjdH0gb3B0aW9ucyAtIEV2ZW50IHF1ZXJ5IG9yIHJlY29yZCBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gc3Vic2NyaWJlVG9Nb2RlbENsYXNzRXZlbnQobW9kZWxDbGFzcywgZXZlbnROYW1lLCBjYWxsYmFjaywgb3B0aW9ucykge1xuICBpZiAoZXZlbnROYW1lID09PSBcImNyZWF0ZVwiKSByZXR1cm4gYXdhaXQgbW9kZWxDbGFzcy5vbkNyZWF0ZShjYWxsYmFjaywgb3B0aW9ucylcbiAgaWYgKGV2ZW50TmFtZSA9PT0gXCJ1cGRhdGVcIikgcmV0dXJuIGF3YWl0IG1vZGVsQ2xhc3Mub25VcGRhdGUoY2FsbGJhY2ssIG9wdGlvbnMpXG4gIGlmIChldmVudE5hbWUgPT09IFwiZGVzdHJveVwiKSByZXR1cm4gYXdhaXQgbW9kZWxDbGFzcy5vbkRlc3Ryb3koY2FsbGJhY2ssIG9wdGlvbnMpXG5cbiAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBmcm9udGVuZCBtb2RlbCBjbGFzcyBldmVudDogJHtldmVudE5hbWV9YClcbn1cblxuLyoqXG4gKiBSZWFjdCBob29rIGZvciBmcm9udGVuZC1tb2RlbCBjbGFzcyBsaWZlY3ljbGUgZXZlbnRzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBudWxsIHwgdW5kZWZpbmVkfSBtb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc0V2ZW50TmFtZSB8IEZyb250ZW5kTW9kZWxDbGFzc0V2ZW50TmFtZVtdfSBldmVudE9yRXZlbnRzIC0gRXZlbnQgbmFtZSBvciBuYW1lcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzRXZlbnRDYWxsYmFja30gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAqIEBwYXJhbSB7VXNlTW9kZWxDbGFzc0V2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gSG9vayBvcHRpb25zLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHVzZU1vZGVsQ2xhc3NFdmVudChtb2RlbENsYXNzLCBldmVudE9yRXZlbnRzLCBjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gIGNvbnN0IHthY3RpdmUgPSB0cnVlLCBhYmlsaXRpZXMsIGRlYm91bmNlID0gZmFsc2UsIG9uQ29ubmVjdGVkLCBwcmVsb2FkLCBxdWVyeSwgcXVlcnlEYXRhLCByZXF1ZXN0Q29udGV4dCwgc2VsZWN0LCBzZWxlY3RzRXh0cmEsIHdpdGhDb3VudCwgLi4ucmVzdE9wdGlvbnN9ID0gb3B0aW9uc1xuICBhc3NlcnROb1Vua25vd25PcHRpb25zKHJlc3RPcHRpb25zKVxuXG4gIGNvbnN0IHByb2plY3Rpb25LZXkgPSBKU09OLnN0cmluZ2lmeSh7YWJpbGl0aWVzLCBwcmVsb2FkLCBxdWVyeTogZXZlbnRRdWVyeURlcGVuZGVuY3lQYXlsb2FkKHF1ZXJ5KSwgcXVlcnlEYXRhLCByZXF1ZXN0Q29udGV4dDogZnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0S2V5KHJlcXVlc3RDb250ZXh0KSwgc2VsZWN0LCBzZWxlY3RzRXh0cmEsIHdpdGhDb3VudH0pXG4gIGNvbnN0IHByb2plY3Rpb25PcHRpb25zUmVmID0gdXNlUmVmKHthYmlsaXRpZXMsIHByZWxvYWQsIHF1ZXJ5LCBxdWVyeURhdGEsIHJlcXVlc3RDb250ZXh0LCBzZWxlY3QsIHNlbGVjdHNFeHRyYSwgd2l0aENvdW50fSlcbiAgY29uc3QgY2FsbGJhY2tSZWYgPSB1c2VSZWYoY2FsbGJhY2spXG4gIGNvbnN0IGFjdGl2ZVJlZiA9IHVzZVJlZihhY3RpdmUpXG4gIHByb2plY3Rpb25PcHRpb25zUmVmLmN1cnJlbnQgPSB7YWJpbGl0aWVzLCBwcmVsb2FkLCBxdWVyeSwgcXVlcnlEYXRhLCByZXF1ZXN0Q29udGV4dCwgc2VsZWN0LCBzZWxlY3RzRXh0cmEsIHdpdGhDb3VudH1cbiAgY2FsbGJhY2tSZWYuY3VycmVudCA9IGNhbGxiYWNrXG4gIGFjdGl2ZVJlZi5jdXJyZW50ID0gYWN0aXZlXG5cbiAgY29uc3QgZXZlbnROYW1lcyA9IG5vcm1hbGl6ZUV2ZW50TmFtZXMoZXZlbnRPckV2ZW50cylcbiAgY29uc3QgZXZlbnRzS2V5ID0gZXZlbnROYW1lc0RlcGVuZGVuY3lLZXkoZXZlbnROYW1lcylcbiAgY29uc3QgZXZlbnRDYWxsYmFjayA9IHVzZU1lbW8oKCkgPT4ge1xuICAgIGNvbnN0IHdyYXBwZWRDYWxsYmFjayA9ICgvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxDbGFzc0V2ZW50UGF5bG9hZH0gKi8gcGF5bG9hZCkgPT4ge1xuICAgICAgaWYgKGFjdGl2ZVJlZi5jdXJyZW50KSBjYWxsYmFja1JlZi5jdXJyZW50KHBheWxvYWQpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBkZWJvdW5jZSA9PT0gXCJudW1iZXJcIikgcmV0dXJuIGRlYm91bmNlRnVuY3Rpb24od3JhcHBlZENhbGxiYWNrLCBkZWJvdW5jZSlcbiAgICBpZiAoZGVib3VuY2UpIHJldHVybiBkZWJvdW5jZUZ1bmN0aW9uKHdyYXBwZWRDYWxsYmFjaylcblxuICAgIHJldHVybiB3cmFwcGVkQ2FsbGJhY2tcbiAgfSwgW2RlYm91bmNlXSlcblxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGlmICghYWN0aXZlIHx8ICFtb2RlbENsYXNzKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBsZXQgY2xvc2VkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBVbnN1YnNjcmliZSBjYWxsYmFja3MuXG4gICAgICogQHR5cGUge0FycmF5PCgpID0+IHZvaWQ+fSAqL1xuICAgIGNvbnN0IHVuc3Vic2NyaWJlQ2FsbGJhY2tzID0gW11cbiAgICBjb25zdCBzdWJzY3JpcHRpb25DYWxsYmFjayA9ICgvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxDbGFzc0V2ZW50UGF5bG9hZH0gKi8gcGF5bG9hZCkgPT4ge1xuICAgICAgaWYgKCFjbG9zZWQpIGV2ZW50Q2FsbGJhY2socGF5bG9hZClcbiAgICB9XG5cbiAgICB2b2lkIChhc3luYyAoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IGV2ZW50TmFtZSBvZiBldmVudE5hbWVzKSB7XG4gICAgICAgIGNvbnN0IHVuc3Vic2NyaWJlID0gYXdhaXQgc3Vic2NyaWJlVG9Nb2RlbENsYXNzRXZlbnQobW9kZWxDbGFzcywgZXZlbnROYW1lLCBzdWJzY3JpcHRpb25DYWxsYmFjaywgcHJvamVjdGlvbk9wdGlvbnNSZWYuY3VycmVudClcblxuICAgICAgICBpZiAoY2xvc2VkKSB7XG4gICAgICAgICAgdW5zdWJzY3JpYmUoKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHVuc3Vic2NyaWJlQ2FsbGJhY2tzLnB1c2godW5zdWJzY3JpYmUpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKCFjbG9zZWQgJiYgb25Db25uZWN0ZWQpIG9uQ29ubmVjdGVkKClcbiAgICB9KSgpXG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgY2xvc2VkID0gdHJ1ZVxuXG4gICAgICBmb3IgKGNvbnN0IHVuc3Vic2NyaWJlIG9mIHVuc3Vic2NyaWJlQ2FsbGJhY2tzKSB7XG4gICAgICAgIHVuc3Vic2NyaWJlKClcbiAgICAgIH1cblxuICAgICAgY2xlYXJQZW5kaW5nRGVib3VuY2VkQ2FsbGJhY2soZXZlbnRDYWxsYmFjaylcbiAgICB9XG4gIH0sIFthY3RpdmUsIGV2ZW50c0tleSwgZXZlbnRDYWxsYmFjaywgbW9kZWxDbGFzcywgb25Db25uZWN0ZWQsIHByb2plY3Rpb25LZXldKVxufVxuIl19