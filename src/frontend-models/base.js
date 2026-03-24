// @ts-check

import * as inflection from "inflection"
import FrontendModelQuery from "./query.js"
import {registerFrontendModel, resolveFrontendModelClass} from "./model-registry.js"
import {validateFrontendModelResourceCommandName, validateFrontendModelResourcePath} from "./resource-config-validation.js"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "./transport-serialization.js"

/** @typedef {"create" | "find" | "index" | "update" | "destroy" | "attach" | "download" | "url"} FrontendModelCommandType */
/** @typedef {FrontendModelCommandType | string} FrontendModelRequestCommandType */
/**
 * @typedef {{type: "hasOne" | "hasMany"}} FrontendModelAttachmentDefinition
 */
/**
 * @typedef {{builtInCollectionCommands?: Record<string, string>, builtInMemberCommands?: Record<string, string>, collectionCommands?: Record<string, string>, commands?: Record<string, string>, memberCommands?: Record<string, string>, attachments?: Record<string, FrontendModelAttachmentDefinition>, modelName?: string, path?: string, primaryKey?: string}} FrontendModelResourceConfig
 */
/**
 * @typedef {object} FrontendModelTransportConfig
 * @property {string | (() => string | undefined | null)} [url] - Optional frontend-model URL. For shared-endpoint models this should be the full shared endpoint (for example `"/frontend-models"` or `"https://example.com/frontend-models"`). For legacy direct-resource models this can be the backend origin/prefix.
 * @property {"omit" | "same-origin" | "include"} [credentials] - Optional credentials mode forwarded to fetch.
 * @property {boolean} [shared] - When true, route built-in commands for path-based models through the shared frontend-model API envelope instead of direct per-command endpoints.
 * @property {{post: (path: string, body?: any, options?: {headers?: Record<string, string>}) => Promise<{json: () => any}>, subscribe: (channel: string, options: {params?: Record<string, any>}, callback: (payload: any) => void) => (() => void), subscribeAndWait?: (channel: string, options: {params?: Record<string, any>}, callback: (payload: any) => void) => Promise<(() => void)>}} [websocketClient] - Optional websocket client for shared frontend-model API requests and subscriptions.
 * @property {((args: {commandName: string, commandType: FrontendModelRequestCommandType, customPath?: string, modelClass: typeof FrontendModelBase, payload: Record<string, any>, url: string}) => Promise<Record<string, any>>)} [request] - Optional custom transport handler.
 */

/** @type {FrontendModelTransportConfig} */
const frontendModelTransportConfig = {}
const SHARED_FRONTEND_MODEL_API_PATH = "/frontend-models"
const PRELOADED_RELATIONSHIPS_KEY = "__preloadedRelationships"
const SELECTED_ATTRIBUTES_KEY = "__selectedAttributes"
/** @type {Array<{commandName?: string, commandType: FrontendModelRequestCommandType, customPath?: string, modelClass: typeof FrontendModelBase, payload: Record<string, any>, requestId: string, resolve: (response: Record<string, any>) => void, reject: (error: unknown) => void, resourcePath?: string | null}>} */
let pendingSharedFrontendModelRequests = []
let sharedFrontendModelRequestId = 0
let sharedFrontendModelFlushScheduled = false

/**
 * @param {typeof FrontendModelBase} modelClass - Frontend model class.
 * @returns {string} - Default resource path for the model class.
 */
function defaultFrontendModelResourcePath(modelClass) {
  return `/${inflection.dasherize(inflection.pluralize(inflection.underscore(modelClass.name)))}`
}

/** Error raised when reading an attribute that was not selected in query payloads. */
export class AttributeNotSelectedError extends Error {
  /**
   * @param {string} modelName - Model class name.
   * @param {string} attributeName - Attribute that was requested.
   */
  constructor(modelName, attributeName) {
    super(`${modelName}#${attributeName} was not selected`)
    this.name = "AttributeNotSelectedError"
  }
}

/**
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, any>} - Whether value is a plain object.
 */
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * Lightweight singular relationship state holder for frontend model instances.
 * @template {typeof FrontendModelBase} S
 * @template {typeof FrontendModelBase} T
 */
export class FrontendModelSingularRelationship {
  /**
   * @param {InstanceType<S>} model - Parent model.
   * @param {string} relationshipName - Relationship name.
   * @param {T | null} targetModelClass - Target model class.
   */
  constructor(model, relationshipName, targetModelClass) {
    this.model = model
    this.relationshipName = relationshipName
    this.targetModelClass = targetModelClass
    this._preloaded = false
    this._loadedValue = null
  }

  /**
   * @param {any} loadedValue - Loaded relationship value.
   * @returns {void}
   */
  setLoaded(loadedValue) {
    this._loadedValue = loadedValue == undefined ? null : loadedValue
    this._preloaded = true
  }

  /**
   * @returns {boolean} - Whether relationship is preloaded.
   */
  getPreloaded() {
    return this._preloaded
  }

  /**
   * @returns {any} - Loaded relationship value.
   */
  loaded() {
    if (!this._preloaded) {
      throw new Error(`${this.model.constructor.name}#${this.relationshipName} hasn't been preloaded`)
    }

    return this._loadedValue
  }

  /**
   * @param {Record<string, any>} [attributes] - New model attributes.
   * @returns {InstanceType<T>} - Built model.
   */
  build(attributes = {}) {
    if (!this.targetModelClass) {
      throw new Error(`No target model class configured for ${this.model.constructor.name}#${this.relationshipName}`)
    }

    const model = /** @type {InstanceType<T>} */ (new this.targetModelClass(attributes))

    this.setLoaded(model)

    return model
  }
}

/**
 * Lightweight has-many relationship state holder for frontend model instances.
 * @template {typeof FrontendModelBase} S
 * @template {typeof FrontendModelBase} T
 */
export class FrontendModelHasManyRelationship {
  /**
   * @param {InstanceType<S>} model - Parent model.
   * @param {string} relationshipName - Relationship name.
   * @param {T | null} targetModelClass - Target model class.
   */
  constructor(model, relationshipName, targetModelClass) {
    this.model = model
    this.relationshipName = relationshipName
    this.targetModelClass = targetModelClass
    this._preloaded = false
    this._loadedValue = []
  }

  /**
   * @param {Array<InstanceType<T>>} loadedValue - Loaded relationship value.
   * @returns {void}
   */
  setLoaded(loadedValue) {
    this._loadedValue = Array.isArray(loadedValue) ? loadedValue : []
    this._preloaded = true
  }

  /**
   * @returns {boolean} - Whether relationship is preloaded.
   */
  getPreloaded() {
    return this._preloaded
  }

  /**
   * @returns {Array<InstanceType<T>>} - Loaded relationship values.
   */
  loaded() {
    if (!this._preloaded) {
      throw new Error(`${this.model.constructor.name}#${this.relationshipName} hasn't been preloaded`)
    }

    return this._loadedValue
  }

  /**
   * @param {Array<InstanceType<T>>} models - Models to append.
   * @returns {void}
   */
  addToLoaded(models) {
    const loadedModels = this.getPreloaded() ? this.loaded() : []

    this.setLoaded([...loadedModels, ...models])
  }

  /**
   * @param {Record<string, any>} [attributes] - New model attributes.
   * @returns {InstanceType<T>} - Built model.
   */
  build(attributes = {}) {
    if (!this.targetModelClass) {
      throw new Error(`No target model class configured for ${this.model.constructor.name}#${this.relationshipName}`)
    }

    const model = /** @type {InstanceType<T>} */ (new this.targetModelClass(attributes))

    this.addToLoaded([model])

    return model
  }
}

/**
 * @param {string} relationshipType - Relationship type.
 * @returns {boolean} - Whether relationship type is has-many.
 */
function relationshipTypeIsCollection(relationshipType) {
  return relationshipType == "hasMany"
}

/**
 * Downloaded frontend-model attachment payload wrapper.
 */
