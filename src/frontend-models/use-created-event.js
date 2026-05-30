// @ts-check

import useModelClassEvent from "./use-model-class-event.js"

/** @typedef {typeof import("./base.js").default} FrontendModelClass */
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
export default function useCreatedEvent(modelClass, callback, options = {}) {
  useModelClassEvent(modelClass, "create", (payload) => {
    callback(/** @type {FrontendModelCreateEventPayload} */ (payload))
  }, options)
}
