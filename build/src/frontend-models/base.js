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
import { forcedNonBlankString } from "typanic";
import { modelPrimaryKeyCacheKey, modelPrimaryKeyConditions, readModelPrimaryKeyValue, scalarModelPrimaryKey, scalarModelPrimaryKeyValue } from "../utils/model-primary-key.js";
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
 * @typedef {{sync?: import("../configuration-types.js").AttachmentSyncConfiguration, type: "hasOne" | "hasMany"}} FrontendModelAttachmentDefinition
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
const ATTACHMENT_OWNER_KEY = "__attachmentOwner";
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
 * Returns the canonical backing owner used by attachment metadata storage.
 * @param {FrontendModelBase} model - Frontend attachment owner.
 * @returns {{recordId: string, recordType: string, resourceName: string}} - Canonical attachment owner and originating resource.
 */
function frontendModelAttachmentOwner(model) {
    if (!model._attachmentOwner) {
        throw new Error(`Missing attachment owner metadata on ${frontendModelClassFor(model).name}`);
    }
    return model._attachmentOwner;
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
        const attachmentOwner = frontendModelAttachmentOwner(this.model);
        return VelociousAttachment
            .where({
            name: this.attachmentName,
            recordId: attachmentOwner.recordId,
            recordType: attachmentOwner.recordType,
            resourceName: attachmentOwner.resourceName
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
        const rawPreviousId = body.previousId;
        const previousIdentity = rawPreviousId === undefined || rawPreviousId === null
            ? null
            : Array.isArray(primaryKey)
                ? modelPrimaryKeyConditions(primaryKey, rawPreviousId)
                : String(rawPreviousId);
        const previousId = previousIdentity === null
            ? null
            : modelPrimaryKeyCacheKey(primaryKey, previousIdentity);
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
        const listener = this.instanceListeners.get(id) || (previousId === null ? undefined : this.instanceListeners.get(previousId));
        if (action === "update" && listener && previousIdentity !== null) {
            rekeyFrontendModelInstanceListeners(this.ModelClass, listener.instance, previousIdentity, identity);
        }
        if (!body.record || typeof body.record !== "object")
            return;
        const deserializedRecord = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(body.record));
        const freshModel = /** @type {ReturnType<typeof JSON.parse>} */ (this.ModelClass).instantiateFromResponse(deserializedRecord);
        if (action === "update" && listener) {
            const matchingUpdateCallbacks = Array.from(listener.updateCallbacks).filter((entry) => frontendModelEventEntryMatches(entry, matchedEventFilterKeys));
            if (matchingUpdateCallbacks.length > 0) {
                // Auto-merge into the registered instance so callers reading
                // through the same handle see fresh attributes.
                const instanceAny = /** @type {ReturnType<typeof JSON.parse>} */ (listener.instance);
                instanceAny.assignAttributes(freshModel.attributes());
                instanceAny._attachmentOwner = freshModel._attachmentOwner;
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
     * Canonical backing-record attachment owner returned by the server.
     * @type {{recordId: string, recordType: string, resourceName: string} | null}
     */
    _attachmentOwner;
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
        this._attachmentOwner = null;
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
     * Returns the scalar identity required by scalar-only frontend features.
     * @param {string} operation - Operation requiring a scalar identity.
     * @returns {import("../utils/model-primary-key.js").ModelPrimaryKeyScalar} - Scalar primary-key value.
     */
    scalarPrimaryKeyValue(operation) {
        return scalarModelPrimaryKeyValue(this.primaryKeyValue(), operation);
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
     * @returns {{abilities: Record<string, boolean>, attachmentOwner: {recordId: string, recordType: string, resourceName: string} | null, attributes: Record<string, FrontendModelAttributeValue>, associationCounts: Record<string, number>, queryData: Record<string, FrontendModelAttributeValue>, preloadedRelationships: Record<string, FrontendModelAttributeValue>, selectedAttributes: Set<string>}} - Attributes, attachment owner, preloaded relationships, association counts, queryData, abilities, and selected attributes.
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
        const attachmentOwnerPayload = attributes[ATTACHMENT_OWNER_KEY];
        let attachmentOwner = null;
        if (attachmentOwnerPayload !== undefined) {
            if (!isPlainObject(attachmentOwnerPayload)) {
                throw new TypeError(`Expected ${ATTACHMENT_OWNER_KEY} to be an object`);
            }
            const attachmentOwnerObject = /** @type {{recordId?: unknown, recordType?: unknown, resourceName?: unknown}} */ (attachmentOwnerPayload);
            attachmentOwner = {
                recordId: forcedNonBlankString(attachmentOwnerObject.recordId, `${ATTACHMENT_OWNER_KEY}.recordId`),
                recordType: forcedNonBlankString(attachmentOwnerObject.recordType, `${ATTACHMENT_OWNER_KEY}.recordType`),
                resourceName: forcedNonBlankString(attachmentOwnerObject.resourceName, `${ATTACHMENT_OWNER_KEY}.resourceName`)
            };
        }
        delete attributes[ATTACHMENT_OWNER_KEY];
        delete attributes[PRELOADED_RELATIONSHIPS_KEY];
        delete attributes[SELECTED_ATTRIBUTES_KEY];
        delete attributes[ASSOCIATION_COUNTS_KEY];
        delete attributes[QUERY_DATA_KEY];
        delete attributes[ABILITIES_KEY];
        const selectedAttributes = selectedAttributesFromPayload || new Set(Object.keys(attributes));
        return { abilities, attachmentOwner, attributes, associationCounts, queryData, preloadedRelationships, selectedAttributes };
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
        const attachmentOwner = modelData.attachmentOwner;
        const selectedAttributes = modelData.selectedAttributes;
        const receiver = /** @type {unknown} */ (this);
        const ModelClass = /** @type {new (attributes?: Record<string, FrontendModelAttributeValue>) => InstanceType<T>} */ (receiver);
        const model = new ModelClass(attributes);
        model._attachmentOwner = attachmentOwner;
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
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Record identifier.
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
        const modelData = ModelClass.modelDataFromResponse(response);
        this.assignAttributes(modelData.attributes);
        this._attachmentOwner = modelData.attachmentOwner;
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
        const id = this.isNewRecord() ? this.primaryKeyValue() : this.persistedPrimaryKeyValue();
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
            return { id: this.persistedPrimaryKeyValue(), _destroy: true };
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
        const entry = { id: this.persistedPrimaryKeyValue() };
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
     * Finds attachment metadata by its public id through the member authorization path.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Attachment id.
     * @returns {Promise<InstanceType<T>>} - Resolved attachment metadata.
     */
    static async find(id) {
        return this.instantiateFromResponse(await this.executeCommand("find", { id }));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbHMvYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxPQUFPLE1BQU0sMkJBQTJCLENBQUE7QUFDL0MsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxrQkFBa0IsRUFBRSxFQUFDLGdDQUFnQyxFQUFDLE1BQU0sWUFBWSxDQUFBO0FBQy9FLE9BQU8sc0JBQXNCLE1BQU0sZ0JBQWdCLENBQUE7QUFDbkQsT0FBTyxFQUFDLDJCQUEyQixFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0UsT0FBTyxFQUFDLHFCQUFxQixFQUFFLHlCQUF5QixFQUFDLE1BQU0scUJBQXFCLENBQUE7QUFDcEYsT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGlDQUFpQyxFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0gsT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDekgsT0FBTyx3QkFBd0IsTUFBTSx5QkFBeUIsQ0FBQTtBQUM5RCxPQUFPLEVBQUMsd0JBQXdCLEVBQUUsZ0JBQWdCLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUMxRSxPQUFPLHdCQUF3QixNQUFNLG9DQUFvQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyx1QkFBdUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ3BFLE9BQU8sRUFBQyx3Q0FBd0MsRUFBRSxzQ0FBc0MsRUFBQyxNQUFNLDZCQUE2QixDQUFBO0FBQzVILE9BQU8sRUFBQyxtQkFBbUIsRUFBRSwyQkFBMkIsRUFBRSwyQkFBMkIsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ3hILE9BQU8sRUFBQyxnQkFBZ0IsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQ3hELE9BQU8sYUFBYSxNQUFN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QyxtQkFBbUIsQ0FBQyxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHRpbWVvdXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IHdhaXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3dhaXQuanNcIlxuaW1wb3J0IEZyb250ZW5kTW9kZWxRdWVyeSwge2Zyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkfSBmcm9tIFwiLi9xdWVyeS5qc1wiXG5pbXBvcnQgRnJvbnRlbmRNb2RlbFByZWxvYWRlciBmcm9tIFwiLi9wcmVsb2FkZXIuanNcIlxuaW1wb3J0IHtub3JtYWxpemVEYXRlU3RyaW5nRm9yV3JpdGV9IGZyb20gXCIuLi9kYXRhYmFzZS9kYXRldGltZS1zdG9yYWdlLmpzXCJcbmltcG9ydCB7cmVnaXN0ZXJGcm9udGVuZE1vZGVsLCByZXNvbHZlRnJvbnRlbmRNb2RlbENsYXNzfSBmcm9tIFwiLi9tb2RlbC1yZWdpc3RyeS5qc1wiXG5pbXBvcnQge3ZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWUsIHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aH0gZnJvbSBcIi4vcmVzb3VyY2UtY29uZmlnLXZhbGlkYXRpb24uanNcIlxuaW1wb3J0IHtkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSwgc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBmcm9tIFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiXG5pbXBvcnQgcnVuV2l0aFRyYW5zcG9ydERlYWRsaW5lIGZyb20gXCIuL3RyYW5zcG9ydC1kZWFkbGluZS5qc1wiXG5pbXBvcnQge1JFUVVFU1RfVElNRV9aT05FX0hFQURFUiwgdmFsaWRhdGVUaW1lWm9uZX0gZnJvbSBcIi4uL3RpbWUtem9uZS5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50IGZyb20gXCIuLi9odHRwLWNsaWVudC93ZWJzb2NrZXQtY2xpZW50LmpzXCJcbmltcG9ydCB7cmVtb3RlUmVxdWVzdENvbnRleHRLZXl9IGZyb20gXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCJcbmltcG9ydCB7Y2FwdHVyZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dCwgbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHR9IGZyb20gXCIuL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuaW1wb3J0IHtidWZmZXJPdXRnb2luZ0V2ZW50LCBjbGVhckJ1ZmZlcmVkT3V0Z29pbmdFdmVudHMsIGRyYWluQnVmZmVyZWRPdXRnb2luZ0V2ZW50c30gZnJvbSBcIi4vb3V0Z29pbmctZXZlbnQtYnVmZmVyLmpzXCJcbmltcG9ydCB7ZGVmaW5lTW9kZWxTY29wZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCJcbmltcG9ydCBpc1BsYWluT2JqZWN0IGZyb20gXCIuLi91dGlscy9wbGFpbi1vYmplY3QuanNcIlxuaW1wb3J0IHtmb3JjZWROb25CbGFua1N0cmluZ30gZnJvbSBcInR5cGFuaWNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDYWNoZUtleSwgbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucywgcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlLCBzY2FsYXJNb2RlbFByaW1hcnlLZXksIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuaW1wb3J0IHtyZWFkUGF5bG9hZEFzc29jaWF0aW9uQ291bnQsIHJlYWRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5LCByZWFkUGF5bG9hZFF1ZXJ5RGF0YSwgc2V0UGF5bG9hZEFzc29jaWF0aW9uQ291bnQsIHNldFBheWxvYWRDb21wdXRlZEFiaWxpdHksIHNldFBheWxvYWRRdWVyeURhdGF9IGZyb20gXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIlxuXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIHJlbGF0aW9uc2hpcCBoZWxwZXIgdHlwZS4gUmV0dXJuZWQgYnkgYGdldFJlbGF0aW9uc2hpcEJ5TmFtZWAsXG4gKiB3aGljaCBnZW5lcmF0ZWQgbW9kZWxzIGltbWVkaWF0ZWx5IGNhc3QgdG8gdGhlaXIgY29uY3JldGUgcmVsYXRpb25zaGlwIHR5cGVcbiAqIChlLmcuIGBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXA8T3duZXIsIFRhcmdldCwgVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz5gKS5cbiAqIFRoZSBtZW1iZXJzIHVzZSBgYW55YCB0eXBlIGFyZ3Mgc28gdGhhdCBjYXN0IGlzIGFsbG93ZWQgcmVnYXJkbGVzcyBvZiB0aGVcbiAqIHRhcmdldCBtb2RlbCdzIHR5cGVkLWF0dHJpYnV0ZSBnZW5lcmljcyDigJQgYSBjb25jcmV0ZSBgRnJvbnRlbmRNb2RlbEJhc2VgIG1lbWJlclxuICogaGVyZSBtYWtlcyB0aGUgY2FzdCBhIG5vbi1vdmVybGFwcGluZyAoVFMyMzUyKSBlcnJvciBmb3IgZXZlcnkgdHlwZWQgbW9kZWwuXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXA8YW55LCBhbnksIGFueT4gfCBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXA8YW55LCBhbnksIGFueT59IEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7Y2FsbGJhY2s6IChwYXlsb2FkOiB7aWQ6IHN0cmluZyB8IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLkNvbXBvc2l0ZU1vZGVsUHJpbWFyeUtleVZhbHVlLCBtb2RlbDogRnJvbnRlbmRNb2RlbEJhc2V9KSA9PiB2b2lkLCBldmVudEZpbHRlcktleTogc3RyaW5nIHwgbnVsbCwgZXZlbnRGaWx0ZXJQYXlsb2FkOiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWQgfCBudWxsLCBwcm9qZWN0aW9uUGF5bG9hZDogaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9fSBGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnlcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7Y2FsbGJhY2s6IChwYXlsb2FkOiB7aWQ6IHN0cmluZyB8IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLkNvbXBvc2l0ZU1vZGVsUHJpbWFyeUtleVZhbHVlfSkgPT4gdm9pZH19IEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5XG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbENvbW1hbmRUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7XCJjcmVhdGVcIiB8IFwiZmluZFwiIHwgXCJpbmRleFwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IEZyb250ZW5kTW9kZWxDb21tYW5kVHlwZSAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVxdWVzdENvbW1hbmRUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbENvbW1hbmRUeXBlIHwgc3RyaW5nfSBGcm9udGVuZE1vZGVsUmVxdWVzdENvbW1hbmRUeXBlICovXG4vKipcbiAqIE1vZGVsLWxpa2UgaW5zdGFuY2UgdmFsdWUgc3VwcG9ydGVkIGJ5IGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydC5cbiAqIEB0eXBlZGVmIHt7YXR0cmlidXRlczogKCkgPT4gUmVjb3JkPHN0cmluZywgdW5rbm93bj59fSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0TW9kZWxWYWx1ZVxuICovXG4vKipcbiAqIFNwZWNpYWwgc2NhbGFyIHZhbHVlcyByZXN0b3JlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQuXG4gKiBAdHlwZWRlZiB7dW5kZWZpbmVkIHwgbnVsbCB8IGJvb2xlYW4gfCBudW1iZXIgfCBzdHJpbmcgfCBiaWdpbnQgfCBEYXRlIHwgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydE1vZGVsVmFsdWV9IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRTY2FsYXJWYWx1ZVxuICovXG4vKipcbiAqIFBsYWluIG9iamVjdCBzdXBwb3J0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHZhbHVlcy5cbiAqIE5lc3RlZCB2YWx1ZXMgYXJlIGludGVudGlvbmFsbHkgb3BhcXVlIGJlY2F1c2UgVHlwZVNjcmlwdCByZWplY3RzIHJlY3Vyc2l2ZVxuICogSlNEb2MgdHlwZWRlZnMgZm9yIHRoaXMgdHJhbnNwb3J0IHZhbHVlIGNvbnRyYWN0LlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0T2JqZWN0XG4gKi9cbi8qKlxuICogVmFsdWUgc3VwcG9ydGVkIGJ5IGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCBzZXJpYWxpemF0aW9uIGFuZCBkZXNlcmlhbGl6YXRpb24uXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNjYWxhclZhbHVlIHwgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydE9iamVjdCB8IEFycmF5PHVua25vd24+fSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVcbiAqL1xuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgdmFsdWUgdXNlZCB3aGVuIGdlbmVyYXRlZCBtZXRhZGF0YSBjYW5ub3QgaW5mZXIgYSBuYXJyb3dlciB0eXBlLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e3N5bmM/OiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkF0dGFjaG1lbnRTeW5jQ29uZmlndXJhdGlvbiwgdHlwZTogXCJoYXNPbmVcIiB8IFwiaGFzTWFueVwifX0gRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREZWZpbml0aW9uXG4gKi9cbi8qKlxuICogRGVmaW5lcyBmcm9udGVuZC1tb2RlbCBhdHRyaWJ1dGUgbWV0YWRhdGEuXG4gKiBAdHlwZWRlZiB7e2NvbHVtblR5cGU/OiBzdHJpbmcsIGRhdGFUeXBlPzogc3RyaW5nLCBqc0RvY1R5cGU/OiBzdHJpbmcsIG5hbWU/OiBzdHJpbmcsIG51bGw/OiBib29sZWFuLCBzZWxlY3RlZEJ5RGVmYXVsdD86IGJvb2xlYW4sIHNxbFR5cGU/OiBzdHJpbmcsIHR5cGU/OiBzdHJpbmd9fSBGcm9udGVuZE1vZGVsQXR0cmlidXRlRGVmaW5pdGlvblxuICovXG4vKipcbiAqIEF0dGFjaG1lbnQgaW5wdXQgYWNjZXB0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgYXR0YWNobWVudCBoZWxwZXJzIGJlZm9yZSBub3JtYWxpemF0aW9uLlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHthcnJheUJ1ZmZlcjogKCkgPT4gUHJvbWlzZTxBcnJheUJ1ZmZlcj4sIHR5cGU/OiBzdHJpbmcsIG5hbWU/OiBzdHJpbmd9IHwgbnVsbCB8IHVuZGVmaW5lZH0gRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRJbnB1dFxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IEZyb250ZW5kTW9kZWxTeW5jTWV0YWRhdGFcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHtcIm9wdGltaXN0aWNWZXJzaW9uXCIgfCBcInNlcnZlcldpbnNcIiB8IFwibGFzdFdyaXRlcldpbnNcIiB8IFwiZmllbGRUaHJlZVdheVwiIHwgXCJhcHBlbmRPbmx5XCJ9IEZyb250ZW5kTW9kZWxTeW5jQ29uZmxpY3RTdHJhdGVneVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tlbmFibGVkOiBib29sZWFuLCBvcGVyYXRpb25zOiBzdHJpbmdbXSwgcG9saWN5SGFzaDogc3RyaW5nLCBwb2xpY3lWZXJzaW9uOiBzdHJpbmcgfCBudWxsLCBjb25mbGljdFN0cmF0ZWd5PzogRnJvbnRlbmRNb2RlbFN5bmNDb25mbGljdFN0cmF0ZWd5LCBtZXRhZGF0YT86IEZyb250ZW5kTW9kZWxTeW5jTWV0YWRhdGF9fSBGcm9udGVuZE1vZGVsU3luY0NvbmZpZ1xuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3thdHRyaWJ1dGVzPzogQXJyYXk8c3RyaW5nIHwgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZURlZmluaXRpb24+IHwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZURlZmluaXRpb24+LCBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzPzogc3RyaW5nW10sIGJ1aWx0SW5NZW1iZXJDb21tYW5kcz86IHN0cmluZ1tdLCBjb2xsZWN0aW9uQ29tbWFuZHM/OiBzdHJpbmdbXSwgY29tbWFuZHM/OiBzdHJpbmdbXSwgbWVtYmVyQ29tbWFuZHM/OiBzdHJpbmdbXSwgYXR0YWNobWVudHM/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0YWNobWVudERlZmluaXRpb24+LCBtb2RlbE5hbWU/OiBzdHJpbmcsIG5lc3RlZEF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB7YWxsb3dEZXN0cm95PzogYm9vbGVhbiwgbGltaXQ/OiBudW1iZXJ9PiwgcHJpbWFyeUtleT86IHN0cmluZyB8IHN0cmluZ1tdLCByZWxhdGlvbnNoaXBzPzogc3RyaW5nW10sIHN5bmM/OiBGcm9udGVuZE1vZGVsU3luY0NvbmZpZ319IEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ1xuICovXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIGNvbnN0cnVjdG9yIHR5cGUuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlfSBbVD1Gcm9udGVuZE1vZGVsQmFzZV1cbiAqIEB0eXBlZGVmIHt7bmV3IChhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPik6IFR9fSBGcm9udGVuZE1vZGVsQ29uc3RydWN0b3JcbiAqL1xuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCBzdGF0aWMgc2lkZS5cbiAqXG4gKiBUaGUgdGVtcGxhdGUgZGVmYXVsdHMgYXJlIGludGVudGlvbmFsbHkgcGVybWlzc2l2ZSAoYGFueWAgbW9kZWwvYXR0cmlidXRlXG4gKiBwYXJhbXMpLiBUaGUgYmFyZSBgRnJvbnRlbmRNb2RlbENsYXNzYCBpcyB0aGUgYEB0aGlzYC9jb25zdHJhaW50IHR5cGUgb24gdGhlXG4gKiBzdGF0aWMgcXVlcnkgbWV0aG9kcyAoZmluZEJ5L2ZpbmQvd2hlcmUvcHJlbG9hZC8uLi4pOyBhIGdlbmVyYXRlZCBzdWJjbGFzc1xuICogZGVjbGFyZXMgdHlwZWQtYXR0cmlidXRlIGdlbmVyaWNzIChlLmcuIGBGcm9udGVuZE1vZGVsQmFzZTxBY2NvdW50QXR0cmlidXRlcyxcbiAqIEFjY291bnRDcmVhdGVBdHRyaWJ1dGVzLCBBY2NvdW50VXBkYXRlQXR0cmlidXRlcz5gKSB3aGljaCwgYWdhaW5zdCBhIGNvbmNyZXRlXG4gKiBgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPmAgZGVmYXVsdCwgZmFpbCB0aGUgY29uc3RyYWludCBieVxuICogaW52YXJpYW5jZS4gRGVmYXVsdGluZyB0byBgYW55YCBsZXRzIGFueSBzdWJjbGFzcyBzYXRpc2Z5IHRoZSBjb25zdHJhaW50IHdoaWxlXG4gKiB0aGUgbWV0aG9kcycgb3duIGBAdGVtcGxhdGUgVGAgc3RpbGwgY2FwdHVyZXMgdGhlIHByZWNpc2UgY2FsbGluZyBjbGFzcyBmb3JcbiAqIHRoZWlyIHJldHVybiB0eXBlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2V9IFtUPUZyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnk+XVxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtBdHRyaWJ1dGVzPWFueV1cbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbQ3JlYXRlQXR0cmlidXRlcz1hbnldXG4gKiBAdHlwZWRlZiB7e25ldyAoKTogVCwgY3JlYXRlKGF0dHJpYnV0ZXM/OiBDcmVhdGVBdHRyaWJ1dGVzKTogUHJvbWlzZTxUPn0gJiBPbWl0PHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZSwgXCJjcmVhdGVcIiB8IFwicHJvdG90eXBlXCI+fSBGcm9udGVuZE1vZGVsQ2xhc3NcbiAqL1xuLyoqXG4gKiBDcmVhdGUgYXR0cmlidXRlcyBhY2NlcHRlZCBieSBhIGZyb250ZW5kIG1vZGVsIGluc3RhbmNlLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZX0gVFxuICogQHR5cGVkZWYge1QgZXh0ZW5kcyBGcm9udGVuZE1vZGVsQmFzZTxSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBpbmZlciBDcmVhdGVBdHRyaWJ1dGVzLCBpbmZlciBfVXBkYXRlQXR0cmlidXRlcz4gPyBDcmVhdGVBdHRyaWJ1dGVzIDogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gRnJvbnRlbmRNb2RlbENyZWF0ZUF0dHJpYnV0ZXNGb3JcbiAqL1xuLyoqXG4gKiBMb2FkZWQgaW5zdGFuY2UgdHlwZSBmb3IgcmVsYXRpb25zaGlwIGhlbHBlciBnZW5lcmljcy4gT2xkZXIgZ2VuZXJhdGVkXG4gKiBmcm9udGVuZCBtb2RlbHMgcGFzc2VkIG1vZGVsIGNsYXNzZXMgaW50byByZWxhdGlvbnNoaXAgaGVscGVycywgd2hpbGUgbmV3ZXJcbiAqIGdlbmVyYXRlZCBtb2RlbHMgcGFzcyBpbnN0YW5jZSB0eXBlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFRcbiAqIEB0eXBlZGVmIHtUIGV4dGVuZHMgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlID8gSW5zdGFuY2VUeXBlPFQ+IDogVH0gRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZ1xuICogQHByb3BlcnR5IHtzdHJpbmcgfCAoKCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCl9IFt1cmxdIC0gT3B0aW9uYWwgZnJvbnRlbmQtbW9kZWwgVVJMLiBUaGlzIHNob3VsZCBiZSB0aGUgc2hhcmVkIGVuZHBvaW50IChmb3IgZXhhbXBsZSBgXCIvZnJvbnRlbmQtbW9kZWxzXCJgIG9yIGBcImh0dHBzOi8vZXhhbXBsZS5jb20vZnJvbnRlbmQtbW9kZWxzXCJgKS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3NoYXJlZF0gLSBEZXByZWNhdGVkIHNoYXJlZC1lbmRwb2ludCBmbGFnIHJldGFpbmVkIGZvciBjb21wYXRpYmlsaXR5LiBGcm9udGVuZC1tb2RlbCBDUlVEL2N1c3RvbSBjb21tYW5kcyB1c2UgdGhlIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgZW52ZWxvcGUgYnkgZGVmYXVsdC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgKCgpID0+IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpfSBbd2Vic29ja2V0VXJsXSAtIE9wdGlvbmFsIHdlYnNvY2tldCBVUkwuIFdoZW4gc2V0LCBWZWxvY2lvdXMgY3JlYXRlcyBhbmQgbWFuYWdlcyBpdHMgb3duIHdlYnNvY2tldCBjbGllbnQgaW50ZXJuYWxseS4gU3Vic2NyaXB0aW9ucyB1c2UgdGhlIHdlYnNvY2tldDsgQ1JVRCB1c2VzIEhUVFAgYW5kIGZhbGxzIGJhY2sgZ3JhY2VmdWxseS4gRXhhbXBsZTogYFwid3M6Ly9sb2NhbGhvc3Q6MzAwNi93ZWJzb2NrZXRcImAuXG4gKiBAcHJvcGVydHkge3twb3N0OiAocGF0aDogc3RyaW5nLCBib2R5PzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG9wdGlvbnM/OiB7aGVhZGVycz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sIHNpZ25hbD86IEFib3J0U2lnbmFsfSkgPT4gUHJvbWlzZTx7anNvbjogKCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Piwgc3Vic2NyaWJlOiAoY2hhbm5lbDogc3RyaW5nLCBvcHRpb25zOiB7cGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSwgY2FsbGJhY2s6IChwYXlsb2FkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZCkgPT4gKCgpID0+IHZvaWQpLCBzdWJzY3JpYmVBbmRXYWl0PzogKGNoYW5uZWw6IHN0cmluZywgb3B0aW9uczoge3BhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0sIGNhbGxiYWNrOiAocGF5bG9hZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHZvaWQpID0+IFByb21pc2U8KCgpID0+IHZvaWQpPn19IFt3ZWJzb2NrZXRDbGllbnRdIC0gT3B0aW9uYWwgd2Vic29ja2V0IGNsaWVudCBmb3Igc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0cyBhbmQgc3Vic2NyaXB0aW9ucy4gSXRzIGBwb3N0YCByZWNlaXZlcyB0aGUgYm91bmRlZC1kZWFkbGluZSBgc2lnbmFsYCBhbmQgc2hvdWxkIGZvcndhcmQgaXQgaW50byB0aGUgdW5kZXJseWluZyB0cmFuc3BvcnQgc28gdGhlIGRlYWRsaW5lIGNhbiBhYm9ydCB0aGUgbGl2ZSByZXF1ZXN0IGFuZCBpdHMgcmVzcG9uc2UtYm9keSByZWFkLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgKCgpID0+IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pfSBbcmVxdWVzdEhlYWRlcnNdIC0gRXh0cmEgSFRUUC9XUyBoZWFkZXJzIHRvIGF0dGFjaCB0byBldmVyeSBmcm9udGVuZC1tb2RlbCBBUEkgcmVxdWVzdC4gUGFzcyBhIGZ1bmN0aW9uIHRvIGNvbXB1dGUgdGhlbSBhdCByZXF1ZXN0IHRpbWUgKGZvciBleGFtcGxlIHRvIGluY2x1ZGUgdGhlIGN1cnJlbnQgbG9jYWxlKS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dCB8ICgoKSA9PiBpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0IHwgdW5kZWZpbmVkIHwgbnVsbCl9IFtyZXF1ZXN0Q29udGV4dF0gLSBJbW11dGFibGUgc2NhbGFyIGNvbnRleHQgY2FwdHVyZWQgaW5kZXBlbmRlbnRseSB3aGVuIGVhY2ggb3BlcmF0aW9uIG9yIGV2ZW50IHN1YnNjcmlwdGlvbiBzdGFydHMgYW5kIHNlbnQgZm9yIHJlbW90ZSB0ZW5hbnQvYWJpbGl0eSByZXNvbHV0aW9uLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCAoKCkgPT4gbnVtYmVyIHwgdW5kZWZpbmVkIHwgbnVsbCl9IFt0aW1lb3V0XSAtIEJvdW5kZWQgZGVhZGxpbmUgaW4gbWlsbGlzZWNvbmRzIGNvdmVyaW5nIGNvbm5lY3Rpb24sIHJlc3BvbnNlIGhlYWRlcnMsIGFuZCByZXNwb25zZS1ib2R5IGNvbnN1bXB0aW9uIGZvciBlYWNoIGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0LiBPbiBleHBpcnkgdGhlIGxpdmUgZmV0Y2gvYWRhcHRlciByZXF1ZXN0IGlzIGFib3J0ZWQgKGJ1aWx0IG9uIGF3YWl0ZXJ5J3MgYHRpbWVvdXRgKSBhbmQgYXdhaXRlcnkncyBgVGltZW91dEVycm9yYCBpcyB0aHJvd24sIHNvIGNhbGxlcnMgY2FuIGNsYXNzaWZ5IGEgdGltZW91dCB2aWEgYGVycm9yIGluc3RhbmNlb2YgVGltZW91dEVycm9yYC4gUGFzcyBhIGZ1bmN0aW9uIHRvIHJlc29sdmUgaXQgcGVyIHJlcXVlc3QuIEZhbHN5L2Fic2VudCBtZWFucyBubyBkZWFkbGluZS5cbiAqIEBwcm9wZXJ0eSB7QWJvcnRTaWduYWwgfCAoKCkgPT4gQWJvcnRTaWduYWwgfCB1bmRlZmluZWQgfCBudWxsKX0gW3NpZ25hbF0gLSBPcHRpb25hbCBjYWxsZXIvc2Vzc2lvbiBBYm9ydFNpZ25hbCBjb21wb3NlZCB3aXRoIHRoZSBkZWFkbGluZS4gQWJvcnRpbmcgaXQgY2FuY2VscyB0aGUgbGl2ZSByZXF1ZXN0IChmb3IgZXhhbXBsZSBvbiBzZXNzaW9uIHNodXRkb3duIG9yIG9mZmxpbmUgdHJhbnNpdGlvbik7IHRoZSByZXN1bHRpbmcgYWJvcnQgZXJyb3Igc3RheXMgZGlzdGluZ3Vpc2hhYmxlIGZyb20gYSB0aW1lb3V0LiBQYXNzIGEgZnVuY3Rpb24gdG8gcmVzb2x2ZSB0aGUgY3VycmVudCBzaWduYWwgcGVyIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge3tnZXQ6ICgpID0+IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQgfCBQcm9taXNlPHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQ+LCBzZXQ6IChzZXNzaW9uSWQ6IHN0cmluZykgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4sIGNsZWFyOiAoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn19IFtzZXNzaW9uU3RvcmVdIC0gT3B0aW9uYWwgc2Vzc2lvbklkIHBlcnNpc3RlbmNlIGhvb2sgZm9yd2FyZGVkIHRvIHRoZSBpbnRlcm5hbCBgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50YCBzbyBXUyBzZXNzaW9ucyBjYW4gYmUgcmVzdW1lZCBhY3Jvc3MgcGFnZSByZWxvYWRzIC8gYXBwIHJlc3RhcnRzLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCAoKCkgPT4gc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCl9IFt0aW1lWm9uZV0gLSBJQU5BIHRpbWV6b25lIHNlbnQgd2l0aCBldmVyeSBmcm9udGVuZC1tb2RlbCBBUEkgcmVxdWVzdCBmb3IgdGltZXpvbmUtbGVzcyBkYXRldGltZSBwYXJzaW5nLlxuICogQHByb3BlcnR5IHt7YWN0b3JEZXZpY2VJZDogc3RyaW5nLCBhY3RvclVzZXJJZDogc3RyaW5nLCBjbGllbnRNdXRhdGlvbklkPzogKCkgPT4gc3RyaW5nLCBlbmFibGVkPzogYm9vbGVhbiwgbXV0YXRpb25Mb2c6IGltcG9ydChcIi4uL3N5bmMvbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLmRlZmF1bHQsIG5vdz86ICgpID0+IERhdGUsIG9mZmxpbmVHcmFudDoge2lkOiBzdHJpbmd9fX0gW29mZmxpbmVTeW5jXSAtIE9mZmxpbmUgbXV0YXRpb24gcXVldWUgY29uZmlndXJhdGlvbi5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsSWRsZVdhaXRBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsSWRsZVdhaXRBcmdzXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3F1aWV0TXNdIC0gTWlsbGlzZWNvbmRzIHRoZSB0cmFuc3BvcnQgbXVzdCBzdGF5IGlkbGUgYmVmb3JlIHJlc29sdmluZy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbdGltZW91dF0gLSBUaW1lb3V0IGluIG1pbGxpc2Vjb25kcy5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBjb25maWcuXG4gKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZ30gKi9cbmNvbnN0IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcgPSB7fVxuY29uc3QgU0hBUkVEX0ZST05URU5EX01PREVMX0FQSV9QQVRIID0gXCIvZnJvbnRlbmQtbW9kZWxzXCJcbmNvbnN0IFBSRUxPQURFRF9SRUxBVElPTlNISVBTX0tFWSA9IFwiX19wcmVsb2FkZWRSZWxhdGlvbnNoaXBzXCJcbmNvbnN0IFNFTEVDVEVEX0FUVFJJQlVURVNfS0VZID0gXCJfX3NlbGVjdGVkQXR0cmlidXRlc1wiXG5jb25zdCBBU1NPQ0lBVElPTl9DT1VOVFNfS0VZID0gXCJfX2Fzc29jaWF0aW9uQ291bnRzXCJcbmNvbnN0IFFVRVJZX0RBVEFfS0VZID0gXCJfX3F1ZXJ5RGF0YVwiXG5jb25zdCBBQklMSVRJRVNfS0VZID0gXCJfX2FiaWxpdGllc1wiXG5jb25zdCBBVFRBQ0hNRU5UX09XTkVSX0tFWSA9IFwiX19hdHRhY2htZW50T3duZXJcIlxuLyoqXG4gKiBQZW5kaW5nIHNoYXJlZCBmcm9udGVuZCBtb2RlbCByZXF1ZXN0cy5cbiAqIEB0eXBlIHtBcnJheTx7Y29tbWFuZE5hbWU/OiBzdHJpbmcsIGNvbW1hbmRUeXBlOiBGcm9udGVuZE1vZGVsUmVxdWVzdENvbW1hbmRUeXBlLCBjdXN0b21QYXRoPzogc3RyaW5nLCBtb2RlbENsYXNzOiBGcm9udGVuZE1vZGVsQ2xhc3MsIHBheWxvYWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgcmVxdWVzdENvbnRleHQ6IGltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQsIHJlcXVlc3RJZDogc3RyaW5nLCByZXNvbHZlOiAocmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gdm9pZCwgcmVqZWN0OiAoZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiB2b2lkLCByZXNvdXJjZVBhdGg/OiBzdHJpbmcgfCBudWxsfT59ICovXG5sZXQgcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cyA9IFtdXG5cbmxldCBzaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdElkID0gMFxubGV0IHNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZCA9IGZhbHNlXG5sZXQgYWN0aXZlRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3RDb3VudCA9IDBcbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgaWRsZSByZXNvbHZlcnMuXG4gKiBAdHlwZSB7QXJyYXk8KCkgPT4gdm9pZD59ICovXG5sZXQgZnJvbnRlbmRNb2RlbElkbGVSZXNvbHZlcnMgPSBbXVxuXG4vKipcbiAqIEludGVybmFsIHdlYnNvY2tldCBjbGllbnQuXG4gKiBAdHlwZSB7VmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50IHwgbnVsbH0gKi9cbmxldCBpbnRlcm5hbFdlYnNvY2tldENsaWVudCA9IG51bGxcbi8qKiBAdHlwZSB7QWJvcnRTaWduYWwgfCBudWxsfSAqL1xubGV0IGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsID0gbnVsbFxuLyoqIEB0eXBlIHsoKCkgPT4gdm9pZCkgfCBudWxsfSAqL1xubGV0IGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cCA9IG51bGxcblxuLyoqXG4gKiBEZXRhY2hlcyBhbiBvd25lZCBXZWJTb2NrZXQgY2xpZW50IGZyb20gdGhlIHNoYXJlZCBjYWNoZSBpZiBpdCBpcyBzdGlsbCBjdXJyZW50LlxuICogQHBhcmFtIHtWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnR9IGNsaWVudCAtIENsaWVudCB3aG9zZSBvd25lcnNoaXAgaXMgZW5kaW5nLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGRldGFjaEludGVybmFsV2Vic29ja2V0Q2xpZW50KGNsaWVudCkge1xuICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgIT09IGNsaWVudCkgcmV0dXJuXG5cbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgPSBudWxsXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cD8uKClcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwgPSBudWxsXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cCA9IG51bGxcbn1cblxuLyoqXG4gKiBEaXNwb3NlcyB0aGUgb3duZWQgV2ViU29ja2V0IGNsaWVudCBiZWZvcmUgdHJhbnNwb3J0L3Nlc3Npb24gY29uZmlndXJhdGlvbiBjaGFuZ2VzLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJlc2V0SW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSB7XG4gIGNvbnN0IGNsaWVudCA9IGludGVybmFsV2Vic29ja2V0Q2xpZW50XG5cbiAgaWYgKCFjbGllbnQpIHJldHVyblxuXG4gIGRldGFjaEludGVybmFsV2Vic29ja2V0Q2xpZW50KGNsaWVudClcbiAgdm9pZCBjbGllbnQuZGlzY29ubmVjdEFuZFN0b3BSZWNvbm5lY3QoKVxufVxuXG4vKipcbiAqIEJpbmRzIHRoZSBvd25lZCBXZWJTb2NrZXQgY2xpZW50IGxpZmV0aW1lIHRvIHRoZSBjdXJyZW50IHNlc3Npb24gc2lnbmFsLlxuICogQHBhcmFtIHtBYm9ydFNpZ25hbCB8IHVuZGVmaW5lZH0gc2Vzc2lvblNpZ25hbCAtIEN1cnJlbnQgc2Vzc2lvbiBzaWduYWwuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYmluZEludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsKHNlc3Npb25TaWduYWwpIHtcbiAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsID09PSBzZXNzaW9uU2lnbmFsKSByZXR1cm5cblxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXA/LigpXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsID0gc2Vzc2lvblNpZ25hbCB8fCBudWxsXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cCA9IG51bGxcblxuICBpZiAoIXNlc3Npb25TaWduYWwgfHwgIWludGVybmFsV2Vic29ja2V0Q2xpZW50KSByZXR1cm5cblxuICBjb25zdCBjbGllbnQgPSBpbnRlcm5hbFdlYnNvY2tldENsaWVudFxuICBjb25zdCBvblNlc3Npb25BYm9ydCA9ICgpID0+IHtcbiAgICBkZXRhY2hJbnRlcm5hbFdlYnNvY2tldENsaWVudChjbGllbnQpXG4gICAgY2xlYXJCdWZmZXJlZE91dGdvaW5nRXZlbnRzKClcbiAgICB2b2lkIGNsaWVudC5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG4gIH1cblxuICBzZXNzaW9uU2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBvblNlc3Npb25BYm9ydCwge29uY2U6IHRydWV9KVxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXAgPSAoKSA9PiBzZXNzaW9uU2lnbmFsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBvblNlc3Npb25BYm9ydClcblxuICBpZiAoc2Vzc2lvblNpZ25hbC5hYm9ydGVkKSBvblNlc3Npb25BYm9ydCgpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgaXMgaWRsZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYWxsIHF1ZXVlZCBhbmQgYWN0aXZlIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCByZXF1ZXN0cyBhcmUgZG9uZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpIHtcbiAgcmV0dXJuIGFjdGl2ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0Q291bnQgPT09IDBcbiAgICAmJiBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzLmxlbmd0aCA9PT0gMFxuICAgICYmICFzaGFyZWRGcm9udGVuZE1vZGVsRmx1c2hTY2hlZHVsZWRcbn1cblxuLyoqXG4gKiBSdW5zIHJlc29sdmUgZnJvbnRlbmQgbW9kZWwgaWRsZSB3YWl0ZXJzLlxuICogQHJldHVybnMge3ZvaWR9ICovXG5mdW5jdGlvbiByZXNvbHZlRnJvbnRlbmRNb2RlbElkbGVXYWl0ZXJzKCkge1xuICBpZiAoIWZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSkgcmV0dXJuXG5cbiAgY29uc3QgcmVzb2x2ZXJzID0gZnJvbnRlbmRNb2RlbElkbGVSZXNvbHZlcnNcbiAgZnJvbnRlbmRNb2RlbElkbGVSZXNvbHZlcnMgPSBbXVxuXG4gIGZvciAoY29uc3QgcmVzb2x2ZSBvZiByZXNvbHZlcnMpIHtcbiAgICByZXNvbHZlKClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgd2FpdCBmb3IgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHF1aWV0IHBlcmlvZC5cbiAqIEBwYXJhbSB7bnVtYmVyfSBtaWxsaXNlY29uZHMgLSBRdWlldCBwZXJpb2QgbGVuZ3RoLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHRoZSBxdWlldCBwZXJpb2QuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JGcm9udGVuZE1vZGVsVHJhbnNwb3J0UXVpZXRQZXJpb2QobWlsbGlzZWNvbmRzKSB7XG4gIGlmIChtaWxsaXNlY29uZHMgPD0gMCkgcmV0dXJuXG5cbiAgYXdhaXQgd2FpdChtaWxsaXNlY29uZHMpXG59XG5cbi8qKlxuICogUnVucyB3YWl0IGZvciBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgaWRsZS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBxdWlldE1zIC0gTWlsbGlzZWNvbmRzIHRoZSB0cmFuc3BvcnQgbXVzdCBzdGF5IGlkbGUgYmVmb3JlIHJlc29sdmluZy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHRyYW5zcG9ydCBzdGF5cyBpZGxlLlxuICovXG5hc3luYyBmdW5jdGlvbiB3YWl0Rm9yRnJvbnRlbmRNb2RlbFRyYW5zcG9ydElkbGUocXVpZXRNcyA9IDApIHtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBpZiAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpKSB7XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gcXVldWVNaWNyb3Rhc2soKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKSlcblxuICAgICAgaWYgKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSkge1xuICAgICAgICBhd2FpdCB3YWl0Rm9yRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFF1aWV0UGVyaW9kKHF1aWV0TXMpXG5cbiAgICAgICAgaWYgKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSkgcmV0dXJuXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgIGZyb250ZW5kTW9kZWxJZGxlUmVzb2x2ZXJzLnB1c2goKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKVxuICAgICAgfSlcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHRyYWNrIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCByZXF1ZXN0LlxuICogQHRlbXBsYXRlIFRcbiAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc3BvcnQgY2FsbGJhY2suXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHRyYWNrRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3QoY2FsbGJhY2spIHtcbiAgYWN0aXZlRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3RDb3VudCArPSAxXG5cbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICB9IGZpbmFsbHkge1xuICAgIGFjdGl2ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0Q291bnQgLT0gMVxuICAgIHJlc29sdmVGcm9udGVuZE1vZGVsSWRsZVdhaXRlcnMoKVxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgaW50ZXJuYWwgd2Vic29ja2V0IGNsaWVudCBmcm9tIHdlYnNvY2tldFVybCBjb25maWcuXG4gKiBDcmVhdGVzIHRoZSBjbGllbnQgbGF6aWx5IG9uIGZpcnN0IGNhbGwuIFJldHVybnMgbnVsbCBpZiBXZWJTb2NrZXRcbiAqIGlzIG5vdCBhdmFpbGFibGUgb3Igd2Vic29ja2V0VXJsIGlzIG5vdCBjb25maWd1cmVkLlxuICogQHJldHVybnMge1ZlbG9jaW91c1dlYnNvY2tldENsaWVudCB8IG51bGx9IFdlYnNvY2tldCBjbGllbnQgb3IgbnVsbC5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkge1xuICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQpIHtcbiAgICBjb25zdCBjbGllbnQgPSBpbnRlcm5hbFdlYnNvY2tldENsaWVudFxuXG4gICAgYmluZEludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSlcblxuICAgIHJldHVybiBjbGllbnRcbiAgfVxuXG4gIGNvbnN0IHdlYnNvY2tldFVybCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0VXJsXG5cbiAgaWYgKCF3ZWJzb2NrZXRVcmwpIHJldHVybiBudWxsXG4gIGlmICh0eXBlb2YgZ2xvYmFsVGhpcy5XZWJTb2NrZXQgPT09IFwidW5kZWZpbmVkXCIpIHJldHVybiBudWxsXG5cbiAgY29uc3QgcmVzb2x2ZWRVcmwgPSB0eXBlb2Ygd2Vic29ja2V0VXJsID09PSBcImZ1bmN0aW9uXCIgPyB3ZWJzb2NrZXRVcmwoKSA6IHdlYnNvY2tldFVybFxuXG4gIGlmICghcmVzb2x2ZWRVcmwpIHJldHVybiBudWxsXG5cbiAgY29uc3QgY2xpZW50ID0gbmV3IFZlbG9jaW91c1dlYnNvY2tldENsaWVudCh7XG4gICAgYXV0b1JlY29ubmVjdDogdHJ1ZSxcbiAgICBzZXNzaW9uU3RvcmU6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2Vzc2lvblN0b3JlLFxuICAgIHVybDogcmVzb2x2ZWRVcmxcbiAgfSlcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgPSBjbGllbnRcbiAgY2xpZW50Lm9uUmVjb25uZWN0ID0gYXN5bmMgKCkgPT4gYXdhaXQgZmx1c2hCdWZmZXJlZE91dGdvaW5nRXZlbnRzQWZ0ZXJSZWNvbm5lY3QoY2xpZW50KVxuXG4gIGJpbmRJbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbChmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCkpXG5cbiAgcmV0dXJuIGNsaWVudFxufVxuXG4vKipcbiAqIFJ1bnMgZmx1c2ggYnVmZmVyZWQgb3V0Z29pbmcgZXZlbnRzIGFmdGVyIHJlY29ubmVjdC5cbiAqIEBwYXJhbSB7VmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50fSBjbGllbnQgLSBSZWNvbm5lY3RlZCBjbGllbnQgdGhhdCBvd25zIHRoaXMgZmx1c2guXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gKi9cbmFzeW5jIGZ1bmN0aW9uIGZsdXNoQnVmZmVyZWRPdXRnb2luZ0V2ZW50c0FmdGVyUmVjb25uZWN0KGNsaWVudCkge1xuICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgIT09IGNsaWVudCkgcmV0dXJuXG5cbiAgY29uc3QgZXZlbnRzID0gZHJhaW5CdWZmZXJlZE91dGdvaW5nRXZlbnRzKClcbiAgY29uc3Qgc2Vzc2lvblNpZ25hbCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKVxuXG4gIGF3YWl0IHJ1bldpdGhUcmFuc3BvcnREZWFkbGluZShcbiAgICB7XG4gICAgICBlcnJvck1lc3NhZ2U6IFwiQnVmZmVyZWQgZnJvbnRlbmQtbW9kZWwgV2ViU29ja2V0IGZsdXNoIHRpbWVkIG91dFwiLFxuICAgICAgc2lnbmFsOiBzZXNzaW9uU2lnbmFsLFxuICAgICAgdGltZW91dE1zOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKClcbiAgICB9LFxuICAgIGFzeW5jIChzaWduYWwpID0+IHtcbiAgICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBldmVudHMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgICAgIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IGNsaWVudC5wb3N0KGV2ZW50c1tpbmRleF0uY3VzdG9tUGF0aCwgZXZlbnRzW2luZGV4XS5wYXlsb2FkLCB7c2lnbmFsfSlcblxuICAgICAgICAgIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50ICE9PSBjbGllbnQpIHJldHVyblxuICAgICAgICAgIGlmIChzZXNzaW9uU2lnbmFsPy5hYm9ydGVkKSByZXR1cm5cblxuICAgICAgICAgIGlmIChzaWduYWwuYWJvcnRlZCkge1xuICAgICAgICAgICAgZm9yIChsZXQgcmVtYWluaW5nID0gaW5kZXg7IHJlbWFpbmluZyA8IGV2ZW50cy5sZW5ndGg7IHJlbWFpbmluZyArPSAxKSB7XG4gICAgICAgICAgICAgIGJ1ZmZlck91dGdvaW5nRXZlbnQoZXZlbnRzW3JlbWFpbmluZ10pXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHNvY2tldE9wZW4gPSBjbGllbnQuc29ja2V0Py5yZWFkeVN0YXRlID09PSBjbGllbnQuc29ja2V0Py5PUEVOXG5cbiAgICAgICAgICBpZiAoc29ja2V0T3BlbikgY29udGludWVcblxuICAgICAgICAgIGZvciAobGV0IHJlbWFpbmluZyA9IGluZGV4OyByZW1haW5pbmcgPCBldmVudHMubGVuZ3RoOyByZW1haW5pbmcgKz0gMSkge1xuICAgICAgICAgICAgYnVmZmVyT3V0Z29pbmdFdmVudChldmVudHNbcmVtYWluaW5nXSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgKVxufVxuXG4vKipcbiAqIFJ1bnMgZGVmYXVsdCBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBwYXRoLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGVmYXVsdCByZXNvdXJjZSBwYXRoIGZvciB0aGUgbW9kZWwgY2xhc3MuXG4gKi9cbmZ1bmN0aW9uIGRlZmF1bHRGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKG1vZGVsQ2xhc3MpIHtcbiAgcmV0dXJuIGAvJHtpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnBsdXJhbGl6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUobW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSkpKX1gXG59XG5cbi8qKiBFcnJvciByYWlzZWQgd2hlbiByZWFkaW5nIGFuIGF0dHJpYnV0ZSB0aGF0IHdhcyBub3Qgc2VsZWN0ZWQgaW4gcXVlcnkgcGF5bG9hZHMuICovXG5leHBvcnQgY2xhc3MgQXR0cmlidXRlTm90U2VsZWN0ZWRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSB0aGF0IHdhcyByZXF1ZXN0ZWQuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcihtb2RlbE5hbWUsIGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBzdXBlcihgJHttb2RlbE5hbWV9IyR7YXR0cmlidXRlTmFtZX0gd2FzIG5vdCBzZWxlY3RlZGApXG4gICAgdGhpcy5uYW1lID0gXCJBdHRyaWJ1dGVOb3RTZWxlY3RlZEVycm9yXCJcbiAgfVxufVxuXG4vKipcbiAqIExpZ2h0d2VpZ2h0IHNpbmd1bGFyIHJlbGF0aW9uc2hpcCBzdGF0ZSBob2xkZXIgZm9yIGZyb250ZW5kIG1vZGVsIGluc3RhbmNlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFNcbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFRcbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz1SZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+XVxuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gUGFyZW50IG1vZGVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzczxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4sIFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4sIFRhcmdldENyZWF0ZUF0dHJpYnV0ZXM+IHwgbnVsbH0gdGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG1vZGVsLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgdGhpcy5tb2RlbCA9IG1vZGVsXG4gICAgdGhpcy5yZWxhdGlvbnNoaXBOYW1lID0gcmVsYXRpb25zaGlwTmFtZVxuICAgIHRoaXMudGFyZ2V0TW9kZWxDbGFzcyA9IHRhcmdldE1vZGVsQ2xhc3NcbiAgICB0aGlzLl9wcmVsb2FkZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBsb2FkZWQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbCB8IHVuZGVmaW5lZH0gbG9hZGVkVmFsdWUgLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldExvYWRlZChsb2FkZWRWYWx1ZSkge1xuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gbG9hZGVkVmFsdWUgPT0gdW5kZWZpbmVkID8gbnVsbCA6IGxvYWRlZFZhbHVlXG4gICAgdGhpcy5fcHJlbG9hZGVkID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHByZWxvYWRlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZWxhdGlvbnNoaXAgaXMgcHJlbG9hZGVkLlxuICAgKi9cbiAgZ2V0UHJlbG9hZGVkKCkge1xuICAgIHJldHVybiB0aGlzLl9wcmVsb2FkZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWRlZC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGx9IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGxvYWRlZCgpIHtcbiAgICBpZiAoIXRoaXMuX3ByZWxvYWRlZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IGhhc24ndCBiZWVuIHByZWxvYWRlZGApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2xvYWRlZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ29waWVzIGxvYWRlZCB2YWx1ZSBmcm9tIGFub3RoZXIgc2luZ3VsYXIgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSBzb3VyY2VSZWxhdGlvbnNoaXAgLSBTb3VyY2UgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjb3B5TG9hZGVkRnJvbShzb3VyY2VSZWxhdGlvbnNoaXApIHtcbiAgICBpZiAoc291cmNlUmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSBzb3VyY2UgcmVsYXRpb25zaGlwIHRvIGJlIHNpbmd1bGFyYClcbiAgICB9XG5cbiAgICAvLyBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSB0YXJnZXQgcmVsYXRpb25zaGlwJ3MgZG9jdW1lbnRlZCBtb2RlbCB0eXBlLlxuICAgIGNvbnN0IGxvYWRlZFZhbHVlID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsfSAqLyAoc291cmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpKVxuXG4gICAgdGhpcy5zZXRMb2FkZWQobG9hZGVkVmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZC5cbiAgICogQHBhcmFtIHtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzfSBbYXR0cmlidXRlc10gLSBOZXcgbW9kZWwgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPn0gLSBCdWlsdCBtb2RlbC5cbiAgICovXG4gIGJ1aWxkKGF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge1RhcmdldENyZWF0ZUF0dHJpYnV0ZXN9ICovICh7fSkpIHtcbiAgICBpZiAoIXRoaXMudGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcykgPT4gRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+fSAqLyAodGhpcy50YXJnZXRNb2RlbENsYXNzKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoYXR0cmlidXRlcylcblxuICAgIHRoaXMuc2V0TG9hZGVkKG1vZGVsKVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogRm9yY2UtcmVsb2FkIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGw+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgbW9kZWwuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBudWxsXG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5tb2RlbC5fdHJ5Q29ob3J0UHJlbG9hZCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoYmF0Y2hlZCkgcmV0dXJuIHRoaXMubG9hZGVkKClcblxuICAgIGF3YWl0IHRoaXMubW9kZWwubG9hZFJlbGF0aW9uc2hpcCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICByZXR1cm4gdGhpcy5sb2FkZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGxvYWRlZCByZWxhdGlvbnNoaXAgb3IgbG9hZHMgaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGw+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgbW9kZWwuXG4gICAqL1xuICBhc3luYyBvckxvYWQoKSB7XG4gICAgaWYgKHRoaXMuZ2V0UHJlbG9hZGVkKCkpIHJldHVybiB0aGlzLmxvYWRlZCgpXG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5tb2RlbC5fdHJ5Q29ob3J0UHJlbG9hZCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoYmF0Y2hlZCkgcmV0dXJuIHRoaXMubG9hZGVkKClcblxuICAgIGF3YWl0IHRoaXMubW9kZWwubG9hZFJlbGF0aW9uc2hpcCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICByZXR1cm4gdGhpcy5sb2FkZWQoKVxuICB9XG59XG5cbi8qKlxuICogTGlnaHR3ZWlnaHQgaGFzLW1hbnkgcmVsYXRpb25zaGlwIHN0YXRlIGhvbGRlciBmb3IgZnJvbnRlbmQgbW9kZWwgaW5zdGFuY2VzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gU1xuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gVFxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzPVJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT5dXG4gKi9cbmV4cG9ydCBjbGFzcyBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCB7XG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSAqL1xuICBfbG9hZGVkVmFsdWVcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBQYXJlbnQgbW9kZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzPEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz4gfCBudWxsfSB0YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgY29uc3RydWN0b3IobW9kZWwsIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICB0aGlzLm1vZGVsID0gbW9kZWxcbiAgICB0aGlzLnJlbGF0aW9uc2hpcE5hbWUgPSByZWxhdGlvbnNoaXBOYW1lXG4gICAgdGhpcy50YXJnZXRNb2RlbENsYXNzID0gdGFyZ2V0TW9kZWxDbGFzc1xuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGxvYWRlZC5cbiAgICogQHBhcmFtIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSBsb2FkZWRWYWx1ZSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0TG9hZGVkKGxvYWRlZFZhbHVlKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGxvYWRlZFZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IHRvIGJlIGxvYWRlZCB3aXRoIGFuIGFycmF5YClcbiAgICB9XG5cbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IGxvYWRlZFZhbHVlXG4gICAgdGhpcy5fcHJlbG9hZGVkID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHByZWxvYWRlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZWxhdGlvbnNoaXAgaXMgcHJlbG9hZGVkLlxuICAgKi9cbiAgZ2V0UHJlbG9hZGVkKCkge1xuICAgIHJldHVybiB0aGlzLl9wcmVsb2FkZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWRlZC5cbiAgICogQHJldHVybnMge0FycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZXMuXG4gICAqL1xuICBsb2FkZWQoKSB7XG4gICAgaWYgKCF0aGlzLl9wcmVsb2FkZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSBoYXNuJ3QgYmVlbiBwcmVsb2FkZWRgKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9sb2FkZWRWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIENvcGllcyBsb2FkZWQgdmFsdWUgZnJvbSBhbm90aGVyIGhhcy1tYW55IHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gc291cmNlUmVsYXRpb25zaGlwIC0gU291cmNlIHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY29weUxvYWRlZEZyb20oc291cmNlUmVsYXRpb25zaGlwKSB7XG4gICAgaWYgKCEoc291cmNlUmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX0gc291cmNlIHJlbGF0aW9uc2hpcCB0byBiZSBoYXMtbWFueWApXG4gICAgfVxuXG4gICAgLy8gTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgdGFyZ2V0IHJlbGF0aW9uc2hpcCdzIGRvY3VtZW50ZWQgbW9kZWwgdHlwZS5cbiAgICBjb25zdCBsb2FkZWRWYWx1ZSA9IC8qKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pn0gKi8gKHNvdXJjZVJlbGF0aW9uc2hpcC5sb2FkZWQoKSlcblxuICAgIHRoaXMuc2V0TG9hZGVkKGxvYWRlZFZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIHRvIGxvYWRlZC5cbiAgICogQHBhcmFtIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSBtb2RlbHMgLSBNb2RlbHMgdG8gYXBwZW5kLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZFRvTG9hZGVkKG1vZGVscykge1xuICAgIGNvbnN0IGxvYWRlZE1vZGVscyA9IHRoaXMuZ2V0UHJlbG9hZGVkKCkgPyB0aGlzLmxvYWRlZCgpIDogW11cblxuICAgIHRoaXMuc2V0TG9hZGVkKFsuLi5sb2FkZWRNb2RlbHMsIC4uLm1vZGVsc10pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZC5cbiAgICogQHBhcmFtIHtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzfSBbYXR0cmlidXRlc10gLSBOZXcgbW9kZWwgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPn0gLSBCdWlsdCBtb2RlbC5cbiAgICovXG4gIGJ1aWxkKGF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge1RhcmdldENyZWF0ZUF0dHJpYnV0ZXN9ICovICh7fSkpIHtcbiAgICBpZiAoIXRoaXMudGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcykgPT4gRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+fSAqLyAodGhpcy50YXJnZXRNb2RlbENsYXNzKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoYXR0cmlidXRlcylcblxuICAgIHRoaXMuYWRkVG9Mb2FkZWQoW21vZGVsXSlcblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIEZvcmNlLXJlbG9hZCB0aGUgcmVsYXRpb25zaGlwLiBXaGVuIHRoZSBwYXJlbnQgcmVjb3JkIHdhcyBsb2FkZWQgYXMgcGFydFxuICAgKiBvZiBhIGJhdGNoLCBzaWJsaW5ncyB0aGF0IGhhdmUgbm90IHByZWxvYWRlZCB0aGlzIHJlbGF0aW9uc2hpcCBnZXRcbiAgICogYmF0Y2hlZCBpbnRvIG9uZSByZXF1ZXN0IHZpYSB0aGUgY29ob3J0IHByZWxvYWRlci4gVGhlIHNjb3BlZCBxdWVyeSBwYXRoXG4gICAqIChgTW9kZWwud2hlcmUoLi4uKS5wcmVsb2FkKFtuYW1lXSkudG9BcnJheSgpYCBkaXJlY3RseSBmcm9tIHVzZXIgY29kZSlcbiAgICogYnlwYXNzZXMgY29ob3J0IGJhdGNoaW5nIGJ5IGRlc2lnbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBtb2RlbHMuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIC8vIFJlc2V0IHNvIHRoZSBjb2hvcnQgcHJlbG9hZGVyIChvciBzaW5nbGUtcmVjb3JkIGZhbGxiYWNrKSByZXBvcHVsYXRlcy5cbiAgICB0aGlzLl9wcmVsb2FkZWQgPSBmYWxzZVxuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gW11cblxuICAgIGNvbnN0IGJhdGNoZWQgPSBhd2FpdCB0aGlzLm1vZGVsLl90cnlDb2hvcnRQcmVsb2FkKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChiYXRjaGVkKSByZXR1cm4gdGhpcy5fbG9hZGVkVmFsdWVcblxuICAgIGF3YWl0IHRoaXMubW9kZWwubG9hZFJlbGF0aW9uc2hpcCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICByZXR1cm4gdGhpcy5sb2FkZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYXJyYXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj4+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgbW9kZWxzLlxuICAgKi9cbiAgYXN5bmMgdG9BcnJheSgpIHtcbiAgICBpZiAodGhpcy5nZXRQcmVsb2FkZWQoKSB8fCB0aGlzLl9sb2FkZWRWYWx1ZS5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gdGhpcy5fbG9hZGVkVmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkKClcbiAgfVxufVxuXG4vKipcbiAqIENvcGllcyBsb2FkZWQgcmVsYXRpb25zaGlwIHN0YXRlIGJldHdlZW4gaGVscGVycyBvZiB0aGUgc2FtZSByZWxhdGlvbnNoaXAgc2hhcGUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gYXJncy5zb3VyY2VSZWxhdGlvbnNoaXAgLSBTb3VyY2UgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gYXJncy50YXJnZXRSZWxhdGlvbnNoaXAgLSBUYXJnZXQgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBjb3B5TG9hZGVkUmVsYXRpb25zaGlwVmFsdWUoe3NvdXJjZVJlbGF0aW9uc2hpcCwgdGFyZ2V0UmVsYXRpb25zaGlwfSkge1xuICB0YXJnZXRSZWxhdGlvbnNoaXAuY29weUxvYWRlZEZyb20oc291cmNlUmVsYXRpb25zaGlwKVxufVxuXG4vKipcbiAqIFJ1bnMgcmVsYXRpb25zaGlwIHR5cGUgaXMgY29sbGVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBUeXBlIC0gUmVsYXRpb25zaGlwIHR5cGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlbGF0aW9uc2hpcCB0eXBlIGlzIGhhcy1tYW55LlxuICovXG5mdW5jdGlvbiByZWxhdGlvbnNoaXBUeXBlSXNDb2xsZWN0aW9uKHJlbGF0aW9uc2hpcFR5cGUpIHtcbiAgcmV0dXJuIHJlbGF0aW9uc2hpcFR5cGUgPT0gXCJoYXNNYW55XCJcbn1cblxuLyoqXG4gKiBEb3dubG9hZGVkIGZyb250ZW5kLW1vZGVsIGF0dGFjaG1lbnQgcGF5bG9hZCB3cmFwcGVyLlxuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREb3dubG9hZCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmlkIC0gQXR0YWNobWVudCBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmlsZW5hbWUgLSBGaWxlbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBhcmdzLmNvbnRlbnRUeXBlIC0gQ29udGVudCB0eXBlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5ieXRlU2l6ZSAtIEZpbGUgc2l6ZSBpbiBieXRlcy5cbiAgICogQHBhcmFtIHtVaW50OEFycmF5fSBhcmdzLmNvbnRlbnQgLSBGaWxlIGNvbnRlbnQgYnl0ZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gW2FyZ3MudXJsXSAtIFJlc29sdmFibGUgYXR0YWNobWVudCBVUkwuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Ynl0ZVNpemUsIGNvbnRlbnQsIGNvbnRlbnRUeXBlLCBmaWxlbmFtZSwgaWQsIHVybCA9IG51bGx9KSB7XG4gICAgdGhpcy5pZFZhbHVlID0gaWRcbiAgICB0aGlzLmZpbGVuYW1lVmFsdWUgPSBmaWxlbmFtZVxuICAgIHRoaXMuY29udGVudFR5cGVWYWx1ZSA9IGNvbnRlbnRUeXBlXG4gICAgdGhpcy5ieXRlU2l6ZVZhbHVlID0gYnl0ZVNpemVcbiAgICB0aGlzLmNvbnRlbnRWYWx1ZSA9IGNvbnRlbnRcbiAgICB0aGlzLnVybFZhbHVlID0gdXJsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBieXRlIHNpemUuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRmlsZSBzaXplIGluIGJ5dGVzLlxuICAgKi9cbiAgYnl0ZVNpemUoKSB7IHJldHVybiB0aGlzLmJ5dGVTaXplVmFsdWUgfVxuICAvKipcbiAgICogUnVucyBjb250ZW50LlxuICAgKiBAcmV0dXJucyB7VWludDhBcnJheX0gLSBGaWxlIGNvbnRlbnQgYnl0ZXMuXG4gICAqL1xuICBjb250ZW50KCkgeyByZXR1cm4gdGhpcy5jb250ZW50VmFsdWUgfVxuICAvKipcbiAgICogUnVucyBjb250ZW50IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIENvbnRlbnQgdHlwZS5cbiAgICovXG4gIGNvbnRlbnRUeXBlKCkgeyByZXR1cm4gdGhpcy5jb250ZW50VHlwZVZhbHVlIH1cbiAgLyoqXG4gICAqIFJ1bnMgZmlsZW5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRmlsZW5hbWUuXG4gICAqL1xuICBmaWxlbmFtZSgpIHsgcmV0dXJuIHRoaXMuZmlsZW5hbWVWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIGlkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgaWQuXG4gICAqL1xuICBpZCgpIHsgcmV0dXJuIHRoaXMuaWRWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIHVybC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmVzb2x2YWJsZSBhdHRhY2htZW50IFVSTC5cbiAgICovXG4gIHVybCgpIHsgcmV0dXJuIHRoaXMudXJsVmFsdWUgfVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgYXR0YWNobWVudCBjb21tYW5kIHBheWxvYWQuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxBdHRhY2htZW50SGFuZGxlfSBhdHRhY2htZW50IC0gQXR0YWNobWVudCB3cmFwcGVyLlxuICogQHBhcmFtIHtzdHJpbmd9IFthdHRhY2htZW50SWRdIC0gT3B0aW9uYWwgaGFzLW1hbnkgYXR0YWNobWVudCBpZC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ29tbWFuZCBwYXlsb2FkLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQXR0YWNobWVudENvbW1hbmRQYXlsb2FkKGF0dGFjaG1lbnQsIGF0dGFjaG1lbnRJZCkge1xuICAvKipcbiAgICogUGF5bG9hZC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICBhdHRhY2htZW50TmFtZTogYXR0YWNobWVudC5hdHRhY2htZW50TmFtZSxcbiAgICBpZDogYXR0YWNobWVudC5tb2RlbC5wcmltYXJ5S2V5VmFsdWUoKVxuICB9XG5cbiAgaWYgKGF0dGFjaG1lbnRJZCkgcGF5bG9hZC5hdHRhY2htZW50SWQgPSBhdHRhY2htZW50SWRcblxuICByZXR1cm4gcGF5bG9hZFxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGNhbm9uaWNhbCBiYWNraW5nIG93bmVyIHVzZWQgYnkgYXR0YWNobWVudCBtZXRhZGF0YSBzdG9yYWdlLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBGcm9udGVuZCBhdHRhY2htZW50IG93bmVyLlxuICogQHJldHVybnMge3tyZWNvcmRJZDogc3RyaW5nLCByZWNvcmRUeXBlOiBzdHJpbmcsIHJlc291cmNlTmFtZTogc3RyaW5nfX0gLSBDYW5vbmljYWwgYXR0YWNobWVudCBvd25lciBhbmQgb3JpZ2luYXRpbmcgcmVzb3VyY2UuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxBdHRhY2htZW50T3duZXIobW9kZWwpIHtcbiAgaWYgKCFtb2RlbC5fYXR0YWNobWVudE93bmVyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIGF0dGFjaG1lbnQgb3duZXIgbWV0YWRhdGEgb24gJHtmcm9udGVuZE1vZGVsQ2xhc3NGb3IobW9kZWwpLm5hbWV9YClcbiAgfVxuXG4gIHJldHVybiBtb2RlbC5fYXR0YWNobWVudE93bmVyXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IHZhbHVlIGlzIGJ5dGVzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHZhbHVlIGxvb2tzIGxpa2UgYnl0ZSBkYXRhLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzQnl0ZXModmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlIGluc3RhbmNlb2YgVWludDhBcnJheSB8fCB2YWx1ZSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyIHx8ICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiICYmIEJ1ZmZlci5pc0J1ZmZlcih2YWx1ZSkpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IHZhbHVlIHN1cHBvcnRzIGFycmF5IGJ1ZmZlci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge3ZhbHVlIGlzIHthcnJheUJ1ZmZlcjogKCkgPT4gUHJvbWlzZTxBcnJheUJ1ZmZlcj59fSAtIFdoZXRoZXIgY2FuZGlkYXRlIHN1cHBvcnRzIGFycmF5QnVmZmVyKCkuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudFZhbHVlU3VwcG9ydHNBcnJheUJ1ZmZlcih2YWx1ZSkge1xuICByZXR1cm4gQm9vbGVhbih2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh2YWx1ZSkuYXJyYXlCdWZmZXIgPT09IFwiZnVuY3Rpb25cIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgbm9ybWFsaXplIGJ5dGVzLlxuICogQHBhcmFtIHtVaW50OEFycmF5IHwgQnVmZmVyIHwgQXJyYXlCdWZmZXJ9IHZhbHVlIC0gQnl0ZS1saWtlIHZhbHVlLlxuICogQHJldHVybnMge1VpbnQ4QXJyYXl9IC0gVWludDhBcnJheSBieXRlcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50Tm9ybWFsaXplQnl0ZXModmFsdWUpIHtcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgVWludDhBcnJheSkgcmV0dXJuIHZhbHVlXG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSByZXR1cm4gbmV3IFVpbnQ4QXJyYXkodmFsdWUpXG4gIGlmICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiICYmIEJ1ZmZlci5pc0J1ZmZlcigvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodmFsdWUpKSkge1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheSgvKiogQHR5cGUge0J1ZmZlcn0gKi8gKHZhbHVlKSlcbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIGF0dGFjaG1lbnQgYnl0ZXMgdmFsdWVcIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgYnl0ZXMgdG8gYmFzZTY0LlxuICogQHBhcmFtIHtVaW50OEFycmF5fSBieXRlcyAtIEJ5dGVzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBCYXNlNjQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudEJ5dGVzVG9CYXNlNjQoYnl0ZXMpIHtcbiAgaWYgKHR5cGVvZiBCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICByZXR1cm4gQnVmZmVyLmZyb20oYnl0ZXMpLnRvU3RyaW5nKFwiYmFzZTY0XCIpXG4gIH1cblxuICBsZXQgYmluYXJ5ID0gXCJcIlxuXG4gIGZvciAoY29uc3QgYnl0ZSBvZiBieXRlcykge1xuICAgIGJpbmFyeSArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGUpXG4gIH1cblxuICBpZiAodHlwZW9mIGJ0b2EgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiTWlzc2luZyBiYXNlNjQgZW5jb2RlclwiKVxuXG4gIHJldHVybiBidG9hKGJpbmFyeSlcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgYmFzZTY0IHRvIGJ5dGVzLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gQmFzZTY0IHZhbHVlLlxuICogQHJldHVybnMge1VpbnQ4QXJyYXl9IC0gRGVjb2RlZCBieXRlcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50QmFzZTY0VG9CeXRlcyh2YWx1ZSkge1xuICBpZiAodHlwZW9mIEJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheShCdWZmZXIuZnJvbSh2YWx1ZSwgXCJiYXNlNjRcIikpXG4gIH1cblxuICBpZiAodHlwZW9mIGF0b2IgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiTWlzc2luZyBiYXNlNjQgZGVjb2RlclwiKVxuXG4gIGNvbnN0IGJpbmFyeSA9IGF0b2IodmFsdWUpXG4gIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYmluYXJ5Lmxlbmd0aClcblxuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgYmluYXJ5Lmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGJ5dGVzW2luZGV4XSA9IGJpbmFyeS5jaGFyQ29kZUF0KGluZGV4KVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVzXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IHZhbHVlIGlzIHBsYWluIG9iamVjdC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge3ZhbHVlIGlzIFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBXaGV0aGVyIHZhbHVlIGlzIHBsYWluIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICBjb25zdCBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpXG5cbiAgcmV0dXJuIHByb3RvdHlwZSA9PT0gT2JqZWN0LnByb3RvdHlwZSB8fCBwcm90b3R5cGUgPT09IG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHBheWxvYWQgY29udGFpbnMgYXR0YWNobWVudCB1cGxvYWQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFBheWxvYWQgY2FuZGlkYXRlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBwYXlsb2FkIGNvbnRhaW5zIGFuIGF0dGFjaG1lbnQgdXBsb2FkIGJvZHkuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxQYXlsb2FkQ29udGFpbnNBdHRhY2htZW50VXBsb2FkKHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcblxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gdmFsdWUuc29tZSgoZW50cnkpID0+IGZyb250ZW5kTW9kZWxQYXlsb2FkQ29udGFpbnNBdHRhY2htZW50VXBsb2FkKGVudHJ5KSlcbiAgfVxuXG4gIGlmICghZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KHZhbHVlKSkgcmV0dXJuIGZhbHNlXG5cbiAgaWYgKHR5cGVvZiB2YWx1ZS5jb250ZW50QmFzZTY0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIHJldHVybiBPYmplY3QudmFsdWVzKHZhbHVlKS5zb21lKChlbnRyeSkgPT4gZnJvbnRlbmRNb2RlbFBheWxvYWRDb250YWluc0F0dGFjaG1lbnRVcGxvYWQoZW50cnkpKVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGNvbmNyZXRlIGZyb250ZW5kLW1vZGVsIGNsYXNzIGZvciBhbiBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gRnJvbnRlbmQgbW9kZWwgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbENsYXNzfSBDb25jcmV0ZSBmcm9udGVuZC1tb2RlbCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbENsYXNzRm9yKG1vZGVsKSB7XG4gIGNvbnN0IGNvbnN0cnVjdG9yVmFsdWUgPSBtb2RlbC5jb25zdHJ1Y3RvclxuXG4gIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxDbGFzc30gKi8gKGNvbnN0cnVjdG9yVmFsdWUpXG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgY29uZmlndXJlZCBvZmZsaW5lIHF1ZXVlIHNob3VsZCBoYW5kbGUgYSBtb2RlbCBvcGVyYXRpb24uXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBvcGVyYXRpb24gLSBTeW5jIG9wZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdG8gcXVldWUgbG9jYWxseS5cbiAqL1xuZnVuY3Rpb24gc2hvdWxkUXVldWVGcm9udGVuZE1vZGVsT3BlcmF0aW9uT2ZmbGluZShNb2RlbENsYXNzLCBvcGVyYXRpb24pIHtcbiAgY29uc3Qgb2ZmbGluZVN5bmMgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jXG5cbiAgaWYgKCFvZmZsaW5lU3luYz8uZW5hYmxlZCkgcmV0dXJuIGZhbHNlXG5cbiAgY29uc3Qgc3luY0NvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKS5zeW5jXG5cbiAgaWYgKCFzeW5jQ29uZmlnPy5lbmFibGVkKSByZXR1cm4gZmFsc2VcbiAgaWYgKCFzeW5jQ29uZmlnLm9wZXJhdGlvbnMuaW5jbHVkZXMob3BlcmF0aW9uKSkgdGhyb3cgbmV3IEVycm9yKGBPZmZsaW5lIHN5bmMgZm9yICR7TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gZG9lcyBub3QgYWxsb3cgJHtvcGVyYXRpb259YClcblxuICByZXR1cm4gdHJ1ZVxufVxuXG4vKipcbiAqIFF1ZXVlcyBhbiBvZmZsaW5lIHN5bmMgbXV0YXRpb24uXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gYXJncy5hdHRyaWJ1dGVzIC0gTXV0YXRpb24gYXR0cmlidXRlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5jbGllbnRNdXRhdGlvbklkXSAtIFByZS1nZW5lcmF0ZWQgbXV0YXRpb24gaWQuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gYXJncy5Nb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFyZ3Mub3BlcmF0aW9uIC0gU3luYyBvcGVyYXRpb24uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIENsaWVudCBtdXRhdGlvbiBpZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcXVldWVGcm9udGVuZE1vZGVsTXV0YXRpb25PZmZsaW5lKHthdHRyaWJ1dGVzLCBjbGllbnRNdXRhdGlvbklkOiBwcm92aWRlZENsaWVudE11dGF0aW9uSWQsIE1vZGVsQ2xhc3MsIG9wZXJhdGlvbn0pIHtcbiAgY29uc3Qgb2ZmbGluZVN5bmMgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jXG5cbiAgaWYgKCFvZmZsaW5lU3luYykgdGhyb3cgbmV3IEVycm9yKFwiT2ZmbGluZSBzeW5jIGlzIG5vdCBjb25maWd1cmVkXCIpXG5cbiAgY29uc3Qgc3luY0NvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKS5zeW5jXG4gIGlmICghc3luY0NvbmZpZz8uZW5hYmxlZCkgdGhyb3cgbmV3IEVycm9yKGBPZmZsaW5lIHN5bmMgaXMgbm90IGVuYWJsZWQgZm9yICR7TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gKVxuXG4gIGNvbnN0IG5vdyA9IG9mZmxpbmVTeW5jLm5vdyA/IG9mZmxpbmVTeW5jLm5vdygpIDogbmV3IERhdGUoKVxuICBpZiAoIShub3cgaW5zdGFuY2VvZiBEYXRlKSB8fCBOdW1iZXIuaXNOYU4obm93LmdldFRpbWUoKSkpIHRocm93IG5ldyBFcnJvcihcIm9mZmxpbmVTeW5jLm5vdyBtdXN0IHJldHVybiBhIHZhbGlkIERhdGVcIilcblxuICBjb25zdCBjbGllbnRNdXRhdGlvbklkID0gcHJvdmlkZWRDbGllbnRNdXRhdGlvbklkIHx8IChvZmZsaW5lU3luYy5jbGllbnRNdXRhdGlvbklkID8gb2ZmbGluZVN5bmMuY2xpZW50TXV0YXRpb25JZCgpIDogZnJvbnRlbmRNb2RlbE9mZmxpbmVNdXRhdGlvbklkKCkpXG4gIGlmICh0eXBlb2YgY2xpZW50TXV0YXRpb25JZCAhPT0gXCJzdHJpbmdcIiB8fCBjbGllbnRNdXRhdGlvbklkLmxlbmd0aCA8IDEpIHRocm93IG5ldyBFcnJvcihcIm9mZmxpbmVTeW5jLmNsaWVudE11dGF0aW9uSWQgbXVzdCByZXR1cm4gYSBub24tZW1wdHkgc3RyaW5nXCIpXG5cbiAgYXdhaXQgb2ZmbGluZVN5bmMubXV0YXRpb25Mb2cuYXBwZW5kKHtcbiAgICBtdXRhdGlvbjoge1xuICAgICAgYWN0b3JEZXZpY2VJZDogb2ZmbGluZVN5bmMuYWN0b3JEZXZpY2VJZCxcbiAgICAgIGFjdG9yVXNlcklkOiBvZmZsaW5lU3luYy5hY3RvclVzZXJJZCxcbiAgICAgIGF0dHJpYnV0ZXM6IGZyb250ZW5kTW9kZWxTeW5jSnNvbk9iamVjdChhdHRyaWJ1dGVzKSxcbiAgICAgIGJhc2VWZXJzaW9uOiBudWxsLFxuICAgICAgY2xpZW50TXV0YXRpb25JZCxcbiAgICAgIG1vZGVsOiBNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgb2NjdXJyZWRBdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICBvZmZsaW5lR3JhbnRJZDogb2ZmbGluZVN5bmMub2ZmbGluZUdyYW50LmlkLFxuICAgICAgb3BlcmF0aW9uLFxuICAgICAgcG9saWN5SGFzaDogc3luY0NvbmZpZy5wb2xpY3lIYXNoXG4gICAgfVxuICB9KVxuXG4gIHJldHVybiBjbGllbnRNdXRhdGlvbklkXG59XG5cbi8qKlxuICogR2VuZXJhdGVzIGEgZnJvbnRlbmQtbW9kZWwgb2ZmbGluZSBtdXRhdGlvbiBpZC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTG9jYWwgbXV0YXRpb24gaWQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxPZmZsaW5lTXV0YXRpb25JZCgpIHtcbiAgaWYgKGdsb2JhbFRoaXMuY3J5cHRvICYmIHR5cGVvZiBnbG9iYWxUaGlzLmNyeXB0by5yYW5kb21VVUlEID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiBnbG9iYWxUaGlzLmNyeXB0by5yYW5kb21VVUlEKClcblxuICByZXR1cm4gYGZyb250ZW5kLW11dGF0aW9uLSR7RGF0ZS5ub3coKX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX1gXG59XG5cbi8qKlxuICogQ29udmVydHMgbW9kZWwgYXR0cmlidXRlcyB0byBzeW5jLXNhZmUgSlNPTiBwYXlsb2FkIHZhbHVlcy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gYXR0cmlidXRlcyAtIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZXMuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59IC0gU3luYy1zYWZlIGF0dHJpYnV0ZXMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxTeW5jSnNvbk9iamVjdChhdHRyaWJ1dGVzKSB7XG4gIGNvbnN0IHNlcmlhbGl6ZWQgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGF0dHJpYnV0ZXMpKVxuXG4gIGlmICghc2VyaWFsaXplZCB8fCB0eXBlb2Ygc2VyaWFsaXplZCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHNlcmlhbGl6ZWQpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBzeW5jIG11dGF0aW9uIGF0dHJpYnV0ZXMgb2JqZWN0XCIpXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59ICovIChzZXJpYWxpemVkKVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIGF0dGFjaG1lbnQgaW5wdXQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBpbnB1dCAtIEF0dGFjaG1lbnQgaW5wdXQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFRyYW5zcG9ydC1zYWZlIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQoaW5wdXQpIHtcbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChpbnB1dCkgJiYgXCJmaWxlXCIgaW4gaW5wdXQpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRmlsZSA9IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0LmZpbGUpXG4gICAgY29uc3QgbWVyZ2VkID0ge1xuICAgICAgLi4ubm9ybWFsaXplZEZpbGVcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGlucHV0LmZpbGVuYW1lID09PSBcInN0cmluZ1wiICYmIGlucHV0LmZpbGVuYW1lLmxlbmd0aCA+IDApIG1lcmdlZC5maWxlbmFtZSA9IGlucHV0LmZpbGVuYW1lXG4gICAgaWYgKHR5cGVvZiBpbnB1dC5jb250ZW50VHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5jb250ZW50VHlwZS5sZW5ndGggPiAwKSBtZXJnZWQuY29udGVudFR5cGUgPSBpbnB1dC5jb250ZW50VHlwZVxuXG4gICAgcmV0dXJuIG1lcmdlZFxuICB9XG5cbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChpbnB1dCkpIHtcbiAgICBpZiAodHlwZW9mIGlucHV0LnBhdGggPT09IFwic3RyaW5nXCIgJiYgaW5wdXQucGF0aC5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdHRhY2htZW50IHBhdGggaW5wdXQgaXMgbm90IHN1cHBvcnRlZCBpbiBmcm9udGVuZCBtb2RlbHNcIilcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGlucHV0LmNvbnRlbnRCYXNlNjQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvbnRlbnRCYXNlNjQ6IGlucHV0LmNvbnRlbnRCYXNlNjQsXG4gICAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgaW5wdXQuY29udGVudFR5cGUgPT09IFwic3RyaW5nXCIgJiYgaW5wdXQuY29udGVudFR5cGUubGVuZ3RoID4gMCA/IGlucHV0LmNvbnRlbnRUeXBlIDogbnVsbCxcbiAgICAgICAgZmlsZW5hbWU6IHR5cGVvZiBpbnB1dC5maWxlbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5maWxlbmFtZS5sZW5ndGggPiAwID8gaW5wdXQuZmlsZW5hbWUgOiB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpZiAoZnJvbnRlbmRBdHRhY2htZW50VmFsdWVTdXBwb3J0c0FycmF5QnVmZmVyKGlucHV0KSkge1xuICAgIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYXdhaXQgaW5wdXQuYXJyYXlCdWZmZXIoKSlcblxuICAgIHJldHVybiB7XG4gICAgICBjb250ZW50QmFzZTY0OiBmcm9udGVuZEF0dGFjaG1lbnRCeXRlc1RvQmFzZTY0KGJ5dGVzKSxcbiAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS50eXBlID09PSBcInN0cmluZ1wiICYmIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkudHlwZS5sZW5ndGggPiAwXG4gICAgICAgID8gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS50eXBlXG4gICAgICAgIDogbnVsbCxcbiAgICAgIGZpbGVuYW1lOiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS5uYW1lID09PSBcInN0cmluZ1wiICYmIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkubmFtZS5sZW5ndGggPiAwXG4gICAgICAgID8gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS5uYW1lXG4gICAgICAgIDogXCJhdHRhY2htZW50LmJpblwiXG4gICAgfVxuICB9XG5cbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNCeXRlcyhpbnB1dCkpIHtcbiAgICBjb25zdCBieXRlcyA9IGZyb250ZW5kQXR0YWNobWVudE5vcm1hbGl6ZUJ5dGVzKC8qKiBAdHlwZSB7VWludDhBcnJheSB8IEJ1ZmZlciB8IEFycmF5QnVmZmVyfSAqLyAoaW5wdXQpKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnRlbnRCYXNlNjQ6IGZyb250ZW5kQXR0YWNobWVudEJ5dGVzVG9CYXNlNjQoYnl0ZXMpLFxuICAgICAgY29udGVudFR5cGU6IG51bGwsXG4gICAgICBmaWxlbmFtZTogXCJhdHRhY2htZW50LmJpblwiXG4gICAgfVxuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiVW5zdXBwb3J0ZWQgZnJvbnRlbmQgYXR0YWNobWVudCBpbnB1dFwiKVxufVxuXG4vKipcbiAqIEZyb250ZW5kLW1vZGVsIGF0dGFjaG1lbnQgaGVscGVyIGZvciBvbmUgYXR0YWNobWVudCBuYW1lLlxuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGUge1xuICAvKipcbiAgICogUGVuZGluZyBhdHRhY2htZW50IGlucHV0cyBxdWV1ZWQgZm9yIHRoZSBuZXh0IG1vZGVsIHNhdmUuXG4gICAqIEB0eXBlIHtGcm9udGVuZE1vZGVsQXR0YWNobWVudElucHV0W119XG4gICAqL1xuICBwZW5kaW5nSW5wdXRzID0gW11cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2F0dGFjaG1lbnROYW1lLCBtb2RlbH0pIHtcbiAgICB0aGlzLm1vZGVsID0gbW9kZWxcbiAgICB0aGlzLmF0dGFjaG1lbnROYW1lID0gYXR0YWNobWVudE5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZSBhdHRhY2htZW50IGlucHV0IGZvciB0aGUgcGFyZW50IG1vZGVsJ3MgbmV4dCBzYXZlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxBdHRhY2htZW50SW5wdXQgfCBGcm9udGVuZE1vZGVsQXR0YWNobWVudElucHV0W119IGlucHV0IC0gQXR0YWNobWVudCBpbnB1dC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBxdWV1ZUF0dGFjaChpbnB1dCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24odGhpcy5hdHRhY2htZW50TmFtZSlcblxuICAgIGlmIChhdHRhY2htZW50RGVmaW5pdGlvbj8udHlwZSA9PT0gXCJoYXNPbmVcIikge1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoaW5wdXQpKSB7XG4gICAgICAgIGNvbnN0IGxhc3RJbnB1dCA9IGlucHV0W2lucHV0Lmxlbmd0aCAtIDFdXG5cbiAgICAgICAgdGhpcy5wZW5kaW5nSW5wdXRzID0gdHlwZW9mIGxhc3RJbnB1dCA9PT0gXCJ1bmRlZmluZWRcIiA/IFtdIDogW2xhc3RJbnB1dF1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucGVuZGluZ0lucHV0cyA9IFtpbnB1dF1cbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGlucHV0KSkge1xuICAgICAgdGhpcy5wZW5kaW5nSW5wdXRzLnB1c2goLi4uaW5wdXQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucGVuZGluZ0lucHV0cy5wdXNoKGlucHV0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoaXMgYXR0YWNobWVudCBoYXMgcXVldWVkIGlucHV0cyBmb3IgdGhlIG5leHQgbW9kZWwgc2F2ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgYW55IHBlbmRpbmcgaW5wdXRzIGV4aXN0LlxuICAgKi9cbiAgaGFzUGVuZGluZ0F0dGFjaG1lbnRzKCkge1xuICAgIHJldHVybiB0aGlzLnBlbmRpbmdJbnB1dHMubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgc2F2ZSBwYXlsb2FkIGZvciBxdWV1ZWQgYXR0YWNobWVudCBpbnB1dHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdIHwgdW5kZWZpbmVkPn0gTm9ybWFsaXplZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBwZW5kaW5nQXR0YWNobWVudHNQYXlsb2FkKCkge1xuICAgIGlmICh0aGlzLnBlbmRpbmdJbnB1dHMubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKHRoaXMuYXR0YWNobWVudE5hbWUpXG5cbiAgICBpZiAoYXR0YWNobWVudERlZmluaXRpb24/LnR5cGUgPT09IFwiaGFzTWFueVwiKSB7XG4gICAgICByZXR1cm4gYXdhaXQgUHJvbWlzZS5hbGwodGhpcy5wZW5kaW5nSW5wdXRzLm1hcChhc3luYyAoaW5wdXQpID0+IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0KSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KHRoaXMucGVuZGluZ0lucHV0c1t0aGlzLnBlbmRpbmdJbnB1dHMubGVuZ3RoIC0gMV0pXG4gIH1cblxuICAvKiogQ2xlYXJzIHF1ZXVlZCBhdHRhY2htZW50IGlucHV0cyBhZnRlciBhIHN1Y2Nlc3NmdWwgbW9kZWwgc2F2ZS4gKi9cbiAgY2xlYXJQZW5kaW5nQXR0YWNobWVudHMoKSB7XG4gICAgdGhpcy5wZW5kaW5nSW5wdXRzID0gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gaW5wdXQgLSBBdHRhY2htZW50IGlucHV0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGF0dGFjaGVkLlxuICAgKi9cbiAgYXN5bmMgYXR0YWNoKGlucHV0KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWRJbnB1dCA9IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0KVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcImF0dGFjaFwiLCB7XG4gICAgICBhdHRhY2htZW50OiBub3JtYWxpemVkSW5wdXQsXG4gICAgICBhdHRhY2htZW50TmFtZTogdGhpcy5hdHRhY2htZW50TmFtZSxcbiAgICAgIGlkOiB0aGlzLm1vZGVsLnByaW1hcnlLZXlWYWx1ZSgpXG4gICAgfSlcblxuICAgIHRoaXMubW9kZWwuYXNzaWduQXR0cmlidXRlcyhNb2RlbENsYXNzLmF0dHJpYnV0ZXNGcm9tUmVzcG9uc2UocmVzcG9uc2UpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZG93bmxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXR0YWNobWVudElkXSAtIE9wdGlvbmFsIGF0dGFjaG1lbnQgaWQgZm9yIGhhcy1tYW55IGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZE1vZGVsQXR0YWNobWVudERvd25sb2FkIHwgbnVsbD59IC0gRG93bmxvYWRlZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBkb3dubG9hZChhdHRhY2htZW50SWQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiZG93bmxvYWRcIiwgZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb21tYW5kUGF5bG9hZCh0aGlzLCBhdHRhY2htZW50SWQpKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRQYXlsb2FkID0gcmVzcG9uc2UuYXR0YWNobWVudFxuXG4gICAgaWYgKCFhdHRhY2htZW50UGF5bG9hZCB8fCB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQgIT09IFwib2JqZWN0XCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBjb250ZW50QmFzZTY0ID0gdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRCYXNlNjQgPT09IFwic3RyaW5nXCIgPyBhdHRhY2htZW50UGF5bG9hZC5jb250ZW50QmFzZTY0IDogXCJcIlxuICAgIGNvbnN0IGNvbnRlbnQgPSBmcm9udGVuZEF0dGFjaG1lbnRCYXNlNjRUb0J5dGVzKGNvbnRlbnRCYXNlNjQpXG4gICAgY29uc3QgYnl0ZVNpemUgPSBOdW1iZXIoYXR0YWNobWVudFBheWxvYWQuYnl0ZVNpemUpXG5cbiAgICByZXR1cm4gbmV3IEZyb250ZW5kTW9kZWxBdHRhY2htZW50RG93bmxvYWQoe1xuICAgICAgYnl0ZVNpemU6IE51bWJlci5pc0Zpbml0ZShieXRlU2l6ZSkgPyBieXRlU2l6ZSA6IGNvbnRlbnQubGVuZ3RoLFxuICAgICAgY29udGVudCxcbiAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQuY29udGVudFR5cGUgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudFBheWxvYWQuY29udGVudFR5cGUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRUeXBlIDogbnVsbCxcbiAgICAgIGZpbGVuYW1lOiB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQuZmlsZW5hbWUgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudFBheWxvYWQuZmlsZW5hbWUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnRQYXlsb2FkLmZpbGVuYW1lIDogXCJhdHRhY2htZW50LmJpblwiLFxuICAgICAgaWQ6IHR5cGVvZiBhdHRhY2htZW50UGF5bG9hZC5pZCA9PT0gXCJzdHJpbmdcIiA/IGF0dGFjaG1lbnRQYXlsb2FkLmlkIDogXCJcIixcbiAgICAgIHVybDogdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLnVybCA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50UGF5bG9hZC51cmwubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnRQYXlsb2FkLnVybCA6IG51bGxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXJsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2F0dGFjaG1lbnRJZF0gLSBPcHRpb25hbCBhdHRhY2htZW50IGlkIGZvciBoYXMtbWFueSBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gUmVzb2x2YWJsZSBhdHRhY2htZW50IFVSTC5cbiAgICovXG4gIGFzeW5jIHVybChhdHRhY2htZW50SWQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwidXJsXCIsIGZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29tbWFuZFBheWxvYWQodGhpcywgYXR0YWNobWVudElkKSlcblxuICAgIGlmICh0eXBlb2YgcmVzcG9uc2UudXJsID09PSBcInN0cmluZ1wiICYmIHJlc3BvbnNlLnVybC5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gcmVzcG9uc2UudXJsXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBxdWVyeSBmb3IgdGhpcyBhdHRhY2htZW50IGhhbmRsZSdzIG1ldGFkYXRhIHJvd3MuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIFZlbG9jaW91c0F0dGFjaG1lbnQ+fSAtIEF0dGFjaG1lbnQgbWV0YWRhdGEgcXVlcnkuXG4gICAqL1xuICBxdWVyeSgpIHtcbiAgICBjb25zdCBhdHRhY2htZW50T3duZXIgPSBmcm9udGVuZE1vZGVsQXR0YWNobWVudE93bmVyKHRoaXMubW9kZWwpXG5cbiAgICByZXR1cm4gVmVsb2Npb3VzQXR0YWNobWVudFxuICAgICAgLndoZXJlKHtcbiAgICAgICAgbmFtZTogdGhpcy5hdHRhY2htZW50TmFtZSxcbiAgICAgICAgcmVjb3JkSWQ6IGF0dGFjaG1lbnRPd25lci5yZWNvcmRJZCxcbiAgICAgICAgcmVjb3JkVHlwZTogYXR0YWNobWVudE93bmVyLnJlY29yZFR5cGUsXG4gICAgICAgIHJlc291cmNlTmFtZTogYXR0YWNobWVudE93bmVyLnJlc291cmNlTmFtZVxuICAgICAgfSlcbiAgICAgIC5vcmRlcihbW1wicG9zaXRpb25cIiwgXCJhc2NcIl1dKVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGFsbCBhdHRhY2htZW50IG1ldGFkYXRhIHJvd3MgZm9yIHRoaXMgaGFuZGxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxWZWxvY2lvdXNBdHRhY2htZW50W10+fSAtIEF0dGFjaG1lbnQgbWV0YWRhdGEgcm93cy5cbiAgICovXG4gIGFzeW5jIHRvQXJyYXkoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS50b0FycmF5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgZmlyc3QgYXR0YWNobWVudCBtZXRhZGF0YSByb3cgZm9yIHRoaXMgaGFuZGxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxWZWxvY2lvdXNBdHRhY2htZW50IHwgbnVsbD59IC0gRmlyc3QgYXR0YWNobWVudCBtZXRhZGF0YSByb3cuXG4gICAqL1xuICBhc3luYyBmaXJzdCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpcnN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxpc3QuIFJldHVybnMgbWV0YWRhdGEgZm9yIGV2ZXJ5IGF0dGFjaG1lbnQgdW5kZXIgdGhpcyBhdHRhY2htZW50IG5hbWVcbiAgICogKG5vIGNvbnRlbnQgYnl0ZXMpLCBzbyBjYWxsZXJzIGNhbiBlbnVtZXJhdGUgaGFzLW1hbnkgYXR0YWNobWVudHMgYW5kIHRoZW5cbiAgICogZG93bmxvYWQgb3IgbGluayB0byBlYWNoIG9uZSBieSBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8e2J5dGVTaXplOiBudW1iZXIsIGNvbnRlbnRUeXBlOiBzdHJpbmcgfCBudWxsLCBmaWxlbmFtZTogc3RyaW5nLCBpZDogc3RyaW5nLCB1cmw6IHN0cmluZyB8IG51bGx9Pj59IC0gQXR0YWNobWVudCBtZXRhZGF0YSBlbnRyaWVzLlxuICAgKi9cbiAgYXN5bmMgbGlzdCgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiYXR0YWNobWVudExpc3RcIiwgZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb21tYW5kUGF5bG9hZCh0aGlzKSlcbiAgICBjb25zdCBhdHRhY2htZW50cyA9IEFycmF5LmlzQXJyYXkocmVzcG9uc2UuYXR0YWNobWVudHMpID8gcmVzcG9uc2UuYXR0YWNobWVudHMgOiBbXVxuXG4gICAgcmV0dXJuIGF0dGFjaG1lbnRzLm1hcCgoYXR0YWNobWVudCkgPT4ge1xuICAgICAgY29uc3QgYnl0ZVNpemUgPSBOdW1iZXIoYXR0YWNobWVudC5ieXRlU2l6ZSlcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYnl0ZVNpemU6IE51bWJlci5pc0Zpbml0ZShieXRlU2l6ZSkgPyBieXRlU2l6ZSA6IDAsXG4gICAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgYXR0YWNobWVudC5jb250ZW50VHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50LmNvbnRlbnRUeXBlLmxlbmd0aCA+IDAgPyBhdHRhY2htZW50LmNvbnRlbnRUeXBlIDogbnVsbCxcbiAgICAgICAgZmlsZW5hbWU6IHR5cGVvZiBhdHRhY2htZW50LmZpbGVuYW1lID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnQuZmlsZW5hbWUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnQuZmlsZW5hbWUgOiBcImF0dGFjaG1lbnQuYmluXCIsXG4gICAgICAgIGlkOiB0eXBlb2YgYXR0YWNobWVudC5pZCA9PT0gXCJzdHJpbmdcIiA/IGF0dGFjaG1lbnQuaWQgOiBcIlwiLFxuICAgICAgICB1cmw6IHR5cGVvZiBhdHRhY2htZW50LnVybCA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50LnVybC5sZW5ndGggPiAwID8gYXR0YWNobWVudC51cmwgOiBudWxsXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRvd25sb2FkIHVybC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEb3dubG9hZCBVUkwgZm9yIHRoaXMgYXR0YWNobWVudCBvbiB0aGUgY29uZmlndXJlZCBiYWNrZW5kLlxuICAgKi9cbiAgZG93bmxvYWRVcmwoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IGNvbW1hbmROYW1lID0gTW9kZWxDbGFzcy5jb21tYW5kTmFtZShcImRvd25sb2FkXCIpXG4gICAgY29uc3QgcmVzb3VyY2VQYXRoID0gTW9kZWxDbGFzcy5yZXNvdXJjZVBhdGgoKVxuICAgIGNvbnN0IGNvbW1hbmRVcmwgPSBmcm9udGVuZE1vZGVsQ29tbWFuZFVybChyZXNvdXJjZVBhdGgsIGNvbW1hbmROYW1lKVxuICAgIGNvbnN0IHBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xuICAgICAgYXR0YWNobWVudE5hbWU6IHRoaXMuYXR0YWNobWVudE5hbWUsXG4gICAgICBpZDogbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIHRoaXMubW9kZWwucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgfSlcblxuICAgIHJldHVybiBgJHtjb21tYW5kVXJsfT8ke3BhcmFtcy50b1N0cmluZygpfWBcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB1cmwuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZCB8IG51bGx9IHZhbHVlIC0gVVJMIGNhbmRpZGF0ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9ybWFsaXplZCBVUkwgd2l0aG91dCB0cmFpbGluZyBzbGFzaC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybCh2YWx1ZSkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiKSByZXR1cm4gXCJcIlxuXG4gIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKClcblxuICBpZiAoIXRyaW1tZWQubGVuZ3RoKSByZXR1cm4gXCJcIlxuXG4gIHJldHVybiB0cmltbWVkLnJlcGxhY2UoL1xcLyskLywgXCJcIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB1cmwuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlc29sdmVkIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCBVUkwuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRVcmwoKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRVcmwgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy51cmwgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy51cmwoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy51cmxcblxuICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybChjb25maWd1cmVkVXJsKVxufVxuXG4vKipcbiAqIFJ1bnMgY2xvbmUgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlcy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB2YWx1ZSAtIEF0dHJpYnV0ZXMgaGFzaC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2xvbmVkIGF0dHJpYnV0ZXMgaGFzaC5cbiAqL1xuZnVuY3Rpb24gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyh2YWx1ZSkge1xuICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUodmFsdWUpKSlcbn1cblxuLyoqXG4gKiBTaGFyZWQgY2hhbm5lbCBuYW1lIGZvciBtb2RlbCBsaWZlY3ljbGUgZXZlbnRzIChQaGFzZSAzKS5cbiAqIE1hdGNoZXMgdGhlIGJhY2tlbmQgYEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUVgLlxuICovXG5jb25zdCBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FID0gXCJmcm9udGVuZC1tb2RlbHNcIlxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgZnJvbnRlbmQgbW9kZWwgZXZlbnQgcHJlbG9hZC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSB0YXJnZXQgLSBUYXJnZXQgcHJlbG9hZCBwYXlsb2FkLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IHNvdXJjZSAtIFNvdXJjZSBwcmVsb2FkIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRQcmVsb2FkKHRhcmdldCwgc291cmNlKSB7XG4gIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2UpKSB7XG4gICAgY29uc3QgZXhpc3RpbmdWYWx1ZSA9IHRhcmdldFtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgaWYgKHZhbHVlID09PSB0cnVlIHx8IHZhbHVlID09PSBmYWxzZSkge1xuICAgICAgaWYgKGV4aXN0aW5nVmFsdWUgPT09IHVuZGVmaW5lZCkgdGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdID0gdmFsdWVcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRhcmdldFtyZWxhdGlvbnNoaXBOYW1lXSA9IHZhbHVlXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICghZXhpc3RpbmdWYWx1ZSB8fCB0eXBlb2YgZXhpc3RpbmdWYWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGV4aXN0aW5nVmFsdWUpKSB7XG4gICAgICB0YXJnZXRbcmVsYXRpb25zaGlwTmFtZV0gPSB7fVxuICAgIH1cblxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50UHJlbG9hZChcbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAodGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdKSxcbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAodmFsdWUpXG4gICAgKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBtZXJnZSBmcm9udGVuZCBtb2RlbCBldmVudCBzZWxlY3QuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gdGFyZ2V0IC0gVGFyZ2V0IHNlbGVjdCBtYXAuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gc291cmNlIC0gU291cmNlIHNlbGVjdCBtYXAuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRTZWxlY3QodGFyZ2V0LCBzb3VyY2UpIHtcbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCBhdHRyaWJ1dGVzXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2UpKSB7XG4gICAgY29uc3QgZXhpc3RpbmdBdHRyaWJ1dGVzID0gdGFyZ2V0W21vZGVsTmFtZV0gfHwgW11cblxuICAgIHRhcmdldFttb2RlbE5hbWVdID0gQXJyYXkuZnJvbShuZXcgU2V0KGV4aXN0aW5nQXR0cmlidXRlcy5jb25jYXQoYXR0cmlidXRlcykpKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBtZXJnZSB1bmlxdWUgZnJvbnRlbmQgbW9kZWwgZXZlbnQgZW50cmllcy5cbiAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsV2l0aENvdW50UGF5bG9hZEVudHJ5IHwgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsQWJpbGl0aWVzUGF5bG9hZEVudHJ5Pn0gdGFyZ2V0IC0gVGFyZ2V0IGFycmF5LlxuICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxXaXRoQ291bnRQYXlsb2FkRW50cnkgfCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxBYmlsaXRpZXNQYXlsb2FkRW50cnk+fSBzb3VyY2UgLSBTb3VyY2UgYXJyYXkuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VVbmlxdWVGcm9udGVuZE1vZGVsRXZlbnRFbnRyaWVzKHRhcmdldCwgc291cmNlKSB7XG4gIGNvbnN0IGV4aXN0aW5nS2V5cyA9IG5ldyBTZXQodGFyZ2V0Lm1hcCgoZW50cnkpID0+IEpTT04uc3RyaW5naWZ5KGVudHJ5KSkpXG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBzb3VyY2UpIHtcbiAgICBjb25zdCBrZXkgPSBKU09OLnN0cmluZ2lmeShlbnRyeSlcblxuICAgIGlmIChleGlzdGluZ0tleXMuaGFzKGtleSkpIGNvbnRpbnVlXG5cbiAgICB0YXJnZXQucHVzaChlbnRyeSlcbiAgICBleGlzdGluZ0tleXMuYWRkKGtleSlcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgZnJvbnRlbmQgbW9kZWwgZXZlbnQgcHJvamVjdGlvbiBwYXlsb2FkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH0gdGFyZ2V0IC0gVGFyZ2V0IHBheWxvYWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfSBzb3VyY2UgLSBTb3VyY2UgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByb2plY3Rpb25QYXlsb2FkKHRhcmdldCwgc291cmNlKSB7XG4gIGlmIChzb3VyY2UucHJlbG9hZCkge1xuICAgIGlmICghdGFyZ2V0LnByZWxvYWQpIHRhcmdldC5wcmVsb2FkID0ge31cbiAgICBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByZWxvYWQodGFyZ2V0LnByZWxvYWQsIHNvdXJjZS5wcmVsb2FkKVxuICB9XG5cbiAgaWYgKHNvdXJjZS5zZWxlY3QpIHtcbiAgICBpZiAoIXRhcmdldC5zZWxlY3QpIHRhcmdldC5zZWxlY3QgPSB7fVxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50U2VsZWN0KHRhcmdldC5zZWxlY3QsIHNvdXJjZS5zZWxlY3QpXG4gIH1cblxuICBpZiAoc291cmNlLnNlbGVjdHNFeHRyYSkge1xuICAgIGlmICghdGFyZ2V0LnNlbGVjdHNFeHRyYSkgdGFyZ2V0LnNlbGVjdHNFeHRyYSA9IHt9XG4gICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRTZWxlY3QodGFyZ2V0LnNlbGVjdHNFeHRyYSwgc291cmNlLnNlbGVjdHNFeHRyYSlcbiAgfVxuXG4gIGlmIChzb3VyY2Uud2l0aENvdW50KSB7XG4gICAgaWYgKCF0YXJnZXQud2l0aENvdW50KSB0YXJnZXQud2l0aENvdW50ID0gW11cbiAgICBtZXJnZVVuaXF1ZUZyb250ZW5kTW9kZWxFdmVudEVudHJpZXModGFyZ2V0LndpdGhDb3VudCwgc291cmNlLndpdGhDb3VudClcbiAgfVxuXG4gIGlmIChzb3VyY2UuYWJpbGl0aWVzKSB7XG4gICAgaWYgKCF0YXJnZXQuYWJpbGl0aWVzKSB0YXJnZXQuYWJpbGl0aWVzID0gW11cbiAgICBtZXJnZVVuaXF1ZUZyb250ZW5kTW9kZWxFdmVudEVudHJpZXModGFyZ2V0LmFiaWxpdGllcywgc291cmNlLmFiaWxpdGllcylcbiAgfVxuXG4gIGlmIChzb3VyY2UucXVlcnlEYXRhICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCB0YXJnZXRRdWVyeURhdGEgPSBBcnJheS5pc0FycmF5KHRhcmdldC5xdWVyeURhdGEpID8gdGFyZ2V0LnF1ZXJ5RGF0YSA6IFtdXG5cbiAgICB0YXJnZXQucXVlcnlEYXRhID0gdGFyZ2V0UXVlcnlEYXRhXG4gICAgY29uc3QgcXVlcnlEYXRhRW50cmllcyA9IEFycmF5LmlzQXJyYXkoc291cmNlLnF1ZXJ5RGF0YSkgPyBzb3VyY2UucXVlcnlEYXRhIDogW3NvdXJjZS5xdWVyeURhdGFdXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHF1ZXJ5RGF0YUVudHJpZXMpIHtcbiAgICAgIHRhcmdldFF1ZXJ5RGF0YS5wdXNoKGVudHJ5KVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgbWF0Y2hlZCBldmVudCBmaWx0ZXIga2V5cy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBSYXcgd2Vic29ja2V0IGV2ZW50IGJvZHkuXG4gKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gTWF0Y2hlZCBldmVudCBmaWx0ZXIga2V5cyBkZWxpdmVyZWQgYnkgdGhlIGJhY2tlbmQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxNYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKGJvZHkpIHtcbiAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSBcIm9iamVjdFwiKSByZXR1cm4gbmV3IFNldCgpXG5cbiAgY29uc3Qga2V5cyA9IC8qKiBAdHlwZSB7e21hdGNoZWRFdmVudEZpbHRlcktleXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovIChib2R5KS5tYXRjaGVkRXZlbnRGaWx0ZXJLZXlzXG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KGtleXMpKSByZXR1cm4gbmV3IFNldCgpXG5cbiAgcmV0dXJuIG5ldyBTZXQoa2V5cy5tYXAoKGtleSkgPT4gU3RyaW5nKGtleSkpKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgZXZlbnQgZW50cnkgbWF0Y2hlcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5fSBlbnRyeSAtIENhbGxiYWNrIGVudHJ5LlxuICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyAtIEJhY2tlbmQgbWF0Y2hlZCBmaWx0ZXIga2V5cy5cbiAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSBjYWxsYmFjayBzaG91bGQgcmVjZWl2ZSB0aGUgZXZlbnQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxFdmVudEVudHJ5TWF0Y2hlcyhlbnRyeSwgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cykge1xuICBpZiAoIWVudHJ5LmV2ZW50RmlsdGVyS2V5KSByZXR1cm4gdHJ1ZVxuXG4gIHJldHVybiBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzLmhhcyhlbnRyeS5ldmVudEZpbHRlcktleSlcbn1cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBubyBkZXN0cm95IGV2ZW50IGZpbHRlci5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gRXZlbnQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gb3B0aW9ucyAtIEV2ZW50IG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0Tm9EZXN0cm95RXZlbnRGaWx0ZXIoTW9kZWxDbGFzcywgb3B0aW9ucykge1xuICBjb25zdCBldmVudE9wdGlvbnNQYXlsb2FkID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQoTW9kZWxDbGFzcywgb3B0aW9ucylcblxuICBpZiAoIWV2ZW50T3B0aW9uc1BheWxvYWQuZXZlbnRGaWx0ZXJLZXkpIHJldHVyblxuXG4gIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIGRlc3Ryb3kgZXZlbnQgc3Vic2NyaXB0aW9ucyBkbyBub3Qgc3VwcG9ydCBxdWVyeSBmaWx0ZXJzXCIpXG59XG5cbi8qKlxuICogUGVyLW1vZGVsIGNsYXNzIHNpbmdsZXRvbiB0aGF0IG11bHRpcGxleGVzIGFsbCByZWdpc3RlcmVkIG9uQ3JlYXRlIC9cbiAqIG9uVXBkYXRlIC8gb25EZXN0cm95IGNhbGxiYWNrcyDigJQgY2xhc3MtbGV2ZWwgKyBpbnN0YW5jZS1sZXZlbCDigJRcbiAqIG92ZXIgb25lIFdlYnNvY2tldENoYW5uZWxWMiBzdWJzY3JpcHRpb24uIFN1YnNjcmlwdGlvbiBvcGVucyBvbiB0aGVcbiAqIGZpcnN0IGxpc3RlbmVyIGFuZCBjbG9zZXMgd2hlbiB0aGUgbGFzdCBvbmUgdW5zdWJzY3JpYmVzLlxuICpcbiAqIEluc3RhbmNlLWxldmVsIGxpc3RlbmVycyBhbHNvIHJlY2VpdmUgYXV0by1tZXJnZTogd2hlbiBhbiBgdXBkYXRlYFxuICogZXZlbnQgYXJyaXZlcyBmb3IgYSByZWdpc3RlcmVkIGluc3RhbmNlIGlkLCB0aGUgaW5zdGFuY2Unc1xuICogYXR0cmlidXRlcyBhcmUgdXBkYXRlZCBpbiBwbGFjZSBiZWZvcmUgdGhlIGNhbGxiYWNrIGZpcmVzLCBzb1xuICogY2FsbGVycyBjYW4gcmVhZCBmcmVzaCB2YWx1ZXMgZnJvbSB0aGUgc2FtZSBpbnN0YW5jZSBoYW5kbGUuXG4gKi9cbmNsYXNzIEZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbiB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzIGZvciB0aGlzIHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dH0gcmVxdWVzdENvbnRleHQgLSBDYXB0dXJlZCBzdWJzY3JpcHRpb24gY29udGV4dC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKE1vZGVsQ2xhc3MsIHJlcXVlc3RDb250ZXh0KSB7XG4gICAgdGhpcy5Nb2RlbENsYXNzID0gTW9kZWxDbGFzc1xuICAgIHRoaXMucmVxdWVzdENvbnRleHQgPSByZXF1ZXN0Q29udGV4dFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeT59ICovXG4gICAgdGhpcy5jbGFzc0NyZWF0ZUNhbGxiYWNrcyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeT59ICovXG4gICAgdGhpcy5jbGFzc1VwZGF0ZUNhbGxiYWNrcyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5Pn0gKi9cbiAgICB0aGlzLmNsYXNzRGVzdHJveUNhbGxiYWNrcyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywge2luc3RhbmNlOiBGcm9udGVuZE1vZGVsQmFzZSwgdXBkYXRlQ2FsbGJhY2tzOiBTZXQ8RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5PiwgZGVzdHJveUNhbGxiYWNrczogU2V0PEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5Pn0+fSAqL1xuICAgIHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IG51bGxcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMucmVhZHlQcm9taXNlID0gbnVsbFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7c3RyaW5nIHwgbnVsbH0gKi9cbiAgICB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1YnNjcmlwdGlvbiBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHt7bW9kZWw6IHN0cmluZywgZGVzdHJveUV2ZW50RGVsaXZlcnk/OiBib29sZWFuLCBldmVudEZpbHRlcnM/OiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeVtdLCB1bmZpbHRlcmVkRXZlbnREZWxpdmVyeT86IGJvb2xlYW59ICYgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9IC0gQ3VycmVudCB3ZWJzb2NrZXQgc3Vic2NyaXB0aW9uIHBhcmFtcy5cbiAgICovXG4gIHN1YnNjcmlwdGlvblBhcmFtcygpIHtcbiAgICAvKipcbiAgICAgKiBQcm9qZWN0aW9uIHBheWxvYWQuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfSAqL1xuICAgIGNvbnN0IHByb2plY3Rpb25QYXlsb2FkID0ge31cbiAgICAvKipcbiAgICAgKiBFdmVudCBmaWx0ZXJzIGJ5IGtleS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnk+fSAqL1xuICAgIGNvbnN0IGV2ZW50RmlsdGVyc0J5S2V5ID0ge31cbiAgICBjb25zdCBwcm9qZWN0aW9uRW50cmllcyA9IFtdXG4gICAgbGV0IGhhc0Rlc3Ryb3lFdmVudERlbGl2ZXJ5ID0gdGhpcy5jbGFzc0Rlc3Ryb3lDYWxsYmFja3Muc2l6ZSA+IDBcbiAgICBsZXQgaGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLmNsYXNzQ3JlYXRlQ2FsbGJhY2tzKSBwcm9qZWN0aW9uRW50cmllcy5wdXNoKGVudHJ5KVxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgdGhpcy5jbGFzc1VwZGF0ZUNhbGxiYWNrcykgcHJvamVjdGlvbkVudHJpZXMucHVzaChlbnRyeSlcblxuICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgdGhpcy5pbnN0YW5jZUxpc3RlbmVycy52YWx1ZXMoKSkge1xuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBsaXN0ZW5lci51cGRhdGVDYWxsYmFja3MpIHByb2plY3Rpb25FbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICBpZiAobGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcy5zaXplID4gMCkgaGFzRGVzdHJveUV2ZW50RGVsaXZlcnkgPSB0cnVlXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBwcm9qZWN0aW9uRW50cmllcykge1xuICAgICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRQcm9qZWN0aW9uUGF5bG9hZChwcm9qZWN0aW9uUGF5bG9hZCwgZW50cnkucHJvamVjdGlvblBheWxvYWQpXG5cbiAgICAgIGlmIChlbnRyeS5ldmVudEZpbHRlcktleSAmJiBlbnRyeS5ldmVudEZpbHRlclBheWxvYWQpIHtcbiAgICAgICAgZXZlbnRGaWx0ZXJzQnlLZXlbZW50cnkuZXZlbnRGaWx0ZXJLZXldID0ge1xuICAgICAgICAgIC4uLmVudHJ5LmV2ZW50RmlsdGVyUGF5bG9hZCxcbiAgICAgICAgICBrZXk6IGVudHJ5LmV2ZW50RmlsdGVyS2V5XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGhhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5ID0gdHJ1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGV2ZW50RmlsdGVycyA9IE9iamVjdC52YWx1ZXMoZXZlbnRGaWx0ZXJzQnlLZXkpXG4gICAgY29uc3QgZXZlbnRGaWx0ZXJQYXJhbXMgPSBldmVudEZpbHRlcnMubGVuZ3RoID4gMFxuICAgICAgPyB7XG4gICAgICAgICAgZXZlbnRGaWx0ZXJzLFxuICAgICAgICAgIC4uLihoYXNEZXN0cm95RXZlbnREZWxpdmVyeSA/IHtkZXN0cm95RXZlbnREZWxpdmVyeTogdHJ1ZX0gOiB7fSksXG4gICAgICAgICAgLi4uKGhhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5ID8ge3VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5OiB0cnVlfSA6IHt9KVxuICAgICAgICB9XG4gICAgICA6IHt9XG5cbiAgICByZXR1cm4gbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQoXG4gICAgICB0aGlzLnJlcXVlc3RDb250ZXh0LFxuICAgICAge1xuICAgICAgICBtb2RlbDogdGhpcy5Nb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICAuLi5ldmVudEZpbHRlclBhcmFtcyxcbiAgICAgICAgLi4ucHJvamVjdGlvblBheWxvYWRcbiAgICAgIH1cbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdWJzY3JpcHRpb24gcGFyYW1zIGpzb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RhYmxlIGtleSBmb3IgY3VycmVudCBzdWJzY3JpcHRpb24gcGFyYW1zLlxuICAgKi9cbiAgc3Vic2NyaXB0aW9uUGFyYW1zSnNvbigpIHtcbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodGhpcy5zdWJzY3JpcHRpb25QYXJhbXMoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyIGNsYXNzIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeSB8IEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5fSBUXG4gICAqIEBwYXJhbSB7U2V0PFQ+fSBjYWxsYmFja3MgLSBDYWxsYmFjayBzZXQgZm9yIHRoZSBldmVudCB0eXBlLlxuICAgKiBAcGFyYW0ge1R9IGVudHJ5IC0gQ2FsbGJhY2sgZW50cnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgcmVnaXN0ZXJDbGFzc0NhbGxiYWNrKGNhbGxiYWNrcywgZW50cnkpIHtcbiAgICBjYWxsYmFja3MuYWRkKGVudHJ5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlU3Vic2NyaWJlZCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNhbGxiYWNrcy5kZWxldGUoZW50cnkpXG4gICAgICB0aGlzLm1heWJlVGVhcmRvd24oKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgY2FsbGJhY2tzLmRlbGV0ZShlbnRyeSlcbiAgICAgIHRoaXMubWF5YmVUZWFyZG93bigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIHN1YnNjcmliZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAqL1xuICBhc3luYyBlbnN1cmVTdWJzY3JpYmVkKCkge1xuICAgIGNvbnN0IHBhcmFtc0pzb24gPSB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0pzb24oKVxuXG4gICAgaWYgKHRoaXMuY2hhbm5lbEhhbmRsZSAmJiAhdGhpcy5jaGFubmVsSGFuZGxlLmlzQ2xvc2VkKCkpIHtcbiAgICAgIGlmICh0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSAhPT0gcGFyYW1zSnNvbikge1xuICAgICAgICB0aGlzLmNoYW5uZWxIYW5kbGUuY2xvc2UoKVxuICAgICAgICB0aGlzLmNoYW5uZWxIYW5kbGUgPSBudWxsXG4gICAgICAgIHRoaXMucmVhZHlQcm9taXNlID0gbnVsbFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHRoaXMucmVhZHlQcm9taXNlKSBhd2FpdCB0aGlzLnJlYWR5UHJvbWlzZVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTZXJpYWxpemUgcGFyYWxsZWwgY2FsbHMgKGUuZy4gUHJvbWlzZS5hbGwoW29uQ3JlYXRlLCBvblVwZGF0ZSxcbiAgICAvLyBvbkRlc3Ryb3ldKSkgc28gd2Ugb3BlbiBleGFjdGx5IG9uZSBzdWJzY3JpcHRpb24gcGVyIG1vZGVsIGNsYXNzXG4gICAgLy8gaW5zdGVhZCBvZiByYWNpbmcgdGhyZWUgY29uY3VycmVudCBzdWJzY3JpYmVDaGFubmVsIGNhbGxzLlxuICAgIGlmICh0aGlzLnJlYWR5UHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5yZWFkeVByb21pc2VcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgIGlmICghY2xpZW50IHx8IHR5cGVvZiBjbGllbnQuc3Vic2NyaWJlQ2hhbm5lbCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudCBzdWJzY3JpcHRpb25zIHJlcXVpcmUgY29uZmlndXJlVHJhbnNwb3J0KHt3ZWJzb2NrZXRVcmx9KSBvciBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldENsaWVudH0pXCIpXG4gICAgfVxuXG4gICAgdGhpcy5yZWFkeVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHR5cGVvZiBjbGllbnQuY29ubmVjdCA9PT0gXCJmdW5jdGlvblwiKSBhd2FpdCBjbGllbnQuY29ubmVjdCgpXG5cbiAgICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zKClcblxuICAgICAgdGhpcy5zdWJzY3JpcHRpb25QYXJhbXNLZXkgPSBKU09OLnN0cmluZ2lmeShwYXJhbXMpXG4gICAgICB0aGlzLmNoYW5uZWxIYW5kbGUgPSBjbGllbnQuc3Vic2NyaWJlQ2hhbm5lbChGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FLCB7XG4gICAgICAgIHBhcmFtcyxcbiAgICAgICAgb25NZXNzYWdlOiAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gYm9keSkgPT4gdGhpcy5fZGlzcGF0Y2hFdmVudChib2R5KSxcbiAgICAgICAgb25DbG9zZTogKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IG51bGxcbiAgICAgICAgICB0aGlzLnJlYWR5UHJvbWlzZSA9IG51bGxcbiAgICAgICAgICB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSA9IG51bGxcbiAgICAgICAgICB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLmNsZWFyKClcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIGF3YWl0IHRoaXMuY2hhbm5lbEhhbmRsZS5yZWFkeVxuICAgIH0pKClcblxuICAgIGF3YWl0IHRoaXMucmVhZHlQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXNwYXRjaCBldmVudC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keSAtIFdlYlNvY2tldCBldmVudCBwYXlsb2FkLlxuICAgKi9cbiAgX2Rpc3BhdGNoRXZlbnQoYm9keSkge1xuICAgIGlmICghYm9keSB8fCB0eXBlb2YgYm9keSAhPT0gXCJvYmplY3RcIikgcmV0dXJuXG5cbiAgICBjb25zdCBhY3Rpb24gPSBib2R5LmFjdGlvblxuICAgIGNvbnN0IHJhd0lkID0gYm9keS5pZFxuXG4gICAgaWYgKGFjdGlvbiAhPT0gXCJjcmVhdGVcIiAmJiBhY3Rpb24gIT09IFwidXBkYXRlXCIgJiYgYWN0aW9uICE9PSBcImRlc3Ryb3lcIikgcmV0dXJuXG4gICAgaWYgKHJhd0lkID09PSB1bmRlZmluZWQgfHwgcmF3SWQgPT09IG51bGwpIHJldHVyblxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBpZGVudGl0eSA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSlcbiAgICAgID8gbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhwcmltYXJ5S2V5LCByYXdJZClcbiAgICAgIDogU3RyaW5nKHJhd0lkKVxuICAgIGNvbnN0IGlkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgaWRlbnRpdHkpXG4gICAgY29uc3QgcmF3UHJldmlvdXNJZCA9IGJvZHkucHJldmlvdXNJZFxuICAgIGNvbnN0IHByZXZpb3VzSWRlbnRpdHkgPSByYXdQcmV2aW91c0lkID09PSB1bmRlZmluZWQgfHwgcmF3UHJldmlvdXNJZCA9PT0gbnVsbFxuICAgICAgPyBudWxsXG4gICAgICA6IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSlcbiAgICAgICAgPyBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIHJhd1ByZXZpb3VzSWQpXG4gICAgICAgIDogU3RyaW5nKHJhd1ByZXZpb3VzSWQpXG4gICAgY29uc3QgcHJldmlvdXNJZCA9IHByZXZpb3VzSWRlbnRpdHkgPT09IG51bGxcbiAgICAgID8gbnVsbFxuICAgICAgOiBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkZW50aXR5KVxuICAgIGNvbnN0IG1hdGNoZWRFdmVudEZpbHRlcktleXMgPSBmcm9udGVuZE1vZGVsTWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyhib2R5KVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJkZXN0cm95XCIpIHtcbiAgICAgIGNvbnN0IGxpc3RlbmVyID0gdGhpcy5pbnN0YW5jZUxpc3RlbmVycy5nZXQoaWQpXG5cbiAgICAgIGlmIChsaXN0ZW5lcikge1xuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxpc3RlbmVyLmRlc3Ryb3lDYWxsYmFja3MpIHtcbiAgICAgICAgICB0cnkgeyBlbnRyeS5jYWxsYmFjayh7aWQ6IGlkZW50aXR5fSkgfSBjYXRjaCAoZXJyb3IpIHsgY29uc29sZS5lcnJvcihlcnJvcikgfVxuICAgICAgICB9XG4gICAgICAgIGRlbGV0ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyKHRoaXMsIGxpc3RlbmVyKVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLmNsYXNzRGVzdHJveUNhbGxiYWNrcykge1xuICAgICAgICB0cnkgeyBlbnRyeS5jYWxsYmFjayh7aWQ6IGlkZW50aXR5fSkgfSBjYXRjaCAoZXJyb3IpIHsgY29uc29sZS5lcnJvcihlcnJvcikgfVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgbGlzdGVuZXIgPSB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLmdldChpZCkgfHwgKHByZXZpb3VzSWQgPT09IG51bGwgPyB1bmRlZmluZWQgOiB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLmdldChwcmV2aW91c0lkKSlcblxuICAgIGlmIChhY3Rpb24gPT09IFwidXBkYXRlXCIgJiYgbGlzdGVuZXIgJiYgcHJldmlvdXNJZGVudGl0eSAhPT0gbnVsbCkge1xuICAgICAgcmVrZXlGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcnModGhpcy5Nb2RlbENsYXNzLCBsaXN0ZW5lci5pbnN0YW5jZSwgcHJldmlvdXNJZGVudGl0eSwgaWRlbnRpdHkpXG4gICAgfVxuXG4gICAgaWYgKCFib2R5LnJlY29yZCB8fCB0eXBlb2YgYm9keS5yZWNvcmQgIT09IFwib2JqZWN0XCIpIHJldHVyblxuXG4gICAgY29uc3QgZGVzZXJpYWxpemVkUmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShib2R5LnJlY29yZCkpXG4gICAgY29uc3QgZnJlc2hNb2RlbCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzLk1vZGVsQ2xhc3MpLmluc3RhbnRpYXRlRnJvbVJlc3BvbnNlKGRlc2VyaWFsaXplZFJlY29yZClcblxuICAgIGlmIChhY3Rpb24gPT09IFwidXBkYXRlXCIgJiYgbGlzdGVuZXIpIHtcbiAgICAgIGNvbnN0IG1hdGNoaW5nVXBkYXRlQ2FsbGJhY2tzID0gQXJyYXkuZnJvbShsaXN0ZW5lci51cGRhdGVDYWxsYmFja3MpLmZpbHRlcigoZW50cnkpID0+XG4gICAgICAgIGZyb250ZW5kTW9kZWxFdmVudEVudHJ5TWF0Y2hlcyhlbnRyeSwgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cylcbiAgICAgIClcblxuICAgICAgaWYgKG1hdGNoaW5nVXBkYXRlQ2FsbGJhY2tzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgLy8gQXV0by1tZXJnZSBpbnRvIHRoZSByZWdpc3RlcmVkIGluc3RhbmNlIHNvIGNhbGxlcnMgcmVhZGluZ1xuICAgICAgICAvLyB0aHJvdWdoIHRoZSBzYW1lIGhhbmRsZSBzZWUgZnJlc2ggYXR0cmlidXRlcy5cbiAgICAgICAgY29uc3QgaW5zdGFuY2VBbnkgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobGlzdGVuZXIuaW5zdGFuY2UpXG5cbiAgICAgICAgaW5zdGFuY2VBbnkuYXNzaWduQXR0cmlidXRlcyhmcmVzaE1vZGVsLmF0dHJpYnV0ZXMoKSlcbiAgICAgICAgaW5zdGFuY2VBbnkuX2F0dGFjaG1lbnRPd25lciA9IGZyZXNoTW9kZWwuX2F0dGFjaG1lbnRPd25lclxuICAgICAgICBpbnN0YW5jZUFueS5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMobGlzdGVuZXIuaW5zdGFuY2UuYXR0cmlidXRlcygpKVxuXG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbWF0Y2hpbmdVcGRhdGVDYWxsYmFja3MpIHtcbiAgICAgICAgICB0cnkgeyBlbnRyeS5jYWxsYmFjayh7aWQ6IGlkZW50aXR5LCBtb2RlbDogbGlzdGVuZXIuaW5zdGFuY2V9KSB9IGNhdGNoIChlcnJvcikgeyBjb25zb2xlLmVycm9yKGVycm9yKSB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjbGFzc0NhbGxiYWNrcyA9IGFjdGlvbiA9PT0gXCJjcmVhdGVcIiA/IHRoaXMuY2xhc3NDcmVhdGVDYWxsYmFja3MgOiB0aGlzLmNsYXNzVXBkYXRlQ2FsbGJhY2tzXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNsYXNzQ2FsbGJhY2tzKSB7XG4gICAgICBpZiAoIWZyb250ZW5kTW9kZWxFdmVudEVudHJ5TWF0Y2hlcyhlbnRyeSwgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cykpIGNvbnRpbnVlXG5cbiAgICAgIHRyeSB7IGVudHJ5LmNhbGxiYWNrKHtpZDogaWRlbnRpdHksIG1vZGVsOiBmcmVzaE1vZGVsfSkgfSBjYXRjaCAoZXJyb3IpIHsgY29uc29sZS5lcnJvcihlcnJvcikgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1heWJlIHRlYXJkb3duLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gKi9cbiAgbWF5YmVUZWFyZG93bigpIHtcbiAgICBjb25zdCBoYXNBbnlMaXN0ZW5lciA9IHRoaXMuY2xhc3NDcmVhdGVDYWxsYmFja3Muc2l6ZSA+IDBcbiAgICAgIHx8IHRoaXMuY2xhc3NVcGRhdGVDYWxsYmFja3Muc2l6ZSA+IDBcbiAgICAgIHx8IHRoaXMuY2xhc3NEZXN0cm95Q2FsbGJhY2tzLnNpemUgPiAwXG4gICAgICB8fCB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLnNpemUgPiAwXG5cbiAgICBpZiAoaGFzQW55TGlzdGVuZXIpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuY2hhbm5lbEhhbmRsZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5jaGFubmVsSGFuZGxlLmNsb3NlKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5jaGFubmVsSGFuZGxlID0gbnVsbFxuICAgIHRoaXMucmVhZHlQcm9taXNlID0gbnVsbFxuICAgIHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zS2V5ID0gbnVsbFxuICAgIHJlbGVhc2VGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24odGhpcylcbiAgfVxufVxuXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIGV2ZW50IHN1YnNjcmlwdGlvbnMuXG4gKiBAdHlwZSB7V2Vha01hcDxGcm9udGVuZE1vZGVsQ2xhc3MsIE1hcDxzdHJpbmcsIEZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbj4+fSAqL1xuY29uc3QgZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucyA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBSdW5zIGVuc3VyZSBmcm9udGVuZCBtb2RlbCBldmVudCBzdWJzY3JpcHRpb24uXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0fSByZXF1ZXN0Q29udGV4dCAtIENhcHR1cmVkIHN1YnNjcmlwdGlvbiBjb250ZXh0LlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gLSBQZXItY2xhc3Mgc3Vic2NyaXB0aW9uIGhlbHBlci5cbiAqL1xuZnVuY3Rpb24gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIHJlcXVlc3RDb250ZXh0KSB7XG4gIGxldCBzdWJzY3JpcHRpb25zID0gZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5nZXQoTW9kZWxDbGFzcylcblxuICBpZiAoIXN1YnNjcmlwdGlvbnMpIHtcbiAgICBzdWJzY3JpcHRpb25zID0gbmV3IE1hcCgpXG4gICAgZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5zZXQoTW9kZWxDbGFzcywgc3Vic2NyaXB0aW9ucylcbiAgfVxuXG4gIGNvbnN0IGNvbnRleHRLZXkgPSByZW1vdGVSZXF1ZXN0Q29udGV4dEtleShyZXF1ZXN0Q29udGV4dClcbiAgbGV0IHN1YiA9IHN1YnNjcmlwdGlvbnMuZ2V0KGNvbnRleHRLZXkpXG5cbiAgaWYgKCFzdWIpIHtcbiAgICBzdWIgPSBuZXcgRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIHJlcXVlc3RDb250ZXh0KVxuICAgIHN1YnNjcmlwdGlvbnMuc2V0KGNvbnRleHRLZXksIHN1YilcbiAgfVxuXG4gIHJldHVybiBzdWJcbn1cblxuLyoqXG4gKiBSZW1vdmVzIGFuIGVtcHR5IGNvbnRleHQgYnVja2V0IHNvIHN3aXRjaGluZyB0aHJvdWdoIG1hbnkgdGVuYW50cyBkb2VzIG5vdCByZXRhaW4gZXZlcnkgc25hcHNob3QuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gc3Vic2NyaXB0aW9uIC0gRW1wdHkgc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZWxlYXNlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKHN1YnNjcmlwdGlvbikge1xuICBjb25zdCBzdWJzY3JpcHRpb25zID0gZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5nZXQoc3Vic2NyaXB0aW9uLk1vZGVsQ2xhc3MpXG4gIGNvbnN0IGNvbnRleHRLZXkgPSByZW1vdGVSZXF1ZXN0Q29udGV4dEtleShzdWJzY3JpcHRpb24ucmVxdWVzdENvbnRleHQpXG5cbiAgaWYgKHN1YnNjcmlwdGlvbnM/LmdldChjb250ZXh0S2V5KSAhPT0gc3Vic2NyaXB0aW9uKSByZXR1cm5cblxuICBzdWJzY3JpcHRpb25zLmRlbGV0ZShjb250ZXh0S2V5KVxuICBpZiAoc3Vic2NyaXB0aW9ucy5zaXplID09PSAwKSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmRlbGV0ZShzdWJzY3JpcHRpb24uTW9kZWxDbGFzcylcbn1cblxuLyoqXG4gKiBDYXB0dXJlcyB0aGUgY3VycmVudCBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgY29udGV4dCBmb3Igb25lIG9wZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0fSBGcm96ZW4gY29udGV4dCBzbmFwc2hvdC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KCkge1xuICBjb25zdCBjb25maWd1cmVkQ29udGV4dCA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RDb250ZXh0ID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdENvbnRleHQoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0Q29udGV4dFxuXG4gIHJldHVybiBjYXB0dXJlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KGNvbmZpZ3VyZWRDb250ZXh0KVxufVxuXG4vKipcbiAqIENhcHR1cmVzIHRoZSBleHBsaWNpdCBsaWZlY3ljbGUgY29udGV4dCBvciBmYWxscyBiYWNrIHRvIHRoZSBjb25maWd1cmVkIHRyYW5zcG9ydCBjb250ZXh0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0IHwgdW5kZWZpbmVkfSByZXF1ZXN0Q29udGV4dCAtIFJlZ2lzdHJhdGlvbi1sb2NhbCBjb250ZXh0LlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHR9IEZyb3plbiBjb250ZXh0IHNuYXBzaG90LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsRXZlbnRSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCkge1xuICBpZiAocmVxdWVzdENvbnRleHQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCgpXG5cbiAgcmV0dXJuIGNhcHR1cmVGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpXG59XG5cbi8qKlxuICogUnVucyBlbnN1cmUgZnJvbnRlbmQgbW9kZWwgaW5zdGFuY2UgbGlzdGVuZXIuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gc3ViIC0gRXZlbnQgc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBpZCAtIE1vZGVsIGlkLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gaW5zdGFuY2UgLSBMaXN0ZW5lciBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHt7aW5zdGFuY2U6IEZyb250ZW5kTW9kZWxCYXNlLCB1cGRhdGVDYWxsYmFja3M6IFNldDxGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnk+LCBkZXN0cm95Q2FsbGJhY2tzOiBTZXQ8RnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnk+fX0gLSBJbnN0YW5jZSBsaXN0ZW5lciBidWNrZXQuXG4gKi9cbmZ1bmN0aW9uIGVuc3VyZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyKHN1YiwgaWQsIGluc3RhbmNlKSB7XG4gIGxldCBsaXN0ZW5lciA9IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQoaWQpXG5cbiAgaWYgKCFsaXN0ZW5lcikge1xuICAgIGxpc3RlbmVyID0ge2luc3RhbmNlLCB1cGRhdGVDYWxsYmFja3M6IG5ldyBTZXQoKSwgZGVzdHJveUNhbGxiYWNrczogbmV3IFNldCgpfVxuICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5zZXQoaWQsIGxpc3RlbmVyKVxuICB9IGVsc2Uge1xuICAgIGxpc3RlbmVyLmluc3RhbmNlID0gaW5zdGFuY2VcbiAgfVxuXG4gIHJldHVybiBsaXN0ZW5lclxufVxuXG4vKipcbiAqIFJlbW92ZXMgZXZlcnkgaWRlbnRpdHkga2V5IHBvaW50aW5nIGF0IGFuIGluc3RhbmNlIGxpc3RlbmVyLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb259IHN1YiAtIEV2ZW50IHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIGVuc3VyZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyPn0gbGlzdGVuZXIgLSBJbnN0YW5jZSBsaXN0ZW5lciBidWNrZXQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gZGVsZXRlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIoc3ViLCBsaXN0ZW5lcikge1xuICBmb3IgKGNvbnN0IFtpZCwgY3VycmVudF0gb2Ygc3ViLmluc3RhbmNlTGlzdGVuZXJzKSB7XG4gICAgaWYgKGN1cnJlbnQgPT09IGxpc3RlbmVyKSBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZGVsZXRlKGlkKVxuICB9XG59XG5cbi8qKlxuICogUmVtb3ZlcyBvbmUgaW5zdGFuY2UgY2FsbGJhY2sgZW50cnkgYW5kIHRlYXJzIGRvd24gYW4gZW1wdHkgbGlzdGVuZXIvc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufSBzdWIgLSBFdmVudCBzdWJzY3JpcHRpb24gYnVja2V0LlxuICogQHBhcmFtIHsobGlzdGVuZXI6IFJldHVyblR5cGU8dHlwZW9mIGVuc3VyZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyPikgPT4gYm9vbGVhbn0gcmVtb3ZlRW50cnkgLSBDYWxsYmFjayBlbnRyeSByZW1vdmFsLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCByZW1vdmVFbnRyeSkge1xuICBmb3IgKGNvbnN0IGN1cnJlbnQgb2Ygc3ViLmluc3RhbmNlTGlzdGVuZXJzLnZhbHVlcygpKSB7XG4gICAgaWYgKCFyZW1vdmVFbnRyeShjdXJyZW50KSkgY29udGludWVcblxuICAgIGlmIChjdXJyZW50LnVwZGF0ZUNhbGxiYWNrcy5zaXplID09PSAwICYmIGN1cnJlbnQuZGVzdHJveUNhbGxiYWNrcy5zaXplID09PSAwKSB7XG4gICAgICBkZWxldGVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGN1cnJlbnQpXG4gICAgfVxuICAgIGJyZWFrXG4gIH1cblxuICBzdWIubWF5YmVUZWFyZG93bigpXG59XG5cbi8qKlxuICogVGVtcG9yYXJpbHkgcmVnaXN0ZXJzIGFuIGluc3RhbmNlIGxpc3RlbmVyIHVuZGVyIGl0cyBwZW5kaW5nIGlkZW50aXR5IHdoaWxlIHJldGFpbmluZyBpdHMgcGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IGluc3RhbmNlIC0gSW5zdGFuY2UgYmVpbmcgcmUta2V5ZWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBwcmV2aW91c0lkZW50aXR5IC0gUGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gbmV4dElkZW50aXR5IC0gUGVuZGluZyBpZGVudGl0eSBzZW50IHRvIHRoZSBzZXJ2ZXIuXG4gKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gLSBDYWxsYmFjayB0aGF0IHJlbW92ZXMgdGhlIHRlbXBvcmFyeSBhbGlhc2VzLlxuICovXG5mdW5jdGlvbiBhbGlhc0Zyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyhNb2RlbENsYXNzLCBpbnN0YW5jZSwgcHJldmlvdXNJZGVudGl0eSwgbmV4dElkZW50aXR5KSB7XG4gIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICBjb25zdCBwcmV2aW91c0lkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcHJldmlvdXNJZGVudGl0eSlcbiAgY29uc3QgbmV4dElkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgbmV4dElkZW50aXR5KVxuICAvKiogQHR5cGUge0FycmF5PHtsaXN0ZW5lcjogUmV0dXJuVHlwZTx0eXBlb2YgZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXI+LCBzdWI6IEZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0+fSAqL1xuICBjb25zdCBhbGlhc2VzID0gW11cblxuICBpZiAocHJldmlvdXNJZCA9PT0gbmV4dElkKSByZXR1cm4gKCkgPT4ge31cblxuICBjb25zdCBzdWJzY3JpcHRpb25zID0gZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5nZXQoTW9kZWxDbGFzcylcblxuICBpZiAoIXN1YnNjcmlwdGlvbnMpIHJldHVybiAoKSA9PiB7fVxuXG4gIGZvciAoY29uc3Qgc3ViIG9mIHN1YnNjcmlwdGlvbnMudmFsdWVzKCkpIHtcbiAgICBjb25zdCBsaXN0ZW5lciA9IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQocHJldmlvdXNJZClcblxuICAgIGlmICghbGlzdGVuZXIgfHwgbGlzdGVuZXIuaW5zdGFuY2UgIT09IGluc3RhbmNlIHx8IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5oYXMobmV4dElkKSkgY29udGludWVcblxuICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5zZXQobmV4dElkLCBsaXN0ZW5lcilcbiAgICBhbGlhc2VzLnB1c2goe2xpc3RlbmVyLCBzdWJ9KVxuICB9XG5cbiAgcmV0dXJuICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IHtsaXN0ZW5lciwgc3VifSBvZiBhbGlhc2VzKSB7XG4gICAgICBpZiAoc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChwcmV2aW91c0lkKSA9PT0gbGlzdGVuZXIgJiYgc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChuZXh0SWQpID09PSBsaXN0ZW5lcikge1xuICAgICAgICBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZGVsZXRlKG5leHRJZClcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBNb3ZlcyBjYWxsYmFja3MgcmVnaXN0ZXJlZCBvbiBhbiBpbnN0YW5jZSB0byBpdHMgbmV3bHkgcGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IGluc3RhbmNlIC0gUmUta2V5ZWQgaW5zdGFuY2UuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBwcmV2aW91c0lkZW50aXR5IC0gUHJldmlvdXMgcGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gbmV4dElkZW50aXR5IC0gTmV3IHBlcnNpc3RlZCBpZGVudGl0eS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZWtleUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyhNb2RlbENsYXNzLCBpbnN0YW5jZSwgcHJldmlvdXNJZGVudGl0eSwgbmV4dElkZW50aXR5KSB7XG4gIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICBjb25zdCBwcmV2aW91c0lkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcHJldmlvdXNJZGVudGl0eSlcbiAgY29uc3QgbmV4dElkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgbmV4dElkZW50aXR5KVxuXG4gIGlmIChwcmV2aW91c0lkID09PSBuZXh0SWQpIHJldHVyblxuXG4gIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmdldChNb2RlbENsYXNzKVxuXG4gIGlmICghc3Vic2NyaXB0aW9ucykgcmV0dXJuXG5cbiAgZm9yIChjb25zdCBzdWIgb2Ygc3Vic2NyaXB0aW9ucy52YWx1ZXMoKSkge1xuICAgIGNvbnN0IGxpc3RlbmVyID0gc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChwcmV2aW91c0lkKVxuXG4gICAgaWYgKCFsaXN0ZW5lciB8fCBsaXN0ZW5lci5pbnN0YW5jZSAhPT0gaW5zdGFuY2UpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBuZXh0TGlzdGVuZXIgPSBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KG5leHRJZClcblxuICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5kZWxldGUocHJldmlvdXNJZClcblxuICAgIGlmIChuZXh0TGlzdGVuZXIpIHtcbiAgICAgIG5leHRMaXN0ZW5lci5pbnN0YW5jZSA9IGluc3RhbmNlXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcykgbmV4dExpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcy5hZGQoZW50cnkpXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxpc3RlbmVyLmRlc3Ryb3lDYWxsYmFja3MpIG5leHRMaXN0ZW5lci5kZXN0cm95Q2FsbGJhY2tzLmFkZChlbnRyeSlcbiAgICB9IGVsc2Uge1xuICAgICAgc3ViLmluc3RhbmNlTGlzdGVuZXJzLnNldChuZXh0SWQsIGxpc3RlbmVyKVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY29tbWFuZCB1cmwuXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVzb3VyY2VQYXRoIC0gUmVzb3VyY2UgcGF0aCBwcmVmaXguXG4gKiBAcGFyYW0ge3N0cmluZ30gY29tbWFuZE5hbWUgLSBDb21tYW5kIHBhdGggc2VnbWVudC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRnJvbnRlbmQgbW9kZWwgQVBJIFVSTC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbENvbW1hbmRVcmwocmVzb3VyY2VQYXRoLCBjb21tYW5kTmFtZSkge1xuICBjb25zdCBjb25maWd1cmVkVXJsID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybCgpXG4gIGNvbnN0IG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGggPSByZXNvdXJjZVBhdGguc3RhcnRzV2l0aChcIi9cIikgPyByZXNvdXJjZVBhdGggOiBgLyR7cmVzb3VyY2VQYXRofWBcblxuICByZXR1cm4gYCR7Y29uZmlndXJlZFVybH0ke25vcm1hbGl6ZWRSZXNvdXJjZVBhdGh9LyR7Y29tbWFuZE5hbWV9YFxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgYXBpIHVybC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSBVUkwuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxBcGlVcmwoKSB7XG4gIHJldHVybiBgJHtmcm9udGVuZE1vZGVsVHJhbnNwb3J0VXJsKCl9JHtTSEFSRURfRlJPTlRFTkRfTU9ERUxfQVBJX1BBVEh9YFxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHBhdGguXG4gKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gUmVxdWVzdCBVUkwgb3IgcGF0aC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gV2Vic29ja2V0LXNhZmUgcmVxdWVzdCBwYXRoLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0UGF0aCh1cmwpIHtcbiAgaWYgKHR5cGVvZiB1cmwgIT09IFwic3RyaW5nXCIgfHwgdXJsLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBVUkwvcGF0aCwgZ290OiAke3VybH1gKVxuICB9XG5cbiAgaWYgKHVybC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgIHJldHVybiB1cmxcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkVXJsID0gbmV3IFVSTCh1cmwpXG5cbiAgICByZXR1cm4gYCR7cGFyc2VkVXJsLnBhdGhuYW1lfSR7cGFyc2VkVXJsLnNlYXJjaH1gXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB1cmxcbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBicm93c2VyIHJ1bnRpbWUgdGltZXpvbmUgd2hlbiBhdmFpbGFibGUuXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIEJyb3dzZXIgcnVudGltZSB0aW1lem9uZSB3aGVuIGF2YWlsYWJsZS5cbiAqL1xuZnVuY3Rpb24gZGVmYXVsdEZyb250ZW5kTW9kZWxUaW1lWm9uZSgpIHtcbiAgaWYgKHR5cGVvZiB3aW5kb3cgPT09IFwidW5kZWZpbmVkXCIpIHJldHVybiB1bmRlZmluZWRcblxuICBjb25zdCBpbnRsID0gZ2xvYmFsVGhpcy5JbnRsXG5cbiAgaWYgKCFpbnRsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgSW50bCB0byBiZSBhdmFpbGFibGUgZm9yIGJyb3dzZXIgdGltZXpvbmUgZGV0ZWN0aW9uXCIpXG4gIH1cblxuICBpZiAodHlwZW9mIGludGwuRGF0ZVRpbWVGb3JtYXQgIT09IFwiZnVuY3Rpb25cIikge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIEludGwuRGF0ZVRpbWVGb3JtYXQgdG8gYmUgYXZhaWxhYmxlIGFzIGEgZnVuY3Rpb25cIilcbiAgfVxuXG4gIGNvbnN0IHRpbWVab25lID0gaW50bC5EYXRlVGltZUZvcm1hdCgpLnJlc29sdmVkT3B0aW9ucygpLnRpbWVab25lXG5cbiAgaWYgKHR5cGVvZiB0aW1lWm9uZSAhPT0gXCJzdHJpbmdcIiB8fCB0aW1lWm9uZS50cmltKCkubGVuZ3RoIDwgMSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIEludGwuRGF0ZVRpbWVGb3JtYXQgdG8gcmVzb2x2ZSBhIGJyb3dzZXIgdGltZXpvbmUgc3RyaW5nXCIpXG4gIH1cblxuICByZXR1cm4gdmFsaWRhdGVUaW1lWm9uZSh0aW1lWm9uZSwgXCJicm93c2VyIHRpbWVab25lXCIpXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGNvbmZpZ3VyZWQgZnJvbnRlbmQtbW9kZWwgcmVxdWVzdCB0aW1lem9uZS5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQ29uZmlndXJlZCBmcm9udGVuZC1tb2RlbCB0aW1lem9uZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKCkge1xuICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLCBcInRpbWVab25lXCIpKSB7XG4gICAgcmV0dXJuIGRlZmF1bHRGcm9udGVuZE1vZGVsVGltZVpvbmUoKVxuICB9XG5cbiAgY29uc3QgdGltZVpvbmUgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lWm9uZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lKClcbiAgICA6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZVpvbmVcblxuICBpZiAodGltZVpvbmUgPT09IHVuZGVmaW5lZCB8fCB0aW1lWm9uZSA9PT0gbnVsbCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB0aW1lWm9uZSBkaWQgbm90IHJlc29sdmUgdG8gYSB0aW1lem9uZSBzdHJpbmdcIilcbiAgfVxuXG4gIHJldHVybiB2YWxpZGF0ZVRpbWVab25lKHRpbWVab25lLCBcImZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB0aW1lWm9uZVwiKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVxdWVzdCBoZWFkZXJzLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IFt0aW1lWm9uZV0gLSBQcmUtcmVzb2x2ZWQgdGltZXpvbmUgZm9yIHRoaXMgcmVxdWVzdC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIEhlYWRlcnMgZm9yIGZyb250ZW5kLW1vZGVsIEhUVFAgcmVxdWVzdHMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXF1ZXN0SGVhZGVycyh0aW1lWm9uZSA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpKSB7XG4gIGNvbnN0IGR5bmFtaWNIZWFkZXJzID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdEhlYWRlcnMgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdEhlYWRlcnMoKSB8fCB7fSlcbiAgICA6IChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RIZWFkZXJzIHx8IHt9KVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovXG4gIGNvbnN0IGhlYWRlcnMgPSB7XCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsIC4uLmR5bmFtaWNIZWFkZXJzfVxuXG4gIGlmICh0aW1lWm9uZSkge1xuICAgIGhlYWRlcnNbUkVRVUVTVF9USU1FX1pPTkVfSEVBREVSXSA9IHRpbWVab25lXG4gIH1cblxuICByZXR1cm4gaGVhZGVyc1xufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBjb25maWd1cmVkIGJvdW5kZWQgdHJhbnNwb3J0IGRlYWRsaW5lIGluIG1pbGxpc2Vjb25kcy5cbiAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gQ29uZmlndXJlZCBkZWFkbGluZSwgb3IgdW5kZWZpbmVkIHdoZW4gbm8gZGVhZGxpbmUgaXMgc2V0LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKCkge1xuICBjb25zdCBjb25maWd1cmVkVGltZW91dCA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVvdXQgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lb3V0KClcbiAgICA6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZW91dFxuXG4gIGlmICh0eXBlb2YgY29uZmlndXJlZFRpbWVvdXQgIT09IFwibnVtYmVyXCIgfHwgIShjb25maWd1cmVkVGltZW91dCA+IDApKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgcmV0dXJuIGNvbmZpZ3VyZWRUaW1lb3V0XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGNvbmZpZ3VyZWQgY2FsbGVyL3Nlc3Npb24gQWJvcnRTaWduYWwgY29tcG9zZWQgd2l0aCB0aGUgZGVhZGxpbmUuXG4gKiBAcmV0dXJucyB7QWJvcnRTaWduYWwgfCB1bmRlZmluZWR9IC0gQ29uZmlndXJlZCBjYWxsZXIgc2lnbmFsLCBvciB1bmRlZmluZWQgd2hlbiBub25lIGlzIHNldC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpIHtcbiAgY29uc3QgY29uZmlndXJlZFNpZ25hbCA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNpZ25hbCA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNpZ25hbCgpXG4gICAgOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNpZ25hbFxuXG4gIHJldHVybiBjb25maWd1cmVkU2lnbmFsIHx8IHVuZGVmaW5lZFxufVxuXG4vKipcbiAqIFJlc29sdmVzIHBlci1zdGFydHVwIGNvbnRyb2xzIHdpdGggdGhlIGNvbmZpZ3VyZWQgc2Vzc2lvbiBjYW5jZWxsYXRpb24uXG4gKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIsIHNpZ25hbD86IEFib3J0U2lnbmFsfX0gY29udHJvbHMgLSBDYWxsIGNvbnRyb2xzLlxuICogQHJldHVybnMge3t0aW1lb3V0TXM/OiBudW1iZXIsIHNpZ25hbD86IEFib3J0U2lnbmFsfX0gLSBFZmZlY3RpdmUgc3RhcnR1cCBjb250cm9scy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFdlYnNvY2tldFN0YXJ0dXBDb250cm9scyhjb250cm9scykge1xuICBjb25zdCBzZXNzaW9uU2lnbmFsID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpXG4gIGxldCBzaWduYWwgPSBjb250cm9scy5zaWduYWwgfHwgc2Vzc2lvblNpZ25hbFxuXG4gIGlmIChjb250cm9scy5zaWduYWwgJiYgc2Vzc2lvblNpZ25hbCAmJiBjb250cm9scy5zaWduYWwgIT09IHNlc3Npb25TaWduYWwpIHtcbiAgICBzaWduYWwgPSBBYm9ydFNpZ25hbC5hbnkoW2NvbnRyb2xzLnNpZ25hbCwgc2Vzc2lvblNpZ25hbF0pXG4gIH1cblxuICBjb25zdCBjb25maWd1cmVkVGltZW91dE1zID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVvdXRNcygpXG4gIGNvbnN0IHRpbWVvdXRNcyA9IGNvbnRyb2xzLnRpbWVvdXRNcyA9PT0gdW5kZWZpbmVkXG4gICAgPyBjb25maWd1cmVkVGltZW91dE1zXG4gICAgOiBjb25maWd1cmVkVGltZW91dE1zID09PSB1bmRlZmluZWRcbiAgICAgID8gY29udHJvbHMudGltZW91dE1zXG4gICAgICA6IE1hdGgubWluKGNvbnRyb2xzLnRpbWVvdXRNcywgY29uZmlndXJlZFRpbWVvdXRNcylcblxuICByZXR1cm4ge3NpZ25hbCwgdGltZW91dE1zfVxufVxuXG4vKipcbiAqIFJ1bnMgcGVyZm9ybSBzaGFyZWQgZnJvbnRlbmQgbW9kZWwgYXBpIHJlcXVlc3QuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcmVxdWVzdFBheWxvYWQgLSBTaGFyZWQgcmVxdWVzdCBwYXlsb2FkLlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBEZWNvZGVkIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgcmVzcG9uc2UuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHBlcmZvcm1TaGFyZWRGcm9udGVuZE1vZGVsQXBpUmVxdWVzdChyZXF1ZXN0UGF5bG9hZCkge1xuICBjb25zdCB0aW1lWm9uZSA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpXG4gIGNvbnN0IHNlcmlhbGl6ZWRSZXF1ZXN0UGF5bG9hZCA9IHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShyZXF1ZXN0UGF5bG9hZCwge3RpbWVab25lfSlcbiAgY29uc3Qgd2Vic29ja2V0Q2xpZW50ID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnRcbiAgY29uc3QgdXJsID0gZnJvbnRlbmRNb2RlbEFwaVVybCgpXG4gIGNvbnN0IG1lcmdlZEhlYWRlcnMgPSBmcm9udGVuZE1vZGVsUmVxdWVzdEhlYWRlcnModGltZVpvbmUpXG5cbiAgcmV0dXJuIGF3YWl0IHJ1bldpdGhUcmFuc3BvcnREZWFkbGluZShcbiAgICB7XG4gICAgICBlcnJvck1lc3NhZ2U6IFwiU2hhcmVkIGZyb250ZW5kIG1vZGVsIEFQSSByZXF1ZXN0IHRpbWVkIG91dFwiLFxuICAgICAgc2lnbmFsOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCksXG4gICAgICB0aW1lb3V0TXM6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lb3V0TXMoKVxuICAgIH0sXG4gICAgYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgaWYgKHdlYnNvY2tldENsaWVudCkge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHdlYnNvY2tldENsaWVudC5wb3N0KGZyb250ZW5kTW9kZWxUcmFuc3BvcnRQYXRoKHVybCksIHNlcmlhbGl6ZWRSZXF1ZXN0UGF5bG9hZCwge1xuICAgICAgICAgIGhlYWRlcnM6IG1lcmdlZEhlYWRlcnMsXG4gICAgICAgICAgc2lnbmFsXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlSnNvbiA9IHJlc3BvbnNlLmpzb24oKVxuXG4gICAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHJlc3BvbnNlSnNvbikpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHNlcmlhbGl6ZWRSZXF1ZXN0UGF5bG9hZCksXG4gICAgICAgIGNyZWRlbnRpYWxzOiBcImluY2x1ZGVcIixcbiAgICAgICAgaGVhZGVyczogbWVyZ2VkSGVhZGVycyxcbiAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgc2lnbmFsXG4gICAgICB9KVxuXG4gICAgICBjb25zdCByZXNwb25zZVRleHQgPSBhd2FpdCByZXNwb25zZS50ZXh0KClcblxuICAgICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgICB0aHJvd0Zyb250ZW5kTW9kZWxIdHRwRXJyb3Ioe1xuICAgICAgICAgIGNvbW1hbmRMYWJlbDogXCJzaGFyZWQgZnJvbnRlbmQgbW9kZWwgQVBJXCIsXG4gICAgICAgICAgcmVzcG9uc2UsXG4gICAgICAgICAgcmVzcG9uc2VUZXh0XG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGpzb24gPSByZXNwb25zZVRleHQubGVuZ3RoID4gMCA/IEpTT04ucGFyc2UocmVzcG9uc2VUZXh0KSA6IHt9XG5cbiAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGpzb24pKVxuICAgIH1cbiAgKVxufVxuXG4vKipcbiAqIFRocm93cyBhIGZyb250ZW5kLW1vZGVsIEhUVFAgZXJyb3Igd2l0aCBiYWNrZW5kLXByb3ZpZGVkIGVudmVsb3BlIGRldGFpbHMgd2hlbiBhdmFpbGFibGUuXG4gKiBAcGFyYW0ge3tjb21tYW5kTGFiZWw6IHN0cmluZywgcmVzcG9uc2U6IFJlc3BvbnNlLCByZXNwb25zZVRleHQ6IHN0cmluZ319IGFyZ3MgLSBFcnJvciByZXNwb25zZSBkZXRhaWxzLlxuICogQHJldHVybnMge25ldmVyfSAtIEFsd2F5cyB0aHJvd3MgYW4gdW5rbm93bi1hdHRyaWJ1dGUgZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIHRocm93RnJvbnRlbmRNb2RlbEh0dHBFcnJvcih7Y29tbWFuZExhYmVsLCByZXNwb25zZSwgcmVzcG9uc2VUZXh0fSkge1xuICAvLyBTdXJmYWNlIHRoZSBiYWNrZW5kJ3MgZnJpZW5kbHkgZXJyb3JNZXNzYWdlIGVudmVsb3BlICh0aGVcbiAgLy8gYHtzdGF0dXM6IFwiZXJyb3JcIiwgZXJyb3JNZXNzYWdlOiBcIi4uLlwifWAgc2hhcGUgZXZlcnkgY29udHJvbGxlclxuICAvLyBzaGlwcyBvbiBpdHMgNHh4LzV4eCByZXNwb25zZXMpIGluc3RlYWQgb2YgdGhlIGdlbmVyaWMgc3RhdHVzXG4gIC8vIHN0cmluZy4gRmFsbCB0aHJvdWdoIHRvIHRoZSBzdGF0dXMtb25seSBtZXNzYWdlIHdoZW4gdGhlIGJvZHkgaXNcbiAgLy8gbWlzc2luZywgbm9uLUpTT04sIG9yIGhhcyBubyB1c2FibGUgZXJyb3JNZXNzYWdlIGZpZWxkLlxuICBjb25zdCByZXNwb25zZUNvbnRlbnRUeXBlID0gcmVzcG9uc2UuaGVhZGVycy5nZXQoXCJjb250ZW50LXR5cGVcIilcblxuICBpZiAocmVzcG9uc2VDb250ZW50VHlwZSAmJiByZXNwb25zZUNvbnRlbnRUeXBlLmluY2x1ZGVzKFwiYXBwbGljYXRpb24vanNvblwiKSAmJiByZXNwb25zZVRleHQubGVuZ3RoID4gMCkge1xuICAgIC8qKlxuICAgICAqIERlZmluZXMgZXJyb3JCb2R5LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSAqL1xuICAgIGxldCBlcnJvckJvZHlcblxuICAgIHRyeSB7XG4gICAgICBlcnJvckJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlVGV4dClcbiAgICB9IGNhdGNoIHtcbiAgICAgIGVycm9yQm9keSA9IG51bGxcbiAgICB9XG5cbiAgICBpZiAoZXJyb3JCb2R5ICYmIHR5cGVvZiBlcnJvckJvZHkuZXJyb3JNZXNzYWdlID09PSBcInN0cmluZ1wiICYmIGVycm9yQm9keS5lcnJvck1lc3NhZ2UudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvckJvZHkuZXJyb3JNZXNzYWdlLnRyaW0oKSlcbiAgICB9XG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoYFJlcXVlc3QgZmFpbGVkICgke3Jlc3BvbnNlLnN0YXR1c30pIGZvciAke2NvbW1hbmRMYWJlbH1gKVxufVxuXG4vKipcbiAqIFJ1bnMgZmx1c2ggcGVuZGluZyBzaGFyZWQgZnJvbnRlbmQgbW9kZWwgcmVxdWVzdHMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBwZW5kaW5nIHNoYXJlZCBmcm9udGVuZC1tb2RlbCByZXF1ZXN0cyBmbHVzaC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZmx1c2hQZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzKCkge1xuICBzaGFyZWRGcm9udGVuZE1vZGVsRmx1c2hTY2hlZHVsZWQgPSBmYWxzZVxuXG4gIGlmIChwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzLmxlbmd0aCA8IDEpIHtcbiAgICByZXNvbHZlRnJvbnRlbmRNb2RlbElkbGVXYWl0ZXJzKClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IGJhdGNoZWRSZXF1ZXN0cyA9IHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHNcbiAgcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cyA9IFtdXG5cbiAgY29uc3QgdXJsID0gZnJvbnRlbmRNb2RlbEFwaVVybCgpXG4gIGNvbnN0IHJlcXVlc3RQYXlsb2FkID0ge1xuICAgIHJlcXVlc3RzOiBiYXRjaGVkUmVxdWVzdHMubWFwKChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAocmVxdWVzdC5jdXN0b21QYXRoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZFR5cGU6IHJlcXVlc3QuY29tbWFuZFR5cGUsXG4gICAgICAgICAgY3VzdG9tUGF0aDogcmVxdWVzdC5jdXN0b21QYXRoLFxuICAgICAgICAgIG1vZGVsOiByZXF1ZXN0Lm1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgICAgcGF5bG9hZDogcmVxdWVzdC5wYXlsb2FkLFxuICAgICAgICAgIC4uLihPYmplY3Qua2V5cyhyZXF1ZXN0LnJlcXVlc3RDb250ZXh0KS5sZW5ndGggPiAwID8ge3JlcXVlc3RDb250ZXh0OiByZXF1ZXN0LnJlcXVlc3RDb250ZXh0fSA6IHt9KSxcbiAgICAgICAgICByZXF1ZXN0SWQ6IHJlcXVlc3QucmVxdWVzdElkXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29tbWFuZFR5cGU6IHJlcXVlc3QuY29tbWFuZFR5cGUsXG4gICAgICAgIG1vZGVsOiByZXF1ZXN0Lm1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgIHBheWxvYWQ6IHJlcXVlc3QucGF5bG9hZCxcbiAgICAgICAgLi4uKE9iamVjdC5rZXlzKHJlcXVlc3QucmVxdWVzdENvbnRleHQpLmxlbmd0aCA+IDAgPyB7cmVxdWVzdENvbnRleHQ6IHJlcXVlc3QucmVxdWVzdENvbnRleHR9IDoge30pLFxuICAgICAgICByZXF1ZXN0SWQ6IHJlcXVlc3QucmVxdWVzdElkXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIGF3YWl0IHRyYWNrRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3QoYXN5bmMgKCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICB2b2lkIHVybFxuICAgICAgY29uc3QgZGVjb2RlZFJlc3BvbnNlID0gYXdhaXQgcGVyZm9ybVNoYXJlZEZyb250ZW5kTW9kZWxBcGlSZXF1ZXN0KHJlcXVlc3RQYXlsb2FkKVxuICAgICAgY29uc3QgcmVzcG9uc2VzID0gQXJyYXkuaXNBcnJheShkZWNvZGVkUmVzcG9uc2UucmVzcG9uc2VzKSA/IGRlY29kZWRSZXNwb25zZS5yZXNwb25zZXMgOiBbXVxuICAgICAgY29uc3QgcmVzcG9uc2VzQnlJZCA9IG5ldyBNYXAocmVzcG9uc2VzLm1hcCgoZW50cnkpID0+IFtlbnRyeS5yZXF1ZXN0SWQsIGVudHJ5LnJlc3BvbnNlXSkpXG5cbiAgICAgIGZvciAoY29uc3QgcmVxdWVzdCBvZiBiYXRjaGVkUmVxdWVzdHMpIHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2VQYXlsb2FkID0gcmVzcG9uc2VzQnlJZC5nZXQocmVxdWVzdC5yZXF1ZXN0SWQpXG5cbiAgICAgICAgaWYgKCFyZXNwb25zZVBheWxvYWQgfHwgdHlwZW9mIHJlc3BvbnNlUGF5bG9hZCAhPT0gXCJvYmplY3RcIikge1xuICAgICAgICAgIHJlcXVlc3QucmVqZWN0KG5ldyBFcnJvcihgTWlzc2luZyBiYXRjaGVkIHJlc3BvbnNlIGZvciAke3JlcXVlc3QubW9kZWxDbGFzcy5uYW1lfSMke3JlcXVlc3QuY29tbWFuZFR5cGV9YCkpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIHJlcXVlc3QucmVzb2x2ZSgvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJlc3BvbnNlUGF5bG9hZCkpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGZvciAoY29uc3QgcmVxdWVzdCBvZiBiYXRjaGVkUmVxdWVzdHMpIHtcbiAgICAgICAgcmVxdWVzdC5yZWplY3QoZXJyb3IpXG4gICAgICB9XG4gICAgfVxuICB9KVxufVxuXG4vKipcbiAqIFJ1bnMgc2NoZWR1bGUgc2hhcmVkIGZyb250ZW5kIG1vZGVsIHJlcXVlc3QgZmx1c2guXG4gKiBAcmV0dXJucyB7dm9pZH0gKi9cbmZ1bmN0aW9uIHNjaGVkdWxlU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RGbHVzaCgpIHtcbiAgaWYgKHNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZCkgcmV0dXJuXG5cbiAgc2hhcmVkRnJvbnRlbmRNb2RlbEZsdXNoU2NoZWR1bGVkID0gdHJ1ZVxuICBxdWV1ZU1pY3JvdGFzaygoKSA9PiB7XG4gICAgdm9pZCBmbHVzaFBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMoKVxuICB9KVxufVxuXG4vKipcbiAqIEN1c3RvbSBjb21tYW5kcyBzdGlsbCB1c2UgdGhlIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkuIFRoaXMgaGVscGVyIG9ubHkgYnVpbGRzIHRoZSBiYWNrZW5kIHJvdXRlIHBhdGggdGhlIHNlcnZlciBzaG91bGQgZGlzcGF0Y2ggYWZ0ZXIgdmFsaWRhdGluZyB0aGUgc2VnbWVudHMuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbW1hbmROYW1lIC0gQ29tbWFuZCBwYXRoIHNlZ21lbnQuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tb2RlbE5hbWUgLSBGcm9udGVuZCBtb2RlbCBjbGFzcyBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBbYXJncy5tZW1iZXJJZF0gLSBPcHRpb25hbCBtZW1iZXIgaWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXNvdXJjZVBhdGggLSBSZXNvdXJjZSBwYXRoIHByZWZpeC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQ3VzdG9tIGJhY2tlbmQgcm91dGUgcGF0aC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRQYXRoKHtjb21tYW5kTmFtZSwgbWVtYmVySWQsIG1vZGVsTmFtZSwgcmVzb3VyY2VQYXRofSkge1xuICBjb25zdCB2YWxpZGF0ZWRSZXNvdXJjZVBhdGggPSB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgoe21vZGVsTmFtZSwgcmVzb3VyY2VQYXRofSlcbiAgY29uc3QgdmFsaWRhdGVkQ29tbWFuZE5hbWUgPSB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbW1hbmROYW1lKHtjb21tYW5kTmFtZSwgY29tbWFuZFR5cGU6IGNvbW1hbmROYW1lLCBtb2RlbE5hbWV9KVxuXG4gIGlmIChtZW1iZXJJZCA9PT0gdW5kZWZpbmVkIHx8IG1lbWJlcklkID09PSBudWxsIHx8IG1lbWJlcklkID09PSBcIlwiKSB7XG4gICAgcmV0dXJuIGAke3ZhbGlkYXRlZFJlc291cmNlUGF0aH0vJHt2YWxpZGF0ZWRDb21tYW5kTmFtZX1gXG4gIH1cblxuICByZXR1cm4gYCR7dmFsaWRhdGVkUmVzb3VyY2VQYXRofS8ke2VuY29kZVVSSUNvbXBvbmVudChTdHJpbmcobWVtYmVySWQpKX0vJHt2YWxpZGF0ZWRDb21tYW5kTmFtZX1gXG59XG5cbi8qKlxuICogUnVucyBhc3NlcnQgZmluZCBieSBjb25kaXRpb25zIHNoYXBlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gY29uZGl0aW9ucyAtIGZpbmRCeSBjb25kaXRpb25zLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydEZpbmRCeUNvbmRpdGlvbnNTaGFwZShjb25kaXRpb25zKSB7XG4gIGlmICghY29uZGl0aW9ucyB8fCB0eXBlb2YgY29uZGl0aW9ucyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNvbmRpdGlvbnMpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZXhwZWN0cyBjb25kaXRpb25zIHRvIGJlIGEgcGxhaW4gb2JqZWN0LCBnb3Q6ICR7Y29uZGl0aW9uc31gKVxuICB9XG5cbiAgY29uc3QgY29uZGl0aW9uc1Byb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihjb25kaXRpb25zKVxuXG4gIGlmIChjb25kaXRpb25zUHJvdG90eXBlICE9PSBPYmplY3QucHJvdG90eXBlICYmIGNvbmRpdGlvbnNQcm90b3R5cGUgIT09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBleHBlY3RzIGNvbmRpdGlvbnMgdG8gYmUgYSBwbGFpbiBvYmplY3QsIGdvdDogJHtjb25kaXRpb25zfWApXG4gIH1cblxuICBjb25zdCBzeW1ib2xLZXlzID0gT2JqZWN0LmdldE93blByb3BlcnR5U3ltYm9scyhjb25kaXRpb25zKVxuXG4gIGlmIChzeW1ib2xLZXlzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IHN5bWJvbCBjb25kaXRpb24ga2V5cyAoa2V5czogJHtzeW1ib2xLZXlzLm1hcCgoa2V5KSA9PiBrZXkudG9TdHJpbmcoKSkuam9pbihcIiwgXCIpfSlgKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBhc3NlcnQgZGVmaW5lZCBmaW5kIGJ5IGNvbmRpdGlvbiB2YWx1ZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZGl0aW9uIHZhbHVlIHRvIHZhbGlkYXRlLlxuICogQHBhcmFtIHtzdHJpbmd9IGtleVBhdGggLSBLZXkgcGF0aCBmb3IgZXJyb3Igb3V0cHV0LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydERlZmluZWRGaW5kQnlDb25kaXRpb25WYWx1ZSh2YWx1ZSwga2V5UGF0aCkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgdW5kZWZpbmVkIGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBmdW5jdGlvbiBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3ltYm9sXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IHN5bWJvbCBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwiYmlnaW50XCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IGJpZ2ludCBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgIU51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IG5vbi1maW5pdGUgbnVtYmVyIGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgdmFsdWUuZm9yRWFjaCgoZW50cnksIGluZGV4KSA9PiB7XG4gICAgICBhc3NlcnREZWZpbmVkRmluZEJ5Q29uZGl0aW9uVmFsdWUoZW50cnksIGAke2tleVBhdGh9WyR7aW5kZXh9XWApXG4gICAgfSlcbiAgICByZXR1cm5cbiAgfVxuXG4gIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIpIHtcbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBvYmplY3RWYWx1ZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodmFsdWUpXG4gICAgY29uc3QgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKG9iamVjdFZhbHVlKVxuXG4gICAgaWYgKHByb3RvdHlwZSAhPT0gT2JqZWN0LnByb3RvdHlwZSAmJiBwcm90b3R5cGUgIT09IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgbm9uLXBsYWluIG9iamVjdCBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgICB9XG5cbiAgICBjb25zdCBzeW1ib2xLZXlzID0gT2JqZWN0LmdldE93blByb3BlcnR5U3ltYm9scyhvYmplY3RWYWx1ZSlcblxuICAgIGlmIChzeW1ib2xLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgc3ltYm9sIGNvbmRpdGlvbiBrZXlzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgICB9XG5cbiAgICBjb25zdCB2YWx1ZU9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodmFsdWUpXG5cbiAgICBPYmplY3Qua2V5cyh2YWx1ZU9iamVjdCkuZm9yRWFjaCgobmVzdGVkS2V5KSA9PiB7XG4gICAgICBhc3NlcnREZWZpbmVkRmluZEJ5Q29uZGl0aW9uVmFsdWUodmFsdWVPYmplY3RbbmVzdGVkS2V5XSwgYCR7a2V5UGF0aH0uJHtuZXN0ZWRLZXl9YClcbiAgICB9KVxuICB9XG59XG5cbi8qKlxuICogQmFzZSBmcm9udGVuZCBtb2RlbC5cbiAqXG4gKiBEZWZhdWx0cyBhcmUgYGFueWAgc28gdGhlIGJhcmUgYEZyb250ZW5kTW9kZWxCYXNlYCDigJQgdXNlZCB0aHJvdWdob3V0IGFzIGFcbiAqIGNvbnN0cmFpbnQvcGFyYW1ldGVyIHR5cGUgZm9yIFwiYW55IGZyb250ZW5kIG1vZGVsXCIg4oCUIGFjY2VwdHMgZ2VuZXJhdGVkXG4gKiBzdWJjbGFzc2VzIGRlY2xhcmluZyB0eXBlZC1hdHRyaWJ1dGUgZ2VuZXJpY3MgKGBGcm9udGVuZE1vZGVsQmFzZTxYQXR0cmlidXRlcyxcbiAqIC4uLj5gKS4gQSBjb25jcmV0ZSBgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPmAgZGVmYXVsdCBtYWtlc1xuICogdGhvc2Ugc3ViY2xhc3NlcyBmYWlsIGJ5IGludmFyaWFuY2UuIFN1YmNsYXNzZXMgc3RpbGwgcGFzcyB0aGVpciBwcmVjaXNlXG4gKiBhdHRyaWJ1dGUgdHlwZWRlZnMsIHNvIHR5cGVkIGFjY2Vzc29ycyBrZWVwIHRoZWlyIHByZWNpc2lvbi5cbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbQXR0cmlidXRlcz1hbnldXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW0NyZWF0ZUF0dHJpYnV0ZXM9YW55XVxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtVcGRhdGVBdHRyaWJ1dGVzPWFueV1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRnJvbnRlbmRNb2RlbEJhc2Uge1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgbW9kZWxOYW1lXG5cbiAgLyoqXG4gICAqIEF1dG9sb2FkLlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gLSBHbG9iYWwgYXV0by1iYXRjaC1wcmVsb2FkIHRvZ2dsZS4gQXBwcyBjYW4gb3B0IG91dCB2aWEgRnJvbnRlbmRNb2RlbEJhc2Uuc2V0QXV0b2xvYWQoZmFsc2UpLlxuICAgKi9cbiAgc3RhdGljIF9hdXRvbG9hZCA9IHRydWVcblxuICAvKipcbiAgICogUnVucyBnZXQgYXV0b2xvYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGF1dG8tYmF0Y2gtcHJlbG9hZCBvZiByZWxhdGlvbnNoaXBzIG9uIGxhenkgYWNjZXNzIGlzIGVuYWJsZWQgZ2xvYmFsbHkuXG4gICAqL1xuICBzdGF0aWMgZ2V0QXV0b2xvYWQoKSB7IHJldHVybiBGcm9udGVuZE1vZGVsQmFzZS5fYXV0b2xvYWQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhdXRvbG9hZC5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdWYWx1ZSAtIFdoZXRoZXIgYXV0by1iYXRjaC1wcmVsb2FkIG9mIHJlbGF0aW9uc2hpcHMgaXMgZW5hYmxlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgc2V0QXV0b2xvYWQobmV3VmFsdWUpIHsgRnJvbnRlbmRNb2RlbEJhc2UuX2F1dG9sb2FkID0gbmV3VmFsdWUgfVxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqL1xuICBfYXR0cmlidXRlc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXA8RnJvbnRlbmRNb2RlbEJhc2UsIEZyb250ZW5kTW9kZWxCYXNlLCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+PiB8IEZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcDxGcm9udGVuZE1vZGVsQmFzZSwgRnJvbnRlbmRNb2RlbEJhc2UsIFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4+Pn0gKi9cbiAgX3JlbGF0aW9uc2hpcHNcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRhY2htZW50SGFuZGxlPn0gKi9cbiAgX2F0dGFjaG1lbnRzXG4gIC8qKlxuICAgKiBSYWlscy1zdHlsZSBuZXN0ZWQgYXR0cmlidXRlIHBheWxvYWRzIHF1ZXVlZCBmb3IgdGhlIG5leHQgc2F2ZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn1cbiAgICovXG4gIF9wZW5kaW5nTmVzdGVkQXR0cmlidXRlc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7U2V0PHN0cmluZz4gfCBudWxsfSAqL1xuICBfc2VsZWN0ZWRBdHRyaWJ1dGVzXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtib29sZWFufSAqL1xuICBfaXNOZXdSZWNvcmRcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gIF9tYXJrZWRGb3JEZXN0cnVjdGlvblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi9cbiAgX3BlcnNpc3RlZEF0dHJpYnV0ZXNcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxCYXNlPiB8IHVuZGVmaW5lZH0gLSBTaGFyZWQgcmVmZXJlbmNlIHRvIHNpYmxpbmcgcmVjb3JkcyBsb2FkZWQgaW4gdGhlIHNhbWUgYmF0Y2guIFVzZWQgYnkgYXV0by1iYXRjaC1wcmVsb2FkLlxuICAgKi9cbiAgX2xvYWRDb2hvcnRcbiAgLyoqXG4gICAqIENhbm9uaWNhbCBiYWNraW5nLXJlY29yZCBhdHRhY2htZW50IG93bmVyIHJldHVybmVkIGJ5IHRoZSBzZXJ2ZXIuXG4gICAqIEB0eXBlIHt7cmVjb3JkSWQ6IHN0cmluZywgcmVjb3JkVHlwZTogc3RyaW5nLCByZXNvdXJjZU5hbWU6IHN0cmluZ30gfCBudWxsfVxuICAgKi9cbiAgX2F0dGFjaG1lbnRPd25lclxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0F0dHJpYnV0ZXMgfCBDcmVhdGVBdHRyaWJ1dGVzfSBbYXR0cmlidXRlc10gLSBJbml0aWFsIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihhdHRyaWJ1dGVzKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuXG4gICAgTW9kZWxDbGFzcy5lbnN1cmVHZW5lcmF0ZWRBdHRhY2htZW50TWV0aG9kcygpXG4gICAgdGhpcy5fYXR0cmlidXRlcyA9IHt9XG4gICAgdGhpcy5fcmVsYXRpb25zaGlwcyA9IHt9XG4gICAgdGhpcy5fYXR0YWNobWVudHMgPSB7fVxuICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICB0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMgPSBudWxsXG4gICAgdGhpcy5faXNOZXdSZWNvcmQgPSB0cnVlXG4gICAgdGhpcy5fbWFya2VkRm9yRGVzdHJ1Y3Rpb24gPSBmYWxzZVxuICAgIHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIHRoaXMuX2F0dGFjaG1lbnRPd25lciA9IG51bGxcbiAgICBpZiAoYXR0cmlidXRlcykgdGhpcy5hc3NpZ25BdHRyaWJ1dGVzKGF0dHJpYnV0ZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgZ2VuZXJhdGVkIGF0dGFjaG1lbnQgbWV0aG9kcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge3ZvaWR9IC0gRW5zdXJlcyBhdHRhY2htZW50IGhlbHBlciBtZXRob2RzIGV4aXN0IG9uIHRoZSBwcm90b3R5cGUuXG4gICAqL1xuICBzdGF0aWMgZW5zdXJlR2VuZXJhdGVkQXR0YWNobWVudE1ldGhvZHMoKSB7XG4gICAgaWYgKHRoaXMuX2dlbmVyYXRlZEF0dGFjaG1lbnRNZXRob2RzKSByZXR1cm5cblxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gdGhpcy5hdHRhY2htZW50RGVmaW5pdGlvbnMoKVxuICAgIGNvbnN0IHByb3RvdHlwZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodGhpcy5wcm90b3R5cGUpXG5cbiAgICBmb3IgKGNvbnN0IGF0dGFjaG1lbnROYW1lIG9mIE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKSkge1xuICAgICAgaWYgKCEoYXR0YWNobWVudE5hbWUgaW4gcHJvdG90eXBlKSkge1xuICAgICAgICBwcm90b3R5cGVbYXR0YWNobWVudE5hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX2dlbmVyYXRlZEF0dGFjaG1lbnRNZXRob2RzID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnfSAtIFJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBzdGF0aWMgcmVzb3VyY2VDb25maWcoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwicmVzb3VyY2VDb25maWcoKSBtdXN0IGJlIGltcGxlbWVudGVkIGJ5IHN1YmNsYXNzZXNcIilcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tdW5yZWFjaGFibGVcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzc2VzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbENsYXNzIHwgc3RyaW5nPn0gLSBSZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3NlcyAob3IgY2xhc3MgbmFtZSBzdHJpbmdzKSBrZXllZCBieSByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICovXG4gIHN0YXRpYyByZWxhdGlvbnNoaXBNb2RlbENsYXNzZXMoKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXIgYSBmcm9udGVuZCBtb2RlbCBjbGFzcyBzbyBpdCBjYW4gYmUgcmVzb2x2ZWQgYnkgbmFtZSBpbiByZWxhdGlvbnNoaXAgbG9va3Vwcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB0byByZWdpc3Rlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgcmVnaXN0ZXJNb2RlbChtb2RlbENsYXNzKSB7XG4gICAgcmVnaXN0ZXJGcm9udGVuZE1vZGVsKG1vZGVsQ2xhc3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWZpbmUgc2NvcGUuXG4gICAqIEBwYXJhbSB7KC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGNhbGxiYWNrIC0gU2NvcGUgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHsoKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PEZyb250ZW5kTW9kZWxDbGFzcz4pICYge3Njb3BlOiAoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1zY29wZS5qc1wiKS5Nb2RlbFNjb3BlRGVzY3JpcHRvcn19IC0gU2NvcGUgaGVscGVyLlxuICAgKi9cbiAgc3RhdGljIGRlZmluZVNjb3BlKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGRlZmluZU1vZGVsU2NvcGUoe1xuICAgICAgY2FsbGJhY2ssXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgc3RhcnRRdWVyeTogKCkgPT4gdGhpcy5xdWVyeSgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlIGEgcmVsYXRpb25zaGlwIG1vZGVsIGNsYXNzIHZhbHVlIHRoYXQgbWF5IGJlIGEgY2xhc3MgcmVmZXJlbmNlIG9yIGEgc3RyaW5nIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzIHwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gdmFsdWUgLSBDbGFzcyBvciBjbGFzcyBuYW1lLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbENsYXNzIHwgbnVsbH0gLSBSZXNvbHZlZCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIHN0YXRpYyByZXNvbHZlTW9kZWxDbGFzcyh2YWx1ZSkge1xuICAgIHJldHVybiByZXNvbHZlRnJvbnRlbmRNb2RlbENsYXNzKHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIGRlZmluaXRpb25zLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywge3R5cGU6IFwiYmVsb25nc1RvXCIgfCBcImhhc09uZVwiIHwgXCJoYXNNYW55XCIsIGF1dG9sb2FkPzogYm9vbGVhbn0+fSAtIFJlbGF0aW9uc2hpcCBkZWZpbml0aW9ucyBrZXllZCBieSByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICovXG4gIHN0YXRpYyByZWxhdGlvbnNoaXBEZWZpbml0aW9ucygpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaG1lbnQgZGVmaW5pdGlvbnMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0YWNobWVudERlZmluaXRpb24+fSAtIEF0dGFjaG1lbnQgZGVmaW5pdGlvbnMga2V5ZWQgYnkgYXR0YWNobWVudCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGF0dGFjaG1lbnREZWZpbml0aW9ucygpIHtcbiAgICByZXR1cm4gdGhpcy5yZXNvdXJjZUNvbmZpZygpLmF0dGFjaG1lbnRzIHx8IHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2htZW50IGRlZmluaXRpb24uXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxBdHRhY2htZW50RGVmaW5pdGlvbiB8IG51bGx9IC0gQXR0YWNobWVudCBkZWZpbml0aW9uLlxuICAgKi9cbiAgc3RhdGljIGF0dGFjaG1lbnREZWZpbml0aW9uKGF0dGFjaG1lbnROYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuYXR0YWNobWVudERlZmluaXRpb25zKClbYXR0YWNobWVudE5hbWVdIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBkZWZpbml0aW9uLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7e3R5cGU6IFwiYmVsb25nc1RvXCIgfCBcImhhc09uZVwiIHwgXCJoYXNNYW55XCIsIGF1dG9sb2FkPzogYm9vbGVhbn0gfCBudWxsfSAtIFJlbGF0aW9uc2hpcCBkZWZpbml0aW9uLlxuICAgKi9cbiAgc3RhdGljIHJlbGF0aW9uc2hpcERlZmluaXRpb24ocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IGRlZmluaXRpb25zID0gdGhpcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9ucygpXG5cbiAgICByZXR1cm4gZGVmaW5pdGlvbnNbcmVsYXRpb25zaGlwTmFtZV0gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgUmFpbHMtc3R5bGUgbmVzdGVkIGF0dHJpYnV0ZXMga2V5IHRvIGEgY29uZmlndXJlZCByZWxhdGlvbnNoaXAuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQ2FuZGlkYXRlIGF0dHJpYnV0ZSBuYW1lLCBzdWNoIGFzIGB0YXNrc0F0dHJpYnV0ZXNgLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gUmVsYXRpb25zaGlwIG5hbWUgd2hlbiBuZXN0ZWQgYXR0cmlidXRlcyBhcmUgY29uZmlndXJlZC5cbiAgICovXG4gIHN0YXRpYyBuZXN0ZWRBdHRyaWJ1dGVzUmVsYXRpb25zaGlwTmFtZShhdHRyaWJ1dGVOYW1lKSB7XG4gICAgaWYgKCFhdHRyaWJ1dGVOYW1lLmVuZHNXaXRoKFwiQXR0cmlidXRlc1wiKSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgPSBhdHRyaWJ1dGVOYW1lLnNsaWNlKDAsIC1cIkF0dHJpYnV0ZXNcIi5sZW5ndGgpXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlc0NvbmZpZyA9IHRoaXMucmVzb3VyY2VDb25maWcoKS5uZXN0ZWRBdHRyaWJ1dGVzIHx8IHt9XG5cbiAgICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG5lc3RlZEF0dHJpYnV0ZXNDb25maWcsIHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICA/IHJlbGF0aW9uc2hpcE5hbWVcbiAgICAgIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIG1vZGVsIGNsYXNzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbENsYXNzIHwgbnVsbH0gLSBUYXJnZXQgcmVsYXRpb25zaGlwIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIHJlbGF0aW9uc2hpcE1vZGVsQ2xhc3MocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcE1vZGVsQ2xhc3NlcyA9IHRoaXMucmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzKClcbiAgICBjb25zdCB2YWx1ZSA9IHJlbGF0aW9uc2hpcE1vZGVsQ2xhc3Nlc1tyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgcmV0dXJuIEZyb250ZW5kTW9kZWxCYXNlLnJlc29sdmVNb2RlbENsYXNzKHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge0F0dHJpYnV0ZXN9IC0gQXR0cmlidXRlcyBoYXNoLlxuICAgKi9cbiAgYXR0cmlidXRlcygpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtBdHRyaWJ1dGVzfSAqLyAodGhpcy5fYXR0cmlidXRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIG5ldyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBtb2RlbCBoYXMgbm90IHlldCBiZWVuIHBlcnNpc3RlZC5cbiAgICovXG4gIGlzTmV3UmVjb3JkKCkge1xuICAgIHJldHVybiB0aGlzLl9pc05ld1JlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgcGVyc2lzdGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgbW9kZWwgaGFzIGJlZW4gcGVyc2lzdGVkLlxuICAgKi9cbiAgaXNQZXJzaXN0ZWQoKSB7XG4gICAgcmV0dXJuICF0aGlzLmlzTmV3UmVjb3JkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBpcyBuZXcgcmVjb3JkLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld0lzTmV3UmVjb3JkIC0gTmV3IHBlcnNpc3RlZC1zdGF0ZSBmbGFnLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldElzTmV3UmVjb3JkKG5ld0lzTmV3UmVjb3JkKSB7XG4gICAgdGhpcy5faXNOZXdSZWNvcmQgPSBuZXdJc05ld1JlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIHRoaXMgcmVjb3JkIGZvciBkZXN0cnVjdGlvbiB3aGVuIGl0cyBwYXJlbnQgaXMgbmV4dCBzYXZlZCB0aHJvdWdoXG4gICAqIG5lc3RlZC1hdHRyaWJ1dGUgc3VwcG9ydC4gVGhlIHJlY29yZCBpcyBub3QgcmVtb3ZlZCBmcm9tIHRoZSBwYXJlbnQnc1xuICAgKiByZWxhdGlvbnNoaXAgY29sbGVjdGlvbiB1bnRpbCB0aGUgc2VydmVyIGNvbmZpcm1zIHRoZSBkZWxldGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIG1hcmtGb3JEZXN0cnVjdGlvbigpIHtcbiAgICB0aGlzLl9tYXJrZWRGb3JEZXN0cnVjdGlvbiA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmtlZCBmb3IgZGVzdHJ1Y3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyByZWNvcmQgaXMgcXVldWVkIGZvciBuZXN0ZWQgZGVzdHJ1Y3Rpb24gb24gbmV4dCBwYXJlbnQgc2F2ZS5cbiAgICovXG4gIG1hcmtlZEZvckRlc3RydWN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9tYXJrZWRGb3JEZXN0cnVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2hhbmdlcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gQ2hhbmdlZCBhdHRyaWJ1dGVzIGFzIGBbb2xkVmFsdWUsIG5ld1ZhbHVlXWAuXG4gICAqL1xuICBjaGFuZ2VzKCkge1xuICAgIC8qKlxuICAgICAqIENoYW5nZWQgYXR0cmlidXRlcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCBjaGFuZ2VkQXR0cmlidXRlcyA9IHt9XG4gICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBuZXcgU2V0KFtcbiAgICAgIC4uLk9iamVjdC5rZXlzKHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXMpLFxuICAgICAgLi4uT2JqZWN0LmtleXModGhpcy5fYXR0cmlidXRlcylcbiAgICBdKVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIGF0dHJpYnV0ZU5hbWVzKSB7XG4gICAgICBjb25zdCBwcmV2aW91c1ZhbHVlID0gdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuICAgICAgY29uc3QgY3VycmVudFZhbHVlID0gdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuXG4gICAgICBpZiAoSlNPTi5zdHJpbmdpZnkoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHByZXZpb3VzVmFsdWUpKSAhPT0gSlNPTi5zdHJpbmdpZnkoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGN1cnJlbnRWYWx1ZSkpKSB7XG4gICAgICAgIGNoYW5nZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gW3ByZXZpb3VzVmFsdWUsIGN1cnJlbnRWYWx1ZV1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gY2hhbmdlZEF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGNoYW5nZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYW55IHRyYWNrZWQgYXR0cmlidXRlIGhhcyBjaGFuZ2VkLlxuICAgKi9cbiAgaXNDaGFuZ2VkKCkge1xuICAgIHJldHVybiBPYmplY3Qua2V5cyh0aGlzLmNoYW5nZXMoKSkubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcCBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gLSBSZWxhdGlvbnNoaXAgc3RhdGUgb2JqZWN0LlxuICAgKi9cbiAgZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBpZiAoIXRoaXMuX3JlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV0pIHtcbiAgICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcERlZmluaXRpb24gPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcERlZmluaXRpb24ocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcE1vZGVsQ2xhc3MocmVsYXRpb25zaGlwTmFtZSlcblxuICAgICAgaWYgKHJlbGF0aW9uc2hpcERlZmluaXRpb24gJiYgcmVsYXRpb25zaGlwVHlwZUlzQ29sbGVjdGlvbihyZWxhdGlvbnNoaXBEZWZpbml0aW9uLnR5cGUpKSB7XG4gICAgICAgIHRoaXMuX3JlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV0gPSBuZXcgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXAodGhpcywgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzcylcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuX3JlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV0gPSBuZXcgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwKHRoaXMsIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3MpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3JlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50IGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxBdHRhY2htZW50SGFuZGxlfSAtIEF0dGFjaG1lbnQgaGVscGVyLlxuICAgKi9cbiAgZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24oYXR0YWNobWVudE5hbWUpXG5cbiAgICBpZiAoIWF0dGFjaG1lbnREZWZpbml0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gYXR0YWNobWVudDogJHtNb2RlbENsYXNzLm5hbWV9IyR7YXR0YWNobWVudE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXSkge1xuICAgICAgdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdID0gbmV3IEZyb250ZW5kTW9kZWxBdHRhY2htZW50SGFuZGxlKHtcbiAgICAgICAgYXR0YWNobWVudE5hbWUsXG4gICAgICAgIG1vZGVsOiB0aGlzXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZE1vZGVsQmFzZSB8IEFycmF5PEZyb250ZW5kTW9kZWxCYXNlPiB8IG51bGw+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqL1xuICBhc3luYyBsb2FkUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgaWQgPSB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpXG4gICAgY29uc3QgcmVsb2FkZWRNb2RlbCA9IGF3YWl0IE1vZGVsQ2xhc3NcbiAgICAgIC5wcmVsb2FkKFtyZWxhdGlvbnNoaXBOYW1lXSlcbiAgICAgIC5maW5kKGlkKVxuICAgIGNvbnN0IHNvdXJjZVJlbGF0aW9uc2hpcCA9IHJlbG9hZGVkTW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgY29uc3QgdGFyZ2V0UmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGNvcHlMb2FkZWRSZWxhdGlvbnNoaXBWYWx1ZSh7c291cmNlUmVsYXRpb25zaGlwLCB0YXJnZXRSZWxhdGlvbnNoaXB9KVxuXG4gICAgcmV0dXJuIHRhcmdldFJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFByZWxvYWRzIHJlbGF0aW9uc2hpcChzKSBvbnRvIHRoaXMgYWxyZWFkeS1sb2FkZWQgcmVjb3JkLiBBY2NlcHRzIGVpdGhlciBhXG4gICAqIHF1ZXJ5IGJ1aWx0IHZpYSBgTW9kZWwucHJlbG9hZCguLi4pLnNlbGVjdCguLi4pYCBvciBhIHJhdyBwcmVsb2FkIHNwZWNcbiAgICogKHN0cmluZyAvIGFycmF5IC8gbmVzdGVkIG9iamVjdCkuIFJlbGF0aW9uc2hpcHMgYWxyZWFkeSBwcmVsb2FkZWQgd2l0aCB0aGVcbiAgICogcmVxdWlyZWQgY29sdW1ucyBwcmVzZW50IGFyZSBsZWZ0IHVudG91Y2hlZCB1bmxlc3MgYGZvcmNlYCBpcyBzZXQuIENhcnJpZXNcbiAgICogdGhlIHF1ZXJ5J3MgcHJlbG9hZCBncmFwaCwgc2VsZWN0LCBzZWxlY3RzRXh0cmEsIHdpdGhDb3VudCwgYWJpbGl0aWVzLCBhbmRcbiAgICogcXVlcnlEYXRhIHdoZW4gcmUtZmV0Y2hpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PEZyb250ZW5kTW9kZWxDbGFzcz4gfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHF1ZXJ5T3JTcGVjIC0gUHJlbG9hZCBzb3VyY2UuXG4gICAqIEBwYXJhbSB7e2ZvcmNlPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcHJlbG9hZGluZyBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBwcmVsb2FkKHF1ZXJ5T3JTcGVjLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCBGcm9udGVuZE1vZGVsUHJlbG9hZGVyLnByZWxvYWQoW3RoaXNdLCBxdWVyeU9yU3BlYywgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBvciBsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZE1vZGVsQmFzZSB8IEFycmF5PEZyb250ZW5kTW9kZWxCYXNlPiB8IG51bGw+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqL1xuICBhc3luYyByZWxhdGlvbnNoaXBPckxvYWQocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAocmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSB7XG4gICAgICByZXR1cm4gcmVsYXRpb25zaGlwLmxvYWRlZCgpXG4gICAgfVxuXG4gICAgY29uc3QgYmF0Y2hlZCA9IGF3YWl0IHRoaXMuX3RyeUNvaG9ydFByZWxvYWQocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChiYXRjaGVkKSByZXR1cm4gcmVsYXRpb25zaGlwLmxvYWRlZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUpXG4gIH1cblxuICAvKipcbiAgICogQXR0ZW1wdHMgdG8gYmF0Y2gtbG9hZCBgcmVsYXRpb25zaGlwTmFtZWAgYWNyb3NzIGNvaG9ydCBzaWJsaW5ncyB2aWEgYVxuICAgKiBzaW5nbGUgYHByZWxvYWQoW25hbWVdKS53aGVyZSh7cGs6IFtpZHNdfSkudG9BcnJheSgpYCByZXF1ZXN0LCB0aGVuIGNvcGllc1xuICAgKiB0aGUgcHJlbG9hZGVkIHJlbGF0aW9uc2hpcCBzdGF0ZSBvbnRvIGVhY2ggc2libGluZy4gUmV0dXJucyB0cnVlIHdoZW4gYVxuICAgKiBiYXRjaCByYW4sIGZhbHNlIHdoZW4gYXV0b2xvYWQgaXMgb2ZmLCB0aGVyZSBpcyBubyBjb2hvcnQsIG9yIG5vIGJhdGNoXG4gICAqIGNhbmRpZGF0ZXMgcmVtYWluLiBTaWJsaW5ncyB3aG9zZSByZWxhdGlvbnNoaXAgc3RhdGUgaXMgYWxyZWFkeSBzZXRcbiAgICogKHByZWxvYWRlZCBvciBsb2NhbGx5IG1hbmlwdWxhdGVkIHZpYSBgYnVpbGRgIC8gYHNldFJlbGF0aW9uc2hpcGApIGFyZVxuICAgKiBza2lwcGVkIHNvIHRoZWlyIGNhY2hlZC9lZGl0ZWQgdmFsdWUgaXMgcHJlc2VydmVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGEgY29ob3J0IGJhdGNoIHByZWxvYWQgcmFuLlxuICAgKi9cbiAgYXN5bmMgX3RyeUNvaG9ydFByZWxvYWQocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGlmICghRnJvbnRlbmRNb2RlbEJhc2UuZ2V0QXV0b2xvYWQoKSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgY29ob3J0ID0gdGhpcy5fbG9hZENvaG9ydFxuXG4gICAgaWYgKCFjb2hvcnQgfHwgY29ob3J0Lmxlbmd0aCA8PSAxKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcERlZmluaXRpb24ocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmICghZGVmaW5pdGlvbikgcmV0dXJuIGZhbHNlXG4gICAgaWYgKGRlZmluaXRpb24uYXV0b2xvYWQgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcblxuICAgIC8qKlxuICAgICAqIEJhdGNoLlxuICAgICAqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsQmFzZT59ICovXG4gICAgY29uc3QgYmF0Y2ggPSBbXVxuXG4gICAgLy8gRXhhY3Qgc2FtZSBjbGFzcywgcGVyc2lzdGVkLCBubyBleGlzdGluZyBpbi1tZW1vcnkgcmVsYXRpb25zaGlwIHN0YXRlLlxuICAgIC8vIGBzZXRMb2FkZWRgIHNldHMgYF9wcmVsb2FkZWQgPSB0cnVlYCBvbiBldmVyeSBtdXRhdGlvbiBwYXRoIChwcmVsb2FkLFxuICAgIC8vIHNldFJlbGF0aW9uc2hpcCwgYnVpbGQsIGFkZFRvTG9hZGVkKSwgc28gYGdldFByZWxvYWRlZCgpYCBhbG9uZSBpcyBhXG4gICAgLy8gcmVsaWFibGUgXCJhbHJlYWR5IHRvdWNoZWRcIiBzaWduYWwgb24gdGhlIGZyb250ZW5kLlxuICAgIGZvciAoY29uc3Qgc2libGluZyBvZiBjb2hvcnQpIHtcbiAgICAgIGlmIChzaWJsaW5nLmNvbnN0cnVjdG9yICE9PSBNb2RlbENsYXNzKSBjb250aW51ZVxuICAgICAgaWYgKHNpYmxpbmcuaXNOZXdSZWNvcmQoKSkgY29udGludWVcblxuICAgICAgY29uc3Qgc2libGluZ1JlbGF0aW9uc2hpcCA9IHNpYmxpbmcuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgIGlmIChzaWJsaW5nUmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSBjb250aW51ZVxuXG4gICAgICBiYXRjaC5wdXNoKHNpYmxpbmcpXG4gICAgfVxuXG4gICAgaWYgKGJhdGNoLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcblxuICAgIGlmIChBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IGJhdGNoSWRzID0gYmF0Y2gubWFwKChzaWJsaW5nKSA9PiBzaWJsaW5nLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIGNvbnN0IHJlbG9hZGVkQmF0Y2ggPSBhd2FpdCBNb2RlbENsYXNzXG4gICAgICAucHJlbG9hZChbcmVsYXRpb25zaGlwTmFtZV0pXG4gICAgICAud2hlcmUoe1twcmltYXJ5S2V5XTogYmF0Y2hJZHN9KVxuICAgICAgLnRvQXJyYXkoKVxuXG4gICAgLyoqXG4gICAgICogUmVsb2FkZWQgYnkgaWQuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIEZyb250ZW5kTW9kZWxCYXNlPn0gKi9cbiAgICBjb25zdCByZWxvYWRlZEJ5SWQgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgcmVsb2FkZWQgb2YgcmVsb2FkZWRCYXRjaCkge1xuICAgICAgcmVsb2FkZWRCeUlkLnNldChtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCByZWxvYWRlZC5wcmltYXJ5S2V5VmFsdWUoKSksIHJlbG9hZGVkKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc2libGluZyBvZiBiYXRjaCkge1xuICAgICAgY29uc3Qga2V5ID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgc2libGluZy5wcmltYXJ5S2V5VmFsdWUoKSlcbiAgICAgIGNvbnN0IHJlbG9hZGVkID0gcmVsb2FkZWRCeUlkLmdldChrZXkpXG5cbiAgICAgIGlmICghcmVsb2FkZWQpIGNvbnRpbnVlXG5cbiAgICAgIGNvcHlMb2FkZWRSZWxhdGlvbnNoaXBWYWx1ZSh7XG4gICAgICAgIHNvdXJjZVJlbGF0aW9uc2hpcDogcmVsb2FkZWQuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpLFxuICAgICAgICB0YXJnZXRSZWxhdGlvbnNoaXA6IHNpYmxpbmcuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICB9KVxuICAgIH1cblxuICAgIC8vIElmIHRoZSBjYWxsZXIgaXRzZWxmIHdhcyBub3QgcG9wdWxhdGVkIChyZWNvcmQgZGVsZXRlZC9maWx0ZXJlZCBiZXR3ZWVuXG4gICAgLy8gdGhlIGxpc3QgZmV0Y2ggYW5kIHRoaXMgcHJlbG9hZCByZXF1ZXN0KSwgZmFsbCBiYWNrIHRvIHBlci1yZWNvcmQgbG9hZFxuICAgIC8vIHNvIHRoZSBjYWxsZXIgZ2V0cyBhIHJlYWwgbm90LWZvdW5kIGVycm9yIGluc3RlYWQgb2YgYSBtaXNsZWFkaW5nXG4gICAgLy8gXCJoYXNuJ3QgYmVlbiBwcmVsb2FkZWRcIiB0aHJvdyBmcm9tIGxvYWRlZCgpLlxuICAgIGlmICghdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkuZ2V0UHJlbG9hZGVkKCkpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2UgfCBudWxsIHwgdW5kZWZpbmVkfSByZWxhdGlvbnNoaXBWYWx1ZSAtIFJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxCYXNlIHwgbnVsbCB8IHVuZGVmaW5lZH0gLSBBc3NpZ25lZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqL1xuICBzZXRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwVmFsdWUpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwRGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXBEZWZpbml0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcmVsYXRpb25zaGlwOiAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChyZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3Qgc2V0IGhhcy1tYW55IHJlbGF0aW9uc2hpcCB3aXRoIHNldFJlbGF0aW9uc2hpcCgpOiAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgcmVsYXRpb25zaGlwLnNldExvYWRlZChyZWxhdGlvbnNoaXBWYWx1ZSlcblxuICAgIHJldHVybiByZWxhdGlvbnNoaXBWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXNzaWduIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7QXR0cmlidXRlcyB8IENyZWF0ZUF0dHJpYnV0ZXMgfCBVcGRhdGVBdHRyaWJ1dGVzIHwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gYXR0cmlidXRlcyAtIEF0dHJpYnV0ZXMgdG8gYXNzaWduLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhc3NpZ25BdHRyaWJ1dGVzKGF0dHJpYnV0ZXMpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVWYWx1ZXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChhdHRyaWJ1dGVzKVxuXG4gICAgZm9yIChjb25zdCBrZXkgaW4gYXR0cmlidXRlVmFsdWVzKSB7XG4gICAgICB0aGlzLnNldEF0dHJpYnV0ZShrZXksIGF0dHJpYnV0ZVZhbHVlc1trZXldKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFyIHJlbGF0aW9uc2hpcCBjYWNoZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gQ2xlYXJzIGNhY2hlZCByZWxhdGlvbnNoaXAgc3RhdGUuXG4gICAqL1xuICBjbGVhclJlbGF0aW9uc2hpcENhY2hlKCkge1xuICAgIHRoaXMuX3JlbGF0aW9uc2hpcHMgPSB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbWFyeSBrZXkuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSAtIFByaW1hcnkga2V5IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gdGhpcy5yZXNvdXJjZUNvbmZpZygpLnByaW1hcnlLZXkgfHwgXCJpZFwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmltYXJ5IGtleSB2YWx1ZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSAtIFByaW1hcnkga2V5IHZhbHVlLlxuICAgKi9cbiAgcHJpbWFyeUtleVZhbHVlKCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcblxuICAgIHJldHVybiByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUocHJpbWFyeUtleSwgKGF0dHJpYnV0ZU5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gdGhpcy5yZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBwcmltYXJ5IGtleSAnJHthdHRyaWJ1dGVOYW1lfScgb24gJHtNb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHZhbHVlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBzY2FsYXIgaWRlbnRpdHkgcmVxdWlyZWQgYnkgc2NhbGFyLW9ubHkgZnJvbnRlbmQgZmVhdHVyZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRpb24gLSBPcGVyYXRpb24gcmVxdWlyaW5nIGEgc2NhbGFyIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5U2NhbGFyfSAtIFNjYWxhciBwcmltYXJ5LWtleSB2YWx1ZS5cbiAgICovXG4gIHNjYWxhclByaW1hcnlLZXlWYWx1ZShvcGVyYXRpb24pIHtcbiAgICByZXR1cm4gc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUodGhpcy5wcmltYXJ5S2V5VmFsdWUoKSwgb3BlcmF0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGlkZW50aXR5IHJlcHJlc2VudGVkIGJ5IHRoZSBsYXN0IHBlcnNpc3RlZCBmcm9udGVuZCBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IC0gUGVyc2lzdGVkIHByaW1hcnkta2V5IHZhbHVlLlxuICAgKi9cbiAgcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcblxuICAgIHJldHVybiByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUocHJpbWFyeUtleSwgKGF0dHJpYnV0ZU5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuXG4gICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgcGVyc2lzdGVkIHByaW1hcnkga2V5ICcke2F0dHJpYnV0ZU5hbWV9JyBvbiAke01vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdmFsdWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBBdHRyaWJ1dGUgdmFsdWUuXG4gICAqL1xuICByZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAodGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzICYmICF0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMuaGFzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgQXR0cmlidXRlTm90U2VsZWN0ZWRFcnJvcih0aGlzLmNvbnN0cnVjdG9yLm5hbWUsIGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGFuIGF0dHJpYnV0ZSB2YWx1ZSBpcyBjdXJyZW50bHkgbG9hZGVkIG9uIHRoaXMgcmVjb3JkLiBVc2VkIGJ5IHRoZVxuICAgKiBwcmVsb2FkZXIgdG8gZGVjaWRlIHdoZXRoZXIgYSByZWxhdGlvbnNoaXAgY2FuIGJlIHNraXBwZWQgYmVjYXVzZSB0aGVcbiAgICogcmVxdWVzdGVkIGNvbHVtbnMgYXJlIGFscmVhZHkgcHJlc2VudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgYXR0cmlidXRlIGlzIGxvYWRlZC5cbiAgICovXG4gIGhhc0xvYWRlZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSB7XG4gICAgaWYgKCF0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gdGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzLmhhcyhhdHRyaWJ1dGVOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgYW4gYXNzb2NpYXRpb24gY291bnQgYXR0YWNoZWQgYnkgYC53aXRoQ291bnQoLi4uKWAuIENvdW50c1xuICAgKiBsaXZlIG9uIGEgZGVkaWNhdGVkIG1hcCBzZXBhcmF0ZSBmcm9tIHRoZSByZWNvcmQncyBhdHRyaWJ1dGVzIHNvXG4gICAqIGEgdmlydHVhbCBjb3VudCBsaWtlIGB0YXNrc0NvdW50YCBjYW4ndCBzaWxlbnRseSBzaGFkb3cgYSByZWFsXG4gICAqIGNvbHVtbiBvZiB0aGUgc2FtZSBuYW1lLiBSZXR1cm5zIHRoZSBhdHRhY2hlZCB2YWx1ZSwgb3IgMCB3aGVuXG4gICAqIGAud2l0aENvdW50KC4uLilgIHdhc24ndCByZXF1ZXN0ZWQgZm9yIHRoaXMgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLCBlLmcuIGBcInRhc2tzQ291bnRcImAgb3IgYSBjdXN0b20gbmFtZSBmcm9tIGAud2l0aENvdW50KHtjdXN0b21OYW1lOiB7Li4ufX0pYC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBBdHRhY2hlZCBhc3NvY2lhdGlvbiBjb3VudCwgb3IgemVybyB3aGVuIGFic2VudC5cbiAgICovXG4gIHJlYWRDb3VudChhdHRyaWJ1dGVOYW1lKSB7XG4gICAgcmV0dXJuIHJlYWRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBzZXR0ZXIgY2FsbGVkIGJ5IGBpbnN0YW50aWF0ZUZyb21SZXNwb25zZWAgd2hlbiBoeWRyYXRpbmdcbiAgICogYXNzb2NpYXRpb24gY291bnRzIHRoYXQgcm9kZSBhbG9uZyB3aXRoIHRoZSByZWNvcmQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gQ291bnQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldEFzc29jaWF0aW9uQ291bnQoYXR0cmlidXRlTmFtZSwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYXR0cmlidXRlTmFtZSwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhIHBlci1yZWNvcmQgYWJpbGl0eSByZXN1bHQgYXR0YWNoZWQgYnkgYC5hYmlsaXRpZXMoLi4uKWAuIFRoZVxuICAgKiBiYWNrZW5kIGV2YWx1YXRlcyBlYWNoIHJlcXVlc3RlZCBhY3Rpb24gYWdhaW5zdCB0aGUgY3VycmVudFxuICAgKiBhYmlsaXR5IGZvciB0aGlzIHJlY29yZCBpbnN0YW5jZSBhbmQgc2hpcHMgdGhlIHJlc3VsdCBhbG9uZ3NpZGVcbiAgICogdGhlIHJlY29yZCdzIGF0dHJpYnV0ZXMuIFJldHVybnMgYGZhbHNlYCB3aGVuIHRoZSBhY3Rpb24gd2Fzbid0XG4gICAqIHJlcXVlc3RlZCAob3IgdGhlIGFiaWxpdHkgZGVuaWVkIGl0KSwgc28gVUkgY29kZSBjYW4gc2FmZWx5IGJyYW5jaFxuICAgKiBvbiBgcmVjb3JkLmNhbihcInVwZGF0ZVwiKWAgd2l0aG91dCBmaXJzdCBjaGVja2luZyB3aGV0aGVyIHRoZVxuICAgKiBhYmlsaXR5IHdhcyBsb2FkZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbiBuYW1lLCBlLmcuIGBcInVwZGF0ZVwiYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVxdWVzdGVkIGFiaWxpdHkgaXMgYWxsb3dlZC5cbiAgICovXG4gIGNhbihhY3Rpb24pIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRDb21wdXRlZEFiaWxpdHkoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGFjdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBzZXR0ZXIgY2FsbGVkIGJ5IGBpbnN0YW50aWF0ZUZyb21SZXNwb25zZWAgd2hlbiBoeWRyYXRpbmdcbiAgICogcGVyLXJlY29yZCBhYmlsaXR5IHJlc3VsdHMgdGhhdCByb2RlIGFsb25nIHdpdGggdGhlIHJlY29yZFxuICAgKiBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24gbmFtZS5cbiAgICogQHBhcmFtIHtib29sZWFufSB2YWx1ZSAtIFdoZXRoZXIgdGhlIGN1cnJlbnQgYWJpbGl0eSBwZXJtaXRzIHRoZSBhY3Rpb24gb24gdGhpcyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldENvbXB1dGVkQWJpbGl0eShhY3Rpb24sIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZENvbXB1dGVkQWJpbGl0eSgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYWN0aW9uLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGEgY29uc3VtZXItZGVmaW5lZCB2YWx1ZSBhdHRhY2hlZCBieSBgLnF1ZXJ5RGF0YSguLi4pYC4gU3RvcmVkXG4gICAqIG9uIGEgZGVkaWNhdGVkIG1hcCByYXRoZXIgdGhhbiBgX2F0dHJpYnV0ZXNgLCBzbyBhIHZpcnR1YWwgYWxpYXNcbiAgICogbGlrZSBgdGFza3NDb3VudGAgY2Fubm90IHNpbGVudGx5IHNoYWRvdyBhIHJlYWwgY29sdW1uIG9mIHRoZSBzYW1lXG4gICAqIG5hbWUuIFJldHVybnMgYG51bGxgIHdoZW4gbm8gcmVnaXN0ZXJlZCBmbiBwcm9kdWNlZCB0aGF0IGFsaWFzIGZvclxuICAgKiB0aGlzIHJlY29yZCAoZS5nLiBubyBjaGlsZCByb3dzIG1hdGNoZWQgdGhlIGFnZ3JlZ2F0ZSkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gcXVlcnlEYXRhIGFsaWFzIG5hbWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBBdHRhY2hlZCBxdWVyeS1kYXRhIHZhbHVlLlxuICAgKi9cbiAgcXVlcnlEYXRhKG5hbWUpIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRRdWVyeURhdGEoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogSW50ZXJuYWwgc2V0dGVyIHVzZWQgYnkgYGluc3RhbnRpYXRlRnJvbVJlc3BvbnNlYCB3aGVuIGh5ZHJhdGluZ1xuICAgKiBxdWVyeURhdGEgdmFsdWVzIHRoYXQgcm9kZSBhbG9uZyB3aXRoIHRoZSByZWNvcmQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBxdWVyeURhdGEgYWxpYXMgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBBdHRhY2hlZCB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0UXVlcnlEYXRhKG5hbWUsIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZFF1ZXJ5RGF0YSgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgbmFtZSwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBuZXdWYWx1ZSAtIE5ldyB2YWx1ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEFzc2lnbmVkIHZhbHVlLlxuICAgKi9cbiAgc2V0QXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUsIG5ld1ZhbHVlKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lID0gTW9kZWxDbGFzcy5uZXN0ZWRBdHRyaWJ1dGVzUmVsYXRpb25zaGlwTmFtZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgaWYgKG5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgICB0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlc1tuZXN0ZWRBdHRyaWJ1dGVzUmVsYXRpb25zaGlwTmFtZV0gPSBuZXdWYWx1ZVxuICAgICAgcmV0dXJuIG5ld1ZhbHVlXG4gICAgfVxuXG4gICAgaWYgKE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24oYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIHRoaXMuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRyaWJ1dGVOYW1lKS5xdWV1ZUF0dGFjaChuZXdWYWx1ZSlcbiAgICAgIHJldHVybiBuZXdWYWx1ZVxuICAgIH1cblxuICAgIGNvbnN0IHByZXZpb3VzVmFsdWUgPSB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gbmV3VmFsdWVcblxuICAgIGlmICh0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgIHRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcy5hZGQoYXR0cmlidXRlTmFtZSlcbiAgICB9XG5cbiAgICAvLyBPbmx5IGludmFsaWRhdGUgcmVsYXRpb25zaGlwIGNhY2hlIGVudHJpZXMgd2hvc2UgZm9yZWlnbiBrZXkgbWF0Y2hlcyB0aGUgY2hhbmdlZCBhdHRyaWJ1dGUuXG4gICAgLy8gQmxhbmtldC1jbGVhcmluZyBhbGwgcmVsYXRpb25zaGlwcyBvbiBhbnkgYXR0cmlidXRlIGNoYW5nZSBkZXN0cm95cyBuZXN0ZWQtc2F2ZSBzdGF0ZVxuICAgIC8vIGFuZCBwcmVsb2FkZWQgY2hpbGRyZW4gdGhlIGNhbGxlciBuZXZlciBhc2tlZCB0byBpbnZhbGlkYXRlLlxuICAgIGlmICghT2JqZWN0LmlzKHByZXZpb3VzVmFsdWUsIG5ld1ZhbHVlKSkge1xuICAgICAgdGhpcy5faW52YWxpZGF0ZVJlbGF0aW9uc2hpcHNGb3JBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3VmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnZhbGlkYXRlcyBhbnkgY2FjaGVkIGJlbG9uZ3NUbyByZWxhdGlvbnNoaXAgd2hvc2UgZm9yZWlnbiBrZXkgbWF0Y2hlcyB0aGVcbiAgICogY2hhbmdlZCBhdHRyaWJ1dGUuIEhhc01hbnkgLyBoYXNPbmUgcmVsYXRpb25zaGlwcyBhcmUgbGVmdCB1bnRvdWNoZWQgYmVjYXVzZVxuICAgKiB0aGVpciBmb3JlaWduIGtleSBsaXZlcyBvbiB0aGUgY2hpbGQsIG5vdCBvbiB0aGlzIG1vZGVsLCBhbmQgYmxhbmtldC1jbGVhcmluZ1xuICAgKiB0aGVtIHdvdWxkIGRlc3Ryb3kgbmVzdGVkLXNhdmUgc3RhdGUgYW5kIHByZWxvYWRlZCBjaGlsZHJlbiB0aGUgY2FsbGVyIG5ldmVyXG4gICAqIGFza2VkIHRvIGludmFsaWRhdGUuXG4gICAqXG4gICAqIEZvcmVpZ24ga2V5cyBhcmUgaW5mZXJyZWQgd2hlbiBub3QgZGVjbGFyZWQ6IGZvciBiZWxvbmdzVG8gYHByb2plY3RJZGAgaXNcbiAgICogaW5mZXJyZWQgZnJvbSByZWxhdGlvbnNoaXAgbmFtZSBgcHJvamVjdGAuIEV4cGxpY2l0IGBmb3JlaWduS2V5YCBvbiB0aGVcbiAgICogcmVsYXRpb25zaGlwIGRlZmluaXRpb24gdGFrZXMgcHJlY2VkZW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZSB0aGF0IGNoYW5nZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2ludmFsaWRhdGVSZWxhdGlvbnNoaXBzRm9yQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAoIXRoaXMuX3JlbGF0aW9uc2hpcHMgfHwgT2JqZWN0LmtleXModGhpcy5fcmVsYXRpb25zaGlwcykubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBkZWZpbml0aW9ucyA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbnMoKVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKHRoaXMuX3JlbGF0aW9uc2hpcHMpKSB7XG4gICAgICBjb25zdCBkZWZpbml0aW9uID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGRlZmluaXRpb25zW3JlbGF0aW9uc2hpcE5hbWVdKVxuXG4gICAgICBpZiAoIWRlZmluaXRpb24gfHwgZGVmaW5pdGlvbi50eXBlICE9PSBcImJlbG9uZ3NUb1wiKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBmb3JlaWduS2V5ID0gZGVmaW5pdGlvbi5mb3JlaWduS2V5IHx8IGAke3JlbGF0aW9uc2hpcE5hbWV9SWRgXG5cbiAgICAgIGlmIChmb3JlaWduS2V5ID09PSBhdHRyaWJ1dGVOYW1lKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgcGF0aC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEZXJpdmVkIHJlc291cmNlIHBhdGguXG4gICAqL1xuICBzdGF0aWMgcmVzb3VyY2VQYXRoKCkge1xuICAgIHJldHVybiB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgoe1xuICAgICAgbW9kZWxOYW1lOiB0aGlzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgcmVzb3VyY2VQYXRoOiBkZWZhdWx0RnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aCh0aGlzKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb21tYW5kIG5hbWUuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENvbW1hbmRUeXBlfSBjb21tYW5kVHlwZSAtIENvbW1hbmQgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBSZXNvbHZlZCBjb21tYW5kIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgY29tbWFuZE5hbWUoY29tbWFuZFR5cGUpIHtcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IHRoaXMucmVzb3VyY2VDb25maWcoKVxuICAgIGNvbnN0IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgPSByZXNvdXJjZUNvbmZpZy5idWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzIHx8IFtdXG4gICAgY29uc3QgYnVpbHRJbk1lbWJlckNvbW1hbmRzID0gcmVzb3VyY2VDb25maWcuYnVpbHRJbk1lbWJlckNvbW1hbmRzIHx8IFtdXG4gICAgY29uc3QgY29tbWFuZHMgPSByZXNvdXJjZUNvbmZpZy5jb21tYW5kcyB8fCBbXVxuICAgIGNvbnN0IGlzRXhwb3NlZCA9IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMuaW5jbHVkZXMoY29tbWFuZFR5cGUpIHx8IGJ1aWx0SW5NZW1iZXJDb21tYW5kcy5pbmNsdWRlcyhjb21tYW5kVHlwZSkgfHwgY29tbWFuZHMuaW5jbHVkZXMoY29tbWFuZFR5cGUpXG4gICAgY29uc3QgY29tbWFuZE5hbWUgPSBpc0V4cG9zZWQgPyBpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUoY29tbWFuZFR5cGUpKSA6IGNvbW1hbmRUeXBlXG5cbiAgICByZXR1cm4gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kTmFtZSh7XG4gICAgICBjb21tYW5kTmFtZSxcbiAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgbW9kZWxOYW1lOiB0aGlzLmdldE1vZGVsTmFtZSgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBjdXN0b20gY29tbWFuZCBwYXlsb2FkIGFyZ3VtZW50cy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MgLSBDb21tYW5kIGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDb21tYW5kIHBheWxvYWQuXG4gICAqL1xuICBzdGF0aWMgbm9ybWFsaXplQ3VzdG9tQ29tbWFuZFBheWxvYWRBcmd1bWVudHMoYXJncykge1xuICAgIGlmIChhcmdzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG4gICAgaWYgKGFyZ3MubGVuZ3RoID09PSAxKSB7XG4gICAgICBjb25zdCBwYXlsb2FkID0gYXJnc1swXVxuICAgICAgaWYgKHBheWxvYWQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4ge31cbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVvZiBwYXlsb2FkICE9PSBcIm9iamVjdFwiIHx8IHBheWxvYWQgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIHthcmcxOiBwYXlsb2FkfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChwYXlsb2FkKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFBheWxvYWQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlciB8IHN0cmluZyB8IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgY29uc3QgcGF5bG9hZCA9IHt9XG5cbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgYXJncy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgIHBheWxvYWRbYGFyZyR7aW5kZXggKyAxfWBdID0gYXJnc1tpbmRleF1cbiAgICB9XG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIG1vZGVsIG5hbWUsIHByZWZlcnJpbmcgYW4gZXhwbGljaXQgYHN0YXRpYyBtb2RlbE5hbWVgIGRlY2xhcmF0aW9uXG4gICAqIG92ZXIgdGhlIEphdmFTY3JpcHQgY2xhc3MgYC5uYW1lYCBwcm9wZXJ0eS4gVGhpcyBhbGxvd3MgbWluaWZpZWQgYnVpbGRzIHRvXG4gICAqIHByZXNlcnZlIGNvcnJlY3QgbW9kZWwgbmFtZXMgd2l0aG91dCByZWx5aW5nIG9uIGBrZWVwX2NsYXNzbmFtZXNgLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBtb2RlbCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldE1vZGVsTmFtZSgpIHtcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IHRoaXMucmVzb3VyY2VDb25maWcoKVxuICAgIGNvbnN0IG1vZGVsTmFtZSA9IHJlc291cmNlQ29uZmlnPy5tb2RlbE5hbWVcblxuICAgIHJldHVybiAodHlwZW9mIG1vZGVsTmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBtb2RlbE5hbWUubGVuZ3RoID4gMCkgPyBtb2RlbE5hbWUgOiB0aGlzLm5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbmZpZ3VyZSB0cmFuc3BvcnQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZ30gY29uZmlnIC0gRnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBjb25maWd1cmVUcmFuc3BvcnQoY29uZmlnKSB7XG4gICAgaWYgKCFjb25maWcgfHwgdHlwZW9mIGNvbmZpZyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwidXJsXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnVybCA9IGNvbmZpZy51cmxcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJzaGFyZWRcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2hhcmVkID0gY29uZmlnLnNoYXJlZFxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcIndlYnNvY2tldENsaWVudFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgPSBjb25maWcud2Vic29ja2V0Q2xpZW50XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwid2Vic29ja2V0VXJsXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldFVybCA9IGNvbmZpZy53ZWJzb2NrZXRVcmxcbiAgICAgIC8vIFJlc2V0IGNhY2hlZCBpbnRlcm5hbCBjbGllbnQgc28gdGhlIG5ldyBVUkwgdGFrZXMgZWZmZWN0IG9uIG5leHQgc3Vic2NyaWJlXG4gICAgICByZXNldEludGVybmFsV2Vic29ja2V0Q2xpZW50KClcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJyZXF1ZXN0SGVhZGVyc1wiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0SGVhZGVycyA9IGNvbmZpZy5yZXF1ZXN0SGVhZGVyc1xuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInJlcXVlc3RDb250ZXh0XCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RDb250ZXh0ID0gY29uZmlnLnJlcXVlc3RDb250ZXh0XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwidGltZW91dFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lb3V0ID0gY29uZmlnLnRpbWVvdXRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJzaWduYWxcIikpIHtcbiAgICAgIGlmIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNpZ25hbCAhPT0gY29uZmlnLnNpZ25hbCkge1xuICAgICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNpZ25hbCA9IGNvbmZpZy5zaWduYWxcbiAgICAgICAgcmVzZXRJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwidGltZVpvbmVcIikpIHtcbiAgICAgIGlmIChjb25maWcudGltZVpvbmUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBkZWxldGUgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lWm9uZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lWm9uZSA9IGNvbmZpZy50aW1lWm9uZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInNlc3Npb25TdG9yZVwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zZXNzaW9uU3RvcmUgPSBjb25maWcuc2Vzc2lvblN0b3JlXG4gICAgICAvLyBSZXNldCBjYWNoZWQgaW50ZXJuYWwgY2xpZW50IHNvIHRoZSBuZXcgc2Vzc2lvblN0b3JlIGlzIHBpY2tlZCB1cC5cbiAgICAgIHJlc2V0SW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKVxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcIm9mZmxpbmVTeW5jXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jID0gY29uZmlnLm9mZmxpbmVTeW5jXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3QgdGhlIGludGVybmFsIFdlYlNvY2tldCBhbmQgZW5hYmxlIGF1dG8tcmVjb25uZWN0LlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIsIHNpZ25hbD86IEFib3J0U2lnbmFsfX0gW29wdGlvbnNdIC0gU3RhcnR1cCBjb250cm9scyBjb21wb3NlZCB3aXRoIHRoZSBjb25maWd1cmVkIHRyYW5zcG9ydCBjb250cm9scy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb25uZWN0ZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY29ubmVjdFdlYnNvY2tldChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBjbGllbnQgPSByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKVxuXG4gICAgaWYgKCFjbGllbnQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcImNvbm5lY3RXZWJzb2NrZXQgcmVxdWlyZXMgY29uZmlndXJlVHJhbnNwb3J0KHt3ZWJzb2NrZXRVcmx9KVwiKVxuICAgIH1cblxuICAgIGF3YWl0IGNsaWVudC5jb25uZWN0KGZyb250ZW5kTW9kZWxXZWJzb2NrZXRTdGFydHVwQ29udHJvbHMob3B0aW9ucykpXG4gIH1cblxuICAvKipcbiAgICogRGlzY29ubmVjdCB0aGUgaW50ZXJuYWwgV2ViU29ja2V0IGFuZCBkaXNhYmxlIGF1dG8tcmVjb25uZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsb3NlZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBkaXNjb25uZWN0V2Vic29ja2V0KCkge1xuICAgIGlmICghaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQpIHJldHVyblxuXG4gICAgY29uc3QgY2xpZW50ID0gaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRcblxuICAgIGRldGFjaEludGVybmFsV2Vic29ja2V0Q2xpZW50KGNsaWVudClcbiAgICBhd2FpdCBjbGllbnQuZGlzY29ubmVjdEFuZFN0b3BSZWNvbm5lY3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIHVudGlsIHF1ZXVlZCBhbmQgYWN0aXZlIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCByZXF1ZXN0cyBmaW5pc2guXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbElkbGVXYWl0QXJnc30gW2FyZ3NdIC0gV2FpdCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRyYW5zcG9ydCBpcyBpZGxlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHdhaXRGb3JJZGxlKGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtxdWlldE1zID0gMCwgdGltZW91dDogdGltZW91dE1zID0gNTAwMCwgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuICAgIGNvbnN0IHJlc3RBcmdLZXlzID0gT2JqZWN0LmtleXMocmVzdEFyZ3MpXG5cbiAgICBpZiAocmVzdEFyZ0tleXMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHdhaXRGb3JJZGxlIGFyZ3M6ICR7cmVzdEFyZ0tleXMuam9pbihcIiwgXCIpfWApXG4gICAgfVxuXG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUocXVpZXRNcykgfHwgcXVpZXRNcyA8IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgd2FpdEZvcklkbGUgcXVpZXRNcyB0byBiZSBhIG5vbi1uZWdhdGl2ZSBudW1iZXIsIGdvdDogJHtxdWlldE1zfWApXG4gICAgfVxuXG4gICAgYXdhaXQgdGltZW91dChcbiAgICAgIHt0aW1lb3V0OiB0aW1lb3V0TXMsIGVycm9yTWVzc2FnZTogXCJUaW1lZCBvdXQgd2FpdGluZyBmb3IgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHRvIGJlY29tZSBpZGxlXCJ9LFxuICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgd2FpdEZvckZyb250ZW5kTW9kZWxUcmFuc3BvcnRJZGxlKHF1aWV0TXMpXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGN1cnJlbnQgV2ViU29ja2V0IGNvbm5lY3Rpb24gc3RhdGUuXG4gICAqIEByZXR1cm5zIHt7ZGlzY29ubmVjdGVkU2luY2U6IG51bWJlciB8IG51bGwsIGhhc0NsaWVudDogYm9vbGVhbiwgaXNPcGVuOiBib29sZWFuLCBsaXN0ZW5lckNvdW50OiBudW1iZXJ9fSAtIFNuYXBzaG90IG9mIHRoZSBtYW5hZ2VkIHdlYnNvY2tldCBjb25uZWN0aW9uIHN0YXRlLlxuICAgKi9cbiAgc3RhdGljIHdlYnNvY2tldFN0YXRlKCkge1xuICAgIGlmICghaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQpIHtcbiAgICAgIHJldHVybiB7ZGlzY29ubmVjdGVkU2luY2U6IG51bGwsIGhhc0NsaWVudDogZmFsc2UsIGlzT3BlbjogZmFsc2UsIGxpc3RlbmVyQ291bnQ6IDB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmludGVybmFsV2Vic29ja2V0Q2xpZW50LnN0YXRlKCksXG4gICAgICBoYXNDbGllbnQ6IHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2xvc2UgdGhlIHJhdyBXZWJTb2NrZXQgd2l0aG91dCBkaXNhYmxpbmcgYXV0by1yZWNvbm5lY3QuIFVzZWQgYnkgdGVzdHMgdG9cbiAgICogc2ltdWxhdGUgYW4gdW5leHBlY3RlZCBuZXR3b3JrIGRyb3AgYW5kIHZlcmlmeSByZWNvbm5lY3Rpb24gYmVoYXZpb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNvY2tldCBoYXMgY2xvc2VkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGRyb3BXZWJzb2NrZXQoKSB7XG4gICAgaWYgKCFpbnRlcm5hbFdlYnNvY2tldENsaWVudCkgcmV0dXJuXG5cbiAgICBhd2FpdCBpbnRlcm5hbFdlYnNvY2tldENsaWVudC5kcm9wQ29ubmVjdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogU2V0cyBnbG9iYWwgbWV0YWRhdGEgb24gdGhlIFdlYlNvY2tldCBjb25uZWN0aW9uLiBTZW50IHRvIHRoZSBzZXJ2ZXIgaW1tZWRpYXRlbHlcbiAgICogb3ZlciBXZWJTb2NrZXQgYW5kIGV4cG9zZWQgdG8gV2ViU29ja2V0LWJvcm5lIHJlcXVlc3RzIGFzIHJlcXVlc3QgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBNZXRhZGF0YSBrZXkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gTWV0YWRhdGEgdmFsdWUgKG51bGwgdG8gY2xlYXIpLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBzZXRXZWJzb2NrZXRNZXRhZGF0YShrZXksIHZhbHVlKSB7XG4gICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50IHx8IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpKVxuXG4gICAgaWYgKCFjbGllbnQgfHwgdHlwZW9mIGNsaWVudC5zZXRNZXRhZGF0YSAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm5cblxuICAgIGNsaWVudC5zZXRNZXRhZGF0YShrZXksIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIE9wZW5zIGEgbWFuYWdlZCBjb25uZWN0aW9uIHRoYXQgYXV0by1vcGVucywgYXV0by1jbG9zZXMsIGFuZFxuICAgKiBhdXRvLXJlY29ubmVjdHMgYmFzZWQgb24gYHNob3VsZENvbm5lY3QoKWAgYW5kIGBwYXJhbXMoKWAuXG4gICAqIENhbGwgYGhhbmRsZS5zeW5jKClgIHdoZW5ldmVyIHRoZSBpbnB1dHMgdGhhdCBkcml2ZSB0aG9zZVxuICAgKiBmdW5jdGlvbnMgY2hhbmdlIChlLmcuIGN1cnJlbnQtdXNlciBzaWduLWluL291dCkuIFRoZSBoYW5kbGVcbiAgICogcmV0cmllcyB3aGVuIHRoZSBXUyBjbGllbnQgaXNuJ3QgcmVhZHkgYW5kIHJlb3BlbnMgb24gY2xvc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25uZWN0aW9uVHlwZSAtIENvbm5lY3Rpb24gY2xhc3MgbmFtZSByZWdpc3RlcmVkIG9uIHRoZSBzZXJ2ZXIuXG4gICAqIEBwYXJhbSB7e3Nob3VsZENvbm5lY3Q6ICgpID0+IGJvb2xlYW4sIHBhcmFtczogKCkgPT4gUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzaWduYWw/OiBBYm9ydFNpZ25hbCwgb25NZXNzYWdlPzogKGJvZHk6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiB2b2lkfX0gb3B0aW9ucyAtIENvbm5lY3Rpb24gbGlmZWN5Y2xlLCBjYW5jZWxsYXRpb24sIGFuZCBwYXlsb2FkIGNhbGxiYWNrcy5cbiAgICogQHJldHVybnMge3tzeW5jOiAoKSA9PiB2b2lkLCBjbG9zZTogKCkgPT4gdm9pZH19IC0gSGFuZGxlIHVzZWQgdG8gcmVzeW5jIG9yIGNsb3NlIHRoZSBtYW5hZ2VkIGNvbm5lY3Rpb24uXG4gICAqL1xuICBzdGF0aWMgb3Blbk1hbmFnZWRDb25uZWN0aW9uKGNvbm5lY3Rpb25UeXBlLCBvcHRpb25zKSB7XG4gICAgLyoqXG4gICAgICogQ29ubmVjdGlvbi5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgbGV0IGNvbm5lY3Rpb24gPSBudWxsXG4gICAgbGV0IGNsb3NlZCA9IGZhbHNlXG4gICAgLyoqXG4gICAgICogUmV0cnkgdGltZXIuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gKi9cbiAgICBsZXQgcmV0cnlUaW1lciA9IG51bGxcbiAgICBsZXQgbGFzdFBhcmFtc0pzb24gPSBcIlwiXG4gICAgY29uc3QgY29udHJvbHMgPSBmcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKHtzaWduYWw6IG9wdGlvbnMuc2lnbmFsfSlcbiAgICBjb25zdCBjbGVhclJldHJ5VGltZXIgPSAoKSA9PiB7XG4gICAgICBpZiAocmV0cnlUaW1lciA9PT0gbnVsbCkgcmV0dXJuXG5cbiAgICAgIGdsb2JhbFRoaXMuY2xlYXJUaW1lb3V0KHJldHJ5VGltZXIpXG4gICAgICByZXRyeVRpbWVyID0gbnVsbFxuICAgIH1cblxuICAgIGNvbnN0IGNsb3NlID0gKCkgPT4ge1xuICAgICAgaWYgKGNsb3NlZCkgcmV0dXJuXG5cbiAgICAgIGNsb3NlZCA9IHRydWVcbiAgICAgIGNsZWFyUmV0cnlUaW1lcigpXG4gICAgICBjb250cm9scy5zaWduYWw/LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBjbG9zZSlcbiAgICAgIGlmIChjb25uZWN0aW9uICYmICFjb25uZWN0aW9uLmlzQ2xvc2VkKCkpIGNvbm5lY3Rpb24uY2xvc2UoKVxuICAgICAgY29ubmVjdGlvbiA9IG51bGxcbiAgICB9XG5cbiAgICBjb25zdCBzeW5jID0gKCkgPT4ge1xuICAgICAgaWYgKGNsb3NlZCkgcmV0dXJuXG5cbiAgICAgIGlmICghb3B0aW9ucy5zaG91bGRDb25uZWN0KCkpIHtcbiAgICAgICAgY2xlYXJSZXRyeVRpbWVyKClcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24gJiYgIWNvbm5lY3Rpb24uaXNDbG9zZWQoKSkgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgICAgIGNvbm5lY3Rpb24gPSBudWxsXG4gICAgICAgIGxhc3RQYXJhbXNKc29uID0gXCJcIlxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgY29uc3QgbmV4dFBhcmFtcyA9IG9wdGlvbnMucGFyYW1zKClcbiAgICAgIGNvbnN0IG5leHRQYXJhbXNKc29uID0gSlNPTi5zdHJpbmdpZnkobmV4dFBhcmFtcylcblxuICAgICAgLy8gQWxyZWFkeSBjb25uZWN0ZWQgd2l0aCBzYW1lIHBhcmFtcyDigJQgbm90aGluZyB0byBkby5cbiAgICAgIGlmIChjb25uZWN0aW9uICYmICFjb25uZWN0aW9uLmlzQ2xvc2VkKCkgJiYgbmV4dFBhcmFtc0pzb24gPT09IGxhc3RQYXJhbXNKc29uKSByZXR1cm5cblxuICAgICAgLy8gQ29ubmVjdGVkIGJ1dCBwYXJhbXMgY2hhbmdlZCDigJQgc2VuZCB1cGRhdGUgbWVzc2FnZS5cbiAgICAgIC8vIEd1YXJkIHdpdGggdHJ5L2NhdGNoOiB0aGUgY29ubmVjdGlvbiBoYW5kbGUgc3RheXMgbGl2ZSBkdXJpbmdcbiAgICAgIC8vIHJlY29ubmVjdCBidXQgdGhlIHVuZGVybHlpbmcgc29ja2V0IG1heSBiZSBjbG9zZWQuXG4gICAgICBpZiAoY29ubmVjdGlvbiAmJiAhY29ubmVjdGlvbi5pc0Nsb3NlZCgpKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29ubmVjdGlvbi5zZW5kTWVzc2FnZShuZXh0UGFyYW1zKVxuICAgICAgICAgIGxhc3RQYXJhbXNKc29uID0gbmV4dFBhcmFtc0pzb25cbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgY29ubmVjdGlvbiA9IG51bGxcbiAgICAgICAgICBsYXN0UGFyYW1zSnNvbiA9IFwiXCJcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBXUyBjbGllbnQgbm90IHJlYWR5IOKAlCByZXRyeS4gQ2hlY2sgdGhlIGFjdHVhbCBjbGllbnQgKHdoaWNoXG4gICAgICAvLyBtYXkgYmUgYW4gaW5qZWN0ZWQgd2Vic29ja2V0Q2xpZW50KSBpbnN0ZWFkIG9mIHdlYnNvY2tldFN0YXRlKClcbiAgICAgIC8vIHdoaWNoIG9ubHkgcmVmbGVjdHMgdGhlIGludGVybmFsIGNsaWVudC5cbiAgICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgICAgaWYgKCFjbGllbnQgfHwgIWNsaWVudC5pc09wZW4oKSkge1xuICAgICAgICBpZiAocmV0cnlUaW1lciA9PT0gbnVsbCkge1xuICAgICAgICAgIHJldHJ5VGltZXIgPSBnbG9iYWxUaGlzLnNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgcmV0cnlUaW1lciA9IG51bGxcbiAgICAgICAgICAgIHN5bmMoKVxuICAgICAgICAgIH0sIDI1MClcbiAgICAgICAgfVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgbGFzdFBhcmFtc0pzb24gPSBuZXh0UGFyYW1zSnNvblxuICAgICAgY29ubmVjdGlvbiA9IGNsaWVudC5vcGVuQ29ubmVjdGlvbihjb25uZWN0aW9uVHlwZSwge1xuICAgICAgICBwYXJhbXM6IG5leHRQYXJhbXMsXG4gICAgICAgIG9uTWVzc2FnZTogb3B0aW9ucy5vbk1lc3NhZ2UsXG4gICAgICAgIG9uQ2xvc2U6ICgpID0+IHtcbiAgICAgICAgICBpZiAoY29ubmVjdGlvbj8uaXNDbG9zZWQoKSkge1xuICAgICAgICAgICAgY29ubmVjdGlvbiA9IG51bGxcbiAgICAgICAgICAgIGxhc3RQYXJhbXNKc29uID0gXCJcIlxuICAgICAgICAgICAgc3luYygpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH1cblxuICAgIGNvbnRyb2xzLnNpZ25hbD8uYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGNsb3NlLCB7b25jZTogdHJ1ZX0pXG5cbiAgICBpZiAoY29udHJvbHMuc2lnbmFsPy5hYm9ydGVkKSB7XG4gICAgICBjbG9zZSgpXG4gICAgfSBlbHNlIHtcbiAgICAgIHN5bmMoKVxuICAgIH1cblxuICAgIHJldHVybiB7c3luYywgY2xvc2V9XG4gIH1cblxuICAvKipcbiAgICogT3BlbnMgYSAxOjEgYFdlYnNvY2tldENvbm5lY3Rpb25gIG9mIHRoZSBnaXZlbiB0eXBlLiBUaGluXG4gICAqIGNvbnZlbmllbmNlIHdyYXBwZXIgYXJvdW5kIHRoZSBpbnRlcm5hbCBXUyBjbGllbnQnc1xuICAgKiBgb3BlbkNvbm5lY3Rpb25gLiBBcHBzIHVzZSB0aGlzIGZvciBwZXItc2Vzc2lvbiBzdGF0ZS9tZXNzYWdpbmdcbiAgICogdGhhdCBkb2Vzbid0IGZpdCB0aGUgcHViL3N1YiBDaGFubmVsIG1vZGVsIChsb2NhbGUsIHByZXNlbmNlKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbm5lY3Rpb25UeXBlIC0gTmFtZSB0aGUgc2VydmVyIHJlZ2lzdGVyZWQgdGhlIGNsYXNzIHVuZGVyLlxuICAgKiBAcGFyYW0ge3twYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHRpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWwsIG9uQ29ubmVjdD86ICgpID0+IHZvaWQsIG9uTWVzc2FnZT86IChib2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gdm9pZCwgb25EaXNjb25uZWN0PzogKCkgPT4gdm9pZCwgb25SZXN1bWU/OiAoKSA9PiB2b2lkLCBvbkNsb3NlPzogKHJlYXNvbjogc3RyaW5nKSA9PiB2b2lkfX0gW29wdGlvbnNdIC0gQ29ubmVjdGlvbiBvcHRpb25zLCByZWFkaW5lc3MgY29udHJvbHMsIGFuZCBldmVudCBoYW5kbGVycy4gQ29ubmVjdCB0aGUgY2xpZW50IGZpcnN0OyB0aGUgdGltZW91dCBjb3ZlcnMgc2VydmVyLWNvbmZpcm1lZCByZWFkaW5lc3MgYW5kIHRoZSBzaWduYWwgY2FuY2VscyByZWFkaW5lc3Mgd2l0aG91dCBlbnRlcmluZyB0aGUgd2lyZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7e3JlYWR5OiBQcm9taXNlPHZvaWQ+LCBjbG9zZTogKCkgPT4gdm9pZH19IC0gV2Vic29ja2V0IGNvbm5lY3Rpb24gaGFuZGxlLlxuICAgKi9cbiAgc3RhdGljIG9wZW5XZWJzb2NrZXRDb25uZWN0aW9uKGNvbm5lY3Rpb25UeXBlLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBjbGllbnQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgfHwgcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkpXG5cbiAgICBpZiAoIWNsaWVudCB8fCB0eXBlb2YgY2xpZW50Lm9wZW5Db25uZWN0aW9uICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIm9wZW5XZWJzb2NrZXRDb25uZWN0aW9uIHJlcXVpcmVzIGNvbmZpZ3VyZVRyYW5zcG9ydCh7d2Vic29ja2V0VXJsfSlcIilcbiAgICB9XG5cbiAgICBjb25zdCB7c2lnbmFsLCB0aW1lb3V0TXMsIC4uLmNvbm5lY3Rpb25PcHRpb25zfSA9IG9wdGlvbnNcblxuICAgIHJldHVybiBjbGllbnQub3BlbkNvbm5lY3Rpb24oY29ubmVjdGlvblR5cGUsIHtcbiAgICAgIC4uLmNvbm5lY3Rpb25PcHRpb25zLFxuICAgICAgLi4uZnJvbnRlbmRNb2RlbFdlYnNvY2tldFN0YXJ0dXBDb250cm9scyh7c2lnbmFsLCB0aW1lb3V0TXN9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU3Vic2NyaWJlcyB0byBhIHB1Yi9zdWIgYFdlYnNvY2tldENoYW5uZWxgLiBUaGluIHdyYXBwZXIgYXJvdW5kXG4gICAqIHRoZSBpbnRlcm5hbCBjbGllbnQncyBgc3Vic2NyaWJlQ2hhbm5lbGAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjaGFubmVsVHlwZSAtIENoYW5uZWwgY2xhc3MgbmFtZSByZWdpc3RlcmVkIG9uIHRoZSBzZXJ2ZXIuXG4gICAqIEBwYXJhbSB7e3BhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgdGltZW91dE1zPzogbnVtYmVyLCBzaWduYWw/OiBBYm9ydFNpZ25hbCwgb25NZXNzYWdlPzogKGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB2b2lkLCBvbkRpc2Nvbm5lY3Q/OiAoKSA9PiB2b2lkLCBvblJlc3VtZT86ICgpID0+IHZvaWQsIG9uQ2xvc2U/OiAocmVhc29uOiBzdHJpbmcpID0+IHZvaWR9fSBbb3B0aW9uc10gLSBDaGFubmVsIG9wdGlvbnMsIHN0YXJ0dXAgY29udHJvbHMsIGFuZCBldmVudCBoYW5kbGVycy4gVGhlIHRpbWVvdXQgY292ZXJzIGNvbm5lY3QgYW5kIHNlcnZlci1jb25maXJtZWQgcmVhZGluZXNzIG9ubHk7IHRoZSBzaWduYWwgY2FuY2VscyBzdGFydHVwIHdpdGhvdXQgZW50ZXJpbmcgdGhlIHdpcmUgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3tyZWFkeTogUHJvbWlzZTx2b2lkPiwgY2xvc2U6ICgpID0+IHZvaWR9fSAtIFdlYnNvY2tldCBjaGFubmVsIGhhbmRsZSBmcm9tIHRoZSBjb25maWd1cmVkIGNsaWVudC5cbiAgICovXG4gIHN0YXRpYyBzdWJzY3JpYmVXZWJzb2NrZXRDaGFubmVsKGNoYW5uZWxUeXBlLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBjbGllbnQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgfHwgcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkpXG5cbiAgICBpZiAoIWNsaWVudCB8fCB0eXBlb2YgY2xpZW50LnN1YnNjcmliZUNoYW5uZWwgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3Vic2NyaWJlV2Vic29ja2V0Q2hhbm5lbCByZXF1aXJlcyBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldFVybH0pXCIpXG4gICAgfVxuXG4gICAgY29uc3Qge3BhcmFtcywgc2lnbmFsLCB0aW1lb3V0TXMsIC4uLmNoYW5uZWxPcHRpb25zfSA9IG9wdGlvbnNcbiAgICBjb25zdCByZXF1ZXN0Q29udGV4dCA9IGZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCgpXG4gICAgY29uc3Qgc2NvcGVkUGFyYW1zID0gbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQsIHBhcmFtcyA9PT0gdW5kZWZpbmVkID8ge30gOiBwYXJhbXMpXG4gICAgY29uc3Qgc3RhcnR1cENvbnRyb2xzID0gZnJvbnRlbmRNb2RlbFdlYnNvY2tldFN0YXJ0dXBDb250cm9scyh7c2lnbmFsLCB0aW1lb3V0TXN9KVxuICAgIGNvbnN0IHNjb3BlZFBhcmFtc09wdGlvbiA9IHBhcmFtcyA9PT0gdW5kZWZpbmVkICYmIE9iamVjdC5rZXlzKHJlcXVlc3RDb250ZXh0KS5sZW5ndGggPT09IDBcbiAgICAgID8ge31cbiAgICAgIDoge3BhcmFtczogc2NvcGVkUGFyYW1zfVxuICAgIGNvbnN0IGhhbmRsZSA9IGNsaWVudC5zdWJzY3JpYmVDaGFubmVsKGNoYW5uZWxUeXBlLCB7Li4uY2hhbm5lbE9wdGlvbnMsIC4uLnNjb3BlZFBhcmFtc09wdGlvbiwgLi4uc3RhcnR1cENvbnRyb2xzfSlcblxuICAgIGlmICh0eXBlb2YgY2xpZW50LmNvbm5lY3QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdm9pZCBjbGllbnQuY29ubmVjdChzdGFydHVwQ29udHJvbHMpLmNhdGNoKCgpID0+IGhhbmRsZS5jbG9zZSgpKVxuICAgIH1cblxuICAgIHJldHVybiBoYW5kbGVcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YWxscyBXZWJTb2NrZXQgbGlmZWN5Y2xlIGhvb2tzIG9uIGdsb2JhbFRoaXMgZm9yIHN5c3RlbSB0ZXN0IGFjY2Vzcy5cbiAgICogVGVzdHMgY2FuIGNhbGwgYGdsb2JhbFRoaXMuX192ZWxvY2lvdXNfd2Vic29ja2V0X2hvb2tzLmNvbm5lY3QoKWAgZXRjLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBpbnN0YWxsV2Vic29ja2V0VGVzdEhvb2tzKCkge1xuICAgIGlmICh0eXBlb2YgZ2xvYmFsVGhpcyA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuXG5cbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZ2xvYmFsVGhpcykuX192ZWxvY2lvdXNfd2Vic29ja2V0X2hvb2tzID0ge1xuICAgICAgY29ubmVjdDogKCkgPT4gdGhpcy5jb25uZWN0V2Vic29ja2V0KCksXG4gICAgICBkaXNjb25uZWN0OiAoKSA9PiB0aGlzLmRpc2Nvbm5lY3RXZWJzb2NrZXQoKSxcbiAgICAgIGRyb3A6ICgpID0+IHRoaXMuZHJvcFdlYnNvY2tldCgpLFxuICAgICAgc3RhdGU6ICgpID0+IHRoaXMud2Vic29ja2V0U3RhdGUoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dHJpYnV0ZXMgZnJvbSByZXNwb25zZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtvYmplY3R9IHJlc3BvbnNlIC0gUmVzcG9uc2UgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59IC0gQXR0cmlidXRlcyBmcm9tIHBheWxvYWQuXG4gICAqL1xuICBzdGF0aWMgYXR0cmlidXRlc0Zyb21SZXNwb25zZShyZXNwb25zZSkge1xuICAgIGNvbnN0IG1vZGVsRGF0YSA9IHRoaXMubW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuXG4gICAgcmV0dXJuIG1vZGVsRGF0YS5hdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtb2RlbCBkYXRhIGZyb20gcmVzcG9uc2UuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7b2JqZWN0fSByZXNwb25zZSAtIFJlc3BvbnNlIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt7YWJpbGl0aWVzOiBSZWNvcmQ8c3RyaW5nLCBib29sZWFuPiwgYXR0YWNobWVudE93bmVyOiB7cmVjb3JkSWQ6IHN0cmluZywgcmVjb3JkVHlwZTogc3RyaW5nLCByZXNvdXJjZU5hbWU6IHN0cmluZ30gfCBudWxsLCBhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBhc3NvY2lhdGlvbkNvdW50czogUmVjb3JkPHN0cmluZywgbnVtYmVyPiwgcXVlcnlEYXRhOiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzOiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBzZWxlY3RlZEF0dHJpYnV0ZXM6IFNldDxzdHJpbmc+fX0gLSBBdHRyaWJ1dGVzLCBhdHRhY2htZW50IG93bmVyLCBwcmVsb2FkZWQgcmVsYXRpb25zaGlwcywgYXNzb2NpYXRpb24gY291bnRzLCBxdWVyeURhdGEsIGFiaWxpdGllcywgYW5kIHNlbGVjdGVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzdGF0aWMgbW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgaWYgKCFyZXNwb25zZSB8fCB0eXBlb2YgcmVzcG9uc2UgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgb2JqZWN0IHJlc3BvbnNlIGJ1dCBnb3Q6ICR7cmVzcG9uc2V9YClcbiAgICB9XG5cbiAgICAvLyBOYXJyb3dzIHRoZSByZXNwb25zZSBvYmplY3QgdG8gdGhlIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCB2YWx1ZSBtYXAuXG4gICAgY29uc3QgcmVzcG9uc2VPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChyZXNwb25zZSlcblxuICAgIC8qKlxuICAgICAqIERlZmluZXMgbW9kZWxEYXRhLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqL1xuICAgIGxldCBtb2RlbERhdGFcblxuICAgIGlmIChyZXNwb25zZU9iamVjdC5tb2RlbCAmJiB0eXBlb2YgcmVzcG9uc2VPYmplY3QubW9kZWwgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIC8vIE5hcnJvd3MgdGhlIG5lc3RlZCBtb2RlbCBwYXlsb2FkIHRvIHRoZSBmcm9udGVuZC1tb2RlbCB2YWx1ZSBtYXAuXG4gICAgICBtb2RlbERhdGEgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChyZXNwb25zZU9iamVjdC5tb2RlbClcbiAgICB9IGVsc2UgaWYgKHJlc3BvbnNlT2JqZWN0LmF0dHJpYnV0ZXMgJiYgdHlwZW9mIHJlc3BvbnNlT2JqZWN0LmF0dHJpYnV0ZXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIC8vIE5hcnJvd3MgdGhlIG5lc3RlZCBhdHRyaWJ1dGVzIHBheWxvYWQgdG8gdGhlIGZyb250ZW5kLW1vZGVsIHZhbHVlIG1hcC5cbiAgICAgIG1vZGVsRGF0YSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKHJlc3BvbnNlT2JqZWN0LmF0dHJpYnV0ZXMpXG4gICAgfSBlbHNlIHtcbiAgICAgIG1vZGVsRGF0YSA9IHJlc3BvbnNlT2JqZWN0XG4gICAgfVxuXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKHsuLi5tb2RlbERhdGF9KVxuICAgIGNvbnN0IHByZWxvYWRlZFJlbGF0aW9uc2hpcHMgPSBpc1BsYWluT2JqZWN0KGF0dHJpYnV0ZXNbUFJFTE9BREVEX1JFTEFUSU9OU0hJUFNfS0VZXSlcbiAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoYXR0cmlidXRlc1tQUkVMT0FERURfUkVMQVRJT05TSElQU19LRVldKVxuICAgICAgOiB7fVxuICAgIGNvbnN0IGFzc29jaWF0aW9uQ291bnRzID0gaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzW0FTU09DSUFUSU9OX0NPVU5UU19LRVldKVxuICAgICAgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovIChhdHRyaWJ1dGVzW0FTU09DSUFUSU9OX0NPVU5UU19LRVldKVxuICAgICAgOiB7fVxuICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IGlzUGxhaW5PYmplY3QoYXR0cmlidXRlc1tRVUVSWV9EQVRBX0tFWV0pXG4gICAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKGF0dHJpYnV0ZXNbUVVFUllfREFUQV9LRVldKVxuICAgICAgOiB7fVxuICAgIGNvbnN0IGFiaWxpdGllcyA9IGlzUGxhaW5PYmplY3QoYXR0cmlidXRlc1tBQklMSVRJRVNfS0VZXSlcbiAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuPn0gKi8gKGF0dHJpYnV0ZXNbQUJJTElUSUVTX0tFWV0pXG4gICAgICA6IHt9XG4gICAgY29uc3Qgc2VsZWN0ZWRBdHRyaWJ1dGVzRnJvbVBheWxvYWQgPSBBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXNbU0VMRUNURURfQVRUUklCVVRFU19LRVldKVxuICAgICAgPyBuZXcgU2V0KC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChhdHRyaWJ1dGVzW1NFTEVDVEVEX0FUVFJJQlVURVNfS0VZXSkuZmlsdGVyKChhdHRyaWJ1dGVOYW1lKSA9PiB0eXBlb2YgYXR0cmlidXRlTmFtZSA9PT0gXCJzdHJpbmdcIikpXG4gICAgICA6IG51bGxcbiAgICBjb25zdCBhdHRhY2htZW50T3duZXJQYXlsb2FkID0gYXR0cmlidXRlc1tBVFRBQ0hNRU5UX09XTkVSX0tFWV1cbiAgICBsZXQgYXR0YWNobWVudE93bmVyID0gbnVsbFxuXG4gICAgaWYgKGF0dGFjaG1lbnRPd25lclBheWxvYWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KGF0dGFjaG1lbnRPd25lclBheWxvYWQpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEV4cGVjdGVkICR7QVRUQUNITUVOVF9PV05FUl9LRVl9IHRvIGJlIGFuIG9iamVjdGApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGF0dGFjaG1lbnRPd25lck9iamVjdCA9IC8qKiBAdHlwZSB7e3JlY29yZElkPzogdW5rbm93biwgcmVjb3JkVHlwZT86IHVua25vd24sIHJlc291cmNlTmFtZT86IHVua25vd259fSAqLyAoYXR0YWNobWVudE93bmVyUGF5bG9hZClcblxuICAgICAgYXR0YWNobWVudE93bmVyID0ge1xuICAgICAgICByZWNvcmRJZDogZm9yY2VkTm9uQmxhbmtTdHJpbmcoYXR0YWNobWVudE93bmVyT2JqZWN0LnJlY29yZElkLCBgJHtBVFRBQ0hNRU5UX09XTkVSX0tFWX0ucmVjb3JkSWRgKSxcbiAgICAgICAgcmVjb3JkVHlwZTogZm9yY2VkTm9uQmxhbmtTdHJpbmcoYXR0YWNobWVudE93bmVyT2JqZWN0LnJlY29yZFR5cGUsIGAke0FUVEFDSE1FTlRfT1dORVJfS0VZfS5yZWNvcmRUeXBlYCksXG4gICAgICAgIHJlc291cmNlTmFtZTogZm9yY2VkTm9uQmxhbmtTdHJpbmcoYXR0YWNobWVudE93bmVyT2JqZWN0LnJlc291cmNlTmFtZSwgYCR7QVRUQUNITUVOVF9PV05FUl9LRVl9LnJlc291cmNlTmFtZWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbQVRUQUNITUVOVF9PV05FUl9LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbUFJFTE9BREVEX1JFTEFUSU9OU0hJUFNfS0VZXVxuICAgIGRlbGV0ZSBhdHRyaWJ1dGVzW1NFTEVDVEVEX0FUVFJJQlVURVNfS0VZXVxuICAgIGRlbGV0ZSBhdHRyaWJ1dGVzW0FTU09DSUFUSU9OX0NPVU5UU19LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbUVVFUllfREFUQV9LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbQUJJTElUSUVTX0tFWV1cblxuICAgIGNvbnN0IHNlbGVjdGVkQXR0cmlidXRlcyA9IHNlbGVjdGVkQXR0cmlidXRlc0Zyb21QYXlsb2FkIHx8IG5ldyBTZXQoT2JqZWN0LmtleXMoYXR0cmlidXRlcykpXG5cbiAgICByZXR1cm4ge2FiaWxpdGllcywgYXR0YWNobWVudE93bmVyLCBhdHRyaWJ1dGVzLCBhc3NvY2lhdGlvbkNvdW50cywgcXVlcnlEYXRhLCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzLCBzZWxlY3RlZEF0dHJpYnV0ZXN9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBwcmVsb2FkZWQgcmVsYXRpb25zaGlwcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHByZWxvYWRlZFJlbGF0aW9uc2hpcHMgLSBQcmVsb2FkZWQgcmVsYXRpb25zaGlwIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFwcGx5UHJlbG9hZGVkUmVsYXRpb25zaGlwcyhtb2RlbCwgcHJlbG9hZGVkUmVsYXRpb25zaGlwcykge1xuICAgIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcFBheWxvYWRdIG9mIE9iamVjdC5lbnRyaWVzKHByZWxvYWRlZFJlbGF0aW9uc2hpcHMpKSB7XG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBtb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLnJlbGF0aW9uc2hpcE1vZGVsQ2xhc3MocmVsYXRpb25zaGlwTmFtZSlcblxuICAgICAgaWYgKHJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwKSB7XG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShyZWxhdGlvbnNoaXBQYXlsb2FkKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX0gcGF5bG9hZCB0byBiZSBhbiBhcnJheWApXG4gICAgICAgIH1cblxuICAgICAgICAvKiogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxCYXNlPn0gKi9cbiAgICAgICAgY29uc3QgcmVsYXRlZE1vZGVscyA9IFtdXG5cbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiByZWxhdGlvbnNoaXBQYXlsb2FkKSB7XG4gICAgICAgICAgY29uc3QgcmVsYXRlZE1vZGVsID0gdGhpcy5pbnN0YW50aWF0ZVJlbGF0aW9uc2hpcFZhbHVlKGVudHJ5LCB0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgICAgICAgaWYgKCEocmVsYXRlZE1vZGVsIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEJhc2UpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9IHBheWxvYWQgZW50cnkgdG8gaW5zdGFudGlhdGUgYSBmcm9udGVuZCBtb2RlbGApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmVsYXRlZE1vZGVscy5wdXNoKHJlbGF0ZWRNb2RlbClcbiAgICAgICAgfVxuXG4gICAgICAgIHJlbGF0aW9uc2hpcC5zZXRMb2FkZWQocmVsYXRlZE1vZGVscylcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkocmVsYXRpb25zaGlwUGF5bG9hZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfSBwYXlsb2FkIHRvIGJlIHNpbmd1bGFyYClcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVsYXRlZE1vZGVsID0gdGhpcy5pbnN0YW50aWF0ZVJlbGF0aW9uc2hpcFZhbHVlKHJlbGF0aW9uc2hpcFBheWxvYWQsIHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICAgIGlmIChyZWxhdGVkTW9kZWwgIT0gdW5kZWZpbmVkICYmICEocmVsYXRlZE1vZGVsIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEJhc2UpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX0gcGF5bG9hZCB0byBpbnN0YW50aWF0ZSBhIGZyb250ZW5kIG1vZGVsYClcbiAgICAgIH1cblxuICAgICAgcmVsYXRpb25zaGlwLnNldExvYWRlZChyZWxhdGVkTW9kZWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zdGFudGlhdGUgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWxhdGlvbnNoaXBQYXlsb2FkIC0gUmVsYXRpb25zaGlwIHBheWxvYWQgdmFsdWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzIHwgbnVsbH0gdGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEluc3RhbnRpYXRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgaW5zdGFudGlhdGVSZWxhdGlvbnNoaXBWYWx1ZShyZWxhdGlvbnNoaXBQYXlsb2FkLCB0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSByZXR1cm4gcmVsYXRpb25zaGlwUGF5bG9hZFxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXBQYXlsb2FkIHx8IHR5cGVvZiByZWxhdGlvbnNoaXBQYXlsb2FkICE9PSBcIm9iamVjdFwiKSByZXR1cm4gcmVsYXRpb25zaGlwUGF5bG9hZFxuXG4gICAgcmV0dXJuIHRhcmdldE1vZGVsQ2xhc3MuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UocmVsYXRpb25zaGlwUGF5bG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc3RhbnRpYXRlIGZyb20gcmVzcG9uc2UuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEluc3RhbmNlVHlwZTxUPn0gcmVzcG9uc2UgLSBSZXNwb25zZSBwYXlsb2FkLCBvciBhbiBhbHJlYWR5LWh5ZHJhdGVkIGluc3RhbmNlIG9mIHRoaXMgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtJbnN0YW5jZVR5cGU8VD59IC0gTmV3IG1vZGVsIGluc3RhbmNlLCBvciB0aGUgc2FtZSBpbnN0YW5jZSB1bmNoYW5nZWQgaWYgaXQgd2FzIGFscmVhZHkgaHlkcmF0ZWQuXG4gICAqL1xuICBzdGF0aWMgaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICAvLyBJZGVtcG90ZW50OiBpZiBhIGNhbGxlciBoYW5kcyB1cyBhbiBhbHJlYWR5LWh5ZHJhdGVkIGluc3RhbmNlIG9mIHRoaXNcbiAgICAvLyBjbGFzcyAobm93IGNvbW1vbiBiZWNhdXNlIHRoZSBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJIGF1dG8tc2VyaWFsaXplc1xuICAgIC8vIGJhY2tlbmQgYFJlY29yZGAgaW5zdGFuY2VzIHJldHVybmVkIGZyb20gY3VzdG9tIGNvbW1hbmRzIGFuZCB0aGVcbiAgICAvLyB0cmFuc3BvcnQgZGVzZXJpYWxpemVyIGh5ZHJhdGVzIHRoZW0gaW50byBtb2RlbHMgYmVmb3JlIHRoZSBjYWxsIHNpdGVcbiAgICAvLyBzZWVzIHRoZSByZXNwb25zZSksIHJldHVybiBpdCBhcy1pcy4gV2l0aG91dCB0aGlzLCBjb2RlIHRoYXQgaGFzXG4gICAgLy8gaGlzdG9yaWNhbGx5IHdyYXBwZWQgY3VzdG9tLWNvbW1hbmQgcmVzcG9uc2VzIGluXG4gICAgLy8gYE1vZGVsLmluc3RhbnRpYXRlRnJvbVJlc3BvbnNlKHJlc3BvbnNlLmZpZWxkKWAgd291bGQgc3ByZWFkIHRoZSBsaXZlXG4gICAgLy8gbW9kZWwgaW5zdGFuY2UgaW50byBhIG5ldyBjb25zdHJ1Y3RvciBjYWxsIGFuZCBwcm9kdWNlIGEgYnJva2VuIG1vZGVsXG4gICAgLy8gd2l0aCBpbnRlcm5hbCBzdGF0ZSBrZXlzIHByb21vdGVkIHRvIGF0dHJpYnV0ZXMuXG4gICAgaWYgKHJlc3BvbnNlIGluc3RhbmNlb2YgdGhpcykge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7SW5zdGFuY2VUeXBlPFQ+fSAqLyAocmVzcG9uc2UpXG4gICAgfVxuXG4gICAgY29uc3QgbW9kZWxEYXRhID0gdGhpcy5tb2RlbERhdGFGcm9tUmVzcG9uc2UocmVzcG9uc2UpXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IG1vZGVsRGF0YS5hdHRyaWJ1dGVzXG4gICAgY29uc3QgcHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IG1vZGVsRGF0YS5wcmVsb2FkZWRSZWxhdGlvbnNoaXBzXG4gICAgY29uc3QgYXNzb2NpYXRpb25Db3VudHMgPSBtb2RlbERhdGEuYXNzb2NpYXRpb25Db3VudHNcbiAgICBjb25zdCBxdWVyeURhdGEgPSBtb2RlbERhdGEucXVlcnlEYXRhXG4gICAgY29uc3QgYWJpbGl0aWVzID0gbW9kZWxEYXRhLmFiaWxpdGllc1xuICAgIGNvbnN0IGF0dGFjaG1lbnRPd25lciA9IG1vZGVsRGF0YS5hdHRhY2htZW50T3duZXJcbiAgICBjb25zdCBzZWxlY3RlZEF0dHJpYnV0ZXMgPSBtb2RlbERhdGEuc2VsZWN0ZWRBdHRyaWJ1dGVzXG4gICAgY29uc3QgcmVjZWl2ZXIgPSAvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzKVxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge25ldyAoYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4pID0+IEluc3RhbmNlVHlwZTxUPn0gKi8gKHJlY2VpdmVyKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoYXR0cmlidXRlcylcbiAgICBtb2RlbC5fYXR0YWNobWVudE93bmVyID0gYXR0YWNobWVudE93bmVyXG4gICAgbW9kZWwuX3NlbGVjdGVkQXR0cmlidXRlcyA9IHNlbGVjdGVkQXR0cmlidXRlcyA/IG5ldyBTZXQoc2VsZWN0ZWRBdHRyaWJ1dGVzKSA6IG51bGxcblxuICAgIHRoaXMuYXBwbHlQcmVsb2FkZWRSZWxhdGlvbnNoaXBzKG1vZGVsLCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGFzc29jaWF0aW9uQ291bnRzIHx8IHt9KSkge1xuICAgICAgbW9kZWwuX3NldEFzc29jaWF0aW9uQ291bnQoYXR0cmlidXRlTmFtZSwgTnVtYmVyKHZhbHVlKSB8fCAwKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgW25hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhxdWVyeURhdGEgfHwge30pKSB7XG4gICAgICBtb2RlbC5fc2V0UXVlcnlEYXRhKG5hbWUsIHZhbHVlKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgW2FjdGlvbiwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGFiaWxpdGllcyB8fCB7fSkpIHtcbiAgICAgIG1vZGVsLl9zZXRDb21wdXRlZEFiaWxpdHkoYWN0aW9uLCBCb29sZWFuKHZhbHVlKSlcbiAgICB9XG5cbiAgICBtb2RlbC5zZXRJc05ld1JlY29yZChmYWxzZSlcbiAgICBtb2RlbC5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMobW9kZWwuYXR0cmlidXRlcygpKVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBSZWNvcmQgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+Pn0gLSBSZXNvbHZlZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kKGlkKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kKGlkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gQXR0cmlidXRlIG1hdGNoIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPiB8IG51bGw+fSAtIEZvdW5kIG1vZGVsIG9yIG51bGwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZEJ5KGNvbmRpdGlvbnMpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpbmRCeShjb25kaXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieSBvciBmYWlsLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBBdHRyaWJ1dGUgbWF0Y2ggY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+Pn0gLSBGb3VuZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kQnlPckZhaWwoY29uZGl0aW9ucykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZEJ5T3JGYWlsKGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBhcnJheS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPltdPn0gLSBMb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHRvQXJyYXkoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS50b0FycmF5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD5bXT59IC0gTG9hZGVkIG1vZGVsIGluc3RhbmNlcy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsb2FkKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkubG9hZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhbGwuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIuXG4gICAqL1xuICBzdGF0aWMgYWxsKCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXJlLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBSb290LW1vZGVsIHdoZXJlIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCB3aGVyZSBjb25kaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIHdoZXJlKGNvbmRpdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLndoZXJlKGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqb2lucy5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gam9pbnMgLSBSZWxhdGlvbnNoaXAgZGVzY3JpcHRvciBqb2lucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIGpvaW5zLlxuICAgKi9cbiAgc3RhdGljIGpvaW5zKGpvaW5zKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5qb2lucyhqb2lucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxpbWl0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gTWF4aW11bSBudW1iZXIgb2YgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIGxpbWl0LlxuICAgKi9cbiAgc3RhdGljIGxpbWl0KHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5saW1pdCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9mZnNldC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIE51bWJlciBvZiByZWNvcmRzIHRvIHNraXAuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCBvZmZzZXQuXG4gICAqL1xuICBzdGF0aWMgb2Zmc2V0KHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5vZmZzZXQodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYWdlLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtudW1iZXJ9IHBhZ2VOdW1iZXIgLSAxLWJhc2VkIHBhZ2UgbnVtYmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggcGFnZSBhcHBsaWVkLlxuICAgKi9cbiAgc3RhdGljIHBhZ2UocGFnZU51bWJlcikge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkucGFnZShwYWdlTnVtYmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVyIHBhZ2UuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBOdW1iZXIgb2YgcmVjb3JkcyBwZXIgcGFnZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIHBhZ2Ugc2l6ZS5cbiAgICovXG4gIHN0YXRpYyBwZXJQYWdlKHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5wZXJQYWdlKHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY291bnQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE51bWJlciBvZiBsb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNvdW50KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuY291bnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIENsYXNzLWxldmVsIGhvb2sgZmlyZWQgd2hlbiBhbnkgcmVjb3JkIG9mIHRoaXMgbW9kZWwgaXMgY3JlYXRlZC5cbiAgICogU3Vic2NyaWJlLXRpbWUgYXV0aG9yaXphdGlvbiBvbmx5IOKAlCBvbmNlIGEgc3Vic2NyaXB0aW9uIGlzXG4gICAqIGFjY2VwdGVkLCBmdXR1cmUgYGNyZWF0ZWAgZXZlbnRzIGZvciB0aGlzIG1vZGVsIGFyZSBkZWxpdmVyZWRcbiAgICogd2l0aG91dCByZS1jaGVja2luZyBwZXItcmVjb3JkIHZpc2liaWxpdHkuIFF1ZXJ5IG9wdGlvbnMgY2FuIHN0aWxsXG4gICAqIG5hcnJvdyB3aGljaCBldmVudHMgcmVhY2ggdGhpcyBjYWxsYmFjay5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZSwgbW9kZWw6IEZyb250ZW5kTW9kZWxCYXNlfSkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHJlY29yZCBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIG9uQ3JlYXRlKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHQsIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQodGhpcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24odGhpcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrLCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfVxuXG4gICAgcmV0dXJuIGF3YWl0IHN1Yi5yZWdpc3RlckNsYXNzQ2FsbGJhY2soc3ViLmNsYXNzQ3JlYXRlQ2FsbGJhY2tzLCBlbnRyeSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGFzcy1sZXZlbCBob29rIGZpcmVkIHdoZW4gYW55IHJlY29yZCBvZiB0aGlzIG1vZGVsIGlzIHVwZGF0ZWQuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWUsIG1vZGVsOiBGcm9udGVuZE1vZGVsQmFzZX0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciByZWNvcmQgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBvblVwZGF0ZShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0LCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKHRoaXMsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKHRoaXMsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBlbnRyeSA9IHtjYWxsYmFjaywgLi4uZXZlbnRPcHRpb25zUGF5bG9hZH1cblxuICAgIHJldHVybiBhd2FpdCBzdWIucmVnaXN0ZXJDbGFzc0NhbGxiYWNrKHN1Yi5jbGFzc1VwZGF0ZUNhbGxiYWNrcywgZW50cnkpXG4gIH1cblxuICAvKipcbiAgICogQ2xhc3MtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIGFueSByZWNvcmQgb2YgdGhpcyBtb2RlbCBpcyBkZXN0cm95ZWQuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWV9KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gQWNjZXB0ZWQgZm9yIEFQSSBzeW1tZXRyeTsgZGVzdHJveSBldmVudHMgY2FycnkgaWRzIG9ubHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIG9uRGVzdHJveShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXNzZXJ0Tm9EZXN0cm95RXZlbnRGaWx0ZXIodGhpcywgb3B0aW9ucylcblxuICAgIGNvbnN0IHtyZXF1ZXN0Q29udGV4dH0gPSBmcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZCh0aGlzLCBvcHRpb25zKVxuICAgIGNvbnN0IHN1YiA9IGVuc3VyZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbih0aGlzLCBmcm9udGVuZE1vZGVsRXZlbnRSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2t9XG5cbiAgICByZXR1cm4gYXdhaXQgc3ViLnJlZ2lzdGVyQ2xhc3NDYWxsYmFjayhzdWIuY2xhc3NEZXN0cm95Q2FsbGJhY2tzLCBlbnRyeSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YW5jZS1sZXZlbCBob29rIGZpcmVkIHdoZW4gVEhJUyByZWNvcmQgaXMgdXBkYXRlZC4gVGhlXG4gICAqIGluc3RhbmNlJ3MgYXR0cmlidXRlcyBhcmUgYXV0by1tZXJnZWQgd2l0aCB0aGUgYnJvYWRjYXN0IHBheWxvYWRcbiAgICogYmVmb3JlIHRoZSBjYWxsYmFjayBydW5zLCBzbyBjYWxsZXJzIGNhbiByZWFkIGZyZXNoIHZhbHVlcyB2aWFcbiAgICogYHRoaXMuc29tZUF0dHIoKWAgd2l0aG91dCByZS1mZXRjaGluZy5cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZSwgbW9kZWw6IEZyb250ZW5kTW9kZWxCYXNlfSkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHJlY29yZCBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgb25VcGRhdGUoY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHQsIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQoTW9kZWxDbGFzcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oTW9kZWxDbGFzcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGlkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIHRoaXMucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2ssIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9XG4gICAgY29uc3QgbGlzdGVuZXIgPSBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGlkLCB0aGlzKVxuXG4gICAgbGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzLmFkZChlbnRyeSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzdWIuZW5zdXJlU3Vic2NyaWJlZCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCAoY3VycmVudCkgPT4gY3VycmVudC51cGRhdGVDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCAoY3VycmVudCkgPT4gY3VycmVudC51cGRhdGVDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSW5zdGFuY2UtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIFRISVMgcmVjb3JkIGlzIGRlc3Ryb3llZC5cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZX0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBBY2NlcHRlZCBmb3IgQVBJIHN5bW1ldHJ5OyBkZXN0cm95IGV2ZW50cyBjYXJyeSBpZHMgb25seS5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBhc3luYyBvbkRlc3Ryb3koY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcblxuICAgIGFzc2VydE5vRGVzdHJveUV2ZW50RmlsdGVyKE1vZGVsQ2xhc3MsIG9wdGlvbnMpXG5cbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQoTW9kZWxDbGFzcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oTW9kZWxDbGFzcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGlkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIHRoaXMucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2t9XG4gICAgY29uc3QgbGlzdGVuZXIgPSBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGlkLCB0aGlzKVxuXG4gICAgbGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcy5hZGQoZW50cnkpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3ViLmVuc3VyZVN1YnNjcmliZWQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgKGN1cnJlbnQpID0+IGN1cnJlbnQuZGVzdHJveUNhbGxiYWNrcy5kZWxldGUoZW50cnkpKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgcmVtb3ZlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJFbnRyeShzdWIsIChjdXJyZW50KSA9PiBjdXJyZW50LmRlc3Ryb3lDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwbHVjay5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7Li4uKHN0cmluZyB8IHN0cmluZ1tdIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pil9IGNvbHVtbnMgLSBQbHVjayBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFBsdWNrZWQgdmFsdWVzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHBsdWNrKC4uLmNvbHVtbnMpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLnBsdWNrKC4uLmNvbHVtbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWFyY2guXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW4gLSBDb2x1bW4gb3IgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7XCJlcVwiIHwgXCJsaWtlXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCI+XCIgfCBcIj49XCIgfCBcIjxcIiB8IFwiPD1cIn0gb3BlcmF0b3IgLSBTZWFyY2ggb3BlcmF0b3IuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU2VhcmNoIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBzZWFyY2ggZmlsdGVyLlxuICAgKi9cbiAgc3RhdGljIHNlYXJjaChwYXRoLCBjb2x1bW4sIG9wZXJhdG9yLCB2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuc2VhcmNoKHBhdGgsIGNvbHVtbiwgb3BlcmF0b3IsIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmFuc2Fjay5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSYW5zYWNrLXN0eWxlIHBhcmFtcyBoYXNoLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBSYW5zYWNrIGZpbHRlcnMgYXBwbGllZC5cbiAgICovXG4gIHN0YXRpYyByYW5zYWNrKHBhcmFtcykge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkucmFuc2FjayhwYXJhbXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzb3J0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHN0cmluZ1tdW10gfCBbc3RyaW5nLCBzdHJpbmddIHwgQXJyYXk8W3N0cmluZywgc3RyaW5nXT4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBzb3J0IC0gU29ydCBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBzb3J0IGRlZmluaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIHNvcnQoc29ydCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuc29ydChzb3J0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3JkZXIuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgc3RyaW5nW11bXSB8IFtzdHJpbmcsIHN0cmluZ10gfCBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHNvcnQgLSBTb3J0IGRlZmluaXRpb24ocykuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlciB3aXRoIHNvcnQgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgb3JkZXIoc29ydCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkub3JkZXIoc29ydClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdyb3VwLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IGdyb3VwIC0gR3JvdXAgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggZ3JvdXAgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgZ3JvdXAoZ3JvdXApIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLmdyb3VwKGdyb3VwKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzdGluY3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFt2YWx1ZV0gLSBXaGV0aGVyIHRvIHJlcXVlc3QgZGlzdGluY3Qgcm93cy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggZGlzdGluY3QgZmxhZy5cbiAgICovXG4gIHN0YXRpYyBkaXN0aW5jdCh2YWx1ZSA9IHRydWUpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLmRpc3RpbmN0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIuXG4gICAqL1xuICBzdGF0aWMgcXVlcnkoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAobmV3IEZyb250ZW5kTW9kZWxRdWVyeSh7bW9kZWxDbGFzczogdGhpc30pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJlbG9hZC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQ+fSBwcmVsb2FkIC0gUHJlbG9hZCBncmFwaC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSB3aXRoIHByZWxvYWQuXG4gICAqL1xuICBzdGF0aWMgcHJlbG9hZChwcmVsb2FkKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAodGhpcy5xdWVyeSgpLnByZWxvYWQocHJlbG9hZCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWxlY3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdIHwgc3RyaW5nPiB8IHN0cmluZyB8IHN0cmluZ1tdfSBzZWxlY3QgLSBNb2RlbC1hd2FyZSBhdHRyaWJ1dGUgc2VsZWN0IG1hcCBvciByb290LW1vZGVsIHNob3J0aGFuZC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSB3aXRoIHNlbGVjdGVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzdGF0aWMgc2VsZWN0KHNlbGVjdCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gKi8gKHRoaXMucXVlcnkoKS5zZWxlY3Qoc2VsZWN0KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdHMgZXh0cmEuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdIHwgc3RyaW5nPiB8IHN0cmluZyB8IHN0cmluZ1tdfSBzZWxlY3QgLSBFeHRyYSBhdHRyaWJ1dGVzIHRvIGxvYWQgaW4gYWRkaXRpb24gdG8gdGhlIGRlZmF1bHRzLCBrZXllZCBieSBtb2RlbCBuYW1lIG9yIHJvb3QtbW9kZWwgc2hvcnRoYW5kLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IHdpdGggZXh0cmEgc2VsZWN0ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIHN0YXRpYyBzZWxlY3RzRXh0cmEoc2VsZWN0KSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAodGhpcy5xdWVyeSgpLnNlbGVjdHNFeHRyYShzZWxlY3QpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmlyc3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBGaXJzdCBtb2RlbCBvciBudWxsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpcnN0KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmlyc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGFzdC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPiB8IG51bGw+fSAtIExhc3QgbW9kZWwgb3IgbnVsbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsYXN0KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkubGFzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG9yIGluaXRpYWxpemUgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIEF0dHJpYnV0ZSBtYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIEV4aXN0aW5nIG9yIGluaXRpYWxpemVkIG1vZGVsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRPckluaXRpYWxpemVCeShjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgY3JlYXRlIGJ5LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBBdHRyaWJ1dGUgbWF0Y2ggY29uZGl0aW9ucy5cbiAgICogQHBhcmFtIHsobW9kZWw6IEluc3RhbmNlVHlwZTxUPikgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWR9IFtjYWxsYmFja10gLSBPcHRpb25hbCBjYWxsYmFjayBiZWZvcmUgc2F2ZSB3aGVuIGNyZWF0ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRXhpc3Rpbmcgb3IgbmV3bHkgY3JlYXRlZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kT3JDcmVhdGVCeShjb25kaXRpb25zLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZE9yQ3JlYXRlQnkoY29uZGl0aW9ucywgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzXG4gICAqIEB0aGlzIHtNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDcmVhdGVBdHRyaWJ1dGVzRm9yPEluc3RhbmNlVHlwZTxNb2RlbENsYXNzPj59IFthdHRyaWJ1dGVzXSAtIEluaXRpYWwgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+Pn0gLSBQZXJzaXN0ZWQgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY3JlYXRlKGF0dHJpYnV0ZXMpIHtcbiAgICBjb25zdCByZWNlaXZlciA9IC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHRoaXMpXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogRnJvbnRlbmRNb2RlbENyZWF0ZUF0dHJpYnV0ZXNGb3I8SW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+PikgPT4gSW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+fSAqLyAocmVjZWl2ZXIpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcyhhdHRyaWJ1dGVzKVxuXG4gICAgYXdhaXQgbW9kZWwuc2F2ZSgpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2VydCBmaW5kIGJ5IGNvbmRpdGlvbnMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gZmluZEJ5IGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFzc2VydEZpbmRCeUNvbmRpdGlvbnMoY29uZGl0aW9ucykge1xuICAgIGFzc2VydEZpbmRCeUNvbmRpdGlvbnNTaGFwZShjb25kaXRpb25zKVxuXG4gICAgT2JqZWN0LmtleXMoY29uZGl0aW9ucykuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgICBhc3NlcnREZWZpbmVkRmluZEJ5Q29uZGl0aW9uVmFsdWUoY29uZGl0aW9uc1trZXldLCBrZXkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hdGNoZXMgZmluZCBieSBjb25kaXRpb25zLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIENhbmRpZGF0ZSBtb2RlbC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBNYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBtb2RlbCBtYXRjaGVzIGFsbCBjb25kaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIG1hdGNoZXNGaW5kQnlDb25kaXRpb25zKG1vZGVsLCBjb25kaXRpb25zKSB7XG4gICAgY29uc3QgbW9kZWxBdHRyaWJ1dGVzID0gbW9kZWwuYXR0cmlidXRlcygpXG5cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhjb25kaXRpb25zKSkge1xuICAgICAgY29uc3QgZXhwZWN0ZWRWYWx1ZSA9IGNvbmRpdGlvbnNba2V5XVxuICAgICAgY29uc3QgYWN0dWFsVmFsdWUgPSBtb2RlbEF0dHJpYnV0ZXNba2V5XVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShleHBlY3RlZFZhbHVlKSkge1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhY3R1YWxWYWx1ZSkpIHtcbiAgICAgICAgICBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKCFleHBlY3RlZFZhbHVlLnNvbWUoKGVudHJ5KSA9PiB0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZW50cnkpKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKCF0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgY29uZGl0aW9uIHZhbHVlIG1hdGNoZXMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFjdHVhbFZhbHVlIC0gQWN0dWFsIG1vZGVsIHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBleHBlY3RlZFZhbHVlIC0gRXhwZWN0ZWQgZmluZCBjb25kaXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWVzIG1hdGNoLlxuICAgKi9cbiAgc3RhdGljIGZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkge1xuICAgIGlmIChleHBlY3RlZFZhbHVlID09PSBudWxsKSB7XG4gICAgICByZXR1cm4gYWN0dWFsVmFsdWUgPT09IG51bGxcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShleHBlY3RlZFZhbHVlKSkge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGFjdHVhbFZhbHVlKSkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgaWYgKGFjdHVhbFZhbHVlLmxlbmd0aCAhPT0gZXhwZWN0ZWRWYWx1ZS5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBleHBlY3RlZFZhbHVlLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgICBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlW2luZGV4XSwgZXhwZWN0ZWRWYWx1ZVtpbmRleF0pKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBpZiAoZXhwZWN0ZWRWYWx1ZSAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgaWYgKCFhY3R1YWxWYWx1ZSB8fCB0eXBlb2YgYWN0dWFsVmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShhY3R1YWxWYWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFjdHVhbE9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoYWN0dWFsVmFsdWUpXG4gICAgICBjb25zdCBleHBlY3RlZE9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZXhwZWN0ZWRWYWx1ZSlcbiAgICAgIGNvbnN0IGFjdHVhbEtleXMgPSBPYmplY3Qua2V5cyhhY3R1YWxPYmplY3QpXG4gICAgICBjb25zdCBleHBlY3RlZEtleXMgPSBPYmplY3Qua2V5cyhleHBlY3RlZE9iamVjdClcblxuICAgICAgaWYgKGFjdHVhbEtleXMubGVuZ3RoICE9PSBleHBlY3RlZEtleXMubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBleHBlY3RlZEtleXMpIHtcbiAgICAgICAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoYWN0dWFsT2JqZWN0LCBrZXkpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbE9iamVjdFtrZXldLCBleHBlY3RlZE9iamVjdFtrZXldKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgaWYgKGFjdHVhbFZhbHVlID09PSBleHBlY3RlZFZhbHVlKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmZpbmRCeVByaW1pdGl2ZVZhbHVlc01hdGNoKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieSBwcmltaXRpdmUgdmFsdWVzIG1hdGNoLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhY3R1YWxWYWx1ZSAtIEFjdHVhbCBtb2RlbCB2YWx1ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXhwZWN0ZWRWYWx1ZSAtIEV4cGVjdGVkIGZpbmQgY29uZGl0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHByaW1pdGl2ZSB2YWx1ZXMgbWF0Y2ggYWZ0ZXIgc2FmZSBjb2VyY2lvbi5cbiAgICovXG4gIHN0YXRpYyBmaW5kQnlQcmltaXRpdmVWYWx1ZXNNYXRjaChhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkge1xuICAgIGlmIChhY3R1YWxWYWx1ZSBpbnN0YW5jZW9mIERhdGUgJiYgdHlwZW9mIGV4cGVjdGVkVmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFeHBlY3RlZFZhbHVlID0gbm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlKGV4cGVjdGVkVmFsdWUsIHt0aW1lWm9uZTogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKCl9KVxuXG4gICAgICBpZiAobm9ybWFsaXplZEV4cGVjdGVkVmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAgIHJldHVybiBhY3R1YWxWYWx1ZS50b0lTT1N0cmluZygpID09PSBub3JtYWxpemVkRXhwZWN0ZWRWYWx1ZS50b0lTT1N0cmluZygpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhY3R1YWxWYWx1ZS50b0lTT1N0cmluZygpID09PSBleHBlY3RlZFZhbHVlXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhY3R1YWxWYWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiBleHBlY3RlZFZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgcmV0dXJuIGFjdHVhbFZhbHVlID09PSBleHBlY3RlZFZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICB9XG5cbiAgICBpZiAoYWN0dWFsVmFsdWUgaW5zdGFuY2VvZiBEYXRlICYmIGV4cGVjdGVkVmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICByZXR1cm4gYWN0dWFsVmFsdWUudG9JU09TdHJpbmcoKSA9PT0gZXhwZWN0ZWRWYWx1ZS50b0lTT1N0cmluZygpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhY3R1YWxWYWx1ZSA9PT0gXCJudW1iZXJcIiAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIHRoaXMuZmluZEJ5TnVtZXJpY1N0cmluZ01hdGNoZXNOdW1iZXIoZXhwZWN0ZWRWYWx1ZSwgYWN0dWFsVmFsdWUpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhY3R1YWxWYWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJudW1iZXJcIikge1xuICAgICAgcmV0dXJuIHRoaXMuZmluZEJ5TnVtZXJpY1N0cmluZ01hdGNoZXNOdW1iZXIoYWN0dWFsVmFsdWUsIGV4cGVjdGVkVmFsdWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5IG51bWVyaWMgc3RyaW5nIG1hdGNoZXMgbnVtYmVyLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gbnVtZXJpY1N0cmluZyAtIE51bWVyaWMgc3RyaW5nIHZhbHVlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZXhwZWN0ZWROdW1iZXIgLSBOdW1iZXIgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWVzIHJlcHJlc2VudCB0aGUgc2FtZSBudW1iZXIuXG4gICAqL1xuICBzdGF0aWMgZmluZEJ5TnVtZXJpY1N0cmluZ01hdGNoZXNOdW1iZXIobnVtZXJpY1N0cmluZywgZXhwZWN0ZWROdW1iZXIpIHtcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShleHBlY3RlZE51bWJlcikpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGlmICghL14tP1xcZCsoPzpcXC5cXGQrKT8kLy50ZXN0KG51bWVyaWNTdHJpbmcpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gTnVtYmVyKG51bWVyaWNTdHJpbmcpID09PSBleHBlY3RlZE51bWJlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlLlxuICAgKiBAcGFyYW0ge1VwZGF0ZUF0dHJpYnV0ZXN9IFtuZXdBdHRyaWJ1dGVzXSAtIE5ldyB2YWx1ZXMgdG8gYXNzaWduIGJlZm9yZSB1cGRhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHRoaXM+fSAtIFVwZGF0ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyB1cGRhdGUobmV3QXR0cmlidXRlcykge1xuICAgIGlmIChuZXdBdHRyaWJ1dGVzKSB0aGlzLmFzc2lnbkF0dHJpYnV0ZXMobmV3QXR0cmlidXRlcylcblxuICAgIHJldHVybiAvKiogQHR5cGUge3RoaXN9ICovIChhd2FpdCB0aGlzLnNhdmUoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXR0YWNobWVudElucHV0IC0gQXR0YWNobWVudCBpbnB1dCBvciBuYW1lZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYXR0YWNoZWQuXG4gICAqL1xuICBhc3luYyBhdHRhY2goYXR0YWNobWVudElucHV0KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9ucyA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb25zKClcbiAgICBjb25zdCBhdHRhY2htZW50TmFtZXMgPSBPYmplY3Qua2V5cyhhdHRhY2htZW50RGVmaW5pdGlvbnMpXG4gICAgbGV0IGF0dGFjaG1lbnROYW1lID0gYXR0YWNobWVudE5hbWVzWzBdXG4gICAgbGV0IGFjdHVhbEF0dGFjaG1lbnRJbnB1dCA9IGF0dGFjaG1lbnRJbnB1dFxuXG4gICAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChhdHRhY2htZW50SW5wdXQpKSB7XG4gICAgICBpZiAoXCJmaWxlXCIgaW4gYXR0YWNobWVudElucHV0ICYmIGF0dGFjaG1lbnREZWZpbml0aW9ucy5maWxlKSB7XG4gICAgICAgIGF0dGFjaG1lbnROYW1lID0gXCJmaWxlXCJcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBjYW5kaWRhdGVOYW1lIG9mIGF0dGFjaG1lbnROYW1lcykge1xuICAgICAgICBpZiAoY2FuZGlkYXRlTmFtZSBpbiBhdHRhY2htZW50SW5wdXQpIHtcbiAgICAgICAgICBhdHRhY2htZW50TmFtZSA9IGNhbmRpZGF0ZU5hbWVcbiAgICAgICAgICBhY3R1YWxBdHRhY2htZW50SW5wdXQgPSBhdHRhY2htZW50SW5wdXRbY2FuZGlkYXRlTmFtZV1cbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFhdHRhY2htZW50TmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBhdHRhY2htZW50IGRlZmluaXRpb25zIG9uICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKS5hdHRhY2goYWN0dWFsQXR0YWNobWVudElucHV0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2F2ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dGhpcz59IC0gU2F2ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBzYXZlKCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBpc05ldyA9IHRoaXMuaXNOZXdSZWNvcmQoKVxuICAgIGNvbnN0IHByZXZpb3VzSWRlbnRpdHkgPSBpc05ldyA/IG51bGwgOiB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgY29uc3QgY29tbWFuZFR5cGUgPSBpc05ldyA/IFwiY3JlYXRlXCIgOiBcInVwZGF0ZVwiXG4gICAgLyoqXG4gICAgICogUGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBhdHRyaWJ1dGVzOiB0aGlzLl9jaGFuZ2VkQXR0cmlidXRlc0ZvclNhdmUoKVxuICAgIH1cblxuICAgIGlmICghaXNOZXcpIHtcbiAgICAgIHBheWxvYWQuaWQgPSB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgfVxuXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMuX2J1aWxkTmVzdGVkQXR0cmlidXRlc1BheWxvYWQoKVxuXG4gICAgaWYgKG5lc3RlZEF0dHJpYnV0ZXMgJiYgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykubGVuZ3RoID4gMCkge1xuICAgICAgcGF5bG9hZC5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuICAgIH1cblxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gYXdhaXQgdGhpcy5fYnVpbGRBdHRhY2htZW50c1BheWxvYWQoKVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwKSB7XG4gICAgICBwYXlsb2FkLmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICB9XG5cbiAgICBpZiAoc2hvdWxkUXVldWVGcm9udGVuZE1vZGVsT3BlcmF0aW9uT2ZmbGluZShNb2RlbENsYXNzLCBjb21tYW5kVHlwZSkpIHtcbiAgICAgIGNvbnN0IG9mZmxpbmVBdHRyaWJ1dGVzID0gey4uLnBheWxvYWQuYXR0cmlidXRlc31cbiAgICAgIGxldCBjbGllbnRNdXRhdGlvbklkXG5cbiAgICAgIGlmIChpc05ldykge1xuICAgICAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgT2ZmbGluZSBjcmVhdGUgZm9yICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICAgIGNvbnN0IGN1cnJlbnRQcmltYXJ5S2V5ID0gdGhpcy5yZWFkQXR0cmlidXRlKHByaW1hcnlLZXkpXG5cbiAgICAgICAgaWYgKGN1cnJlbnRQcmltYXJ5S2V5ID09PSB1bmRlZmluZWQgfHwgY3VycmVudFByaW1hcnlLZXkgPT09IG51bGwpIHtcbiAgICAgICAgICBjbGllbnRNdXRhdGlvbklkID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5vZmZsaW5lU3luYz8uY2xpZW50TXV0YXRpb25JZFxuICAgICAgICAgICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jLmNsaWVudE11dGF0aW9uSWQoKVxuICAgICAgICAgICAgOiBmcm9udGVuZE1vZGVsT2ZmbGluZU11dGF0aW9uSWQoKVxuICAgICAgICAgIHRoaXMuc2V0QXR0cmlidXRlKHByaW1hcnlLZXksIGNsaWVudE11dGF0aW9uSWQpXG4gICAgICAgICAgb2ZmbGluZUF0dHJpYnV0ZXNbcHJpbWFyeUtleV0gPSBjbGllbnRNdXRhdGlvbklkXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGBPZmZsaW5lIHVwZGF0ZSBmb3IgJHtNb2RlbENsYXNzLm5hbWV9YClcblxuICAgICAgICBvZmZsaW5lQXR0cmlidXRlc1twcmltYXJ5S2V5XSA9IHBheWxvYWQuaWRcbiAgICAgIH1cblxuICAgICAgaWYgKHBheWxvYWQubmVzdGVkQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkIHx8IHBheWxvYWQuYXR0YWNobWVudHMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE9mZmxpbmUgc3luYyBmb3IgJHtNb2RlbENsYXNzLm5hbWV9IGRvZXMgbm90IHN1cHBvcnQgbmVzdGVkIGF0dHJpYnV0ZXMgb3IgYXR0YWNobWVudHMgeWV0YClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgcXVldWVGcm9udGVuZE1vZGVsTXV0YXRpb25PZmZsaW5lKHtcbiAgICAgICAgYXR0cmlidXRlczogb2ZmbGluZUF0dHJpYnV0ZXMsXG4gICAgICAgIGNsaWVudE11dGF0aW9uSWQsXG4gICAgICAgIE1vZGVsQ2xhc3MsXG4gICAgICAgIG9wZXJhdGlvbjogY29tbWFuZFR5cGVcbiAgICAgIH0pXG4gICAgICB0aGlzLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuICAgICAgdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXModGhpcy5hdHRyaWJ1dGVzKCkpXG4gICAgICB0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgICB0aGlzLl9jbGVhclBlbmRpbmdBdHRhY2htZW50cygpXG5cbiAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgY29uc3QgcmVtb3ZlVGVtcG9yYXJ5TGlzdGVuZXJBbGlhc2VzID0gcHJldmlvdXNJZGVudGl0eSA9PT0gbnVsbFxuICAgICAgPyAoKSA9PiB7fVxuICAgICAgOiBhbGlhc0Zyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyhNb2RlbENsYXNzLCB0aGlzLCBwcmV2aW91c0lkZW50aXR5LCB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIGxldCByZXNwb25zZVxuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3BvbnNlID0gYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChjb21tYW5kVHlwZSwgcGF5bG9hZClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmVtb3ZlVGVtcG9yYXJ5TGlzdGVuZXJBbGlhc2VzKClcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmVtb3ZlVGVtcG9yYXJ5TGlzdGVuZXJBbGlhc2VzKClcblxuICAgIGNvbnN0IG1vZGVsRGF0YSA9IE1vZGVsQ2xhc3MubW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuXG4gICAgdGhpcy5hc3NpZ25BdHRyaWJ1dGVzKG1vZGVsRGF0YS5hdHRyaWJ1dGVzKVxuICAgIHRoaXMuX2F0dGFjaG1lbnRPd25lciA9IG1vZGVsRGF0YS5hdHRhY2htZW50T3duZXJcbiAgICB0aGlzLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuXG4gICAgaWYgKHByZXZpb3VzSWRlbnRpdHkgIT09IG51bGwpIHtcbiAgICAgIHJla2V5RnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKE1vZGVsQ2xhc3MsIHRoaXMsIHByZXZpb3VzSWRlbnRpdHksIHRoaXMucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgfVxuXG4gICAgdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXModGhpcy5hdHRyaWJ1dGVzKCkpXG4gICAgdGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIHRoaXMuX2NsZWFyUGVuZGluZ0F0dGFjaG1lbnRzKClcblxuICAgIHRoaXMuX3JlY29uY2lsZU5lc3RlZEF0dHJpYnV0ZXNGcm9tUmVzcG9uc2UocmVzcG9uc2UpXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHN1YnNldCBvZiBgX2F0dHJpYnV0ZXNgIHdob3NlIHZhbHVlIGhhcyBkaXZlcmdlZCBmcm9tXG4gICAqIGBfcGVyc2lzdGVkQXR0cmlidXRlc2AuIFVzZWQgYnkgYHNhdmUoKWAgc28gdGhlIHNlcnZlciByZWNlaXZlcyBvbmx5IHRoZVxuICAgKiBmaWVsZHMgdGhlIGNhbGxlciBhY3R1YWxseSBjaGFuZ2VkIOKAlCBhdm9pZGluZyBzdHJpY3QgcGVybWl0IHJlamVjdGlvbnMgb25cbiAgICogZnJhbWV3b3JrLW1hbmFnZWQgZmllbGRzIGxpa2UgYGlkYCwgYGNyZWF0ZWRBdGAsIGB1cGRhdGVkQXRgLCBvciBvd25lclxuICAgKiBmb3JlaWduIGtleXMgdGhhdCB0aGUgcmVzb3VyY2UgbmV2ZXIgbGlzdHMgaW4gYHBlcm1pdHRlZFBhcmFtc2AuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAtIENoYW5nZWQgYXR0cmlidXRlcyBoYXNoLlxuICAgKi9cbiAgX2NoYW5nZWRBdHRyaWJ1dGVzRm9yU2F2ZSgpIHtcbiAgICAvKipcbiAgICAgKiBDaGFuZ2VkIGF0dHJpYnV0ZXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovXG4gICAgY29uc3QgY2hhbmdlZEF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgW3ByZXZpb3VzVmFsdWUsIGN1cnJlbnRWYWx1ZV1dIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuY2hhbmdlcygpKSkge1xuICAgICAgaWYgKHRoaXMuaXNOZXdSZWNvcmQoKSAmJiBwcmV2aW91c1ZhbHVlID09PSB1bmRlZmluZWQgJiYgY3VycmVudFZhbHVlID09PSBudWxsKSBjb250aW51ZVxuXG4gICAgICBjaGFuZ2VkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IGN1cnJlbnRWYWx1ZVxuICAgIH1cblxuICAgIHJldHVybiBjaGFuZ2VkQXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIHRoZSBjdXJyZW50IHZhbHVlIGZvciBhbiBhdHRyaWJ1dGUgYXMgYWxyZWFkeSBwZXJzaXN0ZWQgc28gdGhlIG5leHRcbiAgICogc2F2ZSBkb2VzIG5vdCBzZW5kIGl0IHVubGVzcyB0aGUgY2FsbGVyIGNoYW5nZXMgaXQgYWdhaW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIHRvIG1hcmsgdW5jaGFuZ2VkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIG1hcmtBdHRyaWJ1dGVVbmNoYW5nZWQoYXR0cmlidXRlTmFtZSkge1xuICAgIHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBjbG9uZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKHt2YWx1ZTogdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXX0pLnZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZXN0cm95LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRlc3Ryb3llZCBvbiBiYWNrZW5kLlxuICAgKi9cbiAgYXN5bmMgZGVzdHJveSgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgaWQgPSB0aGlzLmlzTmV3UmVjb3JkKCkgPyB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpIDogdGhpcy5wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKVxuXG4gICAgaWYgKHNob3VsZFF1ZXVlRnJvbnRlbmRNb2RlbE9wZXJhdGlvbk9mZmxpbmUoTW9kZWxDbGFzcywgXCJkZXN0cm95XCIpKSB7XG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgT2ZmbGluZSBkZXN0cm95IGZvciAke01vZGVsQ2xhc3MubmFtZX1gKVxuXG4gICAgICBhd2FpdCBxdWV1ZUZyb250ZW5kTW9kZWxNdXRhdGlvbk9mZmxpbmUoe1xuICAgICAgICBhdHRyaWJ1dGVzOiB7W3ByaW1hcnlLZXldOiBpZH0sXG4gICAgICAgIE1vZGVsQ2xhc3MsXG4gICAgICAgIG9wZXJhdGlvbjogXCJkZXN0cm95XCJcbiAgICAgIH0pXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IE1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJkZXN0cm95XCIsIHtcbiAgICAgIGlkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGF0dGFjaG1lbnQgcGF5bG9hZCBxdWV1ZWQgb24gdGhpcyBtb2RlbCBmb3IgdGhlIG5leHQgc2F2ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gQXR0YWNobWVudCBwYXlsb2FkIGtleWVkIGJ5IGF0dGFjaG1lbnQgbmFtZS5cbiAgICovXG4gIGFzeW5jIF9idWlsZEF0dGFjaG1lbnRzUGF5bG9hZCgpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cblxuICAgIGZvciAoY29uc3QgYXR0YWNobWVudE5hbWUgb2YgT2JqZWN0LmtleXModGhpcy5fYXR0YWNobWVudHMpKSB7XG4gICAgICBjb25zdCBhdHRhY2htZW50UGF5bG9hZCA9IGF3YWl0IHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXS5wZW5kaW5nQXR0YWNobWVudHNQYXlsb2FkKClcblxuICAgICAgaWYgKGF0dGFjaG1lbnRQYXlsb2FkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcGF5bG9hZFthdHRhY2htZW50TmFtZV0gPSBhdHRhY2htZW50UGF5bG9hZFxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICAvKiogQ2xlYXJzIHF1ZXVlZCBhdHRhY2htZW50IGlucHV0cyBhZnRlciBhIHN1Y2Nlc3NmdWwgc2F2ZS4gKi9cbiAgX2NsZWFyUGVuZGluZ0F0dGFjaG1lbnRzKCkge1xuICAgIGZvciAoY29uc3QgYXR0YWNobWVudE5hbWUgb2YgT2JqZWN0LmtleXModGhpcy5fYXR0YWNobWVudHMpKSB7XG4gICAgICB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0uY2xlYXJQZW5kaW5nQXR0YWNobWVudHMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXYWxrcyByZWxhdGlvbnNoaXBzIGRlY2xhcmVkIGluIHRoaXMgcmVzb3VyY2UncyBgbmVzdGVkQXR0cmlidXRlc2AgY29uZmlnXG4gICAqIGFuZCBidWlsZHMgdGhlIHBlci1yZWxhdGlvbnNoaXAgcGF5bG9hZCBvZiBkaXJ0eSBjaGlsZHJlbiBmb3IgYSBwYXJlbnQgc2F2ZS5cbiAgICpcbiAgICogSW5jbHVkZWQgY2hpbGRyZW46XG4gICAqICAgLSBuZXcgcmVjb3JkcyAoaXNOZXdSZWNvcmQoKSkg4oaSIGNyZWF0ZSBlbnRyeSB3aXRoIGF0dHJpYnV0ZXNcbiAgICogICAtIHJlY29yZHMgbWFya2VkIGZvciBkZXN0cnVjdGlvbiAobWFya2VkRm9yRGVzdHJ1Y3Rpb24oKSkg4oaSIGRlc3Ryb3kgZW50cnlcbiAgICogICAtIHJlY29yZHMgd2l0aCBjaGFuZ2VkIGF0dHJpYnV0ZXMgKGlzQ2hhbmdlZCgpKSDihpIgdXBkYXRlIGVudHJ5IHdpdGggYXR0cmlidXRlc1xuICAgKiAgIC0gcmVjb3JkcyB3aXRoIGRpcnR5IGRlc2NlbmRhbnRzIGluIHRoZWlyIG93biBuZXN0ZWRBdHRyaWJ1dGVzIOKGkiByZWN1cnNlXG4gICAqXG4gICAqIExvYWRlZCBidXQgdW50b3VjaGVkIHJlY29yZHMgYXJlIG9taXR0ZWQgc28gbmVzdGVkIHNhdmUgcHJlc2VydmVzIFJhaWxzLXN0eWxlXG4gICAqIFwiY2hpbGRyZW4gbm90IHJlZmVyZW5jZWQgaW4gcGF5bG9hZCBhcmUgbGVmdCBhbG9uZVwiIHNlbWFudGljcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj4+fSAtIFBlci1yZWxhdGlvbnNoaXAgbGlzdCBvZiBuZXN0ZWQtYXR0cmlidXRlIGVudHJpZXMuXG4gICAqL1xuICBhc3luYyBfYnVpbGROZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZCgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSBNb2RlbENsYXNzLnJlc291cmNlQ29uZmlnKClcbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnID0gcmVzb3VyY2VDb25maWc/Lm5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIGlmICghbmVzdGVkQXR0cmlidXRlc0NvbmZpZykgcmV0dXJuIHt9XG5cbiAgICAvKipcbiAgICAgKiBQYXlsb2FkLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pn0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnKSkge1xuICAgICAgLyoqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgICAgY29uc3QgZW50cmllcyA9IFtdXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCAmJiBBcnJheS5pc0FycmF5KHJlbGF0aW9uc2hpcC5fbG9hZGVkVmFsdWUpKSB7XG4gICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgcmVsYXRpb25zaGlwLl9sb2FkZWRWYWx1ZSkge1xuICAgICAgICAgIGNvbnN0IGNoaWxkRW50cnkgPSBhd2FpdCBjaGlsZC5fbmVzdGVkQXR0cmlidXRlc0VudHJ5Rm9yUGFyZW50U2F2ZSgpXG5cbiAgICAgICAgICBpZiAoY2hpbGRFbnRyeSkgZW50cmllcy5wdXNoKGNoaWxkRW50cnkpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwICYmIHJlbGF0aW9uc2hpcC5nZXRQcmVsb2FkZWQoKSkge1xuICAgICAgICBjb25zdCBjaGlsZCA9IHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICAgIGlmIChjaGlsZCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxCYXNlKSB7XG4gICAgICAgICAgY29uc3QgY2hpbGRFbnRyeSA9IGF3YWl0IGNoaWxkLl9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlGb3JQYXJlbnRTYXZlKClcblxuICAgICAgICAgIGlmIChjaGlsZEVudHJ5KSBlbnRyaWVzLnB1c2goY2hpbGRFbnRyeSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzLCByZWxhdGlvbnNoaXBOYW1lKSkge1xuICAgICAgICBlbnRyaWVzLnB1c2goXG4gICAgICAgICAgLi4uYXdhaXQgdGhpcy5fbmVzdGVkQXR0cmlidXRlc1BheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShcbiAgICAgICAgICAgIE1vZGVsQ2xhc3MsXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXNbcmVsYXRpb25zaGlwTmFtZV1cbiAgICAgICAgICApXG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgaWYgKGVudHJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgICBwYXlsb2FkW3JlbGF0aW9uc2hpcE5hbWVdID0gZW50cmllc1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBwYXlsb2FkIGVudHJ5IGZvciB0aGlzIGNoaWxkIHdoZW4gd2Fsa2VkIGJ5IGEgcGFyZW50J3NcbiAgICogYF9idWlsZE5lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkYC4gUmV0dXJucyBgbnVsbGAgd2hlbiB0aGUgY2hpbGQgaGFzIG5vXG4gICAqIGRpcnR5IHN0YXRlIGFuZCBubyBkaXJ0eSBkZXNjZW5kYW50cywgc28gdGhlIHBhcmVudCBjYW4gb21pdCBpdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gTmVzdGVkLWF0dHJpYnV0ZSBlbnRyeSBvciBudWxsIGlmIGNsZWFuLlxuICAgKi9cbiAgYXN5bmMgX25lc3RlZEF0dHJpYnV0ZXNFbnRyeUZvclBhcmVudFNhdmUoKSB7XG4gICAgaWYgKHRoaXMubWFya2VkRm9yRGVzdHJ1Y3Rpb24oKSkge1xuICAgICAgaWYgKHRoaXMuaXNOZXdSZWNvcmQoKSkgcmV0dXJuIG51bGxcbiAgICAgIHJldHVybiB7aWQ6IHRoaXMucGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKCksIF9kZXN0cm95OiB0cnVlfVxuICAgIH1cblxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLl9idWlsZE5lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkKClcbiAgICBjb25zdCBoYXNOZXN0ZWREaXJ0eSA9IE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDBcbiAgICBjb25zdCBhdHRhY2htZW50cyA9IGF3YWl0IHRoaXMuX2J1aWxkQXR0YWNobWVudHNQYXlsb2FkKClcbiAgICBjb25zdCBoYXNBdHRhY2htZW50cyA9IE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwXG5cbiAgICBpZiAodGhpcy5pc05ld1JlY29yZCgpKSB7XG4gICAgICAvKipcbiAgICAgICAqIEVudHJ5LlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IGVudHJ5ID0ge31cbiAgICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB0aGlzLl9jaGFuZ2VkQXR0cmlidXRlc0ZvclNhdmUoKVxuXG4gICAgICBpZiAoT2JqZWN0LmtleXMoYXR0cmlidXRlcykubGVuZ3RoID4gMCkgZW50cnkuYXR0cmlidXRlcyA9IGF0dHJpYnV0ZXNcbiAgICAgIGlmIChoYXNBdHRhY2htZW50cykgZW50cnkuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgICAgaWYgKGhhc05lc3RlZERpcnR5KSBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuXG4gICAgICByZXR1cm4gZW50cnlcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuaXNDaGFuZ2VkKCkgJiYgIWhhc05lc3RlZERpcnR5ICYmICFoYXNBdHRhY2htZW50cykgcmV0dXJuIG51bGxcblxuICAgIC8qKlxuICAgICAqIEVudHJ5LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgZW50cnkgPSB7aWQ6IHRoaXMucGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKCl9XG5cbiAgICBpZiAodGhpcy5pc0NoYW5nZWQoKSkgZW50cnkuYXR0cmlidXRlcyA9IHRoaXMuX2NoYW5nZWRBdHRyaWJ1dGVzRm9yU2F2ZSgpXG4gICAgaWYgKGhhc0F0dGFjaG1lbnRzKSBlbnRyeS5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgaWYgKGhhc05lc3RlZERpcnR5KSBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuXG4gICAgcmV0dXJuIGVudHJ5XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIG5lc3RlZCBlbnRyaWVzIGZyb20gYSBSYWlscy1zdHlsZSBzdWJtaXR0ZWQgYCpBdHRyaWJ1dGVzYCB2YWx1ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBQYXJlbnQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gTmVzdGVkIHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFN1Ym1pdHRlZCBuZXN0ZWQgYXR0cmlidXRlcyB2YWx1ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59IE5lc3RlZCBlbnRyaWVzIGZvciB0aGUgdHJhbnNwb3J0IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBfbmVzdGVkQXR0cmlidXRlc1BheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShNb2RlbENsYXNzLCByZWxhdGlvbnNoaXBOYW1lLCB2YWx1ZSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcERlZmluaXRpb24gPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcERlZmluaXRpb24ocmVsYXRpb25zaGlwTmFtZSlcbiAgICBjb25zdCBUYXJnZXRNb2RlbENsYXNzID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBNb2RlbENsYXNzKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcERlZmluaXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBuZXN0ZWQgcmVsYXRpb25zaGlwOiAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuICAgIGlmICghVGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIGlmIChyZWxhdGlvbnNoaXBUeXBlSXNDb2xsZWN0aW9uKHJlbGF0aW9uc2hpcERlZmluaXRpb24udHlwZSkpIHtcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfUF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBhcnJheWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgICAgdmFsdWUubWFwKGFzeW5jIChlbnRyeSkgPT4gYXdhaXQgdGhpcy5fbmVzdGVkQXR0cmlidXRlc0VudHJ5UGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKFRhcmdldE1vZGVsQ2xhc3MsIGVudHJ5KSlcbiAgICAgIClcbiAgICB9XG5cbiAgICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIFtdXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9QXR0cmlidXRlcyBtdXN0IGJlIGFuIG9iamVjdGApXG4gICAgfVxuXG4gICAgcmV0dXJuIFthd2FpdCB0aGlzLl9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoVGFyZ2V0TW9kZWxDbGFzcywgdmFsdWUpXVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIG9uZSBzdWJtaXR0ZWQgUmFpbHMtc3R5bGUgbmVzdGVkIGF0dHJpYnV0ZXMgb2JqZWN0IGludG8gdHJhbnNwb3J0IHBheWxvYWQgc2hhcGUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gTmVzdGVkIGNoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzdWJtaXR0ZWRFbnRyeSAtIFN1Ym1pdHRlZCBuZXN0ZWQgYXR0cmlidXRlcyBlbnRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gVHJhbnNwb3J0IG5lc3RlZC1hdHRyaWJ1dGVzIGVudHJ5LlxuICAgKi9cbiAgYXN5bmMgX25lc3RlZEF0dHJpYnV0ZXNFbnRyeVBheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShNb2RlbENsYXNzLCBzdWJtaXR0ZWRFbnRyeSkge1xuICAgIGlmICghZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KHN1Ym1pdHRlZEVudHJ5KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke01vZGVsQ2xhc3MubmFtZX0gbmVzdGVkIGF0dHJpYnV0ZXMgZW50cmllcyBtdXN0IGJlIG9iamVjdHNgKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGVudHJ5ID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBhdHRhY2htZW50cyA9IHt9XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pn0gKi9cbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzID0ge31cblxuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzdWJtaXR0ZWRFbnRyeSkpIHtcbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSBcImlkXCIgfHwgYXR0cmlidXRlTmFtZSA9PT0gXCJfZGVzdHJveVwiKSB7XG4gICAgICAgIGVudHJ5W2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgbmVzdGVkUmVsYXRpb25zaGlwTmFtZSA9IE1vZGVsQ2xhc3MubmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUoYXR0cmlidXRlTmFtZSlcblxuICAgICAgaWYgKG5lc3RlZFJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICAgICAgbmVzdGVkQXR0cmlidXRlc1tuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lXSA9IGF3YWl0IHRoaXMuX25lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoXG4gICAgICAgICAgTW9kZWxDbGFzcyxcbiAgICAgICAgICBuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHZhbHVlXG4gICAgICAgIClcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24oYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgICAgYXR0YWNobWVudHNbYXR0cmlidXRlTmFtZV0gPSBhd2FpdCB0aGlzLl9hdHRhY2htZW50UGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKE1vZGVsQ2xhc3MsIGF0dHJpYnV0ZU5hbWUsIHZhbHVlKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0cmlidXRlcykubGVuZ3RoID4gMCkgZW50cnkuYXR0cmlidXRlcyA9IGF0dHJpYnV0ZXNcbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDApIGVudHJ5LmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICBpZiAoT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykubGVuZ3RoID4gMCkgZW50cnkubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIHJldHVybiBlbnRyeVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBzdWJtaXR0ZWQgYXR0YWNobWVudCB2YWx1ZSBmb3IgdHJhbnNwb3J0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIG93bmluZyB0aGUgYXR0YWNobWVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFN1Ym1pdHRlZCBhdHRhY2htZW50IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXT59IE5vcm1hbGl6ZWQgYXR0YWNobWVudCBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgX2F0dGFjaG1lbnRQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoTW9kZWxDbGFzcywgYXR0YWNobWVudE5hbWUsIHZhbHVlKSB7XG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKGF0dGFjaG1lbnROYW1lKVxuXG4gICAgaWYgKGF0dGFjaG1lbnREZWZpbml0aW9uPy50eXBlID09PSBcImhhc01hbnlcIikge1xuICAgICAgY29uc3QgdmFsdWVzID0gQXJyYXkuaXNBcnJheSh2YWx1ZSkgPyB2YWx1ZSA6IFt2YWx1ZV1cblxuICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKHZhbHVlcy5tYXAoYXN5bmMgKGVudHJ5KSA9PiBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dChlbnRyeSkpKVxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgY29uc3QgbGFzdFZhbHVlID0gdmFsdWVbdmFsdWUubGVuZ3RoIC0gMV1cblxuICAgICAgaWYgKGxhc3RWYWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtNb2RlbENsYXNzLm5hbWV9IyR7YXR0YWNobWVudE5hbWV9IGF0dGFjaG1lbnQgYXJyYXkgY2Fubm90IGJlIGVtcHR5YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGxhc3RWYWx1ZSlcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogQWZ0ZXIgYSBwYXJlbnQgc2F2ZSB3aXRoIGBuZXN0ZWRBdHRyaWJ1dGVzYCwgdGhlIHNlcnZlciByZXNwb25zZSBpbmNsdWRlc1xuICAgKiBwcmVsb2FkZWQgdmVyc2lvbnMgb2YgdGhlIGFmZmVjdGVkIHJlbGF0aW9uc2hpcHMuIFRoaXMgcmVwbGFjZXMgdGhlIGxvY2FsXG4gICAqIGBfbG9hZGVkVmFsdWVgIGZvciBlYWNoIG5lc3RlZC13cml0YWJsZSByZWxhdGlvbnNoaXAgd2l0aCB0aGUgc2VydmVyJ3NcbiAgICogYXV0aG9yaXRhdGl2ZSBzZXQsIHNvIGRlc3Ryb3llZCBjaGlsZHJlbiBhcmUgZHJvcHBlZCBhbmQgbmV3bHktY3JlYXRlZFxuICAgKiBjaGlsZHJlbiBnZXQgdGhlaXIgc2VydmVyLWFzc2lnbmVkIGlkcyArIHBlcnNpc3RlZCBzdGF0ZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJlc3BvbnNlIC0gQ29tbWFuZCByZXNwb25zZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZWNvbmNpbGVOZXN0ZWRBdHRyaWJ1dGVzRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gTW9kZWxDbGFzcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlc0NvbmZpZyA9IHJlc291cmNlQ29uZmlnPy5uZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICBpZiAoIW5lc3RlZEF0dHJpYnV0ZXNDb25maWcpIHJldHVyblxuXG4gICAgY29uc3QgbW9kZWxEYXRhID0gTW9kZWxDbGFzcy5tb2RlbERhdGFGcm9tUmVzcG9uc2UocmVzcG9uc2UpXG4gICAgY29uc3QgcHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IG1vZGVsRGF0YS5wcmVsb2FkZWRSZWxhdGlvbnNoaXBzXG5cbiAgICAvKipcbiAgICAgKiBSZWxldmFudCBwcmVsb2Fkcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHJlbGV2YW50UHJlbG9hZHMgPSB7fVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXNDb25maWcpKSB7XG4gICAgICBpZiAocmVsYXRpb25zaGlwTmFtZSBpbiBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKSB7XG4gICAgICAgIHJlbGV2YW50UHJlbG9hZHNbcmVsYXRpb25zaGlwTmFtZV0gPSBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKHJlbGV2YW50UHJlbG9hZHMpLmxlbmd0aCA+IDApIHtcbiAgICAgIE1vZGVsQ2xhc3MuYXBwbHlQcmVsb2FkZWRSZWxhdGlvbnNoaXBzKHRoaXMsIHJlbGV2YW50UHJlbG9hZHMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZSBjb21tYW5kLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDb21tYW5kVHlwZX0gY29tbWFuZFR5cGUgLSBDb21tYW5kIHR5cGUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXlsb2FkIC0gQ29tbWFuZCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFBhcnNlZCBKU09OIHJlc3BvbnNlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGV4ZWN1dGVDb21tYW5kKGNvbW1hbmRUeXBlLCBwYXlsb2FkKSB7XG4gICAgY29uc3QgY29tbWFuZE5hbWUgPSB0aGlzLmNvbW1hbmROYW1lKGNvbW1hbmRUeXBlKVxuICAgIGNvbnN0IHRpbWVab25lID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKClcbiAgICBjb25zdCBzZXJpYWxpemVkUGF5bG9hZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHBheWxvYWQsIHt0aW1lWm9uZX0pKVxuICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KClcbiAgICBjb25zdCByZXF1ZXN0UGF5bG9hZCA9IG1lcmdlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0LCBzZXJpYWxpemVkUGF5bG9hZClcbiAgICBjb25zdCByZXNvdXJjZVBhdGggPSB0aGlzLnJlc291cmNlUGF0aCgpXG4gICAgY29uc3QgY29udGFpbnNBdHRhY2htZW50VXBsb2FkID0gZnJvbnRlbmRNb2RlbFBheWxvYWRDb250YWluc0F0dGFjaG1lbnRVcGxvYWQoc2VyaWFsaXplZFBheWxvYWQpXG4gICAgY29uc3QgdXNlU2hhcmVkVHJhbnNwb3J0ID0gIWNvbnRhaW5zQXR0YWNobWVudFVwbG9hZFxuICAgIGNvbnN0IHVybCA9IHVzZVNoYXJlZFRyYW5zcG9ydCA/IGZyb250ZW5kTW9kZWxBcGlVcmwoKSA6IGZyb250ZW5kTW9kZWxDb21tYW5kVXJsKHJlc291cmNlUGF0aCB8fCBcIlwiLCBjb21tYW5kTmFtZSlcblxuICAgIGlmICh1c2VTaGFyZWRUcmFuc3BvcnQpIHtcbiAgICAgIGNvbnN0IGJhdGNoUmVzcG9uc2UgPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMucHVzaCh7XG4gICAgICAgICAgY29tbWFuZE5hbWUsXG4gICAgICAgICAgY29tbWFuZFR5cGUsXG4gICAgICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgICAgICBwYXlsb2FkOiBzZXJpYWxpemVkUGF5bG9hZCxcbiAgICAgICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgICAgICByZWplY3QsXG4gICAgICAgICAgcmVxdWVzdElkOiBgJHsrK3NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0SWR9YCxcbiAgICAgICAgICByZXNvbHZlLFxuICAgICAgICAgIHJlc291cmNlUGF0aFxuICAgICAgICB9KVxuXG4gICAgICAgIHNjaGVkdWxlU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RGbHVzaCgpXG4gICAgICB9KVxuXG4gICAgICBjb25zdCBkZWNvZGVkQmF0Y2hSZXNwb25zZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoYmF0Y2hSZXNwb25zZSlcblxuICAgICAgdGhpcy50aHJvd09uRXJyb3JGcm9udGVuZE1vZGVsUmVzcG9uc2Uoe1xuICAgICAgICBjb21tYW5kVHlwZSxcbiAgICAgICAgcmVzcG9uc2U6IGRlY29kZWRCYXRjaFJlc3BvbnNlXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gZGVjb2RlZEJhdGNoUmVzcG9uc2VcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdHJhY2tGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdChhc3luYyAoKSA9PiBydW5XaXRoVHJhbnNwb3J0RGVhZGxpbmUoXG4gICAgICB7XG4gICAgICAgIGVycm9yTWVzc2FnZTogYCR7dGhpcy5uYW1lfSMke2NvbW1hbmRUeXBlfSByZXF1ZXN0IHRpbWVkIG91dGAsXG4gICAgICAgIHNpZ25hbDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpLFxuICAgICAgICB0aW1lb3V0TXM6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lb3V0TXMoKVxuICAgICAgfSxcbiAgICAgIGFzeW5jIChzaWduYWwpID0+IHtcbiAgICAgICAgY29uc3QgZGlyZWN0UmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXF1ZXN0UGF5bG9hZCksXG4gICAgICAgICAgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiLFxuICAgICAgICAgIGhlYWRlcnM6IGZyb250ZW5kTW9kZWxSZXF1ZXN0SGVhZGVycyh0aW1lWm9uZSksXG4gICAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICBzaWduYWxcbiAgICAgICAgfSlcblxuICAgICAgICBjb25zdCBkaXJlY3RSZXNwb25zZVRleHQgPSBhd2FpdCBkaXJlY3RSZXNwb25zZS50ZXh0KClcblxuICAgICAgICBpZiAoIWRpcmVjdFJlc3BvbnNlLm9rKSB7XG4gICAgICAgICAgdGhyb3dGcm9udGVuZE1vZGVsSHR0cEVycm9yKHtcbiAgICAgICAgICAgIGNvbW1hbmRMYWJlbDogYCR7dGhpcy5uYW1lfSMke2NvbW1hbmRUeXBlfWAsXG4gICAgICAgICAgICByZXNwb25zZTogZGlyZWN0UmVzcG9uc2UsXG4gICAgICAgICAgICByZXNwb25zZVRleHQ6IGRpcmVjdFJlc3BvbnNlVGV4dFxuICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBkaXJlY3RKc29uID0gZGlyZWN0UmVzcG9uc2VUZXh0Lmxlbmd0aCA+IDAgPyBKU09OLnBhcnNlKGRpcmVjdFJlc3BvbnNlVGV4dCkgOiB7fVxuICAgICAgICBjb25zdCBkZWNvZGVkRGlyZWN0UmVzcG9uc2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGRpcmVjdEpzb24pKVxuXG4gICAgICAgIHRoaXMudGhyb3dPbkVycm9yRnJvbnRlbmRNb2RlbFJlc3BvbnNlKHtcbiAgICAgICAgICBjb21tYW5kVHlwZSxcbiAgICAgICAgICByZXNwb25zZTogZGVjb2RlZERpcmVjdFJlc3BvbnNlXG4gICAgICAgIH0pXG5cbiAgICAgICAgcmV0dXJuIGRlY29kZWREaXJlY3RSZXNwb25zZVxuICAgICAgfVxuICAgICkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleGVjdXRlIGN1c3RvbSBjb21tYW5kLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3tjb21tYW5kTmFtZTogc3RyaW5nLCBjb21tYW5kVHlwZTogRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSwgbWVtYmVySWQ/OiBzdHJpbmcgfCBudW1iZXIgfCBudWxsLCBwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHJlc291cmNlUGF0aDogc3RyaW5nfX0gYXJncyAtIENvbW1hbmQgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+Pn0gLSBEZWNvZGVkIHJlc3BvbnNlIHBheWxvYWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZXhlY3V0ZUN1c3RvbUNvbW1hbmQoYXJncykge1xuICAgIGNvbnN0IHtjb21tYW5kTmFtZSwgY29tbWFuZFR5cGUsIG1lbWJlcklkID0gbnVsbCwgcGF5bG9hZCwgcmVzb3VyY2VQYXRofSA9IGFyZ3NcbiAgICBjb25zdCB0aW1lWm9uZSA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpXG4gICAgY29uc3Qgc2VyaWFsaXplZFBheWxvYWQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShwYXlsb2FkLCB7dGltZVpvbmV9KSlcbiAgICBjb25zdCByZXF1ZXN0Q29udGV4dCA9IGZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCgpXG5cbiAgICBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCwgc2VyaWFsaXplZFBheWxvYWQpXG4gICAgY29uc3QgY3VzdG9tUGF0aCA9IGZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kUGF0aCh7XG4gICAgICBjb21tYW5kTmFtZSxcbiAgICAgIG1lbWJlcklkLFxuICAgICAgbW9kZWxOYW1lOiB0aGlzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgcmVzb3VyY2VQYXRoXG4gICAgfSlcblxuICAgIGNvbnN0IGJhdGNoUmVzcG9uc2UgPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzLnB1c2goe1xuICAgICAgICBjb21tYW5kVHlwZSxcbiAgICAgICAgY3VzdG9tUGF0aCxcbiAgICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgICAgcGF5bG9hZDogc2VyaWFsaXplZFBheWxvYWQsXG4gICAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAgICByZWplY3QsXG4gICAgICAgIHJlcXVlc3RJZDogYCR7KytzaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdElkfWAsXG4gICAgICAgIHJlc29sdmVcbiAgICAgIH0pXG5cbiAgICAgIHNjaGVkdWxlU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RGbHVzaCgpXG4gICAgfSlcblxuICAgIGNvbnN0IGRlY29kZWRCYXRjaFJlc3BvbnNlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoYmF0Y2hSZXNwb25zZSlcblxuICAgIHRoaXMudGhyb3dPbkVycm9yRnJvbnRlbmRNb2RlbFJlc3BvbnNlKHtcbiAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgcmVzcG9uc2U6IGRlY29kZWRCYXRjaFJlc3BvbnNlXG4gICAgfSlcblxuICAgIHJldHVybiBkZWNvZGVkQmF0Y2hSZXNwb25zZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhyb3cgb24gZXJyb3IgZnJvbnRlbmQgbW9kZWwgcmVzcG9uc2UuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7e2NvbW1hbmRUeXBlOiBGcm9udGVuZE1vZGVsUmVxdWVzdENvbW1hbmRUeXBlLCByZXNwb25zZTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgdGhyb3dPbkVycm9yRnJvbnRlbmRNb2RlbFJlc3BvbnNlKGFyZ3MpIHtcbiAgICBjb25zdCB7Y29tbWFuZFR5cGUsIHJlc3BvbnNlfSA9IGFyZ3NcbiAgICBpZiAocmVzcG9uc2U/LnN0YXR1cyAhPT0gXCJlcnJvclwiKSByZXR1cm5cblxuICAgIGNvbnN0IHJlc3BvbnNlS2V5cyA9IE9iamVjdC5rZXlzKHJlc3BvbnNlKVxuICAgIGNvbnN0IGhhc09ubHlTdGF0dXMgPSByZXNwb25zZUtleXMubGVuZ3RoID09PSAxICYmIHJlc3BvbnNlS2V5c1swXSA9PT0gXCJzdGF0dXNcIlxuICAgIGNvbnN0IGhhc0Vycm9yTWVzc2FnZSA9IHR5cGVvZiByZXNwb25zZS5lcnJvck1lc3NhZ2UgPT09IFwic3RyaW5nXCIgJiYgcmVzcG9uc2UuZXJyb3JNZXNzYWdlLmxlbmd0aCA+IDBcbiAgICBjb25zdCBoYXNFcnJvckVudmVsb3BlS2V5cyA9IEJvb2xlYW4oXG4gICAgICByZXNwb25zZS5jb2RlICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHJlc3BvbnNlLmVycm9yICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHJlc3BvbnNlLmVycm9ycyAhPT0gdW5kZWZpbmVkXG4gICAgICB8fCByZXNwb25zZS5tZXNzYWdlICE9PSB1bmRlZmluZWRcbiAgICApXG4gICAgY29uc3Qgbm9uU3RhdHVzS2V5cyA9IHJlc3BvbnNlS2V5cy5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcInN0YXR1c1wiKVxuICAgIGNvbnN0IGNvbmZpZ3VyZWRBdHRyaWJ1dGVOYW1lcyA9IHRoaXMuY29uZmlndXJlZEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVOYW1lcygpXG4gICAgY29uc3QgbG9va3NMaWtlUmF3TW9kZWxQYXlsb2FkID0gbm9uU3RhdHVzS2V5cy5sZW5ndGggPiAwXG4gICAgICAmJiBub25TdGF0dXNLZXlzLmV2ZXJ5KChrZXkpID0+IGNvbmZpZ3VyZWRBdHRyaWJ1dGVOYW1lcy5oYXMoa2V5KSlcblxuICAgIGlmICghaGFzRXJyb3JNZXNzYWdlICYmICFoYXNPbmx5U3RhdHVzICYmICFoYXNFcnJvckVudmVsb3BlS2V5cyAmJiBsb29rc0xpa2VSYXdNb2RlbFBheWxvYWQpIHJldHVyblxuXG4gICAgY29uc3QgZGVidWdFcnJvck1lc3NhZ2UgPSB0eXBlb2YgcmVzcG9uc2UuZGVidWdFcnJvck1lc3NhZ2UgPT09IFwic3RyaW5nXCIgJiYgcmVzcG9uc2UuZGVidWdFcnJvck1lc3NhZ2UubGVuZ3RoID4gMFxuICAgICAgPyByZXNwb25zZS5kZWJ1Z0Vycm9yTWVzc2FnZVxuICAgICAgOiBudWxsXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZGVidWdFcnJvck1lc3NhZ2UgfHwgKGhhc0Vycm9yTWVzc2FnZVxuICAgICAgPyByZXNwb25zZS5lcnJvck1lc3NhZ2VcbiAgICAgIDogYFJlcXVlc3QgZmFpbGVkIGZvciAke3RoaXMubmFtZX0jJHtjb21tYW5kVHlwZX1gKVxuXG4gICAgY29uc3QgZXJyb3IgPSAvKiogQHR5cGUge0Vycm9yICYge2NvcnJlbGF0aW9uSWQ/OiBzdHJpbmcsIGRldGFpbHM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGVycm9yTWVzc2FnZT86IHN0cmluZywgdmVsb2Npb3VzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBlcnJvclR5cGU/OiBzdHJpbmcsIHZhbGlkYXRpb25FcnJvcnM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGRlYnVnRXJyb3JDbGFzcz86IHN0cmluZywgZGVidWdCYWNrdHJhY2U/OiBzdHJpbmdbXX19ICovIChuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKSlcbiAgICBpZiAoaGFzRXJyb3JNZXNzYWdlKSB7XG4gICAgICBlcnJvci5lcnJvck1lc3NhZ2UgPSByZXNwb25zZS5lcnJvck1lc3NhZ2VcbiAgICB9XG4gICAgaWYgKHJlc3BvbnNlLnZlbG9jaW91cyAmJiB0eXBlb2YgcmVzcG9uc2UudmVsb2Npb3VzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBlcnJvci52ZWxvY2lvdXMgPSByZXNwb25zZS52ZWxvY2lvdXNcbiAgICB9XG4gICAgaWYgKHR5cGVvZiByZXNwb25zZS5lcnJvclR5cGUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGVycm9yLmVycm9yVHlwZSA9IHJlc3BvbnNlLmVycm9yVHlwZVxuICAgIH1cbiAgICBpZiAocmVzcG9uc2UudmFsaWRhdGlvbkVycm9ycyAmJiB0eXBlb2YgcmVzcG9uc2UudmFsaWRhdGlvbkVycm9ycyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgZXJyb3IudmFsaWRhdGlvbkVycm9ycyA9IHJlc3BvbnNlLnZhbGlkYXRpb25FcnJvcnNcbiAgICB9XG4gICAgaWYgKHJlc3BvbnNlLmRldGFpbHMgJiYgdHlwZW9mIHJlc3BvbnNlLmRldGFpbHMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGVycm9yLmRldGFpbHMgPSByZXNwb25zZS5kZXRhaWxzXG4gICAgfVxuICAgIGlmICh0eXBlb2YgcmVzcG9uc2UuY29ycmVsYXRpb25JZCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgZXJyb3IuY29ycmVsYXRpb25JZCA9IHJlc3BvbnNlLmNvcnJlbGF0aW9uSWRcbiAgICB9XG4gICAgLy8gRm9yd2FyZCBzZXJ2ZXItcHJvdmlkZWQgZGVidWcgZGV0YWlsIChpbmNsdWRlZCBvbmx5IHdoZW4gdGhlIGJhY2tlbmRcbiAgICAvLyBkZWVtcyB0aGUgcmVxdWVzdGVyIGFsbG93ZWQgdG8gc2VlIGl0LCBlLmcuIGFuIGFkbWluKSBzbyBjYWxsZXJzIGNhblxuICAgIC8vIHJlbmRlciB0aGUgcmVhbCBlcnJvciBjbGFzcyBhbmQgc3RhY2sgdHJhY2UgaW5zdGVhZCBvZiB0aGUgZ2VuZXJpY1xuICAgIC8vIGNsaWVudC1zYWZlIG1lc3NhZ2UuXG4gICAgaWYgKHR5cGVvZiByZXNwb25zZS5kZWJ1Z0Vycm9yQ2xhc3MgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGVycm9yLmRlYnVnRXJyb3JDbGFzcyA9IHJlc3BvbnNlLmRlYnVnRXJyb3JDbGFzc1xuICAgIH1cbiAgICBpZiAoQXJyYXkuaXNBcnJheShyZXNwb25zZS5kZWJ1Z0JhY2t0cmFjZSkpIHtcbiAgICAgIGVycm9yLmRlYnVnQmFja3RyYWNlID0gcmVzcG9uc2UuZGVidWdCYWNrdHJhY2VcbiAgICB9XG4gICAgdGhyb3cgZXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbmZpZ3VyZWQgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIG5hbWVzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gQ29uZmlndXJlZCBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqL1xuICBzdGF0aWMgY29uZmlndXJlZEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVOYW1lcygpIHtcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodGhpcy5yZXNvdXJjZUNvbmZpZygpKVxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSByZXNvdXJjZUNvbmZpZy5hdHRyaWJ1dGVzXG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVzKSkge1xuICAgICAgcmV0dXJuIG5ldyBTZXQoYXR0cmlidXRlcy5maWx0ZXIoKGF0dHJpYnV0ZU5hbWUpID0+IHR5cGVvZiBhdHRyaWJ1dGVOYW1lID09PSBcInN0cmluZ1wiKSlcbiAgICB9XG5cbiAgICBpZiAoYXR0cmlidXRlcyAmJiB0eXBlb2YgYXR0cmlidXRlcyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgcmV0dXJuIG5ldyBTZXQoT2JqZWN0LmtleXMoYXR0cmlidXRlcykpXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBTZXQoKVxuICB9XG59XG5cbi8qKiBQdWJsaWMgZnJvbnRlbmQgbW9kZWwgZm9yIHNhZmUgVmVsb2Npb3VzIGF0dGFjaG1lbnQgbWV0YWRhdGEuICovXG5leHBvcnQgY2xhc3MgVmVsb2Npb3VzQXR0YWNobWVudCBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnfSAtIFJlc291cmNlIGNvbmZpZy5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcbiAgICByZXR1cm4ge1xuICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICBieXRlU2l6ZToge3R5cGU6IFwiaW50ZWdlclwifSxcbiAgICAgICAgY29udGVudFR5cGU6IHtudWxsOiB0cnVlLCB0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgICAgIGNyZWF0ZWRBdDoge3R5cGU6IFwiZGF0ZXRpbWVcIn0sXG4gICAgICAgIGZpbGVuYW1lOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgICAgICBpZDoge3R5cGU6IFwidXVpZFwifSxcbiAgICAgICAgbmFtZToge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICAgICAgcG9zaXRpb246IHt0eXBlOiBcImludGVnZXJcIn0sXG4gICAgICAgIHJlY29yZElkOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgICAgICByZWNvcmRUeXBlOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgICAgICB1cGRhdGVkQXQ6IHt0eXBlOiBcImRhdGV0aW1lXCJ9XG4gICAgICB9LFxuICAgICAgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kczogW1wiaW5kZXhcIl0sXG4gICAgICBidWlsdEluTWVtYmVyQ29tbWFuZHM6IFtcImZpbmRcIl0sXG4gICAgICBtb2RlbE5hbWU6IFwiVmVsb2Npb3VzQXR0YWNobWVudFwiLFxuICAgICAgcHJpbWFyeUtleTogXCJpZFwiXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGF0dGFjaG1lbnQgbWV0YWRhdGEgYnkgaXRzIHB1YmxpYyBpZCB0aHJvdWdoIHRoZSBtZW1iZXIgYXV0aG9yaXphdGlvbiBwYXRoLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBBdHRhY2htZW50IGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIFJlc29sdmVkIGF0dGFjaG1lbnQgbWV0YWRhdGEuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZChpZCkge1xuICAgIHJldHVybiB0aGlzLmluc3RhbnRpYXRlRnJvbVJlc3BvbnNlKGF3YWl0IHRoaXMuZXhlY3V0ZUNvbW1hbmQoXCJmaW5kXCIsIHtpZH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgaWQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0YWNobWVudCBpZC5cbiAgICovXG4gIGlkKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwiaWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBvd25lciBtb2RlbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE93bmVyIG1vZGVsIG5hbWUuXG4gICAqL1xuICByZWNvcmRUeXBlKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwicmVjb3JkVHlwZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIG93bmVyIHJlY29yZCBpZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBPd25lciByZWNvcmQgaWQuXG4gICAqL1xuICByZWNvcmRJZCgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcInJlY29yZElkXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBuYW1lIG9uIHRoZSBvd25lciBtb2RlbC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBdHRhY2htZW50IG5hbWUgb24gdGhlIG93bmVyIG1vZGVsLlxuICAgKi9cbiAgbmFtZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcIm5hbWVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IHBvc2l0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEF0dGFjaG1lbnQgcG9zaXRpb24uXG4gICAqL1xuICBwb3NpdGlvbigpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcInBvc2l0aW9uXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBmaWxlbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBdHRhY2htZW50IGZpbGVuYW1lLlxuICAgKi9cbiAgZmlsZW5hbWUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJmaWxlbmFtZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgY29udGVudCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBBdHRhY2htZW50IGNvbnRlbnQgdHlwZS5cbiAgICovXG4gIGNvbnRlbnRUeXBlKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwiY29udGVudFR5cGVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IGJ5dGUgc2l6ZS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBBdHRhY2htZW50IGJ5dGUgc2l6ZS5cbiAgICovXG4gIGJ5dGVTaXplKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwiYnl0ZVNpemVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjcmVhdGVkLWF0IHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge0RhdGV9IC0gQ3JlYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqL1xuICBjcmVhdGVkQXQoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJjcmVhdGVkQXRcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSB1cGRhdGVkLWF0IHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge0RhdGV9IC0gVXBkYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqL1xuICB1cGRhdGVkQXQoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJ1cGRhdGVkQXRcIikgfVxufVxuXG5Gcm9udGVuZE1vZGVsQmFzZS5yZWdpc3Rlck1vZGVsKFZlbG9jaW91c0F0dGFjaG1lbnQpXG4iXX0=