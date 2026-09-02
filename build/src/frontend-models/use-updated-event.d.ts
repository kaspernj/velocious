export type FrontendModelClass = import("./base.js").FrontendModelClass;
export type FrontendModelInstance = import("./base.js").default;
export type FrontendModelClassUpdateEventPayload = import("./use-model-class-event.js").FrontendModelCreateUpdateEventPayload;
export type FrontendModelInstanceUpdateEventPayload = {
    id: string;
    model: FrontendModelInstance;
};
export type FrontendModelUpdateEventPayload = FrontendModelClassUpdateEventPayload | FrontendModelInstanceUpdateEventPayload;
export type UseUpdatedEventOptions = import("./use-model-class-event.js").UseModelClassEventOptions;
export type FrontendModelUpdateEventCallback = (payload: FrontendModelUpdateEventPayload) => void;
/**
 * React hook for frontend-model update events. Pass a model class for class-level
 * update events, or a model / model array for instance-level update events.
 * @param {FrontendModelClass | FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelClassOrModels - Model class, model, or models.
 * @param {FrontendModelUpdateEventCallback} callback - Event callback.
 * @param {UseUpdatedEventOptions} [options] - Hook options.
 * @returns {void}
 */
export default function useUpdatedEvent(modelClassOrModels: FrontendModelClass | FrontendModelInstance | FrontendModelInstance[] | null | undefined, callback: FrontendModelUpdateEventCallback, options?: UseUpdatedEventOptions): void;
//# sourceMappingURL=use-updated-event.d.ts.map