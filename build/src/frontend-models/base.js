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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbHMvYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxPQUFPLE1BQU0sMkJBQTJCLENBQUE7QUFDL0MsT0FBTyxJQUFJLE1BQU0sd0JBQXdCLENBQUE7QUFDekMsT0FBTyxrQkFBa0IsRUFBRSxFQUFDLGdDQUFnQyxFQUFDLE1BQU0sWUFBWSxDQUFBO0FBQy9FLE9BQU8sc0JBQXNCLE1BQU0sZ0JBQWdCLENBQUE7QUFDbkQsT0FBTyxFQUFDLDJCQUEyQixFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0UsT0FBTyxFQUFDLHFCQUFxQixFQUFFLHlCQUF5QixFQUFDLE1BQU0scUJBQXFCLENBQUE7QUFDcEYsT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGlDQUFpQyxFQUFDLE1BQU0saUNBQWlDLENBQUE7QUFDM0gsT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDekgsT0FBTyx3QkFBd0IsTUFBTSx5QkFBeUIsQ0FBQTtBQUM5RCxPQUFPLEVBQUMsd0JBQXdCLEVBQUUsZ0JBQWdCLEVBQUMsTUFBTSxpQkFBaUIsQ0FBQTtBQUMxRSxPQUFPLHdCQUF3QixNQUFNLG9DQUFvQyxDQUFBO0FBQ3pFLE9BQU8sRUFBQyx1QkFBdUIsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ3BFLE9BQU8sRUFBQyx3Q0FBd0MsRUFBRSxzQ0FBc0MsRUFBQyxNQUFNLDZCQUE2QixDQUFBO0FBQzVILE9BQU8sRUFBQyxtQkFBbUIsRUFBRSwyQkFBMkIsRUFBRSwyQkFBMkIsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ3hILE9BQU8sRUFBQyxnQkFBZ0IsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQ3hELE9BQU8sYUFBYSxNQUFN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KiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCB0aW1lb3V0IGZyb20gXCJhd2FpdGVyeS9idWlsZC90aW1lb3V0LmpzXCJcbmltcG9ydCB3YWl0IGZyb20gXCJhd2FpdGVyeS9idWlsZC93YWl0LmpzXCJcbmltcG9ydCBGcm9udGVuZE1vZGVsUXVlcnksIHtmcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZH0gZnJvbSBcIi4vcXVlcnkuanNcIlxuaW1wb3J0IEZyb250ZW5kTW9kZWxQcmVsb2FkZXIgZnJvbSBcIi4vcHJlbG9hZGVyLmpzXCJcbmltcG9ydCB7bm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlfSBmcm9tIFwiLi4vZGF0YWJhc2UvZGF0ZXRpbWUtc3RvcmFnZS5qc1wiXG5pbXBvcnQge3JlZ2lzdGVyRnJvbnRlbmRNb2RlbCwgcmVzb2x2ZUZyb250ZW5kTW9kZWxDbGFzc30gZnJvbSBcIi4vbW9kZWwtcmVnaXN0cnkuanNcIlxuaW1wb3J0IHt2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbW1hbmROYW1lLCB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGh9IGZyb20gXCIuL3Jlc291cmNlLWNvbmZpZy12YWxpZGF0aW9uLmpzXCJcbmltcG9ydCB7ZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUsIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gZnJvbSBcIi4vdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIlxuaW1wb3J0IHJ1bldpdGhUcmFuc3BvcnREZWFkbGluZSBmcm9tIFwiLi90cmFuc3BvcnQtZGVhZGxpbmUuanNcIlxuaW1wb3J0IHtSRVFVRVNUX1RJTUVfWk9ORV9IRUFERVIsIHZhbGlkYXRlVGltZVpvbmV9IGZyb20gXCIuLi90aW1lLXpvbmUuanNcIlxuaW1wb3J0IFZlbG9jaW91c1dlYnNvY2tldENsaWVudCBmcm9tIFwiLi4vaHR0cC1jbGllbnQvd2Vic29ja2V0LWNsaWVudC5qc1wiXG5pbXBvcnQge3JlbW90ZVJlcXVlc3RDb250ZXh0S2V5fSBmcm9tIFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiXG5pbXBvcnQge2NhcHR1cmVGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQsIG1lcmdlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0fSBmcm9tIFwiLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCJcbmltcG9ydCB7YnVmZmVyT3V0Z29pbmdFdmVudCwgY2xlYXJCdWZmZXJlZE91dGdvaW5nRXZlbnRzLCBkcmFpbkJ1ZmZlcmVkT3V0Z29pbmdFdmVudHN9IGZyb20gXCIuL291dGdvaW5nLWV2ZW50LWJ1ZmZlci5qc1wiXG5pbXBvcnQge2RlZmluZU1vZGVsU2NvcGV9IGZyb20gXCIuLi91dGlscy9tb2RlbC1zY29wZS5qc1wiXG5pbXBvcnQgaXNQbGFpbk9iamVjdCBmcm9tIFwiLi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCB7Zm9yY2VkTm9uQmxhbmtTdHJpbmd9IGZyb20gXCJ0eXBhbmljXCJcbmltcG9ydCB7bW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXksIG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMsIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5LCBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCB7cmVhZFBheWxvYWRBc3NvY2lhdGlvbkNvdW50LCByZWFkUGF5bG9hZENvbXB1dGVkQWJpbGl0eSwgcmVhZFBheWxvYWRRdWVyeURhdGEsIHNldFBheWxvYWRBc3NvY2lhdGlvbkNvdW50LCBzZXRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5LCBzZXRQYXlsb2FkUXVlcnlEYXRhfSBmcm9tIFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCJcblxuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCByZWxhdGlvbnNoaXAgaGVscGVyIHR5cGUuIFJldHVybmVkIGJ5IGBnZXRSZWxhdGlvbnNoaXBCeU5hbWVgLFxuICogd2hpY2ggZ2VuZXJhdGVkIG1vZGVscyBpbW1lZGlhdGVseSBjYXN0IHRvIHRoZWlyIGNvbmNyZXRlIHJlbGF0aW9uc2hpcCB0eXBlXG4gKiAoZS5nLiBgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwPE93bmVyLCBUYXJnZXQsIFRhcmdldENyZWF0ZUF0dHJpYnV0ZXM+YCkuXG4gKiBUaGUgbWVtYmVycyB1c2UgYGFueWAgdHlwZSBhcmdzIHNvIHRoYXQgY2FzdCBpcyBhbGxvd2VkIHJlZ2FyZGxlc3Mgb2YgdGhlXG4gKiB0YXJnZXQgbW9kZWwncyB0eXBlZC1hdHRyaWJ1dGUgZ2VuZXJpY3Mg4oCUIGEgY29uY3JldGUgYEZyb250ZW5kTW9kZWxCYXNlYCBtZW1iZXJcbiAqIGhlcmUgbWFrZXMgdGhlIGNhc3QgYSBub24tb3ZlcmxhcHBpbmcgKFRTMjM1MikgZXJyb3IgZm9yIGV2ZXJ5IHR5cGVkIG1vZGVsLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwPGFueSwgYW55LCBhbnk+IHwgRnJvbnRlbmRNb2RlbFNpbmd1bGFyUmVsYXRpb25zaGlwPGFueSwgYW55LCBhbnk+fSBGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2NhbGxiYWNrOiAocGF5bG9hZDoge2lkOiBzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZSwgbW9kZWw6IEZyb250ZW5kTW9kZWxCYXNlfSkgPT4gdm9pZCwgZXZlbnRGaWx0ZXJLZXk6IHN0cmluZyB8IG51bGwsIGV2ZW50RmlsdGVyUGF5bG9hZDogaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkIHwgbnVsbCwgcHJvamVjdGlvblBheWxvYWQ6IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfX0gRnJvbnRlbmRNb2RlbE1vZGVsRXZlbnRDYWxsYmFja0VudHJ5XG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2NhbGxiYWNrOiAocGF5bG9hZDoge2lkOiBzdHJpbmcgfCBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Db21wb3NpdGVNb2RlbFByaW1hcnlLZXlWYWx1ZX0pID0+IHZvaWR9fSBGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50Q2FsbGJhY2tFbnRyeVxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxDb21tYW5kVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge1wiY3JlYXRlXCIgfCBcImZpbmRcIiB8IFwiaW5kZXhcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGUgKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSB0eXBlLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxDb21tYW5kVHlwZSB8IHN0cmluZ30gRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSAqL1xuLyoqXG4gKiBNb2RlbC1saWtlIGluc3RhbmNlIHZhbHVlIHN1cHBvcnRlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQuXG4gKiBAdHlwZWRlZiB7e2F0dHJpYnV0ZXM6ICgpID0+IFJlY29yZDxzdHJpbmcsIHVua25vd24+fX0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydE1vZGVsVmFsdWVcbiAqL1xuLyoqXG4gKiBTcGVjaWFsIHNjYWxhciB2YWx1ZXMgcmVzdG9yZWQgYnkgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0LlxuICogQHR5cGVkZWYge3VuZGVmaW5lZCB8IG51bGwgfCBib29sZWFuIHwgbnVtYmVyIHwgc3RyaW5nIHwgYmlnaW50IHwgRGF0ZSB8IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRNb2RlbFZhbHVlfSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0U2NhbGFyVmFsdWVcbiAqL1xuLyoqXG4gKiBQbGFpbiBvYmplY3Qgc3VwcG9ydGVkIGJ5IGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCB2YWx1ZXMuXG4gKiBOZXN0ZWQgdmFsdWVzIGFyZSBpbnRlbnRpb25hbGx5IG9wYXF1ZSBiZWNhdXNlIFR5cGVTY3JpcHQgcmVqZWN0cyByZWN1cnNpdmVcbiAqIEpTRG9jIHR5cGVkZWZzIGZvciB0aGlzIHRyYW5zcG9ydCB2YWx1ZSBjb250cmFjdC5cbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydE9iamVjdFxuICovXG4vKipcbiAqIFZhbHVlIHN1cHBvcnRlZCBieSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgc2VyaWFsaXphdGlvbiBhbmQgZGVzZXJpYWxpemF0aW9uLlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxUcmFuc3BvcnRTY2FsYXJWYWx1ZSB8IEZyb250ZW5kTW9kZWxUcmFuc3BvcnRPYmplY3QgfCBBcnJheTx1bmtub3duPn0gRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlXG4gKi9cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIHZhbHVlIHVzZWQgd2hlbiBnZW5lcmF0ZWQgbWV0YWRhdGEgY2Fubm90IGluZmVyIGEgbmFycm93ZXIgdHlwZS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3t0eXBlOiBcImhhc09uZVwiIHwgXCJoYXNNYW55XCJ9fSBGcm9udGVuZE1vZGVsQXR0YWNobWVudERlZmluaXRpb25cbiAqL1xuLyoqXG4gKiBEZWZpbmVzIGZyb250ZW5kLW1vZGVsIGF0dHJpYnV0ZSBtZXRhZGF0YS5cbiAqIEB0eXBlZGVmIHt7Y29sdW1uVHlwZT86IHN0cmluZywgZGF0YVR5cGU/OiBzdHJpbmcsIGpzRG9jVHlwZT86IHN0cmluZywgbmFtZT86IHN0cmluZywgbnVsbD86IGJvb2xlYW4sIHNlbGVjdGVkQnlEZWZhdWx0PzogYm9vbGVhbiwgc3FsVHlwZT86IHN0cmluZywgdHlwZT86IHN0cmluZ319IEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVEZWZpbml0aW9uXG4gKi9cbi8qKlxuICogQXR0YWNobWVudCBpbnB1dCBhY2NlcHRlZCBieSBmcm9udGVuZC1tb2RlbCBhdHRhY2htZW50IGhlbHBlcnMgYmVmb3JlIG5vcm1hbGl6YXRpb24uXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwge2FycmF5QnVmZmVyOiAoKSA9PiBQcm9taXNlPEFycmF5QnVmZmVyPiwgdHlwZT86IHN0cmluZywgbmFtZT86IHN0cmluZ30gfCBudWxsIHwgdW5kZWZpbmVkfSBGcm9udGVuZE1vZGVsQXR0YWNobWVudElucHV0XG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gRnJvbnRlbmRNb2RlbFN5bmNNZXRhZGF0YVxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge1wib3B0aW1pc3RpY1ZlcnNpb25cIiB8IFwic2VydmVyV2luc1wiIHwgXCJsYXN0V3JpdGVyV2luc1wiIHwgXCJmaWVsZFRocmVlV2F5XCIgfCBcImFwcGVuZE9ubHlcIn0gRnJvbnRlbmRNb2RlbFN5bmNDb25mbGljdFN0cmF0ZWd5XG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2VuYWJsZWQ6IGJvb2xlYW4sIG9wZXJhdGlvbnM6IHN0cmluZ1tdLCBwb2xpY3lIYXNoOiBzdHJpbmcsIHBvbGljeVZlcnNpb246IHN0cmluZyB8IG51bGwsIGNvbmZsaWN0U3RyYXRlZ3k/OiBGcm9udGVuZE1vZGVsU3luY0NvbmZsaWN0U3RyYXRlZ3ksIG1ldGFkYXRhPzogRnJvbnRlbmRNb2RlbFN5bmNNZXRhZGF0YX19IEZyb250ZW5kTW9kZWxTeW5jQ29uZmlnXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2F0dHJpYnV0ZXM/OiBBcnJheTxzdHJpbmcgfCBGcm9udGVuZE1vZGVsQXR0cmlidXRlRGVmaW5pdGlvbj4gfCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlRGVmaW5pdGlvbj4sIGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHM/OiBzdHJpbmdbXSwgYnVpbHRJbk1lbWJlckNvbW1hbmRzPzogc3RyaW5nW10sIGNvbGxlY3Rpb25Db21tYW5kcz86IHN0cmluZ1tdLCBjb21tYW5kcz86IHN0cmluZ1tdLCBtZW1iZXJDb21tYW5kcz86IHN0cmluZ1tdLCBhdHRhY2htZW50cz86IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRhY2htZW50RGVmaW5pdGlvbj4sIG1vZGVsTmFtZT86IHN0cmluZywgbmVzdGVkQXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHthbGxvd0Rlc3Ryb3k/OiBib29sZWFuLCBsaW1pdD86IG51bWJlcn0+LCBwcmltYXJ5S2V5Pzogc3RyaW5nIHwgc3RyaW5nW10sIHJlbGF0aW9uc2hpcHM/OiBzdHJpbmdbXSwgc3luYz86IEZyb250ZW5kTW9kZWxTeW5jQ29uZmlnfX0gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlnXG4gKi9cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgY29uc3RydWN0b3IgdHlwZS5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbEJhc2V9IFtUPUZyb250ZW5kTW9kZWxCYXNlXVxuICogQHR5cGVkZWYge3tuZXcgKGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+KTogVH19IEZyb250ZW5kTW9kZWxDb25zdHJ1Y3RvclxuICovXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIHN0YXRpYyBzaWRlLlxuICpcbiAqIFRoZSB0ZW1wbGF0ZSBkZWZhdWx0cyBhcmUgaW50ZW50aW9uYWxseSBwZXJtaXNzaXZlIChgYW55YCBtb2RlbC9hdHRyaWJ1dGVcbiAqIHBhcmFtcykuIFRoZSBiYXJlIGBGcm9udGVuZE1vZGVsQ2xhc3NgIGlzIHRoZSBgQHRoaXNgL2NvbnN0cmFpbnQgdHlwZSBvbiB0aGVcbiAqIHN0YXRpYyBxdWVyeSBtZXRob2RzIChmaW5kQnkvZmluZC93aGVyZS9wcmVsb2FkLy4uLik7IGEgZ2VuZXJhdGVkIHN1YmNsYXNzXG4gKiBkZWNsYXJlcyB0eXBlZC1hdHRyaWJ1dGUgZ2VuZXJpY3MgKGUuZy4gYEZyb250ZW5kTW9kZWxCYXNlPEFjY291bnRBdHRyaWJ1dGVzLFxuICogQWNjb3VudENyZWF0ZUF0dHJpYnV0ZXMsIEFjY291bnRVcGRhdGVBdHRyaWJ1dGVzPmApIHdoaWNoLCBhZ2FpbnN0IGEgY29uY3JldGVcbiAqIGBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+YCBkZWZhdWx0LCBmYWlsIHRoZSBjb25zdHJhaW50IGJ5XG4gKiBpbnZhcmlhbmNlLiBEZWZhdWx0aW5nIHRvIGBhbnlgIGxldHMgYW55IHN1YmNsYXNzIHNhdGlzZnkgdGhlIGNvbnN0cmFpbnQgd2hpbGVcbiAqIHRoZSBtZXRob2RzJyBvd24gYEB0ZW1wbGF0ZSBUYCBzdGlsbCBjYXB0dXJlcyB0aGUgcHJlY2lzZSBjYWxsaW5nIGNsYXNzIGZvclxuICogdGhlaXIgcmV0dXJuIHR5cGVzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZX0gW1Q9RnJvbnRlbmRNb2RlbEJhc2U8YW55LCBhbnksIGFueT5dXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW0F0dHJpYnV0ZXM9YW55XVxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtDcmVhdGVBdHRyaWJ1dGVzPWFueV1cbiAqIEB0eXBlZGVmIHt7bmV3ICgpOiBULCBjcmVhdGUoYXR0cmlidXRlcz86IENyZWF0ZUF0dHJpYnV0ZXMpOiBQcm9taXNlPFQ+fSAmIE9taXQ8dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlLCBcImNyZWF0ZVwiIHwgXCJwcm90b3R5cGVcIj59IEZyb250ZW5kTW9kZWxDbGFzc1xuICovXG4vKipcbiAqIENyZWF0ZSBhdHRyaWJ1dGVzIGFjY2VwdGVkIGJ5IGEgZnJvbnRlbmQgbW9kZWwgaW5zdGFuY2UuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlfSBUXG4gKiBAdHlwZWRlZiB7VCBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlPFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4sIGluZmVyIENyZWF0ZUF0dHJpYnV0ZXMsIGluZmVyIF9VcGRhdGVBdHRyaWJ1dGVzPiA/IENyZWF0ZUF0dHJpYnV0ZXMgOiBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSBGcm9udGVuZE1vZGVsQ3JlYXRlQXR0cmlidXRlc0ZvclxuICovXG4vKipcbiAqIExvYWRlZCBpbnN0YW5jZSB0eXBlIGZvciByZWxhdGlvbnNoaXAgaGVscGVyIGdlbmVyaWNzLiBPbGRlciBnZW5lcmF0ZWRcbiAqIGZyb250ZW5kIG1vZGVscyBwYXNzZWQgbW9kZWwgY2xhc3NlcyBpbnRvIHJlbGF0aW9uc2hpcCBoZWxwZXJzLCB3aGlsZSBuZXdlclxuICogZ2VuZXJhdGVkIG1vZGVscyBwYXNzIGluc3RhbmNlIHR5cGVzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gVFxuICogQHR5cGVkZWYge1QgZXh0ZW5kcyB0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2UgPyBJbnN0YW5jZVR5cGU8VD4gOiBUfSBGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWxcbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnXG4gKiBAcHJvcGVydHkge3N0cmluZyB8ICgoKSA9PiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKX0gW3VybF0gLSBPcHRpb25hbCBmcm9udGVuZC1tb2RlbCBVUkwuIFRoaXMgc2hvdWxkIGJlIHRoZSBzaGFyZWQgZW5kcG9pbnQgKGZvciBleGFtcGxlIGBcIi9mcm9udGVuZC1tb2RlbHNcImAgb3IgYFwiaHR0cHM6Ly9leGFtcGxlLmNvbS9mcm9udGVuZC1tb2RlbHNcImApLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbc2hhcmVkXSAtIERlcHJlY2F0ZWQgc2hhcmVkLWVuZHBvaW50IGZsYWcgcmV0YWluZWQgZm9yIGNvbXBhdGliaWxpdHkuIEZyb250ZW5kLW1vZGVsIENSVUQvY3VzdG9tIGNvbW1hbmRzIHVzZSB0aGUgc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSBlbnZlbG9wZSBieSBkZWZhdWx0LlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCAoKCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCl9IFt3ZWJzb2NrZXRVcmxdIC0gT3B0aW9uYWwgd2Vic29ja2V0IFVSTC4gV2hlbiBzZXQsIFZlbG9jaW91cyBjcmVhdGVzIGFuZCBtYW5hZ2VzIGl0cyBvd24gd2Vic29ja2V0IGNsaWVudCBpbnRlcm5hbGx5LiBTdWJzY3JpcHRpb25zIHVzZSB0aGUgd2Vic29ja2V0OyBDUlVEIHVzZXMgSFRUUCBhbmQgZmFsbHMgYmFjayBncmFjZWZ1bGx5LiBFeGFtcGxlOiBgXCJ3czovL2xvY2FsaG9zdDozMDA2L3dlYnNvY2tldFwiYC5cbiAqIEBwcm9wZXJ0eSB7e3Bvc3Q6IChwYXRoOiBzdHJpbmcsIGJvZHk/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgb3B0aW9ucz86IHtoZWFkZXJzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPiwgc2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPHtqc29uOiAoKSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+LCBzdWJzY3JpYmU6IChjaGFubmVsOiBzdHJpbmcsIG9wdGlvbnM6IHtwYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59LCBjYWxsYmFjazogKHBheWxvYWQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiB2b2lkKSA9PiAoKCkgPT4gdm9pZCksIHN1YnNjcmliZUFuZFdhaXQ/OiAoY2hhbm5lbDogc3RyaW5nLCBvcHRpb25zOiB7cGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSwgY2FsbGJhY2s6IChwYXlsb2FkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZCkgPT4gUHJvbWlzZTwoKCkgPT4gdm9pZCk+fX0gW3dlYnNvY2tldENsaWVudF0gLSBPcHRpb25hbCB3ZWJzb2NrZXQgY2xpZW50IGZvciBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJIHJlcXVlc3RzIGFuZCBzdWJzY3JpcHRpb25zLiBJdHMgYHBvc3RgIHJlY2VpdmVzIHRoZSBib3VuZGVkLWRlYWRsaW5lIGBzaWduYWxgIGFuZCBzaG91bGQgZm9yd2FyZCBpdCBpbnRvIHRoZSB1bmRlcmx5aW5nIHRyYW5zcG9ydCBzbyB0aGUgZGVhZGxpbmUgY2FuIGFib3J0IHRoZSBsaXZlIHJlcXVlc3QgYW5kIGl0cyByZXNwb25zZS1ib2R5IHJlYWQuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIHN0cmluZz4gfCAoKCkgPT4gUmVjb3JkPHN0cmluZywgc3RyaW5nPil9IFtyZXF1ZXN0SGVhZGVyc10gLSBFeHRyYSBIVFRQL1dTIGhlYWRlcnMgdG8gYXR0YWNoIHRvIGV2ZXJ5IGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0LiBQYXNzIGEgZnVuY3Rpb24gdG8gY29tcHV0ZSB0aGVtIGF0IHJlcXVlc3QgdGltZSAoZm9yIGV4YW1wbGUgdG8gaW5jbHVkZSB0aGUgY3VycmVudCBsb2NhbGUpLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0IHwgKCgpID0+IGltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHQgfCB1bmRlZmluZWQgfCBudWxsKX0gW3JlcXVlc3RDb250ZXh0XSAtIEltbXV0YWJsZSBzY2FsYXIgY29udGV4dCBjYXB0dXJlZCBpbmRlcGVuZGVudGx5IHdoZW4gZWFjaCBvcGVyYXRpb24gb3IgZXZlbnQgc3Vic2NyaXB0aW9uIHN0YXJ0cyBhbmQgc2VudCBmb3IgcmVtb3RlIHRlbmFudC9hYmlsaXR5IHJlc29sdXRpb24uXG4gKiBAcHJvcGVydHkge251bWJlciB8ICgoKSA9PiBudW1iZXIgfCB1bmRlZmluZWQgfCBudWxsKX0gW3RpbWVvdXRdIC0gQm91bmRlZCBkZWFkbGluZSBpbiBtaWxsaXNlY29uZHMgY292ZXJpbmcgY29ubmVjdGlvbiwgcmVzcG9uc2UgaGVhZGVycywgYW5kIHJlc3BvbnNlLWJvZHkgY29uc3VtcHRpb24gZm9yIGVhY2ggZnJvbnRlbmQtbW9kZWwgQVBJIHJlcXVlc3QuIE9uIGV4cGlyeSB0aGUgbGl2ZSBmZXRjaC9hZGFwdGVyIHJlcXVlc3QgaXMgYWJvcnRlZCAoYnVpbHQgb24gYXdhaXRlcnkncyBgdGltZW91dGApIGFuZCBhd2FpdGVyeSdzIGBUaW1lb3V0RXJyb3JgIGlzIHRocm93biwgc28gY2FsbGVycyBjYW4gY2xhc3NpZnkgYSB0aW1lb3V0IHZpYSBgZXJyb3IgaW5zdGFuY2VvZiBUaW1lb3V0RXJyb3JgLiBQYXNzIGEgZnVuY3Rpb24gdG8gcmVzb2x2ZSBpdCBwZXIgcmVxdWVzdC4gRmFsc3kvYWJzZW50IG1lYW5zIG5vIGRlYWRsaW5lLlxuICogQHByb3BlcnR5IHtBYm9ydFNpZ25hbCB8ICgoKSA9PiBBYm9ydFNpZ25hbCB8IHVuZGVmaW5lZCB8IG51bGwpfSBbc2lnbmFsXSAtIE9wdGlvbmFsIGNhbGxlci9zZXNzaW9uIEFib3J0U2lnbmFsIGNvbXBvc2VkIHdpdGggdGhlIGRlYWRsaW5lLiBBYm9ydGluZyBpdCBjYW5jZWxzIHRoZSBsaXZlIHJlcXVlc3QgKGZvciBleGFtcGxlIG9uIHNlc3Npb24gc2h1dGRvd24gb3Igb2ZmbGluZSB0cmFuc2l0aW9uKTsgdGhlIHJlc3VsdGluZyBhYm9ydCBlcnJvciBzdGF5cyBkaXN0aW5ndWlzaGFibGUgZnJvbSBhIHRpbWVvdXQuIFBhc3MgYSBmdW5jdGlvbiB0byByZXNvbHZlIHRoZSBjdXJyZW50IHNpZ25hbCBwZXIgcmVxdWVzdC5cbiAqIEBwcm9wZXJ0eSB7e2dldDogKCkgPT4gc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCB8IFByb21pc2U8c3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZD4sIHNldDogKHNlc3Npb25JZDogc3RyaW5nKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPiwgY2xlYXI6ICgpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fX0gW3Nlc3Npb25TdG9yZV0gLSBPcHRpb25hbCBzZXNzaW9uSWQgcGVyc2lzdGVuY2UgaG9vayBmb3J3YXJkZWQgdG8gdGhlIGludGVybmFsIGBWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnRgIHNvIFdTIHNlc3Npb25zIGNhbiBiZSByZXN1bWVkIGFjcm9zcyBwYWdlIHJlbG9hZHMgLyBhcHAgcmVzdGFydHMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8ICgoKSA9PiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkKX0gW3RpbWVab25lXSAtIElBTkEgdGltZXpvbmUgc2VudCB3aXRoIGV2ZXJ5IGZyb250ZW5kLW1vZGVsIEFQSSByZXF1ZXN0IGZvciB0aW1lem9uZS1sZXNzIGRhdGV0aW1lIHBhcnNpbmcuXG4gKiBAcHJvcGVydHkge3thY3RvckRldmljZUlkOiBzdHJpbmcsIGFjdG9yVXNlcklkOiBzdHJpbmcsIGNsaWVudE11dGF0aW9uSWQ/OiAoKSA9PiBzdHJpbmcsIGVuYWJsZWQ/OiBib29sZWFuLCBtdXRhdGlvbkxvZzogaW1wb3J0KFwiLi4vc3luYy9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuZGVmYXVsdCwgbm93PzogKCkgPT4gRGF0ZSwgb2ZmbGluZUdyYW50OiB7aWQ6IHN0cmluZ319fSBbb2ZmbGluZVN5bmNdIC0gT2ZmbGluZSBtdXRhdGlvbiBxdWV1ZSBjb25maWd1cmF0aW9uLlxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxJZGxlV2FpdEFyZ3MgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxJZGxlV2FpdEFyZ3NcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbcXVpZXRNc10gLSBNaWxsaXNlY29uZHMgdGhlIHRyYW5zcG9ydCBtdXN0IHN0YXkgaWRsZSBiZWZvcmUgcmVzb2x2aW5nLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFt0aW1lb3V0XSAtIFRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzLlxuICovXG5cbi8qKlxuICogRnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IGNvbmZpZy5cbiAqIEB0eXBlIHtGcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnfSAqL1xuY29uc3QgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZyA9IHt9XG5jb25zdCBTSEFSRURfRlJPTlRFTkRfTU9ERUxfQVBJX1BBVEggPSBcIi9mcm9udGVuZC1tb2RlbHNcIlxuY29uc3QgUFJFTE9BREVEX1JFTEFUSU9OU0hJUFNfS0VZID0gXCJfX3ByZWxvYWRlZFJlbGF0aW9uc2hpcHNcIlxuY29uc3QgU0VMRUNURURfQVRUUklCVVRFU19LRVkgPSBcIl9fc2VsZWN0ZWRBdHRyaWJ1dGVzXCJcbmNvbnN0IEFTU09DSUFUSU9OX0NPVU5UU19LRVkgPSBcIl9fYXNzb2NpYXRpb25Db3VudHNcIlxuY29uc3QgUVVFUllfREFUQV9LRVkgPSBcIl9fcXVlcnlEYXRhXCJcbmNvbnN0IEFCSUxJVElFU19LRVkgPSBcIl9fYWJpbGl0aWVzXCJcbmNvbnN0IEFUVEFDSE1FTlRfT1dORVJfS0VZID0gXCJfX2F0dGFjaG1lbnRPd25lclwiXG4vKipcbiAqIFBlbmRpbmcgc2hhcmVkIGZyb250ZW5kIG1vZGVsIHJlcXVlc3RzLlxuICogQHR5cGUge0FycmF5PHtjb21tYW5kTmFtZT86IHN0cmluZywgY29tbWFuZFR5cGU6IEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29tbWFuZFR5cGUsIGN1c3RvbVBhdGg/OiBzdHJpbmcsIG1vZGVsQ2xhc3M6IEZyb250ZW5kTW9kZWxDbGFzcywgcGF5bG9hZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCByZXF1ZXN0Q29udGV4dDogaW1wb3J0KFwiLi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dCwgcmVxdWVzdElkOiBzdHJpbmcsIHJlc29sdmU6IChyZXNwb25zZTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiB2b2lkLCByZWplY3Q6IChlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHZvaWQsIHJlc291cmNlUGF0aD86IHN0cmluZyB8IG51bGx9Pn0gKi9cbmxldCBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzID0gW11cblxubGV0IHNoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0SWQgPSAwXG5sZXQgc2hhcmVkRnJvbnRlbmRNb2RlbEZsdXNoU2NoZWR1bGVkID0gZmFsc2VcbmxldCBhY3RpdmVGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdENvdW50ID0gMFxuLyoqXG4gKiBGcm9udGVuZCBtb2RlbCBpZGxlIHJlc29sdmVycy5cbiAqIEB0eXBlIHtBcnJheTwoKSA9PiB2b2lkPn0gKi9cbmxldCBmcm9udGVuZE1vZGVsSWRsZVJlc29sdmVycyA9IFtdXG5cbi8qKlxuICogSW50ZXJuYWwgd2Vic29ja2V0IGNsaWVudC5cbiAqIEB0eXBlIHtWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnQgfCBudWxsfSAqL1xubGV0IGludGVybmFsV2Vic29ja2V0Q2xpZW50ID0gbnVsbFxuLyoqIEB0eXBlIHtBYm9ydFNpZ25hbCB8IG51bGx9ICovXG5sZXQgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwgPSBudWxsXG4vKiogQHR5cGUgeygoKSA9PiB2b2lkKSB8IG51bGx9ICovXG5sZXQgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwID0gbnVsbFxuXG4vKipcbiAqIERldGFjaGVzIGFuIG93bmVkIFdlYlNvY2tldCBjbGllbnQgZnJvbSB0aGUgc2hhcmVkIGNhY2hlIGlmIGl0IGlzIHN0aWxsIGN1cnJlbnQuXG4gKiBAcGFyYW0ge1ZlbG9jaW91c1dlYnNvY2tldENsaWVudH0gY2xpZW50IC0gQ2xpZW50IHdob3NlIG93bmVyc2hpcCBpcyBlbmRpbmcuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gZGV0YWNoSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoY2xpZW50KSB7XG4gIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cblxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudCA9IG51bGxcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwPy4oKVxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudFNpZ25hbCA9IG51bGxcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwID0gbnVsbFxufVxuXG4vKipcbiAqIERpc3Bvc2VzIHRoZSBvd25lZCBXZWJTb2NrZXQgY2xpZW50IGJlZm9yZSB0cmFuc3BvcnQvc2Vzc2lvbiBjb25maWd1cmF0aW9uIGNoYW5nZXMuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gcmVzZXRJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpIHtcbiAgY29uc3QgY2xpZW50ID0gaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRcblxuICBpZiAoIWNsaWVudCkgcmV0dXJuXG5cbiAgZGV0YWNoSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoY2xpZW50KVxuICB2b2lkIGNsaWVudC5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG59XG5cbi8qKlxuICogQmluZHMgdGhlIG93bmVkIFdlYlNvY2tldCBjbGllbnQgbGlmZXRpbWUgdG8gdGhlIGN1cnJlbnQgc2Vzc2lvbiBzaWduYWwuXG4gKiBAcGFyYW0ge0Fib3J0U2lnbmFsIHwgdW5kZWZpbmVkfSBzZXNzaW9uU2lnbmFsIC0gQ3VycmVudCBzZXNzaW9uIHNpZ25hbC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBiaW5kSW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwoc2Vzc2lvblNpZ25hbCkge1xuICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwgPT09IHNlc3Npb25TaWduYWwpIHJldHVyblxuXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cD8uKClcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwgPSBzZXNzaW9uU2lnbmFsIHx8IG51bGxcbiAgaW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWxDbGVhbnVwID0gbnVsbFxuXG4gIGlmICghc2Vzc2lvblNpZ25hbCB8fCAhaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQpIHJldHVyblxuXG4gIGNvbnN0IGNsaWVudCA9IGludGVybmFsV2Vic29ja2V0Q2xpZW50XG4gIGNvbnN0IG9uU2Vzc2lvbkFib3J0ID0gKCkgPT4ge1xuICAgIGRldGFjaEludGVybmFsV2Vic29ja2V0Q2xpZW50KGNsaWVudClcbiAgICBjbGVhckJ1ZmZlcmVkT3V0Z29pbmdFdmVudHMoKVxuICAgIHZvaWQgY2xpZW50LmRpc2Nvbm5lY3RBbmRTdG9wUmVjb25uZWN0KClcbiAgfVxuXG4gIHNlc3Npb25TaWduYWwuYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIG9uU2Vzc2lvbkFib3J0LCB7b25jZTogdHJ1ZX0pXG4gIGludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsQ2xlYW51cCA9ICgpID0+IHNlc3Npb25TaWduYWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIG9uU2Vzc2lvbkFib3J0KVxuXG4gIGlmIChzZXNzaW9uU2lnbmFsLmFib3J0ZWQpIG9uU2Vzc2lvbkFib3J0KClcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBpcyBpZGxlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbGwgcXVldWVkIGFuZCBhY3RpdmUgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHJlcXVlc3RzIGFyZSBkb25lLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0SXNJZGxlKCkge1xuICByZXR1cm4gYWN0aXZlRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3RDb3VudCA9PT0gMFxuICAgICYmIHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMubGVuZ3RoID09PSAwXG4gICAgJiYgIXNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZFxufVxuXG4vKipcbiAqIFJ1bnMgcmVzb2x2ZSBmcm9udGVuZCBtb2RlbCBpZGxlIHdhaXRlcnMuXG4gKiBAcmV0dXJucyB7dm9pZH0gKi9cbmZ1bmN0aW9uIHJlc29sdmVGcm9udGVuZE1vZGVsSWRsZVdhaXRlcnMoKSB7XG4gIGlmICghZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpKSByZXR1cm5cblxuICBjb25zdCByZXNvbHZlcnMgPSBmcm9udGVuZE1vZGVsSWRsZVJlc29sdmVyc1xuICBmcm9udGVuZE1vZGVsSWRsZVJlc29sdmVycyA9IFtdXG5cbiAgZm9yIChjb25zdCByZXNvbHZlIG9mIHJlc29sdmVycykge1xuICAgIHJlc29sdmUoKVxuICB9XG59XG5cbi8qKlxuICogUnVucyB3YWl0IGZvciBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgcXVpZXQgcGVyaW9kLlxuICogQHBhcmFtIHtudW1iZXJ9IG1pbGxpc2Vjb25kcyAtIFF1aWV0IHBlcmlvZCBsZW5ndGguXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHF1aWV0IHBlcmlvZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gd2FpdEZvckZyb250ZW5kTW9kZWxUcmFuc3BvcnRRdWlldFBlcmlvZChtaWxsaXNlY29uZHMpIHtcbiAgaWYgKG1pbGxpc2Vjb25kcyA8PSAwKSByZXR1cm5cblxuICBhd2FpdCB3YWl0KG1pbGxpc2Vjb25kcylcbn1cblxuLyoqXG4gKiBSdW5zIHdhaXQgZm9yIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBpZGxlLlxuICogQHBhcmFtIHtudW1iZXJ9IHF1aWV0TXMgLSBNaWxsaXNlY29uZHMgdGhlIHRyYW5zcG9ydCBtdXN0IHN0YXkgaWRsZSBiZWZvcmUgcmVzb2x2aW5nLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gdHJhbnNwb3J0IHN0YXlzIGlkbGUuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JGcm9udGVuZE1vZGVsVHJhbnNwb3J0SWRsZShxdWlldE1zID0gMCkge1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIGlmIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0SXNJZGxlKCkpIHtcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBxdWV1ZU1pY3JvdGFzaygoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpKVxuXG4gICAgICBpZiAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpKSB7XG4gICAgICAgIGF3YWl0IHdhaXRGb3JGcm9udGVuZE1vZGVsVHJhbnNwb3J0UXVpZXRQZXJpb2QocXVpZXRNcylcblxuICAgICAgICBpZiAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydElzSWRsZSgpKSByZXR1cm5cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgZnJvbnRlbmRNb2RlbElkbGVSZXNvbHZlcnMucHVzaCgoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkpXG4gICAgICB9KVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgdHJhY2sgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHJlcXVlc3QuXG4gKiBAdGVtcGxhdGUgVFxuICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFRyYW5zcG9ydCBjYWxsYmFjay5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gdHJhY2tGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdChjYWxsYmFjaykge1xuICBhY3RpdmVGcm9udGVuZE1vZGVsVHJhbnNwb3J0UmVxdWVzdENvdW50ICs9IDFcblxuICB0cnkge1xuICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gIH0gZmluYWxseSB7XG4gICAgYWN0aXZlRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3RDb3VudCAtPSAxXG4gICAgcmVzb2x2ZUZyb250ZW5kTW9kZWxJZGxlV2FpdGVycygpXG4gIH1cbn1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBpbnRlcm5hbCB3ZWJzb2NrZXQgY2xpZW50IGZyb20gd2Vic29ja2V0VXJsIGNvbmZpZy5cbiAqIENyZWF0ZXMgdGhlIGNsaWVudCBsYXppbHkgb24gZmlyc3QgY2FsbC4gUmV0dXJucyBudWxsIGlmIFdlYlNvY2tldFxuICogaXMgbm90IGF2YWlsYWJsZSBvciB3ZWJzb2NrZXRVcmwgaXMgbm90IGNvbmZpZ3VyZWQuXG4gKiBAcmV0dXJucyB7VmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50IHwgbnVsbH0gV2Vic29ja2V0IGNsaWVudCBvciBudWxsLlxuICovXG5mdW5jdGlvbiByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSB7XG4gIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCkge1xuICAgIGNvbnN0IGNsaWVudCA9IGludGVybmFsV2Vic29ja2V0Q2xpZW50XG5cbiAgICBiaW5kSW50ZXJuYWxXZWJzb2NrZXRDbGllbnRTaWduYWwoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpKVxuXG4gICAgcmV0dXJuIGNsaWVudFxuICB9XG5cbiAgY29uc3Qgd2Vic29ja2V0VXJsID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRVcmxcblxuICBpZiAoIXdlYnNvY2tldFVybCkgcmV0dXJuIG51bGxcbiAgaWYgKHR5cGVvZiBnbG9iYWxUaGlzLldlYlNvY2tldCA9PT0gXCJ1bmRlZmluZWRcIikgcmV0dXJuIG51bGxcblxuICBjb25zdCByZXNvbHZlZFVybCA9IHR5cGVvZiB3ZWJzb2NrZXRVcmwgPT09IFwiZnVuY3Rpb25cIiA/IHdlYnNvY2tldFVybCgpIDogd2Vic29ja2V0VXJsXG5cbiAgaWYgKCFyZXNvbHZlZFVybCkgcmV0dXJuIG51bGxcblxuICBjb25zdCBjbGllbnQgPSBuZXcgVmVsb2Npb3VzV2Vic29ja2V0Q2xpZW50KHtcbiAgICBhdXRvUmVjb25uZWN0OiB0cnVlLFxuICAgIHNlc3Npb25TdG9yZTogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zZXNzaW9uU3RvcmUsXG4gICAgdXJsOiByZXNvbHZlZFVybFxuICB9KVxuICBpbnRlcm5hbFdlYnNvY2tldENsaWVudCA9IGNsaWVudFxuICBjbGllbnQub25SZWNvbm5lY3QgPSBhc3luYyAoKSA9PiBhd2FpdCBmbHVzaEJ1ZmZlcmVkT3V0Z29pbmdFdmVudHNBZnRlclJlY29ubmVjdChjbGllbnQpXG5cbiAgYmluZEludGVybmFsV2Vic29ja2V0Q2xpZW50U2lnbmFsKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSlcblxuICByZXR1cm4gY2xpZW50XG59XG5cbi8qKlxuICogUnVucyBmbHVzaCBidWZmZXJlZCBvdXRnb2luZyBldmVudHMgYWZ0ZXIgcmVjb25uZWN0LlxuICogQHBhcmFtIHtWZWxvY2lvdXNXZWJzb2NrZXRDbGllbnR9IGNsaWVudCAtIFJlY29ubmVjdGVkIGNsaWVudCB0aGF0IG93bnMgdGhpcyBmbHVzaC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAqL1xuYXN5bmMgZnVuY3Rpb24gZmx1c2hCdWZmZXJlZE91dGdvaW5nRXZlbnRzQWZ0ZXJSZWNvbm5lY3QoY2xpZW50KSB7XG4gIGlmIChpbnRlcm5hbFdlYnNvY2tldENsaWVudCAhPT0gY2xpZW50KSByZXR1cm5cblxuICBjb25zdCBldmVudHMgPSBkcmFpbkJ1ZmZlcmVkT3V0Z29pbmdFdmVudHMoKVxuICBjb25zdCBzZXNzaW9uU2lnbmFsID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpXG5cbiAgYXdhaXQgcnVuV2l0aFRyYW5zcG9ydERlYWRsaW5lKFxuICAgIHtcbiAgICAgIGVycm9yTWVzc2FnZTogXCJCdWZmZXJlZCBmcm9udGVuZC1tb2RlbCBXZWJTb2NrZXQgZmx1c2ggdGltZWQgb3V0XCIsXG4gICAgICBzaWduYWw6IHNlc3Npb25TaWduYWwsXG4gICAgICB0aW1lb3V0TXM6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lb3V0TXMoKVxuICAgIH0sXG4gICAgYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGV2ZW50cy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgICAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50ICE9PSBjbGllbnQpIHJldHVyblxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgY2xpZW50LnBvc3QoZXZlbnRzW2luZGV4XS5jdXN0b21QYXRoLCBldmVudHNbaW5kZXhdLnBheWxvYWQsIHtzaWduYWx9KVxuXG4gICAgICAgICAgaWYgKGludGVybmFsV2Vic29ja2V0Q2xpZW50ICE9PSBjbGllbnQpIHJldHVyblxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICBpZiAoaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQgIT09IGNsaWVudCkgcmV0dXJuXG4gICAgICAgICAgaWYgKHNlc3Npb25TaWduYWw/LmFib3J0ZWQpIHJldHVyblxuXG4gICAgICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgICAgICBmb3IgKGxldCByZW1haW5pbmcgPSBpbmRleDsgcmVtYWluaW5nIDwgZXZlbnRzLmxlbmd0aDsgcmVtYWluaW5nICs9IDEpIHtcbiAgICAgICAgICAgICAgYnVmZmVyT3V0Z29pbmdFdmVudChldmVudHNbcmVtYWluaW5nXSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3Qgc29ja2V0T3BlbiA9IGNsaWVudC5zb2NrZXQ/LnJlYWR5U3RhdGUgPT09IGNsaWVudC5zb2NrZXQ/Lk9QRU5cblxuICAgICAgICAgIGlmIChzb2NrZXRPcGVuKSBjb250aW51ZVxuXG4gICAgICAgICAgZm9yIChsZXQgcmVtYWluaW5nID0gaW5kZXg7IHJlbWFpbmluZyA8IGV2ZW50cy5sZW5ndGg7IHJlbWFpbmluZyArPSAxKSB7XG4gICAgICAgICAgICBidWZmZXJPdXRnb2luZ0V2ZW50KGV2ZW50c1tyZW1haW5pbmddKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICApXG59XG5cbi8qKlxuICogUnVucyBkZWZhdWx0IGZyb250ZW5kIG1vZGVsIHJlc291cmNlIHBhdGguXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBEZWZhdWx0IHJlc291cmNlIHBhdGggZm9yIHRoZSBtb2RlbCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gZGVmYXVsdEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgobW9kZWxDbGFzcykge1xuICByZXR1cm4gYC8ke2luZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24ucGx1cmFsaXplKGluZmxlY3Rpb24udW5kZXJzY29yZShtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpKSkpfWBcbn1cblxuLyoqIEVycm9yIHJhaXNlZCB3aGVuIHJlYWRpbmcgYW4gYXR0cmlidXRlIHRoYXQgd2FzIG5vdCBzZWxlY3RlZCBpbiBxdWVyeSBwYXlsb2Fkcy4gKi9cbmV4cG9ydCBjbGFzcyBBdHRyaWJ1dGVOb3RTZWxlY3RlZEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIHRoYXQgd2FzIHJlcXVlc3RlZC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG1vZGVsTmFtZSwgYXR0cmlidXRlTmFtZSkge1xuICAgIHN1cGVyKGAke21vZGVsTmFtZX0jJHthdHRyaWJ1dGVOYW1lfSB3YXMgbm90IHNlbGVjdGVkYClcbiAgICB0aGlzLm5hbWUgPSBcIkF0dHJpYnV0ZU5vdFNlbGVjdGVkRXJyb3JcIlxuICB9XG59XG5cbi8qKlxuICogTGlnaHR3ZWlnaHQgc2luZ3VsYXIgcmVsYXRpb25zaGlwIHN0YXRlIGhvbGRlciBmb3IgZnJvbnRlbmQgbW9kZWwgaW5zdGFuY2VzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gU1xuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQmFzZTxhbnksIGFueSwgYW55PiB8IHR5cGVvZiBGcm9udGVuZE1vZGVsQmFzZX0gVFxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzPVJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT5dXG4gKi9cbmV4cG9ydCBjbGFzcyBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXAge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBQYXJlbnQgbW9kZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzPEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiwgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgVGFyZ2V0Q3JlYXRlQXR0cmlidXRlcz4gfCBudWxsfSB0YXJnZXRNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgY29uc3RydWN0b3IobW9kZWwsIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICB0aGlzLm1vZGVsID0gbW9kZWxcbiAgICB0aGlzLnJlbGF0aW9uc2hpcE5hbWUgPSByZWxhdGlvbnNoaXBOYW1lXG4gICAgdGhpcy50YXJnZXRNb2RlbENsYXNzID0gdGFyZ2V0TW9kZWxDbGFzc1xuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsfSAqL1xuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGxvYWRlZC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4gfCBudWxsIHwgdW5kZWZpbmVkfSBsb2FkZWRWYWx1ZSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0TG9hZGVkKGxvYWRlZFZhbHVlKSB7XG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBsb2FkZWRWYWx1ZSA9PSB1bmRlZmluZWQgPyBudWxsIDogbG9hZGVkVmFsdWVcbiAgICB0aGlzLl9wcmVsb2FkZWQgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcHJlbG9hZGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlbGF0aW9uc2hpcCBpcyBwcmVsb2FkZWQuXG4gICAqL1xuICBnZXRQcmVsb2FkZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3ByZWxvYWRlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZGVkLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbH0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgbG9hZGVkKCkge1xuICAgIGlmICghdGhpcy5fcHJlbG9hZGVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX0gaGFzbid0IGJlZW4gcHJlbG9hZGVkYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fbG9hZGVkVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3BpZXMgbG9hZGVkIHZhbHVlIGZyb20gYW5vdGhlciBzaW5ndWxhciByZWxhdGlvbnNoaXAgaGVscGVyLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXB9IHNvdXJjZVJlbGF0aW9uc2hpcCAtIFNvdXJjZSByZWxhdGlvbnNoaXAgaGVscGVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNvcHlMb2FkZWRGcm9tKHNvdXJjZVJlbGF0aW9uc2hpcCkge1xuICAgIGlmIChzb3VyY2VSZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IHNvdXJjZSByZWxhdGlvbnNoaXAgdG8gYmUgc2luZ3VsYXJgKVxuICAgIH1cblxuICAgIC8vIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIHRhcmdldCByZWxhdGlvbnNoaXAncyBkb2N1bWVudGVkIG1vZGVsIHR5cGUuXG4gICAgY29uc3QgbG9hZGVkVmFsdWUgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPiB8IG51bGx9ICovIChzb3VyY2VSZWxhdGlvbnNoaXAubG9hZGVkKCkpXG5cbiAgICB0aGlzLnNldExvYWRlZChsb2FkZWRWYWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkLlxuICAgKiBAcGFyYW0ge1RhcmdldENyZWF0ZUF0dHJpYnV0ZXN9IFthdHRyaWJ1dGVzXSAtIE5ldyBtb2RlbCBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+fSAtIEJ1aWx0IG1vZGVsLlxuICAgKi9cbiAgYnVpbGQoYXR0cmlidXRlcyA9IC8qKiBAdHlwZSB7VGFyZ2V0Q3JlYXRlQXR0cmlidXRlc30gKi8gKHt9KSkge1xuICAgIGlmICghdGhpcy50YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyBjb25maWd1cmVkIGZvciAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtuZXcgKGF0dHJpYnV0ZXM/OiBUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzKSA9PiBGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD59ICovICh0aGlzLnRhcmdldE1vZGVsQ2xhc3MpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcyhhdHRyaWJ1dGVzKVxuXG4gICAgdGhpcy5zZXRMb2FkZWQobW9kZWwpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3JjZS1yZWxvYWQgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIGxvYWQoKSB7XG4gICAgdGhpcy5fcHJlbG9hZGVkID0gZmFsc2VcbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IG51bGxcblxuICAgIGNvbnN0IGJhdGNoZWQgPSBhd2FpdCB0aGlzLm1vZGVsLl90cnlDb2hvcnRQcmVsb2FkKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChiYXRjaGVkKSByZXR1cm4gdGhpcy5sb2FkZWQoKVxuXG4gICAgYXdhaXQgdGhpcy5tb2RlbC5sb2FkUmVsYXRpb25zaGlwKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIHJldHVybiB0aGlzLmxvYWRlZCgpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbG9hZGVkIHJlbGF0aW9uc2hpcCBvciBsb2FkcyBpdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIG9yTG9hZCgpIHtcbiAgICBpZiAodGhpcy5nZXRQcmVsb2FkZWQoKSkgcmV0dXJuIHRoaXMubG9hZGVkKClcblxuICAgIGNvbnN0IGJhdGNoZWQgPSBhd2FpdCB0aGlzLm1vZGVsLl90cnlDb2hvcnRQcmVsb2FkKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChiYXRjaGVkKSByZXR1cm4gdGhpcy5sb2FkZWQoKVxuXG4gICAgYXdhaXQgdGhpcy5tb2RlbC5sb2FkUmVsYXRpb25zaGlwKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIHJldHVybiB0aGlzLmxvYWRlZCgpXG4gIH1cbn1cblxuLyoqXG4gKiBMaWdodHdlaWdodCBoYXMtbWFueSByZWxhdGlvbnNoaXAgc3RhdGUgaG9sZGVyIGZvciBmcm9udGVuZCBtb2RlbCBpbnN0YW5jZXMuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnk+IHwgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlfSBTXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxCYXNlPGFueSwgYW55LCBhbnk+IHwgdHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlfSBUXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW1RhcmdldENyZWF0ZUF0dHJpYnV0ZXM9UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPl1cbiAqL1xuZXhwb3J0IGNsYXNzIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwIHtcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj59ICovXG4gIF9sb2FkZWRWYWx1ZVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIFBhcmVudCBtb2RlbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3M8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+LCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+LCBUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzPiB8IG51bGx9IHRhcmdldE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcihtb2RlbCwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgIHRoaXMubW9kZWwgPSBtb2RlbFxuICAgIHRoaXMucmVsYXRpb25zaGlwTmFtZSA9IHJlbGF0aW9uc2hpcE5hbWVcbiAgICB0aGlzLnRhcmdldE1vZGVsQ2xhc3MgPSB0YXJnZXRNb2RlbENsYXNzXG4gICAgdGhpcy5fcHJlbG9hZGVkID0gZmFsc2VcbiAgICB0aGlzLl9sb2FkZWRWYWx1ZSA9IFtdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbG9hZGVkLlxuICAgKiBAcGFyYW0ge0FycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj59IGxvYWRlZFZhbHVlIC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzZXRMb2FkZWQobG9hZGVkVmFsdWUpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkobG9hZGVkVmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5tb2RlbC5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMucmVsYXRpb25zaGlwTmFtZX0gdG8gYmUgbG9hZGVkIHdpdGggYW4gYXJyYXlgKVxuICAgIH1cblxuICAgIHRoaXMuX2xvYWRlZFZhbHVlID0gbG9hZGVkVmFsdWVcbiAgICB0aGlzLl9wcmVsb2FkZWQgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcHJlbG9hZGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlbGF0aW9uc2hpcCBpcyBwcmVsb2FkZWQuXG4gICAqL1xuICBnZXRQcmVsb2FkZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3ByZWxvYWRlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZGVkLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlcy5cbiAgICovXG4gIGxvYWRlZCgpIHtcbiAgICBpZiAoIXRoaXMuX3ByZWxvYWRlZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9IGhhc24ndCBiZWVuIHByZWxvYWRlZGApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2xvYWRlZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ29waWVzIGxvYWRlZCB2YWx1ZSBmcm9tIGFub3RoZXIgaGFzLW1hbnkgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSBzb3VyY2VSZWxhdGlvbnNoaXAgLSBTb3VyY2UgcmVsYXRpb25zaGlwIGhlbHBlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjb3B5TG9hZGVkRnJvbShzb3VyY2VSZWxhdGlvbnNoaXApIHtcbiAgICBpZiAoIShzb3VyY2VSZWxhdGlvbnNoaXAgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm1vZGVsLmNvbnN0cnVjdG9yLm5hbWV9IyR7dGhpcy5yZWxhdGlvbnNoaXBOYW1lfSBzb3VyY2UgcmVsYXRpb25zaGlwIHRvIGJlIGhhcy1tYW55YClcbiAgICB9XG5cbiAgICAvLyBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSB0YXJnZXQgcmVsYXRpb25zaGlwJ3MgZG9jdW1lbnRlZCBtb2RlbCB0eXBlLlxuICAgIGNvbnN0IGxvYWRlZFZhbHVlID0gLyoqIEB0eXBlIHtBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+fSAqLyAoc291cmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpKVxuXG4gICAgdGhpcy5zZXRMb2FkZWQobG9hZGVkVmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZGQgdG8gbG9hZGVkLlxuICAgKiBAcGFyYW0ge0FycmF5PEZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBNb2RlbDxUPj59IG1vZGVscyAtIE1vZGVscyB0byBhcHBlbmQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYWRkVG9Mb2FkZWQobW9kZWxzKSB7XG4gICAgY29uc3QgbG9hZGVkTW9kZWxzID0gdGhpcy5nZXRQcmVsb2FkZWQoKSA/IHRoaXMubG9hZGVkKCkgOiBbXVxuXG4gICAgdGhpcy5zZXRMb2FkZWQoWy4uLmxvYWRlZE1vZGVscywgLi4ubW9kZWxzXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkLlxuICAgKiBAcGFyYW0ge1RhcmdldENyZWF0ZUF0dHJpYnV0ZXN9IFthdHRyaWJ1dGVzXSAtIE5ldyBtb2RlbCBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+fSAtIEJ1aWx0IG1vZGVsLlxuICAgKi9cbiAgYnVpbGQoYXR0cmlidXRlcyA9IC8qKiBAdHlwZSB7VGFyZ2V0Q3JlYXRlQXR0cmlidXRlc30gKi8gKHt9KSkge1xuICAgIGlmICghdGhpcy50YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyBjb25maWd1cmVkIGZvciAke3RoaXMubW9kZWwuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLnJlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtuZXcgKGF0dHJpYnV0ZXM/OiBUYXJnZXRDcmVhdGVBdHRyaWJ1dGVzKSA9PiBGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD59ICovICh0aGlzLnRhcmdldE1vZGVsQ2xhc3MpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcyhhdHRyaWJ1dGVzKVxuXG4gICAgdGhpcy5hZGRUb0xvYWRlZChbbW9kZWxdKVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogRm9yY2UtcmVsb2FkIHRoZSByZWxhdGlvbnNoaXAuIFdoZW4gdGhlIHBhcmVudCByZWNvcmQgd2FzIGxvYWRlZCBhcyBwYXJ0XG4gICAqIG9mIGEgYmF0Y2gsIHNpYmxpbmdzIHRoYXQgaGF2ZSBub3QgcHJlbG9hZGVkIHRoaXMgcmVsYXRpb25zaGlwIGdldFxuICAgKiBiYXRjaGVkIGludG8gb25lIHJlcXVlc3QgdmlhIHRoZSBjb2hvcnQgcHJlbG9hZGVyLiBUaGUgc2NvcGVkIHF1ZXJ5IHBhdGhcbiAgICogKGBNb2RlbC53aGVyZSguLi4pLnByZWxvYWQoW25hbWVdKS50b0FycmF5KClgIGRpcmVjdGx5IGZyb20gdXNlciBjb2RlKVxuICAgKiBieXBhc3NlcyBjb2hvcnQgYmF0Y2hpbmcgYnkgZGVzaWduLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwTW9kZWw8VD4+Pn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIG1vZGVscy5cbiAgICovXG4gIGFzeW5jIGxvYWQoKSB7XG4gICAgLy8gUmVzZXQgc28gdGhlIGNvaG9ydCBwcmVsb2FkZXIgKG9yIHNpbmdsZS1yZWNvcmQgZmFsbGJhY2spIHJlcG9wdWxhdGVzLlxuICAgIHRoaXMuX3ByZWxvYWRlZCA9IGZhbHNlXG4gICAgdGhpcy5fbG9hZGVkVmFsdWUgPSBbXVxuXG4gICAgY29uc3QgYmF0Y2hlZCA9IGF3YWl0IHRoaXMubW9kZWwuX3RyeUNvaG9ydFByZWxvYWQodGhpcy5yZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKGJhdGNoZWQpIHJldHVybiB0aGlzLl9sb2FkZWRWYWx1ZVxuXG4gICAgYXdhaXQgdGhpcy5tb2RlbC5sb2FkUmVsYXRpb25zaGlwKHRoaXMucmVsYXRpb25zaGlwTmFtZSlcblxuICAgIHJldHVybiB0aGlzLmxvYWRlZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBhcnJheS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8RnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcE1vZGVsPFQ+Pj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBtb2RlbHMuXG4gICAqL1xuICBhc3luYyB0b0FycmF5KCkge1xuICAgIGlmICh0aGlzLmdldFByZWxvYWRlZCgpIHx8IHRoaXMuX2xvYWRlZFZhbHVlLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiB0aGlzLl9sb2FkZWRWYWx1ZVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmxvYWQoKVxuICB9XG59XG5cbi8qKlxuICogQ29waWVzIGxvYWRlZCByZWxhdGlvbnNoaXAgc3RhdGUgYmV0d2VlbiBoZWxwZXJzIG9mIHRoZSBzYW1lIHJlbGF0aW9uc2hpcCBzaGFwZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSBhcmdzLnNvdXJjZVJlbGF0aW9uc2hpcCAtIFNvdXJjZSByZWxhdGlvbnNoaXAgaGVscGVyLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSBhcmdzLnRhcmdldFJlbGF0aW9uc2hpcCAtIFRhcmdldCByZWxhdGlvbnNoaXAgaGVscGVyLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGNvcHlMb2FkZWRSZWxhdGlvbnNoaXBWYWx1ZSh7c291cmNlUmVsYXRpb25zaGlwLCB0YXJnZXRSZWxhdGlvbnNoaXB9KSB7XG4gIHRhcmdldFJlbGF0aW9uc2hpcC5jb3B5TG9hZGVkRnJvbShzb3VyY2VSZWxhdGlvbnNoaXApXG59XG5cbi8qKlxuICogUnVucyByZWxhdGlvbnNoaXAgdHlwZSBpcyBjb2xsZWN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcFR5cGUgLSBSZWxhdGlvbnNoaXAgdHlwZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcmVsYXRpb25zaGlwIHR5cGUgaXMgaGFzLW1hbnkuXG4gKi9cbmZ1bmN0aW9uIHJlbGF0aW9uc2hpcFR5cGVJc0NvbGxlY3Rpb24ocmVsYXRpb25zaGlwVHlwZSkge1xuICByZXR1cm4gcmVsYXRpb25zaGlwVHlwZSA9PSBcImhhc01hbnlcIlxufVxuXG4vKipcbiAqIERvd25sb2FkZWQgZnJvbnRlbmQtbW9kZWwgYXR0YWNobWVudCBwYXlsb2FkIHdyYXBwZXIuXG4gKi9cbmV4cG9ydCBjbGFzcyBGcm9udGVuZE1vZGVsQXR0YWNobWVudERvd25sb2FkIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaWQgLSBBdHRhY2htZW50IGlkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5maWxlbmFtZSAtIEZpbGVuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGFyZ3MuY29udGVudFR5cGUgLSBDb250ZW50IHR5cGUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmJ5dGVTaXplIC0gRmlsZSBzaXplIGluIGJ5dGVzLlxuICAgKiBAcGFyYW0ge1VpbnQ4QXJyYXl9IGFyZ3MuY29udGVudCAtIEZpbGUgY29udGVudCBieXRlcy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBbYXJncy51cmxdIC0gUmVzb2x2YWJsZSBhdHRhY2htZW50IFVSTC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtieXRlU2l6ZSwgY29udGVudCwgY29udGVudFR5cGUsIGZpbGVuYW1lLCBpZCwgdXJsID0gbnVsbH0pIHtcbiAgICB0aGlzLmlkVmFsdWUgPSBpZFxuICAgIHRoaXMuZmlsZW5hbWVWYWx1ZSA9IGZpbGVuYW1lXG4gICAgdGhpcy5jb250ZW50VHlwZVZhbHVlID0gY29udGVudFR5cGVcbiAgICB0aGlzLmJ5dGVTaXplVmFsdWUgPSBieXRlU2l6ZVxuICAgIHRoaXMuY29udGVudFZhbHVlID0gY29udGVudFxuICAgIHRoaXMudXJsVmFsdWUgPSB1cmxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ5dGUgc2l6ZS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBGaWxlIHNpemUgaW4gYnl0ZXMuXG4gICAqL1xuICBieXRlU2l6ZSgpIHsgcmV0dXJuIHRoaXMuYnl0ZVNpemVWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIGNvbnRlbnQuXG4gICAqIEByZXR1cm5zIHtVaW50OEFycmF5fSAtIEZpbGUgY29udGVudCBieXRlcy5cbiAgICovXG4gIGNvbnRlbnQoKSB7IHJldHVybiB0aGlzLmNvbnRlbnRWYWx1ZSB9XG4gIC8qKlxuICAgKiBSdW5zIGNvbnRlbnQgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gQ29udGVudCB0eXBlLlxuICAgKi9cbiAgY29udGVudFR5cGUoKSB7IHJldHVybiB0aGlzLmNvbnRlbnRUeXBlVmFsdWUgfVxuICAvKipcbiAgICogUnVucyBmaWxlbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGaWxlbmFtZS5cbiAgICovXG4gIGZpbGVuYW1lKCkgeyByZXR1cm4gdGhpcy5maWxlbmFtZVZhbHVlIH1cbiAgLyoqXG4gICAqIFJ1bnMgaWQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0YWNobWVudCBpZC5cbiAgICovXG4gIGlkKCkgeyByZXR1cm4gdGhpcy5pZFZhbHVlIH1cbiAgLyoqXG4gICAqIFJ1bnMgdXJsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBSZXNvbHZhYmxlIGF0dGFjaG1lbnQgVVJMLlxuICAgKi9cbiAgdXJsKCkgeyByZXR1cm4gdGhpcy51cmxWYWx1ZSB9XG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBhdHRhY2htZW50IGNvbW1hbmQgcGF5bG9hZC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGV9IGF0dGFjaG1lbnQgLSBBdHRhY2htZW50IHdyYXBwZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gW2F0dGFjaG1lbnRJZF0gLSBPcHRpb25hbCBoYXMtbWFueSBhdHRhY2htZW50IGlkLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDb21tYW5kIHBheWxvYWQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29tbWFuZFBheWxvYWQoYXR0YWNobWVudCwgYXR0YWNobWVudElkKSB7XG4gIC8qKlxuICAgKiBQYXlsb2FkLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCBwYXlsb2FkID0ge1xuICAgIGF0dGFjaG1lbnROYW1lOiBhdHRhY2htZW50LmF0dGFjaG1lbnROYW1lLFxuICAgIGlkOiBhdHRhY2htZW50Lm1vZGVsLnByaW1hcnlLZXlWYWx1ZSgpXG4gIH1cblxuICBpZiAoYXR0YWNobWVudElkKSBwYXlsb2FkLmF0dGFjaG1lbnRJZCA9IGF0dGFjaG1lbnRJZFxuXG4gIHJldHVybiBwYXlsb2FkXG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgY2Fub25pY2FsIGJhY2tpbmcgb3duZXIgdXNlZCBieSBhdHRhY2htZW50IG1ldGFkYXRhIHN0b3JhZ2UuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBtb2RlbCAtIEZyb250ZW5kIGF0dGFjaG1lbnQgb3duZXIuXG4gKiBAcmV0dXJucyB7e3JlY29yZElkOiBzdHJpbmcsIHJlY29yZFR5cGU6IHN0cmluZ319IC0gQ2Fub25pY2FsIGF0dGFjaG1lbnQgb3duZXIuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxBdHRhY2htZW50T3duZXIobW9kZWwpIHtcbiAgaWYgKCFtb2RlbC5fYXR0YWNobWVudE93bmVyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIGF0dGFjaG1lbnQgb3duZXIgbWV0YWRhdGEgb24gJHtmcm9udGVuZE1vZGVsQ2xhc3NGb3IobW9kZWwpLm5hbWV9YClcbiAgfVxuXG4gIHJldHVybiBtb2RlbC5fYXR0YWNobWVudE93bmVyXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IHZhbHVlIGlzIGJ5dGVzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgdmFsdWUuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHZhbHVlIGxvb2tzIGxpa2UgYnl0ZSBkYXRhLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzQnl0ZXModmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlIGluc3RhbmNlb2YgVWludDhBcnJheSB8fCB2YWx1ZSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyIHx8ICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiICYmIEJ1ZmZlci5pc0J1ZmZlcih2YWx1ZSkpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IHZhbHVlIHN1cHBvcnRzIGFycmF5IGJ1ZmZlci5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge3ZhbHVlIGlzIHthcnJheUJ1ZmZlcjogKCkgPT4gUHJvbWlzZTxBcnJheUJ1ZmZlcj59fSAtIFdoZXRoZXIgY2FuZGlkYXRlIHN1cHBvcnRzIGFycmF5QnVmZmVyKCkuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudFZhbHVlU3VwcG9ydHNBcnJheUJ1ZmZlcih2YWx1ZSkge1xuICByZXR1cm4gQm9vbGVhbih2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh2YWx1ZSkuYXJyYXlCdWZmZXIgPT09IFwiZnVuY3Rpb25cIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgbm9ybWFsaXplIGJ5dGVzLlxuICogQHBhcmFtIHtVaW50OEFycmF5IHwgQnVmZmVyIHwgQXJyYXlCdWZmZXJ9IHZhbHVlIC0gQnl0ZS1saWtlIHZhbHVlLlxuICogQHJldHVybnMge1VpbnQ4QXJyYXl9IC0gVWludDhBcnJheSBieXRlcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50Tm9ybWFsaXplQnl0ZXModmFsdWUpIHtcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgVWludDhBcnJheSkgcmV0dXJuIHZhbHVlXG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSByZXR1cm4gbmV3IFVpbnQ4QXJyYXkodmFsdWUpXG4gIGlmICh0eXBlb2YgQnVmZmVyICE9PSBcInVuZGVmaW5lZFwiICYmIEJ1ZmZlci5pc0J1ZmZlcigvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodmFsdWUpKSkge1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheSgvKiogQHR5cGUge0J1ZmZlcn0gKi8gKHZhbHVlKSlcbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIGF0dGFjaG1lbnQgYnl0ZXMgdmFsdWVcIilcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgYnl0ZXMgdG8gYmFzZTY0LlxuICogQHBhcmFtIHtVaW50OEFycmF5fSBieXRlcyAtIEJ5dGVzLlxuICogQHJldHVybnMge3N0cmluZ30gLSBCYXNlNjQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kQXR0YWNobWVudEJ5dGVzVG9CYXNlNjQoYnl0ZXMpIHtcbiAgaWYgKHR5cGVvZiBCdWZmZXIgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICByZXR1cm4gQnVmZmVyLmZyb20oYnl0ZXMpLnRvU3RyaW5nKFwiYmFzZTY0XCIpXG4gIH1cblxuICBsZXQgYmluYXJ5ID0gXCJcIlxuXG4gIGZvciAoY29uc3QgYnl0ZSBvZiBieXRlcykge1xuICAgIGJpbmFyeSArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGUpXG4gIH1cblxuICBpZiAodHlwZW9mIGJ0b2EgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiTWlzc2luZyBiYXNlNjQgZW5jb2RlclwiKVxuXG4gIHJldHVybiBidG9hKGJpbmFyeSlcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIGF0dGFjaG1lbnQgYmFzZTY0IHRvIGJ5dGVzLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gQmFzZTY0IHZhbHVlLlxuICogQHJldHVybnMge1VpbnQ4QXJyYXl9IC0gRGVjb2RlZCBieXRlcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50QmFzZTY0VG9CeXRlcyh2YWx1ZSkge1xuICBpZiAodHlwZW9mIEJ1ZmZlciAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheShCdWZmZXIuZnJvbSh2YWx1ZSwgXCJiYXNlNjRcIikpXG4gIH1cblxuICBpZiAodHlwZW9mIGF0b2IgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiTWlzc2luZyBiYXNlNjQgZGVjb2RlclwiKVxuXG4gIGNvbnN0IGJpbmFyeSA9IGF0b2IodmFsdWUpXG4gIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYmluYXJ5Lmxlbmd0aClcblxuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgYmluYXJ5Lmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGJ5dGVzW2luZGV4XSA9IGJpbmFyeS5jaGFyQ29kZUF0KGluZGV4KVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVzXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBhdHRhY2htZW50IHZhbHVlIGlzIHBsYWluIG9iamVjdC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHZhbHVlLlxuICogQHJldHVybnMge3ZhbHVlIGlzIFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBXaGV0aGVyIHZhbHVlIGlzIHBsYWluIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICBjb25zdCBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpXG5cbiAgcmV0dXJuIHByb3RvdHlwZSA9PT0gT2JqZWN0LnByb3RvdHlwZSB8fCBwcm90b3R5cGUgPT09IG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHBheWxvYWQgY29udGFpbnMgYXR0YWNobWVudCB1cGxvYWQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFBheWxvYWQgY2FuZGlkYXRlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBwYXlsb2FkIGNvbnRhaW5zIGFuIGF0dGFjaG1lbnQgdXBsb2FkIGJvZHkuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxQYXlsb2FkQ29udGFpbnNBdHRhY2htZW50VXBsb2FkKHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcblxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gdmFsdWUuc29tZSgoZW50cnkpID0+IGZyb250ZW5kTW9kZWxQYXlsb2FkQ29udGFpbnNBdHRhY2htZW50VXBsb2FkKGVudHJ5KSlcbiAgfVxuXG4gIGlmICghZnJvbnRlbmRBdHRhY2htZW50VmFsdWVJc1BsYWluT2JqZWN0KHZhbHVlKSkgcmV0dXJuIGZhbHNlXG5cbiAgaWYgKHR5cGVvZiB2YWx1ZS5jb250ZW50QmFzZTY0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIHJldHVybiBPYmplY3QudmFsdWVzKHZhbHVlKS5zb21lKChlbnRyeSkgPT4gZnJvbnRlbmRNb2RlbFBheWxvYWRDb250YWluc0F0dGFjaG1lbnRVcGxvYWQoZW50cnkpKVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGNvbmNyZXRlIGZyb250ZW5kLW1vZGVsIGNsYXNzIGZvciBhbiBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IG1vZGVsIC0gRnJvbnRlbmQgbW9kZWwgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbENsYXNzfSBDb25jcmV0ZSBmcm9udGVuZC1tb2RlbCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbENsYXNzRm9yKG1vZGVsKSB7XG4gIGNvbnN0IGNvbnN0cnVjdG9yVmFsdWUgPSBtb2RlbC5jb25zdHJ1Y3RvclxuXG4gIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxDbGFzc30gKi8gKGNvbnN0cnVjdG9yVmFsdWUpXG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgY29uZmlndXJlZCBvZmZsaW5lIHF1ZXVlIHNob3VsZCBoYW5kbGUgYSBtb2RlbCBvcGVyYXRpb24uXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBvcGVyYXRpb24gLSBTeW5jIG9wZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdG8gcXVldWUgbG9jYWxseS5cbiAqL1xuZnVuY3Rpb24gc2hvdWxkUXVldWVGcm9udGVuZE1vZGVsT3BlcmF0aW9uT2ZmbGluZShNb2RlbENsYXNzLCBvcGVyYXRpb24pIHtcbiAgY29uc3Qgb2ZmbGluZVN5bmMgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jXG5cbiAgaWYgKCFvZmZsaW5lU3luYz8uZW5hYmxlZCkgcmV0dXJuIGZhbHNlXG5cbiAgY29uc3Qgc3luY0NvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKS5zeW5jXG5cbiAgaWYgKCFzeW5jQ29uZmlnPy5lbmFibGVkKSByZXR1cm4gZmFsc2VcbiAgaWYgKCFzeW5jQ29uZmlnLm9wZXJhdGlvbnMuaW5jbHVkZXMob3BlcmF0aW9uKSkgdGhyb3cgbmV3IEVycm9yKGBPZmZsaW5lIHN5bmMgZm9yICR7TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gZG9lcyBub3QgYWxsb3cgJHtvcGVyYXRpb259YClcblxuICByZXR1cm4gdHJ1ZVxufVxuXG4vKipcbiAqIFF1ZXVlcyBhbiBvZmZsaW5lIHN5bmMgbXV0YXRpb24uXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gYXJncy5hdHRyaWJ1dGVzIC0gTXV0YXRpb24gYXR0cmlidXRlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5jbGllbnRNdXRhdGlvbklkXSAtIFByZS1nZW5lcmF0ZWQgbXV0YXRpb24gaWQuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gYXJncy5Nb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFyZ3Mub3BlcmF0aW9uIC0gU3luYyBvcGVyYXRpb24uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIENsaWVudCBtdXRhdGlvbiBpZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcXVldWVGcm9udGVuZE1vZGVsTXV0YXRpb25PZmZsaW5lKHthdHRyaWJ1dGVzLCBjbGllbnRNdXRhdGlvbklkOiBwcm92aWRlZENsaWVudE11dGF0aW9uSWQsIE1vZGVsQ2xhc3MsIG9wZXJhdGlvbn0pIHtcbiAgY29uc3Qgb2ZmbGluZVN5bmMgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLm9mZmxpbmVTeW5jXG5cbiAgaWYgKCFvZmZsaW5lU3luYykgdGhyb3cgbmV3IEVycm9yKFwiT2ZmbGluZSBzeW5jIGlzIG5vdCBjb25maWd1cmVkXCIpXG5cbiAgY29uc3Qgc3luY0NvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKS5zeW5jXG4gIGlmICghc3luY0NvbmZpZz8uZW5hYmxlZCkgdGhyb3cgbmV3IEVycm9yKGBPZmZsaW5lIHN5bmMgaXMgbm90IGVuYWJsZWQgZm9yICR7TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gKVxuXG4gIGNvbnN0IG5vdyA9IG9mZmxpbmVTeW5jLm5vdyA/IG9mZmxpbmVTeW5jLm5vdygpIDogbmV3IERhdGUoKVxuICBpZiAoIShub3cgaW5zdGFuY2VvZiBEYXRlKSB8fCBOdW1iZXIuaXNOYU4obm93LmdldFRpbWUoKSkpIHRocm93IG5ldyBFcnJvcihcIm9mZmxpbmVTeW5jLm5vdyBtdXN0IHJldHVybiBhIHZhbGlkIERhdGVcIilcblxuICBjb25zdCBjbGllbnRNdXRhdGlvbklkID0gcHJvdmlkZWRDbGllbnRNdXRhdGlvbklkIHx8IChvZmZsaW5lU3luYy5jbGllbnRNdXRhdGlvbklkID8gb2ZmbGluZVN5bmMuY2xpZW50TXV0YXRpb25JZCgpIDogZnJvbnRlbmRNb2RlbE9mZmxpbmVNdXRhdGlvbklkKCkpXG4gIGlmICh0eXBlb2YgY2xpZW50TXV0YXRpb25JZCAhPT0gXCJzdHJpbmdcIiB8fCBjbGllbnRNdXRhdGlvbklkLmxlbmd0aCA8IDEpIHRocm93IG5ldyBFcnJvcihcIm9mZmxpbmVTeW5jLmNsaWVudE11dGF0aW9uSWQgbXVzdCByZXR1cm4gYSBub24tZW1wdHkgc3RyaW5nXCIpXG5cbiAgYXdhaXQgb2ZmbGluZVN5bmMubXV0YXRpb25Mb2cuYXBwZW5kKHtcbiAgICBtdXRhdGlvbjoge1xuICAgICAgYWN0b3JEZXZpY2VJZDogb2ZmbGluZVN5bmMuYWN0b3JEZXZpY2VJZCxcbiAgICAgIGFjdG9yVXNlcklkOiBvZmZsaW5lU3luYy5hY3RvclVzZXJJZCxcbiAgICAgIGF0dHJpYnV0ZXM6IGZyb250ZW5kTW9kZWxTeW5jSnNvbk9iamVjdChhdHRyaWJ1dGVzKSxcbiAgICAgIGJhc2VWZXJzaW9uOiBudWxsLFxuICAgICAgY2xpZW50TXV0YXRpb25JZCxcbiAgICAgIG1vZGVsOiBNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgb2NjdXJyZWRBdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICBvZmZsaW5lR3JhbnRJZDogb2ZmbGluZVN5bmMub2ZmbGluZUdyYW50LmlkLFxuICAgICAgb3BlcmF0aW9uLFxuICAgICAgcG9saWN5SGFzaDogc3luY0NvbmZpZy5wb2xpY3lIYXNoXG4gICAgfVxuICB9KVxuXG4gIHJldHVybiBjbGllbnRNdXRhdGlvbklkXG59XG5cbi8qKlxuICogR2VuZXJhdGVzIGEgZnJvbnRlbmQtbW9kZWwgb2ZmbGluZSBtdXRhdGlvbiBpZC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTG9jYWwgbXV0YXRpb24gaWQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxPZmZsaW5lTXV0YXRpb25JZCgpIHtcbiAgaWYgKGdsb2JhbFRoaXMuY3J5cHRvICYmIHR5cGVvZiBnbG9iYWxUaGlzLmNyeXB0by5yYW5kb21VVUlEID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiBnbG9iYWxUaGlzLmNyeXB0by5yYW5kb21VVUlEKClcblxuICByZXR1cm4gYGZyb250ZW5kLW11dGF0aW9uLSR7RGF0ZS5ub3coKX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX1gXG59XG5cbi8qKlxuICogQ29udmVydHMgbW9kZWwgYXR0cmlidXRlcyB0byBzeW5jLXNhZmUgSlNPTiBwYXlsb2FkIHZhbHVlcy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gYXR0cmlidXRlcyAtIEZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZXMuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59IC0gU3luYy1zYWZlIGF0dHJpYnV0ZXMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxTeW5jSnNvbk9iamVjdChhdHRyaWJ1dGVzKSB7XG4gIGNvbnN0IHNlcmlhbGl6ZWQgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGF0dHJpYnV0ZXMpKVxuXG4gIGlmICghc2VyaWFsaXplZCB8fCB0eXBlb2Ygc2VyaWFsaXplZCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHNlcmlhbGl6ZWQpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBzeW5jIG11dGF0aW9uIGF0dHJpYnV0ZXMgb2JqZWN0XCIpXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59ICovIChzZXJpYWxpemVkKVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIGF0dGFjaG1lbnQgaW5wdXQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBpbnB1dCAtIEF0dGFjaG1lbnQgaW5wdXQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFRyYW5zcG9ydC1zYWZlIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQoaW5wdXQpIHtcbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChpbnB1dCkgJiYgXCJmaWxlXCIgaW4gaW5wdXQpIHtcbiAgICBjb25zdCBub3JtYWxpemVkRmlsZSA9IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0LmZpbGUpXG4gICAgY29uc3QgbWVyZ2VkID0ge1xuICAgICAgLi4ubm9ybWFsaXplZEZpbGVcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGlucHV0LmZpbGVuYW1lID09PSBcInN0cmluZ1wiICYmIGlucHV0LmZpbGVuYW1lLmxlbmd0aCA+IDApIG1lcmdlZC5maWxlbmFtZSA9IGlucHV0LmZpbGVuYW1lXG4gICAgaWYgKHR5cGVvZiBpbnB1dC5jb250ZW50VHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5jb250ZW50VHlwZS5sZW5ndGggPiAwKSBtZXJnZWQuY29udGVudFR5cGUgPSBpbnB1dC5jb250ZW50VHlwZVxuXG4gICAgcmV0dXJuIG1lcmdlZFxuICB9XG5cbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChpbnB1dCkpIHtcbiAgICBpZiAodHlwZW9mIGlucHV0LnBhdGggPT09IFwic3RyaW5nXCIgJiYgaW5wdXQucGF0aC5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdHRhY2htZW50IHBhdGggaW5wdXQgaXMgbm90IHN1cHBvcnRlZCBpbiBmcm9udGVuZCBtb2RlbHNcIilcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGlucHV0LmNvbnRlbnRCYXNlNjQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvbnRlbnRCYXNlNjQ6IGlucHV0LmNvbnRlbnRCYXNlNjQsXG4gICAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgaW5wdXQuY29udGVudFR5cGUgPT09IFwic3RyaW5nXCIgJiYgaW5wdXQuY29udGVudFR5cGUubGVuZ3RoID4gMCA/IGlucHV0LmNvbnRlbnRUeXBlIDogbnVsbCxcbiAgICAgICAgZmlsZW5hbWU6IHR5cGVvZiBpbnB1dC5maWxlbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnB1dC5maWxlbmFtZS5sZW5ndGggPiAwID8gaW5wdXQuZmlsZW5hbWUgOiB1bmRlZmluZWRcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpZiAoZnJvbnRlbmRBdHRhY2htZW50VmFsdWVTdXBwb3J0c0FycmF5QnVmZmVyKGlucHV0KSkge1xuICAgIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYXdhaXQgaW5wdXQuYXJyYXlCdWZmZXIoKSlcblxuICAgIHJldHVybiB7XG4gICAgICBjb250ZW50QmFzZTY0OiBmcm9udGVuZEF0dGFjaG1lbnRCeXRlc1RvQmFzZTY0KGJ5dGVzKSxcbiAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS50eXBlID09PSBcInN0cmluZ1wiICYmIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkudHlwZS5sZW5ndGggPiAwXG4gICAgICAgID8gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS50eXBlXG4gICAgICAgIDogbnVsbCxcbiAgICAgIGZpbGVuYW1lOiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS5uYW1lID09PSBcInN0cmluZ1wiICYmIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChpbnB1dCkubmFtZS5sZW5ndGggPiAwXG4gICAgICAgID8gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGlucHV0KS5uYW1lXG4gICAgICAgIDogXCJhdHRhY2htZW50LmJpblwiXG4gICAgfVxuICB9XG5cbiAgaWYgKGZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNCeXRlcyhpbnB1dCkpIHtcbiAgICBjb25zdCBieXRlcyA9IGZyb250ZW5kQXR0YWNobWVudE5vcm1hbGl6ZUJ5dGVzKC8qKiBAdHlwZSB7VWludDhBcnJheSB8IEJ1ZmZlciB8IEFycmF5QnVmZmVyfSAqLyAoaW5wdXQpKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbnRlbnRCYXNlNjQ6IGZyb250ZW5kQXR0YWNobWVudEJ5dGVzVG9CYXNlNjQoYnl0ZXMpLFxuICAgICAgY29udGVudFR5cGU6IG51bGwsXG4gICAgICBmaWxlbmFtZTogXCJhdHRhY2htZW50LmJpblwiXG4gICAgfVxuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKFwiVW5zdXBwb3J0ZWQgZnJvbnRlbmQgYXR0YWNobWVudCBpbnB1dFwiKVxufVxuXG4vKipcbiAqIEZyb250ZW5kLW1vZGVsIGF0dGFjaG1lbnQgaGVscGVyIGZvciBvbmUgYXR0YWNobWVudCBuYW1lLlxuICovXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGUge1xuICAvKipcbiAgICogUGVuZGluZyBhdHRhY2htZW50IGlucHV0cyBxdWV1ZWQgZm9yIHRoZSBuZXh0IG1vZGVsIHNhdmUuXG4gICAqIEB0eXBlIHtGcm9udGVuZE1vZGVsQXR0YWNobWVudElucHV0W119XG4gICAqL1xuICBwZW5kaW5nSW5wdXRzID0gW11cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlfSBhcmdzLm1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2F0dGFjaG1lbnROYW1lLCBtb2RlbH0pIHtcbiAgICB0aGlzLm1vZGVsID0gbW9kZWxcbiAgICB0aGlzLmF0dGFjaG1lbnROYW1lID0gYXR0YWNobWVudE5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZSBhdHRhY2htZW50IGlucHV0IGZvciB0aGUgcGFyZW50IG1vZGVsJ3MgbmV4dCBzYXZlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxBdHRhY2htZW50SW5wdXQgfCBGcm9udGVuZE1vZGVsQXR0YWNobWVudElucHV0W119IGlucHV0IC0gQXR0YWNobWVudCBpbnB1dC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBxdWV1ZUF0dGFjaChpbnB1dCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb24odGhpcy5hdHRhY2htZW50TmFtZSlcblxuICAgIGlmIChhdHRhY2htZW50RGVmaW5pdGlvbj8udHlwZSA9PT0gXCJoYXNPbmVcIikge1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoaW5wdXQpKSB7XG4gICAgICAgIGNvbnN0IGxhc3RJbnB1dCA9IGlucHV0W2lucHV0Lmxlbmd0aCAtIDFdXG5cbiAgICAgICAgdGhpcy5wZW5kaW5nSW5wdXRzID0gdHlwZW9mIGxhc3RJbnB1dCA9PT0gXCJ1bmRlZmluZWRcIiA/IFtdIDogW2xhc3RJbnB1dF1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucGVuZGluZ0lucHV0cyA9IFtpbnB1dF1cbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGlucHV0KSkge1xuICAgICAgdGhpcy5wZW5kaW5nSW5wdXRzLnB1c2goLi4uaW5wdXQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucGVuZGluZ0lucHV0cy5wdXNoKGlucHV0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoaXMgYXR0YWNobWVudCBoYXMgcXVldWVkIGlucHV0cyBmb3IgdGhlIG5leHQgbW9kZWwgc2F2ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgYW55IHBlbmRpbmcgaW5wdXRzIGV4aXN0LlxuICAgKi9cbiAgaGFzUGVuZGluZ0F0dGFjaG1lbnRzKCkge1xuICAgIHJldHVybiB0aGlzLnBlbmRpbmdJbnB1dHMubGVuZ3RoID4gMFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgc2F2ZSBwYXlsb2FkIGZvciBxdWV1ZWQgYXR0YWNobWVudCBpbnB1dHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdIHwgdW5kZWZpbmVkPn0gTm9ybWFsaXplZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBwZW5kaW5nQXR0YWNobWVudHNQYXlsb2FkKCkge1xuICAgIGlmICh0aGlzLnBlbmRpbmdJbnB1dHMubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSBNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKHRoaXMuYXR0YWNobWVudE5hbWUpXG5cbiAgICBpZiAoYXR0YWNobWVudERlZmluaXRpb24/LnR5cGUgPT09IFwiaGFzTWFueVwiKSB7XG4gICAgICByZXR1cm4gYXdhaXQgUHJvbWlzZS5hbGwodGhpcy5wZW5kaW5nSW5wdXRzLm1hcChhc3luYyAoaW5wdXQpID0+IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0KSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KHRoaXMucGVuZGluZ0lucHV0c1t0aGlzLnBlbmRpbmdJbnB1dHMubGVuZ3RoIC0gMV0pXG4gIH1cblxuICAvKiogQ2xlYXJzIHF1ZXVlZCBhdHRhY2htZW50IGlucHV0cyBhZnRlciBhIHN1Y2Nlc3NmdWwgbW9kZWwgc2F2ZS4gKi9cbiAgY2xlYXJQZW5kaW5nQXR0YWNobWVudHMoKSB7XG4gICAgdGhpcy5wZW5kaW5nSW5wdXRzID0gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gaW5wdXQgLSBBdHRhY2htZW50IGlucHV0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGF0dGFjaGVkLlxuICAgKi9cbiAgYXN5bmMgYXR0YWNoKGlucHV0KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWRJbnB1dCA9IGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KGlucHV0KVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcImF0dGFjaFwiLCB7XG4gICAgICBhdHRhY2htZW50OiBub3JtYWxpemVkSW5wdXQsXG4gICAgICBhdHRhY2htZW50TmFtZTogdGhpcy5hdHRhY2htZW50TmFtZSxcbiAgICAgIGlkOiB0aGlzLm1vZGVsLnByaW1hcnlLZXlWYWx1ZSgpXG4gICAgfSlcblxuICAgIHRoaXMubW9kZWwuYXNzaWduQXR0cmlidXRlcyhNb2RlbENsYXNzLmF0dHJpYnV0ZXNGcm9tUmVzcG9uc2UocmVzcG9uc2UpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZG93bmxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXR0YWNobWVudElkXSAtIE9wdGlvbmFsIGF0dGFjaG1lbnQgaWQgZm9yIGhhcy1tYW55IGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxGcm9udGVuZE1vZGVsQXR0YWNobWVudERvd25sb2FkIHwgbnVsbD59IC0gRG93bmxvYWRlZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBkb3dubG9hZChhdHRhY2htZW50SWQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiZG93bmxvYWRcIiwgZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb21tYW5kUGF5bG9hZCh0aGlzLCBhdHRhY2htZW50SWQpKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRQYXlsb2FkID0gcmVzcG9uc2UuYXR0YWNobWVudFxuXG4gICAgaWYgKCFhdHRhY2htZW50UGF5bG9hZCB8fCB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQgIT09IFwib2JqZWN0XCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBjb250ZW50QmFzZTY0ID0gdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRCYXNlNjQgPT09IFwic3RyaW5nXCIgPyBhdHRhY2htZW50UGF5bG9hZC5jb250ZW50QmFzZTY0IDogXCJcIlxuICAgIGNvbnN0IGNvbnRlbnQgPSBmcm9udGVuZEF0dGFjaG1lbnRCYXNlNjRUb0J5dGVzKGNvbnRlbnRCYXNlNjQpXG4gICAgY29uc3QgYnl0ZVNpemUgPSBOdW1iZXIoYXR0YWNobWVudFBheWxvYWQuYnl0ZVNpemUpXG5cbiAgICByZXR1cm4gbmV3IEZyb250ZW5kTW9kZWxBdHRhY2htZW50RG93bmxvYWQoe1xuICAgICAgYnl0ZVNpemU6IE51bWJlci5pc0Zpbml0ZShieXRlU2l6ZSkgPyBieXRlU2l6ZSA6IGNvbnRlbnQubGVuZ3RoLFxuICAgICAgY29udGVudCxcbiAgICAgIGNvbnRlbnRUeXBlOiB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQuY29udGVudFR5cGUgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudFBheWxvYWQuY29udGVudFR5cGUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnRQYXlsb2FkLmNvbnRlbnRUeXBlIDogbnVsbCxcbiAgICAgIGZpbGVuYW1lOiB0eXBlb2YgYXR0YWNobWVudFBheWxvYWQuZmlsZW5hbWUgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudFBheWxvYWQuZmlsZW5hbWUubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnRQYXlsb2FkLmZpbGVuYW1lIDogXCJhdHRhY2htZW50LmJpblwiLFxuICAgICAgaWQ6IHR5cGVvZiBhdHRhY2htZW50UGF5bG9hZC5pZCA9PT0gXCJzdHJpbmdcIiA/IGF0dGFjaG1lbnRQYXlsb2FkLmlkIDogXCJcIixcbiAgICAgIHVybDogdHlwZW9mIGF0dGFjaG1lbnRQYXlsb2FkLnVybCA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50UGF5bG9hZC51cmwubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnRQYXlsb2FkLnVybCA6IG51bGxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXJsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2F0dGFjaG1lbnRJZF0gLSBPcHRpb25hbCBhdHRhY2htZW50IGlkIGZvciBoYXMtbWFueSBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IC0gUmVzb2x2YWJsZSBhdHRhY2htZW50IFVSTC5cbiAgICovXG4gIGFzeW5jIHVybChhdHRhY2htZW50SWQpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMubW9kZWwpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwidXJsXCIsIGZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29tbWFuZFBheWxvYWQodGhpcywgYXR0YWNobWVudElkKSlcblxuICAgIGlmICh0eXBlb2YgcmVzcG9uc2UudXJsID09PSBcInN0cmluZ1wiICYmIHJlc3BvbnNlLnVybC5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gcmVzcG9uc2UudXJsXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBxdWVyeSBmb3IgdGhpcyBhdHRhY2htZW50IGhhbmRsZSdzIG1ldGFkYXRhIHJvd3MuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIFZlbG9jaW91c0F0dGFjaG1lbnQ+fSAtIEF0dGFjaG1lbnQgbWV0YWRhdGEgcXVlcnkuXG4gICAqL1xuICBxdWVyeSgpIHtcbiAgICBjb25zdCBhdHRhY2htZW50T3duZXIgPSBmcm9udGVuZE1vZGVsQXR0YWNobWVudE93bmVyKHRoaXMubW9kZWwpXG5cbiAgICByZXR1cm4gVmVsb2Npb3VzQXR0YWNobWVudFxuICAgICAgLndoZXJlKHtcbiAgICAgICAgbmFtZTogdGhpcy5hdHRhY2htZW50TmFtZSxcbiAgICAgICAgcmVjb3JkSWQ6IGF0dGFjaG1lbnRPd25lci5yZWNvcmRJZCxcbiAgICAgICAgcmVjb3JkVHlwZTogYXR0YWNobWVudE93bmVyLnJlY29yZFR5cGVcbiAgICAgIH0pXG4gICAgICAub3JkZXIoW1tcInBvc2l0aW9uXCIsIFwiYXNjXCJdXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBhbGwgYXR0YWNobWVudCBtZXRhZGF0YSByb3dzIGZvciB0aGlzIGhhbmRsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8VmVsb2Npb3VzQXR0YWNobWVudFtdPn0gLSBBdHRhY2htZW50IG1ldGFkYXRhIHJvd3MuXG4gICAqL1xuICBhc3luYyB0b0FycmF5KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkudG9BcnJheSgpXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgdGhlIGZpcnN0IGF0dGFjaG1lbnQgbWV0YWRhdGEgcm93IGZvciB0aGlzIGhhbmRsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8VmVsb2Npb3VzQXR0YWNobWVudCB8IG51bGw+fSAtIEZpcnN0IGF0dGFjaG1lbnQgbWV0YWRhdGEgcm93LlxuICAgKi9cbiAgYXN5bmMgZmlyc3QoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maXJzdCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsaXN0LiBSZXR1cm5zIG1ldGFkYXRhIGZvciBldmVyeSBhdHRhY2htZW50IHVuZGVyIHRoaXMgYXR0YWNobWVudCBuYW1lXG4gICAqIChubyBjb250ZW50IGJ5dGVzKSwgc28gY2FsbGVycyBjYW4gZW51bWVyYXRlIGhhcy1tYW55IGF0dGFjaG1lbnRzIGFuZCB0aGVuXG4gICAqIGRvd25sb2FkIG9yIGxpbmsgdG8gZWFjaCBvbmUgYnkgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PHtieXRlU2l6ZTogbnVtYmVyLCBjb250ZW50VHlwZTogc3RyaW5nIHwgbnVsbCwgZmlsZW5hbWU6IHN0cmluZywgaWQ6IHN0cmluZywgdXJsOiBzdHJpbmcgfCBudWxsfT4+fSAtIEF0dGFjaG1lbnQgbWV0YWRhdGEgZW50cmllcy5cbiAgICovXG4gIGFzeW5jIGxpc3QoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzLm1vZGVsKVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgTW9kZWxDbGFzcy5leGVjdXRlQ29tbWFuZChcImF0dGFjaG1lbnRMaXN0XCIsIGZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29tbWFuZFBheWxvYWQodGhpcykpXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSBBcnJheS5pc0FycmF5KHJlc3BvbnNlLmF0dGFjaG1lbnRzKSA/IHJlc3BvbnNlLmF0dGFjaG1lbnRzIDogW11cblxuICAgIHJldHVybiBhdHRhY2htZW50cy5tYXAoKGF0dGFjaG1lbnQpID0+IHtcbiAgICAgIGNvbnN0IGJ5dGVTaXplID0gTnVtYmVyKGF0dGFjaG1lbnQuYnl0ZVNpemUpXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGJ5dGVTaXplOiBOdW1iZXIuaXNGaW5pdGUoYnl0ZVNpemUpID8gYnl0ZVNpemUgOiAwLFxuICAgICAgICBjb250ZW50VHlwZTogdHlwZW9mIGF0dGFjaG1lbnQuY29udGVudFR5cGUgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudC5jb250ZW50VHlwZS5sZW5ndGggPiAwID8gYXR0YWNobWVudC5jb250ZW50VHlwZSA6IG51bGwsXG4gICAgICAgIGZpbGVuYW1lOiB0eXBlb2YgYXR0YWNobWVudC5maWxlbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBhdHRhY2htZW50LmZpbGVuYW1lLmxlbmd0aCA+IDAgPyBhdHRhY2htZW50LmZpbGVuYW1lIDogXCJhdHRhY2htZW50LmJpblwiLFxuICAgICAgICBpZDogdHlwZW9mIGF0dGFjaG1lbnQuaWQgPT09IFwic3RyaW5nXCIgPyBhdHRhY2htZW50LmlkIDogXCJcIixcbiAgICAgICAgdXJsOiB0eXBlb2YgYXR0YWNobWVudC51cmwgPT09IFwic3RyaW5nXCIgJiYgYXR0YWNobWVudC51cmwubGVuZ3RoID4gMCA/IGF0dGFjaG1lbnQudXJsIDogbnVsbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkb3dubG9hZCB1cmwuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRG93bmxvYWQgVVJMIGZvciB0aGlzIGF0dGFjaG1lbnQgb24gdGhlIGNvbmZpZ3VyZWQgYmFja2VuZC5cbiAgICovXG4gIGRvd25sb2FkVXJsKCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcy5tb2RlbClcbiAgICBjb25zdCBjb21tYW5kTmFtZSA9IE1vZGVsQ2xhc3MuY29tbWFuZE5hbWUoXCJkb3dubG9hZFwiKVxuICAgIGNvbnN0IHJlc291cmNlUGF0aCA9IE1vZGVsQ2xhc3MucmVzb3VyY2VQYXRoKClcbiAgICBjb25zdCBjb21tYW5kVXJsID0gZnJvbnRlbmRNb2RlbENvbW1hbmRVcmwocmVzb3VyY2VQYXRoLCBjb21tYW5kTmFtZSlcbiAgICBjb25zdCBwYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHtcbiAgICAgIGF0dGFjaG1lbnROYW1lOiB0aGlzLmF0dGFjaG1lbnROYW1lLFxuICAgICAgaWQ6IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCB0aGlzLm1vZGVsLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIH0pXG5cbiAgICByZXR1cm4gYCR7Y29tbWFuZFVybH0/JHtwYXJhbXMudG9TdHJpbmcoKX1gXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgdXJsLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsfSB2YWx1ZSAtIFVSTCBjYW5kaWRhdGUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIE5vcm1hbGl6ZWQgVVJMIHdpdGhvdXQgdHJhaWxpbmcgc2xhc2guXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRVcmwodmFsdWUpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIFwiXCJcblxuICBjb25zdCB0cmltbWVkID0gdmFsdWUudHJpbSgpXG5cbiAgaWYgKCF0cmltbWVkLmxlbmd0aCkgcmV0dXJuIFwiXCJcblxuICByZXR1cm4gdHJpbW1lZC5yZXBsYWNlKC9cXC8rJC8sIFwiXCIpXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgdXJsLlxuICogQHJldHVybnMge3N0cmluZ30gLSBSZXNvbHZlZCBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgVVJMLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VXJsKCkge1xuICBjb25zdCBjb25maWd1cmVkVXJsID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudXJsID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudXJsKClcbiAgICA6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudXJsXG5cbiAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRVcmwoY29uZmlndXJlZFVybClcbn1cblxuLyoqXG4gKiBSdW5zIGNsb25lIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZXMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gdmFsdWUgLSBBdHRyaWJ1dGVzIGhhc2guXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENsb25lZCBhdHRyaWJ1dGVzIGhhc2guXG4gKi9cbmZ1bmN0aW9uIGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXModmFsdWUpIHtcbiAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHZhbHVlKSkpXG59XG5cbi8qKlxuICogU2hhcmVkIGNoYW5uZWwgbmFtZSBmb3IgbW9kZWwgbGlmZWN5Y2xlIGV2ZW50cyAoUGhhc2UgMykuXG4gKiBNYXRjaGVzIHRoZSBiYWNrZW5kIGBGUk9OVEVORF9NT0RFTFNfQ0hBTk5FTF9OQU1FYC5cbiAqL1xuY29uc3QgRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSA9IFwiZnJvbnRlbmQtbW9kZWxzXCJcblxuLyoqXG4gKiBSdW5zIG1lcmdlIGZyb250ZW5kIG1vZGVsIGV2ZW50IHByZWxvYWQuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gdGFyZ2V0IC0gVGFyZ2V0IHByZWxvYWQgcGF5bG9hZC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSBzb3VyY2UgLSBTb3VyY2UgcHJlbG9hZCBwYXlsb2FkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50UHJlbG9hZCh0YXJnZXQsIHNvdXJjZSkge1xuICBmb3IgKGNvbnN0IFtyZWxhdGlvbnNoaXBOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc291cmNlKSkge1xuICAgIGNvbnN0IGV4aXN0aW5nVmFsdWUgPSB0YXJnZXRbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSB8fCB2YWx1ZSA9PT0gZmFsc2UpIHtcbiAgICAgIGlmIChleGlzdGluZ1ZhbHVlID09PSB1bmRlZmluZWQpIHRhcmdldFtyZWxhdGlvbnNoaXBOYW1lXSA9IHZhbHVlXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICB0YXJnZXRbcmVsYXRpb25zaGlwTmFtZV0gPSB2YWx1ZVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoIWV4aXN0aW5nVmFsdWUgfHwgdHlwZW9mIGV4aXN0aW5nVmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShleGlzdGluZ1ZhbHVlKSkge1xuICAgICAgdGFyZ2V0W3JlbGF0aW9uc2hpcE5hbWVdID0ge31cbiAgICB9XG5cbiAgICBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFByZWxvYWQoXG4gICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gKi8gKHRhcmdldFtyZWxhdGlvbnNoaXBOYW1lXSksXG4gICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gKi8gKHZhbHVlKVxuICAgIClcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgZnJvbnRlbmQgbW9kZWwgZXZlbnQgc2VsZWN0LlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IHRhcmdldCAtIFRhcmdldCBzZWxlY3QgbWFwLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59IHNvdXJjZSAtIFNvdXJjZSBzZWxlY3QgbWFwLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50U2VsZWN0KHRhcmdldCwgc291cmNlKSB7XG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwgYXR0cmlidXRlc10gb2YgT2JqZWN0LmVudHJpZXMoc291cmNlKSkge1xuICAgIGNvbnN0IGV4aXN0aW5nQXR0cmlidXRlcyA9IHRhcmdldFttb2RlbE5hbWVdIHx8IFtdXG5cbiAgICB0YXJnZXRbbW9kZWxOYW1lXSA9IEFycmF5LmZyb20obmV3IFNldChleGlzdGluZ0F0dHJpYnV0ZXMuY29uY2F0KGF0dHJpYnV0ZXMpKSlcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbWVyZ2UgdW5pcXVlIGZyb250ZW5kIG1vZGVsIGV2ZW50IGVudHJpZXMuXG4gKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFdpdGhDb3VudFBheWxvYWRFbnRyeSB8IGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEFiaWxpdGllc1BheWxvYWRFbnRyeT59IHRhcmdldCAtIFRhcmdldCBhcnJheS5cbiAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsV2l0aENvdW50UGF5bG9hZEVudHJ5IHwgaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsQWJpbGl0aWVzUGF5bG9hZEVudHJ5Pn0gc291cmNlIC0gU291cmNlIGFycmF5LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIG1lcmdlVW5pcXVlRnJvbnRlbmRNb2RlbEV2ZW50RW50cmllcyh0YXJnZXQsIHNvdXJjZSkge1xuICBjb25zdCBleGlzdGluZ0tleXMgPSBuZXcgU2V0KHRhcmdldC5tYXAoKGVudHJ5KSA9PiBKU09OLnN0cmluZ2lmeShlbnRyeSkpKVxuXG4gIGZvciAoY29uc3QgZW50cnkgb2Ygc291cmNlKSB7XG4gICAgY29uc3Qga2V5ID0gSlNPTi5zdHJpbmdpZnkoZW50cnkpXG5cbiAgICBpZiAoZXhpc3RpbmdLZXlzLmhhcyhrZXkpKSBjb250aW51ZVxuXG4gICAgdGFyZ2V0LnB1c2goZW50cnkpXG4gICAgZXhpc3RpbmdLZXlzLmFkZChrZXkpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG1lcmdlIGZyb250ZW5kIG1vZGVsIGV2ZW50IHByb2plY3Rpb24gcGF5bG9hZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsUHJvamVjdGlvblBheWxvYWR9IHRhcmdldCAtIFRhcmdldCBwYXlsb2FkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH0gc291cmNlIC0gU291cmNlIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRQcm9qZWN0aW9uUGF5bG9hZCh0YXJnZXQsIHNvdXJjZSkge1xuICBpZiAoc291cmNlLnByZWxvYWQpIHtcbiAgICBpZiAoIXRhcmdldC5wcmVsb2FkKSB0YXJnZXQucHJlbG9hZCA9IHt9XG4gICAgbWVyZ2VGcm9udGVuZE1vZGVsRXZlbnRQcmVsb2FkKHRhcmdldC5wcmVsb2FkLCBzb3VyY2UucHJlbG9hZClcbiAgfVxuXG4gIGlmIChzb3VyY2Uuc2VsZWN0KSB7XG4gICAgaWYgKCF0YXJnZXQuc2VsZWN0KSB0YXJnZXQuc2VsZWN0ID0ge31cbiAgICBtZXJnZUZyb250ZW5kTW9kZWxFdmVudFNlbGVjdCh0YXJnZXQuc2VsZWN0LCBzb3VyY2Uuc2VsZWN0KVxuICB9XG5cbiAgaWYgKHNvdXJjZS5zZWxlY3RzRXh0cmEpIHtcbiAgICBpZiAoIXRhcmdldC5zZWxlY3RzRXh0cmEpIHRhcmdldC5zZWxlY3RzRXh0cmEgPSB7fVxuICAgIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50U2VsZWN0KHRhcmdldC5zZWxlY3RzRXh0cmEsIHNvdXJjZS5zZWxlY3RzRXh0cmEpXG4gIH1cblxuICBpZiAoc291cmNlLndpdGhDb3VudCkge1xuICAgIGlmICghdGFyZ2V0LndpdGhDb3VudCkgdGFyZ2V0LndpdGhDb3VudCA9IFtdXG4gICAgbWVyZ2VVbmlxdWVGcm9udGVuZE1vZGVsRXZlbnRFbnRyaWVzKHRhcmdldC53aXRoQ291bnQsIHNvdXJjZS53aXRoQ291bnQpXG4gIH1cblxuICBpZiAoc291cmNlLmFiaWxpdGllcykge1xuICAgIGlmICghdGFyZ2V0LmFiaWxpdGllcykgdGFyZ2V0LmFiaWxpdGllcyA9IFtdXG4gICAgbWVyZ2VVbmlxdWVGcm9udGVuZE1vZGVsRXZlbnRFbnRyaWVzKHRhcmdldC5hYmlsaXRpZXMsIHNvdXJjZS5hYmlsaXRpZXMpXG4gIH1cblxuICBpZiAoc291cmNlLnF1ZXJ5RGF0YSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgY29uc3QgdGFyZ2V0UXVlcnlEYXRhID0gQXJyYXkuaXNBcnJheSh0YXJnZXQucXVlcnlEYXRhKSA/IHRhcmdldC5xdWVyeURhdGEgOiBbXVxuXG4gICAgdGFyZ2V0LnF1ZXJ5RGF0YSA9IHRhcmdldFF1ZXJ5RGF0YVxuICAgIGNvbnN0IHF1ZXJ5RGF0YUVudHJpZXMgPSBBcnJheS5pc0FycmF5KHNvdXJjZS5xdWVyeURhdGEpID8gc291cmNlLnF1ZXJ5RGF0YSA6IFtzb3VyY2UucXVlcnlEYXRhXVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBxdWVyeURhdGFFbnRyaWVzKSB7XG4gICAgICB0YXJnZXRRdWVyeURhdGEucHVzaChlbnRyeSlcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIG1hdGNoZWQgZXZlbnQgZmlsdGVyIGtleXMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5IC0gUmF3IHdlYnNvY2tldCBldmVudCBib2R5LlxuICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIE1hdGNoZWQgZXZlbnQgZmlsdGVyIGtleXMgZGVsaXZlcmVkIGJ5IHRoZSBiYWNrZW5kLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsTWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyhib2R5KSB7XG4gIGlmICghYm9keSB8fCB0eXBlb2YgYm9keSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIG5ldyBTZXQoKVxuXG4gIGNvbnN0IGtleXMgPSAvKiogQHR5cGUge3ttYXRjaGVkRXZlbnRGaWx0ZXJLZXlzPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAqLyAoYm9keSkubWF0Y2hlZEV2ZW50RmlsdGVyS2V5c1xuXG4gIGlmICghQXJyYXkuaXNBcnJheShrZXlzKSkgcmV0dXJuIG5ldyBTZXQoKVxuXG4gIHJldHVybiBuZXcgU2V0KGtleXMubWFwKChrZXkpID0+IFN0cmluZyhrZXkpKSlcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGV2ZW50IGVudHJ5IG1hdGNoZXMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeX0gZW50cnkgLSBDYWxsYmFjayBlbnRyeS5cbiAqIEBwYXJhbSB7U2V0PHN0cmluZz59IG1hdGNoZWRFdmVudEZpbHRlcktleXMgLSBCYWNrZW5kIG1hdGNoZWQgZmlsdGVyIGtleXMuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgY2FsbGJhY2sgc2hvdWxkIHJlY2VpdmUgdGhlIGV2ZW50LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsRXZlbnRFbnRyeU1hdGNoZXMoZW50cnksIG1hdGNoZWRFdmVudEZpbHRlcktleXMpIHtcbiAgaWYgKCFlbnRyeS5ldmVudEZpbHRlcktleSkgcmV0dXJuIHRydWVcblxuICByZXR1cm4gbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cy5oYXMoZW50cnkuZXZlbnRGaWx0ZXJLZXkpXG59XG5cbi8qKlxuICogUnVucyBhc3NlcnQgbm8gZGVzdHJveSBldmVudCBmaWx0ZXIuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIEV2ZW50IG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IG9wdGlvbnMgLSBFdmVudCBvcHRpb25zLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydE5vRGVzdHJveUV2ZW50RmlsdGVyKE1vZGVsQ2xhc3MsIG9wdGlvbnMpIHtcbiAgY29uc3QgZXZlbnRPcHRpb25zUGF5bG9hZCA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKE1vZGVsQ2xhc3MsIG9wdGlvbnMpXG5cbiAgaWYgKCFldmVudE9wdGlvbnNQYXlsb2FkLmV2ZW50RmlsdGVyS2V5KSByZXR1cm5cblxuICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZCBtb2RlbCBkZXN0cm95IGV2ZW50IHN1YnNjcmlwdGlvbnMgZG8gbm90IHN1cHBvcnQgcXVlcnkgZmlsdGVyc1wiKVxufVxuXG4vKipcbiAqIFBlci1tb2RlbCBjbGFzcyBzaW5nbGV0b24gdGhhdCBtdWx0aXBsZXhlcyBhbGwgcmVnaXN0ZXJlZCBvbkNyZWF0ZSAvXG4gKiBvblVwZGF0ZSAvIG9uRGVzdHJveSBjYWxsYmFja3Mg4oCUIGNsYXNzLWxldmVsICsgaW5zdGFuY2UtbGV2ZWwg4oCUXG4gKiBvdmVyIG9uZSBXZWJzb2NrZXRDaGFubmVsVjIgc3Vic2NyaXB0aW9uLiBTdWJzY3JpcHRpb24gb3BlbnMgb24gdGhlXG4gKiBmaXJzdCBsaXN0ZW5lciBhbmQgY2xvc2VzIHdoZW4gdGhlIGxhc3Qgb25lIHVuc3Vic2NyaWJlcy5cbiAqXG4gKiBJbnN0YW5jZS1sZXZlbCBsaXN0ZW5lcnMgYWxzbyByZWNlaXZlIGF1dG8tbWVyZ2U6IHdoZW4gYW4gYHVwZGF0ZWBcbiAqIGV2ZW50IGFycml2ZXMgZm9yIGEgcmVnaXN0ZXJlZCBpbnN0YW5jZSBpZCwgdGhlIGluc3RhbmNlJ3NcbiAqIGF0dHJpYnV0ZXMgYXJlIHVwZGF0ZWQgaW4gcGxhY2UgYmVmb3JlIHRoZSBjYWxsYmFjayBmaXJlcywgc29cbiAqIGNhbGxlcnMgY2FuIHJlYWQgZnJlc2ggdmFsdWVzIGZyb20gdGhlIHNhbWUgaW5zdGFuY2UgaGFuZGxlLlxuICovXG5jbGFzcyBGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24ge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcyBmb3IgdGhpcyBzdWJzY3JpcHRpb24gYnVja2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHR9IHJlcXVlc3RDb250ZXh0IC0gQ2FwdHVyZWQgc3Vic2NyaXB0aW9uIGNvbnRleHQuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihNb2RlbENsYXNzLCByZXF1ZXN0Q29udGV4dCkge1xuICAgIHRoaXMuTW9kZWxDbGFzcyA9IE1vZGVsQ2xhc3NcbiAgICB0aGlzLnJlcXVlc3RDb250ZXh0ID0gcmVxdWVzdENvbnRleHRcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1NldDxGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnk+fSAqL1xuICAgIHRoaXMuY2xhc3NDcmVhdGVDYWxsYmFja3MgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1NldDxGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnk+fSAqL1xuICAgIHRoaXMuY2xhc3NVcGRhdGVDYWxsYmFja3MgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1NldDxGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50Q2FsbGJhY2tFbnRyeT59ICovXG4gICAgdGhpcy5jbGFzc0Rlc3Ryb3lDYWxsYmFja3MgPSBuZXcgU2V0KClcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge01hcDxzdHJpbmcsIHtpbnN0YW5jZTogRnJvbnRlbmRNb2RlbEJhc2UsIHVwZGF0ZUNhbGxiYWNrczogU2V0PEZyb250ZW5kTW9kZWxNb2RlbEV2ZW50Q2FsbGJhY2tFbnRyeT4sIGRlc3Ryb3lDYWxsYmFja3M6IFNldDxGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50Q2FsbGJhY2tFbnRyeT59Pn0gKi9cbiAgICB0aGlzLmluc3RhbmNlTGlzdGVuZXJzID0gbmV3IE1hcCgpXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICB0aGlzLmNoYW5uZWxIYW5kbGUgPSBudWxsXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLnJlYWR5UHJvbWlzZSA9IG51bGxcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge3N0cmluZyB8IG51bGx9ICovXG4gICAgdGhpcy5zdWJzY3JpcHRpb25QYXJhbXNLZXkgPSBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdWJzY3JpcHRpb24gcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7e21vZGVsOiBzdHJpbmcsIGRlc3Ryb3lFdmVudERlbGl2ZXJ5PzogYm9vbGVhbiwgZXZlbnRGaWx0ZXJzPzogaW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRGaWx0ZXJQYXlsb2FkRW50cnlbXSwgdW5maWx0ZXJlZEV2ZW50RGVsaXZlcnk/OiBib29sZWFufSAmIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbFByb2plY3Rpb25QYXlsb2FkfSAtIEN1cnJlbnQgd2Vic29ja2V0IHN1YnNjcmlwdGlvbiBwYXJhbXMuXG4gICAqL1xuICBzdWJzY3JpcHRpb25QYXJhbXMoKSB7XG4gICAgLyoqXG4gICAgICogUHJvamVjdGlvbiBwYXlsb2FkLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxQcm9qZWN0aW9uUGF5bG9hZH0gKi9cbiAgICBjb25zdCBwcm9qZWN0aW9uUGF5bG9hZCA9IHt9XG4gICAgLyoqXG4gICAgICogRXZlbnQgZmlsdGVycyBieSBrZXkuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50RmlsdGVyUGF5bG9hZEVudHJ5Pn0gKi9cbiAgICBjb25zdCBldmVudEZpbHRlcnNCeUtleSA9IHt9XG4gICAgY29uc3QgcHJvamVjdGlvbkVudHJpZXMgPSBbXVxuICAgIGxldCBoYXNEZXN0cm95RXZlbnREZWxpdmVyeSA9IHRoaXMuY2xhc3NEZXN0cm95Q2FsbGJhY2tzLnNpemUgPiAwXG4gICAgbGV0IGhhc1VuZmlsdGVyZWRFdmVudERlbGl2ZXJ5ID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgdGhpcy5jbGFzc0NyZWF0ZUNhbGxiYWNrcykgcHJvamVjdGlvbkVudHJpZXMucHVzaChlbnRyeSlcbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHRoaXMuY2xhc3NVcGRhdGVDYWxsYmFja3MpIHByb2plY3Rpb25FbnRyaWVzLnB1c2goZW50cnkpXG5cbiAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMudmFsdWVzKCkpIHtcbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbGlzdGVuZXIudXBkYXRlQ2FsbGJhY2tzKSBwcm9qZWN0aW9uRW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgaWYgKGxpc3RlbmVyLmRlc3Ryb3lDYWxsYmFja3Muc2l6ZSA+IDApIGhhc0Rlc3Ryb3lFdmVudERlbGl2ZXJ5ID0gdHJ1ZVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcHJvamVjdGlvbkVudHJpZXMpIHtcbiAgICAgIG1lcmdlRnJvbnRlbmRNb2RlbEV2ZW50UHJvamVjdGlvblBheWxvYWQocHJvamVjdGlvblBheWxvYWQsIGVudHJ5LnByb2plY3Rpb25QYXlsb2FkKVxuXG4gICAgICBpZiAoZW50cnkuZXZlbnRGaWx0ZXJLZXkgJiYgZW50cnkuZXZlbnRGaWx0ZXJQYXlsb2FkKSB7XG4gICAgICAgIGV2ZW50RmlsdGVyc0J5S2V5W2VudHJ5LmV2ZW50RmlsdGVyS2V5XSA9IHtcbiAgICAgICAgICAuLi5lbnRyeS5ldmVudEZpbHRlclBheWxvYWQsXG4gICAgICAgICAga2V5OiBlbnRyeS5ldmVudEZpbHRlcktleVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBoYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSA9IHRydWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBldmVudEZpbHRlcnMgPSBPYmplY3QudmFsdWVzKGV2ZW50RmlsdGVyc0J5S2V5KVxuICAgIGNvbnN0IGV2ZW50RmlsdGVyUGFyYW1zID0gZXZlbnRGaWx0ZXJzLmxlbmd0aCA+IDBcbiAgICAgID8ge1xuICAgICAgICAgIGV2ZW50RmlsdGVycyxcbiAgICAgICAgICAuLi4oaGFzRGVzdHJveUV2ZW50RGVsaXZlcnkgPyB7ZGVzdHJveUV2ZW50RGVsaXZlcnk6IHRydWV9IDoge30pLFxuICAgICAgICAgIC4uLihoYXNVbmZpbHRlcmVkRXZlbnREZWxpdmVyeSA/IHt1bmZpbHRlcmVkRXZlbnREZWxpdmVyeTogdHJ1ZX0gOiB7fSlcbiAgICAgICAgfVxuICAgICAgOiB7fVxuXG4gICAgcmV0dXJuIG1lcmdlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KFxuICAgICAgdGhpcy5yZXF1ZXN0Q29udGV4dCxcbiAgICAgIHtcbiAgICAgICAgbW9kZWw6IHRoaXMuTW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgLi4uZXZlbnRGaWx0ZXJQYXJhbXMsXG4gICAgICAgIC4uLnByb2plY3Rpb25QYXlsb2FkXG4gICAgICB9XG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3Vic2NyaXB0aW9uIHBhcmFtcyBqc29uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFN0YWJsZSBrZXkgZm9yIGN1cnJlbnQgc3Vic2NyaXB0aW9uIHBhcmFtcy5cbiAgICovXG4gIHN1YnNjcmlwdGlvblBhcmFtc0pzb24oKSB7XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWdpc3RlciBjbGFzcyBjYWxsYmFjay5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnkgfCBGcm9udGVuZE1vZGVsRGVzdHJveUV2ZW50Q2FsbGJhY2tFbnRyeX0gVFxuICAgKiBAcGFyYW0ge1NldDxUPn0gY2FsbGJhY2tzIC0gQ2FsbGJhY2sgc2V0IGZvciB0aGUgZXZlbnQgdHlwZS5cbiAgICogQHBhcmFtIHtUfSBlbnRyeSAtIENhbGxiYWNrIGVudHJ5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIGFzeW5jIHJlZ2lzdGVyQ2xhc3NDYWxsYmFjayhjYWxsYmFja3MsIGVudHJ5KSB7XG4gICAgY2FsbGJhY2tzLmFkZChlbnRyeSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmVuc3VyZVN1YnNjcmliZWQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjYWxsYmFja3MuZGVsZXRlKGVudHJ5KVxuICAgICAgdGhpcy5tYXliZVRlYXJkb3duKClcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIGNhbGxiYWNrcy5kZWxldGUoZW50cnkpXG4gICAgICB0aGlzLm1heWJlVGVhcmRvd24oKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBzdWJzY3JpYmVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgYXN5bmMgZW5zdXJlU3Vic2NyaWJlZCgpIHtcbiAgICBjb25zdCBwYXJhbXNKc29uID0gdGhpcy5zdWJzY3JpcHRpb25QYXJhbXNKc29uKClcblxuICAgIGlmICh0aGlzLmNoYW5uZWxIYW5kbGUgJiYgIXRoaXMuY2hhbm5lbEhhbmRsZS5pc0Nsb3NlZCgpKSB7XG4gICAgICBpZiAodGhpcy5zdWJzY3JpcHRpb25QYXJhbXNLZXkgIT09IHBhcmFtc0pzb24pIHtcbiAgICAgICAgdGhpcy5jaGFubmVsSGFuZGxlLmNsb3NlKClcbiAgICAgICAgdGhpcy5jaGFubmVsSGFuZGxlID0gbnVsbFxuICAgICAgICB0aGlzLnJlYWR5UHJvbWlzZSA9IG51bGxcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICh0aGlzLnJlYWR5UHJvbWlzZSkgYXdhaXQgdGhpcy5yZWFkeVByb21pc2VcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU2VyaWFsaXplIHBhcmFsbGVsIGNhbGxzIChlLmcuIFByb21pc2UuYWxsKFtvbkNyZWF0ZSwgb25VcGRhdGUsXG4gICAgLy8gb25EZXN0cm95XSkpIHNvIHdlIG9wZW4gZXhhY3RseSBvbmUgc3Vic2NyaXB0aW9uIHBlciBtb2RlbCBjbGFzc1xuICAgIC8vIGluc3RlYWQgb2YgcmFjaW5nIHRocmVlIGNvbmN1cnJlbnQgc3Vic2NyaWJlQ2hhbm5lbCBjYWxscy5cbiAgICBpZiAodGhpcy5yZWFkeVByb21pc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVhZHlQcm9taXNlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBjbGllbnQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgfHwgcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkpXG5cbiAgICBpZiAoIWNsaWVudCB8fCB0eXBlb2YgY2xpZW50LnN1YnNjcmliZUNoYW5uZWwgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQgbW9kZWwgZXZlbnQgc3Vic2NyaXB0aW9ucyByZXF1aXJlIGNvbmZpZ3VyZVRyYW5zcG9ydCh7d2Vic29ja2V0VXJsfSkgb3IgY29uZmlndXJlVHJhbnNwb3J0KHt3ZWJzb2NrZXRDbGllbnR9KVwiKVxuICAgIH1cblxuICAgIHRoaXMucmVhZHlQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIGlmICh0eXBlb2YgY2xpZW50LmNvbm5lY3QgPT09IFwiZnVuY3Rpb25cIikgYXdhaXQgY2xpZW50LmNvbm5lY3QoKVxuXG4gICAgICBjb25zdCBwYXJhbXMgPSB0aGlzLnN1YnNjcmlwdGlvblBhcmFtcygpXG5cbiAgICAgIHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zS2V5ID0gSlNPTi5zdHJpbmdpZnkocGFyYW1zKVxuICAgICAgdGhpcy5jaGFubmVsSGFuZGxlID0gY2xpZW50LnN1YnNjcmliZUNoYW5uZWwoRlJPTlRFTkRfTU9ERUxTX0NIQU5ORUxfTkFNRSwge1xuICAgICAgICBwYXJhbXMsXG4gICAgICAgIG9uTWVzc2FnZTogKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIGJvZHkpID0+IHRoaXMuX2Rpc3BhdGNoRXZlbnQoYm9keSksXG4gICAgICAgIG9uQ2xvc2U6ICgpID0+IHtcbiAgICAgICAgICB0aGlzLmNoYW5uZWxIYW5kbGUgPSBudWxsXG4gICAgICAgICAgdGhpcy5yZWFkeVByb21pc2UgPSBudWxsXG4gICAgICAgICAgdGhpcy5zdWJzY3JpcHRpb25QYXJhbXNLZXkgPSBudWxsXG4gICAgICAgICAgdGhpcy5pbnN0YW5jZUxpc3RlbmVycy5jbGVhcigpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICBhd2FpdCB0aGlzLmNoYW5uZWxIYW5kbGUucmVhZHlcbiAgICB9KSgpXG5cbiAgICBhd2FpdCB0aGlzLnJlYWR5UHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzcGF0Y2ggZXZlbnQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBXZWJTb2NrZXQgZXZlbnQgcGF5bG9hZC5cbiAgICovXG4gIF9kaXNwYXRjaEV2ZW50KGJvZHkpIHtcbiAgICBpZiAoIWJvZHkgfHwgdHlwZW9mIGJvZHkgIT09IFwib2JqZWN0XCIpIHJldHVyblxuXG4gICAgY29uc3QgYWN0aW9uID0gYm9keS5hY3Rpb25cbiAgICBjb25zdCByYXdJZCA9IGJvZHkuaWRcblxuICAgIGlmIChhY3Rpb24gIT09IFwiY3JlYXRlXCIgJiYgYWN0aW9uICE9PSBcInVwZGF0ZVwiICYmIGFjdGlvbiAhPT0gXCJkZXN0cm95XCIpIHJldHVyblxuICAgIGlmIChyYXdJZCA9PT0gdW5kZWZpbmVkIHx8IHJhd0lkID09PSBudWxsKSByZXR1cm5cblxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLk1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgaWRlbnRpdHkgPSBBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpXG4gICAgICA/IG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMocHJpbWFyeUtleSwgcmF3SWQpXG4gICAgICA6IFN0cmluZyhyYXdJZClcbiAgICBjb25zdCBpZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIGlkZW50aXR5KVxuICAgIGNvbnN0IG1hdGNoZWRFdmVudEZpbHRlcktleXMgPSBmcm9udGVuZE1vZGVsTWF0Y2hlZEV2ZW50RmlsdGVyS2V5cyhib2R5KVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJkZXN0cm95XCIpIHtcbiAgICAgIGNvbnN0IGxpc3RlbmVyID0gdGhpcy5pbnN0YW5jZUxpc3RlbmVycy5nZXQoaWQpXG5cbiAgICAgIGlmIChsaXN0ZW5lcikge1xuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxpc3RlbmVyLmRlc3Ryb3lDYWxsYmFja3MpIHtcbiAgICAgICAgICB0cnkgeyBlbnRyeS5jYWxsYmFjayh7aWQ6IGlkZW50aXR5fSkgfSBjYXRjaCAoZXJyb3IpIHsgY29uc29sZS5lcnJvcihlcnJvcikgfVxuICAgICAgICB9XG4gICAgICAgIGRlbGV0ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyKHRoaXMsIGxpc3RlbmVyKVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLmNsYXNzRGVzdHJveUNhbGxiYWNrcykge1xuICAgICAgICB0cnkgeyBlbnRyeS5jYWxsYmFjayh7aWQ6IGlkZW50aXR5fSkgfSBjYXRjaCAoZXJyb3IpIHsgY29uc29sZS5lcnJvcihlcnJvcikgfVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKCFib2R5LnJlY29yZCB8fCB0eXBlb2YgYm9keS5yZWNvcmQgIT09IFwib2JqZWN0XCIpIHJldHVyblxuXG4gICAgY29uc3QgZGVzZXJpYWxpemVkUmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShib2R5LnJlY29yZCkpXG4gICAgY29uc3QgZnJlc2hNb2RlbCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzLk1vZGVsQ2xhc3MpLmluc3RhbnRpYXRlRnJvbVJlc3BvbnNlKGRlc2VyaWFsaXplZFJlY29yZClcbiAgICBjb25zdCBsaXN0ZW5lciA9IHRoaXMuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KGlkKVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJ1cGRhdGVcIiAmJiBsaXN0ZW5lcikge1xuICAgICAgY29uc3QgbWF0Y2hpbmdVcGRhdGVDYWxsYmFja3MgPSBBcnJheS5mcm9tKGxpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcykuZmlsdGVyKChlbnRyeSkgPT5cbiAgICAgICAgZnJvbnRlbmRNb2RlbEV2ZW50RW50cnlNYXRjaGVzKGVudHJ5LCBtYXRjaGVkRXZlbnRGaWx0ZXJLZXlzKVxuICAgICAgKVxuXG4gICAgICBpZiAobWF0Y2hpbmdVcGRhdGVDYWxsYmFja3MubGVuZ3RoID4gMCkge1xuICAgICAgICAvLyBBdXRvLW1lcmdlIGludG8gdGhlIHJlZ2lzdGVyZWQgaW5zdGFuY2Ugc28gY2FsbGVycyByZWFkaW5nXG4gICAgICAgIC8vIHRocm91Z2ggdGhlIHNhbWUgaGFuZGxlIHNlZSBmcmVzaCBhdHRyaWJ1dGVzLlxuICAgICAgICBjb25zdCBpbnN0YW5jZUFueSA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChsaXN0ZW5lci5pbnN0YW5jZSlcblxuICAgICAgICBpbnN0YW5jZUFueS5hc3NpZ25BdHRyaWJ1dGVzKGZyZXNoTW9kZWwuYXR0cmlidXRlcygpKVxuICAgICAgICBpbnN0YW5jZUFueS5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMobGlzdGVuZXIuaW5zdGFuY2UuYXR0cmlidXRlcygpKVxuXG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgbWF0Y2hpbmdVcGRhdGVDYWxsYmFja3MpIHtcbiAgICAgICAgICB0cnkgeyBlbnRyeS5jYWxsYmFjayh7aWQ6IGlkZW50aXR5LCBtb2RlbDogbGlzdGVuZXIuaW5zdGFuY2V9KSB9IGNhdGNoIChlcnJvcikgeyBjb25zb2xlLmVycm9yKGVycm9yKSB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjbGFzc0NhbGxiYWNrcyA9IGFjdGlvbiA9PT0gXCJjcmVhdGVcIiA/IHRoaXMuY2xhc3NDcmVhdGVDYWxsYmFja3MgOiB0aGlzLmNsYXNzVXBkYXRlQ2FsbGJhY2tzXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNsYXNzQ2FsbGJhY2tzKSB7XG4gICAgICBpZiAoIWZyb250ZW5kTW9kZWxFdmVudEVudHJ5TWF0Y2hlcyhlbnRyeSwgbWF0Y2hlZEV2ZW50RmlsdGVyS2V5cykpIGNvbnRpbnVlXG5cbiAgICAgIHRyeSB7IGVudHJ5LmNhbGxiYWNrKHtpZDogaWRlbnRpdHksIG1vZGVsOiBmcmVzaE1vZGVsfSkgfSBjYXRjaCAoZXJyb3IpIHsgY29uc29sZS5lcnJvcihlcnJvcikgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1heWJlIHRlYXJkb3duLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gKi9cbiAgbWF5YmVUZWFyZG93bigpIHtcbiAgICBjb25zdCBoYXNBbnlMaXN0ZW5lciA9IHRoaXMuY2xhc3NDcmVhdGVDYWxsYmFja3Muc2l6ZSA+IDBcbiAgICAgIHx8IHRoaXMuY2xhc3NVcGRhdGVDYWxsYmFja3Muc2l6ZSA+IDBcbiAgICAgIHx8IHRoaXMuY2xhc3NEZXN0cm95Q2FsbGJhY2tzLnNpemUgPiAwXG4gICAgICB8fCB0aGlzLmluc3RhbmNlTGlzdGVuZXJzLnNpemUgPiAwXG5cbiAgICBpZiAoaGFzQW55TGlzdGVuZXIpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuY2hhbm5lbEhhbmRsZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5jaGFubmVsSGFuZGxlLmNsb3NlKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5jaGFubmVsSGFuZGxlID0gbnVsbFxuICAgIHRoaXMucmVhZHlQcm9taXNlID0gbnVsbFxuICAgIHRoaXMuc3Vic2NyaXB0aW9uUGFyYW1zS2V5ID0gbnVsbFxuICAgIHJlbGVhc2VGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24odGhpcylcbiAgfVxufVxuXG4vKipcbiAqIEZyb250ZW5kIG1vZGVsIGV2ZW50IHN1YnNjcmlwdGlvbnMuXG4gKiBAdHlwZSB7V2Vha01hcDxGcm9udGVuZE1vZGVsQ2xhc3MsIE1hcDxzdHJpbmcsIEZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbj4+fSAqL1xuY29uc3QgZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucyA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBSdW5zIGVuc3VyZSBmcm9udGVuZCBtb2RlbCBldmVudCBzdWJzY3JpcHRpb24uXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0fSByZXF1ZXN0Q29udGV4dCAtIENhcHR1cmVkIHN1YnNjcmlwdGlvbiBjb250ZXh0LlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gLSBQZXItY2xhc3Mgc3Vic2NyaXB0aW9uIGhlbHBlci5cbiAqL1xuZnVuY3Rpb24gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIHJlcXVlc3RDb250ZXh0KSB7XG4gIGxldCBzdWJzY3JpcHRpb25zID0gZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5nZXQoTW9kZWxDbGFzcylcblxuICBpZiAoIXN1YnNjcmlwdGlvbnMpIHtcbiAgICBzdWJzY3JpcHRpb25zID0gbmV3IE1hcCgpXG4gICAgZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5zZXQoTW9kZWxDbGFzcywgc3Vic2NyaXB0aW9ucylcbiAgfVxuXG4gIGNvbnN0IGNvbnRleHRLZXkgPSByZW1vdGVSZXF1ZXN0Q29udGV4dEtleShyZXF1ZXN0Q29udGV4dClcbiAgbGV0IHN1YiA9IHN1YnNjcmlwdGlvbnMuZ2V0KGNvbnRleHRLZXkpXG5cbiAgaWYgKCFzdWIpIHtcbiAgICBzdWIgPSBuZXcgRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIHJlcXVlc3RDb250ZXh0KVxuICAgIHN1YnNjcmlwdGlvbnMuc2V0KGNvbnRleHRLZXksIHN1YilcbiAgfVxuXG4gIHJldHVybiBzdWJcbn1cblxuLyoqXG4gKiBSZW1vdmVzIGFuIGVtcHR5IGNvbnRleHQgYnVja2V0IHNvIHN3aXRjaGluZyB0aHJvdWdoIG1hbnkgdGVuYW50cyBkb2VzIG5vdCByZXRhaW4gZXZlcnkgc25hcHNob3QuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gc3Vic2NyaXB0aW9uIC0gRW1wdHkgc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZWxlYXNlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKHN1YnNjcmlwdGlvbikge1xuICBjb25zdCBzdWJzY3JpcHRpb25zID0gZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5nZXQoc3Vic2NyaXB0aW9uLk1vZGVsQ2xhc3MpXG4gIGNvbnN0IGNvbnRleHRLZXkgPSByZW1vdGVSZXF1ZXN0Q29udGV4dEtleShzdWJzY3JpcHRpb24ucmVxdWVzdENvbnRleHQpXG5cbiAgaWYgKHN1YnNjcmlwdGlvbnM/LmdldChjb250ZXh0S2V5KSAhPT0gc3Vic2NyaXB0aW9uKSByZXR1cm5cblxuICBzdWJzY3JpcHRpb25zLmRlbGV0ZShjb250ZXh0S2V5KVxuICBpZiAoc3Vic2NyaXB0aW9ucy5zaXplID09PSAwKSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmRlbGV0ZShzdWJzY3JpcHRpb24uTW9kZWxDbGFzcylcbn1cblxuLyoqXG4gKiBDYXB0dXJlcyB0aGUgY3VycmVudCBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgY29udGV4dCBmb3Igb25lIG9wZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0fSBGcm96ZW4gY29udGV4dCBzbmFwc2hvdC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KCkge1xuICBjb25zdCBjb25maWd1cmVkQ29udGV4dCA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RDb250ZXh0ID09PSBcImZ1bmN0aW9uXCJcbiAgICA/IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdENvbnRleHQoKVxuICAgIDogZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5yZXF1ZXN0Q29udGV4dFxuXG4gIHJldHVybiBjYXB0dXJlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KGNvbmZpZ3VyZWRDb250ZXh0KVxufVxuXG4vKipcbiAqIENhcHR1cmVzIHRoZSBleHBsaWNpdCBsaWZlY3ljbGUgY29udGV4dCBvciBmYWxscyBiYWNrIHRvIHRoZSBjb25maWd1cmVkIHRyYW5zcG9ydCBjb250ZXh0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0IHwgdW5kZWZpbmVkfSByZXF1ZXN0Q29udGV4dCAtIFJlZ2lzdHJhdGlvbi1sb2NhbCBjb250ZXh0LlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHR9IEZyb3plbiBjb250ZXh0IHNuYXBzaG90LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsRXZlbnRSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCkge1xuICBpZiAocmVxdWVzdENvbnRleHQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCgpXG5cbiAgcmV0dXJuIGNhcHR1cmVGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpXG59XG5cbi8qKlxuICogUnVucyBlbnN1cmUgZnJvbnRlbmQgbW9kZWwgaW5zdGFuY2UgbGlzdGVuZXIuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0gc3ViIC0gRXZlbnQgc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBpZCAtIE1vZGVsIGlkLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gaW5zdGFuY2UgLSBMaXN0ZW5lciBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHt7aW5zdGFuY2U6IEZyb250ZW5kTW9kZWxCYXNlLCB1cGRhdGVDYWxsYmFja3M6IFNldDxGcm9udGVuZE1vZGVsTW9kZWxFdmVudENhbGxiYWNrRW50cnk+LCBkZXN0cm95Q2FsbGJhY2tzOiBTZXQ8RnJvbnRlbmRNb2RlbERlc3Ryb3lFdmVudENhbGxiYWNrRW50cnk+fX0gLSBJbnN0YW5jZSBsaXN0ZW5lciBidWNrZXQuXG4gKi9cbmZ1bmN0aW9uIGVuc3VyZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyKHN1YiwgaWQsIGluc3RhbmNlKSB7XG4gIGxldCBsaXN0ZW5lciA9IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQoaWQpXG5cbiAgaWYgKCFsaXN0ZW5lcikge1xuICAgIGxpc3RlbmVyID0ge2luc3RhbmNlLCB1cGRhdGVDYWxsYmFja3M6IG5ldyBTZXQoKSwgZGVzdHJveUNhbGxiYWNrczogbmV3IFNldCgpfVxuICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5zZXQoaWQsIGxpc3RlbmVyKVxuICB9IGVsc2Uge1xuICAgIGxpc3RlbmVyLmluc3RhbmNlID0gaW5zdGFuY2VcbiAgfVxuXG4gIHJldHVybiBsaXN0ZW5lclxufVxuXG4vKipcbiAqIFJlbW92ZXMgZXZlcnkgaWRlbnRpdHkga2V5IHBvaW50aW5nIGF0IGFuIGluc3RhbmNlIGxpc3RlbmVyLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb259IHN1YiAtIEV2ZW50IHN1YnNjcmlwdGlvbiBidWNrZXQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIGVuc3VyZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyPn0gbGlzdGVuZXIgLSBJbnN0YW5jZSBsaXN0ZW5lciBidWNrZXQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gZGVsZXRlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIoc3ViLCBsaXN0ZW5lcikge1xuICBmb3IgKGNvbnN0IFtpZCwgY3VycmVudF0gb2Ygc3ViLmluc3RhbmNlTGlzdGVuZXJzKSB7XG4gICAgaWYgKGN1cnJlbnQgPT09IGxpc3RlbmVyKSBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZGVsZXRlKGlkKVxuICB9XG59XG5cbi8qKlxuICogUmVtb3ZlcyBvbmUgaW5zdGFuY2UgY2FsbGJhY2sgZW50cnkgYW5kIHRlYXJzIGRvd24gYW4gZW1wdHkgbGlzdGVuZXIvc3Vic2NyaXB0aW9uIGJ1Y2tldC5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ufSBzdWIgLSBFdmVudCBzdWJzY3JpcHRpb24gYnVja2V0LlxuICogQHBhcmFtIHsobGlzdGVuZXI6IFJldHVyblR5cGU8dHlwZW9mIGVuc3VyZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyPikgPT4gYm9vbGVhbn0gcmVtb3ZlRW50cnkgLSBDYWxsYmFjayBlbnRyeSByZW1vdmFsLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCByZW1vdmVFbnRyeSkge1xuICBmb3IgKGNvbnN0IGN1cnJlbnQgb2Ygc3ViLmluc3RhbmNlTGlzdGVuZXJzLnZhbHVlcygpKSB7XG4gICAgaWYgKCFyZW1vdmVFbnRyeShjdXJyZW50KSkgY29udGludWVcblxuICAgIGlmIChjdXJyZW50LnVwZGF0ZUNhbGxiYWNrcy5zaXplID09PSAwICYmIGN1cnJlbnQuZGVzdHJveUNhbGxiYWNrcy5zaXplID09PSAwKSB7XG4gICAgICBkZWxldGVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcihzdWIsIGN1cnJlbnQpXG4gICAgfVxuICAgIGJyZWFrXG4gIH1cblxuICBzdWIubWF5YmVUZWFyZG93bigpXG59XG5cbi8qKlxuICogVGVtcG9yYXJpbHkgcmVnaXN0ZXJzIGFuIGluc3RhbmNlIGxpc3RlbmVyIHVuZGVyIGl0cyBwZW5kaW5nIGlkZW50aXR5IHdoaWxlIHJldGFpbmluZyBpdHMgcGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IGluc3RhbmNlIC0gSW5zdGFuY2UgYmVpbmcgcmUta2V5ZWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBwcmV2aW91c0lkZW50aXR5IC0gUGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gbmV4dElkZW50aXR5IC0gUGVuZGluZyBpZGVudGl0eSBzZW50IHRvIHRoZSBzZXJ2ZXIuXG4gKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gLSBDYWxsYmFjayB0aGF0IHJlbW92ZXMgdGhlIHRlbXBvcmFyeSBhbGlhc2VzLlxuICovXG5mdW5jdGlvbiBhbGlhc0Zyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyhNb2RlbENsYXNzLCBpbnN0YW5jZSwgcHJldmlvdXNJZGVudGl0eSwgbmV4dElkZW50aXR5KSB7XG4gIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICBjb25zdCBwcmV2aW91c0lkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcHJldmlvdXNJZGVudGl0eSlcbiAgY29uc3QgbmV4dElkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgbmV4dElkZW50aXR5KVxuICAvKiogQHR5cGUge0FycmF5PHtsaXN0ZW5lcjogUmV0dXJuVHlwZTx0eXBlb2YgZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXI+LCBzdWI6IEZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbn0+fSAqL1xuICBjb25zdCBhbGlhc2VzID0gW11cblxuICBpZiAocHJldmlvdXNJZCA9PT0gbmV4dElkKSByZXR1cm4gKCkgPT4ge31cblxuICBjb25zdCBzdWJzY3JpcHRpb25zID0gZnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9ucy5nZXQoTW9kZWxDbGFzcylcblxuICBpZiAoIXN1YnNjcmlwdGlvbnMpIHJldHVybiAoKSA9PiB7fVxuXG4gIGZvciAoY29uc3Qgc3ViIG9mIHN1YnNjcmlwdGlvbnMudmFsdWVzKCkpIHtcbiAgICBjb25zdCBsaXN0ZW5lciA9IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5nZXQocHJldmlvdXNJZClcblxuICAgIGlmICghbGlzdGVuZXIgfHwgbGlzdGVuZXIuaW5zdGFuY2UgIT09IGluc3RhbmNlIHx8IHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5oYXMobmV4dElkKSkgY29udGludWVcblxuICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5zZXQobmV4dElkLCBsaXN0ZW5lcilcbiAgICBhbGlhc2VzLnB1c2goe2xpc3RlbmVyLCBzdWJ9KVxuICB9XG5cbiAgcmV0dXJuICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IHtsaXN0ZW5lciwgc3VifSBvZiBhbGlhc2VzKSB7XG4gICAgICBpZiAoc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChwcmV2aW91c0lkKSA9PT0gbGlzdGVuZXIgJiYgc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChuZXh0SWQpID09PSBsaXN0ZW5lcikge1xuICAgICAgICBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZGVsZXRlKG5leHRJZClcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBNb3ZlcyBjYWxsYmFja3MgcmVnaXN0ZXJlZCBvbiBhbiBpbnN0YW5jZSB0byBpdHMgbmV3bHkgcGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBGcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2V9IGluc3RhbmNlIC0gUmUta2V5ZWQgaW5zdGFuY2UuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBwcmV2aW91c0lkZW50aXR5IC0gUHJldmlvdXMgcGVyc2lzdGVkIGlkZW50aXR5LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gbmV4dElkZW50aXR5IC0gTmV3IHBlcnNpc3RlZCBpZGVudGl0eS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZWtleUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyhNb2RlbENsYXNzLCBpbnN0YW5jZSwgcHJldmlvdXNJZGVudGl0eSwgbmV4dElkZW50aXR5KSB7XG4gIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICBjb25zdCBwcmV2aW91c0lkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcHJldmlvdXNJZGVudGl0eSlcbiAgY29uc3QgbmV4dElkID0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgbmV4dElkZW50aXR5KVxuXG4gIGlmIChwcmV2aW91c0lkID09PSBuZXh0SWQpIHJldHVyblxuXG4gIGNvbnN0IHN1YnNjcmlwdGlvbnMgPSBmcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb25zLmdldChNb2RlbENsYXNzKVxuXG4gIGlmICghc3Vic2NyaXB0aW9ucykgcmV0dXJuXG5cbiAgZm9yIChjb25zdCBzdWIgb2Ygc3Vic2NyaXB0aW9ucy52YWx1ZXMoKSkge1xuICAgIGNvbnN0IGxpc3RlbmVyID0gc3ViLmluc3RhbmNlTGlzdGVuZXJzLmdldChwcmV2aW91c0lkKVxuXG4gICAgaWYgKCFsaXN0ZW5lciB8fCBsaXN0ZW5lci5pbnN0YW5jZSAhPT0gaW5zdGFuY2UpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBuZXh0TGlzdGVuZXIgPSBzdWIuaW5zdGFuY2VMaXN0ZW5lcnMuZ2V0KG5leHRJZClcblxuICAgIHN1Yi5pbnN0YW5jZUxpc3RlbmVycy5kZWxldGUocHJldmlvdXNJZClcblxuICAgIGlmIChuZXh0TGlzdGVuZXIpIHtcbiAgICAgIG5leHRMaXN0ZW5lci5pbnN0YW5jZSA9IGluc3RhbmNlXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcykgbmV4dExpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcy5hZGQoZW50cnkpXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxpc3RlbmVyLmRlc3Ryb3lDYWxsYmFja3MpIG5leHRMaXN0ZW5lci5kZXN0cm95Q2FsbGJhY2tzLmFkZChlbnRyeSlcbiAgICB9IGVsc2Uge1xuICAgICAgc3ViLmluc3RhbmNlTGlzdGVuZXJzLnNldChuZXh0SWQsIGxpc3RlbmVyKVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY29tbWFuZCB1cmwuXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVzb3VyY2VQYXRoIC0gUmVzb3VyY2UgcGF0aCBwcmVmaXguXG4gKiBAcGFyYW0ge3N0cmluZ30gY29tbWFuZE5hbWUgLSBDb21tYW5kIHBhdGggc2VnbWVudC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRnJvbnRlbmQgbW9kZWwgQVBJIFVSTC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbENvbW1hbmRVcmwocmVzb3VyY2VQYXRoLCBjb21tYW5kTmFtZSkge1xuICBjb25zdCBjb25maWd1cmVkVXJsID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFVybCgpXG4gIGNvbnN0IG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGggPSByZXNvdXJjZVBhdGguc3RhcnRzV2l0aChcIi9cIikgPyByZXNvdXJjZVBhdGggOiBgLyR7cmVzb3VyY2VQYXRofWBcblxuICByZXR1cm4gYCR7Y29uZmlndXJlZFVybH0ke25vcm1hbGl6ZWRSZXNvdXJjZVBhdGh9LyR7Y29tbWFuZE5hbWV9YFxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgYXBpIHVybC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSBVUkwuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxBcGlVcmwoKSB7XG4gIHJldHVybiBgJHtmcm9udGVuZE1vZGVsVHJhbnNwb3J0VXJsKCl9JHtTSEFSRURfRlJPTlRFTkRfTU9ERUxfQVBJX1BBVEh9YFxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgdHJhbnNwb3J0IHBhdGguXG4gKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gUmVxdWVzdCBVUkwgb3IgcGF0aC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gV2Vic29ja2V0LXNhZmUgcmVxdWVzdCBwYXRoLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0UGF0aCh1cmwpIHtcbiAgaWYgKHR5cGVvZiB1cmwgIT09IFwic3RyaW5nXCIgfHwgdXJsLmxlbmd0aCA8IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCBVUkwvcGF0aCwgZ290OiAke3VybH1gKVxuICB9XG5cbiAgaWYgKHVybC5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgIHJldHVybiB1cmxcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgcGFyc2VkVXJsID0gbmV3IFVSTCh1cmwpXG5cbiAgICByZXR1cm4gYCR7cGFyc2VkVXJsLnBhdGhuYW1lfSR7cGFyc2VkVXJsLnNlYXJjaH1gXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB1cmxcbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBicm93c2VyIHJ1bnRpbWUgdGltZXpvbmUgd2hlbiBhdmFpbGFibGUuXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIEJyb3dzZXIgcnVudGltZSB0aW1lem9uZSB3aGVuIGF2YWlsYWJsZS5cbiAqL1xuZnVuY3Rpb24gZGVmYXVsdEZyb250ZW5kTW9kZWxUaW1lWm9uZSgpIHtcbiAgaWYgKHR5cGVvZiB3aW5kb3cgPT09IFwidW5kZWZpbmVkXCIpIHJldHVybiB1bmRlZmluZWRcblxuICBjb25zdCBpbnRsID0gZ2xvYmFsVGhpcy5JbnRsXG5cbiAgaWYgKCFpbnRsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgSW50bCB0byBiZSBhdmFpbGFibGUgZm9yIGJyb3dzZXIgdGltZXpvbmUgZGV0ZWN0aW9uXCIpXG4gIH1cblxuICBpZiAodHlwZW9mIGludGwuRGF0ZVRpbWVGb3JtYXQgIT09IFwiZnVuY3Rpb25cIikge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIEludGwuRGF0ZVRpbWVGb3JtYXQgdG8gYmUgYXZhaWxhYmxlIGFzIGEgZnVuY3Rpb25cIilcbiAgfVxuXG4gIGNvbnN0IHRpbWVab25lID0gaW50bC5EYXRlVGltZUZvcm1hdCgpLnJlc29sdmVkT3B0aW9ucygpLnRpbWVab25lXG5cbiAgaWYgKHR5cGVvZiB0aW1lWm9uZSAhPT0gXCJzdHJpbmdcIiB8fCB0aW1lWm9uZS50cmltKCkubGVuZ3RoIDwgMSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIEludGwuRGF0ZVRpbWVGb3JtYXQgdG8gcmVzb2x2ZSBhIGJyb3dzZXIgdGltZXpvbmUgc3RyaW5nXCIpXG4gIH1cblxuICByZXR1cm4gdmFsaWRhdGVUaW1lWm9uZSh0aW1lWm9uZSwgXCJicm93c2VyIHRpbWVab25lXCIpXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGNvbmZpZ3VyZWQgZnJvbnRlbmQtbW9kZWwgcmVxdWVzdCB0aW1lem9uZS5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQ29uZmlndXJlZCBmcm9udGVuZC1tb2RlbCB0aW1lem9uZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVab25lKCkge1xuICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLCBcInRpbWVab25lXCIpKSB7XG4gICAgcmV0dXJuIGRlZmF1bHRGcm9udGVuZE1vZGVsVGltZVpvbmUoKVxuICB9XG5cbiAgY29uc3QgdGltZVpvbmUgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lWm9uZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lKClcbiAgICA6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZVpvbmVcblxuICBpZiAodGltZVpvbmUgPT09IHVuZGVmaW5lZCB8fCB0aW1lWm9uZSA9PT0gbnVsbCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB0aW1lWm9uZSBkaWQgbm90IHJlc29sdmUgdG8gYSB0aW1lem9uZSBzdHJpbmdcIilcbiAgfVxuXG4gIHJldHVybiB2YWxpZGF0ZVRpbWVab25lKHRpbWVab25lLCBcImZyb250ZW5kIG1vZGVsIHRyYW5zcG9ydCB0aW1lWm9uZVwiKVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVxdWVzdCBoZWFkZXJzLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IFt0aW1lWm9uZV0gLSBQcmUtcmVzb2x2ZWQgdGltZXpvbmUgZm9yIHRoaXMgcmVxdWVzdC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIEhlYWRlcnMgZm9yIGZyb250ZW5kLW1vZGVsIEhUVFAgcmVxdWVzdHMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXF1ZXN0SGVhZGVycyh0aW1lWm9uZSA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpKSB7XG4gIGNvbnN0IGR5bmFtaWNIZWFkZXJzID0gdHlwZW9mIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdEhlYWRlcnMgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdEhlYWRlcnMoKSB8fCB7fSlcbiAgICA6IChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RIZWFkZXJzIHx8IHt9KVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovXG4gIGNvbnN0IGhlYWRlcnMgPSB7XCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsIC4uLmR5bmFtaWNIZWFkZXJzfVxuXG4gIGlmICh0aW1lWm9uZSkge1xuICAgIGhlYWRlcnNbUkVRVUVTVF9USU1FX1pPTkVfSEVBREVSXSA9IHRpbWVab25lXG4gIH1cblxuICByZXR1cm4gaGVhZGVyc1xufVxuXG4vKipcbiAqIFJlc29sdmVzIHRoZSBjb25maWd1cmVkIGJvdW5kZWQgdHJhbnNwb3J0IGRlYWRsaW5lIGluIG1pbGxpc2Vjb25kcy5cbiAqIEByZXR1cm5zIHtudW1iZXIgfCB1bmRlZmluZWR9IC0gQ29uZmlndXJlZCBkZWFkbGluZSwgb3IgdW5kZWZpbmVkIHdoZW4gbm8gZGVhZGxpbmUgaXMgc2V0LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKCkge1xuICBjb25zdCBjb25maWd1cmVkVGltZW91dCA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVvdXQgPT09IFwiZnVuY3Rpb25cIlxuICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy50aW1lb3V0KClcbiAgICA6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudGltZW91dFxuXG4gIGlmICh0eXBlb2YgY29uZmlndXJlZFRpbWVvdXQgIT09IFwibnVtYmVyXCIgfHwgIShjb25maWd1cmVkVGltZW91dCA+IDApKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgcmV0dXJuIGNvbmZpZ3VyZWRUaW1lb3V0XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgdGhlIGNvbmZpZ3VyZWQgY2FsbGVyL3Nlc3Npb24gQWJvcnRTaWduYWwgY29tcG9zZWQgd2l0aCB0aGUgZGVhZGxpbmUuXG4gKiBAcmV0dXJucyB7QWJvcnRTaWduYWwgfCB1bmRlZmluZWR9IC0gQ29uZmlndXJlZCBjYWxsZXIgc2lnbmFsLCBvciB1bmRlZmluZWQgd2hlbiBub25lIGlzIHNldC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpIHtcbiAgY29uc3QgY29uZmlndXJlZFNpZ25hbCA9IHR5cGVvZiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNpZ25hbCA9PT0gXCJmdW5jdGlvblwiXG4gICAgPyBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNpZ25hbCgpXG4gICAgOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNpZ25hbFxuXG4gIHJldHVybiBjb25maWd1cmVkU2lnbmFsIHx8IHVuZGVmaW5lZFxufVxuXG4vKipcbiAqIFJlc29sdmVzIHBlci1zdGFydHVwIGNvbnRyb2xzIHdpdGggdGhlIGNvbmZpZ3VyZWQgc2Vzc2lvbiBjYW5jZWxsYXRpb24uXG4gKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIsIHNpZ25hbD86IEFib3J0U2lnbmFsfX0gY29udHJvbHMgLSBDYWxsIGNvbnRyb2xzLlxuICogQHJldHVybnMge3t0aW1lb3V0TXM/OiBudW1iZXIsIHNpZ25hbD86IEFib3J0U2lnbmFsfX0gLSBFZmZlY3RpdmUgc3RhcnR1cCBjb250cm9scy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFdlYnNvY2tldFN0YXJ0dXBDb250cm9scyhjb250cm9scykge1xuICBjb25zdCBzZXNzaW9uU2lnbmFsID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFNpZ25hbCgpXG4gIGxldCBzaWduYWwgPSBjb250cm9scy5zaWduYWwgfHwgc2Vzc2lvblNpZ25hbFxuXG4gIGlmIChjb250cm9scy5zaWduYWwgJiYgc2Vzc2lvblNpZ25hbCAmJiBjb250cm9scy5zaWduYWwgIT09IHNlc3Npb25TaWduYWwpIHtcbiAgICBzaWduYWwgPSBBYm9ydFNpZ25hbC5hbnkoW2NvbnRyb2xzLnNpZ25hbCwgc2Vzc2lvblNpZ25hbF0pXG4gIH1cblxuICBjb25zdCBjb25maWd1cmVkVGltZW91dE1zID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydFRpbWVvdXRNcygpXG4gIGNvbnN0IHRpbWVvdXRNcyA9IGNvbnRyb2xzLnRpbWVvdXRNcyA9PT0gdW5kZWZpbmVkXG4gICAgPyBjb25maWd1cmVkVGltZW91dE1zXG4gICAgOiBjb25maWd1cmVkVGltZW91dE1zID09PSB1bmRlZmluZWRcbiAgICAgID8gY29udHJvbHMudGltZW91dE1zXG4gICAgICA6IE1hdGgubWluKGNvbnRyb2xzLnRpbWVvdXRNcywgY29uZmlndXJlZFRpbWVvdXRNcylcblxuICByZXR1cm4ge3NpZ25hbCwgdGltZW91dE1zfVxufVxuXG4vKipcbiAqIFJ1bnMgcGVyZm9ybSBzaGFyZWQgZnJvbnRlbmQgbW9kZWwgYXBpIHJlcXVlc3QuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcmVxdWVzdFBheWxvYWQgLSBTaGFyZWQgcmVxdWVzdCBwYXlsb2FkLlxuICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBEZWNvZGVkIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgcmVzcG9uc2UuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHBlcmZvcm1TaGFyZWRGcm9udGVuZE1vZGVsQXBpUmVxdWVzdChyZXF1ZXN0UGF5bG9hZCkge1xuICBjb25zdCB0aW1lWm9uZSA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpXG4gIGNvbnN0IHNlcmlhbGl6ZWRSZXF1ZXN0UGF5bG9hZCA9IHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShyZXF1ZXN0UGF5bG9hZCwge3RpbWVab25lfSlcbiAgY29uc3Qgd2Vic29ja2V0Q2xpZW50ID0gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnRcbiAgY29uc3QgdXJsID0gZnJvbnRlbmRNb2RlbEFwaVVybCgpXG4gIGNvbnN0IG1lcmdlZEhlYWRlcnMgPSBmcm9udGVuZE1vZGVsUmVxdWVzdEhlYWRlcnModGltZVpvbmUpXG5cbiAgcmV0dXJuIGF3YWl0IHJ1bldpdGhUcmFuc3BvcnREZWFkbGluZShcbiAgICB7XG4gICAgICBlcnJvck1lc3NhZ2U6IFwiU2hhcmVkIGZyb250ZW5kIG1vZGVsIEFQSSByZXF1ZXN0IHRpbWVkIG91dFwiLFxuICAgICAgc2lnbmFsOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0U2lnbmFsKCksXG4gICAgICB0aW1lb3V0TXM6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lb3V0TXMoKVxuICAgIH0sXG4gICAgYXN5bmMgKHNpZ25hbCkgPT4ge1xuICAgICAgaWYgKHdlYnNvY2tldENsaWVudCkge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHdlYnNvY2tldENsaWVudC5wb3N0KGZyb250ZW5kTW9kZWxUcmFuc3BvcnRQYXRoKHVybCksIHNlcmlhbGl6ZWRSZXF1ZXN0UGF5bG9hZCwge1xuICAgICAgICAgIGhlYWRlcnM6IG1lcmdlZEhlYWRlcnMsXG4gICAgICAgICAgc2lnbmFsXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlSnNvbiA9IHJlc3BvbnNlLmpzb24oKVxuXG4gICAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHJlc3BvbnNlSnNvbikpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHNlcmlhbGl6ZWRSZXF1ZXN0UGF5bG9hZCksXG4gICAgICAgIGNyZWRlbnRpYWxzOiBcImluY2x1ZGVcIixcbiAgICAgICAgaGVhZGVyczogbWVyZ2VkSGVhZGVycyxcbiAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgc2lnbmFsXG4gICAgICB9KVxuXG4gICAgICBjb25zdCByZXNwb25zZVRleHQgPSBhd2FpdCByZXNwb25zZS50ZXh0KClcblxuICAgICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgICB0aHJvd0Zyb250ZW5kTW9kZWxIdHRwRXJyb3Ioe1xuICAgICAgICAgIGNvbW1hbmRMYWJlbDogXCJzaGFyZWQgZnJvbnRlbmQgbW9kZWwgQVBJXCIsXG4gICAgICAgICAgcmVzcG9uc2UsXG4gICAgICAgICAgcmVzcG9uc2VUZXh0XG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGpzb24gPSByZXNwb25zZVRleHQubGVuZ3RoID4gMCA/IEpTT04ucGFyc2UocmVzcG9uc2VUZXh0KSA6IHt9XG5cbiAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGpzb24pKVxuICAgIH1cbiAgKVxufVxuXG4vKipcbiAqIFRocm93cyBhIGZyb250ZW5kLW1vZGVsIEhUVFAgZXJyb3Igd2l0aCBiYWNrZW5kLXByb3ZpZGVkIGVudmVsb3BlIGRldGFpbHMgd2hlbiBhdmFpbGFibGUuXG4gKiBAcGFyYW0ge3tjb21tYW5kTGFiZWw6IHN0cmluZywgcmVzcG9uc2U6IFJlc3BvbnNlLCByZXNwb25zZVRleHQ6IHN0cmluZ319IGFyZ3MgLSBFcnJvciByZXNwb25zZSBkZXRhaWxzLlxuICogQHJldHVybnMge25ldmVyfSAtIEFsd2F5cyB0aHJvd3MgYW4gdW5rbm93bi1hdHRyaWJ1dGUgZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIHRocm93RnJvbnRlbmRNb2RlbEh0dHBFcnJvcih7Y29tbWFuZExhYmVsLCByZXNwb25zZSwgcmVzcG9uc2VUZXh0fSkge1xuICAvLyBTdXJmYWNlIHRoZSBiYWNrZW5kJ3MgZnJpZW5kbHkgZXJyb3JNZXNzYWdlIGVudmVsb3BlICh0aGVcbiAgLy8gYHtzdGF0dXM6IFwiZXJyb3JcIiwgZXJyb3JNZXNzYWdlOiBcIi4uLlwifWAgc2hhcGUgZXZlcnkgY29udHJvbGxlclxuICAvLyBzaGlwcyBvbiBpdHMgNHh4LzV4eCByZXNwb25zZXMpIGluc3RlYWQgb2YgdGhlIGdlbmVyaWMgc3RhdHVzXG4gIC8vIHN0cmluZy4gRmFsbCB0aHJvdWdoIHRvIHRoZSBzdGF0dXMtb25seSBtZXNzYWdlIHdoZW4gdGhlIGJvZHkgaXNcbiAgLy8gbWlzc2luZywgbm9uLUpTT04sIG9yIGhhcyBubyB1c2FibGUgZXJyb3JNZXNzYWdlIGZpZWxkLlxuICBjb25zdCByZXNwb25zZUNvbnRlbnRUeXBlID0gcmVzcG9uc2UuaGVhZGVycy5nZXQoXCJjb250ZW50LXR5cGVcIilcblxuICBpZiAocmVzcG9uc2VDb250ZW50VHlwZSAmJiByZXNwb25zZUNvbnRlbnRUeXBlLmluY2x1ZGVzKFwiYXBwbGljYXRpb24vanNvblwiKSAmJiByZXNwb25zZVRleHQubGVuZ3RoID4gMCkge1xuICAgIC8qKlxuICAgICAqIERlZmluZXMgZXJyb3JCb2R5LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSAqL1xuICAgIGxldCBlcnJvckJvZHlcblxuICAgIHRyeSB7XG4gICAgICBlcnJvckJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlVGV4dClcbiAgICB9IGNhdGNoIHtcbiAgICAgIGVycm9yQm9keSA9IG51bGxcbiAgICB9XG5cbiAgICBpZiAoZXJyb3JCb2R5ICYmIHR5cGVvZiBlcnJvckJvZHkuZXJyb3JNZXNzYWdlID09PSBcInN0cmluZ1wiICYmIGVycm9yQm9keS5lcnJvck1lc3NhZ2UudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvckJvZHkuZXJyb3JNZXNzYWdlLnRyaW0oKSlcbiAgICB9XG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoYFJlcXVlc3QgZmFpbGVkICgke3Jlc3BvbnNlLnN0YXR1c30pIGZvciAke2NvbW1hbmRMYWJlbH1gKVxufVxuXG4vKipcbiAqIFJ1bnMgZmx1c2ggcGVuZGluZyBzaGFyZWQgZnJvbnRlbmQgbW9kZWwgcmVxdWVzdHMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBwZW5kaW5nIHNoYXJlZCBmcm9udGVuZC1tb2RlbCByZXF1ZXN0cyBmbHVzaC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZmx1c2hQZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzKCkge1xuICBzaGFyZWRGcm9udGVuZE1vZGVsRmx1c2hTY2hlZHVsZWQgPSBmYWxzZVxuXG4gIGlmIChwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzLmxlbmd0aCA8IDEpIHtcbiAgICByZXNvbHZlRnJvbnRlbmRNb2RlbElkbGVXYWl0ZXJzKClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IGJhdGNoZWRSZXF1ZXN0cyA9IHBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHNcbiAgcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cyA9IFtdXG5cbiAgY29uc3QgdXJsID0gZnJvbnRlbmRNb2RlbEFwaVVybCgpXG4gIGNvbnN0IHJlcXVlc3RQYXlsb2FkID0ge1xuICAgIHJlcXVlc3RzOiBiYXRjaGVkUmVxdWVzdHMubWFwKChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAocmVxdWVzdC5jdXN0b21QYXRoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29tbWFuZFR5cGU6IHJlcXVlc3QuY29tbWFuZFR5cGUsXG4gICAgICAgICAgY3VzdG9tUGF0aDogcmVxdWVzdC5jdXN0b21QYXRoLFxuICAgICAgICAgIG1vZGVsOiByZXF1ZXN0Lm1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgICAgcGF5bG9hZDogcmVxdWVzdC5wYXlsb2FkLFxuICAgICAgICAgIC4uLihPYmplY3Qua2V5cyhyZXF1ZXN0LnJlcXVlc3RDb250ZXh0KS5sZW5ndGggPiAwID8ge3JlcXVlc3RDb250ZXh0OiByZXF1ZXN0LnJlcXVlc3RDb250ZXh0fSA6IHt9KSxcbiAgICAgICAgICByZXF1ZXN0SWQ6IHJlcXVlc3QucmVxdWVzdElkXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29tbWFuZFR5cGU6IHJlcXVlc3QuY29tbWFuZFR5cGUsXG4gICAgICAgIG1vZGVsOiByZXF1ZXN0Lm1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgIHBheWxvYWQ6IHJlcXVlc3QucGF5bG9hZCxcbiAgICAgICAgLi4uKE9iamVjdC5rZXlzKHJlcXVlc3QucmVxdWVzdENvbnRleHQpLmxlbmd0aCA+IDAgPyB7cmVxdWVzdENvbnRleHQ6IHJlcXVlc3QucmVxdWVzdENvbnRleHR9IDoge30pLFxuICAgICAgICByZXF1ZXN0SWQ6IHJlcXVlc3QucmVxdWVzdElkXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIGF3YWl0IHRyYWNrRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3QoYXN5bmMgKCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICB2b2lkIHVybFxuICAgICAgY29uc3QgZGVjb2RlZFJlc3BvbnNlID0gYXdhaXQgcGVyZm9ybVNoYXJlZEZyb250ZW5kTW9kZWxBcGlSZXF1ZXN0KHJlcXVlc3RQYXlsb2FkKVxuICAgICAgY29uc3QgcmVzcG9uc2VzID0gQXJyYXkuaXNBcnJheShkZWNvZGVkUmVzcG9uc2UucmVzcG9uc2VzKSA/IGRlY29kZWRSZXNwb25zZS5yZXNwb25zZXMgOiBbXVxuICAgICAgY29uc3QgcmVzcG9uc2VzQnlJZCA9IG5ldyBNYXAocmVzcG9uc2VzLm1hcCgoZW50cnkpID0+IFtlbnRyeS5yZXF1ZXN0SWQsIGVudHJ5LnJlc3BvbnNlXSkpXG5cbiAgICAgIGZvciAoY29uc3QgcmVxdWVzdCBvZiBiYXRjaGVkUmVxdWVzdHMpIHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2VQYXlsb2FkID0gcmVzcG9uc2VzQnlJZC5nZXQocmVxdWVzdC5yZXF1ZXN0SWQpXG5cbiAgICAgICAgaWYgKCFyZXNwb25zZVBheWxvYWQgfHwgdHlwZW9mIHJlc3BvbnNlUGF5bG9hZCAhPT0gXCJvYmplY3RcIikge1xuICAgICAgICAgIHJlcXVlc3QucmVqZWN0KG5ldyBFcnJvcihgTWlzc2luZyBiYXRjaGVkIHJlc3BvbnNlIGZvciAke3JlcXVlc3QubW9kZWxDbGFzcy5uYW1lfSMke3JlcXVlc3QuY29tbWFuZFR5cGV9YCkpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIHJlcXVlc3QucmVzb2x2ZSgvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJlc3BvbnNlUGF5bG9hZCkpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGZvciAoY29uc3QgcmVxdWVzdCBvZiBiYXRjaGVkUmVxdWVzdHMpIHtcbiAgICAgICAgcmVxdWVzdC5yZWplY3QoZXJyb3IpXG4gICAgICB9XG4gICAgfVxuICB9KVxufVxuXG4vKipcbiAqIFJ1bnMgc2NoZWR1bGUgc2hhcmVkIGZyb250ZW5kIG1vZGVsIHJlcXVlc3QgZmx1c2guXG4gKiBAcmV0dXJucyB7dm9pZH0gKi9cbmZ1bmN0aW9uIHNjaGVkdWxlU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RGbHVzaCgpIHtcbiAgaWYgKHNoYXJlZEZyb250ZW5kTW9kZWxGbHVzaFNjaGVkdWxlZCkgcmV0dXJuXG5cbiAgc2hhcmVkRnJvbnRlbmRNb2RlbEZsdXNoU2NoZWR1bGVkID0gdHJ1ZVxuICBxdWV1ZU1pY3JvdGFzaygoKSA9PiB7XG4gICAgdm9pZCBmbHVzaFBlbmRpbmdTaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdHMoKVxuICB9KVxufVxuXG4vKipcbiAqIEN1c3RvbSBjb21tYW5kcyBzdGlsbCB1c2UgdGhlIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkuIFRoaXMgaGVscGVyIG9ubHkgYnVpbGRzIHRoZSBiYWNrZW5kIHJvdXRlIHBhdGggdGhlIHNlcnZlciBzaG91bGQgZGlzcGF0Y2ggYWZ0ZXIgdmFsaWRhdGluZyB0aGUgc2VnbWVudHMuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbW1hbmROYW1lIC0gQ29tbWFuZCBwYXRoIHNlZ21lbnQuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tb2RlbE5hbWUgLSBGcm9udGVuZCBtb2RlbCBjbGFzcyBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBbYXJncy5tZW1iZXJJZF0gLSBPcHRpb25hbCBtZW1iZXIgaWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXNvdXJjZVBhdGggLSBSZXNvdXJjZSBwYXRoIHByZWZpeC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQ3VzdG9tIGJhY2tlbmQgcm91dGUgcGF0aC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRQYXRoKHtjb21tYW5kTmFtZSwgbWVtYmVySWQsIG1vZGVsTmFtZSwgcmVzb3VyY2VQYXRofSkge1xuICBjb25zdCB2YWxpZGF0ZWRSZXNvdXJjZVBhdGggPSB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgoe21vZGVsTmFtZSwgcmVzb3VyY2VQYXRofSlcbiAgY29uc3QgdmFsaWRhdGVkQ29tbWFuZE5hbWUgPSB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbW1hbmROYW1lKHtjb21tYW5kTmFtZSwgY29tbWFuZFR5cGU6IGNvbW1hbmROYW1lLCBtb2RlbE5hbWV9KVxuXG4gIGlmIChtZW1iZXJJZCA9PT0gdW5kZWZpbmVkIHx8IG1lbWJlcklkID09PSBudWxsIHx8IG1lbWJlcklkID09PSBcIlwiKSB7XG4gICAgcmV0dXJuIGAke3ZhbGlkYXRlZFJlc291cmNlUGF0aH0vJHt2YWxpZGF0ZWRDb21tYW5kTmFtZX1gXG4gIH1cblxuICByZXR1cm4gYCR7dmFsaWRhdGVkUmVzb3VyY2VQYXRofS8ke2VuY29kZVVSSUNvbXBvbmVudChTdHJpbmcobWVtYmVySWQpKX0vJHt2YWxpZGF0ZWRDb21tYW5kTmFtZX1gXG59XG5cbi8qKlxuICogUnVucyBhc3NlcnQgZmluZCBieSBjb25kaXRpb25zIHNoYXBlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gY29uZGl0aW9ucyAtIGZpbmRCeSBjb25kaXRpb25zLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydEZpbmRCeUNvbmRpdGlvbnNTaGFwZShjb25kaXRpb25zKSB7XG4gIGlmICghY29uZGl0aW9ucyB8fCB0eXBlb2YgY29uZGl0aW9ucyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNvbmRpdGlvbnMpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZXhwZWN0cyBjb25kaXRpb25zIHRvIGJlIGEgcGxhaW4gb2JqZWN0LCBnb3Q6ICR7Y29uZGl0aW9uc31gKVxuICB9XG5cbiAgY29uc3QgY29uZGl0aW9uc1Byb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihjb25kaXRpb25zKVxuXG4gIGlmIChjb25kaXRpb25zUHJvdG90eXBlICE9PSBPYmplY3QucHJvdG90eXBlICYmIGNvbmRpdGlvbnNQcm90b3R5cGUgIT09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBleHBlY3RzIGNvbmRpdGlvbnMgdG8gYmUgYSBwbGFpbiBvYmplY3QsIGdvdDogJHtjb25kaXRpb25zfWApXG4gIH1cblxuICBjb25zdCBzeW1ib2xLZXlzID0gT2JqZWN0LmdldE93blByb3BlcnR5U3ltYm9scyhjb25kaXRpb25zKVxuXG4gIGlmIChzeW1ib2xLZXlzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IHN5bWJvbCBjb25kaXRpb24ga2V5cyAoa2V5czogJHtzeW1ib2xLZXlzLm1hcCgoa2V5KSA9PiBrZXkudG9TdHJpbmcoKSkuam9pbihcIiwgXCIpfSlgKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBhc3NlcnQgZGVmaW5lZCBmaW5kIGJ5IGNvbmRpdGlvbiB2YWx1ZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ29uZGl0aW9uIHZhbHVlIHRvIHZhbGlkYXRlLlxuICogQHBhcmFtIHtzdHJpbmd9IGtleVBhdGggLSBLZXkgcGF0aCBmb3IgZXJyb3Igb3V0cHV0LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydERlZmluZWRGaW5kQnlDb25kaXRpb25WYWx1ZSh2YWx1ZSwga2V5UGF0aCkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgdW5kZWZpbmVkIGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBmaW5kQnkgZG9lcyBub3Qgc3VwcG9ydCBmdW5jdGlvbiBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3ltYm9sXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IHN5bWJvbCBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwiYmlnaW50XCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IGJpZ2ludCBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgfVxuXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgIU51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYGZpbmRCeSBkb2VzIG5vdCBzdXBwb3J0IG5vbi1maW5pdGUgbnVtYmVyIGNvbmRpdGlvbiB2YWx1ZXMgKGtleTogJHtrZXlQYXRofSlgKVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgdmFsdWUuZm9yRWFjaCgoZW50cnksIGluZGV4KSA9PiB7XG4gICAgICBhc3NlcnREZWZpbmVkRmluZEJ5Q29uZGl0aW9uVmFsdWUoZW50cnksIGAke2tleVBhdGh9WyR7aW5kZXh9XWApXG4gICAgfSlcbiAgICByZXR1cm5cbiAgfVxuXG4gIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIpIHtcbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBvYmplY3RWYWx1ZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodmFsdWUpXG4gICAgY29uc3QgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKG9iamVjdFZhbHVlKVxuXG4gICAgaWYgKHByb3RvdHlwZSAhPT0gT2JqZWN0LnByb3RvdHlwZSAmJiBwcm90b3R5cGUgIT09IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgbm9uLXBsYWluIG9iamVjdCBjb25kaXRpb24gdmFsdWVzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgICB9XG5cbiAgICBjb25zdCBzeW1ib2xLZXlzID0gT2JqZWN0LmdldE93blByb3BlcnR5U3ltYm9scyhvYmplY3RWYWx1ZSlcblxuICAgIGlmIChzeW1ib2xLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgZmluZEJ5IGRvZXMgbm90IHN1cHBvcnQgc3ltYm9sIGNvbmRpdGlvbiBrZXlzIChrZXk6ICR7a2V5UGF0aH0pYClcbiAgICB9XG5cbiAgICBjb25zdCB2YWx1ZU9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodmFsdWUpXG5cbiAgICBPYmplY3Qua2V5cyh2YWx1ZU9iamVjdCkuZm9yRWFjaCgobmVzdGVkS2V5KSA9PiB7XG4gICAgICBhc3NlcnREZWZpbmVkRmluZEJ5Q29uZGl0aW9uVmFsdWUodmFsdWVPYmplY3RbbmVzdGVkS2V5XSwgYCR7a2V5UGF0aH0uJHtuZXN0ZWRLZXl9YClcbiAgICB9KVxuICB9XG59XG5cbi8qKlxuICogQmFzZSBmcm9udGVuZCBtb2RlbC5cbiAqXG4gKiBEZWZhdWx0cyBhcmUgYGFueWAgc28gdGhlIGJhcmUgYEZyb250ZW5kTW9kZWxCYXNlYCDigJQgdXNlZCB0aHJvdWdob3V0IGFzIGFcbiAqIGNvbnN0cmFpbnQvcGFyYW1ldGVyIHR5cGUgZm9yIFwiYW55IGZyb250ZW5kIG1vZGVsXCIg4oCUIGFjY2VwdHMgZ2VuZXJhdGVkXG4gKiBzdWJjbGFzc2VzIGRlY2xhcmluZyB0eXBlZC1hdHRyaWJ1dGUgZ2VuZXJpY3MgKGBGcm9udGVuZE1vZGVsQmFzZTxYQXR0cmlidXRlcyxcbiAqIC4uLj5gKS4gQSBjb25jcmV0ZSBgUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPmAgZGVmYXVsdCBtYWtlc1xuICogdGhvc2Ugc3ViY2xhc3NlcyBmYWlsIGJ5IGludmFyaWFuY2UuIFN1YmNsYXNzZXMgc3RpbGwgcGFzcyB0aGVpciBwcmVjaXNlXG4gKiBhdHRyaWJ1dGUgdHlwZWRlZnMsIHNvIHR5cGVkIGFjY2Vzc29ycyBrZWVwIHRoZWlyIHByZWNpc2lvbi5cbiAqIEB0ZW1wbGF0ZSB7b2JqZWN0fSBbQXR0cmlidXRlcz1hbnldXG4gKiBAdGVtcGxhdGUge29iamVjdH0gW0NyZWF0ZUF0dHJpYnV0ZXM9YW55XVxuICogQHRlbXBsYXRlIHtvYmplY3R9IFtVcGRhdGVBdHRyaWJ1dGVzPWFueV1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRnJvbnRlbmRNb2RlbEJhc2Uge1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgbW9kZWxOYW1lXG5cbiAgLyoqXG4gICAqIEF1dG9sb2FkLlxuICAgKiBAdHlwZSB7Ym9vbGVhbn0gLSBHbG9iYWwgYXV0by1iYXRjaC1wcmVsb2FkIHRvZ2dsZS4gQXBwcyBjYW4gb3B0IG91dCB2aWEgRnJvbnRlbmRNb2RlbEJhc2Uuc2V0QXV0b2xvYWQoZmFsc2UpLlxuICAgKi9cbiAgc3RhdGljIF9hdXRvbG9hZCA9IHRydWVcblxuICAvKipcbiAgICogUnVucyBnZXQgYXV0b2xvYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGF1dG8tYmF0Y2gtcHJlbG9hZCBvZiByZWxhdGlvbnNoaXBzIG9uIGxhenkgYWNjZXNzIGlzIGVuYWJsZWQgZ2xvYmFsbHkuXG4gICAqL1xuICBzdGF0aWMgZ2V0QXV0b2xvYWQoKSB7IHJldHVybiBGcm9udGVuZE1vZGVsQmFzZS5fYXV0b2xvYWQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhdXRvbG9hZC5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdWYWx1ZSAtIFdoZXRoZXIgYXV0by1iYXRjaC1wcmVsb2FkIG9mIHJlbGF0aW9uc2hpcHMgaXMgZW5hYmxlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgc2V0QXV0b2xvYWQobmV3VmFsdWUpIHsgRnJvbnRlbmRNb2RlbEJhc2UuX2F1dG9sb2FkID0gbmV3VmFsdWUgfVxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqL1xuICBfYXR0cmlidXRlc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXA8RnJvbnRlbmRNb2RlbEJhc2UsIEZyb250ZW5kTW9kZWxCYXNlLCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+PiB8IEZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcDxGcm9udGVuZE1vZGVsQmFzZSwgRnJvbnRlbmRNb2RlbEJhc2UsIFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4+Pn0gKi9cbiAgX3JlbGF0aW9uc2hpcHNcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRhY2htZW50SGFuZGxlPn0gKi9cbiAgX2F0dGFjaG1lbnRzXG4gIC8qKlxuICAgKiBSYWlscy1zdHlsZSBuZXN0ZWQgYXR0cmlidXRlIHBheWxvYWRzIHF1ZXVlZCBmb3IgdGhlIG5leHQgc2F2ZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn1cbiAgICovXG4gIF9wZW5kaW5nTmVzdGVkQXR0cmlidXRlc1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7U2V0PHN0cmluZz4gfCBudWxsfSAqL1xuICBfc2VsZWN0ZWRBdHRyaWJ1dGVzXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtib29sZWFufSAqL1xuICBfaXNOZXdSZWNvcmRcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gIF9tYXJrZWRGb3JEZXN0cnVjdGlvblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi9cbiAgX3BlcnNpc3RlZEF0dHJpYnV0ZXNcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxCYXNlPiB8IHVuZGVmaW5lZH0gLSBTaGFyZWQgcmVmZXJlbmNlIHRvIHNpYmxpbmcgcmVjb3JkcyBsb2FkZWQgaW4gdGhlIHNhbWUgYmF0Y2guIFVzZWQgYnkgYXV0by1iYXRjaC1wcmVsb2FkLlxuICAgKi9cbiAgX2xvYWRDb2hvcnRcbiAgLyoqXG4gICAqIENhbm9uaWNhbCBiYWNraW5nLXJlY29yZCBhdHRhY2htZW50IG93bmVyIHJldHVybmVkIGJ5IHRoZSBzZXJ2ZXIuXG4gICAqIEB0eXBlIHt7cmVjb3JkSWQ6IHN0cmluZywgcmVjb3JkVHlwZTogc3RyaW5nfSB8IG51bGx9XG4gICAqL1xuICBfYXR0YWNobWVudE93bmVyXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7QXR0cmlidXRlcyB8IENyZWF0ZUF0dHJpYnV0ZXN9IFthdHRyaWJ1dGVzXSAtIEluaXRpYWwgYXR0cmlidXRlcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGF0dHJpYnV0ZXMpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG5cbiAgICBNb2RlbENsYXNzLmVuc3VyZUdlbmVyYXRlZEF0dGFjaG1lbnRNZXRob2RzKClcbiAgICB0aGlzLl9hdHRyaWJ1dGVzID0ge31cbiAgICB0aGlzLl9yZWxhdGlvbnNoaXBzID0ge31cbiAgICB0aGlzLl9hdHRhY2htZW50cyA9IHt9XG4gICAgdGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIHRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcyA9IG51bGxcbiAgICB0aGlzLl9pc05ld1JlY29yZCA9IHRydWVcbiAgICB0aGlzLl9tYXJrZWRGb3JEZXN0cnVjdGlvbiA9IGZhbHNlXG4gICAgdGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgdGhpcy5fYXR0YWNobWVudE93bmVyID0gbnVsbFxuICAgIGlmIChhdHRyaWJ1dGVzKSB0aGlzLmFzc2lnbkF0dHJpYnV0ZXMoYXR0cmlidXRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBnZW5lcmF0ZWQgYXR0YWNobWVudCBtZXRob2RzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBFbnN1cmVzIGF0dGFjaG1lbnQgaGVscGVyIG1ldGhvZHMgZXhpc3Qgb24gdGhlIHByb3RvdHlwZS5cbiAgICovXG4gIHN0YXRpYyBlbnN1cmVHZW5lcmF0ZWRBdHRhY2htZW50TWV0aG9kcygpIHtcbiAgICBpZiAodGhpcy5fZ2VuZXJhdGVkQXR0YWNobWVudE1ldGhvZHMpIHJldHVyblxuXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB0aGlzLmF0dGFjaG1lbnREZWZpbml0aW9ucygpXG4gICAgY29uc3QgcHJvdG90eXBlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0aGlzLnByb3RvdHlwZSlcblxuICAgIGZvciAoY29uc3QgYXR0YWNobWVudE5hbWUgb2YgT2JqZWN0LmtleXMoYXR0YWNobWVudHMpKSB7XG4gICAgICBpZiAoIShhdHRhY2htZW50TmFtZSBpbiBwcm90b3R5cGUpKSB7XG4gICAgICAgIHByb3RvdHlwZVthdHRhY2htZW50TmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fZ2VuZXJhdGVkQXR0YWNobWVudE1ldGhvZHMgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd9IC0gUmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJyZXNvdXJjZUNvbmZpZygpIG11c3QgYmUgaW1wbGVtZW50ZWQgYnkgc3ViY2xhc3Nlc1wiKVxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby11bnJlYWNoYWJsZVxuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIG1vZGVsIGNsYXNzZXMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQ2xhc3MgfCBzdHJpbmc+fSAtIFJlbGF0aW9uc2hpcCBtb2RlbCBjbGFzc2VzIChvciBjbGFzcyBuYW1lIHN0cmluZ3MpIGtleWVkIGJ5IHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIHJlbGF0aW9uc2hpcE1vZGVsQ2xhc3NlcygpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlciBhIGZyb250ZW5kIG1vZGVsIGNsYXNzIHNvIGl0IGNhbiBiZSByZXNvbHZlZCBieSBuYW1lIGluIHJlbGF0aW9uc2hpcCBsb29rdXBzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIHJlZ2lzdGVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyByZWdpc3Rlck1vZGVsKG1vZGVsQ2xhc3MpIHtcbiAgICByZWdpc3RlckZyb250ZW5kTW9kZWwobW9kZWxDbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlZmluZSBzY29wZS5cbiAgICogQHBhcmFtIHsoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gY2FsbGJhY2sgLSBTY29wZSBjYWxsYmFjay5cbiAgICogQHJldHVybnMgeygoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8RnJvbnRlbmRNb2RlbENsYXNzPikgJiB7c2NvcGU6ICguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCIpLk1vZGVsU2NvcGVEZXNjcmlwdG9yfX0gLSBTY29wZSBoZWxwZXIuXG4gICAqL1xuICBzdGF0aWMgZGVmaW5lU2NvcGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gZGVmaW5lTW9kZWxTY29wZSh7XG4gICAgICBjYWxsYmFjayxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICBzdGFydFF1ZXJ5OiAoKSA9PiB0aGlzLnF1ZXJ5KClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmUgYSByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MgdmFsdWUgdGhhdCBtYXkgYmUgYSBjbGFzcyByZWZlcmVuY2Ugb3IgYSBzdHJpbmcgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkfSB2YWx1ZSAtIENsYXNzIG9yIGNsYXNzIG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBudWxsfSAtIFJlc29sdmVkIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIHJlc29sdmVNb2RlbENsYXNzKHZhbHVlKSB7XG4gICAgcmV0dXJuIHJlc29sdmVGcm9udGVuZE1vZGVsQ2xhc3ModmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbnMuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB7dHlwZTogXCJiZWxvbmdzVG9cIiB8IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIiwgYXV0b2xvYWQ/OiBib29sZWFufT59IC0gUmVsYXRpb25zaGlwIGRlZmluaXRpb25zIGtleWVkIGJ5IHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIHJlbGF0aW9uc2hpcERlZmluaXRpb25zKCkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0YWNobWVudCBkZWZpbml0aW9ucy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRhY2htZW50RGVmaW5pdGlvbj59IC0gQXR0YWNobWVudCBkZWZpbml0aW9ucyBrZXllZCBieSBhdHRhY2htZW50IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgYXR0YWNobWVudERlZmluaXRpb25zKCkge1xuICAgIHJldHVybiB0aGlzLnJlc291cmNlQ29uZmlnKCkuYXR0YWNobWVudHMgfHwge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaG1lbnQgZGVmaW5pdGlvbi5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnREZWZpbml0aW9uIHwgbnVsbH0gLSBBdHRhY2htZW50IGRlZmluaXRpb24uXG4gICAqL1xuICBzdGF0aWMgYXR0YWNobWVudERlZmluaXRpb24oYXR0YWNobWVudE5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5hdHRhY2htZW50RGVmaW5pdGlvbnMoKVthdHRhY2htZW50TmFtZV0gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIGRlZmluaXRpb24uXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHt7dHlwZTogXCJiZWxvbmdzVG9cIiB8IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIiwgYXV0b2xvYWQ/OiBib29sZWFufSB8IG51bGx9IC0gUmVsYXRpb25zaGlwIGRlZmluaXRpb24uXG4gICAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgZGVmaW5pdGlvbnMgPSB0aGlzLnJlbGF0aW9uc2hpcERlZmluaXRpb25zKClcblxuICAgIHJldHVybiBkZWZpbml0aW9uc1tyZWxhdGlvbnNoaXBOYW1lXSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBSYWlscy1zdHlsZSBuZXN0ZWQgYXR0cmlidXRlcyBrZXkgdG8gYSBjb25maWd1cmVkIHJlbGF0aW9uc2hpcC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBDYW5kaWRhdGUgYXR0cmlidXRlIG5hbWUsIHN1Y2ggYXMgYHRhc2tzQXR0cmlidXRlc2AuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSBSZWxhdGlvbnNoaXAgbmFtZSB3aGVuIG5lc3RlZCBhdHRyaWJ1dGVzIGFyZSBjb25maWd1cmVkLlxuICAgKi9cbiAgc3RhdGljIG5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAoIWF0dHJpYnV0ZU5hbWUuZW5kc1dpdGgoXCJBdHRyaWJ1dGVzXCIpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZSA9IGF0dHJpYnV0ZU5hbWUuc2xpY2UoMCwgLVwiQXR0cmlidXRlc1wiLmxlbmd0aClcbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZygpLm5lc3RlZEF0dHJpYnV0ZXMgfHwge31cblxuICAgIHJldHVybiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobmVzdGVkQXR0cmlidXRlc0NvbmZpZywgcmVsYXRpb25zaGlwTmFtZSlcbiAgICAgID8gcmVsYXRpb25zaGlwTmFtZVxuICAgICAgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQ2xhc3MgfCBudWxsfSAtIFRhcmdldCByZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzID0gdGhpcy5yZWxhdGlvbnNoaXBNb2RlbENsYXNzZXMoKVxuICAgIGNvbnN0IHZhbHVlID0gcmVsYXRpb25zaGlwTW9kZWxDbGFzc2VzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICByZXR1cm4gRnJvbnRlbmRNb2RlbEJhc2UucmVzb2x2ZU1vZGVsQ2xhc3ModmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7QXR0cmlidXRlc30gLSBBdHRyaWJ1dGVzIGhhc2guXG4gICAqL1xuICBhdHRyaWJ1dGVzKCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0F0dHJpYnV0ZXN9ICovICh0aGlzLl9hdHRyaWJ1dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgbmV3IHJlY29yZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIG1vZGVsIGhhcyBub3QgeWV0IGJlZW4gcGVyc2lzdGVkLlxuICAgKi9cbiAgaXNOZXdSZWNvcmQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2lzTmV3UmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBwZXJzaXN0ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBtb2RlbCBoYXMgYmVlbiBwZXJzaXN0ZWQuXG4gICAqL1xuICBpc1BlcnNpc3RlZCgpIHtcbiAgICByZXR1cm4gIXRoaXMuaXNOZXdSZWNvcmQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGlzIG5ldyByZWNvcmQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbmV3SXNOZXdSZWNvcmQgLSBOZXcgcGVyc2lzdGVkLXN0YXRlIGZsYWcuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc2V0SXNOZXdSZWNvcmQobmV3SXNOZXdSZWNvcmQpIHtcbiAgICB0aGlzLl9pc05ld1JlY29yZCA9IG5ld0lzTmV3UmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogTWFya3MgdGhpcyByZWNvcmQgZm9yIGRlc3RydWN0aW9uIHdoZW4gaXRzIHBhcmVudCBpcyBuZXh0IHNhdmVkIHRocm91Z2hcbiAgICogbmVzdGVkLWF0dHJpYnV0ZSBzdXBwb3J0LiBUaGUgcmVjb3JkIGlzIG5vdCByZW1vdmVkIGZyb20gdGhlIHBhcmVudCdzXG4gICAqIHJlbGF0aW9uc2hpcCBjb2xsZWN0aW9uIHVudGlsIHRoZSBzZXJ2ZXIgY29uZmlybXMgdGhlIGRlbGV0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgbWFya0ZvckRlc3RydWN0aW9uKCkge1xuICAgIHRoaXMuX21hcmtlZEZvckRlc3RydWN0aW9uID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFya2VkIGZvciBkZXN0cnVjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIHJlY29yZCBpcyBxdWV1ZWQgZm9yIG5lc3RlZCBkZXN0cnVjdGlvbiBvbiBuZXh0IHBhcmVudCBzYXZlLlxuICAgKi9cbiAgbWFya2VkRm9yRGVzdHJ1Y3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX21hcmtlZEZvckRlc3RydWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjaGFuZ2VzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBDaGFuZ2VkIGF0dHJpYnV0ZXMgYXMgYFtvbGRWYWx1ZSwgbmV3VmFsdWVdYC5cbiAgICovXG4gIGNoYW5nZXMoKSB7XG4gICAgLyoqXG4gICAgICogQ2hhbmdlZCBhdHRyaWJ1dGVzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IGNoYW5nZWRBdHRyaWJ1dGVzID0ge31cbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IG5ldyBTZXQoW1xuICAgICAgLi4uT2JqZWN0LmtleXModGhpcy5fcGVyc2lzdGVkQXR0cmlidXRlcyksXG4gICAgICAuLi5PYmplY3Qua2V5cyh0aGlzLl9hdHRyaWJ1dGVzKVxuICAgIF0pXG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgYXR0cmlidXRlTmFtZXMpIHtcbiAgICAgIGNvbnN0IHByZXZpb3VzVmFsdWUgPSB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG4gICAgICBjb25zdCBjdXJyZW50VmFsdWUgPSB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICAgIGlmIChKU09OLnN0cmluZ2lmeShzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocHJldmlvdXNWYWx1ZSkpICE9PSBKU09OLnN0cmluZ2lmeShzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoY3VycmVudFZhbHVlKSkpIHtcbiAgICAgICAgY2hhbmdlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBbcHJldmlvdXNWYWx1ZSwgY3VycmVudFZhbHVlXVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjaGFuZ2VkQXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgY2hhbmdlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbnkgdHJhY2tlZCBhdHRyaWJ1dGUgaGFzIGNoYW5nZWQuXG4gICAqL1xuICBpc0NoYW5nZWQoKSB7XG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMuY2hhbmdlcygpKS5sZW5ndGggPiAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVsYXRpb25zaGlwIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwfSAtIFJlbGF0aW9uc2hpcCBzdGF0ZSBvYmplY3QuXG4gICAqL1xuICBnZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGlmICghdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXSkge1xuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwRGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwRGVmaW5pdGlvbiAmJiByZWxhdGlvbnNoaXBUeXBlSXNDb2xsZWN0aW9uKHJlbGF0aW9uc2hpcERlZmluaXRpb24udHlwZSkpIHtcbiAgICAgICAgdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXSA9IG5ldyBGcm9udGVuZE1vZGVsSGFzTWFueVJlbGF0aW9uc2hpcCh0aGlzLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXSA9IG5ldyBGcm9udGVuZE1vZGVsU2luZ3VsYXJSZWxhdGlvbnNoaXAodGhpcywgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzcylcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF0dGFjaG1lbnQgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGV9IC0gQXR0YWNobWVudCBoZWxwZXIuXG4gICAqL1xuICBnZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbihhdHRhY2htZW50TmFtZSlcblxuICAgIGlmICghYXR0YWNobWVudERlZmluaXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBhdHRhY2htZW50OiAke01vZGVsQ2xhc3MubmFtZX0jJHthdHRhY2htZW50TmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdKSB7XG4gICAgICB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0gPSBuZXcgRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRIYW5kbGUoe1xuICAgICAgICBhdHRhY2htZW50TmFtZSxcbiAgICAgICAgbW9kZWw6IHRoaXNcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxCYXNlIHwgQXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIGxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBpZCA9IHRoaXMucHJpbWFyeUtleVZhbHVlKClcbiAgICBjb25zdCByZWxvYWRlZE1vZGVsID0gYXdhaXQgTW9kZWxDbGFzc1xuICAgICAgLnByZWxvYWQoW3JlbGF0aW9uc2hpcE5hbWVdKVxuICAgICAgLmZpbmQoaWQpXG4gICAgY29uc3Qgc291cmNlUmVsYXRpb25zaGlwID0gcmVsb2FkZWRNb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICBjb25zdCB0YXJnZXRSZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgY29weUxvYWRlZFJlbGF0aW9uc2hpcFZhbHVlKHtzb3VyY2VSZWxhdGlvbnNoaXAsIHRhcmdldFJlbGF0aW9uc2hpcH0pXG5cbiAgICByZXR1cm4gdGFyZ2V0UmVsYXRpb25zaGlwLmxvYWRlZCgpXG4gIH1cblxuICAvKipcbiAgICogUHJlbG9hZHMgcmVsYXRpb25zaGlwKHMpIG9udG8gdGhpcyBhbHJlYWR5LWxvYWRlZCByZWNvcmQuIEFjY2VwdHMgZWl0aGVyIGFcbiAgICogcXVlcnkgYnVpbHQgdmlhIGBNb2RlbC5wcmVsb2FkKC4uLikuc2VsZWN0KC4uLilgIG9yIGEgcmF3IHByZWxvYWQgc3BlY1xuICAgKiAoc3RyaW5nIC8gYXJyYXkgLyBuZXN0ZWQgb2JqZWN0KS4gUmVsYXRpb25zaGlwcyBhbHJlYWR5IHByZWxvYWRlZCB3aXRoIHRoZVxuICAgKiByZXF1aXJlZCBjb2x1bW5zIHByZXNlbnQgYXJlIGxlZnQgdW50b3VjaGVkIHVubGVzcyBgZm9yY2VgIGlzIHNldC4gQ2Fycmllc1xuICAgKiB0aGUgcXVlcnkncyBwcmVsb2FkIGdyYXBoLCBzZWxlY3QsIHNlbGVjdHNFeHRyYSwgd2l0aENvdW50LCBhYmlsaXRpZXMsIGFuZFxuICAgKiBxdWVyeURhdGEgd2hlbiByZS1mZXRjaGluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8RnJvbnRlbmRNb2RlbENsYXNzPiB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBzdHJpbmcgfCBBcnJheTxzdHJpbmcgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkPn0gcXVlcnlPclNwZWMgLSBQcmVsb2FkIHNvdXJjZS5cbiAgICogQHBhcmFtIHt7Zm9yY2U/OiBib29sZWFufX0gW29wdGlvbnNdIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwcmVsb2FkaW5nIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIHByZWxvYWQocXVlcnlPclNwZWMsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IEZyb250ZW5kTW9kZWxQcmVsb2FkZXIucHJlbG9hZChbdGhpc10sIHF1ZXJ5T3JTcGVjLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIG9yIGxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEZyb250ZW5kTW9kZWxCYXNlIHwgQXJyYXk8RnJvbnRlbmRNb2RlbEJhc2U+IHwgbnVsbD59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIHJlbGF0aW9uc2hpcE9yTG9hZChyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIHtcbiAgICAgIHJldHVybiByZWxhdGlvbnNoaXAubG9hZGVkKClcbiAgICB9XG5cbiAgICBjb25zdCBiYXRjaGVkID0gYXdhaXQgdGhpcy5fdHJ5Q29ob3J0UHJlbG9hZChyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKGJhdGNoZWQpIHJldHVybiByZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRlbXB0cyB0byBiYXRjaC1sb2FkIGByZWxhdGlvbnNoaXBOYW1lYCBhY3Jvc3MgY29ob3J0IHNpYmxpbmdzIHZpYSBhXG4gICAqIHNpbmdsZSBgcHJlbG9hZChbbmFtZV0pLndoZXJlKHtwazogW2lkc119KS50b0FycmF5KClgIHJlcXVlc3QsIHRoZW4gY29waWVzXG4gICAqIHRoZSBwcmVsb2FkZWQgcmVsYXRpb25zaGlwIHN0YXRlIG9udG8gZWFjaCBzaWJsaW5nLiBSZXR1cm5zIHRydWUgd2hlbiBhXG4gICAqIGJhdGNoIHJhbiwgZmFsc2Ugd2hlbiBhdXRvbG9hZCBpcyBvZmYsIHRoZXJlIGlzIG5vIGNvaG9ydCwgb3Igbm8gYmF0Y2hcbiAgICogY2FuZGlkYXRlcyByZW1haW4uIFNpYmxpbmdzIHdob3NlIHJlbGF0aW9uc2hpcCBzdGF0ZSBpcyBhbHJlYWR5IHNldFxuICAgKiAocHJlbG9hZGVkIG9yIGxvY2FsbHkgbWFuaXB1bGF0ZWQgdmlhIGBidWlsZGAgLyBgc2V0UmVsYXRpb25zaGlwYCkgYXJlXG4gICAqIHNraXBwZWQgc28gdGhlaXIgY2FjaGVkL2VkaXRlZCB2YWx1ZSBpcyBwcmVzZXJ2ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYSBjb2hvcnQgYmF0Y2ggcHJlbG9hZCByYW4uXG4gICAqL1xuICBhc3luYyBfdHJ5Q29ob3J0UHJlbG9hZChyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgaWYgKCFGcm9udGVuZE1vZGVsQmFzZS5nZXRBdXRvbG9hZCgpKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBjb2hvcnQgPSB0aGlzLl9sb2FkQ29ob3J0XG5cbiAgICBpZiAoIWNvaG9ydCB8fCBjb2hvcnQubGVuZ3RoIDw9IDEpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgZGVmaW5pdGlvbiA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwRGVmaW5pdGlvbihyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKCFkZWZpbml0aW9uKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoZGVmaW5pdGlvbi5hdXRvbG9hZCA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuXG4gICAgLyoqXG4gICAgICogQmF0Y2guXG4gICAgICogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxCYXNlPn0gKi9cbiAgICBjb25zdCBiYXRjaCA9IFtdXG5cbiAgICAvLyBFeGFjdCBzYW1lIGNsYXNzLCBwZXJzaXN0ZWQsIG5vIGV4aXN0aW5nIGluLW1lbW9yeSByZWxhdGlvbnNoaXAgc3RhdGUuXG4gICAgLy8gYHNldExvYWRlZGAgc2V0cyBgX3ByZWxvYWRlZCA9IHRydWVgIG9uIGV2ZXJ5IG11dGF0aW9uIHBhdGggKHByZWxvYWQsXG4gICAgLy8gc2V0UmVsYXRpb25zaGlwLCBidWlsZCwgYWRkVG9Mb2FkZWQpLCBzbyBgZ2V0UHJlbG9hZGVkKClgIGFsb25lIGlzIGFcbiAgICAvLyByZWxpYWJsZSBcImFscmVhZHkgdG91Y2hlZFwiIHNpZ25hbCBvbiB0aGUgZnJvbnRlbmQuXG4gICAgZm9yIChjb25zdCBzaWJsaW5nIG9mIGNvaG9ydCkge1xuICAgICAgaWYgKHNpYmxpbmcuY29uc3RydWN0b3IgIT09IE1vZGVsQ2xhc3MpIGNvbnRpbnVlXG4gICAgICBpZiAoc2libGluZy5pc05ld1JlY29yZCgpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBzaWJsaW5nUmVsYXRpb25zaGlwID0gc2libGluZy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgICAgaWYgKHNpYmxpbmdSZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIGNvbnRpbnVlXG5cbiAgICAgIGJhdGNoLnB1c2goc2libGluZylcbiAgICB9XG5cbiAgICBpZiAoYmF0Y2gubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgYmF0Y2hJZHMgPSBiYXRjaC5tYXAoKHNpYmxpbmcpID0+IHNpYmxpbmcucHJpbWFyeUtleVZhbHVlKCkpXG4gICAgY29uc3QgcmVsb2FkZWRCYXRjaCA9IGF3YWl0IE1vZGVsQ2xhc3NcbiAgICAgIC5wcmVsb2FkKFtyZWxhdGlvbnNoaXBOYW1lXSlcbiAgICAgIC53aGVyZSh7W3ByaW1hcnlLZXldOiBiYXRjaElkc30pXG4gICAgICAudG9BcnJheSgpXG5cbiAgICAvKipcbiAgICAgKiBSZWxvYWRlZCBieSBpZC5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgRnJvbnRlbmRNb2RlbEJhc2U+fSAqL1xuICAgIGNvbnN0IHJlbG9hZGVkQnlJZCA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCByZWxvYWRlZCBvZiByZWxvYWRlZEJhdGNoKSB7XG4gICAgICByZWxvYWRlZEJ5SWQuc2V0KG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHJlbG9hZGVkLnByaW1hcnlLZXlWYWx1ZSgpKSwgcmVsb2FkZWQpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzaWJsaW5nIG9mIGJhdGNoKSB7XG4gICAgICBjb25zdCBrZXkgPSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBzaWJsaW5nLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgICAgY29uc3QgcmVsb2FkZWQgPSByZWxvYWRlZEJ5SWQuZ2V0KGtleSlcblxuICAgICAgaWYgKCFyZWxvYWRlZCkgY29udGludWVcblxuICAgICAgY29weUxvYWRlZFJlbGF0aW9uc2hpcFZhbHVlKHtcbiAgICAgICAgc291cmNlUmVsYXRpb25zaGlwOiByZWxvYWRlZC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSksXG4gICAgICAgIHRhcmdldFJlbGF0aW9uc2hpcDogc2libGluZy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgLy8gSWYgdGhlIGNhbGxlciBpdHNlbGYgd2FzIG5vdCBwb3B1bGF0ZWQgKHJlY29yZCBkZWxldGVkL2ZpbHRlcmVkIGJldHdlZW5cbiAgICAvLyB0aGUgbGlzdCBmZXRjaCBhbmQgdGhpcyBwcmVsb2FkIHJlcXVlc3QpLCBmYWxsIGJhY2sgdG8gcGVyLXJlY29yZCBsb2FkXG4gICAgLy8gc28gdGhlIGNhbGxlciBnZXRzIGEgcmVhbCBub3QtZm91bmQgZXJyb3IgaW5zdGVhZCBvZiBhIG1pc2xlYWRpbmdcbiAgICAvLyBcImhhc24ndCBiZWVuIHByZWxvYWRlZFwiIHRocm93IGZyb20gbG9hZGVkKCkuXG4gICAgaWYgKCF0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKS5nZXRQcmVsb2FkZWQoKSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZSB8IG51bGwgfCB1bmRlZmluZWR9IHJlbGF0aW9uc2hpcFZhbHVlIC0gUmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEJhc2UgfCBudWxsIHwgdW5kZWZpbmVkfSAtIEFzc2lnbmVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIHNldFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBWYWx1ZSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCByZWxhdGlvbnNoaXBEZWZpbml0aW9uID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcERlZmluaXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biByZWxhdGlvbnNoaXA6ICR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBzZXQgaGFzLW1hbnkgcmVsYXRpb25zaGlwIHdpdGggc2V0UmVsYXRpb25zaGlwKCk6ICR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICByZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHJlbGF0aW9uc2hpcFZhbHVlKVxuXG4gICAgcmV0dXJuIHJlbGF0aW9uc2hpcFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhc3NpZ24gYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtBdHRyaWJ1dGVzIHwgQ3JlYXRlQXR0cmlidXRlcyB8IFVwZGF0ZUF0dHJpYnV0ZXMgfCBSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSBhdHRyaWJ1dGVzIC0gQXR0cmlidXRlcyB0byBhc3NpZ24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFzc2lnbkF0dHJpYnV0ZXMoYXR0cmlidXRlcykge1xuICAgIGNvbnN0IGF0dHJpYnV0ZVZhbHVlcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKGF0dHJpYnV0ZXMpXG5cbiAgICBmb3IgKGNvbnN0IGtleSBpbiBhdHRyaWJ1dGVWYWx1ZXMpIHtcbiAgICAgIHRoaXMuc2V0QXR0cmlidXRlKGtleSwgYXR0cmlidXRlVmFsdWVzW2tleV0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgcmVsYXRpb25zaGlwIGNhY2hlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBDbGVhcnMgY2FjaGVkIHJlbGF0aW9uc2hpcCBzdGF0ZS5cbiAgICovXG4gIGNsZWFyUmVsYXRpb25zaGlwQ2FjaGUoKSB7XG4gICAgdGhpcy5fcmVsYXRpb25zaGlwcyA9IHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmltYXJ5IGtleS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IC0gUHJpbWFyeSBrZXkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiB0aGlzLnJlc291cmNlQ29uZmlnKCkucHJpbWFyeUtleSB8fCBcImlkXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW1hcnkga2V5IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IC0gUHJpbWFyeSBrZXkgdmFsdWUuXG4gICAqL1xuICBwcmltYXJ5S2V5VmFsdWUoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgcmV0dXJuIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgY29uc3QgdmFsdWUgPSB0aGlzLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcblxuICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHByaW1hcnkga2V5ICcke2F0dHJpYnV0ZU5hbWV9JyBvbiAke01vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdmFsdWVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHNjYWxhciBpZGVudGl0eSByZXF1aXJlZCBieSBzY2FsYXItb25seSBmcm9udGVuZCBmZWF0dXJlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wZXJhdGlvbiAtIE9wZXJhdGlvbiByZXF1aXJpbmcgYSBzY2FsYXIgaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlTY2FsYXJ9IC0gU2NhbGFyIHByaW1hcnkta2V5IHZhbHVlLlxuICAgKi9cbiAgc2NhbGFyUHJpbWFyeUtleVZhbHVlKG9wZXJhdGlvbikge1xuICAgIHJldHVybiBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZSh0aGlzLnByaW1hcnlLZXlWYWx1ZSgpLCBvcGVyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgaWRlbnRpdHkgcmVwcmVzZW50ZWQgYnkgdGhlIGxhc3QgcGVyc2lzdGVkIGZyb250ZW5kIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gLSBQZXJzaXN0ZWQgcHJpbWFyeS1rZXkgdmFsdWUuXG4gICAqL1xuICBwZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgcmV0dXJuIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgY29uc3QgdmFsdWUgPSB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBwZXJzaXN0ZWQgcHJpbWFyeSBrZXkgJyR7YXR0cmlidXRlTmFtZX0nIG9uICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB2YWx1ZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEF0dHJpYnV0ZSB2YWx1ZS5cbiAgICovXG4gIHJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkge1xuICAgIGlmICh0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMgJiYgIXRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcy5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBBdHRyaWJ1dGVOb3RTZWxlY3RlZEVycm9yKHRoaXMuY29uc3RydWN0b3IubmFtZSwgYXR0cmlidXRlTmFtZSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYW4gYXR0cmlidXRlIHZhbHVlIGlzIGN1cnJlbnRseSBsb2FkZWQgb24gdGhpcyByZWNvcmQuIFVzZWQgYnkgdGhlXG4gICAqIHByZWxvYWRlciB0byBkZWNpZGUgd2hldGhlciBhIHJlbGF0aW9uc2hpcCBjYW4gYmUgc2tpcHBlZCBiZWNhdXNlIHRoZVxuICAgKiByZXF1ZXN0ZWQgY29sdW1ucyBhcmUgYWxyZWFkeSBwcmVzZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBhdHRyaWJ1dGUgaXMgbG9hZGVkLlxuICAgKi9cbiAgaGFzTG9hZGVkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAoIXRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcykgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiB0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZXMuaGFzKGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhbiBhc3NvY2lhdGlvbiBjb3VudCBhdHRhY2hlZCBieSBgLndpdGhDb3VudCguLi4pYC4gQ291bnRzXG4gICAqIGxpdmUgb24gYSBkZWRpY2F0ZWQgbWFwIHNlcGFyYXRlIGZyb20gdGhlIHJlY29yZCdzIGF0dHJpYnV0ZXMgc29cbiAgICogYSB2aXJ0dWFsIGNvdW50IGxpa2UgYHRhc2tzQ291bnRgIGNhbid0IHNpbGVudGx5IHNoYWRvdyBhIHJlYWxcbiAgICogY29sdW1uIG9mIHRoZSBzYW1lIG5hbWUuIFJldHVybnMgdGhlIGF0dGFjaGVkIHZhbHVlLCBvciAwIHdoZW5cbiAgICogYC53aXRoQ291bnQoLi4uKWAgd2Fzbid0IHJlcXVlc3RlZCBmb3IgdGhpcyBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUsIGUuZy4gYFwidGFza3NDb3VudFwiYCBvciBhIGN1c3RvbSBuYW1lIGZyb20gYC53aXRoQ291bnQoe2N1c3RvbU5hbWU6IHsuLi59fSlgLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEF0dGFjaGVkIGFzc29jaWF0aW9uIGNvdW50LCBvciB6ZXJvIHdoZW4gYWJzZW50LlxuICAgKi9cbiAgcmVhZENvdW50KGF0dHJpYnV0ZU5hbWUpIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRBc3NvY2lhdGlvbkNvdW50KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhdHRyaWJ1dGVOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIHNldHRlciBjYWxsZWQgYnkgYGluc3RhbnRpYXRlRnJvbVJlc3BvbnNlYCB3aGVuIGh5ZHJhdGluZ1xuICAgKiBhc3NvY2lhdGlvbiBjb3VudHMgdGhhdCByb2RlIGFsb25nIHdpdGggdGhlIHJlY29yZCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBDb3VudCB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0QXNzb2NpYXRpb25Db3VudChhdHRyaWJ1dGVOYW1lLCB2YWx1ZSkge1xuICAgIHNldFBheWxvYWRBc3NvY2lhdGlvbkNvdW50KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhdHRyaWJ1dGVOYW1lLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGEgcGVyLXJlY29yZCBhYmlsaXR5IHJlc3VsdCBhdHRhY2hlZCBieSBgLmFiaWxpdGllcyguLi4pYC4gVGhlXG4gICAqIGJhY2tlbmQgZXZhbHVhdGVzIGVhY2ggcmVxdWVzdGVkIGFjdGlvbiBhZ2FpbnN0IHRoZSBjdXJyZW50XG4gICAqIGFiaWxpdHkgZm9yIHRoaXMgcmVjb3JkIGluc3RhbmNlIGFuZCBzaGlwcyB0aGUgcmVzdWx0IGFsb25nc2lkZVxuICAgKiB0aGUgcmVjb3JkJ3MgYXR0cmlidXRlcy4gUmV0dXJucyBgZmFsc2VgIHdoZW4gdGhlIGFjdGlvbiB3YXNuJ3RcbiAgICogcmVxdWVzdGVkIChvciB0aGUgYWJpbGl0eSBkZW5pZWQgaXQpLCBzbyBVSSBjb2RlIGNhbiBzYWZlbHkgYnJhbmNoXG4gICAqIG9uIGByZWNvcmQuY2FuKFwidXBkYXRlXCIpYCB3aXRob3V0IGZpcnN0IGNoZWNraW5nIHdoZXRoZXIgdGhlXG4gICAqIGFiaWxpdHkgd2FzIGxvYWRlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEFiaWxpdHkgYWN0aW9uIG5hbWUsIGUuZy4gYFwidXBkYXRlXCJgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXF1ZXN0ZWQgYWJpbGl0eSBpcyBhbGxvd2VkLlxuICAgKi9cbiAgY2FuKGFjdGlvbikge1xuICAgIHJldHVybiByZWFkUGF5bG9hZENvbXB1dGVkQWJpbGl0eSgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIHNldHRlciBjYWxsZWQgYnkgYGluc3RhbnRpYXRlRnJvbVJlc3BvbnNlYCB3aGVuIGh5ZHJhdGluZ1xuICAgKiBwZXItcmVjb3JkIGFiaWxpdHkgcmVzdWx0cyB0aGF0IHJvZGUgYWxvbmcgd2l0aCB0aGUgcmVjb3JkXG4gICAqIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbiBuYW1lLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IHZhbHVlIC0gV2hldGhlciB0aGUgY3VycmVudCBhYmlsaXR5IHBlcm1pdHMgdGhlIGFjdGlvbiBvbiB0aGlzIHJlY29yZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0Q29tcHV0ZWRBYmlsaXR5KGFjdGlvbiwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhY3Rpb24sIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgYSBjb25zdW1lci1kZWZpbmVkIHZhbHVlIGF0dGFjaGVkIGJ5IGAucXVlcnlEYXRhKC4uLilgLiBTdG9yZWRcbiAgICogb24gYSBkZWRpY2F0ZWQgbWFwIHJhdGhlciB0aGFuIGBfYXR0cmlidXRlc2AsIHNvIGEgdmlydHVhbCBhbGlhc1xuICAgKiBsaWtlIGB0YXNrc0NvdW50YCBjYW5ub3Qgc2lsZW50bHkgc2hhZG93IGEgcmVhbCBjb2x1bW4gb2YgdGhlIHNhbWVcbiAgICogbmFtZS4gUmV0dXJucyBgbnVsbGAgd2hlbiBubyByZWdpc3RlcmVkIGZuIHByb2R1Y2VkIHRoYXQgYWxpYXMgZm9yXG4gICAqIHRoaXMgcmVjb3JkIChlLmcuIG5vIGNoaWxkIHJvd3MgbWF0Y2hlZCB0aGUgYWdncmVnYXRlKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBxdWVyeURhdGEgYWxpYXMgbmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEF0dGFjaGVkIHF1ZXJ5LWRhdGEgdmFsdWUuXG4gICAqL1xuICBxdWVyeURhdGEobmFtZSkge1xuICAgIHJldHVybiByZWFkUGF5bG9hZFF1ZXJ5RGF0YSgvKiogQHR5cGUge2ltcG9ydChcIi4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgbmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnRlcm5hbCBzZXR0ZXIgdXNlZCBieSBgaW5zdGFudGlhdGVGcm9tUmVzcG9uc2VgIHdoZW4gaHlkcmF0aW5nXG4gICAqIHF1ZXJ5RGF0YSB2YWx1ZXMgdGhhdCByb2RlIGFsb25nIHdpdGggdGhlIHJlY29yZCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIHF1ZXJ5RGF0YSBhbGlhcyBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIEF0dGFjaGVkIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRRdWVyeURhdGEobmFtZSwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkUXVlcnlEYXRhKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBuYW1lLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG5ld1ZhbHVlIC0gTmV3IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQXNzaWduZWQgdmFsdWUuXG4gICAqL1xuICBzZXRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSwgbmV3VmFsdWUpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUgPSBNb2RlbENsYXNzLm5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICBpZiAobmVzdGVkQXR0cmlidXRlc1JlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzW25lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lXSA9IG5ld1ZhbHVlXG4gICAgICByZXR1cm4gbmV3VmFsdWVcbiAgICB9XG5cbiAgICBpZiAoTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbihhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dHJpYnV0ZU5hbWUpLnF1ZXVlQXR0YWNoKG5ld1ZhbHVlKVxuICAgICAgcmV0dXJuIG5ld1ZhbHVlXG4gICAgfVxuXG4gICAgY29uc3QgcHJldmlvdXNWYWx1ZSA9IHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cblxuICAgIHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBuZXdWYWx1ZVxuXG4gICAgaWYgKHRoaXMuX3NlbGVjdGVkQXR0cmlidXRlcykge1xuICAgICAgdGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVzLmFkZChhdHRyaWJ1dGVOYW1lKVxuICAgIH1cblxuICAgIC8vIE9ubHkgaW52YWxpZGF0ZSByZWxhdGlvbnNoaXAgY2FjaGUgZW50cmllcyB3aG9zZSBmb3JlaWduIGtleSBtYXRjaGVzIHRoZSBjaGFuZ2VkIGF0dHJpYnV0ZS5cbiAgICAvLyBCbGFua2V0LWNsZWFyaW5nIGFsbCByZWxhdGlvbnNoaXBzIG9uIGFueSBhdHRyaWJ1dGUgY2hhbmdlIGRlc3Ryb3lzIG5lc3RlZC1zYXZlIHN0YXRlXG4gICAgLy8gYW5kIHByZWxvYWRlZCBjaGlsZHJlbiB0aGUgY2FsbGVyIG5ldmVyIGFza2VkIHRvIGludmFsaWRhdGUuXG4gICAgaWYgKCFPYmplY3QuaXMocHJldmlvdXNWYWx1ZSwgbmV3VmFsdWUpKSB7XG4gICAgICB0aGlzLl9pbnZhbGlkYXRlUmVsYXRpb25zaGlwc0ZvckF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKVxuICAgIH1cblxuICAgIHJldHVybiBuZXdWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIEludmFsaWRhdGVzIGFueSBjYWNoZWQgYmVsb25nc1RvIHJlbGF0aW9uc2hpcCB3aG9zZSBmb3JlaWduIGtleSBtYXRjaGVzIHRoZVxuICAgKiBjaGFuZ2VkIGF0dHJpYnV0ZS4gSGFzTWFueSAvIGhhc09uZSByZWxhdGlvbnNoaXBzIGFyZSBsZWZ0IHVudG91Y2hlZCBiZWNhdXNlXG4gICAqIHRoZWlyIGZvcmVpZ24ga2V5IGxpdmVzIG9uIHRoZSBjaGlsZCwgbm90IG9uIHRoaXMgbW9kZWwsIGFuZCBibGFua2V0LWNsZWFyaW5nXG4gICAqIHRoZW0gd291bGQgZGVzdHJveSBuZXN0ZWQtc2F2ZSBzdGF0ZSBhbmQgcHJlbG9hZGVkIGNoaWxkcmVuIHRoZSBjYWxsZXIgbmV2ZXJcbiAgICogYXNrZWQgdG8gaW52YWxpZGF0ZS5cbiAgICpcbiAgICogRm9yZWlnbiBrZXlzIGFyZSBpbmZlcnJlZCB3aGVuIG5vdCBkZWNsYXJlZDogZm9yIGJlbG9uZ3NUbyBgcHJvamVjdElkYCBpc1xuICAgKiBpbmZlcnJlZCBmcm9tIHJlbGF0aW9uc2hpcCBuYW1lIGBwcm9qZWN0YC4gRXhwbGljaXQgYGZvcmVpZ25LZXlgIG9uIHRoZVxuICAgKiByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbiB0YWtlcyBwcmVjZWRlbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lIHRoYXQgY2hhbmdlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfaW52YWxpZGF0ZVJlbGF0aW9uc2hpcHNGb3JBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkge1xuICAgIGlmICghdGhpcy5fcmVsYXRpb25zaGlwcyB8fCBPYmplY3Qua2V5cyh0aGlzLl9yZWxhdGlvbnNoaXBzKS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGRlZmluaXRpb25zID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9ucygpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXModGhpcy5fcmVsYXRpb25zaGlwcykpIHtcbiAgICAgIGNvbnN0IGRlZmluaXRpb24gPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZGVmaW5pdGlvbnNbcmVsYXRpb25zaGlwTmFtZV0pXG5cbiAgICAgIGlmICghZGVmaW5pdGlvbiB8fCBkZWZpbml0aW9uLnR5cGUgIT09IFwiYmVsb25nc1RvXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGZvcmVpZ25LZXkgPSBkZWZpbml0aW9uLmZvcmVpZ25LZXkgfHwgYCR7cmVsYXRpb25zaGlwTmFtZX1JZGBcblxuICAgICAgaWYgKGZvcmVpZ25LZXkgPT09IGF0dHJpYnV0ZU5hbWUpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMuX3JlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBwYXRoLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERlcml2ZWQgcmVzb3VyY2UgcGF0aC5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZVBhdGgoKSB7XG4gICAgcmV0dXJuIHZhbGlkYXRlRnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aCh7XG4gICAgICBtb2RlbE5hbWU6IHRoaXMuZ2V0TW9kZWxOYW1lKCksXG4gICAgICByZXNvdXJjZVBhdGg6IGRlZmF1bHRGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKHRoaXMpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbW1hbmQgbmFtZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGV9IGNvbW1hbmRUeXBlIC0gQ29tbWFuZCB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlc29sdmVkIGNvbW1hbmQgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBjb21tYW5kTmFtZShjb21tYW5kVHlwZSkge1xuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHJlc291cmNlQ29uZmlnLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgfHwgW11cbiAgICBjb25zdCBidWlsdEluTWVtYmVyQ29tbWFuZHMgPSByZXNvdXJjZUNvbmZpZy5idWlsdEluTWVtYmVyQ29tbWFuZHMgfHwgW11cbiAgICBjb25zdCBjb21tYW5kcyA9IHJlc291cmNlQ29uZmlnLmNvbW1hbmRzIHx8IFtdXG4gICAgY29uc3QgaXNFeHBvc2VkID0gYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcy5pbmNsdWRlcyhjb21tYW5kVHlwZSkgfHwgYnVpbHRJbk1lbWJlckNvbW1hbmRzLmluY2x1ZGVzKGNvbW1hbmRUeXBlKSB8fCBjb21tYW5kcy5pbmNsdWRlcyhjb21tYW5kVHlwZSlcbiAgICBjb25zdCBjb21tYW5kTmFtZSA9IGlzRXhwb3NlZCA/IGluZmxlY3Rpb24uZGFzaGVyaXplKGluZmxlY3Rpb24udW5kZXJzY29yZShjb21tYW5kVHlwZSkpIDogY29tbWFuZFR5cGVcblxuICAgIHJldHVybiB2YWxpZGF0ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbW1hbmROYW1lKHtcbiAgICAgIGNvbW1hbmROYW1lLFxuICAgICAgY29tbWFuZFR5cGUsXG4gICAgICBtb2RlbE5hbWU6IHRoaXMuZ2V0TW9kZWxOYW1lKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGN1c3RvbSBjb21tYW5kIHBheWxvYWQgYXJndW1lbnRzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncyAtIENvbW1hbmQgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENvbW1hbmQgcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBub3JtYWxpemVDdXN0b21Db21tYW5kUGF5bG9hZEFyZ3VtZW50cyhhcmdzKSB7XG4gICAgaWYgKGFyZ3MubGVuZ3RoID09PSAwKSByZXR1cm4ge31cbiAgICBpZiAoYXJncy5sZW5ndGggPT09IDEpIHtcbiAgICAgIGNvbnN0IHBheWxvYWQgPSBhcmdzWzBdXG4gICAgICBpZiAocGF5bG9hZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiB7fVxuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIHBheWxvYWQgIT09IFwib2JqZWN0XCIgfHwgcGF5bG9hZCA9PT0gbnVsbCkge1xuICAgICAgICByZXR1cm4ge2FyZzE6IHBheWxvYWR9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHBheWxvYWQpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyIHwgc3RyaW5nIHwgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge31cblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBhcmdzLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgcGF5bG9hZFtgYXJnJHtpbmRleCArIDF9YF0gPSBhcmdzW2luZGV4XVxuICAgIH1cblxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbW9kZWwgbmFtZSwgcHJlZmVycmluZyBhbiBleHBsaWNpdCBgc3RhdGljIG1vZGVsTmFtZWAgZGVjbGFyYXRpb25cbiAgICogb3ZlciB0aGUgSmF2YVNjcmlwdCBjbGFzcyBgLm5hbWVgIHByb3BlcnR5LiBUaGlzIGFsbG93cyBtaW5pZmllZCBidWlsZHMgdG9cbiAgICogcHJlc2VydmUgY29ycmVjdCBtb2RlbCBuYW1lcyB3aXRob3V0IHJlbHlpbmcgb24gYGtlZXBfY2xhc3NuYW1lc2AuXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIG1vZGVsIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0TW9kZWxOYW1lKCkge1xuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgbW9kZWxOYW1lID0gcmVzb3VyY2VDb25maWc/Lm1vZGVsTmFtZVxuXG4gICAgcmV0dXJuICh0eXBlb2YgbW9kZWxOYW1lID09PSBcInN0cmluZ1wiICYmIG1vZGVsTmFtZS5sZW5ndGggPiAwKSA/IG1vZGVsTmFtZSA6IHRoaXMubmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uZmlndXJlIHRyYW5zcG9ydC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnfSBjb25maWcgLSBGcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGNvbmZpZ3VyZVRyYW5zcG9ydChjb25maWcpIHtcbiAgICBpZiAoIWNvbmZpZyB8fCB0eXBlb2YgY29uZmlnICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ1cmxcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcudXJsID0gY29uZmlnLnVybFxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInNoYXJlZFwiKSkge1xuICAgICAgZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5zaGFyZWQgPSBjb25maWcuc2hhcmVkXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwid2Vic29ja2V0Q2xpZW50XCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCA9IGNvbmZpZy53ZWJzb2NrZXRDbGllbnRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ3ZWJzb2NrZXRVcmxcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0VXJsID0gY29uZmlnLndlYnNvY2tldFVybFxuICAgICAgLy8gUmVzZXQgY2FjaGVkIGludGVybmFsIGNsaWVudCBzbyB0aGUgbmV3IFVSTCB0YWtlcyBlZmZlY3Qgb24gbmV4dCBzdWJzY3JpYmVcbiAgICAgIHJlc2V0SW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKVxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInJlcXVlc3RIZWFkZXJzXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnJlcXVlc3RIZWFkZXJzID0gY29uZmlnLnJlcXVlc3RIZWFkZXJzXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwicmVxdWVzdENvbnRleHRcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcucmVxdWVzdENvbnRleHQgPSBjb25maWcucmVxdWVzdENvbnRleHRcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ0aW1lb3V0XCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVvdXQgPSBjb25maWcudGltZW91dFxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoY29uZmlnLCBcInNpZ25hbFwiKSkge1xuICAgICAgaWYgKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsICE9PSBjb25maWcuc2lnbmFsKSB7XG4gICAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcuc2lnbmFsID0gY29uZmlnLnNpZ25hbFxuICAgICAgICByZXNldEludGVybmFsV2Vic29ja2V0Q2xpZW50KClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGNvbmZpZywgXCJ0aW1lWm9uZVwiKSkge1xuICAgICAgaWYgKGNvbmZpZy50aW1lWm9uZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGRlbGV0ZSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnRpbWVab25lID0gY29uZmlnLnRpbWVab25lXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwic2Vzc2lvblN0b3JlXCIpKSB7XG4gICAgICBmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLnNlc3Npb25TdG9yZSA9IGNvbmZpZy5zZXNzaW9uU3RvcmVcbiAgICAgIC8vIFJlc2V0IGNhY2hlZCBpbnRlcm5hbCBjbGllbnQgc28gdGhlIG5ldyBzZXNzaW9uU3RvcmUgaXMgcGlja2VkIHVwLlxuICAgICAgcmVzZXRJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChjb25maWcsIFwib2ZmbGluZVN5bmNcIikpIHtcbiAgICAgIGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcub2ZmbGluZVN5bmMgPSBjb25maWcub2ZmbGluZVN5bmNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29ubmVjdCB0aGUgaW50ZXJuYWwgV2ViU29ja2V0IGFuZCBlbmFibGUgYXV0by1yZWNvbm5lY3QuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciwgc2lnbmFsPzogQWJvcnRTaWduYWx9fSBbb3B0aW9uc10gLSBTdGFydHVwIGNvbnRyb2xzIGNvbXBvc2VkIHdpdGggdGhlIGNvbmZpZ3VyZWQgdHJhbnNwb3J0IGNvbnRyb2xzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbm5lY3RlZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjb25uZWN0V2Vic29ja2V0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGNsaWVudCA9IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpXG5cbiAgICBpZiAoIWNsaWVudCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY29ubmVjdFdlYnNvY2tldCByZXF1aXJlcyBjb25maWd1cmVUcmFuc3BvcnQoe3dlYnNvY2tldFVybH0pXCIpXG4gICAgfVxuXG4gICAgYXdhaXQgY2xpZW50LmNvbm5lY3QoZnJvbnRlbmRNb2RlbFdlYnNvY2tldFN0YXJ0dXBDb250cm9scyhvcHRpb25zKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNjb25uZWN0IHRoZSBpbnRlcm5hbCBXZWJTb2NrZXQgYW5kIGRpc2FibGUgYXV0by1yZWNvbm5lY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xvc2VkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGRpc2Nvbm5lY3RXZWJzb2NrZXQoKSB7XG4gICAgaWYgKCFpbnRlcm5hbFdlYnNvY2tldENsaWVudCkgcmV0dXJuXG5cbiAgICBjb25zdCBjbGllbnQgPSBpbnRlcm5hbFdlYnNvY2tldENsaWVudFxuXG4gICAgZGV0YWNoSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoY2xpZW50KVxuICAgIGF3YWl0IGNsaWVudC5kaXNjb25uZWN0QW5kU3RvcFJlY29ubmVjdCgpXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgdW50aWwgcXVldWVkIGFuZCBhY3RpdmUgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHJlcXVlc3RzIGZpbmlzaC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsSWRsZVdhaXRBcmdzfSBbYXJnc10gLSBXYWl0IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdHJhbnNwb3J0IGlzIGlkbGUuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgd2FpdEZvcklkbGUoYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge3F1aWV0TXMgPSAwLCB0aW1lb3V0OiB0aW1lb3V0TXMgPSA1MDAwLCAuLi5yZXN0QXJnc30gPSBhcmdzXG4gICAgY29uc3QgcmVzdEFyZ0tleXMgPSBPYmplY3Qua2V5cyhyZXN0QXJncylcblxuICAgIGlmIChyZXN0QXJnS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gd2FpdEZvcklkbGUgYXJnczogJHtyZXN0QXJnS2V5cy5qb2luKFwiLCBcIil9YClcbiAgICB9XG5cbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShxdWlldE1zKSB8fCBxdWlldE1zIDwgMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCB3YWl0Rm9ySWRsZSBxdWlldE1zIHRvIGJlIGEgbm9uLW5lZ2F0aXZlIG51bWJlciwgZ290OiAke3F1aWV0TXN9YClcbiAgICB9XG5cbiAgICBhd2FpdCB0aW1lb3V0KFxuICAgICAge3RpbWVvdXQ6IHRpbWVvdXRNcywgZXJyb3JNZXNzYWdlOiBcIlRpbWVkIG91dCB3YWl0aW5nIGZvciBmcm9udGVuZCBtb2RlbCB0cmFuc3BvcnQgdG8gYmVjb21lIGlkbGVcIn0sXG4gICAgICBhc3luYyAoKSA9PiBhd2FpdCB3YWl0Rm9yRnJvbnRlbmRNb2RlbFRyYW5zcG9ydElkbGUocXVpZXRNcylcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY3VycmVudCBXZWJTb2NrZXQgY29ubmVjdGlvbiBzdGF0ZS5cbiAgICogQHJldHVybnMge3tkaXNjb25uZWN0ZWRTaW5jZTogbnVtYmVyIHwgbnVsbCwgaGFzQ2xpZW50OiBib29sZWFuLCBpc09wZW46IGJvb2xlYW4sIGxpc3RlbmVyQ291bnQ6IG51bWJlcn19IC0gU25hcHNob3Qgb2YgdGhlIG1hbmFnZWQgd2Vic29ja2V0IGNvbm5lY3Rpb24gc3RhdGUuXG4gICAqL1xuICBzdGF0aWMgd2Vic29ja2V0U3RhdGUoKSB7XG4gICAgaWYgKCFpbnRlcm5hbFdlYnNvY2tldENsaWVudCkge1xuICAgICAgcmV0dXJuIHtkaXNjb25uZWN0ZWRTaW5jZTogbnVsbCwgaGFzQ2xpZW50OiBmYWxzZSwgaXNPcGVuOiBmYWxzZSwgbGlzdGVuZXJDb3VudDogMH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uaW50ZXJuYWxXZWJzb2NrZXRDbGllbnQuc3RhdGUoKSxcbiAgICAgIGhhc0NsaWVudDogdHJ1ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDbG9zZSB0aGUgcmF3IFdlYlNvY2tldCB3aXRob3V0IGRpc2FibGluZyBhdXRvLXJlY29ubmVjdC4gVXNlZCBieSB0ZXN0cyB0b1xuICAgKiBzaW11bGF0ZSBhbiB1bmV4cGVjdGVkIG5ldHdvcmsgZHJvcCBhbmQgdmVyaWZ5IHJlY29ubmVjdGlvbiBiZWhhdmlvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgc29ja2V0IGhhcyBjbG9zZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZHJvcFdlYnNvY2tldCgpIHtcbiAgICBpZiAoIWludGVybmFsV2Vic29ja2V0Q2xpZW50KSByZXR1cm5cblxuICAgIGF3YWl0IGludGVybmFsV2Vic29ja2V0Q2xpZW50LmRyb3BDb25uZWN0aW9uKClcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIGdsb2JhbCBtZXRhZGF0YSBvbiB0aGUgV2ViU29ja2V0IGNvbm5lY3Rpb24uIFNlbnQgdG8gdGhlIHNlcnZlciBpbW1lZGlhdGVseVxuICAgKiBvdmVyIFdlYlNvY2tldCBhbmQgZXhwb3NlZCB0byBXZWJTb2NrZXQtYm9ybmUgcmVxdWVzdHMgYXMgcmVxdWVzdCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIE1ldGFkYXRhIGtleS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBNZXRhZGF0YSB2YWx1ZSAobnVsbCB0byBjbGVhcikuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHNldFdlYnNvY2tldE1ldGFkYXRhKGtleSwgdmFsdWUpIHtcbiAgICBjb25zdCBjbGllbnQgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy53ZWJzb2NrZXRDbGllbnQgfHwgcmVzb2x2ZUludGVybmFsV2Vic29ja2V0Q2xpZW50KCkpXG5cbiAgICBpZiAoIWNsaWVudCB8fCB0eXBlb2YgY2xpZW50LnNldE1ldGFkYXRhICE9PSBcImZ1bmN0aW9uXCIpIHJldHVyblxuXG4gICAgY2xpZW50LnNldE1ldGFkYXRhKGtleSwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogT3BlbnMgYSBtYW5hZ2VkIGNvbm5lY3Rpb24gdGhhdCBhdXRvLW9wZW5zLCBhdXRvLWNsb3NlcywgYW5kXG4gICAqIGF1dG8tcmVjb25uZWN0cyBiYXNlZCBvbiBgc2hvdWxkQ29ubmVjdCgpYCBhbmQgYHBhcmFtcygpYC5cbiAgICogQ2FsbCBgaGFuZGxlLnN5bmMoKWAgd2hlbmV2ZXIgdGhlIGlucHV0cyB0aGF0IGRyaXZlIHRob3NlXG4gICAqIGZ1bmN0aW9ucyBjaGFuZ2UgKGUuZy4gY3VycmVudC11c2VyIHNpZ24taW4vb3V0KS4gVGhlIGhhbmRsZVxuICAgKiByZXRyaWVzIHdoZW4gdGhlIFdTIGNsaWVudCBpc24ndCByZWFkeSBhbmQgcmVvcGVucyBvbiBjbG9zZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbm5lY3Rpb25UeXBlIC0gQ29ubmVjdGlvbiBjbGFzcyBuYW1lIHJlZ2lzdGVyZWQgb24gdGhlIHNlcnZlci5cbiAgICogQHBhcmFtIHt7c2hvdWxkQ29ubmVjdDogKCkgPT4gYm9vbGVhbiwgcGFyYW1zOiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHNpZ25hbD86IEFib3J0U2lnbmFsLCBvbk1lc3NhZ2U/OiAoYm9keTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHZvaWR9fSBvcHRpb25zIC0gQ29ubmVjdGlvbiBsaWZlY3ljbGUsIGNhbmNlbGxhdGlvbiwgYW5kIHBheWxvYWQgY2FsbGJhY2tzLlxuICAgKiBAcmV0dXJucyB7e3N5bmM6ICgpID0+IHZvaWQsIGNsb3NlOiAoKSA9PiB2b2lkfX0gLSBIYW5kbGUgdXNlZCB0byByZXN5bmMgb3IgY2xvc2UgdGhlIG1hbmFnZWQgY29ubmVjdGlvbi5cbiAgICovXG4gIHN0YXRpYyBvcGVuTWFuYWdlZENvbm5lY3Rpb24oY29ubmVjdGlvblR5cGUsIG9wdGlvbnMpIHtcbiAgICAvKipcbiAgICAgKiBDb25uZWN0aW9uLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICBsZXQgY29ubmVjdGlvbiA9IG51bGxcbiAgICBsZXQgY2xvc2VkID0gZmFsc2VcbiAgICAvKipcbiAgICAgKiBSZXRyeSB0aW1lci5cbiAgICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsfSAqL1xuICAgIGxldCByZXRyeVRpbWVyID0gbnVsbFxuICAgIGxldCBsYXN0UGFyYW1zSnNvbiA9IFwiXCJcbiAgICBjb25zdCBjb250cm9scyA9IGZyb250ZW5kTW9kZWxXZWJzb2NrZXRTdGFydHVwQ29udHJvbHMoe3NpZ25hbDogb3B0aW9ucy5zaWduYWx9KVxuICAgIGNvbnN0IGNsZWFyUmV0cnlUaW1lciA9ICgpID0+IHtcbiAgICAgIGlmIChyZXRyeVRpbWVyID09PSBudWxsKSByZXR1cm5cblxuICAgICAgZ2xvYmFsVGhpcy5jbGVhclRpbWVvdXQocmV0cnlUaW1lcilcbiAgICAgIHJldHJ5VGltZXIgPSBudWxsXG4gICAgfVxuXG4gICAgY29uc3QgY2xvc2UgPSAoKSA9PiB7XG4gICAgICBpZiAoY2xvc2VkKSByZXR1cm5cblxuICAgICAgY2xvc2VkID0gdHJ1ZVxuICAgICAgY2xlYXJSZXRyeVRpbWVyKClcbiAgICAgIGNvbnRyb2xzLnNpZ25hbD8ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsIGNsb3NlKVxuICAgICAgaWYgKGNvbm5lY3Rpb24gJiYgIWNvbm5lY3Rpb24uaXNDbG9zZWQoKSkgY29ubmVjdGlvbi5jbG9zZSgpXG4gICAgICBjb25uZWN0aW9uID0gbnVsbFxuICAgIH1cblxuICAgIGNvbnN0IHN5bmMgPSAoKSA9PiB7XG4gICAgICBpZiAoY2xvc2VkKSByZXR1cm5cblxuICAgICAgaWYgKCFvcHRpb25zLnNob3VsZENvbm5lY3QoKSkge1xuICAgICAgICBjbGVhclJldHJ5VGltZXIoKVxuICAgICAgICBpZiAoY29ubmVjdGlvbiAmJiAhY29ubmVjdGlvbi5pc0Nsb3NlZCgpKSBjb25uZWN0aW9uLmNsb3NlKClcbiAgICAgICAgY29ubmVjdGlvbiA9IG51bGxcbiAgICAgICAgbGFzdFBhcmFtc0pzb24gPSBcIlwiXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBjb25zdCBuZXh0UGFyYW1zID0gb3B0aW9ucy5wYXJhbXMoKVxuICAgICAgY29uc3QgbmV4dFBhcmFtc0pzb24gPSBKU09OLnN0cmluZ2lmeShuZXh0UGFyYW1zKVxuXG4gICAgICAvLyBBbHJlYWR5IGNvbm5lY3RlZCB3aXRoIHNhbWUgcGFyYW1zIOKAlCBub3RoaW5nIHRvIGRvLlxuICAgICAgaWYgKGNvbm5lY3Rpb24gJiYgIWNvbm5lY3Rpb24uaXNDbG9zZWQoKSAmJiBuZXh0UGFyYW1zSnNvbiA9PT0gbGFzdFBhcmFtc0pzb24pIHJldHVyblxuXG4gICAgICAvLyBDb25uZWN0ZWQgYnV0IHBhcmFtcyBjaGFuZ2VkIOKAlCBzZW5kIHVwZGF0ZSBtZXNzYWdlLlxuICAgICAgLy8gR3VhcmQgd2l0aCB0cnkvY2F0Y2g6IHRoZSBjb25uZWN0aW9uIGhhbmRsZSBzdGF5cyBsaXZlIGR1cmluZ1xuICAgICAgLy8gcmVjb25uZWN0IGJ1dCB0aGUgdW5kZXJseWluZyBzb2NrZXQgbWF5IGJlIGNsb3NlZC5cbiAgICAgIGlmIChjb25uZWN0aW9uICYmICFjb25uZWN0aW9uLmlzQ2xvc2VkKCkpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25uZWN0aW9uLnNlbmRNZXNzYWdlKG5leHRQYXJhbXMpXG4gICAgICAgICAgbGFzdFBhcmFtc0pzb24gPSBuZXh0UGFyYW1zSnNvblxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICBjb25uZWN0aW9uID0gbnVsbFxuICAgICAgICAgIGxhc3RQYXJhbXNKc29uID0gXCJcIlxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIFdTIGNsaWVudCBub3QgcmVhZHkg4oCUIHJldHJ5LiBDaGVjayB0aGUgYWN0dWFsIGNsaWVudCAod2hpY2hcbiAgICAgIC8vIG1heSBiZSBhbiBpbmplY3RlZCB3ZWJzb2NrZXRDbGllbnQpIGluc3RlYWQgb2Ygd2Vic29ja2V0U3RhdGUoKVxuICAgICAgLy8gd2hpY2ggb25seSByZWZsZWN0cyB0aGUgaW50ZXJuYWwgY2xpZW50LlxuICAgICAgY29uc3QgY2xpZW50ID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcud2Vic29ja2V0Q2xpZW50IHx8IHJlc29sdmVJbnRlcm5hbFdlYnNvY2tldENsaWVudCgpKVxuXG4gICAgICBpZiAoIWNsaWVudCB8fCAhY2xpZW50LmlzT3BlbigpKSB7XG4gICAgICAgIGlmIChyZXRyeVRpbWVyID09PSBudWxsKSB7XG4gICAgICAgICAgcmV0cnlUaW1lciA9IGdsb2JhbFRoaXMuc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICByZXRyeVRpbWVyID0gbnVsbFxuICAgICAgICAgICAgc3luYygpXG4gICAgICAgICAgfSwgMjUwKVxuICAgICAgICB9XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBsYXN0UGFyYW1zSnNvbiA9IG5leHRQYXJhbXNKc29uXG4gICAgICBjb25uZWN0aW9uID0gY2xpZW50Lm9wZW5Db25uZWN0aW9uKGNvbm5lY3Rpb25UeXBlLCB7XG4gICAgICAgIHBhcmFtczogbmV4dFBhcmFtcyxcbiAgICAgICAgb25NZXNzYWdlOiBvcHRpb25zLm9uTWVzc2FnZSxcbiAgICAgICAgb25DbG9zZTogKCkgPT4ge1xuICAgICAgICAgIGlmIChjb25uZWN0aW9uPy5pc0Nsb3NlZCgpKSB7XG4gICAgICAgICAgICBjb25uZWN0aW9uID0gbnVsbFxuICAgICAgICAgICAgbGFzdFBhcmFtc0pzb24gPSBcIlwiXG4gICAgICAgICAgICBzeW5jKClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29udHJvbHMuc2lnbmFsPy5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgY2xvc2UsIHtvbmNlOiB0cnVlfSlcblxuICAgIGlmIChjb250cm9scy5zaWduYWw/LmFib3J0ZWQpIHtcbiAgICAgIGNsb3NlKClcbiAgICB9IGVsc2Uge1xuICAgICAgc3luYygpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtzeW5jLCBjbG9zZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBPcGVucyBhIDE6MSBgV2Vic29ja2V0Q29ubmVjdGlvbmAgb2YgdGhlIGdpdmVuIHR5cGUuIFRoaW5cbiAgICogY29udmVuaWVuY2Ugd3JhcHBlciBhcm91bmQgdGhlIGludGVybmFsIFdTIGNsaWVudCdzXG4gICAqIGBvcGVuQ29ubmVjdGlvbmAuIEFwcHMgdXNlIHRoaXMgZm9yIHBlci1zZXNzaW9uIHN0YXRlL21lc3NhZ2luZ1xuICAgKiB0aGF0IGRvZXNuJ3QgZml0IHRoZSBwdWIvc3ViIENoYW5uZWwgbW9kZWwgKGxvY2FsZSwgcHJlc2VuY2UpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29ubmVjdGlvblR5cGUgLSBOYW1lIHRoZSBzZXJ2ZXIgcmVnaXN0ZXJlZCB0aGUgY2xhc3MgdW5kZXIuXG4gICAqIEBwYXJhbSB7e3BhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgdGltZW91dE1zPzogbnVtYmVyLCBzaWduYWw/OiBBYm9ydFNpZ25hbCwgb25Db25uZWN0PzogKCkgPT4gdm9pZCwgb25NZXNzYWdlPzogKGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB2b2lkLCBvbkRpc2Nvbm5lY3Q/OiAoKSA9PiB2b2lkLCBvblJlc3VtZT86ICgpID0+IHZvaWQsIG9uQ2xvc2U/OiAocmVhc29uOiBzdHJpbmcpID0+IHZvaWR9fSBbb3B0aW9uc10gLSBDb25uZWN0aW9uIG9wdGlvbnMsIHJlYWRpbmVzcyBjb250cm9scywgYW5kIGV2ZW50IGhhbmRsZXJzLiBDb25uZWN0IHRoZSBjbGllbnQgZmlyc3Q7IHRoZSB0aW1lb3V0IGNvdmVycyBzZXJ2ZXItY29uZmlybWVkIHJlYWRpbmVzcyBhbmQgdGhlIHNpZ25hbCBjYW5jZWxzIHJlYWRpbmVzcyB3aXRob3V0IGVudGVyaW5nIHRoZSB3aXJlIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt7cmVhZHk6IFByb21pc2U8dm9pZD4sIGNsb3NlOiAoKSA9PiB2b2lkfX0gLSBXZWJzb2NrZXQgY29ubmVjdGlvbiBoYW5kbGUuXG4gICAqL1xuICBzdGF0aWMgb3BlbldlYnNvY2tldENvbm5lY3Rpb24oY29ubmVjdGlvblR5cGUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgIGlmICghY2xpZW50IHx8IHR5cGVvZiBjbGllbnQub3BlbkNvbm5lY3Rpb24gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwib3BlbldlYnNvY2tldENvbm5lY3Rpb24gcmVxdWlyZXMgY29uZmlndXJlVHJhbnNwb3J0KHt3ZWJzb2NrZXRVcmx9KVwiKVxuICAgIH1cblxuICAgIGNvbnN0IHtzaWduYWwsIHRpbWVvdXRNcywgLi4uY29ubmVjdGlvbk9wdGlvbnN9ID0gb3B0aW9uc1xuXG4gICAgcmV0dXJuIGNsaWVudC5vcGVuQ29ubmVjdGlvbihjb25uZWN0aW9uVHlwZSwge1xuICAgICAgLi4uY29ubmVjdGlvbk9wdGlvbnMsXG4gICAgICAuLi5mcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKHtzaWduYWwsIHRpbWVvdXRNc30pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdWJzY3JpYmVzIHRvIGEgcHViL3N1YiBgV2Vic29ja2V0Q2hhbm5lbGAuIFRoaW4gd3JhcHBlciBhcm91bmRcbiAgICogdGhlIGludGVybmFsIGNsaWVudCdzIGBzdWJzY3JpYmVDaGFubmVsYC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNoYW5uZWxUeXBlIC0gQ2hhbm5lbCBjbGFzcyBuYW1lIHJlZ2lzdGVyZWQgb24gdGhlIHNlcnZlci5cbiAgICogQHBhcmFtIHt7cGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCB0aW1lb3V0TXM/OiBudW1iZXIsIHNpZ25hbD86IEFib3J0U2lnbmFsLCBvbk1lc3NhZ2U/OiAoYm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHZvaWQsIG9uRGlzY29ubmVjdD86ICgpID0+IHZvaWQsIG9uUmVzdW1lPzogKCkgPT4gdm9pZCwgb25DbG9zZT86IChyZWFzb246IHN0cmluZykgPT4gdm9pZH19IFtvcHRpb25zXSAtIENoYW5uZWwgb3B0aW9ucywgc3RhcnR1cCBjb250cm9scywgYW5kIGV2ZW50IGhhbmRsZXJzLiBUaGUgdGltZW91dCBjb3ZlcnMgY29ubmVjdCBhbmQgc2VydmVyLWNvbmZpcm1lZCByZWFkaW5lc3Mgb25seTsgdGhlIHNpZ25hbCBjYW5jZWxzIHN0YXJ0dXAgd2l0aG91dCBlbnRlcmluZyB0aGUgd2lyZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7e3JlYWR5OiBQcm9taXNlPHZvaWQ+LCBjbG9zZTogKCkgPT4gdm9pZH19IC0gV2Vic29ja2V0IGNoYW5uZWwgaGFuZGxlIGZyb20gdGhlIGNvbmZpZ3VyZWQgY2xpZW50LlxuICAgKi9cbiAgc3RhdGljIHN1YnNjcmliZVdlYnNvY2tldENoYW5uZWwoY2hhbm5lbFR5cGUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGNsaWVudCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChmcm9udGVuZE1vZGVsVHJhbnNwb3J0Q29uZmlnLndlYnNvY2tldENsaWVudCB8fCByZXNvbHZlSW50ZXJuYWxXZWJzb2NrZXRDbGllbnQoKSlcblxuICAgIGlmICghY2xpZW50IHx8IHR5cGVvZiBjbGllbnQuc3Vic2NyaWJlQ2hhbm5lbCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzdWJzY3JpYmVXZWJzb2NrZXRDaGFubmVsIHJlcXVpcmVzIGNvbmZpZ3VyZVRyYW5zcG9ydCh7d2Vic29ja2V0VXJsfSlcIilcbiAgICB9XG5cbiAgICBjb25zdCB7cGFyYW1zLCBzaWduYWwsIHRpbWVvdXRNcywgLi4uY2hhbm5lbE9wdGlvbnN9ID0gb3B0aW9uc1xuICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gZnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KClcbiAgICBjb25zdCBzY29wZWRQYXJhbXMgPSBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCwgcGFyYW1zID09PSB1bmRlZmluZWQgPyB7fSA6IHBhcmFtcylcbiAgICBjb25zdCBzdGFydHVwQ29udHJvbHMgPSBmcm9udGVuZE1vZGVsV2Vic29ja2V0U3RhcnR1cENvbnRyb2xzKHtzaWduYWwsIHRpbWVvdXRNc30pXG4gICAgY29uc3Qgc2NvcGVkUGFyYW1zT3B0aW9uID0gcGFyYW1zID09PSB1bmRlZmluZWQgJiYgT2JqZWN0LmtleXMocmVxdWVzdENvbnRleHQpLmxlbmd0aCA9PT0gMFxuICAgICAgPyB7fVxuICAgICAgOiB7cGFyYW1zOiBzY29wZWRQYXJhbXN9XG4gICAgY29uc3QgaGFuZGxlID0gY2xpZW50LnN1YnNjcmliZUNoYW5uZWwoY2hhbm5lbFR5cGUsIHsuLi5jaGFubmVsT3B0aW9ucywgLi4uc2NvcGVkUGFyYW1zT3B0aW9uLCAuLi5zdGFydHVwQ29udHJvbHN9KVxuXG4gICAgaWYgKHR5cGVvZiBjbGllbnQuY29ubmVjdCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB2b2lkIGNsaWVudC5jb25uZWN0KHN0YXJ0dXBDb250cm9scykuY2F0Y2goKCkgPT4gaGFuZGxlLmNsb3NlKCkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGhhbmRsZVxuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbGxzIFdlYlNvY2tldCBsaWZlY3ljbGUgaG9va3Mgb24gZ2xvYmFsVGhpcyBmb3Igc3lzdGVtIHRlc3QgYWNjZXNzLlxuICAgKiBUZXN0cyBjYW4gY2FsbCBgZ2xvYmFsVGhpcy5fX3ZlbG9jaW91c193ZWJzb2NrZXRfaG9va3MuY29ubmVjdCgpYCBldGMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGluc3RhbGxXZWJzb2NrZXRUZXN0SG9va3MoKSB7XG4gICAgaWYgKHR5cGVvZiBnbG9iYWxUaGlzID09PSBcInVuZGVmaW5lZFwiKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChnbG9iYWxUaGlzKS5fX3ZlbG9jaW91c193ZWJzb2NrZXRfaG9va3MgPSB7XG4gICAgICBjb25uZWN0OiAoKSA9PiB0aGlzLmNvbm5lY3RXZWJzb2NrZXQoKSxcbiAgICAgIGRpc2Nvbm5lY3Q6ICgpID0+IHRoaXMuZGlzY29ubmVjdFdlYnNvY2tldCgpLFxuICAgICAgZHJvcDogKCkgPT4gdGhpcy5kcm9wV2Vic29ja2V0KCksXG4gICAgICBzdGF0ZTogKCkgPT4gdGhpcy53ZWJzb2NrZXRTdGF0ZSgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXR0cmlidXRlcyBmcm9tIHJlc3BvbnNlLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge29iamVjdH0gcmVzcG9uc2UgLSBSZXNwb25zZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gLSBBdHRyaWJ1dGVzIGZyb20gcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBhdHRyaWJ1dGVzRnJvbVJlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgY29uc3QgbW9kZWxEYXRhID0gdGhpcy5tb2RlbERhdGFGcm9tUmVzcG9uc2UocmVzcG9uc2UpXG5cbiAgICByZXR1cm4gbW9kZWxEYXRhLmF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1vZGVsIGRhdGEgZnJvbSByZXNwb25zZS5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtvYmplY3R9IHJlc3BvbnNlIC0gUmVzcG9uc2UgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3thYmlsaXRpZXM6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4+LCBhdHRhY2htZW50T3duZXI6IHtyZWNvcmRJZDogc3RyaW5nLCByZWNvcmRUeXBlOiBzdHJpbmd9IHwgbnVsbCwgYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgYXNzb2NpYXRpb25Db3VudHM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4sIHF1ZXJ5RGF0YTogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgcHJlbG9hZGVkUmVsYXRpb25zaGlwczogUmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPiwgc2VsZWN0ZWRBdHRyaWJ1dGVzOiBTZXQ8c3RyaW5nPn19IC0gQXR0cmlidXRlcywgYXR0YWNobWVudCBvd25lciwgcHJlbG9hZGVkIHJlbGF0aW9uc2hpcHMsIGFzc29jaWF0aW9uIGNvdW50cywgcXVlcnlEYXRhLCBhYmlsaXRpZXMsIGFuZCBzZWxlY3RlZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgc3RhdGljIG1vZGVsRGF0YUZyb21SZXNwb25zZShyZXNwb25zZSkge1xuICAgIGlmICghcmVzcG9uc2UgfHwgdHlwZW9mIHJlc3BvbnNlICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG9iamVjdCByZXNwb25zZSBidXQgZ290OiAke3Jlc3BvbnNlfWApXG4gICAgfVxuXG4gICAgLy8gTmFycm93cyB0aGUgcmVzcG9uc2Ugb2JqZWN0IHRvIHRoZSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgdmFsdWUgbWFwLlxuICAgIGNvbnN0IHJlc3BvbnNlT2JqZWN0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAocmVzcG9uc2UpXG5cbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIG1vZGVsRGF0YS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi9cbiAgICBsZXQgbW9kZWxEYXRhXG5cbiAgICBpZiAocmVzcG9uc2VPYmplY3QubW9kZWwgJiYgdHlwZW9mIHJlc3BvbnNlT2JqZWN0Lm1vZGVsID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAvLyBOYXJyb3dzIHRoZSBuZXN0ZWQgbW9kZWwgcGF5bG9hZCB0byB0aGUgZnJvbnRlbmQtbW9kZWwgdmFsdWUgbWFwLlxuICAgICAgbW9kZWxEYXRhID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqLyAocmVzcG9uc2VPYmplY3QubW9kZWwpXG4gICAgfSBlbHNlIGlmIChyZXNwb25zZU9iamVjdC5hdHRyaWJ1dGVzICYmIHR5cGVvZiByZXNwb25zZU9iamVjdC5hdHRyaWJ1dGVzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAvLyBOYXJyb3dzIHRoZSBuZXN0ZWQgYXR0cmlidXRlcyBwYXlsb2FkIHRvIHRoZSBmcm9udGVuZC1tb2RlbCB2YWx1ZSBtYXAuXG4gICAgICBtb2RlbERhdGEgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChyZXNwb25zZU9iamVjdC5hdHRyaWJ1dGVzKVxuICAgIH0gZWxzZSB7XG4gICAgICBtb2RlbERhdGEgPSByZXNwb25zZU9iamVjdFxuICAgIH1cblxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovICh7Li4ubW9kZWxEYXRhfSlcbiAgICBjb25zdCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzID0gaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzW1BSRUxPQURFRF9SRUxBVElPTlNISVBTX0tFWV0pXG4gICAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKGF0dHJpYnV0ZXNbUFJFTE9BREVEX1JFTEFUSU9OU0hJUFNfS0VZXSlcbiAgICAgIDoge31cbiAgICBjb25zdCBhc3NvY2lhdGlvbkNvdW50cyA9IGlzUGxhaW5PYmplY3QoYXR0cmlidXRlc1tBU1NPQ0lBVElPTl9DT1VOVFNfS0VZXSlcbiAgICAgID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqLyAoYXR0cmlidXRlc1tBU1NPQ0lBVElPTl9DT1VOVFNfS0VZXSlcbiAgICAgIDoge31cbiAgICBjb25zdCBxdWVyeURhdGEgPSBpc1BsYWluT2JqZWN0KGF0dHJpYnV0ZXNbUVVFUllfREFUQV9LRVldKVxuICAgICAgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT59ICovIChhdHRyaWJ1dGVzW1FVRVJZX0RBVEFfS0VZXSlcbiAgICAgIDoge31cbiAgICBjb25zdCBhYmlsaXRpZXMgPSBpc1BsYWluT2JqZWN0KGF0dHJpYnV0ZXNbQUJJTElUSUVTX0tFWV0pXG4gICAgICA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbj59ICovIChhdHRyaWJ1dGVzW0FCSUxJVElFU19LRVldKVxuICAgICAgOiB7fVxuICAgIGNvbnN0IHNlbGVjdGVkQXR0cmlidXRlc0Zyb21QYXlsb2FkID0gQXJyYXkuaXNBcnJheShhdHRyaWJ1dGVzW1NFTEVDVEVEX0FUVFJJQlVURVNfS0VZXSlcbiAgICAgID8gbmV3IFNldCgvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoYXR0cmlidXRlc1tTRUxFQ1RFRF9BVFRSSUJVVEVTX0tFWV0pLmZpbHRlcigoYXR0cmlidXRlTmFtZSkgPT4gdHlwZW9mIGF0dHJpYnV0ZU5hbWUgPT09IFwic3RyaW5nXCIpKVxuICAgICAgOiBudWxsXG4gICAgY29uc3QgYXR0YWNobWVudE93bmVyUGF5bG9hZCA9IGF0dHJpYnV0ZXNbQVRUQUNITUVOVF9PV05FUl9LRVldXG4gICAgbGV0IGF0dGFjaG1lbnRPd25lciA9IG51bGxcblxuICAgIGlmIChhdHRhY2htZW50T3duZXJQYXlsb2FkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmICghaXNQbGFpbk9iamVjdChhdHRhY2htZW50T3duZXJQYXlsb2FkKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBFeHBlY3RlZCAke0FUVEFDSE1FTlRfT1dORVJfS0VZfSB0byBiZSBhbiBvYmplY3RgKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhdHRhY2htZW50T3duZXJPYmplY3QgPSAvKiogQHR5cGUge3tyZWNvcmRJZD86IHVua25vd24sIHJlY29yZFR5cGU/OiB1bmtub3dufX0gKi8gKGF0dGFjaG1lbnRPd25lclBheWxvYWQpXG5cbiAgICAgIGF0dGFjaG1lbnRPd25lciA9IHtcbiAgICAgICAgcmVjb3JkSWQ6IGZvcmNlZE5vbkJsYW5rU3RyaW5nKGF0dGFjaG1lbnRPd25lck9iamVjdC5yZWNvcmRJZCwgYCR7QVRUQUNITUVOVF9PV05FUl9LRVl9LnJlY29yZElkYCksXG4gICAgICAgIHJlY29yZFR5cGU6IGZvcmNlZE5vbkJsYW5rU3RyaW5nKGF0dGFjaG1lbnRPd25lck9iamVjdC5yZWNvcmRUeXBlLCBgJHtBVFRBQ0hNRU5UX09XTkVSX0tFWX0ucmVjb3JkVHlwZWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbQVRUQUNITUVOVF9PV05FUl9LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbUFJFTE9BREVEX1JFTEFUSU9OU0hJUFNfS0VZXVxuICAgIGRlbGV0ZSBhdHRyaWJ1dGVzW1NFTEVDVEVEX0FUVFJJQlVURVNfS0VZXVxuICAgIGRlbGV0ZSBhdHRyaWJ1dGVzW0FTU09DSUFUSU9OX0NPVU5UU19LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbUVVFUllfREFUQV9LRVldXG4gICAgZGVsZXRlIGF0dHJpYnV0ZXNbQUJJTElUSUVTX0tFWV1cblxuICAgIGNvbnN0IHNlbGVjdGVkQXR0cmlidXRlcyA9IHNlbGVjdGVkQXR0cmlidXRlc0Zyb21QYXlsb2FkIHx8IG5ldyBTZXQoT2JqZWN0LmtleXMoYXR0cmlidXRlcykpXG5cbiAgICByZXR1cm4ge2FiaWxpdGllcywgYXR0YWNobWVudE93bmVyLCBhdHRyaWJ1dGVzLCBhc3NvY2lhdGlvbkNvdW50cywgcXVlcnlEYXRhLCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzLCBzZWxlY3RlZEF0dHJpYnV0ZXN9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBwcmVsb2FkZWQgcmVsYXRpb25zaGlwcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHByZWxvYWRlZFJlbGF0aW9uc2hpcHMgLSBQcmVsb2FkZWQgcmVsYXRpb25zaGlwIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFwcGx5UHJlbG9hZGVkUmVsYXRpb25zaGlwcyhtb2RlbCwgcHJlbG9hZGVkUmVsYXRpb25zaGlwcykge1xuICAgIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcFBheWxvYWRdIG9mIE9iamVjdC5lbnRyaWVzKHByZWxvYWRlZFJlbGF0aW9uc2hpcHMpKSB7XG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBtb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLnJlbGF0aW9uc2hpcE1vZGVsQ2xhc3MocmVsYXRpb25zaGlwTmFtZSlcblxuICAgICAgaWYgKHJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxIYXNNYW55UmVsYXRpb25zaGlwKSB7XG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShyZWxhdGlvbnNoaXBQYXlsb2FkKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX0gcGF5bG9hZCB0byBiZSBhbiBhcnJheWApXG4gICAgICAgIH1cblxuICAgICAgICAvKiogQHR5cGUge0FycmF5PEZyb250ZW5kTW9kZWxCYXNlPn0gKi9cbiAgICAgICAgY29uc3QgcmVsYXRlZE1vZGVscyA9IFtdXG5cbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiByZWxhdGlvbnNoaXBQYXlsb2FkKSB7XG4gICAgICAgICAgY29uc3QgcmVsYXRlZE1vZGVsID0gdGhpcy5pbnN0YW50aWF0ZVJlbGF0aW9uc2hpcFZhbHVlKGVudHJ5LCB0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgICAgICAgaWYgKCEocmVsYXRlZE1vZGVsIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEJhc2UpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7dGhpcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9IHBheWxvYWQgZW50cnkgdG8gaW5zdGFudGlhdGUgYSBmcm9udGVuZCBtb2RlbGApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmVsYXRlZE1vZGVscy5wdXNoKHJlbGF0ZWRNb2RlbClcbiAgICAgICAgfVxuXG4gICAgICAgIHJlbGF0aW9uc2hpcC5zZXRMb2FkZWQocmVsYXRlZE1vZGVscylcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkocmVsYXRpb25zaGlwUGF5bG9hZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke3RoaXMubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfSBwYXlsb2FkIHRvIGJlIHNpbmd1bGFyYClcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVsYXRlZE1vZGVsID0gdGhpcy5pbnN0YW50aWF0ZVJlbGF0aW9uc2hpcFZhbHVlKHJlbGF0aW9uc2hpcFBheWxvYWQsIHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICAgIGlmIChyZWxhdGVkTW9kZWwgIT0gdW5kZWZpbmVkICYmICEocmVsYXRlZE1vZGVsIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEJhc2UpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHt0aGlzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX0gcGF5bG9hZCB0byBpbnN0YW50aWF0ZSBhIGZyb250ZW5kIG1vZGVsYClcbiAgICAgIH1cblxuICAgICAgcmVsYXRpb25zaGlwLnNldExvYWRlZChyZWxhdGVkTW9kZWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zdGFudGlhdGUgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWxhdGlvbnNoaXBQYXlsb2FkIC0gUmVsYXRpb25zaGlwIHBheWxvYWQgdmFsdWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzIHwgbnVsbH0gdGFyZ2V0TW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEluc3RhbnRpYXRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgaW5zdGFudGlhdGVSZWxhdGlvbnNoaXBWYWx1ZShyZWxhdGlvbnNoaXBQYXlsb2FkLCB0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSByZXR1cm4gcmVsYXRpb25zaGlwUGF5bG9hZFxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXBQYXlsb2FkIHx8IHR5cGVvZiByZWxhdGlvbnNoaXBQYXlsb2FkICE9PSBcIm9iamVjdFwiKSByZXR1cm4gcmVsYXRpb25zaGlwUGF5bG9hZFxuXG4gICAgcmV0dXJuIHRhcmdldE1vZGVsQ2xhc3MuaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UocmVsYXRpb25zaGlwUGF5bG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc3RhbnRpYXRlIGZyb20gcmVzcG9uc2UuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEluc3RhbmNlVHlwZTxUPn0gcmVzcG9uc2UgLSBSZXNwb25zZSBwYXlsb2FkLCBvciBhbiBhbHJlYWR5LWh5ZHJhdGVkIGluc3RhbmNlIG9mIHRoaXMgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtJbnN0YW5jZVR5cGU8VD59IC0gTmV3IG1vZGVsIGluc3RhbmNlLCBvciB0aGUgc2FtZSBpbnN0YW5jZSB1bmNoYW5nZWQgaWYgaXQgd2FzIGFscmVhZHkgaHlkcmF0ZWQuXG4gICAqL1xuICBzdGF0aWMgaW5zdGFudGlhdGVGcm9tUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICAvLyBJZGVtcG90ZW50OiBpZiBhIGNhbGxlciBoYW5kcyB1cyBhbiBhbHJlYWR5LWh5ZHJhdGVkIGluc3RhbmNlIG9mIHRoaXNcbiAgICAvLyBjbGFzcyAobm93IGNvbW1vbiBiZWNhdXNlIHRoZSBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJIGF1dG8tc2VyaWFsaXplc1xuICAgIC8vIGJhY2tlbmQgYFJlY29yZGAgaW5zdGFuY2VzIHJldHVybmVkIGZyb20gY3VzdG9tIGNvbW1hbmRzIGFuZCB0aGVcbiAgICAvLyB0cmFuc3BvcnQgZGVzZXJpYWxpemVyIGh5ZHJhdGVzIHRoZW0gaW50byBtb2RlbHMgYmVmb3JlIHRoZSBjYWxsIHNpdGVcbiAgICAvLyBzZWVzIHRoZSByZXNwb25zZSksIHJldHVybiBpdCBhcy1pcy4gV2l0aG91dCB0aGlzLCBjb2RlIHRoYXQgaGFzXG4gICAgLy8gaGlzdG9yaWNhbGx5IHdyYXBwZWQgY3VzdG9tLWNvbW1hbmQgcmVzcG9uc2VzIGluXG4gICAgLy8gYE1vZGVsLmluc3RhbnRpYXRlRnJvbVJlc3BvbnNlKHJlc3BvbnNlLmZpZWxkKWAgd291bGQgc3ByZWFkIHRoZSBsaXZlXG4gICAgLy8gbW9kZWwgaW5zdGFuY2UgaW50byBhIG5ldyBjb25zdHJ1Y3RvciBjYWxsIGFuZCBwcm9kdWNlIGEgYnJva2VuIG1vZGVsXG4gICAgLy8gd2l0aCBpbnRlcm5hbCBzdGF0ZSBrZXlzIHByb21vdGVkIHRvIGF0dHJpYnV0ZXMuXG4gICAgaWYgKHJlc3BvbnNlIGluc3RhbmNlb2YgdGhpcykge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7SW5zdGFuY2VUeXBlPFQ+fSAqLyAocmVzcG9uc2UpXG4gICAgfVxuXG4gICAgY29uc3QgbW9kZWxEYXRhID0gdGhpcy5tb2RlbERhdGFGcm9tUmVzcG9uc2UocmVzcG9uc2UpXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IG1vZGVsRGF0YS5hdHRyaWJ1dGVzXG4gICAgY29uc3QgcHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IG1vZGVsRGF0YS5wcmVsb2FkZWRSZWxhdGlvbnNoaXBzXG4gICAgY29uc3QgYXNzb2NpYXRpb25Db3VudHMgPSBtb2RlbERhdGEuYXNzb2NpYXRpb25Db3VudHNcbiAgICBjb25zdCBxdWVyeURhdGEgPSBtb2RlbERhdGEucXVlcnlEYXRhXG4gICAgY29uc3QgYWJpbGl0aWVzID0gbW9kZWxEYXRhLmFiaWxpdGllc1xuICAgIGNvbnN0IGF0dGFjaG1lbnRPd25lciA9IG1vZGVsRGF0YS5hdHRhY2htZW50T3duZXJcbiAgICBjb25zdCBzZWxlY3RlZEF0dHJpYnV0ZXMgPSBtb2RlbERhdGEuc2VsZWN0ZWRBdHRyaWJ1dGVzXG4gICAgY29uc3QgcmVjZWl2ZXIgPSAvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzKVxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge25ldyAoYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxBdHRyaWJ1dGVWYWx1ZT4pID0+IEluc3RhbmNlVHlwZTxUPn0gKi8gKHJlY2VpdmVyKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoYXR0cmlidXRlcylcbiAgICBtb2RlbC5fYXR0YWNobWVudE93bmVyID0gYXR0YWNobWVudE93bmVyXG4gICAgbW9kZWwuX3NlbGVjdGVkQXR0cmlidXRlcyA9IHNlbGVjdGVkQXR0cmlidXRlcyA/IG5ldyBTZXQoc2VsZWN0ZWRBdHRyaWJ1dGVzKSA6IG51bGxcblxuICAgIHRoaXMuYXBwbHlQcmVsb2FkZWRSZWxhdGlvbnNoaXBzKG1vZGVsLCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGFzc29jaWF0aW9uQ291bnRzIHx8IHt9KSkge1xuICAgICAgbW9kZWwuX3NldEFzc29jaWF0aW9uQ291bnQoYXR0cmlidXRlTmFtZSwgTnVtYmVyKHZhbHVlKSB8fCAwKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgW25hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhxdWVyeURhdGEgfHwge30pKSB7XG4gICAgICBtb2RlbC5fc2V0UXVlcnlEYXRhKG5hbWUsIHZhbHVlKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgW2FjdGlvbiwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGFiaWxpdGllcyB8fCB7fSkpIHtcbiAgICAgIG1vZGVsLl9zZXRDb21wdXRlZEFiaWxpdHkoYWN0aW9uLCBCb29sZWFuKHZhbHVlKSlcbiAgICB9XG5cbiAgICBtb2RlbC5zZXRJc05ld1JlY29yZChmYWxzZSlcbiAgICBtb2RlbC5fcGVyc2lzdGVkQXR0cmlidXRlcyA9IGNsb25lRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMobW9kZWwuYXR0cmlidXRlcygpKVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtudW1iZXIgfCBzdHJpbmd9IGlkIC0gUmVjb3JkIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gUmVzb2x2ZWQgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZChpZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZChpZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIEF0dHJpYnV0ZSBtYXRjaCBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBGb3VuZCBtb2RlbCBvciBudWxsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRCeShjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5maW5kQnkoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgb3IgZmFpbC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gQXR0cmlidXRlIG1hdGNoIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxUPj59IC0gRm91bmQgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZEJ5T3JGYWlsKGNvbmRpdGlvbnMpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpbmRCeU9yRmFpbChjb25kaXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYXJyYXkuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD5bXT59IC0gTG9hZGVkIG1vZGVsIGluc3RhbmNlcy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB0b0FycmF5KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkudG9BcnJheSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+W10+fSAtIExvYWRlZCBtb2RlbCBpbnN0YW5jZXMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgbG9hZCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmxvYWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWxsLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyLlxuICAgKi9cbiAgc3RhdGljIGFsbCgpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aGVyZS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gUm9vdC1tb2RlbCB3aGVyZSBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggd2hlcmUgY29uZGl0aW9ucy5cbiAgICovXG4gIHN0YXRpYyB3aGVyZShjb25kaXRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS53aGVyZShjb25kaXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgam9pbnMuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IGpvaW5zIC0gUmVsYXRpb25zaGlwIGRlc2NyaXB0b3Igam9pbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCBqb2lucy5cbiAgICovXG4gIHN0YXRpYyBqb2lucyhqb2lucykge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkuam9pbnMoam9pbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsaW1pdC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIE1heGltdW0gbnVtYmVyIG9mIHJlY29yZHMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCBsaW1pdC5cbiAgICovXG4gIHN0YXRpYyBsaW1pdCh2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkubGltaXQodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvZmZzZXQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBOdW1iZXIgb2YgcmVjb3JkcyB0byBza2lwLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5kZWZhdWx0PFQ+fSAtIFF1ZXJ5IHdpdGggb2Zmc2V0LlxuICAgKi9cbiAgc3RhdGljIG9mZnNldCh2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkub2Zmc2V0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFnZS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7bnVtYmVyfSBwYWdlTnVtYmVyIC0gMS1iYXNlZCBwYWdlIG51bWJlci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcXVlcnkuanNcIikuZGVmYXVsdDxUPn0gLSBRdWVyeSB3aXRoIHBhZ2UgYXBwbGllZC5cbiAgICovXG4gIHN0YXRpYyBwYWdlKHBhZ2VOdW1iZXIpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLnBhZ2UocGFnZU51bWJlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlciBwYWdlLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gTnVtYmVyIG9mIHJlY29yZHMgcGVyIHBhZ2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLmRlZmF1bHQ8VD59IC0gUXVlcnkgd2l0aCBwYWdlIHNpemUuXG4gICAqL1xuICBzdGF0aWMgcGVyUGFnZSh2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5KCkucGVyUGFnZSh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvdW50LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBOdW1iZXIgb2YgbG9hZGVkIG1vZGVsIGluc3RhbmNlcy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjb3VudCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmNvdW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGFzcy1sZXZlbCBob29rIGZpcmVkIHdoZW4gYW55IHJlY29yZCBvZiB0aGlzIG1vZGVsIGlzIGNyZWF0ZWQuXG4gICAqIFN1YnNjcmliZS10aW1lIGF1dGhvcml6YXRpb24gb25seSDigJQgb25jZSBhIHN1YnNjcmlwdGlvbiBpc1xuICAgKiBhY2NlcHRlZCwgZnV0dXJlIGBjcmVhdGVgIGV2ZW50cyBmb3IgdGhpcyBtb2RlbCBhcmUgZGVsaXZlcmVkXG4gICAqIHdpdGhvdXQgcmUtY2hlY2tpbmcgcGVyLXJlY29yZCB2aXNpYmlsaXR5LiBRdWVyeSBvcHRpb25zIGNhbiBzdGlsbFxuICAgKiBuYXJyb3cgd2hpY2ggZXZlbnRzIHJlYWNoIHRoaXMgY2FsbGJhY2suXG4gICAqIEB0aGlzIHtGcm9udGVuZE1vZGVsQ2xhc3N9XG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWUsIG1vZGVsOiBGcm9udGVuZE1vZGVsQmFzZX0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciByZWNvcmQgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBvbkNyZWF0ZShjYWxsYmFjaywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0LCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKHRoaXMsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKHRoaXMsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBlbnRyeSA9IHtjYWxsYmFjaywgLi4uZXZlbnRPcHRpb25zUGF5bG9hZH1cblxuICAgIHJldHVybiBhd2FpdCBzdWIucmVnaXN0ZXJDbGFzc0NhbGxiYWNrKHN1Yi5jbGFzc0NyZWF0ZUNhbGxiYWNrcywgZW50cnkpXG4gIH1cblxuICAvKipcbiAgICogQ2xhc3MtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIGFueSByZWNvcmQgb2YgdGhpcyBtb2RlbCBpcyB1cGRhdGVkLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7aWQ6IHN0cmluZyB8IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLkNvbXBvc2l0ZU1vZGVsUHJpbWFyeUtleVZhbHVlLCBtb2RlbDogRnJvbnRlbmRNb2RlbEJhc2V9KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gRXZlbnQgcXVlcnkgb3IgcmVjb3JkIHByb2plY3Rpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8KCkgPT4gdm9pZD59IC0gVW5zdWJzY3JpYmUgY2FsbGJhY2suXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgb25VcGRhdGUoY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHtyZXF1ZXN0Q29udGV4dCwgLi4uZXZlbnRPcHRpb25zUGF5bG9hZH0gPSBmcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zUGF5bG9hZCh0aGlzLCBvcHRpb25zKVxuICAgIGNvbnN0IHN1YiA9IGVuc3VyZUZyb250ZW5kTW9kZWxFdmVudFN1YnNjcmlwdGlvbih0aGlzLCBmcm9udGVuZE1vZGVsRXZlbnRSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCkpXG4gICAgY29uc3QgZW50cnkgPSB7Y2FsbGJhY2ssIC4uLmV2ZW50T3B0aW9uc1BheWxvYWR9XG5cbiAgICByZXR1cm4gYXdhaXQgc3ViLnJlZ2lzdGVyQ2xhc3NDYWxsYmFjayhzdWIuY2xhc3NVcGRhdGVDYWxsYmFja3MsIGVudHJ5KVxuICB9XG5cbiAgLyoqXG4gICAqIENsYXNzLWxldmVsIGhvb2sgZmlyZWQgd2hlbiBhbnkgcmVjb3JkIG9mIHRoaXMgbW9kZWwgaXMgZGVzdHJveWVkLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7aWQ6IHN0cmluZyB8IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLkNvbXBvc2l0ZU1vZGVsUHJpbWFyeUtleVZhbHVlfSkgPT4gdm9pZH0gY2FsbGJhY2sgLSBFdmVudCBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3F1ZXJ5LmpzXCIpLkZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnN9IFtvcHRpb25zXSAtIEFjY2VwdGVkIGZvciBBUEkgc3ltbWV0cnk7IGRlc3Ryb3kgZXZlbnRzIGNhcnJ5IGlkcyBvbmx5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBvbkRlc3Ryb3koY2FsbGJhY2ssIG9wdGlvbnMgPSB7fSkge1xuICAgIGFzc2VydE5vRGVzdHJveUV2ZW50RmlsdGVyKHRoaXMsIG9wdGlvbnMpXG5cbiAgICBjb25zdCB7cmVxdWVzdENvbnRleHR9ID0gZnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc1BheWxvYWQodGhpcywgb3B0aW9ucylcbiAgICBjb25zdCBzdWIgPSBlbnN1cmVGcm9udGVuZE1vZGVsRXZlbnRTdWJzY3JpcHRpb24odGhpcywgZnJvbnRlbmRNb2RlbEV2ZW50UmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQpKVxuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrfVxuXG4gICAgcmV0dXJuIGF3YWl0IHN1Yi5yZWdpc3RlckNsYXNzQ2FsbGJhY2soc3ViLmNsYXNzRGVzdHJveUNhbGxiYWNrcywgZW50cnkpXG4gIH1cblxuICAvKipcbiAgICogSW5zdGFuY2UtbGV2ZWwgaG9vayBmaXJlZCB3aGVuIFRISVMgcmVjb3JkIGlzIHVwZGF0ZWQuIFRoZVxuICAgKiBpbnN0YW5jZSdzIGF0dHJpYnV0ZXMgYXJlIGF1dG8tbWVyZ2VkIHdpdGggdGhlIGJyb2FkY2FzdCBwYXlsb2FkXG4gICAqIGJlZm9yZSB0aGUgY2FsbGJhY2sgcnVucywgc28gY2FsbGVycyBjYW4gcmVhZCBmcmVzaCB2YWx1ZXMgdmlhXG4gICAqIGB0aGlzLnNvbWVBdHRyKClgIHdpdGhvdXQgcmUtZmV0Y2hpbmcuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWUsIG1vZGVsOiBGcm9udGVuZE1vZGVsQmFzZX0pID0+IHZvaWR9IGNhbGxiYWNrIC0gRXZlbnQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9xdWVyeS5qc1wiKS5Gcm9udGVuZE1vZGVsRXZlbnRPcHRpb25zfSBbb3B0aW9uc10gLSBFdmVudCBxdWVyeSBvciByZWNvcmQgcHJvamVjdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTwoKSA9PiB2b2lkPn0gLSBVbnN1YnNjcmliZSBjYWxsYmFjay5cbiAgICovXG4gIGFzeW5jIG9uVXBkYXRlKGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0LCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKE1vZGVsQ2xhc3MsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBpZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrLCAuLi5ldmVudE9wdGlvbnNQYXlsb2FkfVxuICAgIGNvbnN0IGxpc3RlbmVyID0gZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIoc3ViLCBpZCwgdGhpcylcblxuICAgIGxpc3RlbmVyLnVwZGF0ZUNhbGxiYWNrcy5hZGQoZW50cnkpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3ViLmVuc3VyZVN1YnNjcmliZWQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgKGN1cnJlbnQpID0+IGN1cnJlbnQudXBkYXRlQ2FsbGJhY2tzLmRlbGV0ZShlbnRyeSkpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICByZW1vdmVGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lckVudHJ5KHN1YiwgKGN1cnJlbnQpID0+IGN1cnJlbnQudXBkYXRlQ2FsbGJhY2tzLmRlbGV0ZShlbnRyeSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbmNlLWxldmVsIGhvb2sgZmlyZWQgd2hlbiBUSElTIHJlY29yZCBpcyBkZXN0cm95ZWQuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHtpZDogc3RyaW5nIHwgaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuQ29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5VmFsdWV9KSA9PiB2b2lkfSBjYWxsYmFjayAtIEV2ZW50IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcXVlcnkuanNcIikuRnJvbnRlbmRNb2RlbEV2ZW50T3B0aW9uc30gW29wdGlvbnNdIC0gQWNjZXB0ZWQgZm9yIEFQSSBzeW1tZXRyeTsgZGVzdHJveSBldmVudHMgY2FycnkgaWRzIG9ubHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPCgpID0+IHZvaWQ+fSAtIFVuc3Vic2NyaWJlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgb25EZXN0cm95KGNhbGxiYWNrLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG5cbiAgICBhc3NlcnROb0Rlc3Ryb3lFdmVudEZpbHRlcihNb2RlbENsYXNzLCBvcHRpb25zKVxuXG4gICAgY29uc3Qge3JlcXVlc3RDb250ZXh0fSA9IGZyb250ZW5kTW9kZWxFdmVudE9wdGlvbnNQYXlsb2FkKE1vZGVsQ2xhc3MsIG9wdGlvbnMpXG4gICAgY29uc3Qgc3ViID0gZW5zdXJlRnJvbnRlbmRNb2RlbEV2ZW50U3Vic2NyaXB0aW9uKE1vZGVsQ2xhc3MsIGZyb250ZW5kTW9kZWxFdmVudFJlcXVlc3RDb250ZXh0KHJlcXVlc3RDb250ZXh0KSlcbiAgICBjb25zdCBpZCA9IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIGNvbnN0IGVudHJ5ID0ge2NhbGxiYWNrfVxuICAgIGNvbnN0IGxpc3RlbmVyID0gZW5zdXJlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXIoc3ViLCBpZCwgdGhpcylcblxuICAgIGxpc3RlbmVyLmRlc3Ryb3lDYWxsYmFja3MuYWRkKGVudHJ5KVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN1Yi5lbnN1cmVTdWJzY3JpYmVkKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmVtb3ZlRnJvbnRlbmRNb2RlbEluc3RhbmNlTGlzdGVuZXJFbnRyeShzdWIsIChjdXJyZW50KSA9PiBjdXJyZW50LmRlc3Ryb3lDYWxsYmFja3MuZGVsZXRlKGVudHJ5KSlcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIHJlbW92ZUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVyRW50cnkoc3ViLCAoY3VycmVudCkgPT4gY3VycmVudC5kZXN0cm95Q2FsbGJhY2tzLmRlbGV0ZShlbnRyeSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGx1Y2suXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0gey4uLihzdHJpbmcgfCBzdHJpbmdbXSB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4pfSBjb2x1bW5zIC0gUGx1Y2sgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBQbHVja2VkIHZhbHVlcy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBwbHVjayguLi5jb2x1bW5zKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucXVlcnkoKS5wbHVjayguLi5jb2x1bW5zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VhcmNoLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uIC0gQ29sdW1uIG9yIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge1wiZXFcIiB8IFwibGlrZVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwiPlwiIHwgXCI+PVwiIHwgXCI8XCIgfCBcIjw9XCJ9IG9wZXJhdG9yIC0gU2VhcmNoIG9wZXJhdG9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFNlYXJjaCB2YWx1ZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggc2VhcmNoIGZpbHRlci5cbiAgICovXG4gIHN0YXRpYyBzZWFyY2gocGF0aCwgY29sdW1uLCBvcGVyYXRvciwgdmFsdWUpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLnNlYXJjaChwYXRoLCBjb2x1bW4sIG9wZXJhdG9yLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJhbnNhY2suXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmFuc2Fjay1zdHlsZSBwYXJhbXMgaGFzaC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggUmFuc2FjayBmaWx0ZXJzIGFwcGxpZWQuXG4gICAqL1xuICBzdGF0aWMgcmFuc2FjayhwYXJhbXMpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLnJhbnNhY2socGFyYW1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc29ydC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBzdHJpbmdbXVtdIHwgW3N0cmluZywgc3RyaW5nXSB8IEFycmF5PFtzdHJpbmcsIHN0cmluZ10+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gc29ydCAtIFNvcnQgZGVmaW5pdGlvbihzKS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyIHdpdGggc29ydCBkZWZpbml0aW9ucy5cbiAgICovXG4gIHN0YXRpYyBzb3J0KHNvcnQpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLnNvcnQoc29ydClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9yZGVyLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHN0cmluZ1tdW10gfCBbc3RyaW5nLCBzdHJpbmddIHwgQXJyYXk8W3N0cmluZywgc3RyaW5nXT4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBzb3J0IC0gU29ydCBkZWZpbml0aW9uKHMpLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5PFQ+fSAtIFF1ZXJ5IGJ1aWxkZXIgd2l0aCBzb3J0IGRlZmluaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIG9yZGVyKHNvcnQpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeSgpLm9yZGVyKHNvcnQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBncm91cC5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBncm91cCAtIEdyb3VwIGRlZmluaXRpb24ocykuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlciB3aXRoIGdyb3VwIGRlZmluaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIGdyb3VwKGdyb3VwKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5ncm91cChncm91cClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRpc3RpbmN0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtib29sZWFufSBbdmFsdWVdIC0gV2hldGhlciB0byByZXF1ZXN0IGRpc3RpbmN0IHJvd3MuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgYnVpbGRlciB3aXRoIGRpc3RpbmN0IGZsYWcuXG4gICAqL1xuICBzdGF0aWMgZGlzdGluY3QodmFsdWUgPSB0cnVlKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnkoKS5kaXN0aW5jdCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHF1ZXJ5LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSBidWlsZGVyLlxuICAgKi9cbiAgc3RhdGljIHF1ZXJ5KCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gKi8gKG5ldyBGcm9udGVuZE1vZGVsUXVlcnkoe21vZGVsQ2xhc3M6IHRoaXN9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByZWxvYWQuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBzdHJpbmcgfCBBcnJheTxzdHJpbmcgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkPn0gcHJlbG9hZCAtIFByZWxvYWQgZ3JhcGguXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgd2l0aCBwcmVsb2FkLlxuICAgKi9cbiAgc3RhdGljIHByZWxvYWQocHJlbG9hZCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gKi8gKHRoaXMucXVlcnkoKS5wcmVsb2FkKHByZWxvYWQpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VsZWN0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXSB8IHN0cmluZz4gfCBzdHJpbmcgfCBzdHJpbmdbXX0gc2VsZWN0IC0gTW9kZWwtYXdhcmUgYXR0cmlidXRlIHNlbGVjdCBtYXAgb3Igcm9vdC1tb2RlbCBzaG9ydGhhbmQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59IC0gUXVlcnkgd2l0aCBzZWxlY3RlZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgc3RhdGljIHNlbGVjdChzZWxlY3QpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUXVlcnk8VD59ICovICh0aGlzLnF1ZXJ5KCkuc2VsZWN0KHNlbGVjdCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWxlY3RzIGV4dHJhLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXSB8IHN0cmluZz4gfCBzdHJpbmcgfCBzdHJpbmdbXX0gc2VsZWN0IC0gRXh0cmEgYXR0cmlidXRlcyB0byBsb2FkIGluIGFkZGl0aW9uIHRvIHRoZSBkZWZhdWx0cywga2V5ZWQgYnkgbW9kZWwgbmFtZSBvciByb290LW1vZGVsIHNob3J0aGFuZC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gLSBRdWVyeSB3aXRoIGV4dHJhIHNlbGVjdGVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzdGF0aWMgc2VsZWN0c0V4dHJhKHNlbGVjdCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxRdWVyeTxUPn0gKi8gKHRoaXMucXVlcnkoKS5zZWxlY3RzRXh0cmEoc2VsZWN0KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpcnN0LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+IHwgbnVsbD59IC0gRmlyc3QgbW9kZWwgb3IgbnVsbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaXJzdCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpcnN0KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxhc3QuXG4gICAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbENsYXNzfSBUXG4gICAqIEB0aGlzIHtUfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4gfCBudWxsPn0gLSBMYXN0IG1vZGVsIG9yIG51bGwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgbGFzdCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmxhc3QoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvciBpbml0aWFsaXplIGJ5LlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gVFxuICAgKiBAdGhpcyB7VH1cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbmRpdGlvbnMgLSBBdHRyaWJ1dGUgbWF0Y2ggY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPFQ+Pn0gLSBFeGlzdGluZyBvciBpbml0aWFsaXplZCBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnF1ZXJ5KCkuZmluZE9ySW5pdGlhbGl6ZUJ5KGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG9yIGNyZWF0ZSBieS5cbiAgICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsQ2xhc3N9IFRcbiAgICogQHRoaXMge1R9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gQXR0cmlidXRlIG1hdGNoIGNvbmRpdGlvbnMuXG4gICAqIEBwYXJhbSB7KG1vZGVsOiBJbnN0YW5jZVR5cGU8VD4pID0+IFByb21pc2U8dm9pZD4gfCB2b2lkfSBbY2FsbGJhY2tdIC0gT3B0aW9uYWwgY2FsbGJhY2sgYmVmb3JlIHNhdmUgd2hlbiBjcmVhdGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8VD4+fSAtIEV4aXN0aW5nIG9yIG5ld2x5IGNyZWF0ZWQgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZE9yQ3JlYXRlQnkoY29uZGl0aW9ucywgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5xdWVyeSgpLmZpbmRPckNyZWF0ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlLlxuICAgKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzc1xuICAgKiBAdGhpcyB7TW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ3JlYXRlQXR0cmlidXRlc0ZvcjxJbnN0YW5jZVR5cGU8TW9kZWxDbGFzcz4+fSBbYXR0cmlidXRlc10gLSBJbml0aWFsIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNb2RlbENsYXNzPj59IC0gUGVyc2lzdGVkIG1vZGVsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNyZWF0ZShhdHRyaWJ1dGVzKSB7XG4gICAgY29uc3QgcmVjZWl2ZXIgPSAvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzKVxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge25ldyAoYXR0cmlidXRlcz86IEZyb250ZW5kTW9kZWxDcmVhdGVBdHRyaWJ1dGVzRm9yPEluc3RhbmNlVHlwZTxNb2RlbENsYXNzPj4pID0+IEluc3RhbmNlVHlwZTxNb2RlbENsYXNzPn0gKi8gKHJlY2VpdmVyKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoYXR0cmlidXRlcylcblxuICAgIGF3YWl0IG1vZGVsLnNhdmUoKVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhc3NlcnQgZmluZCBieSBjb25kaXRpb25zLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIGZpbmRCeSBjb25kaXRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhc3NlcnRGaW5kQnlDb25kaXRpb25zKGNvbmRpdGlvbnMpIHtcbiAgICBhc3NlcnRGaW5kQnlDb25kaXRpb25zU2hhcGUoY29uZGl0aW9ucylcblxuICAgIE9iamVjdC5rZXlzKGNvbmRpdGlvbnMpLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgYXNzZXJ0RGVmaW5lZEZpbmRCeUNvbmRpdGlvblZhbHVlKGNvbmRpdGlvbnNba2V5XSwga2V5KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtYXRjaGVzIGZpbmQgYnkgY29uZGl0aW9ucy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZX0gbW9kZWwgLSBDYW5kaWRhdGUgbW9kZWwuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb25kaXRpb25zIC0gTWF0Y2ggY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgbW9kZWwgbWF0Y2hlcyBhbGwgY29uZGl0aW9ucy5cbiAgICovXG4gIHN0YXRpYyBtYXRjaGVzRmluZEJ5Q29uZGl0aW9ucyhtb2RlbCwgY29uZGl0aW9ucykge1xuICAgIGNvbnN0IG1vZGVsQXR0cmlidXRlcyA9IG1vZGVsLmF0dHJpYnV0ZXMoKVxuXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoY29uZGl0aW9ucykpIHtcbiAgICAgIGNvbnN0IGV4cGVjdGVkVmFsdWUgPSBjb25kaXRpb25zW2tleV1cbiAgICAgIGNvbnN0IGFjdHVhbFZhbHVlID0gbW9kZWxBdHRyaWJ1dGVzW2tleV1cblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZXhwZWN0ZWRWYWx1ZSkpIHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoYWN0dWFsVmFsdWUpKSB7XG4gICAgICAgICAgaWYgKCF0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICghZXhwZWN0ZWRWYWx1ZS5zb21lKChlbnRyeSkgPT4gdGhpcy5maW5kQnlDb25kaXRpb25WYWx1ZU1hdGNoZXMoYWN0dWFsVmFsdWUsIGVudHJ5KSkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICghdGhpcy5maW5kQnlDb25kaXRpb25WYWx1ZU1hdGNoZXMoYWN0dWFsVmFsdWUsIGV4cGVjdGVkVmFsdWUpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5IGNvbmRpdGlvbiB2YWx1ZSBtYXRjaGVzLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhY3R1YWxWYWx1ZSAtIEFjdHVhbCBtb2RlbCB2YWx1ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXhwZWN0ZWRWYWx1ZSAtIEV4cGVjdGVkIGZpbmQgY29uZGl0aW9uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHZhbHVlcyBtYXRjaC5cbiAgICovXG4gIHN0YXRpYyBmaW5kQnlDb25kaXRpb25WYWx1ZU1hdGNoZXMoYWN0dWFsVmFsdWUsIGV4cGVjdGVkVmFsdWUpIHtcbiAgICBpZiAoZXhwZWN0ZWRWYWx1ZSA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuIGFjdHVhbFZhbHVlID09PSBudWxsXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZXhwZWN0ZWRWYWx1ZSkpIHtcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheShhY3R1YWxWYWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG5cbiAgICAgIGlmIChhY3R1YWxWYWx1ZS5sZW5ndGggIT09IGV4cGVjdGVkVmFsdWUubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuXG4gICAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgZXhwZWN0ZWRWYWx1ZS5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgICAgaWYgKCF0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxWYWx1ZVtpbmRleF0sIGV4cGVjdGVkVmFsdWVbaW5kZXhdKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgaWYgKGV4cGVjdGVkVmFsdWUgJiYgdHlwZW9mIGV4cGVjdGVkVmFsdWUgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGlmICghYWN0dWFsVmFsdWUgfHwgdHlwZW9mIGFjdHVhbFZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoYWN0dWFsVmFsdWUpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhY3R1YWxPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGFjdHVhbFZhbHVlKVxuICAgICAgY29uc3QgZXhwZWN0ZWRPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGV4cGVjdGVkVmFsdWUpXG4gICAgICBjb25zdCBhY3R1YWxLZXlzID0gT2JqZWN0LmtleXMoYWN0dWFsT2JqZWN0KVxuICAgICAgY29uc3QgZXhwZWN0ZWRLZXlzID0gT2JqZWN0LmtleXMoZXhwZWN0ZWRPYmplY3QpXG5cbiAgICAgIGlmIChhY3R1YWxLZXlzLmxlbmd0aCAhPT0gZXhwZWN0ZWRLZXlzLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBrZXkgb2YgZXhwZWN0ZWRLZXlzKSB7XG4gICAgICAgIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGFjdHVhbE9iamVjdCwga2V5KSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLmZpbmRCeUNvbmRpdGlvblZhbHVlTWF0Y2hlcyhhY3R1YWxPYmplY3Rba2V5XSwgZXhwZWN0ZWRPYmplY3Rba2V5XSkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIGlmIChhY3R1YWxWYWx1ZSA9PT0gZXhwZWN0ZWRWYWx1ZSkge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5maW5kQnlQcmltaXRpdmVWYWx1ZXNNYXRjaChhY3R1YWxWYWx1ZSwgZXhwZWN0ZWRWYWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgcHJpbWl0aXZlIHZhbHVlcyBtYXRjaC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYWN0dWFsVmFsdWUgLSBBY3R1YWwgbW9kZWwgdmFsdWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGV4cGVjdGVkVmFsdWUgLSBFeHBlY3RlZCBmaW5kIGNvbmRpdGlvbiB2YWx1ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBwcmltaXRpdmUgdmFsdWVzIG1hdGNoIGFmdGVyIHNhZmUgY29lcmNpb24uXG4gICAqL1xuICBzdGF0aWMgZmluZEJ5UHJpbWl0aXZlVmFsdWVzTWF0Y2goYWN0dWFsVmFsdWUsIGV4cGVjdGVkVmFsdWUpIHtcbiAgICBpZiAoYWN0dWFsVmFsdWUgaW5zdGFuY2VvZiBEYXRlICYmIHR5cGVvZiBleHBlY3RlZFZhbHVlID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkRXhwZWN0ZWRWYWx1ZSA9IG5vcm1hbGl6ZURhdGVTdHJpbmdGb3JXcml0ZShleHBlY3RlZFZhbHVlLCB7dGltZVpvbmU6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpfSlcblxuICAgICAgaWYgKG5vcm1hbGl6ZWRFeHBlY3RlZFZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgICByZXR1cm4gYWN0dWFsVmFsdWUudG9JU09TdHJpbmcoKSA9PT0gbm9ybWFsaXplZEV4cGVjdGVkVmFsdWUudG9JU09TdHJpbmcoKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYWN0dWFsVmFsdWUudG9JU09TdHJpbmcoKSA9PT0gZXhwZWN0ZWRWYWx1ZVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgYWN0dWFsVmFsdWUgPT09IFwic3RyaW5nXCIgJiYgZXhwZWN0ZWRWYWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgIHJldHVybiBhY3R1YWxWYWx1ZSA9PT0gZXhwZWN0ZWRWYWx1ZS50b0lTT1N0cmluZygpXG4gICAgfVxuXG4gICAgaWYgKGFjdHVhbFZhbHVlIGluc3RhbmNlb2YgRGF0ZSAmJiBleHBlY3RlZFZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgcmV0dXJuIGFjdHVhbFZhbHVlLnRvSVNPU3RyaW5nKCkgPT09IGV4cGVjdGVkVmFsdWUudG9JU09TdHJpbmcoKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgYWN0dWFsVmFsdWUgPT09IFwibnVtYmVyXCIgJiYgdHlwZW9mIGV4cGVjdGVkVmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLmZpbmRCeU51bWVyaWNTdHJpbmdNYXRjaGVzTnVtYmVyKGV4cGVjdGVkVmFsdWUsIGFjdHVhbFZhbHVlKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgYWN0dWFsVmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIGV4cGVjdGVkVmFsdWUgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLmZpbmRCeU51bWVyaWNTdHJpbmdNYXRjaGVzTnVtYmVyKGFjdHVhbFZhbHVlLCBleHBlY3RlZFZhbHVlKVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieSBudW1lcmljIHN0cmluZyBtYXRjaGVzIG51bWJlci5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtzdHJpbmd9IG51bWVyaWNTdHJpbmcgLSBOdW1lcmljIHN0cmluZyB2YWx1ZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGV4cGVjdGVkTnVtYmVyIC0gTnVtYmVyIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHZhbHVlcyByZXByZXNlbnQgdGhlIHNhbWUgbnVtYmVyLlxuICAgKi9cbiAgc3RhdGljIGZpbmRCeU51bWVyaWNTdHJpbmdNYXRjaGVzTnVtYmVyKG51bWVyaWNTdHJpbmcsIGV4cGVjdGVkTnVtYmVyKSB7XG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoZXhwZWN0ZWROdW1iZXIpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICBpZiAoIS9eLT9cXGQrKD86XFwuXFxkKyk/JC8udGVzdChudW1lcmljU3RyaW5nKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgcmV0dXJuIE51bWJlcihudW1lcmljU3RyaW5nKSA9PT0gZXhwZWN0ZWROdW1iZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtVcGRhdGVBdHRyaWJ1dGVzfSBbbmV3QXR0cmlidXRlc10gLSBOZXcgdmFsdWVzIHRvIGFzc2lnbiBiZWZvcmUgdXBkYXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0aGlzPn0gLSBVcGRhdGVkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgdXBkYXRlKG5ld0F0dHJpYnV0ZXMpIHtcbiAgICBpZiAobmV3QXR0cmlidXRlcykgdGhpcy5hc3NpZ25BdHRyaWJ1dGVzKG5ld0F0dHJpYnV0ZXMpXG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHt0aGlzfSAqLyAoYXdhaXQgdGhpcy5zYXZlKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdHRhY2guXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGF0dGFjaG1lbnRJbnB1dCAtIEF0dGFjaG1lbnQgaW5wdXQgb3IgbmFtZWQgYXR0YWNobWVudCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGF0dGFjaGVkLlxuICAgKi9cbiAgYXN5bmMgYXR0YWNoKGF0dGFjaG1lbnRJbnB1dCkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbnMgPSBNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9ucygpXG4gICAgY29uc3QgYXR0YWNobWVudE5hbWVzID0gT2JqZWN0LmtleXMoYXR0YWNobWVudERlZmluaXRpb25zKVxuICAgIGxldCBhdHRhY2htZW50TmFtZSA9IGF0dGFjaG1lbnROYW1lc1swXVxuICAgIGxldCBhY3R1YWxBdHRhY2htZW50SW5wdXQgPSBhdHRhY2htZW50SW5wdXRcblxuICAgIGlmIChmcm9udGVuZEF0dGFjaG1lbnRWYWx1ZUlzUGxhaW5PYmplY3QoYXR0YWNobWVudElucHV0KSkge1xuICAgICAgaWYgKFwiZmlsZVwiIGluIGF0dGFjaG1lbnRJbnB1dCAmJiBhdHRhY2htZW50RGVmaW5pdGlvbnMuZmlsZSkge1xuICAgICAgICBhdHRhY2htZW50TmFtZSA9IFwiZmlsZVwiXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgY2FuZGlkYXRlTmFtZSBvZiBhdHRhY2htZW50TmFtZXMpIHtcbiAgICAgICAgaWYgKGNhbmRpZGF0ZU5hbWUgaW4gYXR0YWNobWVudElucHV0KSB7XG4gICAgICAgICAgYXR0YWNobWVudE5hbWUgPSBjYW5kaWRhdGVOYW1lXG4gICAgICAgICAgYWN0dWFsQXR0YWNobWVudElucHV0ID0gYXR0YWNobWVudElucHV0W2NhbmRpZGF0ZU5hbWVdXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghYXR0YWNobWVudE5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gYXR0YWNobWVudCBkZWZpbml0aW9ucyBvbiAke01vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSkuYXR0YWNoKGFjdHVhbEF0dGFjaG1lbnRJbnB1dClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNhdmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHRoaXM+fSAtIFNhdmVkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgc2F2ZSgpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbENsYXNzRm9yKHRoaXMpXG4gICAgY29uc3QgaXNOZXcgPSB0aGlzLmlzTmV3UmVjb3JkKClcbiAgICBjb25zdCBwcmV2aW91c0lkZW50aXR5ID0gaXNOZXcgPyBudWxsIDogdGhpcy5wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKVxuICAgIGNvbnN0IGNvbW1hbmRUeXBlID0gaXNOZXcgPyBcImNyZWF0ZVwiIDogXCJ1cGRhdGVcIlxuICAgIC8qKlxuICAgICAqIFBheWxvYWQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgYXR0cmlidXRlczogdGhpcy5fY2hhbmdlZEF0dHJpYnV0ZXNGb3JTYXZlKClcbiAgICB9XG5cbiAgICBpZiAoIWlzTmV3KSB7XG4gICAgICBwYXlsb2FkLmlkID0gdGhpcy5wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKVxuICAgIH1cblxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLl9idWlsZE5lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkKClcblxuICAgIGlmIChuZXN0ZWRBdHRyaWJ1dGVzICYmIE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgIHBheWxvYWQubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcbiAgICB9XG5cbiAgICBjb25zdCBhdHRhY2htZW50cyA9IGF3YWl0IHRoaXMuX2J1aWxkQXR0YWNobWVudHNQYXlsb2FkKClcblxuICAgIGlmIChPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkge1xuICAgICAgcGF5bG9hZC5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgfVxuXG4gICAgaWYgKHNob3VsZFF1ZXVlRnJvbnRlbmRNb2RlbE9wZXJhdGlvbk9mZmxpbmUoTW9kZWxDbGFzcywgY29tbWFuZFR5cGUpKSB7XG4gICAgICBjb25zdCBvZmZsaW5lQXR0cmlidXRlcyA9IHsuLi5wYXlsb2FkLmF0dHJpYnV0ZXN9XG4gICAgICBsZXQgY2xpZW50TXV0YXRpb25JZFxuXG4gICAgICBpZiAoaXNOZXcpIHtcbiAgICAgICAgY29uc3QgcHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgYE9mZmxpbmUgY3JlYXRlIGZvciAke01vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgICBjb25zdCBjdXJyZW50UHJpbWFyeUtleSA9IHRoaXMucmVhZEF0dHJpYnV0ZShwcmltYXJ5S2V5KVxuXG4gICAgICAgIGlmIChjdXJyZW50UHJpbWFyeUtleSA9PT0gdW5kZWZpbmVkIHx8IGN1cnJlbnRQcmltYXJ5S2V5ID09PSBudWxsKSB7XG4gICAgICAgICAgY2xpZW50TXV0YXRpb25JZCA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRDb25maWcub2ZmbGluZVN5bmM/LmNsaWVudE11dGF0aW9uSWRcbiAgICAgICAgICAgID8gZnJvbnRlbmRNb2RlbFRyYW5zcG9ydENvbmZpZy5vZmZsaW5lU3luYy5jbGllbnRNdXRhdGlvbklkKClcbiAgICAgICAgICAgIDogZnJvbnRlbmRNb2RlbE9mZmxpbmVNdXRhdGlvbklkKClcbiAgICAgICAgICB0aGlzLnNldEF0dHJpYnV0ZShwcmltYXJ5S2V5LCBjbGllbnRNdXRhdGlvbklkKVxuICAgICAgICAgIG9mZmxpbmVBdHRyaWJ1dGVzW3ByaW1hcnlLZXldID0gY2xpZW50TXV0YXRpb25JZFxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgT2ZmbGluZSB1cGRhdGUgZm9yICR7TW9kZWxDbGFzcy5uYW1lfWApXG5cbiAgICAgICAgb2ZmbGluZUF0dHJpYnV0ZXNbcHJpbWFyeUtleV0gPSBwYXlsb2FkLmlkXG4gICAgICB9XG5cbiAgICAgIGlmIChwYXlsb2FkLm5lc3RlZEF0dHJpYnV0ZXMgIT09IHVuZGVmaW5lZCB8fCBwYXlsb2FkLmF0dGFjaG1lbnRzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBPZmZsaW5lIHN5bmMgZm9yICR7TW9kZWxDbGFzcy5uYW1lfSBkb2VzIG5vdCBzdXBwb3J0IG5lc3RlZCBhdHRyaWJ1dGVzIG9yIGF0dGFjaG1lbnRzIHlldGApXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHF1ZXVlRnJvbnRlbmRNb2RlbE11dGF0aW9uT2ZmbGluZSh7XG4gICAgICAgIGF0dHJpYnV0ZXM6IG9mZmxpbmVBdHRyaWJ1dGVzLFxuICAgICAgICBjbGllbnRNdXRhdGlvbklkLFxuICAgICAgICBNb2RlbENsYXNzLFxuICAgICAgICBvcGVyYXRpb246IGNvbW1hbmRUeXBlXG4gICAgICB9KVxuICAgICAgdGhpcy5zZXRJc05ld1JlY29yZChmYWxzZSlcbiAgICAgIHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXMgPSBjbG9uZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKHRoaXMuYXR0cmlidXRlcygpKVxuICAgICAgdGhpcy5fcGVuZGluZ05lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuICAgICAgdGhpcy5fY2xlYXJQZW5kaW5nQXR0YWNobWVudHMoKVxuXG4gICAgICByZXR1cm4gdGhpc1xuICAgIH1cblxuICAgIGNvbnN0IHJlbW92ZVRlbXBvcmFyeUxpc3RlbmVyQWxpYXNlcyA9IHByZXZpb3VzSWRlbnRpdHkgPT09IG51bGxcbiAgICAgID8gKCkgPT4ge31cbiAgICAgIDogYWxpYXNGcm9udGVuZE1vZGVsSW5zdGFuY2VMaXN0ZW5lcnMoTW9kZWxDbGFzcywgdGhpcywgcHJldmlvdXNJZGVudGl0eSwgdGhpcy5wcmltYXJ5S2V5VmFsdWUoKSlcbiAgICBsZXQgcmVzcG9uc2VcblxuICAgIHRyeSB7XG4gICAgICByZXNwb25zZSA9IGF3YWl0IE1vZGVsQ2xhc3MuZXhlY3V0ZUNvbW1hbmQoY29tbWFuZFR5cGUsIHBheWxvYWQpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJlbW92ZVRlbXBvcmFyeUxpc3RlbmVyQWxpYXNlcygpXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cblxuICAgIHJlbW92ZVRlbXBvcmFyeUxpc3RlbmVyQWxpYXNlcygpXG5cbiAgICBjb25zdCBtb2RlbERhdGEgPSBNb2RlbENsYXNzLm1vZGVsRGF0YUZyb21SZXNwb25zZShyZXNwb25zZSlcblxuICAgIHRoaXMuYXNzaWduQXR0cmlidXRlcyhtb2RlbERhdGEuYXR0cmlidXRlcylcbiAgICB0aGlzLl9hdHRhY2htZW50T3duZXIgPSBtb2RlbERhdGEuYXR0YWNobWVudE93bmVyXG4gICAgdGhpcy5zZXRJc05ld1JlY29yZChmYWxzZSlcblxuICAgIGlmIChwcmV2aW91c0lkZW50aXR5ICE9PSBudWxsKSB7XG4gICAgICByZWtleUZyb250ZW5kTW9kZWxJbnN0YW5jZUxpc3RlbmVycyhNb2RlbENsYXNzLCB0aGlzLCBwcmV2aW91c0lkZW50aXR5LCB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpKVxuICAgIH1cblxuICAgIHRoaXMuX3BlcnNpc3RlZEF0dHJpYnV0ZXMgPSBjbG9uZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKHRoaXMuYXR0cmlidXRlcygpKVxuICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICB0aGlzLl9jbGVhclBlbmRpbmdBdHRhY2htZW50cygpXG5cbiAgICB0aGlzLl9yZWNvbmNpbGVOZXN0ZWRBdHRyaWJ1dGVzRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBzdWJzZXQgb2YgYF9hdHRyaWJ1dGVzYCB3aG9zZSB2YWx1ZSBoYXMgZGl2ZXJnZWQgZnJvbVxuICAgKiBgX3BlcnNpc3RlZEF0dHJpYnV0ZXNgLiBVc2VkIGJ5IGBzYXZlKClgIHNvIHRoZSBzZXJ2ZXIgcmVjZWl2ZXMgb25seSB0aGVcbiAgICogZmllbGRzIHRoZSBjYWxsZXIgYWN0dWFsbHkgY2hhbmdlZCDigJQgYXZvaWRpbmcgc3RyaWN0IHBlcm1pdCByZWplY3Rpb25zIG9uXG4gICAqIGZyYW1ld29yay1tYW5hZ2VkIGZpZWxkcyBsaWtlIGBpZGAsIGBjcmVhdGVkQXRgLCBgdXBkYXRlZEF0YCwgb3Igb3duZXJcbiAgICogZm9yZWlnbiBrZXlzIHRoYXQgdGhlIHJlc291cmNlIG5ldmVyIGxpc3RzIGluIGBwZXJtaXR0ZWRQYXJhbXNgLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gLSBDaGFuZ2VkIGF0dHJpYnV0ZXMgaGFzaC5cbiAgICovXG4gIF9jaGFuZ2VkQXR0cmlidXRlc0ZvclNhdmUoKSB7XG4gICAgLyoqXG4gICAgICogQ2hhbmdlZCBhdHRyaWJ1dGVzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsQXR0cmlidXRlVmFsdWU+fSAqL1xuICAgIGNvbnN0IGNoYW5nZWRBdHRyaWJ1dGVzID0ge31cblxuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIFtwcmV2aW91c1ZhbHVlLCBjdXJyZW50VmFsdWVdXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmNoYW5nZXMoKSkpIHtcbiAgICAgIGlmICh0aGlzLmlzTmV3UmVjb3JkKCkgJiYgcHJldmlvdXNWYWx1ZSA9PT0gdW5kZWZpbmVkICYmIGN1cnJlbnRWYWx1ZSA9PT0gbnVsbCkgY29udGludWVcblxuICAgICAgY2hhbmdlZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBjdXJyZW50VmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gY2hhbmdlZEF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXJrcyB0aGUgY3VycmVudCB2YWx1ZSBmb3IgYW4gYXR0cmlidXRlIGFzIGFscmVhZHkgcGVyc2lzdGVkIHNvIHRoZSBuZXh0XG4gICAqIHNhdmUgZG9lcyBub3Qgc2VuZCBpdCB1bmxlc3MgdGhlIGNhbGxlciBjaGFuZ2VzIGl0IGFnYWluLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSB0byBtYXJrIHVuY2hhbmdlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBtYXJrQXR0cmlidXRlVW5jaGFuZ2VkKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICB0aGlzLl9wZXJzaXN0ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gY2xvbmVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyh7dmFsdWU6IHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV19KS52YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVzdHJveS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBkZXN0cm95ZWQgb24gYmFja2VuZC5cbiAgICovXG4gIGFzeW5jIGRlc3Ryb3koKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IGlkID0gdGhpcy5pc05ld1JlY29yZCgpID8gdGhpcy5wcmltYXJ5S2V5VmFsdWUoKSA6IHRoaXMucGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKClcblxuICAgIGlmIChzaG91bGRRdWV1ZUZyb250ZW5kTW9kZWxPcGVyYXRpb25PZmZsaW5lKE1vZGVsQ2xhc3MsIFwiZGVzdHJveVwiKSkge1xuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgYE9mZmxpbmUgZGVzdHJveSBmb3IgJHtNb2RlbENsYXNzLm5hbWV9YClcblxuICAgICAgYXdhaXQgcXVldWVGcm9udGVuZE1vZGVsTXV0YXRpb25PZmZsaW5lKHtcbiAgICAgICAgYXR0cmlidXRlczoge1twcmltYXJ5S2V5XTogaWR9LFxuICAgICAgICBNb2RlbENsYXNzLFxuICAgICAgICBvcGVyYXRpb246IFwiZGVzdHJveVwiXG4gICAgICB9KVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCBNb2RlbENsYXNzLmV4ZWN1dGVDb21tYW5kKFwiZGVzdHJveVwiLCB7XG4gICAgICBpZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBhdHRhY2htZW50IHBheWxvYWQgcXVldWVkIG9uIHRoaXMgbW9kZWwgZm9yIHRoZSBuZXh0IHNhdmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IEF0dGFjaG1lbnQgcGF5bG9hZCBrZXllZCBieSBhdHRhY2htZW50IG5hbWUuXG4gICAqL1xuICBhc3luYyBfYnVpbGRBdHRhY2htZW50c1BheWxvYWQoKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcGF5bG9hZCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGF0dGFjaG1lbnROYW1lIG9mIE9iamVjdC5rZXlzKHRoaXMuX2F0dGFjaG1lbnRzKSkge1xuICAgICAgY29uc3QgYXR0YWNobWVudFBheWxvYWQgPSBhd2FpdCB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0ucGVuZGluZ0F0dGFjaG1lbnRzUGF5bG9hZCgpXG5cbiAgICAgIGlmIChhdHRhY2htZW50UGF5bG9hZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHBheWxvYWRbYXR0YWNobWVudE5hbWVdID0gYXR0YWNobWVudFBheWxvYWRcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqIENsZWFycyBxdWV1ZWQgYXR0YWNobWVudCBpbnB1dHMgYWZ0ZXIgYSBzdWNjZXNzZnVsIHNhdmUuICovXG4gIF9jbGVhclBlbmRpbmdBdHRhY2htZW50cygpIHtcbiAgICBmb3IgKGNvbnN0IGF0dGFjaG1lbnROYW1lIG9mIE9iamVjdC5rZXlzKHRoaXMuX2F0dGFjaG1lbnRzKSkge1xuICAgICAgdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdLmNsZWFyUGVuZGluZ0F0dGFjaG1lbnRzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogV2Fsa3MgcmVsYXRpb25zaGlwcyBkZWNsYXJlZCBpbiB0aGlzIHJlc291cmNlJ3MgYG5lc3RlZEF0dHJpYnV0ZXNgIGNvbmZpZ1xuICAgKiBhbmQgYnVpbGRzIHRoZSBwZXItcmVsYXRpb25zaGlwIHBheWxvYWQgb2YgZGlydHkgY2hpbGRyZW4gZm9yIGEgcGFyZW50IHNhdmUuXG4gICAqXG4gICAqIEluY2x1ZGVkIGNoaWxkcmVuOlxuICAgKiAgIC0gbmV3IHJlY29yZHMgKGlzTmV3UmVjb3JkKCkpIOKGkiBjcmVhdGUgZW50cnkgd2l0aCBhdHRyaWJ1dGVzXG4gICAqICAgLSByZWNvcmRzIG1hcmtlZCBmb3IgZGVzdHJ1Y3Rpb24gKG1hcmtlZEZvckRlc3RydWN0aW9uKCkpIOKGkiBkZXN0cm95IGVudHJ5XG4gICAqICAgLSByZWNvcmRzIHdpdGggY2hhbmdlZCBhdHRyaWJ1dGVzIChpc0NoYW5nZWQoKSkg4oaSIHVwZGF0ZSBlbnRyeSB3aXRoIGF0dHJpYnV0ZXNcbiAgICogICAtIHJlY29yZHMgd2l0aCBkaXJ0eSBkZXNjZW5kYW50cyBpbiB0aGVpciBvd24gbmVzdGVkQXR0cmlidXRlcyDihpIgcmVjdXJzZVxuICAgKlxuICAgKiBMb2FkZWQgYnV0IHVudG91Y2hlZCByZWNvcmRzIGFyZSBvbWl0dGVkIHNvIG5lc3RlZCBzYXZlIHByZXNlcnZlcyBSYWlscy1zdHlsZVxuICAgKiBcImNoaWxkcmVuIG5vdCByZWZlcmVuY2VkIGluIHBheWxvYWQgYXJlIGxlZnQgYWxvbmVcIiBzZW1hbnRpY3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+Pn0gLSBQZXItcmVsYXRpb25zaGlwIGxpc3Qgb2YgbmVzdGVkLWF0dHJpYnV0ZSBlbnRyaWVzLlxuICAgKi9cbiAgYXN5bmMgX2J1aWxkTmVzdGVkQXR0cmlidXRlc1BheWxvYWQoKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxDbGFzc0Zvcih0aGlzKVxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlnID0gTW9kZWxDbGFzcy5yZXNvdXJjZUNvbmZpZygpXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlc0NvbmZpZyA9IHJlc291cmNlQ29uZmlnPy5uZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICBpZiAoIW5lc3RlZEF0dHJpYnV0ZXNDb25maWcpIHJldHVybiB7fVxuXG4gICAgLyoqXG4gICAgICogUGF5bG9hZC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59ICovXG4gICAgY29uc3QgcGF5bG9hZCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlc0NvbmZpZykpIHtcbiAgICAgIC8qKiBAdHlwZSB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICAgIGNvbnN0IGVudHJpZXMgPSBbXVxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5fcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbEhhc01hbnlSZWxhdGlvbnNoaXAgJiYgQXJyYXkuaXNBcnJheShyZWxhdGlvbnNoaXAuX2xvYWRlZFZhbHVlKSkge1xuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIHJlbGF0aW9uc2hpcC5fbG9hZGVkVmFsdWUpIHtcbiAgICAgICAgICBjb25zdCBjaGlsZEVudHJ5ID0gYXdhaXQgY2hpbGQuX25lc3RlZEF0dHJpYnV0ZXNFbnRyeUZvclBhcmVudFNhdmUoKVxuXG4gICAgICAgICAgaWYgKGNoaWxkRW50cnkpIGVudHJpZXMucHVzaChjaGlsZEVudHJ5KVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uc2hpcCBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxTaW5ndWxhclJlbGF0aW9uc2hpcCAmJiByZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIHtcbiAgICAgICAgY29uc3QgY2hpbGQgPSByZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsQmFzZSkge1xuICAgICAgICAgIGNvbnN0IGNoaWxkRW50cnkgPSBhd2FpdCBjaGlsZC5fbmVzdGVkQXR0cmlidXRlc0VudHJ5Rm9yUGFyZW50U2F2ZSgpXG5cbiAgICAgICAgICBpZiAoY2hpbGRFbnRyeSkgZW50cmllcy5wdXNoKGNoaWxkRW50cnkpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLl9wZW5kaW5nTmVzdGVkQXR0cmlidXRlcywgcmVsYXRpb25zaGlwTmFtZSkpIHtcbiAgICAgICAgZW50cmllcy5wdXNoKFxuICAgICAgICAgIC4uLmF3YWl0IHRoaXMuX25lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoXG4gICAgICAgICAgICBNb2RlbENsYXNzLFxuICAgICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICAgIHRoaXMuX3BlbmRpbmdOZXN0ZWRBdHRyaWJ1dGVzW3JlbGF0aW9uc2hpcE5hbWVdXG4gICAgICAgICAgKVxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIGlmIChlbnRyaWVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcGF5bG9hZFtyZWxhdGlvbnNoaXBOYW1lXSA9IGVudHJpZXNcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgcGF5bG9hZCBlbnRyeSBmb3IgdGhpcyBjaGlsZCB3aGVuIHdhbGtlZCBieSBhIHBhcmVudCdzXG4gICAqIGBfYnVpbGROZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZGAuIFJldHVybnMgYG51bGxgIHdoZW4gdGhlIGNoaWxkIGhhcyBub1xuICAgKiBkaXJ0eSBzdGF0ZSBhbmQgbm8gZGlydHkgZGVzY2VuZGFudHMsIHNvIHRoZSBwYXJlbnQgY2FuIG9taXQgaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSAtIE5lc3RlZC1hdHRyaWJ1dGUgZW50cnkgb3IgbnVsbCBpZiBjbGVhbi5cbiAgICovXG4gIGFzeW5jIF9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlGb3JQYXJlbnRTYXZlKCkge1xuICAgIGlmICh0aGlzLm1hcmtlZEZvckRlc3RydWN0aW9uKCkpIHtcbiAgICAgIGlmICh0aGlzLmlzTmV3UmVjb3JkKCkpIHJldHVybiBudWxsXG4gICAgICByZXR1cm4ge2lkOiB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpLCBfZGVzdHJveTogdHJ1ZX1cbiAgICB9XG5cbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzID0gYXdhaXQgdGhpcy5fYnVpbGROZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZCgpXG4gICAgY29uc3QgaGFzTmVzdGVkRGlydHkgPSBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzKS5sZW5ndGggPiAwXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSBhd2FpdCB0aGlzLl9idWlsZEF0dGFjaG1lbnRzUGF5bG9hZCgpXG4gICAgY29uc3QgaGFzQXR0YWNobWVudHMgPSBPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMFxuXG4gICAgaWYgKHRoaXMuaXNOZXdSZWNvcmQoKSkge1xuICAgICAgLyoqXG4gICAgICAgKiBFbnRyeS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCBlbnRyeSA9IHt9XG4gICAgICBjb25zdCBhdHRyaWJ1dGVzID0gdGhpcy5fY2hhbmdlZEF0dHJpYnV0ZXNGb3JTYXZlKClcblxuICAgICAgaWYgKE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIGVudHJ5LmF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzXG4gICAgICBpZiAoaGFzQXR0YWNobWVudHMpIGVudHJ5LmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICAgIGlmIChoYXNOZXN0ZWREaXJ0eSkgZW50cnkubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcblxuICAgICAgcmV0dXJuIGVudHJ5XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLmlzQ2hhbmdlZCgpICYmICFoYXNOZXN0ZWREaXJ0eSAmJiAhaGFzQXR0YWNobWVudHMpIHJldHVybiBudWxsXG5cbiAgICAvKipcbiAgICAgKiBFbnRyeS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGVudHJ5ID0ge2lkOiB0aGlzLnByaW1hcnlLZXlWYWx1ZSgpfVxuXG4gICAgaWYgKHRoaXMuaXNDaGFuZ2VkKCkpIGVudHJ5LmF0dHJpYnV0ZXMgPSB0aGlzLl9jaGFuZ2VkQXR0cmlidXRlc0ZvclNhdmUoKVxuICAgIGlmIChoYXNBdHRhY2htZW50cykgZW50cnkuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgIGlmIChoYXNOZXN0ZWREaXJ0eSkgZW50cnkubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIHJldHVybiBlbnRyeVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBuZXN0ZWQgZW50cmllcyBmcm9tIGEgUmFpbHMtc3R5bGUgc3VibWl0dGVkIGAqQXR0cmlidXRlc2AgdmFsdWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gUGFyZW50IG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIE5lc3RlZCByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTdWJtaXR0ZWQgbmVzdGVkIGF0dHJpYnV0ZXMgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4+fSBOZXN0ZWQgZW50cmllcyBmb3IgdGhlIHRyYW5zcG9ydCBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgX25lc3RlZEF0dHJpYnV0ZXNQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoTW9kZWxDbGFzcywgcmVsYXRpb25zaGlwTmFtZSwgdmFsdWUpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBEZWZpbml0aW9uID0gTW9kZWxDbGFzcy5yZWxhdGlvbnNoaXBEZWZpbml0aW9uKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgY29uc3QgVGFyZ2V0TW9kZWxDbGFzcyA9IE1vZGVsQ2xhc3MucmVsYXRpb25zaGlwTW9kZWxDbGFzcyhyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXBEZWZpbml0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gbmVzdGVkIHJlbGF0aW9uc2hpcDogJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIVRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGNvbmZpZ3VyZWQgZm9yICR7TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAocmVsYXRpb25zaGlwVHlwZUlzQ29sbGVjdGlvbihyZWxhdGlvbnNoaXBEZWZpbml0aW9uLnR5cGUpKSB7XG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtNb2RlbENsYXNzLm5hbWV9IyR7cmVsYXRpb25zaGlwTmFtZX1BdHRyaWJ1dGVzIG11c3QgYmUgYW4gYXJyYXlgKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgIHZhbHVlLm1hcChhc3luYyAoZW50cnkpID0+IGF3YWl0IHRoaXMuX25lc3RlZEF0dHJpYnV0ZXNFbnRyeVBheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShUYXJnZXRNb2RlbENsYXNzLCBlbnRyeSkpXG4gICAgICApXG4gICAgfVxuXG4gICAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBbXVxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke01vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfUF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBvYmplY3RgKVxuICAgIH1cblxuICAgIHJldHVybiBbYXdhaXQgdGhpcy5fbmVzdGVkQXR0cmlidXRlc0VudHJ5UGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKFRhcmdldE1vZGVsQ2xhc3MsIHZhbHVlKV1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBvbmUgc3VibWl0dGVkIFJhaWxzLXN0eWxlIG5lc3RlZCBhdHRyaWJ1dGVzIG9iamVjdCBpbnRvIHRyYW5zcG9ydCBwYXlsb2FkIHNoYXBlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIE5lc3RlZCBjaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc3VibWl0dGVkRW50cnkgLSBTdWJtaXR0ZWQgbmVzdGVkIGF0dHJpYnV0ZXMgZW50cnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IFRyYW5zcG9ydCBuZXN0ZWQtYXR0cmlidXRlcyBlbnRyeS5cbiAgICovXG4gIGFzeW5jIF9uZXN0ZWRBdHRyaWJ1dGVzRW50cnlQYXlsb2FkRm9yU3VibWl0dGVkVmFsdWUoTW9kZWxDbGFzcywgc3VibWl0dGVkRW50cnkpIHtcbiAgICBpZiAoIWZyb250ZW5kQXR0YWNobWVudFZhbHVlSXNQbGFpbk9iamVjdChzdWJtaXR0ZWRFbnRyeSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtNb2RlbENsYXNzLm5hbWV9IG5lc3RlZCBhdHRyaWJ1dGVzIGVudHJpZXMgbXVzdCBiZSBvYmplY3RzYClcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBlbnRyeSA9IHt9XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHt9XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pj59ICovXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc3VibWl0dGVkRW50cnkpKSB7XG4gICAgICBpZiAoYXR0cmlidXRlTmFtZSA9PT0gXCJpZFwiIHx8IGF0dHJpYnV0ZU5hbWUgPT09IFwiX2Rlc3Ryb3lcIikge1xuICAgICAgICBlbnRyeVthdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5lc3RlZFJlbGF0aW9uc2hpcE5hbWUgPSBNb2RlbENsYXNzLm5lc3RlZEF0dHJpYnV0ZXNSZWxhdGlvbnNoaXBOYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGlmIChuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgICAgIG5lc3RlZEF0dHJpYnV0ZXNbbmVzdGVkUmVsYXRpb25zaGlwTmFtZV0gPSBhd2FpdCB0aGlzLl9uZXN0ZWRBdHRyaWJ1dGVzUGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKFxuICAgICAgICAgIE1vZGVsQ2xhc3MsXG4gICAgICAgICAgbmVzdGVkUmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICB2YWx1ZVxuICAgICAgICApXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChNb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9uKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICAgIGF0dGFjaG1lbnRzW2F0dHJpYnV0ZU5hbWVdID0gYXdhaXQgdGhpcy5fYXR0YWNobWVudFBheWxvYWRGb3JTdWJtaXR0ZWRWYWx1ZShNb2RlbENsYXNzLCBhdHRyaWJ1dGVOYW1lLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIGVudHJ5LmF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwKSBlbnRyeS5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgaWYgKE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgPSBuZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICByZXR1cm4gZW50cnlcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGEgc3VibWl0dGVkIGF0dGFjaG1lbnQgdmFsdWUgZm9yIHRyYW5zcG9ydC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ2xhc3N9IE1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyBvd25pbmcgdGhlIGF0dGFjaG1lbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTdWJtaXR0ZWQgYXR0YWNobWVudCB2YWx1ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W10+fSBOb3JtYWxpemVkIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIF9hdHRhY2htZW50UGF5bG9hZEZvclN1Ym1pdHRlZFZhbHVlKE1vZGVsQ2xhc3MsIGF0dGFjaG1lbnROYW1lLCB2YWx1ZSkge1xuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbihhdHRhY2htZW50TmFtZSlcblxuICAgIGlmIChhdHRhY2htZW50RGVmaW5pdGlvbj8udHlwZSA9PT0gXCJoYXNNYW55XCIpIHtcbiAgICAgIGNvbnN0IHZhbHVlcyA9IEFycmF5LmlzQXJyYXkodmFsdWUpID8gdmFsdWUgOiBbdmFsdWVdXG5cbiAgICAgIHJldHVybiBhd2FpdCBQcm9taXNlLmFsbCh2YWx1ZXMubWFwKGFzeW5jIChlbnRyeSkgPT4gYXdhaXQgbm9ybWFsaXplRnJvbnRlbmRBdHRhY2htZW50SW5wdXQoZW50cnkpKSlcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IGxhc3RWYWx1ZSA9IHZhbHVlW3ZhbHVlLmxlbmd0aCAtIDFdXG5cbiAgICAgIGlmIChsYXN0VmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7TW9kZWxDbGFzcy5uYW1lfSMke2F0dGFjaG1lbnROYW1lfSBhdHRhY2htZW50IGFycmF5IGNhbm5vdCBiZSBlbXB0eWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCBub3JtYWxpemVGcm9udGVuZEF0dGFjaG1lbnRJbnB1dChsYXN0VmFsdWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IG5vcm1hbGl6ZUZyb250ZW5kQXR0YWNobWVudElucHV0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIEFmdGVyIGEgcGFyZW50IHNhdmUgd2l0aCBgbmVzdGVkQXR0cmlidXRlc2AsIHRoZSBzZXJ2ZXIgcmVzcG9uc2UgaW5jbHVkZXNcbiAgICogcHJlbG9hZGVkIHZlcnNpb25zIG9mIHRoZSBhZmZlY3RlZCByZWxhdGlvbnNoaXBzLiBUaGlzIHJlcGxhY2VzIHRoZSBsb2NhbFxuICAgKiBgX2xvYWRlZFZhbHVlYCBmb3IgZWFjaCBuZXN0ZWQtd3JpdGFibGUgcmVsYXRpb25zaGlwIHdpdGggdGhlIHNlcnZlcidzXG4gICAqIGF1dGhvcml0YXRpdmUgc2V0LCBzbyBkZXN0cm95ZWQgY2hpbGRyZW4gYXJlIGRyb3BwZWQgYW5kIG5ld2x5LWNyZWF0ZWRcbiAgICogY2hpbGRyZW4gZ2V0IHRoZWlyIHNlcnZlci1hc3NpZ25lZCBpZHMgKyBwZXJzaXN0ZWQgc3RhdGUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByZXNwb25zZSAtIENvbW1hbmQgcmVzcG9uc2UgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVjb25jaWxlTmVzdGVkQXR0cmlidXRlc0Zyb21SZXNwb25zZShyZXNwb25zZSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsQ2xhc3NGb3IodGhpcylcbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZyA9IE1vZGVsQ2xhc3MucmVzb3VyY2VDb25maWcoKVxuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXNDb25maWcgPSByZXNvdXJjZUNvbmZpZz8ubmVzdGVkQXR0cmlidXRlc1xuXG4gICAgaWYgKCFuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnKSByZXR1cm5cblxuICAgIGNvbnN0IG1vZGVsRGF0YSA9IE1vZGVsQ2xhc3MubW9kZWxEYXRhRnJvbVJlc3BvbnNlKHJlc3BvbnNlKVxuICAgIGNvbnN0IHByZWxvYWRlZFJlbGF0aW9uc2hpcHMgPSBtb2RlbERhdGEucHJlbG9hZGVkUmVsYXRpb25zaGlwc1xuXG4gICAgLyoqXG4gICAgICogUmVsZXZhbnQgcHJlbG9hZHMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCByZWxldmFudFByZWxvYWRzID0ge31cblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzQ29uZmlnKSkge1xuICAgICAgaWYgKHJlbGF0aW9uc2hpcE5hbWUgaW4gcHJlbG9hZGVkUmVsYXRpb25zaGlwcykge1xuICAgICAgICByZWxldmFudFByZWxvYWRzW3JlbGF0aW9uc2hpcE5hbWVdID0gcHJlbG9hZGVkUmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhyZWxldmFudFByZWxvYWRzKS5sZW5ndGggPiAwKSB7XG4gICAgICBNb2RlbENsYXNzLmFwcGx5UHJlbG9hZGVkUmVsYXRpb25zaGlwcyh0aGlzLCByZWxldmFudFByZWxvYWRzKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUgY29tbWFuZC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQ29tbWFuZFR5cGV9IGNvbW1hbmRUeXBlIC0gQ29tbWFuZCB0eXBlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGF5bG9hZCAtIENvbW1hbmQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBQYXJzZWQgSlNPTiByZXNwb25zZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBleGVjdXRlQ29tbWFuZChjb21tYW5kVHlwZSwgcGF5bG9hZCkge1xuICAgIGNvbnN0IGNvbW1hbmROYW1lID0gdGhpcy5jb21tYW5kTmFtZShjb21tYW5kVHlwZSlcbiAgICBjb25zdCB0aW1lWm9uZSA9IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRUaW1lWm9uZSgpXG4gICAgY29uc3Qgc2VyaWFsaXplZFBheWxvYWQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShwYXlsb2FkLCB7dGltZVpvbmV9KSlcbiAgICBjb25zdCByZXF1ZXN0Q29udGV4dCA9IGZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dCgpXG4gICAgY29uc3QgcmVxdWVzdFBheWxvYWQgPSBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0Q29udGV4dCwgc2VyaWFsaXplZFBheWxvYWQpXG4gICAgY29uc3QgcmVzb3VyY2VQYXRoID0gdGhpcy5yZXNvdXJjZVBhdGgoKVxuICAgIGNvbnN0IGNvbnRhaW5zQXR0YWNobWVudFVwbG9hZCA9IGZyb250ZW5kTW9kZWxQYXlsb2FkQ29udGFpbnNBdHRhY2htZW50VXBsb2FkKHNlcmlhbGl6ZWRQYXlsb2FkKVxuICAgIGNvbnN0IHVzZVNoYXJlZFRyYW5zcG9ydCA9ICFjb250YWluc0F0dGFjaG1lbnRVcGxvYWRcbiAgICBjb25zdCB1cmwgPSB1c2VTaGFyZWRUcmFuc3BvcnQgPyBmcm9udGVuZE1vZGVsQXBpVXJsKCkgOiBmcm9udGVuZE1vZGVsQ29tbWFuZFVybChyZXNvdXJjZVBhdGggfHwgXCJcIiwgY29tbWFuZE5hbWUpXG5cbiAgICBpZiAodXNlU2hhcmVkVHJhbnNwb3J0KSB7XG4gICAgICBjb25zdCBiYXRjaFJlc3BvbnNlID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBwZW5kaW5nU2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RzLnB1c2goe1xuICAgICAgICAgIGNvbW1hbmROYW1lLFxuICAgICAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICAgICAgcGF5bG9hZDogc2VyaWFsaXplZFBheWxvYWQsXG4gICAgICAgICAgcmVxdWVzdENvbnRleHQsXG4gICAgICAgICAgcmVqZWN0LFxuICAgICAgICAgIHJlcXVlc3RJZDogYCR7KytzaGFyZWRGcm9udGVuZE1vZGVsUmVxdWVzdElkfWAsXG4gICAgICAgICAgcmVzb2x2ZSxcbiAgICAgICAgICByZXNvdXJjZVBhdGhcbiAgICAgICAgfSlcblxuICAgICAgICBzY2hlZHVsZVNoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0Rmx1c2goKVxuICAgICAgfSlcblxuICAgICAgY29uc3QgZGVjb2RlZEJhdGNoUmVzcG9uc2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGJhdGNoUmVzcG9uc2UpXG5cbiAgICAgIHRoaXMudGhyb3dPbkVycm9yRnJvbnRlbmRNb2RlbFJlc3BvbnNlKHtcbiAgICAgICAgY29tbWFuZFR5cGUsXG4gICAgICAgIHJlc3BvbnNlOiBkZWNvZGVkQmF0Y2hSZXNwb25zZVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIGRlY29kZWRCYXRjaFJlc3BvbnNlXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRyYWNrRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFJlcXVlc3QoYXN5bmMgKCkgPT4gcnVuV2l0aFRyYW5zcG9ydERlYWRsaW5lKFxuICAgICAge1xuICAgICAgICBlcnJvck1lc3NhZ2U6IGAke3RoaXMubmFtZX0jJHtjb21tYW5kVHlwZX0gcmVxdWVzdCB0aW1lZCBvdXRgLFxuICAgICAgICBzaWduYWw6IGZyb250ZW5kTW9kZWxUcmFuc3BvcnRTaWduYWwoKSxcbiAgICAgICAgdGltZW91dE1zOiBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZW91dE1zKClcbiAgICAgIH0sXG4gICAgICBhc3luYyAoc2lnbmFsKSA9PiB7XG4gICAgICAgIGNvbnN0IGRpcmVjdFJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVxdWVzdFBheWxvYWQpLFxuICAgICAgICAgIGNyZWRlbnRpYWxzOiBcImluY2x1ZGVcIixcbiAgICAgICAgICBoZWFkZXJzOiBmcm9udGVuZE1vZGVsUmVxdWVzdEhlYWRlcnModGltZVpvbmUpLFxuICAgICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgICAgc2lnbmFsXG4gICAgICAgIH0pXG5cbiAgICAgICAgY29uc3QgZGlyZWN0UmVzcG9uc2VUZXh0ID0gYXdhaXQgZGlyZWN0UmVzcG9uc2UudGV4dCgpXG5cbiAgICAgICAgaWYgKCFkaXJlY3RSZXNwb25zZS5vaykge1xuICAgICAgICAgIHRocm93RnJvbnRlbmRNb2RlbEh0dHBFcnJvcih7XG4gICAgICAgICAgICBjb21tYW5kTGFiZWw6IGAke3RoaXMubmFtZX0jJHtjb21tYW5kVHlwZX1gLFxuICAgICAgICAgICAgcmVzcG9uc2U6IGRpcmVjdFJlc3BvbnNlLFxuICAgICAgICAgICAgcmVzcG9uc2VUZXh0OiBkaXJlY3RSZXNwb25zZVRleHRcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZGlyZWN0SnNvbiA9IGRpcmVjdFJlc3BvbnNlVGV4dC5sZW5ndGggPiAwID8gSlNPTi5wYXJzZShkaXJlY3RSZXNwb25zZVRleHQpIDoge31cbiAgICAgICAgY29uc3QgZGVjb2RlZERpcmVjdFJlc3BvbnNlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShkaXJlY3RKc29uKSlcblxuICAgICAgICB0aGlzLnRocm93T25FcnJvckZyb250ZW5kTW9kZWxSZXNwb25zZSh7XG4gICAgICAgICAgY29tbWFuZFR5cGUsXG4gICAgICAgICAgcmVzcG9uc2U6IGRlY29kZWREaXJlY3RSZXNwb25zZVxuICAgICAgICB9KVxuXG4gICAgICAgIHJldHVybiBkZWNvZGVkRGlyZWN0UmVzcG9uc2VcbiAgICAgIH1cbiAgICApKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZSBjdXN0b20gY29tbWFuZC5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHBhcmFtIHt7Y29tbWFuZE5hbWU6IHN0cmluZywgY29tbWFuZFR5cGU6IEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29tbWFuZFR5cGUsIG1lbWJlcklkPzogc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCwgcGF5bG9hZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCByZXNvdXJjZVBhdGg6IHN0cmluZ319IGFyZ3MgLSBDb21tYW5kIGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPj59IC0gRGVjb2RlZCByZXNwb25zZSBwYXlsb2FkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGV4ZWN1dGVDdXN0b21Db21tYW5kKGFyZ3MpIHtcbiAgICBjb25zdCB7Y29tbWFuZE5hbWUsIGNvbW1hbmRUeXBlLCBtZW1iZXJJZCA9IG51bGwsIHBheWxvYWQsIHJlc291cmNlUGF0aH0gPSBhcmdzXG4gICAgY29uc3QgdGltZVpvbmUgPSBmcm9udGVuZE1vZGVsVHJhbnNwb3J0VGltZVpvbmUoKVxuICAgIGNvbnN0IHNlcmlhbGl6ZWRQYXlsb2FkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocGF5bG9hZCwge3RpbWVab25lfSkpXG4gICAgY29uc3QgcmVxdWVzdENvbnRleHQgPSBmcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoKVxuXG4gICAgbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdENvbnRleHQsIHNlcmlhbGl6ZWRQYXlsb2FkKVxuICAgIGNvbnN0IGN1c3RvbVBhdGggPSBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZFBhdGgoe1xuICAgICAgY29tbWFuZE5hbWUsXG4gICAgICBtZW1iZXJJZCxcbiAgICAgIG1vZGVsTmFtZTogdGhpcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgIHJlc291cmNlUGF0aFxuICAgIH0pXG5cbiAgICBjb25zdCBiYXRjaFJlc3BvbnNlID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgcGVuZGluZ1NoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0cy5wdXNoKHtcbiAgICAgICAgY29tbWFuZFR5cGUsXG4gICAgICAgIGN1c3RvbVBhdGgsXG4gICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICAgIHBheWxvYWQ6IHNlcmlhbGl6ZWRQYXlsb2FkLFxuICAgICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgICAgcmVqZWN0LFxuICAgICAgICByZXF1ZXN0SWQ6IGAkeysrc2hhcmVkRnJvbnRlbmRNb2RlbFJlcXVlc3RJZH1gLFxuICAgICAgICByZXNvbHZlXG4gICAgICB9KVxuXG4gICAgICBzY2hlZHVsZVNoYXJlZEZyb250ZW5kTW9kZWxSZXF1ZXN0Rmx1c2goKVxuICAgIH0pXG5cbiAgICBjb25zdCBkZWNvZGVkQmF0Y2hSZXNwb25zZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZVZhbHVlPn0gKi8gKGJhdGNoUmVzcG9uc2UpXG5cbiAgICB0aGlzLnRocm93T25FcnJvckZyb250ZW5kTW9kZWxSZXNwb25zZSh7XG4gICAgICBjb21tYW5kVHlwZSxcbiAgICAgIHJlc3BvbnNlOiBkZWNvZGVkQmF0Y2hSZXNwb25zZVxuICAgIH0pXG5cbiAgICByZXR1cm4gZGVjb2RlZEJhdGNoUmVzcG9uc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRocm93IG9uIGVycm9yIGZyb250ZW5kIG1vZGVsIHJlc3BvbnNlLlxuICAgKiBAdGhpcyB7RnJvbnRlbmRNb2RlbENsYXNzfVxuICAgKiBAcGFyYW0ge3tjb21tYW5kVHlwZTogRnJvbnRlbmRNb2RlbFJlcXVlc3RDb21tYW5kVHlwZSwgcmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHRocm93T25FcnJvckZyb250ZW5kTW9kZWxSZXNwb25zZShhcmdzKSB7XG4gICAgY29uc3Qge2NvbW1hbmRUeXBlLCByZXNwb25zZX0gPSBhcmdzXG4gICAgaWYgKHJlc3BvbnNlPy5zdGF0dXMgIT09IFwiZXJyb3JcIikgcmV0dXJuXG5cbiAgICBjb25zdCByZXNwb25zZUtleXMgPSBPYmplY3Qua2V5cyhyZXNwb25zZSlcbiAgICBjb25zdCBoYXNPbmx5U3RhdHVzID0gcmVzcG9uc2VLZXlzLmxlbmd0aCA9PT0gMSAmJiByZXNwb25zZUtleXNbMF0gPT09IFwic3RhdHVzXCJcbiAgICBjb25zdCBoYXNFcnJvck1lc3NhZ2UgPSB0eXBlb2YgcmVzcG9uc2UuZXJyb3JNZXNzYWdlID09PSBcInN0cmluZ1wiICYmIHJlc3BvbnNlLmVycm9yTWVzc2FnZS5sZW5ndGggPiAwXG4gICAgY29uc3QgaGFzRXJyb3JFbnZlbG9wZUtleXMgPSBCb29sZWFuKFxuICAgICAgcmVzcG9uc2UuY29kZSAhPT0gdW5kZWZpbmVkXG4gICAgICB8fCByZXNwb25zZS5lcnJvciAhPT0gdW5kZWZpbmVkXG4gICAgICB8fCByZXNwb25zZS5lcnJvcnMgIT09IHVuZGVmaW5lZFxuICAgICAgfHwgcmVzcG9uc2UubWVzc2FnZSAhPT0gdW5kZWZpbmVkXG4gICAgKVxuICAgIGNvbnN0IG5vblN0YXR1c0tleXMgPSByZXNwb25zZUtleXMuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJzdGF0dXNcIilcbiAgICBjb25zdCBjb25maWd1cmVkQXR0cmlidXRlTmFtZXMgPSB0aGlzLmNvbmZpZ3VyZWRGcm9udGVuZE1vZGVsQXR0cmlidXRlTmFtZXMoKVxuICAgIGNvbnN0IGxvb2tzTGlrZVJhd01vZGVsUGF5bG9hZCA9IG5vblN0YXR1c0tleXMubGVuZ3RoID4gMFxuICAgICAgJiYgbm9uU3RhdHVzS2V5cy5ldmVyeSgoa2V5KSA9PiBjb25maWd1cmVkQXR0cmlidXRlTmFtZXMuaGFzKGtleSkpXG5cbiAgICBpZiAoIWhhc0Vycm9yTWVzc2FnZSAmJiAhaGFzT25seVN0YXR1cyAmJiAhaGFzRXJyb3JFbnZlbG9wZUtleXMgJiYgbG9va3NMaWtlUmF3TW9kZWxQYXlsb2FkKSByZXR1cm5cblxuICAgIGNvbnN0IGRlYnVnRXJyb3JNZXNzYWdlID0gdHlwZW9mIHJlc3BvbnNlLmRlYnVnRXJyb3JNZXNzYWdlID09PSBcInN0cmluZ1wiICYmIHJlc3BvbnNlLmRlYnVnRXJyb3JNZXNzYWdlLmxlbmd0aCA+IDBcbiAgICAgID8gcmVzcG9uc2UuZGVidWdFcnJvck1lc3NhZ2VcbiAgICAgIDogbnVsbFxuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGRlYnVnRXJyb3JNZXNzYWdlIHx8IChoYXNFcnJvck1lc3NhZ2VcbiAgICAgID8gcmVzcG9uc2UuZXJyb3JNZXNzYWdlXG4gICAgICA6IGBSZXF1ZXN0IGZhaWxlZCBmb3IgJHt0aGlzLm5hbWV9IyR7Y29tbWFuZFR5cGV9YClcblxuICAgIGNvbnN0IGVycm9yID0gLyoqIEB0eXBlIHtFcnJvciAmIHtjb3JyZWxhdGlvbklkPzogc3RyaW5nLCBkZXRhaWxzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBlcnJvck1lc3NhZ2U/OiBzdHJpbmcsIHZlbG9jaW91cz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXJyb3JUeXBlPzogc3RyaW5nLCB2YWxpZGF0aW9uRXJyb3JzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBkZWJ1Z0Vycm9yQ2xhc3M/OiBzdHJpbmcsIGRlYnVnQmFja3RyYWNlPzogc3RyaW5nW119fSAqLyAobmV3IEVycm9yKGVycm9yTWVzc2FnZSkpXG4gICAgaWYgKGhhc0Vycm9yTWVzc2FnZSkge1xuICAgICAgZXJyb3IuZXJyb3JNZXNzYWdlID0gcmVzcG9uc2UuZXJyb3JNZXNzYWdlXG4gICAgfVxuICAgIGlmIChyZXNwb25zZS52ZWxvY2lvdXMgJiYgdHlwZW9mIHJlc3BvbnNlLnZlbG9jaW91cyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgZXJyb3IudmVsb2Npb3VzID0gcmVzcG9uc2UudmVsb2Npb3VzXG4gICAgfVxuICAgIGlmICh0eXBlb2YgcmVzcG9uc2UuZXJyb3JUeXBlID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBlcnJvci5lcnJvclR5cGUgPSByZXNwb25zZS5lcnJvclR5cGVcbiAgICB9XG4gICAgaWYgKHJlc3BvbnNlLnZhbGlkYXRpb25FcnJvcnMgJiYgdHlwZW9mIHJlc3BvbnNlLnZhbGlkYXRpb25FcnJvcnMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGVycm9yLnZhbGlkYXRpb25FcnJvcnMgPSByZXNwb25zZS52YWxpZGF0aW9uRXJyb3JzXG4gICAgfVxuICAgIGlmIChyZXNwb25zZS5kZXRhaWxzICYmIHR5cGVvZiByZXNwb25zZS5kZXRhaWxzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBlcnJvci5kZXRhaWxzID0gcmVzcG9uc2UuZGV0YWlsc1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHJlc3BvbnNlLmNvcnJlbGF0aW9uSWQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGVycm9yLmNvcnJlbGF0aW9uSWQgPSByZXNwb25zZS5jb3JyZWxhdGlvbklkXG4gICAgfVxuICAgIC8vIEZvcndhcmQgc2VydmVyLXByb3ZpZGVkIGRlYnVnIGRldGFpbCAoaW5jbHVkZWQgb25seSB3aGVuIHRoZSBiYWNrZW5kXG4gICAgLy8gZGVlbXMgdGhlIHJlcXVlc3RlciBhbGxvd2VkIHRvIHNlZSBpdCwgZS5nLiBhbiBhZG1pbikgc28gY2FsbGVycyBjYW5cbiAgICAvLyByZW5kZXIgdGhlIHJlYWwgZXJyb3IgY2xhc3MgYW5kIHN0YWNrIHRyYWNlIGluc3RlYWQgb2YgdGhlIGdlbmVyaWNcbiAgICAvLyBjbGllbnQtc2FmZSBtZXNzYWdlLlxuICAgIGlmICh0eXBlb2YgcmVzcG9uc2UuZGVidWdFcnJvckNsYXNzID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBlcnJvci5kZWJ1Z0Vycm9yQ2xhc3MgPSByZXNwb25zZS5kZWJ1Z0Vycm9yQ2xhc3NcbiAgICB9XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocmVzcG9uc2UuZGVidWdCYWNrdHJhY2UpKSB7XG4gICAgICBlcnJvci5kZWJ1Z0JhY2t0cmFjZSA9IHJlc3BvbnNlLmRlYnVnQmFja3RyYWNlXG4gICAgfVxuICAgIHRocm93IGVycm9yXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25maWd1cmVkIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICogQHRoaXMge0Zyb250ZW5kTW9kZWxDbGFzc31cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIENvbmZpZ3VyZWQgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlIG5hbWVzLlxuICAgKi9cbiAgc3RhdGljIGNvbmZpZ3VyZWRGcm9udGVuZE1vZGVsQXR0cmlidXRlTmFtZXMoKSB7XG4gICAgY29uc3QgcmVzb3VyY2VDb25maWcgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHRoaXMucmVzb3VyY2VDb25maWcoKSlcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gcmVzb3VyY2VDb25maWcuYXR0cmlidXRlc1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgIHJldHVybiBuZXcgU2V0KGF0dHJpYnV0ZXMuZmlsdGVyKChhdHRyaWJ1dGVOYW1lKSA9PiB0eXBlb2YgYXR0cmlidXRlTmFtZSA9PT0gXCJzdHJpbmdcIikpXG4gICAgfVxuXG4gICAgaWYgKGF0dHJpYnV0ZXMgJiYgdHlwZW9mIGF0dHJpYnV0ZXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVybiBuZXcgU2V0KE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpKVxuICAgIH1cblxuICAgIHJldHVybiBuZXcgU2V0KClcbiAgfVxufVxuXG4vKiogUHVibGljIGZyb250ZW5kIG1vZGVsIGZvciBzYWZlIFZlbG9jaW91cyBhdHRhY2htZW50IG1ldGFkYXRhLiAqL1xuZXhwb3J0IGNsYXNzIFZlbG9jaW91c0F0dGFjaG1lbnQgZXh0ZW5kcyBGcm9udGVuZE1vZGVsQmFzZSB7XG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIGNvbmZpZy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ30gLSBSZXNvdXJjZSBjb25maWcuXG4gICAqL1xuICBzdGF0aWMgcmVzb3VyY2VDb25maWcoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgYnl0ZVNpemU6IHt0eXBlOiBcImludGVnZXJcIn0sXG4gICAgICAgIGNvbnRlbnRUeXBlOiB7bnVsbDogdHJ1ZSwgdHlwZTogXCJ2YXJjaGFyXCJ9LFxuICAgICAgICBjcmVhdGVkQXQ6IHt0eXBlOiBcImRhdGV0aW1lXCJ9LFxuICAgICAgICBmaWxlbmFtZToge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICAgICAgaWQ6IHt0eXBlOiBcInV1aWRcIn0sXG4gICAgICAgIG5hbWU6IHt0eXBlOiBcInZhcmNoYXJcIn0sXG4gICAgICAgIHBvc2l0aW9uOiB7dHlwZTogXCJpbnRlZ2VyXCJ9LFxuICAgICAgICByZWNvcmRJZDoge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICAgICAgcmVjb3JkVHlwZToge3R5cGU6IFwidmFyY2hhclwifSxcbiAgICAgICAgdXBkYXRlZEF0OiB7dHlwZTogXCJkYXRldGltZVwifVxuICAgICAgfSxcbiAgICAgIGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHM6IFtcImluZGV4XCJdLFxuICAgICAgYnVpbHRJbk1lbWJlckNvbW1hbmRzOiBbXCJmaW5kXCJdLFxuICAgICAgbW9kZWxOYW1lOiBcIlZlbG9jaW91c0F0dGFjaG1lbnRcIixcbiAgICAgIHByaW1hcnlLZXk6IFwiaWRcIlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IGlkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgaWQuXG4gICAqL1xuICBpZCgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImlkXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgb3duZXIgbW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBPd25lciBtb2RlbCBuYW1lLlxuICAgKi9cbiAgcmVjb3JkVHlwZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcInJlY29yZFR5cGVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBvd25lciByZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gT3duZXIgcmVjb3JkIGlkLlxuICAgKi9cbiAgcmVjb3JkSWQoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJyZWNvcmRJZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgbmFtZSBvbiB0aGUgb3duZXIgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0YWNobWVudCBuYW1lIG9uIHRoZSBvd25lciBtb2RlbC5cbiAgICovXG4gIG5hbWUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJuYW1lXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBwb3NpdGlvbi5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBBdHRhY2htZW50IHBvc2l0aW9uLlxuICAgKi9cbiAgcG9zaXRpb24oKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJwb3NpdGlvblwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgZmlsZW5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQXR0YWNobWVudCBmaWxlbmFtZS5cbiAgICovXG4gIGZpbGVuYW1lKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwiZmlsZW5hbWVcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IGNvbnRlbnQgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gQXR0YWNobWVudCBjb250ZW50IHR5cGUuXG4gICAqL1xuICBjb250ZW50VHlwZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImNvbnRlbnRUeXBlXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBieXRlIHNpemUuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQXR0YWNobWVudCBieXRlIHNpemUuXG4gICAqL1xuICBieXRlU2l6ZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImJ5dGVTaXplXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY3JlYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtEYXRlfSAtIENyZWF0ZWQtYXQgdGltZXN0YW1wLlxuICAgKi9cbiAgY3JlYXRlZEF0KCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwiY3JlYXRlZEF0XCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgdXBkYXRlZC1hdCB0aW1lc3RhbXAuXG4gICAqIEByZXR1cm5zIHtEYXRlfSAtIFVwZGF0ZWQtYXQgdGltZXN0YW1wLlxuICAgKi9cbiAgdXBkYXRlZEF0KCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwidXBkYXRlZEF0XCIpIH1cbn1cblxuRnJvbnRlbmRNb2RlbEJhc2UucmVnaXN0ZXJNb2RlbChWZWxvY2lvdXNBdHRhY2htZW50KVxuIl19