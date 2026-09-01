export type FrontendModelClass = import("./base.js").FrontendModelClass;
export type FrontendModelCreateEventPayload = import("./use-model-class-event.js").FrontendModelCreateUpdateEventPayload;
export type UseCreatedEventOptions = import("./use-model-class-event.js").UseModelClassEventOptions;
export type FrontendModelCreateEventCallback = (payload: FrontendModelCreateEventPayload) => void;
/** @typedef {import("./base.js").FrontendModelClass} FrontendModelClass */
/** @typedef {import("./use-model-class-event.js").FrontendModelCreateUpdateEventPayload} FrontendModelCreateEventPayload */
/** @typedef {import("./use-model-class-event.js").UseModelClassEventOptions} UseCreatedEventOptions */
/** @typedef {(payload: FrontendModelCreateEventPayload) => void} FrontendModelCreateEventCallback */
/**
 * React hook for frontend-model class create events.
 * @param {FrontendModelClass | null | undefined} modelClass - Frontend model class.
 * @param {FrontendModelCreateEventCallback} callback - Event callback.
 * @param {UseCreatedEventOptions} [options] - Hook options.
 * @returns {void}
 */
export default function useCreatedEvent(modelClass: FrontendModelClass | null | undefined, callback: FrontendModelCreateEventCallback, options?: UseCreatedEventOptions): void;
//# sourceMappingURL=use-created-event.d.ts.map