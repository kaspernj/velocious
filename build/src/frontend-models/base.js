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
 * Lifecycle event identity exposed by a concrete frontend model.
 * @template {FrontendModelBase} T
 * @typedef {T extends FrontendModelBase<any, any, any, any, infer EventPrimaryKeyValue> ? EventPrimaryKeyValue : import("../utils/model-primary-key.js").ModelPrimaryKeyValue} FrontendModelEventPrimaryKeyValueFor
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
     * @overload
     * @param {(payload: {id: string}) => void} callback - Scalar event callback.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbHMvYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxPQUFPLE1BQU0sMkJBQTJCLENBQUE7QUFDL0MsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxrQkFBa0IsRUFBRSxFQUFDLGdDQUFnQyxFQUFDLE1BQU0sWUFBWSxDQUFBO0FBQy9FLE9BQU8sc0JBQXNCLE1BQU0sZ0JBQWdCLENBQUE7QUFDbkQsT0FBTyxFQUFDLDJCQUEyQixFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0UsT0FBTyxFQUFDLHFCQUFxQixFQUFFLHlCQUF5QixFQUFDLE1BQU0scUJBQXFCLENBQUE7QUFDcEYsT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGlDQUFpQyxFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0gsT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDekgsT0FBTyx3QkFBd0IsTUFBTSx5QkFBeUIsQ0FBQTtBQUM5RCxPQUFPLEVBQUMsd0JBQXdCLEVBQUUsZ0JBQWdCLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUMxRSxPQUFPLHdCQUF3QixNQUFNLG9DQUFvQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyx1QkFBdUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ3BFLE9BQU8sRUFBQyx3Q0FBd0MsRUFBRSxzQ0FBc0MsRUFBQyxNQUFNLDZCQUE2QixDQUFBO0FBQzVILE9BQU8sRUFBQyxtQkFBbUIsRUFBRSwyQkFBMkIsRUFBRSwyQkFBMkIsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ3hILE9BQU8sRUFBQyxnQkFBZ0IsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQ3hELE9BQU8sYUFBYSxNQUFN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SUFDSCxTQUFTLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUV0RDs7O09BR0c7SUFDSCxTQUFTLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFBLENBQUMsQ0FBQztDQUN2RDtBQUVELGlCQUFpQixDQUFDLGFBQWEsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHRpbWVvdXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3RpbWVvdXQuanNcIlxuaW1wb3J0IHdhaXQgZnJvbSBcImF3YWl0ZXJ5L2J1aWxkL3dhaXQuanNcIlxuaW1wb3J0IEZyb250ZW5kTW9kZWxRdWVyeSwge2Zyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkfSBmcm9tIFwiLi9xdWVyeS5qc1wiXG5pbXBvcnQgRnJvbnRlbmRNb2RlbFByZWxvYWRlciBmcm9tIFwiLi9wcmVsb2FkZXIuanNcIlxuaW1wb3J0IHtub3JtYWxpemVEYXRlU3RyaW5nRm9yV3JpdGV9IGZyb20gXCIuLi9kYXRhYmFzZS9kYXRldGltZS1zdG9yYWdlLmpzXCJcbmltcG9ydCB7cmVnaXN0ZXJGcm9udGVuZE1vZGVsLCByZXNvbHZlRnJvbnRlbmRNb2RlbENsYXNzfSBmcm9tIFwiLi9tb2RlbC1yZWdpc3RyeS5qc1wiXG5pbXBvcnQge3ZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWUsIHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aH0gZnJvbSBcIi4vcmVzb3VyY2UtY29uZmlnLXZhbGlkYXRpb24uanNcIlxuaW1wb3J0IHtkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSwgc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBmcm9tIFwiLi90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiXG5pbXBvcnQgcnVuV2l0aFRyYW5zcG9ydERlYWRsaW5lIGZyb20gXCIuL3RyYW5zcG9ydC1kZWFkbGluZS5qc1wiXG5pbXBvcnQge1JFUVVFU1RfVElNRV9aT05FX0hFQURFUiwgdmFsaWRhdGVUaW1lWm9uZX0gZnJvbSBcIi4uL3RpbWUtem9uZS5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50IGZyb20gXCIuLi9odHRwLWNsaWVudC93ZWJzb2NrZXQtY2xpZW50LmpzXCJcbmltcG9ydCB7cmVtb3RlUmVxdWVzdENvbnRleHRLZXl9IGZyb20gXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCJcbmltcG9ydCB7Y2FwdHVyZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dCwgbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHR9IGZyb20gXCIuL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuaW1wb3J0IHtidWZmZXJPdXRnb2luZ0V2ZW50LCBjbGVhckJ1ZmZlcmVkT3V0Z29pbmdFdmVudHMsIGRyYWluQnVmZmVyZWRPdXRnb2luZ0V2ZW50c30gZnJvbSBcIi4vb3V0Z29pbmctZXZlbnQtYnVmZmVyLmpzXCJcbmltcG9ydCB7ZGVmaW5lTW9kZWxTY29wZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCJcbmltcG9ydCBpc1BsYWluT2JqZWN0IGZyb20gXCIuLi91dGlscy9wbGFpbi1vYmplY3QuanNcIlxuaW1wb3J0IHtmb3JjZWROb25CbGFua1N0cmluZ30gZnJvbSBcInR5cGFuaWNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDYWNoZUtleSwgbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucywgcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlLCBzY2FsYXJNb2RlbFByaW1hcnlLZXksIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuaW1wb3J0IHtyZWFkUGF5bG9hZEFzc29jaWF0aW9uQ291bnQsIHJlYWRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5LCByZWFkUGF5bG9hZFF1ZXJ5RGF0YSwgc2V0UGF5bG9hZEFzc29jaWF0aW9uQ291bnQsIHNldFBheWxvYWRDb21wdXRlZEFiaWxpdHksIHNldFBheWxvYWRRdWVyeURhdGF9IGZyb20gXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIlxuXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIHJlbGF0aW9uc2hpcCBoZWxwZXIgdHlwZS4gUmV0dXJuZWQgYnkgYGdldFJlbGF0aW9uc2hpcEJ5TmFtZWAsXG4gKiB3aGljaCBnZW5lcmF0ZWQgbW9kZWxzIGltbWVkaWF0ZWx5IGNhc3QgdG8gdGhlaXIgY29uY3JldGUgcmVsYXRpb25zaGlwIHR5cGVcbiAqIChlLmcuIGBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXA8T3duZXIsIFRhcmdldCwgVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz5gKS5cbiAqIFRoZSBtZW1iZXJzIHVzZSBgYW55YCB0eXBlIGFyZ3Mgc28gdGhhdCBjYXN0IGlzIGFsbG93ZWQgcmVnYXJkbGVzcyBvZiB0aGVcbiAqIHRhcmdldCBtb2RlbCdzIHR5cGVkLWF0dHJpYnV0ZSBnZW5lcmljcyDigJQgYSBjb25jcmV0ZSBgRnJvbnRlbmRNb2RlbEJhc2VgIG1lbWJlclxuICogaGVyZSBtYWtlcyB0aGUgY2FzdCBhIG5vbi1vdmVybGFwcGluZyAoVFMyMzUyKSBlcnJvciBmb3IgZXZlcnkgdHlwZWQgbW9kZWwuXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXA8YW55LCBhbnksIGFueT4gfCBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXA8YW55LCBhbnksIGFueT59IEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0ZW1wbGF0ZSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IFtQcmltYXJ5S2V5VmFsdWU9aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWVdXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlfSBbTW9kZWw9RnJvbnRlbmRNb2RlbEJhc2VdXG4gKiBAdHlwZWRlZiB7e2NhbGxiYWNrOiAocGF5bG9hZDoge2lkOiBQcmltYXJ5S2V5VmFsdWUsIG1vZGVsOiBNb2RlbH0pID0+IHZvaWQsIGV2ZW50RmlsdGVyS2V5OiBzdHJpbmcgfCBudWxsLCBldmVudEZpbHRlclBheWxvYWQ6IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZCB8IG51bGwsIHByb2plY3Rpb25QYXlsb2FkOiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH19IEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHRlbXBsYXRlIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gW1ByaW1hcnlLZXlWYWx1ZT1pbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZV1cbiAqIEB0eXBlZGVmIHt7Y2FsbGJhY2s6IChwYXlsb2FkOiB7aWQ6IFByaW1hcnlLZXlWYWx1ZX0pID0+IHZvaWR9fSBGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50Q2FsbGJhY2tFbnRyeVxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDb21tYW5kVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge1wiY3JlYXRlXCIgfCBcImZpbmRcIiB8IFwiaW5kZXhcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGUgKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxDb21tYW5kVHlwZSB8IHN0cmluZ30gRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSAqL1xuLyoqXG4gKiBNb2RlbC1saWtlIGluc3RhbmNlIHZhbHVlIHN1cHBvcnRlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQuXG4gKiBAdHlwZWRlZiB7e2F0dHJpYnV0ZXM6ICgpID0+IFJlY29yZDxzdHJpbmcsIHVua25vd24+fX0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydE1vZGVsVmFsdWVcbiAqL1xuLyoqXG4gKiBTcGVjaWFsIHNjYWxhciB2YWx1ZXMgcmVzdG9yZWQgYnkgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0LlxuICogQHR5cGVkZWYge3VuZGVmaW5lZCB8IG51bGwgfCBib29sZWFuIHwgbnVtYmVyIHwgc3RyaW5nIHwgYmlnaW50IHwgRGF0ZSB8IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRNb2RlbFZhbHVlfSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0U2NhbGFyVmFsdWVcbiAqL1xuLyoqXG4gKiBQbGFpbiBvYmplY3Qgc3VwcG9ydGVkIGJ5IGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCB2YWx1ZXMuXG4gKiBOZXN0ZWQgdmFsdWVzIGFyZSBpbnRlbnRpb25hbGx5IG9wYXF1ZSBiZWNhdXNlIFR5cGVTY3JpcHQgcmVqZWN0cyByZWN1cnNpdmVcbiAqIEpTRG9jIHR5cGVkZWZzIGZvciB0aGlzIHRyYW5zcG9ydCB2YWx1ZSBjb250cmFjdC5cbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydE9iamVjdFxuICovXG4vKipcbiAqIFZhbHVlIHN1cHBvcnRlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgc2VyaWFsaXphdGlvbiBhbmQgZGVzZXJpYWxpemF0aW9uLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRTY2FsYXJWYWx1ZSB8IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRPYmplY3QgfCBBcnJheTx1bmtub3duPn0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlXG4gKi9cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIHZhbHVlIHVzZWQgd2hlbiBnZW5lcmF0ZWQgbWV0YWRhdGEgY2Fubm90IGluZmVyIGEgbmFycm93ZXIgdHlwZS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tzeW5jPzogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BdHRhY2htZW50U3luY0NvbmZpZ3VyYXRpb24sIHR5cGU6IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIn19IEZyb250ZW5kTW9kZWxBdHRhY2htZW50RGVmaW5pdGlvblxuICovXG4vKipcbiAqIERlZmluZXMgZnJvbnRlbmQtbW9kZWwgYXR0cmlidXRlIG1ldGFkYXRhLlxuICogQHR5cGVkZWYge3tjb2x1bW5UeXBlPzogc3RyaW5nLCBkYXRhVHlwZT86IHN0cmluZywganNEb2NUeXBlPzogc3RyaW5nLCBuYW1lPzogc3RyaW5nLCBudWxsPzogYm9vbGVhbiwgc2VsZWN0ZWRCeURlZmF1bHQ/OiBib29sZWFuLCBzcWxUeXBlPzogc3RyaW5nLCB0eXBlPzogc3RyaW5nfX0gRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZURlZmluaXRpb25cbiAqL1xuLyoqXG4gKiBBdHRhY2htZW50IGlucHV0IGFjY2VwdGVkIGJ5IGZyb250ZW5kLW1vZGVsIGF0dGFjaG1lbnQgaGVscGVycyBiZWZvcmUgbm9ybWFsaXphdGlvbi5cbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB7YXJyYXlCdWZmZXI6ICgpID0+IFByb21pc2U8QXJyYXlCdWZmZXI+LCB0eXBlPzogc3RyaW5nLCBuYW1lPzogc3RyaW5nfSB8IG51bGwgfCB1bmRlZmluZWR9IEZyb250ZW5kTW9kZWxBdHRhY2htZW50SW5wdXRcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSBGcm9udGVuZE1vZGVsU3luY01ldGFkYXRhXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7XCJvcHRpbWlzdGljVmVyc2lvblwiIHwgXCJzZXJ2ZXJXaW5zXCIgfCBcImxhc3RXcml0ZXJXaW5zXCIgfCBcImZpZWxkVGhyZWVXYXlcIiB8IFwiYXBwZW5kT25seVwifSBGcm9udGVuZE1vZGVsU3luY0NvbmZsaWN0U3RyYXRlZ3lcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7ZW5hYmxlZDogYm9vbGVhbiwgb3BlcmF0aW9uczogc3RyaW5nW10sIHBvbGljeUhhc2g6IHN0cmluZywgcG9saWN5VmVyc2lvbjogc3RyaW5nIHwgbnVsbCwgY29uZmxpY3RTdHJhdGVneT86IEZyb250ZW5kTW9kZWxTeW5jQ29uZmxpY3RTdHJhdGVneSwgbWV0YWRhdGE/OiBGcm9udGVuZE1vZGVsU3luY01ldGFkYXRhfX0gRnJvbnRlbmRNb2RlbFN5bmNDb25maWdcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7YXR0cmlidXRlcz86IEFycmF5PHN0cmluZyB8IEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVEZWZpbml0aW9uPiB8IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVEZWZpbml0aW9uPiwgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcz86IHN0cmluZ1tdLCBidWlsdEluTWVtYmVyQ29tbWFuZHM/OiBzdHJpbmdbXSwgY29sbGVjdGlvbkNvbW1hbmRzPzogc3RyaW5nW10sIGNvbW1hbmRzPzogc3RyaW5nW10sIG1lbWJlckNvbW1hbmRzPzogc3RyaW5nW10sIGF0dGFjaG1lbnRzPzogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREZWZpbml0aW9uPiwgbW9kZWxOYW1lPzogc3RyaW5nLCBuZXN0ZWRBdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywge2FsbG93RGVzdHJveT86IGJvb2xlYW4sIGxpbWl0PzogbnVtYmVyfT4sIHByaW1hcnlLZXk/OiBzdHJpbmcgfCBzdHJpbmdbXSwgcmVsYXRpb25zaGlwcz86IHN0cmluZ1tdLCBzeW5jPzogRnJvbnRlbmRNb2RlbFN5bmNDb25maWd9fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWdcbiAqL1xuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCBjb25zdHJ1Y3RvciB0eXBlLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZX0gW1Q9RnJvbnRlbmRNb2RlbEJhc2VdXG4gKiBAdHlwZWRlZiB7e25ldyAoYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4pOiBUfX0gRnJvbnRlbmRNb2RlbENvbnN0cnVjdG9yXG4gKi9cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgc3RhdGljIHNpZGUuXG4gKlxuICogVGhlIHRlbXBsYXRlIGRlZmF1bHRzIGFyZSBpbnRlbnRpb25hbGx5IHBlcm1pc3NpdmUgKGBhbnlgIG1vZGVsL2F0dHJpYnV0ZVxuICogcGFyYW1zKS4gVGhlIGJhcmUgYEZyb250ZW5kTW9kZWxDbGFzc2AgaXMgdGhlIGBAdGhpc2AvY29uc3RyYWludCB0eXBlIG9uIHRoZVxuICogc3RhdGljIHF1ZXJ5IG1ldGhvZHMgKGZpbmRCeS9maW5kL3doZXJlL3ByZWxvYWQvLi4uKTsgYSBnZW5lcmF0ZWQgc3ViY2xhc3NcbiAqIGRlY2xhcmVzIHR5cGVkLWF0dHJpYnV0ZSBnZW5lcmljcyAoZS5nLiBgRnJvbnRlbmRNb2RlbEJhc2U8QWNjb3VudEF0dHJpYnV0ZXMsXG4gKiBBY2NvdW50Q3JlYXRlQXR0cmlidXRlcywgQWNjb3VudFVwZGF0ZUF0dHJpYnV0ZXM+YCkgd2hpY2gsIGFnYWluc3QgYSBjb25jcmV0ZVxuICogYFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT5gIGRlZmF1bHQsIGZhaWwgdGhlIGNvbnN0cmFpbnQgYnlcbiAqIGludmFyaWFuY2UuIERlZmF1bHRpbmcgdG8gYGFueWAgbGV0cyBhbnkgc3ViY2xhc3Mgc2F0aXNmeSB0aGUgY29uc3RyYWludCB3aGlsZVxuICogdGhlIG1ldGhvZHMnIG93biBgQHRlbXBsYXRlIFRgIHN0aWxsIGNhcHR1cmVzIHRoZSBwcmVjaXNlIGNhbGxpbmcgY2xhc3MgZm9yXG4gKiB0aGVpciByZXR1cm4gdHlwZXMuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlfSBbVD1Gcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55Pl1cbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbQXR0cmlidXRlcz1hbnldXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW0NyZWF0ZUF0dHJpYnV0ZXM9YW55XVxuICogQHR5cGVkZWYge3tuZXcgKCk6IFQsIGNyZWF0ZShhdHRyaWJ1dGVzPzogQ3JlYXRlQXR0cmlidXRlcyk6IFByb21pc2U8VD59ICYgT21pdDx0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2UsIFwiY3JlYXRlXCIgfCBcInByb3RvdHlwZVwiPn0gRnJvbnRlbmRNb2RlbENsYXNzXG4gKi9cbi8qKlxuICogQ3JlYXRlIGF0dHJpYnV0ZXMgYWNjZXB0ZWQgYnkgYSBmcm9udGVuZCBtb2RlbCBpbnN0YW5jZS5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2V9IFRcbiAqIEB0eXBlZGVmIHtUIGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2U8UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgaW5mZXIgQ3JlYXRlQXR0cmlidXRlcywgaW5mZXIgX1VwZGF0ZUF0dHJpYnV0ZXM+ID8gQ3JlYXRlQXR0cmlidXRlcyA6IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59IEZyb250ZW5kTW9kZWxDcmVhdGVBdHRyaWJ1dGVzRm9yXG4gKi9cbi8qKlxuICogTGlmZWN5Y2xlIGV2ZW50IGlkZW50aXR5IGV4cG9zZWQgYnkgYSBjb25jcmV0ZSBmcm9udGVuZCBtb2RlbC5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2V9IFRcbiAqIEB0eXBlZGVmIHtUIGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueSwgYW55LCBpbmZlciBFdmVudFByaW1hcnlLZXlWYWx1ZT4gPyBFdmVudFByaW1hcnlLZXlWYWx1ZSA6IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBGcm9udGVuZE1vZGVsRXZlbnRQcmltYXJ5S2V5VmFsdWVGb3JcbiAqL1xuLyoqXG4gKiBMb2FkZWQgaW5zdGFuY2UgdHlwZSBmb3IgcmVsYXRpb25zaGlwIGhlbHBlciBnZW5lcmljcy4gT2xkZXIgZ2VuZXJhdGVkXG4gKiBmcm9udGVuZCBtb2RlbHMgcGFzc2VkIG1vZGVsIGNsYXNzZXMgaW50byByZWxhdGlvbnNoaXAgaGVscGVycywgd2hpbGUgbmV3ZXJcbiAqIGdlbmVyYXRlZCBtb2RlbHMgcGFzcyBpbnN0YW5jZSB0eXBlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFRcbiAqIEB0eXBlZGVmIHtUIGV4dGVuZHMgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlID8gSW5zdGFuY2VUeXBlPFQ+IDogVH0gRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZ1xuICogQHByb3BlcnR5IHtzdHJpbmcgfCAoKCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCl9IFt1cmxdIC0gT3B0aW9uYWwgZnJvbnRlbmQtbW9kZWwgVVJMLiBUaGlzIHNob3VsZCBiZSB0aGUgc2hhcmVkIGVuZHBvaW50IChmb3IgZXhhbXBsZSBgXCIvZnJvbnRlbmQtbW9kZWxzXCJgIG9yIGBcImh0dHBzOi8vZXhhbXBsZS5jb20vZnJvbnRlbmQtbW9kZWxzXCJgKS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3NoYXJlZF0gLSBEZXByZWNhdGVkIHNoYXJlZC1lbmRwb2ludCBmbGFnIHJldGFpbmVkIGZvciBjb21wYXRpYmlsaXR5LiBGcm9udGVuZC1tb2RlbCBDUlVEL2N1c3RvbSBjb21tYW5kcyB1c2UgdGhlIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgZW52ZWxvcGUgYnkgZGVmYXVsdC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgKCgpID0+IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpfSBbd2Vic29ja2V0VXJsXSAtIE9wdGlvbmFsIHdlYnNvY2tldCBVUkwuIFdoZW4gc2V0LCBWZWxvY2lvdXMgY3JlYXRlcyBhbmQgbWFuYWdlcyBpdHMgb3duIHdlYnNvY2tldCBjbGllbnQgaW50ZXJuYWxseS4gU3Vic2NyaXB0aW9ucyB1c2UgdGhlIHdlYnNvY2tldDsgQ1JVRCB1c2VzIEhUVFAgYW5kIGZhbGxzIGJhY2sgZ3JhY2VmdWxseS4gRXhhbXBsZTogYFwid3M6Ly9sb2NhbGhvc3Q6MzAwNi93ZWJzb2NrZXRcImAuXG4gKiBAcHJvcGVydHkge3twb3N0OiAocGF0aDogc3RyaW5nLCBib2R5PzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG9wdGlvbnM/OiB7aGVhZGVycz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sIHNpZ25hbD86IEFib3J0U2lnbmFsfSkgPT4gUHJvbWlzZTx7anNvbjogKCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Piwgc3Vic2NyaWJlOiAoY2hhbm5lbDogc3RyaW5nLCBvcHRpb25zOiB7cGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSwgY2FsbGJhY2s6IChwYXlsb2FkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZCkgPT4gKCgpID0+IHZvaWQpLCBzdWJzY3JpYmVBbmRXYWl0PzogKGNoYW5uZWw6IHN0cmluZywgb3B0aW9uczoge3BhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0sIGNhbGxiYWNrOiAocGF5bG9hZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHZvaWQpID0+IFByb21pc2U8KCgpID0+IHZvaWQpPn19IFt3ZWJzb2NrZXRDbGllbnRdIC0gT3B0aW9uYWwgd2Vic29ja2V0IGNsaWVudCBmb3Igc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0cyBhbmQgc3Vic2NyaXB0aW9ucy4gSXRzIGBwb3N0YCByZWNlaXZlcyB0aGUgYm91bmRlZC1kZWFkbGluZSBgc2lnbmFsYCBhbmQgc2hvdWxkIGZvcndhcmQgaXQgaW50byB0aGUgdW5kZXJseWluZyB0cmFuc3BvcnQgc28gdGhlIGRlYWRsaW5lIGNhbiBhYm9ydCB0aGUgbGl2ZSByZXF1ZXN0IGFuZCBpdHMgcmVzcG9uc2UtYm9keSByZWFkLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgKCgpID0+IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pfSBbcmVxdWVzdEhlYWRlcnNdIC0gRXh0cmEgSFRUUC9XUyBoZWFkZXJzIHRvIGF0dGFjaCB0byBldmVyeSBmcm9udGVuZC1tb2RlbCBBUEkgcmVxdWVzdC4gUGFzcyBhIGZ1bmN0aW9uIHRvIGNvbXB1dGUgdGhlbSBhdCByZXF1ZXN0IHRpbWUgKGZvciBleGFtcGxlIHRvIGluY2x1ZGUgdGhlIGN1cnJlbnQgbG9jYWxlKS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dCB8ICgoKSA9PiBpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0IHwgdW5kZWZpbmVkIHwgbnVsbCl9IFtyZXF1ZXN0Q29udGV4dF0gLSBJbW11dGFibGUgc2NhbGFyIGNvbnRleHQgY2FwdHVyZWQgaW5kZXBlbmRlbnRseSB3aGVuIGVhY2ggb3BlcmF0aW9uIG9yIGV2ZW50IHN1YnNjcmlwdGlvbiBzdGFydHMgYW5kIHNlbnQgZm9yIHJlbW90ZSB0ZW5hbnQvYWJpbGl0eSByZXNvbHV0aW9uLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCAoKCkgPT4gbnVtYmVyIHwgdW5kZWZpbmVkIHwgbnVsbCl9IFt0aW1lb3V0XSAtIEJvdW5kZWQgZGVhZGxpbmUgaW4gbWlsbGlzZWNvbmRzIGNvdmVyaW5nIGNvbm5lY3Rpb24sIHJlc3BvbnNlIGhlYWRlcnMsIGFuZCByZXNwb25zZS1ib2R5IGNvbnN1bXB0aW9uIGZvciBlYWNoIGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0LiBPbiBleHBpcnkgdGhlIGxpdmUgZmV0Y2gvYWRhcHRlciByZXF1ZXN0IGlzIGFib3J0ZWQgKGJ1aWx0IG9uIGF3YWl0ZXJ5J3MgYHRpbWVvdXRgKSBhbmQgYXdhaXRlcnkncyBgVGltZW91dEVycm9yYCBpcyB0aHJvd24sIHNvIGNhbGxlcnMgY2FuIGNsYXNzaWZ5IGEgdGltZW91dCB2aWEgYGVycm9yIGluc3RhbmNlb2YgVGltZW91dEVycm9yYC4gUGFzcyBhIGZ1bmN0aW9uIHRvIHJlc29sdmUgaXQgcGVyIHJlcXVlc3QuIEZhbHN5L2Fic2VudCBtZWFucyBubyBkZWFkbGluZS5cbiAqIEBwcm9wZXJ0eSB7QWJvcnRTaWduYWwgfCAoKCkgPT4gQWJvcnRTaWduYWwgfCB1bmRlZmluZWQgfCBudWxsKX0gW3NpZ25hbF0gLSBPcHRpb25hbCBjYWxsZXIvc2Vzc2lvbiBBYm9ydFNpZ25hbCBjb21wb3NlZCB3aXRoIHRoZSBkZWFkbGluZS4gQWJvcnRpbmcgaXQgY2FuY2VscyB0aGUgbGl2ZSByZXF1ZXN0IChmb3IgZXhhbXBsZSBvbiBzZXNzaW9uIHNodXRkb3duIG9yIG9mZmxpbmUgdHJhbnNpdGlvbik7IHRoZSByZXN1bHRpbmcgYWJvcnQgZXJyb3Igc3RheXMgZGlzdGluZ3Vpc2hhYmxlIGZyb20gYSB0aW1lb3V0LiBQYXNzIGEgZnVuY3Rpb24gdG8gcmVzb2x2ZSB0aGUgY3VycmVudCBzaWduYWwgcGVyIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge3tnZXQ6ICgpID0+IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQgfCBQcm9taXNlPHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQ+LCBzZXQ6IChzZXNzaW9uSWQ6IHN0cmluZykgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4sIGNsZWFyOiAoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn19IFtzZXNzaW9uU3RvcmVdIC0gT3B0aW9uYWwgc2Vzc2lvbklkIHBlcnNpc3RlbmNlIGhvb2sgZm9yd2FyZGVkIHRvIHRoZSBpbnRlcm5hbCBgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50YCBzbyBXUyBzZXNzaW9ucyBjYW4gYmUgcmVzdW1lZCBhY3Jvc3MgcGFnZSByZWxvYWRzIC8gYXBwIHJlc3RhcnRzLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCAoKCkgPT4gc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCl9IFt0aW1lWm9uZV0gLSBJQU5BIHRpbWV6b25lIHNlbnQgd2l0aCBldmVyeSBmcm9udGVuZC1tb2RlbCBBUEkgcmVxdWVzdCBmb3IgdGltZXpvbmUtbGVzcyBkYXRldGltZSBwYXJzaW5nLlxuICogQHByb3BlcnR5IHt7YWN0b3JEZXZpY2VJZDogc3RyaW5nLCBhY3RvclVzZXJJZDogc3RyaW5nLCBjbGllbnRNdXRhdGlvbklkPzogKCkgPT4gc3RyaW5nLCBlbmFibGVkPzogYm9vbGVhbiwgbXV0YXRpb25Mb2c6IGltcG9ydChcIi4uL3N5bmMvbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLmRlZmF1bHQsIG5vdz86ICgpID0+IERhdGUsIG9mZmxpbmVHcmFudDoge2lkOiBzdHJpbmd9fX0gW29mZmxpbmVTeW5jXSAtIE9mZmxpbmUgbXV0YXRpb24gcXVldWUgY29uZmlndXJhdGlvbi5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsSWRsZVdhaXRBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsSWRsZVdhaXRBcmdzXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3F1aWV0TXNdIC0gTWlsbGlzZWNvbmRzIHRoZSB0cmFuc3BvcnQgbXVzdCBzdGF5IGlkbGUgYmVmb3JlIHJlc29sdmluZy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbdGltZW91dF0gLSBUaW1lb3V0IGluIG1pbGxpc2Vjb25kcy5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBjb25maWcuXG4gKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZ30gKi9cbmNvbnN0IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcgPSB7fVxuY29uc3QgU0hBUkVEX0ZST05URU5EX01PREVMX0FQSV9QQVRIID0gXCIvZnJvbnRlbmQtbW9kZWxzXCJcbmNvbnN0IFBSRUxPQURFRF9SRUxBVElPTlNISVBTX0tFWSA9IFwiX19wcmVsb2FkZWRSZWxhdGlvbnNoaXBzXCJcbmNvbnN0IFNFTEVDVEVEX0FUVFJJQlVURVNfS0VZID0gXCJfX3NlbGVjdGVkQXR0cmlidXRlc1wiXG5jb25zdCBBU1NPQ0lBVElPTl9DT1VOVFNfS0VZID0gXCJfX2Fzc29jaWF0aW9uQ291bnRzXCJcbmNvbnN0IFFVRVJZX0RBVEFfS0VZID0gXCJfX3F1ZXJ5RGF0YVwiXG5jb25zdCBBQklMSVRJRVNfS0VZID0gXCJfX2FiaWxpdGllc1wiXG5jb25zdCBBVFRBQ0hNRU5UX09XTkVSX0tFWSA9IFwiX19hdHRhY2htZW50T3duZXJcIlxuLyoqXG4gKiBQZW5kaW5nIHNoYXJlZCBmcm9udGVuZCBtb2RlbCByZXF1ZXN0cy5cbiAqIEB0eXBlIHtBcnJheTx7Y29tbWFuZE5hbWU/OiBzdHJpbmcsIGNvbW1hbmRUeXBlOiBGcm9udGVuZE1vZGVsUmVxdWVzdENvbW1hbmRUeXBlLCBjdXN0b21QYXRoPzogc3RyaW5nLCBtb2RlbENsYXNzOiBGcm9udGVuZE1vZGVsQ2xhc3MsIHBheWxvYWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgcmVxdWVzdENvbnRleHQ6IGltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQsIHJlcXVlc3RJZDogc3RyaW5nLCByZXNvbHZlOiAocmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gdm9pZCwgcmVqZWN0OiAoZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiB2b2lkLCByZXNvdXJjZVBhdGg/OiBzdHJpbmcgfCBudWxsfT59ICovXG5sZXQgcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cyA9IFtdXG5cbmxldCBzaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdElkID0gMFxubGV0IHNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZCA9IGZhbHNlXG5sZXQgYWN0aXZlRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3RDb3VudCA9IDBcbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgaWRsZSByZXNvbHZlcnMuXG4gKiBAdHlwZSB7QXJyYXk8KCkgPT4gdm9pZD59ICovXG5sZXQgZnJvbnRlbmRNb2RlbElkbGVSZXNvbHZlcnMgPSBbXVxuXG4vKipcbiAqIEludGVybmFsIHdlYnNvY2tldCBjbGllbnQuXG4gKiBAdHlwZSB7VmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50IHwgbnVsbH0gKi9cbmxldCBpbnRlcm5hbFdlYnNvY2tldENsaWVudCA9IG51bGxcbi8qKiBAdHlwZSB7QWJvcnRTaWduYWwgfCBudWxsfSAqL1xubGV0IGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsID0gbnVsbFxuLyoqIEB0eXBlIHsoKCkgPT4gdm9pZCkgfCBudWxsfSAqL1xubGV0IGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cCA9IG51bGxcblxuLyoqXG4gKiBEZXRhY2hlcyBhbiBvd25lZCBXZWJTb2NrZXQgY2xpZW50IGZyb20gdGhlIHNoYXJlZCBjYWNoZSBpZiBpdCBpcyBzdGlsbCBjdXJyZW50LlxuICogQHBhcmFtIHtWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnR9IGNsaWVudCAtIENsaWVudCB3aG9zZSBvd25lcnNoaXAgaXMgZW5kaW5nLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGRldGFjaEludGVybmFsV2Vic29ja2V0Q2xpZW50KGNsaWVudCkge1xuICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgIT09IGNsaWVudCkgcmV0dXJuXG5cbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgPSBudWxsXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cD8uKClcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwgPSBudWxsXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cCA9IG51bGxcbn1cblxuLyoqXG4gKiBEaXNwb3NlcyB0aGUgb3duZWQgV2ViU29ja2V0IGNsaWVudCBiZWZvcmUgdHJhbnNwb3J0L3Nlc3Npb24gY29uZmlndXJhdGlvbiBjaGFuZ2VzLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJlc2V0SW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSB7XG4gIGNvbnN0IGNsaWVudCA9IGludGVybmFsV2Vic29ja2V0Q2xpZW50XG5cbiAgaWYgKCFjbGllbnQpIHJldHVyblxuXG4gIGRldGFjaEludGVybmFsV2Vic29ja2V0Q2xpZW50KGNsaWVudClcbiAgdm9pZCBjbGllbnQuZGlzY29ubmVjdEFuZFN0b3BSZWNvbm5lY3QoKVxufVxuXG4vKipcbiAqIEJpbmRzIHRoZSBvd25lZCBXZWJTb2NrZXQgY2xpZW50IGxpZmV0aW1lIHRvIHRoZSBjdXJyZW50IHNlc3Npb24gc2lnbmFsLlxuICogQHBhcmFtIHtBYm9ydFNpZ25hbCB8IHVuZGVmaW5lZH0gc2Vzc2lvblNpZ25hbCAtIEN1cnJlbnQgc2Vzc2lvbiBzaWduYWwuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYmluZEludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsKHNlc3Npb25TaWduYWwpIHtcbiAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsID09PSBzZXNzaW9uU2lnbmFsKSByZXR1cm5cblxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXA/LigpXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsID0gc2Vzc2lvblNpZ25hbCB8fCBudWxsXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cCA9IG51bGxcblxuICBpZiAoIXNlc3Npb25TaWduYWwgfHwgIWludGVybmFsV2Vic29ja2V0Q2xpZW50KSByZXR1cm5cblxuICBjb25zdCBjbGllbnQgPSBpbnRlcm5hbFdlYnNvY2tldENsaWVudFxuICBjb25zdCBvblNlc3Npb25BYm9ydCA9ICgpID0+IHtcbiAgICBkZXRhY2hJbnRlcm5hbFdlYnNvY2tldENsaWVudChjbGllbnQpXG4gICAgY2xlYXJCdWZmZXJlZE91dGdvaW5nRXZlbnRzKClcbiAgICB2b2lkIGNsaWVudC5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG4gIH1cblxuICBzZXNzaW9uU2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBvblNlc3Npb25BYm9ydCwge29uY2U6IHRydWV9KVxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXAgPSAoKSA9PiBzZXNzaW9uU2lnbmFsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBvblNlc3Npb25BYm9ydClcblxuICBpZiAoc2Vzc2lvblNpZ25hbC5hYm9ydGVkKSBvblNlc3Npb25BYm9ydCgpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgaXMgaWRsZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYWxsIHF1ZXVlZCBhbmQgYWN0aXZlIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCByZXF1ZXN0cyBhcmUgZG9uZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpIHtcbiAgcmV0dXJuIGFjdGl2ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0Q291bnQgPT09IDBcbiAgICAmJiBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzLmxlbmd0aCA9PT0gMFxuICAgICYmICFzaGFyZWRGcm9udGVuZE1vZGVsRmx1c2hTY2hlZHVsZWRcbn1cblxuLyoqXG4gKiBSdW5zIHJlc29sdmUgZnJvbnRlbmQgbW9kZWwgaWRsZSB3YWl0ZXJzLlxuICogQHJldHVybnMge3ZvaWR9ICovXG5mdW5jdGlvbiByZXNvbHZlRnJvbnRlbmRNb2RlbElkbGVXYWl0ZXJzKCkge1xuICBpZiAoIWZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSkgcmV0dXJuXG5cbiAgY29uc3QgcmVzb2x2ZXJzID0gZnJvbnRlbmRNb2RlbElkbGVSZXNvbHZlcnNcbiAgZnJvbnRlbmRNb2RlbElkbGVSZXNvbHZlcnMgPSBbXVxuXG4gIGZvciAoY29uc3QgcmVzb2x2ZSBvZiByZXNvbHZlcnMpIHtcbiAgICByZXNvbHZlKClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgd2FpdCBmb3IgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHF1aWV0IHBlcmlvZC5cbiAqIEBwYXJhbSB7bnVtYmVyfSBtaWxsaXNlY29uZHMgLSBRdWlldCBwZXJpb2QgbGVuZ3RoLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHRoZSBxdWlldCBwZXJpb2QuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JGcm9udGVuZE1vZGVsVHJhbnNwb3J0UXVpZXRQZXJpb2QobWlsbGlzZWNvbmRzKSB7XG4gIGlmIChtaWxsaXNlY29uZHMgPD0gMCkgcmV0dXJuXG5cbiAgYXdhaXQgd2FpdChtaWxsaXNlY29uZHMpXG59XG5cbi8qKlxuICogUnVucyB3YWl0IGZvciBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgaWRsZS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBxdWlldE1zIC0gTWlsbGlzZWNvbmRzIHRoZSB0cmFuc3BvcnQgbXVzdCBzdGF5IGlkbGUgYmVmb3JlIHJlc29sdmluZy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHRyYW5zcG9ydCBzdGF5cyBpZGxlLlxuICovXG5hc3luYyBmdW5jdGlvbiB3YWl0Rm9yRnJvbnRlbmRNb2RlbFRyYW5zcG9ydElkbGUocXVpZXRNcyA9IDApIHtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBpZiAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpKSB7XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gcXVldWVNaWNyb3Rhc2soKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKSlcblxuICAgICAgaWYgKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSkge1xuICAgICAgICBhd2FpdCB3YWl0Rm9yRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFF1aWV0UGVyaW9kKHF1aWV0TXMpXG5cbiAgICAgICAgaWYgKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSkgcmV0dXJuXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgIGZyb250ZW5kTW9kZWxJZGxlUmVzb2x2ZXJzLnB1c2goKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKVxuICAgICAgfSlcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHRyYWNrIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCByZXF1ZXN0LlxuICogQHRlbXBsYXRlIFRcbiAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc3BvcnQgY2FsbGJhY2suXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHRyYWNrRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3QoY2FsbGJhY2spIHtcbiAgYWN0aXZlRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3RDb3VudCArPSAxXG5cbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICB9IGZpbmFsbHkge1xuICAgIGFjdGl2ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0Q291bnQgLT0gMVxuICAgIHJlc29sdmVGcm9udGVuZE1vZGVsSWRsZVdhaXRlcnMoKVxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgaW50ZXJuYWwgd2Vic29ja2V0IGNsaWVudCBmcm9tIHdlYnNvY2tldFVybCBjb25maWcuXG4gKiBDcmVhdGVzIHRoZSBjbGllbnQgbGF6aWx5IG9uIGZpcnN0IGNhbGwuIFJldHVybnMgbnVsbCBpZiBXZWJTb2NrZXRcbiAqIGlzIG5vdCBhdmFpbGFibGUgb3Igd2Vic29ja2V0VXJsIGlzIG5vdCBjb25maWd1cmVkLlxuICogQHJldHVybnMge1ZlbG9jaW91c1dlYnNvY2tldENsaWVudCB8IG51bGx9IFdlYnNvY2tldCBjbGllbnQgb3IgbnVsbC5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkge1xuICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQpIHtcbiAgICBjb25zdCBjbGllbnQgPSBpbnRlcm5hbFdlYnNvY2tldENsaWVudFxuXG4gICAgYmluZEludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSlcblxuICAgIHJldHVybiBjbGllbnRcbiAgfVxuXG4gIGNvbnN0IHdlYnNvY2tldFVybCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0VXJsXG5cbiAgaWYgKCF3ZWJzb2NrZXRVcmwpIHJldHVybiBudWxsXG4gIGlmICh0eXBlb2YgZ2xvYmFsVGhpcy5XZWJTb2NrZXQgPT09IFwidW5kZWZpbmVkXCIpIHJldHVybiBudWxsXG5cbiAgY29uc3QgcmVzb2x2ZWRVcmwgPSB0eXBlb2Ygd2Vic29ja2V0VXJsID09PSBcImZ1bmN0aW9uXCIgPyB3ZWJzb2NrZXRVcmwoKSA6IHdlYnNvY2tldFVybFxuXG4gIGlmICghcmVzb2x2ZWRVcmwpIHJldHVybiBudWxsXG5cbiAgY29uc3QgY2xpZW50ID0gbmV3IFZlbG9jaW91c1dlYnNvY2tldENsaWVudCh7XG4gICAgYXV0b1JlY29ubmVjdDogdHJ1ZSxcbiAgICBzZXNzaW9uU3RvcmU6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2Vzc2lvblN0b3JlLFxuICAgIHVybDogcmVzb2x2ZWRVcmxcbiAgfSlcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgPSBjbGllbnRcbiAgY2xpZW50Lm9uUmVjb25uZWN0ID0gYXN5bmMgKCkgPT4gYXdhaXQgZmx1c2hCdWZmZXJlZE91dGdvaW5nRXZlbnRzQWZ0ZXJSZWNvbm5lY3QoY2xpZW50KVxuXG4gIGJpbmRJbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbChmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCkpXG5cbiAgcmV0dXJuIGNsaWVudFxufVxuXG4vKipcbiAqIFJ1bnMgZmx1c2ggYnVmZmVyZWQgb3V0Z29pbmcgZXZlbnRzIGFmdGVyIHJlY29ubmVjdC5cbiAqIEBwYXJhbSB7VmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50fSBjbGllbnQgLSBSZWNvbm5lY3RlZCBjbGllbnQgdGhhdCBvd25zIHRoaXMgZmx1c2guXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gKi9cbmFzeW5jIGZ1bmN0aW9uIGZsdXNoQnVmZmVyZWRPdXRnb2luZ0V2ZW50c0FmdGVyUmVjb25uZWN0KGNsaWVudCkge1xuICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgIT09IGNsaWVudCkgcmV0dXJuXG5cbiAgY29uc3QgZXZlbnRzID0gZHJhaW5CdWZmZXJlZE91dGdvaW5nRXZlbnRzKClcbiAgY29uc3Qgc2Vzc2lvblNpZ25hbCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKVxuXG4gIGF3YWl0IHJ1bldpdGhUcmFuc3BvcnREZWFkbGluZShcbiAgICB7XG4gICAgICBlcnJvck1lc3NhZ2U6IFwiQnVmZmVyZWQgZnJvbnRlbmQtbW9kZWwgV2ViU29ja2V0IGZsdXNoIHRpbWVkIG91dFwiLFxuICAgICAgc2lnbmFsOiBzZXNzaW9uU2lnbmFsLFxuICAgICAgdGltZW91dE1zOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKClcbiAgICB9LFxuICAgIGFzeW5jIChzaWduYWwpID0+IHtcbiAgICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBldmVudHMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgICAgIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IGNsaWVudC5wb3N0KGV2ZW50c1tpbmRleF0uY3VzdG9tUGF0aCwgZXZlbnRzW2luZGV4XS5wYXlsb2FkLCB7c2lnbmFsfSlcblxuICAgICAgICAgIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50ICE9PSBjbGllbnQpIHJldHVyblxuICAgICAgICAgIGlmIChzZXNzaW9uU2lnbmFsPy5hYm9ydGVkKSByZXR1cm5cblxuICAgICAgICAgIGlmIChzaWduYWwuYWJvcnRlZCkge1xuICAgICAgICAgICAgZm9yIChsZXQgcmVtYWluaW5nID0gaW5kZXg7IHJlbWFpbmluZyA8IGV2ZW50cy5sZW5ndGg7IHJlbWFpbmluZyArPSAxKSB7XG4gICAgICAgICAgICAgIGJ1ZmZlck91dGdvaW5nRXZlbnQoZXZlbnRzW3JlbWFpbmluZ10pXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHNvY2tldE9wZW4gPSBjbGllbnQuc29ja2V0Py5yZWFkeVN0YXRlID09PSBjbGllbnQuc29ja2V0Py5PUEVOXG5cbiAgICAgICAgICBpZiAoc29ja2V0T3BlbikgY29udGludWVcblxuICAgICAgICAgIGZvciAobGV0IHJlbWFpbmluZyA9IGluZGV4OyByZW1haW5pbmcgPCBldmVudHMubGVuZ3RoOyByZW1haW5pbmcgKz0gMSkge1xuICAgICAgICAgICAgYnVmZmVyT3V0Z29pbmdFdmVudChldmVudHNbcmVtYWluaW5nXSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgKVxufVxuXG4vKipcbiAqIFJ1bnMgZGVmYXVsdCBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBwYXRoLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGVmYXVsdCByZXNvdXJjZSBwYXRoIGZvciB0aGUgbW9kZWwgY2xhc3MuXG4gKi9cbmZ1bmN0aW9uIGRlZmF1bHRGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKG1vZGVsQ2xhc3MpIHtcbiAgcmV0dXJuIGAvJHtpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnBsdXJhbGl6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUobW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSkpKX1gXG59XG5cbi8qKiBFcnJvciByYWlzZWQgd2hlbiByZWFkaW5nIGFuIGF0dHJpYnV0ZSB0aGF0IHdhcyBub3Qgc2VsZWN0ZWQgaW4gcXVlcnkgcGF5bG9hZHMuICovXG5leHBvcnQgY2xhc3MgQXR0cmlidXRlTm90U2VsZWN0ZWRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSB0aGF0IHdhcyByZXF1ZXN0ZWQuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcihtb2RlbE5hbWUsIGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBzdXBlcihgJHttb2RlbE5hbWV9IyR7YXR0cmlidXRlTmFtZX0gd2FzIG5vdCBzZWxlY3RlZGApXG4gICAgdGhpcy5uYW1lID0gXCJBdHRyaWJ1dGVOb3RTZWxlY3RlZEVycm9yXCJcbiAgfVxufVxuXG4vKipcbiAqIExpZ2h0d2VpZ2h0IHNpbmd1bGFyIHJlbGF0aW9uc2hpcCBzdGF0ZSBob2xkZXIgZm9yIGZyb250ZW5kIG1vZGVsIGluc3RhbmNlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFNcbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFRcbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz1SZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+XVxuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gUGFyZW50IG1vZGVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzczxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4sIFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4sIFRhcmdldENyZWF0ZUF0dHJpYnV0ZXM+IHwgbnVsbH0gdGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG1vZGVsLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgdGhpcy5tb2RlbCA9IG1vZGVsXG4gICAgdGhpcy5yZWxhdGlvbnNoaXBOYW1lID0gcmVsYXRpb25zaGlwTmFtZVxuICAgIHRoaXMudGFyZ2V0TW9kZWxDbGFzcyA9IHRhcmdldE1vZGVsQ2xhc3NcbiAgICB0aGlzLl9wcmVsb2FkZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBsb2FkZWQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbCB8IHVuZGVmaW5lZH0gbG9hZGVkVmFsdWUgLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldExvYWRlZChsb2FkZWRWYWx1ZSkge1xuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gbG9hZGVkVmFsdWUgPT0gdW5kZWZpbmVkID8gbnVsbCA6IGxvYWRlZFZhbHVlXG4gICAgdGhpcy5fcHJlbG9hZGVkID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHByZWxvYWRlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZWxhdGlvbnNoaXAgaXMgcHJlbG9hZGVkLlxuICAgKi9cbiAgZ2V0UHJlbG9hZGVkKCkge1xuICAgIHJldHVybiB0aGlzLl9wcmVsb2FkZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWRlZC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGx9IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGxvYWRlZCgpIHtcbiAgICBpZiAoIXRoaXMuX3ByZWxvYWRlZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IGhhc24ndCBiZWVuIHByZWxvYWRlZGApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2xvYWRlZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ29waWVzIGxvYWRlZCB2YWx1ZSBmcm9tIGFub3RoZXIgc2luZ3VsYXIgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSBzb3VyY2VSZWxhdGlvbnNoaXAgLSBTb3VyY2UgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjb3B5TG9hZGVkRnJvbShzb3VyY2VSZWxhdGlvbnNoaXApIHtcbiAgICBpZiAoc291cmNlUmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSBzb3VyY2UgcmVsYXRpb25zaGlwIHRvIGJlIHNpbmd1bGFyYClcbiAgICB9XG5cbiAgICAvLyBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSB0YXJnZXQgcmVsYXRpb25zaGlwJ3MgZG9jdW1lbnRlZCBtb2RlbCB0eXBlLlxuICAgIGNvbnN0IGxvYWRlZFZhbHVlID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsfSAqLyAoc291cmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpKVxuXG4gICAgdGhpcy5zZXRMb2FkZWQobG9hZGVkVmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZC5cbiAgICogQHBhcmFtIHtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzfSBbYXR0cmlidXRlc10gLSBOZXcgbW9kZWwgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPn0gLSBCdWlsdCBtb2RlbC5cbiAgICovXG4gIGJ1aWxkKGF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge1RhcmdldENyZWF0ZUF0dHJpYnV0ZXN9ICovICh7fSkpIHtcbiAgICBpZiAoIXRoaXMudGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcykgPT4gRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+fSAqLyAodGhpcy50YXJnZXRNb2RlbENsYXNzKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoYXR0cmlidXRlcylcblxuICAgIHRoaXMuc2V0TG9hZGVkKG1vZGVsKVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogRm9yY2UtcmVsb2FkIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGw+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgbW9kZWwuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBudWxsXG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5tb2RlbC5fdHJ5Q29ob3J0UHJlbG9hZCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoYmF0Y2hlZCkgcmV0dXJuIHRoaXMubG9hZGVkKClcblxuICAgIGF3YWl0IHRoaXMubW9kZWwubG9hZFJlbGF0aW9uc2hpcCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICByZXR1cm4gdGhpcy5sb2FkZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGxvYWRlZCByZWxhdGlvbnNoaXAgb3IgbG9hZHMgaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGw+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgbW9kZWwuXG4gICAqL1xuICBhc3luYyBvckxvYWQoKSB7XG4gICAgaWYgKHRoaXMuZ2V0UHJlbG9hZGVkKCkpIHJldHVybiB0aGlzLmxvYWRlZCgpXG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5tb2RlbC5fdHJ5Q29ob3J0UHJlbG9hZCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoYmF0Y2hlZCkgcmV0dXJuIHRoaXMubG9hZGVkKClcblxuICAgIGF3YWl0IHRoaXMubW9kZWwubG9hZFJlbGF0aW9uc2hpcCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICByZXR1cm4gdGhpcy5sb2FkZWQoKVxuICB9XG59XG5cbi8qKlxuICogTGlnaHR3ZWlnaHQgaGFzLW1hbnkgcmVsYXRpb25zaGlwIHN0YXRlIGhvbGRlciBmb3IgZnJvbnRlbmQgbW9kZWwgaW5zdGFuY2VzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gU1xuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gVFxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzPVJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT5dXG4gKi9cbmV4cG9ydCBjbGFzcyBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCB7XG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSAqL1xuICBfbG9hZGVkVmFsdWVcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBQYXJlbnQgbW9kZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzPEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz4gfCBudWxsfSB0YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgY29uc3RydWN0b3IobW9kZWwsIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICB0aGlzLm1vZGVsID0gbW9kZWxcbiAgICB0aGlzLnJlbGF0aW9uc2hpcE5hbWUgPSByZWxhdGlvbnNoaXBOYW1lXG4gICAgdGhpcy50YXJnZXRNb2RlbENsYXNzID0gdGFyZ2V0TW9kZWxDbGFzc1xuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGxvYWRlZC5cbiAgICogQHBhcmFtIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSBsb2FkZWRWYWx1ZSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0TG9hZGVkKGxvYWRlZFZhbHVlKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGxvYWRlZFZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IHRvIGJlIGxvYWRlZCB3aXRoIGFuIGFycmF5YClcbiAgICB9XG5cbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IGxvYWRlZFZhbHVlXG4gICAgdGhpcy5fcHJlbG9hZGVkID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHByZWxvYWRlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZWxhdGlvbnNoaXAgaXMgcHJlbG9hZGVkLlxuICAgKi9cbiAgZ2V0UHJlbG9hZGVkKCkge1xuICAgIHJldHVybiB0aGlzLl9wcmVsb2FkZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWRlZC5cbiAgICogQHJldHVybnMge0FycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZXMuXG4gICAqL1xuICBsb2FkZWQoKSB7XG4gICAgaWYgKCF0aGlzLl9wcmVsb2FkZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSBoYXNuJ3QgYmVlbiBwcmVsb2FkZWRgKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9sb2FkZWRWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIENvcGllcyBsb2FkZWQgdmFsdWUgZnJvbSBhbm90aGVyIGhhcy1tYW55IHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gc291cmNlUmVsYXRpb25zaGlwIC0gU291cmNlIHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY29weUxvYWRlZEZyb20oc291cmNlUmVsYXRpb25zaGlwKSB7XG4gICAgaWYgKCEoc291cmNlUmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX0gc291cmNlIHJlbGF0aW9uc2hpcCB0byBiZSBoYXMtbWFueWApXG4gICAgfVxuXG4gICAgLy8gTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgdGFyZ2V0IHJlbGF0aW9uc2hpcCdzIGRvY3VtZW50ZWQgbW9kZWwgdHlwZS5cbiAgICBjb25zdCBsb2FkZWRWYWx1ZSA9IC8qKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pn0gKi8gKHNvdXJjZVJlbGF0aW9uc2hpcC5sb2FkZWQoKSlcblxuICAgIHRoaXMuc2V0TG9hZGVkKGxvYWRlZFZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIHRvIGxvYWRlZC5cbiAgICogQHBhcmFtIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSBtb2RlbHMgLSBNb2RlbHMgdG8gYXBwZW5kLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZFRvTG9hZGVkKG1vZGVscykge1xuICAgIGNvbnN0IGxvYWRlZE1vZGVscyA9IHRoaXMuZ2V0UHJlbG9hZGVkKCkgPyB0aGlzLmxvYWRlZCgpIDogW11cblxuICAgIHRoaXMuc2V0TG9hZGVkKFsuLi5sb2FkZWRNb2RlbHMsIC4uLm1vZGVsc10pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZC5cbiAgICogQHBhcmFtIHtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzfSBbYXR0cmlidXRlc10gLSBOZXcgbW9kZWwgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPn0gLSBCdWlsdCBtb2RlbC5cbiAgICovXG4gIGJ1aWxkKGF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge1RhcmdldENyZWF0ZUF0dHJpYnV0ZXN9ICovICh7fSkpIHtcbiAgICBpZiAoIXRoaXMudGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcykgPT4gRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+fSAqLyAodGhpcy50YXJnZXRNb2RlbENsYXNzKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoYXR0cmlidXRlcylcblxuICAgIHRoaXMuYWRkVG9Mb2FkZWQoW21vZGVsXSlcblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIEZvcmNlLXJlbG9hZCB0aGUgcmVsYXRpb25zaGlwLiBXaGVuIHRoZSBwYXJlbnQgcmVjb3JkIHdhcyBsb2FkZWQgYXMgcGFydFxuICAgKiBvZiBhIGJhdGNoLCBzaWJsaW5ncyB0aGF0IGhhdmUgbm90IHByZWxvYWRlZCB0aGlzIHJlbGF0aW9uc2hpcCBnZXRcbiAgICogYmF0Y2hlZCBpbnRvIG9uZSByZXF1ZXN0IHZpYSB0aGUgY29ob3J0IHByZWxvYWRlci4gVGhlIHNjb3BlZCBxdWVyeSBwYXRoXG4gICAqIChgTW9kZWwud2hlcmUoLi4uKS5wcmVsb2FkKFtuYW1lXSkudG9BcnJheSgpYCBkaXJlY3RseSBmcm9tIHVzZXIgY29kZSlcbiAgICogYnlwYXNzZXMgY29ob3J0IGJhdGNoaW5nIGJ5IGRlc2lnbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBtb2RlbHMuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIC8vIFJlc2V0IHNvIHRoZSBjb2hvcnQgcHJlbG9hZGVyIChvciBzaW5nbGUtcmVjb3JkIGZhbGxiYWNrKSByZXBvcHVsYXRlcy5cbiAgICB0aGlzLl9wcmVsb2FkZWQgPSBmYWxzZVxuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gW11cblxuICAgIGNvbnN0IGJhdGNoZWQgPSBhd2FpdCB0aGlzLm1vZGVsLl90cnlDb2hvcnRQcmVsb2FkKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChiYXRjaGVkKSByZXR1cm4gdGhpcy5fbG9hZGVkVmFsdWVcblxuICAgIGF3YWl0IHRoaXMubW9kZWwubG9hZFJlbGF0aW9uc2hpcCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICByZXR1cm4gdGhpcy5sb2FkZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYXJyYXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj4+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgbW9kZWxzLlxuICAgKi9cbiAgYXN5bmMgdG9BcnJheSgpIHtcbiAgICBpZiAodGhpcy5nZXRQcmVsb2FkZWQoKSB8fCB0aGlzLl9sb2FkZWRWYWx1ZS5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gdGhpcy5fbG9hZGVkVmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkKClcbiAgfVxufVxuXG4vKipcbiAqIENvcGllcyBsb2FkZWQgcmVsYXRpb25zaGlwIHN0YXRlIGJldHdlZW4gaGVscGVycyBvZiB0aGUgc2FtZSByZWxhdGlvbnNoaXAgc2hhcGUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gYXJncy5zb3VyY2VSZWxhdGlvbnNoaXAgLSBTb3VyY2UgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gYXJncy50YXJnZXRSZWxhdGlvbnNoaXAgLSBUYXJnZXQgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBjb3B5TG9hZGVkUmVsYXRpb25zaGlwVmFsdWUoe3NvdXJjZVJlbGF0aW9uc2hpcCwgdGFyZ2V0UmVsYXRpb25zaGlwfSkge1xuICB0YXJnZXRSZWxhdGlvbnNoaXAuY29weUxvYWRlZEZyb20oc291cmNlUmVsYXRpb25zaGlwKVxufVxuXG4vKipcbiAqIFJ1bnMgcmVsYXRpb25zaGlwIHR5cGUgaXMgY29sbGVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBUeXBlIC0gUmVsYXRpb25zaGlwIHR5cGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlbGF0aW9uc2hpcCB0eXBlIGlzIGhhcy1tYW55LlxuICovXG5mdW5jdGlvbiByZWxhdGlvbnNoaXBUeXBlSXNDb2xsZWN0aW9uKHJlbGF0aW9uc2hpcFR5cGUpIHtcbiAgcmV0dXJuIHJlbGF0aW9uc2hpcFR5cGUgPT0gXCJoYXNNYW55XCJcbn1cblxuLyoqXG4gKiBEb3dubG9hZGVkIGZyb250ZW5kLW1vZGVsIGF0dGFjaG1lbnQgcGF5bG9hZCB3cmFwcGVyLlxuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREb3dubG9hZCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmlkIC0gQXR0YWNobWVudCBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmlsZW5hbWUgLSBGaWxlbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBhcmdzLmNvbnRlbnRUeXBlIC0gQ29udGVudCB0eXBlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5ieXRlU2l6ZSAtIEZpbGUgc2l6ZSBpbiBieXRlcy5cbiAgICogQHBhcmFtIHtVaW50OEFycmF5fSBhcmdzLmNvbnRlbnQgLSBGaWxlIGNvbnRlbnQgYnl0ZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gW2FyZ3MudXJsXSAtIFJlc29sdmFibGUgYXR0YWNobWVudCBVUkwuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Ynl0ZVNpemUsIGNvbnRlbnQsIGNvbnRlbnRUeXBlLCBmaWxlbmFtZSwgaWQsIHVybCA9IG51bGx9KSB7XG4gICAgdGhpcy5pZFZhbHVlID0gaWRcbiAgICB0aGlzLmZpbGVuYW1lVmFsdWUgPSBmaWxlbmFtZVxuICAgIHRoaXMuY29udGVudFR5cGVWYWx1ZSA9IGNvbnRlbnRUeXBlXG4gICAgdGhpcy5ieXRlU2l6ZVZhbHVlID0gYnl0ZVNpemVcbiAgICB0aGlzLmNvbnRlbnRWYWx1ZSA9IGNvbnRlbnRcbiAgICB0aGlzLnVybFZhbHVlID0gdXJsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBieXRlIHNpemUuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRmlsZSBzaXplIGluIGJ5dGVzLlxuICAgKi9cbiAgYnl0ZVNpemUoKSB7IHJldHVybiB0aGlzLmJ5dGVTaXplVmFsdWUgfVxuICAvKipcbiAgICogUnVucyBjb250ZW50LlxuICAgKiBAcmV0dXJucyB7VWludDhBcnJheX0gLSBGaWxlIGNvbnRlbnQgYnl0ZXMuXG4gICAqL1xuICBjb250ZW50KCkgeyByZXR1cm4gdGhpcy5jb250ZW50VmFsdWUgfVxuICAvKipcbiAgICogUnVucyBjb250ZW50IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIENvbnRlbnQgdHlwZS5cbiAgICovXG4gIGNvbnRlbnRUeXBlKCkgeyByZXR1cm4gdGhpcy5jb250ZW50VHlwZVZhbHVlIH1cbiAgLyoqXG4gICAqIFJ1bnMgZmlsZW5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRmlsZW5hbWUuXG4gICAqL1xuICBmaWxlbmFtZSgpIHsgcmV0dXJuIHRoaXMuZmlsZW5hbWVWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIGlkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgaWQuXG4gICAqL1xuICBpZCgpIHsgcmV0dXJuIHRoaXMuaWRWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIHVybC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmVzb2x2YWJsZSBhdHRhY2htZW50IFVSTC5cbiAgICovXG4gIHVybCgpIHsgcmV0dXJuIHRoaXMudXJsVmFsdWUgfVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgYXR0YWNobWVudCBjb21tYW5kIHBheWxvYWQuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxBdHRhY2htZW50SGFuZGxlfSBhdHRhY2htZW50IC0gQXR0YWNobWVudCB3cmFwcGVyLlxuICogQHBhcmFtIHtzdHJpbmd9IFthdHRhY2htZW50SWRdIC0gT3B0aW9uYWwgaGFzLW1hbnkgYXR0YWNobWVudCBpZC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ29tbWFuZCBwYXlsb2FkLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQXR0YWNobWVudENvbW1hbmRQYXlsb2FkKGF0dGFjaG1lbnQsIGF0dGFjaG1lbnRJZCkge1xuICAvKipcbiAgICogUGF5bG9hZC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICBhdHRhY2htZW50TmFtZTogYXR0YWNobWVudC5hdHRhY2htZW50TmFtZSxcbiAgICBpZDogYXR0YWNobWVudC5tb2RlbC5wcmltYXJ5S2V5VmFsdWUoKVxuICB9XG5cbiAgaWYgKGF0dGFjaG1lbnRJZCkgcGF5bG9hZC5hdHRhY2htZW50SWQgPSBhdHRhY2htZW50SWRcblxuICByZXR1cm4gcGF5bG9hZFxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGNhbm9uaWNhbCBiYWNraW5nIG93bmVyIHVzZWQgYnkgYXR0YWNobWVudCBtZXRhZGF0YSBzdG9yYWdlLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBGcm9udGVuZCBhdHRhY2htZW50IG93bmVyLlxuICogQHJldHVybnMge3tyZWNvcmRJZDogc3RyaW5nLCByZWNvcmRUeXBlOiBzdHJpbmcsIHJlc291cmNlTmFtZTogc3RyaW5nfX0gLSBDYW5vbmljYWwgYXR0YWNobWVudCBvd25lciBhbmQgb3JpZ2luYXRpbmcgcmVzb3VyY2UuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxBdHRhY2htZW50T3duZXIobW9kZWwpIHtcbiAgaWYgKCFtb2RlbC5fYXR0YWNobWVudE93bmVyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIGF0dGFjaG1lbnQgb3duZXIgbWV0YWRhdGEgb24gJHtmcm9udGVuZE1vZGVsQ2xhc3NGb3IobW9kZWwpLm5hbWV9YClcbiAgfVxuXG4gIHJldHVybiBtb2RlbC5fYXR0YWNobWVudE93bmVyXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IHZhbHVlIGlzIGJ5dGVzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHZhbHVlIGxvb2tzIGxpa2UgYnl0ZSBkYXRhLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzQnl0ZXModmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlIGluc3RhbmNlb2YgVWludDhBcnJheSB8fCB2YWx1ZSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyIHx8ICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiICYmIEJ1ZmZlci5pc0J1ZmZlcih2YWx1ZSkpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IHZhbHVlIHN1cHBvcnRzIGFycmF5IGJ1ZmZlci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge3ZhbHVlIGlzIHthcnJheUJ1ZmZlcjogKCkgPT4gUHJvbWlzZTxBcnJheUJ1ZmZlcj59fSAtIFdoZXRoZXIgY2FuZGlkYXRlIHN1cHBvcnRzIGFycmF5QnVmZmVyKCkuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudFZhbHVlU3VwcG9ydHNBcnJheUJ1ZmZlcih2YWx1ZSkge1xuICByZXR1cm4gQm9vbGVhbih2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh2YWx1ZSkuYXJyYXlCdWZmZXIgPT09IFwiZnVuY3Rpb25cIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgbm9ybWFsaXplIGJ5dGVzLlxuICogQHBhcmFtIHtVaW50OEFycmF5IHwgQnVmZmVyIHwgQXJyYXlCdWZmZXJ9IHZhbHVlIC0gQnl0ZS1saWtlIHZhbHVlLlxuICogQHJldHVybnMge1VpbnQ4QXJyYXl9IC0gVWludDhBcnJheSBieXRlcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50Tm9ybWFsaXplQnl0ZXModmFsdWUpIHtcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgVWludDhBcnJheSkgcmV0dXJuIHZhbHVlXG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSByZXR1cm4gbmV3IFVpbnQ4QXJyYXkodmFsdWUpXG4gIGlmICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiICYmIEJ1ZmZlci5pc0J1ZmZlcigvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodmFsdWUpKSkge1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheSgvKiogQHR5cGUge0J1ZmZlcn0gKi8gKHZhbHVlKSlcbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIGF0dGFjaG1lbnQgYnl0ZXMgdmFsdWVcIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgYnl0ZXMgdG8gYmFzZTY0LlxuICogQHBhcmFtIHtVaW50OEFycmF5fSBieXRlcyAtIEJ5dGVzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBCYXNlNjQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudEJ5dGVzVG9CYXNlNjQoYnl0ZXMpIHtcbiAgaWYgKHR5cGVvZiBCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICByZXR1cm4gQnVmZmVyLmZyb20oYnl0ZXMpLnRvU3RyaW5nKFwiYmFzZTY0XCIpXG4gIH1cblxuICBsZXQgYmluYXJ5ID0gXCJcIlxuXG4gIGZvciAoY29uc3QgYnl0ZSBvZiBieXRlcykge1xuICAgIGJpbmFyeSArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGUpXG4gIH1cblxuICBpZiAodHlwZW9mIGJ0b2EgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiTWlzc2luZyBiYXNlNjQgZW5jb2RlclwiKVxuXG4gIHJldHVybiBidG9hKGJpbmFyeSlcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgYmFzZTY0IHRvIGJ5dGVzLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gQmFzZTY0IHZhbHVlLlxuICogQHJldHVybnMge1VpbnQ4QXJyYXl9IC0gRGVjb2RlZCBieXRlcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50QmFzZTY0VG9CeXRlcyh2YWx1ZSkge1xuICBpZiAodHlwZW9mIEJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheShCdWZmZXIuZnJvbSh2YWx1ZSwgXCJiYXNlNjRcIikpXG4gIH1cblxuICBpZiAodHlwZW9mIGF0b2IgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiTWlzc2luZyBiYXNlNjQgZGVjb2RlclwiKVxuXG4gIGNvbnN0IGJpbmFyeSA9IGF0b2IodmFsdWUpXG4gIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYmluYXJ5Lmxlbmd0aClcblxuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgYmluYXJ5Lmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGJ5dGVzW2luZGV4XSA9IGJpbmFyeS5jaGFyQ29kZUF0KGluZGV4KVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVzXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IHZhbHVlIGlzIHBsYWluIG9iamVjdC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge3ZhbHVlIGlzIFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBXaGV0aGVyIHZhbHVlIGlzIHBsYWluIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICBjb25zdCBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpXG5cbiAgcmV0dXJuIHByb3RvdHlwZSA9PT0gT2JqZWN0LnByb3RvdHlwZSB8fCBwcm90b3R5cGUgPT09IG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHBheWxvYWQgY29udGFpbnMgYXR0YWNobWVudCB1cGxvYWQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFBheWxvYWQgY2FuZGlkYXRlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBwYXlsb2FkIGNvbnRhaW5zIGFuIGF0dGFjaG1lbnQgdXBsb2FkIGJvZHkuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxQYXlsb2FkQ29udGFpbnNBdHRhY2htZW50VXBsb2FkKHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcblxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gdmFsdWUuc29tZSgoZW50cnkpID0+IGZyb250ZW5kTW9kZWxQYXlsb2FkQ29udGFpbnNBdHRhY2htZW50VXBsb2FkKGVudHJ5KSlcbiAgfVxuXG4gIGlmICghZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KHZhbHVlKSkgcmV0dXJuIGZhbHNlXG5cbiAgaWYgKHR5cGVvZiB2YWx1ZS5jb250ZW50QmFzZTY0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIHJldHVybiBPYmplY3QudmFsdWVzKHZhbHVlKS5zb21lKChlbnRyeSkgPT4gZnJvbnRlbmRNb2RlbFBheWxvYWRDb250YWluc0F0dGFjaG1lbnRVcGxvYWQoZW50cnkpKVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGNvbmNyZXRlIGZyb250ZW5kLW1vZGVsIGNsYXNzIGZvciBhbiBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gRnJvbnRlbmQgbW9kZWwgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbENsYXNzfSBDb25jcmV0ZSBmcm9udGVuZC1tb2RlbCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbENsYXNzRm9yKG1vZGVsKSB7XG4gIGNvbnN0IGNvbnN0cnVjdG9yVmFsdWUgPSBtb2RlbC5jb25zdHJ1Y3RvclxuXG4gIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxDbGFzc30gKi8gKGNvbnN0cnVjdG9yVmFsdWUpXG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgY29uZmlndXJlZCBvZmZsaW5lIHF1ZXVlIHNob3VsZCBoYW5kbGUgYSBtb2RlbCBvcGVyYXRpb24uXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBvcGVyYXRpb24gLSBTeW5jIG9wZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdG8gcXVldWUgbG9jYWxseS5cbiAqL1xuZnVuY3Rpb24gc2hvdWxkUXVldWVGcm9udGVuZE1vZGVsT3BlcmF0aW9uT2ZmbGluZShNb2RlbENsYXNzLCBvcGVyYXRpb24pIHtcbiAgY29uc3Qgb2ZmbGluZVN5bmMgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jXG5cbiAgaWYgKCFvZmZsaW5lU3luYz8uZW5hYmxlZCkgcmV0dXJuIGZhbHNlXG5cbiAgY29uc3Qgc3luY0NvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKS5zeW5jXG5cbiAgaWYgKCFzeW5jQ29uZmlnPy5lbmFibGVkKSByZXR1cm4gZmFsc2VcbiAgaWYgKCFzeW5jQ29uZmlnLm9wZXJhdGlvbnMuaW5jbHVkZXMob3BlcmF0aW9uKSkgdGhyb3cgbmV3IEVycm9yKGBPZmZsaW5lIHN5bmMgZm9yICR7TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gZG9lcyBub3QgYWxsb3cgJHtvcGVyYXRpb259YClcblxuICByZXR1cm4gdHJ1ZVxufVxuXG4vKipcbiAqIFF1ZXVlcyBhbiBvZmZsaW5lIHN5bmMgbXV0YXRpb24uXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gYXJncy5hdHRyaWJ1dGVzIC0gTXV0YXRpb24gYXR0cmlidXRlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5jbGllbnRNdXRhdGlvbklkXSAtIFByZS1nZW5lcmF0ZWQgbXV0YXRpb24gaWQuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gYXJncy5Nb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFyZ3Mub3BlcmF0aW9uIC0gU3luYyBvcGVyYXRpb24uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIENsaWVudCBtdXRhdGlvbiBpZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcXVldWVGcm9udGVuZE1vZGVsTXV0YXRpb25PZmZsaW5lKHthdHRyaWJ1dGVzLCBjbGllbnRNdXRhdGlvbklkOiBwcm92aWRlZENsaWVudE11dGF0aW9uSWQsIE1vZGVsQ2xhc3MsIG9wZXJhdGlvbn0pIHtcbiAgY29uc3Qgb2ZmbGluZVN5bmMgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jXG5cbiAgaWYgKCFvZmZsaW5lU3luYykgdGhyb3cgbmV3IEVycm9yKFwiT2ZmbGluZSBzeW5jIGlzIG5vdCBjb25maWd1cmVkXCIpXG5cbiAgY29uc3Qgc3luY0NvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKS5zeW5jXG4gIGlmICghc3luY0NvbmZpZz8uZW5hYmxlZCkgdGhyb3cgbmV3IEVycm9yKGBPZmZsaW5lIHN5bmMgaXMgbm90IGVuYWJsZWQgZm9yICR7TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gKVxuXG4gIGNvbnN0IG5vdyA9IG9mZmxpbmVTeW5jLm5vdyA/IG9mZmxpbmVTeW5jLm5vdygpIDogbmV3IERhdGUoKVxuICBpZiAoIShub3cgaW5zdGFuY2VvZiBEYXRlKSB8fCBOdW1iZXIuaXNOYU4obm93LmdldFRpbWUoKSkpIHRocm93IG5ldyBFcnJvcihcIm9mZmxpbmVTeW5jLm5vdyBtdXN0IHJldHVybiBhIHZhbGlkIERhdGVcIilcblxuICBjb25zdCBjbGllbnRNdXRhdGlvbklkID0gcHJvdmlkZWRDbGllbnRNdXRhdGlvbklkIHx8IChvZmZsaW5lU3luYy5jbGllbnRNdXRhdGlvbklkID8gb2ZmbGluZVN5bmMuY2xpZW50TXV0YXRpb25JZCgpIDogZnJvbnRlbmRNb2RlbE9mZmxpbmVNdXRhdGlvbklkKCkpXG4gIGlmICh0eXBlb2YgY2xpZW50TXV0YXRpb25JZCAhPT0gXCJzdHJpbmdcIiB8fCBjbGllbnRNdXRhdGlvbklkLmxlbmd0aCA8IDEpIHRocm93IG5ldyBFcnJvcihcIm9mZmxpbmVTeW5jLmNsaWVudE11dGF0aW9uSWQgbXVzdCByZXR1cm4gYSBub24tZW1wdHkgc3RyaW5nXCIpXG5cbiAgYXdhaXQgb2ZmbGluZVN5bmMubXV0YXRpb25Mb2cuYXBwZW5kKHtcbiAgICBtdXRhdGlvbjoge1xuICAgICAgYWN0b3JEZXZpY2VJZDogb2ZmbGluZVN5bmMuYWN0b3JEZXZpY2VJZCxcbiAgICAgIGFjdG9yVXNlcklkOiBvZmZsaW5lU3luYy5hY3RvclVzZXJJZCxcbiAgICAgIGF0dHJpYnV0ZXM6IGZyb250ZW5kTW9kZWxTeW5jSnNvbk9iamVjdChhdHRyaWJ1dGVzKSxcbiAgICAgIGJhc2VWZXJzaW9uOiBudWxsLFxuICAgICAgY2xpZW50TXV0YXRpb25JZCxcbiAgICAgIG1vZGVsOiBNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgb2NjdXJyZWRBdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICBvZmZsaW5lR3JhbnRJZDogb2ZmbGluZVN5bmMub2ZmbGluZUdyYW50LmlkLFxuICAgICAgb3BlcmF0aW9uLFxuICAgICAgcG9saWN5SGFzaDogc3luY0NvbmZpZy5wb2xpY3lIYXNoXG4gICAgfVxuICB9KVxuXG4gIHJldHVybiBjbGllbnRNdXRhdGlvbklkXG59XG5cbi8qKlxuICogR2VuZXJhdGVzIGEgZnJvbnRlbmQtbW9kZWwgb2ZmbGluZSBtdXRhdGlvbiBpZC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTG9jYWwgbXV0YXRpb24gaWQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxPZmZsaW5lTXV0YXRpb25JZCgpIHtcbiAgaWYgKGdsb2JhbFRoaXMuY3J5cHRvICYmIHR5cGVvZiBnbG9iYWxUaGlzLmNyeXB0by5yYW5kb21VVUlEID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiBnbG9iYWxUaGlzLmNyeXB0by5yYW5kb21VVUlEKClcblxuICByZXR1cm4gYGZyb250ZW5kLW11dGF0aW9uLSR7RGF0ZS5ub3coKX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX1gXG59XG5cbi8qKlxuICogQ29udmVydHMgbW9kZWwgYXR0cmlidXRlcyB0byBzeW5jLXNhZmUgSlNPTiBwYXlsb2FkIHZhbHVlcy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gYXR0cmlidXRlcyAtIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZXMuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59IC0gU3luYy1zYWZlIGF0dHJpYnV0ZXMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxTeW5jSnNvbk9iamVjdChhdHRyaWJ1dGVzKSB7XG4gIGNvbnN0IHNlcmlhbGl6ZWQgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGF0dHJpYnV0ZXMpKVxuXG4gIGlmICghc2VyaWFsaXplZCB8fCB0eXBlb2Ygc2VyaWFsaXplZCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHNlcmlhbGl6ZWQpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBzeW5jIG11dGF0aW9uIGF0dHJpYnV0ZXMgb2JqZWN0XCIpXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59ICovIChzZXJpYWxpemVkKVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIGF0dGFjaG1lbnQgaW5wdXQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBpbnB1dCAtIEF0dGFjaG1lbnQgaW5wdXQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFRyYW5zcG9ydC1zYWZlIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQoaW5wdXQpIHtcbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChpbnB1dCkgJiYgXCJmaWxlXCIgaW4gaW5wdXQpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRmlsZSA9IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0LmZpbGUpXG4gICAgY29uc3QgbWVyZ2VkID0ge1xuICAgICAgLi4ubm9ybWFsaXplZEZpbGVcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGlucHV0LmZpbGVuYW1lID09PSBcInN0cmluZ1wiICYmIGlucHV0LmZpbGVuYW1lLmxlbmd0aCA+IDApIG1lcmdlZC5maWxlbmFtZSA9IGlucHV0LmZpbGVuYW1lXG4gICAgaWYgKHR5cGVvZiBpbnB1dC5jb250ZW50VHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5jb250ZW50VHlwZS5sZW5ndGggPiAwKSBtZXJnZWQuY29udGVudFR5cGUgPSBpbnB1dC5jb250ZW50VHlwZVxuXG4gICAgcmV0dXJuIG1lcmdlZFxuICB9XG5cbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChpbnB1dCkpIHtcbiAgICBpZiAodHlwZW9mIGlucHV0LnBhdGggPT09IFwic3RyaW5nXCIgJiYgaW5wdXQucGF0aC5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdHRhY2htZW50IHBhdGggaW5wdXQgaXMgbm90IHN1cHBvcnRlZCBpbiBmcm9udGVuZCBtb2RlbHNcIilcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGlucHV0LmNvbnRlbnRCYXNlNjQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvbnRlbnRCYXNlNjQ6IGlucHV0LmNvbnRlbnRCYXNlNjQsXG4gICAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgaW5wdXQuY29udGVudFR5cGUgPT09IFwic3RyaW5nXCIgJiYgaW5wdXQuY29udGVudFR5cGUubGVuZ3RoID4gMCA/IGlucHV0LmNvbnRlbnRUeXBlIDogbnVsbCxcbiAgICAgICAgZmlsZW5hbWU6IHR5cGVvZiBpbnB1dC5maWxlbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5maWxlbmFtZS5sZW5ndGggPiAwID8gaW5wdXQuZmlsZW5hbWUgOiB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpZiAoZnJvbnRlbmRBdHRhY2htZW50VmFsdWVTdXBwb3J0c0FycmF5QnVmZmVyKGlucHV0KSkge1xuICAgIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYXdhaXQgaW5wdXQuYXJyYXlCdWZmZXIoKSlcblxuICAgIHJldHVybiB7XG4gICAgICBjb250ZW50QmFzZTY0OiBmcm9udGVuZEF0dGFjaG1lbnRCeXRlc1RvQmFzZTY0KGJ5dGVzKSxcbiAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS50eXBlID09PSBcInN0cmluZ1wiICYmIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkudHlwZS5sZW5ndGggPiAwXG4gICAgICAgID8gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS50eXBlXG4gICAgICAgIDogbnVsbCxcbiAgICAgIGZpbGVuYW1lOiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS5uYW1lID09PSBcInN0cmluZ1wiICYmIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkubmFtZS5sZW5ndGggPiAwXG4gICAgICAgID8gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS5uYW1lXG4gICAgICAgIDogXCJhdHRhY2htZW50LmJpblwiXG4gICAgfVxuICB9XG5cbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNCeXRlcyhpbnB1dCkpIHtcbiAgICBjb25zdCBieXRlcyA9IGZyb250ZW5kQXR0YWNobWVudE5vcm1hbGl6ZUJ5dGVzKC8qKiBAdHlwZSB7VWludDhBcnJheSB8IEJ1ZmZlciB8IEFycmF5QnVmZmVyfSAqLyAoaW5wdXQpKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnRlbnRCYXNlNjQ6IGZyb250ZW5kQXR0YWNobWVudEJ5dGVzVG9CYXNlNjQoYnl0ZXMpLFxuICAgICAgY29udGVudFR5cGU6IG51bGwsXG4gICAgICBmaWxlbmFtZTogXCJhdHRhY2htZW50LmJpblwiXG4gICAgfVxuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiVW5zdXBwb3J0ZWQgZnJvbnRlbmQgYXR0YWNobWVudCBpbnB1dFwiKVxufVxuXG4vKipcbiAqIEZyb250ZW5kLW1vZGVsIGF0dGFjaG1lbnQgaGVscGVyIGZvciBvbmUgYXR0YWNobWVudCBuYW1lLlxuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGUge1xuICAvKipcbiAgICogUGVuZGluZyBhdHRhY2htZW50IGlucHV0cyBxdWV1ZWQgZm9yIHRoZSBuZXh0IG1vZGVsIHNhdmUuXG4gICAqIEB0eXBlIHtGcm9udGVuZE1vZGVsQXR0YWNobWVudElucHV0W119XG4gICAqL1xuICBwZW5kaW5nSW5wdXRzID0gW11cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2F0dGFjaG1lbnROYW1lLCBtb2RlbH0pIHtcbiAgICB0aGlzLm1vZGVsID0gbW9kZWxcbiAgICB0aGlzLmF0dGFjaG1lbnROYW1lID0gYXR0YWNobWVudE5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZSBhdHRhY2htZW50IGlucHV0IGZvciB0aGUgcGFyZW50IG1vZGVsJ3MgbmV4dCBzYXZlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxBdHRhY2htZW50SW5wdXQgfCBGcm9udGVuZE1vZGVsQXR0YWNobWVudElucHV0W119IGlucHV0IC0gQXR0YWNobWVudCBpbnB1dC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBxdWV1ZUF0dGFjaChpbnB1dCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24odGhpcy5hdHRhY2htZW50TmFtZSlcblxuICAgIGlmIChhdHRhY2htZW50RGVmaW5pdGlvbj8udHlwZSA9PT0gXCJoYXNPbmVcIikge1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoaW5wdXQpKSB7XG4gICAgICAgIGNvbnN0IGxhc3RJbnB1dCA9IGlucHV0W2lucHV0Lmxlbmd0aCAtIDFdXG5cbiAgICAgICAgdGhpcy5wZW5kaW5nSW5wdXRzID0gdHlwZW9mIGxhc3RJbnB1dCA9PT0gXCJ1bmRlZmluZWRcIiA/IFtdIDogW2xhc3RJbnB1dF1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucGVuZGluZ0lucHV0cyA9IFtpbnB1dF1cbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGlucHV0KSkge1xuICAgICAgdGhpcy5wZW5kaW5nSW5wdXRzLnB1c2goLi4uaW5wdXQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucGVuZGluZ0lucHV0cy5wdXNoKGlucHV0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoaXMgYXR0YWNobWVudCBoYXMgcXVldWVkIGlucHV0cyBmb3IgdGhlIG5leHQgbW9kZWwgc2F2ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgYW55IHBlbmRpbmcgaW5wdXRzIGV4aXN0LlxuICAgKi9cbiAgaGFzUGVuZGluZ0F0dGFjaG1lbnRzKCkge1xuICAgIHJldHVybiB0aGlzLnBlbmRpbmdJbnB1dHMubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgc2F2ZSBwYXlsb2FkIGZvciBxdWV1ZWQgYXR0YWNobWVudCBpbnB1dHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdIHwgdW5kZWZpbmVkPn0gTm9ybWFsaXplZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBwZW5kaW5nQXR0YWNobWVudHNQYXlsb2FkKCkge1xuICAgIGlmICh0aGlzLnBlbmRpbmdJbnB1dHMubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKHRoaXMuYXR0YWNobWVudE5hbWUpXG5cbiAgICBpZiAoYXR0YWNobWVudERlZmluaXRpb24/LnR5cGUgPT09IFwiaGFzTWFueVwiKSB7XG4gICAgICByZXR1cm4gYXdhaXQgUHJvbWlzZS5hbGwodGhpcy5wZW5kaW5nSW5wdXRzLm1hcChhc3luYyAoaW5wdXQpID0+IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0KSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KHRoaXMucGVuZGluZ0lucHV0c1t0aGlzLnBlbmRpbmdJbnB1dHMubGVuZ3RoIC0gMV0pXG4gIH1cblxuICAvKiogQ2xlYXJzIHF1ZXVlZCBhdHRhY2htZW50IGlucHV0cyBhZnRlciBhIHN1Y2Nlc3NmdWwgbW9kZWwgc2F2ZS4gKi9cbiAgY2xlYXJQZW5kaW5nQXR0YWNobWVudHMoKSB7XG4gICAgdGhpcy5wZW5kaW5nSW5wdXRzID0gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gaW5wdXQgLSBBdHRhY2htZW50IGlucHV0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGF0dGFjaGVkLlxuICAgKi9cbiAgYXN5bmMgYXR0YWNoKGlucHV0KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWRJbnB1dCA9IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0KVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcImF0dGFjaFwiLCB7XG4gICAgICBhdHRhY2htZW50OiBub3JtYWxpemVkSW5wdXQsXG4gICAgICBhdHRhY2htZW50TmFtZTogdGhpcy5hdHRhY2htZW50TmFtZSxcbiAgICAgIGlkOiB0aGlzLm1vZGVsLnByaW1hcnlLZXlWYWx1ZSgpXG4gICAgfSlcblxuICAgIHRoaXMubW9kZWwuYXNzaWduQXR0cmlidXRlcyhNb2RlbENsYXNzLmF0dHJpYnV0ZXNGcm9tUmVzcG9uc2UocmVzcG9uc2UpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZG93bmxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXR0YWNobWVudElkXSAtIE9wdGlvbmFsIGF0dGFjaG1lbnQgaWQgZm9yIGhhcy1tYW55IGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZE1vZGVsQXR0YWNobWVudERvd25sb2FkIHwgbnVsbD59IC0gRG93bmxvYWRlZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBkb3dubG9hZChhdHRhY2htZW50SWQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiZG93bmxvYWRcIiwgZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb21tYW5kUGF5bG9hZCh0aGlzLCBhdHRhY2htZW50SWQpKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRQYXlsb2FkID0gcmVzcG9uc2UuYXR0YWNobWVudFxuXG4gICAgaWYgKCFhdHRhY2htZW50UGF5bG9hZCB8fCB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQgIT09IFwib2JqZWN0XCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBjb250ZW50QmFzZTY0ID0gdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRCYXNlNjQgPT09IFwic3RyaW5nXCIgPyBhdHRhY2htZW50UGF5bG9hZC5jb250ZW50QmFzZTY0IDogXCJcIlxuICAgIGNvbnN0IGNvbnRlbnQgPSBmcm9udGVuZEF0dGFjaG1lbnRCYXNlNjRUb0J5dGVzKGNvbnRlbnRCYXNlNjQpXG4gICAgY29uc3QgYnl0ZVNpemUgPSBOdW1iZXIoYXR0YWNobWVudFBheWxvYWQuYnl0ZVNpemUpXG5cbiAgICByZXR1cm4gbmV3IEZyb250ZW5kTW9kZWxBdHRhY2htZW50RG93bmxvYWQoe1xuICAgICAgYnl0ZVNpemU6IE51bWJlci5pc0Zpbml0ZShieXRlU2l6ZSkgPyBieXRlU2l6ZSA6IGNvbnRlbnQubGVuZ3RoLFxuICAgICAgY29udGVudCxcbiAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQuY29udGVudFR5cGUgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudFBheWxvYWQuY29udGVudFR5cGUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRUeXBlIDogbnVsbCxcbiAgICAgIGZpbGVuYW1lOiB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQuZmlsZW5hbWUgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudFBheWxvYWQuZmlsZW5hbWUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnRQYXlsb2FkLmZpbGVuYW1lIDogXCJhdHRhY2htZW50LmJpblwiLFxuICAgICAgaWQ6IHR5cGVvZiBhdHRhY2htZW50UGF5bG9hZC5pZCA9PT0gXCJzdHJpbmdcIiA/IGF0dGFjaG1lbnRQYXlsb2FkLmlkIDogXCJcIixcbiAgICAgIHVybDogdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLnVybCA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50UGF5bG9hZC51cmwubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnRQYXlsb2FkLnVybCA6IG51bGxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXJsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2F0dGFjaG1lbnRJZF0gLSBPcHRpb25hbCBhdHRhY2htZW50IGlkIGZvciBoYXMtbWFueSBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gUmVzb2x2YWJsZSBhdHRhY2htZW50IFVSTC5cbiAgICovXG4gIGFzeW5jIHVybChhdHRhY2htZW50SWQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwidXJsXCIsIGZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29tbWFuZFBheWxvYWQodGhpcywgYXR0YWNobWVudElkKSlcblxuICAgIGlmICh0eXBlb2YgcmVzcG9uc2UudXJsID09PSBcInN0cmluZ1wiICYmIHJlc3BvbnNlLnVybC5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gcmVzcG9uc2UudXJsXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBxdWVyeSBmb3IgdGhpcyBhdHRhY2htZW50IGhhbmRsZSdzIG1ldGFkYXRhIHJvd3MuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIFZlbG9jaW91c0F0dGFjaG1lbnQ+fSAtIEF0dGFjaG1lbnQgbWV0YWRhdGEgcXVlcnkuXG4gICAqL1xuICBxdWVyeSgpIHtcbiAgICBjb25zdCBhdHRhY2htZW50T3duZXIgPSBmcm9udGVuZE1vZGVsQXR0YWNobWVudE93bmVyKHRoaXMubW9kZWwpXG5cbiAgICByZXR1cm4gVmVsb2Npb3VzQXR0YWNobWVudFxuICAgICAgLndoZXJlKHtcbiAgICAgICAgbmFtZTogdGhpcy5hdHRhY2htZW50TmFtZSxcbiAgICAgICAgcmVjb3JkSWQ6IGF0dGFjaG1lbnRPd25lci5yZWNvcmRJZCxcbiAgICAgICAgcmVjb3JkVHlwZTogYXR0YWNobWVudE93bmVyLnJlY29yZFR5cGUsXG4gICAgICAgIHJlc291cmNlTmFtZTogYXR0YWNobWVudE93bmVyLnJlc291cmNlTmFtZVxuICAgICAgfSlcbiAgICAgIC5vcmRlcihbW1wicG9zaXRpb25cIiwgXCJhc2NcIl1dKVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGFsbCBhdHRhY2htZW50IG1ldGFkYXRhIHJvd3MgZm9yIHRoaXMgaGFuZGxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxWZWxvY2lvdXNBdHRhY2htZW50W10+fSAtIEF0dGFjaG1lbnQgbWV0YWRhdGEgcm93cy5cbiAgICovXG4gIGFzeW5jIHRvQXJyYXkoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS50b0FycmF5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgZmlyc3QgYXR0YWNobWVudCBtZXRhZGF0YSByb3cgZm9yIHRoaXMgaGFuZGxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxWZWxvY2lvdXNBdHRhY2htZW50IHwgbnVsbD59IC0gRmlyc3QgYXR0YWNobWVudCBtZXRhZGF0YSByb3cuXG4gICAqL1xuICBhc3luYyBmaXJzdCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpcnN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxpc3QuIFJldHVybnMgbWV0YWRhdGEgZm9yIGV2ZXJ5IGF0dGFjaG1lbnQgdW5kZXIgdGhpcyBhdHRhY2htZW50IG5hbWVcbiAgICogKG5vIGNvbnRlbnQgYnl0ZXMpLCBzbyBjYWxsZXJzIGNhbiBlbnVtZXJhdGUgaGFzLW1hbnkgYXR0YWNobWVudHMgYW5kIHRoZW5cbiAgICogZG93bmxvYWQgb3IgbGluayB0byBlYWNoIG9uZSBieSBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8e2J5dGVTaXplOiBudW1iZXIsIGNvbnRlbnRUeXBlOiBzdHJpbmcgfCBudWxsLCBmaWxlbmFtZTogc3RyaW5nLCBpZDogc3RyaW5nLCB1cmw6IHN0cmluZyB8IG51bGx9Pj59IC0gQXR0YWNobWVudCBtZXRhZGF0YSBlbnRyaWVzLlxuICAgKi9cbiAgYXN5bmMgbGlzdCgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiYXR0YWNobWVudExpc3RcIiwgZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb21tYW5kUGF5bG9hZCh0aGlzKSlcbiAgICBjb25zdCBhdHRhY2htZW50cyA9IEFycmF5LmlzQXJyYXkocmVzcG9uc2UuYXR0YWNobWVudHMpID8gcmVzcG9uc2UuYXR0YWNobWVudHMgOiBbXVxuXG4gICAgcmV0dXJuIGF0dGFjaG1lbnRzLm1hcCgoYXR0YWNobWVudCkgPT4ge1xuICAgICAgY29uc3QgYnl0ZVNpemUgPSBOdW1iZXIoYXR0YWNobWVudC5ieXRlU2l6ZSlcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYnl0ZVNpemU6IE51bWJlci5pc0Zpbml0ZShieXRlU2l6ZSkgPyBieXRlU2l6ZSA6IDAsXG4gICAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgYXR0YWNobWVudC5jb250ZW50VHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50LmNvbnRlbnRUeXBlLmxlbmd0aCA+IDAgPyBhdHRhY2htZW50LmNvbnRlbnRUeXBlIDogbnVsbCxcbiAgICAgICAgZmlsZW5hbWU6IHR5cGVvZiBhdHRhY2htZW50LmZpbGVuYW1lID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnQuZmlsZW5hbWUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnQuZmlsZW5hbWUgOiBcImF0dGFjaG1lbnQuYmluXCIsXG4gICAgICAgIGlkOiB0eXBlb2YgYXR0YWNobWVudC5pZCA9PT0gXCJzdHJpbmdcIiA/IGF0dGFjaG1lbnQuaWQgOiBcIlwiLFxuICAgICAgICB1cmw6IHR5cGVvZiBhdHRhY2htZW50LnVybCA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50LnVybC5sZW5ndGggPiAwID8gYXR0YWNobWVudC51cmwgOiBudWxsXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRvd25sb2FkIHVybC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEb3dubG9hZCBVUkwgZm9yIHRoaXMgYXR0YWNobWVudCBvbiB0aGUgY29uZmlndXJlZCBiYWNrZW5kLlxuICAgKi9cbiAgZG93bmxvYWRVcmwoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IGNvbW1hbmROYW1lID0gTW9kZWxDbGFzcy5jb21tYW5kTmFtZShcImRvd25sb2FkXCIpXG4gICAgY29uc3QgcmVzb3VyY2VQYXRoID0gTW9kZWxDbGFzcy5yZXNvdXJjZVBhdGgoKVxuICAgIGNvbnN0IGNvbW1hbmRVcmwgPSBmcm9udGVuZE1vZGVsQ29tbWFuZFVybChyZXNvdXJjZVBhdGgsIGNvbW1hbmROYW1lKVxuICAgIGNvbnN0IHBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xuICAgICAgYXR0YWNobWVudE5hbWU6IHRoaXMuYXR0YWNobWVudE5hbWUsXG4gICAgICBpZDogbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIHRoaXMubW9kZWwucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgfSlcblxuICAgIHJldHVybiBgJHtjb21tYW5kVXJsfT8ke3BhcmFtcy50b1N0cmluZygpfWBcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB1cmwuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZCB8IG51bGx9IHZhbHVlIC0gVVJMIGNhbmRpZGF0ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9ybWFsaXplZCBVUkwgd2l0aG91dCB0cmFpbGluZyBzbGFzaC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybCh2YWx1ZSkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiKSByZXR1cm4gXCJcIlxuXG4gIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKClcblxuICBpZiAoIXRyaW1tZWQubGVuZ3RoKSByZXR1cm4gXCJcIlxuXG4gIHJldHVybiB0cmltbWVkLnJlcGxhY2UoL1xcLyskLywgXCJcIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB1cmwuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlc29sdmVkIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCBVUkwuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRVcmwoKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRVcmwgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy51cmwgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy51cmwoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy51cmxcblxuICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybChjb25maWd1cmVkVXJsKVxufVxuXG4vKipcbiAqIFJ1bnMgY2xvbmUgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlcy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB2YWx1ZSAtIEF0dHJpYnV0ZXMgaGFzaC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2xvbmVkIGF0dHJpYnV0ZXMgaGFzaC5cbiAqL1xuZnVuY3Rpb24gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyh2YWx1ZSkge1xuICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUodmFsdWUpKSlcbn1cblxuLyoqXG4gKiBTaGFyZWQgY2hhbm5lbCBuYW1lIGZvciBtb2RlbCBsaWZlY3ljbGUgZXZlbnRzIChQaGFzZSAzKS5cbiAqIE1hdGNoZXMgdGhlIGJhY2tlbmQgYEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUVgLlxuICovXG5jb25zdCBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FID0gXCJmcm9udGVuZC1tb2RlbHNcIlxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgZnJvbnRlbmQgbW9kZWwgZXZlbnQgcHJlbG9hZC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSB0YXJnZXQgLSBUYXJnZXQgcHJlbG9hZCBwYXlsb2FkLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IHNvdXJjZSAtIFNvdXJjZSBwcmVsb2FkIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRQcmVsb2FkKHRhcmdldCwgc291cmNlKSB7XG4gIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2UpKSB7XG4gICAgY29uc3QgZXhpc3RpbmdWYWx1ZSA9IHRhcmdldFtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgaWYgKHZhbHVlID09PSB0cnVlIHx8IHZhbHVlID09PSBmYWxzZSkge1xuICAgICAgaWYgKGV4aXN0aW5nVmFsdWUgPT09IHVuZGVmaW5lZCkgdGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdID0gdmFsdWVcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRhcmdldFtyZWxhdGlvbnNoaXBOYW1lXSA9IHZhbHVlXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICghZXhpc3RpbmdWYWx1ZSB8fCB0eXBlb2YgZXhpc3RpbmdWYWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGV4aXN0aW5nVmFsdWUpKSB7XG4gICAgICB0YXJnZXRbcmVsYXRpb25zaGlwTmFtZV0gPSB7fVxuICAgIH1cblxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50UHJlbG9hZChcbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAodGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdKSxcbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAodmFsdWUpXG4gICAgKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBtZXJnZSBmcm9udGVuZCBtb2RlbCBldmVudCBzZWxlY3QuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gdGFyZ2V0IC0gVGFyZ2V0IHNlbGVjdCBtYXAuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gc291cmNlIC0gU291cmNlIHNlbGVjdCBtYXAuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRTZWxlY3QodGFyZ2V0LCBzb3VyY2UpIHtcbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCBhdHRyaWJ1dGVzXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2UpKSB7XG4gICAgY29uc3QgZXhpc3RpbmdBdHRyaWJ1dGVzID0gdGFyZ2V0W21vZGVsTmFtZV0gfHwgW11cblxuICAgIHRhcmdldFttb2RlbE5hbWVdID0gQXJyYXkuZnJvbShuZXcgU2V0KGV4aXN0aW5nQXR0cmlidXRlcy5jb25jYXQoYXR0cmlidXRlcykpKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBtZXJnZSB1bmlxdWUgZnJvbnRlbmQgbW9kZWwgZXZlbnQgZW50cmllcy5cbiAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsV2l0aENvdW50UGF5bG9hZEVudHJ5IHwgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsQWJpbGl0aWVzUGF5bG9hZEVudHJ5Pn0gdGFyZ2V0IC0gVGFyZ2V0IGFycmF5LlxuICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxXaXRoQ291bnRQYXlsb2FkRW50cnkgfCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxBYmlsaXRpZXNQYXlsb2FkRW50cnk+fSBzb3VyY2UgLSBTb3VyY2UgYXJyYXkuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VVbmlxdWVGcm9udGVuZE1vZGVsRXZlbnRFbnRyaWVzKHRhcmdldCwgc291cmNlKSB7XG4gIGNvbnN0IGV4aXN0aW5nS2V5cyA9IG5ldyBTZXQodGFyZ2V0Lm1hcCgoZW50cnkpID0+IEpTT04uc3RyaW5naWZ5KGVudHJ5KSkpXG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBzb3VyY2UpIHtcbiAgICBjb25zdCBrZXkgPSBKU09OLnN0cmluZ2lmeShlbnRyeSlcblxuICAgIGlmIChleGlzdGluZ0tleXMuaGFzKGtleSkpIGNvbnRpbnVlXG5cbiAgICB0YXJnZXQucHVzaChlbnRyeSlcbiAgICBleGlzdGluZ0tleXMuYWRkKGtleSlcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgZnJvbnRlbmQgbW9kZWwgZXZlbnQgcHJvamVjdGlvbiBwYXlsb2FkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH0gdGFyZ2V0IC0gVGFyZ2V0IHBheWxvYWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfSBzb3VyY2UgLSBTb3VyY2UgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByb2plY3Rpb25QYXlsb2FkKHRhcmdldCwgc291cmNlKSB7XG4gIGlmIChzb3VyY2UucHJlbG9hZCkge1xuICAgIGlmICghdGFyZ2V0LnByZWxvYWQpIHRhcmdldC5wcmVsb2FkID0ge31cbiAgICBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByZWxvYWQodGFyZ2V0LnByZWxvYWQsIHNvdXJjZS5wcmVsb2FkKVxuICB9XG5cbiAgaWYgKHNvdXJjZS5zZWxlY3QpIHtcbiAgICBpZiAoIXRhcmdldC5zZWxlY3QpIHRhcmdldC5zZWxlY3QgPSB7fVxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50U2VsZWN0KHRhcmdldC5zZWxlY3QsIHNvdXJjZS5zZWxlY3QpXG4gIH1cblxuICBpZiAoc291cmNlLnNlbGVjdHNFeHRyYSkge1xuICAgIGlmICghdGFyZ2V0LnNlbGVjdHNFeHRyYSkgdGFyZ2V0LnNlbGVjdHNFeHRyYSA9IHt9XG4gICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRTZWxlY3QodGFyZ2V0LnNlbGVjdHNFeHRyYSwgc291cmNlLnNlbGVjdHNFeHRyYSlcbiAgfVxuXG4gIGlmIChzb3VyY2Uud2l0aENvdW50KSB7XG4gICAgaWYgKCF0YXJnZXQud2l0aENvdW50KSB0YXJnZXQud2l0aENvdW50ID0gW11cbiAgICBtZXJnZVVuaXF1ZUZyb250ZW5kTW9kZWxFdmVudEVudHJpZXModGFyZ2V0LndpdGhDb3VudCwgc291cmNlLndpdGhDb3VudClcbiAgfVxuXG4gIGlmIChzb3VyY2UuYWJpbGl0aWVzKSB7XG4gICAgaWYgKCF0YXJnZXQuYWJpbGl0aWVzKSB0YXJnZXQuYWJpbGl0aWVzID0gW11cbiAgICBtZXJnZVVuaXF1ZUZyb250ZW5kTW9kZWxFdmVudEVudHJpZXModGFyZ2V0LmFiaWxpdGllcywgc291cmNlLmFiaWxpdGllcylcbiAgfVxuXG4gIGlmIChzb3VyY2UucXVlcnlEYXRhICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCB0YXJnZXRRdWVyeURhdGEgPSBBcnJheS5pc0FycmF5KHRhcmdldC5xdWVyeURhdGEpID8gdGFyZ2V0LnF1ZXJ5RGF0YSA6IFtdXG5cbiAgICB0YXJnZXQucXVlcnlEYXRhID0gdGFyZ2V0UXVlcnlEYXRhXG4gICAgY29uc3QgcXVlcnlEYXRhRW50cmllcyA9IEFycmF5LmlzQXJyYXkoc291cmNlLnF1ZXJ5RGF0YSkgPyBzb3VyY2UucXVlcnlEYXRhIDogW3NvdXJjZS5xdWVyeURhdGFdXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHF1ZXJ5RGF0YUVudHJpZXMpIHtcbiAgICAgIHRhcmdldFF1ZXJ5RGF0YS5wdXNoKGVudHJ5KVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgbWF0Y2hlZCBldmVudCBmaWx0ZXIga2V5cy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBSYXcgd2Vic29ja2V0IGV2ZW50IGJvZHkuXG4gKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gTWF0Y2hlZCBldmVudCBmaWx0ZXIga2V5cyBkZWxpdmVyZWQgYnkgdGhlIGJhY2tlbmQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxNYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKGJvZHkpIHtcbiAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSBcIm9iamVjdFwiKSByZXR1cm4gbmV3IFNldCgpXG5cbiAgY29uc3Qga2V5cyA9IC8qKiBAdHlwZSB7e21hdGNoZWRFdmVudEZpbHRlcktleXM/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19ICovIChib2R5KS5tYXRjaGVkRXZlbnRGaWx0ZXJLZXlzXG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KGtleXMpKSByZXR1cm4gbmV3IFNldCgpXG5cbiAgcmV0dXJuIG5ldyBTZXQoa2V5cy5tYXAoKGtleSkgPT4gU3RyaW5nKGtleSkpKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgZXZlbnQgZW50cnkgbWF0Y2hlcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5PGFueSwgYW55Pn0gZW50cnkgLSBDYWxsYmFjayBlbnRyeS5cbiAqIEBwYXJhbSB7U2V0PHN0cmluZz59IG1hdGNoZWRFdmVudEZpbHRlcktleXMgLSBCYWNrZW5kIG1hdGNoZWQgZmlsdGVyIGtleXMuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgY2FsbGJhY2sgc2hvdWxkIHJlY2VpdmUgdGhlIGV2ZW50LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsRXZlbnRFbnRyeU1hdGNoZXMoZW50cnksIG1hdGNoZWRFdmVudEZpbHRlcktleXMpIHtcbiAgaWYgKCFlbnRyeS5ldmVudEZpbHRlcktleSkgcmV0dXJuIHRydWVcblxuICByZXR1cm4gbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cy5oYXMoZW50cnkuZXZlbnRGaWx0ZXJLZXkpXG59XG5cbi8qKlxuICogUnVucyBhc3NlcnQgbm8gZGVzdHJveSBldmVudCBmaWx0ZXIuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIEV2ZW50IG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IG9wdGlvbnMgLSBFdmVudCBvcHRpb25zLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydE5vRGVzdHJveUV2ZW50RmlsdGVyKE1vZGVsQ2xhc3MsIG9wdGlvbnMpIHtcbiAgY29uc3QgZXZlbnRPcHRpb25zUGF5bG9hZCA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKE1vZGVsQ2xhc3MsIG9wdGlvbnMpXG5cbiAgaWYgKCFldmVudE9wdGlvbnNQYXlsb2FkLmV2ZW50RmlsdGVyS2V5KSByZXR1cm5cblxuICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBkZXN0cm95IGV2ZW50IHN1YnNjcmlwdGlvbnMgZG8gbm90IHN1cHBvcnQgcXVlcnkgZmlsdGVyc1wiKVxufVxuXG4vKipcbiAqIFBlci1tb2RlbCBjbGFzcyBzaW5nbGV0b24gdGhhdCBtdWx0aXBsZXhlcyBhbGwgcmVnaXN0ZXJlZCBvbkNyZWF0ZSAvXG4gKiBvblVwZGF0ZSAvIG9uRGVzdHJveSBjYWxsYmFja3Mg4oCUIGNsYXNzLWxldmVsICsgaW5zdGFuY2UtbGV2ZWwg4oCUXG4gKiBvdmVyIG9uZSBXZWJzb2NrZXRDaGFubmVsVjIgc3Vic2NyaXB0aW9uLiBTdWJzY3JpcHRpb24gb3BlbnMgb24gdGhlXG4gKiBmaXJzdCBsaXN0ZW5lciBhbmQgY2xvc2VzIHdoZW4gdGhlIGxhc3Qgb25lIHVuc3Vic2NyaWJlcy5cbiAqXG4gKiBJbnN0YW5jZS1sZXZlbCBsaXN0ZW5lcnMgYWxzbyByZWNlaXZlIGF1dG8tbWVyZ2U6IHdoZW4gYW4gYHVwZGF0ZWBcbiAqIGV2ZW50IGFycml2ZXMgZm9yIGEgcmVnaXN0ZXJlZCBpbnN0YW5jZSBpZCwgdGhlIGluc3RhbmNlJ3NcbiAqIGF0dHJpYnV0ZXMgYXJlIHVwZGF0ZWQgaW4gcGxhY2UgYmVmb3JlIHRoZSBjYWxsYmFjayBmaXJlcywgc29cbiAqIGNhbGxlcnMgY2FuIHJlYWQgZnJlc2ggdmFsdWVzIGZyb20gdGhlIHNhbWUgaW5zdGFuY2UgaGFuZGxlLlxuICovXG5jbGFzcyBGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24ge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcyBmb3IgdGhpcyBzdWJzY3JpcHRpb24gYnVja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHR9IHJlcXVlc3RDb250ZXh0IC0gQ2FwdHVyZWQgc3Vic2NyaXB0aW9uIGNvbnRleHQuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihNb2RlbENsYXNzLCByZXF1ZXN0Q29udGV4dCkge1xuICAgIHRoaXMuTW9kZWxDbGFzcyA9IE1vZGVsQ2xhc3NcbiAgICB0aGlzLnJlcXVlc3RDb250ZXh0ID0gcmVxdWVzdENvbnRleHRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1NldDxGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnk8YW55LCBhbnk+Pn0gKi9cbiAgICB0aGlzLmNsYXNzQ3JlYXRlQ2FsbGJhY2tzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtTZXQ8RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5PGFueSwgYW55Pj59ICovXG4gICAgdGhpcy5jbGFzc1VwZGF0ZUNhbGxiYWNrcyA9IG5ldyBTZXQoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7U2V0PEZyb250ZW5kTW9kZWxEZXN0cm95RXZlbnRDYWxsYmFja0VudHJ5PG5ldmVyPj59ICovXG4gICAgdGhpcy5jbGFzc0Rlc3Ryb3lDYWxsYmFja3MgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHtpbnN0YW5jZTogRnJvbnRlbmRNb2RlbEJhc2UsIHVwZGF0ZUNhbGxiYWNrczogU2V0PEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeTxhbnksIGFueT4+LCBkZXN0cm95Q2FsbGJhY2tzOiBTZXQ8RnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnk8YW55Pj59Pn0gKi9cbiAgICB0aGlzLmluc3RhbmNlTGlzdGVuZXJzID0gbmV3IE1hcCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICB0aGlzLmNoYW5uZWxIYW5kbGUgPSBudWxsXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLnJlYWR5UHJvbWlzZSA9IG51bGxcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge3N0cmluZyB8IG51bGx9ICovXG4gICAgdGhpcy5zdWJzY3JpcHRpb25QYXJhbXNLZXkgPSBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdWJzY3JpcHRpb24gcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7e21vZGVsOiBzdHJpbmcsIGRlc3Ryb3lFdmVudERlbGl2ZXJ5PzogYm9vbGVhbiwgZXZlbnRGaWx0ZXJzPzogaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnlbXSwgdW5maWx0ZXJlZEV2ZW50RGVsaXZlcnk/OiBib29sZWFufSAmIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfSAtIEN1cnJlbnQgd2Vic29ja2V0IHN1YnNjcmlwdGlvbiBwYXJhbXMuXG4gICAqL1xuICBzdWJzY3JpcHRpb25QYXJhbXMoKSB7XG4gICAgLyoqXG4gICAgICogUHJvamVjdGlvbiBwYXlsb2FkLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH0gKi9cbiAgICBjb25zdCBwcm9qZWN0aW9uUGF5bG9hZCA9IHt9XG4gICAgLyoqXG4gICAgICogRXZlbnQgZmlsdGVycyBieSBrZXkuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZEVudHJ5Pn0gKi9cbiAgICBjb25zdCBldmVudEZpbHRlcnNCeUtleSA9IHt9XG4gICAgY29uc3QgcHJvamVjdGlvbkVudHJpZXMgPSBbXVxuICAgIGxldCBoYXNEZXN0cm95RXZlbnREZWxpdmVyeSA9IHRoaXMuY2xhc3NEZXN0cm95Q2FsbGJhY2tzLnNpemUgPiAwXG4gICAgbGV0IGhhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5ID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgdGhpcy5jbGFzc0NyZWF0ZUNhbGxiYWNrcykgcHJvamVjdGlvbkVudHJpZXMucHVzaChlbnRyeSlcbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHRoaXMuY2xhc3NVcGRhdGVDYWxsYmFja3MpIHByb2plY3Rpb25FbnRyaWVzLnB1c2goZW50cnkpXG5cbiAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMudmFsdWVzKCkpIHtcbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzKSBwcm9qZWN0aW9uRW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgaWYgKGxpc3RlbmVyLmRlc3Ryb3lDYWxsYmFja3Muc2l6ZSA+IDApIGhhc0Rlc3Ryb3lFdmVudERlbGl2ZXJ5ID0gdHJ1ZVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcHJvamVjdGlvbkVudHJpZXMpIHtcbiAgICAgIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50UHJvamVjdGlvblBheWxvYWQocHJvamVjdGlvblBheWxvYWQsIGVudHJ5LnByb2plY3Rpb25QYXlsb2FkKVxuXG4gICAgICBpZiAoZW50cnkuZXZlbnRGaWx0ZXJLZXkgJiYgZW50cnkuZXZlbnRGaWx0ZXJQYXlsb2FkKSB7XG4gICAgICAgIGV2ZW50RmlsdGVyc0J5S2V5W2VudHJ5LmV2ZW50RmlsdGVyS2V5XSA9IHtcbiAgICAgICAgICAuLi5lbnRyeS5ldmVudEZpbHRlclBheWxvYWQsXG4gICAgICAgICAga2V5OiBlbnRyeS5ldmVudEZpbHRlcktleVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBoYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSA9IHRydWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBldmVudEZpbHRlcnMgPSBPYmplY3QudmFsdWVzKGV2ZW50RmlsdGVyc0J5S2V5KVxuICAgIGNvbnN0IGV2ZW50RmlsdGVyUGFyYW1zID0gZXZlbnRGaWx0ZXJzLmxlbmd0aCA+IDBcbiAgICAgID8ge1xuICAgICAgICAgIGV2ZW50RmlsdGVycyxcbiAgICAgICAgICAuLi4oaGFzRGVzdHJveUV2ZW50RGVsaXZlcnkgPyB7ZGVzdHJveUV2ZW50RGVsaXZlcnk6IHRydWV9IDoge30pLFxuICAgICAgICAgIC4uLihoYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSA/IHt1bmZpbHRlcmVkRXZlbnREZWxpdmVyeTogdHJ1ZX0gOiB7fSlcbiAgICAgICAgfVxuICAgICAgOiB7fVxuXG4gICAgcmV0dXJuIG1lcmdlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KFxuICAgICAgdGhpcy5yZXF1ZXN0Q29udGV4dCxcbiAgICAgIHtcbiAgICAgICAgbW9kZWw6IHRoaXMuTW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgLi4uZXZlbnRGaWx0ZXJQYXJhbXMsXG4gICAgICAgIC4uLnByb2plY3Rpb25QYXlsb2FkXG4gICAgICB9XG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Vic2NyaXB0aW9uIHBhcmFtcyBqc29uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFN0YWJsZSBrZXkgZm9yIGN1cnJlbnQgc3Vic2NyaXB0aW9uIHBhcmFtcy5cbiAgICovXG4gIHN1YnNjcmlwdGlvblBhcmFtc0pzb24oKSB7XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWdpc3RlciBjbGFzcyBjYWxsYmFjay5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnk8YW55LCBhbnk+IHwgRnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnk8bmV2ZXI+fSBUXG4gICAqIEBwYXJhbSB7U2V0PFQ+fSBjYWxsYmFja3MgLSBDYWxsYmFjayBzZXQgZm9yIHRoZSBldmVudCB0eXBlLlxuICAgKiBAcGFyYW0ge1R9IGVudHJ5IC0gQ2FsbGJhY2sgZW50cnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgcmVnaXN0ZXJDbGFzc0NhbGxiYWNrKGNhbGxiYWNrcywgZW50cnkpIHtcbiAgICBjYWxsYmFja3MuYWRkKGVudHJ5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlU3Vic2NyaWJlZCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNhbGxiYWNrcy5kZWxldGUoZW50cnkpXG4gICAgICB0aGlzLm1heWJlVGVhcmRvd24oKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgY2FsbGJhY2tzLmRlbGV0ZShlbnRyeSlcbiAgICAgIHRoaXMubWF5YmVUZWFyZG93bigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIHN1YnNjcmliZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAqL1xuICBhc3luYyBlbnN1cmVTdWJzY3JpYmVkKCkge1xuICAgIGNvbnN0IHBhcmFtc0pzb24gPSB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0pzb24oKVxuXG4gICAgaWYgKHRoaXMuY2hhbm5lbEhhbmRsZSAmJiAhdGhpcy5jaGFubmVsSGFuZGxlLmlzQ2xvc2VkKCkpIHtcbiAgICAgIGlmICh0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSAhPT0gcGFyYW1zSnNvbikge1xuICAgICAgICB0aGlzLmNoYW5uZWxIYW5kbGUuY2xvc2UoKVxuICAgICAgICB0aGlzLmNoYW5uZWxIYW5kbGUgPSBudWxsXG4gICAgICAgIHRoaXMucmVhZHlQcm9taXNlID0gbnVsbFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHRoaXMucmVhZHlQcm9taXNlKSBhd2FpdCB0aGlzLnJlYWR5UHJvbWlzZVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTZXJpYWxpemUgcGFyYWxsZWwgY2FsbHMgKGUuZy4gUHJvbWlzZS5hbGwoW29uQ3JlYXRlLCBvblVwZGF0ZSxcbiAgICAvLyBvbkRlc3Ryb3ldKSkgc28gd2Ugb3BlbiBleGFjdGx5IG9uZSBzdWJzY3JpcHRpb24gcGVyIG1vZGVsIGNsYXNzXG4gICAgLy8gaW5zdGVhZCBvZiByYWNpbmcgdGhyZWUgY29uY3VycmVudCBzdWJzY3JpYmVDaGFubmVsIGNhbGxzLlxuICAgIGlmICh0aGlzLnJlYWR5UHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5yZWFkeVByb21pc2VcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgIGlmICghY2xpZW50IHx8IHR5cGVvZiBjbGllbnQuc3Vic2NyaWJlQ2hhbm5lbCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBldmVudCBzdWJzY3JpcHRpb25zIHJlcXVpcmUgY29uZmlndXJlVHJhbnNwb3J0KHt3ZWJzb2NrZXRVcmx9KSBvciBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldENsaWVudH0pXCIpXG4gICAgfVxuXG4gICAgdGhpcy5yZWFkeVByb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHR5cGVvZiBjbGllbnQuY29ubmVjdCA9PT0gXCJmdW5jdGlvblwiKSBhd2FpdCBjbGllbnQuY29ubmVjdCgpXG5cbiAgICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zKClcblxuICAgICAgdGhpcy5zdWJzY3JpcHRpb25QYXJhbXNLZXkgPSBKU09OLnN0cmluZ2lmeShwYXJhbXMpXG4gICAgICB0aGlzLmNoYW5uZWxIYW5kbGUgPSBjbGllbnQuc3Vic2NyaWJlQ2hhbm5lbChGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FLCB7XG4gICAgICAgIHBhcmFtcyxcbiAgICAgICAgb25NZXNzYWdlOiAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gYm9keSkgPT4gdGhpcy5fZGlzcGF0Y2hFdmVudChib2R5KSxcbiAgICAgICAgb25DbG9zZTogKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IG51bGxcbiAgICAgICAgICB0aGlzLnJlYWR5UHJvbWlzZSA9IG51bGxcbiAgICAgICAgICB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSA9IG51bGxcbiAgICAgICAgICB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLmNsZWFyKClcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIGF3YWl0IHRoaXMuY2hhbm5lbEhhbmRsZS5yZWFkeVxuICAgIH0pKClcblxuICAgIGF3YWl0IHRoaXMucmVhZHlQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXNwYXRjaCBldmVudC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keSAtIFdlYlNvY2tldCBldmVudCBwYXlsb2FkLlxuICAgKi9cbiAgX2Rpc3BhdGNoRXZlbnQoYm9keSkge1xuICAgIGlmICghYm9keSB8fCB0eXBlb2YgYm9keSAhPT0gXCJvYmplY3RcIikgcmV0dXJuXG5cbiAgICBjb25zdCBhY3Rpb24gPSBib2R5LmFjdGlvblxuICAgIGNvbnN0IHJhd0lkID0gYm9keS5pZFxuXG4gICAgaWYgKGFjdGlvbiAhPT0gXCJjcmVhdGVcIiAmJiBhY3Rpb24gIT09IFwidXBkYXRlXCIgJiYgYWN0aW9uICE9PSBcImRlc3Ryb3lcIikgcmV0dXJuXG4gICAgaWYgKHJhd0lkID09PSB1bmRlZmluZWQgfHwgcmF3SWQgPT09IG51bGwpIHJldHVyblxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBpZGVudGl0eSA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSlcbiAgICAgID8gbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhwcmltYXJ5S2V5LCByYXdJZClcbiAgICAgIDogU3RyaW5nKHJhd0lkKVxuICAgIGNvbnN0IGlkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgaWRlbnRpdHkpXG4gICAgY29uc3QgcmF3UHJldmlvdXNJZCA9IGJvZHkucHJldmlvdXNJZFxuICAgIGNvbnN0IHByZXZpb3VzSWRlbnRpdHkgPSByYXdQcmV2aW91c0lkID09PSB1bmRlZmluZWQgfHwgcmF3UHJldmlvdXNJZCA9PT0gbnVsbFxuICAgICAgPyBudWxsXG4gICAgICA6IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSlcbiAgICAgICAgPyBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIHJhd1ByZXZpb3VzSWQpXG4gICAgICAgIDogU3RyaW5nKHJhd1ByZXZpb3VzSWQpXG4gICAgY29uc3QgcHJldmlvdXNJZCA9IHByZXZpb3VzSWRlbnRpdHkgPT09IG51bGxcbiAgICAgID8gbnVsbFxuICAgICAgOiBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkZW50aXR5KVxuICAgIGNvbnN0IG1hdGNoZWRFdmVudEZpbHRlcktleXMgPSBmcm9udGVuZE1vZGVsTWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyhib2R5KVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJkZXN0cm95XCIpIHtcbiAgICAgIGNvbnN0IGxpc3RlbmVyID0gdGhpcy5pbnN0YW5jZUxpc3RlbmVycy5nZXQoaWQpXG5cbiAgICAgIGlmIChsaXN0ZW5lcikge1xuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxpc3RlbmVyLmRlc3Ryb3lDYWxsYmFja3MpIHtcbiAgICAgICAgICB0cnkgeyBlbnRyeS5jYWxsYmFjayh7aWQ6IGlkZW50aXR5fSkgfSBjYXRjaCAoZXJyb3IpIHsgY29uc29sZS5lcnJvcihlcnJvcikgfVxuICAgICAgICB9XG4gICAgICAgIGRlbGV0ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyKHRoaXMsIGxpc3RlbmVyKVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLmNsYXNzRGVzdHJveUNhbGxiYWNrcykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIC8qKiBAdHlwZSB7KHBheWxvYWQ6IHtpZDogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9KSA9PiB2b2lkfSAqLyAoZW50cnkuY2FsbGJhY2spKHtpZDogaWRlbnRpdHl9KVxuICAgICAgICB9IGNhdGNoIChlcnJvcikgeyBjb25zb2xlLmVycm9yKGVycm9yKSB9XG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBsaXN0ZW5lciA9IHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KGlkKSB8fCAocHJldmlvdXNJZCA9PT0gbnVsbCA/IHVuZGVmaW5lZCA6IHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KHByZXZpb3VzSWQpKVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJ1cGRhdGVcIiAmJiBsaXN0ZW5lciAmJiBwcmV2aW91c0lkZW50aXR5ICE9PSBudWxsKSB7XG4gICAgICBhcHBseUZyb250ZW5kTW9kZWxQZXJzaXN0ZWRJZGVudGl0eSh0aGlzLk1vZGVsQ2xhc3MsIGxpc3RlbmVyLmluc3RhbmNlLCBpZGVudGl0eSlcbiAgICAgIHJla2V5RnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKHRoaXMuTW9kZWxDbGFzcywgbGlzdGVuZXIuaW5zdGFuY2UsIHByZXZpb3VzSWRlbnRpdHksIGlkZW50aXR5KVxuICAgIH1cblxuICAgIGlmICghYm9keS5yZWNvcmQgfHwgdHlwZW9mIGJvZHkucmVjb3JkICE9PSBcIm9iamVjdFwiKSByZXR1cm5cblxuICAgIGNvbnN0IGRlc2VyaWFsaXplZFJlY29yZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoYm9keS5yZWNvcmQpKVxuICAgIGNvbnN0IGZyZXNoTW9kZWwgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcy5Nb2RlbENsYXNzKS5pbnN0YW50aWF0ZUZyb21SZXNwb25zZShkZXNlcmlhbGl6ZWRSZWNvcmQpXG5cbiAgICBpZiAoYWN0aW9uID09PSBcInVwZGF0ZVwiICYmIGxpc3RlbmVyKSB7XG4gICAgICBjb25zdCBpbnN0YW5jZUFueSA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChsaXN0ZW5lci5pbnN0YW5jZSlcblxuICAgICAgaW5zdGFuY2VBbnkuX2F0dGFjaG1lbnRPd25lciA9IGZyZXNoTW9kZWwuX2F0dGFjaG1lbnRPd25lclxuXG4gICAgICBjb25zdCBtYXRjaGluZ1VwZGF0ZUNhbGxiYWNrcyA9IEFycmF5LmZyb20obGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzKS5maWx0ZXIoKGVudHJ5KSA9PlxuICAgICAgICBmcm9udGVuZE1vZGVsRXZlbnRFbnRyeU1hdGNoZXMoZW50cnksIG1hdGNoZWRFdmVudEZpbHRlcktleXMpXG4gICAgICApXG5cbiAgICAgIGlmIChtYXRjaGluZ1VwZGF0ZUNhbGxiYWNrcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIEF1dG8tbWVyZ2UgaW50byB0aGUgcmVnaXN0ZXJlZCBpbnN0YW5jZSBzbyBjYWxsZXJzIHJlYWRpbmdcbiAgICAgICAgLy8gdGhyb3VnaCB0aGUgc2FtZSBoYW5kbGUgc2VlIGZyZXNoIGF0dHJpYnV0ZXMuXG4gICAgICAgIGluc3RhbmNlQW55LmFzc2lnbkF0dHJpYnV0ZXMoZnJlc2hNb2RlbC5hdHRyaWJ1dGVzKCkpXG4gICAgICAgIGluc3RhbmNlQW55Ll9wZXJzaXN0ZWRBdHRyaWJ1dGVzID0gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhsaXN0ZW5lci5pbnN0YW5jZS5hdHRyaWJ1dGVzKCkpXG5cbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBtYXRjaGluZ1VwZGF0ZUNhbGxiYWNrcykge1xuICAgICAgICAgIHRyeSB7IGVudHJ5LmNhbGxiYWNrKHtpZDogaWRlbnRpdHksIG1vZGVsOiBsaXN0ZW5lci5pbnN0YW5jZX0pIH0gY2F0Y2ggKGVycm9yKSB7IGNvbnNvbGUuZXJyb3IoZXJyb3IpIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGNsYXNzQ2FsbGJhY2tzID0gYWN0aW9uID09PSBcImNyZWF0ZVwiID8gdGhpcy5jbGFzc0NyZWF0ZUNhbGxiYWNrcyA6IHRoaXMuY2xhc3NVcGRhdGVDYWxsYmFja3NcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgY2xhc3NDYWxsYmFja3MpIHtcbiAgICAgIGlmICghZnJvbnRlbmRNb2RlbEV2ZW50RW50cnlNYXRjaGVzKGVudHJ5LCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKSkgY29udGludWVcblxuICAgICAgdHJ5IHsgZW50cnkuY2FsbGJhY2soe2lkOiBpZGVudGl0eSwgbW9kZWw6IGZyZXNoTW9kZWx9KSB9IGNhdGNoIChlcnJvcikgeyBjb25zb2xlLmVycm9yKGVycm9yKSB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF5YmUgdGVhcmRvd24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBtYXliZVRlYXJkb3duKCkge1xuICAgIGNvbnN0IGhhc0FueUxpc3RlbmVyID0gdGhpcy5jbGFzc0NyZWF0ZUNhbGxiYWNrcy5zaXplID4gMFxuICAgICAgfHwgdGhpcy5jbGFzc1VwZGF0ZUNhbGxiYWNrcy5zaXplID4gMFxuICAgICAgfHwgdGhpcy5jbGFzc0Rlc3Ryb3lDYWxsYmFja3Muc2l6ZSA+IDBcbiAgICAgIHx8IHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMuc2l6ZSA+IDBcblxuICAgIGlmIChoYXNBbnlMaXN0ZW5lcikgcmV0dXJuXG5cbiAgICBpZiAodGhpcy5jaGFubmVsSGFuZGxlKSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmNoYW5uZWxIYW5kbGUuY2xvc2UoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmNoYW5uZWxIYW5kbGUgPSBudWxsXG4gICAgdGhpcy5yZWFkeVByb21pc2UgPSBudWxsXG4gICAgdGhpcy5zdWJzY3JpcHRpb25QYXJhbXNLZXkgPSBudWxsXG4gICAgcmVsZWFzZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbih0aGlzKVxuICB9XG59XG5cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgZXZlbnQgc3Vic2NyaXB0aW9ucy5cbiAqIEB0eXBlIHtXZWFrTWFwPEZyb250ZW5kTW9kZWxDbGFzcywgTWFwPHN0cmluZywgRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uPj59ICovXG5jb25zdCBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zID0gbmV3IFdlYWtNYXAoKVxuXG4vKipcbiAqIFJ1bnMgZW5zdXJlIGZyb250ZW5kIG1vZGVsIGV2ZW50IHN1YnNjcmlwdGlvbi5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHR9IHJlcXVlc3RDb250ZXh0IC0gQ2FwdHVyZWQgc3Vic2NyaXB0aW9uIGNvbnRleHQuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufSAtIFBlci1jbGFzcyBzdWJzY3JpcHRpb24gaGVscGVyLlxuICovXG5mdW5jdGlvbiBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oTW9kZWxDbGFzcywgcmVxdWVzdENvbnRleHQpIHtcbiAgbGV0IHN1YnNjcmlwdGlvbnMgPSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmdldChNb2RlbENsYXNzKVxuXG4gIGlmICghc3Vic2NyaXB0aW9ucykge1xuICAgIHN1YnNjcmlwdGlvbnMgPSBuZXcgTWFwKClcbiAgICBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLnNldChNb2RlbENsYXNzLCBzdWJzY3JpcHRpb25zKVxuICB9XG5cbiAgY29uc3QgY29udGV4dEtleSA9IHJlbW90ZVJlcXVlc3RDb250ZXh0S2V5KHJlcXVlc3RDb250ZXh0KVxuICBsZXQgc3ViID0gc3Vic2NyaXB0aW9ucy5nZXQoY29udGV4dEtleSlcblxuICBpZiAoIXN1Yikge1xuICAgIHN1YiA9IG5ldyBGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oTW9kZWxDbGFzcywgcmVxdWVzdENvbnRleHQpXG4gICAgc3Vic2NyaXB0aW9ucy5zZXQoY29udGV4dEtleSwgc3ViKVxuICB9XG5cbiAgcmV0dXJuIHN1YlxufVxuXG4vKipcbiAqIFJlbW92ZXMgYW4gZW1wdHkgY29udGV4dCBidWNrZXQgc28gc3dpdGNoaW5nIHRocm91Z2ggbWFueSB0ZW5hbnRzIGRvZXMgbm90IHJldGFpbiBldmVyeSBzbmFwc2hvdC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufSBzdWJzY3JpcHRpb24gLSBFbXB0eSBzdWJzY3JpcHRpb24gYnVja2V0LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJlbGVhc2VGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oc3Vic2NyaXB0aW9uKSB7XG4gIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmdldChzdWJzY3JpcHRpb24uTW9kZWxDbGFzcylcbiAgY29uc3QgY29udGV4dEtleSA9IHJlbW90ZVJlcXVlc3RDb250ZXh0S2V5KHN1YnNjcmlwdGlvbi5yZXF1ZXN0Q29udGV4dClcblxuICBpZiAoc3Vic2NyaXB0aW9ucz8uZ2V0KGNvbnRleHRLZXkpICE9PSBzdWJzY3JpcHRpb24pIHJldHVyblxuXG4gIHN1YnNjcmlwdGlvbnMuZGVsZXRlKGNvbnRleHRLZXkpXG4gIGlmIChzdWJzY3JpcHRpb25zLnNpemUgPT09IDApIGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMuZGVsZXRlKHN1YnNjcmlwdGlvbi5Nb2RlbENsYXNzKVxufVxuXG4vKipcbiAqIENhcHR1cmVzIHRoZSBjdXJyZW50IGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCBjb250ZXh0IGZvciBvbmUgb3BlcmF0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHR9IEZyb3plbiBjb250ZXh0IHNuYXBzaG90LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRDb250ZXh0ID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdENvbnRleHQgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0Q29udGV4dCgpXG4gICAgOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RDb250ZXh0XG5cbiAgcmV0dXJuIGNhcHR1cmVGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQoY29uZmlndXJlZENvbnRleHQpXG59XG5cbi8qKlxuICogQ2FwdHVyZXMgdGhlIGV4cGxpY2l0IGxpZmVjeWNsZSBjb250ZXh0IG9yIGZhbGxzIGJhY2sgdG8gdGhlIGNvbmZpZ3VyZWQgdHJhbnNwb3J0IGNvbnRleHQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQgfCB1bmRlZmluZWR9IHJlcXVlc3RDb250ZXh0IC0gUmVnaXN0cmF0aW9uLWxvY2FsIGNvbnRleHQuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dH0gRnJvemVuIGNvbnRleHQgc25hcHNob3QuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSB7XG4gIGlmIChyZXF1ZXN0Q29udGV4dCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KClcblxuICByZXR1cm4gY2FwdHVyZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dClcbn1cblxuLyoqXG4gKiBSdW5zIGVuc3VyZSBmcm9udGVuZCBtb2RlbCBpbnN0YW5jZSBsaXN0ZW5lci5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufSBzdWIgLSBFdmVudCBzdWJzY3JpcHRpb24gYnVja2V0LlxuICogQHBhcmFtIHtzdHJpbmd9IGlkIC0gTW9kZWwgaWQuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBpbnN0YW5jZSAtIExpc3RlbmVyIGluc3RhbmNlLlxuICogQHJldHVybnMge3tpbnN0YW5jZTogRnJvbnRlbmRNb2RlbEJhc2UsIHVwZGF0ZUNhbGxiYWNrczogU2V0PEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeTxhbnksIGFueT4+LCBkZXN0cm95Q2FsbGJhY2tzOiBTZXQ8RnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnk8YW55Pj59fSAtIEluc3RhbmNlIGxpc3RlbmVyIGJ1Y2tldC5cbiAqL1xuZnVuY3Rpb24gZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIoc3ViLCBpZCwgaW5zdGFuY2UpIHtcbiAgbGV0IGxpc3RlbmVyID0gc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChpZClcblxuICBpZiAoIWxpc3RlbmVyKSB7XG4gICAgbGlzdGVuZXIgPSB7aW5zdGFuY2UsIHVwZGF0ZUNhbGxiYWNrczogbmV3IFNldCgpLCBkZXN0cm95Q2FsbGJhY2tzOiBuZXcgU2V0KCl9XG4gICAgc3ViLmluc3RhbmNlTGlzdGVuZXJzLnNldChpZCwgbGlzdGVuZXIpXG4gIH0gZWxzZSB7XG4gICAgbGlzdGVuZXIuaW5zdGFuY2UgPSBpbnN0YW5jZVxuICB9XG5cbiAgcmV0dXJuIGxpc3RlbmVyXG59XG5cbi8qKlxuICogUmVtb3ZlcyBldmVyeSBpZGVudGl0eSBrZXkgcG9pbnRpbmcgYXQgYW4gaW5zdGFuY2UgbGlzdGVuZXIuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gc3ViIC0gRXZlbnQgc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXI+fSBsaXN0ZW5lciAtIEluc3RhbmNlIGxpc3RlbmVyIGJ1Y2tldC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBkZWxldGVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGxpc3RlbmVyKSB7XG4gIGZvciAoY29uc3QgW2lkLCBjdXJyZW50XSBvZiBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMpIHtcbiAgICBpZiAoY3VycmVudCA9PT0gbGlzdGVuZXIpIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5kZWxldGUoaWQpXG4gIH1cbn1cblxuLyoqXG4gKiBSZW1vdmVzIG9uZSBpbnN0YW5jZSBjYWxsYmFjayBlbnRyeSBhbmQgdGVhcnMgZG93biBhbiBlbXB0eSBsaXN0ZW5lci9zdWJzY3JpcHRpb24gYnVja2V0LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb259IHN1YiAtIEV2ZW50IHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gKiBAcGFyYW0geyhsaXN0ZW5lcjogUmV0dXJuVHlwZTx0eXBlb2YgZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXI+KSA9PiBib29sZWFufSByZW1vdmVFbnRyeSAtIENhbGxiYWNrIGVudHJ5IHJlbW92YWwuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gcmVtb3ZlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJFbnRyeShzdWIsIHJlbW92ZUVudHJ5KSB7XG4gIGZvciAoY29uc3QgY3VycmVudCBvZiBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMudmFsdWVzKCkpIHtcbiAgICBpZiAoIXJlbW92ZUVudHJ5KGN1cnJlbnQpKSBjb250aW51ZVxuXG4gICAgaWYgKGN1cnJlbnQudXBkYXRlQ2FsbGJhY2tzLnNpemUgPT09IDAgJiYgY3VycmVudC5kZXN0cm95Q2FsbGJhY2tzLnNpemUgPT09IDApIHtcbiAgICAgIGRlbGV0ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyKHN1YiwgY3VycmVudClcbiAgICB9XG4gICAgYnJlYWtcbiAgfVxuXG4gIHN1Yi5tYXliZVRlYXJkb3duKClcbn1cblxuLyoqXG4gKiBUZW1wb3JhcmlseSByZWdpc3RlcnMgYW4gaW5zdGFuY2UgbGlzdGVuZXIgdW5kZXIgaXRzIHBlbmRpbmcgaWRlbnRpdHkgd2hpbGUgcmV0YWluaW5nIGl0cyBwZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gaW5zdGFuY2UgLSBJbnN0YW5jZSBiZWluZyByZS1rZXllZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IHByZXZpb3VzSWRlbnRpdHkgLSBQZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBuZXh0SWRlbnRpdHkgLSBQZW5kaW5nIGlkZW50aXR5IHNlbnQgdG8gdGhlIHNlcnZlci5cbiAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSAtIENhbGxiYWNrIHRoYXQgcmVtb3ZlcyB0aGUgdGVtcG9yYXJ5IGFsaWFzZXMuXG4gKi9cbmZ1bmN0aW9uIGFsaWFzRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKE1vZGVsQ2xhc3MsIGluc3RhbmNlLCBwcmV2aW91c0lkZW50aXR5LCBuZXh0SWRlbnRpdHkpIHtcbiAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gIGNvbnN0IHByZXZpb3VzSWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkZW50aXR5KVxuICBjb25zdCBuZXh0SWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBuZXh0SWRlbnRpdHkpXG4gIC8qKiBAdHlwZSB7QXJyYXk8e2xpc3RlbmVyOiBSZXR1cm5UeXBlPHR5cGVvZiBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcj4sIHN1YjogRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufT59ICovXG4gIGNvbnN0IGFsaWFzZXMgPSBbXVxuXG4gIGlmIChwcmV2aW91c0lkID09PSBuZXh0SWQpIHJldHVybiAoKSA9PiB7fVxuXG4gIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmdldChNb2RlbENsYXNzKVxuXG4gIGlmICghc3Vic2NyaXB0aW9ucykgcmV0dXJuICgpID0+IHt9XG5cbiAgZm9yIChjb25zdCBzdWIgb2Ygc3Vic2NyaXB0aW9ucy52YWx1ZXMoKSkge1xuICAgIGNvbnN0IGxpc3RlbmVyID0gc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChwcmV2aW91c0lkKVxuXG4gICAgaWYgKCFsaXN0ZW5lciB8fCBsaXN0ZW5lci5pbnN0YW5jZSAhPT0gaW5zdGFuY2UgfHwgc3ViLmluc3RhbmNlTGlzdGVuZXJzLmhhcyhuZXh0SWQpKSBjb250aW51ZVxuXG4gICAgc3ViLmluc3RhbmNlTGlzdGVuZXJzLnNldChuZXh0SWQsIGxpc3RlbmVyKVxuICAgIGFsaWFzZXMucHVzaCh7bGlzdGVuZXIsIHN1Yn0pXG4gIH1cblxuICByZXR1cm4gKCkgPT4ge1xuICAgIGZvciAoY29uc3Qge2xpc3RlbmVyLCBzdWJ9IG9mIGFsaWFzZXMpIHtcbiAgICAgIGlmIChzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KHByZXZpb3VzSWQpID09PSBsaXN0ZW5lciAmJiBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KG5leHRJZCkgPT09IGxpc3RlbmVyKSB7XG4gICAgICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5kZWxldGUobmV4dElkKVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIEFwcGxpZXMgYSByZW1vdGVseSBwZXJzaXN0ZWQgaWRlbnRpdHkgdG8gYSBsaXN0ZW5lciBpbnN0YW5jZSB3aXRob3V0IG1lcmdpbmcgYW4gdW5hdmFpbGFibGUgcmVjb3JkIHBheWxvYWQuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gaW5zdGFuY2UgLSBMaXN0ZW5lciBpbnN0YW5jZSByZWNlaXZpbmcgdGhlIGlkZW50aXR5LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWRlbnRpdHkgLSBQZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXBwbHlGcm9udGVuZE1vZGVsUGVyc2lzdGVkSWRlbnRpdHkoTW9kZWxDbGFzcywgaW5zdGFuY2UsIGlkZW50aXR5KSB7XG4gIGNvbnN0IGlkZW50aXR5QXR0cmlidXRlcyA9IG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGlkZW50aXR5KVxuXG4gIGluc3RhbmNlLmFzc2lnbkF0dHJpYnV0ZXMoaWRlbnRpdHlBdHRyaWJ1dGVzKVxuXG4gIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBPYmplY3Qua2V5cyhpZGVudGl0eUF0dHJpYnV0ZXMpKSB7XG4gICAgaW5zdGFuY2UubWFya0F0dHJpYnV0ZVVuY2hhbmdlZChhdHRyaWJ1dGVOYW1lKVxuICB9XG59XG5cbi8qKlxuICogTW92ZXMgY2FsbGJhY2tzIHJlZ2lzdGVyZWQgb24gYW4gaW5zdGFuY2UgdG8gaXRzIG5ld2x5IHBlcnNpc3RlZCBpZGVudGl0eS5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBpbnN0YW5jZSAtIFJlLWtleWVkIGluc3RhbmNlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gcHJldmlvdXNJZGVudGl0eSAtIFByZXZpb3VzIHBlcnNpc3RlZCBpZGVudGl0eS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IG5leHRJZGVudGl0eSAtIE5ldyBwZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gcmVrZXlGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcnMoTW9kZWxDbGFzcywgaW5zdGFuY2UsIHByZXZpb3VzSWRlbnRpdHksIG5leHRJZGVudGl0eSkge1xuICBjb25zdCBwcmltYXJ5S2V5ID0gTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgY29uc3QgcHJldmlvdXNJZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHByZXZpb3VzSWRlbnRpdHkpXG4gIGNvbnN0IG5leHRJZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIG5leHRJZGVudGl0eSlcblxuICBpZiAocHJldmlvdXNJZCA9PT0gbmV4dElkKSByZXR1cm5cblxuICBjb25zdCBzdWJzY3JpcHRpb25zID0gZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5nZXQoTW9kZWxDbGFzcylcblxuICBpZiAoIXN1YnNjcmlwdGlvbnMpIHJldHVyblxuXG4gIGZvciAoY29uc3Qgc3ViIG9mIHN1YnNjcmlwdGlvbnMudmFsdWVzKCkpIHtcbiAgICBjb25zdCBsaXN0ZW5lciA9IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQocHJldmlvdXNJZClcblxuICAgIGlmICghbGlzdGVuZXIgfHwgbGlzdGVuZXIuaW5zdGFuY2UgIT09IGluc3RhbmNlKSBjb250aW51ZVxuXG4gICAgY29uc3QgbmV4dExpc3RlbmVyID0gc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChuZXh0SWQpXG5cbiAgICBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZGVsZXRlKHByZXZpb3VzSWQpXG5cbiAgICBpZiAobmV4dExpc3RlbmVyKSB7XG4gICAgICBuZXh0TGlzdGVuZXIuaW5zdGFuY2UgPSBpbnN0YW5jZVxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBsaXN0ZW5lci51cGRhdGVDYWxsYmFja3MpIG5leHRMaXN0ZW5lci51cGRhdGVDYWxsYmFja3MuYWRkKGVudHJ5KVxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBsaXN0ZW5lci5kZXN0cm95Q2FsbGJhY2tzKSBuZXh0TGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcy5hZGQoZW50cnkpXG4gICAgfSBlbHNlIHtcbiAgICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5zZXQobmV4dElkLCBsaXN0ZW5lcilcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNvbW1hbmQgdXJsLlxuICogQHBhcmFtIHtzdHJpbmd9IHJlc291cmNlUGF0aCAtIFJlc291cmNlIHBhdGggcHJlZml4LlxuICogQHBhcmFtIHtzdHJpbmd9IGNvbW1hbmROYW1lIC0gQ29tbWFuZCBwYXRoIHNlZ21lbnQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZyb250ZW5kIG1vZGVsIEFQSSBVUkwuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxDb21tYW5kVXJsKHJlc291cmNlUGF0aCwgY29tbWFuZE5hbWUpIHtcbiAgY29uc3QgY29uZmlndXJlZFVybCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRVcmwoKVxuICBjb25zdCBub3JtYWxpemVkUmVzb3VyY2VQYXRoID0gcmVzb3VyY2VQYXRoLnN0YXJ0c1dpdGgoXCIvXCIpID8gcmVzb3VyY2VQYXRoIDogYC8ke3Jlc291cmNlUGF0aH1gXG5cbiAgcmV0dXJuIGAke2NvbmZpZ3VyZWRVcmx9JHtub3JtYWxpemVkUmVzb3VyY2VQYXRofS8ke2NvbW1hbmROYW1lfWBcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGFwaSB1cmwuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgVVJMLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQXBpVXJsKCkge1xuICByZXR1cm4gYCR7ZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybCgpfSR7U0hBUkVEX0ZST05URU5EX01PREVMX0FQSV9QQVRIfWBcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBwYXRoLlxuICogQHBhcmFtIHtzdHJpbmd9IHVybCAtIFJlcXVlc3QgVVJMIG9yIHBhdGguXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFdlYnNvY2tldC1zYWZlIHJlcXVlc3QgcGF0aC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFBhdGgodXJsKSB7XG4gIGlmICh0eXBlb2YgdXJsICE9PSBcInN0cmluZ1wiIHx8IHVybC5sZW5ndGggPCAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgVVJML3BhdGgsIGdvdDogJHt1cmx9YClcbiAgfVxuXG4gIGlmICh1cmwuc3RhcnRzV2l0aChcIi9cIikpIHtcbiAgICByZXR1cm4gdXJsXG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IHBhcnNlZFVybCA9IG5ldyBVUkwodXJsKVxuXG4gICAgcmV0dXJuIGAke3BhcnNlZFVybC5wYXRobmFtZX0ke3BhcnNlZFVybC5zZWFyY2h9YFxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdXJsXG4gIH1cbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgYnJvd3NlciBydW50aW1lIHRpbWV6b25lIHdoZW4gYXZhaWxhYmxlLlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBCcm93c2VyIHJ1bnRpbWUgdGltZXpvbmUgd2hlbiBhdmFpbGFibGUuXG4gKi9cbmZ1bmN0aW9uIGRlZmF1bHRGcm9udGVuZE1vZGVsVGltZVpvbmUoKSB7XG4gIGlmICh0eXBlb2Ygd2luZG93ID09PSBcInVuZGVmaW5lZFwiKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgY29uc3QgaW50bCA9IGdsb2JhbFRoaXMuSW50bFxuXG4gIGlmICghaW50bCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIEludGwgdG8gYmUgYXZhaWxhYmxlIGZvciBicm93c2VyIHRpbWV6b25lIGRldGVjdGlvblwiKVxuICB9XG5cbiAgaWYgKHR5cGVvZiBpbnRsLkRhdGVUaW1lRm9ybWF0ICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBJbnRsLkRhdGVUaW1lRm9ybWF0IHRvIGJlIGF2YWlsYWJsZSBhcyBhIGZ1bmN0aW9uXCIpXG4gIH1cblxuICBjb25zdCB0aW1lWm9uZSA9IGludGwuRGF0ZVRpbWVGb3JtYXQoKS5yZXNvbHZlZE9wdGlvbnMoKS50aW1lWm9uZVxuXG4gIGlmICh0eXBlb2YgdGltZVpvbmUgIT09IFwic3RyaW5nXCIgfHwgdGltZVpvbmUudHJpbSgpLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBJbnRsLkRhdGVUaW1lRm9ybWF0IHRvIHJlc29sdmUgYSBicm93c2VyIHRpbWV6b25lIHN0cmluZ1wiKVxuICB9XG5cbiAgcmV0dXJuIHZhbGlkYXRlVGltZVpvbmUodGltZVpvbmUsIFwiYnJvd3NlciB0aW1lWm9uZVwiKVxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBjb25maWd1cmVkIGZyb250ZW5kLW1vZGVsIHJlcXVlc3QgdGltZXpvbmUuXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIENvbmZpZ3VyZWQgZnJvbnRlbmQtbW9kZWwgdGltZXpvbmUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpIHtcbiAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZywgXCJ0aW1lWm9uZVwiKSkge1xuICAgIHJldHVybiBkZWZhdWx0RnJvbnRlbmRNb2RlbFRpbWVab25lKClcbiAgfVxuXG4gIGNvbnN0IHRpbWVab25lID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZVpvbmUgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lWm9uZSgpXG4gICAgOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lXG5cbiAgaWYgKHRpbWVab25lID09PSB1bmRlZmluZWQgfHwgdGltZVpvbmUgPT09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgdGltZVpvbmUgZGlkIG5vdCByZXNvbHZlIHRvIGEgdGltZXpvbmUgc3RyaW5nXCIpXG4gIH1cblxuICByZXR1cm4gdmFsaWRhdGVUaW1lWm9uZSh0aW1lWm9uZSwgXCJmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgdGltZVpvbmVcIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlcXVlc3QgaGVhZGVycy5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBbdGltZVpvbmVdIC0gUHJlLXJlc29sdmVkIHRpbWV6b25lIGZvciB0aGlzIHJlcXVlc3QuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBIZWFkZXJzIGZvciBmcm9udGVuZC1tb2RlbCBIVFRQIHJlcXVlc3RzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVxdWVzdEhlYWRlcnModGltZVpvbmUgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKSkge1xuICBjb25zdCBkeW5hbWljSGVhZGVycyA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RIZWFkZXJzID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RIZWFkZXJzKCkgfHwge30pXG4gICAgOiAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0SGVhZGVycyB8fCB7fSlcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqL1xuICBjb25zdCBoZWFkZXJzID0ge1wiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLCAuLi5keW5hbWljSGVhZGVyc31cblxuICBpZiAodGltZVpvbmUpIHtcbiAgICBoZWFkZXJzW1JFUVVFU1RfVElNRV9aT05FX0hFQURFUl0gPSB0aW1lWm9uZVxuICB9XG5cbiAgcmV0dXJuIGhlYWRlcnNcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgY29uZmlndXJlZCBib3VuZGVkIHRyYW5zcG9ydCBkZWFkbGluZSBpbiBtaWxsaXNlY29uZHMuXG4gKiBAcmV0dXJucyB7bnVtYmVyIHwgdW5kZWZpbmVkfSAtIENvbmZpZ3VyZWQgZGVhZGxpbmUsIG9yIHVuZGVmaW5lZCB3aGVuIG5vIGRlYWRsaW5lIGlzIHNldC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVvdXRNcygpIHtcbiAgY29uc3QgY29uZmlndXJlZFRpbWVvdXQgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lb3V0ID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZW91dCgpXG4gICAgOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVvdXRcblxuICBpZiAodHlwZW9mIGNvbmZpZ3VyZWRUaW1lb3V0ICE9PSBcIm51bWJlclwiIHx8ICEoY29uZmlndXJlZFRpbWVvdXQgPiAwKSkge1xuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIHJldHVybiBjb25maWd1cmVkVGltZW91dFxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBjb25maWd1cmVkIGNhbGxlci9zZXNzaW9uIEFib3J0U2lnbmFsIGNvbXBvc2VkIHdpdGggdGhlIGRlYWRsaW5lLlxuICogQHJldHVybnMge0Fib3J0U2lnbmFsIHwgdW5kZWZpbmVkfSAtIENvbmZpZ3VyZWQgY2FsbGVyIHNpZ25hbCwgb3IgdW5kZWZpbmVkIHdoZW4gbm9uZSBpcyBzZXQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRTaWduYWwgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zaWduYWwgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zaWduYWwoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zaWduYWxcblxuICByZXR1cm4gY29uZmlndXJlZFNpZ25hbCB8fCB1bmRlZmluZWRcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyBwZXItc3RhcnR1cCBjb250cm9scyB3aXRoIHRoZSBjb25maWd1cmVkIHNlc3Npb24gY2FuY2VsbGF0aW9uLlxuICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyLCBzaWduYWw/OiBBYm9ydFNpZ25hbH19IGNvbnRyb2xzIC0gQ2FsbCBjb250cm9scy5cbiAqIEByZXR1cm5zIHt7dGltZW91dE1zPzogbnVtYmVyLCBzaWduYWw/OiBBYm9ydFNpZ25hbH19IC0gRWZmZWN0aXZlIHN0YXJ0dXAgY29udHJvbHMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxXZWJzb2NrZXRTdGFydHVwQ29udHJvbHMoY29udHJvbHMpIHtcbiAgY29uc3Qgc2Vzc2lvblNpZ25hbCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKVxuICBsZXQgc2lnbmFsID0gY29udHJvbHMuc2lnbmFsIHx8IHNlc3Npb25TaWduYWxcblxuICBpZiAoY29udHJvbHMuc2lnbmFsICYmIHNlc3Npb25TaWduYWwgJiYgY29udHJvbHMuc2lnbmFsICE9PSBzZXNzaW9uU2lnbmFsKSB7XG4gICAgc2lnbmFsID0gQWJvcnRTaWduYWwuYW55KFtjb250cm9scy5zaWduYWwsIHNlc3Npb25TaWduYWxdKVxuICB9XG5cbiAgY29uc3QgY29uZmlndXJlZFRpbWVvdXRNcyA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lb3V0TXMoKVxuICBjb25zdCB0aW1lb3V0TXMgPSBjb250cm9scy50aW1lb3V0TXMgPT09IHVuZGVmaW5lZFxuICAgID8gY29uZmlndXJlZFRpbWVvdXRNc1xuICAgIDogY29uZmlndXJlZFRpbWVvdXRNcyA9PT0gdW5kZWZpbmVkXG4gICAgICA/IGNvbnRyb2xzLnRpbWVvdXRNc1xuICAgICAgOiBNYXRoLm1pbihjb250cm9scy50aW1lb3V0TXMsIGNvbmZpZ3VyZWRUaW1lb3V0TXMpXG5cbiAgcmV0dXJuIHtzaWduYWwsIHRpbWVvdXRNc31cbn1cblxuLyoqXG4gKiBSdW5zIHBlcmZvcm0gc2hhcmVkIGZyb250ZW5kIG1vZGVsIGFwaSByZXF1ZXN0LlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJlcXVlc3RQYXlsb2FkIC0gU2hhcmVkIHJlcXVlc3QgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gRGVjb2RlZCBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJIHJlc3BvbnNlLlxuICovXG5hc3luYyBmdW5jdGlvbiBwZXJmb3JtU2hhcmVkRnJvbnRlbmRNb2RlbEFwaVJlcXVlc3QocmVxdWVzdFBheWxvYWQpIHtcbiAgY29uc3QgdGltZVpvbmUgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKVxuICBjb25zdCBzZXJpYWxpemVkUmVxdWVzdFBheWxvYWQgPSBzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocmVxdWVzdFBheWxvYWQsIHt0aW1lWm9uZX0pXG4gIGNvbnN0IHdlYnNvY2tldENsaWVudCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50XG4gIGNvbnN0IHVybCA9IGZyb250ZW5kTW9kZWxBcGlVcmwoKVxuICBjb25zdCBtZXJnZWRIZWFkZXJzID0gZnJvbnRlbmRNb2RlbFJlcXVlc3RIZWFkZXJzKHRpbWVab25lKVxuXG4gIHJldHVybiBhd2FpdCBydW5XaXRoVHJhbnNwb3J0RGVhZGxpbmUoXG4gICAge1xuICAgICAgZXJyb3JNZXNzYWdlOiBcIlNoYXJlZCBmcm9udGVuZCBtb2RlbCBBUEkgcmVxdWVzdCB0aW1lZCBvdXRcIixcbiAgICAgIHNpZ25hbDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpLFxuICAgICAgdGltZW91dE1zOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKClcbiAgICB9LFxuICAgIGFzeW5jIChzaWduYWwpID0+IHtcbiAgICAgIGlmICh3ZWJzb2NrZXRDbGllbnQpIHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB3ZWJzb2NrZXRDbGllbnQucG9zdChmcm9udGVuZE1vZGVsVHJhbnNwb3J0UGF0aCh1cmwpLCBzZXJpYWxpemVkUmVxdWVzdFBheWxvYWQsIHtcbiAgICAgICAgICBoZWFkZXJzOiBtZXJnZWRIZWFkZXJzLFxuICAgICAgICAgIHNpZ25hbFxuICAgICAgICB9KVxuICAgICAgICBjb25zdCByZXNwb25zZUpzb24gPSByZXNwb25zZS5qc29uKClcblxuICAgICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShyZXNwb25zZUpzb24pKVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybCwge1xuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShzZXJpYWxpemVkUmVxdWVzdFBheWxvYWQpLFxuICAgICAgICBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIsXG4gICAgICAgIGhlYWRlcnM6IG1lcmdlZEhlYWRlcnMsXG4gICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgIHNpZ25hbFxuICAgICAgfSlcblxuICAgICAgY29uc3QgcmVzcG9uc2VUZXh0ID0gYXdhaXQgcmVzcG9uc2UudGV4dCgpXG5cbiAgICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgICAgdGhyb3dGcm9udGVuZE1vZGVsSHR0cEVycm9yKHtcbiAgICAgICAgICBjb21tYW5kTGFiZWw6IFwic2hhcmVkIGZyb250ZW5kIG1vZGVsIEFQSVwiLFxuICAgICAgICAgIHJlc3BvbnNlLFxuICAgICAgICAgIHJlc3BvbnNlVGV4dFxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCBqc29uID0gcmVzcG9uc2VUZXh0Lmxlbmd0aCA+IDAgPyBKU09OLnBhcnNlKHJlc3BvbnNlVGV4dCkgOiB7fVxuXG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShqc29uKSlcbiAgICB9XG4gIClcbn1cblxuLyoqXG4gKiBUaHJvd3MgYSBmcm9udGVuZC1tb2RlbCBIVFRQIGVycm9yIHdpdGggYmFja2VuZC1wcm92aWRlZCBlbnZlbG9wZSBkZXRhaWxzIHdoZW4gYXZhaWxhYmxlLlxuICogQHBhcmFtIHt7Y29tbWFuZExhYmVsOiBzdHJpbmcsIHJlc3BvbnNlOiBSZXNwb25zZSwgcmVzcG9uc2VUZXh0OiBzdHJpbmd9fSBhcmdzIC0gRXJyb3IgcmVzcG9uc2UgZGV0YWlscy5cbiAqIEByZXR1cm5zIHtuZXZlcn0gLSBBbHdheXMgdGhyb3dzIGFuIHVua25vd24tYXR0cmlidXRlIGVycm9yLlxuICovXG5mdW5jdGlvbiB0aHJvd0Zyb250ZW5kTW9kZWxIdHRwRXJyb3Ioe2NvbW1hbmRMYWJlbCwgcmVzcG9uc2UsIHJlc3BvbnNlVGV4dH0pIHtcbiAgLy8gU3VyZmFjZSB0aGUgYmFja2VuZCdzIGZyaWVuZGx5IGVycm9yTWVzc2FnZSBlbnZlbG9wZSAodGhlXG4gIC8vIGB7c3RhdHVzOiBcImVycm9yXCIsIGVycm9yTWVzc2FnZTogXCIuLi5cIn1gIHNoYXBlIGV2ZXJ5IGNvbnRyb2xsZXJcbiAgLy8gc2hpcHMgb24gaXRzIDR4eC81eHggcmVzcG9uc2VzKSBpbnN0ZWFkIG9mIHRoZSBnZW5lcmljIHN0YXR1c1xuICAvLyBzdHJpbmcuIEZhbGwgdGhyb3VnaCB0byB0aGUgc3RhdHVzLW9ubHkgbWVzc2FnZSB3aGVuIHRoZSBib2R5IGlzXG4gIC8vIG1pc3NpbmcsIG5vbi1KU09OLCBvciBoYXMgbm8gdXNhYmxlIGVycm9yTWVzc2FnZSBmaWVsZC5cbiAgY29uc3QgcmVzcG9uc2VDb250ZW50VHlwZSA9IHJlc3BvbnNlLmhlYWRlcnMuZ2V0KFwiY29udGVudC10eXBlXCIpXG5cbiAgaWYgKHJlc3BvbnNlQ29udGVudFR5cGUgJiYgcmVzcG9uc2VDb250ZW50VHlwZS5pbmNsdWRlcyhcImFwcGxpY2F0aW9uL2pzb25cIikgJiYgcmVzcG9uc2VUZXh0Lmxlbmd0aCA+IDApIHtcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIGVycm9yQm9keS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gKi9cbiAgICBsZXQgZXJyb3JCb2R5XG5cbiAgICB0cnkge1xuICAgICAgZXJyb3JCb2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZVRleHQpXG4gICAgfSBjYXRjaCB7XG4gICAgICBlcnJvckJvZHkgPSBudWxsXG4gICAgfVxuXG4gICAgaWYgKGVycm9yQm9keSAmJiB0eXBlb2YgZXJyb3JCb2R5LmVycm9yTWVzc2FnZSA9PT0gXCJzdHJpbmdcIiAmJiBlcnJvckJvZHkuZXJyb3JNZXNzYWdlLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JCb2R5LmVycm9yTWVzc2FnZS50cmltKCkpXG4gICAgfVxuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKGBSZXF1ZXN0IGZhaWxlZCAoJHtyZXNwb25zZS5zdGF0dXN9KSBmb3IgJHtjb21tYW5kTGFiZWx9YClcbn1cblxuLyoqXG4gKiBSdW5zIGZsdXNoIHBlbmRpbmcgc2hhcmVkIGZyb250ZW5kIG1vZGVsIHJlcXVlc3RzLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGVuZGluZyBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgcmVxdWVzdHMgZmx1c2guXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZsdXNoUGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cygpIHtcbiAgc2hhcmVkRnJvbnRlbmRNb2RlbEZsdXNoU2NoZWR1bGVkID0gZmFsc2VcblxuICBpZiAocGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cy5sZW5ndGggPCAxKSB7XG4gICAgcmVzb2x2ZUZyb250ZW5kTW9kZWxJZGxlV2FpdGVycygpXG4gICAgcmV0dXJuXG4gIH1cblxuICBjb25zdCBiYXRjaGVkUmVxdWVzdHMgPSBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzXG4gIHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMgPSBbXVxuXG4gIGNvbnN0IHVybCA9IGZyb250ZW5kTW9kZWxBcGlVcmwoKVxuICBjb25zdCByZXF1ZXN0UGF5bG9hZCA9IHtcbiAgICByZXF1ZXN0czogYmF0Y2hlZFJlcXVlc3RzLm1hcCgocmVxdWVzdCkgPT4ge1xuICAgICAgaWYgKHJlcXVlc3QuY3VzdG9tUGF0aCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvbW1hbmRUeXBlOiByZXF1ZXN0LmNvbW1hbmRUeXBlLFxuICAgICAgICAgIGN1c3RvbVBhdGg6IHJlcXVlc3QuY3VzdG9tUGF0aCxcbiAgICAgICAgICBtb2RlbDogcmVxdWVzdC5tb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICAgIHBheWxvYWQ6IHJlcXVlc3QucGF5bG9hZCxcbiAgICAgICAgICAuLi4oT2JqZWN0LmtleXMocmVxdWVzdC5yZXF1ZXN0Q29udGV4dCkubGVuZ3RoID4gMCA/IHtyZXF1ZXN0Q29udGV4dDogcmVxdWVzdC5yZXF1ZXN0Q29udGV4dH0gOiB7fSksXG4gICAgICAgICAgcmVxdWVzdElkOiByZXF1ZXN0LnJlcXVlc3RJZFxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvbW1hbmRUeXBlOiByZXF1ZXN0LmNvbW1hbmRUeXBlLFxuICAgICAgICBtb2RlbDogcmVxdWVzdC5tb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICBwYXlsb2FkOiByZXF1ZXN0LnBheWxvYWQsXG4gICAgICAgIC4uLihPYmplY3Qua2V5cyhyZXF1ZXN0LnJlcXVlc3RDb250ZXh0KS5sZW5ndGggPiAwID8ge3JlcXVlc3RDb250ZXh0OiByZXF1ZXN0LnJlcXVlc3RDb250ZXh0fSA6IHt9KSxcbiAgICAgICAgcmVxdWVzdElkOiByZXF1ZXN0LnJlcXVlc3RJZFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICBhd2FpdCB0cmFja0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0KGFzeW5jICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgdm9pZCB1cmxcbiAgICAgIGNvbnN0IGRlY29kZWRSZXNwb25zZSA9IGF3YWl0IHBlcmZvcm1TaGFyZWRGcm9udGVuZE1vZGVsQXBpUmVxdWVzdChyZXF1ZXN0UGF5bG9hZClcbiAgICAgIGNvbnN0IHJlc3BvbnNlcyA9IEFycmF5LmlzQXJyYXkoZGVjb2RlZFJlc3BvbnNlLnJlc3BvbnNlcykgPyBkZWNvZGVkUmVzcG9uc2UucmVzcG9uc2VzIDogW11cbiAgICAgIGNvbnN0IHJlc3BvbnNlc0J5SWQgPSBuZXcgTWFwKHJlc3BvbnNlcy5tYXAoKGVudHJ5KSA9PiBbZW50cnkucmVxdWVzdElkLCBlbnRyeS5yZXNwb25zZV0pKVxuXG4gICAgICBmb3IgKGNvbnN0IHJlcXVlc3Qgb2YgYmF0Y2hlZFJlcXVlc3RzKSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlUGF5bG9hZCA9IHJlc3BvbnNlc0J5SWQuZ2V0KHJlcXVlc3QucmVxdWVzdElkKVxuXG4gICAgICAgIGlmICghcmVzcG9uc2VQYXlsb2FkIHx8IHR5cGVvZiByZXNwb25zZVBheWxvYWQgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgICByZXF1ZXN0LnJlamVjdChuZXcgRXJyb3IoYE1pc3NpbmcgYmF0Y2hlZCByZXNwb25zZSBmb3IgJHtyZXF1ZXN0Lm1vZGVsQ2xhc3MubmFtZX0jJHtyZXF1ZXN0LmNvbW1hbmRUeXBlfWApKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICByZXF1ZXN0LnJlc29sdmUoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyZXNwb25zZVBheWxvYWQpKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBmb3IgKGNvbnN0IHJlcXVlc3Qgb2YgYmF0Y2hlZFJlcXVlc3RzKSB7XG4gICAgICAgIHJlcXVlc3QucmVqZWN0KGVycm9yKVxuICAgICAgfVxuICAgIH1cbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIHNjaGVkdWxlIHNoYXJlZCBmcm9udGVuZCBtb2RlbCByZXF1ZXN0IGZsdXNoLlxuICogQHJldHVybnMge3ZvaWR9ICovXG5mdW5jdGlvbiBzY2hlZHVsZVNoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0Rmx1c2goKSB7XG4gIGlmIChzaGFyZWRGcm9udGVuZE1vZGVsRmx1c2hTY2hlZHVsZWQpIHJldHVyblxuXG4gIHNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZCA9IHRydWVcbiAgcXVldWVNaWNyb3Rhc2soKCkgPT4ge1xuICAgIHZvaWQgZmx1c2hQZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzKClcbiAgfSlcbn1cblxuLyoqXG4gKiBDdXN0b20gY29tbWFuZHMgc3RpbGwgdXNlIHRoZSBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJLiBUaGlzIGhlbHBlciBvbmx5IGJ1aWxkcyB0aGUgYmFja2VuZCByb3V0ZSBwYXRoIHRoZSBzZXJ2ZXIgc2hvdWxkIGRpc3BhdGNoIGFmdGVyIHZhbGlkYXRpbmcgdGhlIHNlZ21lbnRzLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb21tYW5kTmFtZSAtIENvbW1hbmQgcGF0aCBzZWdtZW50LlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubW9kZWxOYW1lIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MgbmFtZS5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gW2FyZ3MubWVtYmVySWRdIC0gT3B0aW9uYWwgbWVtYmVyIGlkLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVzb3VyY2VQYXRoIC0gUmVzb3VyY2UgcGF0aCBwcmVmaXguXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEN1c3RvbSBiYWNrZW5kIHJvdXRlIHBhdGguXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kUGF0aCh7Y29tbWFuZE5hbWUsIG1lbWJlcklkLCBtb2RlbE5hbWUsIHJlc291cmNlUGF0aH0pIHtcbiAgY29uc3QgdmFsaWRhdGVkUmVzb3VyY2VQYXRoID0gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKHttb2RlbE5hbWUsIHJlc291cmNlUGF0aH0pXG4gIGNvbnN0IHZhbGlkYXRlZENvbW1hbmROYW1lID0gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kTmFtZSh7Y29tbWFuZE5hbWUsIGNvbW1hbmRUeXBlOiBjb21tYW5kTmFtZSwgbW9kZWxOYW1lfSlcblxuICBpZiAobWVtYmVySWQgPT09IHVuZGVmaW5lZCB8fCBtZW1iZXJJZCA9PT0gbnVsbCB8fCBtZW1iZXJJZCA9PT0gXCJcIikge1xuICAgIHJldHVybiBgJHt2YWxpZGF0ZWRSZXNvdXJjZVBhdGh9LyR7dmFsaWRhdGVkQ29tbWFuZE5hbWV9YFxuICB9XG5cbiAgcmV0dXJuIGAke3ZhbGlkYXRlZFJlc291cmNlUGF0aH0vJHtlbmNvZGVVUklDb21wb25lbnQoU3RyaW5nKG1lbWJlcklkKSl9LyR7dmFsaWRhdGVkQ29tbWFuZE5hbWV9YFxufVxuXG4vKipcbiAqIFJ1bnMgYXNzZXJ0IGZpbmQgYnkgY29uZGl0aW9ucyBzaGFwZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGNvbmRpdGlvbnMgLSBmaW5kQnkgY29uZGl0aW9ucy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnRGaW5kQnlDb25kaXRpb25zU2hhcGUoY29uZGl0aW9ucykge1xuICBpZiAoIWNvbmRpdGlvbnMgfHwgdHlwZW9mIGNvbmRpdGlvbnMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShjb25kaXRpb25zKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGV4cGVjdHMgY29uZGl0aW9ucyB0byBiZSBhIHBsYWluIG9iamVjdCwgZ290OiAke2NvbmRpdGlvbnN9YClcbiAgfVxuXG4gIGNvbnN0IGNvbmRpdGlvbnNQcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YoY29uZGl0aW9ucylcblxuICBpZiAoY29uZGl0aW9uc1Byb3RvdHlwZSAhPT0gT2JqZWN0LnByb3RvdHlwZSAmJiBjb25kaXRpb25zUHJvdG90eXBlICE9PSBudWxsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZXhwZWN0cyBjb25kaXRpb25zIHRvIGJlIGEgcGxhaW4gb2JqZWN0LCBnb3Q6ICR7Y29uZGl0aW9uc31gKVxuICB9XG5cbiAgY29uc3Qgc3ltYm9sS2V5cyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMoY29uZGl0aW9ucylcblxuICBpZiAoc3ltYm9sS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBzeW1ib2wgY29uZGl0aW9uIGtleXMgKGtleXM6ICR7c3ltYm9sS2V5cy5tYXAoKGtleSkgPT4ga2V5LnRvU3RyaW5nKCkpLmpvaW4oXCIsIFwiKX0pYClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgYXNzZXJ0IGRlZmluZWQgZmluZCBieSBjb25kaXRpb24gdmFsdWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENvbmRpdGlvbiB2YWx1ZSB0byB2YWxpZGF0ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBrZXlQYXRoIC0gS2V5IHBhdGggZm9yIGVycm9yIG91dHB1dC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnREZWZpbmVkRmluZEJ5Q29uZGl0aW9uVmFsdWUodmFsdWUsIGtleVBhdGgpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IHVuZGVmaW5lZCBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIikge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgZnVuY3Rpb24gY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN5bWJvbFwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBzeW1ib2wgY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcImJpZ2ludFwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBiaWdpbnQgY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmICFOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBub24tZmluaXRlIG51bWJlciBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHZhbHVlLmZvckVhY2goKGVudHJ5LCBpbmRleCkgPT4ge1xuICAgICAgYXNzZXJ0RGVmaW5lZEZpbmRCeUNvbmRpdGlvblZhbHVlKGVudHJ5LCBgJHtrZXlQYXRofVske2luZGV4fV1gKVxuICAgIH0pXG4gICAgcmV0dXJuXG4gIH1cblxuICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiKSB7XG4gICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3Qgb2JqZWN0VmFsdWUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHZhbHVlKVxuICAgIGNvbnN0IHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihvYmplY3RWYWx1ZSlcblxuICAgIGlmIChwcm90b3R5cGUgIT09IE9iamVjdC5wcm90b3R5cGUgJiYgcHJvdG90eXBlICE9PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IG5vbi1wbGFpbiBvYmplY3QgY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gICAgfVxuXG4gICAgY29uc3Qgc3ltYm9sS2V5cyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMob2JqZWN0VmFsdWUpXG5cbiAgICBpZiAoc3ltYm9sS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IHN5bWJvbCBjb25kaXRpb24ga2V5cyAoa2V5OiAke2tleVBhdGh9KWApXG4gICAgfVxuXG4gICAgY29uc3QgdmFsdWVPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHZhbHVlKVxuXG4gICAgT2JqZWN0LmtleXModmFsdWVPYmplY3QpLmZvckVhY2goKG5lc3RlZEtleSkgPT4ge1xuICAgICAgYXNzZXJ0RGVmaW5lZEZpbmRCeUNvbmRpdGlvblZhbHVlKHZhbHVlT2JqZWN0W25lc3RlZEtleV0sIGAke2tleVBhdGh9LiR7bmVzdGVkS2V5fWApXG4gICAgfSlcbiAgfVxufVxuXG4vKipcbiAqIEJhc2UgZnJvbnRlbmQgbW9kZWwuXG4gKlxuICogRGVmYXVsdHMgYXJlIGBhbnlgIHNvIHRoZSBiYXJlIGBGcm9udGVuZE1vZGVsQmFzZWAg4oCUIHVzZWQgdGhyb3VnaG91dCBhcyBhXG4gKiBjb25zdHJhaW50L3BhcmFtZXRlciB0eXBlIGZvciBcImFueSBmcm9udGVuZCBtb2RlbFwiIOKAlCBhY2NlcHRzIGdlbmVyYXRlZFxuICogc3ViY2xhc3NlcyBkZWNsYXJpbmcgdHlwZWQtYXR0cmlidXRlIGdlbmVyaWNzIChgRnJvbnRlbmRNb2RlbEJhc2U8WEF0dHJpYnV0ZXMsXG4gKiAuLi4+YCkuIEEgY29uY3JldGUgYFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT5gIGRlZmF1bHQgbWFrZXNcbiAqIHRob3NlIHN1YmNsYXNzZXMgZmFpbCBieSBpbnZhcmlhbmNlLiBTdWJjbGFzc2VzIHN0aWxsIHBhc3MgdGhlaXIgcHJlY2lzZVxuICogYXR0cmlidXRlIHR5cGVkZWZzLCBzbyB0eXBlZCBhY2Nlc3NvcnMga2VlcCB0aGVpciBwcmVjaXNpb24uXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW0F0dHJpYnV0ZXM9YW55XVxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtDcmVhdGVBdHRyaWJ1dGVzPWFueV1cbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbVXBkYXRlQXR0cmlidXRlcz1hbnldXG4gKiBAdGVtcGxhdGUge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBbUHJpbWFyeUtleVZhbHVlPWltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlXVxuICogQHRlbXBsYXRlIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gW0V2ZW50UHJpbWFyeUtleVZhbHVlPVByaW1hcnlLZXlWYWx1ZV1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRnJvbnRlbmRNb2RlbEJhc2Uge1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgbW9kZWxOYW1lXG5cbiAgLyoqXG4gICAqIEF1dG9sb2FkLlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gLSBHbG9iYWwgYXV0by1iYXRjaC1wcmVsb2FkIHRvZ2dsZS4gQXBwcyBjYW4gb3B0IG91dCB2aWEgRnJvbnRlbmRNb2RlbEJhc2Uuc2V0QXV0b2xvYWQoZmFsc2UpLlxuICAgKi9cbiAgc3RhdGljIF9hdXRvbG9hZCA9IHRydWVcblxuICAvKipcbiAgICogUnVucyBnZXQgYXV0b2xvYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGF1dG8tYmF0Y2gtcHJlbG9hZCBvZiByZWxhdGlvbnNoaXBzIG9uIGxhenkgYWNjZXNzIGlzIGVuYWJsZWQgZ2xvYmFsbHkuXG4gICAqL1xuICBzdGF0aWMgZ2V0QXV0b2xvYWQoKSB7IHJldHVybiBGcm9udGVuZE1vZGVsQmFzZS5fYXV0b2xvYWQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhdXRvbG9hZC5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdWYWx1ZSAtIFdoZXRoZXIgYXV0by1iYXRjaC1wcmVsb2FkIG9mIHJlbGF0aW9uc2hpcHMgaXMgZW5hYmxlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgc2V0QXV0b2xvYWQobmV3VmFsdWUpIHsgRnJvbnRlbmRNb2RlbEJhc2UuX2F1dG9sb2FkID0gbmV3VmFsdWUgfVxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqL1xuICBfYXR0cmlidXRlc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXA8RnJvbnRlbmRNb2RlbEJhc2UsIEZyb250ZW5kTW9kZWxCYXNlLCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+PiB8IEZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcDxGcm9udGVuZE1vZGVsQmFzZSwgRnJvbnRlbmRNb2RlbEJhc2UsIFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4+Pn0gKi9cbiAgX3JlbGF0aW9uc2hpcHNcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRhY2htZW50SGFuZGxlPn0gKi9cbiAgX2F0dGFjaG1lbnRzXG4gIC8qKlxuICAgKiBSYWlscy1zdHlsZSBuZXN0ZWQgYXR0cmlidXRlIHBheWxvYWRzIHF1ZXVlZCBmb3IgdGhlIG5leHQgc2F2ZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn1cbiAgICovXG4gIF9wZW5kaW5nTmVzdGVkQXR0cmlidXRlc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7U2V0PHN0cmluZz4gfCBudWxsfSAqL1xuICBfc2VsZWN0ZWRBdHRyaWJ1dGVzXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtib29sZWFufSAqL1xuICBfaXNOZXdSZWNvcmRcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gIF9tYXJrZWRGb3JEZXN0cnVjdGlvblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi9cbiAgX3BlcnNpc3RlZEF0dHJpYnV0ZXNcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxCYXNlPiB8IHVuZGVmaW5lZH0gLSBTaGFyZWQgcmVmZXJlbmNlIHRvIHNpYmxpbmcgcmVjb3JkcyBsb2FkZWQgaW4gdGhlIHNhbWUgYmF0Y2guIFVzZWQgYnkgYXV0by1iYXRjaC1wcmVsb2FkLlxuICAgKi9cbiAgX2xvYWRDb2hvcnRcbiAgLyoqXG4gICAqIENhbm9uaWNhbCBiYWNraW5nLXJlY29yZCBhdHRhY2htZW50IG93bmVyIHJldHVybmVkIGJ5IHRoZSBzZXJ2ZXIuXG4gICAqIEB0eXBlIHt7cmVjb3JkSWQ6IHN0cmluZywgcmVjb3JkVHlwZTogc3RyaW5nLCByZXNvdXJjZU5hbWU6IHN0cmluZ30gfCBudWxsfVxuICAgKi9cbiAgX2F0dGFjaG1lbnRPd25lclxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0F0dHJpYnV0ZXMgfCBDcmVhdGVBdHRyaWJ1dGVzfSBbYXR0cmlidXRlc10gLSBJbml0aWFsIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihhdHRyaWJ1dGVzKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuXG4gICAgTW9kZWxDbGFzcy5lbnN1cmVHZW5lcmF0ZWRBdHRhY2htZW50TWV0aG9kcygpXG4gICAgdGhpcy5fYXR0cmlidXRlcyA9IHt9XG4gICAgdGhpcy5fcmVsYXRpb25zaGlwcyA9IHt9XG4gICAgdGhpcy5fYXR0YWNobWVudHMgPSB7fVxuICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICB0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMgPSBudWxsXG4gICAgdGhpcy5faXNOZXdSZWNvcmQgPSB0cnVlXG4gICAgdGhpcy5fbWFya2VkRm9yRGVzdHJ1Y3Rpb24gPSBmYWxzZVxuICAgIHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIHRoaXMuX2F0dGFjaG1lbnRPd25lciA9IG51bGxcbiAgICBpZiAoYXR0cmlidXRlcykgdGhpcy5hc3NpZ25BdHRyaWJ1dGVzKGF0dHJpYnV0ZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgZ2VuZXJhdGVkIGF0dGFjaG1lbnQgbWV0aG9kcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge3ZvaWR9IC0gRW5zdXJlcyBhdHRhY2htZW50IGhlbHBlciBtZXRob2RzIGV4aXN0IG9uIHRoZSBwcm90b3R5cGUuXG4gICAqL1xuICBzdGF0aWMgZW5zdXJlR2VuZXJhdGVkQXR0YWNobWVudE1ldGhvZHMoKSB7XG4gICAgaWYgKHRoaXMuX2dlbmVyYXRlZEF0dGFjaG1lbnRNZXRob2RzKSByZXR1cm5cblxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gdGhpcy5hdHRhY2htZW50RGVmaW5pdGlvbnMoKVxuICAgIGNvbnN0IHByb3RvdHlwZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodGhpcy5wcm90b3R5cGUpXG5cbiAgICBmb3IgKGNvbnN0IGF0dGFjaG1lbnROYW1lIG9mIE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKSkge1xuICAgICAgaWYgKCEoYXR0YWNobWVudE5hbWUgaW4gcHJvdG90eXBlKSkge1xuICAgICAgICBwcm90b3R5cGVbYXR0YWNobWVudE5hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX2dlbmVyYXRlZEF0dGFjaG1lbnRNZXRob2RzID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnfSAtIFJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBzdGF0aWMgcmVzb3VyY2VDb25maWcoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwicmVzb3VyY2VDb25maWcoKSBtdXN0IGJlIGltcGxlbWVudGVkIGJ5IHN1YmNsYXNzZXNcIilcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tdW5yZWFjaGFibGVcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzc2VzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbENsYXNzIHwgc3RyaW5nPn0gLSBSZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3NlcyAob3IgY2xhc3MgbmFtZSBzdHJpbmdzKSBrZXllZCBieSByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICovXG4gIHN0YXRpYyByZWxhdGlvbnNoaXBNb2RlbENsYXNzZXMoKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXIgYSBmcm9udGVuZCBtb2RlbCBjbGFzcyBzbyBpdCBjYW4gYmUgcmVzb2x2ZWQgYnkgbmFtZSBpbiByZWxhdGlvbnNoaXAgbG9va3Vwcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB0byByZWdpc3Rlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgcmVnaXN0ZXJNb2RlbChtb2RlbENsYXNzKSB7XG4gICAgcmVnaXN0ZXJGcm9udGVuZE1vZGVsKG1vZGVsQ2xhc3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWZpbmUgc2NvcGUuXG4gICAqIEBwYXJhbSB7KC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGNhbGxiYWNrIC0gU2NvcGUgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHsoKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PEZyb250ZW5kTW9kZWxDbGFzcz4pICYge3Njb3BlOiAoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1zY29wZS5qc1wiKS5Nb2RlbFNjb3BlRGVzY3JpcHRvcn19IC0gU2NvcGUgaGVscGVyLlxuICAgKi9cbiAgc3RhdGljIGRlZmluZVNjb3BlKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGRlZmluZU1vZGVsU2NvcGUoe1xuICAgICAgY2FsbGJhY2ssXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgc3RhcnRRdWVyeTogKCkgPT4gdGhpcy5xdWVyeSgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlIGEgcmVsYXRpb25zaGlwIG1vZGVsIGNsYXNzIHZhbHVlIHRoYXQgbWF5IGJlIGEgY2xhc3MgcmVmZXJlbmNlIG9yIGEgc3RyaW5nIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzIHwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZH0gdmFsdWUgLSBDbGFzcyBvciBjbGFzcyBuYW1lLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbENsYXNzIHwgbnVsbH0gLSBSZXNvbHZlZCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIHN0YXRpYyByZXNvbHZlTW9kZWxDbGFzcyh2YWx1ZSkge1xuICAgIHJldHVybiByZXNvbHZlRnJvbnRlbmRNb2RlbENsYXNzKHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIGRlZmluaXRpb25zLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywge3R5cGU6IFwiYmVsb25nc1RvXCIgfCBcImhhc09uZVwiIHwgXCJoYXNNYW55XCIsIGF1dG9sb2FkPzogYm9vbGVhbn0+fSAtIFJlbGF0aW9uc2hpcCBkZWZpbml0aW9ucyBrZXllZCBieSByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICovXG4gIHN0YXRpYyByZWxhdGlvbnNoaXBEZWZpbml0aW9ucygpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaG1lbnQgZGVmaW5pdGlvbnMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0YWNobWVudERlZmluaXRpb24+fSAtIEF0dGFjaG1lbnQgZGVmaW5pdGlvbnMga2V5ZWQgYnkgYXR0YWNobWVudCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGF0dGFjaG1lbnREZWZpbml0aW9ucygpIHtcbiAgICByZXR1cm4gdGhpcy5yZXNvdXJjZUNvbmZpZygpLmF0dGFjaG1lbnRzIHx8IHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2htZW50IGRlZmluaXRpb24uXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxBdHRhY2htZW50RGVmaW5pdGlvbiB8IG51bGx9IC0gQXR0YWNobWVudCBkZWZpbml0aW9uLlxuICAgKi9cbiAgc3RhdGljIGF0dGFjaG1lbnREZWZpbml0aW9uKGF0dGFjaG1lbnROYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuYXR0YWNobWVudERlZmluaXRpb25zKClbYXR0YWNobWVudE5hbWVdIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBkZWZpbml0aW9uLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7e3R5cGU6IFwiYmVsb25nc1RvXCIgfCBcImhhc09uZVwiIHwgXCJoYXNNYW55XCIsIGF1dG9sb2FkPzogYm9vbGVhbn0gfCBudWxsfSAtIFJlbGF0aW9uc2hpcCBkZWZpbml0aW9uLlxuICAgKi9cbiAgc3RhdGljIHJlbGF0aW9uc2hpcERlZmluaXRpb24ocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IGRlZmluaXRpb25zID0gdGhpcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9ucygpXG5cbiAgICByZXR1cm4gZGVmaW5pdGlvbnNbcmVsYXRpb25zaGlwTmFtZV0gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgUmFpbHMtc3R5bGUgbmVzdGVkIGF0dHJpYnV0ZXMga2V5IHRvIGEgY29uZmlndXJlZCByZWxhdGlvbnNoaXAuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQ2FuZGlkYXRlIGF0dHJpYnV0ZSBuYW1lLCBzdWNoIGFzIGB0YXNrc0F0dHJpYnV0ZXNgLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gUmVsYXRpb25zaGlwIG5hbWUgd2hlbiBuZXN0ZWQgYXR0cmlidXRlcyBhcmUgY29uZmlndXJlZC5cbiAgICovXG4gIHN0YXRpYyBuZXN0ZWRBdHRyaWJ1dGVzUmVsYXRpb25zaGlwTmFtZShhdHRyaWJ1dGVOYW1lKSB7XG4gICAgaWYgKCFhdHRyaWJ1dGVOYW1lLmVuZHNXaXRoKFwiQXR0cmlidXRlc1wiKSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgPSBhdHRyaWJ1dGVOYW1lLnNsaWNlKDAsIC1cIkF0dHJpYnV0ZXNcIi5sZW5ndGgpXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlc0NvbmZpZyA9IHRoaXMucmVzb3VyY2VDb25maWcoKS5uZXN0ZWRBdHRyaWJ1dGVzIHx8IHt9XG5cbiAgICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG5lc3RlZEF0dHJpYnV0ZXNDb25maWcsIHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICA/IHJlbGF0aW9uc2hpcE5hbWVcbiAgICAgIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIG1vZGVsIGNsYXNzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbENsYXNzIHwgbnVsbH0gLSBUYXJnZXQgcmVsYXRpb25zaGlwIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIHJlbGF0aW9uc2hpcE1vZGVsQ2xhc3MocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcE1vZGVsQ2xhc3NlcyA9IHRoaXMucmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzKClcbiAgICBjb25zdCB2YWx1ZSA9IHJlbGF0aW9uc2hpcE1vZGVsQ2xhc3Nlc1tyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgcmV0dXJuIEZyb250ZW5kTW9kZWxCYXNlLnJlc29sdmVNb2RlbENsYXNzKHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge0F0dHJpYnV0ZXN9IC0gQXR0cmlidXRlcyBoYXNoLlxuICAgKi9cbiAgYXR0cmlidXRlcygpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtBdHRyaWJ1dGVzfSAqLyAodGhpcy5fYXR0cmlidXRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIG5ldyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBtb2RlbCBoYXMgbm90IHlldCBiZWVuIHBlcnNpc3RlZC5cbiAgICovXG4gIGlzTmV3UmVjb3JkKCkge1xuICAgIHJldHVybiB0aGlzLl9pc05ld1JlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgcGVyc2lzdGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgbW9kZWwgaGFzIGJlZW4gcGVyc2lzdGVkLlxuICAgKi9cbiAgaXNQZXJzaXN0ZWQoKSB7XG4gICAgcmV0dXJuICF0aGlzLmlzTmV3UmVjb3JkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBpcyBuZXcgcmVjb3JkLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld0lzTmV3UmVjb3JkIC0gTmV3IHBlcnNpc3RlZC1zdGF0ZSBmbGFnLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldElzTmV3UmVjb3JkKG5ld0lzTmV3UmVjb3JkKSB7XG4gICAgdGhpcy5faXNOZXdSZWNvcmQgPSBuZXdJc05ld1JlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIHRoaXMgcmVjb3JkIGZvciBkZXN0cnVjdGlvbiB3aGVuIGl0cyBwYXJlbnQgaXMgbmV4dCBzYXZlZCB0aHJvdWdoXG4gICAqIG5lc3RlZC1hdHRyaWJ1dGUgc3VwcG9ydC4gVGhlIHJlY29yZCBpcyBub3QgcmVtb3ZlZCBmcm9tIHRoZSBwYXJlbnQnc1xuICAgKiByZWxhdGlvbnNoaXAgY29sbGVjdGlvbiB1bnRpbCB0aGUgc2VydmVyIGNvbmZpcm1zIHRoZSBkZWxldGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIG1hcmtGb3JEZXN0cnVjdGlvbigpIHtcbiAgICB0aGlzLl9tYXJrZWRGb3JEZXN0cnVjdGlvbiA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmtlZCBmb3IgZGVzdHJ1Y3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyByZWNvcmQgaXMgcXVldWVkIGZvciBuZXN0ZWQgZGVzdHJ1Y3Rpb24gb24gbmV4dCBwYXJlbnQgc2F2ZS5cbiAgICovXG4gIG1hcmtlZEZvckRlc3RydWN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9tYXJrZWRGb3JEZXN0cnVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2hhbmdlcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gQ2hhbmdlZCBhdHRyaWJ1dGVzIGFzIGBbb2xkVmFsdWUsIG5ld1ZhbHVlXWAuXG4gICAqL1xuICBjaGFuZ2VzKCkge1xuICAgIC8qKlxuICAgICAqIENoYW5nZWQgYXR0cmlidXRlcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCBjaGFuZ2VkQXR0cmlidXRlcyA9IHt9XG4gICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBuZXcgU2V0KFtcbiAgICAgIC4uLk9iamVjdC5rZXlzKHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXMpLFxuICAgICAgLi4uT2JqZWN0LmtleXModGhpcy5fYXR0cmlidXRlcylcbiAgICBdKVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIGF0dHJpYnV0ZU5hbWVzKSB7XG4gICAgICBjb25zdCBwcmV2aW91c1ZhbHVlID0gdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuICAgICAgY29uc3QgY3VycmVudFZhbHVlID0gdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuXG4gICAgICBpZiAoSlNPTi5zdHJpbmdpZnkoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHByZXZpb3VzVmFsdWUpKSAhPT0gSlNPTi5zdHJpbmdpZnkoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGN1cnJlbnRWYWx1ZSkpKSB7XG4gICAgICAgIGNoYW5nZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gW3ByZXZpb3VzVmFsdWUsIGN1cnJlbnRWYWx1ZV1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gY2hhbmdlZEF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGNoYW5nZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYW55IHRyYWNrZWQgYXR0cmlidXRlIGhhcyBjaGFuZ2VkLlxuICAgKi9cbiAgaXNDaGFuZ2VkKCkge1xuICAgIHJldHVybiBPYmplY3Qua2V5cyh0aGlzLmNoYW5nZXMoKSkubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcCBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gLSBSZWxhdGlvbnNoaXAgc3RhdGUgb2JqZWN0LlxuICAgKi9cbiAgZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBpZiAoIXRoaXMuX3JlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV0pIHtcbiAgICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcERlZmluaXRpb24gPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcERlZmluaXRpb24ocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcE1vZGVsQ2xhc3MocmVsYXRpb25zaGlwTmFtZSlcblxuICAgICAgaWYgKHJlbGF0aW9uc2hpcERlZmluaXRpb24gJiYgcmVsYXRpb25zaGlwVHlwZUlzQ29sbGVjdGlvbihyZWxhdGlvbnNoaXBEZWZpbml0aW9uLnR5cGUpKSB7XG4gICAgICAgIHRoaXMuX3JlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV0gPSBuZXcgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXAodGhpcywgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzcylcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuX3JlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV0gPSBuZXcgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwKHRoaXMsIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3MpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3JlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50IGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxBdHRhY2htZW50SGFuZGxlfSAtIEF0dGFjaG1lbnQgaGVscGVyLlxuICAgKi9cbiAgZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24oYXR0YWNobWVudE5hbWUpXG5cbiAgICBpZiAoIWF0dGFjaG1lbnREZWZpbml0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gYXR0YWNobWVudDogJHtNb2RlbENsYXNzLm5hbWV9IyR7YXR0YWNobWVudE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXSkge1xuICAgICAgdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdID0gbmV3IEZyb250ZW5kTW9kZWxBdHRhY2htZW50SGFuZGxlKHtcbiAgICAgICAgYXR0YWNobWVudE5hbWUsXG4gICAgICAgIG1vZGVsOiB0aGlzXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZE1vZGVsQmFzZSB8IEFycmF5PEZyb250ZW5kTW9kZWxCYXNlPiB8IG51bGw+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqL1xuICBhc3luYyBsb2FkUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgaWQgPSB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpXG4gICAgY29uc3QgcmVsb2FkZWRNb2RlbCA9IGF3YWl0IE1vZGVsQ2xhc3NcbiAgICAgIC5wcmVsb2FkKFtyZWxhdGlvbnNoaXBOYW1lXSlcbiAgICAgIC5maW5kKGlkKVxuICAgIGNvbnN0IHNvdXJjZVJlbGF0aW9uc2hpcCA9IHJlbG9hZGVkTW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgY29uc3QgdGFyZ2V0UmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGNvcHlMb2FkZWRSZWxhdGlvbnNoaXBWYWx1ZSh7c291cmNlUmVsYXRpb25zaGlwLCB0YXJnZXRSZWxhdGlvbnNoaXB9KVxuXG4gICAgcmV0dXJuIHRhcmdldFJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFByZWxvYWRzIHJlbGF0aW9uc2hpcChzKSBvbnRvIHRoaXMgYWxyZWFkeS1sb2FkZWQgcmVjb3JkLiBBY2NlcHRzIGVpdGhlciBhXG4gICAqIHF1ZXJ5IGJ1aWx0IHZpYSBgTW9kZWwucHJlbG9hZCguLi4pLnNlbGVjdCguLi4pYCBvciBhIHJhdyBwcmVsb2FkIHNwZWNcbiAgICogKHN0cmluZyAvIGFycmF5IC8gbmVzdGVkIG9iamVjdCkuIFJlbGF0aW9uc2hpcHMgYWxyZWFkeSBwcmVsb2FkZWQgd2l0aCB0aGVcbiAgICogcmVxdWlyZWQgY29sdW1ucyBwcmVzZW50IGFyZSBsZWZ0IHVudG91Y2hlZCB1bmxlc3MgYGZvcmNlYCBpcyBzZXQuIENhcnJpZXNcbiAgICogdGhlIHF1ZXJ5J3MgcHJlbG9hZCBncmFwaCwgc2VsZWN0LCBzZWxlY3RzRXh0cmEsIHdpdGhDb3VudCwgYWJpbGl0aWVzLCBhbmRcbiAgICogcXVlcnlEYXRhIHdoZW4gcmUtZmV0Y2hpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PEZyb250ZW5kTW9kZWxDbGFzcz4gfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHF1ZXJ5T3JTcGVjIC0gUHJlbG9hZCBzb3VyY2UuXG4gICAqIEBwYXJhbSB7e2ZvcmNlPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcHJlbG9hZGluZyBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBwcmVsb2FkKHF1ZXJ5T3JTcGVjLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCBGcm9udGVuZE1vZGVsUHJlbG9hZGVyLnByZWxvYWQoW3RoaXNdLCBxdWVyeU9yU3BlYywgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBvciBsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZE1vZGVsQmFzZSB8IEFycmF5PEZyb250ZW5kTW9kZWxCYXNlPiB8IG51bGw+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqL1xuICBhc3luYyByZWxhdGlvbnNoaXBPckxvYWQocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAocmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSB7XG4gICAgICByZXR1cm4gcmVsYXRpb25zaGlwLmxvYWRlZCgpXG4gICAgfVxuXG4gICAgY29uc3QgYmF0Y2hlZCA9IGF3YWl0IHRoaXMuX3RyeUNvaG9ydFByZWxvYWQocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChiYXRjaGVkKSByZXR1cm4gcmVsYXRpb25zaGlwLmxvYWRlZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUpXG4gIH1cblxuICAvKipcbiAgICogQXR0ZW1wdHMgdG8gYmF0Y2gtbG9hZCBgcmVsYXRpb25zaGlwTmFtZWAgYWNyb3NzIGNvaG9ydCBzaWJsaW5ncyB2aWEgYVxuICAgKiBzaW5nbGUgYHByZWxvYWQoW25hbWVdKS53aGVyZSh7cGs6IFtpZHNdfSkudG9BcnJheSgpYCByZXF1ZXN0LCB0aGVuIGNvcGllc1xuICAgKiB0aGUgcHJlbG9hZGVkIHJlbGF0aW9uc2hpcCBzdGF0ZSBvbnRvIGVhY2ggc2libGluZy4gUmV0dXJucyB0cnVlIHdoZW4gYVxuICAgKiBiYXRjaCByYW4sIGZhbHNlIHdoZW4gYXV0b2xvYWQgaXMgb2ZmLCB0aGVyZSBpcyBubyBjb2hvcnQsIG9yIG5vIGJhdGNoXG4gICAqIGNhbmRpZGF0ZXMgcmVtYWluLiBTaWJsaW5ncyB3aG9zZSByZWxhdGlvbnNoaXAgc3RhdGUgaXMgYWxyZWFkeSBzZXRcbiAgICogKHByZWxvYWRlZCBvciBsb2NhbGx5IG1hbmlwdWxhdGVkIHZpYSBgYnVpbGRgIC8gYHNldFJlbGF0aW9uc2hpcGApIGFyZVxuICAgKiBza2lwcGVkIHNvIHRoZWlyIGNhY2hlZC9lZGl0ZWQgdmFsdWUgaXMgcHJlc2VydmVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGEgY29ob3J0IGJhdGNoIHByZWxvYWQgcmFuLlxuICAgKi9cbiAgYXN5bmMgX3RyeUNvaG9ydFByZWxvYWQocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGlmICghRnJvbnRlbmRNb2RlbEJhc2UuZ2V0QXV0b2xvYWQoKSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgY29ob3J0ID0gdGhpcy5fbG9hZENvaG9ydFxuXG4gICAgaWYgKCFjb2hvcnQgfHwgY29ob3J0Lmxlbmd0aCA8PSAxKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcERlZmluaXRpb24ocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmICghZGVmaW5pdGlvbikgcmV0dXJuIGZhbHNlXG4gICAgaWYgKGRlZmluaXRpb24uYXV0b2xvYWQgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcblxuICAgIC8qKlxuICAgICAqIEJhdGNoLlxuICAgICAqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsQmFzZT59ICovXG4gICAgY29uc3QgYmF0Y2ggPSBbXVxuXG4gICAgLy8gRXhhY3Qgc2FtZSBjbGFzcywgcGVyc2lzdGVkLCBubyBleGlzdGluZyBpbi1tZW1vcnkgcmVsYXRpb25zaGlwIHN0YXRlLlxuICAgIC8vIGBzZXRMb2FkZWRgIHNldHMgYF9wcmVsb2FkZWQgPSB0cnVlYCBvbiBldmVyeSBtdXRhdGlvbiBwYXRoIChwcmVsb2FkLFxuICAgIC8vIHNldFJlbGF0aW9uc2hpcCwgYnVpbGQsIGFkZFRvTG9hZGVkKSwgc28gYGdldFByZWxvYWRlZCgpYCBhbG9uZSBpcyBhXG4gICAgLy8gcmVsaWFibGUgXCJhbHJlYWR5IHRvdWNoZWRcIiBzaWduYWwgb24gdGhlIGZyb250ZW5kLlxuICAgIGZvciAoY29uc3Qgc2libGluZyBvZiBjb2hvcnQpIHtcbiAgICAgIGlmIChzaWJsaW5nLmNvbnN0cnVjdG9yICE9PSBNb2RlbENsYXNzKSBjb250aW51ZVxuICAgICAgaWYgKHNpYmxpbmcuaXNOZXdSZWNvcmQoKSkgY29udGludWVcblxuICAgICAgY29uc3Qgc2libGluZ1JlbGF0aW9uc2hpcCA9IHNpYmxpbmcuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgIGlmIChzaWJsaW5nUmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSBjb250aW51ZVxuXG4gICAgICBiYXRjaC5wdXNoKHNpYmxpbmcpXG4gICAgfVxuXG4gICAgaWYgKGJhdGNoLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcblxuICAgIGlmIChBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IGJhdGNoSWRzID0gYmF0Y2gubWFwKChzaWJsaW5nKSA9PiBzaWJsaW5nLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIGNvbnN0IHJlbG9hZGVkQmF0Y2ggPSBhd2FpdCBNb2RlbENsYXNzXG4gICAgICAucHJlbG9hZChbcmVsYXRpb25zaGlwTmFtZV0pXG4gICAgICAud2hlcmUoe1twcmltYXJ5S2V5XTogYmF0Y2hJZHN9KVxuICAgICAgLnRvQXJyYXkoKVxuXG4gICAgLyoqXG4gICAgICogUmVsb2FkZWQgYnkgaWQuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIEZyb250ZW5kTW9kZWxCYXNlPn0gKi9cbiAgICBjb25zdCByZWxvYWRlZEJ5SWQgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgcmVsb2FkZWQgb2YgcmVsb2FkZWRCYXRjaCkge1xuICAgICAgcmVsb2FkZWRCeUlkLnNldChtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCByZWxvYWRlZC5wcmltYXJ5S2V5VmFsdWUoKSksIHJlbG9hZGVkKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc2libGluZyBvZiBiYXRjaCkge1xuICAgICAgY29uc3Qga2V5ID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgc2libGluZy5wcmltYXJ5S2V5VmFsdWUoKSlcbiAgICAgIGNvbnN0IHJlbG9hZGVkID0gcmVsb2FkZWRCeUlkLmdldChrZXkpXG5cbiAgICAgIGlmICghcmVsb2FkZWQpIGNvbnRpbnVlXG5cbiAgICAgIGNvcHlMb2FkZWRSZWxhdGlvbnNoaXBWYWx1ZSh7XG4gICAgICAgIHNvdXJjZVJlbGF0aW9uc2hpcDogcmVsb2FkZWQuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpLFxuICAgICAgICB0YXJnZXRSZWxhdGlvbnNoaXA6IHNpYmxpbmcuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICB9KVxuICAgIH1cblxuICAgIC8vIElmIHRoZSBjYWxsZXIgaXRzZWxmIHdhcyBub3QgcG9wdWxhdGVkIChyZWNvcmQgZGVsZXRlZC9maWx0ZXJlZCBiZXR3ZWVuXG4gICAgLy8gdGhlIGxpc3QgZmV0Y2ggYW5kIHRoaXMgcHJlbG9hZCByZXF1ZXN0KSwgZmFsbCBiYWNrIHRvIHBlci1yZWNvcmQgbG9hZFxuICAgIC8vIHNvIHRoZSBjYWxsZXIgZ2V0cyBhIHJlYWwgbm90LWZvdW5kIGVycm9yIGluc3RlYWQgb2YgYSBtaXNsZWFkaW5nXG4gICAgLy8gXCJoYXNuJ3QgYmVlbiBwcmVsb2FkZWRcIiB0aHJvdyBmcm9tIGxvYWRlZCgpLlxuICAgIGlmICghdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkuZ2V0UHJlbG9hZGVkKCkpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2UgfCBudWxsIHwgdW5kZWZpbmVkfSByZWxhdGlvbnNoaXBWYWx1ZSAtIFJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxCYXNlIHwgbnVsbCB8IHVuZGVmaW5lZH0gLSBBc3NpZ25lZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqL1xuICBzZXRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwVmFsdWUpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwRGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXBEZWZpbml0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcmVsYXRpb25zaGlwOiAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChyZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3Qgc2V0IGhhcy1tYW55IHJlbGF0aW9uc2hpcCB3aXRoIHNldFJlbGF0aW9uc2hpcCgpOiAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgcmVsYXRpb25zaGlwLnNldExvYWRlZChyZWxhdGlvbnNoaXBWYWx1ZSlcblxuICAgIHJldHVybiByZWxhdGlvbnNoaXBWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXNzaWduIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7QXR0cmlidXRlcyB8IENyZWF0ZUF0dHJpYnV0ZXMgfCBVcGRhdGVBdHRyaWJ1dGVzIHwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gYXR0cmlidXRlcyAtIEF0dHJpYnV0ZXMgdG8gYXNzaWduLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhc3NpZ25BdHRyaWJ1dGVzKGF0dHJpYnV0ZXMpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVWYWx1ZXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChhdHRyaWJ1dGVzKVxuXG4gICAgZm9yIChjb25zdCBrZXkgaW4gYXR0cmlidXRlVmFsdWVzKSB7XG4gICAgICB0aGlzLnNldEF0dHJpYnV0ZShrZXksIGF0dHJpYnV0ZVZhbHVlc1trZXldKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFyIHJlbGF0aW9uc2hpcCBjYWNoZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gQ2xlYXJzIGNhY2hlZCByZWxhdGlvbnNoaXAgc3RhdGUuXG4gICAqL1xuICBjbGVhclJlbGF0aW9uc2hpcENhY2hlKCkge1xuICAgIHRoaXMuX3JlbGF0aW9uc2hpcHMgPSB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbWFyeSBrZXkuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSAtIFByaW1hcnkga2V5IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gdGhpcy5yZXNvdXJjZUNvbmZpZygpLnByaW1hcnlLZXkgfHwgXCJpZFwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmltYXJ5IGtleSB2YWx1ZS5cbiAgICogQHJldHVybnMge1ByaW1hcnlLZXlWYWx1ZX0gLSBQcmltYXJ5IGtleSB2YWx1ZS5cbiAgICovXG4gIHByaW1hcnlLZXlWYWx1ZSgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtQcmltYXJ5S2V5VmFsdWV9ICovIChyZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUocHJpbWFyeUtleSwgKGF0dHJpYnV0ZU5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gdGhpcy5yZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBwcmltYXJ5IGtleSAnJHthdHRyaWJ1dGVOYW1lfScgb24gJHtNb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHZhbHVlXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc2NhbGFyIGlkZW50aXR5IHJlcXVpcmVkIGJ5IHNjYWxhci1vbmx5IGZyb250ZW5kIGZlYXR1cmVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3BlcmF0aW9uIC0gT3BlcmF0aW9uIHJlcXVpcmluZyBhIHNjYWxhciBpZGVudGl0eS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVNjYWxhcn0gLSBTY2FsYXIgcHJpbWFyeS1rZXkgdmFsdWUuXG4gICAqL1xuICBzY2FsYXJQcmltYXJ5S2V5VmFsdWUob3BlcmF0aW9uKSB7XG4gICAgcmV0dXJuIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKHRoaXMucHJpbWFyeUtleVZhbHVlKCksIG9wZXJhdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBpZGVudGl0eSByZXByZXNlbnRlZCBieSB0aGUgbGFzdCBwZXJzaXN0ZWQgZnJvbnRlbmQgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge1ByaW1hcnlLZXlWYWx1ZX0gLSBQZXJzaXN0ZWQgcHJpbWFyeS1rZXkgdmFsdWUuXG4gICAqL1xuICBwZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7UHJpbWFyeUtleVZhbHVlfSAqLyAocmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKHByaW1hcnlLZXksIChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cblxuICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHBlcnNpc3RlZCBwcmltYXJ5IGtleSAnJHthdHRyaWJ1dGVOYW1lfScgb24gJHtNb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHZhbHVlXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEF0dHJpYnV0ZSB2YWx1ZS5cbiAgICovXG4gIHJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkge1xuICAgIGlmICh0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMgJiYgIXRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcy5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBBdHRyaWJ1dGVOb3RTZWxlY3RlZEVycm9yKHRoaXMuY29uc3RydWN0b3IubmFtZSwgYXR0cmlidXRlTmFtZSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYW4gYXR0cmlidXRlIHZhbHVlIGlzIGN1cnJlbnRseSBsb2FkZWQgb24gdGhpcyByZWNvcmQuIFVzZWQgYnkgdGhlXG4gICAqIHByZWxvYWRlciB0byBkZWNpZGUgd2hldGhlciBhIHJlbGF0aW9uc2hpcCBjYW4gYmUgc2tpcHBlZCBiZWNhdXNlIHRoZVxuICAgKiByZXF1ZXN0ZWQgY29sdW1ucyBhcmUgYWxyZWFkeSBwcmVzZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBhdHRyaWJ1dGUgaXMgbG9hZGVkLlxuICAgKi9cbiAgaGFzTG9hZGVkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAoIXRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcykgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiB0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMuaGFzKGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhbiBhc3NvY2lhdGlvbiBjb3VudCBhdHRhY2hlZCBieSBgLndpdGhDb3VudCguLi4pYC4gQ291bnRzXG4gICAqIGxpdmUgb24gYSBkZWRpY2F0ZWQgbWFwIHNlcGFyYXRlIGZyb20gdGhlIHJlY29yZCdzIGF0dHJpYnV0ZXMgc29cbiAgICogYSB2aXJ0dWFsIGNvdW50IGxpa2UgYHRhc2tzQ291bnRgIGNhbid0IHNpbGVudGx5IHNoYWRvdyBhIHJlYWxcbiAgICogY29sdW1uIG9mIHRoZSBzYW1lIG5hbWUuIFJldHVybnMgdGhlIGF0dGFjaGVkIHZhbHVlLCBvciAwIHdoZW5cbiAgICogYC53aXRoQ291bnQoLi4uKWAgd2Fzbid0IHJlcXVlc3RlZCBmb3IgdGhpcyBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUsIGUuZy4gYFwidGFza3NDb3VudFwiYCBvciBhIGN1c3RvbSBuYW1lIGZyb20gYC53aXRoQ291bnQoe2N1c3RvbU5hbWU6IHsuLi59fSlgLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEF0dGFjaGVkIGFzc29jaWF0aW9uIGNvdW50LCBvciB6ZXJvIHdoZW4gYWJzZW50LlxuICAgKi9cbiAgcmVhZENvdW50KGF0dHJpYnV0ZU5hbWUpIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRBc3NvY2lhdGlvbkNvdW50KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhdHRyaWJ1dGVOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIHNldHRlciBjYWxsZWQgYnkgYGluc3RhbnRpYXRlRnJvbVJlc3BvbnNlYCB3aGVuIGh5ZHJhdGluZ1xuICAgKiBhc3NvY2lhdGlvbiBjb3VudHMgdGhhdCByb2RlIGFsb25nIHdpdGggdGhlIHJlY29yZCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBDb3VudCB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0QXNzb2NpYXRpb25Db3VudChhdHRyaWJ1dGVOYW1lLCB2YWx1ZSkge1xuICAgIHNldFBheWxvYWRBc3NvY2lhdGlvbkNvdW50KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhdHRyaWJ1dGVOYW1lLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGEgcGVyLXJlY29yZCBhYmlsaXR5IHJlc3VsdCBhdHRhY2hlZCBieSBgLmFiaWxpdGllcyguLi4pYC4gVGhlXG4gICAqIGJhY2tlbmQgZXZhbHVhdGVzIGVhY2ggcmVxdWVzdGVkIGFjdGlvbiBhZ2FpbnN0IHRoZSBjdXJyZW50XG4gICAqIGFiaWxpdHkgZm9yIHRoaXMgcmVjb3JkIGluc3RhbmNlIGFuZCBzaGlwcyB0aGUgcmVzdWx0IGFsb25nc2lkZVxuICAgKiB0aGUgcmVjb3JkJ3MgYXR0cmlidXRlcy4gUmV0dXJucyBgZmFsc2VgIHdoZW4gdGhlIGFjdGlvbiB3YXNuJ3RcbiAgICogcmVxdWVzdGVkIChvciB0aGUgYWJpbGl0eSBkZW5pZWQgaXQpLCBzbyBVSSBjb2RlIGNhbiBzYWZlbHkgYnJhbmNoXG4gICAqIG9uIGByZWNvcmQuY2FuKFwidXBkYXRlXCIpYCB3aXRob3V0IGZpcnN0IGNoZWNraW5nIHdoZXRoZXIgdGhlXG4gICAqIGFiaWxpdHkgd2FzIGxvYWRlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEFiaWxpdHkgYWN0aW9uIG5hbWUsIGUuZy4gYFwidXBkYXRlXCJgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXF1ZXN0ZWQgYWJpbGl0eSBpcyBhbGxvd2VkLlxuICAgKi9cbiAgY2FuKGFjdGlvbikge1xuICAgIHJldHVybiByZWFkUGF5bG9hZENvbXB1dGVkQWJpbGl0eSgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIHNldHRlciBjYWxsZWQgYnkgYGluc3RhbnRpYXRlRnJvbVJlc3BvbnNlYCB3aGVuIGh5ZHJhdGluZ1xuICAgKiBwZXItcmVjb3JkIGFiaWxpdHkgcmVzdWx0cyB0aGF0IHJvZGUgYWxvbmcgd2l0aCB0aGUgcmVjb3JkXG4gICAqIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbiBuYW1lLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IHZhbHVlIC0gV2hldGhlciB0aGUgY3VycmVudCBhYmlsaXR5IHBlcm1pdHMgdGhlIGFjdGlvbiBvbiB0aGlzIHJlY29yZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0Q29tcHV0ZWRBYmlsaXR5KGFjdGlvbiwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhY3Rpb24sIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgYSBjb25zdW1lci1kZWZpbmVkIHZhbHVlIGF0dGFjaGVkIGJ5IGAucXVlcnlEYXRhKC4uLilgLiBTdG9yZWRcbiAgICogb24gYSBkZWRpY2F0ZWQgbWFwIHJhdGhlciB0aGFuIGBfYXR0cmlidXRlc2AsIHNvIGEgdmlydHVhbCBhbGlhc1xuICAgKiBsaWtlIGB0YXNrc0NvdW50YCBjYW5ub3Qgc2lsZW50bHkgc2hhZG93IGEgcmVhbCBjb2x1bW4gb2YgdGhlIHNhbWVcbiAgICogbmFtZS4gUmV0dXJucyBgbnVsbGAgd2hlbiBubyByZWdpc3RlcmVkIGZuIHByb2R1Y2VkIHRoYXQgYWxpYXMgZm9yXG4gICAqIHRoaXMgcmVjb3JkIChlLmcuIG5vIGNoaWxkIHJvd3MgbWF0Y2hlZCB0aGUgYWdncmVnYXRlKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBxdWVyeURhdGEgYWxpYXMgbmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEF0dGFjaGVkIHF1ZXJ5LWRhdGEgdmFsdWUuXG4gICAqL1xuICBxdWVyeURhdGEobmFtZSkge1xuICAgIHJldHVybiByZWFkUGF5bG9hZFF1ZXJ5RGF0YSgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgbmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBzZXR0ZXIgdXNlZCBieSBgaW5zdGFudGlhdGVGcm9tUmVzcG9uc2VgIHdoZW4gaHlkcmF0aW5nXG4gICAqIHF1ZXJ5RGF0YSB2YWx1ZXMgdGhhdCByb2RlIGFsb25nIHdpdGggdGhlIHJlY29yZCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIHF1ZXJ5RGF0YSBhbGlhcyBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIEF0dGFjaGVkIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRRdWVyeURhdGEobmFtZSwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkUXVlcnlEYXRhKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBuYW1lLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG5ld1ZhbHVlIC0gTmV3IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQXNzaWduZWQgdmFsdWUuXG4gICAqL1xuICBzZXRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSwgbmV3VmFsdWUpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUgPSBNb2RlbENsYXNzLm5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICBpZiAobmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzW25lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lXSA9IG5ld1ZhbHVlXG4gICAgICByZXR1cm4gbmV3VmFsdWVcbiAgICB9XG5cbiAgICBpZiAoTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbihhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dHJpYnV0ZU5hbWUpLnF1ZXVlQXR0YWNoKG5ld1ZhbHVlKVxuICAgICAgcmV0dXJuIG5ld1ZhbHVlXG4gICAgfVxuXG4gICAgY29uc3QgcHJldmlvdXNWYWx1ZSA9IHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cblxuICAgIHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBuZXdWYWx1ZVxuXG4gICAgaWYgKHRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcykge1xuICAgICAgdGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzLmFkZChhdHRyaWJ1dGVOYW1lKVxuICAgIH1cblxuICAgIC8vIE9ubHkgaW52YWxpZGF0ZSByZWxhdGlvbnNoaXAgY2FjaGUgZW50cmllcyB3aG9zZSBmb3JlaWduIGtleSBtYXRjaGVzIHRoZSBjaGFuZ2VkIGF0dHJpYnV0ZS5cbiAgICAvLyBCbGFua2V0LWNsZWFyaW5nIGFsbCByZWxhdGlvbnNoaXBzIG9uIGFueSBhdHRyaWJ1dGUgY2hhbmdlIGRlc3Ryb3lzIG5lc3RlZC1zYXZlIHN0YXRlXG4gICAgLy8gYW5kIHByZWxvYWRlZCBjaGlsZHJlbiB0aGUgY2FsbGVyIG5ldmVyIGFza2VkIHRvIGludmFsaWRhdGUuXG4gICAgaWYgKCFPYmplY3QuaXMocHJldmlvdXNWYWx1ZSwgbmV3VmFsdWUpKSB7XG4gICAgICB0aGlzLl9pbnZhbGlkYXRlUmVsYXRpb25zaGlwc0ZvckF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKVxuICAgIH1cblxuICAgIHJldHVybiBuZXdWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIEludmFsaWRhdGVzIGFueSBjYWNoZWQgYmVsb25nc1RvIHJlbGF0aW9uc2hpcCB3aG9zZSBmb3JlaWduIGtleSBtYXRjaGVzIHRoZVxuICAgKiBjaGFuZ2VkIGF0dHJpYnV0ZS4gSGFzTWFueSAvIGhhc09uZSByZWxhdGlvbnNoaXBzIGFyZSBsZWZ0IHVudG91Y2hlZCBiZWNhdXNlXG4gICAqIHRoZWlyIGZvcmVpZ24ga2V5IGxpdmVzIG9uIHRoZSBjaGlsZCwgbm90IG9uIHRoaXMgbW9kZWwsIGFuZCBibGFua2V0LWNsZWFyaW5nXG4gICAqIHRoZW0gd291bGQgZGVzdHJveSBuZXN0ZWQtc2F2ZSBzdGF0ZSBhbmQgcHJlbG9hZGVkIGNoaWxkcmVuIHRoZSBjYWxsZXIgbmV2ZXJcbiAgICogYXNrZWQgdG8gaW52YWxpZGF0ZS5cbiAgICpcbiAgICogRm9yZWlnbiBrZXlzIGFyZSBpbmZlcnJlZCB3aGVuIG5vdCBkZWNsYXJlZDogZm9yIGJlbG9uZ3NUbyBgcHJvamVjdElkYCBpc1xuICAgKiBpbmZlcnJlZCBmcm9tIHJlbGF0aW9uc2hpcCBuYW1lIGBwcm9qZWN0YC4gRXhwbGljaXQgYGZvcmVpZ25LZXlgIG9uIHRoZVxuICAgKiByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbiB0YWtlcyBwcmVjZWRlbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lIHRoYXQgY2hhbmdlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaW52YWxpZGF0ZVJlbGF0aW9uc2hpcHNGb3JBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkge1xuICAgIGlmICghdGhpcy5fcmVsYXRpb25zaGlwcyB8fCBPYmplY3Qua2V5cyh0aGlzLl9yZWxhdGlvbnNoaXBzKS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGRlZmluaXRpb25zID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9ucygpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXModGhpcy5fcmVsYXRpb25zaGlwcykpIHtcbiAgICAgIGNvbnN0IGRlZmluaXRpb24gPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZGVmaW5pdGlvbnNbcmVsYXRpb25zaGlwTmFtZV0pXG5cbiAgICAgIGlmICghZGVmaW5pdGlvbiB8fCBkZWZpbml0aW9uLnR5cGUgIT09IFwiYmVsb25nc1RvXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGZvcmVpZ25LZXkgPSBkZWZpbml0aW9uLmZvcmVpZ25LZXkgfHwgYCR7cmVsYXRpb25zaGlwTmFtZX1JZGBcblxuICAgICAgaWYgKGZvcmVpZ25LZXkgPT09IGF0dHJpYnV0ZU5hbWUpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMuX3JlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBwYXRoLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERlcml2ZWQgcmVzb3VyY2UgcGF0aC5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZVBhdGgoKSB7XG4gICAgcmV0dXJuIHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aCh7XG4gICAgICBtb2RlbE5hbWU6IHRoaXMuZ2V0TW9kZWxOYW1lKCksXG4gICAgICByZXNvdXJjZVBhdGg6IGRlZmF1bHRGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKHRoaXMpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbW1hbmQgbmFtZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGV9IGNvbW1hbmRUeXBlIC0gQ29tbWFuZCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlc29sdmVkIGNvbW1hbmQgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBjb21tYW5kTmFtZShjb21tYW5kVHlwZSkge1xuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHJlc291cmNlQ29uZmlnLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgfHwgW11cbiAgICBjb25zdCBidWlsdEluTWVtYmVyQ29tbWFuZHMgPSByZXNvdXJjZUNvbmZpZy5idWlsdEluTWVtYmVyQ29tbWFuZHMgfHwgW11cbiAgICBjb25zdCBjb21tYW5kcyA9IHJlc291cmNlQ29uZmlnLmNvbW1hbmRzIHx8IFtdXG4gICAgY29uc3QgaXNFeHBvc2VkID0gYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcy5pbmNsdWRlcyhjb21tYW5kVHlwZSkgfHwgYnVpbHRJbk1lbWJlckNvbW1hbmRzLmluY2x1ZGVzKGNvbW1hbmRUeXBlKSB8fCBjb21tYW5kcy5pbmNsdWRlcyhjb21tYW5kVHlwZSlcbiAgICBjb25zdCBjb21tYW5kTmFtZSA9IGlzRXhwb3NlZCA/IGluZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24udW5kZXJzY29yZShjb21tYW5kVHlwZSkpIDogY29tbWFuZFR5cGVcblxuICAgIHJldHVybiB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbW1hbmROYW1lKHtcbiAgICAgIGNvbW1hbmROYW1lLFxuICAgICAgY29tbWFuZFR5cGUsXG4gICAgICBtb2RlbE5hbWU6IHRoaXMuZ2V0TW9kZWxOYW1lKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGN1c3RvbSBjb21tYW5kIHBheWxvYWQgYXJndW1lbnRzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncyAtIENvbW1hbmQgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENvbW1hbmQgcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBub3JtYWxpemVDdXN0b21Db21tYW5kUGF5bG9hZEFyZ3VtZW50cyhhcmdzKSB7XG4gICAgaWYgKGFyZ3MubGVuZ3RoID09PSAwKSByZXR1cm4ge31cbiAgICBpZiAoYXJncy5sZW5ndGggPT09IDEpIHtcbiAgICAgIGNvbnN0IHBheWxvYWQgPSBhcmdzWzBdXG4gICAgICBpZiAocGF5bG9hZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiB7fVxuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIHBheWxvYWQgIT09IFwib2JqZWN0XCIgfHwgcGF5bG9hZCA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4ge2FyZzE6IHBheWxvYWR9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHBheWxvYWQpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyIHwgc3RyaW5nIHwgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBhcmdzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgcGF5bG9hZFtgYXJnJHtpbmRleCArIDF9YF0gPSBhcmdzW2luZGV4XVxuICAgIH1cblxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbW9kZWwgbmFtZSwgcHJlZmVycmluZyBhbiBleHBsaWNpdCBgc3RhdGljIG1vZGVsTmFtZWAgZGVjbGFyYXRpb25cbiAgICogb3ZlciB0aGUgSmF2YVNjcmlwdCBjbGFzcyBgLm5hbWVgIHByb3BlcnR5LiBUaGlzIGFsbG93cyBtaW5pZmllZCBidWlsZHMgdG9cbiAgICogcHJlc2VydmUgY29ycmVjdCBtb2RlbCBuYW1lcyB3aXRob3V0IHJlbHlpbmcgb24gYGtlZXBfY2xhc3NuYW1lc2AuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIG1vZGVsIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0TW9kZWxOYW1lKCkge1xuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgbW9kZWxOYW1lID0gcmVzb3VyY2VDb25maWc/Lm1vZGVsTmFtZVxuXG4gICAgcmV0dXJuICh0eXBlb2YgbW9kZWxOYW1lID09PSBcInN0cmluZ1wiICYmIG1vZGVsTmFtZS5sZW5ndGggPiAwKSA/IG1vZGVsTmFtZSA6IHRoaXMubmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uZmlndXJlIHRyYW5zcG9ydC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnfSBjb25maWcgLSBGcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGNvbmZpZ3VyZVRyYW5zcG9ydChjb25maWcpIHtcbiAgICBpZiAoIWNvbmZpZyB8fCB0eXBlb2YgY29uZmlnICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ1cmxcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudXJsID0gY29uZmlnLnVybFxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInNoYXJlZFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zaGFyZWQgPSBjb25maWcuc2hhcmVkXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwid2Vic29ja2V0Q2xpZW50XCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCA9IGNvbmZpZy53ZWJzb2NrZXRDbGllbnRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ3ZWJzb2NrZXRVcmxcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0VXJsID0gY29uZmlnLndlYnNvY2tldFVybFxuICAgICAgLy8gUmVzZXQgY2FjaGVkIGludGVybmFsIGNsaWVudCBzbyB0aGUgbmV3IFVSTCB0YWtlcyBlZmZlY3Qgb24gbmV4dCBzdWJzY3JpYmVcbiAgICAgIHJlc2V0SW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKVxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInJlcXVlc3RIZWFkZXJzXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RIZWFkZXJzID0gY29uZmlnLnJlcXVlc3RIZWFkZXJzXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwicmVxdWVzdENvbnRleHRcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdENvbnRleHQgPSBjb25maWcucmVxdWVzdENvbnRleHRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ0aW1lb3V0XCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVvdXQgPSBjb25maWcudGltZW91dFxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInNpZ25hbFwiKSkge1xuICAgICAgaWYgKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsICE9PSBjb25maWcuc2lnbmFsKSB7XG4gICAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsID0gY29uZmlnLnNpZ25hbFxuICAgICAgICByZXNldEludGVybmFsV2Vic29ja2V0Q2xpZW50KClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ0aW1lWm9uZVwiKSkge1xuICAgICAgaWYgKGNvbmZpZy50aW1lWm9uZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGRlbGV0ZSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lID0gY29uZmlnLnRpbWVab25lXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwic2Vzc2lvblN0b3JlXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNlc3Npb25TdG9yZSA9IGNvbmZpZy5zZXNzaW9uU3RvcmVcbiAgICAgIC8vIFJlc2V0IGNhY2hlZCBpbnRlcm5hbCBjbGllbnQgc28gdGhlIG5ldyBzZXNzaW9uU3RvcmUgaXMgcGlja2VkIHVwLlxuICAgICAgcmVzZXRJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwib2ZmbGluZVN5bmNcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcub2ZmbGluZVN5bmMgPSBjb25maWcub2ZmbGluZVN5bmNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29ubmVjdCB0aGUgaW50ZXJuYWwgV2ViU29ja2V0IGFuZCBlbmFibGUgYXV0by1yZWNvbm5lY3QuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWx9fSBbb3B0aW9uc10gLSBTdGFydHVwIGNvbnRyb2xzIGNvbXBvc2VkIHdpdGggdGhlIGNvbmZpZ3VyZWQgdHJhbnNwb3J0IGNvbnRyb2xzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbm5lY3RlZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjb25uZWN0V2Vic29ja2V0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGNsaWVudCA9IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpXG5cbiAgICBpZiAoIWNsaWVudCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY29ubmVjdFdlYnNvY2tldCByZXF1aXJlcyBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldFVybH0pXCIpXG4gICAgfVxuXG4gICAgYXdhaXQgY2xpZW50LmNvbm5lY3QoZnJvbnRlbmRNb2RlbFdlYnNvY2tldFN0YXJ0dXBDb250cm9scyhvcHRpb25zKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNjb25uZWN0IHRoZSBpbnRlcm5hbCBXZWJTb2NrZXQgYW5kIGRpc2FibGUgYXV0by1yZWNvbm5lY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xvc2VkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGRpc2Nvbm5lY3RXZWJzb2NrZXQoKSB7XG4gICAgaWYgKCFpbnRlcm5hbFdlYnNvY2tldENsaWVudCkgcmV0dXJuXG5cbiAgICBjb25zdCBjbGllbnQgPSBpbnRlcm5hbFdlYnNvY2tldENsaWVudFxuXG4gICAgZGV0YWNoSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoY2xpZW50KVxuICAgIGF3YWl0IGNsaWVudC5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgdW50aWwgcXVldWVkIGFuZCBhY3RpdmUgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHJlcXVlc3RzIGZpbmlzaC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsSWRsZVdhaXRBcmdzfSBbYXJnc10gLSBXYWl0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdHJhbnNwb3J0IGlzIGlkbGUuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgd2FpdEZvcklkbGUoYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge3F1aWV0TXMgPSAwLCB0aW1lb3V0OiB0aW1lb3V0TXMgPSA1MDAwLCAuLi5yZXN0QXJnc30gPSBhcmdzXG4gICAgY29uc3QgcmVzdEFyZ0tleXMgPSBPYmplY3Qua2V5cyhyZXN0QXJncylcblxuICAgIGlmIChyZXN0QXJnS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gd2FpdEZvcklkbGUgYXJnczogJHtyZXN0QXJnS2V5cy5qb2luKFwiLCBcIil9YClcbiAgICB9XG5cbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShxdWlldE1zKSB8fCBxdWlldE1zIDwgMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCB3YWl0Rm9ySWRsZSBxdWlldE1zIHRvIGJlIGEgbm9uLW5lZ2F0aXZlIG51bWJlciwgZ290OiAke3F1aWV0TXN9YClcbiAgICB9XG5cbiAgICBhd2FpdCB0aW1lb3V0KFxuICAgICAge3RpbWVvdXQ6IHRpbWVvdXRNcywgZXJyb3JNZXNzYWdlOiBcIlRpbWVkIG91dCB3YWl0aW5nIGZvciBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgdG8gYmVjb21lIGlkbGVcIn0sXG4gICAgICBhc3luYyAoKSA9PiBhd2FpdCB3YWl0Rm9yRnJvbnRlbmRNb2RlbFRyYW5zcG9ydElkbGUocXVpZXRNcylcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY3VycmVudCBXZWJTb2NrZXQgY29ubmVjdGlvbiBzdGF0ZS5cbiAgICogQHJldHVybnMge3tkaXNjb25uZWN0ZWRTaW5jZTogbnVtYmVyIHwgbnVsbCwgaGFzQ2xpZW50OiBib29sZWFuLCBpc09wZW46IGJvb2xlYW4sIGxpc3RlbmVyQ291bnQ6IG51bWJlcn19IC0gU25hcHNob3Qgb2YgdGhlIG1hbmFnZWQgd2Vic29ja2V0IGNvbm5lY3Rpb24gc3RhdGUuXG4gICAqL1xuICBzdGF0aWMgd2Vic29ja2V0U3RhdGUoKSB7XG4gICAgaWYgKCFpbnRlcm5hbFdlYnNvY2tldENsaWVudCkge1xuICAgICAgcmV0dXJuIHtkaXNjb25uZWN0ZWRTaW5jZTogbnVsbCwgaGFzQ2xpZW50OiBmYWxzZSwgaXNPcGVuOiBmYWxzZSwgbGlzdGVuZXJDb3VudDogMH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQuc3RhdGUoKSxcbiAgICAgIGhhc0NsaWVudDogdHJ1ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZSB0aGUgcmF3IFdlYlNvY2tldCB3aXRob3V0IGRpc2FibGluZyBhdXRvLXJlY29ubmVjdC4gVXNlZCBieSB0ZXN0cyB0b1xuICAgKiBzaW11bGF0ZSBhbiB1bmV4cGVjdGVkIG5ldHdvcmsgZHJvcCBhbmQgdmVyaWZ5IHJlY29ubmVjdGlvbiBiZWhhdmlvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc29ja2V0IGhhcyBjbG9zZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZHJvcFdlYnNvY2tldCgpIHtcbiAgICBpZiAoIWludGVybmFsV2Vic29ja2V0Q2xpZW50KSByZXR1cm5cblxuICAgIGF3YWl0IGludGVybmFsV2Vic29ja2V0Q2xpZW50LmRyb3BDb25uZWN0aW9uKClcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIGdsb2JhbCBtZXRhZGF0YSBvbiB0aGUgV2ViU29ja2V0IGNvbm5lY3Rpb24uIFNlbnQgdG8gdGhlIHNlcnZlciBpbW1lZGlhdGVseVxuICAgKiBvdmVyIFdlYlNvY2tldCBhbmQgZXhwb3NlZCB0byBXZWJTb2NrZXQtYm9ybmUgcmVxdWVzdHMgYXMgcmVxdWVzdCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIE1ldGFkYXRhIGtleS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBNZXRhZGF0YSB2YWx1ZSAobnVsbCB0byBjbGVhcikuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHNldFdlYnNvY2tldE1ldGFkYXRhKGtleSwgdmFsdWUpIHtcbiAgICBjb25zdCBjbGllbnQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgfHwgcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkpXG5cbiAgICBpZiAoIWNsaWVudCB8fCB0eXBlb2YgY2xpZW50LnNldE1ldGFkYXRhICE9PSBcImZ1bmN0aW9uXCIpIHJldHVyblxuXG4gICAgY2xpZW50LnNldE1ldGFkYXRhKGtleSwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogT3BlbnMgYSBtYW5hZ2VkIGNvbm5lY3Rpb24gdGhhdCBhdXRvLW9wZW5zLCBhdXRvLWNsb3NlcywgYW5kXG4gICAqIGF1dG8tcmVjb25uZWN0cyBiYXNlZCBvbiBgc2hvdWxkQ29ubmVjdCgpYCBhbmQgYHBhcmFtcygpYC5cbiAgICogQ2FsbCBgaGFuZGxlLnN5bmMoKWAgd2hlbmV2ZXIgdGhlIGlucHV0cyB0aGF0IGRyaXZlIHRob3NlXG4gICAqIGZ1bmN0aW9ucyBjaGFuZ2UgKGUuZy4gY3VycmVudC11c2VyIHNpZ24taW4vb3V0KS4gVGhlIGhhbmRsZVxuICAgKiByZXRyaWVzIHdoZW4gdGhlIFdTIGNsaWVudCBpc24ndCByZWFkeSBhbmQgcmVvcGVucyBvbiBjbG9zZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbm5lY3Rpb25UeXBlIC0gQ29ubmVjdGlvbiBjbGFzcyBuYW1lIHJlZ2lzdGVyZWQgb24gdGhlIHNlcnZlci5cbiAgICogQHBhcmFtIHt7c2hvdWxkQ29ubmVjdDogKCkgPT4gYm9vbGVhbiwgcGFyYW1zOiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHNpZ25hbD86IEFib3J0U2lnbmFsLCBvbk1lc3NhZ2U/OiAoYm9keTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHZvaWR9fSBvcHRpb25zIC0gQ29ubmVjdGlvbiBsaWZlY3ljbGUsIGNhbmNlbGxhdGlvbiwgYW5kIHBheWxvYWQgY2FsbGJhY2tzLlxuICAgKiBAcmV0dXJucyB7e3N5bmM6ICgpID0+IHZvaWQsIGNsb3NlOiAoKSA9PiB2b2lkfX0gLSBIYW5kbGUgdXNlZCB0byByZXN5bmMgb3IgY2xvc2UgdGhlIG1hbmFnZWQgY29ubmVjdGlvbi5cbiAgICovXG4gIHN0YXRpYyBvcGVuTWFuYWdlZENvbm5lY3Rpb24oY29ubmVjdGlvblR5cGUsIG9wdGlvbnMpIHtcbiAgICAvKipcbiAgICAgKiBDb25uZWN0aW9uLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICBsZXQgY29ubmVjdGlvbiA9IG51bGxcbiAgICBsZXQgY2xvc2VkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBSZXRyeSB0aW1lci5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSAqL1xuICAgIGxldCByZXRyeVRpbWVyID0gbnVsbFxuICAgIGxldCBsYXN0UGFyYW1zSnNvbiA9IFwiXCJcbiAgICBjb25zdCBjb250cm9scyA9IGZyb250ZW5kTW9kZWxXZWJzb2NrZXRTdGFydHVwQ29udHJvbHMoe3NpZ25hbDogb3B0aW9ucy5zaWduYWx9KVxuICAgIGNvbnN0IGNsZWFyUmV0cnlUaW1lciA9ICgpID0+IHtcbiAgICAgIGlmIChyZXRyeVRpbWVyID09PSBudWxsKSByZXR1cm5cblxuICAgICAgZ2xvYmFsVGhpcy5jbGVhclRpbWVvdXQocmV0cnlUaW1lcilcbiAgICAgIHJldHJ5VGltZXIgPSBudWxsXG4gICAgfVxuXG4gICAgY29uc3QgY2xvc2UgPSAoKSA9PiB7XG4gICAgICBpZiAoY2xvc2VkKSByZXR1cm5cblxuICAgICAgY2xvc2VkID0gdHJ1ZVxuICAgICAgY2xlYXJSZXRyeVRpbWVyKClcbiAgICAgIGNvbnRyb2xzLnNpZ25hbD8ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGNsb3NlKVxuICAgICAgaWYgKGNvbm5lY3Rpb24gJiYgIWNvbm5lY3Rpb24uaXNDbG9zZWQoKSkgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgICBjb25uZWN0aW9uID0gbnVsbFxuICAgIH1cblxuICAgIGNvbnN0IHN5bmMgPSAoKSA9PiB7XG4gICAgICBpZiAoY2xvc2VkKSByZXR1cm5cblxuICAgICAgaWYgKCFvcHRpb25zLnNob3VsZENvbm5lY3QoKSkge1xuICAgICAgICBjbGVhclJldHJ5VGltZXIoKVxuICAgICAgICBpZiAoY29ubmVjdGlvbiAmJiAhY29ubmVjdGlvbi5pc0Nsb3NlZCgpKSBjb25uZWN0aW9uLmNsb3NlKClcbiAgICAgICAgY29ubmVjdGlvbiA9IG51bGxcbiAgICAgICAgbGFzdFBhcmFtc0pzb24gPSBcIlwiXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBjb25zdCBuZXh0UGFyYW1zID0gb3B0aW9ucy5wYXJhbXMoKVxuICAgICAgY29uc3QgbmV4dFBhcmFtc0pzb24gPSBKU09OLnN0cmluZ2lmeShuZXh0UGFyYW1zKVxuXG4gICAgICAvLyBBbHJlYWR5IGNvbm5lY3RlZCB3aXRoIHNhbWUgcGFyYW1zIOKAlCBub3RoaW5nIHRvIGRvLlxuICAgICAgaWYgKGNvbm5lY3Rpb24gJiYgIWNvbm5lY3Rpb24uaXNDbG9zZWQoKSAmJiBuZXh0UGFyYW1zSnNvbiA9PT0gbGFzdFBhcmFtc0pzb24pIHJldHVyblxuXG4gICAgICAvLyBDb25uZWN0ZWQgYnV0IHBhcmFtcyBjaGFuZ2VkIOKAlCBzZW5kIHVwZGF0ZSBtZXNzYWdlLlxuICAgICAgLy8gR3VhcmQgd2l0aCB0cnkvY2F0Y2g6IHRoZSBjb25uZWN0aW9uIGhhbmRsZSBzdGF5cyBsaXZlIGR1cmluZ1xuICAgICAgLy8gcmVjb25uZWN0IGJ1dCB0aGUgdW5kZXJseWluZyBzb2NrZXQgbWF5IGJlIGNsb3NlZC5cbiAgICAgIGlmIChjb25uZWN0aW9uICYmICFjb25uZWN0aW9uLmlzQ2xvc2VkKCkpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25uZWN0aW9uLnNlbmRNZXNzYWdlKG5leHRQYXJhbXMpXG4gICAgICAgICAgbGFzdFBhcmFtc0pzb24gPSBuZXh0UGFyYW1zSnNvblxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICBjb25uZWN0aW9uID0gbnVsbFxuICAgICAgICAgIGxhc3RQYXJhbXNKc29uID0gXCJcIlxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIFdTIGNsaWVudCBub3QgcmVhZHkg4oCUIHJldHJ5LiBDaGVjayB0aGUgYWN0dWFsIGNsaWVudCAod2hpY2hcbiAgICAgIC8vIG1heSBiZSBhbiBpbmplY3RlZCB3ZWJzb2NrZXRDbGllbnQpIGluc3RlYWQgb2Ygd2Vic29ja2V0U3RhdGUoKVxuICAgICAgLy8gd2hpY2ggb25seSByZWZsZWN0cyB0aGUgaW50ZXJuYWwgY2xpZW50LlxuICAgICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50IHx8IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpKVxuXG4gICAgICBpZiAoIWNsaWVudCB8fCAhY2xpZW50LmlzT3BlbigpKSB7XG4gICAgICAgIGlmIChyZXRyeVRpbWVyID09PSBudWxsKSB7XG4gICAgICAgICAgcmV0cnlUaW1lciA9IGdsb2JhbFRoaXMuc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICByZXRyeVRpbWVyID0gbnVsbFxuICAgICAgICAgICAgc3luYygpXG4gICAgICAgICAgfSwgMjUwKVxuICAgICAgICB9XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBsYXN0UGFyYW1zSnNvbiA9IG5leHRQYXJhbXNKc29uXG4gICAgICBjb25uZWN0aW9uID0gY2xpZW50Lm9wZW5Db25uZWN0aW9uKGNvbm5lY3Rpb25UeXBlLCB7XG4gICAgICAgIHBhcmFtczogbmV4dFBhcmFtcyxcbiAgICAgICAgb25NZXNzYWdlOiBvcHRpb25zLm9uTWVzc2FnZSxcbiAgICAgICAgb25DbG9zZTogKCkgPT4ge1xuICAgICAgICAgIGlmIChjb25uZWN0aW9uPy5pc0Nsb3NlZCgpKSB7XG4gICAgICAgICAgICBjb25uZWN0aW9uID0gbnVsbFxuICAgICAgICAgICAgbGFzdFBhcmFtc0pzb24gPSBcIlwiXG4gICAgICAgICAgICBzeW5jKClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29udHJvbHMuc2lnbmFsPy5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgY2xvc2UsIHtvbmNlOiB0cnVlfSlcblxuICAgIGlmIChjb250cm9scy5zaWduYWw/LmFib3J0ZWQpIHtcbiAgICAgIGNsb3NlKClcbiAgICB9IGVsc2Uge1xuICAgICAgc3luYygpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtzeW5jLCBjbG9zZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBPcGVucyBhIDE6MSBgV2Vic29ja2V0Q29ubmVjdGlvbmAgb2YgdGhlIGdpdmVuIHR5cGUuIFRoaW5cbiAgICogY29udmVuaWVuY2Ugd3JhcHBlciBhcm91bmQgdGhlIGludGVybmFsIFdTIGNsaWVudCdzXG4gICAqIGBvcGVuQ29ubmVjdGlvbmAuIEFwcHMgdXNlIHRoaXMgZm9yIHBlci1zZXNzaW9uIHN0YXRlL21lc3NhZ2luZ1xuICAgKiB0aGF0IGRvZXNuJ3QgZml0IHRoZSBwdWIvc3ViIENoYW5uZWwgbW9kZWwgKGxvY2FsZSwgcHJlc2VuY2UpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29ubmVjdGlvblR5cGUgLSBOYW1lIHRoZSBzZXJ2ZXIgcmVnaXN0ZXJlZCB0aGUgY2xhc3MgdW5kZXIuXG4gICAqIEBwYXJhbSB7e3BhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgdGltZW91dE1zPzogbnVtYmVyLCBzaWduYWw/OiBBYm9ydFNpZ25hbCwgb25Db25uZWN0PzogKCkgPT4gdm9pZCwgb25NZXNzYWdlPzogKGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB2b2lkLCBvbkRpc2Nvbm5lY3Q/OiAoKSA9PiB2b2lkLCBvblJlc3VtZT86ICgpID0+IHZvaWQsIG9uQ2xvc2U/OiAocmVhc29uOiBzdHJpbmcpID0+IHZvaWR9fSBbb3B0aW9uc10gLSBDb25uZWN0aW9uIG9wdGlvbnMsIHJlYWRpbmVzcyBjb250cm9scywgYW5kIGV2ZW50IGhhbmRsZXJzLiBDb25uZWN0IHRoZSBjbGllbnQgZmlyc3Q7IHRoZSB0aW1lb3V0IGNvdmVycyBzZXJ2ZXItY29uZmlybWVkIHJlYWRpbmVzcyBhbmQgdGhlIHNpZ25hbCBjYW5jZWxzIHJlYWRpbmVzcyB3aXRob3V0IGVudGVyaW5nIHRoZSB3aXJlIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt7cmVhZHk6IFByb21pc2U8dm9pZD4sIGNsb3NlOiAoKSA9PiB2b2lkfX0gLSBXZWJzb2NrZXQgY29ubmVjdGlvbiBoYW5kbGUuXG4gICAqL1xuICBzdGF0aWMgb3BlbldlYnNvY2tldENvbm5lY3Rpb24oY29ubmVjdGlvblR5cGUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgIGlmICghY2xpZW50IHx8IHR5cGVvZiBjbGllbnQub3BlbkNvbm5lY3Rpb24gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwib3BlbldlYnNvY2tldENvbm5lY3Rpb24gcmVxdWlyZXMgY29uZmlndXJlVHJhbnNwb3J0KHt3ZWJzb2NrZXRVcmx9KVwiKVxuICAgIH1cblxuICAgIGNvbnN0IHtzaWduYWwsIHRpbWVvdXRNcywgLi4uY29ubmVjdGlvbk9wdGlvbnN9ID0gb3B0aW9uc1xuXG4gICAgcmV0dXJuIGNsaWVudC5vcGVuQ29ubmVjdGlvbihjb25uZWN0aW9uVHlwZSwge1xuICAgICAgLi4uY29ubmVjdGlvbk9wdGlvbnMsXG4gICAgICAuLi5mcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKHtzaWduYWwsIHRpbWVvdXRNc30pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdWJzY3JpYmVzIHRvIGEgcHViL3N1YiBgV2Vic29ja2V0Q2hhbm5lbGAuIFRoaW4gd3JhcHBlciBhcm91bmRcbiAgICogdGhlIGludGVybmFsIGNsaWVudCdzIGBzdWJzY3JpYmVDaGFubmVsYC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNoYW5uZWxUeXBlIC0gQ2hhbm5lbCBjbGFzcyBuYW1lIHJlZ2lzdGVyZWQgb24gdGhlIHNlcnZlci5cbiAgICogQHBhcmFtIHt7cGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCB0aW1lb3V0TXM/OiBudW1iZXIsIHNpZ25hbD86IEFib3J0U2lnbmFsLCBvbk1lc3NhZ2U/OiAoYm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHZvaWQsIG9uRGlzY29ubmVjdD86ICgpID0+IHZvaWQsIG9uUmVzdW1lPzogKCkgPT4gdm9pZCwgb25DbG9zZT86IChyZWFzb246IHN0cmluZykgPT4gdm9pZH19IFtvcHRpb25zXSAtIENoYW5uZWwgb3B0aW9ucywgc3RhcnR1cCBjb250cm9scywgYW5kIGV2ZW50IGhhbmRsZXJzLiBUaGUgdGltZW91dCBjb3ZlcnMgY29ubmVjdCBhbmQgc2VydmVyLWNvbmZpcm1lZCByZWFkaW5lc3Mgb25seTsgdGhlIHNpZ25hbCBjYW5jZWxzIHN0YXJ0dXAgd2l0aG91dCBlbnRlcmluZyB0aGUgd2lyZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7e3JlYWR5OiBQcm9taXNlPHZvaWQ+LCBjbG9zZTogKCkgPT4gdm9pZH19IC0gV2Vic29ja2V0IGNoYW5uZWwgaGFuZGxlIGZyb20gdGhlIGNvbmZpZ3VyZWQgY2xpZW50LlxuICAgKi9cbiAgc3RhdGljIHN1YnNjcmliZVdlYnNvY2tldENoYW5uZWwoY2hhbm5lbFR5cGUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgIGlmICghY2xpZW50IHx8IHR5cGVvZiBjbGllbnQuc3Vic2NyaWJlQ2hhbm5lbCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzdWJzY3JpYmVXZWJzb2NrZXRDaGFubmVsIHJlcXVpcmVzIGNvbmZpZ3VyZVRyYW5zcG9ydCh7d2Vic29ja2V0VXJsfSlcIilcbiAgICB9XG5cbiAgICBjb25zdCB7cGFyYW1zLCBzaWduYWwsIHRpbWVvdXRNcywgLi4uY2hhbm5lbE9wdGlvbnN9ID0gb3B0aW9uc1xuICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KClcbiAgICBjb25zdCBzY29wZWRQYXJhbXMgPSBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCwgcGFyYW1zID09PSB1bmRlZmluZWQgPyB7fSA6IHBhcmFtcylcbiAgICBjb25zdCBzdGFydHVwQ29udHJvbHMgPSBmcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKHtzaWduYWwsIHRpbWVvdXRNc30pXG4gICAgY29uc3Qgc2NvcGVkUGFyYW1zT3B0aW9uID0gcGFyYW1zID09PSB1bmRlZmluZWQgJiYgT2JqZWN0LmtleXMocmVxdWVzdENvbnRleHQpLmxlbmd0aCA9PT0gMFxuICAgICAgPyB7fVxuICAgICAgOiB7cGFyYW1zOiBzY29wZWRQYXJhbXN9XG4gICAgY29uc3QgaGFuZGxlID0gY2xpZW50LnN1YnNjcmliZUNoYW5uZWwoY2hhbm5lbFR5cGUsIHsuLi5jaGFubmVsT3B0aW9ucywgLi4uc2NvcGVkUGFyYW1zT3B0aW9uLCAuLi5zdGFydHVwQ29udHJvbHN9KVxuXG4gICAgaWYgKHR5cGVvZiBjbGllbnQuY29ubmVjdCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB2b2lkIGNsaWVudC5jb25uZWN0KHN0YXJ0dXBDb250cm9scykuY2F0Y2goKCkgPT4gaGFuZGxlLmNsb3NlKCkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGhhbmRsZVxuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbGxzIFdlYlNvY2tldCBsaWZlY3ljbGUgaG9va3Mgb24gZ2xvYmFsVGhpcyBmb3Igc3lzdGVtIHRlc3QgYWNjZXNzLlxuICAgKiBUZXN0cyBjYW4gY2FsbCBgZ2xvYmFsVGhpcy5fX3ZlbG9jaW91c193ZWJzb2NrZXRfaG9va3MuY29ubmVjdCgpYCBldGMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGluc3RhbGxXZWJzb2NrZXRUZXN0SG9va3MoKSB7XG4gICAgaWYgKHR5cGVvZiBnbG9iYWxUaGlzID09PSBcInVuZGVmaW5lZFwiKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChnbG9iYWxUaGlzKS5fX3ZlbG9jaW91c193ZWJzb2NrZXRfaG9va3MgPSB7XG4gICAgICBjb25uZWN0OiAoKSA9PiB0aGlzLmNvbm5lY3RXZWJzb2NrZXQoKSxcbiAgICAgIGRpc2Nvbm5lY3Q6ICgpID0+IHRoaXMuZGlzY29ubmVjdFdlYnNvY2tldCgpLFxuICAgICAgZHJvcDogKCkgPT4gdGhpcy5kcm9wV2Vic29ja2V0KCksXG4gICAgICBzdGF0ZTogKCkgPT4gdGhpcy53ZWJzb2NrZXRTdGF0ZSgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0cmlidXRlcyBmcm9tIHJlc3BvbnNlLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge29iamVjdH0gcmVzcG9uc2UgLSBSZXNwb25zZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gLSBBdHRyaWJ1dGVzIGZyb20gcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBhdHRyaWJ1dGVzRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgY29uc3QgbW9kZWxEYXRhID0gdGhpcy5tb2RlbERhdGFGcm9tUmVzcG9uc2UocmVzcG9uc2UpXG5cbiAgICByZXR1cm4gbW9kZWxEYXRhLmF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1vZGVsIGRhdGEgZnJvbSByZXNwb25zZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtvYmplY3R9IHJlc3BvbnNlIC0gUmVzcG9uc2UgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3thYmlsaXRpZXM6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4+LCBhdHRhY2htZW50T3duZXI6IHtyZWNvcmRJZDogc3RyaW5nLCByZWNvcmRUeXBlOiBzdHJpbmcsIHJlc291cmNlTmFtZTogc3RyaW5nfSB8IG51bGwsIGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4sIGFzc29jaWF0aW9uQ291bnRzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+LCBxdWVyeURhdGE6IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4sIHByZWxvYWRlZFJlbGF0aW9uc2hpcHM6IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4sIHNlbGVjdGVkQXR0cmlidXRlczogU2V0PHN0cmluZz59fSAtIEF0dHJpYnV0ZXMsIGF0dGFjaG1lbnQgb3duZXIsIHByZWxvYWRlZCByZWxhdGlvbnNoaXBzLCBhc3NvY2lhdGlvbiBjb3VudHMsIHF1ZXJ5RGF0YSwgYWJpbGl0aWVzLCBhbmQgc2VsZWN0ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIHN0YXRpYyBtb2RlbERhdGFGcm9tUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgcmVzcG9uc2UgYnV0IGdvdDogJHtyZXNwb25zZX1gKVxuICAgIH1cblxuICAgIC8vIE5hcnJvd3MgdGhlIHJlc3BvbnNlIG9iamVjdCB0byB0aGUgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHZhbHVlIG1hcC5cbiAgICBjb25zdCByZXNwb25zZU9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKHJlc3BvbnNlKVxuXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBtb2RlbERhdGEuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovXG4gICAgbGV0IG1vZGVsRGF0YVxuXG4gICAgaWYgKHJlc3BvbnNlT2JqZWN0Lm1vZGVsICYmIHR5cGVvZiByZXNwb25zZU9iamVjdC5tb2RlbCA9PT0gXCJvYmplY3RcIikge1xuICAgICAgLy8gTmFycm93cyB0aGUgbmVzdGVkIG1vZGVsIHBheWxvYWQgdG8gdGhlIGZyb250ZW5kLW1vZGVsIHZhbHVlIG1hcC5cbiAgICAgIG1vZGVsRGF0YSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKHJlc3BvbnNlT2JqZWN0Lm1vZGVsKVxuICAgIH0gZWxzZSBpZiAocmVzcG9uc2VPYmplY3QuYXR0cmlidXRlcyAmJiB0eXBlb2YgcmVzcG9uc2VPYmplY3QuYXR0cmlidXRlcyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgLy8gTmFycm93cyB0aGUgbmVzdGVkIGF0dHJpYnV0ZXMgcGF5bG9hZCB0byB0aGUgZnJvbnRlbmQtbW9kZWwgdmFsdWUgbWFwLlxuICAgICAgbW9kZWxEYXRhID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAocmVzcG9uc2VPYmplY3QuYXR0cmlidXRlcylcbiAgICB9IGVsc2Uge1xuICAgICAgbW9kZWxEYXRhID0gcmVzcG9uc2VPYmplY3RcbiAgICB9XG5cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoey4uLm1vZGVsRGF0YX0pXG4gICAgY29uc3QgcHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IGlzUGxhaW5PYmplY3QoYXR0cmlidXRlc1tQUkVMT0FERURfUkVMQVRJT05TSElQU19LRVldKVxuICAgICAgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChhdHRyaWJ1dGVzW1BSRUxPQURFRF9SRUxBVElPTlNISVBTX0tFWV0pXG4gICAgICA6IHt9XG4gICAgY29uc3QgYXNzb2NpYXRpb25Db3VudHMgPSBpc1BsYWluT2JqZWN0KGF0dHJpYnV0ZXNbQVNTT0NJQVRJT05fQ09VTlRTX0tFWV0pXG4gICAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi8gKGF0dHJpYnV0ZXNbQVNTT0NJQVRJT05fQ09VTlRTX0tFWV0pXG4gICAgICA6IHt9XG4gICAgY29uc3QgcXVlcnlEYXRhID0gaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzW1FVRVJZX0RBVEFfS0VZXSlcbiAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoYXR0cmlidXRlc1tRVUVSWV9EQVRBX0tFWV0pXG4gICAgICA6IHt9XG4gICAgY29uc3QgYWJpbGl0aWVzID0gaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzW0FCSUxJVElFU19LRVldKVxuICAgICAgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGJvb2xlYW4+fSAqLyAoYXR0cmlidXRlc1tBQklMSVRJRVNfS0VZXSlcbiAgICAgIDoge31cbiAgICBjb25zdCBzZWxlY3RlZEF0dHJpYnV0ZXNGcm9tUGF5bG9hZCA9IEFycmF5LmlzQXJyYXkoYXR0cmlidXRlc1tTRUxFQ1RFRF9BVFRSSUJVVEVTX0tFWV0pXG4gICAgICA/IG5ldyBTZXQoLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGF0dHJpYnV0ZXNbU0VMRUNURURfQVRUUklCVVRFU19LRVldKS5maWx0ZXIoKGF0dHJpYnV0ZU5hbWUpID0+IHR5cGVvZiBhdHRyaWJ1dGVOYW1lID09PSBcInN0cmluZ1wiKSlcbiAgICAgIDogbnVsbFxuICAgIGNvbnN0IGF0dGFjaG1lbnRPd25lclBheWxvYWQgPSBhdHRyaWJ1dGVzW0FUVEFDSE1FTlRfT1dORVJfS0VZXVxuICAgIGxldCBhdHRhY2htZW50T3duZXIgPSBudWxsXG5cbiAgICBpZiAoYXR0YWNobWVudE93bmVyUGF5bG9hZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoIWlzUGxhaW5PYmplY3QoYXR0YWNobWVudE93bmVyUGF5bG9hZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgRXhwZWN0ZWQgJHtBVFRBQ0hNRU5UX09XTkVSX0tFWX0gdG8gYmUgYW4gb2JqZWN0YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgYXR0YWNobWVudE93bmVyT2JqZWN0ID0gLyoqIEB0eXBlIHt7cmVjb3JkSWQ/OiB1bmtub3duLCByZWNvcmRUeXBlPzogdW5rbm93biwgcmVzb3VyY2VOYW1lPzogdW5rbm93bn19ICovIChhdHRhY2htZW50T3duZXJQYXlsb2FkKVxuXG4gICAgICBhdHRhY2htZW50T3duZXIgPSB7XG4gICAgICAgIHJlY29yZElkOiBmb3JjZWROb25CbGFua1N0cmluZyhhdHRhY2htZW50T3duZXJPYmplY3QucmVjb3JkSWQsIGAke0FUVEFDSE1FTlRfT1dORVJfS0VZfS5yZWNvcmRJZGApLFxuICAgICAgICByZWNvcmRUeXBlOiBmb3JjZWROb25CbGFua1N0cmluZyhhdHRhY2htZW50T3duZXJPYmplY3QucmVjb3JkVHlwZSwgYCR7QVRUQUNITUVOVF9PV05FUl9LRVl9LnJlY29yZFR5cGVgKSxcbiAgICAgICAgcmVzb3VyY2VOYW1lOiBmb3JjZWROb25CbGFua1N0cmluZyhhdHRhY2htZW50T3duZXJPYmplY3QucmVzb3VyY2VOYW1lLCBgJHtBVFRBQ0hNRU5UX09XTkVSX0tFWX0ucmVzb3VyY2VOYW1lYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBkZWxldGUgYXR0cmlidXRlc1tBVFRBQ0hNRU5UX09XTkVSX0tFWV1cbiAgICBkZWxldGUgYXR0cmlidXRlc1tQUkVMT0FERURfUkVMQVRJT05TSElQU19LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbU0VMRUNURURfQVRUUklCVVRFU19LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbQVNTT0NJQVRJT05fQ09VTlRTX0tFWV1cbiAgICBkZWxldGUgYXR0cmlidXRlc1tRVUVSWV9EQVRBX0tFWV1cbiAgICBkZWxldGUgYXR0cmlidXRlc1tBQklMSVRJRVNfS0VZXVxuXG4gICAgY29uc3Qgc2VsZWN0ZWRBdHRyaWJ1dGVzID0gc2VsZWN0ZWRBdHRyaWJ1dGVzRnJvbVBheWxvYWQgfHwgbmV3IFNldChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKSlcblxuICAgIHJldHVybiB7YWJpbGl0aWVzLCBhdHRhY2htZW50T3duZXIsIGF0dHJpYnV0ZXMsIGFzc29jaWF0aW9uQ291bnRzLCBxdWVyeURhdGEsIHByZWxvYWRlZFJlbGF0aW9uc2hpcHMsIHNlbGVjdGVkQXR0cmlidXRlc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IHByZWxvYWRlZCByZWxhdGlvbnNoaXBzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcHJlbG9hZGVkUmVsYXRpb25zaGlwcyAtIFByZWxvYWRlZCByZWxhdGlvbnNoaXAgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYXBwbHlQcmVsb2FkZWRSZWxhdGlvbnNoaXBzKG1vZGVsLCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKSB7XG4gICAgZm9yIChjb25zdCBbcmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwUGF5bG9hZF0gb2YgT2JqZWN0LmVudHJpZXMocHJlbG9hZGVkUmVsYXRpb25zaGlwcykpIHtcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMucmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXApIHtcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHJlbGF0aW9uc2hpcFBheWxvYWQpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfSBwYXlsb2FkIHRvIGJlIGFuIGFycmF5YClcbiAgICAgICAgfVxuXG4gICAgICAgIC8qKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+fSAqL1xuICAgICAgICBjb25zdCByZWxhdGVkTW9kZWxzID0gW11cblxuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHJlbGF0aW9uc2hpcFBheWxvYWQpIHtcbiAgICAgICAgICBjb25zdCByZWxhdGVkTW9kZWwgPSB0aGlzLmluc3RhbnRpYXRlUmVsYXRpb25zaGlwVmFsdWUoZW50cnksIHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICAgICAgICBpZiAoIShyZWxhdGVkTW9kZWwgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsQmFzZSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX0gcGF5bG9hZCBlbnRyeSB0byBpbnN0YW50aWF0ZSBhIGZyb250ZW5kIG1vZGVsYClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZWxhdGVkTW9kZWxzLnB1c2gocmVsYXRlZE1vZGVsKVxuICAgICAgICB9XG5cbiAgICAgICAgcmVsYXRpb25zaGlwLnNldExvYWRlZChyZWxhdGVkTW9kZWxzKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShyZWxhdGlvbnNoaXBQYXlsb2FkKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9IHBheWxvYWQgdG8gYmUgc2luZ3VsYXJgKVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZWxhdGVkTW9kZWwgPSB0aGlzLmluc3RhbnRpYXRlUmVsYXRpb25zaGlwVmFsdWUocmVsYXRpb25zaGlwUGF5bG9hZCwgdGFyZ2V0TW9kZWxDbGFzcylcblxuICAgICAgaWYgKHJlbGF0ZWRNb2RlbCAhPSB1bmRlZmluZWQgJiYgIShyZWxhdGVkTW9kZWwgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsQmFzZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfSBwYXlsb2FkIHRvIGluc3RhbnRpYXRlIGEgZnJvbnRlbmQgbW9kZWxgKVxuICAgICAgfVxuXG4gICAgICByZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHJlbGF0ZWRNb2RlbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnN0YW50aWF0ZSByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlbGF0aW9uc2hpcFBheWxvYWQgLSBSZWxhdGlvbnNoaXAgcGF5bG9hZCB2YWx1ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBudWxsfSB0YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gSW5zdGFudGlhdGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBpbnN0YW50aWF0ZVJlbGF0aW9uc2hpcFZhbHVlKHJlbGF0aW9uc2hpcFBheWxvYWQsIHRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICBpZiAoIXRhcmdldE1vZGVsQ2xhc3MpIHJldHVybiByZWxhdGlvbnNoaXBQYXlsb2FkXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcFBheWxvYWQgfHwgdHlwZW9mIHJlbGF0aW9uc2hpcFBheWxvYWQgIT09IFwib2JqZWN0XCIpIHJldHVybiByZWxhdGlvbnNoaXBQYXlsb2FkXG5cbiAgICByZXR1cm4gdGFyZ2V0TW9kZWxDbGFzcy5pbnN0YW50aWF0ZUZyb21SZXNwb25zZShyZWxhdGlvbnNoaXBQYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zdGFudGlhdGUgZnJvbSByZXNwb25zZS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgSW5zdGFuY2VUeXBlPFQ+fSByZXNwb25zZSAtIFJlc3BvbnNlIHBheWxvYWQsIG9yIGFuIGFscmVhZHktaHlkcmF0ZWQgaW5zdGFuY2Ugb2YgdGhpcyBjbGFzcy5cbiAgICogQHJldHVybnMge0luc3RhbmNlVHlwZTxUPn0gLSBOZXcgbW9kZWwgaW5zdGFuY2UsIG9yIHRoZSBzYW1lIGluc3RhbmNlIHVuY2hhbmdlZCBpZiBpdCB3YXMgYWxyZWFkeSBoeWRyYXRlZC5cbiAgICovXG4gIHN0YXRpYyBpbnN0YW50aWF0ZUZyb21SZXNwb25zZShyZXNwb25zZSkge1xuICAgIC8vIElkZW1wb3RlbnQ6IGlmIGEgY2FsbGVyIGhhbmRzIHVzIGFuIGFscmVhZHktaHlkcmF0ZWQgaW5zdGFuY2Ugb2YgdGhpc1xuICAgIC8vIGNsYXNzIChub3cgY29tbW9uIGJlY2F1c2UgdGhlIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgYXV0by1zZXJpYWxpemVzXG4gICAgLy8gYmFja2VuZCBgUmVjb3JkYCBpbnN0YW5jZXMgcmV0dXJuZWQgZnJvbSBjdXN0b20gY29tbWFuZHMgYW5kIHRoZVxuICAgIC8vIHRyYW5zcG9ydCBkZXNlcmlhbGl6ZXIgaHlkcmF0ZXMgdGhlbSBpbnRvIG1vZGVscyBiZWZvcmUgdGhlIGNhbGwgc2l0ZVxuICAgIC8vIHNlZXMgdGhlIHJlc3BvbnNlKSwgcmV0dXJuIGl0IGFzLWlzLiBXaXRob3V0IHRoaXMsIGNvZGUgdGhhdCBoYXNcbiAgICAvLyBoaXN0b3JpY2FsbHkgd3JhcHBlZCBjdXN0b20tY29tbWFuZCByZXNwb25zZXMgaW5cbiAgICAvLyBgTW9kZWwuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UocmVzcG9uc2UuZmllbGQpYCB3b3VsZCBzcHJlYWQgdGhlIGxpdmVcbiAgICAvLyBtb2RlbCBpbnN0YW5jZSBpbnRvIGEgbmV3IGNvbnN0cnVjdG9yIGNhbGwgYW5kIHByb2R1Y2UgYSBicm9rZW4gbW9kZWxcbiAgICAvLyB3aXRoIGludGVybmFsIHN0YXRlIGtleXMgcHJvbW90ZWQgdG8gYXR0cmlidXRlcy5cbiAgICBpZiAocmVzcG9uc2UgaW5zdGFuY2VvZiB0aGlzKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtJbnN0YW5jZVR5cGU8VD59ICovIChyZXNwb25zZSlcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlbERhdGEgPSB0aGlzLm1vZGVsRGF0YUZyb21SZXNwb25zZShyZXNwb25zZSlcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gbW9kZWxEYXRhLmF0dHJpYnV0ZXNcbiAgICBjb25zdCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzID0gbW9kZWxEYXRhLnByZWxvYWRlZFJlbGF0aW9uc2hpcHNcbiAgICBjb25zdCBhc3NvY2lhdGlvbkNvdW50cyA9IG1vZGVsRGF0YS5hc3NvY2lhdGlvbkNvdW50c1xuICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IG1vZGVsRGF0YS5xdWVyeURhdGFcbiAgICBjb25zdCBhYmlsaXRpZXMgPSBtb2RlbERhdGEuYWJpbGl0aWVzXG4gICAgY29uc3QgYXR0YWNobWVudE93bmVyID0gbW9kZWxEYXRhLmF0dGFjaG1lbnRPd25lclxuICAgIGNvbnN0IHNlbGVjdGVkQXR0cmlidXRlcyA9IG1vZGVsRGF0YS5zZWxlY3RlZEF0dHJpYnV0ZXNcbiAgICBjb25zdCByZWNlaXZlciA9IC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHRoaXMpXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPikgPT4gSW5zdGFuY2VUeXBlPFQ+fSAqLyAocmVjZWl2ZXIpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcyhhdHRyaWJ1dGVzKVxuICAgIG1vZGVsLl9hdHRhY2htZW50T3duZXIgPSBhdHRhY2htZW50T3duZXJcbiAgICBtb2RlbC5fc2VsZWN0ZWRBdHRyaWJ1dGVzID0gc2VsZWN0ZWRBdHRyaWJ1dGVzID8gbmV3IFNldChzZWxlY3RlZEF0dHJpYnV0ZXMpIDogbnVsbFxuXG4gICAgdGhpcy5hcHBseVByZWxvYWRlZFJlbGF0aW9uc2hpcHMobW9kZWwsIHByZWxvYWRlZFJlbGF0aW9uc2hpcHMpXG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXNzb2NpYXRpb25Db3VudHMgfHwge30pKSB7XG4gICAgICBtb2RlbC5fc2V0QXNzb2NpYXRpb25Db3VudChhdHRyaWJ1dGVOYW1lLCBOdW1iZXIodmFsdWUpIHx8IDApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHF1ZXJ5RGF0YSB8fCB7fSkpIHtcbiAgICAgIG1vZGVsLl9zZXRRdWVyeURhdGEobmFtZSwgdmFsdWUpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbYWN0aW9uLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYWJpbGl0aWVzIHx8IHt9KSkge1xuICAgICAgbW9kZWwuX3NldENvbXB1dGVkQWJpbGl0eShhY3Rpb24sIEJvb2xlYW4odmFsdWUpKVxuICAgIH1cblxuICAgIG1vZGVsLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuICAgIG1vZGVsLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzID0gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhtb2RlbC5hdHRyaWJ1dGVzKCkpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIFJlY29yZCBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIFJlc29sdmVkIG1vZGVsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmQoaWQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpbmQoaWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBBdHRyaWJ1dGUgbWF0Y2ggY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+IHwgbnVsbD59IC0gRm91bmQgbW9kZWwgb3IgbnVsbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kQnkoY29uZGl0aW9ucykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZEJ5KGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5IG9yIGZhaWwuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIEF0dHJpYnV0ZSBtYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIEZvdW5kIG1vZGVsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRCeU9yRmFpbChjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kQnlPckZhaWwoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIGFycmF5LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+W10+fSAtIExvYWRlZCBtb2RlbCBpbnN0YW5jZXMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgdG9BcnJheSgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLnRvQXJyYXkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPltdPn0gLSBMb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGxvYWQoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5sb2FkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFsbC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlci5cbiAgICovXG4gIHN0YXRpYyBhbGwoKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2hlcmUuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIFJvb3QtbW9kZWwgd2hlcmUgY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIHdoZXJlIGNvbmRpdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgd2hlcmUoY29uZGl0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkud2hlcmUoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpvaW5zLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBqb2lucyAtIFJlbGF0aW9uc2hpcCBkZXNjcmlwdG9yIGpvaW5zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggam9pbnMuXG4gICAqL1xuICBzdGF0aWMgam9pbnMoam9pbnMpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLmpvaW5zKGpvaW5zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGltaXQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBNYXhpbXVtIG51bWJlciBvZiByZWNvcmRzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggbGltaXQuXG4gICAqL1xuICBzdGF0aWMgbGltaXQodmFsdWUpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLmxpbWl0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb2Zmc2V0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gTnVtYmVyIG9mIHJlY29yZHMgdG8gc2tpcC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIG9mZnNldC5cbiAgICovXG4gIHN0YXRpYyBvZmZzZXQodmFsdWUpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLm9mZnNldCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhZ2UuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge251bWJlcn0gcGFnZU51bWJlciAtIDEtYmFzZWQgcGFnZSBudW1iZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCBwYWdlIGFwcGxpZWQuXG4gICAqL1xuICBzdGF0aWMgcGFnZShwYWdlTnVtYmVyKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5wYWdlKHBhZ2VOdW1iZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwZXIgcGFnZS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIE51bWJlciBvZiByZWNvcmRzIHBlciBwYWdlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggcGFnZSBzaXplLlxuICAgKi9cbiAgc3RhdGljIHBlclBhZ2UodmFsdWUpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLnBlclBhZ2UodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb3VudC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTnVtYmVyIG9mIGxvYWRlZCBtb2RlbCBpbnN0YW5jZXMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY291bnQoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5jb3VudCgpXG4gIH1cblxuICAvKipcbiAgICogQ2xhc3MtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIGFueSByZWNvcmQgb2YgdGhpcyBtb2RlbCBpcyBjcmVhdGVkLlxuICAgKiBTdWJzY3JpYmUtdGltZSBhdXRob3JpemF0aW9uIG9ubHkg4oCUIG9uY2UgYSBzdWJzY3JpcHRpb24gaXNcbiAgICogYWNjZXB0ZWQsIGZ1dHVyZSBgY3JlYXRlYCBldmVudHMgZm9yIHRoaXMgbW9kZWwgYXJlIGRlbGl2ZXJlZFxuICAgKiB3aXRob3V0IHJlLWNoZWNraW5nIHBlci1yZWNvcmQgdmlzaWJpbGl0eS4gUXVlcnkgb3B0aW9ucyBjYW4gc3RpbGxcbiAgICogbmFycm93IHdoaWNoIGV2ZW50cyByZWFjaCB0aGlzIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBGcm9udGVuZE1vZGVsRXZlbnRQcmltYXJ5S2V5VmFsdWVGb3I8SW5zdGFuY2VUeXBlPFQ+PiwgbW9kZWw6IEluc3RhbmNlVHlwZTxUPn0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciByZWNvcmQgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBvbkNyZWF0ZShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0LCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKHRoaXMsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKHRoaXMsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBlbnRyeSA9IHtjYWxsYmFjaywgLi4uZXZlbnRPcHRpb25zUGF5bG9hZH1cblxuICAgIHJldHVybiBhd2FpdCBzdWIucmVnaXN0ZXJDbGFzc0NhbGxiYWNrKHN1Yi5jbGFzc0NyZWF0ZUNhbGxiYWNrcywgZW50cnkpXG4gIH1cblxuICAvKipcbiAgICogQ2xhc3MtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIGFueSByZWNvcmQgb2YgdGhpcyBtb2RlbCBpcyB1cGRhdGVkLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBGcm9udGVuZE1vZGVsRXZlbnRQcmltYXJ5S2V5VmFsdWVGb3I8SW5zdGFuY2VUeXBlPFQ+PiwgbW9kZWw6IEluc3RhbmNlVHlwZTxUPn0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciByZWNvcmQgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBvblVwZGF0ZShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0LCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKHRoaXMsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKHRoaXMsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBlbnRyeSA9IHtjYWxsYmFjaywgLi4uZXZlbnRPcHRpb25zUGF5bG9hZH1cblxuICAgIHJldHVybiBhd2FpdCBzdWIucmVnaXN0ZXJDbGFzc0NhbGxiYWNrKHN1Yi5jbGFzc1VwZGF0ZUNhbGxiYWNrcywgZW50cnkpXG4gIH1cblxuICAvKipcbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQG92ZXJsb2FkXG4gICAqIEBwYXJhbSB7VH0gdGhpcyAtIENvbmNyZXRlIGZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7aWQ6IEZyb250ZW5kTW9kZWxFdmVudFByaW1hcnlLZXlWYWx1ZUZvcjxJbnN0YW5jZVR5cGU8VD4+fSkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEFjY2VwdGVkIGZvciBBUEkgc3ltbWV0cnk7IGRlc3Ryb3kgZXZlbnRzIGNhcnJ5IGlkcyBvbmx5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIC8qKlxuICAgKiBAb3ZlcmxvYWRcbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBzdHJpbmd9KSA9PiB2b2lkfSBjYWxsYmFjayAtIFNjYWxhciBldmVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEFjY2VwdGVkIGZvciBBUEkgc3ltbWV0cnk7IGRlc3Ryb3kgZXZlbnRzIGNhcnJ5IGlkcyBvbmx5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIC8qKlxuICAgKiBDbGFzcy1sZXZlbCBob29rIGZpcmVkIHdoZW4gYW55IHJlY29yZCBvZiB0aGlzIG1vZGVsIGlzIGRlc3Ryb3llZC5cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBuZXZlcn0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2sgZXJhc2VkIGF0IHRoZSBvdmVybG9hZCBpbXBsZW1lbnRhdGlvbiBib3VuZGFyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEFjY2VwdGVkIGZvciBBUEkgc3ltbWV0cnk7IGRlc3Ryb3kgZXZlbnRzIGNhcnJ5IGlkcyBvbmx5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBvbkRlc3Ryb3koY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGFzc2VydE5vRGVzdHJveUV2ZW50RmlsdGVyKHRoaXMsIG9wdGlvbnMpXG5cbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQodGhpcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24odGhpcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnk8bmV2ZXI+fSAqL1xuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrfVxuXG4gICAgcmV0dXJuIGF3YWl0IHN1Yi5yZWdpc3RlckNsYXNzQ2FsbGJhY2soc3ViLmNsYXNzRGVzdHJveUNhbGxiYWNrcywgZW50cnkpXG4gIH1cblxuICAvKipcbiAgICogSW5zdGFuY2UtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIFRISVMgcmVjb3JkIGlzIHVwZGF0ZWQuIFRoZVxuICAgKiBpbnN0YW5jZSdzIGF0dHJpYnV0ZXMgYXJlIGF1dG8tbWVyZ2VkIHdpdGggdGhlIGJyb2FkY2FzdCBwYXlsb2FkXG4gICAqIGJlZm9yZSB0aGUgY2FsbGJhY2sgcnVucywgc28gY2FsbGVycyBjYW4gcmVhZCBmcmVzaCB2YWx1ZXMgdmlhXG4gICAqIGB0aGlzLnNvbWVBdHRyKClgIHdpdGhvdXQgcmUtZmV0Y2hpbmcuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogRXZlbnRQcmltYXJ5S2V5VmFsdWUsIG1vZGVsOiBGcm9udGVuZE1vZGVsQmFzZTxBdHRyaWJ1dGVzLCBDcmVhdGVBdHRyaWJ1dGVzLCBVcGRhdGVBdHRyaWJ1dGVzLCBQcmltYXJ5S2V5VmFsdWUsIEV2ZW50UHJpbWFyeUtleVZhbHVlPn0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciByZWNvcmQgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIGFzeW5jIG9uVXBkYXRlKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0LCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKE1vZGVsQ2xhc3MsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBpZGVudGl0eSA9IHRoaXMuaXNOZXdSZWNvcmQoKSA/IHRoaXMucHJpbWFyeUtleVZhbHVlKCkgOiB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgY29uc3QgaWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgaWRlbnRpdHkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2ssIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9XG4gICAgY29uc3QgbGlzdGVuZXIgPSBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGlkLCB0aGlzKVxuXG4gICAgbGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzLmFkZChlbnRyeSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzdWIuZW5zdXJlU3Vic2NyaWJlZCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCAoY3VycmVudCkgPT4gY3VycmVudC51cGRhdGVDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCAoY3VycmVudCkgPT4gY3VycmVudC51cGRhdGVDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSW5zdGFuY2UtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIFRISVMgcmVjb3JkIGlzIGRlc3Ryb3llZC5cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBFdmVudFByaW1hcnlLZXlWYWx1ZX0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBBY2NlcHRlZCBmb3IgQVBJIHN5bW1ldHJ5OyBkZXN0cm95IGV2ZW50cyBjYXJyeSBpZHMgb25seS5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBhc3luYyBvbkRlc3Ryb3koY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcblxuICAgIGFzc2VydE5vRGVzdHJveUV2ZW50RmlsdGVyKE1vZGVsQ2xhc3MsIG9wdGlvbnMpXG5cbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQoTW9kZWxDbGFzcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oTW9kZWxDbGFzcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGlkZW50aXR5ID0gdGhpcy5pc05ld1JlY29yZCgpID8gdGhpcy5wcmltYXJ5S2V5VmFsdWUoKSA6IHRoaXMucGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKClcbiAgICBjb25zdCBpZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBpZGVudGl0eSlcbiAgICBjb25zdCBlbnRyeSA9IHtjYWxsYmFja31cbiAgICBjb25zdCBsaXN0ZW5lciA9IGVuc3VyZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyKHN1YiwgaWQsIHRoaXMpXG5cbiAgICBsaXN0ZW5lci5kZXN0cm95Q2FsbGJhY2tzLmFkZChlbnRyeSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzdWIuZW5zdXJlU3Vic2NyaWJlZCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCAoY3VycmVudCkgPT4gY3VycmVudC5kZXN0cm95Q2FsbGJhY2tzLmRlbGV0ZShlbnRyeSkpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgKGN1cnJlbnQpID0+IGN1cnJlbnQuZGVzdHJveUNhbGxiYWNrcy5kZWxldGUoZW50cnkpKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBsdWNrLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHsuLi4oc3RyaW5nIHwgc3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+KX0gY29sdW1ucyAtIFBsdWNrIGRlZmluaXRpb24ocykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUGx1Y2tlZCB2YWx1ZXMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcGx1Y2soLi4uY29sdW1ucykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkucGx1Y2soLi4uY29sdW1ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlYXJjaC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbiAtIENvbHVtbiBvciBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtcImVxXCIgfCBcImxpa2VcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcIj5cIiB8IFwiPj1cIiB8IFwiPFwiIHwgXCI8PVwifSBvcGVyYXRvciAtIFNlYXJjaCBvcGVyYXRvci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTZWFyY2ggdmFsdWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlciB3aXRoIHNlYXJjaCBmaWx0ZXIuXG4gICAqL1xuICBzdGF0aWMgc2VhcmNoKHBhdGgsIGNvbHVtbiwgb3BlcmF0b3IsIHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5zZWFyY2gocGF0aCwgY29sdW1uLCBvcGVyYXRvciwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByYW5zYWNrLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJhbnNhY2stc3R5bGUgcGFyYW1zIGhhc2guXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlciB3aXRoIFJhbnNhY2sgZmlsdGVycyBhcHBsaWVkLlxuICAgKi9cbiAgc3RhdGljIHJhbnNhY2socGFyYW1zKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5yYW5zYWNrKHBhcmFtcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNvcnQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgc3RyaW5nW11bXSB8IFtzdHJpbmcsIHN0cmluZ10gfCBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHNvcnQgLSBTb3J0IGRlZmluaXRpb24ocykuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlciB3aXRoIHNvcnQgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgc29ydChzb3J0KSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5zb3J0KHNvcnQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvcmRlci5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBzdHJpbmdbXVtdIHwgW3N0cmluZywgc3RyaW5nXSB8IEFycmF5PFtzdHJpbmcsIHN0cmluZ10+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gc29ydCAtIFNvcnQgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggc29ydCBkZWZpbml0aW9ucy5cbiAgICovXG4gIHN0YXRpYyBvcmRlcihzb3J0KSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5vcmRlcihzb3J0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ3JvdXAuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gZ3JvdXAgLSBHcm91cCBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBncm91cCBkZWZpbml0aW9ucy5cbiAgICovXG4gIHN0YXRpYyBncm91cChncm91cCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuZ3JvdXAoZ3JvdXApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXN0aW5jdC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW3ZhbHVlXSAtIFdoZXRoZXIgdG8gcmVxdWVzdCBkaXN0aW5jdCByb3dzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBkaXN0aW5jdCBmbGFnLlxuICAgKi9cbiAgc3RhdGljIGRpc3RpbmN0KHZhbHVlID0gdHJ1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuZGlzdGluY3QodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBxdWVyeS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlci5cbiAgICovXG4gIHN0YXRpYyBxdWVyeSgpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59ICovIChuZXcgRnJvbnRlbmRNb2RlbFF1ZXJ5KHttb2RlbENsYXNzOiB0aGlzfSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVsb2FkLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHByZWxvYWQgLSBQcmVsb2FkIGdyYXBoLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IHdpdGggcHJlbG9hZC5cbiAgICovXG4gIHN0YXRpYyBwcmVsb2FkKHByZWxvYWQpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59ICovICh0aGlzLnF1ZXJ5KCkucHJlbG9hZChwcmVsb2FkKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10gfCBzdHJpbmc+IHwgc3RyaW5nIHwgc3RyaW5nW119IHNlbGVjdCAtIE1vZGVsLWF3YXJlIGF0dHJpYnV0ZSBzZWxlY3QgbWFwIG9yIHJvb3QtbW9kZWwgc2hvcnRoYW5kLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IHdpdGggc2VsZWN0ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIHN0YXRpYyBzZWxlY3Qoc2VsZWN0KSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAodGhpcy5xdWVyeSgpLnNlbGVjdChzZWxlY3QpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VsZWN0cyBleHRyYS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10gfCBzdHJpbmc+IHwgc3RyaW5nIHwgc3RyaW5nW119IHNlbGVjdCAtIEV4dHJhIGF0dHJpYnV0ZXMgdG8gbG9hZCBpbiBhZGRpdGlvbiB0byB0aGUgZGVmYXVsdHMsIGtleWVkIGJ5IG1vZGVsIG5hbWUgb3Igcm9vdC1tb2RlbCBzaG9ydGhhbmQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgd2l0aCBleHRyYSBzZWxlY3RlZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgc3RhdGljIHNlbGVjdHNFeHRyYShzZWxlY3QpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59ICovICh0aGlzLnF1ZXJ5KCkuc2VsZWN0c0V4dHJhKHNlbGVjdCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaXJzdC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPiB8IG51bGw+fSAtIEZpcnN0IG1vZGVsIG9yIG51bGwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmlyc3QoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maXJzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsYXN0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+IHwgbnVsbD59IC0gTGFzdCBtb2RlbCBvciBudWxsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGxhc3QoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5sYXN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgaW5pdGlhbGl6ZSBieS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gQXR0cmlidXRlIG1hdGNoIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRXhpc3Rpbmcgb3IgaW5pdGlhbGl6ZWQgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZE9ySW5pdGlhbGl6ZUJ5KGNvbmRpdGlvbnMpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpbmRPckluaXRpYWxpemVCeShjb25kaXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvciBjcmVhdGUgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIEF0dHJpYnV0ZSBtYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcGFyYW0geyhtb2RlbDogSW5zdGFuY2VUeXBlPFQ+KSA9PiBQcm9taXNlPHZvaWQ+IHwgdm9pZH0gW2NhbGxiYWNrXSAtIE9wdGlvbmFsIGNhbGxiYWNrIGJlZm9yZSBzYXZlIHdoZW4gY3JlYXRlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+Pn0gLSBFeGlzdGluZyBvciBuZXdseSBjcmVhdGVkIG1vZGVsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRPckNyZWF0ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kT3JDcmVhdGVCeShjb25kaXRpb25zLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3NcbiAgICogQHRoaXMge01vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENyZWF0ZUF0dHJpYnV0ZXNGb3I8SW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+Pn0gW2F0dHJpYnV0ZXNdIC0gSW5pdGlhbCBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TW9kZWxDbGFzcz4+fSAtIFBlcnNpc3RlZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjcmVhdGUoYXR0cmlidXRlcykge1xuICAgIGNvbnN0IHJlY2VpdmVyID0gLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcylcbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtuZXcgKGF0dHJpYnV0ZXM/OiBGcm9udGVuZE1vZGVsQ3JlYXRlQXR0cmlidXRlc0ZvcjxJbnN0YW5jZVR5cGU8TW9kZWxDbGFzcz4+KSA9PiBJbnN0YW5jZVR5cGU8TW9kZWxDbGFzcz59ICovIChyZWNlaXZlcilcbiAgICBjb25zdCBtb2RlbCA9IG5ldyBNb2RlbENsYXNzKGF0dHJpYnV0ZXMpXG5cbiAgICBhd2FpdCBtb2RlbC5zYXZlKClcblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXNzZXJ0IGZpbmQgYnkgY29uZGl0aW9ucy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBmaW5kQnkgY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYXNzZXJ0RmluZEJ5Q29uZGl0aW9ucyhjb25kaXRpb25zKSB7XG4gICAgYXNzZXJ0RmluZEJ5Q29uZGl0aW9uc1NoYXBlKGNvbmRpdGlvbnMpXG5cbiAgICBPYmplY3Qua2V5cyhjb25kaXRpb25zKS5mb3JFYWNoKChrZXkpID0+IHtcbiAgICAgIGFzc2VydERlZmluZWRGaW5kQnlDb25kaXRpb25WYWx1ZShjb25kaXRpb25zW2tleV0sIGtleSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF0Y2hlcyBmaW5kIGJ5IGNvbmRpdGlvbnMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gQ2FuZGlkYXRlIG1vZGVsLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIE1hdGNoIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIG1vZGVsIG1hdGNoZXMgYWxsIGNvbmRpdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgbWF0Y2hlc0ZpbmRCeUNvbmRpdGlvbnMobW9kZWwsIGNvbmRpdGlvbnMpIHtcbiAgICBjb25zdCBtb2RlbEF0dHJpYnV0ZXMgPSBtb2RlbC5hdHRyaWJ1dGVzKClcblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGNvbmRpdGlvbnMpKSB7XG4gICAgICBjb25zdCBleHBlY3RlZFZhbHVlID0gY29uZGl0aW9uc1trZXldXG4gICAgICBjb25zdCBhY3R1YWxWYWx1ZSA9IG1vZGVsQXR0cmlidXRlc1trZXldXG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGV4cGVjdGVkVmFsdWUpKSB7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGFjdHVhbFZhbHVlKSkge1xuICAgICAgICAgIGlmICghdGhpcy5maW5kQnlDb25kaXRpb25WYWx1ZU1hdGNoZXMoYWN0dWFsVmFsdWUsIGV4cGVjdGVkVmFsdWUpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoIWV4cGVjdGVkVmFsdWUuc29tZSgoZW50cnkpID0+IHRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlLCBlbnRyeSkpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKSkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieSBjb25kaXRpb24gdmFsdWUgbWF0Y2hlcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYWN0dWFsVmFsdWUgLSBBY3R1YWwgbW9kZWwgdmFsdWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGV4cGVjdGVkVmFsdWUgLSBFeHBlY3RlZCBmaW5kIGNvbmRpdGlvbiB2YWx1ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZXMgbWF0Y2guXG4gICAqL1xuICBzdGF0aWMgZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKSB7XG4gICAgaWYgKGV4cGVjdGVkVmFsdWUgPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBhY3R1YWxWYWx1ZSA9PT0gbnVsbFxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGV4cGVjdGVkVmFsdWUpKSB7XG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkoYWN0dWFsVmFsdWUpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuXG4gICAgICBpZiAoYWN0dWFsVmFsdWUubGVuZ3RoICE9PSBleHBlY3RlZFZhbHVlLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGV4cGVjdGVkVmFsdWUubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgICAgIGlmICghdGhpcy5maW5kQnlDb25kaXRpb25WYWx1ZU1hdGNoZXMoYWN0dWFsVmFsdWVbaW5kZXhdLCBleHBlY3RlZFZhbHVlW2luZGV4XSkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGlmIChleHBlY3RlZFZhbHVlICYmIHR5cGVvZiBleHBlY3RlZFZhbHVlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBpZiAoIWFjdHVhbFZhbHVlIHx8IHR5cGVvZiBhY3R1YWxWYWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGFjdHVhbFZhbHVlKSkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgY29uc3QgYWN0dWFsT2JqZWN0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChhY3R1YWxWYWx1ZSlcbiAgICAgIGNvbnN0IGV4cGVjdGVkT2JqZWN0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChleHBlY3RlZFZhbHVlKVxuICAgICAgY29uc3QgYWN0dWFsS2V5cyA9IE9iamVjdC5rZXlzKGFjdHVhbE9iamVjdClcbiAgICAgIGNvbnN0IGV4cGVjdGVkS2V5cyA9IE9iamVjdC5rZXlzKGV4cGVjdGVkT2JqZWN0KVxuXG4gICAgICBpZiAoYWN0dWFsS2V5cy5sZW5ndGggIT09IGV4cGVjdGVkS2V5cy5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIGV4cGVjdGVkS2V5cykge1xuICAgICAgICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChhY3R1YWxPYmplY3QsIGtleSkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5maW5kQnlDb25kaXRpb25WYWx1ZU1hdGNoZXMoYWN0dWFsT2JqZWN0W2tleV0sIGV4cGVjdGVkT2JqZWN0W2tleV0pKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBpZiAoYWN0dWFsVmFsdWUgPT09IGV4cGVjdGVkVmFsdWUpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuZmluZEJ5UHJpbWl0aXZlVmFsdWVzTWF0Y2goYWN0dWFsVmFsdWUsIGV4cGVjdGVkVmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5IHByaW1pdGl2ZSB2YWx1ZXMgbWF0Y2guXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFjdHVhbFZhbHVlIC0gQWN0dWFsIG1vZGVsIHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBleHBlY3RlZFZhbHVlIC0gRXhwZWN0ZWQgZmluZCBjb25kaXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcHJpbWl0aXZlIHZhbHVlcyBtYXRjaCBhZnRlciBzYWZlIGNvZXJjaW9uLlxuICAgKi9cbiAgc3RhdGljIGZpbmRCeVByaW1pdGl2ZVZhbHVlc01hdGNoKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKSB7XG4gICAgaWYgKGFjdHVhbFZhbHVlIGluc3RhbmNlb2YgRGF0ZSAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEV4cGVjdGVkVmFsdWUgPSBub3JtYWxpemVEYXRlU3RyaW5nRm9yV3JpdGUoZXhwZWN0ZWRWYWx1ZSwge3RpbWVab25lOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKX0pXG5cbiAgICAgIGlmIChub3JtYWxpemVkRXhwZWN0ZWRWYWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgICAgcmV0dXJuIGFjdHVhbFZhbHVlLnRvSVNPU3RyaW5nKCkgPT09IG5vcm1hbGl6ZWRFeHBlY3RlZFZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGFjdHVhbFZhbHVlLnRvSVNPU3RyaW5nKCkgPT09IGV4cGVjdGVkVmFsdWVcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGFjdHVhbFZhbHVlID09PSBcInN0cmluZ1wiICYmIGV4cGVjdGVkVmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICByZXR1cm4gYWN0dWFsVmFsdWUgPT09IGV4cGVjdGVkVmFsdWUudG9JU09TdHJpbmcoKVxuICAgIH1cblxuICAgIGlmIChhY3R1YWxWYWx1ZSBpbnN0YW5jZW9mIERhdGUgJiYgZXhwZWN0ZWRWYWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgIHJldHVybiBhY3R1YWxWYWx1ZS50b0lTT1N0cmluZygpID09PSBleHBlY3RlZFZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGFjdHVhbFZhbHVlID09PSBcIm51bWJlclwiICYmIHR5cGVvZiBleHBlY3RlZFZhbHVlID09PSBcInN0cmluZ1wiKSB7XG4gICAgICByZXR1cm4gdGhpcy5maW5kQnlOdW1lcmljU3RyaW5nTWF0Y2hlc051bWJlcihleHBlY3RlZFZhbHVlLCBhY3R1YWxWYWx1ZSlcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGFjdHVhbFZhbHVlID09PSBcInN0cmluZ1wiICYmIHR5cGVvZiBleHBlY3RlZFZhbHVlID09PSBcIm51bWJlclwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5maW5kQnlOdW1lcmljU3RyaW5nTWF0Y2hlc051bWJlcihhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSlcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgbnVtZXJpYyBzdHJpbmcgbWF0Y2hlcyBudW1iZXIuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBudW1lcmljU3RyaW5nIC0gTnVtZXJpYyBzdHJpbmcgdmFsdWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBleHBlY3RlZE51bWJlciAtIE51bWJlciB2YWx1ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZXMgcmVwcmVzZW50IHRoZSBzYW1lIG51bWJlci5cbiAgICovXG4gIHN0YXRpYyBmaW5kQnlOdW1lcmljU3RyaW5nTWF0Y2hlc051bWJlcihudW1lcmljU3RyaW5nLCBleHBlY3RlZE51bWJlcikge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKGV4cGVjdGVkTnVtYmVyKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgaWYgKCEvXi0/XFxkKyg/OlxcLlxcZCspPyQvLnRlc3QobnVtZXJpY1N0cmluZykpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIHJldHVybiBOdW1iZXIobnVtZXJpY1N0cmluZykgPT09IGV4cGVjdGVkTnVtYmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUuXG4gICAqIEBwYXJhbSB7VXBkYXRlQXR0cmlidXRlc30gW25ld0F0dHJpYnV0ZXNdIC0gTmV3IHZhbHVlcyB0byBhc3NpZ24gYmVmb3JlIHVwZGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dGhpcz59IC0gVXBkYXRlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIHVwZGF0ZShuZXdBdHRyaWJ1dGVzKSB7XG4gICAgaWYgKG5ld0F0dHJpYnV0ZXMpIHRoaXMuYXNzaWduQXR0cmlidXRlcyhuZXdBdHRyaWJ1dGVzKVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7dGhpc30gKi8gKGF3YWl0IHRoaXMuc2F2ZSgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNoLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhdHRhY2htZW50SW5wdXQgLSBBdHRhY2htZW50IGlucHV0IG9yIG5hbWVkIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhdHRhY2hlZC5cbiAgICovXG4gIGFzeW5jIGF0dGFjaChhdHRhY2htZW50SW5wdXQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb25zID0gTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbnMoKVxuICAgIGNvbnN0IGF0dGFjaG1lbnROYW1lcyA9IE9iamVjdC5rZXlzKGF0dGFjaG1lbnREZWZpbml0aW9ucylcbiAgICBsZXQgYXR0YWNobWVudE5hbWUgPSBhdHRhY2htZW50TmFtZXNbMF1cbiAgICBsZXQgYWN0dWFsQXR0YWNobWVudElucHV0ID0gYXR0YWNobWVudElucHV0XG5cbiAgICBpZiAoZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KGF0dGFjaG1lbnRJbnB1dCkpIHtcbiAgICAgIGlmIChcImZpbGVcIiBpbiBhdHRhY2htZW50SW5wdXQgJiYgYXR0YWNobWVudERlZmluaXRpb25zLmZpbGUpIHtcbiAgICAgICAgYXR0YWNobWVudE5hbWUgPSBcImZpbGVcIlxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZU5hbWUgb2YgYXR0YWNobWVudE5hbWVzKSB7XG4gICAgICAgIGlmIChjYW5kaWRhdGVOYW1lIGluIGF0dGFjaG1lbnRJbnB1dCkge1xuICAgICAgICAgIGF0dGFjaG1lbnROYW1lID0gY2FuZGlkYXRlTmFtZVxuICAgICAgICAgIGFjdHVhbEF0dGFjaG1lbnRJbnB1dCA9IGF0dGFjaG1lbnRJbnB1dFtjYW5kaWRhdGVOYW1lXVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWF0dGFjaG1lbnROYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGF0dGFjaG1lbnQgZGVmaW5pdGlvbnMgb24gJHtNb2RlbENsYXNzLm5hbWV9YClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpLmF0dGFjaChhY3R1YWxBdHRhY2htZW50SW5wdXQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzYXZlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0aGlzPn0gLSBTYXZlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIHNhdmUoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGlzTmV3ID0gdGhpcy5pc05ld1JlY29yZCgpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcHJldmlvdXNJZGVudGl0eSA9IGlzTmV3ID8gbnVsbCA6IHRoaXMucGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKClcbiAgICBjb25zdCBsaXN0ZW5lcklkZW50aXR5QmVmb3JlU2F2ZSA9IGlzTmV3XG4gICAgICAmJiBBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpXG4gICAgICAmJiBwcmltYXJ5S2V5LmV2ZXJ5KChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuXG4gICAgICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiXG4gICAgICB9KVxuICAgICAgPyB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpXG4gICAgICA6IHByZXZpb3VzSWRlbnRpdHlcbiAgICBjb25zdCBjb21tYW5kVHlwZSA9IGlzTmV3ID8gXCJjcmVhdGVcIiA6IFwidXBkYXRlXCJcbiAgICAvKipcbiAgICAgKiBQYXlsb2FkLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgIGF0dHJpYnV0ZXM6IHRoaXMuX2NoYW5nZWRBdHRyaWJ1dGVzRm9yU2F2ZSgpXG4gICAgfVxuXG4gICAgaWYgKCFpc05ldykge1xuICAgICAgcGF5bG9hZC5pZCA9IHRoaXMucGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKClcbiAgICB9XG5cbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzID0gYXdhaXQgdGhpcy5fYnVpbGROZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZCgpXG5cbiAgICBpZiAobmVzdGVkQXR0cmlidXRlcyAmJiBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSB7XG4gICAgICBwYXlsb2FkLm5lc3RlZEF0dHJpYnV0ZXMgPSBuZXN0ZWRBdHRyaWJ1dGVzXG4gICAgfVxuXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSBhd2FpdCB0aGlzLl9idWlsZEF0dGFjaG1lbnRzUGF5bG9hZCgpXG5cbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDApIHtcbiAgICAgIHBheWxvYWQuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgIH1cblxuICAgIGlmIChzaG91bGRRdWV1ZUZyb250ZW5kTW9kZWxPcGVyYXRpb25PZmZsaW5lKE1vZGVsQ2xhc3MsIGNvbW1hbmRUeXBlKSkge1xuICAgICAgY29uc3Qgb2ZmbGluZUF0dHJpYnV0ZXMgPSB7Li4ucGF5bG9hZC5hdHRyaWJ1dGVzfVxuICAgICAgbGV0IGNsaWVudE11dGF0aW9uSWRcblxuICAgICAgaWYgKGlzTmV3KSB7XG4gICAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGBPZmZsaW5lIGNyZWF0ZSBmb3IgJHtNb2RlbENsYXNzLm5hbWV9YClcbiAgICAgICAgY29uc3QgY3VycmVudFByaW1hcnlLZXkgPSB0aGlzLnJlYWRBdHRyaWJ1dGUocHJpbWFyeUtleSlcblxuICAgICAgICBpZiAoY3VycmVudFByaW1hcnlLZXkgPT09IHVuZGVmaW5lZCB8fCBjdXJyZW50UHJpbWFyeUtleSA9PT0gbnVsbCkge1xuICAgICAgICAgIGNsaWVudE11dGF0aW9uSWQgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jPy5jbGllbnRNdXRhdGlvbklkXG4gICAgICAgICAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcub2ZmbGluZVN5bmMuY2xpZW50TXV0YXRpb25JZCgpXG4gICAgICAgICAgICA6IGZyb250ZW5kTW9kZWxPZmZsaW5lTXV0YXRpb25JZCgpXG4gICAgICAgICAgdGhpcy5zZXRBdHRyaWJ1dGUocHJpbWFyeUtleSwgY2xpZW50TXV0YXRpb25JZClcbiAgICAgICAgICBvZmZsaW5lQXR0cmlidXRlc1twcmltYXJ5S2V5XSA9IGNsaWVudE11dGF0aW9uSWRcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgcHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgYE9mZmxpbmUgdXBkYXRlIGZvciAke01vZGVsQ2xhc3MubmFtZX1gKVxuXG4gICAgICAgIG9mZmxpbmVBdHRyaWJ1dGVzW3ByaW1hcnlLZXldID0gcGF5bG9hZC5pZFxuICAgICAgfVxuXG4gICAgICBpZiAocGF5bG9hZC5uZXN0ZWRBdHRyaWJ1dGVzICE9PSB1bmRlZmluZWQgfHwgcGF5bG9hZC5hdHRhY2htZW50cyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgT2ZmbGluZSBzeW5jIGZvciAke01vZGVsQ2xhc3MubmFtZX0gZG9lcyBub3Qgc3VwcG9ydCBuZXN0ZWQgYXR0cmlidXRlcyBvciBhdHRhY2htZW50cyB5ZXRgKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBxdWV1ZUZyb250ZW5kTW9kZWxNdXRhdGlvbk9mZmxpbmUoe1xuICAgICAgICBhdHRyaWJ1dGVzOiBvZmZsaW5lQXR0cmlidXRlcyxcbiAgICAgICAgY2xpZW50TXV0YXRpb25JZCxcbiAgICAgICAgTW9kZWxDbGFzcyxcbiAgICAgICAgb3BlcmF0aW9uOiBjb21tYW5kVHlwZVxuICAgICAgfSlcbiAgICAgIHRoaXMuc2V0SXNOZXdSZWNvcmQoZmFsc2UpXG4gICAgICB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzID0gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyh0aGlzLmF0dHJpYnV0ZXMoKSlcbiAgICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICAgIHRoaXMuX2NsZWFyUGVuZGluZ0F0dGFjaG1lbnRzKClcblxuICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG5cbiAgICBjb25zdCByZW1vdmVUZW1wb3JhcnlMaXN0ZW5lckFsaWFzZXMgPSBwcmV2aW91c0lkZW50aXR5ID09PSBudWxsXG4gICAgICA/ICgpID0+IHt9XG4gICAgICA6IGFsaWFzRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKE1vZGVsQ2xhc3MsIHRoaXMsIHByZXZpb3VzSWRlbnRpdHksIHRoaXMucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgbGV0IHJlc3BvbnNlXG5cbiAgICB0cnkge1xuICAgICAgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKGNvbW1hbmRUeXBlLCBwYXlsb2FkKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZW1vdmVUZW1wb3JhcnlMaXN0ZW5lckFsaWFzZXMoKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZW1vdmVUZW1wb3JhcnlMaXN0ZW5lckFsaWFzZXMoKVxuXG4gICAgY29uc3QgbW9kZWxEYXRhID0gTW9kZWxDbGFzcy5tb2RlbERhdGFGcm9tUmVzcG9uc2UocmVzcG9uc2UpXG5cbiAgICB0aGlzLmFzc2lnbkF0dHJpYnV0ZXMobW9kZWxEYXRhLmF0dHJpYnV0ZXMpXG4gICAgdGhpcy5fYXR0YWNobWVudE93bmVyID0gbW9kZWxEYXRhLmF0dGFjaG1lbnRPd25lclxuICAgIHRoaXMuc2V0SXNOZXdSZWNvcmQoZmFsc2UpXG5cbiAgICBpZiAobGlzdGVuZXJJZGVudGl0eUJlZm9yZVNhdmUgIT09IG51bGwpIHtcbiAgICAgIHJla2V5RnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKE1vZGVsQ2xhc3MsIHRoaXMsIGxpc3RlbmVySWRlbnRpdHlCZWZvcmVTYXZlLCB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIH1cblxuICAgIHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXMgPSBjbG9uZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKHRoaXMuYXR0cmlidXRlcygpKVxuICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICB0aGlzLl9jbGVhclBlbmRpbmdBdHRhY2htZW50cygpXG5cbiAgICB0aGlzLl9yZWNvbmNpbGVOZXN0ZWRBdHRyaWJ1dGVzRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBzdWJzZXQgb2YgYF9hdHRyaWJ1dGVzYCB3aG9zZSB2YWx1ZSBoYXMgZGl2ZXJnZWQgZnJvbVxuICAgKiBgX3BlcnNpc3RlZEF0dHJpYnV0ZXNgLiBVc2VkIGJ5IGBzYXZlKClgIHNvIHRoZSBzZXJ2ZXIgcmVjZWl2ZXMgb25seSB0aGVcbiAgICogZmllbGRzIHRoZSBjYWxsZXIgYWN0dWFsbHkgY2hhbmdlZCDigJQgYXZvaWRpbmcgc3RyaWN0IHBlcm1pdCByZWplY3Rpb25zIG9uXG4gICAqIGZyYW1ld29yay1tYW5hZ2VkIGZpZWxkcyBsaWtlIGBpZGAsIGBjcmVhdGVkQXRgLCBgdXBkYXRlZEF0YCwgb3Igb3duZXJcbiAgICogZm9yZWlnbiBrZXlzIHRoYXQgdGhlIHJlc291cmNlIG5ldmVyIGxpc3RzIGluIGBwZXJtaXR0ZWRQYXJhbXNgLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gLSBDaGFuZ2VkIGF0dHJpYnV0ZXMgaGFzaC5cbiAgICovXG4gIF9jaGFuZ2VkQXR0cmlidXRlc0ZvclNhdmUoKSB7XG4gICAgLyoqXG4gICAgICogQ2hhbmdlZCBhdHRyaWJ1dGVzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqL1xuICAgIGNvbnN0IGNoYW5nZWRBdHRyaWJ1dGVzID0ge31cblxuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIFtwcmV2aW91c1ZhbHVlLCBjdXJyZW50VmFsdWVdXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmNoYW5nZXMoKSkpIHtcbiAgICAgIGlmICh0aGlzLmlzTmV3UmVjb3JkKCkgJiYgcHJldmlvdXNWYWx1ZSA9PT0gdW5kZWZpbmVkICYmIGN1cnJlbnRWYWx1ZSA9PT0gbnVsbCkgY29udGludWVcblxuICAgICAgY2hhbmdlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBjdXJyZW50VmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gY2hhbmdlZEF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXJrcyB0aGUgY3VycmVudCB2YWx1ZSBmb3IgYW4gYXR0cmlidXRlIGFzIGFscmVhZHkgcGVyc2lzdGVkIHNvIHRoZSBuZXh0XG4gICAqIHNhdmUgZG9lcyBub3Qgc2VuZCBpdCB1bmxlc3MgdGhlIGNhbGxlciBjaGFuZ2VzIGl0IGFnYWluLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSB0byBtYXJrIHVuY2hhbmdlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBtYXJrQXR0cmlidXRlVW5jaGFuZ2VkKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyh7dmFsdWU6IHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV19KS52YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVzdHJveS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZXN0cm95ZWQgb24gYmFja2VuZC5cbiAgICovXG4gIGFzeW5jIGRlc3Ryb3koKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGlkID0gdGhpcy5pc05ld1JlY29yZCgpID8gdGhpcy5wcmltYXJ5S2V5VmFsdWUoKSA6IHRoaXMucGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKClcblxuICAgIGlmIChzaG91bGRRdWV1ZUZyb250ZW5kTW9kZWxPcGVyYXRpb25PZmZsaW5lKE1vZGVsQ2xhc3MsIFwiZGVzdHJveVwiKSkge1xuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgYE9mZmxpbmUgZGVzdHJveSBmb3IgJHtNb2RlbENsYXNzLm5hbWV9YClcblxuICAgICAgYXdhaXQgcXVldWVGcm9udGVuZE1vZGVsTXV0YXRpb25PZmZsaW5lKHtcbiAgICAgICAgYXR0cmlidXRlczoge1twcmltYXJ5S2V5XTogaWR9LFxuICAgICAgICBNb2RlbENsYXNzLFxuICAgICAgICBvcGVyYXRpb246IFwiZGVzdHJveVwiXG4gICAgICB9KVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiZGVzdHJveVwiLCB7XG4gICAgICBpZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBhdHRhY2htZW50IHBheWxvYWQgcXVldWVkIG9uIHRoaXMgbW9kZWwgZm9yIHRoZSBuZXh0IHNhdmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IEF0dGFjaG1lbnQgcGF5bG9hZCBrZXllZCBieSBhdHRhY2htZW50IG5hbWUuXG4gICAqL1xuICBhc3luYyBfYnVpbGRBdHRhY2htZW50c1BheWxvYWQoKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcGF5bG9hZCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGF0dGFjaG1lbnROYW1lIG9mIE9iamVjdC5rZXlzKHRoaXMuX2F0dGFjaG1lbnRzKSkge1xuICAgICAgY29uc3QgYXR0YWNobWVudFBheWxvYWQgPSBhd2FpdCB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0ucGVuZGluZ0F0dGFjaG1lbnRzUGF5bG9hZCgpXG5cbiAgICAgIGlmIChhdHRhY2htZW50UGF5bG9hZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHBheWxvYWRbYXR0YWNobWVudE5hbWVdID0gYXR0YWNobWVudFBheWxvYWRcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqIENsZWFycyBxdWV1ZWQgYXR0YWNobWVudCBpbnB1dHMgYWZ0ZXIgYSBzdWNjZXNzZnVsIHNhdmUuICovXG4gIF9jbGVhclBlbmRpbmdBdHRhY2htZW50cygpIHtcbiAgICBmb3IgKGNvbnN0IGF0dGFjaG1lbnROYW1lIG9mIE9iamVjdC5rZXlzKHRoaXMuX2F0dGFjaG1lbnRzKSkge1xuICAgICAgdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdLmNsZWFyUGVuZGluZ0F0dGFjaG1lbnRzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogV2Fsa3MgcmVsYXRpb25zaGlwcyBkZWNsYXJlZCBpbiB0aGlzIHJlc291cmNlJ3MgYG5lc3RlZEF0dHJpYnV0ZXNgIGNvbmZpZ1xuICAgKiBhbmQgYnVpbGRzIHRoZSBwZXItcmVsYXRpb25zaGlwIHBheWxvYWQgb2YgZGlydHkgY2hpbGRyZW4gZm9yIGEgcGFyZW50IHNhdmUuXG4gICAqXG4gICAqIEluY2x1ZGVkIGNoaWxkcmVuOlxuICAgKiAgIC0gbmV3IHJlY29yZHMgKGlzTmV3UmVjb3JkKCkpIOKGkiBjcmVhdGUgZW50cnkgd2l0aCBhdHRyaWJ1dGVzXG4gICAqICAgLSByZWNvcmRzIG1hcmtlZCBmb3IgZGVzdHJ1Y3Rpb24gKG1hcmtlZEZvckRlc3RydWN0aW9uKCkpIOKGkiBkZXN0cm95IGVudHJ5XG4gICAqICAgLSByZWNvcmRzIHdpdGggY2hhbmdlZCBhdHRyaWJ1dGVzIChpc0NoYW5nZWQoKSkg4oaSIHVwZGF0ZSBlbnRyeSB3aXRoIGF0dHJpYnV0ZXNcbiAgICogICAtIHJlY29yZHMgd2l0aCBkaXJ0eSBkZXNjZW5kYW50cyBpbiB0aGVpciBvd24gbmVzdGVkQXR0cmlidXRlcyDihpIgcmVjdXJzZVxuICAgKlxuICAgKiBMb2FkZWQgYnV0IHVudG91Y2hlZCByZWNvcmRzIGFyZSBvbWl0dGVkIHNvIG5lc3RlZCBzYXZlIHByZXNlcnZlcyBSYWlscy1zdHlsZVxuICAgKiBcImNoaWxkcmVuIG5vdCByZWZlcmVuY2VkIGluIHBheWxvYWQgYXJlIGxlZnQgYWxvbmVcIiBzZW1hbnRpY3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+Pn0gLSBQZXItcmVsYXRpb25zaGlwIGxpc3Qgb2YgbmVzdGVkLWF0dHJpYnV0ZSBlbnRyaWVzLlxuICAgKi9cbiAgYXN5bmMgX2J1aWxkTmVzdGVkQXR0cmlidXRlc1BheWxvYWQoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gTW9kZWxDbGFzcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlc0NvbmZpZyA9IHJlc291cmNlQ29uZmlnPy5uZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICBpZiAoIW5lc3RlZEF0dHJpYnV0ZXNDb25maWcpIHJldHVybiB7fVxuXG4gICAgLyoqXG4gICAgICogUGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59ICovXG4gICAgY29uc3QgcGF5bG9hZCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlc0NvbmZpZykpIHtcbiAgICAgIC8qKiBAdHlwZSB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICAgIGNvbnN0IGVudHJpZXMgPSBbXVxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXAgJiYgQXJyYXkuaXNBcnJheShyZWxhdGlvbnNoaXAuX2xvYWRlZFZhbHVlKSkge1xuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHJlbGF0aW9uc2hpcC5fbG9hZGVkVmFsdWUpIHtcbiAgICAgICAgICBjb25zdCBjaGlsZEVudHJ5ID0gYXdhaXQgY2hpbGQuX25lc3RlZEF0dHJpYnV0ZXNFbnRyeUZvclBhcmVudFNhdmUoKVxuXG4gICAgICAgICAgaWYgKGNoaWxkRW50cnkpIGVudHJpZXMucHVzaChjaGlsZEVudHJ5KVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcCAmJiByZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIHtcbiAgICAgICAgY29uc3QgY2hpbGQgPSByZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsQmFzZSkge1xuICAgICAgICAgIGNvbnN0IGNoaWxkRW50cnkgPSBhd2FpdCBjaGlsZC5fbmVzdGVkQXR0cmlidXRlc0VudHJ5Rm9yUGFyZW50U2F2ZSgpXG5cbiAgICAgICAgICBpZiAoY2hpbGRFbnRyeSkgZW50cmllcy5wdXNoKGNoaWxkRW50cnkpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlcywgcmVsYXRpb25zaGlwTmFtZSkpIHtcbiAgICAgICAgZW50cmllcy5wdXNoKFxuICAgICAgICAgIC4uLmF3YWl0IHRoaXMuX25lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoXG4gICAgICAgICAgICBNb2RlbENsYXNzLFxuICAgICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzW3JlbGF0aW9uc2hpcE5hbWVdXG4gICAgICAgICAgKVxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIGlmIChlbnRyaWVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcGF5bG9hZFtyZWxhdGlvbnNoaXBOYW1lXSA9IGVudHJpZXNcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgcGF5bG9hZCBlbnRyeSBmb3IgdGhpcyBjaGlsZCB3aGVuIHdhbGtlZCBieSBhIHBhcmVudCdzXG4gICAqIGBfYnVpbGROZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZGAuIFJldHVybnMgYG51bGxgIHdoZW4gdGhlIGNoaWxkIGhhcyBub1xuICAgKiBkaXJ0eSBzdGF0ZSBhbmQgbm8gZGlydHkgZGVzY2VuZGFudHMsIHNvIHRoZSBwYXJlbnQgY2FuIG9taXQgaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSAtIE5lc3RlZC1hdHRyaWJ1dGUgZW50cnkgb3IgbnVsbCBpZiBjbGVhbi5cbiAgICovXG4gIGFzeW5jIF9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlGb3JQYXJlbnRTYXZlKCkge1xuICAgIGlmICh0aGlzLm1hcmtlZEZvckRlc3RydWN0aW9uKCkpIHtcbiAgICAgIGlmICh0aGlzLmlzTmV3UmVjb3JkKCkpIHJldHVybiBudWxsXG4gICAgICByZXR1cm4ge2lkOiB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpLCBfZGVzdHJveTogdHJ1ZX1cbiAgICB9XG5cbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzID0gYXdhaXQgdGhpcy5fYnVpbGROZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZCgpXG4gICAgY29uc3QgaGFzTmVzdGVkRGlydHkgPSBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzKS5sZW5ndGggPiAwXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSBhd2FpdCB0aGlzLl9idWlsZEF0dGFjaG1lbnRzUGF5bG9hZCgpXG4gICAgY29uc3QgaGFzQXR0YWNobWVudHMgPSBPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMFxuXG4gICAgaWYgKHRoaXMuaXNOZXdSZWNvcmQoKSkge1xuICAgICAgLyoqXG4gICAgICAgKiBFbnRyeS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCBlbnRyeSA9IHt9XG4gICAgICBjb25zdCBhdHRyaWJ1dGVzID0gdGhpcy5fY2hhbmdlZEF0dHJpYnV0ZXNGb3JTYXZlKClcblxuICAgICAgaWYgKE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIGVudHJ5LmF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzXG4gICAgICBpZiAoaGFzQXR0YWNobWVudHMpIGVudHJ5LmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICAgIGlmIChoYXNOZXN0ZWREaXJ0eSkgZW50cnkubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcblxuICAgICAgcmV0dXJuIGVudHJ5XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLmlzQ2hhbmdlZCgpICYmICFoYXNOZXN0ZWREaXJ0eSAmJiAhaGFzQXR0YWNobWVudHMpIHJldHVybiBudWxsXG5cbiAgICAvKipcbiAgICAgKiBFbnRyeS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGVudHJ5ID0ge2lkOiB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpfVxuXG4gICAgaWYgKHRoaXMuaXNDaGFuZ2VkKCkpIGVudHJ5LmF0dHJpYnV0ZXMgPSB0aGlzLl9jaGFuZ2VkQXR0cmlidXRlc0ZvclNhdmUoKVxuICAgIGlmIChoYXNBdHRhY2htZW50cykgZW50cnkuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgIGlmIChoYXNOZXN0ZWREaXJ0eSkgZW50cnkubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIHJldHVybiBlbnRyeVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBuZXN0ZWQgZW50cmllcyBmcm9tIGEgUmFpbHMtc3R5bGUgc3VibWl0dGVkIGAqQXR0cmlidXRlc2AgdmFsdWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gUGFyZW50IG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIE5lc3RlZCByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTdWJtaXR0ZWQgbmVzdGVkIGF0dHJpYnV0ZXMgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+fSBOZXN0ZWQgZW50cmllcyBmb3IgdGhlIHRyYW5zcG9ydCBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgX25lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoTW9kZWxDbGFzcywgcmVsYXRpb25zaGlwTmFtZSwgdmFsdWUpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBEZWZpbml0aW9uID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgY29uc3QgVGFyZ2V0TW9kZWxDbGFzcyA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXBEZWZpbml0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gbmVzdGVkIHJlbGF0aW9uc2hpcDogJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIVRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGNvbmZpZ3VyZWQgZm9yICR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAocmVsYXRpb25zaGlwVHlwZUlzQ29sbGVjdGlvbihyZWxhdGlvbnNoaXBEZWZpbml0aW9uLnR5cGUpKSB7XG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1BdHRyaWJ1dGVzIG11c3QgYmUgYW4gYXJyYXlgKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgIHZhbHVlLm1hcChhc3luYyAoZW50cnkpID0+IGF3YWl0IHRoaXMuX25lc3RlZEF0dHJpYnV0ZXNFbnRyeVBheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShUYXJnZXRNb2RlbENsYXNzLCBlbnRyeSkpXG4gICAgICApXG4gICAgfVxuXG4gICAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBbXVxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfUF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBvYmplY3RgKVxuICAgIH1cblxuICAgIHJldHVybiBbYXdhaXQgdGhpcy5fbmVzdGVkQXR0cmlidXRlc0VudHJ5UGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKFRhcmdldE1vZGVsQ2xhc3MsIHZhbHVlKV1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBvbmUgc3VibWl0dGVkIFJhaWxzLXN0eWxlIG5lc3RlZCBhdHRyaWJ1dGVzIG9iamVjdCBpbnRvIHRyYW5zcG9ydCBwYXlsb2FkIHNoYXBlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIE5lc3RlZCBjaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc3VibWl0dGVkRW50cnkgLSBTdWJtaXR0ZWQgbmVzdGVkIGF0dHJpYnV0ZXMgZW50cnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IFRyYW5zcG9ydCBuZXN0ZWQtYXR0cmlidXRlcyBlbnRyeS5cbiAgICovXG4gIGFzeW5jIF9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoTW9kZWxDbGFzcywgc3VibWl0dGVkRW50cnkpIHtcbiAgICBpZiAoIWZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChzdWJtaXR0ZWRFbnRyeSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtNb2RlbENsYXNzLm5hbWV9IG5lc3RlZCBhdHRyaWJ1dGVzIGVudHJpZXMgbXVzdCBiZSBvYmplY3RzYClcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBlbnRyeSA9IHt9XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHt9XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59ICovXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc3VibWl0dGVkRW50cnkpKSB7XG4gICAgICBpZiAoYXR0cmlidXRlTmFtZSA9PT0gXCJpZFwiIHx8IGF0dHJpYnV0ZU5hbWUgPT09IFwiX2Rlc3Ryb3lcIikge1xuICAgICAgICBlbnRyeVthdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5lc3RlZFJlbGF0aW9uc2hpcE5hbWUgPSBNb2RlbENsYXNzLm5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGlmIChuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgICAgIG5lc3RlZEF0dHJpYnV0ZXNbbmVzdGVkUmVsYXRpb25zaGlwTmFtZV0gPSBhd2FpdCB0aGlzLl9uZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKFxuICAgICAgICAgIE1vZGVsQ2xhc3MsXG4gICAgICAgICAgbmVzdGVkUmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICB2YWx1ZVxuICAgICAgICApXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICAgIGF0dGFjaG1lbnRzW2F0dHJpYnV0ZU5hbWVdID0gYXdhaXQgdGhpcy5fYXR0YWNobWVudFBheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShNb2RlbENsYXNzLCBhdHRyaWJ1dGVOYW1lLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIGVudHJ5LmF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwKSBlbnRyeS5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgaWYgKE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgPSBuZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICByZXR1cm4gZW50cnlcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGEgc3VibWl0dGVkIGF0dGFjaG1lbnQgdmFsdWUgZm9yIHRyYW5zcG9ydC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyBvd25pbmcgdGhlIGF0dGFjaG1lbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTdWJtaXR0ZWQgYXR0YWNobWVudCB2YWx1ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W10+fSBOb3JtYWxpemVkIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIF9hdHRhY2htZW50UGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKE1vZGVsQ2xhc3MsIGF0dGFjaG1lbnROYW1lLCB2YWx1ZSkge1xuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbihhdHRhY2htZW50TmFtZSlcblxuICAgIGlmIChhdHRhY2htZW50RGVmaW5pdGlvbj8udHlwZSA9PT0gXCJoYXNNYW55XCIpIHtcbiAgICAgIGNvbnN0IHZhbHVlcyA9IEFycmF5LmlzQXJyYXkodmFsdWUpID8gdmFsdWUgOiBbdmFsdWVdXG5cbiAgICAgIHJldHVybiBhd2FpdCBQcm9taXNlLmFsbCh2YWx1ZXMubWFwKGFzeW5jIChlbnRyeSkgPT4gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQoZW50cnkpKSlcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IGxhc3RWYWx1ZSA9IHZhbHVlW3ZhbHVlLmxlbmd0aCAtIDFdXG5cbiAgICAgIGlmIChsYXN0VmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7TW9kZWxDbGFzcy5uYW1lfSMke2F0dGFjaG1lbnROYW1lfSBhdHRhY2htZW50IGFycmF5IGNhbm5vdCBiZSBlbXB0eWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dChsYXN0VmFsdWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIEFmdGVyIGEgcGFyZW50IHNhdmUgd2l0aCBgbmVzdGVkQXR0cmlidXRlc2AsIHRoZSBzZXJ2ZXIgcmVzcG9uc2UgaW5jbHVkZXNcbiAgICogcHJlbG9hZGVkIHZlcnNpb25zIG9mIHRoZSBhZmZlY3RlZCByZWxhdGlvbnNoaXBzLiBUaGlzIHJlcGxhY2VzIHRoZSBsb2NhbFxuICAgKiBgX2xvYWRlZFZhbHVlYCBmb3IgZWFjaCBuZXN0ZWQtd3JpdGFibGUgcmVsYXRpb25zaGlwIHdpdGggdGhlIHNlcnZlcidzXG4gICAqIGF1dGhvcml0YXRpdmUgc2V0LCBzbyBkZXN0cm95ZWQgY2hpbGRyZW4gYXJlIGRyb3BwZWQgYW5kIG5ld2x5LWNyZWF0ZWRcbiAgICogY2hpbGRyZW4gZ2V0IHRoZWlyIHNlcnZlci1hc3NpZ25lZCBpZHMgKyBwZXJzaXN0ZWQgc3RhdGUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByZXNwb25zZSAtIENvbW1hbmQgcmVzcG9uc2UgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVjb25jaWxlTmVzdGVkQXR0cmlidXRlc0Zyb21SZXNwb25zZShyZXNwb25zZSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKVxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXNDb25maWcgPSByZXNvdXJjZUNvbmZpZz8ubmVzdGVkQXR0cmlidXRlc1xuXG4gICAgaWYgKCFuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnKSByZXR1cm5cblxuICAgIGNvbnN0IG1vZGVsRGF0YSA9IE1vZGVsQ2xhc3MubW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuICAgIGNvbnN0IHByZWxvYWRlZFJlbGF0aW9uc2hpcHMgPSBtb2RlbERhdGEucHJlbG9hZGVkUmVsYXRpb25zaGlwc1xuXG4gICAgLyoqXG4gICAgICogUmVsZXZhbnQgcHJlbG9hZHMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCByZWxldmFudFByZWxvYWRzID0ge31cblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnKSkge1xuICAgICAgaWYgKHJlbGF0aW9uc2hpcE5hbWUgaW4gcHJlbG9hZGVkUmVsYXRpb25zaGlwcykge1xuICAgICAgICByZWxldmFudFByZWxvYWRzW3JlbGF0aW9uc2hpcE5hbWVdID0gcHJlbG9hZGVkUmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhyZWxldmFudFByZWxvYWRzKS5sZW5ndGggPiAwKSB7XG4gICAgICBNb2RlbENsYXNzLmFwcGx5UHJlbG9hZGVkUmVsYXRpb25zaGlwcyh0aGlzLCByZWxldmFudFByZWxvYWRzKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUgY29tbWFuZC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGV9IGNvbW1hbmRUeXBlIC0gQ29tbWFuZCB0eXBlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGF5bG9hZCAtIENvbW1hbmQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBQYXJzZWQgSlNPTiByZXNwb25zZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBleGVjdXRlQ29tbWFuZChjb21tYW5kVHlwZSwgcGF5bG9hZCkge1xuICAgIGNvbnN0IGNvbW1hbmROYW1lID0gdGhpcy5jb21tYW5kTmFtZShjb21tYW5kVHlwZSlcbiAgICBjb25zdCB0aW1lWm9uZSA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpXG4gICAgY29uc3Qgc2VyaWFsaXplZFBheWxvYWQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShwYXlsb2FkLCB7dGltZVpvbmV9KSlcbiAgICBjb25zdCByZXF1ZXN0Q29udGV4dCA9IGZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCgpXG4gICAgY29uc3QgcmVxdWVzdFBheWxvYWQgPSBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCwgc2VyaWFsaXplZFBheWxvYWQpXG4gICAgY29uc3QgcmVzb3VyY2VQYXRoID0gdGhpcy5yZXNvdXJjZVBhdGgoKVxuICAgIGNvbnN0IGNvbnRhaW5zQXR0YWNobWVudFVwbG9hZCA9IGZyb250ZW5kTW9kZWxQYXlsb2FkQ29udGFpbnNBdHRhY2htZW50VXBsb2FkKHNlcmlhbGl6ZWRQYXlsb2FkKVxuICAgIGNvbnN0IHVzZVNoYXJlZFRyYW5zcG9ydCA9ICFjb250YWluc0F0dGFjaG1lbnRVcGxvYWRcbiAgICBjb25zdCB1cmwgPSB1c2VTaGFyZWRUcmFuc3BvcnQgPyBmcm9udGVuZE1vZGVsQXBpVXJsKCkgOiBmcm9udGVuZE1vZGVsQ29tbWFuZFVybChyZXNvdXJjZVBhdGggfHwgXCJcIiwgY29tbWFuZE5hbWUpXG5cbiAgICBpZiAodXNlU2hhcmVkVHJhbnNwb3J0KSB7XG4gICAgICBjb25zdCBiYXRjaFJlc3BvbnNlID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzLnB1c2goe1xuICAgICAgICAgIGNvbW1hbmROYW1lLFxuICAgICAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICAgICAgcGF5bG9hZDogc2VyaWFsaXplZFBheWxvYWQsXG4gICAgICAgICAgcmVxdWVzdENvbnRleHQsXG4gICAgICAgICAgcmVqZWN0LFxuICAgICAgICAgIHJlcXVlc3RJZDogYCR7KytzaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdElkfWAsXG4gICAgICAgICAgcmVzb2x2ZSxcbiAgICAgICAgICByZXNvdXJjZVBhdGhcbiAgICAgICAgfSlcblxuICAgICAgICBzY2hlZHVsZVNoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0Rmx1c2goKVxuICAgICAgfSlcblxuICAgICAgY29uc3QgZGVjb2RlZEJhdGNoUmVzcG9uc2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGJhdGNoUmVzcG9uc2UpXG5cbiAgICAgIHRoaXMudGhyb3dPbkVycm9yRnJvbnRlbmRNb2RlbFJlc3BvbnNlKHtcbiAgICAgICAgY29tbWFuZFR5cGUsXG4gICAgICAgIHJlc3BvbnNlOiBkZWNvZGVkQmF0Y2hSZXNwb25zZVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIGRlY29kZWRCYXRjaFJlc3BvbnNlXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRyYWNrRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3QoYXN5bmMgKCkgPT4gcnVuV2l0aFRyYW5zcG9ydERlYWRsaW5lKFxuICAgICAge1xuICAgICAgICBlcnJvck1lc3NhZ2U6IGAke3RoaXMubmFtZX0jJHtjb21tYW5kVHlwZX0gcmVxdWVzdCB0aW1lZCBvdXRgLFxuICAgICAgICBzaWduYWw6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSxcbiAgICAgICAgdGltZW91dE1zOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKClcbiAgICAgIH0sXG4gICAgICBhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICAgIGNvbnN0IGRpcmVjdFJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVxdWVzdFBheWxvYWQpLFxuICAgICAgICAgIGNyZWRlbnRpYWxzOiBcImluY2x1ZGVcIixcbiAgICAgICAgICBoZWFkZXJzOiBmcm9udGVuZE1vZGVsUmVxdWVzdEhlYWRlcnModGltZVpvbmUpLFxuICAgICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgICAgc2lnbmFsXG4gICAgICAgIH0pXG5cbiAgICAgICAgY29uc3QgZGlyZWN0UmVzcG9uc2VUZXh0ID0gYXdhaXQgZGlyZWN0UmVzcG9uc2UudGV4dCgpXG5cbiAgICAgICAgaWYgKCFkaXJlY3RSZXNwb25zZS5vaykge1xuICAgICAgICAgIHRocm93RnJvbnRlbmRNb2RlbEh0dHBFcnJvcih7XG4gICAgICAgICAgICBjb21tYW5kTGFiZWw6IGAke3RoaXMubmFtZX0jJHtjb21tYW5kVHlwZX1gLFxuICAgICAgICAgICAgcmVzcG9uc2U6IGRpcmVjdFJlc3BvbnNlLFxuICAgICAgICAgICAgcmVzcG9uc2VUZXh0OiBkaXJlY3RSZXNwb25zZVRleHRcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZGlyZWN0SnNvbiA9IGRpcmVjdFJlc3BvbnNlVGV4dC5sZW5ndGggPiAwID8gSlNPTi5wYXJzZShkaXJlY3RSZXNwb25zZVRleHQpIDoge31cbiAgICAgICAgY29uc3QgZGVjb2RlZERpcmVjdFJlc3BvbnNlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShkaXJlY3RKc29uKSlcblxuICAgICAgICB0aGlzLnRocm93T25FcnJvckZyb250ZW5kTW9kZWxSZXNwb25zZSh7XG4gICAgICAgICAgY29tbWFuZFR5cGUsXG4gICAgICAgICAgcmVzcG9uc2U6IGRlY29kZWREaXJlY3RSZXNwb25zZVxuICAgICAgICB9KVxuXG4gICAgICAgIHJldHVybiBkZWNvZGVkRGlyZWN0UmVzcG9uc2VcbiAgICAgIH1cbiAgICApKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZSBjdXN0b20gY29tbWFuZC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHt7Y29tbWFuZE5hbWU6IHN0cmluZywgY29tbWFuZFR5cGU6IEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29tbWFuZFR5cGUsIG1lbWJlcklkPzogc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCwgcGF5bG9hZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCByZXNvdXJjZVBhdGg6IHN0cmluZ319IGFyZ3MgLSBDb21tYW5kIGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPj59IC0gRGVjb2RlZCByZXNwb25zZSBwYXlsb2FkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGV4ZWN1dGVDdXN0b21Db21tYW5kKGFyZ3MpIHtcbiAgICBjb25zdCB7Y29tbWFuZE5hbWUsIGNvbW1hbmRUeXBlLCBtZW1iZXJJZCA9IG51bGwsIHBheWxvYWQsIHJlc291cmNlUGF0aH0gPSBhcmdzXG4gICAgY29uc3QgdGltZVpvbmUgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKVxuICAgIGNvbnN0IHNlcmlhbGl6ZWRQYXlsb2FkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocGF5bG9hZCwge3RpbWVab25lfSkpXG4gICAgY29uc3QgcmVxdWVzdENvbnRleHQgPSBmcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoKVxuXG4gICAgbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQsIHNlcmlhbGl6ZWRQYXlsb2FkKVxuICAgIGNvbnN0IGN1c3RvbVBhdGggPSBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZFBhdGgoe1xuICAgICAgY29tbWFuZE5hbWUsXG4gICAgICBtZW1iZXJJZCxcbiAgICAgIG1vZGVsTmFtZTogdGhpcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgIHJlc291cmNlUGF0aFxuICAgIH0pXG5cbiAgICBjb25zdCBiYXRjaFJlc3BvbnNlID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cy5wdXNoKHtcbiAgICAgICAgY29tbWFuZFR5cGUsXG4gICAgICAgIGN1c3RvbVBhdGgsXG4gICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICAgIHBheWxvYWQ6IHNlcmlhbGl6ZWRQYXlsb2FkLFxuICAgICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgICAgcmVqZWN0LFxuICAgICAgICByZXF1ZXN0SWQ6IGAkeysrc2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RJZH1gLFxuICAgICAgICByZXNvbHZlXG4gICAgICB9KVxuXG4gICAgICBzY2hlZHVsZVNoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0Rmx1c2goKVxuICAgIH0pXG5cbiAgICBjb25zdCBkZWNvZGVkQmF0Y2hSZXNwb25zZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKGJhdGNoUmVzcG9uc2UpXG5cbiAgICB0aGlzLnRocm93T25FcnJvckZyb250ZW5kTW9kZWxSZXNwb25zZSh7XG4gICAgICBjb21tYW5kVHlwZSxcbiAgICAgIHJlc3BvbnNlOiBkZWNvZGVkQmF0Y2hSZXNwb25zZVxuICAgIH0pXG5cbiAgICByZXR1cm4gZGVjb2RlZEJhdGNoUmVzcG9uc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRocm93IG9uIGVycm9yIGZyb250ZW5kIG1vZGVsIHJlc3BvbnNlLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3tjb21tYW5kVHlwZTogRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSwgcmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHRocm93T25FcnJvckZyb250ZW5kTW9kZWxSZXNwb25zZShhcmdzKSB7XG4gICAgY29uc3Qge2NvbW1hbmRUeXBlLCByZXNwb25zZX0gPSBhcmdzXG4gICAgaWYgKHJlc3BvbnNlPy5zdGF0dXMgIT09IFwiZXJyb3JcIikgcmV0dXJuXG5cbiAgICBjb25zdCByZXNwb25zZUtleXMgPSBPYmplY3Qua2V5cyhyZXNwb25zZSlcbiAgICBjb25zdCBoYXNPbmx5U3RhdHVzID0gcmVzcG9uc2VLZXlzLmxlbmd0aCA9PT0gMSAmJiByZXNwb25zZUtleXNbMF0gPT09IFwic3RhdHVzXCJcbiAgICBjb25zdCBoYXNFcnJvck1lc3NhZ2UgPSB0eXBlb2YgcmVzcG9uc2UuZXJyb3JNZXNzYWdlID09PSBcInN0cmluZ1wiICYmIHJlc3BvbnNlLmVycm9yTWVzc2FnZS5sZW5ndGggPiAwXG4gICAgY29uc3QgaGFzRXJyb3JFbnZlbG9wZUtleXMgPSBCb29sZWFuKFxuICAgICAgcmVzcG9uc2UuY29kZSAhPT0gdW5kZWZpbmVkXG4gICAgICB8fCByZXNwb25zZS5lcnJvciAhPT0gdW5kZWZpbmVkXG4gICAgICB8fCByZXNwb25zZS5lcnJvcnMgIT09IHVuZGVmaW5lZFxuICAgICAgfHwgcmVzcG9uc2UubWVzc2FnZSAhPT0gdW5kZWZpbmVkXG4gICAgKVxuICAgIGNvbnN0IG5vblN0YXR1c0tleXMgPSByZXNwb25zZUtleXMuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJzdGF0dXNcIilcbiAgICBjb25zdCBjb25maWd1cmVkQXR0cmlidXRlTmFtZXMgPSB0aGlzLmNvbmZpZ3VyZWRGcm9udGVuZE1vZGVsQXR0cmlidXRlTmFtZXMoKVxuICAgIGNvbnN0IGxvb2tzTGlrZVJhd01vZGVsUGF5bG9hZCA9IG5vblN0YXR1c0tleXMubGVuZ3RoID4gMFxuICAgICAgJiYgbm9uU3RhdHVzS2V5cy5ldmVyeSgoa2V5KSA9PiBjb25maWd1cmVkQXR0cmlidXRlTmFtZXMuaGFzKGtleSkpXG5cbiAgICBpZiAoIWhhc0Vycm9yTWVzc2FnZSAmJiAhaGFzT25seVN0YXR1cyAmJiAhaGFzRXJyb3JFbnZlbG9wZUtleXMgJiYgbG9va3NMaWtlUmF3TW9kZWxQYXlsb2FkKSByZXR1cm5cblxuICAgIGNvbnN0IGRlYnVnRXJyb3JNZXNzYWdlID0gdHlwZW9mIHJlc3BvbnNlLmRlYnVnRXJyb3JNZXNzYWdlID09PSBcInN0cmluZ1wiICYmIHJlc3BvbnNlLmRlYnVnRXJyb3JNZXNzYWdlLmxlbmd0aCA+IDBcbiAgICAgID8gcmVzcG9uc2UuZGVidWdFcnJvck1lc3NhZ2VcbiAgICAgIDogbnVsbFxuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGRlYnVnRXJyb3JNZXNzYWdlIHx8IChoYXNFcnJvck1lc3NhZ2VcbiAgICAgID8gcmVzcG9uc2UuZXJyb3JNZXNzYWdlXG4gICAgICA6IGBSZXF1ZXN0IGZhaWxlZCBmb3IgJHt0aGlzLm5hbWV9IyR7Y29tbWFuZFR5cGV9YClcblxuICAgIGNvbnN0IGVycm9yID0gLyoqIEB0eXBlIHtFcnJvciAmIHtjb3JyZWxhdGlvbklkPzogc3RyaW5nLCBkZXRhaWxzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBlcnJvck1lc3NhZ2U/OiBzdHJpbmcsIHZlbG9jaW91cz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXJyb3JUeXBlPzogc3RyaW5nLCB2YWxpZGF0aW9uRXJyb3JzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBkZWJ1Z0Vycm9yQ2xhc3M/OiBzdHJpbmcsIGRlYnVnQmFja3RyYWNlPzogc3RyaW5nW119fSAqLyAobmV3IEVycm9yKGVycm9yTWVzc2FnZSkpXG4gICAgaWYgKGhhc0Vycm9yTWVzc2FnZSkge1xuICAgICAgZXJyb3IuZXJyb3JNZXNzYWdlID0gcmVzcG9uc2UuZXJyb3JNZXNzYWdlXG4gICAgfVxuICAgIGlmIChyZXNwb25zZS52ZWxvY2lvdXMgJiYgdHlwZW9mIHJlc3BvbnNlLnZlbG9jaW91cyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgZXJyb3IudmVsb2Npb3VzID0gcmVzcG9uc2UudmVsb2Npb3VzXG4gICAgfVxuICAgIGlmICh0eXBlb2YgcmVzcG9uc2UuZXJyb3JUeXBlID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBlcnJvci5lcnJvclR5cGUgPSByZXNwb25zZS5lcnJvclR5cGVcbiAgICB9XG4gICAgaWYgKHJlc3BvbnNlLnZhbGlkYXRpb25FcnJvcnMgJiYgdHlwZW9mIHJlc3BvbnNlLnZhbGlkYXRpb25FcnJvcnMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGVycm9yLnZhbGlkYXRpb25FcnJvcnMgPSByZXNwb25zZS52YWxpZGF0aW9uRXJyb3JzXG4gICAgfVxuICAgIGlmIChyZXNwb25zZS5kZXRhaWxzICYmIHR5cGVvZiByZXNwb25zZS5kZXRhaWxzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBlcnJvci5kZXRhaWxzID0gcmVzcG9uc2UuZGV0YWlsc1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHJlc3BvbnNlLmNvcnJlbGF0aW9uSWQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGVycm9yLmNvcnJlbGF0aW9uSWQgPSByZXNwb25zZS5jb3JyZWxhdGlvbklkXG4gICAgfVxuICAgIC8vIEZvcndhcmQgc2VydmVyLXByb3ZpZGVkIGRlYnVnIGRldGFpbCAoaW5jbHVkZWQgb25seSB3aGVuIHRoZSBiYWNrZW5kXG4gICAgLy8gZGVlbXMgdGhlIHJlcXVlc3RlciBhbGxvd2VkIHRvIHNlZSBpdCwgZS5nLiBhbiBhZG1pbikgc28gY2FsbGVycyBjYW5cbiAgICAvLyByZW5kZXIgdGhlIHJlYWwgZXJyb3IgY2xhc3MgYW5kIHN0YWNrIHRyYWNlIGluc3RlYWQgb2YgdGhlIGdlbmVyaWNcbiAgICAvLyBjbGllbnQtc2FmZSBtZXNzYWdlLlxuICAgIGlmICh0eXBlb2YgcmVzcG9uc2UuZGVidWdFcnJvckNsYXNzID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBlcnJvci5kZWJ1Z0Vycm9yQ2xhc3MgPSByZXNwb25zZS5kZWJ1Z0Vycm9yQ2xhc3NcbiAgICB9XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocmVzcG9uc2UuZGVidWdCYWNrdHJhY2UpKSB7XG4gICAgICBlcnJvci5kZWJ1Z0JhY2t0cmFjZSA9IHJlc3BvbnNlLmRlYnVnQmFja3RyYWNlXG4gICAgfVxuICAgIHRocm93IGVycm9yXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25maWd1cmVkIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIENvbmZpZ3VyZWQgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIG5hbWVzLlxuICAgKi9cbiAgc3RhdGljIGNvbmZpZ3VyZWRGcm9udGVuZE1vZGVsQXR0cmlidXRlTmFtZXMoKSB7XG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHRoaXMucmVzb3VyY2VDb25maWcoKSlcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gcmVzb3VyY2VDb25maWcuYXR0cmlidXRlc1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgIHJldHVybiBuZXcgU2V0KGF0dHJpYnV0ZXMuZmlsdGVyKChhdHRyaWJ1dGVOYW1lKSA9PiB0eXBlb2YgYXR0cmlidXRlTmFtZSA9PT0gXCJzdHJpbmdcIikpXG4gICAgfVxuXG4gICAgaWYgKGF0dHJpYnV0ZXMgJiYgdHlwZW9mIGF0dHJpYnV0ZXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVybiBuZXcgU2V0KE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpKVxuICAgIH1cblxuICAgIHJldHVybiBuZXcgU2V0KClcbiAgfVxufVxuXG4vKiogUHVibGljIGZyb250ZW5kIG1vZGVsIGZvciBzYWZlIFZlbG9jaW91cyBhdHRhY2htZW50IG1ldGFkYXRhLiAqL1xuZXhwb3J0IGNsYXNzIFZlbG9jaW91c0F0dGFjaG1lbnQgZXh0ZW5kcyBGcm9udGVuZE1vZGVsQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIGNvbmZpZy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ30gLSBSZXNvdXJjZSBjb25maWcuXG4gICAqL1xuICBzdGF0aWMgcmVzb3VyY2VDb25maWcoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgYnl0ZVNpemU6IHt0eXBlOiBcImludGVnZXJcIn0sXG4gICAgICAgIGNvbnRlbnRUeXBlOiB7bnVsbDogdHJ1ZSwgdHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgICAgICBjcmVhdGVkQXQ6IHt0eXBlOiBcImRhdGV0aW1lXCJ9LFxuICAgICAgICBmaWxlbmFtZToge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICAgICAgaWQ6IHt0eXBlOiBcInV1aWRcIn0sXG4gICAgICAgIG5hbWU6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgICAgIHBvc2l0aW9uOiB7dHlwZTogXCJpbnRlZ2VyXCJ9LFxuICAgICAgICByZWNvcmRJZDoge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICAgICAgcmVjb3JkVHlwZToge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICAgICAgdXBkYXRlZEF0OiB7dHlwZTogXCJkYXRldGltZVwifVxuICAgICAgfSxcbiAgICAgIGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHM6IFtcImluZGV4XCJdLFxuICAgICAgYnVpbHRJbk1lbWJlckNvbW1hbmRzOiBbXCJmaW5kXCJdLFxuICAgICAgbW9kZWxOYW1lOiBcIlZlbG9jaW91c0F0dGFjaG1lbnRcIixcbiAgICAgIHByaW1hcnlLZXk6IFwiaWRcIlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhdHRhY2htZW50IG1ldGFkYXRhIGJ5IGl0cyBwdWJsaWMgaWQgdGhyb3VnaCB0aGUgbWVtYmVyIGF1dGhvcml6YXRpb24gcGF0aC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gQXR0YWNobWVudCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+Pn0gLSBSZXNvbHZlZCBhdHRhY2htZW50IG1ldGFkYXRhLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmQoaWQpIHtcbiAgICByZXR1cm4gdGhpcy5pbnN0YW50aWF0ZUZyb21SZXNwb25zZShhd2FpdCB0aGlzLmV4ZWN1dGVDb21tYW5kKFwiZmluZFwiLCB7aWR9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IGlkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgaWQuXG4gICAqL1xuICBpZCgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImlkXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgb3duZXIgbW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBPd25lciBtb2RlbCBuYW1lLlxuICAgKi9cbiAgcmVjb3JkVHlwZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcInJlY29yZFR5cGVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBvd25lciByZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gT3duZXIgcmVjb3JkIGlkLlxuICAgKi9cbiAgcmVjb3JkSWQoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJyZWNvcmRJZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgbmFtZSBvbiB0aGUgb3duZXIgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0YWNobWVudCBuYW1lIG9uIHRoZSBvd25lciBtb2RlbC5cbiAgICovXG4gIG5hbWUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJuYW1lXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBwb3NpdGlvbi5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBBdHRhY2htZW50IHBvc2l0aW9uLlxuICAgKi9cbiAgcG9zaXRpb24oKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJwb3NpdGlvblwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgZmlsZW5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0YWNobWVudCBmaWxlbmFtZS5cbiAgICovXG4gIGZpbGVuYW1lKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwiZmlsZW5hbWVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IGNvbnRlbnQgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gQXR0YWNobWVudCBjb250ZW50IHR5cGUuXG4gICAqL1xuICBjb250ZW50VHlwZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImNvbnRlbnRUeXBlXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBieXRlIHNpemUuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQXR0YWNobWVudCBieXRlIHNpemUuXG4gICAqL1xuICBieXRlU2l6ZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImJ5dGVTaXplXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY3JlYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtEYXRlfSAtIENyZWF0ZWQtYXQgdGltZXN0YW1wLlxuICAgKi9cbiAgY3JlYXRlZEF0KCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwiY3JlYXRlZEF0XCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgdXBkYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtEYXRlfSAtIFVwZGF0ZWQtYXQgdGltZXN0YW1wLlxuICAgKi9cbiAgdXBkYXRlZEF0KCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwidXBkYXRlZEF0XCIpIH1cbn1cblxuRnJvbnRlbmRNb2RlbEJhc2UucmVnaXN0ZXJNb2RlbChWZWxvY2lvdXNBdHRhY2htZW50KVxuIl19