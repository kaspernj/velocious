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
/** @typedef {string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue} FrontendModelEventPrimaryKeyValue */
/** @typedef {import("./query.js").FrontendModelEventOptions} FrontendModelEventOptions */
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
 * @template {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} [PrimaryKeyValue=import("../utils/model-primary-key.js").ModelPrimaryKeyValue]
 * @template {FrontendModelBase} [Model=FrontendModelBase]
 * @typedef {{callback: (payload: {id: PrimaryKeyValue, model: Model}) => void, eventFilterKey: string | null, eventFilterPayload: import("./query.js").FrontendModelEventFilterPayload | null, projectionPayload: import("./query.js").FrontendModelProjectionPayload}} FrontendModelModelEventCallbackEntry
 */
/**
 * Defines this typedef.
 * @template {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} [PrimaryKeyValue=import("../utils/model-primary-key.js").ModelPrimaryKeyValue]
 * @typedef {{callback: (payload: {id: PrimaryKeyValue}) => void}} FrontendModelDestroyEventCallbackEntry
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
 * @template {FrontendModelBase} [T=FrontendModelBase<any, any, any, any, any>]
 * @template {object} [Attributes=any]
 * @template {object} [CreateAttributes=any]
 * @typedef {{new (): T, create(attributes?: CreateAttributes): Promise<T>} & Omit<typeof FrontendModelBase, "create" | "prototype">} FrontendModelClass
 */
/** @typedef {Omit<FrontendModelClass<FrontendModelBase<any, any, any, any, string>>, "onDestroy"> & {onDestroy: (callback: (payload: {id: string}) => void, options?: import("./query.js").FrontendModelEventOptions) => Promise<() => void>}} FrontendModelScalarEventClass */
/**
 * Create attributes accepted by a frontend model instance.
 * @template {FrontendModelBase} T
 * @typedef {T extends FrontendModelBase<Record<string, FrontendModelAttributeValue>, infer CreateAttributes, infer _UpdateAttributes> ? CreateAttributes : Record<string, FrontendModelAttributeValue>} FrontendModelCreateAttributesFor
 */
/**
 * Lifecycle event identity exposed by a concrete frontend model.
 * @template {FrontendModelBase} T
 * @typedef {T extends FrontendModelBase<any, any, any, any, infer EventPrimaryKeyValue> ? EventPrimaryKeyValue : FrontendModelEventPrimaryKeyValue} FrontendModelEventPrimaryKeyValueFor
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
 * @param {FrontendModelModelEventCallbackEntry<any, any>} entry - Callback entry.
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
         * @type {Set<FrontendModelModelEventCallbackEntry<any, any>>} */
        this.classCreateCallbacks = new Set();
        /**
         * Narrows the runtime value to the documented type.
         * @type {Set<FrontendModelModelEventCallbackEntry<any, any>>} */
        this.classUpdateCallbacks = new Set();
        /**
         * Narrows the runtime value to the documented type.
         * @type {Set<FrontendModelDestroyEventCallbackEntry<never>>} */
        this.classDestroyCallbacks = new Set();
        /**
         * Narrows the runtime value to the documented type.
         * @type {Map<string, {instance: FrontendModelBase, updateCallbacks: Set<FrontendModelModelEventCallbackEntry<any, any>>, destroyCallbacks: Set<FrontendModelDestroyEventCallbackEntry<any>>}>} */
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
     * @template {FrontendModelModelEventCallbackEntry<any, any> | FrontendModelDestroyEventCallbackEntry<never>} T
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
                    /** @type {(payload: {id: import("../utils/model-primary-key.js").ModelPrimaryKeyValue}) => void} */ (entry.callback)({ id: identity });
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
 * @returns {{instance: FrontendModelBase, updateCallbacks: Set<FrontendModelModelEventCallbackEntry<any, any>>, destroyCallbacks: Set<FrontendModelDestroyEventCallbackEntry<any>>}} - Instance listener bucket.
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
 * @template {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} [PrimaryKeyValue=import("../utils/model-primary-key.js").ModelPrimaryKeyValue]
 * @template {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} [EventPrimaryKeyValue=PrimaryKeyValue]
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
     * @returns {PrimaryKeyValue} - Primary key value.
     */
    primaryKeyValue() {
        const ModelClass = frontendModelClassFor(this);
        const primaryKey = ModelClass.primaryKey();
        return /** @type {PrimaryKeyValue} */ (readModelPrimaryKeyValue(primaryKey, (attributeName) => {
            const value = this.readAttribute(attributeName);
            if (value === undefined || value === null) {
                throw new Error(`Missing primary key '${attributeName}' on ${ModelClass.name}`);
            }
            return value;
        }));
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
     * @returns {PrimaryKeyValue} - Persisted primary-key value.
     */
    persistedPrimaryKeyValue() {
        const ModelClass = frontendModelClassFor(this);
        const primaryKey = ModelClass.primaryKey();
        return /** @type {PrimaryKeyValue} */ (readModelPrimaryKeyValue(primaryKey, (attributeName) => {
            const value = this._persistedAttributes[attributeName];
            if (value === undefined || value === null) {
                throw new Error(`Missing persisted primary key '${attributeName}' on ${ModelClass.name}`);
            }
            return value;
        }));
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
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {(payload: {id: FrontendModelEventPrimaryKeyValueFor<InstanceType<T>>, model: InstanceType<T>}) => void} callback - Event callback.
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
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {(payload: {id: FrontendModelEventPrimaryKeyValueFor<InstanceType<T>>, model: InstanceType<T>}) => void} callback - Event callback.
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
     * @template {FrontendModelClass} T
     * @overload
     * @param {T} this - Concrete frontend model class.
     * @param {(payload: {id: FrontendModelEventPrimaryKeyValueFor<InstanceType<T>>}) => void} callback - Event callback.
     * @param {import("./query.js").FrontendModelEventOptions} [options] - Accepted for API symmetry; destroy events carry ids only.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    /**
     * Class-level hook fired when any record of this model is destroyed.
     * @param {(payload: {id: never}) => void} callback - Event callback erased at the overload implementation boundary.
     * @param {import("./query.js").FrontendModelEventOptions} [options] - Accepted for API symmetry; destroy events carry ids only.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    static async onDestroy(callback, options = {}) {
        assertNoDestroyEventFilter(this, options);
        const { requestContext } = frontendModelEventOptionsPayload(this, options);
        const sub = ensureFrontendModelEventSubscription(this, frontendModelEventRequestContext(requestContext));
        /** @type {FrontendModelDestroyEventCallbackEntry<never>} */
        const entry = { callback };
        return await sub.registerClassCallback(sub.classDestroyCallbacks, entry);
    }
    /**
     * Instance-level hook fired when THIS record is updated. The
     * instance's attributes are auto-merged with the broadcast payload
     * before the callback runs, so callers can read fresh values via
     * `this.someAttr()` without re-fetching.
     * @param {(payload: {id: EventPrimaryKeyValue, model: FrontendModelBase<Attributes, CreateAttributes, UpdateAttributes, PrimaryKeyValue, EventPrimaryKeyValue>}) => void} callback - Event callback.
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
     * @param {(payload: {id: EventPrimaryKeyValue}) => void} callback - Event callback.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbHMvYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxPQUFPLE1BQU0sMkJBQTJCLENBQUE7QUFDL0MsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxrQkFBa0IsRUFBRSxFQUFDLGdDQUFnQyxFQUFDLE1BQU0sWUFBWSxDQUFBO0FBQy9FLE9BQU8sc0JBQXNCLE1BQU0sZ0JBQWdCLENBQUE7QUFDbkQsT0FBTyxFQUFDLDJCQUEyQixFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0UsT0FBTyxFQUFDLHFCQUFxQixFQUFFLHlCQUF5QixFQUFDLE1BQU0scUJBQXFCLENBQUE7QUFDcEYsT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGlDQUFpQyxFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0gsT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDekgsT0FBTyx3QkFBd0IsTUFBTSx5QkFBeUIsQ0FBQTtBQUM5RCxPQUFPLEVBQUMsd0JBQXdCLEVBQUUsZ0JBQWdCLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUMxRSxPQUFPLHdCQUF3QixNQUFNLG9DQUFvQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyx1QkFBdUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ3BFLE9BQU8sRUFBQyx3Q0FBd0MsRUFBRSxzQ0FBc0MsRUFBQyxNQUFNLDZCQUE2QixDQUFBO0FBQzVILE9BQU8sRUFBQyxtQkFBbUIsRUFBRSwyQkFBMkIsRUFBRSwyQkFBMkIsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ3hILE9BQU8sRUFBQyxnQkFBZ0IsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQ3hELE9BQU8sYUFBYSxNQUFN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QSxDQUFDLENBQUM7SUFFcEQ7OztPQUdHO0lBQ0gsU0FBUyxLQUFLLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFdEQ7OztPQUdHO0lBQ0gsU0FBUyxLQUFLLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQSxDQUFDLENBQUM7Q0FDdkQ7QUFFRCxpQkFBaUIsQ0FBQyxhQUFhLENBQUMsbUJBQW1CLENBQUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCB0aW1lb3V0IGZyb20gXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCJcbmltcG9ydCB3YWl0IGZyb20gXCJhd2FpdGVyeS9idWlsZC93YWl0LmpzXCJcbmltcG9ydCBGcm9udGVuZE1vZGVsUXVlcnksIHtmcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZH0gZnJvbSBcIi4vcXVlcnkuanNcIlxuaW1wb3J0IEZyb250ZW5kTW9kZWxQcmVsb2FkZXIgZnJvbSBcIi4vcHJlbG9hZGVyLmpzXCJcbmltcG9ydCB7bm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlfSBmcm9tIFwiLi4vZGF0YWJhc2UvZGF0ZXRpbWUtc3RvcmFnZS5qc1wiXG5pbXBvcnQge3JlZ2lzdGVyRnJvbnRlbmRNb2RlbCwgcmVzb2x2ZUZyb250ZW5kTW9kZWxDbGFzc30gZnJvbSBcIi4vbW9kZWwtcmVnaXN0cnkuanNcIlxuaW1wb3J0IHt2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbW1hbmROYW1lLCB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGh9IGZyb20gXCIuL3Jlc291cmNlLWNvbmZpZy12YWxpZGF0aW9uLmpzXCJcbmltcG9ydCB7ZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUsIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gZnJvbSBcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIlxuaW1wb3J0IHJ1bldpdGhUcmFuc3BvcnREZWFkbGluZSBmcm9tIFwiLi90cmFuc3BvcnQtZGVhZGxpbmUuanNcIlxuaW1wb3J0IHtSRVFVRVNUX1RJTUVfWk9ORV9IRUFERVIsIHZhbGlkYXRlVGltZVpvbmV9IGZyb20gXCIuLi90aW1lLXpvbmUuanNcIlxuaW1wb3J0IFZlbG9jaW91c1dlYnNvY2tldENsaWVudCBmcm9tIFwiLi4vaHR0cC1jbGllbnQvd2Vic29ja2V0LWNsaWVudC5qc1wiXG5pbXBvcnQge3JlbW90ZVJlcXVlc3RDb250ZXh0S2V5fSBmcm9tIFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiXG5pbXBvcnQge2NhcHR1cmVGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQsIG1lcmdlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0fSBmcm9tIFwiLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCJcbmltcG9ydCB7YnVmZmVyT3V0Z29pbmdFdmVudCwgY2xlYXJCdWZmZXJlZE91dGdvaW5nRXZlbnRzLCBkcmFpbkJ1ZmZlcmVkT3V0Z29pbmdFdmVudHN9IGZyb20gXCIuL291dGdvaW5nLWV2ZW50LWJ1ZmZlci5qc1wiXG5pbXBvcnQge2RlZmluZU1vZGVsU2NvcGV9IGZyb20gXCIuLi91dGlscy9tb2RlbC1zY29wZS5qc1wiXG5pbXBvcnQgaXNQbGFpbk9iamVjdCBmcm9tIFwiLi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCB7Zm9yY2VkTm9uQmxhbmtTdHJpbmd9IGZyb20gXCJ0eXBhbmljXCJcbmltcG9ydCB7bW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXksIG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMsIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5LCBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCB7cmVhZFBheWxvYWRBc3NvY2lhdGlvbkNvdW50LCByZWFkUGF5bG9hZENvbXB1dGVkQWJpbGl0eSwgcmVhZFBheWxvYWRRdWVyeURhdGEsIHNldFBheWxvYWRBc3NvY2lhdGlvbkNvdW50LCBzZXRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5LCBzZXRQYXlsb2FkUXVlcnlEYXRhfSBmcm9tIFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCJcblxuLyoqIEB0eXBlZGVmIHtzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZX0gRnJvbnRlbmRNb2RlbEV2ZW50UHJpbWFyeUtleVZhbHVlICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9ucyAqL1xuXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIHJlbGF0aW9uc2hpcCBoZWxwZXIgdHlwZS4gUmV0dXJuZWQgYnkgYGdldFJlbGF0aW9uc2hpcEJ5TmFtZWAsXG4gKiB3aGljaCBnZW5lcmF0ZWQgbW9kZWxzIGltbWVkaWF0ZWx5IGNhc3QgdG8gdGhlaXIgY29uY3JldGUgcmVsYXRpb25zaGlwIHR5cGVcbiAqIChlLmcuIGBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXA8T3duZXIsIFRhcmdldCwgVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz5gKS5cbiAqIFRoZSBtZW1iZXJzIHVzZSBgYW55YCB0eXBlIGFyZ3Mgc28gdGhhdCBjYXN0IGlzIGFsbG93ZWQgcmVnYXJkbGVzcyBvZiB0aGVcbiAqIHRhcmdldCBtb2RlbCdzIHR5cGVkLWF0dHJpYnV0ZSBnZW5lcmljcyDigJQgYSBjb25jcmV0ZSBgRnJvbnRlbmRNb2RlbEJhc2VgIG1lbWJlclxuICogaGVyZSBtYWtlcyB0aGUgY2FzdCBhIG5vbi1vdmVybGFwcGluZyAoVFMyMzUyKSBlcnJvciBmb3IgZXZlcnkgdHlwZWQgbW9kZWwuXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXA8YW55LCBhbnksIGFueT4gfCBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXA8YW55LCBhbnksIGFueT59IEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0ZW1wbGF0ZSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IFtQcmltYXJ5S2V5VmFsdWU9aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWVdXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlfSBbTW9kZWw9RnJvbnRlbmRNb2RlbEJhc2VdXG4gKiBAdHlwZWRlZiB7e2NhbGxiYWNrOiAocGF5bG9hZDoge2lkOiBQcmltYXJ5S2V5VmFsdWUsIG1vZGVsOiBNb2RlbH0pID0+IHZvaWQsIGV2ZW50RmlsdGVyS2V5OiBzdHJpbmcgfCBudWxsLCBldmVudEZpbHRlclBheWxvYWQ6IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZCB8IG51bGwsIHByb2plY3Rpb25QYXlsb2FkOiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH19IEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHRlbXBsYXRlIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gW1ByaW1hcnlLZXlWYWx1ZT1pbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZV1cbiAqIEB0eXBlZGVmIHt7Y2FsbGJhY2s6IChwYXlsb2FkOiB7aWQ6IFByaW1hcnlLZXlWYWx1ZX0pID0+IHZvaWR9fSBGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50Q2FsbGJhY2tFbnRyeVxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDb21tYW5kVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge1wiY3JlYXRlXCIgfCBcImZpbmRcIiB8IFwiaW5kZXhcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGUgKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxDb21tYW5kVHlwZSB8IHN0cmluZ30gRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSAqL1xuLyoqXG4gKiBNb2RlbC1saWtlIGluc3RhbmNlIHZhbHVlIHN1cHBvcnRlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQuXG4gKiBAdHlwZWRlZiB7e2F0dHJpYnV0ZXM6ICgpID0+IFJlY29yZDxzdHJpbmcsIHVua25vd24+fX0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydE1vZGVsVmFsdWVcbiAqL1xuLyoqXG4gKiBTcGVjaWFsIHNjYWxhciB2YWx1ZXMgcmVzdG9yZWQgYnkgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0LlxuICogQHR5cGVkZWYge3VuZGVmaW5lZCB8IG51bGwgfCBib29sZWFuIHwgbnVtYmVyIHwgc3RyaW5nIHwgYmlnaW50IHwgRGF0ZSB8IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRNb2RlbFZhbHVlfSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0U2NhbGFyVmFsdWVcbiAqL1xuLyoqXG4gKiBQbGFpbiBvYmplY3Qgc3VwcG9ydGVkIGJ5IGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCB2YWx1ZXMuXG4gKiBOZXN0ZWQgdmFsdWVzIGFyZSBpbnRlbnRpb25hbGx5IG9wYXF1ZSBiZWNhdXNlIFR5cGVTY3JpcHQgcmVqZWN0cyByZWN1cnNpdmVcbiAqIEpTRG9jIHR5cGVkZWZzIGZvciB0aGlzIHRyYW5zcG9ydCB2YWx1ZSBjb250cmFjdC5cbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydE9iamVjdFxuICovXG4vKipcbiAqIFZhbHVlIHN1cHBvcnRlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgc2VyaWFsaXphdGlvbiBhbmQgZGVzZXJpYWxpemF0aW9uLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRTY2FsYXJWYWx1ZSB8IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRPYmplY3QgfCBBcnJheTx1bmtub3duPn0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlXG4gKi9cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIHZhbHVlIHVzZWQgd2hlbiBnZW5lcmF0ZWQgbWV0YWRhdGEgY2Fubm90IGluZmVyIGEgbmFycm93ZXIgdHlwZS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tzeW5jPzogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BdHRhY2htZW50U3luY0NvbmZpZ3VyYXRpb24sIHR5cGU6IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIn19IEZyb250ZW5kTW9kZWxBdHRhY2htZW50RGVmaW5pdGlvblxuICovXG4vKipcbiAqIERlZmluZXMgZnJvbnRlbmQtbW9kZWwgYXR0cmlidXRlIG1ldGFkYXRhLlxuICogQHR5cGVkZWYge3tjb2x1bW5UeXBlPzogc3RyaW5nLCBkYXRhVHlwZT86IHN0cmluZywganNEb2NUeXBlPzogc3RyaW5nLCBuYW1lPzogc3RyaW5nLCBudWxsPzogYm9vbGVhbiwgc2VsZWN0ZWRCeURlZmF1bHQ/OiBib29sZWFuLCBzcWxUeXBlPzogc3RyaW5nLCB0eXBlPzogc3RyaW5nfX0gRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZURlZmluaXRpb25cbiAqL1xuLyoqXG4gKiBBdHRhY2htZW50IGlucHV0IGFjY2VwdGVkIGJ5IGZyb250ZW5kLW1vZGVsIGF0dGFjaG1lbnQgaGVscGVycyBiZWZvcmUgbm9ybWFsaXphdGlvbi5cbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB7YXJyYXlCdWZmZXI6ICgpID0+IFByb21pc2U8QXJyYXlCdWZmZXI+LCB0eXBlPzogc3RyaW5nLCBuYW1lPzogc3RyaW5nfSB8IG51bGwgfCB1bmRlZmluZWR9IEZyb250ZW5kTW9kZWxBdHRhY2htZW50SW5wdXRcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSBGcm9udGVuZE1vZGVsU3luY01ldGFkYXRhXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7XCJvcHRpbWlzdGljVmVyc2lvblwiIHwgXCJzZXJ2ZXJXaW5zXCIgfCBcImxhc3RXcml0ZXJXaW5zXCIgfCBcImZpZWxkVGhyZWVXYXlcIiB8IFwiYXBwZW5kT25seVwifSBGcm9udGVuZE1vZGVsU3luY0NvbmZsaWN0U3RyYXRlZ3lcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7ZW5hYmxlZDogYm9vbGVhbiwgb3BlcmF0aW9uczogc3RyaW5nW10sIHBvbGljeUhhc2g6IHN0cmluZywgcG9saWN5VmVyc2lvbjogc3RyaW5nIHwgbnVsbCwgY29uZmxpY3RTdHJhdGVneT86IEZyb250ZW5kTW9kZWxTeW5jQ29uZmxpY3RTdHJhdGVneSwgbWV0YWRhdGE/OiBGcm9udGVuZE1vZGVsU3luY01ldGFkYXRhfX0gRnJvbnRlbmRNb2RlbFN5bmNDb25maWdcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7YXR0cmlidXRlcz86IEFycmF5PHN0cmluZyB8IEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVEZWZpbml0aW9uPiB8IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVEZWZpbml0aW9uPiwgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcz86IHN0cmluZ1tdLCBidWlsdEluTWVtYmVyQ29tbWFuZHM/OiBzdHJpbmdbXSwgY29sbGVjdGlvbkNvbW1hbmRzPzogc3RyaW5nW10sIGNvbW1hbmRzPzogc3RyaW5nW10sIG1lbWJlckNvbW1hbmRzPzogc3RyaW5nW10sIGF0dGFjaG1lbnRzPzogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREZWZpbml0aW9uPiwgbW9kZWxOYW1lPzogc3RyaW5nLCBuZXN0ZWRBdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywge2FsbG93RGVzdHJveT86IGJvb2xlYW4sIGxpbWl0PzogbnVtYmVyfT4sIHByaW1hcnlLZXk/OiBzdHJpbmcgfCBzdHJpbmdbXSwgcmVsYXRpb25zaGlwcz86IHN0cmluZ1tdLCBzeW5jPzogRnJvbnRlbmRNb2RlbFN5bmNDb25maWd9fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWdcbiAqL1xuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCBjb25zdHJ1Y3RvciB0eXBlLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZX0gW1Q9RnJvbnRlbmRNb2RlbEJhc2VdXG4gKiBAdHlwZWRlZiB7e25ldyAoYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4pOiBUfX0gRnJvbnRlbmRNb2RlbENvbnN0cnVjdG9yXG4gKi9cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgc3RhdGljIHNpZGUuXG4gKlxuICogVGhlIHRlbXBsYXRlIGRlZmF1bHRzIGFyZSBpbnRlbnRpb25hbGx5IHBlcm1pc3NpdmUgKGBhbnlgIG1vZGVsL2F0dHJpYnV0ZVxuICogcGFyYW1zKS4gVGhlIGJhcmUgYEZyb250ZW5kTW9kZWxDbGFzc2AgaXMgdGhlIGBAdGhpc2AvY29uc3RyYWludCB0eXBlIG9uIHRoZVxuICogc3RhdGljIHF1ZXJ5IG1ldGhvZHMgKGZpbmRCeS9maW5kL3doZXJlL3ByZWxvYWQvLi4uKTsgYSBnZW5lcmF0ZWQgc3ViY2xhc3NcbiAqIGRlY2xhcmVzIHR5cGVkLWF0dHJpYnV0ZSBnZW5lcmljcyAoZS5nLiBgRnJvbnRlbmRNb2RlbEJhc2U8QWNjb3VudEF0dHJpYnV0ZXMsXG4gKiBBY2NvdW50Q3JlYXRlQXR0cmlidXRlcywgQWNjb3VudFVwZGF0ZUF0dHJpYnV0ZXM+YCkgd2hpY2gsIGFnYWluc3QgYSBjb25jcmV0ZVxuICogYFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT5gIGRlZmF1bHQsIGZhaWwgdGhlIGNvbnN0cmFpbnQgYnlcbiAqIGludmFyaWFuY2UuIERlZmF1bHRpbmcgdG8gYGFueWAgbGV0cyBhbnkgc3ViY2xhc3Mgc2F0aXNmeSB0aGUgY29uc3RyYWludCB3aGlsZVxuICogdGhlIG1ldGhvZHMnIG93biBgQHRlbXBsYXRlIFRgIHN0aWxsIGNhcHR1cmVzIHRoZSBwcmVjaXNlIGNhbGxpbmcgY2xhc3MgZm9yXG4gKiB0aGVpciByZXR1cm4gdHlwZXMuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlfSBbVD1Gcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55LCBhbnksIGFueT5dXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW0F0dHJpYnV0ZXM9YW55XVxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtDcmVhdGVBdHRyaWJ1dGVzPWFueV1cbiAqIEB0eXBlZGVmIHt7bmV3ICgpOiBULCBjcmVhdGUoYXR0cmlidXRlcz86IENyZWF0ZUF0dHJpYnV0ZXMpOiBQcm9taXNlPFQ+fSAmIE9taXQ8dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlLCBcImNyZWF0ZVwiIHwgXCJwcm90b3R5cGVcIj59IEZyb250ZW5kTW9kZWxDbGFzc1xuICovXG4vKiogQHR5cGVkZWYge09taXQ8RnJvbnRlbmRNb2RlbENsYXNzPEZyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnksIGFueSwgc3RyaW5nPj4sIFwib25EZXN0cm95XCI+ICYge29uRGVzdHJveTogKGNhbGxiYWNrOiAocGF5bG9hZDoge2lkOiBzdHJpbmd9KSA9PiB2b2lkLCBvcHRpb25zPzogaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zKSA9PiBQcm9taXNlPCgpID0+IHZvaWQ+fX0gRnJvbnRlbmRNb2RlbFNjYWxhckV2ZW50Q2xhc3MgKi9cbi8qKlxuICogQ3JlYXRlIGF0dHJpYnV0ZXMgYWNjZXB0ZWQgYnkgYSBmcm9udGVuZCBtb2RlbCBpbnN0YW5jZS5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2V9IFRcbiAqIEB0eXBlZGVmIHtUIGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2U8UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgaW5mZXIgQ3JlYXRlQXR0cmlidXRlcywgaW5mZXIgX1VwZGF0ZUF0dHJpYnV0ZXM+ID8gQ3JlYXRlQXR0cmlidXRlcyA6IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59IEZyb250ZW5kTW9kZWxDcmVhdGVBdHRyaWJ1dGVzRm9yXG4gKi9cbi8qKlxuICogTGlmZWN5Y2xlIGV2ZW50IGlkZW50aXR5IGV4cG9zZWQgYnkgYSBjb25jcmV0ZSBmcm9udGVuZCBtb2RlbC5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2V9IFRcbiAqIEB0eXBlZGVmIHtUIGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueSwgYW55LCBpbmZlciBFdmVudFByaW1hcnlLZXlWYWx1ZT4gPyBFdmVudFByaW1hcnlLZXlWYWx1ZSA6IEZyb250ZW5kTW9kZWxFdmVudFByaW1hcnlLZXlWYWx1ZX0gRnJvbnRlbmRNb2RlbEV2ZW50UHJpbWFyeUtleVZhbHVlRm9yXG4gKi9cbi8qKlxuICogTG9hZGVkIGluc3RhbmNlIHR5cGUgZm9yIHJlbGF0aW9uc2hpcCBoZWxwZXIgZ2VuZXJpY3MuIE9sZGVyIGdlbmVyYXRlZFxuICogZnJvbnRlbmQgbW9kZWxzIHBhc3NlZCBtb2RlbCBjbGFzc2VzIGludG8gcmVsYXRpb25zaGlwIGhlbHBlcnMsIHdoaWxlIG5ld2VyXG4gKiBnZW5lcmF0ZWQgbW9kZWxzIHBhc3MgaW5zdGFuY2UgdHlwZXMuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnk+IHwgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlfSBUXG4gKiBAdHlwZWRlZiB7VCBleHRlbmRzIHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZSA/IEluc3RhbmNlVHlwZTxUPiA6IFR9IEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbFxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWdcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgKCgpID0+IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpfSBbdXJsXSAtIE9wdGlvbmFsIGZyb250ZW5kLW1vZGVsIFVSTC4gVGhpcyBzaG91bGQgYmUgdGhlIHNoYXJlZCBlbmRwb2ludCAoZm9yIGV4YW1wbGUgYFwiL2Zyb250ZW5kLW1vZGVsc1wiYCBvciBgXCJodHRwczovL2V4YW1wbGUuY29tL2Zyb250ZW5kLW1vZGVsc1wiYCkuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtzaGFyZWRdIC0gRGVwcmVjYXRlZCBzaGFyZWQtZW5kcG9pbnQgZmxhZyByZXRhaW5lZCBmb3IgY29tcGF0aWJpbGl0eS4gRnJvbnRlbmQtbW9kZWwgQ1JVRC9jdXN0b20gY29tbWFuZHMgdXNlIHRoZSBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJIGVudmVsb3BlIGJ5IGRlZmF1bHQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8ICgoKSA9PiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKX0gW3dlYnNvY2tldFVybF0gLSBPcHRpb25hbCB3ZWJzb2NrZXQgVVJMLiBXaGVuIHNldCwgVmVsb2Npb3VzIGNyZWF0ZXMgYW5kIG1hbmFnZXMgaXRzIG93biB3ZWJzb2NrZXQgY2xpZW50IGludGVybmFsbHkuIFN1YnNjcmlwdGlvbnMgdXNlIHRoZSB3ZWJzb2NrZXQ7IENSVUQgdXNlcyBIVFRQIGFuZCBmYWxscyBiYWNrIGdyYWNlZnVsbHkuIEV4YW1wbGU6IGBcIndzOi8vbG9jYWxob3N0OjMwMDYvd2Vic29ja2V0XCJgLlxuICogQHByb3BlcnR5IHt7cG9zdDogKHBhdGg6IHN0cmluZywgYm9keT86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBvcHRpb25zPzoge2hlYWRlcnM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LCBzaWduYWw/OiBBYm9ydFNpZ25hbH0pID0+IFByb21pc2U8e2pzb246ICgpID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT4sIHN1YnNjcmliZTogKGNoYW5uZWw6IHN0cmluZywgb3B0aW9uczoge3BhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0sIGNhbGxiYWNrOiAocGF5bG9hZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHZvaWQpID0+ICgoKSA9PiB2b2lkKSwgc3Vic2NyaWJlQW5kV2FpdD86IChjaGFubmVsOiBzdHJpbmcsIG9wdGlvbnM6IHtwYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59LCBjYWxsYmFjazogKHBheWxvYWQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiB2b2lkKSA9PiBQcm9taXNlPCgoKSA9PiB2b2lkKT59fSBbd2Vic29ja2V0Q2xpZW50XSAtIE9wdGlvbmFsIHdlYnNvY2tldCBjbGllbnQgZm9yIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgcmVxdWVzdHMgYW5kIHN1YnNjcmlwdGlvbnMuIEl0cyBgcG9zdGAgcmVjZWl2ZXMgdGhlIGJvdW5kZWQtZGVhZGxpbmUgYHNpZ25hbGAgYW5kIHNob3VsZCBmb3J3YXJkIGl0IGludG8gdGhlIHVuZGVybHlpbmcgdHJhbnNwb3J0IHNvIHRoZSBkZWFkbGluZSBjYW4gYWJvcnQgdGhlIGxpdmUgcmVxdWVzdCBhbmQgaXRzIHJlc3BvbnNlLWJvZHkgcmVhZC5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPiB8ICgoKSA9PiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KX0gW3JlcXVlc3RIZWFkZXJzXSAtIEV4dHJhIEhUVFAvV1MgaGVhZGVycyB0byBhdHRhY2ggdG8gZXZlcnkgZnJvbnRlbmQtbW9kZWwgQVBJIHJlcXVlc3QuIFBhc3MgYSBmdW5jdGlvbiB0byBjb21wdXRlIHRoZW0gYXQgcmVxdWVzdCB0aW1lIChmb3IgZXhhbXBsZSB0byBpbmNsdWRlIHRoZSBjdXJyZW50IGxvY2FsZSkuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQgfCAoKCkgPT4gaW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dCB8IHVuZGVmaW5lZCB8IG51bGwpfSBbcmVxdWVzdENvbnRleHRdIC0gSW1tdXRhYmxlIHNjYWxhciBjb250ZXh0IGNhcHR1cmVkIGluZGVwZW5kZW50bHkgd2hlbiBlYWNoIG9wZXJhdGlvbiBvciBldmVudCBzdWJzY3JpcHRpb24gc3RhcnRzIGFuZCBzZW50IGZvciByZW1vdGUgdGVuYW50L2FiaWxpdHkgcmVzb2x1dGlvbi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgKCgpID0+IG51bWJlciB8IHVuZGVmaW5lZCB8IG51bGwpfSBbdGltZW91dF0gLSBCb3VuZGVkIGRlYWRsaW5lIGluIG1pbGxpc2Vjb25kcyBjb3ZlcmluZyBjb25uZWN0aW9uLCByZXNwb25zZSBoZWFkZXJzLCBhbmQgcmVzcG9uc2UtYm9keSBjb25zdW1wdGlvbiBmb3IgZWFjaCBmcm9udGVuZC1tb2RlbCBBUEkgcmVxdWVzdC4gT24gZXhwaXJ5IHRoZSBsaXZlIGZldGNoL2FkYXB0ZXIgcmVxdWVzdCBpcyBhYm9ydGVkIChidWlsdCBvbiBhd2FpdGVyeSdzIGB0aW1lb3V0YCkgYW5kIGF3YWl0ZXJ5J3MgYFRpbWVvdXRFcnJvcmAgaXMgdGhyb3duLCBzbyBjYWxsZXJzIGNhbiBjbGFzc2lmeSBhIHRpbWVvdXQgdmlhIGBlcnJvciBpbnN0YW5jZW9mIFRpbWVvdXRFcnJvcmAuIFBhc3MgYSBmdW5jdGlvbiB0byByZXNvbHZlIGl0IHBlciByZXF1ZXN0LiBGYWxzeS9hYnNlbnQgbWVhbnMgbm8gZGVhZGxpbmUuXG4gKiBAcHJvcGVydHkge0Fib3J0U2lnbmFsIHwgKCgpID0+IEFib3J0U2lnbmFsIHwgdW5kZWZpbmVkIHwgbnVsbCl9IFtzaWduYWxdIC0gT3B0aW9uYWwgY2FsbGVyL3Nlc3Npb24gQWJvcnRTaWduYWwgY29tcG9zZWQgd2l0aCB0aGUgZGVhZGxpbmUuIEFib3J0aW5nIGl0IGNhbmNlbHMgdGhlIGxpdmUgcmVxdWVzdCAoZm9yIGV4YW1wbGUgb24gc2Vzc2lvbiBzaHV0ZG93biBvciBvZmZsaW5lIHRyYW5zaXRpb24pOyB0aGUgcmVzdWx0aW5nIGFib3J0IGVycm9yIHN0YXlzIGRpc3Rpbmd1aXNoYWJsZSBmcm9tIGEgdGltZW91dC4gUGFzcyBhIGZ1bmN0aW9uIHRvIHJlc29sdmUgdGhlIGN1cnJlbnQgc2lnbmFsIHBlciByZXF1ZXN0LlxuICogQHByb3BlcnR5IHt7Z2V0OiAoKSA9PiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkIHwgUHJvbWlzZTxzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkPiwgc2V0OiAoc2Vzc2lvbklkOiBzdHJpbmcpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+LCBjbGVhcjogKCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD59fSBbc2Vzc2lvblN0b3JlXSAtIE9wdGlvbmFsIHNlc3Npb25JZCBwZXJzaXN0ZW5jZSBob29rIGZvcndhcmRlZCB0byB0aGUgaW50ZXJuYWwgYFZlbG9jaW91c1dlYnNvY2tldENsaWVudGAgc28gV1Mgc2Vzc2lvbnMgY2FuIGJlIHJlc3VtZWQgYWNyb3NzIHBhZ2UgcmVsb2FkcyAvIGFwcCByZXN0YXJ0cy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgKCgpID0+IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQpfSBbdGltZVpvbmVdIC0gSUFOQSB0aW1lem9uZSBzZW50IHdpdGggZXZlcnkgZnJvbnRlbmQtbW9kZWwgQVBJIHJlcXVlc3QgZm9yIHRpbWV6b25lLWxlc3MgZGF0ZXRpbWUgcGFyc2luZy5cbiAqIEBwcm9wZXJ0eSB7e2FjdG9yRGV2aWNlSWQ6IHN0cmluZywgYWN0b3JVc2VySWQ6IHN0cmluZywgY2xpZW50TXV0YXRpb25JZD86ICgpID0+IHN0cmluZywgZW5hYmxlZD86IGJvb2xlYW4sIG11dGF0aW9uTG9nOiBpbXBvcnQoXCIuLi9zeW5jL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5kZWZhdWx0LCBub3c/OiAoKSA9PiBEYXRlLCBvZmZsaW5lR3JhbnQ6IHtpZDogc3RyaW5nfX19IFtvZmZsaW5lU3luY10gLSBPZmZsaW5lIG11dGF0aW9uIHF1ZXVlIGNvbmZpZ3VyYXRpb24uXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbElkbGVXYWl0QXJncyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbElkbGVXYWl0QXJnc1xuICogQHByb3BlcnR5IHtudW1iZXJ9IFtxdWlldE1zXSAtIE1pbGxpc2Vjb25kcyB0aGUgdHJhbnNwb3J0IG11c3Qgc3RheSBpZGxlIGJlZm9yZSByZXNvbHZpbmcuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3RpbWVvdXRdIC0gVGltZW91dCBpbiBtaWxsaXNlY29uZHMuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgY29uZmlnLlxuICogQHR5cGUge0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWd9ICovXG5jb25zdCBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnID0ge31cbmNvbnN0IFNIQVJFRF9GUk9OVEVORF9NT0RFTF9BUElfUEFUSCA9IFwiL2Zyb250ZW5kLW1vZGVsc1wiXG5jb25zdCBQUkVMT0FERURfUkVMQVRJT05TSElQU19LRVkgPSBcIl9fcHJlbG9hZGVkUmVsYXRpb25zaGlwc1wiXG5jb25zdCBTRUxFQ1RFRF9BVFRSSUJVVEVTX0tFWSA9IFwiX19zZWxlY3RlZEF0dHJpYnV0ZXNcIlxuY29uc3QgQVNTT0NJQVRJT05fQ09VTlRTX0tFWSA9IFwiX19hc3NvY2lhdGlvbkNvdW50c1wiXG5jb25zdCBRVUVSWV9EQVRBX0tFWSA9IFwiX19xdWVyeURhdGFcIlxuY29uc3QgQUJJTElUSUVTX0tFWSA9IFwiX19hYmlsaXRpZXNcIlxuY29uc3QgQVRUQUNITUVOVF9PV05FUl9LRVkgPSBcIl9fYXR0YWNobWVudE93bmVyXCJcbi8qKlxuICogUGVuZGluZyBzaGFyZWQgZnJvbnRlbmQgbW9kZWwgcmVxdWVzdHMuXG4gKiBAdHlwZSB7QXJyYXk8e2NvbW1hbmROYW1lPzogc3RyaW5nLCBjb21tYW5kVHlwZTogRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSwgY3VzdG9tUGF0aD86IHN0cmluZywgbW9kZWxDbGFzczogRnJvbnRlbmRNb2RlbENsYXNzLCBwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHJlcXVlc3RDb250ZXh0OiBpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0LCByZXF1ZXN0SWQ6IHN0cmluZywgcmVzb2x2ZTogKHJlc3BvbnNlOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IHZvaWQsIHJlamVjdDogKGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZCwgcmVzb3VyY2VQYXRoPzogc3RyaW5nIHwgbnVsbH0+fSAqL1xubGV0IHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMgPSBbXVxuXG5sZXQgc2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RJZCA9IDBcbmxldCBzaGFyZWRGcm9udGVuZE1vZGVsRmx1c2hTY2hlZHVsZWQgPSBmYWxzZVxubGV0IGFjdGl2ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0Q291bnQgPSAwXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIGlkbGUgcmVzb2x2ZXJzLlxuICogQHR5cGUge0FycmF5PCgpID0+IHZvaWQ+fSAqL1xubGV0IGZyb250ZW5kTW9kZWxJZGxlUmVzb2x2ZXJzID0gW11cblxuLyoqXG4gKiBJbnRlcm5hbCB3ZWJzb2NrZXQgY2xpZW50LlxuICogQHR5cGUge1ZlbG9jaW91c1dlYnNvY2tldENsaWVudCB8IG51bGx9ICovXG5sZXQgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgPSBudWxsXG4vKiogQHR5cGUge0Fib3J0U2lnbmFsIHwgbnVsbH0gKi9cbmxldCBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbCA9IG51bGxcbi8qKiBAdHlwZSB7KCgpID0+IHZvaWQpIHwgbnVsbH0gKi9cbmxldCBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXAgPSBudWxsXG5cbi8qKlxuICogRGV0YWNoZXMgYW4gb3duZWQgV2ViU29ja2V0IGNsaWVudCBmcm9tIHRoZSBzaGFyZWQgY2FjaGUgaWYgaXQgaXMgc3RpbGwgY3VycmVudC5cbiAqIEBwYXJhbSB7VmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50fSBjbGllbnQgLSBDbGllbnQgd2hvc2Ugb3duZXJzaGlwIGlzIGVuZGluZy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBkZXRhY2hJbnRlcm5hbFdlYnNvY2tldENsaWVudChjbGllbnQpIHtcbiAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50ICE9PSBjbGllbnQpIHJldHVyblxuXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50ID0gbnVsbFxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXA/LigpXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsID0gbnVsbFxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXAgPSBudWxsXG59XG5cbi8qKlxuICogRGlzcG9zZXMgdGhlIG93bmVkIFdlYlNvY2tldCBjbGllbnQgYmVmb3JlIHRyYW5zcG9ydC9zZXNzaW9uIGNvbmZpZ3VyYXRpb24gY2hhbmdlcy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZXNldEludGVybmFsV2Vic29ja2V0Q2xpZW50KCkge1xuICBjb25zdCBjbGllbnQgPSBpbnRlcm5hbFdlYnNvY2tldENsaWVudFxuXG4gIGlmICghY2xpZW50KSByZXR1cm5cblxuICBkZXRhY2hJbnRlcm5hbFdlYnNvY2tldENsaWVudChjbGllbnQpXG4gIHZvaWQgY2xpZW50LmRpc2Nvbm5lY3RBbmRTdG9wUmVjb25uZWN0KClcbn1cblxuLyoqXG4gKiBCaW5kcyB0aGUgb3duZWQgV2ViU29ja2V0IGNsaWVudCBsaWZldGltZSB0byB0aGUgY3VycmVudCBzZXNzaW9uIHNpZ25hbC5cbiAqIEBwYXJhbSB7QWJvcnRTaWduYWwgfCB1bmRlZmluZWR9IHNlc3Npb25TaWduYWwgLSBDdXJyZW50IHNlc3Npb24gc2lnbmFsLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGJpbmRJbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbChzZXNzaW9uU2lnbmFsKSB7XG4gIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbCA9PT0gc2Vzc2lvblNpZ25hbCkgcmV0dXJuXG5cbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwPy4oKVxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbCA9IHNlc3Npb25TaWduYWwgfHwgbnVsbFxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXAgPSBudWxsXG5cbiAgaWYgKCFzZXNzaW9uU2lnbmFsIHx8ICFpbnRlcm5hbFdlYnNvY2tldENsaWVudCkgcmV0dXJuXG5cbiAgY29uc3QgY2xpZW50ID0gaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRcbiAgY29uc3Qgb25TZXNzaW9uQWJvcnQgPSAoKSA9PiB7XG4gICAgZGV0YWNoSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoY2xpZW50KVxuICAgIGNsZWFyQnVmZmVyZWRPdXRnb2luZ0V2ZW50cygpXG4gICAgdm9pZCBjbGllbnQuZGlzY29ubmVjdEFuZFN0b3BSZWNvbm5lY3QoKVxuICB9XG5cbiAgc2Vzc2lvblNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgb25TZXNzaW9uQWJvcnQsIHtvbmNlOiB0cnVlfSlcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwID0gKCkgPT4gc2Vzc2lvblNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgb25TZXNzaW9uQWJvcnQpXG5cbiAgaWYgKHNlc3Npb25TaWduYWwuYWJvcnRlZCkgb25TZXNzaW9uQWJvcnQoKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IGlzIGlkbGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGFsbCBxdWV1ZWQgYW5kIGFjdGl2ZSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgcmVxdWVzdHMgYXJlIGRvbmUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSB7XG4gIHJldHVybiBhY3RpdmVGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdENvdW50ID09PSAwXG4gICAgJiYgcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cy5sZW5ndGggPT09IDBcbiAgICAmJiAhc2hhcmVkRnJvbnRlbmRNb2RlbEZsdXNoU2NoZWR1bGVkXG59XG5cbi8qKlxuICogUnVucyByZXNvbHZlIGZyb250ZW5kIG1vZGVsIGlkbGUgd2FpdGVycy5cbiAqIEByZXR1cm5zIHt2b2lkfSAqL1xuZnVuY3Rpb24gcmVzb2x2ZUZyb250ZW5kTW9kZWxJZGxlV2FpdGVycygpIHtcbiAgaWYgKCFmcm9udGVuZE1vZGVsVHJhbnNwb3J0SXNJZGxlKCkpIHJldHVyblxuXG4gIGNvbnN0IHJlc29sdmVycyA9IGZyb250ZW5kTW9kZWxJZGxlUmVzb2x2ZXJzXG4gIGZyb250ZW5kTW9kZWxJZGxlUmVzb2x2ZXJzID0gW11cblxuICBmb3IgKGNvbnN0IHJlc29sdmUgb2YgcmVzb2x2ZXJzKSB7XG4gICAgcmVzb2x2ZSgpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHdhaXQgZm9yIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBxdWlldCBwZXJpb2QuXG4gKiBAcGFyYW0ge251bWJlcn0gbWlsbGlzZWNvbmRzIC0gUXVpZXQgcGVyaW9kIGxlbmd0aC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciB0aGUgcXVpZXQgcGVyaW9kLlxuICovXG5hc3luYyBmdW5jdGlvbiB3YWl0Rm9yRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFF1aWV0UGVyaW9kKG1pbGxpc2Vjb25kcykge1xuICBpZiAobWlsbGlzZWNvbmRzIDw9IDApIHJldHVyblxuXG4gIGF3YWl0IHdhaXQobWlsbGlzZWNvbmRzKVxufVxuXG4vKipcbiAqIFJ1bnMgd2FpdCBmb3IgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IGlkbGUuXG4gKiBAcGFyYW0ge251bWJlcn0gcXVpZXRNcyAtIE1pbGxpc2Vjb25kcyB0aGUgdHJhbnNwb3J0IG11c3Qgc3RheSBpZGxlIGJlZm9yZSByZXNvbHZpbmcuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiB0cmFuc3BvcnQgc3RheXMgaWRsZS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gd2FpdEZvckZyb250ZW5kTW9kZWxUcmFuc3BvcnRJZGxlKHF1aWV0TXMgPSAwKSB7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgaWYgKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSkge1xuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHF1ZXVlTWljcm90YXNrKCgpID0+IHJlc29sdmUodW5kZWZpbmVkKSkpXG5cbiAgICAgIGlmIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0SXNJZGxlKCkpIHtcbiAgICAgICAgYXdhaXQgd2FpdEZvckZyb250ZW5kTW9kZWxUcmFuc3BvcnRRdWlldFBlcmlvZChxdWlldE1zKVxuXG4gICAgICAgIGlmIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0SXNJZGxlKCkpIHJldHVyblxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICBmcm9udGVuZE1vZGVsSWRsZVJlc29sdmVycy5wdXNoKCgpID0+IHJlc29sdmUodW5kZWZpbmVkKSlcbiAgICAgIH0pXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUnVucyB0cmFjayBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgcmVxdWVzdC5cbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gVHJhbnNwb3J0IGNhbGxiYWNrLlxuICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICovXG5hc3luYyBmdW5jdGlvbiB0cmFja0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0KGNhbGxiYWNrKSB7XG4gIGFjdGl2ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0Q291bnQgKz0gMVxuXG4gIHRyeSB7XG4gICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgfSBmaW5hbGx5IHtcbiAgICBhY3RpdmVGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdENvdW50IC09IDFcbiAgICByZXNvbHZlRnJvbnRlbmRNb2RlbElkbGVXYWl0ZXJzKClcbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGludGVybmFsIHdlYnNvY2tldCBjbGllbnQgZnJvbSB3ZWJzb2NrZXRVcmwgY29uZmlnLlxuICogQ3JlYXRlcyB0aGUgY2xpZW50IGxhemlseSBvbiBmaXJzdCBjYWxsLiBSZXR1cm5zIG51bGwgaWYgV2ViU29ja2V0XG4gKiBpcyBub3QgYXZhaWxhYmxlIG9yIHdlYnNvY2tldFVybCBpcyBub3QgY29uZmlndXJlZC5cbiAqIEByZXR1cm5zIHtWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQgfCBudWxsfSBXZWJzb2NrZXQgY2xpZW50IG9yIG51bGwuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpIHtcbiAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50KSB7XG4gICAgY29uc3QgY2xpZW50ID0gaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRcblxuICAgIGJpbmRJbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbChmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCkpXG5cbiAgICByZXR1cm4gY2xpZW50XG4gIH1cblxuICBjb25zdCB3ZWJzb2NrZXRVcmwgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldFVybFxuXG4gIGlmICghd2Vic29ja2V0VXJsKSByZXR1cm4gbnVsbFxuICBpZiAodHlwZW9mIGdsb2JhbFRoaXMuV2ViU29ja2V0ID09PSBcInVuZGVmaW5lZFwiKSByZXR1cm4gbnVsbFxuXG4gIGNvbnN0IHJlc29sdmVkVXJsID0gdHlwZW9mIHdlYnNvY2tldFVybCA9PT0gXCJmdW5jdGlvblwiID8gd2Vic29ja2V0VXJsKCkgOiB3ZWJzb2NrZXRVcmxcblxuICBpZiAoIXJlc29sdmVkVXJsKSByZXR1cm4gbnVsbFxuXG4gIGNvbnN0IGNsaWVudCA9IG5ldyBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQoe1xuICAgIGF1dG9SZWNvbm5lY3Q6IHRydWUsXG4gICAgc2Vzc2lvblN0b3JlOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNlc3Npb25TdG9yZSxcbiAgICB1cmw6IHJlc29sdmVkVXJsXG4gIH0pXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50ID0gY2xpZW50XG4gIGNsaWVudC5vblJlY29ubmVjdCA9IGFzeW5jICgpID0+IGF3YWl0IGZsdXNoQnVmZmVyZWRPdXRnb2luZ0V2ZW50c0FmdGVyUmVjb25uZWN0KGNsaWVudClcblxuICBiaW5kSW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpKVxuXG4gIHJldHVybiBjbGllbnRcbn1cblxuLyoqXG4gKiBSdW5zIGZsdXNoIGJ1ZmZlcmVkIG91dGdvaW5nIGV2ZW50cyBhZnRlciByZWNvbm5lY3QuXG4gKiBAcGFyYW0ge1ZlbG9jaW91c1dlYnNvY2tldENsaWVudH0gY2xpZW50IC0gUmVjb25uZWN0ZWQgY2xpZW50IHRoYXQgb3ducyB0aGlzIGZsdXNoLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59ICovXG5hc3luYyBmdW5jdGlvbiBmbHVzaEJ1ZmZlcmVkT3V0Z29pbmdFdmVudHNBZnRlclJlY29ubmVjdChjbGllbnQpIHtcbiAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50ICE9PSBjbGllbnQpIHJldHVyblxuXG4gIGNvbnN0IGV2ZW50cyA9IGRyYWluQnVmZmVyZWRPdXRnb2luZ0V2ZW50cygpXG4gIGNvbnN0IHNlc3Npb25TaWduYWwgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKClcblxuICBhd2FpdCBydW5XaXRoVHJhbnNwb3J0RGVhZGxpbmUoXG4gICAge1xuICAgICAgZXJyb3JNZXNzYWdlOiBcIkJ1ZmZlcmVkIGZyb250ZW5kLW1vZGVsIFdlYlNvY2tldCBmbHVzaCB0aW1lZCBvdXRcIixcbiAgICAgIHNpZ25hbDogc2Vzc2lvblNpZ25hbCxcbiAgICAgIHRpbWVvdXRNczogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVvdXRNcygpXG4gICAgfSxcbiAgICBhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgZXZlbnRzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgIT09IGNsaWVudCkgcmV0dXJuXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBjbGllbnQucG9zdChldmVudHNbaW5kZXhdLmN1c3RvbVBhdGgsIGV2ZW50c1tpbmRleF0ucGF5bG9hZCwge3NpZ25hbH0pXG5cbiAgICAgICAgICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgIT09IGNsaWVudCkgcmV0dXJuXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cbiAgICAgICAgICBpZiAoc2Vzc2lvblNpZ25hbD8uYWJvcnRlZCkgcmV0dXJuXG5cbiAgICAgICAgICBpZiAoc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgICAgIGZvciAobGV0IHJlbWFpbmluZyA9IGluZGV4OyByZW1haW5pbmcgPCBldmVudHMubGVuZ3RoOyByZW1haW5pbmcgKz0gMSkge1xuICAgICAgICAgICAgICBidWZmZXJPdXRnb2luZ0V2ZW50KGV2ZW50c1tyZW1haW5pbmddKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBzb2NrZXRPcGVuID0gY2xpZW50LnNvY2tldD8ucmVhZHlTdGF0ZSA9PT0gY2xpZW50LnNvY2tldD8uT1BFTlxuXG4gICAgICAgICAgaWYgKHNvY2tldE9wZW4pIGNvbnRpbnVlXG5cbiAgICAgICAgICBmb3IgKGxldCByZW1haW5pbmcgPSBpbmRleDsgcmVtYWluaW5nIDwgZXZlbnRzLmxlbmd0aDsgcmVtYWluaW5nICs9IDEpIHtcbiAgICAgICAgICAgIGJ1ZmZlck91dGdvaW5nRXZlbnQoZXZlbnRzW3JlbWFpbmluZ10pXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIClcbn1cblxuLyoqXG4gKiBSdW5zIGRlZmF1bHQgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgcGF0aC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIERlZmF1bHQgcmVzb3VyY2UgcGF0aCBmb3IgdGhlIG1vZGVsIGNsYXNzLlxuICovXG5mdW5jdGlvbiBkZWZhdWx0RnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aChtb2RlbENsYXNzKSB7XG4gIHJldHVybiBgLyR7aW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi5wbHVyYWxpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCkpKSl9YFxufVxuXG4vKiogRXJyb3IgcmFpc2VkIHdoZW4gcmVhZGluZyBhbiBhdHRyaWJ1dGUgdGhhdCB3YXMgbm90IHNlbGVjdGVkIGluIHF1ZXJ5IHBheWxvYWRzLiAqL1xuZXhwb3J0IGNsYXNzIEF0dHJpYnV0ZU5vdFNlbGVjdGVkRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gTW9kZWwgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgdGhhdCB3YXMgcmVxdWVzdGVkLlxuICAgKi9cbiAgY29uc3RydWN0b3IobW9kZWxOYW1lLCBhdHRyaWJ1dGVOYW1lKSB7XG4gICAgc3VwZXIoYCR7bW9kZWxOYW1lfSMke2F0dHJpYnV0ZU5hbWV9IHdhcyBub3Qgc2VsZWN0ZWRgKVxuICAgIHRoaXMubmFtZSA9IFwiQXR0cmlidXRlTm90U2VsZWN0ZWRFcnJvclwiXG4gIH1cbn1cblxuLyoqXG4gKiBMaWdodHdlaWdodCBzaW5ndWxhciByZWxhdGlvbnNoaXAgc3RhdGUgaG9sZGVyIGZvciBmcm9udGVuZCBtb2RlbCBpbnN0YW5jZXMuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnk+IHwgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlfSBTXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnk+IHwgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlfSBUXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW1RhcmdldENyZWF0ZUF0dHJpYnV0ZXM9UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPl1cbiAqL1xuZXhwb3J0IGNsYXNzIEZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIFBhcmVudCBtb2RlbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3M8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+LCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzPiB8IG51bGx9IHRhcmdldE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcihtb2RlbCwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgIHRoaXMubW9kZWwgPSBtb2RlbFxuICAgIHRoaXMucmVsYXRpb25zaGlwTmFtZSA9IHJlbGF0aW9uc2hpcE5hbWVcbiAgICB0aGlzLnRhcmdldE1vZGVsQ2xhc3MgPSB0YXJnZXRNb2RlbENsYXNzXG4gICAgdGhpcy5fcHJlbG9hZGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGx9ICovXG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbG9hZGVkLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGwgfCB1bmRlZmluZWR9IGxvYWRlZFZhbHVlIC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRMb2FkZWQobG9hZGVkVmFsdWUpIHtcbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IGxvYWRlZFZhbHVlID09IHVuZGVmaW5lZCA/IG51bGwgOiBsb2FkZWRWYWx1ZVxuICAgIHRoaXMuX3ByZWxvYWRlZCA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBwcmVsb2FkZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcmVsYXRpb25zaGlwIGlzIHByZWxvYWRlZC5cbiAgICovXG4gIGdldFByZWxvYWRlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5fcHJlbG9hZGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkZWQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsfSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqL1xuICBsb2FkZWQoKSB7XG4gICAgaWYgKCF0aGlzLl9wcmVsb2FkZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSBoYXNuJ3QgYmVlbiBwcmVsb2FkZWRgKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9sb2FkZWRWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIENvcGllcyBsb2FkZWQgdmFsdWUgZnJvbSBhbm90aGVyIHNpbmd1bGFyIHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gc291cmNlUmVsYXRpb25zaGlwIC0gU291cmNlIHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY29weUxvYWRlZEZyb20oc291cmNlUmVsYXRpb25zaGlwKSB7XG4gICAgaWYgKHNvdXJjZVJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX0gc291cmNlIHJlbGF0aW9uc2hpcCB0byBiZSBzaW5ndWxhcmApXG4gICAgfVxuXG4gICAgLy8gTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgdGFyZ2V0IHJlbGF0aW9uc2hpcCdzIGRvY3VtZW50ZWQgbW9kZWwgdHlwZS5cbiAgICBjb25zdCBsb2FkZWRWYWx1ZSA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbH0gKi8gKHNvdXJjZVJlbGF0aW9uc2hpcC5sb2FkZWQoKSlcblxuICAgIHRoaXMuc2V0TG9hZGVkKGxvYWRlZFZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQuXG4gICAqIEBwYXJhbSB7VGFyZ2V0Q3JlYXRlQXR0cmlidXRlc30gW2F0dHJpYnV0ZXNdIC0gTmV3IG1vZGVsIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD59IC0gQnVpbHQgbW9kZWwuXG4gICAqL1xuICBidWlsZChhdHRyaWJ1dGVzID0gLyoqIEB0eXBlIHtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzfSAqLyAoe30pKSB7XG4gICAgaWYgKCF0aGlzLnRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGNvbmZpZ3VyZWQgZm9yICR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge25ldyAoYXR0cmlidXRlcz86IFRhcmdldENyZWF0ZUF0dHJpYnV0ZXMpID0+IEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPn0gKi8gKHRoaXMudGFyZ2V0TW9kZWxDbGFzcylcbiAgICBjb25zdCBtb2RlbCA9IG5ldyBNb2RlbENsYXNzKGF0dHJpYnV0ZXMpXG5cbiAgICB0aGlzLnNldExvYWRlZChtb2RlbClcblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIEZvcmNlLXJlbG9hZCB0aGUgcmVsYXRpb25zaGlwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsPn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgbG9hZCgpIHtcbiAgICB0aGlzLl9wcmVsb2FkZWQgPSBmYWxzZVxuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gbnVsbFxuXG4gICAgY29uc3QgYmF0Y2hlZCA9IGF3YWl0IHRoaXMubW9kZWwuX3RyeUNvaG9ydFByZWxvYWQodGhpcy5yZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKGJhdGNoZWQpIHJldHVybiB0aGlzLmxvYWRlZCgpXG5cbiAgICBhd2FpdCB0aGlzLm1vZGVsLmxvYWRSZWxhdGlvbnNoaXAodGhpcy5yZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgcmV0dXJuIHRoaXMubG9hZGVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBsb2FkZWQgcmVsYXRpb25zaGlwIG9yIGxvYWRzIGl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsPn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgb3JMb2FkKCkge1xuICAgIGlmICh0aGlzLmdldFByZWxvYWRlZCgpKSByZXR1cm4gdGhpcy5sb2FkZWQoKVxuXG4gICAgY29uc3QgYmF0Y2hlZCA9IGF3YWl0IHRoaXMubW9kZWwuX3RyeUNvaG9ydFByZWxvYWQodGhpcy5yZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKGJhdGNoZWQpIHJldHVybiB0aGlzLmxvYWRlZCgpXG5cbiAgICBhd2FpdCB0aGlzLm1vZGVsLmxvYWRSZWxhdGlvbnNoaXAodGhpcy5yZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgcmV0dXJuIHRoaXMubG9hZGVkKClcbiAgfVxufVxuXG4vKipcbiAqIExpZ2h0d2VpZ2h0IGhhcy1tYW55IHJlbGF0aW9uc2hpcCBzdGF0ZSBob2xkZXIgZm9yIGZyb250ZW5kIG1vZGVsIGluc3RhbmNlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFNcbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFRcbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz1SZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+XVxuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXAge1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pn0gKi9cbiAgX2xvYWRlZFZhbHVlXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gUGFyZW50IG1vZGVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzczxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4sIFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4sIFRhcmdldENyZWF0ZUF0dHJpYnV0ZXM+IHwgbnVsbH0gdGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG1vZGVsLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgdGhpcy5tb2RlbCA9IG1vZGVsXG4gICAgdGhpcy5yZWxhdGlvbnNoaXBOYW1lID0gcmVsYXRpb25zaGlwTmFtZVxuICAgIHRoaXMudGFyZ2V0TW9kZWxDbGFzcyA9IHRhcmdldE1vZGVsQ2xhc3NcbiAgICB0aGlzLl9wcmVsb2FkZWQgPSBmYWxzZVxuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBsb2FkZWQuXG4gICAqIEBwYXJhbSB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pn0gbG9hZGVkVmFsdWUgLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldExvYWRlZChsb2FkZWRWYWx1ZSkge1xuICAgIGlmICghQXJyYXkuaXNBcnJheShsb2FkZWRWYWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSB0byBiZSBsb2FkZWQgd2l0aCBhbiBhcnJheWApXG4gICAgfVxuXG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBsb2FkZWRWYWx1ZVxuICAgIHRoaXMuX3ByZWxvYWRlZCA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBwcmVsb2FkZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcmVsYXRpb25zaGlwIGlzIHByZWxvYWRlZC5cbiAgICovXG4gIGdldFByZWxvYWRlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5fcHJlbG9hZGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkZWQuXG4gICAqIEByZXR1cm5zIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWVzLlxuICAgKi9cbiAgbG9hZGVkKCkge1xuICAgIGlmICghdGhpcy5fcHJlbG9hZGVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX0gaGFzbid0IGJlZW4gcHJlbG9hZGVkYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fbG9hZGVkVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3BpZXMgbG9hZGVkIHZhbHVlIGZyb20gYW5vdGhlciBoYXMtbWFueSByZWxhdGlvbnNoaXAgaGVscGVyLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXB9IHNvdXJjZVJlbGF0aW9uc2hpcCAtIFNvdXJjZSByZWxhdGlvbnNoaXAgaGVscGVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNvcHlMb2FkZWRGcm9tKHNvdXJjZVJlbGF0aW9uc2hpcCkge1xuICAgIGlmICghKHNvdXJjZVJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IHNvdXJjZSByZWxhdGlvbnNoaXAgdG8gYmUgaGFzLW1hbnlgKVxuICAgIH1cblxuICAgIC8vIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIHRhcmdldCByZWxhdGlvbnNoaXAncyBkb2N1bWVudGVkIG1vZGVsIHR5cGUuXG4gICAgY29uc3QgbG9hZGVkVmFsdWUgPSAvKiogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj59ICovIChzb3VyY2VSZWxhdGlvbnNoaXAubG9hZGVkKCkpXG5cbiAgICB0aGlzLnNldExvYWRlZChsb2FkZWRWYWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFkZCB0byBsb2FkZWQuXG4gICAqIEBwYXJhbSB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pn0gbW9kZWxzIC0gTW9kZWxzIHRvIGFwcGVuZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhZGRUb0xvYWRlZChtb2RlbHMpIHtcbiAgICBjb25zdCBsb2FkZWRNb2RlbHMgPSB0aGlzLmdldFByZWxvYWRlZCgpID8gdGhpcy5sb2FkZWQoKSA6IFtdXG5cbiAgICB0aGlzLnNldExvYWRlZChbLi4ubG9hZGVkTW9kZWxzLCAuLi5tb2RlbHNdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQuXG4gICAqIEBwYXJhbSB7VGFyZ2V0Q3JlYXRlQXR0cmlidXRlc30gW2F0dHJpYnV0ZXNdIC0gTmV3IG1vZGVsIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD59IC0gQnVpbHQgbW9kZWwuXG4gICAqL1xuICBidWlsZChhdHRyaWJ1dGVzID0gLyoqIEB0eXBlIHtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzfSAqLyAoe30pKSB7XG4gICAgaWYgKCF0aGlzLnRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGNvbmZpZ3VyZWQgZm9yICR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge25ldyAoYXR0cmlidXRlcz86IFRhcmdldENyZWF0ZUF0dHJpYnV0ZXMpID0+IEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPn0gKi8gKHRoaXMudGFyZ2V0TW9kZWxDbGFzcylcbiAgICBjb25zdCBtb2RlbCA9IG5ldyBNb2RlbENsYXNzKGF0dHJpYnV0ZXMpXG5cbiAgICB0aGlzLmFkZFRvTG9hZGVkKFttb2RlbF0pXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3JjZS1yZWxvYWQgdGhlIHJlbGF0aW9uc2hpcC4gV2hlbiB0aGUgcGFyZW50IHJlY29yZCB3YXMgbG9hZGVkIGFzIHBhcnRcbiAgICogb2YgYSBiYXRjaCwgc2libGluZ3MgdGhhdCBoYXZlIG5vdCBwcmVsb2FkZWQgdGhpcyByZWxhdGlvbnNoaXAgZ2V0XG4gICAqIGJhdGNoZWQgaW50byBvbmUgcmVxdWVzdCB2aWEgdGhlIGNvaG9ydCBwcmVsb2FkZXIuIFRoZSBzY29wZWQgcXVlcnkgcGF0aFxuICAgKiAoYE1vZGVsLndoZXJlKC4uLikucHJlbG9hZChbbmFtZV0pLnRvQXJyYXkoKWAgZGlyZWN0bHkgZnJvbSB1c2VyIGNvZGUpXG4gICAqIGJ5cGFzc2VzIGNvaG9ydCBiYXRjaGluZyBieSBkZXNpZ24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj4+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgbW9kZWxzLlxuICAgKi9cbiAgYXN5bmMgbG9hZCgpIHtcbiAgICAvLyBSZXNldCBzbyB0aGUgY29ob3J0IHByZWxvYWRlciAob3Igc2luZ2xlLXJlY29yZCBmYWxsYmFjaykgcmVwb3B1bGF0ZXMuXG4gICAgdGhpcy5fcHJlbG9hZGVkID0gZmFsc2VcbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IFtdXG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5tb2RlbC5fdHJ5Q29ob3J0UHJlbG9hZCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoYmF0Y2hlZCkgcmV0dXJuIHRoaXMuX2xvYWRlZFZhbHVlXG5cbiAgICBhd2FpdCB0aGlzLm1vZGVsLmxvYWRSZWxhdGlvbnNoaXAodGhpcy5yZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgcmV0dXJuIHRoaXMubG9hZGVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIGFycmF5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+Pn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIG1vZGVscy5cbiAgICovXG4gIGFzeW5jIHRvQXJyYXkoKSB7XG4gICAgaWYgKHRoaXMuZ2V0UHJlbG9hZGVkKCkgfHwgdGhpcy5fbG9hZGVkVmFsdWUubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIHRoaXMuX2xvYWRlZFZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZCgpXG4gIH1cbn1cblxuLyoqXG4gKiBDb3BpZXMgbG9hZGVkIHJlbGF0aW9uc2hpcCBzdGF0ZSBiZXR3ZWVuIGhlbHBlcnMgb2YgdGhlIHNhbWUgcmVsYXRpb25zaGlwIHNoYXBlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXB9IGFyZ3Muc291cmNlUmVsYXRpb25zaGlwIC0gU291cmNlIHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXB9IGFyZ3MudGFyZ2V0UmVsYXRpb25zaGlwIC0gVGFyZ2V0IHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gY29weUxvYWRlZFJlbGF0aW9uc2hpcFZhbHVlKHtzb3VyY2VSZWxhdGlvbnNoaXAsIHRhcmdldFJlbGF0aW9uc2hpcH0pIHtcbiAgdGFyZ2V0UmVsYXRpb25zaGlwLmNvcHlMb2FkZWRGcm9tKHNvdXJjZVJlbGF0aW9uc2hpcClcbn1cblxuLyoqXG4gKiBSdW5zIHJlbGF0aW9uc2hpcCB0eXBlIGlzIGNvbGxlY3Rpb24uXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwVHlwZSAtIFJlbGF0aW9uc2hpcCB0eXBlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZWxhdGlvbnNoaXAgdHlwZSBpcyBoYXMtbWFueS5cbiAqL1xuZnVuY3Rpb24gcmVsYXRpb25zaGlwVHlwZUlzQ29sbGVjdGlvbihyZWxhdGlvbnNoaXBUeXBlKSB7XG4gIHJldHVybiByZWxhdGlvbnNoaXBUeXBlID09IFwiaGFzTWFueVwiXG59XG5cbi8qKlxuICogRG93bmxvYWRlZCBmcm9udGVuZC1tb2RlbCBhdHRhY2htZW50IHBheWxvYWQgd3JhcHBlci5cbiAqL1xuZXhwb3J0IGNsYXNzIEZyb250ZW5kTW9kZWxBdHRhY2htZW50RG93bmxvYWQge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pZCAtIEF0dGFjaG1lbnQgaWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZpbGVuYW1lIC0gRmlsZW5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gYXJncy5jb250ZW50VHlwZSAtIENvbnRlbnQgdHlwZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuYnl0ZVNpemUgLSBGaWxlIHNpemUgaW4gYnl0ZXMuXG4gICAqIEBwYXJhbSB7VWludDhBcnJheX0gYXJncy5jb250ZW50IC0gRmlsZSBjb250ZW50IGJ5dGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IFthcmdzLnVybF0gLSBSZXNvbHZhYmxlIGF0dGFjaG1lbnQgVVJMLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2J5dGVTaXplLCBjb250ZW50LCBjb250ZW50VHlwZSwgZmlsZW5hbWUsIGlkLCB1cmwgPSBudWxsfSkge1xuICAgIHRoaXMuaWRWYWx1ZSA9IGlkXG4gICAgdGhpcy5maWxlbmFtZVZhbHVlID0gZmlsZW5hbWVcbiAgICB0aGlzLmNvbnRlbnRUeXBlVmFsdWUgPSBjb250ZW50VHlwZVxuICAgIHRoaXMuYnl0ZVNpemVWYWx1ZSA9IGJ5dGVTaXplXG4gICAgdGhpcy5jb250ZW50VmFsdWUgPSBjb250ZW50XG4gICAgdGhpcy51cmxWYWx1ZSA9IHVybFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnl0ZSBzaXplLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEZpbGUgc2l6ZSBpbiBieXRlcy5cbiAgICovXG4gIGJ5dGVTaXplKCkgeyByZXR1cm4gdGhpcy5ieXRlU2l6ZVZhbHVlIH1cbiAgLyoqXG4gICAqIFJ1bnMgY29udGVudC5cbiAgICogQHJldHVybnMge1VpbnQ4QXJyYXl9IC0gRmlsZSBjb250ZW50IGJ5dGVzLlxuICAgKi9cbiAgY29udGVudCgpIHsgcmV0dXJuIHRoaXMuY29udGVudFZhbHVlIH1cbiAgLyoqXG4gICAqIFJ1bnMgY29udGVudCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBDb250ZW50IHR5cGUuXG4gICAqL1xuICBjb250ZW50VHlwZSgpIHsgcmV0dXJuIHRoaXMuY29udGVudFR5cGVWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIGZpbGVuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZpbGVuYW1lLlxuICAgKi9cbiAgZmlsZW5hbWUoKSB7IHJldHVybiB0aGlzLmZpbGVuYW1lVmFsdWUgfVxuICAvKipcbiAgICogUnVucyBpZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBdHRhY2htZW50IGlkLlxuICAgKi9cbiAgaWQoKSB7IHJldHVybiB0aGlzLmlkVmFsdWUgfVxuICAvKipcbiAgICogUnVucyB1cmwuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFJlc29sdmFibGUgYXR0YWNobWVudCBVUkwuXG4gICAqL1xuICB1cmwoKSB7IHJldHVybiB0aGlzLnVybFZhbHVlIH1cbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGF0dGFjaG1lbnQgY29tbWFuZCBwYXlsb2FkLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQXR0YWNobWVudEhhbmRsZX0gYXR0YWNobWVudCAtIEF0dGFjaG1lbnQgd3JhcHBlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXR0YWNobWVudElkXSAtIE9wdGlvbmFsIGhhcy1tYW55IGF0dGFjaG1lbnQgaWQuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENvbW1hbmQgcGF5bG9hZC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb21tYW5kUGF5bG9hZChhdHRhY2htZW50LCBhdHRhY2htZW50SWQpIHtcbiAgLyoqXG4gICAqIFBheWxvYWQuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgYXR0YWNobWVudE5hbWU6IGF0dGFjaG1lbnQuYXR0YWNobWVudE5hbWUsXG4gICAgaWQ6IGF0dGFjaG1lbnQubW9kZWwucHJpbWFyeUtleVZhbHVlKClcbiAgfVxuXG4gIGlmIChhdHRhY2htZW50SWQpIHBheWxvYWQuYXR0YWNobWVudElkID0gYXR0YWNobWVudElkXG5cbiAgcmV0dXJuIHBheWxvYWRcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBjYW5vbmljYWwgYmFja2luZyBvd25lciB1c2VkIGJ5IGF0dGFjaG1lbnQgbWV0YWRhdGEgc3RvcmFnZS5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gRnJvbnRlbmQgYXR0YWNobWVudCBvd25lci5cbiAqIEByZXR1cm5zIHt7cmVjb3JkSWQ6IHN0cmluZywgcmVjb3JkVHlwZTogc3RyaW5nLCByZXNvdXJjZU5hbWU6IHN0cmluZ319IC0gQ2Fub25pY2FsIGF0dGFjaG1lbnQgb3duZXIgYW5kIG9yaWdpbmF0aW5nIHJlc291cmNlLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQXR0YWNobWVudE93bmVyKG1vZGVsKSB7XG4gIGlmICghbW9kZWwuX2F0dGFjaG1lbnRPd25lcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBhdHRhY2htZW50IG93bmVyIG1ldGFkYXRhIG9uICR7ZnJvbnRlbmRNb2RlbENsYXNzRm9yKG1vZGVsKS5uYW1lfWApXG4gIH1cblxuICByZXR1cm4gbW9kZWwuX2F0dGFjaG1lbnRPd25lclxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgYXR0YWNobWVudCB2YWx1ZSBpcyBieXRlcy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZSBsb29rcyBsaWtlIGJ5dGUgZGF0YS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc0J5dGVzKHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZSBpbnN0YW5jZW9mIFVpbnQ4QXJyYXkgfHwgdmFsdWUgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlciB8fCAodHlwZW9mIEJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIiAmJiBCdWZmZXIuaXNCdWZmZXIodmFsdWUpKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgYXR0YWNobWVudCB2YWx1ZSBzdXBwb3J0cyBhcnJheSBidWZmZXIuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyB7YXJyYXlCdWZmZXI6ICgpID0+IFByb21pc2U8QXJyYXlCdWZmZXI+fX0gLSBXaGV0aGVyIGNhbmRpZGF0ZSBzdXBwb3J0cyBhcnJheUJ1ZmZlcigpLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZVN1cHBvcnRzQXJyYXlCdWZmZXIodmFsdWUpIHtcbiAgcmV0dXJuIEJvb2xlYW4odmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmIHR5cGVvZiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodmFsdWUpLmFycmF5QnVmZmVyID09PSBcImZ1bmN0aW9uXCIpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IG5vcm1hbGl6ZSBieXRlcy5cbiAqIEBwYXJhbSB7VWludDhBcnJheSB8IEJ1ZmZlciB8IEFycmF5QnVmZmVyfSB2YWx1ZSAtIEJ5dGUtbGlrZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHtVaW50OEFycmF5fSAtIFVpbnQ4QXJyYXkgYnl0ZXMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudE5vcm1hbGl6ZUJ5dGVzKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIFVpbnQ4QXJyYXkpIHJldHVybiB2YWx1ZVxuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikgcmV0dXJuIG5ldyBVaW50OEFycmF5KHZhbHVlKVxuICBpZiAodHlwZW9mIEJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIiAmJiBCdWZmZXIuaXNCdWZmZXIoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHZhbHVlKSkpIHtcbiAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoLyoqIEB0eXBlIHtCdWZmZXJ9ICovICh2YWx1ZSkpXG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoXCJVbnN1cHBvcnRlZCBhdHRhY2htZW50IGJ5dGVzIHZhbHVlXCIpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IGJ5dGVzIHRvIGJhc2U2NC5cbiAqIEBwYXJhbSB7VWludDhBcnJheX0gYnl0ZXMgLSBCeXRlcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQmFzZTY0IHZhbHVlLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZEF0dGFjaG1lbnRCeXRlc1RvQmFzZTY0KGJ5dGVzKSB7XG4gIGlmICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgcmV0dXJuIEJ1ZmZlci5mcm9tKGJ5dGVzKS50b1N0cmluZyhcImJhc2U2NFwiKVxuICB9XG5cbiAgbGV0IGJpbmFyeSA9IFwiXCJcblxuICBmb3IgKGNvbnN0IGJ5dGUgb2YgYnl0ZXMpIHtcbiAgICBiaW5hcnkgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShieXRlKVxuICB9XG5cbiAgaWYgKHR5cGVvZiBidG9hICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcIk1pc3NpbmcgYmFzZTY0IGVuY29kZXJcIilcblxuICByZXR1cm4gYnRvYShiaW5hcnkpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IGJhc2U2NCB0byBieXRlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIEJhc2U2NCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtVaW50OEFycmF5fSAtIERlY29kZWQgYnl0ZXMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudEJhc2U2NFRvQnl0ZXModmFsdWUpIHtcbiAgaWYgKHR5cGVvZiBCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoQnVmZmVyLmZyb20odmFsdWUsIFwiYmFzZTY0XCIpKVxuICB9XG5cbiAgaWYgKHR5cGVvZiBhdG9iICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcIk1pc3NpbmcgYmFzZTY0IGRlY29kZXJcIilcblxuICBjb25zdCBiaW5hcnkgPSBhdG9iKHZhbHVlKVxuICBjb25zdCBieXRlcyA9IG5ldyBVaW50OEFycmF5KGJpbmFyeS5sZW5ndGgpXG5cbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGJpbmFyeS5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBieXRlc1tpbmRleF0gPSBiaW5hcnkuY2hhckNvZGVBdChpbmRleClcbiAgfVxuXG4gIHJldHVybiBieXRlc1xufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgYXR0YWNobWVudCB2YWx1ZSBpcyBwbGFpbiBvYmplY3QuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gV2hldGhlciB2YWx1ZSBpcyBwbGFpbiBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdCh2YWx1ZSkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIGZhbHNlXG5cbiAgY29uc3QgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKVxuXG4gIHJldHVybiBwcm90b3R5cGUgPT09IE9iamVjdC5wcm90b3R5cGUgfHwgcHJvdG90eXBlID09PSBudWxsXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBwYXlsb2FkIGNvbnRhaW5zIGF0dGFjaG1lbnQgdXBsb2FkLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBQYXlsb2FkIGNhbmRpZGF0ZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcGF5bG9hZCBjb250YWlucyBhbiBhdHRhY2htZW50IHVwbG9hZCBib2R5LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUGF5bG9hZENvbnRhaW5zQXR0YWNobWVudFVwbG9hZCh2YWx1ZSkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG5cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgcmV0dXJuIHZhbHVlLnNvbWUoKGVudHJ5KSA9PiBmcm9udGVuZE1vZGVsUGF5bG9hZENvbnRhaW5zQXR0YWNobWVudFVwbG9hZChlbnRyeSkpXG4gIH1cblxuICBpZiAoIWZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdCh2YWx1ZSkpIHJldHVybiBmYWxzZVxuXG4gIGlmICh0eXBlb2YgdmFsdWUuY29udGVudEJhc2U2NCA9PT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICByZXR1cm4gT2JqZWN0LnZhbHVlcyh2YWx1ZSkuc29tZSgoZW50cnkpID0+IGZyb250ZW5kTW9kZWxQYXlsb2FkQ29udGFpbnNBdHRhY2htZW50VXBsb2FkKGVudHJ5KSlcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBjb25jcmV0ZSBmcm9udGVuZC1tb2RlbCBjbGFzcyBmb3IgYW4gaW5zdGFuY2UuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIEZyb250ZW5kIG1vZGVsIGluc3RhbmNlLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxDbGFzc30gQ29uY3JldGUgZnJvbnRlbmQtbW9kZWwgY2xhc3MuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxDbGFzc0Zvcihtb2RlbCkge1xuICBjb25zdCBjb25zdHJ1Y3RvclZhbHVlID0gbW9kZWwuY29uc3RydWN0b3JcblxuICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQ2xhc3N9ICovIChjb25zdHJ1Y3RvclZhbHVlKVxufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGNvbmZpZ3VyZWQgb2ZmbGluZSBxdWV1ZSBzaG91bGQgaGFuZGxlIGEgbW9kZWwgb3BlcmF0aW9uLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gb3BlcmF0aW9uIC0gU3luYyBvcGVyYXRpb24uXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRvIHF1ZXVlIGxvY2FsbHkuXG4gKi9cbmZ1bmN0aW9uIHNob3VsZFF1ZXVlRnJvbnRlbmRNb2RlbE9wZXJhdGlvbk9mZmxpbmUoTW9kZWxDbGFzcywgb3BlcmF0aW9uKSB7XG4gIGNvbnN0IG9mZmxpbmVTeW5jID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5vZmZsaW5lU3luY1xuXG4gIGlmICghb2ZmbGluZVN5bmM/LmVuYWJsZWQpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IHN5bmNDb25maWcgPSBNb2RlbENsYXNzLnJlc291cmNlQ29uZmlnKCkuc3luY1xuXG4gIGlmICghc3luY0NvbmZpZz8uZW5hYmxlZCkgcmV0dXJuIGZhbHNlXG4gIGlmICghc3luY0NvbmZpZy5vcGVyYXRpb25zLmluY2x1ZGVzKG9wZXJhdGlvbikpIHRocm93IG5ldyBFcnJvcihgT2ZmbGluZSBzeW5jIGZvciAke01vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9IGRvZXMgbm90IGFsbG93ICR7b3BlcmF0aW9ufWApXG5cbiAgcmV0dXJuIHRydWVcbn1cblxuLyoqXG4gKiBRdWV1ZXMgYW4gb2ZmbGluZSBzeW5jIG11dGF0aW9uLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59IGFyZ3MuYXR0cmlidXRlcyAtIE11dGF0aW9uIGF0dHJpYnV0ZXMuXG4gKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuY2xpZW50TXV0YXRpb25JZF0gLSBQcmUtZ2VuZXJhdGVkIG11dGF0aW9uIGlkLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IGFyZ3MuTW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhcmdzLm9wZXJhdGlvbiAtIFN5bmMgb3BlcmF0aW9uLlxuICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBDbGllbnQgbXV0YXRpb24gaWQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHF1ZXVlRnJvbnRlbmRNb2RlbE11dGF0aW9uT2ZmbGluZSh7YXR0cmlidXRlcywgY2xpZW50TXV0YXRpb25JZDogcHJvdmlkZWRDbGllbnRNdXRhdGlvbklkLCBNb2RlbENsYXNzLCBvcGVyYXRpb259KSB7XG4gIGNvbnN0IG9mZmxpbmVTeW5jID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5vZmZsaW5lU3luY1xuXG4gIGlmICghb2ZmbGluZVN5bmMpIHRocm93IG5ldyBFcnJvcihcIk9mZmxpbmUgc3luYyBpcyBub3QgY29uZmlndXJlZFwiKVxuXG4gIGNvbnN0IHN5bmNDb25maWcgPSBNb2RlbENsYXNzLnJlc291cmNlQ29uZmlnKCkuc3luY1xuICBpZiAoIXN5bmNDb25maWc/LmVuYWJsZWQpIHRocm93IG5ldyBFcnJvcihgT2ZmbGluZSBzeW5jIGlzIG5vdCBlbmFibGVkIGZvciAke01vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9YClcblxuICBjb25zdCBub3cgPSBvZmZsaW5lU3luYy5ub3cgPyBvZmZsaW5lU3luYy5ub3coKSA6IG5ldyBEYXRlKClcbiAgaWYgKCEobm93IGluc3RhbmNlb2YgRGF0ZSkgfHwgTnVtYmVyLmlzTmFOKG5vdy5nZXRUaW1lKCkpKSB0aHJvdyBuZXcgRXJyb3IoXCJvZmZsaW5lU3luYy5ub3cgbXVzdCByZXR1cm4gYSB2YWxpZCBEYXRlXCIpXG5cbiAgY29uc3QgY2xpZW50TXV0YXRpb25JZCA9IHByb3ZpZGVkQ2xpZW50TXV0YXRpb25JZCB8fCAob2ZmbGluZVN5bmMuY2xpZW50TXV0YXRpb25JZCA/IG9mZmxpbmVTeW5jLmNsaWVudE11dGF0aW9uSWQoKSA6IGZyb250ZW5kTW9kZWxPZmZsaW5lTXV0YXRpb25JZCgpKVxuICBpZiAodHlwZW9mIGNsaWVudE11dGF0aW9uSWQgIT09IFwic3RyaW5nXCIgfHwgY2xpZW50TXV0YXRpb25JZC5sZW5ndGggPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCJvZmZsaW5lU3luYy5jbGllbnRNdXRhdGlvbklkIG11c3QgcmV0dXJuIGEgbm9uLWVtcHR5IHN0cmluZ1wiKVxuXG4gIGF3YWl0IG9mZmxpbmVTeW5jLm11dGF0aW9uTG9nLmFwcGVuZCh7XG4gICAgbXV0YXRpb246IHtcbiAgICAgIGFjdG9yRGV2aWNlSWQ6IG9mZmxpbmVTeW5jLmFjdG9yRGV2aWNlSWQsXG4gICAgICBhY3RvclVzZXJJZDogb2ZmbGluZVN5bmMuYWN0b3JVc2VySWQsXG4gICAgICBhdHRyaWJ1dGVzOiBmcm9udGVuZE1vZGVsU3luY0pzb25PYmplY3QoYXR0cmlidXRlcyksXG4gICAgICBiYXNlVmVyc2lvbjogbnVsbCxcbiAgICAgIGNsaWVudE11dGF0aW9uSWQsXG4gICAgICBtb2RlbDogTW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgIG9jY3VycmVkQXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgICAgb2ZmbGluZUdyYW50SWQ6IG9mZmxpbmVTeW5jLm9mZmxpbmVHcmFudC5pZCxcbiAgICAgIG9wZXJhdGlvbixcbiAgICAgIHBvbGljeUhhc2g6IHN5bmNDb25maWcucG9saWN5SGFzaFxuICAgIH1cbiAgfSlcblxuICByZXR1cm4gY2xpZW50TXV0YXRpb25JZFxufVxuXG4vKipcbiAqIEdlbmVyYXRlcyBhIGZyb250ZW5kLW1vZGVsIG9mZmxpbmUgbXV0YXRpb24gaWQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIExvY2FsIG11dGF0aW9uIGlkLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsT2ZmbGluZU11dGF0aW9uSWQoKSB7XG4gIGlmIChnbG9iYWxUaGlzLmNyeXB0byAmJiB0eXBlb2YgZ2xvYmFsVGhpcy5jcnlwdG8ucmFuZG9tVVVJRCA9PT0gXCJmdW5jdGlvblwiKSByZXR1cm4gZ2xvYmFsVGhpcy5jcnlwdG8ucmFuZG9tVVVJRCgpXG5cbiAgcmV0dXJuIGBmcm9udGVuZC1tdXRhdGlvbi0ke0RhdGUubm93KCl9LSR7TWF0aC5yYW5kb20oKS50b1N0cmluZygxNikuc2xpY2UoMil9YFxufVxuXG4vKipcbiAqIENvbnZlcnRzIG1vZGVsIGF0dHJpYnV0ZXMgdG8gc3luYy1zYWZlIEpTT04gcGF5bG9hZCB2YWx1ZXMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59IGF0dHJpYnV0ZXMgLSBGcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGVzLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAtIFN5bmMtc2FmZSBhdHRyaWJ1dGVzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsU3luY0pzb25PYmplY3QoYXR0cmlidXRlcykge1xuICBjb25zdCBzZXJpYWxpemVkID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShhdHRyaWJ1dGVzKSlcblxuICBpZiAoIXNlcmlhbGl6ZWQgfHwgdHlwZW9mIHNlcmlhbGl6ZWQgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShzZXJpYWxpemVkKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgc3luYyBtdXRhdGlvbiBhdHRyaWJ1dGVzIG9iamVjdFwiKVxuXG4gIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAqLyAoc2VyaWFsaXplZClcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBhdHRhY2htZW50IGlucHV0LlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gaW5wdXQgLSBBdHRhY2htZW50IGlucHV0LlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBUcmFuc3BvcnQtc2FmZSBhdHRhY2htZW50IHBheWxvYWQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0KSB7XG4gIGlmIChmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzUGxhaW5PYmplY3QoaW5wdXQpICYmIFwiZmlsZVwiIGluIGlucHV0KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEZpbGUgPSBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dChpbnB1dC5maWxlKVxuICAgIGNvbnN0IG1lcmdlZCA9IHtcbiAgICAgIC4uLm5vcm1hbGl6ZWRGaWxlXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBpbnB1dC5maWxlbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5maWxlbmFtZS5sZW5ndGggPiAwKSBtZXJnZWQuZmlsZW5hbWUgPSBpbnB1dC5maWxlbmFtZVxuICAgIGlmICh0eXBlb2YgaW5wdXQuY29udGVudFR5cGUgPT09IFwic3RyaW5nXCIgJiYgaW5wdXQuY29udGVudFR5cGUubGVuZ3RoID4gMCkgbWVyZ2VkLmNvbnRlbnRUeXBlID0gaW5wdXQuY29udGVudFR5cGVcblxuICAgIHJldHVybiBtZXJnZWRcbiAgfVxuXG4gIGlmIChmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzUGxhaW5PYmplY3QoaW5wdXQpKSB7XG4gICAgaWYgKHR5cGVvZiBpbnB1dC5wYXRoID09PSBcInN0cmluZ1wiICYmIGlucHV0LnBhdGgubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXR0YWNobWVudCBwYXRoIGlucHV0IGlzIG5vdCBzdXBwb3J0ZWQgaW4gZnJvbnRlbmQgbW9kZWxzXCIpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBpbnB1dC5jb250ZW50QmFzZTY0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb250ZW50QmFzZTY0OiBpbnB1dC5jb250ZW50QmFzZTY0LFxuICAgICAgICBjb250ZW50VHlwZTogdHlwZW9mIGlucHV0LmNvbnRlbnRUeXBlID09PSBcInN0cmluZ1wiICYmIGlucHV0LmNvbnRlbnRUeXBlLmxlbmd0aCA+IDAgPyBpbnB1dC5jb250ZW50VHlwZSA6IG51bGwsXG4gICAgICAgIGZpbGVuYW1lOiB0eXBlb2YgaW5wdXQuZmlsZW5hbWUgPT09IFwic3RyaW5nXCIgJiYgaW5wdXQuZmlsZW5hbWUubGVuZ3RoID4gMCA/IGlucHV0LmZpbGVuYW1lIDogdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlU3VwcG9ydHNBcnJheUJ1ZmZlcihpbnB1dCkpIHtcbiAgICBjb25zdCBieXRlcyA9IG5ldyBVaW50OEFycmF5KGF3YWl0IGlucHV0LmFycmF5QnVmZmVyKCkpXG5cbiAgICByZXR1cm4ge1xuICAgICAgY29udGVudEJhc2U2NDogZnJvbnRlbmRBdHRhY2htZW50Qnl0ZXNUb0Jhc2U2NChieXRlcyksXG4gICAgICBjb250ZW50VHlwZTogdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkudHlwZSA9PT0gXCJzdHJpbmdcIiAmJiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoaW5wdXQpLnR5cGUubGVuZ3RoID4gMFxuICAgICAgICA/IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkudHlwZVxuICAgICAgICA6IG51bGwsXG4gICAgICBmaWxlbmFtZTogdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkubmFtZSA9PT0gXCJzdHJpbmdcIiAmJiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoaW5wdXQpLm5hbWUubGVuZ3RoID4gMFxuICAgICAgICA/IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkubmFtZVxuICAgICAgICA6IFwiYXR0YWNobWVudC5iaW5cIlxuICAgIH1cbiAgfVxuXG4gIGlmIChmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzQnl0ZXMoaW5wdXQpKSB7XG4gICAgY29uc3QgYnl0ZXMgPSBmcm9udGVuZEF0dGFjaG1lbnROb3JtYWxpemVCeXRlcygvKiogQHR5cGUge1VpbnQ4QXJyYXkgfCBCdWZmZXIgfCBBcnJheUJ1ZmZlcn0gKi8gKGlucHV0KSlcblxuICAgIHJldHVybiB7XG4gICAgICBjb250ZW50QmFzZTY0OiBmcm9udGVuZEF0dGFjaG1lbnRCeXRlc1RvQmFzZTY0KGJ5dGVzKSxcbiAgICAgIGNvbnRlbnRUeXBlOiBudWxsLFxuICAgICAgZmlsZW5hbWU6IFwiYXR0YWNobWVudC5iaW5cIlxuICAgIH1cbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIGZyb250ZW5kIGF0dGFjaG1lbnQgaW5wdXRcIilcbn1cblxuLyoqXG4gKiBGcm9udGVuZC1tb2RlbCBhdHRhY2htZW50IGhlbHBlciBmb3Igb25lIGF0dGFjaG1lbnQgbmFtZS5cbiAqL1xuZXhwb3J0IGNsYXNzIEZyb250ZW5kTW9kZWxBdHRhY2htZW50SGFuZGxlIHtcbiAgLyoqXG4gICAqIFBlbmRpbmcgYXR0YWNobWVudCBpbnB1dHMgcXVldWVkIGZvciB0aGUgbmV4dCBtb2RlbCBzYXZlLlxuICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRJbnB1dFtdfVxuICAgKi9cbiAgcGVuZGluZ0lucHV0cyA9IFtdXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHthdHRhY2htZW50TmFtZSwgbW9kZWx9KSB7XG4gICAgdGhpcy5tb2RlbCA9IG1vZGVsXG4gICAgdGhpcy5hdHRhY2htZW50TmFtZSA9IGF0dGFjaG1lbnROYW1lXG4gIH1cblxuICAvKipcbiAgICogUXVldWUgYXR0YWNobWVudCBpbnB1dCBmb3IgdGhlIHBhcmVudCBtb2RlbCdzIG5leHQgc2F2ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQXR0YWNobWVudElucHV0IHwgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRJbnB1dFtdfSBpbnB1dCAtIEF0dGFjaG1lbnQgaW5wdXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcXVldWVBdHRhY2goaW5wdXQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKHRoaXMuYXR0YWNobWVudE5hbWUpXG5cbiAgICBpZiAoYXR0YWNobWVudERlZmluaXRpb24/LnR5cGUgPT09IFwiaGFzT25lXCIpIHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGlucHV0KSkge1xuICAgICAgICBjb25zdCBsYXN0SW5wdXQgPSBpbnB1dFtpbnB1dC5sZW5ndGggLSAxXVxuXG4gICAgICAgIHRoaXMucGVuZGluZ0lucHV0cyA9IHR5cGVvZiBsYXN0SW5wdXQgPT09IFwidW5kZWZpbmVkXCIgPyBbXSA6IFtsYXN0SW5wdXRdXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnBlbmRpbmdJbnB1dHMgPSBbaW5wdXRdXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShpbnB1dCkpIHtcbiAgICAgIHRoaXMucGVuZGluZ0lucHV0cy5wdXNoKC4uLmlucHV0KVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnBlbmRpbmdJbnB1dHMucHVzaChpbnB1dClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGlzIGF0dGFjaG1lbnQgaGFzIHF1ZXVlZCBpbnB1dHMgZm9yIHRoZSBuZXh0IG1vZGVsIHNhdmUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGFueSBwZW5kaW5nIGlucHV0cyBleGlzdC5cbiAgICovXG4gIGhhc1BlbmRpbmdBdHRhY2htZW50cygpIHtcbiAgICByZXR1cm4gdGhpcy5wZW5kaW5nSW5wdXRzLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIHNhdmUgcGF5bG9hZCBmb3IgcXVldWVkIGF0dGFjaG1lbnQgaW5wdXRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXSB8IHVuZGVmaW5lZD59IE5vcm1hbGl6ZWQgYXR0YWNobWVudCBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgcGVuZGluZ0F0dGFjaG1lbnRzUGF5bG9hZCgpIHtcbiAgICBpZiAodGhpcy5wZW5kaW5nSW5wdXRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbih0aGlzLmF0dGFjaG1lbnROYW1lKVxuXG4gICAgaWYgKGF0dGFjaG1lbnREZWZpbml0aW9uPy50eXBlID09PSBcImhhc01hbnlcIikge1xuICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKHRoaXMucGVuZGluZ0lucHV0cy5tYXAoYXN5bmMgKGlucHV0KSA9PiBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dChpbnB1dCkpKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dCh0aGlzLnBlbmRpbmdJbnB1dHNbdGhpcy5wZW5kaW5nSW5wdXRzLmxlbmd0aCAtIDFdKVxuICB9XG5cbiAgLyoqIENsZWFycyBxdWV1ZWQgYXR0YWNobWVudCBpbnB1dHMgYWZ0ZXIgYSBzdWNjZXNzZnVsIG1vZGVsIHNhdmUuICovXG4gIGNsZWFyUGVuZGluZ0F0dGFjaG1lbnRzKCkge1xuICAgIHRoaXMucGVuZGluZ0lucHV0cyA9IFtdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2guXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGlucHV0IC0gQXR0YWNobWVudCBpbnB1dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhdHRhY2hlZC5cbiAgICovXG4gIGFzeW5jIGF0dGFjaChpbnB1dCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCBub3JtYWxpemVkSW5wdXQgPSBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dChpbnB1dClcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IE1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJhdHRhY2hcIiwge1xuICAgICAgYXR0YWNobWVudDogbm9ybWFsaXplZElucHV0LFxuICAgICAgYXR0YWNobWVudE5hbWU6IHRoaXMuYXR0YWNobWVudE5hbWUsXG4gICAgICBpZDogdGhpcy5tb2RlbC5wcmltYXJ5S2V5VmFsdWUoKVxuICAgIH0pXG5cbiAgICB0aGlzLm1vZGVsLmFzc2lnbkF0dHJpYnV0ZXMoTW9kZWxDbGFzcy5hdHRyaWJ1dGVzRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRvd25sb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2F0dGFjaG1lbnRJZF0gLSBPcHRpb25hbCBhdHRhY2htZW50IGlkIGZvciBoYXMtbWFueSBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREb3dubG9hZCB8IG51bGw+fSAtIERvd25sb2FkZWQgYXR0YWNobWVudCBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgZG93bmxvYWQoYXR0YWNobWVudElkKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcImRvd25sb2FkXCIsIGZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29tbWFuZFBheWxvYWQodGhpcywgYXR0YWNobWVudElkKSlcbiAgICBjb25zdCBhdHRhY2htZW50UGF5bG9hZCA9IHJlc3BvbnNlLmF0dGFjaG1lbnRcblxuICAgIGlmICghYXR0YWNobWVudFBheWxvYWQgfHwgdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkICE9PSBcIm9iamVjdFwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgY29udGVudEJhc2U2NCA9IHR5cGVvZiBhdHRhY2htZW50UGF5bG9hZC5jb250ZW50QmFzZTY0ID09PSBcInN0cmluZ1wiID8gYXR0YWNobWVudFBheWxvYWQuY29udGVudEJhc2U2NCA6IFwiXCJcbiAgICBjb25zdCBjb250ZW50ID0gZnJvbnRlbmRBdHRhY2htZW50QmFzZTY0VG9CeXRlcyhjb250ZW50QmFzZTY0KVxuICAgIGNvbnN0IGJ5dGVTaXplID0gTnVtYmVyKGF0dGFjaG1lbnRQYXlsb2FkLmJ5dGVTaXplKVxuXG4gICAgcmV0dXJuIG5ldyBGcm9udGVuZE1vZGVsQXR0YWNobWVudERvd25sb2FkKHtcbiAgICAgIGJ5dGVTaXplOiBOdW1iZXIuaXNGaW5pdGUoYnl0ZVNpemUpID8gYnl0ZVNpemUgOiBjb250ZW50Lmxlbmd0aCxcbiAgICAgIGNvbnRlbnQsXG4gICAgICBjb250ZW50VHlwZTogdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRUeXBlID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRUeXBlLmxlbmd0aCA+IDAgPyBhdHRhY2htZW50UGF5bG9hZC5jb250ZW50VHlwZSA6IG51bGwsXG4gICAgICBmaWxlbmFtZTogdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLmZpbGVuYW1lID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnRQYXlsb2FkLmZpbGVuYW1lLmxlbmd0aCA+IDAgPyBhdHRhY2htZW50UGF5bG9hZC5maWxlbmFtZSA6IFwiYXR0YWNobWVudC5iaW5cIixcbiAgICAgIGlkOiB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQuaWQgPT09IFwic3RyaW5nXCIgPyBhdHRhY2htZW50UGF5bG9hZC5pZCA6IFwiXCIsXG4gICAgICB1cmw6IHR5cGVvZiBhdHRhY2htZW50UGF5bG9hZC51cmwgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudFBheWxvYWQudXJsLmxlbmd0aCA+IDAgPyBhdHRhY2htZW50UGF5bG9hZC51cmwgOiBudWxsXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVybC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthdHRhY2htZW50SWRdIC0gT3B0aW9uYWwgYXR0YWNobWVudCBpZCBmb3IgaGFzLW1hbnkgYXR0YWNobWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIFJlc29sdmFibGUgYXR0YWNobWVudCBVUkwuXG4gICAqL1xuICBhc3luYyB1cmwoYXR0YWNobWVudElkKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcInVybFwiLCBmcm9udGVuZE1vZGVsQXR0YWNobWVudENvbW1hbmRQYXlsb2FkKHRoaXMsIGF0dGFjaG1lbnRJZCkpXG5cbiAgICBpZiAodHlwZW9mIHJlc3BvbnNlLnVybCA9PT0gXCJzdHJpbmdcIiAmJiByZXNwb25zZS51cmwubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIHJlc3BvbnNlLnVybFxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgcXVlcnkgZm9yIHRoaXMgYXR0YWNobWVudCBoYW5kbGUncyBtZXRhZGF0YSByb3dzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBWZWxvY2lvdXNBdHRhY2htZW50Pn0gLSBBdHRhY2htZW50IG1ldGFkYXRhIHF1ZXJ5LlxuICAgKi9cbiAgcXVlcnkoKSB7XG4gICAgY29uc3QgYXR0YWNobWVudE93bmVyID0gZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRPd25lcih0aGlzLm1vZGVsKVxuXG4gICAgcmV0dXJuIFZlbG9jaW91c0F0dGFjaG1lbnRcbiAgICAgIC53aGVyZSh7XG4gICAgICAgIG5hbWU6IHRoaXMuYXR0YWNobWVudE5hbWUsXG4gICAgICAgIHJlY29yZElkOiBhdHRhY2htZW50T3duZXIucmVjb3JkSWQsXG4gICAgICAgIHJlY29yZFR5cGU6IGF0dGFjaG1lbnRPd25lci5yZWNvcmRUeXBlLFxuICAgICAgICByZXNvdXJjZU5hbWU6IGF0dGFjaG1lbnRPd25lci5yZXNvdXJjZU5hbWVcbiAgICAgIH0pXG4gICAgICAub3JkZXIoW1tcInBvc2l0aW9uXCIsIFwiYXNjXCJdXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBhbGwgYXR0YWNobWVudCBtZXRhZGF0YSByb3dzIGZvciB0aGlzIGhhbmRsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8VmVsb2Npb3VzQXR0YWNobWVudFtdPn0gLSBBdHRhY2htZW50IG1ldGFkYXRhIHJvd3MuXG4gICAqL1xuICBhc3luYyB0b0FycmF5KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkudG9BcnJheSgpXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgdGhlIGZpcnN0IGF0dGFjaG1lbnQgbWV0YWRhdGEgcm93IGZvciB0aGlzIGhhbmRsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8VmVsb2Npb3VzQXR0YWNobWVudCB8IG51bGw+fSAtIEZpcnN0IGF0dGFjaG1lbnQgbWV0YWRhdGEgcm93LlxuICAgKi9cbiAgYXN5bmMgZmlyc3QoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maXJzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsaXN0LiBSZXR1cm5zIG1ldGFkYXRhIGZvciBldmVyeSBhdHRhY2htZW50IHVuZGVyIHRoaXMgYXR0YWNobWVudCBuYW1lXG4gICAqIChubyBjb250ZW50IGJ5dGVzKSwgc28gY2FsbGVycyBjYW4gZW51bWVyYXRlIGhhcy1tYW55IGF0dGFjaG1lbnRzIGFuZCB0aGVuXG4gICAqIGRvd25sb2FkIG9yIGxpbmsgdG8gZWFjaCBvbmUgYnkgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PHtieXRlU2l6ZTogbnVtYmVyLCBjb250ZW50VHlwZTogc3RyaW5nIHwgbnVsbCwgZmlsZW5hbWU6IHN0cmluZywgaWQ6IHN0cmluZywgdXJsOiBzdHJpbmcgfCBudWxsfT4+fSAtIEF0dGFjaG1lbnQgbWV0YWRhdGEgZW50cmllcy5cbiAgICovXG4gIGFzeW5jIGxpc3QoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcImF0dGFjaG1lbnRMaXN0XCIsIGZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29tbWFuZFBheWxvYWQodGhpcykpXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSBBcnJheS5pc0FycmF5KHJlc3BvbnNlLmF0dGFjaG1lbnRzKSA/IHJlc3BvbnNlLmF0dGFjaG1lbnRzIDogW11cblxuICAgIHJldHVybiBhdHRhY2htZW50cy5tYXAoKGF0dGFjaG1lbnQpID0+IHtcbiAgICAgIGNvbnN0IGJ5dGVTaXplID0gTnVtYmVyKGF0dGFjaG1lbnQuYnl0ZVNpemUpXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGJ5dGVTaXplOiBOdW1iZXIuaXNGaW5pdGUoYnl0ZVNpemUpID8gYnl0ZVNpemUgOiAwLFxuICAgICAgICBjb250ZW50VHlwZTogdHlwZW9mIGF0dGFjaG1lbnQuY29udGVudFR5cGUgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudC5jb250ZW50VHlwZS5sZW5ndGggPiAwID8gYXR0YWNobWVudC5jb250ZW50VHlwZSA6IG51bGwsXG4gICAgICAgIGZpbGVuYW1lOiB0eXBlb2YgYXR0YWNobWVudC5maWxlbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50LmZpbGVuYW1lLmxlbmd0aCA+IDAgPyBhdHRhY2htZW50LmZpbGVuYW1lIDogXCJhdHRhY2htZW50LmJpblwiLFxuICAgICAgICBpZDogdHlwZW9mIGF0dGFjaG1lbnQuaWQgPT09IFwic3RyaW5nXCIgPyBhdHRhY2htZW50LmlkIDogXCJcIixcbiAgICAgICAgdXJsOiB0eXBlb2YgYXR0YWNobWVudC51cmwgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudC51cmwubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnQudXJsIDogbnVsbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkb3dubG9hZCB1cmwuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRG93bmxvYWQgVVJMIGZvciB0aGlzIGF0dGFjaG1lbnQgb24gdGhlIGNvbmZpZ3VyZWQgYmFja2VuZC5cbiAgICovXG4gIGRvd25sb2FkVXJsKCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCBjb21tYW5kTmFtZSA9IE1vZGVsQ2xhc3MuY29tbWFuZE5hbWUoXCJkb3dubG9hZFwiKVxuICAgIGNvbnN0IHJlc291cmNlUGF0aCA9IE1vZGVsQ2xhc3MucmVzb3VyY2VQYXRoKClcbiAgICBjb25zdCBjb21tYW5kVXJsID0gZnJvbnRlbmRNb2RlbENvbW1hbmRVcmwocmVzb3VyY2VQYXRoLCBjb21tYW5kTmFtZSlcbiAgICBjb25zdCBwYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHtcbiAgICAgIGF0dGFjaG1lbnROYW1lOiB0aGlzLmF0dGFjaG1lbnROYW1lLFxuICAgICAgaWQ6IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCB0aGlzLm1vZGVsLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIH0pXG5cbiAgICByZXR1cm4gYCR7Y29tbWFuZFVybH0/JHtwYXJhbXMudG9TdHJpbmcoKX1gXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgdXJsLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsfSB2YWx1ZSAtIFVSTCBjYW5kaWRhdGUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIE5vcm1hbGl6ZWQgVVJMIHdpdGhvdXQgdHJhaWxpbmcgc2xhc2guXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRVcmwodmFsdWUpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIFwiXCJcblxuICBjb25zdCB0cmltbWVkID0gdmFsdWUudHJpbSgpXG5cbiAgaWYgKCF0cmltbWVkLmxlbmd0aCkgcmV0dXJuIFwiXCJcblxuICByZXR1cm4gdHJpbW1lZC5yZXBsYWNlKC9cXC8rJC8sIFwiXCIpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgdXJsLlxuICogQHJldHVybnMge3N0cmluZ30gLSBSZXNvbHZlZCBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgVVJMLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VXJsKCkge1xuICBjb25zdCBjb25maWd1cmVkVXJsID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudXJsID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudXJsKClcbiAgICA6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudXJsXG5cbiAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRVcmwoY29uZmlndXJlZFVybClcbn1cblxuLyoqXG4gKiBSdW5zIGNsb25lIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZXMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gdmFsdWUgLSBBdHRyaWJ1dGVzIGhhc2guXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENsb25lZCBhdHRyaWJ1dGVzIGhhc2guXG4gKi9cbmZ1bmN0aW9uIGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXModmFsdWUpIHtcbiAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHZhbHVlKSkpXG59XG5cbi8qKlxuICogU2hhcmVkIGNoYW5uZWwgbmFtZSBmb3IgbW9kZWwgbGlmZWN5Y2xlIGV2ZW50cyAoUGhhc2UgMykuXG4gKiBNYXRjaGVzIHRoZSBiYWNrZW5kIGBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FYC5cbiAqL1xuY29uc3QgRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSA9IFwiZnJvbnRlbmQtbW9kZWxzXCJcblxuLyoqXG4gKiBSdW5zIG1lcmdlIGZyb250ZW5kIG1vZGVsIGV2ZW50IHByZWxvYWQuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gdGFyZ2V0IC0gVGFyZ2V0IHByZWxvYWQgcGF5bG9hZC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSBzb3VyY2UgLSBTb3VyY2UgcHJlbG9hZCBwYXlsb2FkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50UHJlbG9hZCh0YXJnZXQsIHNvdXJjZSkge1xuICBmb3IgKGNvbnN0IFtyZWxhdGlvbnNoaXBOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc291cmNlKSkge1xuICAgIGNvbnN0IGV4aXN0aW5nVmFsdWUgPSB0YXJnZXRbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSB8fCB2YWx1ZSA9PT0gZmFsc2UpIHtcbiAgICAgIGlmIChleGlzdGluZ1ZhbHVlID09PSB1bmRlZmluZWQpIHRhcmdldFtyZWxhdGlvbnNoaXBOYW1lXSA9IHZhbHVlXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0YXJnZXRbcmVsYXRpb25zaGlwTmFtZV0gPSB2YWx1ZVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoIWV4aXN0aW5nVmFsdWUgfHwgdHlwZW9mIGV4aXN0aW5nVmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShleGlzdGluZ1ZhbHVlKSkge1xuICAgICAgdGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdID0ge31cbiAgICB9XG5cbiAgICBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByZWxvYWQoXG4gICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gKi8gKHRhcmdldFtyZWxhdGlvbnNoaXBOYW1lXSksXG4gICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gKi8gKHZhbHVlKVxuICAgIClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgZnJvbnRlbmQgbW9kZWwgZXZlbnQgc2VsZWN0LlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IHRhcmdldCAtIFRhcmdldCBzZWxlY3QgbWFwLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IHNvdXJjZSAtIFNvdXJjZSBzZWxlY3QgbWFwLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50U2VsZWN0KHRhcmdldCwgc291cmNlKSB7XG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwgYXR0cmlidXRlc10gb2YgT2JqZWN0LmVudHJpZXMoc291cmNlKSkge1xuICAgIGNvbnN0IGV4aXN0aW5nQXR0cmlidXRlcyA9IHRhcmdldFttb2RlbE5hbWVdIHx8IFtdXG5cbiAgICB0YXJnZXRbbW9kZWxOYW1lXSA9IEFycmF5LmZyb20obmV3IFNldChleGlzdGluZ0F0dHJpYnV0ZXMuY29uY2F0KGF0dHJpYnV0ZXMpKSlcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgdW5pcXVlIGZyb250ZW5kIG1vZGVsIGV2ZW50IGVudHJpZXMuXG4gKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFdpdGhDb3VudFBheWxvYWRFbnRyeSB8IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEFiaWxpdGllc1BheWxvYWRFbnRyeT59IHRhcmdldCAtIFRhcmdldCBhcnJheS5cbiAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsV2l0aENvdW50UGF5bG9hZEVudHJ5IHwgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsQWJpbGl0aWVzUGF5bG9hZEVudHJ5Pn0gc291cmNlIC0gU291cmNlIGFycmF5LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIG1lcmdlVW5pcXVlRnJvbnRlbmRNb2RlbEV2ZW50RW50cmllcyh0YXJnZXQsIHNvdXJjZSkge1xuICBjb25zdCBleGlzdGluZ0tleXMgPSBuZXcgU2V0KHRhcmdldC5tYXAoKGVudHJ5KSA9PiBKU09OLnN0cmluZ2lmeShlbnRyeSkpKVxuXG4gIGZvciAoY29uc3QgZW50cnkgb2Ygc291cmNlKSB7XG4gICAgY29uc3Qga2V5ID0gSlNPTi5zdHJpbmdpZnkoZW50cnkpXG5cbiAgICBpZiAoZXhpc3RpbmdLZXlzLmhhcyhrZXkpKSBjb250aW51ZVxuXG4gICAgdGFyZ2V0LnB1c2goZW50cnkpXG4gICAgZXhpc3RpbmdLZXlzLmFkZChrZXkpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG1lcmdlIGZyb250ZW5kIG1vZGVsIGV2ZW50IHByb2plY3Rpb24gcGF5bG9hZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9IHRhcmdldCAtIFRhcmdldCBwYXlsb2FkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH0gc291cmNlIC0gU291cmNlIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRQcm9qZWN0aW9uUGF5bG9hZCh0YXJnZXQsIHNvdXJjZSkge1xuICBpZiAoc291cmNlLnByZWxvYWQpIHtcbiAgICBpZiAoIXRhcmdldC5wcmVsb2FkKSB0YXJnZXQucHJlbG9hZCA9IHt9XG4gICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRQcmVsb2FkKHRhcmdldC5wcmVsb2FkLCBzb3VyY2UucHJlbG9hZClcbiAgfVxuXG4gIGlmIChzb3VyY2Uuc2VsZWN0KSB7XG4gICAgaWYgKCF0YXJnZXQuc2VsZWN0KSB0YXJnZXQuc2VsZWN0ID0ge31cbiAgICBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFNlbGVjdCh0YXJnZXQuc2VsZWN0LCBzb3VyY2Uuc2VsZWN0KVxuICB9XG5cbiAgaWYgKHNvdXJjZS5zZWxlY3RzRXh0cmEpIHtcbiAgICBpZiAoIXRhcmdldC5zZWxlY3RzRXh0cmEpIHRhcmdldC5zZWxlY3RzRXh0cmEgPSB7fVxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50U2VsZWN0KHRhcmdldC5zZWxlY3RzRXh0cmEsIHNvdXJjZS5zZWxlY3RzRXh0cmEpXG4gIH1cblxuICBpZiAoc291cmNlLndpdGhDb3VudCkge1xuICAgIGlmICghdGFyZ2V0LndpdGhDb3VudCkgdGFyZ2V0LndpdGhDb3VudCA9IFtdXG4gICAgbWVyZ2VVbmlxdWVGcm9udGVuZE1vZGVsRXZlbnRFbnRyaWVzKHRhcmdldC53aXRoQ291bnQsIHNvdXJjZS53aXRoQ291bnQpXG4gIH1cblxuICBpZiAoc291cmNlLmFiaWxpdGllcykge1xuICAgIGlmICghdGFyZ2V0LmFiaWxpdGllcykgdGFyZ2V0LmFiaWxpdGllcyA9IFtdXG4gICAgbWVyZ2VVbmlxdWVGcm9udGVuZE1vZGVsRXZlbnRFbnRyaWVzKHRhcmdldC5hYmlsaXRpZXMsIHNvdXJjZS5hYmlsaXRpZXMpXG4gIH1cblxuICBpZiAoc291cmNlLnF1ZXJ5RGF0YSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgY29uc3QgdGFyZ2V0UXVlcnlEYXRhID0gQXJyYXkuaXNBcnJheSh0YXJnZXQucXVlcnlEYXRhKSA/IHRhcmdldC5xdWVyeURhdGEgOiBbXVxuXG4gICAgdGFyZ2V0LnF1ZXJ5RGF0YSA9IHRhcmdldFF1ZXJ5RGF0YVxuICAgIGNvbnN0IHF1ZXJ5RGF0YUVudHJpZXMgPSBBcnJheS5pc0FycmF5KHNvdXJjZS5xdWVyeURhdGEpID8gc291cmNlLnF1ZXJ5RGF0YSA6IFtzb3VyY2UucXVlcnlEYXRhXVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBxdWVyeURhdGFFbnRyaWVzKSB7XG4gICAgICB0YXJnZXRRdWVyeURhdGEucHVzaChlbnRyeSlcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIG1hdGNoZWQgZXZlbnQgZmlsdGVyIGtleXMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5IC0gUmF3IHdlYnNvY2tldCBldmVudCBib2R5LlxuICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIE1hdGNoZWQgZXZlbnQgZmlsdGVyIGtleXMgZGVsaXZlcmVkIGJ5IHRoZSBiYWNrZW5kLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsTWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyhib2R5KSB7XG4gIGlmICghYm9keSB8fCB0eXBlb2YgYm9keSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIG5ldyBTZXQoKVxuXG4gIGNvbnN0IGtleXMgPSAvKiogQHR5cGUge3ttYXRjaGVkRXZlbnRGaWx0ZXJLZXlzPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAoYm9keSkubWF0Y2hlZEV2ZW50RmlsdGVyS2V5c1xuXG4gIGlmICghQXJyYXkuaXNBcnJheShrZXlzKSkgcmV0dXJuIG5ldyBTZXQoKVxuXG4gIHJldHVybiBuZXcgU2V0KGtleXMubWFwKChrZXkpID0+IFN0cmluZyhrZXkpKSlcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGV2ZW50IGVudHJ5IG1hdGNoZXMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeTxhbnksIGFueT59IGVudHJ5IC0gQ2FsbGJhY2sgZW50cnkuXG4gKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzIC0gQmFja2VuZCBtYXRjaGVkIGZpbHRlciBrZXlzLlxuICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIGNhbGxiYWNrIHNob3VsZCByZWNlaXZlIHRoZSBldmVudC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEV2ZW50RW50cnlNYXRjaGVzKGVudHJ5LCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKSB7XG4gIGlmICghZW50cnkuZXZlbnRGaWx0ZXJLZXkpIHJldHVybiB0cnVlXG5cbiAgcmV0dXJuIG1hdGNoZWRFdmVudEZpbHRlcktleXMuaGFzKGVudHJ5LmV2ZW50RmlsdGVyS2V5KVxufVxuXG4vKipcbiAqIFJ1bnMgYXNzZXJ0IG5vIGRlc3Ryb3kgZXZlbnQgZmlsdGVyLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBFdmVudCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBvcHRpb25zIC0gRXZlbnQgb3B0aW9ucy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnROb0Rlc3Ryb3lFdmVudEZpbHRlcihNb2RlbENsYXNzLCBvcHRpb25zKSB7XG4gIGNvbnN0IGV2ZW50T3B0aW9uc1BheWxvYWQgPSBmcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZChNb2RlbENsYXNzLCBvcHRpb25zKVxuXG4gIGlmICghZXZlbnRPcHRpb25zUGF5bG9hZC5ldmVudEZpbHRlcktleSkgcmV0dXJuXG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgZGVzdHJveSBldmVudCBzdWJzY3JpcHRpb25zIGRvIG5vdCBzdXBwb3J0IHF1ZXJ5IGZpbHRlcnNcIilcbn1cblxuLyoqXG4gKiBQZXItbW9kZWwgY2xhc3Mgc2luZ2xldG9uIHRoYXQgbXVsdGlwbGV4ZXMgYWxsIHJlZ2lzdGVyZWQgb25DcmVhdGUgL1xuICogb25VcGRhdGUgLyBvbkRlc3Ryb3kgY2FsbGJhY2tzIOKAlCBjbGFzcy1sZXZlbCArIGluc3RhbmNlLWxldmVsIOKAlFxuICogb3ZlciBvbmUgV2Vic29ja2V0Q2hhbm5lbFYyIHN1YnNjcmlwdGlvbi4gU3Vic2NyaXB0aW9uIG9wZW5zIG9uIHRoZVxuICogZmlyc3QgbGlzdGVuZXIgYW5kIGNsb3NlcyB3aGVuIHRoZSBsYXN0IG9uZSB1bnN1YnNjcmliZXMuXG4gKlxuICogSW5zdGFuY2UtbGV2ZWwgbGlzdGVuZXJzIGFsc28gcmVjZWl2ZSBhdXRvLW1lcmdlOiB3aGVuIGFuIGB1cGRhdGVgXG4gKiBldmVudCBhcnJpdmVzIGZvciBhIHJlZ2lzdGVyZWQgaW5zdGFuY2UgaWQsIHRoZSBpbnN0YW5jZSdzXG4gKiBhdHRyaWJ1dGVzIGFyZSB1cGRhdGVkIGluIHBsYWNlIGJlZm9yZSB0aGUgY2FsbGJhY2sgZmlyZXMsIHNvXG4gKiBjYWxsZXJzIGNhbiByZWFkIGZyZXNoIHZhbHVlcyBmcm9tIHRoZSBzYW1lIGluc3RhbmNlIGhhbmRsZS5cbiAqL1xuY2xhc3MgRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MgZm9yIHRoaXMgc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0fSByZXF1ZXN0Q29udGV4dCAtIENhcHR1cmVkIHN1YnNjcmlwdGlvbiBjb250ZXh0LlxuICAgKi9cbiAgY29uc3RydWN0b3IoTW9kZWxDbGFzcywgcmVxdWVzdENvbnRleHQpIHtcbiAgICB0aGlzLk1vZGVsQ2xhc3MgPSBNb2RlbENsYXNzXG4gICAgdGhpcy5yZXF1ZXN0Q29udGV4dCA9IHJlcXVlc3RDb250ZXh0XG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtTZXQ8RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5PGFueSwgYW55Pj59ICovXG4gICAgdGhpcy5jbGFzc0NyZWF0ZUNhbGxiYWNrcyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeTxhbnksIGFueT4+fSAqL1xuICAgIHRoaXMuY2xhc3NVcGRhdGVDYWxsYmFja3MgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1NldDxGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50Q2FsbGJhY2tFbnRyeTxuZXZlcj4+fSAqL1xuICAgIHRoaXMuY2xhc3NEZXN0cm95Q2FsbGJhY2tzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7aW5zdGFuY2U6IEZyb250ZW5kTW9kZWxCYXNlLCB1cGRhdGVDYWxsYmFja3M6IFNldDxGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnk8YW55LCBhbnk+PiwgZGVzdHJveUNhbGxiYWNrczogU2V0PEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5PGFueT4+fT59ICovXG4gICAgdGhpcy5pbnN0YW5jZUxpc3RlbmVycyA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgdGhpcy5jaGFubmVsSGFuZGxlID0gbnVsbFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5yZWFkeVByb21pc2UgPSBudWxsXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtzdHJpbmcgfCBudWxsfSAqL1xuICAgIHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zS2V5ID0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Vic2NyaXB0aW9uIHBhcmFtcy5cbiAgICogQHJldHVybnMge3ttb2RlbDogc3RyaW5nLCBkZXN0cm95RXZlbnREZWxpdmVyeT86IGJvb2xlYW4sIGV2ZW50RmlsdGVycz86IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZEVudHJ5W10sIHVuZmlsdGVyZWRFdmVudERlbGl2ZXJ5PzogYm9vbGVhbn0gJiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH0gLSBDdXJyZW50IHdlYnNvY2tldCBzdWJzY3JpcHRpb24gcGFyYW1zLlxuICAgKi9cbiAgc3Vic2NyaXB0aW9uUGFyYW1zKCkge1xuICAgIC8qKlxuICAgICAqIFByb2plY3Rpb24gcGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9ICovXG4gICAgY29uc3QgcHJvamVjdGlvblBheWxvYWQgPSB7fVxuICAgIC8qKlxuICAgICAqIEV2ZW50IGZpbHRlcnMgYnkga2V5LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeT59ICovXG4gICAgY29uc3QgZXZlbnRGaWx0ZXJzQnlLZXkgPSB7fVxuICAgIGNvbnN0IHByb2plY3Rpb25FbnRyaWVzID0gW11cbiAgICBsZXQgaGFzRGVzdHJveUV2ZW50RGVsaXZlcnkgPSB0aGlzLmNsYXNzRGVzdHJveUNhbGxiYWNrcy5zaXplID4gMFxuICAgIGxldCBoYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHRoaXMuY2xhc3NDcmVhdGVDYWxsYmFja3MpIHByb2plY3Rpb25FbnRyaWVzLnB1c2goZW50cnkpXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLmNsYXNzVXBkYXRlQ2FsbGJhY2tzKSBwcm9qZWN0aW9uRW50cmllcy5wdXNoKGVudHJ5KVxuXG4gICAgZm9yIChjb25zdCBsaXN0ZW5lciBvZiB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLnZhbHVlcygpKSB7XG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcykgcHJvamVjdGlvbkVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgIGlmIChsaXN0ZW5lci5kZXN0cm95Q2FsbGJhY2tzLnNpemUgPiAwKSBoYXNEZXN0cm95RXZlbnREZWxpdmVyeSA9IHRydWVcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHByb2plY3Rpb25FbnRyaWVzKSB7XG4gICAgICBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByb2plY3Rpb25QYXlsb2FkKHByb2plY3Rpb25QYXlsb2FkLCBlbnRyeS5wcm9qZWN0aW9uUGF5bG9hZClcblxuICAgICAgaWYgKGVudHJ5LmV2ZW50RmlsdGVyS2V5ICYmIGVudHJ5LmV2ZW50RmlsdGVyUGF5bG9hZCkge1xuICAgICAgICBldmVudEZpbHRlcnNCeUtleVtlbnRyeS5ldmVudEZpbHRlcktleV0gPSB7XG4gICAgICAgICAgLi4uZW50cnkuZXZlbnRGaWx0ZXJQYXlsb2FkLFxuICAgICAgICAgIGtleTogZW50cnkuZXZlbnRGaWx0ZXJLZXlcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPSB0cnVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgZXZlbnRGaWx0ZXJzID0gT2JqZWN0LnZhbHVlcyhldmVudEZpbHRlcnNCeUtleSlcbiAgICBjb25zdCBldmVudEZpbHRlclBhcmFtcyA9IGV2ZW50RmlsdGVycy5sZW5ndGggPiAwXG4gICAgICA/IHtcbiAgICAgICAgICBldmVudEZpbHRlcnMsXG4gICAgICAgICAgLi4uKGhhc0Rlc3Ryb3lFdmVudERlbGl2ZXJ5ID8ge2Rlc3Ryb3lFdmVudERlbGl2ZXJ5OiB0cnVlfSA6IHt9KSxcbiAgICAgICAgICAuLi4oaGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPyB7dW5maWx0ZXJlZEV2ZW50RGVsaXZlcnk6IHRydWV9IDoge30pXG4gICAgICAgIH1cbiAgICAgIDoge31cblxuICAgIHJldHVybiBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChcbiAgICAgIHRoaXMucmVxdWVzdENvbnRleHQsXG4gICAgICB7XG4gICAgICAgIG1vZGVsOiB0aGlzLk1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgIC4uLmV2ZW50RmlsdGVyUGFyYW1zLFxuICAgICAgICAuLi5wcm9qZWN0aW9uUGF5bG9hZFxuICAgICAgfVxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1YnNjcmlwdGlvbiBwYXJhbXMganNvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTdGFibGUga2V5IGZvciBjdXJyZW50IHN1YnNjcmlwdGlvbiBwYXJhbXMuXG4gICAqL1xuICBzdWJzY3JpcHRpb25QYXJhbXNKc29uKCkge1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh0aGlzLnN1YnNjcmlwdGlvblBhcmFtcygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXIgY2xhc3MgY2FsbGJhY2suXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5PGFueSwgYW55PiB8IEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5PG5ldmVyPn0gVFxuICAgKiBAcGFyYW0ge1NldDxUPn0gY2FsbGJhY2tzIC0gQ2FsbGJhY2sgc2V0IGZvciB0aGUgZXZlbnQgdHlwZS5cbiAgICogQHBhcmFtIHtUfSBlbnRyeSAtIENhbGxiYWNrIGVudHJ5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIGFzeW5jIHJlZ2lzdGVyQ2xhc3NDYWxsYmFjayhjYWxsYmFja3MsIGVudHJ5KSB7XG4gICAgY2FsbGJhY2tzLmFkZChlbnRyeSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmVuc3VyZVN1YnNjcmliZWQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjYWxsYmFja3MuZGVsZXRlKGVudHJ5KVxuICAgICAgdGhpcy5tYXliZVRlYXJkb3duKClcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIGNhbGxiYWNrcy5kZWxldGUoZW50cnkpXG4gICAgICB0aGlzLm1heWJlVGVhcmRvd24oKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBzdWJzY3JpYmVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgYXN5bmMgZW5zdXJlU3Vic2NyaWJlZCgpIHtcbiAgICBjb25zdCBwYXJhbXNKc29uID0gdGhpcy5zdWJzY3JpcHRpb25QYXJhbXNKc29uKClcblxuICAgIGlmICh0aGlzLmNoYW5uZWxIYW5kbGUgJiYgIXRoaXMuY2hhbm5lbEhhbmRsZS5pc0Nsb3NlZCgpKSB7XG4gICAgICBpZiAodGhpcy5zdWJzY3JpcHRpb25QYXJhbXNLZXkgIT09IHBhcmFtc0pzb24pIHtcbiAgICAgICAgdGhpcy5jaGFubmVsSGFuZGxlLmNsb3NlKClcbiAgICAgICAgdGhpcy5jaGFubmVsSGFuZGxlID0gbnVsbFxuICAgICAgICB0aGlzLnJlYWR5UHJvbWlzZSA9IG51bGxcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICh0aGlzLnJlYWR5UHJvbWlzZSkgYXdhaXQgdGhpcy5yZWFkeVByb21pc2VcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU2VyaWFsaXplIHBhcmFsbGVsIGNhbGxzIChlLmcuIFByb21pc2UuYWxsKFtvbkNyZWF0ZSwgb25VcGRhdGUsXG4gICAgLy8gb25EZXN0cm95XSkpIHNvIHdlIG9wZW4gZXhhY3RseSBvbmUgc3Vic2NyaXB0aW9uIHBlciBtb2RlbCBjbGFzc1xuICAgIC8vIGluc3RlYWQgb2YgcmFjaW5nIHRocmVlIGNvbmN1cnJlbnQgc3Vic2NyaWJlQ2hhbm5lbCBjYWxscy5cbiAgICBpZiAodGhpcy5yZWFkeVByb21pc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVhZHlQcm9taXNlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBjbGllbnQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgfHwgcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkpXG5cbiAgICBpZiAoIWNsaWVudCB8fCB0eXBlb2YgY2xpZW50LnN1YnNjcmliZUNoYW5uZWwgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgZXZlbnQgc3Vic2NyaXB0aW9ucyByZXF1aXJlIGNvbmZpZ3VyZVRyYW5zcG9ydCh7d2Vic29ja2V0VXJsfSkgb3IgY29uZmlndXJlVHJhbnNwb3J0KHt3ZWJzb2NrZXRDbGllbnR9KVwiKVxuICAgIH1cblxuICAgIHRoaXMucmVhZHlQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGlmICh0eXBlb2YgY2xpZW50LmNvbm5lY3QgPT09IFwiZnVuY3Rpb25cIikgYXdhaXQgY2xpZW50LmNvbm5lY3QoKVxuXG4gICAgICBjb25zdCBwYXJhbXMgPSB0aGlzLnN1YnNjcmlwdGlvblBhcmFtcygpXG5cbiAgICAgIHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zS2V5ID0gSlNPTi5zdHJpbmdpZnkocGFyYW1zKVxuICAgICAgdGhpcy5jaGFubmVsSGFuZGxlID0gY2xpZW50LnN1YnNjcmliZUNoYW5uZWwoRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSwge1xuICAgICAgICBwYXJhbXMsXG4gICAgICAgIG9uTWVzc2FnZTogKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIGJvZHkpID0+IHRoaXMuX2Rpc3BhdGNoRXZlbnQoYm9keSksXG4gICAgICAgIG9uQ2xvc2U6ICgpID0+IHtcbiAgICAgICAgICB0aGlzLmNoYW5uZWxIYW5kbGUgPSBudWxsXG4gICAgICAgICAgdGhpcy5yZWFkeVByb21pc2UgPSBudWxsXG4gICAgICAgICAgdGhpcy5zdWJzY3JpcHRpb25QYXJhbXNLZXkgPSBudWxsXG4gICAgICAgICAgdGhpcy5pbnN0YW5jZUxpc3RlbmVycy5jbGVhcigpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICBhd2FpdCB0aGlzLmNoYW5uZWxIYW5kbGUucmVhZHlcbiAgICB9KSgpXG5cbiAgICBhd2FpdCB0aGlzLnJlYWR5UHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzcGF0Y2ggZXZlbnQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBXZWJTb2NrZXQgZXZlbnQgcGF5bG9hZC5cbiAgICovXG4gIF9kaXNwYXRjaEV2ZW50KGJvZHkpIHtcbiAgICBpZiAoIWJvZHkgfHwgdHlwZW9mIGJvZHkgIT09IFwib2JqZWN0XCIpIHJldHVyblxuXG4gICAgY29uc3QgYWN0aW9uID0gYm9keS5hY3Rpb25cbiAgICBjb25zdCByYXdJZCA9IGJvZHkuaWRcblxuICAgIGlmIChhY3Rpb24gIT09IFwiY3JlYXRlXCIgJiYgYWN0aW9uICE9PSBcInVwZGF0ZVwiICYmIGFjdGlvbiAhPT0gXCJkZXN0cm95XCIpIHJldHVyblxuICAgIGlmIChyYXdJZCA9PT0gdW5kZWZpbmVkIHx8IHJhd0lkID09PSBudWxsKSByZXR1cm5cblxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLk1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgaWRlbnRpdHkgPSBBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpXG4gICAgICA/IG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMocHJpbWFyeUtleSwgcmF3SWQpXG4gICAgICA6IFN0cmluZyhyYXdJZClcbiAgICBjb25zdCBpZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIGlkZW50aXR5KVxuICAgIGNvbnN0IHJhd1ByZXZpb3VzSWQgPSBib2R5LnByZXZpb3VzSWRcbiAgICBjb25zdCBwcmV2aW91c0lkZW50aXR5ID0gcmF3UHJldmlvdXNJZCA9PT0gdW5kZWZpbmVkIHx8IHJhd1ByZXZpb3VzSWQgPT09IG51bGxcbiAgICAgID8gbnVsbFxuICAgICAgOiBBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpXG4gICAgICAgID8gbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhwcmltYXJ5S2V5LCByYXdQcmV2aW91c0lkKVxuICAgICAgICA6IFN0cmluZyhyYXdQcmV2aW91c0lkKVxuICAgIGNvbnN0IHByZXZpb3VzSWQgPSBwcmV2aW91c0lkZW50aXR5ID09PSBudWxsXG4gICAgICA/IG51bGxcbiAgICAgIDogbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcHJldmlvdXNJZGVudGl0eSlcbiAgICBjb25zdCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzID0gZnJvbnRlbmRNb2RlbE1hdGNoZWRFdmVudEZpbHRlcktleXMoYm9keSlcblxuICAgIGlmIChhY3Rpb24gPT09IFwiZGVzdHJveVwiKSB7XG4gICAgICBjb25zdCBsaXN0ZW5lciA9IHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KGlkKVxuXG4gICAgICBpZiAobGlzdGVuZXIpIHtcbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBsaXN0ZW5lci5kZXN0cm95Q2FsbGJhY2tzKSB7XG4gICAgICAgICAgdHJ5IHsgZW50cnkuY2FsbGJhY2soe2lkOiBpZGVudGl0eX0pIH0gY2F0Y2ggKGVycm9yKSB7IGNvbnNvbGUuZXJyb3IoZXJyb3IpIH1cbiAgICAgICAgfVxuICAgICAgICBkZWxldGVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcih0aGlzLCBsaXN0ZW5lcilcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgdGhpcy5jbGFzc0Rlc3Ryb3lDYWxsYmFja3MpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAvKiogQHR5cGUgeyhwYXlsb2FkOiB7aWQ6IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSkgPT4gdm9pZH0gKi8gKGVudHJ5LmNhbGxiYWNrKSh7aWQ6IGlkZW50aXR5fSlcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHsgY29uc29sZS5lcnJvcihlcnJvcikgfVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgbGlzdGVuZXIgPSB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLmdldChpZCkgfHwgKHByZXZpb3VzSWQgPT09IG51bGwgPyB1bmRlZmluZWQgOiB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLmdldChwcmV2aW91c0lkKSlcblxuICAgIGlmIChhY3Rpb24gPT09IFwidXBkYXRlXCIgJiYgbGlzdGVuZXIgJiYgcHJldmlvdXNJZGVudGl0eSAhPT0gbnVsbCkge1xuICAgICAgYXBwbHlGcm9udGVuZE1vZGVsUGVyc2lzdGVkSWRlbnRpdHkodGhpcy5Nb2RlbENsYXNzLCBsaXN0ZW5lci5pbnN0YW5jZSwgaWRlbnRpdHkpXG4gICAgICByZWtleUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyh0aGlzLk1vZGVsQ2xhc3MsIGxpc3RlbmVyLmluc3RhbmNlLCBwcmV2aW91c0lkZW50aXR5LCBpZGVudGl0eSlcbiAgICB9XG5cbiAgICBpZiAoIWJvZHkucmVjb3JkIHx8IHR5cGVvZiBib2R5LnJlY29yZCAhPT0gXCJvYmplY3RcIikgcmV0dXJuXG5cbiAgICBjb25zdCBkZXNlcmlhbGl6ZWRSZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGJvZHkucmVjb3JkKSlcbiAgICBjb25zdCBmcmVzaE1vZGVsID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMuTW9kZWxDbGFzcykuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UoZGVzZXJpYWxpemVkUmVjb3JkKVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJ1cGRhdGVcIiAmJiBsaXN0ZW5lcikge1xuICAgICAgY29uc3QgaW5zdGFuY2VBbnkgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAobGlzdGVuZXIuaW5zdGFuY2UpXG5cbiAgICAgIGluc3RhbmNlQW55Ll9hdHRhY2htZW50T3duZXIgPSBmcmVzaE1vZGVsLl9hdHRhY2htZW50T3duZXJcblxuICAgICAgY29uc3QgbWF0Y2hpbmdVcGRhdGVDYWxsYmFja3MgPSBBcnJheS5mcm9tKGxpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcykuZmlsdGVyKChlbnRyeSkgPT5cbiAgICAgICAgZnJvbnRlbmRNb2RlbEV2ZW50RW50cnlNYXRjaGVzKGVudHJ5LCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKVxuICAgICAgKVxuXG4gICAgICBpZiAobWF0Y2hpbmdVcGRhdGVDYWxsYmFja3MubGVuZ3RoID4gMCkge1xuICAgICAgICAvLyBBdXRvLW1lcmdlIGludG8gdGhlIHJlZ2lzdGVyZWQgaW5zdGFuY2Ugc28gY2FsbGVycyByZWFkaW5nXG4gICAgICAgIC8vIHRocm91Z2ggdGhlIHNhbWUgaGFuZGxlIHNlZSBmcmVzaCBhdHRyaWJ1dGVzLlxuICAgICAgICBpbnN0YW5jZUFueS5hc3NpZ25BdHRyaWJ1dGVzKGZyZXNoTW9kZWwuYXR0cmlidXRlcygpKVxuICAgICAgICBpbnN0YW5jZUFueS5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMobGlzdGVuZXIuaW5zdGFuY2UuYXR0cmlidXRlcygpKVxuXG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbWF0Y2hpbmdVcGRhdGVDYWxsYmFja3MpIHtcbiAgICAgICAgICB0cnkgeyBlbnRyeS5jYWxsYmFjayh7aWQ6IGlkZW50aXR5LCBtb2RlbDogbGlzdGVuZXIuaW5zdGFuY2V9KSB9IGNhdGNoIChlcnJvcikgeyBjb25zb2xlLmVycm9yKGVycm9yKSB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjbGFzc0NhbGxiYWNrcyA9IGFjdGlvbiA9PT0gXCJjcmVhdGVcIiA/IHRoaXMuY2xhc3NDcmVhdGVDYWxsYmFja3MgOiB0aGlzLmNsYXNzVXBkYXRlQ2FsbGJhY2tzXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNsYXNzQ2FsbGJhY2tzKSB7XG4gICAgICBpZiAoIWZyb250ZW5kTW9kZWxFdmVudEVudHJ5TWF0Y2hlcyhlbnRyeSwgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cykpIGNvbnRpbnVlXG5cbiAgICAgIHRyeSB7IGVudHJ5LmNhbGxiYWNrKHtpZDogaWRlbnRpdHksIG1vZGVsOiBmcmVzaE1vZGVsfSkgfSBjYXRjaCAoZXJyb3IpIHsgY29uc29sZS5lcnJvcihlcnJvcikgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1heWJlIHRlYXJkb3duLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gKi9cbiAgbWF5YmVUZWFyZG93bigpIHtcbiAgICBjb25zdCBoYXNBbnlMaXN0ZW5lciA9IHRoaXMuY2xhc3NDcmVhdGVDYWxsYmFja3Muc2l6ZSA+IDBcbiAgICAgIHx8IHRoaXMuY2xhc3NVcGRhdGVDYWxsYmFja3Muc2l6ZSA+IDBcbiAgICAgIHx8IHRoaXMuY2xhc3NEZXN0cm95Q2FsbGJhY2tzLnNpemUgPiAwXG4gICAgICB8fCB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLnNpemUgPiAwXG5cbiAgICBpZiAoaGFzQW55TGlzdGVuZXIpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuY2hhbm5lbEhhbmRsZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5jaGFubmVsSGFuZGxlLmNsb3NlKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5jaGFubmVsSGFuZGxlID0gbnVsbFxuICAgIHRoaXMucmVhZHlQcm9taXNlID0gbnVsbFxuICAgIHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zS2V5ID0gbnVsbFxuICAgIHJlbGVhc2VGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24odGhpcylcbiAgfVxufVxuXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIGV2ZW50IHN1YnNjcmlwdGlvbnMuXG4gKiBAdHlwZSB7V2Vha01hcDxGcm9udGVuZE1vZGVsQ2xhc3MsIE1hcDxzdHJpbmcsIEZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbj4+fSAqL1xuY29uc3QgZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucyA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBSdW5zIGVuc3VyZSBmcm9udGVuZCBtb2RlbCBldmVudCBzdWJzY3JpcHRpb24uXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0fSByZXF1ZXN0Q29udGV4dCAtIENhcHR1cmVkIHN1YnNjcmlwdGlvbiBjb250ZXh0LlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gLSBQZXItY2xhc3Mgc3Vic2NyaXB0aW9uIGhlbHBlci5cbiAqL1xuZnVuY3Rpb24gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIHJlcXVlc3RDb250ZXh0KSB7XG4gIGxldCBzdWJzY3JpcHRpb25zID0gZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5nZXQoTW9kZWxDbGFzcylcblxuICBpZiAoIXN1YnNjcmlwdGlvbnMpIHtcbiAgICBzdWJzY3JpcHRpb25zID0gbmV3IE1hcCgpXG4gICAgZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5zZXQoTW9kZWxDbGFzcywgc3Vic2NyaXB0aW9ucylcbiAgfVxuXG4gIGNvbnN0IGNvbnRleHRLZXkgPSByZW1vdGVSZXF1ZXN0Q29udGV4dEtleShyZXF1ZXN0Q29udGV4dClcbiAgbGV0IHN1YiA9IHN1YnNjcmlwdGlvbnMuZ2V0KGNvbnRleHRLZXkpXG5cbiAgaWYgKCFzdWIpIHtcbiAgICBzdWIgPSBuZXcgRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIHJlcXVlc3RDb250ZXh0KVxuICAgIHN1YnNjcmlwdGlvbnMuc2V0KGNvbnRleHRLZXksIHN1YilcbiAgfVxuXG4gIHJldHVybiBzdWJcbn1cblxuLyoqXG4gKiBSZW1vdmVzIGFuIGVtcHR5IGNvbnRleHQgYnVja2V0IHNvIHN3aXRjaGluZyB0aHJvdWdoIG1hbnkgdGVuYW50cyBkb2VzIG5vdCByZXRhaW4gZXZlcnkgc25hcHNob3QuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gc3Vic2NyaXB0aW9uIC0gRW1wdHkgc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZWxlYXNlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKHN1YnNjcmlwdGlvbikge1xuICBjb25zdCBzdWJzY3JpcHRpb25zID0gZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5nZXQoc3Vic2NyaXB0aW9uLk1vZGVsQ2xhc3MpXG4gIGNvbnN0IGNvbnRleHRLZXkgPSByZW1vdGVSZXF1ZXN0Q29udGV4dEtleShzdWJzY3JpcHRpb24ucmVxdWVzdENvbnRleHQpXG5cbiAgaWYgKHN1YnNjcmlwdGlvbnM/LmdldChjb250ZXh0S2V5KSAhPT0gc3Vic2NyaXB0aW9uKSByZXR1cm5cblxuICBzdWJzY3JpcHRpb25zLmRlbGV0ZShjb250ZXh0S2V5KVxuICBpZiAoc3Vic2NyaXB0aW9ucy5zaXplID09PSAwKSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmRlbGV0ZShzdWJzY3JpcHRpb24uTW9kZWxDbGFzcylcbn1cblxuLyoqXG4gKiBDYXB0dXJlcyB0aGUgY3VycmVudCBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgY29udGV4dCBmb3Igb25lIG9wZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0fSBGcm96ZW4gY29udGV4dCBzbmFwc2hvdC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KCkge1xuICBjb25zdCBjb25maWd1cmVkQ29udGV4dCA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RDb250ZXh0ID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdENvbnRleHQoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0Q29udGV4dFxuXG4gIHJldHVybiBjYXB0dXJlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KGNvbmZpZ3VyZWRDb250ZXh0KVxufVxuXG4vKipcbiAqIENhcHR1cmVzIHRoZSBleHBsaWNpdCBsaWZlY3ljbGUgY29udGV4dCBvciBmYWxscyBiYWNrIHRvIHRoZSBjb25maWd1cmVkIHRyYW5zcG9ydCBjb250ZXh0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0IHwgdW5kZWZpbmVkfSByZXF1ZXN0Q29udGV4dCAtIFJlZ2lzdHJhdGlvbi1sb2NhbCBjb250ZXh0LlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHR9IEZyb3plbiBjb250ZXh0IHNuYXBzaG90LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsRXZlbnRSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCkge1xuICBpZiAocmVxdWVzdENvbnRleHQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCgpXG5cbiAgcmV0dXJuIGNhcHR1cmVGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpXG59XG5cbi8qKlxuICogUnVucyBlbnN1cmUgZnJvbnRlbmQgbW9kZWwgaW5zdGFuY2UgbGlzdGVuZXIuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gc3ViIC0gRXZlbnQgc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBpZCAtIE1vZGVsIGlkLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gaW5zdGFuY2UgLSBMaXN0ZW5lciBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHt7aW5zdGFuY2U6IEZyb250ZW5kTW9kZWxCYXNlLCB1cGRhdGVDYWxsYmFja3M6IFNldDxGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnk8YW55LCBhbnk+PiwgZGVzdHJveUNhbGxiYWNrczogU2V0PEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5PGFueT4+fX0gLSBJbnN0YW5jZSBsaXN0ZW5lciBidWNrZXQuXG4gKi9cbmZ1bmN0aW9uIGVuc3VyZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyKHN1YiwgaWQsIGluc3RhbmNlKSB7XG4gIGxldCBsaXN0ZW5lciA9IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQoaWQpXG5cbiAgaWYgKCFsaXN0ZW5lcikge1xuICAgIGxpc3RlbmVyID0ge2luc3RhbmNlLCB1cGRhdGVDYWxsYmFja3M6IG5ldyBTZXQoKSwgZGVzdHJveUNhbGxiYWNrczogbmV3IFNldCgpfVxuICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5zZXQoaWQsIGxpc3RlbmVyKVxuICB9IGVsc2Uge1xuICAgIGxpc3RlbmVyLmluc3RhbmNlID0gaW5zdGFuY2VcbiAgfVxuXG4gIHJldHVybiBsaXN0ZW5lclxufVxuXG4vKipcbiAqIFJlbW92ZXMgZXZlcnkgaWRlbnRpdHkga2V5IHBvaW50aW5nIGF0IGFuIGluc3RhbmNlIGxpc3RlbmVyLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb259IHN1YiAtIEV2ZW50IHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIGVuc3VyZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyPn0gbGlzdGVuZXIgLSBJbnN0YW5jZSBsaXN0ZW5lciBidWNrZXQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gZGVsZXRlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIoc3ViLCBsaXN0ZW5lcikge1xuICBmb3IgKGNvbnN0IFtpZCwgY3VycmVudF0gb2Ygc3ViLmluc3RhbmNlTGlzdGVuZXJzKSB7XG4gICAgaWYgKGN1cnJlbnQgPT09IGxpc3RlbmVyKSBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZGVsZXRlKGlkKVxuICB9XG59XG5cbi8qKlxuICogUmVtb3ZlcyBvbmUgaW5zdGFuY2UgY2FsbGJhY2sgZW50cnkgYW5kIHRlYXJzIGRvd24gYW4gZW1wdHkgbGlzdGVuZXIvc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufSBzdWIgLSBFdmVudCBzdWJzY3JpcHRpb24gYnVja2V0LlxuICogQHBhcmFtIHsobGlzdGVuZXI6IFJldHVyblR5cGU8dHlwZW9mIGVuc3VyZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyPikgPT4gYm9vbGVhbn0gcmVtb3ZlRW50cnkgLSBDYWxsYmFjayBlbnRyeSByZW1vdmFsLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCByZW1vdmVFbnRyeSkge1xuICBmb3IgKGNvbnN0IGN1cnJlbnQgb2Ygc3ViLmluc3RhbmNlTGlzdGVuZXJzLnZhbHVlcygpKSB7XG4gICAgaWYgKCFyZW1vdmVFbnRyeShjdXJyZW50KSkgY29udGludWVcblxuICAgIGlmIChjdXJyZW50LnVwZGF0ZUNhbGxiYWNrcy5zaXplID09PSAwICYmIGN1cnJlbnQuZGVzdHJveUNhbGxiYWNrcy5zaXplID09PSAwKSB7XG4gICAgICBkZWxldGVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGN1cnJlbnQpXG4gICAgfVxuICAgIGJyZWFrXG4gIH1cblxuICBzdWIubWF5YmVUZWFyZG93bigpXG59XG5cbi8qKlxuICogVGVtcG9yYXJpbHkgcmVnaXN0ZXJzIGFuIGluc3RhbmNlIGxpc3RlbmVyIHVuZGVyIGl0cyBwZW5kaW5nIGlkZW50aXR5IHdoaWxlIHJldGFpbmluZyBpdHMgcGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IGluc3RhbmNlIC0gSW5zdGFuY2UgYmVpbmcgcmUta2V5ZWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBwcmV2aW91c0lkZW50aXR5IC0gUGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gbmV4dElkZW50aXR5IC0gUGVuZGluZyBpZGVudGl0eSBzZW50IHRvIHRoZSBzZXJ2ZXIuXG4gKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gLSBDYWxsYmFjayB0aGF0IHJlbW92ZXMgdGhlIHRlbXBvcmFyeSBhbGlhc2VzLlxuICovXG5mdW5jdGlvbiBhbGlhc0Zyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyhNb2RlbENsYXNzLCBpbnN0YW5jZSwgcHJldmlvdXNJZGVudGl0eSwgbmV4dElkZW50aXR5KSB7XG4gIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICBjb25zdCBwcmV2aW91c0lkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcHJldmlvdXNJZGVudGl0eSlcbiAgY29uc3QgbmV4dElkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgbmV4dElkZW50aXR5KVxuICAvKiogQHR5cGUge0FycmF5PHtsaXN0ZW5lcjogUmV0dXJuVHlwZTx0eXBlb2YgZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXI+LCBzdWI6IEZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0+fSAqL1xuICBjb25zdCBhbGlhc2VzID0gW11cblxuICBpZiAocHJldmlvdXNJZCA9PT0gbmV4dElkKSByZXR1cm4gKCkgPT4ge31cblxuICBjb25zdCBzdWJzY3JpcHRpb25zID0gZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5nZXQoTW9kZWxDbGFzcylcblxuICBpZiAoIXN1YnNjcmlwdGlvbnMpIHJldHVybiAoKSA9PiB7fVxuXG4gIGZvciAoY29uc3Qgc3ViIG9mIHN1YnNjcmlwdGlvbnMudmFsdWVzKCkpIHtcbiAgICBjb25zdCBsaXN0ZW5lciA9IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQocHJldmlvdXNJZClcblxuICAgIGlmICghbGlzdGVuZXIgfHwgbGlzdGVuZXIuaW5zdGFuY2UgIT09IGluc3RhbmNlIHx8IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5oYXMobmV4dElkKSkgY29udGludWVcblxuICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5zZXQobmV4dElkLCBsaXN0ZW5lcilcbiAgICBhbGlhc2VzLnB1c2goe2xpc3RlbmVyLCBzdWJ9KVxuICB9XG5cbiAgcmV0dXJuICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IHtsaXN0ZW5lciwgc3VifSBvZiBhbGlhc2VzKSB7XG4gICAgICBpZiAoc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChwcmV2aW91c0lkKSA9PT0gbGlzdGVuZXIgJiYgc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChuZXh0SWQpID09PSBsaXN0ZW5lcikge1xuICAgICAgICBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZGVsZXRlKG5leHRJZClcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBBcHBsaWVzIGEgcmVtb3RlbHkgcGVyc2lzdGVkIGlkZW50aXR5IHRvIGEgbGlzdGVuZXIgaW5zdGFuY2Ugd2l0aG91dCBtZXJnaW5nIGFuIHVuYXZhaWxhYmxlIHJlY29yZCBwYXlsb2FkLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IGluc3RhbmNlIC0gTGlzdGVuZXIgaW5zdGFuY2UgcmVjZWl2aW5nIHRoZSBpZGVudGl0eS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkZW50aXR5IC0gUGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFwcGx5RnJvbnRlbmRNb2RlbFBlcnNpc3RlZElkZW50aXR5KE1vZGVsQ2xhc3MsIGluc3RhbmNlLCBpZGVudGl0eSkge1xuICBjb25zdCBpZGVudGl0eUF0dHJpYnV0ZXMgPSBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBpZGVudGl0eSlcblxuICBpbnN0YW5jZS5hc3NpZ25BdHRyaWJ1dGVzKGlkZW50aXR5QXR0cmlidXRlcylcblxuICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgT2JqZWN0LmtleXMoaWRlbnRpdHlBdHRyaWJ1dGVzKSkge1xuICAgIGluc3RhbmNlLm1hcmtBdHRyaWJ1dGVVbmNoYW5nZWQoYXR0cmlidXRlTmFtZSlcbiAgfVxufVxuXG4vKipcbiAqIE1vdmVzIGNhbGxiYWNrcyByZWdpc3RlcmVkIG9uIGFuIGluc3RhbmNlIHRvIGl0cyBuZXdseSBwZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gaW5zdGFuY2UgLSBSZS1rZXllZCBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IHByZXZpb3VzSWRlbnRpdHkgLSBQcmV2aW91cyBwZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBuZXh0SWRlbnRpdHkgLSBOZXcgcGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJla2V5RnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKE1vZGVsQ2xhc3MsIGluc3RhbmNlLCBwcmV2aW91c0lkZW50aXR5LCBuZXh0SWRlbnRpdHkpIHtcbiAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gIGNvbnN0IHByZXZpb3VzSWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkZW50aXR5KVxuICBjb25zdCBuZXh0SWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBuZXh0SWRlbnRpdHkpXG5cbiAgaWYgKHByZXZpb3VzSWQgPT09IG5leHRJZCkgcmV0dXJuXG5cbiAgY29uc3Qgc3Vic2NyaXB0aW9ucyA9IGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMuZ2V0KE1vZGVsQ2xhc3MpXG5cbiAgaWYgKCFzdWJzY3JpcHRpb25zKSByZXR1cm5cblxuICBmb3IgKGNvbnN0IHN1YiBvZiBzdWJzY3JpcHRpb25zLnZhbHVlcygpKSB7XG4gICAgY29uc3QgbGlzdGVuZXIgPSBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KHByZXZpb3VzSWQpXG5cbiAgICBpZiAoIWxpc3RlbmVyIHx8IGxpc3RlbmVyLmluc3RhbmNlICE9PSBpbnN0YW5jZSkgY29udGludWVcblxuICAgIGNvbnN0IG5leHRMaXN0ZW5lciA9IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQobmV4dElkKVxuXG4gICAgc3ViLmluc3RhbmNlTGlzdGVuZXJzLmRlbGV0ZShwcmV2aW91c0lkKVxuXG4gICAgaWYgKG5leHRMaXN0ZW5lcikge1xuICAgICAgbmV4dExpc3RlbmVyLmluc3RhbmNlID0gaW5zdGFuY2VcbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzKSBuZXh0TGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzLmFkZChlbnRyeSlcbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcykgbmV4dExpc3RlbmVyLmRlc3Ryb3lDYWxsYmFja3MuYWRkKGVudHJ5KVxuICAgIH0gZWxzZSB7XG4gICAgICBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuc2V0KG5leHRJZCwgbGlzdGVuZXIpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBjb21tYW5kIHVybC5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZXNvdXJjZVBhdGggLSBSZXNvdXJjZSBwYXRoIHByZWZpeC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBjb21tYW5kTmFtZSAtIENvbW1hbmQgcGF0aCBzZWdtZW50LlxuICogQHJldHVybnMge3N0cmluZ30gLSBGcm9udGVuZCBtb2RlbCBBUEkgVVJMLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQ29tbWFuZFVybChyZXNvdXJjZVBhdGgsIGNvbW1hbmROYW1lKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRVcmwgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VXJsKClcbiAgY29uc3Qgbm9ybWFsaXplZFJlc291cmNlUGF0aCA9IHJlc291cmNlUGF0aC5zdGFydHNXaXRoKFwiL1wiKSA/IHJlc291cmNlUGF0aCA6IGAvJHtyZXNvdXJjZVBhdGh9YFxuXG4gIHJldHVybiBgJHtjb25maWd1cmVkVXJsfSR7bm9ybWFsaXplZFJlc291cmNlUGF0aH0vJHtjb21tYW5kTmFtZX1gXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBhcGkgdXJsLlxuICogQHJldHVybnMge3N0cmluZ30gLSBTaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJIFVSTC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEFwaVVybCgpIHtcbiAgcmV0dXJuIGAke2Zyb250ZW5kTW9kZWxUcmFuc3BvcnRVcmwoKX0ke1NIQVJFRF9GUk9OVEVORF9NT0RFTF9BUElfUEFUSH1gXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgcGF0aC5cbiAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBSZXF1ZXN0IFVSTCBvciBwYXRoLlxuICogQHJldHVybnMge3N0cmluZ30gLSBXZWJzb2NrZXQtc2FmZSByZXF1ZXN0IHBhdGguXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRQYXRoKHVybCkge1xuICBpZiAodHlwZW9mIHVybCAhPT0gXCJzdHJpbmdcIiB8fCB1cmwubGVuZ3RoIDwgMSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IFVSTC9wYXRoLCBnb3Q6ICR7dXJsfWApXG4gIH1cblxuICBpZiAodXJsLnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgcmV0dXJuIHVybFxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWRVcmwgPSBuZXcgVVJMKHVybClcblxuICAgIHJldHVybiBgJHtwYXJzZWRVcmwucGF0aG5hbWV9JHtwYXJzZWRVcmwuc2VhcmNofWBcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHVybFxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGJyb3dzZXIgcnVudGltZSB0aW1lem9uZSB3aGVuIGF2YWlsYWJsZS5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQnJvd3NlciBydW50aW1lIHRpbWV6b25lIHdoZW4gYXZhaWxhYmxlLlxuICovXG5mdW5jdGlvbiBkZWZhdWx0RnJvbnRlbmRNb2RlbFRpbWVab25lKCkge1xuICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIHVuZGVmaW5lZFxuXG4gIGNvbnN0IGludGwgPSBnbG9iYWxUaGlzLkludGxcblxuICBpZiAoIWludGwpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBJbnRsIHRvIGJlIGF2YWlsYWJsZSBmb3IgYnJvd3NlciB0aW1lem9uZSBkZXRlY3Rpb25cIilcbiAgfVxuXG4gIGlmICh0eXBlb2YgaW50bC5EYXRlVGltZUZvcm1hdCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgSW50bC5EYXRlVGltZUZvcm1hdCB0byBiZSBhdmFpbGFibGUgYXMgYSBmdW5jdGlvblwiKVxuICB9XG5cbiAgY29uc3QgdGltZVpvbmUgPSBpbnRsLkRhdGVUaW1lRm9ybWF0KCkucmVzb2x2ZWRPcHRpb25zKCkudGltZVpvbmVcblxuICBpZiAodHlwZW9mIHRpbWVab25lICE9PSBcInN0cmluZ1wiIHx8IHRpbWVab25lLnRyaW0oKS5sZW5ndGggPCAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgSW50bC5EYXRlVGltZUZvcm1hdCB0byByZXNvbHZlIGEgYnJvd3NlciB0aW1lem9uZSBzdHJpbmdcIilcbiAgfVxuXG4gIHJldHVybiB2YWxpZGF0ZVRpbWVab25lKHRpbWVab25lLCBcImJyb3dzZXIgdGltZVpvbmVcIilcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgY29uZmlndXJlZCBmcm9udGVuZC1tb2RlbCByZXF1ZXN0IHRpbWV6b25lLlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIGZyb250ZW5kLW1vZGVsIHRpbWV6b25lLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKSB7XG4gIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcsIFwidGltZVpvbmVcIikpIHtcbiAgICByZXR1cm4gZGVmYXVsdEZyb250ZW5kTW9kZWxUaW1lWm9uZSgpXG4gIH1cblxuICBjb25zdCB0aW1lWm9uZSA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZVpvbmUoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lWm9uZVxuXG4gIGlmICh0aW1lWm9uZSA9PT0gdW5kZWZpbmVkIHx8IHRpbWVab25lID09PSBudWxsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHRpbWVab25lIGRpZCBub3QgcmVzb2x2ZSB0byBhIHRpbWV6b25lIHN0cmluZ1wiKVxuICB9XG5cbiAgcmV0dXJuIHZhbGlkYXRlVGltZVpvbmUodGltZVpvbmUsIFwiZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHRpbWVab25lXCIpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCByZXF1ZXN0IGhlYWRlcnMuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gW3RpbWVab25lXSAtIFByZS1yZXNvbHZlZCB0aW1lem9uZSBmb3IgdGhpcyByZXF1ZXN0LlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gSGVhZGVycyBmb3IgZnJvbnRlbmQtbW9kZWwgSFRUUCByZXF1ZXN0cy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlcXVlc3RIZWFkZXJzKHRpbWVab25lID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKCkpIHtcbiAgY29uc3QgZHluYW1pY0hlYWRlcnMgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0SGVhZGVycyA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0SGVhZGVycygpIHx8IHt9KVxuICAgIDogKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdEhlYWRlcnMgfHwge30pXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgY29uc3QgaGVhZGVycyA9IHtcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiwgLi4uZHluYW1pY0hlYWRlcnN9XG5cbiAgaWYgKHRpbWVab25lKSB7XG4gICAgaGVhZGVyc1tSRVFVRVNUX1RJTUVfWk9ORV9IRUFERVJdID0gdGltZVpvbmVcbiAgfVxuXG4gIHJldHVybiBoZWFkZXJzXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGNvbmZpZ3VyZWQgYm91bmRlZCB0cmFuc3BvcnQgZGVhZGxpbmUgaW4gbWlsbGlzZWNvbmRzLlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIGRlYWRsaW5lLCBvciB1bmRlZmluZWQgd2hlbiBubyBkZWFkbGluZSBpcyBzZXQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lb3V0TXMoKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRUaW1lb3V0ID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZW91dCA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVvdXQoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lb3V0XG5cbiAgaWYgKHR5cGVvZiBjb25maWd1cmVkVGltZW91dCAhPT0gXCJudW1iZXJcIiB8fCAhKGNvbmZpZ3VyZWRUaW1lb3V0ID4gMCkpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICByZXR1cm4gY29uZmlndXJlZFRpbWVvdXRcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgY29uZmlndXJlZCBjYWxsZXIvc2Vzc2lvbiBBYm9ydFNpZ25hbCBjb21wb3NlZCB3aXRoIHRoZSBkZWFkbGluZS5cbiAqIEByZXR1cm5zIHtBYm9ydFNpZ25hbCB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIGNhbGxlciBzaWduYWwsIG9yIHVuZGVmaW5lZCB3aGVuIG5vbmUgaXMgc2V0LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCkge1xuICBjb25zdCBjb25maWd1cmVkU2lnbmFsID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsKClcbiAgICA6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsXG5cbiAgcmV0dXJuIGNvbmZpZ3VyZWRTaWduYWwgfHwgdW5kZWZpbmVkXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgcGVyLXN0YXJ0dXAgY29udHJvbHMgd2l0aCB0aGUgY29uZmlndXJlZCBzZXNzaW9uIGNhbmNlbGxhdGlvbi5cbiAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWx9fSBjb250cm9scyAtIENhbGwgY29udHJvbHMuXG4gKiBAcmV0dXJucyB7e3RpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWx9fSAtIEVmZmVjdGl2ZSBzdGFydHVwIGNvbnRyb2xzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKGNvbnRyb2xzKSB7XG4gIGNvbnN0IHNlc3Npb25TaWduYWwgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKClcbiAgbGV0IHNpZ25hbCA9IGNvbnRyb2xzLnNpZ25hbCB8fCBzZXNzaW9uU2lnbmFsXG5cbiAgaWYgKGNvbnRyb2xzLnNpZ25hbCAmJiBzZXNzaW9uU2lnbmFsICYmIGNvbnRyb2xzLnNpZ25hbCAhPT0gc2Vzc2lvblNpZ25hbCkge1xuICAgIHNpZ25hbCA9IEFib3J0U2lnbmFsLmFueShbY29udHJvbHMuc2lnbmFsLCBzZXNzaW9uU2lnbmFsXSlcbiAgfVxuXG4gIGNvbnN0IGNvbmZpZ3VyZWRUaW1lb3V0TXMgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKClcbiAgY29uc3QgdGltZW91dE1zID0gY29udHJvbHMudGltZW91dE1zID09PSB1bmRlZmluZWRcbiAgICA/IGNvbmZpZ3VyZWRUaW1lb3V0TXNcbiAgICA6IGNvbmZpZ3VyZWRUaW1lb3V0TXMgPT09IHVuZGVmaW5lZFxuICAgICAgPyBjb250cm9scy50aW1lb3V0TXNcbiAgICAgIDogTWF0aC5taW4oY29udHJvbHMudGltZW91dE1zLCBjb25maWd1cmVkVGltZW91dE1zKVxuXG4gIHJldHVybiB7c2lnbmFsLCB0aW1lb3V0TXN9XG59XG5cbi8qKlxuICogUnVucyBwZXJmb3JtIHNoYXJlZCBmcm9udGVuZCBtb2RlbCBhcGkgcmVxdWVzdC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByZXF1ZXN0UGF5bG9hZCAtIFNoYXJlZCByZXF1ZXN0IHBheWxvYWQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIERlY29kZWQgc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSByZXNwb25zZS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcGVyZm9ybVNoYXJlZEZyb250ZW5kTW9kZWxBcGlSZXF1ZXN0KHJlcXVlc3RQYXlsb2FkKSB7XG4gIGNvbnN0IHRpbWVab25lID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKClcbiAgY29uc3Qgc2VyaWFsaXplZFJlcXVlc3RQYXlsb2FkID0gc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHJlcXVlc3RQYXlsb2FkLCB7dGltZVpvbmV9KVxuICBjb25zdCB3ZWJzb2NrZXRDbGllbnQgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudFxuICBjb25zdCB1cmwgPSBmcm9udGVuZE1vZGVsQXBpVXJsKClcbiAgY29uc3QgbWVyZ2VkSGVhZGVycyA9IGZyb250ZW5kTW9kZWxSZXF1ZXN0SGVhZGVycyh0aW1lWm9uZSlcblxuICByZXR1cm4gYXdhaXQgcnVuV2l0aFRyYW5zcG9ydERlYWRsaW5lKFxuICAgIHtcbiAgICAgIGVycm9yTWVzc2FnZTogXCJTaGFyZWQgZnJvbnRlbmQgbW9kZWwgQVBJIHJlcXVlc3QgdGltZWQgb3V0XCIsXG4gICAgICBzaWduYWw6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSxcbiAgICAgIHRpbWVvdXRNczogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVvdXRNcygpXG4gICAgfSxcbiAgICBhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICBpZiAod2Vic29ja2V0Q2xpZW50KSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgd2Vic29ja2V0Q2xpZW50LnBvc3QoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFBhdGgodXJsKSwgc2VyaWFsaXplZFJlcXVlc3RQYXlsb2FkLCB7XG4gICAgICAgICAgaGVhZGVyczogbWVyZ2VkSGVhZGVycyxcbiAgICAgICAgICBzaWduYWxcbiAgICAgICAgfSlcbiAgICAgICAgY29uc3QgcmVzcG9uc2VKc29uID0gcmVzcG9uc2UuanNvbigpXG5cbiAgICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocmVzcG9uc2VKc29uKSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoc2VyaWFsaXplZFJlcXVlc3RQYXlsb2FkKSxcbiAgICAgICAgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiLFxuICAgICAgICBoZWFkZXJzOiBtZXJnZWRIZWFkZXJzLFxuICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICBzaWduYWxcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlVGV4dCA9IGF3YWl0IHJlc3BvbnNlLnRleHQoKVxuXG4gICAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICAgIHRocm93RnJvbnRlbmRNb2RlbEh0dHBFcnJvcih7XG4gICAgICAgICAgY29tbWFuZExhYmVsOiBcInNoYXJlZCBmcm9udGVuZCBtb2RlbCBBUElcIixcbiAgICAgICAgICByZXNwb25zZSxcbiAgICAgICAgICByZXNwb25zZVRleHRcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgY29uc3QganNvbiA9IHJlc3BvbnNlVGV4dC5sZW5ndGggPiAwID8gSlNPTi5wYXJzZShyZXNwb25zZVRleHQpIDoge31cblxuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoanNvbikpXG4gICAgfVxuICApXG59XG5cbi8qKlxuICogVGhyb3dzIGEgZnJvbnRlbmQtbW9kZWwgSFRUUCBlcnJvciB3aXRoIGJhY2tlbmQtcHJvdmlkZWQgZW52ZWxvcGUgZGV0YWlscyB3aGVuIGF2YWlsYWJsZS5cbiAqIEBwYXJhbSB7e2NvbW1hbmRMYWJlbDogc3RyaW5nLCByZXNwb25zZTogUmVzcG9uc2UsIHJlc3BvbnNlVGV4dDogc3RyaW5nfX0gYXJncyAtIEVycm9yIHJlc3BvbnNlIGRldGFpbHMuXG4gKiBAcmV0dXJucyB7bmV2ZXJ9IC0gQWx3YXlzIHRocm93cyBhbiB1bmtub3duLWF0dHJpYnV0ZSBlcnJvci5cbiAqL1xuZnVuY3Rpb24gdGhyb3dGcm9udGVuZE1vZGVsSHR0cEVycm9yKHtjb21tYW5kTGFiZWwsIHJlc3BvbnNlLCByZXNwb25zZVRleHR9KSB7XG4gIC8vIFN1cmZhY2UgdGhlIGJhY2tlbmQncyBmcmllbmRseSBlcnJvck1lc3NhZ2UgZW52ZWxvcGUgKHRoZVxuICAvLyBge3N0YXR1czogXCJlcnJvclwiLCBlcnJvck1lc3NhZ2U6IFwiLi4uXCJ9YCBzaGFwZSBldmVyeSBjb250cm9sbGVyXG4gIC8vIHNoaXBzIG9uIGl0cyA0eHgvNXh4IHJlc3BvbnNlcykgaW5zdGVhZCBvZiB0aGUgZ2VuZXJpYyBzdGF0dXNcbiAgLy8gc3RyaW5nLiBGYWxsIHRocm91Z2ggdG8gdGhlIHN0YXR1cy1vbmx5IG1lc3NhZ2Ugd2hlbiB0aGUgYm9keSBpc1xuICAvLyBtaXNzaW5nLCBub24tSlNPTiwgb3IgaGFzIG5vIHVzYWJsZSBlcnJvck1lc3NhZ2UgZmllbGQuXG4gIGNvbnN0IHJlc3BvbnNlQ29udGVudFR5cGUgPSByZXNwb25zZS5oZWFkZXJzLmdldChcImNvbnRlbnQtdHlwZVwiKVxuXG4gIGlmIChyZXNwb25zZUNvbnRlbnRUeXBlICYmIHJlc3BvbnNlQ29udGVudFR5cGUuaW5jbHVkZXMoXCJhcHBsaWNhdGlvbi9qc29uXCIpICYmIHJlc3BvbnNlVGV4dC5sZW5ndGggPiAwKSB7XG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBlcnJvckJvZHkuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9ICovXG4gICAgbGV0IGVycm9yQm9keVxuXG4gICAgdHJ5IHtcbiAgICAgIGVycm9yQm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2VUZXh0KVxuICAgIH0gY2F0Y2gge1xuICAgICAgZXJyb3JCb2R5ID0gbnVsbFxuICAgIH1cblxuICAgIGlmIChlcnJvckJvZHkgJiYgdHlwZW9mIGVycm9yQm9keS5lcnJvck1lc3NhZ2UgPT09IFwic3RyaW5nXCIgJiYgZXJyb3JCb2R5LmVycm9yTWVzc2FnZS50cmltKCkubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yQm9keS5lcnJvck1lc3NhZ2UudHJpbSgpKVxuICAgIH1cbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihgUmVxdWVzdCBmYWlsZWQgKCR7cmVzcG9uc2Uuc3RhdHVzfSkgZm9yICR7Y29tbWFuZExhYmVsfWApXG59XG5cbi8qKlxuICogUnVucyBmbHVzaCBwZW5kaW5nIHNoYXJlZCBmcm9udGVuZCBtb2RlbCByZXF1ZXN0cy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHBlbmRpbmcgc2hhcmVkIGZyb250ZW5kLW1vZGVsIHJlcXVlc3RzIGZsdXNoLlxuICovXG5hc3luYyBmdW5jdGlvbiBmbHVzaFBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMoKSB7XG4gIHNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZCA9IGZhbHNlXG5cbiAgaWYgKHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMubGVuZ3RoIDwgMSkge1xuICAgIHJlc29sdmVGcm9udGVuZE1vZGVsSWRsZVdhaXRlcnMoKVxuICAgIHJldHVyblxuICB9XG5cbiAgY29uc3QgYmF0Y2hlZFJlcXVlc3RzID0gcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0c1xuICBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzID0gW11cblxuICBjb25zdCB1cmwgPSBmcm9udGVuZE1vZGVsQXBpVXJsKClcbiAgY29uc3QgcmVxdWVzdFBheWxvYWQgPSB7XG4gICAgcmVxdWVzdHM6IGJhdGNoZWRSZXF1ZXN0cy5tYXAoKHJlcXVlc3QpID0+IHtcbiAgICAgIGlmIChyZXF1ZXN0LmN1c3RvbVBhdGgpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kVHlwZTogcmVxdWVzdC5jb21tYW5kVHlwZSxcbiAgICAgICAgICBjdXN0b21QYXRoOiByZXF1ZXN0LmN1c3RvbVBhdGgsXG4gICAgICAgICAgbW9kZWw6IHJlcXVlc3QubW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgICBwYXlsb2FkOiByZXF1ZXN0LnBheWxvYWQsXG4gICAgICAgICAgLi4uKE9iamVjdC5rZXlzKHJlcXVlc3QucmVxdWVzdENvbnRleHQpLmxlbmd0aCA+IDAgPyB7cmVxdWVzdENvbnRleHQ6IHJlcXVlc3QucmVxdWVzdENvbnRleHR9IDoge30pLFxuICAgICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdC5yZXF1ZXN0SWRcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb21tYW5kVHlwZTogcmVxdWVzdC5jb21tYW5kVHlwZSxcbiAgICAgICAgbW9kZWw6IHJlcXVlc3QubW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgcGF5bG9hZDogcmVxdWVzdC5wYXlsb2FkLFxuICAgICAgICAuLi4oT2JqZWN0LmtleXMocmVxdWVzdC5yZXF1ZXN0Q29udGV4dCkubGVuZ3RoID4gMCA/IHtyZXF1ZXN0Q29udGV4dDogcmVxdWVzdC5yZXF1ZXN0Q29udGV4dH0gOiB7fSksXG4gICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdC5yZXF1ZXN0SWRcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgYXdhaXQgdHJhY2tGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdChhc3luYyAoKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIHZvaWQgdXJsXG4gICAgICBjb25zdCBkZWNvZGVkUmVzcG9uc2UgPSBhd2FpdCBwZXJmb3JtU2hhcmVkRnJvbnRlbmRNb2RlbEFwaVJlcXVlc3QocmVxdWVzdFBheWxvYWQpXG4gICAgICBjb25zdCByZXNwb25zZXMgPSBBcnJheS5pc0FycmF5KGRlY29kZWRSZXNwb25zZS5yZXNwb25zZXMpID8gZGVjb2RlZFJlc3BvbnNlLnJlc3BvbnNlcyA6IFtdXG4gICAgICBjb25zdCByZXNwb25zZXNCeUlkID0gbmV3IE1hcChyZXNwb25zZXMubWFwKChlbnRyeSkgPT4gW2VudHJ5LnJlcXVlc3RJZCwgZW50cnkucmVzcG9uc2VdKSlcblxuICAgICAgZm9yIChjb25zdCByZXF1ZXN0IG9mIGJhdGNoZWRSZXF1ZXN0cykge1xuICAgICAgICBjb25zdCByZXNwb25zZVBheWxvYWQgPSByZXNwb25zZXNCeUlkLmdldChyZXF1ZXN0LnJlcXVlc3RJZClcblxuICAgICAgICBpZiAoIXJlc3BvbnNlUGF5bG9hZCB8fCB0eXBlb2YgcmVzcG9uc2VQYXlsb2FkICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICAgICAgcmVxdWVzdC5yZWplY3QobmV3IEVycm9yKGBNaXNzaW5nIGJhdGNoZWQgcmVzcG9uc2UgZm9yICR7cmVxdWVzdC5tb2RlbENsYXNzLm5hbWV9IyR7cmVxdWVzdC5jb21tYW5kVHlwZX1gKSlcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgcmVxdWVzdC5yZXNvbHZlKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocmVzcG9uc2VQYXlsb2FkKSlcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZm9yIChjb25zdCByZXF1ZXN0IG9mIGJhdGNoZWRSZXF1ZXN0cykge1xuICAgICAgICByZXF1ZXN0LnJlamVjdChlcnJvcilcbiAgICAgIH1cbiAgICB9XG4gIH0pXG59XG5cbi8qKlxuICogUnVucyBzY2hlZHVsZSBzaGFyZWQgZnJvbnRlbmQgbW9kZWwgcmVxdWVzdCBmbHVzaC5cbiAqIEByZXR1cm5zIHt2b2lkfSAqL1xuZnVuY3Rpb24gc2NoZWR1bGVTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdEZsdXNoKCkge1xuICBpZiAoc2hhcmVkRnJvbnRlbmRNb2RlbEZsdXNoU2NoZWR1bGVkKSByZXR1cm5cblxuICBzaGFyZWRGcm9udGVuZE1vZGVsRmx1c2hTY2hlZHVsZWQgPSB0cnVlXG4gIHF1ZXVlTWljcm90YXNrKCgpID0+IHtcbiAgICB2b2lkIGZsdXNoUGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cygpXG4gIH0pXG59XG5cbi8qKlxuICogQ3VzdG9tIGNvbW1hbmRzIHN0aWxsIHVzZSB0aGUgc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSS4gVGhpcyBoZWxwZXIgb25seSBidWlsZHMgdGhlIGJhY2tlbmQgcm91dGUgcGF0aCB0aGUgc2VydmVyIHNob3VsZCBkaXNwYXRjaCBhZnRlciB2YWxpZGF0aW5nIHRoZSBzZWdtZW50cy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29tbWFuZE5hbWUgLSBDb21tYW5kIHBhdGggc2VnbWVudC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1vZGVsTmFtZSAtIEZyb250ZW5kIG1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IFthcmdzLm1lbWJlcklkXSAtIE9wdGlvbmFsIG1lbWJlciBpZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlUGF0aCAtIFJlc291cmNlIHBhdGggcHJlZml4LlxuICogQHJldHVybnMge3N0cmluZ30gLSBDdXN0b20gYmFja2VuZCByb3V0ZSBwYXRoLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZFBhdGgoe2NvbW1hbmROYW1lLCBtZW1iZXJJZCwgbW9kZWxOYW1lLCByZXNvdXJjZVBhdGh9KSB7XG4gIGNvbnN0IHZhbGlkYXRlZFJlc291cmNlUGF0aCA9IHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aCh7bW9kZWxOYW1lLCByZXNvdXJjZVBhdGh9KVxuICBjb25zdCB2YWxpZGF0ZWRDb21tYW5kTmFtZSA9IHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWUoe2NvbW1hbmROYW1lLCBjb21tYW5kVHlwZTogY29tbWFuZE5hbWUsIG1vZGVsTmFtZX0pXG5cbiAgaWYgKG1lbWJlcklkID09PSB1bmRlZmluZWQgfHwgbWVtYmVySWQgPT09IG51bGwgfHwgbWVtYmVySWQgPT09IFwiXCIpIHtcbiAgICByZXR1cm4gYCR7dmFsaWRhdGVkUmVzb3VyY2VQYXRofS8ke3ZhbGlkYXRlZENvbW1hbmROYW1lfWBcbiAgfVxuXG4gIHJldHVybiBgJHt2YWxpZGF0ZWRSZXNvdXJjZVBhdGh9LyR7ZW5jb2RlVVJJQ29tcG9uZW50KFN0cmluZyhtZW1iZXJJZCkpfS8ke3ZhbGlkYXRlZENvbW1hbmROYW1lfWBcbn1cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBmaW5kIGJ5IGNvbmRpdGlvbnMgc2hhcGUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjb25kaXRpb25zIC0gZmluZEJ5IGNvbmRpdGlvbnMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0RmluZEJ5Q29uZGl0aW9uc1NoYXBlKGNvbmRpdGlvbnMpIHtcbiAgaWYgKCFjb25kaXRpb25zIHx8IHR5cGVvZiBjb25kaXRpb25zICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoY29uZGl0aW9ucykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBleHBlY3RzIGNvbmRpdGlvbnMgdG8gYmUgYSBwbGFpbiBvYmplY3QsIGdvdDogJHtjb25kaXRpb25zfWApXG4gIH1cblxuICBjb25zdCBjb25kaXRpb25zUHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGNvbmRpdGlvbnMpXG5cbiAgaWYgKGNvbmRpdGlvbnNQcm90b3R5cGUgIT09IE9iamVjdC5wcm90b3R5cGUgJiYgY29uZGl0aW9uc1Byb3RvdHlwZSAhPT0gbnVsbCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGV4cGVjdHMgY29uZGl0aW9ucyB0byBiZSBhIHBsYWluIG9iamVjdCwgZ290OiAke2NvbmRpdGlvbnN9YClcbiAgfVxuXG4gIGNvbnN0IHN5bWJvbEtleXMgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlTeW1ib2xzKGNvbmRpdGlvbnMpXG5cbiAgaWYgKHN5bWJvbEtleXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgc3ltYm9sIGNvbmRpdGlvbiBrZXlzIChrZXlzOiAke3N5bWJvbEtleXMubWFwKChrZXkpID0+IGtleS50b1N0cmluZygpKS5qb2luKFwiLCBcIil9KWApXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBkZWZpbmVkIGZpbmQgYnkgY29uZGl0aW9uIHZhbHVlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDb25kaXRpb24gdmFsdWUgdG8gdmFsaWRhdGUuXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5UGF0aCAtIEtleSBwYXRoIGZvciBlcnJvciBvdXRwdXQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0RGVmaW5lZEZpbmRCeUNvbmRpdGlvblZhbHVlKHZhbHVlLCBrZXlQYXRoKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCB1bmRlZmluZWQgY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IGZ1bmN0aW9uIGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzeW1ib2xcIikge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgc3ltYm9sIGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJiaWdpbnRcIikge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgYmlnaW50IGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiAhTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgbm9uLWZpbml0ZSBudW1iZXIgY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICB2YWx1ZS5mb3JFYWNoKChlbnRyeSwgaW5kZXgpID0+IHtcbiAgICAgIGFzc2VydERlZmluZWRGaW5kQnlDb25kaXRpb25WYWx1ZShlbnRyeSwgYCR7a2V5UGF0aH1bJHtpbmRleH1dYClcbiAgICB9KVxuICAgIHJldHVyblxuICB9XG5cbiAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIikge1xuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IG9iamVjdFZhbHVlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh2YWx1ZSlcbiAgICBjb25zdCBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2Yob2JqZWN0VmFsdWUpXG5cbiAgICBpZiAocHJvdG90eXBlICE9PSBPYmplY3QucHJvdG90eXBlICYmIHByb3RvdHlwZSAhPT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBub24tcGxhaW4gb2JqZWN0IGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICAgIH1cblxuICAgIGNvbnN0IHN5bWJvbEtleXMgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlTeW1ib2xzKG9iamVjdFZhbHVlKVxuXG4gICAgaWYgKHN5bWJvbEtleXMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBzeW1ib2wgY29uZGl0aW9uIGtleXMgKGtleTogJHtrZXlQYXRofSlgKVxuICAgIH1cblxuICAgIGNvbnN0IHZhbHVlT2JqZWN0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh2YWx1ZSlcblxuICAgIE9iamVjdC5rZXlzKHZhbHVlT2JqZWN0KS5mb3JFYWNoKChuZXN0ZWRLZXkpID0+IHtcbiAgICAgIGFzc2VydERlZmluZWRGaW5kQnlDb25kaXRpb25WYWx1ZSh2YWx1ZU9iamVjdFtuZXN0ZWRLZXldLCBgJHtrZXlQYXRofS4ke25lc3RlZEtleX1gKVxuICAgIH0pXG4gIH1cbn1cblxuLyoqXG4gKiBCYXNlIGZyb250ZW5kIG1vZGVsLlxuICpcbiAqIERlZmF1bHRzIGFyZSBgYW55YCBzbyB0aGUgYmFyZSBgRnJvbnRlbmRNb2RlbEJhc2VgIOKAlCB1c2VkIHRocm91Z2hvdXQgYXMgYVxuICogY29uc3RyYWludC9wYXJhbWV0ZXIgdHlwZSBmb3IgXCJhbnkgZnJvbnRlbmQgbW9kZWxcIiDigJQgYWNjZXB0cyBnZW5lcmF0ZWRcbiAqIHN1YmNsYXNzZXMgZGVjbGFyaW5nIHR5cGVkLWF0dHJpYnV0ZSBnZW5lcmljcyAoYEZyb250ZW5kTW9kZWxCYXNlPFhBdHRyaWJ1dGVzLFxuICogLi4uPmApLiBBIGNvbmNyZXRlIGBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+YCBkZWZhdWx0IG1ha2VzXG4gKiB0aG9zZSBzdWJjbGFzc2VzIGZhaWwgYnkgaW52YXJpYW5jZS4gU3ViY2xhc3NlcyBzdGlsbCBwYXNzIHRoZWlyIHByZWNpc2VcbiAqIGF0dHJpYnV0ZSB0eXBlZGVmcywgc28gdHlwZWQgYWNjZXNzb3JzIGtlZXAgdGhlaXIgcHJlY2lzaW9uLlxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtBdHRyaWJ1dGVzPWFueV1cbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbQ3JlYXRlQXR0cmlidXRlcz1hbnldXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW1VwZGF0ZUF0dHJpYnV0ZXM9YW55XVxuICogQHRlbXBsYXRlIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gW1ByaW1hcnlLZXlWYWx1ZT1pbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZV1cbiAqIEB0ZW1wbGF0ZSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IFtFdmVudFByaW1hcnlLZXlWYWx1ZT1QcmltYXJ5S2V5VmFsdWVdXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxCYXNlIHtcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIG1vZGVsTmFtZVxuXG4gIC8qKlxuICAgKiBBdXRvbG9hZC5cbiAgICogQHR5cGUge2Jvb2xlYW59IC0gR2xvYmFsIGF1dG8tYmF0Y2gtcHJlbG9hZCB0b2dnbGUuIEFwcHMgY2FuIG9wdCBvdXQgdmlhIEZyb250ZW5kTW9kZWxCYXNlLnNldEF1dG9sb2FkKGZhbHNlKS5cbiAgICovXG4gIHN0YXRpYyBfYXV0b2xvYWQgPSB0cnVlXG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF1dG9sb2FkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBhdXRvLWJhdGNoLXByZWxvYWQgb2YgcmVsYXRpb25zaGlwcyBvbiBsYXp5IGFjY2VzcyBpcyBlbmFibGVkIGdsb2JhbGx5LlxuICAgKi9cbiAgc3RhdGljIGdldEF1dG9sb2FkKCkgeyByZXR1cm4gRnJvbnRlbmRNb2RlbEJhc2UuX2F1dG9sb2FkIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYXV0b2xvYWQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbmV3VmFsdWUgLSBXaGV0aGVyIGF1dG8tYmF0Y2gtcHJlbG9hZCBvZiByZWxhdGlvbnNoaXBzIGlzIGVuYWJsZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHNldEF1dG9sb2FkKG5ld1ZhbHVlKSB7IEZyb250ZW5kTW9kZWxCYXNlLl9hdXRvbG9hZCA9IG5ld1ZhbHVlIH1cblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi9cbiAgX2F0dHJpYnV0ZXNcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwPEZyb250ZW5kTW9kZWxCYXNlLCBGcm9udGVuZE1vZGVsQmFzZSwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPj4gfCBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXA8RnJvbnRlbmRNb2RlbEJhc2UsIEZyb250ZW5kTW9kZWxCYXNlLCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+Pj59ICovXG4gIF9yZWxhdGlvbnNoaXBzXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0YWNobWVudEhhbmRsZT59ICovXG4gIF9hdHRhY2htZW50c1xuICAvKipcbiAgICogUmFpbHMtc3R5bGUgbmVzdGVkIGF0dHJpYnV0ZSBwYXlsb2FkcyBxdWV1ZWQgZm9yIHRoZSBuZXh0IHNhdmUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59XG4gICAqL1xuICBfcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXNcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1NldDxzdHJpbmc+IHwgbnVsbH0gKi9cbiAgX3NlbGVjdGVkQXR0cmlidXRlc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgX2lzTmV3UmVjb3JkXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtib29sZWFufSAqL1xuICBfbWFya2VkRm9yRGVzdHJ1Y3Rpb25cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovXG4gIF9wZXJzaXN0ZWRBdHRyaWJ1dGVzXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsQmFzZT4gfCB1bmRlZmluZWR9IC0gU2hhcmVkIHJlZmVyZW5jZSB0byBzaWJsaW5nIHJlY29yZHMgbG9hZGVkIGluIHRoZSBzYW1lIGJhdGNoLiBVc2VkIGJ5IGF1dG8tYmF0Y2gtcHJlbG9hZC5cbiAgICovXG4gIF9sb2FkQ29ob3J0XG4gIC8qKlxuICAgKiBDYW5vbmljYWwgYmFja2luZy1yZWNvcmQgYXR0YWNobWVudCBvd25lciByZXR1cm5lZCBieSB0aGUgc2VydmVyLlxuICAgKiBAdHlwZSB7e3JlY29yZElkOiBzdHJpbmcsIHJlY29yZFR5cGU6IHN0cmluZywgcmVzb3VyY2VOYW1lOiBzdHJpbmd9IHwgbnVsbH1cbiAgICovXG4gIF9hdHRhY2htZW50T3duZXJcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtBdHRyaWJ1dGVzIHwgQ3JlYXRlQXR0cmlidXRlc30gW2F0dHJpYnV0ZXNdIC0gSW5pdGlhbCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgY29uc3RydWN0b3IoYXR0cmlidXRlcykge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcblxuICAgIE1vZGVsQ2xhc3MuZW5zdXJlR2VuZXJhdGVkQXR0YWNobWVudE1ldGhvZHMoKVxuICAgIHRoaXMuX2F0dHJpYnV0ZXMgPSB7fVxuICAgIHRoaXMuX3JlbGF0aW9uc2hpcHMgPSB7fVxuICAgIHRoaXMuX2F0dGFjaG1lbnRzID0ge31cbiAgICB0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgdGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzID0gbnVsbFxuICAgIHRoaXMuX2lzTmV3UmVjb3JkID0gdHJ1ZVxuICAgIHRoaXMuX21hcmtlZEZvckRlc3RydWN0aW9uID0gZmFsc2VcbiAgICB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICB0aGlzLl9hdHRhY2htZW50T3duZXIgPSBudWxsXG4gICAgaWYgKGF0dHJpYnV0ZXMpIHRoaXMuYXNzaWduQXR0cmlidXRlcyhhdHRyaWJ1dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGdlbmVyYXRlZCBhdHRhY2htZW50IG1ldGhvZHMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIEVuc3VyZXMgYXR0YWNobWVudCBoZWxwZXIgbWV0aG9kcyBleGlzdCBvbiB0aGUgcHJvdG90eXBlLlxuICAgKi9cbiAgc3RhdGljIGVuc3VyZUdlbmVyYXRlZEF0dGFjaG1lbnRNZXRob2RzKCkge1xuICAgIGlmICh0aGlzLl9nZW5lcmF0ZWRBdHRhY2htZW50TWV0aG9kcykgcmV0dXJuXG5cbiAgICBjb25zdCBhdHRhY2htZW50cyA9IHRoaXMuYXR0YWNobWVudERlZmluaXRpb25zKClcbiAgICBjb25zdCBwcm90b3R5cGUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHRoaXMucHJvdG90eXBlKVxuXG4gICAgZm9yIChjb25zdCBhdHRhY2htZW50TmFtZSBvZiBPYmplY3Qua2V5cyhhdHRhY2htZW50cykpIHtcbiAgICAgIGlmICghKGF0dGFjaG1lbnROYW1lIGluIHByb3RvdHlwZSkpIHtcbiAgICAgICAgcHJvdG90eXBlW2F0dGFjaG1lbnROYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLl9nZW5lcmF0ZWRBdHRhY2htZW50TWV0aG9kcyA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIGNvbmZpZy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ30gLSBSZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgc3RhdGljIHJlc291cmNlQ29uZmlnKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcInJlc291cmNlQ29uZmlnKCkgbXVzdCBiZSBpbXBsZW1lbnRlZCBieSBzdWJjbGFzc2VzXCIpXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLXVucmVhY2hhYmxlXG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3Nlcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxDbGFzcyB8IHN0cmluZz59IC0gUmVsYXRpb25zaGlwIG1vZGVsIGNsYXNzZXMgKG9yIGNsYXNzIG5hbWUgc3RyaW5ncykga2V5ZWQgYnkgcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzKCkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGEgZnJvbnRlbmQgbW9kZWwgY2xhc3Mgc28gaXQgY2FuIGJlIHJlc29sdmVkIGJ5IG5hbWUgaW4gcmVsYXRpb25zaGlwIGxvb2t1cHMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gcmVnaXN0ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyTW9kZWwobW9kZWxDbGFzcykge1xuICAgIHJlZ2lzdGVyRnJvbnRlbmRNb2RlbChtb2RlbENsYXNzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmaW5lIHNjb3BlLlxuICAgKiBAcGFyYW0geyguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjYWxsYmFjayAtIFNjb3BlIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7KCguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxGcm9udGVuZE1vZGVsQ2xhc3M+KSAmIHtzY29wZTogKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIikuTW9kZWxTY29wZURlc2NyaXB0b3J9fSAtIFNjb3BlIGhlbHBlci5cbiAgICovXG4gIHN0YXRpYyBkZWZpbmVTY29wZShjYWxsYmFjaykge1xuICAgIHJldHVybiBkZWZpbmVNb2RlbFNjb3BlKHtcbiAgICAgIGNhbGxiYWNrLFxuICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgIHN0YXJ0UXVlcnk6ICgpID0+IHRoaXMucXVlcnkoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZSBhIHJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzcyB2YWx1ZSB0aGF0IG1heSBiZSBhIGNsYXNzIHJlZmVyZW5jZSBvciBhIHN0cmluZyBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzcyB8IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IHZhbHVlIC0gQ2xhc3Mgb3IgY2xhc3MgbmFtZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxDbGFzcyB8IG51bGx9IC0gUmVzb2x2ZWQgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgcmVzb2x2ZU1vZGVsQ2xhc3ModmFsdWUpIHtcbiAgICByZXR1cm4gcmVzb2x2ZUZyb250ZW5kTW9kZWxDbGFzcyh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBkZWZpbml0aW9ucy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHt0eXBlOiBcImJlbG9uZ3NUb1wiIHwgXCJoYXNPbmVcIiB8IFwiaGFzTWFueVwiLCBhdXRvbG9hZD86IGJvb2xlYW59Pn0gLSBSZWxhdGlvbnNoaXAgZGVmaW5pdGlvbnMga2V5ZWQgYnkgcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwRGVmaW5pdGlvbnMoKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2htZW50IGRlZmluaXRpb25zLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREZWZpbml0aW9uPn0gLSBBdHRhY2htZW50IGRlZmluaXRpb25zIGtleWVkIGJ5IGF0dGFjaG1lbnQgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBhdHRhY2htZW50RGVmaW5pdGlvbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMucmVzb3VyY2VDb25maWcoKS5hdHRhY2htZW50cyB8fCB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNobWVudCBkZWZpbml0aW9uLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQXR0YWNobWVudERlZmluaXRpb24gfCBudWxsfSAtIEF0dGFjaG1lbnQgZGVmaW5pdGlvbi5cbiAgICovXG4gIHN0YXRpYyBhdHRhY2htZW50RGVmaW5pdGlvbihhdHRhY2htZW50TmFtZSkge1xuICAgIHJldHVybiB0aGlzLmF0dGFjaG1lbnREZWZpbml0aW9ucygpW2F0dGFjaG1lbnROYW1lXSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbi5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge3t0eXBlOiBcImJlbG9uZ3NUb1wiIHwgXCJoYXNPbmVcIiB8IFwiaGFzTWFueVwiLCBhdXRvbG9hZD86IGJvb2xlYW59IHwgbnVsbH0gLSBSZWxhdGlvbnNoaXAgZGVmaW5pdGlvbi5cbiAgICovXG4gIHN0YXRpYyByZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBjb25zdCBkZWZpbml0aW9ucyA9IHRoaXMucmVsYXRpb25zaGlwRGVmaW5pdGlvbnMoKVxuXG4gICAgcmV0dXJuIGRlZmluaXRpb25zW3JlbGF0aW9uc2hpcE5hbWVdIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIFJhaWxzLXN0eWxlIG5lc3RlZCBhdHRyaWJ1dGVzIGtleSB0byBhIGNvbmZpZ3VyZWQgcmVsYXRpb25zaGlwLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIENhbmRpZGF0ZSBhdHRyaWJ1dGUgbmFtZSwgc3VjaCBhcyBgdGFza3NBdHRyaWJ1dGVzYC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IFJlbGF0aW9uc2hpcCBuYW1lIHdoZW4gbmVzdGVkIGF0dHJpYnV0ZXMgYXJlIGNvbmZpZ3VyZWQuXG4gICAqL1xuICBzdGF0aWMgbmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUoYXR0cmlidXRlTmFtZSkge1xuICAgIGlmICghYXR0cmlidXRlTmFtZS5lbmRzV2l0aChcIkF0dHJpYnV0ZXNcIikpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCByZWxhdGlvbnNoaXBOYW1lID0gYXR0cmlidXRlTmFtZS5zbGljZSgwLCAtXCJBdHRyaWJ1dGVzXCIubGVuZ3RoKVxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXNDb25maWcgPSB0aGlzLnJlc291cmNlQ29uZmlnKCkubmVzdGVkQXR0cmlidXRlcyB8fCB7fVxuXG4gICAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnLCByZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgPyByZWxhdGlvbnNoaXBOYW1lXG4gICAgICA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxDbGFzcyB8IG51bGx9IC0gVGFyZ2V0IHJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIHN0YXRpYyByZWxhdGlvbnNoaXBNb2RlbENsYXNzKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBNb2RlbENsYXNzZXMgPSB0aGlzLnJlbGF0aW9uc2hpcE1vZGVsQ2xhc3NlcygpXG4gICAgY29uc3QgdmFsdWUgPSByZWxhdGlvbnNoaXBNb2RlbENsYXNzZXNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgIHJldHVybiBGcm9udGVuZE1vZGVsQmFzZS5yZXNvbHZlTW9kZWxDbGFzcyh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtBdHRyaWJ1dGVzfSAtIEF0dHJpYnV0ZXMgaGFzaC5cbiAgICovXG4gIGF0dHJpYnV0ZXMoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7QXR0cmlidXRlc30gKi8gKHRoaXMuX2F0dHJpYnV0ZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBuZXcgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgbW9kZWwgaGFzIG5vdCB5ZXQgYmVlbiBwZXJzaXN0ZWQuXG4gICAqL1xuICBpc05ld1JlY29yZCgpIHtcbiAgICByZXR1cm4gdGhpcy5faXNOZXdSZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIHBlcnNpc3RlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIG1vZGVsIGhhcyBiZWVuIHBlcnNpc3RlZC5cbiAgICovXG4gIGlzUGVyc2lzdGVkKCkge1xuICAgIHJldHVybiAhdGhpcy5pc05ld1JlY29yZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgaXMgbmV3IHJlY29yZC5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdJc05ld1JlY29yZCAtIE5ldyBwZXJzaXN0ZWQtc3RhdGUgZmxhZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRJc05ld1JlY29yZChuZXdJc05ld1JlY29yZCkge1xuICAgIHRoaXMuX2lzTmV3UmVjb3JkID0gbmV3SXNOZXdSZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXJrcyB0aGlzIHJlY29yZCBmb3IgZGVzdHJ1Y3Rpb24gd2hlbiBpdHMgcGFyZW50IGlzIG5leHQgc2F2ZWQgdGhyb3VnaFxuICAgKiBuZXN0ZWQtYXR0cmlidXRlIHN1cHBvcnQuIFRoZSByZWNvcmQgaXMgbm90IHJlbW92ZWQgZnJvbSB0aGUgcGFyZW50J3NcbiAgICogcmVsYXRpb25zaGlwIGNvbGxlY3Rpb24gdW50aWwgdGhlIHNlcnZlciBjb25maXJtcyB0aGUgZGVsZXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBtYXJrRm9yRGVzdHJ1Y3Rpb24oKSB7XG4gICAgdGhpcy5fbWFya2VkRm9yRGVzdHJ1Y3Rpb24gPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrZWQgZm9yIGRlc3RydWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgcmVjb3JkIGlzIHF1ZXVlZCBmb3IgbmVzdGVkIGRlc3RydWN0aW9uIG9uIG5leHQgcGFyZW50IHNhdmUuXG4gICAqL1xuICBtYXJrZWRGb3JEZXN0cnVjdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fbWFya2VkRm9yRGVzdHJ1Y3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNoYW5nZXMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIENoYW5nZWQgYXR0cmlidXRlcyBhcyBgW29sZFZhbHVlLCBuZXdWYWx1ZV1gLlxuICAgKi9cbiAgY2hhbmdlcygpIHtcbiAgICAvKipcbiAgICAgKiBDaGFuZ2VkIGF0dHJpYnV0ZXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgY29uc3QgY2hhbmdlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gbmV3IFNldChbXG4gICAgICAuLi5PYmplY3Qua2V5cyh0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzKSxcbiAgICAgIC4uLk9iamVjdC5rZXlzKHRoaXMuX2F0dHJpYnV0ZXMpXG4gICAgXSlcblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBhdHRyaWJ1dGVOYW1lcykge1xuICAgICAgY29uc3QgcHJldmlvdXNWYWx1ZSA9IHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cbiAgICAgIGNvbnN0IGN1cnJlbnRWYWx1ZSA9IHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cblxuICAgICAgaWYgKEpTT04uc3RyaW5naWZ5KHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShwcmV2aW91c1ZhbHVlKSkgIT09IEpTT04uc3RyaW5naWZ5KHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShjdXJyZW50VmFsdWUpKSkge1xuICAgICAgICBjaGFuZ2VkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IFtwcmV2aW91c1ZhbHVlLCBjdXJyZW50VmFsdWVdXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYW5nZWRBdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBjaGFuZ2VkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGFueSB0cmFja2VkIGF0dHJpYnV0ZSBoYXMgY2hhbmdlZC5cbiAgICovXG4gIGlzQ2hhbmdlZCgpIHtcbiAgICByZXR1cm4gT2JqZWN0LmtleXModGhpcy5jaGFuZ2VzKCkpLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZWxhdGlvbnNoaXAgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXB9IC0gUmVsYXRpb25zaGlwIHN0YXRlIG9iamVjdC5cbiAgICovXG4gIGdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgaWYgKCF0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdKSB7XG4gICAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBEZWZpbml0aW9uID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBNb2RlbENsYXNzKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXBEZWZpbml0aW9uICYmIHJlbGF0aW9uc2hpcFR5cGVJc0NvbGxlY3Rpb24ocmVsYXRpb25zaGlwRGVmaW5pdGlvbi50eXBlKSkge1xuICAgICAgICB0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdID0gbmV3IEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwKHRoaXMsIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3MpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdID0gbmV3IEZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcCh0aGlzLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXR0YWNobWVudCBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQXR0YWNobWVudEhhbmRsZX0gLSBBdHRhY2htZW50IGhlbHBlci5cbiAgICovXG4gIGdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKGF0dGFjaG1lbnROYW1lKVxuXG4gICAgaWYgKCFhdHRhY2htZW50RGVmaW5pdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGF0dGFjaG1lbnQ6ICR7TW9kZWxDbGFzcy5uYW1lfSMke2F0dGFjaG1lbnROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0pIHtcbiAgICAgIHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXSA9IG5ldyBGcm9udGVuZE1vZGVsQXR0YWNobWVudEhhbmRsZSh7XG4gICAgICAgIGF0dGFjaG1lbnROYW1lLFxuICAgICAgICBtb2RlbDogdGhpc1xuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRNb2RlbEJhc2UgfCBBcnJheTxGcm9udGVuZE1vZGVsQmFzZT4gfCBudWxsPn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgbG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGlkID0gdGhpcy5wcmltYXJ5S2V5VmFsdWUoKVxuICAgIGNvbnN0IHJlbG9hZGVkTW9kZWwgPSBhd2FpdCBNb2RlbENsYXNzXG4gICAgICAucHJlbG9hZChbcmVsYXRpb25zaGlwTmFtZV0pXG4gICAgICAuZmluZChpZClcbiAgICBjb25zdCBzb3VyY2VSZWxhdGlvbnNoaXAgPSByZWxvYWRlZE1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgIGNvbnN0IHRhcmdldFJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBjb3B5TG9hZGVkUmVsYXRpb25zaGlwVmFsdWUoe3NvdXJjZVJlbGF0aW9uc2hpcCwgdGFyZ2V0UmVsYXRpb25zaGlwfSlcblxuICAgIHJldHVybiB0YXJnZXRSZWxhdGlvbnNoaXAubG9hZGVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVsb2FkcyByZWxhdGlvbnNoaXAocykgb250byB0aGlzIGFscmVhZHktbG9hZGVkIHJlY29yZC4gQWNjZXB0cyBlaXRoZXIgYVxuICAgKiBxdWVyeSBidWlsdCB2aWEgYE1vZGVsLnByZWxvYWQoLi4uKS5zZWxlY3QoLi4uKWAgb3IgYSByYXcgcHJlbG9hZCBzcGVjXG4gICAqIChzdHJpbmcgLyBhcnJheSAvIG5lc3RlZCBvYmplY3QpLiBSZWxhdGlvbnNoaXBzIGFscmVhZHkgcHJlbG9hZGVkIHdpdGggdGhlXG4gICAqIHJlcXVpcmVkIGNvbHVtbnMgcHJlc2VudCBhcmUgbGVmdCB1bnRvdWNoZWQgdW5sZXNzIGBmb3JjZWAgaXMgc2V0LiBDYXJyaWVzXG4gICAqIHRoZSBxdWVyeSdzIHByZWxvYWQgZ3JhcGgsIHNlbGVjdCwgc2VsZWN0c0V4dHJhLCB3aXRoQ291bnQsIGFiaWxpdGllcywgYW5kXG4gICAqIHF1ZXJ5RGF0YSB3aGVuIHJlLWZldGNoaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxGcm9udGVuZE1vZGVsQ2xhc3M+IHwgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQ+fSBxdWVyeU9yU3BlYyAtIFByZWxvYWQgc291cmNlLlxuICAgKiBAcGFyYW0ge3tmb3JjZT86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBPcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHByZWxvYWRpbmcgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgcHJlbG9hZChxdWVyeU9yU3BlYywgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgRnJvbnRlbmRNb2RlbFByZWxvYWRlci5wcmVsb2FkKFt0aGlzXSwgcXVlcnlPclNwZWMsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgb3IgbG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRNb2RlbEJhc2UgfCBBcnJheTxGcm9udGVuZE1vZGVsQmFzZT4gfCBudWxsPn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgcmVsYXRpb25zaGlwT3JMb2FkKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRQcmVsb2FkZWQoKSkge1xuICAgICAgcmV0dXJuIHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuICAgIH1cblxuICAgIGNvbnN0IGJhdGNoZWQgPSBhd2FpdCB0aGlzLl90cnlDb2hvcnRQcmVsb2FkKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoYmF0Y2hlZCkgcmV0dXJuIHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0dGVtcHRzIHRvIGJhdGNoLWxvYWQgYHJlbGF0aW9uc2hpcE5hbWVgIGFjcm9zcyBjb2hvcnQgc2libGluZ3MgdmlhIGFcbiAgICogc2luZ2xlIGBwcmVsb2FkKFtuYW1lXSkud2hlcmUoe3BrOiBbaWRzXX0pLnRvQXJyYXkoKWAgcmVxdWVzdCwgdGhlbiBjb3BpZXNcbiAgICogdGhlIHByZWxvYWRlZCByZWxhdGlvbnNoaXAgc3RhdGUgb250byBlYWNoIHNpYmxpbmcuIFJldHVybnMgdHJ1ZSB3aGVuIGFcbiAgICogYmF0Y2ggcmFuLCBmYWxzZSB3aGVuIGF1dG9sb2FkIGlzIG9mZiwgdGhlcmUgaXMgbm8gY29ob3J0LCBvciBubyBiYXRjaFxuICAgKiBjYW5kaWRhdGVzIHJlbWFpbi4gU2libGluZ3Mgd2hvc2UgcmVsYXRpb25zaGlwIHN0YXRlIGlzIGFscmVhZHkgc2V0XG4gICAqIChwcmVsb2FkZWQgb3IgbG9jYWxseSBtYW5pcHVsYXRlZCB2aWEgYGJ1aWxkYCAvIGBzZXRSZWxhdGlvbnNoaXBgKSBhcmVcbiAgICogc2tpcHBlZCBzbyB0aGVpciBjYWNoZWQvZWRpdGVkIHZhbHVlIGlzIHByZXNlcnZlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhIGNvaG9ydCBiYXRjaCBwcmVsb2FkIHJhbi5cbiAgICovXG4gIGFzeW5jIF90cnlDb2hvcnRQcmVsb2FkKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBpZiAoIUZyb250ZW5kTW9kZWxCYXNlLmdldEF1dG9sb2FkKCkpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGNvaG9ydCA9IHRoaXMuX2xvYWRDb2hvcnRcblxuICAgIGlmICghY29ob3J0IHx8IGNvaG9ydC5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBkZWZpbml0aW9uID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIWRlZmluaXRpb24pIHJldHVybiBmYWxzZVxuICAgIGlmIChkZWZpbml0aW9uLmF1dG9sb2FkID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlXG5cbiAgICAvKipcbiAgICAgKiBCYXRjaC5cbiAgICAgKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+fSAqL1xuICAgIGNvbnN0IGJhdGNoID0gW11cblxuICAgIC8vIEV4YWN0IHNhbWUgY2xhc3MsIHBlcnNpc3RlZCwgbm8gZXhpc3RpbmcgaW4tbWVtb3J5IHJlbGF0aW9uc2hpcCBzdGF0ZS5cbiAgICAvLyBgc2V0TG9hZGVkYCBzZXRzIGBfcHJlbG9hZGVkID0gdHJ1ZWAgb24gZXZlcnkgbXV0YXRpb24gcGF0aCAocHJlbG9hZCxcbiAgICAvLyBzZXRSZWxhdGlvbnNoaXAsIGJ1aWxkLCBhZGRUb0xvYWRlZCksIHNvIGBnZXRQcmVsb2FkZWQoKWAgYWxvbmUgaXMgYVxuICAgIC8vIHJlbGlhYmxlIFwiYWxyZWFkeSB0b3VjaGVkXCIgc2lnbmFsIG9uIHRoZSBmcm9udGVuZC5cbiAgICBmb3IgKGNvbnN0IHNpYmxpbmcgb2YgY29ob3J0KSB7XG4gICAgICBpZiAoc2libGluZy5jb25zdHJ1Y3RvciAhPT0gTW9kZWxDbGFzcykgY29udGludWVcbiAgICAgIGlmIChzaWJsaW5nLmlzTmV3UmVjb3JkKCkpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHNpYmxpbmdSZWxhdGlvbnNoaXAgPSBzaWJsaW5nLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICBpZiAoc2libGluZ1JlbGF0aW9uc2hpcC5nZXRQcmVsb2FkZWQoKSkgY29udGludWVcblxuICAgICAgYmF0Y2gucHVzaChzaWJsaW5nKVxuICAgIH1cblxuICAgIGlmIChiYXRjaC5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBiYXRjaElkcyA9IGJhdGNoLm1hcCgoc2libGluZykgPT4gc2libGluZy5wcmltYXJ5S2V5VmFsdWUoKSlcbiAgICBjb25zdCByZWxvYWRlZEJhdGNoID0gYXdhaXQgTW9kZWxDbGFzc1xuICAgICAgLnByZWxvYWQoW3JlbGF0aW9uc2hpcE5hbWVdKVxuICAgICAgLndoZXJlKHtbcHJpbWFyeUtleV06IGJhdGNoSWRzfSlcbiAgICAgIC50b0FycmF5KClcblxuICAgIC8qKlxuICAgICAqIFJlbG9hZGVkIGJ5IGlkLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBGcm9udGVuZE1vZGVsQmFzZT59ICovXG4gICAgY29uc3QgcmVsb2FkZWRCeUlkID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IHJlbG9hZGVkIG9mIHJlbG9hZGVkQmF0Y2gpIHtcbiAgICAgIHJlbG9hZGVkQnlJZC5zZXQobW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcmVsb2FkZWQucHJpbWFyeUtleVZhbHVlKCkpLCByZWxvYWRlZClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHNpYmxpbmcgb2YgYmF0Y2gpIHtcbiAgICAgIGNvbnN0IGtleSA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHNpYmxpbmcucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgICBjb25zdCByZWxvYWRlZCA9IHJlbG9hZGVkQnlJZC5nZXQoa2V5KVxuXG4gICAgICBpZiAoIXJlbG9hZGVkKSBjb250aW51ZVxuXG4gICAgICBjb3B5TG9hZGVkUmVsYXRpb25zaGlwVmFsdWUoe1xuICAgICAgICBzb3VyY2VSZWxhdGlvbnNoaXA6IHJlbG9hZGVkLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKSxcbiAgICAgICAgdGFyZ2V0UmVsYXRpb25zaGlwOiBzaWJsaW5nLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICAvLyBJZiB0aGUgY2FsbGVyIGl0c2VsZiB3YXMgbm90IHBvcHVsYXRlZCAocmVjb3JkIGRlbGV0ZWQvZmlsdGVyZWQgYmV0d2VlblxuICAgIC8vIHRoZSBsaXN0IGZldGNoIGFuZCB0aGlzIHByZWxvYWQgcmVxdWVzdCksIGZhbGwgYmFjayB0byBwZXItcmVjb3JkIGxvYWRcbiAgICAvLyBzbyB0aGUgY2FsbGVyIGdldHMgYSByZWFsIG5vdC1mb3VuZCBlcnJvciBpbnN0ZWFkIG9mIGEgbWlzbGVhZGluZ1xuICAgIC8vIFwiaGFzbid0IGJlZW4gcHJlbG9hZGVkXCIgdGhyb3cgZnJvbSBsb2FkZWQoKS5cbiAgICBpZiAoIXRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpLmdldFByZWxvYWRlZCgpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlIHwgbnVsbCB8IHVuZGVmaW5lZH0gcmVsYXRpb25zaGlwVmFsdWUgLSBSZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQmFzZSB8IG51bGwgfCB1bmRlZmluZWR9IC0gQXNzaWduZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgc2V0UmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcFZhbHVlKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcERlZmluaXRpb24gPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcERlZmluaXRpb24ocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmICghcmVsYXRpb25zaGlwRGVmaW5pdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHJlbGF0aW9uc2hpcDogJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAocmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHNldCBoYXMtbWFueSByZWxhdGlvbnNoaXAgd2l0aCBzZXRSZWxhdGlvbnNoaXAoKTogJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIHJlbGF0aW9uc2hpcC5zZXRMb2FkZWQocmVsYXRpb25zaGlwVmFsdWUpXG5cbiAgICByZXR1cm4gcmVsYXRpb25zaGlwVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2lnbiBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0F0dHJpYnV0ZXMgfCBDcmVhdGVBdHRyaWJ1dGVzIHwgVXBkYXRlQXR0cmlidXRlcyB8IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59IGF0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzIHRvIGFzc2lnbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYXNzaWduQXR0cmlidXRlcyhhdHRyaWJ1dGVzKSB7XG4gICAgY29uc3QgYXR0cmlidXRlVmFsdWVzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoYXR0cmlidXRlcylcblxuICAgIGZvciAoY29uc3Qga2V5IGluIGF0dHJpYnV0ZVZhbHVlcykge1xuICAgICAgdGhpcy5zZXRBdHRyaWJ1dGUoa2V5LCBhdHRyaWJ1dGVWYWx1ZXNba2V5XSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciByZWxhdGlvbnNoaXAgY2FjaGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIENsZWFycyBjYWNoZWQgcmVsYXRpb25zaGlwIHN0YXRlLlxuICAgKi9cbiAgY2xlYXJSZWxhdGlvbnNoaXBDYWNoZSgpIHtcbiAgICB0aGlzLl9yZWxhdGlvbnNoaXBzID0ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW1hcnkga2V5LlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn0gLSBQcmltYXJ5IGtleSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIHByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIHRoaXMucmVzb3VyY2VDb25maWcoKS5wcmltYXJ5S2V5IHx8IFwiaWRcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbWFyeSBrZXkgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtQcmltYXJ5S2V5VmFsdWV9IC0gUHJpbWFyeSBrZXkgdmFsdWUuXG4gICAqL1xuICBwcmltYXJ5S2V5VmFsdWUoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7UHJpbWFyeUtleVZhbHVlfSAqLyAocmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKHByaW1hcnlLZXksIChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IHRoaXMucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgcHJpbWFyeSBrZXkgJyR7YXR0cmlidXRlTmFtZX0nIG9uICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB2YWx1ZVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHNjYWxhciBpZGVudGl0eSByZXF1aXJlZCBieSBzY2FsYXItb25seSBmcm9udGVuZCBmZWF0dXJlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wZXJhdGlvbiAtIE9wZXJhdGlvbiByZXF1aXJpbmcgYSBzY2FsYXIgaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlTY2FsYXJ9IC0gU2NhbGFyIHByaW1hcnkta2V5IHZhbHVlLlxuICAgKi9cbiAgc2NhbGFyUHJpbWFyeUtleVZhbHVlKG9wZXJhdGlvbikge1xuICAgIHJldHVybiBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZSh0aGlzLnByaW1hcnlLZXlWYWx1ZSgpLCBvcGVyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgaWRlbnRpdHkgcmVwcmVzZW50ZWQgYnkgdGhlIGxhc3QgcGVyc2lzdGVkIGZyb250ZW5kIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtQcmltYXJ5S2V5VmFsdWV9IC0gUGVyc2lzdGVkIHByaW1hcnkta2V5IHZhbHVlLlxuICAgKi9cbiAgcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcblxuICAgIHJldHVybiAvKiogQHR5cGUge1ByaW1hcnlLZXlWYWx1ZX0gKi8gKHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgY29uc3QgdmFsdWUgPSB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBwZXJzaXN0ZWQgcHJpbWFyeSBrZXkgJyR7YXR0cmlidXRlTmFtZX0nIG9uICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB2YWx1ZVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBBdHRyaWJ1dGUgdmFsdWUuXG4gICAqL1xuICByZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAodGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzICYmICF0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMuaGFzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgQXR0cmlidXRlTm90U2VsZWN0ZWRFcnJvcih0aGlzLmNvbnN0cnVjdG9yLm5hbWUsIGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGFuIGF0dHJpYnV0ZSB2YWx1ZSBpcyBjdXJyZW50bHkgbG9hZGVkIG9uIHRoaXMgcmVjb3JkLiBVc2VkIGJ5IHRoZVxuICAgKiBwcmVsb2FkZXIgdG8gZGVjaWRlIHdoZXRoZXIgYSByZWxhdGlvbnNoaXAgY2FuIGJlIHNraXBwZWQgYmVjYXVzZSB0aGVcbiAgICogcmVxdWVzdGVkIGNvbHVtbnMgYXJlIGFscmVhZHkgcHJlc2VudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgYXR0cmlidXRlIGlzIGxvYWRlZC5cbiAgICovXG4gIGhhc0xvYWRlZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSB7XG4gICAgaWYgKCF0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gdGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzLmhhcyhhdHRyaWJ1dGVOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgYW4gYXNzb2NpYXRpb24gY291bnQgYXR0YWNoZWQgYnkgYC53aXRoQ291bnQoLi4uKWAuIENvdW50c1xuICAgKiBsaXZlIG9uIGEgZGVkaWNhdGVkIG1hcCBzZXBhcmF0ZSBmcm9tIHRoZSByZWNvcmQncyBhdHRyaWJ1dGVzIHNvXG4gICAqIGEgdmlydHVhbCBjb3VudCBsaWtlIGB0YXNrc0NvdW50YCBjYW4ndCBzaWxlbnRseSBzaGFkb3cgYSByZWFsXG4gICAqIGNvbHVtbiBvZiB0aGUgc2FtZSBuYW1lLiBSZXR1cm5zIHRoZSBhdHRhY2hlZCB2YWx1ZSwgb3IgMCB3aGVuXG4gICAqIGAud2l0aENvdW50KC4uLilgIHdhc24ndCByZXF1ZXN0ZWQgZm9yIHRoaXMgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLCBlLmcuIGBcInRhc2tzQ291bnRcImAgb3IgYSBjdXN0b20gbmFtZSBmcm9tIGAud2l0aENvdW50KHtjdXN0b21OYW1lOiB7Li4ufX0pYC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBBdHRhY2hlZCBhc3NvY2lhdGlvbiBjb3VudCwgb3IgemVybyB3aGVuIGFic2VudC5cbiAgICovXG4gIHJlYWRDb3VudChhdHRyaWJ1dGVOYW1lKSB7XG4gICAgcmV0dXJuIHJlYWRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBzZXR0ZXIgY2FsbGVkIGJ5IGBpbnN0YW50aWF0ZUZyb21SZXNwb25zZWAgd2hlbiBoeWRyYXRpbmdcbiAgICogYXNzb2NpYXRpb24gY291bnRzIHRoYXQgcm9kZSBhbG9uZyB3aXRoIHRoZSByZWNvcmQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gQ291bnQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldEFzc29jaWF0aW9uQ291bnQoYXR0cmlidXRlTmFtZSwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYXR0cmlidXRlTmFtZSwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhIHBlci1yZWNvcmQgYWJpbGl0eSByZXN1bHQgYXR0YWNoZWQgYnkgYC5hYmlsaXRpZXMoLi4uKWAuIFRoZVxuICAgKiBiYWNrZW5kIGV2YWx1YXRlcyBlYWNoIHJlcXVlc3RlZCBhY3Rpb24gYWdhaW5zdCB0aGUgY3VycmVudFxuICAgKiBhYmlsaXR5IGZvciB0aGlzIHJlY29yZCBpbnN0YW5jZSBhbmQgc2hpcHMgdGhlIHJlc3VsdCBhbG9uZ3NpZGVcbiAgICogdGhlIHJlY29yZCdzIGF0dHJpYnV0ZXMuIFJldHVybnMgYGZhbHNlYCB3aGVuIHRoZSBhY3Rpb24gd2Fzbid0XG4gICAqIHJlcXVlc3RlZCAob3IgdGhlIGFiaWxpdHkgZGVuaWVkIGl0KSwgc28gVUkgY29kZSBjYW4gc2FmZWx5IGJyYW5jaFxuICAgKiBvbiBgcmVjb3JkLmNhbihcInVwZGF0ZVwiKWAgd2l0aG91dCBmaXJzdCBjaGVja2luZyB3aGV0aGVyIHRoZVxuICAgKiBhYmlsaXR5IHdhcyBsb2FkZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbiBuYW1lLCBlLmcuIGBcInVwZGF0ZVwiYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVxdWVzdGVkIGFiaWxpdHkgaXMgYWxsb3dlZC5cbiAgICovXG4gIGNhbihhY3Rpb24pIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRDb21wdXRlZEFiaWxpdHkoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGFjdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBzZXR0ZXIgY2FsbGVkIGJ5IGBpbnN0YW50aWF0ZUZyb21SZXNwb25zZWAgd2hlbiBoeWRyYXRpbmdcbiAgICogcGVyLXJlY29yZCBhYmlsaXR5IHJlc3VsdHMgdGhhdCByb2RlIGFsb25nIHdpdGggdGhlIHJlY29yZFxuICAgKiBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24gbmFtZS5cbiAgICogQHBhcmFtIHtib29sZWFufSB2YWx1ZSAtIFdoZXRoZXIgdGhlIGN1cnJlbnQgYWJpbGl0eSBwZXJtaXRzIHRoZSBhY3Rpb24gb24gdGhpcyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldENvbXB1dGVkQWJpbGl0eShhY3Rpb24sIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZENvbXB1dGVkQWJpbGl0eSgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYWN0aW9uLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGEgY29uc3VtZXItZGVmaW5lZCB2YWx1ZSBhdHRhY2hlZCBieSBgLnF1ZXJ5RGF0YSguLi4pYC4gU3RvcmVkXG4gICAqIG9uIGEgZGVkaWNhdGVkIG1hcCByYXRoZXIgdGhhbiBgX2F0dHJpYnV0ZXNgLCBzbyBhIHZpcnR1YWwgYWxpYXNcbiAgICogbGlrZSBgdGFza3NDb3VudGAgY2Fubm90IHNpbGVudGx5IHNoYWRvdyBhIHJlYWwgY29sdW1uIG9mIHRoZSBzYW1lXG4gICAqIG5hbWUuIFJldHVybnMgYG51bGxgIHdoZW4gbm8gcmVnaXN0ZXJlZCBmbiBwcm9kdWNlZCB0aGF0IGFsaWFzIGZvclxuICAgKiB0aGlzIHJlY29yZCAoZS5nLiBubyBjaGlsZCByb3dzIG1hdGNoZWQgdGhlIGFnZ3JlZ2F0ZSkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gcXVlcnlEYXRhIGFsaWFzIG5hbWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBBdHRhY2hlZCBxdWVyeS1kYXRhIHZhbHVlLlxuICAgKi9cbiAgcXVlcnlEYXRhKG5hbWUpIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRRdWVyeURhdGEoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogSW50ZXJuYWwgc2V0dGVyIHVzZWQgYnkgYGluc3RhbnRpYXRlRnJvbVJlc3BvbnNlYCB3aGVuIGh5ZHJhdGluZ1xuICAgKiBxdWVyeURhdGEgdmFsdWVzIHRoYXQgcm9kZSBhbG9uZyB3aXRoIHRoZSByZWNvcmQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBxdWVyeURhdGEgYWxpYXMgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBBdHRhY2hlZCB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0UXVlcnlEYXRhKG5hbWUsIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZFF1ZXJ5RGF0YSgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgbmFtZSwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBuZXdWYWx1ZSAtIE5ldyB2YWx1ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEFzc2lnbmVkIHZhbHVlLlxuICAgKi9cbiAgc2V0QXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUsIG5ld1ZhbHVlKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lID0gTW9kZWxDbGFzcy5uZXN0ZWRBdHRyaWJ1dGVzUmVsYXRpb25zaGlwTmFtZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgaWYgKG5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgICB0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlc1tuZXN0ZWRBdHRyaWJ1dGVzUmVsYXRpb25zaGlwTmFtZV0gPSBuZXdWYWx1ZVxuICAgICAgcmV0dXJuIG5ld1ZhbHVlXG4gICAgfVxuXG4gICAgaWYgKE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24oYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIHRoaXMuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRyaWJ1dGVOYW1lKS5xdWV1ZUF0dGFjaChuZXdWYWx1ZSlcbiAgICAgIHJldHVybiBuZXdWYWx1ZVxuICAgIH1cblxuICAgIGNvbnN0IHByZXZpb3VzVmFsdWUgPSB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gbmV3VmFsdWVcblxuICAgIGlmICh0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgIHRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcy5hZGQoYXR0cmlidXRlTmFtZSlcbiAgICB9XG5cbiAgICAvLyBPbmx5IGludmFsaWRhdGUgcmVsYXRpb25zaGlwIGNhY2hlIGVudHJpZXMgd2hvc2UgZm9yZWlnbiBrZXkgbWF0Y2hlcyB0aGUgY2hhbmdlZCBhdHRyaWJ1dGUuXG4gICAgLy8gQmxhbmtldC1jbGVhcmluZyBhbGwgcmVsYXRpb25zaGlwcyBvbiBhbnkgYXR0cmlidXRlIGNoYW5nZSBkZXN0cm95cyBuZXN0ZWQtc2F2ZSBzdGF0ZVxuICAgIC8vIGFuZCBwcmVsb2FkZWQgY2hpbGRyZW4gdGhlIGNhbGxlciBuZXZlciBhc2tlZCB0byBpbnZhbGlkYXRlLlxuICAgIGlmICghT2JqZWN0LmlzKHByZXZpb3VzVmFsdWUsIG5ld1ZhbHVlKSkge1xuICAgICAgdGhpcy5faW52YWxpZGF0ZVJlbGF0aW9uc2hpcHNGb3JBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3VmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnZhbGlkYXRlcyBhbnkgY2FjaGVkIGJlbG9uZ3NUbyByZWxhdGlvbnNoaXAgd2hvc2UgZm9yZWlnbiBrZXkgbWF0Y2hlcyB0aGVcbiAgICogY2hhbmdlZCBhdHRyaWJ1dGUuIEhhc01hbnkgLyBoYXNPbmUgcmVsYXRpb25zaGlwcyBhcmUgbGVmdCB1bnRvdWNoZWQgYmVjYXVzZVxuICAgKiB0aGVpciBmb3JlaWduIGtleSBsaXZlcyBvbiB0aGUgY2hpbGQsIG5vdCBvbiB0aGlzIG1vZGVsLCBhbmQgYmxhbmtldC1jbGVhcmluZ1xuICAgKiB0aGVtIHdvdWxkIGRlc3Ryb3kgbmVzdGVkLXNhdmUgc3RhdGUgYW5kIHByZWxvYWRlZCBjaGlsZHJlbiB0aGUgY2FsbGVyIG5ldmVyXG4gICAqIGFza2VkIHRvIGludmFsaWRhdGUuXG4gICAqXG4gICAqIEZvcmVpZ24ga2V5cyBhcmUgaW5mZXJyZWQgd2hlbiBub3QgZGVjbGFyZWQ6IGZvciBiZWxvbmdzVG8gYHByb2plY3RJZGAgaXNcbiAgICogaW5mZXJyZWQgZnJvbSByZWxhdGlvbnNoaXAgbmFtZSBgcHJvamVjdGAuIEV4cGxpY2l0IGBmb3JlaWduS2V5YCBvbiB0aGVcbiAgICogcmVsYXRpb25zaGlwIGRlZmluaXRpb24gdGFrZXMgcHJlY2VkZW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZSB0aGF0IGNoYW5nZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2ludmFsaWRhdGVSZWxhdGlvbnNoaXBzRm9yQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAoIXRoaXMuX3JlbGF0aW9uc2hpcHMgfHwgT2JqZWN0LmtleXModGhpcy5fcmVsYXRpb25zaGlwcykubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBkZWZpbml0aW9ucyA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbnMoKVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKHRoaXMuX3JlbGF0aW9uc2hpcHMpKSB7XG4gICAgICBjb25zdCBkZWZpbml0aW9uID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGRlZmluaXRpb25zW3JlbGF0aW9uc2hpcE5hbWVdKVxuXG4gICAgICBpZiAoIWRlZmluaXRpb24gfHwgZGVmaW5pdGlvbi50eXBlICE9PSBcImJlbG9uZ3NUb1wiKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBmb3JlaWduS2V5ID0gZGVmaW5pdGlvbi5mb3JlaWduS2V5IHx8IGAke3JlbGF0aW9uc2hpcE5hbWV9SWRgXG5cbiAgICAgIGlmIChmb3JlaWduS2V5ID09PSBhdHRyaWJ1dGVOYW1lKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgcGF0aC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEZXJpdmVkIHJlc291cmNlIHBhdGguXG4gICAqL1xuICBzdGF0aWMgcmVzb3VyY2VQYXRoKCkge1xuICAgIHJldHVybiB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgoe1xuICAgICAgbW9kZWxOYW1lOiB0aGlzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgcmVzb3VyY2VQYXRoOiBkZWZhdWx0RnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aCh0aGlzKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb21tYW5kIG5hbWUuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENvbW1hbmRUeXBlfSBjb21tYW5kVHlwZSAtIENvbW1hbmQgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBSZXNvbHZlZCBjb21tYW5kIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgY29tbWFuZE5hbWUoY29tbWFuZFR5cGUpIHtcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IHRoaXMucmVzb3VyY2VDb25maWcoKVxuICAgIGNvbnN0IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgPSByZXNvdXJjZUNvbmZpZy5idWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzIHx8IFtdXG4gICAgY29uc3QgYnVpbHRJbk1lbWJlckNvbW1hbmRzID0gcmVzb3VyY2VDb25maWcuYnVpbHRJbk1lbWJlckNvbW1hbmRzIHx8IFtdXG4gICAgY29uc3QgY29tbWFuZHMgPSByZXNvdXJjZUNvbmZpZy5jb21tYW5kcyB8fCBbXVxuICAgIGNvbnN0IGlzRXhwb3NlZCA9IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMuaW5jbHVkZXMoY29tbWFuZFR5cGUpIHx8IGJ1aWx0SW5NZW1iZXJDb21tYW5kcy5pbmNsdWRlcyhjb21tYW5kVHlwZSkgfHwgY29tbWFuZHMuaW5jbHVkZXMoY29tbWFuZFR5cGUpXG4gICAgY29uc3QgY29tbWFuZE5hbWUgPSBpc0V4cG9zZWQgPyBpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUoY29tbWFuZFR5cGUpKSA6IGNvbW1hbmRUeXBlXG5cbiAgICByZXR1cm4gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kTmFtZSh7XG4gICAgICBjb21tYW5kTmFtZSxcbiAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgbW9kZWxOYW1lOiB0aGlzLmdldE1vZGVsTmFtZSgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBjdXN0b20gY29tbWFuZCBwYXlsb2FkIGFyZ3VtZW50cy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MgLSBDb21tYW5kIGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDb21tYW5kIHBheWxvYWQuXG4gICAqL1xuICBzdGF0aWMgbm9ybWFsaXplQ3VzdG9tQ29tbWFuZFBheWxvYWRBcmd1bWVudHMoYXJncykge1xuICAgIGlmIChhcmdzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHt9XG4gICAgaWYgKGFyZ3MubGVuZ3RoID09PSAxKSB7XG4gICAgICBjb25zdCBwYXlsb2FkID0gYXJnc1swXVxuICAgICAgaWYgKHBheWxvYWQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4ge31cbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVvZiBwYXlsb2FkICE9PSBcIm9iamVjdFwiIHx8IHBheWxvYWQgPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIHthcmcxOiBwYXlsb2FkfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChwYXlsb2FkKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFBheWxvYWQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlciB8IHN0cmluZyB8IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgY29uc3QgcGF5bG9hZCA9IHt9XG5cbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgYXJncy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgIHBheWxvYWRbYGFyZyR7aW5kZXggKyAxfWBdID0gYXJnc1tpbmRleF1cbiAgICB9XG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIG1vZGVsIG5hbWUsIHByZWZlcnJpbmcgYW4gZXhwbGljaXQgYHN0YXRpYyBtb2RlbE5hbWVgIGRlY2xhcmF0aW9uXG4gICAqIG92ZXIgdGhlIEphdmFTY3JpcHQgY2xhc3MgYC5uYW1lYCBwcm9wZXJ0eS4gVGhpcyBhbGxvd3MgbWluaWZpZWQgYnVpbGRzIHRvXG4gICAqIHByZXNlcnZlIGNvcnJlY3QgbW9kZWwgbmFtZXMgd2l0aG91dCByZWx5aW5nIG9uIGBrZWVwX2NsYXNzbmFtZXNgLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBtb2RlbCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldE1vZGVsTmFtZSgpIHtcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IHRoaXMucmVzb3VyY2VDb25maWcoKVxuICAgIGNvbnN0IG1vZGVsTmFtZSA9IHJlc291cmNlQ29uZmlnPy5tb2RlbE5hbWVcblxuICAgIHJldHVybiAodHlwZW9mIG1vZGVsTmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBtb2RlbE5hbWUubGVuZ3RoID4gMCkgPyBtb2RlbE5hbWUgOiB0aGlzLm5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbmZpZ3VyZSB0cmFuc3BvcnQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZ30gY29uZmlnIC0gRnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBjb25maWd1cmVUcmFuc3BvcnQoY29uZmlnKSB7XG4gICAgaWYgKCFjb25maWcgfHwgdHlwZW9mIGNvbmZpZyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwidXJsXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnVybCA9IGNvbmZpZy51cmxcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJzaGFyZWRcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2hhcmVkID0gY29uZmlnLnNoYXJlZFxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcIndlYnNvY2tldENsaWVudFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgPSBjb25maWcud2Vic29ja2V0Q2xpZW50XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwid2Vic29ja2V0VXJsXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldFVybCA9IGNvbmZpZy53ZWJzb2NrZXRVcmxcbiAgICAgIC8vIFJlc2V0IGNhY2hlZCBpbnRlcm5hbCBjbGllbnQgc28gdGhlIG5ldyBVUkwgdGFrZXMgZWZmZWN0IG9uIG5leHQgc3Vic2NyaWJlXG4gICAgICByZXNldEludGVybmFsV2Vic29ja2V0Q2xpZW50KClcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJyZXF1ZXN0SGVhZGVyc1wiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0SGVhZGVycyA9IGNvbmZpZy5yZXF1ZXN0SGVhZGVyc1xuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInJlcXVlc3RDb250ZXh0XCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RDb250ZXh0ID0gY29uZmlnLnJlcXVlc3RDb250ZXh0XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwidGltZW91dFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lb3V0ID0gY29uZmlnLnRpbWVvdXRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJzaWduYWxcIikpIHtcbiAgICAgIGlmIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNpZ25hbCAhPT0gY29uZmlnLnNpZ25hbCkge1xuICAgICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNpZ25hbCA9IGNvbmZpZy5zaWduYWxcbiAgICAgICAgcmVzZXRJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwidGltZVpvbmVcIikpIHtcbiAgICAgIGlmIChjb25maWcudGltZVpvbmUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBkZWxldGUgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lWm9uZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lWm9uZSA9IGNvbmZpZy50aW1lWm9uZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInNlc3Npb25TdG9yZVwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zZXNzaW9uU3RvcmUgPSBjb25maWcuc2Vzc2lvblN0b3JlXG4gICAgICAvLyBSZXNldCBjYWNoZWQgaW50ZXJuYWwgY2xpZW50IHNvIHRoZSBuZXcgc2Vzc2lvblN0b3JlIGlzIHBpY2tlZCB1cC5cbiAgICAgIHJlc2V0SW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKVxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcIm9mZmxpbmVTeW5jXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jID0gY29uZmlnLm9mZmxpbmVTeW5jXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvbm5lY3QgdGhlIGludGVybmFsIFdlYlNvY2tldCBhbmQgZW5hYmxlIGF1dG8tcmVjb25uZWN0LlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIsIHNpZ25hbD86IEFib3J0U2lnbmFsfX0gW29wdGlvbnNdIC0gU3RhcnR1cCBjb250cm9scyBjb21wb3NlZCB3aXRoIHRoZSBjb25maWd1cmVkIHRyYW5zcG9ydCBjb250cm9scy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb25uZWN0ZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY29ubmVjdFdlYnNvY2tldChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBjbGllbnQgPSByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKVxuXG4gICAgaWYgKCFjbGllbnQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcImNvbm5lY3RXZWJzb2NrZXQgcmVxdWlyZXMgY29uZmlndXJlVHJhbnNwb3J0KHt3ZWJzb2NrZXRVcmx9KVwiKVxuICAgIH1cblxuICAgIGF3YWl0IGNsaWVudC5jb25uZWN0KGZyb250ZW5kTW9kZWxXZWJzb2NrZXRTdGFydHVwQ29udHJvbHMob3B0aW9ucykpXG4gIH1cblxuICAvKipcbiAgICogRGlzY29ubmVjdCB0aGUgaW50ZXJuYWwgV2ViU29ja2V0IGFuZCBkaXNhYmxlIGF1dG8tcmVjb25uZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsb3NlZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBkaXNjb25uZWN0V2Vic29ja2V0KCkge1xuICAgIGlmICghaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQpIHJldHVyblxuXG4gICAgY29uc3QgY2xpZW50ID0gaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRcblxuICAgIGRldGFjaEludGVybmFsV2Vic29ja2V0Q2xpZW50KGNsaWVudClcbiAgICBhd2FpdCBjbGllbnQuZGlzY29ubmVjdEFuZFN0b3BSZWNvbm5lY3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIHVudGlsIHF1ZXVlZCBhbmQgYWN0aXZlIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCByZXF1ZXN0cyBmaW5pc2guXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbElkbGVXYWl0QXJnc30gW2FyZ3NdIC0gV2FpdCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRyYW5zcG9ydCBpcyBpZGxlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHdhaXRGb3JJZGxlKGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtxdWlldE1zID0gMCwgdGltZW91dDogdGltZW91dE1zID0gNTAwMCwgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuICAgIGNvbnN0IHJlc3RBcmdLZXlzID0gT2JqZWN0LmtleXMocmVzdEFyZ3MpXG5cbiAgICBpZiAocmVzdEFyZ0tleXMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHdhaXRGb3JJZGxlIGFyZ3M6ICR7cmVzdEFyZ0tleXMuam9pbihcIiwgXCIpfWApXG4gICAgfVxuXG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUocXVpZXRNcykgfHwgcXVpZXRNcyA8IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgd2FpdEZvcklkbGUgcXVpZXRNcyB0byBiZSBhIG5vbi1uZWdhdGl2ZSBudW1iZXIsIGdvdDogJHtxdWlldE1zfWApXG4gICAgfVxuXG4gICAgYXdhaXQgdGltZW91dChcbiAgICAgIHt0aW1lb3V0OiB0aW1lb3V0TXMsIGVycm9yTWVzc2FnZTogXCJUaW1lZCBvdXQgd2FpdGluZyBmb3IgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHRvIGJlY29tZSBpZGxlXCJ9LFxuICAgICAgYXN5bmMgKCkgPT4gYXdhaXQgd2FpdEZvckZyb250ZW5kTW9kZWxUcmFuc3BvcnRJZGxlKHF1aWV0TXMpXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGN1cnJlbnQgV2ViU29ja2V0IGNvbm5lY3Rpb24gc3RhdGUuXG4gICAqIEByZXR1cm5zIHt7ZGlzY29ubmVjdGVkU2luY2U6IG51bWJlciB8IG51bGwsIGhhc0NsaWVudDogYm9vbGVhbiwgaXNPcGVuOiBib29sZWFuLCBsaXN0ZW5lckNvdW50OiBudW1iZXJ9fSAtIFNuYXBzaG90IG9mIHRoZSBtYW5hZ2VkIHdlYnNvY2tldCBjb25uZWN0aW9uIHN0YXRlLlxuICAgKi9cbiAgc3RhdGljIHdlYnNvY2tldFN0YXRlKCkge1xuICAgIGlmICghaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQpIHtcbiAgICAgIHJldHVybiB7ZGlzY29ubmVjdGVkU2luY2U6IG51bGwsIGhhc0NsaWVudDogZmFsc2UsIGlzT3BlbjogZmFsc2UsIGxpc3RlbmVyQ291bnQ6IDB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmludGVybmFsV2Vic29ja2V0Q2xpZW50LnN0YXRlKCksXG4gICAgICBoYXNDbGllbnQ6IHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2xvc2UgdGhlIHJhdyBXZWJTb2NrZXQgd2l0aG91dCBkaXNhYmxpbmcgYXV0by1yZWNvbm5lY3QuIFVzZWQgYnkgdGVzdHMgdG9cbiAgICogc2ltdWxhdGUgYW4gdW5leHBlY3RlZCBuZXR3b3JrIGRyb3AgYW5kIHZlcmlmeSByZWNvbm5lY3Rpb24gYmVoYXZpb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIHNvY2tldCBoYXMgY2xvc2VkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGRyb3BXZWJzb2NrZXQoKSB7XG4gICAgaWYgKCFpbnRlcm5hbFdlYnNvY2tldENsaWVudCkgcmV0dXJuXG5cbiAgICBhd2FpdCBpbnRlcm5hbFdlYnNvY2tldENsaWVudC5kcm9wQ29ubmVjdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogU2V0cyBnbG9iYWwgbWV0YWRhdGEgb24gdGhlIFdlYlNvY2tldCBjb25uZWN0aW9uLiBTZW50IHRvIHRoZSBzZXJ2ZXIgaW1tZWRpYXRlbHlcbiAgICogb3ZlciBXZWJTb2NrZXQgYW5kIGV4cG9zZWQgdG8gV2ViU29ja2V0LWJvcm5lIHJlcXVlc3RzIGFzIHJlcXVlc3QgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBNZXRhZGF0YSBrZXkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gTWV0YWRhdGEgdmFsdWUgKG51bGwgdG8gY2xlYXIpLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBzZXRXZWJzb2NrZXRNZXRhZGF0YShrZXksIHZhbHVlKSB7XG4gICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50IHx8IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpKVxuXG4gICAgaWYgKCFjbGllbnQgfHwgdHlwZW9mIGNsaWVudC5zZXRNZXRhZGF0YSAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm5cblxuICAgIGNsaWVudC5zZXRNZXRhZGF0YShrZXksIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIE9wZW5zIGEgbWFuYWdlZCBjb25uZWN0aW9uIHRoYXQgYXV0by1vcGVucywgYXV0by1jbG9zZXMsIGFuZFxuICAgKiBhdXRvLXJlY29ubmVjdHMgYmFzZWQgb24gYHNob3VsZENvbm5lY3QoKWAgYW5kIGBwYXJhbXMoKWAuXG4gICAqIENhbGwgYGhhbmRsZS5zeW5jKClgIHdoZW5ldmVyIHRoZSBpbnB1dHMgdGhhdCBkcml2ZSB0aG9zZVxuICAgKiBmdW5jdGlvbnMgY2hhbmdlIChlLmcuIGN1cnJlbnQtdXNlciBzaWduLWluL291dCkuIFRoZSBoYW5kbGVcbiAgICogcmV0cmllcyB3aGVuIHRoZSBXUyBjbGllbnQgaXNuJ3QgcmVhZHkgYW5kIHJlb3BlbnMgb24gY2xvc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25uZWN0aW9uVHlwZSAtIENvbm5lY3Rpb24gY2xhc3MgbmFtZSByZWdpc3RlcmVkIG9uIHRoZSBzZXJ2ZXIuXG4gICAqIEBwYXJhbSB7e3Nob3VsZENvbm5lY3Q6ICgpID0+IGJvb2xlYW4sIHBhcmFtczogKCkgPT4gUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzaWduYWw/OiBBYm9ydFNpZ25hbCwgb25NZXNzYWdlPzogKGJvZHk6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiB2b2lkfX0gb3B0aW9ucyAtIENvbm5lY3Rpb24gbGlmZWN5Y2xlLCBjYW5jZWxsYXRpb24sIGFuZCBwYXlsb2FkIGNhbGxiYWNrcy5cbiAgICogQHJldHVybnMge3tzeW5jOiAoKSA9PiB2b2lkLCBjbG9zZTogKCkgPT4gdm9pZH19IC0gSGFuZGxlIHVzZWQgdG8gcmVzeW5jIG9yIGNsb3NlIHRoZSBtYW5hZ2VkIGNvbm5lY3Rpb24uXG4gICAqL1xuICBzdGF0aWMgb3Blbk1hbmFnZWRDb25uZWN0aW9uKGNvbm5lY3Rpb25UeXBlLCBvcHRpb25zKSB7XG4gICAgLyoqXG4gICAgICogQ29ubmVjdGlvbi5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgbGV0IGNvbm5lY3Rpb24gPSBudWxsXG4gICAgbGV0IGNsb3NlZCA9IGZhbHNlXG4gICAgLyoqXG4gICAgICogUmV0cnkgdGltZXIuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbH0gKi9cbiAgICBsZXQgcmV0cnlUaW1lciA9IG51bGxcbiAgICBsZXQgbGFzdFBhcmFtc0pzb24gPSBcIlwiXG4gICAgY29uc3QgY29udHJvbHMgPSBmcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKHtzaWduYWw6IG9wdGlvbnMuc2lnbmFsfSlcbiAgICBjb25zdCBjbGVhclJldHJ5VGltZXIgPSAoKSA9PiB7XG4gICAgICBpZiAocmV0cnlUaW1lciA9PT0gbnVsbCkgcmV0dXJuXG5cbiAgICAgIGdsb2JhbFRoaXMuY2xlYXJUaW1lb3V0KHJldHJ5VGltZXIpXG4gICAgICByZXRyeVRpbWVyID0gbnVsbFxuICAgIH1cblxuICAgIGNvbnN0IGNsb3NlID0gKCkgPT4ge1xuICAgICAgaWYgKGNsb3NlZCkgcmV0dXJuXG5cbiAgICAgIGNsb3NlZCA9IHRydWVcbiAgICAgIGNsZWFyUmV0cnlUaW1lcigpXG4gICAgICBjb250cm9scy5zaWduYWw/LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBjbG9zZSlcbiAgICAgIGlmIChjb25uZWN0aW9uICYmICFjb25uZWN0aW9uLmlzQ2xvc2VkKCkpIGNvbm5lY3Rpb24uY2xvc2UoKVxuICAgICAgY29ubmVjdGlvbiA9IG51bGxcbiAgICB9XG5cbiAgICBjb25zdCBzeW5jID0gKCkgPT4ge1xuICAgICAgaWYgKGNsb3NlZCkgcmV0dXJuXG5cbiAgICAgIGlmICghb3B0aW9ucy5zaG91bGRDb25uZWN0KCkpIHtcbiAgICAgICAgY2xlYXJSZXRyeVRpbWVyKClcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24gJiYgIWNvbm5lY3Rpb24uaXNDbG9zZWQoKSkgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgICAgIGNvbm5lY3Rpb24gPSBudWxsXG4gICAgICAgIGxhc3RQYXJhbXNKc29uID0gXCJcIlxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgY29uc3QgbmV4dFBhcmFtcyA9IG9wdGlvbnMucGFyYW1zKClcbiAgICAgIGNvbnN0IG5leHRQYXJhbXNKc29uID0gSlNPTi5zdHJpbmdpZnkobmV4dFBhcmFtcylcblxuICAgICAgLy8gQWxyZWFkeSBjb25uZWN0ZWQgd2l0aCBzYW1lIHBhcmFtcyDigJQgbm90aGluZyB0byBkby5cbiAgICAgIGlmIChjb25uZWN0aW9uICYmICFjb25uZWN0aW9uLmlzQ2xvc2VkKCkgJiYgbmV4dFBhcmFtc0pzb24gPT09IGxhc3RQYXJhbXNKc29uKSByZXR1cm5cblxuICAgICAgLy8gQ29ubmVjdGVkIGJ1dCBwYXJhbXMgY2hhbmdlZCDigJQgc2VuZCB1cGRhdGUgbWVzc2FnZS5cbiAgICAgIC8vIEd1YXJkIHdpdGggdHJ5L2NhdGNoOiB0aGUgY29ubmVjdGlvbiBoYW5kbGUgc3RheXMgbGl2ZSBkdXJpbmdcbiAgICAgIC8vIHJlY29ubmVjdCBidXQgdGhlIHVuZGVybHlpbmcgc29ja2V0IG1heSBiZSBjbG9zZWQuXG4gICAgICBpZiAoY29ubmVjdGlvbiAmJiAhY29ubmVjdGlvbi5pc0Nsb3NlZCgpKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29ubmVjdGlvbi5zZW5kTWVzc2FnZShuZXh0UGFyYW1zKVxuICAgICAgICAgIGxhc3RQYXJhbXNKc29uID0gbmV4dFBhcmFtc0pzb25cbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgY29ubmVjdGlvbiA9IG51bGxcbiAgICAgICAgICBsYXN0UGFyYW1zSnNvbiA9IFwiXCJcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBXUyBjbGllbnQgbm90IHJlYWR5IOKAlCByZXRyeS4gQ2hlY2sgdGhlIGFjdHVhbCBjbGllbnQgKHdoaWNoXG4gICAgICAvLyBtYXkgYmUgYW4gaW5qZWN0ZWQgd2Vic29ja2V0Q2xpZW50KSBpbnN0ZWFkIG9mIHdlYnNvY2tldFN0YXRlKClcbiAgICAgIC8vIHdoaWNoIG9ubHkgcmVmbGVjdHMgdGhlIGludGVybmFsIGNsaWVudC5cbiAgICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgICAgaWYgKCFjbGllbnQgfHwgIWNsaWVudC5pc09wZW4oKSkge1xuICAgICAgICBpZiAocmV0cnlUaW1lciA9PT0gbnVsbCkge1xuICAgICAgICAgIHJldHJ5VGltZXIgPSBnbG9iYWxUaGlzLnNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgcmV0cnlUaW1lciA9IG51bGxcbiAgICAgICAgICAgIHN5bmMoKVxuICAgICAgICAgIH0sIDI1MClcbiAgICAgICAgfVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgbGFzdFBhcmFtc0pzb24gPSBuZXh0UGFyYW1zSnNvblxuICAgICAgY29ubmVjdGlvbiA9IGNsaWVudC5vcGVuQ29ubmVjdGlvbihjb25uZWN0aW9uVHlwZSwge1xuICAgICAgICBwYXJhbXM6IG5leHRQYXJhbXMsXG4gICAgICAgIG9uTWVzc2FnZTogb3B0aW9ucy5vbk1lc3NhZ2UsXG4gICAgICAgIG9uQ2xvc2U6ICgpID0+IHtcbiAgICAgICAgICBpZiAoY29ubmVjdGlvbj8uaXNDbG9zZWQoKSkge1xuICAgICAgICAgICAgY29ubmVjdGlvbiA9IG51bGxcbiAgICAgICAgICAgIGxhc3RQYXJhbXNKc29uID0gXCJcIlxuICAgICAgICAgICAgc3luYygpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH1cblxuICAgIGNvbnRyb2xzLnNpZ25hbD8uYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGNsb3NlLCB7b25jZTogdHJ1ZX0pXG5cbiAgICBpZiAoY29udHJvbHMuc2lnbmFsPy5hYm9ydGVkKSB7XG4gICAgICBjbG9zZSgpXG4gICAgfSBlbHNlIHtcbiAgICAgIHN5bmMoKVxuICAgIH1cblxuICAgIHJldHVybiB7c3luYywgY2xvc2V9XG4gIH1cblxuICAvKipcbiAgICogT3BlbnMgYSAxOjEgYFdlYnNvY2tldENvbm5lY3Rpb25gIG9mIHRoZSBnaXZlbiB0eXBlLiBUaGluXG4gICAqIGNvbnZlbmllbmNlIHdyYXBwZXIgYXJvdW5kIHRoZSBpbnRlcm5hbCBXUyBjbGllbnQnc1xuICAgKiBgb3BlbkNvbm5lY3Rpb25gLiBBcHBzIHVzZSB0aGlzIGZvciBwZXItc2Vzc2lvbiBzdGF0ZS9tZXNzYWdpbmdcbiAgICogdGhhdCBkb2Vzbid0IGZpdCB0aGUgcHViL3N1YiBDaGFubmVsIG1vZGVsIChsb2NhbGUsIHByZXNlbmNlKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbm5lY3Rpb25UeXBlIC0gTmFtZSB0aGUgc2VydmVyIHJlZ2lzdGVyZWQgdGhlIGNsYXNzIHVuZGVyLlxuICAgKiBAcGFyYW0ge3twYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHRpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWwsIG9uQ29ubmVjdD86ICgpID0+IHZvaWQsIG9uTWVzc2FnZT86IChib2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gdm9pZCwgb25EaXNjb25uZWN0PzogKCkgPT4gdm9pZCwgb25SZXN1bWU/OiAoKSA9PiB2b2lkLCBvbkNsb3NlPzogKHJlYXNvbjogc3RyaW5nKSA9PiB2b2lkfX0gW29wdGlvbnNdIC0gQ29ubmVjdGlvbiBvcHRpb25zLCByZWFkaW5lc3MgY29udHJvbHMsIGFuZCBldmVudCBoYW5kbGVycy4gQ29ubmVjdCB0aGUgY2xpZW50IGZpcnN0OyB0aGUgdGltZW91dCBjb3ZlcnMgc2VydmVyLWNvbmZpcm1lZCByZWFkaW5lc3MgYW5kIHRoZSBzaWduYWwgY2FuY2VscyByZWFkaW5lc3Mgd2l0aG91dCBlbnRlcmluZyB0aGUgd2lyZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7e3JlYWR5OiBQcm9taXNlPHZvaWQ+LCBjbG9zZTogKCkgPT4gdm9pZH19IC0gV2Vic29ja2V0IGNvbm5lY3Rpb24gaGFuZGxlLlxuICAgKi9cbiAgc3RhdGljIG9wZW5XZWJzb2NrZXRDb25uZWN0aW9uKGNvbm5lY3Rpb25UeXBlLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBjbGllbnQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgfHwgcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkpXG5cbiAgICBpZiAoIWNsaWVudCB8fCB0eXBlb2YgY2xpZW50Lm9wZW5Db25uZWN0aW9uICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIm9wZW5XZWJzb2NrZXRDb25uZWN0aW9uIHJlcXVpcmVzIGNvbmZpZ3VyZVRyYW5zcG9ydCh7d2Vic29ja2V0VXJsfSlcIilcbiAgICB9XG5cbiAgICBjb25zdCB7c2lnbmFsLCB0aW1lb3V0TXMsIC4uLmNvbm5lY3Rpb25PcHRpb25zfSA9IG9wdGlvbnNcblxuICAgIHJldHVybiBjbGllbnQub3BlbkNvbm5lY3Rpb24oY29ubmVjdGlvblR5cGUsIHtcbiAgICAgIC4uLmNvbm5lY3Rpb25PcHRpb25zLFxuICAgICAgLi4uZnJvbnRlbmRNb2RlbFdlYnNvY2tldFN0YXJ0dXBDb250cm9scyh7c2lnbmFsLCB0aW1lb3V0TXN9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU3Vic2NyaWJlcyB0byBhIHB1Yi9zdWIgYFdlYnNvY2tldENoYW5uZWxgLiBUaGluIHdyYXBwZXIgYXJvdW5kXG4gICAqIHRoZSBpbnRlcm5hbCBjbGllbnQncyBgc3Vic2NyaWJlQ2hhbm5lbGAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjaGFubmVsVHlwZSAtIENoYW5uZWwgY2xhc3MgbmFtZSByZWdpc3RlcmVkIG9uIHRoZSBzZXJ2ZXIuXG4gICAqIEBwYXJhbSB7e3BhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgdGltZW91dE1zPzogbnVtYmVyLCBzaWduYWw/OiBBYm9ydFNpZ25hbCwgb25NZXNzYWdlPzogKGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB2b2lkLCBvbkRpc2Nvbm5lY3Q/OiAoKSA9PiB2b2lkLCBvblJlc3VtZT86ICgpID0+IHZvaWQsIG9uQ2xvc2U/OiAocmVhc29uOiBzdHJpbmcpID0+IHZvaWR9fSBbb3B0aW9uc10gLSBDaGFubmVsIG9wdGlvbnMsIHN0YXJ0dXAgY29udHJvbHMsIGFuZCBldmVudCBoYW5kbGVycy4gVGhlIHRpbWVvdXQgY292ZXJzIGNvbm5lY3QgYW5kIHNlcnZlci1jb25maXJtZWQgcmVhZGluZXNzIG9ubHk7IHRoZSBzaWduYWwgY2FuY2VscyBzdGFydHVwIHdpdGhvdXQgZW50ZXJpbmcgdGhlIHdpcmUgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3tyZWFkeTogUHJvbWlzZTx2b2lkPiwgY2xvc2U6ICgpID0+IHZvaWR9fSAtIFdlYnNvY2tldCBjaGFubmVsIGhhbmRsZSBmcm9tIHRoZSBjb25maWd1cmVkIGNsaWVudC5cbiAgICovXG4gIHN0YXRpYyBzdWJzY3JpYmVXZWJzb2NrZXRDaGFubmVsKGNoYW5uZWxUeXBlLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBjbGllbnQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgfHwgcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkpXG5cbiAgICBpZiAoIWNsaWVudCB8fCB0eXBlb2YgY2xpZW50LnN1YnNjcmliZUNoYW5uZWwgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3Vic2NyaWJlV2Vic29ja2V0Q2hhbm5lbCByZXF1aXJlcyBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldFVybH0pXCIpXG4gICAgfVxuXG4gICAgY29uc3Qge3BhcmFtcywgc2lnbmFsLCB0aW1lb3V0TXMsIC4uLmNoYW5uZWxPcHRpb25zfSA9IG9wdGlvbnNcbiAgICBjb25zdCByZXF1ZXN0Q29udGV4dCA9IGZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCgpXG4gICAgY29uc3Qgc2NvcGVkUGFyYW1zID0gbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQsIHBhcmFtcyA9PT0gdW5kZWZpbmVkID8ge30gOiBwYXJhbXMpXG4gICAgY29uc3Qgc3RhcnR1cENvbnRyb2xzID0gZnJvbnRlbmRNb2RlbFdlYnNvY2tldFN0YXJ0dXBDb250cm9scyh7c2lnbmFsLCB0aW1lb3V0TXN9KVxuICAgIGNvbnN0IHNjb3BlZFBhcmFtc09wdGlvbiA9IHBhcmFtcyA9PT0gdW5kZWZpbmVkICYmIE9iamVjdC5rZXlzKHJlcXVlc3RDb250ZXh0KS5sZW5ndGggPT09IDBcbiAgICAgID8ge31cbiAgICAgIDoge3BhcmFtczogc2NvcGVkUGFyYW1zfVxuICAgIGNvbnN0IGhhbmRsZSA9IGNsaWVudC5zdWJzY3JpYmVDaGFubmVsKGNoYW5uZWxUeXBlLCB7Li4uY2hhbm5lbE9wdGlvbnMsIC4uLnNjb3BlZFBhcmFtc09wdGlvbiwgLi4uc3RhcnR1cENvbnRyb2xzfSlcblxuICAgIGlmICh0eXBlb2YgY2xpZW50LmNvbm5lY3QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdm9pZCBjbGllbnQuY29ubmVjdChzdGFydHVwQ29udHJvbHMpLmNhdGNoKCgpID0+IGhhbmRsZS5jbG9zZSgpKVxuICAgIH1cblxuICAgIHJldHVybiBoYW5kbGVcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YWxscyBXZWJTb2NrZXQgbGlmZWN5Y2xlIGhvb2tzIG9uIGdsb2JhbFRoaXMgZm9yIHN5c3RlbSB0ZXN0IGFjY2Vzcy5cbiAgICogVGVzdHMgY2FuIGNhbGwgYGdsb2JhbFRoaXMuX192ZWxvY2lvdXNfd2Vic29ja2V0X2hvb2tzLmNvbm5lY3QoKWAgZXRjLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBpbnN0YWxsV2Vic29ja2V0VGVzdEhvb2tzKCkge1xuICAgIGlmICh0eXBlb2YgZ2xvYmFsVGhpcyA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuXG5cbiAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZ2xvYmFsVGhpcykuX192ZWxvY2lvdXNfd2Vic29ja2V0X2hvb2tzID0ge1xuICAgICAgY29ubmVjdDogKCkgPT4gdGhpcy5jb25uZWN0V2Vic29ja2V0KCksXG4gICAgICBkaXNjb25uZWN0OiAoKSA9PiB0aGlzLmRpc2Nvbm5lY3RXZWJzb2NrZXQoKSxcbiAgICAgIGRyb3A6ICgpID0+IHRoaXMuZHJvcFdlYnNvY2tldCgpLFxuICAgICAgc3RhdGU6ICgpID0+IHRoaXMud2Vic29ja2V0U3RhdGUoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dHJpYnV0ZXMgZnJvbSByZXNwb25zZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtvYmplY3R9IHJlc3BvbnNlIC0gUmVzcG9uc2UgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59IC0gQXR0cmlidXRlcyBmcm9tIHBheWxvYWQuXG4gICAqL1xuICBzdGF0aWMgYXR0cmlidXRlc0Zyb21SZXNwb25zZShyZXNwb25zZSkge1xuICAgIGNvbnN0IG1vZGVsRGF0YSA9IHRoaXMubW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuXG4gICAgcmV0dXJuIG1vZGVsRGF0YS5hdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtb2RlbCBkYXRhIGZyb20gcmVzcG9uc2UuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7b2JqZWN0fSByZXNwb25zZSAtIFJlc3BvbnNlIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt7YWJpbGl0aWVzOiBSZWNvcmQ8c3RyaW5nLCBib29sZWFuPiwgYXR0YWNobWVudE93bmVyOiB7cmVjb3JkSWQ6IHN0cmluZywgcmVjb3JkVHlwZTogc3RyaW5nLCByZXNvdXJjZU5hbWU6IHN0cmluZ30gfCBudWxsLCBhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBhc3NvY2lhdGlvbkNvdW50czogUmVjb3JkPHN0cmluZywgbnVtYmVyPiwgcXVlcnlEYXRhOiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzOiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBzZWxlY3RlZEF0dHJpYnV0ZXM6IFNldDxzdHJpbmc+fX0gLSBBdHRyaWJ1dGVzLCBhdHRhY2htZW50IG93bmVyLCBwcmVsb2FkZWQgcmVsYXRpb25zaGlwcywgYXNzb2NpYXRpb24gY291bnRzLCBxdWVyeURhdGEsIGFiaWxpdGllcywgYW5kIHNlbGVjdGVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzdGF0aWMgbW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgaWYgKCFyZXNwb25zZSB8fCB0eXBlb2YgcmVzcG9uc2UgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgb2JqZWN0IHJlc3BvbnNlIGJ1dCBnb3Q6ICR7cmVzcG9uc2V9YClcbiAgICB9XG5cbiAgICAvLyBOYXJyb3dzIHRoZSByZXNwb25zZSBvYmplY3QgdG8gdGhlIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCB2YWx1ZSBtYXAuXG4gICAgY29uc3QgcmVzcG9uc2VPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChyZXNwb25zZSlcblxuICAgIC8qKlxuICAgICAqIERlZmluZXMgbW9kZWxEYXRhLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqL1xuICAgIGxldCBtb2RlbERhdGFcblxuICAgIGlmIChyZXNwb25zZU9iamVjdC5tb2RlbCAmJiB0eXBlb2YgcmVzcG9uc2VPYmplY3QubW9kZWwgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIC8vIE5hcnJvd3MgdGhlIG5lc3RlZCBtb2RlbCBwYXlsb2FkIHRvIHRoZSBmcm9udGVuZC1tb2RlbCB2YWx1ZSBtYXAuXG4gICAgICBtb2RlbERhdGEgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChyZXNwb25zZU9iamVjdC5tb2RlbClcbiAgICB9IGVsc2UgaWYgKHJlc3BvbnNlT2JqZWN0LmF0dHJpYnV0ZXMgJiYgdHlwZW9mIHJlc3BvbnNlT2JqZWN0LmF0dHJpYnV0ZXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIC8vIE5hcnJvd3MgdGhlIG5lc3RlZCBhdHRyaWJ1dGVzIHBheWxvYWQgdG8gdGhlIGZyb250ZW5kLW1vZGVsIHZhbHVlIG1hcC5cbiAgICAgIG1vZGVsRGF0YSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKHJlc3BvbnNlT2JqZWN0LmF0dHJpYnV0ZXMpXG4gICAgfSBlbHNlIHtcbiAgICAgIG1vZGVsRGF0YSA9IHJlc3BvbnNlT2JqZWN0XG4gICAgfVxuXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKHsuLi5tb2RlbERhdGF9KVxuICAgIGNvbnN0IHByZWxvYWRlZFJlbGF0aW9uc2hpcHMgPSBpc1BsYWluT2JqZWN0KGF0dHJpYnV0ZXNbUFJFTE9BREVEX1JFTEFUSU9OU0hJUFNfS0VZXSlcbiAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoYXR0cmlidXRlc1tQUkVMT0FERURfUkVMQVRJT05TSElQU19LRVldKVxuICAgICAgOiB7fVxuICAgIGNvbnN0IGFzc29jaWF0aW9uQ291bnRzID0gaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzW0FTU09DSUFUSU9OX0NPVU5UU19LRVldKVxuICAgICAgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovIChhdHRyaWJ1dGVzW0FTU09DSUFUSU9OX0NPVU5UU19LRVldKVxuICAgICAgOiB7fVxuICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IGlzUGxhaW5PYmplY3QoYXR0cmlidXRlc1tRVUVSWV9EQVRBX0tFWV0pXG4gICAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKGF0dHJpYnV0ZXNbUVVFUllfREFUQV9LRVldKVxuICAgICAgOiB7fVxuICAgIGNvbnN0IGFiaWxpdGllcyA9IGlzUGxhaW5PYmplY3QoYXR0cmlidXRlc1tBQklMSVRJRVNfS0VZXSlcbiAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuPn0gKi8gKGF0dHJpYnV0ZXNbQUJJTElUSUVTX0tFWV0pXG4gICAgICA6IHt9XG4gICAgY29uc3Qgc2VsZWN0ZWRBdHRyaWJ1dGVzRnJvbVBheWxvYWQgPSBBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXNbU0VMRUNURURfQVRUUklCVVRFU19LRVldKVxuICAgICAgPyBuZXcgU2V0KC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChhdHRyaWJ1dGVzW1NFTEVDVEVEX0FUVFJJQlVURVNfS0VZXSkuZmlsdGVyKChhdHRyaWJ1dGVOYW1lKSA9PiB0eXBlb2YgYXR0cmlidXRlTmFtZSA9PT0gXCJzdHJpbmdcIikpXG4gICAgICA6IG51bGxcbiAgICBjb25zdCBhdHRhY2htZW50T3duZXJQYXlsb2FkID0gYXR0cmlidXRlc1tBVFRBQ0hNRU5UX09XTkVSX0tFWV1cbiAgICBsZXQgYXR0YWNobWVudE93bmVyID0gbnVsbFxuXG4gICAgaWYgKGF0dGFjaG1lbnRPd25lclBheWxvYWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KGF0dGFjaG1lbnRPd25lclBheWxvYWQpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEV4cGVjdGVkICR7QVRUQUNITUVOVF9PV05FUl9LRVl9IHRvIGJlIGFuIG9iamVjdGApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGF0dGFjaG1lbnRPd25lck9iamVjdCA9IC8qKiBAdHlwZSB7e3JlY29yZElkPzogdW5rbm93biwgcmVjb3JkVHlwZT86IHVua25vd24sIHJlc291cmNlTmFtZT86IHVua25vd259fSAqLyAoYXR0YWNobWVudE93bmVyUGF5bG9hZClcblxuICAgICAgYXR0YWNobWVudE93bmVyID0ge1xuICAgICAgICByZWNvcmRJZDogZm9yY2VkTm9uQmxhbmtTdHJpbmcoYXR0YWNobWVudE93bmVyT2JqZWN0LnJlY29yZElkLCBgJHtBVFRBQ0hNRU5UX09XTkVSX0tFWX0ucmVjb3JkSWRgKSxcbiAgICAgICAgcmVjb3JkVHlwZTogZm9yY2VkTm9uQmxhbmtTdHJpbmcoYXR0YWNobWVudE93bmVyT2JqZWN0LnJlY29yZFR5cGUsIGAke0FUVEFDSE1FTlRfT1dORVJfS0VZfS5yZWNvcmRUeXBlYCksXG4gICAgICAgIHJlc291cmNlTmFtZTogZm9yY2VkTm9uQmxhbmtTdHJpbmcoYXR0YWNobWVudE93bmVyT2JqZWN0LnJlc291cmNlTmFtZSwgYCR7QVRUQUNITUVOVF9PV05FUl9LRVl9LnJlc291cmNlTmFtZWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbQVRUQUNITUVOVF9PV05FUl9LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbUFJFTE9BREVEX1JFTEFUSU9OU0hJUFNfS0VZXVxuICAgIGRlbGV0ZSBhdHRyaWJ1dGVzW1NFTEVDVEVEX0FUVFJJQlVURVNfS0VZXVxuICAgIGRlbGV0ZSBhdHRyaWJ1dGVzW0FTU09DSUFUSU9OX0NPVU5UU19LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbUVVFUllfREFUQV9LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbQUJJTElUSUVTX0tFWV1cblxuICAgIGNvbnN0IHNlbGVjdGVkQXR0cmlidXRlcyA9IHNlbGVjdGVkQXR0cmlidXRlc0Zyb21QYXlsb2FkIHx8IG5ldyBTZXQoT2JqZWN0LmtleXMoYXR0cmlidXRlcykpXG5cbiAgICByZXR1cm4ge2FiaWxpdGllcywgYXR0YWNobWVudE93bmVyLCBhdHRyaWJ1dGVzLCBhc3NvY2lhdGlvbkNvdW50cywgcXVlcnlEYXRhLCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzLCBzZWxlY3RlZEF0dHJpYnV0ZXN9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBwcmVsb2FkZWQgcmVsYXRpb25zaGlwcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHByZWxvYWRlZFJlbGF0aW9uc2hpcHMgLSBQcmVsb2FkZWQgcmVsYXRpb25zaGlwIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFwcGx5UHJlbG9hZGVkUmVsYXRpb25zaGlwcyhtb2RlbCwgcHJlbG9hZGVkUmVsYXRpb25zaGlwcykge1xuICAgIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcFBheWxvYWRdIG9mIE9iamVjdC5lbnRyaWVzKHByZWxvYWRlZFJlbGF0aW9uc2hpcHMpKSB7XG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBtb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLnJlbGF0aW9uc2hpcE1vZGVsQ2xhc3MocmVsYXRpb25zaGlwTmFtZSlcblxuICAgICAgaWYgKHJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwKSB7XG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShyZWxhdGlvbnNoaXBQYXlsb2FkKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX0gcGF5bG9hZCB0byBiZSBhbiBhcnJheWApXG4gICAgICAgIH1cblxuICAgICAgICAvKiogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxCYXNlPn0gKi9cbiAgICAgICAgY29uc3QgcmVsYXRlZE1vZGVscyA9IFtdXG5cbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiByZWxhdGlvbnNoaXBQYXlsb2FkKSB7XG4gICAgICAgICAgY29uc3QgcmVsYXRlZE1vZGVsID0gdGhpcy5pbnN0YW50aWF0ZVJlbGF0aW9uc2hpcFZhbHVlKGVudHJ5LCB0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgICAgICAgaWYgKCEocmVsYXRlZE1vZGVsIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEJhc2UpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9IHBheWxvYWQgZW50cnkgdG8gaW5zdGFudGlhdGUgYSBmcm9udGVuZCBtb2RlbGApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmVsYXRlZE1vZGVscy5wdXNoKHJlbGF0ZWRNb2RlbClcbiAgICAgICAgfVxuXG4gICAgICAgIHJlbGF0aW9uc2hpcC5zZXRMb2FkZWQocmVsYXRlZE1vZGVscylcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkocmVsYXRpb25zaGlwUGF5bG9hZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfSBwYXlsb2FkIHRvIGJlIHNpbmd1bGFyYClcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVsYXRlZE1vZGVsID0gdGhpcy5pbnN0YW50aWF0ZVJlbGF0aW9uc2hpcFZhbHVlKHJlbGF0aW9uc2hpcFBheWxvYWQsIHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICAgIGlmIChyZWxhdGVkTW9kZWwgIT0gdW5kZWZpbmVkICYmICEocmVsYXRlZE1vZGVsIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEJhc2UpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX0gcGF5bG9hZCB0byBpbnN0YW50aWF0ZSBhIGZyb250ZW5kIG1vZGVsYClcbiAgICAgIH1cblxuICAgICAgcmVsYXRpb25zaGlwLnNldExvYWRlZChyZWxhdGVkTW9kZWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zdGFudGlhdGUgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWxhdGlvbnNoaXBQYXlsb2FkIC0gUmVsYXRpb25zaGlwIHBheWxvYWQgdmFsdWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzIHwgbnVsbH0gdGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEluc3RhbnRpYXRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgaW5zdGFudGlhdGVSZWxhdGlvbnNoaXBWYWx1ZShyZWxhdGlvbnNoaXBQYXlsb2FkLCB0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSByZXR1cm4gcmVsYXRpb25zaGlwUGF5bG9hZFxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXBQYXlsb2FkIHx8IHR5cGVvZiByZWxhdGlvbnNoaXBQYXlsb2FkICE9PSBcIm9iamVjdFwiKSByZXR1cm4gcmVsYXRpb25zaGlwUGF5bG9hZFxuXG4gICAgcmV0dXJuIHRhcmdldE1vZGVsQ2xhc3MuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UocmVsYXRpb25zaGlwUGF5bG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc3RhbnRpYXRlIGZyb20gcmVzcG9uc2UuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEluc3RhbmNlVHlwZTxUPn0gcmVzcG9uc2UgLSBSZXNwb25zZSBwYXlsb2FkLCBvciBhbiBhbHJlYWR5LWh5ZHJhdGVkIGluc3RhbmNlIG9mIHRoaXMgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtJbnN0YW5jZVR5cGU8VD59IC0gTmV3IG1vZGVsIGluc3RhbmNlLCBvciB0aGUgc2FtZSBpbnN0YW5jZSB1bmNoYW5nZWQgaWYgaXQgd2FzIGFscmVhZHkgaHlkcmF0ZWQuXG4gICAqL1xuICBzdGF0aWMgaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICAvLyBJZGVtcG90ZW50OiBpZiBhIGNhbGxlciBoYW5kcyB1cyBhbiBhbHJlYWR5LWh5ZHJhdGVkIGluc3RhbmNlIG9mIHRoaXNcbiAgICAvLyBjbGFzcyAobm93IGNvbW1vbiBiZWNhdXNlIHRoZSBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJIGF1dG8tc2VyaWFsaXplc1xuICAgIC8vIGJhY2tlbmQgYFJlY29yZGAgaW5zdGFuY2VzIHJldHVybmVkIGZyb20gY3VzdG9tIGNvbW1hbmRzIGFuZCB0aGVcbiAgICAvLyB0cmFuc3BvcnQgZGVzZXJpYWxpemVyIGh5ZHJhdGVzIHRoZW0gaW50byBtb2RlbHMgYmVmb3JlIHRoZSBjYWxsIHNpdGVcbiAgICAvLyBzZWVzIHRoZSByZXNwb25zZSksIHJldHVybiBpdCBhcy1pcy4gV2l0aG91dCB0aGlzLCBjb2RlIHRoYXQgaGFzXG4gICAgLy8gaGlzdG9yaWNhbGx5IHdyYXBwZWQgY3VzdG9tLWNvbW1hbmQgcmVzcG9uc2VzIGluXG4gICAgLy8gYE1vZGVsLmluc3RhbnRpYXRlRnJvbVJlc3BvbnNlKHJlc3BvbnNlLmZpZWxkKWAgd291bGQgc3ByZWFkIHRoZSBsaXZlXG4gICAgLy8gbW9kZWwgaW5zdGFuY2UgaW50byBhIG5ldyBjb25zdHJ1Y3RvciBjYWxsIGFuZCBwcm9kdWNlIGEgYnJva2VuIG1vZGVsXG4gICAgLy8gd2l0aCBpbnRlcm5hbCBzdGF0ZSBrZXlzIHByb21vdGVkIHRvIGF0dHJpYnV0ZXMuXG4gICAgaWYgKHJlc3BvbnNlIGluc3RhbmNlb2YgdGhpcykge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7SW5zdGFuY2VUeXBlPFQ+fSAqLyAocmVzcG9uc2UpXG4gICAgfVxuXG4gICAgY29uc3QgbW9kZWxEYXRhID0gdGhpcy5tb2RlbERhdGFGcm9tUmVzcG9uc2UocmVzcG9uc2UpXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IG1vZGVsRGF0YS5hdHRyaWJ1dGVzXG4gICAgY29uc3QgcHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IG1vZGVsRGF0YS5wcmVsb2FkZWRSZWxhdGlvbnNoaXBzXG4gICAgY29uc3QgYXNzb2NpYXRpb25Db3VudHMgPSBtb2RlbERhdGEuYXNzb2NpYXRpb25Db3VudHNcbiAgICBjb25zdCBxdWVyeURhdGEgPSBtb2RlbERhdGEucXVlcnlEYXRhXG4gICAgY29uc3QgYWJpbGl0aWVzID0gbW9kZWxEYXRhLmFiaWxpdGllc1xuICAgIGNvbnN0IGF0dGFjaG1lbnRPd25lciA9IG1vZGVsRGF0YS5hdHRhY2htZW50T3duZXJcbiAgICBjb25zdCBzZWxlY3RlZEF0dHJpYnV0ZXMgPSBtb2RlbERhdGEuc2VsZWN0ZWRBdHRyaWJ1dGVzXG4gICAgY29uc3QgcmVjZWl2ZXIgPSAvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzKVxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge25ldyAoYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4pID0+IEluc3RhbmNlVHlwZTxUPn0gKi8gKHJlY2VpdmVyKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoYXR0cmlidXRlcylcbiAgICBtb2RlbC5fYXR0YWNobWVudE93bmVyID0gYXR0YWNobWVudE93bmVyXG4gICAgbW9kZWwuX3NlbGVjdGVkQXR0cmlidXRlcyA9IHNlbGVjdGVkQXR0cmlidXRlcyA/IG5ldyBTZXQoc2VsZWN0ZWRBdHRyaWJ1dGVzKSA6IG51bGxcblxuICAgIHRoaXMuYXBwbHlQcmVsb2FkZWRSZWxhdGlvbnNoaXBzKG1vZGVsLCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGFzc29jaWF0aW9uQ291bnRzIHx8IHt9KSkge1xuICAgICAgbW9kZWwuX3NldEFzc29jaWF0aW9uQ291bnQoYXR0cmlidXRlTmFtZSwgTnVtYmVyKHZhbHVlKSB8fCAwKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgW25hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhxdWVyeURhdGEgfHwge30pKSB7XG4gICAgICBtb2RlbC5fc2V0UXVlcnlEYXRhKG5hbWUsIHZhbHVlKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgW2FjdGlvbiwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGFiaWxpdGllcyB8fCB7fSkpIHtcbiAgICAgIG1vZGVsLl9zZXRDb21wdXRlZEFiaWxpdHkoYWN0aW9uLCBCb29sZWFuKHZhbHVlKSlcbiAgICB9XG5cbiAgICBtb2RlbC5zZXRJc05ld1JlY29yZChmYWxzZSlcbiAgICBtb2RlbC5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMobW9kZWwuYXR0cmlidXRlcygpKVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBSZWNvcmQgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+Pn0gLSBSZXNvbHZlZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kKGlkKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kKGlkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gQXR0cmlidXRlIG1hdGNoIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPiB8IG51bGw+fSAtIEZvdW5kIG1vZGVsIG9yIG51bGwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZEJ5KGNvbmRpdGlvbnMpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpbmRCeShjb25kaXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieSBvciBmYWlsLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBBdHRyaWJ1dGUgbWF0Y2ggY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+Pn0gLSBGb3VuZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kQnlPckZhaWwoY29uZGl0aW9ucykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZEJ5T3JGYWlsKGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBhcnJheS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPltdPn0gLSBMb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHRvQXJyYXkoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS50b0FycmF5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD5bXT59IC0gTG9hZGVkIG1vZGVsIGluc3RhbmNlcy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsb2FkKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkubG9hZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhbGwuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIuXG4gICAqL1xuICBzdGF0aWMgYWxsKCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXJlLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBSb290LW1vZGVsIHdoZXJlIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCB3aGVyZSBjb25kaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIHdoZXJlKGNvbmRpdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLndoZXJlKGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqb2lucy5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gam9pbnMgLSBSZWxhdGlvbnNoaXAgZGVzY3JpcHRvciBqb2lucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIGpvaW5zLlxuICAgKi9cbiAgc3RhdGljIGpvaW5zKGpvaW5zKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5qb2lucyhqb2lucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxpbWl0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gTWF4aW11bSBudW1iZXIgb2YgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIGxpbWl0LlxuICAgKi9cbiAgc3RhdGljIGxpbWl0KHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5saW1pdCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9mZnNldC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIE51bWJlciBvZiByZWNvcmRzIHRvIHNraXAuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCBvZmZzZXQuXG4gICAqL1xuICBzdGF0aWMgb2Zmc2V0KHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5vZmZzZXQodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYWdlLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtudW1iZXJ9IHBhZ2VOdW1iZXIgLSAxLWJhc2VkIHBhZ2UgbnVtYmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggcGFnZSBhcHBsaWVkLlxuICAgKi9cbiAgc3RhdGljIHBhZ2UocGFnZU51bWJlcikge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkucGFnZShwYWdlTnVtYmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVyIHBhZ2UuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBOdW1iZXIgb2YgcmVjb3JkcyBwZXIgcGFnZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIHBhZ2Ugc2l6ZS5cbiAgICovXG4gIHN0YXRpYyBwZXJQYWdlKHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5wZXJQYWdlKHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY291bnQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE51bWJlciBvZiBsb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNvdW50KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuY291bnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIENsYXNzLWxldmVsIGhvb2sgZmlyZWQgd2hlbiBhbnkgcmVjb3JkIG9mIHRoaXMgbW9kZWwgaXMgY3JlYXRlZC5cbiAgICogU3Vic2NyaWJlLXRpbWUgYXV0aG9yaXphdGlvbiBvbmx5IOKAlCBvbmNlIGEgc3Vic2NyaXB0aW9uIGlzXG4gICAqIGFjY2VwdGVkLCBmdXR1cmUgYGNyZWF0ZWAgZXZlbnRzIGZvciB0aGlzIG1vZGVsIGFyZSBkZWxpdmVyZWRcbiAgICogd2l0aG91dCByZS1jaGVja2luZyBwZXItcmVjb3JkIHZpc2liaWxpdHkuIFF1ZXJ5IG9wdGlvbnMgY2FuIHN0aWxsXG4gICAqIG5hcnJvdyB3aGljaCBldmVudHMgcmVhY2ggdGhpcyBjYWxsYmFjay5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogRnJvbnRlbmRNb2RlbEV2ZW50UHJpbWFyeUtleVZhbHVlRm9yPEluc3RhbmNlVHlwZTxUPj4sIG1vZGVsOiBJbnN0YW5jZVR5cGU8VD59KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gRXZlbnQgcXVlcnkgb3IgcmVjb3JkIHByb2plY3Rpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgb25DcmVhdGUoY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHtyZXF1ZXN0Q29udGV4dCwgLi4uZXZlbnRPcHRpb25zUGF5bG9hZH0gPSBmcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZCh0aGlzLCBvcHRpb25zKVxuICAgIGNvbnN0IHN1YiA9IGVuc3VyZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbih0aGlzLCBmcm9udGVuZE1vZGVsRXZlbnRSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2ssIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9XG5cbiAgICByZXR1cm4gYXdhaXQgc3ViLnJlZ2lzdGVyQ2xhc3NDYWxsYmFjayhzdWIuY2xhc3NDcmVhdGVDYWxsYmFja3MsIGVudHJ5KVxuICB9XG5cbiAgLyoqXG4gICAqIENsYXNzLWxldmVsIGhvb2sgZmlyZWQgd2hlbiBhbnkgcmVjb3JkIG9mIHRoaXMgbW9kZWwgaXMgdXBkYXRlZC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogRnJvbnRlbmRNb2RlbEV2ZW50UHJpbWFyeUtleVZhbHVlRm9yPEluc3RhbmNlVHlwZTxUPj4sIG1vZGVsOiBJbnN0YW5jZVR5cGU8VD59KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gRXZlbnQgcXVlcnkgb3IgcmVjb3JkIHByb2plY3Rpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgb25VcGRhdGUoY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHtyZXF1ZXN0Q29udGV4dCwgLi4uZXZlbnRPcHRpb25zUGF5bG9hZH0gPSBmcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZCh0aGlzLCBvcHRpb25zKVxuICAgIGNvbnN0IHN1YiA9IGVuc3VyZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbih0aGlzLCBmcm9udGVuZE1vZGVsRXZlbnRSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2ssIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9XG5cbiAgICByZXR1cm4gYXdhaXQgc3ViLnJlZ2lzdGVyQ2xhc3NDYWxsYmFjayhzdWIuY2xhc3NVcGRhdGVDYWxsYmFja3MsIGVudHJ5KVxuICB9XG5cbiAgLyoqXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEBvdmVybG9hZFxuICAgKiBAcGFyYW0ge1R9IHRoaXMgLSBDb25jcmV0ZSBmcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBGcm9udGVuZE1vZGVsRXZlbnRQcmltYXJ5S2V5VmFsdWVGb3I8SW5zdGFuY2VUeXBlPFQ+Pn0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBBY2NlcHRlZCBmb3IgQVBJIHN5bW1ldHJ5OyBkZXN0cm95IGV2ZW50cyBjYXJyeSBpZHMgb25seS5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICAvKipcbiAgICogQ2xhc3MtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIGFueSByZWNvcmQgb2YgdGhpcyBtb2RlbCBpcyBkZXN0cm95ZWQuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogbmV2ZXJ9KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrIGVyYXNlZCBhdCB0aGUgb3ZlcmxvYWQgaW1wbGVtZW50YXRpb24gYm91bmRhcnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBBY2NlcHRlZCBmb3IgQVBJIHN5bW1ldHJ5OyBkZXN0cm95IGV2ZW50cyBjYXJyeSBpZHMgb25seS5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgb25EZXN0cm95KGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBhc3NlcnROb0Rlc3Ryb3lFdmVudEZpbHRlcih0aGlzLCBvcHRpb25zKVxuXG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0fSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKHRoaXMsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKHRoaXMsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5PG5ldmVyPn0gKi9cbiAgICBjb25zdCBlbnRyeSA9IHtjYWxsYmFja31cblxuICAgIHJldHVybiBhd2FpdCBzdWIucmVnaXN0ZXJDbGFzc0NhbGxiYWNrKHN1Yi5jbGFzc0Rlc3Ryb3lDYWxsYmFja3MsIGVudHJ5KVxuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbmNlLWxldmVsIGhvb2sgZmlyZWQgd2hlbiBUSElTIHJlY29yZCBpcyB1cGRhdGVkLiBUaGVcbiAgICogaW5zdGFuY2UncyBhdHRyaWJ1dGVzIGFyZSBhdXRvLW1lcmdlZCB3aXRoIHRoZSBicm9hZGNhc3QgcGF5bG9hZFxuICAgKiBiZWZvcmUgdGhlIGNhbGxiYWNrIHJ1bnMsIHNvIGNhbGxlcnMgY2FuIHJlYWQgZnJlc2ggdmFsdWVzIHZpYVxuICAgKiBgdGhpcy5zb21lQXR0cigpYCB3aXRob3V0IHJlLWZldGNoaW5nLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7aWQ6IEV2ZW50UHJpbWFyeUtleVZhbHVlLCBtb2RlbDogRnJvbnRlbmRNb2RlbEJhc2U8QXR0cmlidXRlcywgQ3JlYXRlQXR0cmlidXRlcywgVXBkYXRlQXR0cmlidXRlcywgUHJpbWFyeUtleVZhbHVlLCBFdmVudFByaW1hcnlLZXlWYWx1ZT59KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gRXZlbnQgcXVlcnkgb3IgcmVjb3JkIHByb2plY3Rpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBhc3luYyBvblVwZGF0ZShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHtyZXF1ZXN0Q29udGV4dCwgLi4uZXZlbnRPcHRpb25zUGF5bG9hZH0gPSBmcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZChNb2RlbENsYXNzLCBvcHRpb25zKVxuICAgIGNvbnN0IHN1YiA9IGVuc3VyZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbihNb2RlbENsYXNzLCBmcm9udGVuZE1vZGVsRXZlbnRSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCkpXG4gICAgY29uc3QgaWRlbnRpdHkgPSB0aGlzLmlzTmV3UmVjb3JkKCkgPyB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpIDogdGhpcy5wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKVxuICAgIGNvbnN0IGlkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGlkZW50aXR5KVxuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrLCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfVxuICAgIGNvbnN0IGxpc3RlbmVyID0gZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIoc3ViLCBpZCwgdGhpcylcblxuICAgIGxpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcy5hZGQoZW50cnkpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3ViLmVuc3VyZVN1YnNjcmliZWQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgKGN1cnJlbnQpID0+IGN1cnJlbnQudXBkYXRlQ2FsbGJhY2tzLmRlbGV0ZShlbnRyeSkpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgKGN1cnJlbnQpID0+IGN1cnJlbnQudXBkYXRlQ2FsbGJhY2tzLmRlbGV0ZShlbnRyeSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbmNlLWxldmVsIGhvb2sgZmlyZWQgd2hlbiBUSElTIHJlY29yZCBpcyBkZXN0cm95ZWQuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogRXZlbnRQcmltYXJ5S2V5VmFsdWV9KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gQWNjZXB0ZWQgZm9yIEFQSSBzeW1tZXRyeTsgZGVzdHJveSBldmVudHMgY2FycnkgaWRzIG9ubHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgb25EZXN0cm95KGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG5cbiAgICBhc3NlcnROb0Rlc3Ryb3lFdmVudEZpbHRlcihNb2RlbENsYXNzLCBvcHRpb25zKVxuXG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0fSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKE1vZGVsQ2xhc3MsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBpZGVudGl0eSA9IHRoaXMuaXNOZXdSZWNvcmQoKSA/IHRoaXMucHJpbWFyeUtleVZhbHVlKCkgOiB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgY29uc3QgaWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgaWRlbnRpdHkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2t9XG4gICAgY29uc3QgbGlzdGVuZXIgPSBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGlkLCB0aGlzKVxuXG4gICAgbGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcy5hZGQoZW50cnkpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3ViLmVuc3VyZVN1YnNjcmliZWQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgKGN1cnJlbnQpID0+IGN1cnJlbnQuZGVzdHJveUNhbGxiYWNrcy5kZWxldGUoZW50cnkpKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgcmVtb3ZlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJFbnRyeShzdWIsIChjdXJyZW50KSA9PiBjdXJyZW50LmRlc3Ryb3lDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwbHVjay5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7Li4uKHN0cmluZyB8IHN0cmluZ1tdIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pil9IGNvbHVtbnMgLSBQbHVjayBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFBsdWNrZWQgdmFsdWVzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHBsdWNrKC4uLmNvbHVtbnMpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLnBsdWNrKC4uLmNvbHVtbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWFyY2guXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW4gLSBDb2x1bW4gb3IgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7XCJlcVwiIHwgXCJsaWtlXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCI+XCIgfCBcIj49XCIgfCBcIjxcIiB8IFwiPD1cIn0gb3BlcmF0b3IgLSBTZWFyY2ggb3BlcmF0b3IuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU2VhcmNoIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBzZWFyY2ggZmlsdGVyLlxuICAgKi9cbiAgc3RhdGljIHNlYXJjaChwYXRoLCBjb2x1bW4sIG9wZXJhdG9yLCB2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuc2VhcmNoKHBhdGgsIGNvbHVtbiwgb3BlcmF0b3IsIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmFuc2Fjay5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSYW5zYWNrLXN0eWxlIHBhcmFtcyBoYXNoLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBSYW5zYWNrIGZpbHRlcnMgYXBwbGllZC5cbiAgICovXG4gIHN0YXRpYyByYW5zYWNrKHBhcmFtcykge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkucmFuc2FjayhwYXJhbXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzb3J0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHN0cmluZ1tdW10gfCBbc3RyaW5nLCBzdHJpbmddIHwgQXJyYXk8W3N0cmluZywgc3RyaW5nXT4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBzb3J0IC0gU29ydCBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBzb3J0IGRlZmluaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIHNvcnQoc29ydCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuc29ydChzb3J0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3JkZXIuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgc3RyaW5nW11bXSB8IFtzdHJpbmcsIHN0cmluZ10gfCBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHNvcnQgLSBTb3J0IGRlZmluaXRpb24ocykuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlciB3aXRoIHNvcnQgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgb3JkZXIoc29ydCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkub3JkZXIoc29ydClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdyb3VwLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IGdyb3VwIC0gR3JvdXAgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggZ3JvdXAgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgZ3JvdXAoZ3JvdXApIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLmdyb3VwKGdyb3VwKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzdGluY3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFt2YWx1ZV0gLSBXaGV0aGVyIHRvIHJlcXVlc3QgZGlzdGluY3Qgcm93cy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggZGlzdGluY3QgZmxhZy5cbiAgICovXG4gIHN0YXRpYyBkaXN0aW5jdCh2YWx1ZSA9IHRydWUpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLmRpc3RpbmN0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIuXG4gICAqL1xuICBzdGF0aWMgcXVlcnkoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAobmV3IEZyb250ZW5kTW9kZWxRdWVyeSh7bW9kZWxDbGFzczogdGhpc30pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJlbG9hZC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQ+fSBwcmVsb2FkIC0gUHJlbG9hZCBncmFwaC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSB3aXRoIHByZWxvYWQuXG4gICAqL1xuICBzdGF0aWMgcHJlbG9hZChwcmVsb2FkKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAodGhpcy5xdWVyeSgpLnByZWxvYWQocHJlbG9hZCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWxlY3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdIHwgc3RyaW5nPiB8IHN0cmluZyB8IHN0cmluZ1tdfSBzZWxlY3QgLSBNb2RlbC1hd2FyZSBhdHRyaWJ1dGUgc2VsZWN0IG1hcCBvciByb290LW1vZGVsIHNob3J0aGFuZC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSB3aXRoIHNlbGVjdGVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzdGF0aWMgc2VsZWN0KHNlbGVjdCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gKi8gKHRoaXMucXVlcnkoKS5zZWxlY3Qoc2VsZWN0KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdHMgZXh0cmEuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdIHwgc3RyaW5nPiB8IHN0cmluZyB8IHN0cmluZ1tdfSBzZWxlY3QgLSBFeHRyYSBhdHRyaWJ1dGVzIHRvIGxvYWQgaW4gYWRkaXRpb24gdG8gdGhlIGRlZmF1bHRzLCBrZXllZCBieSBtb2RlbCBuYW1lIG9yIHJvb3QtbW9kZWwgc2hvcnRoYW5kLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IHdpdGggZXh0cmEgc2VsZWN0ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIHN0YXRpYyBzZWxlY3RzRXh0cmEoc2VsZWN0KSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAodGhpcy5xdWVyeSgpLnNlbGVjdHNFeHRyYShzZWxlY3QpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmlyc3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBGaXJzdCBtb2RlbCBvciBudWxsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpcnN0KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmlyc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGFzdC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPiB8IG51bGw+fSAtIExhc3QgbW9kZWwgb3IgbnVsbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsYXN0KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkubGFzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG9yIGluaXRpYWxpemUgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIEF0dHJpYnV0ZSBtYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIEV4aXN0aW5nIG9yIGluaXRpYWxpemVkIG1vZGVsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRPckluaXRpYWxpemVCeShjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgY3JlYXRlIGJ5LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBBdHRyaWJ1dGUgbWF0Y2ggY29uZGl0aW9ucy5cbiAgICogQHBhcmFtIHsobW9kZWw6IEluc3RhbmNlVHlwZTxUPikgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWR9IFtjYWxsYmFja10gLSBPcHRpb25hbCBjYWxsYmFjayBiZWZvcmUgc2F2ZSB3aGVuIGNyZWF0ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRXhpc3Rpbmcgb3IgbmV3bHkgY3JlYXRlZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kT3JDcmVhdGVCeShjb25kaXRpb25zLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZE9yQ3JlYXRlQnkoY29uZGl0aW9ucywgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzXG4gICAqIEB0aGlzIHtNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDcmVhdGVBdHRyaWJ1dGVzRm9yPEluc3RhbmNlVHlwZTxNb2RlbENsYXNzPj59IFthdHRyaWJ1dGVzXSAtIEluaXRpYWwgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+Pn0gLSBQZXJzaXN0ZWQgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY3JlYXRlKGF0dHJpYnV0ZXMpIHtcbiAgICBjb25zdCByZWNlaXZlciA9IC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHRoaXMpXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogRnJvbnRlbmRNb2RlbENyZWF0ZUF0dHJpYnV0ZXNGb3I8SW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+PikgPT4gSW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+fSAqLyAocmVjZWl2ZXIpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcyhhdHRyaWJ1dGVzKVxuXG4gICAgYXdhaXQgbW9kZWwuc2F2ZSgpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2VydCBmaW5kIGJ5IGNvbmRpdGlvbnMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gZmluZEJ5IGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFzc2VydEZpbmRCeUNvbmRpdGlvbnMoY29uZGl0aW9ucykge1xuICAgIGFzc2VydEZpbmRCeUNvbmRpdGlvbnNTaGFwZShjb25kaXRpb25zKVxuXG4gICAgT2JqZWN0LmtleXMoY29uZGl0aW9ucykuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgICBhc3NlcnREZWZpbmVkRmluZEJ5Q29uZGl0aW9uVmFsdWUoY29uZGl0aW9uc1trZXldLCBrZXkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hdGNoZXMgZmluZCBieSBjb25kaXRpb25zLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIENhbmRpZGF0ZSBtb2RlbC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBNYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBtb2RlbCBtYXRjaGVzIGFsbCBjb25kaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIG1hdGNoZXNGaW5kQnlDb25kaXRpb25zKG1vZGVsLCBjb25kaXRpb25zKSB7XG4gICAgY29uc3QgbW9kZWxBdHRyaWJ1dGVzID0gbW9kZWwuYXR0cmlidXRlcygpXG5cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhjb25kaXRpb25zKSkge1xuICAgICAgY29uc3QgZXhwZWN0ZWRWYWx1ZSA9IGNvbmRpdGlvbnNba2V5XVxuICAgICAgY29uc3QgYWN0dWFsVmFsdWUgPSBtb2RlbEF0dHJpYnV0ZXNba2V5XVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShleHBlY3RlZFZhbHVlKSkge1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhY3R1YWxWYWx1ZSkpIHtcbiAgICAgICAgICBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKCFleHBlY3RlZFZhbHVlLnNvbWUoKGVudHJ5KSA9PiB0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZW50cnkpKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKCF0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgY29uZGl0aW9uIHZhbHVlIG1hdGNoZXMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFjdHVhbFZhbHVlIC0gQWN0dWFsIG1vZGVsIHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBleHBlY3RlZFZhbHVlIC0gRXhwZWN0ZWQgZmluZCBjb25kaXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWVzIG1hdGNoLlxuICAgKi9cbiAgc3RhdGljIGZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkge1xuICAgIGlmIChleHBlY3RlZFZhbHVlID09PSBudWxsKSB7XG4gICAgICByZXR1cm4gYWN0dWFsVmFsdWUgPT09IG51bGxcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShleHBlY3RlZFZhbHVlKSkge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGFjdHVhbFZhbHVlKSkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgaWYgKGFjdHVhbFZhbHVlLmxlbmd0aCAhPT0gZXhwZWN0ZWRWYWx1ZS5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBleHBlY3RlZFZhbHVlLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgICBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlW2luZGV4XSwgZXhwZWN0ZWRWYWx1ZVtpbmRleF0pKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBpZiAoZXhwZWN0ZWRWYWx1ZSAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgaWYgKCFhY3R1YWxWYWx1ZSB8fCB0eXBlb2YgYWN0dWFsVmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShhY3R1YWxWYWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFjdHVhbE9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoYWN0dWFsVmFsdWUpXG4gICAgICBjb25zdCBleHBlY3RlZE9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZXhwZWN0ZWRWYWx1ZSlcbiAgICAgIGNvbnN0IGFjdHVhbEtleXMgPSBPYmplY3Qua2V5cyhhY3R1YWxPYmplY3QpXG4gICAgICBjb25zdCBleHBlY3RlZEtleXMgPSBPYmplY3Qua2V5cyhleHBlY3RlZE9iamVjdClcblxuICAgICAgaWYgKGFjdHVhbEtleXMubGVuZ3RoICE9PSBleHBlY3RlZEtleXMubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBleHBlY3RlZEtleXMpIHtcbiAgICAgICAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoYWN0dWFsT2JqZWN0LCBrZXkpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbE9iamVjdFtrZXldLCBleHBlY3RlZE9iamVjdFtrZXldKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgaWYgKGFjdHVhbFZhbHVlID09PSBleHBlY3RlZFZhbHVlKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmZpbmRCeVByaW1pdGl2ZVZhbHVlc01hdGNoKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieSBwcmltaXRpdmUgdmFsdWVzIG1hdGNoLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhY3R1YWxWYWx1ZSAtIEFjdHVhbCBtb2RlbCB2YWx1ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXhwZWN0ZWRWYWx1ZSAtIEV4cGVjdGVkIGZpbmQgY29uZGl0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHByaW1pdGl2ZSB2YWx1ZXMgbWF0Y2ggYWZ0ZXIgc2FmZSBjb2VyY2lvbi5cbiAgICovXG4gIHN0YXRpYyBmaW5kQnlQcmltaXRpdmVWYWx1ZXNNYXRjaChhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkge1xuICAgIGlmIChhY3R1YWxWYWx1ZSBpbnN0YW5jZW9mIERhdGUgJiYgdHlwZW9mIGV4cGVjdGVkVmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFeHBlY3RlZFZhbHVlID0gbm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlKGV4cGVjdGVkVmFsdWUsIHt0aW1lWm9uZTogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKCl9KVxuXG4gICAgICBpZiAobm9ybWFsaXplZEV4cGVjdGVkVmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAgIHJldHVybiBhY3R1YWxWYWx1ZS50b0lTT1N0cmluZygpID09PSBub3JtYWxpemVkRXhwZWN0ZWRWYWx1ZS50b0lTT1N0cmluZygpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhY3R1YWxWYWx1ZS50b0lTT1N0cmluZygpID09PSBleHBlY3RlZFZhbHVlXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhY3R1YWxWYWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiBleHBlY3RlZFZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgcmV0dXJuIGFjdHVhbFZhbHVlID09PSBleHBlY3RlZFZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICB9XG5cbiAgICBpZiAoYWN0dWFsVmFsdWUgaW5zdGFuY2VvZiBEYXRlICYmIGV4cGVjdGVkVmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICByZXR1cm4gYWN0dWFsVmFsdWUudG9JU09TdHJpbmcoKSA9PT0gZXhwZWN0ZWRWYWx1ZS50b0lTT1N0cmluZygpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhY3R1YWxWYWx1ZSA9PT0gXCJudW1iZXJcIiAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIHRoaXMuZmluZEJ5TnVtZXJpY1N0cmluZ01hdGNoZXNOdW1iZXIoZXhwZWN0ZWRWYWx1ZSwgYWN0dWFsVmFsdWUpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhY3R1YWxWYWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJudW1iZXJcIikge1xuICAgICAgcmV0dXJuIHRoaXMuZmluZEJ5TnVtZXJpY1N0cmluZ01hdGNoZXNOdW1iZXIoYWN0dWFsVmFsdWUsIGV4cGVjdGVkVmFsdWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5IG51bWVyaWMgc3RyaW5nIG1hdGNoZXMgbnVtYmVyLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gbnVtZXJpY1N0cmluZyAtIE51bWVyaWMgc3RyaW5nIHZhbHVlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZXhwZWN0ZWROdW1iZXIgLSBOdW1iZXIgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWVzIHJlcHJlc2VudCB0aGUgc2FtZSBudW1iZXIuXG4gICAqL1xuICBzdGF0aWMgZmluZEJ5TnVtZXJpY1N0cmluZ01hdGNoZXNOdW1iZXIobnVtZXJpY1N0cmluZywgZXhwZWN0ZWROdW1iZXIpIHtcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShleHBlY3RlZE51bWJlcikpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGlmICghL14tP1xcZCsoPzpcXC5cXGQrKT8kLy50ZXN0KG51bWVyaWNTdHJpbmcpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gTnVtYmVyKG51bWVyaWNTdHJpbmcpID09PSBleHBlY3RlZE51bWJlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlLlxuICAgKiBAcGFyYW0ge1VwZGF0ZUF0dHJpYnV0ZXN9IFtuZXdBdHRyaWJ1dGVzXSAtIE5ldyB2YWx1ZXMgdG8gYXNzaWduIGJlZm9yZSB1cGRhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHRoaXM+fSAtIFVwZGF0ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyB1cGRhdGUobmV3QXR0cmlidXRlcykge1xuICAgIGlmIChuZXdBdHRyaWJ1dGVzKSB0aGlzLmFzc2lnbkF0dHJpYnV0ZXMobmV3QXR0cmlidXRlcylcblxuICAgIHJldHVybiAvKiogQHR5cGUge3RoaXN9ICovIChhd2FpdCB0aGlzLnNhdmUoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXR0YWNobWVudElucHV0IC0gQXR0YWNobWVudCBpbnB1dCBvciBuYW1lZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYXR0YWNoZWQuXG4gICAqL1xuICBhc3luYyBhdHRhY2goYXR0YWNobWVudElucHV0KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9ucyA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb25zKClcbiAgICBjb25zdCBhdHRhY2htZW50TmFtZXMgPSBPYmplY3Qua2V5cyhhdHRhY2htZW50RGVmaW5pdGlvbnMpXG4gICAgbGV0IGF0dGFjaG1lbnROYW1lID0gYXR0YWNobWVudE5hbWVzWzBdXG4gICAgbGV0IGFjdHVhbEF0dGFjaG1lbnRJbnB1dCA9IGF0dGFjaG1lbnRJbnB1dFxuXG4gICAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChhdHRhY2htZW50SW5wdXQpKSB7XG4gICAgICBpZiAoXCJmaWxlXCIgaW4gYXR0YWNobWVudElucHV0ICYmIGF0dGFjaG1lbnREZWZpbml0aW9ucy5maWxlKSB7XG4gICAgICAgIGF0dGFjaG1lbnROYW1lID0gXCJmaWxlXCJcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBjYW5kaWRhdGVOYW1lIG9mIGF0dGFjaG1lbnROYW1lcykge1xuICAgICAgICBpZiAoY2FuZGlkYXRlTmFtZSBpbiBhdHRhY2htZW50SW5wdXQpIHtcbiAgICAgICAgICBhdHRhY2htZW50TmFtZSA9IGNhbmRpZGF0ZU5hbWVcbiAgICAgICAgICBhY3R1YWxBdHRhY2htZW50SW5wdXQgPSBhdHRhY2htZW50SW5wdXRbY2FuZGlkYXRlTmFtZV1cbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFhdHRhY2htZW50TmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBhdHRhY2htZW50IGRlZmluaXRpb25zIG9uICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKS5hdHRhY2goYWN0dWFsQXR0YWNobWVudElucHV0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2F2ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dGhpcz59IC0gU2F2ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBzYXZlKCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBpc05ldyA9IHRoaXMuaXNOZXdSZWNvcmQoKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IHByZXZpb3VzSWRlbnRpdHkgPSBpc05ldyA/IG51bGwgOiB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgY29uc3QgbGlzdGVuZXJJZGVudGl0eUJlZm9yZVNhdmUgPSBpc05ld1xuICAgICAgJiYgQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KVxuICAgICAgJiYgcHJpbWFyeUtleS5ldmVyeSgoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgICBjb25zdCB2YWx1ZSA9IHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cblxuICAgICAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIlxuICAgICAgfSlcbiAgICAgID8gdGhpcy5wcmltYXJ5S2V5VmFsdWUoKVxuICAgICAgOiBwcmV2aW91c0lkZW50aXR5XG4gICAgY29uc3QgY29tbWFuZFR5cGUgPSBpc05ldyA/IFwiY3JlYXRlXCIgOiBcInVwZGF0ZVwiXG4gICAgLyoqXG4gICAgICogUGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBhdHRyaWJ1dGVzOiB0aGlzLl9jaGFuZ2VkQXR0cmlidXRlc0ZvclNhdmUoKVxuICAgIH1cblxuICAgIGlmICghaXNOZXcpIHtcbiAgICAgIHBheWxvYWQuaWQgPSB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgfVxuXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMuX2J1aWxkTmVzdGVkQXR0cmlidXRlc1BheWxvYWQoKVxuXG4gICAgaWYgKG5lc3RlZEF0dHJpYnV0ZXMgJiYgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykubGVuZ3RoID4gMCkge1xuICAgICAgcGF5bG9hZC5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuICAgIH1cblxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gYXdhaXQgdGhpcy5fYnVpbGRBdHRhY2htZW50c1BheWxvYWQoKVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwKSB7XG4gICAgICBwYXlsb2FkLmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICB9XG5cbiAgICBpZiAoc2hvdWxkUXVldWVGcm9udGVuZE1vZGVsT3BlcmF0aW9uT2ZmbGluZShNb2RlbENsYXNzLCBjb21tYW5kVHlwZSkpIHtcbiAgICAgIGNvbnN0IG9mZmxpbmVBdHRyaWJ1dGVzID0gey4uLnBheWxvYWQuYXR0cmlidXRlc31cbiAgICAgIGxldCBjbGllbnRNdXRhdGlvbklkXG5cbiAgICAgIGlmIChpc05ldykge1xuICAgICAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgT2ZmbGluZSBjcmVhdGUgZm9yICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICAgIGNvbnN0IGN1cnJlbnRQcmltYXJ5S2V5ID0gdGhpcy5yZWFkQXR0cmlidXRlKHByaW1hcnlLZXkpXG5cbiAgICAgICAgaWYgKGN1cnJlbnRQcmltYXJ5S2V5ID09PSB1bmRlZmluZWQgfHwgY3VycmVudFByaW1hcnlLZXkgPT09IG51bGwpIHtcbiAgICAgICAgICBjbGllbnRNdXRhdGlvbklkID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5vZmZsaW5lU3luYz8uY2xpZW50TXV0YXRpb25JZFxuICAgICAgICAgICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jLmNsaWVudE11dGF0aW9uSWQoKVxuICAgICAgICAgICAgOiBmcm9udGVuZE1vZGVsT2ZmbGluZU11dGF0aW9uSWQoKVxuICAgICAgICAgIHRoaXMuc2V0QXR0cmlidXRlKHByaW1hcnlLZXksIGNsaWVudE11dGF0aW9uSWQpXG4gICAgICAgICAgb2ZmbGluZUF0dHJpYnV0ZXNbcHJpbWFyeUtleV0gPSBjbGllbnRNdXRhdGlvbklkXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGBPZmZsaW5lIHVwZGF0ZSBmb3IgJHtNb2RlbENsYXNzLm5hbWV9YClcblxuICAgICAgICBvZmZsaW5lQXR0cmlidXRlc1twcmltYXJ5S2V5XSA9IHBheWxvYWQuaWRcbiAgICAgIH1cblxuICAgICAgaWYgKHBheWxvYWQubmVzdGVkQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkIHx8IHBheWxvYWQuYXR0YWNobWVudHMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE9mZmxpbmUgc3luYyBmb3IgJHtNb2RlbENsYXNzLm5hbWV9IGRvZXMgbm90IHN1cHBvcnQgbmVzdGVkIGF0dHJpYnV0ZXMgb3IgYXR0YWNobWVudHMgeWV0YClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgcXVldWVGcm9udGVuZE1vZGVsTXV0YXRpb25PZmZsaW5lKHtcbiAgICAgICAgYXR0cmlidXRlczogb2ZmbGluZUF0dHJpYnV0ZXMsXG4gICAgICAgIGNsaWVudE11dGF0aW9uSWQsXG4gICAgICAgIE1vZGVsQ2xhc3MsXG4gICAgICAgIG9wZXJhdGlvbjogY29tbWFuZFR5cGVcbiAgICAgIH0pXG4gICAgICB0aGlzLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuICAgICAgdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXModGhpcy5hdHRyaWJ1dGVzKCkpXG4gICAgICB0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgICB0aGlzLl9jbGVhclBlbmRpbmdBdHRhY2htZW50cygpXG5cbiAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgY29uc3QgcmVtb3ZlVGVtcG9yYXJ5TGlzdGVuZXJBbGlhc2VzID0gcHJldmlvdXNJZGVudGl0eSA9PT0gbnVsbFxuICAgICAgPyAoKSA9PiB7fVxuICAgICAgOiBhbGlhc0Zyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyhNb2RlbENsYXNzLCB0aGlzLCBwcmV2aW91c0lkZW50aXR5LCB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIGxldCByZXNwb25zZVxuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3BvbnNlID0gYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChjb21tYW5kVHlwZSwgcGF5bG9hZClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmVtb3ZlVGVtcG9yYXJ5TGlzdGVuZXJBbGlhc2VzKClcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmVtb3ZlVGVtcG9yYXJ5TGlzdGVuZXJBbGlhc2VzKClcblxuICAgIGNvbnN0IG1vZGVsRGF0YSA9IE1vZGVsQ2xhc3MubW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuXG4gICAgdGhpcy5hc3NpZ25BdHRyaWJ1dGVzKG1vZGVsRGF0YS5hdHRyaWJ1dGVzKVxuICAgIHRoaXMuX2F0dGFjaG1lbnRPd25lciA9IG1vZGVsRGF0YS5hdHRhY2htZW50T3duZXJcbiAgICB0aGlzLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuXG4gICAgaWYgKGxpc3RlbmVySWRlbnRpdHlCZWZvcmVTYXZlICE9PSBudWxsKSB7XG4gICAgICByZWtleUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyhNb2RlbENsYXNzLCB0aGlzLCBsaXN0ZW5lcklkZW50aXR5QmVmb3JlU2F2ZSwgdGhpcy5wcmltYXJ5S2V5VmFsdWUoKSlcbiAgICB9XG5cbiAgICB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzID0gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyh0aGlzLmF0dHJpYnV0ZXMoKSlcbiAgICB0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgdGhpcy5fY2xlYXJQZW5kaW5nQXR0YWNobWVudHMoKVxuXG4gICAgdGhpcy5fcmVjb25jaWxlTmVzdGVkQXR0cmlidXRlc0Zyb21SZXNwb25zZShyZXNwb25zZSlcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc3Vic2V0IG9mIGBfYXR0cmlidXRlc2Agd2hvc2UgdmFsdWUgaGFzIGRpdmVyZ2VkIGZyb21cbiAgICogYF9wZXJzaXN0ZWRBdHRyaWJ1dGVzYC4gVXNlZCBieSBgc2F2ZSgpYCBzbyB0aGUgc2VydmVyIHJlY2VpdmVzIG9ubHkgdGhlXG4gICAqIGZpZWxkcyB0aGUgY2FsbGVyIGFjdHVhbGx5IGNoYW5nZWQg4oCUIGF2b2lkaW5nIHN0cmljdCBwZXJtaXQgcmVqZWN0aW9ucyBvblxuICAgKiBmcmFtZXdvcmstbWFuYWdlZCBmaWVsZHMgbGlrZSBgaWRgLCBgY3JlYXRlZEF0YCwgYHVwZGF0ZWRBdGAsIG9yIG93bmVyXG4gICAqIGZvcmVpZ24ga2V5cyB0aGF0IHRoZSByZXNvdXJjZSBuZXZlciBsaXN0cyBpbiBgcGVybWl0dGVkUGFyYW1zYC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59IC0gQ2hhbmdlZCBhdHRyaWJ1dGVzIGhhc2guXG4gICAqL1xuICBfY2hhbmdlZEF0dHJpYnV0ZXNGb3JTYXZlKCkge1xuICAgIC8qKlxuICAgICAqIENoYW5nZWQgYXR0cmlidXRlcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi9cbiAgICBjb25zdCBjaGFuZ2VkQXR0cmlidXRlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCBbcHJldmlvdXNWYWx1ZSwgY3VycmVudFZhbHVlXV0gb2YgT2JqZWN0LmVudHJpZXModGhpcy5jaGFuZ2VzKCkpKSB7XG4gICAgICBpZiAodGhpcy5pc05ld1JlY29yZCgpICYmIHByZXZpb3VzVmFsdWUgPT09IHVuZGVmaW5lZCAmJiBjdXJyZW50VmFsdWUgPT09IG51bGwpIGNvbnRpbnVlXG5cbiAgICAgIGNoYW5nZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gY3VycmVudFZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYW5nZWRBdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogTWFya3MgdGhlIGN1cnJlbnQgdmFsdWUgZm9yIGFuIGF0dHJpYnV0ZSBhcyBhbHJlYWR5IHBlcnNpc3RlZCBzbyB0aGUgbmV4dFxuICAgKiBzYXZlIGRvZXMgbm90IHNlbmQgaXQgdW5sZXNzIHRoZSBjYWxsZXIgY2hhbmdlcyBpdCBhZ2Fpbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgdG8gbWFyayB1bmNoYW5nZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgbWFya0F0dHJpYnV0ZVVuY2hhbmdlZChhdHRyaWJ1dGVOYW1lKSB7XG4gICAgdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMoe3ZhbHVlOiB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdfSkudmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlc3Ryb3kuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZGVzdHJveWVkIG9uIGJhY2tlbmQuXG4gICAqL1xuICBhc3luYyBkZXN0cm95KCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBpZCA9IHRoaXMuaXNOZXdSZWNvcmQoKSA/IHRoaXMucHJpbWFyeUtleVZhbHVlKCkgOiB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG5cbiAgICBpZiAoc2hvdWxkUXVldWVGcm9udGVuZE1vZGVsT3BlcmF0aW9uT2ZmbGluZShNb2RlbENsYXNzLCBcImRlc3Ryb3lcIikpIHtcbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGBPZmZsaW5lIGRlc3Ryb3kgZm9yICR7TW9kZWxDbGFzcy5uYW1lfWApXG5cbiAgICAgIGF3YWl0IHF1ZXVlRnJvbnRlbmRNb2RlbE11dGF0aW9uT2ZmbGluZSh7XG4gICAgICAgIGF0dHJpYnV0ZXM6IHtbcHJpbWFyeUtleV06IGlkfSxcbiAgICAgICAgTW9kZWxDbGFzcyxcbiAgICAgICAgb3BlcmF0aW9uOiBcImRlc3Ryb3lcIlxuICAgICAgfSlcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcImRlc3Ryb3lcIiwge1xuICAgICAgaWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgYXR0YWNobWVudCBwYXlsb2FkIHF1ZXVlZCBvbiB0aGlzIG1vZGVsIGZvciB0aGUgbmV4dCBzYXZlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBBdHRhY2htZW50IHBheWxvYWQga2V5ZWQgYnkgYXR0YWNobWVudCBuYW1lLlxuICAgKi9cbiAgYXN5bmMgX2J1aWxkQXR0YWNobWVudHNQYXlsb2FkKCkge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7fVxuXG4gICAgZm9yIChjb25zdCBhdHRhY2htZW50TmFtZSBvZiBPYmplY3Qua2V5cyh0aGlzLl9hdHRhY2htZW50cykpIHtcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnRQYXlsb2FkID0gYXdhaXQgdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdLnBlbmRpbmdBdHRhY2htZW50c1BheWxvYWQoKVxuXG4gICAgICBpZiAoYXR0YWNobWVudFBheWxvYWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBwYXlsb2FkW2F0dGFjaG1lbnROYW1lXSA9IGF0dGFjaG1lbnRQYXlsb2FkXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBheWxvYWRcbiAgfVxuXG4gIC8qKiBDbGVhcnMgcXVldWVkIGF0dGFjaG1lbnQgaW5wdXRzIGFmdGVyIGEgc3VjY2Vzc2Z1bCBzYXZlLiAqL1xuICBfY2xlYXJQZW5kaW5nQXR0YWNobWVudHMoKSB7XG4gICAgZm9yIChjb25zdCBhdHRhY2htZW50TmFtZSBvZiBPYmplY3Qua2V5cyh0aGlzLl9hdHRhY2htZW50cykpIHtcbiAgICAgIHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXS5jbGVhclBlbmRpbmdBdHRhY2htZW50cygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFdhbGtzIHJlbGF0aW9uc2hpcHMgZGVjbGFyZWQgaW4gdGhpcyByZXNvdXJjZSdzIGBuZXN0ZWRBdHRyaWJ1dGVzYCBjb25maWdcbiAgICogYW5kIGJ1aWxkcyB0aGUgcGVyLXJlbGF0aW9uc2hpcCBwYXlsb2FkIG9mIGRpcnR5IGNoaWxkcmVuIGZvciBhIHBhcmVudCBzYXZlLlxuICAgKlxuICAgKiBJbmNsdWRlZCBjaGlsZHJlbjpcbiAgICogICAtIG5ldyByZWNvcmRzIChpc05ld1JlY29yZCgpKSDihpIgY3JlYXRlIGVudHJ5IHdpdGggYXR0cmlidXRlc1xuICAgKiAgIC0gcmVjb3JkcyBtYXJrZWQgZm9yIGRlc3RydWN0aW9uIChtYXJrZWRGb3JEZXN0cnVjdGlvbigpKSDihpIgZGVzdHJveSBlbnRyeVxuICAgKiAgIC0gcmVjb3JkcyB3aXRoIGNoYW5nZWQgYXR0cmlidXRlcyAoaXNDaGFuZ2VkKCkpIOKGkiB1cGRhdGUgZW50cnkgd2l0aCBhdHRyaWJ1dGVzXG4gICAqICAgLSByZWNvcmRzIHdpdGggZGlydHkgZGVzY2VuZGFudHMgaW4gdGhlaXIgb3duIG5lc3RlZEF0dHJpYnV0ZXMg4oaSIHJlY3Vyc2VcbiAgICpcbiAgICogTG9hZGVkIGJ1dCB1bnRvdWNoZWQgcmVjb3JkcyBhcmUgb21pdHRlZCBzbyBuZXN0ZWQgc2F2ZSBwcmVzZXJ2ZXMgUmFpbHMtc3R5bGVcbiAgICogXCJjaGlsZHJlbiBub3QgcmVmZXJlbmNlZCBpbiBwYXlsb2FkIGFyZSBsZWZ0IGFsb25lXCIgc2VtYW50aWNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pj59IC0gUGVyLXJlbGF0aW9uc2hpcCBsaXN0IG9mIG5lc3RlZC1hdHRyaWJ1dGUgZW50cmllcy5cbiAgICovXG4gIGFzeW5jIF9idWlsZE5lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkKCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKVxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXNDb25maWcgPSByZXNvdXJjZUNvbmZpZz8ubmVzdGVkQXR0cmlidXRlc1xuXG4gICAgaWYgKCFuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnKSByZXR1cm4ge31cblxuICAgIC8qKlxuICAgICAqIFBheWxvYWQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+fSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7fVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXNDb25maWcpKSB7XG4gICAgICAvKiogQHR5cGUge0FycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgICBjb25zdCBlbnRyaWVzID0gW11cbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuX3JlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgaWYgKHJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwICYmIEFycmF5LmlzQXJyYXkocmVsYXRpb25zaGlwLl9sb2FkZWRWYWx1ZSkpIHtcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiByZWxhdGlvbnNoaXAuX2xvYWRlZFZhbHVlKSB7XG4gICAgICAgICAgY29uc3QgY2hpbGRFbnRyeSA9IGF3YWl0IGNoaWxkLl9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlGb3JQYXJlbnRTYXZlKClcblxuICAgICAgICAgIGlmIChjaGlsZEVudHJ5KSBlbnRyaWVzLnB1c2goY2hpbGRFbnRyeSlcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChyZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXAgJiYgcmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSB7XG4gICAgICAgIGNvbnN0IGNoaWxkID0gcmVsYXRpb25zaGlwLmxvYWRlZCgpXG5cbiAgICAgICAgaWYgKGNoaWxkIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEJhc2UpIHtcbiAgICAgICAgICBjb25zdCBjaGlsZEVudHJ5ID0gYXdhaXQgY2hpbGQuX25lc3RlZEF0dHJpYnV0ZXNFbnRyeUZvclBhcmVudFNhdmUoKVxuXG4gICAgICAgICAgaWYgKGNoaWxkRW50cnkpIGVudHJpZXMucHVzaChjaGlsZEVudHJ5KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwodGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXMsIHJlbGF0aW9uc2hpcE5hbWUpKSB7XG4gICAgICAgIGVudHJpZXMucHVzaChcbiAgICAgICAgICAuLi5hd2FpdCB0aGlzLl9uZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKFxuICAgICAgICAgICAgTW9kZWxDbGFzcyxcbiAgICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgICB0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlc1tyZWxhdGlvbnNoaXBOYW1lXVxuICAgICAgICAgIClcbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICBpZiAoZW50cmllcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHBheWxvYWRbcmVsYXRpb25zaGlwTmFtZV0gPSBlbnRyaWVzXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBheWxvYWRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIHBheWxvYWQgZW50cnkgZm9yIHRoaXMgY2hpbGQgd2hlbiB3YWxrZWQgYnkgYSBwYXJlbnQnc1xuICAgKiBgX2J1aWxkTmVzdGVkQXR0cmlidXRlc1BheWxvYWRgLiBSZXR1cm5zIGBudWxsYCB3aGVuIHRoZSBjaGlsZCBoYXMgbm9cbiAgICogZGlydHkgc3RhdGUgYW5kIG5vIGRpcnR5IGRlc2NlbmRhbnRzLCBzbyB0aGUgcGFyZW50IGNhbiBvbWl0IGl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsPn0gLSBOZXN0ZWQtYXR0cmlidXRlIGVudHJ5IG9yIG51bGwgaWYgY2xlYW4uXG4gICAqL1xuICBhc3luYyBfbmVzdGVkQXR0cmlidXRlc0VudHJ5Rm9yUGFyZW50U2F2ZSgpIHtcbiAgICBpZiAodGhpcy5tYXJrZWRGb3JEZXN0cnVjdGlvbigpKSB7XG4gICAgICBpZiAodGhpcy5pc05ld1JlY29yZCgpKSByZXR1cm4gbnVsbFxuICAgICAgcmV0dXJuIHtpZDogdGhpcy5wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKSwgX2Rlc3Ryb3k6IHRydWV9XG4gICAgfVxuXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMuX2J1aWxkTmVzdGVkQXR0cmlidXRlc1BheWxvYWQoKVxuICAgIGNvbnN0IGhhc05lc3RlZERpcnR5ID0gT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykubGVuZ3RoID4gMFxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gYXdhaXQgdGhpcy5fYnVpbGRBdHRhY2htZW50c1BheWxvYWQoKVxuICAgIGNvbnN0IGhhc0F0dGFjaG1lbnRzID0gT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDBcblxuICAgIGlmICh0aGlzLmlzTmV3UmVjb3JkKCkpIHtcbiAgICAgIC8qKlxuICAgICAgICogRW50cnkuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3QgZW50cnkgPSB7fVxuICAgICAgY29uc3QgYXR0cmlidXRlcyA9IHRoaXMuX2NoYW5nZWRBdHRyaWJ1dGVzRm9yU2F2ZSgpXG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSBlbnRyeS5hdHRyaWJ1dGVzID0gYXR0cmlidXRlc1xuICAgICAgaWYgKGhhc0F0dGFjaG1lbnRzKSBlbnRyeS5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgICBpZiAoaGFzTmVzdGVkRGlydHkpIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgPSBuZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICAgIHJldHVybiBlbnRyeVxuICAgIH1cblxuICAgIGlmICghdGhpcy5pc0NoYW5nZWQoKSAmJiAhaGFzTmVzdGVkRGlydHkgJiYgIWhhc0F0dGFjaG1lbnRzKSByZXR1cm4gbnVsbFxuXG4gICAgLyoqXG4gICAgICogRW50cnkuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBlbnRyeSA9IHtpZDogdGhpcy5wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKX1cblxuICAgIGlmICh0aGlzLmlzQ2hhbmdlZCgpKSBlbnRyeS5hdHRyaWJ1dGVzID0gdGhpcy5fY2hhbmdlZEF0dHJpYnV0ZXNGb3JTYXZlKClcbiAgICBpZiAoaGFzQXR0YWNobWVudHMpIGVudHJ5LmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICBpZiAoaGFzTmVzdGVkRGlydHkpIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgPSBuZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICByZXR1cm4gZW50cnlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgbmVzdGVkIGVudHJpZXMgZnJvbSBhIFJhaWxzLXN0eWxlIHN1Ym1pdHRlZCBgKkF0dHJpYnV0ZXNgIHZhbHVlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIFBhcmVudCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBOZXN0ZWQgcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU3VibWl0dGVkIG5lc3RlZCBhdHRyaWJ1dGVzIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pn0gTmVzdGVkIGVudHJpZXMgZm9yIHRoZSB0cmFuc3BvcnQgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIF9uZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKE1vZGVsQ2xhc3MsIHJlbGF0aW9uc2hpcE5hbWUsIHZhbHVlKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwRGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKVxuICAgIGNvbnN0IFRhcmdldE1vZGVsQ2xhc3MgPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcE1vZGVsQ2xhc3MocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmICghcmVsYXRpb25zaGlwRGVmaW5pdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG5lc3RlZCByZWxhdGlvbnNoaXA6ICR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFUYXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyBjb25maWd1cmVkIGZvciAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcFR5cGVJc0NvbGxlY3Rpb24ocmVsYXRpb25zaGlwRGVmaW5pdGlvbi50eXBlKSkge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9QXR0cmlidXRlcyBtdXN0IGJlIGFuIGFycmF5YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICB2YWx1ZS5tYXAoYXN5bmMgKGVudHJ5KSA9PiBhd2FpdCB0aGlzLl9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoVGFyZ2V0TW9kZWxDbGFzcywgZW50cnkpKVxuICAgICAgKVxuICAgIH1cblxuICAgIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gW11cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1BdHRyaWJ1dGVzIG11c3QgYmUgYW4gb2JqZWN0YClcbiAgICB9XG5cbiAgICByZXR1cm4gW2F3YWl0IHRoaXMuX25lc3RlZEF0dHJpYnV0ZXNFbnRyeVBheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShUYXJnZXRNb2RlbENsYXNzLCB2YWx1ZSldXG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgb25lIHN1Ym1pdHRlZCBSYWlscy1zdHlsZSBuZXN0ZWQgYXR0cmlidXRlcyBvYmplY3QgaW50byB0cmFuc3BvcnQgcGF5bG9hZCBzaGFwZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBOZXN0ZWQgY2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHN1Ym1pdHRlZEVudHJ5IC0gU3VibWl0dGVkIG5lc3RlZCBhdHRyaWJ1dGVzIGVudHJ5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBUcmFuc3BvcnQgbmVzdGVkLWF0dHJpYnV0ZXMgZW50cnkuXG4gICAqL1xuICBhc3luYyBfbmVzdGVkQXR0cmlidXRlc0VudHJ5UGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKE1vZGVsQ2xhc3MsIHN1Ym1pdHRlZEVudHJ5KSB7XG4gICAgaWYgKCFmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzUGxhaW5PYmplY3Qoc3VibWl0dGVkRW50cnkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7TW9kZWxDbGFzcy5uYW1lfSBuZXN0ZWQgYXR0cmlidXRlcyBlbnRyaWVzIG11c3QgYmUgb2JqZWN0c2ApXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgZW50cnkgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+fSAqL1xuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHN1Ym1pdHRlZEVudHJ5KSkge1xuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiaWRcIiB8fCBhdHRyaWJ1dGVOYW1lID09PSBcIl9kZXN0cm95XCIpIHtcbiAgICAgICAgZW50cnlbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lID0gTW9kZWxDbGFzcy5uZXN0ZWRBdHRyaWJ1dGVzUmVsYXRpb25zaGlwTmFtZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgICBpZiAobmVzdGVkUmVsYXRpb25zaGlwTmFtZSkge1xuICAgICAgICBuZXN0ZWRBdHRyaWJ1dGVzW25lc3RlZFJlbGF0aW9uc2hpcE5hbWVdID0gYXdhaXQgdGhpcy5fbmVzdGVkQXR0cmlidXRlc1BheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShcbiAgICAgICAgICBNb2RlbENsYXNzLFxuICAgICAgICAgIG5lc3RlZFJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgdmFsdWVcbiAgICAgICAgKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbihhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgICBhdHRhY2htZW50c1thdHRyaWJ1dGVOYW1lXSA9IGF3YWl0IHRoaXMuX2F0dGFjaG1lbnRQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoTW9kZWxDbGFzcywgYXR0cmlidXRlTmFtZSwgdmFsdWUpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSBlbnRyeS5hdHRyaWJ1dGVzID0gYXR0cmlidXRlc1xuICAgIGlmIChPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkgZW50cnkuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgIGlmIChPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuXG4gICAgcmV0dXJuIGVudHJ5XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIHN1Ym1pdHRlZCBhdHRhY2htZW50IHZhbHVlIGZvciB0cmFuc3BvcnQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gTW9kZWwgY2xhc3Mgb3duaW5nIHRoZSBhdHRhY2htZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU3VibWl0dGVkIGF0dGFjaG1lbnQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdPn0gTm9ybWFsaXplZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBfYXR0YWNobWVudFBheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShNb2RlbENsYXNzLCBhdHRhY2htZW50TmFtZSwgdmFsdWUpIHtcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24oYXR0YWNobWVudE5hbWUpXG5cbiAgICBpZiAoYXR0YWNobWVudERlZmluaXRpb24/LnR5cGUgPT09IFwiaGFzTWFueVwiKSB7XG4gICAgICBjb25zdCB2YWx1ZXMgPSBBcnJheS5pc0FycmF5KHZhbHVlKSA/IHZhbHVlIDogW3ZhbHVlXVxuXG4gICAgICByZXR1cm4gYXdhaXQgUHJvbWlzZS5hbGwodmFsdWVzLm1hcChhc3luYyAoZW50cnkpID0+IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGVudHJ5KSkpXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBjb25zdCBsYXN0VmFsdWUgPSB2YWx1ZVt2YWx1ZS5sZW5ndGggLSAxXVxuXG4gICAgICBpZiAobGFzdFZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke01vZGVsQ2xhc3MubmFtZX0jJHthdHRhY2htZW50TmFtZX0gYXR0YWNobWVudCBhcnJheSBjYW5ub3QgYmUgZW1wdHlgKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQobGFzdFZhbHVlKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBZnRlciBhIHBhcmVudCBzYXZlIHdpdGggYG5lc3RlZEF0dHJpYnV0ZXNgLCB0aGUgc2VydmVyIHJlc3BvbnNlIGluY2x1ZGVzXG4gICAqIHByZWxvYWRlZCB2ZXJzaW9ucyBvZiB0aGUgYWZmZWN0ZWQgcmVsYXRpb25zaGlwcy4gVGhpcyByZXBsYWNlcyB0aGUgbG9jYWxcbiAgICogYF9sb2FkZWRWYWx1ZWAgZm9yIGVhY2ggbmVzdGVkLXdyaXRhYmxlIHJlbGF0aW9uc2hpcCB3aXRoIHRoZSBzZXJ2ZXInc1xuICAgKiBhdXRob3JpdGF0aXZlIHNldCwgc28gZGVzdHJveWVkIGNoaWxkcmVuIGFyZSBkcm9wcGVkIGFuZCBuZXdseS1jcmVhdGVkXG4gICAqIGNoaWxkcmVuIGdldCB0aGVpciBzZXJ2ZXItYXNzaWduZWQgaWRzICsgcGVyc2lzdGVkIHN0YXRlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcmVzcG9uc2UgLSBDb21tYW5kIHJlc3BvbnNlIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3JlY29uY2lsZU5lc3RlZEF0dHJpYnV0ZXNGcm9tUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSBNb2RlbENsYXNzLnJlc291cmNlQ29uZmlnKClcbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnID0gcmVzb3VyY2VDb25maWc/Lm5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIGlmICghbmVzdGVkQXR0cmlidXRlc0NvbmZpZykgcmV0dXJuXG5cbiAgICBjb25zdCBtb2RlbERhdGEgPSBNb2RlbENsYXNzLm1vZGVsRGF0YUZyb21SZXNwb25zZShyZXNwb25zZSlcbiAgICBjb25zdCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzID0gbW9kZWxEYXRhLnByZWxvYWRlZFJlbGF0aW9uc2hpcHNcblxuICAgIC8qKlxuICAgICAqIFJlbGV2YW50IHByZWxvYWRzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcmVsZXZhbnRQcmVsb2FkcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlc0NvbmZpZykpIHtcbiAgICAgIGlmIChyZWxhdGlvbnNoaXBOYW1lIGluIHByZWxvYWRlZFJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgcmVsZXZhbnRQcmVsb2Fkc1tyZWxhdGlvbnNoaXBOYW1lXSA9IHByZWxvYWRlZFJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMocmVsZXZhbnRQcmVsb2FkcykubGVuZ3RoID4gMCkge1xuICAgICAgTW9kZWxDbGFzcy5hcHBseVByZWxvYWRlZFJlbGF0aW9uc2hpcHModGhpcywgcmVsZXZhbnRQcmVsb2FkcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBleGVjdXRlIGNvbW1hbmQuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENvbW1hbmRUeXBlfSBjb21tYW5kVHlwZSAtIENvbW1hbmQgdHlwZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBheWxvYWQgLSBDb21tYW5kIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUGFyc2VkIEpTT04gcmVzcG9uc2UuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZXhlY3V0ZUNvbW1hbmQoY29tbWFuZFR5cGUsIHBheWxvYWQpIHtcbiAgICBjb25zdCBjb21tYW5kTmFtZSA9IHRoaXMuY29tbWFuZE5hbWUoY29tbWFuZFR5cGUpXG4gICAgY29uc3QgdGltZVpvbmUgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKVxuICAgIGNvbnN0IHNlcmlhbGl6ZWRQYXlsb2FkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocGF5bG9hZCwge3RpbWVab25lfSkpXG4gICAgY29uc3QgcmVxdWVzdENvbnRleHQgPSBmcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoKVxuICAgIGNvbnN0IHJlcXVlc3RQYXlsb2FkID0gbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQsIHNlcmlhbGl6ZWRQYXlsb2FkKVxuICAgIGNvbnN0IHJlc291cmNlUGF0aCA9IHRoaXMucmVzb3VyY2VQYXRoKClcbiAgICBjb25zdCBjb250YWluc0F0dGFjaG1lbnRVcGxvYWQgPSBmcm9udGVuZE1vZGVsUGF5bG9hZENvbnRhaW5zQXR0YWNobWVudFVwbG9hZChzZXJpYWxpemVkUGF5bG9hZClcbiAgICBjb25zdCB1c2VTaGFyZWRUcmFuc3BvcnQgPSAhY29udGFpbnNBdHRhY2htZW50VXBsb2FkXG4gICAgY29uc3QgdXJsID0gdXNlU2hhcmVkVHJhbnNwb3J0ID8gZnJvbnRlbmRNb2RlbEFwaVVybCgpIDogZnJvbnRlbmRNb2RlbENvbW1hbmRVcmwocmVzb3VyY2VQYXRoIHx8IFwiXCIsIGNvbW1hbmROYW1lKVxuXG4gICAgaWYgKHVzZVNoYXJlZFRyYW5zcG9ydCkge1xuICAgICAgY29uc3QgYmF0Y2hSZXNwb25zZSA9IGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cy5wdXNoKHtcbiAgICAgICAgICBjb21tYW5kTmFtZSxcbiAgICAgICAgICBjb21tYW5kVHlwZSxcbiAgICAgICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgICAgIHBheWxvYWQ6IHNlcmlhbGl6ZWRQYXlsb2FkLFxuICAgICAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAgICAgIHJlamVjdCxcbiAgICAgICAgICByZXF1ZXN0SWQ6IGAkeysrc2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RJZH1gLFxuICAgICAgICAgIHJlc29sdmUsXG4gICAgICAgICAgcmVzb3VyY2VQYXRoXG4gICAgICAgIH0pXG5cbiAgICAgICAgc2NoZWR1bGVTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdEZsdXNoKClcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IGRlY29kZWRCYXRjaFJlc3BvbnNlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChiYXRjaFJlc3BvbnNlKVxuXG4gICAgICB0aGlzLnRocm93T25FcnJvckZyb250ZW5kTW9kZWxSZXNwb25zZSh7XG4gICAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgICByZXNwb25zZTogZGVjb2RlZEJhdGNoUmVzcG9uc2VcbiAgICAgIH0pXG5cbiAgICAgIHJldHVybiBkZWNvZGVkQmF0Y2hSZXNwb25zZVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0cmFja0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0KGFzeW5jICgpID0+IHJ1bldpdGhUcmFuc3BvcnREZWFkbGluZShcbiAgICAgIHtcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBgJHt0aGlzLm5hbWV9IyR7Y29tbWFuZFR5cGV9IHJlcXVlc3QgdGltZWQgb3V0YCxcbiAgICAgICAgc2lnbmFsOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCksXG4gICAgICAgIHRpbWVvdXRNczogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVvdXRNcygpXG4gICAgICB9LFxuICAgICAgYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgICBjb25zdCBkaXJlY3RSZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybCwge1xuICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlcXVlc3RQYXlsb2FkKSxcbiAgICAgICAgICBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIsXG4gICAgICAgICAgaGVhZGVyczogZnJvbnRlbmRNb2RlbFJlcXVlc3RIZWFkZXJzKHRpbWVab25lKSxcbiAgICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICAgIHNpZ25hbFxuICAgICAgICB9KVxuXG4gICAgICAgIGNvbnN0IGRpcmVjdFJlc3BvbnNlVGV4dCA9IGF3YWl0IGRpcmVjdFJlc3BvbnNlLnRleHQoKVxuXG4gICAgICAgIGlmICghZGlyZWN0UmVzcG9uc2Uub2spIHtcbiAgICAgICAgICB0aHJvd0Zyb250ZW5kTW9kZWxIdHRwRXJyb3Ioe1xuICAgICAgICAgICAgY29tbWFuZExhYmVsOiBgJHt0aGlzLm5hbWV9IyR7Y29tbWFuZFR5cGV9YCxcbiAgICAgICAgICAgIHJlc3BvbnNlOiBkaXJlY3RSZXNwb25zZSxcbiAgICAgICAgICAgIHJlc3BvbnNlVGV4dDogZGlyZWN0UmVzcG9uc2VUZXh0XG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGRpcmVjdEpzb24gPSBkaXJlY3RSZXNwb25zZVRleHQubGVuZ3RoID4gMCA/IEpTT04ucGFyc2UoZGlyZWN0UmVzcG9uc2VUZXh0KSA6IHt9XG4gICAgICAgIGNvbnN0IGRlY29kZWREaXJlY3RSZXNwb25zZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoZGlyZWN0SnNvbikpXG5cbiAgICAgICAgdGhpcy50aHJvd09uRXJyb3JGcm9udGVuZE1vZGVsUmVzcG9uc2Uoe1xuICAgICAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgICAgIHJlc3BvbnNlOiBkZWNvZGVkRGlyZWN0UmVzcG9uc2VcbiAgICAgICAgfSlcblxuICAgICAgICByZXR1cm4gZGVjb2RlZERpcmVjdFJlc3BvbnNlXG4gICAgICB9XG4gICAgKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUgY3VzdG9tIGNvbW1hbmQuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7e2NvbW1hbmROYW1lOiBzdHJpbmcsIGNvbW1hbmRUeXBlOiBGcm9udGVuZE1vZGVsUmVxdWVzdENvbW1hbmRUeXBlLCBtZW1iZXJJZD86IHN0cmluZyB8IG51bWJlciB8IG51bGwsIHBheWxvYWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgcmVzb3VyY2VQYXRoOiBzdHJpbmd9fSBhcmdzIC0gQ29tbWFuZCBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4+fSAtIERlY29kZWQgcmVzcG9uc2UgcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBleGVjdXRlQ3VzdG9tQ29tbWFuZChhcmdzKSB7XG4gICAgY29uc3Qge2NvbW1hbmROYW1lLCBjb21tYW5kVHlwZSwgbWVtYmVySWQgPSBudWxsLCBwYXlsb2FkLCByZXNvdXJjZVBhdGh9ID0gYXJnc1xuICAgIGNvbnN0IHRpbWVab25lID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKClcbiAgICBjb25zdCBzZXJpYWxpemVkUGF5bG9hZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHBheWxvYWQsIHt0aW1lWm9uZX0pKVxuICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KClcblxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0LCBzZXJpYWxpemVkUGF5bG9hZClcbiAgICBjb25zdCBjdXN0b21QYXRoID0gZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRQYXRoKHtcbiAgICAgIGNvbW1hbmROYW1lLFxuICAgICAgbWVtYmVySWQsXG4gICAgICBtb2RlbE5hbWU6IHRoaXMuZ2V0TW9kZWxOYW1lKCksXG4gICAgICByZXNvdXJjZVBhdGhcbiAgICB9KVxuXG4gICAgY29uc3QgYmF0Y2hSZXNwb25zZSA9IGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMucHVzaCh7XG4gICAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgICBjdXN0b21QYXRoLFxuICAgICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgICBwYXlsb2FkOiBzZXJpYWxpemVkUGF5bG9hZCxcbiAgICAgICAgcmVxdWVzdENvbnRleHQsXG4gICAgICAgIHJlamVjdCxcbiAgICAgICAgcmVxdWVzdElkOiBgJHsrK3NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0SWR9YCxcbiAgICAgICAgcmVzb2x2ZVxuICAgICAgfSlcblxuICAgICAgc2NoZWR1bGVTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdEZsdXNoKClcbiAgICB9KVxuXG4gICAgY29uc3QgZGVjb2RlZEJhdGNoUmVzcG9uc2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChiYXRjaFJlc3BvbnNlKVxuXG4gICAgdGhpcy50aHJvd09uRXJyb3JGcm9udGVuZE1vZGVsUmVzcG9uc2Uoe1xuICAgICAgY29tbWFuZFR5cGUsXG4gICAgICByZXNwb25zZTogZGVjb2RlZEJhdGNoUmVzcG9uc2VcbiAgICB9KVxuXG4gICAgcmV0dXJuIGRlY29kZWRCYXRjaFJlc3BvbnNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aHJvdyBvbiBlcnJvciBmcm9udGVuZCBtb2RlbCByZXNwb25zZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHt7Y29tbWFuZFR5cGU6IEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29tbWFuZFR5cGUsIHJlc3BvbnNlOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyB0aHJvd09uRXJyb3JGcm9udGVuZE1vZGVsUmVzcG9uc2UoYXJncykge1xuICAgIGNvbnN0IHtjb21tYW5kVHlwZSwgcmVzcG9uc2V9ID0gYXJnc1xuICAgIGlmIChyZXNwb25zZT8uc3RhdHVzICE9PSBcImVycm9yXCIpIHJldHVyblxuXG4gICAgY29uc3QgcmVzcG9uc2VLZXlzID0gT2JqZWN0LmtleXMocmVzcG9uc2UpXG4gICAgY29uc3QgaGFzT25seVN0YXR1cyA9IHJlc3BvbnNlS2V5cy5sZW5ndGggPT09IDEgJiYgcmVzcG9uc2VLZXlzWzBdID09PSBcInN0YXR1c1wiXG4gICAgY29uc3QgaGFzRXJyb3JNZXNzYWdlID0gdHlwZW9mIHJlc3BvbnNlLmVycm9yTWVzc2FnZSA9PT0gXCJzdHJpbmdcIiAmJiByZXNwb25zZS5lcnJvck1lc3NhZ2UubGVuZ3RoID4gMFxuICAgIGNvbnN0IGhhc0Vycm9yRW52ZWxvcGVLZXlzID0gQm9vbGVhbihcbiAgICAgIHJlc3BvbnNlLmNvZGUgIT09IHVuZGVmaW5lZFxuICAgICAgfHwgcmVzcG9uc2UuZXJyb3IgIT09IHVuZGVmaW5lZFxuICAgICAgfHwgcmVzcG9uc2UuZXJyb3JzICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHJlc3BvbnNlLm1lc3NhZ2UgIT09IHVuZGVmaW5lZFxuICAgIClcbiAgICBjb25zdCBub25TdGF0dXNLZXlzID0gcmVzcG9uc2VLZXlzLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwic3RhdHVzXCIpXG4gICAgY29uc3QgY29uZmlndXJlZEF0dHJpYnV0ZU5hbWVzID0gdGhpcy5jb25maWd1cmVkRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZU5hbWVzKClcbiAgICBjb25zdCBsb29rc0xpa2VSYXdNb2RlbFBheWxvYWQgPSBub25TdGF0dXNLZXlzLmxlbmd0aCA+IDBcbiAgICAgICYmIG5vblN0YXR1c0tleXMuZXZlcnkoKGtleSkgPT4gY29uZmlndXJlZEF0dHJpYnV0ZU5hbWVzLmhhcyhrZXkpKVxuXG4gICAgaWYgKCFoYXNFcnJvck1lc3NhZ2UgJiYgIWhhc09ubHlTdGF0dXMgJiYgIWhhc0Vycm9yRW52ZWxvcGVLZXlzICYmIGxvb2tzTGlrZVJhd01vZGVsUGF5bG9hZCkgcmV0dXJuXG5cbiAgICBjb25zdCBkZWJ1Z0Vycm9yTWVzc2FnZSA9IHR5cGVvZiByZXNwb25zZS5kZWJ1Z0Vycm9yTWVzc2FnZSA9PT0gXCJzdHJpbmdcIiAmJiByZXNwb25zZS5kZWJ1Z0Vycm9yTWVzc2FnZS5sZW5ndGggPiAwXG4gICAgICA/IHJlc3BvbnNlLmRlYnVnRXJyb3JNZXNzYWdlXG4gICAgICA6IG51bGxcbiAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBkZWJ1Z0Vycm9yTWVzc2FnZSB8fCAoaGFzRXJyb3JNZXNzYWdlXG4gICAgICA/IHJlc3BvbnNlLmVycm9yTWVzc2FnZVxuICAgICAgOiBgUmVxdWVzdCBmYWlsZWQgZm9yICR7dGhpcy5uYW1lfSMke2NvbW1hbmRUeXBlfWApXG5cbiAgICBjb25zdCBlcnJvciA9IC8qKiBAdHlwZSB7RXJyb3IgJiB7Y29ycmVsYXRpb25JZD86IHN0cmluZywgZGV0YWlscz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXJyb3JNZXNzYWdlPzogc3RyaW5nLCB2ZWxvY2lvdXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGVycm9yVHlwZT86IHN0cmluZywgdmFsaWRhdGlvbkVycm9ycz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZGVidWdFcnJvckNsYXNzPzogc3RyaW5nLCBkZWJ1Z0JhY2t0cmFjZT86IHN0cmluZ1tdfX0gKi8gKG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpKVxuICAgIGlmIChoYXNFcnJvck1lc3NhZ2UpIHtcbiAgICAgIGVycm9yLmVycm9yTWVzc2FnZSA9IHJlc3BvbnNlLmVycm9yTWVzc2FnZVxuICAgIH1cbiAgICBpZiAocmVzcG9uc2UudmVsb2Npb3VzICYmIHR5cGVvZiByZXNwb25zZS52ZWxvY2lvdXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGVycm9yLnZlbG9jaW91cyA9IHJlc3BvbnNlLnZlbG9jaW91c1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHJlc3BvbnNlLmVycm9yVHlwZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgZXJyb3IuZXJyb3JUeXBlID0gcmVzcG9uc2UuZXJyb3JUeXBlXG4gICAgfVxuICAgIGlmIChyZXNwb25zZS52YWxpZGF0aW9uRXJyb3JzICYmIHR5cGVvZiByZXNwb25zZS52YWxpZGF0aW9uRXJyb3JzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBlcnJvci52YWxpZGF0aW9uRXJyb3JzID0gcmVzcG9uc2UudmFsaWRhdGlvbkVycm9yc1xuICAgIH1cbiAgICBpZiAocmVzcG9uc2UuZGV0YWlscyAmJiB0eXBlb2YgcmVzcG9uc2UuZGV0YWlscyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgZXJyb3IuZGV0YWlscyA9IHJlc3BvbnNlLmRldGFpbHNcbiAgICB9XG4gICAgaWYgKHR5cGVvZiByZXNwb25zZS5jb3JyZWxhdGlvbklkID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBlcnJvci5jb3JyZWxhdGlvbklkID0gcmVzcG9uc2UuY29ycmVsYXRpb25JZFxuICAgIH1cbiAgICAvLyBGb3J3YXJkIHNlcnZlci1wcm92aWRlZCBkZWJ1ZyBkZXRhaWwgKGluY2x1ZGVkIG9ubHkgd2hlbiB0aGUgYmFja2VuZFxuICAgIC8vIGRlZW1zIHRoZSByZXF1ZXN0ZXIgYWxsb3dlZCB0byBzZWUgaXQsIGUuZy4gYW4gYWRtaW4pIHNvIGNhbGxlcnMgY2FuXG4gICAgLy8gcmVuZGVyIHRoZSByZWFsIGVycm9yIGNsYXNzIGFuZCBzdGFjayB0cmFjZSBpbnN0ZWFkIG9mIHRoZSBnZW5lcmljXG4gICAgLy8gY2xpZW50LXNhZmUgbWVzc2FnZS5cbiAgICBpZiAodHlwZW9mIHJlc3BvbnNlLmRlYnVnRXJyb3JDbGFzcyA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgZXJyb3IuZGVidWdFcnJvckNsYXNzID0gcmVzcG9uc2UuZGVidWdFcnJvckNsYXNzXG4gICAgfVxuICAgIGlmIChBcnJheS5pc0FycmF5KHJlc3BvbnNlLmRlYnVnQmFja3RyYWNlKSkge1xuICAgICAgZXJyb3IuZGVidWdCYWNrdHJhY2UgPSByZXNwb25zZS5kZWJ1Z0JhY2t0cmFjZVxuICAgIH1cbiAgICB0aHJvdyBlcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uZmlndXJlZCBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBDb25maWd1cmVkIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICovXG4gIHN0YXRpYyBjb25maWd1cmVkRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZU5hbWVzKCkge1xuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0aGlzLnJlc291cmNlQ29uZmlnKCkpXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHJlc291cmNlQ29uZmlnLmF0dHJpYnV0ZXNcblxuICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSB7XG4gICAgICByZXR1cm4gbmV3IFNldChhdHRyaWJ1dGVzLmZpbHRlcigoYXR0cmlidXRlTmFtZSkgPT4gdHlwZW9mIGF0dHJpYnV0ZU5hbWUgPT09IFwic3RyaW5nXCIpKVxuICAgIH1cblxuICAgIGlmIChhdHRyaWJ1dGVzICYmIHR5cGVvZiBhdHRyaWJ1dGVzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm4gbmV3IFNldChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKSlcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IFNldCgpXG4gIH1cbn1cblxuLyoqIFB1YmxpYyBmcm9udGVuZCBtb2RlbCBmb3Igc2FmZSBWZWxvY2lvdXMgYXR0YWNobWVudCBtZXRhZGF0YS4gKi9cbmV4cG9ydCBjbGFzcyBWZWxvY2lvdXNBdHRhY2htZW50IGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2Uge1xuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd9IC0gUmVzb3VyY2UgY29uZmlnLlxuICAgKi9cbiAgc3RhdGljIHJlc291cmNlQ29uZmlnKCkge1xuICAgIHJldHVybiB7XG4gICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgIGJ5dGVTaXplOiB7dHlwZTogXCJpbnRlZ2VyXCJ9LFxuICAgICAgICBjb250ZW50VHlwZToge251bGw6IHRydWUsIHR5cGU6IFwidmFyY2hhclwifSxcbiAgICAgICAgY3JlYXRlZEF0OiB7dHlwZTogXCJkYXRldGltZVwifSxcbiAgICAgICAgZmlsZW5hbWU6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgICAgIGlkOiB7dHlwZTogXCJ1dWlkXCJ9LFxuICAgICAgICBuYW1lOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgICAgICBwb3NpdGlvbjoge3R5cGU6IFwiaW50ZWdlclwifSxcbiAgICAgICAgcmVjb3JkSWQ6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgICAgIHJlY29yZFR5cGU6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgICAgIHVwZGF0ZWRBdDoge3R5cGU6IFwiZGF0ZXRpbWVcIn1cbiAgICAgIH0sXG4gICAgICBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzOiBbXCJpbmRleFwiXSxcbiAgICAgIGJ1aWx0SW5NZW1iZXJDb21tYW5kczogW1wiZmluZFwiXSxcbiAgICAgIG1vZGVsTmFtZTogXCJWZWxvY2lvdXNBdHRhY2htZW50XCIsXG4gICAgICBwcmltYXJ5S2V5OiBcImlkXCJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYXR0YWNobWVudCBtZXRhZGF0YSBieSBpdHMgcHVibGljIGlkIHRocm91Z2ggdGhlIG1lbWJlciBhdXRob3JpemF0aW9uIHBhdGguXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIEF0dGFjaG1lbnQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gUmVzb2x2ZWQgYXR0YWNobWVudCBtZXRhZGF0YS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kKGlkKSB7XG4gICAgcmV0dXJuIHRoaXMuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UoYXdhaXQgdGhpcy5leGVjdXRlQ29tbWFuZChcImZpbmRcIiwge2lkfSkpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBpZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBdHRhY2htZW50IGlkLlxuICAgKi9cbiAgaWQoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJpZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIG93bmVyIG1vZGVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gT3duZXIgbW9kZWwgbmFtZS5cbiAgICovXG4gIHJlY29yZFR5cGUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJyZWNvcmRUeXBlXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgb3duZXIgcmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE93bmVyIHJlY29yZCBpZC5cbiAgICovXG4gIHJlY29yZElkKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwicmVjb3JkSWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IG5hbWUgb24gdGhlIG93bmVyIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgbmFtZSBvbiB0aGUgb3duZXIgbW9kZWwuXG4gICAqL1xuICBuYW1lKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwibmFtZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgcG9zaXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQXR0YWNobWVudCBwb3NpdGlvbi5cbiAgICovXG4gIHBvc2l0aW9uKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwicG9zaXRpb25cIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IGZpbGVuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgZmlsZW5hbWUuXG4gICAqL1xuICBmaWxlbmFtZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImZpbGVuYW1lXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBjb250ZW50IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIEF0dGFjaG1lbnQgY29udGVudCB0eXBlLlxuICAgKi9cbiAgY29udGVudFR5cGUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJjb250ZW50VHlwZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgYnl0ZSBzaXplLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEF0dGFjaG1lbnQgYnl0ZSBzaXplLlxuICAgKi9cbiAgYnl0ZVNpemUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJieXRlU2l6ZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNyZWF0ZWQtYXQgdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7RGF0ZX0gLSBDcmVhdGVkLWF0IHRpbWVzdGFtcC5cbiAgICovXG4gIGNyZWF0ZWRBdCgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImNyZWF0ZWRBdFwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHVwZGF0ZWQtYXQgdGltZXN0YW1wLlxuICAgKiBAcmV0dXJucyB7RGF0ZX0gLSBVcGRhdGVkLWF0IHRpbWVzdGFtcC5cbiAgICovXG4gIHVwZGF0ZWRBdCgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcInVwZGF0ZWRBdFwiKSB9XG59XG5cbkZyb250ZW5kTW9kZWxCYXNlLnJlZ2lzdGVyTW9kZWwoVmVsb2Npb3VzQXR0YWNobWVudClcbiJdfQ==