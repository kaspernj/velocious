// @ts-check

import * as inflection from "inflection"
import timeout from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"
import FrontendModelQuery, {frontendModelEventOptionsPayload} from "./query.js"
import FrontendModelPreloader from "./preloader.js"
import {normalizeDateStringForWrite} from "../database/datetime-storage.js"
import {registerFrontendModel, resolveFrontendModelClass} from "./model-registry.js"
import {validateFrontendModelResourceCommandName, validateFrontendModelResourcePath} from "./resource-config-validation.js"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "./transport-serialization.js"
import runWithTransportDeadline from "./transport-deadline.js"
import {REQUEST_TIME_ZONE_HEADER, validateTimeZone} from "../time-zone.js"
import VelociousWebsocketClient from "../http-client/websocket-client.js"
import {bufferOutgoingEvent, clearBufferedOutgoingEvents, drainBufferedOutgoingEvents} from "./outgoing-event-buffer.js"
import {defineModelScope} from "../utils/model-scope.js"
import isPlainObject from "../utils/plain-object.js"
import {readPayloadAssociationCount, readPayloadComputedAbility, readPayloadQueryData, setPayloadAssociationCount, setPayloadComputedAbility, setPayloadQueryData} from "../record-payload-values.js"

/**
 * FrontendModelCommandType type.
 * @typedef {"create" | "find" | "index" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} FrontendModelCommandType */
/**
 * FrontendModelRequestCommandType type.
 * @typedef {FrontendModelCommandType | string} FrontendModelRequestCommandType */
/**
 * Model-like instance value supported by frontend-model transport.
 * @typedef {{attributes: () => Record<string, unknown>}} FrontendModelTransportModelValue
 */
/**
 * Special scalar values restored by frontend-model transport.
 * @typedef {undefined | null | boolean | number | string | bigint | Date | FrontendModelTransportModelValue} FrontendModelTransportScalarValue
 */
/**
 * Plain object supported by frontend-model transport values.
 * Nested values are intentionally opaque because TypeScript rejects recursive
 * JSDoc typedefs for this transport value contract.
 * @typedef {Record<string, unknown>} FrontendModelTransportObject
 */
/**
 * Value supported by frontend-model transport serialization and deserialization.
 * @typedef {FrontendModelTransportScalarValue | FrontendModelTransportObject | Array<unknown>} FrontendModelTransportValue
 */
/**
 * Frontend model attribute value used when generated metadata cannot infer a narrower type.
 * @typedef {FrontendModelTransportValue} FrontendModelAttributeValue
 */
/**
 * Defines this typedef.
 * @typedef {{type: "hasOne" | "hasMany"}} FrontendModelAttachmentDefinition
 */
/**
 * Defines frontend-model attribute metadata.
 * @typedef {{columnType?: string, dataType?: string, jsDocType?: string, name?: string, null?: boolean, selectedByDefault?: boolean, sqlType?: string, type?: string}} FrontendModelAttributeDefinition
 */
/**
 * Attachment input accepted by frontend-model attachment helpers before normalization.
 * @typedef {Record<string, ?> | {arrayBuffer: () => Promise<ArrayBuffer>, type?: string, name?: string} | null | undefined} FrontendModelAttachmentInput
 */
/**
 * Defines this typedef.
 * @typedef {Record<string, FrontendModelTransportValue>} FrontendModelSyncMetadata
 */
/**
 * Defines this typedef.
 * @typedef {"optimisticVersion" | "serverWins" | "lastWriterWins" | "fieldThreeWay" | "appendOnly"} FrontendModelSyncConflictStrategy
 */
/**
 * Defines this typedef.
 * @typedef {{enabled: boolean, operations: string[], policyHash: string, policyVersion: string | null, conflictStrategy?: FrontendModelSyncConflictStrategy, metadata?: FrontendModelSyncMetadata}} FrontendModelSyncConfig
 */
/**
 * Defines this typedef.
 * @typedef {{attributes?: Array<string | FrontendModelAttributeDefinition> | Record<string, FrontendModelAttributeDefinition>, builtInCollectionCommands?: string[], builtInMemberCommands?: string[], collectionCommands?: string[], commands?: string[], memberCommands?: string[], attachments?: Record<string, FrontendModelAttachmentDefinition>, modelName?: string, nestedAttributes?: Record<string, {allowDestroy?: boolean, limit?: number}>, primaryKey?: string, relationships?: string[], sync?: FrontendModelSyncConfig}} FrontendModelResourceConfig
 */
/**
 * Frontend model constructor type.
 * @template {FrontendModelBase} [T=FrontendModelBase]
 * @typedef {{new (attributes?: Record<string, FrontendModelAttributeValue>): T}} FrontendModelConstructor
 */
/**
 * Frontend model static side.
 *
 * The template defaults are intentionally permissive (`any` model/attribute
 * params). The bare `FrontendModelClass` is the `@this`/constraint type on the
 * static query methods (findBy/find/where/preload/...); a generated subclass
 * declares typed-attribute generics (e.g. `FrontendModelBase<AccountAttributes,
 * AccountCreateAttributes, AccountUpdateAttributes>`) which, against a concrete
 * `Record<string, FrontendModelTransportValue>` default, fail the constraint by
 * invariance. Defaulting to `any` lets any subclass satisfy the constraint while
 * the methods' own `@template T` still captures the precise calling class for
 * their return types.
 * @template {FrontendModelBase} [T=FrontendModelBase<any, any, any>]
 * @template {object} [Attributes=any]
 * @template {object} [CreateAttributes=any]
 * @typedef {{new (): T, create(attributes?: CreateAttributes): Promise<T>} & Omit<typeof FrontendModelBase, "create" | "prototype">} FrontendModelClass
 */
/**
 * Create attributes accepted by a frontend model instance.
 * @template {FrontendModelBase} T
 * @typedef {T extends FrontendModelBase<Record<string, FrontendModelAttributeValue>, infer CreateAttributes, infer _UpdateAttributes> ? CreateAttributes : Record<string, FrontendModelAttributeValue>} FrontendModelCreateAttributesFor
 */
/**
 * Loaded instance type for relationship helper generics. Older generated
 * frontend models passed model classes into relationship helpers, while newer
 * generated models pass instance types.
 * @template {FrontendModelBase<any, any, any> | typeof FrontendModelBase} T
 * @typedef {T extends typeof FrontendModelBase ? InstanceType<T> : T} FrontendModelRelationshipModel
 */
/**
 * FrontendModelTransportConfig type.
 * @typedef {object} FrontendModelTransportConfig
 * @property {string | (() => string | undefined | null)} [url] - Optional frontend-model URL. This should be the shared endpoint (for example `"/frontend-models"` or `"https://example.com/frontend-models"`).
 * @property {boolean} [shared] - Deprecated shared-endpoint flag retained for compatibility. Frontend-model CRUD/custom commands use the shared frontend-model API envelope by default.
 * @property {string | (() => string | undefined | null)} [websocketUrl] - Optional websocket URL. When set, Velocious creates and manages its own websocket client internally. Subscriptions use the websocket; CRUD uses HTTP and falls back gracefully. Example: `"ws://localhost:3006/websocket"`.
 * @property {{post: (path: string, body?: ?, options?: {headers?: Record<string, string>, signal?: AbortSignal}) => Promise<{json: () => ?}>, subscribe: (channel: string, options: {params?: Record<string, ?>}, callback: (payload: ?) => void) => (() => void), subscribeAndWait?: (channel: string, options: {params?: Record<string, ?>}, callback: (payload: ?) => void) => Promise<(() => void)>}} [websocketClient] - Optional websocket client for shared frontend-model API requests and subscriptions. Its `post` receives the bounded-deadline `signal` and should forward it into the underlying transport so the deadline can abort the live request and its response-body read.
 * @property {Record<string, string> | (() => Record<string, string>)} [requestHeaders] - Extra HTTP/WS headers to attach to every frontend-model API request. Pass a function to compute them at request time (for example to include the current locale).
 * @property {number | (() => number | undefined | null)} [timeout] - Bounded deadline in milliseconds covering connection, response headers, and response-body consumption for each frontend-model API request. On expiry the live fetch/adapter request is aborted (built on awaitery's `timeout`) and awaitery's `TimeoutError` is thrown, so callers can classify a timeout via `error instanceof TimeoutError`. Pass a function to resolve it per request. Falsy/absent means no deadline.
 * @property {AbortSignal | (() => AbortSignal | undefined | null)} [signal] - Optional caller/session AbortSignal composed with the deadline. Aborting it cancels the live request (for example on session shutdown or offline transition); the resulting abort error stays distinguishable from a timeout. Pass a function to resolve the current signal per request.
 * @property {{get: () => string | null | undefined | Promise<string | null | undefined>, set: (sessionId: string) => void | Promise<void>, clear: () => void | Promise<void>}} [sessionStore] - Optional sessionId persistence hook forwarded to the internal `VelociousWebsocketClient` so WS sessions can be resumed across page reloads / app restarts.
 * @property {string | (() => string | null | undefined)} [timeZone] - IANA timezone sent with every frontend-model API request for timezone-less datetime parsing.
 * @property {{actorDeviceId: string, actorUserId: string, clientMutationId?: () => string, enabled?: boolean, mutationLog: import("../sync/local-mutation-log.js").default, now?: () => Date, offlineGrant: {id: string}}} [offlineSync] - Offline mutation queue configuration.
 */
/**
 * FrontendModelIdleWaitArgs type.
 * @typedef {object} FrontendModelIdleWaitArgs
 * @property {number} [quietMs] - Milliseconds the transport must stay idle before resolving.
 * @property {number} [timeout] - Timeout in milliseconds.
 */

/**
 * Frontend model transport config.
 * @type {FrontendModelTransportConfig} */
const frontendModelTransportConfig = {}
const SHARED_FRONTEND_MODEL_API_PATH = "/frontend-models"
const PRELOADED_RELATIONSHIPS_KEY = "__preloadedRelationships"
const SELECTED_ATTRIBUTES_KEY = "__selectedAttributes"
const ASSOCIATION_COUNTS_KEY = "__associationCounts"
const QUERY_DATA_KEY = "__queryData"
const ABILITIES_KEY = "__abilities"
/**
 * Pending shared frontend model requests.
 * @type {Array<{commandName?: string, commandType: FrontendModelRequestCommandType, customPath?: string, modelClass: FrontendModelClass, payload: Record<string, ?>, requestId: string, resolve: (response: Record<string, ?>) => void, reject: (error: ?) => void, resourcePath?: string | null}>} */
let pendingSharedFrontendModelRequests = []
let sharedFrontendModelRequestId = 0
let sharedFrontendModelFlushScheduled = false
let activeFrontendModelTransportRequestCount = 0
/**
 * Frontend model idle resolvers.
 * @type {Array<() => void>} */
let frontendModelIdleResolvers = []

/**
 * Internal websocket client.
 * @type {VelociousWebsocketClient | null} */
let internalWebsocketClient = null
/** @type {AbortSignal | null} */
let internalWebsocketClientSignal = null
/** @type {(() => void) | null} */
let internalWebsocketClientSignalCleanup = null

/**
 * Disposes the owned WebSocket client before transport/session configuration changes.
 * @returns {void}
 */
function resetInternalWebsocketClient() {
  internalWebsocketClientSignalCleanup?.()
  internalWebsocketClientSignal = null
  internalWebsocketClientSignalCleanup = null

  const client = internalWebsocketClient

  internalWebsocketClient = null
  if (client) void client.disconnectAndStopReconnect()
}

/**
 * Binds the owned WebSocket client lifetime to the current session signal.
 * @param {AbortSignal | undefined} sessionSignal - Current session signal.
 * @returns {void}
 */
function bindInternalWebsocketClientSignal(sessionSignal) {
  if (internalWebsocketClientSignal === sessionSignal) return

  internalWebsocketClientSignalCleanup?.()
  internalWebsocketClientSignal = sessionSignal || null
  internalWebsocketClientSignalCleanup = null

  if (!sessionSignal || !internalWebsocketClient) return

  const client = internalWebsocketClient
  const onSessionAbort = () => {
    clearBufferedOutgoingEvents()
    void client.disconnectAndStopReconnect()
  }

  sessionSignal.addEventListener("abort", onSessionAbort, {once: true})
  internalWebsocketClientSignalCleanup = () => sessionSignal.removeEventListener("abort", onSessionAbort)

  if (sessionSignal.aborted) onSessionAbort()
}

/**
 * Runs frontend model transport is idle.
 * @returns {boolean} - Whether all queued and active frontend-model transport requests are done.
 */
function frontendModelTransportIsIdle() {
  return activeFrontendModelTransportRequestCount === 0
    && pendingSharedFrontendModelRequests.length === 0
    && !sharedFrontendModelFlushScheduled
}

/**
 * Runs resolve frontend model idle waiters.
 * @returns {void} */
function resolveFrontendModelIdleWaiters() {
  if (!frontendModelTransportIsIdle()) return

  const resolvers = frontendModelIdleResolvers
  frontendModelIdleResolvers = []

  for (const resolve of resolvers) {
    resolve()
  }
}

/**
 * Runs wait for frontend model transport quiet period.
 * @param {number} milliseconds - Quiet period length.
 * @returns {Promise<void>} Resolves after the quiet period.
 */
async function waitForFrontendModelTransportQuietPeriod(milliseconds) {
  if (milliseconds <= 0) return

  await wait(milliseconds)
}

/**
 * Runs wait for frontend model transport idle.
 * @param {number} quietMs - Milliseconds the transport must stay idle before resolving.
 * @returns {Promise<void>} Resolves when transport stays idle.
 */
async function waitForFrontendModelTransportIdle(quietMs = 0) {
  while (true) {
    if (frontendModelTransportIsIdle()) {
      await new Promise((resolve) => queueMicrotask(() => resolve(undefined)))

      if (frontendModelTransportIsIdle()) {
        await waitForFrontendModelTransportQuietPeriod(quietMs)

        if (frontendModelTransportIsIdle()) return
      }
    } else {
      await new Promise((resolve) => {
        frontendModelIdleResolvers.push(() => resolve(undefined))
      })
    }
  }
}

/**
 * Runs track frontend model transport request.
 * @template T
 * @param {() => Promise<T>} callback - Transport callback.
 * @returns {Promise<T>} - Callback result.
 */
async function trackFrontendModelTransportRequest(callback) {
  activeFrontendModelTransportRequestCount += 1

  try {
    return await callback()
  } finally {
    activeFrontendModelTransportRequestCount -= 1
    resolveFrontendModelIdleWaiters()
  }
}

/**
 * Resolve the internal websocket client from websocketUrl config.
 * Creates the client lazily on first call. Returns null if WebSocket
 * is not available or websocketUrl is not configured.
 * @returns {VelociousWebsocketClient | null} Websocket client or null.
 */
function resolveInternalWebsocketClient() {
  if (internalWebsocketClient) {
    bindInternalWebsocketClientSignal(frontendModelTransportSignal())

    return internalWebsocketClient
  }

  const websocketUrl = frontendModelTransportConfig.websocketUrl

  if (!websocketUrl) return null
  if (typeof globalThis.WebSocket === "undefined") return null

  const resolvedUrl = typeof websocketUrl === "function" ? websocketUrl() : websocketUrl

  if (!resolvedUrl) return null

  internalWebsocketClient = new VelociousWebsocketClient({
    autoReconnect: true,
    sessionStore: frontendModelTransportConfig.sessionStore,
    url: resolvedUrl
  })
  internalWebsocketClient.onReconnect = flushBufferedOutgoingEventsAfterReconnect

  bindInternalWebsocketClientSignal(frontendModelTransportSignal())

  return internalWebsocketClient
}

/**
 * Runs flush buffered outgoing events after reconnect.
 * @returns {Promise<void>} */
async function flushBufferedOutgoingEventsAfterReconnect() {
  if (!internalWebsocketClient) return

  const events = drainBufferedOutgoingEvents()
  const sessionSignal = frontendModelTransportSignal()

  await runWithTransportDeadline(
    {
      errorMessage: "Buffered frontend-model WebSocket flush timed out",
      signal: sessionSignal,
      timeoutMs: frontendModelTransportTimeoutMs()
    },
    async (signal) => {
      for (let index = 0; index < events.length; index += 1) {
        try {
          await internalWebsocketClient?.post(events[index].customPath, events[index].payload, {signal})
        } catch {
          if (sessionSignal?.aborted) return

          const socketOpen = internalWebsocketClient?.socket?.readyState === internalWebsocketClient?.socket?.OPEN

          if (socketOpen) continue

          for (let remaining = index; remaining < events.length; remaining += 1) {
            bufferOutgoingEvent(events[remaining])
          }

          return
        }
      }
    }
  )
}

/**
 * Runs default frontend model resource path.
 * @param {FrontendModelClass} modelClass - Frontend model class.
 * @returns {string} - Default resource path for the model class.
 */
function defaultFrontendModelResourcePath(modelClass) {
  return `/${inflection.dasherize(inflection.pluralize(inflection.underscore(modelClass.getModelName())))}`
}

/** Error raised when reading an attribute that was not selected in query payloads. */
export class AttributeNotSelectedError extends Error {
  /**
   * Runs constructor.
   * @param {string} modelName - Model class name.
   * @param {string} attributeName - Attribute that was requested.
   */
  constructor(modelName, attributeName) {
    super(`${modelName}#${attributeName} was not selected`)
    this.name = "AttributeNotSelectedError"
  }
}

/**
 * Lightweight singular relationship state holder for frontend model instances.
 * @template {FrontendModelBase<any, any, any> | typeof FrontendModelBase} S
 * @template {FrontendModelBase<any, any, any> | typeof FrontendModelBase} T
 * @template {object} [TargetCreateAttributes=Record<string, FrontendModelAttributeValue>]
 */
export class FrontendModelSingularRelationship {
  /**
   * Runs constructor.
   * @param {FrontendModelBase} model - Parent model.
   * @param {string} relationshipName - Relationship name.
   * @param {FrontendModelClass<FrontendModelRelationshipModel<T>, Record<string, FrontendModelAttributeValue>, TargetCreateAttributes> | null} targetModelClass - Target model class.
   */
  constructor(model, relationshipName, targetModelClass) {
    this.model = model
    this.relationshipName = relationshipName
    this.targetModelClass = targetModelClass
    this._preloaded = false
    /** @type {FrontendModelRelationshipModel<T> | null} */
    this._loadedValue = null
  }