export class FrontendModelAttachmentDownload {
  /**
   * @param {object} args - Options.
   * @param {string} args.id - Attachment id.
   * @param {string} args.filename - Filename.
   * @param {string | null} args.contentType - Content type.
   * @param {number} args.byteSize - File size in bytes.
   * @param {Uint8Array} args.content - File content bytes.
   * @param {string | null} [args.url] - Resolvable attachment URL.
   */
  constructor({byteSize, content, contentType, filename, id, url = null}) {
    this.idValue = id
    this.filenameValue = filename
    this.contentTypeValue = contentType
    this.byteSizeValue = byteSize
    this.contentValue = content
    this.urlValue = url
  }

  /** @returns {number} - File size in bytes. */
  byteSize() { return this.byteSizeValue }
  /** @returns {Uint8Array} - File content bytes. */
  content() { return this.contentValue }
  /** @returns {string | null} - Content type. */
  contentType() { return this.contentTypeValue }
  /** @returns {string} - Filename. */
  filename() { return this.filenameValue }
  /** @returns {string} - Attachment id. */
  id() { return this.idValue }
  /** @returns {string | null} - Resolvable attachment URL. */
  url() { return this.urlValue }
}

/**
 * @param {unknown} value - Candidate value.
 * @returns {boolean} - Whether value looks like byte data.
 */
function frontendAttachmentValueIsBytes(value) {
  return value instanceof Uint8Array || value instanceof ArrayBuffer || (typeof Buffer !== "undefined" && Buffer.isBuffer(value))
}

/**
 * @param {unknown} value - Candidate value.
 * @returns {value is {arrayBuffer: () => Promise<ArrayBuffer>}} - Whether candidate supports arrayBuffer().
 */
function frontendAttachmentValueSupportsArrayBuffer(value) {
  return Boolean(value && typeof value === "object" && typeof /** @type {any} */ (value).arrayBuffer === "function")
}

/**
 * @param {Uint8Array | Buffer | ArrayBuffer} value - Byte-like value.
 * @returns {Uint8Array} - Uint8Array bytes.
 */
function frontendAttachmentNormalizeBytes(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(/** @type {any} */ (value))) {
    return new Uint8Array(/** @type {Buffer} */ (value))
  }

  throw new Error("Unsupported attachment bytes value")
}

/**
 * @param {Uint8Array} bytes - Bytes.
 * @returns {string} - Base64 value.
 */
function frontendAttachmentBytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64")
  }

  let binary = ""

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  if (typeof btoa !== "function") throw new Error("Missing base64 encoder")

  return btoa(binary)
}

/**
 * @param {string} value - Base64 value.
 * @returns {Uint8Array} - Decoded bytes.
 */
function frontendAttachmentBase64ToBytes(value) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"))
  }

  if (typeof atob !== "function") throw new Error("Missing base64 decoder")

  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

/**
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, any>} - Whether value is plain object.
 */
function frontendAttachmentValueIsPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * @param {unknown} value - Payload candidate.
 * @returns {boolean} - Whether payload contains an attachment upload body.
 */
function frontendModelPayloadContainsAttachmentUpload(value) {
  if (!value || typeof value !== "object") return false

  if (Array.isArray(value)) {
    return value.some((entry) => frontendModelPayloadContainsAttachmentUpload(entry))
  }

  if (!frontendAttachmentValueIsPlainObject(value)) return false

  if (typeof value.contentBase64 === "string") {
    return true
  }

  return Object.values(value).some((entry) => frontendModelPayloadContainsAttachmentUpload(entry))
}

/**
 * @param {unknown} input - Attachment input.
 * @returns {Promise<Record<string, any>>} - Transport-safe attachment payload.
 */
async function normalizeFrontendAttachmentInput(input) {
  if (frontendAttachmentValueIsPlainObject(input) && "file" in input) {
    const normalizedFile = await normalizeFrontendAttachmentInput(input.file)
    const merged = {
      ...normalizedFile
    }

    if (typeof input.filename === "string" && input.filename.length > 0) merged.filename = input.filename
    if (typeof input.contentType === "string" && input.contentType.length > 0) merged.contentType = input.contentType

    return merged
  }

  if (frontendAttachmentValueIsPlainObject(input)) {
    if (typeof input.path === "string" && input.path.length > 0) {
      throw new Error("Attachment path input is not supported in frontend models")
    }

    if (typeof input.contentBase64 === "string") {
      return {
        contentBase64: input.contentBase64,
        contentType: typeof input.contentType === "string" && input.contentType.length > 0 ? input.contentType : null,
        filename: typeof input.filename === "string" && input.filename.length > 0 ? input.filename : undefined
      }
    }
  }

  if (frontendAttachmentValueSupportsArrayBuffer(input)) {
    const bytes = new Uint8Array(await input.arrayBuffer())

    return {
      contentBase64: frontendAttachmentBytesToBase64(bytes),
      contentType: typeof /** @type {any} */ (input).type === "string" && /** @type {any} */ (input).type.length > 0
        ? /** @type {any} */ (input).type
        : null,
      filename: typeof /** @type {any} */ (input).name === "string" && /** @type {any} */ (input).name.length > 0
        ? /** @type {any} */ (input).name
        : "attachment.bin"
    }
  }

  if (frontendAttachmentValueIsBytes(input)) {
    const bytes = frontendAttachmentNormalizeBytes(/** @type {Uint8Array | Buffer | ArrayBuffer} */ (input))

    return {
      contentBase64: frontendAttachmentBytesToBase64(bytes),
      contentType: null,
      filename: "attachment.bin"
    }
  }

  throw new Error("Unsupported frontend attachment input")
}

/**
 * Frontend-model attachment helper for one attachment name.
 */
export class FrontendModelAttachmentHandle {
  /**
   * @param {object} args - Options.
   * @param {FrontendModelBase} args.model - Model instance.
   * @param {string} args.attachmentName - Attachment name.
   */
  constructor({attachmentName, model}) {
    this.model = model
    this.attachmentName = attachmentName
  }

  /**
   * @param {unknown} input - Attachment input.
   * @returns {Promise<void>} - Resolves when attached.
   */
  async attach(input) {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.model.constructor)
    const normalizedInput = await normalizeFrontendAttachmentInput(input)
    const response = await ModelClass.executeCommand("attach", {
      attachment: normalizedInput,
      attachmentName: this.attachmentName,
      id: this.model.primaryKeyValue()
    })

    this.model.assignAttributes(ModelClass.attributesFromResponse(response))
  }

  /**
   * @param {string} [attachmentId] - Optional attachment id for has-many attachments.
   * @returns {Promise<FrontendModelAttachmentDownload | null>} - Downloaded attachment payload.
   */
  async download(attachmentId) {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.model.constructor)
    /** @type {Record<string, any>} */
    const payload = {
      attachmentName: this.attachmentName,
      id: this.model.primaryKeyValue()
    }

    if (attachmentId) {
      payload.attachmentId = attachmentId
    }

    const response = await ModelClass.executeCommand("download", payload)
    const attachmentPayload = response.attachment

    if (!attachmentPayload || typeof attachmentPayload !== "object") return null

    const contentBase64 = typeof attachmentPayload.contentBase64 === "string" ? attachmentPayload.contentBase64 : ""
    const content = frontendAttachmentBase64ToBytes(contentBase64)
    const byteSize = Number(attachmentPayload.byteSize)

    return new FrontendModelAttachmentDownload({
      byteSize: Number.isFinite(byteSize) ? byteSize : content.length,
      content,
      contentType: typeof attachmentPayload.contentType === "string" && attachmentPayload.contentType.length > 0 ? attachmentPayload.contentType : null,
      filename: typeof attachmentPayload.filename === "string" && attachmentPayload.filename.length > 0 ? attachmentPayload.filename : "attachment.bin",
      id: typeof attachmentPayload.id === "string" ? attachmentPayload.id : "",
      url: typeof attachmentPayload.url === "string" && attachmentPayload.url.length > 0 ? attachmentPayload.url : null
    })
  }

  /**
   * @param {string} [attachmentId] - Optional attachment id for has-many attachments.
   * @returns {Promise<string | null>} - Resolvable attachment URL.
   */
  async url(attachmentId) {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.model.constructor)
    /** @type {Record<string, any>} */
    const payload = {
      attachmentName: this.attachmentName,
      id: this.model.primaryKeyValue()
    }

    if (attachmentId) {
      payload.attachmentId = attachmentId
    }

    const response = await ModelClass.executeCommand("url", payload)

    if (typeof response.url === "string" && response.url.length > 0) {
      return response.url
    }

    return null
  }

  /**
   * @returns {string} - Download URL for this attachment on the configured backend.
   */
  downloadUrl() {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.model.constructor)
    const commandName = ModelClass.commandName("download")
    const resourcePath = ModelClass.resourcePath()
    const commandUrl = frontendModelCommandUrl(resourcePath, commandName)
    const params = new URLSearchParams({
      attachmentName: this.attachmentName,
      id: String(this.model.primaryKeyValue())
    })

    return `${commandUrl}?${params.toString()}`
  }
}

