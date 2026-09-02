export type FrontendModelClass = import("./base.js").FrontendModelClass;
export type FrontendModelInstance = import("./base.js").default;
export type FrontendModelClassDestroyEventPayload = import("./use-model-class-event.js").FrontendModelDestroyEventPayload;
export type FrontendModelInstanceDestroyEventPayload = {
    id: string;
};
export type FrontendModelDestroyEventPayload = FrontendModelClassDestroyEventPayload | FrontendModelInstanceDestroyEventPayload;
export type UseDestroyedEventOptions = import("./use-model-class-event.js").UseModelClassEventOptions;
export type FrontendModelDestroyEventCallback = (payload: FrontendModelDestroyEventPayload) => void;
/**
 * React hook for frontend-model destroy events. Pass a model class for class-level
 * destroy events, or a model / model array for instance-level destroy events.
 * @param {FrontendModelClass | FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelClassOrModels - Model class, model, or models.
 * @param {FrontendModelDestroyEventCallback} callback - Event callback.
 * @param {UseDestroyedEventOptions} [options] - Hook options.
 * @returns {void}
 */
export default function useDestroyedEvent(modelClassOrModels: FrontendModelClass | FrontendModelInstance | FrontendModelInstance[] | null | undefined, callback: FrontendModelDestroyEventCallback, options?: UseDestroyedEventOptions): void;
//# sourceMappingURL=use-destroyed-event.d.ts.map