  /**
   * Runs set loaded.
   * @param {FrontendModelRelationshipModel<T> | null | undefined} loadedValue - Loaded relationship value.
   * @returns {void}
   */
  setLoaded(loadedValue) {
    this._loadedValue = loadedValue == undefined ? null : loadedValue
    this._preloaded = true
  }

  /**
   * Runs get preloaded.
   * @returns {boolean} - Whether relationship is preloaded.
   */
  getPreloaded() {
    return this._preloaded
  }

  /**
   * Runs loaded.
   * @returns {FrontendModelRelationshipModel<T> | null} - Loaded relationship value.
   */
  loaded() {
    if (!this._preloaded) {
      throw new Error(`${this.model.constructor.name}#${this.relationshipName} hasn't been preloaded`)
    }

    return this._loadedValue
  }

  /**
   * Copies loaded value from another singular relationship helper.
   * @param {FrontendModelRelationship} sourceRelationship - Source relationship helper.
   * @returns {void}
   */
  copyLoadedFrom(sourceRelationship) {
    if (sourceRelationship instanceof FrontendModelHasManyRelationship) {
      throw new Error(`Expected ${this.model.constructor.name}#${this.relationshipName} source relationship to be singular`)
    }

    // Narrows the runtime value to the target relationship's documented model type.
    const loadedValue = /** @type {FrontendModelRelationshipModel<T> | null} */ (sourceRelationship.loaded())

    this.setLoaded(loadedValue)
  }

  /**
   * Runs build.
   * @param {TargetCreateAttributes} [attributes] - New model attributes.
   * @returns {FrontendModelRelationshipModel<T>} - Built model.
   */
  build(attributes = /** @type {TargetCreateAttributes} */ ({})) {
    if (!this.targetModelClass) {
      throw new Error(`No target model class configured for ${this.model.constructor.name}#${this.relationshipName}`)
    }

    const ModelClass = /** @type {new (attributes?: TargetCreateAttributes) => FrontendModelRelationshipModel<T>} */ (this.targetModelClass)
    const model = new ModelClass(attributes)

    this.setLoaded(model)

    return model
  }

  /**
   * Force-reload the relationship.
   * @returns {Promise<FrontendModelRelationshipModel<T> | null>} - Loaded relationship model.
   */
  async load() {
    this._preloaded = false
    this._loadedValue = null

    const batched = await this.model._tryCohortPreload(this.relationshipName)

    if (batched) return this.loaded()

    await this.model.loadRelationship(this.relationshipName)

    return this.loaded()
  }

  /**
   * Returns the loaded relationship or loads it.
   * @returns {Promise<FrontendModelRelationshipModel<T> | null>} - Loaded relationship model.
   */
  async orLoad() {
    if (this.getPreloaded()) return this.loaded()

    const batched = await this.model._tryCohortPreload(this.relationshipName)

    if (batched) return this.loaded()

    await this.model.loadRelationship(this.relationshipName)

    return this.loaded()
  }
}

/**
 * Lightweight has-many relationship state holder for frontend model instances.
 * @template {FrontendModelBase<any, any, any> | typeof FrontendModelBase} S
 * @template {FrontendModelBase<any, any, any> | typeof FrontendModelBase} T
 * @template {object} [TargetCreateAttributes=Record<string, FrontendModelAttributeValue>]
 */
export class FrontendModelHasManyRelationship {
  /**
   * Narrows the runtime value to the documented type.
   * @type {Array<FrontendModelRelationshipModel<T>>} */
  _loadedValue

  /**
   * Runs constructor.
   * @param {FrontendModelBase} model - Parent model.
   * @param {string} relationshipName - Relationship name.
   * @param {FrontendModelClass<FrontendModelRelationshipModel<T>, Record<string, FrontendModelAttributeValue>, TargetCreateAttributes> | null} targetModelClass - Target model class.
   */
  constructor(model, relationshipName, targetModelClass) {
    this.model = model
    this.relationshipName = relationshipName
    this.targetModelClass = targetModelClass
    this._preloaded = false
    this._loadedValue = []
  }

  /**
   * Runs set loaded.
   * @param {Array<FrontendModelRelationshipModel<T>>} loadedValue - Loaded relationship value.
   * @returns {void}
   */
  setLoaded(loadedValue) {
    if (!Array.isArray(loadedValue)) {
      throw new Error(`Expected ${this.model.constructor.name}#${this.relationshipName} to be loaded with an array`)
    }

    this._loadedValue = loadedValue
    this._preloaded = true
  }

  /**
   * Runs get preloaded.
   * @returns {boolean} - Whether relationship is preloaded.
   */
  getPreloaded() {
    return this._preloaded
  }

  /**
   * Runs loaded.
   * @returns {Array<FrontendModelRelationshipModel<T>>} - Loaded relationship values.
   */
  loaded() {
    if (!this._preloaded) {
      throw new Error(`${this.model.constructor.name}#${this.relationshipName} hasn't been preloaded`)
    }

    return this._loadedValue
  }

  /**
   * Copies loaded value from another has-many relationship helper.
   * @param {FrontendModelRelationship} sourceRelationship - Source relationship helper.
   * @returns {void}
   */
  copyLoadedFrom(sourceRelationship) {
    if (!(sourceRelationship instanceof FrontendModelHasManyRelationship)) {
      throw new Error(`Expected ${this.model.constructor.name}#${this.relationshipName} source relationship to be has-many`)
    }

    // Narrows the runtime value to the target relationship's documented model type.
    const loadedValue = /** @type {Array<FrontendModelRelationshipModel<T>>} */ (sourceRelationship.loaded())

    this.setLoaded(loadedValue)
  }

  /**
   * Runs add to loaded.
   * @param {Array<FrontendModelRelationshipModel<T>>} models - Models to append.
   * @returns {void}
   */
  addToLoaded(models) {
    const loadedModels = this.getPreloaded() ? this.loaded() : []

    this.setLoaded([...loadedModels, ...models])
  }

  /**
   * Runs build.
   * @param {TargetCreateAttributes} [attributes] - New model attributes.
   * @returns {FrontendModelRelationshipModel<T>} - Built model.
   */
  build(attributes = /** @type {TargetCreateAttributes} */ ({})) {
    if (!this.targetModelClass) {
      throw new Error(`No target model class configured for ${this.model.constructor.name}#${this.relationshipName}`)
    }

    const ModelClass = /** @type {new (attributes?: TargetCreateAttributes) => FrontendModelRelationshipModel<T>} */ (this.targetModelClass)
    const model = new ModelClass(attributes)

    this.addToLoaded([model])

    return model
  }

  /**
   * Force-reload the relationship. When the parent record was loaded as part
   * of a batch, siblings that have not preloaded this relationship get
   * batched into one request via the cohort preloader. The scoped query path
   * (`Model.where(...).preload([name]).toArray()` directly from user code)
   * bypasses cohort batching by design.
   * @returns {Promise<Array<FrontendModelRelationshipModel<T>>>} - Loaded relationship models.
   */
  async load() {
    // Reset so the cohort preloader (or single-record fallback) repopulates.
    this._preloaded = false
    this._loadedValue = []

    const batched = await this.model._tryCohortPreload(this.relationshipName)

    if (batched) return this._loadedValue

    await this.model.loadRelationship(this.relationshipName)

    return this.loaded()
  }

  /**
   * Runs to array.
   * @returns {Promise<Array<FrontendModelRelationshipModel<T>>>} - Loaded relationship models.
   */
  async toArray() {
    if (this.getPreloaded() || this._loadedValue.length > 0) {
      return this._loadedValue
    }

    return await this.load()
  }
}

/**
 * Frontend model relationship helper type. Returned by `getRelationshipByName`,
 * which generated models immediately cast to their concrete relationship type
 * (e.g. `FrontendModelSingularRelationship<Owner, Target, TargetCreateAttributes>`).
 * The members use `any` type args so that cast is allowed regardless of the
 * target model's typed-attribute generics — a concrete `FrontendModelBase` member
 * here makes the cast a non-overlapping (TS2352) error for every typed model.
 * @typedef {FrontendModelHasManyRelationship<any, any, any> | FrontendModelSingularRelationship<any, any, any>} FrontendModelRelationship
 */

/**
 * Copies loaded relationship state between helpers of the same relationship shape.
 * @param {object} args - Arguments.
 * @param {FrontendModelRelationship} args.sourceRelationship - Source relationship helper.
 * @param {FrontendModelRelationship} args.targetRelationship - Target relationship helper.
 * @returns {void}
 */
function copyLoadedRelationshipValue({sourceRelationship, targetRelationship}) {
  targetRelationship.copyLoadedFrom(sourceRelationship)
}

/**
 * Runs relationship type is collection.
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
   * Runs constructor.
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

  /**
   * Runs byte size.
   * @returns {number} - File size in bytes.
   */
  byteSize() { return this.byteSizeValue }
  /**
   * Runs content.
   * @returns {Uint8Array} - File content bytes.
   */
  content() { return this.contentValue }
  /**
   * Runs content type.
   * @returns {string | null} - Content type.
   */
  contentType() { return this.contentTypeValue }
  /**
   * Runs filename.
   * @returns {string} - Filename.
   */
  filename() { return this.filenameValue }
  /**
   * Runs id.
   * @returns {string} - Attachment id.
   */
  id() { return this.idValue }
  /**
   * Runs url.
   * @returns {string | null} - Resolvable attachment URL.
   */
  url() { return this.urlValue }
}

/**
 * Runs frontend model attachment command payload.
 * @param {FrontendModelAttachmentHandle} attachment - Attachment wrapper.
 * @param {string} [attachmentId] - Optional has-many attachment id.
 * @returns {Record<string, ?>} - Command payload.
 */
function frontendModelAttachmentCommandPayload(attachment, attachmentId) {
  /**
   * Payload.
   * @type {Record<string, ?>} */
  const payload = {
    attachmentName: attachment.attachmentName,
    id: attachment.model.primaryKeyValue()
  }

  if (attachmentId) payload.attachmentId = attachmentId

  return payload
}

/**
 * Runs frontend attachment value is bytes.
 * @param {?} value - Candidate value.
 * @returns {boolean} - Whether value looks like byte data.
 */
function frontendAttachmentValueIsBytes(value) {
  return value instanceof Uint8Array || value instanceof ArrayBuffer || (typeof Buffer !== "undefined" && Buffer.isBuffer(value))
}

/**
 * Runs frontend attachment value supports array buffer.
 * @param {?} value - Candidate value.
 * @returns {value is {arrayBuffer: () => Promise<ArrayBuffer>}} - Whether candidate supports arrayBuffer().
 */
function frontendAttachmentValueSupportsArrayBuffer(value) {
  return Boolean(value && typeof value === "object" && typeof /** @type {?} */ (value).arrayBuffer === "function")
}

/**
 * Runs frontend attachment normalize bytes.
 * @param {Uint8Array | Buffer | ArrayBuffer} value - Byte-like value.
 * @returns {Uint8Array} - Uint8Array bytes.
 */
function frontendAttachmentNormalizeBytes(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(/** @type {?} */ (value))) {
    return new Uint8Array(/** @type {Buffer} */ (value))
  }

  throw new Error("Unsupported attachment bytes value")
}

/**
 * Runs frontend attachment bytes to base64.
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
 * Runs frontend attachment base64 to bytes.
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
 * Runs frontend attachment value is plain object.
 * @param {?} value - Candidate value.
 * @returns {value is Record<string, ?>} - Whether value is plain object.
 */
function frontendAttachmentValueIsPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * Runs frontend model payload contains attachment upload.
 * @param {?} value - Payload candidate.
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
 * Returns the concrete frontend-model class for an instance.
 * @param {FrontendModelBase} model - Frontend model instance.
 * @returns {FrontendModelClass} Concrete frontend-model class.
 */
function frontendModelClassFor(model) {
  const constructorValue = model.constructor

  return /** @type {FrontendModelClass} */ (constructorValue)
}

/**
 * Whether the configured offline queue should handle a model operation.
 * @param {FrontendModelClass} ModelClass - Model class.
 * @param {"create" | "update" | "destroy"} operation - Sync operation.
 * @returns {boolean} - Whether to queue locally.
 */
function shouldQueueFrontendModelOperationOffline(ModelClass, operation) {
  const offlineSync = frontendModelTransportConfig.offlineSync

  if (!offlineSync?.enabled) return false

  const syncConfig = ModelClass.resourceConfig().sync

  if (!syncConfig?.enabled) return false
  if (!syncConfig.operations.includes(operation)) throw new Error(`Offline sync for ${ModelClass.getModelName()} does not allow ${operation}`)

  return true
}

/**
 * Queues an offline sync mutation.
 * @param {object} args - Arguments.
 * @param {Record<string, FrontendModelAttributeValue>} args.attributes - Mutation attributes.
 * @param {string} [args.clientMutationId] - Pre-generated mutation id.
 * @param {FrontendModelClass} args.ModelClass - Model class.
 * @param {"create" | "update" | "destroy"} args.operation - Sync operation.
 * @returns {Promise<string>} - Client mutation id.
 */
async function queueFrontendModelMutationOffline({attributes, clientMutationId: providedClientMutationId, ModelClass, operation}) {
  const offlineSync = frontendModelTransportConfig.offlineSync

  if (!offlineSync) throw new Error("Offline sync is not configured")

  const syncConfig = ModelClass.resourceConfig().sync
  if (!syncConfig?.enabled) throw new Error(`Offline sync is not enabled for ${ModelClass.getModelName()}`)

  const now = offlineSync.now ? offlineSync.now() : new Date()
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("offlineSync.now must return a valid Date")

  const clientMutationId = providedClientMutationId || (offlineSync.clientMutationId ? offlineSync.clientMutationId() : frontendModelOfflineMutationId())
  if (typeof clientMutationId !== "string" || clientMutationId.length < 1) throw new Error("offlineSync.clientMutationId must return a non-empty string")

  await offlineSync.mutationLog.append({
    mutation: {
      actorDeviceId: offlineSync.actorDeviceId,
      actorUserId: offlineSync.actorUserId,
      attributes: frontendModelSyncJsonObject(attributes),
      baseVersion: null,
      clientMutationId,
      model: ModelClass.getModelName(),
      occurredAt: now.toISOString(),
      offlineGrantId: offlineSync.offlineGrant.id,
      operation,
      policyHash: syncConfig.policyHash
    }
  })

  return clientMutationId
}

/**
 * Generates a frontend-model offline mutation id.
 * @returns {string} - Local mutation id.
 */