/**
 * @param {string | undefined | null} value - URL candidate.
 * @returns {string} - Normalized URL without trailing slash.
 */
function normalizeFrontendModelTransportUrl(value) {
  if (typeof value !== "string") return ""

  const trimmed = value.trim()

  if (!trimmed.length) return ""

  return trimmed.replace(/\/+$/, "")
}

/**
 * @returns {string} - Resolved frontend-model transport URL.
 */
function frontendModelTransportUrl() {
  const configuredUrl = typeof frontendModelTransportConfig.url === "function"
    ? frontendModelTransportConfig.url()
    : frontendModelTransportConfig.url

  return normalizeFrontendModelTransportUrl(configuredUrl)
}

/**
 * @param {Record<string, any>} value - Attributes hash.
 * @returns {Record<string, any>} - Cloned attributes hash.
 */
function cloneFrontendModelAttributes(value) {
  return /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(serializeFrontendModelTransportValue(value)))
}

/**
 * @param {string} resourcePath - Resource path prefix.
 * @param {string} commandName - Command path segment.
 * @returns {string} - Frontend model API URL.
 */
function frontendModelCommandUrl(resourcePath, commandName) {
  const configuredUrl = frontendModelTransportUrl()
  const normalizedResourcePath = resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`

  return `${configuredUrl}${normalizedResourcePath}/${commandName}`
}

/**
 * @returns {string} - Shared frontend-model API URL.
 */
function frontendModelApiUrl() {
  return `${frontendModelTransportUrl()}${SHARED_FRONTEND_MODEL_API_PATH}`
}

/**
 * @param {string} url - Request URL or path.
 * @returns {string} - Websocket-safe request path.
 */
function frontendModelTransportPath(url) {
  if (typeof url !== "string" || url.length < 1) {
    throw new Error(`Expected frontend model transport URL/path, got: ${url}`)
  }

  if (url.startsWith("/")) {
    return url
  }

  try {
    const parsedUrl = new URL(url)

    return `${parsedUrl.pathname}${parsedUrl.search}`
  } catch {
    return url
  }
}

/**
 * @param {Record<string, any>} requestPayload - Shared request payload.
 * @returns {Promise<Record<string, any>>} - Decoded shared frontend-model API response.
 */
async function performSharedFrontendModelApiRequest(requestPayload) {
  const serializedRequestPayload = serializeFrontendModelTransportValue(requestPayload)
  const websocketClient = frontendModelTransportConfig.websocketClient
  const url = frontendModelApiUrl()

  if (websocketClient) {
    const response = await websocketClient.post(frontendModelTransportPath(url), serializedRequestPayload, {
      headers: {
        "Content-Type": "application/json"
      }
    })
    const responseJson = response.json()

    return /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(responseJson))
  }

  const response = await fetch(url, {
    body: JSON.stringify(serializedRequestPayload),
    credentials: frontendModelTransportConfig.credentials,
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  })

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for shared frontend model API`)
  }

  const responseText = await response.text()
  const json = responseText.length > 0 ? JSON.parse(responseText) : {}

  return /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(json))
}

/**
 * @returns {Promise<void>} - Resolves after pending shared frontend-model requests flush.
 */
async function flushPendingSharedFrontendModelRequests() {
  sharedFrontendModelFlushScheduled = false

  if (pendingSharedFrontendModelRequests.length < 1) return

  const batchedRequests = pendingSharedFrontendModelRequests
  pendingSharedFrontendModelRequests = []

  const url = frontendModelApiUrl()
  const requestPayload = {
    requests: batchedRequests.map((request) => {
      if (request.customPath) {
        return {
          commandType: request.commandType,
          customPath: request.customPath,
          model: request.modelClass.name,
          payload: request.payload,
          requestId: request.requestId
        }
      }

      const isCustomCommandRoute = request.commandName && request.commandName !== request.commandType && request.resourcePath
      const customPath = isCustomCommandRoute
        ? `${request.resourcePath}/${request.commandName}`
        : undefined

      return {
        commandType: isCustomCommandRoute ? request.commandName : request.commandType,
        customPath,
        model: request.modelClass.name,
        payload: request.payload,
        requestId: request.requestId
      }
    })
  }

  try {
    void url
    const decodedResponse = await performSharedFrontendModelApiRequest(requestPayload)
    const responses = Array.isArray(decodedResponse.responses) ? decodedResponse.responses : []
    const responsesById = new Map(responses.map((entry) => [entry.requestId, entry.response]))

    for (const request of batchedRequests) {
      const responsePayload = responsesById.get(request.requestId)

      if (!responsePayload || typeof responsePayload !== "object") {
        request.reject(new Error(`Missing batched response for ${request.modelClass.name}#${request.commandType}`))
        continue
      }

      request.resolve(/** @type {Record<string, any>} */ (responsePayload))
    }
  } catch (error) {
    for (const request of batchedRequests) {
      request.reject(error)
    }
  }
}

/** @returns {void} */
function scheduleSharedFrontendModelRequestFlush() {
  if (sharedFrontendModelFlushScheduled) return

  sharedFrontendModelFlushScheduled = true
  queueMicrotask(() => {
    void flushPendingSharedFrontendModelRequests()
  })
}

/**
 * @param {string} modelName - Model class name.
 * @returns {string} - Frontend-model websocket subscription channel.
 */
function frontendModelSubscriptionChannelName(modelName) {
  void modelName

  return "frontend-models"
}

/**
 * Custom commands still use the shared frontend-model API. This helper only builds the backend route path the server should dispatch after validating the segments.
 * @param {object} args - Arguments.
 * @param {string} args.commandName - Command path segment.
 * @param {string} args.modelName - Frontend model class name.
 * @param {string | number | null | undefined} [args.memberId] - Optional member id.
 * @param {string} args.resourcePath - Resource path prefix.
 * @returns {string} - Custom backend route path.
 */
function frontendModelCustomCommandPath({commandName, memberId, modelName, resourcePath}) {
  const validatedResourcePath = validateFrontendModelResourcePath({modelName, resourcePath})
  const validatedCommandName = validateFrontendModelResourceCommandName({commandName, commandType: commandName, modelName})

  if (memberId === undefined || memberId === null || memberId === "") {
    return `${validatedResourcePath}/${validatedCommandName}`
  }

  return `${validatedResourcePath}/${encodeURIComponent(String(memberId))}/${validatedCommandName}`
}

/**
 * @param {Record<string, any>} conditions - findBy conditions.
 * @returns {Record<string, any>} - JSON-normalized conditions.
 */
function normalizeFindConditions(conditions) {
  try {
    return /** @type {Record<string, any>} */ (JSON.parse(JSON.stringify(conditions)))
  } catch (error) {
    throw new Error(`findBy conditions could not be serialized: ${error instanceof Error ? error.message : String(error)}`, {cause: error})
  }
}

/**
 * @param {unknown} conditions - findBy conditions.
 * @returns {void}
 */
