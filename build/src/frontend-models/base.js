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
            applyFrontendModelPersistedIdentity(this.ModelClass, listener.instance, identity);
            rekeyFrontendModelInstanceListeners(this.ModelClass, listener.instance, previousIdentity, identity);
        }
        if (!body.record || typeof body.record !== "object")
            return;
        const deserializedRecord = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(body.record));
        const freshModel = /** @type {ReturnType<typeof JSON.parse>} */ (this.ModelClass).instantiateFromResponse(deserializedRecord);
        if (action === "update" && listener) {
            const instanceAny = /** @type {ReturnType<typeof JSON.parse>} */ (listener.instance);
            instanceAny._attachmentOwner = freshModel._attachmentOwner;
            const matchingUpdateCallbacks = Array.from(listener.updateCallbacks).filter((entry) => frontendModelEventEntryMatches(entry, matchedEventFilterKeys));
            if (matchingUpdateCallbacks.length > 0) {
                // Auto-merge into the registered instance so callers reading
                // through the same handle see fresh attributes.
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
 * Applies a remotely persisted identity to a listener instance without merging an unavailable record payload.
 * @param {FrontendModelClass} ModelClass - Frontend model class.
 * @param {FrontendModelBase} instance - Listener instance receiving the identity.
 * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} identity - Persisted identity.
 * @returns {void}
 */
function applyFrontendModelPersistedIdentity(ModelClass, instance, identity) {
    const identityAttributes = modelPrimaryKeyConditions(ModelClass.primaryKey(), identity);
    instance.assignAttributes(identityAttributes);
    for (const attributeName of Object.keys(identityAttributes)) {
        instance.markAttributeUnchanged(attributeName);
    }
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
        const identity = this.isNewRecord() ? this.primaryKeyValue() : this.persistedPrimaryKeyValue();
        const id = modelPrimaryKeyCacheKey(ModelClass.primaryKey(), identity);
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
        const identity = this.isNewRecord() ? this.primaryKeyValue() : this.persistedPrimaryKeyValue();
        const id = modelPrimaryKeyCacheKey(ModelClass.primaryKey(), identity);
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
        const primaryKey = ModelClass.primaryKey();
        const previousIdentity = isNew ? null : this.persistedPrimaryKeyValue();
        const listenerIdentityBeforeSave = isNew
            && Array.isArray(primaryKey)
            && primaryKey.every((attributeName) => {
                const value = this._attributes[attributeName];
                return typeof value === "string" || typeof value === "number";
            })
            ? this.primaryKeyValue()
            : previousIdentity;
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
        if (listenerIdentityBeforeSave !== null) {
            rekeyFrontendModelInstanceListeners(ModelClass, this, listenerIdentityBeforeSave, this.primaryKeyValue());
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbHMvYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxPQUFPLE1BQU0sMkJBQTJCLENBQUE7QUFDL0MsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxrQkFBa0IsRUFBRSxFQUFDLGdDQUFnQyxFQUFDLE1BQU0sWUFBWSxDQUFBO0FBQy9FLE9BQU8sc0JBQXNCLE1BQU0sZ0JBQWdCLENBQUE7QUFDbkQsT0FBTyxFQUFDLDJCQUEyQixFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0UsT0FBTyxFQUFDLHFCQUFxQixFQUFFLHlCQUF5QixFQUFDLE1BQU0scUJBQXFCLENBQUE7QUFDcEYsT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGlDQUFpQyxFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0gsT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDekgsT0FBTyx3QkFBd0IsTUFBTSx5QkFBeUIsQ0FBQTtBQUM5RCxPQUFPLEVBQUMsd0JBQXdCLEVBQUUsZ0JBQWdCLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUMxRSxPQUFPLHdCQUF3QixNQUFNLG9DQUFvQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyx1QkFBdUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ3BFLE9BQU8sRUFBQyx3Q0FBd0MsRUFBRSxzQ0FBc0MsRUFBQyxNQUFNLDZCQUE2QixDQUFBO0FBQzVILE9BQU8sRUFBQyxtQkFBbUIsRUFBRSwyQkFBMkIsRUFBRSwyQkFBMkIsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ3hILE9BQU8sRUFBQyxnQkFBZ0IsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQ3hELE9BQU8sYUFBYSxNQUFN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LEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRTtRQUNsQixPQUFPLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsTUFBTSxFQUFFLEVBQUMsRUFBRSxFQUFDLENBQUMsQ0FBQyxDQUFBO0lBQzlFLENBQUM7SUFFRDs7O09BR0c7SUFDSCxFQUFFLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUV4Qzs7O09BR0c7SUFDSCxVQUFVLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUV4RDs7O09BR0c7SUFDSCxRQUFRLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVwRDs7O09BR0c7SUFDSCxJQUFJLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUU1Qzs7O09BR0c7SUFDSCxRQUFRLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVwRDs7O09BR0c7SUFDSCxRQUFRLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVwRDs7O09BR0c7SUFDSCxXQUFXLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUUxRDs7O09BR0c7SUFDSCxRQUFRLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVwRDs7O09BR0c7SUFDSCxTQUFTLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUV0RDs7O09BR0c7SUFDSCxTQUFTLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFBLENBQUMsQ0FBQztDQUN2RDtBQUVELGlCQUFpQixDQUFDLGFBQWEsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHRpbWVvdXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IHdhaXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3dhaXQuanNcIlxuaW1wb3J0IEZyb250ZW5kTW9kZWxRdWVyeSwge2Zyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkfSBmcm9tIFwiLi9xdWVyeS5qc1wiXG5pbXBvcnQgRnJvbnRlbmRNb2RlbFByZWxvYWRlciBmcm9tIFwiLi9wcmVsb2FkZXIuanNcIlxuaW1wb3J0IHtub3JtYWxpemVEYXRlU3RyaW5nRm9yV3JpdGV9IGZyb20gXCIuLi9kYXRhYmFzZS9kYXRldGltZS1zdG9yYWdlLmpzXCJcbmltcG9ydCB7cmVnaXN0ZXJGcm9udGVuZE1vZGVsLCByZXNvbHZlRnJvbnRlbmRNb2RlbENsYXNzfSBmcm9tIFwiLi9tb2RlbC1yZWdpc3RyeS5qc1wiXG5pbXBvcnQge3ZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWUsIHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aH0gZnJvbSBcIi4vcmVzb3VyY2UtY29uZmlnLXZhbGlkYXRpb24uanNcIlxuaW1wb3J0IHtkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSwgc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBmcm9tIFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiXG5pbXBvcnQgcnVuV2l0aFRyYW5zcG9ydERlYWRsaW5lIGZyb20gXCIuL3RyYW5zcG9ydC1kZWFkbGluZS5qc1wiXG5pbXBvcnQge1JFUVVFU1RfVElNRV9aT05FX0hFQURFUiwgdmFsaWRhdGVUaW1lWm9uZX0gZnJvbSBcIi4uL3RpbWUtem9uZS5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50IGZyb20gXCIuLi9odHRwLWNsaWVudC93ZWJzb2NrZXQtY2xpZW50LmpzXCJcbmltcG9ydCB7cmVtb3RlUmVxdWVzdENvbnRleHRLZXl9IGZyb20gXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCJcbmltcG9ydCB7Y2FwdHVyZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dCwgbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHR9IGZyb20gXCIuL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuaW1wb3J0IHtidWZmZXJPdXRnb2luZ0V2ZW50LCBjbGVhckJ1ZmZlcmVkT3V0Z29pbmdFdmVudHMsIGRyYWluQnVmZmVyZWRPdXRnb2luZ0V2ZW50c30gZnJvbSBcIi4vb3V0Z29pbmctZXZlbnQtYnVmZmVyLmpzXCJcbmltcG9ydCB7ZGVmaW5lTW9kZWxTY29wZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCJcbmltcG9ydCBpc1BsYWluT2JqZWN0IGZyb20gXCIuLi91dGlscy9wbGFpbi1vYmplY3QuanNcIlxuaW1wb3J0IHtmb3JjZWROb25CbGFua1N0cmluZ30gZnJvbSBcInR5cGFuaWNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDYWNoZUtleSwgbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucywgcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlLCBzY2FsYXJNb2RlbFByaW1hcnlLZXksIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuaW1wb3J0IHtyZWFkUGF5bG9hZEFzc29jaWF0aW9uQ291bnQsIHJlYWRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5LCByZWFkUGF5bG9hZFF1ZXJ5RGF0YSwgc2V0UGF5bG9hZEFzc29jaWF0aW9uQ291bnQsIHNldFBheWxvYWRDb21wdXRlZEFiaWxpdHksIHNldFBheWxvYWRRdWVyeURhdGF9IGZyb20gXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIlxuXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIHJlbGF0aW9uc2hpcCBoZWxwZXIgdHlwZS4gUmV0dXJuZWQgYnkgYGdldFJlbGF0aW9uc2hpcEJ5TmFtZWAsXG4gKiB3aGljaCBnZW5lcmF0ZWQgbW9kZWxzIGltbWVkaWF0ZWx5IGNhc3QgdG8gdGhlaXIgY29uY3JldGUgcmVsYXRpb25zaGlwIHR5cGVcbiAqIChlLmcuIGBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXA8T3duZXIsIFRhcmdldCwgVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz5gKS5cbiAqIFRoZSBtZW1iZXJzIHVzZSBgYW55YCB0eXBlIGFyZ3Mgc28gdGhhdCBjYXN0IGlzIGFsbG93ZWQgcmVnYXJkbGVzcyBvZiB0aGVcbiAqIHRhcmdldCBtb2RlbCdzIHR5cGVkLWF0dHJpYnV0ZSBnZW5lcmljcyDigJQgYSBjb25jcmV0ZSBgRnJvbnRlbmRNb2RlbEJhc2VgIG1lbWJlclxuICogaGVyZSBtYWtlcyB0aGUgY2FzdCBhIG5vbi1vdmVybGFwcGluZyAoVFMyMzUyKSBlcnJvciBmb3IgZXZlcnkgdHlwZWQgbW9kZWwuXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXA8YW55LCBhbnksIGFueT4gfCBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXA8YW55LCBhbnksIGFueT59IEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7Y2FsbGJhY2s6IChwYXlsb2FkOiB7aWQ6IHN0cmluZyB8IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLkNvbXBvc2l0ZU1vZGVsUHJpbWFyeUtleVZhbHVlLCBtb2RlbDogRnJvbnRlbmRNb2RlbEJhc2V9KSA9PiB2b2lkLCBldmVudEZpbHRlcktleTogc3RyaW5nIHwgbnVsbCwgZXZlbnRGaWx0ZXJQYXlsb2FkOiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWQgfCBudWxsLCBwcm9qZWN0aW9uUGF5bG9hZDogaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9fSBGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnlcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7Y2FsbGJhY2s6IChwYXlsb2FkOiB7aWQ6IHN0cmluZyB8IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLkNvbXBvc2l0ZU1vZGVsUHJpbWFyeUtleVZhbHVlfSkgPT4gdm9pZH19IEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5XG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbENvbW1hbmRUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7XCJjcmVhdGVcIiB8IFwiZmluZFwiIHwgXCJpbmRleFwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IEZyb250ZW5kTW9kZWxDb21tYW5kVHlwZSAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVxdWVzdENvbW1hbmRUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbENvbW1hbmRUeXBlIHwgc3RyaW5nfSBGcm9udGVuZE1vZGVsUmVxdWVzdENvbW1hbmRUeXBlICovXG4vKipcbiAqIE1vZGVsLWxpa2UgaW5zdGFuY2UgdmFsdWUgc3VwcG9ydGVkIGJ5IGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydC5cbiAqIEB0eXBlZGVmIHt7YXR0cmlidXRlczogKCkgPT4gUmVjb3JkPHN0cmluZywgdW5rbm93bj59fSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0TW9kZWxWYWx1ZVxuICovXG4vKipcbiAqIFNwZWNpYWwgc2NhbGFyIHZhbHVlcyByZXN0b3JlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQuXG4gKiBAdHlwZWRlZiB7dW5kZWZpbmVkIHwgbnVsbCB8IGJvb2xlYW4gfCBudW1iZXIgfCBzdHJpbmcgfCBiaWdpbnQgfCBEYXRlIHwgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydE1vZGVsVmFsdWV9IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRTY2FsYXJWYWx1ZVxuICovXG4vKipcbiAqIFBsYWluIG9iamVjdCBzdXBwb3J0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHZhbHVlcy5cbiAqIE5lc3RlZCB2YWx1ZXMgYXJlIGludGVudGlvbmFsbHkgb3BhcXVlIGJlY2F1c2UgVHlwZVNjcmlwdCByZWplY3RzIHJlY3Vyc2l2ZVxuICogSlNEb2MgdHlwZWRlZnMgZm9yIHRoaXMgdHJhbnNwb3J0IHZhbHVlIGNvbnRyYWN0LlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0T2JqZWN0XG4gKi9cbi8qKlxuICogVmFsdWUgc3VwcG9ydGVkIGJ5IGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCBzZXJpYWxpemF0aW9uIGFuZCBkZXNlcmlhbGl6YXRpb24uXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNjYWxhclZhbHVlIHwgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydE9iamVjdCB8IEFycmF5PHVua25vd24+fSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVcbiAqL1xuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgdmFsdWUgdXNlZCB3aGVuIGdlbmVyYXRlZCBtZXRhZGF0YSBjYW5ub3QgaW5mZXIgYSBuYXJyb3dlciB0eXBlLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e3N5bmM/OiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkF0dGFjaG1lbnRTeW5jQ29uZmlndXJhdGlvbiwgdHlwZTogXCJoYXNPbmVcIiB8IFwiaGFzTWFueVwifX0gRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREZWZpbml0aW9uXG4gKi9cbi8qKlxuICogRGVmaW5lcyBmcm9udGVuZC1tb2RlbCBhdHRyaWJ1dGUgbWV0YWRhdGEuXG4gKiBAdHlwZWRlZiB7e2NvbHVtblR5cGU/OiBzdHJpbmcsIGRhdGFUeXBlPzogc3RyaW5nLCBqc0RvY1R5cGU/OiBzdHJpbmcsIG5hbWU/OiBzdHJpbmcsIG51bGw/OiBib29sZWFuLCBzZWxlY3RlZEJ5RGVmYXVsdD86IGJvb2xlYW4sIHNxbFR5cGU/OiBzdHJpbmcsIHR5cGU/OiBzdHJpbmd9fSBGcm9udGVuZE1vZGVsQXR0cmlidXRlRGVmaW5pdGlvblxuICovXG4vKipcbiAqIEF0dGFjaG1lbnQgaW5wdXQgYWNjZXB0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgYXR0YWNobWVudCBoZWxwZXJzIGJlZm9yZSBub3JtYWxpemF0aW9uLlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHthcnJheUJ1ZmZlcjogKCkgPT4gUHJvbWlzZTxBcnJheUJ1ZmZlcj4sIHR5cGU/OiBzdHJpbmcsIG5hbWU/OiBzdHJpbmd9IHwgbnVsbCB8IHVuZGVmaW5lZH0gRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRJbnB1dFxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IEZyb250ZW5kTW9kZWxTeW5jTWV0YWRhdGFcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHtcIm9wdGltaXN0aWNWZXJzaW9uXCIgfCBcInNlcnZlcldpbnNcIiB8IFwibGFzdFdyaXRlcldpbnNcIiB8IFwiZmllbGRUaHJlZVdheVwiIHwgXCJhcHBlbmRPbmx5XCJ9IEZyb250ZW5kTW9kZWxTeW5jQ29uZmxpY3RTdHJhdGVneVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tlbmFibGVkOiBib29sZWFuLCBvcGVyYXRpb25zOiBzdHJpbmdbXSwgcG9saWN5SGFzaDogc3RyaW5nLCBwb2xpY3lWZXJzaW9uOiBzdHJpbmcgfCBudWxsLCBjb25mbGljdFN0cmF0ZWd5PzogRnJvbnRlbmRNb2RlbFN5bmNDb25mbGljdFN0cmF0ZWd5LCBtZXRhZGF0YT86IEZyb250ZW5kTW9kZWxTeW5jTWV0YWRhdGF9fSBGcm9udGVuZE1vZGVsU3luY0NvbmZpZ1xuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3thdHRyaWJ1dGVzPzogQXJyYXk8c3RyaW5nIHwgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZURlZmluaXRpb24+IHwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZURlZmluaXRpb24+LCBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzPzogc3RyaW5nW10sIGJ1aWx0SW5NZW1iZXJDb21tYW5kcz86IHN0cmluZ1tdLCBjb2xsZWN0aW9uQ29tbWFuZHM/OiBzdHJpbmdbXSwgY29tbWFuZHM/OiBzdHJpbmdbXSwgbWVtYmVyQ29tbWFuZHM/OiBzdHJpbmdbXSwgYXR0YWNobWVudHM/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0YWNobWVudERlZmluaXRpb24+LCBtb2RlbE5hbWU/OiBzdHJpbmcsIG5lc3RlZEF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB7YWxsb3dEZXN0cm95PzogYm9vbGVhbiwgbGltaXQ/OiBudW1iZXJ9PiwgcHJpbWFyeUtleT86IHN0cmluZyB8IHN0cmluZ1tdLCByZWxhdGlvbnNoaXBzPzogc3RyaW5nW10sIHN5bmM/OiBGcm9udGVuZE1vZGVsU3luY0NvbmZpZ319IEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ1xuICovXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIGNvbnN0cnVjdG9yIHR5cGUuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlfSBbVD1Gcm9udGVuZE1vZGVsQmFzZV1cbiAqIEB0eXBlZGVmIHt7bmV3IChhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPik6IFR9fSBGcm9udGVuZE1vZGVsQ29uc3RydWN0b3JcbiAqL1xuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCBzdGF0aWMgc2lkZS5cbiAqXG4gKiBUaGUgdGVtcGxhdGUgZGVmYXVsdHMgYXJlIGludGVudGlvbmFsbHkgcGVybWlzc2l2ZSAoYGFueWAgbW9kZWwvYXR0cmlidXRlXG4gKiBwYXJhbXMpLiBUaGUgYmFyZSBgRnJvbnRlbmRNb2RlbENsYXNzYCBpcyB0aGUgYEB0aGlzYC9jb25zdHJhaW50IHR5cGUgb24gdGhlXG4gKiBzdGF0aWMgcXVlcnkgbWV0aG9kcyAoZmluZEJ5L2ZpbmQvd2hlcmUvcHJlbG9hZC8uLi4pOyBhIGdlbmVyYXRlZCBzdWJjbGFzc1xuICogZGVjbGFyZXMgdHlwZWQtYXR0cmlidXRlIGdlbmVyaWNzIChlLmcuIGBGcm9udGVuZE1vZGVsQmFzZTxBY2NvdW50QXR0cmlidXRlcyxcbiAqIEFjY291bnRDcmVhdGVBdHRyaWJ1dGVzLCBBY2NvdW50VXBkYXRlQXR0cmlidXRlcz5gKSB3aGljaCwgYWdhaW5zdCBhIGNvbmNyZXRlXG4gKiBgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPmAgZGVmYXVsdCwgZmFpbCB0aGUgY29uc3RyYWludCBieVxuICogaW52YXJpYW5jZS4gRGVmYXVsdGluZyB0byBgYW55YCBsZXRzIGFueSBzdWJjbGFzcyBzYXRpc2Z5IHRoZSBjb25zdHJhaW50IHdoaWxlXG4gKiB0aGUgbWV0aG9kcycgb3duIGBAdGVtcGxhdGUgVGAgc3RpbGwgY2FwdHVyZXMgdGhlIHByZWNpc2UgY2FsbGluZyBjbGFzcyBmb3JcbiAqIHRoZWlyIHJldHVybiB0eXBlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2V9IFtUPUZyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnk+XVxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtBdHRyaWJ1dGVzPWFueV1cbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbQ3JlYXRlQXR0cmlidXRlcz1hbnldXG4gKiBAdHlwZWRlZiB7e25ldyAoKTogVCwgY3JlYXRlKGF0dHJpYnV0ZXM/OiBDcmVhdGVBdHRyaWJ1dGVzKTogUHJvbWlzZTxUPn0gJiBPbWl0PHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZSwgXCJjcmVhdGVcIiB8IFwicHJvdG90eXBlXCI+fSBGcm9udGVuZE1vZGVsQ2xhc3NcbiAqL1xuLyoqXG4gKiBDcmVhdGUgYXR0cmlidXRlcyBhY2NlcHRlZCBieSBhIGZyb250ZW5kIG1vZGVsIGluc3RhbmNlLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZX0gVFxuICogQHR5cGVkZWYge1QgZXh0ZW5kcyBGcm9udGVuZE1vZGVsQmFzZTxSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBpbmZlciBDcmVhdGVBdHRyaWJ1dGVzLCBpbmZlciBfVXBkYXRlQXR0cmlidXRlcz4gPyBDcmVhdGVBdHRyaWJ1dGVzIDogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gRnJvbnRlbmRNb2RlbENyZWF0ZUF0dHJpYnV0ZXNGb3JcbiAqL1xuLyoqXG4gKiBMb2FkZWQgaW5zdGFuY2UgdHlwZSBmb3IgcmVsYXRpb25zaGlwIGhlbHBlciBnZW5lcmljcy4gT2xkZXIgZ2VuZXJhdGVkXG4gKiBmcm9udGVuZCBtb2RlbHMgcGFzc2VkIG1vZGVsIGNsYXNzZXMgaW50byByZWxhdGlvbnNoaXAgaGVscGVycywgd2hpbGUgbmV3ZXJcbiAqIGdlbmVyYXRlZCBtb2RlbHMgcGFzcyBpbnN0YW5jZSB0eXBlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFRcbiAqIEB0eXBlZGVmIHtUIGV4dGVuZHMgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlID8gSW5zdGFuY2VUeXBlPFQ+IDogVH0gRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZ1xuICogQHByb3BlcnR5IHtzdHJpbmcgfCAoKCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCl9IFt1cmxdIC0gT3B0aW9uYWwgZnJvbnRlbmQtbW9kZWwgVVJMLiBUaGlzIHNob3VsZCBiZSB0aGUgc2hhcmVkIGVuZHBvaW50IChmb3IgZXhhbXBsZSBgXCIvZnJvbnRlbmQtbW9kZWxzXCJgIG9yIGBcImh0dHBzOi8vZXhhbXBsZS5jb20vZnJvbnRlbmQtbW9kZWxzXCJgKS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3NoYXJlZF0gLSBEZXByZWNhdGVkIHNoYXJlZC1lbmRwb2ludCBmbGFnIHJldGFpbmVkIGZvciBjb21wYXRpYmlsaXR5LiBGcm9udGVuZC1tb2RlbCBDUlVEL2N1c3RvbSBjb21tYW5kcyB1c2UgdGhlIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgZW52ZWxvcGUgYnkgZGVmYXVsdC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgKCgpID0+IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpfSBbd2Vic29ja2V0VXJsXSAtIE9wdGlvbmFsIHdlYnNvY2tldCBVUkwuIFdoZW4gc2V0LCBWZWxvY2lvdXMgY3JlYXRlcyBhbmQgbWFuYWdlcyBpdHMgb3duIHdlYnNvY2tldCBjbGllbnQgaW50ZXJuYWxseS4gU3Vic2NyaXB0aW9ucyB1c2UgdGhlIHdlYnNvY2tldDsgQ1JVRCB1c2VzIEhUVFAgYW5kIGZhbGxzIGJhY2sgZ3JhY2VmdWxseS4gRXhhbXBsZTogYFwid3M6Ly9sb2NhbGhvc3Q6MzAwNi93ZWJzb2NrZXRcImAuXG4gKiBAcHJvcGVydHkge3twb3N0OiAocGF0aDogc3RyaW5nLCBib2R5PzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG9wdGlvbnM/OiB7aGVhZGVycz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sIHNpZ25hbD86IEFib3J0U2lnbmFsfSkgPT4gUHJvbWlzZTx7anNvbjogKCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Piwgc3Vic2NyaWJlOiAoY2hhbm5lbDogc3RyaW5nLCBvcHRpb25zOiB7cGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSwgY2FsbGJhY2s6IChwYXlsb2FkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZCkgPT4gKCgpID0+IHZvaWQpLCBzdWJzY3JpYmVBbmRXYWl0PzogKGNoYW5uZWw6IHN0cmluZywgb3B0aW9uczoge3BhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0sIGNhbGxiYWNrOiAocGF5bG9hZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHZvaWQpID0+IFByb21pc2U8KCgpID0+IHZvaWQpPn19IFt3ZWJzb2NrZXRDbGllbnRdIC0gT3B0aW9uYWwgd2Vic29ja2V0IGNsaWVudCBmb3Igc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0cyBhbmQgc3Vic2NyaXB0aW9ucy4gSXRzIGBwb3N0YCByZWNlaXZlcyB0aGUgYm91bmRlZC1kZWFkbGluZSBgc2lnbmFsYCBhbmQgc2hvdWxkIGZvcndhcmQgaXQgaW50byB0aGUgdW5kZXJseWluZyB0cmFuc3BvcnQgc28gdGhlIGRlYWRsaW5lIGNhbiBhYm9ydCB0aGUgbGl2ZSByZXF1ZXN0IGFuZCBpdHMgcmVzcG9uc2UtYm9keSByZWFkLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgKCgpID0+IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pfSBbcmVxdWVzdEhlYWRlcnNdIC0gRXh0cmEgSFRUUC9XUyBoZWFkZXJzIHRvIGF0dGFjaCB0byBldmVyeSBmcm9udGVuZC1tb2RlbCBBUEkgcmVxdWVzdC4gUGFzcyBhIGZ1bmN0aW9uIHRvIGNvbXB1dGUgdGhlbSBhdCByZXF1ZXN0IHRpbWUgKGZvciBleGFtcGxlIHRvIGluY2x1ZGUgdGhlIGN1cnJlbnQgbG9jYWxlKS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dCB8ICgoKSA9PiBpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0IHwgdW5kZWZpbmVkIHwgbnVsbCl9IFtyZXF1ZXN0Q29udGV4dF0gLSBJbW11dGFibGUgc2NhbGFyIGNvbnRleHQgY2FwdHVyZWQgaW5kZXBlbmRlbnRseSB3aGVuIGVhY2ggb3BlcmF0aW9uIG9yIGV2ZW50IHN1YnNjcmlwdGlvbiBzdGFydHMgYW5kIHNlbnQgZm9yIHJlbW90ZSB0ZW5hbnQvYWJpbGl0eSByZXNvbHV0aW9uLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCAoKCkgPT4gbnVtYmVyIHwgdW5kZWZpbmVkIHwgbnVsbCl9IFt0aW1lb3V0XSAtIEJvdW5kZWQgZGVhZGxpbmUgaW4gbWlsbGlzZWNvbmRzIGNvdmVyaW5nIGNvbm5lY3Rpb24sIHJlc3BvbnNlIGhlYWRlcnMsIGFuZCByZXNwb25zZS1ib2R5IGNvbnN1bXB0aW9uIGZvciBlYWNoIGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0LiBPbiBleHBpcnkgdGhlIGxpdmUgZmV0Y2gvYWRhcHRlciByZXF1ZXN0IGlzIGFib3J0ZWQgKGJ1aWx0IG9uIGF3YWl0ZXJ5J3MgYHRpbWVvdXRgKSBhbmQgYXdhaXRlcnkncyBgVGltZW91dEVycm9yYCBpcyB0aHJvd24sIHNvIGNhbGxlcnMgY2FuIGNsYXNzaWZ5IGEgdGltZW91dCB2aWEgYGVycm9yIGluc3RhbmNlb2YgVGltZW91dEVycm9yYC4gUGFzcyBhIGZ1bmN0aW9uIHRvIHJlc29sdmUgaXQgcGVyIHJlcXVlc3QuIEZhbHN5L2Fic2VudCBtZWFucyBubyBkZWFkbGluZS5cbiAqIEBwcm9wZXJ0eSB7QWJvcnRTaWduYWwgfCAoKCkgPT4gQWJvcnRTaWduYWwgfCB1bmRlZmluZWQgfCBudWxsKX0gW3NpZ25hbF0gLSBPcHRpb25hbCBjYWxsZXIvc2Vzc2lvbiBBYm9ydFNpZ25hbCBjb21wb3NlZCB3aXRoIHRoZSBkZWFkbGluZS4gQWJvcnRpbmcgaXQgY2FuY2VscyB0aGUgbGl2ZSByZXF1ZXN0IChmb3IgZXhhbXBsZSBvbiBzZXNzaW9uIHNodXRkb3duIG9yIG9mZmxpbmUgdHJhbnNpdGlvbik7IHRoZSByZXN1bHRpbmcgYWJvcnQgZXJyb3Igc3RheXMgZGlzdGluZ3Vpc2hhYmxlIGZyb20gYSB0aW1lb3V0LiBQYXNzIGEgZnVuY3Rpb24gdG8gcmVzb2x2ZSB0aGUgY3VycmVudCBzaWduYWwgcGVyIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge3tnZXQ6ICgpID0+IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQgfCBQcm9taXNlPHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQ+LCBzZXQ6IChzZXNzaW9uSWQ6IHN0cmluZykgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4sIGNsZWFyOiAoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn19IFtzZXNzaW9uU3RvcmVdIC0gT3B0aW9uYWwgc2Vzc2lvbklkIHBlcnNpc3RlbmNlIGhvb2sgZm9yd2FyZGVkIHRvIHRoZSBpbnRlcm5hbCBgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50YCBzbyBXUyBzZXNzaW9ucyBjYW4gYmUgcmVzdW1lZCBhY3Jvc3MgcGFnZSByZWxvYWRzIC8gYXBwIHJlc3RhcnRzLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCAoKCkgPT4gc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCl9IFt0aW1lWm9uZV0gLSBJQU5BIHRpbWV6b25lIHNlbnQgd2l0aCBldmVyeSBmcm9udGVuZC1tb2RlbCBBUEkgcmVxdWVzdCBmb3IgdGltZXpvbmUtbGVzcyBkYXRldGltZSBwYXJzaW5nLlxuICogQHByb3BlcnR5IHt7YWN0b3JEZXZpY2VJZDogc3RyaW5nLCBhY3RvclVzZXJJZDogc3RyaW5nLCBjbGllbnRNdXRhdGlvbklkPzogKCkgPT4gc3RyaW5nLCBlbmFibGVkPzogYm9vbGVhbiwgbXV0YXRpb25Mb2c6IGltcG9ydChcIi4uL3N5bmMvbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLmRlZmF1bHQsIG5vdz86ICgpID0+IERhdGUsIG9mZmxpbmVHcmFudDoge2lkOiBzdHJpbmd9fX0gW29mZmxpbmVTeW5jXSAtIE9mZmxpbmUgbXV0YXRpb24gcXVldWUgY29uZmlndXJhdGlvbi5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsSWRsZVdhaXRBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsSWRsZVdhaXRBcmdzXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3F1aWV0TXNdIC0gTWlsbGlzZWNvbmRzIHRoZSB0cmFuc3BvcnQgbXVzdCBzdGF5IGlkbGUgYmVmb3JlIHJlc29sdmluZy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbdGltZW91dF0gLSBUaW1lb3V0IGluIG1pbGxpc2Vjb25kcy5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBjb25maWcuXG4gKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZ30gKi9cbmNvbnN0IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcgPSB7fVxuY29uc3QgU0hBUkVEX0ZST05URU5EX01PREVMX0FQSV9QQVRIID0gXCIvZnJvbnRlbmQtbW9kZWxzXCJcbmNvbnN0IFBSRUxPQURFRF9SRUxBVElPTlNISVBTX0tFWSA9IFwiX19wcmVsb2FkZWRSZWxhdGlvbnNoaXBzXCJcbmNvbnN0IFNFTEVDVEVEX0FUVFJJQlVURVNfS0VZID0gXCJfX3NlbGVjdGVkQXR0cmlidXRlc1wiXG5jb25zdCBBU1NPQ0lBVElPTl9DT1VOVFNfS0VZID0gXCJfX2Fzc29jaWF0aW9uQ291bnRzXCJcbmNvbnN0IFFVRVJZX0RBVEFfS0VZID0gXCJfX3F1ZXJ5RGF0YVwiXG5jb25zdCBBQklMSVRJRVNfS0VZID0gXCJfX2FiaWxpdGllc1wiXG5jb25zdCBBVFRBQ0hNRU5UX09XTkVSX0tFWSA9IFwiX19hdHRhY2htZW50T3duZXJcIlxuLyoqXG4gKiBQZW5kaW5nIHNoYXJlZCBmcm9udGVuZCBtb2RlbCByZXF1ZXN0cy5cbiAqIEB0eXBlIHtBcnJheTx7Y29tbWFuZE5hbWU/OiBzdHJpbmcsIGNvbW1hbmRUeXBlOiBGcm9udGVuZE1vZGVsUmVxdWVzdENvbW1hbmRUeXBlLCBjdXN0b21QYXRoPzogc3RyaW5nLCBtb2RlbENsYXNzOiBGcm9udGVuZE1vZGVsQ2xhc3MsIHBheWxvYWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgcmVxdWVzdENvbnRleHQ6IGltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQsIHJlcXVlc3RJZDogc3RyaW5nLCByZXNvbHZlOiAocmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gdm9pZCwgcmVqZWN0OiAoZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiB2b2lkLCByZXNvdXJjZVBhdGg/OiBzdHJpbmcgfCBudWxsfT59ICovXG5sZXQgcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cyA9IFtdXG5cbmxldCBzaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdElkID0gMFxubGV0IHNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZCA9IGZhbHNlXG5sZXQgYWN0aXZlRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3RDb3VudCA9IDBcbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgaWRsZSByZXNvbHZlcnMuXG4gKiBAdHlwZSB7QXJyYXk8KCkgPT4gdm9pZD59ICovXG5sZXQgZnJvbnRlbmRNb2RlbElkbGVSZXNvbHZlcnMgPSBbXVxuXG4vKipcbiAqIEludGVybmFsIHdlYnNvY2tldCBjbGllbnQuXG4gKiBAdHlwZSB7VmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50IHwgbnVsbH0gKi9cbmxldCBpbnRlcm5hbFdlYnNvY2tldENsaWVudCA9IG51bGxcbi8qKiBAdHlwZSB7QWJvcnRTaWduYWwgfCBudWxsfSAqL1xubGV0IGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsID0gbnVsbFxuLyoqIEB0eXBlIHsoKCkgPT4gdm9pZCkgfCBudWxsfSAqL1xubGV0IGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cCA9IG51bGxcblxuLyoqXG4gKiBEZXRhY2hlcyBhbiBvd25lZCBXZWJTb2NrZXQgY2xpZW50IGZyb20gdGhlIHNoYXJlZCBjYWNoZSBpZiBpdCBpcyBzdGlsbCBjdXJyZW50LlxuICogQHBhcmFtIHtWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnR9IGNsaWVudCAtIENsaWVudCB3aG9zZSBvd25lcnNoaXAgaXMgZW5kaW5nLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGRldGFjaEludGVybmFsV2Vic29ja2V0Q2xpZW50KGNsaWVudCkge1xuICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgIT09IGNsaWVudCkgcmV0dXJuXG5cbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgPSBudWxsXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cD8uKClcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwgPSBudWxsXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cCA9IG51bGxcbn1cblxuLyoqXG4gKiBEaXNwb3NlcyB0aGUgb3duZWQgV2ViU29ja2V0IGNsaWVudCBiZWZvcmUgdHJhbnNwb3J0L3Nlc3Npb24gY29uZmlndXJhdGlvbiBjaGFuZ2VzLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJlc2V0SW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSB7XG4gIGNvbnN0IGNsaWVudCA9IGludGVybmFsV2Vic29ja2V0Q2xpZW50XG5cbiAgaWYgKCFjbGllbnQpIHJldHVyblxuXG4gIGRldGFjaEludGVybmFsV2Vic29ja2V0Q2xpZW50KGNsaWVudClcbiAgdm9pZCBjbGllbnQuZGlzY29ubmVjdEFuZFN0b3BSZWNvbm5lY3QoKVxufVxuXG4vKipcbiAqIEJpbmRzIHRoZSBvd25lZCBXZWJTb2NrZXQgY2xpZW50IGxpZmV0aW1lIHRvIHRoZSBjdXJyZW50IHNlc3Npb24gc2lnbmFsLlxuICogQHBhcmFtIHtBYm9ydFNpZ25hbCB8IHVuZGVmaW5lZH0gc2Vzc2lvblNpZ25hbCAtIEN1cnJlbnQgc2Vzc2lvbiBzaWduYWwuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYmluZEludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsKHNlc3Npb25TaWduYWwpIHtcbiAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsID09PSBzZXNzaW9uU2lnbmFsKSByZXR1cm5cblxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXA/LigpXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsID0gc2Vzc2lvblNpZ25hbCB8fCBudWxsXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cCA9IG51bGxcblxuICBpZiAoIXNlc3Npb25TaWduYWwgfHwgIWludGVybmFsV2Vic29ja2V0Q2xpZW50KSByZXR1cm5cblxuICBjb25zdCBjbGllbnQgPSBpbnRlcm5hbFdlYnNvY2tldENsaWVudFxuICBjb25zdCBvblNlc3Npb25BYm9ydCA9ICgpID0+IHtcbiAgICBkZXRhY2hJbnRlcm5hbFdlYnNvY2tldENsaWVudChjbGllbnQpXG4gICAgY2xlYXJCdWZmZXJlZE91dGdvaW5nRXZlbnRzKClcbiAgICB2b2lkIGNsaWVudC5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG4gIH1cblxuICBzZXNzaW9uU2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBvblNlc3Npb25BYm9ydCwge29uY2U6IHRydWV9KVxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXAgPSAoKSA9PiBzZXNzaW9uU2lnbmFsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBvblNlc3Npb25BYm9ydClcblxuICBpZiAoc2Vzc2lvblNpZ25hbC5hYm9ydGVkKSBvblNlc3Npb25BYm9ydCgpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgaXMgaWRsZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYWxsIHF1ZXVlZCBhbmQgYWN0aXZlIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCByZXF1ZXN0cyBhcmUgZG9uZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpIHtcbiAgcmV0dXJuIGFjdGl2ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0Q291bnQgPT09IDBcbiAgICAmJiBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzLmxlbmd0aCA9PT0gMFxuICAgICYmICFzaGFyZWRGcm9udGVuZE1vZGVsRmx1c2hTY2hlZHVsZWRcbn1cblxuLyoqXG4gKiBSdW5zIHJlc29sdmUgZnJvbnRlbmQgbW9kZWwgaWRsZSB3YWl0ZXJzLlxuICogQHJldHVybnMge3ZvaWR9ICovXG5mdW5jdGlvbiByZXNvbHZlRnJvbnRlbmRNb2RlbElkbGVXYWl0ZXJzKCkge1xuICBpZiAoIWZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSkgcmV0dXJuXG5cbiAgY29uc3QgcmVzb2x2ZXJzID0gZnJvbnRlbmRNb2RlbElkbGVSZXNvbHZlcnNcbiAgZnJvbnRlbmRNb2RlbElkbGVSZXNvbHZlcnMgPSBbXVxuXG4gIGZvciAoY29uc3QgcmVzb2x2ZSBvZiByZXNvbHZlcnMpIHtcbiAgICByZXNvbHZlKClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgd2FpdCBmb3IgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHF1aWV0IHBlcmlvZC5cbiAqIEBwYXJhbSB7bnVtYmVyfSBtaWxsaXNlY29uZHMgLSBRdWlldCBwZXJpb2QgbGVuZ3RoLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHRoZSBxdWlldCBwZXJpb2QuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JGcm9udGVuZE1vZGVsVHJhbnNwb3J0UXVpZXRQZXJpb2QobWlsbGlzZWNvbmRzKSB7XG4gIGlmIChtaWxsaXNlY29uZHMgPD0gMCkgcmV0dXJuXG5cbiAgYXdhaXQgd2FpdChtaWxsaXNlY29uZHMpXG59XG5cbi8qKlxuICogUnVucyB3YWl0IGZvciBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgaWRsZS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBxdWlldE1zIC0gTWlsbGlzZWNvbmRzIHRoZSB0cmFuc3BvcnQgbXVzdCBzdGF5IGlkbGUgYmVmb3JlIHJlc29sdmluZy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHRyYW5zcG9ydCBzdGF5cyBpZGxlLlxuICovXG5hc3luYyBmdW5jdGlvbiB3YWl0Rm9yRnJvbnRlbmRNb2RlbFRyYW5zcG9ydElkbGUocXVpZXRNcyA9IDApIHtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBpZiAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpKSB7XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gcXVldWVNaWNyb3Rhc2soKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKSlcblxuICAgICAgaWYgKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSkge1xuICAgICAgICBhd2FpdCB3YWl0Rm9yRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFF1aWV0UGVyaW9kKHF1aWV0TXMpXG5cbiAgICAgICAgaWYgKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSkgcmV0dXJuXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgIGZyb250ZW5kTW9kZWxJZGxlUmVzb2x2ZXJzLnB1c2goKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKVxuICAgICAgfSlcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHRyYWNrIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCByZXF1ZXN0LlxuICogQHRlbXBsYXRlIFRcbiAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc3BvcnQgY2FsbGJhY2suXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHRyYWNrRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3QoY2FsbGJhY2spIHtcbiAgYWN0aXZlRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3RDb3VudCArPSAxXG5cbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICB9IGZpbmFsbHkge1xuICAgIGFjdGl2ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0Q291bnQgLT0gMVxuICAgIHJlc29sdmVGcm9udGVuZE1vZGVsSWRsZVdhaXRlcnMoKVxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgaW50ZXJuYWwgd2Vic29ja2V0IGNsaWVudCBmcm9tIHdlYnNvY2tldFVybCBjb25maWcuXG4gKiBDcmVhdGVzIHRoZSBjbGllbnQgbGF6aWx5IG9uIGZpcnN0IGNhbGwuIFJldHVybnMgbnVsbCBpZiBXZWJTb2NrZXRcbiAqIGlzIG5vdCBhdmFpbGFibGUgb3Igd2Vic29ja2V0VXJsIGlzIG5vdCBjb25maWd1cmVkLlxuICogQHJldHVybnMge1ZlbG9jaW91c1dlYnNvY2tldENsaWVudCB8IG51bGx9IFdlYnNvY2tldCBjbGllbnQgb3IgbnVsbC5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkge1xuICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQpIHtcbiAgICBjb25zdCBjbGllbnQgPSBpbnRlcm5hbFdlYnNvY2tldENsaWVudFxuXG4gICAgYmluZEludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSlcblxuICAgIHJldHVybiBjbGllbnRcbiAgfVxuXG4gIGNvbnN0IHdlYnNvY2tldFVybCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0VXJsXG5cbiAgaWYgKCF3ZWJzb2NrZXRVcmwpIHJldHVybiBudWxsXG4gIGlmICh0eXBlb2YgZ2xvYmFsVGhpcy5XZWJTb2NrZXQgPT09IFwidW5kZWZpbmVkXCIpIHJldHVybiBudWxsXG5cbiAgY29uc3QgcmVzb2x2ZWRVcmwgPSB0eXBlb2Ygd2Vic29ja2V0VXJsID09PSBcImZ1bmN0aW9uXCIgPyB3ZWJzb2NrZXRVcmwoKSA6IHdlYnNvY2tldFVybFxuXG4gIGlmICghcmVzb2x2ZWRVcmwpIHJldHVybiBudWxsXG5cbiAgY29uc3QgY2xpZW50ID0gbmV3IFZlbG9jaW91c1dlYnNvY2tldENsaWVudCh7XG4gICAgYXV0b1JlY29ubmVjdDogdHJ1ZSxcbiAgICBzZXNzaW9uU3RvcmU6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2Vzc2lvblN0b3JlLFxuICAgIHVybDogcmVzb2x2ZWRVcmxcbiAgfSlcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgPSBjbGllbnRcbiAgY2xpZW50Lm9uUmVjb25uZWN0ID0gYXN5bmMgKCkgPT4gYXdhaXQgZmx1c2hCdWZmZXJlZE91dGdvaW5nRXZlbnRzQWZ0ZXJSZWNvbm5lY3QoY2xpZW50KVxuXG4gIGJpbmRJbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbChmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCkpXG5cbiAgcmV0dXJuIGNsaWVudFxufVxuXG4vKipcbiAqIFJ1bnMgZmx1c2ggYnVmZmVyZWQgb3V0Z29pbmcgZXZlbnRzIGFmdGVyIHJlY29ubmVjdC5cbiAqIEBwYXJhbSB7VmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50fSBjbGllbnQgLSBSZWNvbm5lY3RlZCBjbGllbnQgdGhhdCBvd25zIHRoaXMgZmx1c2guXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gKi9cbmFzeW5jIGZ1bmN0aW9uIGZsdXNoQnVmZmVyZWRPdXRnb2luZ0V2ZW50c0FmdGVyUmVjb25uZWN0KGNsaWVudCkge1xuICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgIT09IGNsaWVudCkgcmV0dXJuXG5cbiAgY29uc3QgZXZlbnRzID0gZHJhaW5CdWZmZXJlZE91dGdvaW5nRXZlbnRzKClcbiAgY29uc3Qgc2Vzc2lvblNpZ25hbCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKVxuXG4gIGF3YWl0IHJ1bldpdGhUcmFuc3BvcnREZWFkbGluZShcbiAgICB7XG4gICAgICBlcnJvck1lc3NhZ2U6IFwiQnVmZmVyZWQgZnJvbnRlbmQtbW9kZWwgV2ViU29ja2V0IGZsdXNoIHRpbWVkIG91dFwiLFxuICAgICAgc2lnbmFsOiBzZXNzaW9uU2lnbmFsLFxuICAgICAgdGltZW91dE1zOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKClcbiAgICB9LFxuICAgIGFzeW5jIChzaWduYWwpID0+IHtcbiAgICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBldmVudHMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgICAgIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IGNsaWVudC5wb3N0KGV2ZW50c1tpbmRleF0uY3VzdG9tUGF0aCwgZXZlbnRzW2luZGV4XS5wYXlsb2FkLCB7c2lnbmFsfSlcblxuICAgICAgICAgIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50ICE9PSBjbGllbnQpIHJldHVyblxuICAgICAgICAgIGlmIChzZXNzaW9uU2lnbmFsPy5hYm9ydGVkKSByZXR1cm5cblxuICAgICAgICAgIGlmIChzaWduYWwuYWJvcnRlZCkge1xuICAgICAgICAgICAgZm9yIChsZXQgcmVtYWluaW5nID0gaW5kZXg7IHJlbWFpbmluZyA8IGV2ZW50cy5sZW5ndGg7IHJlbWFpbmluZyArPSAxKSB7XG4gICAgICAgICAgICAgIGJ1ZmZlck91dGdvaW5nRXZlbnQoZXZlbnRzW3JlbWFpbmluZ10pXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHNvY2tldE9wZW4gPSBjbGllbnQuc29ja2V0Py5yZWFkeVN0YXRlID09PSBjbGllbnQuc29ja2V0Py5PUEVOXG5cbiAgICAgICAgICBpZiAoc29ja2V0T3BlbikgY29udGludWVcblxuICAgICAgICAgIGZvciAobGV0IHJlbWFpbmluZyA9IGluZGV4OyByZW1haW5pbmcgPCBldmVudHMubGVuZ3RoOyByZW1haW5pbmcgKz0gMSkge1xuICAgICAgICAgICAgYnVmZmVyT3V0Z29pbmdFdmVudChldmVudHNbcmVtYWluaW5nXSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgKVxufVxuXG4vKipcbiAqIFJ1bnMgZGVmYXVsdCBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBwYXRoLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGVmYXVsdCByZXNvdXJjZSBwYXRoIGZvciB0aGUgbW9kZWwgY2xhc3MuXG4gKi9cbmZ1bmN0aW9uIGRlZmF1bHRGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKG1vZGVsQ2xhc3MpIHtcbiAgcmV0dXJuIGAvJHtpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnBsdXJhbGl6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUobW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSkpKX1gXG59XG5cbi8qKiBFcnJvciByYWlzZWQgd2hlbiByZWFkaW5nIGFuIGF0dHJpYnV0ZSB0aGF0IHdhcyBub3Qgc2VsZWN0ZWQgaW4gcXVlcnkgcGF5bG9hZHMuICovXG5leHBvcnQgY2xhc3MgQXR0cmlidXRlTm90U2VsZWN0ZWRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSB0aGF0IHdhcyByZXF1ZXN0ZWQuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcihtb2RlbE5hbWUsIGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBzdXBlcihgJHttb2RlbE5hbWV9IyR7YXR0cmlidXRlTmFtZX0gd2FzIG5vdCBzZWxlY3RlZGApXG4gICAgdGhpcy5uYW1lID0gXCJBdHRyaWJ1dGVOb3RTZWxlY3RlZEVycm9yXCJcbiAgfVxufVxuXG4vKipcbiAqIExpZ2h0d2VpZ2h0IHNpbmd1bGFyIHJlbGF0aW9uc2hpcCBzdGF0ZSBob2xkZXIgZm9yIGZyb250ZW5kIG1vZGVsIGluc3RhbmNlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFNcbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFRcbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz1SZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+XVxuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gUGFyZW50IG1vZGVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzczxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4sIFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4sIFRhcmdldENyZWF0ZUF0dHJpYnV0ZXM+IHwgbnVsbH0gdGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG1vZGVsLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgdGhpcy5tb2RlbCA9IG1vZGVsXG4gICAgdGhpcy5yZWxhdGlvbnNoaXBOYW1lID0gcmVsYXRpb25zaGlwTmFtZVxuICAgIHRoaXMudGFyZ2V0TW9kZWxDbGFzcyA9IHRhcmdldE1vZGVsQ2xhc3NcbiAgICB0aGlzLl9wcmVsb2FkZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBsb2FkZWQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbCB8IHVuZGVmaW5lZH0gbG9hZGVkVmFsdWUgLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldExvYWRlZChsb2FkZWRWYWx1ZSkge1xuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gbG9hZGVkVmFsdWUgPT0gdW5kZWZpbmVkID8gbnVsbCA6IGxvYWRlZFZhbHVlXG4gICAgdGhpcy5fcHJlbG9hZGVkID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHByZWxvYWRlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZWxhdGlvbnNoaXAgaXMgcHJlbG9hZGVkLlxuICAgKi9cbiAgZ2V0UHJlbG9hZGVkKCkge1xuICAgIHJldHVybiB0aGlzLl9wcmVsb2FkZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWRlZC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGx9IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGxvYWRlZCgpIHtcbiAgICBpZiAoIXRoaXMuX3ByZWxvYWRlZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IGhhc24ndCBiZWVuIHByZWxvYWRlZGApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2xvYWRlZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ29waWVzIGxvYWRlZCB2YWx1ZSBmcm9tIGFub3RoZXIgc2luZ3VsYXIgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSBzb3VyY2VSZWxhdGlvbnNoaXAgLSBTb3VyY2UgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjb3B5TG9hZGVkRnJvbShzb3VyY2VSZWxhdGlvbnNoaXApIHtcbiAgICBpZiAoc291cmNlUmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSBzb3VyY2UgcmVsYXRpb25zaGlwIHRvIGJlIHNpbmd1bGFyYClcbiAgICB9XG5cbiAgICAvLyBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSB0YXJnZXQgcmVsYXRpb25zaGlwJ3MgZG9jdW1lbnRlZCBtb2RlbCB0eXBlLlxuICAgIGNvbnN0IGxvYWRlZFZhbHVlID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsfSAqLyAoc291cmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpKVxuXG4gICAgdGhpcy5zZXRMb2FkZWQobG9hZGVkVmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZC5cbiAgICogQHBhcmFtIHtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzfSBbYXR0cmlidXRlc10gLSBOZXcgbW9kZWwgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPn0gLSBCdWlsdCBtb2RlbC5cbiAgICovXG4gIGJ1aWxkKGF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge1RhcmdldENyZWF0ZUF0dHJpYnV0ZXN9ICovICh7fSkpIHtcbiAgICBpZiAoIXRoaXMudGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcykgPT4gRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+fSAqLyAodGhpcy50YXJnZXRNb2RlbENsYXNzKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoYXR0cmlidXRlcylcblxuICAgIHRoaXMuc2V0TG9hZGVkKG1vZGVsKVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogRm9yY2UtcmVsb2FkIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGw+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgbW9kZWwuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBudWxsXG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5tb2RlbC5fdHJ5Q29ob3J0UHJlbG9hZCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoYmF0Y2hlZCkgcmV0dXJuIHRoaXMubG9hZGVkKClcblxuICAgIGF3YWl0IHRoaXMubW9kZWwubG9hZFJlbGF0aW9uc2hpcCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICByZXR1cm4gdGhpcy5sb2FkZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGxvYWRlZCByZWxhdGlvbnNoaXAgb3IgbG9hZHMgaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGw+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgbW9kZWwuXG4gICAqL1xuICBhc3luYyBvckxvYWQoKSB7XG4gICAgaWYgKHRoaXMuZ2V0UHJlbG9hZGVkKCkpIHJldHVybiB0aGlzLmxvYWRlZCgpXG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5tb2RlbC5fdHJ5Q29ob3J0UHJlbG9hZCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoYmF0Y2hlZCkgcmV0dXJuIHRoaXMubG9hZGVkKClcblxuICAgIGF3YWl0IHRoaXMubW9kZWwubG9hZFJlbGF0aW9uc2hpcCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICByZXR1cm4gdGhpcy5sb2FkZWQoKVxuICB9XG59XG5cbi8qKlxuICogTGlnaHR3ZWlnaHQgaGFzLW1hbnkgcmVsYXRpb25zaGlwIHN0YXRlIGhvbGRlciBmb3IgZnJvbnRlbmQgbW9kZWwgaW5zdGFuY2VzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gU1xuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gVFxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzPVJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT5dXG4gKi9cbmV4cG9ydCBjbGFzcyBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCB7XG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSAqL1xuICBfbG9hZGVkVmFsdWVcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBQYXJlbnQgbW9kZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzPEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz4gfCBudWxsfSB0YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgY29uc3RydWN0b3IobW9kZWwsIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICB0aGlzLm1vZGVsID0gbW9kZWxcbiAgICB0aGlzLnJlbGF0aW9uc2hpcE5hbWUgPSByZWxhdGlvbnNoaXBOYW1lXG4gICAgdGhpcy50YXJnZXRNb2RlbENsYXNzID0gdGFyZ2V0TW9kZWxDbGFzc1xuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGxvYWRlZC5cbiAgICogQHBhcmFtIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSBsb2FkZWRWYWx1ZSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0TG9hZGVkKGxvYWRlZFZhbHVlKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGxvYWRlZFZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IHRvIGJlIGxvYWRlZCB3aXRoIGFuIGFycmF5YClcbiAgICB9XG5cbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IGxvYWRlZFZhbHVlXG4gICAgdGhpcy5fcHJlbG9hZGVkID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHByZWxvYWRlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZWxhdGlvbnNoaXAgaXMgcHJlbG9hZGVkLlxuICAgKi9cbiAgZ2V0UHJlbG9hZGVkKCkge1xuICAgIHJldHVybiB0aGlzLl9wcmVsb2FkZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWRlZC5cbiAgICogQHJldHVybnMge0FycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZXMuXG4gICAqL1xuICBsb2FkZWQoKSB7XG4gICAgaWYgKCF0aGlzLl9wcmVsb2FkZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSBoYXNuJ3QgYmVlbiBwcmVsb2FkZWRgKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9sb2FkZWRWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIENvcGllcyBsb2FkZWQgdmFsdWUgZnJvbSBhbm90aGVyIGhhcy1tYW55IHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gc291cmNlUmVsYXRpb25zaGlwIC0gU291cmNlIHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY29weUxvYWRlZEZyb20oc291cmNlUmVsYXRpb25zaGlwKSB7XG4gICAgaWYgKCEoc291cmNlUmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX0gc291cmNlIHJlbGF0aW9uc2hpcCB0byBiZSBoYXMtbWFueWApXG4gICAgfVxuXG4gICAgLy8gTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgdGFyZ2V0IHJlbGF0aW9uc2hpcCdzIGRvY3VtZW50ZWQgbW9kZWwgdHlwZS5cbiAgICBjb25zdCBsb2FkZWRWYWx1ZSA9IC8qKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pn0gKi8gKHNvdXJjZVJlbGF0aW9uc2hpcC5sb2FkZWQoKSlcblxuICAgIHRoaXMuc2V0TG9hZGVkKGxvYWRlZFZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIHRvIGxvYWRlZC5cbiAgICogQHBhcmFtIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSBtb2RlbHMgLSBNb2RlbHMgdG8gYXBwZW5kLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZFRvTG9hZGVkKG1vZGVscykge1xuICAgIGNvbnN0IGxvYWRlZE1vZGVscyA9IHRoaXMuZ2V0UHJlbG9hZGVkKCkgPyB0aGlzLmxvYWRlZCgpIDogW11cblxuICAgIHRoaXMuc2V0TG9hZGVkKFsuLi5sb2FkZWRNb2RlbHMsIC4uLm1vZGVsc10pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZC5cbiAgICogQHBhcmFtIHtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzfSBbYXR0cmlidXRlc10gLSBOZXcgbW9kZWwgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPn0gLSBCdWlsdCBtb2RlbC5cbiAgICovXG4gIGJ1aWxkKGF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge1RhcmdldENyZWF0ZUF0dHJpYnV0ZXN9ICovICh7fSkpIHtcbiAgICBpZiAoIXRoaXMudGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcykgPT4gRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+fSAqLyAodGhpcy50YXJnZXRNb2RlbENsYXNzKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoYXR0cmlidXRlcylcblxuICAgIHRoaXMuYWRkVG9Mb2FkZWQoW21vZGVsXSlcblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIEZvcmNlLXJlbG9hZCB0aGUgcmVsYXRpb25zaGlwLiBXaGVuIHRoZSBwYXJlbnQgcmVjb3JkIHdhcyBsb2FkZWQgYXMgcGFydFxuICAgKiBvZiBhIGJhdGNoLCBzaWJsaW5ncyB0aGF0IGhhdmUgbm90IHByZWxvYWRlZCB0aGlzIHJlbGF0aW9uc2hpcCBnZXRcbiAgICogYmF0Y2hlZCBpbnRvIG9uZSByZXF1ZXN0IHZpYSB0aGUgY29ob3J0IHByZWxvYWRlci4gVGhlIHNjb3BlZCBxdWVyeSBwYXRoXG4gICAqIChgTW9kZWwud2hlcmUoLi4uKS5wcmVsb2FkKFtuYW1lXSkudG9BcnJheSgpYCBkaXJlY3RseSBmcm9tIHVzZXIgY29kZSlcbiAgICogYnlwYXNzZXMgY29ob3J0IGJhdGNoaW5nIGJ5IGRlc2lnbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBtb2RlbHMuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIC8vIFJlc2V0IHNvIHRoZSBjb2hvcnQgcHJlbG9hZGVyIChvciBzaW5nbGUtcmVjb3JkIGZhbGxiYWNrKSByZXBvcHVsYXRlcy5cbiAgICB0aGlzLl9wcmVsb2FkZWQgPSBmYWxzZVxuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gW11cblxuICAgIGNvbnN0IGJhdGNoZWQgPSBhd2FpdCB0aGlzLm1vZGVsLl90cnlDb2hvcnRQcmVsb2FkKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChiYXRjaGVkKSByZXR1cm4gdGhpcy5fbG9hZGVkVmFsdWVcblxuICAgIGF3YWl0IHRoaXMubW9kZWwubG9hZFJlbGF0aW9uc2hpcCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICByZXR1cm4gdGhpcy5sb2FkZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYXJyYXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj4+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgbW9kZWxzLlxuICAgKi9cbiAgYXN5bmMgdG9BcnJheSgpIHtcbiAgICBpZiAodGhpcy5nZXRQcmVsb2FkZWQoKSB8fCB0aGlzLl9sb2FkZWRWYWx1ZS5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gdGhpcy5fbG9hZGVkVmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkKClcbiAgfVxufVxuXG4vKipcbiAqIENvcGllcyBsb2FkZWQgcmVsYXRpb25zaGlwIHN0YXRlIGJldHdlZW4gaGVscGVycyBvZiB0aGUgc2FtZSByZWxhdGlvbnNoaXAgc2hhcGUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gYXJncy5zb3VyY2VSZWxhdGlvbnNoaXAgLSBTb3VyY2UgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gYXJncy50YXJnZXRSZWxhdGlvbnNoaXAgLSBUYXJnZXQgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBjb3B5TG9hZGVkUmVsYXRpb25zaGlwVmFsdWUoe3NvdXJjZVJlbGF0aW9uc2hpcCwgdGFyZ2V0UmVsYXRpb25zaGlwfSkge1xuICB0YXJnZXRSZWxhdGlvbnNoaXAuY29weUxvYWRlZEZyb20oc291cmNlUmVsYXRpb25zaGlwKVxufVxuXG4vKipcbiAqIFJ1bnMgcmVsYXRpb25zaGlwIHR5cGUgaXMgY29sbGVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBUeXBlIC0gUmVsYXRpb25zaGlwIHR5cGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlbGF0aW9uc2hpcCB0eXBlIGlzIGhhcy1tYW55LlxuICovXG5mdW5jdGlvbiByZWxhdGlvbnNoaXBUeXBlSXNDb2xsZWN0aW9uKHJlbGF0aW9uc2hpcFR5cGUpIHtcbiAgcmV0dXJuIHJlbGF0aW9uc2hpcFR5cGUgPT0gXCJoYXNNYW55XCJcbn1cblxuLyoqXG4gKiBEb3dubG9hZGVkIGZyb250ZW5kLW1vZGVsIGF0dGFjaG1lbnQgcGF5bG9hZCB3cmFwcGVyLlxuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREb3dubG9hZCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmlkIC0gQXR0YWNobWVudCBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmlsZW5hbWUgLSBGaWxlbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBhcmdzLmNvbnRlbnRUeXBlIC0gQ29udGVudCB0eXBlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5ieXRlU2l6ZSAtIEZpbGUgc2l6ZSBpbiBieXRlcy5cbiAgICogQHBhcmFtIHtVaW50OEFycmF5fSBhcmdzLmNvbnRlbnQgLSBGaWxlIGNvbnRlbnQgYnl0ZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gW2FyZ3MudXJsXSAtIFJlc29sdmFibGUgYXR0YWNobWVudCBVUkwuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Ynl0ZVNpemUsIGNvbnRlbnQsIGNvbnRlbnRUeXBlLCBmaWxlbmFtZSwgaWQsIHVybCA9IG51bGx9KSB7XG4gICAgdGhpcy5pZFZhbHVlID0gaWRcbiAgICB0aGlzLmZpbGVuYW1lVmFsdWUgPSBmaWxlbmFtZVxuICAgIHRoaXMuY29udGVudFR5cGVWYWx1ZSA9IGNvbnRlbnRUeXBlXG4gICAgdGhpcy5ieXRlU2l6ZVZhbHVlID0gYnl0ZVNpemVcbiAgICB0aGlzLmNvbnRlbnRWYWx1ZSA9IGNvbnRlbnRcbiAgICB0aGlzLnVybFZhbHVlID0gdXJsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBieXRlIHNpemUuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRmlsZSBzaXplIGluIGJ5dGVzLlxuICAgKi9cbiAgYnl0ZVNpemUoKSB7IHJldHVybiB0aGlzLmJ5dGVTaXplVmFsdWUgfVxuICAvKipcbiAgICogUnVucyBjb250ZW50LlxuICAgKiBAcmV0dXJucyB7VWludDhBcnJheX0gLSBGaWxlIGNvbnRlbnQgYnl0ZXMuXG4gICAqL1xuICBjb250ZW50KCkgeyByZXR1cm4gdGhpcy5jb250ZW50VmFsdWUgfVxuICAvKipcbiAgICogUnVucyBjb250ZW50IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIENvbnRlbnQgdHlwZS5cbiAgICovXG4gIGNvbnRlbnRUeXBlKCkgeyByZXR1cm4gdGhpcy5jb250ZW50VHlwZVZhbHVlIH1cbiAgLyoqXG4gICAqIFJ1bnMgZmlsZW5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRmlsZW5hbWUuXG4gICAqL1xuICBmaWxlbmFtZSgpIHsgcmV0dXJuIHRoaXMuZmlsZW5hbWVWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIGlkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgaWQuXG4gICAqL1xuICBpZCgpIHsgcmV0dXJuIHRoaXMuaWRWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIHVybC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmVzb2x2YWJsZSBhdHRhY2htZW50IFVSTC5cbiAgICovXG4gIHVybCgpIHsgcmV0dXJuIHRoaXMudXJsVmFsdWUgfVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgYXR0YWNobWVudCBjb21tYW5kIHBheWxvYWQuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxBdHRhY2htZW50SGFuZGxlfSBhdHRhY2htZW50IC0gQXR0YWNobWVudCB3cmFwcGVyLlxuICogQHBhcmFtIHtzdHJpbmd9IFthdHRhY2htZW50SWRdIC0gT3B0aW9uYWwgaGFzLW1hbnkgYXR0YWNobWVudCBpZC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ29tbWFuZCBwYXlsb2FkLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQXR0YWNobWVudENvbW1hbmRQYXlsb2FkKGF0dGFjaG1lbnQsIGF0dGFjaG1lbnRJZCkge1xuICAvKipcbiAgICogUGF5bG9hZC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICBhdHRhY2htZW50TmFtZTogYXR0YWNobWVudC5hdHRhY2htZW50TmFtZSxcbiAgICBpZDogYXR0YWNobWVudC5tb2RlbC5wcmltYXJ5S2V5VmFsdWUoKVxuICB9XG5cbiAgaWYgKGF0dGFjaG1lbnRJZCkgcGF5bG9hZC5hdHRhY2htZW50SWQgPSBhdHRhY2htZW50SWRcblxuICByZXR1cm4gcGF5bG9hZFxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGNhbm9uaWNhbCBiYWNraW5nIG93bmVyIHVzZWQgYnkgYXR0YWNobWVudCBtZXRhZGF0YSBzdG9yYWdlLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBGcm9udGVuZCBhdHRhY2htZW50IG93bmVyLlxuICogQHJldHVybnMge3tyZWNvcmRJZDogc3RyaW5nLCByZWNvcmRUeXBlOiBzdHJpbmcsIHJlc291cmNlTmFtZTogc3RyaW5nfX0gLSBDYW5vbmljYWwgYXR0YWNobWVudCBvd25lciBhbmQgb3JpZ2luYXRpbmcgcmVzb3VyY2UuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxBdHRhY2htZW50T3duZXIobW9kZWwpIHtcbiAgaWYgKCFtb2RlbC5fYXR0YWNobWVudE93bmVyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIGF0dGFjaG1lbnQgb3duZXIgbWV0YWRhdGEgb24gJHtmcm9udGVuZE1vZGVsQ2xhc3NGb3IobW9kZWwpLm5hbWV9YClcbiAgfVxuXG4gIHJldHVybiBtb2RlbC5fYXR0YWNobWVudE93bmVyXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IHZhbHVlIGlzIGJ5dGVzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHZhbHVlIGxvb2tzIGxpa2UgYnl0ZSBkYXRhLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzQnl0ZXModmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlIGluc3RhbmNlb2YgVWludDhBcnJheSB8fCB2YWx1ZSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyIHx8ICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiICYmIEJ1ZmZlci5pc0J1ZmZlcih2YWx1ZSkpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IHZhbHVlIHN1cHBvcnRzIGFycmF5IGJ1ZmZlci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge3ZhbHVlIGlzIHthcnJheUJ1ZmZlcjogKCkgPT4gUHJvbWlzZTxBcnJheUJ1ZmZlcj59fSAtIFdoZXRoZXIgY2FuZGlkYXRlIHN1cHBvcnRzIGFycmF5QnVmZmVyKCkuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudFZhbHVlU3VwcG9ydHNBcnJheUJ1ZmZlcih2YWx1ZSkge1xuICByZXR1cm4gQm9vbGVhbih2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh2YWx1ZSkuYXJyYXlCdWZmZXIgPT09IFwiZnVuY3Rpb25cIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgbm9ybWFsaXplIGJ5dGVzLlxuICogQHBhcmFtIHtVaW50OEFycmF5IHwgQnVmZmVyIHwgQXJyYXlCdWZmZXJ9IHZhbHVlIC0gQnl0ZS1saWtlIHZhbHVlLlxuICogQHJldHVybnMge1VpbnQ4QXJyYXl9IC0gVWludDhBcnJheSBieXRlcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50Tm9ybWFsaXplQnl0ZXModmFsdWUpIHtcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgVWludDhBcnJheSkgcmV0dXJuIHZhbHVlXG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSByZXR1cm4gbmV3IFVpbnQ4QXJyYXkodmFsdWUpXG4gIGlmICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiICYmIEJ1ZmZlci5pc0J1ZmZlcigvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodmFsdWUpKSkge1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheSgvKiogQHR5cGUge0J1ZmZlcn0gKi8gKHZhbHVlKSlcbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIGF0dGFjaG1lbnQgYnl0ZXMgdmFsdWVcIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgYnl0ZXMgdG8gYmFzZTY0LlxuICogQHBhcmFtIHtVaW50OEFycmF5fSBieXRlcyAtIEJ5dGVzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBCYXNlNjQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudEJ5dGVzVG9CYXNlNjQoYnl0ZXMpIHtcbiAgaWYgKHR5cGVvZiBCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICByZXR1cm4gQnVmZmVyLmZyb20oYnl0ZXMpLnRvU3RyaW5nKFwiYmFzZTY0XCIpXG4gIH1cblxuICBsZXQgYmluYXJ5ID0gXCJcIlxuXG4gIGZvciAoY29uc3QgYnl0ZSBvZiBieXRlcykge1xuICAgIGJpbmFyeSArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGUpXG4gIH1cblxuICBpZiAodHlwZW9mIGJ0b2EgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiTWlzc2luZyBiYXNlNjQgZW5jb2RlclwiKVxuXG4gIHJldHVybiBidG9hKGJpbmFyeSlcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgYmFzZTY0IHRvIGJ5dGVzLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gQmFzZTY0IHZhbHVlLlxuICogQHJldHVybnMge1VpbnQ4QXJyYXl9IC0gRGVjb2RlZCBieXRlcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50QmFzZTY0VG9CeXRlcyh2YWx1ZSkge1xuICBpZiAodHlwZW9mIEJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheShCdWZmZXIuZnJvbSh2YWx1ZSwgXCJiYXNlNjRcIikpXG4gIH1cblxuICBpZiAodHlwZW9mIGF0b2IgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiTWlzc2luZyBiYXNlNjQgZGVjb2RlclwiKVxuXG4gIGNvbnN0IGJpbmFyeSA9IGF0b2IodmFsdWUpXG4gIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYmluYXJ5Lmxlbmd0aClcblxuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgYmluYXJ5Lmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGJ5dGVzW2luZGV4XSA9IGJpbmFyeS5jaGFyQ29kZUF0KGluZGV4KVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVzXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IHZhbHVlIGlzIHBsYWluIG9iamVjdC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge3ZhbHVlIGlzIFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBXaGV0aGVyIHZhbHVlIGlzIHBsYWluIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICBjb25zdCBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpXG5cbiAgcmV0dXJuIHByb3RvdHlwZSA9PT0gT2JqZWN0LnByb3RvdHlwZSB8fCBwcm90b3R5cGUgPT09IG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHBheWxvYWQgY29udGFpbnMgYXR0YWNobWVudCB1cGxvYWQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFBheWxvYWQgY2FuZGlkYXRlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBwYXlsb2FkIGNvbnRhaW5zIGFuIGF0dGFjaG1lbnQgdXBsb2FkIGJvZHkuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxQYXlsb2FkQ29udGFpbnNBdHRhY2htZW50VXBsb2FkKHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcblxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gdmFsdWUuc29tZSgoZW50cnkpID0+IGZyb250ZW5kTW9kZWxQYXlsb2FkQ29udGFpbnNBdHRhY2htZW50VXBsb2FkKGVudHJ5KSlcbiAgfVxuXG4gIGlmICghZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KHZhbHVlKSkgcmV0dXJuIGZhbHNlXG5cbiAgaWYgKHR5cGVvZiB2YWx1ZS5jb250ZW50QmFzZTY0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIHJldHVybiBPYmplY3QudmFsdWVzKHZhbHVlKS5zb21lKChlbnRyeSkgPT4gZnJvbnRlbmRNb2RlbFBheWxvYWRDb250YWluc0F0dGFjaG1lbnRVcGxvYWQoZW50cnkpKVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGNvbmNyZXRlIGZyb250ZW5kLW1vZGVsIGNsYXNzIGZvciBhbiBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gRnJvbnRlbmQgbW9kZWwgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbENsYXNzfSBDb25jcmV0ZSBmcm9udGVuZC1tb2RlbCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbENsYXNzRm9yKG1vZGVsKSB7XG4gIGNvbnN0IGNvbnN0cnVjdG9yVmFsdWUgPSBtb2RlbC5jb25zdHJ1Y3RvclxuXG4gIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxDbGFzc30gKi8gKGNvbnN0cnVjdG9yVmFsdWUpXG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgY29uZmlndXJlZCBvZmZsaW5lIHF1ZXVlIHNob3VsZCBoYW5kbGUgYSBtb2RlbCBvcGVyYXRpb24uXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBvcGVyYXRpb24gLSBTeW5jIG9wZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdG8gcXVldWUgbG9jYWxseS5cbiAqL1xuZnVuY3Rpb24gc2hvdWxkUXVldWVGcm9udGVuZE1vZGVsT3BlcmF0aW9uT2ZmbGluZShNb2RlbENsYXNzLCBvcGVyYXRpb24pIHtcbiAgY29uc3Qgb2ZmbGluZVN5bmMgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jXG5cbiAgaWYgKCFvZmZsaW5lU3luYz8uZW5hYmxlZCkgcmV0dXJuIGZhbHNlXG5cbiAgY29uc3Qgc3luY0NvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKS5zeW5jXG5cbiAgaWYgKCFzeW5jQ29uZmlnPy5lbmFibGVkKSByZXR1cm4gZmFsc2VcbiAgaWYgKCFzeW5jQ29uZmlnLm9wZXJhdGlvbnMuaW5jbHVkZXMob3BlcmF0aW9uKSkgdGhyb3cgbmV3IEVycm9yKGBPZmZsaW5lIHN5bmMgZm9yICR7TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gZG9lcyBub3QgYWxsb3cgJHtvcGVyYXRpb259YClcblxuICByZXR1cm4gdHJ1ZVxufVxuXG4vKipcbiAqIFF1ZXVlcyBhbiBvZmZsaW5lIHN5bmMgbXV0YXRpb24uXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gYXJncy5hdHRyaWJ1dGVzIC0gTXV0YXRpb24gYXR0cmlidXRlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5jbGllbnRNdXRhdGlvbklkXSAtIFByZS1nZW5lcmF0ZWQgbXV0YXRpb24gaWQuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gYXJncy5Nb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFyZ3Mub3BlcmF0aW9uIC0gU3luYyBvcGVyYXRpb24uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIENsaWVudCBtdXRhdGlvbiBpZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcXVldWVGcm9udGVuZE1vZGVsTXV0YXRpb25PZmZsaW5lKHthdHRyaWJ1dGVzLCBjbGllbnRNdXRhdGlvbklkOiBwcm92aWRlZENsaWVudE11dGF0aW9uSWQsIE1vZGVsQ2xhc3MsIG9wZXJhdGlvbn0pIHtcbiAgY29uc3Qgb2ZmbGluZVN5bmMgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jXG5cbiAgaWYgKCFvZmZsaW5lU3luYykgdGhyb3cgbmV3IEVycm9yKFwiT2ZmbGluZSBzeW5jIGlzIG5vdCBjb25maWd1cmVkXCIpXG5cbiAgY29uc3Qgc3luY0NvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKS5zeW5jXG4gIGlmICghc3luY0NvbmZpZz8uZW5hYmxlZCkgdGhyb3cgbmV3IEVycm9yKGBPZmZsaW5lIHN5bmMgaXMgbm90IGVuYWJsZWQgZm9yICR7TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gKVxuXG4gIGNvbnN0IG5vdyA9IG9mZmxpbmVTeW5jLm5vdyA/IG9mZmxpbmVTeW5jLm5vdygpIDogbmV3IERhdGUoKVxuICBpZiAoIShub3cgaW5zdGFuY2VvZiBEYXRlKSB8fCBOdW1iZXIuaXNOYU4obm93LmdldFRpbWUoKSkpIHRocm93IG5ldyBFcnJvcihcIm9mZmxpbmVTeW5jLm5vdyBtdXN0IHJldHVybiBhIHZhbGlkIERhdGVcIilcblxuICBjb25zdCBjbGllbnRNdXRhdGlvbklkID0gcHJvdmlkZWRDbGllbnRNdXRhdGlvbklkIHx8IChvZmZsaW5lU3luYy5jbGllbnRNdXRhdGlvbklkID8gb2ZmbGluZVN5bmMuY2xpZW50TXV0YXRpb25JZCgpIDogZnJvbnRlbmRNb2RlbE9mZmxpbmVNdXRhdGlvbklkKCkpXG4gIGlmICh0eXBlb2YgY2xpZW50TXV0YXRpb25JZCAhPT0gXCJzdHJpbmdcIiB8fCBjbGllbnRNdXRhdGlvbklkLmxlbmd0aCA8IDEpIHRocm93IG5ldyBFcnJvcihcIm9mZmxpbmVTeW5jLmNsaWVudE11dGF0aW9uSWQgbXVzdCByZXR1cm4gYSBub24tZW1wdHkgc3RyaW5nXCIpXG5cbiAgYXdhaXQgb2ZmbGluZVN5bmMubXV0YXRpb25Mb2cuYXBwZW5kKHtcbiAgICBtdXRhdGlvbjoge1xuICAgICAgYWN0b3JEZXZpY2VJZDogb2ZmbGluZVN5bmMuYWN0b3JEZXZpY2VJZCxcbiAgICAgIGFjdG9yVXNlcklkOiBvZmZsaW5lU3luYy5hY3RvclVzZXJJZCxcbiAgICAgIGF0dHJpYnV0ZXM6IGZyb250ZW5kTW9kZWxTeW5jSnNvbk9iamVjdChhdHRyaWJ1dGVzKSxcbiAgICAgIGJhc2VWZXJzaW9uOiBudWxsLFxuICAgICAgY2xpZW50TXV0YXRpb25JZCxcbiAgICAgIG1vZGVsOiBNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgb2NjdXJyZWRBdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICBvZmZsaW5lR3JhbnRJZDogb2ZmbGluZVN5bmMub2ZmbGluZUdyYW50LmlkLFxuICAgICAgb3BlcmF0aW9uLFxuICAgICAgcG9saWN5SGFzaDogc3luY0NvbmZpZy5wb2xpY3lIYXNoXG4gICAgfVxuICB9KVxuXG4gIHJldHVybiBjbGllbnRNdXRhdGlvbklkXG59XG5cbi8qKlxuICogR2VuZXJhdGVzIGEgZnJvbnRlbmQtbW9kZWwgb2ZmbGluZSBtdXRhdGlvbiBpZC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTG9jYWwgbXV0YXRpb24gaWQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxPZmZsaW5lTXV0YXRpb25JZCgpIHtcbiAgaWYgKGdsb2JhbFRoaXMuY3J5cHRvICYmIHR5cGVvZiBnbG9iYWxUaGlzLmNyeXB0by5yYW5kb21VVUlEID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiBnbG9iYWxUaGlzLmNyeXB0by5yYW5kb21VVUlEKClcblxuICByZXR1cm4gYGZyb250ZW5kLW11dGF0aW9uLSR7RGF0ZS5ub3coKX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX1gXG59XG5cbi8qKlxuICogQ29udmVydHMgbW9kZWwgYXR0cmlidXRlcyB0byBzeW5jLXNhZmUgSlNPTiBwYXlsb2FkIHZhbHVlcy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gYXR0cmlidXRlcyAtIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZXMuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59IC0gU3luYy1zYWZlIGF0dHJpYnV0ZXMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxTeW5jSnNvbk9iamVjdChhdHRyaWJ1dGVzKSB7XG4gIGNvbnN0IHNlcmlhbGl6ZWQgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGF0dHJpYnV0ZXMpKVxuXG4gIGlmICghc2VyaWFsaXplZCB8fCB0eXBlb2Ygc2VyaWFsaXplZCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHNlcmlhbGl6ZWQpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBzeW5jIG11dGF0aW9uIGF0dHJpYnV0ZXMgb2JqZWN0XCIpXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59ICovIChzZXJpYWxpemVkKVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIGF0dGFjaG1lbnQgaW5wdXQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBpbnB1dCAtIEF0dGFjaG1lbnQgaW5wdXQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFRyYW5zcG9ydC1zYWZlIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQoaW5wdXQpIHtcbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChpbnB1dCkgJiYgXCJmaWxlXCIgaW4gaW5wdXQpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRmlsZSA9IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0LmZpbGUpXG4gICAgY29uc3QgbWVyZ2VkID0ge1xuICAgICAgLi4ubm9ybWFsaXplZEZpbGVcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGlucHV0LmZpbGVuYW1lID09PSBcInN0cmluZ1wiICYmIGlucHV0LmZpbGVuYW1lLmxlbmd0aCA+IDApIG1lcmdlZC5maWxlbmFtZSA9IGlucHV0LmZpbGVuYW1lXG4gICAgaWYgKHR5cGVvZiBpbnB1dC5jb250ZW50VHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5jb250ZW50VHlwZS5sZW5ndGggPiAwKSBtZXJnZWQuY29udGVudFR5cGUgPSBpbnB1dC5jb250ZW50VHlwZVxuXG4gICAgcmV0dXJuIG1lcmdlZFxuICB9XG5cbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChpbnB1dCkpIHtcbiAgICBpZiAodHlwZW9mIGlucHV0LnBhdGggPT09IFwic3RyaW5nXCIgJiYgaW5wdXQucGF0aC5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdHRhY2htZW50IHBhdGggaW5wdXQgaXMgbm90IHN1cHBvcnRlZCBpbiBmcm9udGVuZCBtb2RlbHNcIilcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGlucHV0LmNvbnRlbnRCYXNlNjQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvbnRlbnRCYXNlNjQ6IGlucHV0LmNvbnRlbnRCYXNlNjQsXG4gICAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgaW5wdXQuY29udGVudFR5cGUgPT09IFwic3RyaW5nXCIgJiYgaW5wdXQuY29udGVudFR5cGUubGVuZ3RoID4gMCA/IGlucHV0LmNvbnRlbnRUeXBlIDogbnVsbCxcbiAgICAgICAgZmlsZW5hbWU6IHR5cGVvZiBpbnB1dC5maWxlbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5maWxlbmFtZS5sZW5ndGggPiAwID8gaW5wdXQuZmlsZW5hbWUgOiB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpZiAoZnJvbnRlbmRBdHRhY2htZW50VmFsdWVTdXBwb3J0c0FycmF5QnVmZmVyKGlucHV0KSkge1xuICAgIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYXdhaXQgaW5wdXQuYXJyYXlCdWZmZXIoKSlcblxuICAgIHJldHVybiB7XG4gICAgICBjb250ZW50QmFzZTY0OiBmcm9udGVuZEF0dGFjaG1lbnRCeXRlc1RvQmFzZTY0KGJ5dGVzKSxcbiAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS50eXBlID09PSBcInN0cmluZ1wiICYmIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkudHlwZS5sZW5ndGggPiAwXG4gICAgICAgID8gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS50eXBlXG4gICAgICAgIDogbnVsbCxcbiAgICAgIGZpbGVuYW1lOiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS5uYW1lID09PSBcInN0cmluZ1wiICYmIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkubmFtZS5sZW5ndGggPiAwXG4gICAgICAgID8gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS5uYW1lXG4gICAgICAgIDogXCJhdHRhY2htZW50LmJpblwiXG4gICAgfVxuICB9XG5cbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNCeXRlcyhpbnB1dCkpIHtcbiAgICBjb25zdCBieXRlcyA9IGZyb250ZW5kQXR0YWNobWVudE5vcm1hbGl6ZUJ5dGVzKC8qKiBAdHlwZSB7VWludDhBcnJheSB8IEJ1ZmZlciB8IEFycmF5QnVmZmVyfSAqLyAoaW5wdXQpKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnRlbnRCYXNlNjQ6IGZyb250ZW5kQXR0YWNobWVudEJ5dGVzVG9CYXNlNjQoYnl0ZXMpLFxuICAgICAgY29udGVudFR5cGU6IG51bGwsXG4gICAgICBmaWxlbmFtZTogXCJhdHRhY2htZW50LmJpblwiXG4gICAgfVxuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiVW5zdXBwb3J0ZWQgZnJvbnRlbmQgYXR0YWNobWVudCBpbnB1dFwiKVxufVxuXG4vKipcbiAqIEZyb250ZW5kLW1vZGVsIGF0dGFjaG1lbnQgaGVscGVyIGZvciBvbmUgYXR0YWNobWVudCBuYW1lLlxuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGUge1xuICAvKipcbiAgICogUGVuZGluZyBhdHRhY2htZW50IGlucHV0cyBxdWV1ZWQgZm9yIHRoZSBuZXh0IG1vZGVsIHNhdmUuXG4gICAqIEB0eXBlIHtGcm9udGVuZE1vZGVsQXR0YWNobWVudElucHV0W119XG4gICAqL1xuICBwZW5kaW5nSW5wdXRzID0gW11cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2F0dGFjaG1lbnROYW1lLCBtb2RlbH0pIHtcbiAgICB0aGlzLm1vZGVsID0gbW9kZWxcbiAgICB0aGlzLmF0dGFjaG1lbnROYW1lID0gYXR0YWNobWVudE5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZSBhdHRhY2htZW50IGlucHV0IGZvciB0aGUgcGFyZW50IG1vZGVsJ3MgbmV4dCBzYXZlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxBdHRhY2htZW50SW5wdXQgfCBGcm9udGVuZE1vZGVsQXR0YWNobWVudElucHV0W119IGlucHV0IC0gQXR0YWNobWVudCBpbnB1dC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBxdWV1ZUF0dGFjaChpbnB1dCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24odGhpcy5hdHRhY2htZW50TmFtZSlcblxuICAgIGlmIChhdHRhY2htZW50RGVmaW5pdGlvbj8udHlwZSA9PT0gXCJoYXNPbmVcIikge1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoaW5wdXQpKSB7XG4gICAgICAgIGNvbnN0IGxhc3RJbnB1dCA9IGlucHV0W2lucHV0Lmxlbmd0aCAtIDFdXG5cbiAgICAgICAgdGhpcy5wZW5kaW5nSW5wdXRzID0gdHlwZW9mIGxhc3RJbnB1dCA9PT0gXCJ1bmRlZmluZWRcIiA/IFtdIDogW2xhc3RJbnB1dF1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucGVuZGluZ0lucHV0cyA9IFtpbnB1dF1cbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGlucHV0KSkge1xuICAgICAgdGhpcy5wZW5kaW5nSW5wdXRzLnB1c2goLi4uaW5wdXQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucGVuZGluZ0lucHV0cy5wdXNoKGlucHV0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoaXMgYXR0YWNobWVudCBoYXMgcXVldWVkIGlucHV0cyBmb3IgdGhlIG5leHQgbW9kZWwgc2F2ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgYW55IHBlbmRpbmcgaW5wdXRzIGV4aXN0LlxuICAgKi9cbiAgaGFzUGVuZGluZ0F0dGFjaG1lbnRzKCkge1xuICAgIHJldHVybiB0aGlzLnBlbmRpbmdJbnB1dHMubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgc2F2ZSBwYXlsb2FkIGZvciBxdWV1ZWQgYXR0YWNobWVudCBpbnB1dHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdIHwgdW5kZWZpbmVkPn0gTm9ybWFsaXplZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBwZW5kaW5nQXR0YWNobWVudHNQYXlsb2FkKCkge1xuICAgIGlmICh0aGlzLnBlbmRpbmdJbnB1dHMubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKHRoaXMuYXR0YWNobWVudE5hbWUpXG5cbiAgICBpZiAoYXR0YWNobWVudERlZmluaXRpb24/LnR5cGUgPT09IFwiaGFzTWFueVwiKSB7XG4gICAgICByZXR1cm4gYXdhaXQgUHJvbWlzZS5hbGwodGhpcy5wZW5kaW5nSW5wdXRzLm1hcChhc3luYyAoaW5wdXQpID0+IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0KSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KHRoaXMucGVuZGluZ0lucHV0c1t0aGlzLnBlbmRpbmdJbnB1dHMubGVuZ3RoIC0gMV0pXG4gIH1cblxuICAvKiogQ2xlYXJzIHF1ZXVlZCBhdHRhY2htZW50IGlucHV0cyBhZnRlciBhIHN1Y2Nlc3NmdWwgbW9kZWwgc2F2ZS4gKi9cbiAgY2xlYXJQZW5kaW5nQXR0YWNobWVudHMoKSB7XG4gICAgdGhpcy5wZW5kaW5nSW5wdXRzID0gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gaW5wdXQgLSBBdHRhY2htZW50IGlucHV0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGF0dGFjaGVkLlxuICAgKi9cbiAgYXN5bmMgYXR0YWNoKGlucHV0KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWRJbnB1dCA9IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0KVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcImF0dGFjaFwiLCB7XG4gICAgICBhdHRhY2htZW50OiBub3JtYWxpemVkSW5wdXQsXG4gICAgICBhdHRhY2htZW50TmFtZTogdGhpcy5hdHRhY2htZW50TmFtZSxcbiAgICAgIGlkOiB0aGlzLm1vZGVsLnByaW1hcnlLZXlWYWx1ZSgpXG4gICAgfSlcblxuICAgIHRoaXMubW9kZWwuYXNzaWduQXR0cmlidXRlcyhNb2RlbENsYXNzLmF0dHJpYnV0ZXNGcm9tUmVzcG9uc2UocmVzcG9uc2UpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZG93bmxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXR0YWNobWVudElkXSAtIE9wdGlvbmFsIGF0dGFjaG1lbnQgaWQgZm9yIGhhcy1tYW55IGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZE1vZGVsQXR0YWNobWVudERvd25sb2FkIHwgbnVsbD59IC0gRG93bmxvYWRlZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBkb3dubG9hZChhdHRhY2htZW50SWQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiZG93bmxvYWRcIiwgZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb21tYW5kUGF5bG9hZCh0aGlzLCBhdHRhY2htZW50SWQpKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRQYXlsb2FkID0gcmVzcG9uc2UuYXR0YWNobWVudFxuXG4gICAgaWYgKCFhdHRhY2htZW50UGF5bG9hZCB8fCB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQgIT09IFwib2JqZWN0XCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBjb250ZW50QmFzZTY0ID0gdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRCYXNlNjQgPT09IFwic3RyaW5nXCIgPyBhdHRhY2htZW50UGF5bG9hZC5jb250ZW50QmFzZTY0IDogXCJcIlxuICAgIGNvbnN0IGNvbnRlbnQgPSBmcm9udGVuZEF0dGFjaG1lbnRCYXNlNjRUb0J5dGVzKGNvbnRlbnRCYXNlNjQpXG4gICAgY29uc3QgYnl0ZVNpemUgPSBOdW1iZXIoYXR0YWNobWVudFBheWxvYWQuYnl0ZVNpemUpXG5cbiAgICByZXR1cm4gbmV3IEZyb250ZW5kTW9kZWxBdHRhY2htZW50RG93bmxvYWQoe1xuICAgICAgYnl0ZVNpemU6IE51bWJlci5pc0Zpbml0ZShieXRlU2l6ZSkgPyBieXRlU2l6ZSA6IGNvbnRlbnQubGVuZ3RoLFxuICAgICAgY29udGVudCxcbiAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQuY29udGVudFR5cGUgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudFBheWxvYWQuY29udGVudFR5cGUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRUeXBlIDogbnVsbCxcbiAgICAgIGZpbGVuYW1lOiB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQuZmlsZW5hbWUgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudFBheWxvYWQuZmlsZW5hbWUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnRQYXlsb2FkLmZpbGVuYW1lIDogXCJhdHRhY2htZW50LmJpblwiLFxuICAgICAgaWQ6IHR5cGVvZiBhdHRhY2htZW50UGF5bG9hZC5pZCA9PT0gXCJzdHJpbmdcIiA/IGF0dGFjaG1lbnRQYXlsb2FkLmlkIDogXCJcIixcbiAgICAgIHVybDogdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLnVybCA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50UGF5bG9hZC51cmwubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnRQYXlsb2FkLnVybCA6IG51bGxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXJsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2F0dGFjaG1lbnRJZF0gLSBPcHRpb25hbCBhdHRhY2htZW50IGlkIGZvciBoYXMtbWFueSBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gUmVzb2x2YWJsZSBhdHRhY2htZW50IFVSTC5cbiAgICovXG4gIGFzeW5jIHVybChhdHRhY2htZW50SWQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwidXJsXCIsIGZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29tbWFuZFBheWxvYWQodGhpcywgYXR0YWNobWVudElkKSlcblxuICAgIGlmICh0eXBlb2YgcmVzcG9uc2UudXJsID09PSBcInN0cmluZ1wiICYmIHJlc3BvbnNlLnVybC5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gcmVzcG9uc2UudXJsXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBxdWVyeSBmb3IgdGhpcyBhdHRhY2htZW50IGhhbmRsZSdzIG1ldGFkYXRhIHJvd3MuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIFZlbG9jaW91c0F0dGFjaG1lbnQ+fSAtIEF0dGFjaG1lbnQgbWV0YWRhdGEgcXVlcnkuXG4gICAqL1xuICBxdWVyeSgpIHtcbiAgICBjb25zdCBhdHRhY2htZW50T3duZXIgPSBmcm9udGVuZE1vZGVsQXR0YWNobWVudE93bmVyKHRoaXMubW9kZWwpXG5cbiAgICByZXR1cm4gVmVsb2Npb3VzQXR0YWNobWVudFxuICAgICAgLndoZXJlKHtcbiAgICAgICAgbmFtZTogdGhpcy5hdHRhY2htZW50TmFtZSxcbiAgICAgICAgcmVjb3JkSWQ6IGF0dGFjaG1lbnRPd25lci5yZWNvcmRJZCxcbiAgICAgICAgcmVjb3JkVHlwZTogYXR0YWNobWVudE93bmVyLnJlY29yZFR5cGUsXG4gICAgICAgIHJlc291cmNlTmFtZTogYXR0YWNobWVudE93bmVyLnJlc291cmNlTmFtZVxuICAgICAgfSlcbiAgICAgIC5vcmRlcihbW1wicG9zaXRpb25cIiwgXCJhc2NcIl1dKVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGFsbCBhdHRhY2htZW50IG1ldGFkYXRhIHJvd3MgZm9yIHRoaXMgaGFuZGxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxWZWxvY2lvdXNBdHRhY2htZW50W10+fSAtIEF0dGFjaG1lbnQgbWV0YWRhdGEgcm93cy5cbiAgICovXG4gIGFzeW5jIHRvQXJyYXkoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS50b0FycmF5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgZmlyc3QgYXR0YWNobWVudCBtZXRhZGF0YSByb3cgZm9yIHRoaXMgaGFuZGxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxWZWxvY2lvdXNBdHRhY2htZW50IHwgbnVsbD59IC0gRmlyc3QgYXR0YWNobWVudCBtZXRhZGF0YSByb3cuXG4gICAqL1xuICBhc3luYyBmaXJzdCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpcnN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxpc3QuIFJldHVybnMgbWV0YWRhdGEgZm9yIGV2ZXJ5IGF0dGFjaG1lbnQgdW5kZXIgdGhpcyBhdHRhY2htZW50IG5hbWVcbiAgICogKG5vIGNvbnRlbnQgYnl0ZXMpLCBzbyBjYWxsZXJzIGNhbiBlbnVtZXJhdGUgaGFzLW1hbnkgYXR0YWNobWVudHMgYW5kIHRoZW5cbiAgICogZG93bmxvYWQgb3IgbGluayB0byBlYWNoIG9uZSBieSBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8e2J5dGVTaXplOiBudW1iZXIsIGNvbnRlbnRUeXBlOiBzdHJpbmcgfCBudWxsLCBmaWxlbmFtZTogc3RyaW5nLCBpZDogc3RyaW5nLCB1cmw6IHN0cmluZyB8IG51bGx9Pj59IC0gQXR0YWNobWVudCBtZXRhZGF0YSBlbnRyaWVzLlxuICAgKi9cbiAgYXN5bmMgbGlzdCgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiYXR0YWNobWVudExpc3RcIiwgZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb21tYW5kUGF5bG9hZCh0aGlzKSlcbiAgICBjb25zdCBhdHRhY2htZW50cyA9IEFycmF5LmlzQXJyYXkocmVzcG9uc2UuYXR0YWNobWVudHMpID8gcmVzcG9uc2UuYXR0YWNobWVudHMgOiBbXVxuXG4gICAgcmV0dXJuIGF0dGFjaG1lbnRzLm1hcCgoYXR0YWNobWVudCkgPT4ge1xuICAgICAgY29uc3QgYnl0ZVNpemUgPSBOdW1iZXIoYXR0YWNobWVudC5ieXRlU2l6ZSlcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYnl0ZVNpemU6IE51bWJlci5pc0Zpbml0ZShieXRlU2l6ZSkgPyBieXRlU2l6ZSA6IDAsXG4gICAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgYXR0YWNobWVudC5jb250ZW50VHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50LmNvbnRlbnRUeXBlLmxlbmd0aCA+IDAgPyBhdHRhY2htZW50LmNvbnRlbnRUeXBlIDogbnVsbCxcbiAgICAgICAgZmlsZW5hbWU6IHR5cGVvZiBhdHRhY2htZW50LmZpbGVuYW1lID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnQuZmlsZW5hbWUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnQuZmlsZW5hbWUgOiBcImF0dGFjaG1lbnQuYmluXCIsXG4gICAgICAgIGlkOiB0eXBlb2YgYXR0YWNobWVudC5pZCA9PT0gXCJzdHJpbmdcIiA/IGF0dGFjaG1lbnQuaWQgOiBcIlwiLFxuICAgICAgICB1cmw6IHR5cGVvZiBhdHRhY2htZW50LnVybCA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50LnVybC5sZW5ndGggPiAwID8gYXR0YWNobWVudC51cmwgOiBudWxsXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRvd25sb2FkIHVybC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEb3dubG9hZCBVUkwgZm9yIHRoaXMgYXR0YWNobWVudCBvbiB0aGUgY29uZmlndXJlZCBiYWNrZW5kLlxuICAgKi9cbiAgZG93bmxvYWRVcmwoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IGNvbW1hbmROYW1lID0gTW9kZWxDbGFzcy5jb21tYW5kTmFtZShcImRvd25sb2FkXCIpXG4gICAgY29uc3QgcmVzb3VyY2VQYXRoID0gTW9kZWxDbGFzcy5yZXNvdXJjZVBhdGgoKVxuICAgIGNvbnN0IGNvbW1hbmRVcmwgPSBmcm9udGVuZE1vZGVsQ29tbWFuZFVybChyZXNvdXJjZVBhdGgsIGNvbW1hbmROYW1lKVxuICAgIGNvbnN0IHBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xuICAgICAgYXR0YWNobWVudE5hbWU6IHRoaXMuYXR0YWNobWVudE5hbWUsXG4gICAgICBpZDogbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIHRoaXMubW9kZWwucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgfSlcblxuICAgIHJldHVybiBgJHtjb21tYW5kVXJsfT8ke3BhcmFtcy50b1N0cmluZygpfWBcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB1cmwuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZCB8IG51bGx9IHZhbHVlIC0gVVJMIGNhbmRpZGF0ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9ybWFsaXplZCBVUkwgd2l0aG91dCB0cmFpbGluZyBzbGFzaC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybCh2YWx1ZSkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiKSByZXR1cm4gXCJcIlxuXG4gIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKClcblxuICBpZiAoIXRyaW1tZWQubGVuZ3RoKSByZXR1cm4gXCJcIlxuXG4gIHJldHVybiB0cmltbWVkLnJlcGxhY2UoL1xcLyskLywgXCJcIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB1cmwuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlc29sdmVkIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCBVUkwuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRVcmwoKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRVcmwgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy51cmwgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy51cmwoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy51cmxcblxuICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybChjb25maWd1cmVkVXJsKVxufVxuXG4vKipcbiAqIFJ1bnMgY2xvbmUgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlcy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB2YWx1ZSAtIEF0dHJpYnV0ZXMgaGFzaC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2xvbmVkIGF0dHJpYnV0ZXMgaGFzaC5cbiAqL1xuZnVuY3Rpb24gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyh2YWx1ZSkge1xuICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUodmFsdWUpKSlcbn1cblxuLyoqXG4gKiBTaGFyZWQgY2hhbm5lbCBuYW1lIGZvciBtb2RlbCBsaWZlY3ljbGUgZXZlbnRzIChQaGFzZSAzKS5cbiAqIE1hdGNoZXMgdGhlIGJhY2tlbmQgYEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUVgLlxuICovXG5jb25zdCBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FID0gXCJmcm9udGVuZC1tb2RlbHNcIlxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgZnJvbnRlbmQgbW9kZWwgZXZlbnQgcHJlbG9hZC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSB0YXJnZXQgLSBUYXJnZXQgcHJlbG9hZCBwYXlsb2FkLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IHNvdXJjZSAtIFNvdXJjZSBwcmVsb2FkIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRQcmVsb2FkKHRhcmdldCwgc291cmNlKSB7XG4gIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2UpKSB7XG4gICAgY29uc3QgZXhpc3RpbmdWYWx1ZSA9IHRhcmdldFtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgaWYgKHZhbHVlID09PSB0cnVlIHx8IHZhbHVlID09PSBmYWxzZSkge1xuICAgICAgaWYgKGV4aXN0aW5nVmFsdWUgPT09IHVuZGVmaW5lZCkgdGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdID0gdmFsdWVcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRhcmdldFtyZWxhdGlvbnNoaXBOYW1lXSA9IHZhbHVlXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICghZXhpc3RpbmdWYWx1ZSB8fCB0eXBlb2YgZXhpc3RpbmdWYWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGV4aXN0aW5nVmFsdWUpKSB7XG4gICAgICB0YXJnZXRbcmVsYXRpb25zaGlwTmFtZV0gPSB7fVxuICAgIH1cblxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50UHJlbG9hZChcbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAodGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdKSxcbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAodmFsdWUpXG4gICAgKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBtZXJnZSBmcm9udGVuZCBtb2RlbCBldmVudCBzZWxlY3QuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gdGFyZ2V0IC0gVGFyZ2V0IHNlbGVjdCBtYXAuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gc291cmNlIC0gU291cmNlIHNlbGVjdCBtYXAuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRTZWxlY3QodGFyZ2V0LCBzb3VyY2UpIHtcbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCBhdHRyaWJ1dGVzXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2UpKSB7XG4gICAgY29uc3QgZXhpc3RpbmdBdHRyaWJ1dGVzID0gdGFyZ2V0W21vZGVsTmFtZV0gfHwgW11cblxuICAgIHRhcmdldFttb2RlbE5hbWVdID0gQXJyYXkuZnJvbShuZXcgU2V0KGV4aXN0aW5nQXR0cmlidXRlcy5jb25jYXQoYXR0cmlidXRlcykpKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBtZXJnZSB1bmlxdWUgZnJvbnRlbmQgbW9kZWwgZXZlbnQgZW50cmllcy5cbiAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsV2l0aENvdW50UGF5bG9hZEVudHJ5IHwgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsQWJpbGl0aWVzUGF5bG9hZEVudHJ5Pn0gdGFyZ2V0IC0gVGFyZ2V0IGFycmF5LlxuICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxXaXRoQ291bnRQYXlsb2FkRW50cnkgfCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxBYmlsaXRpZXNQYXlsb2FkRW50cnk+fSBzb3VyY2UgLSBTb3VyY2UgYXJyYXkuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VVbmlxdWVGcm9udGVuZE1vZGVsRXZlbnRFbnRyaWVzKHRhcmdldCwgc291cmNlKSB7XG4gIGNvbnN0IGV4aXN0aW5nS2V5cyA9IG5ldyBTZXQodGFyZ2V0Lm1hcCgoZW50cnkpID0+IEpTT04uc3RyaW5naWZ5KGVudHJ5KSkpXG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBzb3VyY2UpIHtcbiAgICBjb25zdCBrZXkgPSBKU09OLnN0cmluZ2lmeShlbnRyeSlcblxuICAgIGlmIChleGlzdGluZ0tleXMuaGFzKGtleSkpIGNvbnRpbnVlXG5cbiAgICB0YXJnZXQucHVzaChlbnRyeSlcbiAgICBleGlzdGluZ0tleXMuYWRkKGtleSlcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgZnJvbnRlbmQgbW9kZWwgZXZlbnQgcHJvamVjdGlvbiBwYXlsb2FkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH0gdGFyZ2V0IC0gVGFyZ2V0IHBheWxvYWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfSBzb3VyY2UgLSBTb3VyY2UgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByb2plY3Rpb25QYXlsb2FkKHRhcmdldCwgc291cmNlKSB7XG4gIGlmIChzb3VyY2UucHJlbG9hZCkge1xuICAgIGlmICghdGFyZ2V0LnByZWxvYWQpIHRhcmdldC5wcmVsb2FkID0ge31cbiAgICBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByZWxvYWQodGFyZ2V0LnByZWxvYWQsIHNvdXJjZS5wcmVsb2FkKVxuICB9XG5cbiAgaWYgKHNvdXJjZS5zZWxlY3QpIHtcbiAgICBpZiAoIXRhcmdldC5zZWxlY3QpIHRhcmdldC5zZWxlY3QgPSB7fVxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50U2VsZWN0KHRhcmdldC5zZWxlY3QsIHNvdXJjZS5zZWxlY3QpXG4gIH1cblxuICBpZiAoc291cmNlLnNlbGVjdHNFeHRyYSkge1xuICAgIGlmICghdGFyZ2V0LnNlbGVjdHNFeHRyYSkgdGFyZ2V0LnNlbGVjdHNFeHRyYSA9IHt9XG4gICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRTZWxlY3QodGFyZ2V0LnNlbGVjdHNFeHRyYSwgc291cmNlLnNlbGVjdHNFeHRyYSlcbiAgfVxuXG4gIGlmIChzb3VyY2Uud2l0aENvdW50KSB7XG4gICAgaWYgKCF0YXJnZXQud2l0aENvdW50KSB0YXJnZXQud2l0aENvdW50ID0gW11cbiAgICBtZXJnZVVuaXF1ZUZyb250ZW5kTW9kZWxFdmVudEVudHJpZXModGFyZ2V0LndpdGhDb3VudCwgc291cmNlLndpdGhDb3VudClcbiAgfVxuXG4gIGlmIChzb3VyY2UuYWJpbGl0aWVzKSB7XG4gICAgaWYgKCF0YXJnZXQuYWJpbGl0aWVzKSB0YXJnZXQuYWJpbGl0aWVzID0gW11cbiAgICBtZXJnZVVuaXF1ZUZyb250ZW5kTW9kZWxFdmVudEVudHJpZXModGFyZ2V0LmFiaWxpdGllcywgc291cmNlLmFiaWxpdGllcylcbiAgfVxuXG4gIGlmIChzb3VyY2UucXVlcnlEYXRhICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCB0YXJnZXRRdWVyeURhdGEgPSBBcnJheS5pc0FycmF5KHRhcmdldC5xdWVyeURhdGEpID8gdGFyZ2V0LnF1ZXJ5RGF0YSA6IFtdXG5cbiAgICB0YXJnZXQucXVlcnlEYXRhID0gdGFyZ2V0UXVlcnlEYXRhXG4gICAgY29uc3QgcXVlcnlEYXRhRW50cmllcyA9IEFycmF5LmlzQXJyYXkoc291cmNlLnF1ZXJ5RGF0YSkgPyBzb3VyY2UucXVlcnlEYXRhIDogW3NvdXJjZS5xdWVyeURhdGFdXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHF1ZXJ5RGF0YUVudHJpZXMpIHtcbiAgICAgIHRhcmdldFF1ZXJ5RGF0YS5wdXNoKGVudHJ5KVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgbWF0Y2hlZCBldmVudCBmaWx0ZXIga2V5cy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBSYXcgd2Vic29ja2V0IGV2ZW50IGJvZHkuXG4gKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gTWF0Y2hlZCBldmVudCBmaWx0ZXIga2V5cyBkZWxpdmVyZWQgYnkgdGhlIGJhY2tlbmQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxNYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKGJvZHkpIHtcbiAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSBcIm9iamVjdFwiKSByZXR1cm4gbmV3IFNldCgpXG5cbiAgY29uc3Qga2V5cyA9IC8qKiBAdHlwZSB7e21hdGNoZWRFdmVudEZpbHRlcktleXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovIChib2R5KS5tYXRjaGVkRXZlbnRGaWx0ZXJLZXlzXG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KGtleXMpKSByZXR1cm4gbmV3IFNldCgpXG5cbiAgcmV0dXJuIG5ldyBTZXQoa2V5cy5tYXAoKGtleSkgPT4gU3RyaW5nKGtleSkpKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgZXZlbnQgZW50cnkgbWF0Y2hlcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5fSBlbnRyeSAtIENhbGxiYWNrIGVudHJ5LlxuICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyAtIEJhY2tlbmQgbWF0Y2hlZCBmaWx0ZXIga2V5cy5cbiAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSBjYWxsYmFjayBzaG91bGQgcmVjZWl2ZSB0aGUgZXZlbnQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxFdmVudEVudHJ5TWF0Y2hlcyhlbnRyeSwgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cykge1xuICBpZiAoIWVudHJ5LmV2ZW50RmlsdGVyS2V5KSByZXR1cm4gdHJ1ZVxuXG4gIHJldHVybiBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzLmhhcyhlbnRyeS5ldmVudEZpbHRlcktleSlcbn1cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBubyBkZXN0cm95IGV2ZW50IGZpbHRlci5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gRXZlbnQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gb3B0aW9ucyAtIEV2ZW50IG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0Tm9EZXN0cm95RXZlbnRGaWx0ZXIoTW9kZWxDbGFzcywgb3B0aW9ucykge1xuICBjb25zdCBldmVudE9wdGlvbnNQYXlsb2FkID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQoTW9kZWxDbGFzcywgb3B0aW9ucylcblxuICBpZiAoIWV2ZW50T3B0aW9uc1BheWxvYWQuZXZlbnRGaWx0ZXJLZXkpIHJldHVyblxuXG4gIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIGRlc3Ryb3kgZXZlbnQgc3Vic2NyaXB0aW9ucyBkbyBub3Qgc3VwcG9ydCBxdWVyeSBmaWx0ZXJzXCIpXG59XG5cbi8qKlxuICogUGVyLW1vZGVsIGNsYXNzIHNpbmdsZXRvbiB0aGF0IG11bHRpcGxleGVzIGFsbCByZWdpc3RlcmVkIG9uQ3JlYXRlIC9cbiAqIG9uVXBkYXRlIC8gb25EZXN0cm95IGNhbGxiYWNrcyDigJQgY2xhc3MtbGV2ZWwgKyBpbnN0YW5jZS1sZXZlbCDigJRcbiAqIG92ZXIgb25lIFdlYnNvY2tldENoYW5uZWxWMiBzdWJzY3JpcHRpb24uIFN1YnNjcmlwdGlvbiBvcGVucyBvbiB0aGVcbiAqIGZpcnN0IGxpc3RlbmVyIGFuZCBjbG9zZXMgd2hlbiB0aGUgbGFzdCBvbmUgdW5zdWJzY3JpYmVzLlxuICpcbiAqIEluc3RhbmNlLWxldmVsIGxpc3RlbmVycyBhbHNvIHJlY2VpdmUgYXV0by1tZXJnZTogd2hlbiBhbiBgdXBkYXRlYFxuICogZXZlbnQgYXJyaXZlcyBmb3IgYSByZWdpc3RlcmVkIGluc3RhbmNlIGlkLCB0aGUgaW5zdGFuY2Unc1xuICogYXR0cmlidXRlcyBhcmUgdXBkYXRlZCBpbiBwbGFjZSBiZWZvcmUgdGhlIGNhbGxiYWNrIGZpcmVzLCBzb1xuICogY2FsbGVycyBjYW4gcmVhZCBmcmVzaCB2YWx1ZXMgZnJvbSB0aGUgc2FtZSBpbnN0YW5jZSBoYW5kbGUuXG4gKi9cbmNsYXNzIEZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbiB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzIGZvciB0aGlzIHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dH0gcmVxdWVzdENvbnRleHQgLSBDYXB0dXJlZCBzdWJzY3JpcHRpb24gY29udGV4dC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKE1vZGVsQ2xhc3MsIHJlcXVlc3RDb250ZXh0KSB7XG4gICAgdGhpcy5Nb2RlbENsYXNzID0gTW9kZWxDbGFzc1xuICAgIHRoaXMucmVxdWVzdENvbnRleHQgPSByZXF1ZXN0Q29udGV4dFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeT59ICovXG4gICAgdGhpcy5jbGFzc0NyZWF0ZUNhbGxiYWNrcyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeT59ICovXG4gICAgdGhpcy5jbGFzc1VwZGF0ZUNhbGxiYWNrcyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5Pn0gKi9cbiAgICB0aGlzLmNsYXNzRGVzdHJveUNhbGxiYWNrcyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywge2luc3RhbmNlOiBGcm9udGVuZE1vZGVsQmFzZSwgdXBkYXRlQ2FsbGJhY2tzOiBTZXQ8RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5PiwgZGVzdHJveUNhbGxiYWNrczogU2V0PEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5Pn0+fSAqL1xuICAgIHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IG51bGxcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMucmVhZHlQcm9taXNlID0gbnVsbFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7c3RyaW5nIHwgbnVsbH0gKi9cbiAgICB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1YnNjcmlwdGlvbiBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHt7bW9kZWw6IHN0cmluZywgZGVzdHJveUV2ZW50RGVsaXZlcnk/OiBib29sZWFuLCBldmVudEZpbHRlcnM/OiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeVtdLCB1bmZpbHRlcmVkRXZlbnREZWxpdmVyeT86IGJvb2xlYW59ICYgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9IC0gQ3VycmVudCB3ZWJzb2NrZXQgc3Vic2NyaXB0aW9uIHBhcmFtcy5cbiAgICovXG4gIHN1YnNjcmlwdGlvblBhcmFtcygpIHtcbiAgICAvKipcbiAgICAgKiBQcm9qZWN0aW9uIHBheWxvYWQuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfSAqL1xuICAgIGNvbnN0IHByb2plY3Rpb25QYXlsb2FkID0ge31cbiAgICAvKipcbiAgICAgKiBFdmVudCBmaWx0ZXJzIGJ5IGtleS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnk+fSAqL1xuICAgIGNvbnN0IGV2ZW50RmlsdGVyc0J5S2V5ID0ge31cbiAgICBjb25zdCBwcm9qZWN0aW9uRW50cmllcyA9IFtdXG4gICAgbGV0IGhhc0Rlc3Ryb3lFdmVudERlbGl2ZXJ5ID0gdGhpcy5jbGFzc0Rlc3Ryb3lDYWxsYmFja3Muc2l6ZSA+IDBcbiAgICBsZXQgaGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLmNsYXNzQ3JlYXRlQ2FsbGJhY2tzKSBwcm9qZWN0aW9uRW50cmllcy5wdXNoKGVudHJ5KVxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgdGhpcy5jbGFzc1VwZGF0ZUNhbGxiYWNrcykgcHJvamVjdGlvbkVudHJpZXMucHVzaChlbnRyeSlcblxuICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgdGhpcy5pbnN0YW5jZUxpc3RlbmVycy52YWx1ZXMoKSkge1xuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBsaXN0ZW5lci51cGRhdGVDYWxsYmFja3MpIHByb2plY3Rpb25FbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICBpZiAobGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcy5zaXplID4gMCkgaGFzRGVzdHJveUV2ZW50RGVsaXZlcnkgPSB0cnVlXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBwcm9qZWN0aW9uRW50cmllcykge1xuICAgICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRQcm9qZWN0aW9uUGF5bG9hZChwcm9qZWN0aW9uUGF5bG9hZCwgZW50cnkucHJvamVjdGlvblBheWxvYWQpXG5cbiAgICAgIGlmIChlbnRyeS5ldmVudEZpbHRlcktleSAmJiBlbnRyeS5ldmVudEZpbHRlclBheWxvYWQpIHtcbiAgICAgICAgZXZlbnRGaWx0ZXJzQnlLZXlbZW50cnkuZXZlbnRGaWx0ZXJLZXldID0ge1xuICAgICAgICAgIC4uLmVudHJ5LmV2ZW50RmlsdGVyUGF5bG9hZCxcbiAgICAgICAgICBrZXk6IGVudHJ5LmV2ZW50RmlsdGVyS2V5XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGhhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5ID0gdHJ1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGV2ZW50RmlsdGVycyA9IE9iamVjdC52YWx1ZXMoZXZlbnRGaWx0ZXJzQnlLZXkpXG4gICAgY29uc3QgZXZlbnRGaWx0ZXJQYXJhbXMgPSBldmVudEZpbHRlcnMubGVuZ3RoID4gMFxuICAgICAgPyB7XG4gICAgICAgICAgZXZlbnRGaWx0ZXJzLFxuICAgICAgICAgIC4uLihoYXNEZXN0cm95RXZlbnREZWxpdmVyeSA/IHtkZXN0cm95RXZlbnREZWxpdmVyeTogdHJ1ZX0gOiB7fSksXG4gICAgICAgICAgLi4uKGhhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5ID8ge3VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5OiB0cnVlfSA6IHt9KVxuICAgICAgICB9XG4gICAgICA6IHt9XG5cbiAgICByZXR1cm4gbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQoXG4gICAgICB0aGlzLnJlcXVlc3RDb250ZXh0LFxuICAgICAge1xuICAgICAgICBtb2RlbDogdGhpcy5Nb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICAuLi5ldmVudEZpbHRlclBhcmFtcyxcbiAgICAgICAgLi4ucHJvamVjdGlvblBheWxvYWRcbiAgICAgIH1cbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdWJzY3JpcHRpb24gcGFyYW1zIGpzb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RhYmxlIGtleSBmb3IgY3VycmVudCBzdWJzY3JpcHRpb24gcGFyYW1zLlxuICAgKi9cbiAgc3Vic2NyaXB0aW9uUGFyYW1zSnNvbigpIHtcbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodGhpcy5zdWJzY3JpcHRpb25QYXJhbXMoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyIGNsYXNzIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeSB8IEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5fSBUXG4gICAqIEBwYXJhbSB7U2V0PFQ+fSBjYWxsYmFja3MgLSBDYWxsYmFjayBzZXQgZm9yIHRoZSBldmVudCB0eXBlLlxuICAgKiBAcGFyYW0ge1R9IGVudHJ5IC0gQ2FsbGJhY2sgZW50cnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgcmVnaXN0ZXJDbGFzc0NhbGxiYWNrKGNhbGxiYWNrcywgZW50cnkpIHtcbiAgICBjYWxsYmFja3MuYWRkKGVudHJ5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlU3Vic2NyaWJlZCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNhbGxiYWNrcy5kZWxldGUoZW50cnkpXG4gICAgICB0aGlzLm1heWJlVGVhcmRvd24oKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgY2FsbGJhY2tzLmRlbGV0ZShlbnRyeSlcbiAgICAgIHRoaXMubWF5YmVUZWFyZG93bigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIHN1YnNjcmliZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAqL1xuICBhc3luYyBlbnN1cmVTdWJzY3JpYmVkKCkge1xuICAgIGNvbnN0IHBhcmFtc0pzb24gPSB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0pzb24oKVxuXG4gICAgaWYgKHRoaXMuY2hhbm5lbEhhbmRsZSAmJiAhdGhpcy5jaGFubmVsSGFuZGxlLmlzQ2xvc2VkKCkpIHtcbiAgICAgIGlmICh0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSAhPT0gcGFyYW1zSnNvbikge1xuICAgICAgICB0aGlzLmNoYW5uZWxIYW5kbGUuY2xvc2UoKVxuICAgICAgICB0aGlzLmNoYW5uZWxIYW5kbGUgPSBudWxsXG4gICAgICAgIHRoaXMucmVhZHlQcm9taXNlID0gbnVsbFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHRoaXMucmVhZHlQcm9taXNlKSBhd2FpdCB0aGlzLnJlYWR5UHJvbWlzZVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTZXJpYWxpemUgcGFyYWxsZWwgY2FsbHMgKGUuZy4gUHJvbWlzZS5hbGwoW29uQ3JlYXRlLCBvblVwZGF0ZSxcbiAgICAvLyBvbkRlc3Ryb3ldKSkgc28gd2Ugb3BlbiBleGFjdGx5IG9uZSBzdWJzY3JpcHRpb24gcGVyIG1vZGVsIGNsYXNzXG4gICAgLy8gaW5zdGVhZCBvZiByYWNpbmcgdGhyZWUgY29uY3VycmVudCBzdWJzY3JpYmVDaGFubmVsIGNhbGxzLlxuICAgIGlmICh0aGlzLnJlYWR5UHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5yZWFkeVByb21pc2VcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgIGlmICghY2xpZW50IHx8IHR5cGVvZiBjbGllbnQuc3Vic2NyaWJlQ2hhbm5lbCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudCBzdWJzY3JpcHRpb25zIHJlcXVpcmUgY29uZmlndXJlVHJhbnNwb3J0KHt3ZWJzb2NrZXRVcmx9KSBvciBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldENsaWVudH0pXCIpXG4gICAgfVxuXG4gICAgdGhpcy5yZWFkeVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHR5cGVvZiBjbGllbnQuY29ubmVjdCA9PT0gXCJmdW5jdGlvblwiKSBhd2FpdCBjbGllbnQuY29ubmVjdCgpXG5cbiAgICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zKClcblxuICAgICAgdGhpcy5zdWJzY3JpcHRpb25QYXJhbXNLZXkgPSBKU09OLnN0cmluZ2lmeShwYXJhbXMpXG4gICAgICB0aGlzLmNoYW5uZWxIYW5kbGUgPSBjbGllbnQuc3Vic2NyaWJlQ2hhbm5lbChGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FLCB7XG4gICAgICAgIHBhcmFtcyxcbiAgICAgICAgb25NZXNzYWdlOiAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gYm9keSkgPT4gdGhpcy5fZGlzcGF0Y2hFdmVudChib2R5KSxcbiAgICAgICAgb25DbG9zZTogKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IG51bGxcbiAgICAgICAgICB0aGlzLnJlYWR5UHJvbWlzZSA9IG51bGxcbiAgICAgICAgICB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSA9IG51bGxcbiAgICAgICAgICB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLmNsZWFyKClcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIGF3YWl0IHRoaXMuY2hhbm5lbEhhbmRsZS5yZWFkeVxuICAgIH0pKClcblxuICAgIGF3YWl0IHRoaXMucmVhZHlQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXNwYXRjaCBldmVudC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keSAtIFdlYlNvY2tldCBldmVudCBwYXlsb2FkLlxuICAgKi9cbiAgX2Rpc3BhdGNoRXZlbnQoYm9keSkge1xuICAgIGlmICghYm9keSB8fCB0eXBlb2YgYm9keSAhPT0gXCJvYmplY3RcIikgcmV0dXJuXG5cbiAgICBjb25zdCBhY3Rpb24gPSBib2R5LmFjdGlvblxuICAgIGNvbnN0IHJhd0lkID0gYm9keS5pZFxuXG4gICAgaWYgKGFjdGlvbiAhPT0gXCJjcmVhdGVcIiAmJiBhY3Rpb24gIT09IFwidXBkYXRlXCIgJiYgYWN0aW9uICE9PSBcImRlc3Ryb3lcIikgcmV0dXJuXG4gICAgaWYgKHJhd0lkID09PSB1bmRlZmluZWQgfHwgcmF3SWQgPT09IG51bGwpIHJldHVyblxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBpZGVudGl0eSA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSlcbiAgICAgID8gbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhwcmltYXJ5S2V5LCByYXdJZClcbiAgICAgIDogU3RyaW5nKHJhd0lkKVxuICAgIGNvbnN0IGlkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgaWRlbnRpdHkpXG4gICAgY29uc3QgcmF3UHJldmlvdXNJZCA9IGJvZHkucHJldmlvdXNJZFxuICAgIGNvbnN0IHByZXZpb3VzSWRlbnRpdHkgPSByYXdQcmV2aW91c0lkID09PSB1bmRlZmluZWQgfHwgcmF3UHJldmlvdXNJZCA9PT0gbnVsbFxuICAgICAgPyBudWxsXG4gICAgICA6IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSlcbiAgICAgICAgPyBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIHJhd1ByZXZpb3VzSWQpXG4gICAgICAgIDogU3RyaW5nKHJhd1ByZXZpb3VzSWQpXG4gICAgY29uc3QgcHJldmlvdXNJZCA9IHByZXZpb3VzSWRlbnRpdHkgPT09IG51bGxcbiAgICAgID8gbnVsbFxuICAgICAgOiBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkZW50aXR5KVxuICAgIGNvbnN0IG1hdGNoZWRFdmVudEZpbHRlcktleXMgPSBmcm9udGVuZE1vZGVsTWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyhib2R5KVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJkZXN0cm95XCIpIHtcbiAgICAgIGNvbnN0IGxpc3RlbmVyID0gdGhpcy5pbnN0YW5jZUxpc3RlbmVycy5nZXQoaWQpXG5cbiAgICAgIGlmIChsaXN0ZW5lcikge1xuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxpc3RlbmVyLmRlc3Ryb3lDYWxsYmFja3MpIHtcbiAgICAgICAgICB0cnkgeyBlbnRyeS5jYWxsYmFjayh7aWQ6IGlkZW50aXR5fSkgfSBjYXRjaCAoZXJyb3IpIHsgY29uc29sZS5lcnJvcihlcnJvcikgfVxuICAgICAgICB9XG4gICAgICAgIGRlbGV0ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyKHRoaXMsIGxpc3RlbmVyKVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLmNsYXNzRGVzdHJveUNhbGxiYWNrcykge1xuICAgICAgICB0cnkgeyBlbnRyeS5jYWxsYmFjayh7aWQ6IGlkZW50aXR5fSkgfSBjYXRjaCAoZXJyb3IpIHsgY29uc29sZS5lcnJvcihlcnJvcikgfVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgbGlzdGVuZXIgPSB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLmdldChpZCkgfHwgKHByZXZpb3VzSWQgPT09IG51bGwgPyB1bmRlZmluZWQgOiB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLmdldChwcmV2aW91c0lkKSlcblxuICAgIGlmIChhY3Rpb24gPT09IFwidXBkYXRlXCIgJiYgbGlzdGVuZXIgJiYgcHJldmlvdXNJZGVudGl0eSAhPT0gbnVsbCkge1xuICAgICAgYXBwbHlGcm9udGVuZE1vZGVsUGVyc2lzdGVkSWRlbnRpdHkodGhpcy5Nb2RlbENsYXNzLCBsaXN0ZW5lci5pbnN0YW5jZSwgaWRlbnRpdHkpXG4gICAgICByZWtleUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyh0aGlzLk1vZGVsQ2xhc3MsIGxpc3RlbmVyLmluc3RhbmNlLCBwcmV2aW91c0lkZW50aXR5LCBpZGVudGl0eSlcbiAgICB9XG5cbiAgICBpZiAoIWJvZHkucmVjb3JkIHx8IHR5cGVvZiBib2R5LnJlY29yZCAhPT0gXCJvYmplY3RcIikgcmV0dXJuXG5cbiAgICBjb25zdCBkZXNlcmlhbGl6ZWRSZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGJvZHkucmVjb3JkKSlcbiAgICBjb25zdCBmcmVzaE1vZGVsID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMuTW9kZWxDbGFzcykuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UoZGVzZXJpYWxpemVkUmVjb3JkKVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJ1cGRhdGVcIiAmJiBsaXN0ZW5lcikge1xuICAgICAgY29uc3QgaW5zdGFuY2VBbnkgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobGlzdGVuZXIuaW5zdGFuY2UpXG5cbiAgICAgIGluc3RhbmNlQW55Ll9hdHRhY2htZW50T3duZXIgPSBmcmVzaE1vZGVsLl9hdHRhY2htZW50T3duZXJcblxuICAgICAgY29uc3QgbWF0Y2hpbmdVcGRhdGVDYWxsYmFja3MgPSBBcnJheS5mcm9tKGxpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcykuZmlsdGVyKChlbnRyeSkgPT5cbiAgICAgICAgZnJvbnRlbmRNb2RlbEV2ZW50RW50cnlNYXRjaGVzKGVudHJ5LCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKVxuICAgICAgKVxuXG4gICAgICBpZiAobWF0Y2hpbmdVcGRhdGVDYWxsYmFja3MubGVuZ3RoID4gMCkge1xuICAgICAgICAvLyBBdXRvLW1lcmdlIGludG8gdGhlIHJlZ2lzdGVyZWQgaW5zdGFuY2Ugc28gY2FsbGVycyByZWFkaW5nXG4gICAgICAgIC8vIHRocm91Z2ggdGhlIHNhbWUgaGFuZGxlIHNlZSBmcmVzaCBhdHRyaWJ1dGVzLlxuICAgICAgICBpbnN0YW5jZUFueS5hc3NpZ25BdHRyaWJ1dGVzKGZyZXNoTW9kZWwuYXR0cmlidXRlcygpKVxuICAgICAgICBpbnN0YW5jZUFueS5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMobGlzdGVuZXIuaW5zdGFuY2UuYXR0cmlidXRlcygpKVxuXG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbWF0Y2hpbmdVcGRhdGVDYWxsYmFja3MpIHtcbiAgICAgICAgICB0cnkgeyBlbnRyeS5jYWxsYmFjayh7aWQ6IGlkZW50aXR5LCBtb2RlbDogbGlzdGVuZXIuaW5zdGFuY2V9KSB9IGNhdGNoIChlcnJvcikgeyBjb25zb2xlLmVycm9yKGVycm9yKSB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjbGFzc0NhbGxiYWNrcyA9IGFjdGlvbiA9PT0gXCJjcmVhdGVcIiA/IHRoaXMuY2xhc3NDcmVhdGVDYWxsYmFja3MgOiB0aGlzLmNsYXNzVXBkYXRlQ2FsbGJhY2tzXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNsYXNzQ2FsbGJhY2tzKSB7XG4gICAgICBpZiAoIWZyb250ZW5kTW9kZWxFdmVudEVudHJ5TWF0Y2hlcyhlbnRyeSwgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cykpIGNvbnRpbnVlXG5cbiAgICAgIHRyeSB7IGVudHJ5LmNhbGxiYWNrKHtpZDogaWRlbnRpdHksIG1vZGVsOiBmcmVzaE1vZGVsfSkgfSBjYXRjaCAoZXJyb3IpIHsgY29uc29sZS5lcnJvcihlcnJvcikgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1heWJlIHRlYXJkb3duLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gKi9cbiAgbWF5YmVUZWFyZG93bigpIHtcbiAgICBjb25zdCBoYXNBbnlMaXN0ZW5lciA9IHRoaXMuY2xhc3NDcmVhdGVDYWxsYmFja3Muc2l6ZSA+IDBcbiAgICAgIHx8IHRoaXMuY2xhc3NVcGRhdGVDYWxsYmFja3Muc2l6ZSA+IDBcbiAgICAgIHx8IHRoaXMuY2xhc3NEZXN0cm95Q2FsbGJhY2tzLnNpemUgPiAwXG4gICAgICB8fCB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLnNpemUgPiAwXG5cbiAgICBpZiAoaGFzQW55TGlzdGVuZXIpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuY2hhbm5lbEhhbmRsZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5jaGFubmVsSGFuZGxlLmNsb3NlKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5jaGFubmVsSGFuZGxlID0gbnVsbFxuICAgIHRoaXMucmVhZHlQcm9taXNlID0gbnVsbFxuICAgIHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zS2V5ID0gbnVsbFxuICAgIHJlbGVhc2VGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24odGhpcylcbiAgfVxufVxuXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIGV2ZW50IHN1YnNjcmlwdGlvbnMuXG4gKiBAdHlwZSB7V2Vha01hcDxGcm9udGVuZE1vZGVsQ2xhc3MsIE1hcDxzdHJpbmcsIEZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbj4+fSAqL1xuY29uc3QgZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucyA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBSdW5zIGVuc3VyZSBmcm9udGVuZCBtb2RlbCBldmVudCBzdWJzY3JpcHRpb24uXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0fSByZXF1ZXN0Q29udGV4dCAtIENhcHR1cmVkIHN1YnNjcmlwdGlvbiBjb250ZXh0LlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gLSBQZXItY2xhc3Mgc3Vic2NyaXB0aW9uIGhlbHBlci5cbiAqL1xuZnVuY3Rpb24gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIHJlcXVlc3RDb250ZXh0KSB7XG4gIGxldCBzdWJzY3JpcHRpb25zID0gZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5nZXQoTW9kZWxDbGFzcylcblxuICBpZiAoIXN1YnNjcmlwdGlvbnMpIHtcbiAgICBzdWJzY3JpcHRpb25zID0gbmV3IE1hcCgpXG4gICAgZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5zZXQoTW9kZWxDbGFzcywgc3Vic2NyaXB0aW9ucylcbiAgfVxuXG4gIGNvbnN0IGNvbnRleHRLZXkgPSByZW1vdGVSZXF1ZXN0Q29udGV4dEtleShyZXF1ZXN0Q29udGV4dClcbiAgbGV0IHN1YiA9IHN1YnNjcmlwdGlvbnMuZ2V0KGNvbnRleHRLZXkpXG5cbiAgaWYgKCFzdWIpIHtcbiAgICBzdWIgPSBuZXcgRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIHJlcXVlc3RDb250ZXh0KVxuICAgIHN1YnNjcmlwdGlvbnMuc2V0KGNvbnRleHRLZXksIHN1YilcbiAgfVxuXG4gIHJldHVybiBzdWJcbn1cblxuLyoqXG4gKiBSZW1vdmVzIGFuIGVtcHR5IGNvbnRleHQgYnVja2V0IHNvIHN3aXRjaGluZyB0aHJvdWdoIG1hbnkgdGVuYW50cyBkb2VzIG5vdCByZXRhaW4gZXZlcnkgc25hcHNob3QuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gc3Vic2NyaXB0aW9uIC0gRW1wdHkgc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZWxlYXNlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKHN1YnNjcmlwdGlvbikge1xuICBjb25zdCBzdWJzY3JpcHRpb25zID0gZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5nZXQoc3Vic2NyaXB0aW9uLk1vZGVsQ2xhc3MpXG4gIGNvbnN0IGNvbnRleHRLZXkgPSByZW1vdGVSZXF1ZXN0Q29udGV4dEtleShzdWJzY3JpcHRpb24ucmVxdWVzdENvbnRleHQpXG5cbiAgaWYgKHN1YnNjcmlwdGlvbnM/LmdldChjb250ZXh0S2V5KSAhPT0gc3Vic2NyaXB0aW9uKSByZXR1cm5cblxuICBzdWJzY3JpcHRpb25zLmRlbGV0ZShjb250ZXh0S2V5KVxuICBpZiAoc3Vic2NyaXB0aW9ucy5zaXplID09PSAwKSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmRlbGV0ZShzdWJzY3JpcHRpb24uTW9kZWxDbGFzcylcbn1cblxuLyoqXG4gKiBDYXB0dXJlcyB0aGUgY3VycmVudCBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgY29udGV4dCBmb3Igb25lIG9wZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0fSBGcm96ZW4gY29udGV4dCBzbmFwc2hvdC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KCkge1xuICBjb25zdCBjb25maWd1cmVkQ29udGV4dCA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RDb250ZXh0ID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdENvbnRleHQoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0Q29udGV4dFxuXG4gIHJldHVybiBjYXB0dXJlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KGNvbmZpZ3VyZWRDb250ZXh0KVxufVxuXG4vKipcbiAqIENhcHR1cmVzIHRoZSBleHBsaWNpdCBsaWZlY3ljbGUgY29udGV4dCBvciBmYWxscyBiYWNrIHRvIHRoZSBjb25maWd1cmVkIHRyYW5zcG9ydCBjb250ZXh0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0IHwgdW5kZWZpbmVkfSByZXF1ZXN0Q29udGV4dCAtIFJlZ2lzdHJhdGlvbi1sb2NhbCBjb250ZXh0LlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHR9IEZyb3plbiBjb250ZXh0IHNuYXBzaG90LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsRXZlbnRSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCkge1xuICBpZiAocmVxdWVzdENvbnRleHQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCgpXG5cbiAgcmV0dXJuIGNhcHR1cmVGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpXG59XG5cbi8qKlxuICogUnVucyBlbnN1cmUgZnJvbnRlbmQgbW9kZWwgaW5zdGFuY2UgbGlzdGVuZXIuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gc3ViIC0gRXZlbnQgc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBpZCAtIE1vZGVsIGlkLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gaW5zdGFuY2UgLSBMaXN0ZW5lciBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHt7aW5zdGFuY2U6IEZyb250ZW5kTW9kZWxCYXNlLCB1cGRhdGVDYWxsYmFja3M6IFNldDxGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnk+LCBkZXN0cm95Q2FsbGJhY2tzOiBTZXQ8RnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnk+fX0gLSBJbnN0YW5jZSBsaXN0ZW5lciBidWNrZXQuXG4gKi9cbmZ1bmN0aW9uIGVuc3VyZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyKHN1YiwgaWQsIGluc3RhbmNlKSB7XG4gIGxldCBsaXN0ZW5lciA9IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQoaWQpXG5cbiAgaWYgKCFsaXN0ZW5lcikge1xuICAgIGxpc3RlbmVyID0ge2luc3RhbmNlLCB1cGRhdGVDYWxsYmFja3M6IG5ldyBTZXQoKSwgZGVzdHJveUNhbGxiYWNrczogbmV3IFNldCgpfVxuICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5zZXQoaWQsIGxpc3RlbmVyKVxuICB9IGVsc2Uge1xuICAgIGxpc3RlbmVyLmluc3RhbmNlID0gaW5zdGFuY2VcbiAgfVxuXG4gIHJldHVybiBsaXN0ZW5lclxufVxuXG4vKipcbiAqIFJlbW92ZXMgZXZlcnkgaWRlbnRpdHkga2V5IHBvaW50aW5nIGF0IGFuIGluc3RhbmNlIGxpc3RlbmVyLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb259IHN1YiAtIEV2ZW50IHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIGVuc3VyZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyPn0gbGlzdGVuZXIgLSBJbnN0YW5jZSBsaXN0ZW5lciBidWNrZXQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gZGVsZXRlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIoc3ViLCBsaXN0ZW5lcikge1xuICBmb3IgKGNvbnN0IFtpZCwgY3VycmVudF0gb2Ygc3ViLmluc3RhbmNlTGlzdGVuZXJzKSB7XG4gICAgaWYgKGN1cnJlbnQgPT09IGxpc3RlbmVyKSBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZGVsZXRlKGlkKVxuICB9XG59XG5cbi8qKlxuICogUmVtb3ZlcyBvbmUgaW5zdGFuY2UgY2FsbGJhY2sgZW50cnkgYW5kIHRlYXJzIGRvd24gYW4gZW1wdHkgbGlzdGVuZXIvc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufSBzdWIgLSBFdmVudCBzdWJzY3JpcHRpb24gYnVja2V0LlxuICogQHBhcmFtIHsobGlzdGVuZXI6IFJldHVyblR5cGU8dHlwZW9mIGVuc3VyZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyPikgPT4gYm9vbGVhbn0gcmVtb3ZlRW50cnkgLSBDYWxsYmFjayBlbnRyeSByZW1vdmFsLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCByZW1vdmVFbnRyeSkge1xuICBmb3IgKGNvbnN0IGN1cnJlbnQgb2Ygc3ViLmluc3RhbmNlTGlzdGVuZXJzLnZhbHVlcygpKSB7XG4gICAgaWYgKCFyZW1vdmVFbnRyeShjdXJyZW50KSkgY29udGludWVcblxuICAgIGlmIChjdXJyZW50LnVwZGF0ZUNhbGxiYWNrcy5zaXplID09PSAwICYmIGN1cnJlbnQuZGVzdHJveUNhbGxiYWNrcy5zaXplID09PSAwKSB7XG4gICAgICBkZWxldGVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGN1cnJlbnQpXG4gICAgfVxuICAgIGJyZWFrXG4gIH1cblxuICBzdWIubWF5YmVUZWFyZG93bigpXG59XG5cbi8qKlxuICogVGVtcG9yYXJpbHkgcmVnaXN0ZXJzIGFuIGluc3RhbmNlIGxpc3RlbmVyIHVuZGVyIGl0cyBwZW5kaW5nIGlkZW50aXR5IHdoaWxlIHJldGFpbmluZyBpdHMgcGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IGluc3RhbmNlIC0gSW5zdGFuY2UgYmVpbmcgcmUta2V5ZWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBwcmV2aW91c0lkZW50aXR5IC0gUGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gbmV4dElkZW50aXR5IC0gUGVuZGluZyBpZGVudGl0eSBzZW50IHRvIHRoZSBzZXJ2ZXIuXG4gKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gLSBDYWxsYmFjayB0aGF0IHJlbW92ZXMgdGhlIHRlbXBvcmFyeSBhbGlhc2VzLlxuICovXG5mdW5jdGlvbiBhbGlhc0Zyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyhNb2RlbENsYXNzLCBpbnN0YW5jZSwgcHJldmlvdXNJZGVudGl0eSwgbmV4dElkZW50aXR5KSB7XG4gIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICBjb25zdCBwcmV2aW91c0lkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcHJldmlvdXNJZGVudGl0eSlcbiAgY29uc3QgbmV4dElkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgbmV4dElkZW50aXR5KVxuICAvKiogQHR5cGUge0FycmF5PHtsaXN0ZW5lcjogUmV0dXJuVHlwZTx0eXBlb2YgZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXI+LCBzdWI6IEZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0+fSAqL1xuICBjb25zdCBhbGlhc2VzID0gW11cblxuICBpZiAocHJldmlvdXNJZCA9PT0gbmV4dElkKSByZXR1cm4gKCkgPT4ge31cblxuICBjb25zdCBzdWJzY3JpcHRpb25zID0gZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5nZXQoTW9kZWxDbGFzcylcblxuICBpZiAoIXN1YnNjcmlwdGlvbnMpIHJldHVybiAoKSA9PiB7fVxuXG4gIGZvciAoY29uc3Qgc3ViIG9mIHN1YnNjcmlwdGlvbnMudmFsdWVzKCkpIHtcbiAgICBjb25zdCBsaXN0ZW5lciA9IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQocHJldmlvdXNJZClcblxuICAgIGlmICghbGlzdGVuZXIgfHwgbGlzdGVuZXIuaW5zdGFuY2UgIT09IGluc3RhbmNlIHx8IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5oYXMobmV4dElkKSkgY29udGludWVcblxuICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5zZXQobmV4dElkLCBsaXN0ZW5lcilcbiAgICBhbGlhc2VzLnB1c2goe2xpc3RlbmVyLCBzdWJ9KVxuICB9XG5cbiAgcmV0dXJuICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IHtsaXN0ZW5lciwgc3VifSBvZiBhbGlhc2VzKSB7XG4gICAgICBpZiAoc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChwcmV2aW91c0lkKSA9PT0gbGlzdGVuZXIgJiYgc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChuZXh0SWQpID09PSBsaXN0ZW5lcikge1xuICAgICAgICBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZGVsZXRlKG5leHRJZClcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBBcHBsaWVzIGEgcmVtb3RlbHkgcGVyc2lzdGVkIGlkZW50aXR5IHRvIGEgbGlzdGVuZXIgaW5zdGFuY2Ugd2l0aG91dCBtZXJnaW5nIGFuIHVuYXZhaWxhYmxlIHJlY29yZCBwYXlsb2FkLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IGluc3RhbmNlIC0gTGlzdGVuZXIgaW5zdGFuY2UgcmVjZWl2aW5nIHRoZSBpZGVudGl0eS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkZW50aXR5IC0gUGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFwcGx5RnJvbnRlbmRNb2RlbFBlcnNpc3RlZElkZW50aXR5KE1vZGVsQ2xhc3MsIGluc3RhbmNlLCBpZGVudGl0eSkge1xuICBjb25zdCBpZGVudGl0eUF0dHJpYnV0ZXMgPSBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBpZGVudGl0eSlcblxuICBpbnN0YW5jZS5hc3NpZ25BdHRyaWJ1dGVzKGlkZW50aXR5QXR0cmlidXRlcylcblxuICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgT2JqZWN0LmtleXMoaWRlbnRpdHlBdHRyaWJ1dGVzKSkge1xuICAgIGluc3RhbmNlLm1hcmtBdHRyaWJ1dGVVbmNoYW5nZWQoYXR0cmlidXRlTmFtZSlcbiAgfVxufVxuXG4vKipcbiAqIE1vdmVzIGNhbGxiYWNrcyByZWdpc3RlcmVkIG9uIGFuIGluc3RhbmNlIHRvIGl0cyBuZXdseSBwZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gaW5zdGFuY2UgLSBSZS1rZXllZCBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IHByZXZpb3VzSWRlbnRpdHkgLSBQcmV2aW91cyBwZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBuZXh0SWRlbnRpdHkgLSBOZXcgcGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJla2V5RnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKE1vZGVsQ2xhc3MsIGluc3RhbmNlLCBwcmV2aW91c0lkZW50aXR5LCBuZXh0SWRlbnRpdHkpIHtcbiAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gIGNvbnN0IHByZXZpb3VzSWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkZW50aXR5KVxuICBjb25zdCBuZXh0SWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBuZXh0SWRlbnRpdHkpXG5cbiAgaWYgKHByZXZpb3VzSWQgPT09IG5leHRJZCkgcmV0dXJuXG5cbiAgY29uc3Qgc3Vic2NyaXB0aW9ucyA9IGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMuZ2V0KE1vZGVsQ2xhc3MpXG5cbiAgaWYgKCFzdWJzY3JpcHRpb25zKSByZXR1cm5cblxuICBmb3IgKGNvbnN0IHN1YiBvZiBzdWJzY3JpcHRpb25zLnZhbHVlcygpKSB7XG4gICAgY29uc3QgbGlzdGVuZXIgPSBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KHByZXZpb3VzSWQpXG5cbiAgICBpZiAoIWxpc3RlbmVyIHx8IGxpc3RlbmVyLmluc3RhbmNlICE9PSBpbnN0YW5jZSkgY29udGludWVcblxuICAgIGNvbnN0IG5leHRMaXN0ZW5lciA9IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQobmV4dElkKVxuXG4gICAgc3ViLmluc3RhbmNlTGlzdGVuZXJzLmRlbGV0ZShwcmV2aW91c0lkKVxuXG4gICAgaWYgKG5leHRMaXN0ZW5lcikge1xuICAgICAgbmV4dExpc3RlbmVyLmluc3RhbmNlID0gaW5zdGFuY2VcbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzKSBuZXh0TGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzLmFkZChlbnRyeSlcbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcykgbmV4dExpc3RlbmVyLmRlc3Ryb3lDYWxsYmFja3MuYWRkKGVudHJ5KVxuICAgIH0gZWxzZSB7XG4gICAgICBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuc2V0KG5leHRJZCwgbGlzdGVuZXIpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBjb21tYW5kIHVybC5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZXNvdXJjZVBhdGggLSBSZXNvdXJjZSBwYXRoIHByZWZpeC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBjb21tYW5kTmFtZSAtIENvbW1hbmQgcGF0aCBzZWdtZW50LlxuICogQHJldHVybnMge3N0cmluZ30gLSBGcm9udGVuZCBtb2RlbCBBUEkgVVJMLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQ29tbWFuZFVybChyZXNvdXJjZVBhdGgsIGNvbW1hbmROYW1lKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRVcmwgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VXJsKClcbiAgY29uc3Qgbm9ybWFsaXplZFJlc291cmNlUGF0aCA9IHJlc291cmNlUGF0aC5zdGFydHNXaXRoKFwiL1wiKSA/IHJlc291cmNlUGF0aCA6IGAvJHtyZXNvdXJjZVBhdGh9YFxuXG4gIHJldHVybiBgJHtjb25maWd1cmVkVXJsfSR7bm9ybWFsaXplZFJlc291cmNlUGF0aH0vJHtjb21tYW5kTmFtZX1gXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBhcGkgdXJsLlxuICogQHJldHVybnMge3N0cmluZ30gLSBTaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJIFVSTC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEFwaVVybCgpIHtcbiAgcmV0dXJuIGAke2Zyb250ZW5kTW9kZWxUcmFuc3BvcnRVcmwoKX0ke1NIQVJFRF9GUk9OVEVORF9NT0RFTF9BUElfUEFUSH1gXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgcGF0aC5cbiAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBSZXF1ZXN0IFVSTCBvciBwYXRoLlxuICogQHJldHVybnMge3N0cmluZ30gLSBXZWJzb2NrZXQtc2FmZSByZXF1ZXN0IHBhdGguXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRQYXRoKHVybCkge1xuICBpZiAodHlwZW9mIHVybCAhPT0gXCJzdHJpbmdcIiB8fCB1cmwubGVuZ3RoIDwgMSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IFVSTC9wYXRoLCBnb3Q6ICR7dXJsfWApXG4gIH1cblxuICBpZiAodXJsLnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgcmV0dXJuIHVybFxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWRVcmwgPSBuZXcgVVJMKHVybClcblxuICAgIHJldHVybiBgJHtwYXJzZWRVcmwucGF0aG5hbWV9JHtwYXJzZWRVcmwuc2VhcmNofWBcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHVybFxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGJyb3dzZXIgcnVudGltZSB0aW1lem9uZSB3aGVuIGF2YWlsYWJsZS5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQnJvd3NlciBydW50aW1lIHRpbWV6b25lIHdoZW4gYXZhaWxhYmxlLlxuICovXG5mdW5jdGlvbiBkZWZhdWx0RnJvbnRlbmRNb2RlbFRpbWVab25lKCkge1xuICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIHVuZGVmaW5lZFxuXG4gIGNvbnN0IGludGwgPSBnbG9iYWxUaGlzLkludGxcblxuICBpZiAoIWludGwpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBJbnRsIHRvIGJlIGF2YWlsYWJsZSBmb3IgYnJvd3NlciB0aW1lem9uZSBkZXRlY3Rpb25cIilcbiAgfVxuXG4gIGlmICh0eXBlb2YgaW50bC5EYXRlVGltZUZvcm1hdCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgSW50bC5EYXRlVGltZUZvcm1hdCB0byBiZSBhdmFpbGFibGUgYXMgYSBmdW5jdGlvblwiKVxuICB9XG5cbiAgY29uc3QgdGltZVpvbmUgPSBpbnRsLkRhdGVUaW1lRm9ybWF0KCkucmVzb2x2ZWRPcHRpb25zKCkudGltZVpvbmVcblxuICBpZiAodHlwZW9mIHRpbWVab25lICE9PSBcInN0cmluZ1wiIHx8IHRpbWVab25lLnRyaW0oKS5sZW5ndGggPCAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgSW50bC5EYXRlVGltZUZvcm1hdCB0byByZXNvbHZlIGEgYnJvd3NlciB0aW1lem9uZSBzdHJpbmdcIilcbiAgfVxuXG4gIHJldHVybiB2YWxpZGF0ZVRpbWVab25lKHRpbWVab25lLCBcImJyb3dzZXIgdGltZVpvbmVcIilcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgY29uZmlndXJlZCBmcm9udGVuZC1tb2RlbCByZXF1ZXN0IHRpbWV6b25lLlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIGZyb250ZW5kLW1vZGVsIHRpbWV6b25lLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKSB7XG4gIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcsIFwidGltZVpvbmVcIikpIHtcbiAgICByZXR1cm4gZGVmYXVsdEZyb250ZW5kTW9kZWxUaW1lWm9uZSgpXG4gIH1cblxuICBjb25zdCB0aW1lWm9uZSA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZVpvbmUoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lWm9uZVxuXG4gIGlmICh0aW1lWm9uZSA9PT0gdW5kZWZpbmVkIHx8IHRpbWVab25lID09PSBudWxsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHRpbWVab25lIGRpZCBub3QgcmVzb2x2ZSB0byBhIHRpbWV6b25lIHN0cmluZ1wiKVxuICB9XG5cbiAgcmV0dXJuIHZhbGlkYXRlVGltZVpvbmUodGltZVpvbmUsIFwiZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHRpbWVab25lXCIpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCByZXF1ZXN0IGhlYWRlcnMuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gW3RpbWVab25lXSAtIFByZS1yZXNvbHZlZCB0aW1lem9uZSBmb3IgdGhpcyByZXF1ZXN0LlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gSGVhZGVycyBmb3IgZnJvbnRlbmQtbW9kZWwgSFRUUCByZXF1ZXN0cy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlcXVlc3RIZWFkZXJzKHRpbWVab25lID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKCkpIHtcbiAgY29uc3QgZHluYW1pY0hlYWRlcnMgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0SGVhZGVycyA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0SGVhZGVycygpIHx8IHt9KVxuICAgIDogKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdEhlYWRlcnMgfHwge30pXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgY29uc3QgaGVhZGVycyA9IHtcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiwgLi4uZHluYW1pY0hlYWRlcnN9XG5cbiAgaWYgKHRpbWVab25lKSB7XG4gICAgaGVhZGVyc1tSRVFVRVNUX1RJTUVfWk9ORV9IRUFERVJdID0gdGltZVpvbmVcbiAgfVxuXG4gIHJldHVybiBoZWFkZXJzXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGNvbmZpZ3VyZWQgYm91bmRlZCB0cmFuc3BvcnQgZGVhZGxpbmUgaW4gbWlsbGlzZWNvbmRzLlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIGRlYWRsaW5lLCBvciB1bmRlZmluZWQgd2hlbiBubyBkZWFkbGluZSBpcyBzZXQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lb3V0TXMoKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRUaW1lb3V0ID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZW91dCA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVvdXQoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lb3V0XG5cbiAgaWYgKHR5cGVvZiBjb25maWd1cmVkVGltZW91dCAhPT0gXCJudW1iZXJcIiB8fCAhKGNvbmZpZ3VyZWRUaW1lb3V0ID4gMCkpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICByZXR1cm4gY29uZmlndXJlZFRpbWVvdXRcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgY29uZmlndXJlZCBjYWxsZXIvc2Vzc2lvbiBBYm9ydFNpZ25hbCBjb21wb3NlZCB3aXRoIHRoZSBkZWFkbGluZS5cbiAqIEByZXR1cm5zIHtBYm9ydFNpZ25hbCB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIGNhbGxlciBzaWduYWwsIG9yIHVuZGVmaW5lZCB3aGVuIG5vbmUgaXMgc2V0LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCkge1xuICBjb25zdCBjb25maWd1cmVkU2lnbmFsID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsKClcbiAgICA6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsXG5cbiAgcmV0dXJuIGNvbmZpZ3VyZWRTaWduYWwgfHwgdW5kZWZpbmVkXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgcGVyLXN0YXJ0dXAgY29udHJvbHMgd2l0aCB0aGUgY29uZmlndXJlZCBzZXNzaW9uIGNhbmNlbGxhdGlvbi5cbiAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWx9fSBjb250cm9scyAtIENhbGwgY29udHJvbHMuXG4gKiBAcmV0dXJucyB7e3RpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWx9fSAtIEVmZmVjdGl2ZSBzdGFydHVwIGNvbnRyb2xzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKGNvbnRyb2xzKSB7XG4gIGNvbnN0IHNlc3Npb25TaWduYWwgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKClcbiAgbGV0IHNpZ25hbCA9IGNvbnRyb2xzLnNpZ25hbCB8fCBzZXNzaW9uU2lnbmFsXG5cbiAgaWYgKGNvbnRyb2xzLnNpZ25hbCAmJiBzZXNzaW9uU2lnbmFsICYmIGNvbnRyb2xzLnNpZ25hbCAhPT0gc2Vzc2lvblNpZ25hbCkge1xuICAgIHNpZ25hbCA9IEFib3J0U2lnbmFsLmFueShbY29udHJvbHMuc2lnbmFsLCBzZXNzaW9uU2lnbmFsXSlcbiAgfVxuXG4gIGNvbnN0IGNvbmZpZ3VyZWRUaW1lb3V0TXMgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKClcbiAgY29uc3QgdGltZW91dE1zID0gY29udHJvbHMudGltZW91dE1zID09PSB1bmRlZmluZWRcbiAgICA/IGNvbmZpZ3VyZWRUaW1lb3V0TXNcbiAgICA6IGNvbmZpZ3VyZWRUaW1lb3V0TXMgPT09IHVuZGVmaW5lZFxuICAgICAgPyBjb250cm9scy50aW1lb3V0TXNcbiAgICAgIDogTWF0aC5taW4oY29udHJvbHMudGltZW91dE1zLCBjb25maWd1cmVkVGltZW91dE1zKVxuXG4gIHJldHVybiB7c2lnbmFsLCB0aW1lb3V0TXN9XG59XG5cbi8qKlxuICogUnVucyBwZXJmb3JtIHNoYXJlZCBmcm9udGVuZCBtb2RlbCBhcGkgcmVxdWVzdC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByZXF1ZXN0UGF5bG9hZCAtIFNoYXJlZCByZXF1ZXN0IHBheWxvYWQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIERlY29kZWQgc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSByZXNwb25zZS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcGVyZm9ybVNoYXJlZEZyb250ZW5kTW9kZWxBcGlSZXF1ZXN0KHJlcXVlc3RQYXlsb2FkKSB7XG4gIGNvbnN0IHRpbWVab25lID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKClcbiAgY29uc3Qgc2VyaWFsaXplZFJlcXVlc3RQYXlsb2FkID0gc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHJlcXVlc3RQYXlsb2FkLCB7dGltZVpvbmV9KVxuICBjb25zdCB3ZWJzb2NrZXRDbGllbnQgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudFxuICBjb25zdCB1cmwgPSBmcm9udGVuZE1vZGVsQXBpVXJsKClcbiAgY29uc3QgbWVyZ2VkSGVhZGVycyA9IGZyb250ZW5kTW9kZWxSZXF1ZXN0SGVhZGVycyh0aW1lWm9uZSlcblxuICByZXR1cm4gYXdhaXQgcnVuV2l0aFRyYW5zcG9ydERlYWRsaW5lKFxuICAgIHtcbiAgICAgIGVycm9yTWVzc2FnZTogXCJTaGFyZWQgZnJvbnRlbmQgbW9kZWwgQVBJIHJlcXVlc3QgdGltZWQgb3V0XCIsXG4gICAgICBzaWduYWw6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSxcbiAgICAgIHRpbWVvdXRNczogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVvdXRNcygpXG4gICAgfSxcbiAgICBhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICBpZiAod2Vic29ja2V0Q2xpZW50KSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgd2Vic29ja2V0Q2xpZW50LnBvc3QoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFBhdGgodXJsKSwgc2VyaWFsaXplZFJlcXVlc3RQYXlsb2FkLCB7XG4gICAgICAgICAgaGVhZGVyczogbWVyZ2VkSGVhZGVycyxcbiAgICAgICAgICBzaWduYWxcbiAgICAgICAgfSlcbiAgICAgICAgY29uc3QgcmVzcG9uc2VKc29uID0gcmVzcG9uc2UuanNvbigpXG5cbiAgICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocmVzcG9uc2VKc29uKSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoc2VyaWFsaXplZFJlcXVlc3RQYXlsb2FkKSxcbiAgICAgICAgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiLFxuICAgICAgICBoZWFkZXJzOiBtZXJnZWRIZWFkZXJzLFxuICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICBzaWduYWxcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlVGV4dCA9IGF3YWl0IHJlc3BvbnNlLnRleHQoKVxuXG4gICAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICAgIHRocm93RnJvbnRlbmRNb2RlbEh0dHBFcnJvcih7XG4gICAgICAgICAgY29tbWFuZExhYmVsOiBcInNoYXJlZCBmcm9udGVuZCBtb2RlbCBBUElcIixcbiAgICAgICAgICByZXNwb25zZSxcbiAgICAgICAgICByZXNwb25zZVRleHRcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgY29uc3QganNvbiA9IHJlc3BvbnNlVGV4dC5sZW5ndGggPiAwID8gSlNPTi5wYXJzZShyZXNwb25zZVRleHQpIDoge31cblxuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoanNvbikpXG4gICAgfVxuICApXG59XG5cbi8qKlxuICogVGhyb3dzIGEgZnJvbnRlbmQtbW9kZWwgSFRUUCBlcnJvciB3aXRoIGJhY2tlbmQtcHJvdmlkZWQgZW52ZWxvcGUgZGV0YWlscyB3aGVuIGF2YWlsYWJsZS5cbiAqIEBwYXJhbSB7e2NvbW1hbmRMYWJlbDogc3RyaW5nLCByZXNwb25zZTogUmVzcG9uc2UsIHJlc3BvbnNlVGV4dDogc3RyaW5nfX0gYXJncyAtIEVycm9yIHJlc3BvbnNlIGRldGFpbHMuXG4gKiBAcmV0dXJucyB7bmV2ZXJ9IC0gQWx3YXlzIHRocm93cyBhbiB1bmtub3duLWF0dHJpYnV0ZSBlcnJvci5cbiAqL1xuZnVuY3Rpb24gdGhyb3dGcm9udGVuZE1vZGVsSHR0cEVycm9yKHtjb21tYW5kTGFiZWwsIHJlc3BvbnNlLCByZXNwb25zZVRleHR9KSB7XG4gIC8vIFN1cmZhY2UgdGhlIGJhY2tlbmQncyBmcmllbmRseSBlcnJvck1lc3NhZ2UgZW52ZWxvcGUgKHRoZVxuICAvLyBge3N0YXR1czogXCJlcnJvclwiLCBlcnJvck1lc3NhZ2U6IFwiLi4uXCJ9YCBzaGFwZSBldmVyeSBjb250cm9sbGVyXG4gIC8vIHNoaXBzIG9uIGl0cyA0eHgvNXh4IHJlc3BvbnNlcykgaW5zdGVhZCBvZiB0aGUgZ2VuZXJpYyBzdGF0dXNcbiAgLy8gc3RyaW5nLiBGYWxsIHRocm91Z2ggdG8gdGhlIHN0YXR1cy1vbmx5IG1lc3NhZ2Ugd2hlbiB0aGUgYm9keSBpc1xuICAvLyBtaXNzaW5nLCBub24tSlNPTiwgb3IgaGFzIG5vIHVzYWJsZSBlcnJvck1lc3NhZ2UgZmllbGQuXG4gIGNvbnN0IHJlc3BvbnNlQ29udGVudFR5cGUgPSByZXNwb25zZS5oZWFkZXJzLmdldChcImNvbnRlbnQtdHlwZVwiKVxuXG4gIGlmIChyZXNwb25zZUNvbnRlbnRUeXBlICYmIHJlc3BvbnNlQ29udGVudFR5cGUuaW5jbHVkZXMoXCJhcHBsaWNhdGlvbi9qc29uXCIpICYmIHJlc3BvbnNlVGV4dC5sZW5ndGggPiAwKSB7XG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBlcnJvckJvZHkuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9ICovXG4gICAgbGV0IGVycm9yQm9keVxuXG4gICAgdHJ5IHtcbiAgICAgIGVycm9yQm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2VUZXh0KVxuICAgIH0gY2F0Y2gge1xuICAgICAgZXJyb3JCb2R5ID0gbnVsbFxuICAgIH1cblxuICAgIGlmIChlcnJvckJvZHkgJiYgdHlwZW9mIGVycm9yQm9keS5lcnJvck1lc3NhZ2UgPT09IFwic3RyaW5nXCIgJiYgZXJyb3JCb2R5LmVycm9yTWVzc2FnZS50cmltKCkubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yQm9keS5lcnJvck1lc3NhZ2UudHJpbSgpKVxuICAgIH1cbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihgUmVxdWVzdCBmYWlsZWQgKCR7cmVzcG9uc2Uuc3RhdHVzfSkgZm9yICR7Y29tbWFuZExhYmVsfWApXG59XG5cbi8qKlxuICogUnVucyBmbHVzaCBwZW5kaW5nIHNoYXJlZCBmcm9udGVuZCBtb2RlbCByZXF1ZXN0cy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHBlbmRpbmcgc2hhcmVkIGZyb250ZW5kLW1vZGVsIHJlcXVlc3RzIGZsdXNoLlxuICovXG5hc3luYyBmdW5jdGlvbiBmbHVzaFBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMoKSB7XG4gIHNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZCA9IGZhbHNlXG5cbiAgaWYgKHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMubGVuZ3RoIDwgMSkge1xuICAgIHJlc29sdmVGcm9udGVuZE1vZGVsSWRsZVdhaXRlcnMoKVxuICAgIHJldHVyblxuICB9XG5cbiAgY29uc3QgYmF0Y2hlZFJlcXVlc3RzID0gcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0c1xuICBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzID0gW11cblxuICBjb25zdCB1cmwgPSBmcm9udGVuZE1vZGVsQXBpVXJsKClcbiAgY29uc3QgcmVxdWVzdFBheWxvYWQgPSB7XG4gICAgcmVxdWVzdHM6IGJhdGNoZWRSZXF1ZXN0cy5tYXAoKHJlcXVlc3QpID0+IHtcbiAgICAgIGlmIChyZXF1ZXN0LmN1c3RvbVBhdGgpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kVHlwZTogcmVxdWVzdC5jb21tYW5kVHlwZSxcbiAgICAgICAgICBjdXN0b21QYXRoOiByZXF1ZXN0LmN1c3RvbVBhdGgsXG4gICAgICAgICAgbW9kZWw6IHJlcXVlc3QubW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgICBwYXlsb2FkOiByZXF1ZXN0LnBheWxvYWQsXG4gICAgICAgICAgLi4uKE9iamVjdC5rZXlzKHJlcXVlc3QucmVxdWVzdENvbnRleHQpLmxlbmd0aCA+IDAgPyB7cmVxdWVzdENvbnRleHQ6IHJlcXVlc3QucmVxdWVzdENvbnRleHR9IDoge30pLFxuICAgICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdC5yZXF1ZXN0SWRcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb21tYW5kVHlwZTogcmVxdWVzdC5jb21tYW5kVHlwZSxcbiAgICAgICAgbW9kZWw6IHJlcXVlc3QubW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgcGF5bG9hZDogcmVxdWVzdC5wYXlsb2FkLFxuICAgICAgICAuLi4oT2JqZWN0LmtleXMocmVxdWVzdC5yZXF1ZXN0Q29udGV4dCkubGVuZ3RoID4gMCA/IHtyZXF1ZXN0Q29udGV4dDogcmVxdWVzdC5yZXF1ZXN0Q29udGV4dH0gOiB7fSksXG4gICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdC5yZXF1ZXN0SWRcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgYXdhaXQgdHJhY2tGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdChhc3luYyAoKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIHZvaWQgdXJsXG4gICAgICBjb25zdCBkZWNvZGVkUmVzcG9uc2UgPSBhd2FpdCBwZXJmb3JtU2hhcmVkRnJvbnRlbmRNb2RlbEFwaVJlcXVlc3QocmVxdWVzdFBheWxvYWQpXG4gICAgICBjb25zdCByZXNwb25zZXMgPSBBcnJheS5pc0FycmF5KGRlY29kZWRSZXNwb25zZS5yZXNwb25zZXMpID8gZGVjb2RlZFJlc3BvbnNlLnJlc3BvbnNlcyA6IFtdXG4gICAgICBjb25zdCByZXNwb25zZXNCeUlkID0gbmV3IE1hcChyZXNwb25zZXMubWFwKChlbnRyeSkgPT4gW2VudHJ5LnJlcXVlc3RJZCwgZW50cnkucmVzcG9uc2VdKSlcblxuICAgICAgZm9yIChjb25zdCByZXF1ZXN0IG9mIGJhdGNoZWRSZXF1ZXN0cykge1xuICAgICAgICBjb25zdCByZXNwb25zZVBheWxvYWQgPSByZXNwb25zZXNCeUlkLmdldChyZXF1ZXN0LnJlcXVlc3RJZClcblxuICAgICAgICBpZiAoIXJlc3BvbnNlUGF5bG9hZCB8fCB0eXBlb2YgcmVzcG9uc2VQYXlsb2FkICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICAgICAgcmVxdWVzdC5yZWplY3QobmV3IEVycm9yKGBNaXNzaW5nIGJhdGNoZWQgcmVzcG9uc2UgZm9yICR7cmVxdWVzdC5tb2RlbENsYXNzLm5hbWV9IyR7cmVxdWVzdC5jb21tYW5kVHlwZX1gKSlcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgcmVxdWVzdC5yZXNvbHZlKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocmVzcG9uc2VQYXlsb2FkKSlcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZm9yIChjb25zdCByZXF1ZXN0IG9mIGJhdGNoZWRSZXF1ZXN0cykge1xuICAgICAgICByZXF1ZXN0LnJlamVjdChlcnJvcilcbiAgICAgIH1cbiAgICB9XG4gIH0pXG59XG5cbi8qKlxuICogUnVucyBzY2hlZHVsZSBzaGFyZWQgZnJvbnRlbmQgbW9kZWwgcmVxdWVzdCBmbHVzaC5cbiAqIEByZXR1cm5zIHt2b2lkfSAqL1xuZnVuY3Rpb24gc2NoZWR1bGVTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdEZsdXNoKCkge1xuICBpZiAoc2hhcmVkRnJvbnRlbmRNb2RlbEZsdXNoU2NoZWR1bGVkKSByZXR1cm5cblxuICBzaGFyZWRGcm9udGVuZE1vZGVsRmx1c2hTY2hlZHVsZWQgPSB0cnVlXG4gIHF1ZXVlTWljcm90YXNrKCgpID0+IHtcbiAgICB2b2lkIGZsdXNoUGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cygpXG4gIH0pXG59XG5cbi8qKlxuICogQ3VzdG9tIGNvbW1hbmRzIHN0aWxsIHVzZSB0aGUgc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSS4gVGhpcyBoZWxwZXIgb25seSBidWlsZHMgdGhlIGJhY2tlbmQgcm91dGUgcGF0aCB0aGUgc2VydmVyIHNob3VsZCBkaXNwYXRjaCBhZnRlciB2YWxpZGF0aW5nIHRoZSBzZWdtZW50cy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29tbWFuZE5hbWUgLSBDb21tYW5kIHBhdGggc2VnbWVudC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1vZGVsTmFtZSAtIEZyb250ZW5kIG1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IFthcmdzLm1lbWJlcklkXSAtIE9wdGlvbmFsIG1lbWJlciBpZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlUGF0aCAtIFJlc291cmNlIHBhdGggcHJlZml4LlxuICogQHJldHVybnMge3N0cmluZ30gLSBDdXN0b20gYmFja2VuZCByb3V0ZSBwYXRoLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZFBhdGgoe2NvbW1hbmROYW1lLCBtZW1iZXJJZCwgbW9kZWxOYW1lLCByZXNvdXJjZVBhdGh9KSB7XG4gIGNvbnN0IHZhbGlkYXRlZFJlc291cmNlUGF0aCA9IHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aCh7bW9kZWxOYW1lLCByZXNvdXJjZVBhdGh9KVxuICBjb25zdCB2YWxpZGF0ZWRDb21tYW5kTmFtZSA9IHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWUoe2NvbW1hbmROYW1lLCBjb21tYW5kVHlwZTogY29tbWFuZE5hbWUsIG1vZGVsTmFtZX0pXG5cbiAgaWYgKG1lbWJlcklkID09PSB1bmRlZmluZWQgfHwgbWVtYmVySWQgPT09IG51bGwgfHwgbWVtYmVySWQgPT09IFwiXCIpIHtcbiAgICByZXR1cm4gYCR7dmFsaWRhdGVkUmVzb3VyY2VQYXRofS8ke3ZhbGlkYXRlZENvbW1hbmROYW1lfWBcbiAgfVxuXG4gIHJldHVybiBgJHt2YWxpZGF0ZWRSZXNvdXJjZVBhdGh9LyR7ZW5jb2RlVVJJQ29tcG9uZW50KFN0cmluZyhtZW1iZXJJZCkpfS8ke3ZhbGlkYXRlZENvbW1hbmROYW1lfWBcbn1cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBmaW5kIGJ5IGNvbmRpdGlvbnMgc2hhcGUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjb25kaXRpb25zIC0gZmluZEJ5IGNvbmRpdGlvbnMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0RmluZEJ5Q29uZGl0aW9uc1NoYXBlKGNvbmRpdGlvbnMpIHtcbiAgaWYgKCFjb25kaXRpb25zIHx8IHR5cGVvZiBjb25kaXRpb25zICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoY29uZGl0aW9ucykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBleHBlY3RzIGNvbmRpdGlvbnMgdG8gYmUgYSBwbGFpbiBvYmplY3QsIGdvdDogJHtjb25kaXRpb25zfWApXG4gIH1cblxuICBjb25zdCBjb25kaXRpb25zUHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGNvbmRpdGlvbnMpXG5cbiAgaWYgKGNvbmRpdGlvbnNQcm90b3R5cGUgIT09IE9iamVjdC5wcm90b3R5cGUgJiYgY29uZGl0aW9uc1Byb3RvdHlwZSAhPT0gbnVsbCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGV4cGVjdHMgY29uZGl0aW9ucyB0byBiZSBhIHBsYWluIG9iamVjdCwgZ290OiAke2NvbmRpdGlvbnN9YClcbiAgfVxuXG4gIGNvbnN0IHN5bWJvbEtleXMgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlTeW1ib2xzKGNvbmRpdGlvbnMpXG5cbiAgaWYgKHN5bWJvbEtleXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgc3ltYm9sIGNvbmRpdGlvbiBrZXlzIChrZXlzOiAke3N5bWJvbEtleXMubWFwKChrZXkpID0+IGtleS50b1N0cmluZygpKS5qb2luKFwiLCBcIil9KWApXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBkZWZpbmVkIGZpbmQgYnkgY29uZGl0aW9uIHZhbHVlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDb25kaXRpb24gdmFsdWUgdG8gdmFsaWRhdGUuXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5UGF0aCAtIEtleSBwYXRoIGZvciBlcnJvciBvdXRwdXQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0RGVmaW5lZEZpbmRCeUNvbmRpdGlvblZhbHVlKHZhbHVlLCBrZXlQYXRoKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCB1bmRlZmluZWQgY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IGZ1bmN0aW9uIGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzeW1ib2xcIikge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgc3ltYm9sIGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJiaWdpbnRcIikge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgYmlnaW50IGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiAhTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgbm9uLWZpbml0ZSBudW1iZXIgY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICB2YWx1ZS5mb3JFYWNoKChlbnRyeSwgaW5kZXgpID0+IHtcbiAgICAgIGFzc2VydERlZmluZWRGaW5kQnlDb25kaXRpb25WYWx1ZShlbnRyeSwgYCR7a2V5UGF0aH1bJHtpbmRleH1dYClcbiAgICB9KVxuICAgIHJldHVyblxuICB9XG5cbiAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIikge1xuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IG9iamVjdFZhbHVlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh2YWx1ZSlcbiAgICBjb25zdCBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2Yob2JqZWN0VmFsdWUpXG5cbiAgICBpZiAocHJvdG90eXBlICE9PSBPYmplY3QucHJvdG90eXBlICYmIHByb3RvdHlwZSAhPT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBub24tcGxhaW4gb2JqZWN0IGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICAgIH1cblxuICAgIGNvbnN0IHN5bWJvbEtleXMgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlTeW1ib2xzKG9iamVjdFZhbHVlKVxuXG4gICAgaWYgKHN5bWJvbEtleXMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBzeW1ib2wgY29uZGl0aW9uIGtleXMgKGtleTogJHtrZXlQYXRofSlgKVxuICAgIH1cblxuICAgIGNvbnN0IHZhbHVlT2JqZWN0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh2YWx1ZSlcblxuICAgIE9iamVjdC5rZXlzKHZhbHVlT2JqZWN0KS5mb3JFYWNoKChuZXN0ZWRLZXkpID0+IHtcbiAgICAgIGFzc2VydERlZmluZWRGaW5kQnlDb25kaXRpb25WYWx1ZSh2YWx1ZU9iamVjdFtuZXN0ZWRLZXldLCBgJHtrZXlQYXRofS4ke25lc3RlZEtleX1gKVxuICAgIH0pXG4gIH1cbn1cblxuLyoqXG4gKiBCYXNlIGZyb250ZW5kIG1vZGVsLlxuICpcbiAqIERlZmF1bHRzIGFyZSBgYW55YCBzbyB0aGUgYmFyZSBgRnJvbnRlbmRNb2RlbEJhc2VgIOKAlCB1c2VkIHRocm91Z2hvdXQgYXMgYVxuICogY29uc3RyYWludC9wYXJhbWV0ZXIgdHlwZSBmb3IgXCJhbnkgZnJvbnRlbmQgbW9kZWxcIiDigJQgYWNjZXB0cyBnZW5lcmF0ZWRcbiAqIHN1YmNsYXNzZXMgZGVjbGFyaW5nIHR5cGVkLWF0dHJpYnV0ZSBnZW5lcmljcyAoYEZyb250ZW5kTW9kZWxCYXNlPFhBdHRyaWJ1dGVzLFxuICogLi4uPmApLiBBIGNvbmNyZXRlIGBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+YCBkZWZhdWx0IG1ha2VzXG4gKiB0aG9zZSBzdWJjbGFzc2VzIGZhaWwgYnkgaW52YXJpYW5jZS4gU3ViY2xhc3NlcyBzdGlsbCBwYXNzIHRoZWlyIHByZWNpc2VcbiAqIGF0dHJpYnV0ZSB0eXBlZGVmcywgc28gdHlwZWQgYWNjZXNzb3JzIGtlZXAgdGhlaXIgcHJlY2lzaW9uLlxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtBdHRyaWJ1dGVzPWFueV1cbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbQ3JlYXRlQXR0cmlidXRlcz1hbnldXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW1VwZGF0ZUF0dHJpYnV0ZXM9YW55XVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBGcm9udGVuZE1vZGVsQmFzZSB7XG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBtb2RlbE5hbWVcblxuICAvKipcbiAgICogQXV0b2xvYWQuXG4gICAqIEB0eXBlIHtib29sZWFufSAtIEdsb2JhbCBhdXRvLWJhdGNoLXByZWxvYWQgdG9nZ2xlLiBBcHBzIGNhbiBvcHQgb3V0IHZpYSBGcm9udGVuZE1vZGVsQmFzZS5zZXRBdXRvbG9hZChmYWxzZSkuXG4gICAqL1xuICBzdGF0aWMgX2F1dG9sb2FkID0gdHJ1ZVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdXRvbG9hZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgYXV0by1iYXRjaC1wcmVsb2FkIG9mIHJlbGF0aW9uc2hpcHMgb24gbGF6eSBhY2Nlc3MgaXMgZW5hYmxlZCBnbG9iYWxseS5cbiAgICovXG4gIHN0YXRpYyBnZXRBdXRvbG9hZCgpIHsgcmV0dXJuIEZyb250ZW5kTW9kZWxCYXNlLl9hdXRvbG9hZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGF1dG9sb2FkLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld1ZhbHVlIC0gV2hldGhlciBhdXRvLWJhdGNoLXByZWxvYWQgb2YgcmVsYXRpb25zaGlwcyBpcyBlbmFibGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBzZXRBdXRvbG9hZChuZXdWYWx1ZSkgeyBGcm9udGVuZE1vZGVsQmFzZS5fYXV0b2xvYWQgPSBuZXdWYWx1ZSB9XG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovXG4gIF9hdHRyaWJ1dGVzXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcDxGcm9udGVuZE1vZGVsQmFzZSwgRnJvbnRlbmRNb2RlbEJhc2UsIFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4+IHwgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwPEZyb250ZW5kTW9kZWxCYXNlLCBGcm9udGVuZE1vZGVsQmFzZSwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPj4+fSAqL1xuICBfcmVsYXRpb25zaGlwc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGU+fSAqL1xuICBfYXR0YWNobWVudHNcbiAgLyoqXG4gICAqIFJhaWxzLXN0eWxlIG5lc3RlZCBhdHRyaWJ1dGUgcGF5bG9hZHMgcXVldWVkIGZvciB0aGUgbmV4dCBzYXZlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fVxuICAgKi9cbiAgX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtTZXQ8c3RyaW5nPiB8IG51bGx9ICovXG4gIF9zZWxlY3RlZEF0dHJpYnV0ZXNcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gIF9pc05ld1JlY29yZFxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgX21hcmtlZEZvckRlc3RydWN0aW9uXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqL1xuICBfcGVyc2lzdGVkQXR0cmlidXRlc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+IHwgdW5kZWZpbmVkfSAtIFNoYXJlZCByZWZlcmVuY2UgdG8gc2libGluZyByZWNvcmRzIGxvYWRlZCBpbiB0aGUgc2FtZSBiYXRjaC4gVXNlZCBieSBhdXRvLWJhdGNoLXByZWxvYWQuXG4gICAqL1xuICBfbG9hZENvaG9ydFxuICAvKipcbiAgICogQ2Fub25pY2FsIGJhY2tpbmctcmVjb3JkIGF0dGFjaG1lbnQgb3duZXIgcmV0dXJuZWQgYnkgdGhlIHNlcnZlci5cbiAgICogQHR5cGUge3tyZWNvcmRJZDogc3RyaW5nLCByZWNvcmRUeXBlOiBzdHJpbmcsIHJlc291cmNlTmFtZTogc3RyaW5nfSB8IG51bGx9XG4gICAqL1xuICBfYXR0YWNobWVudE93bmVyXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7QXR0cmlidXRlcyB8IENyZWF0ZUF0dHJpYnV0ZXN9IFthdHRyaWJ1dGVzXSAtIEluaXRpYWwgYXR0cmlidXRlcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGF0dHJpYnV0ZXMpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG5cbiAgICBNb2RlbENsYXNzLmVuc3VyZUdlbmVyYXRlZEF0dGFjaG1lbnRNZXRob2RzKClcbiAgICB0aGlzLl9hdHRyaWJ1dGVzID0ge31cbiAgICB0aGlzLl9yZWxhdGlvbnNoaXBzID0ge31cbiAgICB0aGlzLl9hdHRhY2htZW50cyA9IHt9XG4gICAgdGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIHRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcyA9IG51bGxcbiAgICB0aGlzLl9pc05ld1JlY29yZCA9IHRydWVcbiAgICB0aGlzLl9tYXJrZWRGb3JEZXN0cnVjdGlvbiA9IGZhbHNlXG4gICAgdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgdGhpcy5fYXR0YWNobWVudE93bmVyID0gbnVsbFxuICAgIGlmIChhdHRyaWJ1dGVzKSB0aGlzLmFzc2lnbkF0dHJpYnV0ZXMoYXR0cmlidXRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBnZW5lcmF0ZWQgYXR0YWNobWVudCBtZXRob2RzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBFbnN1cmVzIGF0dGFjaG1lbnQgaGVscGVyIG1ldGhvZHMgZXhpc3Qgb24gdGhlIHByb3RvdHlwZS5cbiAgICovXG4gIHN0YXRpYyBlbnN1cmVHZW5lcmF0ZWRBdHRhY2htZW50TWV0aG9kcygpIHtcbiAgICBpZiAodGhpcy5fZ2VuZXJhdGVkQXR0YWNobWVudE1ldGhvZHMpIHJldHVyblxuXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB0aGlzLmF0dGFjaG1lbnREZWZpbml0aW9ucygpXG4gICAgY29uc3QgcHJvdG90eXBlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0aGlzLnByb3RvdHlwZSlcblxuICAgIGZvciAoY29uc3QgYXR0YWNobWVudE5hbWUgb2YgT2JqZWN0LmtleXMoYXR0YWNobWVudHMpKSB7XG4gICAgICBpZiAoIShhdHRhY2htZW50TmFtZSBpbiBwcm90b3R5cGUpKSB7XG4gICAgICAgIHByb3RvdHlwZVthdHRhY2htZW50TmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fZ2VuZXJhdGVkQXR0YWNobWVudE1ldGhvZHMgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd9IC0gUmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJyZXNvdXJjZUNvbmZpZygpIG11c3QgYmUgaW1wbGVtZW50ZWQgYnkgc3ViY2xhc3Nlc1wiKVxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby11bnJlYWNoYWJsZVxuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIG1vZGVsIGNsYXNzZXMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQ2xhc3MgfCBzdHJpbmc+fSAtIFJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzc2VzIChvciBjbGFzcyBuYW1lIHN0cmluZ3MpIGtleWVkIGJ5IHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIHJlbGF0aW9uc2hpcE1vZGVsQ2xhc3NlcygpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlciBhIGZyb250ZW5kIG1vZGVsIGNsYXNzIHNvIGl0IGNhbiBiZSByZXNvbHZlZCBieSBuYW1lIGluIHJlbGF0aW9uc2hpcCBsb29rdXBzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIHJlZ2lzdGVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyByZWdpc3Rlck1vZGVsKG1vZGVsQ2xhc3MpIHtcbiAgICByZWdpc3RlckZyb250ZW5kTW9kZWwobW9kZWxDbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlZmluZSBzY29wZS5cbiAgICogQHBhcmFtIHsoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gY2FsbGJhY2sgLSBTY29wZSBjYWxsYmFjay5cbiAgICogQHJldHVybnMgeygoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8RnJvbnRlbmRNb2RlbENsYXNzPikgJiB7c2NvcGU6ICguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCIpLk1vZGVsU2NvcGVEZXNjcmlwdG9yfX0gLSBTY29wZSBoZWxwZXIuXG4gICAqL1xuICBzdGF0aWMgZGVmaW5lU2NvcGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gZGVmaW5lTW9kZWxTY29wZSh7XG4gICAgICBjYWxsYmFjayxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICBzdGFydFF1ZXJ5OiAoKSA9PiB0aGlzLnF1ZXJ5KClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmUgYSByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MgdmFsdWUgdGhhdCBtYXkgYmUgYSBjbGFzcyByZWZlcmVuY2Ugb3IgYSBzdHJpbmcgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIENsYXNzIG9yIGNsYXNzIG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBudWxsfSAtIFJlc29sdmVkIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIHJlc29sdmVNb2RlbENsYXNzKHZhbHVlKSB7XG4gICAgcmV0dXJuIHJlc29sdmVGcm9udGVuZE1vZGVsQ2xhc3ModmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbnMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB7dHlwZTogXCJiZWxvbmdzVG9cIiB8IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIiwgYXV0b2xvYWQ/OiBib29sZWFufT59IC0gUmVsYXRpb25zaGlwIGRlZmluaXRpb25zIGtleWVkIGJ5IHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIHJlbGF0aW9uc2hpcERlZmluaXRpb25zKCkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNobWVudCBkZWZpbml0aW9ucy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRhY2htZW50RGVmaW5pdGlvbj59IC0gQXR0YWNobWVudCBkZWZpbml0aW9ucyBrZXllZCBieSBhdHRhY2htZW50IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgYXR0YWNobWVudERlZmluaXRpb25zKCkge1xuICAgIHJldHVybiB0aGlzLnJlc291cmNlQ29uZmlnKCkuYXR0YWNobWVudHMgfHwge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaG1lbnQgZGVmaW5pdGlvbi5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREZWZpbml0aW9uIHwgbnVsbH0gLSBBdHRhY2htZW50IGRlZmluaXRpb24uXG4gICAqL1xuICBzdGF0aWMgYXR0YWNobWVudERlZmluaXRpb24oYXR0YWNobWVudE5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5hdHRhY2htZW50RGVmaW5pdGlvbnMoKVthdHRhY2htZW50TmFtZV0gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIGRlZmluaXRpb24uXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHt7dHlwZTogXCJiZWxvbmdzVG9cIiB8IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIiwgYXV0b2xvYWQ/OiBib29sZWFufSB8IG51bGx9IC0gUmVsYXRpb25zaGlwIGRlZmluaXRpb24uXG4gICAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgZGVmaW5pdGlvbnMgPSB0aGlzLnJlbGF0aW9uc2hpcERlZmluaXRpb25zKClcblxuICAgIHJldHVybiBkZWZpbml0aW9uc1tyZWxhdGlvbnNoaXBOYW1lXSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBSYWlscy1zdHlsZSBuZXN0ZWQgYXR0cmlidXRlcyBrZXkgdG8gYSBjb25maWd1cmVkIHJlbGF0aW9uc2hpcC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBDYW5kaWRhdGUgYXR0cmlidXRlIG5hbWUsIHN1Y2ggYXMgYHRhc2tzQXR0cmlidXRlc2AuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSBSZWxhdGlvbnNoaXAgbmFtZSB3aGVuIG5lc3RlZCBhdHRyaWJ1dGVzIGFyZSBjb25maWd1cmVkLlxuICAgKi9cbiAgc3RhdGljIG5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAoIWF0dHJpYnV0ZU5hbWUuZW5kc1dpdGgoXCJBdHRyaWJ1dGVzXCIpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZSA9IGF0dHJpYnV0ZU5hbWUuc2xpY2UoMCwgLVwiQXR0cmlidXRlc1wiLmxlbmd0aClcbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZygpLm5lc3RlZEF0dHJpYnV0ZXMgfHwge31cblxuICAgIHJldHVybiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobmVzdGVkQXR0cmlidXRlc0NvbmZpZywgcmVsYXRpb25zaGlwTmFtZSlcbiAgICAgID8gcmVsYXRpb25zaGlwTmFtZVxuICAgICAgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBudWxsfSAtIFRhcmdldCByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzID0gdGhpcy5yZWxhdGlvbnNoaXBNb2RlbENsYXNzZXMoKVxuICAgIGNvbnN0IHZhbHVlID0gcmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICByZXR1cm4gRnJvbnRlbmRNb2RlbEJhc2UucmVzb2x2ZU1vZGVsQ2xhc3ModmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7QXR0cmlidXRlc30gLSBBdHRyaWJ1dGVzIGhhc2guXG4gICAqL1xuICBhdHRyaWJ1dGVzKCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0F0dHJpYnV0ZXN9ICovICh0aGlzLl9hdHRyaWJ1dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgbmV3IHJlY29yZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIG1vZGVsIGhhcyBub3QgeWV0IGJlZW4gcGVyc2lzdGVkLlxuICAgKi9cbiAgaXNOZXdSZWNvcmQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2lzTmV3UmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBwZXJzaXN0ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBtb2RlbCBoYXMgYmVlbiBwZXJzaXN0ZWQuXG4gICAqL1xuICBpc1BlcnNpc3RlZCgpIHtcbiAgICByZXR1cm4gIXRoaXMuaXNOZXdSZWNvcmQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGlzIG5ldyByZWNvcmQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbmV3SXNOZXdSZWNvcmQgLSBOZXcgcGVyc2lzdGVkLXN0YXRlIGZsYWcuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0SXNOZXdSZWNvcmQobmV3SXNOZXdSZWNvcmQpIHtcbiAgICB0aGlzLl9pc05ld1JlY29yZCA9IG5ld0lzTmV3UmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogTWFya3MgdGhpcyByZWNvcmQgZm9yIGRlc3RydWN0aW9uIHdoZW4gaXRzIHBhcmVudCBpcyBuZXh0IHNhdmVkIHRocm91Z2hcbiAgICogbmVzdGVkLWF0dHJpYnV0ZSBzdXBwb3J0LiBUaGUgcmVjb3JkIGlzIG5vdCByZW1vdmVkIGZyb20gdGhlIHBhcmVudCdzXG4gICAqIHJlbGF0aW9uc2hpcCBjb2xsZWN0aW9uIHVudGlsIHRoZSBzZXJ2ZXIgY29uZmlybXMgdGhlIGRlbGV0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgbWFya0ZvckRlc3RydWN0aW9uKCkge1xuICAgIHRoaXMuX21hcmtlZEZvckRlc3RydWN0aW9uID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFya2VkIGZvciBkZXN0cnVjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIHJlY29yZCBpcyBxdWV1ZWQgZm9yIG5lc3RlZCBkZXN0cnVjdGlvbiBvbiBuZXh0IHBhcmVudCBzYXZlLlxuICAgKi9cbiAgbWFya2VkRm9yRGVzdHJ1Y3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX21hcmtlZEZvckRlc3RydWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjaGFuZ2VzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBDaGFuZ2VkIGF0dHJpYnV0ZXMgYXMgYFtvbGRWYWx1ZSwgbmV3VmFsdWVdYC5cbiAgICovXG4gIGNoYW5nZXMoKSB7XG4gICAgLyoqXG4gICAgICogQ2hhbmdlZCBhdHRyaWJ1dGVzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IGNoYW5nZWRBdHRyaWJ1dGVzID0ge31cbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IG5ldyBTZXQoW1xuICAgICAgLi4uT2JqZWN0LmtleXModGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyksXG4gICAgICAuLi5PYmplY3Qua2V5cyh0aGlzLl9hdHRyaWJ1dGVzKVxuICAgIF0pXG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgYXR0cmlidXRlTmFtZXMpIHtcbiAgICAgIGNvbnN0IHByZXZpb3VzVmFsdWUgPSB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG4gICAgICBjb25zdCBjdXJyZW50VmFsdWUgPSB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICAgIGlmIChKU09OLnN0cmluZ2lmeShzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocHJldmlvdXNWYWx1ZSkpICE9PSBKU09OLnN0cmluZ2lmeShzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoY3VycmVudFZhbHVlKSkpIHtcbiAgICAgICAgY2hhbmdlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBbcHJldmlvdXNWYWx1ZSwgY3VycmVudFZhbHVlXVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjaGFuZ2VkQXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgY2hhbmdlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbnkgdHJhY2tlZCBhdHRyaWJ1dGUgaGFzIGNoYW5nZWQuXG4gICAqL1xuICBpc0NoYW5nZWQoKSB7XG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMuY2hhbmdlcygpKS5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVsYXRpb25zaGlwIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSAtIFJlbGF0aW9uc2hpcCBzdGF0ZSBvYmplY3QuXG4gICAqL1xuICBnZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGlmICghdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXSkge1xuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwRGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwRGVmaW5pdGlvbiAmJiByZWxhdGlvbnNoaXBUeXBlSXNDb2xsZWN0aW9uKHJlbGF0aW9uc2hpcERlZmluaXRpb24udHlwZSkpIHtcbiAgICAgICAgdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXSA9IG5ldyBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCh0aGlzLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXSA9IG5ldyBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXAodGhpcywgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzcylcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF0dGFjaG1lbnQgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGV9IC0gQXR0YWNobWVudCBoZWxwZXIuXG4gICAqL1xuICBnZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbihhdHRhY2htZW50TmFtZSlcblxuICAgIGlmICghYXR0YWNobWVudERlZmluaXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBhdHRhY2htZW50OiAke01vZGVsQ2xhc3MubmFtZX0jJHthdHRhY2htZW50TmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdKSB7XG4gICAgICB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0gPSBuZXcgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGUoe1xuICAgICAgICBhdHRhY2htZW50TmFtZSxcbiAgICAgICAgbW9kZWw6IHRoaXNcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxCYXNlIHwgQXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIGxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBpZCA9IHRoaXMucHJpbWFyeUtleVZhbHVlKClcbiAgICBjb25zdCByZWxvYWRlZE1vZGVsID0gYXdhaXQgTW9kZWxDbGFzc1xuICAgICAgLnByZWxvYWQoW3JlbGF0aW9uc2hpcE5hbWVdKVxuICAgICAgLmZpbmQoaWQpXG4gICAgY29uc3Qgc291cmNlUmVsYXRpb25zaGlwID0gcmVsb2FkZWRNb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICBjb25zdCB0YXJnZXRSZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgY29weUxvYWRlZFJlbGF0aW9uc2hpcFZhbHVlKHtzb3VyY2VSZWxhdGlvbnNoaXAsIHRhcmdldFJlbGF0aW9uc2hpcH0pXG5cbiAgICByZXR1cm4gdGFyZ2V0UmVsYXRpb25zaGlwLmxvYWRlZCgpXG4gIH1cblxuICAvKipcbiAgICogUHJlbG9hZHMgcmVsYXRpb25zaGlwKHMpIG9udG8gdGhpcyBhbHJlYWR5LWxvYWRlZCByZWNvcmQuIEFjY2VwdHMgZWl0aGVyIGFcbiAgICogcXVlcnkgYnVpbHQgdmlhIGBNb2RlbC5wcmVsb2FkKC4uLikuc2VsZWN0KC4uLilgIG9yIGEgcmF3IHByZWxvYWQgc3BlY1xuICAgKiAoc3RyaW5nIC8gYXJyYXkgLyBuZXN0ZWQgb2JqZWN0KS4gUmVsYXRpb25zaGlwcyBhbHJlYWR5IHByZWxvYWRlZCB3aXRoIHRoZVxuICAgKiByZXF1aXJlZCBjb2x1bW5zIHByZXNlbnQgYXJlIGxlZnQgdW50b3VjaGVkIHVubGVzcyBgZm9yY2VgIGlzIHNldC4gQ2Fycmllc1xuICAgKiB0aGUgcXVlcnkncyBwcmVsb2FkIGdyYXBoLCBzZWxlY3QsIHNlbGVjdHNFeHRyYSwgd2l0aENvdW50LCBhYmlsaXRpZXMsIGFuZFxuICAgKiBxdWVyeURhdGEgd2hlbiByZS1mZXRjaGluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8RnJvbnRlbmRNb2RlbENsYXNzPiB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBzdHJpbmcgfCBBcnJheTxzdHJpbmcgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkPn0gcXVlcnlPclNwZWMgLSBQcmVsb2FkIHNvdXJjZS5cbiAgICogQHBhcmFtIHt7Zm9yY2U/OiBib29sZWFufX0gW29wdGlvbnNdIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwcmVsb2FkaW5nIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIHByZWxvYWQocXVlcnlPclNwZWMsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IEZyb250ZW5kTW9kZWxQcmVsb2FkZXIucHJlbG9hZChbdGhpc10sIHF1ZXJ5T3JTcGVjLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIG9yIGxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxCYXNlIHwgQXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIHJlbGF0aW9uc2hpcE9yTG9hZChyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIHtcbiAgICAgIHJldHVybiByZWxhdGlvbnNoaXAubG9hZGVkKClcbiAgICB9XG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5fdHJ5Q29ob3J0UHJlbG9hZChyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKGJhdGNoZWQpIHJldHVybiByZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRlbXB0cyB0byBiYXRjaC1sb2FkIGByZWxhdGlvbnNoaXBOYW1lYCBhY3Jvc3MgY29ob3J0IHNpYmxpbmdzIHZpYSBhXG4gICAqIHNpbmdsZSBgcHJlbG9hZChbbmFtZV0pLndoZXJlKHtwazogW2lkc119KS50b0FycmF5KClgIHJlcXVlc3QsIHRoZW4gY29waWVzXG4gICAqIHRoZSBwcmVsb2FkZWQgcmVsYXRpb25zaGlwIHN0YXRlIG9udG8gZWFjaCBzaWJsaW5nLiBSZXR1cm5zIHRydWUgd2hlbiBhXG4gICAqIGJhdGNoIHJhbiwgZmFsc2Ugd2hlbiBhdXRvbG9hZCBpcyBvZmYsIHRoZXJlIGlzIG5vIGNvaG9ydCwgb3Igbm8gYmF0Y2hcbiAgICogY2FuZGlkYXRlcyByZW1haW4uIFNpYmxpbmdzIHdob3NlIHJlbGF0aW9uc2hpcCBzdGF0ZSBpcyBhbHJlYWR5IHNldFxuICAgKiAocHJlbG9hZGVkIG9yIGxvY2FsbHkgbWFuaXB1bGF0ZWQgdmlhIGBidWlsZGAgLyBgc2V0UmVsYXRpb25zaGlwYCkgYXJlXG4gICAqIHNraXBwZWQgc28gdGhlaXIgY2FjaGVkL2VkaXRlZCB2YWx1ZSBpcyBwcmVzZXJ2ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYSBjb2hvcnQgYmF0Y2ggcHJlbG9hZCByYW4uXG4gICAqL1xuICBhc3luYyBfdHJ5Q29ob3J0UHJlbG9hZChyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgaWYgKCFGcm9udGVuZE1vZGVsQmFzZS5nZXRBdXRvbG9hZCgpKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBjb2hvcnQgPSB0aGlzLl9sb2FkQ29ob3J0XG5cbiAgICBpZiAoIWNvaG9ydCB8fCBjb2hvcnQubGVuZ3RoIDw9IDEpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgZGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKCFkZWZpbml0aW9uKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoZGVmaW5pdGlvbi5hdXRvbG9hZCA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuXG4gICAgLyoqXG4gICAgICogQmF0Y2guXG4gICAgICogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxCYXNlPn0gKi9cbiAgICBjb25zdCBiYXRjaCA9IFtdXG5cbiAgICAvLyBFeGFjdCBzYW1lIGNsYXNzLCBwZXJzaXN0ZWQsIG5vIGV4aXN0aW5nIGluLW1lbW9yeSByZWxhdGlvbnNoaXAgc3RhdGUuXG4gICAgLy8gYHNldExvYWRlZGAgc2V0cyBgX3ByZWxvYWRlZCA9IHRydWVgIG9uIGV2ZXJ5IG11dGF0aW9uIHBhdGggKHByZWxvYWQsXG4gICAgLy8gc2V0UmVsYXRpb25zaGlwLCBidWlsZCwgYWRkVG9Mb2FkZWQpLCBzbyBgZ2V0UHJlbG9hZGVkKClgIGFsb25lIGlzIGFcbiAgICAvLyByZWxpYWJsZSBcImFscmVhZHkgdG91Y2hlZFwiIHNpZ25hbCBvbiB0aGUgZnJvbnRlbmQuXG4gICAgZm9yIChjb25zdCBzaWJsaW5nIG9mIGNvaG9ydCkge1xuICAgICAgaWYgKHNpYmxpbmcuY29uc3RydWN0b3IgIT09IE1vZGVsQ2xhc3MpIGNvbnRpbnVlXG4gICAgICBpZiAoc2libGluZy5pc05ld1JlY29yZCgpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBzaWJsaW5nUmVsYXRpb25zaGlwID0gc2libGluZy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgICAgaWYgKHNpYmxpbmdSZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIGNvbnRpbnVlXG5cbiAgICAgIGJhdGNoLnB1c2goc2libGluZylcbiAgICB9XG5cbiAgICBpZiAoYmF0Y2gubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgYmF0Y2hJZHMgPSBiYXRjaC5tYXAoKHNpYmxpbmcpID0+IHNpYmxpbmcucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgY29uc3QgcmVsb2FkZWRCYXRjaCA9IGF3YWl0IE1vZGVsQ2xhc3NcbiAgICAgIC5wcmVsb2FkKFtyZWxhdGlvbnNoaXBOYW1lXSlcbiAgICAgIC53aGVyZSh7W3ByaW1hcnlLZXldOiBiYXRjaElkc30pXG4gICAgICAudG9BcnJheSgpXG5cbiAgICAvKipcbiAgICAgKiBSZWxvYWRlZCBieSBpZC5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgRnJvbnRlbmRNb2RlbEJhc2U+fSAqL1xuICAgIGNvbnN0IHJlbG9hZGVkQnlJZCA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCByZWxvYWRlZCBvZiByZWxvYWRlZEJhdGNoKSB7XG4gICAgICByZWxvYWRlZEJ5SWQuc2V0KG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHJlbG9hZGVkLnByaW1hcnlLZXlWYWx1ZSgpKSwgcmVsb2FkZWQpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzaWJsaW5nIG9mIGJhdGNoKSB7XG4gICAgICBjb25zdCBrZXkgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBzaWJsaW5nLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgICAgY29uc3QgcmVsb2FkZWQgPSByZWxvYWRlZEJ5SWQuZ2V0KGtleSlcblxuICAgICAgaWYgKCFyZWxvYWRlZCkgY29udGludWVcblxuICAgICAgY29weUxvYWRlZFJlbGF0aW9uc2hpcFZhbHVlKHtcbiAgICAgICAgc291cmNlUmVsYXRpb25zaGlwOiByZWxvYWRlZC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSksXG4gICAgICAgIHRhcmdldFJlbGF0aW9uc2hpcDogc2libGluZy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgLy8gSWYgdGhlIGNhbGxlciBpdHNlbGYgd2FzIG5vdCBwb3B1bGF0ZWQgKHJlY29yZCBkZWxldGVkL2ZpbHRlcmVkIGJldHdlZW5cbiAgICAvLyB0aGUgbGlzdCBmZXRjaCBhbmQgdGhpcyBwcmVsb2FkIHJlcXVlc3QpLCBmYWxsIGJhY2sgdG8gcGVyLXJlY29yZCBsb2FkXG4gICAgLy8gc28gdGhlIGNhbGxlciBnZXRzIGEgcmVhbCBub3QtZm91bmQgZXJyb3IgaW5zdGVhZCBvZiBhIG1pc2xlYWRpbmdcbiAgICAvLyBcImhhc24ndCBiZWVuIHByZWxvYWRlZFwiIHRocm93IGZyb20gbG9hZGVkKCkuXG4gICAgaWYgKCF0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKS5nZXRQcmVsb2FkZWQoKSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZSB8IG51bGwgfCB1bmRlZmluZWR9IHJlbGF0aW9uc2hpcFZhbHVlIC0gUmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEJhc2UgfCBudWxsIHwgdW5kZWZpbmVkfSAtIEFzc2lnbmVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIHNldFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBWYWx1ZSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCByZWxhdGlvbnNoaXBEZWZpbml0aW9uID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcERlZmluaXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biByZWxhdGlvbnNoaXA6ICR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBzZXQgaGFzLW1hbnkgcmVsYXRpb25zaGlwIHdpdGggc2V0UmVsYXRpb25zaGlwKCk6ICR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICByZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHJlbGF0aW9uc2hpcFZhbHVlKVxuXG4gICAgcmV0dXJuIHJlbGF0aW9uc2hpcFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhc3NpZ24gYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtBdHRyaWJ1dGVzIHwgQ3JlYXRlQXR0cmlidXRlcyB8IFVwZGF0ZUF0dHJpYnV0ZXMgfCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSBhdHRyaWJ1dGVzIC0gQXR0cmlidXRlcyB0byBhc3NpZ24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFzc2lnbkF0dHJpYnV0ZXMoYXR0cmlidXRlcykge1xuICAgIGNvbnN0IGF0dHJpYnV0ZVZhbHVlcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKGF0dHJpYnV0ZXMpXG5cbiAgICBmb3IgKGNvbnN0IGtleSBpbiBhdHRyaWJ1dGVWYWx1ZXMpIHtcbiAgICAgIHRoaXMuc2V0QXR0cmlidXRlKGtleSwgYXR0cmlidXRlVmFsdWVzW2tleV0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgcmVsYXRpb25zaGlwIGNhY2hlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBDbGVhcnMgY2FjaGVkIHJlbGF0aW9uc2hpcCBzdGF0ZS5cbiAgICovXG4gIGNsZWFyUmVsYXRpb25zaGlwQ2FjaGUoKSB7XG4gICAgdGhpcy5fcmVsYXRpb25zaGlwcyA9IHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmltYXJ5IGtleS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IC0gUHJpbWFyeSBrZXkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiB0aGlzLnJlc291cmNlQ29uZmlnKCkucHJpbWFyeUtleSB8fCBcImlkXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW1hcnkga2V5IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IC0gUHJpbWFyeSBrZXkgdmFsdWUuXG4gICAqL1xuICBwcmltYXJ5S2V5VmFsdWUoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgcmV0dXJuIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgY29uc3QgdmFsdWUgPSB0aGlzLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcblxuICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHByaW1hcnkga2V5ICcke2F0dHJpYnV0ZU5hbWV9JyBvbiAke01vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdmFsdWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHNjYWxhciBpZGVudGl0eSByZXF1aXJlZCBieSBzY2FsYXItb25seSBmcm9udGVuZCBmZWF0dXJlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wZXJhdGlvbiAtIE9wZXJhdGlvbiByZXF1aXJpbmcgYSBzY2FsYXIgaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlTY2FsYXJ9IC0gU2NhbGFyIHByaW1hcnkta2V5IHZhbHVlLlxuICAgKi9cbiAgc2NhbGFyUHJpbWFyeUtleVZhbHVlKG9wZXJhdGlvbikge1xuICAgIHJldHVybiBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZSh0aGlzLnByaW1hcnlLZXlWYWx1ZSgpLCBvcGVyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgaWRlbnRpdHkgcmVwcmVzZW50ZWQgYnkgdGhlIGxhc3QgcGVyc2lzdGVkIGZyb250ZW5kIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gLSBQZXJzaXN0ZWQgcHJpbWFyeS1rZXkgdmFsdWUuXG4gICAqL1xuICBwZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgcmV0dXJuIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgY29uc3QgdmFsdWUgPSB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBwZXJzaXN0ZWQgcHJpbWFyeSBrZXkgJyR7YXR0cmlidXRlTmFtZX0nIG9uICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB2YWx1ZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEF0dHJpYnV0ZSB2YWx1ZS5cbiAgICovXG4gIHJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkge1xuICAgIGlmICh0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMgJiYgIXRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcy5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBBdHRyaWJ1dGVOb3RTZWxlY3RlZEVycm9yKHRoaXMuY29uc3RydWN0b3IubmFtZSwgYXR0cmlidXRlTmFtZSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYW4gYXR0cmlidXRlIHZhbHVlIGlzIGN1cnJlbnRseSBsb2FkZWQgb24gdGhpcyByZWNvcmQuIFVzZWQgYnkgdGhlXG4gICAqIHByZWxvYWRlciB0byBkZWNpZGUgd2hldGhlciBhIHJlbGF0aW9uc2hpcCBjYW4gYmUgc2tpcHBlZCBiZWNhdXNlIHRoZVxuICAgKiByZXF1ZXN0ZWQgY29sdW1ucyBhcmUgYWxyZWFkeSBwcmVzZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBhdHRyaWJ1dGUgaXMgbG9hZGVkLlxuICAgKi9cbiAgaGFzTG9hZGVkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAoIXRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcykgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiB0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMuaGFzKGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhbiBhc3NvY2lhdGlvbiBjb3VudCBhdHRhY2hlZCBieSBgLndpdGhDb3VudCguLi4pYC4gQ291bnRzXG4gICAqIGxpdmUgb24gYSBkZWRpY2F0ZWQgbWFwIHNlcGFyYXRlIGZyb20gdGhlIHJlY29yZCdzIGF0dHJpYnV0ZXMgc29cbiAgICogYSB2aXJ0dWFsIGNvdW50IGxpa2UgYHRhc2tzQ291bnRgIGNhbid0IHNpbGVudGx5IHNoYWRvdyBhIHJlYWxcbiAgICogY29sdW1uIG9mIHRoZSBzYW1lIG5hbWUuIFJldHVybnMgdGhlIGF0dGFjaGVkIHZhbHVlLCBvciAwIHdoZW5cbiAgICogYC53aXRoQ291bnQoLi4uKWAgd2Fzbid0IHJlcXVlc3RlZCBmb3IgdGhpcyBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUsIGUuZy4gYFwidGFza3NDb3VudFwiYCBvciBhIGN1c3RvbSBuYW1lIGZyb20gYC53aXRoQ291bnQoe2N1c3RvbU5hbWU6IHsuLi59fSlgLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEF0dGFjaGVkIGFzc29jaWF0aW9uIGNvdW50LCBvciB6ZXJvIHdoZW4gYWJzZW50LlxuICAgKi9cbiAgcmVhZENvdW50KGF0dHJpYnV0ZU5hbWUpIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRBc3NvY2lhdGlvbkNvdW50KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhdHRyaWJ1dGVOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIHNldHRlciBjYWxsZWQgYnkgYGluc3RhbnRpYXRlRnJvbVJlc3BvbnNlYCB3aGVuIGh5ZHJhdGluZ1xuICAgKiBhc3NvY2lhdGlvbiBjb3VudHMgdGhhdCByb2RlIGFsb25nIHdpdGggdGhlIHJlY29yZCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBDb3VudCB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0QXNzb2NpYXRpb25Db3VudChhdHRyaWJ1dGVOYW1lLCB2YWx1ZSkge1xuICAgIHNldFBheWxvYWRBc3NvY2lhdGlvbkNvdW50KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhdHRyaWJ1dGVOYW1lLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGEgcGVyLXJlY29yZCBhYmlsaXR5IHJlc3VsdCBhdHRhY2hlZCBieSBgLmFiaWxpdGllcyguLi4pYC4gVGhlXG4gICAqIGJhY2tlbmQgZXZhbHVhdGVzIGVhY2ggcmVxdWVzdGVkIGFjdGlvbiBhZ2FpbnN0IHRoZSBjdXJyZW50XG4gICAqIGFiaWxpdHkgZm9yIHRoaXMgcmVjb3JkIGluc3RhbmNlIGFuZCBzaGlwcyB0aGUgcmVzdWx0IGFsb25nc2lkZVxuICAgKiB0aGUgcmVjb3JkJ3MgYXR0cmlidXRlcy4gUmV0dXJucyBgZmFsc2VgIHdoZW4gdGhlIGFjdGlvbiB3YXNuJ3RcbiAgICogcmVxdWVzdGVkIChvciB0aGUgYWJpbGl0eSBkZW5pZWQgaXQpLCBzbyBVSSBjb2RlIGNhbiBzYWZlbHkgYnJhbmNoXG4gICAqIG9uIGByZWNvcmQuY2FuKFwidXBkYXRlXCIpYCB3aXRob3V0IGZpcnN0IGNoZWNraW5nIHdoZXRoZXIgdGhlXG4gICAqIGFiaWxpdHkgd2FzIGxvYWRlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEFiaWxpdHkgYWN0aW9uIG5hbWUsIGUuZy4gYFwidXBkYXRlXCJgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXF1ZXN0ZWQgYWJpbGl0eSBpcyBhbGxvd2VkLlxuICAgKi9cbiAgY2FuKGFjdGlvbikge1xuICAgIHJldHVybiByZWFkUGF5bG9hZENvbXB1dGVkQWJpbGl0eSgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIHNldHRlciBjYWxsZWQgYnkgYGluc3RhbnRpYXRlRnJvbVJlc3BvbnNlYCB3aGVuIGh5ZHJhdGluZ1xuICAgKiBwZXItcmVjb3JkIGFiaWxpdHkgcmVzdWx0cyB0aGF0IHJvZGUgYWxvbmcgd2l0aCB0aGUgcmVjb3JkXG4gICAqIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbiBuYW1lLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IHZhbHVlIC0gV2hldGhlciB0aGUgY3VycmVudCBhYmlsaXR5IHBlcm1pdHMgdGhlIGFjdGlvbiBvbiB0aGlzIHJlY29yZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0Q29tcHV0ZWRBYmlsaXR5KGFjdGlvbiwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhY3Rpb24sIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgYSBjb25zdW1lci1kZWZpbmVkIHZhbHVlIGF0dGFjaGVkIGJ5IGAucXVlcnlEYXRhKC4uLilgLiBTdG9yZWRcbiAgICogb24gYSBkZWRpY2F0ZWQgbWFwIHJhdGhlciB0aGFuIGBfYXR0cmlidXRlc2AsIHNvIGEgdmlydHVhbCBhbGlhc1xuICAgKiBsaWtlIGB0YXNrc0NvdW50YCBjYW5ub3Qgc2lsZW50bHkgc2hhZG93IGEgcmVhbCBjb2x1bW4gb2YgdGhlIHNhbWVcbiAgICogbmFtZS4gUmV0dXJucyBgbnVsbGAgd2hlbiBubyByZWdpc3RlcmVkIGZuIHByb2R1Y2VkIHRoYXQgYWxpYXMgZm9yXG4gICAqIHRoaXMgcmVjb3JkIChlLmcuIG5vIGNoaWxkIHJvd3MgbWF0Y2hlZCB0aGUgYWdncmVnYXRlKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBxdWVyeURhdGEgYWxpYXMgbmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEF0dGFjaGVkIHF1ZXJ5LWRhdGEgdmFsdWUuXG4gICAqL1xuICBxdWVyeURhdGEobmFtZSkge1xuICAgIHJldHVybiByZWFkUGF5bG9hZFF1ZXJ5RGF0YSgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgbmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBzZXR0ZXIgdXNlZCBieSBgaW5zdGFudGlhdGVGcm9tUmVzcG9uc2VgIHdoZW4gaHlkcmF0aW5nXG4gICAqIHF1ZXJ5RGF0YSB2YWx1ZXMgdGhhdCByb2RlIGFsb25nIHdpdGggdGhlIHJlY29yZCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIHF1ZXJ5RGF0YSBhbGlhcyBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIEF0dGFjaGVkIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRRdWVyeURhdGEobmFtZSwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkUXVlcnlEYXRhKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBuYW1lLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG5ld1ZhbHVlIC0gTmV3IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQXNzaWduZWQgdmFsdWUuXG4gICAqL1xuICBzZXRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSwgbmV3VmFsdWUpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUgPSBNb2RlbENsYXNzLm5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICBpZiAobmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzW25lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lXSA9IG5ld1ZhbHVlXG4gICAgICByZXR1cm4gbmV3VmFsdWVcbiAgICB9XG5cbiAgICBpZiAoTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbihhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dHJpYnV0ZU5hbWUpLnF1ZXVlQXR0YWNoKG5ld1ZhbHVlKVxuICAgICAgcmV0dXJuIG5ld1ZhbHVlXG4gICAgfVxuXG4gICAgY29uc3QgcHJldmlvdXNWYWx1ZSA9IHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cblxuICAgIHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBuZXdWYWx1ZVxuXG4gICAgaWYgKHRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcykge1xuICAgICAgdGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzLmFkZChhdHRyaWJ1dGVOYW1lKVxuICAgIH1cblxuICAgIC8vIE9ubHkgaW52YWxpZGF0ZSByZWxhdGlvbnNoaXAgY2FjaGUgZW50cmllcyB3aG9zZSBmb3JlaWduIGtleSBtYXRjaGVzIHRoZSBjaGFuZ2VkIGF0dHJpYnV0ZS5cbiAgICAvLyBCbGFua2V0LWNsZWFyaW5nIGFsbCByZWxhdGlvbnNoaXBzIG9uIGFueSBhdHRyaWJ1dGUgY2hhbmdlIGRlc3Ryb3lzIG5lc3RlZC1zYXZlIHN0YXRlXG4gICAgLy8gYW5kIHByZWxvYWRlZCBjaGlsZHJlbiB0aGUgY2FsbGVyIG5ldmVyIGFza2VkIHRvIGludmFsaWRhdGUuXG4gICAgaWYgKCFPYmplY3QuaXMocHJldmlvdXNWYWx1ZSwgbmV3VmFsdWUpKSB7XG4gICAgICB0aGlzLl9pbnZhbGlkYXRlUmVsYXRpb25zaGlwc0ZvckF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKVxuICAgIH1cblxuICAgIHJldHVybiBuZXdWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIEludmFsaWRhdGVzIGFueSBjYWNoZWQgYmVsb25nc1RvIHJlbGF0aW9uc2hpcCB3aG9zZSBmb3JlaWduIGtleSBtYXRjaGVzIHRoZVxuICAgKiBjaGFuZ2VkIGF0dHJpYnV0ZS4gSGFzTWFueSAvIGhhc09uZSByZWxhdGlvbnNoaXBzIGFyZSBsZWZ0IHVudG91Y2hlZCBiZWNhdXNlXG4gICAqIHRoZWlyIGZvcmVpZ24ga2V5IGxpdmVzIG9uIHRoZSBjaGlsZCwgbm90IG9uIHRoaXMgbW9kZWwsIGFuZCBibGFua2V0LWNsZWFyaW5nXG4gICAqIHRoZW0gd291bGQgZGVzdHJveSBuZXN0ZWQtc2F2ZSBzdGF0ZSBhbmQgcHJlbG9hZGVkIGNoaWxkcmVuIHRoZSBjYWxsZXIgbmV2ZXJcbiAgICogYXNrZWQgdG8gaW52YWxpZGF0ZS5cbiAgICpcbiAgICogRm9yZWlnbiBrZXlzIGFyZSBpbmZlcnJlZCB3aGVuIG5vdCBkZWNsYXJlZDogZm9yIGJlbG9uZ3NUbyBgcHJvamVjdElkYCBpc1xuICAgKiBpbmZlcnJlZCBmcm9tIHJlbGF0aW9uc2hpcCBuYW1lIGBwcm9qZWN0YC4gRXhwbGljaXQgYGZvcmVpZ25LZXlgIG9uIHRoZVxuICAgKiByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbiB0YWtlcyBwcmVjZWRlbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lIHRoYXQgY2hhbmdlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaW52YWxpZGF0ZVJlbGF0aW9uc2hpcHNGb3JBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkge1xuICAgIGlmICghdGhpcy5fcmVsYXRpb25zaGlwcyB8fCBPYmplY3Qua2V5cyh0aGlzLl9yZWxhdGlvbnNoaXBzKS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGRlZmluaXRpb25zID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9ucygpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXModGhpcy5fcmVsYXRpb25zaGlwcykpIHtcbiAgICAgIGNvbnN0IGRlZmluaXRpb24gPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZGVmaW5pdGlvbnNbcmVsYXRpb25zaGlwTmFtZV0pXG5cbiAgICAgIGlmICghZGVmaW5pdGlvbiB8fCBkZWZpbml0aW9uLnR5cGUgIT09IFwiYmVsb25nc1RvXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGZvcmVpZ25LZXkgPSBkZWZpbml0aW9uLmZvcmVpZ25LZXkgfHwgYCR7cmVsYXRpb25zaGlwTmFtZX1JZGBcblxuICAgICAgaWYgKGZvcmVpZ25LZXkgPT09IGF0dHJpYnV0ZU5hbWUpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMuX3JlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBwYXRoLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERlcml2ZWQgcmVzb3VyY2UgcGF0aC5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZVBhdGgoKSB7XG4gICAgcmV0dXJuIHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aCh7XG4gICAgICBtb2RlbE5hbWU6IHRoaXMuZ2V0TW9kZWxOYW1lKCksXG4gICAgICByZXNvdXJjZVBhdGg6IGRlZmF1bHRGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKHRoaXMpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbW1hbmQgbmFtZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGV9IGNvbW1hbmRUeXBlIC0gQ29tbWFuZCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlc29sdmVkIGNvbW1hbmQgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBjb21tYW5kTmFtZShjb21tYW5kVHlwZSkge1xuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHJlc291cmNlQ29uZmlnLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgfHwgW11cbiAgICBjb25zdCBidWlsdEluTWVtYmVyQ29tbWFuZHMgPSByZXNvdXJjZUNvbmZpZy5idWlsdEluTWVtYmVyQ29tbWFuZHMgfHwgW11cbiAgICBjb25zdCBjb21tYW5kcyA9IHJlc291cmNlQ29uZmlnLmNvbW1hbmRzIHx8IFtdXG4gICAgY29uc3QgaXNFeHBvc2VkID0gYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcy5pbmNsdWRlcyhjb21tYW5kVHlwZSkgfHwgYnVpbHRJbk1lbWJlckNvbW1hbmRzLmluY2x1ZGVzKGNvbW1hbmRUeXBlKSB8fCBjb21tYW5kcy5pbmNsdWRlcyhjb21tYW5kVHlwZSlcbiAgICBjb25zdCBjb21tYW5kTmFtZSA9IGlzRXhwb3NlZCA/IGluZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24udW5kZXJzY29yZShjb21tYW5kVHlwZSkpIDogY29tbWFuZFR5cGVcblxuICAgIHJldHVybiB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbW1hbmROYW1lKHtcbiAgICAgIGNvbW1hbmROYW1lLFxuICAgICAgY29tbWFuZFR5cGUsXG4gICAgICBtb2RlbE5hbWU6IHRoaXMuZ2V0TW9kZWxOYW1lKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGN1c3RvbSBjb21tYW5kIHBheWxvYWQgYXJndW1lbnRzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncyAtIENvbW1hbmQgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENvbW1hbmQgcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBub3JtYWxpemVDdXN0b21Db21tYW5kUGF5bG9hZEFyZ3VtZW50cyhhcmdzKSB7XG4gICAgaWYgKGFyZ3MubGVuZ3RoID09PSAwKSByZXR1cm4ge31cbiAgICBpZiAoYXJncy5sZW5ndGggPT09IDEpIHtcbiAgICAgIGNvbnN0IHBheWxvYWQgPSBhcmdzWzBdXG4gICAgICBpZiAocGF5bG9hZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiB7fVxuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIHBheWxvYWQgIT09IFwib2JqZWN0XCIgfHwgcGF5bG9hZCA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4ge2FyZzE6IHBheWxvYWR9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHBheWxvYWQpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyIHwgc3RyaW5nIHwgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBhcmdzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgcGF5bG9hZFtgYXJnJHtpbmRleCArIDF9YF0gPSBhcmdzW2luZGV4XVxuICAgIH1cblxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbW9kZWwgbmFtZSwgcHJlZmVycmluZyBhbiBleHBsaWNpdCBgc3RhdGljIG1vZGVsTmFtZWAgZGVjbGFyYXRpb25cbiAgICogb3ZlciB0aGUgSmF2YVNjcmlwdCBjbGFzcyBgLm5hbWVgIHByb3BlcnR5LiBUaGlzIGFsbG93cyBtaW5pZmllZCBidWlsZHMgdG9cbiAgICogcHJlc2VydmUgY29ycmVjdCBtb2RlbCBuYW1lcyB3aXRob3V0IHJlbHlpbmcgb24gYGtlZXBfY2xhc3NuYW1lc2AuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIG1vZGVsIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0TW9kZWxOYW1lKCkge1xuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgbW9kZWxOYW1lID0gcmVzb3VyY2VDb25maWc/Lm1vZGVsTmFtZVxuXG4gICAgcmV0dXJuICh0eXBlb2YgbW9kZWxOYW1lID09PSBcInN0cmluZ1wiICYmIG1vZGVsTmFtZS5sZW5ndGggPiAwKSA/IG1vZGVsTmFtZSA6IHRoaXMubmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uZmlndXJlIHRyYW5zcG9ydC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnfSBjb25maWcgLSBGcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGNvbmZpZ3VyZVRyYW5zcG9ydChjb25maWcpIHtcbiAgICBpZiAoIWNvbmZpZyB8fCB0eXBlb2YgY29uZmlnICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ1cmxcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudXJsID0gY29uZmlnLnVybFxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInNoYXJlZFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zaGFyZWQgPSBjb25maWcuc2hhcmVkXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwid2Vic29ja2V0Q2xpZW50XCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCA9IGNvbmZpZy53ZWJzb2NrZXRDbGllbnRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ3ZWJzb2NrZXRVcmxcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0VXJsID0gY29uZmlnLndlYnNvY2tldFVybFxuICAgICAgLy8gUmVzZXQgY2FjaGVkIGludGVybmFsIGNsaWVudCBzbyB0aGUgbmV3IFVSTCB0YWtlcyBlZmZlY3Qgb24gbmV4dCBzdWJzY3JpYmVcbiAgICAgIHJlc2V0SW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKVxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInJlcXVlc3RIZWFkZXJzXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RIZWFkZXJzID0gY29uZmlnLnJlcXVlc3RIZWFkZXJzXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwicmVxdWVzdENvbnRleHRcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdENvbnRleHQgPSBjb25maWcucmVxdWVzdENvbnRleHRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ0aW1lb3V0XCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVvdXQgPSBjb25maWcudGltZW91dFxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInNpZ25hbFwiKSkge1xuICAgICAgaWYgKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsICE9PSBjb25maWcuc2lnbmFsKSB7XG4gICAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsID0gY29uZmlnLnNpZ25hbFxuICAgICAgICByZXNldEludGVybmFsV2Vic29ja2V0Q2xpZW50KClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ0aW1lWm9uZVwiKSkge1xuICAgICAgaWYgKGNvbmZpZy50aW1lWm9uZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGRlbGV0ZSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lID0gY29uZmlnLnRpbWVab25lXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwic2Vzc2lvblN0b3JlXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNlc3Npb25TdG9yZSA9IGNvbmZpZy5zZXNzaW9uU3RvcmVcbiAgICAgIC8vIFJlc2V0IGNhY2hlZCBpbnRlcm5hbCBjbGllbnQgc28gdGhlIG5ldyBzZXNzaW9uU3RvcmUgaXMgcGlja2VkIHVwLlxuICAgICAgcmVzZXRJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwib2ZmbGluZVN5bmNcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcub2ZmbGluZVN5bmMgPSBjb25maWcub2ZmbGluZVN5bmNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29ubmVjdCB0aGUgaW50ZXJuYWwgV2ViU29ja2V0IGFuZCBlbmFibGUgYXV0by1yZWNvbm5lY3QuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWx9fSBbb3B0aW9uc10gLSBTdGFydHVwIGNvbnRyb2xzIGNvbXBvc2VkIHdpdGggdGhlIGNvbmZpZ3VyZWQgdHJhbnNwb3J0IGNvbnRyb2xzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbm5lY3RlZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjb25uZWN0V2Vic29ja2V0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGNsaWVudCA9IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpXG5cbiAgICBpZiAoIWNsaWVudCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY29ubmVjdFdlYnNvY2tldCByZXF1aXJlcyBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldFVybH0pXCIpXG4gICAgfVxuXG4gICAgYXdhaXQgY2xpZW50LmNvbm5lY3QoZnJvbnRlbmRNb2RlbFdlYnNvY2tldFN0YXJ0dXBDb250cm9scyhvcHRpb25zKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNjb25uZWN0IHRoZSBpbnRlcm5hbCBXZWJTb2NrZXQgYW5kIGRpc2FibGUgYXV0by1yZWNvbm5lY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xvc2VkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGRpc2Nvbm5lY3RXZWJzb2NrZXQoKSB7XG4gICAgaWYgKCFpbnRlcm5hbFdlYnNvY2tldENsaWVudCkgcmV0dXJuXG5cbiAgICBjb25zdCBjbGllbnQgPSBpbnRlcm5hbFdlYnNvY2tldENsaWVudFxuXG4gICAgZGV0YWNoSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoY2xpZW50KVxuICAgIGF3YWl0IGNsaWVudC5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgdW50aWwgcXVldWVkIGFuZCBhY3RpdmUgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHJlcXVlc3RzIGZpbmlzaC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsSWRsZVdhaXRBcmdzfSBbYXJnc10gLSBXYWl0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdHJhbnNwb3J0IGlzIGlkbGUuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgd2FpdEZvcklkbGUoYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge3F1aWV0TXMgPSAwLCB0aW1lb3V0OiB0aW1lb3V0TXMgPSA1MDAwLCAuLi5yZXN0QXJnc30gPSBhcmdzXG4gICAgY29uc3QgcmVzdEFyZ0tleXMgPSBPYmplY3Qua2V5cyhyZXN0QXJncylcblxuICAgIGlmIChyZXN0QXJnS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gd2FpdEZvcklkbGUgYXJnczogJHtyZXN0QXJnS2V5cy5qb2luKFwiLCBcIil9YClcbiAgICB9XG5cbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShxdWlldE1zKSB8fCBxdWlldE1zIDwgMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCB3YWl0Rm9ySWRsZSBxdWlldE1zIHRvIGJlIGEgbm9uLW5lZ2F0aXZlIG51bWJlciwgZ290OiAke3F1aWV0TXN9YClcbiAgICB9XG5cbiAgICBhd2FpdCB0aW1lb3V0KFxuICAgICAge3RpbWVvdXQ6IHRpbWVvdXRNcywgZXJyb3JNZXNzYWdlOiBcIlRpbWVkIG91dCB3YWl0aW5nIGZvciBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgdG8gYmVjb21lIGlkbGVcIn0sXG4gICAgICBhc3luYyAoKSA9PiBhd2FpdCB3YWl0Rm9yRnJvbnRlbmRNb2RlbFRyYW5zcG9ydElkbGUocXVpZXRNcylcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY3VycmVudCBXZWJTb2NrZXQgY29ubmVjdGlvbiBzdGF0ZS5cbiAgICogQHJldHVybnMge3tkaXNjb25uZWN0ZWRTaW5jZTogbnVtYmVyIHwgbnVsbCwgaGFzQ2xpZW50OiBib29sZWFuLCBpc09wZW46IGJvb2xlYW4sIGxpc3RlbmVyQ291bnQ6IG51bWJlcn19IC0gU25hcHNob3Qgb2YgdGhlIG1hbmFnZWQgd2Vic29ja2V0IGNvbm5lY3Rpb24gc3RhdGUuXG4gICAqL1xuICBzdGF0aWMgd2Vic29ja2V0U3RhdGUoKSB7XG4gICAgaWYgKCFpbnRlcm5hbFdlYnNvY2tldENsaWVudCkge1xuICAgICAgcmV0dXJuIHtkaXNjb25uZWN0ZWRTaW5jZTogbnVsbCwgaGFzQ2xpZW50OiBmYWxzZSwgaXNPcGVuOiBmYWxzZSwgbGlzdGVuZXJDb3VudDogMH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQuc3RhdGUoKSxcbiAgICAgIGhhc0NsaWVudDogdHJ1ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZSB0aGUgcmF3IFdlYlNvY2tldCB3aXRob3V0IGRpc2FibGluZyBhdXRvLXJlY29ubmVjdC4gVXNlZCBieSB0ZXN0cyB0b1xuICAgKiBzaW11bGF0ZSBhbiB1bmV4cGVjdGVkIG5ldHdvcmsgZHJvcCBhbmQgdmVyaWZ5IHJlY29ubmVjdGlvbiBiZWhhdmlvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc29ja2V0IGhhcyBjbG9zZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZHJvcFdlYnNvY2tldCgpIHtcbiAgICBpZiAoIWludGVybmFsV2Vic29ja2V0Q2xpZW50KSByZXR1cm5cblxuICAgIGF3YWl0IGludGVybmFsV2Vic29ja2V0Q2xpZW50LmRyb3BDb25uZWN0aW9uKClcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIGdsb2JhbCBtZXRhZGF0YSBvbiB0aGUgV2ViU29ja2V0IGNvbm5lY3Rpb24uIFNlbnQgdG8gdGhlIHNlcnZlciBpbW1lZGlhdGVseVxuICAgKiBvdmVyIFdlYlNvY2tldCBhbmQgZXhwb3NlZCB0byBXZWJTb2NrZXQtYm9ybmUgcmVxdWVzdHMgYXMgcmVxdWVzdCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIE1ldGFkYXRhIGtleS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBNZXRhZGF0YSB2YWx1ZSAobnVsbCB0byBjbGVhcikuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHNldFdlYnNvY2tldE1ldGFkYXRhKGtleSwgdmFsdWUpIHtcbiAgICBjb25zdCBjbGllbnQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgfHwgcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkpXG5cbiAgICBpZiAoIWNsaWVudCB8fCB0eXBlb2YgY2xpZW50LnNldE1ldGFkYXRhICE9PSBcImZ1bmN0aW9uXCIpIHJldHVyblxuXG4gICAgY2xpZW50LnNldE1ldGFkYXRhKGtleSwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogT3BlbnMgYSBtYW5hZ2VkIGNvbm5lY3Rpb24gdGhhdCBhdXRvLW9wZW5zLCBhdXRvLWNsb3NlcywgYW5kXG4gICAqIGF1dG8tcmVjb25uZWN0cyBiYXNlZCBvbiBgc2hvdWxkQ29ubmVjdCgpYCBhbmQgYHBhcmFtcygpYC5cbiAgICogQ2FsbCBgaGFuZGxlLnN5bmMoKWAgd2hlbmV2ZXIgdGhlIGlucHV0cyB0aGF0IGRyaXZlIHRob3NlXG4gICAqIGZ1bmN0aW9ucyBjaGFuZ2UgKGUuZy4gY3VycmVudC11c2VyIHNpZ24taW4vb3V0KS4gVGhlIGhhbmRsZVxuICAgKiByZXRyaWVzIHdoZW4gdGhlIFdTIGNsaWVudCBpc24ndCByZWFkeSBhbmQgcmVvcGVucyBvbiBjbG9zZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbm5lY3Rpb25UeXBlIC0gQ29ubmVjdGlvbiBjbGFzcyBuYW1lIHJlZ2lzdGVyZWQgb24gdGhlIHNlcnZlci5cbiAgICogQHBhcmFtIHt7c2hvdWxkQ29ubmVjdDogKCkgPT4gYm9vbGVhbiwgcGFyYW1zOiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHNpZ25hbD86IEFib3J0U2lnbmFsLCBvbk1lc3NhZ2U/OiAoYm9keTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHZvaWR9fSBvcHRpb25zIC0gQ29ubmVjdGlvbiBsaWZlY3ljbGUsIGNhbmNlbGxhdGlvbiwgYW5kIHBheWxvYWQgY2FsbGJhY2tzLlxuICAgKiBAcmV0dXJucyB7e3N5bmM6ICgpID0+IHZvaWQsIGNsb3NlOiAoKSA9PiB2b2lkfX0gLSBIYW5kbGUgdXNlZCB0byByZXN5bmMgb3IgY2xvc2UgdGhlIG1hbmFnZWQgY29ubmVjdGlvbi5cbiAgICovXG4gIHN0YXRpYyBvcGVuTWFuYWdlZENvbm5lY3Rpb24oY29ubmVjdGlvblR5cGUsIG9wdGlvbnMpIHtcbiAgICAvKipcbiAgICAgKiBDb25uZWN0aW9uLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICBsZXQgY29ubmVjdGlvbiA9IG51bGxcbiAgICBsZXQgY2xvc2VkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBSZXRyeSB0aW1lci5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSAqL1xuICAgIGxldCByZXRyeVRpbWVyID0gbnVsbFxuICAgIGxldCBsYXN0UGFyYW1zSnNvbiA9IFwiXCJcbiAgICBjb25zdCBjb250cm9scyA9IGZyb250ZW5kTW9kZWxXZWJzb2NrZXRTdGFydHVwQ29udHJvbHMoe3NpZ25hbDogb3B0aW9ucy5zaWduYWx9KVxuICAgIGNvbnN0IGNsZWFyUmV0cnlUaW1lciA9ICgpID0+IHtcbiAgICAgIGlmIChyZXRyeVRpbWVyID09PSBudWxsKSByZXR1cm5cblxuICAgICAgZ2xvYmFsVGhpcy5jbGVhclRpbWVvdXQocmV0cnlUaW1lcilcbiAgICAgIHJldHJ5VGltZXIgPSBudWxsXG4gICAgfVxuXG4gICAgY29uc3QgY2xvc2UgPSAoKSA9PiB7XG4gICAgICBpZiAoY2xvc2VkKSByZXR1cm5cblxuICAgICAgY2xvc2VkID0gdHJ1ZVxuICAgICAgY2xlYXJSZXRyeVRpbWVyKClcbiAgICAgIGNvbnRyb2xzLnNpZ25hbD8ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGNsb3NlKVxuICAgICAgaWYgKGNvbm5lY3Rpb24gJiYgIWNvbm5lY3Rpb24uaXNDbG9zZWQoKSkgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgICBjb25uZWN0aW9uID0gbnVsbFxuICAgIH1cblxuICAgIGNvbnN0IHN5bmMgPSAoKSA9PiB7XG4gICAgICBpZiAoY2xvc2VkKSByZXR1cm5cblxuICAgICAgaWYgKCFvcHRpb25zLnNob3VsZENvbm5lY3QoKSkge1xuICAgICAgICBjbGVhclJldHJ5VGltZXIoKVxuICAgICAgICBpZiAoY29ubmVjdGlvbiAmJiAhY29ubmVjdGlvbi5pc0Nsb3NlZCgpKSBjb25uZWN0aW9uLmNsb3NlKClcbiAgICAgICAgY29ubmVjdGlvbiA9IG51bGxcbiAgICAgICAgbGFzdFBhcmFtc0pzb24gPSBcIlwiXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBjb25zdCBuZXh0UGFyYW1zID0gb3B0aW9ucy5wYXJhbXMoKVxuICAgICAgY29uc3QgbmV4dFBhcmFtc0pzb24gPSBKU09OLnN0cmluZ2lmeShuZXh0UGFyYW1zKVxuXG4gICAgICAvLyBBbHJlYWR5IGNvbm5lY3RlZCB3aXRoIHNhbWUgcGFyYW1zIOKAlCBub3RoaW5nIHRvIGRvLlxuICAgICAgaWYgKGNvbm5lY3Rpb24gJiYgIWNvbm5lY3Rpb24uaXNDbG9zZWQoKSAmJiBuZXh0UGFyYW1zSnNvbiA9PT0gbGFzdFBhcmFtc0pzb24pIHJldHVyblxuXG4gICAgICAvLyBDb25uZWN0ZWQgYnV0IHBhcmFtcyBjaGFuZ2VkIOKAlCBzZW5kIHVwZGF0ZSBtZXNzYWdlLlxuICAgICAgLy8gR3VhcmQgd2l0aCB0cnkvY2F0Y2g6IHRoZSBjb25uZWN0aW9uIGhhbmRsZSBzdGF5cyBsaXZlIGR1cmluZ1xuICAgICAgLy8gcmVjb25uZWN0IGJ1dCB0aGUgdW5kZXJseWluZyBzb2NrZXQgbWF5IGJlIGNsb3NlZC5cbiAgICAgIGlmIChjb25uZWN0aW9uICYmICFjb25uZWN0aW9uLmlzQ2xvc2VkKCkpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25uZWN0aW9uLnNlbmRNZXNzYWdlKG5leHRQYXJhbXMpXG4gICAgICAgICAgbGFzdFBhcmFtc0pzb24gPSBuZXh0UGFyYW1zSnNvblxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICBjb25uZWN0aW9uID0gbnVsbFxuICAgICAgICAgIGxhc3RQYXJhbXNKc29uID0gXCJcIlxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIFdTIGNsaWVudCBub3QgcmVhZHkg4oCUIHJldHJ5LiBDaGVjayB0aGUgYWN0dWFsIGNsaWVudCAod2hpY2hcbiAgICAgIC8vIG1heSBiZSBhbiBpbmplY3RlZCB3ZWJzb2NrZXRDbGllbnQpIGluc3RlYWQgb2Ygd2Vic29ja2V0U3RhdGUoKVxuICAgICAgLy8gd2hpY2ggb25seSByZWZsZWN0cyB0aGUgaW50ZXJuYWwgY2xpZW50LlxuICAgICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50IHx8IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpKVxuXG4gICAgICBpZiAoIWNsaWVudCB8fCAhY2xpZW50LmlzT3BlbigpKSB7XG4gICAgICAgIGlmIChyZXRyeVRpbWVyID09PSBudWxsKSB7XG4gICAgICAgICAgcmV0cnlUaW1lciA9IGdsb2JhbFRoaXMuc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICByZXRyeVRpbWVyID0gbnVsbFxuICAgICAgICAgICAgc3luYygpXG4gICAgICAgICAgfSwgMjUwKVxuICAgICAgICB9XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBsYXN0UGFyYW1zSnNvbiA9IG5leHRQYXJhbXNKc29uXG4gICAgICBjb25uZWN0aW9uID0gY2xpZW50Lm9wZW5Db25uZWN0aW9uKGNvbm5lY3Rpb25UeXBlLCB7XG4gICAgICAgIHBhcmFtczogbmV4dFBhcmFtcyxcbiAgICAgICAgb25NZXNzYWdlOiBvcHRpb25zLm9uTWVzc2FnZSxcbiAgICAgICAgb25DbG9zZTogKCkgPT4ge1xuICAgICAgICAgIGlmIChjb25uZWN0aW9uPy5pc0Nsb3NlZCgpKSB7XG4gICAgICAgICAgICBjb25uZWN0aW9uID0gbnVsbFxuICAgICAgICAgICAgbGFzdFBhcmFtc0pzb24gPSBcIlwiXG4gICAgICAgICAgICBzeW5jKClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29udHJvbHMuc2lnbmFsPy5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgY2xvc2UsIHtvbmNlOiB0cnVlfSlcblxuICAgIGlmIChjb250cm9scy5zaWduYWw/LmFib3J0ZWQpIHtcbiAgICAgIGNsb3NlKClcbiAgICB9IGVsc2Uge1xuICAgICAgc3luYygpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtzeW5jLCBjbG9zZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBPcGVucyBhIDE6MSBgV2Vic29ja2V0Q29ubmVjdGlvbmAgb2YgdGhlIGdpdmVuIHR5cGUuIFRoaW5cbiAgICogY29udmVuaWVuY2Ugd3JhcHBlciBhcm91bmQgdGhlIGludGVybmFsIFdTIGNsaWVudCdzXG4gICAqIGBvcGVuQ29ubmVjdGlvbmAuIEFwcHMgdXNlIHRoaXMgZm9yIHBlci1zZXNzaW9uIHN0YXRlL21lc3NhZ2luZ1xuICAgKiB0aGF0IGRvZXNuJ3QgZml0IHRoZSBwdWIvc3ViIENoYW5uZWwgbW9kZWwgKGxvY2FsZSwgcHJlc2VuY2UpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29ubmVjdGlvblR5cGUgLSBOYW1lIHRoZSBzZXJ2ZXIgcmVnaXN0ZXJlZCB0aGUgY2xhc3MgdW5kZXIuXG4gICAqIEBwYXJhbSB7e3BhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgdGltZW91dE1zPzogbnVtYmVyLCBzaWduYWw/OiBBYm9ydFNpZ25hbCwgb25Db25uZWN0PzogKCkgPT4gdm9pZCwgb25NZXNzYWdlPzogKGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB2b2lkLCBvbkRpc2Nvbm5lY3Q/OiAoKSA9PiB2b2lkLCBvblJlc3VtZT86ICgpID0+IHZvaWQsIG9uQ2xvc2U/OiAocmVhc29uOiBzdHJpbmcpID0+IHZvaWR9fSBbb3B0aW9uc10gLSBDb25uZWN0aW9uIG9wdGlvbnMsIHJlYWRpbmVzcyBjb250cm9scywgYW5kIGV2ZW50IGhhbmRsZXJzLiBDb25uZWN0IHRoZSBjbGllbnQgZmlyc3Q7IHRoZSB0aW1lb3V0IGNvdmVycyBzZXJ2ZXItY29uZmlybWVkIHJlYWRpbmVzcyBhbmQgdGhlIHNpZ25hbCBjYW5jZWxzIHJlYWRpbmVzcyB3aXRob3V0IGVudGVyaW5nIHRoZSB3aXJlIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt7cmVhZHk6IFByb21pc2U8dm9pZD4sIGNsb3NlOiAoKSA9PiB2b2lkfX0gLSBXZWJzb2NrZXQgY29ubmVjdGlvbiBoYW5kbGUuXG4gICAqL1xuICBzdGF0aWMgb3BlbldlYnNvY2tldENvbm5lY3Rpb24oY29ubmVjdGlvblR5cGUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgIGlmICghY2xpZW50IHx8IHR5cGVvZiBjbGllbnQub3BlbkNvbm5lY3Rpb24gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwib3BlbldlYnNvY2tldENvbm5lY3Rpb24gcmVxdWlyZXMgY29uZmlndXJlVHJhbnNwb3J0KHt3ZWJzb2NrZXRVcmx9KVwiKVxuICAgIH1cblxuICAgIGNvbnN0IHtzaWduYWwsIHRpbWVvdXRNcywgLi4uY29ubmVjdGlvbk9wdGlvbnN9ID0gb3B0aW9uc1xuXG4gICAgcmV0dXJuIGNsaWVudC5vcGVuQ29ubmVjdGlvbihjb25uZWN0aW9uVHlwZSwge1xuICAgICAgLi4uY29ubmVjdGlvbk9wdGlvbnMsXG4gICAgICAuLi5mcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKHtzaWduYWwsIHRpbWVvdXRNc30pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdWJzY3JpYmVzIHRvIGEgcHViL3N1YiBgV2Vic29ja2V0Q2hhbm5lbGAuIFRoaW4gd3JhcHBlciBhcm91bmRcbiAgICogdGhlIGludGVybmFsIGNsaWVudCdzIGBzdWJzY3JpYmVDaGFubmVsYC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNoYW5uZWxUeXBlIC0gQ2hhbm5lbCBjbGFzcyBuYW1lIHJlZ2lzdGVyZWQgb24gdGhlIHNlcnZlci5cbiAgICogQHBhcmFtIHt7cGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCB0aW1lb3V0TXM/OiBudW1iZXIsIHNpZ25hbD86IEFib3J0U2lnbmFsLCBvbk1lc3NhZ2U/OiAoYm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHZvaWQsIG9uRGlzY29ubmVjdD86ICgpID0+IHZvaWQsIG9uUmVzdW1lPzogKCkgPT4gdm9pZCwgb25DbG9zZT86IChyZWFzb246IHN0cmluZykgPT4gdm9pZH19IFtvcHRpb25zXSAtIENoYW5uZWwgb3B0aW9ucywgc3RhcnR1cCBjb250cm9scywgYW5kIGV2ZW50IGhhbmRsZXJzLiBUaGUgdGltZW91dCBjb3ZlcnMgY29ubmVjdCBhbmQgc2VydmVyLWNvbmZpcm1lZCByZWFkaW5lc3Mgb25seTsgdGhlIHNpZ25hbCBjYW5jZWxzIHN0YXJ0dXAgd2l0aG91dCBlbnRlcmluZyB0aGUgd2lyZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7e3JlYWR5OiBQcm9taXNlPHZvaWQ+LCBjbG9zZTogKCkgPT4gdm9pZH19IC0gV2Vic29ja2V0IGNoYW5uZWwgaGFuZGxlIGZyb20gdGhlIGNvbmZpZ3VyZWQgY2xpZW50LlxuICAgKi9cbiAgc3RhdGljIHN1YnNjcmliZVdlYnNvY2tldENoYW5uZWwoY2hhbm5lbFR5cGUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgIGlmICghY2xpZW50IHx8IHR5cGVvZiBjbGllbnQuc3Vic2NyaWJlQ2hhbm5lbCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzdWJzY3JpYmVXZWJzb2NrZXRDaGFubmVsIHJlcXVpcmVzIGNvbmZpZ3VyZVRyYW5zcG9ydCh7d2Vic29ja2V0VXJsfSlcIilcbiAgICB9XG5cbiAgICBjb25zdCB7cGFyYW1zLCBzaWduYWwsIHRpbWVvdXRNcywgLi4uY2hhbm5lbE9wdGlvbnN9ID0gb3B0aW9uc1xuICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KClcbiAgICBjb25zdCBzY29wZWRQYXJhbXMgPSBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCwgcGFyYW1zID09PSB1bmRlZmluZWQgPyB7fSA6IHBhcmFtcylcbiAgICBjb25zdCBzdGFydHVwQ29udHJvbHMgPSBmcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKHtzaWduYWwsIHRpbWVvdXRNc30pXG4gICAgY29uc3Qgc2NvcGVkUGFyYW1zT3B0aW9uID0gcGFyYW1zID09PSB1bmRlZmluZWQgJiYgT2JqZWN0LmtleXMocmVxdWVzdENvbnRleHQpLmxlbmd0aCA9PT0gMFxuICAgICAgPyB7fVxuICAgICAgOiB7cGFyYW1zOiBzY29wZWRQYXJhbXN9XG4gICAgY29uc3QgaGFuZGxlID0gY2xpZW50LnN1YnNjcmliZUNoYW5uZWwoY2hhbm5lbFR5cGUsIHsuLi5jaGFubmVsT3B0aW9ucywgLi4uc2NvcGVkUGFyYW1zT3B0aW9uLCAuLi5zdGFydHVwQ29udHJvbHN9KVxuXG4gICAgaWYgKHR5cGVvZiBjbGllbnQuY29ubmVjdCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB2b2lkIGNsaWVudC5jb25uZWN0KHN0YXJ0dXBDb250cm9scykuY2F0Y2goKCkgPT4gaGFuZGxlLmNsb3NlKCkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGhhbmRsZVxuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbGxzIFdlYlNvY2tldCBsaWZlY3ljbGUgaG9va3Mgb24gZ2xvYmFsVGhpcyBmb3Igc3lzdGVtIHRlc3QgYWNjZXNzLlxuICAgKiBUZXN0cyBjYW4gY2FsbCBgZ2xvYmFsVGhpcy5fX3ZlbG9jaW91c193ZWJzb2NrZXRfaG9va3MuY29ubmVjdCgpYCBldGMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGluc3RhbGxXZWJzb2NrZXRUZXN0SG9va3MoKSB7XG4gICAgaWYgKHR5cGVvZiBnbG9iYWxUaGlzID09PSBcInVuZGVmaW5lZFwiKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChnbG9iYWxUaGlzKS5fX3ZlbG9jaW91c193ZWJzb2NrZXRfaG9va3MgPSB7XG4gICAgICBjb25uZWN0OiAoKSA9PiB0aGlzLmNvbm5lY3RXZWJzb2NrZXQoKSxcbiAgICAgIGRpc2Nvbm5lY3Q6ICgpID0+IHRoaXMuZGlzY29ubmVjdFdlYnNvY2tldCgpLFxuICAgICAgZHJvcDogKCkgPT4gdGhpcy5kcm9wV2Vic29ja2V0KCksXG4gICAgICBzdGF0ZTogKCkgPT4gdGhpcy53ZWJzb2NrZXRTdGF0ZSgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0cmlidXRlcyBmcm9tIHJlc3BvbnNlLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge29iamVjdH0gcmVzcG9uc2UgLSBSZXNwb25zZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gLSBBdHRyaWJ1dGVzIGZyb20gcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBhdHRyaWJ1dGVzRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgY29uc3QgbW9kZWxEYXRhID0gdGhpcy5tb2RlbERhdGFGcm9tUmVzcG9uc2UocmVzcG9uc2UpXG5cbiAgICByZXR1cm4gbW9kZWxEYXRhLmF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1vZGVsIGRhdGEgZnJvbSByZXNwb25zZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtvYmplY3R9IHJlc3BvbnNlIC0gUmVzcG9uc2UgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3thYmlsaXRpZXM6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4+LCBhdHRhY2htZW50T3duZXI6IHtyZWNvcmRJZDogc3RyaW5nLCByZWNvcmRUeXBlOiBzdHJpbmcsIHJlc291cmNlTmFtZTogc3RyaW5nfSB8IG51bGwsIGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4sIGFzc29jaWF0aW9uQ291bnRzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+LCBxdWVyeURhdGE6IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4sIHByZWxvYWRlZFJlbGF0aW9uc2hpcHM6IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4sIHNlbGVjdGVkQXR0cmlidXRlczogU2V0PHN0cmluZz59fSAtIEF0dHJpYnV0ZXMsIGF0dGFjaG1lbnQgb3duZXIsIHByZWxvYWRlZCByZWxhdGlvbnNoaXBzLCBhc3NvY2lhdGlvbiBjb3VudHMsIHF1ZXJ5RGF0YSwgYWJpbGl0aWVzLCBhbmQgc2VsZWN0ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIHN0YXRpYyBtb2RlbERhdGFGcm9tUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgcmVzcG9uc2UgYnV0IGdvdDogJHtyZXNwb25zZX1gKVxuICAgIH1cblxuICAgIC8vIE5hcnJvd3MgdGhlIHJlc3BvbnNlIG9iamVjdCB0byB0aGUgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHZhbHVlIG1hcC5cbiAgICBjb25zdCByZXNwb25zZU9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKHJlc3BvbnNlKVxuXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBtb2RlbERhdGEuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovXG4gICAgbGV0IG1vZGVsRGF0YVxuXG4gICAgaWYgKHJlc3BvbnNlT2JqZWN0Lm1vZGVsICYmIHR5cGVvZiByZXNwb25zZU9iamVjdC5tb2RlbCA9PT0gXCJvYmplY3RcIikge1xuICAgICAgLy8gTmFycm93cyB0aGUgbmVzdGVkIG1vZGVsIHBheWxvYWQgdG8gdGhlIGZyb250ZW5kLW1vZGVsIHZhbHVlIG1hcC5cbiAgICAgIG1vZGVsRGF0YSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKHJlc3BvbnNlT2JqZWN0Lm1vZGVsKVxuICAgIH0gZWxzZSBpZiAocmVzcG9uc2VPYmplY3QuYXR0cmlidXRlcyAmJiB0eXBlb2YgcmVzcG9uc2VPYmplY3QuYXR0cmlidXRlcyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgLy8gTmFycm93cyB0aGUgbmVzdGVkIGF0dHJpYnV0ZXMgcGF5bG9hZCB0byB0aGUgZnJvbnRlbmQtbW9kZWwgdmFsdWUgbWFwLlxuICAgICAgbW9kZWxEYXRhID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAocmVzcG9uc2VPYmplY3QuYXR0cmlidXRlcylcbiAgICB9IGVsc2Uge1xuICAgICAgbW9kZWxEYXRhID0gcmVzcG9uc2VPYmplY3RcbiAgICB9XG5cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoey4uLm1vZGVsRGF0YX0pXG4gICAgY29uc3QgcHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IGlzUGxhaW5PYmplY3QoYXR0cmlidXRlc1tQUkVMT0FERURfUkVMQVRJT05TSElQU19LRVldKVxuICAgICAgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChhdHRyaWJ1dGVzW1BSRUxPQURFRF9SRUxBVElPTlNISVBTX0tFWV0pXG4gICAgICA6IHt9XG4gICAgY29uc3QgYXNzb2NpYXRpb25Db3VudHMgPSBpc1BsYWluT2JqZWN0KGF0dHJpYnV0ZXNbQVNTT0NJQVRJT05fQ09VTlRTX0tFWV0pXG4gICAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi8gKGF0dHJpYnV0ZXNbQVNTT0NJQVRJT05fQ09VTlRTX0tFWV0pXG4gICAgICA6IHt9XG4gICAgY29uc3QgcXVlcnlEYXRhID0gaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzW1FVRVJZX0RBVEFfS0VZXSlcbiAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoYXR0cmlidXRlc1tRVUVSWV9EQVRBX0tFWV0pXG4gICAgICA6IHt9XG4gICAgY29uc3QgYWJpbGl0aWVzID0gaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzW0FCSUxJVElFU19LRVldKVxuICAgICAgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGJvb2xlYW4+fSAqLyAoYXR0cmlidXRlc1tBQklMSVRJRVNfS0VZXSlcbiAgICAgIDoge31cbiAgICBjb25zdCBzZWxlY3RlZEF0dHJpYnV0ZXNGcm9tUGF5bG9hZCA9IEFycmF5LmlzQXJyYXkoYXR0cmlidXRlc1tTRUxFQ1RFRF9BVFRSSUJVVEVTX0tFWV0pXG4gICAgICA/IG5ldyBTZXQoLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGF0dHJpYnV0ZXNbU0VMRUNURURfQVRUUklCVVRFU19LRVldKS5maWx0ZXIoKGF0dHJpYnV0ZU5hbWUpID0+IHR5cGVvZiBhdHRyaWJ1dGVOYW1lID09PSBcInN0cmluZ1wiKSlcbiAgICAgIDogbnVsbFxuICAgIGNvbnN0IGF0dGFjaG1lbnRPd25lclBheWxvYWQgPSBhdHRyaWJ1dGVzW0FUVEFDSE1FTlRfT1dORVJfS0VZXVxuICAgIGxldCBhdHRhY2htZW50T3duZXIgPSBudWxsXG5cbiAgICBpZiAoYXR0YWNobWVudE93bmVyUGF5bG9hZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoIWlzUGxhaW5PYmplY3QoYXR0YWNobWVudE93bmVyUGF5bG9hZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgRXhwZWN0ZWQgJHtBVFRBQ0hNRU5UX09XTkVSX0tFWX0gdG8gYmUgYW4gb2JqZWN0YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgYXR0YWNobWVudE93bmVyT2JqZWN0ID0gLyoqIEB0eXBlIHt7cmVjb3JkSWQ/OiB1bmtub3duLCByZWNvcmRUeXBlPzogdW5rbm93biwgcmVzb3VyY2VOYW1lPzogdW5rbm93bn19ICovIChhdHRhY2htZW50T3duZXJQYXlsb2FkKVxuXG4gICAgICBhdHRhY2htZW50T3duZXIgPSB7XG4gICAgICAgIHJlY29yZElkOiBmb3JjZWROb25CbGFua1N0cmluZyhhdHRhY2htZW50T3duZXJPYmplY3QucmVjb3JkSWQsIGAke0FUVEFDSE1FTlRfT1dORVJfS0VZfS5yZWNvcmRJZGApLFxuICAgICAgICByZWNvcmRUeXBlOiBmb3JjZWROb25CbGFua1N0cmluZyhhdHRhY2htZW50T3duZXJPYmplY3QucmVjb3JkVHlwZSwgYCR7QVRUQUNITUVOVF9PV05FUl9LRVl9LnJlY29yZFR5cGVgKSxcbiAgICAgICAgcmVzb3VyY2VOYW1lOiBmb3JjZWROb25CbGFua1N0cmluZyhhdHRhY2htZW50T3duZXJPYmplY3QucmVzb3VyY2VOYW1lLCBgJHtBVFRBQ0hNRU5UX09XTkVSX0tFWX0ucmVzb3VyY2VOYW1lYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBkZWxldGUgYXR0cmlidXRlc1tBVFRBQ0hNRU5UX09XTkVSX0tFWV1cbiAgICBkZWxldGUgYXR0cmlidXRlc1tQUkVMT0FERURfUkVMQVRJT05TSElQU19LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbU0VMRUNURURfQVRUUklCVVRFU19LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbQVNTT0NJQVRJT05fQ09VTlRTX0tFWV1cbiAgICBkZWxldGUgYXR0cmlidXRlc1tRVUVSWV9EQVRBX0tFWV1cbiAgICBkZWxldGUgYXR0cmlidXRlc1tBQklMSVRJRVNfS0VZXVxuXG4gICAgY29uc3Qgc2VsZWN0ZWRBdHRyaWJ1dGVzID0gc2VsZWN0ZWRBdHRyaWJ1dGVzRnJvbVBheWxvYWQgfHwgbmV3IFNldChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKSlcblxuICAgIHJldHVybiB7YWJpbGl0aWVzLCBhdHRhY2htZW50T3duZXIsIGF0dHJpYnV0ZXMsIGFzc29jaWF0aW9uQ291bnRzLCBxdWVyeURhdGEsIHByZWxvYWRlZFJlbGF0aW9uc2hpcHMsIHNlbGVjdGVkQXR0cmlidXRlc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IHByZWxvYWRlZCByZWxhdGlvbnNoaXBzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcHJlbG9hZGVkUmVsYXRpb25zaGlwcyAtIFByZWxvYWRlZCByZWxhdGlvbnNoaXAgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYXBwbHlQcmVsb2FkZWRSZWxhdGlvbnNoaXBzKG1vZGVsLCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKSB7XG4gICAgZm9yIChjb25zdCBbcmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwUGF5bG9hZF0gb2YgT2JqZWN0LmVudHJpZXMocHJlbG9hZGVkUmVsYXRpb25zaGlwcykpIHtcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMucmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXApIHtcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHJlbGF0aW9uc2hpcFBheWxvYWQpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfSBwYXlsb2FkIHRvIGJlIGFuIGFycmF5YClcbiAgICAgICAgfVxuXG4gICAgICAgIC8qKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+fSAqL1xuICAgICAgICBjb25zdCByZWxhdGVkTW9kZWxzID0gW11cblxuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHJlbGF0aW9uc2hpcFBheWxvYWQpIHtcbiAgICAgICAgICBjb25zdCByZWxhdGVkTW9kZWwgPSB0aGlzLmluc3RhbnRpYXRlUmVsYXRpb25zaGlwVmFsdWUoZW50cnksIHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICAgICAgICBpZiAoIShyZWxhdGVkTW9kZWwgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsQmFzZSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX0gcGF5bG9hZCBlbnRyeSB0byBpbnN0YW50aWF0ZSBhIGZyb250ZW5kIG1vZGVsYClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZWxhdGVkTW9kZWxzLnB1c2gocmVsYXRlZE1vZGVsKVxuICAgICAgICB9XG5cbiAgICAgICAgcmVsYXRpb25zaGlwLnNldExvYWRlZChyZWxhdGVkTW9kZWxzKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShyZWxhdGlvbnNoaXBQYXlsb2FkKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9IHBheWxvYWQgdG8gYmUgc2luZ3VsYXJgKVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZWxhdGVkTW9kZWwgPSB0aGlzLmluc3RhbnRpYXRlUmVsYXRpb25zaGlwVmFsdWUocmVsYXRpb25zaGlwUGF5bG9hZCwgdGFyZ2V0TW9kZWxDbGFzcylcblxuICAgICAgaWYgKHJlbGF0ZWRNb2RlbCAhPSB1bmRlZmluZWQgJiYgIShyZWxhdGVkTW9kZWwgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsQmFzZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfSBwYXlsb2FkIHRvIGluc3RhbnRpYXRlIGEgZnJvbnRlbmQgbW9kZWxgKVxuICAgICAgfVxuXG4gICAgICByZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHJlbGF0ZWRNb2RlbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnN0YW50aWF0ZSByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlbGF0aW9uc2hpcFBheWxvYWQgLSBSZWxhdGlvbnNoaXAgcGF5bG9hZCB2YWx1ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBudWxsfSB0YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gSW5zdGFudGlhdGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBpbnN0YW50aWF0ZVJlbGF0aW9uc2hpcFZhbHVlKHJlbGF0aW9uc2hpcFBheWxvYWQsIHRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICBpZiAoIXRhcmdldE1vZGVsQ2xhc3MpIHJldHVybiByZWxhdGlvbnNoaXBQYXlsb2FkXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcFBheWxvYWQgfHwgdHlwZW9mIHJlbGF0aW9uc2hpcFBheWxvYWQgIT09IFwib2JqZWN0XCIpIHJldHVybiByZWxhdGlvbnNoaXBQYXlsb2FkXG5cbiAgICByZXR1cm4gdGFyZ2V0TW9kZWxDbGFzcy5pbnN0YW50aWF0ZUZyb21SZXNwb25zZShyZWxhdGlvbnNoaXBQYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zdGFudGlhdGUgZnJvbSByZXNwb25zZS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgSW5zdGFuY2VUeXBlPFQ+fSByZXNwb25zZSAtIFJlc3BvbnNlIHBheWxvYWQsIG9yIGFuIGFscmVhZHktaHlkcmF0ZWQgaW5zdGFuY2Ugb2YgdGhpcyBjbGFzcy5cbiAgICogQHJldHVybnMge0luc3RhbmNlVHlwZTxUPn0gLSBOZXcgbW9kZWwgaW5zdGFuY2UsIG9yIHRoZSBzYW1lIGluc3RhbmNlIHVuY2hhbmdlZCBpZiBpdCB3YXMgYWxyZWFkeSBoeWRyYXRlZC5cbiAgICovXG4gIHN0YXRpYyBpbnN0YW50aWF0ZUZyb21SZXNwb25zZShyZXNwb25zZSkge1xuICAgIC8vIElkZW1wb3RlbnQ6IGlmIGEgY2FsbGVyIGhhbmRzIHVzIGFuIGFscmVhZHktaHlkcmF0ZWQgaW5zdGFuY2Ugb2YgdGhpc1xuICAgIC8vIGNsYXNzIChub3cgY29tbW9uIGJlY2F1c2UgdGhlIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgYXV0by1zZXJpYWxpemVzXG4gICAgLy8gYmFja2VuZCBgUmVjb3JkYCBpbnN0YW5jZXMgcmV0dXJuZWQgZnJvbSBjdXN0b20gY29tbWFuZHMgYW5kIHRoZVxuICAgIC8vIHRyYW5zcG9ydCBkZXNlcmlhbGl6ZXIgaHlkcmF0ZXMgdGhlbSBpbnRvIG1vZGVscyBiZWZvcmUgdGhlIGNhbGwgc2l0ZVxuICAgIC8vIHNlZXMgdGhlIHJlc3BvbnNlKSwgcmV0dXJuIGl0IGFzLWlzLiBXaXRob3V0IHRoaXMsIGNvZGUgdGhhdCBoYXNcbiAgICAvLyBoaXN0b3JpY2FsbHkgd3JhcHBlZCBjdXN0b20tY29tbWFuZCByZXNwb25zZXMgaW5cbiAgICAvLyBgTW9kZWwuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UocmVzcG9uc2UuZmllbGQpYCB3b3VsZCBzcHJlYWQgdGhlIGxpdmVcbiAgICAvLyBtb2RlbCBpbnN0YW5jZSBpbnRvIGEgbmV3IGNvbnN0cnVjdG9yIGNhbGwgYW5kIHByb2R1Y2UgYSBicm9rZW4gbW9kZWxcbiAgICAvLyB3aXRoIGludGVybmFsIHN0YXRlIGtleXMgcHJvbW90ZWQgdG8gYXR0cmlidXRlcy5cbiAgICBpZiAocmVzcG9uc2UgaW5zdGFuY2VvZiB0aGlzKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtJbnN0YW5jZVR5cGU8VD59ICovIChyZXNwb25zZSlcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlbERhdGEgPSB0aGlzLm1vZGVsRGF0YUZyb21SZXNwb25zZShyZXNwb25zZSlcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gbW9kZWxEYXRhLmF0dHJpYnV0ZXNcbiAgICBjb25zdCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzID0gbW9kZWxEYXRhLnByZWxvYWRlZFJlbGF0aW9uc2hpcHNcbiAgICBjb25zdCBhc3NvY2lhdGlvbkNvdW50cyA9IG1vZGVsRGF0YS5hc3NvY2lhdGlvbkNvdW50c1xuICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IG1vZGVsRGF0YS5xdWVyeURhdGFcbiAgICBjb25zdCBhYmlsaXRpZXMgPSBtb2RlbERhdGEuYWJpbGl0aWVzXG4gICAgY29uc3QgYXR0YWNobWVudE93bmVyID0gbW9kZWxEYXRhLmF0dGFjaG1lbnRPd25lclxuICAgIGNvbnN0IHNlbGVjdGVkQXR0cmlidXRlcyA9IG1vZGVsRGF0YS5zZWxlY3RlZEF0dHJpYnV0ZXNcbiAgICBjb25zdCByZWNlaXZlciA9IC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHRoaXMpXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPikgPT4gSW5zdGFuY2VUeXBlPFQ+fSAqLyAocmVjZWl2ZXIpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcyhhdHRyaWJ1dGVzKVxuICAgIG1vZGVsLl9hdHRhY2htZW50T3duZXIgPSBhdHRhY2htZW50T3duZXJcbiAgICBtb2RlbC5fc2VsZWN0ZWRBdHRyaWJ1dGVzID0gc2VsZWN0ZWRBdHRyaWJ1dGVzID8gbmV3IFNldChzZWxlY3RlZEF0dHJpYnV0ZXMpIDogbnVsbFxuXG4gICAgdGhpcy5hcHBseVByZWxvYWRlZFJlbGF0aW9uc2hpcHMobW9kZWwsIHByZWxvYWRlZFJlbGF0aW9uc2hpcHMpXG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXNzb2NpYXRpb25Db3VudHMgfHwge30pKSB7XG4gICAgICBtb2RlbC5fc2V0QXNzb2NpYXRpb25Db3VudChhdHRyaWJ1dGVOYW1lLCBOdW1iZXIodmFsdWUpIHx8IDApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHF1ZXJ5RGF0YSB8fCB7fSkpIHtcbiAgICAgIG1vZGVsLl9zZXRRdWVyeURhdGEobmFtZSwgdmFsdWUpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbYWN0aW9uLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYWJpbGl0aWVzIHx8IHt9KSkge1xuICAgICAgbW9kZWwuX3NldENvbXB1dGVkQWJpbGl0eShhY3Rpb24sIEJvb2xlYW4odmFsdWUpKVxuICAgIH1cblxuICAgIG1vZGVsLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuICAgIG1vZGVsLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzID0gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhtb2RlbC5hdHRyaWJ1dGVzKCkpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIFJlY29yZCBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIFJlc29sdmVkIG1vZGVsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmQoaWQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpbmQoaWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBBdHRyaWJ1dGUgbWF0Y2ggY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+IHwgbnVsbD59IC0gRm91bmQgbW9kZWwgb3IgbnVsbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kQnkoY29uZGl0aW9ucykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZEJ5KGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5IG9yIGZhaWwuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIEF0dHJpYnV0ZSBtYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIEZvdW5kIG1vZGVsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRCeU9yRmFpbChjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kQnlPckZhaWwoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIGFycmF5LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+W10+fSAtIExvYWRlZCBtb2RlbCBpbnN0YW5jZXMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgdG9BcnJheSgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLnRvQXJyYXkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPltdPn0gLSBMb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGxvYWQoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5sb2FkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFsbC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlci5cbiAgICovXG4gIHN0YXRpYyBhbGwoKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2hlcmUuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIFJvb3QtbW9kZWwgd2hlcmUgY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIHdoZXJlIGNvbmRpdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgd2hlcmUoY29uZGl0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkud2hlcmUoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpvaW5zLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBqb2lucyAtIFJlbGF0aW9uc2hpcCBkZXNjcmlwdG9yIGpvaW5zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggam9pbnMuXG4gICAqL1xuICBzdGF0aWMgam9pbnMoam9pbnMpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLmpvaW5zKGpvaW5zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGltaXQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBNYXhpbXVtIG51bWJlciBvZiByZWNvcmRzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggbGltaXQuXG4gICAqL1xuICBzdGF0aWMgbGltaXQodmFsdWUpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLmxpbWl0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb2Zmc2V0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gTnVtYmVyIG9mIHJlY29yZHMgdG8gc2tpcC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIG9mZnNldC5cbiAgICovXG4gIHN0YXRpYyBvZmZzZXQodmFsdWUpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLm9mZnNldCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhZ2UuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge251bWJlcn0gcGFnZU51bWJlciAtIDEtYmFzZWQgcGFnZSBudW1iZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCBwYWdlIGFwcGxpZWQuXG4gICAqL1xuICBzdGF0aWMgcGFnZShwYWdlTnVtYmVyKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5wYWdlKHBhZ2VOdW1iZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwZXIgcGFnZS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIE51bWJlciBvZiByZWNvcmRzIHBlciBwYWdlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggcGFnZSBzaXplLlxuICAgKi9cbiAgc3RhdGljIHBlclBhZ2UodmFsdWUpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLnBlclBhZ2UodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb3VudC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTnVtYmVyIG9mIGxvYWRlZCBtb2RlbCBpbnN0YW5jZXMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY291bnQoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5jb3VudCgpXG4gIH1cblxuICAvKipcbiAgICogQ2xhc3MtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIGFueSByZWNvcmQgb2YgdGhpcyBtb2RlbCBpcyBjcmVhdGVkLlxuICAgKiBTdWJzY3JpYmUtdGltZSBhdXRob3JpemF0aW9uIG9ubHkg4oCUIG9uY2UgYSBzdWJzY3JpcHRpb24gaXNcbiAgICogYWNjZXB0ZWQsIGZ1dHVyZSBgY3JlYXRlYCBldmVudHMgZm9yIHRoaXMgbW9kZWwgYXJlIGRlbGl2ZXJlZFxuICAgKiB3aXRob3V0IHJlLWNoZWNraW5nIHBlci1yZWNvcmQgdmlzaWJpbGl0eS4gUXVlcnkgb3B0aW9ucyBjYW4gc3RpbGxcbiAgICogbmFycm93IHdoaWNoIGV2ZW50cyByZWFjaCB0aGlzIGNhbGxiYWNrLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7aWQ6IHN0cmluZyB8IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLkNvbXBvc2l0ZU1vZGVsUHJpbWFyeUtleVZhbHVlLCBtb2RlbDogRnJvbnRlbmRNb2RlbEJhc2V9KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gRXZlbnQgcXVlcnkgb3IgcmVjb3JkIHByb2plY3Rpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgb25DcmVhdGUoY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHtyZXF1ZXN0Q29udGV4dCwgLi4uZXZlbnRPcHRpb25zUGF5bG9hZH0gPSBmcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZCh0aGlzLCBvcHRpb25zKVxuICAgIGNvbnN0IHN1YiA9IGVuc3VyZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbih0aGlzLCBmcm9udGVuZE1vZGVsRXZlbnRSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2ssIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9XG5cbiAgICByZXR1cm4gYXdhaXQgc3ViLnJlZ2lzdGVyQ2xhc3NDYWxsYmFjayhzdWIuY2xhc3NDcmVhdGVDYWxsYmFja3MsIGVudHJ5KVxuICB9XG5cbiAgLyoqXG4gICAqIENsYXNzLWxldmVsIGhvb2sgZmlyZWQgd2hlbiBhbnkgcmVjb3JkIG9mIHRoaXMgbW9kZWwgaXMgdXBkYXRlZC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZSwgbW9kZWw6IEZyb250ZW5kTW9kZWxCYXNlfSkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHJlY29yZCBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIG9uVXBkYXRlKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHQsIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQodGhpcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24odGhpcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrLCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfVxuXG4gICAgcmV0dXJuIGF3YWl0IHN1Yi5yZWdpc3RlckNsYXNzQ2FsbGJhY2soc3ViLmNsYXNzVXBkYXRlQ2FsbGJhY2tzLCBlbnRyeSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGFzcy1sZXZlbCBob29rIGZpcmVkIHdoZW4gYW55IHJlY29yZCBvZiB0aGlzIG1vZGVsIGlzIGRlc3Ryb3llZC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZX0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBBY2NlcHRlZCBmb3IgQVBJIHN5bW1ldHJ5OyBkZXN0cm95IGV2ZW50cyBjYXJyeSBpZHMgb25seS5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgb25EZXN0cm95KGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBhc3NlcnROb0Rlc3Ryb3lFdmVudEZpbHRlcih0aGlzLCBvcHRpb25zKVxuXG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0fSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKHRoaXMsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKHRoaXMsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBlbnRyeSA9IHtjYWxsYmFja31cblxuICAgIHJldHVybiBhd2FpdCBzdWIucmVnaXN0ZXJDbGFzc0NhbGxiYWNrKHN1Yi5jbGFzc0Rlc3Ryb3lDYWxsYmFja3MsIGVudHJ5KVxuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbmNlLWxldmVsIGhvb2sgZmlyZWQgd2hlbiBUSElTIHJlY29yZCBpcyB1cGRhdGVkLiBUaGVcbiAgICogaW5zdGFuY2UncyBhdHRyaWJ1dGVzIGFyZSBhdXRvLW1lcmdlZCB3aXRoIHRoZSBicm9hZGNhc3QgcGF5bG9hZFxuICAgKiBiZWZvcmUgdGhlIGNhbGxiYWNrIHJ1bnMsIHNvIGNhbGxlcnMgY2FuIHJlYWQgZnJlc2ggdmFsdWVzIHZpYVxuICAgKiBgdGhpcy5zb21lQXR0cigpYCB3aXRob3V0IHJlLWZldGNoaW5nLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7aWQ6IHN0cmluZyB8IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLkNvbXBvc2l0ZU1vZGVsUHJpbWFyeUtleVZhbHVlLCBtb2RlbDogRnJvbnRlbmRNb2RlbEJhc2V9KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gRXZlbnQgcXVlcnkgb3IgcmVjb3JkIHByb2plY3Rpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBhc3luYyBvblVwZGF0ZShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHtyZXF1ZXN0Q29udGV4dCwgLi4uZXZlbnRPcHRpb25zUGF5bG9hZH0gPSBmcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZChNb2RlbENsYXNzLCBvcHRpb25zKVxuICAgIGNvbnN0IHN1YiA9IGVuc3VyZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbihNb2RlbENsYXNzLCBmcm9udGVuZE1vZGVsRXZlbnRSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCkpXG4gICAgY29uc3QgaWRlbnRpdHkgPSB0aGlzLmlzTmV3UmVjb3JkKCkgPyB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpIDogdGhpcy5wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKVxuICAgIGNvbnN0IGlkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGlkZW50aXR5KVxuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrLCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfVxuICAgIGNvbnN0IGxpc3RlbmVyID0gZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIoc3ViLCBpZCwgdGhpcylcblxuICAgIGxpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcy5hZGQoZW50cnkpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3ViLmVuc3VyZVN1YnNjcmliZWQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgKGN1cnJlbnQpID0+IGN1cnJlbnQudXBkYXRlQ2FsbGJhY2tzLmRlbGV0ZShlbnRyeSkpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgKGN1cnJlbnQpID0+IGN1cnJlbnQudXBkYXRlQ2FsbGJhY2tzLmRlbGV0ZShlbnRyeSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbmNlLWxldmVsIGhvb2sgZmlyZWQgd2hlbiBUSElTIHJlY29yZCBpcyBkZXN0cm95ZWQuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWV9KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gQWNjZXB0ZWQgZm9yIEFQSSBzeW1tZXRyeTsgZGVzdHJveSBldmVudHMgY2FycnkgaWRzIG9ubHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgb25EZXN0cm95KGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG5cbiAgICBhc3NlcnROb0Rlc3Ryb3lFdmVudEZpbHRlcihNb2RlbENsYXNzLCBvcHRpb25zKVxuXG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0fSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKE1vZGVsQ2xhc3MsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBpZGVudGl0eSA9IHRoaXMuaXNOZXdSZWNvcmQoKSA/IHRoaXMucHJpbWFyeUtleVZhbHVlKCkgOiB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgY29uc3QgaWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgaWRlbnRpdHkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2t9XG4gICAgY29uc3QgbGlzdGVuZXIgPSBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGlkLCB0aGlzKVxuXG4gICAgbGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcy5hZGQoZW50cnkpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3ViLmVuc3VyZVN1YnNjcmliZWQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgKGN1cnJlbnQpID0+IGN1cnJlbnQuZGVzdHJveUNhbGxiYWNrcy5kZWxldGUoZW50cnkpKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgcmVtb3ZlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJFbnRyeShzdWIsIChjdXJyZW50KSA9PiBjdXJyZW50LmRlc3Ryb3lDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwbHVjay5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7Li4uKHN0cmluZyB8IHN0cmluZ1tdIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pil9IGNvbHVtbnMgLSBQbHVjayBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFBsdWNrZWQgdmFsdWVzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHBsdWNrKC4uLmNvbHVtbnMpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLnBsdWNrKC4uLmNvbHVtbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWFyY2guXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW4gLSBDb2x1bW4gb3IgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7XCJlcVwiIHwgXCJsaWtlXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCI+XCIgfCBcIj49XCIgfCBcIjxcIiB8IFwiPD1cIn0gb3BlcmF0b3IgLSBTZWFyY2ggb3BlcmF0b3IuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU2VhcmNoIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBzZWFyY2ggZmlsdGVyLlxuICAgKi9cbiAgc3RhdGljIHNlYXJjaChwYXRoLCBjb2x1bW4sIG9wZXJhdG9yLCB2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuc2VhcmNoKHBhdGgsIGNvbHVtbiwgb3BlcmF0b3IsIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmFuc2Fjay5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSYW5zYWNrLXN0eWxlIHBhcmFtcyBoYXNoLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBSYW5zYWNrIGZpbHRlcnMgYXBwbGllZC5cbiAgICovXG4gIHN0YXRpYyByYW5zYWNrKHBhcmFtcykge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkucmFuc2FjayhwYXJhbXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzb3J0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHN0cmluZ1tdW10gfCBbc3RyaW5nLCBzdHJpbmddIHwgQXJyYXk8W3N0cmluZywgc3RyaW5nXT4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBzb3J0IC0gU29ydCBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBzb3J0IGRlZmluaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIHNvcnQoc29ydCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuc29ydChzb3J0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3JkZXIuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgc3RyaW5nW11bXSB8IFtzdHJpbmcsIHN0cmluZ10gfCBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHNvcnQgLSBTb3J0IGRlZmluaXRpb24ocykuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlciB3aXRoIHNvcnQgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgb3JkZXIoc29ydCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkub3JkZXIoc29ydClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdyb3VwLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IGdyb3VwIC0gR3JvdXAgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggZ3JvdXAgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgZ3JvdXAoZ3JvdXApIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLmdyb3VwKGdyb3VwKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzdGluY3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFt2YWx1ZV0gLSBXaGV0aGVyIHRvIHJlcXVlc3QgZGlzdGluY3Qgcm93cy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggZGlzdGluY3QgZmxhZy5cbiAgICovXG4gIHN0YXRpYyBkaXN0aW5jdCh2YWx1ZSA9IHRydWUpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLmRpc3RpbmN0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIuXG4gICAqL1xuICBzdGF0aWMgcXVlcnkoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAobmV3IEZyb250ZW5kTW9kZWxRdWVyeSh7bW9kZWxDbGFzczogdGhpc30pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJlbG9hZC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQ+fSBwcmVsb2FkIC0gUHJlbG9hZCBncmFwaC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSB3aXRoIHByZWxvYWQuXG4gICAqL1xuICBzdGF0aWMgcHJlbG9hZChwcmVsb2FkKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAodGhpcy5xdWVyeSgpLnByZWxvYWQocHJlbG9hZCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWxlY3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdIHwgc3RyaW5nPiB8IHN0cmluZyB8IHN0cmluZ1tdfSBzZWxlY3QgLSBNb2RlbC1hd2FyZSBhdHRyaWJ1dGUgc2VsZWN0IG1hcCBvciByb290LW1vZGVsIHNob3J0aGFuZC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSB3aXRoIHNlbGVjdGVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzdGF0aWMgc2VsZWN0KHNlbGVjdCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gKi8gKHRoaXMucXVlcnkoKS5zZWxlY3Qoc2VsZWN0KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdHMgZXh0cmEuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdIHwgc3RyaW5nPiB8IHN0cmluZyB8IHN0cmluZ1tdfSBzZWxlY3QgLSBFeHRyYSBhdHRyaWJ1dGVzIHRvIGxvYWQgaW4gYWRkaXRpb24gdG8gdGhlIGRlZmF1bHRzLCBrZXllZCBieSBtb2RlbCBuYW1lIG9yIHJvb3QtbW9kZWwgc2hvcnRoYW5kLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IHdpdGggZXh0cmEgc2VsZWN0ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIHN0YXRpYyBzZWxlY3RzRXh0cmEoc2VsZWN0KSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAodGhpcy5xdWVyeSgpLnNlbGVjdHNFeHRyYShzZWxlY3QpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmlyc3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBGaXJzdCBtb2RlbCBvciBudWxsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpcnN0KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmlyc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGFzdC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPiB8IG51bGw+fSAtIExhc3QgbW9kZWwgb3IgbnVsbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsYXN0KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkubGFzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG9yIGluaXRpYWxpemUgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIEF0dHJpYnV0ZSBtYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIEV4aXN0aW5nIG9yIGluaXRpYWxpemVkIG1vZGVsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRPckluaXRpYWxpemVCeShjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgY3JlYXRlIGJ5LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBBdHRyaWJ1dGUgbWF0Y2ggY29uZGl0aW9ucy5cbiAgICogQHBhcmFtIHsobW9kZWw6IEluc3RhbmNlVHlwZTxUPikgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWR9IFtjYWxsYmFja10gLSBPcHRpb25hbCBjYWxsYmFjayBiZWZvcmUgc2F2ZSB3aGVuIGNyZWF0ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRXhpc3Rpbmcgb3IgbmV3bHkgY3JlYXRlZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kT3JDcmVhdGVCeShjb25kaXRpb25zLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZE9yQ3JlYXRlQnkoY29uZGl0aW9ucywgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzXG4gICAqIEB0aGlzIHtNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDcmVhdGVBdHRyaWJ1dGVzRm9yPEluc3RhbmNlVHlwZTxNb2RlbENsYXNzPj59IFthdHRyaWJ1dGVzXSAtIEluaXRpYWwgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+Pn0gLSBQZXJzaXN0ZWQgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY3JlYXRlKGF0dHJpYnV0ZXMpIHtcbiAgICBjb25zdCByZWNlaXZlciA9IC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHRoaXMpXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogRnJvbnRlbmRNb2RlbENyZWF0ZUF0dHJpYnV0ZXNGb3I8SW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+PikgPT4gSW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+fSAqLyAocmVjZWl2ZXIpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcyhhdHRyaWJ1dGVzKVxuXG4gICAgYXdhaXQgbW9kZWwuc2F2ZSgpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2VydCBmaW5kIGJ5IGNvbmRpdGlvbnMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gZmluZEJ5IGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFzc2VydEZpbmRCeUNvbmRpdGlvbnMoY29uZGl0aW9ucykge1xuICAgIGFzc2VydEZpbmRCeUNvbmRpdGlvbnNTaGFwZShjb25kaXRpb25zKVxuXG4gICAgT2JqZWN0LmtleXMoY29uZGl0aW9ucykuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgICBhc3NlcnREZWZpbmVkRmluZEJ5Q29uZGl0aW9uVmFsdWUoY29uZGl0aW9uc1trZXldLCBrZXkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hdGNoZXMgZmluZCBieSBjb25kaXRpb25zLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIENhbmRpZGF0ZSBtb2RlbC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBNYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBtb2RlbCBtYXRjaGVzIGFsbCBjb25kaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIG1hdGNoZXNGaW5kQnlDb25kaXRpb25zKG1vZGVsLCBjb25kaXRpb25zKSB7XG4gICAgY29uc3QgbW9kZWxBdHRyaWJ1dGVzID0gbW9kZWwuYXR0cmlidXRlcygpXG5cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhjb25kaXRpb25zKSkge1xuICAgICAgY29uc3QgZXhwZWN0ZWRWYWx1ZSA9IGNvbmRpdGlvbnNba2V5XVxuICAgICAgY29uc3QgYWN0dWFsVmFsdWUgPSBtb2RlbEF0dHJpYnV0ZXNba2V5XVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShleHBlY3RlZFZhbHVlKSkge1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhY3R1YWxWYWx1ZSkpIHtcbiAgICAgICAgICBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKCFleHBlY3RlZFZhbHVlLnNvbWUoKGVudHJ5KSA9PiB0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZW50cnkpKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKCF0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgY29uZGl0aW9uIHZhbHVlIG1hdGNoZXMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFjdHVhbFZhbHVlIC0gQWN0dWFsIG1vZGVsIHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBleHBlY3RlZFZhbHVlIC0gRXhwZWN0ZWQgZmluZCBjb25kaXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWVzIG1hdGNoLlxuICAgKi9cbiAgc3RhdGljIGZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkge1xuICAgIGlmIChleHBlY3RlZFZhbHVlID09PSBudWxsKSB7XG4gICAgICByZXR1cm4gYWN0dWFsVmFsdWUgPT09IG51bGxcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShleHBlY3RlZFZhbHVlKSkge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGFjdHVhbFZhbHVlKSkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgaWYgKGFjdHVhbFZhbHVlLmxlbmd0aCAhPT0gZXhwZWN0ZWRWYWx1ZS5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBleHBlY3RlZFZhbHVlLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgICBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlW2luZGV4XSwgZXhwZWN0ZWRWYWx1ZVtpbmRleF0pKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBpZiAoZXhwZWN0ZWRWYWx1ZSAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgaWYgKCFhY3R1YWxWYWx1ZSB8fCB0eXBlb2YgYWN0dWFsVmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShhY3R1YWxWYWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFjdHVhbE9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoYWN0dWFsVmFsdWUpXG4gICAgICBjb25zdCBleHBlY3RlZE9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZXhwZWN0ZWRWYWx1ZSlcbiAgICAgIGNvbnN0IGFjdHVhbEtleXMgPSBPYmplY3Qua2V5cyhhY3R1YWxPYmplY3QpXG4gICAgICBjb25zdCBleHBlY3RlZEtleXMgPSBPYmplY3Qua2V5cyhleHBlY3RlZE9iamVjdClcblxuICAgICAgaWYgKGFjdHVhbEtleXMubGVuZ3RoICE9PSBleHBlY3RlZEtleXMubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBleHBlY3RlZEtleXMpIHtcbiAgICAgICAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoYWN0dWFsT2JqZWN0LCBrZXkpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbE9iamVjdFtrZXldLCBleHBlY3RlZE9iamVjdFtrZXldKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgaWYgKGFjdHVhbFZhbHVlID09PSBleHBlY3RlZFZhbHVlKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmZpbmRCeVByaW1pdGl2ZVZhbHVlc01hdGNoKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieSBwcmltaXRpdmUgdmFsdWVzIG1hdGNoLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhY3R1YWxWYWx1ZSAtIEFjdHVhbCBtb2RlbCB2YWx1ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXhwZWN0ZWRWYWx1ZSAtIEV4cGVjdGVkIGZpbmQgY29uZGl0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHByaW1pdGl2ZSB2YWx1ZXMgbWF0Y2ggYWZ0ZXIgc2FmZSBjb2VyY2lvbi5cbiAgICovXG4gIHN0YXRpYyBmaW5kQnlQcmltaXRpdmVWYWx1ZXNNYXRjaChhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkge1xuICAgIGlmIChhY3R1YWxWYWx1ZSBpbnN0YW5jZW9mIERhdGUgJiYgdHlwZW9mIGV4cGVjdGVkVmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFeHBlY3RlZFZhbHVlID0gbm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlKGV4cGVjdGVkVmFsdWUsIHt0aW1lWm9uZTogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKCl9KVxuXG4gICAgICBpZiAobm9ybWFsaXplZEV4cGVjdGVkVmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAgIHJldHVybiBhY3R1YWxWYWx1ZS50b0lTT1N0cmluZygpID09PSBub3JtYWxpemVkRXhwZWN0ZWRWYWx1ZS50b0lTT1N0cmluZygpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhY3R1YWxWYWx1ZS50b0lTT1N0cmluZygpID09PSBleHBlY3RlZFZhbHVlXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhY3R1YWxWYWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiBleHBlY3RlZFZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgcmV0dXJuIGFjdHVhbFZhbHVlID09PSBleHBlY3RlZFZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICB9XG5cbiAgICBpZiAoYWN0dWFsVmFsdWUgaW5zdGFuY2VvZiBEYXRlICYmIGV4cGVjdGVkVmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICByZXR1cm4gYWN0dWFsVmFsdWUudG9JU09TdHJpbmcoKSA9PT0gZXhwZWN0ZWRWYWx1ZS50b0lTT1N0cmluZygpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhY3R1YWxWYWx1ZSA9PT0gXCJudW1iZXJcIiAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIHRoaXMuZmluZEJ5TnVtZXJpY1N0cmluZ01hdGNoZXNOdW1iZXIoZXhwZWN0ZWRWYWx1ZSwgYWN0dWFsVmFsdWUpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhY3R1YWxWYWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJudW1iZXJcIikge1xuICAgICAgcmV0dXJuIHRoaXMuZmluZEJ5TnVtZXJpY1N0cmluZ01hdGNoZXNOdW1iZXIoYWN0dWFsVmFsdWUsIGV4cGVjdGVkVmFsdWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5IG51bWVyaWMgc3RyaW5nIG1hdGNoZXMgbnVtYmVyLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gbnVtZXJpY1N0cmluZyAtIE51bWVyaWMgc3RyaW5nIHZhbHVlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZXhwZWN0ZWROdW1iZXIgLSBOdW1iZXIgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWVzIHJlcHJlc2VudCB0aGUgc2FtZSBudW1iZXIuXG4gICAqL1xuICBzdGF0aWMgZmluZEJ5TnVtZXJpY1N0cmluZ01hdGNoZXNOdW1iZXIobnVtZXJpY1N0cmluZywgZXhwZWN0ZWROdW1iZXIpIHtcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShleHBlY3RlZE51bWJlcikpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGlmICghL14tP1xcZCsoPzpcXC5cXGQrKT8kLy50ZXN0KG51bWVyaWNTdHJpbmcpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gTnVtYmVyKG51bWVyaWNTdHJpbmcpID09PSBleHBlY3RlZE51bWJlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlLlxuICAgKiBAcGFyYW0ge1VwZGF0ZUF0dHJpYnV0ZXN9IFtuZXdBdHRyaWJ1dGVzXSAtIE5ldyB2YWx1ZXMgdG8gYXNzaWduIGJlZm9yZSB1cGRhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHRoaXM+fSAtIFVwZGF0ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyB1cGRhdGUobmV3QXR0cmlidXRlcykge1xuICAgIGlmIChuZXdBdHRyaWJ1dGVzKSB0aGlzLmFzc2lnbkF0dHJpYnV0ZXMobmV3QXR0cmlidXRlcylcblxuICAgIHJldHVybiAvKiogQHR5cGUge3RoaXN9ICovIChhd2FpdCB0aGlzLnNhdmUoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXR0YWNobWVudElucHV0IC0gQXR0YWNobWVudCBpbnB1dCBvciBuYW1lZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYXR0YWNoZWQuXG4gICAqL1xuICBhc3luYyBhdHRhY2goYXR0YWNobWVudElucHV0KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9ucyA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb25zKClcbiAgICBjb25zdCBhdHRhY2htZW50TmFtZXMgPSBPYmplY3Qua2V5cyhhdHRhY2htZW50RGVmaW5pdGlvbnMpXG4gICAgbGV0IGF0dGFjaG1lbnROYW1lID0gYXR0YWNobWVudE5hbWVzWzBdXG4gICAgbGV0IGFjdHVhbEF0dGFjaG1lbnRJbnB1dCA9IGF0dGFjaG1lbnRJbnB1dFxuXG4gICAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChhdHRhY2htZW50SW5wdXQpKSB7XG4gICAgICBpZiAoXCJmaWxlXCIgaW4gYXR0YWNobWVudElucHV0ICYmIGF0dGFjaG1lbnREZWZpbml0aW9ucy5maWxlKSB7XG4gICAgICAgIGF0dGFjaG1lbnROYW1lID0gXCJmaWxlXCJcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBjYW5kaWRhdGVOYW1lIG9mIGF0dGFjaG1lbnROYW1lcykge1xuICAgICAgICBpZiAoY2FuZGlkYXRlTmFtZSBpbiBhdHRhY2htZW50SW5wdXQpIHtcbiAgICAgICAgICBhdHRhY2htZW50TmFtZSA9IGNhbmRpZGF0ZU5hbWVcbiAgICAgICAgICBhY3R1YWxBdHRhY2htZW50SW5wdXQgPSBhdHRhY2htZW50SW5wdXRbY2FuZGlkYXRlTmFtZV1cbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFhdHRhY2htZW50TmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBhdHRhY2htZW50IGRlZmluaXRpb25zIG9uICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKS5hdHRhY2goYWN0dWFsQXR0YWNobWVudElucHV0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2F2ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dGhpcz59IC0gU2F2ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBzYXZlKCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBpc05ldyA9IHRoaXMuaXNOZXdSZWNvcmQoKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IHByZXZpb3VzSWRlbnRpdHkgPSBpc05ldyA/IG51bGwgOiB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgY29uc3QgbGlzdGVuZXJJZGVudGl0eUJlZm9yZVNhdmUgPSBpc05ld1xuICAgICAgJiYgQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KVxuICAgICAgJiYgcHJpbWFyeUtleS5ldmVyeSgoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgICBjb25zdCB2YWx1ZSA9IHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cblxuICAgICAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIlxuICAgICAgfSlcbiAgICAgID8gdGhpcy5wcmltYXJ5S2V5VmFsdWUoKVxuICAgICAgOiBwcmV2aW91c0lkZW50aXR5XG4gICAgY29uc3QgY29tbWFuZFR5cGUgPSBpc05ldyA/IFwiY3JlYXRlXCIgOiBcInVwZGF0ZVwiXG4gICAgLyoqXG4gICAgICogUGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBhdHRyaWJ1dGVzOiB0aGlzLl9jaGFuZ2VkQXR0cmlidXRlc0ZvclNhdmUoKVxuICAgIH1cblxuICAgIGlmICghaXNOZXcpIHtcbiAgICAgIHBheWxvYWQuaWQgPSB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgfVxuXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMuX2J1aWxkTmVzdGVkQXR0cmlidXRlc1BheWxvYWQoKVxuXG4gICAgaWYgKG5lc3RlZEF0dHJpYnV0ZXMgJiYgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykubGVuZ3RoID4gMCkge1xuICAgICAgcGF5bG9hZC5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuICAgIH1cblxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gYXdhaXQgdGhpcy5fYnVpbGRBdHRhY2htZW50c1BheWxvYWQoKVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwKSB7XG4gICAgICBwYXlsb2FkLmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICB9XG5cbiAgICBpZiAoc2hvdWxkUXVldWVGcm9udGVuZE1vZGVsT3BlcmF0aW9uT2ZmbGluZShNb2RlbENsYXNzLCBjb21tYW5kVHlwZSkpIHtcbiAgICAgIGNvbnN0IG9mZmxpbmVBdHRyaWJ1dGVzID0gey4uLnBheWxvYWQuYXR0cmlidXRlc31cbiAgICAgIGxldCBjbGllbnRNdXRhdGlvbklkXG5cbiAgICAgIGlmIChpc05ldykge1xuICAgICAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgT2ZmbGluZSBjcmVhdGUgZm9yICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICAgIGNvbnN0IGN1cnJlbnRQcmltYXJ5S2V5ID0gdGhpcy5yZWFkQXR0cmlidXRlKHByaW1hcnlLZXkpXG5cbiAgICAgICAgaWYgKGN1cnJlbnRQcmltYXJ5S2V5ID09PSB1bmRlZmluZWQgfHwgY3VycmVudFByaW1hcnlLZXkgPT09IG51bGwpIHtcbiAgICAgICAgICBjbGllbnRNdXRhdGlvbklkID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5vZmZsaW5lU3luYz8uY2xpZW50TXV0YXRpb25JZFxuICAgICAgICAgICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jLmNsaWVudE11dGF0aW9uSWQoKVxuICAgICAgICAgICAgOiBmcm9udGVuZE1vZGVsT2ZmbGluZU11dGF0aW9uSWQoKVxuICAgICAgICAgIHRoaXMuc2V0QXR0cmlidXRlKHByaW1hcnlLZXksIGNsaWVudE11dGF0aW9uSWQpXG4gICAgICAgICAgb2ZmbGluZUF0dHJpYnV0ZXNbcHJpbWFyeUtleV0gPSBjbGllbnRNdXRhdGlvbklkXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGBPZmZsaW5lIHVwZGF0ZSBmb3IgJHtNb2RlbENsYXNzLm5hbWV9YClcblxuICAgICAgICBvZmZsaW5lQXR0cmlidXRlc1twcmltYXJ5S2V5XSA9IHBheWxvYWQuaWRcbiAgICAgIH1cblxuICAgICAgaWYgKHBheWxvYWQubmVzdGVkQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkIHx8IHBheWxvYWQuYXR0YWNobWVudHMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE9mZmxpbmUgc3luYyBmb3IgJHtNb2RlbENsYXNzLm5hbWV9IGRvZXMgbm90IHN1cHBvcnQgbmVzdGVkIGF0dHJpYnV0ZXMgb3IgYXR0YWNobWVudHMgeWV0YClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgcXVldWVGcm9udGVuZE1vZGVsTXV0YXRpb25PZmZsaW5lKHtcbiAgICAgICAgYXR0cmlidXRlczogb2ZmbGluZUF0dHJpYnV0ZXMsXG4gICAgICAgIGNsaWVudE11dGF0aW9uSWQsXG4gICAgICAgIE1vZGVsQ2xhc3MsXG4gICAgICAgIG9wZXJhdGlvbjogY29tbWFuZFR5cGVcbiAgICAgIH0pXG4gICAgICB0aGlzLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuICAgICAgdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXModGhpcy5hdHRyaWJ1dGVzKCkpXG4gICAgICB0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgICB0aGlzLl9jbGVhclBlbmRpbmdBdHRhY2htZW50cygpXG5cbiAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgY29uc3QgcmVtb3ZlVGVtcG9yYXJ5TGlzdGVuZXJBbGlhc2VzID0gcHJldmlvdXNJZGVudGl0eSA9PT0gbnVsbFxuICAgICAgPyAoKSA9PiB7fVxuICAgICAgOiBhbGlhc0Zyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyhNb2RlbENsYXNzLCB0aGlzLCBwcmV2aW91c0lkZW50aXR5LCB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIGxldCByZXNwb25zZVxuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3BvbnNlID0gYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChjb21tYW5kVHlwZSwgcGF5bG9hZClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmVtb3ZlVGVtcG9yYXJ5TGlzdGVuZXJBbGlhc2VzKClcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmVtb3ZlVGVtcG9yYXJ5TGlzdGVuZXJBbGlhc2VzKClcblxuICAgIGNvbnN0IG1vZGVsRGF0YSA9IE1vZGVsQ2xhc3MubW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuXG4gICAgdGhpcy5hc3NpZ25BdHRyaWJ1dGVzKG1vZGVsRGF0YS5hdHRyaWJ1dGVzKVxuICAgIHRoaXMuX2F0dGFjaG1lbnRPd25lciA9IG1vZGVsRGF0YS5hdHRhY2htZW50T3duZXJcbiAgICB0aGlzLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuXG4gICAgaWYgKGxpc3RlbmVySWRlbnRpdHlCZWZvcmVTYXZlICE9PSBudWxsKSB7XG4gICAgICByZWtleUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyhNb2RlbENsYXNzLCB0aGlzLCBsaXN0ZW5lcklkZW50aXR5QmVmb3JlU2F2ZSwgdGhpcy5wcmltYXJ5S2V5VmFsdWUoKSlcbiAgICB9XG5cbiAgICB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzID0gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyh0aGlzLmF0dHJpYnV0ZXMoKSlcbiAgICB0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgdGhpcy5fY2xlYXJQZW5kaW5nQXR0YWNobWVudHMoKVxuXG4gICAgdGhpcy5fcmVjb25jaWxlTmVzdGVkQXR0cmlidXRlc0Zyb21SZXNwb25zZShyZXNwb25zZSlcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc3Vic2V0IG9mIGBfYXR0cmlidXRlc2Agd2hvc2UgdmFsdWUgaGFzIGRpdmVyZ2VkIGZyb21cbiAgICogYF9wZXJzaXN0ZWRBdHRyaWJ1dGVzYC4gVXNlZCBieSBgc2F2ZSgpYCBzbyB0aGUgc2VydmVyIHJlY2VpdmVzIG9ubHkgdGhlXG4gICAqIGZpZWxkcyB0aGUgY2FsbGVyIGFjdHVhbGx5IGNoYW5nZWQg4oCUIGF2b2lkaW5nIHN0cmljdCBwZXJtaXQgcmVqZWN0aW9ucyBvblxuICAgKiBmcmFtZXdvcmstbWFuYWdlZCBmaWVsZHMgbGlrZSBgaWRgLCBgY3JlYXRlZEF0YCwgYHVwZGF0ZWRBdGAsIG9yIG93bmVyXG4gICAqIGZvcmVpZ24ga2V5cyB0aGF0IHRoZSByZXNvdXJjZSBuZXZlciBsaXN0cyBpbiBgcGVybWl0dGVkUGFyYW1zYC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59IC0gQ2hhbmdlZCBhdHRyaWJ1dGVzIGhhc2guXG4gICAqL1xuICBfY2hhbmdlZEF0dHJpYnV0ZXNGb3JTYXZlKCkge1xuICAgIC8qKlxuICAgICAqIENoYW5nZWQgYXR0cmlidXRlcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi9cbiAgICBjb25zdCBjaGFuZ2VkQXR0cmlidXRlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCBbcHJldmlvdXNWYWx1ZSwgY3VycmVudFZhbHVlXV0gb2YgT2JqZWN0LmVudHJpZXModGhpcy5jaGFuZ2VzKCkpKSB7XG4gICAgICBpZiAodGhpcy5pc05ld1JlY29yZCgpICYmIHByZXZpb3VzVmFsdWUgPT09IHVuZGVmaW5lZCAmJiBjdXJyZW50VmFsdWUgPT09IG51bGwpIGNvbnRpbnVlXG5cbiAgICAgIGNoYW5nZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gY3VycmVudFZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYW5nZWRBdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogTWFya3MgdGhlIGN1cnJlbnQgdmFsdWUgZm9yIGFuIGF0dHJpYnV0ZSBhcyBhbHJlYWR5IHBlcnNpc3RlZCBzbyB0aGUgbmV4dFxuICAgKiBzYXZlIGRvZXMgbm90IHNlbmQgaXQgdW5sZXNzIHRoZSBjYWxsZXIgY2hhbmdlcyBpdCBhZ2Fpbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgdG8gbWFyayB1bmNoYW5nZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgbWFya0F0dHJpYnV0ZVVuY2hhbmdlZChhdHRyaWJ1dGVOYW1lKSB7XG4gICAgdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMoe3ZhbHVlOiB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdfSkudmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlc3Ryb3kuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZGVzdHJveWVkIG9uIGJhY2tlbmQuXG4gICAqL1xuICBhc3luYyBkZXN0cm95KCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBpZCA9IHRoaXMuaXNOZXdSZWNvcmQoKSA/IHRoaXMucHJpbWFyeUtleVZhbHVlKCkgOiB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG5cbiAgICBpZiAoc2hvdWxkUXVldWVGcm9udGVuZE1vZGVsT3BlcmF0aW9uT2ZmbGluZShNb2RlbENsYXNzLCBcImRlc3Ryb3lcIikpIHtcbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGBPZmZsaW5lIGRlc3Ryb3kgZm9yICR7TW9kZWxDbGFzcy5uYW1lfWApXG5cbiAgICAgIGF3YWl0IHF1ZXVlRnJvbnRlbmRNb2RlbE11dGF0aW9uT2ZmbGluZSh7XG4gICAgICAgIGF0dHJpYnV0ZXM6IHtbcHJpbWFyeUtleV06IGlkfSxcbiAgICAgICAgTW9kZWxDbGFzcyxcbiAgICAgICAgb3BlcmF0aW9uOiBcImRlc3Ryb3lcIlxuICAgICAgfSlcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcImRlc3Ryb3lcIiwge1xuICAgICAgaWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgYXR0YWNobWVudCBwYXlsb2FkIHF1ZXVlZCBvbiB0aGlzIG1vZGVsIGZvciB0aGUgbmV4dCBzYXZlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBBdHRhY2htZW50IHBheWxvYWQga2V5ZWQgYnkgYXR0YWNobWVudCBuYW1lLlxuICAgKi9cbiAgYXN5bmMgX2J1aWxkQXR0YWNobWVudHNQYXlsb2FkKCkge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7fVxuXG4gICAgZm9yIChjb25zdCBhdHRhY2htZW50TmFtZSBvZiBPYmplY3Qua2V5cyh0aGlzLl9hdHRhY2htZW50cykpIHtcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnRQYXlsb2FkID0gYXdhaXQgdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdLnBlbmRpbmdBdHRhY2htZW50c1BheWxvYWQoKVxuXG4gICAgICBpZiAoYXR0YWNobWVudFBheWxvYWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBwYXlsb2FkW2F0dGFjaG1lbnROYW1lXSA9IGF0dGFjaG1lbnRQYXlsb2FkXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBheWxvYWRcbiAgfVxuXG4gIC8qKiBDbGVhcnMgcXVldWVkIGF0dGFjaG1lbnQgaW5wdXRzIGFmdGVyIGEgc3VjY2Vzc2Z1bCBzYXZlLiAqL1xuICBfY2xlYXJQZW5kaW5nQXR0YWNobWVudHMoKSB7XG4gICAgZm9yIChjb25zdCBhdHRhY2htZW50TmFtZSBvZiBPYmplY3Qua2V5cyh0aGlzLl9hdHRhY2htZW50cykpIHtcbiAgICAgIHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXS5jbGVhclBlbmRpbmdBdHRhY2htZW50cygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFdhbGtzIHJlbGF0aW9uc2hpcHMgZGVjbGFyZWQgaW4gdGhpcyByZXNvdXJjZSdzIGBuZXN0ZWRBdHRyaWJ1dGVzYCBjb25maWdcbiAgICogYW5kIGJ1aWxkcyB0aGUgcGVyLXJlbGF0aW9uc2hpcCBwYXlsb2FkIG9mIGRpcnR5IGNoaWxkcmVuIGZvciBhIHBhcmVudCBzYXZlLlxuICAgKlxuICAgKiBJbmNsdWRlZCBjaGlsZHJlbjpcbiAgICogICAtIG5ldyByZWNvcmRzIChpc05ld1JlY29yZCgpKSDihpIgY3JlYXRlIGVudHJ5IHdpdGggYXR0cmlidXRlc1xuICAgKiAgIC0gcmVjb3JkcyBtYXJrZWQgZm9yIGRlc3RydWN0aW9uIChtYXJrZWRGb3JEZXN0cnVjdGlvbigpKSDihpIgZGVzdHJveSBlbnRyeVxuICAgKiAgIC0gcmVjb3JkcyB3aXRoIGNoYW5nZWQgYXR0cmlidXRlcyAoaXNDaGFuZ2VkKCkpIOKGkiB1cGRhdGUgZW50cnkgd2l0aCBhdHRyaWJ1dGVzXG4gICAqICAgLSByZWNvcmRzIHdpdGggZGlydHkgZGVzY2VuZGFudHMgaW4gdGhlaXIgb3duIG5lc3RlZEF0dHJpYnV0ZXMg4oaSIHJlY3Vyc2VcbiAgICpcbiAgICogTG9hZGVkIGJ1dCB1bnRvdWNoZWQgcmVjb3JkcyBhcmUgb21pdHRlZCBzbyBuZXN0ZWQgc2F2ZSBwcmVzZXJ2ZXMgUmFpbHMtc3R5bGVcbiAgICogXCJjaGlsZHJlbiBub3QgcmVmZXJlbmNlZCBpbiBwYXlsb2FkIGFyZSBsZWZ0IGFsb25lXCIgc2VtYW50aWNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pj59IC0gUGVyLXJlbGF0aW9uc2hpcCBsaXN0IG9mIG5lc3RlZC1hdHRyaWJ1dGUgZW50cmllcy5cbiAgICovXG4gIGFzeW5jIF9idWlsZE5lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkKCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKVxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXNDb25maWcgPSByZXNvdXJjZUNvbmZpZz8ubmVzdGVkQXR0cmlidXRlc1xuXG4gICAgaWYgKCFuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnKSByZXR1cm4ge31cblxuICAgIC8qKlxuICAgICAqIFBheWxvYWQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+fSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7fVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXNDb25maWcpKSB7XG4gICAgICAvKiogQHR5cGUge0FycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgICBjb25zdCBlbnRyaWVzID0gW11cbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuX3JlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgaWYgKHJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwICYmIEFycmF5LmlzQXJyYXkocmVsYXRpb25zaGlwLl9sb2FkZWRWYWx1ZSkpIHtcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiByZWxhdGlvbnNoaXAuX2xvYWRlZFZhbHVlKSB7XG4gICAgICAgICAgY29uc3QgY2hpbGRFbnRyeSA9IGF3YWl0IGNoaWxkLl9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlGb3JQYXJlbnRTYXZlKClcblxuICAgICAgICAgIGlmIChjaGlsZEVudHJ5KSBlbnRyaWVzLnB1c2goY2hpbGRFbnRyeSlcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChyZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXAgJiYgcmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSB7XG4gICAgICAgIGNvbnN0IGNoaWxkID0gcmVsYXRpb25zaGlwLmxvYWRlZCgpXG5cbiAgICAgICAgaWYgKGNoaWxkIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEJhc2UpIHtcbiAgICAgICAgICBjb25zdCBjaGlsZEVudHJ5ID0gYXdhaXQgY2hpbGQuX25lc3RlZEF0dHJpYnV0ZXNFbnRyeUZvclBhcmVudFNhdmUoKVxuXG4gICAgICAgICAgaWYgKGNoaWxkRW50cnkpIGVudHJpZXMucHVzaChjaGlsZEVudHJ5KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwodGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXMsIHJlbGF0aW9uc2hpcE5hbWUpKSB7XG4gICAgICAgIGVudHJpZXMucHVzaChcbiAgICAgICAgICAuLi5hd2FpdCB0aGlzLl9uZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKFxuICAgICAgICAgICAgTW9kZWxDbGFzcyxcbiAgICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgICB0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlc1tyZWxhdGlvbnNoaXBOYW1lXVxuICAgICAgICAgIClcbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICBpZiAoZW50cmllcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHBheWxvYWRbcmVsYXRpb25zaGlwTmFtZV0gPSBlbnRyaWVzXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBheWxvYWRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIHBheWxvYWQgZW50cnkgZm9yIHRoaXMgY2hpbGQgd2hlbiB3YWxrZWQgYnkgYSBwYXJlbnQnc1xuICAgKiBgX2J1aWxkTmVzdGVkQXR0cmlidXRlc1BheWxvYWRgLiBSZXR1cm5zIGBudWxsYCB3aGVuIHRoZSBjaGlsZCBoYXMgbm9cbiAgICogZGlydHkgc3RhdGUgYW5kIG5vIGRpcnR5IGRlc2NlbmRhbnRzLCBzbyB0aGUgcGFyZW50IGNhbiBvbWl0IGl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsPn0gLSBOZXN0ZWQtYXR0cmlidXRlIGVudHJ5IG9yIG51bGwgaWYgY2xlYW4uXG4gICAqL1xuICBhc3luYyBfbmVzdGVkQXR0cmlidXRlc0VudHJ5Rm9yUGFyZW50U2F2ZSgpIHtcbiAgICBpZiAodGhpcy5tYXJrZWRGb3JEZXN0cnVjdGlvbigpKSB7XG4gICAgICBpZiAodGhpcy5pc05ld1JlY29yZCgpKSByZXR1cm4gbnVsbFxuICAgICAgcmV0dXJuIHtpZDogdGhpcy5wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKSwgX2Rlc3Ryb3k6IHRydWV9XG4gICAgfVxuXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMuX2J1aWxkTmVzdGVkQXR0cmlidXRlc1BheWxvYWQoKVxuICAgIGNvbnN0IGhhc05lc3RlZERpcnR5ID0gT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykubGVuZ3RoID4gMFxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gYXdhaXQgdGhpcy5fYnVpbGRBdHRhY2htZW50c1BheWxvYWQoKVxuICAgIGNvbnN0IGhhc0F0dGFjaG1lbnRzID0gT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDBcblxuICAgIGlmICh0aGlzLmlzTmV3UmVjb3JkKCkpIHtcbiAgICAgIC8qKlxuICAgICAgICogRW50cnkuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3QgZW50cnkgPSB7fVxuICAgICAgY29uc3QgYXR0cmlidXRlcyA9IHRoaXMuX2NoYW5nZWRBdHRyaWJ1dGVzRm9yU2F2ZSgpXG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSBlbnRyeS5hdHRyaWJ1dGVzID0gYXR0cmlidXRlc1xuICAgICAgaWYgKGhhc0F0dGFjaG1lbnRzKSBlbnRyeS5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgICBpZiAoaGFzTmVzdGVkRGlydHkpIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgPSBuZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICAgIHJldHVybiBlbnRyeVxuICAgIH1cblxuICAgIGlmICghdGhpcy5pc0NoYW5nZWQoKSAmJiAhaGFzTmVzdGVkRGlydHkgJiYgIWhhc0F0dGFjaG1lbnRzKSByZXR1cm4gbnVsbFxuXG4gICAgLyoqXG4gICAgICogRW50cnkuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBlbnRyeSA9IHtpZDogdGhpcy5wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKX1cblxuICAgIGlmICh0aGlzLmlzQ2hhbmdlZCgpKSBlbnRyeS5hdHRyaWJ1dGVzID0gdGhpcy5fY2hhbmdlZEF0dHJpYnV0ZXNGb3JTYXZlKClcbiAgICBpZiAoaGFzQXR0YWNobWVudHMpIGVudHJ5LmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICBpZiAoaGFzTmVzdGVkRGlydHkpIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgPSBuZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICByZXR1cm4gZW50cnlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgbmVzdGVkIGVudHJpZXMgZnJvbSBhIFJhaWxzLXN0eWxlIHN1Ym1pdHRlZCBgKkF0dHJpYnV0ZXNgIHZhbHVlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIFBhcmVudCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBOZXN0ZWQgcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU3VibWl0dGVkIG5lc3RlZCBhdHRyaWJ1dGVzIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pn0gTmVzdGVkIGVudHJpZXMgZm9yIHRoZSB0cmFuc3BvcnQgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIF9uZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKE1vZGVsQ2xhc3MsIHJlbGF0aW9uc2hpcE5hbWUsIHZhbHVlKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwRGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKVxuICAgIGNvbnN0IFRhcmdldE1vZGVsQ2xhc3MgPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcE1vZGVsQ2xhc3MocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmICghcmVsYXRpb25zaGlwRGVmaW5pdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG5lc3RlZCByZWxhdGlvbnNoaXA6ICR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFUYXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyBjb25maWd1cmVkIGZvciAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcFR5cGVJc0NvbGxlY3Rpb24ocmVsYXRpb25zaGlwRGVmaW5pdGlvbi50eXBlKSkge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9QXR0cmlidXRlcyBtdXN0IGJlIGFuIGFycmF5YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICB2YWx1ZS5tYXAoYXN5bmMgKGVudHJ5KSA9PiBhd2FpdCB0aGlzLl9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoVGFyZ2V0TW9kZWxDbGFzcywgZW50cnkpKVxuICAgICAgKVxuICAgIH1cblxuICAgIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gW11cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1BdHRyaWJ1dGVzIG11c3QgYmUgYW4gb2JqZWN0YClcbiAgICB9XG5cbiAgICByZXR1cm4gW2F3YWl0IHRoaXMuX25lc3RlZEF0dHJpYnV0ZXNFbnRyeVBheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShUYXJnZXRNb2RlbENsYXNzLCB2YWx1ZSldXG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgb25lIHN1Ym1pdHRlZCBSYWlscy1zdHlsZSBuZXN0ZWQgYXR0cmlidXRlcyBvYmplY3QgaW50byB0cmFuc3BvcnQgcGF5bG9hZCBzaGFwZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBOZXN0ZWQgY2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHN1Ym1pdHRlZEVudHJ5IC0gU3VibWl0dGVkIG5lc3RlZCBhdHRyaWJ1dGVzIGVudHJ5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBUcmFuc3BvcnQgbmVzdGVkLWF0dHJpYnV0ZXMgZW50cnkuXG4gICAqL1xuICBhc3luYyBfbmVzdGVkQXR0cmlidXRlc0VudHJ5UGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKE1vZGVsQ2xhc3MsIHN1Ym1pdHRlZEVudHJ5KSB7XG4gICAgaWYgKCFmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzUGxhaW5PYmplY3Qoc3VibWl0dGVkRW50cnkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7TW9kZWxDbGFzcy5uYW1lfSBuZXN0ZWQgYXR0cmlidXRlcyBlbnRyaWVzIG11c3QgYmUgb2JqZWN0c2ApXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgZW50cnkgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+fSAqL1xuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHN1Ym1pdHRlZEVudHJ5KSkge1xuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiaWRcIiB8fCBhdHRyaWJ1dGVOYW1lID09PSBcIl9kZXN0cm95XCIpIHtcbiAgICAgICAgZW50cnlbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lID0gTW9kZWxDbGFzcy5uZXN0ZWRBdHRyaWJ1dGVzUmVsYXRpb25zaGlwTmFtZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgICBpZiAobmVzdGVkUmVsYXRpb25zaGlwTmFtZSkge1xuICAgICAgICBuZXN0ZWRBdHRyaWJ1dGVzW25lc3RlZFJlbGF0aW9uc2hpcE5hbWVdID0gYXdhaXQgdGhpcy5fbmVzdGVkQXR0cmlidXRlc1BheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShcbiAgICAgICAgICBNb2RlbENsYXNzLFxuICAgICAgICAgIG5lc3RlZFJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgdmFsdWVcbiAgICAgICAgKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbihhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgICBhdHRhY2htZW50c1thdHRyaWJ1dGVOYW1lXSA9IGF3YWl0IHRoaXMuX2F0dGFjaG1lbnRQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoTW9kZWxDbGFzcywgYXR0cmlidXRlTmFtZSwgdmFsdWUpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSBlbnRyeS5hdHRyaWJ1dGVzID0gYXR0cmlidXRlc1xuICAgIGlmIChPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkgZW50cnkuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgIGlmIChPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuXG4gICAgcmV0dXJuIGVudHJ5XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIHN1Ym1pdHRlZCBhdHRhY2htZW50IHZhbHVlIGZvciB0cmFuc3BvcnQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gTW9kZWwgY2xhc3Mgb3duaW5nIHRoZSBhdHRhY2htZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU3VibWl0dGVkIGF0dGFjaG1lbnQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdPn0gTm9ybWFsaXplZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBfYXR0YWNobWVudFBheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShNb2RlbENsYXNzLCBhdHRhY2htZW50TmFtZSwgdmFsdWUpIHtcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24oYXR0YWNobWVudE5hbWUpXG5cbiAgICBpZiAoYXR0YWNobWVudERlZmluaXRpb24/LnR5cGUgPT09IFwiaGFzTWFueVwiKSB7XG4gICAgICBjb25zdCB2YWx1ZXMgPSBBcnJheS5pc0FycmF5KHZhbHVlKSA/IHZhbHVlIDogW3ZhbHVlXVxuXG4gICAgICByZXR1cm4gYXdhaXQgUHJvbWlzZS5hbGwodmFsdWVzLm1hcChhc3luYyAoZW50cnkpID0+IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGVudHJ5KSkpXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBjb25zdCBsYXN0VmFsdWUgPSB2YWx1ZVt2YWx1ZS5sZW5ndGggLSAxXVxuXG4gICAgICBpZiAobGFzdFZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke01vZGVsQ2xhc3MubmFtZX0jJHthdHRhY2htZW50TmFtZX0gYXR0YWNobWVudCBhcnJheSBjYW5ub3QgYmUgZW1wdHlgKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQobGFzdFZhbHVlKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBZnRlciBhIHBhcmVudCBzYXZlIHdpdGggYG5lc3RlZEF0dHJpYnV0ZXNgLCB0aGUgc2VydmVyIHJlc3BvbnNlIGluY2x1ZGVzXG4gICAqIHByZWxvYWRlZCB2ZXJzaW9ucyBvZiB0aGUgYWZmZWN0ZWQgcmVsYXRpb25zaGlwcy4gVGhpcyByZXBsYWNlcyB0aGUgbG9jYWxcbiAgICogYF9sb2FkZWRWYWx1ZWAgZm9yIGVhY2ggbmVzdGVkLXdyaXRhYmxlIHJlbGF0aW9uc2hpcCB3aXRoIHRoZSBzZXJ2ZXInc1xuICAgKiBhdXRob3JpdGF0aXZlIHNldCwgc28gZGVzdHJveWVkIGNoaWxkcmVuIGFyZSBkcm9wcGVkIGFuZCBuZXdseS1jcmVhdGVkXG4gICAqIGNoaWxkcmVuIGdldCB0aGVpciBzZXJ2ZXItYXNzaWduZWQgaWRzICsgcGVyc2lzdGVkIHN0YXRlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcmVzcG9uc2UgLSBDb21tYW5kIHJlc3BvbnNlIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlY29uY2lsZU5lc3RlZEF0dHJpYnV0ZXNGcm9tUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSBNb2RlbENsYXNzLnJlc291cmNlQ29uZmlnKClcbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnID0gcmVzb3VyY2VDb25maWc/Lm5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIGlmICghbmVzdGVkQXR0cmlidXRlc0NvbmZpZykgcmV0dXJuXG5cbiAgICBjb25zdCBtb2RlbERhdGEgPSBNb2RlbENsYXNzLm1vZGVsRGF0YUZyb21SZXNwb25zZShyZXNwb25zZSlcbiAgICBjb25zdCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzID0gbW9kZWxEYXRhLnByZWxvYWRlZFJlbGF0aW9uc2hpcHNcblxuICAgIC8qKlxuICAgICAqIFJlbGV2YW50IHByZWxvYWRzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcmVsZXZhbnRQcmVsb2FkcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlc0NvbmZpZykpIHtcbiAgICAgIGlmIChyZWxhdGlvbnNoaXBOYW1lIGluIHByZWxvYWRlZFJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgcmVsZXZhbnRQcmVsb2Fkc1tyZWxhdGlvbnNoaXBOYW1lXSA9IHByZWxvYWRlZFJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMocmVsZXZhbnRQcmVsb2FkcykubGVuZ3RoID4gMCkge1xuICAgICAgTW9kZWxDbGFzcy5hcHBseVByZWxvYWRlZFJlbGF0aW9uc2hpcHModGhpcywgcmVsZXZhbnRQcmVsb2FkcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBleGVjdXRlIGNvbW1hbmQuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENvbW1hbmRUeXBlfSBjb21tYW5kVHlwZSAtIENvbW1hbmQgdHlwZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBheWxvYWQgLSBDb21tYW5kIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUGFyc2VkIEpTT04gcmVzcG9uc2UuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZXhlY3V0ZUNvbW1hbmQoY29tbWFuZFR5cGUsIHBheWxvYWQpIHtcbiAgICBjb25zdCBjb21tYW5kTmFtZSA9IHRoaXMuY29tbWFuZE5hbWUoY29tbWFuZFR5cGUpXG4gICAgY29uc3QgdGltZVpvbmUgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKVxuICAgIGNvbnN0IHNlcmlhbGl6ZWRQYXlsb2FkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocGF5bG9hZCwge3RpbWVab25lfSkpXG4gICAgY29uc3QgcmVxdWVzdENvbnRleHQgPSBmcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoKVxuICAgIGNvbnN0IHJlcXVlc3RQYXlsb2FkID0gbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQsIHNlcmlhbGl6ZWRQYXlsb2FkKVxuICAgIGNvbnN0IHJlc291cmNlUGF0aCA9IHRoaXMucmVzb3VyY2VQYXRoKClcbiAgICBjb25zdCBjb250YWluc0F0dGFjaG1lbnRVcGxvYWQgPSBmcm9udGVuZE1vZGVsUGF5bG9hZENvbnRhaW5zQXR0YWNobWVudFVwbG9hZChzZXJpYWxpemVkUGF5bG9hZClcbiAgICBjb25zdCB1c2VTaGFyZWRUcmFuc3BvcnQgPSAhY29udGFpbnNBdHRhY2htZW50VXBsb2FkXG4gICAgY29uc3QgdXJsID0gdXNlU2hhcmVkVHJhbnNwb3J0ID8gZnJvbnRlbmRNb2RlbEFwaVVybCgpIDogZnJvbnRlbmRNb2RlbENvbW1hbmRVcmwocmVzb3VyY2VQYXRoIHx8IFwiXCIsIGNvbW1hbmROYW1lKVxuXG4gICAgaWYgKHVzZVNoYXJlZFRyYW5zcG9ydCkge1xuICAgICAgY29uc3QgYmF0Y2hSZXNwb25zZSA9IGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cy5wdXNoKHtcbiAgICAgICAgICBjb21tYW5kTmFtZSxcbiAgICAgICAgICBjb21tYW5kVHlwZSxcbiAgICAgICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgICAgIHBheWxvYWQ6IHNlcmlhbGl6ZWRQYXlsb2FkLFxuICAgICAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAgICAgIHJlamVjdCxcbiAgICAgICAgICByZXF1ZXN0SWQ6IGAkeysrc2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RJZH1gLFxuICAgICAgICAgIHJlc29sdmUsXG4gICAgICAgICAgcmVzb3VyY2VQYXRoXG4gICAgICAgIH0pXG5cbiAgICAgICAgc2NoZWR1bGVTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdEZsdXNoKClcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IGRlY29kZWRCYXRjaFJlc3BvbnNlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChiYXRjaFJlc3BvbnNlKVxuXG4gICAgICB0aGlzLnRocm93T25FcnJvckZyb250ZW5kTW9kZWxSZXNwb25zZSh7XG4gICAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgICByZXNwb25zZTogZGVjb2RlZEJhdGNoUmVzcG9uc2VcbiAgICAgIH0pXG5cbiAgICAgIHJldHVybiBkZWNvZGVkQmF0Y2hSZXNwb25zZVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0cmFja0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0KGFzeW5jICgpID0+IHJ1bldpdGhUcmFuc3BvcnREZWFkbGluZShcbiAgICAgIHtcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBgJHt0aGlzLm5hbWV9IyR7Y29tbWFuZFR5cGV9IHJlcXVlc3QgdGltZWQgb3V0YCxcbiAgICAgICAgc2lnbmFsOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCksXG4gICAgICAgIHRpbWVvdXRNczogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVvdXRNcygpXG4gICAgICB9LFxuICAgICAgYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgICBjb25zdCBkaXJlY3RSZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybCwge1xuICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlcXVlc3RQYXlsb2FkKSxcbiAgICAgICAgICBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIsXG4gICAgICAgICAgaGVhZGVyczogZnJvbnRlbmRNb2RlbFJlcXVlc3RIZWFkZXJzKHRpbWVab25lKSxcbiAgICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICAgIHNpZ25hbFxuICAgICAgICB9KVxuXG4gICAgICAgIGNvbnN0IGRpcmVjdFJlc3BvbnNlVGV4dCA9IGF3YWl0IGRpcmVjdFJlc3BvbnNlLnRleHQoKVxuXG4gICAgICAgIGlmICghZGlyZWN0UmVzcG9uc2Uub2spIHtcbiAgICAgICAgICB0aHJvd0Zyb250ZW5kTW9kZWxIdHRwRXJyb3Ioe1xuICAgICAgICAgICAgY29tbWFuZExhYmVsOiBgJHt0aGlzLm5hbWV9IyR7Y29tbWFuZFR5cGV9YCxcbiAgICAgICAgICAgIHJlc3BvbnNlOiBkaXJlY3RSZXNwb25zZSxcbiAgICAgICAgICAgIHJlc3BvbnNlVGV4dDogZGlyZWN0UmVzcG9uc2VUZXh0XG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGRpcmVjdEpzb24gPSBkaXJlY3RSZXNwb25zZVRleHQubGVuZ3RoID4gMCA/IEpTT04ucGFyc2UoZGlyZWN0UmVzcG9uc2VUZXh0KSA6IHt9XG4gICAgICAgIGNvbnN0IGRlY29kZWREaXJlY3RSZXNwb25zZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoZGlyZWN0SnNvbikpXG5cbiAgICAgICAgdGhpcy50aHJvd09uRXJyb3JGcm9udGVuZE1vZGVsUmVzcG9uc2Uoe1xuICAgICAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgICAgIHJlc3BvbnNlOiBkZWNvZGVkRGlyZWN0UmVzcG9uc2VcbiAgICAgICAgfSlcblxuICAgICAgICByZXR1cm4gZGVjb2RlZERpcmVjdFJlc3BvbnNlXG4gICAgICB9XG4gICAgKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUgY3VzdG9tIGNvbW1hbmQuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7e2NvbW1hbmROYW1lOiBzdHJpbmcsIGNvbW1hbmRUeXBlOiBGcm9udGVuZE1vZGVsUmVxdWVzdENvbW1hbmRUeXBlLCBtZW1iZXJJZD86IHN0cmluZyB8IG51bWJlciB8IG51bGwsIHBheWxvYWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgcmVzb3VyY2VQYXRoOiBzdHJpbmd9fSBhcmdzIC0gQ29tbWFuZCBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4+fSAtIERlY29kZWQgcmVzcG9uc2UgcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBleGVjdXRlQ3VzdG9tQ29tbWFuZChhcmdzKSB7XG4gICAgY29uc3Qge2NvbW1hbmROYW1lLCBjb21tYW5kVHlwZSwgbWVtYmVySWQgPSBudWxsLCBwYXlsb2FkLCByZXNvdXJjZVBhdGh9ID0gYXJnc1xuICAgIGNvbnN0IHRpbWVab25lID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKClcbiAgICBjb25zdCBzZXJpYWxpemVkUGF5bG9hZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHBheWxvYWQsIHt0aW1lWm9uZX0pKVxuICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KClcblxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0LCBzZXJpYWxpemVkUGF5bG9hZClcbiAgICBjb25zdCBjdXN0b21QYXRoID0gZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRQYXRoKHtcbiAgICAgIGNvbW1hbmROYW1lLFxuICAgICAgbWVtYmVySWQsXG4gICAgICBtb2RlbE5hbWU6IHRoaXMuZ2V0TW9kZWxOYW1lKCksXG4gICAgICByZXNvdXJjZVBhdGhcbiAgICB9KVxuXG4gICAgY29uc3QgYmF0Y2hSZXNwb25zZSA9IGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMucHVzaCh7XG4gICAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgICBjdXN0b21QYXRoLFxuICAgICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgICBwYXlsb2FkOiBzZXJpYWxpemVkUGF5bG9hZCxcbiAgICAgICAgcmVxdWVzdENvbnRleHQsXG4gICAgICAgIHJlamVjdCxcbiAgICAgICAgcmVxdWVzdElkOiBgJHsrK3NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0SWR9YCxcbiAgICAgICAgcmVzb2x2ZVxuICAgICAgfSlcblxuICAgICAgc2NoZWR1bGVTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdEZsdXNoKClcbiAgICB9KVxuXG4gICAgY29uc3QgZGVjb2RlZEJhdGNoUmVzcG9uc2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChiYXRjaFJlc3BvbnNlKVxuXG4gICAgdGhpcy50aHJvd09uRXJyb3JGcm9udGVuZE1vZGVsUmVzcG9uc2Uoe1xuICAgICAgY29tbWFuZFR5cGUsXG4gICAgICByZXNwb25zZTogZGVjb2RlZEJhdGNoUmVzcG9uc2VcbiAgICB9KVxuXG4gICAgcmV0dXJuIGRlY29kZWRCYXRjaFJlc3BvbnNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aHJvdyBvbiBlcnJvciBmcm9udGVuZCBtb2RlbCByZXNwb25zZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHt7Y29tbWFuZFR5cGU6IEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29tbWFuZFR5cGUsIHJlc3BvbnNlOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyB0aHJvd09uRXJyb3JGcm9udGVuZE1vZGVsUmVzcG9uc2UoYXJncykge1xuICAgIGNvbnN0IHtjb21tYW5kVHlwZSwgcmVzcG9uc2V9ID0gYXJnc1xuICAgIGlmIChyZXNwb25zZT8uc3RhdHVzICE9PSBcImVycm9yXCIpIHJldHVyblxuXG4gICAgY29uc3QgcmVzcG9uc2VLZXlzID0gT2JqZWN0LmtleXMocmVzcG9uc2UpXG4gICAgY29uc3QgaGFzT25seVN0YXR1cyA9IHJlc3BvbnNlS2V5cy5sZW5ndGggPT09IDEgJiYgcmVzcG9uc2VLZXlzWzBdID09PSBcInN0YXR1c1wiXG4gICAgY29uc3QgaGFzRXJyb3JNZXNzYWdlID0gdHlwZW9mIHJlc3BvbnNlLmVycm9yTWVzc2FnZSA9PT0gXCJzdHJpbmdcIiAmJiByZXNwb25zZS5lcnJvck1lc3NhZ2UubGVuZ3RoID4gMFxuICAgIGNvbnN0IGhhc0Vycm9yRW52ZWxvcGVLZXlzID0gQm9vbGVhbihcbiAgICAgIHJlc3BvbnNlLmNvZGUgIT09IHVuZGVmaW5lZFxuICAgICAgfHwgcmVzcG9uc2UuZXJyb3IgIT09IHVuZGVmaW5lZFxuICAgICAgfHwgcmVzcG9uc2UuZXJyb3JzICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHJlc3BvbnNlLm1lc3NhZ2UgIT09IHVuZGVmaW5lZFxuICAgIClcbiAgICBjb25zdCBub25TdGF0dXNLZXlzID0gcmVzcG9uc2VLZXlzLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwic3RhdHVzXCIpXG4gICAgY29uc3QgY29uZmlndXJlZEF0dHJpYnV0ZU5hbWVzID0gdGhpcy5jb25maWd1cmVkRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZU5hbWVzKClcbiAgICBjb25zdCBsb29rc0xpa2VSYXdNb2RlbFBheWxvYWQgPSBub25TdGF0dXNLZXlzLmxlbmd0aCA+IDBcbiAgICAgICYmIG5vblN0YXR1c0tleXMuZXZlcnkoKGtleSkgPT4gY29uZmlndXJlZEF0dHJpYnV0ZU5hbWVzLmhhcyhrZXkpKVxuXG4gICAgaWYgKCFoYXNFcnJvck1lc3NhZ2UgJiYgIWhhc09ubHlTdGF0dXMgJiYgIWhhc0Vycm9yRW52ZWxvcGVLZXlzICYmIGxvb2tzTGlrZVJhd01vZGVsUGF5bG9hZCkgcmV0dXJuXG5cbiAgICBjb25zdCBkZWJ1Z0Vycm9yTWVzc2FnZSA9IHR5cGVvZiByZXNwb25zZS5kZWJ1Z0Vycm9yTWVzc2FnZSA9PT0gXCJzdHJpbmdcIiAmJiByZXNwb25zZS5kZWJ1Z0Vycm9yTWVzc2FnZS5sZW5ndGggPiAwXG4gICAgICA/IHJlc3BvbnNlLmRlYnVnRXJyb3JNZXNzYWdlXG4gICAgICA6IG51bGxcbiAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBkZWJ1Z0Vycm9yTWVzc2FnZSB8fCAoaGFzRXJyb3JNZXNzYWdlXG4gICAgICA/IHJlc3BvbnNlLmVycm9yTWVzc2FnZVxuICAgICAgOiBgUmVxdWVzdCBmYWlsZWQgZm9yICR7dGhpcy5uYW1lfSMke2NvbW1hbmRUeXBlfWApXG5cbiAgICBjb25zdCBlcnJvciA9IC8qKiBAdHlwZSB7RXJyb3IgJiB7Y29ycmVsYXRpb25JZD86IHN0cmluZywgZGV0YWlscz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXJyb3JNZXNzYWdlPzogc3RyaW5nLCB2ZWxvY2lvdXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGVycm9yVHlwZT86IHN0cmluZywgdmFsaWRhdGlvbkVycm9ycz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZGVidWdFcnJvckNsYXNzPzogc3RyaW5nLCBkZWJ1Z0JhY2t0cmFjZT86IHN0cmluZ1tdfX0gKi8gKG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpKVxuICAgIGlmIChoYXNFcnJvck1lc3NhZ2UpIHtcbiAgICAgIGVycm9yLmVycm9yTWVzc2FnZSA9IHJlc3BvbnNlLmVycm9yTWVzc2FnZVxuICAgIH1cbiAgICBpZiAocmVzcG9uc2UudmVsb2Npb3VzICYmIHR5cGVvZiByZXNwb25zZS52ZWxvY2lvdXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGVycm9yLnZlbG9jaW91cyA9IHJlc3BvbnNlLnZlbG9jaW91c1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHJlc3BvbnNlLmVycm9yVHlwZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgZXJyb3IuZXJyb3JUeXBlID0gcmVzcG9uc2UuZXJyb3JUeXBlXG4gICAgfVxuICAgIGlmIChyZXNwb25zZS52YWxpZGF0aW9uRXJyb3JzICYmIHR5cGVvZiByZXNwb25zZS52YWxpZGF0aW9uRXJyb3JzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBlcnJvci52YWxpZGF0aW9uRXJyb3JzID0gcmVzcG9uc2UudmFsaWRhdGlvbkVycm9yc1xuICAgIH1cbiAgICBpZiAocmVzcG9uc2UuZGV0YWlscyAmJiB0eXBlb2YgcmVzcG9uc2UuZGV0YWlscyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgZXJyb3IuZGV0YWlscyA9IHJlc3BvbnNlLmRldGFpbHNcbiAgICB9XG4gICAgaWYgKHR5cGVvZiByZXNwb25zZS5jb3JyZWxhdGlvbklkID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBlcnJvci5jb3JyZWxhdGlvbklkID0gcmVzcG9uc2UuY29ycmVsYXRpb25JZFxuICAgIH1cbiAgICAvLyBGb3J3YXJkIHNlcnZlci1wcm92aWRlZCBkZWJ1ZyBkZXRhaWwgKGluY2x1ZGVkIG9ubHkgd2hlbiB0aGUgYmFja2VuZFxuICAgIC8vIGRlZW1zIHRoZSByZXF1ZXN0ZXIgYWxsb3dlZCB0byBzZWUgaXQsIGUuZy4gYW4gYWRtaW4pIHNvIGNhbGxlcnMgY2FuXG4gICAgLy8gcmVuZGVyIHRoZSByZWFsIGVycm9yIGNsYXNzIGFuZCBzdGFjayB0cmFjZSBpbnN0ZWFkIG9mIHRoZSBnZW5lcmljXG4gICAgLy8gY2xpZW50LXNhZmUgbWVzc2FnZS5cbiAgICBpZiAodHlwZW9mIHJlc3BvbnNlLmRlYnVnRXJyb3JDbGFzcyA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgZXJyb3IuZGVidWdFcnJvckNsYXNzID0gcmVzcG9uc2UuZGVidWdFcnJvckNsYXNzXG4gICAgfVxuICAgIGlmIChBcnJheS5pc0FycmF5KHJlc3BvbnNlLmRlYnVnQmFja3RyYWNlKSkge1xuICAgICAgZXJyb3IuZGVidWdCYWNrdHJhY2UgPSByZXNwb25zZS5kZWJ1Z0JhY2t0cmFjZVxuICAgIH1cbiAgICB0aHJvdyBlcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uZmlndXJlZCBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBDb25maWd1cmVkIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICovXG4gIHN0YXRpYyBjb25maWd1cmVkRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZU5hbWVzKCkge1xuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0aGlzLnJlc291cmNlQ29uZmlnKCkpXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHJlc291cmNlQ29uZmlnLmF0dHJpYnV0ZXNcblxuICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSB7XG4gICAgICByZXR1cm4gbmV3IFNldChhdHRyaWJ1dGVzLmZpbHRlcigoYXR0cmlidXRlTmFtZSkgPT4gdHlwZW9mIGF0dHJpYnV0ZU5hbWUgPT09IFwic3RyaW5nXCIpKVxuICAgIH1cblxuICAgIGlmIChhdHRyaWJ1dGVzICYmIHR5cGVvZiBhdHRyaWJ1dGVzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm4gbmV3IFNldChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKSlcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IFNldCgpXG4gIH1cbn1cblxuLyoqIFB1YmxpYyBmcm9udGVuZCBtb2RlbCBmb3Igc2FmZSBWZWxvY2lvdXMgYXR0YWNobWVudCBtZXRhZGF0YS4gKi9cbmV4cG9ydCBjbGFzcyBWZWxvY2lvdXNBdHRhY2htZW50IGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2Uge1xuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd9IC0gUmVzb3VyY2UgY29uZmlnLlxuICAgKi9cbiAgc3RhdGljIHJlc291cmNlQ29uZmlnKCkge1xuICAgIHJldHVybiB7XG4gICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgIGJ5dGVTaXplOiB7dHlwZTogXCJpbnRlZ2VyXCJ9LFxuICAgICAgICBjb250ZW50VHlwZToge251bGw6IHRydWUsIHR5cGU6IFwidmFyY2hhclwifSxcbiAgICAgICAgY3JlYXRlZEF0OiB7dHlwZTogXCJkYXRldGltZVwifSxcbiAgICAgICAgZmlsZW5hbWU6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgICAgIGlkOiB7dHlwZTogXCJ1dWlkXCJ9LFxuICAgICAgICBuYW1lOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgICAgICBwb3NpdGlvbjoge3R5cGU6IFwiaW50ZWdlclwifSxcbiAgICAgICAgcmVjb3JkSWQ6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgICAgIHJlY29yZFR5cGU6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgICAgIHVwZGF0ZWRBdDoge3R5cGU6IFwiZGF0ZXRpbWVcIn1cbiAgICAgIH0sXG4gICAgICBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzOiBbXCJpbmRleFwiXSxcbiAgICAgIGJ1aWx0SW5NZW1iZXJDb21tYW5kczogW1wiZmluZFwiXSxcbiAgICAgIG1vZGVsTmFtZTogXCJWZWxvY2lvdXNBdHRhY2htZW50XCIsXG4gICAgICBwcmltYXJ5S2V5OiBcImlkXCJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYXR0YWNobWVudCBtZXRhZGF0YSBieSBpdHMgcHVibGljIGlkIHRocm91Z2ggdGhlIG1lbWJlciBhdXRob3JpemF0aW9uIHBhdGguXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIEF0dGFjaG1lbnQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gUmVzb2x2ZWQgYXR0YWNobWVudCBtZXRhZGF0YS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kKGlkKSB7XG4gICAgcmV0dXJuIHRoaXMuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UoYXdhaXQgdGhpcy5leGVjdXRlQ29tbWFuZChcImZpbmRcIiwge2lkfSkpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBpZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBdHRhY2htZW50IGlkLlxuICAgKi9cbiAgaWQoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJpZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIG93bmVyIG1vZGVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gT3duZXIgbW9kZWwgbmFtZS5cbiAgICovXG4gIHJlY29yZFR5cGUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJyZWNvcmRUeXBlXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgb3duZXIgcmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE93bmVyIHJlY29yZCBpZC5cbiAgICovXG4gIHJlY29yZElkKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwicmVjb3JkSWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IG5hbWUgb24gdGhlIG93bmVyIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgbmFtZSBvbiB0aGUgb3duZXIgbW9kZWwuXG4gICAqL1xuICBuYW1lKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwibmFtZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgcG9zaXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQXR0YWNobWVudCBwb3NpdGlvbi5cbiAgICovXG4gIHBvc2l0aW9uKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwicG9zaXRpb25cIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IGZpbGVuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgZmlsZW5hbWUuXG4gICAqL1xuICBmaWxlbmFtZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImZpbGVuYW1lXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBjb250ZW50IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIEF0dGFjaG1lbnQgY29udGVudCB0eXBlLlxuICAgKi9cbiAgY29udGVudFR5cGUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJjb250ZW50VHlwZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgYnl0ZSBzaXplLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEF0dGFjaG1lbnQgYnl0ZSBzaXplLlxuICAgKi9cbiAgYnl0ZVNpemUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJieXRlU2l6ZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNyZWF0ZWQtYXQgdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7RGF0ZX0gLSBDcmVhdGVkLWF0IHRpbWVzdGFtcC5cbiAgICovXG4gIGNyZWF0ZWRBdCgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImNyZWF0ZWRBdFwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHVwZGF0ZWQtYXQgdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7RGF0ZX0gLSBVcGRhdGVkLWF0IHRpbWVzdGFtcC5cbiAgICovXG4gIHVwZGF0ZWRBdCgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcInVwZGF0ZWRBdFwiKSB9XG59XG5cbkZyb250ZW5kTW9kZWxCYXNlLnJlZ2lzdGVyTW9kZWwoVmVsb2Npb3VzQXR0YWNobWVudClcbiJdfQ==