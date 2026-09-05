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
        return await this._registerDestroyEventCallback(callback, options);
    }
    /**
     * Registers a destroy callback after the public model-specific signature has been checked.
     * @this {FrontendModelClass}
     * @param {(payload: {id: never}) => void} callback - Type-erased event callback.
     * @param {import("./query.js").FrontendModelEventOptions} [options] - Destroy event options.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    static async _registerDestroyEventCallback(callback, options = {}) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbHMvYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxPQUFPLE1BQU0sMkJBQTJCLENBQUE7QUFDL0MsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxrQkFBa0IsRUFBRSxFQUFDLGdDQUFnQyxFQUFDLE1BQU0sWUFBWSxDQUFBO0FBQy9FLE9BQU8sc0JBQXNCLE1BQU0sZ0JBQWdCLENBQUE7QUFDbkQsT0FBTyxFQUFDLDJCQUEyQixFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0UsT0FBTyxFQUFDLHFCQUFxQixFQUFFLHlCQUF5QixFQUFDLE1BQU0scUJBQXFCLENBQUE7QUFDcEYsT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGlDQUFpQyxFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0gsT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDekgsT0FBTyx3QkFBd0IsTUFBTSx5QkFBeUIsQ0FBQTtBQUM5RCxPQUFPLEVBQUMsd0JBQXdCLEVBQUUsZ0JBQWdCLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUMxRSxPQUFPLHdCQUF3QixNQUFNLG9DQUFvQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyx1QkFBdUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ3BFLE9BQU8sRUFBQyx3Q0FBd0MsRUFBRSxzQ0FBc0MsRUFBQyxNQUFNLDZCQUE2QixDQUFBO0FBQzVILE9BQU8sRUFBQyxtQkFBbUIsRUFBRSwyQkFBMkIsRUFBRSwyQkFBMkIsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ3hILE9BQU8sRUFBQyxnQkFBZ0IsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQ3hELE9BQU8sYUFBYSxNQUFN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QyxDQUFDO0lBRXBEOzs7T0FHRztJQUNILFdBQVcsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTFEOzs7T0FHRztJQUNILFFBQVEsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXBEOzs7T0FHRztJQUNILFNBQVMsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXREOzs7T0FHRztJQUNILFNBQVMsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDLENBQUEsQ0FBQyxDQUFDO0NBQ3ZEO0FBRUQsaUJBQWlCLENBQUMsYUFBYSxDQUFDLG1CQUFtQixDQUFDLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgdGltZW91dCBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiXG5pbXBvcnQgd2FpdCBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvd2FpdC5qc1wiXG5pbXBvcnQgRnJvbnRlbmRNb2RlbFF1ZXJ5LCB7ZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWR9IGZyb20gXCIuL3F1ZXJ5LmpzXCJcbmltcG9ydCBGcm9udGVuZE1vZGVsUHJlbG9hZGVyIGZyb20gXCIuL3ByZWxvYWRlci5qc1wiXG5pbXBvcnQge25vcm1hbGl6ZURhdGVTdHJpbmdGb3JXcml0ZX0gZnJvbSBcIi4uL2RhdGFiYXNlL2RhdGV0aW1lLXN0b3JhZ2UuanNcIlxuaW1wb3J0IHtyZWdpc3RlckZyb250ZW5kTW9kZWwsIHJlc29sdmVGcm9udGVuZE1vZGVsQ2xhc3N9IGZyb20gXCIuL21vZGVsLXJlZ2lzdHJ5LmpzXCJcbmltcG9ydCB7dmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kTmFtZSwgdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRofSBmcm9tIFwiLi9yZXNvdXJjZS1jb25maWctdmFsaWRhdGlvbi5qc1wiXG5pbXBvcnQge2Rlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlLCBzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IGZyb20gXCIuL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcbmltcG9ydCBydW5XaXRoVHJhbnNwb3J0RGVhZGxpbmUgZnJvbSBcIi4vdHJhbnNwb3J0LWRlYWRsaW5lLmpzXCJcbmltcG9ydCB7UkVRVUVTVF9USU1FX1pPTkVfSEVBREVSLCB2YWxpZGF0ZVRpbWVab25lfSBmcm9tIFwiLi4vdGltZS16b25lLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQgZnJvbSBcIi4uL2h0dHAtY2xpZW50L3dlYnNvY2tldC1jbGllbnQuanNcIlxuaW1wb3J0IHtyZW1vdGVSZXF1ZXN0Q29udGV4dEtleX0gZnJvbSBcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuaW1wb3J0IHtjYXB0dXJlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0LCBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dH0gZnJvbSBcIi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiXG5pbXBvcnQge2J1ZmZlck91dGdvaW5nRXZlbnQsIGNsZWFyQnVmZmVyZWRPdXRnb2luZ0V2ZW50cywgZHJhaW5CdWZmZXJlZE91dGdvaW5nRXZlbnRzfSBmcm9tIFwiLi9vdXRnb2luZy1ldmVudC1idWZmZXIuanNcIlxuaW1wb3J0IHtkZWZpbmVNb2RlbFNjb3BlfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIlxuaW1wb3J0IGlzUGxhaW5PYmplY3QgZnJvbSBcIi4uL3V0aWxzL3BsYWluLW9iamVjdC5qc1wiXG5pbXBvcnQge2ZvcmNlZE5vbkJsYW5rU3RyaW5nfSBmcm9tIFwidHlwYW5pY1wiXG5pbXBvcnQge21vZGVsUHJpbWFyeUtleUNhY2hlS2V5LCBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zLCByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUsIHNjYWxhck1vZGVsUHJpbWFyeUtleSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQge3JlYWRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCwgcmVhZFBheWxvYWRDb21wdXRlZEFiaWxpdHksIHJlYWRQYXlsb2FkUXVlcnlEYXRhLCBzZXRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCwgc2V0UGF5bG9hZENvbXB1dGVkQWJpbGl0eSwgc2V0UGF5bG9hZFF1ZXJ5RGF0YX0gZnJvbSBcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiXG5cbi8qKiBAdHlwZWRlZiB7c3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWV9IEZyb250ZW5kTW9kZWxFdmVudFByaW1hcnlLZXlWYWx1ZSAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IEZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnMgKi9cblxuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCByZWxhdGlvbnNoaXAgaGVscGVyIHR5cGUuIFJldHVybmVkIGJ5IGBnZXRSZWxhdGlvbnNoaXBCeU5hbWVgLFxuICogd2hpY2ggZ2VuZXJhdGVkIG1vZGVscyBpbW1lZGlhdGVseSBjYXN0IHRvIHRoZWlyIGNvbmNyZXRlIHJlbGF0aW9uc2hpcCB0eXBlXG4gKiAoZS5nLiBgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwPE93bmVyLCBUYXJnZXQsIFRhcmdldENyZWF0ZUF0dHJpYnV0ZXM+YCkuXG4gKiBUaGUgbWVtYmVycyB1c2UgYGFueWAgdHlwZSBhcmdzIHNvIHRoYXQgY2FzdCBpcyBhbGxvd2VkIHJlZ2FyZGxlc3Mgb2YgdGhlXG4gKiB0YXJnZXQgbW9kZWwncyB0eXBlZC1hdHRyaWJ1dGUgZ2VuZXJpY3Mg4oCUIGEgY29uY3JldGUgYEZyb250ZW5kTW9kZWxCYXNlYCBtZW1iZXJcbiAqIGhlcmUgbWFrZXMgdGhlIGNhc3QgYSBub24tb3ZlcmxhcHBpbmcgKFRTMjM1MikgZXJyb3IgZm9yIGV2ZXJ5IHR5cGVkIG1vZGVsLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwPGFueSwgYW55LCBhbnk+IHwgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwPGFueSwgYW55LCBhbnk+fSBGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdGVtcGxhdGUge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBbUHJpbWFyeUtleVZhbHVlPWltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlXVxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZX0gW01vZGVsPUZyb250ZW5kTW9kZWxCYXNlXVxuICogQHR5cGVkZWYge3tjYWxsYmFjazogKHBheWxvYWQ6IHtpZDogUHJpbWFyeUtleVZhbHVlLCBtb2RlbDogTW9kZWx9KSA9PiB2b2lkLCBldmVudEZpbHRlcktleTogc3RyaW5nIHwgbnVsbCwgZXZlbnRGaWx0ZXJQYXlsb2FkOiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWQgfCBudWxsLCBwcm9qZWN0aW9uUGF5bG9hZDogaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9fSBGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnlcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0ZW1wbGF0ZSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IFtQcmltYXJ5S2V5VmFsdWU9aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWVdXG4gKiBAdHlwZWRlZiB7e2NhbGxiYWNrOiAocGF5bG9hZDoge2lkOiBQcmltYXJ5S2V5VmFsdWV9KSA9PiB2b2lkfX0gRnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnlcbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtcImNyZWF0ZVwiIHwgXCJmaW5kXCIgfCBcImluZGV4XCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gRnJvbnRlbmRNb2RlbENvbW1hbmRUeXBlICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29tbWFuZFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGUgfCBzdHJpbmd9IEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29tbWFuZFR5cGUgKi9cbi8qKlxuICogTW9kZWwtbGlrZSBpbnN0YW5jZSB2YWx1ZSBzdXBwb3J0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0LlxuICogQHR5cGVkZWYge3thdHRyaWJ1dGVzOiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn19IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRNb2RlbFZhbHVlXG4gKi9cbi8qKlxuICogU3BlY2lhbCBzY2FsYXIgdmFsdWVzIHJlc3RvcmVkIGJ5IGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydC5cbiAqIEB0eXBlZGVmIHt1bmRlZmluZWQgfCBudWxsIHwgYm9vbGVhbiB8IG51bWJlciB8IHN0cmluZyB8IGJpZ2ludCB8IERhdGUgfCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0TW9kZWxWYWx1ZX0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNjYWxhclZhbHVlXG4gKi9cbi8qKlxuICogUGxhaW4gb2JqZWN0IHN1cHBvcnRlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgdmFsdWVzLlxuICogTmVzdGVkIHZhbHVlcyBhcmUgaW50ZW50aW9uYWxseSBvcGFxdWUgYmVjYXVzZSBUeXBlU2NyaXB0IHJlamVjdHMgcmVjdXJzaXZlXG4gKiBKU0RvYyB0eXBlZGVmcyBmb3IgdGhpcyB0cmFuc3BvcnQgdmFsdWUgY29udHJhY3QuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRPYmplY3RcbiAqL1xuLyoqXG4gKiBWYWx1ZSBzdXBwb3J0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHNlcmlhbGl6YXRpb24gYW5kIGRlc2VyaWFsaXphdGlvbi5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsVHJhbnNwb3J0U2NhbGFyVmFsdWUgfCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0T2JqZWN0IHwgQXJyYXk8dW5rbm93bj59IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZVxuICovXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSB2YWx1ZSB1c2VkIHdoZW4gZ2VuZXJhdGVkIG1ldGFkYXRhIGNhbm5vdCBpbmZlciBhIG5hcnJvd2VyIHR5cGUuXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWVcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7c3luYz86IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQXR0YWNobWVudFN5bmNDb25maWd1cmF0aW9uLCB0eXBlOiBcImhhc09uZVwiIHwgXCJoYXNNYW55XCJ9fSBGcm9udGVuZE1vZGVsQXR0YWNobWVudERlZmluaXRpb25cbiAqL1xuLyoqXG4gKiBEZWZpbmVzIGZyb250ZW5kLW1vZGVsIGF0dHJpYnV0ZSBtZXRhZGF0YS5cbiAqIEB0eXBlZGVmIHt7Y29sdW1uVHlwZT86IHN0cmluZywgZGF0YVR5cGU/OiBzdHJpbmcsIGpzRG9jVHlwZT86IHN0cmluZywgbmFtZT86IHN0cmluZywgbnVsbD86IGJvb2xlYW4sIHNlbGVjdGVkQnlEZWZhdWx0PzogYm9vbGVhbiwgc3FsVHlwZT86IHN0cmluZywgdHlwZT86IHN0cmluZ319IEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVEZWZpbml0aW9uXG4gKi9cbi8qKlxuICogQXR0YWNobWVudCBpbnB1dCBhY2NlcHRlZCBieSBmcm9udGVuZC1tb2RlbCBhdHRhY2htZW50IGhlbHBlcnMgYmVmb3JlIG5vcm1hbGl6YXRpb24uXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwge2FycmF5QnVmZmVyOiAoKSA9PiBQcm9taXNlPEFycmF5QnVmZmVyPiwgdHlwZT86IHN0cmluZywgbmFtZT86IHN0cmluZ30gfCBudWxsIHwgdW5kZWZpbmVkfSBGcm9udGVuZE1vZGVsQXR0YWNobWVudElucHV0XG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gRnJvbnRlbmRNb2RlbFN5bmNNZXRhZGF0YVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge1wib3B0aW1pc3RpY1ZlcnNpb25cIiB8IFwic2VydmVyV2luc1wiIHwgXCJsYXN0V3JpdGVyV2luc1wiIHwgXCJmaWVsZFRocmVlV2F5XCIgfCBcImFwcGVuZE9ubHlcIn0gRnJvbnRlbmRNb2RlbFN5bmNDb25mbGljdFN0cmF0ZWd5XG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2VuYWJsZWQ6IGJvb2xlYW4sIG9wZXJhdGlvbnM6IHN0cmluZ1tdLCBwb2xpY3lIYXNoOiBzdHJpbmcsIHBvbGljeVZlcnNpb246IHN0cmluZyB8IG51bGwsIGNvbmZsaWN0U3RyYXRlZ3k/OiBGcm9udGVuZE1vZGVsU3luY0NvbmZsaWN0U3RyYXRlZ3ksIG1ldGFkYXRhPzogRnJvbnRlbmRNb2RlbFN5bmNNZXRhZGF0YX19IEZyb250ZW5kTW9kZWxTeW5jQ29uZmlnXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2F0dHJpYnV0ZXM/OiBBcnJheTxzdHJpbmcgfCBGcm9udGVuZE1vZGVsQXR0cmlidXRlRGVmaW5pdGlvbj4gfCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlRGVmaW5pdGlvbj4sIGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHM/OiBzdHJpbmdbXSwgYnVpbHRJbk1lbWJlckNvbW1hbmRzPzogc3RyaW5nW10sIGNvbGxlY3Rpb25Db21tYW5kcz86IHN0cmluZ1tdLCBjb21tYW5kcz86IHN0cmluZ1tdLCBtZW1iZXJDb21tYW5kcz86IHN0cmluZ1tdLCBhdHRhY2htZW50cz86IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRhY2htZW50RGVmaW5pdGlvbj4sIG1vZGVsTmFtZT86IHN0cmluZywgbmVzdGVkQXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHthbGxvd0Rlc3Ryb3k/OiBib29sZWFuLCBsaW1pdD86IG51bWJlcn0+LCBwcmltYXJ5S2V5Pzogc3RyaW5nIHwgc3RyaW5nW10sIHJlbGF0aW9uc2hpcHM/OiBzdHJpbmdbXSwgc3luYz86IEZyb250ZW5kTW9kZWxTeW5jQ29uZmlnfX0gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnXG4gKi9cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgY29uc3RydWN0b3IgdHlwZS5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2V9IFtUPUZyb250ZW5kTW9kZWxCYXNlXVxuICogQHR5cGVkZWYge3tuZXcgKGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+KTogVH19IEZyb250ZW5kTW9kZWxDb25zdHJ1Y3RvclxuICovXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIHN0YXRpYyBzaWRlLlxuICpcbiAqIFRoZSB0ZW1wbGF0ZSBkZWZhdWx0cyBhcmUgaW50ZW50aW9uYWxseSBwZXJtaXNzaXZlIChgYW55YCBtb2RlbC9hdHRyaWJ1dGVcbiAqIHBhcmFtcykuIFRoZSBiYXJlIGBGcm9udGVuZE1vZGVsQ2xhc3NgIGlzIHRoZSBgQHRoaXNgL2NvbnN0cmFpbnQgdHlwZSBvbiB0aGVcbiAqIHN0YXRpYyBxdWVyeSBtZXRob2RzIChmaW5kQnkvZmluZC93aGVyZS9wcmVsb2FkLy4uLik7IGEgZ2VuZXJhdGVkIHN1YmNsYXNzXG4gKiBkZWNsYXJlcyB0eXBlZC1hdHRyaWJ1dGUgZ2VuZXJpY3MgKGUuZy4gYEZyb250ZW5kTW9kZWxCYXNlPEFjY291bnRBdHRyaWJ1dGVzLFxuICogQWNjb3VudENyZWF0ZUF0dHJpYnV0ZXMsIEFjY291bnRVcGRhdGVBdHRyaWJ1dGVzPmApIHdoaWNoLCBhZ2FpbnN0IGEgY29uY3JldGVcbiAqIGBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+YCBkZWZhdWx0LCBmYWlsIHRoZSBjb25zdHJhaW50IGJ5XG4gKiBpbnZhcmlhbmNlLiBEZWZhdWx0aW5nIHRvIGBhbnlgIGxldHMgYW55IHN1YmNsYXNzIHNhdGlzZnkgdGhlIGNvbnN0cmFpbnQgd2hpbGVcbiAqIHRoZSBtZXRob2RzJyBvd24gYEB0ZW1wbGF0ZSBUYCBzdGlsbCBjYXB0dXJlcyB0aGUgcHJlY2lzZSBjYWxsaW5nIGNsYXNzIGZvclxuICogdGhlaXIgcmV0dXJuIHR5cGVzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZX0gW1Q9RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueSwgYW55LCBhbnk+XVxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtBdHRyaWJ1dGVzPWFueV1cbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbQ3JlYXRlQXR0cmlidXRlcz1hbnldXG4gKiBAdHlwZWRlZiB7e25ldyAoKTogVCwgY3JlYXRlKGF0dHJpYnV0ZXM/OiBDcmVhdGVBdHRyaWJ1dGVzKTogUHJvbWlzZTxUPn0gJiBPbWl0PHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZSwgXCJjcmVhdGVcIiB8IFwicHJvdG90eXBlXCI+fSBGcm9udGVuZE1vZGVsQ2xhc3NcbiAqL1xuLyoqIEB0eXBlZGVmIHtPbWl0PEZyb250ZW5kTW9kZWxDbGFzczxGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55LCBhbnksIHN0cmluZz4+LCBcIm9uRGVzdHJveVwiPiAmIHtvbkRlc3Ryb3k6IChjYWxsYmFjazogKHBheWxvYWQ6IHtpZDogc3RyaW5nfSkgPT4gdm9pZCwgb3B0aW9ucz86IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9ucykgPT4gUHJvbWlzZTwoKSA9PiB2b2lkPn19IEZyb250ZW5kTW9kZWxTY2FsYXJFdmVudENsYXNzICovXG4vKipcbiAqIENyZWF0ZSBhdHRyaWJ1dGVzIGFjY2VwdGVkIGJ5IGEgZnJvbnRlbmQgbW9kZWwgaW5zdGFuY2UuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlfSBUXG4gKiBAdHlwZWRlZiB7VCBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlPFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4sIGluZmVyIENyZWF0ZUF0dHJpYnV0ZXMsIGluZmVyIF9VcGRhdGVBdHRyaWJ1dGVzPiA/IENyZWF0ZUF0dHJpYnV0ZXMgOiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSBGcm9udGVuZE1vZGVsQ3JlYXRlQXR0cmlidXRlc0ZvclxuICovXG4vKipcbiAqIExpZmVjeWNsZSBldmVudCBpZGVudGl0eSBleHBvc2VkIGJ5IGEgY29uY3JldGUgZnJvbnRlbmQgbW9kZWwuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlfSBUXG4gKiBAdHlwZWRlZiB7VCBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnksIGFueSwgaW5mZXIgRXZlbnRQcmltYXJ5S2V5VmFsdWU+ID8gRXZlbnRQcmltYXJ5S2V5VmFsdWUgOiBGcm9udGVuZE1vZGVsRXZlbnRQcmltYXJ5S2V5VmFsdWV9IEZyb250ZW5kTW9kZWxFdmVudFByaW1hcnlLZXlWYWx1ZUZvclxuICovXG4vKipcbiAqIExvYWRlZCBpbnN0YW5jZSB0eXBlIGZvciByZWxhdGlvbnNoaXAgaGVscGVyIGdlbmVyaWNzLiBPbGRlciBnZW5lcmF0ZWRcbiAqIGZyb250ZW5kIG1vZGVscyBwYXNzZWQgbW9kZWwgY2xhc3NlcyBpbnRvIHJlbGF0aW9uc2hpcCBoZWxwZXJzLCB3aGlsZSBuZXdlclxuICogZ2VuZXJhdGVkIG1vZGVscyBwYXNzIGluc3RhbmNlIHR5cGVzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gVFxuICogQHR5cGVkZWYge1QgZXh0ZW5kcyB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2UgPyBJbnN0YW5jZVR5cGU8VD4gOiBUfSBGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWxcbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnXG4gKiBAcHJvcGVydHkge3N0cmluZyB8ICgoKSA9PiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKX0gW3VybF0gLSBPcHRpb25hbCBmcm9udGVuZC1tb2RlbCBVUkwuIFRoaXMgc2hvdWxkIGJlIHRoZSBzaGFyZWQgZW5kcG9pbnQgKGZvciBleGFtcGxlIGBcIi9mcm9udGVuZC1tb2RlbHNcImAgb3IgYFwiaHR0cHM6Ly9leGFtcGxlLmNvbS9mcm9udGVuZC1tb2RlbHNcImApLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc2hhcmVkXSAtIERlcHJlY2F0ZWQgc2hhcmVkLWVuZHBvaW50IGZsYWcgcmV0YWluZWQgZm9yIGNvbXBhdGliaWxpdHkuIEZyb250ZW5kLW1vZGVsIENSVUQvY3VzdG9tIGNvbW1hbmRzIHVzZSB0aGUgc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSBlbnZlbG9wZSBieSBkZWZhdWx0LlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCAoKCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCl9IFt3ZWJzb2NrZXRVcmxdIC0gT3B0aW9uYWwgd2Vic29ja2V0IFVSTC4gV2hlbiBzZXQsIFZlbG9jaW91cyBjcmVhdGVzIGFuZCBtYW5hZ2VzIGl0cyBvd24gd2Vic29ja2V0IGNsaWVudCBpbnRlcm5hbGx5LiBTdWJzY3JpcHRpb25zIHVzZSB0aGUgd2Vic29ja2V0OyBDUlVEIHVzZXMgSFRUUCBhbmQgZmFsbHMgYmFjayBncmFjZWZ1bGx5LiBFeGFtcGxlOiBgXCJ3czovL2xvY2FsaG9zdDozMDA2L3dlYnNvY2tldFwiYC5cbiAqIEBwcm9wZXJ0eSB7e3Bvc3Q6IChwYXRoOiBzdHJpbmcsIGJvZHk/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgb3B0aW9ucz86IHtoZWFkZXJzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPiwgc2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPHtqc29uOiAoKSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+LCBzdWJzY3JpYmU6IChjaGFubmVsOiBzdHJpbmcsIG9wdGlvbnM6IHtwYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59LCBjYWxsYmFjazogKHBheWxvYWQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiB2b2lkKSA9PiAoKCkgPT4gdm9pZCksIHN1YnNjcmliZUFuZFdhaXQ/OiAoY2hhbm5lbDogc3RyaW5nLCBvcHRpb25zOiB7cGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSwgY2FsbGJhY2s6IChwYXlsb2FkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZCkgPT4gUHJvbWlzZTwoKCkgPT4gdm9pZCk+fX0gW3dlYnNvY2tldENsaWVudF0gLSBPcHRpb25hbCB3ZWJzb2NrZXQgY2xpZW50IGZvciBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJIHJlcXVlc3RzIGFuZCBzdWJzY3JpcHRpb25zLiBJdHMgYHBvc3RgIHJlY2VpdmVzIHRoZSBib3VuZGVkLWRlYWRsaW5lIGBzaWduYWxgIGFuZCBzaG91bGQgZm9yd2FyZCBpdCBpbnRvIHRoZSB1bmRlcmx5aW5nIHRyYW5zcG9ydCBzbyB0aGUgZGVhZGxpbmUgY2FuIGFib3J0IHRoZSBsaXZlIHJlcXVlc3QgYW5kIGl0cyByZXNwb25zZS1ib2R5IHJlYWQuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIHN0cmluZz4gfCAoKCkgPT4gUmVjb3JkPHN0cmluZywgc3RyaW5nPil9IFtyZXF1ZXN0SGVhZGVyc10gLSBFeHRyYSBIVFRQL1dTIGhlYWRlcnMgdG8gYXR0YWNoIHRvIGV2ZXJ5IGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0LiBQYXNzIGEgZnVuY3Rpb24gdG8gY29tcHV0ZSB0aGVtIGF0IHJlcXVlc3QgdGltZSAoZm9yIGV4YW1wbGUgdG8gaW5jbHVkZSB0aGUgY3VycmVudCBsb2NhbGUpLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0IHwgKCgpID0+IGltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQgfCB1bmRlZmluZWQgfCBudWxsKX0gW3JlcXVlc3RDb250ZXh0XSAtIEltbXV0YWJsZSBzY2FsYXIgY29udGV4dCBjYXB0dXJlZCBpbmRlcGVuZGVudGx5IHdoZW4gZWFjaCBvcGVyYXRpb24gb3IgZXZlbnQgc3Vic2NyaXB0aW9uIHN0YXJ0cyBhbmQgc2VudCBmb3IgcmVtb3RlIHRlbmFudC9hYmlsaXR5IHJlc29sdXRpb24uXG4gKiBAcHJvcGVydHkge251bWJlciB8ICgoKSA9PiBudW1iZXIgfCB1bmRlZmluZWQgfCBudWxsKX0gW3RpbWVvdXRdIC0gQm91bmRlZCBkZWFkbGluZSBpbiBtaWxsaXNlY29uZHMgY292ZXJpbmcgY29ubmVjdGlvbiwgcmVzcG9uc2UgaGVhZGVycywgYW5kIHJlc3BvbnNlLWJvZHkgY29uc3VtcHRpb24gZm9yIGVhY2ggZnJvbnRlbmQtbW9kZWwgQVBJIHJlcXVlc3QuIE9uIGV4cGlyeSB0aGUgbGl2ZSBmZXRjaC9hZGFwdGVyIHJlcXVlc3QgaXMgYWJvcnRlZCAoYnVpbHQgb24gYXdhaXRlcnkncyBgdGltZW91dGApIGFuZCBhd2FpdGVyeSdzIGBUaW1lb3V0RXJyb3JgIGlzIHRocm93biwgc28gY2FsbGVycyBjYW4gY2xhc3NpZnkgYSB0aW1lb3V0IHZpYSBgZXJyb3IgaW5zdGFuY2VvZiBUaW1lb3V0RXJyb3JgLiBQYXNzIGEgZnVuY3Rpb24gdG8gcmVzb2x2ZSBpdCBwZXIgcmVxdWVzdC4gRmFsc3kvYWJzZW50IG1lYW5zIG5vIGRlYWRsaW5lLlxuICogQHByb3BlcnR5IHtBYm9ydFNpZ25hbCB8ICgoKSA9PiBBYm9ydFNpZ25hbCB8IHVuZGVmaW5lZCB8IG51bGwpfSBbc2lnbmFsXSAtIE9wdGlvbmFsIGNhbGxlci9zZXNzaW9uIEFib3J0U2lnbmFsIGNvbXBvc2VkIHdpdGggdGhlIGRlYWRsaW5lLiBBYm9ydGluZyBpdCBjYW5jZWxzIHRoZSBsaXZlIHJlcXVlc3QgKGZvciBleGFtcGxlIG9uIHNlc3Npb24gc2h1dGRvd24gb3Igb2ZmbGluZSB0cmFuc2l0aW9uKTsgdGhlIHJlc3VsdGluZyBhYm9ydCBlcnJvciBzdGF5cyBkaXN0aW5ndWlzaGFibGUgZnJvbSBhIHRpbWVvdXQuIFBhc3MgYSBmdW5jdGlvbiB0byByZXNvbHZlIHRoZSBjdXJyZW50IHNpZ25hbCBwZXIgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7e2dldDogKCkgPT4gc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCB8IFByb21pc2U8c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZD4sIHNldDogKHNlc3Npb25JZDogc3RyaW5nKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPiwgY2xlYXI6ICgpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fX0gW3Nlc3Npb25TdG9yZV0gLSBPcHRpb25hbCBzZXNzaW9uSWQgcGVyc2lzdGVuY2UgaG9vayBmb3J3YXJkZWQgdG8gdGhlIGludGVybmFsIGBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnRgIHNvIFdTIHNlc3Npb25zIGNhbiBiZSByZXN1bWVkIGFjcm9zcyBwYWdlIHJlbG9hZHMgLyBhcHAgcmVzdGFydHMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8ICgoKSA9PiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkKX0gW3RpbWVab25lXSAtIElBTkEgdGltZXpvbmUgc2VudCB3aXRoIGV2ZXJ5IGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0IGZvciB0aW1lem9uZS1sZXNzIGRhdGV0aW1lIHBhcnNpbmcuXG4gKiBAcHJvcGVydHkge3thY3RvckRldmljZUlkOiBzdHJpbmcsIGFjdG9yVXNlcklkOiBzdHJpbmcsIGNsaWVudE11dGF0aW9uSWQ/OiAoKSA9PiBzdHJpbmcsIGVuYWJsZWQ/OiBib29sZWFuLCBtdXRhdGlvbkxvZzogaW1wb3J0KFwiLi4vc3luYy9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuZGVmYXVsdCwgbm93PzogKCkgPT4gRGF0ZSwgb2ZmbGluZUdyYW50OiB7aWQ6IHN0cmluZ319fSBbb2ZmbGluZVN5bmNdIC0gT2ZmbGluZSBtdXRhdGlvbiBxdWV1ZSBjb25maWd1cmF0aW9uLlxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxJZGxlV2FpdEFyZ3MgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxJZGxlV2FpdEFyZ3NcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbcXVpZXRNc10gLSBNaWxsaXNlY29uZHMgdGhlIHRyYW5zcG9ydCBtdXN0IHN0YXkgaWRsZSBiZWZvcmUgcmVzb2x2aW5nLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFt0aW1lb3V0XSAtIFRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzLlxuICovXG5cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IGNvbmZpZy5cbiAqIEB0eXBlIHtGcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnfSAqL1xuY29uc3QgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZyA9IHt9XG5jb25zdCBTSEFSRURfRlJPTlRFTkRfTU9ERUxfQVBJX1BBVEggPSBcIi9mcm9udGVuZC1tb2RlbHNcIlxuY29uc3QgUFJFTE9BREVEX1JFTEFUSU9OU0hJUFNfS0VZID0gXCJfX3ByZWxvYWRlZFJlbGF0aW9uc2hpcHNcIlxuY29uc3QgU0VMRUNURURfQVRUUklCVVRFU19LRVkgPSBcIl9fc2VsZWN0ZWRBdHRyaWJ1dGVzXCJcbmNvbnN0IEFTU09DSUFUSU9OX0NPVU5UU19LRVkgPSBcIl9fYXNzb2NpYXRpb25Db3VudHNcIlxuY29uc3QgUVVFUllfREFUQV9LRVkgPSBcIl9fcXVlcnlEYXRhXCJcbmNvbnN0IEFCSUxJVElFU19LRVkgPSBcIl9fYWJpbGl0aWVzXCJcbmNvbnN0IEFUVEFDSE1FTlRfT1dORVJfS0VZID0gXCJfX2F0dGFjaG1lbnRPd25lclwiXG4vKipcbiAqIFBlbmRpbmcgc2hhcmVkIGZyb250ZW5kIG1vZGVsIHJlcXVlc3RzLlxuICogQHR5cGUge0FycmF5PHtjb21tYW5kTmFtZT86IHN0cmluZywgY29tbWFuZFR5cGU6IEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29tbWFuZFR5cGUsIGN1c3RvbVBhdGg/OiBzdHJpbmcsIG1vZGVsQ2xhc3M6IEZyb250ZW5kTW9kZWxDbGFzcywgcGF5bG9hZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCByZXF1ZXN0Q29udGV4dDogaW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dCwgcmVxdWVzdElkOiBzdHJpbmcsIHJlc29sdmU6IChyZXNwb25zZTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiB2b2lkLCByZWplY3Q6IChlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHZvaWQsIHJlc291cmNlUGF0aD86IHN0cmluZyB8IG51bGx9Pn0gKi9cbmxldCBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzID0gW11cblxubGV0IHNoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0SWQgPSAwXG5sZXQgc2hhcmVkRnJvbnRlbmRNb2RlbEZsdXNoU2NoZWR1bGVkID0gZmFsc2VcbmxldCBhY3RpdmVGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdENvdW50ID0gMFxuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCBpZGxlIHJlc29sdmVycy5cbiAqIEB0eXBlIHtBcnJheTwoKSA9PiB2b2lkPn0gKi9cbmxldCBmcm9udGVuZE1vZGVsSWRsZVJlc29sdmVycyA9IFtdXG5cbi8qKlxuICogSW50ZXJuYWwgd2Vic29ja2V0IGNsaWVudC5cbiAqIEB0eXBlIHtWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQgfCBudWxsfSAqL1xubGV0IGludGVybmFsV2Vic29ja2V0Q2xpZW50ID0gbnVsbFxuLyoqIEB0eXBlIHtBYm9ydFNpZ25hbCB8IG51bGx9ICovXG5sZXQgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwgPSBudWxsXG4vKiogQHR5cGUgeygoKSA9PiB2b2lkKSB8IG51bGx9ICovXG5sZXQgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwID0gbnVsbFxuXG4vKipcbiAqIERldGFjaGVzIGFuIG93bmVkIFdlYlNvY2tldCBjbGllbnQgZnJvbSB0aGUgc2hhcmVkIGNhY2hlIGlmIGl0IGlzIHN0aWxsIGN1cnJlbnQuXG4gKiBAcGFyYW0ge1ZlbG9jaW91c1dlYnNvY2tldENsaWVudH0gY2xpZW50IC0gQ2xpZW50IHdob3NlIG93bmVyc2hpcCBpcyBlbmRpbmcuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gZGV0YWNoSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoY2xpZW50KSB7XG4gIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cblxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudCA9IG51bGxcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwPy4oKVxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbCA9IG51bGxcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwID0gbnVsbFxufVxuXG4vKipcbiAqIERpc3Bvc2VzIHRoZSBvd25lZCBXZWJTb2NrZXQgY2xpZW50IGJlZm9yZSB0cmFuc3BvcnQvc2Vzc2lvbiBjb25maWd1cmF0aW9uIGNoYW5nZXMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gcmVzZXRJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpIHtcbiAgY29uc3QgY2xpZW50ID0gaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRcblxuICBpZiAoIWNsaWVudCkgcmV0dXJuXG5cbiAgZGV0YWNoSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoY2xpZW50KVxuICB2b2lkIGNsaWVudC5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG59XG5cbi8qKlxuICogQmluZHMgdGhlIG93bmVkIFdlYlNvY2tldCBjbGllbnQgbGlmZXRpbWUgdG8gdGhlIGN1cnJlbnQgc2Vzc2lvbiBzaWduYWwuXG4gKiBAcGFyYW0ge0Fib3J0U2lnbmFsIHwgdW5kZWZpbmVkfSBzZXNzaW9uU2lnbmFsIC0gQ3VycmVudCBzZXNzaW9uIHNpZ25hbC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBiaW5kSW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwoc2Vzc2lvblNpZ25hbCkge1xuICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwgPT09IHNlc3Npb25TaWduYWwpIHJldHVyblxuXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cD8uKClcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwgPSBzZXNzaW9uU2lnbmFsIHx8IG51bGxcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwID0gbnVsbFxuXG4gIGlmICghc2Vzc2lvblNpZ25hbCB8fCAhaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQpIHJldHVyblxuXG4gIGNvbnN0IGNsaWVudCA9IGludGVybmFsV2Vic29ja2V0Q2xpZW50XG4gIGNvbnN0IG9uU2Vzc2lvbkFib3J0ID0gKCkgPT4ge1xuICAgIGRldGFjaEludGVybmFsV2Vic29ja2V0Q2xpZW50KGNsaWVudClcbiAgICBjbGVhckJ1ZmZlcmVkT3V0Z29pbmdFdmVudHMoKVxuICAgIHZvaWQgY2xpZW50LmRpc2Nvbm5lY3RBbmRTdG9wUmVjb25uZWN0KClcbiAgfVxuXG4gIHNlc3Npb25TaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIG9uU2Vzc2lvbkFib3J0LCB7b25jZTogdHJ1ZX0pXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cCA9ICgpID0+IHNlc3Npb25TaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIG9uU2Vzc2lvbkFib3J0KVxuXG4gIGlmIChzZXNzaW9uU2lnbmFsLmFib3J0ZWQpIG9uU2Vzc2lvbkFib3J0KClcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBpcyBpZGxlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbGwgcXVldWVkIGFuZCBhY3RpdmUgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHJlcXVlc3RzIGFyZSBkb25lLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0SXNJZGxlKCkge1xuICByZXR1cm4gYWN0aXZlRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3RDb3VudCA9PT0gMFxuICAgICYmIHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMubGVuZ3RoID09PSAwXG4gICAgJiYgIXNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZFxufVxuXG4vKipcbiAqIFJ1bnMgcmVzb2x2ZSBmcm9udGVuZCBtb2RlbCBpZGxlIHdhaXRlcnMuXG4gKiBAcmV0dXJucyB7dm9pZH0gKi9cbmZ1bmN0aW9uIHJlc29sdmVGcm9udGVuZE1vZGVsSWRsZVdhaXRlcnMoKSB7XG4gIGlmICghZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpKSByZXR1cm5cblxuICBjb25zdCByZXNvbHZlcnMgPSBmcm9udGVuZE1vZGVsSWRsZVJlc29sdmVyc1xuICBmcm9udGVuZE1vZGVsSWRsZVJlc29sdmVycyA9IFtdXG5cbiAgZm9yIChjb25zdCByZXNvbHZlIG9mIHJlc29sdmVycykge1xuICAgIHJlc29sdmUoKVxuICB9XG59XG5cbi8qKlxuICogUnVucyB3YWl0IGZvciBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgcXVpZXQgcGVyaW9kLlxuICogQHBhcmFtIHtudW1iZXJ9IG1pbGxpc2Vjb25kcyAtIFF1aWV0IHBlcmlvZCBsZW5ndGguXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHF1aWV0IHBlcmlvZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gd2FpdEZvckZyb250ZW5kTW9kZWxUcmFuc3BvcnRRdWlldFBlcmlvZChtaWxsaXNlY29uZHMpIHtcbiAgaWYgKG1pbGxpc2Vjb25kcyA8PSAwKSByZXR1cm5cblxuICBhd2FpdCB3YWl0KG1pbGxpc2Vjb25kcylcbn1cblxuLyoqXG4gKiBSdW5zIHdhaXQgZm9yIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBpZGxlLlxuICogQHBhcmFtIHtudW1iZXJ9IHF1aWV0TXMgLSBNaWxsaXNlY29uZHMgdGhlIHRyYW5zcG9ydCBtdXN0IHN0YXkgaWRsZSBiZWZvcmUgcmVzb2x2aW5nLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gdHJhbnNwb3J0IHN0YXlzIGlkbGUuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JGcm9udGVuZE1vZGVsVHJhbnNwb3J0SWRsZShxdWlldE1zID0gMCkge1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIGlmIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0SXNJZGxlKCkpIHtcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBxdWV1ZU1pY3JvdGFzaygoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpKVxuXG4gICAgICBpZiAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpKSB7XG4gICAgICAgIGF3YWl0IHdhaXRGb3JGcm9udGVuZE1vZGVsVHJhbnNwb3J0UXVpZXRQZXJpb2QocXVpZXRNcylcblxuICAgICAgICBpZiAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpKSByZXR1cm5cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgZnJvbnRlbmRNb2RlbElkbGVSZXNvbHZlcnMucHVzaCgoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpXG4gICAgICB9KVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgdHJhY2sgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHJlcXVlc3QuXG4gKiBAdGVtcGxhdGUgVFxuICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zcG9ydCBjYWxsYmFjay5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gdHJhY2tGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdChjYWxsYmFjaykge1xuICBhY3RpdmVGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdENvdW50ICs9IDFcblxuICB0cnkge1xuICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gIH0gZmluYWxseSB7XG4gICAgYWN0aXZlRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3RDb3VudCAtPSAxXG4gICAgcmVzb2x2ZUZyb250ZW5kTW9kZWxJZGxlV2FpdGVycygpXG4gIH1cbn1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBpbnRlcm5hbCB3ZWJzb2NrZXQgY2xpZW50IGZyb20gd2Vic29ja2V0VXJsIGNvbmZpZy5cbiAqIENyZWF0ZXMgdGhlIGNsaWVudCBsYXppbHkgb24gZmlyc3QgY2FsbC4gUmV0dXJucyBudWxsIGlmIFdlYlNvY2tldFxuICogaXMgbm90IGF2YWlsYWJsZSBvciB3ZWJzb2NrZXRVcmwgaXMgbm90IGNvbmZpZ3VyZWQuXG4gKiBAcmV0dXJucyB7VmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50IHwgbnVsbH0gV2Vic29ja2V0IGNsaWVudCBvciBudWxsLlxuICovXG5mdW5jdGlvbiByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSB7XG4gIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCkge1xuICAgIGNvbnN0IGNsaWVudCA9IGludGVybmFsV2Vic29ja2V0Q2xpZW50XG5cbiAgICBiaW5kSW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpKVxuXG4gICAgcmV0dXJuIGNsaWVudFxuICB9XG5cbiAgY29uc3Qgd2Vic29ja2V0VXJsID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRVcmxcblxuICBpZiAoIXdlYnNvY2tldFVybCkgcmV0dXJuIG51bGxcbiAgaWYgKHR5cGVvZiBnbG9iYWxUaGlzLldlYlNvY2tldCA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIG51bGxcblxuICBjb25zdCByZXNvbHZlZFVybCA9IHR5cGVvZiB3ZWJzb2NrZXRVcmwgPT09IFwiZnVuY3Rpb25cIiA/IHdlYnNvY2tldFVybCgpIDogd2Vic29ja2V0VXJsXG5cbiAgaWYgKCFyZXNvbHZlZFVybCkgcmV0dXJuIG51bGxcblxuICBjb25zdCBjbGllbnQgPSBuZXcgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50KHtcbiAgICBhdXRvUmVjb25uZWN0OiB0cnVlLFxuICAgIHNlc3Npb25TdG9yZTogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zZXNzaW9uU3RvcmUsXG4gICAgdXJsOiByZXNvbHZlZFVybFxuICB9KVxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudCA9IGNsaWVudFxuICBjbGllbnQub25SZWNvbm5lY3QgPSBhc3luYyAoKSA9PiBhd2FpdCBmbHVzaEJ1ZmZlcmVkT3V0Z29pbmdFdmVudHNBZnRlclJlY29ubmVjdChjbGllbnQpXG5cbiAgYmluZEludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSlcblxuICByZXR1cm4gY2xpZW50XG59XG5cbi8qKlxuICogUnVucyBmbHVzaCBidWZmZXJlZCBvdXRnb2luZyBldmVudHMgYWZ0ZXIgcmVjb25uZWN0LlxuICogQHBhcmFtIHtWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnR9IGNsaWVudCAtIFJlY29ubmVjdGVkIGNsaWVudCB0aGF0IG93bnMgdGhpcyBmbHVzaC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAqL1xuYXN5bmMgZnVuY3Rpb24gZmx1c2hCdWZmZXJlZE91dGdvaW5nRXZlbnRzQWZ0ZXJSZWNvbm5lY3QoY2xpZW50KSB7XG4gIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cblxuICBjb25zdCBldmVudHMgPSBkcmFpbkJ1ZmZlcmVkT3V0Z29pbmdFdmVudHMoKVxuICBjb25zdCBzZXNzaW9uU2lnbmFsID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpXG5cbiAgYXdhaXQgcnVuV2l0aFRyYW5zcG9ydERlYWRsaW5lKFxuICAgIHtcbiAgICAgIGVycm9yTWVzc2FnZTogXCJCdWZmZXJlZCBmcm9udGVuZC1tb2RlbCBXZWJTb2NrZXQgZmx1c2ggdGltZWQgb3V0XCIsXG4gICAgICBzaWduYWw6IHNlc3Npb25TaWduYWwsXG4gICAgICB0aW1lb3V0TXM6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lb3V0TXMoKVxuICAgIH0sXG4gICAgYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGV2ZW50cy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgICAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50ICE9PSBjbGllbnQpIHJldHVyblxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgY2xpZW50LnBvc3QoZXZlbnRzW2luZGV4XS5jdXN0b21QYXRoLCBldmVudHNbaW5kZXhdLnBheWxvYWQsIHtzaWduYWx9KVxuXG4gICAgICAgICAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50ICE9PSBjbGllbnQpIHJldHVyblxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgIT09IGNsaWVudCkgcmV0dXJuXG4gICAgICAgICAgaWYgKHNlc3Npb25TaWduYWw/LmFib3J0ZWQpIHJldHVyblxuXG4gICAgICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgICAgICBmb3IgKGxldCByZW1haW5pbmcgPSBpbmRleDsgcmVtYWluaW5nIDwgZXZlbnRzLmxlbmd0aDsgcmVtYWluaW5nICs9IDEpIHtcbiAgICAgICAgICAgICAgYnVmZmVyT3V0Z29pbmdFdmVudChldmVudHNbcmVtYWluaW5nXSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3Qgc29ja2V0T3BlbiA9IGNsaWVudC5zb2NrZXQ/LnJlYWR5U3RhdGUgPT09IGNsaWVudC5zb2NrZXQ/Lk9QRU5cblxuICAgICAgICAgIGlmIChzb2NrZXRPcGVuKSBjb250aW51ZVxuXG4gICAgICAgICAgZm9yIChsZXQgcmVtYWluaW5nID0gaW5kZXg7IHJlbWFpbmluZyA8IGV2ZW50cy5sZW5ndGg7IHJlbWFpbmluZyArPSAxKSB7XG4gICAgICAgICAgICBidWZmZXJPdXRnb2luZ0V2ZW50KGV2ZW50c1tyZW1haW5pbmddKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICApXG59XG5cbi8qKlxuICogUnVucyBkZWZhdWx0IGZyb250ZW5kIG1vZGVsIHJlc291cmNlIHBhdGguXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBEZWZhdWx0IHJlc291cmNlIHBhdGggZm9yIHRoZSBtb2RlbCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gZGVmYXVsdEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgobW9kZWxDbGFzcykge1xuICByZXR1cm4gYC8ke2luZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24ucGx1cmFsaXplKGluZmxlY3Rpb24udW5kZXJzY29yZShtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpKSkpfWBcbn1cblxuLyoqIEVycm9yIHJhaXNlZCB3aGVuIHJlYWRpbmcgYW4gYXR0cmlidXRlIHRoYXQgd2FzIG5vdCBzZWxlY3RlZCBpbiBxdWVyeSBwYXlsb2Fkcy4gKi9cbmV4cG9ydCBjbGFzcyBBdHRyaWJ1dGVOb3RTZWxlY3RlZEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIHRoYXQgd2FzIHJlcXVlc3RlZC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG1vZGVsTmFtZSwgYXR0cmlidXRlTmFtZSkge1xuICAgIHN1cGVyKGAke21vZGVsTmFtZX0jJHthdHRyaWJ1dGVOYW1lfSB3YXMgbm90IHNlbGVjdGVkYClcbiAgICB0aGlzLm5hbWUgPSBcIkF0dHJpYnV0ZU5vdFNlbGVjdGVkRXJyb3JcIlxuICB9XG59XG5cbi8qKlxuICogTGlnaHR3ZWlnaHQgc2luZ3VsYXIgcmVsYXRpb25zaGlwIHN0YXRlIGhvbGRlciBmb3IgZnJvbnRlbmQgbW9kZWwgaW5zdGFuY2VzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gU1xuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gVFxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzPVJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT5dXG4gKi9cbmV4cG9ydCBjbGFzcyBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXAge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBQYXJlbnQgbW9kZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzPEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz4gfCBudWxsfSB0YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgY29uc3RydWN0b3IobW9kZWwsIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICB0aGlzLm1vZGVsID0gbW9kZWxcbiAgICB0aGlzLnJlbGF0aW9uc2hpcE5hbWUgPSByZWxhdGlvbnNoaXBOYW1lXG4gICAgdGhpcy50YXJnZXRNb2RlbENsYXNzID0gdGFyZ2V0TW9kZWxDbGFzc1xuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsfSAqL1xuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGxvYWRlZC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsIHwgdW5kZWZpbmVkfSBsb2FkZWRWYWx1ZSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0TG9hZGVkKGxvYWRlZFZhbHVlKSB7XG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBsb2FkZWRWYWx1ZSA9PSB1bmRlZmluZWQgPyBudWxsIDogbG9hZGVkVmFsdWVcbiAgICB0aGlzLl9wcmVsb2FkZWQgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcHJlbG9hZGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlbGF0aW9uc2hpcCBpcyBwcmVsb2FkZWQuXG4gICAqL1xuICBnZXRQcmVsb2FkZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3ByZWxvYWRlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZGVkLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbH0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgbG9hZGVkKCkge1xuICAgIGlmICghdGhpcy5fcHJlbG9hZGVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX0gaGFzbid0IGJlZW4gcHJlbG9hZGVkYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fbG9hZGVkVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3BpZXMgbG9hZGVkIHZhbHVlIGZyb20gYW5vdGhlciBzaW5ndWxhciByZWxhdGlvbnNoaXAgaGVscGVyLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXB9IHNvdXJjZVJlbGF0aW9uc2hpcCAtIFNvdXJjZSByZWxhdGlvbnNoaXAgaGVscGVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNvcHlMb2FkZWRGcm9tKHNvdXJjZVJlbGF0aW9uc2hpcCkge1xuICAgIGlmIChzb3VyY2VSZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IHNvdXJjZSByZWxhdGlvbnNoaXAgdG8gYmUgc2luZ3VsYXJgKVxuICAgIH1cblxuICAgIC8vIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIHRhcmdldCByZWxhdGlvbnNoaXAncyBkb2N1bWVudGVkIG1vZGVsIHR5cGUuXG4gICAgY29uc3QgbG9hZGVkVmFsdWUgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGx9ICovIChzb3VyY2VSZWxhdGlvbnNoaXAubG9hZGVkKCkpXG5cbiAgICB0aGlzLnNldExvYWRlZChsb2FkZWRWYWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkLlxuICAgKiBAcGFyYW0ge1RhcmdldENyZWF0ZUF0dHJpYnV0ZXN9IFthdHRyaWJ1dGVzXSAtIE5ldyBtb2RlbCBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+fSAtIEJ1aWx0IG1vZGVsLlxuICAgKi9cbiAgYnVpbGQoYXR0cmlidXRlcyA9IC8qKiBAdHlwZSB7VGFyZ2V0Q3JlYXRlQXR0cmlidXRlc30gKi8gKHt9KSkge1xuICAgIGlmICghdGhpcy50YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyBjb25maWd1cmVkIGZvciAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtuZXcgKGF0dHJpYnV0ZXM/OiBUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzKSA9PiBGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD59ICovICh0aGlzLnRhcmdldE1vZGVsQ2xhc3MpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcyhhdHRyaWJ1dGVzKVxuXG4gICAgdGhpcy5zZXRMb2FkZWQobW9kZWwpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3JjZS1yZWxvYWQgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIGxvYWQoKSB7XG4gICAgdGhpcy5fcHJlbG9hZGVkID0gZmFsc2VcbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IG51bGxcblxuICAgIGNvbnN0IGJhdGNoZWQgPSBhd2FpdCB0aGlzLm1vZGVsLl90cnlDb2hvcnRQcmVsb2FkKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChiYXRjaGVkKSByZXR1cm4gdGhpcy5sb2FkZWQoKVxuXG4gICAgYXdhaXQgdGhpcy5tb2RlbC5sb2FkUmVsYXRpb25zaGlwKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIHJldHVybiB0aGlzLmxvYWRlZCgpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbG9hZGVkIHJlbGF0aW9uc2hpcCBvciBsb2FkcyBpdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIG9yTG9hZCgpIHtcbiAgICBpZiAodGhpcy5nZXRQcmVsb2FkZWQoKSkgcmV0dXJuIHRoaXMubG9hZGVkKClcblxuICAgIGNvbnN0IGJhdGNoZWQgPSBhd2FpdCB0aGlzLm1vZGVsLl90cnlDb2hvcnRQcmVsb2FkKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChiYXRjaGVkKSByZXR1cm4gdGhpcy5sb2FkZWQoKVxuXG4gICAgYXdhaXQgdGhpcy5tb2RlbC5sb2FkUmVsYXRpb25zaGlwKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIHJldHVybiB0aGlzLmxvYWRlZCgpXG4gIH1cbn1cblxuLyoqXG4gKiBMaWdodHdlaWdodCBoYXMtbWFueSByZWxhdGlvbnNoaXAgc3RhdGUgaG9sZGVyIGZvciBmcm9udGVuZCBtb2RlbCBpbnN0YW5jZXMuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnk+IHwgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlfSBTXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnk+IHwgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlfSBUXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW1RhcmdldENyZWF0ZUF0dHJpYnV0ZXM9UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPl1cbiAqL1xuZXhwb3J0IGNsYXNzIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwIHtcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj59ICovXG4gIF9sb2FkZWRWYWx1ZVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIFBhcmVudCBtb2RlbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3M8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+LCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzPiB8IG51bGx9IHRhcmdldE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcihtb2RlbCwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgIHRoaXMubW9kZWwgPSBtb2RlbFxuICAgIHRoaXMucmVsYXRpb25zaGlwTmFtZSA9IHJlbGF0aW9uc2hpcE5hbWVcbiAgICB0aGlzLnRhcmdldE1vZGVsQ2xhc3MgPSB0YXJnZXRNb2RlbENsYXNzXG4gICAgdGhpcy5fcHJlbG9hZGVkID0gZmFsc2VcbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IFtdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbG9hZGVkLlxuICAgKiBAcGFyYW0ge0FycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj59IGxvYWRlZFZhbHVlIC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRMb2FkZWQobG9hZGVkVmFsdWUpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkobG9hZGVkVmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX0gdG8gYmUgbG9hZGVkIHdpdGggYW4gYXJyYXlgKVxuICAgIH1cblxuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gbG9hZGVkVmFsdWVcbiAgICB0aGlzLl9wcmVsb2FkZWQgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcHJlbG9hZGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlbGF0aW9uc2hpcCBpcyBwcmVsb2FkZWQuXG4gICAqL1xuICBnZXRQcmVsb2FkZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3ByZWxvYWRlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZGVkLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlcy5cbiAgICovXG4gIGxvYWRlZCgpIHtcbiAgICBpZiAoIXRoaXMuX3ByZWxvYWRlZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IGhhc24ndCBiZWVuIHByZWxvYWRlZGApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2xvYWRlZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ29waWVzIGxvYWRlZCB2YWx1ZSBmcm9tIGFub3RoZXIgaGFzLW1hbnkgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSBzb3VyY2VSZWxhdGlvbnNoaXAgLSBTb3VyY2UgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjb3B5TG9hZGVkRnJvbShzb3VyY2VSZWxhdGlvbnNoaXApIHtcbiAgICBpZiAoIShzb3VyY2VSZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSBzb3VyY2UgcmVsYXRpb25zaGlwIHRvIGJlIGhhcy1tYW55YClcbiAgICB9XG5cbiAgICAvLyBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSB0YXJnZXQgcmVsYXRpb25zaGlwJ3MgZG9jdW1lbnRlZCBtb2RlbCB0eXBlLlxuICAgIGNvbnN0IGxvYWRlZFZhbHVlID0gLyoqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSAqLyAoc291cmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpKVxuXG4gICAgdGhpcy5zZXRMb2FkZWQobG9hZGVkVmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgdG8gbG9hZGVkLlxuICAgKiBAcGFyYW0ge0FycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj59IG1vZGVscyAtIE1vZGVscyB0byBhcHBlbmQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkVG9Mb2FkZWQobW9kZWxzKSB7XG4gICAgY29uc3QgbG9hZGVkTW9kZWxzID0gdGhpcy5nZXRQcmVsb2FkZWQoKSA/IHRoaXMubG9hZGVkKCkgOiBbXVxuXG4gICAgdGhpcy5zZXRMb2FkZWQoWy4uLmxvYWRlZE1vZGVscywgLi4ubW9kZWxzXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkLlxuICAgKiBAcGFyYW0ge1RhcmdldENyZWF0ZUF0dHJpYnV0ZXN9IFthdHRyaWJ1dGVzXSAtIE5ldyBtb2RlbCBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+fSAtIEJ1aWx0IG1vZGVsLlxuICAgKi9cbiAgYnVpbGQoYXR0cmlidXRlcyA9IC8qKiBAdHlwZSB7VGFyZ2V0Q3JlYXRlQXR0cmlidXRlc30gKi8gKHt9KSkge1xuICAgIGlmICghdGhpcy50YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyBjb25maWd1cmVkIGZvciAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtuZXcgKGF0dHJpYnV0ZXM/OiBUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzKSA9PiBGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD59ICovICh0aGlzLnRhcmdldE1vZGVsQ2xhc3MpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcyhhdHRyaWJ1dGVzKVxuXG4gICAgdGhpcy5hZGRUb0xvYWRlZChbbW9kZWxdKVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogRm9yY2UtcmVsb2FkIHRoZSByZWxhdGlvbnNoaXAuIFdoZW4gdGhlIHBhcmVudCByZWNvcmQgd2FzIGxvYWRlZCBhcyBwYXJ0XG4gICAqIG9mIGEgYmF0Y2gsIHNpYmxpbmdzIHRoYXQgaGF2ZSBub3QgcHJlbG9hZGVkIHRoaXMgcmVsYXRpb25zaGlwIGdldFxuICAgKiBiYXRjaGVkIGludG8gb25lIHJlcXVlc3QgdmlhIHRoZSBjb2hvcnQgcHJlbG9hZGVyLiBUaGUgc2NvcGVkIHF1ZXJ5IHBhdGhcbiAgICogKGBNb2RlbC53aGVyZSguLi4pLnByZWxvYWQoW25hbWVdKS50b0FycmF5KClgIGRpcmVjdGx5IGZyb20gdXNlciBjb2RlKVxuICAgKiBieXBhc3NlcyBjb2hvcnQgYmF0Y2hpbmcgYnkgZGVzaWduLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+Pn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIG1vZGVscy5cbiAgICovXG4gIGFzeW5jIGxvYWQoKSB7XG4gICAgLy8gUmVzZXQgc28gdGhlIGNvaG9ydCBwcmVsb2FkZXIgKG9yIHNpbmdsZS1yZWNvcmQgZmFsbGJhY2spIHJlcG9wdWxhdGVzLlxuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBbXVxuXG4gICAgY29uc3QgYmF0Y2hlZCA9IGF3YWl0IHRoaXMubW9kZWwuX3RyeUNvaG9ydFByZWxvYWQodGhpcy5yZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKGJhdGNoZWQpIHJldHVybiB0aGlzLl9sb2FkZWRWYWx1ZVxuXG4gICAgYXdhaXQgdGhpcy5tb2RlbC5sb2FkUmVsYXRpb25zaGlwKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIHJldHVybiB0aGlzLmxvYWRlZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBhcnJheS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBtb2RlbHMuXG4gICAqL1xuICBhc3luYyB0b0FycmF5KCkge1xuICAgIGlmICh0aGlzLmdldFByZWxvYWRlZCgpIHx8IHRoaXMuX2xvYWRlZFZhbHVlLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiB0aGlzLl9sb2FkZWRWYWx1ZVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmxvYWQoKVxuICB9XG59XG5cbi8qKlxuICogQ29waWVzIGxvYWRlZCByZWxhdGlvbnNoaXAgc3RhdGUgYmV0d2VlbiBoZWxwZXJzIG9mIHRoZSBzYW1lIHJlbGF0aW9uc2hpcCBzaGFwZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSBhcmdzLnNvdXJjZVJlbGF0aW9uc2hpcCAtIFNvdXJjZSByZWxhdGlvbnNoaXAgaGVscGVyLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSBhcmdzLnRhcmdldFJlbGF0aW9uc2hpcCAtIFRhcmdldCByZWxhdGlvbnNoaXAgaGVscGVyLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGNvcHlMb2FkZWRSZWxhdGlvbnNoaXBWYWx1ZSh7c291cmNlUmVsYXRpb25zaGlwLCB0YXJnZXRSZWxhdGlvbnNoaXB9KSB7XG4gIHRhcmdldFJlbGF0aW9uc2hpcC5jb3B5TG9hZGVkRnJvbShzb3VyY2VSZWxhdGlvbnNoaXApXG59XG5cbi8qKlxuICogUnVucyByZWxhdGlvbnNoaXAgdHlwZSBpcyBjb2xsZWN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcFR5cGUgLSBSZWxhdGlvbnNoaXAgdHlwZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcmVsYXRpb25zaGlwIHR5cGUgaXMgaGFzLW1hbnkuXG4gKi9cbmZ1bmN0aW9uIHJlbGF0aW9uc2hpcFR5cGVJc0NvbGxlY3Rpb24ocmVsYXRpb25zaGlwVHlwZSkge1xuICByZXR1cm4gcmVsYXRpb25zaGlwVHlwZSA9PSBcImhhc01hbnlcIlxufVxuXG4vKipcbiAqIERvd25sb2FkZWQgZnJvbnRlbmQtbW9kZWwgYXR0YWNobWVudCBwYXlsb2FkIHdyYXBwZXIuXG4gKi9cbmV4cG9ydCBjbGFzcyBGcm9udGVuZE1vZGVsQXR0YWNobWVudERvd25sb2FkIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaWQgLSBBdHRhY2htZW50IGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5maWxlbmFtZSAtIEZpbGVuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGFyZ3MuY29udGVudFR5cGUgLSBDb250ZW50IHR5cGUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmJ5dGVTaXplIC0gRmlsZSBzaXplIGluIGJ5dGVzLlxuICAgKiBAcGFyYW0ge1VpbnQ4QXJyYXl9IGFyZ3MuY29udGVudCAtIEZpbGUgY29udGVudCBieXRlcy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBbYXJncy51cmxdIC0gUmVzb2x2YWJsZSBhdHRhY2htZW50IFVSTC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtieXRlU2l6ZSwgY29udGVudCwgY29udGVudFR5cGUsIGZpbGVuYW1lLCBpZCwgdXJsID0gbnVsbH0pIHtcbiAgICB0aGlzLmlkVmFsdWUgPSBpZFxuICAgIHRoaXMuZmlsZW5hbWVWYWx1ZSA9IGZpbGVuYW1lXG4gICAgdGhpcy5jb250ZW50VHlwZVZhbHVlID0gY29udGVudFR5cGVcbiAgICB0aGlzLmJ5dGVTaXplVmFsdWUgPSBieXRlU2l6ZVxuICAgIHRoaXMuY29udGVudFZhbHVlID0gY29udGVudFxuICAgIHRoaXMudXJsVmFsdWUgPSB1cmxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ5dGUgc2l6ZS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBGaWxlIHNpemUgaW4gYnl0ZXMuXG4gICAqL1xuICBieXRlU2l6ZSgpIHsgcmV0dXJuIHRoaXMuYnl0ZVNpemVWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIGNvbnRlbnQuXG4gICAqIEByZXR1cm5zIHtVaW50OEFycmF5fSAtIEZpbGUgY29udGVudCBieXRlcy5cbiAgICovXG4gIGNvbnRlbnQoKSB7IHJldHVybiB0aGlzLmNvbnRlbnRWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIGNvbnRlbnQgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gQ29udGVudCB0eXBlLlxuICAgKi9cbiAgY29udGVudFR5cGUoKSB7IHJldHVybiB0aGlzLmNvbnRlbnRUeXBlVmFsdWUgfVxuICAvKipcbiAgICogUnVucyBmaWxlbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGaWxlbmFtZS5cbiAgICovXG4gIGZpbGVuYW1lKCkgeyByZXR1cm4gdGhpcy5maWxlbmFtZVZhbHVlIH1cbiAgLyoqXG4gICAqIFJ1bnMgaWQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0YWNobWVudCBpZC5cbiAgICovXG4gIGlkKCkgeyByZXR1cm4gdGhpcy5pZFZhbHVlIH1cbiAgLyoqXG4gICAqIFJ1bnMgdXJsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBSZXNvbHZhYmxlIGF0dGFjaG1lbnQgVVJMLlxuICAgKi9cbiAgdXJsKCkgeyByZXR1cm4gdGhpcy51cmxWYWx1ZSB9XG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBhdHRhY2htZW50IGNvbW1hbmQgcGF5bG9hZC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGV9IGF0dGFjaG1lbnQgLSBBdHRhY2htZW50IHdyYXBwZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gW2F0dGFjaG1lbnRJZF0gLSBPcHRpb25hbCBoYXMtbWFueSBhdHRhY2htZW50IGlkLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDb21tYW5kIHBheWxvYWQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29tbWFuZFBheWxvYWQoYXR0YWNobWVudCwgYXR0YWNobWVudElkKSB7XG4gIC8qKlxuICAgKiBQYXlsb2FkLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCBwYXlsb2FkID0ge1xuICAgIGF0dGFjaG1lbnROYW1lOiBhdHRhY2htZW50LmF0dGFjaG1lbnROYW1lLFxuICAgIGlkOiBhdHRhY2htZW50Lm1vZGVsLnByaW1hcnlLZXlWYWx1ZSgpXG4gIH1cblxuICBpZiAoYXR0YWNobWVudElkKSBwYXlsb2FkLmF0dGFjaG1lbnRJZCA9IGF0dGFjaG1lbnRJZFxuXG4gIHJldHVybiBwYXlsb2FkXG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgY2Fub25pY2FsIGJhY2tpbmcgb3duZXIgdXNlZCBieSBhdHRhY2htZW50IG1ldGFkYXRhIHN0b3JhZ2UuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIEZyb250ZW5kIGF0dGFjaG1lbnQgb3duZXIuXG4gKiBAcmV0dXJucyB7e3JlY29yZElkOiBzdHJpbmcsIHJlY29yZFR5cGU6IHN0cmluZywgcmVzb3VyY2VOYW1lOiBzdHJpbmd9fSAtIENhbm9uaWNhbCBhdHRhY2htZW50IG93bmVyIGFuZCBvcmlnaW5hdGluZyByZXNvdXJjZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRPd25lcihtb2RlbCkge1xuICBpZiAoIW1vZGVsLl9hdHRhY2htZW50T3duZXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgYXR0YWNobWVudCBvd25lciBtZXRhZGF0YSBvbiAke2Zyb250ZW5kTW9kZWxDbGFzc0Zvcihtb2RlbCkubmFtZX1gKVxuICB9XG5cbiAgcmV0dXJuIG1vZGVsLl9hdHRhY2htZW50T3duZXJcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgdmFsdWUgaXMgYnl0ZXMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWUgbG9va3MgbGlrZSBieXRlIGRhdGEuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNCeXRlcyh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgaW5zdGFuY2VvZiBVaW50OEFycmF5IHx8IHZhbHVlIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIgfHwgKHR5cGVvZiBCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIgJiYgQnVmZmVyLmlzQnVmZmVyKHZhbHVlKSlcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgdmFsdWUgc3VwcG9ydHMgYXJyYXkgYnVmZmVyLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7dmFsdWUgaXMge2FycmF5QnVmZmVyOiAoKSA9PiBQcm9taXNlPEFycmF5QnVmZmVyPn19IC0gV2hldGhlciBjYW5kaWRhdGUgc3VwcG9ydHMgYXJyYXlCdWZmZXIoKS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50VmFsdWVTdXBwb3J0c0FycmF5QnVmZmVyKHZhbHVlKSB7XG4gIHJldHVybiBCb29sZWFuKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHZhbHVlKS5hcnJheUJ1ZmZlciA9PT0gXCJmdW5jdGlvblwiKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgYXR0YWNobWVudCBub3JtYWxpemUgYnl0ZXMuXG4gKiBAcGFyYW0ge1VpbnQ4QXJyYXkgfCBCdWZmZXIgfCBBcnJheUJ1ZmZlcn0gdmFsdWUgLSBCeXRlLWxpa2UgdmFsdWUuXG4gKiBAcmV0dXJucyB7VWludDhBcnJheX0gLSBVaW50OEFycmF5IGJ5dGVzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZEF0dGFjaG1lbnROb3JtYWxpemVCeXRlcyh2YWx1ZSkge1xuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBVaW50OEFycmF5KSByZXR1cm4gdmFsdWVcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHJldHVybiBuZXcgVWludDhBcnJheSh2YWx1ZSlcbiAgaWYgKHR5cGVvZiBCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIgJiYgQnVmZmVyLmlzQnVmZmVyKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh2YWx1ZSkpKSB7XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KC8qKiBAdHlwZSB7QnVmZmVyfSAqLyAodmFsdWUpKVxuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiVW5zdXBwb3J0ZWQgYXR0YWNobWVudCBieXRlcyB2YWx1ZVwiKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgYXR0YWNobWVudCBieXRlcyB0byBiYXNlNjQuXG4gKiBAcGFyYW0ge1VpbnQ4QXJyYXl9IGJ5dGVzIC0gQnl0ZXMuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEJhc2U2NCB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50Qnl0ZXNUb0Jhc2U2NChieXRlcykge1xuICBpZiAodHlwZW9mIEJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIHJldHVybiBCdWZmZXIuZnJvbShieXRlcykudG9TdHJpbmcoXCJiYXNlNjRcIilcbiAgfVxuXG4gIGxldCBiaW5hcnkgPSBcIlwiXG5cbiAgZm9yIChjb25zdCBieXRlIG9mIGJ5dGVzKSB7XG4gICAgYmluYXJ5ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZSlcbiAgfVxuXG4gIGlmICh0eXBlb2YgYnRvYSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJNaXNzaW5nIGJhc2U2NCBlbmNvZGVyXCIpXG5cbiAgcmV0dXJuIGJ0b2EoYmluYXJ5KVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgYXR0YWNobWVudCBiYXNlNjQgdG8gYnl0ZXMuXG4gKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBCYXNlNjQgdmFsdWUuXG4gKiBAcmV0dXJucyB7VWludDhBcnJheX0gLSBEZWNvZGVkIGJ5dGVzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZEF0dGFjaG1lbnRCYXNlNjRUb0J5dGVzKHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KEJ1ZmZlci5mcm9tKHZhbHVlLCBcImJhc2U2NFwiKSlcbiAgfVxuXG4gIGlmICh0eXBlb2YgYXRvYiAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJNaXNzaW5nIGJhc2U2NCBkZWNvZGVyXCIpXG5cbiAgY29uc3QgYmluYXJ5ID0gYXRvYih2YWx1ZSlcbiAgY29uc3QgYnl0ZXMgPSBuZXcgVWludDhBcnJheShiaW5hcnkubGVuZ3RoKVxuXG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBiaW5hcnkubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgYnl0ZXNbaW5kZXhdID0gYmluYXJ5LmNoYXJDb2RlQXQoaW5kZXgpXG4gIH1cblxuICByZXR1cm4gYnl0ZXNcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgdmFsdWUgaXMgcGxhaW4gb2JqZWN0LlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7dmFsdWUgaXMgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFdoZXRoZXIgdmFsdWUgaXMgcGxhaW4gb2JqZWN0LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzUGxhaW5PYmplY3QodmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZih2YWx1ZSlcblxuICByZXR1cm4gcHJvdG90eXBlID09PSBPYmplY3QucHJvdG90eXBlIHx8IHByb3RvdHlwZSA9PT0gbnVsbFxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcGF5bG9hZCBjb250YWlucyBhdHRhY2htZW50IHVwbG9hZC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gUGF5bG9hZCBjYW5kaWRhdGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHBheWxvYWQgY29udGFpbnMgYW4gYXR0YWNobWVudCB1cGxvYWQgYm9keS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFBheWxvYWRDb250YWluc0F0dGFjaG1lbnRVcGxvYWQodmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHJldHVybiB2YWx1ZS5zb21lKChlbnRyeSkgPT4gZnJvbnRlbmRNb2RlbFBheWxvYWRDb250YWluc0F0dGFjaG1lbnRVcGxvYWQoZW50cnkpKVxuICB9XG5cbiAgaWYgKCFmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzUGxhaW5PYmplY3QodmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICBpZiAodHlwZW9mIHZhbHVlLmNvbnRlbnRCYXNlNjQgPT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgcmV0dXJuIE9iamVjdC52YWx1ZXModmFsdWUpLnNvbWUoKGVudHJ5KSA9PiBmcm9udGVuZE1vZGVsUGF5bG9hZENvbnRhaW5zQXR0YWNobWVudFVwbG9hZChlbnRyeSkpXG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgY29uY3JldGUgZnJvbnRlbmQtbW9kZWwgY2xhc3MgZm9yIGFuIGluc3RhbmNlLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBGcm9udGVuZCBtb2RlbCBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQ2xhc3N9IENvbmNyZXRlIGZyb250ZW5kLW1vZGVsIGNsYXNzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQ2xhc3NGb3IobW9kZWwpIHtcbiAgY29uc3QgY29uc3RydWN0b3JWYWx1ZSA9IG1vZGVsLmNvbnN0cnVjdG9yXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbENsYXNzfSAqLyAoY29uc3RydWN0b3JWYWx1ZSlcbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSBjb25maWd1cmVkIG9mZmxpbmUgcXVldWUgc2hvdWxkIGhhbmRsZSBhIG1vZGVsIG9wZXJhdGlvbi5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IG9wZXJhdGlvbiAtIFN5bmMgb3BlcmF0aW9uLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0byBxdWV1ZSBsb2NhbGx5LlxuICovXG5mdW5jdGlvbiBzaG91bGRRdWV1ZUZyb250ZW5kTW9kZWxPcGVyYXRpb25PZmZsaW5lKE1vZGVsQ2xhc3MsIG9wZXJhdGlvbikge1xuICBjb25zdCBvZmZsaW5lU3luYyA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcub2ZmbGluZVN5bmNcblxuICBpZiAoIW9mZmxpbmVTeW5jPy5lbmFibGVkKSByZXR1cm4gZmFsc2VcblxuICBjb25zdCBzeW5jQ29uZmlnID0gTW9kZWxDbGFzcy5yZXNvdXJjZUNvbmZpZygpLnN5bmNcblxuICBpZiAoIXN5bmNDb25maWc/LmVuYWJsZWQpIHJldHVybiBmYWxzZVxuICBpZiAoIXN5bmNDb25maWcub3BlcmF0aW9ucy5pbmNsdWRlcyhvcGVyYXRpb24pKSB0aHJvdyBuZXcgRXJyb3IoYE9mZmxpbmUgc3luYyBmb3IgJHtNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfSBkb2VzIG5vdCBhbGxvdyAke29wZXJhdGlvbn1gKVxuXG4gIHJldHVybiB0cnVlXG59XG5cbi8qKlxuICogUXVldWVzIGFuIG9mZmxpbmUgc3luYyBtdXRhdGlvbi5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSBhcmdzLmF0dHJpYnV0ZXMgLSBNdXRhdGlvbiBhdHRyaWJ1dGVzLlxuICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmNsaWVudE11dGF0aW9uSWRdIC0gUHJlLWdlbmVyYXRlZCBtdXRhdGlvbiBpZC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBhcmdzLk1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYXJncy5vcGVyYXRpb24gLSBTeW5jIG9wZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gQ2xpZW50IG11dGF0aW9uIGlkLlxuICovXG5hc3luYyBmdW5jdGlvbiBxdWV1ZUZyb250ZW5kTW9kZWxNdXRhdGlvbk9mZmxpbmUoe2F0dHJpYnV0ZXMsIGNsaWVudE11dGF0aW9uSWQ6IHByb3ZpZGVkQ2xpZW50TXV0YXRpb25JZCwgTW9kZWxDbGFzcywgb3BlcmF0aW9ufSkge1xuICBjb25zdCBvZmZsaW5lU3luYyA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcub2ZmbGluZVN5bmNcblxuICBpZiAoIW9mZmxpbmVTeW5jKSB0aHJvdyBuZXcgRXJyb3IoXCJPZmZsaW5lIHN5bmMgaXMgbm90IGNvbmZpZ3VyZWRcIilcblxuICBjb25zdCBzeW5jQ29uZmlnID0gTW9kZWxDbGFzcy5yZXNvdXJjZUNvbmZpZygpLnN5bmNcbiAgaWYgKCFzeW5jQ29uZmlnPy5lbmFibGVkKSB0aHJvdyBuZXcgRXJyb3IoYE9mZmxpbmUgc3luYyBpcyBub3QgZW5hYmxlZCBmb3IgJHtNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfWApXG5cbiAgY29uc3Qgbm93ID0gb2ZmbGluZVN5bmMubm93ID8gb2ZmbGluZVN5bmMubm93KCkgOiBuZXcgRGF0ZSgpXG4gIGlmICghKG5vdyBpbnN0YW5jZW9mIERhdGUpIHx8IE51bWJlci5pc05hTihub3cuZ2V0VGltZSgpKSkgdGhyb3cgbmV3IEVycm9yKFwib2ZmbGluZVN5bmMubm93IG11c3QgcmV0dXJuIGEgdmFsaWQgRGF0ZVwiKVxuXG4gIGNvbnN0IGNsaWVudE11dGF0aW9uSWQgPSBwcm92aWRlZENsaWVudE11dGF0aW9uSWQgfHwgKG9mZmxpbmVTeW5jLmNsaWVudE11dGF0aW9uSWQgPyBvZmZsaW5lU3luYy5jbGllbnRNdXRhdGlvbklkKCkgOiBmcm9udGVuZE1vZGVsT2ZmbGluZU11dGF0aW9uSWQoKSlcbiAgaWYgKHR5cGVvZiBjbGllbnRNdXRhdGlvbklkICE9PSBcInN0cmluZ1wiIHx8IGNsaWVudE11dGF0aW9uSWQubGVuZ3RoIDwgMSkgdGhyb3cgbmV3IEVycm9yKFwib2ZmbGluZVN5bmMuY2xpZW50TXV0YXRpb25JZCBtdXN0IHJldHVybiBhIG5vbi1lbXB0eSBzdHJpbmdcIilcblxuICBhd2FpdCBvZmZsaW5lU3luYy5tdXRhdGlvbkxvZy5hcHBlbmQoe1xuICAgIG11dGF0aW9uOiB7XG4gICAgICBhY3RvckRldmljZUlkOiBvZmZsaW5lU3luYy5hY3RvckRldmljZUlkLFxuICAgICAgYWN0b3JVc2VySWQ6IG9mZmxpbmVTeW5jLmFjdG9yVXNlcklkLFxuICAgICAgYXR0cmlidXRlczogZnJvbnRlbmRNb2RlbFN5bmNKc29uT2JqZWN0KGF0dHJpYnV0ZXMpLFxuICAgICAgYmFzZVZlcnNpb246IG51bGwsXG4gICAgICBjbGllbnRNdXRhdGlvbklkLFxuICAgICAgbW9kZWw6IE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICBvY2N1cnJlZEF0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgIG9mZmxpbmVHcmFudElkOiBvZmZsaW5lU3luYy5vZmZsaW5lR3JhbnQuaWQsXG4gICAgICBvcGVyYXRpb24sXG4gICAgICBwb2xpY3lIYXNoOiBzeW5jQ29uZmlnLnBvbGljeUhhc2hcbiAgICB9XG4gIH0pXG5cbiAgcmV0dXJuIGNsaWVudE11dGF0aW9uSWRcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZXMgYSBmcm9udGVuZC1tb2RlbCBvZmZsaW5lIG11dGF0aW9uIGlkLlxuICogQHJldHVybnMge3N0cmluZ30gLSBMb2NhbCBtdXRhdGlvbiBpZC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbE9mZmxpbmVNdXRhdGlvbklkKCkge1xuICBpZiAoZ2xvYmFsVGhpcy5jcnlwdG8gJiYgdHlwZW9mIGdsb2JhbFRoaXMuY3J5cHRvLnJhbmRvbVVVSUQgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIGdsb2JhbFRoaXMuY3J5cHRvLnJhbmRvbVVVSUQoKVxuXG4gIHJldHVybiBgZnJvbnRlbmQtbXV0YXRpb24tJHtEYXRlLm5vdygpfS0ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMTYpLnNsaWNlKDIpfWBcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBtb2RlbCBhdHRyaWJ1dGVzIHRvIHN5bmMtc2FmZSBKU09OIHBheWxvYWQgdmFsdWVzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSBhdHRyaWJ1dGVzIC0gRnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gLSBTeW5jLXNhZmUgYXR0cmlidXRlcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFN5bmNKc29uT2JqZWN0KGF0dHJpYnV0ZXMpIHtcbiAgY29uc3Qgc2VyaWFsaXplZCA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoYXR0cmlidXRlcykpXG5cbiAgaWYgKCFzZXJpYWxpemVkIHx8IHR5cGVvZiBzZXJpYWxpemVkICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoc2VyaWFsaXplZCkpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHN5bmMgbXV0YXRpb24gYXR0cmlidXRlcyBvYmplY3RcIilcblxuICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gKi8gKHNlcmlhbGl6ZWQpXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgYXR0YWNobWVudCBpbnB1dC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGlucHV0IC0gQXR0YWNobWVudCBpbnB1dC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gVHJhbnNwb3J0LXNhZmUgYXR0YWNobWVudCBwYXlsb2FkLlxuICovXG5hc3luYyBmdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dChpbnB1dCkge1xuICBpZiAoZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KGlucHV0KSAmJiBcImZpbGVcIiBpbiBpbnB1dCkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRGaWxlID0gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQoaW5wdXQuZmlsZSlcbiAgICBjb25zdCBtZXJnZWQgPSB7XG4gICAgICAuLi5ub3JtYWxpemVkRmlsZVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgaW5wdXQuZmlsZW5hbWUgPT09IFwic3RyaW5nXCIgJiYgaW5wdXQuZmlsZW5hbWUubGVuZ3RoID4gMCkgbWVyZ2VkLmZpbGVuYW1lID0gaW5wdXQuZmlsZW5hbWVcbiAgICBpZiAodHlwZW9mIGlucHV0LmNvbnRlbnRUeXBlID09PSBcInN0cmluZ1wiICYmIGlucHV0LmNvbnRlbnRUeXBlLmxlbmd0aCA+IDApIG1lcmdlZC5jb250ZW50VHlwZSA9IGlucHV0LmNvbnRlbnRUeXBlXG5cbiAgICByZXR1cm4gbWVyZ2VkXG4gIH1cblxuICBpZiAoZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KGlucHV0KSkge1xuICAgIGlmICh0eXBlb2YgaW5wdXQucGF0aCA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5wYXRoLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkF0dGFjaG1lbnQgcGF0aCBpbnB1dCBpcyBub3Qgc3VwcG9ydGVkIGluIGZyb250ZW5kIG1vZGVsc1wiKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgaW5wdXQuY29udGVudEJhc2U2NCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29udGVudEJhc2U2NDogaW5wdXQuY29udGVudEJhc2U2NCxcbiAgICAgICAgY29udGVudFR5cGU6IHR5cGVvZiBpbnB1dC5jb250ZW50VHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5jb250ZW50VHlwZS5sZW5ndGggPiAwID8gaW5wdXQuY29udGVudFR5cGUgOiBudWxsLFxuICAgICAgICBmaWxlbmFtZTogdHlwZW9mIGlucHV0LmZpbGVuYW1lID09PSBcInN0cmluZ1wiICYmIGlucHV0LmZpbGVuYW1lLmxlbmd0aCA+IDAgPyBpbnB1dC5maWxlbmFtZSA6IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmIChmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZVN1cHBvcnRzQXJyYXlCdWZmZXIoaW5wdXQpKSB7XG4gICAgY29uc3QgYnl0ZXMgPSBuZXcgVWludDhBcnJheShhd2FpdCBpbnB1dC5hcnJheUJ1ZmZlcigpKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnRlbnRCYXNlNjQ6IGZyb250ZW5kQXR0YWNobWVudEJ5dGVzVG9CYXNlNjQoYnl0ZXMpLFxuICAgICAgY29udGVudFR5cGU6IHR5cGVvZiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoaW5wdXQpLnR5cGUgPT09IFwic3RyaW5nXCIgJiYgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS50eXBlLmxlbmd0aCA+IDBcbiAgICAgICAgPyAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoaW5wdXQpLnR5cGVcbiAgICAgICAgOiBudWxsLFxuICAgICAgZmlsZW5hbWU6IHR5cGVvZiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoaW5wdXQpLm5hbWUgPT09IFwic3RyaW5nXCIgJiYgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS5uYW1lLmxlbmd0aCA+IDBcbiAgICAgICAgPyAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoaW5wdXQpLm5hbWVcbiAgICAgICAgOiBcImF0dGFjaG1lbnQuYmluXCJcbiAgICB9XG4gIH1cblxuICBpZiAoZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc0J5dGVzKGlucHV0KSkge1xuICAgIGNvbnN0IGJ5dGVzID0gZnJvbnRlbmRBdHRhY2htZW50Tm9ybWFsaXplQnl0ZXMoLyoqIEB0eXBlIHtVaW50OEFycmF5IHwgQnVmZmVyIHwgQXJyYXlCdWZmZXJ9ICovIChpbnB1dCkpXG5cbiAgICByZXR1cm4ge1xuICAgICAgY29udGVudEJhc2U2NDogZnJvbnRlbmRBdHRhY2htZW50Qnl0ZXNUb0Jhc2U2NChieXRlcyksXG4gICAgICBjb250ZW50VHlwZTogbnVsbCxcbiAgICAgIGZpbGVuYW1lOiBcImF0dGFjaG1lbnQuYmluXCJcbiAgICB9XG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoXCJVbnN1cHBvcnRlZCBmcm9udGVuZCBhdHRhY2htZW50IGlucHV0XCIpXG59XG5cbi8qKlxuICogRnJvbnRlbmQtbW9kZWwgYXR0YWNobWVudCBoZWxwZXIgZm9yIG9uZSBhdHRhY2htZW50IG5hbWUuXG4gKi9cbmV4cG9ydCBjbGFzcyBGcm9udGVuZE1vZGVsQXR0YWNobWVudEhhbmRsZSB7XG4gIC8qKlxuICAgKiBQZW5kaW5nIGF0dGFjaG1lbnQgaW5wdXRzIHF1ZXVlZCBmb3IgdGhlIG5leHQgbW9kZWwgc2F2ZS5cbiAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxBdHRhY2htZW50SW5wdXRbXX1cbiAgICovXG4gIHBlbmRpbmdJbnB1dHMgPSBbXVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IGFyZ3MubW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7YXR0YWNobWVudE5hbWUsIG1vZGVsfSkge1xuICAgIHRoaXMubW9kZWwgPSBtb2RlbFxuICAgIHRoaXMuYXR0YWNobWVudE5hbWUgPSBhdHRhY2htZW50TmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFF1ZXVlIGF0dGFjaG1lbnQgaW5wdXQgZm9yIHRoZSBwYXJlbnQgbW9kZWwncyBuZXh0IHNhdmUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRJbnB1dCB8IEZyb250ZW5kTW9kZWxBdHRhY2htZW50SW5wdXRbXX0gaW5wdXQgLSBBdHRhY2htZW50IGlucHV0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHF1ZXVlQXR0YWNoKGlucHV0KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbih0aGlzLmF0dGFjaG1lbnROYW1lKVxuXG4gICAgaWYgKGF0dGFjaG1lbnREZWZpbml0aW9uPy50eXBlID09PSBcImhhc09uZVwiKSB7XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShpbnB1dCkpIHtcbiAgICAgICAgY29uc3QgbGFzdElucHV0ID0gaW5wdXRbaW5wdXQubGVuZ3RoIC0gMV1cblxuICAgICAgICB0aGlzLnBlbmRpbmdJbnB1dHMgPSB0eXBlb2YgbGFzdElucHV0ID09PSBcInVuZGVmaW5lZFwiID8gW10gOiBbbGFzdElucHV0XVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5wZW5kaW5nSW5wdXRzID0gW2lucHV0XVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoaW5wdXQpKSB7XG4gICAgICB0aGlzLnBlbmRpbmdJbnB1dHMucHVzaCguLi5pbnB1dClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5wZW5kaW5nSW5wdXRzLnB1c2goaW5wdXQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhpcyBhdHRhY2htZW50IGhhcyBxdWV1ZWQgaW5wdXRzIGZvciB0aGUgbmV4dCBtb2RlbCBzYXZlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBhbnkgcGVuZGluZyBpbnB1dHMgZXhpc3QuXG4gICAqL1xuICBoYXNQZW5kaW5nQXR0YWNobWVudHMoKSB7XG4gICAgcmV0dXJuIHRoaXMucGVuZGluZ0lucHV0cy5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBzYXZlIHBheWxvYWQgZm9yIHF1ZXVlZCBhdHRhY2htZW50IGlucHV0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W10gfCB1bmRlZmluZWQ+fSBOb3JtYWxpemVkIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIHBlbmRpbmdBdHRhY2htZW50c1BheWxvYWQoKSB7XG4gICAgaWYgKHRoaXMucGVuZGluZ0lucHV0cy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWRcblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24odGhpcy5hdHRhY2htZW50TmFtZSlcblxuICAgIGlmIChhdHRhY2htZW50RGVmaW5pdGlvbj8udHlwZSA9PT0gXCJoYXNNYW55XCIpIHtcbiAgICAgIHJldHVybiBhd2FpdCBQcm9taXNlLmFsbCh0aGlzLnBlbmRpbmdJbnB1dHMubWFwKGFzeW5jIChpbnB1dCkgPT4gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQoaW5wdXQpKSlcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQodGhpcy5wZW5kaW5nSW5wdXRzW3RoaXMucGVuZGluZ0lucHV0cy5sZW5ndGggLSAxXSlcbiAgfVxuXG4gIC8qKiBDbGVhcnMgcXVldWVkIGF0dGFjaG1lbnQgaW5wdXRzIGFmdGVyIGEgc3VjY2Vzc2Z1bCBtb2RlbCBzYXZlLiAqL1xuICBjbGVhclBlbmRpbmdBdHRhY2htZW50cygpIHtcbiAgICB0aGlzLnBlbmRpbmdJbnB1dHMgPSBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNoLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBpbnB1dCAtIEF0dGFjaG1lbnQgaW5wdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYXR0YWNoZWQuXG4gICAqL1xuICBhc3luYyBhdHRhY2goaW5wdXQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3Qgbm9ybWFsaXplZElucHV0ID0gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQoaW5wdXQpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiYXR0YWNoXCIsIHtcbiAgICAgIGF0dGFjaG1lbnQ6IG5vcm1hbGl6ZWRJbnB1dCxcbiAgICAgIGF0dGFjaG1lbnROYW1lOiB0aGlzLmF0dGFjaG1lbnROYW1lLFxuICAgICAgaWQ6IHRoaXMubW9kZWwucHJpbWFyeUtleVZhbHVlKClcbiAgICB9KVxuXG4gICAgdGhpcy5tb2RlbC5hc3NpZ25BdHRyaWJ1dGVzKE1vZGVsQ2xhc3MuYXR0cmlidXRlc0Zyb21SZXNwb25zZShyZXNwb25zZSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkb3dubG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthdHRhY2htZW50SWRdIC0gT3B0aW9uYWwgYXR0YWNobWVudCBpZCBmb3IgaGFzLW1hbnkgYXR0YWNobWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxBdHRhY2htZW50RG93bmxvYWQgfCBudWxsPn0gLSBEb3dubG9hZGVkIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIGRvd25sb2FkKGF0dGFjaG1lbnRJZCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IE1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJkb3dubG9hZFwiLCBmcm9udGVuZE1vZGVsQXR0YWNobWVudENvbW1hbmRQYXlsb2FkKHRoaXMsIGF0dGFjaG1lbnRJZCkpXG4gICAgY29uc3QgYXR0YWNobWVudFBheWxvYWQgPSByZXNwb25zZS5hdHRhY2htZW50XG5cbiAgICBpZiAoIWF0dGFjaG1lbnRQYXlsb2FkIHx8IHR5cGVvZiBhdHRhY2htZW50UGF5bG9hZCAhPT0gXCJvYmplY3RcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGNvbnRlbnRCYXNlNjQgPSB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQuY29udGVudEJhc2U2NCA9PT0gXCJzdHJpbmdcIiA/IGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRCYXNlNjQgOiBcIlwiXG4gICAgY29uc3QgY29udGVudCA9IGZyb250ZW5kQXR0YWNobWVudEJhc2U2NFRvQnl0ZXMoY29udGVudEJhc2U2NClcbiAgICBjb25zdCBieXRlU2l6ZSA9IE51bWJlcihhdHRhY2htZW50UGF5bG9hZC5ieXRlU2l6ZSlcblxuICAgIHJldHVybiBuZXcgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREb3dubG9hZCh7XG4gICAgICBieXRlU2l6ZTogTnVtYmVyLmlzRmluaXRlKGJ5dGVTaXplKSA/IGJ5dGVTaXplIDogY29udGVudC5sZW5ndGgsXG4gICAgICBjb250ZW50LFxuICAgICAgY29udGVudFR5cGU6IHR5cGVvZiBhdHRhY2htZW50UGF5bG9hZC5jb250ZW50VHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50UGF5bG9hZC5jb250ZW50VHlwZS5sZW5ndGggPiAwID8gYXR0YWNobWVudFBheWxvYWQuY29udGVudFR5cGUgOiBudWxsLFxuICAgICAgZmlsZW5hbWU6IHR5cGVvZiBhdHRhY2htZW50UGF5bG9hZC5maWxlbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50UGF5bG9hZC5maWxlbmFtZS5sZW5ndGggPiAwID8gYXR0YWNobWVudFBheWxvYWQuZmlsZW5hbWUgOiBcImF0dGFjaG1lbnQuYmluXCIsXG4gICAgICBpZDogdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLmlkID09PSBcInN0cmluZ1wiID8gYXR0YWNobWVudFBheWxvYWQuaWQgOiBcIlwiLFxuICAgICAgdXJsOiB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQudXJsID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnRQYXlsb2FkLnVybC5sZW5ndGggPiAwID8gYXR0YWNobWVudFBheWxvYWQudXJsIDogbnVsbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cmwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXR0YWNobWVudElkXSAtIE9wdGlvbmFsIGF0dGFjaG1lbnQgaWQgZm9yIGhhcy1tYW55IGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gLSBSZXNvbHZhYmxlIGF0dGFjaG1lbnQgVVJMLlxuICAgKi9cbiAgYXN5bmMgdXJsKGF0dGFjaG1lbnRJZCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IE1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJ1cmxcIiwgZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb21tYW5kUGF5bG9hZCh0aGlzLCBhdHRhY2htZW50SWQpKVxuXG4gICAgaWYgKHR5cGVvZiByZXNwb25zZS51cmwgPT09IFwic3RyaW5nXCIgJiYgcmVzcG9uc2UudXJsLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiByZXNwb25zZS51cmxcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHF1ZXJ5IGZvciB0aGlzIGF0dGFjaG1lbnQgaGFuZGxlJ3MgbWV0YWRhdGEgcm93cy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgVmVsb2Npb3VzQXR0YWNobWVudD59IC0gQXR0YWNobWVudCBtZXRhZGF0YSBxdWVyeS5cbiAgICovXG4gIHF1ZXJ5KCkge1xuICAgIGNvbnN0IGF0dGFjaG1lbnRPd25lciA9IGZyb250ZW5kTW9kZWxBdHRhY2htZW50T3duZXIodGhpcy5tb2RlbClcblxuICAgIHJldHVybiBWZWxvY2lvdXNBdHRhY2htZW50XG4gICAgICAud2hlcmUoe1xuICAgICAgICBuYW1lOiB0aGlzLmF0dGFjaG1lbnROYW1lLFxuICAgICAgICByZWNvcmRJZDogYXR0YWNobWVudE93bmVyLnJlY29yZElkLFxuICAgICAgICByZWNvcmRUeXBlOiBhdHRhY2htZW50T3duZXIucmVjb3JkVHlwZSxcbiAgICAgICAgcmVzb3VyY2VOYW1lOiBhdHRhY2htZW50T3duZXIucmVzb3VyY2VOYW1lXG4gICAgICB9KVxuICAgICAgLm9yZGVyKFtbXCJwb3NpdGlvblwiLCBcImFzY1wiXV0pXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgYWxsIGF0dGFjaG1lbnQgbWV0YWRhdGEgcm93cyBmb3IgdGhpcyBoYW5kbGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFZlbG9jaW91c0F0dGFjaG1lbnRbXT59IC0gQXR0YWNobWVudCBtZXRhZGF0YSByb3dzLlxuICAgKi9cbiAgYXN5bmMgdG9BcnJheSgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLnRvQXJyYXkoKVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIHRoZSBmaXJzdCBhdHRhY2htZW50IG1ldGFkYXRhIHJvdyBmb3IgdGhpcyBoYW5kbGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFZlbG9jaW91c0F0dGFjaG1lbnQgfCBudWxsPn0gLSBGaXJzdCBhdHRhY2htZW50IG1ldGFkYXRhIHJvdy5cbiAgICovXG4gIGFzeW5jIGZpcnN0KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmlyc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGlzdC4gUmV0dXJucyBtZXRhZGF0YSBmb3IgZXZlcnkgYXR0YWNobWVudCB1bmRlciB0aGlzIGF0dGFjaG1lbnQgbmFtZVxuICAgKiAobm8gY29udGVudCBieXRlcyksIHNvIGNhbGxlcnMgY2FuIGVudW1lcmF0ZSBoYXMtbWFueSBhdHRhY2htZW50cyBhbmQgdGhlblxuICAgKiBkb3dubG9hZCBvciBsaW5rIHRvIGVhY2ggb25lIGJ5IGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTx7Ynl0ZVNpemU6IG51bWJlciwgY29udGVudFR5cGU6IHN0cmluZyB8IG51bGwsIGZpbGVuYW1lOiBzdHJpbmcsIGlkOiBzdHJpbmcsIHVybDogc3RyaW5nIHwgbnVsbH0+Pn0gLSBBdHRhY2htZW50IG1ldGFkYXRhIGVudHJpZXMuXG4gICAqL1xuICBhc3luYyBsaXN0KCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IE1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJhdHRhY2htZW50TGlzdFwiLCBmcm9udGVuZE1vZGVsQXR0YWNobWVudENvbW1hbmRQYXlsb2FkKHRoaXMpKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gQXJyYXkuaXNBcnJheShyZXNwb25zZS5hdHRhY2htZW50cykgPyByZXNwb25zZS5hdHRhY2htZW50cyA6IFtdXG5cbiAgICByZXR1cm4gYXR0YWNobWVudHMubWFwKChhdHRhY2htZW50KSA9PiB7XG4gICAgICBjb25zdCBieXRlU2l6ZSA9IE51bWJlcihhdHRhY2htZW50LmJ5dGVTaXplKVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBieXRlU2l6ZTogTnVtYmVyLmlzRmluaXRlKGJ5dGVTaXplKSA/IGJ5dGVTaXplIDogMCxcbiAgICAgICAgY29udGVudFR5cGU6IHR5cGVvZiBhdHRhY2htZW50LmNvbnRlbnRUeXBlID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnQuY29udGVudFR5cGUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnQuY29udGVudFR5cGUgOiBudWxsLFxuICAgICAgICBmaWxlbmFtZTogdHlwZW9mIGF0dGFjaG1lbnQuZmlsZW5hbWUgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudC5maWxlbmFtZS5sZW5ndGggPiAwID8gYXR0YWNobWVudC5maWxlbmFtZSA6IFwiYXR0YWNobWVudC5iaW5cIixcbiAgICAgICAgaWQ6IHR5cGVvZiBhdHRhY2htZW50LmlkID09PSBcInN0cmluZ1wiID8gYXR0YWNobWVudC5pZCA6IFwiXCIsXG4gICAgICAgIHVybDogdHlwZW9mIGF0dGFjaG1lbnQudXJsID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnQudXJsLmxlbmd0aCA+IDAgPyBhdHRhY2htZW50LnVybCA6IG51bGxcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZG93bmxvYWQgdXJsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERvd25sb2FkIFVSTCBmb3IgdGhpcyBhdHRhY2htZW50IG9uIHRoZSBjb25maWd1cmVkIGJhY2tlbmQuXG4gICAqL1xuICBkb3dubG9hZFVybCgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgY29tbWFuZE5hbWUgPSBNb2RlbENsYXNzLmNvbW1hbmROYW1lKFwiZG93bmxvYWRcIilcbiAgICBjb25zdCByZXNvdXJjZVBhdGggPSBNb2RlbENsYXNzLnJlc291cmNlUGF0aCgpXG4gICAgY29uc3QgY29tbWFuZFVybCA9IGZyb250ZW5kTW9kZWxDb21tYW5kVXJsKHJlc291cmNlUGF0aCwgY29tbWFuZE5hbWUpXG4gICAgY29uc3QgcGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcyh7XG4gICAgICBhdHRhY2htZW50TmFtZTogdGhpcy5hdHRhY2htZW50TmFtZSxcbiAgICAgIGlkOiBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgdGhpcy5tb2RlbC5wcmltYXJ5S2V5VmFsdWUoKSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIGAke2NvbW1hbmRVcmx9PyR7cGFyYW1zLnRvU3RyaW5nKCl9YFxuICB9XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHVybC5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbH0gdmFsdWUgLSBVUkwgY2FuZGlkYXRlLlxuICogQHJldHVybnMge3N0cmluZ30gLSBOb3JtYWxpemVkIFVSTCB3aXRob3V0IHRyYWlsaW5nIHNsYXNoLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VXJsKHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiBcIlwiXG5cbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKVxuXG4gIGlmICghdHJpbW1lZC5sZW5ndGgpIHJldHVybiBcIlwiXG5cbiAgcmV0dXJuIHRyaW1tZWQucmVwbGFjZSgvXFwvKyQvLCBcIlwiKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHVybC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUmVzb2x2ZWQgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IFVSTC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybCgpIHtcbiAgY29uc3QgY29uZmlndXJlZFVybCA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnVybCA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnVybCgpXG4gICAgOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnVybFxuXG4gIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VXJsKGNvbmZpZ3VyZWRVcmwpXG59XG5cbi8qKlxuICogUnVucyBjbG9uZSBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGVzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHZhbHVlIC0gQXR0cmlidXRlcyBoYXNoLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDbG9uZWQgYXR0cmlidXRlcyBoYXNoLlxuICovXG5mdW5jdGlvbiBjbG9uZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKHZhbHVlKSB7XG4gIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh2YWx1ZSkpKVxufVxuXG4vKipcbiAqIFNoYXJlZCBjaGFubmVsIG5hbWUgZm9yIG1vZGVsIGxpZmVjeWNsZSBldmVudHMgKFBoYXNlIDMpLlxuICogTWF0Y2hlcyB0aGUgYmFja2VuZCBgRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRWAuXG4gKi9cbmNvbnN0IEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUgPSBcImZyb250ZW5kLW1vZGVsc1wiXG5cbi8qKlxuICogUnVucyBtZXJnZSBmcm9udGVuZCBtb2RlbCBldmVudCBwcmVsb2FkLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IHRhcmdldCAtIFRhcmdldCBwcmVsb2FkIHBheWxvYWQuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gc291cmNlIC0gU291cmNlIHByZWxvYWQgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByZWxvYWQodGFyZ2V0LCBzb3VyY2UpIHtcbiAgZm9yIChjb25zdCBbcmVsYXRpb25zaGlwTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZSkpIHtcbiAgICBjb25zdCBleGlzdGluZ1ZhbHVlID0gdGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICBpZiAodmFsdWUgPT09IHRydWUgfHwgdmFsdWUgPT09IGZhbHNlKSB7XG4gICAgICBpZiAoZXhpc3RpbmdWYWx1ZSA9PT0gdW5kZWZpbmVkKSB0YXJnZXRbcmVsYXRpb25zaGlwTmFtZV0gPSB2YWx1ZVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdID0gdmFsdWVcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCFleGlzdGluZ1ZhbHVlIHx8IHR5cGVvZiBleGlzdGluZ1ZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZXhpc3RpbmdWYWx1ZSkpIHtcbiAgICAgIHRhcmdldFtyZWxhdGlvbnNoaXBOYW1lXSA9IHt9XG4gICAgfVxuXG4gICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRQcmVsb2FkKFxuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovICh0YXJnZXRbcmVsYXRpb25zaGlwTmFtZV0pLFxuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovICh2YWx1ZSlcbiAgICApXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG1lcmdlIGZyb250ZW5kIG1vZGVsIGV2ZW50IHNlbGVjdC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSB0YXJnZXQgLSBUYXJnZXQgc2VsZWN0IG1hcC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSBzb3VyY2UgLSBTb3VyY2Ugc2VsZWN0IG1hcC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFNlbGVjdCh0YXJnZXQsIHNvdXJjZSkge1xuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIGF0dHJpYnV0ZXNdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZSkpIHtcbiAgICBjb25zdCBleGlzdGluZ0F0dHJpYnV0ZXMgPSB0YXJnZXRbbW9kZWxOYW1lXSB8fCBbXVxuXG4gICAgdGFyZ2V0W21vZGVsTmFtZV0gPSBBcnJheS5mcm9tKG5ldyBTZXQoZXhpc3RpbmdBdHRyaWJ1dGVzLmNvbmNhdChhdHRyaWJ1dGVzKSkpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG1lcmdlIHVuaXF1ZSBmcm9udGVuZCBtb2RlbCBldmVudCBlbnRyaWVzLlxuICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxXaXRoQ291bnRQYXlsb2FkRW50cnkgfCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxBYmlsaXRpZXNQYXlsb2FkRW50cnk+fSB0YXJnZXQgLSBUYXJnZXQgYXJyYXkuXG4gKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFdpdGhDb3VudFBheWxvYWRFbnRyeSB8IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEFiaWxpdGllc1BheWxvYWRFbnRyeT59IHNvdXJjZSAtIFNvdXJjZSBhcnJheS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZVVuaXF1ZUZyb250ZW5kTW9kZWxFdmVudEVudHJpZXModGFyZ2V0LCBzb3VyY2UpIHtcbiAgY29uc3QgZXhpc3RpbmdLZXlzID0gbmV3IFNldCh0YXJnZXQubWFwKChlbnRyeSkgPT4gSlNPTi5zdHJpbmdpZnkoZW50cnkpKSlcblxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIHNvdXJjZSkge1xuICAgIGNvbnN0IGtleSA9IEpTT04uc3RyaW5naWZ5KGVudHJ5KVxuXG4gICAgaWYgKGV4aXN0aW5nS2V5cy5oYXMoa2V5KSkgY29udGludWVcblxuICAgIHRhcmdldC5wdXNoKGVudHJ5KVxuICAgIGV4aXN0aW5nS2V5cy5hZGQoa2V5KVxuICB9XG59XG5cbi8qKlxuICogUnVucyBtZXJnZSBmcm9udGVuZCBtb2RlbCBldmVudCBwcm9qZWN0aW9uIHBheWxvYWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfSB0YXJnZXQgLSBUYXJnZXQgcGF5bG9hZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9IHNvdXJjZSAtIFNvdXJjZSBwYXlsb2FkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50UHJvamVjdGlvblBheWxvYWQodGFyZ2V0LCBzb3VyY2UpIHtcbiAgaWYgKHNvdXJjZS5wcmVsb2FkKSB7XG4gICAgaWYgKCF0YXJnZXQucHJlbG9hZCkgdGFyZ2V0LnByZWxvYWQgPSB7fVxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50UHJlbG9hZCh0YXJnZXQucHJlbG9hZCwgc291cmNlLnByZWxvYWQpXG4gIH1cblxuICBpZiAoc291cmNlLnNlbGVjdCkge1xuICAgIGlmICghdGFyZ2V0LnNlbGVjdCkgdGFyZ2V0LnNlbGVjdCA9IHt9XG4gICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRTZWxlY3QodGFyZ2V0LnNlbGVjdCwgc291cmNlLnNlbGVjdClcbiAgfVxuXG4gIGlmIChzb3VyY2Uuc2VsZWN0c0V4dHJhKSB7XG4gICAgaWYgKCF0YXJnZXQuc2VsZWN0c0V4dHJhKSB0YXJnZXQuc2VsZWN0c0V4dHJhID0ge31cbiAgICBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFNlbGVjdCh0YXJnZXQuc2VsZWN0c0V4dHJhLCBzb3VyY2Uuc2VsZWN0c0V4dHJhKVxuICB9XG5cbiAgaWYgKHNvdXJjZS53aXRoQ291bnQpIHtcbiAgICBpZiAoIXRhcmdldC53aXRoQ291bnQpIHRhcmdldC53aXRoQ291bnQgPSBbXVxuICAgIG1lcmdlVW5pcXVlRnJvbnRlbmRNb2RlbEV2ZW50RW50cmllcyh0YXJnZXQud2l0aENvdW50LCBzb3VyY2Uud2l0aENvdW50KVxuICB9XG5cbiAgaWYgKHNvdXJjZS5hYmlsaXRpZXMpIHtcbiAgICBpZiAoIXRhcmdldC5hYmlsaXRpZXMpIHRhcmdldC5hYmlsaXRpZXMgPSBbXVxuICAgIG1lcmdlVW5pcXVlRnJvbnRlbmRNb2RlbEV2ZW50RW50cmllcyh0YXJnZXQuYWJpbGl0aWVzLCBzb3VyY2UuYWJpbGl0aWVzKVxuICB9XG5cbiAgaWYgKHNvdXJjZS5xdWVyeURhdGEgIT09IHVuZGVmaW5lZCkge1xuICAgIGNvbnN0IHRhcmdldFF1ZXJ5RGF0YSA9IEFycmF5LmlzQXJyYXkodGFyZ2V0LnF1ZXJ5RGF0YSkgPyB0YXJnZXQucXVlcnlEYXRhIDogW11cblxuICAgIHRhcmdldC5xdWVyeURhdGEgPSB0YXJnZXRRdWVyeURhdGFcbiAgICBjb25zdCBxdWVyeURhdGFFbnRyaWVzID0gQXJyYXkuaXNBcnJheShzb3VyY2UucXVlcnlEYXRhKSA/IHNvdXJjZS5xdWVyeURhdGEgOiBbc291cmNlLnF1ZXJ5RGF0YV1cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcXVlcnlEYXRhRW50cmllcykge1xuICAgICAgdGFyZ2V0UXVlcnlEYXRhLnB1c2goZW50cnkpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBtYXRjaGVkIGV2ZW50IGZpbHRlciBrZXlzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keSAtIFJhdyB3ZWJzb2NrZXQgZXZlbnQgYm9keS5cbiAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBNYXRjaGVkIGV2ZW50IGZpbHRlciBrZXlzIGRlbGl2ZXJlZCBieSB0aGUgYmFja2VuZC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbE1hdGNoZWRFdmVudEZpbHRlcktleXMoYm9keSkge1xuICBpZiAoIWJvZHkgfHwgdHlwZW9mIGJvZHkgIT09IFwib2JqZWN0XCIpIHJldHVybiBuZXcgU2V0KClcblxuICBjb25zdCBrZXlzID0gLyoqIEB0eXBlIHt7bWF0Y2hlZEV2ZW50RmlsdGVyS2V5cz86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gKi8gKGJvZHkpLm1hdGNoZWRFdmVudEZpbHRlcktleXNcblxuICBpZiAoIUFycmF5LmlzQXJyYXkoa2V5cykpIHJldHVybiBuZXcgU2V0KClcblxuICByZXR1cm4gbmV3IFNldChrZXlzLm1hcCgoa2V5KSA9PiBTdHJpbmcoa2V5KSkpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBldmVudCBlbnRyeSBtYXRjaGVzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnk8YW55LCBhbnk+fSBlbnRyeSAtIENhbGxiYWNrIGVudHJ5LlxuICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyAtIEJhY2tlbmQgbWF0Y2hlZCBmaWx0ZXIga2V5cy5cbiAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSBjYWxsYmFjayBzaG91bGQgcmVjZWl2ZSB0aGUgZXZlbnQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxFdmVudEVudHJ5TWF0Y2hlcyhlbnRyeSwgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cykge1xuICBpZiAoIWVudHJ5LmV2ZW50RmlsdGVyS2V5KSByZXR1cm4gdHJ1ZVxuXG4gIHJldHVybiBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzLmhhcyhlbnRyeS5ldmVudEZpbHRlcktleSlcbn1cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBubyBkZXN0cm95IGV2ZW50IGZpbHRlci5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gRXZlbnQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gb3B0aW9ucyAtIEV2ZW50IG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0Tm9EZXN0cm95RXZlbnRGaWx0ZXIoTW9kZWxDbGFzcywgb3B0aW9ucykge1xuICBjb25zdCBldmVudE9wdGlvbnNQYXlsb2FkID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQoTW9kZWxDbGFzcywgb3B0aW9ucylcblxuICBpZiAoIWV2ZW50T3B0aW9uc1BheWxvYWQuZXZlbnRGaWx0ZXJLZXkpIHJldHVyblxuXG4gIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIGRlc3Ryb3kgZXZlbnQgc3Vic2NyaXB0aW9ucyBkbyBub3Qgc3VwcG9ydCBxdWVyeSBmaWx0ZXJzXCIpXG59XG5cbi8qKlxuICogUGVyLW1vZGVsIGNsYXNzIHNpbmdsZXRvbiB0aGF0IG11bHRpcGxleGVzIGFsbCByZWdpc3RlcmVkIG9uQ3JlYXRlIC9cbiAqIG9uVXBkYXRlIC8gb25EZXN0cm95IGNhbGxiYWNrcyDigJQgY2xhc3MtbGV2ZWwgKyBpbnN0YW5jZS1sZXZlbCDigJRcbiAqIG92ZXIgb25lIFdlYnNvY2tldENoYW5uZWxWMiBzdWJzY3JpcHRpb24uIFN1YnNjcmlwdGlvbiBvcGVucyBvbiB0aGVcbiAqIGZpcnN0IGxpc3RlbmVyIGFuZCBjbG9zZXMgd2hlbiB0aGUgbGFzdCBvbmUgdW5zdWJzY3JpYmVzLlxuICpcbiAqIEluc3RhbmNlLWxldmVsIGxpc3RlbmVycyBhbHNvIHJlY2VpdmUgYXV0by1tZXJnZTogd2hlbiBhbiBgdXBkYXRlYFxuICogZXZlbnQgYXJyaXZlcyBmb3IgYSByZWdpc3RlcmVkIGluc3RhbmNlIGlkLCB0aGUgaW5zdGFuY2Unc1xuICogYXR0cmlidXRlcyBhcmUgdXBkYXRlZCBpbiBwbGFjZSBiZWZvcmUgdGhlIGNhbGxiYWNrIGZpcmVzLCBzb1xuICogY2FsbGVycyBjYW4gcmVhZCBmcmVzaCB2YWx1ZXMgZnJvbSB0aGUgc2FtZSBpbnN0YW5jZSBoYW5kbGUuXG4gKi9cbmNsYXNzIEZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbiB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzIGZvciB0aGlzIHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dH0gcmVxdWVzdENvbnRleHQgLSBDYXB0dXJlZCBzdWJzY3JpcHRpb24gY29udGV4dC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKE1vZGVsQ2xhc3MsIHJlcXVlc3RDb250ZXh0KSB7XG4gICAgdGhpcy5Nb2RlbENsYXNzID0gTW9kZWxDbGFzc1xuICAgIHRoaXMucmVxdWVzdENvbnRleHQgPSByZXF1ZXN0Q29udGV4dFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeTxhbnksIGFueT4+fSAqL1xuICAgIHRoaXMuY2xhc3NDcmVhdGVDYWxsYmFja3MgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1NldDxGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnk8YW55LCBhbnk+Pn0gKi9cbiAgICB0aGlzLmNsYXNzVXBkYXRlQ2FsbGJhY2tzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtTZXQ8RnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnk8bmV2ZXI+Pn0gKi9cbiAgICB0aGlzLmNsYXNzRGVzdHJveUNhbGxiYWNrcyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywge2luc3RhbmNlOiBGcm9udGVuZE1vZGVsQmFzZSwgdXBkYXRlQ2FsbGJhY2tzOiBTZXQ8RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5PGFueSwgYW55Pj4sIGRlc3Ryb3lDYWxsYmFja3M6IFNldDxGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50Q2FsbGJhY2tFbnRyeTxhbnk+Pn0+fSAqL1xuICAgIHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMgPSBuZXcgTWFwKClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IG51bGxcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsfSAqL1xuICAgIHRoaXMucmVhZHlQcm9taXNlID0gbnVsbFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7c3RyaW5nIHwgbnVsbH0gKi9cbiAgICB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1YnNjcmlwdGlvbiBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHt7bW9kZWw6IHN0cmluZywgZGVzdHJveUV2ZW50RGVsaXZlcnk/OiBib29sZWFuLCBldmVudEZpbHRlcnM/OiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeVtdLCB1bmZpbHRlcmVkRXZlbnREZWxpdmVyeT86IGJvb2xlYW59ICYgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9IC0gQ3VycmVudCB3ZWJzb2NrZXQgc3Vic2NyaXB0aW9uIHBhcmFtcy5cbiAgICovXG4gIHN1YnNjcmlwdGlvblBhcmFtcygpIHtcbiAgICAvKipcbiAgICAgKiBQcm9qZWN0aW9uIHBheWxvYWQuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfSAqL1xuICAgIGNvbnN0IHByb2plY3Rpb25QYXlsb2FkID0ge31cbiAgICAvKipcbiAgICAgKiBFdmVudCBmaWx0ZXJzIGJ5IGtleS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnk+fSAqL1xuICAgIGNvbnN0IGV2ZW50RmlsdGVyc0J5S2V5ID0ge31cbiAgICBjb25zdCBwcm9qZWN0aW9uRW50cmllcyA9IFtdXG4gICAgbGV0IGhhc0Rlc3Ryb3lFdmVudERlbGl2ZXJ5ID0gdGhpcy5jbGFzc0Rlc3Ryb3lDYWxsYmFja3Muc2l6ZSA+IDBcbiAgICBsZXQgaGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLmNsYXNzQ3JlYXRlQ2FsbGJhY2tzKSBwcm9qZWN0aW9uRW50cmllcy5wdXNoKGVudHJ5KVxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgdGhpcy5jbGFzc1VwZGF0ZUNhbGxiYWNrcykgcHJvamVjdGlvbkVudHJpZXMucHVzaChlbnRyeSlcblxuICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgdGhpcy5pbnN0YW5jZUxpc3RlbmVycy52YWx1ZXMoKSkge1xuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBsaXN0ZW5lci51cGRhdGVDYWxsYmFja3MpIHByb2plY3Rpb25FbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICBpZiAobGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcy5zaXplID4gMCkgaGFzRGVzdHJveUV2ZW50RGVsaXZlcnkgPSB0cnVlXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBwcm9qZWN0aW9uRW50cmllcykge1xuICAgICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRQcm9qZWN0aW9uUGF5bG9hZChwcm9qZWN0aW9uUGF5bG9hZCwgZW50cnkucHJvamVjdGlvblBheWxvYWQpXG5cbiAgICAgIGlmIChlbnRyeS5ldmVudEZpbHRlcktleSAmJiBlbnRyeS5ldmVudEZpbHRlclBheWxvYWQpIHtcbiAgICAgICAgZXZlbnRGaWx0ZXJzQnlLZXlbZW50cnkuZXZlbnRGaWx0ZXJLZXldID0ge1xuICAgICAgICAgIC4uLmVudHJ5LmV2ZW50RmlsdGVyUGF5bG9hZCxcbiAgICAgICAgICBrZXk6IGVudHJ5LmV2ZW50RmlsdGVyS2V5XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGhhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5ID0gdHJ1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGV2ZW50RmlsdGVycyA9IE9iamVjdC52YWx1ZXMoZXZlbnRGaWx0ZXJzQnlLZXkpXG4gICAgY29uc3QgZXZlbnRGaWx0ZXJQYXJhbXMgPSBldmVudEZpbHRlcnMubGVuZ3RoID4gMFxuICAgICAgPyB7XG4gICAgICAgICAgZXZlbnRGaWx0ZXJzLFxuICAgICAgICAgIC4uLihoYXNEZXN0cm95RXZlbnREZWxpdmVyeSA/IHtkZXN0cm95RXZlbnREZWxpdmVyeTogdHJ1ZX0gOiB7fSksXG4gICAgICAgICAgLi4uKGhhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5ID8ge3VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5OiB0cnVlfSA6IHt9KVxuICAgICAgICB9XG4gICAgICA6IHt9XG5cbiAgICByZXR1cm4gbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQoXG4gICAgICB0aGlzLnJlcXVlc3RDb250ZXh0LFxuICAgICAge1xuICAgICAgICBtb2RlbDogdGhpcy5Nb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICAuLi5ldmVudEZpbHRlclBhcmFtcyxcbiAgICAgICAgLi4ucHJvamVjdGlvblBheWxvYWRcbiAgICAgIH1cbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdWJzY3JpcHRpb24gcGFyYW1zIGpzb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RhYmxlIGtleSBmb3IgY3VycmVudCBzdWJzY3JpcHRpb24gcGFyYW1zLlxuICAgKi9cbiAgc3Vic2NyaXB0aW9uUGFyYW1zSnNvbigpIHtcbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodGhpcy5zdWJzY3JpcHRpb25QYXJhbXMoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyIGNsYXNzIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeTxhbnksIGFueT4gfCBGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50Q2FsbGJhY2tFbnRyeTxuZXZlcj59IFRcbiAgICogQHBhcmFtIHtTZXQ8VD59IGNhbGxiYWNrcyAtIENhbGxiYWNrIHNldCBmb3IgdGhlIGV2ZW50IHR5cGUuXG4gICAqIEBwYXJhbSB7VH0gZW50cnkgLSBDYWxsYmFjayBlbnRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBhc3luYyByZWdpc3RlckNsYXNzQ2FsbGJhY2soY2FsbGJhY2tzLCBlbnRyeSkge1xuICAgIGNhbGxiYWNrcy5hZGQoZW50cnkpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5lbnN1cmVTdWJzY3JpYmVkKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY2FsbGJhY2tzLmRlbGV0ZShlbnRyeSlcbiAgICAgIHRoaXMubWF5YmVUZWFyZG93bigpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBjYWxsYmFja3MuZGVsZXRlKGVudHJ5KVxuICAgICAgdGhpcy5tYXliZVRlYXJkb3duKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgc3Vic2NyaWJlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59ICovXG4gIGFzeW5jIGVuc3VyZVN1YnNjcmliZWQoKSB7XG4gICAgY29uc3QgcGFyYW1zSnNvbiA9IHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zSnNvbigpXG5cbiAgICBpZiAodGhpcy5jaGFubmVsSGFuZGxlICYmICF0aGlzLmNoYW5uZWxIYW5kbGUuaXNDbG9zZWQoKSkge1xuICAgICAgaWYgKHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zS2V5ICE9PSBwYXJhbXNKc29uKSB7XG4gICAgICAgIHRoaXMuY2hhbm5lbEhhbmRsZS5jbG9zZSgpXG4gICAgICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IG51bGxcbiAgICAgICAgdGhpcy5yZWFkeVByb21pc2UgPSBudWxsXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAodGhpcy5yZWFkeVByb21pc2UpIGF3YWl0IHRoaXMucmVhZHlQcm9taXNlXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFNlcmlhbGl6ZSBwYXJhbGxlbCBjYWxscyAoZS5nLiBQcm9taXNlLmFsbChbb25DcmVhdGUsIG9uVXBkYXRlLFxuICAgIC8vIG9uRGVzdHJveV0pKSBzbyB3ZSBvcGVuIGV4YWN0bHkgb25lIHN1YnNjcmlwdGlvbiBwZXIgbW9kZWwgY2xhc3NcbiAgICAvLyBpbnN0ZWFkIG9mIHJhY2luZyB0aHJlZSBjb25jdXJyZW50IHN1YnNjcmliZUNoYW5uZWwgY2FsbHMuXG4gICAgaWYgKHRoaXMucmVhZHlQcm9taXNlKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlYWR5UHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50IHx8IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpKVxuXG4gICAgaWYgKCFjbGllbnQgfHwgdHlwZW9mIGNsaWVudC5zdWJzY3JpYmVDaGFubmVsICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIGV2ZW50IHN1YnNjcmlwdGlvbnMgcmVxdWlyZSBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldFVybH0pIG9yIGNvbmZpZ3VyZVRyYW5zcG9ydCh7d2Vic29ja2V0Q2xpZW50fSlcIilcbiAgICB9XG5cbiAgICB0aGlzLnJlYWR5UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBpZiAodHlwZW9mIGNsaWVudC5jb25uZWN0ID09PSBcImZ1bmN0aW9uXCIpIGF3YWl0IGNsaWVudC5jb25uZWN0KClcblxuICAgICAgY29uc3QgcGFyYW1zID0gdGhpcy5zdWJzY3JpcHRpb25QYXJhbXMoKVxuXG4gICAgICB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSA9IEpTT04uc3RyaW5naWZ5KHBhcmFtcylcbiAgICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IGNsaWVudC5zdWJzY3JpYmVDaGFubmVsKEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUsIHtcbiAgICAgICAgcGFyYW1zLFxuICAgICAgICBvbk1lc3NhZ2U6ICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBib2R5KSA9PiB0aGlzLl9kaXNwYXRjaEV2ZW50KGJvZHkpLFxuICAgICAgICBvbkNsb3NlOiAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jaGFubmVsSGFuZGxlID0gbnVsbFxuICAgICAgICAgIHRoaXMucmVhZHlQcm9taXNlID0gbnVsbFxuICAgICAgICAgIHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zS2V5ID0gbnVsbFxuICAgICAgICAgIHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMuY2xlYXIoKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgYXdhaXQgdGhpcy5jaGFubmVsSGFuZGxlLnJlYWR5XG4gICAgfSkoKVxuXG4gICAgYXdhaXQgdGhpcy5yZWFkeVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRpc3BhdGNoIGV2ZW50LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5IC0gV2ViU29ja2V0IGV2ZW50IHBheWxvYWQuXG4gICAqL1xuICBfZGlzcGF0Y2hFdmVudChib2R5KSB7XG4gICAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSBcIm9iamVjdFwiKSByZXR1cm5cblxuICAgIGNvbnN0IGFjdGlvbiA9IGJvZHkuYWN0aW9uXG4gICAgY29uc3QgcmF3SWQgPSBib2R5LmlkXG5cbiAgICBpZiAoYWN0aW9uICE9PSBcImNyZWF0ZVwiICYmIGFjdGlvbiAhPT0gXCJ1cGRhdGVcIiAmJiBhY3Rpb24gIT09IFwiZGVzdHJveVwiKSByZXR1cm5cbiAgICBpZiAocmF3SWQgPT09IHVuZGVmaW5lZCB8fCByYXdJZCA9PT0gbnVsbCkgcmV0dXJuXG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5Nb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IGlkZW50aXR5ID0gQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KVxuICAgICAgPyBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIHJhd0lkKVxuICAgICAgOiBTdHJpbmcocmF3SWQpXG4gICAgY29uc3QgaWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBpZGVudGl0eSlcbiAgICBjb25zdCByYXdQcmV2aW91c0lkID0gYm9keS5wcmV2aW91c0lkXG4gICAgY29uc3QgcHJldmlvdXNJZGVudGl0eSA9IHJhd1ByZXZpb3VzSWQgPT09IHVuZGVmaW5lZCB8fCByYXdQcmV2aW91c0lkID09PSBudWxsXG4gICAgICA/IG51bGxcbiAgICAgIDogQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KVxuICAgICAgICA/IG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMocHJpbWFyeUtleSwgcmF3UHJldmlvdXNJZClcbiAgICAgICAgOiBTdHJpbmcocmF3UHJldmlvdXNJZClcbiAgICBjb25zdCBwcmV2aW91c0lkID0gcHJldmlvdXNJZGVudGl0eSA9PT0gbnVsbFxuICAgICAgPyBudWxsXG4gICAgICA6IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHByZXZpb3VzSWRlbnRpdHkpXG4gICAgY29uc3QgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyA9IGZyb250ZW5kTW9kZWxNYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKGJvZHkpXG5cbiAgICBpZiAoYWN0aW9uID09PSBcImRlc3Ryb3lcIikge1xuICAgICAgY29uc3QgbGlzdGVuZXIgPSB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLmdldChpZClcblxuICAgICAgaWYgKGxpc3RlbmVyKSB7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcykge1xuICAgICAgICAgIHRyeSB7IGVudHJ5LmNhbGxiYWNrKHtpZDogaWRlbnRpdHl9KSB9IGNhdGNoIChlcnJvcikgeyBjb25zb2xlLmVycm9yKGVycm9yKSB9XG4gICAgICAgIH1cbiAgICAgICAgZGVsZXRlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIodGhpcywgbGlzdGVuZXIpXG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHRoaXMuY2xhc3NEZXN0cm95Q2FsbGJhY2tzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgLyoqIEB0eXBlIHsocGF5bG9hZDoge2lkOiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0pID0+IHZvaWR9ICovIChlbnRyeS5jYWxsYmFjaykoe2lkOiBpZGVudGl0eX0pXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7IGNvbnNvbGUuZXJyb3IoZXJyb3IpIH1cbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGxpc3RlbmVyID0gdGhpcy5pbnN0YW5jZUxpc3RlbmVycy5nZXQoaWQpIHx8IChwcmV2aW91c0lkID09PSBudWxsID8gdW5kZWZpbmVkIDogdGhpcy5pbnN0YW5jZUxpc3RlbmVycy5nZXQocHJldmlvdXNJZCkpXG5cbiAgICBpZiAoYWN0aW9uID09PSBcInVwZGF0ZVwiICYmIGxpc3RlbmVyICYmIHByZXZpb3VzSWRlbnRpdHkgIT09IG51bGwpIHtcbiAgICAgIGFwcGx5RnJvbnRlbmRNb2RlbFBlcnNpc3RlZElkZW50aXR5KHRoaXMuTW9kZWxDbGFzcywgbGlzdGVuZXIuaW5zdGFuY2UsIGlkZW50aXR5KVxuICAgICAgcmVrZXlGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcnModGhpcy5Nb2RlbENsYXNzLCBsaXN0ZW5lci5pbnN0YW5jZSwgcHJldmlvdXNJZGVudGl0eSwgaWRlbnRpdHkpXG4gICAgfVxuXG4gICAgaWYgKCFib2R5LnJlY29yZCB8fCB0eXBlb2YgYm9keS5yZWNvcmQgIT09IFwib2JqZWN0XCIpIHJldHVyblxuXG4gICAgY29uc3QgZGVzZXJpYWxpemVkUmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShib2R5LnJlY29yZCkpXG4gICAgY29uc3QgZnJlc2hNb2RlbCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzLk1vZGVsQ2xhc3MpLmluc3RhbnRpYXRlRnJvbVJlc3BvbnNlKGRlc2VyaWFsaXplZFJlY29yZClcblxuICAgIGlmIChhY3Rpb24gPT09IFwidXBkYXRlXCIgJiYgbGlzdGVuZXIpIHtcbiAgICAgIGNvbnN0IGluc3RhbmNlQW55ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGxpc3RlbmVyLmluc3RhbmNlKVxuXG4gICAgICBpbnN0YW5jZUFueS5fYXR0YWNobWVudE93bmVyID0gZnJlc2hNb2RlbC5fYXR0YWNobWVudE93bmVyXG5cbiAgICAgIGNvbnN0IG1hdGNoaW5nVXBkYXRlQ2FsbGJhY2tzID0gQXJyYXkuZnJvbShsaXN0ZW5lci51cGRhdGVDYWxsYmFja3MpLmZpbHRlcigoZW50cnkpID0+XG4gICAgICAgIGZyb250ZW5kTW9kZWxFdmVudEVudHJ5TWF0Y2hlcyhlbnRyeSwgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cylcbiAgICAgIClcblxuICAgICAgaWYgKG1hdGNoaW5nVXBkYXRlQ2FsbGJhY2tzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgLy8gQXV0by1tZXJnZSBpbnRvIHRoZSByZWdpc3RlcmVkIGluc3RhbmNlIHNvIGNhbGxlcnMgcmVhZGluZ1xuICAgICAgICAvLyB0aHJvdWdoIHRoZSBzYW1lIGhhbmRsZSBzZWUgZnJlc2ggYXR0cmlidXRlcy5cbiAgICAgICAgaW5zdGFuY2VBbnkuYXNzaWduQXR0cmlidXRlcyhmcmVzaE1vZGVsLmF0dHJpYnV0ZXMoKSlcbiAgICAgICAgaW5zdGFuY2VBbnkuX3BlcnNpc3RlZEF0dHJpYnV0ZXMgPSBjbG9uZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKGxpc3RlbmVyLmluc3RhbmNlLmF0dHJpYnV0ZXMoKSlcblxuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIG1hdGNoaW5nVXBkYXRlQ2FsbGJhY2tzKSB7XG4gICAgICAgICAgdHJ5IHsgZW50cnkuY2FsbGJhY2soe2lkOiBpZGVudGl0eSwgbW9kZWw6IGxpc3RlbmVyLmluc3RhbmNlfSkgfSBjYXRjaCAoZXJyb3IpIHsgY29uc29sZS5lcnJvcihlcnJvcikgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgY2xhc3NDYWxsYmFja3MgPSBhY3Rpb24gPT09IFwiY3JlYXRlXCIgPyB0aGlzLmNsYXNzQ3JlYXRlQ2FsbGJhY2tzIDogdGhpcy5jbGFzc1VwZGF0ZUNhbGxiYWNrc1xuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBjbGFzc0NhbGxiYWNrcykge1xuICAgICAgaWYgKCFmcm9udGVuZE1vZGVsRXZlbnRFbnRyeU1hdGNoZXMoZW50cnksIG1hdGNoZWRFdmVudEZpbHRlcktleXMpKSBjb250aW51ZVxuXG4gICAgICB0cnkgeyBlbnRyeS5jYWxsYmFjayh7aWQ6IGlkZW50aXR5LCBtb2RlbDogZnJlc2hNb2RlbH0pIH0gY2F0Y2ggKGVycm9yKSB7IGNvbnNvbGUuZXJyb3IoZXJyb3IpIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXliZSB0ZWFyZG93bi5cbiAgICogQHJldHVybnMge3ZvaWR9ICovXG4gIG1heWJlVGVhcmRvd24oKSB7XG4gICAgY29uc3QgaGFzQW55TGlzdGVuZXIgPSB0aGlzLmNsYXNzQ3JlYXRlQ2FsbGJhY2tzLnNpemUgPiAwXG4gICAgICB8fCB0aGlzLmNsYXNzVXBkYXRlQ2FsbGJhY2tzLnNpemUgPiAwXG4gICAgICB8fCB0aGlzLmNsYXNzRGVzdHJveUNhbGxiYWNrcy5zaXplID4gMFxuICAgICAgfHwgdGhpcy5pbnN0YW5jZUxpc3RlbmVycy5zaXplID4gMFxuXG4gICAgaWYgKGhhc0FueUxpc3RlbmVyKSByZXR1cm5cblxuICAgIGlmICh0aGlzLmNoYW5uZWxIYW5kbGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuY2hhbm5lbEhhbmRsZS5jbG9zZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IG51bGxcbiAgICB0aGlzLnJlYWR5UHJvbWlzZSA9IG51bGxcbiAgICB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSA9IG51bGxcbiAgICByZWxlYXNlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKHRoaXMpXG4gIH1cbn1cblxuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCBldmVudCBzdWJzY3JpcHRpb25zLlxuICogQHR5cGUge1dlYWtNYXA8RnJvbnRlbmRNb2RlbENsYXNzLCBNYXA8c3RyaW5nLCBGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24+Pn0gKi9cbmNvbnN0IGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMgPSBuZXcgV2Vha01hcCgpXG5cbi8qKlxuICogUnVucyBlbnN1cmUgZnJvbnRlbmQgbW9kZWwgZXZlbnQgc3Vic2NyaXB0aW9uLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dH0gcmVxdWVzdENvbnRleHQgLSBDYXB0dXJlZCBzdWJzY3JpcHRpb24gY29udGV4dC5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb259IC0gUGVyLWNsYXNzIHN1YnNjcmlwdGlvbiBoZWxwZXIuXG4gKi9cbmZ1bmN0aW9uIGVuc3VyZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbihNb2RlbENsYXNzLCByZXF1ZXN0Q29udGV4dCkge1xuICBsZXQgc3Vic2NyaXB0aW9ucyA9IGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMuZ2V0KE1vZGVsQ2xhc3MpXG5cbiAgaWYgKCFzdWJzY3JpcHRpb25zKSB7XG4gICAgc3Vic2NyaXB0aW9ucyA9IG5ldyBNYXAoKVxuICAgIGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMuc2V0KE1vZGVsQ2xhc3MsIHN1YnNjcmlwdGlvbnMpXG4gIH1cblxuICBjb25zdCBjb250ZXh0S2V5ID0gcmVtb3RlUmVxdWVzdENvbnRleHRLZXkocmVxdWVzdENvbnRleHQpXG4gIGxldCBzdWIgPSBzdWJzY3JpcHRpb25zLmdldChjb250ZXh0S2V5KVxuXG4gIGlmICghc3ViKSB7XG4gICAgc3ViID0gbmV3IEZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbihNb2RlbENsYXNzLCByZXF1ZXN0Q29udGV4dClcbiAgICBzdWJzY3JpcHRpb25zLnNldChjb250ZXh0S2V5LCBzdWIpXG4gIH1cblxuICByZXR1cm4gc3ViXG59XG5cbi8qKlxuICogUmVtb3ZlcyBhbiBlbXB0eSBjb250ZXh0IGJ1Y2tldCBzbyBzd2l0Y2hpbmcgdGhyb3VnaCBtYW55IHRlbmFudHMgZG9lcyBub3QgcmV0YWluIGV2ZXJ5IHNuYXBzaG90LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb259IHN1YnNjcmlwdGlvbiAtIEVtcHR5IHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gcmVsZWFzZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbihzdWJzY3JpcHRpb24pIHtcbiAgY29uc3Qgc3Vic2NyaXB0aW9ucyA9IGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMuZ2V0KHN1YnNjcmlwdGlvbi5Nb2RlbENsYXNzKVxuICBjb25zdCBjb250ZXh0S2V5ID0gcmVtb3RlUmVxdWVzdENvbnRleHRLZXkoc3Vic2NyaXB0aW9uLnJlcXVlc3RDb250ZXh0KVxuXG4gIGlmIChzdWJzY3JpcHRpb25zPy5nZXQoY29udGV4dEtleSkgIT09IHN1YnNjcmlwdGlvbikgcmV0dXJuXG5cbiAgc3Vic2NyaXB0aW9ucy5kZWxldGUoY29udGV4dEtleSlcbiAgaWYgKHN1YnNjcmlwdGlvbnMuc2l6ZSA9PT0gMCkgZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5kZWxldGUoc3Vic2NyaXB0aW9uLk1vZGVsQ2xhc3MpXG59XG5cbi8qKlxuICogQ2FwdHVyZXMgdGhlIGN1cnJlbnQgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IGNvbnRleHQgZm9yIG9uZSBvcGVyYXRpb24uXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dH0gRnJvemVuIGNvbnRleHQgc25hcHNob3QuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCgpIHtcbiAgY29uc3QgY29uZmlndXJlZENvbnRleHQgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0Q29udGV4dCA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RDb250ZXh0KClcbiAgICA6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdENvbnRleHRcblxuICByZXR1cm4gY2FwdHVyZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChjb25maWd1cmVkQ29udGV4dClcbn1cblxuLyoqXG4gKiBDYXB0dXJlcyB0aGUgZXhwbGljaXQgbGlmZWN5Y2xlIGNvbnRleHQgb3IgZmFsbHMgYmFjayB0byB0aGUgY29uZmlndXJlZCB0cmFuc3BvcnQgY29udGV4dC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dCB8IHVuZGVmaW5lZH0gcmVxdWVzdENvbnRleHQgLSBSZWdpc3RyYXRpb24tbG9jYWwgY29udGV4dC5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0fSBGcm96ZW4gY29udGV4dCBzbmFwc2hvdC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpIHtcbiAgaWYgKHJlcXVlc3RDb250ZXh0ID09PSB1bmRlZmluZWQpIHJldHVybiBmcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoKVxuXG4gIHJldHVybiBjYXB0dXJlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KVxufVxuXG4vKipcbiAqIFJ1bnMgZW5zdXJlIGZyb250ZW5kIG1vZGVsIGluc3RhbmNlIGxpc3RlbmVyLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb259IHN1YiAtIEV2ZW50IHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gKiBAcGFyYW0ge3N0cmluZ30gaWQgLSBNb2RlbCBpZC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IGluc3RhbmNlIC0gTGlzdGVuZXIgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7e2luc3RhbmNlOiBGcm9udGVuZE1vZGVsQmFzZSwgdXBkYXRlQ2FsbGJhY2tzOiBTZXQ8RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5PGFueSwgYW55Pj4sIGRlc3Ryb3lDYWxsYmFja3M6IFNldDxGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50Q2FsbGJhY2tFbnRyeTxhbnk+Pn19IC0gSW5zdGFuY2UgbGlzdGVuZXIgYnVja2V0LlxuICovXG5mdW5jdGlvbiBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGlkLCBpbnN0YW5jZSkge1xuICBsZXQgbGlzdGVuZXIgPSBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KGlkKVxuXG4gIGlmICghbGlzdGVuZXIpIHtcbiAgICBsaXN0ZW5lciA9IHtpbnN0YW5jZSwgdXBkYXRlQ2FsbGJhY2tzOiBuZXcgU2V0KCksIGRlc3Ryb3lDYWxsYmFja3M6IG5ldyBTZXQoKX1cbiAgICBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuc2V0KGlkLCBsaXN0ZW5lcilcbiAgfSBlbHNlIHtcbiAgICBsaXN0ZW5lci5pbnN0YW5jZSA9IGluc3RhbmNlXG4gIH1cblxuICByZXR1cm4gbGlzdGVuZXJcbn1cblxuLyoqXG4gKiBSZW1vdmVzIGV2ZXJ5IGlkZW50aXR5IGtleSBwb2ludGluZyBhdCBhbiBpbnN0YW5jZSBsaXN0ZW5lci5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufSBzdWIgLSBFdmVudCBzdWJzY3JpcHRpb24gYnVja2V0LlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcj59IGxpc3RlbmVyIC0gSW5zdGFuY2UgbGlzdGVuZXIgYnVja2V0LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGRlbGV0ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyKHN1YiwgbGlzdGVuZXIpIHtcbiAgZm9yIChjb25zdCBbaWQsIGN1cnJlbnRdIG9mIHN1Yi5pbnN0YW5jZUxpc3RlbmVycykge1xuICAgIGlmIChjdXJyZW50ID09PSBsaXN0ZW5lcikgc3ViLmluc3RhbmNlTGlzdGVuZXJzLmRlbGV0ZShpZClcbiAgfVxufVxuXG4vKipcbiAqIFJlbW92ZXMgb25lIGluc3RhbmNlIGNhbGxiYWNrIGVudHJ5IGFuZCB0ZWFycyBkb3duIGFuIGVtcHR5IGxpc3RlbmVyL3N1YnNjcmlwdGlvbiBidWNrZXQuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gc3ViIC0gRXZlbnQgc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEBwYXJhbSB7KGxpc3RlbmVyOiBSZXR1cm5UeXBlPHR5cGVvZiBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcj4pID0+IGJvb2xlYW59IHJlbW92ZUVudHJ5IC0gQ2FsbGJhY2sgZW50cnkgcmVtb3ZhbC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgcmVtb3ZlRW50cnkpIHtcbiAgZm9yIChjb25zdCBjdXJyZW50IG9mIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy52YWx1ZXMoKSkge1xuICAgIGlmICghcmVtb3ZlRW50cnkoY3VycmVudCkpIGNvbnRpbnVlXG5cbiAgICBpZiAoY3VycmVudC51cGRhdGVDYWxsYmFja3Muc2l6ZSA9PT0gMCAmJiBjdXJyZW50LmRlc3Ryb3lDYWxsYmFja3Muc2l6ZSA9PT0gMCkge1xuICAgICAgZGVsZXRlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIoc3ViLCBjdXJyZW50KVxuICAgIH1cbiAgICBicmVha1xuICB9XG5cbiAgc3ViLm1heWJlVGVhcmRvd24oKVxufVxuXG4vKipcbiAqIFRlbXBvcmFyaWx5IHJlZ2lzdGVycyBhbiBpbnN0YW5jZSBsaXN0ZW5lciB1bmRlciBpdHMgcGVuZGluZyBpZGVudGl0eSB3aGlsZSByZXRhaW5pbmcgaXRzIHBlcnNpc3RlZCBpZGVudGl0eS5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBpbnN0YW5jZSAtIEluc3RhbmNlIGJlaW5nIHJlLWtleWVkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gcHJldmlvdXNJZGVudGl0eSAtIFBlcnNpc3RlZCBpZGVudGl0eS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IG5leHRJZGVudGl0eSAtIFBlbmRpbmcgaWRlbnRpdHkgc2VudCB0byB0aGUgc2VydmVyLlxuICogQHJldHVybnMgeygpID0+IHZvaWR9IC0gQ2FsbGJhY2sgdGhhdCByZW1vdmVzIHRoZSB0ZW1wb3JhcnkgYWxpYXNlcy5cbiAqL1xuZnVuY3Rpb24gYWxpYXNGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcnMoTW9kZWxDbGFzcywgaW5zdGFuY2UsIHByZXZpb3VzSWRlbnRpdHksIG5leHRJZGVudGl0eSkge1xuICBjb25zdCBwcmltYXJ5S2V5ID0gTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgY29uc3QgcHJldmlvdXNJZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHByZXZpb3VzSWRlbnRpdHkpXG4gIGNvbnN0IG5leHRJZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIG5leHRJZGVudGl0eSlcbiAgLyoqIEB0eXBlIHtBcnJheTx7bGlzdGVuZXI6IFJldHVyblR5cGU8dHlwZW9mIGVuc3VyZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyPiwgc3ViOiBGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb259Pn0gKi9cbiAgY29uc3QgYWxpYXNlcyA9IFtdXG5cbiAgaWYgKHByZXZpb3VzSWQgPT09IG5leHRJZCkgcmV0dXJuICgpID0+IHt9XG5cbiAgY29uc3Qgc3Vic2NyaXB0aW9ucyA9IGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMuZ2V0KE1vZGVsQ2xhc3MpXG5cbiAgaWYgKCFzdWJzY3JpcHRpb25zKSByZXR1cm4gKCkgPT4ge31cblxuICBmb3IgKGNvbnN0IHN1YiBvZiBzdWJzY3JpcHRpb25zLnZhbHVlcygpKSB7XG4gICAgY29uc3QgbGlzdGVuZXIgPSBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KHByZXZpb3VzSWQpXG5cbiAgICBpZiAoIWxpc3RlbmVyIHx8IGxpc3RlbmVyLmluc3RhbmNlICE9PSBpbnN0YW5jZSB8fCBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuaGFzKG5leHRJZCkpIGNvbnRpbnVlXG5cbiAgICBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuc2V0KG5leHRJZCwgbGlzdGVuZXIpXG4gICAgYWxpYXNlcy5wdXNoKHtsaXN0ZW5lciwgc3VifSlcbiAgfVxuXG4gIHJldHVybiAoKSA9PiB7XG4gICAgZm9yIChjb25zdCB7bGlzdGVuZXIsIHN1Yn0gb2YgYWxpYXNlcykge1xuICAgICAgaWYgKHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQocHJldmlvdXNJZCkgPT09IGxpc3RlbmVyICYmIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQobmV4dElkKSA9PT0gbGlzdGVuZXIpIHtcbiAgICAgICAgc3ViLmluc3RhbmNlTGlzdGVuZXJzLmRlbGV0ZShuZXh0SWQpXG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQXBwbGllcyBhIHJlbW90ZWx5IHBlcnNpc3RlZCBpZGVudGl0eSB0byBhIGxpc3RlbmVyIGluc3RhbmNlIHdpdGhvdXQgbWVyZ2luZyBhbiB1bmF2YWlsYWJsZSByZWNvcmQgcGF5bG9hZC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBpbnN0YW5jZSAtIExpc3RlbmVyIGluc3RhbmNlIHJlY2VpdmluZyB0aGUgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZGVudGl0eSAtIFBlcnNpc3RlZCBpZGVudGl0eS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhcHBseUZyb250ZW5kTW9kZWxQZXJzaXN0ZWRJZGVudGl0eShNb2RlbENsYXNzLCBpbnN0YW5jZSwgaWRlbnRpdHkpIHtcbiAgY29uc3QgaWRlbnRpdHlBdHRyaWJ1dGVzID0gbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgaWRlbnRpdHkpXG5cbiAgaW5zdGFuY2UuYXNzaWduQXR0cmlidXRlcyhpZGVudGl0eUF0dHJpYnV0ZXMpXG5cbiAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIE9iamVjdC5rZXlzKGlkZW50aXR5QXR0cmlidXRlcykpIHtcbiAgICBpbnN0YW5jZS5tYXJrQXR0cmlidXRlVW5jaGFuZ2VkKGF0dHJpYnV0ZU5hbWUpXG4gIH1cbn1cblxuLyoqXG4gKiBNb3ZlcyBjYWxsYmFja3MgcmVnaXN0ZXJlZCBvbiBhbiBpbnN0YW5jZSB0byBpdHMgbmV3bHkgcGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IGluc3RhbmNlIC0gUmUta2V5ZWQgaW5zdGFuY2UuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBwcmV2aW91c0lkZW50aXR5IC0gUHJldmlvdXMgcGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gbmV4dElkZW50aXR5IC0gTmV3IHBlcnNpc3RlZCBpZGVudGl0eS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZWtleUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyhNb2RlbENsYXNzLCBpbnN0YW5jZSwgcHJldmlvdXNJZGVudGl0eSwgbmV4dElkZW50aXR5KSB7XG4gIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICBjb25zdCBwcmV2aW91c0lkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcHJldmlvdXNJZGVudGl0eSlcbiAgY29uc3QgbmV4dElkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgbmV4dElkZW50aXR5KVxuXG4gIGlmIChwcmV2aW91c0lkID09PSBuZXh0SWQpIHJldHVyblxuXG4gIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmdldChNb2RlbENsYXNzKVxuXG4gIGlmICghc3Vic2NyaXB0aW9ucykgcmV0dXJuXG5cbiAgZm9yIChjb25zdCBzdWIgb2Ygc3Vic2NyaXB0aW9ucy52YWx1ZXMoKSkge1xuICAgIGNvbnN0IGxpc3RlbmVyID0gc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChwcmV2aW91c0lkKVxuXG4gICAgaWYgKCFsaXN0ZW5lciB8fCBsaXN0ZW5lci5pbnN0YW5jZSAhPT0gaW5zdGFuY2UpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBuZXh0TGlzdGVuZXIgPSBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KG5leHRJZClcblxuICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5kZWxldGUocHJldmlvdXNJZClcblxuICAgIGlmIChuZXh0TGlzdGVuZXIpIHtcbiAgICAgIG5leHRMaXN0ZW5lci5pbnN0YW5jZSA9IGluc3RhbmNlXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcykgbmV4dExpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcy5hZGQoZW50cnkpXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxpc3RlbmVyLmRlc3Ryb3lDYWxsYmFja3MpIG5leHRMaXN0ZW5lci5kZXN0cm95Q2FsbGJhY2tzLmFkZChlbnRyeSlcbiAgICB9IGVsc2Uge1xuICAgICAgc3ViLmluc3RhbmNlTGlzdGVuZXJzLnNldChuZXh0SWQsIGxpc3RlbmVyKVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY29tbWFuZCB1cmwuXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVzb3VyY2VQYXRoIC0gUmVzb3VyY2UgcGF0aCBwcmVmaXguXG4gKiBAcGFyYW0ge3N0cmluZ30gY29tbWFuZE5hbWUgLSBDb21tYW5kIHBhdGggc2VnbWVudC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRnJvbnRlbmQgbW9kZWwgQVBJIFVSTC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbENvbW1hbmRVcmwocmVzb3VyY2VQYXRoLCBjb21tYW5kTmFtZSkge1xuICBjb25zdCBjb25maWd1cmVkVXJsID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybCgpXG4gIGNvbnN0IG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGggPSByZXNvdXJjZVBhdGguc3RhcnRzV2l0aChcIi9cIikgPyByZXNvdXJjZVBhdGggOiBgLyR7cmVzb3VyY2VQYXRofWBcblxuICByZXR1cm4gYCR7Y29uZmlndXJlZFVybH0ke25vcm1hbGl6ZWRSZXNvdXJjZVBhdGh9LyR7Y29tbWFuZE5hbWV9YFxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgYXBpIHVybC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSBVUkwuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxBcGlVcmwoKSB7XG4gIHJldHVybiBgJHtmcm9udGVuZE1vZGVsVHJhbnNwb3J0VXJsKCl9JHtTSEFSRURfRlJPTlRFTkRfTU9ERUxfQVBJX1BBVEh9YFxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHBhdGguXG4gKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gUmVxdWVzdCBVUkwgb3IgcGF0aC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gV2Vic29ja2V0LXNhZmUgcmVxdWVzdCBwYXRoLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0UGF0aCh1cmwpIHtcbiAgaWYgKHR5cGVvZiB1cmwgIT09IFwic3RyaW5nXCIgfHwgdXJsLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBVUkwvcGF0aCwgZ290OiAke3VybH1gKVxuICB9XG5cbiAgaWYgKHVybC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgIHJldHVybiB1cmxcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkVXJsID0gbmV3IFVSTCh1cmwpXG5cbiAgICByZXR1cm4gYCR7cGFyc2VkVXJsLnBhdGhuYW1lfSR7cGFyc2VkVXJsLnNlYXJjaH1gXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB1cmxcbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBicm93c2VyIHJ1bnRpbWUgdGltZXpvbmUgd2hlbiBhdmFpbGFibGUuXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIEJyb3dzZXIgcnVudGltZSB0aW1lem9uZSB3aGVuIGF2YWlsYWJsZS5cbiAqL1xuZnVuY3Rpb24gZGVmYXVsdEZyb250ZW5kTW9kZWxUaW1lWm9uZSgpIHtcbiAgaWYgKHR5cGVvZiB3aW5kb3cgPT09IFwidW5kZWZpbmVkXCIpIHJldHVybiB1bmRlZmluZWRcblxuICBjb25zdCBpbnRsID0gZ2xvYmFsVGhpcy5JbnRsXG5cbiAgaWYgKCFpbnRsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgSW50bCB0byBiZSBhdmFpbGFibGUgZm9yIGJyb3dzZXIgdGltZXpvbmUgZGV0ZWN0aW9uXCIpXG4gIH1cblxuICBpZiAodHlwZW9mIGludGwuRGF0ZVRpbWVGb3JtYXQgIT09IFwiZnVuY3Rpb25cIikge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIEludGwuRGF0ZVRpbWVGb3JtYXQgdG8gYmUgYXZhaWxhYmxlIGFzIGEgZnVuY3Rpb25cIilcbiAgfVxuXG4gIGNvbnN0IHRpbWVab25lID0gaW50bC5EYXRlVGltZUZvcm1hdCgpLnJlc29sdmVkT3B0aW9ucygpLnRpbWVab25lXG5cbiAgaWYgKHR5cGVvZiB0aW1lWm9uZSAhPT0gXCJzdHJpbmdcIiB8fCB0aW1lWm9uZS50cmltKCkubGVuZ3RoIDwgMSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIEludGwuRGF0ZVRpbWVGb3JtYXQgdG8gcmVzb2x2ZSBhIGJyb3dzZXIgdGltZXpvbmUgc3RyaW5nXCIpXG4gIH1cblxuICByZXR1cm4gdmFsaWRhdGVUaW1lWm9uZSh0aW1lWm9uZSwgXCJicm93c2VyIHRpbWVab25lXCIpXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGNvbmZpZ3VyZWQgZnJvbnRlbmQtbW9kZWwgcmVxdWVzdCB0aW1lem9uZS5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQ29uZmlndXJlZCBmcm9udGVuZC1tb2RlbCB0aW1lem9uZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKCkge1xuICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLCBcInRpbWVab25lXCIpKSB7XG4gICAgcmV0dXJuIGRlZmF1bHRGcm9udGVuZE1vZGVsVGltZVpvbmUoKVxuICB9XG5cbiAgY29uc3QgdGltZVpvbmUgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lWm9uZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lKClcbiAgICA6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZVpvbmVcblxuICBpZiAodGltZVpvbmUgPT09IHVuZGVmaW5lZCB8fCB0aW1lWm9uZSA9PT0gbnVsbCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB0aW1lWm9uZSBkaWQgbm90IHJlc29sdmUgdG8gYSB0aW1lem9uZSBzdHJpbmdcIilcbiAgfVxuXG4gIHJldHVybiB2YWxpZGF0ZVRpbWVab25lKHRpbWVab25lLCBcImZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB0aW1lWm9uZVwiKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVxdWVzdCBoZWFkZXJzLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IFt0aW1lWm9uZV0gLSBQcmUtcmVzb2x2ZWQgdGltZXpvbmUgZm9yIHRoaXMgcmVxdWVzdC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIEhlYWRlcnMgZm9yIGZyb250ZW5kLW1vZGVsIEhUVFAgcmVxdWVzdHMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXF1ZXN0SGVhZGVycyh0aW1lWm9uZSA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpKSB7XG4gIGNvbnN0IGR5bmFtaWNIZWFkZXJzID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdEhlYWRlcnMgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdEhlYWRlcnMoKSB8fCB7fSlcbiAgICA6IChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RIZWFkZXJzIHx8IHt9KVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovXG4gIGNvbnN0IGhlYWRlcnMgPSB7XCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsIC4uLmR5bmFtaWNIZWFkZXJzfVxuXG4gIGlmICh0aW1lWm9uZSkge1xuICAgIGhlYWRlcnNbUkVRVUVTVF9USU1FX1pPTkVfSEVBREVSXSA9IHRpbWVab25lXG4gIH1cblxuICByZXR1cm4gaGVhZGVyc1xufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBjb25maWd1cmVkIGJvdW5kZWQgdHJhbnNwb3J0IGRlYWRsaW5lIGluIG1pbGxpc2Vjb25kcy5cbiAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gQ29uZmlndXJlZCBkZWFkbGluZSwgb3IgdW5kZWZpbmVkIHdoZW4gbm8gZGVhZGxpbmUgaXMgc2V0LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKCkge1xuICBjb25zdCBjb25maWd1cmVkVGltZW91dCA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVvdXQgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lb3V0KClcbiAgICA6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZW91dFxuXG4gIGlmICh0eXBlb2YgY29uZmlndXJlZFRpbWVvdXQgIT09IFwibnVtYmVyXCIgfHwgIShjb25maWd1cmVkVGltZW91dCA+IDApKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgcmV0dXJuIGNvbmZpZ3VyZWRUaW1lb3V0XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGNvbmZpZ3VyZWQgY2FsbGVyL3Nlc3Npb24gQWJvcnRTaWduYWwgY29tcG9zZWQgd2l0aCB0aGUgZGVhZGxpbmUuXG4gKiBAcmV0dXJucyB7QWJvcnRTaWduYWwgfCB1bmRlZmluZWR9IC0gQ29uZmlndXJlZCBjYWxsZXIgc2lnbmFsLCBvciB1bmRlZmluZWQgd2hlbiBub25lIGlzIHNldC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpIHtcbiAgY29uc3QgY29uZmlndXJlZFNpZ25hbCA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNpZ25hbCA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNpZ25hbCgpXG4gICAgOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNpZ25hbFxuXG4gIHJldHVybiBjb25maWd1cmVkU2lnbmFsIHx8IHVuZGVmaW5lZFxufVxuXG4vKipcbiAqIFJlc29sdmVzIHBlci1zdGFydHVwIGNvbnRyb2xzIHdpdGggdGhlIGNvbmZpZ3VyZWQgc2Vzc2lvbiBjYW5jZWxsYXRpb24uXG4gKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIsIHNpZ25hbD86IEFib3J0U2lnbmFsfX0gY29udHJvbHMgLSBDYWxsIGNvbnRyb2xzLlxuICogQHJldHVybnMge3t0aW1lb3V0TXM/OiBudW1iZXIsIHNpZ25hbD86IEFib3J0U2lnbmFsfX0gLSBFZmZlY3RpdmUgc3RhcnR1cCBjb250cm9scy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFdlYnNvY2tldFN0YXJ0dXBDb250cm9scyhjb250cm9scykge1xuICBjb25zdCBzZXNzaW9uU2lnbmFsID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpXG4gIGxldCBzaWduYWwgPSBjb250cm9scy5zaWduYWwgfHwgc2Vzc2lvblNpZ25hbFxuXG4gIGlmIChjb250cm9scy5zaWduYWwgJiYgc2Vzc2lvblNpZ25hbCAmJiBjb250cm9scy5zaWduYWwgIT09IHNlc3Npb25TaWduYWwpIHtcbiAgICBzaWduYWwgPSBBYm9ydFNpZ25hbC5hbnkoW2NvbnRyb2xzLnNpZ25hbCwgc2Vzc2lvblNpZ25hbF0pXG4gIH1cblxuICBjb25zdCBjb25maWd1cmVkVGltZW91dE1zID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVvdXRNcygpXG4gIGNvbnN0IHRpbWVvdXRNcyA9IGNvbnRyb2xzLnRpbWVvdXRNcyA9PT0gdW5kZWZpbmVkXG4gICAgPyBjb25maWd1cmVkVGltZW91dE1zXG4gICAgOiBjb25maWd1cmVkVGltZW91dE1zID09PSB1bmRlZmluZWRcbiAgICAgID8gY29udHJvbHMudGltZW91dE1zXG4gICAgICA6IE1hdGgubWluKGNvbnRyb2xzLnRpbWVvdXRNcywgY29uZmlndXJlZFRpbWVvdXRNcylcblxuICByZXR1cm4ge3NpZ25hbCwgdGltZW91dE1zfVxufVxuXG4vKipcbiAqIFJ1bnMgcGVyZm9ybSBzaGFyZWQgZnJvbnRlbmQgbW9kZWwgYXBpIHJlcXVlc3QuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcmVxdWVzdFBheWxvYWQgLSBTaGFyZWQgcmVxdWVzdCBwYXlsb2FkLlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBEZWNvZGVkIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgcmVzcG9uc2UuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHBlcmZvcm1TaGFyZWRGcm9udGVuZE1vZGVsQXBpUmVxdWVzdChyZXF1ZXN0UGF5bG9hZCkge1xuICBjb25zdCB0aW1lWm9uZSA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpXG4gIGNvbnN0IHNlcmlhbGl6ZWRSZXF1ZXN0UGF5bG9hZCA9IHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShyZXF1ZXN0UGF5bG9hZCwge3RpbWVab25lfSlcbiAgY29uc3Qgd2Vic29ja2V0Q2xpZW50ID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnRcbiAgY29uc3QgdXJsID0gZnJvbnRlbmRNb2RlbEFwaVVybCgpXG4gIGNvbnN0IG1lcmdlZEhlYWRlcnMgPSBmcm9udGVuZE1vZGVsUmVxdWVzdEhlYWRlcnModGltZVpvbmUpXG5cbiAgcmV0dXJuIGF3YWl0IHJ1bldpdGhUcmFuc3BvcnREZWFkbGluZShcbiAgICB7XG4gICAgICBlcnJvck1lc3NhZ2U6IFwiU2hhcmVkIGZyb250ZW5kIG1vZGVsIEFQSSByZXF1ZXN0IHRpbWVkIG91dFwiLFxuICAgICAgc2lnbmFsOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCksXG4gICAgICB0aW1lb3V0TXM6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lb3V0TXMoKVxuICAgIH0sXG4gICAgYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgaWYgKHdlYnNvY2tldENsaWVudCkge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHdlYnNvY2tldENsaWVudC5wb3N0KGZyb250ZW5kTW9kZWxUcmFuc3BvcnRQYXRoKHVybCksIHNlcmlhbGl6ZWRSZXF1ZXN0UGF5bG9hZCwge1xuICAgICAgICAgIGhlYWRlcnM6IG1lcmdlZEhlYWRlcnMsXG4gICAgICAgICAgc2lnbmFsXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlSnNvbiA9IHJlc3BvbnNlLmpzb24oKVxuXG4gICAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHJlc3BvbnNlSnNvbikpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHNlcmlhbGl6ZWRSZXF1ZXN0UGF5bG9hZCksXG4gICAgICAgIGNyZWRlbnRpYWxzOiBcImluY2x1ZGVcIixcbiAgICAgICAgaGVhZGVyczogbWVyZ2VkSGVhZGVycyxcbiAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgc2lnbmFsXG4gICAgICB9KVxuXG4gICAgICBjb25zdCByZXNwb25zZVRleHQgPSBhd2FpdCByZXNwb25zZS50ZXh0KClcblxuICAgICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgICB0aHJvd0Zyb250ZW5kTW9kZWxIdHRwRXJyb3Ioe1xuICAgICAgICAgIGNvbW1hbmRMYWJlbDogXCJzaGFyZWQgZnJvbnRlbmQgbW9kZWwgQVBJXCIsXG4gICAgICAgICAgcmVzcG9uc2UsXG4gICAgICAgICAgcmVzcG9uc2VUZXh0XG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGpzb24gPSByZXNwb25zZVRleHQubGVuZ3RoID4gMCA/IEpTT04ucGFyc2UocmVzcG9uc2VUZXh0KSA6IHt9XG5cbiAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGpzb24pKVxuICAgIH1cbiAgKVxufVxuXG4vKipcbiAqIFRocm93cyBhIGZyb250ZW5kLW1vZGVsIEhUVFAgZXJyb3Igd2l0aCBiYWNrZW5kLXByb3ZpZGVkIGVudmVsb3BlIGRldGFpbHMgd2hlbiBhdmFpbGFibGUuXG4gKiBAcGFyYW0ge3tjb21tYW5kTGFiZWw6IHN0cmluZywgcmVzcG9uc2U6IFJlc3BvbnNlLCByZXNwb25zZVRleHQ6IHN0cmluZ319IGFyZ3MgLSBFcnJvciByZXNwb25zZSBkZXRhaWxzLlxuICogQHJldHVybnMge25ldmVyfSAtIEFsd2F5cyB0aHJvd3MgYW4gdW5rbm93bi1hdHRyaWJ1dGUgZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIHRocm93RnJvbnRlbmRNb2RlbEh0dHBFcnJvcih7Y29tbWFuZExhYmVsLCByZXNwb25zZSwgcmVzcG9uc2VUZXh0fSkge1xuICAvLyBTdXJmYWNlIHRoZSBiYWNrZW5kJ3MgZnJpZW5kbHkgZXJyb3JNZXNzYWdlIGVudmVsb3BlICh0aGVcbiAgLy8gYHtzdGF0dXM6IFwiZXJyb3JcIiwgZXJyb3JNZXNzYWdlOiBcIi4uLlwifWAgc2hhcGUgZXZlcnkgY29udHJvbGxlclxuICAvLyBzaGlwcyBvbiBpdHMgNHh4LzV4eCByZXNwb25zZXMpIGluc3RlYWQgb2YgdGhlIGdlbmVyaWMgc3RhdHVzXG4gIC8vIHN0cmluZy4gRmFsbCB0aHJvdWdoIHRvIHRoZSBzdGF0dXMtb25seSBtZXNzYWdlIHdoZW4gdGhlIGJvZHkgaXNcbiAgLy8gbWlzc2luZywgbm9uLUpTT04sIG9yIGhhcyBubyB1c2FibGUgZXJyb3JNZXNzYWdlIGZpZWxkLlxuICBjb25zdCByZXNwb25zZUNvbnRlbnRUeXBlID0gcmVzcG9uc2UuaGVhZGVycy5nZXQoXCJjb250ZW50LXR5cGVcIilcblxuICBpZiAocmVzcG9uc2VDb250ZW50VHlwZSAmJiByZXNwb25zZUNvbnRlbnRUeXBlLmluY2x1ZGVzKFwiYXBwbGljYXRpb24vanNvblwiKSAmJiByZXNwb25zZVRleHQubGVuZ3RoID4gMCkge1xuICAgIC8qKlxuICAgICAqIERlZmluZXMgZXJyb3JCb2R5LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSAqL1xuICAgIGxldCBlcnJvckJvZHlcblxuICAgIHRyeSB7XG4gICAgICBlcnJvckJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlVGV4dClcbiAgICB9IGNhdGNoIHtcbiAgICAgIGVycm9yQm9keSA9IG51bGxcbiAgICB9XG5cbiAgICBpZiAoZXJyb3JCb2R5ICYmIHR5cGVvZiBlcnJvckJvZHkuZXJyb3JNZXNzYWdlID09PSBcInN0cmluZ1wiICYmIGVycm9yQm9keS5lcnJvck1lc3NhZ2UudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvckJvZHkuZXJyb3JNZXNzYWdlLnRyaW0oKSlcbiAgICB9XG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoYFJlcXVlc3QgZmFpbGVkICgke3Jlc3BvbnNlLnN0YXR1c30pIGZvciAke2NvbW1hbmRMYWJlbH1gKVxufVxuXG4vKipcbiAqIFJ1bnMgZmx1c2ggcGVuZGluZyBzaGFyZWQgZnJvbnRlbmQgbW9kZWwgcmVxdWVzdHMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBwZW5kaW5nIHNoYXJlZCBmcm9udGVuZC1tb2RlbCByZXF1ZXN0cyBmbHVzaC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZmx1c2hQZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzKCkge1xuICBzaGFyZWRGcm9udGVuZE1vZGVsRmx1c2hTY2hlZHVsZWQgPSBmYWxzZVxuXG4gIGlmIChwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzLmxlbmd0aCA8IDEpIHtcbiAgICByZXNvbHZlRnJvbnRlbmRNb2RlbElkbGVXYWl0ZXJzKClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IGJhdGNoZWRSZXF1ZXN0cyA9IHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHNcbiAgcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cyA9IFtdXG5cbiAgY29uc3QgdXJsID0gZnJvbnRlbmRNb2RlbEFwaVVybCgpXG4gIGNvbnN0IHJlcXVlc3RQYXlsb2FkID0ge1xuICAgIHJlcXVlc3RzOiBiYXRjaGVkUmVxdWVzdHMubWFwKChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAocmVxdWVzdC5jdXN0b21QYXRoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZFR5cGU6IHJlcXVlc3QuY29tbWFuZFR5cGUsXG4gICAgICAgICAgY3VzdG9tUGF0aDogcmVxdWVzdC5jdXN0b21QYXRoLFxuICAgICAgICAgIG1vZGVsOiByZXF1ZXN0Lm1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgICAgcGF5bG9hZDogcmVxdWVzdC5wYXlsb2FkLFxuICAgICAgICAgIC4uLihPYmplY3Qua2V5cyhyZXF1ZXN0LnJlcXVlc3RDb250ZXh0KS5sZW5ndGggPiAwID8ge3JlcXVlc3RDb250ZXh0OiByZXF1ZXN0LnJlcXVlc3RDb250ZXh0fSA6IHt9KSxcbiAgICAgICAgICByZXF1ZXN0SWQ6IHJlcXVlc3QucmVxdWVzdElkXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29tbWFuZFR5cGU6IHJlcXVlc3QuY29tbWFuZFR5cGUsXG4gICAgICAgIG1vZGVsOiByZXF1ZXN0Lm1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgIHBheWxvYWQ6IHJlcXVlc3QucGF5bG9hZCxcbiAgICAgICAgLi4uKE9iamVjdC5rZXlzKHJlcXVlc3QucmVxdWVzdENvbnRleHQpLmxlbmd0aCA+IDAgPyB7cmVxdWVzdENvbnRleHQ6IHJlcXVlc3QucmVxdWVzdENvbnRleHR9IDoge30pLFxuICAgICAgICByZXF1ZXN0SWQ6IHJlcXVlc3QucmVxdWVzdElkXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIGF3YWl0IHRyYWNrRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3QoYXN5bmMgKCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICB2b2lkIHVybFxuICAgICAgY29uc3QgZGVjb2RlZFJlc3BvbnNlID0gYXdhaXQgcGVyZm9ybVNoYXJlZEZyb250ZW5kTW9kZWxBcGlSZXF1ZXN0KHJlcXVlc3RQYXlsb2FkKVxuICAgICAgY29uc3QgcmVzcG9uc2VzID0gQXJyYXkuaXNBcnJheShkZWNvZGVkUmVzcG9uc2UucmVzcG9uc2VzKSA/IGRlY29kZWRSZXNwb25zZS5yZXNwb25zZXMgOiBbXVxuICAgICAgY29uc3QgcmVzcG9uc2VzQnlJZCA9IG5ldyBNYXAocmVzcG9uc2VzLm1hcCgoZW50cnkpID0+IFtlbnRyeS5yZXF1ZXN0SWQsIGVudHJ5LnJlc3BvbnNlXSkpXG5cbiAgICAgIGZvciAoY29uc3QgcmVxdWVzdCBvZiBiYXRjaGVkUmVxdWVzdHMpIHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2VQYXlsb2FkID0gcmVzcG9uc2VzQnlJZC5nZXQocmVxdWVzdC5yZXF1ZXN0SWQpXG5cbiAgICAgICAgaWYgKCFyZXNwb25zZVBheWxvYWQgfHwgdHlwZW9mIHJlc3BvbnNlUGF5bG9hZCAhPT0gXCJvYmplY3RcIikge1xuICAgICAgICAgIHJlcXVlc3QucmVqZWN0KG5ldyBFcnJvcihgTWlzc2luZyBiYXRjaGVkIHJlc3BvbnNlIGZvciAke3JlcXVlc3QubW9kZWxDbGFzcy5uYW1lfSMke3JlcXVlc3QuY29tbWFuZFR5cGV9YCkpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIHJlcXVlc3QucmVzb2x2ZSgvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJlc3BvbnNlUGF5bG9hZCkpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGZvciAoY29uc3QgcmVxdWVzdCBvZiBiYXRjaGVkUmVxdWVzdHMpIHtcbiAgICAgICAgcmVxdWVzdC5yZWplY3QoZXJyb3IpXG4gICAgICB9XG4gICAgfVxuICB9KVxufVxuXG4vKipcbiAqIFJ1bnMgc2NoZWR1bGUgc2hhcmVkIGZyb250ZW5kIG1vZGVsIHJlcXVlc3QgZmx1c2guXG4gKiBAcmV0dXJucyB7dm9pZH0gKi9cbmZ1bmN0aW9uIHNjaGVkdWxlU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RGbHVzaCgpIHtcbiAgaWYgKHNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZCkgcmV0dXJuXG5cbiAgc2hhcmVkRnJvbnRlbmRNb2RlbEZsdXNoU2NoZWR1bGVkID0gdHJ1ZVxuICBxdWV1ZU1pY3JvdGFzaygoKSA9PiB7XG4gICAgdm9pZCBmbHVzaFBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMoKVxuICB9KVxufVxuXG4vKipcbiAqIEN1c3RvbSBjb21tYW5kcyBzdGlsbCB1c2UgdGhlIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkuIFRoaXMgaGVscGVyIG9ubHkgYnVpbGRzIHRoZSBiYWNrZW5kIHJvdXRlIHBhdGggdGhlIHNlcnZlciBzaG91bGQgZGlzcGF0Y2ggYWZ0ZXIgdmFsaWRhdGluZyB0aGUgc2VnbWVudHMuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbW1hbmROYW1lIC0gQ29tbWFuZCBwYXRoIHNlZ21lbnQuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tb2RlbE5hbWUgLSBGcm9udGVuZCBtb2RlbCBjbGFzcyBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBbYXJncy5tZW1iZXJJZF0gLSBPcHRpb25hbCBtZW1iZXIgaWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXNvdXJjZVBhdGggLSBSZXNvdXJjZSBwYXRoIHByZWZpeC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQ3VzdG9tIGJhY2tlbmQgcm91dGUgcGF0aC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRQYXRoKHtjb21tYW5kTmFtZSwgbWVtYmVySWQsIG1vZGVsTmFtZSwgcmVzb3VyY2VQYXRofSkge1xuICBjb25zdCB2YWxpZGF0ZWRSZXNvdXJjZVBhdGggPSB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgoe21vZGVsTmFtZSwgcmVzb3VyY2VQYXRofSlcbiAgY29uc3QgdmFsaWRhdGVkQ29tbWFuZE5hbWUgPSB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbW1hbmROYW1lKHtjb21tYW5kTmFtZSwgY29tbWFuZFR5cGU6IGNvbW1hbmROYW1lLCBtb2RlbE5hbWV9KVxuXG4gIGlmIChtZW1iZXJJZCA9PT0gdW5kZWZpbmVkIHx8IG1lbWJlcklkID09PSBudWxsIHx8IG1lbWJlcklkID09PSBcIlwiKSB7XG4gICAgcmV0dXJuIGAke3ZhbGlkYXRlZFJlc291cmNlUGF0aH0vJHt2YWxpZGF0ZWRDb21tYW5kTmFtZX1gXG4gIH1cblxuICByZXR1cm4gYCR7dmFsaWRhdGVkUmVzb3VyY2VQYXRofS8ke2VuY29kZVVSSUNvbXBvbmVudChTdHJpbmcobWVtYmVySWQpKX0vJHt2YWxpZGF0ZWRDb21tYW5kTmFtZX1gXG59XG5cbi8qKlxuICogUnVucyBhc3NlcnQgZmluZCBieSBjb25kaXRpb25zIHNoYXBlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gY29uZGl0aW9ucyAtIGZpbmRCeSBjb25kaXRpb25zLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydEZpbmRCeUNvbmRpdGlvbnNTaGFwZShjb25kaXRpb25zKSB7XG4gIGlmICghY29uZGl0aW9ucyB8fCB0eXBlb2YgY29uZGl0aW9ucyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNvbmRpdGlvbnMpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZXhwZWN0cyBjb25kaXRpb25zIHRvIGJlIGEgcGxhaW4gb2JqZWN0LCBnb3Q6ICR7Y29uZGl0aW9uc31gKVxuICB9XG5cbiAgY29uc3QgY29uZGl0aW9uc1Byb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihjb25kaXRpb25zKVxuXG4gIGlmIChjb25kaXRpb25zUHJvdG90eXBlICE9PSBPYmplY3QucHJvdG90eXBlICYmIGNvbmRpdGlvbnNQcm90b3R5cGUgIT09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBleHBlY3RzIGNvbmRpdGlvbnMgdG8gYmUgYSBwbGFpbiBvYmplY3QsIGdvdDogJHtjb25kaXRpb25zfWApXG4gIH1cblxuICBjb25zdCBzeW1ib2xLZXlzID0gT2JqZWN0LmdldE93blByb3BlcnR5U3ltYm9scyhjb25kaXRpb25zKVxuXG4gIGlmIChzeW1ib2xLZXlzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IHN5bWJvbCBjb25kaXRpb24ga2V5cyAoa2V5czogJHtzeW1ib2xLZXlzLm1hcCgoa2V5KSA9PiBrZXkudG9TdHJpbmcoKSkuam9pbihcIiwgXCIpfSlgKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBhc3NlcnQgZGVmaW5lZCBmaW5kIGJ5IGNvbmRpdGlvbiB2YWx1ZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZGl0aW9uIHZhbHVlIHRvIHZhbGlkYXRlLlxuICogQHBhcmFtIHtzdHJpbmd9IGtleVBhdGggLSBLZXkgcGF0aCBmb3IgZXJyb3Igb3V0cHV0LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydERlZmluZWRGaW5kQnlDb25kaXRpb25WYWx1ZSh2YWx1ZSwga2V5UGF0aCkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgdW5kZWZpbmVkIGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBmdW5jdGlvbiBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3ltYm9sXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IHN5bWJvbCBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwiYmlnaW50XCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IGJpZ2ludCBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgIU51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IG5vbi1maW5pdGUgbnVtYmVyIGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgdmFsdWUuZm9yRWFjaCgoZW50cnksIGluZGV4KSA9PiB7XG4gICAgICBhc3NlcnREZWZpbmVkRmluZEJ5Q29uZGl0aW9uVmFsdWUoZW50cnksIGAke2tleVBhdGh9WyR7aW5kZXh9XWApXG4gICAgfSlcbiAgICByZXR1cm5cbiAgfVxuXG4gIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIpIHtcbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBvYmplY3RWYWx1ZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodmFsdWUpXG4gICAgY29uc3QgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKG9iamVjdFZhbHVlKVxuXG4gICAgaWYgKHByb3RvdHlwZSAhPT0gT2JqZWN0LnByb3RvdHlwZSAmJiBwcm90b3R5cGUgIT09IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgbm9uLXBsYWluIG9iamVjdCBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgICB9XG5cbiAgICBjb25zdCBzeW1ib2xLZXlzID0gT2JqZWN0LmdldE93blByb3BlcnR5U3ltYm9scyhvYmplY3RWYWx1ZSlcblxuICAgIGlmIChzeW1ib2xLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgc3ltYm9sIGNvbmRpdGlvbiBrZXlzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgICB9XG5cbiAgICBjb25zdCB2YWx1ZU9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodmFsdWUpXG5cbiAgICBPYmplY3Qua2V5cyh2YWx1ZU9iamVjdCkuZm9yRWFjaCgobmVzdGVkS2V5KSA9PiB7XG4gICAgICBhc3NlcnREZWZpbmVkRmluZEJ5Q29uZGl0aW9uVmFsdWUodmFsdWVPYmplY3RbbmVzdGVkS2V5XSwgYCR7a2V5UGF0aH0uJHtuZXN0ZWRLZXl9YClcbiAgICB9KVxuICB9XG59XG5cbi8qKlxuICogQmFzZSBmcm9udGVuZCBtb2RlbC5cbiAqXG4gKiBEZWZhdWx0cyBhcmUgYGFueWAgc28gdGhlIGJhcmUgYEZyb250ZW5kTW9kZWxCYXNlYCDigJQgdXNlZCB0aHJvdWdob3V0IGFzIGFcbiAqIGNvbnN0cmFpbnQvcGFyYW1ldGVyIHR5cGUgZm9yIFwiYW55IGZyb250ZW5kIG1vZGVsXCIg4oCUIGFjY2VwdHMgZ2VuZXJhdGVkXG4gKiBzdWJjbGFzc2VzIGRlY2xhcmluZyB0eXBlZC1hdHRyaWJ1dGUgZ2VuZXJpY3MgKGBGcm9udGVuZE1vZGVsQmFzZTxYQXR0cmlidXRlcyxcbiAqIC4uLj5gKS4gQSBjb25jcmV0ZSBgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPmAgZGVmYXVsdCBtYWtlc1xuICogdGhvc2Ugc3ViY2xhc3NlcyBmYWlsIGJ5IGludmFyaWFuY2UuIFN1YmNsYXNzZXMgc3RpbGwgcGFzcyB0aGVpciBwcmVjaXNlXG4gKiBhdHRyaWJ1dGUgdHlwZWRlZnMsIHNvIHR5cGVkIGFjY2Vzc29ycyBrZWVwIHRoZWlyIHByZWNpc2lvbi5cbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbQXR0cmlidXRlcz1hbnldXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW0NyZWF0ZUF0dHJpYnV0ZXM9YW55XVxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtVcGRhdGVBdHRyaWJ1dGVzPWFueV1cbiAqIEB0ZW1wbGF0ZSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IFtQcmltYXJ5S2V5VmFsdWU9aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWVdXG4gKiBAdGVtcGxhdGUge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBbRXZlbnRQcmltYXJ5S2V5VmFsdWU9UHJpbWFyeUtleVZhbHVlXVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBGcm9udGVuZE1vZGVsQmFzZSB7XG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBtb2RlbE5hbWVcblxuICAvKipcbiAgICogQXV0b2xvYWQuXG4gICAqIEB0eXBlIHtib29sZWFufSAtIEdsb2JhbCBhdXRvLWJhdGNoLXByZWxvYWQgdG9nZ2xlLiBBcHBzIGNhbiBvcHQgb3V0IHZpYSBGcm9udGVuZE1vZGVsQmFzZS5zZXRBdXRvbG9hZChmYWxzZSkuXG4gICAqL1xuICBzdGF0aWMgX2F1dG9sb2FkID0gdHJ1ZVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdXRvbG9hZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgYXV0by1iYXRjaC1wcmVsb2FkIG9mIHJlbGF0aW9uc2hpcHMgb24gbGF6eSBhY2Nlc3MgaXMgZW5hYmxlZCBnbG9iYWxseS5cbiAgICovXG4gIHN0YXRpYyBnZXRBdXRvbG9hZCgpIHsgcmV0dXJuIEZyb250ZW5kTW9kZWxCYXNlLl9hdXRvbG9hZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGF1dG9sb2FkLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld1ZhbHVlIC0gV2hldGhlciBhdXRvLWJhdGNoLXByZWxvYWQgb2YgcmVsYXRpb25zaGlwcyBpcyBlbmFibGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBzZXRBdXRvbG9hZChuZXdWYWx1ZSkgeyBGcm9udGVuZE1vZGVsQmFzZS5fYXV0b2xvYWQgPSBuZXdWYWx1ZSB9XG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovXG4gIF9hdHRyaWJ1dGVzXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcDxGcm9udGVuZE1vZGVsQmFzZSwgRnJvbnRlbmRNb2RlbEJhc2UsIFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4+IHwgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwPEZyb250ZW5kTW9kZWxCYXNlLCBGcm9udGVuZE1vZGVsQmFzZSwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPj4+fSAqL1xuICBfcmVsYXRpb25zaGlwc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGU+fSAqL1xuICBfYXR0YWNobWVudHNcbiAgLyoqXG4gICAqIFJhaWxzLXN0eWxlIG5lc3RlZCBhdHRyaWJ1dGUgcGF5bG9hZHMgcXVldWVkIGZvciB0aGUgbmV4dCBzYXZlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fVxuICAgKi9cbiAgX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtTZXQ8c3RyaW5nPiB8IG51bGx9ICovXG4gIF9zZWxlY3RlZEF0dHJpYnV0ZXNcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gIF9pc05ld1JlY29yZFxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgX21hcmtlZEZvckRlc3RydWN0aW9uXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqL1xuICBfcGVyc2lzdGVkQXR0cmlidXRlc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+IHwgdW5kZWZpbmVkfSAtIFNoYXJlZCByZWZlcmVuY2UgdG8gc2libGluZyByZWNvcmRzIGxvYWRlZCBpbiB0aGUgc2FtZSBiYXRjaC4gVXNlZCBieSBhdXRvLWJhdGNoLXByZWxvYWQuXG4gICAqL1xuICBfbG9hZENvaG9ydFxuICAvKipcbiAgICogQ2Fub25pY2FsIGJhY2tpbmctcmVjb3JkIGF0dGFjaG1lbnQgb3duZXIgcmV0dXJuZWQgYnkgdGhlIHNlcnZlci5cbiAgICogQHR5cGUge3tyZWNvcmRJZDogc3RyaW5nLCByZWNvcmRUeXBlOiBzdHJpbmcsIHJlc291cmNlTmFtZTogc3RyaW5nfSB8IG51bGx9XG4gICAqL1xuICBfYXR0YWNobWVudE93bmVyXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7QXR0cmlidXRlcyB8IENyZWF0ZUF0dHJpYnV0ZXN9IFthdHRyaWJ1dGVzXSAtIEluaXRpYWwgYXR0cmlidXRlcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGF0dHJpYnV0ZXMpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG5cbiAgICBNb2RlbENsYXNzLmVuc3VyZUdlbmVyYXRlZEF0dGFjaG1lbnRNZXRob2RzKClcbiAgICB0aGlzLl9hdHRyaWJ1dGVzID0ge31cbiAgICB0aGlzLl9yZWxhdGlvbnNoaXBzID0ge31cbiAgICB0aGlzLl9hdHRhY2htZW50cyA9IHt9XG4gICAgdGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIHRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcyA9IG51bGxcbiAgICB0aGlzLl9pc05ld1JlY29yZCA9IHRydWVcbiAgICB0aGlzLl9tYXJrZWRGb3JEZXN0cnVjdGlvbiA9IGZhbHNlXG4gICAgdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgdGhpcy5fYXR0YWNobWVudE93bmVyID0gbnVsbFxuICAgIGlmIChhdHRyaWJ1dGVzKSB0aGlzLmFzc2lnbkF0dHJpYnV0ZXMoYXR0cmlidXRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBnZW5lcmF0ZWQgYXR0YWNobWVudCBtZXRob2RzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBFbnN1cmVzIGF0dGFjaG1lbnQgaGVscGVyIG1ldGhvZHMgZXhpc3Qgb24gdGhlIHByb3RvdHlwZS5cbiAgICovXG4gIHN0YXRpYyBlbnN1cmVHZW5lcmF0ZWRBdHRhY2htZW50TWV0aG9kcygpIHtcbiAgICBpZiAodGhpcy5fZ2VuZXJhdGVkQXR0YWNobWVudE1ldGhvZHMpIHJldHVyblxuXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB0aGlzLmF0dGFjaG1lbnREZWZpbml0aW9ucygpXG4gICAgY29uc3QgcHJvdG90eXBlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0aGlzLnByb3RvdHlwZSlcblxuICAgIGZvciAoY29uc3QgYXR0YWNobWVudE5hbWUgb2YgT2JqZWN0LmtleXMoYXR0YWNobWVudHMpKSB7XG4gICAgICBpZiAoIShhdHRhY2htZW50TmFtZSBpbiBwcm90b3R5cGUpKSB7XG4gICAgICAgIHByb3RvdHlwZVthdHRhY2htZW50TmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fZ2VuZXJhdGVkQXR0YWNobWVudE1ldGhvZHMgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd9IC0gUmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJyZXNvdXJjZUNvbmZpZygpIG11c3QgYmUgaW1wbGVtZW50ZWQgYnkgc3ViY2xhc3Nlc1wiKVxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby11bnJlYWNoYWJsZVxuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIG1vZGVsIGNsYXNzZXMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQ2xhc3MgfCBzdHJpbmc+fSAtIFJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzc2VzIChvciBjbGFzcyBuYW1lIHN0cmluZ3MpIGtleWVkIGJ5IHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIHJlbGF0aW9uc2hpcE1vZGVsQ2xhc3NlcygpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlciBhIGZyb250ZW5kIG1vZGVsIGNsYXNzIHNvIGl0IGNhbiBiZSByZXNvbHZlZCBieSBuYW1lIGluIHJlbGF0aW9uc2hpcCBsb29rdXBzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIHJlZ2lzdGVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyByZWdpc3Rlck1vZGVsKG1vZGVsQ2xhc3MpIHtcbiAgICByZWdpc3RlckZyb250ZW5kTW9kZWwobW9kZWxDbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlZmluZSBzY29wZS5cbiAgICogQHBhcmFtIHsoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gY2FsbGJhY2sgLSBTY29wZSBjYWxsYmFjay5cbiAgICogQHJldHVybnMgeygoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8RnJvbnRlbmRNb2RlbENsYXNzPikgJiB7c2NvcGU6ICguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCIpLk1vZGVsU2NvcGVEZXNjcmlwdG9yfX0gLSBTY29wZSBoZWxwZXIuXG4gICAqL1xuICBzdGF0aWMgZGVmaW5lU2NvcGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gZGVmaW5lTW9kZWxTY29wZSh7XG4gICAgICBjYWxsYmFjayxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICBzdGFydFF1ZXJ5OiAoKSA9PiB0aGlzLnF1ZXJ5KClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmUgYSByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MgdmFsdWUgdGhhdCBtYXkgYmUgYSBjbGFzcyByZWZlcmVuY2Ugb3IgYSBzdHJpbmcgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIENsYXNzIG9yIGNsYXNzIG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBudWxsfSAtIFJlc29sdmVkIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIHJlc29sdmVNb2RlbENsYXNzKHZhbHVlKSB7XG4gICAgcmV0dXJuIHJlc29sdmVGcm9udGVuZE1vZGVsQ2xhc3ModmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbnMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB7dHlwZTogXCJiZWxvbmdzVG9cIiB8IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIiwgYXV0b2xvYWQ/OiBib29sZWFufT59IC0gUmVsYXRpb25zaGlwIGRlZmluaXRpb25zIGtleWVkIGJ5IHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIHJlbGF0aW9uc2hpcERlZmluaXRpb25zKCkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNobWVudCBkZWZpbml0aW9ucy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRhY2htZW50RGVmaW5pdGlvbj59IC0gQXR0YWNobWVudCBkZWZpbml0aW9ucyBrZXllZCBieSBhdHRhY2htZW50IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgYXR0YWNobWVudERlZmluaXRpb25zKCkge1xuICAgIHJldHVybiB0aGlzLnJlc291cmNlQ29uZmlnKCkuYXR0YWNobWVudHMgfHwge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaG1lbnQgZGVmaW5pdGlvbi5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREZWZpbml0aW9uIHwgbnVsbH0gLSBBdHRhY2htZW50IGRlZmluaXRpb24uXG4gICAqL1xuICBzdGF0aWMgYXR0YWNobWVudERlZmluaXRpb24oYXR0YWNobWVudE5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5hdHRhY2htZW50RGVmaW5pdGlvbnMoKVthdHRhY2htZW50TmFtZV0gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIGRlZmluaXRpb24uXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHt7dHlwZTogXCJiZWxvbmdzVG9cIiB8IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIiwgYXV0b2xvYWQ/OiBib29sZWFufSB8IG51bGx9IC0gUmVsYXRpb25zaGlwIGRlZmluaXRpb24uXG4gICAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgZGVmaW5pdGlvbnMgPSB0aGlzLnJlbGF0aW9uc2hpcERlZmluaXRpb25zKClcblxuICAgIHJldHVybiBkZWZpbml0aW9uc1tyZWxhdGlvbnNoaXBOYW1lXSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBSYWlscy1zdHlsZSBuZXN0ZWQgYXR0cmlidXRlcyBrZXkgdG8gYSBjb25maWd1cmVkIHJlbGF0aW9uc2hpcC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBDYW5kaWRhdGUgYXR0cmlidXRlIG5hbWUsIHN1Y2ggYXMgYHRhc2tzQXR0cmlidXRlc2AuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSBSZWxhdGlvbnNoaXAgbmFtZSB3aGVuIG5lc3RlZCBhdHRyaWJ1dGVzIGFyZSBjb25maWd1cmVkLlxuICAgKi9cbiAgc3RhdGljIG5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAoIWF0dHJpYnV0ZU5hbWUuZW5kc1dpdGgoXCJBdHRyaWJ1dGVzXCIpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZSA9IGF0dHJpYnV0ZU5hbWUuc2xpY2UoMCwgLVwiQXR0cmlidXRlc1wiLmxlbmd0aClcbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZygpLm5lc3RlZEF0dHJpYnV0ZXMgfHwge31cblxuICAgIHJldHVybiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobmVzdGVkQXR0cmlidXRlc0NvbmZpZywgcmVsYXRpb25zaGlwTmFtZSlcbiAgICAgID8gcmVsYXRpb25zaGlwTmFtZVxuICAgICAgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBudWxsfSAtIFRhcmdldCByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzID0gdGhpcy5yZWxhdGlvbnNoaXBNb2RlbENsYXNzZXMoKVxuICAgIGNvbnN0IHZhbHVlID0gcmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICByZXR1cm4gRnJvbnRlbmRNb2RlbEJhc2UucmVzb2x2ZU1vZGVsQ2xhc3ModmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7QXR0cmlidXRlc30gLSBBdHRyaWJ1dGVzIGhhc2guXG4gICAqL1xuICBhdHRyaWJ1dGVzKCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0F0dHJpYnV0ZXN9ICovICh0aGlzLl9hdHRyaWJ1dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgbmV3IHJlY29yZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIG1vZGVsIGhhcyBub3QgeWV0IGJlZW4gcGVyc2lzdGVkLlxuICAgKi9cbiAgaXNOZXdSZWNvcmQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2lzTmV3UmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBwZXJzaXN0ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBtb2RlbCBoYXMgYmVlbiBwZXJzaXN0ZWQuXG4gICAqL1xuICBpc1BlcnNpc3RlZCgpIHtcbiAgICByZXR1cm4gIXRoaXMuaXNOZXdSZWNvcmQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGlzIG5ldyByZWNvcmQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbmV3SXNOZXdSZWNvcmQgLSBOZXcgcGVyc2lzdGVkLXN0YXRlIGZsYWcuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0SXNOZXdSZWNvcmQobmV3SXNOZXdSZWNvcmQpIHtcbiAgICB0aGlzLl9pc05ld1JlY29yZCA9IG5ld0lzTmV3UmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogTWFya3MgdGhpcyByZWNvcmQgZm9yIGRlc3RydWN0aW9uIHdoZW4gaXRzIHBhcmVudCBpcyBuZXh0IHNhdmVkIHRocm91Z2hcbiAgICogbmVzdGVkLWF0dHJpYnV0ZSBzdXBwb3J0LiBUaGUgcmVjb3JkIGlzIG5vdCByZW1vdmVkIGZyb20gdGhlIHBhcmVudCdzXG4gICAqIHJlbGF0aW9uc2hpcCBjb2xsZWN0aW9uIHVudGlsIHRoZSBzZXJ2ZXIgY29uZmlybXMgdGhlIGRlbGV0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgbWFya0ZvckRlc3RydWN0aW9uKCkge1xuICAgIHRoaXMuX21hcmtlZEZvckRlc3RydWN0aW9uID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFya2VkIGZvciBkZXN0cnVjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIHJlY29yZCBpcyBxdWV1ZWQgZm9yIG5lc3RlZCBkZXN0cnVjdGlvbiBvbiBuZXh0IHBhcmVudCBzYXZlLlxuICAgKi9cbiAgbWFya2VkRm9yRGVzdHJ1Y3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX21hcmtlZEZvckRlc3RydWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjaGFuZ2VzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBDaGFuZ2VkIGF0dHJpYnV0ZXMgYXMgYFtvbGRWYWx1ZSwgbmV3VmFsdWVdYC5cbiAgICovXG4gIGNoYW5nZXMoKSB7XG4gICAgLyoqXG4gICAgICogQ2hhbmdlZCBhdHRyaWJ1dGVzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IGNoYW5nZWRBdHRyaWJ1dGVzID0ge31cbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IG5ldyBTZXQoW1xuICAgICAgLi4uT2JqZWN0LmtleXModGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyksXG4gICAgICAuLi5PYmplY3Qua2V5cyh0aGlzLl9hdHRyaWJ1dGVzKVxuICAgIF0pXG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgYXR0cmlidXRlTmFtZXMpIHtcbiAgICAgIGNvbnN0IHByZXZpb3VzVmFsdWUgPSB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG4gICAgICBjb25zdCBjdXJyZW50VmFsdWUgPSB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICAgIGlmIChKU09OLnN0cmluZ2lmeShzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocHJldmlvdXNWYWx1ZSkpICE9PSBKU09OLnN0cmluZ2lmeShzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoY3VycmVudFZhbHVlKSkpIHtcbiAgICAgICAgY2hhbmdlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBbcHJldmlvdXNWYWx1ZSwgY3VycmVudFZhbHVlXVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjaGFuZ2VkQXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgY2hhbmdlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbnkgdHJhY2tlZCBhdHRyaWJ1dGUgaGFzIGNoYW5nZWQuXG4gICAqL1xuICBpc0NoYW5nZWQoKSB7XG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMuY2hhbmdlcygpKS5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVsYXRpb25zaGlwIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSAtIFJlbGF0aW9uc2hpcCBzdGF0ZSBvYmplY3QuXG4gICAqL1xuICBnZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGlmICghdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXSkge1xuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwRGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwRGVmaW5pdGlvbiAmJiByZWxhdGlvbnNoaXBUeXBlSXNDb2xsZWN0aW9uKHJlbGF0aW9uc2hpcERlZmluaXRpb24udHlwZSkpIHtcbiAgICAgICAgdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXSA9IG5ldyBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCh0aGlzLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXSA9IG5ldyBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXAodGhpcywgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzcylcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF0dGFjaG1lbnQgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGV9IC0gQXR0YWNobWVudCBoZWxwZXIuXG4gICAqL1xuICBnZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbihhdHRhY2htZW50TmFtZSlcblxuICAgIGlmICghYXR0YWNobWVudERlZmluaXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBhdHRhY2htZW50OiAke01vZGVsQ2xhc3MubmFtZX0jJHthdHRhY2htZW50TmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdKSB7XG4gICAgICB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0gPSBuZXcgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGUoe1xuICAgICAgICBhdHRhY2htZW50TmFtZSxcbiAgICAgICAgbW9kZWw6IHRoaXNcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxCYXNlIHwgQXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIGxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBpZCA9IHRoaXMucHJpbWFyeUtleVZhbHVlKClcbiAgICBjb25zdCByZWxvYWRlZE1vZGVsID0gYXdhaXQgTW9kZWxDbGFzc1xuICAgICAgLnByZWxvYWQoW3JlbGF0aW9uc2hpcE5hbWVdKVxuICAgICAgLmZpbmQoaWQpXG4gICAgY29uc3Qgc291cmNlUmVsYXRpb25zaGlwID0gcmVsb2FkZWRNb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICBjb25zdCB0YXJnZXRSZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgY29weUxvYWRlZFJlbGF0aW9uc2hpcFZhbHVlKHtzb3VyY2VSZWxhdGlvbnNoaXAsIHRhcmdldFJlbGF0aW9uc2hpcH0pXG5cbiAgICByZXR1cm4gdGFyZ2V0UmVsYXRpb25zaGlwLmxvYWRlZCgpXG4gIH1cblxuICAvKipcbiAgICogUHJlbG9hZHMgcmVsYXRpb25zaGlwKHMpIG9udG8gdGhpcyBhbHJlYWR5LWxvYWRlZCByZWNvcmQuIEFjY2VwdHMgZWl0aGVyIGFcbiAgICogcXVlcnkgYnVpbHQgdmlhIGBNb2RlbC5wcmVsb2FkKC4uLikuc2VsZWN0KC4uLilgIG9yIGEgcmF3IHByZWxvYWQgc3BlY1xuICAgKiAoc3RyaW5nIC8gYXJyYXkgLyBuZXN0ZWQgb2JqZWN0KS4gUmVsYXRpb25zaGlwcyBhbHJlYWR5IHByZWxvYWRlZCB3aXRoIHRoZVxuICAgKiByZXF1aXJlZCBjb2x1bW5zIHByZXNlbnQgYXJlIGxlZnQgdW50b3VjaGVkIHVubGVzcyBgZm9yY2VgIGlzIHNldC4gQ2Fycmllc1xuICAgKiB0aGUgcXVlcnkncyBwcmVsb2FkIGdyYXBoLCBzZWxlY3QsIHNlbGVjdHNFeHRyYSwgd2l0aENvdW50LCBhYmlsaXRpZXMsIGFuZFxuICAgKiBxdWVyeURhdGEgd2hlbiByZS1mZXRjaGluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8RnJvbnRlbmRNb2RlbENsYXNzPiB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBzdHJpbmcgfCBBcnJheTxzdHJpbmcgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkPn0gcXVlcnlPclNwZWMgLSBQcmVsb2FkIHNvdXJjZS5cbiAgICogQHBhcmFtIHt7Zm9yY2U/OiBib29sZWFufX0gW29wdGlvbnNdIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwcmVsb2FkaW5nIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIHByZWxvYWQocXVlcnlPclNwZWMsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IEZyb250ZW5kTW9kZWxQcmVsb2FkZXIucHJlbG9hZChbdGhpc10sIHF1ZXJ5T3JTcGVjLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIG9yIGxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxCYXNlIHwgQXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIHJlbGF0aW9uc2hpcE9yTG9hZChyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIHtcbiAgICAgIHJldHVybiByZWxhdGlvbnNoaXAubG9hZGVkKClcbiAgICB9XG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5fdHJ5Q29ob3J0UHJlbG9hZChyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKGJhdGNoZWQpIHJldHVybiByZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRlbXB0cyB0byBiYXRjaC1sb2FkIGByZWxhdGlvbnNoaXBOYW1lYCBhY3Jvc3MgY29ob3J0IHNpYmxpbmdzIHZpYSBhXG4gICAqIHNpbmdsZSBgcHJlbG9hZChbbmFtZV0pLndoZXJlKHtwazogW2lkc119KS50b0FycmF5KClgIHJlcXVlc3QsIHRoZW4gY29waWVzXG4gICAqIHRoZSBwcmVsb2FkZWQgcmVsYXRpb25zaGlwIHN0YXRlIG9udG8gZWFjaCBzaWJsaW5nLiBSZXR1cm5zIHRydWUgd2hlbiBhXG4gICAqIGJhdGNoIHJhbiwgZmFsc2Ugd2hlbiBhdXRvbG9hZCBpcyBvZmYsIHRoZXJlIGlzIG5vIGNvaG9ydCwgb3Igbm8gYmF0Y2hcbiAgICogY2FuZGlkYXRlcyByZW1haW4uIFNpYmxpbmdzIHdob3NlIHJlbGF0aW9uc2hpcCBzdGF0ZSBpcyBhbHJlYWR5IHNldFxuICAgKiAocHJlbG9hZGVkIG9yIGxvY2FsbHkgbWFuaXB1bGF0ZWQgdmlhIGBidWlsZGAgLyBgc2V0UmVsYXRpb25zaGlwYCkgYXJlXG4gICAqIHNraXBwZWQgc28gdGhlaXIgY2FjaGVkL2VkaXRlZCB2YWx1ZSBpcyBwcmVzZXJ2ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYSBjb2hvcnQgYmF0Y2ggcHJlbG9hZCByYW4uXG4gICAqL1xuICBhc3luYyBfdHJ5Q29ob3J0UHJlbG9hZChyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgaWYgKCFGcm9udGVuZE1vZGVsQmFzZS5nZXRBdXRvbG9hZCgpKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBjb2hvcnQgPSB0aGlzLl9sb2FkQ29ob3J0XG5cbiAgICBpZiAoIWNvaG9ydCB8fCBjb2hvcnQubGVuZ3RoIDw9IDEpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgZGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKCFkZWZpbml0aW9uKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoZGVmaW5pdGlvbi5hdXRvbG9hZCA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuXG4gICAgLyoqXG4gICAgICogQmF0Y2guXG4gICAgICogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxCYXNlPn0gKi9cbiAgICBjb25zdCBiYXRjaCA9IFtdXG5cbiAgICAvLyBFeGFjdCBzYW1lIGNsYXNzLCBwZXJzaXN0ZWQsIG5vIGV4aXN0aW5nIGluLW1lbW9yeSByZWxhdGlvbnNoaXAgc3RhdGUuXG4gICAgLy8gYHNldExvYWRlZGAgc2V0cyBgX3ByZWxvYWRlZCA9IHRydWVgIG9uIGV2ZXJ5IG11dGF0aW9uIHBhdGggKHByZWxvYWQsXG4gICAgLy8gc2V0UmVsYXRpb25zaGlwLCBidWlsZCwgYWRkVG9Mb2FkZWQpLCBzbyBgZ2V0UHJlbG9hZGVkKClgIGFsb25lIGlzIGFcbiAgICAvLyByZWxpYWJsZSBcImFscmVhZHkgdG91Y2hlZFwiIHNpZ25hbCBvbiB0aGUgZnJvbnRlbmQuXG4gICAgZm9yIChjb25zdCBzaWJsaW5nIG9mIGNvaG9ydCkge1xuICAgICAgaWYgKHNpYmxpbmcuY29uc3RydWN0b3IgIT09IE1vZGVsQ2xhc3MpIGNvbnRpbnVlXG4gICAgICBpZiAoc2libGluZy5pc05ld1JlY29yZCgpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBzaWJsaW5nUmVsYXRpb25zaGlwID0gc2libGluZy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgICAgaWYgKHNpYmxpbmdSZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIGNvbnRpbnVlXG5cbiAgICAgIGJhdGNoLnB1c2goc2libGluZylcbiAgICB9XG5cbiAgICBpZiAoYmF0Y2gubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgYmF0Y2hJZHMgPSBiYXRjaC5tYXAoKHNpYmxpbmcpID0+IHNpYmxpbmcucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgY29uc3QgcmVsb2FkZWRCYXRjaCA9IGF3YWl0IE1vZGVsQ2xhc3NcbiAgICAgIC5wcmVsb2FkKFtyZWxhdGlvbnNoaXBOYW1lXSlcbiAgICAgIC53aGVyZSh7W3ByaW1hcnlLZXldOiBiYXRjaElkc30pXG4gICAgICAudG9BcnJheSgpXG5cbiAgICAvKipcbiAgICAgKiBSZWxvYWRlZCBieSBpZC5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgRnJvbnRlbmRNb2RlbEJhc2U+fSAqL1xuICAgIGNvbnN0IHJlbG9hZGVkQnlJZCA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCByZWxvYWRlZCBvZiByZWxvYWRlZEJhdGNoKSB7XG4gICAgICByZWxvYWRlZEJ5SWQuc2V0KG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHJlbG9hZGVkLnByaW1hcnlLZXlWYWx1ZSgpKSwgcmVsb2FkZWQpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzaWJsaW5nIG9mIGJhdGNoKSB7XG4gICAgICBjb25zdCBrZXkgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBzaWJsaW5nLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgICAgY29uc3QgcmVsb2FkZWQgPSByZWxvYWRlZEJ5SWQuZ2V0KGtleSlcblxuICAgICAgaWYgKCFyZWxvYWRlZCkgY29udGludWVcblxuICAgICAgY29weUxvYWRlZFJlbGF0aW9uc2hpcFZhbHVlKHtcbiAgICAgICAgc291cmNlUmVsYXRpb25zaGlwOiByZWxvYWRlZC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSksXG4gICAgICAgIHRhcmdldFJlbGF0aW9uc2hpcDogc2libGluZy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgLy8gSWYgdGhlIGNhbGxlciBpdHNlbGYgd2FzIG5vdCBwb3B1bGF0ZWQgKHJlY29yZCBkZWxldGVkL2ZpbHRlcmVkIGJldHdlZW5cbiAgICAvLyB0aGUgbGlzdCBmZXRjaCBhbmQgdGhpcyBwcmVsb2FkIHJlcXVlc3QpLCBmYWxsIGJhY2sgdG8gcGVyLXJlY29yZCBsb2FkXG4gICAgLy8gc28gdGhlIGNhbGxlciBnZXRzIGEgcmVhbCBub3QtZm91bmQgZXJyb3IgaW5zdGVhZCBvZiBhIG1pc2xlYWRpbmdcbiAgICAvLyBcImhhc24ndCBiZWVuIHByZWxvYWRlZFwiIHRocm93IGZyb20gbG9hZGVkKCkuXG4gICAgaWYgKCF0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKS5nZXRQcmVsb2FkZWQoKSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZSB8IG51bGwgfCB1bmRlZmluZWR9IHJlbGF0aW9uc2hpcFZhbHVlIC0gUmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEJhc2UgfCBudWxsIHwgdW5kZWZpbmVkfSAtIEFzc2lnbmVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIHNldFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBWYWx1ZSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCByZWxhdGlvbnNoaXBEZWZpbml0aW9uID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcERlZmluaXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biByZWxhdGlvbnNoaXA6ICR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBzZXQgaGFzLW1hbnkgcmVsYXRpb25zaGlwIHdpdGggc2V0UmVsYXRpb25zaGlwKCk6ICR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICByZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHJlbGF0aW9uc2hpcFZhbHVlKVxuXG4gICAgcmV0dXJuIHJlbGF0aW9uc2hpcFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhc3NpZ24gYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtBdHRyaWJ1dGVzIHwgQ3JlYXRlQXR0cmlidXRlcyB8IFVwZGF0ZUF0dHJpYnV0ZXMgfCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSBhdHRyaWJ1dGVzIC0gQXR0cmlidXRlcyB0byBhc3NpZ24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFzc2lnbkF0dHJpYnV0ZXMoYXR0cmlidXRlcykge1xuICAgIGNvbnN0IGF0dHJpYnV0ZVZhbHVlcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKGF0dHJpYnV0ZXMpXG5cbiAgICBmb3IgKGNvbnN0IGtleSBpbiBhdHRyaWJ1dGVWYWx1ZXMpIHtcbiAgICAgIHRoaXMuc2V0QXR0cmlidXRlKGtleSwgYXR0cmlidXRlVmFsdWVzW2tleV0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgcmVsYXRpb25zaGlwIGNhY2hlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBDbGVhcnMgY2FjaGVkIHJlbGF0aW9uc2hpcCBzdGF0ZS5cbiAgICovXG4gIGNsZWFyUmVsYXRpb25zaGlwQ2FjaGUoKSB7XG4gICAgdGhpcy5fcmVsYXRpb25zaGlwcyA9IHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmltYXJ5IGtleS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IC0gUHJpbWFyeSBrZXkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiB0aGlzLnJlc291cmNlQ29uZmlnKCkucHJpbWFyeUtleSB8fCBcImlkXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW1hcnkga2V5IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UHJpbWFyeUtleVZhbHVlfSAtIFByaW1hcnkga2V5IHZhbHVlLlxuICAgKi9cbiAgcHJpbWFyeUtleVZhbHVlKCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcblxuICAgIHJldHVybiAvKiogQHR5cGUge1ByaW1hcnlLZXlWYWx1ZX0gKi8gKHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgY29uc3QgdmFsdWUgPSB0aGlzLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcblxuICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHByaW1hcnkga2V5ICcke2F0dHJpYnV0ZU5hbWV9JyBvbiAke01vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdmFsdWVcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBzY2FsYXIgaWRlbnRpdHkgcmVxdWlyZWQgYnkgc2NhbGFyLW9ubHkgZnJvbnRlbmQgZmVhdHVyZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRpb24gLSBPcGVyYXRpb24gcmVxdWlyaW5nIGEgc2NhbGFyIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5U2NhbGFyfSAtIFNjYWxhciBwcmltYXJ5LWtleSB2YWx1ZS5cbiAgICovXG4gIHNjYWxhclByaW1hcnlLZXlWYWx1ZShvcGVyYXRpb24pIHtcbiAgICByZXR1cm4gc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUodGhpcy5wcmltYXJ5S2V5VmFsdWUoKSwgb3BlcmF0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGlkZW50aXR5IHJlcHJlc2VudGVkIGJ5IHRoZSBsYXN0IHBlcnNpc3RlZCBmcm9udGVuZCBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7UHJpbWFyeUtleVZhbHVlfSAtIFBlcnNpc3RlZCBwcmltYXJ5LWtleSB2YWx1ZS5cbiAgICovXG4gIHBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtQcmltYXJ5S2V5VmFsdWV9ICovIChyZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUocHJpbWFyeUtleSwgKGF0dHJpYnV0ZU5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuXG4gICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgcGVyc2lzdGVkIHByaW1hcnkga2V5ICcke2F0dHJpYnV0ZU5hbWV9JyBvbiAke01vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdmFsdWVcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlYWQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQXR0cmlidXRlIHZhbHVlLlxuICAgKi9cbiAgcmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSB7XG4gICAgaWYgKHRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcyAmJiAhdGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzLmhhcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IEF0dHJpYnV0ZU5vdFNlbGVjdGVkRXJyb3IodGhpcy5jb25zdHJ1Y3Rvci5uYW1lLCBhdHRyaWJ1dGVOYW1lKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhbiBhdHRyaWJ1dGUgdmFsdWUgaXMgY3VycmVudGx5IGxvYWRlZCBvbiB0aGlzIHJlY29yZC4gVXNlZCBieSB0aGVcbiAgICogcHJlbG9hZGVyIHRvIGRlY2lkZSB3aGV0aGVyIGEgcmVsYXRpb25zaGlwIGNhbiBiZSBza2lwcGVkIGJlY2F1c2UgdGhlXG4gICAqIHJlcXVlc3RlZCBjb2x1bW5zIGFyZSBhbHJlYWR5IHByZXNlbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGF0dHJpYnV0ZSBpcyBsb2FkZWQuXG4gICAqL1xuICBoYXNMb2FkZWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkge1xuICAgIGlmICghdGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIHRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcy5oYXMoYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGFuIGFzc29jaWF0aW9uIGNvdW50IGF0dGFjaGVkIGJ5IGAud2l0aENvdW50KC4uLilgLiBDb3VudHNcbiAgICogbGl2ZSBvbiBhIGRlZGljYXRlZCBtYXAgc2VwYXJhdGUgZnJvbSB0aGUgcmVjb3JkJ3MgYXR0cmlidXRlcyBzb1xuICAgKiBhIHZpcnR1YWwgY291bnQgbGlrZSBgdGFza3NDb3VudGAgY2FuJ3Qgc2lsZW50bHkgc2hhZG93IGEgcmVhbFxuICAgKiBjb2x1bW4gb2YgdGhlIHNhbWUgbmFtZS4gUmV0dXJucyB0aGUgYXR0YWNoZWQgdmFsdWUsIG9yIDAgd2hlblxuICAgKiBgLndpdGhDb3VudCguLi4pYCB3YXNuJ3QgcmVxdWVzdGVkIGZvciB0aGlzIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZSwgZS5nLiBgXCJ0YXNrc0NvdW50XCJgIG9yIGEgY3VzdG9tIG5hbWUgZnJvbSBgLndpdGhDb3VudCh7Y3VzdG9tTmFtZTogey4uLn19KWAuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQXR0YWNoZWQgYXNzb2NpYXRpb24gY291bnQsIG9yIHplcm8gd2hlbiBhYnNlbnQuXG4gICAqL1xuICByZWFkQ291bnQoYXR0cmlidXRlTmFtZSkge1xuICAgIHJldHVybiByZWFkUGF5bG9hZEFzc29jaWF0aW9uQ291bnQoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogSW50ZXJuYWwgc2V0dGVyIGNhbGxlZCBieSBgaW5zdGFudGlhdGVGcm9tUmVzcG9uc2VgIHdoZW4gaHlkcmF0aW5nXG4gICAqIGFzc29jaWF0aW9uIGNvdW50cyB0aGF0IHJvZGUgYWxvbmcgd2l0aCB0aGUgcmVjb3JkIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIENvdW50IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRBc3NvY2lhdGlvbkNvdW50KGF0dHJpYnV0ZU5hbWUsIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZEFzc29jaWF0aW9uQ291bnQoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGF0dHJpYnV0ZU5hbWUsIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgYSBwZXItcmVjb3JkIGFiaWxpdHkgcmVzdWx0IGF0dGFjaGVkIGJ5IGAuYWJpbGl0aWVzKC4uLilgLiBUaGVcbiAgICogYmFja2VuZCBldmFsdWF0ZXMgZWFjaCByZXF1ZXN0ZWQgYWN0aW9uIGFnYWluc3QgdGhlIGN1cnJlbnRcbiAgICogYWJpbGl0eSBmb3IgdGhpcyByZWNvcmQgaW5zdGFuY2UgYW5kIHNoaXBzIHRoZSByZXN1bHQgYWxvbmdzaWRlXG4gICAqIHRoZSByZWNvcmQncyBhdHRyaWJ1dGVzLiBSZXR1cm5zIGBmYWxzZWAgd2hlbiB0aGUgYWN0aW9uIHdhc24ndFxuICAgKiByZXF1ZXN0ZWQgKG9yIHRoZSBhYmlsaXR5IGRlbmllZCBpdCksIHNvIFVJIGNvZGUgY2FuIHNhZmVseSBicmFuY2hcbiAgICogb24gYHJlY29yZC5jYW4oXCJ1cGRhdGVcIilgIHdpdGhvdXQgZmlyc3QgY2hlY2tpbmcgd2hldGhlciB0aGVcbiAgICogYWJpbGl0eSB3YXMgbG9hZGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24gbmFtZSwgZS5nLiBgXCJ1cGRhdGVcImAuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlcXVlc3RlZCBhYmlsaXR5IGlzIGFsbG93ZWQuXG4gICAqL1xuICBjYW4oYWN0aW9uKSB7XG4gICAgcmV0dXJuIHJlYWRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogSW50ZXJuYWwgc2V0dGVyIGNhbGxlZCBieSBgaW5zdGFudGlhdGVGcm9tUmVzcG9uc2VgIHdoZW4gaHlkcmF0aW5nXG4gICAqIHBlci1yZWNvcmQgYWJpbGl0eSByZXN1bHRzIHRoYXQgcm9kZSBhbG9uZyB3aXRoIHRoZSByZWNvcmRcbiAgICogcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEFiaWxpdHkgYWN0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gdmFsdWUgLSBXaGV0aGVyIHRoZSBjdXJyZW50IGFiaWxpdHkgcGVybWl0cyB0aGUgYWN0aW9uIG9uIHRoaXMgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRDb21wdXRlZEFiaWxpdHkoYWN0aW9uLCB2YWx1ZSkge1xuICAgIHNldFBheWxvYWRDb21wdXRlZEFiaWxpdHkoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGFjdGlvbiwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhIGNvbnN1bWVyLWRlZmluZWQgdmFsdWUgYXR0YWNoZWQgYnkgYC5xdWVyeURhdGEoLi4uKWAuIFN0b3JlZFxuICAgKiBvbiBhIGRlZGljYXRlZCBtYXAgcmF0aGVyIHRoYW4gYF9hdHRyaWJ1dGVzYCwgc28gYSB2aXJ0dWFsIGFsaWFzXG4gICAqIGxpa2UgYHRhc2tzQ291bnRgIGNhbm5vdCBzaWxlbnRseSBzaGFkb3cgYSByZWFsIGNvbHVtbiBvZiB0aGUgc2FtZVxuICAgKiBuYW1lLiBSZXR1cm5zIGBudWxsYCB3aGVuIG5vIHJlZ2lzdGVyZWQgZm4gcHJvZHVjZWQgdGhhdCBhbGlhcyBmb3JcbiAgICogdGhpcyByZWNvcmQgKGUuZy4gbm8gY2hpbGQgcm93cyBtYXRjaGVkIHRoZSBhZ2dyZWdhdGUpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIHF1ZXJ5RGF0YSBhbGlhcyBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQXR0YWNoZWQgcXVlcnktZGF0YSB2YWx1ZS5cbiAgICovXG4gIHF1ZXJ5RGF0YShuYW1lKSB7XG4gICAgcmV0dXJuIHJlYWRQYXlsb2FkUXVlcnlEYXRhKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIHNldHRlciB1c2VkIGJ5IGBpbnN0YW50aWF0ZUZyb21SZXNwb25zZWAgd2hlbiBoeWRyYXRpbmdcbiAgICogcXVlcnlEYXRhIHZhbHVlcyB0aGF0IHJvZGUgYWxvbmcgd2l0aCB0aGUgcmVjb3JkIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gcXVlcnlEYXRhIGFsaWFzIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQXR0YWNoZWQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldFF1ZXJ5RGF0YShuYW1lLCB2YWx1ZSkge1xuICAgIHNldFBheWxvYWRRdWVyeURhdGEoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIG5hbWUsIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbmV3VmFsdWUgLSBOZXcgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBBc3NpZ25lZCB2YWx1ZS5cbiAgICovXG4gIHNldEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lLCBuZXdWYWx1ZSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzUmVsYXRpb25zaGlwTmFtZSA9IE1vZGVsQ2xhc3MubmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUoYXR0cmlidXRlTmFtZSlcblxuICAgIGlmIChuZXN0ZWRBdHRyaWJ1dGVzUmVsYXRpb25zaGlwTmFtZSkge1xuICAgICAgdGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXNbbmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWVdID0gbmV3VmFsdWVcbiAgICAgIHJldHVybiBuZXdWYWx1ZVxuICAgIH1cblxuICAgIGlmIChNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICB0aGlzLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0cmlidXRlTmFtZSkucXVldWVBdHRhY2gobmV3VmFsdWUpXG4gICAgICByZXR1cm4gbmV3VmFsdWVcbiAgICB9XG5cbiAgICBjb25zdCBwcmV2aW91c1ZhbHVlID0gdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuXG4gICAgdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IG5ld1ZhbHVlXG5cbiAgICBpZiAodGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICB0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMuYWRkKGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuXG4gICAgLy8gT25seSBpbnZhbGlkYXRlIHJlbGF0aW9uc2hpcCBjYWNoZSBlbnRyaWVzIHdob3NlIGZvcmVpZ24ga2V5IG1hdGNoZXMgdGhlIGNoYW5nZWQgYXR0cmlidXRlLlxuICAgIC8vIEJsYW5rZXQtY2xlYXJpbmcgYWxsIHJlbGF0aW9uc2hpcHMgb24gYW55IGF0dHJpYnV0ZSBjaGFuZ2UgZGVzdHJveXMgbmVzdGVkLXNhdmUgc3RhdGVcbiAgICAvLyBhbmQgcHJlbG9hZGVkIGNoaWxkcmVuIHRoZSBjYWxsZXIgbmV2ZXIgYXNrZWQgdG8gaW52YWxpZGF0ZS5cbiAgICBpZiAoIU9iamVjdC5pcyhwcmV2aW91c1ZhbHVlLCBuZXdWYWx1ZSkpIHtcbiAgICAgIHRoaXMuX2ludmFsaWRhdGVSZWxhdGlvbnNoaXBzRm9yQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ld1ZhbHVlXG4gIH1cblxuICAvKipcbiAgICogSW52YWxpZGF0ZXMgYW55IGNhY2hlZCBiZWxvbmdzVG8gcmVsYXRpb25zaGlwIHdob3NlIGZvcmVpZ24ga2V5IG1hdGNoZXMgdGhlXG4gICAqIGNoYW5nZWQgYXR0cmlidXRlLiBIYXNNYW55IC8gaGFzT25lIHJlbGF0aW9uc2hpcHMgYXJlIGxlZnQgdW50b3VjaGVkIGJlY2F1c2VcbiAgICogdGhlaXIgZm9yZWlnbiBrZXkgbGl2ZXMgb24gdGhlIGNoaWxkLCBub3Qgb24gdGhpcyBtb2RlbCwgYW5kIGJsYW5rZXQtY2xlYXJpbmdcbiAgICogdGhlbSB3b3VsZCBkZXN0cm95IG5lc3RlZC1zYXZlIHN0YXRlIGFuZCBwcmVsb2FkZWQgY2hpbGRyZW4gdGhlIGNhbGxlciBuZXZlclxuICAgKiBhc2tlZCB0byBpbnZhbGlkYXRlLlxuICAgKlxuICAgKiBGb3JlaWduIGtleXMgYXJlIGluZmVycmVkIHdoZW4gbm90IGRlY2xhcmVkOiBmb3IgYmVsb25nc1RvIGBwcm9qZWN0SWRgIGlzXG4gICAqIGluZmVycmVkIGZyb20gcmVsYXRpb25zaGlwIG5hbWUgYHByb2plY3RgLiBFeHBsaWNpdCBgZm9yZWlnbktleWAgb24gdGhlXG4gICAqIHJlbGF0aW9uc2hpcCBkZWZpbml0aW9uIHRha2VzIHByZWNlZGVuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUgdGhhdCBjaGFuZ2VkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9pbnZhbGlkYXRlUmVsYXRpb25zaGlwc0ZvckF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSB7XG4gICAgaWYgKCF0aGlzLl9yZWxhdGlvbnNoaXBzIHx8IE9iamVjdC5rZXlzKHRoaXMuX3JlbGF0aW9uc2hpcHMpLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgZGVmaW5pdGlvbnMgPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcERlZmluaXRpb25zKClcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyh0aGlzLl9yZWxhdGlvbnNoaXBzKSkge1xuICAgICAgY29uc3QgZGVmaW5pdGlvbiA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChkZWZpbml0aW9uc1tyZWxhdGlvbnNoaXBOYW1lXSlcblxuICAgICAgaWYgKCFkZWZpbml0aW9uIHx8IGRlZmluaXRpb24udHlwZSAhPT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgICAgY29uc3QgZm9yZWlnbktleSA9IGRlZmluaXRpb24uZm9yZWlnbktleSB8fCBgJHtyZWxhdGlvbnNoaXBOYW1lfUlkYFxuXG4gICAgICBpZiAoZm9yZWlnbktleSA9PT0gYXR0cmlidXRlTmFtZSkge1xuICAgICAgICBkZWxldGUgdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIHBhdGguXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGVyaXZlZCByZXNvdXJjZSBwYXRoLlxuICAgKi9cbiAgc3RhdGljIHJlc291cmNlUGF0aCgpIHtcbiAgICByZXR1cm4gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKHtcbiAgICAgIG1vZGVsTmFtZTogdGhpcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgIHJlc291cmNlUGF0aDogZGVmYXVsdEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgodGhpcylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29tbWFuZCBuYW1lLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDb21tYW5kVHlwZX0gY29tbWFuZFR5cGUgLSBDb21tYW5kIHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUmVzb2x2ZWQgY29tbWFuZCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGNvbW1hbmROYW1lKGNvbW1hbmRUeXBlKSB7XG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSB0aGlzLnJlc291cmNlQ29uZmlnKClcbiAgICBjb25zdCBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzID0gcmVzb3VyY2VDb25maWcuYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyB8fCBbXVxuICAgIGNvbnN0IGJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IHJlc291cmNlQ29uZmlnLmJ1aWx0SW5NZW1iZXJDb21tYW5kcyB8fCBbXVxuICAgIGNvbnN0IGNvbW1hbmRzID0gcmVzb3VyY2VDb25maWcuY29tbWFuZHMgfHwgW11cbiAgICBjb25zdCBpc0V4cG9zZWQgPSBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzLmluY2x1ZGVzKGNvbW1hbmRUeXBlKSB8fCBidWlsdEluTWVtYmVyQ29tbWFuZHMuaW5jbHVkZXMoY29tbWFuZFR5cGUpIHx8IGNvbW1hbmRzLmluY2x1ZGVzKGNvbW1hbmRUeXBlKVxuICAgIGNvbnN0IGNvbW1hbmROYW1lID0gaXNFeHBvc2VkID8gaW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKGNvbW1hbmRUeXBlKSkgOiBjb21tYW5kVHlwZVxuXG4gICAgcmV0dXJuIHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWUoe1xuICAgICAgY29tbWFuZE5hbWUsXG4gICAgICBjb21tYW5kVHlwZSxcbiAgICAgIG1vZGVsTmFtZTogdGhpcy5nZXRNb2RlbE5hbWUoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgY3VzdG9tIGNvbW1hbmQgcGF5bG9hZCBhcmd1bWVudHMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gQ29tbWFuZCBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ29tbWFuZCBwYXlsb2FkLlxuICAgKi9cbiAgc3RhdGljIG5vcm1hbGl6ZUN1c3RvbUNvbW1hbmRQYXlsb2FkQXJndW1lbnRzKGFyZ3MpIHtcbiAgICBpZiAoYXJncy5sZW5ndGggPT09IDApIHJldHVybiB7fVxuICAgIGlmIChhcmdzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgY29uc3QgcGF5bG9hZCA9IGFyZ3NbMF1cbiAgICAgIGlmIChwYXlsb2FkID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHt9XG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2YgcGF5bG9hZCAhPT0gXCJvYmplY3RcIiB8fCBwYXlsb2FkID09PSBudWxsKSB7XG4gICAgICAgIHJldHVybiB7YXJnMTogcGF5bG9hZH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocGF5bG9hZClcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQYXlsb2FkLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXIgfCBzdHJpbmcgfCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7fVxuXG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGFyZ3MubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgICBwYXlsb2FkW2Bhcmcke2luZGV4ICsgMX1gXSA9IGFyZ3NbaW5kZXhdXG4gICAgfVxuXG4gICAgcmV0dXJuIHBheWxvYWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBtb2RlbCBuYW1lLCBwcmVmZXJyaW5nIGFuIGV4cGxpY2l0IGBzdGF0aWMgbW9kZWxOYW1lYCBkZWNsYXJhdGlvblxuICAgKiBvdmVyIHRoZSBKYXZhU2NyaXB0IGNsYXNzIGAubmFtZWAgcHJvcGVydHkuIFRoaXMgYWxsb3dzIG1pbmlmaWVkIGJ1aWxkcyB0b1xuICAgKiBwcmVzZXJ2ZSBjb3JyZWN0IG1vZGVsIG5hbWVzIHdpdGhvdXQgcmVseWluZyBvbiBga2VlcF9jbGFzc25hbWVzYC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgbW9kZWwgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRNb2RlbE5hbWUoKSB7XG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSB0aGlzLnJlc291cmNlQ29uZmlnKClcbiAgICBjb25zdCBtb2RlbE5hbWUgPSByZXNvdXJjZUNvbmZpZz8ubW9kZWxOYW1lXG5cbiAgICByZXR1cm4gKHR5cGVvZiBtb2RlbE5hbWUgPT09IFwic3RyaW5nXCIgJiYgbW9kZWxOYW1lLmxlbmd0aCA+IDApID8gbW9kZWxOYW1lIDogdGhpcy5uYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25maWd1cmUgdHJhbnNwb3J0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWd9IGNvbmZpZyAtIEZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgY29uZmlndXJlVHJhbnNwb3J0KGNvbmZpZykge1xuICAgIGlmICghY29uZmlnIHx8IHR5cGVvZiBjb25maWcgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInVybFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy51cmwgPSBjb25maWcudXJsXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwic2hhcmVkXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNoYXJlZCA9IGNvbmZpZy5zaGFyZWRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ3ZWJzb2NrZXRDbGllbnRcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50ID0gY29uZmlnLndlYnNvY2tldENsaWVudFxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcIndlYnNvY2tldFVybFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRVcmwgPSBjb25maWcud2Vic29ja2V0VXJsXG4gICAgICAvLyBSZXNldCBjYWNoZWQgaW50ZXJuYWwgY2xpZW50IHNvIHRoZSBuZXcgVVJMIHRha2VzIGVmZmVjdCBvbiBuZXh0IHN1YnNjcmliZVxuICAgICAgcmVzZXRJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwicmVxdWVzdEhlYWRlcnNcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdEhlYWRlcnMgPSBjb25maWcucmVxdWVzdEhlYWRlcnNcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJyZXF1ZXN0Q29udGV4dFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0Q29udGV4dCA9IGNvbmZpZy5yZXF1ZXN0Q29udGV4dFxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInRpbWVvdXRcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZW91dCA9IGNvbmZpZy50aW1lb3V0XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwic2lnbmFsXCIpKSB7XG4gICAgICBpZiAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zaWduYWwgIT09IGNvbmZpZy5zaWduYWwpIHtcbiAgICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zaWduYWwgPSBjb25maWcuc2lnbmFsXG4gICAgICAgIHJlc2V0SW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInRpbWVab25lXCIpKSB7XG4gICAgICBpZiAoY29uZmlnLnRpbWVab25lID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgZGVsZXRlIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZVpvbmVcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZVpvbmUgPSBjb25maWcudGltZVpvbmVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJzZXNzaW9uU3RvcmVcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2Vzc2lvblN0b3JlID0gY29uZmlnLnNlc3Npb25TdG9yZVxuICAgICAgLy8gUmVzZXQgY2FjaGVkIGludGVybmFsIGNsaWVudCBzbyB0aGUgbmV3IHNlc3Npb25TdG9yZSBpcyBwaWNrZWQgdXAuXG4gICAgICByZXNldEludGVybmFsV2Vic29ja2V0Q2xpZW50KClcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJvZmZsaW5lU3luY1wiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5vZmZsaW5lU3luYyA9IGNvbmZpZy5vZmZsaW5lU3luY1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb25uZWN0IHRoZSBpbnRlcm5hbCBXZWJTb2NrZXQgYW5kIGVuYWJsZSBhdXRvLXJlY29ubmVjdC5cbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyLCBzaWduYWw/OiBBYm9ydFNpZ25hbH19IFtvcHRpb25zXSAtIFN0YXJ0dXAgY29udHJvbHMgY29tcG9zZWQgd2l0aCB0aGUgY29uZmlndXJlZCB0cmFuc3BvcnQgY29udHJvbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29ubmVjdGVkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNvbm5lY3RXZWJzb2NrZXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgY2xpZW50ID0gcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KClcblxuICAgIGlmICghY2xpZW50KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJjb25uZWN0V2Vic29ja2V0IHJlcXVpcmVzIGNvbmZpZ3VyZVRyYW5zcG9ydCh7d2Vic29ja2V0VXJsfSlcIilcbiAgICB9XG5cbiAgICBhd2FpdCBjbGllbnQuY29ubmVjdChmcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKG9wdGlvbnMpKVxuICB9XG5cbiAgLyoqXG4gICAqIERpc2Nvbm5lY3QgdGhlIGludGVybmFsIFdlYlNvY2tldCBhbmQgZGlzYWJsZSBhdXRvLXJlY29ubmVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbG9zZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZGlzY29ubmVjdFdlYnNvY2tldCgpIHtcbiAgICBpZiAoIWludGVybmFsV2Vic29ja2V0Q2xpZW50KSByZXR1cm5cblxuICAgIGNvbnN0IGNsaWVudCA9IGludGVybmFsV2Vic29ja2V0Q2xpZW50XG5cbiAgICBkZXRhY2hJbnRlcm5hbFdlYnNvY2tldENsaWVudChjbGllbnQpXG4gICAgYXdhaXQgY2xpZW50LmRpc2Nvbm5lY3RBbmRTdG9wUmVjb25uZWN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyB1bnRpbCBxdWV1ZWQgYW5kIGFjdGl2ZSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgcmVxdWVzdHMgZmluaXNoLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxJZGxlV2FpdEFyZ3N9IFthcmdzXSAtIFdhaXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0cmFuc3BvcnQgaXMgaWRsZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB3YWl0Rm9ySWRsZShhcmdzID0ge30pIHtcbiAgICBjb25zdCB7cXVpZXRNcyA9IDAsIHRpbWVvdXQ6IHRpbWVvdXRNcyA9IDUwMDAsIC4uLnJlc3RBcmdzfSA9IGFyZ3NcbiAgICBjb25zdCByZXN0QXJnS2V5cyA9IE9iamVjdC5rZXlzKHJlc3RBcmdzKVxuXG4gICAgaWYgKHJlc3RBcmdLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biB3YWl0Rm9ySWRsZSBhcmdzOiAke3Jlc3RBcmdLZXlzLmpvaW4oXCIsIFwiKX1gKVxuICAgIH1cblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHF1aWV0TXMpIHx8IHF1aWV0TXMgPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIHdhaXRGb3JJZGxlIHF1aWV0TXMgdG8gYmUgYSBub24tbmVnYXRpdmUgbnVtYmVyLCBnb3Q6ICR7cXVpZXRNc31gKVxuICAgIH1cblxuICAgIGF3YWl0IHRpbWVvdXQoXG4gICAgICB7dGltZW91dDogdGltZW91dE1zLCBlcnJvck1lc3NhZ2U6IFwiVGltZWQgb3V0IHdhaXRpbmcgZm9yIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB0byBiZWNvbWUgaWRsZVwifSxcbiAgICAgIGFzeW5jICgpID0+IGF3YWl0IHdhaXRGb3JGcm9udGVuZE1vZGVsVHJhbnNwb3J0SWRsZShxdWlldE1zKVxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjdXJyZW50IFdlYlNvY2tldCBjb25uZWN0aW9uIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7e2Rpc2Nvbm5lY3RlZFNpbmNlOiBudW1iZXIgfCBudWxsLCBoYXNDbGllbnQ6IGJvb2xlYW4sIGlzT3BlbjogYm9vbGVhbiwgbGlzdGVuZXJDb3VudDogbnVtYmVyfX0gLSBTbmFwc2hvdCBvZiB0aGUgbWFuYWdlZCB3ZWJzb2NrZXQgY29ubmVjdGlvbiBzdGF0ZS5cbiAgICovXG4gIHN0YXRpYyB3ZWJzb2NrZXRTdGF0ZSgpIHtcbiAgICBpZiAoIWludGVybmFsV2Vic29ja2V0Q2xpZW50KSB7XG4gICAgICByZXR1cm4ge2Rpc2Nvbm5lY3RlZFNpbmNlOiBudWxsLCBoYXNDbGllbnQ6IGZhbHNlLCBpc09wZW46IGZhbHNlLCBsaXN0ZW5lckNvdW50OiAwfVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAuLi5pbnRlcm5hbFdlYnNvY2tldENsaWVudC5zdGF0ZSgpLFxuICAgICAgaGFzQ2xpZW50OiB0cnVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlIHRoZSByYXcgV2ViU29ja2V0IHdpdGhvdXQgZGlzYWJsaW5nIGF1dG8tcmVjb25uZWN0LiBVc2VkIGJ5IHRlc3RzIHRvXG4gICAqIHNpbXVsYXRlIGFuIHVuZXhwZWN0ZWQgbmV0d29yayBkcm9wIGFuZCB2ZXJpZnkgcmVjb25uZWN0aW9uIGJlaGF2aW9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzb2NrZXQgaGFzIGNsb3NlZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBkcm9wV2Vic29ja2V0KCkge1xuICAgIGlmICghaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQpIHJldHVyblxuXG4gICAgYXdhaXQgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQuZHJvcENvbm5lY3Rpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgZ2xvYmFsIG1ldGFkYXRhIG9uIHRoZSBXZWJTb2NrZXQgY29ubmVjdGlvbi4gU2VudCB0byB0aGUgc2VydmVyIGltbWVkaWF0ZWx5XG4gICAqIG92ZXIgV2ViU29ja2V0IGFuZCBleHBvc2VkIHRvIFdlYlNvY2tldC1ib3JuZSByZXF1ZXN0cyBhcyByZXF1ZXN0IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gTWV0YWRhdGEga2V5LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIE1ldGFkYXRhIHZhbHVlIChudWxsIHRvIGNsZWFyKS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgc2V0V2Vic29ja2V0TWV0YWRhdGEoa2V5LCB2YWx1ZSkge1xuICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgIGlmICghY2xpZW50IHx8IHR5cGVvZiBjbGllbnQuc2V0TWV0YWRhdGEgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuXG5cbiAgICBjbGllbnQuc2V0TWV0YWRhdGEoa2V5LCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBPcGVucyBhIG1hbmFnZWQgY29ubmVjdGlvbiB0aGF0IGF1dG8tb3BlbnMsIGF1dG8tY2xvc2VzLCBhbmRcbiAgICogYXV0by1yZWNvbm5lY3RzIGJhc2VkIG9uIGBzaG91bGRDb25uZWN0KClgIGFuZCBgcGFyYW1zKClgLlxuICAgKiBDYWxsIGBoYW5kbGUuc3luYygpYCB3aGVuZXZlciB0aGUgaW5wdXRzIHRoYXQgZHJpdmUgdGhvc2VcbiAgICogZnVuY3Rpb25zIGNoYW5nZSAoZS5nLiBjdXJyZW50LXVzZXIgc2lnbi1pbi9vdXQpLiBUaGUgaGFuZGxlXG4gICAqIHJldHJpZXMgd2hlbiB0aGUgV1MgY2xpZW50IGlzbid0IHJlYWR5IGFuZCByZW9wZW5zIG9uIGNsb3NlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29ubmVjdGlvblR5cGUgLSBDb25uZWN0aW9uIGNsYXNzIG5hbWUgcmVnaXN0ZXJlZCBvbiB0aGUgc2VydmVyLlxuICAgKiBAcGFyYW0ge3tzaG91bGRDb25uZWN0OiAoKSA9PiBib29sZWFuLCBwYXJhbXM6ICgpID0+IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgc2lnbmFsPzogQWJvcnRTaWduYWwsIG9uTWVzc2FnZT86IChib2R5OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZH19IG9wdGlvbnMgLSBDb25uZWN0aW9uIGxpZmVjeWNsZSwgY2FuY2VsbGF0aW9uLCBhbmQgcGF5bG9hZCBjYWxsYmFja3MuXG4gICAqIEByZXR1cm5zIHt7c3luYzogKCkgPT4gdm9pZCwgY2xvc2U6ICgpID0+IHZvaWR9fSAtIEhhbmRsZSB1c2VkIHRvIHJlc3luYyBvciBjbG9zZSB0aGUgbWFuYWdlZCBjb25uZWN0aW9uLlxuICAgKi9cbiAgc3RhdGljIG9wZW5NYW5hZ2VkQ29ubmVjdGlvbihjb25uZWN0aW9uVHlwZSwgb3B0aW9ucykge1xuICAgIC8qKlxuICAgICAqIENvbm5lY3Rpb24uXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIGxldCBjb25uZWN0aW9uID0gbnVsbFxuICAgIGxldCBjbG9zZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIFJldHJ5IHRpbWVyLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9ICovXG4gICAgbGV0IHJldHJ5VGltZXIgPSBudWxsXG4gICAgbGV0IGxhc3RQYXJhbXNKc29uID0gXCJcIlxuICAgIGNvbnN0IGNvbnRyb2xzID0gZnJvbnRlbmRNb2RlbFdlYnNvY2tldFN0YXJ0dXBDb250cm9scyh7c2lnbmFsOiBvcHRpb25zLnNpZ25hbH0pXG4gICAgY29uc3QgY2xlYXJSZXRyeVRpbWVyID0gKCkgPT4ge1xuICAgICAgaWYgKHJldHJ5VGltZXIgPT09IG51bGwpIHJldHVyblxuXG4gICAgICBnbG9iYWxUaGlzLmNsZWFyVGltZW91dChyZXRyeVRpbWVyKVxuICAgICAgcmV0cnlUaW1lciA9IG51bGxcbiAgICB9XG5cbiAgICBjb25zdCBjbG9zZSA9ICgpID0+IHtcbiAgICAgIGlmIChjbG9zZWQpIHJldHVyblxuXG4gICAgICBjbG9zZWQgPSB0cnVlXG4gICAgICBjbGVhclJldHJ5VGltZXIoKVxuICAgICAgY29udHJvbHMuc2lnbmFsPy5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgY2xvc2UpXG4gICAgICBpZiAoY29ubmVjdGlvbiAmJiAhY29ubmVjdGlvbi5pc0Nsb3NlZCgpKSBjb25uZWN0aW9uLmNsb3NlKClcbiAgICAgIGNvbm5lY3Rpb24gPSBudWxsXG4gICAgfVxuXG4gICAgY29uc3Qgc3luYyA9ICgpID0+IHtcbiAgICAgIGlmIChjbG9zZWQpIHJldHVyblxuXG4gICAgICBpZiAoIW9wdGlvbnMuc2hvdWxkQ29ubmVjdCgpKSB7XG4gICAgICAgIGNsZWFyUmV0cnlUaW1lcigpXG4gICAgICAgIGlmIChjb25uZWN0aW9uICYmICFjb25uZWN0aW9uLmlzQ2xvc2VkKCkpIGNvbm5lY3Rpb24uY2xvc2UoKVxuICAgICAgICBjb25uZWN0aW9uID0gbnVsbFxuICAgICAgICBsYXN0UGFyYW1zSnNvbiA9IFwiXCJcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5leHRQYXJhbXMgPSBvcHRpb25zLnBhcmFtcygpXG4gICAgICBjb25zdCBuZXh0UGFyYW1zSnNvbiA9IEpTT04uc3RyaW5naWZ5KG5leHRQYXJhbXMpXG5cbiAgICAgIC8vIEFscmVhZHkgY29ubmVjdGVkIHdpdGggc2FtZSBwYXJhbXMg4oCUIG5vdGhpbmcgdG8gZG8uXG4gICAgICBpZiAoY29ubmVjdGlvbiAmJiAhY29ubmVjdGlvbi5pc0Nsb3NlZCgpICYmIG5leHRQYXJhbXNKc29uID09PSBsYXN0UGFyYW1zSnNvbikgcmV0dXJuXG5cbiAgICAgIC8vIENvbm5lY3RlZCBidXQgcGFyYW1zIGNoYW5nZWQg4oCUIHNlbmQgdXBkYXRlIG1lc3NhZ2UuXG4gICAgICAvLyBHdWFyZCB3aXRoIHRyeS9jYXRjaDogdGhlIGNvbm5lY3Rpb24gaGFuZGxlIHN0YXlzIGxpdmUgZHVyaW5nXG4gICAgICAvLyByZWNvbm5lY3QgYnV0IHRoZSB1bmRlcmx5aW5nIHNvY2tldCBtYXkgYmUgY2xvc2VkLlxuICAgICAgaWYgKGNvbm5lY3Rpb24gJiYgIWNvbm5lY3Rpb24uaXNDbG9zZWQoKSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbm5lY3Rpb24uc2VuZE1lc3NhZ2UobmV4dFBhcmFtcylcbiAgICAgICAgICBsYXN0UGFyYW1zSnNvbiA9IG5leHRQYXJhbXNKc29uXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIGNvbm5lY3Rpb24gPSBudWxsXG4gICAgICAgICAgbGFzdFBhcmFtc0pzb24gPSBcIlwiXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gV1MgY2xpZW50IG5vdCByZWFkeSDigJQgcmV0cnkuIENoZWNrIHRoZSBhY3R1YWwgY2xpZW50ICh3aGljaFxuICAgICAgLy8gbWF5IGJlIGFuIGluamVjdGVkIHdlYnNvY2tldENsaWVudCkgaW5zdGVhZCBvZiB3ZWJzb2NrZXRTdGF0ZSgpXG4gICAgICAvLyB3aGljaCBvbmx5IHJlZmxlY3RzIHRoZSBpbnRlcm5hbCBjbGllbnQuXG4gICAgICBjb25zdCBjbGllbnQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgfHwgcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkpXG5cbiAgICAgIGlmICghY2xpZW50IHx8ICFjbGllbnQuaXNPcGVuKCkpIHtcbiAgICAgICAgaWYgKHJldHJ5VGltZXIgPT09IG51bGwpIHtcbiAgICAgICAgICByZXRyeVRpbWVyID0gZ2xvYmFsVGhpcy5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIHJldHJ5VGltZXIgPSBudWxsXG4gICAgICAgICAgICBzeW5jKClcbiAgICAgICAgICB9LCAyNTApXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGxhc3RQYXJhbXNKc29uID0gbmV4dFBhcmFtc0pzb25cbiAgICAgIGNvbm5lY3Rpb24gPSBjbGllbnQub3BlbkNvbm5lY3Rpb24oY29ubmVjdGlvblR5cGUsIHtcbiAgICAgICAgcGFyYW1zOiBuZXh0UGFyYW1zLFxuICAgICAgICBvbk1lc3NhZ2U6IG9wdGlvbnMub25NZXNzYWdlLFxuICAgICAgICBvbkNsb3NlOiAoKSA9PiB7XG4gICAgICAgICAgaWYgKGNvbm5lY3Rpb24/LmlzQ2xvc2VkKCkpIHtcbiAgICAgICAgICAgIGNvbm5lY3Rpb24gPSBudWxsXG4gICAgICAgICAgICBsYXN0UGFyYW1zSnNvbiA9IFwiXCJcbiAgICAgICAgICAgIHN5bmMoKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBjb250cm9scy5zaWduYWw/LmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBjbG9zZSwge29uY2U6IHRydWV9KVxuXG4gICAgaWYgKGNvbnRyb2xzLnNpZ25hbD8uYWJvcnRlZCkge1xuICAgICAgY2xvc2UoKVxuICAgIH0gZWxzZSB7XG4gICAgICBzeW5jKClcbiAgICB9XG5cbiAgICByZXR1cm4ge3N5bmMsIGNsb3NlfVxuICB9XG5cbiAgLyoqXG4gICAqIE9wZW5zIGEgMToxIGBXZWJzb2NrZXRDb25uZWN0aW9uYCBvZiB0aGUgZ2l2ZW4gdHlwZS4gVGhpblxuICAgKiBjb252ZW5pZW5jZSB3cmFwcGVyIGFyb3VuZCB0aGUgaW50ZXJuYWwgV1MgY2xpZW50J3NcbiAgICogYG9wZW5Db25uZWN0aW9uYC4gQXBwcyB1c2UgdGhpcyBmb3IgcGVyLXNlc3Npb24gc3RhdGUvbWVzc2FnaW5nXG4gICAqIHRoYXQgZG9lc24ndCBmaXQgdGhlIHB1Yi9zdWIgQ2hhbm5lbCBtb2RlbCAobG9jYWxlLCBwcmVzZW5jZSkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25uZWN0aW9uVHlwZSAtIE5hbWUgdGhlIHNlcnZlciByZWdpc3RlcmVkIHRoZSBjbGFzcyB1bmRlci5cbiAgICogQHBhcmFtIHt7cGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCB0aW1lb3V0TXM/OiBudW1iZXIsIHNpZ25hbD86IEFib3J0U2lnbmFsLCBvbkNvbm5lY3Q/OiAoKSA9PiB2b2lkLCBvbk1lc3NhZ2U/OiAoYm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHZvaWQsIG9uRGlzY29ubmVjdD86ICgpID0+IHZvaWQsIG9uUmVzdW1lPzogKCkgPT4gdm9pZCwgb25DbG9zZT86IChyZWFzb246IHN0cmluZykgPT4gdm9pZH19IFtvcHRpb25zXSAtIENvbm5lY3Rpb24gb3B0aW9ucywgcmVhZGluZXNzIGNvbnRyb2xzLCBhbmQgZXZlbnQgaGFuZGxlcnMuIENvbm5lY3QgdGhlIGNsaWVudCBmaXJzdDsgdGhlIHRpbWVvdXQgY292ZXJzIHNlcnZlci1jb25maXJtZWQgcmVhZGluZXNzIGFuZCB0aGUgc2lnbmFsIGNhbmNlbHMgcmVhZGluZXNzIHdpdGhvdXQgZW50ZXJpbmcgdGhlIHdpcmUgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3tyZWFkeTogUHJvbWlzZTx2b2lkPiwgY2xvc2U6ICgpID0+IHZvaWR9fSAtIFdlYnNvY2tldCBjb25uZWN0aW9uIGhhbmRsZS5cbiAgICovXG4gIHN0YXRpYyBvcGVuV2Vic29ja2V0Q29ubmVjdGlvbihjb25uZWN0aW9uVHlwZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50IHx8IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpKVxuXG4gICAgaWYgKCFjbGllbnQgfHwgdHlwZW9mIGNsaWVudC5vcGVuQ29ubmVjdGlvbiAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJvcGVuV2Vic29ja2V0Q29ubmVjdGlvbiByZXF1aXJlcyBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldFVybH0pXCIpXG4gICAgfVxuXG4gICAgY29uc3Qge3NpZ25hbCwgdGltZW91dE1zLCAuLi5jb25uZWN0aW9uT3B0aW9uc30gPSBvcHRpb25zXG5cbiAgICByZXR1cm4gY2xpZW50Lm9wZW5Db25uZWN0aW9uKGNvbm5lY3Rpb25UeXBlLCB7XG4gICAgICAuLi5jb25uZWN0aW9uT3B0aW9ucyxcbiAgICAgIC4uLmZyb250ZW5kTW9kZWxXZWJzb2NrZXRTdGFydHVwQ29udHJvbHMoe3NpZ25hbCwgdGltZW91dE1zfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFN1YnNjcmliZXMgdG8gYSBwdWIvc3ViIGBXZWJzb2NrZXRDaGFubmVsYC4gVGhpbiB3cmFwcGVyIGFyb3VuZFxuICAgKiB0aGUgaW50ZXJuYWwgY2xpZW50J3MgYHN1YnNjcmliZUNoYW5uZWxgLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbFR5cGUgLSBDaGFubmVsIGNsYXNzIG5hbWUgcmVnaXN0ZXJlZCBvbiB0aGUgc2VydmVyLlxuICAgKiBAcGFyYW0ge3twYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHRpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWwsIG9uTWVzc2FnZT86IChib2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gdm9pZCwgb25EaXNjb25uZWN0PzogKCkgPT4gdm9pZCwgb25SZXN1bWU/OiAoKSA9PiB2b2lkLCBvbkNsb3NlPzogKHJlYXNvbjogc3RyaW5nKSA9PiB2b2lkfX0gW29wdGlvbnNdIC0gQ2hhbm5lbCBvcHRpb25zLCBzdGFydHVwIGNvbnRyb2xzLCBhbmQgZXZlbnQgaGFuZGxlcnMuIFRoZSB0aW1lb3V0IGNvdmVycyBjb25uZWN0IGFuZCBzZXJ2ZXItY29uZmlybWVkIHJlYWRpbmVzcyBvbmx5OyB0aGUgc2lnbmFsIGNhbmNlbHMgc3RhcnR1cCB3aXRob3V0IGVudGVyaW5nIHRoZSB3aXJlIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt7cmVhZHk6IFByb21pc2U8dm9pZD4sIGNsb3NlOiAoKSA9PiB2b2lkfX0gLSBXZWJzb2NrZXQgY2hhbm5lbCBoYW5kbGUgZnJvbSB0aGUgY29uZmlndXJlZCBjbGllbnQuXG4gICAqL1xuICBzdGF0aWMgc3Vic2NyaWJlV2Vic29ja2V0Q2hhbm5lbChjaGFubmVsVHlwZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50IHx8IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpKVxuXG4gICAgaWYgKCFjbGllbnQgfHwgdHlwZW9mIGNsaWVudC5zdWJzY3JpYmVDaGFubmVsICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN1YnNjcmliZVdlYnNvY2tldENoYW5uZWwgcmVxdWlyZXMgY29uZmlndXJlVHJhbnNwb3J0KHt3ZWJzb2NrZXRVcmx9KVwiKVxuICAgIH1cblxuICAgIGNvbnN0IHtwYXJhbXMsIHNpZ25hbCwgdGltZW91dE1zLCAuLi5jaGFubmVsT3B0aW9uc30gPSBvcHRpb25zXG4gICAgY29uc3QgcmVxdWVzdENvbnRleHQgPSBmcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoKVxuICAgIGNvbnN0IHNjb3BlZFBhcmFtcyA9IG1lcmdlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0LCBwYXJhbXMgPT09IHVuZGVmaW5lZCA/IHt9IDogcGFyYW1zKVxuICAgIGNvbnN0IHN0YXJ0dXBDb250cm9scyA9IGZyb250ZW5kTW9kZWxXZWJzb2NrZXRTdGFydHVwQ29udHJvbHMoe3NpZ25hbCwgdGltZW91dE1zfSlcbiAgICBjb25zdCBzY29wZWRQYXJhbXNPcHRpb24gPSBwYXJhbXMgPT09IHVuZGVmaW5lZCAmJiBPYmplY3Qua2V5cyhyZXF1ZXN0Q29udGV4dCkubGVuZ3RoID09PSAwXG4gICAgICA/IHt9XG4gICAgICA6IHtwYXJhbXM6IHNjb3BlZFBhcmFtc31cbiAgICBjb25zdCBoYW5kbGUgPSBjbGllbnQuc3Vic2NyaWJlQ2hhbm5lbChjaGFubmVsVHlwZSwgey4uLmNoYW5uZWxPcHRpb25zLCAuLi5zY29wZWRQYXJhbXNPcHRpb24sIC4uLnN0YXJ0dXBDb250cm9sc30pXG5cbiAgICBpZiAodHlwZW9mIGNsaWVudC5jb25uZWN0ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHZvaWQgY2xpZW50LmNvbm5lY3Qoc3RhcnR1cENvbnRyb2xzKS5jYXRjaCgoKSA9PiBoYW5kbGUuY2xvc2UoKSlcbiAgICB9XG5cbiAgICByZXR1cm4gaGFuZGxlXG4gIH1cblxuICAvKipcbiAgICogSW5zdGFsbHMgV2ViU29ja2V0IGxpZmVjeWNsZSBob29rcyBvbiBnbG9iYWxUaGlzIGZvciBzeXN0ZW0gdGVzdCBhY2Nlc3MuXG4gICAqIFRlc3RzIGNhbiBjYWxsIGBnbG9iYWxUaGlzLl9fdmVsb2Npb3VzX3dlYnNvY2tldF9ob29rcy5jb25uZWN0KClgIGV0Yy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgaW5zdGFsbFdlYnNvY2tldFRlc3RIb29rcygpIHtcbiAgICBpZiAodHlwZW9mIGdsb2JhbFRoaXMgPT09IFwidW5kZWZpbmVkXCIpIHJldHVyblxuXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGdsb2JhbFRoaXMpLl9fdmVsb2Npb3VzX3dlYnNvY2tldF9ob29rcyA9IHtcbiAgICAgIGNvbm5lY3Q6ICgpID0+IHRoaXMuY29ubmVjdFdlYnNvY2tldCgpLFxuICAgICAgZGlzY29ubmVjdDogKCkgPT4gdGhpcy5kaXNjb25uZWN0V2Vic29ja2V0KCksXG4gICAgICBkcm9wOiAoKSA9PiB0aGlzLmRyb3BXZWJzb2NrZXQoKSxcbiAgICAgIHN0YXRlOiAoKSA9PiB0aGlzLndlYnNvY2tldFN0YXRlKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRyaWJ1dGVzIGZyb20gcmVzcG9uc2UuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7b2JqZWN0fSByZXNwb25zZSAtIFJlc3BvbnNlIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAtIEF0dHJpYnV0ZXMgZnJvbSBwYXlsb2FkLlxuICAgKi9cbiAgc3RhdGljIGF0dHJpYnV0ZXNGcm9tUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICBjb25zdCBtb2RlbERhdGEgPSB0aGlzLm1vZGVsRGF0YUZyb21SZXNwb25zZShyZXNwb25zZSlcblxuICAgIHJldHVybiBtb2RlbERhdGEuYXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbW9kZWwgZGF0YSBmcm9tIHJlc3BvbnNlLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge29iamVjdH0gcmVzcG9uc2UgLSBSZXNwb25zZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7e2FiaWxpdGllczogUmVjb3JkPHN0cmluZywgYm9vbGVhbj4sIGF0dGFjaG1lbnRPd25lcjoge3JlY29yZElkOiBzdHJpbmcsIHJlY29yZFR5cGU6IHN0cmluZywgcmVzb3VyY2VOYW1lOiBzdHJpbmd9IHwgbnVsbCwgYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgYXNzb2NpYXRpb25Db3VudHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4sIHF1ZXJ5RGF0YTogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgcHJlbG9hZGVkUmVsYXRpb25zaGlwczogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgc2VsZWN0ZWRBdHRyaWJ1dGVzOiBTZXQ8c3RyaW5nPn19IC0gQXR0cmlidXRlcywgYXR0YWNobWVudCBvd25lciwgcHJlbG9hZGVkIHJlbGF0aW9uc2hpcHMsIGFzc29jaWF0aW9uIGNvdW50cywgcXVlcnlEYXRhLCBhYmlsaXRpZXMsIGFuZCBzZWxlY3RlZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgc3RhdGljIG1vZGVsRGF0YUZyb21SZXNwb25zZShyZXNwb25zZSkge1xuICAgIGlmICghcmVzcG9uc2UgfHwgdHlwZW9mIHJlc3BvbnNlICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG9iamVjdCByZXNwb25zZSBidXQgZ290OiAke3Jlc3BvbnNlfWApXG4gICAgfVxuXG4gICAgLy8gTmFycm93cyB0aGUgcmVzcG9uc2Ugb2JqZWN0IHRvIHRoZSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgdmFsdWUgbWFwLlxuICAgIGNvbnN0IHJlc3BvbnNlT2JqZWN0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAocmVzcG9uc2UpXG5cbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIG1vZGVsRGF0YS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi9cbiAgICBsZXQgbW9kZWxEYXRhXG5cbiAgICBpZiAocmVzcG9uc2VPYmplY3QubW9kZWwgJiYgdHlwZW9mIHJlc3BvbnNlT2JqZWN0Lm1vZGVsID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAvLyBOYXJyb3dzIHRoZSBuZXN0ZWQgbW9kZWwgcGF5bG9hZCB0byB0aGUgZnJvbnRlbmQtbW9kZWwgdmFsdWUgbWFwLlxuICAgICAgbW9kZWxEYXRhID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAocmVzcG9uc2VPYmplY3QubW9kZWwpXG4gICAgfSBlbHNlIGlmIChyZXNwb25zZU9iamVjdC5hdHRyaWJ1dGVzICYmIHR5cGVvZiByZXNwb25zZU9iamVjdC5hdHRyaWJ1dGVzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAvLyBOYXJyb3dzIHRoZSBuZXN0ZWQgYXR0cmlidXRlcyBwYXlsb2FkIHRvIHRoZSBmcm9udGVuZC1tb2RlbCB2YWx1ZSBtYXAuXG4gICAgICBtb2RlbERhdGEgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChyZXNwb25zZU9iamVjdC5hdHRyaWJ1dGVzKVxuICAgIH0gZWxzZSB7XG4gICAgICBtb2RlbERhdGEgPSByZXNwb25zZU9iamVjdFxuICAgIH1cblxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovICh7Li4ubW9kZWxEYXRhfSlcbiAgICBjb25zdCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzID0gaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzW1BSRUxPQURFRF9SRUxBVElPTlNISVBTX0tFWV0pXG4gICAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKGF0dHJpYnV0ZXNbUFJFTE9BREVEX1JFTEFUSU9OU0hJUFNfS0VZXSlcbiAgICAgIDoge31cbiAgICBjb25zdCBhc3NvY2lhdGlvbkNvdW50cyA9IGlzUGxhaW5PYmplY3QoYXR0cmlidXRlc1tBU1NPQ0lBVElPTl9DT1VOVFNfS0VZXSlcbiAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqLyAoYXR0cmlidXRlc1tBU1NPQ0lBVElPTl9DT1VOVFNfS0VZXSlcbiAgICAgIDoge31cbiAgICBjb25zdCBxdWVyeURhdGEgPSBpc1BsYWluT2JqZWN0KGF0dHJpYnV0ZXNbUVVFUllfREFUQV9LRVldKVxuICAgICAgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChhdHRyaWJ1dGVzW1FVRVJZX0RBVEFfS0VZXSlcbiAgICAgIDoge31cbiAgICBjb25zdCBhYmlsaXRpZXMgPSBpc1BsYWluT2JqZWN0KGF0dHJpYnV0ZXNbQUJJTElUSUVTX0tFWV0pXG4gICAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbj59ICovIChhdHRyaWJ1dGVzW0FCSUxJVElFU19LRVldKVxuICAgICAgOiB7fVxuICAgIGNvbnN0IHNlbGVjdGVkQXR0cmlidXRlc0Zyb21QYXlsb2FkID0gQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVzW1NFTEVDVEVEX0FUVFJJQlVURVNfS0VZXSlcbiAgICAgID8gbmV3IFNldCgvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoYXR0cmlidXRlc1tTRUxFQ1RFRF9BVFRSSUJVVEVTX0tFWV0pLmZpbHRlcigoYXR0cmlidXRlTmFtZSkgPT4gdHlwZW9mIGF0dHJpYnV0ZU5hbWUgPT09IFwic3RyaW5nXCIpKVxuICAgICAgOiBudWxsXG4gICAgY29uc3QgYXR0YWNobWVudE93bmVyUGF5bG9hZCA9IGF0dHJpYnV0ZXNbQVRUQUNITUVOVF9PV05FUl9LRVldXG4gICAgbGV0IGF0dGFjaG1lbnRPd25lciA9IG51bGxcblxuICAgIGlmIChhdHRhY2htZW50T3duZXJQYXlsb2FkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmICghaXNQbGFpbk9iamVjdChhdHRhY2htZW50T3duZXJQYXlsb2FkKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBFeHBlY3RlZCAke0FUVEFDSE1FTlRfT1dORVJfS0VZfSB0byBiZSBhbiBvYmplY3RgKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhdHRhY2htZW50T3duZXJPYmplY3QgPSAvKiogQHR5cGUge3tyZWNvcmRJZD86IHVua25vd24sIHJlY29yZFR5cGU/OiB1bmtub3duLCByZXNvdXJjZU5hbWU/OiB1bmtub3dufX0gKi8gKGF0dGFjaG1lbnRPd25lclBheWxvYWQpXG5cbiAgICAgIGF0dGFjaG1lbnRPd25lciA9IHtcbiAgICAgICAgcmVjb3JkSWQ6IGZvcmNlZE5vbkJsYW5rU3RyaW5nKGF0dGFjaG1lbnRPd25lck9iamVjdC5yZWNvcmRJZCwgYCR7QVRUQUNITUVOVF9PV05FUl9LRVl9LnJlY29yZElkYCksXG4gICAgICAgIHJlY29yZFR5cGU6IGZvcmNlZE5vbkJsYW5rU3RyaW5nKGF0dGFjaG1lbnRPd25lck9iamVjdC5yZWNvcmRUeXBlLCBgJHtBVFRBQ0hNRU5UX09XTkVSX0tFWX0ucmVjb3JkVHlwZWApLFxuICAgICAgICByZXNvdXJjZU5hbWU6IGZvcmNlZE5vbkJsYW5rU3RyaW5nKGF0dGFjaG1lbnRPd25lck9iamVjdC5yZXNvdXJjZU5hbWUsIGAke0FUVEFDSE1FTlRfT1dORVJfS0VZfS5yZXNvdXJjZU5hbWVgKVxuICAgICAgfVxuICAgIH1cblxuICAgIGRlbGV0ZSBhdHRyaWJ1dGVzW0FUVEFDSE1FTlRfT1dORVJfS0VZXVxuICAgIGRlbGV0ZSBhdHRyaWJ1dGVzW1BSRUxPQURFRF9SRUxBVElPTlNISVBTX0tFWV1cbiAgICBkZWxldGUgYXR0cmlidXRlc1tTRUxFQ1RFRF9BVFRSSUJVVEVTX0tFWV1cbiAgICBkZWxldGUgYXR0cmlidXRlc1tBU1NPQ0lBVElPTl9DT1VOVFNfS0VZXVxuICAgIGRlbGV0ZSBhdHRyaWJ1dGVzW1FVRVJZX0RBVEFfS0VZXVxuICAgIGRlbGV0ZSBhdHRyaWJ1dGVzW0FCSUxJVElFU19LRVldXG5cbiAgICBjb25zdCBzZWxlY3RlZEF0dHJpYnV0ZXMgPSBzZWxlY3RlZEF0dHJpYnV0ZXNGcm9tUGF5bG9hZCB8fCBuZXcgU2V0KE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpKVxuXG4gICAgcmV0dXJuIHthYmlsaXRpZXMsIGF0dGFjaG1lbnRPd25lciwgYXR0cmlidXRlcywgYXNzb2NpYXRpb25Db3VudHMsIHF1ZXJ5RGF0YSwgcHJlbG9hZGVkUmVsYXRpb25zaGlwcywgc2VsZWN0ZWRBdHRyaWJ1dGVzfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgcHJlbG9hZGVkIHJlbGF0aW9uc2hpcHMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzIC0gUHJlbG9hZGVkIHJlbGF0aW9uc2hpcCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhcHBseVByZWxvYWRlZFJlbGF0aW9uc2hpcHMobW9kZWwsIHByZWxvYWRlZFJlbGF0aW9uc2hpcHMpIHtcbiAgICBmb3IgKGNvbnN0IFtyZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBQYXlsb2FkXSBvZiBPYmplY3QuZW50cmllcyhwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKSkge1xuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gdGhpcy5yZWxhdGlvbnNoaXBNb2RlbENsYXNzKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCkge1xuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkocmVsYXRpb25zaGlwUGF5bG9hZCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9IHBheWxvYWQgdG8gYmUgYW4gYXJyYXlgKVxuICAgICAgICB9XG5cbiAgICAgICAgLyoqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsQmFzZT59ICovXG4gICAgICAgIGNvbnN0IHJlbGF0ZWRNb2RlbHMgPSBbXVxuXG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmVsYXRpb25zaGlwUGF5bG9hZCkge1xuICAgICAgICAgIGNvbnN0IHJlbGF0ZWRNb2RlbCA9IHRoaXMuaW5zdGFudGlhdGVSZWxhdGlvbnNoaXBWYWx1ZShlbnRyeSwgdGFyZ2V0TW9kZWxDbGFzcylcblxuICAgICAgICAgIGlmICghKHJlbGF0ZWRNb2RlbCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxCYXNlKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfSBwYXlsb2FkIGVudHJ5IHRvIGluc3RhbnRpYXRlIGEgZnJvbnRlbmQgbW9kZWxgKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJlbGF0ZWRNb2RlbHMucHVzaChyZWxhdGVkTW9kZWwpXG4gICAgICAgIH1cblxuICAgICAgICByZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHJlbGF0ZWRNb2RlbHMpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHJlbGF0aW9uc2hpcFBheWxvYWQpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX0gcGF5bG9hZCB0byBiZSBzaW5ndWxhcmApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlbGF0ZWRNb2RlbCA9IHRoaXMuaW5zdGFudGlhdGVSZWxhdGlvbnNoaXBWYWx1ZShyZWxhdGlvbnNoaXBQYXlsb2FkLCB0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgICBpZiAocmVsYXRlZE1vZGVsICE9IHVuZGVmaW5lZCAmJiAhKHJlbGF0ZWRNb2RlbCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxCYXNlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9IHBheWxvYWQgdG8gaW5zdGFudGlhdGUgYSBmcm9udGVuZCBtb2RlbGApXG4gICAgICB9XG5cbiAgICAgIHJlbGF0aW9uc2hpcC5zZXRMb2FkZWQocmVsYXRlZE1vZGVsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc3RhbnRpYXRlIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVsYXRpb25zaGlwUGF5bG9hZCAtIFJlbGF0aW9uc2hpcCBwYXlsb2FkIHZhbHVlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzcyB8IG51bGx9IHRhcmdldE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBJbnN0YW50aWF0ZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGluc3RhbnRpYXRlUmVsYXRpb25zaGlwVmFsdWUocmVsYXRpb25zaGlwUGF5bG9hZCwgdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgIGlmICghdGFyZ2V0TW9kZWxDbGFzcykgcmV0dXJuIHJlbGF0aW9uc2hpcFBheWxvYWRcblxuICAgIGlmICghcmVsYXRpb25zaGlwUGF5bG9hZCB8fCB0eXBlb2YgcmVsYXRpb25zaGlwUGF5bG9hZCAhPT0gXCJvYmplY3RcIikgcmV0dXJuIHJlbGF0aW9uc2hpcFBheWxvYWRcblxuICAgIHJldHVybiB0YXJnZXRNb2RlbENsYXNzLmluc3RhbnRpYXRlRnJvbVJlc3BvbnNlKHJlbGF0aW9uc2hpcFBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnN0YW50aWF0ZSBmcm9tIHJlc3BvbnNlLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBJbnN0YW5jZVR5cGU8VD59IHJlc3BvbnNlIC0gUmVzcG9uc2UgcGF5bG9hZCwgb3IgYW4gYWxyZWFkeS1oeWRyYXRlZCBpbnN0YW5jZSBvZiB0aGlzIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7SW5zdGFuY2VUeXBlPFQ+fSAtIE5ldyBtb2RlbCBpbnN0YW5jZSwgb3IgdGhlIHNhbWUgaW5zdGFuY2UgdW5jaGFuZ2VkIGlmIGl0IHdhcyBhbHJlYWR5IGh5ZHJhdGVkLlxuICAgKi9cbiAgc3RhdGljIGluc3RhbnRpYXRlRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgLy8gSWRlbXBvdGVudDogaWYgYSBjYWxsZXIgaGFuZHMgdXMgYW4gYWxyZWFkeS1oeWRyYXRlZCBpbnN0YW5jZSBvZiB0aGlzXG4gICAgLy8gY2xhc3MgKG5vdyBjb21tb24gYmVjYXVzZSB0aGUgc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSBhdXRvLXNlcmlhbGl6ZXNcbiAgICAvLyBiYWNrZW5kIGBSZWNvcmRgIGluc3RhbmNlcyByZXR1cm5lZCBmcm9tIGN1c3RvbSBjb21tYW5kcyBhbmQgdGhlXG4gICAgLy8gdHJhbnNwb3J0IGRlc2VyaWFsaXplciBoeWRyYXRlcyB0aGVtIGludG8gbW9kZWxzIGJlZm9yZSB0aGUgY2FsbCBzaXRlXG4gICAgLy8gc2VlcyB0aGUgcmVzcG9uc2UpLCByZXR1cm4gaXQgYXMtaXMuIFdpdGhvdXQgdGhpcywgY29kZSB0aGF0IGhhc1xuICAgIC8vIGhpc3RvcmljYWxseSB3cmFwcGVkIGN1c3RvbS1jb21tYW5kIHJlc3BvbnNlcyBpblxuICAgIC8vIGBNb2RlbC5pbnN0YW50aWF0ZUZyb21SZXNwb25zZShyZXNwb25zZS5maWVsZClgIHdvdWxkIHNwcmVhZCB0aGUgbGl2ZVxuICAgIC8vIG1vZGVsIGluc3RhbmNlIGludG8gYSBuZXcgY29uc3RydWN0b3IgY2FsbCBhbmQgcHJvZHVjZSBhIGJyb2tlbiBtb2RlbFxuICAgIC8vIHdpdGggaW50ZXJuYWwgc3RhdGUga2V5cyBwcm9tb3RlZCB0byBhdHRyaWJ1dGVzLlxuICAgIGlmIChyZXNwb25zZSBpbnN0YW5jZW9mIHRoaXMpIHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge0luc3RhbmNlVHlwZTxUPn0gKi8gKHJlc3BvbnNlKVxuICAgIH1cblxuICAgIGNvbnN0IG1vZGVsRGF0YSA9IHRoaXMubW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSBtb2RlbERhdGEuYXR0cmlidXRlc1xuICAgIGNvbnN0IHByZWxvYWRlZFJlbGF0aW9uc2hpcHMgPSBtb2RlbERhdGEucHJlbG9hZGVkUmVsYXRpb25zaGlwc1xuICAgIGNvbnN0IGFzc29jaWF0aW9uQ291bnRzID0gbW9kZWxEYXRhLmFzc29jaWF0aW9uQ291bnRzXG4gICAgY29uc3QgcXVlcnlEYXRhID0gbW9kZWxEYXRhLnF1ZXJ5RGF0YVxuICAgIGNvbnN0IGFiaWxpdGllcyA9IG1vZGVsRGF0YS5hYmlsaXRpZXNcbiAgICBjb25zdCBhdHRhY2htZW50T3duZXIgPSBtb2RlbERhdGEuYXR0YWNobWVudE93bmVyXG4gICAgY29uc3Qgc2VsZWN0ZWRBdHRyaWJ1dGVzID0gbW9kZWxEYXRhLnNlbGVjdGVkQXR0cmlidXRlc1xuICAgIGNvbnN0IHJlY2VpdmVyID0gLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcylcbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtuZXcgKGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+KSA9PiBJbnN0YW5jZVR5cGU8VD59ICovIChyZWNlaXZlcilcbiAgICBjb25zdCBtb2RlbCA9IG5ldyBNb2RlbENsYXNzKGF0dHJpYnV0ZXMpXG4gICAgbW9kZWwuX2F0dGFjaG1lbnRPd25lciA9IGF0dGFjaG1lbnRPd25lclxuICAgIG1vZGVsLl9zZWxlY3RlZEF0dHJpYnV0ZXMgPSBzZWxlY3RlZEF0dHJpYnV0ZXMgPyBuZXcgU2V0KHNlbGVjdGVkQXR0cmlidXRlcykgOiBudWxsXG5cbiAgICB0aGlzLmFwcGx5UHJlbG9hZGVkUmVsYXRpb25zaGlwcyhtb2RlbCwgcHJlbG9hZGVkUmVsYXRpb25zaGlwcylcblxuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhc3NvY2lhdGlvbkNvdW50cyB8fCB7fSkpIHtcbiAgICAgIG1vZGVsLl9zZXRBc3NvY2lhdGlvbkNvdW50KGF0dHJpYnV0ZU5hbWUsIE51bWJlcih2YWx1ZSkgfHwgMClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IFtuYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocXVlcnlEYXRhIHx8IHt9KSkge1xuICAgICAgbW9kZWwuX3NldFF1ZXJ5RGF0YShuYW1lLCB2YWx1ZSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IFthY3Rpb24sIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhYmlsaXRpZXMgfHwge30pKSB7XG4gICAgICBtb2RlbC5fc2V0Q29tcHV0ZWRBYmlsaXR5KGFjdGlvbiwgQm9vbGVhbih2YWx1ZSkpXG4gICAgfVxuXG4gICAgbW9kZWwuc2V0SXNOZXdSZWNvcmQoZmFsc2UpXG4gICAgbW9kZWwuX3BlcnNpc3RlZEF0dHJpYnV0ZXMgPSBjbG9uZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKG1vZGVsLmF0dHJpYnV0ZXMoKSlcblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gUmVjb3JkIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gUmVzb2x2ZWQgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZChpZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZChpZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIEF0dHJpYnV0ZSBtYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBGb3VuZCBtb2RlbCBvciBudWxsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRCeShjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kQnkoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgb3IgZmFpbC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gQXR0cmlidXRlIG1hdGNoIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRm91bmQgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZEJ5T3JGYWlsKGNvbmRpdGlvbnMpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpbmRCeU9yRmFpbChjb25kaXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYXJyYXkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD5bXT59IC0gTG9hZGVkIG1vZGVsIGluc3RhbmNlcy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB0b0FycmF5KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkudG9BcnJheSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+W10+fSAtIExvYWRlZCBtb2RlbCBpbnN0YW5jZXMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgbG9hZCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmxvYWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWxsLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyLlxuICAgKi9cbiAgc3RhdGljIGFsbCgpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aGVyZS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gUm9vdC1tb2RlbCB3aGVyZSBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggd2hlcmUgY29uZGl0aW9ucy5cbiAgICovXG4gIHN0YXRpYyB3aGVyZShjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS53aGVyZShjb25kaXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgam9pbnMuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IGpvaW5zIC0gUmVsYXRpb25zaGlwIGRlc2NyaXB0b3Igam9pbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCBqb2lucy5cbiAgICovXG4gIHN0YXRpYyBqb2lucyhqb2lucykge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuam9pbnMoam9pbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsaW1pdC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIE1heGltdW0gbnVtYmVyIG9mIHJlY29yZHMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCBsaW1pdC5cbiAgICovXG4gIHN0YXRpYyBsaW1pdCh2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkubGltaXQodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvZmZzZXQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBOdW1iZXIgb2YgcmVjb3JkcyB0byBza2lwLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggb2Zmc2V0LlxuICAgKi9cbiAgc3RhdGljIG9mZnNldCh2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkub2Zmc2V0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFnZS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7bnVtYmVyfSBwYWdlTnVtYmVyIC0gMS1iYXNlZCBwYWdlIG51bWJlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIHBhZ2UgYXBwbGllZC5cbiAgICovXG4gIHN0YXRpYyBwYWdlKHBhZ2VOdW1iZXIpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLnBhZ2UocGFnZU51bWJlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlciBwYWdlLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gTnVtYmVyIG9mIHJlY29yZHMgcGVyIHBhZ2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCBwYWdlIHNpemUuXG4gICAqL1xuICBzdGF0aWMgcGVyUGFnZSh2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkucGVyUGFnZSh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvdW50LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBOdW1iZXIgb2YgbG9hZGVkIG1vZGVsIGluc3RhbmNlcy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjb3VudCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmNvdW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGFzcy1sZXZlbCBob29rIGZpcmVkIHdoZW4gYW55IHJlY29yZCBvZiB0aGlzIG1vZGVsIGlzIGNyZWF0ZWQuXG4gICAqIFN1YnNjcmliZS10aW1lIGF1dGhvcml6YXRpb24gb25seSDigJQgb25jZSBhIHN1YnNjcmlwdGlvbiBpc1xuICAgKiBhY2NlcHRlZCwgZnV0dXJlIGBjcmVhdGVgIGV2ZW50cyBmb3IgdGhpcyBtb2RlbCBhcmUgZGVsaXZlcmVkXG4gICAqIHdpdGhvdXQgcmUtY2hlY2tpbmcgcGVyLXJlY29yZCB2aXNpYmlsaXR5LiBRdWVyeSBvcHRpb25zIGNhbiBzdGlsbFxuICAgKiBuYXJyb3cgd2hpY2ggZXZlbnRzIHJlYWNoIHRoaXMgY2FsbGJhY2suXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7aWQ6IEZyb250ZW5kTW9kZWxFdmVudFByaW1hcnlLZXlWYWx1ZUZvcjxJbnN0YW5jZVR5cGU8VD4+LCBtb2RlbDogSW5zdGFuY2VUeXBlPFQ+fSkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHJlY29yZCBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIG9uQ3JlYXRlKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHQsIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQodGhpcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24odGhpcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrLCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfVxuXG4gICAgcmV0dXJuIGF3YWl0IHN1Yi5yZWdpc3RlckNsYXNzQ2FsbGJhY2soc3ViLmNsYXNzQ3JlYXRlQ2FsbGJhY2tzLCBlbnRyeSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGFzcy1sZXZlbCBob29rIGZpcmVkIHdoZW4gYW55IHJlY29yZCBvZiB0aGlzIG1vZGVsIGlzIHVwZGF0ZWQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7aWQ6IEZyb250ZW5kTW9kZWxFdmVudFByaW1hcnlLZXlWYWx1ZUZvcjxJbnN0YW5jZVR5cGU8VD4+LCBtb2RlbDogSW5zdGFuY2VUeXBlPFQ+fSkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHJlY29yZCBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIG9uVXBkYXRlKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHQsIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQodGhpcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24odGhpcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrLCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfVxuXG4gICAgcmV0dXJuIGF3YWl0IHN1Yi5yZWdpc3RlckNsYXNzQ2FsbGJhY2soc3ViLmNsYXNzVXBkYXRlQ2FsbGJhY2tzLCBlbnRyeSlcbiAgfVxuXG4gIC8qKlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAb3ZlcmxvYWRcbiAgICogQHBhcmFtIHtUfSB0aGlzIC0gQ29uY3JldGUgZnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogRnJvbnRlbmRNb2RlbEV2ZW50UHJpbWFyeUtleVZhbHVlRm9yPEluc3RhbmNlVHlwZTxUPj59KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gQWNjZXB0ZWQgZm9yIEFQSSBzeW1tZXRyeTsgZGVzdHJveSBldmVudHMgY2FycnkgaWRzIG9ubHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgLyoqXG4gICAqIENsYXNzLWxldmVsIGhvb2sgZmlyZWQgd2hlbiBhbnkgcmVjb3JkIG9mIHRoaXMgbW9kZWwgaXMgZGVzdHJveWVkLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7aWQ6IG5ldmVyfSkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjayBlcmFzZWQgYXQgdGhlIG92ZXJsb2FkIGltcGxlbWVudGF0aW9uIGJvdW5kYXJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gQWNjZXB0ZWQgZm9yIEFQSSBzeW1tZXRyeTsgZGVzdHJveSBldmVudHMgY2FycnkgaWRzIG9ubHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIG9uRGVzdHJveShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3JlZ2lzdGVyRGVzdHJveUV2ZW50Q2FsbGJhY2soY2FsbGJhY2ssIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgZGVzdHJveSBjYWxsYmFjayBhZnRlciB0aGUgcHVibGljIG1vZGVsLXNwZWNpZmljIHNpZ25hdHVyZSBoYXMgYmVlbiBjaGVja2VkLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7aWQ6IG5ldmVyfSkgPT4gdm9pZH0gY2FsbGJhY2sgLSBUeXBlLWVyYXNlZCBldmVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIERlc3Ryb3kgZXZlbnQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgX3JlZ2lzdGVyRGVzdHJveUV2ZW50Q2FsbGJhY2soY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGFzc2VydE5vRGVzdHJveUV2ZW50RmlsdGVyKHRoaXMsIG9wdGlvbnMpXG5cbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQodGhpcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24odGhpcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnk8bmV2ZXI+fSAqL1xuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrfVxuXG4gICAgcmV0dXJuIGF3YWl0IHN1Yi5yZWdpc3RlckNsYXNzQ2FsbGJhY2soc3ViLmNsYXNzRGVzdHJveUNhbGxiYWNrcywgZW50cnkpXG4gIH1cblxuICAvKipcbiAgICogSW5zdGFuY2UtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIFRISVMgcmVjb3JkIGlzIHVwZGF0ZWQuIFRoZVxuICAgKiBpbnN0YW5jZSdzIGF0dHJpYnV0ZXMgYXJlIGF1dG8tbWVyZ2VkIHdpdGggdGhlIGJyb2FkY2FzdCBwYXlsb2FkXG4gICAqIGJlZm9yZSB0aGUgY2FsbGJhY2sgcnVucywgc28gY2FsbGVycyBjYW4gcmVhZCBmcmVzaCB2YWx1ZXMgdmlhXG4gICAqIGB0aGlzLnNvbWVBdHRyKClgIHdpdGhvdXQgcmUtZmV0Y2hpbmcuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogRXZlbnRQcmltYXJ5S2V5VmFsdWUsIG1vZGVsOiBGcm9udGVuZE1vZGVsQmFzZTxBdHRyaWJ1dGVzLCBDcmVhdGVBdHRyaWJ1dGVzLCBVcGRhdGVBdHRyaWJ1dGVzLCBQcmltYXJ5S2V5VmFsdWUsIEV2ZW50UHJpbWFyeUtleVZhbHVlPn0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciByZWNvcmQgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIGFzeW5jIG9uVXBkYXRlKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0LCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKE1vZGVsQ2xhc3MsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBpZGVudGl0eSA9IHRoaXMuaXNOZXdSZWNvcmQoKSA/IHRoaXMucHJpbWFyeUtleVZhbHVlKCkgOiB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgY29uc3QgaWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgaWRlbnRpdHkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2ssIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9XG4gICAgY29uc3QgbGlzdGVuZXIgPSBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGlkLCB0aGlzKVxuXG4gICAgbGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzLmFkZChlbnRyeSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzdWIuZW5zdXJlU3Vic2NyaWJlZCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCAoY3VycmVudCkgPT4gY3VycmVudC51cGRhdGVDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCAoY3VycmVudCkgPT4gY3VycmVudC51cGRhdGVDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSW5zdGFuY2UtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIFRISVMgcmVjb3JkIGlzIGRlc3Ryb3llZC5cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBFdmVudFByaW1hcnlLZXlWYWx1ZX0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBBY2NlcHRlZCBmb3IgQVBJIHN5bW1ldHJ5OyBkZXN0cm95IGV2ZW50cyBjYXJyeSBpZHMgb25seS5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBhc3luYyBvbkRlc3Ryb3koY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcblxuICAgIGFzc2VydE5vRGVzdHJveUV2ZW50RmlsdGVyKE1vZGVsQ2xhc3MsIG9wdGlvbnMpXG5cbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQoTW9kZWxDbGFzcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oTW9kZWxDbGFzcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGlkZW50aXR5ID0gdGhpcy5pc05ld1JlY29yZCgpID8gdGhpcy5wcmltYXJ5S2V5VmFsdWUoKSA6IHRoaXMucGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKClcbiAgICBjb25zdCBpZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBpZGVudGl0eSlcbiAgICBjb25zdCBlbnRyeSA9IHtjYWxsYmFja31cbiAgICBjb25zdCBsaXN0ZW5lciA9IGVuc3VyZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyKHN1YiwgaWQsIHRoaXMpXG5cbiAgICBsaXN0ZW5lci5kZXN0cm95Q2FsbGJhY2tzLmFkZChlbnRyeSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzdWIuZW5zdXJlU3Vic2NyaWJlZCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCAoY3VycmVudCkgPT4gY3VycmVudC5kZXN0cm95Q2FsbGJhY2tzLmRlbGV0ZShlbnRyeSkpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgKGN1cnJlbnQpID0+IGN1cnJlbnQuZGVzdHJveUNhbGxiYWNrcy5kZWxldGUoZW50cnkpKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBsdWNrLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHsuLi4oc3RyaW5nIHwgc3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+KX0gY29sdW1ucyAtIFBsdWNrIGRlZmluaXRpb24ocykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUGx1Y2tlZCB2YWx1ZXMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcGx1Y2soLi4uY29sdW1ucykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkucGx1Y2soLi4uY29sdW1ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlYXJjaC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbiAtIENvbHVtbiBvciBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtcImVxXCIgfCBcImxpa2VcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcIj5cIiB8IFwiPj1cIiB8IFwiPFwiIHwgXCI8PVwifSBvcGVyYXRvciAtIFNlYXJjaCBvcGVyYXRvci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTZWFyY2ggdmFsdWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlciB3aXRoIHNlYXJjaCBmaWx0ZXIuXG4gICAqL1xuICBzdGF0aWMgc2VhcmNoKHBhdGgsIGNvbHVtbiwgb3BlcmF0b3IsIHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5zZWFyY2gocGF0aCwgY29sdW1uLCBvcGVyYXRvciwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByYW5zYWNrLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJhbnNhY2stc3R5bGUgcGFyYW1zIGhhc2guXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlciB3aXRoIFJhbnNhY2sgZmlsdGVycyBhcHBsaWVkLlxuICAgKi9cbiAgc3RhdGljIHJhbnNhY2socGFyYW1zKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5yYW5zYWNrKHBhcmFtcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNvcnQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgc3RyaW5nW11bXSB8IFtzdHJpbmcsIHN0cmluZ10gfCBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHNvcnQgLSBTb3J0IGRlZmluaXRpb24ocykuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlciB3aXRoIHNvcnQgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgc29ydChzb3J0KSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5zb3J0KHNvcnQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvcmRlci5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBzdHJpbmdbXVtdIHwgW3N0cmluZywgc3RyaW5nXSB8IEFycmF5PFtzdHJpbmcsIHN0cmluZ10+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gc29ydCAtIFNvcnQgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggc29ydCBkZWZpbml0aW9ucy5cbiAgICovXG4gIHN0YXRpYyBvcmRlcihzb3J0KSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5vcmRlcihzb3J0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ3JvdXAuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gZ3JvdXAgLSBHcm91cCBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBncm91cCBkZWZpbml0aW9ucy5cbiAgICovXG4gIHN0YXRpYyBncm91cChncm91cCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuZ3JvdXAoZ3JvdXApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXN0aW5jdC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW3ZhbHVlXSAtIFdoZXRoZXIgdG8gcmVxdWVzdCBkaXN0aW5jdCByb3dzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBkaXN0aW5jdCBmbGFnLlxuICAgKi9cbiAgc3RhdGljIGRpc3RpbmN0KHZhbHVlID0gdHJ1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuZGlzdGluY3QodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlci5cbiAgICovXG4gIHN0YXRpYyBxdWVyeSgpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59ICovIChuZXcgRnJvbnRlbmRNb2RlbFF1ZXJ5KHttb2RlbENsYXNzOiB0aGlzfSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVsb2FkLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHByZWxvYWQgLSBQcmVsb2FkIGdyYXBoLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IHdpdGggcHJlbG9hZC5cbiAgICovXG4gIHN0YXRpYyBwcmVsb2FkKHByZWxvYWQpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59ICovICh0aGlzLnF1ZXJ5KCkucHJlbG9hZChwcmVsb2FkKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10gfCBzdHJpbmc+IHwgc3RyaW5nIHwgc3RyaW5nW119IHNlbGVjdCAtIE1vZGVsLWF3YXJlIGF0dHJpYnV0ZSBzZWxlY3QgbWFwIG9yIHJvb3QtbW9kZWwgc2hvcnRoYW5kLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IHdpdGggc2VsZWN0ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIHN0YXRpYyBzZWxlY3Qoc2VsZWN0KSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAodGhpcy5xdWVyeSgpLnNlbGVjdChzZWxlY3QpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VsZWN0cyBleHRyYS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10gfCBzdHJpbmc+IHwgc3RyaW5nIHwgc3RyaW5nW119IHNlbGVjdCAtIEV4dHJhIGF0dHJpYnV0ZXMgdG8gbG9hZCBpbiBhZGRpdGlvbiB0byB0aGUgZGVmYXVsdHMsIGtleWVkIGJ5IG1vZGVsIG5hbWUgb3Igcm9vdC1tb2RlbCBzaG9ydGhhbmQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgd2l0aCBleHRyYSBzZWxlY3RlZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgc3RhdGljIHNlbGVjdHNFeHRyYShzZWxlY3QpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59ICovICh0aGlzLnF1ZXJ5KCkuc2VsZWN0c0V4dHJhKHNlbGVjdCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaXJzdC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPiB8IG51bGw+fSAtIEZpcnN0IG1vZGVsIG9yIG51bGwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmlyc3QoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maXJzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsYXN0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+IHwgbnVsbD59IC0gTGFzdCBtb2RlbCBvciBudWxsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGxhc3QoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5sYXN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgaW5pdGlhbGl6ZSBieS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gQXR0cmlidXRlIG1hdGNoIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRXhpc3Rpbmcgb3IgaW5pdGlhbGl6ZWQgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZE9ySW5pdGlhbGl6ZUJ5KGNvbmRpdGlvbnMpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpbmRPckluaXRpYWxpemVCeShjb25kaXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvciBjcmVhdGUgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIEF0dHJpYnV0ZSBtYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcGFyYW0geyhtb2RlbDogSW5zdGFuY2VUeXBlPFQ+KSA9PiBQcm9taXNlPHZvaWQ+IHwgdm9pZH0gW2NhbGxiYWNrXSAtIE9wdGlvbmFsIGNhbGxiYWNrIGJlZm9yZSBzYXZlIHdoZW4gY3JlYXRlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+Pn0gLSBFeGlzdGluZyBvciBuZXdseSBjcmVhdGVkIG1vZGVsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRPckNyZWF0ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kT3JDcmVhdGVCeShjb25kaXRpb25zLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3NcbiAgICogQHRoaXMge01vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENyZWF0ZUF0dHJpYnV0ZXNGb3I8SW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+Pn0gW2F0dHJpYnV0ZXNdIC0gSW5pdGlhbCBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TW9kZWxDbGFzcz4+fSAtIFBlcnNpc3RlZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjcmVhdGUoYXR0cmlidXRlcykge1xuICAgIGNvbnN0IHJlY2VpdmVyID0gLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcylcbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtuZXcgKGF0dHJpYnV0ZXM/OiBGcm9udGVuZE1vZGVsQ3JlYXRlQXR0cmlidXRlc0ZvcjxJbnN0YW5jZVR5cGU8TW9kZWxDbGFzcz4+KSA9PiBJbnN0YW5jZVR5cGU8TW9kZWxDbGFzcz59ICovIChyZWNlaXZlcilcbiAgICBjb25zdCBtb2RlbCA9IG5ldyBNb2RlbENsYXNzKGF0dHJpYnV0ZXMpXG5cbiAgICBhd2FpdCBtb2RlbC5zYXZlKClcblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXNzZXJ0IGZpbmQgYnkgY29uZGl0aW9ucy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBmaW5kQnkgY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYXNzZXJ0RmluZEJ5Q29uZGl0aW9ucyhjb25kaXRpb25zKSB7XG4gICAgYXNzZXJ0RmluZEJ5Q29uZGl0aW9uc1NoYXBlKGNvbmRpdGlvbnMpXG5cbiAgICBPYmplY3Qua2V5cyhjb25kaXRpb25zKS5mb3JFYWNoKChrZXkpID0+IHtcbiAgICAgIGFzc2VydERlZmluZWRGaW5kQnlDb25kaXRpb25WYWx1ZShjb25kaXRpb25zW2tleV0sIGtleSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF0Y2hlcyBmaW5kIGJ5IGNvbmRpdGlvbnMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gQ2FuZGlkYXRlIG1vZGVsLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIE1hdGNoIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIG1vZGVsIG1hdGNoZXMgYWxsIGNvbmRpdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgbWF0Y2hlc0ZpbmRCeUNvbmRpdGlvbnMobW9kZWwsIGNvbmRpdGlvbnMpIHtcbiAgICBjb25zdCBtb2RlbEF0dHJpYnV0ZXMgPSBtb2RlbC5hdHRyaWJ1dGVzKClcblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGNvbmRpdGlvbnMpKSB7XG4gICAgICBjb25zdCBleHBlY3RlZFZhbHVlID0gY29uZGl0aW9uc1trZXldXG4gICAgICBjb25zdCBhY3R1YWxWYWx1ZSA9IG1vZGVsQXR0cmlidXRlc1trZXldXG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGV4cGVjdGVkVmFsdWUpKSB7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGFjdHVhbFZhbHVlKSkge1xuICAgICAgICAgIGlmICghdGhpcy5maW5kQnlDb25kaXRpb25WYWx1ZU1hdGNoZXMoYWN0dWFsVmFsdWUsIGV4cGVjdGVkVmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoIWV4cGVjdGVkVmFsdWUuc29tZSgoZW50cnkpID0+IHRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlLCBlbnRyeSkpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKSkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieSBjb25kaXRpb24gdmFsdWUgbWF0Y2hlcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYWN0dWFsVmFsdWUgLSBBY3R1YWwgbW9kZWwgdmFsdWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGV4cGVjdGVkVmFsdWUgLSBFeHBlY3RlZCBmaW5kIGNvbmRpdGlvbiB2YWx1ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZXMgbWF0Y2guXG4gICAqL1xuICBzdGF0aWMgZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKSB7XG4gICAgaWYgKGV4cGVjdGVkVmFsdWUgPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBhY3R1YWxWYWx1ZSA9PT0gbnVsbFxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGV4cGVjdGVkVmFsdWUpKSB7XG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkoYWN0dWFsVmFsdWUpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuXG4gICAgICBpZiAoYWN0dWFsVmFsdWUubGVuZ3RoICE9PSBleHBlY3RlZFZhbHVlLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGV4cGVjdGVkVmFsdWUubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgICAgIGlmICghdGhpcy5maW5kQnlDb25kaXRpb25WYWx1ZU1hdGNoZXMoYWN0dWFsVmFsdWVbaW5kZXhdLCBleHBlY3RlZFZhbHVlW2luZGV4XSkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGlmIChleHBlY3RlZFZhbHVlICYmIHR5cGVvZiBleHBlY3RlZFZhbHVlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBpZiAoIWFjdHVhbFZhbHVlIHx8IHR5cGVvZiBhY3R1YWxWYWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGFjdHVhbFZhbHVlKSkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgY29uc3QgYWN0dWFsT2JqZWN0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChhY3R1YWxWYWx1ZSlcbiAgICAgIGNvbnN0IGV4cGVjdGVkT2JqZWN0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChleHBlY3RlZFZhbHVlKVxuICAgICAgY29uc3QgYWN0dWFsS2V5cyA9IE9iamVjdC5rZXlzKGFjdHVhbE9iamVjdClcbiAgICAgIGNvbnN0IGV4cGVjdGVkS2V5cyA9IE9iamVjdC5rZXlzKGV4cGVjdGVkT2JqZWN0KVxuXG4gICAgICBpZiAoYWN0dWFsS2V5cy5sZW5ndGggIT09IGV4cGVjdGVkS2V5cy5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIGV4cGVjdGVkS2V5cykge1xuICAgICAgICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChhY3R1YWxPYmplY3QsIGtleSkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5maW5kQnlDb25kaXRpb25WYWx1ZU1hdGNoZXMoYWN0dWFsT2JqZWN0W2tleV0sIGV4cGVjdGVkT2JqZWN0W2tleV0pKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBpZiAoYWN0dWFsVmFsdWUgPT09IGV4cGVjdGVkVmFsdWUpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuZmluZEJ5UHJpbWl0aXZlVmFsdWVzTWF0Y2goYWN0dWFsVmFsdWUsIGV4cGVjdGVkVmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5IHByaW1pdGl2ZSB2YWx1ZXMgbWF0Y2guXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFjdHVhbFZhbHVlIC0gQWN0dWFsIG1vZGVsIHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBleHBlY3RlZFZhbHVlIC0gRXhwZWN0ZWQgZmluZCBjb25kaXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcHJpbWl0aXZlIHZhbHVlcyBtYXRjaCBhZnRlciBzYWZlIGNvZXJjaW9uLlxuICAgKi9cbiAgc3RhdGljIGZpbmRCeVByaW1pdGl2ZVZhbHVlc01hdGNoKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKSB7XG4gICAgaWYgKGFjdHVhbFZhbHVlIGluc3RhbmNlb2YgRGF0ZSAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEV4cGVjdGVkVmFsdWUgPSBub3JtYWxpemVEYXRlU3RyaW5nRm9yV3JpdGUoZXhwZWN0ZWRWYWx1ZSwge3RpbWVab25lOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKX0pXG5cbiAgICAgIGlmIChub3JtYWxpemVkRXhwZWN0ZWRWYWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgICAgcmV0dXJuIGFjdHVhbFZhbHVlLnRvSVNPU3RyaW5nKCkgPT09IG5vcm1hbGl6ZWRFeHBlY3RlZFZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGFjdHVhbFZhbHVlLnRvSVNPU3RyaW5nKCkgPT09IGV4cGVjdGVkVmFsdWVcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGFjdHVhbFZhbHVlID09PSBcInN0cmluZ1wiICYmIGV4cGVjdGVkVmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICByZXR1cm4gYWN0dWFsVmFsdWUgPT09IGV4cGVjdGVkVmFsdWUudG9JU09TdHJpbmcoKVxuICAgIH1cblxuICAgIGlmIChhY3R1YWxWYWx1ZSBpbnN0YW5jZW9mIERhdGUgJiYgZXhwZWN0ZWRWYWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgIHJldHVybiBhY3R1YWxWYWx1ZS50b0lTT1N0cmluZygpID09PSBleHBlY3RlZFZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGFjdHVhbFZhbHVlID09PSBcIm51bWJlclwiICYmIHR5cGVvZiBleHBlY3RlZFZhbHVlID09PSBcInN0cmluZ1wiKSB7XG4gICAgICByZXR1cm4gdGhpcy5maW5kQnlOdW1lcmljU3RyaW5nTWF0Y2hlc051bWJlcihleHBlY3RlZFZhbHVlLCBhY3R1YWxWYWx1ZSlcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGFjdHVhbFZhbHVlID09PSBcInN0cmluZ1wiICYmIHR5cGVvZiBleHBlY3RlZFZhbHVlID09PSBcIm51bWJlclwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5maW5kQnlOdW1lcmljU3RyaW5nTWF0Y2hlc051bWJlcihhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSlcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgbnVtZXJpYyBzdHJpbmcgbWF0Y2hlcyBudW1iZXIuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBudW1lcmljU3RyaW5nIC0gTnVtZXJpYyBzdHJpbmcgdmFsdWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBleHBlY3RlZE51bWJlciAtIE51bWJlciB2YWx1ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZXMgcmVwcmVzZW50IHRoZSBzYW1lIG51bWJlci5cbiAgICovXG4gIHN0YXRpYyBmaW5kQnlOdW1lcmljU3RyaW5nTWF0Y2hlc051bWJlcihudW1lcmljU3RyaW5nLCBleHBlY3RlZE51bWJlcikge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKGV4cGVjdGVkTnVtYmVyKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgaWYgKCEvXi0/XFxkKyg/OlxcLlxcZCspPyQvLnRlc3QobnVtZXJpY1N0cmluZykpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIHJldHVybiBOdW1iZXIobnVtZXJpY1N0cmluZykgPT09IGV4cGVjdGVkTnVtYmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUuXG4gICAqIEBwYXJhbSB7VXBkYXRlQXR0cmlidXRlc30gW25ld0F0dHJpYnV0ZXNdIC0gTmV3IHZhbHVlcyB0byBhc3NpZ24gYmVmb3JlIHVwZGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dGhpcz59IC0gVXBkYXRlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIHVwZGF0ZShuZXdBdHRyaWJ1dGVzKSB7XG4gICAgaWYgKG5ld0F0dHJpYnV0ZXMpIHRoaXMuYXNzaWduQXR0cmlidXRlcyhuZXdBdHRyaWJ1dGVzKVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7dGhpc30gKi8gKGF3YWl0IHRoaXMuc2F2ZSgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNoLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhdHRhY2htZW50SW5wdXQgLSBBdHRhY2htZW50IGlucHV0IG9yIG5hbWVkIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhdHRhY2hlZC5cbiAgICovXG4gIGFzeW5jIGF0dGFjaChhdHRhY2htZW50SW5wdXQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb25zID0gTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbnMoKVxuICAgIGNvbnN0IGF0dGFjaG1lbnROYW1lcyA9IE9iamVjdC5rZXlzKGF0dGFjaG1lbnREZWZpbml0aW9ucylcbiAgICBsZXQgYXR0YWNobWVudE5hbWUgPSBhdHRhY2htZW50TmFtZXNbMF1cbiAgICBsZXQgYWN0dWFsQXR0YWNobWVudElucHV0ID0gYXR0YWNobWVudElucHV0XG5cbiAgICBpZiAoZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KGF0dGFjaG1lbnRJbnB1dCkpIHtcbiAgICAgIGlmIChcImZpbGVcIiBpbiBhdHRhY2htZW50SW5wdXQgJiYgYXR0YWNobWVudERlZmluaXRpb25zLmZpbGUpIHtcbiAgICAgICAgYXR0YWNobWVudE5hbWUgPSBcImZpbGVcIlxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZU5hbWUgb2YgYXR0YWNobWVudE5hbWVzKSB7XG4gICAgICAgIGlmIChjYW5kaWRhdGVOYW1lIGluIGF0dGFjaG1lbnRJbnB1dCkge1xuICAgICAgICAgIGF0dGFjaG1lbnROYW1lID0gY2FuZGlkYXRlTmFtZVxuICAgICAgICAgIGFjdHVhbEF0dGFjaG1lbnRJbnB1dCA9IGF0dGFjaG1lbnRJbnB1dFtjYW5kaWRhdGVOYW1lXVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWF0dGFjaG1lbnROYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGF0dGFjaG1lbnQgZGVmaW5pdGlvbnMgb24gJHtNb2RlbENsYXNzLm5hbWV9YClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpLmF0dGFjaChhY3R1YWxBdHRhY2htZW50SW5wdXQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzYXZlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0aGlzPn0gLSBTYXZlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIHNhdmUoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGlzTmV3ID0gdGhpcy5pc05ld1JlY29yZCgpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcHJldmlvdXNJZGVudGl0eSA9IGlzTmV3ID8gbnVsbCA6IHRoaXMucGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKClcbiAgICBjb25zdCBsaXN0ZW5lcklkZW50aXR5QmVmb3JlU2F2ZSA9IGlzTmV3XG4gICAgICAmJiBBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpXG4gICAgICAmJiBwcmltYXJ5S2V5LmV2ZXJ5KChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuXG4gICAgICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiXG4gICAgICB9KVxuICAgICAgPyB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpXG4gICAgICA6IHByZXZpb3VzSWRlbnRpdHlcbiAgICBjb25zdCBjb21tYW5kVHlwZSA9IGlzTmV3ID8gXCJjcmVhdGVcIiA6IFwidXBkYXRlXCJcbiAgICAvKipcbiAgICAgKiBQYXlsb2FkLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGF0dHJpYnV0ZXM6IHRoaXMuX2NoYW5nZWRBdHRyaWJ1dGVzRm9yU2F2ZSgpXG4gICAgfVxuXG4gICAgaWYgKCFpc05ldykge1xuICAgICAgcGF5bG9hZC5pZCA9IHRoaXMucGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKClcbiAgICB9XG5cbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzID0gYXdhaXQgdGhpcy5fYnVpbGROZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZCgpXG5cbiAgICBpZiAobmVzdGVkQXR0cmlidXRlcyAmJiBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSB7XG4gICAgICBwYXlsb2FkLm5lc3RlZEF0dHJpYnV0ZXMgPSBuZXN0ZWRBdHRyaWJ1dGVzXG4gICAgfVxuXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSBhd2FpdCB0aGlzLl9idWlsZEF0dGFjaG1lbnRzUGF5bG9hZCgpXG5cbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDApIHtcbiAgICAgIHBheWxvYWQuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgIH1cblxuICAgIGlmIChzaG91bGRRdWV1ZUZyb250ZW5kTW9kZWxPcGVyYXRpb25PZmZsaW5lKE1vZGVsQ2xhc3MsIGNvbW1hbmRUeXBlKSkge1xuICAgICAgY29uc3Qgb2ZmbGluZUF0dHJpYnV0ZXMgPSB7Li4ucGF5bG9hZC5hdHRyaWJ1dGVzfVxuICAgICAgbGV0IGNsaWVudE11dGF0aW9uSWRcblxuICAgICAgaWYgKGlzTmV3KSB7XG4gICAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGBPZmZsaW5lIGNyZWF0ZSBmb3IgJHtNb2RlbENsYXNzLm5hbWV9YClcbiAgICAgICAgY29uc3QgY3VycmVudFByaW1hcnlLZXkgPSB0aGlzLnJlYWRBdHRyaWJ1dGUocHJpbWFyeUtleSlcblxuICAgICAgICBpZiAoY3VycmVudFByaW1hcnlLZXkgPT09IHVuZGVmaW5lZCB8fCBjdXJyZW50UHJpbWFyeUtleSA9PT0gbnVsbCkge1xuICAgICAgICAgIGNsaWVudE11dGF0aW9uSWQgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jPy5jbGllbnRNdXRhdGlvbklkXG4gICAgICAgICAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcub2ZmbGluZVN5bmMuY2xpZW50TXV0YXRpb25JZCgpXG4gICAgICAgICAgICA6IGZyb250ZW5kTW9kZWxPZmZsaW5lTXV0YXRpb25JZCgpXG4gICAgICAgICAgdGhpcy5zZXRBdHRyaWJ1dGUocHJpbWFyeUtleSwgY2xpZW50TXV0YXRpb25JZClcbiAgICAgICAgICBvZmZsaW5lQXR0cmlidXRlc1twcmltYXJ5S2V5XSA9IGNsaWVudE11dGF0aW9uSWRcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgcHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgYE9mZmxpbmUgdXBkYXRlIGZvciAke01vZGVsQ2xhc3MubmFtZX1gKVxuXG4gICAgICAgIG9mZmxpbmVBdHRyaWJ1dGVzW3ByaW1hcnlLZXldID0gcGF5bG9hZC5pZFxuICAgICAgfVxuXG4gICAgICBpZiAocGF5bG9hZC5uZXN0ZWRBdHRyaWJ1dGVzICE9PSB1bmRlZmluZWQgfHwgcGF5bG9hZC5hdHRhY2htZW50cyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgT2ZmbGluZSBzeW5jIGZvciAke01vZGVsQ2xhc3MubmFtZX0gZG9lcyBub3Qgc3VwcG9ydCBuZXN0ZWQgYXR0cmlidXRlcyBvciBhdHRhY2htZW50cyB5ZXRgKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBxdWV1ZUZyb250ZW5kTW9kZWxNdXRhdGlvbk9mZmxpbmUoe1xuICAgICAgICBhdHRyaWJ1dGVzOiBvZmZsaW5lQXR0cmlidXRlcyxcbiAgICAgICAgY2xpZW50TXV0YXRpb25JZCxcbiAgICAgICAgTW9kZWxDbGFzcyxcbiAgICAgICAgb3BlcmF0aW9uOiBjb21tYW5kVHlwZVxuICAgICAgfSlcbiAgICAgIHRoaXMuc2V0SXNOZXdSZWNvcmQoZmFsc2UpXG4gICAgICB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzID0gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyh0aGlzLmF0dHJpYnV0ZXMoKSlcbiAgICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICAgIHRoaXMuX2NsZWFyUGVuZGluZ0F0dGFjaG1lbnRzKClcblxuICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG5cbiAgICBjb25zdCByZW1vdmVUZW1wb3JhcnlMaXN0ZW5lckFsaWFzZXMgPSBwcmV2aW91c0lkZW50aXR5ID09PSBudWxsXG4gICAgICA/ICgpID0+IHt9XG4gICAgICA6IGFsaWFzRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKE1vZGVsQ2xhc3MsIHRoaXMsIHByZXZpb3VzSWRlbnRpdHksIHRoaXMucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgbGV0IHJlc3BvbnNlXG5cbiAgICB0cnkge1xuICAgICAgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKGNvbW1hbmRUeXBlLCBwYXlsb2FkKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZW1vdmVUZW1wb3JhcnlMaXN0ZW5lckFsaWFzZXMoKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZW1vdmVUZW1wb3JhcnlMaXN0ZW5lckFsaWFzZXMoKVxuXG4gICAgY29uc3QgbW9kZWxEYXRhID0gTW9kZWxDbGFzcy5tb2RlbERhdGFGcm9tUmVzcG9uc2UocmVzcG9uc2UpXG5cbiAgICB0aGlzLmFzc2lnbkF0dHJpYnV0ZXMobW9kZWxEYXRhLmF0dHJpYnV0ZXMpXG4gICAgdGhpcy5fYXR0YWNobWVudE93bmVyID0gbW9kZWxEYXRhLmF0dGFjaG1lbnRPd25lclxuICAgIHRoaXMuc2V0SXNOZXdSZWNvcmQoZmFsc2UpXG5cbiAgICBpZiAobGlzdGVuZXJJZGVudGl0eUJlZm9yZVNhdmUgIT09IG51bGwpIHtcbiAgICAgIHJla2V5RnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKE1vZGVsQ2xhc3MsIHRoaXMsIGxpc3RlbmVySWRlbnRpdHlCZWZvcmVTYXZlLCB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIH1cblxuICAgIHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXMgPSBjbG9uZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKHRoaXMuYXR0cmlidXRlcygpKVxuICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICB0aGlzLl9jbGVhclBlbmRpbmdBdHRhY2htZW50cygpXG5cbiAgICB0aGlzLl9yZWNvbmNpbGVOZXN0ZWRBdHRyaWJ1dGVzRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBzdWJzZXQgb2YgYF9hdHRyaWJ1dGVzYCB3aG9zZSB2YWx1ZSBoYXMgZGl2ZXJnZWQgZnJvbVxuICAgKiBgX3BlcnNpc3RlZEF0dHJpYnV0ZXNgLiBVc2VkIGJ5IGBzYXZlKClgIHNvIHRoZSBzZXJ2ZXIgcmVjZWl2ZXMgb25seSB0aGVcbiAgICogZmllbGRzIHRoZSBjYWxsZXIgYWN0dWFsbHkgY2hhbmdlZCDigJQgYXZvaWRpbmcgc3RyaWN0IHBlcm1pdCByZWplY3Rpb25zIG9uXG4gICAqIGZyYW1ld29yay1tYW5hZ2VkIGZpZWxkcyBsaWtlIGBpZGAsIGBjcmVhdGVkQXRgLCBgdXBkYXRlZEF0YCwgb3Igb3duZXJcbiAgICogZm9yZWlnbiBrZXlzIHRoYXQgdGhlIHJlc291cmNlIG5ldmVyIGxpc3RzIGluIGBwZXJtaXR0ZWRQYXJhbXNgLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gLSBDaGFuZ2VkIGF0dHJpYnV0ZXMgaGFzaC5cbiAgICovXG4gIF9jaGFuZ2VkQXR0cmlidXRlc0ZvclNhdmUoKSB7XG4gICAgLyoqXG4gICAgICogQ2hhbmdlZCBhdHRyaWJ1dGVzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqL1xuICAgIGNvbnN0IGNoYW5nZWRBdHRyaWJ1dGVzID0ge31cblxuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIFtwcmV2aW91c1ZhbHVlLCBjdXJyZW50VmFsdWVdXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmNoYW5nZXMoKSkpIHtcbiAgICAgIGlmICh0aGlzLmlzTmV3UmVjb3JkKCkgJiYgcHJldmlvdXNWYWx1ZSA9PT0gdW5kZWZpbmVkICYmIGN1cnJlbnRWYWx1ZSA9PT0gbnVsbCkgY29udGludWVcblxuICAgICAgY2hhbmdlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBjdXJyZW50VmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gY2hhbmdlZEF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXJrcyB0aGUgY3VycmVudCB2YWx1ZSBmb3IgYW4gYXR0cmlidXRlIGFzIGFscmVhZHkgcGVyc2lzdGVkIHNvIHRoZSBuZXh0XG4gICAqIHNhdmUgZG9lcyBub3Qgc2VuZCBpdCB1bmxlc3MgdGhlIGNhbGxlciBjaGFuZ2VzIGl0IGFnYWluLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSB0byBtYXJrIHVuY2hhbmdlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBtYXJrQXR0cmlidXRlVW5jaGFuZ2VkKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyh7dmFsdWU6IHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV19KS52YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVzdHJveS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZXN0cm95ZWQgb24gYmFja2VuZC5cbiAgICovXG4gIGFzeW5jIGRlc3Ryb3koKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGlkID0gdGhpcy5pc05ld1JlY29yZCgpID8gdGhpcy5wcmltYXJ5S2V5VmFsdWUoKSA6IHRoaXMucGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKClcblxuICAgIGlmIChzaG91bGRRdWV1ZUZyb250ZW5kTW9kZWxPcGVyYXRpb25PZmZsaW5lKE1vZGVsQ2xhc3MsIFwiZGVzdHJveVwiKSkge1xuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgYE9mZmxpbmUgZGVzdHJveSBmb3IgJHtNb2RlbENsYXNzLm5hbWV9YClcblxuICAgICAgYXdhaXQgcXVldWVGcm9udGVuZE1vZGVsTXV0YXRpb25PZmZsaW5lKHtcbiAgICAgICAgYXR0cmlidXRlczoge1twcmltYXJ5S2V5XTogaWR9LFxuICAgICAgICBNb2RlbENsYXNzLFxuICAgICAgICBvcGVyYXRpb246IFwiZGVzdHJveVwiXG4gICAgICB9KVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiZGVzdHJveVwiLCB7XG4gICAgICBpZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBhdHRhY2htZW50IHBheWxvYWQgcXVldWVkIG9uIHRoaXMgbW9kZWwgZm9yIHRoZSBuZXh0IHNhdmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IEF0dGFjaG1lbnQgcGF5bG9hZCBrZXllZCBieSBhdHRhY2htZW50IG5hbWUuXG4gICAqL1xuICBhc3luYyBfYnVpbGRBdHRhY2htZW50c1BheWxvYWQoKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcGF5bG9hZCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGF0dGFjaG1lbnROYW1lIG9mIE9iamVjdC5rZXlzKHRoaXMuX2F0dGFjaG1lbnRzKSkge1xuICAgICAgY29uc3QgYXR0YWNobWVudFBheWxvYWQgPSBhd2FpdCB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0ucGVuZGluZ0F0dGFjaG1lbnRzUGF5bG9hZCgpXG5cbiAgICAgIGlmIChhdHRhY2htZW50UGF5bG9hZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHBheWxvYWRbYXR0YWNobWVudE5hbWVdID0gYXR0YWNobWVudFBheWxvYWRcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqIENsZWFycyBxdWV1ZWQgYXR0YWNobWVudCBpbnB1dHMgYWZ0ZXIgYSBzdWNjZXNzZnVsIHNhdmUuICovXG4gIF9jbGVhclBlbmRpbmdBdHRhY2htZW50cygpIHtcbiAgICBmb3IgKGNvbnN0IGF0dGFjaG1lbnROYW1lIG9mIE9iamVjdC5rZXlzKHRoaXMuX2F0dGFjaG1lbnRzKSkge1xuICAgICAgdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdLmNsZWFyUGVuZGluZ0F0dGFjaG1lbnRzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogV2Fsa3MgcmVsYXRpb25zaGlwcyBkZWNsYXJlZCBpbiB0aGlzIHJlc291cmNlJ3MgYG5lc3RlZEF0dHJpYnV0ZXNgIGNvbmZpZ1xuICAgKiBhbmQgYnVpbGRzIHRoZSBwZXItcmVsYXRpb25zaGlwIHBheWxvYWQgb2YgZGlydHkgY2hpbGRyZW4gZm9yIGEgcGFyZW50IHNhdmUuXG4gICAqXG4gICAqIEluY2x1ZGVkIGNoaWxkcmVuOlxuICAgKiAgIC0gbmV3IHJlY29yZHMgKGlzTmV3UmVjb3JkKCkpIOKGkiBjcmVhdGUgZW50cnkgd2l0aCBhdHRyaWJ1dGVzXG4gICAqICAgLSByZWNvcmRzIG1hcmtlZCBmb3IgZGVzdHJ1Y3Rpb24gKG1hcmtlZEZvckRlc3RydWN0aW9uKCkpIOKGkiBkZXN0cm95IGVudHJ5XG4gICAqICAgLSByZWNvcmRzIHdpdGggY2hhbmdlZCBhdHRyaWJ1dGVzIChpc0NoYW5nZWQoKSkg4oaSIHVwZGF0ZSBlbnRyeSB3aXRoIGF0dHJpYnV0ZXNcbiAgICogICAtIHJlY29yZHMgd2l0aCBkaXJ0eSBkZXNjZW5kYW50cyBpbiB0aGVpciBvd24gbmVzdGVkQXR0cmlidXRlcyDihpIgcmVjdXJzZVxuICAgKlxuICAgKiBMb2FkZWQgYnV0IHVudG91Y2hlZCByZWNvcmRzIGFyZSBvbWl0dGVkIHNvIG5lc3RlZCBzYXZlIHByZXNlcnZlcyBSYWlscy1zdHlsZVxuICAgKiBcImNoaWxkcmVuIG5vdCByZWZlcmVuY2VkIGluIHBheWxvYWQgYXJlIGxlZnQgYWxvbmVcIiBzZW1hbnRpY3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+Pn0gLSBQZXItcmVsYXRpb25zaGlwIGxpc3Qgb2YgbmVzdGVkLWF0dHJpYnV0ZSBlbnRyaWVzLlxuICAgKi9cbiAgYXN5bmMgX2J1aWxkTmVzdGVkQXR0cmlidXRlc1BheWxvYWQoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gTW9kZWxDbGFzcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlc0NvbmZpZyA9IHJlc291cmNlQ29uZmlnPy5uZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICBpZiAoIW5lc3RlZEF0dHJpYnV0ZXNDb25maWcpIHJldHVybiB7fVxuXG4gICAgLyoqXG4gICAgICogUGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59ICovXG4gICAgY29uc3QgcGF5bG9hZCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlc0NvbmZpZykpIHtcbiAgICAgIC8qKiBAdHlwZSB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICAgIGNvbnN0IGVudHJpZXMgPSBbXVxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXAgJiYgQXJyYXkuaXNBcnJheShyZWxhdGlvbnNoaXAuX2xvYWRlZFZhbHVlKSkge1xuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHJlbGF0aW9uc2hpcC5fbG9hZGVkVmFsdWUpIHtcbiAgICAgICAgICBjb25zdCBjaGlsZEVudHJ5ID0gYXdhaXQgY2hpbGQuX25lc3RlZEF0dHJpYnV0ZXNFbnRyeUZvclBhcmVudFNhdmUoKVxuXG4gICAgICAgICAgaWYgKGNoaWxkRW50cnkpIGVudHJpZXMucHVzaChjaGlsZEVudHJ5KVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcCAmJiByZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIHtcbiAgICAgICAgY29uc3QgY2hpbGQgPSByZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsQmFzZSkge1xuICAgICAgICAgIGNvbnN0IGNoaWxkRW50cnkgPSBhd2FpdCBjaGlsZC5fbmVzdGVkQXR0cmlidXRlc0VudHJ5Rm9yUGFyZW50U2F2ZSgpXG5cbiAgICAgICAgICBpZiAoY2hpbGRFbnRyeSkgZW50cmllcy5wdXNoKGNoaWxkRW50cnkpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlcywgcmVsYXRpb25zaGlwTmFtZSkpIHtcbiAgICAgICAgZW50cmllcy5wdXNoKFxuICAgICAgICAgIC4uLmF3YWl0IHRoaXMuX25lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoXG4gICAgICAgICAgICBNb2RlbENsYXNzLFxuICAgICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzW3JlbGF0aW9uc2hpcE5hbWVdXG4gICAgICAgICAgKVxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIGlmIChlbnRyaWVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcGF5bG9hZFtyZWxhdGlvbnNoaXBOYW1lXSA9IGVudHJpZXNcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgcGF5bG9hZCBlbnRyeSBmb3IgdGhpcyBjaGlsZCB3aGVuIHdhbGtlZCBieSBhIHBhcmVudCdzXG4gICAqIGBfYnVpbGROZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZGAuIFJldHVybnMgYG51bGxgIHdoZW4gdGhlIGNoaWxkIGhhcyBub1xuICAgKiBkaXJ0eSBzdGF0ZSBhbmQgbm8gZGlydHkgZGVzY2VuZGFudHMsIHNvIHRoZSBwYXJlbnQgY2FuIG9taXQgaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSAtIE5lc3RlZC1hdHRyaWJ1dGUgZW50cnkgb3IgbnVsbCBpZiBjbGVhbi5cbiAgICovXG4gIGFzeW5jIF9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlGb3JQYXJlbnRTYXZlKCkge1xuICAgIGlmICh0aGlzLm1hcmtlZEZvckRlc3RydWN0aW9uKCkpIHtcbiAgICAgIGlmICh0aGlzLmlzTmV3UmVjb3JkKCkpIHJldHVybiBudWxsXG4gICAgICByZXR1cm4ge2lkOiB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpLCBfZGVzdHJveTogdHJ1ZX1cbiAgICB9XG5cbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzID0gYXdhaXQgdGhpcy5fYnVpbGROZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZCgpXG4gICAgY29uc3QgaGFzTmVzdGVkRGlydHkgPSBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzKS5sZW5ndGggPiAwXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSBhd2FpdCB0aGlzLl9idWlsZEF0dGFjaG1lbnRzUGF5bG9hZCgpXG4gICAgY29uc3QgaGFzQXR0YWNobWVudHMgPSBPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMFxuXG4gICAgaWYgKHRoaXMuaXNOZXdSZWNvcmQoKSkge1xuICAgICAgLyoqXG4gICAgICAgKiBFbnRyeS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCBlbnRyeSA9IHt9XG4gICAgICBjb25zdCBhdHRyaWJ1dGVzID0gdGhpcy5fY2hhbmdlZEF0dHJpYnV0ZXNGb3JTYXZlKClcblxuICAgICAgaWYgKE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIGVudHJ5LmF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzXG4gICAgICBpZiAoaGFzQXR0YWNobWVudHMpIGVudHJ5LmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICAgIGlmIChoYXNOZXN0ZWREaXJ0eSkgZW50cnkubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcblxuICAgICAgcmV0dXJuIGVudHJ5XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLmlzQ2hhbmdlZCgpICYmICFoYXNOZXN0ZWREaXJ0eSAmJiAhaGFzQXR0YWNobWVudHMpIHJldHVybiBudWxsXG5cbiAgICAvKipcbiAgICAgKiBFbnRyeS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGVudHJ5ID0ge2lkOiB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpfVxuXG4gICAgaWYgKHRoaXMuaXNDaGFuZ2VkKCkpIGVudHJ5LmF0dHJpYnV0ZXMgPSB0aGlzLl9jaGFuZ2VkQXR0cmlidXRlc0ZvclNhdmUoKVxuICAgIGlmIChoYXNBdHRhY2htZW50cykgZW50cnkuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgIGlmIChoYXNOZXN0ZWREaXJ0eSkgZW50cnkubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIHJldHVybiBlbnRyeVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBuZXN0ZWQgZW50cmllcyBmcm9tIGEgUmFpbHMtc3R5bGUgc3VibWl0dGVkIGAqQXR0cmlidXRlc2AgdmFsdWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gUGFyZW50IG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIE5lc3RlZCByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTdWJtaXR0ZWQgbmVzdGVkIGF0dHJpYnV0ZXMgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+fSBOZXN0ZWQgZW50cmllcyBmb3IgdGhlIHRyYW5zcG9ydCBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgX25lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoTW9kZWxDbGFzcywgcmVsYXRpb25zaGlwTmFtZSwgdmFsdWUpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBEZWZpbml0aW9uID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgY29uc3QgVGFyZ2V0TW9kZWxDbGFzcyA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXBEZWZpbml0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gbmVzdGVkIHJlbGF0aW9uc2hpcDogJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIVRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGNvbmZpZ3VyZWQgZm9yICR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAocmVsYXRpb25zaGlwVHlwZUlzQ29sbGVjdGlvbihyZWxhdGlvbnNoaXBEZWZpbml0aW9uLnR5cGUpKSB7XG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1BdHRyaWJ1dGVzIG11c3QgYmUgYW4gYXJyYXlgKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgIHZhbHVlLm1hcChhc3luYyAoZW50cnkpID0+IGF3YWl0IHRoaXMuX25lc3RlZEF0dHJpYnV0ZXNFbnRyeVBheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShUYXJnZXRNb2RlbENsYXNzLCBlbnRyeSkpXG4gICAgICApXG4gICAgfVxuXG4gICAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBbXVxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfUF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBvYmplY3RgKVxuICAgIH1cblxuICAgIHJldHVybiBbYXdhaXQgdGhpcy5fbmVzdGVkQXR0cmlidXRlc0VudHJ5UGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKFRhcmdldE1vZGVsQ2xhc3MsIHZhbHVlKV1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBvbmUgc3VibWl0dGVkIFJhaWxzLXN0eWxlIG5lc3RlZCBhdHRyaWJ1dGVzIG9iamVjdCBpbnRvIHRyYW5zcG9ydCBwYXlsb2FkIHNoYXBlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIE5lc3RlZCBjaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc3VibWl0dGVkRW50cnkgLSBTdWJtaXR0ZWQgbmVzdGVkIGF0dHJpYnV0ZXMgZW50cnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IFRyYW5zcG9ydCBuZXN0ZWQtYXR0cmlidXRlcyBlbnRyeS5cbiAgICovXG4gIGFzeW5jIF9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoTW9kZWxDbGFzcywgc3VibWl0dGVkRW50cnkpIHtcbiAgICBpZiAoIWZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChzdWJtaXR0ZWRFbnRyeSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtNb2RlbENsYXNzLm5hbWV9IG5lc3RlZCBhdHRyaWJ1dGVzIGVudHJpZXMgbXVzdCBiZSBvYmplY3RzYClcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBlbnRyeSA9IHt9XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHt9XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59ICovXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc3VibWl0dGVkRW50cnkpKSB7XG4gICAgICBpZiAoYXR0cmlidXRlTmFtZSA9PT0gXCJpZFwiIHx8IGF0dHJpYnV0ZU5hbWUgPT09IFwiX2Rlc3Ryb3lcIikge1xuICAgICAgICBlbnRyeVthdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5lc3RlZFJlbGF0aW9uc2hpcE5hbWUgPSBNb2RlbENsYXNzLm5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGlmIChuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgICAgIG5lc3RlZEF0dHJpYnV0ZXNbbmVzdGVkUmVsYXRpb25zaGlwTmFtZV0gPSBhd2FpdCB0aGlzLl9uZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKFxuICAgICAgICAgIE1vZGVsQ2xhc3MsXG4gICAgICAgICAgbmVzdGVkUmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICB2YWx1ZVxuICAgICAgICApXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICAgIGF0dGFjaG1lbnRzW2F0dHJpYnV0ZU5hbWVdID0gYXdhaXQgdGhpcy5fYXR0YWNobWVudFBheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShNb2RlbENsYXNzLCBhdHRyaWJ1dGVOYW1lLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIGVudHJ5LmF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwKSBlbnRyeS5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgaWYgKE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgPSBuZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICByZXR1cm4gZW50cnlcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGEgc3VibWl0dGVkIGF0dGFjaG1lbnQgdmFsdWUgZm9yIHRyYW5zcG9ydC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyBvd25pbmcgdGhlIGF0dGFjaG1lbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTdWJtaXR0ZWQgYXR0YWNobWVudCB2YWx1ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W10+fSBOb3JtYWxpemVkIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIF9hdHRhY2htZW50UGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKE1vZGVsQ2xhc3MsIGF0dGFjaG1lbnROYW1lLCB2YWx1ZSkge1xuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbihhdHRhY2htZW50TmFtZSlcblxuICAgIGlmIChhdHRhY2htZW50RGVmaW5pdGlvbj8udHlwZSA9PT0gXCJoYXNNYW55XCIpIHtcbiAgICAgIGNvbnN0IHZhbHVlcyA9IEFycmF5LmlzQXJyYXkodmFsdWUpID8gdmFsdWUgOiBbdmFsdWVdXG5cbiAgICAgIHJldHVybiBhd2FpdCBQcm9taXNlLmFsbCh2YWx1ZXMubWFwKGFzeW5jIChlbnRyeSkgPT4gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQoZW50cnkpKSlcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IGxhc3RWYWx1ZSA9IHZhbHVlW3ZhbHVlLmxlbmd0aCAtIDFdXG5cbiAgICAgIGlmIChsYXN0VmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7TW9kZWxDbGFzcy5uYW1lfSMke2F0dGFjaG1lbnROYW1lfSBhdHRhY2htZW50IGFycmF5IGNhbm5vdCBiZSBlbXB0eWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dChsYXN0VmFsdWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIEFmdGVyIGEgcGFyZW50IHNhdmUgd2l0aCBgbmVzdGVkQXR0cmlidXRlc2AsIHRoZSBzZXJ2ZXIgcmVzcG9uc2UgaW5jbHVkZXNcbiAgICogcHJlbG9hZGVkIHZlcnNpb25zIG9mIHRoZSBhZmZlY3RlZCByZWxhdGlvbnNoaXBzLiBUaGlzIHJlcGxhY2VzIHRoZSBsb2NhbFxuICAgKiBgX2xvYWRlZFZhbHVlYCBmb3IgZWFjaCBuZXN0ZWQtd3JpdGFibGUgcmVsYXRpb25zaGlwIHdpdGggdGhlIHNlcnZlcidzXG4gICAqIGF1dGhvcml0YXRpdmUgc2V0LCBzbyBkZXN0cm95ZWQgY2hpbGRyZW4gYXJlIGRyb3BwZWQgYW5kIG5ld2x5LWNyZWF0ZWRcbiAgICogY2hpbGRyZW4gZ2V0IHRoZWlyIHNlcnZlci1hc3NpZ25lZCBpZHMgKyBwZXJzaXN0ZWQgc3RhdGUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByZXNwb25zZSAtIENvbW1hbmQgcmVzcG9uc2UgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVjb25jaWxlTmVzdGVkQXR0cmlidXRlc0Zyb21SZXNwb25zZShyZXNwb25zZSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKVxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXNDb25maWcgPSByZXNvdXJjZUNvbmZpZz8ubmVzdGVkQXR0cmlidXRlc1xuXG4gICAgaWYgKCFuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnKSByZXR1cm5cblxuICAgIGNvbnN0IG1vZGVsRGF0YSA9IE1vZGVsQ2xhc3MubW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuICAgIGNvbnN0IHByZWxvYWRlZFJlbGF0aW9uc2hpcHMgPSBtb2RlbERhdGEucHJlbG9hZGVkUmVsYXRpb25zaGlwc1xuXG4gICAgLyoqXG4gICAgICogUmVsZXZhbnQgcHJlbG9hZHMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCByZWxldmFudFByZWxvYWRzID0ge31cblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnKSkge1xuICAgICAgaWYgKHJlbGF0aW9uc2hpcE5hbWUgaW4gcHJlbG9hZGVkUmVsYXRpb25zaGlwcykge1xuICAgICAgICByZWxldmFudFByZWxvYWRzW3JlbGF0aW9uc2hpcE5hbWVdID0gcHJlbG9hZGVkUmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhyZWxldmFudFByZWxvYWRzKS5sZW5ndGggPiAwKSB7XG4gICAgICBNb2RlbENsYXNzLmFwcGx5UHJlbG9hZGVkUmVsYXRpb25zaGlwcyh0aGlzLCByZWxldmFudFByZWxvYWRzKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUgY29tbWFuZC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGV9IGNvbW1hbmRUeXBlIC0gQ29tbWFuZCB0eXBlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGF5bG9hZCAtIENvbW1hbmQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBQYXJzZWQgSlNPTiByZXNwb25zZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBleGVjdXRlQ29tbWFuZChjb21tYW5kVHlwZSwgcGF5bG9hZCkge1xuICAgIGNvbnN0IGNvbW1hbmROYW1lID0gdGhpcy5jb21tYW5kTmFtZShjb21tYW5kVHlwZSlcbiAgICBjb25zdCB0aW1lWm9uZSA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpXG4gICAgY29uc3Qgc2VyaWFsaXplZFBheWxvYWQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShwYXlsb2FkLCB7dGltZVpvbmV9KSlcbiAgICBjb25zdCByZXF1ZXN0Q29udGV4dCA9IGZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCgpXG4gICAgY29uc3QgcmVxdWVzdFBheWxvYWQgPSBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCwgc2VyaWFsaXplZFBheWxvYWQpXG4gICAgY29uc3QgcmVzb3VyY2VQYXRoID0gdGhpcy5yZXNvdXJjZVBhdGgoKVxuICAgIGNvbnN0IGNvbnRhaW5zQXR0YWNobWVudFVwbG9hZCA9IGZyb250ZW5kTW9kZWxQYXlsb2FkQ29udGFpbnNBdHRhY2htZW50VXBsb2FkKHNlcmlhbGl6ZWRQYXlsb2FkKVxuICAgIGNvbnN0IHVzZVNoYXJlZFRyYW5zcG9ydCA9ICFjb250YWluc0F0dGFjaG1lbnRVcGxvYWRcbiAgICBjb25zdCB1cmwgPSB1c2VTaGFyZWRUcmFuc3BvcnQgPyBmcm9udGVuZE1vZGVsQXBpVXJsKCkgOiBmcm9udGVuZE1vZGVsQ29tbWFuZFVybChyZXNvdXJjZVBhdGggfHwgXCJcIiwgY29tbWFuZE5hbWUpXG5cbiAgICBpZiAodXNlU2hhcmVkVHJhbnNwb3J0KSB7XG4gICAgICBjb25zdCBiYXRjaFJlc3BvbnNlID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzLnB1c2goe1xuICAgICAgICAgIGNvbW1hbmROYW1lLFxuICAgICAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICAgICAgcGF5bG9hZDogc2VyaWFsaXplZFBheWxvYWQsXG4gICAgICAgICAgcmVxdWVzdENvbnRleHQsXG4gICAgICAgICAgcmVqZWN0LFxuICAgICAgICAgIHJlcXVlc3RJZDogYCR7KytzaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdElkfWAsXG4gICAgICAgICAgcmVzb2x2ZSxcbiAgICAgICAgICByZXNvdXJjZVBhdGhcbiAgICAgICAgfSlcblxuICAgICAgICBzY2hlZHVsZVNoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0Rmx1c2goKVxuICAgICAgfSlcblxuICAgICAgY29uc3QgZGVjb2RlZEJhdGNoUmVzcG9uc2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGJhdGNoUmVzcG9uc2UpXG5cbiAgICAgIHRoaXMudGhyb3dPbkVycm9yRnJvbnRlbmRNb2RlbFJlc3BvbnNlKHtcbiAgICAgICAgY29tbWFuZFR5cGUsXG4gICAgICAgIHJlc3BvbnNlOiBkZWNvZGVkQmF0Y2hSZXNwb25zZVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIGRlY29kZWRCYXRjaFJlc3BvbnNlXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRyYWNrRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3QoYXN5bmMgKCkgPT4gcnVuV2l0aFRyYW5zcG9ydERlYWRsaW5lKFxuICAgICAge1xuICAgICAgICBlcnJvck1lc3NhZ2U6IGAke3RoaXMubmFtZX0jJHtjb21tYW5kVHlwZX0gcmVxdWVzdCB0aW1lZCBvdXRgLFxuICAgICAgICBzaWduYWw6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSxcbiAgICAgICAgdGltZW91dE1zOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKClcbiAgICAgIH0sXG4gICAgICBhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICAgIGNvbnN0IGRpcmVjdFJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVxdWVzdFBheWxvYWQpLFxuICAgICAgICAgIGNyZWRlbnRpYWxzOiBcImluY2x1ZGVcIixcbiAgICAgICAgICBoZWFkZXJzOiBmcm9udGVuZE1vZGVsUmVxdWVzdEhlYWRlcnModGltZVpvbmUpLFxuICAgICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgICAgc2lnbmFsXG4gICAgICAgIH0pXG5cbiAgICAgICAgY29uc3QgZGlyZWN0UmVzcG9uc2VUZXh0ID0gYXdhaXQgZGlyZWN0UmVzcG9uc2UudGV4dCgpXG5cbiAgICAgICAgaWYgKCFkaXJlY3RSZXNwb25zZS5vaykge1xuICAgICAgICAgIHRocm93RnJvbnRlbmRNb2RlbEh0dHBFcnJvcih7XG4gICAgICAgICAgICBjb21tYW5kTGFiZWw6IGAke3RoaXMubmFtZX0jJHtjb21tYW5kVHlwZX1gLFxuICAgICAgICAgICAgcmVzcG9uc2U6IGRpcmVjdFJlc3BvbnNlLFxuICAgICAgICAgICAgcmVzcG9uc2VUZXh0OiBkaXJlY3RSZXNwb25zZVRleHRcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZGlyZWN0SnNvbiA9IGRpcmVjdFJlc3BvbnNlVGV4dC5sZW5ndGggPiAwID8gSlNPTi5wYXJzZShkaXJlY3RSZXNwb25zZVRleHQpIDoge31cbiAgICAgICAgY29uc3QgZGVjb2RlZERpcmVjdFJlc3BvbnNlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShkaXJlY3RKc29uKSlcblxuICAgICAgICB0aGlzLnRocm93T25FcnJvckZyb250ZW5kTW9kZWxSZXNwb25zZSh7XG4gICAgICAgICAgY29tbWFuZFR5cGUsXG4gICAgICAgICAgcmVzcG9uc2U6IGRlY29kZWREaXJlY3RSZXNwb25zZVxuICAgICAgICB9KVxuXG4gICAgICAgIHJldHVybiBkZWNvZGVkRGlyZWN0UmVzcG9uc2VcbiAgICAgIH1cbiAgICApKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZSBjdXN0b20gY29tbWFuZC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHt7Y29tbWFuZE5hbWU6IHN0cmluZywgY29tbWFuZFR5cGU6IEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29tbWFuZFR5cGUsIG1lbWJlcklkPzogc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCwgcGF5bG9hZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCByZXNvdXJjZVBhdGg6IHN0cmluZ319IGFyZ3MgLSBDb21tYW5kIGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPj59IC0gRGVjb2RlZCByZXNwb25zZSBwYXlsb2FkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGV4ZWN1dGVDdXN0b21Db21tYW5kKGFyZ3MpIHtcbiAgICBjb25zdCB7Y29tbWFuZE5hbWUsIGNvbW1hbmRUeXBlLCBtZW1iZXJJZCA9IG51bGwsIHBheWxvYWQsIHJlc291cmNlUGF0aH0gPSBhcmdzXG4gICAgY29uc3QgdGltZVpvbmUgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKVxuICAgIGNvbnN0IHNlcmlhbGl6ZWRQYXlsb2FkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocGF5bG9hZCwge3RpbWVab25lfSkpXG4gICAgY29uc3QgcmVxdWVzdENvbnRleHQgPSBmcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoKVxuXG4gICAgbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQsIHNlcmlhbGl6ZWRQYXlsb2FkKVxuICAgIGNvbnN0IGN1c3RvbVBhdGggPSBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZFBhdGgoe1xuICAgICAgY29tbWFuZE5hbWUsXG4gICAgICBtZW1iZXJJZCxcbiAgICAgIG1vZGVsTmFtZTogdGhpcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgIHJlc291cmNlUGF0aFxuICAgIH0pXG5cbiAgICBjb25zdCBiYXRjaFJlc3BvbnNlID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cy5wdXNoKHtcbiAgICAgICAgY29tbWFuZFR5cGUsXG4gICAgICAgIGN1c3RvbVBhdGgsXG4gICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICAgIHBheWxvYWQ6IHNlcmlhbGl6ZWRQYXlsb2FkLFxuICAgICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgICAgcmVqZWN0LFxuICAgICAgICByZXF1ZXN0SWQ6IGAkeysrc2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RJZH1gLFxuICAgICAgICByZXNvbHZlXG4gICAgICB9KVxuXG4gICAgICBzY2hlZHVsZVNoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0Rmx1c2goKVxuICAgIH0pXG5cbiAgICBjb25zdCBkZWNvZGVkQmF0Y2hSZXNwb25zZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKGJhdGNoUmVzcG9uc2UpXG5cbiAgICB0aGlzLnRocm93T25FcnJvckZyb250ZW5kTW9kZWxSZXNwb25zZSh7XG4gICAgICBjb21tYW5kVHlwZSxcbiAgICAgIHJlc3BvbnNlOiBkZWNvZGVkQmF0Y2hSZXNwb25zZVxuICAgIH0pXG5cbiAgICByZXR1cm4gZGVjb2RlZEJhdGNoUmVzcG9uc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRocm93IG9uIGVycm9yIGZyb250ZW5kIG1vZGVsIHJlc3BvbnNlLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3tjb21tYW5kVHlwZTogRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSwgcmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHRocm93T25FcnJvckZyb250ZW5kTW9kZWxSZXNwb25zZShhcmdzKSB7XG4gICAgY29uc3Qge2NvbW1hbmRUeXBlLCByZXNwb25zZX0gPSBhcmdzXG4gICAgaWYgKHJlc3BvbnNlPy5zdGF0dXMgIT09IFwiZXJyb3JcIikgcmV0dXJuXG5cbiAgICBjb25zdCByZXNwb25zZUtleXMgPSBPYmplY3Qua2V5cyhyZXNwb25zZSlcbiAgICBjb25zdCBoYXNPbmx5U3RhdHVzID0gcmVzcG9uc2VLZXlzLmxlbmd0aCA9PT0gMSAmJiByZXNwb25zZUtleXNbMF0gPT09IFwic3RhdHVzXCJcbiAgICBjb25zdCBoYXNFcnJvck1lc3NhZ2UgPSB0eXBlb2YgcmVzcG9uc2UuZXJyb3JNZXNzYWdlID09PSBcInN0cmluZ1wiICYmIHJlc3BvbnNlLmVycm9yTWVzc2FnZS5sZW5ndGggPiAwXG4gICAgY29uc3QgaGFzRXJyb3JFbnZlbG9wZUtleXMgPSBCb29sZWFuKFxuICAgICAgcmVzcG9uc2UuY29kZSAhPT0gdW5kZWZpbmVkXG4gICAgICB8fCByZXNwb25zZS5lcnJvciAhPT0gdW5kZWZpbmVkXG4gICAgICB8fCByZXNwb25zZS5lcnJvcnMgIT09IHVuZGVmaW5lZFxuICAgICAgfHwgcmVzcG9uc2UubWVzc2FnZSAhPT0gdW5kZWZpbmVkXG4gICAgKVxuICAgIGNvbnN0IG5vblN0YXR1c0tleXMgPSByZXNwb25zZUtleXMuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJzdGF0dXNcIilcbiAgICBjb25zdCBjb25maWd1cmVkQXR0cmlidXRlTmFtZXMgPSB0aGlzLmNvbmZpZ3VyZWRGcm9udGVuZE1vZGVsQXR0cmlidXRlTmFtZXMoKVxuICAgIGNvbnN0IGxvb2tzTGlrZVJhd01vZGVsUGF5bG9hZCA9IG5vblN0YXR1c0tleXMubGVuZ3RoID4gMFxuICAgICAgJiYgbm9uU3RhdHVzS2V5cy5ldmVyeSgoa2V5KSA9PiBjb25maWd1cmVkQXR0cmlidXRlTmFtZXMuaGFzKGtleSkpXG5cbiAgICBpZiAoIWhhc0Vycm9yTWVzc2FnZSAmJiAhaGFzT25seVN0YXR1cyAmJiAhaGFzRXJyb3JFbnZlbG9wZUtleXMgJiYgbG9va3NMaWtlUmF3TW9kZWxQYXlsb2FkKSByZXR1cm5cblxuICAgIGNvbnN0IGRlYnVnRXJyb3JNZXNzYWdlID0gdHlwZW9mIHJlc3BvbnNlLmRlYnVnRXJyb3JNZXNzYWdlID09PSBcInN0cmluZ1wiICYmIHJlc3BvbnNlLmRlYnVnRXJyb3JNZXNzYWdlLmxlbmd0aCA+IDBcbiAgICAgID8gcmVzcG9uc2UuZGVidWdFcnJvck1lc3NhZ2VcbiAgICAgIDogbnVsbFxuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGRlYnVnRXJyb3JNZXNzYWdlIHx8IChoYXNFcnJvck1lc3NhZ2VcbiAgICAgID8gcmVzcG9uc2UuZXJyb3JNZXNzYWdlXG4gICAgICA6IGBSZXF1ZXN0IGZhaWxlZCBmb3IgJHt0aGlzLm5hbWV9IyR7Y29tbWFuZFR5cGV9YClcblxuICAgIGNvbnN0IGVycm9yID0gLyoqIEB0eXBlIHtFcnJvciAmIHtjb3JyZWxhdGlvbklkPzogc3RyaW5nLCBkZXRhaWxzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBlcnJvck1lc3NhZ2U/OiBzdHJpbmcsIHZlbG9jaW91cz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXJyb3JUeXBlPzogc3RyaW5nLCB2YWxpZGF0aW9uRXJyb3JzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBkZWJ1Z0Vycm9yQ2xhc3M/OiBzdHJpbmcsIGRlYnVnQmFja3RyYWNlPzogc3RyaW5nW119fSAqLyAobmV3IEVycm9yKGVycm9yTWVzc2FnZSkpXG4gICAgaWYgKGhhc0Vycm9yTWVzc2FnZSkge1xuICAgICAgZXJyb3IuZXJyb3JNZXNzYWdlID0gcmVzcG9uc2UuZXJyb3JNZXNzYWdlXG4gICAgfVxuICAgIGlmIChyZXNwb25zZS52ZWxvY2lvdXMgJiYgdHlwZW9mIHJlc3BvbnNlLnZlbG9jaW91cyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgZXJyb3IudmVsb2Npb3VzID0gcmVzcG9uc2UudmVsb2Npb3VzXG4gICAgfVxuICAgIGlmICh0eXBlb2YgcmVzcG9uc2UuZXJyb3JUeXBlID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBlcnJvci5lcnJvclR5cGUgPSByZXNwb25zZS5lcnJvclR5cGVcbiAgICB9XG4gICAgaWYgKHJlc3BvbnNlLnZhbGlkYXRpb25FcnJvcnMgJiYgdHlwZW9mIHJlc3BvbnNlLnZhbGlkYXRpb25FcnJvcnMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGVycm9yLnZhbGlkYXRpb25FcnJvcnMgPSByZXNwb25zZS52YWxpZGF0aW9uRXJyb3JzXG4gICAgfVxuICAgIGlmIChyZXNwb25zZS5kZXRhaWxzICYmIHR5cGVvZiByZXNwb25zZS5kZXRhaWxzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBlcnJvci5kZXRhaWxzID0gcmVzcG9uc2UuZGV0YWlsc1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHJlc3BvbnNlLmNvcnJlbGF0aW9uSWQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGVycm9yLmNvcnJlbGF0aW9uSWQgPSByZXNwb25zZS5jb3JyZWxhdGlvbklkXG4gICAgfVxuICAgIC8vIEZvcndhcmQgc2VydmVyLXByb3ZpZGVkIGRlYnVnIGRldGFpbCAoaW5jbHVkZWQgb25seSB3aGVuIHRoZSBiYWNrZW5kXG4gICAgLy8gZGVlbXMgdGhlIHJlcXVlc3RlciBhbGxvd2VkIHRvIHNlZSBpdCwgZS5nLiBhbiBhZG1pbikgc28gY2FsbGVycyBjYW5cbiAgICAvLyByZW5kZXIgdGhlIHJlYWwgZXJyb3IgY2xhc3MgYW5kIHN0YWNrIHRyYWNlIGluc3RlYWQgb2YgdGhlIGdlbmVyaWNcbiAgICAvLyBjbGllbnQtc2FmZSBtZXNzYWdlLlxuICAgIGlmICh0eXBlb2YgcmVzcG9uc2UuZGVidWdFcnJvckNsYXNzID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBlcnJvci5kZWJ1Z0Vycm9yQ2xhc3MgPSByZXNwb25zZS5kZWJ1Z0Vycm9yQ2xhc3NcbiAgICB9XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocmVzcG9uc2UuZGVidWdCYWNrdHJhY2UpKSB7XG4gICAgICBlcnJvci5kZWJ1Z0JhY2t0cmFjZSA9IHJlc3BvbnNlLmRlYnVnQmFja3RyYWNlXG4gICAgfVxuICAgIHRocm93IGVycm9yXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25maWd1cmVkIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIENvbmZpZ3VyZWQgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIG5hbWVzLlxuICAgKi9cbiAgc3RhdGljIGNvbmZpZ3VyZWRGcm9udGVuZE1vZGVsQXR0cmlidXRlTmFtZXMoKSB7XG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHRoaXMucmVzb3VyY2VDb25maWcoKSlcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gcmVzb3VyY2VDb25maWcuYXR0cmlidXRlc1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgIHJldHVybiBuZXcgU2V0KGF0dHJpYnV0ZXMuZmlsdGVyKChhdHRyaWJ1dGVOYW1lKSA9PiB0eXBlb2YgYXR0cmlidXRlTmFtZSA9PT0gXCJzdHJpbmdcIikpXG4gICAgfVxuXG4gICAgaWYgKGF0dHJpYnV0ZXMgJiYgdHlwZW9mIGF0dHJpYnV0ZXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVybiBuZXcgU2V0KE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpKVxuICAgIH1cblxuICAgIHJldHVybiBuZXcgU2V0KClcbiAgfVxufVxuXG4vKiogUHVibGljIGZyb250ZW5kIG1vZGVsIGZvciBzYWZlIFZlbG9jaW91cyBhdHRhY2htZW50IG1ldGFkYXRhLiAqL1xuZXhwb3J0IGNsYXNzIFZlbG9jaW91c0F0dGFjaG1lbnQgZXh0ZW5kcyBGcm9udGVuZE1vZGVsQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIGNvbmZpZy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ30gLSBSZXNvdXJjZSBjb25maWcuXG4gICAqL1xuICBzdGF0aWMgcmVzb3VyY2VDb25maWcoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgYnl0ZVNpemU6IHt0eXBlOiBcImludGVnZXJcIn0sXG4gICAgICAgIGNvbnRlbnRUeXBlOiB7bnVsbDogdHJ1ZSwgdHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgICAgICBjcmVhdGVkQXQ6IHt0eXBlOiBcImRhdGV0aW1lXCJ9LFxuICAgICAgICBmaWxlbmFtZToge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICAgICAgaWQ6IHt0eXBlOiBcInV1aWRcIn0sXG4gICAgICAgIG5hbWU6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgICAgIHBvc2l0aW9uOiB7dHlwZTogXCJpbnRlZ2VyXCJ9LFxuICAgICAgICByZWNvcmRJZDoge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICAgICAgcmVjb3JkVHlwZToge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICAgICAgdXBkYXRlZEF0OiB7dHlwZTogXCJkYXRldGltZVwifVxuICAgICAgfSxcbiAgICAgIGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHM6IFtcImluZGV4XCJdLFxuICAgICAgYnVpbHRJbk1lbWJlckNvbW1hbmRzOiBbXCJmaW5kXCJdLFxuICAgICAgbW9kZWxOYW1lOiBcIlZlbG9jaW91c0F0dGFjaG1lbnRcIixcbiAgICAgIHByaW1hcnlLZXk6IFwiaWRcIlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhdHRhY2htZW50IG1ldGFkYXRhIGJ5IGl0cyBwdWJsaWMgaWQgdGhyb3VnaCB0aGUgbWVtYmVyIGF1dGhvcml6YXRpb24gcGF0aC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gQXR0YWNobWVudCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+Pn0gLSBSZXNvbHZlZCBhdHRhY2htZW50IG1ldGFkYXRhLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmQoaWQpIHtcbiAgICByZXR1cm4gdGhpcy5pbnN0YW50aWF0ZUZyb21SZXNwb25zZShhd2FpdCB0aGlzLmV4ZWN1dGVDb21tYW5kKFwiZmluZFwiLCB7aWR9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IGlkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgaWQuXG4gICAqL1xuICBpZCgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImlkXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgb3duZXIgbW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBPd25lciBtb2RlbCBuYW1lLlxuICAgKi9cbiAgcmVjb3JkVHlwZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcInJlY29yZFR5cGVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBvd25lciByZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gT3duZXIgcmVjb3JkIGlkLlxuICAgKi9cbiAgcmVjb3JkSWQoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJyZWNvcmRJZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgbmFtZSBvbiB0aGUgb3duZXIgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0YWNobWVudCBuYW1lIG9uIHRoZSBvd25lciBtb2RlbC5cbiAgICovXG4gIG5hbWUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJuYW1lXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBwb3NpdGlvbi5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBBdHRhY2htZW50IHBvc2l0aW9uLlxuICAgKi9cbiAgcG9zaXRpb24oKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJwb3NpdGlvblwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgZmlsZW5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0YWNobWVudCBmaWxlbmFtZS5cbiAgICovXG4gIGZpbGVuYW1lKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwiZmlsZW5hbWVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IGNvbnRlbnQgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gQXR0YWNobWVudCBjb250ZW50IHR5cGUuXG4gICAqL1xuICBjb250ZW50VHlwZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImNvbnRlbnRUeXBlXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBieXRlIHNpemUuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQXR0YWNobWVudCBieXRlIHNpemUuXG4gICAqL1xuICBieXRlU2l6ZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImJ5dGVTaXplXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY3JlYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtEYXRlfSAtIENyZWF0ZWQtYXQgdGltZXN0YW1wLlxuICAgKi9cbiAgY3JlYXRlZEF0KCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwiY3JlYXRlZEF0XCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgdXBkYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtEYXRlfSAtIFVwZGF0ZWQtYXQgdGltZXN0YW1wLlxuICAgKi9cbiAgdXBkYXRlZEF0KCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwidXBkYXRlZEF0XCIpIH1cbn1cblxuRnJvbnRlbmRNb2RlbEJhc2UucmVnaXN0ZXJNb2RlbChWZWxvY2lvdXNBdHRhY2htZW50KVxuIl19