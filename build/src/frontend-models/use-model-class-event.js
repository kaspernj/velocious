// @ts-check
import debounceFunction from "debounce";
import { useEffect, useMemo, useRef } from "react";
import clearPendingDebouncedCallback from "./clear-pending-debounced-callback.js";
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
 * @returns {import("./query.js").FrontendModelEventOptionsPayload | null} Stable dependency payload.
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
    const { active = true, abilities, debounce = false, onConnected, preload, query, queryData, select, selectsExtra, withCount, ...restOptions } = options;
    assertNoUnknownOptions(restOptions);
    const projectionKey = JSON.stringify({ abilities, preload, query: eventQueryDependencyPayload(query), queryData, select, selectsExtra, withCount });
    const projectionOptionsRef = useRef({ abilities, preload, query, queryData, select, selectsExtra, withCount });
    const callbackRef = useRef(callback);
    const activeRef = useRef(active);
    projectionOptionsRef.current = { abilities, preload, query, queryData, select, selectsExtra, withCount };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXNlLW1vZGVsLWNsYXNzLWV2ZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2Zyb250ZW5kLW1vZGVscy91c2UtbW9kZWwtY2xhc3MtZXZlbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sZ0JBQWdCLE1BQU0sVUFBVSxDQUFBO0FBQ3ZDLE9BQU8sRUFBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBQyxNQUFNLE9BQU8sQ0FBQTtBQUVoRCxPQUFPLDZCQUE2QixNQUFNLHVDQUF1QyxDQUFBO0FBRWpGOzswRUFFMEU7QUFDMUU7O3VFQUV1RTtBQUN2RTs7NEVBRTRFO0FBQzVFOztpR0FFaUc7QUFDakc7OzhEQUU4RDtBQUM5RDs7d0hBRXdIO0FBQ3hIOztrR0FFa0c7QUFDbEc7OzJLQUUySztBQUUzSzs7OztHQUlHO0FBQ0gsU0FBUyxzQkFBc0IsQ0FBQyxXQUFXO0lBQ3pDLE1BQU0sa0JBQWtCLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQTtJQUVuRCxJQUFJLGtCQUFrQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNsQyxNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQ2xHLENBQUM7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsMkJBQTJCLENBQUMsS0FBSztJQUN4QyxJQUFJLENBQUMsS0FBSztRQUFFLE9BQU8sSUFBSSxDQUFBO0lBRXZCLE9BQU8sS0FBSyxDQUFDLG1CQUFtQixFQUFFLENBQUE7QUFDcEMsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLG1CQUFtQixDQUFDLGFBQWE7SUFDeEMsT0FBTyxLQUFLLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENB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QUFhLEVBQUUsVUFBVSxFQUFFLFdBQVcsRUFBRSxhQUFhLENBQUMsQ0FBQyxDQUFBO0FBQ2hGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IGRlYm91bmNlRnVuY3Rpb24gZnJvbSBcImRlYm91bmNlXCJcbmltcG9ydCB7dXNlRWZmZWN0LCB1c2VNZW1vLCB1c2VSZWZ9IGZyb20gXCJyZWFjdFwiXG5cbmltcG9ydCBjbGVhclBlbmRpbmdEZWJvdW5jZWRDYWxsYmFjayBmcm9tIFwiLi9jbGVhci1wZW5kaW5nLWRlYm91bmNlZC1jYWxsYmFjay5qc1wiXG5cbi8qKlxuICogRnJvbnRlbmRNb2RlbENsYXNzIHR5cGUuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxDbGFzc30gRnJvbnRlbmRNb2RlbENsYXNzICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxJbnN0YW5jZSB0eXBlLlxuICogQHR5cGVkZWYge0luc3RhbmNlVHlwZTxGcm9udGVuZE1vZGVsQ2xhc3M+fSBGcm9udGVuZE1vZGVsSW5zdGFuY2UgKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbENsYXNzRXZlbnROYW1lIHR5cGUuXG4gKiBAdHlwZWRlZiB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gRnJvbnRlbmRNb2RlbENsYXNzRXZlbnROYW1lICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tpZDogc3RyaW5nLCBtb2RlbDogRnJvbnRlbmRNb2RlbEluc3RhbmNlfX0gRnJvbnRlbmRNb2RlbENyZWF0ZVVwZGF0ZUV2ZW50UGF5bG9hZCAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7aWQ6IHN0cmluZ319IEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRQYXlsb2FkICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDbGFzc0V2ZW50UGF5bG9hZCB0eXBlLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxDcmVhdGVVcGRhdGVFdmVudFBheWxvYWQgfCBGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50UGF5bG9hZH0gRnJvbnRlbmRNb2RlbENsYXNzRXZlbnRQYXlsb2FkICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDbGFzc0V2ZW50Q2FsbGJhY2sgdHlwZS5cbiAqIEB0eXBlZGVmIHsocGF5bG9hZDogRnJvbnRlbmRNb2RlbENsYXNzRXZlbnRQYXlsb2FkKSA9PiB2b2lkfSBGcm9udGVuZE1vZGVsQ2xhc3NFdmVudENhbGxiYWNrICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3thY3RpdmU/OiBib29sZWFuLCBkZWJvdW5jZT86IGJvb2xlYW4gfCBudW1iZXIsIG9uQ29ubmVjdGVkPzogKCkgPT4gdm9pZH0gJiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNPYmplY3R9IFVzZU1vZGVsQ2xhc3NFdmVudE9wdGlvbnMgKi9cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBubyB1bmtub3duIG9wdGlvbnMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlIHwgKCgpID0+IHZvaWQpIHwgdW5kZWZpbmVkPn0gcmVzdE9wdGlvbnMgLSBVbmtub3duIG9wdGlvbnMgb2JqZWN0LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydE5vVW5rbm93bk9wdGlvbnMocmVzdE9wdGlvbnMpIHtcbiAgY29uc3QgdW5rbm93bk9wdGlvbk5hbWVzID0gT2JqZWN0LmtleXMocmVzdE9wdGlvbnMpXG5cbiAgaWYgKHVua25vd25PcHRpb25OYW1lcy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG9wdGlvbnMgZ2l2ZW4gdG8gdXNlTW9kZWxDbGFzc0V2ZW50OiAke3Vua25vd25PcHRpb25OYW1lcy5qb2luKFwiLCBcIil9YClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZXZlbnQgcXVlcnkgZGVwZW5kZW5jeSBwYXlsb2FkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8RnJvbnRlbmRNb2RlbENsYXNzPiB8IHVuZGVmaW5lZH0gcXVlcnkgLSBFdmVudCBxdWVyeSBvcHRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZCB8IG51bGx9IFN0YWJsZSBkZXBlbmRlbmN5IHBheWxvYWQuXG4gKi9cbmZ1bmN0aW9uIGV2ZW50UXVlcnlEZXBlbmRlbmN5UGF5bG9hZChxdWVyeSkge1xuICBpZiAoIXF1ZXJ5KSByZXR1cm4gbnVsbFxuXG4gIHJldHVybiBxdWVyeS5ldmVudE9wdGlvbnNQYXlsb2FkKClcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBldmVudCBuYW1lcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzRXZlbnROYW1lIHwgRnJvbnRlbmRNb2RlbENsYXNzRXZlbnROYW1lW119IGV2ZW50T3JFdmVudHMgLSBFdmVudCBuYW1lIG9yIG5hbWVzLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxDbGFzc0V2ZW50TmFtZVtdfSAtIE5vcm1hbGl6ZWQgZXZlbnQgbmFtZXMuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV2ZW50TmFtZXMoZXZlbnRPckV2ZW50cykge1xuICByZXR1cm4gQXJyYXkuaXNBcnJheShldmVudE9yRXZlbnRzKSA/IGV2ZW50T3JFdmVudHMgOiBbZXZlbnRPckV2ZW50c11cbn1cblxuLyoqXG4gKiBSdW5zIGV2ZW50IG5hbWVzIGRlcGVuZGVuY3kga2V5LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3NFdmVudE5hbWVbXX0gZXZlbnROYW1lcyAtIEV2ZW50IG5hbWVzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBTdGFibGUgZGVwZW5kZW5jeSBrZXkuXG4gKi9cbmZ1bmN0aW9uIGV2ZW50TmFtZXNEZXBlbmRlbmN5S2V5KGV2ZW50TmFtZXMpIHtcbiAgcmV0dXJuIGV2ZW50TmFtZXMuam9pbihcInxcIilcbn1cblxuLyoqXG4gKiBSdW5zIHN1YnNjcmliZSB0byBtb2RlbCBjbGFzcyBldmVudC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc0V2ZW50TmFtZX0gZXZlbnROYW1lIC0gRXZlbnQgbmFtZS5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzRXZlbnRDYWxsYmFja30gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zT2JqZWN0fSBvcHRpb25zIC0gRXZlbnQgcXVlcnkgb3IgcmVjb3JkIHByb2plY3Rpb24gb3B0aW9ucy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICovXG5hc3luYyBmdW5jdGlvbiBzdWJzY3JpYmVUb01vZGVsQ2xhc3NFdmVudChtb2RlbENsYXNzLCBldmVudE5hbWUsIGNhbGxiYWNrLCBvcHRpb25zKSB7XG4gIGlmIChldmVudE5hbWUgPT09IFwiY3JlYXRlXCIpIHJldHVybiBhd2FpdCBtb2RlbENsYXNzLm9uQ3JlYXRlKGNhbGxiYWNrLCBvcHRpb25zKVxuICBpZiAoZXZlbnROYW1lID09PSBcInVwZGF0ZVwiKSByZXR1cm4gYXdhaXQgbW9kZWxDbGFzcy5vblVwZGF0ZShjYWxsYmFjaywgb3B0aW9ucylcbiAgaWYgKGV2ZW50TmFtZSA9PT0gXCJkZXN0cm95XCIpIHJldHVybiBhd2FpdCBtb2RlbENsYXNzLm9uRGVzdHJveShjYWxsYmFjaywgb3B0aW9ucylcblxuICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGZyb250ZW5kIG1vZGVsIGNsYXNzIGV2ZW50OiAke2V2ZW50TmFtZX1gKVxufVxuXG4vKipcbiAqIFJlYWN0IGhvb2sgZm9yIGZyb250ZW5kLW1vZGVsIGNsYXNzIGxpZmVjeWNsZSBldmVudHMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzcyB8IG51bGwgfCB1bmRlZmluZWR9IG1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzRXZlbnROYW1lIHwgRnJvbnRlbmRNb2RlbENsYXNzRXZlbnROYW1lW119IGV2ZW50T3JFdmVudHMgLSBFdmVudCBuYW1lIG9yIG5hbWVzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3NFdmVudENhbGxiYWNrfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICogQHBhcmFtIHtVc2VNb2RlbENsYXNzRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBIb29rIG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gdXNlTW9kZWxDbGFzc0V2ZW50KG1vZGVsQ2xhc3MsIGV2ZW50T3JFdmVudHMsIGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgY29uc3Qge2FjdGl2ZSA9IHRydWUsIGFiaWxpdGllcywgZGVib3VuY2UgPSBmYWxzZSwgb25Db25uZWN0ZWQsIHByZWxvYWQsIHF1ZXJ5LCBxdWVyeURhdGEsIHNlbGVjdCwgc2VsZWN0c0V4dHJhLCB3aXRoQ291bnQsIC4uLnJlc3RPcHRpb25zfSA9IG9wdGlvbnNcbiAgYXNzZXJ0Tm9Vbmtub3duT3B0aW9ucyhyZXN0T3B0aW9ucylcblxuICBjb25zdCBwcm9qZWN0aW9uS2V5ID0gSlNPTi5zdHJpbmdpZnkoe2FiaWxpdGllcywgcHJlbG9hZCwgcXVlcnk6IGV2ZW50UXVlcnlEZXBlbmRlbmN5UGF5bG9hZChxdWVyeSksIHF1ZXJ5RGF0YSwgc2VsZWN0LCBzZWxlY3RzRXh0cmEsIHdpdGhDb3VudH0pXG4gIGNvbnN0IHByb2plY3Rpb25PcHRpb25zUmVmID0gdXNlUmVmKHthYmlsaXRpZXMsIHByZWxvYWQsIHF1ZXJ5LCBxdWVyeURhdGEsIHNlbGVjdCwgc2VsZWN0c0V4dHJhLCB3aXRoQ291bnR9KVxuICBjb25zdCBjYWxsYmFja1JlZiA9IHVzZVJlZihjYWxsYmFjaylcbiAgY29uc3QgYWN0aXZlUmVmID0gdXNlUmVmKGFjdGl2ZSlcbiAgcHJvamVjdGlvbk9wdGlvbnNSZWYuY3VycmVudCA9IHthYmlsaXRpZXMsIHByZWxvYWQsIHF1ZXJ5LCBxdWVyeURhdGEsIHNlbGVjdCwgc2VsZWN0c0V4dHJhLCB3aXRoQ291bnR9XG4gIGNhbGxiYWNrUmVmLmN1cnJlbnQgPSBjYWxsYmFja1xuICBhY3RpdmVSZWYuY3VycmVudCA9IGFjdGl2ZVxuXG4gIGNvbnN0IGV2ZW50TmFtZXMgPSBub3JtYWxpemVFdmVudE5hbWVzKGV2ZW50T3JFdmVudHMpXG4gIGNvbnN0IGV2ZW50c0tleSA9IGV2ZW50TmFtZXNEZXBlbmRlbmN5S2V5KGV2ZW50TmFtZXMpXG4gIGNvbnN0IGV2ZW50Q2FsbGJhY2sgPSB1c2VNZW1vKCgpID0+IHtcbiAgICBjb25zdCB3cmFwcGVkQ2FsbGJhY2sgPSAoLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQ2xhc3NFdmVudFBheWxvYWR9ICovIHBheWxvYWQpID0+IHtcbiAgICAgIGlmIChhY3RpdmVSZWYuY3VycmVudCkgY2FsbGJhY2tSZWYuY3VycmVudChwYXlsb2FkKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZGVib3VuY2UgPT09IFwibnVtYmVyXCIpIHJldHVybiBkZWJvdW5jZUZ1bmN0aW9uKHdyYXBwZWRDYWxsYmFjaywgZGVib3VuY2UpXG4gICAgaWYgKGRlYm91bmNlKSByZXR1cm4gZGVib3VuY2VGdW5jdGlvbih3cmFwcGVkQ2FsbGJhY2spXG5cbiAgICByZXR1cm4gd3JhcHBlZENhbGxiYWNrXG4gIH0sIFtkZWJvdW5jZV0pXG5cbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBpZiAoIWFjdGl2ZSB8fCAhbW9kZWxDbGFzcykgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgbGV0IGNsb3NlZCA9IGZhbHNlXG4gICAgLyoqXG4gICAgICogVW5zdWJzY3JpYmUgY2FsbGJhY2tzLlxuICAgICAqIEB0eXBlIHtBcnJheTwoKSA9PiB2b2lkPn0gKi9cbiAgICBjb25zdCB1bnN1YnNjcmliZUNhbGxiYWNrcyA9IFtdXG4gICAgY29uc3Qgc3Vic2NyaXB0aW9uQ2FsbGJhY2sgPSAoLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQ2xhc3NFdmVudFBheWxvYWR9ICovIHBheWxvYWQpID0+IHtcbiAgICAgIGlmICghY2xvc2VkKSBldmVudENhbGxiYWNrKHBheWxvYWQpXG4gICAgfVxuXG4gICAgdm9pZCAoYXN5bmMgKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCBldmVudE5hbWUgb2YgZXZlbnROYW1lcykge1xuICAgICAgICBjb25zdCB1bnN1YnNjcmliZSA9IGF3YWl0IHN1YnNjcmliZVRvTW9kZWxDbGFzc0V2ZW50KG1vZGVsQ2xhc3MsIGV2ZW50TmFtZSwgc3Vic2NyaXB0aW9uQ2FsbGJhY2ssIHByb2plY3Rpb25PcHRpb25zUmVmLmN1cnJlbnQpXG5cbiAgICAgICAgaWYgKGNsb3NlZCkge1xuICAgICAgICAgIHVuc3Vic2NyaWJlKClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB1bnN1YnNjcmliZUNhbGxiYWNrcy5wdXNoKHVuc3Vic2NyaWJlKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICghY2xvc2VkICYmIG9uQ29ubmVjdGVkKSBvbkNvbm5lY3RlZCgpXG4gICAgfSkoKVxuXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIGNsb3NlZCA9IHRydWVcblxuICAgICAgZm9yIChjb25zdCB1bnN1YnNjcmliZSBvZiB1bnN1YnNjcmliZUNhbGxiYWNrcykge1xuICAgICAgICB1bnN1YnNjcmliZSgpXG4gICAgICB9XG5cbiAgICAgIGNsZWFyUGVuZGluZ0RlYm91bmNlZENhbGxiYWNrKGV2ZW50Q2FsbGJhY2spXG4gICAgfVxuICB9LCBbYWN0aXZlLCBldmVudHNLZXksIGV2ZW50Q2FsbGJhY2ssIG1vZGVsQ2xhc3MsIG9uQ29ubmVjdGVkLCBwcm9qZWN0aW9uS2V5XSlcbn1cbiJdfQ==