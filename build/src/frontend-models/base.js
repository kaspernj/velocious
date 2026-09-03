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
                deleteFrontendModelInstanceListener(this, listener);
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
 * Removes every identity key pointing at an instance listener.
 * @param {FrontendModelEventSubscription} sub - Event subscription bucket.
 * @param {ReturnType<typeof ensureFrontendModelInstanceListener>} listener - Instance listener bucket.
 * @returns {void}
 */
function deleteFrontendModelInstanceListener(sub, listener) {
    for (const [id, current] of sub.instanceListeners) {
        if (current === listener)
            sub.instanceListeners.delete(id);
    }
}
/**
 * Removes one instance callback entry and tears down an empty listener/subscription bucket.
 * @param {FrontendModelEventSubscription} sub - Event subscription bucket.
 * @param {(listener: ReturnType<typeof ensureFrontendModelInstanceListener>) => boolean} removeEntry - Callback entry removal.
 * @returns {void}
 */
function removeFrontendModelInstanceListenerEntry(sub, removeEntry) {
    for (const current of sub.instanceListeners.values()) {
        if (!removeEntry(current))
            continue;
        if (current.updateCallbacks.size === 0 && current.destroyCallbacks.size === 0) {
            deleteFrontendModelInstanceListener(sub, current);
        }
        break;
    }
    sub.maybeTeardown();
}
/**
 * Temporarily registers an instance listener under its pending identity while retaining its persisted identity.
 * @param {FrontendModelClass} ModelClass - Frontend model class.
 * @param {FrontendModelBase} instance - Instance being re-keyed.
 * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} previousIdentity - Persisted identity.
 * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} nextIdentity - Pending identity sent to the server.
 * @returns {() => void} - Callback that removes the temporary aliases.
 */
function aliasFrontendModelInstanceListeners(ModelClass, instance, previousIdentity, nextIdentity) {
    const primaryKey = ModelClass.primaryKey();
    const previousId = modelPrimaryKeyCacheKey(primaryKey, previousIdentity);
    const nextId = modelPrimaryKeyCacheKey(primaryKey, nextIdentity);
    /** @type {Array<{listener: ReturnType<typeof ensureFrontendModelInstanceListener>, sub: FrontendModelEventSubscription}>} */
    const aliases = [];
    if (previousId === nextId)
        return () => { };
    const subscriptions = frontendModelEventSubscriptions.get(ModelClass);
    if (!subscriptions)
        return () => { };
    for (const sub of subscriptions.values()) {
        const listener = sub.instanceListeners.get(previousId);
        if (!listener || listener.instance !== instance || sub.instanceListeners.has(nextId))
            continue;
        sub.instanceListeners.set(nextId, listener);
        aliases.push({ listener, sub });
    }
    return () => {
        for (const { listener, sub } of aliases) {
            if (sub.instanceListeners.get(previousId) === listener && sub.instanceListeners.get(nextId) === listener) {
                sub.instanceListeners.delete(nextId);
            }
        }
    };
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
        const removeTemporaryListenerAliases = previousIdentity === null
            ? () => { }
            : aliasFrontendModelInstanceListeners(ModelClass, this, previousIdentity, this.primaryKeyValue());
        let response;
        try {
            response = await ModelClass.executeCommand(commandType, payload);
        }
        catch (error) {
            removeTemporaryListenerAliases();
            throw error;
        }
        removeTemporaryListenerAliases();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbHMvYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxPQUFPLE1BQU0sMkJBQTJCLENBQUE7QUFDL0MsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxrQkFBa0IsRUFBRSxFQUFDLGdDQUFnQyxFQUFDLE1BQU0sWUFBWSxDQUFBO0FBQy9FLE9BQU8sc0JBQXNCLE1BQU0sZ0JBQWdCLENBQUE7QUFDbkQsT0FBTyxFQUFDLDJCQUEyQixFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0UsT0FBTyxFQUFDLHFCQUFxQixFQUFFLHlCQUF5QixFQUFDLE1BQU0scUJBQXFCLENBQUE7QUFDcEYsT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGlDQUFpQyxFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0gsT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDekgsT0FBTyx3QkFBd0IsTUFBTSx5QkFBeUIsQ0FBQTtBQUM5RCxPQUFPLEVBQUMsd0JBQXdCLEVBQUUsZ0JBQWdCLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUMxRSxPQUFPLHdCQUF3QixNQUFNLG9DQUFvQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyx1QkFBdUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ3BFLE9BQU8sRUFBQyx3Q0FBd0MsRUFBRSxzQ0FBc0MsRUFBQyxNQUFNLDZCQUE2QixDQUFBO0FBQzVILE9BQU8sRUFBQyxtQkFBbUIsRUFBRSwyQkFBMkIsRUFBRSwyQkFBMkIsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ3hILE9BQU8sRUFBQyxnQkFBZ0IsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQ3hELE9BQU8sYUFBYSxNQUFN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QUFJLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUU1Qzs7O09BR0c7SUFDSCxRQUFRLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVwRDs7O09BR0c7SUFDSCxRQUFRLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVwRDs7O09BR0c7SUFDSCxXQUFXLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUUxRDs7O09BR0c7SUFDSCxRQUFRLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVwRDs7O09BR0c7SUFDSCxTQUFTLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUV0RDs7O09BR0c7SUFDSCxTQUFTLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFBLENBQUMsQ0FBQztDQUN2RDtBQUVELGlCQUFpQixDQUFDLGFBQWEsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHRpbWVvdXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IHdhaXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3dhaXQuanNcIlxuaW1wb3J0IEZyb250ZW5kTW9kZWxRdWVyeSwge2Zyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkfSBmcm9tIFwiLi9xdWVyeS5qc1wiXG5pbXBvcnQgRnJvbnRlbmRNb2RlbFByZWxvYWRlciBmcm9tIFwiLi9wcmVsb2FkZXIuanNcIlxuaW1wb3J0IHtub3JtYWxpemVEYXRlU3RyaW5nRm9yV3JpdGV9IGZyb20gXCIuLi9kYXRhYmFzZS9kYXRldGltZS1zdG9yYWdlLmpzXCJcbmltcG9ydCB7cmVnaXN0ZXJGcm9udGVuZE1vZGVsLCByZXNvbHZlRnJvbnRlbmRNb2RlbENsYXNzfSBmcm9tIFwiLi9tb2RlbC1yZWdpc3RyeS5qc1wiXG5pbXBvcnQge3ZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWUsIHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aH0gZnJvbSBcIi4vcmVzb3VyY2UtY29uZmlnLXZhbGlkYXRpb24uanNcIlxuaW1wb3J0IHtkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSwgc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBmcm9tIFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiXG5pbXBvcnQgcnVuV2l0aFRyYW5zcG9ydERlYWRsaW5lIGZyb20gXCIuL3RyYW5zcG9ydC1kZWFkbGluZS5qc1wiXG5pbXBvcnQge1JFUVVFU1RfVElNRV9aT05FX0hFQURFUiwgdmFsaWRhdGVUaW1lWm9uZX0gZnJvbSBcIi4uL3RpbWUtem9uZS5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50IGZyb20gXCIuLi9odHRwLWNsaWVudC93ZWJzb2NrZXQtY2xpZW50LmpzXCJcbmltcG9ydCB7cmVtb3RlUmVxdWVzdENvbnRleHRLZXl9IGZyb20gXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCJcbmltcG9ydCB7Y2FwdHVyZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dCwgbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHR9IGZyb20gXCIuL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuaW1wb3J0IHtidWZmZXJPdXRnb2luZ0V2ZW50LCBjbGVhckJ1ZmZlcmVkT3V0Z29pbmdFdmVudHMsIGRyYWluQnVmZmVyZWRPdXRnb2luZ0V2ZW50c30gZnJvbSBcIi4vb3V0Z29pbmctZXZlbnQtYnVmZmVyLmpzXCJcbmltcG9ydCB7ZGVmaW5lTW9kZWxTY29wZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCJcbmltcG9ydCBpc1BsYWluT2JqZWN0IGZyb20gXCIuLi91dGlscy9wbGFpbi1vYmplY3QuanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDYWNoZUtleSwgbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucywgcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlLCBzY2FsYXJNb2RlbFByaW1hcnlLZXl9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQge3JlYWRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCwgcmVhZFBheWxvYWRDb21wdXRlZEFiaWxpdHksIHJlYWRQYXlsb2FkUXVlcnlEYXRhLCBzZXRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCwgc2V0UGF5bG9hZENvbXB1dGVkQWJpbGl0eSwgc2V0UGF5bG9hZFF1ZXJ5RGF0YX0gZnJvbSBcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiXG5cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgcmVsYXRpb25zaGlwIGhlbHBlciB0eXBlLiBSZXR1cm5lZCBieSBgZ2V0UmVsYXRpb25zaGlwQnlOYW1lYCxcbiAqIHdoaWNoIGdlbmVyYXRlZCBtb2RlbHMgaW1tZWRpYXRlbHkgY2FzdCB0byB0aGVpciBjb25jcmV0ZSByZWxhdGlvbnNoaXAgdHlwZVxuICogKGUuZy4gYEZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcDxPd25lciwgVGFyZ2V0LCBUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzPmApLlxuICogVGhlIG1lbWJlcnMgdXNlIGBhbnlgIHR5cGUgYXJncyBzbyB0aGF0IGNhc3QgaXMgYWxsb3dlZCByZWdhcmRsZXNzIG9mIHRoZVxuICogdGFyZ2V0IG1vZGVsJ3MgdHlwZWQtYXR0cmlidXRlIGdlbmVyaWNzIOKAlCBhIGNvbmNyZXRlIGBGcm9udGVuZE1vZGVsQmFzZWAgbWVtYmVyXG4gKiBoZXJlIG1ha2VzIHRoZSBjYXN0IGEgbm9uLW92ZXJsYXBwaW5nIChUUzIzNTIpIGVycm9yIGZvciBldmVyeSB0eXBlZCBtb2RlbC5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcDxhbnksIGFueSwgYW55PiB8IEZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcDxhbnksIGFueSwgYW55Pn0gRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcFxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tjYWxsYmFjazogKHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWUsIG1vZGVsOiBGcm9udGVuZE1vZGVsQmFzZX0pID0+IHZvaWQsIGV2ZW50RmlsdGVyS2V5OiBzdHJpbmcgfCBudWxsLCBldmVudEZpbHRlclBheWxvYWQ6IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZCB8IG51bGwsIHByb2plY3Rpb25QYXlsb2FkOiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH19IEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tjYWxsYmFjazogKHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWV9KSA9PiB2b2lkfX0gRnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnlcbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtcImNyZWF0ZVwiIHwgXCJmaW5kXCIgfCBcImluZGV4XCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gRnJvbnRlbmRNb2RlbENvbW1hbmRUeXBlICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29tbWFuZFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGUgfCBzdHJpbmd9IEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29tbWFuZFR5cGUgKi9cbi8qKlxuICogTW9kZWwtbGlrZSBpbnN0YW5jZSB2YWx1ZSBzdXBwb3J0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0LlxuICogQHR5cGVkZWYge3thdHRyaWJ1dGVzOiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn19IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRNb2RlbFZhbHVlXG4gKi9cbi8qKlxuICogU3BlY2lhbCBzY2FsYXIgdmFsdWVzIHJlc3RvcmVkIGJ5IGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydC5cbiAqIEB0eXBlZGVmIHt1bmRlZmluZWQgfCBudWxsIHwgYm9vbGVhbiB8IG51bWJlciB8IHN0cmluZyB8IGJpZ2ludCB8IERhdGUgfCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0TW9kZWxWYWx1ZX0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNjYWxhclZhbHVlXG4gKi9cbi8qKlxuICogUGxhaW4gb2JqZWN0IHN1cHBvcnRlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgdmFsdWVzLlxuICogTmVzdGVkIHZhbHVlcyBhcmUgaW50ZW50aW9uYWxseSBvcGFxdWUgYmVjYXVzZSBUeXBlU2NyaXB0IHJlamVjdHMgcmVjdXJzaXZlXG4gKiBKU0RvYyB0eXBlZGVmcyBmb3IgdGhpcyB0cmFuc3BvcnQgdmFsdWUgY29udHJhY3QuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRPYmplY3RcbiAqL1xuLyoqXG4gKiBWYWx1ZSBzdXBwb3J0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHNlcmlhbGl6YXRpb24gYW5kIGRlc2VyaWFsaXphdGlvbi5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsVHJhbnNwb3J0U2NhbGFyVmFsdWUgfCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0T2JqZWN0IHwgQXJyYXk8dW5rbm93bj59IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZVxuICovXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSB2YWx1ZSB1c2VkIHdoZW4gZ2VuZXJhdGVkIG1ldGFkYXRhIGNhbm5vdCBpbmZlciBhIG5hcnJvd2VyIHR5cGUuXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWVcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJoYXNPbmVcIiB8IFwiaGFzTWFueVwifX0gRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREZWZpbml0aW9uXG4gKi9cbi8qKlxuICogRGVmaW5lcyBmcm9udGVuZC1tb2RlbCBhdHRyaWJ1dGUgbWV0YWRhdGEuXG4gKiBAdHlwZWRlZiB7e2NvbHVtblR5cGU/OiBzdHJpbmcsIGRhdGFUeXBlPzogc3RyaW5nLCBqc0RvY1R5cGU/OiBzdHJpbmcsIG5hbWU/OiBzdHJpbmcsIG51bGw/OiBib29sZWFuLCBzZWxlY3RlZEJ5RGVmYXVsdD86IGJvb2xlYW4sIHNxbFR5cGU/OiBzdHJpbmcsIHR5cGU/OiBzdHJpbmd9fSBGcm9udGVuZE1vZGVsQXR0cmlidXRlRGVmaW5pdGlvblxuICovXG4vKipcbiAqIEF0dGFjaG1lbnQgaW5wdXQgYWNjZXB0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgYXR0YWNobWVudCBoZWxwZXJzIGJlZm9yZSBub3JtYWxpemF0aW9uLlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHthcnJheUJ1ZmZlcjogKCkgPT4gUHJvbWlzZTxBcnJheUJ1ZmZlcj4sIHR5cGU/OiBzdHJpbmcsIG5hbWU/OiBzdHJpbmd9IHwgbnVsbCB8IHVuZGVmaW5lZH0gRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRJbnB1dFxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IEZyb250ZW5kTW9kZWxTeW5jTWV0YWRhdGFcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHtcIm9wdGltaXN0aWNWZXJzaW9uXCIgfCBcInNlcnZlcldpbnNcIiB8IFwibGFzdFdyaXRlcldpbnNcIiB8IFwiZmllbGRUaHJlZVdheVwiIHwgXCJhcHBlbmRPbmx5XCJ9IEZyb250ZW5kTW9kZWxTeW5jQ29uZmxpY3RTdHJhdGVneVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tlbmFibGVkOiBib29sZWFuLCBvcGVyYXRpb25zOiBzdHJpbmdbXSwgcG9saWN5SGFzaDogc3RyaW5nLCBwb2xpY3lWZXJzaW9uOiBzdHJpbmcgfCBudWxsLCBjb25mbGljdFN0cmF0ZWd5PzogRnJvbnRlbmRNb2RlbFN5bmNDb25mbGljdFN0cmF0ZWd5LCBtZXRhZGF0YT86IEZyb250ZW5kTW9kZWxTeW5jTWV0YWRhdGF9fSBGcm9udGVuZE1vZGVsU3luY0NvbmZpZ1xuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3thdHRyaWJ1dGVzPzogQXJyYXk8c3RyaW5nIHwgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZURlZmluaXRpb24+IHwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZURlZmluaXRpb24+LCBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzPzogc3RyaW5nW10sIGJ1aWx0SW5NZW1iZXJDb21tYW5kcz86IHN0cmluZ1tdLCBjb2xsZWN0aW9uQ29tbWFuZHM/OiBzdHJpbmdbXSwgY29tbWFuZHM/OiBzdHJpbmdbXSwgbWVtYmVyQ29tbWFuZHM/OiBzdHJpbmdbXSwgYXR0YWNobWVudHM/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0YWNobWVudERlZmluaXRpb24+LCBtb2RlbE5hbWU/OiBzdHJpbmcsIG5lc3RlZEF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB7YWxsb3dEZXN0cm95PzogYm9vbGVhbiwgbGltaXQ/OiBudW1iZXJ9PiwgcHJpbWFyeUtleT86IHN0cmluZyB8IHN0cmluZ1tdLCByZWxhdGlvbnNoaXBzPzogc3RyaW5nW10sIHN5bmM/OiBGcm9udGVuZE1vZGVsU3luY0NvbmZpZ319IEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ1xuICovXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIGNvbnN0cnVjdG9yIHR5cGUuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlfSBbVD1Gcm9udGVuZE1vZGVsQmFzZV1cbiAqIEB0eXBlZGVmIHt7bmV3IChhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPik6IFR9fSBGcm9udGVuZE1vZGVsQ29uc3RydWN0b3JcbiAqL1xuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCBzdGF0aWMgc2lkZS5cbiAqXG4gKiBUaGUgdGVtcGxhdGUgZGVmYXVsdHMgYXJlIGludGVudGlvbmFsbHkgcGVybWlzc2l2ZSAoYGFueWAgbW9kZWwvYXR0cmlidXRlXG4gKiBwYXJhbXMpLiBUaGUgYmFyZSBgRnJvbnRlbmRNb2RlbENsYXNzYCBpcyB0aGUgYEB0aGlzYC9jb25zdHJhaW50IHR5cGUgb24gdGhlXG4gKiBzdGF0aWMgcXVlcnkgbWV0aG9kcyAoZmluZEJ5L2ZpbmQvd2hlcmUvcHJlbG9hZC8uLi4pOyBhIGdlbmVyYXRlZCBzdWJjbGFzc1xuICogZGVjbGFyZXMgdHlwZWQtYXR0cmlidXRlIGdlbmVyaWNzIChlLmcuIGBGcm9udGVuZE1vZGVsQmFzZTxBY2NvdW50QXR0cmlidXRlcyxcbiAqIEFjY291bnRDcmVhdGVBdHRyaWJ1dGVzLCBBY2NvdW50VXBkYXRlQXR0cmlidXRlcz5gKSB3aGljaCwgYWdhaW5zdCBhIGNvbmNyZXRlXG4gKiBgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPmAgZGVmYXVsdCwgZmFpbCB0aGUgY29uc3RyYWludCBieVxuICogaW52YXJpYW5jZS4gRGVmYXVsdGluZyB0byBgYW55YCBsZXRzIGFueSBzdWJjbGFzcyBzYXRpc2Z5IHRoZSBjb25zdHJhaW50IHdoaWxlXG4gKiB0aGUgbWV0aG9kcycgb3duIGBAdGVtcGxhdGUgVGAgc3RpbGwgY2FwdHVyZXMgdGhlIHByZWNpc2UgY2FsbGluZyBjbGFzcyBmb3JcbiAqIHRoZWlyIHJldHVybiB0eXBlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2V9IFtUPUZyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnk+XVxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtBdHRyaWJ1dGVzPWFueV1cbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbQ3JlYXRlQXR0cmlidXRlcz1hbnldXG4gKiBAdHlwZWRlZiB7e25ldyAoKTogVCwgY3JlYXRlKGF0dHJpYnV0ZXM/OiBDcmVhdGVBdHRyaWJ1dGVzKTogUHJvbWlzZTxUPn0gJiBPbWl0PHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZSwgXCJjcmVhdGVcIiB8IFwicHJvdG90eXBlXCI+fSBGcm9udGVuZE1vZGVsQ2xhc3NcbiAqL1xuLyoqXG4gKiBDcmVhdGUgYXR0cmlidXRlcyBhY2NlcHRlZCBieSBhIGZyb250ZW5kIG1vZGVsIGluc3RhbmNlLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZX0gVFxuICogQHR5cGVkZWYge1QgZXh0ZW5kcyBGcm9udGVuZE1vZGVsQmFzZTxSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBpbmZlciBDcmVhdGVBdHRyaWJ1dGVzLCBpbmZlciBfVXBkYXRlQXR0cmlidXRlcz4gPyBDcmVhdGVBdHRyaWJ1dGVzIDogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gRnJvbnRlbmRNb2RlbENyZWF0ZUF0dHJpYnV0ZXNGb3JcbiAqL1xuLyoqXG4gKiBMb2FkZWQgaW5zdGFuY2UgdHlwZSBmb3IgcmVsYXRpb25zaGlwIGhlbHBlciBnZW5lcmljcy4gT2xkZXIgZ2VuZXJhdGVkXG4gKiBmcm9udGVuZCBtb2RlbHMgcGFzc2VkIG1vZGVsIGNsYXNzZXMgaW50byByZWxhdGlvbnNoaXAgaGVscGVycywgd2hpbGUgbmV3ZXJcbiAqIGdlbmVyYXRlZCBtb2RlbHMgcGFzcyBpbnN0YW5jZSB0eXBlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFRcbiAqIEB0eXBlZGVmIHtUIGV4dGVuZHMgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlID8gSW5zdGFuY2VUeXBlPFQ+IDogVH0gRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZ1xuICogQHByb3BlcnR5IHtzdHJpbmcgfCAoKCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCl9IFt1cmxdIC0gT3B0aW9uYWwgZnJvbnRlbmQtbW9kZWwgVVJMLiBUaGlzIHNob3VsZCBiZSB0aGUgc2hhcmVkIGVuZHBvaW50IChmb3IgZXhhbXBsZSBgXCIvZnJvbnRlbmQtbW9kZWxzXCJgIG9yIGBcImh0dHBzOi8vZXhhbXBsZS5jb20vZnJvbnRlbmQtbW9kZWxzXCJgKS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3NoYXJlZF0gLSBEZXByZWNhdGVkIHNoYXJlZC1lbmRwb2ludCBmbGFnIHJldGFpbmVkIGZvciBjb21wYXRpYmlsaXR5LiBGcm9udGVuZC1tb2RlbCBDUlVEL2N1c3RvbSBjb21tYW5kcyB1c2UgdGhlIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgZW52ZWxvcGUgYnkgZGVmYXVsdC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgKCgpID0+IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpfSBbd2Vic29ja2V0VXJsXSAtIE9wdGlvbmFsIHdlYnNvY2tldCBVUkwuIFdoZW4gc2V0LCBWZWxvY2lvdXMgY3JlYXRlcyBhbmQgbWFuYWdlcyBpdHMgb3duIHdlYnNvY2tldCBjbGllbnQgaW50ZXJuYWxseS4gU3Vic2NyaXB0aW9ucyB1c2UgdGhlIHdlYnNvY2tldDsgQ1JVRCB1c2VzIEhUVFAgYW5kIGZhbGxzIGJhY2sgZ3JhY2VmdWxseS4gRXhhbXBsZTogYFwid3M6Ly9sb2NhbGhvc3Q6MzAwNi93ZWJzb2NrZXRcImAuXG4gKiBAcHJvcGVydHkge3twb3N0OiAocGF0aDogc3RyaW5nLCBib2R5PzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG9wdGlvbnM/OiB7aGVhZGVycz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sIHNpZ25hbD86IEFib3J0U2lnbmFsfSkgPT4gUHJvbWlzZTx7anNvbjogKCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Piwgc3Vic2NyaWJlOiAoY2hhbm5lbDogc3RyaW5nLCBvcHRpb25zOiB7cGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSwgY2FsbGJhY2s6IChwYXlsb2FkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZCkgPT4gKCgpID0+IHZvaWQpLCBzdWJzY3JpYmVBbmRXYWl0PzogKGNoYW5uZWw6IHN0cmluZywgb3B0aW9uczoge3BhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0sIGNhbGxiYWNrOiAocGF5bG9hZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHZvaWQpID0+IFByb21pc2U8KCgpID0+IHZvaWQpPn19IFt3ZWJzb2NrZXRDbGllbnRdIC0gT3B0aW9uYWwgd2Vic29ja2V0IGNsaWVudCBmb3Igc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0cyBhbmQgc3Vic2NyaXB0aW9ucy4gSXRzIGBwb3N0YCByZWNlaXZlcyB0aGUgYm91bmRlZC1kZWFkbGluZSBgc2lnbmFsYCBhbmQgc2hvdWxkIGZvcndhcmQgaXQgaW50byB0aGUgdW5kZXJseWluZyB0cmFuc3BvcnQgc28gdGhlIGRlYWRsaW5lIGNhbiBhYm9ydCB0aGUgbGl2ZSByZXF1ZXN0IGFuZCBpdHMgcmVzcG9uc2UtYm9keSByZWFkLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgKCgpID0+IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pfSBbcmVxdWVzdEhlYWRlcnNdIC0gRXh0cmEgSFRUUC9XUyBoZWFkZXJzIHRvIGF0dGFjaCB0byBldmVyeSBmcm9udGVuZC1tb2RlbCBBUEkgcmVxdWVzdC4gUGFzcyBhIGZ1bmN0aW9uIHRvIGNvbXB1dGUgdGhlbSBhdCByZXF1ZXN0IHRpbWUgKGZvciBleGFtcGxlIHRvIGluY2x1ZGUgdGhlIGN1cnJlbnQgbG9jYWxlKS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dCB8ICgoKSA9PiBpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0IHwgdW5kZWZpbmVkIHwgbnVsbCl9IFtyZXF1ZXN0Q29udGV4dF0gLSBJbW11dGFibGUgc2NhbGFyIGNvbnRleHQgY2FwdHVyZWQgaW5kZXBlbmRlbnRseSB3aGVuIGVhY2ggb3BlcmF0aW9uIG9yIGV2ZW50IHN1YnNjcmlwdGlvbiBzdGFydHMgYW5kIHNlbnQgZm9yIHJlbW90ZSB0ZW5hbnQvYWJpbGl0eSByZXNvbHV0aW9uLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCAoKCkgPT4gbnVtYmVyIHwgdW5kZWZpbmVkIHwgbnVsbCl9IFt0aW1lb3V0XSAtIEJvdW5kZWQgZGVhZGxpbmUgaW4gbWlsbGlzZWNvbmRzIGNvdmVyaW5nIGNvbm5lY3Rpb24sIHJlc3BvbnNlIGhlYWRlcnMsIGFuZCByZXNwb25zZS1ib2R5IGNvbnN1bXB0aW9uIGZvciBlYWNoIGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0LiBPbiBleHBpcnkgdGhlIGxpdmUgZmV0Y2gvYWRhcHRlciByZXF1ZXN0IGlzIGFib3J0ZWQgKGJ1aWx0IG9uIGF3YWl0ZXJ5J3MgYHRpbWVvdXRgKSBhbmQgYXdhaXRlcnkncyBgVGltZW91dEVycm9yYCBpcyB0aHJvd24sIHNvIGNhbGxlcnMgY2FuIGNsYXNzaWZ5IGEgdGltZW91dCB2aWEgYGVycm9yIGluc3RhbmNlb2YgVGltZW91dEVycm9yYC4gUGFzcyBhIGZ1bmN0aW9uIHRvIHJlc29sdmUgaXQgcGVyIHJlcXVlc3QuIEZhbHN5L2Fic2VudCBtZWFucyBubyBkZWFkbGluZS5cbiAqIEBwcm9wZXJ0eSB7QWJvcnRTaWduYWwgfCAoKCkgPT4gQWJvcnRTaWduYWwgfCB1bmRlZmluZWQgfCBudWxsKX0gW3NpZ25hbF0gLSBPcHRpb25hbCBjYWxsZXIvc2Vzc2lvbiBBYm9ydFNpZ25hbCBjb21wb3NlZCB3aXRoIHRoZSBkZWFkbGluZS4gQWJvcnRpbmcgaXQgY2FuY2VscyB0aGUgbGl2ZSByZXF1ZXN0IChmb3IgZXhhbXBsZSBvbiBzZXNzaW9uIHNodXRkb3duIG9yIG9mZmxpbmUgdHJhbnNpdGlvbik7IHRoZSByZXN1bHRpbmcgYWJvcnQgZXJyb3Igc3RheXMgZGlzdGluZ3Vpc2hhYmxlIGZyb20gYSB0aW1lb3V0LiBQYXNzIGEgZnVuY3Rpb24gdG8gcmVzb2x2ZSB0aGUgY3VycmVudCBzaWduYWwgcGVyIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge3tnZXQ6ICgpID0+IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQgfCBQcm9taXNlPHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQ+LCBzZXQ6IChzZXNzaW9uSWQ6IHN0cmluZykgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4sIGNsZWFyOiAoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn19IFtzZXNzaW9uU3RvcmVdIC0gT3B0aW9uYWwgc2Vzc2lvbklkIHBlcnNpc3RlbmNlIGhvb2sgZm9yd2FyZGVkIHRvIHRoZSBpbnRlcm5hbCBgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50YCBzbyBXUyBzZXNzaW9ucyBjYW4gYmUgcmVzdW1lZCBhY3Jvc3MgcGFnZSByZWxvYWRzIC8gYXBwIHJlc3RhcnRzLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCAoKCkgPT4gc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCl9IFt0aW1lWm9uZV0gLSBJQU5BIHRpbWV6b25lIHNlbnQgd2l0aCBldmVyeSBmcm9udGVuZC1tb2RlbCBBUEkgcmVxdWVzdCBmb3IgdGltZXpvbmUtbGVzcyBkYXRldGltZSBwYXJzaW5nLlxuICogQHByb3BlcnR5IHt7YWN0b3JEZXZpY2VJZDogc3RyaW5nLCBhY3RvclVzZXJJZDogc3RyaW5nLCBjbGllbnRNdXRhdGlvbklkPzogKCkgPT4gc3RyaW5nLCBlbmFibGVkPzogYm9vbGVhbiwgbXV0YXRpb25Mb2c6IGltcG9ydChcIi4uL3N5bmMvbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLmRlZmF1bHQsIG5vdz86ICgpID0+IERhdGUsIG9mZmxpbmVHcmFudDoge2lkOiBzdHJpbmd9fX0gW29mZmxpbmVTeW5jXSAtIE9mZmxpbmUgbXV0YXRpb24gcXVldWUgY29uZmlndXJhdGlvbi5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsSWRsZVdhaXRBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsSWRsZVdhaXRBcmdzXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3F1aWV0TXNdIC0gTWlsbGlzZWNvbmRzIHRoZSB0cmFuc3BvcnQgbXVzdCBzdGF5IGlkbGUgYmVmb3JlIHJlc29sdmluZy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbdGltZW91dF0gLSBUaW1lb3V0IGluIG1pbGxpc2Vjb25kcy5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBjb25maWcuXG4gKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZ30gKi9cbmNvbnN0IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcgPSB7fVxuY29uc3QgU0hBUkVEX0ZST05URU5EX01PREVMX0FQSV9QQVRIID0gXCIvZnJvbnRlbmQtbW9kZWxzXCJcbmNvbnN0IFBSRUxPQURFRF9SRUxBVElPTlNISVBTX0tFWSA9IFwiX19wcmVsb2FkZWRSZWxhdGlvbnNoaXBzXCJcbmNvbnN0IFNFTEVDVEVEX0FUVFJJQlVURVNfS0VZID0gXCJfX3NlbGVjdGVkQXR0cmlidXRlc1wiXG5jb25zdCBBU1NPQ0lBVElPTl9DT1VOVFNfS0VZID0gXCJfX2Fzc29jaWF0aW9uQ291bnRzXCJcbmNvbnN0IFFVRVJZX0RBVEFfS0VZID0gXCJfX3F1ZXJ5RGF0YVwiXG5jb25zdCBBQklMSVRJRVNfS0VZID0gXCJfX2FiaWxpdGllc1wiXG4vKipcbiAqIFBlbmRpbmcgc2hhcmVkIGZyb250ZW5kIG1vZGVsIHJlcXVlc3RzLlxuICogQHR5cGUge0FycmF5PHtjb21tYW5kTmFtZT86IHN0cmluZywgY29tbWFuZFR5cGU6IEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29tbWFuZFR5cGUsIGN1c3RvbVBhdGg/OiBzdHJpbmcsIG1vZGVsQ2xhc3M6IEZyb250ZW5kTW9kZWxDbGFzcywgcGF5bG9hZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCByZXF1ZXN0Q29udGV4dDogaW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dCwgcmVxdWVzdElkOiBzdHJpbmcsIHJlc29sdmU6IChyZXNwb25zZTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiB2b2lkLCByZWplY3Q6IChlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHZvaWQsIHJlc291cmNlUGF0aD86IHN0cmluZyB8IG51bGx9Pn0gKi9cbmxldCBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzID0gW11cblxubGV0IHNoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0SWQgPSAwXG5sZXQgc2hhcmVkRnJvbnRlbmRNb2RlbEZsdXNoU2NoZWR1bGVkID0gZmFsc2VcbmxldCBhY3RpdmVGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdENvdW50ID0gMFxuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCBpZGxlIHJlc29sdmVycy5cbiAqIEB0eXBlIHtBcnJheTwoKSA9PiB2b2lkPn0gKi9cbmxldCBmcm9udGVuZE1vZGVsSWRsZVJlc29sdmVycyA9IFtdXG5cbi8qKlxuICogSW50ZXJuYWwgd2Vic29ja2V0IGNsaWVudC5cbiAqIEB0eXBlIHtWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQgfCBudWxsfSAqL1xubGV0IGludGVybmFsV2Vic29ja2V0Q2xpZW50ID0gbnVsbFxuLyoqIEB0eXBlIHtBYm9ydFNpZ25hbCB8IG51bGx9ICovXG5sZXQgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwgPSBudWxsXG4vKiogQHR5cGUgeygoKSA9PiB2b2lkKSB8IG51bGx9ICovXG5sZXQgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwID0gbnVsbFxuXG4vKipcbiAqIERldGFjaGVzIGFuIG93bmVkIFdlYlNvY2tldCBjbGllbnQgZnJvbSB0aGUgc2hhcmVkIGNhY2hlIGlmIGl0IGlzIHN0aWxsIGN1cnJlbnQuXG4gKiBAcGFyYW0ge1ZlbG9jaW91c1dlYnNvY2tldENsaWVudH0gY2xpZW50IC0gQ2xpZW50IHdob3NlIG93bmVyc2hpcCBpcyBlbmRpbmcuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gZGV0YWNoSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoY2xpZW50KSB7XG4gIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cblxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudCA9IG51bGxcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwPy4oKVxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbCA9IG51bGxcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwID0gbnVsbFxufVxuXG4vKipcbiAqIERpc3Bvc2VzIHRoZSBvd25lZCBXZWJTb2NrZXQgY2xpZW50IGJlZm9yZSB0cmFuc3BvcnQvc2Vzc2lvbiBjb25maWd1cmF0aW9uIGNoYW5nZXMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gcmVzZXRJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpIHtcbiAgY29uc3QgY2xpZW50ID0gaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRcblxuICBpZiAoIWNsaWVudCkgcmV0dXJuXG5cbiAgZGV0YWNoSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoY2xpZW50KVxuICB2b2lkIGNsaWVudC5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG59XG5cbi8qKlxuICogQmluZHMgdGhlIG93bmVkIFdlYlNvY2tldCBjbGllbnQgbGlmZXRpbWUgdG8gdGhlIGN1cnJlbnQgc2Vzc2lvbiBzaWduYWwuXG4gKiBAcGFyYW0ge0Fib3J0U2lnbmFsIHwgdW5kZWZpbmVkfSBzZXNzaW9uU2lnbmFsIC0gQ3VycmVudCBzZXNzaW9uIHNpZ25hbC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBiaW5kSW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwoc2Vzc2lvblNpZ25hbCkge1xuICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwgPT09IHNlc3Npb25TaWduYWwpIHJldHVyblxuXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cD8uKClcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwgPSBzZXNzaW9uU2lnbmFsIHx8IG51bGxcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwID0gbnVsbFxuXG4gIGlmICghc2Vzc2lvblNpZ25hbCB8fCAhaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQpIHJldHVyblxuXG4gIGNvbnN0IGNsaWVudCA9IGludGVybmFsV2Vic29ja2V0Q2xpZW50XG4gIGNvbnN0IG9uU2Vzc2lvbkFib3J0ID0gKCkgPT4ge1xuICAgIGRldGFjaEludGVybmFsV2Vic29ja2V0Q2xpZW50KGNsaWVudClcbiAgICBjbGVhckJ1ZmZlcmVkT3V0Z29pbmdFdmVudHMoKVxuICAgIHZvaWQgY2xpZW50LmRpc2Nvbm5lY3RBbmRTdG9wUmVjb25uZWN0KClcbiAgfVxuXG4gIHNlc3Npb25TaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIG9uU2Vzc2lvbkFib3J0LCB7b25jZTogdHJ1ZX0pXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cCA9ICgpID0+IHNlc3Npb25TaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIG9uU2Vzc2lvbkFib3J0KVxuXG4gIGlmIChzZXNzaW9uU2lnbmFsLmFib3J0ZWQpIG9uU2Vzc2lvbkFib3J0KClcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBpcyBpZGxlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbGwgcXVldWVkIGFuZCBhY3RpdmUgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHJlcXVlc3RzIGFyZSBkb25lLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0SXNJZGxlKCkge1xuICByZXR1cm4gYWN0aXZlRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3RDb3VudCA9PT0gMFxuICAgICYmIHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMubGVuZ3RoID09PSAwXG4gICAgJiYgIXNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZFxufVxuXG4vKipcbiAqIFJ1bnMgcmVzb2x2ZSBmcm9udGVuZCBtb2RlbCBpZGxlIHdhaXRlcnMuXG4gKiBAcmV0dXJucyB7dm9pZH0gKi9cbmZ1bmN0aW9uIHJlc29sdmVGcm9udGVuZE1vZGVsSWRsZVdhaXRlcnMoKSB7XG4gIGlmICghZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpKSByZXR1cm5cblxuICBjb25zdCByZXNvbHZlcnMgPSBmcm9udGVuZE1vZGVsSWRsZVJlc29sdmVyc1xuICBmcm9udGVuZE1vZGVsSWRsZVJlc29sdmVycyA9IFtdXG5cbiAgZm9yIChjb25zdCByZXNvbHZlIG9mIHJlc29sdmVycykge1xuICAgIHJlc29sdmUoKVxuICB9XG59XG5cbi8qKlxuICogUnVucyB3YWl0IGZvciBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgcXVpZXQgcGVyaW9kLlxuICogQHBhcmFtIHtudW1iZXJ9IG1pbGxpc2Vjb25kcyAtIFF1aWV0IHBlcmlvZCBsZW5ndGguXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHF1aWV0IHBlcmlvZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gd2FpdEZvckZyb250ZW5kTW9kZWxUcmFuc3BvcnRRdWlldFBlcmlvZChtaWxsaXNlY29uZHMpIHtcbiAgaWYgKG1pbGxpc2Vjb25kcyA8PSAwKSByZXR1cm5cblxuICBhd2FpdCB3YWl0KG1pbGxpc2Vjb25kcylcbn1cblxuLyoqXG4gKiBSdW5zIHdhaXQgZm9yIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBpZGxlLlxuICogQHBhcmFtIHtudW1iZXJ9IHF1aWV0TXMgLSBNaWxsaXNlY29uZHMgdGhlIHRyYW5zcG9ydCBtdXN0IHN0YXkgaWRsZSBiZWZvcmUgcmVzb2x2aW5nLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gdHJhbnNwb3J0IHN0YXlzIGlkbGUuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JGcm9udGVuZE1vZGVsVHJhbnNwb3J0SWRsZShxdWlldE1zID0gMCkge1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIGlmIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0SXNJZGxlKCkpIHtcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBxdWV1ZU1pY3JvdGFzaygoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpKVxuXG4gICAgICBpZiAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpKSB7XG4gICAgICAgIGF3YWl0IHdhaXRGb3JGcm9udGVuZE1vZGVsVHJhbnNwb3J0UXVpZXRQZXJpb2QocXVpZXRNcylcblxuICAgICAgICBpZiAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpKSByZXR1cm5cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgZnJvbnRlbmRNb2RlbElkbGVSZXNvbHZlcnMucHVzaCgoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpXG4gICAgICB9KVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgdHJhY2sgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHJlcXVlc3QuXG4gKiBAdGVtcGxhdGUgVFxuICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zcG9ydCBjYWxsYmFjay5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gdHJhY2tGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdChjYWxsYmFjaykge1xuICBhY3RpdmVGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdENvdW50ICs9IDFcblxuICB0cnkge1xuICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gIH0gZmluYWxseSB7XG4gICAgYWN0aXZlRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3RDb3VudCAtPSAxXG4gICAgcmVzb2x2ZUZyb250ZW5kTW9kZWxJZGxlV2FpdGVycygpXG4gIH1cbn1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBpbnRlcm5hbCB3ZWJzb2NrZXQgY2xpZW50IGZyb20gd2Vic29ja2V0VXJsIGNvbmZpZy5cbiAqIENyZWF0ZXMgdGhlIGNsaWVudCBsYXppbHkgb24gZmlyc3QgY2FsbC4gUmV0dXJucyBudWxsIGlmIFdlYlNvY2tldFxuICogaXMgbm90IGF2YWlsYWJsZSBvciB3ZWJzb2NrZXRVcmwgaXMgbm90IGNvbmZpZ3VyZWQuXG4gKiBAcmV0dXJucyB7VmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50IHwgbnVsbH0gV2Vic29ja2V0IGNsaWVudCBvciBudWxsLlxuICovXG5mdW5jdGlvbiByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSB7XG4gIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCkge1xuICAgIGNvbnN0IGNsaWVudCA9IGludGVybmFsV2Vic29ja2V0Q2xpZW50XG5cbiAgICBiaW5kSW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpKVxuXG4gICAgcmV0dXJuIGNsaWVudFxuICB9XG5cbiAgY29uc3Qgd2Vic29ja2V0VXJsID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRVcmxcblxuICBpZiAoIXdlYnNvY2tldFVybCkgcmV0dXJuIG51bGxcbiAgaWYgKHR5cGVvZiBnbG9iYWxUaGlzLldlYlNvY2tldCA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIG51bGxcblxuICBjb25zdCByZXNvbHZlZFVybCA9IHR5cGVvZiB3ZWJzb2NrZXRVcmwgPT09IFwiZnVuY3Rpb25cIiA/IHdlYnNvY2tldFVybCgpIDogd2Vic29ja2V0VXJsXG5cbiAgaWYgKCFyZXNvbHZlZFVybCkgcmV0dXJuIG51bGxcblxuICBjb25zdCBjbGllbnQgPSBuZXcgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50KHtcbiAgICBhdXRvUmVjb25uZWN0OiB0cnVlLFxuICAgIHNlc3Npb25TdG9yZTogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zZXNzaW9uU3RvcmUsXG4gICAgdXJsOiByZXNvbHZlZFVybFxuICB9KVxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudCA9IGNsaWVudFxuICBjbGllbnQub25SZWNvbm5lY3QgPSBhc3luYyAoKSA9PiBhd2FpdCBmbHVzaEJ1ZmZlcmVkT3V0Z29pbmdFdmVudHNBZnRlclJlY29ubmVjdChjbGllbnQpXG5cbiAgYmluZEludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSlcblxuICByZXR1cm4gY2xpZW50XG59XG5cbi8qKlxuICogUnVucyBmbHVzaCBidWZmZXJlZCBvdXRnb2luZyBldmVudHMgYWZ0ZXIgcmVjb25uZWN0LlxuICogQHBhcmFtIHtWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnR9IGNsaWVudCAtIFJlY29ubmVjdGVkIGNsaWVudCB0aGF0IG93bnMgdGhpcyBmbHVzaC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAqL1xuYXN5bmMgZnVuY3Rpb24gZmx1c2hCdWZmZXJlZE91dGdvaW5nRXZlbnRzQWZ0ZXJSZWNvbm5lY3QoY2xpZW50KSB7XG4gIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cblxuICBjb25zdCBldmVudHMgPSBkcmFpbkJ1ZmZlcmVkT3V0Z29pbmdFdmVudHMoKVxuICBjb25zdCBzZXNzaW9uU2lnbmFsID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpXG5cbiAgYXdhaXQgcnVuV2l0aFRyYW5zcG9ydERlYWRsaW5lKFxuICAgIHtcbiAgICAgIGVycm9yTWVzc2FnZTogXCJCdWZmZXJlZCBmcm9udGVuZC1tb2RlbCBXZWJTb2NrZXQgZmx1c2ggdGltZWQgb3V0XCIsXG4gICAgICBzaWduYWw6IHNlc3Npb25TaWduYWwsXG4gICAgICB0aW1lb3V0TXM6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lb3V0TXMoKVxuICAgIH0sXG4gICAgYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGV2ZW50cy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgICAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50ICE9PSBjbGllbnQpIHJldHVyblxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgY2xpZW50LnBvc3QoZXZlbnRzW2luZGV4XS5jdXN0b21QYXRoLCBldmVudHNbaW5kZXhdLnBheWxvYWQsIHtzaWduYWx9KVxuXG4gICAgICAgICAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50ICE9PSBjbGllbnQpIHJldHVyblxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgIT09IGNsaWVudCkgcmV0dXJuXG4gICAgICAgICAgaWYgKHNlc3Npb25TaWduYWw/LmFib3J0ZWQpIHJldHVyblxuXG4gICAgICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgICAgICBmb3IgKGxldCByZW1haW5pbmcgPSBpbmRleDsgcmVtYWluaW5nIDwgZXZlbnRzLmxlbmd0aDsgcmVtYWluaW5nICs9IDEpIHtcbiAgICAgICAgICAgICAgYnVmZmVyT3V0Z29pbmdFdmVudChldmVudHNbcmVtYWluaW5nXSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3Qgc29ja2V0T3BlbiA9IGNsaWVudC5zb2NrZXQ/LnJlYWR5U3RhdGUgPT09IGNsaWVudC5zb2NrZXQ/Lk9QRU5cblxuICAgICAgICAgIGlmIChzb2NrZXRPcGVuKSBjb250aW51ZVxuXG4gICAgICAgICAgZm9yIChsZXQgcmVtYWluaW5nID0gaW5kZXg7IHJlbWFpbmluZyA8IGV2ZW50cy5sZW5ndGg7IHJlbWFpbmluZyArPSAxKSB7XG4gICAgICAgICAgICBidWZmZXJPdXRnb2luZ0V2ZW50KGV2ZW50c1tyZW1haW5pbmddKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICApXG59XG5cbi8qKlxuICogUnVucyBkZWZhdWx0IGZyb250ZW5kIG1vZGVsIHJlc291cmNlIHBhdGguXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBEZWZhdWx0IHJlc291cmNlIHBhdGggZm9yIHRoZSBtb2RlbCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gZGVmYXVsdEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgobW9kZWxDbGFzcykge1xuICByZXR1cm4gYC8ke2luZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24ucGx1cmFsaXplKGluZmxlY3Rpb24udW5kZXJzY29yZShtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpKSkpfWBcbn1cblxuLyoqIEVycm9yIHJhaXNlZCB3aGVuIHJlYWRpbmcgYW4gYXR0cmlidXRlIHRoYXQgd2FzIG5vdCBzZWxlY3RlZCBpbiBxdWVyeSBwYXlsb2Fkcy4gKi9cbmV4cG9ydCBjbGFzcyBBdHRyaWJ1dGVOb3RTZWxlY3RlZEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIHRoYXQgd2FzIHJlcXVlc3RlZC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG1vZGVsTmFtZSwgYXR0cmlidXRlTmFtZSkge1xuICAgIHN1cGVyKGAke21vZGVsTmFtZX0jJHthdHRyaWJ1dGVOYW1lfSB3YXMgbm90IHNlbGVjdGVkYClcbiAgICB0aGlzLm5hbWUgPSBcIkF0dHJpYnV0ZU5vdFNlbGVjdGVkRXJyb3JcIlxuICB9XG59XG5cbi8qKlxuICogTGlnaHR3ZWlnaHQgc2luZ3VsYXIgcmVsYXRpb25zaGlwIHN0YXRlIGhvbGRlciBmb3IgZnJvbnRlbmQgbW9kZWwgaW5zdGFuY2VzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gU1xuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gVFxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzPVJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT5dXG4gKi9cbmV4cG9ydCBjbGFzcyBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXAge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBQYXJlbnQgbW9kZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzPEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz4gfCBudWxsfSB0YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgY29uc3RydWN0b3IobW9kZWwsIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICB0aGlzLm1vZGVsID0gbW9kZWxcbiAgICB0aGlzLnJlbGF0aW9uc2hpcE5hbWUgPSByZWxhdGlvbnNoaXBOYW1lXG4gICAgdGhpcy50YXJnZXRNb2RlbENsYXNzID0gdGFyZ2V0TW9kZWxDbGFzc1xuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsfSAqL1xuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGxvYWRlZC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsIHwgdW5kZWZpbmVkfSBsb2FkZWRWYWx1ZSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0TG9hZGVkKGxvYWRlZFZhbHVlKSB7XG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBsb2FkZWRWYWx1ZSA9PSB1bmRlZmluZWQgPyBudWxsIDogbG9hZGVkVmFsdWVcbiAgICB0aGlzLl9wcmVsb2FkZWQgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcHJlbG9hZGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlbGF0aW9uc2hpcCBpcyBwcmVsb2FkZWQuXG4gICAqL1xuICBnZXRQcmVsb2FkZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3ByZWxvYWRlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZGVkLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbH0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgbG9hZGVkKCkge1xuICAgIGlmICghdGhpcy5fcHJlbG9hZGVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX0gaGFzbid0IGJlZW4gcHJlbG9hZGVkYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fbG9hZGVkVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3BpZXMgbG9hZGVkIHZhbHVlIGZyb20gYW5vdGhlciBzaW5ndWxhciByZWxhdGlvbnNoaXAgaGVscGVyLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXB9IHNvdXJjZVJlbGF0aW9uc2hpcCAtIFNvdXJjZSByZWxhdGlvbnNoaXAgaGVscGVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNvcHlMb2FkZWRGcm9tKHNvdXJjZVJlbGF0aW9uc2hpcCkge1xuICAgIGlmIChzb3VyY2VSZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IHNvdXJjZSByZWxhdGlvbnNoaXAgdG8gYmUgc2luZ3VsYXJgKVxuICAgIH1cblxuICAgIC8vIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIHRhcmdldCByZWxhdGlvbnNoaXAncyBkb2N1bWVudGVkIG1vZGVsIHR5cGUuXG4gICAgY29uc3QgbG9hZGVkVmFsdWUgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGx9ICovIChzb3VyY2VSZWxhdGlvbnNoaXAubG9hZGVkKCkpXG5cbiAgICB0aGlzLnNldExvYWRlZChsb2FkZWRWYWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkLlxuICAgKiBAcGFyYW0ge1RhcmdldENyZWF0ZUF0dHJpYnV0ZXN9IFthdHRyaWJ1dGVzXSAtIE5ldyBtb2RlbCBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+fSAtIEJ1aWx0IG1vZGVsLlxuICAgKi9cbiAgYnVpbGQoYXR0cmlidXRlcyA9IC8qKiBAdHlwZSB7VGFyZ2V0Q3JlYXRlQXR0cmlidXRlc30gKi8gKHt9KSkge1xuICAgIGlmICghdGhpcy50YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyBjb25maWd1cmVkIGZvciAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtuZXcgKGF0dHJpYnV0ZXM/OiBUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzKSA9PiBGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD59ICovICh0aGlzLnRhcmdldE1vZGVsQ2xhc3MpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcyhhdHRyaWJ1dGVzKVxuXG4gICAgdGhpcy5zZXRMb2FkZWQobW9kZWwpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3JjZS1yZWxvYWQgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIGxvYWQoKSB7XG4gICAgdGhpcy5fcHJlbG9hZGVkID0gZmFsc2VcbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IG51bGxcblxuICAgIGNvbnN0IGJhdGNoZWQgPSBhd2FpdCB0aGlzLm1vZGVsLl90cnlDb2hvcnRQcmVsb2FkKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChiYXRjaGVkKSByZXR1cm4gdGhpcy5sb2FkZWQoKVxuXG4gICAgYXdhaXQgdGhpcy5tb2RlbC5sb2FkUmVsYXRpb25zaGlwKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIHJldHVybiB0aGlzLmxvYWRlZCgpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbG9hZGVkIHJlbGF0aW9uc2hpcCBvciBsb2FkcyBpdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIG9yTG9hZCgpIHtcbiAgICBpZiAodGhpcy5nZXRQcmVsb2FkZWQoKSkgcmV0dXJuIHRoaXMubG9hZGVkKClcblxuICAgIGNvbnN0IGJhdGNoZWQgPSBhd2FpdCB0aGlzLm1vZGVsLl90cnlDb2hvcnRQcmVsb2FkKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChiYXRjaGVkKSByZXR1cm4gdGhpcy5sb2FkZWQoKVxuXG4gICAgYXdhaXQgdGhpcy5tb2RlbC5sb2FkUmVsYXRpb25zaGlwKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIHJldHVybiB0aGlzLmxvYWRlZCgpXG4gIH1cbn1cblxuLyoqXG4gKiBMaWdodHdlaWdodCBoYXMtbWFueSByZWxhdGlvbnNoaXAgc3RhdGUgaG9sZGVyIGZvciBmcm9udGVuZCBtb2RlbCBpbnN0YW5jZXMuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnk+IHwgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlfSBTXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnk+IHwgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlfSBUXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW1RhcmdldENyZWF0ZUF0dHJpYnV0ZXM9UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPl1cbiAqL1xuZXhwb3J0IGNsYXNzIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwIHtcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj59ICovXG4gIF9sb2FkZWRWYWx1ZVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIFBhcmVudCBtb2RlbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3M8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+LCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzPiB8IG51bGx9IHRhcmdldE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcihtb2RlbCwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgIHRoaXMubW9kZWwgPSBtb2RlbFxuICAgIHRoaXMucmVsYXRpb25zaGlwTmFtZSA9IHJlbGF0aW9uc2hpcE5hbWVcbiAgICB0aGlzLnRhcmdldE1vZGVsQ2xhc3MgPSB0YXJnZXRNb2RlbENsYXNzXG4gICAgdGhpcy5fcHJlbG9hZGVkID0gZmFsc2VcbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IFtdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbG9hZGVkLlxuICAgKiBAcGFyYW0ge0FycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj59IGxvYWRlZFZhbHVlIC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRMb2FkZWQobG9hZGVkVmFsdWUpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkobG9hZGVkVmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX0gdG8gYmUgbG9hZGVkIHdpdGggYW4gYXJyYXlgKVxuICAgIH1cblxuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gbG9hZGVkVmFsdWVcbiAgICB0aGlzLl9wcmVsb2FkZWQgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcHJlbG9hZGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlbGF0aW9uc2hpcCBpcyBwcmVsb2FkZWQuXG4gICAqL1xuICBnZXRQcmVsb2FkZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3ByZWxvYWRlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZGVkLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlcy5cbiAgICovXG4gIGxvYWRlZCgpIHtcbiAgICBpZiAoIXRoaXMuX3ByZWxvYWRlZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IGhhc24ndCBiZWVuIHByZWxvYWRlZGApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2xvYWRlZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ29waWVzIGxvYWRlZCB2YWx1ZSBmcm9tIGFub3RoZXIgaGFzLW1hbnkgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSBzb3VyY2VSZWxhdGlvbnNoaXAgLSBTb3VyY2UgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjb3B5TG9hZGVkRnJvbShzb3VyY2VSZWxhdGlvbnNoaXApIHtcbiAgICBpZiAoIShzb3VyY2VSZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSBzb3VyY2UgcmVsYXRpb25zaGlwIHRvIGJlIGhhcy1tYW55YClcbiAgICB9XG5cbiAgICAvLyBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSB0YXJnZXQgcmVsYXRpb25zaGlwJ3MgZG9jdW1lbnRlZCBtb2RlbCB0eXBlLlxuICAgIGNvbnN0IGxvYWRlZFZhbHVlID0gLyoqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSAqLyAoc291cmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpKVxuXG4gICAgdGhpcy5zZXRMb2FkZWQobG9hZGVkVmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgdG8gbG9hZGVkLlxuICAgKiBAcGFyYW0ge0FycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj59IG1vZGVscyAtIE1vZGVscyB0byBhcHBlbmQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkVG9Mb2FkZWQobW9kZWxzKSB7XG4gICAgY29uc3QgbG9hZGVkTW9kZWxzID0gdGhpcy5nZXRQcmVsb2FkZWQoKSA/IHRoaXMubG9hZGVkKCkgOiBbXVxuXG4gICAgdGhpcy5zZXRMb2FkZWQoWy4uLmxvYWRlZE1vZGVscywgLi4ubW9kZWxzXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkLlxuICAgKiBAcGFyYW0ge1RhcmdldENyZWF0ZUF0dHJpYnV0ZXN9IFthdHRyaWJ1dGVzXSAtIE5ldyBtb2RlbCBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+fSAtIEJ1aWx0IG1vZGVsLlxuICAgKi9cbiAgYnVpbGQoYXR0cmlidXRlcyA9IC8qKiBAdHlwZSB7VGFyZ2V0Q3JlYXRlQXR0cmlidXRlc30gKi8gKHt9KSkge1xuICAgIGlmICghdGhpcy50YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyBjb25maWd1cmVkIGZvciAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtuZXcgKGF0dHJpYnV0ZXM/OiBUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzKSA9PiBGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD59ICovICh0aGlzLnRhcmdldE1vZGVsQ2xhc3MpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcyhhdHRyaWJ1dGVzKVxuXG4gICAgdGhpcy5hZGRUb0xvYWRlZChbbW9kZWxdKVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogRm9yY2UtcmVsb2FkIHRoZSByZWxhdGlvbnNoaXAuIFdoZW4gdGhlIHBhcmVudCByZWNvcmQgd2FzIGxvYWRlZCBhcyBwYXJ0XG4gICAqIG9mIGEgYmF0Y2gsIHNpYmxpbmdzIHRoYXQgaGF2ZSBub3QgcHJlbG9hZGVkIHRoaXMgcmVsYXRpb25zaGlwIGdldFxuICAgKiBiYXRjaGVkIGludG8gb25lIHJlcXVlc3QgdmlhIHRoZSBjb2hvcnQgcHJlbG9hZGVyLiBUaGUgc2NvcGVkIHF1ZXJ5IHBhdGhcbiAgICogKGBNb2RlbC53aGVyZSguLi4pLnByZWxvYWQoW25hbWVdKS50b0FycmF5KClgIGRpcmVjdGx5IGZyb20gdXNlciBjb2RlKVxuICAgKiBieXBhc3NlcyBjb2hvcnQgYmF0Y2hpbmcgYnkgZGVzaWduLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+Pn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIG1vZGVscy5cbiAgICovXG4gIGFzeW5jIGxvYWQoKSB7XG4gICAgLy8gUmVzZXQgc28gdGhlIGNvaG9ydCBwcmVsb2FkZXIgKG9yIHNpbmdsZS1yZWNvcmQgZmFsbGJhY2spIHJlcG9wdWxhdGVzLlxuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBbXVxuXG4gICAgY29uc3QgYmF0Y2hlZCA9IGF3YWl0IHRoaXMubW9kZWwuX3RyeUNvaG9ydFByZWxvYWQodGhpcy5yZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKGJhdGNoZWQpIHJldHVybiB0aGlzLl9sb2FkZWRWYWx1ZVxuXG4gICAgYXdhaXQgdGhpcy5tb2RlbC5sb2FkUmVsYXRpb25zaGlwKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIHJldHVybiB0aGlzLmxvYWRlZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBhcnJheS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBtb2RlbHMuXG4gICAqL1xuICBhc3luYyB0b0FycmF5KCkge1xuICAgIGlmICh0aGlzLmdldFByZWxvYWRlZCgpIHx8IHRoaXMuX2xvYWRlZFZhbHVlLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiB0aGlzLl9sb2FkZWRWYWx1ZVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmxvYWQoKVxuICB9XG59XG5cbi8qKlxuICogQ29waWVzIGxvYWRlZCByZWxhdGlvbnNoaXAgc3RhdGUgYmV0d2VlbiBoZWxwZXJzIG9mIHRoZSBzYW1lIHJlbGF0aW9uc2hpcCBzaGFwZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSBhcmdzLnNvdXJjZVJlbGF0aW9uc2hpcCAtIFNvdXJjZSByZWxhdGlvbnNoaXAgaGVscGVyLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSBhcmdzLnRhcmdldFJlbGF0aW9uc2hpcCAtIFRhcmdldCByZWxhdGlvbnNoaXAgaGVscGVyLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGNvcHlMb2FkZWRSZWxhdGlvbnNoaXBWYWx1ZSh7c291cmNlUmVsYXRpb25zaGlwLCB0YXJnZXRSZWxhdGlvbnNoaXB9KSB7XG4gIHRhcmdldFJlbGF0aW9uc2hpcC5jb3B5TG9hZGVkRnJvbShzb3VyY2VSZWxhdGlvbnNoaXApXG59XG5cbi8qKlxuICogUnVucyByZWxhdGlvbnNoaXAgdHlwZSBpcyBjb2xsZWN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcFR5cGUgLSBSZWxhdGlvbnNoaXAgdHlwZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcmVsYXRpb25zaGlwIHR5cGUgaXMgaGFzLW1hbnkuXG4gKi9cbmZ1bmN0aW9uIHJlbGF0aW9uc2hpcFR5cGVJc0NvbGxlY3Rpb24ocmVsYXRpb25zaGlwVHlwZSkge1xuICByZXR1cm4gcmVsYXRpb25zaGlwVHlwZSA9PSBcImhhc01hbnlcIlxufVxuXG4vKipcbiAqIERvd25sb2FkZWQgZnJvbnRlbmQtbW9kZWwgYXR0YWNobWVudCBwYXlsb2FkIHdyYXBwZXIuXG4gKi9cbmV4cG9ydCBjbGFzcyBGcm9udGVuZE1vZGVsQXR0YWNobWVudERvd25sb2FkIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaWQgLSBBdHRhY2htZW50IGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5maWxlbmFtZSAtIEZpbGVuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGFyZ3MuY29udGVudFR5cGUgLSBDb250ZW50IHR5cGUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmJ5dGVTaXplIC0gRmlsZSBzaXplIGluIGJ5dGVzLlxuICAgKiBAcGFyYW0ge1VpbnQ4QXJyYXl9IGFyZ3MuY29udGVudCAtIEZpbGUgY29udGVudCBieXRlcy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBbYXJncy51cmxdIC0gUmVzb2x2YWJsZSBhdHRhY2htZW50IFVSTC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtieXRlU2l6ZSwgY29udGVudCwgY29udGVudFR5cGUsIGZpbGVuYW1lLCBpZCwgdXJsID0gbnVsbH0pIHtcbiAgICB0aGlzLmlkVmFsdWUgPSBpZFxuICAgIHRoaXMuZmlsZW5hbWVWYWx1ZSA9IGZpbGVuYW1lXG4gICAgdGhpcy5jb250ZW50VHlwZVZhbHVlID0gY29udGVudFR5cGVcbiAgICB0aGlzLmJ5dGVTaXplVmFsdWUgPSBieXRlU2l6ZVxuICAgIHRoaXMuY29udGVudFZhbHVlID0gY29udGVudFxuICAgIHRoaXMudXJsVmFsdWUgPSB1cmxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ5dGUgc2l6ZS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBGaWxlIHNpemUgaW4gYnl0ZXMuXG4gICAqL1xuICBieXRlU2l6ZSgpIHsgcmV0dXJuIHRoaXMuYnl0ZVNpemVWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIGNvbnRlbnQuXG4gICAqIEByZXR1cm5zIHtVaW50OEFycmF5fSAtIEZpbGUgY29udGVudCBieXRlcy5cbiAgICovXG4gIGNvbnRlbnQoKSB7IHJldHVybiB0aGlzLmNvbnRlbnRWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIGNvbnRlbnQgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gQ29udGVudCB0eXBlLlxuICAgKi9cbiAgY29udGVudFR5cGUoKSB7IHJldHVybiB0aGlzLmNvbnRlbnRUeXBlVmFsdWUgfVxuICAvKipcbiAgICogUnVucyBmaWxlbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGaWxlbmFtZS5cbiAgICovXG4gIGZpbGVuYW1lKCkgeyByZXR1cm4gdGhpcy5maWxlbmFtZVZhbHVlIH1cbiAgLyoqXG4gICAqIFJ1bnMgaWQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0YWNobWVudCBpZC5cbiAgICovXG4gIGlkKCkgeyByZXR1cm4gdGhpcy5pZFZhbHVlIH1cbiAgLyoqXG4gICAqIFJ1bnMgdXJsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBSZXNvbHZhYmxlIGF0dGFjaG1lbnQgVVJMLlxuICAgKi9cbiAgdXJsKCkgeyByZXR1cm4gdGhpcy51cmxWYWx1ZSB9XG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBhdHRhY2htZW50IGNvbW1hbmQgcGF5bG9hZC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGV9IGF0dGFjaG1lbnQgLSBBdHRhY2htZW50IHdyYXBwZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gW2F0dGFjaG1lbnRJZF0gLSBPcHRpb25hbCBoYXMtbWFueSBhdHRhY2htZW50IGlkLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDb21tYW5kIHBheWxvYWQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29tbWFuZFBheWxvYWQoYXR0YWNobWVudCwgYXR0YWNobWVudElkKSB7XG4gIC8qKlxuICAgKiBQYXlsb2FkLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCBwYXlsb2FkID0ge1xuICAgIGF0dGFjaG1lbnROYW1lOiBhdHRhY2htZW50LmF0dGFjaG1lbnROYW1lLFxuICAgIGlkOiBhdHRhY2htZW50Lm1vZGVsLnByaW1hcnlLZXlWYWx1ZSgpXG4gIH1cblxuICBpZiAoYXR0YWNobWVudElkKSBwYXlsb2FkLmF0dGFjaG1lbnRJZCA9IGF0dGFjaG1lbnRJZFxuXG4gIHJldHVybiBwYXlsb2FkXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IHZhbHVlIGlzIGJ5dGVzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHZhbHVlIGxvb2tzIGxpa2UgYnl0ZSBkYXRhLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzQnl0ZXModmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlIGluc3RhbmNlb2YgVWludDhBcnJheSB8fCB2YWx1ZSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyIHx8ICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiICYmIEJ1ZmZlci5pc0J1ZmZlcih2YWx1ZSkpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IHZhbHVlIHN1cHBvcnRzIGFycmF5IGJ1ZmZlci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge3ZhbHVlIGlzIHthcnJheUJ1ZmZlcjogKCkgPT4gUHJvbWlzZTxBcnJheUJ1ZmZlcj59fSAtIFdoZXRoZXIgY2FuZGlkYXRlIHN1cHBvcnRzIGFycmF5QnVmZmVyKCkuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudFZhbHVlU3VwcG9ydHNBcnJheUJ1ZmZlcih2YWx1ZSkge1xuICByZXR1cm4gQm9vbGVhbih2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh2YWx1ZSkuYXJyYXlCdWZmZXIgPT09IFwiZnVuY3Rpb25cIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgbm9ybWFsaXplIGJ5dGVzLlxuICogQHBhcmFtIHtVaW50OEFycmF5IHwgQnVmZmVyIHwgQXJyYXlCdWZmZXJ9IHZhbHVlIC0gQnl0ZS1saWtlIHZhbHVlLlxuICogQHJldHVybnMge1VpbnQ4QXJyYXl9IC0gVWludDhBcnJheSBieXRlcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50Tm9ybWFsaXplQnl0ZXModmFsdWUpIHtcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgVWludDhBcnJheSkgcmV0dXJuIHZhbHVlXG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSByZXR1cm4gbmV3IFVpbnQ4QXJyYXkodmFsdWUpXG4gIGlmICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiICYmIEJ1ZmZlci5pc0J1ZmZlcigvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodmFsdWUpKSkge1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheSgvKiogQHR5cGUge0J1ZmZlcn0gKi8gKHZhbHVlKSlcbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIGF0dGFjaG1lbnQgYnl0ZXMgdmFsdWVcIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgYnl0ZXMgdG8gYmFzZTY0LlxuICogQHBhcmFtIHtVaW50OEFycmF5fSBieXRlcyAtIEJ5dGVzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBCYXNlNjQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudEJ5dGVzVG9CYXNlNjQoYnl0ZXMpIHtcbiAgaWYgKHR5cGVvZiBCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICByZXR1cm4gQnVmZmVyLmZyb20oYnl0ZXMpLnRvU3RyaW5nKFwiYmFzZTY0XCIpXG4gIH1cblxuICBsZXQgYmluYXJ5ID0gXCJcIlxuXG4gIGZvciAoY29uc3QgYnl0ZSBvZiBieXRlcykge1xuICAgIGJpbmFyeSArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGUpXG4gIH1cblxuICBpZiAodHlwZW9mIGJ0b2EgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiTWlzc2luZyBiYXNlNjQgZW5jb2RlclwiKVxuXG4gIHJldHVybiBidG9hKGJpbmFyeSlcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgYmFzZTY0IHRvIGJ5dGVzLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gQmFzZTY0IHZhbHVlLlxuICogQHJldHVybnMge1VpbnQ4QXJyYXl9IC0gRGVjb2RlZCBieXRlcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50QmFzZTY0VG9CeXRlcyh2YWx1ZSkge1xuICBpZiAodHlwZW9mIEJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheShCdWZmZXIuZnJvbSh2YWx1ZSwgXCJiYXNlNjRcIikpXG4gIH1cblxuICBpZiAodHlwZW9mIGF0b2IgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiTWlzc2luZyBiYXNlNjQgZGVjb2RlclwiKVxuXG4gIGNvbnN0IGJpbmFyeSA9IGF0b2IodmFsdWUpXG4gIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYmluYXJ5Lmxlbmd0aClcblxuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgYmluYXJ5Lmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGJ5dGVzW2luZGV4XSA9IGJpbmFyeS5jaGFyQ29kZUF0KGluZGV4KVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVzXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IHZhbHVlIGlzIHBsYWluIG9iamVjdC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge3ZhbHVlIGlzIFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBXaGV0aGVyIHZhbHVlIGlzIHBsYWluIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICBjb25zdCBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpXG5cbiAgcmV0dXJuIHByb3RvdHlwZSA9PT0gT2JqZWN0LnByb3RvdHlwZSB8fCBwcm90b3R5cGUgPT09IG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHBheWxvYWQgY29udGFpbnMgYXR0YWNobWVudCB1cGxvYWQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFBheWxvYWQgY2FuZGlkYXRlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBwYXlsb2FkIGNvbnRhaW5zIGFuIGF0dGFjaG1lbnQgdXBsb2FkIGJvZHkuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxQYXlsb2FkQ29udGFpbnNBdHRhY2htZW50VXBsb2FkKHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcblxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gdmFsdWUuc29tZSgoZW50cnkpID0+IGZyb250ZW5kTW9kZWxQYXlsb2FkQ29udGFpbnNBdHRhY2htZW50VXBsb2FkKGVudHJ5KSlcbiAgfVxuXG4gIGlmICghZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KHZhbHVlKSkgcmV0dXJuIGZhbHNlXG5cbiAgaWYgKHR5cGVvZiB2YWx1ZS5jb250ZW50QmFzZTY0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIHJldHVybiBPYmplY3QudmFsdWVzKHZhbHVlKS5zb21lKChlbnRyeSkgPT4gZnJvbnRlbmRNb2RlbFBheWxvYWRDb250YWluc0F0dGFjaG1lbnRVcGxvYWQoZW50cnkpKVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGNvbmNyZXRlIGZyb250ZW5kLW1vZGVsIGNsYXNzIGZvciBhbiBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gRnJvbnRlbmQgbW9kZWwgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbENsYXNzfSBDb25jcmV0ZSBmcm9udGVuZC1tb2RlbCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbENsYXNzRm9yKG1vZGVsKSB7XG4gIGNvbnN0IGNvbnN0cnVjdG9yVmFsdWUgPSBtb2RlbC5jb25zdHJ1Y3RvclxuXG4gIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxDbGFzc30gKi8gKGNvbnN0cnVjdG9yVmFsdWUpXG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgY29uZmlndXJlZCBvZmZsaW5lIHF1ZXVlIHNob3VsZCBoYW5kbGUgYSBtb2RlbCBvcGVyYXRpb24uXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBvcGVyYXRpb24gLSBTeW5jIG9wZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdG8gcXVldWUgbG9jYWxseS5cbiAqL1xuZnVuY3Rpb24gc2hvdWxkUXVldWVGcm9udGVuZE1vZGVsT3BlcmF0aW9uT2ZmbGluZShNb2RlbENsYXNzLCBvcGVyYXRpb24pIHtcbiAgY29uc3Qgb2ZmbGluZVN5bmMgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jXG5cbiAgaWYgKCFvZmZsaW5lU3luYz8uZW5hYmxlZCkgcmV0dXJuIGZhbHNlXG5cbiAgY29uc3Qgc3luY0NvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKS5zeW5jXG5cbiAgaWYgKCFzeW5jQ29uZmlnPy5lbmFibGVkKSByZXR1cm4gZmFsc2VcbiAgaWYgKCFzeW5jQ29uZmlnLm9wZXJhdGlvbnMuaW5jbHVkZXMob3BlcmF0aW9uKSkgdGhyb3cgbmV3IEVycm9yKGBPZmZsaW5lIHN5bmMgZm9yICR7TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gZG9lcyBub3QgYWxsb3cgJHtvcGVyYXRpb259YClcblxuICByZXR1cm4gdHJ1ZVxufVxuXG4vKipcbiAqIFF1ZXVlcyBhbiBvZmZsaW5lIHN5bmMgbXV0YXRpb24uXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gYXJncy5hdHRyaWJ1dGVzIC0gTXV0YXRpb24gYXR0cmlidXRlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5jbGllbnRNdXRhdGlvbklkXSAtIFByZS1nZW5lcmF0ZWQgbXV0YXRpb24gaWQuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gYXJncy5Nb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFyZ3Mub3BlcmF0aW9uIC0gU3luYyBvcGVyYXRpb24uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIENsaWVudCBtdXRhdGlvbiBpZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcXVldWVGcm9udGVuZE1vZGVsTXV0YXRpb25PZmZsaW5lKHthdHRyaWJ1dGVzLCBjbGllbnRNdXRhdGlvbklkOiBwcm92aWRlZENsaWVudE11dGF0aW9uSWQsIE1vZGVsQ2xhc3MsIG9wZXJhdGlvbn0pIHtcbiAgY29uc3Qgb2ZmbGluZVN5bmMgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jXG5cbiAgaWYgKCFvZmZsaW5lU3luYykgdGhyb3cgbmV3IEVycm9yKFwiT2ZmbGluZSBzeW5jIGlzIG5vdCBjb25maWd1cmVkXCIpXG5cbiAgY29uc3Qgc3luY0NvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKS5zeW5jXG4gIGlmICghc3luY0NvbmZpZz8uZW5hYmxlZCkgdGhyb3cgbmV3IEVycm9yKGBPZmZsaW5lIHN5bmMgaXMgbm90IGVuYWJsZWQgZm9yICR7TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gKVxuXG4gIGNvbnN0IG5vdyA9IG9mZmxpbmVTeW5jLm5vdyA/IG9mZmxpbmVTeW5jLm5vdygpIDogbmV3IERhdGUoKVxuICBpZiAoIShub3cgaW5zdGFuY2VvZiBEYXRlKSB8fCBOdW1iZXIuaXNOYU4obm93LmdldFRpbWUoKSkpIHRocm93IG5ldyBFcnJvcihcIm9mZmxpbmVTeW5jLm5vdyBtdXN0IHJldHVybiBhIHZhbGlkIERhdGVcIilcblxuICBjb25zdCBjbGllbnRNdXRhdGlvbklkID0gcHJvdmlkZWRDbGllbnRNdXRhdGlvbklkIHx8IChvZmZsaW5lU3luYy5jbGllbnRNdXRhdGlvbklkID8gb2ZmbGluZVN5bmMuY2xpZW50TXV0YXRpb25JZCgpIDogZnJvbnRlbmRNb2RlbE9mZmxpbmVNdXRhdGlvbklkKCkpXG4gIGlmICh0eXBlb2YgY2xpZW50TXV0YXRpb25JZCAhPT0gXCJzdHJpbmdcIiB8fCBjbGllbnRNdXRhdGlvbklkLmxlbmd0aCA8IDEpIHRocm93IG5ldyBFcnJvcihcIm9mZmxpbmVTeW5jLmNsaWVudE11dGF0aW9uSWQgbXVzdCByZXR1cm4gYSBub24tZW1wdHkgc3RyaW5nXCIpXG5cbiAgYXdhaXQgb2ZmbGluZVN5bmMubXV0YXRpb25Mb2cuYXBwZW5kKHtcbiAgICBtdXRhdGlvbjoge1xuICAgICAgYWN0b3JEZXZpY2VJZDogb2ZmbGluZVN5bmMuYWN0b3JEZXZpY2VJZCxcbiAgICAgIGFjdG9yVXNlcklkOiBvZmZsaW5lU3luYy5hY3RvclVzZXJJZCxcbiAgICAgIGF0dHJpYnV0ZXM6IGZyb250ZW5kTW9kZWxTeW5jSnNvbk9iamVjdChhdHRyaWJ1dGVzKSxcbiAgICAgIGJhc2VWZXJzaW9uOiBudWxsLFxuICAgICAgY2xpZW50TXV0YXRpb25JZCxcbiAgICAgIG1vZGVsOiBNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgb2NjdXJyZWRBdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICBvZmZsaW5lR3JhbnRJZDogb2ZmbGluZVN5bmMub2ZmbGluZUdyYW50LmlkLFxuICAgICAgb3BlcmF0aW9uLFxuICAgICAgcG9saWN5SGFzaDogc3luY0NvbmZpZy5wb2xpY3lIYXNoXG4gICAgfVxuICB9KVxuXG4gIHJldHVybiBjbGllbnRNdXRhdGlvbklkXG59XG5cbi8qKlxuICogR2VuZXJhdGVzIGEgZnJvbnRlbmQtbW9kZWwgb2ZmbGluZSBtdXRhdGlvbiBpZC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTG9jYWwgbXV0YXRpb24gaWQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxPZmZsaW5lTXV0YXRpb25JZCgpIHtcbiAgaWYgKGdsb2JhbFRoaXMuY3J5cHRvICYmIHR5cGVvZiBnbG9iYWxUaGlzLmNyeXB0by5yYW5kb21VVUlEID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiBnbG9iYWxUaGlzLmNyeXB0by5yYW5kb21VVUlEKClcblxuICByZXR1cm4gYGZyb250ZW5kLW11dGF0aW9uLSR7RGF0ZS5ub3coKX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX1gXG59XG5cbi8qKlxuICogQ29udmVydHMgbW9kZWwgYXR0cmlidXRlcyB0byBzeW5jLXNhZmUgSlNPTiBwYXlsb2FkIHZhbHVlcy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gYXR0cmlidXRlcyAtIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZXMuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59IC0gU3luYy1zYWZlIGF0dHJpYnV0ZXMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxTeW5jSnNvbk9iamVjdChhdHRyaWJ1dGVzKSB7XG4gIGNvbnN0IHNlcmlhbGl6ZWQgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGF0dHJpYnV0ZXMpKVxuXG4gIGlmICghc2VyaWFsaXplZCB8fCB0eXBlb2Ygc2VyaWFsaXplZCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHNlcmlhbGl6ZWQpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBzeW5jIG11dGF0aW9uIGF0dHJpYnV0ZXMgb2JqZWN0XCIpXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59ICovIChzZXJpYWxpemVkKVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIGF0dGFjaG1lbnQgaW5wdXQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBpbnB1dCAtIEF0dGFjaG1lbnQgaW5wdXQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFRyYW5zcG9ydC1zYWZlIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQoaW5wdXQpIHtcbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChpbnB1dCkgJiYgXCJmaWxlXCIgaW4gaW5wdXQpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRmlsZSA9IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0LmZpbGUpXG4gICAgY29uc3QgbWVyZ2VkID0ge1xuICAgICAgLi4ubm9ybWFsaXplZEZpbGVcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGlucHV0LmZpbGVuYW1lID09PSBcInN0cmluZ1wiICYmIGlucHV0LmZpbGVuYW1lLmxlbmd0aCA+IDApIG1lcmdlZC5maWxlbmFtZSA9IGlucHV0LmZpbGVuYW1lXG4gICAgaWYgKHR5cGVvZiBpbnB1dC5jb250ZW50VHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5jb250ZW50VHlwZS5sZW5ndGggPiAwKSBtZXJnZWQuY29udGVudFR5cGUgPSBpbnB1dC5jb250ZW50VHlwZVxuXG4gICAgcmV0dXJuIG1lcmdlZFxuICB9XG5cbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChpbnB1dCkpIHtcbiAgICBpZiAodHlwZW9mIGlucHV0LnBhdGggPT09IFwic3RyaW5nXCIgJiYgaW5wdXQucGF0aC5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdHRhY2htZW50IHBhdGggaW5wdXQgaXMgbm90IHN1cHBvcnRlZCBpbiBmcm9udGVuZCBtb2RlbHNcIilcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGlucHV0LmNvbnRlbnRCYXNlNjQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvbnRlbnRCYXNlNjQ6IGlucHV0LmNvbnRlbnRCYXNlNjQsXG4gICAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgaW5wdXQuY29udGVudFR5cGUgPT09IFwic3RyaW5nXCIgJiYgaW5wdXQuY29udGVudFR5cGUubGVuZ3RoID4gMCA/IGlucHV0LmNvbnRlbnRUeXBlIDogbnVsbCxcbiAgICAgICAgZmlsZW5hbWU6IHR5cGVvZiBpbnB1dC5maWxlbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5maWxlbmFtZS5sZW5ndGggPiAwID8gaW5wdXQuZmlsZW5hbWUgOiB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpZiAoZnJvbnRlbmRBdHRhY2htZW50VmFsdWVTdXBwb3J0c0FycmF5QnVmZmVyKGlucHV0KSkge1xuICAgIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYXdhaXQgaW5wdXQuYXJyYXlCdWZmZXIoKSlcblxuICAgIHJldHVybiB7XG4gICAgICBjb250ZW50QmFzZTY0OiBmcm9udGVuZEF0dGFjaG1lbnRCeXRlc1RvQmFzZTY0KGJ5dGVzKSxcbiAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS50eXBlID09PSBcInN0cmluZ1wiICYmIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkudHlwZS5sZW5ndGggPiAwXG4gICAgICAgID8gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS50eXBlXG4gICAgICAgIDogbnVsbCxcbiAgICAgIGZpbGVuYW1lOiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS5uYW1lID09PSBcInN0cmluZ1wiICYmIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkubmFtZS5sZW5ndGggPiAwXG4gICAgICAgID8gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS5uYW1lXG4gICAgICAgIDogXCJhdHRhY2htZW50LmJpblwiXG4gICAgfVxuICB9XG5cbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNCeXRlcyhpbnB1dCkpIHtcbiAgICBjb25zdCBieXRlcyA9IGZyb250ZW5kQXR0YWNobWVudE5vcm1hbGl6ZUJ5dGVzKC8qKiBAdHlwZSB7VWludDhBcnJheSB8IEJ1ZmZlciB8IEFycmF5QnVmZmVyfSAqLyAoaW5wdXQpKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnRlbnRCYXNlNjQ6IGZyb250ZW5kQXR0YWNobWVudEJ5dGVzVG9CYXNlNjQoYnl0ZXMpLFxuICAgICAgY29udGVudFR5cGU6IG51bGwsXG4gICAgICBmaWxlbmFtZTogXCJhdHRhY2htZW50LmJpblwiXG4gICAgfVxuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiVW5zdXBwb3J0ZWQgZnJvbnRlbmQgYXR0YWNobWVudCBpbnB1dFwiKVxufVxuXG4vKipcbiAqIEZyb250ZW5kLW1vZGVsIGF0dGFjaG1lbnQgaGVscGVyIGZvciBvbmUgYXR0YWNobWVudCBuYW1lLlxuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGUge1xuICAvKipcbiAgICogUGVuZGluZyBhdHRhY2htZW50IGlucHV0cyBxdWV1ZWQgZm9yIHRoZSBuZXh0IG1vZGVsIHNhdmUuXG4gICAqIEB0eXBlIHtGcm9udGVuZE1vZGVsQXR0YWNobWVudElucHV0W119XG4gICAqL1xuICBwZW5kaW5nSW5wdXRzID0gW11cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2F0dGFjaG1lbnROYW1lLCBtb2RlbH0pIHtcbiAgICB0aGlzLm1vZGVsID0gbW9kZWxcbiAgICB0aGlzLmF0dGFjaG1lbnROYW1lID0gYXR0YWNobWVudE5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZSBhdHRhY2htZW50IGlucHV0IGZvciB0aGUgcGFyZW50IG1vZGVsJ3MgbmV4dCBzYXZlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxBdHRhY2htZW50SW5wdXQgfCBGcm9udGVuZE1vZGVsQXR0YWNobWVudElucHV0W119IGlucHV0IC0gQXR0YWNobWVudCBpbnB1dC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBxdWV1ZUF0dGFjaChpbnB1dCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24odGhpcy5hdHRhY2htZW50TmFtZSlcblxuICAgIGlmIChhdHRhY2htZW50RGVmaW5pdGlvbj8udHlwZSA9PT0gXCJoYXNPbmVcIikge1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoaW5wdXQpKSB7XG4gICAgICAgIGNvbnN0IGxhc3RJbnB1dCA9IGlucHV0W2lucHV0Lmxlbmd0aCAtIDFdXG5cbiAgICAgICAgdGhpcy5wZW5kaW5nSW5wdXRzID0gdHlwZW9mIGxhc3RJbnB1dCA9PT0gXCJ1bmRlZmluZWRcIiA/IFtdIDogW2xhc3RJbnB1dF1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucGVuZGluZ0lucHV0cyA9IFtpbnB1dF1cbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGlucHV0KSkge1xuICAgICAgdGhpcy5wZW5kaW5nSW5wdXRzLnB1c2goLi4uaW5wdXQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucGVuZGluZ0lucHV0cy5wdXNoKGlucHV0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoaXMgYXR0YWNobWVudCBoYXMgcXVldWVkIGlucHV0cyBmb3IgdGhlIG5leHQgbW9kZWwgc2F2ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgYW55IHBlbmRpbmcgaW5wdXRzIGV4aXN0LlxuICAgKi9cbiAgaGFzUGVuZGluZ0F0dGFjaG1lbnRzKCkge1xuICAgIHJldHVybiB0aGlzLnBlbmRpbmdJbnB1dHMubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgc2F2ZSBwYXlsb2FkIGZvciBxdWV1ZWQgYXR0YWNobWVudCBpbnB1dHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdIHwgdW5kZWZpbmVkPn0gTm9ybWFsaXplZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBwZW5kaW5nQXR0YWNobWVudHNQYXlsb2FkKCkge1xuICAgIGlmICh0aGlzLnBlbmRpbmdJbnB1dHMubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKHRoaXMuYXR0YWNobWVudE5hbWUpXG5cbiAgICBpZiAoYXR0YWNobWVudERlZmluaXRpb24/LnR5cGUgPT09IFwiaGFzTWFueVwiKSB7XG4gICAgICByZXR1cm4gYXdhaXQgUHJvbWlzZS5hbGwodGhpcy5wZW5kaW5nSW5wdXRzLm1hcChhc3luYyAoaW5wdXQpID0+IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0KSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KHRoaXMucGVuZGluZ0lucHV0c1t0aGlzLnBlbmRpbmdJbnB1dHMubGVuZ3RoIC0gMV0pXG4gIH1cblxuICAvKiogQ2xlYXJzIHF1ZXVlZCBhdHRhY2htZW50IGlucHV0cyBhZnRlciBhIHN1Y2Nlc3NmdWwgbW9kZWwgc2F2ZS4gKi9cbiAgY2xlYXJQZW5kaW5nQXR0YWNobWVudHMoKSB7XG4gICAgdGhpcy5wZW5kaW5nSW5wdXRzID0gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gaW5wdXQgLSBBdHRhY2htZW50IGlucHV0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGF0dGFjaGVkLlxuICAgKi9cbiAgYXN5bmMgYXR0YWNoKGlucHV0KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWRJbnB1dCA9IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0KVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcImF0dGFjaFwiLCB7XG4gICAgICBhdHRhY2htZW50OiBub3JtYWxpemVkSW5wdXQsXG4gICAgICBhdHRhY2htZW50TmFtZTogdGhpcy5hdHRhY2htZW50TmFtZSxcbiAgICAgIGlkOiB0aGlzLm1vZGVsLnByaW1hcnlLZXlWYWx1ZSgpXG4gICAgfSlcblxuICAgIHRoaXMubW9kZWwuYXNzaWduQXR0cmlidXRlcyhNb2RlbENsYXNzLmF0dHJpYnV0ZXNGcm9tUmVzcG9uc2UocmVzcG9uc2UpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZG93bmxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXR0YWNobWVudElkXSAtIE9wdGlvbmFsIGF0dGFjaG1lbnQgaWQgZm9yIGhhcy1tYW55IGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZE1vZGVsQXR0YWNobWVudERvd25sb2FkIHwgbnVsbD59IC0gRG93bmxvYWRlZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBkb3dubG9hZChhdHRhY2htZW50SWQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiZG93bmxvYWRcIiwgZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb21tYW5kUGF5bG9hZCh0aGlzLCBhdHRhY2htZW50SWQpKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRQYXlsb2FkID0gcmVzcG9uc2UuYXR0YWNobWVudFxuXG4gICAgaWYgKCFhdHRhY2htZW50UGF5bG9hZCB8fCB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQgIT09IFwib2JqZWN0XCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBjb250ZW50QmFzZTY0ID0gdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRCYXNlNjQgPT09IFwic3RyaW5nXCIgPyBhdHRhY2htZW50UGF5bG9hZC5jb250ZW50QmFzZTY0IDogXCJcIlxuICAgIGNvbnN0IGNvbnRlbnQgPSBmcm9udGVuZEF0dGFjaG1lbnRCYXNlNjRUb0J5dGVzKGNvbnRlbnRCYXNlNjQpXG4gICAgY29uc3QgYnl0ZVNpemUgPSBOdW1iZXIoYXR0YWNobWVudFBheWxvYWQuYnl0ZVNpemUpXG5cbiAgICByZXR1cm4gbmV3IEZyb250ZW5kTW9kZWxBdHRhY2htZW50RG93bmxvYWQoe1xuICAgICAgYnl0ZVNpemU6IE51bWJlci5pc0Zpbml0ZShieXRlU2l6ZSkgPyBieXRlU2l6ZSA6IGNvbnRlbnQubGVuZ3RoLFxuICAgICAgY29udGVudCxcbiAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQuY29udGVudFR5cGUgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudFBheWxvYWQuY29udGVudFR5cGUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRUeXBlIDogbnVsbCxcbiAgICAgIGZpbGVuYW1lOiB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQuZmlsZW5hbWUgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudFBheWxvYWQuZmlsZW5hbWUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnRQYXlsb2FkLmZpbGVuYW1lIDogXCJhdHRhY2htZW50LmJpblwiLFxuICAgICAgaWQ6IHR5cGVvZiBhdHRhY2htZW50UGF5bG9hZC5pZCA9PT0gXCJzdHJpbmdcIiA/IGF0dGFjaG1lbnRQYXlsb2FkLmlkIDogXCJcIixcbiAgICAgIHVybDogdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLnVybCA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50UGF5bG9hZC51cmwubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnRQYXlsb2FkLnVybCA6IG51bGxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXJsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2F0dGFjaG1lbnRJZF0gLSBPcHRpb25hbCBhdHRhY2htZW50IGlkIGZvciBoYXMtbWFueSBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gUmVzb2x2YWJsZSBhdHRhY2htZW50IFVSTC5cbiAgICovXG4gIGFzeW5jIHVybChhdHRhY2htZW50SWQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwidXJsXCIsIGZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29tbWFuZFBheWxvYWQodGhpcywgYXR0YWNobWVudElkKSlcblxuICAgIGlmICh0eXBlb2YgcmVzcG9uc2UudXJsID09PSBcInN0cmluZ1wiICYmIHJlc3BvbnNlLnVybC5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gcmVzcG9uc2UudXJsXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBxdWVyeSBmb3IgdGhpcyBhdHRhY2htZW50IGhhbmRsZSdzIG1ldGFkYXRhIHJvd3MuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIFZlbG9jaW91c0F0dGFjaG1lbnQ+fSAtIEF0dGFjaG1lbnQgbWV0YWRhdGEgcXVlcnkuXG4gICAqL1xuICBxdWVyeSgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG5cbiAgICByZXR1cm4gVmVsb2Npb3VzQXR0YWNobWVudFxuICAgICAgLndoZXJlKHtcbiAgICAgICAgbmFtZTogdGhpcy5hdHRhY2htZW50TmFtZSxcbiAgICAgICAgcmVjb3JkSWQ6IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCB0aGlzLm1vZGVsLnByaW1hcnlLZXlWYWx1ZSgpKSxcbiAgICAgICAgcmVjb3JkVHlwZTogTW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuICAgICAgfSlcbiAgICAgIC5vcmRlcihbW1wicG9zaXRpb25cIiwgXCJhc2NcIl1dKVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGFsbCBhdHRhY2htZW50IG1ldGFkYXRhIHJvd3MgZm9yIHRoaXMgaGFuZGxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxWZWxvY2lvdXNBdHRhY2htZW50W10+fSAtIEF0dGFjaG1lbnQgbWV0YWRhdGEgcm93cy5cbiAgICovXG4gIGFzeW5jIHRvQXJyYXkoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS50b0FycmF5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgZmlyc3QgYXR0YWNobWVudCBtZXRhZGF0YSByb3cgZm9yIHRoaXMgaGFuZGxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxWZWxvY2lvdXNBdHRhY2htZW50IHwgbnVsbD59IC0gRmlyc3QgYXR0YWNobWVudCBtZXRhZGF0YSByb3cuXG4gICAqL1xuICBhc3luYyBmaXJzdCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpcnN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxpc3QuIFJldHVybnMgbWV0YWRhdGEgZm9yIGV2ZXJ5IGF0dGFjaG1lbnQgdW5kZXIgdGhpcyBhdHRhY2htZW50IG5hbWVcbiAgICogKG5vIGNvbnRlbnQgYnl0ZXMpLCBzbyBjYWxsZXJzIGNhbiBlbnVtZXJhdGUgaGFzLW1hbnkgYXR0YWNobWVudHMgYW5kIHRoZW5cbiAgICogZG93bmxvYWQgb3IgbGluayB0byBlYWNoIG9uZSBieSBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8e2J5dGVTaXplOiBudW1iZXIsIGNvbnRlbnRUeXBlOiBzdHJpbmcgfCBudWxsLCBmaWxlbmFtZTogc3RyaW5nLCBpZDogc3RyaW5nLCB1cmw6IHN0cmluZyB8IG51bGx9Pj59IC0gQXR0YWNobWVudCBtZXRhZGF0YSBlbnRyaWVzLlxuICAgKi9cbiAgYXN5bmMgbGlzdCgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiYXR0YWNobWVudExpc3RcIiwgZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb21tYW5kUGF5bG9hZCh0aGlzKSlcbiAgICBjb25zdCBhdHRhY2htZW50cyA9IEFycmF5LmlzQXJyYXkocmVzcG9uc2UuYXR0YWNobWVudHMpID8gcmVzcG9uc2UuYXR0YWNobWVudHMgOiBbXVxuXG4gICAgcmV0dXJuIGF0dGFjaG1lbnRzLm1hcCgoYXR0YWNobWVudCkgPT4ge1xuICAgICAgY29uc3QgYnl0ZVNpemUgPSBOdW1iZXIoYXR0YWNobWVudC5ieXRlU2l6ZSlcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYnl0ZVNpemU6IE51bWJlci5pc0Zpbml0ZShieXRlU2l6ZSkgPyBieXRlU2l6ZSA6IDAsXG4gICAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgYXR0YWNobWVudC5jb250ZW50VHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50LmNvbnRlbnRUeXBlLmxlbmd0aCA+IDAgPyBhdHRhY2htZW50LmNvbnRlbnRUeXBlIDogbnVsbCxcbiAgICAgICAgZmlsZW5hbWU6IHR5cGVvZiBhdHRhY2htZW50LmZpbGVuYW1lID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnQuZmlsZW5hbWUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnQuZmlsZW5hbWUgOiBcImF0dGFjaG1lbnQuYmluXCIsXG4gICAgICAgIGlkOiB0eXBlb2YgYXR0YWNobWVudC5pZCA9PT0gXCJzdHJpbmdcIiA/IGF0dGFjaG1lbnQuaWQgOiBcIlwiLFxuICAgICAgICB1cmw6IHR5cGVvZiBhdHRhY2htZW50LnVybCA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50LnVybC5sZW5ndGggPiAwID8gYXR0YWNobWVudC51cmwgOiBudWxsXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRvd25sb2FkIHVybC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEb3dubG9hZCBVUkwgZm9yIHRoaXMgYXR0YWNobWVudCBvbiB0aGUgY29uZmlndXJlZCBiYWNrZW5kLlxuICAgKi9cbiAgZG93bmxvYWRVcmwoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IGNvbW1hbmROYW1lID0gTW9kZWxDbGFzcy5jb21tYW5kTmFtZShcImRvd25sb2FkXCIpXG4gICAgY29uc3QgcmVzb3VyY2VQYXRoID0gTW9kZWxDbGFzcy5yZXNvdXJjZVBhdGgoKVxuICAgIGNvbnN0IGNvbW1hbmRVcmwgPSBmcm9udGVuZE1vZGVsQ29tbWFuZFVybChyZXNvdXJjZVBhdGgsIGNvbW1hbmROYW1lKVxuICAgIGNvbnN0IHBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xuICAgICAgYXR0YWNobWVudE5hbWU6IHRoaXMuYXR0YWNobWVudE5hbWUsXG4gICAgICBpZDogbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIHRoaXMubW9kZWwucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgfSlcblxuICAgIHJldHVybiBgJHtjb21tYW5kVXJsfT8ke3BhcmFtcy50b1N0cmluZygpfWBcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB1cmwuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZCB8IG51bGx9IHZhbHVlIC0gVVJMIGNhbmRpZGF0ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9ybWFsaXplZCBVUkwgd2l0aG91dCB0cmFpbGluZyBzbGFzaC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybCh2YWx1ZSkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiKSByZXR1cm4gXCJcIlxuXG4gIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKClcblxuICBpZiAoIXRyaW1tZWQubGVuZ3RoKSByZXR1cm4gXCJcIlxuXG4gIHJldHVybiB0cmltbWVkLnJlcGxhY2UoL1xcLyskLywgXCJcIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB1cmwuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlc29sdmVkIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCBVUkwuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRVcmwoKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRVcmwgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy51cmwgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy51cmwoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy51cmxcblxuICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybChjb25maWd1cmVkVXJsKVxufVxuXG4vKipcbiAqIFJ1bnMgY2xvbmUgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlcy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB2YWx1ZSAtIEF0dHJpYnV0ZXMgaGFzaC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2xvbmVkIGF0dHJpYnV0ZXMgaGFzaC5cbiAqL1xuZnVuY3Rpb24gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyh2YWx1ZSkge1xuICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUodmFsdWUpKSlcbn1cblxuLyoqXG4gKiBTaGFyZWQgY2hhbm5lbCBuYW1lIGZvciBtb2RlbCBsaWZlY3ljbGUgZXZlbnRzIChQaGFzZSAzKS5cbiAqIE1hdGNoZXMgdGhlIGJhY2tlbmQgYEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUVgLlxuICovXG5jb25zdCBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FID0gXCJmcm9udGVuZC1tb2RlbHNcIlxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgZnJvbnRlbmQgbW9kZWwgZXZlbnQgcHJlbG9hZC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSB0YXJnZXQgLSBUYXJnZXQgcHJlbG9hZCBwYXlsb2FkLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IHNvdXJjZSAtIFNvdXJjZSBwcmVsb2FkIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRQcmVsb2FkKHRhcmdldCwgc291cmNlKSB7XG4gIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2UpKSB7XG4gICAgY29uc3QgZXhpc3RpbmdWYWx1ZSA9IHRhcmdldFtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgaWYgKHZhbHVlID09PSB0cnVlIHx8IHZhbHVlID09PSBmYWxzZSkge1xuICAgICAgaWYgKGV4aXN0aW5nVmFsdWUgPT09IHVuZGVmaW5lZCkgdGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdID0gdmFsdWVcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRhcmdldFtyZWxhdGlvbnNoaXBOYW1lXSA9IHZhbHVlXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICghZXhpc3RpbmdWYWx1ZSB8fCB0eXBlb2YgZXhpc3RpbmdWYWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGV4aXN0aW5nVmFsdWUpKSB7XG4gICAgICB0YXJnZXRbcmVsYXRpb25zaGlwTmFtZV0gPSB7fVxuICAgIH1cblxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50UHJlbG9hZChcbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAodGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdKSxcbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAodmFsdWUpXG4gICAgKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBtZXJnZSBmcm9udGVuZCBtb2RlbCBldmVudCBzZWxlY3QuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gdGFyZ2V0IC0gVGFyZ2V0IHNlbGVjdCBtYXAuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gc291cmNlIC0gU291cmNlIHNlbGVjdCBtYXAuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRTZWxlY3QodGFyZ2V0LCBzb3VyY2UpIHtcbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCBhdHRyaWJ1dGVzXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2UpKSB7XG4gICAgY29uc3QgZXhpc3RpbmdBdHRyaWJ1dGVzID0gdGFyZ2V0W21vZGVsTmFtZV0gfHwgW11cblxuICAgIHRhcmdldFttb2RlbE5hbWVdID0gQXJyYXkuZnJvbShuZXcgU2V0KGV4aXN0aW5nQXR0cmlidXRlcy5jb25jYXQoYXR0cmlidXRlcykpKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBtZXJnZSB1bmlxdWUgZnJvbnRlbmQgbW9kZWwgZXZlbnQgZW50cmllcy5cbiAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsV2l0aENvdW50UGF5bG9hZEVudHJ5IHwgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsQWJpbGl0aWVzUGF5bG9hZEVudHJ5Pn0gdGFyZ2V0IC0gVGFyZ2V0IGFycmF5LlxuICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxXaXRoQ291bnRQYXlsb2FkRW50cnkgfCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxBYmlsaXRpZXNQYXlsb2FkRW50cnk+fSBzb3VyY2UgLSBTb3VyY2UgYXJyYXkuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VVbmlxdWVGcm9udGVuZE1vZGVsRXZlbnRFbnRyaWVzKHRhcmdldCwgc291cmNlKSB7XG4gIGNvbnN0IGV4aXN0aW5nS2V5cyA9IG5ldyBTZXQodGFyZ2V0Lm1hcCgoZW50cnkpID0+IEpTT04uc3RyaW5naWZ5KGVudHJ5KSkpXG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBzb3VyY2UpIHtcbiAgICBjb25zdCBrZXkgPSBKU09OLnN0cmluZ2lmeShlbnRyeSlcblxuICAgIGlmIChleGlzdGluZ0tleXMuaGFzKGtleSkpIGNvbnRpbnVlXG5cbiAgICB0YXJnZXQucHVzaChlbnRyeSlcbiAgICBleGlzdGluZ0tleXMuYWRkKGtleSlcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgZnJvbnRlbmQgbW9kZWwgZXZlbnQgcHJvamVjdGlvbiBwYXlsb2FkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH0gdGFyZ2V0IC0gVGFyZ2V0IHBheWxvYWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfSBzb3VyY2UgLSBTb3VyY2UgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByb2plY3Rpb25QYXlsb2FkKHRhcmdldCwgc291cmNlKSB7XG4gIGlmIChzb3VyY2UucHJlbG9hZCkge1xuICAgIGlmICghdGFyZ2V0LnByZWxvYWQpIHRhcmdldC5wcmVsb2FkID0ge31cbiAgICBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByZWxvYWQodGFyZ2V0LnByZWxvYWQsIHNvdXJjZS5wcmVsb2FkKVxuICB9XG5cbiAgaWYgKHNvdXJjZS5zZWxlY3QpIHtcbiAgICBpZiAoIXRhcmdldC5zZWxlY3QpIHRhcmdldC5zZWxlY3QgPSB7fVxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50U2VsZWN0KHRhcmdldC5zZWxlY3QsIHNvdXJjZS5zZWxlY3QpXG4gIH1cblxuICBpZiAoc291cmNlLnNlbGVjdHNFeHRyYSkge1xuICAgIGlmICghdGFyZ2V0LnNlbGVjdHNFeHRyYSkgdGFyZ2V0LnNlbGVjdHNFeHRyYSA9IHt9XG4gICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRTZWxlY3QodGFyZ2V0LnNlbGVjdHNFeHRyYSwgc291cmNlLnNlbGVjdHNFeHRyYSlcbiAgfVxuXG4gIGlmIChzb3VyY2Uud2l0aENvdW50KSB7XG4gICAgaWYgKCF0YXJnZXQud2l0aENvdW50KSB0YXJnZXQud2l0aENvdW50ID0gW11cbiAgICBtZXJnZVVuaXF1ZUZyb250ZW5kTW9kZWxFdmVudEVudHJpZXModGFyZ2V0LndpdGhDb3VudCwgc291cmNlLndpdGhDb3VudClcbiAgfVxuXG4gIGlmIChzb3VyY2UuYWJpbGl0aWVzKSB7XG4gICAgaWYgKCF0YXJnZXQuYWJpbGl0aWVzKSB0YXJnZXQuYWJpbGl0aWVzID0gW11cbiAgICBtZXJnZVVuaXF1ZUZyb250ZW5kTW9kZWxFdmVudEVudHJpZXModGFyZ2V0LmFiaWxpdGllcywgc291cmNlLmFiaWxpdGllcylcbiAgfVxuXG4gIGlmIChzb3VyY2UucXVlcnlEYXRhICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCB0YXJnZXRRdWVyeURhdGEgPSBBcnJheS5pc0FycmF5KHRhcmdldC5xdWVyeURhdGEpID8gdGFyZ2V0LnF1ZXJ5RGF0YSA6IFtdXG5cbiAgICB0YXJnZXQucXVlcnlEYXRhID0gdGFyZ2V0UXVlcnlEYXRhXG4gICAgY29uc3QgcXVlcnlEYXRhRW50cmllcyA9IEFycmF5LmlzQXJyYXkoc291cmNlLnF1ZXJ5RGF0YSkgPyBzb3VyY2UucXVlcnlEYXRhIDogW3NvdXJjZS5xdWVyeURhdGFdXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHF1ZXJ5RGF0YUVudHJpZXMpIHtcbiAgICAgIHRhcmdldFF1ZXJ5RGF0YS5wdXNoKGVudHJ5KVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgbWF0Y2hlZCBldmVudCBmaWx0ZXIga2V5cy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBSYXcgd2Vic29ja2V0IGV2ZW50IGJvZHkuXG4gKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gTWF0Y2hlZCBldmVudCBmaWx0ZXIga2V5cyBkZWxpdmVyZWQgYnkgdGhlIGJhY2tlbmQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxNYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKGJvZHkpIHtcbiAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSBcIm9iamVjdFwiKSByZXR1cm4gbmV3IFNldCgpXG5cbiAgY29uc3Qga2V5cyA9IC8qKiBAdHlwZSB7e21hdGNoZWRFdmVudEZpbHRlcktleXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovIChib2R5KS5tYXRjaGVkRXZlbnRGaWx0ZXJLZXlzXG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KGtleXMpKSByZXR1cm4gbmV3IFNldCgpXG5cbiAgcmV0dXJuIG5ldyBTZXQoa2V5cy5tYXAoKGtleSkgPT4gU3RyaW5nKGtleSkpKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgZXZlbnQgZW50cnkgbWF0Y2hlcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5fSBlbnRyeSAtIENhbGxiYWNrIGVudHJ5LlxuICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyAtIEJhY2tlbmQgbWF0Y2hlZCBmaWx0ZXIga2V5cy5cbiAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSBjYWxsYmFjayBzaG91bGQgcmVjZWl2ZSB0aGUgZXZlbnQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxFdmVudEVudHJ5TWF0Y2hlcyhlbnRyeSwgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cykge1xuICBpZiAoIWVudHJ5LmV2ZW50RmlsdGVyS2V5KSByZXR1cm4gdHJ1ZVxuXG4gIHJldHVybiBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzLmhhcyhlbnRyeS5ldmVudEZpbHRlcktleSlcbn1cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBubyBkZXN0cm95IGV2ZW50IGZpbHRlci5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gRXZlbnQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gb3B0aW9ucyAtIEV2ZW50IG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0Tm9EZXN0cm95RXZlbnRGaWx0ZXIoTW9kZWxDbGFzcywgb3B0aW9ucykge1xuICBjb25zdCBldmVudE9wdGlvbnNQYXlsb2FkID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQoTW9kZWxDbGFzcywgb3B0aW9ucylcblxuICBpZiAoIWV2ZW50T3B0aW9uc1BheWxvYWQuZXZlbnRGaWx0ZXJLZXkpIHJldHVyblxuXG4gIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIGRlc3Ryb3kgZXZlbnQgc3Vic2NyaXB0aW9ucyBkbyBub3Qgc3VwcG9ydCBxdWVyeSBmaWx0ZXJzXCIpXG59XG5cbi8qKlxuICogUGVyLW1vZGVsIGNsYXNzIHNpbmdsZXRvbiB0aGF0IG11bHRpcGxleGVzIGFsbCByZWdpc3RlcmVkIG9uQ3JlYXRlIC9cbiAqIG9uVXBkYXRlIC8gb25EZXN0cm95IGNhbGxiYWNrcyDigJQgY2xhc3MtbGV2ZWwgKyBpbnN0YW5jZS1sZXZlbCDigJRcbiAqIG92ZXIgb25lIFdlYnNvY2tldENoYW5uZWxWMiBzdWJzY3JpcHRpb24uIFN1YnNjcmlwdGlvbiBvcGVucyBvbiB0aGVcbiAqIGZpcnN0IGxpc3RlbmVyIGFuZCBjbG9zZXMgd2hlbiB0aGUgbGFzdCBvbmUgdW5zdWJzY3JpYmVzLlxuICpcbiAqIEluc3RhbmNlLWxldmVsIGxpc3RlbmVycyBhbHNvIHJlY2VpdmUgYXV0by1tZXJnZTogd2hlbiBhbiBgdXBkYXRlYFxuICogZXZlbnQgYXJyaXZlcyBmb3IgYSByZWdpc3RlcmVkIGluc3RhbmNlIGlkLCB0aGUgaW5zdGFuY2Unc1xuICogYXR0cmlidXRlcyBhcmUgdXBkYXRlZCBpbiBwbGFjZSBiZWZvcmUgdGhlIGNhbGxiYWNrIGZpcmVzLCBzb1xuICogY2FsbGVycyBjYW4gcmVhZCBmcmVzaCB2YWx1ZXMgZnJvbSB0aGUgc2FtZSBpbnN0YW5jZSBoYW5kbGUuXG4gKi9cbmNsYXNzIEZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbiB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzIGZvciB0aGlzIHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dH0gcmVxdWVzdENvbnRleHQgLSBDYXB0dXJlZCBzdWJzY3JpcHRpb24gY29udGV4dC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKE1vZGVsQ2xhc3MsIHJlcXVlc3RDb250ZXh0KSB7XG4gICAgdGhpcy5Nb2RlbENsYXNzID0gTW9kZWxDbGFzc1xuICAgIHRoaXMucmVxdWVzdENvbnRleHQgPSByZXF1ZXN0Q29udGV4dFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeT59ICovXG4gICAgdGhpcy5jbGFzc0NyZWF0ZUNhbGxiYWNrcyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeT59ICovXG4gICAgdGhpcy5jbGFzc1VwZGF0ZUNhbGxiYWNrcyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5Pn0gKi9cbiAgICB0aGlzLmNsYXNzRGVzdHJveUNhbGxiYWNrcyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywge2luc3RhbmNlOiBGcm9udGVuZE1vZGVsQmFzZSwgdXBkYXRlQ2FsbGJhY2tzOiBTZXQ8RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5PiwgZGVzdHJveUNhbGxiYWNrczogU2V0PEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5Pn0+fSAqL1xuICAgIHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IG51bGxcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMucmVhZHlQcm9taXNlID0gbnVsbFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7c3RyaW5nIHwgbnVsbH0gKi9cbiAgICB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1YnNjcmlwdGlvbiBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHt7bW9kZWw6IHN0cmluZywgZGVzdHJveUV2ZW50RGVsaXZlcnk/OiBib29sZWFuLCBldmVudEZpbHRlcnM/OiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeVtdLCB1bmZpbHRlcmVkRXZlbnREZWxpdmVyeT86IGJvb2xlYW59ICYgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9IC0gQ3VycmVudCB3ZWJzb2NrZXQgc3Vic2NyaXB0aW9uIHBhcmFtcy5cbiAgICovXG4gIHN1YnNjcmlwdGlvblBhcmFtcygpIHtcbiAgICAvKipcbiAgICAgKiBQcm9qZWN0aW9uIHBheWxvYWQuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfSAqL1xuICAgIGNvbnN0IHByb2plY3Rpb25QYXlsb2FkID0ge31cbiAgICAvKipcbiAgICAgKiBFdmVudCBmaWx0ZXJzIGJ5IGtleS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnk+fSAqL1xuICAgIGNvbnN0IGV2ZW50RmlsdGVyc0J5S2V5ID0ge31cbiAgICBjb25zdCBwcm9qZWN0aW9uRW50cmllcyA9IFtdXG4gICAgbGV0IGhhc0Rlc3Ryb3lFdmVudERlbGl2ZXJ5ID0gdGhpcy5jbGFzc0Rlc3Ryb3lDYWxsYmFja3Muc2l6ZSA+IDBcbiAgICBsZXQgaGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLmNsYXNzQ3JlYXRlQ2FsbGJhY2tzKSBwcm9qZWN0aW9uRW50cmllcy5wdXNoKGVudHJ5KVxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgdGhpcy5jbGFzc1VwZGF0ZUNhbGxiYWNrcykgcHJvamVjdGlvbkVudHJpZXMucHVzaChlbnRyeSlcblxuICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgdGhpcy5pbnN0YW5jZUxpc3RlbmVycy52YWx1ZXMoKSkge1xuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBsaXN0ZW5lci51cGRhdGVDYWxsYmFja3MpIHByb2plY3Rpb25FbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICBpZiAobGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcy5zaXplID4gMCkgaGFzRGVzdHJveUV2ZW50RGVsaXZlcnkgPSB0cnVlXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBwcm9qZWN0aW9uRW50cmllcykge1xuICAgICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRQcm9qZWN0aW9uUGF5bG9hZChwcm9qZWN0aW9uUGF5bG9hZCwgZW50cnkucHJvamVjdGlvblBheWxvYWQpXG5cbiAgICAgIGlmIChlbnRyeS5ldmVudEZpbHRlcktleSAmJiBlbnRyeS5ldmVudEZpbHRlclBheWxvYWQpIHtcbiAgICAgICAgZXZlbnRGaWx0ZXJzQnlLZXlbZW50cnkuZXZlbnRGaWx0ZXJLZXldID0ge1xuICAgICAgICAgIC4uLmVudHJ5LmV2ZW50RmlsdGVyUGF5bG9hZCxcbiAgICAgICAgICBrZXk6IGVudHJ5LmV2ZW50RmlsdGVyS2V5XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGhhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5ID0gdHJ1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGV2ZW50RmlsdGVycyA9IE9iamVjdC52YWx1ZXMoZXZlbnRGaWx0ZXJzQnlLZXkpXG4gICAgY29uc3QgZXZlbnRGaWx0ZXJQYXJhbXMgPSBldmVudEZpbHRlcnMubGVuZ3RoID4gMFxuICAgICAgPyB7XG4gICAgICAgICAgZXZlbnRGaWx0ZXJzLFxuICAgICAgICAgIC4uLihoYXNEZXN0cm95RXZlbnREZWxpdmVyeSA/IHtkZXN0cm95RXZlbnREZWxpdmVyeTogdHJ1ZX0gOiB7fSksXG4gICAgICAgICAgLi4uKGhhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5ID8ge3VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5OiB0cnVlfSA6IHt9KVxuICAgICAgICB9XG4gICAgICA6IHt9XG5cbiAgICByZXR1cm4gbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQoXG4gICAgICB0aGlzLnJlcXVlc3RDb250ZXh0LFxuICAgICAge1xuICAgICAgICBtb2RlbDogdGhpcy5Nb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICAuLi5ldmVudEZpbHRlclBhcmFtcyxcbiAgICAgICAgLi4ucHJvamVjdGlvblBheWxvYWRcbiAgICAgIH1cbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdWJzY3JpcHRpb24gcGFyYW1zIGpzb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RhYmxlIGtleSBmb3IgY3VycmVudCBzdWJzY3JpcHRpb24gcGFyYW1zLlxuICAgKi9cbiAgc3Vic2NyaXB0aW9uUGFyYW1zSnNvbigpIHtcbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodGhpcy5zdWJzY3JpcHRpb25QYXJhbXMoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyIGNsYXNzIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeSB8IEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5fSBUXG4gICAqIEBwYXJhbSB7U2V0PFQ+fSBjYWxsYmFja3MgLSBDYWxsYmFjayBzZXQgZm9yIHRoZSBldmVudCB0eXBlLlxuICAgKiBAcGFyYW0ge1R9IGVudHJ5IC0gQ2FsbGJhY2sgZW50cnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgcmVnaXN0ZXJDbGFzc0NhbGxiYWNrKGNhbGxiYWNrcywgZW50cnkpIHtcbiAgICBjYWxsYmFja3MuYWRkKGVudHJ5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlU3Vic2NyaWJlZCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNhbGxiYWNrcy5kZWxldGUoZW50cnkpXG4gICAgICB0aGlzLm1heWJlVGVhcmRvd24oKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgY2FsbGJhY2tzLmRlbGV0ZShlbnRyeSlcbiAgICAgIHRoaXMubWF5YmVUZWFyZG93bigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIHN1YnNjcmliZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAqL1xuICBhc3luYyBlbnN1cmVTdWJzY3JpYmVkKCkge1xuICAgIGNvbnN0IHBhcmFtc0pzb24gPSB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0pzb24oKVxuXG4gICAgaWYgKHRoaXMuY2hhbm5lbEhhbmRsZSAmJiAhdGhpcy5jaGFubmVsSGFuZGxlLmlzQ2xvc2VkKCkpIHtcbiAgICAgIGlmICh0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSAhPT0gcGFyYW1zSnNvbikge1xuICAgICAgICB0aGlzLmNoYW5uZWxIYW5kbGUuY2xvc2UoKVxuICAgICAgICB0aGlzLmNoYW5uZWxIYW5kbGUgPSBudWxsXG4gICAgICAgIHRoaXMucmVhZHlQcm9taXNlID0gbnVsbFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHRoaXMucmVhZHlQcm9taXNlKSBhd2FpdCB0aGlzLnJlYWR5UHJvbWlzZVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTZXJpYWxpemUgcGFyYWxsZWwgY2FsbHMgKGUuZy4gUHJvbWlzZS5hbGwoW29uQ3JlYXRlLCBvblVwZGF0ZSxcbiAgICAvLyBvbkRlc3Ryb3ldKSkgc28gd2Ugb3BlbiBleGFjdGx5IG9uZSBzdWJzY3JpcHRpb24gcGVyIG1vZGVsIGNsYXNzXG4gICAgLy8gaW5zdGVhZCBvZiByYWNpbmcgdGhyZWUgY29uY3VycmVudCBzdWJzY3JpYmVDaGFubmVsIGNhbGxzLlxuICAgIGlmICh0aGlzLnJlYWR5UHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5yZWFkeVByb21pc2VcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgIGlmICghY2xpZW50IHx8IHR5cGVvZiBjbGllbnQuc3Vic2NyaWJlQ2hhbm5lbCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudCBzdWJzY3JpcHRpb25zIHJlcXVpcmUgY29uZmlndXJlVHJhbnNwb3J0KHt3ZWJzb2NrZXRVcmx9KSBvciBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldENsaWVudH0pXCIpXG4gICAgfVxuXG4gICAgdGhpcy5yZWFkeVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHR5cGVvZiBjbGllbnQuY29ubmVjdCA9PT0gXCJmdW5jdGlvblwiKSBhd2FpdCBjbGllbnQuY29ubmVjdCgpXG5cbiAgICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zKClcblxuICAgICAgdGhpcy5zdWJzY3JpcHRpb25QYXJhbXNLZXkgPSBKU09OLnN0cmluZ2lmeShwYXJhbXMpXG4gICAgICB0aGlzLmNoYW5uZWxIYW5kbGUgPSBjbGllbnQuc3Vic2NyaWJlQ2hhbm5lbChGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FLCB7XG4gICAgICAgIHBhcmFtcyxcbiAgICAgICAgb25NZXNzYWdlOiAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gYm9keSkgPT4gdGhpcy5fZGlzcGF0Y2hFdmVudChib2R5KSxcbiAgICAgICAgb25DbG9zZTogKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IG51bGxcbiAgICAgICAgICB0aGlzLnJlYWR5UHJvbWlzZSA9IG51bGxcbiAgICAgICAgICB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSA9IG51bGxcbiAgICAgICAgICB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLmNsZWFyKClcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIGF3YWl0IHRoaXMuY2hhbm5lbEhhbmRsZS5yZWFkeVxuICAgIH0pKClcblxuICAgIGF3YWl0IHRoaXMucmVhZHlQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXNwYXRjaCBldmVudC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keSAtIFdlYlNvY2tldCBldmVudCBwYXlsb2FkLlxuICAgKi9cbiAgX2Rpc3BhdGNoRXZlbnQoYm9keSkge1xuICAgIGlmICghYm9keSB8fCB0eXBlb2YgYm9keSAhPT0gXCJvYmplY3RcIikgcmV0dXJuXG5cbiAgICBjb25zdCBhY3Rpb24gPSBib2R5LmFjdGlvblxuICAgIGNvbnN0IHJhd0lkID0gYm9keS5pZFxuXG4gICAgaWYgKGFjdGlvbiAhPT0gXCJjcmVhdGVcIiAmJiBhY3Rpb24gIT09IFwidXBkYXRlXCIgJiYgYWN0aW9uICE9PSBcImRlc3Ryb3lcIikgcmV0dXJuXG4gICAgaWYgKHJhd0lkID09PSB1bmRlZmluZWQgfHwgcmF3SWQgPT09IG51bGwpIHJldHVyblxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBpZGVudGl0eSA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSlcbiAgICAgID8gbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhwcmltYXJ5S2V5LCByYXdJZClcbiAgICAgIDogU3RyaW5nKHJhd0lkKVxuICAgIGNvbnN0IGlkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgaWRlbnRpdHkpXG4gICAgY29uc3QgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyA9IGZyb250ZW5kTW9kZWxNYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKGJvZHkpXG5cbiAgICBpZiAoYWN0aW9uID09PSBcImRlc3Ryb3lcIikge1xuICAgICAgY29uc3QgbGlzdGVuZXIgPSB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLmdldChpZClcblxuICAgICAgaWYgKGxpc3RlbmVyKSB7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcykge1xuICAgICAgICAgIHRyeSB7IGVudHJ5LmNhbGxiYWNrKHtpZDogaWRlbnRpdHl9KSB9IGNhdGNoIChlcnJvcikgeyBjb25zb2xlLmVycm9yKGVycm9yKSB9XG4gICAgICAgIH1cbiAgICAgICAgZGVsZXRlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIodGhpcywgbGlzdGVuZXIpXG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHRoaXMuY2xhc3NEZXN0cm95Q2FsbGJhY2tzKSB7XG4gICAgICAgIHRyeSB7IGVudHJ5LmNhbGxiYWNrKHtpZDogaWRlbnRpdHl9KSB9IGNhdGNoIChlcnJvcikgeyBjb25zb2xlLmVycm9yKGVycm9yKSB9XG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoIWJvZHkucmVjb3JkIHx8IHR5cGVvZiBib2R5LnJlY29yZCAhPT0gXCJvYmplY3RcIikgcmV0dXJuXG5cbiAgICBjb25zdCBkZXNlcmlhbGl6ZWRSZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGJvZHkucmVjb3JkKSlcbiAgICBjb25zdCBmcmVzaE1vZGVsID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMuTW9kZWxDbGFzcykuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UoZGVzZXJpYWxpemVkUmVjb3JkKVxuICAgIGNvbnN0IGxpc3RlbmVyID0gdGhpcy5pbnN0YW5jZUxpc3RlbmVycy5nZXQoaWQpXG5cbiAgICBpZiAoYWN0aW9uID09PSBcInVwZGF0ZVwiICYmIGxpc3RlbmVyKSB7XG4gICAgICBjb25zdCBtYXRjaGluZ1VwZGF0ZUNhbGxiYWNrcyA9IEFycmF5LmZyb20obGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzKS5maWx0ZXIoKGVudHJ5KSA9PlxuICAgICAgICBmcm9udGVuZE1vZGVsRXZlbnRFbnRyeU1hdGNoZXMoZW50cnksIG1hdGNoZWRFdmVudEZpbHRlcktleXMpXG4gICAgICApXG5cbiAgICAgIGlmIChtYXRjaGluZ1VwZGF0ZUNhbGxiYWNrcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIEF1dG8tbWVyZ2UgaW50byB0aGUgcmVnaXN0ZXJlZCBpbnN0YW5jZSBzbyBjYWxsZXJzIHJlYWRpbmdcbiAgICAgICAgLy8gdGhyb3VnaCB0aGUgc2FtZSBoYW5kbGUgc2VlIGZyZXNoIGF0dHJpYnV0ZXMuXG4gICAgICAgIGNvbnN0IGluc3RhbmNlQW55ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGxpc3RlbmVyLmluc3RhbmNlKVxuXG4gICAgICAgIGluc3RhbmNlQW55LmFzc2lnbkF0dHJpYnV0ZXMoZnJlc2hNb2RlbC5hdHRyaWJ1dGVzKCkpXG4gICAgICAgIGluc3RhbmNlQW55Ll9wZXJzaXN0ZWRBdHRyaWJ1dGVzID0gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhsaXN0ZW5lci5pbnN0YW5jZS5hdHRyaWJ1dGVzKCkpXG5cbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBtYXRjaGluZ1VwZGF0ZUNhbGxiYWNrcykge1xuICAgICAgICAgIHRyeSB7IGVudHJ5LmNhbGxiYWNrKHtpZDogaWRlbnRpdHksIG1vZGVsOiBsaXN0ZW5lci5pbnN0YW5jZX0pIH0gY2F0Y2ggKGVycm9yKSB7IGNvbnNvbGUuZXJyb3IoZXJyb3IpIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGNsYXNzQ2FsbGJhY2tzID0gYWN0aW9uID09PSBcImNyZWF0ZVwiID8gdGhpcy5jbGFzc0NyZWF0ZUNhbGxiYWNrcyA6IHRoaXMuY2xhc3NVcGRhdGVDYWxsYmFja3NcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgY2xhc3NDYWxsYmFja3MpIHtcbiAgICAgIGlmICghZnJvbnRlbmRNb2RlbEV2ZW50RW50cnlNYXRjaGVzKGVudHJ5LCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKSkgY29udGludWVcblxuICAgICAgdHJ5IHsgZW50cnkuY2FsbGJhY2soe2lkOiBpZGVudGl0eSwgbW9kZWw6IGZyZXNoTW9kZWx9KSB9IGNhdGNoIChlcnJvcikgeyBjb25zb2xlLmVycm9yKGVycm9yKSB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF5YmUgdGVhcmRvd24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBtYXliZVRlYXJkb3duKCkge1xuICAgIGNvbnN0IGhhc0FueUxpc3RlbmVyID0gdGhpcy5jbGFzc0NyZWF0ZUNhbGxiYWNrcy5zaXplID4gMFxuICAgICAgfHwgdGhpcy5jbGFzc1VwZGF0ZUNhbGxiYWNrcy5zaXplID4gMFxuICAgICAgfHwgdGhpcy5jbGFzc0Rlc3Ryb3lDYWxsYmFja3Muc2l6ZSA+IDBcbiAgICAgIHx8IHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMuc2l6ZSA+IDBcblxuICAgIGlmIChoYXNBbnlMaXN0ZW5lcikgcmV0dXJuXG5cbiAgICBpZiAodGhpcy5jaGFubmVsSGFuZGxlKSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmNoYW5uZWxIYW5kbGUuY2xvc2UoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmNoYW5uZWxIYW5kbGUgPSBudWxsXG4gICAgdGhpcy5yZWFkeVByb21pc2UgPSBudWxsXG4gICAgdGhpcy5zdWJzY3JpcHRpb25QYXJhbXNLZXkgPSBudWxsXG4gICAgcmVsZWFzZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbih0aGlzKVxuICB9XG59XG5cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgZXZlbnQgc3Vic2NyaXB0aW9ucy5cbiAqIEB0eXBlIHtXZWFrTWFwPEZyb250ZW5kTW9kZWxDbGFzcywgTWFwPHN0cmluZywgRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uPj59ICovXG5jb25zdCBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zID0gbmV3IFdlYWtNYXAoKVxuXG4vKipcbiAqIFJ1bnMgZW5zdXJlIGZyb250ZW5kIG1vZGVsIGV2ZW50IHN1YnNjcmlwdGlvbi5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHR9IHJlcXVlc3RDb250ZXh0IC0gQ2FwdHVyZWQgc3Vic2NyaXB0aW9uIGNvbnRleHQuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufSAtIFBlci1jbGFzcyBzdWJzY3JpcHRpb24gaGVscGVyLlxuICovXG5mdW5jdGlvbiBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oTW9kZWxDbGFzcywgcmVxdWVzdENvbnRleHQpIHtcbiAgbGV0IHN1YnNjcmlwdGlvbnMgPSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmdldChNb2RlbENsYXNzKVxuXG4gIGlmICghc3Vic2NyaXB0aW9ucykge1xuICAgIHN1YnNjcmlwdGlvbnMgPSBuZXcgTWFwKClcbiAgICBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLnNldChNb2RlbENsYXNzLCBzdWJzY3JpcHRpb25zKVxuICB9XG5cbiAgY29uc3QgY29udGV4dEtleSA9IHJlbW90ZVJlcXVlc3RDb250ZXh0S2V5KHJlcXVlc3RDb250ZXh0KVxuICBsZXQgc3ViID0gc3Vic2NyaXB0aW9ucy5nZXQoY29udGV4dEtleSlcblxuICBpZiAoIXN1Yikge1xuICAgIHN1YiA9IG5ldyBGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oTW9kZWxDbGFzcywgcmVxdWVzdENvbnRleHQpXG4gICAgc3Vic2NyaXB0aW9ucy5zZXQoY29udGV4dEtleSwgc3ViKVxuICB9XG5cbiAgcmV0dXJuIHN1YlxufVxuXG4vKipcbiAqIFJlbW92ZXMgYW4gZW1wdHkgY29udGV4dCBidWNrZXQgc28gc3dpdGNoaW5nIHRocm91Z2ggbWFueSB0ZW5hbnRzIGRvZXMgbm90IHJldGFpbiBldmVyeSBzbmFwc2hvdC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufSBzdWJzY3JpcHRpb24gLSBFbXB0eSBzdWJzY3JpcHRpb24gYnVja2V0LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJlbGVhc2VGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oc3Vic2NyaXB0aW9uKSB7XG4gIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmdldChzdWJzY3JpcHRpb24uTW9kZWxDbGFzcylcbiAgY29uc3QgY29udGV4dEtleSA9IHJlbW90ZVJlcXVlc3RDb250ZXh0S2V5KHN1YnNjcmlwdGlvbi5yZXF1ZXN0Q29udGV4dClcblxuICBpZiAoc3Vic2NyaXB0aW9ucz8uZ2V0KGNvbnRleHRLZXkpICE9PSBzdWJzY3JpcHRpb24pIHJldHVyblxuXG4gIHN1YnNjcmlwdGlvbnMuZGVsZXRlKGNvbnRleHRLZXkpXG4gIGlmIChzdWJzY3JpcHRpb25zLnNpemUgPT09IDApIGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMuZGVsZXRlKHN1YnNjcmlwdGlvbi5Nb2RlbENsYXNzKVxufVxuXG4vKipcbiAqIENhcHR1cmVzIHRoZSBjdXJyZW50IGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCBjb250ZXh0IGZvciBvbmUgb3BlcmF0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHR9IEZyb3plbiBjb250ZXh0IHNuYXBzaG90LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRDb250ZXh0ID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdENvbnRleHQgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0Q29udGV4dCgpXG4gICAgOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RDb250ZXh0XG5cbiAgcmV0dXJuIGNhcHR1cmVGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQoY29uZmlndXJlZENvbnRleHQpXG59XG5cbi8qKlxuICogQ2FwdHVyZXMgdGhlIGV4cGxpY2l0IGxpZmVjeWNsZSBjb250ZXh0IG9yIGZhbGxzIGJhY2sgdG8gdGhlIGNvbmZpZ3VyZWQgdHJhbnNwb3J0IGNvbnRleHQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQgfCB1bmRlZmluZWR9IHJlcXVlc3RDb250ZXh0IC0gUmVnaXN0cmF0aW9uLWxvY2FsIGNvbnRleHQuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dH0gRnJvemVuIGNvbnRleHQgc25hcHNob3QuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSB7XG4gIGlmIChyZXF1ZXN0Q29udGV4dCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KClcblxuICByZXR1cm4gY2FwdHVyZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dClcbn1cblxuLyoqXG4gKiBSdW5zIGVuc3VyZSBmcm9udGVuZCBtb2RlbCBpbnN0YW5jZSBsaXN0ZW5lci5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufSBzdWIgLSBFdmVudCBzdWJzY3JpcHRpb24gYnVja2V0LlxuICogQHBhcmFtIHtzdHJpbmd9IGlkIC0gTW9kZWwgaWQuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBpbnN0YW5jZSAtIExpc3RlbmVyIGluc3RhbmNlLlxuICogQHJldHVybnMge3tpbnN0YW5jZTogRnJvbnRlbmRNb2RlbEJhc2UsIHVwZGF0ZUNhbGxiYWNrczogU2V0PEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeT4sIGRlc3Ryb3lDYWxsYmFja3M6IFNldDxGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50Q2FsbGJhY2tFbnRyeT59fSAtIEluc3RhbmNlIGxpc3RlbmVyIGJ1Y2tldC5cbiAqL1xuZnVuY3Rpb24gZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIoc3ViLCBpZCwgaW5zdGFuY2UpIHtcbiAgbGV0IGxpc3RlbmVyID0gc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChpZClcblxuICBpZiAoIWxpc3RlbmVyKSB7XG4gICAgbGlzdGVuZXIgPSB7aW5zdGFuY2UsIHVwZGF0ZUNhbGxiYWNrczogbmV3IFNldCgpLCBkZXN0cm95Q2FsbGJhY2tzOiBuZXcgU2V0KCl9XG4gICAgc3ViLmluc3RhbmNlTGlzdGVuZXJzLnNldChpZCwgbGlzdGVuZXIpXG4gIH0gZWxzZSB7XG4gICAgbGlzdGVuZXIuaW5zdGFuY2UgPSBpbnN0YW5jZVxuICB9XG5cbiAgcmV0dXJuIGxpc3RlbmVyXG59XG5cbi8qKlxuICogUmVtb3ZlcyBldmVyeSBpZGVudGl0eSBrZXkgcG9pbnRpbmcgYXQgYW4gaW5zdGFuY2UgbGlzdGVuZXIuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gc3ViIC0gRXZlbnQgc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXI+fSBsaXN0ZW5lciAtIEluc3RhbmNlIGxpc3RlbmVyIGJ1Y2tldC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBkZWxldGVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGxpc3RlbmVyKSB7XG4gIGZvciAoY29uc3QgW2lkLCBjdXJyZW50XSBvZiBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMpIHtcbiAgICBpZiAoY3VycmVudCA9PT0gbGlzdGVuZXIpIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5kZWxldGUoaWQpXG4gIH1cbn1cblxuLyoqXG4gKiBSZW1vdmVzIG9uZSBpbnN0YW5jZSBjYWxsYmFjayBlbnRyeSBhbmQgdGVhcnMgZG93biBhbiBlbXB0eSBsaXN0ZW5lci9zdWJzY3JpcHRpb24gYnVja2V0LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb259IHN1YiAtIEV2ZW50IHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gKiBAcGFyYW0geyhsaXN0ZW5lcjogUmV0dXJuVHlwZTx0eXBlb2YgZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXI+KSA9PiBib29sZWFufSByZW1vdmVFbnRyeSAtIENhbGxiYWNrIGVudHJ5IHJlbW92YWwuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gcmVtb3ZlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJFbnRyeShzdWIsIHJlbW92ZUVudHJ5KSB7XG4gIGZvciAoY29uc3QgY3VycmVudCBvZiBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMudmFsdWVzKCkpIHtcbiAgICBpZiAoIXJlbW92ZUVudHJ5KGN1cnJlbnQpKSBjb250aW51ZVxuXG4gICAgaWYgKGN1cnJlbnQudXBkYXRlQ2FsbGJhY2tzLnNpemUgPT09IDAgJiYgY3VycmVudC5kZXN0cm95Q2FsbGJhY2tzLnNpemUgPT09IDApIHtcbiAgICAgIGRlbGV0ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyKHN1YiwgY3VycmVudClcbiAgICB9XG4gICAgYnJlYWtcbiAgfVxuXG4gIHN1Yi5tYXliZVRlYXJkb3duKClcbn1cblxuLyoqXG4gKiBUZW1wb3JhcmlseSByZWdpc3RlcnMgYW4gaW5zdGFuY2UgbGlzdGVuZXIgdW5kZXIgaXRzIHBlbmRpbmcgaWRlbnRpdHkgd2hpbGUgcmV0YWluaW5nIGl0cyBwZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gaW5zdGFuY2UgLSBJbnN0YW5jZSBiZWluZyByZS1rZXllZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IHByZXZpb3VzSWRlbnRpdHkgLSBQZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBuZXh0SWRlbnRpdHkgLSBQZW5kaW5nIGlkZW50aXR5IHNlbnQgdG8gdGhlIHNlcnZlci5cbiAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSAtIENhbGxiYWNrIHRoYXQgcmVtb3ZlcyB0aGUgdGVtcG9yYXJ5IGFsaWFzZXMuXG4gKi9cbmZ1bmN0aW9uIGFsaWFzRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKE1vZGVsQ2xhc3MsIGluc3RhbmNlLCBwcmV2aW91c0lkZW50aXR5LCBuZXh0SWRlbnRpdHkpIHtcbiAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gIGNvbnN0IHByZXZpb3VzSWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkZW50aXR5KVxuICBjb25zdCBuZXh0SWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBuZXh0SWRlbnRpdHkpXG4gIC8qKiBAdHlwZSB7QXJyYXk8e2xpc3RlbmVyOiBSZXR1cm5UeXBlPHR5cGVvZiBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcj4sIHN1YjogRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufT59ICovXG4gIGNvbnN0IGFsaWFzZXMgPSBbXVxuXG4gIGlmIChwcmV2aW91c0lkID09PSBuZXh0SWQpIHJldHVybiAoKSA9PiB7fVxuXG4gIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmdldChNb2RlbENsYXNzKVxuXG4gIGlmICghc3Vic2NyaXB0aW9ucykgcmV0dXJuICgpID0+IHt9XG5cbiAgZm9yIChjb25zdCBzdWIgb2Ygc3Vic2NyaXB0aW9ucy52YWx1ZXMoKSkge1xuICAgIGNvbnN0IGxpc3RlbmVyID0gc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChwcmV2aW91c0lkKVxuXG4gICAgaWYgKCFsaXN0ZW5lciB8fCBsaXN0ZW5lci5pbnN0YW5jZSAhPT0gaW5zdGFuY2UgfHwgc3ViLmluc3RhbmNlTGlzdGVuZXJzLmhhcyhuZXh0SWQpKSBjb250aW51ZVxuXG4gICAgc3ViLmluc3RhbmNlTGlzdGVuZXJzLnNldChuZXh0SWQsIGxpc3RlbmVyKVxuICAgIGFsaWFzZXMucHVzaCh7bGlzdGVuZXIsIHN1Yn0pXG4gIH1cblxuICByZXR1cm4gKCkgPT4ge1xuICAgIGZvciAoY29uc3Qge2xpc3RlbmVyLCBzdWJ9IG9mIGFsaWFzZXMpIHtcbiAgICAgIGlmIChzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KHByZXZpb3VzSWQpID09PSBsaXN0ZW5lciAmJiBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KG5leHRJZCkgPT09IGxpc3RlbmVyKSB7XG4gICAgICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5kZWxldGUobmV4dElkKVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIE1vdmVzIGNhbGxiYWNrcyByZWdpc3RlcmVkIG9uIGFuIGluc3RhbmNlIHRvIGl0cyBuZXdseSBwZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gaW5zdGFuY2UgLSBSZS1rZXllZCBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IHByZXZpb3VzSWRlbnRpdHkgLSBQcmV2aW91cyBwZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBuZXh0SWRlbnRpdHkgLSBOZXcgcGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJla2V5RnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKE1vZGVsQ2xhc3MsIGluc3RhbmNlLCBwcmV2aW91c0lkZW50aXR5LCBuZXh0SWRlbnRpdHkpIHtcbiAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gIGNvbnN0IHByZXZpb3VzSWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkZW50aXR5KVxuICBjb25zdCBuZXh0SWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBuZXh0SWRlbnRpdHkpXG5cbiAgaWYgKHByZXZpb3VzSWQgPT09IG5leHRJZCkgcmV0dXJuXG5cbiAgY29uc3Qgc3Vic2NyaXB0aW9ucyA9IGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMuZ2V0KE1vZGVsQ2xhc3MpXG5cbiAgaWYgKCFzdWJzY3JpcHRpb25zKSByZXR1cm5cblxuICBmb3IgKGNvbnN0IHN1YiBvZiBzdWJzY3JpcHRpb25zLnZhbHVlcygpKSB7XG4gICAgY29uc3QgbGlzdGVuZXIgPSBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KHByZXZpb3VzSWQpXG5cbiAgICBpZiAoIWxpc3RlbmVyIHx8IGxpc3RlbmVyLmluc3RhbmNlICE9PSBpbnN0YW5jZSkgY29udGludWVcblxuICAgIGNvbnN0IG5leHRMaXN0ZW5lciA9IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQobmV4dElkKVxuXG4gICAgc3ViLmluc3RhbmNlTGlzdGVuZXJzLmRlbGV0ZShwcmV2aW91c0lkKVxuXG4gICAgaWYgKG5leHRMaXN0ZW5lcikge1xuICAgICAgbmV4dExpc3RlbmVyLmluc3RhbmNlID0gaW5zdGFuY2VcbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzKSBuZXh0TGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzLmFkZChlbnRyeSlcbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcykgbmV4dExpc3RlbmVyLmRlc3Ryb3lDYWxsYmFja3MuYWRkKGVudHJ5KVxuICAgIH0gZWxzZSB7XG4gICAgICBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuc2V0KG5leHRJZCwgbGlzdGVuZXIpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBjb21tYW5kIHVybC5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZXNvdXJjZVBhdGggLSBSZXNvdXJjZSBwYXRoIHByZWZpeC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBjb21tYW5kTmFtZSAtIENvbW1hbmQgcGF0aCBzZWdtZW50LlxuICogQHJldHVybnMge3N0cmluZ30gLSBGcm9udGVuZCBtb2RlbCBBUEkgVVJMLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQ29tbWFuZFVybChyZXNvdXJjZVBhdGgsIGNvbW1hbmROYW1lKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRVcmwgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VXJsKClcbiAgY29uc3Qgbm9ybWFsaXplZFJlc291cmNlUGF0aCA9IHJlc291cmNlUGF0aC5zdGFydHNXaXRoKFwiL1wiKSA/IHJlc291cmNlUGF0aCA6IGAvJHtyZXNvdXJjZVBhdGh9YFxuXG4gIHJldHVybiBgJHtjb25maWd1cmVkVXJsfSR7bm9ybWFsaXplZFJlc291cmNlUGF0aH0vJHtjb21tYW5kTmFtZX1gXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBhcGkgdXJsLlxuICogQHJldHVybnMge3N0cmluZ30gLSBTaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJIFVSTC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEFwaVVybCgpIHtcbiAgcmV0dXJuIGAke2Zyb250ZW5kTW9kZWxUcmFuc3BvcnRVcmwoKX0ke1NIQVJFRF9GUk9OVEVORF9NT0RFTF9BUElfUEFUSH1gXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgcGF0aC5cbiAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBSZXF1ZXN0IFVSTCBvciBwYXRoLlxuICogQHJldHVybnMge3N0cmluZ30gLSBXZWJzb2NrZXQtc2FmZSByZXF1ZXN0IHBhdGguXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRQYXRoKHVybCkge1xuICBpZiAodHlwZW9mIHVybCAhPT0gXCJzdHJpbmdcIiB8fCB1cmwubGVuZ3RoIDwgMSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IFVSTC9wYXRoLCBnb3Q6ICR7dXJsfWApXG4gIH1cblxuICBpZiAodXJsLnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgcmV0dXJuIHVybFxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWRVcmwgPSBuZXcgVVJMKHVybClcblxuICAgIHJldHVybiBgJHtwYXJzZWRVcmwucGF0aG5hbWV9JHtwYXJzZWRVcmwuc2VhcmNofWBcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHVybFxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGJyb3dzZXIgcnVudGltZSB0aW1lem9uZSB3aGVuIGF2YWlsYWJsZS5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQnJvd3NlciBydW50aW1lIHRpbWV6b25lIHdoZW4gYXZhaWxhYmxlLlxuICovXG5mdW5jdGlvbiBkZWZhdWx0RnJvbnRlbmRNb2RlbFRpbWVab25lKCkge1xuICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIHVuZGVmaW5lZFxuXG4gIGNvbnN0IGludGwgPSBnbG9iYWxUaGlzLkludGxcblxuICBpZiAoIWludGwpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBJbnRsIHRvIGJlIGF2YWlsYWJsZSBmb3IgYnJvd3NlciB0aW1lem9uZSBkZXRlY3Rpb25cIilcbiAgfVxuXG4gIGlmICh0eXBlb2YgaW50bC5EYXRlVGltZUZvcm1hdCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgSW50bC5EYXRlVGltZUZvcm1hdCB0byBiZSBhdmFpbGFibGUgYXMgYSBmdW5jdGlvblwiKVxuICB9XG5cbiAgY29uc3QgdGltZVpvbmUgPSBpbnRsLkRhdGVUaW1lRm9ybWF0KCkucmVzb2x2ZWRPcHRpb25zKCkudGltZVpvbmVcblxuICBpZiAodHlwZW9mIHRpbWVab25lICE9PSBcInN0cmluZ1wiIHx8IHRpbWVab25lLnRyaW0oKS5sZW5ndGggPCAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgSW50bC5EYXRlVGltZUZvcm1hdCB0byByZXNvbHZlIGEgYnJvd3NlciB0aW1lem9uZSBzdHJpbmdcIilcbiAgfVxuXG4gIHJldHVybiB2YWxpZGF0ZVRpbWVab25lKHRpbWVab25lLCBcImJyb3dzZXIgdGltZVpvbmVcIilcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgY29uZmlndXJlZCBmcm9udGVuZC1tb2RlbCByZXF1ZXN0IHRpbWV6b25lLlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIGZyb250ZW5kLW1vZGVsIHRpbWV6b25lLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKSB7XG4gIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcsIFwidGltZVpvbmVcIikpIHtcbiAgICByZXR1cm4gZGVmYXVsdEZyb250ZW5kTW9kZWxUaW1lWm9uZSgpXG4gIH1cblxuICBjb25zdCB0aW1lWm9uZSA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZVpvbmUoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lWm9uZVxuXG4gIGlmICh0aW1lWm9uZSA9PT0gdW5kZWZpbmVkIHx8IHRpbWVab25lID09PSBudWxsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHRpbWVab25lIGRpZCBub3QgcmVzb2x2ZSB0byBhIHRpbWV6b25lIHN0cmluZ1wiKVxuICB9XG5cbiAgcmV0dXJuIHZhbGlkYXRlVGltZVpvbmUodGltZVpvbmUsIFwiZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHRpbWVab25lXCIpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCByZXF1ZXN0IGhlYWRlcnMuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gW3RpbWVab25lXSAtIFByZS1yZXNvbHZlZCB0aW1lem9uZSBmb3IgdGhpcyByZXF1ZXN0LlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gSGVhZGVycyBmb3IgZnJvbnRlbmQtbW9kZWwgSFRUUCByZXF1ZXN0cy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlcXVlc3RIZWFkZXJzKHRpbWVab25lID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKCkpIHtcbiAgY29uc3QgZHluYW1pY0hlYWRlcnMgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0SGVhZGVycyA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0SGVhZGVycygpIHx8IHt9KVxuICAgIDogKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdEhlYWRlcnMgfHwge30pXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgY29uc3QgaGVhZGVycyA9IHtcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiwgLi4uZHluYW1pY0hlYWRlcnN9XG5cbiAgaWYgKHRpbWVab25lKSB7XG4gICAgaGVhZGVyc1tSRVFVRVNUX1RJTUVfWk9ORV9IRUFERVJdID0gdGltZVpvbmVcbiAgfVxuXG4gIHJldHVybiBoZWFkZXJzXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGNvbmZpZ3VyZWQgYm91bmRlZCB0cmFuc3BvcnQgZGVhZGxpbmUgaW4gbWlsbGlzZWNvbmRzLlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIGRlYWRsaW5lLCBvciB1bmRlZmluZWQgd2hlbiBubyBkZWFkbGluZSBpcyBzZXQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lb3V0TXMoKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRUaW1lb3V0ID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZW91dCA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVvdXQoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lb3V0XG5cbiAgaWYgKHR5cGVvZiBjb25maWd1cmVkVGltZW91dCAhPT0gXCJudW1iZXJcIiB8fCAhKGNvbmZpZ3VyZWRUaW1lb3V0ID4gMCkpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICByZXR1cm4gY29uZmlndXJlZFRpbWVvdXRcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgY29uZmlndXJlZCBjYWxsZXIvc2Vzc2lvbiBBYm9ydFNpZ25hbCBjb21wb3NlZCB3aXRoIHRoZSBkZWFkbGluZS5cbiAqIEByZXR1cm5zIHtBYm9ydFNpZ25hbCB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIGNhbGxlciBzaWduYWwsIG9yIHVuZGVmaW5lZCB3aGVuIG5vbmUgaXMgc2V0LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCkge1xuICBjb25zdCBjb25maWd1cmVkU2lnbmFsID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsKClcbiAgICA6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsXG5cbiAgcmV0dXJuIGNvbmZpZ3VyZWRTaWduYWwgfHwgdW5kZWZpbmVkXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgcGVyLXN0YXJ0dXAgY29udHJvbHMgd2l0aCB0aGUgY29uZmlndXJlZCBzZXNzaW9uIGNhbmNlbGxhdGlvbi5cbiAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWx9fSBjb250cm9scyAtIENhbGwgY29udHJvbHMuXG4gKiBAcmV0dXJucyB7e3RpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWx9fSAtIEVmZmVjdGl2ZSBzdGFydHVwIGNvbnRyb2xzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKGNvbnRyb2xzKSB7XG4gIGNvbnN0IHNlc3Npb25TaWduYWwgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKClcbiAgbGV0IHNpZ25hbCA9IGNvbnRyb2xzLnNpZ25hbCB8fCBzZXNzaW9uU2lnbmFsXG5cbiAgaWYgKGNvbnRyb2xzLnNpZ25hbCAmJiBzZXNzaW9uU2lnbmFsICYmIGNvbnRyb2xzLnNpZ25hbCAhPT0gc2Vzc2lvblNpZ25hbCkge1xuICAgIHNpZ25hbCA9IEFib3J0U2lnbmFsLmFueShbY29udHJvbHMuc2lnbmFsLCBzZXNzaW9uU2lnbmFsXSlcbiAgfVxuXG4gIGNvbnN0IGNvbmZpZ3VyZWRUaW1lb3V0TXMgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKClcbiAgY29uc3QgdGltZW91dE1zID0gY29udHJvbHMudGltZW91dE1zID09PSB1bmRlZmluZWRcbiAgICA/IGNvbmZpZ3VyZWRUaW1lb3V0TXNcbiAgICA6IGNvbmZpZ3VyZWRUaW1lb3V0TXMgPT09IHVuZGVmaW5lZFxuICAgICAgPyBjb250cm9scy50aW1lb3V0TXNcbiAgICAgIDogTWF0aC5taW4oY29udHJvbHMudGltZW91dE1zLCBjb25maWd1cmVkVGltZW91dE1zKVxuXG4gIHJldHVybiB7c2lnbmFsLCB0aW1lb3V0TXN9XG59XG5cbi8qKlxuICogUnVucyBwZXJmb3JtIHNoYXJlZCBmcm9udGVuZCBtb2RlbCBhcGkgcmVxdWVzdC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByZXF1ZXN0UGF5bG9hZCAtIFNoYXJlZCByZXF1ZXN0IHBheWxvYWQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIERlY29kZWQgc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSByZXNwb25zZS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcGVyZm9ybVNoYXJlZEZyb250ZW5kTW9kZWxBcGlSZXF1ZXN0KHJlcXVlc3RQYXlsb2FkKSB7XG4gIGNvbnN0IHRpbWVab25lID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKClcbiAgY29uc3Qgc2VyaWFsaXplZFJlcXVlc3RQYXlsb2FkID0gc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHJlcXVlc3RQYXlsb2FkLCB7dGltZVpvbmV9KVxuICBjb25zdCB3ZWJzb2NrZXRDbGllbnQgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudFxuICBjb25zdCB1cmwgPSBmcm9udGVuZE1vZGVsQXBpVXJsKClcbiAgY29uc3QgbWVyZ2VkSGVhZGVycyA9IGZyb250ZW5kTW9kZWxSZXF1ZXN0SGVhZGVycyh0aW1lWm9uZSlcblxuICByZXR1cm4gYXdhaXQgcnVuV2l0aFRyYW5zcG9ydERlYWRsaW5lKFxuICAgIHtcbiAgICAgIGVycm9yTWVzc2FnZTogXCJTaGFyZWQgZnJvbnRlbmQgbW9kZWwgQVBJIHJlcXVlc3QgdGltZWQgb3V0XCIsXG4gICAgICBzaWduYWw6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSxcbiAgICAgIHRpbWVvdXRNczogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVvdXRNcygpXG4gICAgfSxcbiAgICBhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICBpZiAod2Vic29ja2V0Q2xpZW50KSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgd2Vic29ja2V0Q2xpZW50LnBvc3QoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFBhdGgodXJsKSwgc2VyaWFsaXplZFJlcXVlc3RQYXlsb2FkLCB7XG4gICAgICAgICAgaGVhZGVyczogbWVyZ2VkSGVhZGVycyxcbiAgICAgICAgICBzaWduYWxcbiAgICAgICAgfSlcbiAgICAgICAgY29uc3QgcmVzcG9uc2VKc29uID0gcmVzcG9uc2UuanNvbigpXG5cbiAgICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocmVzcG9uc2VKc29uKSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoc2VyaWFsaXplZFJlcXVlc3RQYXlsb2FkKSxcbiAgICAgICAgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiLFxuICAgICAgICBoZWFkZXJzOiBtZXJnZWRIZWFkZXJzLFxuICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICBzaWduYWxcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlVGV4dCA9IGF3YWl0IHJlc3BvbnNlLnRleHQoKVxuXG4gICAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICAgIHRocm93RnJvbnRlbmRNb2RlbEh0dHBFcnJvcih7XG4gICAgICAgICAgY29tbWFuZExhYmVsOiBcInNoYXJlZCBmcm9udGVuZCBtb2RlbCBBUElcIixcbiAgICAgICAgICByZXNwb25zZSxcbiAgICAgICAgICByZXNwb25zZVRleHRcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgY29uc3QganNvbiA9IHJlc3BvbnNlVGV4dC5sZW5ndGggPiAwID8gSlNPTi5wYXJzZShyZXNwb25zZVRleHQpIDoge31cblxuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoanNvbikpXG4gICAgfVxuICApXG59XG5cbi8qKlxuICogVGhyb3dzIGEgZnJvbnRlbmQtbW9kZWwgSFRUUCBlcnJvciB3aXRoIGJhY2tlbmQtcHJvdmlkZWQgZW52ZWxvcGUgZGV0YWlscyB3aGVuIGF2YWlsYWJsZS5cbiAqIEBwYXJhbSB7e2NvbW1hbmRMYWJlbDogc3RyaW5nLCByZXNwb25zZTogUmVzcG9uc2UsIHJlc3BvbnNlVGV4dDogc3RyaW5nfX0gYXJncyAtIEVycm9yIHJlc3BvbnNlIGRldGFpbHMuXG4gKiBAcmV0dXJucyB7bmV2ZXJ9IC0gQWx3YXlzIHRocm93cyBhbiB1bmtub3duLWF0dHJpYnV0ZSBlcnJvci5cbiAqL1xuZnVuY3Rpb24gdGhyb3dGcm9udGVuZE1vZGVsSHR0cEVycm9yKHtjb21tYW5kTGFiZWwsIHJlc3BvbnNlLCByZXNwb25zZVRleHR9KSB7XG4gIC8vIFN1cmZhY2UgdGhlIGJhY2tlbmQncyBmcmllbmRseSBlcnJvck1lc3NhZ2UgZW52ZWxvcGUgKHRoZVxuICAvLyBge3N0YXR1czogXCJlcnJvclwiLCBlcnJvck1lc3NhZ2U6IFwiLi4uXCJ9YCBzaGFwZSBldmVyeSBjb250cm9sbGVyXG4gIC8vIHNoaXBzIG9uIGl0cyA0eHgvNXh4IHJlc3BvbnNlcykgaW5zdGVhZCBvZiB0aGUgZ2VuZXJpYyBzdGF0dXNcbiAgLy8gc3RyaW5nLiBGYWxsIHRocm91Z2ggdG8gdGhlIHN0YXR1cy1vbmx5IG1lc3NhZ2Ugd2hlbiB0aGUgYm9keSBpc1xuICAvLyBtaXNzaW5nLCBub24tSlNPTiwgb3IgaGFzIG5vIHVzYWJsZSBlcnJvck1lc3NhZ2UgZmllbGQuXG4gIGNvbnN0IHJlc3BvbnNlQ29udGVudFR5cGUgPSByZXNwb25zZS5oZWFkZXJzLmdldChcImNvbnRlbnQtdHlwZVwiKVxuXG4gIGlmIChyZXNwb25zZUNvbnRlbnRUeXBlICYmIHJlc3BvbnNlQ29udGVudFR5cGUuaW5jbHVkZXMoXCJhcHBsaWNhdGlvbi9qc29uXCIpICYmIHJlc3BvbnNlVGV4dC5sZW5ndGggPiAwKSB7XG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBlcnJvckJvZHkuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9ICovXG4gICAgbGV0IGVycm9yQm9keVxuXG4gICAgdHJ5IHtcbiAgICAgIGVycm9yQm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2VUZXh0KVxuICAgIH0gY2F0Y2gge1xuICAgICAgZXJyb3JCb2R5ID0gbnVsbFxuICAgIH1cblxuICAgIGlmIChlcnJvckJvZHkgJiYgdHlwZW9mIGVycm9yQm9keS5lcnJvck1lc3NhZ2UgPT09IFwic3RyaW5nXCIgJiYgZXJyb3JCb2R5LmVycm9yTWVzc2FnZS50cmltKCkubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yQm9keS5lcnJvck1lc3NhZ2UudHJpbSgpKVxuICAgIH1cbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihgUmVxdWVzdCBmYWlsZWQgKCR7cmVzcG9uc2Uuc3RhdHVzfSkgZm9yICR7Y29tbWFuZExhYmVsfWApXG59XG5cbi8qKlxuICogUnVucyBmbHVzaCBwZW5kaW5nIHNoYXJlZCBmcm9udGVuZCBtb2RlbCByZXF1ZXN0cy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHBlbmRpbmcgc2hhcmVkIGZyb250ZW5kLW1vZGVsIHJlcXVlc3RzIGZsdXNoLlxuICovXG5hc3luYyBmdW5jdGlvbiBmbHVzaFBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMoKSB7XG4gIHNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZCA9IGZhbHNlXG5cbiAgaWYgKHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMubGVuZ3RoIDwgMSkge1xuICAgIHJlc29sdmVGcm9udGVuZE1vZGVsSWRsZVdhaXRlcnMoKVxuICAgIHJldHVyblxuICB9XG5cbiAgY29uc3QgYmF0Y2hlZFJlcXVlc3RzID0gcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0c1xuICBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzID0gW11cblxuICBjb25zdCB1cmwgPSBmcm9udGVuZE1vZGVsQXBpVXJsKClcbiAgY29uc3QgcmVxdWVzdFBheWxvYWQgPSB7XG4gICAgcmVxdWVzdHM6IGJhdGNoZWRSZXF1ZXN0cy5tYXAoKHJlcXVlc3QpID0+IHtcbiAgICAgIGlmIChyZXF1ZXN0LmN1c3RvbVBhdGgpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kVHlwZTogcmVxdWVzdC5jb21tYW5kVHlwZSxcbiAgICAgICAgICBjdXN0b21QYXRoOiByZXF1ZXN0LmN1c3RvbVBhdGgsXG4gICAgICAgICAgbW9kZWw6IHJlcXVlc3QubW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgICBwYXlsb2FkOiByZXF1ZXN0LnBheWxvYWQsXG4gICAgICAgICAgLi4uKE9iamVjdC5rZXlzKHJlcXVlc3QucmVxdWVzdENvbnRleHQpLmxlbmd0aCA+IDAgPyB7cmVxdWVzdENvbnRleHQ6IHJlcXVlc3QucmVxdWVzdENvbnRleHR9IDoge30pLFxuICAgICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdC5yZXF1ZXN0SWRcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb21tYW5kVHlwZTogcmVxdWVzdC5jb21tYW5kVHlwZSxcbiAgICAgICAgbW9kZWw6IHJlcXVlc3QubW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgcGF5bG9hZDogcmVxdWVzdC5wYXlsb2FkLFxuICAgICAgICAuLi4oT2JqZWN0LmtleXMocmVxdWVzdC5yZXF1ZXN0Q29udGV4dCkubGVuZ3RoID4gMCA/IHtyZXF1ZXN0Q29udGV4dDogcmVxdWVzdC5yZXF1ZXN0Q29udGV4dH0gOiB7fSksXG4gICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdC5yZXF1ZXN0SWRcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgYXdhaXQgdHJhY2tGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdChhc3luYyAoKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIHZvaWQgdXJsXG4gICAgICBjb25zdCBkZWNvZGVkUmVzcG9uc2UgPSBhd2FpdCBwZXJmb3JtU2hhcmVkRnJvbnRlbmRNb2RlbEFwaVJlcXVlc3QocmVxdWVzdFBheWxvYWQpXG4gICAgICBjb25zdCByZXNwb25zZXMgPSBBcnJheS5pc0FycmF5KGRlY29kZWRSZXNwb25zZS5yZXNwb25zZXMpID8gZGVjb2RlZFJlc3BvbnNlLnJlc3BvbnNlcyA6IFtdXG4gICAgICBjb25zdCByZXNwb25zZXNCeUlkID0gbmV3IE1hcChyZXNwb25zZXMubWFwKChlbnRyeSkgPT4gW2VudHJ5LnJlcXVlc3RJZCwgZW50cnkucmVzcG9uc2VdKSlcblxuICAgICAgZm9yIChjb25zdCByZXF1ZXN0IG9mIGJhdGNoZWRSZXF1ZXN0cykge1xuICAgICAgICBjb25zdCByZXNwb25zZVBheWxvYWQgPSByZXNwb25zZXNCeUlkLmdldChyZXF1ZXN0LnJlcXVlc3RJZClcblxuICAgICAgICBpZiAoIXJlc3BvbnNlUGF5bG9hZCB8fCB0eXBlb2YgcmVzcG9uc2VQYXlsb2FkICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICAgICAgcmVxdWVzdC5yZWplY3QobmV3IEVycm9yKGBNaXNzaW5nIGJhdGNoZWQgcmVzcG9uc2UgZm9yICR7cmVxdWVzdC5tb2RlbENsYXNzLm5hbWV9IyR7cmVxdWVzdC5jb21tYW5kVHlwZX1gKSlcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgcmVxdWVzdC5yZXNvbHZlKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocmVzcG9uc2VQYXlsb2FkKSlcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZm9yIChjb25zdCByZXF1ZXN0IG9mIGJhdGNoZWRSZXF1ZXN0cykge1xuICAgICAgICByZXF1ZXN0LnJlamVjdChlcnJvcilcbiAgICAgIH1cbiAgICB9XG4gIH0pXG59XG5cbi8qKlxuICogUnVucyBzY2hlZHVsZSBzaGFyZWQgZnJvbnRlbmQgbW9kZWwgcmVxdWVzdCBmbHVzaC5cbiAqIEByZXR1cm5zIHt2b2lkfSAqL1xuZnVuY3Rpb24gc2NoZWR1bGVTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdEZsdXNoKCkge1xuICBpZiAoc2hhcmVkRnJvbnRlbmRNb2RlbEZsdXNoU2NoZWR1bGVkKSByZXR1cm5cblxuICBzaGFyZWRGcm9udGVuZE1vZGVsRmx1c2hTY2hlZHVsZWQgPSB0cnVlXG4gIHF1ZXVlTWljcm90YXNrKCgpID0+IHtcbiAgICB2b2lkIGZsdXNoUGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cygpXG4gIH0pXG59XG5cbi8qKlxuICogQ3VzdG9tIGNvbW1hbmRzIHN0aWxsIHVzZSB0aGUgc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSS4gVGhpcyBoZWxwZXIgb25seSBidWlsZHMgdGhlIGJhY2tlbmQgcm91dGUgcGF0aCB0aGUgc2VydmVyIHNob3VsZCBkaXNwYXRjaCBhZnRlciB2YWxpZGF0aW5nIHRoZSBzZWdtZW50cy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29tbWFuZE5hbWUgLSBDb21tYW5kIHBhdGggc2VnbWVudC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1vZGVsTmFtZSAtIEZyb250ZW5kIG1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IFthcmdzLm1lbWJlcklkXSAtIE9wdGlvbmFsIG1lbWJlciBpZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlUGF0aCAtIFJlc291cmNlIHBhdGggcHJlZml4LlxuICogQHJldHVybnMge3N0cmluZ30gLSBDdXN0b20gYmFja2VuZCByb3V0ZSBwYXRoLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZFBhdGgoe2NvbW1hbmROYW1lLCBtZW1iZXJJZCwgbW9kZWxOYW1lLCByZXNvdXJjZVBhdGh9KSB7XG4gIGNvbnN0IHZhbGlkYXRlZFJlc291cmNlUGF0aCA9IHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aCh7bW9kZWxOYW1lLCByZXNvdXJjZVBhdGh9KVxuICBjb25zdCB2YWxpZGF0ZWRDb21tYW5kTmFtZSA9IHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWUoe2NvbW1hbmROYW1lLCBjb21tYW5kVHlwZTogY29tbWFuZE5hbWUsIG1vZGVsTmFtZX0pXG5cbiAgaWYgKG1lbWJlcklkID09PSB1bmRlZmluZWQgfHwgbWVtYmVySWQgPT09IG51bGwgfHwgbWVtYmVySWQgPT09IFwiXCIpIHtcbiAgICByZXR1cm4gYCR7dmFsaWRhdGVkUmVzb3VyY2VQYXRofS8ke3ZhbGlkYXRlZENvbW1hbmROYW1lfWBcbiAgfVxuXG4gIHJldHVybiBgJHt2YWxpZGF0ZWRSZXNvdXJjZVBhdGh9LyR7ZW5jb2RlVVJJQ29tcG9uZW50KFN0cmluZyhtZW1iZXJJZCkpfS8ke3ZhbGlkYXRlZENvbW1hbmROYW1lfWBcbn1cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBmaW5kIGJ5IGNvbmRpdGlvbnMgc2hhcGUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjb25kaXRpb25zIC0gZmluZEJ5IGNvbmRpdGlvbnMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0RmluZEJ5Q29uZGl0aW9uc1NoYXBlKGNvbmRpdGlvbnMpIHtcbiAgaWYgKCFjb25kaXRpb25zIHx8IHR5cGVvZiBjb25kaXRpb25zICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoY29uZGl0aW9ucykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBleHBlY3RzIGNvbmRpdGlvbnMgdG8gYmUgYSBwbGFpbiBvYmplY3QsIGdvdDogJHtjb25kaXRpb25zfWApXG4gIH1cblxuICBjb25zdCBjb25kaXRpb25zUHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGNvbmRpdGlvbnMpXG5cbiAgaWYgKGNvbmRpdGlvbnNQcm90b3R5cGUgIT09IE9iamVjdC5wcm90b3R5cGUgJiYgY29uZGl0aW9uc1Byb3RvdHlwZSAhPT0gbnVsbCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGV4cGVjdHMgY29uZGl0aW9ucyB0byBiZSBhIHBsYWluIG9iamVjdCwgZ290OiAke2NvbmRpdGlvbnN9YClcbiAgfVxuXG4gIGNvbnN0IHN5bWJvbEtleXMgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlTeW1ib2xzKGNvbmRpdGlvbnMpXG5cbiAgaWYgKHN5bWJvbEtleXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgc3ltYm9sIGNvbmRpdGlvbiBrZXlzIChrZXlzOiAke3N5bWJvbEtleXMubWFwKChrZXkpID0+IGtleS50b1N0cmluZygpKS5qb2luKFwiLCBcIil9KWApXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBkZWZpbmVkIGZpbmQgYnkgY29uZGl0aW9uIHZhbHVlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDb25kaXRpb24gdmFsdWUgdG8gdmFsaWRhdGUuXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5UGF0aCAtIEtleSBwYXRoIGZvciBlcnJvciBvdXRwdXQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0RGVmaW5lZEZpbmRCeUNvbmRpdGlvblZhbHVlKHZhbHVlLCBrZXlQYXRoKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCB1bmRlZmluZWQgY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IGZ1bmN0aW9uIGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzeW1ib2xcIikge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgc3ltYm9sIGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJiaWdpbnRcIikge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgYmlnaW50IGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiAhTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgbm9uLWZpbml0ZSBudW1iZXIgY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICB2YWx1ZS5mb3JFYWNoKChlbnRyeSwgaW5kZXgpID0+IHtcbiAgICAgIGFzc2VydERlZmluZWRGaW5kQnlDb25kaXRpb25WYWx1ZShlbnRyeSwgYCR7a2V5UGF0aH1bJHtpbmRleH1dYClcbiAgICB9KVxuICAgIHJldHVyblxuICB9XG5cbiAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIikge1xuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IG9iamVjdFZhbHVlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh2YWx1ZSlcbiAgICBjb25zdCBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2Yob2JqZWN0VmFsdWUpXG5cbiAgICBpZiAocHJvdG90eXBlICE9PSBPYmplY3QucHJvdG90eXBlICYmIHByb3RvdHlwZSAhPT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBub24tcGxhaW4gb2JqZWN0IGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICAgIH1cblxuICAgIGNvbnN0IHN5bWJvbEtleXMgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlTeW1ib2xzKG9iamVjdFZhbHVlKVxuXG4gICAgaWYgKHN5bWJvbEtleXMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBzeW1ib2wgY29uZGl0aW9uIGtleXMgKGtleTogJHtrZXlQYXRofSlgKVxuICAgIH1cblxuICAgIGNvbnN0IHZhbHVlT2JqZWN0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh2YWx1ZSlcblxuICAgIE9iamVjdC5rZXlzKHZhbHVlT2JqZWN0KS5mb3JFYWNoKChuZXN0ZWRLZXkpID0+IHtcbiAgICAgIGFzc2VydERlZmluZWRGaW5kQnlDb25kaXRpb25WYWx1ZSh2YWx1ZU9iamVjdFtuZXN0ZWRLZXldLCBgJHtrZXlQYXRofS4ke25lc3RlZEtleX1gKVxuICAgIH0pXG4gIH1cbn1cblxuLyoqXG4gKiBCYXNlIGZyb250ZW5kIG1vZGVsLlxuICpcbiAqIERlZmF1bHRzIGFyZSBgYW55YCBzbyB0aGUgYmFyZSBgRnJvbnRlbmRNb2RlbEJhc2VgIOKAlCB1c2VkIHRocm91Z2hvdXQgYXMgYVxuICogY29uc3RyYWludC9wYXJhbWV0ZXIgdHlwZSBmb3IgXCJhbnkgZnJvbnRlbmQgbW9kZWxcIiDigJQgYWNjZXB0cyBnZW5lcmF0ZWRcbiAqIHN1YmNsYXNzZXMgZGVjbGFyaW5nIHR5cGVkLWF0dHJpYnV0ZSBnZW5lcmljcyAoYEZyb250ZW5kTW9kZWxCYXNlPFhBdHRyaWJ1dGVzLFxuICogLi4uPmApLiBBIGNvbmNyZXRlIGBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+YCBkZWZhdWx0IG1ha2VzXG4gKiB0aG9zZSBzdWJjbGFzc2VzIGZhaWwgYnkgaW52YXJpYW5jZS4gU3ViY2xhc3NlcyBzdGlsbCBwYXNzIHRoZWlyIHByZWNpc2VcbiAqIGF0dHJpYnV0ZSB0eXBlZGVmcywgc28gdHlwZWQgYWNjZXNzb3JzIGtlZXAgdGhlaXIgcHJlY2lzaW9uLlxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtBdHRyaWJ1dGVzPWFueV1cbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbQ3JlYXRlQXR0cmlidXRlcz1hbnldXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW1VwZGF0ZUF0dHJpYnV0ZXM9YW55XVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBGcm9udGVuZE1vZGVsQmFzZSB7XG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBtb2RlbE5hbWVcblxuICAvKipcbiAgICogQXV0b2xvYWQuXG4gICAqIEB0eXBlIHtib29sZWFufSAtIEdsb2JhbCBhdXRvLWJhdGNoLXByZWxvYWQgdG9nZ2xlLiBBcHBzIGNhbiBvcHQgb3V0IHZpYSBGcm9udGVuZE1vZGVsQmFzZS5zZXRBdXRvbG9hZChmYWxzZSkuXG4gICAqL1xuICBzdGF0aWMgX2F1dG9sb2FkID0gdHJ1ZVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdXRvbG9hZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgYXV0by1iYXRjaC1wcmVsb2FkIG9mIHJlbGF0aW9uc2hpcHMgb24gbGF6eSBhY2Nlc3MgaXMgZW5hYmxlZCBnbG9iYWxseS5cbiAgICovXG4gIHN0YXRpYyBnZXRBdXRvbG9hZCgpIHsgcmV0dXJuIEZyb250ZW5kTW9kZWxCYXNlLl9hdXRvbG9hZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGF1dG9sb2FkLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld1ZhbHVlIC0gV2hldGhlciBhdXRvLWJhdGNoLXByZWxvYWQgb2YgcmVsYXRpb25zaGlwcyBpcyBlbmFibGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBzZXRBdXRvbG9hZChuZXdWYWx1ZSkgeyBGcm9udGVuZE1vZGVsQmFzZS5fYXV0b2xvYWQgPSBuZXdWYWx1ZSB9XG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovXG4gIF9hdHRyaWJ1dGVzXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcDxGcm9udGVuZE1vZGVsQmFzZSwgRnJvbnRlbmRNb2RlbEJhc2UsIFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4+IHwgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwPEZyb250ZW5kTW9kZWxCYXNlLCBGcm9udGVuZE1vZGVsQmFzZSwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPj4+fSAqL1xuICBfcmVsYXRpb25zaGlwc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGU+fSAqL1xuICBfYXR0YWNobWVudHNcbiAgLyoqXG4gICAqIFJhaWxzLXN0eWxlIG5lc3RlZCBhdHRyaWJ1dGUgcGF5bG9hZHMgcXVldWVkIGZvciB0aGUgbmV4dCBzYXZlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fVxuICAgKi9cbiAgX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtTZXQ8c3RyaW5nPiB8IG51bGx9ICovXG4gIF9zZWxlY3RlZEF0dHJpYnV0ZXNcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gIF9pc05ld1JlY29yZFxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgX21hcmtlZEZvckRlc3RydWN0aW9uXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqL1xuICBfcGVyc2lzdGVkQXR0cmlidXRlc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+IHwgdW5kZWZpbmVkfSAtIFNoYXJlZCByZWZlcmVuY2UgdG8gc2libGluZyByZWNvcmRzIGxvYWRlZCBpbiB0aGUgc2FtZSBiYXRjaC4gVXNlZCBieSBhdXRvLWJhdGNoLXByZWxvYWQuXG4gICAqL1xuICBfbG9hZENvaG9ydFxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0F0dHJpYnV0ZXMgfCBDcmVhdGVBdHRyaWJ1dGVzfSBbYXR0cmlidXRlc10gLSBJbml0aWFsIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihhdHRyaWJ1dGVzKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuXG4gICAgTW9kZWxDbGFzcy5lbnN1cmVHZW5lcmF0ZWRBdHRhY2htZW50TWV0aG9kcygpXG4gICAgdGhpcy5fYXR0cmlidXRlcyA9IHt9XG4gICAgdGhpcy5fcmVsYXRpb25zaGlwcyA9IHt9XG4gICAgdGhpcy5fYXR0YWNobWVudHMgPSB7fVxuICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICB0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMgPSBudWxsXG4gICAgdGhpcy5faXNOZXdSZWNvcmQgPSB0cnVlXG4gICAgdGhpcy5fbWFya2VkRm9yRGVzdHJ1Y3Rpb24gPSBmYWxzZVxuICAgIHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIGlmIChhdHRyaWJ1dGVzKSB0aGlzLmFzc2lnbkF0dHJpYnV0ZXMoYXR0cmlidXRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBnZW5lcmF0ZWQgYXR0YWNobWVudCBtZXRob2RzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBFbnN1cmVzIGF0dGFjaG1lbnQgaGVscGVyIG1ldGhvZHMgZXhpc3Qgb24gdGhlIHByb3RvdHlwZS5cbiAgICovXG4gIHN0YXRpYyBlbnN1cmVHZW5lcmF0ZWRBdHRhY2htZW50TWV0aG9kcygpIHtcbiAgICBpZiAodGhpcy5fZ2VuZXJhdGVkQXR0YWNobWVudE1ldGhvZHMpIHJldHVyblxuXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB0aGlzLmF0dGFjaG1lbnREZWZpbml0aW9ucygpXG4gICAgY29uc3QgcHJvdG90eXBlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0aGlzLnByb3RvdHlwZSlcblxuICAgIGZvciAoY29uc3QgYXR0YWNobWVudE5hbWUgb2YgT2JqZWN0LmtleXMoYXR0YWNobWVudHMpKSB7XG4gICAgICBpZiAoIShhdHRhY2htZW50TmFtZSBpbiBwcm90b3R5cGUpKSB7XG4gICAgICAgIHByb3RvdHlwZVthdHRhY2htZW50TmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fZ2VuZXJhdGVkQXR0YWNobWVudE1ldGhvZHMgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd9IC0gUmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJyZXNvdXJjZUNvbmZpZygpIG11c3QgYmUgaW1wbGVtZW50ZWQgYnkgc3ViY2xhc3Nlc1wiKVxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby11bnJlYWNoYWJsZVxuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIG1vZGVsIGNsYXNzZXMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQ2xhc3MgfCBzdHJpbmc+fSAtIFJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzc2VzIChvciBjbGFzcyBuYW1lIHN0cmluZ3MpIGtleWVkIGJ5IHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIHJlbGF0aW9uc2hpcE1vZGVsQ2xhc3NlcygpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlciBhIGZyb250ZW5kIG1vZGVsIGNsYXNzIHNvIGl0IGNhbiBiZSByZXNvbHZlZCBieSBuYW1lIGluIHJlbGF0aW9uc2hpcCBsb29rdXBzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIHJlZ2lzdGVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyByZWdpc3Rlck1vZGVsKG1vZGVsQ2xhc3MpIHtcbiAgICByZWdpc3RlckZyb250ZW5kTW9kZWwobW9kZWxDbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlZmluZSBzY29wZS5cbiAgICogQHBhcmFtIHsoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gY2FsbGJhY2sgLSBTY29wZSBjYWxsYmFjay5cbiAgICogQHJldHVybnMgeygoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8RnJvbnRlbmRNb2RlbENsYXNzPikgJiB7c2NvcGU6ICguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCIpLk1vZGVsU2NvcGVEZXNjcmlwdG9yfX0gLSBTY29wZSBoZWxwZXIuXG4gICAqL1xuICBzdGF0aWMgZGVmaW5lU2NvcGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gZGVmaW5lTW9kZWxTY29wZSh7XG4gICAgICBjYWxsYmFjayxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICBzdGFydFF1ZXJ5OiAoKSA9PiB0aGlzLnF1ZXJ5KClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmUgYSByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MgdmFsdWUgdGhhdCBtYXkgYmUgYSBjbGFzcyByZWZlcmVuY2Ugb3IgYSBzdHJpbmcgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIENsYXNzIG9yIGNsYXNzIG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBudWxsfSAtIFJlc29sdmVkIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIHJlc29sdmVNb2RlbENsYXNzKHZhbHVlKSB7XG4gICAgcmV0dXJuIHJlc29sdmVGcm9udGVuZE1vZGVsQ2xhc3ModmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbnMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB7dHlwZTogXCJiZWxvbmdzVG9cIiB8IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIiwgYXV0b2xvYWQ/OiBib29sZWFufT59IC0gUmVsYXRpb25zaGlwIGRlZmluaXRpb25zIGtleWVkIGJ5IHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIHJlbGF0aW9uc2hpcERlZmluaXRpb25zKCkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNobWVudCBkZWZpbml0aW9ucy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRhY2htZW50RGVmaW5pdGlvbj59IC0gQXR0YWNobWVudCBkZWZpbml0aW9ucyBrZXllZCBieSBhdHRhY2htZW50IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgYXR0YWNobWVudERlZmluaXRpb25zKCkge1xuICAgIHJldHVybiB0aGlzLnJlc291cmNlQ29uZmlnKCkuYXR0YWNobWVudHMgfHwge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaG1lbnQgZGVmaW5pdGlvbi5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREZWZpbml0aW9uIHwgbnVsbH0gLSBBdHRhY2htZW50IGRlZmluaXRpb24uXG4gICAqL1xuICBzdGF0aWMgYXR0YWNobWVudERlZmluaXRpb24oYXR0YWNobWVudE5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5hdHRhY2htZW50RGVmaW5pdGlvbnMoKVthdHRhY2htZW50TmFtZV0gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIGRlZmluaXRpb24uXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHt7dHlwZTogXCJiZWxvbmdzVG9cIiB8IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIiwgYXV0b2xvYWQ/OiBib29sZWFufSB8IG51bGx9IC0gUmVsYXRpb25zaGlwIGRlZmluaXRpb24uXG4gICAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgZGVmaW5pdGlvbnMgPSB0aGlzLnJlbGF0aW9uc2hpcERlZmluaXRpb25zKClcblxuICAgIHJldHVybiBkZWZpbml0aW9uc1tyZWxhdGlvbnNoaXBOYW1lXSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBSYWlscy1zdHlsZSBuZXN0ZWQgYXR0cmlidXRlcyBrZXkgdG8gYSBjb25maWd1cmVkIHJlbGF0aW9uc2hpcC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBDYW5kaWRhdGUgYXR0cmlidXRlIG5hbWUsIHN1Y2ggYXMgYHRhc2tzQXR0cmlidXRlc2AuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSBSZWxhdGlvbnNoaXAgbmFtZSB3aGVuIG5lc3RlZCBhdHRyaWJ1dGVzIGFyZSBjb25maWd1cmVkLlxuICAgKi9cbiAgc3RhdGljIG5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAoIWF0dHJpYnV0ZU5hbWUuZW5kc1dpdGgoXCJBdHRyaWJ1dGVzXCIpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZSA9IGF0dHJpYnV0ZU5hbWUuc2xpY2UoMCwgLVwiQXR0cmlidXRlc1wiLmxlbmd0aClcbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZygpLm5lc3RlZEF0dHJpYnV0ZXMgfHwge31cblxuICAgIHJldHVybiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobmVzdGVkQXR0cmlidXRlc0NvbmZpZywgcmVsYXRpb25zaGlwTmFtZSlcbiAgICAgID8gcmVsYXRpb25zaGlwTmFtZVxuICAgICAgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBudWxsfSAtIFRhcmdldCByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzID0gdGhpcy5yZWxhdGlvbnNoaXBNb2RlbENsYXNzZXMoKVxuICAgIGNvbnN0IHZhbHVlID0gcmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICByZXR1cm4gRnJvbnRlbmRNb2RlbEJhc2UucmVzb2x2ZU1vZGVsQ2xhc3ModmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7QXR0cmlidXRlc30gLSBBdHRyaWJ1dGVzIGhhc2guXG4gICAqL1xuICBhdHRyaWJ1dGVzKCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0F0dHJpYnV0ZXN9ICovICh0aGlzLl9hdHRyaWJ1dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgbmV3IHJlY29yZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIG1vZGVsIGhhcyBub3QgeWV0IGJlZW4gcGVyc2lzdGVkLlxuICAgKi9cbiAgaXNOZXdSZWNvcmQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2lzTmV3UmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBwZXJzaXN0ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBtb2RlbCBoYXMgYmVlbiBwZXJzaXN0ZWQuXG4gICAqL1xuICBpc1BlcnNpc3RlZCgpIHtcbiAgICByZXR1cm4gIXRoaXMuaXNOZXdSZWNvcmQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGlzIG5ldyByZWNvcmQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbmV3SXNOZXdSZWNvcmQgLSBOZXcgcGVyc2lzdGVkLXN0YXRlIGZsYWcuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0SXNOZXdSZWNvcmQobmV3SXNOZXdSZWNvcmQpIHtcbiAgICB0aGlzLl9pc05ld1JlY29yZCA9IG5ld0lzTmV3UmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogTWFya3MgdGhpcyByZWNvcmQgZm9yIGRlc3RydWN0aW9uIHdoZW4gaXRzIHBhcmVudCBpcyBuZXh0IHNhdmVkIHRocm91Z2hcbiAgICogbmVzdGVkLWF0dHJpYnV0ZSBzdXBwb3J0LiBUaGUgcmVjb3JkIGlzIG5vdCByZW1vdmVkIGZyb20gdGhlIHBhcmVudCdzXG4gICAqIHJlbGF0aW9uc2hpcCBjb2xsZWN0aW9uIHVudGlsIHRoZSBzZXJ2ZXIgY29uZmlybXMgdGhlIGRlbGV0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgbWFya0ZvckRlc3RydWN0aW9uKCkge1xuICAgIHRoaXMuX21hcmtlZEZvckRlc3RydWN0aW9uID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFya2VkIGZvciBkZXN0cnVjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIHJlY29yZCBpcyBxdWV1ZWQgZm9yIG5lc3RlZCBkZXN0cnVjdGlvbiBvbiBuZXh0IHBhcmVudCBzYXZlLlxuICAgKi9cbiAgbWFya2VkRm9yRGVzdHJ1Y3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX21hcmtlZEZvckRlc3RydWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjaGFuZ2VzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBDaGFuZ2VkIGF0dHJpYnV0ZXMgYXMgYFtvbGRWYWx1ZSwgbmV3VmFsdWVdYC5cbiAgICovXG4gIGNoYW5nZXMoKSB7XG4gICAgLyoqXG4gICAgICogQ2hhbmdlZCBhdHRyaWJ1dGVzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IGNoYW5nZWRBdHRyaWJ1dGVzID0ge31cbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IG5ldyBTZXQoW1xuICAgICAgLi4uT2JqZWN0LmtleXModGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyksXG4gICAgICAuLi5PYmplY3Qua2V5cyh0aGlzLl9hdHRyaWJ1dGVzKVxuICAgIF0pXG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgYXR0cmlidXRlTmFtZXMpIHtcbiAgICAgIGNvbnN0IHByZXZpb3VzVmFsdWUgPSB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG4gICAgICBjb25zdCBjdXJyZW50VmFsdWUgPSB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICAgIGlmIChKU09OLnN0cmluZ2lmeShzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocHJldmlvdXNWYWx1ZSkpICE9PSBKU09OLnN0cmluZ2lmeShzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoY3VycmVudFZhbHVlKSkpIHtcbiAgICAgICAgY2hhbmdlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBbcHJldmlvdXNWYWx1ZSwgY3VycmVudFZhbHVlXVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjaGFuZ2VkQXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgY2hhbmdlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbnkgdHJhY2tlZCBhdHRyaWJ1dGUgaGFzIGNoYW5nZWQuXG4gICAqL1xuICBpc0NoYW5nZWQoKSB7XG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMuY2hhbmdlcygpKS5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVsYXRpb25zaGlwIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSAtIFJlbGF0aW9uc2hpcCBzdGF0ZSBvYmplY3QuXG4gICAqL1xuICBnZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGlmICghdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXSkge1xuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwRGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwRGVmaW5pdGlvbiAmJiByZWxhdGlvbnNoaXBUeXBlSXNDb2xsZWN0aW9uKHJlbGF0aW9uc2hpcERlZmluaXRpb24udHlwZSkpIHtcbiAgICAgICAgdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXSA9IG5ldyBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCh0aGlzLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXSA9IG5ldyBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXAodGhpcywgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzcylcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF0dGFjaG1lbnQgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGV9IC0gQXR0YWNobWVudCBoZWxwZXIuXG4gICAqL1xuICBnZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbihhdHRhY2htZW50TmFtZSlcblxuICAgIGlmICghYXR0YWNobWVudERlZmluaXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBhdHRhY2htZW50OiAke01vZGVsQ2xhc3MubmFtZX0jJHthdHRhY2htZW50TmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdKSB7XG4gICAgICB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0gPSBuZXcgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGUoe1xuICAgICAgICBhdHRhY2htZW50TmFtZSxcbiAgICAgICAgbW9kZWw6IHRoaXNcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxCYXNlIHwgQXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIGxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBpZCA9IHRoaXMucHJpbWFyeUtleVZhbHVlKClcbiAgICBjb25zdCByZWxvYWRlZE1vZGVsID0gYXdhaXQgTW9kZWxDbGFzc1xuICAgICAgLnByZWxvYWQoW3JlbGF0aW9uc2hpcE5hbWVdKVxuICAgICAgLmZpbmQoaWQpXG4gICAgY29uc3Qgc291cmNlUmVsYXRpb25zaGlwID0gcmVsb2FkZWRNb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICBjb25zdCB0YXJnZXRSZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgY29weUxvYWRlZFJlbGF0aW9uc2hpcFZhbHVlKHtzb3VyY2VSZWxhdGlvbnNoaXAsIHRhcmdldFJlbGF0aW9uc2hpcH0pXG5cbiAgICByZXR1cm4gdGFyZ2V0UmVsYXRpb25zaGlwLmxvYWRlZCgpXG4gIH1cblxuICAvKipcbiAgICogUHJlbG9hZHMgcmVsYXRpb25zaGlwKHMpIG9udG8gdGhpcyBhbHJlYWR5LWxvYWRlZCByZWNvcmQuIEFjY2VwdHMgZWl0aGVyIGFcbiAgICogcXVlcnkgYnVpbHQgdmlhIGBNb2RlbC5wcmVsb2FkKC4uLikuc2VsZWN0KC4uLilgIG9yIGEgcmF3IHByZWxvYWQgc3BlY1xuICAgKiAoc3RyaW5nIC8gYXJyYXkgLyBuZXN0ZWQgb2JqZWN0KS4gUmVsYXRpb25zaGlwcyBhbHJlYWR5IHByZWxvYWRlZCB3aXRoIHRoZVxuICAgKiByZXF1aXJlZCBjb2x1bW5zIHByZXNlbnQgYXJlIGxlZnQgdW50b3VjaGVkIHVubGVzcyBgZm9yY2VgIGlzIHNldC4gQ2Fycmllc1xuICAgKiB0aGUgcXVlcnkncyBwcmVsb2FkIGdyYXBoLCBzZWxlY3QsIHNlbGVjdHNFeHRyYSwgd2l0aENvdW50LCBhYmlsaXRpZXMsIGFuZFxuICAgKiBxdWVyeURhdGEgd2hlbiByZS1mZXRjaGluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8RnJvbnRlbmRNb2RlbENsYXNzPiB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBzdHJpbmcgfCBBcnJheTxzdHJpbmcgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkPn0gcXVlcnlPclNwZWMgLSBQcmVsb2FkIHNvdXJjZS5cbiAgICogQHBhcmFtIHt7Zm9yY2U/OiBib29sZWFufX0gW29wdGlvbnNdIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwcmVsb2FkaW5nIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIHByZWxvYWQocXVlcnlPclNwZWMsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IEZyb250ZW5kTW9kZWxQcmVsb2FkZXIucHJlbG9hZChbdGhpc10sIHF1ZXJ5T3JTcGVjLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIG9yIGxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxCYXNlIHwgQXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIHJlbGF0aW9uc2hpcE9yTG9hZChyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIHtcbiAgICAgIHJldHVybiByZWxhdGlvbnNoaXAubG9hZGVkKClcbiAgICB9XG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5fdHJ5Q29ob3J0UHJlbG9hZChyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKGJhdGNoZWQpIHJldHVybiByZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRlbXB0cyB0byBiYXRjaC1sb2FkIGByZWxhdGlvbnNoaXBOYW1lYCBhY3Jvc3MgY29ob3J0IHNpYmxpbmdzIHZpYSBhXG4gICAqIHNpbmdsZSBgcHJlbG9hZChbbmFtZV0pLndoZXJlKHtwazogW2lkc119KS50b0FycmF5KClgIHJlcXVlc3QsIHRoZW4gY29waWVzXG4gICAqIHRoZSBwcmVsb2FkZWQgcmVsYXRpb25zaGlwIHN0YXRlIG9udG8gZWFjaCBzaWJsaW5nLiBSZXR1cm5zIHRydWUgd2hlbiBhXG4gICAqIGJhdGNoIHJhbiwgZmFsc2Ugd2hlbiBhdXRvbG9hZCBpcyBvZmYsIHRoZXJlIGlzIG5vIGNvaG9ydCwgb3Igbm8gYmF0Y2hcbiAgICogY2FuZGlkYXRlcyByZW1haW4uIFNpYmxpbmdzIHdob3NlIHJlbGF0aW9uc2hpcCBzdGF0ZSBpcyBhbHJlYWR5IHNldFxuICAgKiAocHJlbG9hZGVkIG9yIGxvY2FsbHkgbWFuaXB1bGF0ZWQgdmlhIGBidWlsZGAgLyBgc2V0UmVsYXRpb25zaGlwYCkgYXJlXG4gICAqIHNraXBwZWQgc28gdGhlaXIgY2FjaGVkL2VkaXRlZCB2YWx1ZSBpcyBwcmVzZXJ2ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYSBjb2hvcnQgYmF0Y2ggcHJlbG9hZCByYW4uXG4gICAqL1xuICBhc3luYyBfdHJ5Q29ob3J0UHJlbG9hZChyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgaWYgKCFGcm9udGVuZE1vZGVsQmFzZS5nZXRBdXRvbG9hZCgpKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBjb2hvcnQgPSB0aGlzLl9sb2FkQ29ob3J0XG5cbiAgICBpZiAoIWNvaG9ydCB8fCBjb2hvcnQubGVuZ3RoIDw9IDEpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgZGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKCFkZWZpbml0aW9uKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoZGVmaW5pdGlvbi5hdXRvbG9hZCA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuXG4gICAgLyoqXG4gICAgICogQmF0Y2guXG4gICAgICogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxCYXNlPn0gKi9cbiAgICBjb25zdCBiYXRjaCA9IFtdXG5cbiAgICAvLyBFeGFjdCBzYW1lIGNsYXNzLCBwZXJzaXN0ZWQsIG5vIGV4aXN0aW5nIGluLW1lbW9yeSByZWxhdGlvbnNoaXAgc3RhdGUuXG4gICAgLy8gYHNldExvYWRlZGAgc2V0cyBgX3ByZWxvYWRlZCA9IHRydWVgIG9uIGV2ZXJ5IG11dGF0aW9uIHBhdGggKHByZWxvYWQsXG4gICAgLy8gc2V0UmVsYXRpb25zaGlwLCBidWlsZCwgYWRkVG9Mb2FkZWQpLCBzbyBgZ2V0UHJlbG9hZGVkKClgIGFsb25lIGlzIGFcbiAgICAvLyByZWxpYWJsZSBcImFscmVhZHkgdG91Y2hlZFwiIHNpZ25hbCBvbiB0aGUgZnJvbnRlbmQuXG4gICAgZm9yIChjb25zdCBzaWJsaW5nIG9mIGNvaG9ydCkge1xuICAgICAgaWYgKHNpYmxpbmcuY29uc3RydWN0b3IgIT09IE1vZGVsQ2xhc3MpIGNvbnRpbnVlXG4gICAgICBpZiAoc2libGluZy5pc05ld1JlY29yZCgpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBzaWJsaW5nUmVsYXRpb25zaGlwID0gc2libGluZy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgICAgaWYgKHNpYmxpbmdSZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIGNvbnRpbnVlXG5cbiAgICAgIGJhdGNoLnB1c2goc2libGluZylcbiAgICB9XG5cbiAgICBpZiAoYmF0Y2gubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgYmF0Y2hJZHMgPSBiYXRjaC5tYXAoKHNpYmxpbmcpID0+IHNpYmxpbmcucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgY29uc3QgcmVsb2FkZWRCYXRjaCA9IGF3YWl0IE1vZGVsQ2xhc3NcbiAgICAgIC5wcmVsb2FkKFtyZWxhdGlvbnNoaXBOYW1lXSlcbiAgICAgIC53aGVyZSh7W3ByaW1hcnlLZXldOiBiYXRjaElkc30pXG4gICAgICAudG9BcnJheSgpXG5cbiAgICAvKipcbiAgICAgKiBSZWxvYWRlZCBieSBpZC5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgRnJvbnRlbmRNb2RlbEJhc2U+fSAqL1xuICAgIGNvbnN0IHJlbG9hZGVkQnlJZCA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCByZWxvYWRlZCBvZiByZWxvYWRlZEJhdGNoKSB7XG4gICAgICByZWxvYWRlZEJ5SWQuc2V0KG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHJlbG9hZGVkLnByaW1hcnlLZXlWYWx1ZSgpKSwgcmVsb2FkZWQpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzaWJsaW5nIG9mIGJhdGNoKSB7XG4gICAgICBjb25zdCBrZXkgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBzaWJsaW5nLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgICAgY29uc3QgcmVsb2FkZWQgPSByZWxvYWRlZEJ5SWQuZ2V0KGtleSlcblxuICAgICAgaWYgKCFyZWxvYWRlZCkgY29udGludWVcblxuICAgICAgY29weUxvYWRlZFJlbGF0aW9uc2hpcFZhbHVlKHtcbiAgICAgICAgc291cmNlUmVsYXRpb25zaGlwOiByZWxvYWRlZC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSksXG4gICAgICAgIHRhcmdldFJlbGF0aW9uc2hpcDogc2libGluZy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgLy8gSWYgdGhlIGNhbGxlciBpdHNlbGYgd2FzIG5vdCBwb3B1bGF0ZWQgKHJlY29yZCBkZWxldGVkL2ZpbHRlcmVkIGJldHdlZW5cbiAgICAvLyB0aGUgbGlzdCBmZXRjaCBhbmQgdGhpcyBwcmVsb2FkIHJlcXVlc3QpLCBmYWxsIGJhY2sgdG8gcGVyLXJlY29yZCBsb2FkXG4gICAgLy8gc28gdGhlIGNhbGxlciBnZXRzIGEgcmVhbCBub3QtZm91bmQgZXJyb3IgaW5zdGVhZCBvZiBhIG1pc2xlYWRpbmdcbiAgICAvLyBcImhhc24ndCBiZWVuIHByZWxvYWRlZFwiIHRocm93IGZyb20gbG9hZGVkKCkuXG4gICAgaWYgKCF0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKS5nZXRQcmVsb2FkZWQoKSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZSB8IG51bGwgfCB1bmRlZmluZWR9IHJlbGF0aW9uc2hpcFZhbHVlIC0gUmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEJhc2UgfCBudWxsIHwgdW5kZWZpbmVkfSAtIEFzc2lnbmVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIHNldFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBWYWx1ZSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCByZWxhdGlvbnNoaXBEZWZpbml0aW9uID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcERlZmluaXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biByZWxhdGlvbnNoaXA6ICR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBzZXQgaGFzLW1hbnkgcmVsYXRpb25zaGlwIHdpdGggc2V0UmVsYXRpb25zaGlwKCk6ICR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICByZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHJlbGF0aW9uc2hpcFZhbHVlKVxuXG4gICAgcmV0dXJuIHJlbGF0aW9uc2hpcFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhc3NpZ24gYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtBdHRyaWJ1dGVzIHwgQ3JlYXRlQXR0cmlidXRlcyB8IFVwZGF0ZUF0dHJpYnV0ZXMgfCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSBhdHRyaWJ1dGVzIC0gQXR0cmlidXRlcyB0byBhc3NpZ24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFzc2lnbkF0dHJpYnV0ZXMoYXR0cmlidXRlcykge1xuICAgIGNvbnN0IGF0dHJpYnV0ZVZhbHVlcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKGF0dHJpYnV0ZXMpXG5cbiAgICBmb3IgKGNvbnN0IGtleSBpbiBhdHRyaWJ1dGVWYWx1ZXMpIHtcbiAgICAgIHRoaXMuc2V0QXR0cmlidXRlKGtleSwgYXR0cmlidXRlVmFsdWVzW2tleV0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgcmVsYXRpb25zaGlwIGNhY2hlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBDbGVhcnMgY2FjaGVkIHJlbGF0aW9uc2hpcCBzdGF0ZS5cbiAgICovXG4gIGNsZWFyUmVsYXRpb25zaGlwQ2FjaGUoKSB7XG4gICAgdGhpcy5fcmVsYXRpb25zaGlwcyA9IHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmltYXJ5IGtleS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IC0gUHJpbWFyeSBrZXkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiB0aGlzLnJlc291cmNlQ29uZmlnKCkucHJpbWFyeUtleSB8fCBcImlkXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW1hcnkga2V5IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IC0gUHJpbWFyeSBrZXkgdmFsdWUuXG4gICAqL1xuICBwcmltYXJ5S2V5VmFsdWUoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgcmV0dXJuIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgY29uc3QgdmFsdWUgPSB0aGlzLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcblxuICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHByaW1hcnkga2V5ICcke2F0dHJpYnV0ZU5hbWV9JyBvbiAke01vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdmFsdWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGlkZW50aXR5IHJlcHJlc2VudGVkIGJ5IHRoZSBsYXN0IHBlcnNpc3RlZCBmcm9udGVuZCBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IC0gUGVyc2lzdGVkIHByaW1hcnkta2V5IHZhbHVlLlxuICAgKi9cbiAgcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcblxuICAgIHJldHVybiByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUocHJpbWFyeUtleSwgKGF0dHJpYnV0ZU5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuXG4gICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgcGVyc2lzdGVkIHByaW1hcnkga2V5ICcke2F0dHJpYnV0ZU5hbWV9JyBvbiAke01vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdmFsdWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBBdHRyaWJ1dGUgdmFsdWUuXG4gICAqL1xuICByZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAodGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzICYmICF0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMuaGFzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgQXR0cmlidXRlTm90U2VsZWN0ZWRFcnJvcih0aGlzLmNvbnN0cnVjdG9yLm5hbWUsIGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGFuIGF0dHJpYnV0ZSB2YWx1ZSBpcyBjdXJyZW50bHkgbG9hZGVkIG9uIHRoaXMgcmVjb3JkLiBVc2VkIGJ5IHRoZVxuICAgKiBwcmVsb2FkZXIgdG8gZGVjaWRlIHdoZXRoZXIgYSByZWxhdGlvbnNoaXAgY2FuIGJlIHNraXBwZWQgYmVjYXVzZSB0aGVcbiAgICogcmVxdWVzdGVkIGNvbHVtbnMgYXJlIGFscmVhZHkgcHJlc2VudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgYXR0cmlidXRlIGlzIGxvYWRlZC5cbiAgICovXG4gIGhhc0xvYWRlZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSB7XG4gICAgaWYgKCF0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gdGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzLmhhcyhhdHRyaWJ1dGVOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgYW4gYXNzb2NpYXRpb24gY291bnQgYXR0YWNoZWQgYnkgYC53aXRoQ291bnQoLi4uKWAuIENvdW50c1xuICAgKiBsaXZlIG9uIGEgZGVkaWNhdGVkIG1hcCBzZXBhcmF0ZSBmcm9tIHRoZSByZWNvcmQncyBhdHRyaWJ1dGVzIHNvXG4gICAqIGEgdmlydHVhbCBjb3VudCBsaWtlIGB0YXNrc0NvdW50YCBjYW4ndCBzaWxlbnRseSBzaGFkb3cgYSByZWFsXG4gICAqIGNvbHVtbiBvZiB0aGUgc2FtZSBuYW1lLiBSZXR1cm5zIHRoZSBhdHRhY2hlZCB2YWx1ZSwgb3IgMCB3aGVuXG4gICAqIGAud2l0aENvdW50KC4uLilgIHdhc24ndCByZXF1ZXN0ZWQgZm9yIHRoaXMgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLCBlLmcuIGBcInRhc2tzQ291bnRcImAgb3IgYSBjdXN0b20gbmFtZSBmcm9tIGAud2l0aENvdW50KHtjdXN0b21OYW1lOiB7Li4ufX0pYC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBBdHRhY2hlZCBhc3NvY2lhdGlvbiBjb3VudCwgb3IgemVybyB3aGVuIGFic2VudC5cbiAgICovXG4gIHJlYWRDb3VudChhdHRyaWJ1dGVOYW1lKSB7XG4gICAgcmV0dXJuIHJlYWRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBzZXR0ZXIgY2FsbGVkIGJ5IGBpbnN0YW50aWF0ZUZyb21SZXNwb25zZWAgd2hlbiBoeWRyYXRpbmdcbiAgICogYXNzb2NpYXRpb24gY291bnRzIHRoYXQgcm9kZSBhbG9uZyB3aXRoIHRoZSByZWNvcmQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gQ291bnQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldEFzc29jaWF0aW9uQ291bnQoYXR0cmlidXRlTmFtZSwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYXR0cmlidXRlTmFtZSwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhIHBlci1yZWNvcmQgYWJpbGl0eSByZXN1bHQgYXR0YWNoZWQgYnkgYC5hYmlsaXRpZXMoLi4uKWAuIFRoZVxuICAgKiBiYWNrZW5kIGV2YWx1YXRlcyBlYWNoIHJlcXVlc3RlZCBhY3Rpb24gYWdhaW5zdCB0aGUgY3VycmVudFxuICAgKiBhYmlsaXR5IGZvciB0aGlzIHJlY29yZCBpbnN0YW5jZSBhbmQgc2hpcHMgdGhlIHJlc3VsdCBhbG9uZ3NpZGVcbiAgICogdGhlIHJlY29yZCdzIGF0dHJpYnV0ZXMuIFJldHVybnMgYGZhbHNlYCB3aGVuIHRoZSBhY3Rpb24gd2Fzbid0XG4gICAqIHJlcXVlc3RlZCAob3IgdGhlIGFiaWxpdHkgZGVuaWVkIGl0KSwgc28gVUkgY29kZSBjYW4gc2FmZWx5IGJyYW5jaFxuICAgKiBvbiBgcmVjb3JkLmNhbihcInVwZGF0ZVwiKWAgd2l0aG91dCBmaXJzdCBjaGVja2luZyB3aGV0aGVyIHRoZVxuICAgKiBhYmlsaXR5IHdhcyBsb2FkZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbiBuYW1lLCBlLmcuIGBcInVwZGF0ZVwiYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVxdWVzdGVkIGFiaWxpdHkgaXMgYWxsb3dlZC5cbiAgICovXG4gIGNhbihhY3Rpb24pIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRDb21wdXRlZEFiaWxpdHkoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGFjdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBzZXR0ZXIgY2FsbGVkIGJ5IGBpbnN0YW50aWF0ZUZyb21SZXNwb25zZWAgd2hlbiBoeWRyYXRpbmdcbiAgICogcGVyLXJlY29yZCBhYmlsaXR5IHJlc3VsdHMgdGhhdCByb2RlIGFsb25nIHdpdGggdGhlIHJlY29yZFxuICAgKiBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24gbmFtZS5cbiAgICogQHBhcmFtIHtib29sZWFufSB2YWx1ZSAtIFdoZXRoZXIgdGhlIGN1cnJlbnQgYWJpbGl0eSBwZXJtaXRzIHRoZSBhY3Rpb24gb24gdGhpcyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldENvbXB1dGVkQWJpbGl0eShhY3Rpb24sIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZENvbXB1dGVkQWJpbGl0eSgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYWN0aW9uLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGEgY29uc3VtZXItZGVmaW5lZCB2YWx1ZSBhdHRhY2hlZCBieSBgLnF1ZXJ5RGF0YSguLi4pYC4gU3RvcmVkXG4gICAqIG9uIGEgZGVkaWNhdGVkIG1hcCByYXRoZXIgdGhhbiBgX2F0dHJpYnV0ZXNgLCBzbyBhIHZpcnR1YWwgYWxpYXNcbiAgICogbGlrZSBgdGFza3NDb3VudGAgY2Fubm90IHNpbGVudGx5IHNoYWRvdyBhIHJlYWwgY29sdW1uIG9mIHRoZSBzYW1lXG4gICAqIG5hbWUuIFJldHVybnMgYG51bGxgIHdoZW4gbm8gcmVnaXN0ZXJlZCBmbiBwcm9kdWNlZCB0aGF0IGFsaWFzIGZvclxuICAgKiB0aGlzIHJlY29yZCAoZS5nLiBubyBjaGlsZCByb3dzIG1hdGNoZWQgdGhlIGFnZ3JlZ2F0ZSkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gcXVlcnlEYXRhIGFsaWFzIG5hbWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBBdHRhY2hlZCBxdWVyeS1kYXRhIHZhbHVlLlxuICAgKi9cbiAgcXVlcnlEYXRhKG5hbWUpIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRRdWVyeURhdGEoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogSW50ZXJuYWwgc2V0dGVyIHVzZWQgYnkgYGluc3RhbnRpYXRlRnJvbVJlc3BvbnNlYCB3aGVuIGh5ZHJhdGluZ1xuICAgKiBxdWVyeURhdGEgdmFsdWVzIHRoYXQgcm9kZSBhbG9uZyB3aXRoIHRoZSByZWNvcmQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBxdWVyeURhdGEgYWxpYXMgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBBdHRhY2hlZCB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0UXVlcnlEYXRhKG5hbWUsIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZFF1ZXJ5RGF0YSgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgbmFtZSwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBuZXdWYWx1ZSAtIE5ldyB2YWx1ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEFzc2lnbmVkIHZhbHVlLlxuICAgKi9cbiAgc2V0QXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUsIG5ld1ZhbHVlKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lID0gTW9kZWxDbGFzcy5uZXN0ZWRBdHRyaWJ1dGVzUmVsYXRpb25zaGlwTmFtZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgaWYgKG5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgICB0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlc1tuZXN0ZWRBdHRyaWJ1dGVzUmVsYXRpb25zaGlwTmFtZV0gPSBuZXdWYWx1ZVxuICAgICAgcmV0dXJuIG5ld1ZhbHVlXG4gICAgfVxuXG4gICAgaWYgKE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24oYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIHRoaXMuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRyaWJ1dGVOYW1lKS5xdWV1ZUF0dGFjaChuZXdWYWx1ZSlcbiAgICAgIHJldHVybiBuZXdWYWx1ZVxuICAgIH1cblxuICAgIGNvbnN0IHByZXZpb3VzVmFsdWUgPSB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gbmV3VmFsdWVcblxuICAgIGlmICh0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgIHRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcy5hZGQoYXR0cmlidXRlTmFtZSlcbiAgICB9XG5cbiAgICAvLyBPbmx5IGludmFsaWRhdGUgcmVsYXRpb25zaGlwIGNhY2hlIGVudHJpZXMgd2hvc2UgZm9yZWlnbiBrZXkgbWF0Y2hlcyB0aGUgY2hhbmdlZCBhdHRyaWJ1dGUuXG4gICAgLy8gQmxhbmtldC1jbGVhcmluZyBhbGwgcmVsYXRpb25zaGlwcyBvbiBhbnkgYXR0cmlidXRlIGNoYW5nZSBkZXN0cm95cyBuZXN0ZWQtc2F2ZSBzdGF0ZVxuICAgIC8vIGFuZCBwcmVsb2FkZWQgY2hpbGRyZW4gdGhlIGNhbGxlciBuZXZlciBhc2tlZCB0byBpbnZhbGlkYXRlLlxuICAgIGlmICghT2JqZWN0LmlzKHByZXZpb3VzVmFsdWUsIG5ld1ZhbHVlKSkge1xuICAgICAgdGhpcy5faW52YWxpZGF0ZVJlbGF0aW9uc2hpcHNGb3JBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3VmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnZhbGlkYXRlcyBhbnkgY2FjaGVkIGJlbG9uZ3NUbyByZWxhdGlvbnNoaXAgd2hvc2UgZm9yZWlnbiBrZXkgbWF0Y2hlcyB0aGVcbiAgICogY2hhbmdlZCBhdHRyaWJ1dGUuIEhhc01hbnkgLyBoYXNPbmUgcmVsYXRpb25zaGlwcyBhcmUgbGVmdCB1bnRvdWNoZWQgYmVjYXVzZVxuICAgKiB0aGVpciBmb3JlaWduIGtleSBsaXZlcyBvbiB0aGUgY2hpbGQsIG5vdCBvbiB0aGlzIG1vZGVsLCBhbmQgYmxhbmtldC1jbGVhcmluZ1xuICAgKiB0aGVtIHdvdWxkIGRlc3Ryb3kgbmVzdGVkLXNhdmUgc3RhdGUgYW5kIHByZWxvYWRlZCBjaGlsZHJlbiB0aGUgY2FsbGVyIG5ldmVyXG4gICAqIGFza2VkIHRvIGludmFsaWRhdGUuXG4gICAqXG4gICAqIEZvcmVpZ24ga2V5cyBhcmUgaW5mZXJyZWQgd2hlbiBub3QgZGVjbGFyZWQ6IGZvciBiZWxvbmdzVG8gYHByb2plY3RJZGAgaXNcbiAgICogaW5mZXJyZWQgZnJvbSByZWxhdGlvbnNoaXAgbmFtZSBgcHJvamVjdGAuIEV4cGxpY2l0IGBmb3JlaWduS2V5YCBvbiB0aGVcbiAgICogcmVsYXRpb25zaGlwIGRlZmluaXRpb24gdGFrZXMgcHJlY2VkZW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZSB0aGF0IGNoYW5nZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2ludmFsaWRhdGVSZWxhdGlvbnNoaXBzRm9yQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAoIXRoaXMuX3JlbGF0aW9uc2hpcHMgfHwgT2JqZWN0LmtleXModGhpcy5fcmVsYXRpb25zaGlwcykubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBkZWZpbml0aW9ucyA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbnMoKVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKHRoaXMuX3JlbGF0aW9uc2hpcHMpKSB7XG4gICAgICBjb25zdCBkZWZpbml0aW9uID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGRlZmluaXRpb25zW3JlbGF0aW9uc2hpcE5hbWVdKVxuXG4gICAgICBpZiAoIWRlZmluaXRpb24gfHwgZGVmaW5pdGlvbi50eXBlICE9PSBcImJlbG9uZ3NUb1wiKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBmb3JlaWduS2V5ID0gZGVmaW5pdGlvbi5mb3JlaWduS2V5IHx8IGAke3JlbGF0aW9uc2hpcE5hbWV9SWRgXG5cbiAgICAgIGlmIChmb3JlaWduS2V5ID09PSBhdHRyaWJ1dGVOYW1lKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgcGF0aC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEZXJpdmVkIHJlc291cmNlIHBhdGguXG4gICAqL1xuICBzdGF0aWMgcmVzb3VyY2VQYXRoKCkge1xuICAgIHJldHVybiB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgoe1xuICAgICAgbW9kZWxOYW1lOiB0aGlzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgcmVzb3VyY2VQYXRoOiBkZWZhdWx0RnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aCh0aGlzKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb21tYW5kIG5hbWUuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENvbW1hbmRUeXBlfSBjb21tYW5kVHlwZSAtIENvbW1hbmQgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBSZXNvbHZlZCBjb21tYW5kIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgY29tbWFuZE5hbWUoY29tbWFuZFR5cGUpIHtcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IHRoaXMucmVzb3VyY2VDb25maWcoKVxuICAgIGNvbnN0IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgPSByZXNvdXJjZUNvbmZpZy5idWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzIHx8IFtdXG4gICAgY29uc3QgYnVpbHRJbk1lbWJlckNvbW1hbmRzID0gcmVzb3VyY2VDb25maWcuYnVpbHRJbk1lbWJlckNvbW1hbmRzIHx8IFtdXG4gICAgY29uc3QgY29tbWFuZHMgPSByZXNvdXJjZUNvbmZpZy5jb21tYW5kcyB8fCBbXVxuICAgIGNvbnN0IGlzRXhwb3NlZCA9IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMuaW5jbHVkZXMoY29tbWFuZFR5cGUpIHx8IGJ1aWx0SW5NZW1iZXJDb21tYW5kcy5pbmNsdWRlcyhjb21tYW5kVHlwZSkgfHwgY29tbWFuZHMuaW5jbHVkZXMoY29tbWFuZFR5cGUpXG4gICAgY29uc3QgY29tbWFuZE5hbWUgPSBpc0V4cG9zZWQgPyBpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUoY29tbWFuZFR5cGUpKSA6IGNvbW1hbmRUeXBlXG5cbiAgICByZXR1cm4gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kTmFtZSh7XG4gICAgICBjb21tYW5kTmFtZSxcbiAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgbW9kZWxOYW1lOiB0aGlzLmdldE1vZGVsTmFtZSgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBjdXN0b20gY29tbWFuZCBwYXlsb2FkIGFyZ3VtZW50cy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MgLSBDb21tYW5kIGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDb21tYW5kIHBheWxvYWQuXG4gICAqL1xuICBzdGF0aWMgbm9ybWFsaXplQ3VzdG9tQ29tbWFuZFBheWxvYWRBcmd1bWVudHMoYXJncykge1xuICAgIGlmIChhcmdzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG4gICAgaWYgKGFyZ3MubGVuZ3RoID09PSAxKSB7XG4gICAgICBjb25zdCBwYXlsb2FkID0gYXJnc1swXVxuICAgICAgaWYgKHBheWxvYWQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4ge31cbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVvZiBwYXlsb2FkICE9PSBcIm9iamVjdFwiIHx8IHBheWxvYWQgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIHthcmcxOiBwYXlsb2FkfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChwYXlsb2FkKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFBheWxvYWQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlciB8IHN0cmluZyB8IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgY29uc3QgcGF5bG9hZCA9IHt9XG5cbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgYXJncy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgIHBheWxvYWRbYGFyZyR7aW5kZXggKyAxfWBdID0gYXJnc1tpbmRleF1cbiAgICB9XG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIG1vZGVsIG5hbWUsIHByZWZlcnJpbmcgYW4gZXhwbGljaXQgYHN0YXRpYyBtb2RlbE5hbWVgIGRlY2xhcmF0aW9uXG4gICAqIG92ZXIgdGhlIEphdmFTY3JpcHQgY2xhc3MgYC5uYW1lYCBwcm9wZXJ0eS4gVGhpcyBhbGxvd3MgbWluaWZpZWQgYnVpbGRzIHRvXG4gICAqIHByZXNlcnZlIGNvcnJlY3QgbW9kZWwgbmFtZXMgd2l0aG91dCByZWx5aW5nIG9uIGBrZWVwX2NsYXNzbmFtZXNgLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBtb2RlbCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldE1vZGVsTmFtZSgpIHtcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IHRoaXMucmVzb3VyY2VDb25maWcoKVxuICAgIGNvbnN0IG1vZGVsTmFtZSA9IHJlc291cmNlQ29uZmlnPy5tb2RlbE5hbWVcblxuICAgIHJldHVybiAodHlwZW9mIG1vZGVsTmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBtb2RlbE5hbWUubGVuZ3RoID4gMCkgPyBtb2RlbE5hbWUgOiB0aGlzLm5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbmZpZ3VyZSB0cmFuc3BvcnQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZ30gY29uZmlnIC0gRnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBjb25maWd1cmVUcmFuc3BvcnQoY29uZmlnKSB7XG4gICAgaWYgKCFjb25maWcgfHwgdHlwZW9mIGNvbmZpZyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwidXJsXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnVybCA9IGNvbmZpZy51cmxcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJzaGFyZWRcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2hhcmVkID0gY29uZmlnLnNoYXJlZFxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcIndlYnNvY2tldENsaWVudFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgPSBjb25maWcud2Vic29ja2V0Q2xpZW50XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwid2Vic29ja2V0VXJsXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldFVybCA9IGNvbmZpZy53ZWJzb2NrZXRVcmxcbiAgICAgIC8vIFJlc2V0IGNhY2hlZCBpbnRlcm5hbCBjbGllbnQgc28gdGhlIG5ldyBVUkwgdGFrZXMgZWZmZWN0IG9uIG5leHQgc3Vic2NyaWJlXG4gICAgICByZXNldEludGVybmFsV2Vic29ja2V0Q2xpZW50KClcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJyZXF1ZXN0SGVhZGVyc1wiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0SGVhZGVycyA9IGNvbmZpZy5yZXF1ZXN0SGVhZGVyc1xuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInJlcXVlc3RDb250ZXh0XCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RDb250ZXh0ID0gY29uZmlnLnJlcXVlc3RDb250ZXh0XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwidGltZW91dFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lb3V0ID0gY29uZmlnLnRpbWVvdXRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJzaWduYWxcIikpIHtcbiAgICAgIGlmIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNpZ25hbCAhPT0gY29uZmlnLnNpZ25hbCkge1xuICAgICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNpZ25hbCA9IGNvbmZpZy5zaWduYWxcbiAgICAgICAgcmVzZXRJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwidGltZVpvbmVcIikpIHtcbiAgICAgIGlmIChjb25maWcudGltZVpvbmUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBkZWxldGUgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lWm9uZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lWm9uZSA9IGNvbmZpZy50aW1lWm9uZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInNlc3Npb25TdG9yZVwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zZXNzaW9uU3RvcmUgPSBjb25maWcuc2Vzc2lvblN0b3JlXG4gICAgICAvLyBSZXNldCBjYWNoZWQgaW50ZXJuYWwgY2xpZW50IHNvIHRoZSBuZXcgc2Vzc2lvblN0b3JlIGlzIHBpY2tlZCB1cC5cbiAgICAgIHJlc2V0SW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKVxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcIm9mZmxpbmVTeW5jXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jID0gY29uZmlnLm9mZmxpbmVTeW5jXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3QgdGhlIGludGVybmFsIFdlYlNvY2tldCBhbmQgZW5hYmxlIGF1dG8tcmVjb25uZWN0LlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIsIHNpZ25hbD86IEFib3J0U2lnbmFsfX0gW29wdGlvbnNdIC0gU3RhcnR1cCBjb250cm9scyBjb21wb3NlZCB3aXRoIHRoZSBjb25maWd1cmVkIHRyYW5zcG9ydCBjb250cm9scy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb25uZWN0ZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY29ubmVjdFdlYnNvY2tldChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBjbGllbnQgPSByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKVxuXG4gICAgaWYgKCFjbGllbnQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcImNvbm5lY3RXZWJzb2NrZXQgcmVxdWlyZXMgY29uZmlndXJlVHJhbnNwb3J0KHt3ZWJzb2NrZXRVcmx9KVwiKVxuICAgIH1cblxuICAgIGF3YWl0IGNsaWVudC5jb25uZWN0KGZyb250ZW5kTW9kZWxXZWJzb2NrZXRTdGFydHVwQ29udHJvbHMob3B0aW9ucykpXG4gIH1cblxuICAvKipcbiAgICogRGlzY29ubmVjdCB0aGUgaW50ZXJuYWwgV2ViU29ja2V0IGFuZCBkaXNhYmxlIGF1dG8tcmVjb25uZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsb3NlZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBkaXNjb25uZWN0V2Vic29ja2V0KCkge1xuICAgIGlmICghaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQpIHJldHVyblxuXG4gICAgY29uc3QgY2xpZW50ID0gaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRcblxuICAgIGRldGFjaEludGVybmFsV2Vic29ja2V0Q2xpZW50KGNsaWVudClcbiAgICBhd2FpdCBjbGllbnQuZGlzY29ubmVjdEFuZFN0b3BSZWNvbm5lY3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIHVudGlsIHF1ZXVlZCBhbmQgYWN0aXZlIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCByZXF1ZXN0cyBmaW5pc2guXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbElkbGVXYWl0QXJnc30gW2FyZ3NdIC0gV2FpdCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRyYW5zcG9ydCBpcyBpZGxlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHdhaXRGb3JJZGxlKGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtxdWlldE1zID0gMCwgdGltZW91dDogdGltZW91dE1zID0gNTAwMCwgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuICAgIGNvbnN0IHJlc3RBcmdLZXlzID0gT2JqZWN0LmtleXMocmVzdEFyZ3MpXG5cbiAgICBpZiAocmVzdEFyZ0tleXMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHdhaXRGb3JJZGxlIGFyZ3M6ICR7cmVzdEFyZ0tleXMuam9pbihcIiwgXCIpfWApXG4gICAgfVxuXG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUocXVpZXRNcykgfHwgcXVpZXRNcyA8IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgd2FpdEZvcklkbGUgcXVpZXRNcyB0byBiZSBhIG5vbi1uZWdhdGl2ZSBudW1iZXIsIGdvdDogJHtxdWlldE1zfWApXG4gICAgfVxuXG4gICAgYXdhaXQgdGltZW91dChcbiAgICAgIHt0aW1lb3V0OiB0aW1lb3V0TXMsIGVycm9yTWVzc2FnZTogXCJUaW1lZCBvdXQgd2FpdGluZyBmb3IgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHRvIGJlY29tZSBpZGxlXCJ9LFxuICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgd2FpdEZvckZyb250ZW5kTW9kZWxUcmFuc3BvcnRJZGxlKHF1aWV0TXMpXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGN1cnJlbnQgV2ViU29ja2V0IGNvbm5lY3Rpb24gc3RhdGUuXG4gICAqIEByZXR1cm5zIHt7ZGlzY29ubmVjdGVkU2luY2U6IG51bWJlciB8IG51bGwsIGhhc0NsaWVudDogYm9vbGVhbiwgaXNPcGVuOiBib29sZWFuLCBsaXN0ZW5lckNvdW50OiBudW1iZXJ9fSAtIFNuYXBzaG90IG9mIHRoZSBtYW5hZ2VkIHdlYnNvY2tldCBjb25uZWN0aW9uIHN0YXRlLlxuICAgKi9cbiAgc3RhdGljIHdlYnNvY2tldFN0YXRlKCkge1xuICAgIGlmICghaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQpIHtcbiAgICAgIHJldHVybiB7ZGlzY29ubmVjdGVkU2luY2U6IG51bGwsIGhhc0NsaWVudDogZmFsc2UsIGlzT3BlbjogZmFsc2UsIGxpc3RlbmVyQ291bnQ6IDB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmludGVybmFsV2Vic29ja2V0Q2xpZW50LnN0YXRlKCksXG4gICAgICBoYXNDbGllbnQ6IHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2xvc2UgdGhlIHJhdyBXZWJTb2NrZXQgd2l0aG91dCBkaXNhYmxpbmcgYXV0by1yZWNvbm5lY3QuIFVzZWQgYnkgdGVzdHMgdG9cbiAgICogc2ltdWxhdGUgYW4gdW5leHBlY3RlZCBuZXR3b3JrIGRyb3AgYW5kIHZlcmlmeSByZWNvbm5lY3Rpb24gYmVoYXZpb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNvY2tldCBoYXMgY2xvc2VkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGRyb3BXZWJzb2NrZXQoKSB7XG4gICAgaWYgKCFpbnRlcm5hbFdlYnNvY2tldENsaWVudCkgcmV0dXJuXG5cbiAgICBhd2FpdCBpbnRlcm5hbFdlYnNvY2tldENsaWVudC5kcm9wQ29ubmVjdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogU2V0cyBnbG9iYWwgbWV0YWRhdGEgb24gdGhlIFdlYlNvY2tldCBjb25uZWN0aW9uLiBTZW50IHRvIHRoZSBzZXJ2ZXIgaW1tZWRpYXRlbHlcbiAgICogb3ZlciBXZWJTb2NrZXQgYW5kIGV4cG9zZWQgdG8gV2ViU29ja2V0LWJvcm5lIHJlcXVlc3RzIGFzIHJlcXVlc3QgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBNZXRhZGF0YSBrZXkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gTWV0YWRhdGEgdmFsdWUgKG51bGwgdG8gY2xlYXIpLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBzZXRXZWJzb2NrZXRNZXRhZGF0YShrZXksIHZhbHVlKSB7XG4gICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50IHx8IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpKVxuXG4gICAgaWYgKCFjbGllbnQgfHwgdHlwZW9mIGNsaWVudC5zZXRNZXRhZGF0YSAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm5cblxuICAgIGNsaWVudC5zZXRNZXRhZGF0YShrZXksIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIE9wZW5zIGEgbWFuYWdlZCBjb25uZWN0aW9uIHRoYXQgYXV0by1vcGVucywgYXV0by1jbG9zZXMsIGFuZFxuICAgKiBhdXRvLXJlY29ubmVjdHMgYmFzZWQgb24gYHNob3VsZENvbm5lY3QoKWAgYW5kIGBwYXJhbXMoKWAuXG4gICAqIENhbGwgYGhhbmRsZS5zeW5jKClgIHdoZW5ldmVyIHRoZSBpbnB1dHMgdGhhdCBkcml2ZSB0aG9zZVxuICAgKiBmdW5jdGlvbnMgY2hhbmdlIChlLmcuIGN1cnJlbnQtdXNlciBzaWduLWluL291dCkuIFRoZSBoYW5kbGVcbiAgICogcmV0cmllcyB3aGVuIHRoZSBXUyBjbGllbnQgaXNuJ3QgcmVhZHkgYW5kIHJlb3BlbnMgb24gY2xvc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25uZWN0aW9uVHlwZSAtIENvbm5lY3Rpb24gY2xhc3MgbmFtZSByZWdpc3RlcmVkIG9uIHRoZSBzZXJ2ZXIuXG4gICAqIEBwYXJhbSB7e3Nob3VsZENvbm5lY3Q6ICgpID0+IGJvb2xlYW4sIHBhcmFtczogKCkgPT4gUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzaWduYWw/OiBBYm9ydFNpZ25hbCwgb25NZXNzYWdlPzogKGJvZHk6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiB2b2lkfX0gb3B0aW9ucyAtIENvbm5lY3Rpb24gbGlmZWN5Y2xlLCBjYW5jZWxsYXRpb24sIGFuZCBwYXlsb2FkIGNhbGxiYWNrcy5cbiAgICogQHJldHVybnMge3tzeW5jOiAoKSA9PiB2b2lkLCBjbG9zZTogKCkgPT4gdm9pZH19IC0gSGFuZGxlIHVzZWQgdG8gcmVzeW5jIG9yIGNsb3NlIHRoZSBtYW5hZ2VkIGNvbm5lY3Rpb24uXG4gICAqL1xuICBzdGF0aWMgb3Blbk1hbmFnZWRDb25uZWN0aW9uKGNvbm5lY3Rpb25UeXBlLCBvcHRpb25zKSB7XG4gICAgLyoqXG4gICAgICogQ29ubmVjdGlvbi5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgbGV0IGNvbm5lY3Rpb24gPSBudWxsXG4gICAgbGV0IGNsb3NlZCA9IGZhbHNlXG4gICAgLyoqXG4gICAgICogUmV0cnkgdGltZXIuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gKi9cbiAgICBsZXQgcmV0cnlUaW1lciA9IG51bGxcbiAgICBsZXQgbGFzdFBhcmFtc0pzb24gPSBcIlwiXG4gICAgY29uc3QgY29udHJvbHMgPSBmcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKHtzaWduYWw6IG9wdGlvbnMuc2lnbmFsfSlcbiAgICBjb25zdCBjbGVhclJldHJ5VGltZXIgPSAoKSA9PiB7XG4gICAgICBpZiAocmV0cnlUaW1lciA9PT0gbnVsbCkgcmV0dXJuXG5cbiAgICAgIGdsb2JhbFRoaXMuY2xlYXJUaW1lb3V0KHJldHJ5VGltZXIpXG4gICAgICByZXRyeVRpbWVyID0gbnVsbFxuICAgIH1cblxuICAgIGNvbnN0IGNsb3NlID0gKCkgPT4ge1xuICAgICAgaWYgKGNsb3NlZCkgcmV0dXJuXG5cbiAgICAgIGNsb3NlZCA9IHRydWVcbiAgICAgIGNsZWFyUmV0cnlUaW1lcigpXG4gICAgICBjb250cm9scy5zaWduYWw/LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBjbG9zZSlcbiAgICAgIGlmIChjb25uZWN0aW9uICYmICFjb25uZWN0aW9uLmlzQ2xvc2VkKCkpIGNvbm5lY3Rpb24uY2xvc2UoKVxuICAgICAgY29ubmVjdGlvbiA9IG51bGxcbiAgICB9XG5cbiAgICBjb25zdCBzeW5jID0gKCkgPT4ge1xuICAgICAgaWYgKGNsb3NlZCkgcmV0dXJuXG5cbiAgICAgIGlmICghb3B0aW9ucy5zaG91bGRDb25uZWN0KCkpIHtcbiAgICAgICAgY2xlYXJSZXRyeVRpbWVyKClcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24gJiYgIWNvbm5lY3Rpb24uaXNDbG9zZWQoKSkgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgICAgIGNvbm5lY3Rpb24gPSBudWxsXG4gICAgICAgIGxhc3RQYXJhbXNKc29uID0gXCJcIlxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgY29uc3QgbmV4dFBhcmFtcyA9IG9wdGlvbnMucGFyYW1zKClcbiAgICAgIGNvbnN0IG5leHRQYXJhbXNKc29uID0gSlNPTi5zdHJpbmdpZnkobmV4dFBhcmFtcylcblxuICAgICAgLy8gQWxyZWFkeSBjb25uZWN0ZWQgd2l0aCBzYW1lIHBhcmFtcyDigJQgbm90aGluZyB0byBkby5cbiAgICAgIGlmIChjb25uZWN0aW9uICYmICFjb25uZWN0aW9uLmlzQ2xvc2VkKCkgJiYgbmV4dFBhcmFtc0pzb24gPT09IGxhc3RQYXJhbXNKc29uKSByZXR1cm5cblxuICAgICAgLy8gQ29ubmVjdGVkIGJ1dCBwYXJhbXMgY2hhbmdlZCDigJQgc2VuZCB1cGRhdGUgbWVzc2FnZS5cbiAgICAgIC8vIEd1YXJkIHdpdGggdHJ5L2NhdGNoOiB0aGUgY29ubmVjdGlvbiBoYW5kbGUgc3RheXMgbGl2ZSBkdXJpbmdcbiAgICAgIC8vIHJlY29ubmVjdCBidXQgdGhlIHVuZGVybHlpbmcgc29ja2V0IG1heSBiZSBjbG9zZWQuXG4gICAgICBpZiAoY29ubmVjdGlvbiAmJiAhY29ubmVjdGlvbi5pc0Nsb3NlZCgpKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29ubmVjdGlvbi5zZW5kTWVzc2FnZShuZXh0UGFyYW1zKVxuICAgICAgICAgIGxhc3RQYXJhbXNKc29uID0gbmV4dFBhcmFtc0pzb25cbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgY29ubmVjdGlvbiA9IG51bGxcbiAgICAgICAgICBsYXN0UGFyYW1zSnNvbiA9IFwiXCJcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBXUyBjbGllbnQgbm90IHJlYWR5IOKAlCByZXRyeS4gQ2hlY2sgdGhlIGFjdHVhbCBjbGllbnQgKHdoaWNoXG4gICAgICAvLyBtYXkgYmUgYW4gaW5qZWN0ZWQgd2Vic29ja2V0Q2xpZW50KSBpbnN0ZWFkIG9mIHdlYnNvY2tldFN0YXRlKClcbiAgICAgIC8vIHdoaWNoIG9ubHkgcmVmbGVjdHMgdGhlIGludGVybmFsIGNsaWVudC5cbiAgICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgICAgaWYgKCFjbGllbnQgfHwgIWNsaWVudC5pc09wZW4oKSkge1xuICAgICAgICBpZiAocmV0cnlUaW1lciA9PT0gbnVsbCkge1xuICAgICAgICAgIHJldHJ5VGltZXIgPSBnbG9iYWxUaGlzLnNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgcmV0cnlUaW1lciA9IG51bGxcbiAgICAgICAgICAgIHN5bmMoKVxuICAgICAgICAgIH0sIDI1MClcbiAgICAgICAgfVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgbGFzdFBhcmFtc0pzb24gPSBuZXh0UGFyYW1zSnNvblxuICAgICAgY29ubmVjdGlvbiA9IGNsaWVudC5vcGVuQ29ubmVjdGlvbihjb25uZWN0aW9uVHlwZSwge1xuICAgICAgICBwYXJhbXM6IG5leHRQYXJhbXMsXG4gICAgICAgIG9uTWVzc2FnZTogb3B0aW9ucy5vbk1lc3NhZ2UsXG4gICAgICAgIG9uQ2xvc2U6ICgpID0+IHtcbiAgICAgICAgICBpZiAoY29ubmVjdGlvbj8uaXNDbG9zZWQoKSkge1xuICAgICAgICAgICAgY29ubmVjdGlvbiA9IG51bGxcbiAgICAgICAgICAgIGxhc3RQYXJhbXNKc29uID0gXCJcIlxuICAgICAgICAgICAgc3luYygpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH1cblxuICAgIGNvbnRyb2xzLnNpZ25hbD8uYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGNsb3NlLCB7b25jZTogdHJ1ZX0pXG5cbiAgICBpZiAoY29udHJvbHMuc2lnbmFsPy5hYm9ydGVkKSB7XG4gICAgICBjbG9zZSgpXG4gICAgfSBlbHNlIHtcbiAgICAgIHN5bmMoKVxuICAgIH1cblxuICAgIHJldHVybiB7c3luYywgY2xvc2V9XG4gIH1cblxuICAvKipcbiAgICogT3BlbnMgYSAxOjEgYFdlYnNvY2tldENvbm5lY3Rpb25gIG9mIHRoZSBnaXZlbiB0eXBlLiBUaGluXG4gICAqIGNvbnZlbmllbmNlIHdyYXBwZXIgYXJvdW5kIHRoZSBpbnRlcm5hbCBXUyBjbGllbnQnc1xuICAgKiBgb3BlbkNvbm5lY3Rpb25gLiBBcHBzIHVzZSB0aGlzIGZvciBwZXItc2Vzc2lvbiBzdGF0ZS9tZXNzYWdpbmdcbiAgICogdGhhdCBkb2Vzbid0IGZpdCB0aGUgcHViL3N1YiBDaGFubmVsIG1vZGVsIChsb2NhbGUsIHByZXNlbmNlKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbm5lY3Rpb25UeXBlIC0gTmFtZSB0aGUgc2VydmVyIHJlZ2lzdGVyZWQgdGhlIGNsYXNzIHVuZGVyLlxuICAgKiBAcGFyYW0ge3twYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHRpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWwsIG9uQ29ubmVjdD86ICgpID0+IHZvaWQsIG9uTWVzc2FnZT86IChib2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gdm9pZCwgb25EaXNjb25uZWN0PzogKCkgPT4gdm9pZCwgb25SZXN1bWU/OiAoKSA9PiB2b2lkLCBvbkNsb3NlPzogKHJlYXNvbjogc3RyaW5nKSA9PiB2b2lkfX0gW29wdGlvbnNdIC0gQ29ubmVjdGlvbiBvcHRpb25zLCByZWFkaW5lc3MgY29udHJvbHMsIGFuZCBldmVudCBoYW5kbGVycy4gQ29ubmVjdCB0aGUgY2xpZW50IGZpcnN0OyB0aGUgdGltZW91dCBjb3ZlcnMgc2VydmVyLWNvbmZpcm1lZCByZWFkaW5lc3MgYW5kIHRoZSBzaWduYWwgY2FuY2VscyByZWFkaW5lc3Mgd2l0aG91dCBlbnRlcmluZyB0aGUgd2lyZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7e3JlYWR5OiBQcm9taXNlPHZvaWQ+LCBjbG9zZTogKCkgPT4gdm9pZH19IC0gV2Vic29ja2V0IGNvbm5lY3Rpb24gaGFuZGxlLlxuICAgKi9cbiAgc3RhdGljIG9wZW5XZWJzb2NrZXRDb25uZWN0aW9uKGNvbm5lY3Rpb25UeXBlLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBjbGllbnQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgfHwgcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkpXG5cbiAgICBpZiAoIWNsaWVudCB8fCB0eXBlb2YgY2xpZW50Lm9wZW5Db25uZWN0aW9uICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIm9wZW5XZWJzb2NrZXRDb25uZWN0aW9uIHJlcXVpcmVzIGNvbmZpZ3VyZVRyYW5zcG9ydCh7d2Vic29ja2V0VXJsfSlcIilcbiAgICB9XG5cbiAgICBjb25zdCB7c2lnbmFsLCB0aW1lb3V0TXMsIC4uLmNvbm5lY3Rpb25PcHRpb25zfSA9IG9wdGlvbnNcblxuICAgIHJldHVybiBjbGllbnQub3BlbkNvbm5lY3Rpb24oY29ubmVjdGlvblR5cGUsIHtcbiAgICAgIC4uLmNvbm5lY3Rpb25PcHRpb25zLFxuICAgICAgLi4uZnJvbnRlbmRNb2RlbFdlYnNvY2tldFN0YXJ0dXBDb250cm9scyh7c2lnbmFsLCB0aW1lb3V0TXN9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU3Vic2NyaWJlcyB0byBhIHB1Yi9zdWIgYFdlYnNvY2tldENoYW5uZWxgLiBUaGluIHdyYXBwZXIgYXJvdW5kXG4gICAqIHRoZSBpbnRlcm5hbCBjbGllbnQncyBgc3Vic2NyaWJlQ2hhbm5lbGAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjaGFubmVsVHlwZSAtIENoYW5uZWwgY2xhc3MgbmFtZSByZWdpc3RlcmVkIG9uIHRoZSBzZXJ2ZXIuXG4gICAqIEBwYXJhbSB7e3BhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgdGltZW91dE1zPzogbnVtYmVyLCBzaWduYWw/OiBBYm9ydFNpZ25hbCwgb25NZXNzYWdlPzogKGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB2b2lkLCBvbkRpc2Nvbm5lY3Q/OiAoKSA9PiB2b2lkLCBvblJlc3VtZT86ICgpID0+IHZvaWQsIG9uQ2xvc2U/OiAocmVhc29uOiBzdHJpbmcpID0+IHZvaWR9fSBbb3B0aW9uc10gLSBDaGFubmVsIG9wdGlvbnMsIHN0YXJ0dXAgY29udHJvbHMsIGFuZCBldmVudCBoYW5kbGVycy4gVGhlIHRpbWVvdXQgY292ZXJzIGNvbm5lY3QgYW5kIHNlcnZlci1jb25maXJtZWQgcmVhZGluZXNzIG9ubHk7IHRoZSBzaWduYWwgY2FuY2VscyBzdGFydHVwIHdpdGhvdXQgZW50ZXJpbmcgdGhlIHdpcmUgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3tyZWFkeTogUHJvbWlzZTx2b2lkPiwgY2xvc2U6ICgpID0+IHZvaWR9fSAtIFdlYnNvY2tldCBjaGFubmVsIGhhbmRsZSBmcm9tIHRoZSBjb25maWd1cmVkIGNsaWVudC5cbiAgICovXG4gIHN0YXRpYyBzdWJzY3JpYmVXZWJzb2NrZXRDaGFubmVsKGNoYW5uZWxUeXBlLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBjbGllbnQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgfHwgcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkpXG5cbiAgICBpZiAoIWNsaWVudCB8fCB0eXBlb2YgY2xpZW50LnN1YnNjcmliZUNoYW5uZWwgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3Vic2NyaWJlV2Vic29ja2V0Q2hhbm5lbCByZXF1aXJlcyBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldFVybH0pXCIpXG4gICAgfVxuXG4gICAgY29uc3Qge3BhcmFtcywgc2lnbmFsLCB0aW1lb3V0TXMsIC4uLmNoYW5uZWxPcHRpb25zfSA9IG9wdGlvbnNcbiAgICBjb25zdCByZXF1ZXN0Q29udGV4dCA9IGZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCgpXG4gICAgY29uc3Qgc2NvcGVkUGFyYW1zID0gbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQsIHBhcmFtcyA9PT0gdW5kZWZpbmVkID8ge30gOiBwYXJhbXMpXG4gICAgY29uc3Qgc3RhcnR1cENvbnRyb2xzID0gZnJvbnRlbmRNb2RlbFdlYnNvY2tldFN0YXJ0dXBDb250cm9scyh7c2lnbmFsLCB0aW1lb3V0TXN9KVxuICAgIGNvbnN0IHNjb3BlZFBhcmFtc09wdGlvbiA9IHBhcmFtcyA9PT0gdW5kZWZpbmVkICYmIE9iamVjdC5rZXlzKHJlcXVlc3RDb250ZXh0KS5sZW5ndGggPT09IDBcbiAgICAgID8ge31cbiAgICAgIDoge3BhcmFtczogc2NvcGVkUGFyYW1zfVxuICAgIGNvbnN0IGhhbmRsZSA9IGNsaWVudC5zdWJzY3JpYmVDaGFubmVsKGNoYW5uZWxUeXBlLCB7Li4uY2hhbm5lbE9wdGlvbnMsIC4uLnNjb3BlZFBhcmFtc09wdGlvbiwgLi4uc3RhcnR1cENvbnRyb2xzfSlcblxuICAgIGlmICh0eXBlb2YgY2xpZW50LmNvbm5lY3QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdm9pZCBjbGllbnQuY29ubmVjdChzdGFydHVwQ29udHJvbHMpLmNhdGNoKCgpID0+IGhhbmRsZS5jbG9zZSgpKVxuICAgIH1cblxuICAgIHJldHVybiBoYW5kbGVcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YWxscyBXZWJTb2NrZXQgbGlmZWN5Y2xlIGhvb2tzIG9uIGdsb2JhbFRoaXMgZm9yIHN5c3RlbSB0ZXN0IGFjY2Vzcy5cbiAgICogVGVzdHMgY2FuIGNhbGwgYGdsb2JhbFRoaXMuX192ZWxvY2lvdXNfd2Vic29ja2V0X2hvb2tzLmNvbm5lY3QoKWAgZXRjLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBpbnN0YWxsV2Vic29ja2V0VGVzdEhvb2tzKCkge1xuICAgIGlmICh0eXBlb2YgZ2xvYmFsVGhpcyA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuXG5cbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZ2xvYmFsVGhpcykuX192ZWxvY2lvdXNfd2Vic29ja2V0X2hvb2tzID0ge1xuICAgICAgY29ubmVjdDogKCkgPT4gdGhpcy5jb25uZWN0V2Vic29ja2V0KCksXG4gICAgICBkaXNjb25uZWN0OiAoKSA9PiB0aGlzLmRpc2Nvbm5lY3RXZWJzb2NrZXQoKSxcbiAgICAgIGRyb3A6ICgpID0+IHRoaXMuZHJvcFdlYnNvY2tldCgpLFxuICAgICAgc3RhdGU6ICgpID0+IHRoaXMud2Vic29ja2V0U3RhdGUoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dHJpYnV0ZXMgZnJvbSByZXNwb25zZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtvYmplY3R9IHJlc3BvbnNlIC0gUmVzcG9uc2UgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59IC0gQXR0cmlidXRlcyBmcm9tIHBheWxvYWQuXG4gICAqL1xuICBzdGF0aWMgYXR0cmlidXRlc0Zyb21SZXNwb25zZShyZXNwb25zZSkge1xuICAgIGNvbnN0IG1vZGVsRGF0YSA9IHRoaXMubW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuXG4gICAgcmV0dXJuIG1vZGVsRGF0YS5hdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtb2RlbCBkYXRhIGZyb20gcmVzcG9uc2UuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7b2JqZWN0fSByZXNwb25zZSAtIFJlc3BvbnNlIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt7YWJpbGl0aWVzOiBSZWNvcmQ8c3RyaW5nLCBib29sZWFuPiwgYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgYXNzb2NpYXRpb25Db3VudHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4sIHF1ZXJ5RGF0YTogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgcHJlbG9hZGVkUmVsYXRpb25zaGlwczogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgc2VsZWN0ZWRBdHRyaWJ1dGVzOiBTZXQ8c3RyaW5nPn19IC0gQXR0cmlidXRlcywgcHJlbG9hZGVkIHJlbGF0aW9uc2hpcHMsIGFzc29jaWF0aW9uIGNvdW50cywgcXVlcnlEYXRhLCBhYmlsaXRpZXMsIGFuZCB0aGUgc2VsZWN0ZWQtYXR0cmlidXRlcyBzZXQuXG4gICAqL1xuICBzdGF0aWMgbW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgaWYgKCFyZXNwb25zZSB8fCB0eXBlb2YgcmVzcG9uc2UgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgb2JqZWN0IHJlc3BvbnNlIGJ1dCBnb3Q6ICR7cmVzcG9uc2V9YClcbiAgICB9XG5cbiAgICAvLyBOYXJyb3dzIHRoZSByZXNwb25zZSBvYmplY3QgdG8gdGhlIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCB2YWx1ZSBtYXAuXG4gICAgY29uc3QgcmVzcG9uc2VPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChyZXNwb25zZSlcblxuICAgIC8qKlxuICAgICAqIERlZmluZXMgbW9kZWxEYXRhLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqL1xuICAgIGxldCBtb2RlbERhdGFcblxuICAgIGlmIChyZXNwb25zZU9iamVjdC5tb2RlbCAmJiB0eXBlb2YgcmVzcG9uc2VPYmplY3QubW9kZWwgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIC8vIE5hcnJvd3MgdGhlIG5lc3RlZCBtb2RlbCBwYXlsb2FkIHRvIHRoZSBmcm9udGVuZC1tb2RlbCB2YWx1ZSBtYXAuXG4gICAgICBtb2RlbERhdGEgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChyZXNwb25zZU9iamVjdC5tb2RlbClcbiAgICB9IGVsc2UgaWYgKHJlc3BvbnNlT2JqZWN0LmF0dHJpYnV0ZXMgJiYgdHlwZW9mIHJlc3BvbnNlT2JqZWN0LmF0dHJpYnV0ZXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIC8vIE5hcnJvd3MgdGhlIG5lc3RlZCBhdHRyaWJ1dGVzIHBheWxvYWQgdG8gdGhlIGZyb250ZW5kLW1vZGVsIHZhbHVlIG1hcC5cbiAgICAgIG1vZGVsRGF0YSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKHJlc3BvbnNlT2JqZWN0LmF0dHJpYnV0ZXMpXG4gICAgfSBlbHNlIHtcbiAgICAgIG1vZGVsRGF0YSA9IHJlc3BvbnNlT2JqZWN0XG4gICAgfVxuXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKHsuLi5tb2RlbERhdGF9KVxuICAgIGNvbnN0IHByZWxvYWRlZFJlbGF0aW9uc2hpcHMgPSBpc1BsYWluT2JqZWN0KGF0dHJpYnV0ZXNbUFJFTE9BREVEX1JFTEFUSU9OU0hJUFNfS0VZXSlcbiAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoYXR0cmlidXRlc1tQUkVMT0FERURfUkVMQVRJT05TSElQU19LRVldKVxuICAgICAgOiB7fVxuICAgIGNvbnN0IGFzc29jaWF0aW9uQ291bnRzID0gaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzW0FTU09DSUFUSU9OX0NPVU5UU19LRVldKVxuICAgICAgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovIChhdHRyaWJ1dGVzW0FTU09DSUFUSU9OX0NPVU5UU19LRVldKVxuICAgICAgOiB7fVxuICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IGlzUGxhaW5PYmplY3QoYXR0cmlidXRlc1tRVUVSWV9EQVRBX0tFWV0pXG4gICAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKGF0dHJpYnV0ZXNbUVVFUllfREFUQV9LRVldKVxuICAgICAgOiB7fVxuICAgIGNvbnN0IGFiaWxpdGllcyA9IGlzUGxhaW5PYmplY3QoYXR0cmlidXRlc1tBQklMSVRJRVNfS0VZXSlcbiAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuPn0gKi8gKGF0dHJpYnV0ZXNbQUJJTElUSUVTX0tFWV0pXG4gICAgICA6IHt9XG4gICAgY29uc3Qgc2VsZWN0ZWRBdHRyaWJ1dGVzRnJvbVBheWxvYWQgPSBBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXNbU0VMRUNURURfQVRUUklCVVRFU19LRVldKVxuICAgICAgPyBuZXcgU2V0KC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChhdHRyaWJ1dGVzW1NFTEVDVEVEX0FUVFJJQlVURVNfS0VZXSkuZmlsdGVyKChhdHRyaWJ1dGVOYW1lKSA9PiB0eXBlb2YgYXR0cmlidXRlTmFtZSA9PT0gXCJzdHJpbmdcIikpXG4gICAgICA6IG51bGxcblxuICAgIGRlbGV0ZSBhdHRyaWJ1dGVzW1BSRUxPQURFRF9SRUxBVElPTlNISVBTX0tFWV1cbiAgICBkZWxldGUgYXR0cmlidXRlc1tTRUxFQ1RFRF9BVFRSSUJVVEVTX0tFWV1cbiAgICBkZWxldGUgYXR0cmlidXRlc1tBU1NPQ0lBVElPTl9DT1VOVFNfS0VZXVxuICAgIGRlbGV0ZSBhdHRyaWJ1dGVzW1FVRVJZX0RBVEFfS0VZXVxuICAgIGRlbGV0ZSBhdHRyaWJ1dGVzW0FCSUxJVElFU19LRVldXG5cbiAgICBjb25zdCBzZWxlY3RlZEF0dHJpYnV0ZXMgPSBzZWxlY3RlZEF0dHJpYnV0ZXNGcm9tUGF5bG9hZCB8fCBuZXcgU2V0KE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpKVxuXG4gICAgcmV0dXJuIHthYmlsaXRpZXMsIGF0dHJpYnV0ZXMsIGFzc29jaWF0aW9uQ291bnRzLCBxdWVyeURhdGEsIHByZWxvYWRlZFJlbGF0aW9uc2hpcHMsIHNlbGVjdGVkQXR0cmlidXRlc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IHByZWxvYWRlZCByZWxhdGlvbnNoaXBzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcHJlbG9hZGVkUmVsYXRpb25zaGlwcyAtIFByZWxvYWRlZCByZWxhdGlvbnNoaXAgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYXBwbHlQcmVsb2FkZWRSZWxhdGlvbnNoaXBzKG1vZGVsLCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKSB7XG4gICAgZm9yIChjb25zdCBbcmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwUGF5bG9hZF0gb2YgT2JqZWN0LmVudHJpZXMocHJlbG9hZGVkUmVsYXRpb25zaGlwcykpIHtcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMucmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXApIHtcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHJlbGF0aW9uc2hpcFBheWxvYWQpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfSBwYXlsb2FkIHRvIGJlIGFuIGFycmF5YClcbiAgICAgICAgfVxuXG4gICAgICAgIC8qKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+fSAqL1xuICAgICAgICBjb25zdCByZWxhdGVkTW9kZWxzID0gW11cblxuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHJlbGF0aW9uc2hpcFBheWxvYWQpIHtcbiAgICAgICAgICBjb25zdCByZWxhdGVkTW9kZWwgPSB0aGlzLmluc3RhbnRpYXRlUmVsYXRpb25zaGlwVmFsdWUoZW50cnksIHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICAgICAgICBpZiAoIShyZWxhdGVkTW9kZWwgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsQmFzZSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX0gcGF5bG9hZCBlbnRyeSB0byBpbnN0YW50aWF0ZSBhIGZyb250ZW5kIG1vZGVsYClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZWxhdGVkTW9kZWxzLnB1c2gocmVsYXRlZE1vZGVsKVxuICAgICAgICB9XG5cbiAgICAgICAgcmVsYXRpb25zaGlwLnNldExvYWRlZChyZWxhdGVkTW9kZWxzKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShyZWxhdGlvbnNoaXBQYXlsb2FkKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9IHBheWxvYWQgdG8gYmUgc2luZ3VsYXJgKVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZWxhdGVkTW9kZWwgPSB0aGlzLmluc3RhbnRpYXRlUmVsYXRpb25zaGlwVmFsdWUocmVsYXRpb25zaGlwUGF5bG9hZCwgdGFyZ2V0TW9kZWxDbGFzcylcblxuICAgICAgaWYgKHJlbGF0ZWRNb2RlbCAhPSB1bmRlZmluZWQgJiYgIShyZWxhdGVkTW9kZWwgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsQmFzZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfSBwYXlsb2FkIHRvIGluc3RhbnRpYXRlIGEgZnJvbnRlbmQgbW9kZWxgKVxuICAgICAgfVxuXG4gICAgICByZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHJlbGF0ZWRNb2RlbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnN0YW50aWF0ZSByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlbGF0aW9uc2hpcFBheWxvYWQgLSBSZWxhdGlvbnNoaXAgcGF5bG9hZCB2YWx1ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBudWxsfSB0YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gSW5zdGFudGlhdGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBpbnN0YW50aWF0ZVJlbGF0aW9uc2hpcFZhbHVlKHJlbGF0aW9uc2hpcFBheWxvYWQsIHRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICBpZiAoIXRhcmdldE1vZGVsQ2xhc3MpIHJldHVybiByZWxhdGlvbnNoaXBQYXlsb2FkXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcFBheWxvYWQgfHwgdHlwZW9mIHJlbGF0aW9uc2hpcFBheWxvYWQgIT09IFwib2JqZWN0XCIpIHJldHVybiByZWxhdGlvbnNoaXBQYXlsb2FkXG5cbiAgICByZXR1cm4gdGFyZ2V0TW9kZWxDbGFzcy5pbnN0YW50aWF0ZUZyb21SZXNwb25zZShyZWxhdGlvbnNoaXBQYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zdGFudGlhdGUgZnJvbSByZXNwb25zZS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgSW5zdGFuY2VUeXBlPFQ+fSByZXNwb25zZSAtIFJlc3BvbnNlIHBheWxvYWQsIG9yIGFuIGFscmVhZHktaHlkcmF0ZWQgaW5zdGFuY2Ugb2YgdGhpcyBjbGFzcy5cbiAgICogQHJldHVybnMge0luc3RhbmNlVHlwZTxUPn0gLSBOZXcgbW9kZWwgaW5zdGFuY2UsIG9yIHRoZSBzYW1lIGluc3RhbmNlIHVuY2hhbmdlZCBpZiBpdCB3YXMgYWxyZWFkeSBoeWRyYXRlZC5cbiAgICovXG4gIHN0YXRpYyBpbnN0YW50aWF0ZUZyb21SZXNwb25zZShyZXNwb25zZSkge1xuICAgIC8vIElkZW1wb3RlbnQ6IGlmIGEgY2FsbGVyIGhhbmRzIHVzIGFuIGFscmVhZHktaHlkcmF0ZWQgaW5zdGFuY2Ugb2YgdGhpc1xuICAgIC8vIGNsYXNzIChub3cgY29tbW9uIGJlY2F1c2UgdGhlIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgYXV0by1zZXJpYWxpemVzXG4gICAgLy8gYmFja2VuZCBgUmVjb3JkYCBpbnN0YW5jZXMgcmV0dXJuZWQgZnJvbSBjdXN0b20gY29tbWFuZHMgYW5kIHRoZVxuICAgIC8vIHRyYW5zcG9ydCBkZXNlcmlhbGl6ZXIgaHlkcmF0ZXMgdGhlbSBpbnRvIG1vZGVscyBiZWZvcmUgdGhlIGNhbGwgc2l0ZVxuICAgIC8vIHNlZXMgdGhlIHJlc3BvbnNlKSwgcmV0dXJuIGl0IGFzLWlzLiBXaXRob3V0IHRoaXMsIGNvZGUgdGhhdCBoYXNcbiAgICAvLyBoaXN0b3JpY2FsbHkgd3JhcHBlZCBjdXN0b20tY29tbWFuZCByZXNwb25zZXMgaW5cbiAgICAvLyBgTW9kZWwuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UocmVzcG9uc2UuZmllbGQpYCB3b3VsZCBzcHJlYWQgdGhlIGxpdmVcbiAgICAvLyBtb2RlbCBpbnN0YW5jZSBpbnRvIGEgbmV3IGNvbnN0cnVjdG9yIGNhbGwgYW5kIHByb2R1Y2UgYSBicm9rZW4gbW9kZWxcbiAgICAvLyB3aXRoIGludGVybmFsIHN0YXRlIGtleXMgcHJvbW90ZWQgdG8gYXR0cmlidXRlcy5cbiAgICBpZiAocmVzcG9uc2UgaW5zdGFuY2VvZiB0aGlzKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtJbnN0YW5jZVR5cGU8VD59ICovIChyZXNwb25zZSlcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlbERhdGEgPSB0aGlzLm1vZGVsRGF0YUZyb21SZXNwb25zZShyZXNwb25zZSlcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gbW9kZWxEYXRhLmF0dHJpYnV0ZXNcbiAgICBjb25zdCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzID0gbW9kZWxEYXRhLnByZWxvYWRlZFJlbGF0aW9uc2hpcHNcbiAgICBjb25zdCBhc3NvY2lhdGlvbkNvdW50cyA9IG1vZGVsRGF0YS5hc3NvY2lhdGlvbkNvdW50c1xuICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IG1vZGVsRGF0YS5xdWVyeURhdGFcbiAgICBjb25zdCBhYmlsaXRpZXMgPSBtb2RlbERhdGEuYWJpbGl0aWVzXG4gICAgY29uc3Qgc2VsZWN0ZWRBdHRyaWJ1dGVzID0gbW9kZWxEYXRhLnNlbGVjdGVkQXR0cmlidXRlc1xuICAgIGNvbnN0IHJlY2VpdmVyID0gLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcylcbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtuZXcgKGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+KSA9PiBJbnN0YW5jZVR5cGU8VD59ICovIChyZWNlaXZlcilcbiAgICBjb25zdCBtb2RlbCA9IG5ldyBNb2RlbENsYXNzKGF0dHJpYnV0ZXMpXG4gICAgbW9kZWwuX3NlbGVjdGVkQXR0cmlidXRlcyA9IHNlbGVjdGVkQXR0cmlidXRlcyA/IG5ldyBTZXQoc2VsZWN0ZWRBdHRyaWJ1dGVzKSA6IG51bGxcblxuICAgIHRoaXMuYXBwbHlQcmVsb2FkZWRSZWxhdGlvbnNoaXBzKG1vZGVsLCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGFzc29jaWF0aW9uQ291bnRzIHx8IHt9KSkge1xuICAgICAgbW9kZWwuX3NldEFzc29jaWF0aW9uQ291bnQoYXR0cmlidXRlTmFtZSwgTnVtYmVyKHZhbHVlKSB8fCAwKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgW25hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhxdWVyeURhdGEgfHwge30pKSB7XG4gICAgICBtb2RlbC5fc2V0UXVlcnlEYXRhKG5hbWUsIHZhbHVlKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgW2FjdGlvbiwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGFiaWxpdGllcyB8fCB7fSkpIHtcbiAgICAgIG1vZGVsLl9zZXRDb21wdXRlZEFiaWxpdHkoYWN0aW9uLCBCb29sZWFuKHZhbHVlKSlcbiAgICB9XG5cbiAgICBtb2RlbC5zZXRJc05ld1JlY29yZChmYWxzZSlcbiAgICBtb2RlbC5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMobW9kZWwuYXR0cmlidXRlcygpKVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtudW1iZXIgfCBzdHJpbmd9IGlkIC0gUmVjb3JkIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gUmVzb2x2ZWQgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZChpZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZChpZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIEF0dHJpYnV0ZSBtYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBGb3VuZCBtb2RlbCBvciBudWxsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRCeShjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kQnkoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgb3IgZmFpbC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gQXR0cmlidXRlIG1hdGNoIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRm91bmQgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZEJ5T3JGYWlsKGNvbmRpdGlvbnMpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpbmRCeU9yRmFpbChjb25kaXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYXJyYXkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD5bXT59IC0gTG9hZGVkIG1vZGVsIGluc3RhbmNlcy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB0b0FycmF5KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkudG9BcnJheSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+W10+fSAtIExvYWRlZCBtb2RlbCBpbnN0YW5jZXMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgbG9hZCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmxvYWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWxsLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyLlxuICAgKi9cbiAgc3RhdGljIGFsbCgpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aGVyZS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gUm9vdC1tb2RlbCB3aGVyZSBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggd2hlcmUgY29uZGl0aW9ucy5cbiAgICovXG4gIHN0YXRpYyB3aGVyZShjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS53aGVyZShjb25kaXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgam9pbnMuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IGpvaW5zIC0gUmVsYXRpb25zaGlwIGRlc2NyaXB0b3Igam9pbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCBqb2lucy5cbiAgICovXG4gIHN0YXRpYyBqb2lucyhqb2lucykge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuam9pbnMoam9pbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsaW1pdC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIE1heGltdW0gbnVtYmVyIG9mIHJlY29yZHMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCBsaW1pdC5cbiAgICovXG4gIHN0YXRpYyBsaW1pdCh2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkubGltaXQodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvZmZzZXQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBOdW1iZXIgb2YgcmVjb3JkcyB0byBza2lwLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggb2Zmc2V0LlxuICAgKi9cbiAgc3RhdGljIG9mZnNldCh2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkub2Zmc2V0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFnZS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7bnVtYmVyfSBwYWdlTnVtYmVyIC0gMS1iYXNlZCBwYWdlIG51bWJlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIHBhZ2UgYXBwbGllZC5cbiAgICovXG4gIHN0YXRpYyBwYWdlKHBhZ2VOdW1iZXIpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLnBhZ2UocGFnZU51bWJlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlciBwYWdlLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gTnVtYmVyIG9mIHJlY29yZHMgcGVyIHBhZ2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCBwYWdlIHNpemUuXG4gICAqL1xuICBzdGF0aWMgcGVyUGFnZSh2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkucGVyUGFnZSh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvdW50LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBOdW1iZXIgb2YgbG9hZGVkIG1vZGVsIGluc3RhbmNlcy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjb3VudCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmNvdW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGFzcy1sZXZlbCBob29rIGZpcmVkIHdoZW4gYW55IHJlY29yZCBvZiB0aGlzIG1vZGVsIGlzIGNyZWF0ZWQuXG4gICAqIFN1YnNjcmliZS10aW1lIGF1dGhvcml6YXRpb24gb25seSDigJQgb25jZSBhIHN1YnNjcmlwdGlvbiBpc1xuICAgKiBhY2NlcHRlZCwgZnV0dXJlIGBjcmVhdGVgIGV2ZW50cyBmb3IgdGhpcyBtb2RlbCBhcmUgZGVsaXZlcmVkXG4gICAqIHdpdGhvdXQgcmUtY2hlY2tpbmcgcGVyLXJlY29yZCB2aXNpYmlsaXR5LiBRdWVyeSBvcHRpb25zIGNhbiBzdGlsbFxuICAgKiBuYXJyb3cgd2hpY2ggZXZlbnRzIHJlYWNoIHRoaXMgY2FsbGJhY2suXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWUsIG1vZGVsOiBGcm9udGVuZE1vZGVsQmFzZX0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciByZWNvcmQgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBvbkNyZWF0ZShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0LCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKHRoaXMsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKHRoaXMsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBlbnRyeSA9IHtjYWxsYmFjaywgLi4uZXZlbnRPcHRpb25zUGF5bG9hZH1cblxuICAgIHJldHVybiBhd2FpdCBzdWIucmVnaXN0ZXJDbGFzc0NhbGxiYWNrKHN1Yi5jbGFzc0NyZWF0ZUNhbGxiYWNrcywgZW50cnkpXG4gIH1cblxuICAvKipcbiAgICogQ2xhc3MtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIGFueSByZWNvcmQgb2YgdGhpcyBtb2RlbCBpcyB1cGRhdGVkLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7aWQ6IHN0cmluZyB8IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLkNvbXBvc2l0ZU1vZGVsUHJpbWFyeUtleVZhbHVlLCBtb2RlbDogRnJvbnRlbmRNb2RlbEJhc2V9KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gRXZlbnQgcXVlcnkgb3IgcmVjb3JkIHByb2plY3Rpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgb25VcGRhdGUoY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHtyZXF1ZXN0Q29udGV4dCwgLi4uZXZlbnRPcHRpb25zUGF5bG9hZH0gPSBmcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZCh0aGlzLCBvcHRpb25zKVxuICAgIGNvbnN0IHN1YiA9IGVuc3VyZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbih0aGlzLCBmcm9udGVuZE1vZGVsRXZlbnRSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2ssIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9XG5cbiAgICByZXR1cm4gYXdhaXQgc3ViLnJlZ2lzdGVyQ2xhc3NDYWxsYmFjayhzdWIuY2xhc3NVcGRhdGVDYWxsYmFja3MsIGVudHJ5KVxuICB9XG5cbiAgLyoqXG4gICAqIENsYXNzLWxldmVsIGhvb2sgZmlyZWQgd2hlbiBhbnkgcmVjb3JkIG9mIHRoaXMgbW9kZWwgaXMgZGVzdHJveWVkLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7aWQ6IHN0cmluZyB8IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLkNvbXBvc2l0ZU1vZGVsUHJpbWFyeUtleVZhbHVlfSkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEFjY2VwdGVkIGZvciBBUEkgc3ltbWV0cnk7IGRlc3Ryb3kgZXZlbnRzIGNhcnJ5IGlkcyBvbmx5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBvbkRlc3Ryb3koY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGFzc2VydE5vRGVzdHJveUV2ZW50RmlsdGVyKHRoaXMsIG9wdGlvbnMpXG5cbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQodGhpcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24odGhpcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrfVxuXG4gICAgcmV0dXJuIGF3YWl0IHN1Yi5yZWdpc3RlckNsYXNzQ2FsbGJhY2soc3ViLmNsYXNzRGVzdHJveUNhbGxiYWNrcywgZW50cnkpXG4gIH1cblxuICAvKipcbiAgICogSW5zdGFuY2UtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIFRISVMgcmVjb3JkIGlzIHVwZGF0ZWQuIFRoZVxuICAgKiBpbnN0YW5jZSdzIGF0dHJpYnV0ZXMgYXJlIGF1dG8tbWVyZ2VkIHdpdGggdGhlIGJyb2FkY2FzdCBwYXlsb2FkXG4gICAqIGJlZm9yZSB0aGUgY2FsbGJhY2sgcnVucywgc28gY2FsbGVycyBjYW4gcmVhZCBmcmVzaCB2YWx1ZXMgdmlhXG4gICAqIGB0aGlzLnNvbWVBdHRyKClgIHdpdGhvdXQgcmUtZmV0Y2hpbmcuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWUsIG1vZGVsOiBGcm9udGVuZE1vZGVsQmFzZX0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciByZWNvcmQgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIGFzeW5jIG9uVXBkYXRlKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0LCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKE1vZGVsQ2xhc3MsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBpZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrLCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfVxuICAgIGNvbnN0IGxpc3RlbmVyID0gZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIoc3ViLCBpZCwgdGhpcylcblxuICAgIGxpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcy5hZGQoZW50cnkpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3ViLmVuc3VyZVN1YnNjcmliZWQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgKGN1cnJlbnQpID0+IGN1cnJlbnQudXBkYXRlQ2FsbGJhY2tzLmRlbGV0ZShlbnRyeSkpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgKGN1cnJlbnQpID0+IGN1cnJlbnQudXBkYXRlQ2FsbGJhY2tzLmRlbGV0ZShlbnRyeSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbmNlLWxldmVsIGhvb2sgZmlyZWQgd2hlbiBUSElTIHJlY29yZCBpcyBkZXN0cm95ZWQuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWV9KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gQWNjZXB0ZWQgZm9yIEFQSSBzeW1tZXRyeTsgZGVzdHJveSBldmVudHMgY2FycnkgaWRzIG9ubHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgb25EZXN0cm95KGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG5cbiAgICBhc3NlcnROb0Rlc3Ryb3lFdmVudEZpbHRlcihNb2RlbENsYXNzLCBvcHRpb25zKVxuXG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0fSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKE1vZGVsQ2xhc3MsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBpZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrfVxuICAgIGNvbnN0IGxpc3RlbmVyID0gZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIoc3ViLCBpZCwgdGhpcylcblxuICAgIGxpc3RlbmVyLmRlc3Ryb3lDYWxsYmFja3MuYWRkKGVudHJ5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN1Yi5lbnN1cmVTdWJzY3JpYmVkKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmVtb3ZlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJFbnRyeShzdWIsIChjdXJyZW50KSA9PiBjdXJyZW50LmRlc3Ryb3lDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCAoY3VycmVudCkgPT4gY3VycmVudC5kZXN0cm95Q2FsbGJhY2tzLmRlbGV0ZShlbnRyeSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGx1Y2suXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0gey4uLihzdHJpbmcgfCBzdHJpbmdbXSB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4pfSBjb2x1bW5zIC0gUGx1Y2sgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBQbHVja2VkIHZhbHVlcy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBwbHVjayguLi5jb2x1bW5zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5wbHVjayguLi5jb2x1bW5zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VhcmNoLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uIC0gQ29sdW1uIG9yIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge1wiZXFcIiB8IFwibGlrZVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwiPlwiIHwgXCI+PVwiIHwgXCI8XCIgfCBcIjw9XCJ9IG9wZXJhdG9yIC0gU2VhcmNoIG9wZXJhdG9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFNlYXJjaCB2YWx1ZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggc2VhcmNoIGZpbHRlci5cbiAgICovXG4gIHN0YXRpYyBzZWFyY2gocGF0aCwgY29sdW1uLCBvcGVyYXRvciwgdmFsdWUpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLnNlYXJjaChwYXRoLCBjb2x1bW4sIG9wZXJhdG9yLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJhbnNhY2suXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmFuc2Fjay1zdHlsZSBwYXJhbXMgaGFzaC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggUmFuc2FjayBmaWx0ZXJzIGFwcGxpZWQuXG4gICAqL1xuICBzdGF0aWMgcmFuc2FjayhwYXJhbXMpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLnJhbnNhY2socGFyYW1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc29ydC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBzdHJpbmdbXVtdIHwgW3N0cmluZywgc3RyaW5nXSB8IEFycmF5PFtzdHJpbmcsIHN0cmluZ10+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gc29ydCAtIFNvcnQgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggc29ydCBkZWZpbml0aW9ucy5cbiAgICovXG4gIHN0YXRpYyBzb3J0KHNvcnQpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLnNvcnQoc29ydClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9yZGVyLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHN0cmluZ1tdW10gfCBbc3RyaW5nLCBzdHJpbmddIHwgQXJyYXk8W3N0cmluZywgc3RyaW5nXT4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBzb3J0IC0gU29ydCBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBzb3J0IGRlZmluaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIG9yZGVyKHNvcnQpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLm9yZGVyKHNvcnQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBncm91cC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBncm91cCAtIEdyb3VwIGRlZmluaXRpb24ocykuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlciB3aXRoIGdyb3VwIGRlZmluaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIGdyb3VwKGdyb3VwKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5ncm91cChncm91cClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRpc3RpbmN0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtib29sZWFufSBbdmFsdWVdIC0gV2hldGhlciB0byByZXF1ZXN0IGRpc3RpbmN0IHJvd3MuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlciB3aXRoIGRpc3RpbmN0IGZsYWcuXG4gICAqL1xuICBzdGF0aWMgZGlzdGluY3QodmFsdWUgPSB0cnVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5kaXN0aW5jdCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyLlxuICAgKi9cbiAgc3RhdGljIHF1ZXJ5KCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gKi8gKG5ldyBGcm9udGVuZE1vZGVsUXVlcnkoe21vZGVsQ2xhc3M6IHRoaXN9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByZWxvYWQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBzdHJpbmcgfCBBcnJheTxzdHJpbmcgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkPn0gcHJlbG9hZCAtIFByZWxvYWQgZ3JhcGguXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgd2l0aCBwcmVsb2FkLlxuICAgKi9cbiAgc3RhdGljIHByZWxvYWQocHJlbG9hZCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gKi8gKHRoaXMucXVlcnkoKS5wcmVsb2FkKHByZWxvYWQpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VsZWN0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXSB8IHN0cmluZz4gfCBzdHJpbmcgfCBzdHJpbmdbXX0gc2VsZWN0IC0gTW9kZWwtYXdhcmUgYXR0cmlidXRlIHNlbGVjdCBtYXAgb3Igcm9vdC1tb2RlbCBzaG9ydGhhbmQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgd2l0aCBzZWxlY3RlZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgc3RhdGljIHNlbGVjdChzZWxlY3QpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59ICovICh0aGlzLnF1ZXJ5KCkuc2VsZWN0KHNlbGVjdCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWxlY3RzIGV4dHJhLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXSB8IHN0cmluZz4gfCBzdHJpbmcgfCBzdHJpbmdbXX0gc2VsZWN0IC0gRXh0cmEgYXR0cmlidXRlcyB0byBsb2FkIGluIGFkZGl0aW9uIHRvIHRoZSBkZWZhdWx0cywga2V5ZWQgYnkgbW9kZWwgbmFtZSBvciByb290LW1vZGVsIHNob3J0aGFuZC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSB3aXRoIGV4dHJhIHNlbGVjdGVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzdGF0aWMgc2VsZWN0c0V4dHJhKHNlbGVjdCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gKi8gKHRoaXMucXVlcnkoKS5zZWxlY3RzRXh0cmEoc2VsZWN0KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpcnN0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+IHwgbnVsbD59IC0gRmlyc3QgbW9kZWwgb3IgbnVsbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaXJzdCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpcnN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxhc3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBMYXN0IG1vZGVsIG9yIG51bGwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgbGFzdCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmxhc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvciBpbml0aWFsaXplIGJ5LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBBdHRyaWJ1dGUgbWF0Y2ggY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+Pn0gLSBFeGlzdGluZyBvciBpbml0aWFsaXplZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZE9ySW5pdGlhbGl6ZUJ5KGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG9yIGNyZWF0ZSBieS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gQXR0cmlidXRlIG1hdGNoIGNvbmRpdGlvbnMuXG4gICAqIEBwYXJhbSB7KG1vZGVsOiBJbnN0YW5jZVR5cGU8VD4pID0+IFByb21pc2U8dm9pZD4gfCB2b2lkfSBbY2FsbGJhY2tdIC0gT3B0aW9uYWwgY2FsbGJhY2sgYmVmb3JlIHNhdmUgd2hlbiBjcmVhdGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIEV4aXN0aW5nIG9yIG5ld2x5IGNyZWF0ZWQgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZE9yQ3JlYXRlQnkoY29uZGl0aW9ucywgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpbmRPckNyZWF0ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzc1xuICAgKiBAdGhpcyB7TW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ3JlYXRlQXR0cmlidXRlc0ZvcjxJbnN0YW5jZVR5cGU8TW9kZWxDbGFzcz4+fSBbYXR0cmlidXRlc10gLSBJbml0aWFsIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNb2RlbENsYXNzPj59IC0gUGVyc2lzdGVkIG1vZGVsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNyZWF0ZShhdHRyaWJ1dGVzKSB7XG4gICAgY29uc3QgcmVjZWl2ZXIgPSAvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzKVxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge25ldyAoYXR0cmlidXRlcz86IEZyb250ZW5kTW9kZWxDcmVhdGVBdHRyaWJ1dGVzRm9yPEluc3RhbmNlVHlwZTxNb2RlbENsYXNzPj4pID0+IEluc3RhbmNlVHlwZTxNb2RlbENsYXNzPn0gKi8gKHJlY2VpdmVyKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoYXR0cmlidXRlcylcblxuICAgIGF3YWl0IG1vZGVsLnNhdmUoKVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhc3NlcnQgZmluZCBieSBjb25kaXRpb25zLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIGZpbmRCeSBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhc3NlcnRGaW5kQnlDb25kaXRpb25zKGNvbmRpdGlvbnMpIHtcbiAgICBhc3NlcnRGaW5kQnlDb25kaXRpb25zU2hhcGUoY29uZGl0aW9ucylcblxuICAgIE9iamVjdC5rZXlzKGNvbmRpdGlvbnMpLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgYXNzZXJ0RGVmaW5lZEZpbmRCeUNvbmRpdGlvblZhbHVlKGNvbmRpdGlvbnNba2V5XSwga2V5KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXRjaGVzIGZpbmQgYnkgY29uZGl0aW9ucy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBDYW5kaWRhdGUgbW9kZWwuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gTWF0Y2ggY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgbW9kZWwgbWF0Y2hlcyBhbGwgY29uZGl0aW9ucy5cbiAgICovXG4gIHN0YXRpYyBtYXRjaGVzRmluZEJ5Q29uZGl0aW9ucyhtb2RlbCwgY29uZGl0aW9ucykge1xuICAgIGNvbnN0IG1vZGVsQXR0cmlidXRlcyA9IG1vZGVsLmF0dHJpYnV0ZXMoKVxuXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoY29uZGl0aW9ucykpIHtcbiAgICAgIGNvbnN0IGV4cGVjdGVkVmFsdWUgPSBjb25kaXRpb25zW2tleV1cbiAgICAgIGNvbnN0IGFjdHVhbFZhbHVlID0gbW9kZWxBdHRyaWJ1dGVzW2tleV1cblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZXhwZWN0ZWRWYWx1ZSkpIHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoYWN0dWFsVmFsdWUpKSB7XG4gICAgICAgICAgaWYgKCF0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICghZXhwZWN0ZWRWYWx1ZS5zb21lKChlbnRyeSkgPT4gdGhpcy5maW5kQnlDb25kaXRpb25WYWx1ZU1hdGNoZXMoYWN0dWFsVmFsdWUsIGVudHJ5KSkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICghdGhpcy5maW5kQnlDb25kaXRpb25WYWx1ZU1hdGNoZXMoYWN0dWFsVmFsdWUsIGV4cGVjdGVkVmFsdWUpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5IGNvbmRpdGlvbiB2YWx1ZSBtYXRjaGVzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhY3R1YWxWYWx1ZSAtIEFjdHVhbCBtb2RlbCB2YWx1ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXhwZWN0ZWRWYWx1ZSAtIEV4cGVjdGVkIGZpbmQgY29uZGl0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHZhbHVlcyBtYXRjaC5cbiAgICovXG4gIHN0YXRpYyBmaW5kQnlDb25kaXRpb25WYWx1ZU1hdGNoZXMoYWN0dWFsVmFsdWUsIGV4cGVjdGVkVmFsdWUpIHtcbiAgICBpZiAoZXhwZWN0ZWRWYWx1ZSA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuIGFjdHVhbFZhbHVlID09PSBudWxsXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZXhwZWN0ZWRWYWx1ZSkpIHtcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheShhY3R1YWxWYWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGlmIChhY3R1YWxWYWx1ZS5sZW5ndGggIT09IGV4cGVjdGVkVmFsdWUubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuXG4gICAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgZXhwZWN0ZWRWYWx1ZS5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgICAgaWYgKCF0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZVtpbmRleF0sIGV4cGVjdGVkVmFsdWVbaW5kZXhdKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgaWYgKGV4cGVjdGVkVmFsdWUgJiYgdHlwZW9mIGV4cGVjdGVkVmFsdWUgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGlmICghYWN0dWFsVmFsdWUgfHwgdHlwZW9mIGFjdHVhbFZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoYWN0dWFsVmFsdWUpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhY3R1YWxPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGFjdHVhbFZhbHVlKVxuICAgICAgY29uc3QgZXhwZWN0ZWRPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGV4cGVjdGVkVmFsdWUpXG4gICAgICBjb25zdCBhY3R1YWxLZXlzID0gT2JqZWN0LmtleXMoYWN0dWFsT2JqZWN0KVxuICAgICAgY29uc3QgZXhwZWN0ZWRLZXlzID0gT2JqZWN0LmtleXMoZXhwZWN0ZWRPYmplY3QpXG5cbiAgICAgIGlmIChhY3R1YWxLZXlzLmxlbmd0aCAhPT0gZXhwZWN0ZWRLZXlzLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBrZXkgb2YgZXhwZWN0ZWRLZXlzKSB7XG4gICAgICAgIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGFjdHVhbE9iamVjdCwga2V5KSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxPYmplY3Rba2V5XSwgZXhwZWN0ZWRPYmplY3Rba2V5XSkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGlmIChhY3R1YWxWYWx1ZSA9PT0gZXhwZWN0ZWRWYWx1ZSkge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5maW5kQnlQcmltaXRpdmVWYWx1ZXNNYXRjaChhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgcHJpbWl0aXZlIHZhbHVlcyBtYXRjaC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYWN0dWFsVmFsdWUgLSBBY3R1YWwgbW9kZWwgdmFsdWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGV4cGVjdGVkVmFsdWUgLSBFeHBlY3RlZCBmaW5kIGNvbmRpdGlvbiB2YWx1ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBwcmltaXRpdmUgdmFsdWVzIG1hdGNoIGFmdGVyIHNhZmUgY29lcmNpb24uXG4gICAqL1xuICBzdGF0aWMgZmluZEJ5UHJpbWl0aXZlVmFsdWVzTWF0Y2goYWN0dWFsVmFsdWUsIGV4cGVjdGVkVmFsdWUpIHtcbiAgICBpZiAoYWN0dWFsVmFsdWUgaW5zdGFuY2VvZiBEYXRlICYmIHR5cGVvZiBleHBlY3RlZFZhbHVlID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkRXhwZWN0ZWRWYWx1ZSA9IG5vcm1hbGl6ZURhdGVTdHJpbmdGb3JXcml0ZShleHBlY3RlZFZhbHVlLCB7dGltZVpvbmU6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpfSlcblxuICAgICAgaWYgKG5vcm1hbGl6ZWRFeHBlY3RlZFZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgICByZXR1cm4gYWN0dWFsVmFsdWUudG9JU09TdHJpbmcoKSA9PT0gbm9ybWFsaXplZEV4cGVjdGVkVmFsdWUudG9JU09TdHJpbmcoKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYWN0dWFsVmFsdWUudG9JU09TdHJpbmcoKSA9PT0gZXhwZWN0ZWRWYWx1ZVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgYWN0dWFsVmFsdWUgPT09IFwic3RyaW5nXCIgJiYgZXhwZWN0ZWRWYWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgIHJldHVybiBhY3R1YWxWYWx1ZSA9PT0gZXhwZWN0ZWRWYWx1ZS50b0lTT1N0cmluZygpXG4gICAgfVxuXG4gICAgaWYgKGFjdHVhbFZhbHVlIGluc3RhbmNlb2YgRGF0ZSAmJiBleHBlY3RlZFZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgcmV0dXJuIGFjdHVhbFZhbHVlLnRvSVNPU3RyaW5nKCkgPT09IGV4cGVjdGVkVmFsdWUudG9JU09TdHJpbmcoKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgYWN0dWFsVmFsdWUgPT09IFwibnVtYmVyXCIgJiYgdHlwZW9mIGV4cGVjdGVkVmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLmZpbmRCeU51bWVyaWNTdHJpbmdNYXRjaGVzTnVtYmVyKGV4cGVjdGVkVmFsdWUsIGFjdHVhbFZhbHVlKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgYWN0dWFsVmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIGV4cGVjdGVkVmFsdWUgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLmZpbmRCeU51bWVyaWNTdHJpbmdNYXRjaGVzTnVtYmVyKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieSBudW1lcmljIHN0cmluZyBtYXRjaGVzIG51bWJlci5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IG51bWVyaWNTdHJpbmcgLSBOdW1lcmljIHN0cmluZyB2YWx1ZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGV4cGVjdGVkTnVtYmVyIC0gTnVtYmVyIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHZhbHVlcyByZXByZXNlbnQgdGhlIHNhbWUgbnVtYmVyLlxuICAgKi9cbiAgc3RhdGljIGZpbmRCeU51bWVyaWNTdHJpbmdNYXRjaGVzTnVtYmVyKG51bWVyaWNTdHJpbmcsIGV4cGVjdGVkTnVtYmVyKSB7XG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoZXhwZWN0ZWROdW1iZXIpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICBpZiAoIS9eLT9cXGQrKD86XFwuXFxkKyk/JC8udGVzdChudW1lcmljU3RyaW5nKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgcmV0dXJuIE51bWJlcihudW1lcmljU3RyaW5nKSA9PT0gZXhwZWN0ZWROdW1iZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtVcGRhdGVBdHRyaWJ1dGVzfSBbbmV3QXR0cmlidXRlc10gLSBOZXcgdmFsdWVzIHRvIGFzc2lnbiBiZWZvcmUgdXBkYXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0aGlzPn0gLSBVcGRhdGVkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgdXBkYXRlKG5ld0F0dHJpYnV0ZXMpIHtcbiAgICBpZiAobmV3QXR0cmlidXRlcykgdGhpcy5hc3NpZ25BdHRyaWJ1dGVzKG5ld0F0dHJpYnV0ZXMpXG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHt0aGlzfSAqLyAoYXdhaXQgdGhpcy5zYXZlKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2guXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGF0dGFjaG1lbnRJbnB1dCAtIEF0dGFjaG1lbnQgaW5wdXQgb3IgbmFtZWQgYXR0YWNobWVudCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGF0dGFjaGVkLlxuICAgKi9cbiAgYXN5bmMgYXR0YWNoKGF0dGFjaG1lbnRJbnB1dCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbnMgPSBNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9ucygpXG4gICAgY29uc3QgYXR0YWNobWVudE5hbWVzID0gT2JqZWN0LmtleXMoYXR0YWNobWVudERlZmluaXRpb25zKVxuICAgIGxldCBhdHRhY2htZW50TmFtZSA9IGF0dGFjaG1lbnROYW1lc1swXVxuICAgIGxldCBhY3R1YWxBdHRhY2htZW50SW5wdXQgPSBhdHRhY2htZW50SW5wdXRcblxuICAgIGlmIChmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzUGxhaW5PYmplY3QoYXR0YWNobWVudElucHV0KSkge1xuICAgICAgaWYgKFwiZmlsZVwiIGluIGF0dGFjaG1lbnRJbnB1dCAmJiBhdHRhY2htZW50RGVmaW5pdGlvbnMuZmlsZSkge1xuICAgICAgICBhdHRhY2htZW50TmFtZSA9IFwiZmlsZVwiXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgY2FuZGlkYXRlTmFtZSBvZiBhdHRhY2htZW50TmFtZXMpIHtcbiAgICAgICAgaWYgKGNhbmRpZGF0ZU5hbWUgaW4gYXR0YWNobWVudElucHV0KSB7XG4gICAgICAgICAgYXR0YWNobWVudE5hbWUgPSBjYW5kaWRhdGVOYW1lXG4gICAgICAgICAgYWN0dWFsQXR0YWNobWVudElucHV0ID0gYXR0YWNobWVudElucHV0W2NhbmRpZGF0ZU5hbWVdXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghYXR0YWNobWVudE5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gYXR0YWNobWVudCBkZWZpbml0aW9ucyBvbiAke01vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSkuYXR0YWNoKGFjdHVhbEF0dGFjaG1lbnRJbnB1dClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNhdmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHRoaXM+fSAtIFNhdmVkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgc2F2ZSgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgaXNOZXcgPSB0aGlzLmlzTmV3UmVjb3JkKClcbiAgICBjb25zdCBwcmV2aW91c0lkZW50aXR5ID0gaXNOZXcgPyBudWxsIDogdGhpcy5wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKVxuICAgIGNvbnN0IGNvbW1hbmRUeXBlID0gaXNOZXcgPyBcImNyZWF0ZVwiIDogXCJ1cGRhdGVcIlxuICAgIC8qKlxuICAgICAqIFBheWxvYWQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgYXR0cmlidXRlczogdGhpcy5fY2hhbmdlZEF0dHJpYnV0ZXNGb3JTYXZlKClcbiAgICB9XG5cbiAgICBpZiAoIWlzTmV3KSB7XG4gICAgICBwYXlsb2FkLmlkID0gdGhpcy5wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKVxuICAgIH1cblxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLl9idWlsZE5lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkKClcblxuICAgIGlmIChuZXN0ZWRBdHRyaWJ1dGVzICYmIE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgIHBheWxvYWQubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcbiAgICB9XG5cbiAgICBjb25zdCBhdHRhY2htZW50cyA9IGF3YWl0IHRoaXMuX2J1aWxkQXR0YWNobWVudHNQYXlsb2FkKClcblxuICAgIGlmIChPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkge1xuICAgICAgcGF5bG9hZC5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgfVxuXG4gICAgaWYgKHNob3VsZFF1ZXVlRnJvbnRlbmRNb2RlbE9wZXJhdGlvbk9mZmxpbmUoTW9kZWxDbGFzcywgY29tbWFuZFR5cGUpKSB7XG4gICAgICBjb25zdCBvZmZsaW5lQXR0cmlidXRlcyA9IHsuLi5wYXlsb2FkLmF0dHJpYnV0ZXN9XG4gICAgICBsZXQgY2xpZW50TXV0YXRpb25JZFxuXG4gICAgICBpZiAoaXNOZXcpIHtcbiAgICAgICAgY29uc3QgcHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgYE9mZmxpbmUgY3JlYXRlIGZvciAke01vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgICBjb25zdCBjdXJyZW50UHJpbWFyeUtleSA9IHRoaXMucmVhZEF0dHJpYnV0ZShwcmltYXJ5S2V5KVxuXG4gICAgICAgIGlmIChjdXJyZW50UHJpbWFyeUtleSA9PT0gdW5kZWZpbmVkIHx8IGN1cnJlbnRQcmltYXJ5S2V5ID09PSBudWxsKSB7XG4gICAgICAgICAgY2xpZW50TXV0YXRpb25JZCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcub2ZmbGluZVN5bmM/LmNsaWVudE11dGF0aW9uSWRcbiAgICAgICAgICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5vZmZsaW5lU3luYy5jbGllbnRNdXRhdGlvbklkKClcbiAgICAgICAgICAgIDogZnJvbnRlbmRNb2RlbE9mZmxpbmVNdXRhdGlvbklkKClcbiAgICAgICAgICB0aGlzLnNldEF0dHJpYnV0ZShwcmltYXJ5S2V5LCBjbGllbnRNdXRhdGlvbklkKVxuICAgICAgICAgIG9mZmxpbmVBdHRyaWJ1dGVzW3ByaW1hcnlLZXldID0gY2xpZW50TXV0YXRpb25JZFxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgT2ZmbGluZSB1cGRhdGUgZm9yICR7TW9kZWxDbGFzcy5uYW1lfWApXG5cbiAgICAgICAgb2ZmbGluZUF0dHJpYnV0ZXNbcHJpbWFyeUtleV0gPSBwYXlsb2FkLmlkXG4gICAgICB9XG5cbiAgICAgIGlmIChwYXlsb2FkLm5lc3RlZEF0dHJpYnV0ZXMgIT09IHVuZGVmaW5lZCB8fCBwYXlsb2FkLmF0dGFjaG1lbnRzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBPZmZsaW5lIHN5bmMgZm9yICR7TW9kZWxDbGFzcy5uYW1lfSBkb2VzIG5vdCBzdXBwb3J0IG5lc3RlZCBhdHRyaWJ1dGVzIG9yIGF0dGFjaG1lbnRzIHlldGApXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHF1ZXVlRnJvbnRlbmRNb2RlbE11dGF0aW9uT2ZmbGluZSh7XG4gICAgICAgIGF0dHJpYnV0ZXM6IG9mZmxpbmVBdHRyaWJ1dGVzLFxuICAgICAgICBjbGllbnRNdXRhdGlvbklkLFxuICAgICAgICBNb2RlbENsYXNzLFxuICAgICAgICBvcGVyYXRpb246IGNvbW1hbmRUeXBlXG4gICAgICB9KVxuICAgICAgdGhpcy5zZXRJc05ld1JlY29yZChmYWxzZSlcbiAgICAgIHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXMgPSBjbG9uZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKHRoaXMuYXR0cmlidXRlcygpKVxuICAgICAgdGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuICAgICAgdGhpcy5fY2xlYXJQZW5kaW5nQXR0YWNobWVudHMoKVxuXG4gICAgICByZXR1cm4gdGhpc1xuICAgIH1cblxuICAgIGNvbnN0IHJlbW92ZVRlbXBvcmFyeUxpc3RlbmVyQWxpYXNlcyA9IHByZXZpb3VzSWRlbnRpdHkgPT09IG51bGxcbiAgICAgID8gKCkgPT4ge31cbiAgICAgIDogYWxpYXNGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcnMoTW9kZWxDbGFzcywgdGhpcywgcHJldmlvdXNJZGVudGl0eSwgdGhpcy5wcmltYXJ5S2V5VmFsdWUoKSlcbiAgICBsZXQgcmVzcG9uc2VcblxuICAgIHRyeSB7XG4gICAgICByZXNwb25zZSA9IGF3YWl0IE1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoY29tbWFuZFR5cGUsIHBheWxvYWQpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJlbW92ZVRlbXBvcmFyeUxpc3RlbmVyQWxpYXNlcygpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJlbW92ZVRlbXBvcmFyeUxpc3RlbmVyQWxpYXNlcygpXG5cbiAgICB0aGlzLmFzc2lnbkF0dHJpYnV0ZXMoTW9kZWxDbGFzcy5hdHRyaWJ1dGVzRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSlcbiAgICB0aGlzLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuXG4gICAgaWYgKHByZXZpb3VzSWRlbnRpdHkgIT09IG51bGwpIHtcbiAgICAgIHJla2V5RnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKE1vZGVsQ2xhc3MsIHRoaXMsIHByZXZpb3VzSWRlbnRpdHksIHRoaXMucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgfVxuXG4gICAgdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXModGhpcy5hdHRyaWJ1dGVzKCkpXG4gICAgdGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIHRoaXMuX2NsZWFyUGVuZGluZ0F0dGFjaG1lbnRzKClcblxuICAgIHRoaXMuX3JlY29uY2lsZU5lc3RlZEF0dHJpYnV0ZXNGcm9tUmVzcG9uc2UocmVzcG9uc2UpXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHN1YnNldCBvZiBgX2F0dHJpYnV0ZXNgIHdob3NlIHZhbHVlIGhhcyBkaXZlcmdlZCBmcm9tXG4gICAqIGBfcGVyc2lzdGVkQXR0cmlidXRlc2AuIFVzZWQgYnkgYHNhdmUoKWAgc28gdGhlIHNlcnZlciByZWNlaXZlcyBvbmx5IHRoZVxuICAgKiBmaWVsZHMgdGhlIGNhbGxlciBhY3R1YWxseSBjaGFuZ2VkIOKAlCBhdm9pZGluZyBzdHJpY3QgcGVybWl0IHJlamVjdGlvbnMgb25cbiAgICogZnJhbWV3b3JrLW1hbmFnZWQgZmllbGRzIGxpa2UgYGlkYCwgYGNyZWF0ZWRBdGAsIGB1cGRhdGVkQXRgLCBvciBvd25lclxuICAgKiBmb3JlaWduIGtleXMgdGhhdCB0aGUgcmVzb3VyY2UgbmV2ZXIgbGlzdHMgaW4gYHBlcm1pdHRlZFBhcmFtc2AuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAtIENoYW5nZWQgYXR0cmlidXRlcyBoYXNoLlxuICAgKi9cbiAgX2NoYW5nZWRBdHRyaWJ1dGVzRm9yU2F2ZSgpIHtcbiAgICAvKipcbiAgICAgKiBDaGFuZ2VkIGF0dHJpYnV0ZXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovXG4gICAgY29uc3QgY2hhbmdlZEF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgW3ByZXZpb3VzVmFsdWUsIGN1cnJlbnRWYWx1ZV1dIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuY2hhbmdlcygpKSkge1xuICAgICAgaWYgKHRoaXMuaXNOZXdSZWNvcmQoKSAmJiBwcmV2aW91c1ZhbHVlID09PSB1bmRlZmluZWQgJiYgY3VycmVudFZhbHVlID09PSBudWxsKSBjb250aW51ZVxuXG4gICAgICBjaGFuZ2VkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IGN1cnJlbnRWYWx1ZVxuICAgIH1cblxuICAgIHJldHVybiBjaGFuZ2VkQXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIHRoZSBjdXJyZW50IHZhbHVlIGZvciBhbiBhdHRyaWJ1dGUgYXMgYWxyZWFkeSBwZXJzaXN0ZWQgc28gdGhlIG5leHRcbiAgICogc2F2ZSBkb2VzIG5vdCBzZW5kIGl0IHVubGVzcyB0aGUgY2FsbGVyIGNoYW5nZXMgaXQgYWdhaW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIHRvIG1hcmsgdW5jaGFuZ2VkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIG1hcmtBdHRyaWJ1dGVVbmNoYW5nZWQoYXR0cmlidXRlTmFtZSkge1xuICAgIHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBjbG9uZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKHt2YWx1ZTogdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXX0pLnZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZXN0cm95LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRlc3Ryb3llZCBvbiBiYWNrZW5kLlxuICAgKi9cbiAgYXN5bmMgZGVzdHJveSgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgaWQgPSB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG5cbiAgICBpZiAoc2hvdWxkUXVldWVGcm9udGVuZE1vZGVsT3BlcmF0aW9uT2ZmbGluZShNb2RlbENsYXNzLCBcImRlc3Ryb3lcIikpIHtcbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGBPZmZsaW5lIGRlc3Ryb3kgZm9yICR7TW9kZWxDbGFzcy5uYW1lfWApXG5cbiAgICAgIGF3YWl0IHF1ZXVlRnJvbnRlbmRNb2RlbE11dGF0aW9uT2ZmbGluZSh7XG4gICAgICAgIGF0dHJpYnV0ZXM6IHtbcHJpbWFyeUtleV06IGlkfSxcbiAgICAgICAgTW9kZWxDbGFzcyxcbiAgICAgICAgb3BlcmF0aW9uOiBcImRlc3Ryb3lcIlxuICAgICAgfSlcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcImRlc3Ryb3lcIiwge1xuICAgICAgaWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgYXR0YWNobWVudCBwYXlsb2FkIHF1ZXVlZCBvbiB0aGlzIG1vZGVsIGZvciB0aGUgbmV4dCBzYXZlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBBdHRhY2htZW50IHBheWxvYWQga2V5ZWQgYnkgYXR0YWNobWVudCBuYW1lLlxuICAgKi9cbiAgYXN5bmMgX2J1aWxkQXR0YWNobWVudHNQYXlsb2FkKCkge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7fVxuXG4gICAgZm9yIChjb25zdCBhdHRhY2htZW50TmFtZSBvZiBPYmplY3Qua2V5cyh0aGlzLl9hdHRhY2htZW50cykpIHtcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnRQYXlsb2FkID0gYXdhaXQgdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdLnBlbmRpbmdBdHRhY2htZW50c1BheWxvYWQoKVxuXG4gICAgICBpZiAoYXR0YWNobWVudFBheWxvYWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBwYXlsb2FkW2F0dGFjaG1lbnROYW1lXSA9IGF0dGFjaG1lbnRQYXlsb2FkXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBheWxvYWRcbiAgfVxuXG4gIC8qKiBDbGVhcnMgcXVldWVkIGF0dGFjaG1lbnQgaW5wdXRzIGFmdGVyIGEgc3VjY2Vzc2Z1bCBzYXZlLiAqL1xuICBfY2xlYXJQZW5kaW5nQXR0YWNobWVudHMoKSB7XG4gICAgZm9yIChjb25zdCBhdHRhY2htZW50TmFtZSBvZiBPYmplY3Qua2V5cyh0aGlzLl9hdHRhY2htZW50cykpIHtcbiAgICAgIHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXS5jbGVhclBlbmRpbmdBdHRhY2htZW50cygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFdhbGtzIHJlbGF0aW9uc2hpcHMgZGVjbGFyZWQgaW4gdGhpcyByZXNvdXJjZSdzIGBuZXN0ZWRBdHRyaWJ1dGVzYCBjb25maWdcbiAgICogYW5kIGJ1aWxkcyB0aGUgcGVyLXJlbGF0aW9uc2hpcCBwYXlsb2FkIG9mIGRpcnR5IGNoaWxkcmVuIGZvciBhIHBhcmVudCBzYXZlLlxuICAgKlxuICAgKiBJbmNsdWRlZCBjaGlsZHJlbjpcbiAgICogICAtIG5ldyByZWNvcmRzIChpc05ld1JlY29yZCgpKSDihpIgY3JlYXRlIGVudHJ5IHdpdGggYXR0cmlidXRlc1xuICAgKiAgIC0gcmVjb3JkcyBtYXJrZWQgZm9yIGRlc3RydWN0aW9uIChtYXJrZWRGb3JEZXN0cnVjdGlvbigpKSDihpIgZGVzdHJveSBlbnRyeVxuICAgKiAgIC0gcmVjb3JkcyB3aXRoIGNoYW5nZWQgYXR0cmlidXRlcyAoaXNDaGFuZ2VkKCkpIOKGkiB1cGRhdGUgZW50cnkgd2l0aCBhdHRyaWJ1dGVzXG4gICAqICAgLSByZWNvcmRzIHdpdGggZGlydHkgZGVzY2VuZGFudHMgaW4gdGhlaXIgb3duIG5lc3RlZEF0dHJpYnV0ZXMg4oaSIHJlY3Vyc2VcbiAgICpcbiAgICogTG9hZGVkIGJ1dCB1bnRvdWNoZWQgcmVjb3JkcyBhcmUgb21pdHRlZCBzbyBuZXN0ZWQgc2F2ZSBwcmVzZXJ2ZXMgUmFpbHMtc3R5bGVcbiAgICogXCJjaGlsZHJlbiBub3QgcmVmZXJlbmNlZCBpbiBwYXlsb2FkIGFyZSBsZWZ0IGFsb25lXCIgc2VtYW50aWNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pj59IC0gUGVyLXJlbGF0aW9uc2hpcCBsaXN0IG9mIG5lc3RlZC1hdHRyaWJ1dGUgZW50cmllcy5cbiAgICovXG4gIGFzeW5jIF9idWlsZE5lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkKCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKVxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXNDb25maWcgPSByZXNvdXJjZUNvbmZpZz8ubmVzdGVkQXR0cmlidXRlc1xuXG4gICAgaWYgKCFuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnKSByZXR1cm4ge31cblxuICAgIC8qKlxuICAgICAqIFBheWxvYWQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+fSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7fVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXNDb25maWcpKSB7XG4gICAgICAvKiogQHR5cGUge0FycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgICBjb25zdCBlbnRyaWVzID0gW11cbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuX3JlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgaWYgKHJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwICYmIEFycmF5LmlzQXJyYXkocmVsYXRpb25zaGlwLl9sb2FkZWRWYWx1ZSkpIHtcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiByZWxhdGlvbnNoaXAuX2xvYWRlZFZhbHVlKSB7XG4gICAgICAgICAgY29uc3QgY2hpbGRFbnRyeSA9IGF3YWl0IGNoaWxkLl9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlGb3JQYXJlbnRTYXZlKClcblxuICAgICAgICAgIGlmIChjaGlsZEVudHJ5KSBlbnRyaWVzLnB1c2goY2hpbGRFbnRyeSlcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChyZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXAgJiYgcmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSB7XG4gICAgICAgIGNvbnN0IGNoaWxkID0gcmVsYXRpb25zaGlwLmxvYWRlZCgpXG5cbiAgICAgICAgaWYgKGNoaWxkIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEJhc2UpIHtcbiAgICAgICAgICBjb25zdCBjaGlsZEVudHJ5ID0gYXdhaXQgY2hpbGQuX25lc3RlZEF0dHJpYnV0ZXNFbnRyeUZvclBhcmVudFNhdmUoKVxuXG4gICAgICAgICAgaWYgKGNoaWxkRW50cnkpIGVudHJpZXMucHVzaChjaGlsZEVudHJ5KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwodGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXMsIHJlbGF0aW9uc2hpcE5hbWUpKSB7XG4gICAgICAgIGVudHJpZXMucHVzaChcbiAgICAgICAgICAuLi5hd2FpdCB0aGlzLl9uZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKFxuICAgICAgICAgICAgTW9kZWxDbGFzcyxcbiAgICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgICB0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlc1tyZWxhdGlvbnNoaXBOYW1lXVxuICAgICAgICAgIClcbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICBpZiAoZW50cmllcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHBheWxvYWRbcmVsYXRpb25zaGlwTmFtZV0gPSBlbnRyaWVzXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBheWxvYWRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIHBheWxvYWQgZW50cnkgZm9yIHRoaXMgY2hpbGQgd2hlbiB3YWxrZWQgYnkgYSBwYXJlbnQnc1xuICAgKiBgX2J1aWxkTmVzdGVkQXR0cmlidXRlc1BheWxvYWRgLiBSZXR1cm5zIGBudWxsYCB3aGVuIHRoZSBjaGlsZCBoYXMgbm9cbiAgICogZGlydHkgc3RhdGUgYW5kIG5vIGRpcnR5IGRlc2NlbmRhbnRzLCBzbyB0aGUgcGFyZW50IGNhbiBvbWl0IGl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsPn0gLSBOZXN0ZWQtYXR0cmlidXRlIGVudHJ5IG9yIG51bGwgaWYgY2xlYW4uXG4gICAqL1xuICBhc3luYyBfbmVzdGVkQXR0cmlidXRlc0VudHJ5Rm9yUGFyZW50U2F2ZSgpIHtcbiAgICBpZiAodGhpcy5tYXJrZWRGb3JEZXN0cnVjdGlvbigpKSB7XG4gICAgICBpZiAodGhpcy5pc05ld1JlY29yZCgpKSByZXR1cm4gbnVsbFxuICAgICAgcmV0dXJuIHtpZDogdGhpcy5wcmltYXJ5S2V5VmFsdWUoKSwgX2Rlc3Ryb3k6IHRydWV9XG4gICAgfVxuXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMuX2J1aWxkTmVzdGVkQXR0cmlidXRlc1BheWxvYWQoKVxuICAgIGNvbnN0IGhhc05lc3RlZERpcnR5ID0gT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykubGVuZ3RoID4gMFxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gYXdhaXQgdGhpcy5fYnVpbGRBdHRhY2htZW50c1BheWxvYWQoKVxuICAgIGNvbnN0IGhhc0F0dGFjaG1lbnRzID0gT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDBcblxuICAgIGlmICh0aGlzLmlzTmV3UmVjb3JkKCkpIHtcbiAgICAgIC8qKlxuICAgICAgICogRW50cnkuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3QgZW50cnkgPSB7fVxuICAgICAgY29uc3QgYXR0cmlidXRlcyA9IHRoaXMuX2NoYW5nZWRBdHRyaWJ1dGVzRm9yU2F2ZSgpXG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSBlbnRyeS5hdHRyaWJ1dGVzID0gYXR0cmlidXRlc1xuICAgICAgaWYgKGhhc0F0dGFjaG1lbnRzKSBlbnRyeS5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgICBpZiAoaGFzTmVzdGVkRGlydHkpIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgPSBuZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICAgIHJldHVybiBlbnRyeVxuICAgIH1cblxuICAgIGlmICghdGhpcy5pc0NoYW5nZWQoKSAmJiAhaGFzTmVzdGVkRGlydHkgJiYgIWhhc0F0dGFjaG1lbnRzKSByZXR1cm4gbnVsbFxuXG4gICAgLyoqXG4gICAgICogRW50cnkuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBlbnRyeSA9IHtpZDogdGhpcy5wcmltYXJ5S2V5VmFsdWUoKX1cblxuICAgIGlmICh0aGlzLmlzQ2hhbmdlZCgpKSBlbnRyeS5hdHRyaWJ1dGVzID0gdGhpcy5fY2hhbmdlZEF0dHJpYnV0ZXNGb3JTYXZlKClcbiAgICBpZiAoaGFzQXR0YWNobWVudHMpIGVudHJ5LmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICBpZiAoaGFzTmVzdGVkRGlydHkpIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgPSBuZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICByZXR1cm4gZW50cnlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgbmVzdGVkIGVudHJpZXMgZnJvbSBhIFJhaWxzLXN0eWxlIHN1Ym1pdHRlZCBgKkF0dHJpYnV0ZXNgIHZhbHVlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIFBhcmVudCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBOZXN0ZWQgcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU3VibWl0dGVkIG5lc3RlZCBhdHRyaWJ1dGVzIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pn0gTmVzdGVkIGVudHJpZXMgZm9yIHRoZSB0cmFuc3BvcnQgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIF9uZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKE1vZGVsQ2xhc3MsIHJlbGF0aW9uc2hpcE5hbWUsIHZhbHVlKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwRGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKVxuICAgIGNvbnN0IFRhcmdldE1vZGVsQ2xhc3MgPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcE1vZGVsQ2xhc3MocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmICghcmVsYXRpb25zaGlwRGVmaW5pdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG5lc3RlZCByZWxhdGlvbnNoaXA6ICR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFUYXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyBjb25maWd1cmVkIGZvciAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcFR5cGVJc0NvbGxlY3Rpb24ocmVsYXRpb25zaGlwRGVmaW5pdGlvbi50eXBlKSkge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9QXR0cmlidXRlcyBtdXN0IGJlIGFuIGFycmF5YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICB2YWx1ZS5tYXAoYXN5bmMgKGVudHJ5KSA9PiBhd2FpdCB0aGlzLl9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoVGFyZ2V0TW9kZWxDbGFzcywgZW50cnkpKVxuICAgICAgKVxuICAgIH1cblxuICAgIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gW11cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1BdHRyaWJ1dGVzIG11c3QgYmUgYW4gb2JqZWN0YClcbiAgICB9XG5cbiAgICByZXR1cm4gW2F3YWl0IHRoaXMuX25lc3RlZEF0dHJpYnV0ZXNFbnRyeVBheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShUYXJnZXRNb2RlbENsYXNzLCB2YWx1ZSldXG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgb25lIHN1Ym1pdHRlZCBSYWlscy1zdHlsZSBuZXN0ZWQgYXR0cmlidXRlcyBvYmplY3QgaW50byB0cmFuc3BvcnQgcGF5bG9hZCBzaGFwZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBOZXN0ZWQgY2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHN1Ym1pdHRlZEVudHJ5IC0gU3VibWl0dGVkIG5lc3RlZCBhdHRyaWJ1dGVzIGVudHJ5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBUcmFuc3BvcnQgbmVzdGVkLWF0dHJpYnV0ZXMgZW50cnkuXG4gICAqL1xuICBhc3luYyBfbmVzdGVkQXR0cmlidXRlc0VudHJ5UGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKE1vZGVsQ2xhc3MsIHN1Ym1pdHRlZEVudHJ5KSB7XG4gICAgaWYgKCFmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzUGxhaW5PYmplY3Qoc3VibWl0dGVkRW50cnkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7TW9kZWxDbGFzcy5uYW1lfSBuZXN0ZWQgYXR0cmlidXRlcyBlbnRyaWVzIG11c3QgYmUgb2JqZWN0c2ApXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgZW50cnkgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+fSAqL1xuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHN1Ym1pdHRlZEVudHJ5KSkge1xuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiaWRcIiB8fCBhdHRyaWJ1dGVOYW1lID09PSBcIl9kZXN0cm95XCIpIHtcbiAgICAgICAgZW50cnlbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lID0gTW9kZWxDbGFzcy5uZXN0ZWRBdHRyaWJ1dGVzUmVsYXRpb25zaGlwTmFtZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgICBpZiAobmVzdGVkUmVsYXRpb25zaGlwTmFtZSkge1xuICAgICAgICBuZXN0ZWRBdHRyaWJ1dGVzW25lc3RlZFJlbGF0aW9uc2hpcE5hbWVdID0gYXdhaXQgdGhpcy5fbmVzdGVkQXR0cmlidXRlc1BheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShcbiAgICAgICAgICBNb2RlbENsYXNzLFxuICAgICAgICAgIG5lc3RlZFJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgdmFsdWVcbiAgICAgICAgKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbihhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgICBhdHRhY2htZW50c1thdHRyaWJ1dGVOYW1lXSA9IGF3YWl0IHRoaXMuX2F0dGFjaG1lbnRQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoTW9kZWxDbGFzcywgYXR0cmlidXRlTmFtZSwgdmFsdWUpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSBlbnRyeS5hdHRyaWJ1dGVzID0gYXR0cmlidXRlc1xuICAgIGlmIChPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkgZW50cnkuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgIGlmIChPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuXG4gICAgcmV0dXJuIGVudHJ5XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIHN1Ym1pdHRlZCBhdHRhY2htZW50IHZhbHVlIGZvciB0cmFuc3BvcnQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gTW9kZWwgY2xhc3Mgb3duaW5nIHRoZSBhdHRhY2htZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU3VibWl0dGVkIGF0dGFjaG1lbnQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdPn0gTm9ybWFsaXplZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBfYXR0YWNobWVudFBheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShNb2RlbENsYXNzLCBhdHRhY2htZW50TmFtZSwgdmFsdWUpIHtcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24oYXR0YWNobWVudE5hbWUpXG5cbiAgICBpZiAoYXR0YWNobWVudERlZmluaXRpb24/LnR5cGUgPT09IFwiaGFzTWFueVwiKSB7XG4gICAgICBjb25zdCB2YWx1ZXMgPSBBcnJheS5pc0FycmF5KHZhbHVlKSA/IHZhbHVlIDogW3ZhbHVlXVxuXG4gICAgICByZXR1cm4gYXdhaXQgUHJvbWlzZS5hbGwodmFsdWVzLm1hcChhc3luYyAoZW50cnkpID0+IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGVudHJ5KSkpXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBjb25zdCBsYXN0VmFsdWUgPSB2YWx1ZVt2YWx1ZS5sZW5ndGggLSAxXVxuXG4gICAgICBpZiAobGFzdFZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke01vZGVsQ2xhc3MubmFtZX0jJHthdHRhY2htZW50TmFtZX0gYXR0YWNobWVudCBhcnJheSBjYW5ub3QgYmUgZW1wdHlgKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQobGFzdFZhbHVlKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBZnRlciBhIHBhcmVudCBzYXZlIHdpdGggYG5lc3RlZEF0dHJpYnV0ZXNgLCB0aGUgc2VydmVyIHJlc3BvbnNlIGluY2x1ZGVzXG4gICAqIHByZWxvYWRlZCB2ZXJzaW9ucyBvZiB0aGUgYWZmZWN0ZWQgcmVsYXRpb25zaGlwcy4gVGhpcyByZXBsYWNlcyB0aGUgbG9jYWxcbiAgICogYF9sb2FkZWRWYWx1ZWAgZm9yIGVhY2ggbmVzdGVkLXdyaXRhYmxlIHJlbGF0aW9uc2hpcCB3aXRoIHRoZSBzZXJ2ZXInc1xuICAgKiBhdXRob3JpdGF0aXZlIHNldCwgc28gZGVzdHJveWVkIGNoaWxkcmVuIGFyZSBkcm9wcGVkIGFuZCBuZXdseS1jcmVhdGVkXG4gICAqIGNoaWxkcmVuIGdldCB0aGVpciBzZXJ2ZXItYXNzaWduZWQgaWRzICsgcGVyc2lzdGVkIHN0YXRlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcmVzcG9uc2UgLSBDb21tYW5kIHJlc3BvbnNlIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlY29uY2lsZU5lc3RlZEF0dHJpYnV0ZXNGcm9tUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSBNb2RlbENsYXNzLnJlc291cmNlQ29uZmlnKClcbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnID0gcmVzb3VyY2VDb25maWc/Lm5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIGlmICghbmVzdGVkQXR0cmlidXRlc0NvbmZpZykgcmV0dXJuXG5cbiAgICBjb25zdCBtb2RlbERhdGEgPSBNb2RlbENsYXNzLm1vZGVsRGF0YUZyb21SZXNwb25zZShyZXNwb25zZSlcbiAgICBjb25zdCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzID0gbW9kZWxEYXRhLnByZWxvYWRlZFJlbGF0aW9uc2hpcHNcblxuICAgIC8qKlxuICAgICAqIFJlbGV2YW50IHByZWxvYWRzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcmVsZXZhbnRQcmVsb2FkcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlc0NvbmZpZykpIHtcbiAgICAgIGlmIChyZWxhdGlvbnNoaXBOYW1lIGluIHByZWxvYWRlZFJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgcmVsZXZhbnRQcmVsb2Fkc1tyZWxhdGlvbnNoaXBOYW1lXSA9IHByZWxvYWRlZFJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMocmVsZXZhbnRQcmVsb2FkcykubGVuZ3RoID4gMCkge1xuICAgICAgTW9kZWxDbGFzcy5hcHBseVByZWxvYWRlZFJlbGF0aW9uc2hpcHModGhpcywgcmVsZXZhbnRQcmVsb2FkcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBleGVjdXRlIGNvbW1hbmQuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENvbW1hbmRUeXBlfSBjb21tYW5kVHlwZSAtIENvbW1hbmQgdHlwZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBheWxvYWQgLSBDb21tYW5kIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUGFyc2VkIEpTT04gcmVzcG9uc2UuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZXhlY3V0ZUNvbW1hbmQoY29tbWFuZFR5cGUsIHBheWxvYWQpIHtcbiAgICBjb25zdCBjb21tYW5kTmFtZSA9IHRoaXMuY29tbWFuZE5hbWUoY29tbWFuZFR5cGUpXG4gICAgY29uc3QgdGltZVpvbmUgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKVxuICAgIGNvbnN0IHNlcmlhbGl6ZWRQYXlsb2FkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocGF5bG9hZCwge3RpbWVab25lfSkpXG4gICAgY29uc3QgcmVxdWVzdENvbnRleHQgPSBmcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoKVxuICAgIGNvbnN0IHJlcXVlc3RQYXlsb2FkID0gbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQsIHNlcmlhbGl6ZWRQYXlsb2FkKVxuICAgIGNvbnN0IHJlc291cmNlUGF0aCA9IHRoaXMucmVzb3VyY2VQYXRoKClcbiAgICBjb25zdCBjb250YWluc0F0dGFjaG1lbnRVcGxvYWQgPSBmcm9udGVuZE1vZGVsUGF5bG9hZENvbnRhaW5zQXR0YWNobWVudFVwbG9hZChzZXJpYWxpemVkUGF5bG9hZClcbiAgICBjb25zdCB1c2VTaGFyZWRUcmFuc3BvcnQgPSAhY29udGFpbnNBdHRhY2htZW50VXBsb2FkXG4gICAgY29uc3QgdXJsID0gdXNlU2hhcmVkVHJhbnNwb3J0ID8gZnJvbnRlbmRNb2RlbEFwaVVybCgpIDogZnJvbnRlbmRNb2RlbENvbW1hbmRVcmwocmVzb3VyY2VQYXRoIHx8IFwiXCIsIGNvbW1hbmROYW1lKVxuXG4gICAgaWYgKHVzZVNoYXJlZFRyYW5zcG9ydCkge1xuICAgICAgY29uc3QgYmF0Y2hSZXNwb25zZSA9IGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cy5wdXNoKHtcbiAgICAgICAgICBjb21tYW5kTmFtZSxcbiAgICAgICAgICBjb21tYW5kVHlwZSxcbiAgICAgICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgICAgIHBheWxvYWQ6IHNlcmlhbGl6ZWRQYXlsb2FkLFxuICAgICAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAgICAgIHJlamVjdCxcbiAgICAgICAgICByZXF1ZXN0SWQ6IGAkeysrc2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RJZH1gLFxuICAgICAgICAgIHJlc29sdmUsXG4gICAgICAgICAgcmVzb3VyY2VQYXRoXG4gICAgICAgIH0pXG5cbiAgICAgICAgc2NoZWR1bGVTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdEZsdXNoKClcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IGRlY29kZWRCYXRjaFJlc3BvbnNlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChiYXRjaFJlc3BvbnNlKVxuXG4gICAgICB0aGlzLnRocm93T25FcnJvckZyb250ZW5kTW9kZWxSZXNwb25zZSh7XG4gICAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgICByZXNwb25zZTogZGVjb2RlZEJhdGNoUmVzcG9uc2VcbiAgICAgIH0pXG5cbiAgICAgIHJldHVybiBkZWNvZGVkQmF0Y2hSZXNwb25zZVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0cmFja0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0KGFzeW5jICgpID0+IHJ1bldpdGhUcmFuc3BvcnREZWFkbGluZShcbiAgICAgIHtcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBgJHt0aGlzLm5hbWV9IyR7Y29tbWFuZFR5cGV9IHJlcXVlc3QgdGltZWQgb3V0YCxcbiAgICAgICAgc2lnbmFsOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCksXG4gICAgICAgIHRpbWVvdXRNczogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVvdXRNcygpXG4gICAgICB9LFxuICAgICAgYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgICBjb25zdCBkaXJlY3RSZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybCwge1xuICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlcXVlc3RQYXlsb2FkKSxcbiAgICAgICAgICBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIsXG4gICAgICAgICAgaGVhZGVyczogZnJvbnRlbmRNb2RlbFJlcXVlc3RIZWFkZXJzKHRpbWVab25lKSxcbiAgICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICAgIHNpZ25hbFxuICAgICAgICB9KVxuXG4gICAgICAgIGNvbnN0IGRpcmVjdFJlc3BvbnNlVGV4dCA9IGF3YWl0IGRpcmVjdFJlc3BvbnNlLnRleHQoKVxuXG4gICAgICAgIGlmICghZGlyZWN0UmVzcG9uc2Uub2spIHtcbiAgICAgICAgICB0aHJvd0Zyb250ZW5kTW9kZWxIdHRwRXJyb3Ioe1xuICAgICAgICAgICAgY29tbWFuZExhYmVsOiBgJHt0aGlzLm5hbWV9IyR7Y29tbWFuZFR5cGV9YCxcbiAgICAgICAgICAgIHJlc3BvbnNlOiBkaXJlY3RSZXNwb25zZSxcbiAgICAgICAgICAgIHJlc3BvbnNlVGV4dDogZGlyZWN0UmVzcG9uc2VUZXh0XG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGRpcmVjdEpzb24gPSBkaXJlY3RSZXNwb25zZVRleHQubGVuZ3RoID4gMCA/IEpTT04ucGFyc2UoZGlyZWN0UmVzcG9uc2VUZXh0KSA6IHt9XG4gICAgICAgIGNvbnN0IGRlY29kZWREaXJlY3RSZXNwb25zZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoZGlyZWN0SnNvbikpXG5cbiAgICAgICAgdGhpcy50aHJvd09uRXJyb3JGcm9udGVuZE1vZGVsUmVzcG9uc2Uoe1xuICAgICAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgICAgIHJlc3BvbnNlOiBkZWNvZGVkRGlyZWN0UmVzcG9uc2VcbiAgICAgICAgfSlcblxuICAgICAgICByZXR1cm4gZGVjb2RlZERpcmVjdFJlc3BvbnNlXG4gICAgICB9XG4gICAgKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUgY3VzdG9tIGNvbW1hbmQuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7e2NvbW1hbmROYW1lOiBzdHJpbmcsIGNvbW1hbmRUeXBlOiBGcm9udGVuZE1vZGVsUmVxdWVzdENvbW1hbmRUeXBlLCBtZW1iZXJJZD86IHN0cmluZyB8IG51bWJlciB8IG51bGwsIHBheWxvYWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgcmVzb3VyY2VQYXRoOiBzdHJpbmd9fSBhcmdzIC0gQ29tbWFuZCBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4+fSAtIERlY29kZWQgcmVzcG9uc2UgcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBleGVjdXRlQ3VzdG9tQ29tbWFuZChhcmdzKSB7XG4gICAgY29uc3Qge2NvbW1hbmROYW1lLCBjb21tYW5kVHlwZSwgbWVtYmVySWQgPSBudWxsLCBwYXlsb2FkLCByZXNvdXJjZVBhdGh9ID0gYXJnc1xuICAgIGNvbnN0IHRpbWVab25lID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKClcbiAgICBjb25zdCBzZXJpYWxpemVkUGF5bG9hZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHBheWxvYWQsIHt0aW1lWm9uZX0pKVxuICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KClcblxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0LCBzZXJpYWxpemVkUGF5bG9hZClcbiAgICBjb25zdCBjdXN0b21QYXRoID0gZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRQYXRoKHtcbiAgICAgIGNvbW1hbmROYW1lLFxuICAgICAgbWVtYmVySWQsXG4gICAgICBtb2RlbE5hbWU6IHRoaXMuZ2V0TW9kZWxOYW1lKCksXG4gICAgICByZXNvdXJjZVBhdGhcbiAgICB9KVxuXG4gICAgY29uc3QgYmF0Y2hSZXNwb25zZSA9IGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMucHVzaCh7XG4gICAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgICBjdXN0b21QYXRoLFxuICAgICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgICBwYXlsb2FkOiBzZXJpYWxpemVkUGF5bG9hZCxcbiAgICAgICAgcmVxdWVzdENvbnRleHQsXG4gICAgICAgIHJlamVjdCxcbiAgICAgICAgcmVxdWVzdElkOiBgJHsrK3NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0SWR9YCxcbiAgICAgICAgcmVzb2x2ZVxuICAgICAgfSlcblxuICAgICAgc2NoZWR1bGVTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdEZsdXNoKClcbiAgICB9KVxuXG4gICAgY29uc3QgZGVjb2RlZEJhdGNoUmVzcG9uc2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChiYXRjaFJlc3BvbnNlKVxuXG4gICAgdGhpcy50aHJvd09uRXJyb3JGcm9udGVuZE1vZGVsUmVzcG9uc2Uoe1xuICAgICAgY29tbWFuZFR5cGUsXG4gICAgICByZXNwb25zZTogZGVjb2RlZEJhdGNoUmVzcG9uc2VcbiAgICB9KVxuXG4gICAgcmV0dXJuIGRlY29kZWRCYXRjaFJlc3BvbnNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aHJvdyBvbiBlcnJvciBmcm9udGVuZCBtb2RlbCByZXNwb25zZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHt7Y29tbWFuZFR5cGU6IEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29tbWFuZFR5cGUsIHJlc3BvbnNlOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyB0aHJvd09uRXJyb3JGcm9udGVuZE1vZGVsUmVzcG9uc2UoYXJncykge1xuICAgIGNvbnN0IHtjb21tYW5kVHlwZSwgcmVzcG9uc2V9ID0gYXJnc1xuICAgIGlmIChyZXNwb25zZT8uc3RhdHVzICE9PSBcImVycm9yXCIpIHJldHVyblxuXG4gICAgY29uc3QgcmVzcG9uc2VLZXlzID0gT2JqZWN0LmtleXMocmVzcG9uc2UpXG4gICAgY29uc3QgaGFzT25seVN0YXR1cyA9IHJlc3BvbnNlS2V5cy5sZW5ndGggPT09IDEgJiYgcmVzcG9uc2VLZXlzWzBdID09PSBcInN0YXR1c1wiXG4gICAgY29uc3QgaGFzRXJyb3JNZXNzYWdlID0gdHlwZW9mIHJlc3BvbnNlLmVycm9yTWVzc2FnZSA9PT0gXCJzdHJpbmdcIiAmJiByZXNwb25zZS5lcnJvck1lc3NhZ2UubGVuZ3RoID4gMFxuICAgIGNvbnN0IGhhc0Vycm9yRW52ZWxvcGVLZXlzID0gQm9vbGVhbihcbiAgICAgIHJlc3BvbnNlLmNvZGUgIT09IHVuZGVmaW5lZFxuICAgICAgfHwgcmVzcG9uc2UuZXJyb3IgIT09IHVuZGVmaW5lZFxuICAgICAgfHwgcmVzcG9uc2UuZXJyb3JzICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHJlc3BvbnNlLm1lc3NhZ2UgIT09IHVuZGVmaW5lZFxuICAgIClcbiAgICBjb25zdCBub25TdGF0dXNLZXlzID0gcmVzcG9uc2VLZXlzLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwic3RhdHVzXCIpXG4gICAgY29uc3QgY29uZmlndXJlZEF0dHJpYnV0ZU5hbWVzID0gdGhpcy5jb25maWd1cmVkRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZU5hbWVzKClcbiAgICBjb25zdCBsb29rc0xpa2VSYXdNb2RlbFBheWxvYWQgPSBub25TdGF0dXNLZXlzLmxlbmd0aCA+IDBcbiAgICAgICYmIG5vblN0YXR1c0tleXMuZXZlcnkoKGtleSkgPT4gY29uZmlndXJlZEF0dHJpYnV0ZU5hbWVzLmhhcyhrZXkpKVxuXG4gICAgaWYgKCFoYXNFcnJvck1lc3NhZ2UgJiYgIWhhc09ubHlTdGF0dXMgJiYgIWhhc0Vycm9yRW52ZWxvcGVLZXlzICYmIGxvb2tzTGlrZVJhd01vZGVsUGF5bG9hZCkgcmV0dXJuXG5cbiAgICBjb25zdCBkZWJ1Z0Vycm9yTWVzc2FnZSA9IHR5cGVvZiByZXNwb25zZS5kZWJ1Z0Vycm9yTWVzc2FnZSA9PT0gXCJzdHJpbmdcIiAmJiByZXNwb25zZS5kZWJ1Z0Vycm9yTWVzc2FnZS5sZW5ndGggPiAwXG4gICAgICA/IHJlc3BvbnNlLmRlYnVnRXJyb3JNZXNzYWdlXG4gICAgICA6IG51bGxcbiAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBkZWJ1Z0Vycm9yTWVzc2FnZSB8fCAoaGFzRXJyb3JNZXNzYWdlXG4gICAgICA/IHJlc3BvbnNlLmVycm9yTWVzc2FnZVxuICAgICAgOiBgUmVxdWVzdCBmYWlsZWQgZm9yICR7dGhpcy5uYW1lfSMke2NvbW1hbmRUeXBlfWApXG5cbiAgICBjb25zdCBlcnJvciA9IC8qKiBAdHlwZSB7RXJyb3IgJiB7Y29ycmVsYXRpb25JZD86IHN0cmluZywgZGV0YWlscz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXJyb3JNZXNzYWdlPzogc3RyaW5nLCB2ZWxvY2lvdXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGVycm9yVHlwZT86IHN0cmluZywgdmFsaWRhdGlvbkVycm9ycz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZGVidWdFcnJvckNsYXNzPzogc3RyaW5nLCBkZWJ1Z0JhY2t0cmFjZT86IHN0cmluZ1tdfX0gKi8gKG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpKVxuICAgIGlmIChoYXNFcnJvck1lc3NhZ2UpIHtcbiAgICAgIGVycm9yLmVycm9yTWVzc2FnZSA9IHJlc3BvbnNlLmVycm9yTWVzc2FnZVxuICAgIH1cbiAgICBpZiAocmVzcG9uc2UudmVsb2Npb3VzICYmIHR5cGVvZiByZXNwb25zZS52ZWxvY2lvdXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGVycm9yLnZlbG9jaW91cyA9IHJlc3BvbnNlLnZlbG9jaW91c1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHJlc3BvbnNlLmVycm9yVHlwZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgZXJyb3IuZXJyb3JUeXBlID0gcmVzcG9uc2UuZXJyb3JUeXBlXG4gICAgfVxuICAgIGlmIChyZXNwb25zZS52YWxpZGF0aW9uRXJyb3JzICYmIHR5cGVvZiByZXNwb25zZS52YWxpZGF0aW9uRXJyb3JzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBlcnJvci52YWxpZGF0aW9uRXJyb3JzID0gcmVzcG9uc2UudmFsaWRhdGlvbkVycm9yc1xuICAgIH1cbiAgICBpZiAocmVzcG9uc2UuZGV0YWlscyAmJiB0eXBlb2YgcmVzcG9uc2UuZGV0YWlscyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgZXJyb3IuZGV0YWlscyA9IHJlc3BvbnNlLmRldGFpbHNcbiAgICB9XG4gICAgaWYgKHR5cGVvZiByZXNwb25zZS5jb3JyZWxhdGlvbklkID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBlcnJvci5jb3JyZWxhdGlvbklkID0gcmVzcG9uc2UuY29ycmVsYXRpb25JZFxuICAgIH1cbiAgICAvLyBGb3J3YXJkIHNlcnZlci1wcm92aWRlZCBkZWJ1ZyBkZXRhaWwgKGluY2x1ZGVkIG9ubHkgd2hlbiB0aGUgYmFja2VuZFxuICAgIC8vIGRlZW1zIHRoZSByZXF1ZXN0ZXIgYWxsb3dlZCB0byBzZWUgaXQsIGUuZy4gYW4gYWRtaW4pIHNvIGNhbGxlcnMgY2FuXG4gICAgLy8gcmVuZGVyIHRoZSByZWFsIGVycm9yIGNsYXNzIGFuZCBzdGFjayB0cmFjZSBpbnN0ZWFkIG9mIHRoZSBnZW5lcmljXG4gICAgLy8gY2xpZW50LXNhZmUgbWVzc2FnZS5cbiAgICBpZiAodHlwZW9mIHJlc3BvbnNlLmRlYnVnRXJyb3JDbGFzcyA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgZXJyb3IuZGVidWdFcnJvckNsYXNzID0gcmVzcG9uc2UuZGVidWdFcnJvckNsYXNzXG4gICAgfVxuICAgIGlmIChBcnJheS5pc0FycmF5KHJlc3BvbnNlLmRlYnVnQmFja3RyYWNlKSkge1xuICAgICAgZXJyb3IuZGVidWdCYWNrdHJhY2UgPSByZXNwb25zZS5kZWJ1Z0JhY2t0cmFjZVxuICAgIH1cbiAgICB0aHJvdyBlcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uZmlndXJlZCBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBDb25maWd1cmVkIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICovXG4gIHN0YXRpYyBjb25maWd1cmVkRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZU5hbWVzKCkge1xuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0aGlzLnJlc291cmNlQ29uZmlnKCkpXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHJlc291cmNlQ29uZmlnLmF0dHJpYnV0ZXNcblxuICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSB7XG4gICAgICByZXR1cm4gbmV3IFNldChhdHRyaWJ1dGVzLmZpbHRlcigoYXR0cmlidXRlTmFtZSkgPT4gdHlwZW9mIGF0dHJpYnV0ZU5hbWUgPT09IFwic3RyaW5nXCIpKVxuICAgIH1cblxuICAgIGlmIChhdHRyaWJ1dGVzICYmIHR5cGVvZiBhdHRyaWJ1dGVzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm4gbmV3IFNldChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKSlcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IFNldCgpXG4gIH1cbn1cblxuLyoqIFB1YmxpYyBmcm9udGVuZCBtb2RlbCBmb3Igc2FmZSBWZWxvY2lvdXMgYXR0YWNobWVudCBtZXRhZGF0YS4gKi9cbmV4cG9ydCBjbGFzcyBWZWxvY2lvdXNBdHRhY2htZW50IGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2Uge1xuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd9IC0gUmVzb3VyY2UgY29uZmlnLlxuICAgKi9cbiAgc3RhdGljIHJlc291cmNlQ29uZmlnKCkge1xuICAgIHJldHVybiB7XG4gICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgIGJ5dGVTaXplOiB7dHlwZTogXCJpbnRlZ2VyXCJ9LFxuICAgICAgICBjb250ZW50VHlwZToge251bGw6IHRydWUsIHR5cGU6IFwidmFyY2hhclwifSxcbiAgICAgICAgY3JlYXRlZEF0OiB7dHlwZTogXCJkYXRldGltZVwifSxcbiAgICAgICAgZmlsZW5hbWU6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgICAgIGlkOiB7dHlwZTogXCJ1dWlkXCJ9LFxuICAgICAgICBuYW1lOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgICAgICBwb3NpdGlvbjoge3R5cGU6IFwiaW50ZWdlclwifSxcbiAgICAgICAgcmVjb3JkSWQ6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgICAgIHJlY29yZFR5cGU6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgICAgIHVwZGF0ZWRBdDoge3R5cGU6IFwiZGF0ZXRpbWVcIn1cbiAgICAgIH0sXG4gICAgICBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzOiBbXCJpbmRleFwiXSxcbiAgICAgIGJ1aWx0SW5NZW1iZXJDb21tYW5kczogW1wiZmluZFwiXSxcbiAgICAgIG1vZGVsTmFtZTogXCJWZWxvY2lvdXNBdHRhY2htZW50XCIsXG4gICAgICBwcmltYXJ5S2V5OiBcImlkXCJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBpZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBdHRhY2htZW50IGlkLlxuICAgKi9cbiAgaWQoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJpZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIG93bmVyIG1vZGVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gT3duZXIgbW9kZWwgbmFtZS5cbiAgICovXG4gIHJlY29yZFR5cGUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJyZWNvcmRUeXBlXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgb3duZXIgcmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE93bmVyIHJlY29yZCBpZC5cbiAgICovXG4gIHJlY29yZElkKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwicmVjb3JkSWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IG5hbWUgb24gdGhlIG93bmVyIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgbmFtZSBvbiB0aGUgb3duZXIgbW9kZWwuXG4gICAqL1xuICBuYW1lKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwibmFtZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgcG9zaXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQXR0YWNobWVudCBwb3NpdGlvbi5cbiAgICovXG4gIHBvc2l0aW9uKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwicG9zaXRpb25cIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IGZpbGVuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgZmlsZW5hbWUuXG4gICAqL1xuICBmaWxlbmFtZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImZpbGVuYW1lXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBjb250ZW50IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIEF0dGFjaG1lbnQgY29udGVudCB0eXBlLlxuICAgKi9cbiAgY29udGVudFR5cGUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJjb250ZW50VHlwZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgYnl0ZSBzaXplLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEF0dGFjaG1lbnQgYnl0ZSBzaXplLlxuICAgKi9cbiAgYnl0ZVNpemUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJieXRlU2l6ZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNyZWF0ZWQtYXQgdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7RGF0ZX0gLSBDcmVhdGVkLWF0IHRpbWVzdGFtcC5cbiAgICovXG4gIGNyZWF0ZWRBdCgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImNyZWF0ZWRBdFwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHVwZGF0ZWQtYXQgdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7RGF0ZX0gLSBVcGRhdGVkLWF0IHRpbWVzdGFtcC5cbiAgICovXG4gIHVwZGF0ZWRBdCgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcInVwZGF0ZWRBdFwiKSB9XG59XG5cbkZyb250ZW5kTW9kZWxCYXNlLnJlZ2lzdGVyTW9kZWwoVmVsb2Npb3VzQXR0YWNobWVudClcbiJdfQ==