function assertFindByConditionsShape(conditions) {
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) {
    throw new Error(`findBy expects conditions to be a plain object, got: ${conditions}`)
  }

  const conditionsPrototype = Object.getPrototypeOf(conditions)

  if (conditionsPrototype !== Object.prototype && conditionsPrototype !== null) {
    throw new Error(`findBy expects conditions to be a plain object, got: ${conditions}`)
  }

  const symbolKeys = Object.getOwnPropertySymbols(conditions)

  if (symbolKeys.length > 0) {
    throw new Error(`findBy does not support symbol condition keys (keys: ${symbolKeys.map((key) => key.toString()).join(", ")})`)
  }
}

/**
 * @param {unknown} value - Condition value to validate.
 * @param {string} keyPath - Key path for error output.
 * @returns {void}
 */
function assertDefinedFindByConditionValue(value, keyPath) {
  if (value === undefined) {
    throw new Error(`findBy does not support undefined condition values (key: ${keyPath})`)
  }

  if (typeof value === "function") {
    throw new Error(`findBy does not support function condition values (key: ${keyPath})`)
  }

  if (typeof value === "symbol") {
    throw new Error(`findBy does not support symbol condition values (key: ${keyPath})`)
  }

  if (typeof value === "bigint") {
    throw new Error(`findBy does not support bigint condition values (key: ${keyPath})`)
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`findBy does not support non-finite number condition values (key: ${keyPath})`)
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertDefinedFindByConditionValue(entry, `${keyPath}[${index}]`)
    })
    return
  }

  if (value && typeof value === "object") {
    if (value instanceof Date) {
      return
    }

    const objectValue = /** @type {Record<string, unknown>} */ (value)
    const prototype = Object.getPrototypeOf(objectValue)

    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`findBy does not support non-plain object condition values (key: ${keyPath})`)
    }

    const symbolKeys = Object.getOwnPropertySymbols(objectValue)

    if (symbolKeys.length > 0) {
      throw new Error(`findBy does not support symbol condition keys (key: ${keyPath})`)
    }

    const valueObject = /** @type {Record<string, unknown>} */ (value)

    Object.keys(valueObject).forEach((nestedKey) => {
      assertDefinedFindByConditionValue(valueObject[nestedKey], `${keyPath}.${nestedKey}`)
    })
  }
}

/**
 * @param {unknown} originalValue - Original condition value.
 * @param {unknown} normalizedValue - JSON-normalized condition value.
 * @param {string} keyPath - Key path for error output.
 * @returns {void}
 */
function assertFindByConditionSerializationPreservesValue(originalValue, normalizedValue, keyPath) {
  if (originalValue === null) {
    if (normalizedValue !== null) {
      throw new Error(`findBy condition changed during serialization (key: ${keyPath})`)
    }

    return
  }

  if (Array.isArray(originalValue)) {
    if (!Array.isArray(normalizedValue)) {
      throw new Error(`findBy condition changed during serialization (key: ${keyPath})`)
    }

    if (originalValue.length !== normalizedValue.length) {
      throw new Error(`findBy condition changed during serialization (key: ${keyPath})`)
    }

    for (let index = 0; index < originalValue.length; index += 1) {
      assertFindByConditionSerializationPreservesValue(originalValue[index], normalizedValue[index], `${keyPath}[${index}]`)
    }

    return
  }

  if (originalValue instanceof Date) {
    if (typeof normalizedValue !== "string") {
      throw new Error(`findBy condition changed during serialization (key: ${keyPath})`)
    }

    return
  }

  if (originalValue && typeof originalValue === "object") {
    if (!normalizedValue || typeof normalizedValue !== "object" || Array.isArray(normalizedValue)) {
      throw new Error(`findBy condition changed during serialization (key: ${keyPath})`)
    }

    const normalizedObject = /** @type {Record<string, unknown>} */ (normalizedValue)
    const originalObject = /** @type {Record<string, unknown>} */ (originalValue)

    Object.keys(originalObject).forEach((nestedKey) => {
      if (!(nestedKey in normalizedObject)) {
        throw new Error(`findBy condition key was removed during serialization (key: ${keyPath}.${nestedKey})`)
      }

      assertFindByConditionSerializationPreservesValue(originalObject[nestedKey], normalizedObject[nestedKey], `${keyPath}.${nestedKey}`)
    })

    return
  }

  if (normalizedValue !== originalValue) {
    throw new Error(`findBy condition changed during serialization (key: ${keyPath})`)
  }
}

/** Base class for generated frontend model classes. */
export default class FrontendModelBase {
  /**
   * @param {Record<string, any>} [attributes] - Initial attributes.
   */
  constructor(attributes = {}) {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.constructor)

