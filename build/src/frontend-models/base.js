// @ts-check
import * as inflection from "inflection";
import timeout from "awaitery/build/timeout.js";
import wait from "awaitery/build/wait.js";
import FrontendModelQuery, { frontendModelEventOptionsPayload } from "./query.js";
import FrontendModelPreloader from "./preloader.js";
import { normalizeDateStringForWrite } from "../database/datetime-storage.js";
import { registerFrontendModel, resolveFrontendModelClass } from "./model-registry.js";
import { validateFrontendModelResourceCommandName, validateFrontendModelResourcePath } from "./resource-config-validation.js";
import { deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue } from "./transport-serialization.js";
import runWithTransportDeadline from "./transport-deadline.js";
import { REQUEST_TIME_ZONE_HEADER, validateTimeZone } from "../time-zone.js";
import VelociousWebsocketClient from "../http-client/websocket-client.js";
import { remoteRequestContextKey } from "../remote-request-context.js";
import { captureFrontendModelRemoteRequestContext, mergeFrontendModelRemoteRequestContext } from "./remote-request-context.js";
import { bufferOutgoingEvent, clearBufferedOutgoingEvents, drainBufferedOutgoingEvents } from "./outgoing-event-buffer.js";
import { defineModelScope } from "../utils/model-scope.js";
import isPlainObject from "../utils/plain-object.js";
import { modelPrimaryKeyCacheKey, modelPrimaryKeyConditions, readModelPrimaryKeyValue, scalarModelPrimaryKey } from "../utils/model-primary-key.js";
import { readPayloadAssociationCount, readPayloadComputedAbility, readPayloadQueryData, setPayloadAssociationCount, setPayloadComputedAbility, setPayloadQueryData } from "../record-payload-values.js";
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
 * Defines this typedef.
 * @typedef {{callback: (payload: {id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue, model: FrontendModelBase}) => void, eventFilterKey: string | null, eventFilterPayload: import("./query.js").FrontendModelEventFilterPayload | null, projectionPayload: import("./query.js").FrontendModelProjectionPayload}} FrontendModelModelEventCallbackEntry
 */
/**
 * Defines this typedef.
 * @typedef {{callback: (payload: {id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue}) => void}} FrontendModelDestroyEventCallbackEntry
 */
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
 * @typedef {Record<string, ReturnType<typeof JSON.parse>> | {arrayBuffer: () => Promise<ArrayBuffer>, type?: string, name?: string} | null | undefined} FrontendModelAttachmentInput
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
 * @typedef {{attributes?: Array<string | FrontendModelAttributeDefinition> | Record<string, FrontendModelAttributeDefinition>, builtInCollectionCommands?: string[], builtInMemberCommands?: string[], collectionCommands?: string[], commands?: string[], memberCommands?: string[], attachments?: Record<string, FrontendModelAttachmentDefinition>, modelName?: string, nestedAttributes?: Record<string, {allowDestroy?: boolean, limit?: number}>, primaryKey?: string | string[], relationships?: string[], sync?: FrontendModelSyncConfig}} FrontendModelResourceConfig
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
 * @property {{post: (path: string, body?: ReturnType<typeof JSON.parse>, options?: {headers?: Record<string, string>, signal?: AbortSignal}) => Promise<{json: () => ReturnType<typeof JSON.parse>}>, subscribe: (channel: string, options: {params?: Record<string, ReturnType<typeof JSON.parse>>}, callback: (payload: ReturnType<typeof JSON.parse>) => void) => (() => void), subscribeAndWait?: (channel: string, options: {params?: Record<string, ReturnType<typeof JSON.parse>>}, callback: (payload: ReturnType<typeof JSON.parse>) => void) => Promise<(() => void)>}} [websocketClient] - Optional websocket client for shared frontend-model API requests and subscriptions. Its `post` receives the bounded-deadline `signal` and should forward it into the underlying transport so the deadline can abort the live request and its response-body read.
 * @property {Record<string, string> | (() => Record<string, string>)} [requestHeaders] - Extra HTTP/WS headers to attach to every frontend-model API request. Pass a function to compute them at request time (for example to include the current locale).
 * @property {import("../remote-request-context.js").RemoteRequestContext | (() => import("../remote-request-context.js").RemoteRequestContext | undefined | null)} [requestContext] - Immutable scalar context captured independently when each operation or event subscription starts and sent for remote tenant/ability resolution.
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
const frontendModelTransportConfig = {};
const SHARED_FRONTEND_MODEL_API_PATH = "/frontend-models";
const PRELOADED_RELATIONSHIPS_KEY = "__preloadedRelationships";
const SELECTED_ATTRIBUTES_KEY = "__selectedAttributes";
const ASSOCIATION_COUNTS_KEY = "__associationCounts";
const QUERY_DATA_KEY = "__queryData";
const ABILITIES_KEY = "__abilities";
/**
 * Pending shared frontend model requests.
 * @type {Array<{commandName?: string, commandType: FrontendModelRequestCommandType, customPath?: string, modelClass: FrontendModelClass, payload: Record<string, ReturnType<typeof JSON.parse>>, requestContext: import("../remote-request-context.js").RemoteRequestContext, requestId: string, resolve: (response: Record<string, ReturnType<typeof JSON.parse>>) => void, reject: (error: ReturnType<typeof JSON.parse>) => void, resourcePath?: string | null}>} */
let pendingSharedFrontendModelRequests = [];
let sharedFrontendModelRequestId = 0;
let sharedFrontendModelFlushScheduled = false;
let activeFrontendModelTransportRequestCount = 0;
/**
 * Frontend model idle resolvers.
 * @type {Array<() => void>} */
let frontendModelIdleResolvers = [];
/**
 * Internal websocket client.
 * @type {VelociousWebsocketClient | null} */
let internalWebsocketClient = null;
/** @type {AbortSignal | null} */
let internalWebsocketClientSignal = null;
/** @type {(() => void) | null} */
let internalWebsocketClientSignalCleanup = null;
/**
 * Detaches an owned WebSocket client from the shared cache if it is still current.
 * @param {VelociousWebsocketClient} client - Client whose ownership is ending.
 * @returns {void}
 */
function detachInternalWebsocketClient(client) {
    if (internalWebsocketClient !== client)
        return;
    internalWebsocketClient = null;
    internalWebsocketClientSignalCleanup?.();
    internalWebsocketClientSignal = null;
    internalWebsocketClientSignalCleanup = null;
}
/**
 * Disposes the owned WebSocket client before transport/session configuration changes.
 * @returns {void}
 */
function resetInternalWebsocketClient() {
    const client = internalWebsocketClient;
    if (!client)
        return;
    detachInternalWebsocketClient(client);
    void client.disconnectAndStopReconnect();
}
/**
 * Binds the owned WebSocket client lifetime to the current session signal.
 * @param {AbortSignal | undefined} sessionSignal - Current session signal.
 * @returns {void}
 */
function bindInternalWebsocketClientSignal(sessionSignal) {
    if (internalWebsocketClientSignal === sessionSignal)
        return;
    internalWebsocketClientSignalCleanup?.();
    internalWebsocketClientSignal = sessionSignal || null;
    internalWebsocketClientSignalCleanup = null;
    if (!sessionSignal || !internalWebsocketClient)
        return;
    const client = internalWebsocketClient;
    const onSessionAbort = () => {
        detachInternalWebsocketClient(client);
        clearBufferedOutgoingEvents();
        void client.disconnectAndStopReconnect();
    };
    sessionSignal.addEventListener("abort", onSessionAbort, { once: true });
    internalWebsocketClientSignalCleanup = () => sessionSignal.removeEventListener("abort", onSessionAbort);
    if (sessionSignal.aborted)
        onSessionAbort();
}
/**
 * Runs frontend model transport is idle.
 * @returns {boolean} - Whether all queued and active frontend-model transport requests are done.
 */
function frontendModelTransportIsIdle() {
    return activeFrontendModelTransportRequestCount === 0
        && pendingSharedFrontendModelRequests.length === 0
        && !sharedFrontendModelFlushScheduled;
}
/**
 * Runs resolve frontend model idle waiters.
 * @returns {void} */
function resolveFrontendModelIdleWaiters() {
    if (!frontendModelTransportIsIdle())
        return;
    const resolvers = frontendModelIdleResolvers;
    frontendModelIdleResolvers = [];
    for (const resolve of resolvers) {
        resolve();
    }
}
/**
 * Runs wait for frontend model transport quiet period.
 * @param {number} milliseconds - Quiet period length.
 * @returns {Promise<void>} Resolves after the quiet period.
 */
async function waitForFrontendModelTransportQuietPeriod(milliseconds) {
    if (milliseconds <= 0)
        return;
    await wait(milliseconds);
}
/**
 * Runs wait for frontend model transport idle.
 * @param {number} quietMs - Milliseconds the transport must stay idle before resolving.
 * @returns {Promise<void>} Resolves when transport stays idle.
 */
async function waitForFrontendModelTransportIdle(quietMs = 0) {
    while (true) {
        if (frontendModelTransportIsIdle()) {
            await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
            if (frontendModelTransportIsIdle()) {
                await waitForFrontendModelTransportQuietPeriod(quietMs);
                if (frontendModelTransportIsIdle())
                    return;
            }
        }
        else {
            await new Promise((resolve) => {
                frontendModelIdleResolvers.push(() => resolve(undefined));
            });
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
    activeFrontendModelTransportRequestCount += 1;
    try {
        return await callback();
    }
    finally {
        activeFrontendModelTransportRequestCount -= 1;
        resolveFrontendModelIdleWaiters();
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
        const client = internalWebsocketClient;
        bindInternalWebsocketClientSignal(frontendModelTransportSignal());
        return client;
    }
    const websocketUrl = frontendModelTransportConfig.websocketUrl;
    if (!websocketUrl)
        return null;
    if (typeof globalThis.WebSocket === "undefined")
        return null;
    const resolvedUrl = typeof websocketUrl === "function" ? websocketUrl() : websocketUrl;
    if (!resolvedUrl)
        return null;
    const client = new VelociousWebsocketClient({
        autoReconnect: true,
        sessionStore: frontendModelTransportConfig.sessionStore,
        url: resolvedUrl
    });
    internalWebsocketClient = client;
    client.onReconnect = async () => await flushBufferedOutgoingEventsAfterReconnect(client);
    bindInternalWebsocketClientSignal(frontendModelTransportSignal());
    return client;
}
/**
 * Runs flush buffered outgoing events after reconnect.
 * @param {VelociousWebsocketClient} client - Reconnected client that owns this flush.
 * @returns {Promise<void>} */
async function flushBufferedOutgoingEventsAfterReconnect(client) {
    if (internalWebsocketClient !== client)
        return;
    const events = drainBufferedOutgoingEvents();
    const sessionSignal = frontendModelTransportSignal();
    await runWithTransportDeadline({
        errorMessage: "Buffered frontend-model WebSocket flush timed out",
        signal: sessionSignal,
        timeoutMs: frontendModelTransportTimeoutMs()
    }, async (signal) => {
        for (let index = 0; index < events.length; index += 1) {
            if (internalWebsocketClient !== client)
                return;
            try {
                await client.post(events[index].customPath, events[index].payload, { signal });
                if (internalWebsocketClient !== client)
                    return;
            }
            catch {
                if (internalWebsocketClient !== client)
                    return;
                if (sessionSignal?.aborted)
                    return;
                if (signal.aborted) {
                    for (let remaining = index; remaining < events.length; remaining += 1) {
                        bufferOutgoingEvent(events[remaining]);
                    }
                    return;
                }
                const socketOpen = client.socket?.readyState === client.socket?.OPEN;
                if (socketOpen)
                    continue;
                for (let remaining = index; remaining < events.length; remaining += 1) {
                    bufferOutgoingEvent(events[remaining]);
                }
                return;
            }
        }
    });
}
/**
 * Runs default frontend model resource path.
 * @param {FrontendModelClass} modelClass - Frontend model class.
 * @returns {string} - Default resource path for the model class.
 */
function defaultFrontendModelResourcePath(modelClass) {
    return `/${inflection.dasherize(inflection.pluralize(inflection.underscore(modelClass.getModelName())))}`;
}
/** Error raised when reading an attribute that was not selected in query payloads. */
export class AttributeNotSelectedError extends Error {
    /**
     * Runs constructor.
     * @param {string} modelName - Model class name.
     * @param {string} attributeName - Attribute that was requested.
     */
    constructor(modelName, attributeName) {
        super(`${modelName}#${attributeName} was not selected`);
        this.name = "AttributeNotSelectedError";
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
        this.model = model;
        this.relationshipName = relationshipName;
        this.targetModelClass = targetModelClass;
        this._preloaded = false;
        /** @type {FrontendModelRelationshipModel<T> | null} */
        this._loadedValue = null;
    }
    /**
     * Runs set loaded.
     * @param {FrontendModelRelationshipModel<T> | null | undefined} loadedValue - Loaded relationship value.
     * @returns {void}
     */
    setLoaded(loadedValue) {
        this._loadedValue = loadedValue == undefined ? null : loadedValue;
        this._preloaded = true;
    }
    /**
     * Runs get preloaded.
     * @returns {boolean} - Whether relationship is preloaded.
     */
    getPreloaded() {
        return this._preloaded;
    }
    /**
     * Runs loaded.
     * @returns {FrontendModelRelationshipModel<T> | null} - Loaded relationship value.
     */
    loaded() {
        if (!this._preloaded) {
            throw new Error(`${this.model.constructor.name}#${this.relationshipName} hasn't been preloaded`);
        }
        return this._loadedValue;
    }
    /**
     * Copies loaded value from another singular relationship helper.
     * @param {FrontendModelRelationship} sourceRelationship - Source relationship helper.
     * @returns {void}
     */
    copyLoadedFrom(sourceRelationship) {
        if (sourceRelationship instanceof FrontendModelHasManyRelationship) {
            throw new Error(`Expected ${this.model.constructor.name}#${this.relationshipName} source relationship to be singular`);
        }
        // Narrows the runtime value to the target relationship's documented model type.
        const loadedValue = /** @type {FrontendModelRelationshipModel<T> | null} */ (sourceRelationship.loaded());
        this.setLoaded(loadedValue);
    }
    /**
     * Runs build.
     * @param {TargetCreateAttributes} [attributes] - New model attributes.
     * @returns {FrontendModelRelationshipModel<T>} - Built model.
     */
    build(attributes = /** @type {TargetCreateAttributes} */ ({})) {
        if (!this.targetModelClass) {
            throw new Error(`No target model class configured for ${this.model.constructor.name}#${this.relationshipName}`);
        }
        const ModelClass = /** @type {new (attributes?: TargetCreateAttributes) => FrontendModelRelationshipModel<T>} */ (this.targetModelClass);
        const model = new ModelClass(attributes);
        this.setLoaded(model);
        return model;
    }
    /**
     * Force-reload the relationship.
     * @returns {Promise<FrontendModelRelationshipModel<T> | null>} - Loaded relationship model.
     */
    async load() {
        this._preloaded = false;
        this._loadedValue = null;
        const batched = await this.model._tryCohortPreload(this.relationshipName);
        if (batched)
            return this.loaded();
        await this.model.loadRelationship(this.relationshipName);
        return this.loaded();
    }
    /**
     * Returns the loaded relationship or loads it.
     * @returns {Promise<FrontendModelRelationshipModel<T> | null>} - Loaded relationship model.
     */
    async orLoad() {
        if (this.getPreloaded())
            return this.loaded();
        const batched = await this.model._tryCohortPreload(this.relationshipName);
        if (batched)
            return this.loaded();
        await this.model.loadRelationship(this.relationshipName);
        return this.loaded();
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
    _loadedValue;
    /**
     * Runs constructor.
     * @param {FrontendModelBase} model - Parent model.
     * @param {string} relationshipName - Relationship name.
     * @param {FrontendModelClass<FrontendModelRelationshipModel<T>, Record<string, FrontendModelAttributeValue>, TargetCreateAttributes> | null} targetModelClass - Target model class.
     */
    constructor(model, relationshipName, targetModelClass) {
        this.model = model;
        this.relationshipName = relationshipName;
        this.targetModelClass = targetModelClass;
        this._preloaded = false;
        this._loadedValue = [];
    }
    /**
     * Runs set loaded.
     * @param {Array<FrontendModelRelationshipModel<T>>} loadedValue - Loaded relationship value.
     * @returns {void}
     */
    setLoaded(loadedValue) {
        if (!Array.isArray(loadedValue)) {
            throw new Error(`Expected ${this.model.constructor.name}#${this.relationshipName} to be loaded with an array`);
        }
        this._loadedValue = loadedValue;
        this._preloaded = true;
    }
    /**
     * Runs get preloaded.
     * @returns {boolean} - Whether relationship is preloaded.
     */
    getPreloaded() {
        return this._preloaded;
    }
    /**
     * Runs loaded.
     * @returns {Array<FrontendModelRelationshipModel<T>>} - Loaded relationship values.
     */
    loaded() {
        if (!this._preloaded) {
            throw new Error(`${this.model.constructor.name}#${this.relationshipName} hasn't been preloaded`);
        }
        return this._loadedValue;
    }
    /**
     * Copies loaded value from another has-many relationship helper.
     * @param {FrontendModelRelationship} sourceRelationship - Source relationship helper.
     * @returns {void}
     */
    copyLoadedFrom(sourceRelationship) {
        if (!(sourceRelationship instanceof FrontendModelHasManyRelationship)) {
            throw new Error(`Expected ${this.model.constructor.name}#${this.relationshipName} source relationship to be has-many`);
        }
        // Narrows the runtime value to the target relationship's documented model type.
        const loadedValue = /** @type {Array<FrontendModelRelationshipModel<T>>} */ (sourceRelationship.loaded());
        this.setLoaded(loadedValue);
    }
    /**
     * Runs add to loaded.
     * @param {Array<FrontendModelRelationshipModel<T>>} models - Models to append.
     * @returns {void}
     */
    addToLoaded(models) {
        const loadedModels = this.getPreloaded() ? this.loaded() : [];
        this.setLoaded([...loadedModels, ...models]);
    }
    /**
     * Runs build.
     * @param {TargetCreateAttributes} [attributes] - New model attributes.
     * @returns {FrontendModelRelationshipModel<T>} - Built model.
     */
    build(attributes = /** @type {TargetCreateAttributes} */ ({})) {
        if (!this.targetModelClass) {
            throw new Error(`No target model class configured for ${this.model.constructor.name}#${this.relationshipName}`);
        }
        const ModelClass = /** @type {new (attributes?: TargetCreateAttributes) => FrontendModelRelationshipModel<T>} */ (this.targetModelClass);
        const model = new ModelClass(attributes);
        this.addToLoaded([model]);
        return model;
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
        this._preloaded = false;
        this._loadedValue = [];
        const batched = await this.model._tryCohortPreload(this.relationshipName);
        if (batched)
            return this._loadedValue;
        await this.model.loadRelationship(this.relationshipName);
        return this.loaded();
    }
    /**
     * Runs to array.
     * @returns {Promise<Array<FrontendModelRelationshipModel<T>>>} - Loaded relationship models.
     */
    async toArray() {
        if (this.getPreloaded() || this._loadedValue.length > 0) {
            return this._loadedValue;
        }
        return await this.load();
    }
}
/**
 * Copies loaded relationship state between helpers of the same relationship shape.
 * @param {object} args - Arguments.
 * @param {FrontendModelRelationship} args.sourceRelationship - Source relationship helper.
 * @param {FrontendModelRelationship} args.targetRelationship - Target relationship helper.
 * @returns {void}
 */
function copyLoadedRelationshipValue({ sourceRelationship, targetRelationship }) {
    targetRelationship.copyLoadedFrom(sourceRelationship);
}
/**
 * Runs relationship type is collection.
 * @param {string} relationshipType - Relationship type.
 * @returns {boolean} - Whether relationship type is has-many.
 */
function relationshipTypeIsCollection(relationshipType) {
    return relationshipType == "hasMany";
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
    constructor({ byteSize, content, contentType, filename, id, url = null }) {
        this.idValue = id;
        this.filenameValue = filename;
        this.contentTypeValue = contentType;
        this.byteSizeValue = byteSize;
        this.contentValue = content;
        this.urlValue = url;
    }
    /**
     * Runs byte size.
     * @returns {number} - File size in bytes.
     */
    byteSize() { return this.byteSizeValue; }
    /**
     * Runs content.
     * @returns {Uint8Array} - File content bytes.
     */
    content() { return this.contentValue; }
    /**
     * Runs content type.
     * @returns {string | null} - Content type.
     */
    contentType() { return this.contentTypeValue; }
    /**
     * Runs filename.
     * @returns {string} - Filename.
     */
    filename() { return this.filenameValue; }
    /**
     * Runs id.
     * @returns {string} - Attachment id.
     */
    id() { return this.idValue; }
    /**
     * Runs url.
     * @returns {string | null} - Resolvable attachment URL.
     */
    url() { return this.urlValue; }
}
/**
 * Runs frontend model attachment command payload.
 * @param {FrontendModelAttachmentHandle} attachment - Attachment wrapper.
 * @param {string} [attachmentId] - Optional has-many attachment id.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Command payload.
 */
function frontendModelAttachmentCommandPayload(attachment, attachmentId) {
    /**
     * Payload.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const payload = {
        attachmentName: attachment.attachmentName,
        id: attachment.model.primaryKeyValue()
    };
    if (attachmentId)
        payload.attachmentId = attachmentId;
    return payload;
}
/**
 * Runs frontend attachment value is bytes.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {boolean} - Whether value looks like byte data.
 */
function frontendAttachmentValueIsBytes(value) {
    return value instanceof Uint8Array || value instanceof ArrayBuffer || (typeof Buffer !== "undefined" && Buffer.isBuffer(value));
}
/**
 * Runs frontend attachment value supports array buffer.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {value is {arrayBuffer: () => Promise<ArrayBuffer>}} - Whether candidate supports arrayBuffer().
 */
function frontendAttachmentValueSupportsArrayBuffer(value) {
    return Boolean(value && typeof value === "object" && typeof /** @type {ReturnType<typeof JSON.parse>} */ (value).arrayBuffer === "function");
}
/**
 * Runs frontend attachment normalize bytes.
 * @param {Uint8Array | Buffer | ArrayBuffer} value - Byte-like value.
 * @returns {Uint8Array} - Uint8Array bytes.
 */
function frontendAttachmentNormalizeBytes(value) {
    if (value instanceof Uint8Array)
        return value;
    if (value instanceof ArrayBuffer)
        return new Uint8Array(value);
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(/** @type {ReturnType<typeof JSON.parse>} */ (value))) {
        return new Uint8Array(/** @type {Buffer} */ (value));
    }
    throw new Error("Unsupported attachment bytes value");
}
/**
 * Runs frontend attachment bytes to base64.
 * @param {Uint8Array} bytes - Bytes.
 * @returns {string} - Base64 value.
 */
function frontendAttachmentBytesToBase64(bytes) {
    if (typeof Buffer !== "undefined") {
        return Buffer.from(bytes).toString("base64");
    }
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    if (typeof btoa !== "function")
        throw new Error("Missing base64 encoder");
    return btoa(binary);
}
/**
 * Runs frontend attachment base64 to bytes.
 * @param {string} value - Base64 value.
 * @returns {Uint8Array} - Decoded bytes.
 */
function frontendAttachmentBase64ToBytes(value) {
    if (typeof Buffer !== "undefined") {
        return new Uint8Array(Buffer.from(value, "base64"));
    }
    if (typeof atob !== "function")
        throw new Error("Missing base64 decoder");
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}
/**
 * Runs frontend attachment value is plain object.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate value.
 * @returns {value is Record<string, ReturnType<typeof JSON.parse>>} - Whether value is plain object.
 */
function frontendAttachmentValueIsPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
/**
 * Runs frontend model payload contains attachment upload.
 * @param {ReturnType<typeof JSON.parse>} value - Payload candidate.
 * @returns {boolean} - Whether payload contains an attachment upload body.
 */
function frontendModelPayloadContainsAttachmentUpload(value) {
    if (!value || typeof value !== "object")
        return false;
    if (Array.isArray(value)) {
        return value.some((entry) => frontendModelPayloadContainsAttachmentUpload(entry));
    }
    if (!frontendAttachmentValueIsPlainObject(value))
        return false;
    if (typeof value.contentBase64 === "string") {
        return true;
    }
    return Object.values(value).some((entry) => frontendModelPayloadContainsAttachmentUpload(entry));
}
/**
 * Returns the concrete frontend-model class for an instance.
 * @param {FrontendModelBase} model - Frontend model instance.
 * @returns {FrontendModelClass} Concrete frontend-model class.
 */
function frontendModelClassFor(model) {
    const constructorValue = model.constructor;
    return /** @type {FrontendModelClass} */ (constructorValue);
}
/**
 * Whether the configured offline queue should handle a model operation.
 * @param {FrontendModelClass} ModelClass - Model class.
 * @param {"create" | "update" | "destroy"} operation - Sync operation.
 * @returns {boolean} - Whether to queue locally.
 */
function shouldQueueFrontendModelOperationOffline(ModelClass, operation) {
    const offlineSync = frontendModelTransportConfig.offlineSync;
    if (!offlineSync?.enabled)
        return false;
    const syncConfig = ModelClass.resourceConfig().sync;
    if (!syncConfig?.enabled)
        return false;
    if (!syncConfig.operations.includes(operation))
        throw new Error(`Offline sync for ${ModelClass.getModelName()} does not allow ${operation}`);
    return true;
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
async function queueFrontendModelMutationOffline({ attributes, clientMutationId: providedClientMutationId, ModelClass, operation }) {
    const offlineSync = frontendModelTransportConfig.offlineSync;
    if (!offlineSync)
        throw new Error("Offline sync is not configured");
    const syncConfig = ModelClass.resourceConfig().sync;
    if (!syncConfig?.enabled)
        throw new Error(`Offline sync is not enabled for ${ModelClass.getModelName()}`);
    const now = offlineSync.now ? offlineSync.now() : new Date();
    if (!(now instanceof Date) || Number.isNaN(now.getTime()))
        throw new Error("offlineSync.now must return a valid Date");
    const clientMutationId = providedClientMutationId || (offlineSync.clientMutationId ? offlineSync.clientMutationId() : frontendModelOfflineMutationId());
    if (typeof clientMutationId !== "string" || clientMutationId.length < 1)
        throw new Error("offlineSync.clientMutationId must return a non-empty string");
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
    });
    return clientMutationId;
}
/**
 * Generates a frontend-model offline mutation id.
 * @returns {string} - Local mutation id.
 */
function frontendModelOfflineMutationId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function")
        return globalThis.crypto.randomUUID();
    return `frontend-mutation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
/**
 * Converts model attributes to sync-safe JSON payload values.
 * @param {Record<string, FrontendModelAttributeValue>} attributes - Frontend model attributes.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} - Sync-safe attributes.
 */
function frontendModelSyncJsonObject(attributes) {
    const serialized = JSON.parse(JSON.stringify(attributes));
    if (!serialized || typeof serialized !== "object" || Array.isArray(serialized))
        throw new Error("Expected sync mutation attributes object");
    return /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (serialized);
}
/**
 * Runs normalize frontend attachment input.
 * @param {ReturnType<typeof JSON.parse>} input - Attachment input.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Transport-safe attachment payload.
 */
async function normalizeFrontendAttachmentInput(input) {
    if (frontendAttachmentValueIsPlainObject(input) && "file" in input) {
        const normalizedFile = await normalizeFrontendAttachmentInput(input.file);
        const merged = {
            ...normalizedFile
        };
        if (typeof input.filename === "string" && input.filename.length > 0)
            merged.filename = input.filename;
        if (typeof input.contentType === "string" && input.contentType.length > 0)
            merged.contentType = input.contentType;
        return merged;
    }
    if (frontendAttachmentValueIsPlainObject(input)) {
        if (typeof input.path === "string" && input.path.length > 0) {
            throw new Error("Attachment path input is not supported in frontend models");
        }
        if (typeof input.contentBase64 === "string") {
            return {
                contentBase64: input.contentBase64,
                contentType: typeof input.contentType === "string" && input.contentType.length > 0 ? input.contentType : null,
                filename: typeof input.filename === "string" && input.filename.length > 0 ? input.filename : undefined
            };
        }
    }
    if (frontendAttachmentValueSupportsArrayBuffer(input)) {
        const bytes = new Uint8Array(await input.arrayBuffer());
        return {
            contentBase64: frontendAttachmentBytesToBase64(bytes),
            contentType: typeof /** @type {ReturnType<typeof JSON.parse>} */ (input).type === "string" && /** @type {ReturnType<typeof JSON.parse>} */ (input).type.length > 0
                ? /** @type {ReturnType<typeof JSON.parse>} */ (input).type
                : null,
            filename: typeof /** @type {ReturnType<typeof JSON.parse>} */ (input).name === "string" && /** @type {ReturnType<typeof JSON.parse>} */ (input).name.length > 0
                ? /** @type {ReturnType<typeof JSON.parse>} */ (input).name
                : "attachment.bin"
        };
    }
    if (frontendAttachmentValueIsBytes(input)) {
        const bytes = frontendAttachmentNormalizeBytes(/** @type {Uint8Array | Buffer | ArrayBuffer} */ (input));
        return {
            contentBase64: frontendAttachmentBytesToBase64(bytes),
            contentType: null,
            filename: "attachment.bin"
        };
    }
    throw new Error("Unsupported frontend attachment input");
}
/**
 * Frontend-model attachment helper for one attachment name.
 */
export class FrontendModelAttachmentHandle {
    /**
     * Pending attachment inputs queued for the next model save.
     * @type {FrontendModelAttachmentInput[]}
     */
    pendingInputs = [];
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {FrontendModelBase} args.model - Model instance.
     * @param {string} args.attachmentName - Attachment name.
     */
    constructor({ attachmentName, model }) {
        this.model = model;
        this.attachmentName = attachmentName;
    }
    /**
     * Queue attachment input for the parent model's next save.
     * @param {FrontendModelAttachmentInput | FrontendModelAttachmentInput[]} input - Attachment input.
     * @returns {void}
     */
    queueAttach(input) {
        const ModelClass = frontendModelClassFor(this.model);
        const attachmentDefinition = ModelClass.attachmentDefinition(this.attachmentName);
        if (attachmentDefinition?.type === "hasOne") {
            if (Array.isArray(input)) {
                const lastInput = input[input.length - 1];
                this.pendingInputs = typeof lastInput === "undefined" ? [] : [lastInput];
            }
            else {
                this.pendingInputs = [input];
            }
            return;
        }
        if (Array.isArray(input)) {
            this.pendingInputs.push(...input);
        }
        else {
            this.pendingInputs.push(input);
        }
    }
    /**
     * Whether this attachment has queued inputs for the next model save.
     * @returns {boolean} Whether any pending inputs exist.
     */
    hasPendingAttachments() {
        return this.pendingInputs.length > 0;
    }
    /**
     * Builds the save payload for queued attachment inputs.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | Record<string, ReturnType<typeof JSON.parse>>[] | undefined>} Normalized attachment payload.
     */
    async pendingAttachmentsPayload() {
        if (this.pendingInputs.length === 0)
            return undefined;
        const ModelClass = frontendModelClassFor(this.model);
        const attachmentDefinition = ModelClass.attachmentDefinition(this.attachmentName);
        if (attachmentDefinition?.type === "hasMany") {
            return await Promise.all(this.pendingInputs.map(async (input) => await normalizeFrontendAttachmentInput(input)));
        }
        return await normalizeFrontendAttachmentInput(this.pendingInputs[this.pendingInputs.length - 1]);
    }
    /** Clears queued attachment inputs after a successful model save. */
    clearPendingAttachments() {
        this.pendingInputs = [];
    }
    /**
     * Runs attach.
     * @param {ReturnType<typeof JSON.parse>} input - Attachment input.
     * @returns {Promise<void>} - Resolves when attached.
     */
    async attach(input) {
        const ModelClass = frontendModelClassFor(this.model);
        const normalizedInput = await normalizeFrontendAttachmentInput(input);
        const response = await ModelClass.executeCommand("attach", {
            attachment: normalizedInput,
            attachmentName: this.attachmentName,
            id: this.model.primaryKeyValue()
        });
        this.model.assignAttributes(ModelClass.attributesFromResponse(response));
    }
    /**
     * Runs download.
     * @param {string} [attachmentId] - Optional attachment id for has-many attachments.
     * @returns {Promise<FrontendModelAttachmentDownload | null>} - Downloaded attachment payload.
     */
    async download(attachmentId) {
        const ModelClass = frontendModelClassFor(this.model);
        const response = await ModelClass.executeCommand("download", frontendModelAttachmentCommandPayload(this, attachmentId));
        const attachmentPayload = response.attachment;
        if (!attachmentPayload || typeof attachmentPayload !== "object")
            return null;
        const contentBase64 = typeof attachmentPayload.contentBase64 === "string" ? attachmentPayload.contentBase64 : "";
        const content = frontendAttachmentBase64ToBytes(contentBase64);
        const byteSize = Number(attachmentPayload.byteSize);
        return new FrontendModelAttachmentDownload({
            byteSize: Number.isFinite(byteSize) ? byteSize : content.length,
            content,
            contentType: typeof attachmentPayload.contentType === "string" && attachmentPayload.contentType.length > 0 ? attachmentPayload.contentType : null,
            filename: typeof attachmentPayload.filename === "string" && attachmentPayload.filename.length > 0 ? attachmentPayload.filename : "attachment.bin",
            id: typeof attachmentPayload.id === "string" ? attachmentPayload.id : "",
            url: typeof attachmentPayload.url === "string" && attachmentPayload.url.length > 0 ? attachmentPayload.url : null
        });
    }
    /**
     * Runs url.
     * @param {string} [attachmentId] - Optional attachment id for has-many attachments.
     * @returns {Promise<string | null>} - Resolvable attachment URL.
     */
    async url(attachmentId) {
        const ModelClass = frontendModelClassFor(this.model);
        const response = await ModelClass.executeCommand("url", frontendModelAttachmentCommandPayload(this, attachmentId));
        if (typeof response.url === "string" && response.url.length > 0) {
            return response.url;
        }
        return null;
    }
    /**
     * Builds a query for this attachment handle's metadata rows.
     * @returns {import("./query.js").default<typeof VelociousAttachment>} - Attachment metadata query.
     */
    query() {
        const ModelClass = frontendModelClassFor(this.model);
        return VelociousAttachment
            .where({
            name: this.attachmentName,
            recordId: modelPrimaryKeyCacheKey(ModelClass.primaryKey(), this.model.primaryKeyValue()),
            recordType: ModelClass.getModelName()
        })
            .order([["position", "asc"]]);
    }
    /**
     * Loads all attachment metadata rows for this handle.
     * @returns {Promise<VelociousAttachment[]>} - Attachment metadata rows.
     */
    async toArray() {
        return await this.query().toArray();
    }
    /**
     * Loads the first attachment metadata row for this handle.
     * @returns {Promise<VelociousAttachment | null>} - First attachment metadata row.
     */
    async first() {
        return await this.query().first();
    }
    /**
     * Runs list. Returns metadata for every attachment under this attachment name
     * (no content bytes), so callers can enumerate has-many attachments and then
     * download or link to each one by id.
     * @returns {Promise<Array<{byteSize: number, contentType: string | null, filename: string, id: string, url: string | null}>>} - Attachment metadata entries.
     */
    async list() {
        const ModelClass = frontendModelClassFor(this.model);
        const response = await ModelClass.executeCommand("attachmentList", frontendModelAttachmentCommandPayload(this));
        const attachments = Array.isArray(response.attachments) ? response.attachments : [];
        return attachments.map((attachment) => {
            const byteSize = Number(attachment.byteSize);
            return {
                byteSize: Number.isFinite(byteSize) ? byteSize : 0,
                contentType: typeof attachment.contentType === "string" && attachment.contentType.length > 0 ? attachment.contentType : null,
                filename: typeof attachment.filename === "string" && attachment.filename.length > 0 ? attachment.filename : "attachment.bin",
                id: typeof attachment.id === "string" ? attachment.id : "",
                url: typeof attachment.url === "string" && attachment.url.length > 0 ? attachment.url : null
            };
        });
    }
    /**
     * Runs download url.
     * @returns {string} - Download URL for this attachment on the configured backend.
     */
    downloadUrl() {
        const ModelClass = frontendModelClassFor(this.model);
        const commandName = ModelClass.commandName("download");
        const resourcePath = ModelClass.resourcePath();
        const commandUrl = frontendModelCommandUrl(resourcePath, commandName);
        const params = new URLSearchParams({
            attachmentName: this.attachmentName,
            id: modelPrimaryKeyCacheKey(ModelClass.primaryKey(), this.model.primaryKeyValue())
        });
        return `${commandUrl}?${params.toString()}`;
    }
}
/**
 * Runs normalize frontend model transport url.
 * @param {string | undefined | null} value - URL candidate.
 * @returns {string} - Normalized URL without trailing slash.
 */
function normalizeFrontendModelTransportUrl(value) {
    if (typeof value !== "string")
        return "";
    const trimmed = value.trim();
    if (!trimmed.length)
        return "";
    return trimmed.replace(/\/+$/, "");
}
/**
 * Runs frontend model transport url.
 * @returns {string} - Resolved frontend-model transport URL.
 */
function frontendModelTransportUrl() {
    const configuredUrl = typeof frontendModelTransportConfig.url === "function"
        ? frontendModelTransportConfig.url()
        : frontendModelTransportConfig.url;
    return normalizeFrontendModelTransportUrl(configuredUrl);
}
/**
 * Runs clone frontend model attributes.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} value - Attributes hash.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Cloned attributes hash.
 */
function cloneFrontendModelAttributes(value) {
    return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(serializeFrontendModelTransportValue(value)));
}
/**
 * Shared channel name for model lifecycle events (Phase 3).
 * Matches the backend `FRONTEND_MODELS_CHANNEL_NAME`.
 */
const FRONTEND_MODELS_CHANNEL_NAME = "frontend-models";
/**
 * Runs merge frontend model event preload.
 * @param {Record<string, import("./query.js").FrontendModelTransportValue>} target - Target preload payload.
 * @param {Record<string, import("./query.js").FrontendModelTransportValue>} source - Source preload payload.
 * @returns {void}
 */
function mergeFrontendModelEventPreload(target, source) {
    for (const [relationshipName, value] of Object.entries(source)) {
        const existingValue = target[relationshipName];
        if (value === true || value === false) {
            if (existingValue === undefined)
                target[relationshipName] = value;
            continue;
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            target[relationshipName] = value;
            continue;
        }
        if (!existingValue || typeof existingValue !== "object" || Array.isArray(existingValue)) {
            target[relationshipName] = {};
        }
        mergeFrontendModelEventPreload(
        /** @type {Record<string, import("./query.js").FrontendModelTransportValue>} */ (target[relationshipName]), 
        /** @type {Record<string, import("./query.js").FrontendModelTransportValue>} */ (value));
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
        const existingAttributes = target[modelName] || [];
        target[modelName] = Array.from(new Set(existingAttributes.concat(attributes)));
    }
}
/**
 * Runs merge unique frontend model event entries.
 * @param {Array<import("./query.js").FrontendModelWithCountPayloadEntry | import("./query.js").FrontendModelAbilitiesPayloadEntry>} target - Target array.
 * @param {Array<import("./query.js").FrontendModelWithCountPayloadEntry | import("./query.js").FrontendModelAbilitiesPayloadEntry>} source - Source array.
 * @returns {void}
 */
function mergeUniqueFrontendModelEventEntries(target, source) {
    const existingKeys = new Set(target.map((entry) => JSON.stringify(entry)));
    for (const entry of source) {
        const key = JSON.stringify(entry);
        if (existingKeys.has(key))
            continue;
        target.push(entry);
        existingKeys.add(key);
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
        if (!target.preload)
            target.preload = {};
        mergeFrontendModelEventPreload(target.preload, source.preload);
    }
    if (source.select) {
        if (!target.select)
            target.select = {};
        mergeFrontendModelEventSelect(target.select, source.select);
    }
    if (source.selectsExtra) {
        if (!target.selectsExtra)
            target.selectsExtra = {};
        mergeFrontendModelEventSelect(target.selectsExtra, source.selectsExtra);
    }
    if (source.withCount) {
        if (!target.withCount)
            target.withCount = [];
        mergeUniqueFrontendModelEventEntries(target.withCount, source.withCount);
    }
    if (source.abilities) {
        if (!target.abilities)
            target.abilities = [];
        mergeUniqueFrontendModelEventEntries(target.abilities, source.abilities);
    }
    if (source.queryData !== undefined) {
        const targetQueryData = Array.isArray(target.queryData) ? target.queryData : [];
        target.queryData = targetQueryData;
        const queryDataEntries = Array.isArray(source.queryData) ? source.queryData : [source.queryData];
        for (const entry of queryDataEntries) {
            targetQueryData.push(entry);
        }
    }
}
/**
 * Runs frontend model matched event filter keys.
 * @param {ReturnType<typeof JSON.parse>} body - Raw websocket event body.
 * @returns {Set<string>} - Matched event filter keys delivered by the backend.
 */
function frontendModelMatchedEventFilterKeys(body) {
    if (!body || typeof body !== "object")
        return new Set();
    const keys = /** @type {{matchedEventFilterKeys?: ReturnType<typeof JSON.parse>}} */ (body).matchedEventFilterKeys;
    if (!Array.isArray(keys))
        return new Set();
    return new Set(keys.map((key) => String(key)));
}
/**
 * Runs frontend model event entry matches.
 * @param {FrontendModelModelEventCallbackEntry} entry - Callback entry.
 * @param {Set<string>} matchedEventFilterKeys - Backend matched filter keys.
 * @returns {boolean} Whether the callback should receive the event.
 */
function frontendModelEventEntryMatches(entry, matchedEventFilterKeys) {
    if (!entry.eventFilterKey)
        return true;
    return matchedEventFilterKeys.has(entry.eventFilterKey);
}
/**
 * Runs assert no destroy event filter.
 * @param {FrontendModelClass} ModelClass - Event model class.
 * @param {import("./query.js").FrontendModelEventOptions} options - Event options.
 * @returns {void}
 */
function assertNoDestroyEventFilter(ModelClass, options) {
    const eventOptionsPayload = frontendModelEventOptionsPayload(ModelClass, options);
    if (!eventOptionsPayload.eventFilterKey)
        return;
    throw new Error("Frontend model destroy event subscriptions do not support query filters");
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
     * @param {import("../remote-request-context.js").RemoteRequestContext} requestContext - Captured subscription context.
     */
    constructor(ModelClass, requestContext) {
        this.ModelClass = ModelClass;
        this.requestContext = requestContext;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Set<FrontendModelModelEventCallbackEntry>} */
        this.classCreateCallbacks = new Set();
        /**
         * Narrows the runtime value to the documented type.
         * @type {Set<FrontendModelModelEventCallbackEntry>} */
        this.classUpdateCallbacks = new Set();
        /**
         * Narrows the runtime value to the documented type.
         * @type {Set<FrontendModelDestroyEventCallbackEntry>} */
        this.classDestroyCallbacks = new Set();
        /**
         * Narrows the runtime value to the documented type.
         * @type {Map<string, {instance: FrontendModelBase, updateCallbacks: Set<FrontendModelModelEventCallbackEntry>, destroyCallbacks: Set<FrontendModelDestroyEventCallbackEntry>}>} */
        this.instanceListeners = new Map();
        /**
         * Narrows the runtime value to the documented type.
         * @type {ReturnType<typeof JSON.parse>} */
        this.channelHandle = null;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Promise<void> | null} */
        this.readyPromise = null;
        /**
         * Narrows the runtime value to the documented type.
         * @type {string | null} */
        this.subscriptionParamsKey = null;
    }
    /**
     * Runs subscription params.
     * @returns {{model: string, destroyEventDelivery?: boolean, eventFilters?: import("./query.js").FrontendModelEventFilterPayloadEntry[], unfilteredEventDelivery?: boolean} & import("./query.js").FrontendModelProjectionPayload} - Current websocket subscription params.
     */
    subscriptionParams() {
        /**
         * Projection payload.
         * @type {import("./query.js").FrontendModelProjectionPayload} */
        const projectionPayload = {};
        /**
         * Event filters by key.
         * @type {Record<string, import("./query.js").FrontendModelEventFilterPayloadEntry>} */
        const eventFiltersByKey = {};
        const projectionEntries = [];
        let hasDestroyEventDelivery = this.classDestroyCallbacks.size > 0;
        let hasUnfilteredEventDelivery = false;
        for (const entry of this.classCreateCallbacks)
            projectionEntries.push(entry);
        for (const entry of this.classUpdateCallbacks)
            projectionEntries.push(entry);
        for (const listener of this.instanceListeners.values()) {
            for (const entry of listener.updateCallbacks)
                projectionEntries.push(entry);
            if (listener.destroyCallbacks.size > 0)
                hasDestroyEventDelivery = true;
        }
        for (const entry of projectionEntries) {
            mergeFrontendModelEventProjectionPayload(projectionPayload, entry.projectionPayload);
            if (entry.eventFilterKey && entry.eventFilterPayload) {
                eventFiltersByKey[entry.eventFilterKey] = {
                    ...entry.eventFilterPayload,
                    key: entry.eventFilterKey
                };
            }
            else {
                hasUnfilteredEventDelivery = true;
            }
        }
        const eventFilters = Object.values(eventFiltersByKey);
        const eventFilterParams = eventFilters.length > 0
            ? {
                eventFilters,
                ...(hasDestroyEventDelivery ? { destroyEventDelivery: true } : {}),
                ...(hasUnfilteredEventDelivery ? { unfilteredEventDelivery: true } : {})
            }
            : {};
        return mergeFrontendModelRemoteRequestContext(this.requestContext, {
            model: this.ModelClass.getModelName(),
            ...eventFilterParams,
            ...projectionPayload
        });
    }
    /**
     * Runs subscription params json.
     * @returns {string} - Stable key for current subscription params.
     */
    subscriptionParamsJson() {
        return JSON.stringify(this.subscriptionParams());
    }
    /**
     * Runs register class callback.
     * @template {FrontendModelModelEventCallbackEntry | FrontendModelDestroyEventCallbackEntry} T
     * @param {Set<T>} callbacks - Callback set for the event type.
     * @param {T} entry - Callback entry.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    async registerClassCallback(callbacks, entry) {
        callbacks.add(entry);
        try {
            await this.ensureSubscribed();
        }
        catch (error) {
            callbacks.delete(entry);
            this.maybeTeardown();
            throw error;
        }
        return () => {
            callbacks.delete(entry);
            this.maybeTeardown();
        };
    }
    /**
     * Runs ensure subscribed.
     * @returns {Promise<void>} */
    async ensureSubscribed() {
        const paramsJson = this.subscriptionParamsJson();
        if (this.channelHandle && !this.channelHandle.isClosed()) {
            if (this.subscriptionParamsKey !== paramsJson) {
                this.channelHandle.close();
                this.channelHandle = null;
                this.readyPromise = null;
            }
            else {
                if (this.readyPromise)
                    await this.readyPromise;
                return;
            }
        }
        // Serialize parallel calls (e.g. Promise.all([onCreate, onUpdate,
        // onDestroy])) so we open exactly one subscription per model class
        // instead of racing three concurrent subscribeChannel calls.
        if (this.readyPromise) {
            await this.readyPromise;
            return;
        }
        const client = /** @type {ReturnType<typeof JSON.parse>} */ (frontendModelTransportConfig.websocketClient || resolveInternalWebsocketClient());
        if (!client || typeof client.subscribeChannel !== "function") {
            throw new Error("Frontend model event subscriptions require configureTransport({websocketUrl}) or configureTransport({websocketClient})");
        }
        this.readyPromise = (async () => {
            if (typeof client.connect === "function")
                await client.connect();
            const params = this.subscriptionParams();
            this.subscriptionParamsKey = JSON.stringify(params);
            this.channelHandle = client.subscribeChannel(FRONTEND_MODELS_CHANNEL_NAME, {
                params,
                onMessage: (/** @type {ReturnType<typeof JSON.parse>} */ body) => this._dispatchEvent(body),
                onClose: () => {
                    this.channelHandle = null;
                    this.readyPromise = null;
                    this.subscriptionParamsKey = null;
                    this.instanceListeners.clear();
                }
            });
            await this.channelHandle.ready;
        })();
        await this.readyPromise;
    }
    /**
     * Runs dispatch event.
     * @param {ReturnType<typeof JSON.parse>} body - WebSocket event payload.
     */
    _dispatchEvent(body) {
        if (!body || typeof body !== "object")
            return;
        const action = body.action;
        const rawId = body.id;
        if (action !== "create" && action !== "update" && action !== "destroy")
            return;
        if (rawId === undefined || rawId === null)
            return;
        const primaryKey = this.ModelClass.primaryKey();
        const identity = Array.isArray(primaryKey)
            ? modelPrimaryKeyConditions(primaryKey, rawId)
            : String(rawId);
        const id = modelPrimaryKeyCacheKey(primaryKey, identity);
        const matchedEventFilterKeys = frontendModelMatchedEventFilterKeys(body);
        if (action === "destroy") {
            const listener = this.instanceListeners.get(id);
            if (listener) {
                for (const entry of listener.destroyCallbacks) {
                    try {
                        entry.callback({ id: identity });
                    }
                    catch (error) {
                        console.error(error);
                    }
                }
                this.instanceListeners.delete(id);
            }
            for (const entry of this.classDestroyCallbacks) {
                try {
                    entry.callback({ id: identity });
                }
                catch (error) {
                    console.error(error);
                }
            }
            return;
        }
        if (!body.record || typeof body.record !== "object")
            return;
        const deserializedRecord = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(body.record));
        const freshModel = /** @type {ReturnType<typeof JSON.parse>} */ (this.ModelClass).instantiateFromResponse(deserializedRecord);
        const listener = this.instanceListeners.get(id);
        if (action === "update" && listener) {
            const matchingUpdateCallbacks = Array.from(listener.updateCallbacks).filter((entry) => frontendModelEventEntryMatches(entry, matchedEventFilterKeys));
            if (matchingUpdateCallbacks.length > 0) {
                // Auto-merge into the registered instance so callers reading
                // through the same handle see fresh attributes.
                const instanceAny = /** @type {ReturnType<typeof JSON.parse>} */ (listener.instance);
                instanceAny.assignAttributes(freshModel.attributes());
                instanceAny._persistedAttributes = cloneFrontendModelAttributes(listener.instance.attributes());
                for (const entry of matchingUpdateCallbacks) {
                    try {
                        entry.callback({ id: identity, model: listener.instance });
                    }
                    catch (error) {
                        console.error(error);
                    }
                }
            }
        }
        const classCallbacks = action === "create" ? this.classCreateCallbacks : this.classUpdateCallbacks;
        for (const entry of classCallbacks) {
            if (!frontendModelEventEntryMatches(entry, matchedEventFilterKeys))
                continue;
            try {
                entry.callback({ id: identity, model: freshModel });
            }
            catch (error) {
                console.error(error);
            }
        }
    }
    /**
     * Runs maybe teardown.
     * @returns {void} */
    maybeTeardown() {
        const hasAnyListener = this.classCreateCallbacks.size > 0
            || this.classUpdateCallbacks.size > 0
            || this.classDestroyCallbacks.size > 0
            || this.instanceListeners.size > 0;
        if (hasAnyListener)
            return;
        if (this.channelHandle) {
            try {
                this.channelHandle.close();
            }
            catch (error) {
                console.error(error);
            }
        }
        this.channelHandle = null;
        this.readyPromise = null;
        this.subscriptionParamsKey = null;
        releaseFrontendModelEventSubscription(this);
    }
}
/**
 * Frontend model event subscriptions.
 * @type {WeakMap<FrontendModelClass, Map<string, FrontendModelEventSubscription>>} */
const frontendModelEventSubscriptions = new WeakMap();
/**
 * Runs ensure frontend model event subscription.
 * @param {FrontendModelClass} ModelClass - Model class.
 * @param {import("../remote-request-context.js").RemoteRequestContext} requestContext - Captured subscription context.
 * @returns {FrontendModelEventSubscription} - Per-class subscription helper.
 */
function ensureFrontendModelEventSubscription(ModelClass, requestContext) {
    let subscriptions = frontendModelEventSubscriptions.get(ModelClass);
    if (!subscriptions) {
        subscriptions = new Map();
        frontendModelEventSubscriptions.set(ModelClass, subscriptions);
    }
    const contextKey = remoteRequestContextKey(requestContext);
    let sub = subscriptions.get(contextKey);
    if (!sub) {
        sub = new FrontendModelEventSubscription(ModelClass, requestContext);
        subscriptions.set(contextKey, sub);
    }
    return sub;
}
/**
 * Removes an empty context bucket so switching through many tenants does not retain every snapshot.
 * @param {FrontendModelEventSubscription} subscription - Empty subscription bucket.
 * @returns {void}
 */
function releaseFrontendModelEventSubscription(subscription) {
    const subscriptions = frontendModelEventSubscriptions.get(subscription.ModelClass);
    const contextKey = remoteRequestContextKey(subscription.requestContext);
    if (subscriptions?.get(contextKey) !== subscription)
        return;
    subscriptions.delete(contextKey);
    if (subscriptions.size === 0)
        frontendModelEventSubscriptions.delete(subscription.ModelClass);
}
/**
 * Captures the current frontend-model transport context for one operation.
 * @returns {import("../remote-request-context.js").RemoteRequestContext} Frozen context snapshot.
 */
function frontendModelRequestContext() {
    const configuredContext = typeof frontendModelTransportConfig.requestContext === "function"
        ? frontendModelTransportConfig.requestContext()
        : frontendModelTransportConfig.requestContext;
    return captureFrontendModelRemoteRequestContext(configuredContext);
}
/**
 * Captures the explicit lifecycle context or falls back to the configured transport context.
 * @param {import("../remote-request-context.js").RemoteRequestContext | undefined} requestContext - Registration-local context.
 * @returns {import("../remote-request-context.js").RemoteRequestContext} Frozen context snapshot.
 */
function frontendModelEventRequestContext(requestContext) {
    if (requestContext === undefined)
        return frontendModelRequestContext();
    return captureFrontendModelRemoteRequestContext(requestContext);
}
/**
 * Runs ensure frontend model instance listener.
 * @param {FrontendModelEventSubscription} sub - Event subscription bucket.
 * @param {string} id - Model id.
 * @param {FrontendModelBase} instance - Listener instance.
 * @returns {{instance: FrontendModelBase, updateCallbacks: Set<FrontendModelModelEventCallbackEntry>, destroyCallbacks: Set<FrontendModelDestroyEventCallbackEntry>}} - Instance listener bucket.
 */
function ensureFrontendModelInstanceListener(sub, id, instance) {
    let listener = sub.instanceListeners.get(id);
    if (!listener) {
        listener = { instance, updateCallbacks: new Set(), destroyCallbacks: new Set() };
        sub.instanceListeners.set(id, listener);
    }
    else {
        listener.instance = instance;
    }
    return listener;
}
/**
 * Removes one instance callback entry and tears down an empty listener/subscription bucket.
 * @param {FrontendModelEventSubscription} sub - Event subscription bucket.
 * @param {(listener: ReturnType<typeof ensureFrontendModelInstanceListener>) => boolean} removeEntry - Callback entry removal.
 * @returns {void}
 */
function removeFrontendModelInstanceListenerEntry(sub, removeEntry) {
    for (const [id, current] of sub.instanceListeners) {
        if (!removeEntry(current))
            continue;
        if (current.updateCallbacks.size === 0 && current.destroyCallbacks.size === 0) {
            sub.instanceListeners.delete(id);
        }
        break;
    }
    sub.maybeTeardown();
}
/**
 * Moves callbacks registered on an instance to its newly persisted identity.
 * @param {FrontendModelClass} ModelClass - Frontend model class.
 * @param {FrontendModelBase} instance - Re-keyed instance.
 * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} previousIdentity - Previous persisted identity.
 * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} nextIdentity - New persisted identity.
 * @returns {void}
 */
function rekeyFrontendModelInstanceListeners(ModelClass, instance, previousIdentity, nextIdentity) {
    const primaryKey = ModelClass.primaryKey();
    const previousId = modelPrimaryKeyCacheKey(primaryKey, previousIdentity);
    const nextId = modelPrimaryKeyCacheKey(primaryKey, nextIdentity);
    if (previousId === nextId)
        return;
    const subscriptions = frontendModelEventSubscriptions.get(ModelClass);
    if (!subscriptions)
        return;
    for (const sub of subscriptions.values()) {
        const listener = sub.instanceListeners.get(previousId);
        if (!listener || listener.instance !== instance)
            continue;
        const nextListener = sub.instanceListeners.get(nextId);
        sub.instanceListeners.delete(previousId);
        if (nextListener) {
            nextListener.instance = instance;
            for (const entry of listener.updateCallbacks)
                nextListener.updateCallbacks.add(entry);
            for (const entry of listener.destroyCallbacks)
                nextListener.destroyCallbacks.add(entry);
        }
        else {
            sub.instanceListeners.set(nextId, listener);
        }
    }
}
/**
 * Runs frontend model command url.
 * @param {string} resourcePath - Resource path prefix.
 * @param {string} commandName - Command path segment.
 * @returns {string} - Frontend model API URL.
 */
function frontendModelCommandUrl(resourcePath, commandName) {
    const configuredUrl = frontendModelTransportUrl();
    const normalizedResourcePath = resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`;
    return `${configuredUrl}${normalizedResourcePath}/${commandName}`;
}
/**
 * Runs frontend model api url.
 * @returns {string} - Shared frontend-model API URL.
 */
function frontendModelApiUrl() {
    return `${frontendModelTransportUrl()}${SHARED_FRONTEND_MODEL_API_PATH}`;
}
/**
 * Runs frontend model transport path.
 * @param {string} url - Request URL or path.
 * @returns {string} - Websocket-safe request path.
 */
function frontendModelTransportPath(url) {
    if (typeof url !== "string" || url.length < 1) {
        throw new Error(`Expected frontend model transport URL/path, got: ${url}`);
    }
    if (url.startsWith("/")) {
        return url;
    }
    try {
        const parsedUrl = new URL(url);
        return `${parsedUrl.pathname}${parsedUrl.search}`;
    }
    catch {
        return url;
    }
}
/**
 * Resolves the browser runtime timezone when available.
 * @returns {string | undefined} - Browser runtime timezone when available.
 */
function defaultFrontendModelTimeZone() {
    if (typeof window === "undefined")
        return undefined;
    const intl = globalThis.Intl;
    if (!intl) {
        throw new Error("Expected Intl to be available for browser timezone detection");
    }
    if (typeof intl.DateTimeFormat !== "function") {
        throw new Error("Expected Intl.DateTimeFormat to be available as a function");
    }
    const timeZone = intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof timeZone !== "string" || timeZone.trim().length < 1) {
        throw new Error("Expected Intl.DateTimeFormat to resolve a browser timezone string");
    }
    return validateTimeZone(timeZone, "browser timeZone");
}
/**
 * Resolves the configured frontend-model request timezone.
 * @returns {string | undefined} - Configured frontend-model timezone.
 */
function frontendModelTransportTimeZone() {
    if (!Object.prototype.hasOwnProperty.call(frontendModelTransportConfig, "timeZone")) {
        return defaultFrontendModelTimeZone();
    }
    const timeZone = typeof frontendModelTransportConfig.timeZone === "function"
        ? frontendModelTransportConfig.timeZone()
        : frontendModelTransportConfig.timeZone;
    if (timeZone === undefined || timeZone === null) {
        throw new Error("Frontend model transport timeZone did not resolve to a timezone string");
    }
    return validateTimeZone(timeZone, "frontend model transport timeZone");
}
/**
 * Runs frontend model request headers.
 * @param {string | undefined} [timeZone] - Pre-resolved timezone for this request.
 * @returns {Record<string, string>} - Headers for frontend-model HTTP requests.
 */
function frontendModelRequestHeaders(timeZone = frontendModelTransportTimeZone()) {
    const dynamicHeaders = typeof frontendModelTransportConfig.requestHeaders === "function"
        ? (frontendModelTransportConfig.requestHeaders() || {})
        : (frontendModelTransportConfig.requestHeaders || {});
    /** @type {Record<string, string>} */
    const headers = { "Content-Type": "application/json", ...dynamicHeaders };
    if (timeZone) {
        headers[REQUEST_TIME_ZONE_HEADER] = timeZone;
    }
    return headers;
}
/**
 * Resolves the configured bounded transport deadline in milliseconds.
 * @returns {number | undefined} - Configured deadline, or undefined when no deadline is set.
 */
function frontendModelTransportTimeoutMs() {
    const configuredTimeout = typeof frontendModelTransportConfig.timeout === "function"
        ? frontendModelTransportConfig.timeout()
        : frontendModelTransportConfig.timeout;
    if (typeof configuredTimeout !== "number" || !(configuredTimeout > 0)) {
        return undefined;
    }
    return configuredTimeout;
}
/**
 * Resolves the configured caller/session AbortSignal composed with the deadline.
 * @returns {AbortSignal | undefined} - Configured caller signal, or undefined when none is set.
 */
function frontendModelTransportSignal() {
    const configuredSignal = typeof frontendModelTransportConfig.signal === "function"
        ? frontendModelTransportConfig.signal()
        : frontendModelTransportConfig.signal;
    return configuredSignal || undefined;
}
/**
 * Resolves per-startup controls with the configured session cancellation.
 * @param {{timeoutMs?: number, signal?: AbortSignal}} controls - Call controls.
 * @returns {{timeoutMs?: number, signal?: AbortSignal}} - Effective startup controls.
 */
function frontendModelWebsocketStartupControls(controls) {
    const sessionSignal = frontendModelTransportSignal();
    let signal = controls.signal || sessionSignal;
    if (controls.signal && sessionSignal && controls.signal !== sessionSignal) {
        signal = AbortSignal.any([controls.signal, sessionSignal]);
    }
    const configuredTimeoutMs = frontendModelTransportTimeoutMs();
    const timeoutMs = controls.timeoutMs === undefined
        ? configuredTimeoutMs
        : configuredTimeoutMs === undefined
            ? controls.timeoutMs
            : Math.min(controls.timeoutMs, configuredTimeoutMs);
    return { signal, timeoutMs };
}
/**
 * Runs perform shared frontend model api request.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} requestPayload - Shared request payload.
 * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Decoded shared frontend-model API response.
 */
async function performSharedFrontendModelApiRequest(requestPayload) {
    const timeZone = frontendModelTransportTimeZone();
    const serializedRequestPayload = serializeFrontendModelTransportValue(requestPayload, { timeZone });
    const websocketClient = frontendModelTransportConfig.websocketClient;
    const url = frontendModelApiUrl();
    const mergedHeaders = frontendModelRequestHeaders(timeZone);
    return await runWithTransportDeadline({
        errorMessage: "Shared frontend model API request timed out",
        signal: frontendModelTransportSignal(),
        timeoutMs: frontendModelTransportTimeoutMs()
    }, async (signal) => {
        if (websocketClient) {
            const response = await websocketClient.post(frontendModelTransportPath(url), serializedRequestPayload, {
                headers: mergedHeaders,
                signal
            });
            const responseJson = response.json();
            return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(responseJson));
        }
        const response = await fetch(url, {
            body: JSON.stringify(serializedRequestPayload),
            credentials: "include",
            headers: mergedHeaders,
            method: "POST",
            signal
        });
        const responseText = await response.text();
        if (!response.ok) {
            throwFrontendModelHttpError({
                commandLabel: "shared frontend model API",
                response,
                responseText
            });
        }
        const json = responseText.length > 0 ? JSON.parse(responseText) : {};
        return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(json));
    });
}
/**
 * Throws a frontend-model HTTP error with backend-provided envelope details when available.
 * @param {{commandLabel: string, response: Response, responseText: string}} args - Error response details.
 * @returns {never} - Always throws an unknown-attribute error.
 */
function throwFrontendModelHttpError({ commandLabel, response, responseText }) {
    // Surface the backend's friendly errorMessage envelope (the
    // `{status: "error", errorMessage: "..."}` shape every controller
    // ships on its 4xx/5xx responses) instead of the generic status
    // string. Fall through to the status-only message when the body is
    // missing, non-JSON, or has no usable errorMessage field.
    const responseContentType = response.headers.get("content-type");
    if (responseContentType && responseContentType.includes("application/json") && responseText.length > 0) {
        /**
         * Defines errorBody.
         * @type {Record<string, ReturnType<typeof JSON.parse>> | null} */
        let errorBody;
        try {
            errorBody = JSON.parse(responseText);
        }
        catch {
            errorBody = null;
        }
        if (errorBody && typeof errorBody.errorMessage === "string" && errorBody.errorMessage.trim().length > 0) {
            throw new Error(errorBody.errorMessage.trim());
        }
    }
    throw new Error(`Request failed (${response.status}) for ${commandLabel}`);
}
/**
 * Runs flush pending shared frontend model requests.
 * @returns {Promise<void>} - Resolves after pending shared frontend-model requests flush.
 */
async function flushPendingSharedFrontendModelRequests() {
    sharedFrontendModelFlushScheduled = false;
    if (pendingSharedFrontendModelRequests.length < 1) {
        resolveFrontendModelIdleWaiters();
        return;
    }
    const batchedRequests = pendingSharedFrontendModelRequests;
    pendingSharedFrontendModelRequests = [];
    const url = frontendModelApiUrl();
    const requestPayload = {
        requests: batchedRequests.map((request) => {
            if (request.customPath) {
                return {
                    commandType: request.commandType,
                    customPath: request.customPath,
                    model: request.modelClass.getModelName(),
                    payload: request.payload,
                    ...(Object.keys(request.requestContext).length > 0 ? { requestContext: request.requestContext } : {}),
                    requestId: request.requestId
                };
            }
            return {
                commandType: request.commandType,
                model: request.modelClass.getModelName(),
                payload: request.payload,
                ...(Object.keys(request.requestContext).length > 0 ? { requestContext: request.requestContext } : {}),
                requestId: request.requestId
            };
        })
    };
    await trackFrontendModelTransportRequest(async () => {
        try {
            void url;
            const decodedResponse = await performSharedFrontendModelApiRequest(requestPayload);
            const responses = Array.isArray(decodedResponse.responses) ? decodedResponse.responses : [];
            const responsesById = new Map(responses.map((entry) => [entry.requestId, entry.response]));
            for (const request of batchedRequests) {
                const responsePayload = responsesById.get(request.requestId);
                if (!responsePayload || typeof responsePayload !== "object") {
                    request.reject(new Error(`Missing batched response for ${request.modelClass.name}#${request.commandType}`));
                    continue;
                }
                request.resolve(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (responsePayload));
            }
        }
        catch (error) {
            for (const request of batchedRequests) {
                request.reject(error);
            }
        }
    });
}
/**
 * Runs schedule shared frontend model request flush.
 * @returns {void} */
function scheduleSharedFrontendModelRequestFlush() {
    if (sharedFrontendModelFlushScheduled)
        return;
    sharedFrontendModelFlushScheduled = true;
    queueMicrotask(() => {
        void flushPendingSharedFrontendModelRequests();
    });
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
function frontendModelCustomCommandPath({ commandName, memberId, modelName, resourcePath }) {
    const validatedResourcePath = validateFrontendModelResourcePath({ modelName, resourcePath });
    const validatedCommandName = validateFrontendModelResourceCommandName({ commandName, commandType: commandName, modelName });
    if (memberId === undefined || memberId === null || memberId === "") {
        return `${validatedResourcePath}/${validatedCommandName}`;
    }
    return `${validatedResourcePath}/${encodeURIComponent(String(memberId))}/${validatedCommandName}`;
}
/**
 * Runs assert find by conditions shape.
 * @param {ReturnType<typeof JSON.parse>} conditions - findBy conditions.
 * @returns {void}
 */
function assertFindByConditionsShape(conditions) {
    if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) {
        throw new Error(`findBy expects conditions to be a plain object, got: ${conditions}`);
    }
    const conditionsPrototype = Object.getPrototypeOf(conditions);
    if (conditionsPrototype !== Object.prototype && conditionsPrototype !== null) {
        throw new Error(`findBy expects conditions to be a plain object, got: ${conditions}`);
    }
    const symbolKeys = Object.getOwnPropertySymbols(conditions);
    if (symbolKeys.length > 0) {
        throw new Error(`findBy does not support symbol condition keys (keys: ${symbolKeys.map((key) => key.toString()).join(", ")})`);
    }
}
/**
 * Runs assert defined find by condition value.
 * @param {ReturnType<typeof JSON.parse>} value - Condition value to validate.
 * @param {string} keyPath - Key path for error output.
 * @returns {void}
 */
function assertDefinedFindByConditionValue(value, keyPath) {
    if (value === undefined) {
        throw new Error(`findBy does not support undefined condition values (key: ${keyPath})`);
    }
    if (typeof value === "function") {
        throw new Error(`findBy does not support function condition values (key: ${keyPath})`);
    }
    if (typeof value === "symbol") {
        throw new Error(`findBy does not support symbol condition values (key: ${keyPath})`);
    }
    if (typeof value === "bigint") {
        throw new Error(`findBy does not support bigint condition values (key: ${keyPath})`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
        throw new Error(`findBy does not support non-finite number condition values (key: ${keyPath})`);
    }
    if (Array.isArray(value)) {
        value.forEach((entry, index) => {
            assertDefinedFindByConditionValue(entry, `${keyPath}[${index}]`);
        });
        return;
    }
    if (value && typeof value === "object") {
        if (value instanceof Date) {
            return;
        }
        const objectValue = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value);
        const prototype = Object.getPrototypeOf(objectValue);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new Error(`findBy does not support non-plain object condition values (key: ${keyPath})`);
        }
        const symbolKeys = Object.getOwnPropertySymbols(objectValue);
        if (symbolKeys.length > 0) {
            throw new Error(`findBy does not support symbol condition keys (key: ${keyPath})`);
        }
        const valueObject = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value);
        Object.keys(valueObject).forEach((nestedKey) => {
            assertDefinedFindByConditionValue(valueObject[nestedKey], `${keyPath}.${nestedKey}`);
        });
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
    static modelName;
    /**
     * Autoload.
     * @type {boolean} - Global auto-batch-preload toggle. Apps can opt out via FrontendModelBase.setAutoload(false).
     */
    static _autoload = true;
    /**
     * Runs get autoload.
     * @returns {boolean} Whether auto-batch-preload of relationships on lazy access is enabled globally.
     */
    static getAutoload() { return FrontendModelBase._autoload; }
    /**
     * Runs set autoload.
     * @param {boolean} newValue - Whether auto-batch-preload of relationships is enabled.
     * @returns {void}
     */
    static setAutoload(newValue) { FrontendModelBase._autoload = newValue; }
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, FrontendModelAttributeValue>} */
    _attributes;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, FrontendModelHasManyRelationship<FrontendModelBase, FrontendModelBase, Record<string, FrontendModelAttributeValue>> | FrontendModelSingularRelationship<FrontendModelBase, FrontendModelBase, Record<string, FrontendModelAttributeValue>>>} */
    _relationships;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, FrontendModelAttachmentHandle>} */
    _attachments;
    /**
     * Rails-style nested attribute payloads queued for the next save.
     * @type {Record<string, ReturnType<typeof JSON.parse>>}
     */
    _pendingNestedAttributes;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Set<string> | null} */
    _selectedAttributes;
    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean} */
    _isNewRecord;
    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean} */
    _markedForDestruction;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, FrontendModelAttributeValue>} */
    _persistedAttributes;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<FrontendModelBase> | undefined} - Shared reference to sibling records loaded in the same batch. Used by auto-batch-preload.
     */
    _loadCohort;
    /**
     * Runs constructor.
     * @param {Attributes | CreateAttributes} [attributes] - Initial attributes.
     */
    constructor(attributes) {
        const ModelClass = frontendModelClassFor(this);
        ModelClass.ensureGeneratedAttachmentMethods();
        this._attributes = {};
        this._relationships = {};
        this._attachments = {};
        this._pendingNestedAttributes = {};
        this._selectedAttributes = null;
        this._isNewRecord = true;
        this._markedForDestruction = false;
        this._persistedAttributes = {};
        if (attributes)
            this.assignAttributes(attributes);
    }
    /**
     * Runs ensure generated attachment methods.
     * @this {FrontendModelClass}
     * @returns {void} - Ensures attachment helper methods exist on the prototype.
     */
    static ensureGeneratedAttachmentMethods() {
        if (this._generatedAttachmentMethods)
            return;
        const attachments = this.attachmentDefinitions();
        const prototype = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (this.prototype);
        for (const attachmentName of Object.keys(attachments)) {
            if (!(attachmentName in prototype)) {
                prototype[attachmentName] = function () {
                    return this.getAttachmentByName(attachmentName);
                };
            }
        }
        this._generatedAttachmentMethods = true;
    }
    /**
     * Runs resource config.
     * @returns {FrontendModelResourceConfig} - Resource configuration.
     */
    static resourceConfig() {
        throw new Error("resourceConfig() must be implemented by subclasses");
        // eslint-disable-next-line no-unreachable
        return {};
    }
    /**
     * Runs relationship model classes.
     * @this {FrontendModelClass}
     * @returns {Record<string, FrontendModelClass | string>} - Relationship model classes (or class name strings) keyed by relationship name.
     */
    static relationshipModelClasses() {
        return {};
    }
    /**
     * Register a frontend model class so it can be resolved by name in relationship lookups.
     * @param {FrontendModelClass} modelClass - Model class to register.
     * @returns {void}
     */
    static registerModel(modelClass) {
        registerFrontendModel(modelClass);
    }
    /**
     * Runs define scope.
     * @param {(...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>} callback - Scope callback.
     * @returns {((...args: Array<ReturnType<typeof JSON.parse>>) => import("./query.js").default<FrontendModelClass>) & {scope: (...args: Array<ReturnType<typeof JSON.parse>>) => import("../utils/model-scope.js").ModelScopeDescriptor}} - Scope helper.
     */
    static defineScope(callback) {
        return defineModelScope({
            callback,
            modelClass: this,
            startQuery: () => this.query()
        });
    }
    /**
     * Resolve a relationship model class value that may be a class reference or a string name.
     * @param {FrontendModelClass | string | null | undefined} value - Class or class name.
     * @returns {FrontendModelClass | null} - Resolved model class.
     */
    static resolveModelClass(value) {
        return resolveFrontendModelClass(value);
    }
    /**
     * Runs relationship definitions.
     * @this {FrontendModelClass}
     * @returns {Record<string, {type: "belongsTo" | "hasOne" | "hasMany", autoload?: boolean}>} - Relationship definitions keyed by relationship name.
     */
    static relationshipDefinitions() {
        return {};
    }
    /**
     * Runs attachment definitions.
     * @this {FrontendModelClass}
     * @returns {Record<string, FrontendModelAttachmentDefinition>} - Attachment definitions keyed by attachment name.
     */
    static attachmentDefinitions() {
        return this.resourceConfig().attachments || {};
    }
    /**
     * Runs attachment definition.
     * @this {FrontendModelClass}
     * @param {string} attachmentName - Attachment name.
     * @returns {FrontendModelAttachmentDefinition | null} - Attachment definition.
     */
    static attachmentDefinition(attachmentName) {
        return this.attachmentDefinitions()[attachmentName] || null;
    }
    /**
     * Runs relationship definition.
     * @this {FrontendModelClass}
     * @param {string} relationshipName - Relationship name.
     * @returns {{type: "belongsTo" | "hasOne" | "hasMany", autoload?: boolean} | null} - Relationship definition.
     */
    static relationshipDefinition(relationshipName) {
        const definitions = this.relationshipDefinitions();
        return definitions[relationshipName] || null;
    }
    /**
     * Resolves a Rails-style nested attributes key to a configured relationship.
     * @this {FrontendModelClass}
     * @param {string} attributeName - Candidate attribute name, such as `tasksAttributes`.
     * @returns {string | null} Relationship name when nested attributes are configured.
     */
    static nestedAttributesRelationshipName(attributeName) {
        if (!attributeName.endsWith("Attributes"))
            return null;
        const relationshipName = attributeName.slice(0, -"Attributes".length);
        const nestedAttributesConfig = this.resourceConfig().nestedAttributes || {};
        return Object.prototype.hasOwnProperty.call(nestedAttributesConfig, relationshipName)
            ? relationshipName
            : null;
    }
    /**
     * Runs relationship model class.
     * @this {FrontendModelClass}
     * @param {string} relationshipName - Relationship name.
     * @returns {FrontendModelClass | null} - Target relationship model class.
     */
    static relationshipModelClass(relationshipName) {
        const relationshipModelClasses = this.relationshipModelClasses();
        const value = relationshipModelClasses[relationshipName];
        return FrontendModelBase.resolveModelClass(value);
    }
    /**
     * Runs attributes.
     * @returns {Attributes} - Attributes hash.
     */
    attributes() {
        return /** @type {Attributes} */ (this._attributes);
    }
    /**
     * Runs is new record.
     * @returns {boolean} - Whether this model has not yet been persisted.
     */
    isNewRecord() {
        return this._isNewRecord;
    }
    /**
     * Runs is persisted.
     * @returns {boolean} - Whether this model has been persisted.
     */
    isPersisted() {
        return !this.isNewRecord();
    }
    /**
     * Runs set is new record.
     * @param {boolean} newIsNewRecord - New persisted-state flag.
     * @returns {void}
     */
    setIsNewRecord(newIsNewRecord) {
        this._isNewRecord = newIsNewRecord;
    }
    /**
     * Marks this record for destruction when its parent is next saved through
     * nested-attribute support. The record is not removed from the parent's
     * relationship collection until the server confirms the delete.
     * @returns {void} - No return value.
     */
    markForDestruction() {
        this._markedForDestruction = true;
    }
    /**
     * Runs marked for destruction.
     * @returns {boolean} - Whether this record is queued for nested destruction on next parent save.
     */
    markedForDestruction() {
        return this._markedForDestruction;
    }
    /**
     * Runs changes.
     * @returns {Record<string, Array<ReturnType<typeof JSON.parse>>>} - Changed attributes as `[oldValue, newValue]`.
     */
    changes() {
        /**
         * Changed attributes.
         * @type {Record<string, Array<ReturnType<typeof JSON.parse>>>} */
        const changedAttributes = {};
        const attributeNames = new Set([
            ...Object.keys(this._persistedAttributes),
            ...Object.keys(this._attributes)
        ]);
        for (const attributeName of attributeNames) {
            const previousValue = this._persistedAttributes[attributeName];
            const currentValue = this._attributes[attributeName];
            if (JSON.stringify(serializeFrontendModelTransportValue(previousValue)) !== JSON.stringify(serializeFrontendModelTransportValue(currentValue))) {
                changedAttributes[attributeName] = [previousValue, currentValue];
            }
        }
        return changedAttributes;
    }
    /**
     * Runs is changed.
     * @returns {boolean} - Whether any tracked attribute has changed.
     */
    isChanged() {
        return Object.keys(this.changes()).length > 0;
    }
    /**
     * Runs get relationship by name.
     * @param {string} relationshipName - Relationship name.
     * @returns {FrontendModelRelationship} - Relationship state object.
     */
    getRelationshipByName(relationshipName) {
        if (!this._relationships[relationshipName]) {
            const ModelClass = frontendModelClassFor(this);
            const relationshipDefinition = ModelClass.relationshipDefinition(relationshipName);
            const targetModelClass = ModelClass.relationshipModelClass(relationshipName);
            if (relationshipDefinition && relationshipTypeIsCollection(relationshipDefinition.type)) {
                this._relationships[relationshipName] = new FrontendModelHasManyRelationship(this, relationshipName, targetModelClass);
            }
            else {
                this._relationships[relationshipName] = new FrontendModelSingularRelationship(this, relationshipName, targetModelClass);
            }
        }
        return this._relationships[relationshipName];
    }
    /**
     * Runs get attachment by name.
     * @param {string} attachmentName - Attachment name.
     * @returns {FrontendModelAttachmentHandle} - Attachment helper.
     */
    getAttachmentByName(attachmentName) {
        const ModelClass = frontendModelClassFor(this);
        const attachmentDefinition = ModelClass.attachmentDefinition(attachmentName);
        if (!attachmentDefinition) {
            throw new Error(`Unknown attachment: ${ModelClass.name}#${attachmentName}`);
        }
        if (!this._attachments[attachmentName]) {
            this._attachments[attachmentName] = new FrontendModelAttachmentHandle({
                attachmentName,
                model: this
            });
        }
        return this._attachments[attachmentName];
    }
    /**
     * Runs load relationship.
     * @param {string} relationshipName - Relationship name.
     * @returns {Promise<FrontendModelBase | Array<FrontendModelBase> | null>} - Loaded relationship value.
     */
    async loadRelationship(relationshipName) {
        const ModelClass = frontendModelClassFor(this);
        const id = this.primaryKeyValue();
        const reloadedModel = await ModelClass
            .preload([relationshipName])
            .find(id);
        const sourceRelationship = reloadedModel.getRelationshipByName(relationshipName);
        const targetRelationship = this.getRelationshipByName(relationshipName);
        copyLoadedRelationshipValue({ sourceRelationship, targetRelationship });
        return targetRelationship.loaded();
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
        await FrontendModelPreloader.preload([this], queryOrSpec, options);
    }
    /**
     * Runs relationship or load.
     * @param {string} relationshipName - Relationship name.
     * @returns {Promise<FrontendModelBase | Array<FrontendModelBase> | null>} - Loaded relationship value.
     */
    async relationshipOrLoad(relationshipName) {
        const relationship = this.getRelationshipByName(relationshipName);
        if (relationship.getPreloaded()) {
            return relationship.loaded();
        }
        const batched = await this._tryCohortPreload(relationshipName);
        if (batched)
            return relationship.loaded();
        return await this.loadRelationship(relationshipName);
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
        if (!FrontendModelBase.getAutoload())
            return false;
        const ModelClass = frontendModelClassFor(this);
        const cohort = this._loadCohort;
        if (!cohort || cohort.length <= 1)
            return false;
        const definition = ModelClass.relationshipDefinition(relationshipName);
        if (!definition)
            return false;
        if (definition.autoload === false)
            return false;
        /**
         * Batch.
         * @type {Array<FrontendModelBase>} */
        const batch = [];
        // Exact same class, persisted, no existing in-memory relationship state.
        // `setLoaded` sets `_preloaded = true` on every mutation path (preload,
        // setRelationship, build, addToLoaded), so `getPreloaded()` alone is a
        // reliable "already touched" signal on the frontend.
        for (const sibling of cohort) {
            if (sibling.constructor !== ModelClass)
                continue;
            if (sibling.isNewRecord())
                continue;
            const siblingRelationship = sibling.getRelationshipByName(relationshipName);
            if (siblingRelationship.getPreloaded())
                continue;
            batch.push(sibling);
        }
        if (batch.length === 0)
            return false;
        const primaryKey = ModelClass.primaryKey();
        if (Array.isArray(primaryKey))
            return false;
        const batchIds = batch.map((sibling) => sibling.primaryKeyValue());
        const reloadedBatch = await ModelClass
            .preload([relationshipName])
            .where({ [primaryKey]: batchIds })
            .toArray();
        /**
         * Reloaded by id.
         * @type {Map<string, FrontendModelBase>} */
        const reloadedById = new Map();
        for (const reloaded of reloadedBatch) {
            reloadedById.set(modelPrimaryKeyCacheKey(primaryKey, reloaded.primaryKeyValue()), reloaded);
        }
        for (const sibling of batch) {
            const key = modelPrimaryKeyCacheKey(primaryKey, sibling.primaryKeyValue());
            const reloaded = reloadedById.get(key);
            if (!reloaded)
                continue;
            copyLoadedRelationshipValue({
                sourceRelationship: reloaded.getRelationshipByName(relationshipName),
                targetRelationship: sibling.getRelationshipByName(relationshipName)
            });
        }
        // If the caller itself was not populated (record deleted/filtered between
        // the list fetch and this preload request), fall back to per-record load
        // so the caller gets a real not-found error instead of a misleading
        // "hasn't been preloaded" throw from loaded().
        if (!this.getRelationshipByName(relationshipName).getPreloaded())
            return false;
        return true;
    }
    /**
     * Runs set relationship.
     * @param {string} relationshipName - Relationship name.
     * @param {FrontendModelBase | null | undefined} relationshipValue - Relationship value.
     * @returns {FrontendModelBase | null | undefined} - Assigned relationship value.
     */
    setRelationship(relationshipName, relationshipValue) {
        const ModelClass = frontendModelClassFor(this);
        const relationshipDefinition = ModelClass.relationshipDefinition(relationshipName);
        if (!relationshipDefinition) {
            throw new Error(`Unknown relationship: ${ModelClass.name}#${relationshipName}`);
        }
        const relationship = this.getRelationshipByName(relationshipName);
        if (relationship instanceof FrontendModelHasManyRelationship) {
            throw new Error(`Cannot set has-many relationship with setRelationship(): ${ModelClass.name}#${relationshipName}`);
        }
        relationship.setLoaded(relationshipValue);
        return relationshipValue;
    }
    /**
     * Runs assign attributes.
     * @param {Attributes | CreateAttributes | UpdateAttributes | Record<string, FrontendModelAttributeValue>} attributes - Attributes to assign.
     * @returns {void} - No return value.
     */
    assignAttributes(attributes) {
        const attributeValues = /** @type {Record<string, FrontendModelAttributeValue>} */ (attributes);
        for (const key in attributeValues) {
            this.setAttribute(key, attributeValues[key]);
        }
    }
    /**
     * Runs clear relationship cache.
     * @returns {void} - Clears cached relationship state.
     */
    clearRelationshipCache() {
        this._relationships = {};
    }
    /**
     * Runs primary key.
     * @this {FrontendModelClass}
     * @returns {import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition} - Primary key name.
     */
    static primaryKey() {
        return this.resourceConfig().primaryKey || "id";
    }
    /**
     * Runs primary key value.
     * @returns {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} - Primary key value.
     */
    primaryKeyValue() {
        const ModelClass = frontendModelClassFor(this);
        const primaryKey = ModelClass.primaryKey();
        return readModelPrimaryKeyValue(primaryKey, (attributeName) => {
            const value = this.readAttribute(attributeName);
            if (value === undefined || value === null) {
                throw new Error(`Missing primary key '${attributeName}' on ${ModelClass.name}`);
            }
            return value;
        });
    }
    /**
     * Returns the identity represented by the last persisted frontend attributes.
     * @returns {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} - Persisted primary-key value.
     */
    persistedPrimaryKeyValue() {
        const ModelClass = frontendModelClassFor(this);
        const primaryKey = ModelClass.primaryKey();
        return readModelPrimaryKeyValue(primaryKey, (attributeName) => {
            const value = this._persistedAttributes[attributeName];
            if (value === undefined || value === null) {
                throw new Error(`Missing persisted primary key '${attributeName}' on ${ModelClass.name}`);
            }
            return value;
        });
    }
    /**
     * Runs read attribute.
     * @param {string} attributeName - Attribute name.
     * @returns {ReturnType<typeof JSON.parse>} - Attribute value.
     */
    readAttribute(attributeName) {
        if (this._selectedAttributes && !this._selectedAttributes.has(attributeName)) {
            throw new AttributeNotSelectedError(this.constructor.name, attributeName);
        }
        return this._attributes[attributeName];
    }
    /**
     * Whether an attribute value is currently loaded on this record. Used by the
     * preloader to decide whether a relationship can be skipped because the
     * requested columns are already present.
     * @param {string} attributeName - Attribute name.
     * @returns {boolean} - Whether the attribute is loaded.
     */
    hasLoadedAttribute(attributeName) {
        if (!this._selectedAttributes)
            return true;
        return this._selectedAttributes.has(attributeName);
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
        return readPayloadAssociationCount(/** @type {import("../record-payload-values.js").RecordPayloadValuesTarget} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this)), attributeName);
    }
    /**
     * Internal setter called by `instantiateFromResponse` when hydrating
     * association counts that rode along with the record payload.
     * @param {string} attributeName - Attribute name.
     * @param {number} value - Count value.
     * @returns {void}
     */
    _setAssociationCount(attributeName, value) {
        setPayloadAssociationCount(/** @type {import("../record-payload-values.js").RecordPayloadValuesTarget} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this)), attributeName, value);
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
        return readPayloadComputedAbility(/** @type {import("../record-payload-values.js").RecordPayloadValuesTarget} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this)), action);
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
        setPayloadComputedAbility(/** @type {import("../record-payload-values.js").RecordPayloadValuesTarget} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this)), action, value);
    }
    /**
     * Read a consumer-defined value attached by `.queryData(...)`. Stored
     * on a dedicated map rather than `_attributes`, so a virtual alias
     * like `tasksCount` cannot silently shadow a real column of the same
     * name. Returns `null` when no registered fn produced that alias for
     * this record (e.g. no child rows matched the aggregate).
     * @param {string} name - queryData alias name.
     * @returns {ReturnType<typeof JSON.parse>} - Attached query-data value.
     */
    queryData(name) {
        return readPayloadQueryData(/** @type {import("../record-payload-values.js").RecordPayloadValuesTarget} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this)), name);
    }
    /**
     * Internal setter used by `instantiateFromResponse` when hydrating
     * queryData values that rode along with the record payload.
     * @param {string} name - queryData alias name.
     * @param {ReturnType<typeof JSON.parse>} value - Attached value.
     * @returns {void}
     */
    _setQueryData(name, value) {
        setPayloadQueryData(/** @type {import("../record-payload-values.js").RecordPayloadValuesTarget} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this)), name, value);
    }
    /**
     * Runs set attribute.
     * @param {string} attributeName - Attribute name.
     * @param {ReturnType<typeof JSON.parse>} newValue - New value.
     * @returns {ReturnType<typeof JSON.parse>} - Assigned value.
     */
    setAttribute(attributeName, newValue) {
        const ModelClass = frontendModelClassFor(this);
        const nestedAttributesRelationshipName = ModelClass.nestedAttributesRelationshipName(attributeName);
        if (nestedAttributesRelationshipName) {
            this._pendingNestedAttributes[nestedAttributesRelationshipName] = newValue;
            return newValue;
        }
        if (ModelClass.attachmentDefinition(attributeName)) {
            this.getAttachmentByName(attributeName).queueAttach(newValue);
            return newValue;
        }
        const previousValue = this._attributes[attributeName];
        this._attributes[attributeName] = newValue;
        if (this._selectedAttributes) {
            this._selectedAttributes.add(attributeName);
        }
        // Only invalidate relationship cache entries whose foreign key matches the changed attribute.
        // Blanket-clearing all relationships on any attribute change destroys nested-save state
        // and preloaded children the caller never asked to invalidate.
        if (!Object.is(previousValue, newValue)) {
            this._invalidateRelationshipsForAttribute(attributeName);
        }
        return newValue;
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
        if (!this._relationships || Object.keys(this._relationships).length === 0)
            return;
        const ModelClass = frontendModelClassFor(this);
        const definitions = ModelClass.relationshipDefinitions();
        for (const relationshipName of Object.keys(this._relationships)) {
            const definition = /** @type {ReturnType<typeof JSON.parse>} */ (definitions[relationshipName]);
            if (!definition || definition.type !== "belongsTo")
                continue;
            const foreignKey = definition.foreignKey || `${relationshipName}Id`;
            if (foreignKey === attributeName) {
                delete this._relationships[relationshipName];
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
        });
    }
    /**
     * Runs command name.
     * @this {FrontendModelClass}
     * @param {FrontendModelCommandType} commandType - Command type.
     * @returns {string} - Resolved command name.
     */
    static commandName(commandType) {
        const resourceConfig = this.resourceConfig();
        const builtInCollectionCommands = resourceConfig.builtInCollectionCommands || [];
        const builtInMemberCommands = resourceConfig.builtInMemberCommands || [];
        const commands = resourceConfig.commands || [];
        const isExposed = builtInCollectionCommands.includes(commandType) || builtInMemberCommands.includes(commandType) || commands.includes(commandType);
        const commandName = isExposed ? inflection.dasherize(inflection.underscore(commandType)) : commandType;
        return validateFrontendModelResourceCommandName({
            commandName,
            commandType,
            modelName: this.getModelName()
        });
    }
    /**
     * Runs normalize custom command payload arguments.
     * @this {FrontendModelClass}
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Command arguments.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Command payload.
     */
    static normalizeCustomCommandPayloadArguments(args) {
        if (args.length === 0)
            return {};
        if (args.length === 1) {
            const payload = args[0];
            if (payload === undefined) {
                return {};
            }
            if (typeof payload !== "object" || payload === null) {
                return { arg1: payload };
            }
            return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (payload);
        }
        /**
         * Payload.
         * @type {Record<string, number | string | Array<ReturnType<typeof JSON.parse>>>} */
        const payload = {};
        for (let index = 0; index < args.length; index += 1) {
            payload[`arg${index + 1}`] = args[index];
        }
        return payload;
    }
    /**
     * Returns the model name, preferring an explicit `static modelName` declaration
     * over the JavaScript class `.name` property. This allows minified builds to
     * preserve correct model names without relying on `keep_classnames`.
     * @this {FrontendModelClass}
     * @returns {string} - The model name.
     */
    static getModelName() {
        const resourceConfig = this.resourceConfig();
        const modelName = resourceConfig?.modelName;
        return (typeof modelName === "string" && modelName.length > 0) ? modelName : this.name;
    }
    /**
     * Runs configure transport.
     * @param {FrontendModelTransportConfig} config - Frontend model transport configuration.
     * @returns {void} - No return value.
     */
    static configureTransport(config) {
        if (!config || typeof config !== "object") {
            return;
        }
        if (Object.prototype.hasOwnProperty.call(config, "url")) {
            frontendModelTransportConfig.url = config.url;
        }
        if (Object.prototype.hasOwnProperty.call(config, "shared")) {
            frontendModelTransportConfig.shared = config.shared;
        }
        if (Object.prototype.hasOwnProperty.call(config, "websocketClient")) {
            frontendModelTransportConfig.websocketClient = config.websocketClient;
        }
        if (Object.prototype.hasOwnProperty.call(config, "websocketUrl")) {
            frontendModelTransportConfig.websocketUrl = config.websocketUrl;
            // Reset cached internal client so the new URL takes effect on next subscribe
            resetInternalWebsocketClient();
        }
        if (Object.prototype.hasOwnProperty.call(config, "requestHeaders")) {
            frontendModelTransportConfig.requestHeaders = config.requestHeaders;
        }
        if (Object.prototype.hasOwnProperty.call(config, "requestContext")) {
            frontendModelTransportConfig.requestContext = config.requestContext;
        }
        if (Object.prototype.hasOwnProperty.call(config, "timeout")) {
            frontendModelTransportConfig.timeout = config.timeout;
        }
        if (Object.prototype.hasOwnProperty.call(config, "signal")) {
            if (frontendModelTransportConfig.signal !== config.signal) {
                frontendModelTransportConfig.signal = config.signal;
                resetInternalWebsocketClient();
            }
        }
        if (Object.prototype.hasOwnProperty.call(config, "timeZone")) {
            if (config.timeZone === undefined) {
                delete frontendModelTransportConfig.timeZone;
            }
            else {
                frontendModelTransportConfig.timeZone = config.timeZone;
            }
        }
        if (Object.prototype.hasOwnProperty.call(config, "sessionStore")) {
            frontendModelTransportConfig.sessionStore = config.sessionStore;
            // Reset cached internal client so the new sessionStore is picked up.
            resetInternalWebsocketClient();
        }
        if (Object.prototype.hasOwnProperty.call(config, "offlineSync")) {
            frontendModelTransportConfig.offlineSync = config.offlineSync;
        }
    }
    /**
     * Connect the internal WebSocket and enable auto-reconnect.
     * @param {{timeoutMs?: number, signal?: AbortSignal}} [options] - Startup controls composed with the configured transport controls.
     * @returns {Promise<void>} - Resolves when connected.
     */
    static async connectWebsocket(options = {}) {
        const client = resolveInternalWebsocketClient();
        if (!client) {
            throw new Error("connectWebsocket requires configureTransport({websocketUrl})");
        }
        await client.connect(frontendModelWebsocketStartupControls(options));
    }
    /**
     * Disconnect the internal WebSocket and disable auto-reconnect.
     * @returns {Promise<void>} - Resolves when closed.
     */
    static async disconnectWebsocket() {
        if (!internalWebsocketClient)
            return;
        const client = internalWebsocketClient;
        detachInternalWebsocketClient(client);
        await client.disconnectAndStopReconnect();
    }
    /**
     * Waits until queued and active frontend-model transport requests finish.
     * @param {FrontendModelIdleWaitArgs} [args] - Wait options.
     * @returns {Promise<void>} - Resolves when transport is idle.
     */
    static async waitForIdle(args = {}) {
        const { quietMs = 0, timeout: timeoutMs = 5000, ...restArgs } = args;
        const restArgKeys = Object.keys(restArgs);
        if (restArgKeys.length > 0) {
            throw new Error(`Unknown waitForIdle args: ${restArgKeys.join(", ")}`);
        }
        if (!Number.isFinite(quietMs) || quietMs < 0) {
            throw new Error(`Expected waitForIdle quietMs to be a non-negative number, got: ${quietMs}`);
        }
        await timeout({ timeout: timeoutMs, errorMessage: "Timed out waiting for frontend model transport to become idle" }, async () => await waitForFrontendModelTransportIdle(quietMs));
    }
    /**
     * Returns the current WebSocket connection state.
     * @returns {{disconnectedSince: number | null, hasClient: boolean, isOpen: boolean, listenerCount: number}} - Snapshot of the managed websocket connection state.
     */
    static websocketState() {
        if (!internalWebsocketClient) {
            return { disconnectedSince: null, hasClient: false, isOpen: false, listenerCount: 0 };
        }
        return {
            ...internalWebsocketClient.state(),
            hasClient: true
        };
    }
    /**
     * Close the raw WebSocket without disabling auto-reconnect. Used by tests to
     * simulate an unexpected network drop and verify reconnection behavior.
     * @returns {Promise<void>} - Resolves when the socket has closed.
     */
    static async dropWebsocket() {
        if (!internalWebsocketClient)
            return;
        await internalWebsocketClient.dropConnection();
    }
    /**
     * Sets global metadata on the WebSocket connection. Sent to the server immediately
     * over WebSocket and exposed to WebSocket-borne requests as request metadata.
     * @param {string} key - Metadata key.
     * @param {ReturnType<typeof JSON.parse>} value - Metadata value (null to clear).
     * @returns {void}
     */
    static setWebsocketMetadata(key, value) {
        const client = /** @type {ReturnType<typeof JSON.parse>} */ (frontendModelTransportConfig.websocketClient || resolveInternalWebsocketClient());
        if (!client || typeof client.setMetadata !== "function")
            return;
        client.setMetadata(key, value);
    }
    /**
     * Opens a managed connection that auto-opens, auto-closes, and
     * auto-reconnects based on `shouldConnect()` and `params()`.
     * Call `handle.sync()` whenever the inputs that drive those
     * functions change (e.g. current-user sign-in/out). The handle
     * retries when the WS client isn't ready and reopens on close.
     * @param {string} connectionType - Connection class name registered on the server.
     * @param {{shouldConnect: () => boolean, params: () => Record<string, ReturnType<typeof JSON.parse>>, signal?: AbortSignal, onMessage?: (body: ReturnType<typeof JSON.parse>) => void}} options - Connection lifecycle, cancellation, and payload callbacks.
     * @returns {{sync: () => void, close: () => void}} - Handle used to resync or close the managed connection.
     */
    static openManagedConnection(connectionType, options) {
        /**
         * Connection.
         * @type {ReturnType<typeof JSON.parse>} */
        let connection = null;
        let closed = false;
        /**
         * Retry timer.
         * @type {ReturnType<typeof setTimeout> | null} */
        let retryTimer = null;
        let lastParamsJson = "";
        const controls = frontendModelWebsocketStartupControls({ signal: options.signal });
        const clearRetryTimer = () => {
            if (retryTimer === null)
                return;
            globalThis.clearTimeout(retryTimer);
            retryTimer = null;
        };
        const close = () => {
            if (closed)
                return;
            closed = true;
            clearRetryTimer();
            controls.signal?.removeEventListener("abort", close);
            if (connection && !connection.isClosed())
                connection.close();
            connection = null;
        };
        const sync = () => {
            if (closed)
                return;
            if (!options.shouldConnect()) {
                clearRetryTimer();
                if (connection && !connection.isClosed())
                    connection.close();
                connection = null;
                lastParamsJson = "";
                return;
            }
            const nextParams = options.params();
            const nextParamsJson = JSON.stringify(nextParams);
            // Already connected with same params — nothing to do.
            if (connection && !connection.isClosed() && nextParamsJson === lastParamsJson)
                return;
            // Connected but params changed — send update message.
            // Guard with try/catch: the connection handle stays live during
            // reconnect but the underlying socket may be closed.
            if (connection && !connection.isClosed()) {
                try {
                    connection.sendMessage(nextParams);
                    lastParamsJson = nextParamsJson;
                    return;
                }
                catch {
                    connection = null;
                    lastParamsJson = "";
                }
            }
            // WS client not ready — retry. Check the actual client (which
            // may be an injected websocketClient) instead of websocketState()
            // which only reflects the internal client.
            const client = /** @type {ReturnType<typeof JSON.parse>} */ (frontendModelTransportConfig.websocketClient || resolveInternalWebsocketClient());
            if (!client || !client.isOpen()) {
                if (retryTimer === null) {
                    retryTimer = globalThis.setTimeout(() => {
                        retryTimer = null;
                        sync();
                    }, 250);
                }
                return;
            }
            lastParamsJson = nextParamsJson;
            connection = client.openConnection(connectionType, {
                params: nextParams,
                onMessage: options.onMessage,
                onClose: () => {
                    if (connection?.isClosed()) {
                        connection = null;
                        lastParamsJson = "";
                        sync();
                    }
                }
            });
        };
        controls.signal?.addEventListener("abort", close, { once: true });
        if (controls.signal?.aborted) {
            close();
        }
        else {
            sync();
        }
        return { sync, close };
    }
    /**
     * Opens a 1:1 `WebsocketConnection` of the given type. Thin
     * convenience wrapper around the internal WS client's
     * `openConnection`. Apps use this for per-session state/messaging
     * that doesn't fit the pub/sub Channel model (locale, presence).
     * @param {string} connectionType - Name the server registered the class under.
     * @param {{params?: Record<string, ReturnType<typeof JSON.parse>>, timeoutMs?: number, signal?: AbortSignal, onConnect?: () => void, onMessage?: (body: Record<string, unknown>) => void, onDisconnect?: () => void, onResume?: () => void, onClose?: (reason: string) => void}} [options] - Connection options, readiness controls, and event handlers. Connect the client first; the timeout covers server-confirmed readiness and the signal cancels readiness without entering the wire payload.
     * @returns {{ready: Promise<void>, close: () => void}} - Websocket connection handle.
     */
    static openWebsocketConnection(connectionType, options = {}) {
        const client = /** @type {ReturnType<typeof JSON.parse>} */ (frontendModelTransportConfig.websocketClient || resolveInternalWebsocketClient());
        if (!client || typeof client.openConnection !== "function") {
            throw new Error("openWebsocketConnection requires configureTransport({websocketUrl})");
        }
        const { signal, timeoutMs, ...connectionOptions } = options;
        return client.openConnection(connectionType, {
            ...connectionOptions,
            ...frontendModelWebsocketStartupControls({ signal, timeoutMs })
        });
    }
    /**
     * Subscribes to a pub/sub `WebsocketChannel`. Thin wrapper around
     * the internal client's `subscribeChannel`.
     * @param {string} channelType - Channel class name registered on the server.
     * @param {{params?: Record<string, ReturnType<typeof JSON.parse>>, timeoutMs?: number, signal?: AbortSignal, onMessage?: (body: Record<string, unknown>) => void, onDisconnect?: () => void, onResume?: () => void, onClose?: (reason: string) => void}} [options] - Channel options, startup controls, and event handlers. The timeout covers connect and server-confirmed readiness only; the signal cancels startup without entering the wire payload.
     * @returns {{ready: Promise<void>, close: () => void}} - Websocket channel handle from the configured client.
     */
    static subscribeWebsocketChannel(channelType, options = {}) {
        const client = /** @type {ReturnType<typeof JSON.parse>} */ (frontendModelTransportConfig.websocketClient || resolveInternalWebsocketClient());
        if (!client || typeof client.subscribeChannel !== "function") {
            throw new Error("subscribeWebsocketChannel requires configureTransport({websocketUrl})");
        }
        const { params, signal, timeoutMs, ...channelOptions } = options;
        const requestContext = frontendModelRequestContext();
        const scopedParams = mergeFrontendModelRemoteRequestContext(requestContext, params === undefined ? {} : params);
        const startupControls = frontendModelWebsocketStartupControls({ signal, timeoutMs });
        const scopedParamsOption = params === undefined && Object.keys(requestContext).length === 0
            ? {}
            : { params: scopedParams };
        const handle = client.subscribeChannel(channelType, { ...channelOptions, ...scopedParamsOption, ...startupControls });
        if (typeof client.connect === "function") {
            void client.connect(startupControls).catch(() => handle.close());
        }
        return handle;
    }
    /**
     * Installs WebSocket lifecycle hooks on globalThis for system test access.
     * Tests can call `globalThis.__velocious_websocket_hooks.connect()` etc.
     * @returns {void}
     */
    static installWebsocketTestHooks() {
        if (typeof globalThis === "undefined")
            return;
        /** @type {ReturnType<typeof JSON.parse>} */ (globalThis).__velocious_websocket_hooks = {
            connect: () => this.connectWebsocket(),
            disconnect: () => this.disconnectWebsocket(),
            drop: () => this.dropWebsocket(),
            state: () => this.websocketState()
        };
    }
    /**
     * Runs attributes from response.
     * @this {FrontendModelClass}
     * @param {object} response - Response payload.
     * @returns {Record<string, FrontendModelAttributeValue>} - Attributes from payload.
     */
    static attributesFromResponse(response) {
        const modelData = this.modelDataFromResponse(response);
        return modelData.attributes;
    }
    /**
     * Runs model data from response.
     * @this {FrontendModelClass}
     * @param {object} response - Response payload.
     * @returns {{abilities: Record<string, boolean>, attributes: Record<string, FrontendModelAttributeValue>, associationCounts: Record<string, number>, queryData: Record<string, FrontendModelAttributeValue>, preloadedRelationships: Record<string, FrontendModelAttributeValue>, selectedAttributes: Set<string>}} - Attributes, preloaded relationships, association counts, queryData, abilities, and the selected-attributes set.
     */
    static modelDataFromResponse(response) {
        if (!response || typeof response !== "object") {
            throw new Error(`Expected object response but got: ${response}`);
        }
        // Narrows the response object to the frontend-model transport value map.
        const responseObject = /** @type {Record<string, FrontendModelAttributeValue>} */ (response);
        /**
         * Defines modelData.
         * @type {Record<string, FrontendModelAttributeValue>} */
        let modelData;
        if (responseObject.model && typeof responseObject.model === "object") {
            // Narrows the nested model payload to the frontend-model value map.
            modelData = /** @type {Record<string, FrontendModelAttributeValue>} */ (responseObject.model);
        }
        else if (responseObject.attributes && typeof responseObject.attributes === "object") {
            // Narrows the nested attributes payload to the frontend-model value map.
            modelData = /** @type {Record<string, FrontendModelAttributeValue>} */ (responseObject.attributes);
        }
        else {
            modelData = responseObject;
        }
        const attributes = /** @type {Record<string, FrontendModelAttributeValue>} */ ({ ...modelData });
        const preloadedRelationships = isPlainObject(attributes[PRELOADED_RELATIONSHIPS_KEY])
            ? /** @type {Record<string, FrontendModelAttributeValue>} */ (attributes[PRELOADED_RELATIONSHIPS_KEY])
            : {};
        const associationCounts = isPlainObject(attributes[ASSOCIATION_COUNTS_KEY])
            ? /** @type {Record<string, number>} */ (attributes[ASSOCIATION_COUNTS_KEY])
            : {};
        const queryData = isPlainObject(attributes[QUERY_DATA_KEY])
            ? /** @type {Record<string, FrontendModelAttributeValue>} */ (attributes[QUERY_DATA_KEY])
            : {};
        const abilities = isPlainObject(attributes[ABILITIES_KEY])
            ? /** @type {Record<string, boolean>} */ (attributes[ABILITIES_KEY])
            : {};
        const selectedAttributesFromPayload = Array.isArray(attributes[SELECTED_ATTRIBUTES_KEY])
            ? new Set(/** @type {string[]} */ (attributes[SELECTED_ATTRIBUTES_KEY]).filter((attributeName) => typeof attributeName === "string"))
            : null;
        delete attributes[PRELOADED_RELATIONSHIPS_KEY];
        delete attributes[SELECTED_ATTRIBUTES_KEY];
        delete attributes[ASSOCIATION_COUNTS_KEY];
        delete attributes[QUERY_DATA_KEY];
        delete attributes[ABILITIES_KEY];
        const selectedAttributes = selectedAttributesFromPayload || new Set(Object.keys(attributes));
        return { abilities, attributes, associationCounts, queryData, preloadedRelationships, selectedAttributes };
    }
    /**
     * Runs apply preloaded relationships.
     * @this {FrontendModelClass}
     * @param {FrontendModelBase} model - Model instance.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} preloadedRelationships - Preloaded relationship payload.
     * @returns {void}
     */
    static applyPreloadedRelationships(model, preloadedRelationships) {
        for (const [relationshipName, relationshipPayload] of Object.entries(preloadedRelationships)) {
            const relationship = model.getRelationshipByName(relationshipName);
            const targetModelClass = this.relationshipModelClass(relationshipName);
            if (relationship instanceof FrontendModelHasManyRelationship) {
                if (!Array.isArray(relationshipPayload)) {
                    throw new Error(`Expected ${this.name}#${relationshipName} payload to be an array`);
                }
                /** @type {Array<FrontendModelBase>} */
                const relatedModels = [];
                for (const entry of relationshipPayload) {
                    const relatedModel = this.instantiateRelationshipValue(entry, targetModelClass);
                    if (!(relatedModel instanceof FrontendModelBase)) {
                        throw new Error(`Expected ${this.name}#${relationshipName} payload entry to instantiate a frontend model`);
                    }
                    relatedModels.push(relatedModel);
                }
                relationship.setLoaded(relatedModels);
                continue;
            }
            if (Array.isArray(relationshipPayload)) {
                throw new Error(`Expected ${this.name}#${relationshipName} payload to be singular`);
            }
            const relatedModel = this.instantiateRelationshipValue(relationshipPayload, targetModelClass);
            if (relatedModel != undefined && !(relatedModel instanceof FrontendModelBase)) {
                throw new Error(`Expected ${this.name}#${relationshipName} payload to instantiate a frontend model`);
            }
            relationship.setLoaded(relatedModel);
        }
    }
    /**
     * Runs instantiate relationship value.
     * @this {FrontendModelClass}
     * @param {ReturnType<typeof JSON.parse>} relationshipPayload - Relationship payload value.
     * @param {FrontendModelClass | null} targetModelClass - Target model class.
     * @returns {ReturnType<typeof JSON.parse>} - Instantiated relationship value.
     */
    static instantiateRelationshipValue(relationshipPayload, targetModelClass) {
        if (!targetModelClass)
            return relationshipPayload;
        if (!relationshipPayload || typeof relationshipPayload !== "object")
            return relationshipPayload;
        return targetModelClass.instantiateFromResponse(relationshipPayload);
    }
    /**
     * Runs instantiate from response.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>> | InstanceType<T>} response - Response payload, or an already-hydrated instance of this class.
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
            return /** @type {InstanceType<T>} */ (response);
        }
        const modelData = this.modelDataFromResponse(response);
        const attributes = modelData.attributes;
        const preloadedRelationships = modelData.preloadedRelationships;
        const associationCounts = modelData.associationCounts;
        const queryData = modelData.queryData;
        const abilities = modelData.abilities;
        const selectedAttributes = modelData.selectedAttributes;
        const receiver = /** @type {unknown} */ (this);
        const ModelClass = /** @type {new (attributes?: Record<string, FrontendModelAttributeValue>) => InstanceType<T>} */ (receiver);
        const model = new ModelClass(attributes);
        model._selectedAttributes = selectedAttributes ? new Set(selectedAttributes) : null;
        this.applyPreloadedRelationships(model, preloadedRelationships);
        for (const [attributeName, value] of Object.entries(associationCounts || {})) {
            model._setAssociationCount(attributeName, Number(value) || 0);
        }
        for (const [name, value] of Object.entries(queryData || {})) {
            model._setQueryData(name, value);
        }
        for (const [action, value] of Object.entries(abilities || {})) {
            model._setComputedAbility(action, Boolean(value));
        }
        model.setIsNewRecord(false);
        model._persistedAttributes = cloneFrontendModelAttributes(model.attributes());
        return model;
    }
    /**
     * Runs find.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {number | string} id - Record identifier.
     * @returns {Promise<InstanceType<T>>} - Resolved model.
     */
    static async find(id) {
        return await this.query().find(id);
    }
    /**
     * Runs find by.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Attribute match conditions.
     * @returns {Promise<InstanceType<T> | null>} - Found model or null.
     */
    static async findBy(conditions) {
        return await this.query().findBy(conditions);
    }
    /**
     * Runs find by or fail.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Attribute match conditions.
     * @returns {Promise<InstanceType<T>>} - Found model.
     */
    static async findByOrFail(conditions) {
        return await this.query().findByOrFail(conditions);
    }
    /**
     * Runs to array.
     * @template {FrontendModelClass} T
     * @this {T}
     * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
     */
    static async toArray() {
        return await this.query().toArray();
    }
    /**
     * Runs load.
     * @template {FrontendModelClass} T
     * @this {T}
     * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
     */
    static async load() {
        return await this.query().load();
    }
    /**
     * Runs all.
     * @template {FrontendModelClass} T
     * @this {T}
     * @returns {FrontendModelQuery<T>} - Query builder.
     */
    static all() {
        return this.query();
    }
    /**
     * Runs where.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Root-model where conditions.
     * @returns {import("./query.js").default<T>} - Query with where conditions.
     */
    static where(conditions) {
        return this.query().where(conditions);
    }
    /**
     * Runs joins.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} joins - Relationship descriptor joins.
     * @returns {import("./query.js").default<T>} - Query with joins.
     */
    static joins(joins) {
        return this.query().joins(joins);
    }
    /**
     * Runs limit.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {number} value - Maximum number of records.
     * @returns {import("./query.js").default<T>} - Query with limit.
     */
    static limit(value) {
        return this.query().limit(value);
    }
    /**
     * Runs offset.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {number} value - Number of records to skip.
     * @returns {import("./query.js").default<T>} - Query with offset.
     */
    static offset(value) {
        return this.query().offset(value);
    }
    /**
     * Runs page.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {number} pageNumber - 1-based page number.
     * @returns {import("./query.js").default<T>} - Query with page applied.
     */
    static page(pageNumber) {
        return this.query().page(pageNumber);
    }
    /**
     * Runs per page.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {number} value - Number of records per page.
     * @returns {import("./query.js").default<T>} - Query with page size.
     */
    static perPage(value) {
        return this.query().perPage(value);
    }
    /**
     * Runs count.
     * @template {FrontendModelClass} T
     * @this {T}
     * @returns {Promise<number>} - Number of loaded model instances.
     */
    static async count() {
        return await this.query().count();
    }
    /**
     * Class-level hook fired when any record of this model is created.
     * Subscribe-time authorization only — once a subscription is
     * accepted, future `create` events for this model are delivered
     * without re-checking per-record visibility. Query options can still
     * narrow which events reach this callback.
     * @this {FrontendModelClass}
     * @param {(payload: {id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue, model: FrontendModelBase}) => void} callback - Event callback.
     * @param {import("./query.js").FrontendModelEventOptions} [options] - Event query or record projection options.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    static async onCreate(callback, options = {}) {
        const { requestContext, ...eventOptionsPayload } = frontendModelEventOptionsPayload(this, options);
        const sub = ensureFrontendModelEventSubscription(this, frontendModelEventRequestContext(requestContext));
        const entry = { callback, ...eventOptionsPayload };
        return await sub.registerClassCallback(sub.classCreateCallbacks, entry);
    }
    /**
     * Class-level hook fired when any record of this model is updated.
     * @this {FrontendModelClass}
     * @param {(payload: {id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue, model: FrontendModelBase}) => void} callback - Event callback.
     * @param {import("./query.js").FrontendModelEventOptions} [options] - Event query or record projection options.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    static async onUpdate(callback, options = {}) {
        const { requestContext, ...eventOptionsPayload } = frontendModelEventOptionsPayload(this, options);
        const sub = ensureFrontendModelEventSubscription(this, frontendModelEventRequestContext(requestContext));
        const entry = { callback, ...eventOptionsPayload };
        return await sub.registerClassCallback(sub.classUpdateCallbacks, entry);
    }
    /**
     * Class-level hook fired when any record of this model is destroyed.
     * @this {FrontendModelClass}
     * @param {(payload: {id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue}) => void} callback - Event callback.
     * @param {import("./query.js").FrontendModelEventOptions} [options] - Accepted for API symmetry; destroy events carry ids only.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    static async onDestroy(callback, options = {}) {
        assertNoDestroyEventFilter(this, options);
        const { requestContext } = frontendModelEventOptionsPayload(this, options);
        const sub = ensureFrontendModelEventSubscription(this, frontendModelEventRequestContext(requestContext));
        const entry = { callback };
        return await sub.registerClassCallback(sub.classDestroyCallbacks, entry);
    }
    /**
     * Instance-level hook fired when THIS record is updated. The
     * instance's attributes are auto-merged with the broadcast payload
     * before the callback runs, so callers can read fresh values via
     * `this.someAttr()` without re-fetching.
     * @param {(payload: {id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue, model: FrontendModelBase}) => void} callback - Event callback.
     * @param {import("./query.js").FrontendModelEventOptions} [options] - Event query or record projection options.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    async onUpdate(callback, options = {}) {
        const ModelClass = frontendModelClassFor(this);
        const { requestContext, ...eventOptionsPayload } = frontendModelEventOptionsPayload(ModelClass, options);
        const sub = ensureFrontendModelEventSubscription(ModelClass, frontendModelEventRequestContext(requestContext));
        const id = modelPrimaryKeyCacheKey(ModelClass.primaryKey(), this.primaryKeyValue());
        const entry = { callback, ...eventOptionsPayload };
        const listener = ensureFrontendModelInstanceListener(sub, id, this);
        listener.updateCallbacks.add(entry);
        try {
            await sub.ensureSubscribed();
        }
        catch (error) {
            removeFrontendModelInstanceListenerEntry(sub, (current) => current.updateCallbacks.delete(entry));
            throw error;
        }
        return () => {
            removeFrontendModelInstanceListenerEntry(sub, (current) => current.updateCallbacks.delete(entry));
        };
    }
    /**
     * Instance-level hook fired when THIS record is destroyed.
     * @param {(payload: {id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue}) => void} callback - Event callback.
     * @param {import("./query.js").FrontendModelEventOptions} [options] - Accepted for API symmetry; destroy events carry ids only.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    async onDestroy(callback, options = {}) {
        const ModelClass = frontendModelClassFor(this);
        assertNoDestroyEventFilter(ModelClass, options);
        const { requestContext } = frontendModelEventOptionsPayload(ModelClass, options);
        const sub = ensureFrontendModelEventSubscription(ModelClass, frontendModelEventRequestContext(requestContext));
        const id = modelPrimaryKeyCacheKey(ModelClass.primaryKey(), this.primaryKeyValue());
        const entry = { callback };
        const listener = ensureFrontendModelInstanceListener(sub, id, this);
        listener.destroyCallbacks.add(entry);
        try {
            await sub.ensureSubscribed();
        }
        catch (error) {
            removeFrontendModelInstanceListenerEntry(sub, (current) => current.destroyCallbacks.delete(entry));
            throw error;
        }
        return () => {
            removeFrontendModelInstanceListenerEntry(sub, (current) => current.destroyCallbacks.delete(entry));
        };
    }
    /**
     * Runs pluck.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {...(string | string[] | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>)} columns - Pluck definition(s).
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Plucked values.
     */
    static async pluck(...columns) {
        return await this.query().pluck(...columns);
    }
    /**
     * Runs search.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {string[]} path - Relationship path.
     * @param {string} column - Column or attribute name.
     * @param {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | ">" | ">=" | "<" | "<="} operator - Search operator.
     * @param {ReturnType<typeof JSON.parse>} value - Search value.
     * @returns {FrontendModelQuery<T>} - Query builder with search filter.
     */
    static search(path, column, operator, value) {
        return this.query().search(path, column, operator, value);
    }
    /**
     * Runs ransack.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Ransack-style params hash.
     * @returns {FrontendModelQuery<T>} - Query builder with Ransack filters applied.
     */
    static ransack(params) {
        return this.query().ransack(params);
    }
    /**
     * Runs sort.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} sort - Sort definition(s).
     * @returns {FrontendModelQuery<T>} - Query builder with sort definitions.
     */
    static sort(sort) {
        return this.query().sort(sort);
    }
    /**
     * Runs order.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} sort - Sort definition(s).
     * @returns {FrontendModelQuery<T>} - Query builder with sort definitions.
     */
    static order(sort) {
        return this.query().order(sort);
    }
    /**
     * Runs group.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {string | string[] | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} group - Group definition(s).
     * @returns {FrontendModelQuery<T>} - Query builder with group definitions.
     */
    static group(group) {
        return this.query().group(group);
    }
    /**
     * Runs distinct.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {boolean} [value] - Whether to request distinct rows.
     * @returns {FrontendModelQuery<T>} - Query builder with distinct flag.
     */
    static distinct(value = true) {
        return this.query().distinct(value);
    }
    /**
     * Runs query.
     * @template {FrontendModelClass} T
     * @this {T}
     * @returns {FrontendModelQuery<T>} - Query builder.
     */
    static query() {
        return /** @type {FrontendModelQuery<T>} */ (new FrontendModelQuery({ modelClass: this }));
    }
    /**
     * Runs preload.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>} preload - Preload graph.
     * @returns {FrontendModelQuery<T>} - Query with preload.
     */
    static preload(preload) {
        return /** @type {FrontendModelQuery<T>} */ (this.query().preload(preload));
    }
    /**
     * Runs select.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, string[] | string> | string | string[]} select - Model-aware attribute select map or root-model shorthand.
     * @returns {FrontendModelQuery<T>} - Query with selected attributes.
     */
    static select(select) {
        return /** @type {FrontendModelQuery<T>} */ (this.query().select(select));
    }
    /**
     * Runs selects extra.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, string[] | string> | string | string[]} select - Extra attributes to load in addition to the defaults, keyed by model name or root-model shorthand.
     * @returns {FrontendModelQuery<T>} - Query with extra selected attributes.
     */
    static selectsExtra(select) {
        return /** @type {FrontendModelQuery<T>} */ (this.query().selectsExtra(select));
    }
    /**
     * Runs first.
     * @template {FrontendModelClass} T
     * @this {T}
     * @returns {Promise<InstanceType<T> | null>} - First model or null.
     */
    static async first() {
        return await this.query().first();
    }
    /**
     * Runs last.
     * @template {FrontendModelClass} T
     * @this {T}
     * @returns {Promise<InstanceType<T> | null>} - Last model or null.
     */
    static async last() {
        return await this.query().last();
    }
    /**
     * Runs find or initialize by.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Attribute match conditions.
     * @returns {Promise<InstanceType<T>>} - Existing or initialized model.
     */
    static async findOrInitializeBy(conditions) {
        return await this.query().findOrInitializeBy(conditions);
    }
    /**
     * Runs find or create by.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Attribute match conditions.
     * @param {(model: InstanceType<T>) => Promise<void> | void} [callback] - Optional callback before save when created.
     * @returns {Promise<InstanceType<T>>} - Existing or newly created model.
     */
    static async findOrCreateBy(conditions, callback) {
        return await this.query().findOrCreateBy(conditions, callback);
    }
    /**
     * Runs create.
     * @template {FrontendModelClass} ModelClass
     * @this {ModelClass}
     * @param {FrontendModelCreateAttributesFor<InstanceType<ModelClass>>} [attributes] - Initial attributes.
     * @returns {Promise<InstanceType<ModelClass>>} - Persisted model.
     */
    static async create(attributes) {
        const receiver = /** @type {unknown} */ (this);
        const ModelClass = /** @type {new (attributes?: FrontendModelCreateAttributesFor<InstanceType<ModelClass>>) => InstanceType<ModelClass>} */ (receiver);
        const model = new ModelClass(attributes);
        await model.save();
        return model;
    }
    /**
     * Runs assert find by conditions.
     * @this {FrontendModelClass}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - findBy conditions.
     * @returns {void}
     */
    static assertFindByConditions(conditions) {
        assertFindByConditionsShape(conditions);
        Object.keys(conditions).forEach((key) => {
            assertDefinedFindByConditionValue(conditions[key], key);
        });
    }
    /**
     * Runs matches find by conditions.
     * @this {FrontendModelClass}
     * @param {FrontendModelBase} model - Candidate model.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Match conditions.
     * @returns {boolean} - Whether the model matches all conditions.
     */
    static matchesFindByConditions(model, conditions) {
        const modelAttributes = model.attributes();
        for (const key of Object.keys(conditions)) {
            const expectedValue = conditions[key];
            const actualValue = modelAttributes[key];
            if (Array.isArray(expectedValue)) {
                if (Array.isArray(actualValue)) {
                    if (!this.findByConditionValueMatches(actualValue, expectedValue)) {
                        return false;
                    }
                }
                else if (!expectedValue.some((entry) => this.findByConditionValueMatches(actualValue, entry))) {
                    return false;
                }
            }
            else if (!this.findByConditionValueMatches(actualValue, expectedValue)) {
                return false;
            }
        }
        return true;
    }
    /**
     * Runs find by condition value matches.
     * @this {FrontendModelClass}
     * @param {ReturnType<typeof JSON.parse>} actualValue - Actual model value.
     * @param {ReturnType<typeof JSON.parse>} expectedValue - Expected find condition value.
     * @returns {boolean} - Whether values match.
     */
    static findByConditionValueMatches(actualValue, expectedValue) {
        if (expectedValue === null) {
            return actualValue === null;
        }
        if (Array.isArray(expectedValue)) {
            if (!Array.isArray(actualValue)) {
                return false;
            }
            if (actualValue.length !== expectedValue.length) {
                return false;
            }
            for (let index = 0; index < expectedValue.length; index += 1) {
                if (!this.findByConditionValueMatches(actualValue[index], expectedValue[index])) {
                    return false;
                }
            }
            return true;
        }
        if (expectedValue && typeof expectedValue === "object") {
            if (!actualValue || typeof actualValue !== "object" || Array.isArray(actualValue)) {
                return false;
            }
            const actualObject = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (actualValue);
            const expectedObject = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (expectedValue);
            const actualKeys = Object.keys(actualObject);
            const expectedKeys = Object.keys(expectedObject);
            if (actualKeys.length !== expectedKeys.length) {
                return false;
            }
            for (const key of expectedKeys) {
                if (!Object.prototype.hasOwnProperty.call(actualObject, key)) {
                    return false;
                }
                if (!this.findByConditionValueMatches(actualObject[key], expectedObject[key])) {
                    return false;
                }
            }
            return true;
        }
        if (actualValue === expectedValue) {
            return true;
        }
        return this.findByPrimitiveValuesMatch(actualValue, expectedValue);
    }
    /**
     * Runs find by primitive values match.
     * @this {FrontendModelClass}
     * @param {ReturnType<typeof JSON.parse>} actualValue - Actual model value.
     * @param {ReturnType<typeof JSON.parse>} expectedValue - Expected find condition value.
     * @returns {boolean} - Whether primitive values match after safe coercion.
     */
    static findByPrimitiveValuesMatch(actualValue, expectedValue) {
        if (actualValue instanceof Date && typeof expectedValue === "string") {
            const normalizedExpectedValue = normalizeDateStringForWrite(expectedValue, { timeZone: frontendModelTransportTimeZone() });
            if (normalizedExpectedValue instanceof Date) {
                return actualValue.toISOString() === normalizedExpectedValue.toISOString();
            }
            return actualValue.toISOString() === expectedValue;
        }
        if (typeof actualValue === "string" && expectedValue instanceof Date) {
            return actualValue === expectedValue.toISOString();
        }
        if (actualValue instanceof Date && expectedValue instanceof Date) {
            return actualValue.toISOString() === expectedValue.toISOString();
        }
        if (typeof actualValue === "number" && typeof expectedValue === "string") {
            return this.findByNumericStringMatchesNumber(expectedValue, actualValue);
        }
        if (typeof actualValue === "string" && typeof expectedValue === "number") {
            return this.findByNumericStringMatchesNumber(actualValue, expectedValue);
        }
        return false;
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
            return false;
        }
        if (!/^-?\d+(?:\.\d+)?$/.test(numericString)) {
            return false;
        }
        return Number(numericString) === expectedNumber;
    }
    /**
     * Runs update.
     * @param {UpdateAttributes} [newAttributes] - New values to assign before update.
     * @returns {Promise<this>} - Updated model.
     */
    async update(newAttributes) {
        if (newAttributes)
            this.assignAttributes(newAttributes);
        return /** @type {this} */ (await this.save());
    }
    /**
     * Runs attach.
     * @param {ReturnType<typeof JSON.parse>} attachmentInput - Attachment input or named attachment payload.
     * @returns {Promise<void>} - Resolves when attached.
     */
    async attach(attachmentInput) {
        const ModelClass = frontendModelClassFor(this);
        const attachmentDefinitions = ModelClass.attachmentDefinitions();
        const attachmentNames = Object.keys(attachmentDefinitions);
        let attachmentName = attachmentNames[0];
        let actualAttachmentInput = attachmentInput;
        if (frontendAttachmentValueIsPlainObject(attachmentInput)) {
            if ("file" in attachmentInput && attachmentDefinitions.file) {
                attachmentName = "file";
            }
            for (const candidateName of attachmentNames) {
                if (candidateName in attachmentInput) {
                    attachmentName = candidateName;
                    actualAttachmentInput = attachmentInput[candidateName];
                    break;
                }
            }
        }
        if (!attachmentName) {
            throw new Error(`No attachment definitions on ${ModelClass.name}`);
        }
        await this.getAttachmentByName(attachmentName).attach(actualAttachmentInput);
    }
    /**
     * Runs save.
     * @returns {Promise<this>} - Saved model.
     */
    async save() {
        const ModelClass = frontendModelClassFor(this);
        const isNew = this.isNewRecord();
        const previousIdentity = isNew ? null : this.persistedPrimaryKeyValue();
        const commandType = isNew ? "create" : "update";
        /**
         * Payload.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const payload = {
            attributes: this._changedAttributesForSave()
        };
        if (!isNew) {
            payload.id = this.persistedPrimaryKeyValue();
        }
        const nestedAttributes = await this._buildNestedAttributesPayload();
        if (nestedAttributes && Object.keys(nestedAttributes).length > 0) {
            payload.nestedAttributes = nestedAttributes;
        }
        const attachments = await this._buildAttachmentsPayload();
        if (Object.keys(attachments).length > 0) {
            payload.attachments = attachments;
        }
        if (shouldQueueFrontendModelOperationOffline(ModelClass, commandType)) {
            const offlineAttributes = { ...payload.attributes };
            let clientMutationId;
            if (isNew) {
                const primaryKey = scalarModelPrimaryKey(ModelClass.primaryKey(), `Offline create for ${ModelClass.name}`);
                const currentPrimaryKey = this.readAttribute(primaryKey);
                if (currentPrimaryKey === undefined || currentPrimaryKey === null) {
                    clientMutationId = frontendModelTransportConfig.offlineSync?.clientMutationId
                        ? frontendModelTransportConfig.offlineSync.clientMutationId()
                        : frontendModelOfflineMutationId();
                    this.setAttribute(primaryKey, clientMutationId);
                    offlineAttributes[primaryKey] = clientMutationId;
                }
            }
            else {
                const primaryKey = scalarModelPrimaryKey(ModelClass.primaryKey(), `Offline update for ${ModelClass.name}`);
                offlineAttributes[primaryKey] = payload.id;
            }
            if (payload.nestedAttributes !== undefined || payload.attachments !== undefined) {
                throw new Error(`Offline sync for ${ModelClass.name} does not support nested attributes or attachments yet`);
            }
            await queueFrontendModelMutationOffline({
                attributes: offlineAttributes,
                clientMutationId,
                ModelClass,
                operation: commandType
            });
            this.setIsNewRecord(false);
            this._persistedAttributes = cloneFrontendModelAttributes(this.attributes());
            this._pendingNestedAttributes = {};
            this._clearPendingAttachments();
            return this;
        }
        const response = await ModelClass.executeCommand(commandType, payload);
        this.assignAttributes(ModelClass.attributesFromResponse(response));
        this.setIsNewRecord(false);
        if (previousIdentity !== null) {
            rekeyFrontendModelInstanceListeners(ModelClass, this, previousIdentity, this.primaryKeyValue());
        }
        this._persistedAttributes = cloneFrontendModelAttributes(this.attributes());
        this._pendingNestedAttributes = {};
        this._clearPendingAttachments();
        this._reconcileNestedAttributesFromResponse(response);
        return this;
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
        const changedAttributes = {};
        for (const [attributeName, [previousValue, currentValue]] of Object.entries(this.changes())) {
            if (this.isNewRecord() && previousValue === undefined && currentValue === null)
                continue;
            changedAttributes[attributeName] = currentValue;
        }
        return changedAttributes;
    }
    /**
     * Marks the current value for an attribute as already persisted so the next
     * save does not send it unless the caller changes it again.
     * @param {string} attributeName - Attribute to mark unchanged.
     * @returns {void}
     */
    markAttributeUnchanged(attributeName) {
        this._persistedAttributes[attributeName] = cloneFrontendModelAttributes({ value: this._attributes[attributeName] }).value;
    }
    /**
     * Runs destroy.
     * @returns {Promise<void>} - Resolves when destroyed on backend.
     */
    async destroy() {
        const ModelClass = frontendModelClassFor(this);
        const id = this.persistedPrimaryKeyValue();
        if (shouldQueueFrontendModelOperationOffline(ModelClass, "destroy")) {
            const primaryKey = scalarModelPrimaryKey(ModelClass.primaryKey(), `Offline destroy for ${ModelClass.name}`);
            await queueFrontendModelMutationOffline({
                attributes: { [primaryKey]: id },
                ModelClass,
                operation: "destroy"
            });
            return;
        }
        await ModelClass.executeCommand("destroy", {
            id
        });
    }
    /**
     * Builds the attachment payload queued on this model for the next save.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Attachment payload keyed by attachment name.
     */
    async _buildAttachmentsPayload() {
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const payload = {};
        for (const attachmentName of Object.keys(this._attachments)) {
            const attachmentPayload = await this._attachments[attachmentName].pendingAttachmentsPayload();
            if (attachmentPayload !== undefined) {
                payload[attachmentName] = attachmentPayload;
            }
        }
        return payload;
    }
    /** Clears queued attachment inputs after a successful save. */
    _clearPendingAttachments() {
        for (const attachmentName of Object.keys(this._attachments)) {
            this._attachments[attachmentName].clearPendingAttachments();
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
     * @returns {Promise<Record<string, Array<Record<string, ReturnType<typeof JSON.parse>>>>>} - Per-relationship list of nested-attribute entries.
     */
    async _buildNestedAttributesPayload() {
        const ModelClass = frontendModelClassFor(this);
        const resourceConfig = ModelClass.resourceConfig();
        const nestedAttributesConfig = resourceConfig?.nestedAttributes;
        if (!nestedAttributesConfig)
            return {};
        /**
         * Payload.
         * @type {Record<string, Array<Record<string, ReturnType<typeof JSON.parse>>>>} */
        const payload = {};
        for (const relationshipName of Object.keys(nestedAttributesConfig)) {
            /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
            const entries = [];
            const relationship = this._relationships[relationshipName];
            if (relationship instanceof FrontendModelHasManyRelationship && Array.isArray(relationship._loadedValue)) {
                for (const child of relationship._loadedValue) {
                    const childEntry = await child._nestedAttributesEntryForParentSave();
                    if (childEntry)
                        entries.push(childEntry);
                }
            }
            else if (relationship instanceof FrontendModelSingularRelationship && relationship.getPreloaded()) {
                const child = relationship.loaded();
                if (child instanceof FrontendModelBase) {
                    const childEntry = await child._nestedAttributesEntryForParentSave();
                    if (childEntry)
                        entries.push(childEntry);
                }
            }
            if (Object.prototype.hasOwnProperty.call(this._pendingNestedAttributes, relationshipName)) {
                entries.push(...await this._nestedAttributesPayloadForSubmittedValue(ModelClass, relationshipName, this._pendingNestedAttributes[relationshipName]));
            }
            if (entries.length > 0) {
                payload[relationshipName] = entries;
            }
        }
        return payload;
    }
    /**
     * Builds the payload entry for this child when walked by a parent's
     * `_buildNestedAttributesPayload`. Returns `null` when the child has no
     * dirty state and no dirty descendants, so the parent can omit it.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Nested-attribute entry or null if clean.
     */
    async _nestedAttributesEntryForParentSave() {
        if (this.markedForDestruction()) {
            if (this.isNewRecord())
                return null;
            return { id: this.primaryKeyValue(), _destroy: true };
        }
        const nestedAttributes = await this._buildNestedAttributesPayload();
        const hasNestedDirty = Object.keys(nestedAttributes).length > 0;
        const attachments = await this._buildAttachmentsPayload();
        const hasAttachments = Object.keys(attachments).length > 0;
        if (this.isNewRecord()) {
            /**
             * Entry.
             * @type {Record<string, ReturnType<typeof JSON.parse>>} */
            const entry = {};
            const attributes = this._changedAttributesForSave();
            if (Object.keys(attributes).length > 0)
                entry.attributes = attributes;
            if (hasAttachments)
                entry.attachments = attachments;
            if (hasNestedDirty)
                entry.nestedAttributes = nestedAttributes;
            return entry;
        }
        if (!this.isChanged() && !hasNestedDirty && !hasAttachments)
            return null;
        /**
         * Entry.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const entry = { id: this.primaryKeyValue() };
        if (this.isChanged())
            entry.attributes = this._changedAttributesForSave();
        if (hasAttachments)
            entry.attachments = attachments;
        if (hasNestedDirty)
            entry.nestedAttributes = nestedAttributes;
        return entry;
    }
    /**
     * Builds nested entries from a Rails-style submitted `*Attributes` value.
     * @param {FrontendModelClass} ModelClass - Parent model class.
     * @param {string} relationshipName - Nested relationship name.
     * @param {ReturnType<typeof JSON.parse>} value - Submitted nested attributes value.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} Nested entries for the transport payload.
     */
    async _nestedAttributesPayloadForSubmittedValue(ModelClass, relationshipName, value) {
        const relationshipDefinition = ModelClass.relationshipDefinition(relationshipName);
        const TargetModelClass = ModelClass.relationshipModelClass(relationshipName);
        if (!relationshipDefinition) {
            throw new Error(`Unknown nested relationship: ${ModelClass.name}#${relationshipName}`);
        }
        if (!TargetModelClass) {
            throw new Error(`No target model class configured for ${ModelClass.name}#${relationshipName}`);
        }
        if (relationshipTypeIsCollection(relationshipDefinition.type)) {
            if (!Array.isArray(value)) {
                throw new Error(`${ModelClass.name}#${relationshipName}Attributes must be an array`);
            }
            return await Promise.all(value.map(async (entry) => await this._nestedAttributesEntryPayloadForSubmittedValue(TargetModelClass, entry)));
        }
        if (value == null)
            return [];
        if (Array.isArray(value)) {
            throw new Error(`${ModelClass.name}#${relationshipName}Attributes must be an object`);
        }
        return [await this._nestedAttributesEntryPayloadForSubmittedValue(TargetModelClass, value)];
    }
    /**
     * Converts one submitted Rails-style nested attributes object into transport payload shape.
     * @param {FrontendModelClass} ModelClass - Nested child model class.
     * @param {ReturnType<typeof JSON.parse>} submittedEntry - Submitted nested attributes entry.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Transport nested-attributes entry.
     */
    async _nestedAttributesEntryPayloadForSubmittedValue(ModelClass, submittedEntry) {
        if (!frontendAttachmentValueIsPlainObject(submittedEntry)) {
            throw new Error(`${ModelClass.name} nested attributes entries must be objects`);
        }
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const entry = {};
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const attributes = {};
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const attachments = {};
        /** @type {Record<string, Array<Record<string, ReturnType<typeof JSON.parse>>>>} */
        const nestedAttributes = {};
        for (const [attributeName, value] of Object.entries(submittedEntry)) {
            if (attributeName === "id" || attributeName === "_destroy") {
                entry[attributeName] = value;
                continue;
            }
            const nestedRelationshipName = ModelClass.nestedAttributesRelationshipName(attributeName);
            if (nestedRelationshipName) {
                nestedAttributes[nestedRelationshipName] = await this._nestedAttributesPayloadForSubmittedValue(ModelClass, nestedRelationshipName, value);
                continue;
            }
            if (ModelClass.attachmentDefinition(attributeName)) {
                attachments[attributeName] = await this._attachmentPayloadForSubmittedValue(ModelClass, attributeName, value);
                continue;
            }
            attributes[attributeName] = value;
        }
        if (Object.keys(attributes).length > 0)
            entry.attributes = attributes;
        if (Object.keys(attachments).length > 0)
            entry.attachments = attachments;
        if (Object.keys(nestedAttributes).length > 0)
            entry.nestedAttributes = nestedAttributes;
        return entry;
    }
    /**
     * Normalizes a submitted attachment value for transport.
     * @param {FrontendModelClass} ModelClass - Model class owning the attachment.
     * @param {string} attachmentName - Attachment name.
     * @param {ReturnType<typeof JSON.parse>} value - Submitted attachment value.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | Record<string, ReturnType<typeof JSON.parse>>[]>} Normalized attachment payload.
     */
    async _attachmentPayloadForSubmittedValue(ModelClass, attachmentName, value) {
        const attachmentDefinition = ModelClass.attachmentDefinition(attachmentName);
        if (attachmentDefinition?.type === "hasMany") {
            const values = Array.isArray(value) ? value : [value];
            return await Promise.all(values.map(async (entry) => await normalizeFrontendAttachmentInput(entry)));
        }
        if (Array.isArray(value)) {
            const lastValue = value[value.length - 1];
            if (lastValue === undefined) {
                throw new Error(`${ModelClass.name}#${attachmentName} attachment array cannot be empty`);
            }
            return await normalizeFrontendAttachmentInput(lastValue);
        }
        return await normalizeFrontendAttachmentInput(value);
    }
    /**
     * After a parent save with `nestedAttributes`, the server response includes
     * preloaded versions of the affected relationships. This replaces the local
     * `_loadedValue` for each nested-writable relationship with the server's
     * authoritative set, so destroyed children are dropped and newly-created
     * children get their server-assigned ids + persisted state.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} response - Command response payload.
     * @returns {void}
     */
    _reconcileNestedAttributesFromResponse(response) {
        const ModelClass = frontendModelClassFor(this);
        const resourceConfig = ModelClass.resourceConfig();
        const nestedAttributesConfig = resourceConfig?.nestedAttributes;
        if (!nestedAttributesConfig)
            return;
        const modelData = ModelClass.modelDataFromResponse(response);
        const preloadedRelationships = modelData.preloadedRelationships;
        /**
         * Relevant preloads.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const relevantPreloads = {};
        for (const relationshipName of Object.keys(nestedAttributesConfig)) {
            if (relationshipName in preloadedRelationships) {
                relevantPreloads[relationshipName] = preloadedRelationships[relationshipName];
            }
        }
        if (Object.keys(relevantPreloads).length > 0) {
            ModelClass.applyPreloadedRelationships(this, relevantPreloads);
        }
    }
    /**
     * Runs execute command.
     * @this {FrontendModelClass}
     * @param {FrontendModelCommandType} commandType - Command type.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} payload - Command payload.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Parsed JSON response.
     */
    static async executeCommand(commandType, payload) {
        const commandName = this.commandName(commandType);
        const timeZone = frontendModelTransportTimeZone();
        const serializedPayload = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (serializeFrontendModelTransportValue(payload, { timeZone }));
        const requestContext = frontendModelRequestContext();
        const requestPayload = mergeFrontendModelRemoteRequestContext(requestContext, serializedPayload);
        const resourcePath = this.resourcePath();
        const containsAttachmentUpload = frontendModelPayloadContainsAttachmentUpload(serializedPayload);
        const useSharedTransport = !containsAttachmentUpload;
        const url = useSharedTransport ? frontendModelApiUrl() : frontendModelCommandUrl(resourcePath || "", commandName);
        if (useSharedTransport) {
            const batchResponse = await new Promise((resolve, reject) => {
                pendingSharedFrontendModelRequests.push({
                    commandName,
                    commandType,
                    modelClass: this,
                    payload: serializedPayload,
                    requestContext,
                    reject,
                    requestId: `${++sharedFrontendModelRequestId}`,
                    resolve,
                    resourcePath
                });
                scheduleSharedFrontendModelRequestFlush();
            });
            const decodedBatchResponse = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (batchResponse);
            this.throwOnErrorFrontendModelResponse({
                commandType,
                response: decodedBatchResponse
            });
            return decodedBatchResponse;
        }
        return await trackFrontendModelTransportRequest(async () => runWithTransportDeadline({
            errorMessage: `${this.name}#${commandType} request timed out`,
            signal: frontendModelTransportSignal(),
            timeoutMs: frontendModelTransportTimeoutMs()
        }, async (signal) => {
            const directResponse = await fetch(url, {
                body: JSON.stringify(requestPayload),
                credentials: "include",
                headers: frontendModelRequestHeaders(timeZone),
                method: "POST",
                signal
            });
            const directResponseText = await directResponse.text();
            if (!directResponse.ok) {
                throwFrontendModelHttpError({
                    commandLabel: `${this.name}#${commandType}`,
                    response: directResponse,
                    responseText: directResponseText
                });
            }
            const directJson = directResponseText.length > 0 ? JSON.parse(directResponseText) : {};
            const decodedDirectResponse = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(directJson));
            this.throwOnErrorFrontendModelResponse({
                commandType,
                response: decodedDirectResponse
            });
            return decodedDirectResponse;
        }));
    }
    /**
     * Runs execute custom command.
     * @this {FrontendModelClass}
     * @param {{commandName: string, commandType: FrontendModelRequestCommandType, memberId?: string | number | null, payload: Record<string, ReturnType<typeof JSON.parse>>, resourcePath: string}} args - Command arguments.
     * @returns {Promise<Record<string, FrontendModelAttributeValue>>} - Decoded response payload.
     */
    static async executeCustomCommand(args) {
        const { commandName, commandType, memberId = null, payload, resourcePath } = args;
        const timeZone = frontendModelTransportTimeZone();
        const serializedPayload = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (serializeFrontendModelTransportValue(payload, { timeZone }));
        const requestContext = frontendModelRequestContext();
        mergeFrontendModelRemoteRequestContext(requestContext, serializedPayload);
        const customPath = frontendModelCustomCommandPath({
            commandName,
            memberId,
            modelName: this.getModelName(),
            resourcePath
        });
        const batchResponse = await new Promise((resolve, reject) => {
            pendingSharedFrontendModelRequests.push({
                commandType,
                customPath,
                modelClass: this,
                payload: serializedPayload,
                requestContext,
                reject,
                requestId: `${++sharedFrontendModelRequestId}`,
                resolve
            });
            scheduleSharedFrontendModelRequestFlush();
        });
        const decodedBatchResponse = /** @type {Record<string, FrontendModelAttributeValue>} */ (batchResponse);
        this.throwOnErrorFrontendModelResponse({
            commandType,
            response: decodedBatchResponse
        });
        return decodedBatchResponse;
    }
    /**
     * Runs throw on error frontend model response.
     * @this {FrontendModelClass}
     * @param {{commandType: FrontendModelRequestCommandType, response: Record<string, ReturnType<typeof JSON.parse>>}} args - Arguments.
     * @returns {void}
     */
    static throwOnErrorFrontendModelResponse(args) {
        const { commandType, response } = args;
        if (response?.status !== "error")
            return;
        const responseKeys = Object.keys(response);
        const hasOnlyStatus = responseKeys.length === 1 && responseKeys[0] === "status";
        const hasErrorMessage = typeof response.errorMessage === "string" && response.errorMessage.length > 0;
        const hasErrorEnvelopeKeys = Boolean(response.code !== undefined
            || response.error !== undefined
            || response.errors !== undefined
            || response.message !== undefined);
        const nonStatusKeys = responseKeys.filter((key) => key !== "status");
        const configuredAttributeNames = this.configuredFrontendModelAttributeNames();
        const looksLikeRawModelPayload = nonStatusKeys.length > 0
            && nonStatusKeys.every((key) => configuredAttributeNames.has(key));
        if (!hasErrorMessage && !hasOnlyStatus && !hasErrorEnvelopeKeys && looksLikeRawModelPayload)
            return;
        const debugErrorMessage = typeof response.debugErrorMessage === "string" && response.debugErrorMessage.length > 0
            ? response.debugErrorMessage
            : null;
        const errorMessage = debugErrorMessage || (hasErrorMessage
            ? response.errorMessage
            : `Request failed for ${this.name}#${commandType}`);
        const error = /** @type {Error & {correlationId?: string, details?: Record<string, ReturnType<typeof JSON.parse>>, errorMessage?: string, velocious?: Record<string, ReturnType<typeof JSON.parse>>, errorType?: string, validationErrors?: Record<string, ReturnType<typeof JSON.parse>>, debugErrorClass?: string, debugBacktrace?: string[]}} */ (new Error(errorMessage));
        if (hasErrorMessage) {
            error.errorMessage = response.errorMessage;
        }
        if (response.velocious && typeof response.velocious === "object") {
            error.velocious = response.velocious;
        }
        if (typeof response.errorType === "string") {
            error.errorType = response.errorType;
        }
        if (response.validationErrors && typeof response.validationErrors === "object") {
            error.validationErrors = response.validationErrors;
        }
        if (response.details && typeof response.details === "object") {
            error.details = response.details;
        }
        if (typeof response.correlationId === "string") {
            error.correlationId = response.correlationId;
        }
        // Forward server-provided debug detail (included only when the backend
        // deems the requester allowed to see it, e.g. an admin) so callers can
        // render the real error class and stack trace instead of the generic
        // client-safe message.
        if (typeof response.debugErrorClass === "string") {
            error.debugErrorClass = response.debugErrorClass;
        }
        if (Array.isArray(response.debugBacktrace)) {
            error.debugBacktrace = response.debugBacktrace;
        }
        throw error;
    }
    /**
     * Runs configured frontend model attribute names.
     * @this {FrontendModelClass}
     * @returns {Set<string>} - Configured frontend model attribute names.
     */
    static configuredFrontendModelAttributeNames() {
        const resourceConfig = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (this.resourceConfig());
        const attributes = resourceConfig.attributes;
        if (Array.isArray(attributes)) {
            return new Set(attributes.filter((attributeName) => typeof attributeName === "string"));
        }
        if (attributes && typeof attributes === "object") {
            return new Set(Object.keys(attributes));
        }
        return new Set();
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
                byteSize: { type: "integer" },
                contentType: { null: true, type: "varchar" },
                createdAt: { type: "datetime" },
                filename: { type: "varchar" },
                id: { type: "uuid" },
                name: { type: "varchar" },
                position: { type: "integer" },
                recordId: { type: "varchar" },
                recordType: { type: "varchar" },
                updatedAt: { type: "datetime" }
            },
            builtInCollectionCommands: ["index"],
            builtInMemberCommands: ["find"],
            modelName: "VelociousAttachment",
            primaryKey: "id"
        };
    }
    /**
     * Returns the attachment id.
     * @returns {string} - Attachment id.
     */
    id() { return this.readAttribute("id"); }
    /**
     * Returns the owner model name.
     * @returns {string} - Owner model name.
     */
    recordType() { return this.readAttribute("recordType"); }
    /**
     * Returns the owner record id.
     * @returns {string} - Owner record id.
     */
    recordId() { return this.readAttribute("recordId"); }
    /**
     * Returns the attachment name on the owner model.
     * @returns {string} - Attachment name on the owner model.
     */
    name() { return this.readAttribute("name"); }
    /**
     * Returns the attachment position.
     * @returns {number} - Attachment position.
     */
    position() { return this.readAttribute("position"); }
    /**
     * Returns the attachment filename.
     * @returns {string} - Attachment filename.
     */
    filename() { return this.readAttribute("filename"); }
    /**
     * Returns the attachment content type.
     * @returns {string | null} - Attachment content type.
     */
    contentType() { return this.readAttribute("contentType"); }
    /**
     * Returns the attachment byte size.
     * @returns {number} - Attachment byte size.
     */
    byteSize() { return this.readAttribute("byteSize"); }
    /**
     * Returns the created-at timestamp.
     * @returns {Date} - Created-at timestamp.
     */
    createdAt() { return this.readAttribute("createdAt"); }
    /**
     * Returns the updated-at timestamp.
     * @returns {Date} - Updated-at timestamp.
     */
    updatedAt() { return this.readAttribute("updatedAt"); }
}
FrontendModelBase.registerModel(VelociousAttachment);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbHMvYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxPQUFPLE1BQU0sMkJBQTJCLENBQUE7QUFDL0MsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxrQkFBa0IsRUFBRSxFQUFDLGdDQUFnQyxFQUFDLE1BQU0sWUFBWSxDQUFBO0FBQy9FLE9BQU8sc0JBQXNCLE1BQU0sZ0JBQWdCLENBQUE7QUFDbkQsT0FBTyxFQUFDLDJCQUEyQixFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0UsT0FBTyxFQUFDLHFCQUFxQixFQUFFLHlCQUF5QixFQUFDLE1BQU0scUJBQXFCLENBQUE7QUFDcEYsT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGlDQUFpQyxFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0gsT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDekgsT0FBTyx3QkFBd0IsTUFBTSx5QkFBeUIsQ0FBQTtBQUM5RCxPQUFPLEVBQUMsd0JBQXdCLEVBQUUsZ0JBQWdCLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUMxRSxPQUFPLHdCQUF3QixNQUFNLG9DQUFvQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyx1QkFBdUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ3BFLE9BQU8sRUFBQyx3Q0FBd0MsRUFBRSxzQ0FBc0MsRUFBQyxNQUFNLDZCQUE2QixDQUFBO0FBQzVILE9BQU8sRUFBQyxtQkFBbUIsRUFBRSwyQkFBMkIsRUFBRSwyQkFBMkIsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ3hILE9BQU8sRUFBQyxnQkFBZ0IsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQ3hELE9BQU8sYUFBYSxNQUFN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QUNILFVBQVUsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXhEOzs7T0FHRztJQUNILFFBQVEsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXBEOzs7T0FHRztJQUNILElBQUksS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTVDOzs7T0FHRztJQUNILFFBQVEsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXBEOzs7T0FHRztJQUNILFFBQVEsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXBEOzs7T0FHRztJQUNILFdBQVcsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTFEOzs7T0FHRztJQUNILFFBQVEsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXBEOzs7T0FHRztJQUNILFNBQVMsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXREOzs7T0FHRztJQUNILFNBQVMsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDLENBQUEsQ0FBQyxDQUFDO0NBQ3ZEO0FBRUQsaUJBQWlCLENBQUMsYUFBYSxDQUFDLG1CQUFtQixDQUFDLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgdGltZW91dCBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiXG5pbXBvcnQgd2FpdCBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvd2FpdC5qc1wiXG5pbXBvcnQgRnJvbnRlbmRNb2RlbFF1ZXJ5LCB7ZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWR9IGZyb20gXCIuL3F1ZXJ5LmpzXCJcbmltcG9ydCBGcm9udGVuZE1vZGVsUHJlbG9hZGVyIGZyb20gXCIuL3ByZWxvYWRlci5qc1wiXG5pbXBvcnQge25vcm1hbGl6ZURhdGVTdHJpbmdGb3JXcml0ZX0gZnJvbSBcIi4uL2RhdGFiYXNlL2RhdGV0aW1lLXN0b3JhZ2UuanNcIlxuaW1wb3J0IHtyZWdpc3RlckZyb250ZW5kTW9kZWwsIHJlc29sdmVGcm9udGVuZE1vZGVsQ2xhc3N9IGZyb20gXCIuL21vZGVsLXJlZ2lzdHJ5LmpzXCJcbmltcG9ydCB7dmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kTmFtZSwgdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRofSBmcm9tIFwiLi9yZXNvdXJjZS1jb25maWctdmFsaWRhdGlvbi5qc1wiXG5pbXBvcnQge2Rlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlLCBzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IGZyb20gXCIuL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcbmltcG9ydCBydW5XaXRoVHJhbnNwb3J0RGVhZGxpbmUgZnJvbSBcIi4vdHJhbnNwb3J0LWRlYWRsaW5lLmpzXCJcbmltcG9ydCB7UkVRVUVTVF9USU1FX1pPTkVfSEVBREVSLCB2YWxpZGF0ZVRpbWVab25lfSBmcm9tIFwiLi4vdGltZS16b25lLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQgZnJvbSBcIi4uL2h0dHAtY2xpZW50L3dlYnNvY2tldC1jbGllbnQuanNcIlxuaW1wb3J0IHtyZW1vdGVSZXF1ZXN0Q29udGV4dEtleX0gZnJvbSBcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuaW1wb3J0IHtjYXB0dXJlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0LCBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dH0gZnJvbSBcIi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiXG5pbXBvcnQge2J1ZmZlck91dGdvaW5nRXZlbnQsIGNsZWFyQnVmZmVyZWRPdXRnb2luZ0V2ZW50cywgZHJhaW5CdWZmZXJlZE91dGdvaW5nRXZlbnRzfSBmcm9tIFwiLi9vdXRnb2luZy1ldmVudC1idWZmZXIuanNcIlxuaW1wb3J0IHtkZWZpbmVNb2RlbFNjb3BlfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIlxuaW1wb3J0IGlzUGxhaW5PYmplY3QgZnJvbSBcIi4uL3V0aWxzL3BsYWluLW9iamVjdC5qc1wiXG5pbXBvcnQge21vZGVsUHJpbWFyeUtleUNhY2hlS2V5LCBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zLCByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUsIHNjYWxhck1vZGVsUHJpbWFyeUtleX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCB7cmVhZFBheWxvYWRBc3NvY2lhdGlvbkNvdW50LCByZWFkUGF5bG9hZENvbXB1dGVkQWJpbGl0eSwgcmVhZFBheWxvYWRRdWVyeURhdGEsIHNldFBheWxvYWRBc3NvY2lhdGlvbkNvdW50LCBzZXRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5LCBzZXRQYXlsb2FkUXVlcnlEYXRhfSBmcm9tIFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCJcblxuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCByZWxhdGlvbnNoaXAgaGVscGVyIHR5cGUuIFJldHVybmVkIGJ5IGBnZXRSZWxhdGlvbnNoaXBCeU5hbWVgLFxuICogd2hpY2ggZ2VuZXJhdGVkIG1vZGVscyBpbW1lZGlhdGVseSBjYXN0IHRvIHRoZWlyIGNvbmNyZXRlIHJlbGF0aW9uc2hpcCB0eXBlXG4gKiAoZS5nLiBgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwPE93bmVyLCBUYXJnZXQsIFRhcmdldENyZWF0ZUF0dHJpYnV0ZXM+YCkuXG4gKiBUaGUgbWVtYmVycyB1c2UgYGFueWAgdHlwZSBhcmdzIHNvIHRoYXQgY2FzdCBpcyBhbGxvd2VkIHJlZ2FyZGxlc3Mgb2YgdGhlXG4gKiB0YXJnZXQgbW9kZWwncyB0eXBlZC1hdHRyaWJ1dGUgZ2VuZXJpY3Mg4oCUIGEgY29uY3JldGUgYEZyb250ZW5kTW9kZWxCYXNlYCBtZW1iZXJcbiAqIGhlcmUgbWFrZXMgdGhlIGNhc3QgYSBub24tb3ZlcmxhcHBpbmcgKFRTMjM1MikgZXJyb3IgZm9yIGV2ZXJ5IHR5cGVkIG1vZGVsLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwPGFueSwgYW55LCBhbnk+IHwgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwPGFueSwgYW55LCBhbnk+fSBGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2NhbGxiYWNrOiAocGF5bG9hZDoge2lkOiBzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZSwgbW9kZWw6IEZyb250ZW5kTW9kZWxCYXNlfSkgPT4gdm9pZCwgZXZlbnRGaWx0ZXJLZXk6IHN0cmluZyB8IG51bGwsIGV2ZW50RmlsdGVyUGF5bG9hZDogaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkIHwgbnVsbCwgcHJvamVjdGlvblBheWxvYWQ6IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfX0gRnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5XG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2NhbGxiYWNrOiAocGF5bG9hZDoge2lkOiBzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZX0pID0+IHZvaWR9fSBGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50Q2FsbGJhY2tFbnRyeVxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDb21tYW5kVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge1wiY3JlYXRlXCIgfCBcImZpbmRcIiB8IFwiaW5kZXhcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGUgKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxDb21tYW5kVHlwZSB8IHN0cmluZ30gRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSAqL1xuLyoqXG4gKiBNb2RlbC1saWtlIGluc3RhbmNlIHZhbHVlIHN1cHBvcnRlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQuXG4gKiBAdHlwZWRlZiB7e2F0dHJpYnV0ZXM6ICgpID0+IFJlY29yZDxzdHJpbmcsIHVua25vd24+fX0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydE1vZGVsVmFsdWVcbiAqL1xuLyoqXG4gKiBTcGVjaWFsIHNjYWxhciB2YWx1ZXMgcmVzdG9yZWQgYnkgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0LlxuICogQHR5cGVkZWYge3VuZGVmaW5lZCB8IG51bGwgfCBib29sZWFuIHwgbnVtYmVyIHwgc3RyaW5nIHwgYmlnaW50IHwgRGF0ZSB8IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRNb2RlbFZhbHVlfSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0U2NhbGFyVmFsdWVcbiAqL1xuLyoqXG4gKiBQbGFpbiBvYmplY3Qgc3VwcG9ydGVkIGJ5IGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCB2YWx1ZXMuXG4gKiBOZXN0ZWQgdmFsdWVzIGFyZSBpbnRlbnRpb25hbGx5IG9wYXF1ZSBiZWNhdXNlIFR5cGVTY3JpcHQgcmVqZWN0cyByZWN1cnNpdmVcbiAqIEpTRG9jIHR5cGVkZWZzIGZvciB0aGlzIHRyYW5zcG9ydCB2YWx1ZSBjb250cmFjdC5cbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydE9iamVjdFxuICovXG4vKipcbiAqIFZhbHVlIHN1cHBvcnRlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgc2VyaWFsaXphdGlvbiBhbmQgZGVzZXJpYWxpemF0aW9uLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRTY2FsYXJWYWx1ZSB8IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRPYmplY3QgfCBBcnJheTx1bmtub3duPn0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlXG4gKi9cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIHZhbHVlIHVzZWQgd2hlbiBnZW5lcmF0ZWQgbWV0YWRhdGEgY2Fubm90IGluZmVyIGEgbmFycm93ZXIgdHlwZS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3t0eXBlOiBcImhhc09uZVwiIHwgXCJoYXNNYW55XCJ9fSBGcm9udGVuZE1vZGVsQXR0YWNobWVudERlZmluaXRpb25cbiAqL1xuLyoqXG4gKiBEZWZpbmVzIGZyb250ZW5kLW1vZGVsIGF0dHJpYnV0ZSBtZXRhZGF0YS5cbiAqIEB0eXBlZGVmIHt7Y29sdW1uVHlwZT86IHN0cmluZywgZGF0YVR5cGU/OiBzdHJpbmcsIGpzRG9jVHlwZT86IHN0cmluZywgbmFtZT86IHN0cmluZywgbnVsbD86IGJvb2xlYW4sIHNlbGVjdGVkQnlEZWZhdWx0PzogYm9vbGVhbiwgc3FsVHlwZT86IHN0cmluZywgdHlwZT86IHN0cmluZ319IEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVEZWZpbml0aW9uXG4gKi9cbi8qKlxuICogQXR0YWNobWVudCBpbnB1dCBhY2NlcHRlZCBieSBmcm9udGVuZC1tb2RlbCBhdHRhY2htZW50IGhlbHBlcnMgYmVmb3JlIG5vcm1hbGl6YXRpb24uXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwge2FycmF5QnVmZmVyOiAoKSA9PiBQcm9taXNlPEFycmF5QnVmZmVyPiwgdHlwZT86IHN0cmluZywgbmFtZT86IHN0cmluZ30gfCBudWxsIHwgdW5kZWZpbmVkfSBGcm9udGVuZE1vZGVsQXR0YWNobWVudElucHV0XG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gRnJvbnRlbmRNb2RlbFN5bmNNZXRhZGF0YVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge1wib3B0aW1pc3RpY1ZlcnNpb25cIiB8IFwic2VydmVyV2luc1wiIHwgXCJsYXN0V3JpdGVyV2luc1wiIHwgXCJmaWVsZFRocmVlV2F5XCIgfCBcImFwcGVuZE9ubHlcIn0gRnJvbnRlbmRNb2RlbFN5bmNDb25mbGljdFN0cmF0ZWd5XG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2VuYWJsZWQ6IGJvb2xlYW4sIG9wZXJhdGlvbnM6IHN0cmluZ1tdLCBwb2xpY3lIYXNoOiBzdHJpbmcsIHBvbGljeVZlcnNpb246IHN0cmluZyB8IG51bGwsIGNvbmZsaWN0U3RyYXRlZ3k/OiBGcm9udGVuZE1vZGVsU3luY0NvbmZsaWN0U3RyYXRlZ3ksIG1ldGFkYXRhPzogRnJvbnRlbmRNb2RlbFN5bmNNZXRhZGF0YX19IEZyb250ZW5kTW9kZWxTeW5jQ29uZmlnXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2F0dHJpYnV0ZXM/OiBBcnJheTxzdHJpbmcgfCBGcm9udGVuZE1vZGVsQXR0cmlidXRlRGVmaW5pdGlvbj4gfCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlRGVmaW5pdGlvbj4sIGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHM/OiBzdHJpbmdbXSwgYnVpbHRJbk1lbWJlckNvbW1hbmRzPzogc3RyaW5nW10sIGNvbGxlY3Rpb25Db21tYW5kcz86IHN0cmluZ1tdLCBjb21tYW5kcz86IHN0cmluZ1tdLCBtZW1iZXJDb21tYW5kcz86IHN0cmluZ1tdLCBhdHRhY2htZW50cz86IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRhY2htZW50RGVmaW5pdGlvbj4sIG1vZGVsTmFtZT86IHN0cmluZywgbmVzdGVkQXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHthbGxvd0Rlc3Ryb3k/OiBib29sZWFuLCBsaW1pdD86IG51bWJlcn0+LCBwcmltYXJ5S2V5Pzogc3RyaW5nIHwgc3RyaW5nW10sIHJlbGF0aW9uc2hpcHM/OiBzdHJpbmdbXSwgc3luYz86IEZyb250ZW5kTW9kZWxTeW5jQ29uZmlnfX0gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnXG4gKi9cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgY29uc3RydWN0b3IgdHlwZS5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2V9IFtUPUZyb250ZW5kTW9kZWxCYXNlXVxuICogQHR5cGVkZWYge3tuZXcgKGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+KTogVH19IEZyb250ZW5kTW9kZWxDb25zdHJ1Y3RvclxuICovXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIHN0YXRpYyBzaWRlLlxuICpcbiAqIFRoZSB0ZW1wbGF0ZSBkZWZhdWx0cyBhcmUgaW50ZW50aW9uYWxseSBwZXJtaXNzaXZlIChgYW55YCBtb2RlbC9hdHRyaWJ1dGVcbiAqIHBhcmFtcykuIFRoZSBiYXJlIGBGcm9udGVuZE1vZGVsQ2xhc3NgIGlzIHRoZSBgQHRoaXNgL2NvbnN0cmFpbnQgdHlwZSBvbiB0aGVcbiAqIHN0YXRpYyBxdWVyeSBtZXRob2RzIChmaW5kQnkvZmluZC93aGVyZS9wcmVsb2FkLy4uLik7IGEgZ2VuZXJhdGVkIHN1YmNsYXNzXG4gKiBkZWNsYXJlcyB0eXBlZC1hdHRyaWJ1dGUgZ2VuZXJpY3MgKGUuZy4gYEZyb250ZW5kTW9kZWxCYXNlPEFjY291bnRBdHRyaWJ1dGVzLFxuICogQWNjb3VudENyZWF0ZUF0dHJpYnV0ZXMsIEFjY291bnRVcGRhdGVBdHRyaWJ1dGVzPmApIHdoaWNoLCBhZ2FpbnN0IGEgY29uY3JldGVcbiAqIGBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+YCBkZWZhdWx0LCBmYWlsIHRoZSBjb25zdHJhaW50IGJ5XG4gKiBpbnZhcmlhbmNlLiBEZWZhdWx0aW5nIHRvIGBhbnlgIGxldHMgYW55IHN1YmNsYXNzIHNhdGlzZnkgdGhlIGNvbnN0cmFpbnQgd2hpbGVcbiAqIHRoZSBtZXRob2RzJyBvd24gYEB0ZW1wbGF0ZSBUYCBzdGlsbCBjYXB0dXJlcyB0aGUgcHJlY2lzZSBjYWxsaW5nIGNsYXNzIGZvclxuICogdGhlaXIgcmV0dXJuIHR5cGVzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZX0gW1Q9RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT5dXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW0F0dHJpYnV0ZXM9YW55XVxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtDcmVhdGVBdHRyaWJ1dGVzPWFueV1cbiAqIEB0eXBlZGVmIHt7bmV3ICgpOiBULCBjcmVhdGUoYXR0cmlidXRlcz86IENyZWF0ZUF0dHJpYnV0ZXMpOiBQcm9taXNlPFQ+fSAmIE9taXQ8dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlLCBcImNyZWF0ZVwiIHwgXCJwcm90b3R5cGVcIj59IEZyb250ZW5kTW9kZWxDbGFzc1xuICovXG4vKipcbiAqIENyZWF0ZSBhdHRyaWJ1dGVzIGFjY2VwdGVkIGJ5IGEgZnJvbnRlbmQgbW9kZWwgaW5zdGFuY2UuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlfSBUXG4gKiBAdHlwZWRlZiB7VCBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlPFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4sIGluZmVyIENyZWF0ZUF0dHJpYnV0ZXMsIGluZmVyIF9VcGRhdGVBdHRyaWJ1dGVzPiA/IENyZWF0ZUF0dHJpYnV0ZXMgOiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSBGcm9udGVuZE1vZGVsQ3JlYXRlQXR0cmlidXRlc0ZvclxuICovXG4vKipcbiAqIExvYWRlZCBpbnN0YW5jZSB0eXBlIGZvciByZWxhdGlvbnNoaXAgaGVscGVyIGdlbmVyaWNzLiBPbGRlciBnZW5lcmF0ZWRcbiAqIGZyb250ZW5kIG1vZGVscyBwYXNzZWQgbW9kZWwgY2xhc3NlcyBpbnRvIHJlbGF0aW9uc2hpcCBoZWxwZXJzLCB3aGlsZSBuZXdlclxuICogZ2VuZXJhdGVkIG1vZGVscyBwYXNzIGluc3RhbmNlIHR5cGVzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gVFxuICogQHR5cGVkZWYge1QgZXh0ZW5kcyB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2UgPyBJbnN0YW5jZVR5cGU8VD4gOiBUfSBGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWxcbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnXG4gKiBAcHJvcGVydHkge3N0cmluZyB8ICgoKSA9PiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKX0gW3VybF0gLSBPcHRpb25hbCBmcm9udGVuZC1tb2RlbCBVUkwuIFRoaXMgc2hvdWxkIGJlIHRoZSBzaGFyZWQgZW5kcG9pbnQgKGZvciBleGFtcGxlIGBcIi9mcm9udGVuZC1tb2RlbHNcImAgb3IgYFwiaHR0cHM6Ly9leGFtcGxlLmNvbS9mcm9udGVuZC1tb2RlbHNcImApLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc2hhcmVkXSAtIERlcHJlY2F0ZWQgc2hhcmVkLWVuZHBvaW50IGZsYWcgcmV0YWluZWQgZm9yIGNvbXBhdGliaWxpdHkuIEZyb250ZW5kLW1vZGVsIENSVUQvY3VzdG9tIGNvbW1hbmRzIHVzZSB0aGUgc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSBlbnZlbG9wZSBieSBkZWZhdWx0LlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCAoKCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCl9IFt3ZWJzb2NrZXRVcmxdIC0gT3B0aW9uYWwgd2Vic29ja2V0IFVSTC4gV2hlbiBzZXQsIFZlbG9jaW91cyBjcmVhdGVzIGFuZCBtYW5hZ2VzIGl0cyBvd24gd2Vic29ja2V0IGNsaWVudCBpbnRlcm5hbGx5LiBTdWJzY3JpcHRpb25zIHVzZSB0aGUgd2Vic29ja2V0OyBDUlVEIHVzZXMgSFRUUCBhbmQgZmFsbHMgYmFjayBncmFjZWZ1bGx5LiBFeGFtcGxlOiBgXCJ3czovL2xvY2FsaG9zdDozMDA2L3dlYnNvY2tldFwiYC5cbiAqIEBwcm9wZXJ0eSB7e3Bvc3Q6IChwYXRoOiBzdHJpbmcsIGJvZHk/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgb3B0aW9ucz86IHtoZWFkZXJzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPiwgc2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPHtqc29uOiAoKSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+LCBzdWJzY3JpYmU6IChjaGFubmVsOiBzdHJpbmcsIG9wdGlvbnM6IHtwYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59LCBjYWxsYmFjazogKHBheWxvYWQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiB2b2lkKSA9PiAoKCkgPT4gdm9pZCksIHN1YnNjcmliZUFuZFdhaXQ/OiAoY2hhbm5lbDogc3RyaW5nLCBvcHRpb25zOiB7cGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSwgY2FsbGJhY2s6IChwYXlsb2FkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZCkgPT4gUHJvbWlzZTwoKCkgPT4gdm9pZCk+fX0gW3dlYnNvY2tldENsaWVudF0gLSBPcHRpb25hbCB3ZWJzb2NrZXQgY2xpZW50IGZvciBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJIHJlcXVlc3RzIGFuZCBzdWJzY3JpcHRpb25zLiBJdHMgYHBvc3RgIHJlY2VpdmVzIHRoZSBib3VuZGVkLWRlYWRsaW5lIGBzaWduYWxgIGFuZCBzaG91bGQgZm9yd2FyZCBpdCBpbnRvIHRoZSB1bmRlcmx5aW5nIHRyYW5zcG9ydCBzbyB0aGUgZGVhZGxpbmUgY2FuIGFib3J0IHRoZSBsaXZlIHJlcXVlc3QgYW5kIGl0cyByZXNwb25zZS1ib2R5IHJlYWQuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIHN0cmluZz4gfCAoKCkgPT4gUmVjb3JkPHN0cmluZywgc3RyaW5nPil9IFtyZXF1ZXN0SGVhZGVyc10gLSBFeHRyYSBIVFRQL1dTIGhlYWRlcnMgdG8gYXR0YWNoIHRvIGV2ZXJ5IGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0LiBQYXNzIGEgZnVuY3Rpb24gdG8gY29tcHV0ZSB0aGVtIGF0IHJlcXVlc3QgdGltZSAoZm9yIGV4YW1wbGUgdG8gaW5jbHVkZSB0aGUgY3VycmVudCBsb2NhbGUpLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0IHwgKCgpID0+IGltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQgfCB1bmRlZmluZWQgfCBudWxsKX0gW3JlcXVlc3RDb250ZXh0XSAtIEltbXV0YWJsZSBzY2FsYXIgY29udGV4dCBjYXB0dXJlZCBpbmRlcGVuZGVudGx5IHdoZW4gZWFjaCBvcGVyYXRpb24gb3IgZXZlbnQgc3Vic2NyaXB0aW9uIHN0YXJ0cyBhbmQgc2VudCBmb3IgcmVtb3RlIHRlbmFudC9hYmlsaXR5IHJlc29sdXRpb24uXG4gKiBAcHJvcGVydHkge251bWJlciB8ICgoKSA9PiBudW1iZXIgfCB1bmRlZmluZWQgfCBudWxsKX0gW3RpbWVvdXRdIC0gQm91bmRlZCBkZWFkbGluZSBpbiBtaWxsaXNlY29uZHMgY292ZXJpbmcgY29ubmVjdGlvbiwgcmVzcG9uc2UgaGVhZGVycywgYW5kIHJlc3BvbnNlLWJvZHkgY29uc3VtcHRpb24gZm9yIGVhY2ggZnJvbnRlbmQtbW9kZWwgQVBJIHJlcXVlc3QuIE9uIGV4cGlyeSB0aGUgbGl2ZSBmZXRjaC9hZGFwdGVyIHJlcXVlc3QgaXMgYWJvcnRlZCAoYnVpbHQgb24gYXdhaXRlcnkncyBgdGltZW91dGApIGFuZCBhd2FpdGVyeSdzIGBUaW1lb3V0RXJyb3JgIGlzIHRocm93biwgc28gY2FsbGVycyBjYW4gY2xhc3NpZnkgYSB0aW1lb3V0IHZpYSBgZXJyb3IgaW5zdGFuY2VvZiBUaW1lb3V0RXJyb3JgLiBQYXNzIGEgZnVuY3Rpb24gdG8gcmVzb2x2ZSBpdCBwZXIgcmVxdWVzdC4gRmFsc3kvYWJzZW50IG1lYW5zIG5vIGRlYWRsaW5lLlxuICogQHByb3BlcnR5IHtBYm9ydFNpZ25hbCB8ICgoKSA9PiBBYm9ydFNpZ25hbCB8IHVuZGVmaW5lZCB8IG51bGwpfSBbc2lnbmFsXSAtIE9wdGlvbmFsIGNhbGxlci9zZXNzaW9uIEFib3J0U2lnbmFsIGNvbXBvc2VkIHdpdGggdGhlIGRlYWRsaW5lLiBBYm9ydGluZyBpdCBjYW5jZWxzIHRoZSBsaXZlIHJlcXVlc3QgKGZvciBleGFtcGxlIG9uIHNlc3Npb24gc2h1dGRvd24gb3Igb2ZmbGluZSB0cmFuc2l0aW9uKTsgdGhlIHJlc3VsdGluZyBhYm9ydCBlcnJvciBzdGF5cyBkaXN0aW5ndWlzaGFibGUgZnJvbSBhIHRpbWVvdXQuIFBhc3MgYSBmdW5jdGlvbiB0byByZXNvbHZlIHRoZSBjdXJyZW50IHNpZ25hbCBwZXIgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7e2dldDogKCkgPT4gc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCB8IFByb21pc2U8c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZD4sIHNldDogKHNlc3Npb25JZDogc3RyaW5nKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPiwgY2xlYXI6ICgpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fX0gW3Nlc3Npb25TdG9yZV0gLSBPcHRpb25hbCBzZXNzaW9uSWQgcGVyc2lzdGVuY2UgaG9vayBmb3J3YXJkZWQgdG8gdGhlIGludGVybmFsIGBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnRgIHNvIFdTIHNlc3Npb25zIGNhbiBiZSByZXN1bWVkIGFjcm9zcyBwYWdlIHJlbG9hZHMgLyBhcHAgcmVzdGFydHMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8ICgoKSA9PiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkKX0gW3RpbWVab25lXSAtIElBTkEgdGltZXpvbmUgc2VudCB3aXRoIGV2ZXJ5IGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0IGZvciB0aW1lem9uZS1sZXNzIGRhdGV0aW1lIHBhcnNpbmcuXG4gKiBAcHJvcGVydHkge3thY3RvckRldmljZUlkOiBzdHJpbmcsIGFjdG9yVXNlcklkOiBzdHJpbmcsIGNsaWVudE11dGF0aW9uSWQ/OiAoKSA9PiBzdHJpbmcsIGVuYWJsZWQ/OiBib29sZWFuLCBtdXRhdGlvbkxvZzogaW1wb3J0KFwiLi4vc3luYy9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuZGVmYXVsdCwgbm93PzogKCkgPT4gRGF0ZSwgb2ZmbGluZUdyYW50OiB7aWQ6IHN0cmluZ319fSBbb2ZmbGluZVN5bmNdIC0gT2ZmbGluZSBtdXRhdGlvbiBxdWV1ZSBjb25maWd1cmF0aW9uLlxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxJZGxlV2FpdEFyZ3MgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxJZGxlV2FpdEFyZ3NcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbcXVpZXRNc10gLSBNaWxsaXNlY29uZHMgdGhlIHRyYW5zcG9ydCBtdXN0IHN0YXkgaWRsZSBiZWZvcmUgcmVzb2x2aW5nLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFt0aW1lb3V0XSAtIFRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzLlxuICovXG5cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IGNvbmZpZy5cbiAqIEB0eXBlIHtGcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnfSAqL1xuY29uc3QgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZyA9IHt9XG5jb25zdCBTSEFSRURfRlJPTlRFTkRfTU9ERUxfQVBJX1BBVEggPSBcIi9mcm9udGVuZC1tb2RlbHNcIlxuY29uc3QgUFJFTE9BREVEX1JFTEFUSU9OU0hJUFNfS0VZID0gXCJfX3ByZWxvYWRlZFJlbGF0aW9uc2hpcHNcIlxuY29uc3QgU0VMRUNURURfQVRUUklCVVRFU19LRVkgPSBcIl9fc2VsZWN0ZWRBdHRyaWJ1dGVzXCJcbmNvbnN0IEFTU09DSUFUSU9OX0NPVU5UU19LRVkgPSBcIl9fYXNzb2NpYXRpb25Db3VudHNcIlxuY29uc3QgUVVFUllfREFUQV9LRVkgPSBcIl9fcXVlcnlEYXRhXCJcbmNvbnN0IEFCSUxJVElFU19LRVkgPSBcIl9fYWJpbGl0aWVzXCJcbi8qKlxuICogUGVuZGluZyBzaGFyZWQgZnJvbnRlbmQgbW9kZWwgcmVxdWVzdHMuXG4gKiBAdHlwZSB7QXJyYXk8e2NvbW1hbmROYW1lPzogc3RyaW5nLCBjb21tYW5kVHlwZTogRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSwgY3VzdG9tUGF0aD86IHN0cmluZywgbW9kZWxDbGFzczogRnJvbnRlbmRNb2RlbENsYXNzLCBwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHJlcXVlc3RDb250ZXh0OiBpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0LCByZXF1ZXN0SWQ6IHN0cmluZywgcmVzb2x2ZTogKHJlc3BvbnNlOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IHZvaWQsIHJlamVjdDogKGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZCwgcmVzb3VyY2VQYXRoPzogc3RyaW5nIHwgbnVsbH0+fSAqL1xubGV0IHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMgPSBbXVxuXG5sZXQgc2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RJZCA9IDBcbmxldCBzaGFyZWRGcm9udGVuZE1vZGVsRmx1c2hTY2hlZHVsZWQgPSBmYWxzZVxubGV0IGFjdGl2ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0Q291bnQgPSAwXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIGlkbGUgcmVzb2x2ZXJzLlxuICogQHR5cGUge0FycmF5PCgpID0+IHZvaWQ+fSAqL1xubGV0IGZyb250ZW5kTW9kZWxJZGxlUmVzb2x2ZXJzID0gW11cblxuLyoqXG4gKiBJbnRlcm5hbCB3ZWJzb2NrZXQgY2xpZW50LlxuICogQHR5cGUge1ZlbG9jaW91c1dlYnNvY2tldENsaWVudCB8IG51bGx9ICovXG5sZXQgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgPSBudWxsXG4vKiogQHR5cGUge0Fib3J0U2lnbmFsIHwgbnVsbH0gKi9cbmxldCBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbCA9IG51bGxcbi8qKiBAdHlwZSB7KCgpID0+IHZvaWQpIHwgbnVsbH0gKi9cbmxldCBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXAgPSBudWxsXG5cbi8qKlxuICogRGV0YWNoZXMgYW4gb3duZWQgV2ViU29ja2V0IGNsaWVudCBmcm9tIHRoZSBzaGFyZWQgY2FjaGUgaWYgaXQgaXMgc3RpbGwgY3VycmVudC5cbiAqIEBwYXJhbSB7VmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50fSBjbGllbnQgLSBDbGllbnQgd2hvc2Ugb3duZXJzaGlwIGlzIGVuZGluZy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBkZXRhY2hJbnRlcm5hbFdlYnNvY2tldENsaWVudChjbGllbnQpIHtcbiAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50ICE9PSBjbGllbnQpIHJldHVyblxuXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50ID0gbnVsbFxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXA/LigpXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsID0gbnVsbFxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXAgPSBudWxsXG59XG5cbi8qKlxuICogRGlzcG9zZXMgdGhlIG93bmVkIFdlYlNvY2tldCBjbGllbnQgYmVmb3JlIHRyYW5zcG9ydC9zZXNzaW9uIGNvbmZpZ3VyYXRpb24gY2hhbmdlcy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZXNldEludGVybmFsV2Vic29ja2V0Q2xpZW50KCkge1xuICBjb25zdCBjbGllbnQgPSBpbnRlcm5hbFdlYnNvY2tldENsaWVudFxuXG4gIGlmICghY2xpZW50KSByZXR1cm5cblxuICBkZXRhY2hJbnRlcm5hbFdlYnNvY2tldENsaWVudChjbGllbnQpXG4gIHZvaWQgY2xpZW50LmRpc2Nvbm5lY3RBbmRTdG9wUmVjb25uZWN0KClcbn1cblxuLyoqXG4gKiBCaW5kcyB0aGUgb3duZWQgV2ViU29ja2V0IGNsaWVudCBsaWZldGltZSB0byB0aGUgY3VycmVudCBzZXNzaW9uIHNpZ25hbC5cbiAqIEBwYXJhbSB7QWJvcnRTaWduYWwgfCB1bmRlZmluZWR9IHNlc3Npb25TaWduYWwgLSBDdXJyZW50IHNlc3Npb24gc2lnbmFsLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGJpbmRJbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbChzZXNzaW9uU2lnbmFsKSB7XG4gIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbCA9PT0gc2Vzc2lvblNpZ25hbCkgcmV0dXJuXG5cbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwPy4oKVxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbCA9IHNlc3Npb25TaWduYWwgfHwgbnVsbFxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXAgPSBudWxsXG5cbiAgaWYgKCFzZXNzaW9uU2lnbmFsIHx8ICFpbnRlcm5hbFdlYnNvY2tldENsaWVudCkgcmV0dXJuXG5cbiAgY29uc3QgY2xpZW50ID0gaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRcbiAgY29uc3Qgb25TZXNzaW9uQWJvcnQgPSAoKSA9PiB7XG4gICAgZGV0YWNoSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoY2xpZW50KVxuICAgIGNsZWFyQnVmZmVyZWRPdXRnb2luZ0V2ZW50cygpXG4gICAgdm9pZCBjbGllbnQuZGlzY29ubmVjdEFuZFN0b3BSZWNvbm5lY3QoKVxuICB9XG5cbiAgc2Vzc2lvblNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgb25TZXNzaW9uQWJvcnQsIHtvbmNlOiB0cnVlfSlcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwID0gKCkgPT4gc2Vzc2lvblNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgb25TZXNzaW9uQWJvcnQpXG5cbiAgaWYgKHNlc3Npb25TaWduYWwuYWJvcnRlZCkgb25TZXNzaW9uQWJvcnQoKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IGlzIGlkbGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGFsbCBxdWV1ZWQgYW5kIGFjdGl2ZSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgcmVxdWVzdHMgYXJlIGRvbmUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSB7XG4gIHJldHVybiBhY3RpdmVGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdENvdW50ID09PSAwXG4gICAgJiYgcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cy5sZW5ndGggPT09IDBcbiAgICAmJiAhc2hhcmVkRnJvbnRlbmRNb2RlbEZsdXNoU2NoZWR1bGVkXG59XG5cbi8qKlxuICogUnVucyByZXNvbHZlIGZyb250ZW5kIG1vZGVsIGlkbGUgd2FpdGVycy5cbiAqIEByZXR1cm5zIHt2b2lkfSAqL1xuZnVuY3Rpb24gcmVzb2x2ZUZyb250ZW5kTW9kZWxJZGxlV2FpdGVycygpIHtcbiAgaWYgKCFmcm9udGVuZE1vZGVsVHJhbnNwb3J0SXNJZGxlKCkpIHJldHVyblxuXG4gIGNvbnN0IHJlc29sdmVycyA9IGZyb250ZW5kTW9kZWxJZGxlUmVzb2x2ZXJzXG4gIGZyb250ZW5kTW9kZWxJZGxlUmVzb2x2ZXJzID0gW11cblxuICBmb3IgKGNvbnN0IHJlc29sdmUgb2YgcmVzb2x2ZXJzKSB7XG4gICAgcmVzb2x2ZSgpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHdhaXQgZm9yIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBxdWlldCBwZXJpb2QuXG4gKiBAcGFyYW0ge251bWJlcn0gbWlsbGlzZWNvbmRzIC0gUXVpZXQgcGVyaW9kIGxlbmd0aC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciB0aGUgcXVpZXQgcGVyaW9kLlxuICovXG5hc3luYyBmdW5jdGlvbiB3YWl0Rm9yRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFF1aWV0UGVyaW9kKG1pbGxpc2Vjb25kcykge1xuICBpZiAobWlsbGlzZWNvbmRzIDw9IDApIHJldHVyblxuXG4gIGF3YWl0IHdhaXQobWlsbGlzZWNvbmRzKVxufVxuXG4vKipcbiAqIFJ1bnMgd2FpdCBmb3IgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IGlkbGUuXG4gKiBAcGFyYW0ge251bWJlcn0gcXVpZXRNcyAtIE1pbGxpc2Vjb25kcyB0aGUgdHJhbnNwb3J0IG11c3Qgc3RheSBpZGxlIGJlZm9yZSByZXNvbHZpbmcuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiB0cmFuc3BvcnQgc3RheXMgaWRsZS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gd2FpdEZvckZyb250ZW5kTW9kZWxUcmFuc3BvcnRJZGxlKHF1aWV0TXMgPSAwKSB7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgaWYgKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSkge1xuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHF1ZXVlTWljcm90YXNrKCgpID0+IHJlc29sdmUodW5kZWZpbmVkKSkpXG5cbiAgICAgIGlmIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0SXNJZGxlKCkpIHtcbiAgICAgICAgYXdhaXQgd2FpdEZvckZyb250ZW5kTW9kZWxUcmFuc3BvcnRRdWlldFBlcmlvZChxdWlldE1zKVxuXG4gICAgICAgIGlmIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0SXNJZGxlKCkpIHJldHVyblxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICBmcm9udGVuZE1vZGVsSWRsZVJlc29sdmVycy5wdXNoKCgpID0+IHJlc29sdmUodW5kZWZpbmVkKSlcbiAgICAgIH0pXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUnVucyB0cmFjayBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgcmVxdWVzdC5cbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNwb3J0IGNhbGxiYWNrLlxuICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICovXG5hc3luYyBmdW5jdGlvbiB0cmFja0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0KGNhbGxiYWNrKSB7XG4gIGFjdGl2ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0Q291bnQgKz0gMVxuXG4gIHRyeSB7XG4gICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgfSBmaW5hbGx5IHtcbiAgICBhY3RpdmVGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdENvdW50IC09IDFcbiAgICByZXNvbHZlRnJvbnRlbmRNb2RlbElkbGVXYWl0ZXJzKClcbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGludGVybmFsIHdlYnNvY2tldCBjbGllbnQgZnJvbSB3ZWJzb2NrZXRVcmwgY29uZmlnLlxuICogQ3JlYXRlcyB0aGUgY2xpZW50IGxhemlseSBvbiBmaXJzdCBjYWxsLiBSZXR1cm5zIG51bGwgaWYgV2ViU29ja2V0XG4gKiBpcyBub3QgYXZhaWxhYmxlIG9yIHdlYnNvY2tldFVybCBpcyBub3QgY29uZmlndXJlZC5cbiAqIEByZXR1cm5zIHtWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQgfCBudWxsfSBXZWJzb2NrZXQgY2xpZW50IG9yIG51bGwuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpIHtcbiAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50KSB7XG4gICAgY29uc3QgY2xpZW50ID0gaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRcblxuICAgIGJpbmRJbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbChmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCkpXG5cbiAgICByZXR1cm4gY2xpZW50XG4gIH1cblxuICBjb25zdCB3ZWJzb2NrZXRVcmwgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldFVybFxuXG4gIGlmICghd2Vic29ja2V0VXJsKSByZXR1cm4gbnVsbFxuICBpZiAodHlwZW9mIGdsb2JhbFRoaXMuV2ViU29ja2V0ID09PSBcInVuZGVmaW5lZFwiKSByZXR1cm4gbnVsbFxuXG4gIGNvbnN0IHJlc29sdmVkVXJsID0gdHlwZW9mIHdlYnNvY2tldFVybCA9PT0gXCJmdW5jdGlvblwiID8gd2Vic29ja2V0VXJsKCkgOiB3ZWJzb2NrZXRVcmxcblxuICBpZiAoIXJlc29sdmVkVXJsKSByZXR1cm4gbnVsbFxuXG4gIGNvbnN0IGNsaWVudCA9IG5ldyBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQoe1xuICAgIGF1dG9SZWNvbm5lY3Q6IHRydWUsXG4gICAgc2Vzc2lvblN0b3JlOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNlc3Npb25TdG9yZSxcbiAgICB1cmw6IHJlc29sdmVkVXJsXG4gIH0pXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50ID0gY2xpZW50XG4gIGNsaWVudC5vblJlY29ubmVjdCA9IGFzeW5jICgpID0+IGF3YWl0IGZsdXNoQnVmZmVyZWRPdXRnb2luZ0V2ZW50c0FmdGVyUmVjb25uZWN0KGNsaWVudClcblxuICBiaW5kSW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpKVxuXG4gIHJldHVybiBjbGllbnRcbn1cblxuLyoqXG4gKiBSdW5zIGZsdXNoIGJ1ZmZlcmVkIG91dGdvaW5nIGV2ZW50cyBhZnRlciByZWNvbm5lY3QuXG4gKiBAcGFyYW0ge1ZlbG9jaW91c1dlYnNvY2tldENsaWVudH0gY2xpZW50IC0gUmVjb25uZWN0ZWQgY2xpZW50IHRoYXQgb3ducyB0aGlzIGZsdXNoLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59ICovXG5hc3luYyBmdW5jdGlvbiBmbHVzaEJ1ZmZlcmVkT3V0Z29pbmdFdmVudHNBZnRlclJlY29ubmVjdChjbGllbnQpIHtcbiAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50ICE9PSBjbGllbnQpIHJldHVyblxuXG4gIGNvbnN0IGV2ZW50cyA9IGRyYWluQnVmZmVyZWRPdXRnb2luZ0V2ZW50cygpXG4gIGNvbnN0IHNlc3Npb25TaWduYWwgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKClcblxuICBhd2FpdCBydW5XaXRoVHJhbnNwb3J0RGVhZGxpbmUoXG4gICAge1xuICAgICAgZXJyb3JNZXNzYWdlOiBcIkJ1ZmZlcmVkIGZyb250ZW5kLW1vZGVsIFdlYlNvY2tldCBmbHVzaCB0aW1lZCBvdXRcIixcbiAgICAgIHNpZ25hbDogc2Vzc2lvblNpZ25hbCxcbiAgICAgIHRpbWVvdXRNczogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVvdXRNcygpXG4gICAgfSxcbiAgICBhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgZXZlbnRzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgIT09IGNsaWVudCkgcmV0dXJuXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBjbGllbnQucG9zdChldmVudHNbaW5kZXhdLmN1c3RvbVBhdGgsIGV2ZW50c1tpbmRleF0ucGF5bG9hZCwge3NpZ25hbH0pXG5cbiAgICAgICAgICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgIT09IGNsaWVudCkgcmV0dXJuXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cbiAgICAgICAgICBpZiAoc2Vzc2lvblNpZ25hbD8uYWJvcnRlZCkgcmV0dXJuXG5cbiAgICAgICAgICBpZiAoc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgICAgIGZvciAobGV0IHJlbWFpbmluZyA9IGluZGV4OyByZW1haW5pbmcgPCBldmVudHMubGVuZ3RoOyByZW1haW5pbmcgKz0gMSkge1xuICAgICAgICAgICAgICBidWZmZXJPdXRnb2luZ0V2ZW50KGV2ZW50c1tyZW1haW5pbmddKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBzb2NrZXRPcGVuID0gY2xpZW50LnNvY2tldD8ucmVhZHlTdGF0ZSA9PT0gY2xpZW50LnNvY2tldD8uT1BFTlxuXG4gICAgICAgICAgaWYgKHNvY2tldE9wZW4pIGNvbnRpbnVlXG5cbiAgICAgICAgICBmb3IgKGxldCByZW1haW5pbmcgPSBpbmRleDsgcmVtYWluaW5nIDwgZXZlbnRzLmxlbmd0aDsgcmVtYWluaW5nICs9IDEpIHtcbiAgICAgICAgICAgIGJ1ZmZlck91dGdvaW5nRXZlbnQoZXZlbnRzW3JlbWFpbmluZ10pXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIClcbn1cblxuLyoqXG4gKiBSdW5zIGRlZmF1bHQgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgcGF0aC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIERlZmF1bHQgcmVzb3VyY2UgcGF0aCBmb3IgdGhlIG1vZGVsIGNsYXNzLlxuICovXG5mdW5jdGlvbiBkZWZhdWx0RnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aChtb2RlbENsYXNzKSB7XG4gIHJldHVybiBgLyR7aW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi5wbHVyYWxpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCkpKSl9YFxufVxuXG4vKiogRXJyb3IgcmFpc2VkIHdoZW4gcmVhZGluZyBhbiBhdHRyaWJ1dGUgdGhhdCB3YXMgbm90IHNlbGVjdGVkIGluIHF1ZXJ5IHBheWxvYWRzLiAqL1xuZXhwb3J0IGNsYXNzIEF0dHJpYnV0ZU5vdFNlbGVjdGVkRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gTW9kZWwgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgdGhhdCB3YXMgcmVxdWVzdGVkLlxuICAgKi9cbiAgY29uc3RydWN0b3IobW9kZWxOYW1lLCBhdHRyaWJ1dGVOYW1lKSB7XG4gICAgc3VwZXIoYCR7bW9kZWxOYW1lfSMke2F0dHJpYnV0ZU5hbWV9IHdhcyBub3Qgc2VsZWN0ZWRgKVxuICAgIHRoaXMubmFtZSA9IFwiQXR0cmlidXRlTm90U2VsZWN0ZWRFcnJvclwiXG4gIH1cbn1cblxuLyoqXG4gKiBMaWdodHdlaWdodCBzaW5ndWxhciByZWxhdGlvbnNoaXAgc3RhdGUgaG9sZGVyIGZvciBmcm9udGVuZCBtb2RlbCBpbnN0YW5jZXMuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnk+IHwgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlfSBTXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnk+IHwgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlfSBUXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW1RhcmdldENyZWF0ZUF0dHJpYnV0ZXM9UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPl1cbiAqL1xuZXhwb3J0IGNsYXNzIEZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIFBhcmVudCBtb2RlbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3M8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+LCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzPiB8IG51bGx9IHRhcmdldE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcihtb2RlbCwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgIHRoaXMubW9kZWwgPSBtb2RlbFxuICAgIHRoaXMucmVsYXRpb25zaGlwTmFtZSA9IHJlbGF0aW9uc2hpcE5hbWVcbiAgICB0aGlzLnRhcmdldE1vZGVsQ2xhc3MgPSB0YXJnZXRNb2RlbENsYXNzXG4gICAgdGhpcy5fcHJlbG9hZGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGx9ICovXG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbG9hZGVkLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGwgfCB1bmRlZmluZWR9IGxvYWRlZFZhbHVlIC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRMb2FkZWQobG9hZGVkVmFsdWUpIHtcbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IGxvYWRlZFZhbHVlID09IHVuZGVmaW5lZCA/IG51bGwgOiBsb2FkZWRWYWx1ZVxuICAgIHRoaXMuX3ByZWxvYWRlZCA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBwcmVsb2FkZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcmVsYXRpb25zaGlwIGlzIHByZWxvYWRlZC5cbiAgICovXG4gIGdldFByZWxvYWRlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5fcHJlbG9hZGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkZWQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsfSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqL1xuICBsb2FkZWQoKSB7XG4gICAgaWYgKCF0aGlzLl9wcmVsb2FkZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSBoYXNuJ3QgYmVlbiBwcmVsb2FkZWRgKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9sb2FkZWRWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIENvcGllcyBsb2FkZWQgdmFsdWUgZnJvbSBhbm90aGVyIHNpbmd1bGFyIHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gc291cmNlUmVsYXRpb25zaGlwIC0gU291cmNlIHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY29weUxvYWRlZEZyb20oc291cmNlUmVsYXRpb25zaGlwKSB7XG4gICAgaWYgKHNvdXJjZVJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX0gc291cmNlIHJlbGF0aW9uc2hpcCB0byBiZSBzaW5ndWxhcmApXG4gICAgfVxuXG4gICAgLy8gTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgdGFyZ2V0IHJlbGF0aW9uc2hpcCdzIGRvY3VtZW50ZWQgbW9kZWwgdHlwZS5cbiAgICBjb25zdCBsb2FkZWRWYWx1ZSA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbH0gKi8gKHNvdXJjZVJlbGF0aW9uc2hpcC5sb2FkZWQoKSlcblxuICAgIHRoaXMuc2V0TG9hZGVkKGxvYWRlZFZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQuXG4gICAqIEBwYXJhbSB7VGFyZ2V0Q3JlYXRlQXR0cmlidXRlc30gW2F0dHJpYnV0ZXNdIC0gTmV3IG1vZGVsIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD59IC0gQnVpbHQgbW9kZWwuXG4gICAqL1xuICBidWlsZChhdHRyaWJ1dGVzID0gLyoqIEB0eXBlIHtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzfSAqLyAoe30pKSB7XG4gICAgaWYgKCF0aGlzLnRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGNvbmZpZ3VyZWQgZm9yICR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge25ldyAoYXR0cmlidXRlcz86IFRhcmdldENyZWF0ZUF0dHJpYnV0ZXMpID0+IEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPn0gKi8gKHRoaXMudGFyZ2V0TW9kZWxDbGFzcylcbiAgICBjb25zdCBtb2RlbCA9IG5ldyBNb2RlbENsYXNzKGF0dHJpYnV0ZXMpXG5cbiAgICB0aGlzLnNldExvYWRlZChtb2RlbClcblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIEZvcmNlLXJlbG9hZCB0aGUgcmVsYXRpb25zaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsPn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgbG9hZCgpIHtcbiAgICB0aGlzLl9wcmVsb2FkZWQgPSBmYWxzZVxuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gbnVsbFxuXG4gICAgY29uc3QgYmF0Y2hlZCA9IGF3YWl0IHRoaXMubW9kZWwuX3RyeUNvaG9ydFByZWxvYWQodGhpcy5yZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKGJhdGNoZWQpIHJldHVybiB0aGlzLmxvYWRlZCgpXG5cbiAgICBhd2FpdCB0aGlzLm1vZGVsLmxvYWRSZWxhdGlvbnNoaXAodGhpcy5yZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgcmV0dXJuIHRoaXMubG9hZGVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBsb2FkZWQgcmVsYXRpb25zaGlwIG9yIGxvYWRzIGl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsPn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgb3JMb2FkKCkge1xuICAgIGlmICh0aGlzLmdldFByZWxvYWRlZCgpKSByZXR1cm4gdGhpcy5sb2FkZWQoKVxuXG4gICAgY29uc3QgYmF0Y2hlZCA9IGF3YWl0IHRoaXMubW9kZWwuX3RyeUNvaG9ydFByZWxvYWQodGhpcy5yZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKGJhdGNoZWQpIHJldHVybiB0aGlzLmxvYWRlZCgpXG5cbiAgICBhd2FpdCB0aGlzLm1vZGVsLmxvYWRSZWxhdGlvbnNoaXAodGhpcy5yZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgcmV0dXJuIHRoaXMubG9hZGVkKClcbiAgfVxufVxuXG4vKipcbiAqIExpZ2h0d2VpZ2h0IGhhcy1tYW55IHJlbGF0aW9uc2hpcCBzdGF0ZSBob2xkZXIgZm9yIGZyb250ZW5kIG1vZGVsIGluc3RhbmNlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFNcbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFRcbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz1SZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+XVxuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXAge1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pn0gKi9cbiAgX2xvYWRlZFZhbHVlXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gUGFyZW50IG1vZGVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzczxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4sIFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4sIFRhcmdldENyZWF0ZUF0dHJpYnV0ZXM+IHwgbnVsbH0gdGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG1vZGVsLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgdGhpcy5tb2RlbCA9IG1vZGVsXG4gICAgdGhpcy5yZWxhdGlvbnNoaXBOYW1lID0gcmVsYXRpb25zaGlwTmFtZVxuICAgIHRoaXMudGFyZ2V0TW9kZWxDbGFzcyA9IHRhcmdldE1vZGVsQ2xhc3NcbiAgICB0aGlzLl9wcmVsb2FkZWQgPSBmYWxzZVxuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBsb2FkZWQuXG4gICAqIEBwYXJhbSB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pn0gbG9hZGVkVmFsdWUgLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldExvYWRlZChsb2FkZWRWYWx1ZSkge1xuICAgIGlmICghQXJyYXkuaXNBcnJheShsb2FkZWRWYWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSB0byBiZSBsb2FkZWQgd2l0aCBhbiBhcnJheWApXG4gICAgfVxuXG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBsb2FkZWRWYWx1ZVxuICAgIHRoaXMuX3ByZWxvYWRlZCA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBwcmVsb2FkZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcmVsYXRpb25zaGlwIGlzIHByZWxvYWRlZC5cbiAgICovXG4gIGdldFByZWxvYWRlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5fcHJlbG9hZGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkZWQuXG4gICAqIEByZXR1cm5zIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWVzLlxuICAgKi9cbiAgbG9hZGVkKCkge1xuICAgIGlmICghdGhpcy5fcHJlbG9hZGVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX0gaGFzbid0IGJlZW4gcHJlbG9hZGVkYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fbG9hZGVkVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3BpZXMgbG9hZGVkIHZhbHVlIGZyb20gYW5vdGhlciBoYXMtbWFueSByZWxhdGlvbnNoaXAgaGVscGVyLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXB9IHNvdXJjZVJlbGF0aW9uc2hpcCAtIFNvdXJjZSByZWxhdGlvbnNoaXAgaGVscGVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNvcHlMb2FkZWRGcm9tKHNvdXJjZVJlbGF0aW9uc2hpcCkge1xuICAgIGlmICghKHNvdXJjZVJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IHNvdXJjZSByZWxhdGlvbnNoaXAgdG8gYmUgaGFzLW1hbnlgKVxuICAgIH1cblxuICAgIC8vIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIHRhcmdldCByZWxhdGlvbnNoaXAncyBkb2N1bWVudGVkIG1vZGVsIHR5cGUuXG4gICAgY29uc3QgbG9hZGVkVmFsdWUgPSAvKiogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj59ICovIChzb3VyY2VSZWxhdGlvbnNoaXAubG9hZGVkKCkpXG5cbiAgICB0aGlzLnNldExvYWRlZChsb2FkZWRWYWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCB0byBsb2FkZWQuXG4gICAqIEBwYXJhbSB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pn0gbW9kZWxzIC0gTW9kZWxzIHRvIGFwcGVuZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhZGRUb0xvYWRlZChtb2RlbHMpIHtcbiAgICBjb25zdCBsb2FkZWRNb2RlbHMgPSB0aGlzLmdldFByZWxvYWRlZCgpID8gdGhpcy5sb2FkZWQoKSA6IFtdXG5cbiAgICB0aGlzLnNldExvYWRlZChbLi4ubG9hZGVkTW9kZWxzLCAuLi5tb2RlbHNdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQuXG4gICAqIEBwYXJhbSB7VGFyZ2V0Q3JlYXRlQXR0cmlidXRlc30gW2F0dHJpYnV0ZXNdIC0gTmV3IG1vZGVsIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD59IC0gQnVpbHQgbW9kZWwuXG4gICAqL1xuICBidWlsZChhdHRyaWJ1dGVzID0gLyoqIEB0eXBlIHtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzfSAqLyAoe30pKSB7XG4gICAgaWYgKCF0aGlzLnRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGNvbmZpZ3VyZWQgZm9yICR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge25ldyAoYXR0cmlidXRlcz86IFRhcmdldENyZWF0ZUF0dHJpYnV0ZXMpID0+IEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPn0gKi8gKHRoaXMudGFyZ2V0TW9kZWxDbGFzcylcbiAgICBjb25zdCBtb2RlbCA9IG5ldyBNb2RlbENsYXNzKGF0dHJpYnV0ZXMpXG5cbiAgICB0aGlzLmFkZFRvTG9hZGVkKFttb2RlbF0pXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3JjZS1yZWxvYWQgdGhlIHJlbGF0aW9uc2hpcC4gV2hlbiB0aGUgcGFyZW50IHJlY29yZCB3YXMgbG9hZGVkIGFzIHBhcnRcbiAgICogb2YgYSBiYXRjaCwgc2libGluZ3MgdGhhdCBoYXZlIG5vdCBwcmVsb2FkZWQgdGhpcyByZWxhdGlvbnNoaXAgZ2V0XG4gICAqIGJhdGNoZWQgaW50byBvbmUgcmVxdWVzdCB2aWEgdGhlIGNvaG9ydCBwcmVsb2FkZXIuIFRoZSBzY29wZWQgcXVlcnkgcGF0aFxuICAgKiAoYE1vZGVsLndoZXJlKC4uLikucHJlbG9hZChbbmFtZV0pLnRvQXJyYXkoKWAgZGlyZWN0bHkgZnJvbSB1c2VyIGNvZGUpXG4gICAqIGJ5cGFzc2VzIGNvaG9ydCBiYXRjaGluZyBieSBkZXNpZ24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj4+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgbW9kZWxzLlxuICAgKi9cbiAgYXN5bmMgbG9hZCgpIHtcbiAgICAvLyBSZXNldCBzbyB0aGUgY29ob3J0IHByZWxvYWRlciAob3Igc2luZ2xlLXJlY29yZCBmYWxsYmFjaykgcmVwb3B1bGF0ZXMuXG4gICAgdGhpcy5fcHJlbG9hZGVkID0gZmFsc2VcbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IFtdXG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5tb2RlbC5fdHJ5Q29ob3J0UHJlbG9hZCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoYmF0Y2hlZCkgcmV0dXJuIHRoaXMuX2xvYWRlZFZhbHVlXG5cbiAgICBhd2FpdCB0aGlzLm1vZGVsLmxvYWRSZWxhdGlvbnNoaXAodGhpcy5yZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgcmV0dXJuIHRoaXMubG9hZGVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIGFycmF5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+Pn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIG1vZGVscy5cbiAgICovXG4gIGFzeW5jIHRvQXJyYXkoKSB7XG4gICAgaWYgKHRoaXMuZ2V0UHJlbG9hZGVkKCkgfHwgdGhpcy5fbG9hZGVkVmFsdWUubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIHRoaXMuX2xvYWRlZFZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZCgpXG4gIH1cbn1cblxuLyoqXG4gKiBDb3BpZXMgbG9hZGVkIHJlbGF0aW9uc2hpcCBzdGF0ZSBiZXR3ZWVuIGhlbHBlcnMgb2YgdGhlIHNhbWUgcmVsYXRpb25zaGlwIHNoYXBlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXB9IGFyZ3Muc291cmNlUmVsYXRpb25zaGlwIC0gU291cmNlIHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXB9IGFyZ3MudGFyZ2V0UmVsYXRpb25zaGlwIC0gVGFyZ2V0IHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gY29weUxvYWRlZFJlbGF0aW9uc2hpcFZhbHVlKHtzb3VyY2VSZWxhdGlvbnNoaXAsIHRhcmdldFJlbGF0aW9uc2hpcH0pIHtcbiAgdGFyZ2V0UmVsYXRpb25zaGlwLmNvcHlMb2FkZWRGcm9tKHNvdXJjZVJlbGF0aW9uc2hpcClcbn1cblxuLyoqXG4gKiBSdW5zIHJlbGF0aW9uc2hpcCB0eXBlIGlzIGNvbGxlY3Rpb24uXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwVHlwZSAtIFJlbGF0aW9uc2hpcCB0eXBlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZWxhdGlvbnNoaXAgdHlwZSBpcyBoYXMtbWFueS5cbiAqL1xuZnVuY3Rpb24gcmVsYXRpb25zaGlwVHlwZUlzQ29sbGVjdGlvbihyZWxhdGlvbnNoaXBUeXBlKSB7XG4gIHJldHVybiByZWxhdGlvbnNoaXBUeXBlID09IFwiaGFzTWFueVwiXG59XG5cbi8qKlxuICogRG93bmxvYWRlZCBmcm9udGVuZC1tb2RlbCBhdHRhY2htZW50IHBheWxvYWQgd3JhcHBlci5cbiAqL1xuZXhwb3J0IGNsYXNzIEZyb250ZW5kTW9kZWxBdHRhY2htZW50RG93bmxvYWQge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pZCAtIEF0dGFjaG1lbnQgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZpbGVuYW1lIC0gRmlsZW5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gYXJncy5jb250ZW50VHlwZSAtIENvbnRlbnQgdHlwZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuYnl0ZVNpemUgLSBGaWxlIHNpemUgaW4gYnl0ZXMuXG4gICAqIEBwYXJhbSB7VWludDhBcnJheX0gYXJncy5jb250ZW50IC0gRmlsZSBjb250ZW50IGJ5dGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IFthcmdzLnVybF0gLSBSZXNvbHZhYmxlIGF0dGFjaG1lbnQgVVJMLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2J5dGVTaXplLCBjb250ZW50LCBjb250ZW50VHlwZSwgZmlsZW5hbWUsIGlkLCB1cmwgPSBudWxsfSkge1xuICAgIHRoaXMuaWRWYWx1ZSA9IGlkXG4gICAgdGhpcy5maWxlbmFtZVZhbHVlID0gZmlsZW5hbWVcbiAgICB0aGlzLmNvbnRlbnRUeXBlVmFsdWUgPSBjb250ZW50VHlwZVxuICAgIHRoaXMuYnl0ZVNpemVWYWx1ZSA9IGJ5dGVTaXplXG4gICAgdGhpcy5jb250ZW50VmFsdWUgPSBjb250ZW50XG4gICAgdGhpcy51cmxWYWx1ZSA9IHVybFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnl0ZSBzaXplLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEZpbGUgc2l6ZSBpbiBieXRlcy5cbiAgICovXG4gIGJ5dGVTaXplKCkgeyByZXR1cm4gdGhpcy5ieXRlU2l6ZVZhbHVlIH1cbiAgLyoqXG4gICAqIFJ1bnMgY29udGVudC5cbiAgICogQHJldHVybnMge1VpbnQ4QXJyYXl9IC0gRmlsZSBjb250ZW50IGJ5dGVzLlxuICAgKi9cbiAgY29udGVudCgpIHsgcmV0dXJuIHRoaXMuY29udGVudFZhbHVlIH1cbiAgLyoqXG4gICAqIFJ1bnMgY29udGVudCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBDb250ZW50IHR5cGUuXG4gICAqL1xuICBjb250ZW50VHlwZSgpIHsgcmV0dXJuIHRoaXMuY29udGVudFR5cGVWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIGZpbGVuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZpbGVuYW1lLlxuICAgKi9cbiAgZmlsZW5hbWUoKSB7IHJldHVybiB0aGlzLmZpbGVuYW1lVmFsdWUgfVxuICAvKipcbiAgICogUnVucyBpZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBdHRhY2htZW50IGlkLlxuICAgKi9cbiAgaWQoKSB7IHJldHVybiB0aGlzLmlkVmFsdWUgfVxuICAvKipcbiAgICogUnVucyB1cmwuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFJlc29sdmFibGUgYXR0YWNobWVudCBVUkwuXG4gICAqL1xuICB1cmwoKSB7IHJldHVybiB0aGlzLnVybFZhbHVlIH1cbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGF0dGFjaG1lbnQgY29tbWFuZCBwYXlsb2FkLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQXR0YWNobWVudEhhbmRsZX0gYXR0YWNobWVudCAtIEF0dGFjaG1lbnQgd3JhcHBlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXR0YWNobWVudElkXSAtIE9wdGlvbmFsIGhhcy1tYW55IGF0dGFjaG1lbnQgaWQuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENvbW1hbmQgcGF5bG9hZC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb21tYW5kUGF5bG9hZChhdHRhY2htZW50LCBhdHRhY2htZW50SWQpIHtcbiAgLyoqXG4gICAqIFBheWxvYWQuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgYXR0YWNobWVudE5hbWU6IGF0dGFjaG1lbnQuYXR0YWNobWVudE5hbWUsXG4gICAgaWQ6IGF0dGFjaG1lbnQubW9kZWwucHJpbWFyeUtleVZhbHVlKClcbiAgfVxuXG4gIGlmIChhdHRhY2htZW50SWQpIHBheWxvYWQuYXR0YWNobWVudElkID0gYXR0YWNobWVudElkXG5cbiAgcmV0dXJuIHBheWxvYWRcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgdmFsdWUgaXMgYnl0ZXMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWUgbG9va3MgbGlrZSBieXRlIGRhdGEuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNCeXRlcyh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgaW5zdGFuY2VvZiBVaW50OEFycmF5IHx8IHZhbHVlIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIgfHwgKHR5cGVvZiBCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIgJiYgQnVmZmVyLmlzQnVmZmVyKHZhbHVlKSlcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgdmFsdWUgc3VwcG9ydHMgYXJyYXkgYnVmZmVyLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7dmFsdWUgaXMge2FycmF5QnVmZmVyOiAoKSA9PiBQcm9taXNlPEFycmF5QnVmZmVyPn19IC0gV2hldGhlciBjYW5kaWRhdGUgc3VwcG9ydHMgYXJyYXlCdWZmZXIoKS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50VmFsdWVTdXBwb3J0c0FycmF5QnVmZmVyKHZhbHVlKSB7XG4gIHJldHVybiBCb29sZWFuKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHZhbHVlKS5hcnJheUJ1ZmZlciA9PT0gXCJmdW5jdGlvblwiKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgYXR0YWNobWVudCBub3JtYWxpemUgYnl0ZXMuXG4gKiBAcGFyYW0ge1VpbnQ4QXJyYXkgfCBCdWZmZXIgfCBBcnJheUJ1ZmZlcn0gdmFsdWUgLSBCeXRlLWxpa2UgdmFsdWUuXG4gKiBAcmV0dXJucyB7VWludDhBcnJheX0gLSBVaW50OEFycmF5IGJ5dGVzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZEF0dGFjaG1lbnROb3JtYWxpemVCeXRlcyh2YWx1ZSkge1xuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBVaW50OEFycmF5KSByZXR1cm4gdmFsdWVcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHJldHVybiBuZXcgVWludDhBcnJheSh2YWx1ZSlcbiAgaWYgKHR5cGVvZiBCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIgJiYgQnVmZmVyLmlzQnVmZmVyKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh2YWx1ZSkpKSB7XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KC8qKiBAdHlwZSB7QnVmZmVyfSAqLyAodmFsdWUpKVxuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiVW5zdXBwb3J0ZWQgYXR0YWNobWVudCBieXRlcyB2YWx1ZVwiKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgYXR0YWNobWVudCBieXRlcyB0byBiYXNlNjQuXG4gKiBAcGFyYW0ge1VpbnQ4QXJyYXl9IGJ5dGVzIC0gQnl0ZXMuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEJhc2U2NCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50Qnl0ZXNUb0Jhc2U2NChieXRlcykge1xuICBpZiAodHlwZW9mIEJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIHJldHVybiBCdWZmZXIuZnJvbShieXRlcykudG9TdHJpbmcoXCJiYXNlNjRcIilcbiAgfVxuXG4gIGxldCBiaW5hcnkgPSBcIlwiXG5cbiAgZm9yIChjb25zdCBieXRlIG9mIGJ5dGVzKSB7XG4gICAgYmluYXJ5ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZSlcbiAgfVxuXG4gIGlmICh0eXBlb2YgYnRvYSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJNaXNzaW5nIGJhc2U2NCBlbmNvZGVyXCIpXG5cbiAgcmV0dXJuIGJ0b2EoYmluYXJ5KVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgYXR0YWNobWVudCBiYXNlNjQgdG8gYnl0ZXMuXG4gKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBCYXNlNjQgdmFsdWUuXG4gKiBAcmV0dXJucyB7VWludDhBcnJheX0gLSBEZWNvZGVkIGJ5dGVzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZEF0dGFjaG1lbnRCYXNlNjRUb0J5dGVzKHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KEJ1ZmZlci5mcm9tKHZhbHVlLCBcImJhc2U2NFwiKSlcbiAgfVxuXG4gIGlmICh0eXBlb2YgYXRvYiAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJNaXNzaW5nIGJhc2U2NCBkZWNvZGVyXCIpXG5cbiAgY29uc3QgYmluYXJ5ID0gYXRvYih2YWx1ZSlcbiAgY29uc3QgYnl0ZXMgPSBuZXcgVWludDhBcnJheShiaW5hcnkubGVuZ3RoKVxuXG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBiaW5hcnkubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgYnl0ZXNbaW5kZXhdID0gYmluYXJ5LmNoYXJDb2RlQXQoaW5kZXgpXG4gIH1cblxuICByZXR1cm4gYnl0ZXNcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgdmFsdWUgaXMgcGxhaW4gb2JqZWN0LlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7dmFsdWUgaXMgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFdoZXRoZXIgdmFsdWUgaXMgcGxhaW4gb2JqZWN0LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzUGxhaW5PYmplY3QodmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZih2YWx1ZSlcblxuICByZXR1cm4gcHJvdG90eXBlID09PSBPYmplY3QucHJvdG90eXBlIHx8IHByb3RvdHlwZSA9PT0gbnVsbFxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcGF5bG9hZCBjb250YWlucyBhdHRhY2htZW50IHVwbG9hZC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gUGF5bG9hZCBjYW5kaWRhdGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHBheWxvYWQgY29udGFpbnMgYW4gYXR0YWNobWVudCB1cGxvYWQgYm9keS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFBheWxvYWRDb250YWluc0F0dGFjaG1lbnRVcGxvYWQodmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHJldHVybiB2YWx1ZS5zb21lKChlbnRyeSkgPT4gZnJvbnRlbmRNb2RlbFBheWxvYWRDb250YWluc0F0dGFjaG1lbnRVcGxvYWQoZW50cnkpKVxuICB9XG5cbiAgaWYgKCFmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzUGxhaW5PYmplY3QodmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICBpZiAodHlwZW9mIHZhbHVlLmNvbnRlbnRCYXNlNjQgPT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgcmV0dXJuIE9iamVjdC52YWx1ZXModmFsdWUpLnNvbWUoKGVudHJ5KSA9PiBmcm9udGVuZE1vZGVsUGF5bG9hZENvbnRhaW5zQXR0YWNobWVudFVwbG9hZChlbnRyeSkpXG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgY29uY3JldGUgZnJvbnRlbmQtbW9kZWwgY2xhc3MgZm9yIGFuIGluc3RhbmNlLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBGcm9udGVuZCBtb2RlbCBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQ2xhc3N9IENvbmNyZXRlIGZyb250ZW5kLW1vZGVsIGNsYXNzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQ2xhc3NGb3IobW9kZWwpIHtcbiAgY29uc3QgY29uc3RydWN0b3JWYWx1ZSA9IG1vZGVsLmNvbnN0cnVjdG9yXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbENsYXNzfSAqLyAoY29uc3RydWN0b3JWYWx1ZSlcbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSBjb25maWd1cmVkIG9mZmxpbmUgcXVldWUgc2hvdWxkIGhhbmRsZSBhIG1vZGVsIG9wZXJhdGlvbi5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IG9wZXJhdGlvbiAtIFN5bmMgb3BlcmF0aW9uLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0byBxdWV1ZSBsb2NhbGx5LlxuICovXG5mdW5jdGlvbiBzaG91bGRRdWV1ZUZyb250ZW5kTW9kZWxPcGVyYXRpb25PZmZsaW5lKE1vZGVsQ2xhc3MsIG9wZXJhdGlvbikge1xuICBjb25zdCBvZmZsaW5lU3luYyA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcub2ZmbGluZVN5bmNcblxuICBpZiAoIW9mZmxpbmVTeW5jPy5lbmFibGVkKSByZXR1cm4gZmFsc2VcblxuICBjb25zdCBzeW5jQ29uZmlnID0gTW9kZWxDbGFzcy5yZXNvdXJjZUNvbmZpZygpLnN5bmNcblxuICBpZiAoIXN5bmNDb25maWc/LmVuYWJsZWQpIHJldHVybiBmYWxzZVxuICBpZiAoIXN5bmNDb25maWcub3BlcmF0aW9ucy5pbmNsdWRlcyhvcGVyYXRpb24pKSB0aHJvdyBuZXcgRXJyb3IoYE9mZmxpbmUgc3luYyBmb3IgJHtNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfSBkb2VzIG5vdCBhbGxvdyAke29wZXJhdGlvbn1gKVxuXG4gIHJldHVybiB0cnVlXG59XG5cbi8qKlxuICogUXVldWVzIGFuIG9mZmxpbmUgc3luYyBtdXRhdGlvbi5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSBhcmdzLmF0dHJpYnV0ZXMgLSBNdXRhdGlvbiBhdHRyaWJ1dGVzLlxuICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmNsaWVudE11dGF0aW9uSWRdIC0gUHJlLWdlbmVyYXRlZCBtdXRhdGlvbiBpZC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBhcmdzLk1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYXJncy5vcGVyYXRpb24gLSBTeW5jIG9wZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gQ2xpZW50IG11dGF0aW9uIGlkLlxuICovXG5hc3luYyBmdW5jdGlvbiBxdWV1ZUZyb250ZW5kTW9kZWxNdXRhdGlvbk9mZmxpbmUoe2F0dHJpYnV0ZXMsIGNsaWVudE11dGF0aW9uSWQ6IHByb3ZpZGVkQ2xpZW50TXV0YXRpb25JZCwgTW9kZWxDbGFzcywgb3BlcmF0aW9ufSkge1xuICBjb25zdCBvZmZsaW5lU3luYyA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcub2ZmbGluZVN5bmNcblxuICBpZiAoIW9mZmxpbmVTeW5jKSB0aHJvdyBuZXcgRXJyb3IoXCJPZmZsaW5lIHN5bmMgaXMgbm90IGNvbmZpZ3VyZWRcIilcblxuICBjb25zdCBzeW5jQ29uZmlnID0gTW9kZWxDbGFzcy5yZXNvdXJjZUNvbmZpZygpLnN5bmNcbiAgaWYgKCFzeW5jQ29uZmlnPy5lbmFibGVkKSB0aHJvdyBuZXcgRXJyb3IoYE9mZmxpbmUgc3luYyBpcyBub3QgZW5hYmxlZCBmb3IgJHtNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfWApXG5cbiAgY29uc3Qgbm93ID0gb2ZmbGluZVN5bmMubm93ID8gb2ZmbGluZVN5bmMubm93KCkgOiBuZXcgRGF0ZSgpXG4gIGlmICghKG5vdyBpbnN0YW5jZW9mIERhdGUpIHx8IE51bWJlci5pc05hTihub3cuZ2V0VGltZSgpKSkgdGhyb3cgbmV3IEVycm9yKFwib2ZmbGluZVN5bmMubm93IG11c3QgcmV0dXJuIGEgdmFsaWQgRGF0ZVwiKVxuXG4gIGNvbnN0IGNsaWVudE11dGF0aW9uSWQgPSBwcm92aWRlZENsaWVudE11dGF0aW9uSWQgfHwgKG9mZmxpbmVTeW5jLmNsaWVudE11dGF0aW9uSWQgPyBvZmZsaW5lU3luYy5jbGllbnRNdXRhdGlvbklkKCkgOiBmcm9udGVuZE1vZGVsT2ZmbGluZU11dGF0aW9uSWQoKSlcbiAgaWYgKHR5cGVvZiBjbGllbnRNdXRhdGlvbklkICE9PSBcInN0cmluZ1wiIHx8IGNsaWVudE11dGF0aW9uSWQubGVuZ3RoIDwgMSkgdGhyb3cgbmV3IEVycm9yKFwib2ZmbGluZVN5bmMuY2xpZW50TXV0YXRpb25JZCBtdXN0IHJldHVybiBhIG5vbi1lbXB0eSBzdHJpbmdcIilcblxuICBhd2FpdCBvZmZsaW5lU3luYy5tdXRhdGlvbkxvZy5hcHBlbmQoe1xuICAgIG11dGF0aW9uOiB7XG4gICAgICBhY3RvckRldmljZUlkOiBvZmZsaW5lU3luYy5hY3RvckRldmljZUlkLFxuICAgICAgYWN0b3JVc2VySWQ6IG9mZmxpbmVTeW5jLmFjdG9yVXNlcklkLFxuICAgICAgYXR0cmlidXRlczogZnJvbnRlbmRNb2RlbFN5bmNKc29uT2JqZWN0KGF0dHJpYnV0ZXMpLFxuICAgICAgYmFzZVZlcnNpb246IG51bGwsXG4gICAgICBjbGllbnRNdXRhdGlvbklkLFxuICAgICAgbW9kZWw6IE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICBvY2N1cnJlZEF0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgIG9mZmxpbmVHcmFudElkOiBvZmZsaW5lU3luYy5vZmZsaW5lR3JhbnQuaWQsXG4gICAgICBvcGVyYXRpb24sXG4gICAgICBwb2xpY3lIYXNoOiBzeW5jQ29uZmlnLnBvbGljeUhhc2hcbiAgICB9XG4gIH0pXG5cbiAgcmV0dXJuIGNsaWVudE11dGF0aW9uSWRcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZXMgYSBmcm9udGVuZC1tb2RlbCBvZmZsaW5lIG11dGF0aW9uIGlkLlxuICogQHJldHVybnMge3N0cmluZ30gLSBMb2NhbCBtdXRhdGlvbiBpZC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbE9mZmxpbmVNdXRhdGlvbklkKCkge1xuICBpZiAoZ2xvYmFsVGhpcy5jcnlwdG8gJiYgdHlwZW9mIGdsb2JhbFRoaXMuY3J5cHRvLnJhbmRvbVVVSUQgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIGdsb2JhbFRoaXMuY3J5cHRvLnJhbmRvbVVVSUQoKVxuXG4gIHJldHVybiBgZnJvbnRlbmQtbXV0YXRpb24tJHtEYXRlLm5vdygpfS0ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMTYpLnNsaWNlKDIpfWBcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBtb2RlbCBhdHRyaWJ1dGVzIHRvIHN5bmMtc2FmZSBKU09OIHBheWxvYWQgdmFsdWVzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSBhdHRyaWJ1dGVzIC0gRnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gLSBTeW5jLXNhZmUgYXR0cmlidXRlcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFN5bmNKc29uT2JqZWN0KGF0dHJpYnV0ZXMpIHtcbiAgY29uc3Qgc2VyaWFsaXplZCA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoYXR0cmlidXRlcykpXG5cbiAgaWYgKCFzZXJpYWxpemVkIHx8IHR5cGVvZiBzZXJpYWxpemVkICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoc2VyaWFsaXplZCkpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHN5bmMgbXV0YXRpb24gYXR0cmlidXRlcyBvYmplY3RcIilcblxuICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gKi8gKHNlcmlhbGl6ZWQpXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgYXR0YWNobWVudCBpbnB1dC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGlucHV0IC0gQXR0YWNobWVudCBpbnB1dC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gVHJhbnNwb3J0LXNhZmUgYXR0YWNobWVudCBwYXlsb2FkLlxuICovXG5hc3luYyBmdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dChpbnB1dCkge1xuICBpZiAoZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KGlucHV0KSAmJiBcImZpbGVcIiBpbiBpbnB1dCkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRGaWxlID0gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQoaW5wdXQuZmlsZSlcbiAgICBjb25zdCBtZXJnZWQgPSB7XG4gICAgICAuLi5ub3JtYWxpemVkRmlsZVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgaW5wdXQuZmlsZW5hbWUgPT09IFwic3RyaW5nXCIgJiYgaW5wdXQuZmlsZW5hbWUubGVuZ3RoID4gMCkgbWVyZ2VkLmZpbGVuYW1lID0gaW5wdXQuZmlsZW5hbWVcbiAgICBpZiAodHlwZW9mIGlucHV0LmNvbnRlbnRUeXBlID09PSBcInN0cmluZ1wiICYmIGlucHV0LmNvbnRlbnRUeXBlLmxlbmd0aCA+IDApIG1lcmdlZC5jb250ZW50VHlwZSA9IGlucHV0LmNvbnRlbnRUeXBlXG5cbiAgICByZXR1cm4gbWVyZ2VkXG4gIH1cblxuICBpZiAoZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KGlucHV0KSkge1xuICAgIGlmICh0eXBlb2YgaW5wdXQucGF0aCA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5wYXRoLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkF0dGFjaG1lbnQgcGF0aCBpbnB1dCBpcyBub3Qgc3VwcG9ydGVkIGluIGZyb250ZW5kIG1vZGVsc1wiKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgaW5wdXQuY29udGVudEJhc2U2NCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29udGVudEJhc2U2NDogaW5wdXQuY29udGVudEJhc2U2NCxcbiAgICAgICAgY29udGVudFR5cGU6IHR5cGVvZiBpbnB1dC5jb250ZW50VHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5jb250ZW50VHlwZS5sZW5ndGggPiAwID8gaW5wdXQuY29udGVudFR5cGUgOiBudWxsLFxuICAgICAgICBmaWxlbmFtZTogdHlwZW9mIGlucHV0LmZpbGVuYW1lID09PSBcInN0cmluZ1wiICYmIGlucHV0LmZpbGVuYW1lLmxlbmd0aCA+IDAgPyBpbnB1dC5maWxlbmFtZSA6IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmIChmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZVN1cHBvcnRzQXJyYXlCdWZmZXIoaW5wdXQpKSB7XG4gICAgY29uc3QgYnl0ZXMgPSBuZXcgVWludDhBcnJheShhd2FpdCBpbnB1dC5hcnJheUJ1ZmZlcigpKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnRlbnRCYXNlNjQ6IGZyb250ZW5kQXR0YWNobWVudEJ5dGVzVG9CYXNlNjQoYnl0ZXMpLFxuICAgICAgY29udGVudFR5cGU6IHR5cGVvZiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoaW5wdXQpLnR5cGUgPT09IFwic3RyaW5nXCIgJiYgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS50eXBlLmxlbmd0aCA+IDBcbiAgICAgICAgPyAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoaW5wdXQpLnR5cGVcbiAgICAgICAgOiBudWxsLFxuICAgICAgZmlsZW5hbWU6IHR5cGVvZiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoaW5wdXQpLm5hbWUgPT09IFwic3RyaW5nXCIgJiYgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS5uYW1lLmxlbmd0aCA+IDBcbiAgICAgICAgPyAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoaW5wdXQpLm5hbWVcbiAgICAgICAgOiBcImF0dGFjaG1lbnQuYmluXCJcbiAgICB9XG4gIH1cblxuICBpZiAoZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc0J5dGVzKGlucHV0KSkge1xuICAgIGNvbnN0IGJ5dGVzID0gZnJvbnRlbmRBdHRhY2htZW50Tm9ybWFsaXplQnl0ZXMoLyoqIEB0eXBlIHtVaW50OEFycmF5IHwgQnVmZmVyIHwgQXJyYXlCdWZmZXJ9ICovIChpbnB1dCkpXG5cbiAgICByZXR1cm4ge1xuICAgICAgY29udGVudEJhc2U2NDogZnJvbnRlbmRBdHRhY2htZW50Qnl0ZXNUb0Jhc2U2NChieXRlcyksXG4gICAgICBjb250ZW50VHlwZTogbnVsbCxcbiAgICAgIGZpbGVuYW1lOiBcImF0dGFjaG1lbnQuYmluXCJcbiAgICB9XG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoXCJVbnN1cHBvcnRlZCBmcm9udGVuZCBhdHRhY2htZW50IGlucHV0XCIpXG59XG5cbi8qKlxuICogRnJvbnRlbmQtbW9kZWwgYXR0YWNobWVudCBoZWxwZXIgZm9yIG9uZSBhdHRhY2htZW50IG5hbWUuXG4gKi9cbmV4cG9ydCBjbGFzcyBGcm9udGVuZE1vZGVsQXR0YWNobWVudEhhbmRsZSB7XG4gIC8qKlxuICAgKiBQZW5kaW5nIGF0dGFjaG1lbnQgaW5wdXRzIHF1ZXVlZCBmb3IgdGhlIG5leHQgbW9kZWwgc2F2ZS5cbiAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxBdHRhY2htZW50SW5wdXRbXX1cbiAgICovXG4gIHBlbmRpbmdJbnB1dHMgPSBbXVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7YXR0YWNobWVudE5hbWUsIG1vZGVsfSkge1xuICAgIHRoaXMubW9kZWwgPSBtb2RlbFxuICAgIHRoaXMuYXR0YWNobWVudE5hbWUgPSBhdHRhY2htZW50TmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFF1ZXVlIGF0dGFjaG1lbnQgaW5wdXQgZm9yIHRoZSBwYXJlbnQgbW9kZWwncyBuZXh0IHNhdmUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRJbnB1dCB8IEZyb250ZW5kTW9kZWxBdHRhY2htZW50SW5wdXRbXX0gaW5wdXQgLSBBdHRhY2htZW50IGlucHV0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHF1ZXVlQXR0YWNoKGlucHV0KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbih0aGlzLmF0dGFjaG1lbnROYW1lKVxuXG4gICAgaWYgKGF0dGFjaG1lbnREZWZpbml0aW9uPy50eXBlID09PSBcImhhc09uZVwiKSB7XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShpbnB1dCkpIHtcbiAgICAgICAgY29uc3QgbGFzdElucHV0ID0gaW5wdXRbaW5wdXQubGVuZ3RoIC0gMV1cblxuICAgICAgICB0aGlzLnBlbmRpbmdJbnB1dHMgPSB0eXBlb2YgbGFzdElucHV0ID09PSBcInVuZGVmaW5lZFwiID8gW10gOiBbbGFzdElucHV0XVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nSW5wdXRzID0gW2lucHV0XVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoaW5wdXQpKSB7XG4gICAgICB0aGlzLnBlbmRpbmdJbnB1dHMucHVzaCguLi5pbnB1dClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5wZW5kaW5nSW5wdXRzLnB1c2goaW5wdXQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhpcyBhdHRhY2htZW50IGhhcyBxdWV1ZWQgaW5wdXRzIGZvciB0aGUgbmV4dCBtb2RlbCBzYXZlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBhbnkgcGVuZGluZyBpbnB1dHMgZXhpc3QuXG4gICAqL1xuICBoYXNQZW5kaW5nQXR0YWNobWVudHMoKSB7XG4gICAgcmV0dXJuIHRoaXMucGVuZGluZ0lucHV0cy5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBzYXZlIHBheWxvYWQgZm9yIHF1ZXVlZCBhdHRhY2htZW50IGlucHV0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W10gfCB1bmRlZmluZWQ+fSBOb3JtYWxpemVkIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIHBlbmRpbmdBdHRhY2htZW50c1BheWxvYWQoKSB7XG4gICAgaWYgKHRoaXMucGVuZGluZ0lucHV0cy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24odGhpcy5hdHRhY2htZW50TmFtZSlcblxuICAgIGlmIChhdHRhY2htZW50RGVmaW5pdGlvbj8udHlwZSA9PT0gXCJoYXNNYW55XCIpIHtcbiAgICAgIHJldHVybiBhd2FpdCBQcm9taXNlLmFsbCh0aGlzLnBlbmRpbmdJbnB1dHMubWFwKGFzeW5jIChpbnB1dCkgPT4gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQoaW5wdXQpKSlcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQodGhpcy5wZW5kaW5nSW5wdXRzW3RoaXMucGVuZGluZ0lucHV0cy5sZW5ndGggLSAxXSlcbiAgfVxuXG4gIC8qKiBDbGVhcnMgcXVldWVkIGF0dGFjaG1lbnQgaW5wdXRzIGFmdGVyIGEgc3VjY2Vzc2Z1bCBtb2RlbCBzYXZlLiAqL1xuICBjbGVhclBlbmRpbmdBdHRhY2htZW50cygpIHtcbiAgICB0aGlzLnBlbmRpbmdJbnB1dHMgPSBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNoLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBpbnB1dCAtIEF0dGFjaG1lbnQgaW5wdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYXR0YWNoZWQuXG4gICAqL1xuICBhc3luYyBhdHRhY2goaW5wdXQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3Qgbm9ybWFsaXplZElucHV0ID0gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQoaW5wdXQpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiYXR0YWNoXCIsIHtcbiAgICAgIGF0dGFjaG1lbnQ6IG5vcm1hbGl6ZWRJbnB1dCxcbiAgICAgIGF0dGFjaG1lbnROYW1lOiB0aGlzLmF0dGFjaG1lbnROYW1lLFxuICAgICAgaWQ6IHRoaXMubW9kZWwucHJpbWFyeUtleVZhbHVlKClcbiAgICB9KVxuXG4gICAgdGhpcy5tb2RlbC5hc3NpZ25BdHRyaWJ1dGVzKE1vZGVsQ2xhc3MuYXR0cmlidXRlc0Zyb21SZXNwb25zZShyZXNwb25zZSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkb3dubG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthdHRhY2htZW50SWRdIC0gT3B0aW9uYWwgYXR0YWNobWVudCBpZCBmb3IgaGFzLW1hbnkgYXR0YWNobWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxBdHRhY2htZW50RG93bmxvYWQgfCBudWxsPn0gLSBEb3dubG9hZGVkIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIGRvd25sb2FkKGF0dGFjaG1lbnRJZCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IE1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJkb3dubG9hZFwiLCBmcm9udGVuZE1vZGVsQXR0YWNobWVudENvbW1hbmRQYXlsb2FkKHRoaXMsIGF0dGFjaG1lbnRJZCkpXG4gICAgY29uc3QgYXR0YWNobWVudFBheWxvYWQgPSByZXNwb25zZS5hdHRhY2htZW50XG5cbiAgICBpZiAoIWF0dGFjaG1lbnRQYXlsb2FkIHx8IHR5cGVvZiBhdHRhY2htZW50UGF5bG9hZCAhPT0gXCJvYmplY3RcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGNvbnRlbnRCYXNlNjQgPSB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQuY29udGVudEJhc2U2NCA9PT0gXCJzdHJpbmdcIiA/IGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRCYXNlNjQgOiBcIlwiXG4gICAgY29uc3QgY29udGVudCA9IGZyb250ZW5kQXR0YWNobWVudEJhc2U2NFRvQnl0ZXMoY29udGVudEJhc2U2NClcbiAgICBjb25zdCBieXRlU2l6ZSA9IE51bWJlcihhdHRhY2htZW50UGF5bG9hZC5ieXRlU2l6ZSlcblxuICAgIHJldHVybiBuZXcgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREb3dubG9hZCh7XG4gICAgICBieXRlU2l6ZTogTnVtYmVyLmlzRmluaXRlKGJ5dGVTaXplKSA/IGJ5dGVTaXplIDogY29udGVudC5sZW5ndGgsXG4gICAgICBjb250ZW50LFxuICAgICAgY29udGVudFR5cGU6IHR5cGVvZiBhdHRhY2htZW50UGF5bG9hZC5jb250ZW50VHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50UGF5bG9hZC5jb250ZW50VHlwZS5sZW5ndGggPiAwID8gYXR0YWNobWVudFBheWxvYWQuY29udGVudFR5cGUgOiBudWxsLFxuICAgICAgZmlsZW5hbWU6IHR5cGVvZiBhdHRhY2htZW50UGF5bG9hZC5maWxlbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50UGF5bG9hZC5maWxlbmFtZS5sZW5ndGggPiAwID8gYXR0YWNobWVudFBheWxvYWQuZmlsZW5hbWUgOiBcImF0dGFjaG1lbnQuYmluXCIsXG4gICAgICBpZDogdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLmlkID09PSBcInN0cmluZ1wiID8gYXR0YWNobWVudFBheWxvYWQuaWQgOiBcIlwiLFxuICAgICAgdXJsOiB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQudXJsID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnRQYXlsb2FkLnVybC5sZW5ndGggPiAwID8gYXR0YWNobWVudFBheWxvYWQudXJsIDogbnVsbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cmwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXR0YWNobWVudElkXSAtIE9wdGlvbmFsIGF0dGFjaG1lbnQgaWQgZm9yIGhhcy1tYW55IGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBSZXNvbHZhYmxlIGF0dGFjaG1lbnQgVVJMLlxuICAgKi9cbiAgYXN5bmMgdXJsKGF0dGFjaG1lbnRJZCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IE1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJ1cmxcIiwgZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb21tYW5kUGF5bG9hZCh0aGlzLCBhdHRhY2htZW50SWQpKVxuXG4gICAgaWYgKHR5cGVvZiByZXNwb25zZS51cmwgPT09IFwic3RyaW5nXCIgJiYgcmVzcG9uc2UudXJsLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiByZXNwb25zZS51cmxcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHF1ZXJ5IGZvciB0aGlzIGF0dGFjaG1lbnQgaGFuZGxlJ3MgbWV0YWRhdGEgcm93cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgVmVsb2Npb3VzQXR0YWNobWVudD59IC0gQXR0YWNobWVudCBtZXRhZGF0YSBxdWVyeS5cbiAgICovXG4gIHF1ZXJ5KCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcblxuICAgIHJldHVybiBWZWxvY2lvdXNBdHRhY2htZW50XG4gICAgICAud2hlcmUoe1xuICAgICAgICBuYW1lOiB0aGlzLmF0dGFjaG1lbnROYW1lLFxuICAgICAgICByZWNvcmRJZDogbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIHRoaXMubW9kZWwucHJpbWFyeUtleVZhbHVlKCkpLFxuICAgICAgICByZWNvcmRUeXBlOiBNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG4gICAgICB9KVxuICAgICAgLm9yZGVyKFtbXCJwb3NpdGlvblwiLCBcImFzY1wiXV0pXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgYWxsIGF0dGFjaG1lbnQgbWV0YWRhdGEgcm93cyBmb3IgdGhpcyBoYW5kbGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFZlbG9jaW91c0F0dGFjaG1lbnRbXT59IC0gQXR0YWNobWVudCBtZXRhZGF0YSByb3dzLlxuICAgKi9cbiAgYXN5bmMgdG9BcnJheSgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLnRvQXJyYXkoKVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIHRoZSBmaXJzdCBhdHRhY2htZW50IG1ldGFkYXRhIHJvdyBmb3IgdGhpcyBoYW5kbGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFZlbG9jaW91c0F0dGFjaG1lbnQgfCBudWxsPn0gLSBGaXJzdCBhdHRhY2htZW50IG1ldGFkYXRhIHJvdy5cbiAgICovXG4gIGFzeW5jIGZpcnN0KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmlyc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGlzdC4gUmV0dXJucyBtZXRhZGF0YSBmb3IgZXZlcnkgYXR0YWNobWVudCB1bmRlciB0aGlzIGF0dGFjaG1lbnQgbmFtZVxuICAgKiAobm8gY29udGVudCBieXRlcyksIHNvIGNhbGxlcnMgY2FuIGVudW1lcmF0ZSBoYXMtbWFueSBhdHRhY2htZW50cyBhbmQgdGhlblxuICAgKiBkb3dubG9hZCBvciBsaW5rIHRvIGVhY2ggb25lIGJ5IGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTx7Ynl0ZVNpemU6IG51bWJlciwgY29udGVudFR5cGU6IHN0cmluZyB8IG51bGwsIGZpbGVuYW1lOiBzdHJpbmcsIGlkOiBzdHJpbmcsIHVybDogc3RyaW5nIHwgbnVsbH0+Pn0gLSBBdHRhY2htZW50IG1ldGFkYXRhIGVudHJpZXMuXG4gICAqL1xuICBhc3luYyBsaXN0KCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IE1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJhdHRhY2htZW50TGlzdFwiLCBmcm9udGVuZE1vZGVsQXR0YWNobWVudENvbW1hbmRQYXlsb2FkKHRoaXMpKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gQXJyYXkuaXNBcnJheShyZXNwb25zZS5hdHRhY2htZW50cykgPyByZXNwb25zZS5hdHRhY2htZW50cyA6IFtdXG5cbiAgICByZXR1cm4gYXR0YWNobWVudHMubWFwKChhdHRhY2htZW50KSA9PiB7XG4gICAgICBjb25zdCBieXRlU2l6ZSA9IE51bWJlcihhdHRhY2htZW50LmJ5dGVTaXplKVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBieXRlU2l6ZTogTnVtYmVyLmlzRmluaXRlKGJ5dGVTaXplKSA/IGJ5dGVTaXplIDogMCxcbiAgICAgICAgY29udGVudFR5cGU6IHR5cGVvZiBhdHRhY2htZW50LmNvbnRlbnRUeXBlID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnQuY29udGVudFR5cGUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnQuY29udGVudFR5cGUgOiBudWxsLFxuICAgICAgICBmaWxlbmFtZTogdHlwZW9mIGF0dGFjaG1lbnQuZmlsZW5hbWUgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudC5maWxlbmFtZS5sZW5ndGggPiAwID8gYXR0YWNobWVudC5maWxlbmFtZSA6IFwiYXR0YWNobWVudC5iaW5cIixcbiAgICAgICAgaWQ6IHR5cGVvZiBhdHRhY2htZW50LmlkID09PSBcInN0cmluZ1wiID8gYXR0YWNobWVudC5pZCA6IFwiXCIsXG4gICAgICAgIHVybDogdHlwZW9mIGF0dGFjaG1lbnQudXJsID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnQudXJsLmxlbmd0aCA+IDAgPyBhdHRhY2htZW50LnVybCA6IG51bGxcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZG93bmxvYWQgdXJsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERvd25sb2FkIFVSTCBmb3IgdGhpcyBhdHRhY2htZW50IG9uIHRoZSBjb25maWd1cmVkIGJhY2tlbmQuXG4gICAqL1xuICBkb3dubG9hZFVybCgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgY29tbWFuZE5hbWUgPSBNb2RlbENsYXNzLmNvbW1hbmROYW1lKFwiZG93bmxvYWRcIilcbiAgICBjb25zdCByZXNvdXJjZVBhdGggPSBNb2RlbENsYXNzLnJlc291cmNlUGF0aCgpXG4gICAgY29uc3QgY29tbWFuZFVybCA9IGZyb250ZW5kTW9kZWxDb21tYW5kVXJsKHJlc291cmNlUGF0aCwgY29tbWFuZE5hbWUpXG4gICAgY29uc3QgcGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcyh7XG4gICAgICBhdHRhY2htZW50TmFtZTogdGhpcy5hdHRhY2htZW50TmFtZSxcbiAgICAgIGlkOiBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgdGhpcy5tb2RlbC5wcmltYXJ5S2V5VmFsdWUoKSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIGAke2NvbW1hbmRVcmx9PyR7cGFyYW1zLnRvU3RyaW5nKCl9YFxuICB9XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHVybC5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbH0gdmFsdWUgLSBVUkwgY2FuZGlkYXRlLlxuICogQHJldHVybnMge3N0cmluZ30gLSBOb3JtYWxpemVkIFVSTCB3aXRob3V0IHRyYWlsaW5nIHNsYXNoLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VXJsKHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiBcIlwiXG5cbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKVxuXG4gIGlmICghdHJpbW1lZC5sZW5ndGgpIHJldHVybiBcIlwiXG5cbiAgcmV0dXJuIHRyaW1tZWQucmVwbGFjZSgvXFwvKyQvLCBcIlwiKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHVybC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUmVzb2x2ZWQgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IFVSTC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybCgpIHtcbiAgY29uc3QgY29uZmlndXJlZFVybCA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnVybCA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnVybCgpXG4gICAgOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnVybFxuXG4gIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VXJsKGNvbmZpZ3VyZWRVcmwpXG59XG5cbi8qKlxuICogUnVucyBjbG9uZSBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGVzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHZhbHVlIC0gQXR0cmlidXRlcyBoYXNoLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDbG9uZWQgYXR0cmlidXRlcyBoYXNoLlxuICovXG5mdW5jdGlvbiBjbG9uZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKHZhbHVlKSB7XG4gIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh2YWx1ZSkpKVxufVxuXG4vKipcbiAqIFNoYXJlZCBjaGFubmVsIG5hbWUgZm9yIG1vZGVsIGxpZmVjeWNsZSBldmVudHMgKFBoYXNlIDMpLlxuICogTWF0Y2hlcyB0aGUgYmFja2VuZCBgRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRWAuXG4gKi9cbmNvbnN0IEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUgPSBcImZyb250ZW5kLW1vZGVsc1wiXG5cbi8qKlxuICogUnVucyBtZXJnZSBmcm9udGVuZCBtb2RlbCBldmVudCBwcmVsb2FkLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IHRhcmdldCAtIFRhcmdldCBwcmVsb2FkIHBheWxvYWQuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gc291cmNlIC0gU291cmNlIHByZWxvYWQgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByZWxvYWQodGFyZ2V0LCBzb3VyY2UpIHtcbiAgZm9yIChjb25zdCBbcmVsYXRpb25zaGlwTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZSkpIHtcbiAgICBjb25zdCBleGlzdGluZ1ZhbHVlID0gdGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICBpZiAodmFsdWUgPT09IHRydWUgfHwgdmFsdWUgPT09IGZhbHNlKSB7XG4gICAgICBpZiAoZXhpc3RpbmdWYWx1ZSA9PT0gdW5kZWZpbmVkKSB0YXJnZXRbcmVsYXRpb25zaGlwTmFtZV0gPSB2YWx1ZVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdID0gdmFsdWVcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCFleGlzdGluZ1ZhbHVlIHx8IHR5cGVvZiBleGlzdGluZ1ZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZXhpc3RpbmdWYWx1ZSkpIHtcbiAgICAgIHRhcmdldFtyZWxhdGlvbnNoaXBOYW1lXSA9IHt9XG4gICAgfVxuXG4gICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRQcmVsb2FkKFxuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovICh0YXJnZXRbcmVsYXRpb25zaGlwTmFtZV0pLFxuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovICh2YWx1ZSlcbiAgICApXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG1lcmdlIGZyb250ZW5kIG1vZGVsIGV2ZW50IHNlbGVjdC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSB0YXJnZXQgLSBUYXJnZXQgc2VsZWN0IG1hcC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSBzb3VyY2UgLSBTb3VyY2Ugc2VsZWN0IG1hcC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFNlbGVjdCh0YXJnZXQsIHNvdXJjZSkge1xuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIGF0dHJpYnV0ZXNdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZSkpIHtcbiAgICBjb25zdCBleGlzdGluZ0F0dHJpYnV0ZXMgPSB0YXJnZXRbbW9kZWxOYW1lXSB8fCBbXVxuXG4gICAgdGFyZ2V0W21vZGVsTmFtZV0gPSBBcnJheS5mcm9tKG5ldyBTZXQoZXhpc3RpbmdBdHRyaWJ1dGVzLmNvbmNhdChhdHRyaWJ1dGVzKSkpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG1lcmdlIHVuaXF1ZSBmcm9udGVuZCBtb2RlbCBldmVudCBlbnRyaWVzLlxuICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxXaXRoQ291bnRQYXlsb2FkRW50cnkgfCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxBYmlsaXRpZXNQYXlsb2FkRW50cnk+fSB0YXJnZXQgLSBUYXJnZXQgYXJyYXkuXG4gKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFdpdGhDb3VudFBheWxvYWRFbnRyeSB8IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEFiaWxpdGllc1BheWxvYWRFbnRyeT59IHNvdXJjZSAtIFNvdXJjZSBhcnJheS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZVVuaXF1ZUZyb250ZW5kTW9kZWxFdmVudEVudHJpZXModGFyZ2V0LCBzb3VyY2UpIHtcbiAgY29uc3QgZXhpc3RpbmdLZXlzID0gbmV3IFNldCh0YXJnZXQubWFwKChlbnRyeSkgPT4gSlNPTi5zdHJpbmdpZnkoZW50cnkpKSlcblxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIHNvdXJjZSkge1xuICAgIGNvbnN0IGtleSA9IEpTT04uc3RyaW5naWZ5KGVudHJ5KVxuXG4gICAgaWYgKGV4aXN0aW5nS2V5cy5oYXMoa2V5KSkgY29udGludWVcblxuICAgIHRhcmdldC5wdXNoKGVudHJ5KVxuICAgIGV4aXN0aW5nS2V5cy5hZGQoa2V5KVxuICB9XG59XG5cbi8qKlxuICogUnVucyBtZXJnZSBmcm9udGVuZCBtb2RlbCBldmVudCBwcm9qZWN0aW9uIHBheWxvYWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfSB0YXJnZXQgLSBUYXJnZXQgcGF5bG9hZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9IHNvdXJjZSAtIFNvdXJjZSBwYXlsb2FkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50UHJvamVjdGlvblBheWxvYWQodGFyZ2V0LCBzb3VyY2UpIHtcbiAgaWYgKHNvdXJjZS5wcmVsb2FkKSB7XG4gICAgaWYgKCF0YXJnZXQucHJlbG9hZCkgdGFyZ2V0LnByZWxvYWQgPSB7fVxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50UHJlbG9hZCh0YXJnZXQucHJlbG9hZCwgc291cmNlLnByZWxvYWQpXG4gIH1cblxuICBpZiAoc291cmNlLnNlbGVjdCkge1xuICAgIGlmICghdGFyZ2V0LnNlbGVjdCkgdGFyZ2V0LnNlbGVjdCA9IHt9XG4gICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRTZWxlY3QodGFyZ2V0LnNlbGVjdCwgc291cmNlLnNlbGVjdClcbiAgfVxuXG4gIGlmIChzb3VyY2Uuc2VsZWN0c0V4dHJhKSB7XG4gICAgaWYgKCF0YXJnZXQuc2VsZWN0c0V4dHJhKSB0YXJnZXQuc2VsZWN0c0V4dHJhID0ge31cbiAgICBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFNlbGVjdCh0YXJnZXQuc2VsZWN0c0V4dHJhLCBzb3VyY2Uuc2VsZWN0c0V4dHJhKVxuICB9XG5cbiAgaWYgKHNvdXJjZS53aXRoQ291bnQpIHtcbiAgICBpZiAoIXRhcmdldC53aXRoQ291bnQpIHRhcmdldC53aXRoQ291bnQgPSBbXVxuICAgIG1lcmdlVW5pcXVlRnJvbnRlbmRNb2RlbEV2ZW50RW50cmllcyh0YXJnZXQud2l0aENvdW50LCBzb3VyY2Uud2l0aENvdW50KVxuICB9XG5cbiAgaWYgKHNvdXJjZS5hYmlsaXRpZXMpIHtcbiAgICBpZiAoIXRhcmdldC5hYmlsaXRpZXMpIHRhcmdldC5hYmlsaXRpZXMgPSBbXVxuICAgIG1lcmdlVW5pcXVlRnJvbnRlbmRNb2RlbEV2ZW50RW50cmllcyh0YXJnZXQuYWJpbGl0aWVzLCBzb3VyY2UuYWJpbGl0aWVzKVxuICB9XG5cbiAgaWYgKHNvdXJjZS5xdWVyeURhdGEgIT09IHVuZGVmaW5lZCkge1xuICAgIGNvbnN0IHRhcmdldFF1ZXJ5RGF0YSA9IEFycmF5LmlzQXJyYXkodGFyZ2V0LnF1ZXJ5RGF0YSkgPyB0YXJnZXQucXVlcnlEYXRhIDogW11cblxuICAgIHRhcmdldC5xdWVyeURhdGEgPSB0YXJnZXRRdWVyeURhdGFcbiAgICBjb25zdCBxdWVyeURhdGFFbnRyaWVzID0gQXJyYXkuaXNBcnJheShzb3VyY2UucXVlcnlEYXRhKSA/IHNvdXJjZS5xdWVyeURhdGEgOiBbc291cmNlLnF1ZXJ5RGF0YV1cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcXVlcnlEYXRhRW50cmllcykge1xuICAgICAgdGFyZ2V0UXVlcnlEYXRhLnB1c2goZW50cnkpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBtYXRjaGVkIGV2ZW50IGZpbHRlciBrZXlzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keSAtIFJhdyB3ZWJzb2NrZXQgZXZlbnQgYm9keS5cbiAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBNYXRjaGVkIGV2ZW50IGZpbHRlciBrZXlzIGRlbGl2ZXJlZCBieSB0aGUgYmFja2VuZC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbE1hdGNoZWRFdmVudEZpbHRlcktleXMoYm9keSkge1xuICBpZiAoIWJvZHkgfHwgdHlwZW9mIGJvZHkgIT09IFwib2JqZWN0XCIpIHJldHVybiBuZXcgU2V0KClcblxuICBjb25zdCBrZXlzID0gLyoqIEB0eXBlIHt7bWF0Y2hlZEV2ZW50RmlsdGVyS2V5cz86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gKi8gKGJvZHkpLm1hdGNoZWRFdmVudEZpbHRlcktleXNcblxuICBpZiAoIUFycmF5LmlzQXJyYXkoa2V5cykpIHJldHVybiBuZXcgU2V0KClcblxuICByZXR1cm4gbmV3IFNldChrZXlzLm1hcCgoa2V5KSA9PiBTdHJpbmcoa2V5KSkpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBldmVudCBlbnRyeSBtYXRjaGVzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnl9IGVudHJ5IC0gQ2FsbGJhY2sgZW50cnkuXG4gKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzIC0gQmFja2VuZCBtYXRjaGVkIGZpbHRlciBrZXlzLlxuICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIGNhbGxiYWNrIHNob3VsZCByZWNlaXZlIHRoZSBldmVudC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEV2ZW50RW50cnlNYXRjaGVzKGVudHJ5LCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKSB7XG4gIGlmICghZW50cnkuZXZlbnRGaWx0ZXJLZXkpIHJldHVybiB0cnVlXG5cbiAgcmV0dXJuIG1hdGNoZWRFdmVudEZpbHRlcktleXMuaGFzKGVudHJ5LmV2ZW50RmlsdGVyS2V5KVxufVxuXG4vKipcbiAqIFJ1bnMgYXNzZXJ0IG5vIGRlc3Ryb3kgZXZlbnQgZmlsdGVyLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBFdmVudCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBvcHRpb25zIC0gRXZlbnQgb3B0aW9ucy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnROb0Rlc3Ryb3lFdmVudEZpbHRlcihNb2RlbENsYXNzLCBvcHRpb25zKSB7XG4gIGNvbnN0IGV2ZW50T3B0aW9uc1BheWxvYWQgPSBmcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZChNb2RlbENsYXNzLCBvcHRpb25zKVxuXG4gIGlmICghZXZlbnRPcHRpb25zUGF5bG9hZC5ldmVudEZpbHRlcktleSkgcmV0dXJuXG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgZGVzdHJveSBldmVudCBzdWJzY3JpcHRpb25zIGRvIG5vdCBzdXBwb3J0IHF1ZXJ5IGZpbHRlcnNcIilcbn1cblxuLyoqXG4gKiBQZXItbW9kZWwgY2xhc3Mgc2luZ2xldG9uIHRoYXQgbXVsdGlwbGV4ZXMgYWxsIHJlZ2lzdGVyZWQgb25DcmVhdGUgL1xuICogb25VcGRhdGUgLyBvbkRlc3Ryb3kgY2FsbGJhY2tzIOKAlCBjbGFzcy1sZXZlbCArIGluc3RhbmNlLWxldmVsIOKAlFxuICogb3ZlciBvbmUgV2Vic29ja2V0Q2hhbm5lbFYyIHN1YnNjcmlwdGlvbi4gU3Vic2NyaXB0aW9uIG9wZW5zIG9uIHRoZVxuICogZmlyc3QgbGlzdGVuZXIgYW5kIGNsb3NlcyB3aGVuIHRoZSBsYXN0IG9uZSB1bnN1YnNjcmliZXMuXG4gKlxuICogSW5zdGFuY2UtbGV2ZWwgbGlzdGVuZXJzIGFsc28gcmVjZWl2ZSBhdXRvLW1lcmdlOiB3aGVuIGFuIGB1cGRhdGVgXG4gKiBldmVudCBhcnJpdmVzIGZvciBhIHJlZ2lzdGVyZWQgaW5zdGFuY2UgaWQsIHRoZSBpbnN0YW5jZSdzXG4gKiBhdHRyaWJ1dGVzIGFyZSB1cGRhdGVkIGluIHBsYWNlIGJlZm9yZSB0aGUgY2FsbGJhY2sgZmlyZXMsIHNvXG4gKiBjYWxsZXJzIGNhbiByZWFkIGZyZXNoIHZhbHVlcyBmcm9tIHRoZSBzYW1lIGluc3RhbmNlIGhhbmRsZS5cbiAqL1xuY2xhc3MgRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MgZm9yIHRoaXMgc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0fSByZXF1ZXN0Q29udGV4dCAtIENhcHR1cmVkIHN1YnNjcmlwdGlvbiBjb250ZXh0LlxuICAgKi9cbiAgY29uc3RydWN0b3IoTW9kZWxDbGFzcywgcmVxdWVzdENvbnRleHQpIHtcbiAgICB0aGlzLk1vZGVsQ2xhc3MgPSBNb2RlbENsYXNzXG4gICAgdGhpcy5yZXF1ZXN0Q29udGV4dCA9IHJlcXVlc3RDb250ZXh0XG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtTZXQ8RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5Pn0gKi9cbiAgICB0aGlzLmNsYXNzQ3JlYXRlQ2FsbGJhY2tzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtTZXQ8RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5Pn0gKi9cbiAgICB0aGlzLmNsYXNzVXBkYXRlQ2FsbGJhY2tzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtTZXQ8RnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnk+fSAqL1xuICAgIHRoaXMuY2xhc3NEZXN0cm95Q2FsbGJhY2tzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7aW5zdGFuY2U6IEZyb250ZW5kTW9kZWxCYXNlLCB1cGRhdGVDYWxsYmFja3M6IFNldDxGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnk+LCBkZXN0cm95Q2FsbGJhY2tzOiBTZXQ8RnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnk+fT59ICovXG4gICAgdGhpcy5pbnN0YW5jZUxpc3RlbmVycyA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgdGhpcy5jaGFubmVsSGFuZGxlID0gbnVsbFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5yZWFkeVByb21pc2UgPSBudWxsXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtzdHJpbmcgfCBudWxsfSAqL1xuICAgIHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zS2V5ID0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Vic2NyaXB0aW9uIHBhcmFtcy5cbiAgICogQHJldHVybnMge3ttb2RlbDogc3RyaW5nLCBkZXN0cm95RXZlbnREZWxpdmVyeT86IGJvb2xlYW4sIGV2ZW50RmlsdGVycz86IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZEVudHJ5W10sIHVuZmlsdGVyZWRFdmVudERlbGl2ZXJ5PzogYm9vbGVhbn0gJiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH0gLSBDdXJyZW50IHdlYnNvY2tldCBzdWJzY3JpcHRpb24gcGFyYW1zLlxuICAgKi9cbiAgc3Vic2NyaXB0aW9uUGFyYW1zKCkge1xuICAgIC8qKlxuICAgICAqIFByb2plY3Rpb24gcGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9ICovXG4gICAgY29uc3QgcHJvamVjdGlvblBheWxvYWQgPSB7fVxuICAgIC8qKlxuICAgICAqIEV2ZW50IGZpbHRlcnMgYnkga2V5LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeT59ICovXG4gICAgY29uc3QgZXZlbnRGaWx0ZXJzQnlLZXkgPSB7fVxuICAgIGNvbnN0IHByb2plY3Rpb25FbnRyaWVzID0gW11cbiAgICBsZXQgaGFzRGVzdHJveUV2ZW50RGVsaXZlcnkgPSB0aGlzLmNsYXNzRGVzdHJveUNhbGxiYWNrcy5zaXplID4gMFxuICAgIGxldCBoYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHRoaXMuY2xhc3NDcmVhdGVDYWxsYmFja3MpIHByb2plY3Rpb25FbnRyaWVzLnB1c2goZW50cnkpXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLmNsYXNzVXBkYXRlQ2FsbGJhY2tzKSBwcm9qZWN0aW9uRW50cmllcy5wdXNoKGVudHJ5KVxuXG4gICAgZm9yIChjb25zdCBsaXN0ZW5lciBvZiB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLnZhbHVlcygpKSB7XG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcykgcHJvamVjdGlvbkVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgIGlmIChsaXN0ZW5lci5kZXN0cm95Q2FsbGJhY2tzLnNpemUgPiAwKSBoYXNEZXN0cm95RXZlbnREZWxpdmVyeSA9IHRydWVcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHByb2plY3Rpb25FbnRyaWVzKSB7XG4gICAgICBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByb2plY3Rpb25QYXlsb2FkKHByb2plY3Rpb25QYXlsb2FkLCBlbnRyeS5wcm9qZWN0aW9uUGF5bG9hZClcblxuICAgICAgaWYgKGVudHJ5LmV2ZW50RmlsdGVyS2V5ICYmIGVudHJ5LmV2ZW50RmlsdGVyUGF5bG9hZCkge1xuICAgICAgICBldmVudEZpbHRlcnNCeUtleVtlbnRyeS5ldmVudEZpbHRlcktleV0gPSB7XG4gICAgICAgICAgLi4uZW50cnkuZXZlbnRGaWx0ZXJQYXlsb2FkLFxuICAgICAgICAgIGtleTogZW50cnkuZXZlbnRGaWx0ZXJLZXlcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPSB0cnVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgZXZlbnRGaWx0ZXJzID0gT2JqZWN0LnZhbHVlcyhldmVudEZpbHRlcnNCeUtleSlcbiAgICBjb25zdCBldmVudEZpbHRlclBhcmFtcyA9IGV2ZW50RmlsdGVycy5sZW5ndGggPiAwXG4gICAgICA/IHtcbiAgICAgICAgICBldmVudEZpbHRlcnMsXG4gICAgICAgICAgLi4uKGhhc0Rlc3Ryb3lFdmVudERlbGl2ZXJ5ID8ge2Rlc3Ryb3lFdmVudERlbGl2ZXJ5OiB0cnVlfSA6IHt9KSxcbiAgICAgICAgICAuLi4oaGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPyB7dW5maWx0ZXJlZEV2ZW50RGVsaXZlcnk6IHRydWV9IDoge30pXG4gICAgICAgIH1cbiAgICAgIDoge31cblxuICAgIHJldHVybiBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChcbiAgICAgIHRoaXMucmVxdWVzdENvbnRleHQsXG4gICAgICB7XG4gICAgICAgIG1vZGVsOiB0aGlzLk1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgIC4uLmV2ZW50RmlsdGVyUGFyYW1zLFxuICAgICAgICAuLi5wcm9qZWN0aW9uUGF5bG9hZFxuICAgICAgfVxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1YnNjcmlwdGlvbiBwYXJhbXMganNvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTdGFibGUga2V5IGZvciBjdXJyZW50IHN1YnNjcmlwdGlvbiBwYXJhbXMuXG4gICAqL1xuICBzdWJzY3JpcHRpb25QYXJhbXNKc29uKCkge1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh0aGlzLnN1YnNjcmlwdGlvblBhcmFtcygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXIgY2xhc3MgY2FsbGJhY2suXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5IHwgRnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnl9IFRcbiAgICogQHBhcmFtIHtTZXQ8VD59IGNhbGxiYWNrcyAtIENhbGxiYWNrIHNldCBmb3IgdGhlIGV2ZW50IHR5cGUuXG4gICAqIEBwYXJhbSB7VH0gZW50cnkgLSBDYWxsYmFjayBlbnRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBhc3luYyByZWdpc3RlckNsYXNzQ2FsbGJhY2soY2FsbGJhY2tzLCBlbnRyeSkge1xuICAgIGNhbGxiYWNrcy5hZGQoZW50cnkpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5lbnN1cmVTdWJzY3JpYmVkKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY2FsbGJhY2tzLmRlbGV0ZShlbnRyeSlcbiAgICAgIHRoaXMubWF5YmVUZWFyZG93bigpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBjYWxsYmFja3MuZGVsZXRlKGVudHJ5KVxuICAgICAgdGhpcy5tYXliZVRlYXJkb3duKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgc3Vic2NyaWJlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59ICovXG4gIGFzeW5jIGVuc3VyZVN1YnNjcmliZWQoKSB7XG4gICAgY29uc3QgcGFyYW1zSnNvbiA9IHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zSnNvbigpXG5cbiAgICBpZiAodGhpcy5jaGFubmVsSGFuZGxlICYmICF0aGlzLmNoYW5uZWxIYW5kbGUuaXNDbG9zZWQoKSkge1xuICAgICAgaWYgKHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zS2V5ICE9PSBwYXJhbXNKc29uKSB7XG4gICAgICAgIHRoaXMuY2hhbm5lbEhhbmRsZS5jbG9zZSgpXG4gICAgICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IG51bGxcbiAgICAgICAgdGhpcy5yZWFkeVByb21pc2UgPSBudWxsXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAodGhpcy5yZWFkeVByb21pc2UpIGF3YWl0IHRoaXMucmVhZHlQcm9taXNlXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFNlcmlhbGl6ZSBwYXJhbGxlbCBjYWxscyAoZS5nLiBQcm9taXNlLmFsbChbb25DcmVhdGUsIG9uVXBkYXRlLFxuICAgIC8vIG9uRGVzdHJveV0pKSBzbyB3ZSBvcGVuIGV4YWN0bHkgb25lIHN1YnNjcmlwdGlvbiBwZXIgbW9kZWwgY2xhc3NcbiAgICAvLyBpbnN0ZWFkIG9mIHJhY2luZyB0aHJlZSBjb25jdXJyZW50IHN1YnNjcmliZUNoYW5uZWwgY2FsbHMuXG4gICAgaWYgKHRoaXMucmVhZHlQcm9taXNlKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlYWR5UHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50IHx8IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpKVxuXG4gICAgaWYgKCFjbGllbnQgfHwgdHlwZW9mIGNsaWVudC5zdWJzY3JpYmVDaGFubmVsICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIGV2ZW50IHN1YnNjcmlwdGlvbnMgcmVxdWlyZSBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldFVybH0pIG9yIGNvbmZpZ3VyZVRyYW5zcG9ydCh7d2Vic29ja2V0Q2xpZW50fSlcIilcbiAgICB9XG5cbiAgICB0aGlzLnJlYWR5UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBpZiAodHlwZW9mIGNsaWVudC5jb25uZWN0ID09PSBcImZ1bmN0aW9uXCIpIGF3YWl0IGNsaWVudC5jb25uZWN0KClcblxuICAgICAgY29uc3QgcGFyYW1zID0gdGhpcy5zdWJzY3JpcHRpb25QYXJhbXMoKVxuXG4gICAgICB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSA9IEpTT04uc3RyaW5naWZ5KHBhcmFtcylcbiAgICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IGNsaWVudC5zdWJzY3JpYmVDaGFubmVsKEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUsIHtcbiAgICAgICAgcGFyYW1zLFxuICAgICAgICBvbk1lc3NhZ2U6ICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBib2R5KSA9PiB0aGlzLl9kaXNwYXRjaEV2ZW50KGJvZHkpLFxuICAgICAgICBvbkNsb3NlOiAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jaGFubmVsSGFuZGxlID0gbnVsbFxuICAgICAgICAgIHRoaXMucmVhZHlQcm9taXNlID0gbnVsbFxuICAgICAgICAgIHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zS2V5ID0gbnVsbFxuICAgICAgICAgIHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMuY2xlYXIoKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgYXdhaXQgdGhpcy5jaGFubmVsSGFuZGxlLnJlYWR5XG4gICAgfSkoKVxuXG4gICAgYXdhaXQgdGhpcy5yZWFkeVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRpc3BhdGNoIGV2ZW50LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5IC0gV2ViU29ja2V0IGV2ZW50IHBheWxvYWQuXG4gICAqL1xuICBfZGlzcGF0Y2hFdmVudChib2R5KSB7XG4gICAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSBcIm9iamVjdFwiKSByZXR1cm5cblxuICAgIGNvbnN0IGFjdGlvbiA9IGJvZHkuYWN0aW9uXG4gICAgY29uc3QgcmF3SWQgPSBib2R5LmlkXG5cbiAgICBpZiAoYWN0aW9uICE9PSBcImNyZWF0ZVwiICYmIGFjdGlvbiAhPT0gXCJ1cGRhdGVcIiAmJiBhY3Rpb24gIT09IFwiZGVzdHJveVwiKSByZXR1cm5cbiAgICBpZiAocmF3SWQgPT09IHVuZGVmaW5lZCB8fCByYXdJZCA9PT0gbnVsbCkgcmV0dXJuXG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5Nb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IGlkZW50aXR5ID0gQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KVxuICAgICAgPyBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIHJhd0lkKVxuICAgICAgOiBTdHJpbmcocmF3SWQpXG4gICAgY29uc3QgaWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBpZGVudGl0eSlcbiAgICBjb25zdCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzID0gZnJvbnRlbmRNb2RlbE1hdGNoZWRFdmVudEZpbHRlcktleXMoYm9keSlcblxuICAgIGlmIChhY3Rpb24gPT09IFwiZGVzdHJveVwiKSB7XG4gICAgICBjb25zdCBsaXN0ZW5lciA9IHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KGlkKVxuXG4gICAgICBpZiAobGlzdGVuZXIpIHtcbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBsaXN0ZW5lci5kZXN0cm95Q2FsbGJhY2tzKSB7XG4gICAgICAgICAgdHJ5IHsgZW50cnkuY2FsbGJhY2soe2lkOiBpZGVudGl0eX0pIH0gY2F0Y2ggKGVycm9yKSB7IGNvbnNvbGUuZXJyb3IoZXJyb3IpIH1cbiAgICAgICAgfVxuICAgICAgICB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLmRlbGV0ZShpZClcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgdGhpcy5jbGFzc0Rlc3Ryb3lDYWxsYmFja3MpIHtcbiAgICAgICAgdHJ5IHsgZW50cnkuY2FsbGJhY2soe2lkOiBpZGVudGl0eX0pIH0gY2F0Y2ggKGVycm9yKSB7IGNvbnNvbGUuZXJyb3IoZXJyb3IpIH1cbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICghYm9keS5yZWNvcmQgfHwgdHlwZW9mIGJvZHkucmVjb3JkICE9PSBcIm9iamVjdFwiKSByZXR1cm5cblxuICAgIGNvbnN0IGRlc2VyaWFsaXplZFJlY29yZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoYm9keS5yZWNvcmQpKVxuICAgIGNvbnN0IGZyZXNoTW9kZWwgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcy5Nb2RlbENsYXNzKS5pbnN0YW50aWF0ZUZyb21SZXNwb25zZShkZXNlcmlhbGl6ZWRSZWNvcmQpXG4gICAgY29uc3QgbGlzdGVuZXIgPSB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLmdldChpZClcblxuICAgIGlmIChhY3Rpb24gPT09IFwidXBkYXRlXCIgJiYgbGlzdGVuZXIpIHtcbiAgICAgIGNvbnN0IG1hdGNoaW5nVXBkYXRlQ2FsbGJhY2tzID0gQXJyYXkuZnJvbShsaXN0ZW5lci51cGRhdGVDYWxsYmFja3MpLmZpbHRlcigoZW50cnkpID0+XG4gICAgICAgIGZyb250ZW5kTW9kZWxFdmVudEVudHJ5TWF0Y2hlcyhlbnRyeSwgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cylcbiAgICAgIClcblxuICAgICAgaWYgKG1hdGNoaW5nVXBkYXRlQ2FsbGJhY2tzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgLy8gQXV0by1tZXJnZSBpbnRvIHRoZSByZWdpc3RlcmVkIGluc3RhbmNlIHNvIGNhbGxlcnMgcmVhZGluZ1xuICAgICAgICAvLyB0aHJvdWdoIHRoZSBzYW1lIGhhbmRsZSBzZWUgZnJlc2ggYXR0cmlidXRlcy5cbiAgICAgICAgY29uc3QgaW5zdGFuY2VBbnkgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobGlzdGVuZXIuaW5zdGFuY2UpXG5cbiAgICAgICAgaW5zdGFuY2VBbnkuYXNzaWduQXR0cmlidXRlcyhmcmVzaE1vZGVsLmF0dHJpYnV0ZXMoKSlcbiAgICAgICAgaW5zdGFuY2VBbnkuX3BlcnNpc3RlZEF0dHJpYnV0ZXMgPSBjbG9uZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKGxpc3RlbmVyLmluc3RhbmNlLmF0dHJpYnV0ZXMoKSlcblxuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIG1hdGNoaW5nVXBkYXRlQ2FsbGJhY2tzKSB7XG4gICAgICAgICAgdHJ5IHsgZW50cnkuY2FsbGJhY2soe2lkOiBpZGVudGl0eSwgbW9kZWw6IGxpc3RlbmVyLmluc3RhbmNlfSkgfSBjYXRjaCAoZXJyb3IpIHsgY29uc29sZS5lcnJvcihlcnJvcikgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgY2xhc3NDYWxsYmFja3MgPSBhY3Rpb24gPT09IFwiY3JlYXRlXCIgPyB0aGlzLmNsYXNzQ3JlYXRlQ2FsbGJhY2tzIDogdGhpcy5jbGFzc1VwZGF0ZUNhbGxiYWNrc1xuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBjbGFzc0NhbGxiYWNrcykge1xuICAgICAgaWYgKCFmcm9udGVuZE1vZGVsRXZlbnRFbnRyeU1hdGNoZXMoZW50cnksIG1hdGNoZWRFdmVudEZpbHRlcktleXMpKSBjb250aW51ZVxuXG4gICAgICB0cnkgeyBlbnRyeS5jYWxsYmFjayh7aWQ6IGlkZW50aXR5LCBtb2RlbDogZnJlc2hNb2RlbH0pIH0gY2F0Y2ggKGVycm9yKSB7IGNvbnNvbGUuZXJyb3IoZXJyb3IpIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXliZSB0ZWFyZG93bi5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIG1heWJlVGVhcmRvd24oKSB7XG4gICAgY29uc3QgaGFzQW55TGlzdGVuZXIgPSB0aGlzLmNsYXNzQ3JlYXRlQ2FsbGJhY2tzLnNpemUgPiAwXG4gICAgICB8fCB0aGlzLmNsYXNzVXBkYXRlQ2FsbGJhY2tzLnNpemUgPiAwXG4gICAgICB8fCB0aGlzLmNsYXNzRGVzdHJveUNhbGxiYWNrcy5zaXplID4gMFxuICAgICAgfHwgdGhpcy5pbnN0YW5jZUxpc3RlbmVycy5zaXplID4gMFxuXG4gICAgaWYgKGhhc0FueUxpc3RlbmVyKSByZXR1cm5cblxuICAgIGlmICh0aGlzLmNoYW5uZWxIYW5kbGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuY2hhbm5lbEhhbmRsZS5jbG9zZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IG51bGxcbiAgICB0aGlzLnJlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSA9IG51bGxcbiAgICByZWxlYXNlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKHRoaXMpXG4gIH1cbn1cblxuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCBldmVudCBzdWJzY3JpcHRpb25zLlxuICogQHR5cGUge1dlYWtNYXA8RnJvbnRlbmRNb2RlbENsYXNzLCBNYXA8c3RyaW5nLCBGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24+Pn0gKi9cbmNvbnN0IGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMgPSBuZXcgV2Vha01hcCgpXG5cbi8qKlxuICogUnVucyBlbnN1cmUgZnJvbnRlbmQgbW9kZWwgZXZlbnQgc3Vic2NyaXB0aW9uLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dH0gcmVxdWVzdENvbnRleHQgLSBDYXB0dXJlZCBzdWJzY3JpcHRpb24gY29udGV4dC5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb259IC0gUGVyLWNsYXNzIHN1YnNjcmlwdGlvbiBoZWxwZXIuXG4gKi9cbmZ1bmN0aW9uIGVuc3VyZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbihNb2RlbENsYXNzLCByZXF1ZXN0Q29udGV4dCkge1xuICBsZXQgc3Vic2NyaXB0aW9ucyA9IGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMuZ2V0KE1vZGVsQ2xhc3MpXG5cbiAgaWYgKCFzdWJzY3JpcHRpb25zKSB7XG4gICAgc3Vic2NyaXB0aW9ucyA9IG5ldyBNYXAoKVxuICAgIGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMuc2V0KE1vZGVsQ2xhc3MsIHN1YnNjcmlwdGlvbnMpXG4gIH1cblxuICBjb25zdCBjb250ZXh0S2V5ID0gcmVtb3RlUmVxdWVzdENvbnRleHRLZXkocmVxdWVzdENvbnRleHQpXG4gIGxldCBzdWIgPSBzdWJzY3JpcHRpb25zLmdldChjb250ZXh0S2V5KVxuXG4gIGlmICghc3ViKSB7XG4gICAgc3ViID0gbmV3IEZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbihNb2RlbENsYXNzLCByZXF1ZXN0Q29udGV4dClcbiAgICBzdWJzY3JpcHRpb25zLnNldChjb250ZXh0S2V5LCBzdWIpXG4gIH1cblxuICByZXR1cm4gc3ViXG59XG5cbi8qKlxuICogUmVtb3ZlcyBhbiBlbXB0eSBjb250ZXh0IGJ1Y2tldCBzbyBzd2l0Y2hpbmcgdGhyb3VnaCBtYW55IHRlbmFudHMgZG9lcyBub3QgcmV0YWluIGV2ZXJ5IHNuYXBzaG90LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb259IHN1YnNjcmlwdGlvbiAtIEVtcHR5IHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gcmVsZWFzZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbihzdWJzY3JpcHRpb24pIHtcbiAgY29uc3Qgc3Vic2NyaXB0aW9ucyA9IGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMuZ2V0KHN1YnNjcmlwdGlvbi5Nb2RlbENsYXNzKVxuICBjb25zdCBjb250ZXh0S2V5ID0gcmVtb3RlUmVxdWVzdENvbnRleHRLZXkoc3Vic2NyaXB0aW9uLnJlcXVlc3RDb250ZXh0KVxuXG4gIGlmIChzdWJzY3JpcHRpb25zPy5nZXQoY29udGV4dEtleSkgIT09IHN1YnNjcmlwdGlvbikgcmV0dXJuXG5cbiAgc3Vic2NyaXB0aW9ucy5kZWxldGUoY29udGV4dEtleSlcbiAgaWYgKHN1YnNjcmlwdGlvbnMuc2l6ZSA9PT0gMCkgZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5kZWxldGUoc3Vic2NyaXB0aW9uLk1vZGVsQ2xhc3MpXG59XG5cbi8qKlxuICogQ2FwdHVyZXMgdGhlIGN1cnJlbnQgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IGNvbnRleHQgZm9yIG9uZSBvcGVyYXRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dH0gRnJvemVuIGNvbnRleHQgc25hcHNob3QuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCgpIHtcbiAgY29uc3QgY29uZmlndXJlZENvbnRleHQgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0Q29udGV4dCA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RDb250ZXh0KClcbiAgICA6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdENvbnRleHRcblxuICByZXR1cm4gY2FwdHVyZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChjb25maWd1cmVkQ29udGV4dClcbn1cblxuLyoqXG4gKiBDYXB0dXJlcyB0aGUgZXhwbGljaXQgbGlmZWN5Y2xlIGNvbnRleHQgb3IgZmFsbHMgYmFjayB0byB0aGUgY29uZmlndXJlZCB0cmFuc3BvcnQgY29udGV4dC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dCB8IHVuZGVmaW5lZH0gcmVxdWVzdENvbnRleHQgLSBSZWdpc3RyYXRpb24tbG9jYWwgY29udGV4dC5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0fSBGcm96ZW4gY29udGV4dCBzbmFwc2hvdC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpIHtcbiAgaWYgKHJlcXVlc3RDb250ZXh0ID09PSB1bmRlZmluZWQpIHJldHVybiBmcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoKVxuXG4gIHJldHVybiBjYXB0dXJlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KVxufVxuXG4vKipcbiAqIFJ1bnMgZW5zdXJlIGZyb250ZW5kIG1vZGVsIGluc3RhbmNlIGxpc3RlbmVyLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb259IHN1YiAtIEV2ZW50IHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gKiBAcGFyYW0ge3N0cmluZ30gaWQgLSBNb2RlbCBpZC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IGluc3RhbmNlIC0gTGlzdGVuZXIgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7e2luc3RhbmNlOiBGcm9udGVuZE1vZGVsQmFzZSwgdXBkYXRlQ2FsbGJhY2tzOiBTZXQ8RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5PiwgZGVzdHJveUNhbGxiYWNrczogU2V0PEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5Pn19IC0gSW5zdGFuY2UgbGlzdGVuZXIgYnVja2V0LlxuICovXG5mdW5jdGlvbiBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGlkLCBpbnN0YW5jZSkge1xuICBsZXQgbGlzdGVuZXIgPSBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KGlkKVxuXG4gIGlmICghbGlzdGVuZXIpIHtcbiAgICBsaXN0ZW5lciA9IHtpbnN0YW5jZSwgdXBkYXRlQ2FsbGJhY2tzOiBuZXcgU2V0KCksIGRlc3Ryb3lDYWxsYmFja3M6IG5ldyBTZXQoKX1cbiAgICBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuc2V0KGlkLCBsaXN0ZW5lcilcbiAgfSBlbHNlIHtcbiAgICBsaXN0ZW5lci5pbnN0YW5jZSA9IGluc3RhbmNlXG4gIH1cblxuICByZXR1cm4gbGlzdGVuZXJcbn1cblxuLyoqXG4gKiBSZW1vdmVzIG9uZSBpbnN0YW5jZSBjYWxsYmFjayBlbnRyeSBhbmQgdGVhcnMgZG93biBhbiBlbXB0eSBsaXN0ZW5lci9zdWJzY3JpcHRpb24gYnVja2V0LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb259IHN1YiAtIEV2ZW50IHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gKiBAcGFyYW0geyhsaXN0ZW5lcjogUmV0dXJuVHlwZTx0eXBlb2YgZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXI+KSA9PiBib29sZWFufSByZW1vdmVFbnRyeSAtIENhbGxiYWNrIGVudHJ5IHJlbW92YWwuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gcmVtb3ZlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJFbnRyeShzdWIsIHJlbW92ZUVudHJ5KSB7XG4gIGZvciAoY29uc3QgW2lkLCBjdXJyZW50XSBvZiBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMpIHtcbiAgICBpZiAoIXJlbW92ZUVudHJ5KGN1cnJlbnQpKSBjb250aW51ZVxuXG4gICAgaWYgKGN1cnJlbnQudXBkYXRlQ2FsbGJhY2tzLnNpemUgPT09IDAgJiYgY3VycmVudC5kZXN0cm95Q2FsbGJhY2tzLnNpemUgPT09IDApIHtcbiAgICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5kZWxldGUoaWQpXG4gICAgfVxuICAgIGJyZWFrXG4gIH1cblxuICBzdWIubWF5YmVUZWFyZG93bigpXG59XG5cbi8qKlxuICogTW92ZXMgY2FsbGJhY2tzIHJlZ2lzdGVyZWQgb24gYW4gaW5zdGFuY2UgdG8gaXRzIG5ld2x5IHBlcnNpc3RlZCBpZGVudGl0eS5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBpbnN0YW5jZSAtIFJlLWtleWVkIGluc3RhbmNlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gcHJldmlvdXNJZGVudGl0eSAtIFByZXZpb3VzIHBlcnNpc3RlZCBpZGVudGl0eS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IG5leHRJZGVudGl0eSAtIE5ldyBwZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gcmVrZXlGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcnMoTW9kZWxDbGFzcywgaW5zdGFuY2UsIHByZXZpb3VzSWRlbnRpdHksIG5leHRJZGVudGl0eSkge1xuICBjb25zdCBwcmltYXJ5S2V5ID0gTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgY29uc3QgcHJldmlvdXNJZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHByZXZpb3VzSWRlbnRpdHkpXG4gIGNvbnN0IG5leHRJZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIG5leHRJZGVudGl0eSlcblxuICBpZiAocHJldmlvdXNJZCA9PT0gbmV4dElkKSByZXR1cm5cblxuICBjb25zdCBzdWJzY3JpcHRpb25zID0gZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5nZXQoTW9kZWxDbGFzcylcblxuICBpZiAoIXN1YnNjcmlwdGlvbnMpIHJldHVyblxuXG4gIGZvciAoY29uc3Qgc3ViIG9mIHN1YnNjcmlwdGlvbnMudmFsdWVzKCkpIHtcbiAgICBjb25zdCBsaXN0ZW5lciA9IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQocHJldmlvdXNJZClcblxuICAgIGlmICghbGlzdGVuZXIgfHwgbGlzdGVuZXIuaW5zdGFuY2UgIT09IGluc3RhbmNlKSBjb250aW51ZVxuXG4gICAgY29uc3QgbmV4dExpc3RlbmVyID0gc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChuZXh0SWQpXG5cbiAgICBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZGVsZXRlKHByZXZpb3VzSWQpXG5cbiAgICBpZiAobmV4dExpc3RlbmVyKSB7XG4gICAgICBuZXh0TGlzdGVuZXIuaW5zdGFuY2UgPSBpbnN0YW5jZVxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBsaXN0ZW5lci51cGRhdGVDYWxsYmFja3MpIG5leHRMaXN0ZW5lci51cGRhdGVDYWxsYmFja3MuYWRkKGVudHJ5KVxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBsaXN0ZW5lci5kZXN0cm95Q2FsbGJhY2tzKSBuZXh0TGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcy5hZGQoZW50cnkpXG4gICAgfSBlbHNlIHtcbiAgICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5zZXQobmV4dElkLCBsaXN0ZW5lcilcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNvbW1hbmQgdXJsLlxuICogQHBhcmFtIHtzdHJpbmd9IHJlc291cmNlUGF0aCAtIFJlc291cmNlIHBhdGggcHJlZml4LlxuICogQHBhcmFtIHtzdHJpbmd9IGNvbW1hbmROYW1lIC0gQ29tbWFuZCBwYXRoIHNlZ21lbnQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZyb250ZW5kIG1vZGVsIEFQSSBVUkwuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxDb21tYW5kVXJsKHJlc291cmNlUGF0aCwgY29tbWFuZE5hbWUpIHtcbiAgY29uc3QgY29uZmlndXJlZFVybCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRVcmwoKVxuICBjb25zdCBub3JtYWxpemVkUmVzb3VyY2VQYXRoID0gcmVzb3VyY2VQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpID8gcmVzb3VyY2VQYXRoIDogYC8ke3Jlc291cmNlUGF0aH1gXG5cbiAgcmV0dXJuIGAke2NvbmZpZ3VyZWRVcmx9JHtub3JtYWxpemVkUmVzb3VyY2VQYXRofS8ke2NvbW1hbmROYW1lfWBcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGFwaSB1cmwuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgVVJMLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQXBpVXJsKCkge1xuICByZXR1cm4gYCR7ZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybCgpfSR7U0hBUkVEX0ZST05URU5EX01PREVMX0FQSV9QQVRIfWBcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBwYXRoLlxuICogQHBhcmFtIHtzdHJpbmd9IHVybCAtIFJlcXVlc3QgVVJMIG9yIHBhdGguXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFdlYnNvY2tldC1zYWZlIHJlcXVlc3QgcGF0aC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFBhdGgodXJsKSB7XG4gIGlmICh0eXBlb2YgdXJsICE9PSBcInN0cmluZ1wiIHx8IHVybC5sZW5ndGggPCAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgVVJML3BhdGgsIGdvdDogJHt1cmx9YClcbiAgfVxuXG4gIGlmICh1cmwuc3RhcnRzV2l0aChcIi9cIikpIHtcbiAgICByZXR1cm4gdXJsXG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IHBhcnNlZFVybCA9IG5ldyBVUkwodXJsKVxuXG4gICAgcmV0dXJuIGAke3BhcnNlZFVybC5wYXRobmFtZX0ke3BhcnNlZFVybC5zZWFyY2h9YFxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdXJsXG4gIH1cbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgYnJvd3NlciBydW50aW1lIHRpbWV6b25lIHdoZW4gYXZhaWxhYmxlLlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBCcm93c2VyIHJ1bnRpbWUgdGltZXpvbmUgd2hlbiBhdmFpbGFibGUuXG4gKi9cbmZ1bmN0aW9uIGRlZmF1bHRGcm9udGVuZE1vZGVsVGltZVpvbmUoKSB7XG4gIGlmICh0eXBlb2Ygd2luZG93ID09PSBcInVuZGVmaW5lZFwiKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgY29uc3QgaW50bCA9IGdsb2JhbFRoaXMuSW50bFxuXG4gIGlmICghaW50bCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIEludGwgdG8gYmUgYXZhaWxhYmxlIGZvciBicm93c2VyIHRpbWV6b25lIGRldGVjdGlvblwiKVxuICB9XG5cbiAgaWYgKHR5cGVvZiBpbnRsLkRhdGVUaW1lRm9ybWF0ICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBJbnRsLkRhdGVUaW1lRm9ybWF0IHRvIGJlIGF2YWlsYWJsZSBhcyBhIGZ1bmN0aW9uXCIpXG4gIH1cblxuICBjb25zdCB0aW1lWm9uZSA9IGludGwuRGF0ZVRpbWVGb3JtYXQoKS5yZXNvbHZlZE9wdGlvbnMoKS50aW1lWm9uZVxuXG4gIGlmICh0eXBlb2YgdGltZVpvbmUgIT09IFwic3RyaW5nXCIgfHwgdGltZVpvbmUudHJpbSgpLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBJbnRsLkRhdGVUaW1lRm9ybWF0IHRvIHJlc29sdmUgYSBicm93c2VyIHRpbWV6b25lIHN0cmluZ1wiKVxuICB9XG5cbiAgcmV0dXJuIHZhbGlkYXRlVGltZVpvbmUodGltZVpvbmUsIFwiYnJvd3NlciB0aW1lWm9uZVwiKVxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBjb25maWd1cmVkIGZyb250ZW5kLW1vZGVsIHJlcXVlc3QgdGltZXpvbmUuXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIENvbmZpZ3VyZWQgZnJvbnRlbmQtbW9kZWwgdGltZXpvbmUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpIHtcbiAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZywgXCJ0aW1lWm9uZVwiKSkge1xuICAgIHJldHVybiBkZWZhdWx0RnJvbnRlbmRNb2RlbFRpbWVab25lKClcbiAgfVxuXG4gIGNvbnN0IHRpbWVab25lID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZVpvbmUgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lWm9uZSgpXG4gICAgOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lXG5cbiAgaWYgKHRpbWVab25lID09PSB1bmRlZmluZWQgfHwgdGltZVpvbmUgPT09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgdGltZVpvbmUgZGlkIG5vdCByZXNvbHZlIHRvIGEgdGltZXpvbmUgc3RyaW5nXCIpXG4gIH1cblxuICByZXR1cm4gdmFsaWRhdGVUaW1lWm9uZSh0aW1lWm9uZSwgXCJmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgdGltZVpvbmVcIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlcXVlc3QgaGVhZGVycy5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBbdGltZVpvbmVdIC0gUHJlLXJlc29sdmVkIHRpbWV6b25lIGZvciB0aGlzIHJlcXVlc3QuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBIZWFkZXJzIGZvciBmcm9udGVuZC1tb2RlbCBIVFRQIHJlcXVlc3RzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVxdWVzdEhlYWRlcnModGltZVpvbmUgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKSkge1xuICBjb25zdCBkeW5hbWljSGVhZGVycyA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RIZWFkZXJzID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RIZWFkZXJzKCkgfHwge30pXG4gICAgOiAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0SGVhZGVycyB8fCB7fSlcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqL1xuICBjb25zdCBoZWFkZXJzID0ge1wiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLCAuLi5keW5hbWljSGVhZGVyc31cblxuICBpZiAodGltZVpvbmUpIHtcbiAgICBoZWFkZXJzW1JFUVVFU1RfVElNRV9aT05FX0hFQURFUl0gPSB0aW1lWm9uZVxuICB9XG5cbiAgcmV0dXJuIGhlYWRlcnNcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgY29uZmlndXJlZCBib3VuZGVkIHRyYW5zcG9ydCBkZWFkbGluZSBpbiBtaWxsaXNlY29uZHMuXG4gKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIENvbmZpZ3VyZWQgZGVhZGxpbmUsIG9yIHVuZGVmaW5lZCB3aGVuIG5vIGRlYWRsaW5lIGlzIHNldC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVvdXRNcygpIHtcbiAgY29uc3QgY29uZmlndXJlZFRpbWVvdXQgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lb3V0ID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZW91dCgpXG4gICAgOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVvdXRcblxuICBpZiAodHlwZW9mIGNvbmZpZ3VyZWRUaW1lb3V0ICE9PSBcIm51bWJlclwiIHx8ICEoY29uZmlndXJlZFRpbWVvdXQgPiAwKSkge1xuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIHJldHVybiBjb25maWd1cmVkVGltZW91dFxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBjb25maWd1cmVkIGNhbGxlci9zZXNzaW9uIEFib3J0U2lnbmFsIGNvbXBvc2VkIHdpdGggdGhlIGRlYWRsaW5lLlxuICogQHJldHVybnMge0Fib3J0U2lnbmFsIHwgdW5kZWZpbmVkfSAtIENvbmZpZ3VyZWQgY2FsbGVyIHNpZ25hbCwgb3IgdW5kZWZpbmVkIHdoZW4gbm9uZSBpcyBzZXQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRTaWduYWwgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zaWduYWwgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zaWduYWwoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zaWduYWxcblxuICByZXR1cm4gY29uZmlndXJlZFNpZ25hbCB8fCB1bmRlZmluZWRcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyBwZXItc3RhcnR1cCBjb250cm9scyB3aXRoIHRoZSBjb25maWd1cmVkIHNlc3Npb24gY2FuY2VsbGF0aW9uLlxuICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyLCBzaWduYWw/OiBBYm9ydFNpZ25hbH19IGNvbnRyb2xzIC0gQ2FsbCBjb250cm9scy5cbiAqIEByZXR1cm5zIHt7dGltZW91dE1zPzogbnVtYmVyLCBzaWduYWw/OiBBYm9ydFNpZ25hbH19IC0gRWZmZWN0aXZlIHN0YXJ0dXAgY29udHJvbHMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxXZWJzb2NrZXRTdGFydHVwQ29udHJvbHMoY29udHJvbHMpIHtcbiAgY29uc3Qgc2Vzc2lvblNpZ25hbCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKVxuICBsZXQgc2lnbmFsID0gY29udHJvbHMuc2lnbmFsIHx8IHNlc3Npb25TaWduYWxcblxuICBpZiAoY29udHJvbHMuc2lnbmFsICYmIHNlc3Npb25TaWduYWwgJiYgY29udHJvbHMuc2lnbmFsICE9PSBzZXNzaW9uU2lnbmFsKSB7XG4gICAgc2lnbmFsID0gQWJvcnRTaWduYWwuYW55KFtjb250cm9scy5zaWduYWwsIHNlc3Npb25TaWduYWxdKVxuICB9XG5cbiAgY29uc3QgY29uZmlndXJlZFRpbWVvdXRNcyA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lb3V0TXMoKVxuICBjb25zdCB0aW1lb3V0TXMgPSBjb250cm9scy50aW1lb3V0TXMgPT09IHVuZGVmaW5lZFxuICAgID8gY29uZmlndXJlZFRpbWVvdXRNc1xuICAgIDogY29uZmlndXJlZFRpbWVvdXRNcyA9PT0gdW5kZWZpbmVkXG4gICAgICA/IGNvbnRyb2xzLnRpbWVvdXRNc1xuICAgICAgOiBNYXRoLm1pbihjb250cm9scy50aW1lb3V0TXMsIGNvbmZpZ3VyZWRUaW1lb3V0TXMpXG5cbiAgcmV0dXJuIHtzaWduYWwsIHRpbWVvdXRNc31cbn1cblxuLyoqXG4gKiBSdW5zIHBlcmZvcm0gc2hhcmVkIGZyb250ZW5kIG1vZGVsIGFwaSByZXF1ZXN0LlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJlcXVlc3RQYXlsb2FkIC0gU2hhcmVkIHJlcXVlc3QgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gRGVjb2RlZCBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJIHJlc3BvbnNlLlxuICovXG5hc3luYyBmdW5jdGlvbiBwZXJmb3JtU2hhcmVkRnJvbnRlbmRNb2RlbEFwaVJlcXVlc3QocmVxdWVzdFBheWxvYWQpIHtcbiAgY29uc3QgdGltZVpvbmUgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKVxuICBjb25zdCBzZXJpYWxpemVkUmVxdWVzdFBheWxvYWQgPSBzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocmVxdWVzdFBheWxvYWQsIHt0aW1lWm9uZX0pXG4gIGNvbnN0IHdlYnNvY2tldENsaWVudCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50XG4gIGNvbnN0IHVybCA9IGZyb250ZW5kTW9kZWxBcGlVcmwoKVxuICBjb25zdCBtZXJnZWRIZWFkZXJzID0gZnJvbnRlbmRNb2RlbFJlcXVlc3RIZWFkZXJzKHRpbWVab25lKVxuXG4gIHJldHVybiBhd2FpdCBydW5XaXRoVHJhbnNwb3J0RGVhZGxpbmUoXG4gICAge1xuICAgICAgZXJyb3JNZXNzYWdlOiBcIlNoYXJlZCBmcm9udGVuZCBtb2RlbCBBUEkgcmVxdWVzdCB0aW1lZCBvdXRcIixcbiAgICAgIHNpZ25hbDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpLFxuICAgICAgdGltZW91dE1zOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKClcbiAgICB9LFxuICAgIGFzeW5jIChzaWduYWwpID0+IHtcbiAgICAgIGlmICh3ZWJzb2NrZXRDbGllbnQpIHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB3ZWJzb2NrZXRDbGllbnQucG9zdChmcm9udGVuZE1vZGVsVHJhbnNwb3J0UGF0aCh1cmwpLCBzZXJpYWxpemVkUmVxdWVzdFBheWxvYWQsIHtcbiAgICAgICAgICBoZWFkZXJzOiBtZXJnZWRIZWFkZXJzLFxuICAgICAgICAgIHNpZ25hbFxuICAgICAgICB9KVxuICAgICAgICBjb25zdCByZXNwb25zZUpzb24gPSByZXNwb25zZS5qc29uKClcblxuICAgICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShyZXNwb25zZUpzb24pKVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybCwge1xuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShzZXJpYWxpemVkUmVxdWVzdFBheWxvYWQpLFxuICAgICAgICBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIsXG4gICAgICAgIGhlYWRlcnM6IG1lcmdlZEhlYWRlcnMsXG4gICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgIHNpZ25hbFxuICAgICAgfSlcblxuICAgICAgY29uc3QgcmVzcG9uc2VUZXh0ID0gYXdhaXQgcmVzcG9uc2UudGV4dCgpXG5cbiAgICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgICAgdGhyb3dGcm9udGVuZE1vZGVsSHR0cEVycm9yKHtcbiAgICAgICAgICBjb21tYW5kTGFiZWw6IFwic2hhcmVkIGZyb250ZW5kIG1vZGVsIEFQSVwiLFxuICAgICAgICAgIHJlc3BvbnNlLFxuICAgICAgICAgIHJlc3BvbnNlVGV4dFxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCBqc29uID0gcmVzcG9uc2VUZXh0Lmxlbmd0aCA+IDAgPyBKU09OLnBhcnNlKHJlc3BvbnNlVGV4dCkgOiB7fVxuXG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShqc29uKSlcbiAgICB9XG4gIClcbn1cblxuLyoqXG4gKiBUaHJvd3MgYSBmcm9udGVuZC1tb2RlbCBIVFRQIGVycm9yIHdpdGggYmFja2VuZC1wcm92aWRlZCBlbnZlbG9wZSBkZXRhaWxzIHdoZW4gYXZhaWxhYmxlLlxuICogQHBhcmFtIHt7Y29tbWFuZExhYmVsOiBzdHJpbmcsIHJlc3BvbnNlOiBSZXNwb25zZSwgcmVzcG9uc2VUZXh0OiBzdHJpbmd9fSBhcmdzIC0gRXJyb3IgcmVzcG9uc2UgZGV0YWlscy5cbiAqIEByZXR1cm5zIHtuZXZlcn0gLSBBbHdheXMgdGhyb3dzIGFuIHVua25vd24tYXR0cmlidXRlIGVycm9yLlxuICovXG5mdW5jdGlvbiB0aHJvd0Zyb250ZW5kTW9kZWxIdHRwRXJyb3Ioe2NvbW1hbmRMYWJlbCwgcmVzcG9uc2UsIHJlc3BvbnNlVGV4dH0pIHtcbiAgLy8gU3VyZmFjZSB0aGUgYmFja2VuZCdzIGZyaWVuZGx5IGVycm9yTWVzc2FnZSBlbnZlbG9wZSAodGhlXG4gIC8vIGB7c3RhdHVzOiBcImVycm9yXCIsIGVycm9yTWVzc2FnZTogXCIuLi5cIn1gIHNoYXBlIGV2ZXJ5IGNvbnRyb2xsZXJcbiAgLy8gc2hpcHMgb24gaXRzIDR4eC81eHggcmVzcG9uc2VzKSBpbnN0ZWFkIG9mIHRoZSBnZW5lcmljIHN0YXR1c1xuICAvLyBzdHJpbmcuIEZhbGwgdGhyb3VnaCB0byB0aGUgc3RhdHVzLW9ubHkgbWVzc2FnZSB3aGVuIHRoZSBib2R5IGlzXG4gIC8vIG1pc3NpbmcsIG5vbi1KU09OLCBvciBoYXMgbm8gdXNhYmxlIGVycm9yTWVzc2FnZSBmaWVsZC5cbiAgY29uc3QgcmVzcG9uc2VDb250ZW50VHlwZSA9IHJlc3BvbnNlLmhlYWRlcnMuZ2V0KFwiY29udGVudC10eXBlXCIpXG5cbiAgaWYgKHJlc3BvbnNlQ29udGVudFR5cGUgJiYgcmVzcG9uc2VDb250ZW50VHlwZS5pbmNsdWRlcyhcImFwcGxpY2F0aW9uL2pzb25cIikgJiYgcmVzcG9uc2VUZXh0Lmxlbmd0aCA+IDApIHtcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIGVycm9yQm9keS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gKi9cbiAgICBsZXQgZXJyb3JCb2R5XG5cbiAgICB0cnkge1xuICAgICAgZXJyb3JCb2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZVRleHQpXG4gICAgfSBjYXRjaCB7XG4gICAgICBlcnJvckJvZHkgPSBudWxsXG4gICAgfVxuXG4gICAgaWYgKGVycm9yQm9keSAmJiB0eXBlb2YgZXJyb3JCb2R5LmVycm9yTWVzc2FnZSA9PT0gXCJzdHJpbmdcIiAmJiBlcnJvckJvZHkuZXJyb3JNZXNzYWdlLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JCb2R5LmVycm9yTWVzc2FnZS50cmltKCkpXG4gICAgfVxuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKGBSZXF1ZXN0IGZhaWxlZCAoJHtyZXNwb25zZS5zdGF0dXN9KSBmb3IgJHtjb21tYW5kTGFiZWx9YClcbn1cblxuLyoqXG4gKiBSdW5zIGZsdXNoIHBlbmRpbmcgc2hhcmVkIGZyb250ZW5kIG1vZGVsIHJlcXVlc3RzLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVuZGluZyBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgcmVxdWVzdHMgZmx1c2guXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZsdXNoUGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cygpIHtcbiAgc2hhcmVkRnJvbnRlbmRNb2RlbEZsdXNoU2NoZWR1bGVkID0gZmFsc2VcblxuICBpZiAocGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cy5sZW5ndGggPCAxKSB7XG4gICAgcmVzb2x2ZUZyb250ZW5kTW9kZWxJZGxlV2FpdGVycygpXG4gICAgcmV0dXJuXG4gIH1cblxuICBjb25zdCBiYXRjaGVkUmVxdWVzdHMgPSBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzXG4gIHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMgPSBbXVxuXG4gIGNvbnN0IHVybCA9IGZyb250ZW5kTW9kZWxBcGlVcmwoKVxuICBjb25zdCByZXF1ZXN0UGF5bG9hZCA9IHtcbiAgICByZXF1ZXN0czogYmF0Y2hlZFJlcXVlc3RzLm1hcCgocmVxdWVzdCkgPT4ge1xuICAgICAgaWYgKHJlcXVlc3QuY3VzdG9tUGF0aCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmRUeXBlOiByZXF1ZXN0LmNvbW1hbmRUeXBlLFxuICAgICAgICAgIGN1c3RvbVBhdGg6IHJlcXVlc3QuY3VzdG9tUGF0aCxcbiAgICAgICAgICBtb2RlbDogcmVxdWVzdC5tb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICAgIHBheWxvYWQ6IHJlcXVlc3QucGF5bG9hZCxcbiAgICAgICAgICAuLi4oT2JqZWN0LmtleXMocmVxdWVzdC5yZXF1ZXN0Q29udGV4dCkubGVuZ3RoID4gMCA/IHtyZXF1ZXN0Q29udGV4dDogcmVxdWVzdC5yZXF1ZXN0Q29udGV4dH0gOiB7fSksXG4gICAgICAgICAgcmVxdWVzdElkOiByZXF1ZXN0LnJlcXVlc3RJZFxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvbW1hbmRUeXBlOiByZXF1ZXN0LmNvbW1hbmRUeXBlLFxuICAgICAgICBtb2RlbDogcmVxdWVzdC5tb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICBwYXlsb2FkOiByZXF1ZXN0LnBheWxvYWQsXG4gICAgICAgIC4uLihPYmplY3Qua2V5cyhyZXF1ZXN0LnJlcXVlc3RDb250ZXh0KS5sZW5ndGggPiAwID8ge3JlcXVlc3RDb250ZXh0OiByZXF1ZXN0LnJlcXVlc3RDb250ZXh0fSA6IHt9KSxcbiAgICAgICAgcmVxdWVzdElkOiByZXF1ZXN0LnJlcXVlc3RJZFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICBhd2FpdCB0cmFja0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0KGFzeW5jICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgdm9pZCB1cmxcbiAgICAgIGNvbnN0IGRlY29kZWRSZXNwb25zZSA9IGF3YWl0IHBlcmZvcm1TaGFyZWRGcm9udGVuZE1vZGVsQXBpUmVxdWVzdChyZXF1ZXN0UGF5bG9hZClcbiAgICAgIGNvbnN0IHJlc3BvbnNlcyA9IEFycmF5LmlzQXJyYXkoZGVjb2RlZFJlc3BvbnNlLnJlc3BvbnNlcykgPyBkZWNvZGVkUmVzcG9uc2UucmVzcG9uc2VzIDogW11cbiAgICAgIGNvbnN0IHJlc3BvbnNlc0J5SWQgPSBuZXcgTWFwKHJlc3BvbnNlcy5tYXAoKGVudHJ5KSA9PiBbZW50cnkucmVxdWVzdElkLCBlbnRyeS5yZXNwb25zZV0pKVxuXG4gICAgICBmb3IgKGNvbnN0IHJlcXVlc3Qgb2YgYmF0Y2hlZFJlcXVlc3RzKSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlUGF5bG9hZCA9IHJlc3BvbnNlc0J5SWQuZ2V0KHJlcXVlc3QucmVxdWVzdElkKVxuXG4gICAgICAgIGlmICghcmVzcG9uc2VQYXlsb2FkIHx8IHR5cGVvZiByZXNwb25zZVBheWxvYWQgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgICByZXF1ZXN0LnJlamVjdChuZXcgRXJyb3IoYE1pc3NpbmcgYmF0Y2hlZCByZXNwb25zZSBmb3IgJHtyZXF1ZXN0Lm1vZGVsQ2xhc3MubmFtZX0jJHtyZXF1ZXN0LmNvbW1hbmRUeXBlfWApKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICByZXF1ZXN0LnJlc29sdmUoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyZXNwb25zZVBheWxvYWQpKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBmb3IgKGNvbnN0IHJlcXVlc3Qgb2YgYmF0Y2hlZFJlcXVlc3RzKSB7XG4gICAgICAgIHJlcXVlc3QucmVqZWN0KGVycm9yKVxuICAgICAgfVxuICAgIH1cbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIHNjaGVkdWxlIHNoYXJlZCBmcm9udGVuZCBtb2RlbCByZXF1ZXN0IGZsdXNoLlxuICogQHJldHVybnMge3ZvaWR9ICovXG5mdW5jdGlvbiBzY2hlZHVsZVNoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0Rmx1c2goKSB7XG4gIGlmIChzaGFyZWRGcm9udGVuZE1vZGVsRmx1c2hTY2hlZHVsZWQpIHJldHVyblxuXG4gIHNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZCA9IHRydWVcbiAgcXVldWVNaWNyb3Rhc2soKCkgPT4ge1xuICAgIHZvaWQgZmx1c2hQZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzKClcbiAgfSlcbn1cblxuLyoqXG4gKiBDdXN0b20gY29tbWFuZHMgc3RpbGwgdXNlIHRoZSBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJLiBUaGlzIGhlbHBlciBvbmx5IGJ1aWxkcyB0aGUgYmFja2VuZCByb3V0ZSBwYXRoIHRoZSBzZXJ2ZXIgc2hvdWxkIGRpc3BhdGNoIGFmdGVyIHZhbGlkYXRpbmcgdGhlIHNlZ21lbnRzLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb21tYW5kTmFtZSAtIENvbW1hbmQgcGF0aCBzZWdtZW50LlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubW9kZWxOYW1lIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MgbmFtZS5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gW2FyZ3MubWVtYmVySWRdIC0gT3B0aW9uYWwgbWVtYmVyIGlkLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVzb3VyY2VQYXRoIC0gUmVzb3VyY2UgcGF0aCBwcmVmaXguXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEN1c3RvbSBiYWNrZW5kIHJvdXRlIHBhdGguXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kUGF0aCh7Y29tbWFuZE5hbWUsIG1lbWJlcklkLCBtb2RlbE5hbWUsIHJlc291cmNlUGF0aH0pIHtcbiAgY29uc3QgdmFsaWRhdGVkUmVzb3VyY2VQYXRoID0gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKHttb2RlbE5hbWUsIHJlc291cmNlUGF0aH0pXG4gIGNvbnN0IHZhbGlkYXRlZENvbW1hbmROYW1lID0gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kTmFtZSh7Y29tbWFuZE5hbWUsIGNvbW1hbmRUeXBlOiBjb21tYW5kTmFtZSwgbW9kZWxOYW1lfSlcblxuICBpZiAobWVtYmVySWQgPT09IHVuZGVmaW5lZCB8fCBtZW1iZXJJZCA9PT0gbnVsbCB8fCBtZW1iZXJJZCA9PT0gXCJcIikge1xuICAgIHJldHVybiBgJHt2YWxpZGF0ZWRSZXNvdXJjZVBhdGh9LyR7dmFsaWRhdGVkQ29tbWFuZE5hbWV9YFxuICB9XG5cbiAgcmV0dXJuIGAke3ZhbGlkYXRlZFJlc291cmNlUGF0aH0vJHtlbmNvZGVVUklDb21wb25lbnQoU3RyaW5nKG1lbWJlcklkKSl9LyR7dmFsaWRhdGVkQ29tbWFuZE5hbWV9YFxufVxuXG4vKipcbiAqIFJ1bnMgYXNzZXJ0IGZpbmQgYnkgY29uZGl0aW9ucyBzaGFwZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGNvbmRpdGlvbnMgLSBmaW5kQnkgY29uZGl0aW9ucy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnRGaW5kQnlDb25kaXRpb25zU2hhcGUoY29uZGl0aW9ucykge1xuICBpZiAoIWNvbmRpdGlvbnMgfHwgdHlwZW9mIGNvbmRpdGlvbnMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShjb25kaXRpb25zKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGV4cGVjdHMgY29uZGl0aW9ucyB0byBiZSBhIHBsYWluIG9iamVjdCwgZ290OiAke2NvbmRpdGlvbnN9YClcbiAgfVxuXG4gIGNvbnN0IGNvbmRpdGlvbnNQcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YoY29uZGl0aW9ucylcblxuICBpZiAoY29uZGl0aW9uc1Byb3RvdHlwZSAhPT0gT2JqZWN0LnByb3RvdHlwZSAmJiBjb25kaXRpb25zUHJvdG90eXBlICE9PSBudWxsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZXhwZWN0cyBjb25kaXRpb25zIHRvIGJlIGEgcGxhaW4gb2JqZWN0LCBnb3Q6ICR7Y29uZGl0aW9uc31gKVxuICB9XG5cbiAgY29uc3Qgc3ltYm9sS2V5cyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMoY29uZGl0aW9ucylcblxuICBpZiAoc3ltYm9sS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBzeW1ib2wgY29uZGl0aW9uIGtleXMgKGtleXM6ICR7c3ltYm9sS2V5cy5tYXAoKGtleSkgPT4ga2V5LnRvU3RyaW5nKCkpLmpvaW4oXCIsIFwiKX0pYClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgYXNzZXJ0IGRlZmluZWQgZmluZCBieSBjb25kaXRpb24gdmFsdWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmRpdGlvbiB2YWx1ZSB0byB2YWxpZGF0ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXlQYXRoIC0gS2V5IHBhdGggZm9yIGVycm9yIG91dHB1dC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnREZWZpbmVkRmluZEJ5Q29uZGl0aW9uVmFsdWUodmFsdWUsIGtleVBhdGgpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IHVuZGVmaW5lZCBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIikge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgZnVuY3Rpb24gY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN5bWJvbFwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBzeW1ib2wgY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcImJpZ2ludFwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBiaWdpbnQgY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmICFOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBub24tZmluaXRlIG51bWJlciBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHZhbHVlLmZvckVhY2goKGVudHJ5LCBpbmRleCkgPT4ge1xuICAgICAgYXNzZXJ0RGVmaW5lZEZpbmRCeUNvbmRpdGlvblZhbHVlKGVudHJ5LCBgJHtrZXlQYXRofVske2luZGV4fV1gKVxuICAgIH0pXG4gICAgcmV0dXJuXG4gIH1cblxuICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiKSB7XG4gICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3Qgb2JqZWN0VmFsdWUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHZhbHVlKVxuICAgIGNvbnN0IHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihvYmplY3RWYWx1ZSlcblxuICAgIGlmIChwcm90b3R5cGUgIT09IE9iamVjdC5wcm90b3R5cGUgJiYgcHJvdG90eXBlICE9PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IG5vbi1wbGFpbiBvYmplY3QgY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gICAgfVxuXG4gICAgY29uc3Qgc3ltYm9sS2V5cyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMob2JqZWN0VmFsdWUpXG5cbiAgICBpZiAoc3ltYm9sS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IHN5bWJvbCBjb25kaXRpb24ga2V5cyAoa2V5OiAke2tleVBhdGh9KWApXG4gICAgfVxuXG4gICAgY29uc3QgdmFsdWVPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHZhbHVlKVxuXG4gICAgT2JqZWN0LmtleXModmFsdWVPYmplY3QpLmZvckVhY2goKG5lc3RlZEtleSkgPT4ge1xuICAgICAgYXNzZXJ0RGVmaW5lZEZpbmRCeUNvbmRpdGlvblZhbHVlKHZhbHVlT2JqZWN0W25lc3RlZEtleV0sIGAke2tleVBhdGh9LiR7bmVzdGVkS2V5fWApXG4gICAgfSlcbiAgfVxufVxuXG4vKipcbiAqIEJhc2UgZnJvbnRlbmQgbW9kZWwuXG4gKlxuICogRGVmYXVsdHMgYXJlIGBhbnlgIHNvIHRoZSBiYXJlIGBGcm9udGVuZE1vZGVsQmFzZWAg4oCUIHVzZWQgdGhyb3VnaG91dCBhcyBhXG4gKiBjb25zdHJhaW50L3BhcmFtZXRlciB0eXBlIGZvciBcImFueSBmcm9udGVuZCBtb2RlbFwiIOKAlCBhY2NlcHRzIGdlbmVyYXRlZFxuICogc3ViY2xhc3NlcyBkZWNsYXJpbmcgdHlwZWQtYXR0cmlidXRlIGdlbmVyaWNzIChgRnJvbnRlbmRNb2RlbEJhc2U8WEF0dHJpYnV0ZXMsXG4gKiAuLi4+YCkuIEEgY29uY3JldGUgYFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT5gIGRlZmF1bHQgbWFrZXNcbiAqIHRob3NlIHN1YmNsYXNzZXMgZmFpbCBieSBpbnZhcmlhbmNlLiBTdWJjbGFzc2VzIHN0aWxsIHBhc3MgdGhlaXIgcHJlY2lzZVxuICogYXR0cmlidXRlIHR5cGVkZWZzLCBzbyB0eXBlZCBhY2Nlc3NvcnMga2VlcCB0aGVpciBwcmVjaXNpb24uXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW0F0dHJpYnV0ZXM9YW55XVxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtDcmVhdGVBdHRyaWJ1dGVzPWFueV1cbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbVXBkYXRlQXR0cmlidXRlcz1hbnldXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxCYXNlIHtcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIG1vZGVsTmFtZVxuXG4gIC8qKlxuICAgKiBBdXRvbG9hZC5cbiAgICogQHR5cGUge2Jvb2xlYW59IC0gR2xvYmFsIGF1dG8tYmF0Y2gtcHJlbG9hZCB0b2dnbGUuIEFwcHMgY2FuIG9wdCBvdXQgdmlhIEZyb250ZW5kTW9kZWxCYXNlLnNldEF1dG9sb2FkKGZhbHNlKS5cbiAgICovXG4gIHN0YXRpYyBfYXV0b2xvYWQgPSB0cnVlXG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF1dG9sb2FkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBhdXRvLWJhdGNoLXByZWxvYWQgb2YgcmVsYXRpb25zaGlwcyBvbiBsYXp5IGFjY2VzcyBpcyBlbmFibGVkIGdsb2JhbGx5LlxuICAgKi9cbiAgc3RhdGljIGdldEF1dG9sb2FkKCkgeyByZXR1cm4gRnJvbnRlbmRNb2RlbEJhc2UuX2F1dG9sb2FkIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYXV0b2xvYWQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbmV3VmFsdWUgLSBXaGV0aGVyIGF1dG8tYmF0Y2gtcHJlbG9hZCBvZiByZWxhdGlvbnNoaXBzIGlzIGVuYWJsZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHNldEF1dG9sb2FkKG5ld1ZhbHVlKSB7IEZyb250ZW5kTW9kZWxCYXNlLl9hdXRvbG9hZCA9IG5ld1ZhbHVlIH1cblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi9cbiAgX2F0dHJpYnV0ZXNcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwPEZyb250ZW5kTW9kZWxCYXNlLCBGcm9udGVuZE1vZGVsQmFzZSwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPj4gfCBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXA8RnJvbnRlbmRNb2RlbEJhc2UsIEZyb250ZW5kTW9kZWxCYXNlLCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+Pj59ICovXG4gIF9yZWxhdGlvbnNoaXBzXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0YWNobWVudEhhbmRsZT59ICovXG4gIF9hdHRhY2htZW50c1xuICAvKipcbiAgICogUmFpbHMtc3R5bGUgbmVzdGVkIGF0dHJpYnV0ZSBwYXlsb2FkcyBxdWV1ZWQgZm9yIHRoZSBuZXh0IHNhdmUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59XG4gICAqL1xuICBfcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXNcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1NldDxzdHJpbmc+IHwgbnVsbH0gKi9cbiAgX3NlbGVjdGVkQXR0cmlidXRlc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgX2lzTmV3UmVjb3JkXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtib29sZWFufSAqL1xuICBfbWFya2VkRm9yRGVzdHJ1Y3Rpb25cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovXG4gIF9wZXJzaXN0ZWRBdHRyaWJ1dGVzXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsQmFzZT4gfCB1bmRlZmluZWR9IC0gU2hhcmVkIHJlZmVyZW5jZSB0byBzaWJsaW5nIHJlY29yZHMgbG9hZGVkIGluIHRoZSBzYW1lIGJhdGNoLiBVc2VkIGJ5IGF1dG8tYmF0Y2gtcHJlbG9hZC5cbiAgICovXG4gIF9sb2FkQ29ob3J0XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7QXR0cmlidXRlcyB8IENyZWF0ZUF0dHJpYnV0ZXN9IFthdHRyaWJ1dGVzXSAtIEluaXRpYWwgYXR0cmlidXRlcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGF0dHJpYnV0ZXMpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG5cbiAgICBNb2RlbENsYXNzLmVuc3VyZUdlbmVyYXRlZEF0dGFjaG1lbnRNZXRob2RzKClcbiAgICB0aGlzLl9hdHRyaWJ1dGVzID0ge31cbiAgICB0aGlzLl9yZWxhdGlvbnNoaXBzID0ge31cbiAgICB0aGlzLl9hdHRhY2htZW50cyA9IHt9XG4gICAgdGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIHRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcyA9IG51bGxcbiAgICB0aGlzLl9pc05ld1JlY29yZCA9IHRydWVcbiAgICB0aGlzLl9tYXJrZWRGb3JEZXN0cnVjdGlvbiA9IGZhbHNlXG4gICAgdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgaWYgKGF0dHJpYnV0ZXMpIHRoaXMuYXNzaWduQXR0cmlidXRlcyhhdHRyaWJ1dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGdlbmVyYXRlZCBhdHRhY2htZW50IG1ldGhvZHMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIEVuc3VyZXMgYXR0YWNobWVudCBoZWxwZXIgbWV0aG9kcyBleGlzdCBvbiB0aGUgcHJvdG90eXBlLlxuICAgKi9cbiAgc3RhdGljIGVuc3VyZUdlbmVyYXRlZEF0dGFjaG1lbnRNZXRob2RzKCkge1xuICAgIGlmICh0aGlzLl9nZW5lcmF0ZWRBdHRhY2htZW50TWV0aG9kcykgcmV0dXJuXG5cbiAgICBjb25zdCBhdHRhY2htZW50cyA9IHRoaXMuYXR0YWNobWVudERlZmluaXRpb25zKClcbiAgICBjb25zdCBwcm90b3R5cGUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHRoaXMucHJvdG90eXBlKVxuXG4gICAgZm9yIChjb25zdCBhdHRhY2htZW50TmFtZSBvZiBPYmplY3Qua2V5cyhhdHRhY2htZW50cykpIHtcbiAgICAgIGlmICghKGF0dGFjaG1lbnROYW1lIGluIHByb3RvdHlwZSkpIHtcbiAgICAgICAgcHJvdG90eXBlW2F0dGFjaG1lbnROYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLl9nZW5lcmF0ZWRBdHRhY2htZW50TWV0aG9kcyA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIGNvbmZpZy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ30gLSBSZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgc3RhdGljIHJlc291cmNlQ29uZmlnKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcInJlc291cmNlQ29uZmlnKCkgbXVzdCBiZSBpbXBsZW1lbnRlZCBieSBzdWJjbGFzc2VzXCIpXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLXVucmVhY2hhYmxlXG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3Nlcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxDbGFzcyB8IHN0cmluZz59IC0gUmVsYXRpb25zaGlwIG1vZGVsIGNsYXNzZXMgKG9yIGNsYXNzIG5hbWUgc3RyaW5ncykga2V5ZWQgYnkgcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzKCkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGEgZnJvbnRlbmQgbW9kZWwgY2xhc3Mgc28gaXQgY2FuIGJlIHJlc29sdmVkIGJ5IG5hbWUgaW4gcmVsYXRpb25zaGlwIGxvb2t1cHMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gcmVnaXN0ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyTW9kZWwobW9kZWxDbGFzcykge1xuICAgIHJlZ2lzdGVyRnJvbnRlbmRNb2RlbChtb2RlbENsYXNzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmaW5lIHNjb3BlLlxuICAgKiBAcGFyYW0geyguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjYWxsYmFjayAtIFNjb3BlIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7KCguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxGcm9udGVuZE1vZGVsQ2xhc3M+KSAmIHtzY29wZTogKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIikuTW9kZWxTY29wZURlc2NyaXB0b3J9fSAtIFNjb3BlIGhlbHBlci5cbiAgICovXG4gIHN0YXRpYyBkZWZpbmVTY29wZShjYWxsYmFjaykge1xuICAgIHJldHVybiBkZWZpbmVNb2RlbFNjb3BlKHtcbiAgICAgIGNhbGxiYWNrLFxuICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgIHN0YXJ0UXVlcnk6ICgpID0+IHRoaXMucXVlcnkoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZSBhIHJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzcyB2YWx1ZSB0aGF0IG1heSBiZSBhIGNsYXNzIHJlZmVyZW5jZSBvciBhIHN0cmluZyBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzcyB8IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IHZhbHVlIC0gQ2xhc3Mgb3IgY2xhc3MgbmFtZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxDbGFzcyB8IG51bGx9IC0gUmVzb2x2ZWQgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgcmVzb2x2ZU1vZGVsQ2xhc3ModmFsdWUpIHtcbiAgICByZXR1cm4gcmVzb2x2ZUZyb250ZW5kTW9kZWxDbGFzcyh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBkZWZpbml0aW9ucy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHt0eXBlOiBcImJlbG9uZ3NUb1wiIHwgXCJoYXNPbmVcIiB8IFwiaGFzTWFueVwiLCBhdXRvbG9hZD86IGJvb2xlYW59Pn0gLSBSZWxhdGlvbnNoaXAgZGVmaW5pdGlvbnMga2V5ZWQgYnkgcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwRGVmaW5pdGlvbnMoKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2htZW50IGRlZmluaXRpb25zLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREZWZpbml0aW9uPn0gLSBBdHRhY2htZW50IGRlZmluaXRpb25zIGtleWVkIGJ5IGF0dGFjaG1lbnQgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBhdHRhY2htZW50RGVmaW5pdGlvbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMucmVzb3VyY2VDb25maWcoKS5hdHRhY2htZW50cyB8fCB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNobWVudCBkZWZpbml0aW9uLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQXR0YWNobWVudERlZmluaXRpb24gfCBudWxsfSAtIEF0dGFjaG1lbnQgZGVmaW5pdGlvbi5cbiAgICovXG4gIHN0YXRpYyBhdHRhY2htZW50RGVmaW5pdGlvbihhdHRhY2htZW50TmFtZSkge1xuICAgIHJldHVybiB0aGlzLmF0dGFjaG1lbnREZWZpbml0aW9ucygpW2F0dGFjaG1lbnROYW1lXSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbi5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge3t0eXBlOiBcImJlbG9uZ3NUb1wiIHwgXCJoYXNPbmVcIiB8IFwiaGFzTWFueVwiLCBhdXRvbG9hZD86IGJvb2xlYW59IHwgbnVsbH0gLSBSZWxhdGlvbnNoaXAgZGVmaW5pdGlvbi5cbiAgICovXG4gIHN0YXRpYyByZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBjb25zdCBkZWZpbml0aW9ucyA9IHRoaXMucmVsYXRpb25zaGlwRGVmaW5pdGlvbnMoKVxuXG4gICAgcmV0dXJuIGRlZmluaXRpb25zW3JlbGF0aW9uc2hpcE5hbWVdIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIFJhaWxzLXN0eWxlIG5lc3RlZCBhdHRyaWJ1dGVzIGtleSB0byBhIGNvbmZpZ3VyZWQgcmVsYXRpb25zaGlwLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIENhbmRpZGF0ZSBhdHRyaWJ1dGUgbmFtZSwgc3VjaCBhcyBgdGFza3NBdHRyaWJ1dGVzYC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IFJlbGF0aW9uc2hpcCBuYW1lIHdoZW4gbmVzdGVkIGF0dHJpYnV0ZXMgYXJlIGNvbmZpZ3VyZWQuXG4gICAqL1xuICBzdGF0aWMgbmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUoYXR0cmlidXRlTmFtZSkge1xuICAgIGlmICghYXR0cmlidXRlTmFtZS5lbmRzV2l0aChcIkF0dHJpYnV0ZXNcIikpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCByZWxhdGlvbnNoaXBOYW1lID0gYXR0cmlidXRlTmFtZS5zbGljZSgwLCAtXCJBdHRyaWJ1dGVzXCIubGVuZ3RoKVxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXNDb25maWcgPSB0aGlzLnJlc291cmNlQ29uZmlnKCkubmVzdGVkQXR0cmlidXRlcyB8fCB7fVxuXG4gICAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnLCByZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgPyByZWxhdGlvbnNoaXBOYW1lXG4gICAgICA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxDbGFzcyB8IG51bGx9IC0gVGFyZ2V0IHJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIHN0YXRpYyByZWxhdGlvbnNoaXBNb2RlbENsYXNzKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBNb2RlbENsYXNzZXMgPSB0aGlzLnJlbGF0aW9uc2hpcE1vZGVsQ2xhc3NlcygpXG4gICAgY29uc3QgdmFsdWUgPSByZWxhdGlvbnNoaXBNb2RlbENsYXNzZXNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgIHJldHVybiBGcm9udGVuZE1vZGVsQmFzZS5yZXNvbHZlTW9kZWxDbGFzcyh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtBdHRyaWJ1dGVzfSAtIEF0dHJpYnV0ZXMgaGFzaC5cbiAgICovXG4gIGF0dHJpYnV0ZXMoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7QXR0cmlidXRlc30gKi8gKHRoaXMuX2F0dHJpYnV0ZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBuZXcgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgbW9kZWwgaGFzIG5vdCB5ZXQgYmVlbiBwZXJzaXN0ZWQuXG4gICAqL1xuICBpc05ld1JlY29yZCgpIHtcbiAgICByZXR1cm4gdGhpcy5faXNOZXdSZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIHBlcnNpc3RlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIG1vZGVsIGhhcyBiZWVuIHBlcnNpc3RlZC5cbiAgICovXG4gIGlzUGVyc2lzdGVkKCkge1xuICAgIHJldHVybiAhdGhpcy5pc05ld1JlY29yZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgaXMgbmV3IHJlY29yZC5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdJc05ld1JlY29yZCAtIE5ldyBwZXJzaXN0ZWQtc3RhdGUgZmxhZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRJc05ld1JlY29yZChuZXdJc05ld1JlY29yZCkge1xuICAgIHRoaXMuX2lzTmV3UmVjb3JkID0gbmV3SXNOZXdSZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXJrcyB0aGlzIHJlY29yZCBmb3IgZGVzdHJ1Y3Rpb24gd2hlbiBpdHMgcGFyZW50IGlzIG5leHQgc2F2ZWQgdGhyb3VnaFxuICAgKiBuZXN0ZWQtYXR0cmlidXRlIHN1cHBvcnQuIFRoZSByZWNvcmQgaXMgbm90IHJlbW92ZWQgZnJvbSB0aGUgcGFyZW50J3NcbiAgICogcmVsYXRpb25zaGlwIGNvbGxlY3Rpb24gdW50aWwgdGhlIHNlcnZlciBjb25maXJtcyB0aGUgZGVsZXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBtYXJrRm9yRGVzdHJ1Y3Rpb24oKSB7XG4gICAgdGhpcy5fbWFya2VkRm9yRGVzdHJ1Y3Rpb24gPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrZWQgZm9yIGRlc3RydWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgcmVjb3JkIGlzIHF1ZXVlZCBmb3IgbmVzdGVkIGRlc3RydWN0aW9uIG9uIG5leHQgcGFyZW50IHNhdmUuXG4gICAqL1xuICBtYXJrZWRGb3JEZXN0cnVjdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fbWFya2VkRm9yRGVzdHJ1Y3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNoYW5nZXMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIENoYW5nZWQgYXR0cmlidXRlcyBhcyBgW29sZFZhbHVlLCBuZXdWYWx1ZV1gLlxuICAgKi9cbiAgY2hhbmdlcygpIHtcbiAgICAvKipcbiAgICAgKiBDaGFuZ2VkIGF0dHJpYnV0ZXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgY29uc3QgY2hhbmdlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gbmV3IFNldChbXG4gICAgICAuLi5PYmplY3Qua2V5cyh0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzKSxcbiAgICAgIC4uLk9iamVjdC5rZXlzKHRoaXMuX2F0dHJpYnV0ZXMpXG4gICAgXSlcblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBhdHRyaWJ1dGVOYW1lcykge1xuICAgICAgY29uc3QgcHJldmlvdXNWYWx1ZSA9IHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cbiAgICAgIGNvbnN0IGN1cnJlbnRWYWx1ZSA9IHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cblxuICAgICAgaWYgKEpTT04uc3RyaW5naWZ5KHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShwcmV2aW91c1ZhbHVlKSkgIT09IEpTT04uc3RyaW5naWZ5KHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShjdXJyZW50VmFsdWUpKSkge1xuICAgICAgICBjaGFuZ2VkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IFtwcmV2aW91c1ZhbHVlLCBjdXJyZW50VmFsdWVdXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYW5nZWRBdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBjaGFuZ2VkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGFueSB0cmFja2VkIGF0dHJpYnV0ZSBoYXMgY2hhbmdlZC5cbiAgICovXG4gIGlzQ2hhbmdlZCgpIHtcbiAgICByZXR1cm4gT2JqZWN0LmtleXModGhpcy5jaGFuZ2VzKCkpLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZWxhdGlvbnNoaXAgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXB9IC0gUmVsYXRpb25zaGlwIHN0YXRlIG9iamVjdC5cbiAgICovXG4gIGdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgaWYgKCF0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdKSB7XG4gICAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBEZWZpbml0aW9uID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBNb2RlbENsYXNzKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXBEZWZpbml0aW9uICYmIHJlbGF0aW9uc2hpcFR5cGVJc0NvbGxlY3Rpb24ocmVsYXRpb25zaGlwRGVmaW5pdGlvbi50eXBlKSkge1xuICAgICAgICB0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdID0gbmV3IEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwKHRoaXMsIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3MpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdID0gbmV3IEZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcCh0aGlzLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXR0YWNobWVudCBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQXR0YWNobWVudEhhbmRsZX0gLSBBdHRhY2htZW50IGhlbHBlci5cbiAgICovXG4gIGdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKGF0dGFjaG1lbnROYW1lKVxuXG4gICAgaWYgKCFhdHRhY2htZW50RGVmaW5pdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGF0dGFjaG1lbnQ6ICR7TW9kZWxDbGFzcy5uYW1lfSMke2F0dGFjaG1lbnROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0pIHtcbiAgICAgIHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXSA9IG5ldyBGcm9udGVuZE1vZGVsQXR0YWNobWVudEhhbmRsZSh7XG4gICAgICAgIGF0dGFjaG1lbnROYW1lLFxuICAgICAgICBtb2RlbDogdGhpc1xuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRNb2RlbEJhc2UgfCBBcnJheTxGcm9udGVuZE1vZGVsQmFzZT4gfCBudWxsPn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgbG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGlkID0gdGhpcy5wcmltYXJ5S2V5VmFsdWUoKVxuICAgIGNvbnN0IHJlbG9hZGVkTW9kZWwgPSBhd2FpdCBNb2RlbENsYXNzXG4gICAgICAucHJlbG9hZChbcmVsYXRpb25zaGlwTmFtZV0pXG4gICAgICAuZmluZChpZClcbiAgICBjb25zdCBzb3VyY2VSZWxhdGlvbnNoaXAgPSByZWxvYWRlZE1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgIGNvbnN0IHRhcmdldFJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBjb3B5TG9hZGVkUmVsYXRpb25zaGlwVmFsdWUoe3NvdXJjZVJlbGF0aW9uc2hpcCwgdGFyZ2V0UmVsYXRpb25zaGlwfSlcblxuICAgIHJldHVybiB0YXJnZXRSZWxhdGlvbnNoaXAubG9hZGVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVsb2FkcyByZWxhdGlvbnNoaXAocykgb250byB0aGlzIGFscmVhZHktbG9hZGVkIHJlY29yZC4gQWNjZXB0cyBlaXRoZXIgYVxuICAgKiBxdWVyeSBidWlsdCB2aWEgYE1vZGVsLnByZWxvYWQoLi4uKS5zZWxlY3QoLi4uKWAgb3IgYSByYXcgcHJlbG9hZCBzcGVjXG4gICAqIChzdHJpbmcgLyBhcnJheSAvIG5lc3RlZCBvYmplY3QpLiBSZWxhdGlvbnNoaXBzIGFscmVhZHkgcHJlbG9hZGVkIHdpdGggdGhlXG4gICAqIHJlcXVpcmVkIGNvbHVtbnMgcHJlc2VudCBhcmUgbGVmdCB1bnRvdWNoZWQgdW5sZXNzIGBmb3JjZWAgaXMgc2V0LiBDYXJyaWVzXG4gICAqIHRoZSBxdWVyeSdzIHByZWxvYWQgZ3JhcGgsIHNlbGVjdCwgc2VsZWN0c0V4dHJhLCB3aXRoQ291bnQsIGFiaWxpdGllcywgYW5kXG4gICAqIHF1ZXJ5RGF0YSB3aGVuIHJlLWZldGNoaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxGcm9udGVuZE1vZGVsQ2xhc3M+IHwgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQ+fSBxdWVyeU9yU3BlYyAtIFByZWxvYWQgc291cmNlLlxuICAgKiBAcGFyYW0ge3tmb3JjZT86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBPcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHByZWxvYWRpbmcgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgcHJlbG9hZChxdWVyeU9yU3BlYywgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgRnJvbnRlbmRNb2RlbFByZWxvYWRlci5wcmVsb2FkKFt0aGlzXSwgcXVlcnlPclNwZWMsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgb3IgbG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRNb2RlbEJhc2UgfCBBcnJheTxGcm9udGVuZE1vZGVsQmFzZT4gfCBudWxsPn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgcmVsYXRpb25zaGlwT3JMb2FkKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRQcmVsb2FkZWQoKSkge1xuICAgICAgcmV0dXJuIHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuICAgIH1cblxuICAgIGNvbnN0IGJhdGNoZWQgPSBhd2FpdCB0aGlzLl90cnlDb2hvcnRQcmVsb2FkKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoYmF0Y2hlZCkgcmV0dXJuIHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0dGVtcHRzIHRvIGJhdGNoLWxvYWQgYHJlbGF0aW9uc2hpcE5hbWVgIGFjcm9zcyBjb2hvcnQgc2libGluZ3MgdmlhIGFcbiAgICogc2luZ2xlIGBwcmVsb2FkKFtuYW1lXSkud2hlcmUoe3BrOiBbaWRzXX0pLnRvQXJyYXkoKWAgcmVxdWVzdCwgdGhlbiBjb3BpZXNcbiAgICogdGhlIHByZWxvYWRlZCByZWxhdGlvbnNoaXAgc3RhdGUgb250byBlYWNoIHNpYmxpbmcuIFJldHVybnMgdHJ1ZSB3aGVuIGFcbiAgICogYmF0Y2ggcmFuLCBmYWxzZSB3aGVuIGF1dG9sb2FkIGlzIG9mZiwgdGhlcmUgaXMgbm8gY29ob3J0LCBvciBubyBiYXRjaFxuICAgKiBjYW5kaWRhdGVzIHJlbWFpbi4gU2libGluZ3Mgd2hvc2UgcmVsYXRpb25zaGlwIHN0YXRlIGlzIGFscmVhZHkgc2V0XG4gICAqIChwcmVsb2FkZWQgb3IgbG9jYWxseSBtYW5pcHVsYXRlZCB2aWEgYGJ1aWxkYCAvIGBzZXRSZWxhdGlvbnNoaXBgKSBhcmVcbiAgICogc2tpcHBlZCBzbyB0aGVpciBjYWNoZWQvZWRpdGVkIHZhbHVlIGlzIHByZXNlcnZlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhIGNvaG9ydCBiYXRjaCBwcmVsb2FkIHJhbi5cbiAgICovXG4gIGFzeW5jIF90cnlDb2hvcnRQcmVsb2FkKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBpZiAoIUZyb250ZW5kTW9kZWxCYXNlLmdldEF1dG9sb2FkKCkpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGNvaG9ydCA9IHRoaXMuX2xvYWRDb2hvcnRcblxuICAgIGlmICghY29ob3J0IHx8IGNvaG9ydC5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBkZWZpbml0aW9uID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIWRlZmluaXRpb24pIHJldHVybiBmYWxzZVxuICAgIGlmIChkZWZpbml0aW9uLmF1dG9sb2FkID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlXG5cbiAgICAvKipcbiAgICAgKiBCYXRjaC5cbiAgICAgKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+fSAqL1xuICAgIGNvbnN0IGJhdGNoID0gW11cblxuICAgIC8vIEV4YWN0IHNhbWUgY2xhc3MsIHBlcnNpc3RlZCwgbm8gZXhpc3RpbmcgaW4tbWVtb3J5IHJlbGF0aW9uc2hpcCBzdGF0ZS5cbiAgICAvLyBgc2V0TG9hZGVkYCBzZXRzIGBfcHJlbG9hZGVkID0gdHJ1ZWAgb24gZXZlcnkgbXV0YXRpb24gcGF0aCAocHJlbG9hZCxcbiAgICAvLyBzZXRSZWxhdGlvbnNoaXAsIGJ1aWxkLCBhZGRUb0xvYWRlZCksIHNvIGBnZXRQcmVsb2FkZWQoKWAgYWxvbmUgaXMgYVxuICAgIC8vIHJlbGlhYmxlIFwiYWxyZWFkeSB0b3VjaGVkXCIgc2lnbmFsIG9uIHRoZSBmcm9udGVuZC5cbiAgICBmb3IgKGNvbnN0IHNpYmxpbmcgb2YgY29ob3J0KSB7XG4gICAgICBpZiAoc2libGluZy5jb25zdHJ1Y3RvciAhPT0gTW9kZWxDbGFzcykgY29udGludWVcbiAgICAgIGlmIChzaWJsaW5nLmlzTmV3UmVjb3JkKCkpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHNpYmxpbmdSZWxhdGlvbnNoaXAgPSBzaWJsaW5nLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICBpZiAoc2libGluZ1JlbGF0aW9uc2hpcC5nZXRQcmVsb2FkZWQoKSkgY29udGludWVcblxuICAgICAgYmF0Y2gucHVzaChzaWJsaW5nKVxuICAgIH1cblxuICAgIGlmIChiYXRjaC5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBiYXRjaElkcyA9IGJhdGNoLm1hcCgoc2libGluZykgPT4gc2libGluZy5wcmltYXJ5S2V5VmFsdWUoKSlcbiAgICBjb25zdCByZWxvYWRlZEJhdGNoID0gYXdhaXQgTW9kZWxDbGFzc1xuICAgICAgLnByZWxvYWQoW3JlbGF0aW9uc2hpcE5hbWVdKVxuICAgICAgLndoZXJlKHtbcHJpbWFyeUtleV06IGJhdGNoSWRzfSlcbiAgICAgIC50b0FycmF5KClcblxuICAgIC8qKlxuICAgICAqIFJlbG9hZGVkIGJ5IGlkLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBGcm9udGVuZE1vZGVsQmFzZT59ICovXG4gICAgY29uc3QgcmVsb2FkZWRCeUlkID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IHJlbG9hZGVkIG9mIHJlbG9hZGVkQmF0Y2gpIHtcbiAgICAgIHJlbG9hZGVkQnlJZC5zZXQobW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcmVsb2FkZWQucHJpbWFyeUtleVZhbHVlKCkpLCByZWxvYWRlZClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHNpYmxpbmcgb2YgYmF0Y2gpIHtcbiAgICAgIGNvbnN0IGtleSA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHNpYmxpbmcucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgICBjb25zdCByZWxvYWRlZCA9IHJlbG9hZGVkQnlJZC5nZXQoa2V5KVxuXG4gICAgICBpZiAoIXJlbG9hZGVkKSBjb250aW51ZVxuXG4gICAgICBjb3B5TG9hZGVkUmVsYXRpb25zaGlwVmFsdWUoe1xuICAgICAgICBzb3VyY2VSZWxhdGlvbnNoaXA6IHJlbG9hZGVkLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKSxcbiAgICAgICAgdGFyZ2V0UmVsYXRpb25zaGlwOiBzaWJsaW5nLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICAvLyBJZiB0aGUgY2FsbGVyIGl0c2VsZiB3YXMgbm90IHBvcHVsYXRlZCAocmVjb3JkIGRlbGV0ZWQvZmlsdGVyZWQgYmV0d2VlblxuICAgIC8vIHRoZSBsaXN0IGZldGNoIGFuZCB0aGlzIHByZWxvYWQgcmVxdWVzdCksIGZhbGwgYmFjayB0byBwZXItcmVjb3JkIGxvYWRcbiAgICAvLyBzbyB0aGUgY2FsbGVyIGdldHMgYSByZWFsIG5vdC1mb3VuZCBlcnJvciBpbnN0ZWFkIG9mIGEgbWlzbGVhZGluZ1xuICAgIC8vIFwiaGFzbid0IGJlZW4gcHJlbG9hZGVkXCIgdGhyb3cgZnJvbSBsb2FkZWQoKS5cbiAgICBpZiAoIXRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpLmdldFByZWxvYWRlZCgpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlIHwgbnVsbCB8IHVuZGVmaW5lZH0gcmVsYXRpb25zaGlwVmFsdWUgLSBSZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQmFzZSB8IG51bGwgfCB1bmRlZmluZWR9IC0gQXNzaWduZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgc2V0UmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcFZhbHVlKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcERlZmluaXRpb24gPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcERlZmluaXRpb24ocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmICghcmVsYXRpb25zaGlwRGVmaW5pdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHJlbGF0aW9uc2hpcDogJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAocmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHNldCBoYXMtbWFueSByZWxhdGlvbnNoaXAgd2l0aCBzZXRSZWxhdGlvbnNoaXAoKTogJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIHJlbGF0aW9uc2hpcC5zZXRMb2FkZWQocmVsYXRpb25zaGlwVmFsdWUpXG5cbiAgICByZXR1cm4gcmVsYXRpb25zaGlwVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2lnbiBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0F0dHJpYnV0ZXMgfCBDcmVhdGVBdHRyaWJ1dGVzIHwgVXBkYXRlQXR0cmlidXRlcyB8IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59IGF0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzIHRvIGFzc2lnbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYXNzaWduQXR0cmlidXRlcyhhdHRyaWJ1dGVzKSB7XG4gICAgY29uc3QgYXR0cmlidXRlVmFsdWVzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoYXR0cmlidXRlcylcblxuICAgIGZvciAoY29uc3Qga2V5IGluIGF0dHJpYnV0ZVZhbHVlcykge1xuICAgICAgdGhpcy5zZXRBdHRyaWJ1dGUoa2V5LCBhdHRyaWJ1dGVWYWx1ZXNba2V5XSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciByZWxhdGlvbnNoaXAgY2FjaGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIENsZWFycyBjYWNoZWQgcmVsYXRpb25zaGlwIHN0YXRlLlxuICAgKi9cbiAgY2xlYXJSZWxhdGlvbnNoaXBDYWNoZSgpIHtcbiAgICB0aGlzLl9yZWxhdGlvbnNoaXBzID0ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW1hcnkga2V5LlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn0gLSBQcmltYXJ5IGtleSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIHByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIHRoaXMucmVzb3VyY2VDb25maWcoKS5wcmltYXJ5S2V5IHx8IFwiaWRcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbWFyeSBrZXkgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gLSBQcmltYXJ5IGtleSB2YWx1ZS5cbiAgICovXG4gIHByaW1hcnlLZXlWYWx1ZSgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG5cbiAgICByZXR1cm4gcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKHByaW1hcnlLZXksIChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IHRoaXMucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgcHJpbWFyeSBrZXkgJyR7YXR0cmlidXRlTmFtZX0nIG9uICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB2YWx1ZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgaWRlbnRpdHkgcmVwcmVzZW50ZWQgYnkgdGhlIGxhc3QgcGVyc2lzdGVkIGZyb250ZW5kIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gLSBQZXJzaXN0ZWQgcHJpbWFyeS1rZXkgdmFsdWUuXG4gICAqL1xuICBwZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgcmV0dXJuIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgY29uc3QgdmFsdWUgPSB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBwZXJzaXN0ZWQgcHJpbWFyeSBrZXkgJyR7YXR0cmlidXRlTmFtZX0nIG9uICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB2YWx1ZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEF0dHJpYnV0ZSB2YWx1ZS5cbiAgICovXG4gIHJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkge1xuICAgIGlmICh0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMgJiYgIXRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcy5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBBdHRyaWJ1dGVOb3RTZWxlY3RlZEVycm9yKHRoaXMuY29uc3RydWN0b3IubmFtZSwgYXR0cmlidXRlTmFtZSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYW4gYXR0cmlidXRlIHZhbHVlIGlzIGN1cnJlbnRseSBsb2FkZWQgb24gdGhpcyByZWNvcmQuIFVzZWQgYnkgdGhlXG4gICAqIHByZWxvYWRlciB0byBkZWNpZGUgd2hldGhlciBhIHJlbGF0aW9uc2hpcCBjYW4gYmUgc2tpcHBlZCBiZWNhdXNlIHRoZVxuICAgKiByZXF1ZXN0ZWQgY29sdW1ucyBhcmUgYWxyZWFkeSBwcmVzZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBhdHRyaWJ1dGUgaXMgbG9hZGVkLlxuICAgKi9cbiAgaGFzTG9hZGVkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAoIXRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcykgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiB0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMuaGFzKGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhbiBhc3NvY2lhdGlvbiBjb3VudCBhdHRhY2hlZCBieSBgLndpdGhDb3VudCguLi4pYC4gQ291bnRzXG4gICAqIGxpdmUgb24gYSBkZWRpY2F0ZWQgbWFwIHNlcGFyYXRlIGZyb20gdGhlIHJlY29yZCdzIGF0dHJpYnV0ZXMgc29cbiAgICogYSB2aXJ0dWFsIGNvdW50IGxpa2UgYHRhc2tzQ291bnRgIGNhbid0IHNpbGVudGx5IHNoYWRvdyBhIHJlYWxcbiAgICogY29sdW1uIG9mIHRoZSBzYW1lIG5hbWUuIFJldHVybnMgdGhlIGF0dGFjaGVkIHZhbHVlLCBvciAwIHdoZW5cbiAgICogYC53aXRoQ291bnQoLi4uKWAgd2Fzbid0IHJlcXVlc3RlZCBmb3IgdGhpcyBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUsIGUuZy4gYFwidGFza3NDb3VudFwiYCBvciBhIGN1c3RvbSBuYW1lIGZyb20gYC53aXRoQ291bnQoe2N1c3RvbU5hbWU6IHsuLi59fSlgLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEF0dGFjaGVkIGFzc29jaWF0aW9uIGNvdW50LCBvciB6ZXJvIHdoZW4gYWJzZW50LlxuICAgKi9cbiAgcmVhZENvdW50KGF0dHJpYnV0ZU5hbWUpIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRBc3NvY2lhdGlvbkNvdW50KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhdHRyaWJ1dGVOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIHNldHRlciBjYWxsZWQgYnkgYGluc3RhbnRpYXRlRnJvbVJlc3BvbnNlYCB3aGVuIGh5ZHJhdGluZ1xuICAgKiBhc3NvY2lhdGlvbiBjb3VudHMgdGhhdCByb2RlIGFsb25nIHdpdGggdGhlIHJlY29yZCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBDb3VudCB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0QXNzb2NpYXRpb25Db3VudChhdHRyaWJ1dGVOYW1lLCB2YWx1ZSkge1xuICAgIHNldFBheWxvYWRBc3NvY2lhdGlvbkNvdW50KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhdHRyaWJ1dGVOYW1lLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGEgcGVyLXJlY29yZCBhYmlsaXR5IHJlc3VsdCBhdHRhY2hlZCBieSBgLmFiaWxpdGllcyguLi4pYC4gVGhlXG4gICAqIGJhY2tlbmQgZXZhbHVhdGVzIGVhY2ggcmVxdWVzdGVkIGFjdGlvbiBhZ2FpbnN0IHRoZSBjdXJyZW50XG4gICAqIGFiaWxpdHkgZm9yIHRoaXMgcmVjb3JkIGluc3RhbmNlIGFuZCBzaGlwcyB0aGUgcmVzdWx0IGFsb25nc2lkZVxuICAgKiB0aGUgcmVjb3JkJ3MgYXR0cmlidXRlcy4gUmV0dXJucyBgZmFsc2VgIHdoZW4gdGhlIGFjdGlvbiB3YXNuJ3RcbiAgICogcmVxdWVzdGVkIChvciB0aGUgYWJpbGl0eSBkZW5pZWQgaXQpLCBzbyBVSSBjb2RlIGNhbiBzYWZlbHkgYnJhbmNoXG4gICAqIG9uIGByZWNvcmQuY2FuKFwidXBkYXRlXCIpYCB3aXRob3V0IGZpcnN0IGNoZWNraW5nIHdoZXRoZXIgdGhlXG4gICAqIGFiaWxpdHkgd2FzIGxvYWRlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEFiaWxpdHkgYWN0aW9uIG5hbWUsIGUuZy4gYFwidXBkYXRlXCJgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXF1ZXN0ZWQgYWJpbGl0eSBpcyBhbGxvd2VkLlxuICAgKi9cbiAgY2FuKGFjdGlvbikge1xuICAgIHJldHVybiByZWFkUGF5bG9hZENvbXB1dGVkQWJpbGl0eSgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIHNldHRlciBjYWxsZWQgYnkgYGluc3RhbnRpYXRlRnJvbVJlc3BvbnNlYCB3aGVuIGh5ZHJhdGluZ1xuICAgKiBwZXItcmVjb3JkIGFiaWxpdHkgcmVzdWx0cyB0aGF0IHJvZGUgYWxvbmcgd2l0aCB0aGUgcmVjb3JkXG4gICAqIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbiBuYW1lLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IHZhbHVlIC0gV2hldGhlciB0aGUgY3VycmVudCBhYmlsaXR5IHBlcm1pdHMgdGhlIGFjdGlvbiBvbiB0aGlzIHJlY29yZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0Q29tcHV0ZWRBYmlsaXR5KGFjdGlvbiwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhY3Rpb24sIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgYSBjb25zdW1lci1kZWZpbmVkIHZhbHVlIGF0dGFjaGVkIGJ5IGAucXVlcnlEYXRhKC4uLilgLiBTdG9yZWRcbiAgICogb24gYSBkZWRpY2F0ZWQgbWFwIHJhdGhlciB0aGFuIGBfYXR0cmlidXRlc2AsIHNvIGEgdmlydHVhbCBhbGlhc1xuICAgKiBsaWtlIGB0YXNrc0NvdW50YCBjYW5ub3Qgc2lsZW50bHkgc2hhZG93IGEgcmVhbCBjb2x1bW4gb2YgdGhlIHNhbWVcbiAgICogbmFtZS4gUmV0dXJucyBgbnVsbGAgd2hlbiBubyByZWdpc3RlcmVkIGZuIHByb2R1Y2VkIHRoYXQgYWxpYXMgZm9yXG4gICAqIHRoaXMgcmVjb3JkIChlLmcuIG5vIGNoaWxkIHJvd3MgbWF0Y2hlZCB0aGUgYWdncmVnYXRlKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBxdWVyeURhdGEgYWxpYXMgbmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEF0dGFjaGVkIHF1ZXJ5LWRhdGEgdmFsdWUuXG4gICAqL1xuICBxdWVyeURhdGEobmFtZSkge1xuICAgIHJldHVybiByZWFkUGF5bG9hZFF1ZXJ5RGF0YSgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgbmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBzZXR0ZXIgdXNlZCBieSBgaW5zdGFudGlhdGVGcm9tUmVzcG9uc2VgIHdoZW4gaHlkcmF0aW5nXG4gICAqIHF1ZXJ5RGF0YSB2YWx1ZXMgdGhhdCByb2RlIGFsb25nIHdpdGggdGhlIHJlY29yZCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIHF1ZXJ5RGF0YSBhbGlhcyBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIEF0dGFjaGVkIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRRdWVyeURhdGEobmFtZSwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkUXVlcnlEYXRhKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBuYW1lLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG5ld1ZhbHVlIC0gTmV3IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQXNzaWduZWQgdmFsdWUuXG4gICAqL1xuICBzZXRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSwgbmV3VmFsdWUpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUgPSBNb2RlbENsYXNzLm5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICBpZiAobmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzW25lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lXSA9IG5ld1ZhbHVlXG4gICAgICByZXR1cm4gbmV3VmFsdWVcbiAgICB9XG5cbiAgICBpZiAoTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbihhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dHJpYnV0ZU5hbWUpLnF1ZXVlQXR0YWNoKG5ld1ZhbHVlKVxuICAgICAgcmV0dXJuIG5ld1ZhbHVlXG4gICAgfVxuXG4gICAgY29uc3QgcHJldmlvdXNWYWx1ZSA9IHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cblxuICAgIHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBuZXdWYWx1ZVxuXG4gICAgaWYgKHRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcykge1xuICAgICAgdGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzLmFkZChhdHRyaWJ1dGVOYW1lKVxuICAgIH1cblxuICAgIC8vIE9ubHkgaW52YWxpZGF0ZSByZWxhdGlvbnNoaXAgY2FjaGUgZW50cmllcyB3aG9zZSBmb3JlaWduIGtleSBtYXRjaGVzIHRoZSBjaGFuZ2VkIGF0dHJpYnV0ZS5cbiAgICAvLyBCbGFua2V0LWNsZWFyaW5nIGFsbCByZWxhdGlvbnNoaXBzIG9uIGFueSBhdHRyaWJ1dGUgY2hhbmdlIGRlc3Ryb3lzIG5lc3RlZC1zYXZlIHN0YXRlXG4gICAgLy8gYW5kIHByZWxvYWRlZCBjaGlsZHJlbiB0aGUgY2FsbGVyIG5ldmVyIGFza2VkIHRvIGludmFsaWRhdGUuXG4gICAgaWYgKCFPYmplY3QuaXMocHJldmlvdXNWYWx1ZSwgbmV3VmFsdWUpKSB7XG4gICAgICB0aGlzLl9pbnZhbGlkYXRlUmVsYXRpb25zaGlwc0ZvckF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKVxuICAgIH1cblxuICAgIHJldHVybiBuZXdWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIEludmFsaWRhdGVzIGFueSBjYWNoZWQgYmVsb25nc1RvIHJlbGF0aW9uc2hpcCB3aG9zZSBmb3JlaWduIGtleSBtYXRjaGVzIHRoZVxuICAgKiBjaGFuZ2VkIGF0dHJpYnV0ZS4gSGFzTWFueSAvIGhhc09uZSByZWxhdGlvbnNoaXBzIGFyZSBsZWZ0IHVudG91Y2hlZCBiZWNhdXNlXG4gICAqIHRoZWlyIGZvcmVpZ24ga2V5IGxpdmVzIG9uIHRoZSBjaGlsZCwgbm90IG9uIHRoaXMgbW9kZWwsIGFuZCBibGFua2V0LWNsZWFyaW5nXG4gICAqIHRoZW0gd291bGQgZGVzdHJveSBuZXN0ZWQtc2F2ZSBzdGF0ZSBhbmQgcHJlbG9hZGVkIGNoaWxkcmVuIHRoZSBjYWxsZXIgbmV2ZXJcbiAgICogYXNrZWQgdG8gaW52YWxpZGF0ZS5cbiAgICpcbiAgICogRm9yZWlnbiBrZXlzIGFyZSBpbmZlcnJlZCB3aGVuIG5vdCBkZWNsYXJlZDogZm9yIGJlbG9uZ3NUbyBgcHJvamVjdElkYCBpc1xuICAgKiBpbmZlcnJlZCBmcm9tIHJlbGF0aW9uc2hpcCBuYW1lIGBwcm9qZWN0YC4gRXhwbGljaXQgYGZvcmVpZ25LZXlgIG9uIHRoZVxuICAgKiByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbiB0YWtlcyBwcmVjZWRlbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lIHRoYXQgY2hhbmdlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaW52YWxpZGF0ZVJlbGF0aW9uc2hpcHNGb3JBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkge1xuICAgIGlmICghdGhpcy5fcmVsYXRpb25zaGlwcyB8fCBPYmplY3Qua2V5cyh0aGlzLl9yZWxhdGlvbnNoaXBzKS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGRlZmluaXRpb25zID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9ucygpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXModGhpcy5fcmVsYXRpb25zaGlwcykpIHtcbiAgICAgIGNvbnN0IGRlZmluaXRpb24gPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZGVmaW5pdGlvbnNbcmVsYXRpb25zaGlwTmFtZV0pXG5cbiAgICAgIGlmICghZGVmaW5pdGlvbiB8fCBkZWZpbml0aW9uLnR5cGUgIT09IFwiYmVsb25nc1RvXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGZvcmVpZ25LZXkgPSBkZWZpbml0aW9uLmZvcmVpZ25LZXkgfHwgYCR7cmVsYXRpb25zaGlwTmFtZX1JZGBcblxuICAgICAgaWYgKGZvcmVpZ25LZXkgPT09IGF0dHJpYnV0ZU5hbWUpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMuX3JlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBwYXRoLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERlcml2ZWQgcmVzb3VyY2UgcGF0aC5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZVBhdGgoKSB7XG4gICAgcmV0dXJuIHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aCh7XG4gICAgICBtb2RlbE5hbWU6IHRoaXMuZ2V0TW9kZWxOYW1lKCksXG4gICAgICByZXNvdXJjZVBhdGg6IGRlZmF1bHRGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKHRoaXMpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbW1hbmQgbmFtZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGV9IGNvbW1hbmRUeXBlIC0gQ29tbWFuZCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlc29sdmVkIGNvbW1hbmQgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBjb21tYW5kTmFtZShjb21tYW5kVHlwZSkge1xuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHJlc291cmNlQ29uZmlnLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgfHwgW11cbiAgICBjb25zdCBidWlsdEluTWVtYmVyQ29tbWFuZHMgPSByZXNvdXJjZUNvbmZpZy5idWlsdEluTWVtYmVyQ29tbWFuZHMgfHwgW11cbiAgICBjb25zdCBjb21tYW5kcyA9IHJlc291cmNlQ29uZmlnLmNvbW1hbmRzIHx8IFtdXG4gICAgY29uc3QgaXNFeHBvc2VkID0gYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcy5pbmNsdWRlcyhjb21tYW5kVHlwZSkgfHwgYnVpbHRJbk1lbWJlckNvbW1hbmRzLmluY2x1ZGVzKGNvbW1hbmRUeXBlKSB8fCBjb21tYW5kcy5pbmNsdWRlcyhjb21tYW5kVHlwZSlcbiAgICBjb25zdCBjb21tYW5kTmFtZSA9IGlzRXhwb3NlZCA/IGluZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24udW5kZXJzY29yZShjb21tYW5kVHlwZSkpIDogY29tbWFuZFR5cGVcblxuICAgIHJldHVybiB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbW1hbmROYW1lKHtcbiAgICAgIGNvbW1hbmROYW1lLFxuICAgICAgY29tbWFuZFR5cGUsXG4gICAgICBtb2RlbE5hbWU6IHRoaXMuZ2V0TW9kZWxOYW1lKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGN1c3RvbSBjb21tYW5kIHBheWxvYWQgYXJndW1lbnRzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncyAtIENvbW1hbmQgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENvbW1hbmQgcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBub3JtYWxpemVDdXN0b21Db21tYW5kUGF5bG9hZEFyZ3VtZW50cyhhcmdzKSB7XG4gICAgaWYgKGFyZ3MubGVuZ3RoID09PSAwKSByZXR1cm4ge31cbiAgICBpZiAoYXJncy5sZW5ndGggPT09IDEpIHtcbiAgICAgIGNvbnN0IHBheWxvYWQgPSBhcmdzWzBdXG4gICAgICBpZiAocGF5bG9hZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiB7fVxuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIHBheWxvYWQgIT09IFwib2JqZWN0XCIgfHwgcGF5bG9hZCA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4ge2FyZzE6IHBheWxvYWR9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHBheWxvYWQpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyIHwgc3RyaW5nIHwgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBhcmdzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgcGF5bG9hZFtgYXJnJHtpbmRleCArIDF9YF0gPSBhcmdzW2luZGV4XVxuICAgIH1cblxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbW9kZWwgbmFtZSwgcHJlZmVycmluZyBhbiBleHBsaWNpdCBgc3RhdGljIG1vZGVsTmFtZWAgZGVjbGFyYXRpb25cbiAgICogb3ZlciB0aGUgSmF2YVNjcmlwdCBjbGFzcyBgLm5hbWVgIHByb3BlcnR5LiBUaGlzIGFsbG93cyBtaW5pZmllZCBidWlsZHMgdG9cbiAgICogcHJlc2VydmUgY29ycmVjdCBtb2RlbCBuYW1lcyB3aXRob3V0IHJlbHlpbmcgb24gYGtlZXBfY2xhc3NuYW1lc2AuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIG1vZGVsIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0TW9kZWxOYW1lKCkge1xuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgbW9kZWxOYW1lID0gcmVzb3VyY2VDb25maWc/Lm1vZGVsTmFtZVxuXG4gICAgcmV0dXJuICh0eXBlb2YgbW9kZWxOYW1lID09PSBcInN0cmluZ1wiICYmIG1vZGVsTmFtZS5sZW5ndGggPiAwKSA/IG1vZGVsTmFtZSA6IHRoaXMubmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uZmlndXJlIHRyYW5zcG9ydC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnfSBjb25maWcgLSBGcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGNvbmZpZ3VyZVRyYW5zcG9ydChjb25maWcpIHtcbiAgICBpZiAoIWNvbmZpZyB8fCB0eXBlb2YgY29uZmlnICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ1cmxcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudXJsID0gY29uZmlnLnVybFxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInNoYXJlZFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zaGFyZWQgPSBjb25maWcuc2hhcmVkXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwid2Vic29ja2V0Q2xpZW50XCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCA9IGNvbmZpZy53ZWJzb2NrZXRDbGllbnRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ3ZWJzb2NrZXRVcmxcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0VXJsID0gY29uZmlnLndlYnNvY2tldFVybFxuICAgICAgLy8gUmVzZXQgY2FjaGVkIGludGVybmFsIGNsaWVudCBzbyB0aGUgbmV3IFVSTCB0YWtlcyBlZmZlY3Qgb24gbmV4dCBzdWJzY3JpYmVcbiAgICAgIHJlc2V0SW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKVxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInJlcXVlc3RIZWFkZXJzXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RIZWFkZXJzID0gY29uZmlnLnJlcXVlc3RIZWFkZXJzXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwicmVxdWVzdENvbnRleHRcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdENvbnRleHQgPSBjb25maWcucmVxdWVzdENvbnRleHRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ0aW1lb3V0XCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVvdXQgPSBjb25maWcudGltZW91dFxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInNpZ25hbFwiKSkge1xuICAgICAgaWYgKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsICE9PSBjb25maWcuc2lnbmFsKSB7XG4gICAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsID0gY29uZmlnLnNpZ25hbFxuICAgICAgICByZXNldEludGVybmFsV2Vic29ja2V0Q2xpZW50KClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ0aW1lWm9uZVwiKSkge1xuICAgICAgaWYgKGNvbmZpZy50aW1lWm9uZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGRlbGV0ZSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lID0gY29uZmlnLnRpbWVab25lXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwic2Vzc2lvblN0b3JlXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNlc3Npb25TdG9yZSA9IGNvbmZpZy5zZXNzaW9uU3RvcmVcbiAgICAgIC8vIFJlc2V0IGNhY2hlZCBpbnRlcm5hbCBjbGllbnQgc28gdGhlIG5ldyBzZXNzaW9uU3RvcmUgaXMgcGlja2VkIHVwLlxuICAgICAgcmVzZXRJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwib2ZmbGluZVN5bmNcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcub2ZmbGluZVN5bmMgPSBjb25maWcub2ZmbGluZVN5bmNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29ubmVjdCB0aGUgaW50ZXJuYWwgV2ViU29ja2V0IGFuZCBlbmFibGUgYXV0by1yZWNvbm5lY3QuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWx9fSBbb3B0aW9uc10gLSBTdGFydHVwIGNvbnRyb2xzIGNvbXBvc2VkIHdpdGggdGhlIGNvbmZpZ3VyZWQgdHJhbnNwb3J0IGNvbnRyb2xzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbm5lY3RlZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjb25uZWN0V2Vic29ja2V0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGNsaWVudCA9IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpXG5cbiAgICBpZiAoIWNsaWVudCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY29ubmVjdFdlYnNvY2tldCByZXF1aXJlcyBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldFVybH0pXCIpXG4gICAgfVxuXG4gICAgYXdhaXQgY2xpZW50LmNvbm5lY3QoZnJvbnRlbmRNb2RlbFdlYnNvY2tldFN0YXJ0dXBDb250cm9scyhvcHRpb25zKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNjb25uZWN0IHRoZSBpbnRlcm5hbCBXZWJTb2NrZXQgYW5kIGRpc2FibGUgYXV0by1yZWNvbm5lY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xvc2VkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGRpc2Nvbm5lY3RXZWJzb2NrZXQoKSB7XG4gICAgaWYgKCFpbnRlcm5hbFdlYnNvY2tldENsaWVudCkgcmV0dXJuXG5cbiAgICBjb25zdCBjbGllbnQgPSBpbnRlcm5hbFdlYnNvY2tldENsaWVudFxuXG4gICAgZGV0YWNoSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoY2xpZW50KVxuICAgIGF3YWl0IGNsaWVudC5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgdW50aWwgcXVldWVkIGFuZCBhY3RpdmUgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHJlcXVlc3RzIGZpbmlzaC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsSWRsZVdhaXRBcmdzfSBbYXJnc10gLSBXYWl0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdHJhbnNwb3J0IGlzIGlkbGUuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgd2FpdEZvcklkbGUoYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge3F1aWV0TXMgPSAwLCB0aW1lb3V0OiB0aW1lb3V0TXMgPSA1MDAwLCAuLi5yZXN0QXJnc30gPSBhcmdzXG4gICAgY29uc3QgcmVzdEFyZ0tleXMgPSBPYmplY3Qua2V5cyhyZXN0QXJncylcblxuICAgIGlmIChyZXN0QXJnS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gd2FpdEZvcklkbGUgYXJnczogJHtyZXN0QXJnS2V5cy5qb2luKFwiLCBcIil9YClcbiAgICB9XG5cbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShxdWlldE1zKSB8fCBxdWlldE1zIDwgMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCB3YWl0Rm9ySWRsZSBxdWlldE1zIHRvIGJlIGEgbm9uLW5lZ2F0aXZlIG51bWJlciwgZ290OiAke3F1aWV0TXN9YClcbiAgICB9XG5cbiAgICBhd2FpdCB0aW1lb3V0KFxuICAgICAge3RpbWVvdXQ6IHRpbWVvdXRNcywgZXJyb3JNZXNzYWdlOiBcIlRpbWVkIG91dCB3YWl0aW5nIGZvciBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgdG8gYmVjb21lIGlkbGVcIn0sXG4gICAgICBhc3luYyAoKSA9PiBhd2FpdCB3YWl0Rm9yRnJvbnRlbmRNb2RlbFRyYW5zcG9ydElkbGUocXVpZXRNcylcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY3VycmVudCBXZWJTb2NrZXQgY29ubmVjdGlvbiBzdGF0ZS5cbiAgICogQHJldHVybnMge3tkaXNjb25uZWN0ZWRTaW5jZTogbnVtYmVyIHwgbnVsbCwgaGFzQ2xpZW50OiBib29sZWFuLCBpc09wZW46IGJvb2xlYW4sIGxpc3RlbmVyQ291bnQ6IG51bWJlcn19IC0gU25hcHNob3Qgb2YgdGhlIG1hbmFnZWQgd2Vic29ja2V0IGNvbm5lY3Rpb24gc3RhdGUuXG4gICAqL1xuICBzdGF0aWMgd2Vic29ja2V0U3RhdGUoKSB7XG4gICAgaWYgKCFpbnRlcm5hbFdlYnNvY2tldENsaWVudCkge1xuICAgICAgcmV0dXJuIHtkaXNjb25uZWN0ZWRTaW5jZTogbnVsbCwgaGFzQ2xpZW50OiBmYWxzZSwgaXNPcGVuOiBmYWxzZSwgbGlzdGVuZXJDb3VudDogMH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQuc3RhdGUoKSxcbiAgICAgIGhhc0NsaWVudDogdHJ1ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZSB0aGUgcmF3IFdlYlNvY2tldCB3aXRob3V0IGRpc2FibGluZyBhdXRvLXJlY29ubmVjdC4gVXNlZCBieSB0ZXN0cyB0b1xuICAgKiBzaW11bGF0ZSBhbiB1bmV4cGVjdGVkIG5ldHdvcmsgZHJvcCBhbmQgdmVyaWZ5IHJlY29ubmVjdGlvbiBiZWhhdmlvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc29ja2V0IGhhcyBjbG9zZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZHJvcFdlYnNvY2tldCgpIHtcbiAgICBpZiAoIWludGVybmFsV2Vic29ja2V0Q2xpZW50KSByZXR1cm5cblxuICAgIGF3YWl0IGludGVybmFsV2Vic29ja2V0Q2xpZW50LmRyb3BDb25uZWN0aW9uKClcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIGdsb2JhbCBtZXRhZGF0YSBvbiB0aGUgV2ViU29ja2V0IGNvbm5lY3Rpb24uIFNlbnQgdG8gdGhlIHNlcnZlciBpbW1lZGlhdGVseVxuICAgKiBvdmVyIFdlYlNvY2tldCBhbmQgZXhwb3NlZCB0byBXZWJTb2NrZXQtYm9ybmUgcmVxdWVzdHMgYXMgcmVxdWVzdCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIE1ldGFkYXRhIGtleS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBNZXRhZGF0YSB2YWx1ZSAobnVsbCB0byBjbGVhcikuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHNldFdlYnNvY2tldE1ldGFkYXRhKGtleSwgdmFsdWUpIHtcbiAgICBjb25zdCBjbGllbnQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgfHwgcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkpXG5cbiAgICBpZiAoIWNsaWVudCB8fCB0eXBlb2YgY2xpZW50LnNldE1ldGFkYXRhICE9PSBcImZ1bmN0aW9uXCIpIHJldHVyblxuXG4gICAgY2xpZW50LnNldE1ldGFkYXRhKGtleSwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogT3BlbnMgYSBtYW5hZ2VkIGNvbm5lY3Rpb24gdGhhdCBhdXRvLW9wZW5zLCBhdXRvLWNsb3NlcywgYW5kXG4gICAqIGF1dG8tcmVjb25uZWN0cyBiYXNlZCBvbiBgc2hvdWxkQ29ubmVjdCgpYCBhbmQgYHBhcmFtcygpYC5cbiAgICogQ2FsbCBgaGFuZGxlLnN5bmMoKWAgd2hlbmV2ZXIgdGhlIGlucHV0cyB0aGF0IGRyaXZlIHRob3NlXG4gICAqIGZ1bmN0aW9ucyBjaGFuZ2UgKGUuZy4gY3VycmVudC11c2VyIHNpZ24taW4vb3V0KS4gVGhlIGhhbmRsZVxuICAgKiByZXRyaWVzIHdoZW4gdGhlIFdTIGNsaWVudCBpc24ndCByZWFkeSBhbmQgcmVvcGVucyBvbiBjbG9zZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbm5lY3Rpb25UeXBlIC0gQ29ubmVjdGlvbiBjbGFzcyBuYW1lIHJlZ2lzdGVyZWQgb24gdGhlIHNlcnZlci5cbiAgICogQHBhcmFtIHt7c2hvdWxkQ29ubmVjdDogKCkgPT4gYm9vbGVhbiwgcGFyYW1zOiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHNpZ25hbD86IEFib3J0U2lnbmFsLCBvbk1lc3NhZ2U/OiAoYm9keTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHZvaWR9fSBvcHRpb25zIC0gQ29ubmVjdGlvbiBsaWZlY3ljbGUsIGNhbmNlbGxhdGlvbiwgYW5kIHBheWxvYWQgY2FsbGJhY2tzLlxuICAgKiBAcmV0dXJucyB7e3N5bmM6ICgpID0+IHZvaWQsIGNsb3NlOiAoKSA9PiB2b2lkfX0gLSBIYW5kbGUgdXNlZCB0byByZXN5bmMgb3IgY2xvc2UgdGhlIG1hbmFnZWQgY29ubmVjdGlvbi5cbiAgICovXG4gIHN0YXRpYyBvcGVuTWFuYWdlZENvbm5lY3Rpb24oY29ubmVjdGlvblR5cGUsIG9wdGlvbnMpIHtcbiAgICAvKipcbiAgICAgKiBDb25uZWN0aW9uLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICBsZXQgY29ubmVjdGlvbiA9IG51bGxcbiAgICBsZXQgY2xvc2VkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBSZXRyeSB0aW1lci5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSAqL1xuICAgIGxldCByZXRyeVRpbWVyID0gbnVsbFxuICAgIGxldCBsYXN0UGFyYW1zSnNvbiA9IFwiXCJcbiAgICBjb25zdCBjb250cm9scyA9IGZyb250ZW5kTW9kZWxXZWJzb2NrZXRTdGFydHVwQ29udHJvbHMoe3NpZ25hbDogb3B0aW9ucy5zaWduYWx9KVxuICAgIGNvbnN0IGNsZWFyUmV0cnlUaW1lciA9ICgpID0+IHtcbiAgICAgIGlmIChyZXRyeVRpbWVyID09PSBudWxsKSByZXR1cm5cblxuICAgICAgZ2xvYmFsVGhpcy5jbGVhclRpbWVvdXQocmV0cnlUaW1lcilcbiAgICAgIHJldHJ5VGltZXIgPSBudWxsXG4gICAgfVxuXG4gICAgY29uc3QgY2xvc2UgPSAoKSA9PiB7XG4gICAgICBpZiAoY2xvc2VkKSByZXR1cm5cblxuICAgICAgY2xvc2VkID0gdHJ1ZVxuICAgICAgY2xlYXJSZXRyeVRpbWVyKClcbiAgICAgIGNvbnRyb2xzLnNpZ25hbD8ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGNsb3NlKVxuICAgICAgaWYgKGNvbm5lY3Rpb24gJiYgIWNvbm5lY3Rpb24uaXNDbG9zZWQoKSkgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgICBjb25uZWN0aW9uID0gbnVsbFxuICAgIH1cblxuICAgIGNvbnN0IHN5bmMgPSAoKSA9PiB7XG4gICAgICBpZiAoY2xvc2VkKSByZXR1cm5cblxuICAgICAgaWYgKCFvcHRpb25zLnNob3VsZENvbm5lY3QoKSkge1xuICAgICAgICBjbGVhclJldHJ5VGltZXIoKVxuICAgICAgICBpZiAoY29ubmVjdGlvbiAmJiAhY29ubmVjdGlvbi5pc0Nsb3NlZCgpKSBjb25uZWN0aW9uLmNsb3NlKClcbiAgICAgICAgY29ubmVjdGlvbiA9IG51bGxcbiAgICAgICAgbGFzdFBhcmFtc0pzb24gPSBcIlwiXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBjb25zdCBuZXh0UGFyYW1zID0gb3B0aW9ucy5wYXJhbXMoKVxuICAgICAgY29uc3QgbmV4dFBhcmFtc0pzb24gPSBKU09OLnN0cmluZ2lmeShuZXh0UGFyYW1zKVxuXG4gICAgICAvLyBBbHJlYWR5IGNvbm5lY3RlZCB3aXRoIHNhbWUgcGFyYW1zIOKAlCBub3RoaW5nIHRvIGRvLlxuICAgICAgaWYgKGNvbm5lY3Rpb24gJiYgIWNvbm5lY3Rpb24uaXNDbG9zZWQoKSAmJiBuZXh0UGFyYW1zSnNvbiA9PT0gbGFzdFBhcmFtc0pzb24pIHJldHVyblxuXG4gICAgICAvLyBDb25uZWN0ZWQgYnV0IHBhcmFtcyBjaGFuZ2VkIOKAlCBzZW5kIHVwZGF0ZSBtZXNzYWdlLlxuICAgICAgLy8gR3VhcmQgd2l0aCB0cnkvY2F0Y2g6IHRoZSBjb25uZWN0aW9uIGhhbmRsZSBzdGF5cyBsaXZlIGR1cmluZ1xuICAgICAgLy8gcmVjb25uZWN0IGJ1dCB0aGUgdW5kZXJseWluZyBzb2NrZXQgbWF5IGJlIGNsb3NlZC5cbiAgICAgIGlmIChjb25uZWN0aW9uICYmICFjb25uZWN0aW9uLmlzQ2xvc2VkKCkpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25uZWN0aW9uLnNlbmRNZXNzYWdlKG5leHRQYXJhbXMpXG4gICAgICAgICAgbGFzdFBhcmFtc0pzb24gPSBuZXh0UGFyYW1zSnNvblxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICBjb25uZWN0aW9uID0gbnVsbFxuICAgICAgICAgIGxhc3RQYXJhbXNKc29uID0gXCJcIlxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIFdTIGNsaWVudCBub3QgcmVhZHkg4oCUIHJldHJ5LiBDaGVjayB0aGUgYWN0dWFsIGNsaWVudCAod2hpY2hcbiAgICAgIC8vIG1heSBiZSBhbiBpbmplY3RlZCB3ZWJzb2NrZXRDbGllbnQpIGluc3RlYWQgb2Ygd2Vic29ja2V0U3RhdGUoKVxuICAgICAgLy8gd2hpY2ggb25seSByZWZsZWN0cyB0aGUgaW50ZXJuYWwgY2xpZW50LlxuICAgICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50IHx8IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpKVxuXG4gICAgICBpZiAoIWNsaWVudCB8fCAhY2xpZW50LmlzT3BlbigpKSB7XG4gICAgICAgIGlmIChyZXRyeVRpbWVyID09PSBudWxsKSB7XG4gICAgICAgICAgcmV0cnlUaW1lciA9IGdsb2JhbFRoaXMuc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICByZXRyeVRpbWVyID0gbnVsbFxuICAgICAgICAgICAgc3luYygpXG4gICAgICAgICAgfSwgMjUwKVxuICAgICAgICB9XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBsYXN0UGFyYW1zSnNvbiA9IG5leHRQYXJhbXNKc29uXG4gICAgICBjb25uZWN0aW9uID0gY2xpZW50Lm9wZW5Db25uZWN0aW9uKGNvbm5lY3Rpb25UeXBlLCB7XG4gICAgICAgIHBhcmFtczogbmV4dFBhcmFtcyxcbiAgICAgICAgb25NZXNzYWdlOiBvcHRpb25zLm9uTWVzc2FnZSxcbiAgICAgICAgb25DbG9zZTogKCkgPT4ge1xuICAgICAgICAgIGlmIChjb25uZWN0aW9uPy5pc0Nsb3NlZCgpKSB7XG4gICAgICAgICAgICBjb25uZWN0aW9uID0gbnVsbFxuICAgICAgICAgICAgbGFzdFBhcmFtc0pzb24gPSBcIlwiXG4gICAgICAgICAgICBzeW5jKClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29udHJvbHMuc2lnbmFsPy5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgY2xvc2UsIHtvbmNlOiB0cnVlfSlcblxuICAgIGlmIChjb250cm9scy5zaWduYWw/LmFib3J0ZWQpIHtcbiAgICAgIGNsb3NlKClcbiAgICB9IGVsc2Uge1xuICAgICAgc3luYygpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtzeW5jLCBjbG9zZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBPcGVucyBhIDE6MSBgV2Vic29ja2V0Q29ubmVjdGlvbmAgb2YgdGhlIGdpdmVuIHR5cGUuIFRoaW5cbiAgICogY29udmVuaWVuY2Ugd3JhcHBlciBhcm91bmQgdGhlIGludGVybmFsIFdTIGNsaWVudCdzXG4gICAqIGBvcGVuQ29ubmVjdGlvbmAuIEFwcHMgdXNlIHRoaXMgZm9yIHBlci1zZXNzaW9uIHN0YXRlL21lc3NhZ2luZ1xuICAgKiB0aGF0IGRvZXNuJ3QgZml0IHRoZSBwdWIvc3ViIENoYW5uZWwgbW9kZWwgKGxvY2FsZSwgcHJlc2VuY2UpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29ubmVjdGlvblR5cGUgLSBOYW1lIHRoZSBzZXJ2ZXIgcmVnaXN0ZXJlZCB0aGUgY2xhc3MgdW5kZXIuXG4gICAqIEBwYXJhbSB7e3BhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgdGltZW91dE1zPzogbnVtYmVyLCBzaWduYWw/OiBBYm9ydFNpZ25hbCwgb25Db25uZWN0PzogKCkgPT4gdm9pZCwgb25NZXNzYWdlPzogKGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB2b2lkLCBvbkRpc2Nvbm5lY3Q/OiAoKSA9PiB2b2lkLCBvblJlc3VtZT86ICgpID0+IHZvaWQsIG9uQ2xvc2U/OiAocmVhc29uOiBzdHJpbmcpID0+IHZvaWR9fSBbb3B0aW9uc10gLSBDb25uZWN0aW9uIG9wdGlvbnMsIHJlYWRpbmVzcyBjb250cm9scywgYW5kIGV2ZW50IGhhbmRsZXJzLiBDb25uZWN0IHRoZSBjbGllbnQgZmlyc3Q7IHRoZSB0aW1lb3V0IGNvdmVycyBzZXJ2ZXItY29uZmlybWVkIHJlYWRpbmVzcyBhbmQgdGhlIHNpZ25hbCBjYW5jZWxzIHJlYWRpbmVzcyB3aXRob3V0IGVudGVyaW5nIHRoZSB3aXJlIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt7cmVhZHk6IFByb21pc2U8dm9pZD4sIGNsb3NlOiAoKSA9PiB2b2lkfX0gLSBXZWJzb2NrZXQgY29ubmVjdGlvbiBoYW5kbGUuXG4gICAqL1xuICBzdGF0aWMgb3BlbldlYnNvY2tldENvbm5lY3Rpb24oY29ubmVjdGlvblR5cGUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgIGlmICghY2xpZW50IHx8IHR5cGVvZiBjbGllbnQub3BlbkNvbm5lY3Rpb24gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwib3BlbldlYnNvY2tldENvbm5lY3Rpb24gcmVxdWlyZXMgY29uZmlndXJlVHJhbnNwb3J0KHt3ZWJzb2NrZXRVcmx9KVwiKVxuICAgIH1cblxuICAgIGNvbnN0IHtzaWduYWwsIHRpbWVvdXRNcywgLi4uY29ubmVjdGlvbk9wdGlvbnN9ID0gb3B0aW9uc1xuXG4gICAgcmV0dXJuIGNsaWVudC5vcGVuQ29ubmVjdGlvbihjb25uZWN0aW9uVHlwZSwge1xuICAgICAgLi4uY29ubmVjdGlvbk9wdGlvbnMsXG4gICAgICAuLi5mcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKHtzaWduYWwsIHRpbWVvdXRNc30pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdWJzY3JpYmVzIHRvIGEgcHViL3N1YiBgV2Vic29ja2V0Q2hhbm5lbGAuIFRoaW4gd3JhcHBlciBhcm91bmRcbiAgICogdGhlIGludGVybmFsIGNsaWVudCdzIGBzdWJzY3JpYmVDaGFubmVsYC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNoYW5uZWxUeXBlIC0gQ2hhbm5lbCBjbGFzcyBuYW1lIHJlZ2lzdGVyZWQgb24gdGhlIHNlcnZlci5cbiAgICogQHBhcmFtIHt7cGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCB0aW1lb3V0TXM/OiBudW1iZXIsIHNpZ25hbD86IEFib3J0U2lnbmFsLCBvbk1lc3NhZ2U/OiAoYm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHZvaWQsIG9uRGlzY29ubmVjdD86ICgpID0+IHZvaWQsIG9uUmVzdW1lPzogKCkgPT4gdm9pZCwgb25DbG9zZT86IChyZWFzb246IHN0cmluZykgPT4gdm9pZH19IFtvcHRpb25zXSAtIENoYW5uZWwgb3B0aW9ucywgc3RhcnR1cCBjb250cm9scywgYW5kIGV2ZW50IGhhbmRsZXJzLiBUaGUgdGltZW91dCBjb3ZlcnMgY29ubmVjdCBhbmQgc2VydmVyLWNvbmZpcm1lZCByZWFkaW5lc3Mgb25seTsgdGhlIHNpZ25hbCBjYW5jZWxzIHN0YXJ0dXAgd2l0aG91dCBlbnRlcmluZyB0aGUgd2lyZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7e3JlYWR5OiBQcm9taXNlPHZvaWQ+LCBjbG9zZTogKCkgPT4gdm9pZH19IC0gV2Vic29ja2V0IGNoYW5uZWwgaGFuZGxlIGZyb20gdGhlIGNvbmZpZ3VyZWQgY2xpZW50LlxuICAgKi9cbiAgc3RhdGljIHN1YnNjcmliZVdlYnNvY2tldENoYW5uZWwoY2hhbm5lbFR5cGUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgIGlmICghY2xpZW50IHx8IHR5cGVvZiBjbGllbnQuc3Vic2NyaWJlQ2hhbm5lbCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzdWJzY3JpYmVXZWJzb2NrZXRDaGFubmVsIHJlcXVpcmVzIGNvbmZpZ3VyZVRyYW5zcG9ydCh7d2Vic29ja2V0VXJsfSlcIilcbiAgICB9XG5cbiAgICBjb25zdCB7cGFyYW1zLCBzaWduYWwsIHRpbWVvdXRNcywgLi4uY2hhbm5lbE9wdGlvbnN9ID0gb3B0aW9uc1xuICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KClcbiAgICBjb25zdCBzY29wZWRQYXJhbXMgPSBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCwgcGFyYW1zID09PSB1bmRlZmluZWQgPyB7fSA6IHBhcmFtcylcbiAgICBjb25zdCBzdGFydHVwQ29udHJvbHMgPSBmcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKHtzaWduYWwsIHRpbWVvdXRNc30pXG4gICAgY29uc3Qgc2NvcGVkUGFyYW1zT3B0aW9uID0gcGFyYW1zID09PSB1bmRlZmluZWQgJiYgT2JqZWN0LmtleXMocmVxdWVzdENvbnRleHQpLmxlbmd0aCA9PT0gMFxuICAgICAgPyB7fVxuICAgICAgOiB7cGFyYW1zOiBzY29wZWRQYXJhbXN9XG4gICAgY29uc3QgaGFuZGxlID0gY2xpZW50LnN1YnNjcmliZUNoYW5uZWwoY2hhbm5lbFR5cGUsIHsuLi5jaGFubmVsT3B0aW9ucywgLi4uc2NvcGVkUGFyYW1zT3B0aW9uLCAuLi5zdGFydHVwQ29udHJvbHN9KVxuXG4gICAgaWYgKHR5cGVvZiBjbGllbnQuY29ubmVjdCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB2b2lkIGNsaWVudC5jb25uZWN0KHN0YXJ0dXBDb250cm9scykuY2F0Y2goKCkgPT4gaGFuZGxlLmNsb3NlKCkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGhhbmRsZVxuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbGxzIFdlYlNvY2tldCBsaWZlY3ljbGUgaG9va3Mgb24gZ2xvYmFsVGhpcyBmb3Igc3lzdGVtIHRlc3QgYWNjZXNzLlxuICAgKiBUZXN0cyBjYW4gY2FsbCBgZ2xvYmFsVGhpcy5fX3ZlbG9jaW91c193ZWJzb2NrZXRfaG9va3MuY29ubmVjdCgpYCBldGMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGluc3RhbGxXZWJzb2NrZXRUZXN0SG9va3MoKSB7XG4gICAgaWYgKHR5cGVvZiBnbG9iYWxUaGlzID09PSBcInVuZGVmaW5lZFwiKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChnbG9iYWxUaGlzKS5fX3ZlbG9jaW91c193ZWJzb2NrZXRfaG9va3MgPSB7XG4gICAgICBjb25uZWN0OiAoKSA9PiB0aGlzLmNvbm5lY3RXZWJzb2NrZXQoKSxcbiAgICAgIGRpc2Nvbm5lY3Q6ICgpID0+IHRoaXMuZGlzY29ubmVjdFdlYnNvY2tldCgpLFxuICAgICAgZHJvcDogKCkgPT4gdGhpcy5kcm9wV2Vic29ja2V0KCksXG4gICAgICBzdGF0ZTogKCkgPT4gdGhpcy53ZWJzb2NrZXRTdGF0ZSgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0cmlidXRlcyBmcm9tIHJlc3BvbnNlLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge29iamVjdH0gcmVzcG9uc2UgLSBSZXNwb25zZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gLSBBdHRyaWJ1dGVzIGZyb20gcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBhdHRyaWJ1dGVzRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgY29uc3QgbW9kZWxEYXRhID0gdGhpcy5tb2RlbERhdGFGcm9tUmVzcG9uc2UocmVzcG9uc2UpXG5cbiAgICByZXR1cm4gbW9kZWxEYXRhLmF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1vZGVsIGRhdGEgZnJvbSByZXNwb25zZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtvYmplY3R9IHJlc3BvbnNlIC0gUmVzcG9uc2UgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3thYmlsaXRpZXM6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4+LCBhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBhc3NvY2lhdGlvbkNvdW50czogUmVjb3JkPHN0cmluZywgbnVtYmVyPiwgcXVlcnlEYXRhOiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzOiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBzZWxlY3RlZEF0dHJpYnV0ZXM6IFNldDxzdHJpbmc+fX0gLSBBdHRyaWJ1dGVzLCBwcmVsb2FkZWQgcmVsYXRpb25zaGlwcywgYXNzb2NpYXRpb24gY291bnRzLCBxdWVyeURhdGEsIGFiaWxpdGllcywgYW5kIHRoZSBzZWxlY3RlZC1hdHRyaWJ1dGVzIHNldC5cbiAgICovXG4gIHN0YXRpYyBtb2RlbERhdGFGcm9tUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgcmVzcG9uc2UgYnV0IGdvdDogJHtyZXNwb25zZX1gKVxuICAgIH1cblxuICAgIC8vIE5hcnJvd3MgdGhlIHJlc3BvbnNlIG9iamVjdCB0byB0aGUgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHZhbHVlIG1hcC5cbiAgICBjb25zdCByZXNwb25zZU9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKHJlc3BvbnNlKVxuXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBtb2RlbERhdGEuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovXG4gICAgbGV0IG1vZGVsRGF0YVxuXG4gICAgaWYgKHJlc3BvbnNlT2JqZWN0Lm1vZGVsICYmIHR5cGVvZiByZXNwb25zZU9iamVjdC5tb2RlbCA9PT0gXCJvYmplY3RcIikge1xuICAgICAgLy8gTmFycm93cyB0aGUgbmVzdGVkIG1vZGVsIHBheWxvYWQgdG8gdGhlIGZyb250ZW5kLW1vZGVsIHZhbHVlIG1hcC5cbiAgICAgIG1vZGVsRGF0YSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKHJlc3BvbnNlT2JqZWN0Lm1vZGVsKVxuICAgIH0gZWxzZSBpZiAocmVzcG9uc2VPYmplY3QuYXR0cmlidXRlcyAmJiB0eXBlb2YgcmVzcG9uc2VPYmplY3QuYXR0cmlidXRlcyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgLy8gTmFycm93cyB0aGUgbmVzdGVkIGF0dHJpYnV0ZXMgcGF5bG9hZCB0byB0aGUgZnJvbnRlbmQtbW9kZWwgdmFsdWUgbWFwLlxuICAgICAgbW9kZWxEYXRhID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAocmVzcG9uc2VPYmplY3QuYXR0cmlidXRlcylcbiAgICB9IGVsc2Uge1xuICAgICAgbW9kZWxEYXRhID0gcmVzcG9uc2VPYmplY3RcbiAgICB9XG5cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoey4uLm1vZGVsRGF0YX0pXG4gICAgY29uc3QgcHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IGlzUGxhaW5PYmplY3QoYXR0cmlidXRlc1tQUkVMT0FERURfUkVMQVRJT05TSElQU19LRVldKVxuICAgICAgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChhdHRyaWJ1dGVzW1BSRUxPQURFRF9SRUxBVElPTlNISVBTX0tFWV0pXG4gICAgICA6IHt9XG4gICAgY29uc3QgYXNzb2NpYXRpb25Db3VudHMgPSBpc1BsYWluT2JqZWN0KGF0dHJpYnV0ZXNbQVNTT0NJQVRJT05fQ09VTlRTX0tFWV0pXG4gICAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi8gKGF0dHJpYnV0ZXNbQVNTT0NJQVRJT05fQ09VTlRTX0tFWV0pXG4gICAgICA6IHt9XG4gICAgY29uc3QgcXVlcnlEYXRhID0gaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzW1FVRVJZX0RBVEFfS0VZXSlcbiAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoYXR0cmlidXRlc1tRVUVSWV9EQVRBX0tFWV0pXG4gICAgICA6IHt9XG4gICAgY29uc3QgYWJpbGl0aWVzID0gaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzW0FCSUxJVElFU19LRVldKVxuICAgICAgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGJvb2xlYW4+fSAqLyAoYXR0cmlidXRlc1tBQklMSVRJRVNfS0VZXSlcbiAgICAgIDoge31cbiAgICBjb25zdCBzZWxlY3RlZEF0dHJpYnV0ZXNGcm9tUGF5bG9hZCA9IEFycmF5LmlzQXJyYXkoYXR0cmlidXRlc1tTRUxFQ1RFRF9BVFRSSUJVVEVTX0tFWV0pXG4gICAgICA/IG5ldyBTZXQoLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGF0dHJpYnV0ZXNbU0VMRUNURURfQVRUUklCVVRFU19LRVldKS5maWx0ZXIoKGF0dHJpYnV0ZU5hbWUpID0+IHR5cGVvZiBhdHRyaWJ1dGVOYW1lID09PSBcInN0cmluZ1wiKSlcbiAgICAgIDogbnVsbFxuXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbUFJFTE9BREVEX1JFTEFUSU9OU0hJUFNfS0VZXVxuICAgIGRlbGV0ZSBhdHRyaWJ1dGVzW1NFTEVDVEVEX0FUVFJJQlVURVNfS0VZXVxuICAgIGRlbGV0ZSBhdHRyaWJ1dGVzW0FTU09DSUFUSU9OX0NPVU5UU19LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbUVVFUllfREFUQV9LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbQUJJTElUSUVTX0tFWV1cblxuICAgIGNvbnN0IHNlbGVjdGVkQXR0cmlidXRlcyA9IHNlbGVjdGVkQXR0cmlidXRlc0Zyb21QYXlsb2FkIHx8IG5ldyBTZXQoT2JqZWN0LmtleXMoYXR0cmlidXRlcykpXG5cbiAgICByZXR1cm4ge2FiaWxpdGllcywgYXR0cmlidXRlcywgYXNzb2NpYXRpb25Db3VudHMsIHF1ZXJ5RGF0YSwgcHJlbG9hZGVkUmVsYXRpb25zaGlwcywgc2VsZWN0ZWRBdHRyaWJ1dGVzfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgcHJlbG9hZGVkIHJlbGF0aW9uc2hpcHMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzIC0gUHJlbG9hZGVkIHJlbGF0aW9uc2hpcCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhcHBseVByZWxvYWRlZFJlbGF0aW9uc2hpcHMobW9kZWwsIHByZWxvYWRlZFJlbGF0aW9uc2hpcHMpIHtcbiAgICBmb3IgKGNvbnN0IFtyZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBQYXlsb2FkXSBvZiBPYmplY3QuZW50cmllcyhwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKSkge1xuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gdGhpcy5yZWxhdGlvbnNoaXBNb2RlbENsYXNzKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCkge1xuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkocmVsYXRpb25zaGlwUGF5bG9hZCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9IHBheWxvYWQgdG8gYmUgYW4gYXJyYXlgKVxuICAgICAgICB9XG5cbiAgICAgICAgLyoqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsQmFzZT59ICovXG4gICAgICAgIGNvbnN0IHJlbGF0ZWRNb2RlbHMgPSBbXVxuXG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmVsYXRpb25zaGlwUGF5bG9hZCkge1xuICAgICAgICAgIGNvbnN0IHJlbGF0ZWRNb2RlbCA9IHRoaXMuaW5zdGFudGlhdGVSZWxhdGlvbnNoaXBWYWx1ZShlbnRyeSwgdGFyZ2V0TW9kZWxDbGFzcylcblxuICAgICAgICAgIGlmICghKHJlbGF0ZWRNb2RlbCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxCYXNlKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfSBwYXlsb2FkIGVudHJ5IHRvIGluc3RhbnRpYXRlIGEgZnJvbnRlbmQgbW9kZWxgKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJlbGF0ZWRNb2RlbHMucHVzaChyZWxhdGVkTW9kZWwpXG4gICAgICAgIH1cblxuICAgICAgICByZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHJlbGF0ZWRNb2RlbHMpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHJlbGF0aW9uc2hpcFBheWxvYWQpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX0gcGF5bG9hZCB0byBiZSBzaW5ndWxhcmApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlbGF0ZWRNb2RlbCA9IHRoaXMuaW5zdGFudGlhdGVSZWxhdGlvbnNoaXBWYWx1ZShyZWxhdGlvbnNoaXBQYXlsb2FkLCB0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgICBpZiAocmVsYXRlZE1vZGVsICE9IHVuZGVmaW5lZCAmJiAhKHJlbGF0ZWRNb2RlbCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxCYXNlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9IHBheWxvYWQgdG8gaW5zdGFudGlhdGUgYSBmcm9udGVuZCBtb2RlbGApXG4gICAgICB9XG5cbiAgICAgIHJlbGF0aW9uc2hpcC5zZXRMb2FkZWQocmVsYXRlZE1vZGVsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc3RhbnRpYXRlIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVsYXRpb25zaGlwUGF5bG9hZCAtIFJlbGF0aW9uc2hpcCBwYXlsb2FkIHZhbHVlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzcyB8IG51bGx9IHRhcmdldE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBJbnN0YW50aWF0ZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGluc3RhbnRpYXRlUmVsYXRpb25zaGlwVmFsdWUocmVsYXRpb25zaGlwUGF5bG9hZCwgdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgIGlmICghdGFyZ2V0TW9kZWxDbGFzcykgcmV0dXJuIHJlbGF0aW9uc2hpcFBheWxvYWRcblxuICAgIGlmICghcmVsYXRpb25zaGlwUGF5bG9hZCB8fCB0eXBlb2YgcmVsYXRpb25zaGlwUGF5bG9hZCAhPT0gXCJvYmplY3RcIikgcmV0dXJuIHJlbGF0aW9uc2hpcFBheWxvYWRcblxuICAgIHJldHVybiB0YXJnZXRNb2RlbENsYXNzLmluc3RhbnRpYXRlRnJvbVJlc3BvbnNlKHJlbGF0aW9uc2hpcFBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnN0YW50aWF0ZSBmcm9tIHJlc3BvbnNlLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBJbnN0YW5jZVR5cGU8VD59IHJlc3BvbnNlIC0gUmVzcG9uc2UgcGF5bG9hZCwgb3IgYW4gYWxyZWFkeS1oeWRyYXRlZCBpbnN0YW5jZSBvZiB0aGlzIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7SW5zdGFuY2VUeXBlPFQ+fSAtIE5ldyBtb2RlbCBpbnN0YW5jZSwgb3IgdGhlIHNhbWUgaW5zdGFuY2UgdW5jaGFuZ2VkIGlmIGl0IHdhcyBhbHJlYWR5IGh5ZHJhdGVkLlxuICAgKi9cbiAgc3RhdGljIGluc3RhbnRpYXRlRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgLy8gSWRlbXBvdGVudDogaWYgYSBjYWxsZXIgaGFuZHMgdXMgYW4gYWxyZWFkeS1oeWRyYXRlZCBpbnN0YW5jZSBvZiB0aGlzXG4gICAgLy8gY2xhc3MgKG5vdyBjb21tb24gYmVjYXVzZSB0aGUgc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSBhdXRvLXNlcmlhbGl6ZXNcbiAgICAvLyBiYWNrZW5kIGBSZWNvcmRgIGluc3RhbmNlcyByZXR1cm5lZCBmcm9tIGN1c3RvbSBjb21tYW5kcyBhbmQgdGhlXG4gICAgLy8gdHJhbnNwb3J0IGRlc2VyaWFsaXplciBoeWRyYXRlcyB0aGVtIGludG8gbW9kZWxzIGJlZm9yZSB0aGUgY2FsbCBzaXRlXG4gICAgLy8gc2VlcyB0aGUgcmVzcG9uc2UpLCByZXR1cm4gaXQgYXMtaXMuIFdpdGhvdXQgdGhpcywgY29kZSB0aGF0IGhhc1xuICAgIC8vIGhpc3RvcmljYWxseSB3cmFwcGVkIGN1c3RvbS1jb21tYW5kIHJlc3BvbnNlcyBpblxuICAgIC8vIGBNb2RlbC5pbnN0YW50aWF0ZUZyb21SZXNwb25zZShyZXNwb25zZS5maWVsZClgIHdvdWxkIHNwcmVhZCB0aGUgbGl2ZVxuICAgIC8vIG1vZGVsIGluc3RhbmNlIGludG8gYSBuZXcgY29uc3RydWN0b3IgY2FsbCBhbmQgcHJvZHVjZSBhIGJyb2tlbiBtb2RlbFxuICAgIC8vIHdpdGggaW50ZXJuYWwgc3RhdGUga2V5cyBwcm9tb3RlZCB0byBhdHRyaWJ1dGVzLlxuICAgIGlmIChyZXNwb25zZSBpbnN0YW5jZW9mIHRoaXMpIHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge0luc3RhbmNlVHlwZTxUPn0gKi8gKHJlc3BvbnNlKVxuICAgIH1cblxuICAgIGNvbnN0IG1vZGVsRGF0YSA9IHRoaXMubW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSBtb2RlbERhdGEuYXR0cmlidXRlc1xuICAgIGNvbnN0IHByZWxvYWRlZFJlbGF0aW9uc2hpcHMgPSBtb2RlbERhdGEucHJlbG9hZGVkUmVsYXRpb25zaGlwc1xuICAgIGNvbnN0IGFzc29jaWF0aW9uQ291bnRzID0gbW9kZWxEYXRhLmFzc29jaWF0aW9uQ291bnRzXG4gICAgY29uc3QgcXVlcnlEYXRhID0gbW9kZWxEYXRhLnF1ZXJ5RGF0YVxuICAgIGNvbnN0IGFiaWxpdGllcyA9IG1vZGVsRGF0YS5hYmlsaXRpZXNcbiAgICBjb25zdCBzZWxlY3RlZEF0dHJpYnV0ZXMgPSBtb2RlbERhdGEuc2VsZWN0ZWRBdHRyaWJ1dGVzXG4gICAgY29uc3QgcmVjZWl2ZXIgPSAvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzKVxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge25ldyAoYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4pID0+IEluc3RhbmNlVHlwZTxUPn0gKi8gKHJlY2VpdmVyKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoYXR0cmlidXRlcylcbiAgICBtb2RlbC5fc2VsZWN0ZWRBdHRyaWJ1dGVzID0gc2VsZWN0ZWRBdHRyaWJ1dGVzID8gbmV3IFNldChzZWxlY3RlZEF0dHJpYnV0ZXMpIDogbnVsbFxuXG4gICAgdGhpcy5hcHBseVByZWxvYWRlZFJlbGF0aW9uc2hpcHMobW9kZWwsIHByZWxvYWRlZFJlbGF0aW9uc2hpcHMpXG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXNzb2NpYXRpb25Db3VudHMgfHwge30pKSB7XG4gICAgICBtb2RlbC5fc2V0QXNzb2NpYXRpb25Db3VudChhdHRyaWJ1dGVOYW1lLCBOdW1iZXIodmFsdWUpIHx8IDApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHF1ZXJ5RGF0YSB8fCB7fSkpIHtcbiAgICAgIG1vZGVsLl9zZXRRdWVyeURhdGEobmFtZSwgdmFsdWUpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbYWN0aW9uLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYWJpbGl0aWVzIHx8IHt9KSkge1xuICAgICAgbW9kZWwuX3NldENvbXB1dGVkQWJpbGl0eShhY3Rpb24sIEJvb2xlYW4odmFsdWUpKVxuICAgIH1cblxuICAgIG1vZGVsLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuICAgIG1vZGVsLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzID0gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhtb2RlbC5hdHRyaWJ1dGVzKCkpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge251bWJlciB8IHN0cmluZ30gaWQgLSBSZWNvcmQgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+Pn0gLSBSZXNvbHZlZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kKGlkKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kKGlkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gQXR0cmlidXRlIG1hdGNoIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPiB8IG51bGw+fSAtIEZvdW5kIG1vZGVsIG9yIG51bGwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZEJ5KGNvbmRpdGlvbnMpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpbmRCeShjb25kaXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieSBvciBmYWlsLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBBdHRyaWJ1dGUgbWF0Y2ggY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+Pn0gLSBGb3VuZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kQnlPckZhaWwoY29uZGl0aW9ucykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZEJ5T3JGYWlsKGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBhcnJheS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPltdPn0gLSBMb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHRvQXJyYXkoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS50b0FycmF5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD5bXT59IC0gTG9hZGVkIG1vZGVsIGluc3RhbmNlcy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsb2FkKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkubG9hZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhbGwuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIuXG4gICAqL1xuICBzdGF0aWMgYWxsKCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXJlLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBSb290LW1vZGVsIHdoZXJlIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCB3aGVyZSBjb25kaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIHdoZXJlKGNvbmRpdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLndoZXJlKGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqb2lucy5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gam9pbnMgLSBSZWxhdGlvbnNoaXAgZGVzY3JpcHRvciBqb2lucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIGpvaW5zLlxuICAgKi9cbiAgc3RhdGljIGpvaW5zKGpvaW5zKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5qb2lucyhqb2lucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxpbWl0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gTWF4aW11bSBudW1iZXIgb2YgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIGxpbWl0LlxuICAgKi9cbiAgc3RhdGljIGxpbWl0KHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5saW1pdCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9mZnNldC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIE51bWJlciBvZiByZWNvcmRzIHRvIHNraXAuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCBvZmZzZXQuXG4gICAqL1xuICBzdGF0aWMgb2Zmc2V0KHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5vZmZzZXQodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYWdlLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtudW1iZXJ9IHBhZ2VOdW1iZXIgLSAxLWJhc2VkIHBhZ2UgbnVtYmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggcGFnZSBhcHBsaWVkLlxuICAgKi9cbiAgc3RhdGljIHBhZ2UocGFnZU51bWJlcikge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkucGFnZShwYWdlTnVtYmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVyIHBhZ2UuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBOdW1iZXIgb2YgcmVjb3JkcyBwZXIgcGFnZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIHBhZ2Ugc2l6ZS5cbiAgICovXG4gIHN0YXRpYyBwZXJQYWdlKHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5wZXJQYWdlKHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY291bnQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE51bWJlciBvZiBsb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNvdW50KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuY291bnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIENsYXNzLWxldmVsIGhvb2sgZmlyZWQgd2hlbiBhbnkgcmVjb3JkIG9mIHRoaXMgbW9kZWwgaXMgY3JlYXRlZC5cbiAgICogU3Vic2NyaWJlLXRpbWUgYXV0aG9yaXphdGlvbiBvbmx5IOKAlCBvbmNlIGEgc3Vic2NyaXB0aW9uIGlzXG4gICAqIGFjY2VwdGVkLCBmdXR1cmUgYGNyZWF0ZWAgZXZlbnRzIGZvciB0aGlzIG1vZGVsIGFyZSBkZWxpdmVyZWRcbiAgICogd2l0aG91dCByZS1jaGVja2luZyBwZXItcmVjb3JkIHZpc2liaWxpdHkuIFF1ZXJ5IG9wdGlvbnMgY2FuIHN0aWxsXG4gICAqIG5hcnJvdyB3aGljaCBldmVudHMgcmVhY2ggdGhpcyBjYWxsYmFjay5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZSwgbW9kZWw6IEZyb250ZW5kTW9kZWxCYXNlfSkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHJlY29yZCBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIG9uQ3JlYXRlKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHQsIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQodGhpcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24odGhpcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrLCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfVxuXG4gICAgcmV0dXJuIGF3YWl0IHN1Yi5yZWdpc3RlckNsYXNzQ2FsbGJhY2soc3ViLmNsYXNzQ3JlYXRlQ2FsbGJhY2tzLCBlbnRyeSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGFzcy1sZXZlbCBob29rIGZpcmVkIHdoZW4gYW55IHJlY29yZCBvZiB0aGlzIG1vZGVsIGlzIHVwZGF0ZWQuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWUsIG1vZGVsOiBGcm9udGVuZE1vZGVsQmFzZX0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciByZWNvcmQgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBvblVwZGF0ZShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0LCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKHRoaXMsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKHRoaXMsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBlbnRyeSA9IHtjYWxsYmFjaywgLi4uZXZlbnRPcHRpb25zUGF5bG9hZH1cblxuICAgIHJldHVybiBhd2FpdCBzdWIucmVnaXN0ZXJDbGFzc0NhbGxiYWNrKHN1Yi5jbGFzc1VwZGF0ZUNhbGxiYWNrcywgZW50cnkpXG4gIH1cblxuICAvKipcbiAgICogQ2xhc3MtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIGFueSByZWNvcmQgb2YgdGhpcyBtb2RlbCBpcyBkZXN0cm95ZWQuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWV9KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gQWNjZXB0ZWQgZm9yIEFQSSBzeW1tZXRyeTsgZGVzdHJveSBldmVudHMgY2FycnkgaWRzIG9ubHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIG9uRGVzdHJveShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXNzZXJ0Tm9EZXN0cm95RXZlbnRGaWx0ZXIodGhpcywgb3B0aW9ucylcblxuICAgIGNvbnN0IHtyZXF1ZXN0Q29udGV4dH0gPSBmcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZCh0aGlzLCBvcHRpb25zKVxuICAgIGNvbnN0IHN1YiA9IGVuc3VyZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbih0aGlzLCBmcm9udGVuZE1vZGVsRXZlbnRSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2t9XG5cbiAgICByZXR1cm4gYXdhaXQgc3ViLnJlZ2lzdGVyQ2xhc3NDYWxsYmFjayhzdWIuY2xhc3NEZXN0cm95Q2FsbGJhY2tzLCBlbnRyeSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YW5jZS1sZXZlbCBob29rIGZpcmVkIHdoZW4gVEhJUyByZWNvcmQgaXMgdXBkYXRlZC4gVGhlXG4gICAqIGluc3RhbmNlJ3MgYXR0cmlidXRlcyBhcmUgYXV0by1tZXJnZWQgd2l0aCB0aGUgYnJvYWRjYXN0IHBheWxvYWRcbiAgICogYmVmb3JlIHRoZSBjYWxsYmFjayBydW5zLCBzbyBjYWxsZXJzIGNhbiByZWFkIGZyZXNoIHZhbHVlcyB2aWFcbiAgICogYHRoaXMuc29tZUF0dHIoKWAgd2l0aG91dCByZS1mZXRjaGluZy5cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZSwgbW9kZWw6IEZyb250ZW5kTW9kZWxCYXNlfSkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHJlY29yZCBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgb25VcGRhdGUoY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHQsIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQoTW9kZWxDbGFzcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oTW9kZWxDbGFzcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGlkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIHRoaXMucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2ssIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9XG4gICAgY29uc3QgbGlzdGVuZXIgPSBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGlkLCB0aGlzKVxuXG4gICAgbGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzLmFkZChlbnRyeSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzdWIuZW5zdXJlU3Vic2NyaWJlZCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCAoY3VycmVudCkgPT4gY3VycmVudC51cGRhdGVDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCAoY3VycmVudCkgPT4gY3VycmVudC51cGRhdGVDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSW5zdGFuY2UtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIFRISVMgcmVjb3JkIGlzIGRlc3Ryb3llZC5cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZX0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBBY2NlcHRlZCBmb3IgQVBJIHN5bW1ldHJ5OyBkZXN0cm95IGV2ZW50cyBjYXJyeSBpZHMgb25seS5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBhc3luYyBvbkRlc3Ryb3koY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcblxuICAgIGFzc2VydE5vRGVzdHJveUV2ZW50RmlsdGVyKE1vZGVsQ2xhc3MsIG9wdGlvbnMpXG5cbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQoTW9kZWxDbGFzcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oTW9kZWxDbGFzcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGlkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIHRoaXMucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2t9XG4gICAgY29uc3QgbGlzdGVuZXIgPSBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGlkLCB0aGlzKVxuXG4gICAgbGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcy5hZGQoZW50cnkpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3ViLmVuc3VyZVN1YnNjcmliZWQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgKGN1cnJlbnQpID0+IGN1cnJlbnQuZGVzdHJveUNhbGxiYWNrcy5kZWxldGUoZW50cnkpKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgcmVtb3ZlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJFbnRyeShzdWIsIChjdXJyZW50KSA9PiBjdXJyZW50LmRlc3Ryb3lDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwbHVjay5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7Li4uKHN0cmluZyB8IHN0cmluZ1tdIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pil9IGNvbHVtbnMgLSBQbHVjayBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFBsdWNrZWQgdmFsdWVzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHBsdWNrKC4uLmNvbHVtbnMpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLnBsdWNrKC4uLmNvbHVtbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWFyY2guXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW4gLSBDb2x1bW4gb3IgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7XCJlcVwiIHwgXCJsaWtlXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCI+XCIgfCBcIj49XCIgfCBcIjxcIiB8IFwiPD1cIn0gb3BlcmF0b3IgLSBTZWFyY2ggb3BlcmF0b3IuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU2VhcmNoIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBzZWFyY2ggZmlsdGVyLlxuICAgKi9cbiAgc3RhdGljIHNlYXJjaChwYXRoLCBjb2x1bW4sIG9wZXJhdG9yLCB2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuc2VhcmNoKHBhdGgsIGNvbHVtbiwgb3BlcmF0b3IsIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmFuc2Fjay5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSYW5zYWNrLXN0eWxlIHBhcmFtcyBoYXNoLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBSYW5zYWNrIGZpbHRlcnMgYXBwbGllZC5cbiAgICovXG4gIHN0YXRpYyByYW5zYWNrKHBhcmFtcykge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkucmFuc2FjayhwYXJhbXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzb3J0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHN0cmluZ1tdW10gfCBbc3RyaW5nLCBzdHJpbmddIHwgQXJyYXk8W3N0cmluZywgc3RyaW5nXT4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBzb3J0IC0gU29ydCBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBzb3J0IGRlZmluaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIHNvcnQoc29ydCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuc29ydChzb3J0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3JkZXIuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgc3RyaW5nW11bXSB8IFtzdHJpbmcsIHN0cmluZ10gfCBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHNvcnQgLSBTb3J0IGRlZmluaXRpb24ocykuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlciB3aXRoIHNvcnQgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgb3JkZXIoc29ydCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkub3JkZXIoc29ydClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdyb3VwLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IGdyb3VwIC0gR3JvdXAgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggZ3JvdXAgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgZ3JvdXAoZ3JvdXApIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLmdyb3VwKGdyb3VwKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzdGluY3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFt2YWx1ZV0gLSBXaGV0aGVyIHRvIHJlcXVlc3QgZGlzdGluY3Qgcm93cy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggZGlzdGluY3QgZmxhZy5cbiAgICovXG4gIHN0YXRpYyBkaXN0aW5jdCh2YWx1ZSA9IHRydWUpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLmRpc3RpbmN0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIuXG4gICAqL1xuICBzdGF0aWMgcXVlcnkoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAobmV3IEZyb250ZW5kTW9kZWxRdWVyeSh7bW9kZWxDbGFzczogdGhpc30pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJlbG9hZC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQ+fSBwcmVsb2FkIC0gUHJlbG9hZCBncmFwaC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSB3aXRoIHByZWxvYWQuXG4gICAqL1xuICBzdGF0aWMgcHJlbG9hZChwcmVsb2FkKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAodGhpcy5xdWVyeSgpLnByZWxvYWQocHJlbG9hZCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWxlY3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdIHwgc3RyaW5nPiB8IHN0cmluZyB8IHN0cmluZ1tdfSBzZWxlY3QgLSBNb2RlbC1hd2FyZSBhdHRyaWJ1dGUgc2VsZWN0IG1hcCBvciByb290LW1vZGVsIHNob3J0aGFuZC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSB3aXRoIHNlbGVjdGVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzdGF0aWMgc2VsZWN0KHNlbGVjdCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gKi8gKHRoaXMucXVlcnkoKS5zZWxlY3Qoc2VsZWN0KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdHMgZXh0cmEuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdIHwgc3RyaW5nPiB8IHN0cmluZyB8IHN0cmluZ1tdfSBzZWxlY3QgLSBFeHRyYSBhdHRyaWJ1dGVzIHRvIGxvYWQgaW4gYWRkaXRpb24gdG8gdGhlIGRlZmF1bHRzLCBrZXllZCBieSBtb2RlbCBuYW1lIG9yIHJvb3QtbW9kZWwgc2hvcnRoYW5kLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IHdpdGggZXh0cmEgc2VsZWN0ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIHN0YXRpYyBzZWxlY3RzRXh0cmEoc2VsZWN0KSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAodGhpcy5xdWVyeSgpLnNlbGVjdHNFeHRyYShzZWxlY3QpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmlyc3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBGaXJzdCBtb2RlbCBvciBudWxsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpcnN0KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmlyc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGFzdC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPiB8IG51bGw+fSAtIExhc3QgbW9kZWwgb3IgbnVsbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsYXN0KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkubGFzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG9yIGluaXRpYWxpemUgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIEF0dHJpYnV0ZSBtYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIEV4aXN0aW5nIG9yIGluaXRpYWxpemVkIG1vZGVsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRPckluaXRpYWxpemVCeShjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgY3JlYXRlIGJ5LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBBdHRyaWJ1dGUgbWF0Y2ggY29uZGl0aW9ucy5cbiAgICogQHBhcmFtIHsobW9kZWw6IEluc3RhbmNlVHlwZTxUPikgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWR9IFtjYWxsYmFja10gLSBPcHRpb25hbCBjYWxsYmFjayBiZWZvcmUgc2F2ZSB3aGVuIGNyZWF0ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRXhpc3Rpbmcgb3IgbmV3bHkgY3JlYXRlZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kT3JDcmVhdGVCeShjb25kaXRpb25zLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZE9yQ3JlYXRlQnkoY29uZGl0aW9ucywgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzXG4gICAqIEB0aGlzIHtNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDcmVhdGVBdHRyaWJ1dGVzRm9yPEluc3RhbmNlVHlwZTxNb2RlbENsYXNzPj59IFthdHRyaWJ1dGVzXSAtIEluaXRpYWwgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+Pn0gLSBQZXJzaXN0ZWQgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY3JlYXRlKGF0dHJpYnV0ZXMpIHtcbiAgICBjb25zdCByZWNlaXZlciA9IC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHRoaXMpXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogRnJvbnRlbmRNb2RlbENyZWF0ZUF0dHJpYnV0ZXNGb3I8SW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+PikgPT4gSW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+fSAqLyAocmVjZWl2ZXIpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcyhhdHRyaWJ1dGVzKVxuXG4gICAgYXdhaXQgbW9kZWwuc2F2ZSgpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2VydCBmaW5kIGJ5IGNvbmRpdGlvbnMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gZmluZEJ5IGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFzc2VydEZpbmRCeUNvbmRpdGlvbnMoY29uZGl0aW9ucykge1xuICAgIGFzc2VydEZpbmRCeUNvbmRpdGlvbnNTaGFwZShjb25kaXRpb25zKVxuXG4gICAgT2JqZWN0LmtleXMoY29uZGl0aW9ucykuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgICBhc3NlcnREZWZpbmVkRmluZEJ5Q29uZGl0aW9uVmFsdWUoY29uZGl0aW9uc1trZXldLCBrZXkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hdGNoZXMgZmluZCBieSBjb25kaXRpb25zLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIENhbmRpZGF0ZSBtb2RlbC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBNYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBtb2RlbCBtYXRjaGVzIGFsbCBjb25kaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIG1hdGNoZXNGaW5kQnlDb25kaXRpb25zKG1vZGVsLCBjb25kaXRpb25zKSB7XG4gICAgY29uc3QgbW9kZWxBdHRyaWJ1dGVzID0gbW9kZWwuYXR0cmlidXRlcygpXG5cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhjb25kaXRpb25zKSkge1xuICAgICAgY29uc3QgZXhwZWN0ZWRWYWx1ZSA9IGNvbmRpdGlvbnNba2V5XVxuICAgICAgY29uc3QgYWN0dWFsVmFsdWUgPSBtb2RlbEF0dHJpYnV0ZXNba2V5XVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShleHBlY3RlZFZhbHVlKSkge1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhY3R1YWxWYWx1ZSkpIHtcbiAgICAgICAgICBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKCFleHBlY3RlZFZhbHVlLnNvbWUoKGVudHJ5KSA9PiB0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZW50cnkpKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKCF0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgY29uZGl0aW9uIHZhbHVlIG1hdGNoZXMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFjdHVhbFZhbHVlIC0gQWN0dWFsIG1vZGVsIHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBleHBlY3RlZFZhbHVlIC0gRXhwZWN0ZWQgZmluZCBjb25kaXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWVzIG1hdGNoLlxuICAgKi9cbiAgc3RhdGljIGZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkge1xuICAgIGlmIChleHBlY3RlZFZhbHVlID09PSBudWxsKSB7XG4gICAgICByZXR1cm4gYWN0dWFsVmFsdWUgPT09IG51bGxcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShleHBlY3RlZFZhbHVlKSkge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGFjdHVhbFZhbHVlKSkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgaWYgKGFjdHVhbFZhbHVlLmxlbmd0aCAhPT0gZXhwZWN0ZWRWYWx1ZS5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBleHBlY3RlZFZhbHVlLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgICBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlW2luZGV4XSwgZXhwZWN0ZWRWYWx1ZVtpbmRleF0pKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBpZiAoZXhwZWN0ZWRWYWx1ZSAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgaWYgKCFhY3R1YWxWYWx1ZSB8fCB0eXBlb2YgYWN0dWFsVmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShhY3R1YWxWYWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFjdHVhbE9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoYWN0dWFsVmFsdWUpXG4gICAgICBjb25zdCBleHBlY3RlZE9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZXhwZWN0ZWRWYWx1ZSlcbiAgICAgIGNvbnN0IGFjdHVhbEtleXMgPSBPYmplY3Qua2V5cyhhY3R1YWxPYmplY3QpXG4gICAgICBjb25zdCBleHBlY3RlZEtleXMgPSBPYmplY3Qua2V5cyhleHBlY3RlZE9iamVjdClcblxuICAgICAgaWYgKGFjdHVhbEtleXMubGVuZ3RoICE9PSBleHBlY3RlZEtleXMubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBleHBlY3RlZEtleXMpIHtcbiAgICAgICAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoYWN0dWFsT2JqZWN0LCBrZXkpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbE9iamVjdFtrZXldLCBleHBlY3RlZE9iamVjdFtrZXldKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgaWYgKGFjdHVhbFZhbHVlID09PSBleHBlY3RlZFZhbHVlKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmZpbmRCeVByaW1pdGl2ZVZhbHVlc01hdGNoKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieSBwcmltaXRpdmUgdmFsdWVzIG1hdGNoLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhY3R1YWxWYWx1ZSAtIEFjdHVhbCBtb2RlbCB2YWx1ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXhwZWN0ZWRWYWx1ZSAtIEV4cGVjdGVkIGZpbmQgY29uZGl0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHByaW1pdGl2ZSB2YWx1ZXMgbWF0Y2ggYWZ0ZXIgc2FmZSBjb2VyY2lvbi5cbiAgICovXG4gIHN0YXRpYyBmaW5kQnlQcmltaXRpdmVWYWx1ZXNNYXRjaChhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkge1xuICAgIGlmIChhY3R1YWxWYWx1ZSBpbnN0YW5jZW9mIERhdGUgJiYgdHlwZW9mIGV4cGVjdGVkVmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFeHBlY3RlZFZhbHVlID0gbm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlKGV4cGVjdGVkVmFsdWUsIHt0aW1lWm9uZTogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKCl9KVxuXG4gICAgICBpZiAobm9ybWFsaXplZEV4cGVjdGVkVmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAgIHJldHVybiBhY3R1YWxWYWx1ZS50b0lTT1N0cmluZygpID09PSBub3JtYWxpemVkRXhwZWN0ZWRWYWx1ZS50b0lTT1N0cmluZygpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhY3R1YWxWYWx1ZS50b0lTT1N0cmluZygpID09PSBleHBlY3RlZFZhbHVlXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhY3R1YWxWYWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiBleHBlY3RlZFZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgcmV0dXJuIGFjdHVhbFZhbHVlID09PSBleHBlY3RlZFZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICB9XG5cbiAgICBpZiAoYWN0dWFsVmFsdWUgaW5zdGFuY2VvZiBEYXRlICYmIGV4cGVjdGVkVmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICByZXR1cm4gYWN0dWFsVmFsdWUudG9JU09TdHJpbmcoKSA9PT0gZXhwZWN0ZWRWYWx1ZS50b0lTT1N0cmluZygpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhY3R1YWxWYWx1ZSA9PT0gXCJudW1iZXJcIiAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIHRoaXMuZmluZEJ5TnVtZXJpY1N0cmluZ01hdGNoZXNOdW1iZXIoZXhwZWN0ZWRWYWx1ZSwgYWN0dWFsVmFsdWUpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhY3R1YWxWYWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJudW1iZXJcIikge1xuICAgICAgcmV0dXJuIHRoaXMuZmluZEJ5TnVtZXJpY1N0cmluZ01hdGNoZXNOdW1iZXIoYWN0dWFsVmFsdWUsIGV4cGVjdGVkVmFsdWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5IG51bWVyaWMgc3RyaW5nIG1hdGNoZXMgbnVtYmVyLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gbnVtZXJpY1N0cmluZyAtIE51bWVyaWMgc3RyaW5nIHZhbHVlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZXhwZWN0ZWROdW1iZXIgLSBOdW1iZXIgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWVzIHJlcHJlc2VudCB0aGUgc2FtZSBudW1iZXIuXG4gICAqL1xuICBzdGF0aWMgZmluZEJ5TnVtZXJpY1N0cmluZ01hdGNoZXNOdW1iZXIobnVtZXJpY1N0cmluZywgZXhwZWN0ZWROdW1iZXIpIHtcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShleHBlY3RlZE51bWJlcikpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGlmICghL14tP1xcZCsoPzpcXC5cXGQrKT8kLy50ZXN0KG51bWVyaWNTdHJpbmcpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gTnVtYmVyKG51bWVyaWNTdHJpbmcpID09PSBleHBlY3RlZE51bWJlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlLlxuICAgKiBAcGFyYW0ge1VwZGF0ZUF0dHJpYnV0ZXN9IFtuZXdBdHRyaWJ1dGVzXSAtIE5ldyB2YWx1ZXMgdG8gYXNzaWduIGJlZm9yZSB1cGRhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHRoaXM+fSAtIFVwZGF0ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyB1cGRhdGUobmV3QXR0cmlidXRlcykge1xuICAgIGlmIChuZXdBdHRyaWJ1dGVzKSB0aGlzLmFzc2lnbkF0dHJpYnV0ZXMobmV3QXR0cmlidXRlcylcblxuICAgIHJldHVybiAvKiogQHR5cGUge3RoaXN9ICovIChhd2FpdCB0aGlzLnNhdmUoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXR0YWNobWVudElucHV0IC0gQXR0YWNobWVudCBpbnB1dCBvciBuYW1lZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYXR0YWNoZWQuXG4gICAqL1xuICBhc3luYyBhdHRhY2goYXR0YWNobWVudElucHV0KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9ucyA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb25zKClcbiAgICBjb25zdCBhdHRhY2htZW50TmFtZXMgPSBPYmplY3Qua2V5cyhhdHRhY2htZW50RGVmaW5pdGlvbnMpXG4gICAgbGV0IGF0dGFjaG1lbnROYW1lID0gYXR0YWNobWVudE5hbWVzWzBdXG4gICAgbGV0IGFjdHVhbEF0dGFjaG1lbnRJbnB1dCA9IGF0dGFjaG1lbnRJbnB1dFxuXG4gICAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChhdHRhY2htZW50SW5wdXQpKSB7XG4gICAgICBpZiAoXCJmaWxlXCIgaW4gYXR0YWNobWVudElucHV0ICYmIGF0dGFjaG1lbnREZWZpbml0aW9ucy5maWxlKSB7XG4gICAgICAgIGF0dGFjaG1lbnROYW1lID0gXCJmaWxlXCJcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBjYW5kaWRhdGVOYW1lIG9mIGF0dGFjaG1lbnROYW1lcykge1xuICAgICAgICBpZiAoY2FuZGlkYXRlTmFtZSBpbiBhdHRhY2htZW50SW5wdXQpIHtcbiAgICAgICAgICBhdHRhY2htZW50TmFtZSA9IGNhbmRpZGF0ZU5hbWVcbiAgICAgICAgICBhY3R1YWxBdHRhY2htZW50SW5wdXQgPSBhdHRhY2htZW50SW5wdXRbY2FuZGlkYXRlTmFtZV1cbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFhdHRhY2htZW50TmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBhdHRhY2htZW50IGRlZmluaXRpb25zIG9uICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKS5hdHRhY2goYWN0dWFsQXR0YWNobWVudElucHV0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2F2ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dGhpcz59IC0gU2F2ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBzYXZlKCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBpc05ldyA9IHRoaXMuaXNOZXdSZWNvcmQoKVxuICAgIGNvbnN0IHByZXZpb3VzSWRlbnRpdHkgPSBpc05ldyA/IG51bGwgOiB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgY29uc3QgY29tbWFuZFR5cGUgPSBpc05ldyA/IFwiY3JlYXRlXCIgOiBcInVwZGF0ZVwiXG4gICAgLyoqXG4gICAgICogUGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBhdHRyaWJ1dGVzOiB0aGlzLl9jaGFuZ2VkQXR0cmlidXRlc0ZvclNhdmUoKVxuICAgIH1cblxuICAgIGlmICghaXNOZXcpIHtcbiAgICAgIHBheWxvYWQuaWQgPSB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgfVxuXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMuX2J1aWxkTmVzdGVkQXR0cmlidXRlc1BheWxvYWQoKVxuXG4gICAgaWYgKG5lc3RlZEF0dHJpYnV0ZXMgJiYgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykubGVuZ3RoID4gMCkge1xuICAgICAgcGF5bG9hZC5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuICAgIH1cblxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gYXdhaXQgdGhpcy5fYnVpbGRBdHRhY2htZW50c1BheWxvYWQoKVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwKSB7XG4gICAgICBwYXlsb2FkLmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICB9XG5cbiAgICBpZiAoc2hvdWxkUXVldWVGcm9udGVuZE1vZGVsT3BlcmF0aW9uT2ZmbGluZShNb2RlbENsYXNzLCBjb21tYW5kVHlwZSkpIHtcbiAgICAgIGNvbnN0IG9mZmxpbmVBdHRyaWJ1dGVzID0gey4uLnBheWxvYWQuYXR0cmlidXRlc31cbiAgICAgIGxldCBjbGllbnRNdXRhdGlvbklkXG5cbiAgICAgIGlmIChpc05ldykge1xuICAgICAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgT2ZmbGluZSBjcmVhdGUgZm9yICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICAgIGNvbnN0IGN1cnJlbnRQcmltYXJ5S2V5ID0gdGhpcy5yZWFkQXR0cmlidXRlKHByaW1hcnlLZXkpXG5cbiAgICAgICAgaWYgKGN1cnJlbnRQcmltYXJ5S2V5ID09PSB1bmRlZmluZWQgfHwgY3VycmVudFByaW1hcnlLZXkgPT09IG51bGwpIHtcbiAgICAgICAgICBjbGllbnRNdXRhdGlvbklkID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5vZmZsaW5lU3luYz8uY2xpZW50TXV0YXRpb25JZFxuICAgICAgICAgICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jLmNsaWVudE11dGF0aW9uSWQoKVxuICAgICAgICAgICAgOiBmcm9udGVuZE1vZGVsT2ZmbGluZU11dGF0aW9uSWQoKVxuICAgICAgICAgIHRoaXMuc2V0QXR0cmlidXRlKHByaW1hcnlLZXksIGNsaWVudE11dGF0aW9uSWQpXG4gICAgICAgICAgb2ZmbGluZUF0dHJpYnV0ZXNbcHJpbWFyeUtleV0gPSBjbGllbnRNdXRhdGlvbklkXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGBPZmZsaW5lIHVwZGF0ZSBmb3IgJHtNb2RlbENsYXNzLm5hbWV9YClcblxuICAgICAgICBvZmZsaW5lQXR0cmlidXRlc1twcmltYXJ5S2V5XSA9IHBheWxvYWQuaWRcbiAgICAgIH1cblxuICAgICAgaWYgKHBheWxvYWQubmVzdGVkQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkIHx8IHBheWxvYWQuYXR0YWNobWVudHMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE9mZmxpbmUgc3luYyBmb3IgJHtNb2RlbENsYXNzLm5hbWV9IGRvZXMgbm90IHN1cHBvcnQgbmVzdGVkIGF0dHJpYnV0ZXMgb3IgYXR0YWNobWVudHMgeWV0YClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgcXVldWVGcm9udGVuZE1vZGVsTXV0YXRpb25PZmZsaW5lKHtcbiAgICAgICAgYXR0cmlidXRlczogb2ZmbGluZUF0dHJpYnV0ZXMsXG4gICAgICAgIGNsaWVudE11dGF0aW9uSWQsXG4gICAgICAgIE1vZGVsQ2xhc3MsXG4gICAgICAgIG9wZXJhdGlvbjogY29tbWFuZFR5cGVcbiAgICAgIH0pXG4gICAgICB0aGlzLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuICAgICAgdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXModGhpcy5hdHRyaWJ1dGVzKCkpXG4gICAgICB0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgICB0aGlzLl9jbGVhclBlbmRpbmdBdHRhY2htZW50cygpXG5cbiAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKGNvbW1hbmRUeXBlLCBwYXlsb2FkKVxuXG4gICAgdGhpcy5hc3NpZ25BdHRyaWJ1dGVzKE1vZGVsQ2xhc3MuYXR0cmlidXRlc0Zyb21SZXNwb25zZShyZXNwb25zZSkpXG4gICAgdGhpcy5zZXRJc05ld1JlY29yZChmYWxzZSlcblxuICAgIGlmIChwcmV2aW91c0lkZW50aXR5ICE9PSBudWxsKSB7XG4gICAgICByZWtleUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyhNb2RlbENsYXNzLCB0aGlzLCBwcmV2aW91c0lkZW50aXR5LCB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIH1cblxuICAgIHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXMgPSBjbG9uZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKHRoaXMuYXR0cmlidXRlcygpKVxuICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICB0aGlzLl9jbGVhclBlbmRpbmdBdHRhY2htZW50cygpXG5cbiAgICB0aGlzLl9yZWNvbmNpbGVOZXN0ZWRBdHRyaWJ1dGVzRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBzdWJzZXQgb2YgYF9hdHRyaWJ1dGVzYCB3aG9zZSB2YWx1ZSBoYXMgZGl2ZXJnZWQgZnJvbVxuICAgKiBgX3BlcnNpc3RlZEF0dHJpYnV0ZXNgLiBVc2VkIGJ5IGBzYXZlKClgIHNvIHRoZSBzZXJ2ZXIgcmVjZWl2ZXMgb25seSB0aGVcbiAgICogZmllbGRzIHRoZSBjYWxsZXIgYWN0dWFsbHkgY2hhbmdlZCDigJQgYXZvaWRpbmcgc3RyaWN0IHBlcm1pdCByZWplY3Rpb25zIG9uXG4gICAqIGZyYW1ld29yay1tYW5hZ2VkIGZpZWxkcyBsaWtlIGBpZGAsIGBjcmVhdGVkQXRgLCBgdXBkYXRlZEF0YCwgb3Igb3duZXJcbiAgICogZm9yZWlnbiBrZXlzIHRoYXQgdGhlIHJlc291cmNlIG5ldmVyIGxpc3RzIGluIGBwZXJtaXR0ZWRQYXJhbXNgLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gLSBDaGFuZ2VkIGF0dHJpYnV0ZXMgaGFzaC5cbiAgICovXG4gIF9jaGFuZ2VkQXR0cmlidXRlc0ZvclNhdmUoKSB7XG4gICAgLyoqXG4gICAgICogQ2hhbmdlZCBhdHRyaWJ1dGVzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqL1xuICAgIGNvbnN0IGNoYW5nZWRBdHRyaWJ1dGVzID0ge31cblxuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIFtwcmV2aW91c1ZhbHVlLCBjdXJyZW50VmFsdWVdXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmNoYW5nZXMoKSkpIHtcbiAgICAgIGlmICh0aGlzLmlzTmV3UmVjb3JkKCkgJiYgcHJldmlvdXNWYWx1ZSA9PT0gdW5kZWZpbmVkICYmIGN1cnJlbnRWYWx1ZSA9PT0gbnVsbCkgY29udGludWVcblxuICAgICAgY2hhbmdlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBjdXJyZW50VmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gY2hhbmdlZEF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXJrcyB0aGUgY3VycmVudCB2YWx1ZSBmb3IgYW4gYXR0cmlidXRlIGFzIGFscmVhZHkgcGVyc2lzdGVkIHNvIHRoZSBuZXh0XG4gICAqIHNhdmUgZG9lcyBub3Qgc2VuZCBpdCB1bmxlc3MgdGhlIGNhbGxlciBjaGFuZ2VzIGl0IGFnYWluLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSB0byBtYXJrIHVuY2hhbmdlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBtYXJrQXR0cmlidXRlVW5jaGFuZ2VkKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyh7dmFsdWU6IHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV19KS52YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVzdHJveS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZXN0cm95ZWQgb24gYmFja2VuZC5cbiAgICovXG4gIGFzeW5jIGRlc3Ryb3koKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGlkID0gdGhpcy5wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKVxuXG4gICAgaWYgKHNob3VsZFF1ZXVlRnJvbnRlbmRNb2RlbE9wZXJhdGlvbk9mZmxpbmUoTW9kZWxDbGFzcywgXCJkZXN0cm95XCIpKSB7XG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgT2ZmbGluZSBkZXN0cm95IGZvciAke01vZGVsQ2xhc3MubmFtZX1gKVxuXG4gICAgICBhd2FpdCBxdWV1ZUZyb250ZW5kTW9kZWxNdXRhdGlvbk9mZmxpbmUoe1xuICAgICAgICBhdHRyaWJ1dGVzOiB7W3ByaW1hcnlLZXldOiBpZH0sXG4gICAgICAgIE1vZGVsQ2xhc3MsXG4gICAgICAgIG9wZXJhdGlvbjogXCJkZXN0cm95XCJcbiAgICAgIH0pXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IE1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJkZXN0cm95XCIsIHtcbiAgICAgIGlkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGF0dGFjaG1lbnQgcGF5bG9hZCBxdWV1ZWQgb24gdGhpcyBtb2RlbCBmb3IgdGhlIG5leHQgc2F2ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gQXR0YWNobWVudCBwYXlsb2FkIGtleWVkIGJ5IGF0dGFjaG1lbnQgbmFtZS5cbiAgICovXG4gIGFzeW5jIF9idWlsZEF0dGFjaG1lbnRzUGF5bG9hZCgpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cblxuICAgIGZvciAoY29uc3QgYXR0YWNobWVudE5hbWUgb2YgT2JqZWN0LmtleXModGhpcy5fYXR0YWNobWVudHMpKSB7XG4gICAgICBjb25zdCBhdHRhY2htZW50UGF5bG9hZCA9IGF3YWl0IHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXS5wZW5kaW5nQXR0YWNobWVudHNQYXlsb2FkKClcblxuICAgICAgaWYgKGF0dGFjaG1lbnRQYXlsb2FkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcGF5bG9hZFthdHRhY2htZW50TmFtZV0gPSBhdHRhY2htZW50UGF5bG9hZFxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICAvKiogQ2xlYXJzIHF1ZXVlZCBhdHRhY2htZW50IGlucHV0cyBhZnRlciBhIHN1Y2Nlc3NmdWwgc2F2ZS4gKi9cbiAgX2NsZWFyUGVuZGluZ0F0dGFjaG1lbnRzKCkge1xuICAgIGZvciAoY29uc3QgYXR0YWNobWVudE5hbWUgb2YgT2JqZWN0LmtleXModGhpcy5fYXR0YWNobWVudHMpKSB7XG4gICAgICB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0uY2xlYXJQZW5kaW5nQXR0YWNobWVudHMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXYWxrcyByZWxhdGlvbnNoaXBzIGRlY2xhcmVkIGluIHRoaXMgcmVzb3VyY2UncyBgbmVzdGVkQXR0cmlidXRlc2AgY29uZmlnXG4gICAqIGFuZCBidWlsZHMgdGhlIHBlci1yZWxhdGlvbnNoaXAgcGF5bG9hZCBvZiBkaXJ0eSBjaGlsZHJlbiBmb3IgYSBwYXJlbnQgc2F2ZS5cbiAgICpcbiAgICogSW5jbHVkZWQgY2hpbGRyZW46XG4gICAqICAgLSBuZXcgcmVjb3JkcyAoaXNOZXdSZWNvcmQoKSkg4oaSIGNyZWF0ZSBlbnRyeSB3aXRoIGF0dHJpYnV0ZXNcbiAgICogICAtIHJlY29yZHMgbWFya2VkIGZvciBkZXN0cnVjdGlvbiAobWFya2VkRm9yRGVzdHJ1Y3Rpb24oKSkg4oaSIGRlc3Ryb3kgZW50cnlcbiAgICogICAtIHJlY29yZHMgd2l0aCBjaGFuZ2VkIGF0dHJpYnV0ZXMgKGlzQ2hhbmdlZCgpKSDihpIgdXBkYXRlIGVudHJ5IHdpdGggYXR0cmlidXRlc1xuICAgKiAgIC0gcmVjb3JkcyB3aXRoIGRpcnR5IGRlc2NlbmRhbnRzIGluIHRoZWlyIG93biBuZXN0ZWRBdHRyaWJ1dGVzIOKGkiByZWN1cnNlXG4gICAqXG4gICAqIExvYWRlZCBidXQgdW50b3VjaGVkIHJlY29yZHMgYXJlIG9taXR0ZWQgc28gbmVzdGVkIHNhdmUgcHJlc2VydmVzIFJhaWxzLXN0eWxlXG4gICAqIFwiY2hpbGRyZW4gbm90IHJlZmVyZW5jZWQgaW4gcGF5bG9hZCBhcmUgbGVmdCBhbG9uZVwiIHNlbWFudGljcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj4+fSAtIFBlci1yZWxhdGlvbnNoaXAgbGlzdCBvZiBuZXN0ZWQtYXR0cmlidXRlIGVudHJpZXMuXG4gICAqL1xuICBhc3luYyBfYnVpbGROZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZCgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSBNb2RlbENsYXNzLnJlc291cmNlQ29uZmlnKClcbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnID0gcmVzb3VyY2VDb25maWc/Lm5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIGlmICghbmVzdGVkQXR0cmlidXRlc0NvbmZpZykgcmV0dXJuIHt9XG5cbiAgICAvKipcbiAgICAgKiBQYXlsb2FkLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pn0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnKSkge1xuICAgICAgLyoqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgICAgY29uc3QgZW50cmllcyA9IFtdXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCAmJiBBcnJheS5pc0FycmF5KHJlbGF0aW9uc2hpcC5fbG9hZGVkVmFsdWUpKSB7XG4gICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgcmVsYXRpb25zaGlwLl9sb2FkZWRWYWx1ZSkge1xuICAgICAgICAgIGNvbnN0IGNoaWxkRW50cnkgPSBhd2FpdCBjaGlsZC5fbmVzdGVkQXR0cmlidXRlc0VudHJ5Rm9yUGFyZW50U2F2ZSgpXG5cbiAgICAgICAgICBpZiAoY2hpbGRFbnRyeSkgZW50cmllcy5wdXNoKGNoaWxkRW50cnkpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwICYmIHJlbGF0aW9uc2hpcC5nZXRQcmVsb2FkZWQoKSkge1xuICAgICAgICBjb25zdCBjaGlsZCA9IHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICAgIGlmIChjaGlsZCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxCYXNlKSB7XG4gICAgICAgICAgY29uc3QgY2hpbGRFbnRyeSA9IGF3YWl0IGNoaWxkLl9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlGb3JQYXJlbnRTYXZlKClcblxuICAgICAgICAgIGlmIChjaGlsZEVudHJ5KSBlbnRyaWVzLnB1c2goY2hpbGRFbnRyeSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzLCByZWxhdGlvbnNoaXBOYW1lKSkge1xuICAgICAgICBlbnRyaWVzLnB1c2goXG4gICAgICAgICAgLi4uYXdhaXQgdGhpcy5fbmVzdGVkQXR0cmlidXRlc1BheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShcbiAgICAgICAgICAgIE1vZGVsQ2xhc3MsXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXNbcmVsYXRpb25zaGlwTmFtZV1cbiAgICAgICAgICApXG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgaWYgKGVudHJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgICBwYXlsb2FkW3JlbGF0aW9uc2hpcE5hbWVdID0gZW50cmllc1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBwYXlsb2FkIGVudHJ5IGZvciB0aGlzIGNoaWxkIHdoZW4gd2Fsa2VkIGJ5IGEgcGFyZW50J3NcbiAgICogYF9idWlsZE5lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkYC4gUmV0dXJucyBgbnVsbGAgd2hlbiB0aGUgY2hpbGQgaGFzIG5vXG4gICAqIGRpcnR5IHN0YXRlIGFuZCBubyBkaXJ0eSBkZXNjZW5kYW50cywgc28gdGhlIHBhcmVudCBjYW4gb21pdCBpdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gTmVzdGVkLWF0dHJpYnV0ZSBlbnRyeSBvciBudWxsIGlmIGNsZWFuLlxuICAgKi9cbiAgYXN5bmMgX25lc3RlZEF0dHJpYnV0ZXNFbnRyeUZvclBhcmVudFNhdmUoKSB7XG4gICAgaWYgKHRoaXMubWFya2VkRm9yRGVzdHJ1Y3Rpb24oKSkge1xuICAgICAgaWYgKHRoaXMuaXNOZXdSZWNvcmQoKSkgcmV0dXJuIG51bGxcbiAgICAgIHJldHVybiB7aWQ6IHRoaXMucHJpbWFyeUtleVZhbHVlKCksIF9kZXN0cm95OiB0cnVlfVxuICAgIH1cblxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLl9idWlsZE5lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkKClcbiAgICBjb25zdCBoYXNOZXN0ZWREaXJ0eSA9IE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDBcbiAgICBjb25zdCBhdHRhY2htZW50cyA9IGF3YWl0IHRoaXMuX2J1aWxkQXR0YWNobWVudHNQYXlsb2FkKClcbiAgICBjb25zdCBoYXNBdHRhY2htZW50cyA9IE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwXG5cbiAgICBpZiAodGhpcy5pc05ld1JlY29yZCgpKSB7XG4gICAgICAvKipcbiAgICAgICAqIEVudHJ5LlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IGVudHJ5ID0ge31cbiAgICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB0aGlzLl9jaGFuZ2VkQXR0cmlidXRlc0ZvclNhdmUoKVxuXG4gICAgICBpZiAoT2JqZWN0LmtleXMoYXR0cmlidXRlcykubGVuZ3RoID4gMCkgZW50cnkuYXR0cmlidXRlcyA9IGF0dHJpYnV0ZXNcbiAgICAgIGlmIChoYXNBdHRhY2htZW50cykgZW50cnkuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgICAgaWYgKGhhc05lc3RlZERpcnR5KSBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuXG4gICAgICByZXR1cm4gZW50cnlcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuaXNDaGFuZ2VkKCkgJiYgIWhhc05lc3RlZERpcnR5ICYmICFoYXNBdHRhY2htZW50cykgcmV0dXJuIG51bGxcblxuICAgIC8qKlxuICAgICAqIEVudHJ5LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgZW50cnkgPSB7aWQ6IHRoaXMucHJpbWFyeUtleVZhbHVlKCl9XG5cbiAgICBpZiAodGhpcy5pc0NoYW5nZWQoKSkgZW50cnkuYXR0cmlidXRlcyA9IHRoaXMuX2NoYW5nZWRBdHRyaWJ1dGVzRm9yU2F2ZSgpXG4gICAgaWYgKGhhc0F0dGFjaG1lbnRzKSBlbnRyeS5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgaWYgKGhhc05lc3RlZERpcnR5KSBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuXG4gICAgcmV0dXJuIGVudHJ5XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIG5lc3RlZCBlbnRyaWVzIGZyb20gYSBSYWlscy1zdHlsZSBzdWJtaXR0ZWQgYCpBdHRyaWJ1dGVzYCB2YWx1ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBQYXJlbnQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gTmVzdGVkIHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFN1Ym1pdHRlZCBuZXN0ZWQgYXR0cmlidXRlcyB2YWx1ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59IE5lc3RlZCBlbnRyaWVzIGZvciB0aGUgdHJhbnNwb3J0IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBfbmVzdGVkQXR0cmlidXRlc1BheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShNb2RlbENsYXNzLCByZWxhdGlvbnNoaXBOYW1lLCB2YWx1ZSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcERlZmluaXRpb24gPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcERlZmluaXRpb24ocmVsYXRpb25zaGlwTmFtZSlcbiAgICBjb25zdCBUYXJnZXRNb2RlbENsYXNzID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBNb2RlbENsYXNzKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcERlZmluaXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBuZXN0ZWQgcmVsYXRpb25zaGlwOiAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuICAgIGlmICghVGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIGlmIChyZWxhdGlvbnNoaXBUeXBlSXNDb2xsZWN0aW9uKHJlbGF0aW9uc2hpcERlZmluaXRpb24udHlwZSkpIHtcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfUF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBhcnJheWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgICAgdmFsdWUubWFwKGFzeW5jIChlbnRyeSkgPT4gYXdhaXQgdGhpcy5fbmVzdGVkQXR0cmlidXRlc0VudHJ5UGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKFRhcmdldE1vZGVsQ2xhc3MsIGVudHJ5KSlcbiAgICAgIClcbiAgICB9XG5cbiAgICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIFtdXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9QXR0cmlidXRlcyBtdXN0IGJlIGFuIG9iamVjdGApXG4gICAgfVxuXG4gICAgcmV0dXJuIFthd2FpdCB0aGlzLl9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoVGFyZ2V0TW9kZWxDbGFzcywgdmFsdWUpXVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIG9uZSBzdWJtaXR0ZWQgUmFpbHMtc3R5bGUgbmVzdGVkIGF0dHJpYnV0ZXMgb2JqZWN0IGludG8gdHJhbnNwb3J0IHBheWxvYWQgc2hhcGUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gTmVzdGVkIGNoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzdWJtaXR0ZWRFbnRyeSAtIFN1Ym1pdHRlZCBuZXN0ZWQgYXR0cmlidXRlcyBlbnRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gVHJhbnNwb3J0IG5lc3RlZC1hdHRyaWJ1dGVzIGVudHJ5LlxuICAgKi9cbiAgYXN5bmMgX25lc3RlZEF0dHJpYnV0ZXNFbnRyeVBheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShNb2RlbENsYXNzLCBzdWJtaXR0ZWRFbnRyeSkge1xuICAgIGlmICghZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KHN1Ym1pdHRlZEVudHJ5KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke01vZGVsQ2xhc3MubmFtZX0gbmVzdGVkIGF0dHJpYnV0ZXMgZW50cmllcyBtdXN0IGJlIG9iamVjdHNgKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGVudHJ5ID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBhdHRhY2htZW50cyA9IHt9XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pn0gKi9cbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzID0ge31cblxuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzdWJtaXR0ZWRFbnRyeSkpIHtcbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSBcImlkXCIgfHwgYXR0cmlidXRlTmFtZSA9PT0gXCJfZGVzdHJveVwiKSB7XG4gICAgICAgIGVudHJ5W2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgbmVzdGVkUmVsYXRpb25zaGlwTmFtZSA9IE1vZGVsQ2xhc3MubmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUoYXR0cmlidXRlTmFtZSlcblxuICAgICAgaWYgKG5lc3RlZFJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICAgICAgbmVzdGVkQXR0cmlidXRlc1tuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lXSA9IGF3YWl0IHRoaXMuX25lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoXG4gICAgICAgICAgTW9kZWxDbGFzcyxcbiAgICAgICAgICBuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHZhbHVlXG4gICAgICAgIClcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24oYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgICAgYXR0YWNobWVudHNbYXR0cmlidXRlTmFtZV0gPSBhd2FpdCB0aGlzLl9hdHRhY2htZW50UGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKE1vZGVsQ2xhc3MsIGF0dHJpYnV0ZU5hbWUsIHZhbHVlKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0cmlidXRlcykubGVuZ3RoID4gMCkgZW50cnkuYXR0cmlidXRlcyA9IGF0dHJpYnV0ZXNcbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDApIGVudHJ5LmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICBpZiAoT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykubGVuZ3RoID4gMCkgZW50cnkubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIHJldHVybiBlbnRyeVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBzdWJtaXR0ZWQgYXR0YWNobWVudCB2YWx1ZSBmb3IgdHJhbnNwb3J0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIG93bmluZyB0aGUgYXR0YWNobWVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFN1Ym1pdHRlZCBhdHRhY2htZW50IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXT59IE5vcm1hbGl6ZWQgYXR0YWNobWVudCBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgX2F0dGFjaG1lbnRQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoTW9kZWxDbGFzcywgYXR0YWNobWVudE5hbWUsIHZhbHVlKSB7XG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKGF0dGFjaG1lbnROYW1lKVxuXG4gICAgaWYgKGF0dGFjaG1lbnREZWZpbml0aW9uPy50eXBlID09PSBcImhhc01hbnlcIikge1xuICAgICAgY29uc3QgdmFsdWVzID0gQXJyYXkuaXNBcnJheSh2YWx1ZSkgPyB2YWx1ZSA6IFt2YWx1ZV1cblxuICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKHZhbHVlcy5tYXAoYXN5bmMgKGVudHJ5KSA9PiBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dChlbnRyeSkpKVxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgY29uc3QgbGFzdFZhbHVlID0gdmFsdWVbdmFsdWUubGVuZ3RoIC0gMV1cblxuICAgICAgaWYgKGxhc3RWYWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtNb2RlbENsYXNzLm5hbWV9IyR7YXR0YWNobWVudE5hbWV9IGF0dGFjaG1lbnQgYXJyYXkgY2Fubm90IGJlIGVtcHR5YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGxhc3RWYWx1ZSlcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogQWZ0ZXIgYSBwYXJlbnQgc2F2ZSB3aXRoIGBuZXN0ZWRBdHRyaWJ1dGVzYCwgdGhlIHNlcnZlciByZXNwb25zZSBpbmNsdWRlc1xuICAgKiBwcmVsb2FkZWQgdmVyc2lvbnMgb2YgdGhlIGFmZmVjdGVkIHJlbGF0aW9uc2hpcHMuIFRoaXMgcmVwbGFjZXMgdGhlIGxvY2FsXG4gICAqIGBfbG9hZGVkVmFsdWVgIGZvciBlYWNoIG5lc3RlZC13cml0YWJsZSByZWxhdGlvbnNoaXAgd2l0aCB0aGUgc2VydmVyJ3NcbiAgICogYXV0aG9yaXRhdGl2ZSBzZXQsIHNvIGRlc3Ryb3llZCBjaGlsZHJlbiBhcmUgZHJvcHBlZCBhbmQgbmV3bHktY3JlYXRlZFxuICAgKiBjaGlsZHJlbiBnZXQgdGhlaXIgc2VydmVyLWFzc2lnbmVkIGlkcyArIHBlcnNpc3RlZCBzdGF0ZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJlc3BvbnNlIC0gQ29tbWFuZCByZXNwb25zZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZWNvbmNpbGVOZXN0ZWRBdHRyaWJ1dGVzRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gTW9kZWxDbGFzcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlc0NvbmZpZyA9IHJlc291cmNlQ29uZmlnPy5uZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICBpZiAoIW5lc3RlZEF0dHJpYnV0ZXNDb25maWcpIHJldHVyblxuXG4gICAgY29uc3QgbW9kZWxEYXRhID0gTW9kZWxDbGFzcy5tb2RlbERhdGFGcm9tUmVzcG9uc2UocmVzcG9uc2UpXG4gICAgY29uc3QgcHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IG1vZGVsRGF0YS5wcmVsb2FkZWRSZWxhdGlvbnNoaXBzXG5cbiAgICAvKipcbiAgICAgKiBSZWxldmFudCBwcmVsb2Fkcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHJlbGV2YW50UHJlbG9hZHMgPSB7fVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXNDb25maWcpKSB7XG4gICAgICBpZiAocmVsYXRpb25zaGlwTmFtZSBpbiBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKSB7XG4gICAgICAgIHJlbGV2YW50UHJlbG9hZHNbcmVsYXRpb25zaGlwTmFtZV0gPSBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKHJlbGV2YW50UHJlbG9hZHMpLmxlbmd0aCA+IDApIHtcbiAgICAgIE1vZGVsQ2xhc3MuYXBwbHlQcmVsb2FkZWRSZWxhdGlvbnNoaXBzKHRoaXMsIHJlbGV2YW50UHJlbG9hZHMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZSBjb21tYW5kLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDb21tYW5kVHlwZX0gY29tbWFuZFR5cGUgLSBDb21tYW5kIHR5cGUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXlsb2FkIC0gQ29tbWFuZCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFBhcnNlZCBKU09OIHJlc3BvbnNlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGV4ZWN1dGVDb21tYW5kKGNvbW1hbmRUeXBlLCBwYXlsb2FkKSB7XG4gICAgY29uc3QgY29tbWFuZE5hbWUgPSB0aGlzLmNvbW1hbmROYW1lKGNvbW1hbmRUeXBlKVxuICAgIGNvbnN0IHRpbWVab25lID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKClcbiAgICBjb25zdCBzZXJpYWxpemVkUGF5bG9hZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHBheWxvYWQsIHt0aW1lWm9uZX0pKVxuICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KClcbiAgICBjb25zdCByZXF1ZXN0UGF5bG9hZCA9IG1lcmdlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0LCBzZXJpYWxpemVkUGF5bG9hZClcbiAgICBjb25zdCByZXNvdXJjZVBhdGggPSB0aGlzLnJlc291cmNlUGF0aCgpXG4gICAgY29uc3QgY29udGFpbnNBdHRhY2htZW50VXBsb2FkID0gZnJvbnRlbmRNb2RlbFBheWxvYWRDb250YWluc0F0dGFjaG1lbnRVcGxvYWQoc2VyaWFsaXplZFBheWxvYWQpXG4gICAgY29uc3QgdXNlU2hhcmVkVHJhbnNwb3J0ID0gIWNvbnRhaW5zQXR0YWNobWVudFVwbG9hZFxuICAgIGNvbnN0IHVybCA9IHVzZVNoYXJlZFRyYW5zcG9ydCA/IGZyb250ZW5kTW9kZWxBcGlVcmwoKSA6IGZyb250ZW5kTW9kZWxDb21tYW5kVXJsKHJlc291cmNlUGF0aCB8fCBcIlwiLCBjb21tYW5kTmFtZSlcblxuICAgIGlmICh1c2VTaGFyZWRUcmFuc3BvcnQpIHtcbiAgICAgIGNvbnN0IGJhdGNoUmVzcG9uc2UgPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMucHVzaCh7XG4gICAgICAgICAgY29tbWFuZE5hbWUsXG4gICAgICAgICAgY29tbWFuZFR5cGUsXG4gICAgICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgICAgICBwYXlsb2FkOiBzZXJpYWxpemVkUGF5bG9hZCxcbiAgICAgICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgICAgICByZWplY3QsXG4gICAgICAgICAgcmVxdWVzdElkOiBgJHsrK3NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0SWR9YCxcbiAgICAgICAgICByZXNvbHZlLFxuICAgICAgICAgIHJlc291cmNlUGF0aFxuICAgICAgICB9KVxuXG4gICAgICAgIHNjaGVkdWxlU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RGbHVzaCgpXG4gICAgICB9KVxuXG4gICAgICBjb25zdCBkZWNvZGVkQmF0Y2hSZXNwb25zZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoYmF0Y2hSZXNwb25zZSlcblxuICAgICAgdGhpcy50aHJvd09uRXJyb3JGcm9udGVuZE1vZGVsUmVzcG9uc2Uoe1xuICAgICAgICBjb21tYW5kVHlwZSxcbiAgICAgICAgcmVzcG9uc2U6IGRlY29kZWRCYXRjaFJlc3BvbnNlXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gZGVjb2RlZEJhdGNoUmVzcG9uc2VcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdHJhY2tGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdChhc3luYyAoKSA9PiBydW5XaXRoVHJhbnNwb3J0RGVhZGxpbmUoXG4gICAgICB7XG4gICAgICAgIGVycm9yTWVzc2FnZTogYCR7dGhpcy5uYW1lfSMke2NvbW1hbmRUeXBlfSByZXF1ZXN0IHRpbWVkIG91dGAsXG4gICAgICAgIHNpZ25hbDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpLFxuICAgICAgICB0aW1lb3V0TXM6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lb3V0TXMoKVxuICAgICAgfSxcbiAgICAgIGFzeW5jIChzaWduYWwpID0+IHtcbiAgICAgICAgY29uc3QgZGlyZWN0UmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXF1ZXN0UGF5bG9hZCksXG4gICAgICAgICAgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiLFxuICAgICAgICAgIGhlYWRlcnM6IGZyb250ZW5kTW9kZWxSZXF1ZXN0SGVhZGVycyh0aW1lWm9uZSksXG4gICAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICBzaWduYWxcbiAgICAgICAgfSlcblxuICAgICAgICBjb25zdCBkaXJlY3RSZXNwb25zZVRleHQgPSBhd2FpdCBkaXJlY3RSZXNwb25zZS50ZXh0KClcblxuICAgICAgICBpZiAoIWRpcmVjdFJlc3BvbnNlLm9rKSB7XG4gICAgICAgICAgdGhyb3dGcm9udGVuZE1vZGVsSHR0cEVycm9yKHtcbiAgICAgICAgICAgIGNvbW1hbmRMYWJlbDogYCR7dGhpcy5uYW1lfSMke2NvbW1hbmRUeXBlfWAsXG4gICAgICAgICAgICByZXNwb25zZTogZGlyZWN0UmVzcG9uc2UsXG4gICAgICAgICAgICByZXNwb25zZVRleHQ6IGRpcmVjdFJlc3BvbnNlVGV4dFxuICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBkaXJlY3RKc29uID0gZGlyZWN0UmVzcG9uc2VUZXh0Lmxlbmd0aCA+IDAgPyBKU09OLnBhcnNlKGRpcmVjdFJlc3BvbnNlVGV4dCkgOiB7fVxuICAgICAgICBjb25zdCBkZWNvZGVkRGlyZWN0UmVzcG9uc2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGRpcmVjdEpzb24pKVxuXG4gICAgICAgIHRoaXMudGhyb3dPbkVycm9yRnJvbnRlbmRNb2RlbFJlc3BvbnNlKHtcbiAgICAgICAgICBjb21tYW5kVHlwZSxcbiAgICAgICAgICByZXNwb25zZTogZGVjb2RlZERpcmVjdFJlc3BvbnNlXG4gICAgICAgIH0pXG5cbiAgICAgICAgcmV0dXJuIGRlY29kZWREaXJlY3RSZXNwb25zZVxuICAgICAgfVxuICAgICkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleGVjdXRlIGN1c3RvbSBjb21tYW5kLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3tjb21tYW5kTmFtZTogc3RyaW5nLCBjb21tYW5kVHlwZTogRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSwgbWVtYmVySWQ/OiBzdHJpbmcgfCBudW1iZXIgfCBudWxsLCBwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHJlc291cmNlUGF0aDogc3RyaW5nfX0gYXJncyAtIENvbW1hbmQgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+Pn0gLSBEZWNvZGVkIHJlc3BvbnNlIHBheWxvYWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZXhlY3V0ZUN1c3RvbUNvbW1hbmQoYXJncykge1xuICAgIGNvbnN0IHtjb21tYW5kTmFtZSwgY29tbWFuZFR5cGUsIG1lbWJlcklkID0gbnVsbCwgcGF5bG9hZCwgcmVzb3VyY2VQYXRofSA9IGFyZ3NcbiAgICBjb25zdCB0aW1lWm9uZSA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpXG4gICAgY29uc3Qgc2VyaWFsaXplZFBheWxvYWQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShwYXlsb2FkLCB7dGltZVpvbmV9KSlcbiAgICBjb25zdCByZXF1ZXN0Q29udGV4dCA9IGZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCgpXG5cbiAgICBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCwgc2VyaWFsaXplZFBheWxvYWQpXG4gICAgY29uc3QgY3VzdG9tUGF0aCA9IGZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kUGF0aCh7XG4gICAgICBjb21tYW5kTmFtZSxcbiAgICAgIG1lbWJlcklkLFxuICAgICAgbW9kZWxOYW1lOiB0aGlzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgcmVzb3VyY2VQYXRoXG4gICAgfSlcblxuICAgIGNvbnN0IGJhdGNoUmVzcG9uc2UgPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzLnB1c2goe1xuICAgICAgICBjb21tYW5kVHlwZSxcbiAgICAgICAgY3VzdG9tUGF0aCxcbiAgICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgICAgcGF5bG9hZDogc2VyaWFsaXplZFBheWxvYWQsXG4gICAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAgICByZWplY3QsXG4gICAgICAgIHJlcXVlc3RJZDogYCR7KytzaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdElkfWAsXG4gICAgICAgIHJlc29sdmVcbiAgICAgIH0pXG5cbiAgICAgIHNjaGVkdWxlU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RGbHVzaCgpXG4gICAgfSlcblxuICAgIGNvbnN0IGRlY29kZWRCYXRjaFJlc3BvbnNlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoYmF0Y2hSZXNwb25zZSlcblxuICAgIHRoaXMudGhyb3dPbkVycm9yRnJvbnRlbmRNb2RlbFJlc3BvbnNlKHtcbiAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgcmVzcG9uc2U6IGRlY29kZWRCYXRjaFJlc3BvbnNlXG4gICAgfSlcblxuICAgIHJldHVybiBkZWNvZGVkQmF0Y2hSZXNwb25zZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhyb3cgb24gZXJyb3IgZnJvbnRlbmQgbW9kZWwgcmVzcG9uc2UuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7e2NvbW1hbmRUeXBlOiBGcm9udGVuZE1vZGVsUmVxdWVzdENvbW1hbmRUeXBlLCByZXNwb25zZTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgdGhyb3dPbkVycm9yRnJvbnRlbmRNb2RlbFJlc3BvbnNlKGFyZ3MpIHtcbiAgICBjb25zdCB7Y29tbWFuZFR5cGUsIHJlc3BvbnNlfSA9IGFyZ3NcbiAgICBpZiAocmVzcG9uc2U/LnN0YXR1cyAhPT0gXCJlcnJvclwiKSByZXR1cm5cblxuICAgIGNvbnN0IHJlc3BvbnNlS2V5cyA9IE9iamVjdC5rZXlzKHJlc3BvbnNlKVxuICAgIGNvbnN0IGhhc09ubHlTdGF0dXMgPSByZXNwb25zZUtleXMubGVuZ3RoID09PSAxICYmIHJlc3BvbnNlS2V5c1swXSA9PT0gXCJzdGF0dXNcIlxuICAgIGNvbnN0IGhhc0Vycm9yTWVzc2FnZSA9IHR5cGVvZiByZXNwb25zZS5lcnJvck1lc3NhZ2UgPT09IFwic3RyaW5nXCIgJiYgcmVzcG9uc2UuZXJyb3JNZXNzYWdlLmxlbmd0aCA+IDBcbiAgICBjb25zdCBoYXNFcnJvckVudmVsb3BlS2V5cyA9IEJvb2xlYW4oXG4gICAgICByZXNwb25zZS5jb2RlICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHJlc3BvbnNlLmVycm9yICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHJlc3BvbnNlLmVycm9ycyAhPT0gdW5kZWZpbmVkXG4gICAgICB8fCByZXNwb25zZS5tZXNzYWdlICE9PSB1bmRlZmluZWRcbiAgICApXG4gICAgY29uc3Qgbm9uU3RhdHVzS2V5cyA9IHJlc3BvbnNlS2V5cy5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcInN0YXR1c1wiKVxuICAgIGNvbnN0IGNvbmZpZ3VyZWRBdHRyaWJ1dGVOYW1lcyA9IHRoaXMuY29uZmlndXJlZEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVOYW1lcygpXG4gICAgY29uc3QgbG9va3NMaWtlUmF3TW9kZWxQYXlsb2FkID0gbm9uU3RhdHVzS2V5cy5sZW5ndGggPiAwXG4gICAgICAmJiBub25TdGF0dXNLZXlzLmV2ZXJ5KChrZXkpID0+IGNvbmZpZ3VyZWRBdHRyaWJ1dGVOYW1lcy5oYXMoa2V5KSlcblxuICAgIGlmICghaGFzRXJyb3JNZXNzYWdlICYmICFoYXNPbmx5U3RhdHVzICYmICFoYXNFcnJvckVudmVsb3BlS2V5cyAmJiBsb29rc0xpa2VSYXdNb2RlbFBheWxvYWQpIHJldHVyblxuXG4gICAgY29uc3QgZGVidWdFcnJvck1lc3NhZ2UgPSB0eXBlb2YgcmVzcG9uc2UuZGVidWdFcnJvck1lc3NhZ2UgPT09IFwic3RyaW5nXCIgJiYgcmVzcG9uc2UuZGVidWdFcnJvck1lc3NhZ2UubGVuZ3RoID4gMFxuICAgICAgPyByZXNwb25zZS5kZWJ1Z0Vycm9yTWVzc2FnZVxuICAgICAgOiBudWxsXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZGVidWdFcnJvck1lc3NhZ2UgfHwgKGhhc0Vycm9yTWVzc2FnZVxuICAgICAgPyByZXNwb25zZS5lcnJvck1lc3NhZ2VcbiAgICAgIDogYFJlcXVlc3QgZmFpbGVkIGZvciAke3RoaXMubmFtZX0jJHtjb21tYW5kVHlwZX1gKVxuXG4gICAgY29uc3QgZXJyb3IgPSAvKiogQHR5cGUge0Vycm9yICYge2NvcnJlbGF0aW9uSWQ/OiBzdHJpbmcsIGRldGFpbHM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGVycm9yTWVzc2FnZT86IHN0cmluZywgdmVsb2Npb3VzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBlcnJvclR5cGU/OiBzdHJpbmcsIHZhbGlkYXRpb25FcnJvcnM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGRlYnVnRXJyb3JDbGFzcz86IHN0cmluZywgZGVidWdCYWNrdHJhY2U/OiBzdHJpbmdbXX19ICovIChuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKSlcbiAgICBpZiAoaGFzRXJyb3JNZXNzYWdlKSB7XG4gICAgICBlcnJvci5lcnJvck1lc3NhZ2UgPSByZXNwb25zZS5lcnJvck1lc3NhZ2VcbiAgICB9XG4gICAgaWYgKHJlc3BvbnNlLnZlbG9jaW91cyAmJiB0eXBlb2YgcmVzcG9uc2UudmVsb2Npb3VzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBlcnJvci52ZWxvY2lvdXMgPSByZXNwb25zZS52ZWxvY2lvdXNcbiAgICB9XG4gICAgaWYgKHR5cGVvZiByZXNwb25zZS5lcnJvclR5cGUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGVycm9yLmVycm9yVHlwZSA9IHJlc3BvbnNlLmVycm9yVHlwZVxuICAgIH1cbiAgICBpZiAocmVzcG9uc2UudmFsaWRhdGlvbkVycm9ycyAmJiB0eXBlb2YgcmVzcG9uc2UudmFsaWRhdGlvbkVycm9ycyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgZXJyb3IudmFsaWRhdGlvbkVycm9ycyA9IHJlc3BvbnNlLnZhbGlkYXRpb25FcnJvcnNcbiAgICB9XG4gICAgaWYgKHJlc3BvbnNlLmRldGFpbHMgJiYgdHlwZW9mIHJlc3BvbnNlLmRldGFpbHMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGVycm9yLmRldGFpbHMgPSByZXNwb25zZS5kZXRhaWxzXG4gICAgfVxuICAgIGlmICh0eXBlb2YgcmVzcG9uc2UuY29ycmVsYXRpb25JZCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgZXJyb3IuY29ycmVsYXRpb25JZCA9IHJlc3BvbnNlLmNvcnJlbGF0aW9uSWRcbiAgICB9XG4gICAgLy8gRm9yd2FyZCBzZXJ2ZXItcHJvdmlkZWQgZGVidWcgZGV0YWlsIChpbmNsdWRlZCBvbmx5IHdoZW4gdGhlIGJhY2tlbmRcbiAgICAvLyBkZWVtcyB0aGUgcmVxdWVzdGVyIGFsbG93ZWQgdG8gc2VlIGl0LCBlLmcuIGFuIGFkbWluKSBzbyBjYWxsZXJzIGNhblxuICAgIC8vIHJlbmRlciB0aGUgcmVhbCBlcnJvciBjbGFzcyBhbmQgc3RhY2sgdHJhY2UgaW5zdGVhZCBvZiB0aGUgZ2VuZXJpY1xuICAgIC8vIGNsaWVudC1zYWZlIG1lc3NhZ2UuXG4gICAgaWYgKHR5cGVvZiByZXNwb25zZS5kZWJ1Z0Vycm9yQ2xhc3MgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGVycm9yLmRlYnVnRXJyb3JDbGFzcyA9IHJlc3BvbnNlLmRlYnVnRXJyb3JDbGFzc1xuICAgIH1cbiAgICBpZiAoQXJyYXkuaXNBcnJheShyZXNwb25zZS5kZWJ1Z0JhY2t0cmFjZSkpIHtcbiAgICAgIGVycm9yLmRlYnVnQmFja3RyYWNlID0gcmVzcG9uc2UuZGVidWdCYWNrdHJhY2VcbiAgICB9XG4gICAgdGhyb3cgZXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbmZpZ3VyZWQgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIG5hbWVzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gQ29uZmlndXJlZCBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqL1xuICBzdGF0aWMgY29uZmlndXJlZEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVOYW1lcygpIHtcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodGhpcy5yZXNvdXJjZUNvbmZpZygpKVxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSByZXNvdXJjZUNvbmZpZy5hdHRyaWJ1dGVzXG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVzKSkge1xuICAgICAgcmV0dXJuIG5ldyBTZXQoYXR0cmlidXRlcy5maWx0ZXIoKGF0dHJpYnV0ZU5hbWUpID0+IHR5cGVvZiBhdHRyaWJ1dGVOYW1lID09PSBcInN0cmluZ1wiKSlcbiAgICB9XG5cbiAgICBpZiAoYXR0cmlidXRlcyAmJiB0eXBlb2YgYXR0cmlidXRlcyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgcmV0dXJuIG5ldyBTZXQoT2JqZWN0LmtleXMoYXR0cmlidXRlcykpXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBTZXQoKVxuICB9XG59XG5cbi8qKiBQdWJsaWMgZnJvbnRlbmQgbW9kZWwgZm9yIHNhZmUgVmVsb2Npb3VzIGF0dGFjaG1lbnQgbWV0YWRhdGEuICovXG5leHBvcnQgY2xhc3MgVmVsb2Npb3VzQXR0YWNobWVudCBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnfSAtIFJlc291cmNlIGNvbmZpZy5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcbiAgICByZXR1cm4ge1xuICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICBieXRlU2l6ZToge3R5cGU6IFwiaW50ZWdlclwifSxcbiAgICAgICAgY29udGVudFR5cGU6IHtudWxsOiB0cnVlLCB0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgICAgIGNyZWF0ZWRBdDoge3R5cGU6IFwiZGF0ZXRpbWVcIn0sXG4gICAgICAgIGZpbGVuYW1lOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgICAgICBpZDoge3R5cGU6IFwidXVpZFwifSxcbiAgICAgICAgbmFtZToge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICAgICAgcG9zaXRpb246IHt0eXBlOiBcImludGVnZXJcIn0sXG4gICAgICAgIHJlY29yZElkOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgICAgICByZWNvcmRUeXBlOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgICAgICB1cGRhdGVkQXQ6IHt0eXBlOiBcImRhdGV0aW1lXCJ9XG4gICAgICB9LFxuICAgICAgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kczogW1wiaW5kZXhcIl0sXG4gICAgICBidWlsdEluTWVtYmVyQ29tbWFuZHM6IFtcImZpbmRcIl0sXG4gICAgICBtb2RlbE5hbWU6IFwiVmVsb2Npb3VzQXR0YWNobWVudFwiLFxuICAgICAgcHJpbWFyeUtleTogXCJpZFwiXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgaWQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0YWNobWVudCBpZC5cbiAgICovXG4gIGlkKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwiaWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBvd25lciBtb2RlbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE93bmVyIG1vZGVsIG5hbWUuXG4gICAqL1xuICByZWNvcmRUeXBlKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwicmVjb3JkVHlwZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIG93bmVyIHJlY29yZCBpZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBPd25lciByZWNvcmQgaWQuXG4gICAqL1xuICByZWNvcmRJZCgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcInJlY29yZElkXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBuYW1lIG9uIHRoZSBvd25lciBtb2RlbC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBdHRhY2htZW50IG5hbWUgb24gdGhlIG93bmVyIG1vZGVsLlxuICAgKi9cbiAgbmFtZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcIm5hbWVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IHBvc2l0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEF0dGFjaG1lbnQgcG9zaXRpb24uXG4gICAqL1xuICBwb3NpdGlvbigpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcInBvc2l0aW9uXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBmaWxlbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBdHRhY2htZW50IGZpbGVuYW1lLlxuICAgKi9cbiAgZmlsZW5hbWUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJmaWxlbmFtZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgY29udGVudCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBBdHRhY2htZW50IGNvbnRlbnQgdHlwZS5cbiAgICovXG4gIGNvbnRlbnRUeXBlKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwiY29udGVudFR5cGVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IGJ5dGUgc2l6ZS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBBdHRhY2htZW50IGJ5dGUgc2l6ZS5cbiAgICovXG4gIGJ5dGVTaXplKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwiYnl0ZVNpemVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjcmVhdGVkLWF0IHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge0RhdGV9IC0gQ3JlYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqL1xuICBjcmVhdGVkQXQoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJjcmVhdGVkQXRcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSB1cGRhdGVkLWF0IHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge0RhdGV9IC0gVXBkYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqL1xuICB1cGRhdGVkQXQoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJ1cGRhdGVkQXRcIikgfVxufVxuXG5Gcm9udGVuZE1vZGVsQmFzZS5yZWdpc3Rlck1vZGVsKFZlbG9jaW91c0F0dGFjaG1lbnQpXG4iXX0=