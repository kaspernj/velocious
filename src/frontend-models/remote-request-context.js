// @ts-check

import {captureRemoteRequestContext, mergeRemoteRequestContext} from "../remote-request-context.js"

const RESERVED_KEYS = ["commandType", "customPath", "model", "payload", "requestContext", "requestId", "requests"]
const REQUEST_CONTEXT_LABEL = "Frontend model request context"

/**
 * Captures one frontend-model operation's immutable remote request context.
 * @param {ReturnType<typeof JSON.parse> | undefined} value - Configured or untrusted context value.
 * @returns {import("../remote-request-context.js").RemoteRequestContext} Frozen context snapshot.
 */
export function captureFrontendModelRemoteRequestContext(value) {
  return captureRemoteRequestContext(value, {
    label: REQUEST_CONTEXT_LABEL,
    reservedKeys: RESERVED_KEYS
  })
}

/**
 * Merges captured context into frontend-model command or subscription params.
 * @template {Record<string, ReturnType<typeof JSON.parse>>} TParams
 * @param {import("../remote-request-context.js").RemoteRequestContext} context - Captured context.
 * @param {TParams} params - Framework-owned params.
 * @returns {TParams & import("../remote-request-context.js").RemoteRequestContext} Merged params.
 */
export function mergeFrontendModelRemoteRequestContext(context, params) {
  return mergeRemoteRequestContext({context, label: REQUEST_CONTEXT_LABEL, params})
}