    ModelClass.ensureGeneratedAttachmentMethods()
    this._attributes = {}
    this._relationships = {}
    this._attachments = {}
    this._selectedAttributes = null
    this._isNewRecord = true
    this._persistedAttributes = {}
    this.assignAttributes(attributes)
  }

  /**
   * @this {typeof FrontendModelBase}
   * @returns {void} - Ensures attachment helper methods exist on the prototype.
   */
  static ensureGeneratedAttachmentMethods() {
    if (this._generatedAttachmentMethods) return

    const attachments = this.attachmentDefinitions()

    for (const attachmentName of Object.keys(attachments)) {
      if (!(attachmentName in this.prototype)) {
        this.prototype[attachmentName] = function() {
          return this.getAttachmentByName(attachmentName)
        }
      }
    }

    this._generatedAttachmentMethods = true
  }

  /**
   * @returns {FrontendModelResourceConfig} - Resource configuration.
   */
  static resourceConfig() {
    throw new Error("resourceConfig() must be implemented by subclasses")
    // eslint-disable-next-line no-unreachable
    return {}
  }

  /**
   * @this {typeof FrontendModelBase}
   * @returns {Record<string, typeof FrontendModelBase | string>} - Relationship model classes (or class name strings) keyed by relationship name.
   */
  static relationshipModelClasses() {
    return {}
  }

  /**
   * Register a frontend model class so it can be resolved by name in relationship lookups.
   * @param {typeof FrontendModelBase} modelClass - Model class to register.
   * @returns {void}
   */
  static registerModel(modelClass) {
    registerFrontendModel(modelClass)
  }

  /**
   * Resolve a relationship model class value that may be a class reference or a string name.
   * @param {typeof FrontendModelBase | string | null | undefined} value - Class or class name.
   * @returns {typeof FrontendModelBase | null} - Resolved model class.
   */
  static resolveModelClass(value) {
    return resolveFrontendModelClass(value)
  }

  /**
   * @this {typeof FrontendModelBase}
   * @returns {Record<string, {type: "belongsTo" | "hasOne" | "hasMany"}>} - Relationship definitions keyed by relationship name.
   */
  static relationshipDefinitions() {
    return {}
  }

  /**
   * @this {typeof FrontendModelBase}
   * @returns {Record<string, FrontendModelAttachmentDefinition>} - Attachment definitions keyed by attachment name.
   */
  static attachmentDefinitions() {
    return this.resourceConfig().attachments || {}
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {string} attachmentName - Attachment name.
   * @returns {FrontendModelAttachmentDefinition | null} - Attachment definition.
   */
  static attachmentDefinition(attachmentName) {
    return this.attachmentDefinitions()[attachmentName] || null
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {string} relationshipName - Relationship name.
   * @returns {{type: "belongsTo" | "hasOne" | "hasMany"} | null} - Relationship definition.
   */
  static relationshipDefinition(relationshipName) {
    const definitions = this.relationshipDefinitions()

    return definitions[relationshipName] || null
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {string} relationshipName - Relationship name.
   * @returns {typeof FrontendModelBase | null} - Target relationship model class.
   */
  static relationshipModelClass(relationshipName) {
    const relationshipModelClasses = this.relationshipModelClasses()
    const value = relationshipModelClasses[relationshipName]

    return FrontendModelBase.resolveModelClass(value)
  }

  /**
   * @returns {Record<string, any>} - Attributes hash.
   */
  attributes() {
    return this._attributes
  }

  /**
   * @returns {boolean} - Whether this model has not yet been persisted.
   */
  isNewRecord() {
    return this._isNewRecord
  }

  /**
   * @returns {boolean} - Whether this model has been persisted.
   */
  isPersisted() {
    return !this.isNewRecord()
  }

  /**
   * @param {boolean} newIsNewRecord - New persisted-state flag.
   * @returns {void}
   */
  setIsNewRecord(newIsNewRecord) {
    this._isNewRecord = newIsNewRecord
  }

  /**
   * @returns {Record<string, any[]>} - Changed attributes as `[oldValue, newValue]`.
   */
  changes() {
    /** @type {Record<string, any[]>} */
    const changedAttributes = {}
    const attributeNames = new Set([
      ...Object.keys(this._persistedAttributes),
      ...Object.keys(this._attributes)
    ])

    for (const attributeName of attributeNames) {
      const previousValue = this._persistedAttributes[attributeName]
      const currentValue = this._attributes[attributeName]

      if (serializeFrontendModelTransportValue(previousValue) !== serializeFrontendModelTransportValue(currentValue)) {
        changedAttributes[attributeName] = [previousValue, currentValue]
      }
    }

    return changedAttributes
  }

  /**
   * @returns {boolean} - Whether any tracked attribute has changed.
   */
  isChanged() {
    return Object.keys(this.changes()).length > 0
  }

  /**
   * @param {string} relationshipName - Relationship name.
   * @returns {FrontendModelHasManyRelationship<any, any> | FrontendModelSingularRelationship<any, any>} - Relationship state object.
   */
  getRelationshipByName(relationshipName) {
    if (!this._relationships[relationshipName]) {
      const ModelClass = /** @type {typeof FrontendModelBase} */ (this.constructor)
      const relationshipDefinition = ModelClass.relationshipDefinition(relationshipName)
      const targetModelClass = ModelClass.relationshipModelClass(relationshipName)

      if (relationshipDefinition && relationshipTypeIsCollection(relationshipDefinition.type)) {
        this._relationships[relationshipName] = new FrontendModelHasManyRelationship(this, relationshipName, targetModelClass)
      } else {
        this._relationships[relationshipName] = new FrontendModelSingularRelationship(this, relationshipName, targetModelClass)
      }
    }

    return this._relationships[relationshipName]
  }

  /**
   * @param {string} attachmentName - Attachment name.
   * @returns {FrontendModelAttachmentHandle} - Attachment helper.
   */
  getAttachmentByName(attachmentName) {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.constructor)
    const attachmentDefinition = ModelClass.attachmentDefinition(attachmentName)

    if (!attachmentDefinition) {
      throw new Error(`Unknown attachment: ${ModelClass.name}#${attachmentName}`)
    }

    if (!this._attachments[attachmentName]) {
      this._attachments[attachmentName] = new FrontendModelAttachmentHandle({
        attachmentName,
        model: this
      })
    }

    return this._attachments[attachmentName]
  }

  /**
   * @param {string} relationshipName - Relationship name.
   * @returns {Promise<any>} - Loaded relationship value.
   */
  async loadRelationship(relationshipName) {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.constructor)
    const id = this.primaryKeyValue()
    const reloadedModel = await ModelClass
      .preload([relationshipName])
      .find(id)
    const loadedValue = reloadedModel.getRelationshipByName(relationshipName).loaded()

    this.getRelationshipByName(relationshipName).setLoaded(loadedValue)

    return loadedValue
  }

  /**
   * @param {string} relationshipName - Relationship name.
   * @param {any} relationshipValue - Relationship value.
   * @returns {any} - Assigned relationship value.
   */
  setRelationship(relationshipName, relationshipValue) {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.constructor)
    const relationshipDefinition = ModelClass.relationshipDefinition(relationshipName)

    if (!relationshipDefinition) {
      throw new Error(`Unknown relationship: ${ModelClass.name}#${relationshipName}`)
    }

    if (relationshipTypeIsCollection(relationshipDefinition.type)) {
      throw new Error(`Cannot set has-many relationship with setRelationship(): ${ModelClass.name}#${relationshipName}`)
    }

    this.getRelationshipByName(relationshipName).setLoaded(relationshipValue)

    return relationshipValue
  }

  /**
   * @param {Record<string, any>} attributes - Attributes to assign.
   * @returns {void} - No return value.
   */
  assignAttributes(attributes) {
    for (const key in attributes) {
      this.setAttribute(key, attributes[key])
    }
  }

  /**
   * @returns {void} - Clears cached relationship state.
   */
  clearRelationshipCache() {
    this._relationships = {}
  }

  /**
   * @this {typeof FrontendModelBase}
   * @returns {string} - Primary key name.
   */
  static primaryKey() {
    return this.resourceConfig().primaryKey || "id"
  }

  /**
   * @returns {number | string} - Primary key value.
   */
  primaryKeyValue() {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.constructor)
    const value = this.readAttribute(ModelClass.primaryKey())

    if (value === undefined || value === null) {
      throw new Error(`Missing primary key '${ModelClass.primaryKey()}' on ${ModelClass.name}`)
    }

    return value
  }

  /**
   * @param {string} attributeName - Attribute name.
   * @returns {any} - Attribute value.
   */
  readAttribute(attributeName) {
    if (this._selectedAttributes && !this._selectedAttributes.has(attributeName)) {
      throw new AttributeNotSelectedError(this.constructor.name, attributeName)
    }

    return this._attributes[attributeName]
  }

  /**
   * @param {string} attributeName - Attribute name.
   * @param {any} newValue - New value.
   * @returns {any} - Assigned value.
   */
  setAttribute(attributeName, newValue) {
    const previousValue = this._attributes[attributeName]

    this._attributes[attributeName] = newValue

    if (this._selectedAttributes) {
      this._selectedAttributes.add(attributeName)
    }

    if (!Object.is(previousValue, newValue)) {
      this.clearRelationshipCache()
    }

    return newValue
  }

  /**
   * @this {typeof FrontendModelBase}
   * @returns {string} - Resource path.
   */
  static resourcePath() {
    const path = this.resourceConfig().path || defaultFrontendModelResourcePath(this)

    return validateFrontendModelResourcePath({
      modelName: this.name,
      resourcePath: path
    })
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {FrontendModelCommandType} commandType - Command type.
   * @returns {string} - Resolved command name.
   */
  static commandName(commandType) {
    const resourceConfig = this.resourceConfig()
    const builtInCollectionCommands = resourceConfig.builtInCollectionCommands || {}
    const builtInMemberCommands = resourceConfig.builtInMemberCommands || {}
    const commands = resourceConfig.commands || {}
    const commandName = builtInCollectionCommands[commandType] ?? builtInMemberCommands[commandType] ?? commands[commandType] ?? commandType

    return validateFrontendModelResourceCommandName({
      commandName,
      commandType,
      modelName: this.name
    })
  }

  /**
   * @this {typeof FrontendModelBase}
   * @returns {string} - Backend model name used by frontend model API requests.
   */
  static modelNameForRequest() {
    const modelName = this.resourceConfig().modelName

    if (typeof modelName === "string" && modelName.length > 0) return modelName

    return this.name
  }

  /**
   * @param {FrontendModelTransportConfig} config - Frontend model transport configuration.
   * @returns {void} - No return value.
   */
  static configureTransport(config) {
    if (!config || typeof config !== "object") {
      return
    }

    if (Object.prototype.hasOwnProperty.call(config, "credentials")) {
      frontendModelTransportConfig.credentials = config.credentials
    }

    if (Object.prototype.hasOwnProperty.call(config, "url")) {
      frontendModelTransportConfig.url = config.url
    }

    if (Object.prototype.hasOwnProperty.call(config, "shared")) {
      frontendModelTransportConfig.shared = config.shared
    }

    if (Object.prototype.hasOwnProperty.call(config, "websocketClient")) {
      frontendModelTransportConfig.websocketClient = config.websocketClient
    }

    if (Object.prototype.hasOwnProperty.call(config, "request")) {
      frontendModelTransportConfig.request = config.request
    }
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {object} response - Response payload.
   * @returns {Record<string, any>} - Attributes from payload.
   */
  static attributesFromResponse(response) {
    const modelData = this.modelDataFromResponse(response)

    return modelData.attributes
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {object} response - Response payload.
   * @returns {{attributes: Record<string, any>, preloadedRelationships: Record<string, any>, selectedAttributes: string[] | null}} - Attributes and preload/select payload.
   */
  static modelDataFromResponse(response) {
    if (!response || typeof response !== "object") {
      throw new Error(`Expected object response but got: ${response}`)
    }

    /** @type {Record<string, any>} */
    let modelData

    if (response.model && typeof response.model === "object") {
      modelData = response.model
    } else if (response.attributes && typeof response.attributes === "object") {
      modelData = response.attributes
    } else {
      modelData = /** @type {Record<string, any>} */ (response)
    }

    const attributes = {...modelData}
    const preloadedRelationships = isPlainObject(attributes[PRELOADED_RELATIONSHIPS_KEY])
      ? /** @type {Record<string, any>} */ (attributes[PRELOADED_RELATIONSHIPS_KEY])
      : {}
    const selectedAttributesFromPayload = Array.isArray(attributes[SELECTED_ATTRIBUTES_KEY])
      ? /** @type {string[]} */ (attributes[SELECTED_ATTRIBUTES_KEY]).filter((attributeName) => typeof attributeName === "string")
      : null

    delete attributes[PRELOADED_RELATIONSHIPS_KEY]
    delete attributes[SELECTED_ATTRIBUTES_KEY]

    const selectedAttributes = selectedAttributesFromPayload || Object.keys(attributes)

    return {attributes, preloadedRelationships, selectedAttributes}
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {FrontendModelBase} model - Model instance.
   * @param {Record<string, any>} preloadedRelationships - Preloaded relationship payload.
   * @returns {void}
   */
  static applyPreloadedRelationships(model, preloadedRelationships) {
    for (const [relationshipName, relationshipPayload] of Object.entries(preloadedRelationships)) {
      const relationship = model.getRelationshipByName(relationshipName)
      const targetModelClass = this.relationshipModelClass(relationshipName)

      if (Array.isArray(relationshipPayload)) {
        relationship.setLoaded(relationshipPayload.map((entry) => this.instantiateRelationshipValue(entry, targetModelClass)))
        continue
      }

      relationship.setLoaded(this.instantiateRelationshipValue(relationshipPayload, targetModelClass))
    }
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {any} relationshipPayload - Relationship payload value.
   * @param {typeof FrontendModelBase | null} targetModelClass - Target model class.
   * @returns {any} - Instantiated relationship value.
   */
  static instantiateRelationshipValue(relationshipPayload, targetModelClass) {
    if (!targetModelClass) return relationshipPayload

    if (!relationshipPayload || typeof relationshipPayload !== "object") return relationshipPayload

    return targetModelClass.instantiateFromResponse(relationshipPayload)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any>} response - Response payload.
   * @returns {InstanceType<T>} - New model instance.
   */
  static instantiateFromResponse(response) {
    const modelData = this.modelDataFromResponse(response)
    const attributes = modelData.attributes
    const preloadedRelationships = modelData.preloadedRelationships
    const selectedAttributes = modelData.selectedAttributes
    const model = /** @type {InstanceType<T>} */ (new this(attributes))
    model._selectedAttributes = selectedAttributes ? new Set(selectedAttributes) : null

    this.applyPreloadedRelationships(model, preloadedRelationships)
    model.setIsNewRecord(false)
    model._persistedAttributes = cloneFrontendModelAttributes(model.attributes())

    return model
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {number | string} id - Record identifier.
   * @returns {Promise<InstanceType<T>>} - Resolved model.
   */
  static async find(id) {
    return await this.query().find(id)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any>} conditions - Attribute match conditions.
   * @returns {Promise<InstanceType<T> | null>} - Found model or null.
   */
  static async findBy(conditions) {
    return await this.query().findBy(conditions)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any>} conditions - Attribute match conditions.
   * @returns {Promise<InstanceType<T>>} - Found model.
   */
  static async findByOrFail(conditions) {
    return await this.query().findByOrFail(conditions)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
   */
  static async toArray() {
    return await this.query().toArray()
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @returns {FrontendModelQuery<T>} - Query builder.
   */
  static all() {
    return this.query()
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any>} conditions - Root-model where conditions.
   * @returns {import("./query.js").default<T>} - Query with where conditions.
   */
  static where(conditions) {
    return this.query().where(conditions)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any> | Array<Record<string, any>>} joins - Relationship descriptor joins.
   * @returns {import("./query.js").default<T>} - Query with joins.
   */
  static joins(joins) {
    return this.query().joins(joins)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {number} value - Maximum number of records.
   * @returns {import("./query.js").default<T>} - Query with limit.
   */
  static limit(value) {
    return this.query().limit(value)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {number} value - Number of records to skip.
   * @returns {import("./query.js").default<T>} - Query with offset.
   */
  static offset(value) {
    return this.query().offset(value)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {number} pageNumber - 1-based page number.
   * @returns {import("./query.js").default<T>} - Query with page applied.
   */
  static page(pageNumber) {
    return this.query().page(pageNumber)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {number} value - Number of records per page.
   * @returns {import("./query.js").default<T>} - Query with page size.
   */
  static perPage(value) {
    return this.query().perPage(value)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @returns {Promise<number>} - Number of loaded model instances.
   */
  static async count() {
    return await this.query().count()
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {(payload: {action: "create" | "destroy" | "update", id: string, model: InstanceType<typeof FrontendModelBase> | null, modelName: string}) => void} callback - Event callback.
   * @returns {Promise<() => void>} - Unsubscribe callback once the subscription is active.
   */
  static async subscribeToEvents(callback) {
    const websocketClient = frontendModelTransportConfig.websocketClient

    if (!websocketClient || typeof websocketClient.subscribe !== "function") {
      throw new Error("Frontend model websocket subscriptions require configureTransport({websocketClient})")
    }

    const subscribeMethod = typeof websocketClient.subscribeAndWait === "function"
      ? websocketClient.subscribeAndWait.bind(websocketClient)
      : websocketClient.subscribe.bind(websocketClient)

    return await subscribeMethod(frontendModelSubscriptionChannelName(this.name), {
      params: {model: this.name}
    }, (rawPayload) => {
      const payload = /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(rawPayload))

      if (payload.model !== this.name) return
      if (payload.action !== "create" && payload.action !== "destroy" && payload.action !== "update") return

      const model = payload.record && typeof payload.record === "object"
        ? this.instantiateFromResponse(/** @type {Record<string, any>} */ (payload.record))
        : null

      callback({
        action: payload.action,
        id: String(payload.id),
        model,
        modelName: this.name
      })
    })
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {...(string | string[] | Record<string, any> | Array<Record<string, any>>)} columns - Pluck definition(s).
   * @returns {Promise<any[]>} - Plucked values.
   */
  static async pluck(...columns) {
    return await this.query().pluck(...columns)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {string[]} path - Relationship path.
   * @param {string} column - Column or attribute name.
   * @param {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | ">" | ">=" | "<" | "<="} operator - Search operator.
   * @param {any} value - Search value.
   * @returns {FrontendModelQuery<T>} - Query builder with search filter.
   */
  static search(path, column, operator, value) {
    return this.query().search(path, column, operator, value)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any>} params - Ransack-style params hash.
   * @returns {FrontendModelQuery<T>} - Query builder with Ransack filters applied.
   */
  static ransack(params) {
    return this.query().ransack(params)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {string | string[] | [string, string] | Array<[string, string]> | Record<string, any> | Array<Record<string, any>>} sort - Sort definition(s).
   * @returns {FrontendModelQuery<T>} - Query builder with sort definitions.
   */
  static sort(sort) {
    return this.query().sort(sort)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {string | string[] | [string, string] | Array<[string, string]> | Record<string, any> | Array<Record<string, any>>} sort - Sort definition(s).
   * @returns {FrontendModelQuery<T>} - Query builder with sort definitions.
   */
  static order(sort) {
    return this.query().order(sort)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {string | string[] | Record<string, any> | Array<Record<string, any>>} group - Group definition(s).
   * @returns {FrontendModelQuery<T>} - Query builder with group definitions.
   */
  static group(group) {
    return this.query().group(group)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {boolean} [value] - Whether to request distinct rows.
   * @returns {FrontendModelQuery<T>} - Query builder with distinct flag.
   */
  static distinct(value = true) {
    return this.query().distinct(value)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @returns {FrontendModelQuery<T>} - Query builder.
   */
  static query() {
    return /** @type {FrontendModelQuery<T>} */ (new FrontendModelQuery({modelClass: this}))
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {import("../database/query/index.js").NestedPreloadRecord | string | string[]} preload - Preload graph.
   * @returns {FrontendModelQuery<T>} - Query with preload.
   */
  static preload(preload) {
    return /** @type {FrontendModelQuery<T>} */ (this.query().preload(preload))
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, string[] | string>} select - Model-aware attribute select map.
   * @returns {FrontendModelQuery<T>} - Query with selected attributes.
   */
  static select(select) {
    return /** @type {FrontendModelQuery<T>} */ (this.query().select(select))
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @returns {Promise<InstanceType<T> | null>} - First model or null.
   */
  static async first() {
    return await this.query().first()
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @returns {Promise<InstanceType<T> | null>} - Last model or null.
   */
  static async last() {
    return await this.query().last()
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any>} conditions - Attribute match conditions.
   * @returns {Promise<InstanceType<T>>} - Existing or initialized model.
   */
  static async findOrInitializeBy(conditions) {
    return await this.query().findOrInitializeBy(conditions)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any>} conditions - Attribute match conditions.
   * @param {(model: InstanceType<T>) => Promise<void> | void} [callback] - Optional callback before save when created.
   * @returns {Promise<InstanceType<T>>} - Existing or newly created model.
   */
  static async findOrCreateBy(conditions, callback) {
    return await this.query().findOrCreateBy(conditions, callback)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any>} [attributes] - Initial attributes.
   * @returns {Promise<InstanceType<T>>} - Persisted model.
   */
  static async create(attributes = {}) {
    const model = /** @type {InstanceType<T>} */ (new this(attributes))

    await model.save()

    return model
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {Record<string, any>} conditions - findBy conditions.
   * @returns {void}
   */
  static assertFindByConditions(conditions) {
    assertFindByConditionsShape(conditions)
    const normalizedConditions = normalizeFindConditions(conditions)

    Object.keys(conditions).forEach((key) => {
      assertDefinedFindByConditionValue(conditions[key], key)
      assertFindByConditionSerializationPreservesValue(conditions[key], normalizedConditions[key], key)
    })
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {FrontendModelBase} model - Candidate model.
   * @param {Record<string, any>} conditions - Match conditions.
   * @returns {boolean} - Whether the model matches all conditions.
   */
  static matchesFindByConditions(model, conditions) {
    const modelAttributes = model.attributes()

    for (const key of Object.keys(conditions)) {
      const expectedValue = conditions[key]
      const actualValue = modelAttributes[key]

      if (Array.isArray(expectedValue)) {
        if (Array.isArray(actualValue)) {
          if (!this.findByConditionValueMatches(actualValue, expectedValue)) {
            return false
          }
        } else if (!expectedValue.some((entry) => this.findByConditionValueMatches(actualValue, entry))) {
          return false
        }
      } else if (!this.findByConditionValueMatches(actualValue, expectedValue)) {
        return false
      }
    }

    return true
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {unknown} actualValue - Actual model value.
   * @param {unknown} expectedValue - Expected find condition value.
   * @returns {boolean} - Whether values match.
   */
  static findByConditionValueMatches(actualValue, expectedValue) {
    if (expectedValue === null) {
      return actualValue === null
    }

    if (Array.isArray(expectedValue)) {
      if (!Array.isArray(actualValue)) {
        return false
      }

      if (actualValue.length !== expectedValue.length) {
        return false
      }

      for (let index = 0; index < expectedValue.length; index += 1) {
        if (!this.findByConditionValueMatches(actualValue[index], expectedValue[index])) {
          return false
        }
      }

      return true
    }

    if (expectedValue && typeof expectedValue === "object") {
      if (!actualValue || typeof actualValue !== "object" || Array.isArray(actualValue)) {
        return false
      }

      const actualObject = /** @type {Record<string, unknown>} */ (actualValue)
      const expectedObject = /** @type {Record<string, unknown>} */ (expectedValue)
      const actualKeys = Object.keys(actualObject)
      const expectedKeys = Object.keys(expectedObject)

      if (actualKeys.length !== expectedKeys.length) {
        return false
      }

      for (const key of expectedKeys) {
        if (!Object.prototype.hasOwnProperty.call(actualObject, key)) {
          return false
        }

        if (!this.findByConditionValueMatches(actualObject[key], expectedObject[key])) {
          return false
        }
      }

      return true
    }

    if (actualValue === expectedValue) {
      return true
    }

    return this.findByPrimitiveValuesMatch(actualValue, expectedValue)
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {unknown} actualValue - Actual model value.
   * @param {unknown} expectedValue - Expected find condition value.
   * @returns {boolean} - Whether primitive values match after safe coercion.
   */
  static findByPrimitiveValuesMatch(actualValue, expectedValue) {
    if (actualValue instanceof Date && typeof expectedValue === "string") {
      return actualValue.toISOString() === expectedValue
    }

    if (typeof actualValue === "string" && expectedValue instanceof Date) {
      return actualValue === expectedValue.toISOString()
    }

    if (actualValue instanceof Date && expectedValue instanceof Date) {
      return actualValue.toISOString() === expectedValue.toISOString()
    }

    if (typeof actualValue === "number" && typeof expectedValue === "string") {
      return this.findByNumericStringMatchesNumber(expectedValue, actualValue)
    }

    if (typeof actualValue === "string" && typeof expectedValue === "number") {
      return this.findByNumericStringMatchesNumber(actualValue, expectedValue)
    }

    return false
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {string} numericString - Numeric string value.
   * @param {number} expectedNumber - Number value.
   * @returns {boolean} - Whether values represent the same number.
   */
  static findByNumericStringMatchesNumber(numericString, expectedNumber) {
    if (!Number.isFinite(expectedNumber)) {
      return false
    }

    if (!/^-?\d+(?:\.\d+)?$/.test(numericString)) {
      return false
    }

    return Number(numericString) === expectedNumber
  }

  /**
   * @param {Record<string, any>} [newAttributes] - New values to assign before update.
   * @returns {Promise<this>} - Updated model.
   */
  async update(newAttributes = {}) {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.constructor)
    const attachmentDefinitions = ModelClass.attachmentDefinitions()
    /** @type {Record<string, any>} */
    const regularAttributes = {}
    /** @type {Array<{attachmentName: string, value: unknown}>} */
    const pendingAttachments = []

    for (const [attributeName, attributeValue] of Object.entries(newAttributes)) {
      if (attachmentDefinitions[attributeName]) {
        if (attributeValue !== undefined && attributeValue !== null) {
          pendingAttachments.push({attachmentName: attributeName, value: attributeValue})
        }
      } else {
        regularAttributes[attributeName] = attributeValue
      }
    }

    if (Object.keys(regularAttributes).length > 0) {
      this.assignAttributes(regularAttributes)
      const changedAttributes = Object.fromEntries(
        Object.entries(this.changes()).map(([attributeName, [, currentValue]]) => [attributeName, currentValue])
      )

      const response = await ModelClass.executeCommand("update", {
        attributes: changedAttributes,
        id: this.primaryKeyValue()
      })

      this.assignAttributes(ModelClass.attributesFromResponse(response))
      this.setIsNewRecord(false)
      this._persistedAttributes = cloneFrontendModelAttributes(this.attributes())
    }

    for (const pendingAttachment of pendingAttachments) {
      await this.getAttachmentByName(pendingAttachment.attachmentName).attach(pendingAttachment.value)
    }

    return this
  }

  /**
   * @param {unknown} attachmentInput - Attachment input or named attachment payload.
   * @returns {Promise<void>} - Resolves when attached.
   */
  async attach(attachmentInput) {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.constructor)
    const attachmentDefinitions = ModelClass.attachmentDefinitions()
    const attachmentNames = Object.keys(attachmentDefinitions)
    let attachmentName = attachmentNames[0]
    let actualAttachmentInput = attachmentInput

    if (frontendAttachmentValueIsPlainObject(attachmentInput)) {
      if ("file" in attachmentInput && attachmentDefinitions.file) {
        attachmentName = "file"
      }

      for (const candidateName of attachmentNames) {
        if (candidateName in attachmentInput) {
          attachmentName = candidateName
          actualAttachmentInput = attachmentInput[candidateName]
          break
        }
      }
    }

    if (!attachmentName) {
      throw new Error(`No attachment definitions on ${ModelClass.name}`)
    }

    await this.getAttachmentByName(attachmentName).attach(actualAttachmentInput)
  }

  /**
   * @returns {Promise<this>} - Saved model.
   */
  async save() {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.constructor)
    const commandType = this.isNewRecord() ? "create" : "update"
    /** @type {Record<string, any>} */
    const payload = {
      attributes: this.attributes()
    }

    if (!this.isNewRecord()) {
      payload.id = this.primaryKeyValue()
    }

    const response = await ModelClass.executeCommand(commandType, payload)

    this.assignAttributes(ModelClass.attributesFromResponse(response))
    this.setIsNewRecord(false)
    this._persistedAttributes = cloneFrontendModelAttributes(this.attributes())

    return this
  }

  /**
   * @returns {Promise<void>} - Resolves when destroyed on backend.
   */
  async destroy() {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.constructor)

    await ModelClass.executeCommand("destroy", {
      id: this.primaryKeyValue()
    })
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {FrontendModelCommandType} commandType - Command type.
   * @param {Record<string, any>} payload - Command payload.
   * @returns {Promise<Record<string, any>>} - Parsed JSON response.
   */
  static async executeCommand(commandType, payload) {
    const commandName = this.commandName(commandType)
    const serializedPayload = /** @type {Record<string, any>} */ (serializeFrontendModelTransportValue(payload))
    const resourceConfig = /** @type {Record<string, any>} */ (this.resourceConfig())
    const resourcePath = typeof resourceConfig.path === "string" && resourceConfig.path.length > 0 ? this.resourcePath() : null
    const containsAttachmentUpload = frontendModelPayloadContainsAttachmentUpload(serializedPayload)
    const useSharedTransport = !containsAttachmentUpload
    const url = useSharedTransport ? frontendModelApiUrl() : frontendModelCommandUrl(resourcePath || "", commandName)

    if (frontendModelTransportConfig.request) {
      return await this.performTransportRequest({commandName, commandType, payload: serializedPayload, url})
    }

    if (useSharedTransport) {
      const batchResponse = await new Promise((resolve, reject) => {
        pendingSharedFrontendModelRequests.push({
          commandName,
          commandType,
          modelClass: this,
          payload: serializedPayload,
          reject,
          requestId: `${++sharedFrontendModelRequestId}`,
          resolve,
          resourcePath
        })

        scheduleSharedFrontendModelRequestFlush()
      })

      const decodedBatchResponse = /** @type {Record<string, any>} */ (batchResponse)

      this.throwOnErrorFrontendModelResponse({
        commandType,
        response: decodedBatchResponse
      })

      return decodedBatchResponse
    }

    const directResponse = await fetch(url, {
      body: JSON.stringify(serializedPayload),
      credentials: frontendModelTransportConfig.credentials,
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    })

    if (!directResponse.ok) {
      throw new Error(`Request failed (${directResponse.status}) for ${this.name}#${commandType}`)
    }

    const directResponseText = await directResponse.text()
    const directJson = directResponseText.length > 0 ? JSON.parse(directResponseText) : {}
    const decodedDirectResponse = /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(directJson))

    this.throwOnErrorFrontendModelResponse({
      commandType,
      response: decodedDirectResponse
    })

    return decodedDirectResponse
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {object} args - Command arguments.
   * @param {string} args.commandName - Raw command path segment.
   * @param {FrontendModelRequestCommandType} args.commandType - Logical command type for error handling.
   * @param {string | number | null} [args.memberId] - Optional member id for member-scoped commands.
   * @param {Record<string, any>} args.payload - Request payload.
   * @param {string} args.resourcePath - Direct resource path.
   * @returns {Promise<Record<string, any>>} - Decoded response payload.
   */
  static async executeCustomCommand({commandName, commandType, memberId = null, payload, resourcePath}) {
    const serializedPayload = /** @type {Record<string, any>} */ (serializeFrontendModelTransportValue(payload))
    const customPath = frontendModelCustomCommandPath({
      commandName,
      memberId,
      modelName: this.name,
      resourcePath
    })
    const url = frontendModelApiUrl()

    if (frontendModelTransportConfig.request) {
      return await this.performTransportRequest({commandName, commandType, customPath, payload: serializedPayload, url})
    }

    const batchResponse = await new Promise((resolve, reject) => {
      pendingSharedFrontendModelRequests.push({
        commandType,
        customPath,
        modelClass: this,
        payload: serializedPayload,
        reject,
        requestId: `${++sharedFrontendModelRequestId}`,
        resolve
      })

      scheduleSharedFrontendModelRequestFlush()
    })

    const decodedBatchResponse = /** @type {Record<string, any>} */ (batchResponse)

    this.throwOnErrorFrontendModelResponse({
      commandType,
      response: decodedBatchResponse
    })

    return decodedBatchResponse
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {object} args - Request arguments.
   * @param {string} args.commandName - Transport command name.
   * @param {FrontendModelRequestCommandType} args.commandType - Logical command type.
   * @param {string} [args.customPath] - Custom backend route path when bypassing built-in resource commands.
   * @param {Record<string, any>} args.payload - Serialized payload.
   * @param {string} args.url - Request URL.
   * @returns {Promise<Record<string, any>>} - Decoded response payload.
   */
  static async performTransportRequest({commandName, commandType, customPath, payload, url}) {
    const customResponse = await frontendModelTransportConfig.request({
      commandName,
      commandType,
      customPath,
      modelClass: this,
      payload,
      url
    })

    const decodedResponse = /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(customResponse))

    this.throwOnErrorFrontendModelResponse({
      commandType,
      response: decodedResponse
    })

    return decodedResponse
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {object} args - Arguments.
   * @param {FrontendModelRequestCommandType} args.commandType - Command type.
   * @param {Record<string, any>} args.response - Decoded response.
   * @returns {void}
   */
  static throwOnErrorFrontendModelResponse({commandType, response}) {
    if (response?.status !== "error") return

    const responseKeys = Object.keys(response)
    const hasOnlyStatus = responseKeys.length === 1 && responseKeys[0] === "status"
    const hasErrorMessage = typeof response.errorMessage === "string" && response.errorMessage.length > 0
    const hasErrorEnvelopeKeys = Boolean(
      response.code !== undefined
      || response.error !== undefined
      || response.errors !== undefined
      || response.message !== undefined
    )
    const nonStatusKeys = responseKeys.filter((key) => key !== "status")
    const configuredAttributeNames = this.configuredFrontendModelAttributeNames()
    const looksLikeRawModelPayload = nonStatusKeys.length > 0
      && nonStatusKeys.every((key) => configuredAttributeNames.has(key))

    if (!hasErrorMessage && !hasOnlyStatus && !hasErrorEnvelopeKeys && looksLikeRawModelPayload) return

    const errorMessage = hasErrorMessage
      ? response.errorMessage
      : `Request failed for ${this.name}#${commandType}`

    throw new Error(errorMessage)
  }

  /**
   * @this {typeof FrontendModelBase}
   * @returns {Set<string>} - Configured frontend model attribute names.
   */
  static configuredFrontendModelAttributeNames() {
    const resourceConfig = /** @type {Record<string, any>} */ (this.resourceConfig())
    const attributes = resourceConfig.attributes

    if (Array.isArray(attributes)) {
      return new Set(attributes.filter((attributeName) => typeof attributeName === "string"))
    }

    if (attributes && typeof attributes === "object") {
      return new Set(Object.keys(attributes))
    }

    return new Set()
  }
}
