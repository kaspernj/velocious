export type FrontendModelClass = import("./base.js").FrontendModelClass;
export type FrontendModelInstance = InstanceType<FrontendModelClass>;
export type FrontendModelClassEventName = "create" | "update" | "destroy";
export type FrontendModelCreateUpdateEventPayload = {
    id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue;
    model: FrontendModelInstance;
};
export type FrontendModelDestroyEventPayload = {
    id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue;
};
export type FrontendModelClassEventPayload = FrontendModelCreateUpdateEventPayload | FrontendModelDestroyEventPayload;
export type FrontendModelClassEventCallback = (payload: FrontendModelClassEventPayload) => void;
export type UseModelClassEventOptions = {
    active?: boolean;
    debounce?: boolean | number;
    onConnected?: () => void;
} & import("./query.js").FrontendModelEventOptionsObject;
/**
 * React hook for frontend-model class lifecycle events.
 * @param {FrontendModelClass | null | undefined} modelClass - Frontend model class.
 * @param {FrontendModelClassEventName | FrontendModelClassEventName[]} eventOrEvents - Event name or names.
 * @param {FrontendModelClassEventCallback} callback - Event callback.
 * @param {UseModelClassEventOptions} [options] - Hook options.
 * @returns {void}
 */
export default function useModelClassEvent(modelClass: FrontendModelClass | null | undefined, eventOrEvents: FrontendModelClassEventName | FrontendModelClassEventName[], callback: FrontendModelClassEventCallback, options?: UseModelClassEventOptions): void;
//# sourceMappingURL=use-model-class-event.d.ts.map