function frontendModelOfflineMutationId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID()

  return `frontend-mutation-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Converts model attributes to sync-safe JSON payload values.
 * @param {Record<string, FrontendModelAttributeValue>} attributes - Frontend model attributes.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} - Sync-safe attributes.
 */
function frontendModelSyncJsonObject(attributes) {
  const serialized = JSON.parse(JSON.stringify(attributes))

  if (!serialized || typeof serialized !== "object" || Array.isArray(serialized)) throw new Error("Expected sync mutation attributes object")

  return /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (serialized)
}

/**
 * Runs normalize frontend attachment input.
 * @param {?} input - Attachment input.
 * @returns {Promise<Record<string, ?>>} - Transport-safe attachment payload.
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
      contentType: typeof /** @type {?} */ (input).type === "string" && /** @type {?} */ (input).type.length > 0
        ? /** @type {?} */ (input).type
        : null,
      filename: typeof /** @type {?} */ (input).name === "string" && /** @type {?} */ (input).name.length > 0
        ? /** @type {?} */ (input).name
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
   * Pending attachment inputs queued for the next model save.
   * @type {FrontendModelAttachmentInput[]}
   */
  pendingInputs = []

  /**
   * Runs constructor.
   * @param {object} args - Options.
   * @param {FrontendModelBase} args.model - Model instance.
   * @param {string} args.attachmentName - Attachment name.
   */
  constructor({attachmentName, model}) {
    this.model = model
    this.attachmentName = attachmentName
  }

  /**
   * Queue attachment input for the parent model's next save.
   * @param {FrontendModelAttachmentInput | FrontendModelAttachmentInput[]} input - Attachment input.
   * @returns {void}
   */
  queueAttach(input) {
    const ModelClass = frontendModelClassFor(this.model)
    const attachmentDefinition = ModelClass.attachmentDefinition(this.attachmentName)

    if (attachmentDefinition?.type === "hasOne") {
      if (Array.isArray(input)) {
        const lastInput = input[input.length - 1]

        this.pendingInputs = typeof lastInput === "undefined" ? [] : [lastInput]
      } else {
        this.pendingInputs = [input]
      }
      return
    }

    if (Array.isArray(input)) {
      this.pendingInputs.push(...input)
    } else {
      this.pendingInputs.push(input)
    }
  }

  /**
   * Whether this attachment has queued inputs for the next model save.
   * @returns {boolean} Whether any pending inputs exist.
   */
  hasPendingAttachments() {
    return this.pendingInputs.length > 0
  }

  /**
   * Builds the save payload for queued attachment inputs.
   * @returns {Promise<Record<string, ?> | Record<string, ?>[] | undefined>} Normalized attachment payload.
   */
  async pendingAttachmentsPayload() {
    if (this.pendingInputs.length === 0) return undefined

    const ModelClass = frontendModelClassFor(this.model)
    const attachmentDefinition = ModelClass.attachmentDefinition(this.attachmentName)

    if (attachmentDefinition?.type === "hasMany") {
      return await Promise.all(this.pendingInputs.map(async (input) => await normalizeFrontendAttachmentInput(input)))
    }

    return await normalizeFrontendAttachmentInput(this.pendingInputs[this.pendingInputs.length - 1])
  }

  /** Clears queued attachment inputs after a successful model save. */
  clearPendingAttachments() {
    this.pendingInputs = []
  }

  /**
   * Runs attach.
   * @param {?} input - Attachment input.
   * @returns {Promise<void>} - Resolves when attached.
   */
  async attach(input) {
    const ModelClass = frontendModelClassFor(this.model)
    const normalizedInput = await normalizeFrontendAttachmentInput(input)
    const response = await ModelClass.executeCommand("attach", {
      attachment: normalizedInput,
      attachmentName: this.attachmentName,
      id: this.model.primaryKeyValue()
    })

    this.model.assignAttributes(ModelClass.attributesFromResponse(response))
  }

  /**
   * Runs download.
   * @param {string} [attachmentId] - Optional attachment id for has-many attachments.
   * @returns {Promise<FrontendModelAttachmentDownload | null>} - Downloaded attachment payload.
   */
  async download(attachmentId) {
    const ModelClass = frontendModelClassFor(this.model)
    const response = await ModelClass.executeCommand("download", frontendModelAttachmentCommandPayload(this, attachmentId))
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
   * Runs url.
   * @param {string} [attachmentId] - Optional attachment id for has-many attachments.
   * @returns {Promise<string | null>} - Resolvable attachment URL.
   */
  async url(attachmentId) {
    const ModelClass = frontendModelClassFor(this.model)
    const response = await ModelClass.executeCommand("url", frontendModelAttachmentCommandPayload(this, attachmentId))

    if (typeof response.url === "string" && response.url.length > 0) {
      return response.url
    }

    return null
  }

  /**
   * Builds a query for this attachment handle's metadata rows.
   * @returns {import("./query.js").default<typeof VelociousAttachment>} - Attachment metadata query.
   */
  query() {
    const ModelClass = frontendModelClassFor(this.model)

    return VelociousAttachment
      .where({
        name: this.attachmentName,
        recordId: String(this.model.primaryKeyValue()),
        recordType: ModelClass.getModelName()
      })
      .order([["position", "asc"]])
  }

  /**
   * Loads all attachment metadata rows for this handle.
   * @returns {Promise<VelociousAttachment[]>} - Attachment metadata rows.
   */
  async toArray() {
    return await this.query().toArray()
  }

  /**
   * Loads the first attachment metadata row for this handle.
   * @returns {Promise<VelociousAttachment | null>} - First attachment metadata row.
   */
  async first() {
    return await this.query().first()
  }

  /**
   * Runs list. Returns metadata for every attachment under this attachment name
   * (no content bytes), so callers can enumerate has-many attachments and then
   * download or link to each one by id.
   * @returns {Promise<Array<{byteSize: number, contentType: string | null, filename: string, id: string, url: string | null}>>} - Attachment metadata entries.
   */
  async list() {
    const ModelClass = frontendModelClassFor(this.model)
    const response = await ModelClass.executeCommand("attachmentList", frontendModelAttachmentCommandPayload(this))
    const attachments = Array.isArray(response.attachments) ? response.attachments : []

    return attachments.map((attachment) => {
      const byteSize = Number(attachment.byteSize)

      return {
        byteSize: Number.isFinite(byteSize) ? byteSize : 0,
        contentType: typeof attachment.contentType === "string" && attachment.contentType.length > 0 ? attachment.contentType : null,
        filename: typeof attachment.filename === "string" && attachment.filename.length > 0 ? attachment.filename : "attachment.bin",
        id: typeof attachment.id === "string" ? attachment.id : "",
        url: typeof attachment.url === "string" && attachment.url.length > 0 ? attachment.url : null
      }
    })
  }

  /**
   * Runs download url.
   * @returns {string} - Download URL for this attachment on the configured backend.
   */
  downloadUrl() {
    const ModelClass = frontendModelClassFor(this.model)
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
 * Runs normalize frontend model transport url.
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
 * Runs frontend model transport url.
 * @returns {string} - Resolved frontend-model transport URL.
 */
function frontendModelTransportUrl() {
  const configuredUrl = typeof frontendModelTransportConfig.url === "function"
    ? frontendModelTransportConfig.url()
    : frontendModelTransportConfig.url

  return normalizeFrontendModelTransportUrl(configuredUrl)
}

/**
 * Runs clone frontend model attributes.
 * @param {Record<string, ?>} value - Attributes hash.
 * @returns {Record<string, ?>} - Cloned attributes hash.
 */
function cloneFrontendModelAttributes(value) {
  return /** @type {Record<string, ?>} */ (deserializeFrontendModelTransportValue(serializeFrontendModelTransportValue(value)))
}

/**
 * Shared channel name for model lifecycle events (Phase 3).
 * Matches the backend `FRONTEND_MODELS_CHANNEL_NAME`.
 */
const FRONTEND_MODELS_CHANNEL_NAME = "frontend-models"

/**
 * Defines this typedef.
 * @typedef {{callback: (payload: {id: string, model: FrontendModelBase}) => void, eventFilterKey: string | null, eventFilterPayload: import("./query.js").FrontendModelEventFilterPayload | null, projectionPayload: import("./query.js").FrontendModelProjectionPayload}} FrontendModelModelEventCallbackEntry
 */
/**
 * Defines this typedef.
 * @typedef {{callback: (payload: {id: string}) => void}} FrontendModelDestroyEventCallbackEntry
 */

/**
 * Runs merge frontend model event preload.
 * @param {Record<string, import("./query.js").FrontendModelTransportValue>} target - Target preload payload.
 * @param {Record<string, import("./query.js").FrontendModelTransportValue>} source - Source preload payload.
 * @returns {void}
 */
function mergeFrontendModelEventPreload(target, source) {
  for (const [relationshipName, value] of Object.entries(source)) {
    const existingValue = target[relationshipName]

    if (value === true || value === false) {
      if (existingValue === undefined) target[relationshipName] = value
      continue
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      target[relationshipName] = value
      continue
    }

    if (!existingValue || typeof existingValue !== "object" || Array.isArray(existingValue)) {
      target[relationshipName] = {}
    }

    mergeFrontendModelEventPreload(
      /** @type {Record<string, import("./query.js").FrontendModelTransportValue>} */ (target[relationshipName]),
      /** @type {Record<string, import("./query.js").FrontendModelTransportValue>} */ (value)
    )
  }
}

/**
 * Runs merge frontend model event select.
 * @param {Record<string, string[]>} target - Target select map.
 * @param {Record<string, string[]>} source - Source select map.
 * @returns {void}
 */
function mergeFrontendModelEventSelect(target, source) {
  for (const [modelName, attributes] of Object.entries(source)) {
    const existingAttributes = target[modelName] || []

    target[modelName] = Array.from(new Set(existingAttributes.concat(attributes)))
  }
}

/**
 * Runs merge unique frontend model event entries.
 * @param {Array<import("./query.js").FrontendModelWithCountPayloadEntry | import("./query.js").FrontendModelAbilitiesPayloadEntry>} target - Target array.
 * @param {Array<import("./query.js").FrontendModelWithCountPayloadEntry | import("./query.js").FrontendModelAbilitiesPayloadEntry>} source - Source array.
 * @returns {void}
 */
function mergeUniqueFrontendModelEventEntries(target, source) {
  const existingKeys = new Set(target.map((entry) => JSON.stringify(entry)))

  for (const entry of source) {
    const key = JSON.stringify(entry)

    if (existingKeys.has(key)) continue

    target.push(entry)
    existingKeys.add(key)
  }
}

/**
 * Runs merge frontend model event projection payload.
 * @param {import("./query.js").FrontendModelProjectionPayload} target - Target payload.
 * @param {import("./query.js").FrontendModelProjectionPayload} source - Source payload.
 * @returns {void}
 */
function mergeFrontendModelEventProjectionPayload(target, source) {
  if (source.preload) {
    if (!target.preload) target.preload = {}
    mergeFrontendModelEventPreload(target.preload, source.preload)
  }

  if (source.select) {
    if (!target.select) target.select = {}
    mergeFrontendModelEventSelect(target.select, source.select)
  }

  if (source.selectsExtra) {
    if (!target.selectsExtra) target.selectsExtra = {}
    mergeFrontendModelEventSelect(target.selectsExtra, source.selectsExtra)
  }

  if (source.withCount) {
    if (!target.withCount) target.withCount = []
    mergeUniqueFrontendModelEventEntries(target.withCount, source.withCount)
  }

  if (source.abilities) {
    if (!target.abilities) target.abilities = []
    mergeUniqueFrontendModelEventEntries(target.abilities, source.abilities)
  }

  if (source.queryData !== undefined) {
    const targetQueryData = Array.isArray(target.queryData) ? target.queryData : []

    target.queryData = targetQueryData
    const queryDataEntries = Array.isArray(source.queryData) ? source.queryData : [source.queryData]

    for (const entry of queryDataEntries) {
      targetQueryData.push(entry)
    }
  }
}

/**
 * Runs frontend model matched event filter keys.
 * @param {?} body - Raw websocket event body.
 * @returns {Set<string>} - Matched event filter keys delivered by the backend.
 */
function frontendModelMatchedEventFilterKeys(body) {
  if (!body || typeof body !== "object") return new Set()

  const keys = /** @type {{matchedEventFilterKeys?: ?}} */ (body).matchedEventFilterKeys

  if (!Array.isArray(keys)) return new Set()

  return new Set(keys.map((key) => String(key)))
}

/**
 * Runs frontend model event entry matches.
 * @param {FrontendModelModelEventCallbackEntry} entry - Callback entry.
 * @param {Set<string>} matchedEventFilterKeys - Backend matched filter keys.
 * @returns {boolean} Whether the callback should receive the event.
 */
function frontendModelEventEntryMatches(entry, matchedEventFilterKeys) {
  if (!entry.eventFilterKey) return true

  return matchedEventFilterKeys.has(entry.eventFilterKey)
}

/**
 * Runs assert no destroy event filter.
 * @param {FrontendModelClass} ModelClass - Event model class.
 * @param {import("./query.js").FrontendModelEventOptions} options - Event options.
 * @returns {void}
 */
function assertNoDestroyEventFilter(ModelClass, options) {
  const eventOptionsPayload = frontendModelEventOptionsPayload(ModelClass, options)

  if (!eventOptionsPayload.eventFilterKey) return

  throw new Error("Frontend model destroy event subscriptions do not support query filters")
}

/**
 * Per-model class singleton that multiplexes all registered onCreate /
 * onUpdate / onDestroy callbacks — class-level + instance-level —
 * over one WebsocketChannelV2 subscription. Subscription opens on the
 * first listener and closes when the last one unsubscribes.
 *
 * Instance-level listeners also receive auto-merge: when an `update`
 * event arrives for a registered instance id, the instance's
 * attributes are updated in place before the callback fires, so
 * callers can read fresh values from the same instance handle.
 */
class FrontendModelEventSubscription {
  /**
   * Runs constructor.
   * @param {FrontendModelClass} ModelClass - Frontend model class for this subscription bucket.
   */
  constructor(ModelClass) {
    this.ModelClass = ModelClass
    /**
     * Narrows the runtime value to the documented type.
     * @type {Set<FrontendModelModelEventCallbackEntry>} */
    this.classCreateCallbacks = new Set()
    /**
     * Narrows the runtime value to the documented type.
     * @type {Set<FrontendModelModelEventCallbackEntry>} */
    this.classUpdateCallbacks = new Set()
    /**
     * Narrows the runtime value to the documented type.
     * @type {Set<FrontendModelDestroyEventCallbackEntry>} */
    this.classDestroyCallbacks = new Set()
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<string, {instance: FrontendModelBase, updateCallbacks: Set<FrontendModelModelEventCallbackEntry>, destroyCallbacks: Set<FrontendModelDestroyEventCallbackEntry>}>} */
    this.instanceListeners = new Map()
    /**
     * Narrows the runtime value to the documented type.
     * @type {?} */
    this.channelHandle = null
    /**
     * Narrows the runtime value to the documented type.
     * @type {Promise<void> | null} */
    this.readyPromise = null
    /**
     * Narrows the runtime value to the documented type.
     * @type {string | null} */
    this.subscriptionParamsKey = null
  }

  /**
   * Runs subscription params.
   * @returns {{model: string, destroyEventDelivery?: boolean, eventFilters?: import("./query.js").FrontendModelEventFilterPayloadEntry[], unfilteredEventDelivery?: boolean} & import("./query.js").FrontendModelProjectionPayload} - Current websocket subscription params.
   */
  subscriptionParams() {
    /**
     * Projection payload.
     * @type {import("./query.js").FrontendModelProjectionPayload} */
    const projectionPayload = {}
    /**
     * Event filters by key.
     * @type {Record<string, import("./query.js").FrontendModelEventFilterPayloadEntry>} */
    const eventFiltersByKey = {}
    const projectionEntries = []
    let hasDestroyEventDelivery = this.classDestroyCallbacks.size > 0
    let hasUnfilteredEventDelivery = false

    for (const entry of this.classCreateCallbacks) projectionEntries.push(entry)
    for (const entry of this.classUpdateCallbacks) projectionEntries.push(entry)

    for (const listener of this.instanceListeners.values()) {
      for (const entry of listener.updateCallbacks) projectionEntries.push(entry)
      if (listener.destroyCallbacks.size > 0) hasDestroyEventDelivery = true
    }

    for (const entry of projectionEntries) {
      mergeFrontendModelEventProjectionPayload(projectionPayload, entry.projectionPayload)

      if (entry.eventFilterKey && entry.eventFilterPayload) {
        eventFiltersByKey[entry.eventFilterKey] = {
          ...entry.eventFilterPayload,
          key: entry.eventFilterKey
        }
      } else {
        hasUnfilteredEventDelivery = true
      }
    }

    const eventFilters = Object.values(eventFiltersByKey)
    const eventFilterParams = eventFilters.length > 0
      ? {
          eventFilters,
          ...(hasDestroyEventDelivery ? {destroyEventDelivery: true} : {}),
          ...(hasUnfilteredEventDelivery ? {unfilteredEventDelivery: true} : {})
        }
      : {}

    return {
      model: this.ModelClass.getModelName(),
      ...eventFilterParams,
      ...projectionPayload
    }
  }

  /**
   * Runs subscription params json.
   * @returns {string} - Stable key for current subscription params.
   */
  subscriptionParamsJson() {
    return JSON.stringify(this.subscriptionParams())
  }

  /**
   * Runs ensure subscribed.
   * @returns {Promise<void>} */
  async ensureSubscribed() {
    const paramsJson = this.subscriptionParamsJson()

    if (this.channelHandle && !this.channelHandle.isClosed()) {
      if (this.subscriptionParamsKey !== paramsJson) {
        this.channelHandle.close()
        this.channelHandle = null
        this.readyPromise = null
      } else {
        if (this.readyPromise) await this.readyPromise
        return
      }
    }

    // Serialize parallel calls (e.g. Promise.all([onCreate, onUpdate,
    // onDestroy])) so we open exactly one subscription per model class
    // instead of racing three concurrent subscribeChannel calls.
    if (this.readyPromise) {
      await this.readyPromise
      return
    }

    const client = /** @type {?} */ (frontendModelTransportConfig.websocketClient || resolveInternalWebsocketClient())

    if (!client || typeof client.subscribeChannel !== "function") {
      throw new Error("Frontend model event subscriptions require configureTransport({websocketUrl}) or configureTransport({websocketClient})")
    }

    this.readyPromise = (async () => {
      if (typeof client.connect === "function") await client.connect()

      const params = this.subscriptionParams()

      this.subscriptionParamsKey = JSON.stringify(params)
      this.channelHandle = client.subscribeChannel(FRONTEND_MODELS_CHANNEL_NAME, {
        params,
        onMessage: (/** @type {?} */ body) => this._dispatchEvent(body),
        onClose: () => {
          this.channelHandle = null
          this.readyPromise = null
          this.subscriptionParamsKey = null
          this.instanceListeners.clear()

          const hasCallbacks = this.classCreateCallbacks.size > 0
            || this.classUpdateCallbacks.size > 0
            || this.classDestroyCallbacks.size > 0

          if (hasCallbacks && client.autoReconnect) {
            void this.ensureSubscribed()
          }
        }
      })
      await this.channelHandle.ready
    })()

    await this.readyPromise
  }

  /**
   * Runs dispatch event.
   * @param {?} body - WebSocket event payload.
   */
  _dispatchEvent(body) {
    if (!body || typeof body !== "object") return

    const action = body.action
    const rawId = body.id

    if (action !== "create" && action !== "update" && action !== "destroy") return
    if (rawId === undefined || rawId === null) return

    const id = String(rawId)
    const matchedEventFilterKeys = frontendModelMatchedEventFilterKeys(body)

    if (action === "destroy") {
      const listener = this.instanceListeners.get(id)

      if (listener) {
        for (const entry of listener.destroyCallbacks) {
          try { entry.callback({id}) } catch (error) { console.error(error) }
        }
        this.instanceListeners.delete(id)
      }
      for (const entry of this.classDestroyCallbacks) {
        try { entry.callback({id}) } catch (error) { console.error(error) }
      }
      return
    }

    if (!body.record || typeof body.record !== "object") return

    const deserializedRecord = /** @type {Record<string, ?>} */ (deserializeFrontendModelTransportValue(body.record))
    const freshModel = /** @type {?} */ (this.ModelClass).instantiateFromResponse(deserializedRecord)
    const listener = this.instanceListeners.get(id)

    if (action === "update" && listener) {
      const matchingUpdateCallbacks = Array.from(listener.updateCallbacks).filter((entry) =>
        frontendModelEventEntryMatches(entry, matchedEventFilterKeys)
      )

      if (matchingUpdateCallbacks.length > 0) {
        // Auto-merge into the registered instance so callers reading
        // through the same handle see fresh attributes.
        const instanceAny = /** @type {?} */ (listener.instance)

        instanceAny.assignAttributes(freshModel.attributes())
        instanceAny._persistedAttributes = cloneFrontendModelAttributes(listener.instance.attributes())

        for (const entry of matchingUpdateCallbacks) {
          try { entry.callback({id, model: listener.instance}) } catch (error) { console.error(error) }
        }
      }
    }

    const classCallbacks = action === "create" ? this.classCreateCallbacks : this.classUpdateCallbacks

    for (const entry of classCallbacks) {
      if (!frontendModelEventEntryMatches(entry, matchedEventFilterKeys)) continue

      try { entry.callback({id, model: freshModel}) } catch (error) { console.error(error) }
    }
  }

  /**
   * Runs maybe teardown.
   * @returns {void} */
  maybeTeardown() {
    const hasAnyListener = this.classCreateCallbacks.size > 0
      || this.classUpdateCallbacks.size > 0
      || this.classDestroyCallbacks.size > 0
      || this.instanceListeners.size > 0

    if (hasAnyListener) return
    if (!this.channelHandle) return

    try {
      this.channelHandle.close()
    } catch (error) {
      console.error(error)
    }

    this.channelHandle = null
    this.readyPromise = null
    this.subscriptionParamsKey = null
  }
}

/**
 * Frontend model event subscriptions.
 * @type {WeakMap<FrontendModelClass, FrontendModelEventSubscription>} */
const frontendModelEventSubscriptions = new WeakMap()

/**
 * Runs ensure frontend model event subscription.
 * @param {FrontendModelClass} ModelClass - Model class.
 * @returns {FrontendModelEventSubscription} - Per-class subscription helper.
 */
function ensureFrontendModelEventSubscription(ModelClass) {
  let sub = frontendModelEventSubscriptions.get(ModelClass)

  if (!sub) {
    sub = new FrontendModelEventSubscription(ModelClass)
    frontendModelEventSubscriptions.set(ModelClass, sub)
  }

  return sub
}

/**
 * Runs ensure frontend model instance listener.
 * @param {FrontendModelEventSubscription} sub - Event subscription bucket.
 * @param {string} id - Model id.
 * @param {FrontendModelBase} instance - Listener instance.
 * @returns {{instance: FrontendModelBase, updateCallbacks: Set<FrontendModelModelEventCallbackEntry>, destroyCallbacks: Set<FrontendModelDestroyEventCallbackEntry>}} - Instance listener bucket.
 */
function ensureFrontendModelInstanceListener(sub, id, instance) {
  let listener = sub.instanceListeners.get(id)

  if (!listener) {
    listener = {instance, updateCallbacks: new Set(), destroyCallbacks: new Set()}
    sub.instanceListeners.set(id, listener)
  } else {
    listener.instance = instance
  }

  return listener
}

/**
 * Runs frontend model command url.
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
 * Runs frontend model api url.
 * @returns {string} - Shared frontend-model API URL.
 */
function frontendModelApiUrl() {
  return `${frontendModelTransportUrl()}${SHARED_FRONTEND_MODEL_API_PATH}`
}

/**
 * Runs frontend model transport path.
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
 * Resolves the browser runtime timezone when available.
 * @returns {string | undefined} - Browser runtime timezone when available.
 */
function defaultFrontendModelTimeZone() {
  if (typeof window === "undefined") return undefined

  const intl = globalThis.Intl

  if (!intl) {
    throw new Error("Expected Intl to be available for browser timezone detection")
  }

  if (typeof intl.DateTimeFormat !== "function") {
    throw new Error("Expected Intl.DateTimeFormat to be available as a function")
  }

  const timeZone = intl.DateTimeFormat().resolvedOptions().timeZone

  if (typeof timeZone !== "string" || timeZone.trim().length < 1) {
    throw new Error("Expected Intl.DateTimeFormat to resolve a browser timezone string")
  }

  return validateTimeZone(timeZone, "browser timeZone")
}

/**
 * Resolves the configured frontend-model request timezone.
 * @returns {string | undefined} - Configured frontend-model timezone.
 */
function frontendModelTransportTimeZone() {
  if (!Object.prototype.hasOwnProperty.call(frontendModelTransportConfig, "timeZone")) {
    return defaultFrontendModelTimeZone()
  }

  const timeZone = typeof frontendModelTransportConfig.timeZone === "function"
    ? frontendModelTransportConfig.timeZone()
    : frontendModelTransportConfig.timeZone

  if (timeZone === undefined || timeZone === null) {
    throw new Error("Frontend model transport timeZone did not resolve to a timezone string")
  }

  return validateTimeZone(timeZone, "frontend model transport timeZone")
}

/**
 * Runs frontend model request headers.
 * @param {string | undefined} [timeZone] - Pre-resolved timezone for this request.
 * @returns {Record<string, string>} - Headers for frontend-model HTTP requests.
 */
function frontendModelRequestHeaders(timeZone = frontendModelTransportTimeZone()) {
  const dynamicHeaders = typeof frontendModelTransportConfig.requestHeaders === "function"
    ? (frontendModelTransportConfig.requestHeaders() || {})
    : (frontendModelTransportConfig.requestHeaders || {})
  /** @type {Record<string, string>} */
  const headers = {"Content-Type": "application/json", ...dynamicHeaders}

  if (timeZone) {
    headers[REQUEST_TIME_ZONE_HEADER] = timeZone
  }

  return headers
}

/**
 * Resolves the configured bounded transport deadline in milliseconds.
 * @returns {number | undefined} - Configured deadline, or undefined when no deadline is set.
 */
function frontendModelTransportTimeoutMs() {
  const configuredTimeout = typeof frontendModelTransportConfig.timeout === "function"
    ? frontendModelTransportConfig.timeout()
    : frontendModelTransportConfig.timeout

  if (typeof configuredTimeout !== "number" || !(configuredTimeout > 0)) {
    return undefined
  }

  return configuredTimeout
}

/**
 * Resolves the configured caller/session AbortSignal composed with the deadline.
 * @returns {AbortSignal | undefined} - Configured caller signal, or undefined when none is set.
 */
function frontendModelTransportSignal() {
  const configuredSignal = typeof frontendModelTransportConfig.signal === "function"
    ? frontendModelTransportConfig.signal()
    : frontendModelTransportConfig.signal

  return configuredSignal || undefined
}

/**
 * Resolves per-startup controls with the configured session cancellation.
 * @param {{timeoutMs?: number, signal?: AbortSignal}} controls - Call controls.
 * @returns {{timeoutMs?: number, signal?: AbortSignal}} - Effective startup controls.
 */
function frontendModelWebsocketStartupControls(controls) {
  const sessionSignal = frontendModelTransportSignal()
  let signal = controls.signal || sessionSignal

  if (controls.signal && sessionSignal && controls.signal !== sessionSignal) {
    signal = AbortSignal.any([controls.signal, sessionSignal])
  }

  const configuredTimeoutMs = frontendModelTransportTimeoutMs()
  const timeoutMs = controls.timeoutMs === undefined
    ? configuredTimeoutMs
    : configuredTimeoutMs === undefined
      ? controls.timeoutMs
      : Math.min(controls.timeoutMs, configuredTimeoutMs)

  return {signal, timeoutMs}
}

/**
 * Runs perform shared frontend model api request.
 * @param {Record<string, ?>} requestPayload - Shared request payload.
 * @returns {Promise<Record<string, ?>>} - Decoded shared frontend-model API response.
 */
async function performSharedFrontendModelApiRequest(requestPayload) {
  const timeZone = frontendModelTransportTimeZone()
  const serializedRequestPayload = serializeFrontendModelTransportValue(requestPayload, {timeZone})
  const websocketClient = frontendModelTransportConfig.websocketClient
  const url = frontendModelApiUrl()
  const mergedHeaders = frontendModelRequestHeaders(timeZone)

  return await runWithTransportDeadline(
    {
      errorMessage: "Shared frontend model API request timed out",
      signal: frontendModelTransportSignal(),
      timeoutMs: frontendModelTransportTimeoutMs()
    },
    async (signal) => {
      if (websocketClient) {
        const response = await websocketClient.post(frontendModelTransportPath(url), serializedRequestPayload, {
          headers: mergedHeaders,
          signal
        })
        const responseJson = response.json()

        return /** @type {Record<string, ?>} */ (deserializeFrontendModelTransportValue(responseJson))
      }

      const response = await fetch(url, {
        body: JSON.stringify(serializedRequestPayload),
        credentials: "include",
        headers: mergedHeaders,
        method: "POST",
        signal
      })

      const responseText = await response.text()

      if (!response.ok) {
        throwFrontendModelHttpError({
          commandLabel: "shared frontend model API",
          response,
          responseText
        })
      }

      const json = responseText.length > 0 ? JSON.parse(responseText) : {}

      return /** @type {Record<string, ?>} */ (deserializeFrontendModelTransportValue(json))
    }
  )
}

/**
 * Throws a frontend-model HTTP error with backend-provided envelope details when available.
 * @param {{commandLabel: string, response: Response, responseText: string}} args - Error response details.
 * @returns {never} - Always throws an unknown-attribute error.
 */
function throwFrontendModelHttpError({commandLabel, response, responseText}) {
  // Surface the backend's friendly errorMessage envelope (the
  // `{status: "error", errorMessage: "..."}` shape every controller
  // ships on its 4xx/5xx responses) instead of the generic status
  // string. Fall through to the status-only message when the body is
  // missing, non-JSON, or has no usable errorMessage field.
  const responseContentType = response.headers.get("content-type")

  if (responseContentType && responseContentType.includes("application/json") && responseText.length > 0) {
    /**
     * Defines errorBody.
     * @type {Record<string, ?> | null} */
    let errorBody

    try {
      errorBody = JSON.parse(responseText)
    } catch {
      errorBody = null
    }

    if (errorBody && typeof errorBody.errorMessage === "string" && errorBody.errorMessage.trim().length > 0) {
      throw new Error(errorBody.errorMessage.trim())
    }
  }

  throw new Error(`Request failed (${response.status}) for ${commandLabel}`)
}

/**
 * Runs flush pending shared frontend model requests.
 * @returns {Promise<void>} - Resolves after pending shared frontend-model requests flush.
 */
async function flushPendingSharedFrontendModelRequests() {
  sharedFrontendModelFlushScheduled = false

  if (pendingSharedFrontendModelRequests.length < 1) {
    resolveFrontendModelIdleWaiters()
    return
  }

  const batchedRequests = pendingSharedFrontendModelRequests
  pendingSharedFrontendModelRequests = []

  const url = frontendModelApiUrl()
  const requestPayload = {
    requests: batchedRequests.map((request) => {
      if (request.customPath) {
        return {
          commandType: request.commandType,
          customPath: request.customPath,
          model: request.modelClass.getModelName(),
          payload: request.payload,
          requestId: request.requestId
        }
      }

      return {
        commandType: request.commandType,
        model: request.modelClass.getModelName(),
        payload: request.payload,
        requestId: request.requestId
      }
    })
  }

  await trackFrontendModelTransportRequest(async () => {
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

        request.resolve(/** @type {Record<string, ?>} */ (responsePayload))
      }
    } catch (error) {
      for (const request of batchedRequests) {
        request.reject(error)
      }
    }
  })
}

/**
 * Runs schedule shared frontend model request flush.
 * @returns {void} */
function scheduleSharedFrontendModelRequestFlush() {
  if (sharedFrontendModelFlushScheduled) return

  sharedFrontendModelFlushScheduled = true
  queueMicrotask(() => {
    void flushPendingSharedFrontendModelRequests()
  })
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
 * Runs assert find by conditions shape.
 * @param {?} conditions - findBy conditions.
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
 * Runs assert defined find by condition value.
 * @param {?} value - Condition value to validate.
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

    const objectValue = /** @type {Record<string, ?>} */ (value)
    const prototype = Object.getPrototypeOf(objectValue)

    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`findBy does not support non-plain object condition values (key: ${keyPath})`)
    }

    const symbolKeys = Object.getOwnPropertySymbols(objectValue)

    if (symbolKeys.length > 0) {
      throw new Error(`findBy does not support symbol condition keys (key: ${keyPath})`)
    }

    const valueObject = /** @type {Record<string, ?>} */ (value)

    Object.keys(valueObject).forEach((nestedKey) => {
      assertDefinedFindByConditionValue(valueObject[nestedKey], `${keyPath}.${nestedKey}`)
    })
  }
}

/**
 * Base frontend model.
 *
 * Defaults are `any` so the bare `FrontendModelBase` — used throughout as a
 * constraint/parameter type for "any frontend model" — accepts generated
 * subclasses declaring typed-attribute generics (`FrontendModelBase<XAttributes,
 * ...>`). A concrete `Record<string, FrontendModelAttributeValue>` default makes
 * those subclasses fail by invariance. Subclasses still pass their precise
 * attribute typedefs, so typed accessors keep their precision.
 * @template {object} [Attributes=any]
 * @template {object} [CreateAttributes=any]
 * @template {object} [UpdateAttributes=any]
 */
export default class FrontendModelBase {
  /**
   * Narrows the runtime value to the documented type.
   * @type {string | undefined} */
  static modelName

  /**
   * Autoload.
   * @type {boolean} - Global auto-batch-preload toggle. Apps can opt out via FrontendModelBase.setAutoload(false).
   */
  static _autoload = true

  /**
   * Runs get autoload.
   * @returns {boolean} Whether auto-batch-preload of relationships on lazy access is enabled globally.
   */
  static getAutoload() { return FrontendModelBase._autoload }

  /**
   * Runs set autoload.
   * @param {boolean} newValue - Whether auto-batch-preload of relationships is enabled.
   * @returns {void}
   */
  static setAutoload(newValue) { FrontendModelBase._autoload = newValue }

  /**
   * Narrows the runtime value to the documented type.
   * @type {Record<string, FrontendModelAttributeValue>} */
  _attributes
  /**
   * Narrows the runtime value to the documented type.
   * @type {Record<string, FrontendModelHasManyRelationship<FrontendModelBase, FrontendModelBase, Record<string, FrontendModelAttributeValue>> | FrontendModelSingularRelationship<FrontendModelBase, FrontendModelBase, Record<string, FrontendModelAttributeValue>>>} */
  _relationships
  /**
   * Narrows the runtime value to the documented type.
   * @type {Record<string, FrontendModelAttachmentHandle>} */
  _attachments
  /**
   * Rails-style nested attribute payloads queued for the next save.
   * @type {Record<string, ?>}
   */
  _pendingNestedAttributes
  /**
   * Narrows the runtime value to the documented type.
   * @type {Set<string> | null} */
  _selectedAttributes
  /**
   * Narrows the runtime value to the documented type.
   * @type {boolean} */
  _isNewRecord
  /**
   * Narrows the runtime value to the documented type.
   * @type {boolean} */
  _markedForDestruction
  /**
   * Narrows the runtime value to the documented type.
   * @type {Record<string, FrontendModelAttributeValue>} */
  _persistedAttributes
  /**
   * Narrows the runtime value to the documented type.
   * @type {Array<FrontendModelBase> | undefined} - Shared reference to sibling records loaded in the same batch. Used by auto-batch-preload.
   */
  _loadCohort

  /**
   * Runs constructor.
   * @param {Attributes | CreateAttributes} [attributes] - Initial attributes.
   */
  constructor(attributes) {
    const ModelClass = frontendModelClassFor(this)

    ModelClass.ensureGeneratedAttachmentMethods()
    this._attributes = {}
    this._relationships = {}
    this._attachments = {}
    this._pendingNestedAttributes = {}
    this._selectedAttributes = null
    this._isNewRecord = true
    this._markedForDestruction = false
    this._persistedAttributes = {}
    if (attributes) this.assignAttributes(attributes)
  }

  /**
   * Runs ensure generated attachment methods.
   * @this {FrontendModelClass}
   * @returns {void} - Ensures attachment helper methods exist on the prototype.
   */
  static ensureGeneratedAttachmentMethods() {
    if (this._generatedAttachmentMethods) return

    const attachments = this.attachmentDefinitions()
    const prototype = /** @type {Record<string, ?>} */ (this.prototype)

    for (const attachmentName of Object.keys(attachments)) {
      if (!(attachmentName in prototype)) {
        prototype[attachmentName] = function() {
          return this.getAttachmentByName(attachmentName)
        }
      }
    }

    this._generatedAttachmentMethods = true
  }

  /**
   * Runs resource config.
   * @returns {FrontendModelResourceConfig} - Resource configuration.
   */
  static resourceConfig() {
    throw new Error("resourceConfig() must be implemented by subclasses")
    // eslint-disable-next-line no-unreachable
    return {}
  }

  /**
   * Runs relationship model classes.
   * @this {FrontendModelClass}
   * @returns {Record<string, FrontendModelClass | string>} - Relationship model classes (or class name strings) keyed by relationship name.
   */
  static relationshipModelClasses() {
    return {}
  }

  /**
   * Register a frontend model class so it can be resolved by name in relationship lookups.
   * @param {FrontendModelClass} modelClass - Model class to register.
   * @returns {void}
   */
  static registerModel(modelClass) {
    registerFrontendModel(modelClass)
  }

  /**
   * Runs define scope.
   * @param {(...args: Array<?>) => ?} callback - Scope callback.
   * @returns {((...args: Array<?>) => import("./query.js").default<FrontendModelClass>) & {scope: (...args: Array<?>) => import("../utils/model-scope.js").ModelScopeDescriptor}} - Scope helper.
   */
  static defineScope(callback) {
    return defineModelScope({
      callback,
      modelClass: this,
      startQuery: () => this.query()
    })
  }

  /**
   * Resolve a relationship model class value that may be a class reference or a string name.
   * @param {FrontendModelClass | string | null | undefined} value - Class or class name.
   * @returns {FrontendModelClass | null} - Resolved model class.
   */
  static resolveModelClass(value) {
    return resolveFrontendModelClass(value)
  }

  /**
   * Runs relationship definitions.
   * @this {FrontendModelClass}
   * @returns {Record<string, {type: "belongsTo" | "hasOne" | "hasMany", autoload?: boolean}>} - Relationship definitions keyed by relationship name.
   */
  static relationshipDefinitions() {
    return {}
  }

  /**
   * Runs attachment definitions.
   * @this {FrontendModelClass}
   * @returns {Record<string, FrontendModelAttachmentDefinition>} - Attachment definitions keyed by attachment name.
   */
  static attachmentDefinitions() {
    return this.resourceConfig().attachments || {}
  }

  /**
   * Runs attachment definition.
   * @this {FrontendModelClass}
   * @param {string} attachmentName - Attachment name.
   * @returns {FrontendModelAttachmentDefinition | null} - Attachment definition.
   */
  static attachmentDefinition(attachmentName) {
    return this.attachmentDefinitions()[attachmentName] || null
  }

  /**
   * Runs relationship definition.
   * @this {FrontendModelClass}
   * @param {string} relationshipName - Relationship name.
   * @returns {{type: "belongsTo" | "hasOne" | "hasMany", autoload?: boolean} | null} - Relationship definition.
   */
  static relationshipDefinition(relationshipName) {
    const definitions = this.relationshipDefinitions()

    return definitions[relationshipName] || null
  }

  /**
   * Resolves a Rails-style nested attributes key to a configured relationship.
   * @this {FrontendModelClass}
   * @param {string} attributeName - Candidate attribute name, such as `tasksAttributes`.
   * @returns {string | null} Relationship name when nested attributes are configured.
   */
  static nestedAttributesRelationshipName(attributeName) {
    if (!attributeName.endsWith("Attributes")) return null

    const relationshipName = attributeName.slice(0, -"Attributes".length)
    const nestedAttributesConfig = this.resourceConfig().nestedAttributes || {}

    return Object.prototype.hasOwnProperty.call(nestedAttributesConfig, relationshipName)
      ? relationshipName
      : null
  }

  /**
   * Runs relationship model class.
   * @this {FrontendModelClass}
   * @param {string} relationshipName - Relationship name.
   * @returns {FrontendModelClass | null} - Target relationship model class.
   */
  static relationshipModelClass(relationshipName) {
    const relationshipModelClasses = this.relationshipModelClasses()
    const value = relationshipModelClasses[relationshipName]

    return FrontendModelBase.resolveModelClass(value)
  }

  /**
   * Runs attributes.
   * @returns {Attributes} - Attributes hash.
   */
  attributes() {
    return /** @type {Attributes} */ (this._attributes)
  }

  /**
   * Runs is new record.
   * @returns {boolean} - Whether this model has not yet been persisted.
   */
  isNewRecord() {
    return this._isNewRecord
  }

  /**
   * Runs is persisted.
   * @returns {boolean} - Whether this model has been persisted.
   */
  isPersisted() {
    return !this.isNewRecord()
  }

  /**
   * Runs set is new record.
   * @param {boolean} newIsNewRecord - New persisted-state flag.
   * @returns {void}
   */
  setIsNewRecord(newIsNewRecord) {
    this._isNewRecord = newIsNewRecord
  }

  /**
   * Marks this record for destruction when its parent is next saved through
   * nested-attribute support. The record is not removed from the parent's
   * relationship collection until the server confirms the delete.
   * @returns {void} - No return value.
   */
  markForDestruction() {
    this._markedForDestruction = true
  }

  /**
   * Runs marked for destruction.
   * @returns {boolean} - Whether this record is queued for nested destruction on next parent save.
   */
  markedForDestruction() {
    return this._markedForDestruction
  }

  /**
   * Runs changes.
   * @returns {Record<string, Array<?>>} - Changed attributes as `[oldValue, newValue]`.
   */
  changes() {
    /**
     * Changed attributes.
     * @type {Record<string, Array<?>>} */
    const changedAttributes = {}
    const attributeNames = new Set([
      ...Object.keys(this._persistedAttributes),
      ...Object.keys(this._attributes)
    ])

    for (const attributeName of attributeNames) {
      const previousValue = this._persistedAttributes[attributeName]
      const currentValue = this._attributes[attributeName]

      if (JSON.stringify(serializeFrontendModelTransportValue(previousValue)) !== JSON.stringify(serializeFrontendModelTransportValue(currentValue))) {
        changedAttributes[attributeName] = [previousValue, currentValue]
      }
    }

    return changedAttributes
  }

  /**
   * Runs is changed.
   * @returns {boolean} - Whether any tracked attribute has changed.
   */
  isChanged() {
    return Object.keys(this.changes()).length > 0
  }

  /**
   * Runs get relationship by name.
   * @param {string} relationshipName - Relationship name.
   * @returns {FrontendModelRelationship} - Relationship state object.
   */
  getRelationshipByName(relationshipName) {
    if (!this._relationships[relationshipName]) {
      const ModelClass = frontendModelClassFor(this)
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
   * Runs get attachment by name.
   * @param {string} attachmentName - Attachment name.
   * @returns {FrontendModelAttachmentHandle} - Attachment helper.
   */
  getAttachmentByName(attachmentName) {
    const ModelClass = frontendModelClassFor(this)
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
   * Runs load relationship.
   * @param {string} relationshipName - Relationship name.
   * @returns {Promise<FrontendModelBase | Array<FrontendModelBase> | null>} - Loaded relationship value.
   */
  async loadRelationship(relationshipName) {
    const ModelClass = frontendModelClassFor(this)
    const id = this.primaryKeyValue()
    const reloadedModel = await ModelClass
      .preload([relationshipName])
      .find(id)
    const sourceRelationship = reloadedModel.getRelationshipByName(relationshipName)
    const targetRelationship = this.getRelationshipByName(relationshipName)

    copyLoadedRelationshipValue({sourceRelationship, targetRelationship})

    return targetRelationship.loaded()
  }

  /**
   * Preloads relationship(s) onto this already-loaded record. Accepts either a
   * query built via `Model.preload(...).select(...)` or a raw preload spec
   * (string / array / nested object). Relationships already preloaded with the
   * required columns present are left untouched unless `force` is set. Carries
   * the query's preload graph, select, selectsExtra, withCount, abilities, and
   * queryData when re-fetching.
   * @param {import("./query.js").default<FrontendModelClass> | import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>} queryOrSpec - Preload source.
   * @param {{force?: boolean}} [options] - Options.
   * @returns {Promise<void>} - Resolves when preloading completes.
   */
  async preload(queryOrSpec, options = {}) {
    await FrontendModelPreloader.preload([this], queryOrSpec, options)
  }

  /**
   * Runs relationship or load.
   * @param {string} relationshipName - Relationship name.
   * @returns {Promise<FrontendModelBase | Array<FrontendModelBase> | null>} - Loaded relationship value.
   */
  async relationshipOrLoad(relationshipName) {
    const relationship = this.getRelationshipByName(relationshipName)

    if (relationship.getPreloaded()) {
      return relationship.loaded()
    }

    const batched = await this._tryCohortPreload(relationshipName)

    if (batched) return relationship.loaded()

    return await this.loadRelationship(relationshipName)
  }

  /**
   * Attempts to batch-load `relationshipName` across cohort siblings via a
   * single `preload([name]).where({pk: [ids]}).toArray()` request, then copies
   * the preloaded relationship state onto each sibling. Returns true when a
   * batch ran, false when autoload is off, there is no cohort, or no batch
   * candidates remain. Siblings whose relationship state is already set
   * (preloaded or locally manipulated via `build` / `setRelationship`) are
   * skipped so their cached/edited value is preserved.
   * @param {string} relationshipName - Relationship name.
   * @returns {Promise<boolean>} - Whether a cohort batch preload ran.
   */
  async _tryCohortPreload(relationshipName) {
    if (!FrontendModelBase.getAutoload()) return false

    const ModelClass = frontendModelClassFor(this)
    const cohort = this._loadCohort

    if (!cohort || cohort.length <= 1) return false

    const definition = ModelClass.relationshipDefinition(relationshipName)

    if (!definition) return false
    if (definition.autoload === false) return false

    /**
     * Batch.
     * @type {Array<FrontendModelBase>} */
    const batch = []

    // Exact same class, persisted, no existing in-memory relationship state.
    // `setLoaded` sets `_preloaded = true` on every mutation path (preload,
    // setRelationship, build, addToLoaded), so `getPreloaded()` alone is a
    // reliable "already touched" signal on the frontend.
    for (const sibling of cohort) {
      if (sibling.constructor !== ModelClass) continue
      if (sibling.isNewRecord()) continue

      const siblingRelationship = sibling.getRelationshipByName(relationshipName)

      if (siblingRelationship.getPreloaded()) continue

      batch.push(sibling)
    }

    if (batch.length === 0) return false

    const primaryKey = ModelClass.primaryKey()
    const batchIds = batch.map((sibling) => sibling.primaryKeyValue())
    const reloadedBatch = await ModelClass
      .preload([relationshipName])
      .where({[primaryKey]: batchIds})
      .toArray()

    /**
     * Reloaded by id.
     * @type {Map<string, FrontendModelBase>} */
    const reloadedById = new Map()

    for (const reloaded of reloadedBatch) {
      reloadedById.set(String(reloaded.primaryKeyValue()), reloaded)
    }

    for (const sibling of batch) {
      const key = String(sibling.primaryKeyValue())
      const reloaded = reloadedById.get(key)

      if (!reloaded) continue

      copyLoadedRelationshipValue({
        sourceRelationship: reloaded.getRelationshipByName(relationshipName),
        targetRelationship: sibling.getRelationshipByName(relationshipName)
      })
    }

    // If the caller itself was not populated (record deleted/filtered between
    // the list fetch and this preload request), fall back to per-record load
    // so the caller gets a real not-found error instead of a misleading
    // "hasn't been preloaded" throw from loaded().
    if (!this.getRelationshipByName(relationshipName).getPreloaded()) return false

    return true
  }

  /**
   * Runs set relationship.
   * @param {string} relationshipName - Relationship name.
   * @param {FrontendModelBase | null | undefined} relationshipValue - Relationship value.
   * @returns {FrontendModelBase | null | undefined} - Assigned relationship value.
   */
  setRelationship(relationshipName, relationshipValue) {
    const ModelClass = frontendModelClassFor(this)
    const relationshipDefinition = ModelClass.relationshipDefinition(relationshipName)

    if (!relationshipDefinition) {
      throw new Error(`Unknown relationship: ${ModelClass.name}#${relationshipName}`)
    }

    const relationship = this.getRelationshipByName(relationshipName)

    if (relationship instanceof FrontendModelHasManyRelationship) {
      throw new Error(`Cannot set has-many relationship with setRelationship(): ${ModelClass.name}#${relationshipName}`)
    }

    relationship.setLoaded(relationshipValue)

    return relationshipValue
  }

  /**
   * Runs assign attributes.
   * @param {Attributes | CreateAttributes | UpdateAttributes | Record<string, FrontendModelAttributeValue>} attributes - Attributes to assign.
   * @returns {void} - No return value.
   */
  assignAttributes(attributes) {
    const attributeValues = /** @type {Record<string, FrontendModelAttributeValue>} */ (attributes)

    for (const key in attributeValues) {
      this.setAttribute(key, attributeValues[key])
    }
  }

  /**
   * Runs clear relationship cache.
   * @returns {void} - Clears cached relationship state.
   */
  clearRelationshipCache() {
    this._relationships = {}
  }

  /**
   * Runs primary key.
   * @this {FrontendModelClass}
   * @returns {string} - Primary key name.
   */
  static primaryKey() {
    return this.resourceConfig().primaryKey || "id"
  }

  /**
   * Runs primary key value.
   * @returns {number | string} - Primary key value.
   */
  primaryKeyValue() {
    const ModelClass = frontendModelClassFor(this)
    const value = this.readAttribute(ModelClass.primaryKey())

    if (value === undefined || value === null) {
      throw new Error(`Missing primary key '${ModelClass.primaryKey()}' on ${ModelClass.name}`)
    }

    return value
  }

  /**
   * Runs read attribute.
   * @param {string} attributeName - Attribute name.
   * @returns {?} - Attribute value.
   */
  readAttribute(attributeName) {
    if (this._selectedAttributes && !this._selectedAttributes.has(attributeName)) {
      throw new AttributeNotSelectedError(this.constructor.name, attributeName)
    }

    return this._attributes[attributeName]
  }

  /**
   * Whether an attribute value is currently loaded on this record. Used by the
   * preloader to decide whether a relationship can be skipped because the
   * requested columns are already present.
   * @param {string} attributeName - Attribute name.
   * @returns {boolean} - Whether the attribute is loaded.
   */
  hasLoadedAttribute(attributeName) {
    if (!this._selectedAttributes) return true

    return this._selectedAttributes.has(attributeName)
  }

  /**
   * Read an association count attached by `.withCount(...)`. Counts
   * live on a dedicated map separate from the record's attributes so
   * a virtual count like `tasksCount` can't silently shadow a real
   * column of the same name. Returns the attached value, or 0 when
   * `.withCount(...)` wasn't requested for this attribute.
   * @param {string} attributeName - Attribute name, e.g. `"tasksCount"` or a custom name from `.withCount({customName: {...}})`.
   * @returns {number} - Attached association count, or zero when absent.
   */
  readCount(attributeName) {
    return readPayloadAssociationCount(/** @type {import("../record-payload-values.js").RecordPayloadValuesTarget} */ (/** @type {?} */ (this)), attributeName)
  }

  /**
   * Internal setter called by `instantiateFromResponse` when hydrating
   * association counts that rode along with the record payload.
   * @param {string} attributeName - Attribute name.
   * @param {number} value - Count value.
   * @returns {void}
   */
  _setAssociationCount(attributeName, value) {
    setPayloadAssociationCount(/** @type {import("../record-payload-values.js").RecordPayloadValuesTarget} */ (/** @type {?} */ (this)), attributeName, value)
  }

  /**
   * Read a per-record ability result attached by `.abilities(...)`. The
   * backend evaluates each requested action against the current
   * ability for this record instance and ships the result alongside
   * the record's attributes. Returns `false` when the action wasn't
   * requested (or the ability denied it), so UI code can safely branch
   * on `record.can("update")` without first checking whether the
   * ability was loaded.
   * @param {string} action - Ability action name, e.g. `"update"`.
   * @returns {boolean} - Whether the requested ability is allowed.
   */
  can(action) {
    return readPayloadComputedAbility(/** @type {import("../record-payload-values.js").RecordPayloadValuesTarget} */ (/** @type {?} */ (this)), action)
  }

  /**
   * Internal setter called by `instantiateFromResponse` when hydrating
   * per-record ability results that rode along with the record
   * payload.
   * @param {string} action - Ability action name.
   * @param {boolean} value - Whether the current ability permits the action on this record.
   * @returns {void}
   */
  _setComputedAbility(action, value) {
    setPayloadComputedAbility(/** @type {import("../record-payload-values.js").RecordPayloadValuesTarget} */ (/** @type {?} */ (this)), action, value)
  }

  /**
   * Read a consumer-defined value attached by `.queryData(...)`. Stored
   * on a dedicated map rather than `_attributes`, so a virtual alias
   * like `tasksCount` cannot silently shadow a real column of the same
   * name. Returns `null` when no registered fn produced that alias for
   * this record (e.g. no child rows matched the aggregate).
   * @param {string} name - queryData alias name.
   * @returns {?} - Attached query-data value.
   */
  queryData(name) {
    return readPayloadQueryData(/** @type {import("../record-payload-values.js").RecordPayloadValuesTarget} */ (/** @type {?} */ (this)), name)
  }

  /**
   * Internal setter used by `instantiateFromResponse` when hydrating
   * queryData values that rode along with the record payload.
   * @param {string} name - queryData alias name.
   * @param {?} value - Attached value.
   * @returns {void}
   */
  _setQueryData(name, value) {
    setPayloadQueryData(/** @type {import("../record-payload-values.js").RecordPayloadValuesTarget} */ (/** @type {?} */ (this)), name, value)
  }

  /**
   * Runs set attribute.
   * @param {string} attributeName - Attribute name.
   * @param {?} newValue - New value.
   * @returns {?} - Assigned value.
   */
  setAttribute(attributeName, newValue) {
    const ModelClass = frontendModelClassFor(this)
    const nestedAttributesRelationshipName = ModelClass.nestedAttributesRelationshipName(attributeName)

    if (nestedAttributesRelationshipName) {
      this._pendingNestedAttributes[nestedAttributesRelationshipName] = newValue
      return newValue
    }

    if (ModelClass.attachmentDefinition(attributeName)) {
      this.getAttachmentByName(attributeName).queueAttach(newValue)
      return newValue
    }

    const previousValue = this._attributes[attributeName]

    this._attributes[attributeName] = newValue

    if (this._selectedAttributes) {
      this._selectedAttributes.add(attributeName)
    }

    // Only invalidate relationship cache entries whose foreign key matches the changed attribute.
    // Blanket-clearing all relationships on any attribute change destroys nested-save state
    // and preloaded children the caller never asked to invalidate.
    if (!Object.is(previousValue, newValue)) {
      this._invalidateRelationshipsForAttribute(attributeName)
    }

    return newValue
  }

  /**
   * Invalidates any cached belongsTo relationship whose foreign key matches the
   * changed attribute. HasMany / hasOne relationships are left untouched because
   * their foreign key lives on the child, not on this model, and blanket-clearing
   * them would destroy nested-save state and preloaded children the caller never
   * asked to invalidate.
   *
   * Foreign keys are inferred when not declared: for belongsTo `projectId` is
   * inferred from relationship name `project`. Explicit `foreignKey` on the
   * relationship definition takes precedence.
   * @param {string} attributeName - Attribute name that changed.
   * @returns {void}
   */
  _invalidateRelationshipsForAttribute(attributeName) {
    if (!this._relationships || Object.keys(this._relationships).length === 0) return

    const ModelClass = frontendModelClassFor(this)
    const definitions = ModelClass.relationshipDefinitions()

    for (const relationshipName of Object.keys(this._relationships)) {
      const definition = /** @type {?} */ (definitions[relationshipName])

      if (!definition || definition.type !== "belongsTo") continue

      const foreignKey = definition.foreignKey || `${relationshipName}Id`

      if (foreignKey === attributeName) {
        delete this._relationships[relationshipName]
      }
    }
  }

  /**
   * Runs resource path.
   * @this {FrontendModelClass}
   * @returns {string} - Derived resource path.
   */
  static resourcePath() {
    return validateFrontendModelResourcePath({
      modelName: this.getModelName(),
      resourcePath: defaultFrontendModelResourcePath(this)
    })
  }

  /**
   * Runs command name.
   * @this {FrontendModelClass}
   * @param {FrontendModelCommandType} commandType - Command type.
   * @returns {string} - Resolved command name.
   */
  static commandName(commandType) {
    const resourceConfig = this.resourceConfig()
    const builtInCollectionCommands = resourceConfig.builtInCollectionCommands || []
    const builtInMemberCommands = resourceConfig.builtInMemberCommands || []
    const commands = resourceConfig.commands || []
    const isExposed = builtInCollectionCommands.includes(commandType) || builtInMemberCommands.includes(commandType) || commands.includes(commandType)
    const commandName = isExposed ? inflection.dasherize(inflection.underscore(commandType)) : commandType

    return validateFrontendModelResourceCommandName({
      commandName,
      commandType,
      modelName: this.getModelName()
    })
  }

  /**
   * Runs normalize custom command payload arguments.
   * @this {FrontendModelClass}
   * @param {Array<?>} args - Command arguments.
   * @returns {Record<string, ?>} - Command payload.
   */
  static normalizeCustomCommandPayloadArguments(args) {
    if (args.length === 0) return {}
    if (args.length === 1) {
      const payload = args[0]
      if (payload === undefined) {
        return {}
      }

      if (typeof payload !== "object" || payload === null) {
        return {arg1: payload}
      }

      return /** @type {Record<string, ?>} */ (payload)
    }

    /**
     * Payload.
     * @type {Record<string, number | string | Array<?>>} */
    const payload = {}

    for (let index = 0; index < args.length; index += 1) {
      payload[`arg${index + 1}`] = args[index]
    }

    return payload
  }

  /**
   * Returns the model name, preferring an explicit `static modelName` declaration
   * over the JavaScript class `.name` property. This allows minified builds to
   * preserve correct model names without relying on `keep_classnames`.
   * @this {FrontendModelClass}
   * @returns {string} - The model name.
   */
  static getModelName() {
    const resourceConfig = this.resourceConfig()
    const modelName = resourceConfig?.modelName

    return (typeof modelName === "string" && modelName.length > 0) ? modelName : this.name
  }

  /**
   * Runs configure transport.
   * @param {FrontendModelTransportConfig} config - Frontend model transport configuration.
   * @returns {void} - No return value.
   */
  static configureTransport(config) {
    if (!config || typeof config !== "object") {
      return
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

    if (Object.prototype.hasOwnProperty.call(config, "websocketUrl")) {
      frontendModelTransportConfig.websocketUrl = config.websocketUrl
      // Reset cached internal client so the new URL takes effect on next subscribe
      resetInternalWebsocketClient()
    }

    if (Object.prototype.hasOwnProperty.call(config, "requestHeaders")) {
      frontendModelTransportConfig.requestHeaders = config.requestHeaders
    }

    if (Object.prototype.hasOwnProperty.call(config, "timeout")) {
      frontendModelTransportConfig.timeout = config.timeout
    }

    if (Object.prototype.hasOwnProperty.call(config, "signal")) {
      if (frontendModelTransportConfig.signal !== config.signal) {
        frontendModelTransportConfig.signal = config.signal
        resetInternalWebsocketClient()
      }
    }

    if (Object.prototype.hasOwnProperty.call(config, "timeZone")) {
      if (config.timeZone === undefined) {
        delete frontendModelTransportConfig.timeZone
      } else {
        frontendModelTransportConfig.timeZone = config.timeZone
      }
    }

    if (Object.prototype.hasOwnProperty.call(config, "sessionStore")) {
      frontendModelTransportConfig.sessionStore = config.sessionStore
      // Reset cached internal client so the new sessionStore is picked up.
      resetInternalWebsocketClient()
    }

    if (Object.prototype.hasOwnProperty.call(config, "offlineSync")) {
      frontendModelTransportConfig.offlineSync = config.offlineSync
    }
  }

  /**
   * Connect the internal WebSocket and enable auto-reconnect.
   * @param {{timeoutMs?: number, signal?: AbortSignal}} [options] - Startup controls composed with the configured transport controls.
   * @returns {Promise<void>} - Resolves when connected.
   */
  static async connectWebsocket(options = {}) {
    const client = resolveInternalWebsocketClient()

    if (!client) {
      throw new Error("connectWebsocket requires configureTransport({websocketUrl})")
    }

    await client.connect(frontendModelWebsocketStartupControls(options))
  }

  /**
   * Disconnect the internal WebSocket and disable auto-reconnect.
   * @returns {Promise<void>} - Resolves when closed.
   */
  static async disconnectWebsocket() {
    if (!internalWebsocketClient) return

    const client = internalWebsocketClient

    internalWebsocketClient = null
    internalWebsocketClientSignalCleanup?.()
    internalWebsocketClientSignal = null
    internalWebsocketClientSignalCleanup = null
    await client.disconnectAndStopReconnect()
  }

  /**
   * Waits until queued and active frontend-model transport requests finish.
   * @param {FrontendModelIdleWaitArgs} [args] - Wait options.
   * @returns {Promise<void>} - Resolves when transport is idle.
   */
  static async waitForIdle(args = {}) {
    const {quietMs = 0, timeout: timeoutMs = 5000, ...restArgs} = args
    const restArgKeys = Object.keys(restArgs)

    if (restArgKeys.length > 0) {
      throw new Error(`Unknown waitForIdle args: ${restArgKeys.join(", ")}`)
    }

    if (!Number.isFinite(quietMs) || quietMs < 0) {
      throw new Error(`Expected waitForIdle quietMs to be a non-negative number, got: ${quietMs}`)
    }

    await timeout(
      {timeout: timeoutMs, errorMessage: "Timed out waiting for frontend model transport to become idle"},
      async () => await waitForFrontendModelTransportIdle(quietMs)
    )
  }

  /**
   * Returns the current WebSocket connection state.
   * @returns {{disconnectedSince: number | null, hasClient: boolean, isOpen: boolean, listenerCount: number}} - Snapshot of the managed websocket connection state.
   */
  static websocketState() {
    if (!internalWebsocketClient) {
      return {disconnectedSince: null, hasClient: false, isOpen: false, listenerCount: 0}
    }

    return {
      ...internalWebsocketClient.state(),
      hasClient: true
    }
  }

  /**
   * Close the raw WebSocket without disabling auto-reconnect. Used by tests to
   * simulate an unexpected network drop and verify reconnection behavior.
   * @returns {Promise<void>} - Resolves when the socket has closed.
   */
  static async dropWebsocket() {
    if (!internalWebsocketClient) return

    await internalWebsocketClient.dropConnection()
  }

  /**
   * Sets global metadata on the WebSocket connection. Sent to the server immediately
   * over WebSocket and exposed to WebSocket-borne requests as request metadata.
   * @param {string} key - Metadata key.
   * @param {?} value - Metadata value (null to clear).
   * @returns {void}
   */
  static setWebsocketMetadata(key, value) {
    const client = /** @type {?} */ (frontendModelTransportConfig.websocketClient || resolveInternalWebsocketClient())

    if (!client || typeof client.setMetadata !== "function") return

    client.setMetadata(key, value)
  }

  /**
   * Opens a managed connection that auto-opens, auto-closes, and
   * auto-reconnects based on `shouldConnect()` and `params()`.
   * Call `handle.sync()` whenever the inputs that drive those
   * functions change (e.g. current-user sign-in/out). The handle
   * retries when the WS client isn't ready and reopens on close.
   * @param {string} connectionType - Connection class name registered on the server.
   * @param {{shouldConnect: () => boolean, params: () => Record<string, ?>, signal?: AbortSignal, onMessage?: (body: ?) => void}} options - Connection lifecycle, cancellation, and payload callbacks.
   * @returns {{sync: () => void, close: () => void}} - Handle used to resync or close the managed connection.
   */
  static openManagedConnection(connectionType, options) {
    /**
     * Connection.
     * @type {?} */
    let connection = null
    let closed = false
    /**
     * Retry timer.
     * @type {ReturnType<typeof setTimeout> | null} */
    let retryTimer = null
    let lastParamsJson = ""
    const controls = frontendModelWebsocketStartupControls({signal: options.signal})
    const clearRetryTimer = () => {
      if (retryTimer === null) return

      globalThis.clearTimeout(retryTimer)
      retryTimer = null
    }

    const close = () => {
      if (closed) return

      closed = true
      clearRetryTimer()
      controls.signal?.removeEventListener("abort", close)
      if (connection && !connection.isClosed()) connection.close()
      connection = null
    }

    const sync = () => {
      if (closed) return

      if (!options.shouldConnect()) {
        clearRetryTimer()
        if (connection && !connection.isClosed()) connection.close()
        connection = null
        lastParamsJson = ""
        return
      }

      const nextParams = options.params()
      const nextParamsJson = JSON.stringify(nextParams)

      // Already connected with same params — nothing to do.
      if (connection && !connection.isClosed() && nextParamsJson === lastParamsJson) return

      // Connected but params changed — send update message.
      // Guard with try/catch: the connection handle stays live during
      // reconnect but the underlying socket may be closed.
      if (connection && !connection.isClosed()) {
        try {
          connection.sendMessage(nextParams)
          lastParamsJson = nextParamsJson
          return
        } catch {
          connection = null
          lastParamsJson = ""
        }
      }

      // WS client not ready — retry. Check the actual client (which
      // may be an injected websocketClient) instead of websocketState()
      // which only reflects the internal client.
      const client = /** @type {?} */ (frontendModelTransportConfig.websocketClient || resolveInternalWebsocketClient())

      if (!client || !client.isOpen()) {
        if (retryTimer === null) {
          retryTimer = globalThis.setTimeout(() => {
            retryTimer = null
            sync()
          }, 250)
        }
        return
      }

      lastParamsJson = nextParamsJson
      connection = client.openConnection(connectionType, {
        params: nextParams,
        onMessage: options.onMessage,
        onClose: () => {
          if (connection?.isClosed()) {
            connection = null
            lastParamsJson = ""
            sync()
          }
        }
      })
    }

    controls.signal?.addEventListener("abort", close, {once: true})

    if (controls.signal?.aborted) {
      close()
    } else {
      sync()
    }

    return {sync, close}
  }

  /**
   * Opens a 1:1 `WebsocketConnection` of the given type. Thin
   * convenience wrapper around the internal WS client's
   * `openConnection`. Apps use this for per-session state/messaging
   * that doesn't fit the pub/sub Channel model (locale, presence).
   * @param {string} connectionType - Name the server registered the class under.
   * @param {{params?: Record<string, ?>, timeoutMs?: number, signal?: AbortSignal, onConnect?: () => void, onMessage?: (body: Record<string, unknown>) => void, onDisconnect?: () => void, onResume?: () => void, onClose?: (reason: string) => void}} [options] - Connection options, readiness controls, and event handlers. Connect the client first; the timeout covers server-confirmed readiness and the signal cancels readiness without entering the wire payload.
   * @returns {{ready: Promise<void>, close: () => void}} - Websocket connection handle.
   */
  static openWebsocketConnection(connectionType, options = {}) {
    const client = /** @type {?} */ (frontendModelTransportConfig.websocketClient || resolveInternalWebsocketClient())

    if (!client || typeof client.openConnection !== "function") {
      throw new Error("openWebsocketConnection requires configureTransport({websocketUrl})")
    }

    const {signal, timeoutMs, ...connectionOptions} = options

    return client.openConnection(connectionType, {
      ...connectionOptions,
      ...frontendModelWebsocketStartupControls({signal, timeoutMs})
    })
  }

  /**
   * Subscribes to a pub/sub `WebsocketChannel`. Thin wrapper around
   * the internal client's `subscribeChannel`.
   * @param {string} channelType - Channel class name registered on the server.
   * @param {{params?: Record<string, ?>, timeoutMs?: number, signal?: AbortSignal, onMessage?: (body: Record<string, unknown>) => void, onDisconnect?: () => void, onResume?: () => void, onClose?: (reason: string) => void}} [options] - Channel options, startup controls, and event handlers. The timeout covers connect and server-confirmed readiness only; the signal cancels startup without entering the wire payload.
   * @returns {{ready: Promise<void>, close: () => void}} - Websocket channel handle from the configured client.
   */
  static subscribeWebsocketChannel(channelType, options = {}) {
    const client = /** @type {?} */ (frontendModelTransportConfig.websocketClient || resolveInternalWebsocketClient())

    if (!client || typeof client.subscribeChannel !== "function") {
      throw new Error("subscribeWebsocketChannel requires configureTransport({websocketUrl})")
    }

    const {signal, timeoutMs, ...channelOptions} = options
    const startupControls = frontendModelWebsocketStartupControls({signal, timeoutMs})
    const handle = client.subscribeChannel(channelType, {...channelOptions, ...startupControls})

    void client.connect(startupControls).catch(() => handle.close())

    return handle
  }

  /**
   * Installs WebSocket lifecycle hooks on globalThis for system test access.
   * Tests can call `globalThis.__velocious_websocket_hooks.connect()` etc.
   * @returns {void}
   */
  static installWebsocketTestHooks() {
    if (typeof globalThis === "undefined") return

    /** @type {?} */ (globalThis).__velocious_websocket_hooks = {
      connect: () => this.connectWebsocket(),
      disconnect: () => this.disconnectWebsocket(),
      drop: () => this.dropWebsocket(),
      state: () => this.websocketState()
    }
  }

  /**
   * Runs attributes from response.
   * @this {FrontendModelClass}
   * @param {object} response - Response payload.
   * @returns {Record<string, FrontendModelAttributeValue>} - Attributes from payload.
   */
  static attributesFromResponse(response) {
    const modelData = this.modelDataFromResponse(response)

    return modelData.attributes
  }

  /**
   * Runs model data from response.
   * @this {FrontendModelClass}
   * @param {object} response - Response payload.
   * @returns {{abilities: Record<string, boolean>, attributes: Record<string, FrontendModelAttributeValue>, associationCounts: Record<string, number>, queryData: Record<string, FrontendModelAttributeValue>, preloadedRelationships: Record<string, FrontendModelAttributeValue>, selectedAttributes: Set<string>}} - Attributes, preloaded relationships, association counts, queryData, abilities, and the selected-attributes set.
   */
  static modelDataFromResponse(response) {
    if (!response || typeof response !== "object") {
      throw new Error(`Expected object response but got: ${response}`)
    }

    // Narrows the response object to the frontend-model transport value map.
    const responseObject = /** @type {Record<string, FrontendModelAttributeValue>} */ (response)

    /**
     * Defines modelData.
     * @type {Record<string, FrontendModelAttributeValue>} */
    let modelData

    if (responseObject.model && typeof responseObject.model === "object") {
      // Narrows the nested model payload to the frontend-model value map.
      modelData = /** @type {Record<string, FrontendModelAttributeValue>} */ (responseObject.model)
    } else if (responseObject.attributes && typeof responseObject.attributes === "object") {
      // Narrows the nested attributes payload to the frontend-model value map.
      modelData = /** @type {Record<string, FrontendModelAttributeValue>} */ (responseObject.attributes)
    } else {
      modelData = responseObject
    }

    const attributes = /** @type {Record<string, FrontendModelAttributeValue>} */ ({...modelData})
    const preloadedRelationships = isPlainObject(attributes[PRELOADED_RELATIONSHIPS_KEY])
      ? /** @type {Record<string, FrontendModelAttributeValue>} */ (attributes[PRELOADED_RELATIONSHIPS_KEY])
      : {}
    const associationCounts = isPlainObject(attributes[ASSOCIATION_COUNTS_KEY])
      ? /** @type {Record<string, number>} */ (attributes[ASSOCIATION_COUNTS_KEY])
      : {}
    const queryData = isPlainObject(attributes[QUERY_DATA_KEY])
      ? /** @type {Record<string, FrontendModelAttributeValue>} */ (attributes[QUERY_DATA_KEY])
      : {}
    const abilities = isPlainObject(attributes[ABILITIES_KEY])
      ? /** @type {Record<string, boolean>} */ (attributes[ABILITIES_KEY])
      : {}
    const selectedAttributesFromPayload = Array.isArray(attributes[SELECTED_ATTRIBUTES_KEY])
      ? new Set(/** @type {string[]} */ (attributes[SELECTED_ATTRIBUTES_KEY]).filter((attributeName) => typeof attributeName === "string"))
      : null

    delete attributes[PRELOADED_RELATIONSHIPS_KEY]
    delete attributes[SELECTED_ATTRIBUTES_KEY]
    delete attributes[ASSOCIATION_COUNTS_KEY]
    delete attributes[QUERY_DATA_KEY]
    delete attributes[ABILITIES_KEY]

    const selectedAttributes = selectedAttributesFromPayload || new Set(Object.keys(attributes))

    return {abilities, attributes, associationCounts, queryData, preloadedRelationships, selectedAttributes}
  }

  /**
   * Runs apply preloaded relationships.
   * @this {FrontendModelClass}
   * @param {FrontendModelBase} model - Model instance.
   * @param {Record<string, ?>} preloadedRelationships - Preloaded relationship payload.
   * @returns {void}
   */
  static applyPreloadedRelationships(model, preloadedRelationships) {
    for (const [relationshipName, relationshipPayload] of Object.entries(preloadedRelationships)) {
      const relationship = model.getRelationshipByName(relationshipName)
      const targetModelClass = this.relationshipModelClass(relationshipName)

      if (relationship instanceof FrontendModelHasManyRelationship) {
        if (!Array.isArray(relationshipPayload)) {
          throw new Error(`Expected ${this.name}#${relationshipName} payload to be an array`)
        }

        /** @type {Array<FrontendModelBase>} */
        const relatedModels = []

        for (const entry of relationshipPayload) {
          const relatedModel = this.instantiateRelationshipValue(entry, targetModelClass)

          if (!(relatedModel instanceof FrontendModelBase)) {
            throw new Error(`Expected ${this.name}#${relationshipName} payload entry to instantiate a frontend model`)
          }

          relatedModels.push(relatedModel)
        }

        relationship.setLoaded(relatedModels)
        continue
      }

      if (Array.isArray(relationshipPayload)) {
        throw new Error(`Expected ${this.name}#${relationshipName} payload to be singular`)
      }

      const relatedModel = this.instantiateRelationshipValue(relationshipPayload, targetModelClass)

      if (relatedModel != undefined && !(relatedModel instanceof FrontendModelBase)) {
        throw new Error(`Expected ${this.name}#${relationshipName} payload to instantiate a frontend model`)
      }

      relationship.setLoaded(relatedModel)
    }
  }

  /**
   * Runs instantiate relationship value.
   * @this {FrontendModelClass}
   * @param {?} relationshipPayload - Relationship payload value.
   * @param {FrontendModelClass | null} targetModelClass - Target model class.
   * @returns {?} - Instantiated relationship value.
   */
  static instantiateRelationshipValue(relationshipPayload, targetModelClass) {
    if (!targetModelClass) return relationshipPayload

    if (!relationshipPayload || typeof relationshipPayload !== "object") return relationshipPayload

    return targetModelClass.instantiateFromResponse(relationshipPayload)
  }

  /**
   * Runs instantiate from response.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {Record<string, ?> | InstanceType<T>} response - Response payload, or an already-hydrated instance of this class.
   * @returns {InstanceType<T>} - New model instance, or the same instance unchanged if it was already hydrated.
   */
  static instantiateFromResponse(response) {
    // Idempotent: if a caller hands us an already-hydrated instance of this
    // class (now common because the shared frontend-model API auto-serializes
    // backend `Record` instances returned from custom commands and the
    // transport deserializer hydrates them into models before the call site
    // sees the response), return it as-is. Without this, code that has
    // historically wrapped custom-command responses in
    // `Model.instantiateFromResponse(response.field)` would spread the live
    // model instance into a new constructor call and produce a broken model
    // with internal state keys promoted to attributes.
    if (response instanceof this) {
      return /** @type {InstanceType<T>} */ (response)
    }

    const modelData = this.modelDataFromResponse(response)
    const attributes = modelData.attributes
    const preloadedRelationships = modelData.preloadedRelationships
    const associationCounts = modelData.associationCounts
    const queryData = modelData.queryData
    const abilities = modelData.abilities
    const selectedAttributes = modelData.selectedAttributes
    const receiver = /** @type {unknown} */ (this)
    const ModelClass = /** @type {new (attributes?: Record<string, FrontendModelAttributeValue>) => InstanceType<T>} */ (receiver)
    const model = new ModelClass(attributes)
    model._selectedAttributes = selectedAttributes ? new Set(selectedAttributes) : null

    this.applyPreloadedRelationships(model, preloadedRelationships)

    for (const [attributeName, value] of Object.entries(associationCounts || {})) {
      model._setAssociationCount(attributeName, Number(value) || 0)
    }

    for (const [name, value] of Object.entries(queryData || {})) {
      model._setQueryData(name, value)
    }

    for (const [action, value] of Object.entries(abilities || {})) {
      model._setComputedAbility(action, Boolean(value))
    }

    model.setIsNewRecord(false)
    model._persistedAttributes = cloneFrontendModelAttributes(model.attributes())

    return model
  }

  /**
   * Runs find.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {number | string} id - Record identifier.
   * @returns {Promise<InstanceType<T>>} - Resolved model.
   */
  static async find(id) {
    return await this.query().find(id)
  }

  /**
   * Runs find by.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {Record<string, ?>} conditions - Attribute match conditions.
   * @returns {Promise<InstanceType<T> | null>} - Found model or null.
   */
  static async findBy(conditions) {
    return await this.query().findBy(conditions)
  }

  /**
   * Runs find by or fail.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {Record<string, ?>} conditions - Attribute match conditions.
   * @returns {Promise<InstanceType<T>>} - Found model.
   */
  static async findByOrFail(conditions) {
    return await this.query().findByOrFail(conditions)
  }

  /**
   * Runs to array.
   * @template {FrontendModelClass} T
   * @this {T}
   * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
   */
  static async toArray() {
    return await this.query().toArray()
  }

  /**
   * Runs load.
   * @template {FrontendModelClass} T
   * @this {T}
   * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
   */
  static async load() {
    return await this.query().load()
  }

  /**
   * Runs all.
   * @template {FrontendModelClass} T
   * @this {T}
   * @returns {FrontendModelQuery<T>} - Query builder.
   */
  static all() {
    return this.query()
  }

  /**
   * Runs where.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {Record<string, ?>} conditions - Root-model where conditions.
   * @returns {import("./query.js").default<T>} - Query with where conditions.
   */
  static where(conditions) {
    return this.query().where(conditions)
  }

  /**
   * Runs joins.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {Record<string, ?> | Array<Record<string, ?>>} joins - Relationship descriptor joins.
   * @returns {import("./query.js").default<T>} - Query with joins.
   */
  static joins(joins) {
    return this.query().joins(joins)
  }

  /**
   * Runs limit.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {number} value - Maximum number of records.
   * @returns {import("./query.js").default<T>} - Query with limit.
   */
  static limit(value) {
    return this.query().limit(value)
  }

  /**
   * Runs offset.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {number} value - Number of records to skip.
   * @returns {import("./query.js").default<T>} - Query with offset.
   */
  static offset(value) {
    return this.query().offset(value)
  }

  /**
   * Runs page.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {number} pageNumber - 1-based page number.
   * @returns {import("./query.js").default<T>} - Query with page applied.
   */
  static page(pageNumber) {
    return this.query().page(pageNumber)
  }

  /**
   * Runs per page.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {number} value - Number of records per page.
   * @returns {import("./query.js").default<T>} - Query with page size.
   */
  static perPage(value) {
    return this.query().perPage(value)
  }

  /**
   * Runs count.
   * @template {FrontendModelClass} T
   * @this {T}
   * @returns {Promise<number>} - Number of loaded model instances.
   */
  static async count() {
    return await this.query().count()
  }

  /**
   * Class-level hook fired when any record of this model is created.
   * Subscribe-time authorization only — once a subscription is
   * accepted, future `create` events for this model are delivered
   * without re-checking per-record visibility. Query options can still
   * narrow which events reach this callback.
   * @this {FrontendModelClass}
   * @param {(payload: {id: string, model: FrontendModelBase}) => void} callback - Event callback.
   * @param {import("./query.js").FrontendModelEventOptions} [options] - Event query or record projection options.
   * @returns {Promise<() => void>} - Unsubscribe callback.
   */
  static async onCreate(callback, options = {}) {
    const sub = ensureFrontendModelEventSubscription(this)
    const entry = {callback, ...frontendModelEventOptionsPayload(this, options)}

    sub.classCreateCallbacks.add(entry)
    await sub.ensureSubscribed()

    return () => {
      sub.classCreateCallbacks.delete(entry)
      sub.maybeTeardown()
    }
  }

  /**
   * Class-level hook fired when any record of this model is updated.
   * @this {FrontendModelClass}
   * @param {(payload: {id: string, model: FrontendModelBase}) => void} callback - Event callback.
   * @param {import("./query.js").FrontendModelEventOptions} [options] - Event query or record projection options.
   * @returns {Promise<() => void>} - Unsubscribe callback.
   */
  static async onUpdate(callback, options = {}) {
    const sub = ensureFrontendModelEventSubscription(this)
    const entry = {callback, ...frontendModelEventOptionsPayload(this, options)}

    sub.classUpdateCallbacks.add(entry)
    await sub.ensureSubscribed()

    return () => {
      sub.classUpdateCallbacks.delete(entry)
      sub.maybeTeardown()
    }
  }

  /**
   * Class-level hook fired when any record of this model is destroyed.
   * @this {FrontendModelClass}
   * @param {(payload: {id: string}) => void} callback - Event callback.
   * @param {import("./query.js").FrontendModelEventOptions} [options] - Accepted for API symmetry; destroy events carry ids only.
   * @returns {Promise<() => void>} - Unsubscribe callback.
   */
  static async onDestroy(callback, options = {}) {
    assertNoDestroyEventFilter(this, options)

    const sub = ensureFrontendModelEventSubscription(this)
    const entry = {callback}

    sub.classDestroyCallbacks.add(entry)
    await sub.ensureSubscribed()

    return () => {
      sub.classDestroyCallbacks.delete(entry)
      sub.maybeTeardown()
    }
  }

  /**
   * Instance-level hook fired when THIS record is updated. The
   * instance's attributes are auto-merged with the broadcast payload
   * before the callback runs, so callers can read fresh values via
   * `this.someAttr()` without re-fetching.
   * @param {(payload: {id: string, model: FrontendModelBase}) => void} callback - Event callback.
   * @param {import("./query.js").FrontendModelEventOptions} [options] - Event query or record projection options.
   * @returns {Promise<() => void>} - Unsubscribe callback.
   */
  async onUpdate(callback, options = {}) {
    const self = /** @type {?} */ (this)
    const ModelClass = frontendModelClassFor(this)
    const sub = ensureFrontendModelEventSubscription(ModelClass)
    const id = String(self.id())
    const entry = {callback, ...frontendModelEventOptionsPayload(ModelClass, options)}
    const listener = ensureFrontendModelInstanceListener(sub, id, this)

    listener.updateCallbacks.add(entry)
    await sub.ensureSubscribed()

    return () => {
      const current = sub.instanceListeners.get(id)

      if (!current) return
      current.updateCallbacks.delete(entry)

      if (current.updateCallbacks.size === 0 && current.destroyCallbacks.size === 0) {
        sub.instanceListeners.delete(id)
      }
      sub.maybeTeardown()
    }
  }

  /**
   * Instance-level hook fired when THIS record is destroyed.
   * @param {(payload: {id: string}) => void} callback - Event callback.
   * @param {import("./query.js").FrontendModelEventOptions} [options] - Accepted for API symmetry; destroy events carry ids only.
   * @returns {Promise<() => void>} - Unsubscribe callback.
   */
  async onDestroy(callback, options = {}) {
    const self = /** @type {?} */ (this)
    const ModelClass = frontendModelClassFor(this)

    assertNoDestroyEventFilter(ModelClass, options)

    const sub = ensureFrontendModelEventSubscription(ModelClass)
    const id = String(self.id())
    const entry = {callback}
    const listener = ensureFrontendModelInstanceListener(sub, id, this)

    listener.destroyCallbacks.add(entry)
    await sub.ensureSubscribed()

    return () => {
      const current = sub.instanceListeners.get(id)

      if (!current) return
      current.destroyCallbacks.delete(entry)

      if (current.updateCallbacks.size === 0 && current.destroyCallbacks.size === 0) {
        sub.instanceListeners.delete(id)
      }
      sub.maybeTeardown()
    }
  }

  /**
   * Runs pluck.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {...(string | string[] | Record<string, ?> | Array<Record<string, ?>>)} columns - Pluck definition(s).
   * @returns {Promise<Array<?>>} - Plucked values.
   */
  static async pluck(...columns) {
    return await this.query().pluck(...columns)
  }

  /**
   * Runs search.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {string[]} path - Relationship path.
   * @param {string} column - Column or attribute name.
   * @param {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | ">" | ">=" | "<" | "<="} operator - Search operator.
   * @param {?} value - Search value.
   * @returns {FrontendModelQuery<T>} - Query builder with search filter.
   */
  static search(path, column, operator, value) {
    return this.query().search(path, column, operator, value)
  }

  /**
   * Runs ransack.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {Record<string, ?>} params - Ransack-style params hash.
   * @returns {FrontendModelQuery<T>} - Query builder with Ransack filters applied.
   */
  static ransack(params) {
    return this.query().ransack(params)
  }

  /**
   * Runs sort.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ?> | Array<Record<string, ?>>} sort - Sort definition(s).
   * @returns {FrontendModelQuery<T>} - Query builder with sort definitions.
   */
  static sort(sort) {
    return this.query().sort(sort)
  }

  /**
   * Runs order.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ?> | Array<Record<string, ?>>} sort - Sort definition(s).
   * @returns {FrontendModelQuery<T>} - Query builder with sort definitions.
   */
  static order(sort) {
    return this.query().order(sort)
  }

  /**
   * Runs group.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {string | string[] | Record<string, ?> | Array<Record<string, ?>>} group - Group definition(s).
   * @returns {FrontendModelQuery<T>} - Query builder with group definitions.
   */
  static group(group) {
    return this.query().group(group)
  }

  /**
   * Runs distinct.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {boolean} [value] - Whether to request distinct rows.
   * @returns {FrontendModelQuery<T>} - Query builder with distinct flag.
   */
  static distinct(value = true) {
    return this.query().distinct(value)
  }

  /**
   * Runs query.
   * @template {FrontendModelClass} T
   * @this {T}
   * @returns {FrontendModelQuery<T>} - Query builder.
   */
  static query() {
    return /** @type {FrontendModelQuery<T>} */ (new FrontendModelQuery({modelClass: this}))
  }

  /**
   * Runs preload.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>} preload - Preload graph.
   * @returns {FrontendModelQuery<T>} - Query with preload.
   */
  static preload(preload) {
    return /** @type {FrontendModelQuery<T>} */ (this.query().preload(preload))
  }

  /**
   * Runs select.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {Record<string, string[] | string> | string | string[]} select - Model-aware attribute select map or root-model shorthand.
   * @returns {FrontendModelQuery<T>} - Query with selected attributes.
   */
  static select(select) {
    return /** @type {FrontendModelQuery<T>} */ (this.query().select(select))
  }

  /**
   * Runs selects extra.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {Record<string, string[] | string> | string | string[]} select - Extra attributes to load in addition to the defaults, keyed by model name or root-model shorthand.
   * @returns {FrontendModelQuery<T>} - Query with extra selected attributes.
   */
  static selectsExtra(select) {
    return /** @type {FrontendModelQuery<T>} */ (this.query().selectsExtra(select))
  }

  /**
   * Runs first.
   * @template {FrontendModelClass} T
   * @this {T}
   * @returns {Promise<InstanceType<T> | null>} - First model or null.
   */
  static async first() {
    return await this.query().first()
  }

  /**
   * Runs last.
   * @template {FrontendModelClass} T
   * @this {T}
   * @returns {Promise<InstanceType<T> | null>} - Last model or null.
   */
  static async last() {
    return await this.query().last()
  }

  /**
   * Runs find or initialize by.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {Record<string, ?>} conditions - Attribute match conditions.
   * @returns {Promise<InstanceType<T>>} - Existing or initialized model.
   */
  static async findOrInitializeBy(conditions) {
    return await this.query().findOrInitializeBy(conditions)
  }

  /**
   * Runs find or create by.
   * @template {FrontendModelClass} T
   * @this {T}
   * @param {Record<string, ?>} conditions - Attribute match conditions.
   * @param {(model: InstanceType<T>) => Promise<void> | void} [callback] - Optional callback before save when created.
   * @returns {Promise<InstanceType<T>>} - Existing or newly created model.
   */
  static async findOrCreateBy(conditions, callback) {
    return await this.query().findOrCreateBy(conditions, callback)
  }

  /**
   * Runs create.
   * @template {FrontendModelClass} ModelClass
   * @this {ModelClass}
   * @param {FrontendModelCreateAttributesFor<InstanceType<ModelClass>>} [attributes] - Initial attributes.
   * @returns {Promise<InstanceType<ModelClass>>} - Persisted model.
   */
  static async create(attributes) {
    const receiver = /** @type {unknown} */ (this)
    const ModelClass = /** @type {new (attributes?: FrontendModelCreateAttributesFor<InstanceType<ModelClass>>) => InstanceType<ModelClass>} */ (receiver)
    const model = new ModelClass(attributes)

    await model.save()

    return model
  }

  /**
   * Runs assert find by conditions.
   * @this {FrontendModelClass}
   * @param {Record<string, ?>} conditions - findBy conditions.
   * @returns {void}
   */
  static assertFindByConditions(conditions) {
    assertFindByConditionsShape(conditions)

    Object.keys(conditions).forEach((key) => {
      assertDefinedFindByConditionValue(conditions[key], key)
    })
  }

  /**
   * Runs matches find by conditions.
   * @this {FrontendModelClass}
   * @param {FrontendModelBase} model - Candidate model.
   * @param {Record<string, ?>} conditions - Match conditions.
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
   * Runs find by condition value matches.
   * @this {FrontendModelClass}
   * @param {?} actualValue - Actual model value.
   * @param {?} expectedValue - Expected find condition value.
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

      const actualObject = /** @type {Record<string, ?>} */ (actualValue)
      const expectedObject = /** @type {Record<string, ?>} */ (expectedValue)
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
   * Runs find by primitive values match.
   * @this {FrontendModelClass}
   * @param {?} actualValue - Actual model value.
   * @param {?} expectedValue - Expected find condition value.
   * @returns {boolean} - Whether primitive values match after safe coercion.
   */
  static findByPrimitiveValuesMatch(actualValue, expectedValue) {
    if (actualValue instanceof Date && typeof expectedValue === "string") {
      const normalizedExpectedValue = normalizeDateStringForWrite(expectedValue, {timeZone: frontendModelTransportTimeZone()})

      if (normalizedExpectedValue instanceof Date) {
        return actualValue.toISOString() === normalizedExpectedValue.toISOString()
      }

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
   * Runs find by numeric string matches number.
   * @this {FrontendModelClass}
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
   * Runs update.
   * @param {UpdateAttributes} [newAttributes] - New values to assign before update.
   * @returns {Promise<this>} - Updated model.
   */
  async update(newAttributes) {
    if (newAttributes) this.assignAttributes(newAttributes)

    return /** @type {this} */ (await this.save())
  }

  /**
   * Runs attach.
   * @param {?} attachmentInput - Attachment input or named attachment payload.
   * @returns {Promise<void>} - Resolves when attached.
   */
  async attach(attachmentInput) {
    const ModelClass = frontendModelClassFor(this)
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
   * Runs save.
   * @returns {Promise<this>} - Saved model.
   */
  async save() {
    const ModelClass = frontendModelClassFor(this)
    const isNew = this.isNewRecord()
    const commandType = isNew ? "create" : "update"
    /**
     * Payload.
     * @type {Record<string, ?>} */
    const payload = {
      attributes: this._changedAttributesForSave()
    }

    if (!isNew) {
      payload.id = this.primaryKeyValue()
    }

    const nestedAttributes = await this._buildNestedAttributesPayload()

    if (nestedAttributes && Object.keys(nestedAttributes).length > 0) {
      payload.nestedAttributes = nestedAttributes
    }

    const attachments = await this._buildAttachmentsPayload()

    if (Object.keys(attachments).length > 0) {
      payload.attachments = attachments
    }

    if (shouldQueueFrontendModelOperationOffline(ModelClass, commandType)) {
      const offlineAttributes = {...payload.attributes}
      let clientMutationId

      if (isNew) {
        const primaryKey = ModelClass.primaryKey()
        const currentPrimaryKey = this.readAttribute(primaryKey)

        if (currentPrimaryKey === undefined || currentPrimaryKey === null) {
          clientMutationId = frontendModelTransportConfig.offlineSync?.clientMutationId
            ? frontendModelTransportConfig.offlineSync.clientMutationId()
            : frontendModelOfflineMutationId()
          this.setAttribute(primaryKey, clientMutationId)
          offlineAttributes[primaryKey] = clientMutationId
        }
      } else {
        offlineAttributes[ModelClass.primaryKey()] = payload.id
      }

      if (payload.nestedAttributes !== undefined || payload.attachments !== undefined) {
        throw new Error(`Offline sync for ${ModelClass.name} does not support nested attributes or attachments yet`)
      }

      await queueFrontendModelMutationOffline({
        attributes: offlineAttributes,
        clientMutationId,
        ModelClass,
        operation: commandType
      })
      this.setIsNewRecord(false)
      this._persistedAttributes = cloneFrontendModelAttributes(this.attributes())
      this._pendingNestedAttributes = {}
      this._clearPendingAttachments()

      return this
    }

    const response = await ModelClass.executeCommand(commandType, payload)

    this.assignAttributes(ModelClass.attributesFromResponse(response))
    this.setIsNewRecord(false)
    this._persistedAttributes = cloneFrontendModelAttributes(this.attributes())
    this._pendingNestedAttributes = {}
    this._clearPendingAttachments()

    this._reconcileNestedAttributesFromResponse(response)

    return this
  }

  /**
   * Returns the subset of `_attributes` whose value has diverged from
   * `_persistedAttributes`. Used by `save()` so the server receives only the
   * fields the caller actually changed — avoiding strict permit rejections on
   * framework-managed fields like `id`, `createdAt`, `updatedAt`, or owner
   * foreign keys that the resource never lists in `permittedParams`.
   * @returns {Record<string, FrontendModelAttributeValue>} - Changed attributes hash.
   */
  _changedAttributesForSave() {
    /**
     * Changed attributes.
     * @type {Record<string, FrontendModelAttributeValue>} */
    const changedAttributes = {}

    for (const [attributeName, [previousValue, currentValue]] of Object.entries(this.changes())) {
      if (this.isNewRecord() && previousValue === undefined && currentValue === null) continue

      changedAttributes[attributeName] = currentValue
    }

    return changedAttributes
  }

  /**
   * Marks the current value for an attribute as already persisted so the next
   * save does not send it unless the caller changes it again.
   * @param {string} attributeName - Attribute to mark unchanged.
   * @returns {void}
   */
  markAttributeUnchanged(attributeName) {
    this._persistedAttributes[attributeName] = cloneFrontendModelAttributes({value: this._attributes[attributeName]}).value
  }

  /**
   * Runs destroy.
   * @returns {Promise<void>} - Resolves when destroyed on backend.
   */
  async destroy() {
    const ModelClass = frontendModelClassFor(this)
    const id = this.primaryKeyValue()

    if (shouldQueueFrontendModelOperationOffline(ModelClass, "destroy")) {
      await queueFrontendModelMutationOffline({
        attributes: {[ModelClass.primaryKey()]: id},
        ModelClass,
        operation: "destroy"
      })

      return
    }

    await ModelClass.executeCommand("destroy", {
      id
    })
  }

  /**
   * Builds the attachment payload queued on this model for the next save.
   * @returns {Promise<Record<string, ?>>} Attachment payload keyed by attachment name.
   */
  async _buildAttachmentsPayload() {
    /** @type {Record<string, ?>} */
    const payload = {}

    for (const attachmentName of Object.keys(this._attachments)) {
      const attachmentPayload = await this._attachments[attachmentName].pendingAttachmentsPayload()

      if (attachmentPayload !== undefined) {
        payload[attachmentName] = attachmentPayload
      }
    }

    return payload
  }

  /** Clears queued attachment inputs after a successful save. */
  _clearPendingAttachments() {
    for (const attachmentName of Object.keys(this._attachments)) {
      this._attachments[attachmentName].clearPendingAttachments()
    }
  }

  /**
   * Walks relationships declared in this resource's `nestedAttributes` config
   * and builds the per-relationship payload of dirty children for a parent save.
   *
   * Included children:
   *   - new records (isNewRecord()) → create entry with attributes
   *   - records marked for destruction (markedForDestruction()) → destroy entry
   *   - records with changed attributes (isChanged()) → update entry with attributes
   *   - records with dirty descendants in their own nestedAttributes → recurse
   *
   * Loaded but untouched records are omitted so nested save preserves Rails-style
   * "children not referenced in payload are left alone" semantics.
   * @returns {Promise<Record<string, Array<Record<string, ?>>>>} - Per-relationship list of nested-attribute entries.
   */
  async _buildNestedAttributesPayload() {
    const ModelClass = frontendModelClassFor(this)
    const resourceConfig = ModelClass.resourceConfig()
    const nestedAttributesConfig = resourceConfig?.nestedAttributes

    if (!nestedAttributesConfig) return {}

    /**
     * Payload.
     * @type {Record<string, Array<Record<string, ?>>>} */
    const payload = {}

    for (const relationshipName of Object.keys(nestedAttributesConfig)) {
      /** @type {Array<Record<string, ?>>} */
      const entries = []
      const relationship = this._relationships[relationshipName]

      if (relationship instanceof FrontendModelHasManyRelationship && Array.isArray(relationship._loadedValue)) {
        for (const child of relationship._loadedValue) {
          const childEntry = await child._nestedAttributesEntryForParentSave()

          if (childEntry) entries.push(childEntry)
        }
      } else if (relationship instanceof FrontendModelSingularRelationship && relationship.getPreloaded()) {
        const child = relationship.loaded()

        if (child instanceof FrontendModelBase) {
          const childEntry = await child._nestedAttributesEntryForParentSave()

          if (childEntry) entries.push(childEntry)
        }
      }

      if (Object.prototype.hasOwnProperty.call(this._pendingNestedAttributes, relationshipName)) {
        entries.push(
          ...await this._nestedAttributesPayloadForSubmittedValue(
            ModelClass,
            relationshipName,
            this._pendingNestedAttributes[relationshipName]
          )
        )
      }

      if (entries.length > 0) {
        payload[relationshipName] = entries
      }
    }

    return payload
  }

  /**
   * Builds the payload entry for this child when walked by a parent's
   * `_buildNestedAttributesPayload`. Returns `null` when the child has no
   * dirty state and no dirty descendants, so the parent can omit it.
   * @returns {Promise<Record<string, ?> | null>} - Nested-attribute entry or null if clean.
   */
  async _nestedAttributesEntryForParentSave() {
    if (this.markedForDestruction()) {
      if (this.isNewRecord()) return null
      return {id: this.primaryKeyValue(), _destroy: true}
    }

    const nestedAttributes = await this._buildNestedAttributesPayload()
    const hasNestedDirty = Object.keys(nestedAttributes).length > 0
    const attachments = await this._buildAttachmentsPayload()
    const hasAttachments = Object.keys(attachments).length > 0

    if (this.isNewRecord()) {
      /**
       * Entry.
       * @type {Record<string, ?>} */
      const entry = {}
      const attributes = this._changedAttributesForSave()

      if (Object.keys(attributes).length > 0) entry.attributes = attributes
      if (hasAttachments) entry.attachments = attachments
      if (hasNestedDirty) entry.nestedAttributes = nestedAttributes

      return entry
    }

    if (!this.isChanged() && !hasNestedDirty && !hasAttachments) return null

    /**
     * Entry.
     * @type {Record<string, ?>} */
    const entry = {id: this.primaryKeyValue()}

    if (this.isChanged()) entry.attributes = this._changedAttributesForSave()
    if (hasAttachments) entry.attachments = attachments
    if (hasNestedDirty) entry.nestedAttributes = nestedAttributes

    return entry
  }

  /**
   * Builds nested entries from a Rails-style submitted `*Attributes` value.
   * @param {FrontendModelClass} ModelClass - Parent model class.
   * @param {string} relationshipName - Nested relationship name.
   * @param {?} value - Submitted nested attributes value.
   * @returns {Promise<Array<Record<string, ?>>>} Nested entries for the transport payload.
   */
  async _nestedAttributesPayloadForSubmittedValue(ModelClass, relationshipName, value) {
    const relationshipDefinition = ModelClass.relationshipDefinition(relationshipName)
    const TargetModelClass = ModelClass.relationshipModelClass(relationshipName)

    if (!relationshipDefinition) {
      throw new Error(`Unknown nested relationship: ${ModelClass.name}#${relationshipName}`)
    }
    if (!TargetModelClass) {
      throw new Error(`No target model class configured for ${ModelClass.name}#${relationshipName}`)
    }

    if (relationshipTypeIsCollection(relationshipDefinition.type)) {
      if (!Array.isArray(value)) {
        throw new Error(`${ModelClass.name}#${relationshipName}Attributes must be an array`)
      }

      return await Promise.all(
        value.map(async (entry) => await this._nestedAttributesEntryPayloadForSubmittedValue(TargetModelClass, entry))
      )
    }

    if (value == null) return []
    if (Array.isArray(value)) {
      throw new Error(`${ModelClass.name}#${relationshipName}Attributes must be an object`)
    }

    return [await this._nestedAttributesEntryPayloadForSubmittedValue(TargetModelClass, value)]
  }

  /**
   * Converts one submitted Rails-style nested attributes object into transport payload shape.
   * @param {FrontendModelClass} ModelClass - Nested child model class.
   * @param {?} submittedEntry - Submitted nested attributes entry.
   * @returns {Promise<Record<string, ?>>} Transport nested-attributes entry.
   */
  async _nestedAttributesEntryPayloadForSubmittedValue(ModelClass, submittedEntry) {
    if (!frontendAttachmentValueIsPlainObject(submittedEntry)) {
      throw new Error(`${ModelClass.name} nested attributes entries must be objects`)
    }

    /** @type {Record<string, ?>} */
    const entry = {}
    /** @type {Record<string, ?>} */
    const attributes = {}
    /** @type {Record<string, ?>} */
    const attachments = {}
    /** @type {Record<string, Array<Record<string, ?>>>} */
    const nestedAttributes = {}

    for (const [attributeName, value] of Object.entries(submittedEntry)) {
      if (attributeName === "id" || attributeName === "_destroy") {
        entry[attributeName] = value
        continue
      }

      const nestedRelationshipName = ModelClass.nestedAttributesRelationshipName(attributeName)

      if (nestedRelationshipName) {
        nestedAttributes[nestedRelationshipName] = await this._nestedAttributesPayloadForSubmittedValue(
          ModelClass,
          nestedRelationshipName,
          value
        )
        continue
      }

      if (ModelClass.attachmentDefinition(attributeName)) {
        attachments[attributeName] = await this._attachmentPayloadForSubmittedValue(ModelClass, attributeName, value)
        continue
      }

      attributes[attributeName] = value
    }

    if (Object.keys(attributes).length > 0) entry.attributes = attributes
    if (Object.keys(attachments).length > 0) entry.attachments = attachments
    if (Object.keys(nestedAttributes).length > 0) entry.nestedAttributes = nestedAttributes

    return entry
  }

  /**
   * Normalizes a submitted attachment value for transport.
   * @param {FrontendModelClass} ModelClass - Model class owning the attachment.
   * @param {string} attachmentName - Attachment name.
   * @param {?} value - Submitted attachment value.
   * @returns {Promise<Record<string, ?> | Record<string, ?>[]>} Normalized attachment payload.
   */
  async _attachmentPayloadForSubmittedValue(ModelClass, attachmentName, value) {
    const attachmentDefinition = ModelClass.attachmentDefinition(attachmentName)

    if (attachmentDefinition?.type === "hasMany") {
      const values = Array.isArray(value) ? value : [value]

      return await Promise.all(values.map(async (entry) => await normalizeFrontendAttachmentInput(entry)))
    }

    if (Array.isArray(value)) {
      const lastValue = value[value.length - 1]

      if (lastValue === undefined) {
        throw new Error(`${ModelClass.name}#${attachmentName} attachment array cannot be empty`)
      }

      return await normalizeFrontendAttachmentInput(lastValue)
    }

    return await normalizeFrontendAttachmentInput(value)
  }

  /**
   * After a parent save with `nestedAttributes`, the server response includes
   * preloaded versions of the affected relationships. This replaces the local
   * `_loadedValue` for each nested-writable relationship with the server's
   * authoritative set, so destroyed children are dropped and newly-created
   * children get their server-assigned ids + persisted state.
   * @param {Record<string, ?>} response - Command response payload.
   * @returns {void}
   */
  _reconcileNestedAttributesFromResponse(response) {
    const ModelClass = frontendModelClassFor(this)
    const resourceConfig = ModelClass.resourceConfig()
    const nestedAttributesConfig = resourceConfig?.nestedAttributes

    if (!nestedAttributesConfig) return

    const modelData = ModelClass.modelDataFromResponse(response)
    const preloadedRelationships = modelData.preloadedRelationships

    /**
     * Relevant preloads.
     * @type {Record<string, ?>} */
    const relevantPreloads = {}

    for (const relationshipName of Object.keys(nestedAttributesConfig)) {
      if (relationshipName in preloadedRelationships) {
        relevantPreloads[relationshipName] = preloadedRelationships[relationshipName]
      }
    }

    if (Object.keys(relevantPreloads).length > 0) {
      ModelClass.applyPreloadedRelationships(this, relevantPreloads)
    }
  }

  /**
   * Runs execute command.
   * @this {FrontendModelClass}
   * @param {FrontendModelCommandType} commandType - Command type.
   * @param {Record<string, ?>} payload - Command payload.
   * @returns {Promise<Record<string, ?>>} - Parsed JSON response.
   */
  static async executeCommand(commandType, payload) {
    const commandName = this.commandName(commandType)
    const timeZone = frontendModelTransportTimeZone()
    const serializedPayload = /** @type {Record<string, ?>} */ (serializeFrontendModelTransportValue(payload, {timeZone}))
    const resourcePath = this.resourcePath()
    const containsAttachmentUpload = frontendModelPayloadContainsAttachmentUpload(serializedPayload)
    const useSharedTransport = !containsAttachmentUpload
    const url = useSharedTransport ? frontendModelApiUrl() : frontendModelCommandUrl(resourcePath || "", commandName)

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

      const decodedBatchResponse = /** @type {Record<string, ?>} */ (batchResponse)

      this.throwOnErrorFrontendModelResponse({
        commandType,
        response: decodedBatchResponse
      })

      return decodedBatchResponse
    }

    return await trackFrontendModelTransportRequest(async () => runWithTransportDeadline(
      {
        errorMessage: `${this.name}#${commandType} request timed out`,
        signal: frontendModelTransportSignal(),
        timeoutMs: frontendModelTransportTimeoutMs()
      },
      async (signal) => {
        const directResponse = await fetch(url, {
          body: JSON.stringify(serializedPayload),
          credentials: "include",
          headers: frontendModelRequestHeaders(timeZone),
          method: "POST",
          signal
        })

        const directResponseText = await directResponse.text()

        if (!directResponse.ok) {
          throwFrontendModelHttpError({
            commandLabel: `${this.name}#${commandType}`,
            response: directResponse,
            responseText: directResponseText
          })
        }

        const directJson = directResponseText.length > 0 ? JSON.parse(directResponseText) : {}
        const decodedDirectResponse = /** @type {Record<string, ?>} */ (deserializeFrontendModelTransportValue(directJson))

        this.throwOnErrorFrontendModelResponse({
          commandType,
          response: decodedDirectResponse
        })

        return decodedDirectResponse
      }
    ))
  }

  /**
   * Runs execute custom command.
   * @this {FrontendModelClass}
   * @param {object} args - Command arguments.
   * @param {string} args.commandName - Raw command path segment.
   * @param {FrontendModelRequestCommandType} args.commandType - Logical command type for error handling.
   * @param {string | number | null} [args.memberId] - Optional member id for member-scoped commands.
   * @param {Record<string, ?>} args.payload - Request payload.
   * @param {string} args.resourcePath - Direct resource path.
   * @returns {Promise<Record<string, FrontendModelAttributeValue>>} - Decoded response payload.
   */
  static async executeCustomCommand({commandName, commandType, memberId = null, payload, resourcePath}) {
    const timeZone = frontendModelTransportTimeZone()
    const serializedPayload = /** @type {Record<string, ?>} */ (serializeFrontendModelTransportValue(payload, {timeZone}))
    const customPath = frontendModelCustomCommandPath({
      commandName,
      memberId,
      modelName: this.getModelName(),
      resourcePath
    })

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

    const decodedBatchResponse = /** @type {Record<string, FrontendModelAttributeValue>} */ (batchResponse)

    this.throwOnErrorFrontendModelResponse({
      commandType,
      response: decodedBatchResponse
    })

    return decodedBatchResponse
  }

  /**
   * Runs throw on error frontend model response.
   * @this {FrontendModelClass}
   * @param {object} args - Arguments.
   * @param {FrontendModelRequestCommandType} args.commandType - Command type.
   * @param {Record<string, ?>} args.response - Decoded response.
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

    const debugErrorMessage = typeof response.debugErrorMessage === "string" && response.debugErrorMessage.length > 0
      ? response.debugErrorMessage
      : null
    const errorMessage = debugErrorMessage || (hasErrorMessage
      ? response.errorMessage
      : `Request failed for ${this.name}#${commandType}`)

    const error = /** @type {Error & {velocious?: Record<string, ?>, errorType?: string, validationErrors?: Record<string, ?>, debugErrorClass?: string, debugBacktrace?: string[]}} */ (new Error(errorMessage))
    if (response.velocious && typeof response.velocious === "object") {
      error.velocious = response.velocious
    }
    if (typeof response.errorType === "string") {
      error.errorType = response.errorType
    }
    if (response.validationErrors && typeof response.validationErrors === "object") {
      error.validationErrors = response.validationErrors
    }
    // Forward server-provided debug detail (included only when the backend
    // deems the requester allowed to see it, e.g. an admin) so callers can
    // render the real error class and stack trace instead of the generic
    // client-safe message.
    if (typeof response.debugErrorClass === "string") {
      error.debugErrorClass = response.debugErrorClass
    }
    if (Array.isArray(response.debugBacktrace)) {
      error.debugBacktrace = response.debugBacktrace
    }
    throw error
  }

  /**
   * Runs configured frontend model attribute names.
   * @this {FrontendModelClass}
   * @returns {Set<string>} - Configured frontend model attribute names.
   */
  static configuredFrontendModelAttributeNames() {
    const resourceConfig = /** @type {Record<string, ?>} */ (this.resourceConfig())
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

/** Public frontend model for safe Velocious attachment metadata. */
export class VelociousAttachment extends FrontendModelBase {
  /**
   * Runs resource config.
   * @returns {FrontendModelResourceConfig} - Resource config.
   */
  static resourceConfig() {
    return {
      attributes: {
        byteSize: {type: "integer"},
        contentType: {null: true, type: "varchar"},
        createdAt: {type: "datetime"},
        filename: {type: "varchar"},
        id: {type: "uuid"},
        name: {type: "varchar"},
        position: {type: "integer"},
        recordId: {type: "varchar"},
        recordType: {type: "varchar"},
        updatedAt: {type: "datetime"}
      },
      builtInCollectionCommands: ["index"],
      builtInMemberCommands: ["find"],
      modelName: "VelociousAttachment",
      primaryKey: "id"
    }
  }

  /**
   * Returns the attachment id.
   * @returns {string} - Attachment id.
   */
  id() { return this.readAttribute("id") }

  /**
   * Returns the owner model name.
   * @returns {string} - Owner model name.
   */
  recordType() { return this.readAttribute("recordType") }

  /**
   * Returns the owner record id.
   * @returns {string} - Owner record id.
   */
  recordId() { return this.readAttribute("recordId") }

  /**
   * Returns the attachment name on the owner model.
   * @returns {string} - Attachment name on the owner model.
   */
  name() { return this.readAttribute("name") }

  /**
   * Returns the attachment position.
   * @returns {number} - Attachment position.
   */
  position() { return this.readAttribute("position") }

  /**
   * Returns the attachment filename.
   * @returns {string} - Attachment filename.
   */
  filename() { return this.readAttribute("filename") }

  /**
   * Returns the attachment content type.
   * @returns {string | null} - Attachment content type.
   */
  contentType() { return this.readAttribute("contentType") }

  /**
   * Returns the attachment byte size.
   * @returns {number} - Attachment byte size.
   */
  byteSize() { return this.readAttribute("byteSize") }

  /**
   * Returns the created-at timestamp.
   * @returns {Date} - Created-at timestamp.
   */
  createdAt() { return this.readAttribute("createdAt") }

  /**
   * Returns the updated-at timestamp.
   * @returns {Date} - Updated-at timestamp.
   */
  updatedAt() { return this.readAttribute("updatedAt") }
}

FrontendModelBase.registerModel(VelociousAttachment)
