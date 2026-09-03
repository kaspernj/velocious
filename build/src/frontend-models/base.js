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
 * @returns {{recordId: string, recordType: string}} - Canonical attachment owner.
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
            recordType: attachmentOwner.recordType
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
        if (!body.record || typeof body.record !== "object")
            return;
        const deserializedRecord = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(body.record));
        const freshModel = /** @type {ReturnType<typeof JSON.parse>} */ (this.ModelClass).instantiateFromResponse(deserializedRecord);
        const listener = this.instanceListeners.get(id) || (previousId === null ? undefined : this.instanceListeners.get(previousId));
        if (action === "update" && listener) {
            const matchingUpdateCallbacks = Array.from(listener.updateCallbacks).filter((entry) => frontendModelEventEntryMatches(entry, matchedEventFilterKeys));
            if (previousIdentity !== null) {
                rekeyFrontendModelInstanceListeners(this.ModelClass, listener.instance, previousIdentity, identity);
            }
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
     * @type {{recordId: string, recordType: string} | null}
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
     * @returns {{abilities: Record<string, boolean>, attachmentOwner: {recordId: string, recordType: string} | null, attributes: Record<string, FrontendModelAttributeValue>, associationCounts: Record<string, number>, queryData: Record<string, FrontendModelAttributeValue>, preloadedRelationships: Record<string, FrontendModelAttributeValue>, selectedAttributes: Set<string>}} - Attributes, attachment owner, preloaded relationships, association counts, queryData, abilities, and selected attributes.
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
            const attachmentOwnerObject = /** @type {{recordId?: unknown, recordType?: unknown}} */ (attachmentOwnerPayload);
            attachmentOwner = {
                recordId: forcedNonBlankString(attachmentOwnerObject.recordId, `${ATTACHMENT_OWNER_KEY}.recordId`),
                recordType: forcedNonBlankString(attachmentOwnerObject.recordType, `${ATTACHMENT_OWNER_KEY}.recordType`)
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbHMvYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxPQUFPLE1BQU0sMkJBQTJCLENBQUE7QUFDL0MsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxrQkFBa0IsRUFBRSxFQUFDLGdDQUFnQyxFQUFDLE1BQU0sWUFBWSxDQUFBO0FBQy9FLE9BQU8sc0JBQXNCLE1BQU0sZ0JBQWdCLENBQUE7QUFDbkQsT0FBTyxFQUFDLDJCQUEyQixFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0UsT0FBTyxFQUFDLHFCQUFxQixFQUFFLHlCQUF5QixFQUFDLE1BQU0scUJBQXFCLENBQUE7QUFDcEYsT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGlDQUFpQyxFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0gsT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDekgsT0FBTyx3QkFBd0IsTUFBTSx5QkFBeUIsQ0FBQTtBQUM5RCxPQUFPLEVBQUMsd0JBQXdCLEVBQUUsZ0JBQWdCLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUMxRSxPQUFPLHdCQUF3QixNQUFNLG9DQUFvQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyx1QkFBdUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ3BFLE9BQU8sRUFBQyx3Q0FBd0MsRUFBRSxzQ0FBc0MsRUFBQyxNQUFNLDZCQUE2QixDQUFBO0FBQzVILE9BQU8sRUFBQyxtQkFBbUIsRUFBRSwyQkFBMkIsRUFBRSwyQkFBMkIsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ3hILE9BQU8sRUFBQyxnQkFBZ0IsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQ3hELE9BQU8sYUFBYSxNQUFN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VSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXBEOzs7T0FHRztJQUNILElBQUksS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTVDOzs7T0FHRztJQUNILFFBQVEsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXBEOzs7T0FHRztJQUNILFFBQVEsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXBEOzs7T0FHRztJQUNILFdBQVcsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRTFEOzs7T0FHRztJQUNILFFBQVEsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXBEOzs7T0FHRztJQUNILFNBQVMsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXREOzs7T0FHRztJQUNILFNBQVMsS0FBSyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDLENBQUEsQ0FBQyxDQUFDO0NBQ3ZEO0FBRUQsaUJBQWlCLENBQUMsYUFBYSxDQUFDLG1CQUFtQixDQUFDLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgdGltZW91dCBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvdGltZW91dC5qc1wiXG5pbXBvcnQgd2FpdCBmcm9tIFwiYXdhaXRlcnkvYnVpbGQvd2FpdC5qc1wiXG5pbXBvcnQgRnJvbnRlbmRNb2RlbFF1ZXJ5LCB7ZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWR9IGZyb20gXCIuL3F1ZXJ5LmpzXCJcbmltcG9ydCBGcm9udGVuZE1vZGVsUHJlbG9hZGVyIGZyb20gXCIuL3ByZWxvYWRlci5qc1wiXG5pbXBvcnQge25vcm1hbGl6ZURhdGVTdHJpbmdGb3JXcml0ZX0gZnJvbSBcIi4uL2RhdGFiYXNlL2RhdGV0aW1lLXN0b3JhZ2UuanNcIlxuaW1wb3J0IHtyZWdpc3RlckZyb250ZW5kTW9kZWwsIHJlc29sdmVGcm9udGVuZE1vZGVsQ2xhc3N9IGZyb20gXCIuL21vZGVsLXJlZ2lzdHJ5LmpzXCJcbmltcG9ydCB7dmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VDb21tYW5kTmFtZSwgdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRofSBmcm9tIFwiLi9yZXNvdXJjZS1jb25maWctdmFsaWRhdGlvbi5qc1wiXG5pbXBvcnQge2Rlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlLCBzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IGZyb20gXCIuL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcbmltcG9ydCBydW5XaXRoVHJhbnNwb3J0RGVhZGxpbmUgZnJvbSBcIi4vdHJhbnNwb3J0LWRlYWRsaW5lLmpzXCJcbmltcG9ydCB7UkVRVUVTVF9USU1FX1pPTkVfSEVBREVSLCB2YWxpZGF0ZVRpbWVab25lfSBmcm9tIFwiLi4vdGltZS16b25lLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQgZnJvbSBcIi4uL2h0dHAtY2xpZW50L3dlYnNvY2tldC1jbGllbnQuanNcIlxuaW1wb3J0IHtyZW1vdGVSZXF1ZXN0Q29udGV4dEtleX0gZnJvbSBcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuaW1wb3J0IHtjYXB0dXJlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0LCBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dH0gZnJvbSBcIi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiXG5pbXBvcnQge2J1ZmZlck91dGdvaW5nRXZlbnQsIGNsZWFyQnVmZmVyZWRPdXRnb2luZ0V2ZW50cywgZHJhaW5CdWZmZXJlZE91dGdvaW5nRXZlbnRzfSBmcm9tIFwiLi9vdXRnb2luZy1ldmVudC1idWZmZXIuanNcIlxuaW1wb3J0IHtkZWZpbmVNb2RlbFNjb3BlfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIlxuaW1wb3J0IGlzUGxhaW5PYmplY3QgZnJvbSBcIi4uL3V0aWxzL3BsYWluLW9iamVjdC5qc1wiXG5pbXBvcnQge2ZvcmNlZE5vbkJsYW5rU3RyaW5nfSBmcm9tIFwidHlwYW5pY1wiXG5pbXBvcnQge21vZGVsUHJpbWFyeUtleUNhY2hlS2V5LCBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zLCByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUsIHNjYWxhck1vZGVsUHJpbWFyeUtleSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQge3JlYWRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCwgcmVhZFBheWxvYWRDb21wdXRlZEFiaWxpdHksIHJlYWRQYXlsb2FkUXVlcnlEYXRhLCBzZXRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCwgc2V0UGF5bG9hZENvbXB1dGVkQWJpbGl0eSwgc2V0UGF5bG9hZFF1ZXJ5RGF0YX0gZnJvbSBcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiXG5cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgcmVsYXRpb25zaGlwIGhlbHBlciB0eXBlLiBSZXR1cm5lZCBieSBgZ2V0UmVsYXRpb25zaGlwQnlOYW1lYCxcbiAqIHdoaWNoIGdlbmVyYXRlZCBtb2RlbHMgaW1tZWRpYXRlbHkgY2FzdCB0byB0aGVpciBjb25jcmV0ZSByZWxhdGlvbnNoaXAgdHlwZVxuICogKGUuZy4gYEZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcDxPd25lciwgVGFyZ2V0LCBUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzPmApLlxuICogVGhlIG1lbWJlcnMgdXNlIGBhbnlgIHR5cGUgYXJncyBzbyB0aGF0IGNhc3QgaXMgYWxsb3dlZCByZWdhcmRsZXNzIG9mIHRoZVxuICogdGFyZ2V0IG1vZGVsJ3MgdHlwZWQtYXR0cmlidXRlIGdlbmVyaWNzIOKAlCBhIGNvbmNyZXRlIGBGcm9udGVuZE1vZGVsQmFzZWAgbWVtYmVyXG4gKiBoZXJlIG1ha2VzIHRoZSBjYXN0IGEgbm9uLW92ZXJsYXBwaW5nIChUUzIzNTIpIGVycm9yIGZvciBldmVyeSB0eXBlZCBtb2RlbC5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcDxhbnksIGFueSwgYW55PiB8IEZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcDxhbnksIGFueSwgYW55Pn0gRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcFxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tjYWxsYmFjazogKHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWUsIG1vZGVsOiBGcm9udGVuZE1vZGVsQmFzZX0pID0+IHZvaWQsIGV2ZW50RmlsdGVyS2V5OiBzdHJpbmcgfCBudWxsLCBldmVudEZpbHRlclBheWxvYWQ6IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZCB8IG51bGwsIHByb2plY3Rpb25QYXlsb2FkOiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH19IEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tjYWxsYmFjazogKHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWV9KSA9PiB2b2lkfX0gRnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnlcbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtcImNyZWF0ZVwiIHwgXCJmaW5kXCIgfCBcImluZGV4XCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gRnJvbnRlbmRNb2RlbENvbW1hbmRUeXBlICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29tbWFuZFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGUgfCBzdHJpbmd9IEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29tbWFuZFR5cGUgKi9cbi8qKlxuICogTW9kZWwtbGlrZSBpbnN0YW5jZSB2YWx1ZSBzdXBwb3J0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0LlxuICogQHR5cGVkZWYge3thdHRyaWJ1dGVzOiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn19IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRNb2RlbFZhbHVlXG4gKi9cbi8qKlxuICogU3BlY2lhbCBzY2FsYXIgdmFsdWVzIHJlc3RvcmVkIGJ5IGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydC5cbiAqIEB0eXBlZGVmIHt1bmRlZmluZWQgfCBudWxsIHwgYm9vbGVhbiB8IG51bWJlciB8IHN0cmluZyB8IGJpZ2ludCB8IERhdGUgfCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0TW9kZWxWYWx1ZX0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNjYWxhclZhbHVlXG4gKi9cbi8qKlxuICogUGxhaW4gb2JqZWN0IHN1cHBvcnRlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgdmFsdWVzLlxuICogTmVzdGVkIHZhbHVlcyBhcmUgaW50ZW50aW9uYWxseSBvcGFxdWUgYmVjYXVzZSBUeXBlU2NyaXB0IHJlamVjdHMgcmVjdXJzaXZlXG4gKiBKU0RvYyB0eXBlZGVmcyBmb3IgdGhpcyB0cmFuc3BvcnQgdmFsdWUgY29udHJhY3QuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRPYmplY3RcbiAqL1xuLyoqXG4gKiBWYWx1ZSBzdXBwb3J0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHNlcmlhbGl6YXRpb24gYW5kIGRlc2VyaWFsaXphdGlvbi5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsVHJhbnNwb3J0U2NhbGFyVmFsdWUgfCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0T2JqZWN0IHwgQXJyYXk8dW5rbm93bj59IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZVxuICovXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSB2YWx1ZSB1c2VkIHdoZW4gZ2VuZXJhdGVkIG1ldGFkYXRhIGNhbm5vdCBpbmZlciBhIG5hcnJvd2VyIHR5cGUuXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWVcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7dHlwZTogXCJoYXNPbmVcIiB8IFwiaGFzTWFueVwifX0gRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREZWZpbml0aW9uXG4gKi9cbi8qKlxuICogRGVmaW5lcyBmcm9udGVuZC1tb2RlbCBhdHRyaWJ1dGUgbWV0YWRhdGEuXG4gKiBAdHlwZWRlZiB7e2NvbHVtblR5cGU/OiBzdHJpbmcsIGRhdGFUeXBlPzogc3RyaW5nLCBqc0RvY1R5cGU/OiBzdHJpbmcsIG5hbWU/OiBzdHJpbmcsIG51bGw/OiBib29sZWFuLCBzZWxlY3RlZEJ5RGVmYXVsdD86IGJvb2xlYW4sIHNxbFR5cGU/OiBzdHJpbmcsIHR5cGU/OiBzdHJpbmd9fSBGcm9udGVuZE1vZGVsQXR0cmlidXRlRGVmaW5pdGlvblxuICovXG4vKipcbiAqIEF0dGFjaG1lbnQgaW5wdXQgYWNjZXB0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgYXR0YWNobWVudCBoZWxwZXJzIGJlZm9yZSBub3JtYWxpemF0aW9uLlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHthcnJheUJ1ZmZlcjogKCkgPT4gUHJvbWlzZTxBcnJheUJ1ZmZlcj4sIHR5cGU/OiBzdHJpbmcsIG5hbWU/OiBzdHJpbmd9IHwgbnVsbCB8IHVuZGVmaW5lZH0gRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRJbnB1dFxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IEZyb250ZW5kTW9kZWxTeW5jTWV0YWRhdGFcbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHtcIm9wdGltaXN0aWNWZXJzaW9uXCIgfCBcInNlcnZlcldpbnNcIiB8IFwibGFzdFdyaXRlcldpbnNcIiB8IFwiZmllbGRUaHJlZVdheVwiIHwgXCJhcHBlbmRPbmx5XCJ9IEZyb250ZW5kTW9kZWxTeW5jQ29uZmxpY3RTdHJhdGVneVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3tlbmFibGVkOiBib29sZWFuLCBvcGVyYXRpb25zOiBzdHJpbmdbXSwgcG9saWN5SGFzaDogc3RyaW5nLCBwb2xpY3lWZXJzaW9uOiBzdHJpbmcgfCBudWxsLCBjb25mbGljdFN0cmF0ZWd5PzogRnJvbnRlbmRNb2RlbFN5bmNDb25mbGljdFN0cmF0ZWd5LCBtZXRhZGF0YT86IEZyb250ZW5kTW9kZWxTeW5jTWV0YWRhdGF9fSBGcm9udGVuZE1vZGVsU3luY0NvbmZpZ1xuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3thdHRyaWJ1dGVzPzogQXJyYXk8c3RyaW5nIHwgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZURlZmluaXRpb24+IHwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZURlZmluaXRpb24+LCBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzPzogc3RyaW5nW10sIGJ1aWx0SW5NZW1iZXJDb21tYW5kcz86IHN0cmluZ1tdLCBjb2xsZWN0aW9uQ29tbWFuZHM/OiBzdHJpbmdbXSwgY29tbWFuZHM/OiBzdHJpbmdbXSwgbWVtYmVyQ29tbWFuZHM/OiBzdHJpbmdbXSwgYXR0YWNobWVudHM/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0YWNobWVudERlZmluaXRpb24+LCBtb2RlbE5hbWU/OiBzdHJpbmcsIG5lc3RlZEF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB7YWxsb3dEZXN0cm95PzogYm9vbGVhbiwgbGltaXQ/OiBudW1iZXJ9PiwgcHJpbWFyeUtleT86IHN0cmluZyB8IHN0cmluZ1tdLCByZWxhdGlvbnNoaXBzPzogc3RyaW5nW10sIHN5bmM/OiBGcm9udGVuZE1vZGVsU3luY0NvbmZpZ319IEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ1xuICovXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIGNvbnN0cnVjdG9yIHR5cGUuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlfSBbVD1Gcm9udGVuZE1vZGVsQmFzZV1cbiAqIEB0eXBlZGVmIHt7bmV3IChhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPik6IFR9fSBGcm9udGVuZE1vZGVsQ29uc3RydWN0b3JcbiAqL1xuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCBzdGF0aWMgc2lkZS5cbiAqXG4gKiBUaGUgdGVtcGxhdGUgZGVmYXVsdHMgYXJlIGludGVudGlvbmFsbHkgcGVybWlzc2l2ZSAoYGFueWAgbW9kZWwvYXR0cmlidXRlXG4gKiBwYXJhbXMpLiBUaGUgYmFyZSBgRnJvbnRlbmRNb2RlbENsYXNzYCBpcyB0aGUgYEB0aGlzYC9jb25zdHJhaW50IHR5cGUgb24gdGhlXG4gKiBzdGF0aWMgcXVlcnkgbWV0aG9kcyAoZmluZEJ5L2ZpbmQvd2hlcmUvcHJlbG9hZC8uLi4pOyBhIGdlbmVyYXRlZCBzdWJjbGFzc1xuICogZGVjbGFyZXMgdHlwZWQtYXR0cmlidXRlIGdlbmVyaWNzIChlLmcuIGBGcm9udGVuZE1vZGVsQmFzZTxBY2NvdW50QXR0cmlidXRlcyxcbiAqIEFjY291bnRDcmVhdGVBdHRyaWJ1dGVzLCBBY2NvdW50VXBkYXRlQXR0cmlidXRlcz5gKSB3aGljaCwgYWdhaW5zdCBhIGNvbmNyZXRlXG4gKiBgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPmAgZGVmYXVsdCwgZmFpbCB0aGUgY29uc3RyYWludCBieVxuICogaW52YXJpYW5jZS4gRGVmYXVsdGluZyB0byBgYW55YCBsZXRzIGFueSBzdWJjbGFzcyBzYXRpc2Z5IHRoZSBjb25zdHJhaW50IHdoaWxlXG4gKiB0aGUgbWV0aG9kcycgb3duIGBAdGVtcGxhdGUgVGAgc3RpbGwgY2FwdHVyZXMgdGhlIHByZWNpc2UgY2FsbGluZyBjbGFzcyBmb3JcbiAqIHRoZWlyIHJldHVybiB0eXBlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2V9IFtUPUZyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnk+XVxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtBdHRyaWJ1dGVzPWFueV1cbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbQ3JlYXRlQXR0cmlidXRlcz1hbnldXG4gKiBAdHlwZWRlZiB7e25ldyAoKTogVCwgY3JlYXRlKGF0dHJpYnV0ZXM/OiBDcmVhdGVBdHRyaWJ1dGVzKTogUHJvbWlzZTxUPn0gJiBPbWl0PHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZSwgXCJjcmVhdGVcIiB8IFwicHJvdG90eXBlXCI+fSBGcm9udGVuZE1vZGVsQ2xhc3NcbiAqL1xuLyoqXG4gKiBDcmVhdGUgYXR0cmlidXRlcyBhY2NlcHRlZCBieSBhIGZyb250ZW5kIG1vZGVsIGluc3RhbmNlLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZX0gVFxuICogQHR5cGVkZWYge1QgZXh0ZW5kcyBGcm9udGVuZE1vZGVsQmFzZTxSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBpbmZlciBDcmVhdGVBdHRyaWJ1dGVzLCBpbmZlciBfVXBkYXRlQXR0cmlidXRlcz4gPyBDcmVhdGVBdHRyaWJ1dGVzIDogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gRnJvbnRlbmRNb2RlbENyZWF0ZUF0dHJpYnV0ZXNGb3JcbiAqL1xuLyoqXG4gKiBMb2FkZWQgaW5zdGFuY2UgdHlwZSBmb3IgcmVsYXRpb25zaGlwIGhlbHBlciBnZW5lcmljcy4gT2xkZXIgZ2VuZXJhdGVkXG4gKiBmcm9udGVuZCBtb2RlbHMgcGFzc2VkIG1vZGVsIGNsYXNzZXMgaW50byByZWxhdGlvbnNoaXAgaGVscGVycywgd2hpbGUgbmV3ZXJcbiAqIGdlbmVyYXRlZCBtb2RlbHMgcGFzcyBpbnN0YW5jZSB0eXBlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFRcbiAqIEB0eXBlZGVmIHtUIGV4dGVuZHMgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlID8gSW5zdGFuY2VUeXBlPFQ+IDogVH0gRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZ1xuICogQHByb3BlcnR5IHtzdHJpbmcgfCAoKCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCl9IFt1cmxdIC0gT3B0aW9uYWwgZnJvbnRlbmQtbW9kZWwgVVJMLiBUaGlzIHNob3VsZCBiZSB0aGUgc2hhcmVkIGVuZHBvaW50IChmb3IgZXhhbXBsZSBgXCIvZnJvbnRlbmQtbW9kZWxzXCJgIG9yIGBcImh0dHBzOi8vZXhhbXBsZS5jb20vZnJvbnRlbmQtbW9kZWxzXCJgKS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW3NoYXJlZF0gLSBEZXByZWNhdGVkIHNoYXJlZC1lbmRwb2ludCBmbGFnIHJldGFpbmVkIGZvciBjb21wYXRpYmlsaXR5LiBGcm9udGVuZC1tb2RlbCBDUlVEL2N1c3RvbSBjb21tYW5kcyB1c2UgdGhlIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgZW52ZWxvcGUgYnkgZGVmYXVsdC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgKCgpID0+IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpfSBbd2Vic29ja2V0VXJsXSAtIE9wdGlvbmFsIHdlYnNvY2tldCBVUkwuIFdoZW4gc2V0LCBWZWxvY2lvdXMgY3JlYXRlcyBhbmQgbWFuYWdlcyBpdHMgb3duIHdlYnNvY2tldCBjbGllbnQgaW50ZXJuYWxseS4gU3Vic2NyaXB0aW9ucyB1c2UgdGhlIHdlYnNvY2tldDsgQ1JVRCB1c2VzIEhUVFAgYW5kIGZhbGxzIGJhY2sgZ3JhY2VmdWxseS4gRXhhbXBsZTogYFwid3M6Ly9sb2NhbGhvc3Q6MzAwNi93ZWJzb2NrZXRcImAuXG4gKiBAcHJvcGVydHkge3twb3N0OiAocGF0aDogc3RyaW5nLCBib2R5PzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG9wdGlvbnM/OiB7aGVhZGVycz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sIHNpZ25hbD86IEFib3J0U2lnbmFsfSkgPT4gUHJvbWlzZTx7anNvbjogKCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Piwgc3Vic2NyaWJlOiAoY2hhbm5lbDogc3RyaW5nLCBvcHRpb25zOiB7cGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSwgY2FsbGJhY2s6IChwYXlsb2FkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZCkgPT4gKCgpID0+IHZvaWQpLCBzdWJzY3JpYmVBbmRXYWl0PzogKGNoYW5uZWw6IHN0cmluZywgb3B0aW9uczoge3BhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0sIGNhbGxiYWNrOiAocGF5bG9hZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHZvaWQpID0+IFByb21pc2U8KCgpID0+IHZvaWQpPn19IFt3ZWJzb2NrZXRDbGllbnRdIC0gT3B0aW9uYWwgd2Vic29ja2V0IGNsaWVudCBmb3Igc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0cyBhbmQgc3Vic2NyaXB0aW9ucy4gSXRzIGBwb3N0YCByZWNlaXZlcyB0aGUgYm91bmRlZC1kZWFkbGluZSBgc2lnbmFsYCBhbmQgc2hvdWxkIGZvcndhcmQgaXQgaW50byB0aGUgdW5kZXJseWluZyB0cmFuc3BvcnQgc28gdGhlIGRlYWRsaW5lIGNhbiBhYm9ydCB0aGUgbGl2ZSByZXF1ZXN0IGFuZCBpdHMgcmVzcG9uc2UtYm9keSByZWFkLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgKCgpID0+IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pfSBbcmVxdWVzdEhlYWRlcnNdIC0gRXh0cmEgSFRUUC9XUyBoZWFkZXJzIHRvIGF0dGFjaCB0byBldmVyeSBmcm9udGVuZC1tb2RlbCBBUEkgcmVxdWVzdC4gUGFzcyBhIGZ1bmN0aW9uIHRvIGNvbXB1dGUgdGhlbSBhdCByZXF1ZXN0IHRpbWUgKGZvciBleGFtcGxlIHRvIGluY2x1ZGUgdGhlIGN1cnJlbnQgbG9jYWxlKS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dCB8ICgoKSA9PiBpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0IHwgdW5kZWZpbmVkIHwgbnVsbCl9IFtyZXF1ZXN0Q29udGV4dF0gLSBJbW11dGFibGUgc2NhbGFyIGNvbnRleHQgY2FwdHVyZWQgaW5kZXBlbmRlbnRseSB3aGVuIGVhY2ggb3BlcmF0aW9uIG9yIGV2ZW50IHN1YnNjcmlwdGlvbiBzdGFydHMgYW5kIHNlbnQgZm9yIHJlbW90ZSB0ZW5hbnQvYWJpbGl0eSByZXNvbHV0aW9uLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCAoKCkgPT4gbnVtYmVyIHwgdW5kZWZpbmVkIHwgbnVsbCl9IFt0aW1lb3V0XSAtIEJvdW5kZWQgZGVhZGxpbmUgaW4gbWlsbGlzZWNvbmRzIGNvdmVyaW5nIGNvbm5lY3Rpb24sIHJlc3BvbnNlIGhlYWRlcnMsIGFuZCByZXNwb25zZS1ib2R5IGNvbnN1bXB0aW9uIGZvciBlYWNoIGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0LiBPbiBleHBpcnkgdGhlIGxpdmUgZmV0Y2gvYWRhcHRlciByZXF1ZXN0IGlzIGFib3J0ZWQgKGJ1aWx0IG9uIGF3YWl0ZXJ5J3MgYHRpbWVvdXRgKSBhbmQgYXdhaXRlcnkncyBgVGltZW91dEVycm9yYCBpcyB0aHJvd24sIHNvIGNhbGxlcnMgY2FuIGNsYXNzaWZ5IGEgdGltZW91dCB2aWEgYGVycm9yIGluc3RhbmNlb2YgVGltZW91dEVycm9yYC4gUGFzcyBhIGZ1bmN0aW9uIHRvIHJlc29sdmUgaXQgcGVyIHJlcXVlc3QuIEZhbHN5L2Fic2VudCBtZWFucyBubyBkZWFkbGluZS5cbiAqIEBwcm9wZXJ0eSB7QWJvcnRTaWduYWwgfCAoKCkgPT4gQWJvcnRTaWduYWwgfCB1bmRlZmluZWQgfCBudWxsKX0gW3NpZ25hbF0gLSBPcHRpb25hbCBjYWxsZXIvc2Vzc2lvbiBBYm9ydFNpZ25hbCBjb21wb3NlZCB3aXRoIHRoZSBkZWFkbGluZS4gQWJvcnRpbmcgaXQgY2FuY2VscyB0aGUgbGl2ZSByZXF1ZXN0IChmb3IgZXhhbXBsZSBvbiBzZXNzaW9uIHNodXRkb3duIG9yIG9mZmxpbmUgdHJhbnNpdGlvbik7IHRoZSByZXN1bHRpbmcgYWJvcnQgZXJyb3Igc3RheXMgZGlzdGluZ3Vpc2hhYmxlIGZyb20gYSB0aW1lb3V0LiBQYXNzIGEgZnVuY3Rpb24gdG8gcmVzb2x2ZSB0aGUgY3VycmVudCBzaWduYWwgcGVyIHJlcXVlc3QuXG4gKiBAcHJvcGVydHkge3tnZXQ6ICgpID0+IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQgfCBQcm9taXNlPHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQ+LCBzZXQ6IChzZXNzaW9uSWQ6IHN0cmluZykgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4sIGNsZWFyOiAoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn19IFtzZXNzaW9uU3RvcmVdIC0gT3B0aW9uYWwgc2Vzc2lvbklkIHBlcnNpc3RlbmNlIGhvb2sgZm9yd2FyZGVkIHRvIHRoZSBpbnRlcm5hbCBgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50YCBzbyBXUyBzZXNzaW9ucyBjYW4gYmUgcmVzdW1lZCBhY3Jvc3MgcGFnZSByZWxvYWRzIC8gYXBwIHJlc3RhcnRzLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCAoKCkgPT4gc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCl9IFt0aW1lWm9uZV0gLSBJQU5BIHRpbWV6b25lIHNlbnQgd2l0aCBldmVyeSBmcm9udGVuZC1tb2RlbCBBUEkgcmVxdWVzdCBmb3IgdGltZXpvbmUtbGVzcyBkYXRldGltZSBwYXJzaW5nLlxuICogQHByb3BlcnR5IHt7YWN0b3JEZXZpY2VJZDogc3RyaW5nLCBhY3RvclVzZXJJZDogc3RyaW5nLCBjbGllbnRNdXRhdGlvbklkPzogKCkgPT4gc3RyaW5nLCBlbmFibGVkPzogYm9vbGVhbiwgbXV0YXRpb25Mb2c6IGltcG9ydChcIi4uL3N5bmMvbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLmRlZmF1bHQsIG5vdz86ICgpID0+IERhdGUsIG9mZmxpbmVHcmFudDoge2lkOiBzdHJpbmd9fX0gW29mZmxpbmVTeW5jXSAtIE9mZmxpbmUgbXV0YXRpb24gcXVldWUgY29uZmlndXJhdGlvbi5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsSWRsZVdhaXRBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsSWRsZVdhaXRBcmdzXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3F1aWV0TXNdIC0gTWlsbGlzZWNvbmRzIHRoZSB0cmFuc3BvcnQgbXVzdCBzdGF5IGlkbGUgYmVmb3JlIHJlc29sdmluZy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbdGltZW91dF0gLSBUaW1lb3V0IGluIG1pbGxpc2Vjb25kcy5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBjb25maWcuXG4gKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZ30gKi9cbmNvbnN0IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcgPSB7fVxuY29uc3QgU0hBUkVEX0ZST05URU5EX01PREVMX0FQSV9QQVRIID0gXCIvZnJvbnRlbmQtbW9kZWxzXCJcbmNvbnN0IFBSRUxPQURFRF9SRUxBVElPTlNISVBTX0tFWSA9IFwiX19wcmVsb2FkZWRSZWxhdGlvbnNoaXBzXCJcbmNvbnN0IFNFTEVDVEVEX0FUVFJJQlVURVNfS0VZID0gXCJfX3NlbGVjdGVkQXR0cmlidXRlc1wiXG5jb25zdCBBU1NPQ0lBVElPTl9DT1VOVFNfS0VZID0gXCJfX2Fzc29jaWF0aW9uQ291bnRzXCJcbmNvbnN0IFFVRVJZX0RBVEFfS0VZID0gXCJfX3F1ZXJ5RGF0YVwiXG5jb25zdCBBQklMSVRJRVNfS0VZID0gXCJfX2FiaWxpdGllc1wiXG5jb25zdCBBVFRBQ0hNRU5UX09XTkVSX0tFWSA9IFwiX19hdHRhY2htZW50T3duZXJcIlxuLyoqXG4gKiBQZW5kaW5nIHNoYXJlZCBmcm9udGVuZCBtb2RlbCByZXF1ZXN0cy5cbiAqIEB0eXBlIHtBcnJheTx7Y29tbWFuZE5hbWU/OiBzdHJpbmcsIGNvbW1hbmRUeXBlOiBGcm9udGVuZE1vZGVsUmVxdWVzdENvbW1hbmRUeXBlLCBjdXN0b21QYXRoPzogc3RyaW5nLCBtb2RlbENsYXNzOiBGcm9udGVuZE1vZGVsQ2xhc3MsIHBheWxvYWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgcmVxdWVzdENvbnRleHQ6IGltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQsIHJlcXVlc3RJZDogc3RyaW5nLCByZXNvbHZlOiAocmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gdm9pZCwgcmVqZWN0OiAoZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiB2b2lkLCByZXNvdXJjZVBhdGg/OiBzdHJpbmcgfCBudWxsfT59ICovXG5sZXQgcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cyA9IFtdXG5cbmxldCBzaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdElkID0gMFxubGV0IHNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZCA9IGZhbHNlXG5sZXQgYWN0aXZlRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3RDb3VudCA9IDBcbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgaWRsZSByZXNvbHZlcnMuXG4gKiBAdHlwZSB7QXJyYXk8KCkgPT4gdm9pZD59ICovXG5sZXQgZnJvbnRlbmRNb2RlbElkbGVSZXNvbHZlcnMgPSBbXVxuXG4vKipcbiAqIEludGVybmFsIHdlYnNvY2tldCBjbGllbnQuXG4gKiBAdHlwZSB7VmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50IHwgbnVsbH0gKi9cbmxldCBpbnRlcm5hbFdlYnNvY2tldENsaWVudCA9IG51bGxcbi8qKiBAdHlwZSB7QWJvcnRTaWduYWwgfCBudWxsfSAqL1xubGV0IGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsID0gbnVsbFxuLyoqIEB0eXBlIHsoKCkgPT4gdm9pZCkgfCBudWxsfSAqL1xubGV0IGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cCA9IG51bGxcblxuLyoqXG4gKiBEZXRhY2hlcyBhbiBvd25lZCBXZWJTb2NrZXQgY2xpZW50IGZyb20gdGhlIHNoYXJlZCBjYWNoZSBpZiBpdCBpcyBzdGlsbCBjdXJyZW50LlxuICogQHBhcmFtIHtWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnR9IGNsaWVudCAtIENsaWVudCB3aG9zZSBvd25lcnNoaXAgaXMgZW5kaW5nLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGRldGFjaEludGVybmFsV2Vic29ja2V0Q2xpZW50KGNsaWVudCkge1xuICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgIT09IGNsaWVudCkgcmV0dXJuXG5cbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgPSBudWxsXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cD8uKClcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwgPSBudWxsXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cCA9IG51bGxcbn1cblxuLyoqXG4gKiBEaXNwb3NlcyB0aGUgb3duZWQgV2ViU29ja2V0IGNsaWVudCBiZWZvcmUgdHJhbnNwb3J0L3Nlc3Npb24gY29uZmlndXJhdGlvbiBjaGFuZ2VzLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJlc2V0SW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSB7XG4gIGNvbnN0IGNsaWVudCA9IGludGVybmFsV2Vic29ja2V0Q2xpZW50XG5cbiAgaWYgKCFjbGllbnQpIHJldHVyblxuXG4gIGRldGFjaEludGVybmFsV2Vic29ja2V0Q2xpZW50KGNsaWVudClcbiAgdm9pZCBjbGllbnQuZGlzY29ubmVjdEFuZFN0b3BSZWNvbm5lY3QoKVxufVxuXG4vKipcbiAqIEJpbmRzIHRoZSBvd25lZCBXZWJTb2NrZXQgY2xpZW50IGxpZmV0aW1lIHRvIHRoZSBjdXJyZW50IHNlc3Npb24gc2lnbmFsLlxuICogQHBhcmFtIHtBYm9ydFNpZ25hbCB8IHVuZGVmaW5lZH0gc2Vzc2lvblNpZ25hbCAtIEN1cnJlbnQgc2Vzc2lvbiBzaWduYWwuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYmluZEludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsKHNlc3Npb25TaWduYWwpIHtcbiAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsID09PSBzZXNzaW9uU2lnbmFsKSByZXR1cm5cblxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXA/LigpXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsID0gc2Vzc2lvblNpZ25hbCB8fCBudWxsXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cCA9IG51bGxcblxuICBpZiAoIXNlc3Npb25TaWduYWwgfHwgIWludGVybmFsV2Vic29ja2V0Q2xpZW50KSByZXR1cm5cblxuICBjb25zdCBjbGllbnQgPSBpbnRlcm5hbFdlYnNvY2tldENsaWVudFxuICBjb25zdCBvblNlc3Npb25BYm9ydCA9ICgpID0+IHtcbiAgICBkZXRhY2hJbnRlcm5hbFdlYnNvY2tldENsaWVudChjbGllbnQpXG4gICAgY2xlYXJCdWZmZXJlZE91dGdvaW5nRXZlbnRzKClcbiAgICB2b2lkIGNsaWVudC5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG4gIH1cblxuICBzZXNzaW9uU2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBvblNlc3Npb25BYm9ydCwge29uY2U6IHRydWV9KVxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbENsZWFudXAgPSAoKSA9PiBzZXNzaW9uU2lnbmFsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBvblNlc3Npb25BYm9ydClcblxuICBpZiAoc2Vzc2lvblNpZ25hbC5hYm9ydGVkKSBvblNlc3Npb25BYm9ydCgpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgaXMgaWRsZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYWxsIHF1ZXVlZCBhbmQgYWN0aXZlIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCByZXF1ZXN0cyBhcmUgZG9uZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpIHtcbiAgcmV0dXJuIGFjdGl2ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0Q291bnQgPT09IDBcbiAgICAmJiBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzLmxlbmd0aCA9PT0gMFxuICAgICYmICFzaGFyZWRGcm9udGVuZE1vZGVsRmx1c2hTY2hlZHVsZWRcbn1cblxuLyoqXG4gKiBSdW5zIHJlc29sdmUgZnJvbnRlbmQgbW9kZWwgaWRsZSB3YWl0ZXJzLlxuICogQHJldHVybnMge3ZvaWR9ICovXG5mdW5jdGlvbiByZXNvbHZlRnJvbnRlbmRNb2RlbElkbGVXYWl0ZXJzKCkge1xuICBpZiAoIWZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSkgcmV0dXJuXG5cbiAgY29uc3QgcmVzb2x2ZXJzID0gZnJvbnRlbmRNb2RlbElkbGVSZXNvbHZlcnNcbiAgZnJvbnRlbmRNb2RlbElkbGVSZXNvbHZlcnMgPSBbXVxuXG4gIGZvciAoY29uc3QgcmVzb2x2ZSBvZiByZXNvbHZlcnMpIHtcbiAgICByZXNvbHZlKClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgd2FpdCBmb3IgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHF1aWV0IHBlcmlvZC5cbiAqIEBwYXJhbSB7bnVtYmVyfSBtaWxsaXNlY29uZHMgLSBRdWlldCBwZXJpb2QgbGVuZ3RoLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHRoZSBxdWlldCBwZXJpb2QuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JGcm9udGVuZE1vZGVsVHJhbnNwb3J0UXVpZXRQZXJpb2QobWlsbGlzZWNvbmRzKSB7XG4gIGlmIChtaWxsaXNlY29uZHMgPD0gMCkgcmV0dXJuXG5cbiAgYXdhaXQgd2FpdChtaWxsaXNlY29uZHMpXG59XG5cbi8qKlxuICogUnVucyB3YWl0IGZvciBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgaWRsZS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBxdWlldE1zIC0gTWlsbGlzZWNvbmRzIHRoZSB0cmFuc3BvcnQgbXVzdCBzdGF5IGlkbGUgYmVmb3JlIHJlc29sdmluZy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHRyYW5zcG9ydCBzdGF5cyBpZGxlLlxuICovXG5hc3luYyBmdW5jdGlvbiB3YWl0Rm9yRnJvbnRlbmRNb2RlbFRyYW5zcG9ydElkbGUocXVpZXRNcyA9IDApIHtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBpZiAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpKSB7XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gcXVldWVNaWNyb3Rhc2soKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKSlcblxuICAgICAgaWYgKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSkge1xuICAgICAgICBhd2FpdCB3YWl0Rm9yRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFF1aWV0UGVyaW9kKHF1aWV0TXMpXG5cbiAgICAgICAgaWYgKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRJc0lkbGUoKSkgcmV0dXJuXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgIGZyb250ZW5kTW9kZWxJZGxlUmVzb2x2ZXJzLnB1c2goKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpKVxuICAgICAgfSlcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIHRyYWNrIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCByZXF1ZXN0LlxuICogQHRlbXBsYXRlIFRcbiAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBUcmFuc3BvcnQgY2FsbGJhY2suXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHRyYWNrRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3QoY2FsbGJhY2spIHtcbiAgYWN0aXZlRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3RDb3VudCArPSAxXG5cbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICB9IGZpbmFsbHkge1xuICAgIGFjdGl2ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRSZXF1ZXN0Q291bnQgLT0gMVxuICAgIHJlc29sdmVGcm9udGVuZE1vZGVsSWRsZVdhaXRlcnMoKVxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgaW50ZXJuYWwgd2Vic29ja2V0IGNsaWVudCBmcm9tIHdlYnNvY2tldFVybCBjb25maWcuXG4gKiBDcmVhdGVzIHRoZSBjbGllbnQgbGF6aWx5IG9uIGZpcnN0IGNhbGwuIFJldHVybnMgbnVsbCBpZiBXZWJTb2NrZXRcbiAqIGlzIG5vdCBhdmFpbGFibGUgb3Igd2Vic29ja2V0VXJsIGlzIG5vdCBjb25maWd1cmVkLlxuICogQHJldHVybnMge1ZlbG9jaW91c1dlYnNvY2tldENsaWVudCB8IG51bGx9IFdlYnNvY2tldCBjbGllbnQgb3IgbnVsbC5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkge1xuICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQpIHtcbiAgICBjb25zdCBjbGllbnQgPSBpbnRlcm5hbFdlYnNvY2tldENsaWVudFxuXG4gICAgYmluZEludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSlcblxuICAgIHJldHVybiBjbGllbnRcbiAgfVxuXG4gIGNvbnN0IHdlYnNvY2tldFVybCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0VXJsXG5cbiAgaWYgKCF3ZWJzb2NrZXRVcmwpIHJldHVybiBudWxsXG4gIGlmICh0eXBlb2YgZ2xvYmFsVGhpcy5XZWJTb2NrZXQgPT09IFwidW5kZWZpbmVkXCIpIHJldHVybiBudWxsXG5cbiAgY29uc3QgcmVzb2x2ZWRVcmwgPSB0eXBlb2Ygd2Vic29ja2V0VXJsID09PSBcImZ1bmN0aW9uXCIgPyB3ZWJzb2NrZXRVcmwoKSA6IHdlYnNvY2tldFVybFxuXG4gIGlmICghcmVzb2x2ZWRVcmwpIHJldHVybiBudWxsXG5cbiAgY29uc3QgY2xpZW50ID0gbmV3IFZlbG9jaW91c1dlYnNvY2tldENsaWVudCh7XG4gICAgYXV0b1JlY29ubmVjdDogdHJ1ZSxcbiAgICBzZXNzaW9uU3RvcmU6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2Vzc2lvblN0b3JlLFxuICAgIHVybDogcmVzb2x2ZWRVcmxcbiAgfSlcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgPSBjbGllbnRcbiAgY2xpZW50Lm9uUmVjb25uZWN0ID0gYXN5bmMgKCkgPT4gYXdhaXQgZmx1c2hCdWZmZXJlZE91dGdvaW5nRXZlbnRzQWZ0ZXJSZWNvbm5lY3QoY2xpZW50KVxuXG4gIGJpbmRJbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbChmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCkpXG5cbiAgcmV0dXJuIGNsaWVudFxufVxuXG4vKipcbiAqIFJ1bnMgZmx1c2ggYnVmZmVyZWQgb3V0Z29pbmcgZXZlbnRzIGFmdGVyIHJlY29ubmVjdC5cbiAqIEBwYXJhbSB7VmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50fSBjbGllbnQgLSBSZWNvbm5lY3RlZCBjbGllbnQgdGhhdCBvd25zIHRoaXMgZmx1c2guXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gKi9cbmFzeW5jIGZ1bmN0aW9uIGZsdXNoQnVmZmVyZWRPdXRnb2luZ0V2ZW50c0FmdGVyUmVjb25uZWN0KGNsaWVudCkge1xuICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgIT09IGNsaWVudCkgcmV0dXJuXG5cbiAgY29uc3QgZXZlbnRzID0gZHJhaW5CdWZmZXJlZE91dGdvaW5nRXZlbnRzKClcbiAgY29uc3Qgc2Vzc2lvblNpZ25hbCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKVxuXG4gIGF3YWl0IHJ1bldpdGhUcmFuc3BvcnREZWFkbGluZShcbiAgICB7XG4gICAgICBlcnJvck1lc3NhZ2U6IFwiQnVmZmVyZWQgZnJvbnRlbmQtbW9kZWwgV2ViU29ja2V0IGZsdXNoIHRpbWVkIG91dFwiLFxuICAgICAgc2lnbmFsOiBzZXNzaW9uU2lnbmFsLFxuICAgICAgdGltZW91dE1zOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKClcbiAgICB9LFxuICAgIGFzeW5jIChzaWduYWwpID0+IHtcbiAgICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBldmVudHMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgICAgIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IGNsaWVudC5wb3N0KGV2ZW50c1tpbmRleF0uY3VzdG9tUGF0aCwgZXZlbnRzW2luZGV4XS5wYXlsb2FkLCB7c2lnbmFsfSlcblxuICAgICAgICAgIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50ICE9PSBjbGllbnQpIHJldHVyblxuICAgICAgICAgIGlmIChzZXNzaW9uU2lnbmFsPy5hYm9ydGVkKSByZXR1cm5cblxuICAgICAgICAgIGlmIChzaWduYWwuYWJvcnRlZCkge1xuICAgICAgICAgICAgZm9yIChsZXQgcmVtYWluaW5nID0gaW5kZXg7IHJlbWFpbmluZyA8IGV2ZW50cy5sZW5ndGg7IHJlbWFpbmluZyArPSAxKSB7XG4gICAgICAgICAgICAgIGJ1ZmZlck91dGdvaW5nRXZlbnQoZXZlbnRzW3JlbWFpbmluZ10pXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHNvY2tldE9wZW4gPSBjbGllbnQuc29ja2V0Py5yZWFkeVN0YXRlID09PSBjbGllbnQuc29ja2V0Py5PUEVOXG5cbiAgICAgICAgICBpZiAoc29ja2V0T3BlbikgY29udGludWVcblxuICAgICAgICAgIGZvciAobGV0IHJlbWFpbmluZyA9IGluZGV4OyByZW1haW5pbmcgPCBldmVudHMubGVuZ3RoOyByZW1haW5pbmcgKz0gMSkge1xuICAgICAgICAgICAgYnVmZmVyT3V0Z29pbmdFdmVudChldmVudHNbcmVtYWluaW5nXSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgKVxufVxuXG4vKipcbiAqIFJ1bnMgZGVmYXVsdCBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBwYXRoLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGVmYXVsdCByZXNvdXJjZSBwYXRoIGZvciB0aGUgbW9kZWwgY2xhc3MuXG4gKi9cbmZ1bmN0aW9uIGRlZmF1bHRGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKG1vZGVsQ2xhc3MpIHtcbiAgcmV0dXJuIGAvJHtpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnBsdXJhbGl6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUobW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSkpKX1gXG59XG5cbi8qKiBFcnJvciByYWlzZWQgd2hlbiByZWFkaW5nIGFuIGF0dHJpYnV0ZSB0aGF0IHdhcyBub3Qgc2VsZWN0ZWQgaW4gcXVlcnkgcGF5bG9hZHMuICovXG5leHBvcnQgY2xhc3MgQXR0cmlidXRlTm90U2VsZWN0ZWRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSB0aGF0IHdhcyByZXF1ZXN0ZWQuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcihtb2RlbE5hbWUsIGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBzdXBlcihgJHttb2RlbE5hbWV9IyR7YXR0cmlidXRlTmFtZX0gd2FzIG5vdCBzZWxlY3RlZGApXG4gICAgdGhpcy5uYW1lID0gXCJBdHRyaWJ1dGVOb3RTZWxlY3RlZEVycm9yXCJcbiAgfVxufVxuXG4vKipcbiAqIExpZ2h0d2VpZ2h0IHNpbmd1bGFyIHJlbGF0aW9uc2hpcCBzdGF0ZSBob2xkZXIgZm9yIGZyb250ZW5kIG1vZGVsIGluc3RhbmNlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFNcbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT4gfCB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2V9IFRcbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz1SZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+XVxuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gUGFyZW50IG1vZGVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzczxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4sIFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4sIFRhcmdldENyZWF0ZUF0dHJpYnV0ZXM+IHwgbnVsbH0gdGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG1vZGVsLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgdGhpcy5tb2RlbCA9IG1vZGVsXG4gICAgdGhpcy5yZWxhdGlvbnNoaXBOYW1lID0gcmVsYXRpb25zaGlwTmFtZVxuICAgIHRoaXMudGFyZ2V0TW9kZWxDbGFzcyA9IHRhcmdldE1vZGVsQ2xhc3NcbiAgICB0aGlzLl9wcmVsb2FkZWQgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBsb2FkZWQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbCB8IHVuZGVmaW5lZH0gbG9hZGVkVmFsdWUgLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHNldExvYWRlZChsb2FkZWRWYWx1ZSkge1xuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gbG9hZGVkVmFsdWUgPT0gdW5kZWZpbmVkID8gbnVsbCA6IGxvYWRlZFZhbHVlXG4gICAgdGhpcy5fcHJlbG9hZGVkID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHByZWxvYWRlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZWxhdGlvbnNoaXAgaXMgcHJlbG9hZGVkLlxuICAgKi9cbiAgZ2V0UHJlbG9hZGVkKCkge1xuICAgIHJldHVybiB0aGlzLl9wcmVsb2FkZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWRlZC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGx9IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGxvYWRlZCgpIHtcbiAgICBpZiAoIXRoaXMuX3ByZWxvYWRlZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IGhhc24ndCBiZWVuIHByZWxvYWRlZGApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2xvYWRlZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ29waWVzIGxvYWRlZCB2YWx1ZSBmcm9tIGFub3RoZXIgc2luZ3VsYXIgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSBzb3VyY2VSZWxhdGlvbnNoaXAgLSBTb3VyY2UgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjb3B5TG9hZGVkRnJvbShzb3VyY2VSZWxhdGlvbnNoaXApIHtcbiAgICBpZiAoc291cmNlUmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSBzb3VyY2UgcmVsYXRpb25zaGlwIHRvIGJlIHNpbmd1bGFyYClcbiAgICB9XG5cbiAgICAvLyBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSB0YXJnZXQgcmVsYXRpb25zaGlwJ3MgZG9jdW1lbnRlZCBtb2RlbCB0eXBlLlxuICAgIGNvbnN0IGxvYWRlZFZhbHVlID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsfSAqLyAoc291cmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpKVxuXG4gICAgdGhpcy5zZXRMb2FkZWQobG9hZGVkVmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZC5cbiAgICogQHBhcmFtIHtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzfSBbYXR0cmlidXRlc10gLSBOZXcgbW9kZWwgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPn0gLSBCdWlsdCBtb2RlbC5cbiAgICovXG4gIGJ1aWxkKGF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge1RhcmdldENyZWF0ZUF0dHJpYnV0ZXN9ICovICh7fSkpIHtcbiAgICBpZiAoIXRoaXMudGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcykgPT4gRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+fSAqLyAodGhpcy50YXJnZXRNb2RlbENsYXNzKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoYXR0cmlidXRlcylcblxuICAgIHRoaXMuc2V0TG9hZGVkKG1vZGVsKVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogRm9yY2UtcmVsb2FkIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGw+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgbW9kZWwuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBudWxsXG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5tb2RlbC5fdHJ5Q29ob3J0UHJlbG9hZCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoYmF0Y2hlZCkgcmV0dXJuIHRoaXMubG9hZGVkKClcblxuICAgIGF3YWl0IHRoaXMubW9kZWwubG9hZFJlbGF0aW9uc2hpcCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICByZXR1cm4gdGhpcy5sb2FkZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGxvYWRlZCByZWxhdGlvbnNoaXAgb3IgbG9hZHMgaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGw+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgbW9kZWwuXG4gICAqL1xuICBhc3luYyBvckxvYWQoKSB7XG4gICAgaWYgKHRoaXMuZ2V0UHJlbG9hZGVkKCkpIHJldHVybiB0aGlzLmxvYWRlZCgpXG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5tb2RlbC5fdHJ5Q29ob3J0UHJlbG9hZCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoYmF0Y2hlZCkgcmV0dXJuIHRoaXMubG9hZGVkKClcblxuICAgIGF3YWl0IHRoaXMubW9kZWwubG9hZFJlbGF0aW9uc2hpcCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICByZXR1cm4gdGhpcy5sb2FkZWQoKVxuICB9XG59XG5cbi8qKlxuICogTGlnaHR3ZWlnaHQgaGFzLW1hbnkgcmVsYXRpb25zaGlwIHN0YXRlIGhvbGRlciBmb3IgZnJvbnRlbmQgbW9kZWwgaW5zdGFuY2VzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gU1xuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gVFxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzPVJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT5dXG4gKi9cbmV4cG9ydCBjbGFzcyBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCB7XG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSAqL1xuICBfbG9hZGVkVmFsdWVcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBQYXJlbnQgbW9kZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzPEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz4gfCBudWxsfSB0YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgY29uc3RydWN0b3IobW9kZWwsIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICB0aGlzLm1vZGVsID0gbW9kZWxcbiAgICB0aGlzLnJlbGF0aW9uc2hpcE5hbWUgPSByZWxhdGlvbnNoaXBOYW1lXG4gICAgdGhpcy50YXJnZXRNb2RlbENsYXNzID0gdGFyZ2V0TW9kZWxDbGFzc1xuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBbXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGxvYWRlZC5cbiAgICogQHBhcmFtIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSBsb2FkZWRWYWx1ZSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0TG9hZGVkKGxvYWRlZFZhbHVlKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGxvYWRlZFZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IHRvIGJlIGxvYWRlZCB3aXRoIGFuIGFycmF5YClcbiAgICB9XG5cbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IGxvYWRlZFZhbHVlXG4gICAgdGhpcy5fcHJlbG9hZGVkID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHByZWxvYWRlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZWxhdGlvbnNoaXAgaXMgcHJlbG9hZGVkLlxuICAgKi9cbiAgZ2V0UHJlbG9hZGVkKCkge1xuICAgIHJldHVybiB0aGlzLl9wcmVsb2FkZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWRlZC5cbiAgICogQHJldHVybnMge0FycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZXMuXG4gICAqL1xuICBsb2FkZWQoKSB7XG4gICAgaWYgKCF0aGlzLl9wcmVsb2FkZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSBoYXNuJ3QgYmVlbiBwcmVsb2FkZWRgKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9sb2FkZWRWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIENvcGllcyBsb2FkZWQgdmFsdWUgZnJvbSBhbm90aGVyIGhhcy1tYW55IHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gc291cmNlUmVsYXRpb25zaGlwIC0gU291cmNlIHJlbGF0aW9uc2hpcCBoZWxwZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY29weUxvYWRlZEZyb20oc291cmNlUmVsYXRpb25zaGlwKSB7XG4gICAgaWYgKCEoc291cmNlUmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXApKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX0gc291cmNlIHJlbGF0aW9uc2hpcCB0byBiZSBoYXMtbWFueWApXG4gICAgfVxuXG4gICAgLy8gTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgdGFyZ2V0IHJlbGF0aW9uc2hpcCdzIGRvY3VtZW50ZWQgbW9kZWwgdHlwZS5cbiAgICBjb25zdCBsb2FkZWRWYWx1ZSA9IC8qKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pn0gKi8gKHNvdXJjZVJlbGF0aW9uc2hpcC5sb2FkZWQoKSlcblxuICAgIHRoaXMuc2V0TG9hZGVkKGxvYWRlZFZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWRkIHRvIGxvYWRlZC5cbiAgICogQHBhcmFtIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSBtb2RlbHMgLSBNb2RlbHMgdG8gYXBwZW5kLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFkZFRvTG9hZGVkKG1vZGVscykge1xuICAgIGNvbnN0IGxvYWRlZE1vZGVscyA9IHRoaXMuZ2V0UHJlbG9hZGVkKCkgPyB0aGlzLmxvYWRlZCgpIDogW11cblxuICAgIHRoaXMuc2V0TG9hZGVkKFsuLi5sb2FkZWRNb2RlbHMsIC4uLm1vZGVsc10pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZC5cbiAgICogQHBhcmFtIHtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzfSBbYXR0cmlidXRlc10gLSBOZXcgbW9kZWwgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPn0gLSBCdWlsdCBtb2RlbC5cbiAgICovXG4gIGJ1aWxkKGF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge1RhcmdldENyZWF0ZUF0dHJpYnV0ZXN9ICovICh7fSkpIHtcbiAgICBpZiAoIXRoaXMudGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcykgPT4gRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+fSAqLyAodGhpcy50YXJnZXRNb2RlbENsYXNzKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoYXR0cmlidXRlcylcblxuICAgIHRoaXMuYWRkVG9Mb2FkZWQoW21vZGVsXSlcblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIEZvcmNlLXJlbG9hZCB0aGUgcmVsYXRpb25zaGlwLiBXaGVuIHRoZSBwYXJlbnQgcmVjb3JkIHdhcyBsb2FkZWQgYXMgcGFydFxuICAgKiBvZiBhIGJhdGNoLCBzaWJsaW5ncyB0aGF0IGhhdmUgbm90IHByZWxvYWRlZCB0aGlzIHJlbGF0aW9uc2hpcCBnZXRcbiAgICogYmF0Y2hlZCBpbnRvIG9uZSByZXF1ZXN0IHZpYSB0aGUgY29ob3J0IHByZWxvYWRlci4gVGhlIHNjb3BlZCBxdWVyeSBwYXRoXG4gICAqIChgTW9kZWwud2hlcmUoLi4uKS5wcmVsb2FkKFtuYW1lXSkudG9BcnJheSgpYCBkaXJlY3RseSBmcm9tIHVzZXIgY29kZSlcbiAgICogYnlwYXNzZXMgY29ob3J0IGJhdGNoaW5nIGJ5IGRlc2lnbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBtb2RlbHMuXG4gICAqL1xuICBhc3luYyBsb2FkKCkge1xuICAgIC8vIFJlc2V0IHNvIHRoZSBjb2hvcnQgcHJlbG9hZGVyIChvciBzaW5nbGUtcmVjb3JkIGZhbGxiYWNrKSByZXBvcHVsYXRlcy5cbiAgICB0aGlzLl9wcmVsb2FkZWQgPSBmYWxzZVxuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gW11cblxuICAgIGNvbnN0IGJhdGNoZWQgPSBhd2FpdCB0aGlzLm1vZGVsLl90cnlDb2hvcnRQcmVsb2FkKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChiYXRjaGVkKSByZXR1cm4gdGhpcy5fbG9hZGVkVmFsdWVcblxuICAgIGF3YWl0IHRoaXMubW9kZWwubG9hZFJlbGF0aW9uc2hpcCh0aGlzLnJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICByZXR1cm4gdGhpcy5sb2FkZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYXJyYXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj4+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgbW9kZWxzLlxuICAgKi9cbiAgYXN5bmMgdG9BcnJheSgpIHtcbiAgICBpZiAodGhpcy5nZXRQcmVsb2FkZWQoKSB8fCB0aGlzLl9sb2FkZWRWYWx1ZS5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gdGhpcy5fbG9hZGVkVmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkKClcbiAgfVxufVxuXG4vKipcbiAqIENvcGllcyBsb2FkZWQgcmVsYXRpb25zaGlwIHN0YXRlIGJldHdlZW4gaGVscGVycyBvZiB0aGUgc2FtZSByZWxhdGlvbnNoaXAgc2hhcGUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gYXJncy5zb3VyY2VSZWxhdGlvbnNoaXAgLSBTb3VyY2UgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcH0gYXJncy50YXJnZXRSZWxhdGlvbnNoaXAgLSBUYXJnZXQgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBjb3B5TG9hZGVkUmVsYXRpb25zaGlwVmFsdWUoe3NvdXJjZVJlbGF0aW9uc2hpcCwgdGFyZ2V0UmVsYXRpb25zaGlwfSkge1xuICB0YXJnZXRSZWxhdGlvbnNoaXAuY29weUxvYWRlZEZyb20oc291cmNlUmVsYXRpb25zaGlwKVxufVxuXG4vKipcbiAqIFJ1bnMgcmVsYXRpb25zaGlwIHR5cGUgaXMgY29sbGVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBUeXBlIC0gUmVsYXRpb25zaGlwIHR5cGUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlbGF0aW9uc2hpcCB0eXBlIGlzIGhhcy1tYW55LlxuICovXG5mdW5jdGlvbiByZWxhdGlvbnNoaXBUeXBlSXNDb2xsZWN0aW9uKHJlbGF0aW9uc2hpcFR5cGUpIHtcbiAgcmV0dXJuIHJlbGF0aW9uc2hpcFR5cGUgPT0gXCJoYXNNYW55XCJcbn1cblxuLyoqXG4gKiBEb3dubG9hZGVkIGZyb250ZW5kLW1vZGVsIGF0dGFjaG1lbnQgcGF5bG9hZCB3cmFwcGVyLlxuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREb3dubG9hZCB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmlkIC0gQXR0YWNobWVudCBpZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmlsZW5hbWUgLSBGaWxlbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBhcmdzLmNvbnRlbnRUeXBlIC0gQ29udGVudCB0eXBlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5ieXRlU2l6ZSAtIEZpbGUgc2l6ZSBpbiBieXRlcy5cbiAgICogQHBhcmFtIHtVaW50OEFycmF5fSBhcmdzLmNvbnRlbnQgLSBGaWxlIGNvbnRlbnQgYnl0ZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gW2FyZ3MudXJsXSAtIFJlc29sdmFibGUgYXR0YWNobWVudCBVUkwuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Ynl0ZVNpemUsIGNvbnRlbnQsIGNvbnRlbnRUeXBlLCBmaWxlbmFtZSwgaWQsIHVybCA9IG51bGx9KSB7XG4gICAgdGhpcy5pZFZhbHVlID0gaWRcbiAgICB0aGlzLmZpbGVuYW1lVmFsdWUgPSBmaWxlbmFtZVxuICAgIHRoaXMuY29udGVudFR5cGVWYWx1ZSA9IGNvbnRlbnRUeXBlXG4gICAgdGhpcy5ieXRlU2l6ZVZhbHVlID0gYnl0ZVNpemVcbiAgICB0aGlzLmNvbnRlbnRWYWx1ZSA9IGNvbnRlbnRcbiAgICB0aGlzLnVybFZhbHVlID0gdXJsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBieXRlIHNpemUuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRmlsZSBzaXplIGluIGJ5dGVzLlxuICAgKi9cbiAgYnl0ZVNpemUoKSB7IHJldHVybiB0aGlzLmJ5dGVTaXplVmFsdWUgfVxuICAvKipcbiAgICogUnVucyBjb250ZW50LlxuICAgKiBAcmV0dXJucyB7VWludDhBcnJheX0gLSBGaWxlIGNvbnRlbnQgYnl0ZXMuXG4gICAqL1xuICBjb250ZW50KCkgeyByZXR1cm4gdGhpcy5jb250ZW50VmFsdWUgfVxuICAvKipcbiAgICogUnVucyBjb250ZW50IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIENvbnRlbnQgdHlwZS5cbiAgICovXG4gIGNvbnRlbnRUeXBlKCkgeyByZXR1cm4gdGhpcy5jb250ZW50VHlwZVZhbHVlIH1cbiAgLyoqXG4gICAqIFJ1bnMgZmlsZW5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRmlsZW5hbWUuXG4gICAqL1xuICBmaWxlbmFtZSgpIHsgcmV0dXJuIHRoaXMuZmlsZW5hbWVWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIGlkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgaWQuXG4gICAqL1xuICBpZCgpIHsgcmV0dXJuIHRoaXMuaWRWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIHVybC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gUmVzb2x2YWJsZSBhdHRhY2htZW50IFVSTC5cbiAgICovXG4gIHVybCgpIHsgcmV0dXJuIHRoaXMudXJsVmFsdWUgfVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgYXR0YWNobWVudCBjb21tYW5kIHBheWxvYWQuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxBdHRhY2htZW50SGFuZGxlfSBhdHRhY2htZW50IC0gQXR0YWNobWVudCB3cmFwcGVyLlxuICogQHBhcmFtIHtzdHJpbmd9IFthdHRhY2htZW50SWRdIC0gT3B0aW9uYWwgaGFzLW1hbnkgYXR0YWNobWVudCBpZC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ29tbWFuZCBwYXlsb2FkLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQXR0YWNobWVudENvbW1hbmRQYXlsb2FkKGF0dGFjaG1lbnQsIGF0dGFjaG1lbnRJZCkge1xuICAvKipcbiAgICogUGF5bG9hZC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICBhdHRhY2htZW50TmFtZTogYXR0YWNobWVudC5hdHRhY2htZW50TmFtZSxcbiAgICBpZDogYXR0YWNobWVudC5tb2RlbC5wcmltYXJ5S2V5VmFsdWUoKVxuICB9XG5cbiAgaWYgKGF0dGFjaG1lbnRJZCkgcGF5bG9hZC5hdHRhY2htZW50SWQgPSBhdHRhY2htZW50SWRcblxuICByZXR1cm4gcGF5bG9hZFxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGNhbm9uaWNhbCBiYWNraW5nIG93bmVyIHVzZWQgYnkgYXR0YWNobWVudCBtZXRhZGF0YSBzdG9yYWdlLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBGcm9udGVuZCBhdHRhY2htZW50IG93bmVyLlxuICogQHJldHVybnMge3tyZWNvcmRJZDogc3RyaW5nLCByZWNvcmRUeXBlOiBzdHJpbmd9fSAtIENhbm9uaWNhbCBhdHRhY2htZW50IG93bmVyLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQXR0YWNobWVudE93bmVyKG1vZGVsKSB7XG4gIGlmICghbW9kZWwuX2F0dGFjaG1lbnRPd25lcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBhdHRhY2htZW50IG93bmVyIG1ldGFkYXRhIG9uICR7ZnJvbnRlbmRNb2RlbENsYXNzRm9yKG1vZGVsKS5uYW1lfWApXG4gIH1cblxuICByZXR1cm4gbW9kZWwuX2F0dGFjaG1lbnRPd25lclxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgYXR0YWNobWVudCB2YWx1ZSBpcyBieXRlcy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZSBsb29rcyBsaWtlIGJ5dGUgZGF0YS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc0J5dGVzKHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZSBpbnN0YW5jZW9mIFVpbnQ4QXJyYXkgfHwgdmFsdWUgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlciB8fCAodHlwZW9mIEJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIiAmJiBCdWZmZXIuaXNCdWZmZXIodmFsdWUpKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgYXR0YWNobWVudCB2YWx1ZSBzdXBwb3J0cyBhcnJheSBidWZmZXIuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyB7YXJyYXlCdWZmZXI6ICgpID0+IFByb21pc2U8QXJyYXlCdWZmZXI+fX0gLSBXaGV0aGVyIGNhbmRpZGF0ZSBzdXBwb3J0cyBhcnJheUJ1ZmZlcigpLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZVN1cHBvcnRzQXJyYXlCdWZmZXIodmFsdWUpIHtcbiAgcmV0dXJuIEJvb2xlYW4odmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmIHR5cGVvZiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodmFsdWUpLmFycmF5QnVmZmVyID09PSBcImZ1bmN0aW9uXCIpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IG5vcm1hbGl6ZSBieXRlcy5cbiAqIEBwYXJhbSB7VWludDhBcnJheSB8IEJ1ZmZlciB8IEFycmF5QnVmZmVyfSB2YWx1ZSAtIEJ5dGUtbGlrZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHtVaW50OEFycmF5fSAtIFVpbnQ4QXJyYXkgYnl0ZXMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudE5vcm1hbGl6ZUJ5dGVzKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIFVpbnQ4QXJyYXkpIHJldHVybiB2YWx1ZVxuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikgcmV0dXJuIG5ldyBVaW50OEFycmF5KHZhbHVlKVxuICBpZiAodHlwZW9mIEJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIiAmJiBCdWZmZXIuaXNCdWZmZXIoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHZhbHVlKSkpIHtcbiAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoLyoqIEB0eXBlIHtCdWZmZXJ9ICovICh2YWx1ZSkpXG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoXCJVbnN1cHBvcnRlZCBhdHRhY2htZW50IGJ5dGVzIHZhbHVlXCIpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IGJ5dGVzIHRvIGJhc2U2NC5cbiAqIEBwYXJhbSB7VWludDhBcnJheX0gYnl0ZXMgLSBCeXRlcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQmFzZTY0IHZhbHVlLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZEF0dGFjaG1lbnRCeXRlc1RvQmFzZTY0KGJ5dGVzKSB7XG4gIGlmICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgcmV0dXJuIEJ1ZmZlci5mcm9tKGJ5dGVzKS50b1N0cmluZyhcImJhc2U2NFwiKVxuICB9XG5cbiAgbGV0IGJpbmFyeSA9IFwiXCJcblxuICBmb3IgKGNvbnN0IGJ5dGUgb2YgYnl0ZXMpIHtcbiAgICBiaW5hcnkgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShieXRlKVxuICB9XG5cbiAgaWYgKHR5cGVvZiBidG9hICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcIk1pc3NpbmcgYmFzZTY0IGVuY29kZXJcIilcblxuICByZXR1cm4gYnRvYShiaW5hcnkpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IGJhc2U2NCB0byBieXRlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIEJhc2U2NCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtVaW50OEFycmF5fSAtIERlY29kZWQgYnl0ZXMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudEJhc2U2NFRvQnl0ZXModmFsdWUpIHtcbiAgaWYgKHR5cGVvZiBCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoQnVmZmVyLmZyb20odmFsdWUsIFwiYmFzZTY0XCIpKVxuICB9XG5cbiAgaWYgKHR5cGVvZiBhdG9iICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcIk1pc3NpbmcgYmFzZTY0IGRlY29kZXJcIilcblxuICBjb25zdCBiaW5hcnkgPSBhdG9iKHZhbHVlKVxuICBjb25zdCBieXRlcyA9IG5ldyBVaW50OEFycmF5KGJpbmFyeS5sZW5ndGgpXG5cbiAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGJpbmFyeS5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICBieXRlc1tpbmRleF0gPSBiaW5hcnkuY2hhckNvZGVBdChpbmRleClcbiAgfVxuXG4gIHJldHVybiBieXRlc1xufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgYXR0YWNobWVudCB2YWx1ZSBpcyBwbGFpbiBvYmplY3QuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHt2YWx1ZSBpcyBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gV2hldGhlciB2YWx1ZSBpcyBwbGFpbiBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdCh2YWx1ZSkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIGZhbHNlXG5cbiAgY29uc3QgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKVxuXG4gIHJldHVybiBwcm90b3R5cGUgPT09IE9iamVjdC5wcm90b3R5cGUgfHwgcHJvdG90eXBlID09PSBudWxsXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBwYXlsb2FkIGNvbnRhaW5zIGF0dGFjaG1lbnQgdXBsb2FkLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBQYXlsb2FkIGNhbmRpZGF0ZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcGF5bG9hZCBjb250YWlucyBhbiBhdHRhY2htZW50IHVwbG9hZCBib2R5LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUGF5bG9hZENvbnRhaW5zQXR0YWNobWVudFVwbG9hZCh2YWx1ZSkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG5cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgcmV0dXJuIHZhbHVlLnNvbWUoKGVudHJ5KSA9PiBmcm9udGVuZE1vZGVsUGF5bG9hZENvbnRhaW5zQXR0YWNobWVudFVwbG9hZChlbnRyeSkpXG4gIH1cblxuICBpZiAoIWZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdCh2YWx1ZSkpIHJldHVybiBmYWxzZVxuXG4gIGlmICh0eXBlb2YgdmFsdWUuY29udGVudEJhc2U2NCA9PT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICByZXR1cm4gT2JqZWN0LnZhbHVlcyh2YWx1ZSkuc29tZSgoZW50cnkpID0+IGZyb250ZW5kTW9kZWxQYXlsb2FkQ29udGFpbnNBdHRhY2htZW50VXBsb2FkKGVudHJ5KSlcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBjb25jcmV0ZSBmcm9udGVuZC1tb2RlbCBjbGFzcyBmb3IgYW4gaW5zdGFuY2UuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIEZyb250ZW5kIG1vZGVsIGluc3RhbmNlLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxDbGFzc30gQ29uY3JldGUgZnJvbnRlbmQtbW9kZWwgY2xhc3MuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxDbGFzc0Zvcihtb2RlbCkge1xuICBjb25zdCBjb25zdHJ1Y3RvclZhbHVlID0gbW9kZWwuY29uc3RydWN0b3JcblxuICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQ2xhc3N9ICovIChjb25zdHJ1Y3RvclZhbHVlKVxufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGNvbmZpZ3VyZWQgb2ZmbGluZSBxdWV1ZSBzaG91bGQgaGFuZGxlIGEgbW9kZWwgb3BlcmF0aW9uLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gb3BlcmF0aW9uIC0gU3luYyBvcGVyYXRpb24uXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRvIHF1ZXVlIGxvY2FsbHkuXG4gKi9cbmZ1bmN0aW9uIHNob3VsZFF1ZXVlRnJvbnRlbmRNb2RlbE9wZXJhdGlvbk9mZmxpbmUoTW9kZWxDbGFzcywgb3BlcmF0aW9uKSB7XG4gIGNvbnN0IG9mZmxpbmVTeW5jID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5vZmZsaW5lU3luY1xuXG4gIGlmICghb2ZmbGluZVN5bmM/LmVuYWJsZWQpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IHN5bmNDb25maWcgPSBNb2RlbENsYXNzLnJlc291cmNlQ29uZmlnKCkuc3luY1xuXG4gIGlmICghc3luY0NvbmZpZz8uZW5hYmxlZCkgcmV0dXJuIGZhbHNlXG4gIGlmICghc3luY0NvbmZpZy5vcGVyYXRpb25zLmluY2x1ZGVzKG9wZXJhdGlvbikpIHRocm93IG5ldyBFcnJvcihgT2ZmbGluZSBzeW5jIGZvciAke01vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9IGRvZXMgbm90IGFsbG93ICR7b3BlcmF0aW9ufWApXG5cbiAgcmV0dXJuIHRydWVcbn1cblxuLyoqXG4gKiBRdWV1ZXMgYW4gb2ZmbGluZSBzeW5jIG11dGF0aW9uLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59IGFyZ3MuYXR0cmlidXRlcyAtIE11dGF0aW9uIGF0dHJpYnV0ZXMuXG4gKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuY2xpZW50TXV0YXRpb25JZF0gLSBQcmUtZ2VuZXJhdGVkIG11dGF0aW9uIGlkLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IGFyZ3MuTW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhcmdzLm9wZXJhdGlvbiAtIFN5bmMgb3BlcmF0aW9uLlxuICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBDbGllbnQgbXV0YXRpb24gaWQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHF1ZXVlRnJvbnRlbmRNb2RlbE11dGF0aW9uT2ZmbGluZSh7YXR0cmlidXRlcywgY2xpZW50TXV0YXRpb25JZDogcHJvdmlkZWRDbGllbnRNdXRhdGlvbklkLCBNb2RlbENsYXNzLCBvcGVyYXRpb259KSB7XG4gIGNvbnN0IG9mZmxpbmVTeW5jID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5vZmZsaW5lU3luY1xuXG4gIGlmICghb2ZmbGluZVN5bmMpIHRocm93IG5ldyBFcnJvcihcIk9mZmxpbmUgc3luYyBpcyBub3QgY29uZmlndXJlZFwiKVxuXG4gIGNvbnN0IHN5bmNDb25maWcgPSBNb2RlbENsYXNzLnJlc291cmNlQ29uZmlnKCkuc3luY1xuICBpZiAoIXN5bmNDb25maWc/LmVuYWJsZWQpIHRocm93IG5ldyBFcnJvcihgT2ZmbGluZSBzeW5jIGlzIG5vdCBlbmFibGVkIGZvciAke01vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9YClcblxuICBjb25zdCBub3cgPSBvZmZsaW5lU3luYy5ub3cgPyBvZmZsaW5lU3luYy5ub3coKSA6IG5ldyBEYXRlKClcbiAgaWYgKCEobm93IGluc3RhbmNlb2YgRGF0ZSkgfHwgTnVtYmVyLmlzTmFOKG5vdy5nZXRUaW1lKCkpKSB0aHJvdyBuZXcgRXJyb3IoXCJvZmZsaW5lU3luYy5ub3cgbXVzdCByZXR1cm4gYSB2YWxpZCBEYXRlXCIpXG5cbiAgY29uc3QgY2xpZW50TXV0YXRpb25JZCA9IHByb3ZpZGVkQ2xpZW50TXV0YXRpb25JZCB8fCAob2ZmbGluZVN5bmMuY2xpZW50TXV0YXRpb25JZCA/IG9mZmxpbmVTeW5jLmNsaWVudE11dGF0aW9uSWQoKSA6IGZyb250ZW5kTW9kZWxPZmZsaW5lTXV0YXRpb25JZCgpKVxuICBpZiAodHlwZW9mIGNsaWVudE11dGF0aW9uSWQgIT09IFwic3RyaW5nXCIgfHwgY2xpZW50TXV0YXRpb25JZC5sZW5ndGggPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCJvZmZsaW5lU3luYy5jbGllbnRNdXRhdGlvbklkIG11c3QgcmV0dXJuIGEgbm9uLWVtcHR5IHN0cmluZ1wiKVxuXG4gIGF3YWl0IG9mZmxpbmVTeW5jLm11dGF0aW9uTG9nLmFwcGVuZCh7XG4gICAgbXV0YXRpb246IHtcbiAgICAgIGFjdG9yRGV2aWNlSWQ6IG9mZmxpbmVTeW5jLmFjdG9yRGV2aWNlSWQsXG4gICAgICBhY3RvclVzZXJJZDogb2ZmbGluZVN5bmMuYWN0b3JVc2VySWQsXG4gICAgICBhdHRyaWJ1dGVzOiBmcm9udGVuZE1vZGVsU3luY0pzb25PYmplY3QoYXR0cmlidXRlcyksXG4gICAgICBiYXNlVmVyc2lvbjogbnVsbCxcbiAgICAgIGNsaWVudE11dGF0aW9uSWQsXG4gICAgICBtb2RlbDogTW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgIG9jY3VycmVkQXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgICAgb2ZmbGluZUdyYW50SWQ6IG9mZmxpbmVTeW5jLm9mZmxpbmVHcmFudC5pZCxcbiAgICAgIG9wZXJhdGlvbixcbiAgICAgIHBvbGljeUhhc2g6IHN5bmNDb25maWcucG9saWN5SGFzaFxuICAgIH1cbiAgfSlcblxuICByZXR1cm4gY2xpZW50TXV0YXRpb25JZFxufVxuXG4vKipcbiAqIEdlbmVyYXRlcyBhIGZyb250ZW5kLW1vZGVsIG9mZmxpbmUgbXV0YXRpb24gaWQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIExvY2FsIG11dGF0aW9uIGlkLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsT2ZmbGluZU11dGF0aW9uSWQoKSB7XG4gIGlmIChnbG9iYWxUaGlzLmNyeXB0byAmJiB0eXBlb2YgZ2xvYmFsVGhpcy5jcnlwdG8ucmFuZG9tVVVJRCA9PT0gXCJmdW5jdGlvblwiKSByZXR1cm4gZ2xvYmFsVGhpcy5jcnlwdG8ucmFuZG9tVVVJRCgpXG5cbiAgcmV0dXJuIGBmcm9udGVuZC1tdXRhdGlvbi0ke0RhdGUubm93KCl9LSR7TWF0aC5yYW5kb20oKS50b1N0cmluZygxNikuc2xpY2UoMil9YFxufVxuXG4vKipcbiAqIENvbnZlcnRzIG1vZGVsIGF0dHJpYnV0ZXMgdG8gc3luYy1zYWZlIEpTT04gcGF5bG9hZCB2YWx1ZXMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59IGF0dHJpYnV0ZXMgLSBGcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGVzLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAtIFN5bmMtc2FmZSBhdHRyaWJ1dGVzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsU3luY0pzb25PYmplY3QoYXR0cmlidXRlcykge1xuICBjb25zdCBzZXJpYWxpemVkID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShhdHRyaWJ1dGVzKSlcblxuICBpZiAoIXNlcmlhbGl6ZWQgfHwgdHlwZW9mIHNlcmlhbGl6ZWQgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShzZXJpYWxpemVkKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgc3luYyBtdXRhdGlvbiBhdHRyaWJ1dGVzIG9iamVjdFwiKVxuXG4gIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAqLyAoc2VyaWFsaXplZClcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBhdHRhY2htZW50IGlucHV0LlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gaW5wdXQgLSBBdHRhY2htZW50IGlucHV0LlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBUcmFuc3BvcnQtc2FmZSBhdHRhY2htZW50IHBheWxvYWQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0KSB7XG4gIGlmIChmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzUGxhaW5PYmplY3QoaW5wdXQpICYmIFwiZmlsZVwiIGluIGlucHV0KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEZpbGUgPSBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dChpbnB1dC5maWxlKVxuICAgIGNvbnN0IG1lcmdlZCA9IHtcbiAgICAgIC4uLm5vcm1hbGl6ZWRGaWxlXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBpbnB1dC5maWxlbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5maWxlbmFtZS5sZW5ndGggPiAwKSBtZXJnZWQuZmlsZW5hbWUgPSBpbnB1dC5maWxlbmFtZVxuICAgIGlmICh0eXBlb2YgaW5wdXQuY29udGVudFR5cGUgPT09IFwic3RyaW5nXCIgJiYgaW5wdXQuY29udGVudFR5cGUubGVuZ3RoID4gMCkgbWVyZ2VkLmNvbnRlbnRUeXBlID0gaW5wdXQuY29udGVudFR5cGVcblxuICAgIHJldHVybiBtZXJnZWRcbiAgfVxuXG4gIGlmIChmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzUGxhaW5PYmplY3QoaW5wdXQpKSB7XG4gICAgaWYgKHR5cGVvZiBpbnB1dC5wYXRoID09PSBcInN0cmluZ1wiICYmIGlucHV0LnBhdGgubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXR0YWNobWVudCBwYXRoIGlucHV0IGlzIG5vdCBzdXBwb3J0ZWQgaW4gZnJvbnRlbmQgbW9kZWxzXCIpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBpbnB1dC5jb250ZW50QmFzZTY0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb250ZW50QmFzZTY0OiBpbnB1dC5jb250ZW50QmFzZTY0LFxuICAgICAgICBjb250ZW50VHlwZTogdHlwZW9mIGlucHV0LmNvbnRlbnRUeXBlID09PSBcInN0cmluZ1wiICYmIGlucHV0LmNvbnRlbnRUeXBlLmxlbmd0aCA+IDAgPyBpbnB1dC5jb250ZW50VHlwZSA6IG51bGwsXG4gICAgICAgIGZpbGVuYW1lOiB0eXBlb2YgaW5wdXQuZmlsZW5hbWUgPT09IFwic3RyaW5nXCIgJiYgaW5wdXQuZmlsZW5hbWUubGVuZ3RoID4gMCA/IGlucHV0LmZpbGVuYW1lIDogdW5kZWZpbmVkXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlU3VwcG9ydHNBcnJheUJ1ZmZlcihpbnB1dCkpIHtcbiAgICBjb25zdCBieXRlcyA9IG5ldyBVaW50OEFycmF5KGF3YWl0IGlucHV0LmFycmF5QnVmZmVyKCkpXG5cbiAgICByZXR1cm4ge1xuICAgICAgY29udGVudEJhc2U2NDogZnJvbnRlbmRBdHRhY2htZW50Qnl0ZXNUb0Jhc2U2NChieXRlcyksXG4gICAgICBjb250ZW50VHlwZTogdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkudHlwZSA9PT0gXCJzdHJpbmdcIiAmJiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoaW5wdXQpLnR5cGUubGVuZ3RoID4gMFxuICAgICAgICA/IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkudHlwZVxuICAgICAgICA6IG51bGwsXG4gICAgICBmaWxlbmFtZTogdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkubmFtZSA9PT0gXCJzdHJpbmdcIiAmJiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoaW5wdXQpLm5hbWUubGVuZ3RoID4gMFxuICAgICAgICA/IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkubmFtZVxuICAgICAgICA6IFwiYXR0YWNobWVudC5iaW5cIlxuICAgIH1cbiAgfVxuXG4gIGlmIChmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzQnl0ZXMoaW5wdXQpKSB7XG4gICAgY29uc3QgYnl0ZXMgPSBmcm9udGVuZEF0dGFjaG1lbnROb3JtYWxpemVCeXRlcygvKiogQHR5cGUge1VpbnQ4QXJyYXkgfCBCdWZmZXIgfCBBcnJheUJ1ZmZlcn0gKi8gKGlucHV0KSlcblxuICAgIHJldHVybiB7XG4gICAgICBjb250ZW50QmFzZTY0OiBmcm9udGVuZEF0dGFjaG1lbnRCeXRlc1RvQmFzZTY0KGJ5dGVzKSxcbiAgICAgIGNvbnRlbnRUeXBlOiBudWxsLFxuICAgICAgZmlsZW5hbWU6IFwiYXR0YWNobWVudC5iaW5cIlxuICAgIH1cbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIGZyb250ZW5kIGF0dGFjaG1lbnQgaW5wdXRcIilcbn1cblxuLyoqXG4gKiBGcm9udGVuZC1tb2RlbCBhdHRhY2htZW50IGhlbHBlciBmb3Igb25lIGF0dGFjaG1lbnQgbmFtZS5cbiAqL1xuZXhwb3J0IGNsYXNzIEZyb250ZW5kTW9kZWxBdHRhY2htZW50SGFuZGxlIHtcbiAgLyoqXG4gICAqIFBlbmRpbmcgYXR0YWNobWVudCBpbnB1dHMgcXVldWVkIGZvciB0aGUgbmV4dCBtb2RlbCBzYXZlLlxuICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRJbnB1dFtdfVxuICAgKi9cbiAgcGVuZGluZ0lucHV0cyA9IFtdXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gYXJncy5tb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHthdHRhY2htZW50TmFtZSwgbW9kZWx9KSB7XG4gICAgdGhpcy5tb2RlbCA9IG1vZGVsXG4gICAgdGhpcy5hdHRhY2htZW50TmFtZSA9IGF0dGFjaG1lbnROYW1lXG4gIH1cblxuICAvKipcbiAgICogUXVldWUgYXR0YWNobWVudCBpbnB1dCBmb3IgdGhlIHBhcmVudCBtb2RlbCdzIG5leHQgc2F2ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQXR0YWNobWVudElucHV0IHwgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRJbnB1dFtdfSBpbnB1dCAtIEF0dGFjaG1lbnQgaW5wdXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcXVldWVBdHRhY2goaW5wdXQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKHRoaXMuYXR0YWNobWVudE5hbWUpXG5cbiAgICBpZiAoYXR0YWNobWVudERlZmluaXRpb24/LnR5cGUgPT09IFwiaGFzT25lXCIpIHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGlucHV0KSkge1xuICAgICAgICBjb25zdCBsYXN0SW5wdXQgPSBpbnB1dFtpbnB1dC5sZW5ndGggLSAxXVxuXG4gICAgICAgIHRoaXMucGVuZGluZ0lucHV0cyA9IHR5cGVvZiBsYXN0SW5wdXQgPT09IFwidW5kZWZpbmVkXCIgPyBbXSA6IFtsYXN0SW5wdXRdXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnBlbmRpbmdJbnB1dHMgPSBbaW5wdXRdXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShpbnB1dCkpIHtcbiAgICAgIHRoaXMucGVuZGluZ0lucHV0cy5wdXNoKC4uLmlucHV0KVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnBlbmRpbmdJbnB1dHMucHVzaChpbnB1dClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGlzIGF0dGFjaG1lbnQgaGFzIHF1ZXVlZCBpbnB1dHMgZm9yIHRoZSBuZXh0IG1vZGVsIHNhdmUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGFueSBwZW5kaW5nIGlucHV0cyBleGlzdC5cbiAgICovXG4gIGhhc1BlbmRpbmdBdHRhY2htZW50cygpIHtcbiAgICByZXR1cm4gdGhpcy5wZW5kaW5nSW5wdXRzLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIHNhdmUgcGF5bG9hZCBmb3IgcXVldWVkIGF0dGFjaG1lbnQgaW5wdXRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXSB8IHVuZGVmaW5lZD59IE5vcm1hbGl6ZWQgYXR0YWNobWVudCBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgcGVuZGluZ0F0dGFjaG1lbnRzUGF5bG9hZCgpIHtcbiAgICBpZiAodGhpcy5wZW5kaW5nSW5wdXRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbih0aGlzLmF0dGFjaG1lbnROYW1lKVxuXG4gICAgaWYgKGF0dGFjaG1lbnREZWZpbml0aW9uPy50eXBlID09PSBcImhhc01hbnlcIikge1xuICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKHRoaXMucGVuZGluZ0lucHV0cy5tYXAoYXN5bmMgKGlucHV0KSA9PiBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dChpbnB1dCkpKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dCh0aGlzLnBlbmRpbmdJbnB1dHNbdGhpcy5wZW5kaW5nSW5wdXRzLmxlbmd0aCAtIDFdKVxuICB9XG5cbiAgLyoqIENsZWFycyBxdWV1ZWQgYXR0YWNobWVudCBpbnB1dHMgYWZ0ZXIgYSBzdWNjZXNzZnVsIG1vZGVsIHNhdmUuICovXG4gIGNsZWFyUGVuZGluZ0F0dGFjaG1lbnRzKCkge1xuICAgIHRoaXMucGVuZGluZ0lucHV0cyA9IFtdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2guXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGlucHV0IC0gQXR0YWNobWVudCBpbnB1dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhdHRhY2hlZC5cbiAgICovXG4gIGFzeW5jIGF0dGFjaChpbnB1dCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCBub3JtYWxpemVkSW5wdXQgPSBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dChpbnB1dClcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IE1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJhdHRhY2hcIiwge1xuICAgICAgYXR0YWNobWVudDogbm9ybWFsaXplZElucHV0LFxuICAgICAgYXR0YWNobWVudE5hbWU6IHRoaXMuYXR0YWNobWVudE5hbWUsXG4gICAgICBpZDogdGhpcy5tb2RlbC5wcmltYXJ5S2V5VmFsdWUoKVxuICAgIH0pXG5cbiAgICB0aGlzLm1vZGVsLmFzc2lnbkF0dHJpYnV0ZXMoTW9kZWxDbGFzcy5hdHRyaWJ1dGVzRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRvd25sb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2F0dGFjaG1lbnRJZF0gLSBPcHRpb25hbCBhdHRhY2htZW50IGlkIGZvciBoYXMtbWFueSBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREb3dubG9hZCB8IG51bGw+fSAtIERvd25sb2FkZWQgYXR0YWNobWVudCBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgZG93bmxvYWQoYXR0YWNobWVudElkKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcImRvd25sb2FkXCIsIGZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29tbWFuZFBheWxvYWQodGhpcywgYXR0YWNobWVudElkKSlcbiAgICBjb25zdCBhdHRhY2htZW50UGF5bG9hZCA9IHJlc3BvbnNlLmF0dGFjaG1lbnRcblxuICAgIGlmICghYXR0YWNobWVudFBheWxvYWQgfHwgdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkICE9PSBcIm9iamVjdFwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgY29udGVudEJhc2U2NCA9IHR5cGVvZiBhdHRhY2htZW50UGF5bG9hZC5jb250ZW50QmFzZTY0ID09PSBcInN0cmluZ1wiID8gYXR0YWNobWVudFBheWxvYWQuY29udGVudEJhc2U2NCA6IFwiXCJcbiAgICBjb25zdCBjb250ZW50ID0gZnJvbnRlbmRBdHRhY2htZW50QmFzZTY0VG9CeXRlcyhjb250ZW50QmFzZTY0KVxuICAgIGNvbnN0IGJ5dGVTaXplID0gTnVtYmVyKGF0dGFjaG1lbnRQYXlsb2FkLmJ5dGVTaXplKVxuXG4gICAgcmV0dXJuIG5ldyBGcm9udGVuZE1vZGVsQXR0YWNobWVudERvd25sb2FkKHtcbiAgICAgIGJ5dGVTaXplOiBOdW1iZXIuaXNGaW5pdGUoYnl0ZVNpemUpID8gYnl0ZVNpemUgOiBjb250ZW50Lmxlbmd0aCxcbiAgICAgIGNvbnRlbnQsXG4gICAgICBjb250ZW50VHlwZTogdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRUeXBlID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRUeXBlLmxlbmd0aCA+IDAgPyBhdHRhY2htZW50UGF5bG9hZC5jb250ZW50VHlwZSA6IG51bGwsXG4gICAgICBmaWxlbmFtZTogdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLmZpbGVuYW1lID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnRQYXlsb2FkLmZpbGVuYW1lLmxlbmd0aCA+IDAgPyBhdHRhY2htZW50UGF5bG9hZC5maWxlbmFtZSA6IFwiYXR0YWNobWVudC5iaW5cIixcbiAgICAgIGlkOiB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQuaWQgPT09IFwic3RyaW5nXCIgPyBhdHRhY2htZW50UGF5bG9hZC5pZCA6IFwiXCIsXG4gICAgICB1cmw6IHR5cGVvZiBhdHRhY2htZW50UGF5bG9hZC51cmwgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudFBheWxvYWQudXJsLmxlbmd0aCA+IDAgPyBhdHRhY2htZW50UGF5bG9hZC51cmwgOiBudWxsXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVybC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthdHRhY2htZW50SWRdIC0gT3B0aW9uYWwgYXR0YWNobWVudCBpZCBmb3IgaGFzLW1hbnkgYXR0YWNobWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSAtIFJlc29sdmFibGUgYXR0YWNobWVudCBVUkwuXG4gICAqL1xuICBhc3luYyB1cmwoYXR0YWNobWVudElkKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcInVybFwiLCBmcm9udGVuZE1vZGVsQXR0YWNobWVudENvbW1hbmRQYXlsb2FkKHRoaXMsIGF0dGFjaG1lbnRJZCkpXG5cbiAgICBpZiAodHlwZW9mIHJlc3BvbnNlLnVybCA9PT0gXCJzdHJpbmdcIiAmJiByZXNwb25zZS51cmwubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIHJlc3BvbnNlLnVybFxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgcXVlcnkgZm9yIHRoaXMgYXR0YWNobWVudCBoYW5kbGUncyBtZXRhZGF0YSByb3dzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBWZWxvY2lvdXNBdHRhY2htZW50Pn0gLSBBdHRhY2htZW50IG1ldGFkYXRhIHF1ZXJ5LlxuICAgKi9cbiAgcXVlcnkoKSB7XG4gICAgY29uc3QgYXR0YWNobWVudE93bmVyID0gZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRPd25lcih0aGlzLm1vZGVsKVxuXG4gICAgcmV0dXJuIFZlbG9jaW91c0F0dGFjaG1lbnRcbiAgICAgIC53aGVyZSh7XG4gICAgICAgIG5hbWU6IHRoaXMuYXR0YWNobWVudE5hbWUsXG4gICAgICAgIHJlY29yZElkOiBhdHRhY2htZW50T3duZXIucmVjb3JkSWQsXG4gICAgICAgIHJlY29yZFR5cGU6IGF0dGFjaG1lbnRPd25lci5yZWNvcmRUeXBlXG4gICAgICB9KVxuICAgICAgLm9yZGVyKFtbXCJwb3NpdGlvblwiLCBcImFzY1wiXV0pXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgYWxsIGF0dGFjaG1lbnQgbWV0YWRhdGEgcm93cyBmb3IgdGhpcyBoYW5kbGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFZlbG9jaW91c0F0dGFjaG1lbnRbXT59IC0gQXR0YWNobWVudCBtZXRhZGF0YSByb3dzLlxuICAgKi9cbiAgYXN5bmMgdG9BcnJheSgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLnRvQXJyYXkoKVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIHRoZSBmaXJzdCBhdHRhY2htZW50IG1ldGFkYXRhIHJvdyBmb3IgdGhpcyBoYW5kbGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFZlbG9jaW91c0F0dGFjaG1lbnQgfCBudWxsPn0gLSBGaXJzdCBhdHRhY2htZW50IG1ldGFkYXRhIHJvdy5cbiAgICovXG4gIGFzeW5jIGZpcnN0KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmlyc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGlzdC4gUmV0dXJucyBtZXRhZGF0YSBmb3IgZXZlcnkgYXR0YWNobWVudCB1bmRlciB0aGlzIGF0dGFjaG1lbnQgbmFtZVxuICAgKiAobm8gY29udGVudCBieXRlcyksIHNvIGNhbGxlcnMgY2FuIGVudW1lcmF0ZSBoYXMtbWFueSBhdHRhY2htZW50cyBhbmQgdGhlblxuICAgKiBkb3dubG9hZCBvciBsaW5rIHRvIGVhY2ggb25lIGJ5IGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTx7Ynl0ZVNpemU6IG51bWJlciwgY29udGVudFR5cGU6IHN0cmluZyB8IG51bGwsIGZpbGVuYW1lOiBzdHJpbmcsIGlkOiBzdHJpbmcsIHVybDogc3RyaW5nIHwgbnVsbH0+Pn0gLSBBdHRhY2htZW50IG1ldGFkYXRhIGVudHJpZXMuXG4gICAqL1xuICBhc3luYyBsaXN0KCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IE1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJhdHRhY2htZW50TGlzdFwiLCBmcm9udGVuZE1vZGVsQXR0YWNobWVudENvbW1hbmRQYXlsb2FkKHRoaXMpKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gQXJyYXkuaXNBcnJheShyZXNwb25zZS5hdHRhY2htZW50cykgPyByZXNwb25zZS5hdHRhY2htZW50cyA6IFtdXG5cbiAgICByZXR1cm4gYXR0YWNobWVudHMubWFwKChhdHRhY2htZW50KSA9PiB7XG4gICAgICBjb25zdCBieXRlU2l6ZSA9IE51bWJlcihhdHRhY2htZW50LmJ5dGVTaXplKVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBieXRlU2l6ZTogTnVtYmVyLmlzRmluaXRlKGJ5dGVTaXplKSA/IGJ5dGVTaXplIDogMCxcbiAgICAgICAgY29udGVudFR5cGU6IHR5cGVvZiBhdHRhY2htZW50LmNvbnRlbnRUeXBlID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnQuY29udGVudFR5cGUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnQuY29udGVudFR5cGUgOiBudWxsLFxuICAgICAgICBmaWxlbmFtZTogdHlwZW9mIGF0dGFjaG1lbnQuZmlsZW5hbWUgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudC5maWxlbmFtZS5sZW5ndGggPiAwID8gYXR0YWNobWVudC5maWxlbmFtZSA6IFwiYXR0YWNobWVudC5iaW5cIixcbiAgICAgICAgaWQ6IHR5cGVvZiBhdHRhY2htZW50LmlkID09PSBcInN0cmluZ1wiID8gYXR0YWNobWVudC5pZCA6IFwiXCIsXG4gICAgICAgIHVybDogdHlwZW9mIGF0dGFjaG1lbnQudXJsID09PSBcInN0cmluZ1wiICYmIGF0dGFjaG1lbnQudXJsLmxlbmd0aCA+IDAgPyBhdHRhY2htZW50LnVybCA6IG51bGxcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZG93bmxvYWQgdXJsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERvd25sb2FkIFVSTCBmb3IgdGhpcyBhdHRhY2htZW50IG9uIHRoZSBjb25maWd1cmVkIGJhY2tlbmQuXG4gICAqL1xuICBkb3dubG9hZFVybCgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgY29tbWFuZE5hbWUgPSBNb2RlbENsYXNzLmNvbW1hbmROYW1lKFwiZG93bmxvYWRcIilcbiAgICBjb25zdCByZXNvdXJjZVBhdGggPSBNb2RlbENsYXNzLnJlc291cmNlUGF0aCgpXG4gICAgY29uc3QgY29tbWFuZFVybCA9IGZyb250ZW5kTW9kZWxDb21tYW5kVXJsKHJlc291cmNlUGF0aCwgY29tbWFuZE5hbWUpXG4gICAgY29uc3QgcGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcyh7XG4gICAgICBhdHRhY2htZW50TmFtZTogdGhpcy5hdHRhY2htZW50TmFtZSxcbiAgICAgIGlkOiBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgdGhpcy5tb2RlbC5wcmltYXJ5S2V5VmFsdWUoKSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIGAke2NvbW1hbmRVcmx9PyR7cGFyYW1zLnRvU3RyaW5nKCl9YFxuICB9XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHVybC5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbH0gdmFsdWUgLSBVUkwgY2FuZGlkYXRlLlxuICogQHJldHVybnMge3N0cmluZ30gLSBOb3JtYWxpemVkIFVSTCB3aXRob3V0IHRyYWlsaW5nIHNsYXNoLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VXJsKHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiBcIlwiXG5cbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKVxuXG4gIGlmICghdHJpbW1lZC5sZW5ndGgpIHJldHVybiBcIlwiXG5cbiAgcmV0dXJuIHRyaW1tZWQucmVwbGFjZSgvXFwvKyQvLCBcIlwiKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHVybC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUmVzb2x2ZWQgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IFVSTC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybCgpIHtcbiAgY29uc3QgY29uZmlndXJlZFVybCA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnVybCA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnVybCgpXG4gICAgOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnVybFxuXG4gIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VXJsKGNvbmZpZ3VyZWRVcmwpXG59XG5cbi8qKlxuICogUnVucyBjbG9uZSBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGVzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHZhbHVlIC0gQXR0cmlidXRlcyBoYXNoLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDbG9uZWQgYXR0cmlidXRlcyBoYXNoLlxuICovXG5mdW5jdGlvbiBjbG9uZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKHZhbHVlKSB7XG4gIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh2YWx1ZSkpKVxufVxuXG4vKipcbiAqIFNoYXJlZCBjaGFubmVsIG5hbWUgZm9yIG1vZGVsIGxpZmVjeWNsZSBldmVudHMgKFBoYXNlIDMpLlxuICogTWF0Y2hlcyB0aGUgYmFja2VuZCBgRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRWAuXG4gKi9cbmNvbnN0IEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUgPSBcImZyb250ZW5kLW1vZGVsc1wiXG5cbi8qKlxuICogUnVucyBtZXJnZSBmcm9udGVuZCBtb2RlbCBldmVudCBwcmVsb2FkLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IHRhcmdldCAtIFRhcmdldCBwcmVsb2FkIHBheWxvYWQuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gc291cmNlIC0gU291cmNlIHByZWxvYWQgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByZWxvYWQodGFyZ2V0LCBzb3VyY2UpIHtcbiAgZm9yIChjb25zdCBbcmVsYXRpb25zaGlwTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZSkpIHtcbiAgICBjb25zdCBleGlzdGluZ1ZhbHVlID0gdGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICBpZiAodmFsdWUgPT09IHRydWUgfHwgdmFsdWUgPT09IGZhbHNlKSB7XG4gICAgICBpZiAoZXhpc3RpbmdWYWx1ZSA9PT0gdW5kZWZpbmVkKSB0YXJnZXRbcmVsYXRpb25zaGlwTmFtZV0gPSB2YWx1ZVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdID0gdmFsdWVcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCFleGlzdGluZ1ZhbHVlIHx8IHR5cGVvZiBleGlzdGluZ1ZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZXhpc3RpbmdWYWx1ZSkpIHtcbiAgICAgIHRhcmdldFtyZWxhdGlvbnNoaXBOYW1lXSA9IHt9XG4gICAgfVxuXG4gICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRQcmVsb2FkKFxuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovICh0YXJnZXRbcmVsYXRpb25zaGlwTmFtZV0pLFxuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59ICovICh2YWx1ZSlcbiAgICApXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG1lcmdlIGZyb250ZW5kIG1vZGVsIGV2ZW50IHNlbGVjdC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSB0YXJnZXQgLSBUYXJnZXQgc2VsZWN0IG1hcC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSBzb3VyY2UgLSBTb3VyY2Ugc2VsZWN0IG1hcC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFNlbGVjdCh0YXJnZXQsIHNvdXJjZSkge1xuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIGF0dHJpYnV0ZXNdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZSkpIHtcbiAgICBjb25zdCBleGlzdGluZ0F0dHJpYnV0ZXMgPSB0YXJnZXRbbW9kZWxOYW1lXSB8fCBbXVxuXG4gICAgdGFyZ2V0W21vZGVsTmFtZV0gPSBBcnJheS5mcm9tKG5ldyBTZXQoZXhpc3RpbmdBdHRyaWJ1dGVzLmNvbmNhdChhdHRyaWJ1dGVzKSkpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG1lcmdlIHVuaXF1ZSBmcm9udGVuZCBtb2RlbCBldmVudCBlbnRyaWVzLlxuICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxXaXRoQ291bnRQYXlsb2FkRW50cnkgfCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxBYmlsaXRpZXNQYXlsb2FkRW50cnk+fSB0YXJnZXQgLSBUYXJnZXQgYXJyYXkuXG4gKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFdpdGhDb3VudFBheWxvYWRFbnRyeSB8IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEFiaWxpdGllc1BheWxvYWRFbnRyeT59IHNvdXJjZSAtIFNvdXJjZSBhcnJheS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBtZXJnZVVuaXF1ZUZyb250ZW5kTW9kZWxFdmVudEVudHJpZXModGFyZ2V0LCBzb3VyY2UpIHtcbiAgY29uc3QgZXhpc3RpbmdLZXlzID0gbmV3IFNldCh0YXJnZXQubWFwKChlbnRyeSkgPT4gSlNPTi5zdHJpbmdpZnkoZW50cnkpKSlcblxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIHNvdXJjZSkge1xuICAgIGNvbnN0IGtleSA9IEpTT04uc3RyaW5naWZ5KGVudHJ5KVxuXG4gICAgaWYgKGV4aXN0aW5nS2V5cy5oYXMoa2V5KSkgY29udGludWVcblxuICAgIHRhcmdldC5wdXNoKGVudHJ5KVxuICAgIGV4aXN0aW5nS2V5cy5hZGQoa2V5KVxuICB9XG59XG5cbi8qKlxuICogUnVucyBtZXJnZSBmcm9udGVuZCBtb2RlbCBldmVudCBwcm9qZWN0aW9uIHBheWxvYWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfSB0YXJnZXQgLSBUYXJnZXQgcGF5bG9hZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9IHNvdXJjZSAtIFNvdXJjZSBwYXlsb2FkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50UHJvamVjdGlvblBheWxvYWQodGFyZ2V0LCBzb3VyY2UpIHtcbiAgaWYgKHNvdXJjZS5wcmVsb2FkKSB7XG4gICAgaWYgKCF0YXJnZXQucHJlbG9hZCkgdGFyZ2V0LnByZWxvYWQgPSB7fVxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50UHJlbG9hZCh0YXJnZXQucHJlbG9hZCwgc291cmNlLnByZWxvYWQpXG4gIH1cblxuICBpZiAoc291cmNlLnNlbGVjdCkge1xuICAgIGlmICghdGFyZ2V0LnNlbGVjdCkgdGFyZ2V0LnNlbGVjdCA9IHt9XG4gICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRTZWxlY3QodGFyZ2V0LnNlbGVjdCwgc291cmNlLnNlbGVjdClcbiAgfVxuXG4gIGlmIChzb3VyY2Uuc2VsZWN0c0V4dHJhKSB7XG4gICAgaWYgKCF0YXJnZXQuc2VsZWN0c0V4dHJhKSB0YXJnZXQuc2VsZWN0c0V4dHJhID0ge31cbiAgICBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFNlbGVjdCh0YXJnZXQuc2VsZWN0c0V4dHJhLCBzb3VyY2Uuc2VsZWN0c0V4dHJhKVxuICB9XG5cbiAgaWYgKHNvdXJjZS53aXRoQ291bnQpIHtcbiAgICBpZiAoIXRhcmdldC53aXRoQ291bnQpIHRhcmdldC53aXRoQ291bnQgPSBbXVxuICAgIG1lcmdlVW5pcXVlRnJvbnRlbmRNb2RlbEV2ZW50RW50cmllcyh0YXJnZXQud2l0aENvdW50LCBzb3VyY2Uud2l0aENvdW50KVxuICB9XG5cbiAgaWYgKHNvdXJjZS5hYmlsaXRpZXMpIHtcbiAgICBpZiAoIXRhcmdldC5hYmlsaXRpZXMpIHRhcmdldC5hYmlsaXRpZXMgPSBbXVxuICAgIG1lcmdlVW5pcXVlRnJvbnRlbmRNb2RlbEV2ZW50RW50cmllcyh0YXJnZXQuYWJpbGl0aWVzLCBzb3VyY2UuYWJpbGl0aWVzKVxuICB9XG5cbiAgaWYgKHNvdXJjZS5xdWVyeURhdGEgIT09IHVuZGVmaW5lZCkge1xuICAgIGNvbnN0IHRhcmdldFF1ZXJ5RGF0YSA9IEFycmF5LmlzQXJyYXkodGFyZ2V0LnF1ZXJ5RGF0YSkgPyB0YXJnZXQucXVlcnlEYXRhIDogW11cblxuICAgIHRhcmdldC5xdWVyeURhdGEgPSB0YXJnZXRRdWVyeURhdGFcbiAgICBjb25zdCBxdWVyeURhdGFFbnRyaWVzID0gQXJyYXkuaXNBcnJheShzb3VyY2UucXVlcnlEYXRhKSA/IHNvdXJjZS5xdWVyeURhdGEgOiBbc291cmNlLnF1ZXJ5RGF0YV1cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcXVlcnlEYXRhRW50cmllcykge1xuICAgICAgdGFyZ2V0UXVlcnlEYXRhLnB1c2goZW50cnkpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBtYXRjaGVkIGV2ZW50IGZpbHRlciBrZXlzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keSAtIFJhdyB3ZWJzb2NrZXQgZXZlbnQgYm9keS5cbiAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBNYXRjaGVkIGV2ZW50IGZpbHRlciBrZXlzIGRlbGl2ZXJlZCBieSB0aGUgYmFja2VuZC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbE1hdGNoZWRFdmVudEZpbHRlcktleXMoYm9keSkge1xuICBpZiAoIWJvZHkgfHwgdHlwZW9mIGJvZHkgIT09IFwib2JqZWN0XCIpIHJldHVybiBuZXcgU2V0KClcblxuICBjb25zdCBrZXlzID0gLyoqIEB0eXBlIHt7bWF0Y2hlZEV2ZW50RmlsdGVyS2V5cz86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gKi8gKGJvZHkpLm1hdGNoZWRFdmVudEZpbHRlcktleXNcblxuICBpZiAoIUFycmF5LmlzQXJyYXkoa2V5cykpIHJldHVybiBuZXcgU2V0KClcblxuICByZXR1cm4gbmV3IFNldChrZXlzLm1hcCgoa2V5KSA9PiBTdHJpbmcoa2V5KSkpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBldmVudCBlbnRyeSBtYXRjaGVzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnl9IGVudHJ5IC0gQ2FsbGJhY2sgZW50cnkuXG4gKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzIC0gQmFja2VuZCBtYXRjaGVkIGZpbHRlciBrZXlzLlxuICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIGNhbGxiYWNrIHNob3VsZCByZWNlaXZlIHRoZSBldmVudC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEV2ZW50RW50cnlNYXRjaGVzKGVudHJ5LCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKSB7XG4gIGlmICghZW50cnkuZXZlbnRGaWx0ZXJLZXkpIHJldHVybiB0cnVlXG5cbiAgcmV0dXJuIG1hdGNoZWRFdmVudEZpbHRlcktleXMuaGFzKGVudHJ5LmV2ZW50RmlsdGVyS2V5KVxufVxuXG4vKipcbiAqIFJ1bnMgYXNzZXJ0IG5vIGRlc3Ryb3kgZXZlbnQgZmlsdGVyLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBFdmVudCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBvcHRpb25zIC0gRXZlbnQgb3B0aW9ucy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnROb0Rlc3Ryb3lFdmVudEZpbHRlcihNb2RlbENsYXNzLCBvcHRpb25zKSB7XG4gIGNvbnN0IGV2ZW50T3B0aW9uc1BheWxvYWQgPSBmcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZChNb2RlbENsYXNzLCBvcHRpb25zKVxuXG4gIGlmICghZXZlbnRPcHRpb25zUGF5bG9hZC5ldmVudEZpbHRlcktleSkgcmV0dXJuXG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgZGVzdHJveSBldmVudCBzdWJzY3JpcHRpb25zIGRvIG5vdCBzdXBwb3J0IHF1ZXJ5IGZpbHRlcnNcIilcbn1cblxuLyoqXG4gKiBQZXItbW9kZWwgY2xhc3Mgc2luZ2xldG9uIHRoYXQgbXVsdGlwbGV4ZXMgYWxsIHJlZ2lzdGVyZWQgb25DcmVhdGUgL1xuICogb25VcGRhdGUgLyBvbkRlc3Ryb3kgY2FsbGJhY2tzIOKAlCBjbGFzcy1sZXZlbCArIGluc3RhbmNlLWxldmVsIOKAlFxuICogb3ZlciBvbmUgV2Vic29ja2V0Q2hhbm5lbFYyIHN1YnNjcmlwdGlvbi4gU3Vic2NyaXB0aW9uIG9wZW5zIG9uIHRoZVxuICogZmlyc3QgbGlzdGVuZXIgYW5kIGNsb3NlcyB3aGVuIHRoZSBsYXN0IG9uZSB1bnN1YnNjcmliZXMuXG4gKlxuICogSW5zdGFuY2UtbGV2ZWwgbGlzdGVuZXJzIGFsc28gcmVjZWl2ZSBhdXRvLW1lcmdlOiB3aGVuIGFuIGB1cGRhdGVgXG4gKiBldmVudCBhcnJpdmVzIGZvciBhIHJlZ2lzdGVyZWQgaW5zdGFuY2UgaWQsIHRoZSBpbnN0YW5jZSdzXG4gKiBhdHRyaWJ1dGVzIGFyZSB1cGRhdGVkIGluIHBsYWNlIGJlZm9yZSB0aGUgY2FsbGJhY2sgZmlyZXMsIHNvXG4gKiBjYWxsZXJzIGNhbiByZWFkIGZyZXNoIHZhbHVlcyBmcm9tIHRoZSBzYW1lIGluc3RhbmNlIGhhbmRsZS5cbiAqL1xuY2xhc3MgRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MgZm9yIHRoaXMgc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0fSByZXF1ZXN0Q29udGV4dCAtIENhcHR1cmVkIHN1YnNjcmlwdGlvbiBjb250ZXh0LlxuICAgKi9cbiAgY29uc3RydWN0b3IoTW9kZWxDbGFzcywgcmVxdWVzdENvbnRleHQpIHtcbiAgICB0aGlzLk1vZGVsQ2xhc3MgPSBNb2RlbENsYXNzXG4gICAgdGhpcy5yZXF1ZXN0Q29udGV4dCA9IHJlcXVlc3RDb250ZXh0XG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtTZXQ8RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5Pn0gKi9cbiAgICB0aGlzLmNsYXNzQ3JlYXRlQ2FsbGJhY2tzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtTZXQ8RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5Pn0gKi9cbiAgICB0aGlzLmNsYXNzVXBkYXRlQ2FsbGJhY2tzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtTZXQ8RnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnk+fSAqL1xuICAgIHRoaXMuY2xhc3NEZXN0cm95Q2FsbGJhY2tzID0gbmV3IFNldCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCB7aW5zdGFuY2U6IEZyb250ZW5kTW9kZWxCYXNlLCB1cGRhdGVDYWxsYmFja3M6IFNldDxGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnk+LCBkZXN0cm95Q2FsbGJhY2tzOiBTZXQ8RnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnk+fT59ICovXG4gICAgdGhpcy5pbnN0YW5jZUxpc3RlbmVycyA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgdGhpcy5jaGFubmVsSGFuZGxlID0gbnVsbFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5yZWFkeVByb21pc2UgPSBudWxsXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtzdHJpbmcgfCBudWxsfSAqL1xuICAgIHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zS2V5ID0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Vic2NyaXB0aW9uIHBhcmFtcy5cbiAgICogQHJldHVybnMge3ttb2RlbDogc3RyaW5nLCBkZXN0cm95RXZlbnREZWxpdmVyeT86IGJvb2xlYW4sIGV2ZW50RmlsdGVycz86IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZEVudHJ5W10sIHVuZmlsdGVyZWRFdmVudERlbGl2ZXJ5PzogYm9vbGVhbn0gJiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH0gLSBDdXJyZW50IHdlYnNvY2tldCBzdWJzY3JpcHRpb24gcGFyYW1zLlxuICAgKi9cbiAgc3Vic2NyaXB0aW9uUGFyYW1zKCkge1xuICAgIC8qKlxuICAgICAqIFByb2plY3Rpb24gcGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9ICovXG4gICAgY29uc3QgcHJvamVjdGlvblBheWxvYWQgPSB7fVxuICAgIC8qKlxuICAgICAqIEV2ZW50IGZpbHRlcnMgYnkga2V5LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudEZpbHRlclBheWxvYWRFbnRyeT59ICovXG4gICAgY29uc3QgZXZlbnRGaWx0ZXJzQnlLZXkgPSB7fVxuICAgIGNvbnN0IHByb2plY3Rpb25FbnRyaWVzID0gW11cbiAgICBsZXQgaGFzRGVzdHJveUV2ZW50RGVsaXZlcnkgPSB0aGlzLmNsYXNzRGVzdHJveUNhbGxiYWNrcy5zaXplID4gMFxuICAgIGxldCBoYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHRoaXMuY2xhc3NDcmVhdGVDYWxsYmFja3MpIHByb2plY3Rpb25FbnRyaWVzLnB1c2goZW50cnkpXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLmNsYXNzVXBkYXRlQ2FsbGJhY2tzKSBwcm9qZWN0aW9uRW50cmllcy5wdXNoKGVudHJ5KVxuXG4gICAgZm9yIChjb25zdCBsaXN0ZW5lciBvZiB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLnZhbHVlcygpKSB7XG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcykgcHJvamVjdGlvbkVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgIGlmIChsaXN0ZW5lci5kZXN0cm95Q2FsbGJhY2tzLnNpemUgPiAwKSBoYXNEZXN0cm95RXZlbnREZWxpdmVyeSA9IHRydWVcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHByb2plY3Rpb25FbnRyaWVzKSB7XG4gICAgICBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByb2plY3Rpb25QYXlsb2FkKHByb2plY3Rpb25QYXlsb2FkLCBlbnRyeS5wcm9qZWN0aW9uUGF5bG9hZClcblxuICAgICAgaWYgKGVudHJ5LmV2ZW50RmlsdGVyS2V5ICYmIGVudHJ5LmV2ZW50RmlsdGVyUGF5bG9hZCkge1xuICAgICAgICBldmVudEZpbHRlcnNCeUtleVtlbnRyeS5ldmVudEZpbHRlcktleV0gPSB7XG4gICAgICAgICAgLi4uZW50cnkuZXZlbnRGaWx0ZXJQYXlsb2FkLFxuICAgICAgICAgIGtleTogZW50cnkuZXZlbnRGaWx0ZXJLZXlcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPSB0cnVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgZXZlbnRGaWx0ZXJzID0gT2JqZWN0LnZhbHVlcyhldmVudEZpbHRlcnNCeUtleSlcbiAgICBjb25zdCBldmVudEZpbHRlclBhcmFtcyA9IGV2ZW50RmlsdGVycy5sZW5ndGggPiAwXG4gICAgICA/IHtcbiAgICAgICAgICBldmVudEZpbHRlcnMsXG4gICAgICAgICAgLi4uKGhhc0Rlc3Ryb3lFdmVudERlbGl2ZXJ5ID8ge2Rlc3Ryb3lFdmVudERlbGl2ZXJ5OiB0cnVlfSA6IHt9KSxcbiAgICAgICAgICAuLi4oaGFzVW5maWx0ZXJlZEV2ZW50RGVsaXZlcnkgPyB7dW5maWx0ZXJlZEV2ZW50RGVsaXZlcnk6IHRydWV9IDoge30pXG4gICAgICAgIH1cbiAgICAgIDoge31cblxuICAgIHJldHVybiBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChcbiAgICAgIHRoaXMucmVxdWVzdENvbnRleHQsXG4gICAgICB7XG4gICAgICAgIG1vZGVsOiB0aGlzLk1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgIC4uLmV2ZW50RmlsdGVyUGFyYW1zLFxuICAgICAgICAuLi5wcm9qZWN0aW9uUGF5bG9hZFxuICAgICAgfVxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1YnNjcmlwdGlvbiBwYXJhbXMganNvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTdGFibGUga2V5IGZvciBjdXJyZW50IHN1YnNjcmlwdGlvbiBwYXJhbXMuXG4gICAqL1xuICBzdWJzY3JpcHRpb25QYXJhbXNKc29uKCkge1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh0aGlzLnN1YnNjcmlwdGlvblBhcmFtcygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXIgY2xhc3MgY2FsbGJhY2suXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5IHwgRnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnl9IFRcbiAgICogQHBhcmFtIHtTZXQ8VD59IGNhbGxiYWNrcyAtIENhbGxiYWNrIHNldCBmb3IgdGhlIGV2ZW50IHR5cGUuXG4gICAqIEBwYXJhbSB7VH0gZW50cnkgLSBDYWxsYmFjayBlbnRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBhc3luYyByZWdpc3RlckNsYXNzQ2FsbGJhY2soY2FsbGJhY2tzLCBlbnRyeSkge1xuICAgIGNhbGxiYWNrcy5hZGQoZW50cnkpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5lbnN1cmVTdWJzY3JpYmVkKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY2FsbGJhY2tzLmRlbGV0ZShlbnRyeSlcbiAgICAgIHRoaXMubWF5YmVUZWFyZG93bigpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBjYWxsYmFja3MuZGVsZXRlKGVudHJ5KVxuICAgICAgdGhpcy5tYXliZVRlYXJkb3duKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgc3Vic2NyaWJlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59ICovXG4gIGFzeW5jIGVuc3VyZVN1YnNjcmliZWQoKSB7XG4gICAgY29uc3QgcGFyYW1zSnNvbiA9IHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zSnNvbigpXG5cbiAgICBpZiAodGhpcy5jaGFubmVsSGFuZGxlICYmICF0aGlzLmNoYW5uZWxIYW5kbGUuaXNDbG9zZWQoKSkge1xuICAgICAgaWYgKHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zS2V5ICE9PSBwYXJhbXNKc29uKSB7XG4gICAgICAgIHRoaXMuY2hhbm5lbEhhbmRsZS5jbG9zZSgpXG4gICAgICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IG51bGxcbiAgICAgICAgdGhpcy5yZWFkeVByb21pc2UgPSBudWxsXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAodGhpcy5yZWFkeVByb21pc2UpIGF3YWl0IHRoaXMucmVhZHlQcm9taXNlXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFNlcmlhbGl6ZSBwYXJhbGxlbCBjYWxscyAoZS5nLiBQcm9taXNlLmFsbChbb25DcmVhdGUsIG9uVXBkYXRlLFxuICAgIC8vIG9uRGVzdHJveV0pKSBzbyB3ZSBvcGVuIGV4YWN0bHkgb25lIHN1YnNjcmlwdGlvbiBwZXIgbW9kZWwgY2xhc3NcbiAgICAvLyBpbnN0ZWFkIG9mIHJhY2luZyB0aHJlZSBjb25jdXJyZW50IHN1YnNjcmliZUNoYW5uZWwgY2FsbHMuXG4gICAgaWYgKHRoaXMucmVhZHlQcm9taXNlKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlYWR5UHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50IHx8IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpKVxuXG4gICAgaWYgKCFjbGllbnQgfHwgdHlwZW9mIGNsaWVudC5zdWJzY3JpYmVDaGFubmVsICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIGV2ZW50IHN1YnNjcmlwdGlvbnMgcmVxdWlyZSBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldFVybH0pIG9yIGNvbmZpZ3VyZVRyYW5zcG9ydCh7d2Vic29ja2V0Q2xpZW50fSlcIilcbiAgICB9XG5cbiAgICB0aGlzLnJlYWR5UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICBpZiAodHlwZW9mIGNsaWVudC5jb25uZWN0ID09PSBcImZ1bmN0aW9uXCIpIGF3YWl0IGNsaWVudC5jb25uZWN0KClcblxuICAgICAgY29uc3QgcGFyYW1zID0gdGhpcy5zdWJzY3JpcHRpb25QYXJhbXMoKVxuXG4gICAgICB0aGlzLnN1YnNjcmlwdGlvblBhcmFtc0tleSA9IEpTT04uc3RyaW5naWZ5KHBhcmFtcylcbiAgICAgIHRoaXMuY2hhbm5lbEhhbmRsZSA9IGNsaWVudC5zdWJzY3JpYmVDaGFubmVsKEZST05URU5EX01PREVMU19DSEFOTkVMX05BTUUsIHtcbiAgICAgICAgcGFyYW1zLFxuICAgICAgICBvbk1lc3NhZ2U6ICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBib2R5KSA9PiB0aGlzLl9kaXNwYXRjaEV2ZW50KGJvZHkpLFxuICAgICAgICBvbkNsb3NlOiAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jaGFubmVsSGFuZGxlID0gbnVsbFxuICAgICAgICAgIHRoaXMucmVhZHlQcm9taXNlID0gbnVsbFxuICAgICAgICAgIHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zS2V5ID0gbnVsbFxuICAgICAgICAgIHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMuY2xlYXIoKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgYXdhaXQgdGhpcy5jaGFubmVsSGFuZGxlLnJlYWR5XG4gICAgfSkoKVxuXG4gICAgYXdhaXQgdGhpcy5yZWFkeVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRpc3BhdGNoIGV2ZW50LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5IC0gV2ViU29ja2V0IGV2ZW50IHBheWxvYWQuXG4gICAqL1xuICBfZGlzcGF0Y2hFdmVudChib2R5KSB7XG4gICAgaWYgKCFib2R5IHx8IHR5cGVvZiBib2R5ICE9PSBcIm9iamVjdFwiKSByZXR1cm5cblxuICAgIGNvbnN0IGFjdGlvbiA9IGJvZHkuYWN0aW9uXG4gICAgY29uc3QgcmF3SWQgPSBib2R5LmlkXG5cbiAgICBpZiAoYWN0aW9uICE9PSBcImNyZWF0ZVwiICYmIGFjdGlvbiAhPT0gXCJ1cGRhdGVcIiAmJiBhY3Rpb24gIT09IFwiZGVzdHJveVwiKSByZXR1cm5cbiAgICBpZiAocmF3SWQgPT09IHVuZGVmaW5lZCB8fCByYXdJZCA9PT0gbnVsbCkgcmV0dXJuXG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5Nb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IGlkZW50aXR5ID0gQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KVxuICAgICAgPyBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIHJhd0lkKVxuICAgICAgOiBTdHJpbmcocmF3SWQpXG4gICAgY29uc3QgaWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBpZGVudGl0eSlcbiAgICBjb25zdCByYXdQcmV2aW91c0lkID0gYm9keS5wcmV2aW91c0lkXG4gICAgY29uc3QgcHJldmlvdXNJZGVudGl0eSA9IHJhd1ByZXZpb3VzSWQgPT09IHVuZGVmaW5lZCB8fCByYXdQcmV2aW91c0lkID09PSBudWxsXG4gICAgICA/IG51bGxcbiAgICAgIDogQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KVxuICAgICAgICA/IG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMocHJpbWFyeUtleSwgcmF3UHJldmlvdXNJZClcbiAgICAgICAgOiBTdHJpbmcocmF3UHJldmlvdXNJZClcbiAgICBjb25zdCBwcmV2aW91c0lkID0gcHJldmlvdXNJZGVudGl0eSA9PT0gbnVsbFxuICAgICAgPyBudWxsXG4gICAgICA6IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHByZXZpb3VzSWRlbnRpdHkpXG4gICAgY29uc3QgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyA9IGZyb250ZW5kTW9kZWxNYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKGJvZHkpXG5cbiAgICBpZiAoYWN0aW9uID09PSBcImRlc3Ryb3lcIikge1xuICAgICAgY29uc3QgbGlzdGVuZXIgPSB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLmdldChpZClcblxuICAgICAgaWYgKGxpc3RlbmVyKSB7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcykge1xuICAgICAgICAgIHRyeSB7IGVudHJ5LmNhbGxiYWNrKHtpZDogaWRlbnRpdHl9KSB9IGNhdGNoIChlcnJvcikgeyBjb25zb2xlLmVycm9yKGVycm9yKSB9XG4gICAgICAgIH1cbiAgICAgICAgZGVsZXRlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIodGhpcywgbGlzdGVuZXIpXG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHRoaXMuY2xhc3NEZXN0cm95Q2FsbGJhY2tzKSB7XG4gICAgICAgIHRyeSB7IGVudHJ5LmNhbGxiYWNrKHtpZDogaWRlbnRpdHl9KSB9IGNhdGNoIChlcnJvcikgeyBjb25zb2xlLmVycm9yKGVycm9yKSB9XG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoIWJvZHkucmVjb3JkIHx8IHR5cGVvZiBib2R5LnJlY29yZCAhPT0gXCJvYmplY3RcIikgcmV0dXJuXG5cbiAgICBjb25zdCBkZXNlcmlhbGl6ZWRSZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGJvZHkucmVjb3JkKSlcbiAgICBjb25zdCBmcmVzaE1vZGVsID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMuTW9kZWxDbGFzcykuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UoZGVzZXJpYWxpemVkUmVjb3JkKVxuICAgIGNvbnN0IGxpc3RlbmVyID0gdGhpcy5pbnN0YW5jZUxpc3RlbmVycy5nZXQoaWQpIHx8IChwcmV2aW91c0lkID09PSBudWxsID8gdW5kZWZpbmVkIDogdGhpcy5pbnN0YW5jZUxpc3RlbmVycy5nZXQocHJldmlvdXNJZCkpXG5cbiAgICBpZiAoYWN0aW9uID09PSBcInVwZGF0ZVwiICYmIGxpc3RlbmVyKSB7XG4gICAgICBjb25zdCBtYXRjaGluZ1VwZGF0ZUNhbGxiYWNrcyA9IEFycmF5LmZyb20obGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzKS5maWx0ZXIoKGVudHJ5KSA9PlxuICAgICAgICBmcm9udGVuZE1vZGVsRXZlbnRFbnRyeU1hdGNoZXMoZW50cnksIG1hdGNoZWRFdmVudEZpbHRlcktleXMpXG4gICAgICApXG5cbiAgICAgIGlmIChwcmV2aW91c0lkZW50aXR5ICE9PSBudWxsKSB7XG4gICAgICAgIHJla2V5RnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKHRoaXMuTW9kZWxDbGFzcywgbGlzdGVuZXIuaW5zdGFuY2UsIHByZXZpb3VzSWRlbnRpdHksIGlkZW50aXR5KVxuICAgICAgfVxuXG4gICAgICBpZiAobWF0Y2hpbmdVcGRhdGVDYWxsYmFja3MubGVuZ3RoID4gMCkge1xuICAgICAgICAvLyBBdXRvLW1lcmdlIGludG8gdGhlIHJlZ2lzdGVyZWQgaW5zdGFuY2Ugc28gY2FsbGVycyByZWFkaW5nXG4gICAgICAgIC8vIHRocm91Z2ggdGhlIHNhbWUgaGFuZGxlIHNlZSBmcmVzaCBhdHRyaWJ1dGVzLlxuICAgICAgICBjb25zdCBpbnN0YW5jZUFueSA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChsaXN0ZW5lci5pbnN0YW5jZSlcblxuICAgICAgICBpbnN0YW5jZUFueS5hc3NpZ25BdHRyaWJ1dGVzKGZyZXNoTW9kZWwuYXR0cmlidXRlcygpKVxuICAgICAgICBpbnN0YW5jZUFueS5fYXR0YWNobWVudE93bmVyID0gZnJlc2hNb2RlbC5fYXR0YWNobWVudE93bmVyXG4gICAgICAgIGluc3RhbmNlQW55Ll9wZXJzaXN0ZWRBdHRyaWJ1dGVzID0gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhsaXN0ZW5lci5pbnN0YW5jZS5hdHRyaWJ1dGVzKCkpXG5cbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBtYXRjaGluZ1VwZGF0ZUNhbGxiYWNrcykge1xuICAgICAgICAgIHRyeSB7IGVudHJ5LmNhbGxiYWNrKHtpZDogaWRlbnRpdHksIG1vZGVsOiBsaXN0ZW5lci5pbnN0YW5jZX0pIH0gY2F0Y2ggKGVycm9yKSB7IGNvbnNvbGUuZXJyb3IoZXJyb3IpIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGNsYXNzQ2FsbGJhY2tzID0gYWN0aW9uID09PSBcImNyZWF0ZVwiID8gdGhpcy5jbGFzc0NyZWF0ZUNhbGxiYWNrcyA6IHRoaXMuY2xhc3NVcGRhdGVDYWxsYmFja3NcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgY2xhc3NDYWxsYmFja3MpIHtcbiAgICAgIGlmICghZnJvbnRlbmRNb2RlbEV2ZW50RW50cnlNYXRjaGVzKGVudHJ5LCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKSkgY29udGludWVcblxuICAgICAgdHJ5IHsgZW50cnkuY2FsbGJhY2soe2lkOiBpZGVudGl0eSwgbW9kZWw6IGZyZXNoTW9kZWx9KSB9IGNhdGNoIChlcnJvcikgeyBjb25zb2xlLmVycm9yKGVycm9yKSB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWF5YmUgdGVhcmRvd24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAqL1xuICBtYXliZVRlYXJkb3duKCkge1xuICAgIGNvbnN0IGhhc0FueUxpc3RlbmVyID0gdGhpcy5jbGFzc0NyZWF0ZUNhbGxiYWNrcy5zaXplID4gMFxuICAgICAgfHwgdGhpcy5jbGFzc1VwZGF0ZUNhbGxiYWNrcy5zaXplID4gMFxuICAgICAgfHwgdGhpcy5jbGFzc0Rlc3Ryb3lDYWxsYmFja3Muc2l6ZSA+IDBcbiAgICAgIHx8IHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMuc2l6ZSA+IDBcblxuICAgIGlmIChoYXNBbnlMaXN0ZW5lcikgcmV0dXJuXG5cbiAgICBpZiAodGhpcy5jaGFubmVsSGFuZGxlKSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmNoYW5uZWxIYW5kbGUuY2xvc2UoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmNoYW5uZWxIYW5kbGUgPSBudWxsXG4gICAgdGhpcy5yZWFkeVByb21pc2UgPSBudWxsXG4gICAgdGhpcy5zdWJzY3JpcHRpb25QYXJhbXNLZXkgPSBudWxsXG4gICAgcmVsZWFzZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbih0aGlzKVxuICB9XG59XG5cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgZXZlbnQgc3Vic2NyaXB0aW9ucy5cbiAqIEB0eXBlIHtXZWFrTWFwPEZyb250ZW5kTW9kZWxDbGFzcywgTWFwPHN0cmluZywgRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uPj59ICovXG5jb25zdCBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zID0gbmV3IFdlYWtNYXAoKVxuXG4vKipcbiAqIFJ1bnMgZW5zdXJlIGZyb250ZW5kIG1vZGVsIGV2ZW50IHN1YnNjcmlwdGlvbi5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHR9IHJlcXVlc3RDb250ZXh0IC0gQ2FwdHVyZWQgc3Vic2NyaXB0aW9uIGNvbnRleHQuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufSAtIFBlci1jbGFzcyBzdWJzY3JpcHRpb24gaGVscGVyLlxuICovXG5mdW5jdGlvbiBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oTW9kZWxDbGFzcywgcmVxdWVzdENvbnRleHQpIHtcbiAgbGV0IHN1YnNjcmlwdGlvbnMgPSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmdldChNb2RlbENsYXNzKVxuXG4gIGlmICghc3Vic2NyaXB0aW9ucykge1xuICAgIHN1YnNjcmlwdGlvbnMgPSBuZXcgTWFwKClcbiAgICBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLnNldChNb2RlbENsYXNzLCBzdWJzY3JpcHRpb25zKVxuICB9XG5cbiAgY29uc3QgY29udGV4dEtleSA9IHJlbW90ZVJlcXVlc3RDb250ZXh0S2V5KHJlcXVlc3RDb250ZXh0KVxuICBsZXQgc3ViID0gc3Vic2NyaXB0aW9ucy5nZXQoY29udGV4dEtleSlcblxuICBpZiAoIXN1Yikge1xuICAgIHN1YiA9IG5ldyBGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oTW9kZWxDbGFzcywgcmVxdWVzdENvbnRleHQpXG4gICAgc3Vic2NyaXB0aW9ucy5zZXQoY29udGV4dEtleSwgc3ViKVxuICB9XG5cbiAgcmV0dXJuIHN1YlxufVxuXG4vKipcbiAqIFJlbW92ZXMgYW4gZW1wdHkgY29udGV4dCBidWNrZXQgc28gc3dpdGNoaW5nIHRocm91Z2ggbWFueSB0ZW5hbnRzIGRvZXMgbm90IHJldGFpbiBldmVyeSBzbmFwc2hvdC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufSBzdWJzY3JpcHRpb24gLSBFbXB0eSBzdWJzY3JpcHRpb24gYnVja2V0LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJlbGVhc2VGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oc3Vic2NyaXB0aW9uKSB7XG4gIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmdldChzdWJzY3JpcHRpb24uTW9kZWxDbGFzcylcbiAgY29uc3QgY29udGV4dEtleSA9IHJlbW90ZVJlcXVlc3RDb250ZXh0S2V5KHN1YnNjcmlwdGlvbi5yZXF1ZXN0Q29udGV4dClcblxuICBpZiAoc3Vic2NyaXB0aW9ucz8uZ2V0KGNvbnRleHRLZXkpICE9PSBzdWJzY3JpcHRpb24pIHJldHVyblxuXG4gIHN1YnNjcmlwdGlvbnMuZGVsZXRlKGNvbnRleHRLZXkpXG4gIGlmIChzdWJzY3JpcHRpb25zLnNpemUgPT09IDApIGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMuZGVsZXRlKHN1YnNjcmlwdGlvbi5Nb2RlbENsYXNzKVxufVxuXG4vKipcbiAqIENhcHR1cmVzIHRoZSBjdXJyZW50IGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCBjb250ZXh0IGZvciBvbmUgb3BlcmF0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHR9IEZyb3plbiBjb250ZXh0IHNuYXBzaG90LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRDb250ZXh0ID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdENvbnRleHQgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0Q29udGV4dCgpXG4gICAgOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RDb250ZXh0XG5cbiAgcmV0dXJuIGNhcHR1cmVGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQoY29uZmlndXJlZENvbnRleHQpXG59XG5cbi8qKlxuICogQ2FwdHVyZXMgdGhlIGV4cGxpY2l0IGxpZmVjeWNsZSBjb250ZXh0IG9yIGZhbGxzIGJhY2sgdG8gdGhlIGNvbmZpZ3VyZWQgdHJhbnNwb3J0IGNvbnRleHQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQgfCB1bmRlZmluZWR9IHJlcXVlc3RDb250ZXh0IC0gUmVnaXN0cmF0aW9uLWxvY2FsIGNvbnRleHQuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dH0gRnJvemVuIGNvbnRleHQgc25hcHNob3QuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSB7XG4gIGlmIChyZXF1ZXN0Q29udGV4dCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KClcblxuICByZXR1cm4gY2FwdHVyZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dClcbn1cblxuLyoqXG4gKiBSdW5zIGVuc3VyZSBmcm9udGVuZCBtb2RlbCBpbnN0YW5jZSBsaXN0ZW5lci5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufSBzdWIgLSBFdmVudCBzdWJzY3JpcHRpb24gYnVja2V0LlxuICogQHBhcmFtIHtzdHJpbmd9IGlkIC0gTW9kZWwgaWQuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBpbnN0YW5jZSAtIExpc3RlbmVyIGluc3RhbmNlLlxuICogQHJldHVybnMge3tpbnN0YW5jZTogRnJvbnRlbmRNb2RlbEJhc2UsIHVwZGF0ZUNhbGxiYWNrczogU2V0PEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeT4sIGRlc3Ryb3lDYWxsYmFja3M6IFNldDxGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50Q2FsbGJhY2tFbnRyeT59fSAtIEluc3RhbmNlIGxpc3RlbmVyIGJ1Y2tldC5cbiAqL1xuZnVuY3Rpb24gZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIoc3ViLCBpZCwgaW5zdGFuY2UpIHtcbiAgbGV0IGxpc3RlbmVyID0gc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChpZClcblxuICBpZiAoIWxpc3RlbmVyKSB7XG4gICAgbGlzdGVuZXIgPSB7aW5zdGFuY2UsIHVwZGF0ZUNhbGxiYWNrczogbmV3IFNldCgpLCBkZXN0cm95Q2FsbGJhY2tzOiBuZXcgU2V0KCl9XG4gICAgc3ViLmluc3RhbmNlTGlzdGVuZXJzLnNldChpZCwgbGlzdGVuZXIpXG4gIH0gZWxzZSB7XG4gICAgbGlzdGVuZXIuaW5zdGFuY2UgPSBpbnN0YW5jZVxuICB9XG5cbiAgcmV0dXJuIGxpc3RlbmVyXG59XG5cbi8qKlxuICogUmVtb3ZlcyBldmVyeSBpZGVudGl0eSBrZXkgcG9pbnRpbmcgYXQgYW4gaW5zdGFuY2UgbGlzdGVuZXIuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gc3ViIC0gRXZlbnQgc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXI+fSBsaXN0ZW5lciAtIEluc3RhbmNlIGxpc3RlbmVyIGJ1Y2tldC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBkZWxldGVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGxpc3RlbmVyKSB7XG4gIGZvciAoY29uc3QgW2lkLCBjdXJyZW50XSBvZiBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMpIHtcbiAgICBpZiAoY3VycmVudCA9PT0gbGlzdGVuZXIpIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5kZWxldGUoaWQpXG4gIH1cbn1cblxuLyoqXG4gKiBSZW1vdmVzIG9uZSBpbnN0YW5jZSBjYWxsYmFjayBlbnRyeSBhbmQgdGVhcnMgZG93biBhbiBlbXB0eSBsaXN0ZW5lci9zdWJzY3JpcHRpb24gYnVja2V0LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb259IHN1YiAtIEV2ZW50IHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gKiBAcGFyYW0geyhsaXN0ZW5lcjogUmV0dXJuVHlwZTx0eXBlb2YgZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXI+KSA9PiBib29sZWFufSByZW1vdmVFbnRyeSAtIENhbGxiYWNrIGVudHJ5IHJlbW92YWwuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gcmVtb3ZlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJFbnRyeShzdWIsIHJlbW92ZUVudHJ5KSB7XG4gIGZvciAoY29uc3QgY3VycmVudCBvZiBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMudmFsdWVzKCkpIHtcbiAgICBpZiAoIXJlbW92ZUVudHJ5KGN1cnJlbnQpKSBjb250aW51ZVxuXG4gICAgaWYgKGN1cnJlbnQudXBkYXRlQ2FsbGJhY2tzLnNpemUgPT09IDAgJiYgY3VycmVudC5kZXN0cm95Q2FsbGJhY2tzLnNpemUgPT09IDApIHtcbiAgICAgIGRlbGV0ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyKHN1YiwgY3VycmVudClcbiAgICB9XG4gICAgYnJlYWtcbiAgfVxuXG4gIHN1Yi5tYXliZVRlYXJkb3duKClcbn1cblxuLyoqXG4gKiBUZW1wb3JhcmlseSByZWdpc3RlcnMgYW4gaW5zdGFuY2UgbGlzdGVuZXIgdW5kZXIgaXRzIHBlbmRpbmcgaWRlbnRpdHkgd2hpbGUgcmV0YWluaW5nIGl0cyBwZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gaW5zdGFuY2UgLSBJbnN0YW5jZSBiZWluZyByZS1rZXllZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IHByZXZpb3VzSWRlbnRpdHkgLSBQZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBuZXh0SWRlbnRpdHkgLSBQZW5kaW5nIGlkZW50aXR5IHNlbnQgdG8gdGhlIHNlcnZlci5cbiAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSAtIENhbGxiYWNrIHRoYXQgcmVtb3ZlcyB0aGUgdGVtcG9yYXJ5IGFsaWFzZXMuXG4gKi9cbmZ1bmN0aW9uIGFsaWFzRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKE1vZGVsQ2xhc3MsIGluc3RhbmNlLCBwcmV2aW91c0lkZW50aXR5LCBuZXh0SWRlbnRpdHkpIHtcbiAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gIGNvbnN0IHByZXZpb3VzSWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkZW50aXR5KVxuICBjb25zdCBuZXh0SWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBuZXh0SWRlbnRpdHkpXG4gIC8qKiBAdHlwZSB7QXJyYXk8e2xpc3RlbmVyOiBSZXR1cm5UeXBlPHR5cGVvZiBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcj4sIHN1YjogRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufT59ICovXG4gIGNvbnN0IGFsaWFzZXMgPSBbXVxuXG4gIGlmIChwcmV2aW91c0lkID09PSBuZXh0SWQpIHJldHVybiAoKSA9PiB7fVxuXG4gIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmdldChNb2RlbENsYXNzKVxuXG4gIGlmICghc3Vic2NyaXB0aW9ucykgcmV0dXJuICgpID0+IHt9XG5cbiAgZm9yIChjb25zdCBzdWIgb2Ygc3Vic2NyaXB0aW9ucy52YWx1ZXMoKSkge1xuICAgIGNvbnN0IGxpc3RlbmVyID0gc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChwcmV2aW91c0lkKVxuXG4gICAgaWYgKCFsaXN0ZW5lciB8fCBsaXN0ZW5lci5pbnN0YW5jZSAhPT0gaW5zdGFuY2UgfHwgc3ViLmluc3RhbmNlTGlzdGVuZXJzLmhhcyhuZXh0SWQpKSBjb250aW51ZVxuXG4gICAgc3ViLmluc3RhbmNlTGlzdGVuZXJzLnNldChuZXh0SWQsIGxpc3RlbmVyKVxuICAgIGFsaWFzZXMucHVzaCh7bGlzdGVuZXIsIHN1Yn0pXG4gIH1cblxuICByZXR1cm4gKCkgPT4ge1xuICAgIGZvciAoY29uc3Qge2xpc3RlbmVyLCBzdWJ9IG9mIGFsaWFzZXMpIHtcbiAgICAgIGlmIChzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KHByZXZpb3VzSWQpID09PSBsaXN0ZW5lciAmJiBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KG5leHRJZCkgPT09IGxpc3RlbmVyKSB7XG4gICAgICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5kZWxldGUobmV4dElkKVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIE1vdmVzIGNhbGxiYWNrcyByZWdpc3RlcmVkIG9uIGFuIGluc3RhbmNlIHRvIGl0cyBuZXdseSBwZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gaW5zdGFuY2UgLSBSZS1rZXllZCBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IHByZXZpb3VzSWRlbnRpdHkgLSBQcmV2aW91cyBwZXJzaXN0ZWQgaWRlbnRpdHkuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBuZXh0SWRlbnRpdHkgLSBOZXcgcGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJla2V5RnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKE1vZGVsQ2xhc3MsIGluc3RhbmNlLCBwcmV2aW91c0lkZW50aXR5LCBuZXh0SWRlbnRpdHkpIHtcbiAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gIGNvbnN0IHByZXZpb3VzSWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwcmV2aW91c0lkZW50aXR5KVxuICBjb25zdCBuZXh0SWQgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBuZXh0SWRlbnRpdHkpXG5cbiAgaWYgKHByZXZpb3VzSWQgPT09IG5leHRJZCkgcmV0dXJuXG5cbiAgY29uc3Qgc3Vic2NyaXB0aW9ucyA9IGZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbnMuZ2V0KE1vZGVsQ2xhc3MpXG5cbiAgaWYgKCFzdWJzY3JpcHRpb25zKSByZXR1cm5cblxuICBmb3IgKGNvbnN0IHN1YiBvZiBzdWJzY3JpcHRpb25zLnZhbHVlcygpKSB7XG4gICAgY29uc3QgbGlzdGVuZXIgPSBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KHByZXZpb3VzSWQpXG5cbiAgICBpZiAoIWxpc3RlbmVyIHx8IGxpc3RlbmVyLmluc3RhbmNlICE9PSBpbnN0YW5jZSkgY29udGludWVcblxuICAgIGNvbnN0IG5leHRMaXN0ZW5lciA9IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQobmV4dElkKVxuXG4gICAgc3ViLmluc3RhbmNlTGlzdGVuZXJzLmRlbGV0ZShwcmV2aW91c0lkKVxuXG4gICAgaWYgKG5leHRMaXN0ZW5lcikge1xuICAgICAgbmV4dExpc3RlbmVyLmluc3RhbmNlID0gaW5zdGFuY2VcbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzKSBuZXh0TGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzLmFkZChlbnRyeSlcbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcykgbmV4dExpc3RlbmVyLmRlc3Ryb3lDYWxsYmFja3MuYWRkKGVudHJ5KVxuICAgIH0gZWxzZSB7XG4gICAgICBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuc2V0KG5leHRJZCwgbGlzdGVuZXIpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBjb21tYW5kIHVybC5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZXNvdXJjZVBhdGggLSBSZXNvdXJjZSBwYXRoIHByZWZpeC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBjb21tYW5kTmFtZSAtIENvbW1hbmQgcGF0aCBzZWdtZW50LlxuICogQHJldHVybnMge3N0cmluZ30gLSBGcm9udGVuZCBtb2RlbCBBUEkgVVJMLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQ29tbWFuZFVybChyZXNvdXJjZVBhdGgsIGNvbW1hbmROYW1lKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRVcmwgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VXJsKClcbiAgY29uc3Qgbm9ybWFsaXplZFJlc291cmNlUGF0aCA9IHJlc291cmNlUGF0aC5zdGFydHNXaXRoKFwiL1wiKSA/IHJlc291cmNlUGF0aCA6IGAvJHtyZXNvdXJjZVBhdGh9YFxuXG4gIHJldHVybiBgJHtjb25maWd1cmVkVXJsfSR7bm9ybWFsaXplZFJlc291cmNlUGF0aH0vJHtjb21tYW5kTmFtZX1gXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBhcGkgdXJsLlxuICogQHJldHVybnMge3N0cmluZ30gLSBTaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJIFVSTC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEFwaVVybCgpIHtcbiAgcmV0dXJuIGAke2Zyb250ZW5kTW9kZWxUcmFuc3BvcnRVcmwoKX0ke1NIQVJFRF9GUk9OVEVORF9NT0RFTF9BUElfUEFUSH1gXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgcGF0aC5cbiAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBSZXF1ZXN0IFVSTCBvciBwYXRoLlxuICogQHJldHVybnMge3N0cmluZ30gLSBXZWJzb2NrZXQtc2FmZSByZXF1ZXN0IHBhdGguXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRQYXRoKHVybCkge1xuICBpZiAodHlwZW9mIHVybCAhPT0gXCJzdHJpbmdcIiB8fCB1cmwubGVuZ3RoIDwgMSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IFVSTC9wYXRoLCBnb3Q6ICR7dXJsfWApXG4gIH1cblxuICBpZiAodXJsLnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgcmV0dXJuIHVybFxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWRVcmwgPSBuZXcgVVJMKHVybClcblxuICAgIHJldHVybiBgJHtwYXJzZWRVcmwucGF0aG5hbWV9JHtwYXJzZWRVcmwuc2VhcmNofWBcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHVybFxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGJyb3dzZXIgcnVudGltZSB0aW1lem9uZSB3aGVuIGF2YWlsYWJsZS5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQnJvd3NlciBydW50aW1lIHRpbWV6b25lIHdoZW4gYXZhaWxhYmxlLlxuICovXG5mdW5jdGlvbiBkZWZhdWx0RnJvbnRlbmRNb2RlbFRpbWVab25lKCkge1xuICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIHVuZGVmaW5lZFxuXG4gIGNvbnN0IGludGwgPSBnbG9iYWxUaGlzLkludGxcblxuICBpZiAoIWludGwpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBJbnRsIHRvIGJlIGF2YWlsYWJsZSBmb3IgYnJvd3NlciB0aW1lem9uZSBkZXRlY3Rpb25cIilcbiAgfVxuXG4gIGlmICh0eXBlb2YgaW50bC5EYXRlVGltZUZvcm1hdCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgSW50bC5EYXRlVGltZUZvcm1hdCB0byBiZSBhdmFpbGFibGUgYXMgYSBmdW5jdGlvblwiKVxuICB9XG5cbiAgY29uc3QgdGltZVpvbmUgPSBpbnRsLkRhdGVUaW1lRm9ybWF0KCkucmVzb2x2ZWRPcHRpb25zKCkudGltZVpvbmVcblxuICBpZiAodHlwZW9mIHRpbWVab25lICE9PSBcInN0cmluZ1wiIHx8IHRpbWVab25lLnRyaW0oKS5sZW5ndGggPCAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgSW50bC5EYXRlVGltZUZvcm1hdCB0byByZXNvbHZlIGEgYnJvd3NlciB0aW1lem9uZSBzdHJpbmdcIilcbiAgfVxuXG4gIHJldHVybiB2YWxpZGF0ZVRpbWVab25lKHRpbWVab25lLCBcImJyb3dzZXIgdGltZVpvbmVcIilcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgY29uZmlndXJlZCBmcm9udGVuZC1tb2RlbCByZXF1ZXN0IHRpbWV6b25lLlxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIGZyb250ZW5kLW1vZGVsIHRpbWV6b25lLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKSB7XG4gIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcsIFwidGltZVpvbmVcIikpIHtcbiAgICByZXR1cm4gZGVmYXVsdEZyb250ZW5kTW9kZWxUaW1lWm9uZSgpXG4gIH1cblxuICBjb25zdCB0aW1lWm9uZSA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZVpvbmUoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lWm9uZVxuXG4gIGlmICh0aW1lWm9uZSA9PT0gdW5kZWZpbmVkIHx8IHRpbWVab25lID09PSBudWxsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHRpbWVab25lIGRpZCBub3QgcmVzb2x2ZSB0byBhIHRpbWV6b25lIHN0cmluZ1wiKVxuICB9XG5cbiAgcmV0dXJuIHZhbGlkYXRlVGltZVpvbmUodGltZVpvbmUsIFwiZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHRpbWVab25lXCIpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCByZXF1ZXN0IGhlYWRlcnMuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gW3RpbWVab25lXSAtIFByZS1yZXNvbHZlZCB0aW1lem9uZSBmb3IgdGhpcyByZXF1ZXN0LlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gSGVhZGVycyBmb3IgZnJvbnRlbmQtbW9kZWwgSFRUUCByZXF1ZXN0cy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlcXVlc3RIZWFkZXJzKHRpbWVab25lID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKCkpIHtcbiAgY29uc3QgZHluYW1pY0hlYWRlcnMgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0SGVhZGVycyA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0SGVhZGVycygpIHx8IHt9KVxuICAgIDogKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdEhlYWRlcnMgfHwge30pXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgY29uc3QgaGVhZGVycyA9IHtcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiwgLi4uZHluYW1pY0hlYWRlcnN9XG5cbiAgaWYgKHRpbWVab25lKSB7XG4gICAgaGVhZGVyc1tSRVFVRVNUX1RJTUVfWk9ORV9IRUFERVJdID0gdGltZVpvbmVcbiAgfVxuXG4gIHJldHVybiBoZWFkZXJzXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGNvbmZpZ3VyZWQgYm91bmRlZCB0cmFuc3BvcnQgZGVhZGxpbmUgaW4gbWlsbGlzZWNvbmRzLlxuICogQHJldHVybnMge251bWJlciB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIGRlYWRsaW5lLCBvciB1bmRlZmluZWQgd2hlbiBubyBkZWFkbGluZSBpcyBzZXQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lb3V0TXMoKSB7XG4gIGNvbnN0IGNvbmZpZ3VyZWRUaW1lb3V0ID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZW91dCA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVvdXQoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lb3V0XG5cbiAgaWYgKHR5cGVvZiBjb25maWd1cmVkVGltZW91dCAhPT0gXCJudW1iZXJcIiB8fCAhKGNvbmZpZ3VyZWRUaW1lb3V0ID4gMCkpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICByZXR1cm4gY29uZmlndXJlZFRpbWVvdXRcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgY29uZmlndXJlZCBjYWxsZXIvc2Vzc2lvbiBBYm9ydFNpZ25hbCBjb21wb3NlZCB3aXRoIHRoZSBkZWFkbGluZS5cbiAqIEByZXR1cm5zIHtBYm9ydFNpZ25hbCB8IHVuZGVmaW5lZH0gLSBDb25maWd1cmVkIGNhbGxlciBzaWduYWwsIG9yIHVuZGVmaW5lZCB3aGVuIG5vbmUgaXMgc2V0LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCkge1xuICBjb25zdCBjb25maWd1cmVkU2lnbmFsID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsKClcbiAgICA6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsXG5cbiAgcmV0dXJuIGNvbmZpZ3VyZWRTaWduYWwgfHwgdW5kZWZpbmVkXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgcGVyLXN0YXJ0dXAgY29udHJvbHMgd2l0aCB0aGUgY29uZmlndXJlZCBzZXNzaW9uIGNhbmNlbGxhdGlvbi5cbiAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWx9fSBjb250cm9scyAtIENhbGwgY29udHJvbHMuXG4gKiBAcmV0dXJucyB7e3RpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWx9fSAtIEVmZmVjdGl2ZSBzdGFydHVwIGNvbnRyb2xzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKGNvbnRyb2xzKSB7XG4gIGNvbnN0IHNlc3Npb25TaWduYWwgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKClcbiAgbGV0IHNpZ25hbCA9IGNvbnRyb2xzLnNpZ25hbCB8fCBzZXNzaW9uU2lnbmFsXG5cbiAgaWYgKGNvbnRyb2xzLnNpZ25hbCAmJiBzZXNzaW9uU2lnbmFsICYmIGNvbnRyb2xzLnNpZ25hbCAhPT0gc2Vzc2lvblNpZ25hbCkge1xuICAgIHNpZ25hbCA9IEFib3J0U2lnbmFsLmFueShbY29udHJvbHMuc2lnbmFsLCBzZXNzaW9uU2lnbmFsXSlcbiAgfVxuXG4gIGNvbnN0IGNvbmZpZ3VyZWRUaW1lb3V0TXMgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKClcbiAgY29uc3QgdGltZW91dE1zID0gY29udHJvbHMudGltZW91dE1zID09PSB1bmRlZmluZWRcbiAgICA/IGNvbmZpZ3VyZWRUaW1lb3V0TXNcbiAgICA6IGNvbmZpZ3VyZWRUaW1lb3V0TXMgPT09IHVuZGVmaW5lZFxuICAgICAgPyBjb250cm9scy50aW1lb3V0TXNcbiAgICAgIDogTWF0aC5taW4oY29udHJvbHMudGltZW91dE1zLCBjb25maWd1cmVkVGltZW91dE1zKVxuXG4gIHJldHVybiB7c2lnbmFsLCB0aW1lb3V0TXN9XG59XG5cbi8qKlxuICogUnVucyBwZXJmb3JtIHNoYXJlZCBmcm9udGVuZCBtb2RlbCBhcGkgcmVxdWVzdC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByZXF1ZXN0UGF5bG9hZCAtIFNoYXJlZCByZXF1ZXN0IHBheWxvYWQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIERlY29kZWQgc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSByZXNwb25zZS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcGVyZm9ybVNoYXJlZEZyb250ZW5kTW9kZWxBcGlSZXF1ZXN0KHJlcXVlc3RQYXlsb2FkKSB7XG4gIGNvbnN0IHRpbWVab25lID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKClcbiAgY29uc3Qgc2VyaWFsaXplZFJlcXVlc3RQYXlsb2FkID0gc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHJlcXVlc3RQYXlsb2FkLCB7dGltZVpvbmV9KVxuICBjb25zdCB3ZWJzb2NrZXRDbGllbnQgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudFxuICBjb25zdCB1cmwgPSBmcm9udGVuZE1vZGVsQXBpVXJsKClcbiAgY29uc3QgbWVyZ2VkSGVhZGVycyA9IGZyb250ZW5kTW9kZWxSZXF1ZXN0SGVhZGVycyh0aW1lWm9uZSlcblxuICByZXR1cm4gYXdhaXQgcnVuV2l0aFRyYW5zcG9ydERlYWRsaW5lKFxuICAgIHtcbiAgICAgIGVycm9yTWVzc2FnZTogXCJTaGFyZWQgZnJvbnRlbmQgbW9kZWwgQVBJIHJlcXVlc3QgdGltZWQgb3V0XCIsXG4gICAgICBzaWduYWw6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSxcbiAgICAgIHRpbWVvdXRNczogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVvdXRNcygpXG4gICAgfSxcbiAgICBhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICBpZiAod2Vic29ja2V0Q2xpZW50KSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgd2Vic29ja2V0Q2xpZW50LnBvc3QoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFBhdGgodXJsKSwgc2VyaWFsaXplZFJlcXVlc3RQYXlsb2FkLCB7XG4gICAgICAgICAgaGVhZGVyczogbWVyZ2VkSGVhZGVycyxcbiAgICAgICAgICBzaWduYWxcbiAgICAgICAgfSlcbiAgICAgICAgY29uc3QgcmVzcG9uc2VKc29uID0gcmVzcG9uc2UuanNvbigpXG5cbiAgICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocmVzcG9uc2VKc29uKSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoc2VyaWFsaXplZFJlcXVlc3RQYXlsb2FkKSxcbiAgICAgICAgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiLFxuICAgICAgICBoZWFkZXJzOiBtZXJnZWRIZWFkZXJzLFxuICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICBzaWduYWxcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlVGV4dCA9IGF3YWl0IHJlc3BvbnNlLnRleHQoKVxuXG4gICAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICAgIHRocm93RnJvbnRlbmRNb2RlbEh0dHBFcnJvcih7XG4gICAgICAgICAgY29tbWFuZExhYmVsOiBcInNoYXJlZCBmcm9udGVuZCBtb2RlbCBBUElcIixcbiAgICAgICAgICByZXNwb25zZSxcbiAgICAgICAgICByZXNwb25zZVRleHRcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgY29uc3QganNvbiA9IHJlc3BvbnNlVGV4dC5sZW5ndGggPiAwID8gSlNPTi5wYXJzZShyZXNwb25zZVRleHQpIDoge31cblxuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoanNvbikpXG4gICAgfVxuICApXG59XG5cbi8qKlxuICogVGhyb3dzIGEgZnJvbnRlbmQtbW9kZWwgSFRUUCBlcnJvciB3aXRoIGJhY2tlbmQtcHJvdmlkZWQgZW52ZWxvcGUgZGV0YWlscyB3aGVuIGF2YWlsYWJsZS5cbiAqIEBwYXJhbSB7e2NvbW1hbmRMYWJlbDogc3RyaW5nLCByZXNwb25zZTogUmVzcG9uc2UsIHJlc3BvbnNlVGV4dDogc3RyaW5nfX0gYXJncyAtIEVycm9yIHJlc3BvbnNlIGRldGFpbHMuXG4gKiBAcmV0dXJucyB7bmV2ZXJ9IC0gQWx3YXlzIHRocm93cyBhbiB1bmtub3duLWF0dHJpYnV0ZSBlcnJvci5cbiAqL1xuZnVuY3Rpb24gdGhyb3dGcm9udGVuZE1vZGVsSHR0cEVycm9yKHtjb21tYW5kTGFiZWwsIHJlc3BvbnNlLCByZXNwb25zZVRleHR9KSB7XG4gIC8vIFN1cmZhY2UgdGhlIGJhY2tlbmQncyBmcmllbmRseSBlcnJvck1lc3NhZ2UgZW52ZWxvcGUgKHRoZVxuICAvLyBge3N0YXR1czogXCJlcnJvclwiLCBlcnJvck1lc3NhZ2U6IFwiLi4uXCJ9YCBzaGFwZSBldmVyeSBjb250cm9sbGVyXG4gIC8vIHNoaXBzIG9uIGl0cyA0eHgvNXh4IHJlc3BvbnNlcykgaW5zdGVhZCBvZiB0aGUgZ2VuZXJpYyBzdGF0dXNcbiAgLy8gc3RyaW5nLiBGYWxsIHRocm91Z2ggdG8gdGhlIHN0YXR1cy1vbmx5IG1lc3NhZ2Ugd2hlbiB0aGUgYm9keSBpc1xuICAvLyBtaXNzaW5nLCBub24tSlNPTiwgb3IgaGFzIG5vIHVzYWJsZSBlcnJvck1lc3NhZ2UgZmllbGQuXG4gIGNvbnN0IHJlc3BvbnNlQ29udGVudFR5cGUgPSByZXNwb25zZS5oZWFkZXJzLmdldChcImNvbnRlbnQtdHlwZVwiKVxuXG4gIGlmIChyZXNwb25zZUNvbnRlbnRUeXBlICYmIHJlc3BvbnNlQ29udGVudFR5cGUuaW5jbHVkZXMoXCJhcHBsaWNhdGlvbi9qc29uXCIpICYmIHJlc3BvbnNlVGV4dC5sZW5ndGggPiAwKSB7XG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBlcnJvckJvZHkuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9ICovXG4gICAgbGV0IGVycm9yQm9keVxuXG4gICAgdHJ5IHtcbiAgICAgIGVycm9yQm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2VUZXh0KVxuICAgIH0gY2F0Y2gge1xuICAgICAgZXJyb3JCb2R5ID0gbnVsbFxuICAgIH1cblxuICAgIGlmIChlcnJvckJvZHkgJiYgdHlwZW9mIGVycm9yQm9keS5lcnJvck1lc3NhZ2UgPT09IFwic3RyaW5nXCIgJiYgZXJyb3JCb2R5LmVycm9yTWVzc2FnZS50cmltKCkubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yQm9keS5lcnJvck1lc3NhZ2UudHJpbSgpKVxuICAgIH1cbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihgUmVxdWVzdCBmYWlsZWQgKCR7cmVzcG9uc2Uuc3RhdHVzfSkgZm9yICR7Y29tbWFuZExhYmVsfWApXG59XG5cbi8qKlxuICogUnVucyBmbHVzaCBwZW5kaW5nIHNoYXJlZCBmcm9udGVuZCBtb2RlbCByZXF1ZXN0cy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHBlbmRpbmcgc2hhcmVkIGZyb250ZW5kLW1vZGVsIHJlcXVlc3RzIGZsdXNoLlxuICovXG5hc3luYyBmdW5jdGlvbiBmbHVzaFBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMoKSB7XG4gIHNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZCA9IGZhbHNlXG5cbiAgaWYgKHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMubGVuZ3RoIDwgMSkge1xuICAgIHJlc29sdmVGcm9udGVuZE1vZGVsSWRsZVdhaXRlcnMoKVxuICAgIHJldHVyblxuICB9XG5cbiAgY29uc3QgYmF0Y2hlZFJlcXVlc3RzID0gcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0c1xuICBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzID0gW11cblxuICBjb25zdCB1cmwgPSBmcm9udGVuZE1vZGVsQXBpVXJsKClcbiAgY29uc3QgcmVxdWVzdFBheWxvYWQgPSB7XG4gICAgcmVxdWVzdHM6IGJhdGNoZWRSZXF1ZXN0cy5tYXAoKHJlcXVlc3QpID0+IHtcbiAgICAgIGlmIChyZXF1ZXN0LmN1c3RvbVBhdGgpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb21tYW5kVHlwZTogcmVxdWVzdC5jb21tYW5kVHlwZSxcbiAgICAgICAgICBjdXN0b21QYXRoOiByZXF1ZXN0LmN1c3RvbVBhdGgsXG4gICAgICAgICAgbW9kZWw6IHJlcXVlc3QubW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgICBwYXlsb2FkOiByZXF1ZXN0LnBheWxvYWQsXG4gICAgICAgICAgLi4uKE9iamVjdC5rZXlzKHJlcXVlc3QucmVxdWVzdENvbnRleHQpLmxlbmd0aCA+IDAgPyB7cmVxdWVzdENvbnRleHQ6IHJlcXVlc3QucmVxdWVzdENvbnRleHR9IDoge30pLFxuICAgICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdC5yZXF1ZXN0SWRcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb21tYW5kVHlwZTogcmVxdWVzdC5jb21tYW5kVHlwZSxcbiAgICAgICAgbW9kZWw6IHJlcXVlc3QubW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgcGF5bG9hZDogcmVxdWVzdC5wYXlsb2FkLFxuICAgICAgICAuLi4oT2JqZWN0LmtleXMocmVxdWVzdC5yZXF1ZXN0Q29udGV4dCkubGVuZ3RoID4gMCA/IHtyZXF1ZXN0Q29udGV4dDogcmVxdWVzdC5yZXF1ZXN0Q29udGV4dH0gOiB7fSksXG4gICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdC5yZXF1ZXN0SWRcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgYXdhaXQgdHJhY2tGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdChhc3luYyAoKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIHZvaWQgdXJsXG4gICAgICBjb25zdCBkZWNvZGVkUmVzcG9uc2UgPSBhd2FpdCBwZXJmb3JtU2hhcmVkRnJvbnRlbmRNb2RlbEFwaVJlcXVlc3QocmVxdWVzdFBheWxvYWQpXG4gICAgICBjb25zdCByZXNwb25zZXMgPSBBcnJheS5pc0FycmF5KGRlY29kZWRSZXNwb25zZS5yZXNwb25zZXMpID8gZGVjb2RlZFJlc3BvbnNlLnJlc3BvbnNlcyA6IFtdXG4gICAgICBjb25zdCByZXNwb25zZXNCeUlkID0gbmV3IE1hcChyZXNwb25zZXMubWFwKChlbnRyeSkgPT4gW2VudHJ5LnJlcXVlc3RJZCwgZW50cnkucmVzcG9uc2VdKSlcblxuICAgICAgZm9yIChjb25zdCByZXF1ZXN0IG9mIGJhdGNoZWRSZXF1ZXN0cykge1xuICAgICAgICBjb25zdCByZXNwb25zZVBheWxvYWQgPSByZXNwb25zZXNCeUlkLmdldChyZXF1ZXN0LnJlcXVlc3RJZClcblxuICAgICAgICBpZiAoIXJlc3BvbnNlUGF5bG9hZCB8fCB0eXBlb2YgcmVzcG9uc2VQYXlsb2FkICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICAgICAgcmVxdWVzdC5yZWplY3QobmV3IEVycm9yKGBNaXNzaW5nIGJhdGNoZWQgcmVzcG9uc2UgZm9yICR7cmVxdWVzdC5tb2RlbENsYXNzLm5hbWV9IyR7cmVxdWVzdC5jb21tYW5kVHlwZX1gKSlcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgcmVxdWVzdC5yZXNvbHZlKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocmVzcG9uc2VQYXlsb2FkKSlcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZm9yIChjb25zdCByZXF1ZXN0IG9mIGJhdGNoZWRSZXF1ZXN0cykge1xuICAgICAgICByZXF1ZXN0LnJlamVjdChlcnJvcilcbiAgICAgIH1cbiAgICB9XG4gIH0pXG59XG5cbi8qKlxuICogUnVucyBzY2hlZHVsZSBzaGFyZWQgZnJvbnRlbmQgbW9kZWwgcmVxdWVzdCBmbHVzaC5cbiAqIEByZXR1cm5zIHt2b2lkfSAqL1xuZnVuY3Rpb24gc2NoZWR1bGVTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdEZsdXNoKCkge1xuICBpZiAoc2hhcmVkRnJvbnRlbmRNb2RlbEZsdXNoU2NoZWR1bGVkKSByZXR1cm5cblxuICBzaGFyZWRGcm9udGVuZE1vZGVsRmx1c2hTY2hlZHVsZWQgPSB0cnVlXG4gIHF1ZXVlTWljcm90YXNrKCgpID0+IHtcbiAgICB2b2lkIGZsdXNoUGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cygpXG4gIH0pXG59XG5cbi8qKlxuICogQ3VzdG9tIGNvbW1hbmRzIHN0aWxsIHVzZSB0aGUgc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSS4gVGhpcyBoZWxwZXIgb25seSBidWlsZHMgdGhlIGJhY2tlbmQgcm91dGUgcGF0aCB0aGUgc2VydmVyIHNob3VsZCBkaXNwYXRjaCBhZnRlciB2YWxpZGF0aW5nIHRoZSBzZWdtZW50cy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29tbWFuZE5hbWUgLSBDb21tYW5kIHBhdGggc2VnbWVudC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1vZGVsTmFtZSAtIEZyb250ZW5kIG1vZGVsIGNsYXNzIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IFthcmdzLm1lbWJlcklkXSAtIE9wdGlvbmFsIG1lbWJlciBpZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlUGF0aCAtIFJlc291cmNlIHBhdGggcHJlZml4LlxuICogQHJldHVybnMge3N0cmluZ30gLSBDdXN0b20gYmFja2VuZCByb3V0ZSBwYXRoLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZFBhdGgoe2NvbW1hbmROYW1lLCBtZW1iZXJJZCwgbW9kZWxOYW1lLCByZXNvdXJjZVBhdGh9KSB7XG4gIGNvbnN0IHZhbGlkYXRlZFJlc291cmNlUGF0aCA9IHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aCh7bW9kZWxOYW1lLCByZXNvdXJjZVBhdGh9KVxuICBjb25zdCB2YWxpZGF0ZWRDb21tYW5kTmFtZSA9IHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWUoe2NvbW1hbmROYW1lLCBjb21tYW5kVHlwZTogY29tbWFuZE5hbWUsIG1vZGVsTmFtZX0pXG5cbiAgaWYgKG1lbWJlcklkID09PSB1bmRlZmluZWQgfHwgbWVtYmVySWQgPT09IG51bGwgfHwgbWVtYmVySWQgPT09IFwiXCIpIHtcbiAgICByZXR1cm4gYCR7dmFsaWRhdGVkUmVzb3VyY2VQYXRofS8ke3ZhbGlkYXRlZENvbW1hbmROYW1lfWBcbiAgfVxuXG4gIHJldHVybiBgJHt2YWxpZGF0ZWRSZXNvdXJjZVBhdGh9LyR7ZW5jb2RlVVJJQ29tcG9uZW50KFN0cmluZyhtZW1iZXJJZCkpfS8ke3ZhbGlkYXRlZENvbW1hbmROYW1lfWBcbn1cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBmaW5kIGJ5IGNvbmRpdGlvbnMgc2hhcGUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjb25kaXRpb25zIC0gZmluZEJ5IGNvbmRpdGlvbnMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0RmluZEJ5Q29uZGl0aW9uc1NoYXBlKGNvbmRpdGlvbnMpIHtcbiAgaWYgKCFjb25kaXRpb25zIHx8IHR5cGVvZiBjb25kaXRpb25zICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoY29uZGl0aW9ucykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBleHBlY3RzIGNvbmRpdGlvbnMgdG8gYmUgYSBwbGFpbiBvYmplY3QsIGdvdDogJHtjb25kaXRpb25zfWApXG4gIH1cblxuICBjb25zdCBjb25kaXRpb25zUHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGNvbmRpdGlvbnMpXG5cbiAgaWYgKGNvbmRpdGlvbnNQcm90b3R5cGUgIT09IE9iamVjdC5wcm90b3R5cGUgJiYgY29uZGl0aW9uc1Byb3RvdHlwZSAhPT0gbnVsbCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGV4cGVjdHMgY29uZGl0aW9ucyB0byBiZSBhIHBsYWluIG9iamVjdCwgZ290OiAke2NvbmRpdGlvbnN9YClcbiAgfVxuXG4gIGNvbnN0IHN5bWJvbEtleXMgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlTeW1ib2xzKGNvbmRpdGlvbnMpXG5cbiAgaWYgKHN5bWJvbEtleXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgc3ltYm9sIGNvbmRpdGlvbiBrZXlzIChrZXlzOiAke3N5bWJvbEtleXMubWFwKChrZXkpID0+IGtleS50b1N0cmluZygpKS5qb2luKFwiLCBcIil9KWApXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGFzc2VydCBkZWZpbmVkIGZpbmQgYnkgY29uZGl0aW9uIHZhbHVlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDb25kaXRpb24gdmFsdWUgdG8gdmFsaWRhdGUuXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5UGF0aCAtIEtleSBwYXRoIGZvciBlcnJvciBvdXRwdXQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXNzZXJ0RGVmaW5lZEZpbmRCeUNvbmRpdGlvblZhbHVlKHZhbHVlLCBrZXlQYXRoKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCB1bmRlZmluZWQgY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IGZ1bmN0aW9uIGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzeW1ib2xcIikge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgc3ltYm9sIGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJiaWdpbnRcIikge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgYmlnaW50IGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiAhTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgbm9uLWZpbml0ZSBudW1iZXIgY29uZGl0aW9uIHZhbHVlcyAoa2V5OiAke2tleVBhdGh9KWApXG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICB2YWx1ZS5mb3JFYWNoKChlbnRyeSwgaW5kZXgpID0+IHtcbiAgICAgIGFzc2VydERlZmluZWRGaW5kQnlDb25kaXRpb25WYWx1ZShlbnRyeSwgYCR7a2V5UGF0aH1bJHtpbmRleH1dYClcbiAgICB9KVxuICAgIHJldHVyblxuICB9XG5cbiAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIikge1xuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IG9iamVjdFZhbHVlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh2YWx1ZSlcbiAgICBjb25zdCBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2Yob2JqZWN0VmFsdWUpXG5cbiAgICBpZiAocHJvdG90eXBlICE9PSBPYmplY3QucHJvdG90eXBlICYmIHByb3RvdHlwZSAhPT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBub24tcGxhaW4gb2JqZWN0IGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICAgIH1cblxuICAgIGNvbnN0IHN5bWJvbEtleXMgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlTeW1ib2xzKG9iamVjdFZhbHVlKVxuXG4gICAgaWYgKHN5bWJvbEtleXMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBzeW1ib2wgY29uZGl0aW9uIGtleXMgKGtleTogJHtrZXlQYXRofSlgKVxuICAgIH1cblxuICAgIGNvbnN0IHZhbHVlT2JqZWN0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh2YWx1ZSlcblxuICAgIE9iamVjdC5rZXlzKHZhbHVlT2JqZWN0KS5mb3JFYWNoKChuZXN0ZWRLZXkpID0+IHtcbiAgICAgIGFzc2VydERlZmluZWRGaW5kQnlDb25kaXRpb25WYWx1ZSh2YWx1ZU9iamVjdFtuZXN0ZWRLZXldLCBgJHtrZXlQYXRofS4ke25lc3RlZEtleX1gKVxuICAgIH0pXG4gIH1cbn1cblxuLyoqXG4gKiBCYXNlIGZyb250ZW5kIG1vZGVsLlxuICpcbiAqIERlZmF1bHRzIGFyZSBgYW55YCBzbyB0aGUgYmFyZSBgRnJvbnRlbmRNb2RlbEJhc2VgIOKAlCB1c2VkIHRocm91Z2hvdXQgYXMgYVxuICogY29uc3RyYWludC9wYXJhbWV0ZXIgdHlwZSBmb3IgXCJhbnkgZnJvbnRlbmQgbW9kZWxcIiDigJQgYWNjZXB0cyBnZW5lcmF0ZWRcbiAqIHN1YmNsYXNzZXMgZGVjbGFyaW5nIHR5cGVkLWF0dHJpYnV0ZSBnZW5lcmljcyAoYEZyb250ZW5kTW9kZWxCYXNlPFhBdHRyaWJ1dGVzLFxuICogLi4uPmApLiBBIGNvbmNyZXRlIGBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+YCBkZWZhdWx0IG1ha2VzXG4gKiB0aG9zZSBzdWJjbGFzc2VzIGZhaWwgYnkgaW52YXJpYW5jZS4gU3ViY2xhc3NlcyBzdGlsbCBwYXNzIHRoZWlyIHByZWNpc2VcbiAqIGF0dHJpYnV0ZSB0eXBlZGVmcywgc28gdHlwZWQgYWNjZXNzb3JzIGtlZXAgdGhlaXIgcHJlY2lzaW9uLlxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtBdHRyaWJ1dGVzPWFueV1cbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbQ3JlYXRlQXR0cmlidXRlcz1hbnldXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW1VwZGF0ZUF0dHJpYnV0ZXM9YW55XVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBGcm9udGVuZE1vZGVsQmFzZSB7XG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBtb2RlbE5hbWVcblxuICAvKipcbiAgICogQXV0b2xvYWQuXG4gICAqIEB0eXBlIHtib29sZWFufSAtIEdsb2JhbCBhdXRvLWJhdGNoLXByZWxvYWQgdG9nZ2xlLiBBcHBzIGNhbiBvcHQgb3V0IHZpYSBGcm9udGVuZE1vZGVsQmFzZS5zZXRBdXRvbG9hZChmYWxzZSkuXG4gICAqL1xuICBzdGF0aWMgX2F1dG9sb2FkID0gdHJ1ZVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdXRvbG9hZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgYXV0by1iYXRjaC1wcmVsb2FkIG9mIHJlbGF0aW9uc2hpcHMgb24gbGF6eSBhY2Nlc3MgaXMgZW5hYmxlZCBnbG9iYWxseS5cbiAgICovXG4gIHN0YXRpYyBnZXRBdXRvbG9hZCgpIHsgcmV0dXJuIEZyb250ZW5kTW9kZWxCYXNlLl9hdXRvbG9hZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGF1dG9sb2FkLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld1ZhbHVlIC0gV2hldGhlciBhdXRvLWJhdGNoLXByZWxvYWQgb2YgcmVsYXRpb25zaGlwcyBpcyBlbmFibGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBzZXRBdXRvbG9hZChuZXdWYWx1ZSkgeyBGcm9udGVuZE1vZGVsQmFzZS5fYXV0b2xvYWQgPSBuZXdWYWx1ZSB9XG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovXG4gIF9hdHRyaWJ1dGVzXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcDxGcm9udGVuZE1vZGVsQmFzZSwgRnJvbnRlbmRNb2RlbEJhc2UsIFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4+IHwgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwPEZyb250ZW5kTW9kZWxCYXNlLCBGcm9udGVuZE1vZGVsQmFzZSwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPj4+fSAqL1xuICBfcmVsYXRpb25zaGlwc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGU+fSAqL1xuICBfYXR0YWNobWVudHNcbiAgLyoqXG4gICAqIFJhaWxzLXN0eWxlIG5lc3RlZCBhdHRyaWJ1dGUgcGF5bG9hZHMgcXVldWVkIGZvciB0aGUgbmV4dCBzYXZlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fVxuICAgKi9cbiAgX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtTZXQ8c3RyaW5nPiB8IG51bGx9ICovXG4gIF9zZWxlY3RlZEF0dHJpYnV0ZXNcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gIF9pc05ld1JlY29yZFxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgX21hcmtlZEZvckRlc3RydWN0aW9uXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqL1xuICBfcGVyc2lzdGVkQXR0cmlidXRlc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+IHwgdW5kZWZpbmVkfSAtIFNoYXJlZCByZWZlcmVuY2UgdG8gc2libGluZyByZWNvcmRzIGxvYWRlZCBpbiB0aGUgc2FtZSBiYXRjaC4gVXNlZCBieSBhdXRvLWJhdGNoLXByZWxvYWQuXG4gICAqL1xuICBfbG9hZENvaG9ydFxuICAvKipcbiAgICogQ2Fub25pY2FsIGJhY2tpbmctcmVjb3JkIGF0dGFjaG1lbnQgb3duZXIgcmV0dXJuZWQgYnkgdGhlIHNlcnZlci5cbiAgICogQHR5cGUge3tyZWNvcmRJZDogc3RyaW5nLCByZWNvcmRUeXBlOiBzdHJpbmd9IHwgbnVsbH1cbiAgICovXG4gIF9hdHRhY2htZW50T3duZXJcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtBdHRyaWJ1dGVzIHwgQ3JlYXRlQXR0cmlidXRlc30gW2F0dHJpYnV0ZXNdIC0gSW5pdGlhbCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgY29uc3RydWN0b3IoYXR0cmlidXRlcykge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcblxuICAgIE1vZGVsQ2xhc3MuZW5zdXJlR2VuZXJhdGVkQXR0YWNobWVudE1ldGhvZHMoKVxuICAgIHRoaXMuX2F0dHJpYnV0ZXMgPSB7fVxuICAgIHRoaXMuX3JlbGF0aW9uc2hpcHMgPSB7fVxuICAgIHRoaXMuX2F0dGFjaG1lbnRzID0ge31cbiAgICB0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgdGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzID0gbnVsbFxuICAgIHRoaXMuX2lzTmV3UmVjb3JkID0gdHJ1ZVxuICAgIHRoaXMuX21hcmtlZEZvckRlc3RydWN0aW9uID0gZmFsc2VcbiAgICB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICB0aGlzLl9hdHRhY2htZW50T3duZXIgPSBudWxsXG4gICAgaWYgKGF0dHJpYnV0ZXMpIHRoaXMuYXNzaWduQXR0cmlidXRlcyhhdHRyaWJ1dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGdlbmVyYXRlZCBhdHRhY2htZW50IG1ldGhvZHMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIEVuc3VyZXMgYXR0YWNobWVudCBoZWxwZXIgbWV0aG9kcyBleGlzdCBvbiB0aGUgcHJvdG90eXBlLlxuICAgKi9cbiAgc3RhdGljIGVuc3VyZUdlbmVyYXRlZEF0dGFjaG1lbnRNZXRob2RzKCkge1xuICAgIGlmICh0aGlzLl9nZW5lcmF0ZWRBdHRhY2htZW50TWV0aG9kcykgcmV0dXJuXG5cbiAgICBjb25zdCBhdHRhY2htZW50cyA9IHRoaXMuYXR0YWNobWVudERlZmluaXRpb25zKClcbiAgICBjb25zdCBwcm90b3R5cGUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHRoaXMucHJvdG90eXBlKVxuXG4gICAgZm9yIChjb25zdCBhdHRhY2htZW50TmFtZSBvZiBPYmplY3Qua2V5cyhhdHRhY2htZW50cykpIHtcbiAgICAgIGlmICghKGF0dGFjaG1lbnROYW1lIGluIHByb3RvdHlwZSkpIHtcbiAgICAgICAgcHJvdG90eXBlW2F0dGFjaG1lbnROYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLl9nZW5lcmF0ZWRBdHRhY2htZW50TWV0aG9kcyA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIGNvbmZpZy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ30gLSBSZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgc3RhdGljIHJlc291cmNlQ29uZmlnKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcInJlc291cmNlQ29uZmlnKCkgbXVzdCBiZSBpbXBsZW1lbnRlZCBieSBzdWJjbGFzc2VzXCIpXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLXVucmVhY2hhYmxlXG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3Nlcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxDbGFzcyB8IHN0cmluZz59IC0gUmVsYXRpb25zaGlwIG1vZGVsIGNsYXNzZXMgKG9yIGNsYXNzIG5hbWUgc3RyaW5ncykga2V5ZWQgYnkgcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzKCkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGEgZnJvbnRlbmQgbW9kZWwgY2xhc3Mgc28gaXQgY2FuIGJlIHJlc29sdmVkIGJ5IG5hbWUgaW4gcmVsYXRpb25zaGlwIGxvb2t1cHMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gcmVnaXN0ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyTW9kZWwobW9kZWxDbGFzcykge1xuICAgIHJlZ2lzdGVyRnJvbnRlbmRNb2RlbChtb2RlbENsYXNzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmaW5lIHNjb3BlLlxuICAgKiBAcGFyYW0geyguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjYWxsYmFjayAtIFNjb3BlIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7KCguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxGcm9udGVuZE1vZGVsQ2xhc3M+KSAmIHtzY29wZTogKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIikuTW9kZWxTY29wZURlc2NyaXB0b3J9fSAtIFNjb3BlIGhlbHBlci5cbiAgICovXG4gIHN0YXRpYyBkZWZpbmVTY29wZShjYWxsYmFjaykge1xuICAgIHJldHVybiBkZWZpbmVNb2RlbFNjb3BlKHtcbiAgICAgIGNhbGxiYWNrLFxuICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgIHN0YXJ0UXVlcnk6ICgpID0+IHRoaXMucXVlcnkoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZSBhIHJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzcyB2YWx1ZSB0aGF0IG1heSBiZSBhIGNsYXNzIHJlZmVyZW5jZSBvciBhIHN0cmluZyBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzcyB8IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWR9IHZhbHVlIC0gQ2xhc3Mgb3IgY2xhc3MgbmFtZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxDbGFzcyB8IG51bGx9IC0gUmVzb2x2ZWQgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgcmVzb2x2ZU1vZGVsQ2xhc3ModmFsdWUpIHtcbiAgICByZXR1cm4gcmVzb2x2ZUZyb250ZW5kTW9kZWxDbGFzcyh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBkZWZpbml0aW9ucy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHt0eXBlOiBcImJlbG9uZ3NUb1wiIHwgXCJoYXNPbmVcIiB8IFwiaGFzTWFueVwiLCBhdXRvbG9hZD86IGJvb2xlYW59Pn0gLSBSZWxhdGlvbnNoaXAgZGVmaW5pdGlvbnMga2V5ZWQgYnkgcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwRGVmaW5pdGlvbnMoKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2htZW50IGRlZmluaXRpb25zLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREZWZpbml0aW9uPn0gLSBBdHRhY2htZW50IGRlZmluaXRpb25zIGtleWVkIGJ5IGF0dGFjaG1lbnQgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBhdHRhY2htZW50RGVmaW5pdGlvbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMucmVzb3VyY2VDb25maWcoKS5hdHRhY2htZW50cyB8fCB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNobWVudCBkZWZpbml0aW9uLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQXR0YWNobWVudERlZmluaXRpb24gfCBudWxsfSAtIEF0dGFjaG1lbnQgZGVmaW5pdGlvbi5cbiAgICovXG4gIHN0YXRpYyBhdHRhY2htZW50RGVmaW5pdGlvbihhdHRhY2htZW50TmFtZSkge1xuICAgIHJldHVybiB0aGlzLmF0dGFjaG1lbnREZWZpbml0aW9ucygpW2F0dGFjaG1lbnROYW1lXSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbi5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge3t0eXBlOiBcImJlbG9uZ3NUb1wiIHwgXCJoYXNPbmVcIiB8IFwiaGFzTWFueVwiLCBhdXRvbG9hZD86IGJvb2xlYW59IHwgbnVsbH0gLSBSZWxhdGlvbnNoaXAgZGVmaW5pdGlvbi5cbiAgICovXG4gIHN0YXRpYyByZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBjb25zdCBkZWZpbml0aW9ucyA9IHRoaXMucmVsYXRpb25zaGlwRGVmaW5pdGlvbnMoKVxuXG4gICAgcmV0dXJuIGRlZmluaXRpb25zW3JlbGF0aW9uc2hpcE5hbWVdIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIFJhaWxzLXN0eWxlIG5lc3RlZCBhdHRyaWJ1dGVzIGtleSB0byBhIGNvbmZpZ3VyZWQgcmVsYXRpb25zaGlwLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIENhbmRpZGF0ZSBhdHRyaWJ1dGUgbmFtZSwgc3VjaCBhcyBgdGFza3NBdHRyaWJ1dGVzYC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IFJlbGF0aW9uc2hpcCBuYW1lIHdoZW4gbmVzdGVkIGF0dHJpYnV0ZXMgYXJlIGNvbmZpZ3VyZWQuXG4gICAqL1xuICBzdGF0aWMgbmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUoYXR0cmlidXRlTmFtZSkge1xuICAgIGlmICghYXR0cmlidXRlTmFtZS5lbmRzV2l0aChcIkF0dHJpYnV0ZXNcIikpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCByZWxhdGlvbnNoaXBOYW1lID0gYXR0cmlidXRlTmFtZS5zbGljZSgwLCAtXCJBdHRyaWJ1dGVzXCIubGVuZ3RoKVxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXNDb25maWcgPSB0aGlzLnJlc291cmNlQ29uZmlnKCkubmVzdGVkQXR0cmlidXRlcyB8fCB7fVxuXG4gICAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnLCByZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgPyByZWxhdGlvbnNoaXBOYW1lXG4gICAgICA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxDbGFzcyB8IG51bGx9IC0gVGFyZ2V0IHJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIHN0YXRpYyByZWxhdGlvbnNoaXBNb2RlbENsYXNzKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBNb2RlbENsYXNzZXMgPSB0aGlzLnJlbGF0aW9uc2hpcE1vZGVsQ2xhc3NlcygpXG4gICAgY29uc3QgdmFsdWUgPSByZWxhdGlvbnNoaXBNb2RlbENsYXNzZXNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgIHJldHVybiBGcm9udGVuZE1vZGVsQmFzZS5yZXNvbHZlTW9kZWxDbGFzcyh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtBdHRyaWJ1dGVzfSAtIEF0dHJpYnV0ZXMgaGFzaC5cbiAgICovXG4gIGF0dHJpYnV0ZXMoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7QXR0cmlidXRlc30gKi8gKHRoaXMuX2F0dHJpYnV0ZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBuZXcgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgbW9kZWwgaGFzIG5vdCB5ZXQgYmVlbiBwZXJzaXN0ZWQuXG4gICAqL1xuICBpc05ld1JlY29yZCgpIHtcbiAgICByZXR1cm4gdGhpcy5faXNOZXdSZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIHBlcnNpc3RlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIG1vZGVsIGhhcyBiZWVuIHBlcnNpc3RlZC5cbiAgICovXG4gIGlzUGVyc2lzdGVkKCkge1xuICAgIHJldHVybiAhdGhpcy5pc05ld1JlY29yZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgaXMgbmV3IHJlY29yZC5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdJc05ld1JlY29yZCAtIE5ldyBwZXJzaXN0ZWQtc3RhdGUgZmxhZy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRJc05ld1JlY29yZChuZXdJc05ld1JlY29yZCkge1xuICAgIHRoaXMuX2lzTmV3UmVjb3JkID0gbmV3SXNOZXdSZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXJrcyB0aGlzIHJlY29yZCBmb3IgZGVzdHJ1Y3Rpb24gd2hlbiBpdHMgcGFyZW50IGlzIG5leHQgc2F2ZWQgdGhyb3VnaFxuICAgKiBuZXN0ZWQtYXR0cmlidXRlIHN1cHBvcnQuIFRoZSByZWNvcmQgaXMgbm90IHJlbW92ZWQgZnJvbSB0aGUgcGFyZW50J3NcbiAgICogcmVsYXRpb25zaGlwIGNvbGxlY3Rpb24gdW50aWwgdGhlIHNlcnZlciBjb25maXJtcyB0aGUgZGVsZXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBtYXJrRm9yRGVzdHJ1Y3Rpb24oKSB7XG4gICAgdGhpcy5fbWFya2VkRm9yRGVzdHJ1Y3Rpb24gPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXJrZWQgZm9yIGRlc3RydWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgcmVjb3JkIGlzIHF1ZXVlZCBmb3IgbmVzdGVkIGRlc3RydWN0aW9uIG9uIG5leHQgcGFyZW50IHNhdmUuXG4gICAqL1xuICBtYXJrZWRGb3JEZXN0cnVjdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fbWFya2VkRm9yRGVzdHJ1Y3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNoYW5nZXMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIENoYW5nZWQgYXR0cmlidXRlcyBhcyBgW29sZFZhbHVlLCBuZXdWYWx1ZV1gLlxuICAgKi9cbiAgY2hhbmdlcygpIHtcbiAgICAvKipcbiAgICAgKiBDaGFuZ2VkIGF0dHJpYnV0ZXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgY29uc3QgY2hhbmdlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gbmV3IFNldChbXG4gICAgICAuLi5PYmplY3Qua2V5cyh0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzKSxcbiAgICAgIC4uLk9iamVjdC5rZXlzKHRoaXMuX2F0dHJpYnV0ZXMpXG4gICAgXSlcblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBhdHRyaWJ1dGVOYW1lcykge1xuICAgICAgY29uc3QgcHJldmlvdXNWYWx1ZSA9IHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cbiAgICAgIGNvbnN0IGN1cnJlbnRWYWx1ZSA9IHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cblxuICAgICAgaWYgKEpTT04uc3RyaW5naWZ5KHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShwcmV2aW91c1ZhbHVlKSkgIT09IEpTT04uc3RyaW5naWZ5KHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShjdXJyZW50VmFsdWUpKSkge1xuICAgICAgICBjaGFuZ2VkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IFtwcmV2aW91c1ZhbHVlLCBjdXJyZW50VmFsdWVdXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYW5nZWRBdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBjaGFuZ2VkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGFueSB0cmFja2VkIGF0dHJpYnV0ZSBoYXMgY2hhbmdlZC5cbiAgICovXG4gIGlzQ2hhbmdlZCgpIHtcbiAgICByZXR1cm4gT2JqZWN0LmtleXModGhpcy5jaGFuZ2VzKCkpLmxlbmd0aCA+IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZWxhdGlvbnNoaXAgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXB9IC0gUmVsYXRpb25zaGlwIHN0YXRlIG9iamVjdC5cbiAgICovXG4gIGdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgaWYgKCF0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdKSB7XG4gICAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBEZWZpbml0aW9uID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBNb2RlbENsYXNzKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXBEZWZpbml0aW9uICYmIHJlbGF0aW9uc2hpcFR5cGVJc0NvbGxlY3Rpb24ocmVsYXRpb25zaGlwRGVmaW5pdGlvbi50eXBlKSkge1xuICAgICAgICB0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdID0gbmV3IEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwKHRoaXMsIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3MpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdID0gbmV3IEZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcCh0aGlzLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXR0YWNobWVudCBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQXR0YWNobWVudEhhbmRsZX0gLSBBdHRhY2htZW50IGhlbHBlci5cbiAgICovXG4gIGdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKGF0dGFjaG1lbnROYW1lKVxuXG4gICAgaWYgKCFhdHRhY2htZW50RGVmaW5pdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGF0dGFjaG1lbnQ6ICR7TW9kZWxDbGFzcy5uYW1lfSMke2F0dGFjaG1lbnROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0pIHtcbiAgICAgIHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXSA9IG5ldyBGcm9udGVuZE1vZGVsQXR0YWNobWVudEhhbmRsZSh7XG4gICAgICAgIGF0dGFjaG1lbnROYW1lLFxuICAgICAgICBtb2RlbDogdGhpc1xuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRNb2RlbEJhc2UgfCBBcnJheTxGcm9udGVuZE1vZGVsQmFzZT4gfCBudWxsPn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgbG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGlkID0gdGhpcy5wcmltYXJ5S2V5VmFsdWUoKVxuICAgIGNvbnN0IHJlbG9hZGVkTW9kZWwgPSBhd2FpdCBNb2RlbENsYXNzXG4gICAgICAucHJlbG9hZChbcmVsYXRpb25zaGlwTmFtZV0pXG4gICAgICAuZmluZChpZClcbiAgICBjb25zdCBzb3VyY2VSZWxhdGlvbnNoaXAgPSByZWxvYWRlZE1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgIGNvbnN0IHRhcmdldFJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBjb3B5TG9hZGVkUmVsYXRpb25zaGlwVmFsdWUoe3NvdXJjZVJlbGF0aW9uc2hpcCwgdGFyZ2V0UmVsYXRpb25zaGlwfSlcblxuICAgIHJldHVybiB0YXJnZXRSZWxhdGlvbnNoaXAubG9hZGVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVsb2FkcyByZWxhdGlvbnNoaXAocykgb250byB0aGlzIGFscmVhZHktbG9hZGVkIHJlY29yZC4gQWNjZXB0cyBlaXRoZXIgYVxuICAgKiBxdWVyeSBidWlsdCB2aWEgYE1vZGVsLnByZWxvYWQoLi4uKS5zZWxlY3QoLi4uKWAgb3IgYSByYXcgcHJlbG9hZCBzcGVjXG4gICAqIChzdHJpbmcgLyBhcnJheSAvIG5lc3RlZCBvYmplY3QpLiBSZWxhdGlvbnNoaXBzIGFscmVhZHkgcHJlbG9hZGVkIHdpdGggdGhlXG4gICAqIHJlcXVpcmVkIGNvbHVtbnMgcHJlc2VudCBhcmUgbGVmdCB1bnRvdWNoZWQgdW5sZXNzIGBmb3JjZWAgaXMgc2V0LiBDYXJyaWVzXG4gICAqIHRoZSBxdWVyeSdzIHByZWxvYWQgZ3JhcGgsIHNlbGVjdCwgc2VsZWN0c0V4dHJhLCB3aXRoQ291bnQsIGFiaWxpdGllcywgYW5kXG4gICAqIHF1ZXJ5RGF0YSB3aGVuIHJlLWZldGNoaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxGcm9udGVuZE1vZGVsQ2xhc3M+IHwgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQ+fSBxdWVyeU9yU3BlYyAtIFByZWxvYWQgc291cmNlLlxuICAgKiBAcGFyYW0ge3tmb3JjZT86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBPcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHByZWxvYWRpbmcgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgcHJlbG9hZChxdWVyeU9yU3BlYywgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgRnJvbnRlbmRNb2RlbFByZWxvYWRlci5wcmVsb2FkKFt0aGlzXSwgcXVlcnlPclNwZWMsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgb3IgbG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRNb2RlbEJhc2UgfCBBcnJheTxGcm9udGVuZE1vZGVsQmFzZT4gfCBudWxsPn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgcmVsYXRpb25zaGlwT3JMb2FkKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRQcmVsb2FkZWQoKSkge1xuICAgICAgcmV0dXJuIHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuICAgIH1cblxuICAgIGNvbnN0IGJhdGNoZWQgPSBhd2FpdCB0aGlzLl90cnlDb2hvcnRQcmVsb2FkKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoYmF0Y2hlZCkgcmV0dXJuIHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0dGVtcHRzIHRvIGJhdGNoLWxvYWQgYHJlbGF0aW9uc2hpcE5hbWVgIGFjcm9zcyBjb2hvcnQgc2libGluZ3MgdmlhIGFcbiAgICogc2luZ2xlIGBwcmVsb2FkKFtuYW1lXSkud2hlcmUoe3BrOiBbaWRzXX0pLnRvQXJyYXkoKWAgcmVxdWVzdCwgdGhlbiBjb3BpZXNcbiAgICogdGhlIHByZWxvYWRlZCByZWxhdGlvbnNoaXAgc3RhdGUgb250byBlYWNoIHNpYmxpbmcuIFJldHVybnMgdHJ1ZSB3aGVuIGFcbiAgICogYmF0Y2ggcmFuLCBmYWxzZSB3aGVuIGF1dG9sb2FkIGlzIG9mZiwgdGhlcmUgaXMgbm8gY29ob3J0LCBvciBubyBiYXRjaFxuICAgKiBjYW5kaWRhdGVzIHJlbWFpbi4gU2libGluZ3Mgd2hvc2UgcmVsYXRpb25zaGlwIHN0YXRlIGlzIGFscmVhZHkgc2V0XG4gICAqIChwcmVsb2FkZWQgb3IgbG9jYWxseSBtYW5pcHVsYXRlZCB2aWEgYGJ1aWxkYCAvIGBzZXRSZWxhdGlvbnNoaXBgKSBhcmVcbiAgICogc2tpcHBlZCBzbyB0aGVpciBjYWNoZWQvZWRpdGVkIHZhbHVlIGlzIHByZXNlcnZlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhIGNvaG9ydCBiYXRjaCBwcmVsb2FkIHJhbi5cbiAgICovXG4gIGFzeW5jIF90cnlDb2hvcnRQcmVsb2FkKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBpZiAoIUZyb250ZW5kTW9kZWxCYXNlLmdldEF1dG9sb2FkKCkpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGNvaG9ydCA9IHRoaXMuX2xvYWRDb2hvcnRcblxuICAgIGlmICghY29ob3J0IHx8IGNvaG9ydC5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBkZWZpbml0aW9uID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIWRlZmluaXRpb24pIHJldHVybiBmYWxzZVxuICAgIGlmIChkZWZpbml0aW9uLmF1dG9sb2FkID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlXG5cbiAgICAvKipcbiAgICAgKiBCYXRjaC5cbiAgICAgKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+fSAqL1xuICAgIGNvbnN0IGJhdGNoID0gW11cblxuICAgIC8vIEV4YWN0IHNhbWUgY2xhc3MsIHBlcnNpc3RlZCwgbm8gZXhpc3RpbmcgaW4tbWVtb3J5IHJlbGF0aW9uc2hpcCBzdGF0ZS5cbiAgICAvLyBgc2V0TG9hZGVkYCBzZXRzIGBfcHJlbG9hZGVkID0gdHJ1ZWAgb24gZXZlcnkgbXV0YXRpb24gcGF0aCAocHJlbG9hZCxcbiAgICAvLyBzZXRSZWxhdGlvbnNoaXAsIGJ1aWxkLCBhZGRUb0xvYWRlZCksIHNvIGBnZXRQcmVsb2FkZWQoKWAgYWxvbmUgaXMgYVxuICAgIC8vIHJlbGlhYmxlIFwiYWxyZWFkeSB0b3VjaGVkXCIgc2lnbmFsIG9uIHRoZSBmcm9udGVuZC5cbiAgICBmb3IgKGNvbnN0IHNpYmxpbmcgb2YgY29ob3J0KSB7XG4gICAgICBpZiAoc2libGluZy5jb25zdHJ1Y3RvciAhPT0gTW9kZWxDbGFzcykgY29udGludWVcbiAgICAgIGlmIChzaWJsaW5nLmlzTmV3UmVjb3JkKCkpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHNpYmxpbmdSZWxhdGlvbnNoaXAgPSBzaWJsaW5nLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICBpZiAoc2libGluZ1JlbGF0aW9uc2hpcC5nZXRQcmVsb2FkZWQoKSkgY29udGludWVcblxuICAgICAgYmF0Y2gucHVzaChzaWJsaW5nKVxuICAgIH1cblxuICAgIGlmIChiYXRjaC5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBiYXRjaElkcyA9IGJhdGNoLm1hcCgoc2libGluZykgPT4gc2libGluZy5wcmltYXJ5S2V5VmFsdWUoKSlcbiAgICBjb25zdCByZWxvYWRlZEJhdGNoID0gYXdhaXQgTW9kZWxDbGFzc1xuICAgICAgLnByZWxvYWQoW3JlbGF0aW9uc2hpcE5hbWVdKVxuICAgICAgLndoZXJlKHtbcHJpbWFyeUtleV06IGJhdGNoSWRzfSlcbiAgICAgIC50b0FycmF5KClcblxuICAgIC8qKlxuICAgICAqIFJlbG9hZGVkIGJ5IGlkLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBGcm9udGVuZE1vZGVsQmFzZT59ICovXG4gICAgY29uc3QgcmVsb2FkZWRCeUlkID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IHJlbG9hZGVkIG9mIHJlbG9hZGVkQmF0Y2gpIHtcbiAgICAgIHJlbG9hZGVkQnlJZC5zZXQobW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcmVsb2FkZWQucHJpbWFyeUtleVZhbHVlKCkpLCByZWxvYWRlZClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHNpYmxpbmcgb2YgYmF0Y2gpIHtcbiAgICAgIGNvbnN0IGtleSA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHNpYmxpbmcucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgICBjb25zdCByZWxvYWRlZCA9IHJlbG9hZGVkQnlJZC5nZXQoa2V5KVxuXG4gICAgICBpZiAoIXJlbG9hZGVkKSBjb250aW51ZVxuXG4gICAgICBjb3B5TG9hZGVkUmVsYXRpb25zaGlwVmFsdWUoe1xuICAgICAgICBzb3VyY2VSZWxhdGlvbnNoaXA6IHJlbG9hZGVkLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKSxcbiAgICAgICAgdGFyZ2V0UmVsYXRpb25zaGlwOiBzaWJsaW5nLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICAvLyBJZiB0aGUgY2FsbGVyIGl0c2VsZiB3YXMgbm90IHBvcHVsYXRlZCAocmVjb3JkIGRlbGV0ZWQvZmlsdGVyZWQgYmV0d2VlblxuICAgIC8vIHRoZSBsaXN0IGZldGNoIGFuZCB0aGlzIHByZWxvYWQgcmVxdWVzdCksIGZhbGwgYmFjayB0byBwZXItcmVjb3JkIGxvYWRcbiAgICAvLyBzbyB0aGUgY2FsbGVyIGdldHMgYSByZWFsIG5vdC1mb3VuZCBlcnJvciBpbnN0ZWFkIG9mIGEgbWlzbGVhZGluZ1xuICAgIC8vIFwiaGFzbid0IGJlZW4gcHJlbG9hZGVkXCIgdGhyb3cgZnJvbSBsb2FkZWQoKS5cbiAgICBpZiAoIXRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpLmdldFByZWxvYWRlZCgpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlIHwgbnVsbCB8IHVuZGVmaW5lZH0gcmVsYXRpb25zaGlwVmFsdWUgLSBSZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQmFzZSB8IG51bGwgfCB1bmRlZmluZWR9IC0gQXNzaWduZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgc2V0UmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcFZhbHVlKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcERlZmluaXRpb24gPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcERlZmluaXRpb24ocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmICghcmVsYXRpb25zaGlwRGVmaW5pdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHJlbGF0aW9uc2hpcDogJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAocmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHNldCBoYXMtbWFueSByZWxhdGlvbnNoaXAgd2l0aCBzZXRSZWxhdGlvbnNoaXAoKTogJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIHJlbGF0aW9uc2hpcC5zZXRMb2FkZWQocmVsYXRpb25zaGlwVmFsdWUpXG5cbiAgICByZXR1cm4gcmVsYXRpb25zaGlwVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2lnbiBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0F0dHJpYnV0ZXMgfCBDcmVhdGVBdHRyaWJ1dGVzIHwgVXBkYXRlQXR0cmlidXRlcyB8IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59IGF0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzIHRvIGFzc2lnbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYXNzaWduQXR0cmlidXRlcyhhdHRyaWJ1dGVzKSB7XG4gICAgY29uc3QgYXR0cmlidXRlVmFsdWVzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoYXR0cmlidXRlcylcblxuICAgIGZvciAoY29uc3Qga2V5IGluIGF0dHJpYnV0ZVZhbHVlcykge1xuICAgICAgdGhpcy5zZXRBdHRyaWJ1dGUoa2V5LCBhdHRyaWJ1dGVWYWx1ZXNba2V5XSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciByZWxhdGlvbnNoaXAgY2FjaGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIENsZWFycyBjYWNoZWQgcmVsYXRpb25zaGlwIHN0YXRlLlxuICAgKi9cbiAgY2xlYXJSZWxhdGlvbnNoaXBDYWNoZSgpIHtcbiAgICB0aGlzLl9yZWxhdGlvbnNoaXBzID0ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW1hcnkga2V5LlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn0gLSBQcmltYXJ5IGtleSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIHByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIHRoaXMucmVzb3VyY2VDb25maWcoKS5wcmltYXJ5S2V5IHx8IFwiaWRcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbWFyeSBrZXkgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gLSBQcmltYXJ5IGtleSB2YWx1ZS5cbiAgICovXG4gIHByaW1hcnlLZXlWYWx1ZSgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG5cbiAgICByZXR1cm4gcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKHByaW1hcnlLZXksIChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IHRoaXMucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgcHJpbWFyeSBrZXkgJyR7YXR0cmlidXRlTmFtZX0nIG9uICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB2YWx1ZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc2NhbGFyIGlkZW50aXR5IHJlcXVpcmVkIGJ5IHNjYWxhci1vbmx5IGZyb250ZW5kIGZlYXR1cmVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3BlcmF0aW9uIC0gT3BlcmF0aW9uIHJlcXVpcmluZyBhIHNjYWxhciBpZGVudGl0eS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVNjYWxhcn0gLSBTY2FsYXIgcHJpbWFyeS1rZXkgdmFsdWUuXG4gICAqL1xuICBzY2FsYXJQcmltYXJ5S2V5VmFsdWUob3BlcmF0aW9uKSB7XG4gICAgcmV0dXJuIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKHRoaXMucHJpbWFyeUtleVZhbHVlKCksIG9wZXJhdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBpZGVudGl0eSByZXByZXNlbnRlZCBieSB0aGUgbGFzdCBwZXJzaXN0ZWQgZnJvbnRlbmQgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSAtIFBlcnNpc3RlZCBwcmltYXJ5LWtleSB2YWx1ZS5cbiAgICovXG4gIHBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG5cbiAgICByZXR1cm4gcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKHByaW1hcnlLZXksIChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cblxuICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHBlcnNpc3RlZCBwcmltYXJ5IGtleSAnJHthdHRyaWJ1dGVOYW1lfScgb24gJHtNb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHZhbHVlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlYWQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQXR0cmlidXRlIHZhbHVlLlxuICAgKi9cbiAgcmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSB7XG4gICAgaWYgKHRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcyAmJiAhdGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzLmhhcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IEF0dHJpYnV0ZU5vdFNlbGVjdGVkRXJyb3IodGhpcy5jb25zdHJ1Y3Rvci5uYW1lLCBhdHRyaWJ1dGVOYW1lKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhbiBhdHRyaWJ1dGUgdmFsdWUgaXMgY3VycmVudGx5IGxvYWRlZCBvbiB0aGlzIHJlY29yZC4gVXNlZCBieSB0aGVcbiAgICogcHJlbG9hZGVyIHRvIGRlY2lkZSB3aGV0aGVyIGEgcmVsYXRpb25zaGlwIGNhbiBiZSBza2lwcGVkIGJlY2F1c2UgdGhlXG4gICAqIHJlcXVlc3RlZCBjb2x1bW5zIGFyZSBhbHJlYWR5IHByZXNlbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGF0dHJpYnV0ZSBpcyBsb2FkZWQuXG4gICAqL1xuICBoYXNMb2FkZWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkge1xuICAgIGlmICghdGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIHRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcy5oYXMoYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGFuIGFzc29jaWF0aW9uIGNvdW50IGF0dGFjaGVkIGJ5IGAud2l0aENvdW50KC4uLilgLiBDb3VudHNcbiAgICogbGl2ZSBvbiBhIGRlZGljYXRlZCBtYXAgc2VwYXJhdGUgZnJvbSB0aGUgcmVjb3JkJ3MgYXR0cmlidXRlcyBzb1xuICAgKiBhIHZpcnR1YWwgY291bnQgbGlrZSBgdGFza3NDb3VudGAgY2FuJ3Qgc2lsZW50bHkgc2hhZG93IGEgcmVhbFxuICAgKiBjb2x1bW4gb2YgdGhlIHNhbWUgbmFtZS4gUmV0dXJucyB0aGUgYXR0YWNoZWQgdmFsdWUsIG9yIDAgd2hlblxuICAgKiBgLndpdGhDb3VudCguLi4pYCB3YXNuJ3QgcmVxdWVzdGVkIGZvciB0aGlzIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZSwgZS5nLiBgXCJ0YXNrc0NvdW50XCJgIG9yIGEgY3VzdG9tIG5hbWUgZnJvbSBgLndpdGhDb3VudCh7Y3VzdG9tTmFtZTogey4uLn19KWAuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQXR0YWNoZWQgYXNzb2NpYXRpb24gY291bnQsIG9yIHplcm8gd2hlbiBhYnNlbnQuXG4gICAqL1xuICByZWFkQ291bnQoYXR0cmlidXRlTmFtZSkge1xuICAgIHJldHVybiByZWFkUGF5bG9hZEFzc29jaWF0aW9uQ291bnQoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogSW50ZXJuYWwgc2V0dGVyIGNhbGxlZCBieSBgaW5zdGFudGlhdGVGcm9tUmVzcG9uc2VgIHdoZW4gaHlkcmF0aW5nXG4gICAqIGFzc29jaWF0aW9uIGNvdW50cyB0aGF0IHJvZGUgYWxvbmcgd2l0aCB0aGUgcmVjb3JkIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIENvdW50IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRBc3NvY2lhdGlvbkNvdW50KGF0dHJpYnV0ZU5hbWUsIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZEFzc29jaWF0aW9uQ291bnQoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGF0dHJpYnV0ZU5hbWUsIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgYSBwZXItcmVjb3JkIGFiaWxpdHkgcmVzdWx0IGF0dGFjaGVkIGJ5IGAuYWJpbGl0aWVzKC4uLilgLiBUaGVcbiAgICogYmFja2VuZCBldmFsdWF0ZXMgZWFjaCByZXF1ZXN0ZWQgYWN0aW9uIGFnYWluc3QgdGhlIGN1cnJlbnRcbiAgICogYWJpbGl0eSBmb3IgdGhpcyByZWNvcmQgaW5zdGFuY2UgYW5kIHNoaXBzIHRoZSByZXN1bHQgYWxvbmdzaWRlXG4gICAqIHRoZSByZWNvcmQncyBhdHRyaWJ1dGVzLiBSZXR1cm5zIGBmYWxzZWAgd2hlbiB0aGUgYWN0aW9uIHdhc24ndFxuICAgKiByZXF1ZXN0ZWQgKG9yIHRoZSBhYmlsaXR5IGRlbmllZCBpdCksIHNvIFVJIGNvZGUgY2FuIHNhZmVseSBicmFuY2hcbiAgICogb24gYHJlY29yZC5jYW4oXCJ1cGRhdGVcIilgIHdpdGhvdXQgZmlyc3QgY2hlY2tpbmcgd2hldGhlciB0aGVcbiAgICogYWJpbGl0eSB3YXMgbG9hZGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24gbmFtZSwgZS5nLiBgXCJ1cGRhdGVcImAuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlcXVlc3RlZCBhYmlsaXR5IGlzIGFsbG93ZWQuXG4gICAqL1xuICBjYW4oYWN0aW9uKSB7XG4gICAgcmV0dXJuIHJlYWRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogSW50ZXJuYWwgc2V0dGVyIGNhbGxlZCBieSBgaW5zdGFudGlhdGVGcm9tUmVzcG9uc2VgIHdoZW4gaHlkcmF0aW5nXG4gICAqIHBlci1yZWNvcmQgYWJpbGl0eSByZXN1bHRzIHRoYXQgcm9kZSBhbG9uZyB3aXRoIHRoZSByZWNvcmRcbiAgICogcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEFiaWxpdHkgYWN0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gdmFsdWUgLSBXaGV0aGVyIHRoZSBjdXJyZW50IGFiaWxpdHkgcGVybWl0cyB0aGUgYWN0aW9uIG9uIHRoaXMgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRDb21wdXRlZEFiaWxpdHkoYWN0aW9uLCB2YWx1ZSkge1xuICAgIHNldFBheWxvYWRDb21wdXRlZEFiaWxpdHkoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGFjdGlvbiwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhIGNvbnN1bWVyLWRlZmluZWQgdmFsdWUgYXR0YWNoZWQgYnkgYC5xdWVyeURhdGEoLi4uKWAuIFN0b3JlZFxuICAgKiBvbiBhIGRlZGljYXRlZCBtYXAgcmF0aGVyIHRoYW4gYF9hdHRyaWJ1dGVzYCwgc28gYSB2aXJ0dWFsIGFsaWFzXG4gICAqIGxpa2UgYHRhc2tzQ291bnRgIGNhbm5vdCBzaWxlbnRseSBzaGFkb3cgYSByZWFsIGNvbHVtbiBvZiB0aGUgc2FtZVxuICAgKiBuYW1lLiBSZXR1cm5zIGBudWxsYCB3aGVuIG5vIHJlZ2lzdGVyZWQgZm4gcHJvZHVjZWQgdGhhdCBhbGlhcyBmb3JcbiAgICogdGhpcyByZWNvcmQgKGUuZy4gbm8gY2hpbGQgcm93cyBtYXRjaGVkIHRoZSBhZ2dyZWdhdGUpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIHF1ZXJ5RGF0YSBhbGlhcyBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQXR0YWNoZWQgcXVlcnktZGF0YSB2YWx1ZS5cbiAgICovXG4gIHF1ZXJ5RGF0YShuYW1lKSB7XG4gICAgcmV0dXJuIHJlYWRQYXlsb2FkUXVlcnlEYXRhKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIHNldHRlciB1c2VkIGJ5IGBpbnN0YW50aWF0ZUZyb21SZXNwb25zZWAgd2hlbiBoeWRyYXRpbmdcbiAgICogcXVlcnlEYXRhIHZhbHVlcyB0aGF0IHJvZGUgYWxvbmcgd2l0aCB0aGUgcmVjb3JkIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gcXVlcnlEYXRhIGFsaWFzIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQXR0YWNoZWQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldFF1ZXJ5RGF0YShuYW1lLCB2YWx1ZSkge1xuICAgIHNldFBheWxvYWRRdWVyeURhdGEoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIG5hbWUsIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbmV3VmFsdWUgLSBOZXcgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBBc3NpZ25lZCB2YWx1ZS5cbiAgICovXG4gIHNldEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lLCBuZXdWYWx1ZSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzUmVsYXRpb25zaGlwTmFtZSA9IE1vZGVsQ2xhc3MubmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUoYXR0cmlidXRlTmFtZSlcblxuICAgIGlmIChuZXN0ZWRBdHRyaWJ1dGVzUmVsYXRpb25zaGlwTmFtZSkge1xuICAgICAgdGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXNbbmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWVdID0gbmV3VmFsdWVcbiAgICAgIHJldHVybiBuZXdWYWx1ZVxuICAgIH1cblxuICAgIGlmIChNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICB0aGlzLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0cmlidXRlTmFtZSkucXVldWVBdHRhY2gobmV3VmFsdWUpXG4gICAgICByZXR1cm4gbmV3VmFsdWVcbiAgICB9XG5cbiAgICBjb25zdCBwcmV2aW91c1ZhbHVlID0gdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuXG4gICAgdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IG5ld1ZhbHVlXG5cbiAgICBpZiAodGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICB0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMuYWRkKGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuXG4gICAgLy8gT25seSBpbnZhbGlkYXRlIHJlbGF0aW9uc2hpcCBjYWNoZSBlbnRyaWVzIHdob3NlIGZvcmVpZ24ga2V5IG1hdGNoZXMgdGhlIGNoYW5nZWQgYXR0cmlidXRlLlxuICAgIC8vIEJsYW5rZXQtY2xlYXJpbmcgYWxsIHJlbGF0aW9uc2hpcHMgb24gYW55IGF0dHJpYnV0ZSBjaGFuZ2UgZGVzdHJveXMgbmVzdGVkLXNhdmUgc3RhdGVcbiAgICAvLyBhbmQgcHJlbG9hZGVkIGNoaWxkcmVuIHRoZSBjYWxsZXIgbmV2ZXIgYXNrZWQgdG8gaW52YWxpZGF0ZS5cbiAgICBpZiAoIU9iamVjdC5pcyhwcmV2aW91c1ZhbHVlLCBuZXdWYWx1ZSkpIHtcbiAgICAgIHRoaXMuX2ludmFsaWRhdGVSZWxhdGlvbnNoaXBzRm9yQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ld1ZhbHVlXG4gIH1cblxuICAvKipcbiAgICogSW52YWxpZGF0ZXMgYW55IGNhY2hlZCBiZWxvbmdzVG8gcmVsYXRpb25zaGlwIHdob3NlIGZvcmVpZ24ga2V5IG1hdGNoZXMgdGhlXG4gICAqIGNoYW5nZWQgYXR0cmlidXRlLiBIYXNNYW55IC8gaGFzT25lIHJlbGF0aW9uc2hpcHMgYXJlIGxlZnQgdW50b3VjaGVkIGJlY2F1c2VcbiAgICogdGhlaXIgZm9yZWlnbiBrZXkgbGl2ZXMgb24gdGhlIGNoaWxkLCBub3Qgb24gdGhpcyBtb2RlbCwgYW5kIGJsYW5rZXQtY2xlYXJpbmdcbiAgICogdGhlbSB3b3VsZCBkZXN0cm95IG5lc3RlZC1zYXZlIHN0YXRlIGFuZCBwcmVsb2FkZWQgY2hpbGRyZW4gdGhlIGNhbGxlciBuZXZlclxuICAgKiBhc2tlZCB0byBpbnZhbGlkYXRlLlxuICAgKlxuICAgKiBGb3JlaWduIGtleXMgYXJlIGluZmVycmVkIHdoZW4gbm90IGRlY2xhcmVkOiBmb3IgYmVsb25nc1RvIGBwcm9qZWN0SWRgIGlzXG4gICAqIGluZmVycmVkIGZyb20gcmVsYXRpb25zaGlwIG5hbWUgYHByb2plY3RgLiBFeHBsaWNpdCBgZm9yZWlnbktleWAgb24gdGhlXG4gICAqIHJlbGF0aW9uc2hpcCBkZWZpbml0aW9uIHRha2VzIHByZWNlZGVuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUgdGhhdCBjaGFuZ2VkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9pbnZhbGlkYXRlUmVsYXRpb25zaGlwc0ZvckF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSB7XG4gICAgaWYgKCF0aGlzLl9yZWxhdGlvbnNoaXBzIHx8IE9iamVjdC5rZXlzKHRoaXMuX3JlbGF0aW9uc2hpcHMpLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgZGVmaW5pdGlvbnMgPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcERlZmluaXRpb25zKClcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyh0aGlzLl9yZWxhdGlvbnNoaXBzKSkge1xuICAgICAgY29uc3QgZGVmaW5pdGlvbiA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChkZWZpbml0aW9uc1tyZWxhdGlvbnNoaXBOYW1lXSlcblxuICAgICAgaWYgKCFkZWZpbml0aW9uIHx8IGRlZmluaXRpb24udHlwZSAhPT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgICAgY29uc3QgZm9yZWlnbktleSA9IGRlZmluaXRpb24uZm9yZWlnbktleSB8fCBgJHtyZWxhdGlvbnNoaXBOYW1lfUlkYFxuXG4gICAgICBpZiAoZm9yZWlnbktleSA9PT0gYXR0cmlidXRlTmFtZSkge1xuICAgICAgICBkZWxldGUgdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIHBhdGguXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGVyaXZlZCByZXNvdXJjZSBwYXRoLlxuICAgKi9cbiAgc3RhdGljIHJlc291cmNlUGF0aCgpIHtcbiAgICByZXR1cm4gdmFsaWRhdGVGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKHtcbiAgICAgIG1vZGVsTmFtZTogdGhpcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgIHJlc291cmNlUGF0aDogZGVmYXVsdEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgodGhpcylcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29tbWFuZCBuYW1lLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDb21tYW5kVHlwZX0gY29tbWFuZFR5cGUgLSBDb21tYW5kIHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUmVzb2x2ZWQgY29tbWFuZCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGNvbW1hbmROYW1lKGNvbW1hbmRUeXBlKSB7XG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSB0aGlzLnJlc291cmNlQ29uZmlnKClcbiAgICBjb25zdCBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzID0gcmVzb3VyY2VDb25maWcuYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyB8fCBbXVxuICAgIGNvbnN0IGJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IHJlc291cmNlQ29uZmlnLmJ1aWx0SW5NZW1iZXJDb21tYW5kcyB8fCBbXVxuICAgIGNvbnN0IGNvbW1hbmRzID0gcmVzb3VyY2VDb25maWcuY29tbWFuZHMgfHwgW11cbiAgICBjb25zdCBpc0V4cG9zZWQgPSBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzLmluY2x1ZGVzKGNvbW1hbmRUeXBlKSB8fCBidWlsdEluTWVtYmVyQ29tbWFuZHMuaW5jbHVkZXMoY29tbWFuZFR5cGUpIHx8IGNvbW1hbmRzLmluY2x1ZGVzKGNvbW1hbmRUeXBlKVxuICAgIGNvbnN0IGNvbW1hbmROYW1lID0gaXNFeHBvc2VkID8gaW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKGNvbW1hbmRUeXBlKSkgOiBjb21tYW5kVHlwZVxuXG4gICAgcmV0dXJuIHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlQ29tbWFuZE5hbWUoe1xuICAgICAgY29tbWFuZE5hbWUsXG4gICAgICBjb21tYW5kVHlwZSxcbiAgICAgIG1vZGVsTmFtZTogdGhpcy5nZXRNb2RlbE5hbWUoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgY3VzdG9tIGNvbW1hbmQgcGF5bG9hZCBhcmd1bWVudHMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzIC0gQ29tbWFuZCBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ29tbWFuZCBwYXlsb2FkLlxuICAgKi9cbiAgc3RhdGljIG5vcm1hbGl6ZUN1c3RvbUNvbW1hbmRQYXlsb2FkQXJndW1lbnRzKGFyZ3MpIHtcbiAgICBpZiAoYXJncy5sZW5ndGggPT09IDApIHJldHVybiB7fVxuICAgIGlmIChhcmdzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgY29uc3QgcGF5bG9hZCA9IGFyZ3NbMF1cbiAgICAgIGlmIChwYXlsb2FkID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHt9XG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2YgcGF5bG9hZCAhPT0gXCJvYmplY3RcIiB8fCBwYXlsb2FkID09PSBudWxsKSB7XG4gICAgICAgIHJldHVybiB7YXJnMTogcGF5bG9hZH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocGF5bG9hZClcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQYXlsb2FkLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXIgfCBzdHJpbmcgfCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7fVxuXG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGFyZ3MubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgICBwYXlsb2FkW2Bhcmcke2luZGV4ICsgMX1gXSA9IGFyZ3NbaW5kZXhdXG4gICAgfVxuXG4gICAgcmV0dXJuIHBheWxvYWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBtb2RlbCBuYW1lLCBwcmVmZXJyaW5nIGFuIGV4cGxpY2l0IGBzdGF0aWMgbW9kZWxOYW1lYCBkZWNsYXJhdGlvblxuICAgKiBvdmVyIHRoZSBKYXZhU2NyaXB0IGNsYXNzIGAubmFtZWAgcHJvcGVydHkuIFRoaXMgYWxsb3dzIG1pbmlmaWVkIGJ1aWxkcyB0b1xuICAgKiBwcmVzZXJ2ZSBjb3JyZWN0IG1vZGVsIG5hbWVzIHdpdGhvdXQgcmVseWluZyBvbiBga2VlcF9jbGFzc25hbWVzYC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgbW9kZWwgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRNb2RlbE5hbWUoKSB7XG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSB0aGlzLnJlc291cmNlQ29uZmlnKClcbiAgICBjb25zdCBtb2RlbE5hbWUgPSByZXNvdXJjZUNvbmZpZz8ubW9kZWxOYW1lXG5cbiAgICByZXR1cm4gKHR5cGVvZiBtb2RlbE5hbWUgPT09IFwic3RyaW5nXCIgJiYgbW9kZWxOYW1lLmxlbmd0aCA+IDApID8gbW9kZWxOYW1lIDogdGhpcy5uYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25maWd1cmUgdHJhbnNwb3J0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWd9IGNvbmZpZyAtIEZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgY29uZmlndXJlVHJhbnNwb3J0KGNvbmZpZykge1xuICAgIGlmICghY29uZmlnIHx8IHR5cGVvZiBjb25maWcgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInVybFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy51cmwgPSBjb25maWcudXJsXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwic2hhcmVkXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNoYXJlZCA9IGNvbmZpZy5zaGFyZWRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ3ZWJzb2NrZXRDbGllbnRcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50ID0gY29uZmlnLndlYnNvY2tldENsaWVudFxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcIndlYnNvY2tldFVybFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRVcmwgPSBjb25maWcud2Vic29ja2V0VXJsXG4gICAgICAvLyBSZXNldCBjYWNoZWQgaW50ZXJuYWwgY2xpZW50IHNvIHRoZSBuZXcgVVJMIHRha2VzIGVmZmVjdCBvbiBuZXh0IHN1YnNjcmliZVxuICAgICAgcmVzZXRJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwicmVxdWVzdEhlYWRlcnNcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdEhlYWRlcnMgPSBjb25maWcucmVxdWVzdEhlYWRlcnNcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJyZXF1ZXN0Q29udGV4dFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0Q29udGV4dCA9IGNvbmZpZy5yZXF1ZXN0Q29udGV4dFxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInRpbWVvdXRcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZW91dCA9IGNvbmZpZy50aW1lb3V0XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwic2lnbmFsXCIpKSB7XG4gICAgICBpZiAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zaWduYWwgIT09IGNvbmZpZy5zaWduYWwpIHtcbiAgICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zaWduYWwgPSBjb25maWcuc2lnbmFsXG4gICAgICAgIHJlc2V0SW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInRpbWVab25lXCIpKSB7XG4gICAgICBpZiAoY29uZmlnLnRpbWVab25lID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgZGVsZXRlIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZVpvbmVcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZVpvbmUgPSBjb25maWcudGltZVpvbmVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJzZXNzaW9uU3RvcmVcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2Vzc2lvblN0b3JlID0gY29uZmlnLnNlc3Npb25TdG9yZVxuICAgICAgLy8gUmVzZXQgY2FjaGVkIGludGVybmFsIGNsaWVudCBzbyB0aGUgbmV3IHNlc3Npb25TdG9yZSBpcyBwaWNrZWQgdXAuXG4gICAgICByZXNldEludGVybmFsV2Vic29ja2V0Q2xpZW50KClcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJvZmZsaW5lU3luY1wiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5vZmZsaW5lU3luYyA9IGNvbmZpZy5vZmZsaW5lU3luY1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb25uZWN0IHRoZSBpbnRlcm5hbCBXZWJTb2NrZXQgYW5kIGVuYWJsZSBhdXRvLXJlY29ubmVjdC5cbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyLCBzaWduYWw/OiBBYm9ydFNpZ25hbH19IFtvcHRpb25zXSAtIFN0YXJ0dXAgY29udHJvbHMgY29tcG9zZWQgd2l0aCB0aGUgY29uZmlndXJlZCB0cmFuc3BvcnQgY29udHJvbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29ubmVjdGVkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNvbm5lY3RXZWJzb2NrZXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgY2xpZW50ID0gcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KClcblxuICAgIGlmICghY2xpZW50KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJjb25uZWN0V2Vic29ja2V0IHJlcXVpcmVzIGNvbmZpZ3VyZVRyYW5zcG9ydCh7d2Vic29ja2V0VXJsfSlcIilcbiAgICB9XG5cbiAgICBhd2FpdCBjbGllbnQuY29ubmVjdChmcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKG9wdGlvbnMpKVxuICB9XG5cbiAgLyoqXG4gICAqIERpc2Nvbm5lY3QgdGhlIGludGVybmFsIFdlYlNvY2tldCBhbmQgZGlzYWJsZSBhdXRvLXJlY29ubmVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbG9zZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZGlzY29ubmVjdFdlYnNvY2tldCgpIHtcbiAgICBpZiAoIWludGVybmFsV2Vic29ja2V0Q2xpZW50KSByZXR1cm5cblxuICAgIGNvbnN0IGNsaWVudCA9IGludGVybmFsV2Vic29ja2V0Q2xpZW50XG5cbiAgICBkZXRhY2hJbnRlcm5hbFdlYnNvY2tldENsaWVudChjbGllbnQpXG4gICAgYXdhaXQgY2xpZW50LmRpc2Nvbm5lY3RBbmRTdG9wUmVjb25uZWN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyB1bnRpbCBxdWV1ZWQgYW5kIGFjdGl2ZSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgcmVxdWVzdHMgZmluaXNoLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxJZGxlV2FpdEFyZ3N9IFthcmdzXSAtIFdhaXQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0cmFuc3BvcnQgaXMgaWRsZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB3YWl0Rm9ySWRsZShhcmdzID0ge30pIHtcbiAgICBjb25zdCB7cXVpZXRNcyA9IDAsIHRpbWVvdXQ6IHRpbWVvdXRNcyA9IDUwMDAsIC4uLnJlc3RBcmdzfSA9IGFyZ3NcbiAgICBjb25zdCByZXN0QXJnS2V5cyA9IE9iamVjdC5rZXlzKHJlc3RBcmdzKVxuXG4gICAgaWYgKHJlc3RBcmdLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biB3YWl0Rm9ySWRsZSBhcmdzOiAke3Jlc3RBcmdLZXlzLmpvaW4oXCIsIFwiKX1gKVxuICAgIH1cblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHF1aWV0TXMpIHx8IHF1aWV0TXMgPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIHdhaXRGb3JJZGxlIHF1aWV0TXMgdG8gYmUgYSBub24tbmVnYXRpdmUgbnVtYmVyLCBnb3Q6ICR7cXVpZXRNc31gKVxuICAgIH1cblxuICAgIGF3YWl0IHRpbWVvdXQoXG4gICAgICB7dGltZW91dDogdGltZW91dE1zLCBlcnJvck1lc3NhZ2U6IFwiVGltZWQgb3V0IHdhaXRpbmcgZm9yIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB0byBiZWNvbWUgaWRsZVwifSxcbiAgICAgIGFzeW5jICgpID0+IGF3YWl0IHdhaXRGb3JGcm9udGVuZE1vZGVsVHJhbnNwb3J0SWRsZShxdWlldE1zKVxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjdXJyZW50IFdlYlNvY2tldCBjb25uZWN0aW9uIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7e2Rpc2Nvbm5lY3RlZFNpbmNlOiBudW1iZXIgfCBudWxsLCBoYXNDbGllbnQ6IGJvb2xlYW4sIGlzT3BlbjogYm9vbGVhbiwgbGlzdGVuZXJDb3VudDogbnVtYmVyfX0gLSBTbmFwc2hvdCBvZiB0aGUgbWFuYWdlZCB3ZWJzb2NrZXQgY29ubmVjdGlvbiBzdGF0ZS5cbiAgICovXG4gIHN0YXRpYyB3ZWJzb2NrZXRTdGF0ZSgpIHtcbiAgICBpZiAoIWludGVybmFsV2Vic29ja2V0Q2xpZW50KSB7XG4gICAgICByZXR1cm4ge2Rpc2Nvbm5lY3RlZFNpbmNlOiBudWxsLCBoYXNDbGllbnQ6IGZhbHNlLCBpc09wZW46IGZhbHNlLCBsaXN0ZW5lckNvdW50OiAwfVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAuLi5pbnRlcm5hbFdlYnNvY2tldENsaWVudC5zdGF0ZSgpLFxuICAgICAgaGFzQ2xpZW50OiB0cnVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENsb3NlIHRoZSByYXcgV2ViU29ja2V0IHdpdGhvdXQgZGlzYWJsaW5nIGF1dG8tcmVjb25uZWN0LiBVc2VkIGJ5IHRlc3RzIHRvXG4gICAqIHNpbXVsYXRlIGFuIHVuZXhwZWN0ZWQgbmV0d29yayBkcm9wIGFuZCB2ZXJpZnkgcmVjb25uZWN0aW9uIGJlaGF2aW9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBzb2NrZXQgaGFzIGNsb3NlZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBkcm9wV2Vic29ja2V0KCkge1xuICAgIGlmICghaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQpIHJldHVyblxuXG4gICAgYXdhaXQgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQuZHJvcENvbm5lY3Rpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgZ2xvYmFsIG1ldGFkYXRhIG9uIHRoZSBXZWJTb2NrZXQgY29ubmVjdGlvbi4gU2VudCB0byB0aGUgc2VydmVyIGltbWVkaWF0ZWx5XG4gICAqIG92ZXIgV2ViU29ja2V0IGFuZCBleHBvc2VkIHRvIFdlYlNvY2tldC1ib3JuZSByZXF1ZXN0cyBhcyByZXF1ZXN0IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gTWV0YWRhdGEga2V5LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIE1ldGFkYXRhIHZhbHVlIChudWxsIHRvIGNsZWFyKS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgc2V0V2Vic29ja2V0TWV0YWRhdGEoa2V5LCB2YWx1ZSkge1xuICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgIGlmICghY2xpZW50IHx8IHR5cGVvZiBjbGllbnQuc2V0TWV0YWRhdGEgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuXG5cbiAgICBjbGllbnQuc2V0TWV0YWRhdGEoa2V5LCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBPcGVucyBhIG1hbmFnZWQgY29ubmVjdGlvbiB0aGF0IGF1dG8tb3BlbnMsIGF1dG8tY2xvc2VzLCBhbmRcbiAgICogYXV0by1yZWNvbm5lY3RzIGJhc2VkIG9uIGBzaG91bGRDb25uZWN0KClgIGFuZCBgcGFyYW1zKClgLlxuICAgKiBDYWxsIGBoYW5kbGUuc3luYygpYCB3aGVuZXZlciB0aGUgaW5wdXRzIHRoYXQgZHJpdmUgdGhvc2VcbiAgICogZnVuY3Rpb25zIGNoYW5nZSAoZS5nLiBjdXJyZW50LXVzZXIgc2lnbi1pbi9vdXQpLiBUaGUgaGFuZGxlXG4gICAqIHJldHJpZXMgd2hlbiB0aGUgV1MgY2xpZW50IGlzbid0IHJlYWR5IGFuZCByZW9wZW5zIG9uIGNsb3NlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29ubmVjdGlvblR5cGUgLSBDb25uZWN0aW9uIGNsYXNzIG5hbWUgcmVnaXN0ZXJlZCBvbiB0aGUgc2VydmVyLlxuICAgKiBAcGFyYW0ge3tzaG91bGRDb25uZWN0OiAoKSA9PiBib29sZWFuLCBwYXJhbXM6ICgpID0+IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgc2lnbmFsPzogQWJvcnRTaWduYWwsIG9uTWVzc2FnZT86IChib2R5OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZH19IG9wdGlvbnMgLSBDb25uZWN0aW9uIGxpZmVjeWNsZSwgY2FuY2VsbGF0aW9uLCBhbmQgcGF5bG9hZCBjYWxsYmFja3MuXG4gICAqIEByZXR1cm5zIHt7c3luYzogKCkgPT4gdm9pZCwgY2xvc2U6ICgpID0+IHZvaWR9fSAtIEhhbmRsZSB1c2VkIHRvIHJlc3luYyBvciBjbG9zZSB0aGUgbWFuYWdlZCBjb25uZWN0aW9uLlxuICAgKi9cbiAgc3RhdGljIG9wZW5NYW5hZ2VkQ29ubmVjdGlvbihjb25uZWN0aW9uVHlwZSwgb3B0aW9ucykge1xuICAgIC8qKlxuICAgICAqIENvbm5lY3Rpb24uXG4gICAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgIGxldCBjb25uZWN0aW9uID0gbnVsbFxuICAgIGxldCBjbG9zZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIFJldHJ5IHRpbWVyLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGx9ICovXG4gICAgbGV0IHJldHJ5VGltZXIgPSBudWxsXG4gICAgbGV0IGxhc3RQYXJhbXNKc29uID0gXCJcIlxuICAgIGNvbnN0IGNvbnRyb2xzID0gZnJvbnRlbmRNb2RlbFdlYnNvY2tldFN0YXJ0dXBDb250cm9scyh7c2lnbmFsOiBvcHRpb25zLnNpZ25hbH0pXG4gICAgY29uc3QgY2xlYXJSZXRyeVRpbWVyID0gKCkgPT4ge1xuICAgICAgaWYgKHJldHJ5VGltZXIgPT09IG51bGwpIHJldHVyblxuXG4gICAgICBnbG9iYWxUaGlzLmNsZWFyVGltZW91dChyZXRyeVRpbWVyKVxuICAgICAgcmV0cnlUaW1lciA9IG51bGxcbiAgICB9XG5cbiAgICBjb25zdCBjbG9zZSA9ICgpID0+IHtcbiAgICAgIGlmIChjbG9zZWQpIHJldHVyblxuXG4gICAgICBjbG9zZWQgPSB0cnVlXG4gICAgICBjbGVhclJldHJ5VGltZXIoKVxuICAgICAgY29udHJvbHMuc2lnbmFsPy5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgY2xvc2UpXG4gICAgICBpZiAoY29ubmVjdGlvbiAmJiAhY29ubmVjdGlvbi5pc0Nsb3NlZCgpKSBjb25uZWN0aW9uLmNsb3NlKClcbiAgICAgIGNvbm5lY3Rpb24gPSBudWxsXG4gICAgfVxuXG4gICAgY29uc3Qgc3luYyA9ICgpID0+IHtcbiAgICAgIGlmIChjbG9zZWQpIHJldHVyblxuXG4gICAgICBpZiAoIW9wdGlvbnMuc2hvdWxkQ29ubmVjdCgpKSB7XG4gICAgICAgIGNsZWFyUmV0cnlUaW1lcigpXG4gICAgICAgIGlmIChjb25uZWN0aW9uICYmICFjb25uZWN0aW9uLmlzQ2xvc2VkKCkpIGNvbm5lY3Rpb24uY2xvc2UoKVxuICAgICAgICBjb25uZWN0aW9uID0gbnVsbFxuICAgICAgICBsYXN0UGFyYW1zSnNvbiA9IFwiXCJcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5leHRQYXJhbXMgPSBvcHRpb25zLnBhcmFtcygpXG4gICAgICBjb25zdCBuZXh0UGFyYW1zSnNvbiA9IEpTT04uc3RyaW5naWZ5KG5leHRQYXJhbXMpXG5cbiAgICAgIC8vIEFscmVhZHkgY29ubmVjdGVkIHdpdGggc2FtZSBwYXJhbXMg4oCUIG5vdGhpbmcgdG8gZG8uXG4gICAgICBpZiAoY29ubmVjdGlvbiAmJiAhY29ubmVjdGlvbi5pc0Nsb3NlZCgpICYmIG5leHRQYXJhbXNKc29uID09PSBsYXN0UGFyYW1zSnNvbikgcmV0dXJuXG5cbiAgICAgIC8vIENvbm5lY3RlZCBidXQgcGFyYW1zIGNoYW5nZWQg4oCUIHNlbmQgdXBkYXRlIG1lc3NhZ2UuXG4gICAgICAvLyBHdWFyZCB3aXRoIHRyeS9jYXRjaDogdGhlIGNvbm5lY3Rpb24gaGFuZGxlIHN0YXlzIGxpdmUgZHVyaW5nXG4gICAgICAvLyByZWNvbm5lY3QgYnV0IHRoZSB1bmRlcmx5aW5nIHNvY2tldCBtYXkgYmUgY2xvc2VkLlxuICAgICAgaWYgKGNvbm5lY3Rpb24gJiYgIWNvbm5lY3Rpb24uaXNDbG9zZWQoKSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbm5lY3Rpb24uc2VuZE1lc3NhZ2UobmV4dFBhcmFtcylcbiAgICAgICAgICBsYXN0UGFyYW1zSnNvbiA9IG5leHRQYXJhbXNKc29uXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIGNvbm5lY3Rpb24gPSBudWxsXG4gICAgICAgICAgbGFzdFBhcmFtc0pzb24gPSBcIlwiXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gV1MgY2xpZW50IG5vdCByZWFkeSDigJQgcmV0cnkuIENoZWNrIHRoZSBhY3R1YWwgY2xpZW50ICh3aGljaFxuICAgICAgLy8gbWF5IGJlIGFuIGluamVjdGVkIHdlYnNvY2tldENsaWVudCkgaW5zdGVhZCBvZiB3ZWJzb2NrZXRTdGF0ZSgpXG4gICAgICAvLyB3aGljaCBvbmx5IHJlZmxlY3RzIHRoZSBpbnRlcm5hbCBjbGllbnQuXG4gICAgICBjb25zdCBjbGllbnQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgfHwgcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkpXG5cbiAgICAgIGlmICghY2xpZW50IHx8ICFjbGllbnQuaXNPcGVuKCkpIHtcbiAgICAgICAgaWYgKHJldHJ5VGltZXIgPT09IG51bGwpIHtcbiAgICAgICAgICByZXRyeVRpbWVyID0gZ2xvYmFsVGhpcy5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIHJldHJ5VGltZXIgPSBudWxsXG4gICAgICAgICAgICBzeW5jKClcbiAgICAgICAgICB9LCAyNTApXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGxhc3RQYXJhbXNKc29uID0gbmV4dFBhcmFtc0pzb25cbiAgICAgIGNvbm5lY3Rpb24gPSBjbGllbnQub3BlbkNvbm5lY3Rpb24oY29ubmVjdGlvblR5cGUsIHtcbiAgICAgICAgcGFyYW1zOiBuZXh0UGFyYW1zLFxuICAgICAgICBvbk1lc3NhZ2U6IG9wdGlvbnMub25NZXNzYWdlLFxuICAgICAgICBvbkNsb3NlOiAoKSA9PiB7XG4gICAgICAgICAgaWYgKGNvbm5lY3Rpb24/LmlzQ2xvc2VkKCkpIHtcbiAgICAgICAgICAgIGNvbm5lY3Rpb24gPSBudWxsXG4gICAgICAgICAgICBsYXN0UGFyYW1zSnNvbiA9IFwiXCJcbiAgICAgICAgICAgIHN5bmMoKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBjb250cm9scy5zaWduYWw/LmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBjbG9zZSwge29uY2U6IHRydWV9KVxuXG4gICAgaWYgKGNvbnRyb2xzLnNpZ25hbD8uYWJvcnRlZCkge1xuICAgICAgY2xvc2UoKVxuICAgIH0gZWxzZSB7XG4gICAgICBzeW5jKClcbiAgICB9XG5cbiAgICByZXR1cm4ge3N5bmMsIGNsb3NlfVxuICB9XG5cbiAgLyoqXG4gICAqIE9wZW5zIGEgMToxIGBXZWJzb2NrZXRDb25uZWN0aW9uYCBvZiB0aGUgZ2l2ZW4gdHlwZS4gVGhpblxuICAgKiBjb252ZW5pZW5jZSB3cmFwcGVyIGFyb3VuZCB0aGUgaW50ZXJuYWwgV1MgY2xpZW50J3NcbiAgICogYG9wZW5Db25uZWN0aW9uYC4gQXBwcyB1c2UgdGhpcyBmb3IgcGVyLXNlc3Npb24gc3RhdGUvbWVzc2FnaW5nXG4gICAqIHRoYXQgZG9lc24ndCBmaXQgdGhlIHB1Yi9zdWIgQ2hhbm5lbCBtb2RlbCAobG9jYWxlLCBwcmVzZW5jZSkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25uZWN0aW9uVHlwZSAtIE5hbWUgdGhlIHNlcnZlciByZWdpc3RlcmVkIHRoZSBjbGFzcyB1bmRlci5cbiAgICogQHBhcmFtIHt7cGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCB0aW1lb3V0TXM/OiBudW1iZXIsIHNpZ25hbD86IEFib3J0U2lnbmFsLCBvbkNvbm5lY3Q/OiAoKSA9PiB2b2lkLCBvbk1lc3NhZ2U/OiAoYm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHZvaWQsIG9uRGlzY29ubmVjdD86ICgpID0+IHZvaWQsIG9uUmVzdW1lPzogKCkgPT4gdm9pZCwgb25DbG9zZT86IChyZWFzb246IHN0cmluZykgPT4gdm9pZH19IFtvcHRpb25zXSAtIENvbm5lY3Rpb24gb3B0aW9ucywgcmVhZGluZXNzIGNvbnRyb2xzLCBhbmQgZXZlbnQgaGFuZGxlcnMuIENvbm5lY3QgdGhlIGNsaWVudCBmaXJzdDsgdGhlIHRpbWVvdXQgY292ZXJzIHNlcnZlci1jb25maXJtZWQgcmVhZGluZXNzIGFuZCB0aGUgc2lnbmFsIGNhbmNlbHMgcmVhZGluZXNzIHdpdGhvdXQgZW50ZXJpbmcgdGhlIHdpcmUgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3tyZWFkeTogUHJvbWlzZTx2b2lkPiwgY2xvc2U6ICgpID0+IHZvaWR9fSAtIFdlYnNvY2tldCBjb25uZWN0aW9uIGhhbmRsZS5cbiAgICovXG4gIHN0YXRpYyBvcGVuV2Vic29ja2V0Q29ubmVjdGlvbihjb25uZWN0aW9uVHlwZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50IHx8IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpKVxuXG4gICAgaWYgKCFjbGllbnQgfHwgdHlwZW9mIGNsaWVudC5vcGVuQ29ubmVjdGlvbiAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJvcGVuV2Vic29ja2V0Q29ubmVjdGlvbiByZXF1aXJlcyBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldFVybH0pXCIpXG4gICAgfVxuXG4gICAgY29uc3Qge3NpZ25hbCwgdGltZW91dE1zLCAuLi5jb25uZWN0aW9uT3B0aW9uc30gPSBvcHRpb25zXG5cbiAgICByZXR1cm4gY2xpZW50Lm9wZW5Db25uZWN0aW9uKGNvbm5lY3Rpb25UeXBlLCB7XG4gICAgICAuLi5jb25uZWN0aW9uT3B0aW9ucyxcbiAgICAgIC4uLmZyb250ZW5kTW9kZWxXZWJzb2NrZXRTdGFydHVwQ29udHJvbHMoe3NpZ25hbCwgdGltZW91dE1zfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFN1YnNjcmliZXMgdG8gYSBwdWIvc3ViIGBXZWJzb2NrZXRDaGFubmVsYC4gVGhpbiB3cmFwcGVyIGFyb3VuZFxuICAgKiB0aGUgaW50ZXJuYWwgY2xpZW50J3MgYHN1YnNjcmliZUNoYW5uZWxgLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbFR5cGUgLSBDaGFubmVsIGNsYXNzIG5hbWUgcmVnaXN0ZXJlZCBvbiB0aGUgc2VydmVyLlxuICAgKiBAcGFyYW0ge3twYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHRpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWwsIG9uTWVzc2FnZT86IChib2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gdm9pZCwgb25EaXNjb25uZWN0PzogKCkgPT4gdm9pZCwgb25SZXN1bWU/OiAoKSA9PiB2b2lkLCBvbkNsb3NlPzogKHJlYXNvbjogc3RyaW5nKSA9PiB2b2lkfX0gW29wdGlvbnNdIC0gQ2hhbm5lbCBvcHRpb25zLCBzdGFydHVwIGNvbnRyb2xzLCBhbmQgZXZlbnQgaGFuZGxlcnMuIFRoZSB0aW1lb3V0IGNvdmVycyBjb25uZWN0IGFuZCBzZXJ2ZXItY29uZmlybWVkIHJlYWRpbmVzcyBvbmx5OyB0aGUgc2lnbmFsIGNhbmNlbHMgc3RhcnR1cCB3aXRob3V0IGVudGVyaW5nIHRoZSB3aXJlIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt7cmVhZHk6IFByb21pc2U8dm9pZD4sIGNsb3NlOiAoKSA9PiB2b2lkfX0gLSBXZWJzb2NrZXQgY2hhbm5lbCBoYW5kbGUgZnJvbSB0aGUgY29uZmlndXJlZCBjbGllbnQuXG4gICAqL1xuICBzdGF0aWMgc3Vic2NyaWJlV2Vic29ja2V0Q2hhbm5lbChjaGFubmVsVHlwZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50IHx8IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpKVxuXG4gICAgaWYgKCFjbGllbnQgfHwgdHlwZW9mIGNsaWVudC5zdWJzY3JpYmVDaGFubmVsICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN1YnNjcmliZVdlYnNvY2tldENoYW5uZWwgcmVxdWlyZXMgY29uZmlndXJlVHJhbnNwb3J0KHt3ZWJzb2NrZXRVcmx9KVwiKVxuICAgIH1cblxuICAgIGNvbnN0IHtwYXJhbXMsIHNpZ25hbCwgdGltZW91dE1zLCAuLi5jaGFubmVsT3B0aW9uc30gPSBvcHRpb25zXG4gICAgY29uc3QgcmVxdWVzdENvbnRleHQgPSBmcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoKVxuICAgIGNvbnN0IHNjb3BlZFBhcmFtcyA9IG1lcmdlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0LCBwYXJhbXMgPT09IHVuZGVmaW5lZCA/IHt9IDogcGFyYW1zKVxuICAgIGNvbnN0IHN0YXJ0dXBDb250cm9scyA9IGZyb250ZW5kTW9kZWxXZWJzb2NrZXRTdGFydHVwQ29udHJvbHMoe3NpZ25hbCwgdGltZW91dE1zfSlcbiAgICBjb25zdCBzY29wZWRQYXJhbXNPcHRpb24gPSBwYXJhbXMgPT09IHVuZGVmaW5lZCAmJiBPYmplY3Qua2V5cyhyZXF1ZXN0Q29udGV4dCkubGVuZ3RoID09PSAwXG4gICAgICA/IHt9XG4gICAgICA6IHtwYXJhbXM6IHNjb3BlZFBhcmFtc31cbiAgICBjb25zdCBoYW5kbGUgPSBjbGllbnQuc3Vic2NyaWJlQ2hhbm5lbChjaGFubmVsVHlwZSwgey4uLmNoYW5uZWxPcHRpb25zLCAuLi5zY29wZWRQYXJhbXNPcHRpb24sIC4uLnN0YXJ0dXBDb250cm9sc30pXG5cbiAgICBpZiAodHlwZW9mIGNsaWVudC5jb25uZWN0ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHZvaWQgY2xpZW50LmNvbm5lY3Qoc3RhcnR1cENvbnRyb2xzKS5jYXRjaCgoKSA9PiBoYW5kbGUuY2xvc2UoKSlcbiAgICB9XG5cbiAgICByZXR1cm4gaGFuZGxlXG4gIH1cblxuICAvKipcbiAgICogSW5zdGFsbHMgV2ViU29ja2V0IGxpZmVjeWNsZSBob29rcyBvbiBnbG9iYWxUaGlzIGZvciBzeXN0ZW0gdGVzdCBhY2Nlc3MuXG4gICAqIFRlc3RzIGNhbiBjYWxsIGBnbG9iYWxUaGlzLl9fdmVsb2Npb3VzX3dlYnNvY2tldF9ob29rcy5jb25uZWN0KClgIGV0Yy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgaW5zdGFsbFdlYnNvY2tldFRlc3RIb29rcygpIHtcbiAgICBpZiAodHlwZW9mIGdsb2JhbFRoaXMgPT09IFwidW5kZWZpbmVkXCIpIHJldHVyblxuXG4gICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGdsb2JhbFRoaXMpLl9fdmVsb2Npb3VzX3dlYnNvY2tldF9ob29rcyA9IHtcbiAgICAgIGNvbm5lY3Q6ICgpID0+IHRoaXMuY29ubmVjdFdlYnNvY2tldCgpLFxuICAgICAgZGlzY29ubmVjdDogKCkgPT4gdGhpcy5kaXNjb25uZWN0V2Vic29ja2V0KCksXG4gICAgICBkcm9wOiAoKSA9PiB0aGlzLmRyb3BXZWJzb2NrZXQoKSxcbiAgICAgIHN0YXRlOiAoKSA9PiB0aGlzLndlYnNvY2tldFN0YXRlKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRyaWJ1dGVzIGZyb20gcmVzcG9uc2UuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7b2JqZWN0fSByZXNwb25zZSAtIFJlc3BvbnNlIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAtIEF0dHJpYnV0ZXMgZnJvbSBwYXlsb2FkLlxuICAgKi9cbiAgc3RhdGljIGF0dHJpYnV0ZXNGcm9tUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICBjb25zdCBtb2RlbERhdGEgPSB0aGlzLm1vZGVsRGF0YUZyb21SZXNwb25zZShyZXNwb25zZSlcblxuICAgIHJldHVybiBtb2RlbERhdGEuYXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbW9kZWwgZGF0YSBmcm9tIHJlc3BvbnNlLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge29iamVjdH0gcmVzcG9uc2UgLSBSZXNwb25zZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7e2FiaWxpdGllczogUmVjb3JkPHN0cmluZywgYm9vbGVhbj4sIGF0dGFjaG1lbnRPd25lcjoge3JlY29yZElkOiBzdHJpbmcsIHJlY29yZFR5cGU6IHN0cmluZ30gfCBudWxsLCBhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBhc3NvY2lhdGlvbkNvdW50czogUmVjb3JkPHN0cmluZywgbnVtYmVyPiwgcXVlcnlEYXRhOiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzOiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBzZWxlY3RlZEF0dHJpYnV0ZXM6IFNldDxzdHJpbmc+fX0gLSBBdHRyaWJ1dGVzLCBhdHRhY2htZW50IG93bmVyLCBwcmVsb2FkZWQgcmVsYXRpb25zaGlwcywgYXNzb2NpYXRpb24gY291bnRzLCBxdWVyeURhdGEsIGFiaWxpdGllcywgYW5kIHNlbGVjdGVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzdGF0aWMgbW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgaWYgKCFyZXNwb25zZSB8fCB0eXBlb2YgcmVzcG9uc2UgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgb2JqZWN0IHJlc3BvbnNlIGJ1dCBnb3Q6ICR7cmVzcG9uc2V9YClcbiAgICB9XG5cbiAgICAvLyBOYXJyb3dzIHRoZSByZXNwb25zZSBvYmplY3QgdG8gdGhlIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCB2YWx1ZSBtYXAuXG4gICAgY29uc3QgcmVzcG9uc2VPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChyZXNwb25zZSlcblxuICAgIC8qKlxuICAgICAqIERlZmluZXMgbW9kZWxEYXRhLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqL1xuICAgIGxldCBtb2RlbERhdGFcblxuICAgIGlmIChyZXNwb25zZU9iamVjdC5tb2RlbCAmJiB0eXBlb2YgcmVzcG9uc2VPYmplY3QubW9kZWwgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIC8vIE5hcnJvd3MgdGhlIG5lc3RlZCBtb2RlbCBwYXlsb2FkIHRvIHRoZSBmcm9udGVuZC1tb2RlbCB2YWx1ZSBtYXAuXG4gICAgICBtb2RlbERhdGEgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChyZXNwb25zZU9iamVjdC5tb2RlbClcbiAgICB9IGVsc2UgaWYgKHJlc3BvbnNlT2JqZWN0LmF0dHJpYnV0ZXMgJiYgdHlwZW9mIHJlc3BvbnNlT2JqZWN0LmF0dHJpYnV0ZXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIC8vIE5hcnJvd3MgdGhlIG5lc3RlZCBhdHRyaWJ1dGVzIHBheWxvYWQgdG8gdGhlIGZyb250ZW5kLW1vZGVsIHZhbHVlIG1hcC5cbiAgICAgIG1vZGVsRGF0YSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKHJlc3BvbnNlT2JqZWN0LmF0dHJpYnV0ZXMpXG4gICAgfSBlbHNlIHtcbiAgICAgIG1vZGVsRGF0YSA9IHJlc3BvbnNlT2JqZWN0XG4gICAgfVxuXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKHsuLi5tb2RlbERhdGF9KVxuICAgIGNvbnN0IHByZWxvYWRlZFJlbGF0aW9uc2hpcHMgPSBpc1BsYWluT2JqZWN0KGF0dHJpYnV0ZXNbUFJFTE9BREVEX1JFTEFUSU9OU0hJUFNfS0VZXSlcbiAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoYXR0cmlidXRlc1tQUkVMT0FERURfUkVMQVRJT05TSElQU19LRVldKVxuICAgICAgOiB7fVxuICAgIGNvbnN0IGFzc29jaWF0aW9uQ291bnRzID0gaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzW0FTU09DSUFUSU9OX0NPVU5UU19LRVldKVxuICAgICAgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovIChhdHRyaWJ1dGVzW0FTU09DSUFUSU9OX0NPVU5UU19LRVldKVxuICAgICAgOiB7fVxuICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IGlzUGxhaW5PYmplY3QoYXR0cmlidXRlc1tRVUVSWV9EQVRBX0tFWV0pXG4gICAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKGF0dHJpYnV0ZXNbUVVFUllfREFUQV9LRVldKVxuICAgICAgOiB7fVxuICAgIGNvbnN0IGFiaWxpdGllcyA9IGlzUGxhaW5PYmplY3QoYXR0cmlidXRlc1tBQklMSVRJRVNfS0VZXSlcbiAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuPn0gKi8gKGF0dHJpYnV0ZXNbQUJJTElUSUVTX0tFWV0pXG4gICAgICA6IHt9XG4gICAgY29uc3Qgc2VsZWN0ZWRBdHRyaWJ1dGVzRnJvbVBheWxvYWQgPSBBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXNbU0VMRUNURURfQVRUUklCVVRFU19LRVldKVxuICAgICAgPyBuZXcgU2V0KC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChhdHRyaWJ1dGVzW1NFTEVDVEVEX0FUVFJJQlVURVNfS0VZXSkuZmlsdGVyKChhdHRyaWJ1dGVOYW1lKSA9PiB0eXBlb2YgYXR0cmlidXRlTmFtZSA9PT0gXCJzdHJpbmdcIikpXG4gICAgICA6IG51bGxcbiAgICBjb25zdCBhdHRhY2htZW50T3duZXJQYXlsb2FkID0gYXR0cmlidXRlc1tBVFRBQ0hNRU5UX09XTkVSX0tFWV1cbiAgICBsZXQgYXR0YWNobWVudE93bmVyID0gbnVsbFxuXG4gICAgaWYgKGF0dGFjaG1lbnRPd25lclBheWxvYWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KGF0dGFjaG1lbnRPd25lclBheWxvYWQpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEV4cGVjdGVkICR7QVRUQUNITUVOVF9PV05FUl9LRVl9IHRvIGJlIGFuIG9iamVjdGApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGF0dGFjaG1lbnRPd25lck9iamVjdCA9IC8qKiBAdHlwZSB7e3JlY29yZElkPzogdW5rbm93biwgcmVjb3JkVHlwZT86IHVua25vd259fSAqLyAoYXR0YWNobWVudE93bmVyUGF5bG9hZClcblxuICAgICAgYXR0YWNobWVudE93bmVyID0ge1xuICAgICAgICByZWNvcmRJZDogZm9yY2VkTm9uQmxhbmtTdHJpbmcoYXR0YWNobWVudE93bmVyT2JqZWN0LnJlY29yZElkLCBgJHtBVFRBQ0hNRU5UX09XTkVSX0tFWX0ucmVjb3JkSWRgKSxcbiAgICAgICAgcmVjb3JkVHlwZTogZm9yY2VkTm9uQmxhbmtTdHJpbmcoYXR0YWNobWVudE93bmVyT2JqZWN0LnJlY29yZFR5cGUsIGAke0FUVEFDSE1FTlRfT1dORVJfS0VZfS5yZWNvcmRUeXBlYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBkZWxldGUgYXR0cmlidXRlc1tBVFRBQ0hNRU5UX09XTkVSX0tFWV1cbiAgICBkZWxldGUgYXR0cmlidXRlc1tQUkVMT0FERURfUkVMQVRJT05TSElQU19LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbU0VMRUNURURfQVRUUklCVVRFU19LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbQVNTT0NJQVRJT05fQ09VTlRTX0tFWV1cbiAgICBkZWxldGUgYXR0cmlidXRlc1tRVUVSWV9EQVRBX0tFWV1cbiAgICBkZWxldGUgYXR0cmlidXRlc1tBQklMSVRJRVNfS0VZXVxuXG4gICAgY29uc3Qgc2VsZWN0ZWRBdHRyaWJ1dGVzID0gc2VsZWN0ZWRBdHRyaWJ1dGVzRnJvbVBheWxvYWQgfHwgbmV3IFNldChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKSlcblxuICAgIHJldHVybiB7YWJpbGl0aWVzLCBhdHRhY2htZW50T3duZXIsIGF0dHJpYnV0ZXMsIGFzc29jaWF0aW9uQ291bnRzLCBxdWVyeURhdGEsIHByZWxvYWRlZFJlbGF0aW9uc2hpcHMsIHNlbGVjdGVkQXR0cmlidXRlc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IHByZWxvYWRlZCByZWxhdGlvbnNoaXBzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcHJlbG9hZGVkUmVsYXRpb25zaGlwcyAtIFByZWxvYWRlZCByZWxhdGlvbnNoaXAgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYXBwbHlQcmVsb2FkZWRSZWxhdGlvbnNoaXBzKG1vZGVsLCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKSB7XG4gICAgZm9yIChjb25zdCBbcmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwUGF5bG9hZF0gb2YgT2JqZWN0LmVudHJpZXMocHJlbG9hZGVkUmVsYXRpb25zaGlwcykpIHtcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMucmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXApIHtcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHJlbGF0aW9uc2hpcFBheWxvYWQpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfSBwYXlsb2FkIHRvIGJlIGFuIGFycmF5YClcbiAgICAgICAgfVxuXG4gICAgICAgIC8qKiBAdHlwZSB7QXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+fSAqL1xuICAgICAgICBjb25zdCByZWxhdGVkTW9kZWxzID0gW11cblxuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHJlbGF0aW9uc2hpcFBheWxvYWQpIHtcbiAgICAgICAgICBjb25zdCByZWxhdGVkTW9kZWwgPSB0aGlzLmluc3RhbnRpYXRlUmVsYXRpb25zaGlwVmFsdWUoZW50cnksIHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICAgICAgICBpZiAoIShyZWxhdGVkTW9kZWwgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsQmFzZSkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX0gcGF5bG9hZCBlbnRyeSB0byBpbnN0YW50aWF0ZSBhIGZyb250ZW5kIG1vZGVsYClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZWxhdGVkTW9kZWxzLnB1c2gocmVsYXRlZE1vZGVsKVxuICAgICAgICB9XG5cbiAgICAgICAgcmVsYXRpb25zaGlwLnNldExvYWRlZChyZWxhdGVkTW9kZWxzKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShyZWxhdGlvbnNoaXBQYXlsb2FkKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9IHBheWxvYWQgdG8gYmUgc2luZ3VsYXJgKVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZWxhdGVkTW9kZWwgPSB0aGlzLmluc3RhbnRpYXRlUmVsYXRpb25zaGlwVmFsdWUocmVsYXRpb25zaGlwUGF5bG9hZCwgdGFyZ2V0TW9kZWxDbGFzcylcblxuICAgICAgaWYgKHJlbGF0ZWRNb2RlbCAhPSB1bmRlZmluZWQgJiYgIShyZWxhdGVkTW9kZWwgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsQmFzZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfSBwYXlsb2FkIHRvIGluc3RhbnRpYXRlIGEgZnJvbnRlbmQgbW9kZWxgKVxuICAgICAgfVxuXG4gICAgICByZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHJlbGF0ZWRNb2RlbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnN0YW50aWF0ZSByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlbGF0aW9uc2hpcFBheWxvYWQgLSBSZWxhdGlvbnNoaXAgcGF5bG9hZCB2YWx1ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBudWxsfSB0YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gSW5zdGFudGlhdGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBpbnN0YW50aWF0ZVJlbGF0aW9uc2hpcFZhbHVlKHJlbGF0aW9uc2hpcFBheWxvYWQsIHRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICBpZiAoIXRhcmdldE1vZGVsQ2xhc3MpIHJldHVybiByZWxhdGlvbnNoaXBQYXlsb2FkXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcFBheWxvYWQgfHwgdHlwZW9mIHJlbGF0aW9uc2hpcFBheWxvYWQgIT09IFwib2JqZWN0XCIpIHJldHVybiByZWxhdGlvbnNoaXBQYXlsb2FkXG5cbiAgICByZXR1cm4gdGFyZ2V0TW9kZWxDbGFzcy5pbnN0YW50aWF0ZUZyb21SZXNwb25zZShyZWxhdGlvbnNoaXBQYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zdGFudGlhdGUgZnJvbSByZXNwb25zZS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgSW5zdGFuY2VUeXBlPFQ+fSByZXNwb25zZSAtIFJlc3BvbnNlIHBheWxvYWQsIG9yIGFuIGFscmVhZHktaHlkcmF0ZWQgaW5zdGFuY2Ugb2YgdGhpcyBjbGFzcy5cbiAgICogQHJldHVybnMge0luc3RhbmNlVHlwZTxUPn0gLSBOZXcgbW9kZWwgaW5zdGFuY2UsIG9yIHRoZSBzYW1lIGluc3RhbmNlIHVuY2hhbmdlZCBpZiBpdCB3YXMgYWxyZWFkeSBoeWRyYXRlZC5cbiAgICovXG4gIHN0YXRpYyBpbnN0YW50aWF0ZUZyb21SZXNwb25zZShyZXNwb25zZSkge1xuICAgIC8vIElkZW1wb3RlbnQ6IGlmIGEgY2FsbGVyIGhhbmRzIHVzIGFuIGFscmVhZHktaHlkcmF0ZWQgaW5zdGFuY2Ugb2YgdGhpc1xuICAgIC8vIGNsYXNzIChub3cgY29tbW9uIGJlY2F1c2UgdGhlIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgYXV0by1zZXJpYWxpemVzXG4gICAgLy8gYmFja2VuZCBgUmVjb3JkYCBpbnN0YW5jZXMgcmV0dXJuZWQgZnJvbSBjdXN0b20gY29tbWFuZHMgYW5kIHRoZVxuICAgIC8vIHRyYW5zcG9ydCBkZXNlcmlhbGl6ZXIgaHlkcmF0ZXMgdGhlbSBpbnRvIG1vZGVscyBiZWZvcmUgdGhlIGNhbGwgc2l0ZVxuICAgIC8vIHNlZXMgdGhlIHJlc3BvbnNlKSwgcmV0dXJuIGl0IGFzLWlzLiBXaXRob3V0IHRoaXMsIGNvZGUgdGhhdCBoYXNcbiAgICAvLyBoaXN0b3JpY2FsbHkgd3JhcHBlZCBjdXN0b20tY29tbWFuZCByZXNwb25zZXMgaW5cbiAgICAvLyBgTW9kZWwuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UocmVzcG9uc2UuZmllbGQpYCB3b3VsZCBzcHJlYWQgdGhlIGxpdmVcbiAgICAvLyBtb2RlbCBpbnN0YW5jZSBpbnRvIGEgbmV3IGNvbnN0cnVjdG9yIGNhbGwgYW5kIHByb2R1Y2UgYSBicm9rZW4gbW9kZWxcbiAgICAvLyB3aXRoIGludGVybmFsIHN0YXRlIGtleXMgcHJvbW90ZWQgdG8gYXR0cmlidXRlcy5cbiAgICBpZiAocmVzcG9uc2UgaW5zdGFuY2VvZiB0aGlzKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtJbnN0YW5jZVR5cGU8VD59ICovIChyZXNwb25zZSlcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlbERhdGEgPSB0aGlzLm1vZGVsRGF0YUZyb21SZXNwb25zZShyZXNwb25zZSlcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gbW9kZWxEYXRhLmF0dHJpYnV0ZXNcbiAgICBjb25zdCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzID0gbW9kZWxEYXRhLnByZWxvYWRlZFJlbGF0aW9uc2hpcHNcbiAgICBjb25zdCBhc3NvY2lhdGlvbkNvdW50cyA9IG1vZGVsRGF0YS5hc3NvY2lhdGlvbkNvdW50c1xuICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IG1vZGVsRGF0YS5xdWVyeURhdGFcbiAgICBjb25zdCBhYmlsaXRpZXMgPSBtb2RlbERhdGEuYWJpbGl0aWVzXG4gICAgY29uc3QgYXR0YWNobWVudE93bmVyID0gbW9kZWxEYXRhLmF0dGFjaG1lbnRPd25lclxuICAgIGNvbnN0IHNlbGVjdGVkQXR0cmlidXRlcyA9IG1vZGVsRGF0YS5zZWxlY3RlZEF0dHJpYnV0ZXNcbiAgICBjb25zdCByZWNlaXZlciA9IC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHRoaXMpXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPikgPT4gSW5zdGFuY2VUeXBlPFQ+fSAqLyAocmVjZWl2ZXIpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcyhhdHRyaWJ1dGVzKVxuICAgIG1vZGVsLl9hdHRhY2htZW50T3duZXIgPSBhdHRhY2htZW50T3duZXJcbiAgICBtb2RlbC5fc2VsZWN0ZWRBdHRyaWJ1dGVzID0gc2VsZWN0ZWRBdHRyaWJ1dGVzID8gbmV3IFNldChzZWxlY3RlZEF0dHJpYnV0ZXMpIDogbnVsbFxuXG4gICAgdGhpcy5hcHBseVByZWxvYWRlZFJlbGF0aW9uc2hpcHMobW9kZWwsIHByZWxvYWRlZFJlbGF0aW9uc2hpcHMpXG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXNzb2NpYXRpb25Db3VudHMgfHwge30pKSB7XG4gICAgICBtb2RlbC5fc2V0QXNzb2NpYXRpb25Db3VudChhdHRyaWJ1dGVOYW1lLCBOdW1iZXIodmFsdWUpIHx8IDApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHF1ZXJ5RGF0YSB8fCB7fSkpIHtcbiAgICAgIG1vZGVsLl9zZXRRdWVyeURhdGEobmFtZSwgdmFsdWUpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbYWN0aW9uLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYWJpbGl0aWVzIHx8IHt9KSkge1xuICAgICAgbW9kZWwuX3NldENvbXB1dGVkQWJpbGl0eShhY3Rpb24sIEJvb2xlYW4odmFsdWUpKVxuICAgIH1cblxuICAgIG1vZGVsLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuICAgIG1vZGVsLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzID0gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhtb2RlbC5hdHRyaWJ1dGVzKCkpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge251bWJlciB8IHN0cmluZ30gaWQgLSBSZWNvcmQgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+Pn0gLSBSZXNvbHZlZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kKGlkKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kKGlkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gQXR0cmlidXRlIG1hdGNoIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPiB8IG51bGw+fSAtIEZvdW5kIG1vZGVsIG9yIG51bGwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZEJ5KGNvbmRpdGlvbnMpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpbmRCeShjb25kaXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieSBvciBmYWlsLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBBdHRyaWJ1dGUgbWF0Y2ggY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+Pn0gLSBGb3VuZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kQnlPckZhaWwoY29uZGl0aW9ucykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZEJ5T3JGYWlsKGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBhcnJheS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPltdPn0gLSBMb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHRvQXJyYXkoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS50b0FycmF5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD5bXT59IC0gTG9hZGVkIG1vZGVsIGluc3RhbmNlcy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsb2FkKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkubG9hZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhbGwuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIuXG4gICAqL1xuICBzdGF0aWMgYWxsKCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXJlLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBSb290LW1vZGVsIHdoZXJlIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCB3aGVyZSBjb25kaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIHdoZXJlKGNvbmRpdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLndoZXJlKGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBqb2lucy5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gam9pbnMgLSBSZWxhdGlvbnNoaXAgZGVzY3JpcHRvciBqb2lucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIGpvaW5zLlxuICAgKi9cbiAgc3RhdGljIGpvaW5zKGpvaW5zKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5qb2lucyhqb2lucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxpbWl0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gTWF4aW11bSBudW1iZXIgb2YgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIGxpbWl0LlxuICAgKi9cbiAgc3RhdGljIGxpbWl0KHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5saW1pdCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9mZnNldC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIE51bWJlciBvZiByZWNvcmRzIHRvIHNraXAuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCBvZmZzZXQuXG4gICAqL1xuICBzdGF0aWMgb2Zmc2V0KHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5vZmZzZXQodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYWdlLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtudW1iZXJ9IHBhZ2VOdW1iZXIgLSAxLWJhc2VkIHBhZ2UgbnVtYmVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggcGFnZSBhcHBsaWVkLlxuICAgKi9cbiAgc3RhdGljIHBhZ2UocGFnZU51bWJlcikge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkucGFnZShwYWdlTnVtYmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVyIHBhZ2UuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBOdW1iZXIgb2YgcmVjb3JkcyBwZXIgcGFnZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIHBhZ2Ugc2l6ZS5cbiAgICovXG4gIHN0YXRpYyBwZXJQYWdlKHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5wZXJQYWdlKHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY291bnQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE51bWJlciBvZiBsb2FkZWQgbW9kZWwgaW5zdGFuY2VzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNvdW50KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuY291bnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIENsYXNzLWxldmVsIGhvb2sgZmlyZWQgd2hlbiBhbnkgcmVjb3JkIG9mIHRoaXMgbW9kZWwgaXMgY3JlYXRlZC5cbiAgICogU3Vic2NyaWJlLXRpbWUgYXV0aG9yaXphdGlvbiBvbmx5IOKAlCBvbmNlIGEgc3Vic2NyaXB0aW9uIGlzXG4gICAqIGFjY2VwdGVkLCBmdXR1cmUgYGNyZWF0ZWAgZXZlbnRzIGZvciB0aGlzIG1vZGVsIGFyZSBkZWxpdmVyZWRcbiAgICogd2l0aG91dCByZS1jaGVja2luZyBwZXItcmVjb3JkIHZpc2liaWxpdHkuIFF1ZXJ5IG9wdGlvbnMgY2FuIHN0aWxsXG4gICAqIG5hcnJvdyB3aGljaCBldmVudHMgcmVhY2ggdGhpcyBjYWxsYmFjay5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZSwgbW9kZWw6IEZyb250ZW5kTW9kZWxCYXNlfSkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHJlY29yZCBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIG9uQ3JlYXRlKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHQsIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQodGhpcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24odGhpcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrLCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfVxuXG4gICAgcmV0dXJuIGF3YWl0IHN1Yi5yZWdpc3RlckNsYXNzQ2FsbGJhY2soc3ViLmNsYXNzQ3JlYXRlQ2FsbGJhY2tzLCBlbnRyeSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGFzcy1sZXZlbCBob29rIGZpcmVkIHdoZW4gYW55IHJlY29yZCBvZiB0aGlzIG1vZGVsIGlzIHVwZGF0ZWQuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWUsIG1vZGVsOiBGcm9udGVuZE1vZGVsQmFzZX0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciByZWNvcmQgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBvblVwZGF0ZShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0LCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKHRoaXMsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKHRoaXMsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBlbnRyeSA9IHtjYWxsYmFjaywgLi4uZXZlbnRPcHRpb25zUGF5bG9hZH1cblxuICAgIHJldHVybiBhd2FpdCBzdWIucmVnaXN0ZXJDbGFzc0NhbGxiYWNrKHN1Yi5jbGFzc1VwZGF0ZUNhbGxiYWNrcywgZW50cnkpXG4gIH1cblxuICAvKipcbiAgICogQ2xhc3MtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIGFueSByZWNvcmQgb2YgdGhpcyBtb2RlbCBpcyBkZXN0cm95ZWQuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWV9KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gQWNjZXB0ZWQgZm9yIEFQSSBzeW1tZXRyeTsgZGVzdHJveSBldmVudHMgY2FycnkgaWRzIG9ubHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIG9uRGVzdHJveShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXNzZXJ0Tm9EZXN0cm95RXZlbnRGaWx0ZXIodGhpcywgb3B0aW9ucylcblxuICAgIGNvbnN0IHtyZXF1ZXN0Q29udGV4dH0gPSBmcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZCh0aGlzLCBvcHRpb25zKVxuICAgIGNvbnN0IHN1YiA9IGVuc3VyZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbih0aGlzLCBmcm9udGVuZE1vZGVsRXZlbnRSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2t9XG5cbiAgICByZXR1cm4gYXdhaXQgc3ViLnJlZ2lzdGVyQ2xhc3NDYWxsYmFjayhzdWIuY2xhc3NEZXN0cm95Q2FsbGJhY2tzLCBlbnRyeSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YW5jZS1sZXZlbCBob29rIGZpcmVkIHdoZW4gVEhJUyByZWNvcmQgaXMgdXBkYXRlZC4gVGhlXG4gICAqIGluc3RhbmNlJ3MgYXR0cmlidXRlcyBhcmUgYXV0by1tZXJnZWQgd2l0aCB0aGUgYnJvYWRjYXN0IHBheWxvYWRcbiAgICogYmVmb3JlIHRoZSBjYWxsYmFjayBydW5zLCBzbyBjYWxsZXJzIGNhbiByZWFkIGZyZXNoIHZhbHVlcyB2aWFcbiAgICogYHRoaXMuc29tZUF0dHIoKWAgd2l0aG91dCByZS1mZXRjaGluZy5cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZSwgbW9kZWw6IEZyb250ZW5kTW9kZWxCYXNlfSkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEV2ZW50IHF1ZXJ5IG9yIHJlY29yZCBwcm9qZWN0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgb25VcGRhdGUoY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHQsIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQoTW9kZWxDbGFzcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oTW9kZWxDbGFzcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGlkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIHRoaXMucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2ssIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9XG4gICAgY29uc3QgbGlzdGVuZXIgPSBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGlkLCB0aGlzKVxuXG4gICAgbGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzLmFkZChlbnRyeSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzdWIuZW5zdXJlU3Vic2NyaWJlZCgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCAoY3VycmVudCkgPT4gY3VycmVudC51cGRhdGVDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCAoY3VycmVudCkgPT4gY3VycmVudC51cGRhdGVDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSW5zdGFuY2UtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIFRISVMgcmVjb3JkIGlzIGRlc3Ryb3llZC5cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2lkOiBzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZX0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBBY2NlcHRlZCBmb3IgQVBJIHN5bW1ldHJ5OyBkZXN0cm95IGV2ZW50cyBjYXJyeSBpZHMgb25seS5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBhc3luYyBvbkRlc3Ryb3koY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcblxuICAgIGFzc2VydE5vRGVzdHJveUV2ZW50RmlsdGVyKE1vZGVsQ2xhc3MsIG9wdGlvbnMpXG5cbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQoTW9kZWxDbGFzcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24oTW9kZWxDbGFzcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGlkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIHRoaXMucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2t9XG4gICAgY29uc3QgbGlzdGVuZXIgPSBlbnN1cmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGlkLCB0aGlzKVxuXG4gICAgbGlzdGVuZXIuZGVzdHJveUNhbGxiYWNrcy5hZGQoZW50cnkpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3ViLmVuc3VyZVN1YnNjcmliZWQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgKGN1cnJlbnQpID0+IGN1cnJlbnQuZGVzdHJveUNhbGxiYWNrcy5kZWxldGUoZW50cnkpKVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgcmVtb3ZlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJFbnRyeShzdWIsIChjdXJyZW50KSA9PiBjdXJyZW50LmRlc3Ryb3lDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwbHVjay5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7Li4uKHN0cmluZyB8IHN0cmluZ1tdIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pil9IGNvbHVtbnMgLSBQbHVjayBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFBsdWNrZWQgdmFsdWVzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHBsdWNrKC4uLmNvbHVtbnMpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLnBsdWNrKC4uLmNvbHVtbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWFyY2guXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW4gLSBDb2x1bW4gb3IgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7XCJlcVwiIHwgXCJsaWtlXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCI+XCIgfCBcIj49XCIgfCBcIjxcIiB8IFwiPD1cIn0gb3BlcmF0b3IgLSBTZWFyY2ggb3BlcmF0b3IuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU2VhcmNoIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBzZWFyY2ggZmlsdGVyLlxuICAgKi9cbiAgc3RhdGljIHNlYXJjaChwYXRoLCBjb2x1bW4sIG9wZXJhdG9yLCB2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuc2VhcmNoKHBhdGgsIGNvbHVtbiwgb3BlcmF0b3IsIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmFuc2Fjay5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSYW5zYWNrLXN0eWxlIHBhcmFtcyBoYXNoLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBSYW5zYWNrIGZpbHRlcnMgYXBwbGllZC5cbiAgICovXG4gIHN0YXRpYyByYW5zYWNrKHBhcmFtcykge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkucmFuc2FjayhwYXJhbXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzb3J0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHN0cmluZ1tdW10gfCBbc3RyaW5nLCBzdHJpbmddIHwgQXJyYXk8W3N0cmluZywgc3RyaW5nXT4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBzb3J0IC0gU29ydCBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBzb3J0IGRlZmluaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIHNvcnQoc29ydCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuc29ydChzb3J0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3JkZXIuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgc3RyaW5nW11bXSB8IFtzdHJpbmcsIHN0cmluZ10gfCBBcnJheTxbc3RyaW5nLCBzdHJpbmddPiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHNvcnQgLSBTb3J0IGRlZmluaXRpb24ocykuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlciB3aXRoIHNvcnQgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgb3JkZXIoc29ydCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkub3JkZXIoc29ydClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdyb3VwLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IGdyb3VwIC0gR3JvdXAgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggZ3JvdXAgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgZ3JvdXAoZ3JvdXApIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLmdyb3VwKGdyb3VwKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzdGluY3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFt2YWx1ZV0gLSBXaGV0aGVyIHRvIHJlcXVlc3QgZGlzdGluY3Qgcm93cy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggZGlzdGluY3QgZmxhZy5cbiAgICovXG4gIHN0YXRpYyBkaXN0aW5jdCh2YWx1ZSA9IHRydWUpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLmRpc3RpbmN0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcXVlcnkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIuXG4gICAqL1xuICBzdGF0aWMgcXVlcnkoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAobmV3IEZyb250ZW5kTW9kZWxRdWVyeSh7bW9kZWxDbGFzczogdGhpc30pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJlbG9hZC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQ+fSBwcmVsb2FkIC0gUHJlbG9hZCBncmFwaC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSB3aXRoIHByZWxvYWQuXG4gICAqL1xuICBzdGF0aWMgcHJlbG9hZChwcmVsb2FkKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAodGhpcy5xdWVyeSgpLnByZWxvYWQocHJlbG9hZCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWxlY3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdIHwgc3RyaW5nPiB8IHN0cmluZyB8IHN0cmluZ1tdfSBzZWxlY3QgLSBNb2RlbC1hd2FyZSBhdHRyaWJ1dGUgc2VsZWN0IG1hcCBvciByb290LW1vZGVsIHNob3J0aGFuZC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSB3aXRoIHNlbGVjdGVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzdGF0aWMgc2VsZWN0KHNlbGVjdCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gKi8gKHRoaXMucXVlcnkoKS5zZWxlY3Qoc2VsZWN0KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdHMgZXh0cmEuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdIHwgc3RyaW5nPiB8IHN0cmluZyB8IHN0cmluZ1tdfSBzZWxlY3QgLSBFeHRyYSBhdHRyaWJ1dGVzIHRvIGxvYWQgaW4gYWRkaXRpb24gdG8gdGhlIGRlZmF1bHRzLCBrZXllZCBieSBtb2RlbCBuYW1lIG9yIHJvb3QtbW9kZWwgc2hvcnRoYW5kLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IHdpdGggZXh0cmEgc2VsZWN0ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIHN0YXRpYyBzZWxlY3RzRXh0cmEoc2VsZWN0KSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAqLyAodGhpcy5xdWVyeSgpLnNlbGVjdHNFeHRyYShzZWxlY3QpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmlyc3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBGaXJzdCBtb2RlbCBvciBudWxsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpcnN0KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmlyc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGFzdC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPiB8IG51bGw+fSAtIExhc3QgbW9kZWwgb3IgbnVsbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsYXN0KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkubGFzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG9yIGluaXRpYWxpemUgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIEF0dHJpYnV0ZSBtYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIEV4aXN0aW5nIG9yIGluaXRpYWxpemVkIG1vZGVsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRPckluaXRpYWxpemVCeShjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgY3JlYXRlIGJ5LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBBdHRyaWJ1dGUgbWF0Y2ggY29uZGl0aW9ucy5cbiAgICogQHBhcmFtIHsobW9kZWw6IEluc3RhbmNlVHlwZTxUPikgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWR9IFtjYWxsYmFja10gLSBPcHRpb25hbCBjYWxsYmFjayBiZWZvcmUgc2F2ZSB3aGVuIGNyZWF0ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRXhpc3Rpbmcgb3IgbmV3bHkgY3JlYXRlZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kT3JDcmVhdGVCeShjb25kaXRpb25zLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZE9yQ3JlYXRlQnkoY29uZGl0aW9ucywgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzXG4gICAqIEB0aGlzIHtNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDcmVhdGVBdHRyaWJ1dGVzRm9yPEluc3RhbmNlVHlwZTxNb2RlbENsYXNzPj59IFthdHRyaWJ1dGVzXSAtIEluaXRpYWwgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+Pn0gLSBQZXJzaXN0ZWQgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY3JlYXRlKGF0dHJpYnV0ZXMpIHtcbiAgICBjb25zdCByZWNlaXZlciA9IC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHRoaXMpXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7bmV3IChhdHRyaWJ1dGVzPzogRnJvbnRlbmRNb2RlbENyZWF0ZUF0dHJpYnV0ZXNGb3I8SW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+PikgPT4gSW5zdGFuY2VUeXBlPE1vZGVsQ2xhc3M+fSAqLyAocmVjZWl2ZXIpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcyhhdHRyaWJ1dGVzKVxuXG4gICAgYXdhaXQgbW9kZWwuc2F2ZSgpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2VydCBmaW5kIGJ5IGNvbmRpdGlvbnMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gZmluZEJ5IGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFzc2VydEZpbmRCeUNvbmRpdGlvbnMoY29uZGl0aW9ucykge1xuICAgIGFzc2VydEZpbmRCeUNvbmRpdGlvbnNTaGFwZShjb25kaXRpb25zKVxuXG4gICAgT2JqZWN0LmtleXMoY29uZGl0aW9ucykuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgICBhc3NlcnREZWZpbmVkRmluZEJ5Q29uZGl0aW9uVmFsdWUoY29uZGl0aW9uc1trZXldLCBrZXkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hdGNoZXMgZmluZCBieSBjb25kaXRpb25zLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIENhbmRpZGF0ZSBtb2RlbC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBNYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBtb2RlbCBtYXRjaGVzIGFsbCBjb25kaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIG1hdGNoZXNGaW5kQnlDb25kaXRpb25zKG1vZGVsLCBjb25kaXRpb25zKSB7XG4gICAgY29uc3QgbW9kZWxBdHRyaWJ1dGVzID0gbW9kZWwuYXR0cmlidXRlcygpXG5cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhjb25kaXRpb25zKSkge1xuICAgICAgY29uc3QgZXhwZWN0ZWRWYWx1ZSA9IGNvbmRpdGlvbnNba2V5XVxuICAgICAgY29uc3QgYWN0dWFsVmFsdWUgPSBtb2RlbEF0dHJpYnV0ZXNba2V5XVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShleHBlY3RlZFZhbHVlKSkge1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhY3R1YWxWYWx1ZSkpIHtcbiAgICAgICAgICBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKCFleHBlY3RlZFZhbHVlLnNvbWUoKGVudHJ5KSA9PiB0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZW50cnkpKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKCF0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgY29uZGl0aW9uIHZhbHVlIG1hdGNoZXMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFjdHVhbFZhbHVlIC0gQWN0dWFsIG1vZGVsIHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBleHBlY3RlZFZhbHVlIC0gRXhwZWN0ZWQgZmluZCBjb25kaXRpb24gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWVzIG1hdGNoLlxuICAgKi9cbiAgc3RhdGljIGZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkge1xuICAgIGlmIChleHBlY3RlZFZhbHVlID09PSBudWxsKSB7XG4gICAgICByZXR1cm4gYWN0dWFsVmFsdWUgPT09IG51bGxcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShleHBlY3RlZFZhbHVlKSkge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGFjdHVhbFZhbHVlKSkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgaWYgKGFjdHVhbFZhbHVlLmxlbmd0aCAhPT0gZXhwZWN0ZWRWYWx1ZS5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBleHBlY3RlZFZhbHVlLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgICBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbFZhbHVlW2luZGV4XSwgZXhwZWN0ZWRWYWx1ZVtpbmRleF0pKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICBpZiAoZXhwZWN0ZWRWYWx1ZSAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgaWYgKCFhY3R1YWxWYWx1ZSB8fCB0eXBlb2YgYWN0dWFsVmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShhY3R1YWxWYWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFjdHVhbE9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoYWN0dWFsVmFsdWUpXG4gICAgICBjb25zdCBleHBlY3RlZE9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZXhwZWN0ZWRWYWx1ZSlcbiAgICAgIGNvbnN0IGFjdHVhbEtleXMgPSBPYmplY3Qua2V5cyhhY3R1YWxPYmplY3QpXG4gICAgICBjb25zdCBleHBlY3RlZEtleXMgPSBPYmplY3Qua2V5cyhleHBlY3RlZE9iamVjdClcblxuICAgICAgaWYgKGFjdHVhbEtleXMubGVuZ3RoICE9PSBleHBlY3RlZEtleXMubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBleHBlY3RlZEtleXMpIHtcbiAgICAgICAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoYWN0dWFsT2JqZWN0LCBrZXkpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuZmluZEJ5Q29uZGl0aW9uVmFsdWVNYXRjaGVzKGFjdHVhbE9iamVjdFtrZXldLCBleHBlY3RlZE9iamVjdFtrZXldKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgaWYgKGFjdHVhbFZhbHVlID09PSBleHBlY3RlZFZhbHVlKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmZpbmRCeVByaW1pdGl2ZVZhbHVlc01hdGNoKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieSBwcmltaXRpdmUgdmFsdWVzIG1hdGNoLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhY3R1YWxWYWx1ZSAtIEFjdHVhbCBtb2RlbCB2YWx1ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXhwZWN0ZWRWYWx1ZSAtIEV4cGVjdGVkIGZpbmQgY29uZGl0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHByaW1pdGl2ZSB2YWx1ZXMgbWF0Y2ggYWZ0ZXIgc2FmZSBjb2VyY2lvbi5cbiAgICovXG4gIHN0YXRpYyBmaW5kQnlQcmltaXRpdmVWYWx1ZXNNYXRjaChhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkge1xuICAgIGlmIChhY3R1YWxWYWx1ZSBpbnN0YW5jZW9mIERhdGUgJiYgdHlwZW9mIGV4cGVjdGVkVmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFeHBlY3RlZFZhbHVlID0gbm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlKGV4cGVjdGVkVmFsdWUsIHt0aW1lWm9uZTogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKCl9KVxuXG4gICAgICBpZiAobm9ybWFsaXplZEV4cGVjdGVkVmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAgIHJldHVybiBhY3R1YWxWYWx1ZS50b0lTT1N0cmluZygpID09PSBub3JtYWxpemVkRXhwZWN0ZWRWYWx1ZS50b0lTT1N0cmluZygpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhY3R1YWxWYWx1ZS50b0lTT1N0cmluZygpID09PSBleHBlY3RlZFZhbHVlXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhY3R1YWxWYWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiBleHBlY3RlZFZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgcmV0dXJuIGFjdHVhbFZhbHVlID09PSBleHBlY3RlZFZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICB9XG5cbiAgICBpZiAoYWN0dWFsVmFsdWUgaW5zdGFuY2VvZiBEYXRlICYmIGV4cGVjdGVkVmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICByZXR1cm4gYWN0dWFsVmFsdWUudG9JU09TdHJpbmcoKSA9PT0gZXhwZWN0ZWRWYWx1ZS50b0lTT1N0cmluZygpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhY3R1YWxWYWx1ZSA9PT0gXCJudW1iZXJcIiAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIHRoaXMuZmluZEJ5TnVtZXJpY1N0cmluZ01hdGNoZXNOdW1iZXIoZXhwZWN0ZWRWYWx1ZSwgYWN0dWFsVmFsdWUpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhY3R1YWxWYWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgZXhwZWN0ZWRWYWx1ZSA9PT0gXCJudW1iZXJcIikge1xuICAgICAgcmV0dXJuIHRoaXMuZmluZEJ5TnVtZXJpY1N0cmluZ01hdGNoZXNOdW1iZXIoYWN0dWFsVmFsdWUsIGV4cGVjdGVkVmFsdWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5IG51bWVyaWMgc3RyaW5nIG1hdGNoZXMgbnVtYmVyLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gbnVtZXJpY1N0cmluZyAtIE51bWVyaWMgc3RyaW5nIHZhbHVlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZXhwZWN0ZWROdW1iZXIgLSBOdW1iZXIgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWVzIHJlcHJlc2VudCB0aGUgc2FtZSBudW1iZXIuXG4gICAqL1xuICBzdGF0aWMgZmluZEJ5TnVtZXJpY1N0cmluZ01hdGNoZXNOdW1iZXIobnVtZXJpY1N0cmluZywgZXhwZWN0ZWROdW1iZXIpIHtcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShleHBlY3RlZE51bWJlcikpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGlmICghL14tP1xcZCsoPzpcXC5cXGQrKT8kLy50ZXN0KG51bWVyaWNTdHJpbmcpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gTnVtYmVyKG51bWVyaWNTdHJpbmcpID09PSBleHBlY3RlZE51bWJlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlLlxuICAgKiBAcGFyYW0ge1VwZGF0ZUF0dHJpYnV0ZXN9IFtuZXdBdHRyaWJ1dGVzXSAtIE5ldyB2YWx1ZXMgdG8gYXNzaWduIGJlZm9yZSB1cGRhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHRoaXM+fSAtIFVwZGF0ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyB1cGRhdGUobmV3QXR0cmlidXRlcykge1xuICAgIGlmIChuZXdBdHRyaWJ1dGVzKSB0aGlzLmFzc2lnbkF0dHJpYnV0ZXMobmV3QXR0cmlidXRlcylcblxuICAgIHJldHVybiAvKiogQHR5cGUge3RoaXN9ICovIChhd2FpdCB0aGlzLnNhdmUoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXR0YWNobWVudElucHV0IC0gQXR0YWNobWVudCBpbnB1dCBvciBuYW1lZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYXR0YWNoZWQuXG4gICAqL1xuICBhc3luYyBhdHRhY2goYXR0YWNobWVudElucHV0KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9ucyA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb25zKClcbiAgICBjb25zdCBhdHRhY2htZW50TmFtZXMgPSBPYmplY3Qua2V5cyhhdHRhY2htZW50RGVmaW5pdGlvbnMpXG4gICAgbGV0IGF0dGFjaG1lbnROYW1lID0gYXR0YWNobWVudE5hbWVzWzBdXG4gICAgbGV0IGFjdHVhbEF0dGFjaG1lbnRJbnB1dCA9IGF0dGFjaG1lbnRJbnB1dFxuXG4gICAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChhdHRhY2htZW50SW5wdXQpKSB7XG4gICAgICBpZiAoXCJmaWxlXCIgaW4gYXR0YWNobWVudElucHV0ICYmIGF0dGFjaG1lbnREZWZpbml0aW9ucy5maWxlKSB7XG4gICAgICAgIGF0dGFjaG1lbnROYW1lID0gXCJmaWxlXCJcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBjYW5kaWRhdGVOYW1lIG9mIGF0dGFjaG1lbnROYW1lcykge1xuICAgICAgICBpZiAoY2FuZGlkYXRlTmFtZSBpbiBhdHRhY2htZW50SW5wdXQpIHtcbiAgICAgICAgICBhdHRhY2htZW50TmFtZSA9IGNhbmRpZGF0ZU5hbWVcbiAgICAgICAgICBhY3R1YWxBdHRhY2htZW50SW5wdXQgPSBhdHRhY2htZW50SW5wdXRbY2FuZGlkYXRlTmFtZV1cbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFhdHRhY2htZW50TmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBhdHRhY2htZW50IGRlZmluaXRpb25zIG9uICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKS5hdHRhY2goYWN0dWFsQXR0YWNobWVudElucHV0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2F2ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dGhpcz59IC0gU2F2ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBzYXZlKCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBpc05ldyA9IHRoaXMuaXNOZXdSZWNvcmQoKVxuICAgIGNvbnN0IHByZXZpb3VzSWRlbnRpdHkgPSBpc05ldyA/IG51bGwgOiB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgY29uc3QgY29tbWFuZFR5cGUgPSBpc05ldyA/IFwiY3JlYXRlXCIgOiBcInVwZGF0ZVwiXG4gICAgLyoqXG4gICAgICogUGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICBhdHRyaWJ1dGVzOiB0aGlzLl9jaGFuZ2VkQXR0cmlidXRlc0ZvclNhdmUoKVxuICAgIH1cblxuICAgIGlmICghaXNOZXcpIHtcbiAgICAgIHBheWxvYWQuaWQgPSB0aGlzLnBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgfVxuXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMuX2J1aWxkTmVzdGVkQXR0cmlidXRlc1BheWxvYWQoKVxuXG4gICAgaWYgKG5lc3RlZEF0dHJpYnV0ZXMgJiYgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykubGVuZ3RoID4gMCkge1xuICAgICAgcGF5bG9hZC5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuICAgIH1cblxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gYXdhaXQgdGhpcy5fYnVpbGRBdHRhY2htZW50c1BheWxvYWQoKVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwKSB7XG4gICAgICBwYXlsb2FkLmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICB9XG5cbiAgICBpZiAoc2hvdWxkUXVldWVGcm9udGVuZE1vZGVsT3BlcmF0aW9uT2ZmbGluZShNb2RlbENsYXNzLCBjb21tYW5kVHlwZSkpIHtcbiAgICAgIGNvbnN0IG9mZmxpbmVBdHRyaWJ1dGVzID0gey4uLnBheWxvYWQuYXR0cmlidXRlc31cbiAgICAgIGxldCBjbGllbnRNdXRhdGlvbklkXG5cbiAgICAgIGlmIChpc05ldykge1xuICAgICAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgT2ZmbGluZSBjcmVhdGUgZm9yICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICAgIGNvbnN0IGN1cnJlbnRQcmltYXJ5S2V5ID0gdGhpcy5yZWFkQXR0cmlidXRlKHByaW1hcnlLZXkpXG5cbiAgICAgICAgaWYgKGN1cnJlbnRQcmltYXJ5S2V5ID09PSB1bmRlZmluZWQgfHwgY3VycmVudFByaW1hcnlLZXkgPT09IG51bGwpIHtcbiAgICAgICAgICBjbGllbnRNdXRhdGlvbklkID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5vZmZsaW5lU3luYz8uY2xpZW50TXV0YXRpb25JZFxuICAgICAgICAgICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jLmNsaWVudE11dGF0aW9uSWQoKVxuICAgICAgICAgICAgOiBmcm9udGVuZE1vZGVsT2ZmbGluZU11dGF0aW9uSWQoKVxuICAgICAgICAgIHRoaXMuc2V0QXR0cmlidXRlKHByaW1hcnlLZXksIGNsaWVudE11dGF0aW9uSWQpXG4gICAgICAgICAgb2ZmbGluZUF0dHJpYnV0ZXNbcHJpbWFyeUtleV0gPSBjbGllbnRNdXRhdGlvbklkXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGBPZmZsaW5lIHVwZGF0ZSBmb3IgJHtNb2RlbENsYXNzLm5hbWV9YClcblxuICAgICAgICBvZmZsaW5lQXR0cmlidXRlc1twcmltYXJ5S2V5XSA9IHBheWxvYWQuaWRcbiAgICAgIH1cblxuICAgICAgaWYgKHBheWxvYWQubmVzdGVkQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkIHx8IHBheWxvYWQuYXR0YWNobWVudHMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE9mZmxpbmUgc3luYyBmb3IgJHtNb2RlbENsYXNzLm5hbWV9IGRvZXMgbm90IHN1cHBvcnQgbmVzdGVkIGF0dHJpYnV0ZXMgb3IgYXR0YWNobWVudHMgeWV0YClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgcXVldWVGcm9udGVuZE1vZGVsTXV0YXRpb25PZmZsaW5lKHtcbiAgICAgICAgYXR0cmlidXRlczogb2ZmbGluZUF0dHJpYnV0ZXMsXG4gICAgICAgIGNsaWVudE11dGF0aW9uSWQsXG4gICAgICAgIE1vZGVsQ2xhc3MsXG4gICAgICAgIG9wZXJhdGlvbjogY29tbWFuZFR5cGVcbiAgICAgIH0pXG4gICAgICB0aGlzLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuICAgICAgdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXModGhpcy5hdHRyaWJ1dGVzKCkpXG4gICAgICB0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgICB0aGlzLl9jbGVhclBlbmRpbmdBdHRhY2htZW50cygpXG5cbiAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuXG4gICAgY29uc3QgcmVtb3ZlVGVtcG9yYXJ5TGlzdGVuZXJBbGlhc2VzID0gcHJldmlvdXNJZGVudGl0eSA9PT0gbnVsbFxuICAgICAgPyAoKSA9PiB7fVxuICAgICAgOiBhbGlhc0Zyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyhNb2RlbENsYXNzLCB0aGlzLCBwcmV2aW91c0lkZW50aXR5LCB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIGxldCByZXNwb25zZVxuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3BvbnNlID0gYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChjb21tYW5kVHlwZSwgcGF5bG9hZClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmVtb3ZlVGVtcG9yYXJ5TGlzdGVuZXJBbGlhc2VzKClcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmVtb3ZlVGVtcG9yYXJ5TGlzdGVuZXJBbGlhc2VzKClcblxuICAgIGNvbnN0IG1vZGVsRGF0YSA9IE1vZGVsQ2xhc3MubW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuXG4gICAgdGhpcy5hc3NpZ25BdHRyaWJ1dGVzKG1vZGVsRGF0YS5hdHRyaWJ1dGVzKVxuICAgIHRoaXMuX2F0dGFjaG1lbnRPd25lciA9IG1vZGVsRGF0YS5hdHRhY2htZW50T3duZXJcbiAgICB0aGlzLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuXG4gICAgaWYgKHByZXZpb3VzSWRlbnRpdHkgIT09IG51bGwpIHtcbiAgICAgIHJla2V5RnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJzKE1vZGVsQ2xhc3MsIHRoaXMsIHByZXZpb3VzSWRlbnRpdHksIHRoaXMucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgfVxuXG4gICAgdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXModGhpcy5hdHRyaWJ1dGVzKCkpXG4gICAgdGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIHRoaXMuX2NsZWFyUGVuZGluZ0F0dGFjaG1lbnRzKClcblxuICAgIHRoaXMuX3JlY29uY2lsZU5lc3RlZEF0dHJpYnV0ZXNGcm9tUmVzcG9uc2UocmVzcG9uc2UpXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHN1YnNldCBvZiBgX2F0dHJpYnV0ZXNgIHdob3NlIHZhbHVlIGhhcyBkaXZlcmdlZCBmcm9tXG4gICAqIGBfcGVyc2lzdGVkQXR0cmlidXRlc2AuIFVzZWQgYnkgYHNhdmUoKWAgc28gdGhlIHNlcnZlciByZWNlaXZlcyBvbmx5IHRoZVxuICAgKiBmaWVsZHMgdGhlIGNhbGxlciBhY3R1YWxseSBjaGFuZ2VkIOKAlCBhdm9pZGluZyBzdHJpY3QgcGVybWl0IHJlamVjdGlvbnMgb25cbiAgICogZnJhbWV3b3JrLW1hbmFnZWQgZmllbGRzIGxpa2UgYGlkYCwgYGNyZWF0ZWRBdGAsIGB1cGRhdGVkQXRgLCBvciBvd25lclxuICAgKiBmb3JlaWduIGtleXMgdGhhdCB0aGUgcmVzb3VyY2UgbmV2ZXIgbGlzdHMgaW4gYHBlcm1pdHRlZFBhcmFtc2AuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAtIENoYW5nZWQgYXR0cmlidXRlcyBoYXNoLlxuICAgKi9cbiAgX2NoYW5nZWRBdHRyaWJ1dGVzRm9yU2F2ZSgpIHtcbiAgICAvKipcbiAgICAgKiBDaGFuZ2VkIGF0dHJpYnV0ZXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovXG4gICAgY29uc3QgY2hhbmdlZEF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgW3ByZXZpb3VzVmFsdWUsIGN1cnJlbnRWYWx1ZV1dIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuY2hhbmdlcygpKSkge1xuICAgICAgaWYgKHRoaXMuaXNOZXdSZWNvcmQoKSAmJiBwcmV2aW91c1ZhbHVlID09PSB1bmRlZmluZWQgJiYgY3VycmVudFZhbHVlID09PSBudWxsKSBjb250aW51ZVxuXG4gICAgICBjaGFuZ2VkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IGN1cnJlbnRWYWx1ZVxuICAgIH1cblxuICAgIHJldHVybiBjaGFuZ2VkQXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIHRoZSBjdXJyZW50IHZhbHVlIGZvciBhbiBhdHRyaWJ1dGUgYXMgYWxyZWFkeSBwZXJzaXN0ZWQgc28gdGhlIG5leHRcbiAgICogc2F2ZSBkb2VzIG5vdCBzZW5kIGl0IHVubGVzcyB0aGUgY2FsbGVyIGNoYW5nZXMgaXQgYWdhaW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIHRvIG1hcmsgdW5jaGFuZ2VkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIG1hcmtBdHRyaWJ1dGVVbmNoYW5nZWQoYXR0cmlidXRlTmFtZSkge1xuICAgIHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBjbG9uZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKHt2YWx1ZTogdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXX0pLnZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZXN0cm95LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGRlc3Ryb3llZCBvbiBiYWNrZW5kLlxuICAgKi9cbiAgYXN5bmMgZGVzdHJveSgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgaWQgPSB0aGlzLmlzTmV3UmVjb3JkKCkgPyB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpIDogdGhpcy5wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKVxuXG4gICAgaWYgKHNob3VsZFF1ZXVlRnJvbnRlbmRNb2RlbE9wZXJhdGlvbk9mZmxpbmUoTW9kZWxDbGFzcywgXCJkZXN0cm95XCIpKSB7XG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgT2ZmbGluZSBkZXN0cm95IGZvciAke01vZGVsQ2xhc3MubmFtZX1gKVxuXG4gICAgICBhd2FpdCBxdWV1ZUZyb250ZW5kTW9kZWxNdXRhdGlvbk9mZmxpbmUoe1xuICAgICAgICBhdHRyaWJ1dGVzOiB7W3ByaW1hcnlLZXldOiBpZH0sXG4gICAgICAgIE1vZGVsQ2xhc3MsXG4gICAgICAgIG9wZXJhdGlvbjogXCJkZXN0cm95XCJcbiAgICAgIH0pXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IE1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoXCJkZXN0cm95XCIsIHtcbiAgICAgIGlkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGF0dGFjaG1lbnQgcGF5bG9hZCBxdWV1ZWQgb24gdGhpcyBtb2RlbCBmb3IgdGhlIG5leHQgc2F2ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gQXR0YWNobWVudCBwYXlsb2FkIGtleWVkIGJ5IGF0dGFjaG1lbnQgbmFtZS5cbiAgICovXG4gIGFzeW5jIF9idWlsZEF0dGFjaG1lbnRzUGF5bG9hZCgpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cblxuICAgIGZvciAoY29uc3QgYXR0YWNobWVudE5hbWUgb2YgT2JqZWN0LmtleXModGhpcy5fYXR0YWNobWVudHMpKSB7XG4gICAgICBjb25zdCBhdHRhY2htZW50UGF5bG9hZCA9IGF3YWl0IHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXS5wZW5kaW5nQXR0YWNobWVudHNQYXlsb2FkKClcblxuICAgICAgaWYgKGF0dGFjaG1lbnRQYXlsb2FkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcGF5bG9hZFthdHRhY2htZW50TmFtZV0gPSBhdHRhY2htZW50UGF5bG9hZFxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICAvKiogQ2xlYXJzIHF1ZXVlZCBhdHRhY2htZW50IGlucHV0cyBhZnRlciBhIHN1Y2Nlc3NmdWwgc2F2ZS4gKi9cbiAgX2NsZWFyUGVuZGluZ0F0dGFjaG1lbnRzKCkge1xuICAgIGZvciAoY29uc3QgYXR0YWNobWVudE5hbWUgb2YgT2JqZWN0LmtleXModGhpcy5fYXR0YWNobWVudHMpKSB7XG4gICAgICB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0uY2xlYXJQZW5kaW5nQXR0YWNobWVudHMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXYWxrcyByZWxhdGlvbnNoaXBzIGRlY2xhcmVkIGluIHRoaXMgcmVzb3VyY2UncyBgbmVzdGVkQXR0cmlidXRlc2AgY29uZmlnXG4gICAqIGFuZCBidWlsZHMgdGhlIHBlci1yZWxhdGlvbnNoaXAgcGF5bG9hZCBvZiBkaXJ0eSBjaGlsZHJlbiBmb3IgYSBwYXJlbnQgc2F2ZS5cbiAgICpcbiAgICogSW5jbHVkZWQgY2hpbGRyZW46XG4gICAqICAgLSBuZXcgcmVjb3JkcyAoaXNOZXdSZWNvcmQoKSkg4oaSIGNyZWF0ZSBlbnRyeSB3aXRoIGF0dHJpYnV0ZXNcbiAgICogICAtIHJlY29yZHMgbWFya2VkIGZvciBkZXN0cnVjdGlvbiAobWFya2VkRm9yRGVzdHJ1Y3Rpb24oKSkg4oaSIGRlc3Ryb3kgZW50cnlcbiAgICogICAtIHJlY29yZHMgd2l0aCBjaGFuZ2VkIGF0dHJpYnV0ZXMgKGlzQ2hhbmdlZCgpKSDihpIgdXBkYXRlIGVudHJ5IHdpdGggYXR0cmlidXRlc1xuICAgKiAgIC0gcmVjb3JkcyB3aXRoIGRpcnR5IGRlc2NlbmRhbnRzIGluIHRoZWlyIG93biBuZXN0ZWRBdHRyaWJ1dGVzIOKGkiByZWN1cnNlXG4gICAqXG4gICAqIExvYWRlZCBidXQgdW50b3VjaGVkIHJlY29yZHMgYXJlIG9taXR0ZWQgc28gbmVzdGVkIHNhdmUgcHJlc2VydmVzIFJhaWxzLXN0eWxlXG4gICAqIFwiY2hpbGRyZW4gbm90IHJlZmVyZW5jZWQgaW4gcGF5bG9hZCBhcmUgbGVmdCBhbG9uZVwiIHNlbWFudGljcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj4+fSAtIFBlci1yZWxhdGlvbnNoaXAgbGlzdCBvZiBuZXN0ZWQtYXR0cmlidXRlIGVudHJpZXMuXG4gICAqL1xuICBhc3luYyBfYnVpbGROZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZCgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSBNb2RlbENsYXNzLnJlc291cmNlQ29uZmlnKClcbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnID0gcmVzb3VyY2VDb25maWc/Lm5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIGlmICghbmVzdGVkQXR0cmlidXRlc0NvbmZpZykgcmV0dXJuIHt9XG5cbiAgICAvKipcbiAgICAgKiBQYXlsb2FkLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pn0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnKSkge1xuICAgICAgLyoqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgICAgY29uc3QgZW50cmllcyA9IFtdXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLl9yZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCAmJiBBcnJheS5pc0FycmF5KHJlbGF0aW9uc2hpcC5fbG9hZGVkVmFsdWUpKSB7XG4gICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgcmVsYXRpb25zaGlwLl9sb2FkZWRWYWx1ZSkge1xuICAgICAgICAgIGNvbnN0IGNoaWxkRW50cnkgPSBhd2FpdCBjaGlsZC5fbmVzdGVkQXR0cmlidXRlc0VudHJ5Rm9yUGFyZW50U2F2ZSgpXG5cbiAgICAgICAgICBpZiAoY2hpbGRFbnRyeSkgZW50cmllcy5wdXNoKGNoaWxkRW50cnkpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwICYmIHJlbGF0aW9uc2hpcC5nZXRQcmVsb2FkZWQoKSkge1xuICAgICAgICBjb25zdCBjaGlsZCA9IHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICAgIGlmIChjaGlsZCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxCYXNlKSB7XG4gICAgICAgICAgY29uc3QgY2hpbGRFbnRyeSA9IGF3YWl0IGNoaWxkLl9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlGb3JQYXJlbnRTYXZlKClcblxuICAgICAgICAgIGlmIChjaGlsZEVudHJ5KSBlbnRyaWVzLnB1c2goY2hpbGRFbnRyeSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzLCByZWxhdGlvbnNoaXBOYW1lKSkge1xuICAgICAgICBlbnRyaWVzLnB1c2goXG4gICAgICAgICAgLi4uYXdhaXQgdGhpcy5fbmVzdGVkQXR0cmlidXRlc1BheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShcbiAgICAgICAgICAgIE1vZGVsQ2xhc3MsXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXNbcmVsYXRpb25zaGlwTmFtZV1cbiAgICAgICAgICApXG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgaWYgKGVudHJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgICBwYXlsb2FkW3JlbGF0aW9uc2hpcE5hbWVdID0gZW50cmllc1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBwYXlsb2FkIGVudHJ5IGZvciB0aGlzIGNoaWxkIHdoZW4gd2Fsa2VkIGJ5IGEgcGFyZW50J3NcbiAgICogYF9idWlsZE5lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkYC4gUmV0dXJucyBgbnVsbGAgd2hlbiB0aGUgY2hpbGQgaGFzIG5vXG4gICAqIGRpcnR5IHN0YXRlIGFuZCBubyBkaXJ0eSBkZXNjZW5kYW50cywgc28gdGhlIHBhcmVudCBjYW4gb21pdCBpdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gTmVzdGVkLWF0dHJpYnV0ZSBlbnRyeSBvciBudWxsIGlmIGNsZWFuLlxuICAgKi9cbiAgYXN5bmMgX25lc3RlZEF0dHJpYnV0ZXNFbnRyeUZvclBhcmVudFNhdmUoKSB7XG4gICAgaWYgKHRoaXMubWFya2VkRm9yRGVzdHJ1Y3Rpb24oKSkge1xuICAgICAgaWYgKHRoaXMuaXNOZXdSZWNvcmQoKSkgcmV0dXJuIG51bGxcbiAgICAgIHJldHVybiB7aWQ6IHRoaXMucHJpbWFyeUtleVZhbHVlKCksIF9kZXN0cm95OiB0cnVlfVxuICAgIH1cblxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLl9idWlsZE5lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkKClcbiAgICBjb25zdCBoYXNOZXN0ZWREaXJ0eSA9IE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDBcbiAgICBjb25zdCBhdHRhY2htZW50cyA9IGF3YWl0IHRoaXMuX2J1aWxkQXR0YWNobWVudHNQYXlsb2FkKClcbiAgICBjb25zdCBoYXNBdHRhY2htZW50cyA9IE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwXG5cbiAgICBpZiAodGhpcy5pc05ld1JlY29yZCgpKSB7XG4gICAgICAvKipcbiAgICAgICAqIEVudHJ5LlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IGVudHJ5ID0ge31cbiAgICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB0aGlzLl9jaGFuZ2VkQXR0cmlidXRlc0ZvclNhdmUoKVxuXG4gICAgICBpZiAoT2JqZWN0LmtleXMoYXR0cmlidXRlcykubGVuZ3RoID4gMCkgZW50cnkuYXR0cmlidXRlcyA9IGF0dHJpYnV0ZXNcbiAgICAgIGlmIChoYXNBdHRhY2htZW50cykgZW50cnkuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgICAgaWYgKGhhc05lc3RlZERpcnR5KSBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuXG4gICAgICByZXR1cm4gZW50cnlcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuaXNDaGFuZ2VkKCkgJiYgIWhhc05lc3RlZERpcnR5ICYmICFoYXNBdHRhY2htZW50cykgcmV0dXJuIG51bGxcblxuICAgIC8qKlxuICAgICAqIEVudHJ5LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgZW50cnkgPSB7aWQ6IHRoaXMucHJpbWFyeUtleVZhbHVlKCl9XG5cbiAgICBpZiAodGhpcy5pc0NoYW5nZWQoKSkgZW50cnkuYXR0cmlidXRlcyA9IHRoaXMuX2NoYW5nZWRBdHRyaWJ1dGVzRm9yU2F2ZSgpXG4gICAgaWYgKGhhc0F0dGFjaG1lbnRzKSBlbnRyeS5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgaWYgKGhhc05lc3RlZERpcnR5KSBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuXG4gICAgcmV0dXJuIGVudHJ5XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIG5lc3RlZCBlbnRyaWVzIGZyb20gYSBSYWlscy1zdHlsZSBzdWJtaXR0ZWQgYCpBdHRyaWJ1dGVzYCB2YWx1ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBQYXJlbnQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gTmVzdGVkIHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFN1Ym1pdHRlZCBuZXN0ZWQgYXR0cmlidXRlcyB2YWx1ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59IE5lc3RlZCBlbnRyaWVzIGZvciB0aGUgdHJhbnNwb3J0IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBfbmVzdGVkQXR0cmlidXRlc1BheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShNb2RlbENsYXNzLCByZWxhdGlvbnNoaXBOYW1lLCB2YWx1ZSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcERlZmluaXRpb24gPSBNb2RlbENsYXNzLnJlbGF0aW9uc2hpcERlZmluaXRpb24ocmVsYXRpb25zaGlwTmFtZSlcbiAgICBjb25zdCBUYXJnZXRNb2RlbENsYXNzID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBNb2RlbENsYXNzKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcERlZmluaXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBuZXN0ZWQgcmVsYXRpb25zaGlwOiAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuICAgIGlmICghVGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgY29uZmlndXJlZCBmb3IgJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIGlmIChyZWxhdGlvbnNoaXBUeXBlSXNDb2xsZWN0aW9uKHJlbGF0aW9uc2hpcERlZmluaXRpb24udHlwZSkpIHtcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfUF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBhcnJheWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgICAgdmFsdWUubWFwKGFzeW5jIChlbnRyeSkgPT4gYXdhaXQgdGhpcy5fbmVzdGVkQXR0cmlidXRlc0VudHJ5UGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKFRhcmdldE1vZGVsQ2xhc3MsIGVudHJ5KSlcbiAgICAgIClcbiAgICB9XG5cbiAgICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIFtdXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9QXR0cmlidXRlcyBtdXN0IGJlIGFuIG9iamVjdGApXG4gICAgfVxuXG4gICAgcmV0dXJuIFthd2FpdCB0aGlzLl9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoVGFyZ2V0TW9kZWxDbGFzcywgdmFsdWUpXVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIG9uZSBzdWJtaXR0ZWQgUmFpbHMtc3R5bGUgbmVzdGVkIGF0dHJpYnV0ZXMgb2JqZWN0IGludG8gdHJhbnNwb3J0IHBheWxvYWQgc2hhcGUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gTmVzdGVkIGNoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzdWJtaXR0ZWRFbnRyeSAtIFN1Ym1pdHRlZCBuZXN0ZWQgYXR0cmlidXRlcyBlbnRyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gVHJhbnNwb3J0IG5lc3RlZC1hdHRyaWJ1dGVzIGVudHJ5LlxuICAgKi9cbiAgYXN5bmMgX25lc3RlZEF0dHJpYnV0ZXNFbnRyeVBheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShNb2RlbENsYXNzLCBzdWJtaXR0ZWRFbnRyeSkge1xuICAgIGlmICghZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KHN1Ym1pdHRlZEVudHJ5KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke01vZGVsQ2xhc3MubmFtZX0gbmVzdGVkIGF0dHJpYnV0ZXMgZW50cmllcyBtdXN0IGJlIG9iamVjdHNgKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGVudHJ5ID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBhdHRhY2htZW50cyA9IHt9XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+Pn0gKi9cbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzID0ge31cblxuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzdWJtaXR0ZWRFbnRyeSkpIHtcbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSBcImlkXCIgfHwgYXR0cmlidXRlTmFtZSA9PT0gXCJfZGVzdHJveVwiKSB7XG4gICAgICAgIGVudHJ5W2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgbmVzdGVkUmVsYXRpb25zaGlwTmFtZSA9IE1vZGVsQ2xhc3MubmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUoYXR0cmlidXRlTmFtZSlcblxuICAgICAgaWYgKG5lc3RlZFJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICAgICAgbmVzdGVkQXR0cmlidXRlc1tuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lXSA9IGF3YWl0IHRoaXMuX25lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoXG4gICAgICAgICAgTW9kZWxDbGFzcyxcbiAgICAgICAgICBuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHZhbHVlXG4gICAgICAgIClcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24oYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgICAgYXR0YWNobWVudHNbYXR0cmlidXRlTmFtZV0gPSBhd2FpdCB0aGlzLl9hdHRhY2htZW50UGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKE1vZGVsQ2xhc3MsIGF0dHJpYnV0ZU5hbWUsIHZhbHVlKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0cmlidXRlcykubGVuZ3RoID4gMCkgZW50cnkuYXR0cmlidXRlcyA9IGF0dHJpYnV0ZXNcbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDApIGVudHJ5LmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICBpZiAoT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykubGVuZ3RoID4gMCkgZW50cnkubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIHJldHVybiBlbnRyeVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBzdWJtaXR0ZWQgYXR0YWNobWVudCB2YWx1ZSBmb3IgdHJhbnNwb3J0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIG93bmluZyB0aGUgYXR0YWNobWVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFN1Ym1pdHRlZCBhdHRhY2htZW50IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXT59IE5vcm1hbGl6ZWQgYXR0YWNobWVudCBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgX2F0dGFjaG1lbnRQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoTW9kZWxDbGFzcywgYXR0YWNobWVudE5hbWUsIHZhbHVlKSB7XG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKGF0dGFjaG1lbnROYW1lKVxuXG4gICAgaWYgKGF0dGFjaG1lbnREZWZpbml0aW9uPy50eXBlID09PSBcImhhc01hbnlcIikge1xuICAgICAgY29uc3QgdmFsdWVzID0gQXJyYXkuaXNBcnJheSh2YWx1ZSkgPyB2YWx1ZSA6IFt2YWx1ZV1cblxuICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKHZhbHVlcy5tYXAoYXN5bmMgKGVudHJ5KSA9PiBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dChlbnRyeSkpKVxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgY29uc3QgbGFzdFZhbHVlID0gdmFsdWVbdmFsdWUubGVuZ3RoIC0gMV1cblxuICAgICAgaWYgKGxhc3RWYWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtNb2RlbENsYXNzLm5hbWV9IyR7YXR0YWNobWVudE5hbWV9IGF0dGFjaG1lbnQgYXJyYXkgY2Fubm90IGJlIGVtcHR5YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGxhc3RWYWx1ZSlcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogQWZ0ZXIgYSBwYXJlbnQgc2F2ZSB3aXRoIGBuZXN0ZWRBdHRyaWJ1dGVzYCwgdGhlIHNlcnZlciByZXNwb25zZSBpbmNsdWRlc1xuICAgKiBwcmVsb2FkZWQgdmVyc2lvbnMgb2YgdGhlIGFmZmVjdGVkIHJlbGF0aW9uc2hpcHMuIFRoaXMgcmVwbGFjZXMgdGhlIGxvY2FsXG4gICAqIGBfbG9hZGVkVmFsdWVgIGZvciBlYWNoIG5lc3RlZC13cml0YWJsZSByZWxhdGlvbnNoaXAgd2l0aCB0aGUgc2VydmVyJ3NcbiAgICogYXV0aG9yaXRhdGl2ZSBzZXQsIHNvIGRlc3Ryb3llZCBjaGlsZHJlbiBhcmUgZHJvcHBlZCBhbmQgbmV3bHktY3JlYXRlZFxuICAgKiBjaGlsZHJlbiBnZXQgdGhlaXIgc2VydmVyLWFzc2lnbmVkIGlkcyArIHBlcnNpc3RlZCBzdGF0ZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJlc3BvbnNlIC0gQ29tbWFuZCByZXNwb25zZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9yZWNvbmNpbGVOZXN0ZWRBdHRyaWJ1dGVzRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gTW9kZWxDbGFzcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlc0NvbmZpZyA9IHJlc291cmNlQ29uZmlnPy5uZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICBpZiAoIW5lc3RlZEF0dHJpYnV0ZXNDb25maWcpIHJldHVyblxuXG4gICAgY29uc3QgbW9kZWxEYXRhID0gTW9kZWxDbGFzcy5tb2RlbERhdGFGcm9tUmVzcG9uc2UocmVzcG9uc2UpXG4gICAgY29uc3QgcHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IG1vZGVsRGF0YS5wcmVsb2FkZWRSZWxhdGlvbnNoaXBzXG5cbiAgICAvKipcbiAgICAgKiBSZWxldmFudCBwcmVsb2Fkcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHJlbGV2YW50UHJlbG9hZHMgPSB7fVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXNDb25maWcpKSB7XG4gICAgICBpZiAocmVsYXRpb25zaGlwTmFtZSBpbiBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKSB7XG4gICAgICAgIHJlbGV2YW50UHJlbG9hZHNbcmVsYXRpb25zaGlwTmFtZV0gPSBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKHJlbGV2YW50UHJlbG9hZHMpLmxlbmd0aCA+IDApIHtcbiAgICAgIE1vZGVsQ2xhc3MuYXBwbHlQcmVsb2FkZWRSZWxhdGlvbnNoaXBzKHRoaXMsIHJlbGV2YW50UHJlbG9hZHMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZSBjb21tYW5kLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDb21tYW5kVHlwZX0gY29tbWFuZFR5cGUgLSBDb21tYW5kIHR5cGUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXlsb2FkIC0gQ29tbWFuZCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFBhcnNlZCBKU09OIHJlc3BvbnNlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGV4ZWN1dGVDb21tYW5kKGNvbW1hbmRUeXBlLCBwYXlsb2FkKSB7XG4gICAgY29uc3QgY29tbWFuZE5hbWUgPSB0aGlzLmNvbW1hbmROYW1lKGNvbW1hbmRUeXBlKVxuICAgIGNvbnN0IHRpbWVab25lID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKClcbiAgICBjb25zdCBzZXJpYWxpemVkUGF5bG9hZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHBheWxvYWQsIHt0aW1lWm9uZX0pKVxuICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KClcbiAgICBjb25zdCByZXF1ZXN0UGF5bG9hZCA9IG1lcmdlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0LCBzZXJpYWxpemVkUGF5bG9hZClcbiAgICBjb25zdCByZXNvdXJjZVBhdGggPSB0aGlzLnJlc291cmNlUGF0aCgpXG4gICAgY29uc3QgY29udGFpbnNBdHRhY2htZW50VXBsb2FkID0gZnJvbnRlbmRNb2RlbFBheWxvYWRDb250YWluc0F0dGFjaG1lbnRVcGxvYWQoc2VyaWFsaXplZFBheWxvYWQpXG4gICAgY29uc3QgdXNlU2hhcmVkVHJhbnNwb3J0ID0gIWNvbnRhaW5zQXR0YWNobWVudFVwbG9hZFxuICAgIGNvbnN0IHVybCA9IHVzZVNoYXJlZFRyYW5zcG9ydCA/IGZyb250ZW5kTW9kZWxBcGlVcmwoKSA6IGZyb250ZW5kTW9kZWxDb21tYW5kVXJsKHJlc291cmNlUGF0aCB8fCBcIlwiLCBjb21tYW5kTmFtZSlcblxuICAgIGlmICh1c2VTaGFyZWRUcmFuc3BvcnQpIHtcbiAgICAgIGNvbnN0IGJhdGNoUmVzcG9uc2UgPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMucHVzaCh7XG4gICAgICAgICAgY29tbWFuZE5hbWUsXG4gICAgICAgICAgY29tbWFuZFR5cGUsXG4gICAgICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgICAgICBwYXlsb2FkOiBzZXJpYWxpemVkUGF5bG9hZCxcbiAgICAgICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgICAgICByZWplY3QsXG4gICAgICAgICAgcmVxdWVzdElkOiBgJHsrK3NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0SWR9YCxcbiAgICAgICAgICByZXNvbHZlLFxuICAgICAgICAgIHJlc291cmNlUGF0aFxuICAgICAgICB9KVxuXG4gICAgICAgIHNjaGVkdWxlU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RGbHVzaCgpXG4gICAgICB9KVxuXG4gICAgICBjb25zdCBkZWNvZGVkQmF0Y2hSZXNwb25zZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoYmF0Y2hSZXNwb25zZSlcblxuICAgICAgdGhpcy50aHJvd09uRXJyb3JGcm9udGVuZE1vZGVsUmVzcG9uc2Uoe1xuICAgICAgICBjb21tYW5kVHlwZSxcbiAgICAgICAgcmVzcG9uc2U6IGRlY29kZWRCYXRjaFJlc3BvbnNlXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gZGVjb2RlZEJhdGNoUmVzcG9uc2VcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdHJhY2tGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdChhc3luYyAoKSA9PiBydW5XaXRoVHJhbnNwb3J0RGVhZGxpbmUoXG4gICAgICB7XG4gICAgICAgIGVycm9yTWVzc2FnZTogYCR7dGhpcy5uYW1lfSMke2NvbW1hbmRUeXBlfSByZXF1ZXN0IHRpbWVkIG91dGAsXG4gICAgICAgIHNpZ25hbDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpLFxuICAgICAgICB0aW1lb3V0TXM6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lb3V0TXMoKVxuICAgICAgfSxcbiAgICAgIGFzeW5jIChzaWduYWwpID0+IHtcbiAgICAgICAgY29uc3QgZGlyZWN0UmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXF1ZXN0UGF5bG9hZCksXG4gICAgICAgICAgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiLFxuICAgICAgICAgIGhlYWRlcnM6IGZyb250ZW5kTW9kZWxSZXF1ZXN0SGVhZGVycyh0aW1lWm9uZSksXG4gICAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICBzaWduYWxcbiAgICAgICAgfSlcblxuICAgICAgICBjb25zdCBkaXJlY3RSZXNwb25zZVRleHQgPSBhd2FpdCBkaXJlY3RSZXNwb25zZS50ZXh0KClcblxuICAgICAgICBpZiAoIWRpcmVjdFJlc3BvbnNlLm9rKSB7XG4gICAgICAgICAgdGhyb3dGcm9udGVuZE1vZGVsSHR0cEVycm9yKHtcbiAgICAgICAgICAgIGNvbW1hbmRMYWJlbDogYCR7dGhpcy5uYW1lfSMke2NvbW1hbmRUeXBlfWAsXG4gICAgICAgICAgICByZXNwb25zZTogZGlyZWN0UmVzcG9uc2UsXG4gICAgICAgICAgICByZXNwb25zZVRleHQ6IGRpcmVjdFJlc3BvbnNlVGV4dFxuICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBkaXJlY3RKc29uID0gZGlyZWN0UmVzcG9uc2VUZXh0Lmxlbmd0aCA+IDAgPyBKU09OLnBhcnNlKGRpcmVjdFJlc3BvbnNlVGV4dCkgOiB7fVxuICAgICAgICBjb25zdCBkZWNvZGVkRGlyZWN0UmVzcG9uc2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGRpcmVjdEpzb24pKVxuXG4gICAgICAgIHRoaXMudGhyb3dPbkVycm9yRnJvbnRlbmRNb2RlbFJlc3BvbnNlKHtcbiAgICAgICAgICBjb21tYW5kVHlwZSxcbiAgICAgICAgICByZXNwb25zZTogZGVjb2RlZERpcmVjdFJlc3BvbnNlXG4gICAgICAgIH0pXG5cbiAgICAgICAgcmV0dXJuIGRlY29kZWREaXJlY3RSZXNwb25zZVxuICAgICAgfVxuICAgICkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleGVjdXRlIGN1c3RvbSBjb21tYW5kLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3tjb21tYW5kTmFtZTogc3RyaW5nLCBjb21tYW5kVHlwZTogRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSwgbWVtYmVySWQ/OiBzdHJpbmcgfCBudW1iZXIgfCBudWxsLCBwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHJlc291cmNlUGF0aDogc3RyaW5nfX0gYXJncyAtIENvbW1hbmQgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+Pn0gLSBEZWNvZGVkIHJlc3BvbnNlIHBheWxvYWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZXhlY3V0ZUN1c3RvbUNvbW1hbmQoYXJncykge1xuICAgIGNvbnN0IHtjb21tYW5kTmFtZSwgY29tbWFuZFR5cGUsIG1lbWJlcklkID0gbnVsbCwgcGF5bG9hZCwgcmVzb3VyY2VQYXRofSA9IGFyZ3NcbiAgICBjb25zdCB0aW1lWm9uZSA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpXG4gICAgY29uc3Qgc2VyaWFsaXplZFBheWxvYWQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShwYXlsb2FkLCB7dGltZVpvbmV9KSlcbiAgICBjb25zdCByZXF1ZXN0Q29udGV4dCA9IGZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCgpXG5cbiAgICBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCwgc2VyaWFsaXplZFBheWxvYWQpXG4gICAgY29uc3QgY3VzdG9tUGF0aCA9IGZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kUGF0aCh7XG4gICAgICBjb21tYW5kTmFtZSxcbiAgICAgIG1lbWJlcklkLFxuICAgICAgbW9kZWxOYW1lOiB0aGlzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgcmVzb3VyY2VQYXRoXG4gICAgfSlcblxuICAgIGNvbnN0IGJhdGNoUmVzcG9uc2UgPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzLnB1c2goe1xuICAgICAgICBjb21tYW5kVHlwZSxcbiAgICAgICAgY3VzdG9tUGF0aCxcbiAgICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgICAgcGF5bG9hZDogc2VyaWFsaXplZFBheWxvYWQsXG4gICAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAgICByZWplY3QsXG4gICAgICAgIHJlcXVlc3RJZDogYCR7KytzaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdElkfWAsXG4gICAgICAgIHJlc29sdmVcbiAgICAgIH0pXG5cbiAgICAgIHNjaGVkdWxlU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RGbHVzaCgpXG4gICAgfSlcblxuICAgIGNvbnN0IGRlY29kZWRCYXRjaFJlc3BvbnNlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAoYmF0Y2hSZXNwb25zZSlcblxuICAgIHRoaXMudGhyb3dPbkVycm9yRnJvbnRlbmRNb2RlbFJlc3BvbnNlKHtcbiAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgcmVzcG9uc2U6IGRlY29kZWRCYXRjaFJlc3BvbnNlXG4gICAgfSlcblxuICAgIHJldHVybiBkZWNvZGVkQmF0Y2hSZXNwb25zZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhyb3cgb24gZXJyb3IgZnJvbnRlbmQgbW9kZWwgcmVzcG9uc2UuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7e2NvbW1hbmRUeXBlOiBGcm9udGVuZE1vZGVsUmVxdWVzdENvbW1hbmRUeXBlLCByZXNwb25zZTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgdGhyb3dPbkVycm9yRnJvbnRlbmRNb2RlbFJlc3BvbnNlKGFyZ3MpIHtcbiAgICBjb25zdCB7Y29tbWFuZFR5cGUsIHJlc3BvbnNlfSA9IGFyZ3NcbiAgICBpZiAocmVzcG9uc2U/LnN0YXR1cyAhPT0gXCJlcnJvclwiKSByZXR1cm5cblxuICAgIGNvbnN0IHJlc3BvbnNlS2V5cyA9IE9iamVjdC5rZXlzKHJlc3BvbnNlKVxuICAgIGNvbnN0IGhhc09ubHlTdGF0dXMgPSByZXNwb25zZUtleXMubGVuZ3RoID09PSAxICYmIHJlc3BvbnNlS2V5c1swXSA9PT0gXCJzdGF0dXNcIlxuICAgIGNvbnN0IGhhc0Vycm9yTWVzc2FnZSA9IHR5cGVvZiByZXNwb25zZS5lcnJvck1lc3NhZ2UgPT09IFwic3RyaW5nXCIgJiYgcmVzcG9uc2UuZXJyb3JNZXNzYWdlLmxlbmd0aCA+IDBcbiAgICBjb25zdCBoYXNFcnJvckVudmVsb3BlS2V5cyA9IEJvb2xlYW4oXG4gICAgICByZXNwb25zZS5jb2RlICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHJlc3BvbnNlLmVycm9yICE9PSB1bmRlZmluZWRcbiAgICAgIHx8IHJlc3BvbnNlLmVycm9ycyAhPT0gdW5kZWZpbmVkXG4gICAgICB8fCByZXNwb25zZS5tZXNzYWdlICE9PSB1bmRlZmluZWRcbiAgICApXG4gICAgY29uc3Qgbm9uU3RhdHVzS2V5cyA9IHJlc3BvbnNlS2V5cy5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcInN0YXR1c1wiKVxuICAgIGNvbnN0IGNvbmZpZ3VyZWRBdHRyaWJ1dGVOYW1lcyA9IHRoaXMuY29uZmlndXJlZEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVOYW1lcygpXG4gICAgY29uc3QgbG9va3NMaWtlUmF3TW9kZWxQYXlsb2FkID0gbm9uU3RhdHVzS2V5cy5sZW5ndGggPiAwXG4gICAgICAmJiBub25TdGF0dXNLZXlzLmV2ZXJ5KChrZXkpID0+IGNvbmZpZ3VyZWRBdHRyaWJ1dGVOYW1lcy5oYXMoa2V5KSlcblxuICAgIGlmICghaGFzRXJyb3JNZXNzYWdlICYmICFoYXNPbmx5U3RhdHVzICYmICFoYXNFcnJvckVudmVsb3BlS2V5cyAmJiBsb29rc0xpa2VSYXdNb2RlbFBheWxvYWQpIHJldHVyblxuXG4gICAgY29uc3QgZGVidWdFcnJvck1lc3NhZ2UgPSB0eXBlb2YgcmVzcG9uc2UuZGVidWdFcnJvck1lc3NhZ2UgPT09IFwic3RyaW5nXCIgJiYgcmVzcG9uc2UuZGVidWdFcnJvck1lc3NhZ2UubGVuZ3RoID4gMFxuICAgICAgPyByZXNwb25zZS5kZWJ1Z0Vycm9yTWVzc2FnZVxuICAgICAgOiBudWxsXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZGVidWdFcnJvck1lc3NhZ2UgfHwgKGhhc0Vycm9yTWVzc2FnZVxuICAgICAgPyByZXNwb25zZS5lcnJvck1lc3NhZ2VcbiAgICAgIDogYFJlcXVlc3QgZmFpbGVkIGZvciAke3RoaXMubmFtZX0jJHtjb21tYW5kVHlwZX1gKVxuXG4gICAgY29uc3QgZXJyb3IgPSAvKiogQHR5cGUge0Vycm9yICYge2NvcnJlbGF0aW9uSWQ/OiBzdHJpbmcsIGRldGFpbHM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGVycm9yTWVzc2FnZT86IHN0cmluZywgdmVsb2Npb3VzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBlcnJvclR5cGU/OiBzdHJpbmcsIHZhbGlkYXRpb25FcnJvcnM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGRlYnVnRXJyb3JDbGFzcz86IHN0cmluZywgZGVidWdCYWNrdHJhY2U/OiBzdHJpbmdbXX19ICovIChuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKSlcbiAgICBpZiAoaGFzRXJyb3JNZXNzYWdlKSB7XG4gICAgICBlcnJvci5lcnJvck1lc3NhZ2UgPSByZXNwb25zZS5lcnJvck1lc3NhZ2VcbiAgICB9XG4gICAgaWYgKHJlc3BvbnNlLnZlbG9jaW91cyAmJiB0eXBlb2YgcmVzcG9uc2UudmVsb2Npb3VzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBlcnJvci52ZWxvY2lvdXMgPSByZXNwb25zZS52ZWxvY2lvdXNcbiAgICB9XG4gICAgaWYgKHR5cGVvZiByZXNwb25zZS5lcnJvclR5cGUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGVycm9yLmVycm9yVHlwZSA9IHJlc3BvbnNlLmVycm9yVHlwZVxuICAgIH1cbiAgICBpZiAocmVzcG9uc2UudmFsaWRhdGlvbkVycm9ycyAmJiB0eXBlb2YgcmVzcG9uc2UudmFsaWRhdGlvbkVycm9ycyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgZXJyb3IudmFsaWRhdGlvbkVycm9ycyA9IHJlc3BvbnNlLnZhbGlkYXRpb25FcnJvcnNcbiAgICB9XG4gICAgaWYgKHJlc3BvbnNlLmRldGFpbHMgJiYgdHlwZW9mIHJlc3BvbnNlLmRldGFpbHMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGVycm9yLmRldGFpbHMgPSByZXNwb25zZS5kZXRhaWxzXG4gICAgfVxuICAgIGlmICh0eXBlb2YgcmVzcG9uc2UuY29ycmVsYXRpb25JZCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgZXJyb3IuY29ycmVsYXRpb25JZCA9IHJlc3BvbnNlLmNvcnJlbGF0aW9uSWRcbiAgICB9XG4gICAgLy8gRm9yd2FyZCBzZXJ2ZXItcHJvdmlkZWQgZGVidWcgZGV0YWlsIChpbmNsdWRlZCBvbmx5IHdoZW4gdGhlIGJhY2tlbmRcbiAgICAvLyBkZWVtcyB0aGUgcmVxdWVzdGVyIGFsbG93ZWQgdG8gc2VlIGl0LCBlLmcuIGFuIGFkbWluKSBzbyBjYWxsZXJzIGNhblxuICAgIC8vIHJlbmRlciB0aGUgcmVhbCBlcnJvciBjbGFzcyBhbmQgc3RhY2sgdHJhY2UgaW5zdGVhZCBvZiB0aGUgZ2VuZXJpY1xuICAgIC8vIGNsaWVudC1zYWZlIG1lc3NhZ2UuXG4gICAgaWYgKHR5cGVvZiByZXNwb25zZS5kZWJ1Z0Vycm9yQ2xhc3MgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGVycm9yLmRlYnVnRXJyb3JDbGFzcyA9IHJlc3BvbnNlLmRlYnVnRXJyb3JDbGFzc1xuICAgIH1cbiAgICBpZiAoQXJyYXkuaXNBcnJheShyZXNwb25zZS5kZWJ1Z0JhY2t0cmFjZSkpIHtcbiAgICAgIGVycm9yLmRlYnVnQmFja3RyYWNlID0gcmVzcG9uc2UuZGVidWdCYWNrdHJhY2VcbiAgICB9XG4gICAgdGhyb3cgZXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbmZpZ3VyZWQgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIG5hbWVzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gQ29uZmlndXJlZCBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqL1xuICBzdGF0aWMgY29uZmlndXJlZEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVOYW1lcygpIHtcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodGhpcy5yZXNvdXJjZUNvbmZpZygpKVxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSByZXNvdXJjZUNvbmZpZy5hdHRyaWJ1dGVzXG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVzKSkge1xuICAgICAgcmV0dXJuIG5ldyBTZXQoYXR0cmlidXRlcy5maWx0ZXIoKGF0dHJpYnV0ZU5hbWUpID0+IHR5cGVvZiBhdHRyaWJ1dGVOYW1lID09PSBcInN0cmluZ1wiKSlcbiAgICB9XG5cbiAgICBpZiAoYXR0cmlidXRlcyAmJiB0eXBlb2YgYXR0cmlidXRlcyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgcmV0dXJuIG5ldyBTZXQoT2JqZWN0LmtleXMoYXR0cmlidXRlcykpXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBTZXQoKVxuICB9XG59XG5cbi8qKiBQdWJsaWMgZnJvbnRlbmQgbW9kZWwgZm9yIHNhZmUgVmVsb2Npb3VzIGF0dGFjaG1lbnQgbWV0YWRhdGEuICovXG5leHBvcnQgY2xhc3MgVmVsb2Npb3VzQXR0YWNobWVudCBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnfSAtIFJlc291cmNlIGNvbmZpZy5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcbiAgICByZXR1cm4ge1xuICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICBieXRlU2l6ZToge3R5cGU6IFwiaW50ZWdlclwifSxcbiAgICAgICAgY29udGVudFR5cGU6IHtudWxsOiB0cnVlLCB0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgICAgIGNyZWF0ZWRBdDoge3R5cGU6IFwiZGF0ZXRpbWVcIn0sXG4gICAgICAgIGZpbGVuYW1lOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgICAgICBpZDoge3R5cGU6IFwidXVpZFwifSxcbiAgICAgICAgbmFtZToge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICAgICAgcG9zaXRpb246IHt0eXBlOiBcImludGVnZXJcIn0sXG4gICAgICAgIHJlY29yZElkOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgICAgICByZWNvcmRUeXBlOiB7dHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgICAgICB1cGRhdGVkQXQ6IHt0eXBlOiBcImRhdGV0aW1lXCJ9XG4gICAgICB9LFxuICAgICAgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kczogW1wiaW5kZXhcIl0sXG4gICAgICBidWlsdEluTWVtYmVyQ29tbWFuZHM6IFtcImZpbmRcIl0sXG4gICAgICBtb2RlbE5hbWU6IFwiVmVsb2Npb3VzQXR0YWNobWVudFwiLFxuICAgICAgcHJpbWFyeUtleTogXCJpZFwiXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgaWQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0YWNobWVudCBpZC5cbiAgICovXG4gIGlkKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwiaWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBvd25lciBtb2RlbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE93bmVyIG1vZGVsIG5hbWUuXG4gICAqL1xuICByZWNvcmRUeXBlKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwicmVjb3JkVHlwZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIG93bmVyIHJlY29yZCBpZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBPd25lciByZWNvcmQgaWQuXG4gICAqL1xuICByZWNvcmRJZCgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcInJlY29yZElkXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBuYW1lIG9uIHRoZSBvd25lciBtb2RlbC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBdHRhY2htZW50IG5hbWUgb24gdGhlIG93bmVyIG1vZGVsLlxuICAgKi9cbiAgbmFtZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcIm5hbWVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IHBvc2l0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEF0dGFjaG1lbnQgcG9zaXRpb24uXG4gICAqL1xuICBwb3NpdGlvbigpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcInBvc2l0aW9uXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBmaWxlbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBdHRhY2htZW50IGZpbGVuYW1lLlxuICAgKi9cbiAgZmlsZW5hbWUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJmaWxlbmFtZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgY29udGVudCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBBdHRhY2htZW50IGNvbnRlbnQgdHlwZS5cbiAgICovXG4gIGNvbnRlbnRUeXBlKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwiY29udGVudFR5cGVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IGJ5dGUgc2l6ZS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBBdHRhY2htZW50IGJ5dGUgc2l6ZS5cbiAgICovXG4gIGJ5dGVTaXplKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwiYnl0ZVNpemVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjcmVhdGVkLWF0IHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge0RhdGV9IC0gQ3JlYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqL1xuICBjcmVhdGVkQXQoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJjcmVhdGVkQXRcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSB1cGRhdGVkLWF0IHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge0RhdGV9IC0gVXBkYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqL1xuICB1cGRhdGVkQXQoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJ1cGRhdGVkQXRcIikgfVxufVxuXG5Gcm9udGVuZE1vZGVsQmFzZS5yZWdpc3Rlck1vZGVsKFZlbG9jaW91c0F0dGFjaG1lbnQpXG4iXX0=