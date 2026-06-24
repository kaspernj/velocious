// @ts-check

import FrontendModelBase from "../../src/frontend-models/base.js"

/** @typedef {{body: Record<string, any>, url: string}} FetchCall */

/**
 * @typedef {object} FrontendModelStubRequest
 * @property {Record<string, any> | null} batchRequest - Single batched request, when present.
 * @property {Record<string, any>[] | null} batchRequests - Batched requests, when present.
 * @property {Record<string, any>} body - Normalized request body.
 * @property {string} url - Request URL.
 */

/**
 * @typedef {object} FetchResponder
 * @property {(body: Record<string, any>, url: string) => boolean} match - Predicate for matching a request.
 * @property {Record<string, any>} response - Response payload for the matched request.
 */

/** @returns {{Comment: typeof FrontendModelBase, Project: typeof FrontendModelBase, Task: typeof FrontendModelBase}} - Test classes with relationships. */
export function buildPreloadTestModelClasses() {
  /** Frontend model comment test class. */
  class Comment extends FrontendModelBase {
    /** @returns {{attributes: string[], commands: string[], primaryKey: string}} - Resource configuration. */
    static resourceConfig() {
      return {attributes: ["id", "body"], commands: ["index"], primaryKey: "id"}
    }
  }

  /** Frontend model task test class. */
  class Task extends FrontendModelBase {
    /** @returns {{attributes: string[], commands: string[], primaryKey: string}} - Resource configuration. */
    static resourceConfig() {
      return {attributes: ["id", "name"], commands: ["index"], primaryKey: "id"}
    }

    /** @returns {Record<string, typeof FrontendModelBase>} - Relationship model classes. */
    static relationshipModelClasses() {
      return {comments: Comment, project: Project}
    }

    /** @returns {Record<string, {type: "hasMany" | "belongsTo", autoload?: boolean}>} - Relationship definitions. */
    static relationshipDefinitions() {
      return {comments: {type: "hasMany"}, project: {type: "belongsTo"}}
    }

    /** @returns {import("../../src/frontend-models/base.js").default} */
    primaryInteraction() {
      return this.getRelationshipByName("primaryInteraction").loaded()
    }
  }

  /** Frontend model project test class. */
  class Project extends FrontendModelBase {
    /** @returns {{attributes: string[], commands: string[], primaryKey: string}} - Resource configuration. */
    static resourceConfig() {
      return {attributes: ["id", "name"], commands: ["index"], primaryKey: "id"}
    }

    /** @returns {Record<string, typeof FrontendModelBase>} - Relationship model classes. */
    static relationshipModelClasses() {
      return {tasks: Task}
    }

    /** @returns {Record<string, {type: "hasMany", autoload?: boolean}>} - Relationship definitions. */
    static relationshipDefinitions() {
      return {tasks: {type: "hasMany"}}
    }
  }

  return {Comment, Project, Task}
}

/**
 * @param {Record<string, any> | ((callIndex: number) => Record<string, any>)} responder - Body, or per-call body factory.
 * @returns {{calls: FetchCall[], restore: () => void}} - Recorded calls and restore callback.
 */
export function stubFrontendModelFetch(responder) {
  const originalFetch = globalThis.fetch
  /** @type {FetchCall[]} */
  const calls = []

  globalThis.fetch = /** @type {typeof fetch} */ (async (url, options) => {
    const request = parseFrontendModelStubRequest(url, options)
    const responseBody = typeof responder === "function" ? responder(calls.length) : responder

    calls.push({body: request.body, url: request.url})

    return /** @type {any} */ ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(frontendModelStubResponsePayload(request, responseBody)),
      json: async () => frontendModelStubResponsePayload(request, responseBody)
    })
  })

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch
    }
  }
}

/**
 * @param {FetchResponder[]} responders - Request responders tried in order.
 * @returns {{calls: FetchCall[], restore: () => void}} - Recorded calls and restore callback.
 */
export function stubFrontendModelFetchWith(responders) {
  const originalFetch = globalThis.fetch
  /** @type {FetchCall[]} */
  const calls = []

  globalThis.fetch = /** @type {typeof fetch} */ (async (url, options) => {
    const request = parseFrontendModelStubRequest(url, options)

    calls.push({body: request.body, url: request.url})

    let matchedResponse = null

    for (const responder of responders) {
      if (responder.match(request.body, request.url)) {
        matchedResponse = responder.response
        break
      }
    }

    if (!matchedResponse) {
      throw new Error(`No stub responder matched request: ${JSON.stringify(request.body)}`)
    }

    return /** @type {any} */ ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(frontendModelStubResponsePayload(request, matchedResponse)),
      json: async () => frontendModelStubResponsePayload(request, matchedResponse)
    })
  })

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch
    }
  }
}

/** @returns {void} */
export function resetFrontendModelTransport() {
  FrontendModelBase.configureTransport({offlineSync: undefined, shared: undefined, url: undefined, websocketClient: undefined})
}

/**
 * @param {string | URL | Request} url - Fetch URL argument.
 * @param {RequestInit | undefined} options - Fetch options.
 * @returns {FrontendModelStubRequest} - Parsed request details.
 */
function parseFrontendModelStubRequest(url, options) {
  const parsedBody = JSON.parse(frontendModelStubRequestBodyString(options))
  const batchRequests = frontendModelStubBatchRequests(parsedBody)
  const batchRequest = frontendModelStubBatchRequest(batchRequests)

  return {
    batchRequest,
    batchRequests,
    body: batchRequest ? batchRequest.payload : parsedBody,
    url: `${url}`
  }
}

/**
 * @param {RequestInit | undefined} options - Fetch options.
 * @returns {string} - Request body string.
 */
function frontendModelStubRequestBodyString(options) {
  return typeof options?.body === "string" ? options.body : "{}"
}

/**
 * @param {Record<string, any>} parsedBody - Parsed request body.
 * @returns {Record<string, any>[] | null} - Batched requests, when present.
 */
function frontendModelStubBatchRequests(parsedBody) {
  return Array.isArray(parsedBody.requests) ? parsedBody.requests : null
}

/**
 * @param {Record<string, any>[] | null} batchRequests - Batched requests, when present.
 * @returns {Record<string, any> | null} - Single batched request, when present.
 */
function frontendModelStubBatchRequest(batchRequests) {
  return batchRequests && batchRequests.length === 1 && typeof batchRequests[0] === "object"
    ? batchRequests[0]
    : null
}

/**
 * @param {FrontendModelStubRequest} request - Parsed request details.
 * @param {Record<string, any>} responseBody - Response body.
 * @returns {Record<string, any>} - Response payload.
 */
function frontendModelStubResponsePayload(request, responseBody) {
  if (!request.batchRequests) {
    return responseBody
  }

  return {
    responses: request.batchRequests.map((req) => ({requestId: req.requestId, response: responseBody}))
  }
}
