import FrontendModelQuery from "./query.js";
export type FrontendModelRelationship = FrontendModelHasManyRelationship<any, any, any> | FrontendModelSingularRelationship<any, any, any>;
export type FrontendModelModelEventCallbackEntry = {
    callback: (payload: {
        id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue;
        model: FrontendModelBase;
    }) => void;
    eventFilterKey: string | null;
    eventFilterPayload: import("./query.js").FrontendModelEventFilterPayload | null;
    projectionPayload: import("./query.js").FrontendModelProjectionPayload;
};
export type FrontendModelDestroyEventCallbackEntry = {
    callback: (payload: {
        id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue;
    }) => void;
};
export type FrontendModelCommandType = "create" | "find" | "index" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url";
export type FrontendModelRequestCommandType = FrontendModelCommandType | string;
export type FrontendModelTransportModelValue = {
    attributes: () => Record<string, unknown>;
};
export type FrontendModelTransportScalarValue = undefined | null | boolean | number | string | bigint | Date | FrontendModelTransportModelValue;
export type FrontendModelTransportObject = Record<string, unknown>;
export type FrontendModelTransportValue = FrontendModelTransportScalarValue | FrontendModelTransportObject | Array<unknown>;
export type FrontendModelAttributeValue = FrontendModelTransportValue;
export type FrontendModelAttachmentDefinition = {
    type: "hasOne" | "hasMany";
};
export type FrontendModelAttributeDefinition = {
    columnType?: string;
    dataType?: string;
    jsDocType?: string;
    name?: string;
    null?: boolean;
    selectedByDefault?: boolean;
    sqlType?: string;
    type?: string;
};
export type FrontendModelAttachmentInput = Record<string, ReturnType<typeof JSON.parse>> | {
    arrayBuffer: () => Promise<ArrayBuffer>;
    type?: string;
    name?: string;
} | null | undefined;
export type FrontendModelSyncMetadata = Record<string, FrontendModelTransportValue>;
export type FrontendModelSyncConflictStrategy = "optimisticVersion" | "serverWins" | "lastWriterWins" | "fieldThreeWay" | "appendOnly";
export type FrontendModelSyncConfig = {
    enabled: boolean;
    operations: string[];
    policyHash: string;
    policyVersion: string | null;
    conflictStrategy?: FrontendModelSyncConflictStrategy;
    metadata?: FrontendModelSyncMetadata;
};
export type FrontendModelResourceConfig = {
    attributes?: Array<string | FrontendModelAttributeDefinition> | Record<string, FrontendModelAttributeDefinition>;
    builtInCollectionCommands?: string[];
    builtInMemberCommands?: string[];
    collectionCommands?: string[];
    commands?: string[];
    memberCommands?: string[];
    attachments?: Record<string, FrontendModelAttachmentDefinition>;
    modelName?: string;
    nestedAttributes?: Record<string, {
        allowDestroy?: boolean;
        limit?: number;
    }>;
    primaryKey?: string | string[];
    relationships?: string[];
    sync?: FrontendModelSyncConfig;
};
export type FrontendModelConstructor<T extends FrontendModelBase = FrontendModelBase> = {
    new (attributes?: Record<string, FrontendModelAttributeValue>): T;
};
export type FrontendModelClass<T extends FrontendModelBase = FrontendModelBase<any, any, any>, Attributes extends object = any, CreateAttributes extends object = any> = {
    new (): T;
    create(attributes?: CreateAttributes): Promise<T>;
} & Omit<typeof FrontendModelBase, "create" | "prototype">;
export type FrontendModelCreateAttributesFor<T extends FrontendModelBase> = T extends FrontendModelBase<Record<string, FrontendModelAttributeValue>, infer CreateAttributes, infer _UpdateAttributes> ? CreateAttributes : Record<string, FrontendModelAttributeValue>;
export type FrontendModelRelationshipModel<T extends FrontendModelBase<any, any, any> | typeof FrontendModelBase> = T extends typeof FrontendModelBase ? InstanceType<T> : T;
export type FrontendModelTransportConfig = {
    /**
     * - Optional frontend-model URL. This should be the shared endpoint (for example `"/frontend-models"` or `"https://example.com/frontend-models"`).
     */
    url?: string | (() => string | undefined | null);
    /**
     * - Deprecated shared-endpoint flag retained for compatibility. Frontend-model CRUD/custom commands use the shared frontend-model API envelope by default.
     */
    shared?: boolean;
    /**
     * - Optional websocket URL. When set, Velocious creates and manages its own websocket client internally. Subscriptions use the websocket; CRUD uses HTTP and falls back gracefully. Example: `"ws://localhost:3006/websocket"`.
     */
    websocketUrl?: string | (() => string | undefined | null);
    /**
     * - Optional websocket client for shared frontend-model API requests and subscriptions. Its `post` receives the bounded-deadline `signal` and should forward it into the underlying transport so the deadline can abort the live request and its response-body read.
     */
    websocketClient?: {
        post: (path: string, body?: ReturnType<typeof JSON.parse>, options?: {
            headers?: Record<string, string>;
            signal?: AbortSignal;
        }) => Promise<{
            json: () => ReturnType<typeof JSON.parse>;
        }>;
        subscribe: (channel: string, options: {
            params?: Record<string, ReturnType<typeof JSON.parse>>;
        }, callback: (payload: ReturnType<typeof JSON.parse>) => void) => (() => void);
        subscribeAndWait?: (channel: string, options: {
            params?: Record<string, ReturnType<typeof JSON.parse>>;
        }, callback: (payload: ReturnType<typeof JSON.parse>) => void) => Promise<(() => void)>;
    };
    /**
     * - Extra HTTP/WS headers to attach to every frontend-model API request. Pass a function to compute them at request time (for example to include the current locale).
     */
    requestHeaders?: Record<string, string> | (() => Record<string, string>);
    /**
     * - Immutable scalar context captured independently when each operation or event subscription starts and sent for remote tenant/ability resolution.
     */
    requestContext?: import("../remote-request-context.js").RemoteRequestContext | (() => import("../remote-request-context.js").RemoteRequestContext | undefined | null);
    /**
     * - Bounded deadline in milliseconds covering connection, response headers, and response-body consumption for each frontend-model API request. On expiry the live fetch/adapter request is aborted (built on awaitery's `timeout`) and awaitery's `TimeoutError` is thrown, so callers can classify a timeout via `error instanceof TimeoutError`. Pass a function to resolve it per request. Falsy/absent means no deadline.
     */
    timeout?: number | (() => number | undefined | null);
    /**
     * - Optional caller/session AbortSignal composed with the deadline. Aborting it cancels the live request (for example on session shutdown or offline transition); the resulting abort error stays distinguishable from a timeout. Pass a function to resolve the current signal per request.
     */
    signal?: AbortSignal | (() => AbortSignal | undefined | null);
    /**
     * - Optional sessionId persistence hook forwarded to the internal `VelociousWebsocketClient` so WS sessions can be resumed across page reloads / app restarts.
     */
    sessionStore?: {
        get: () => string | null | undefined | Promise<string | null | undefined>;
        set: (sessionId: string) => void | Promise<void>;
        clear: () => void | Promise<void>;
    };
    /**
     * - IANA timezone sent with every frontend-model API request for timezone-less datetime parsing.
     */
    timeZone?: string | (() => string | null | undefined);
    /**
     * - Offline mutation queue configuration.
     */
    offlineSync?: {
        actorDeviceId: string;
        actorUserId: string;
        clientMutationId?: () => string;
        enabled?: boolean;
        mutationLog: import("../sync/local-mutation-log.js").default;
        now?: () => Date;
        offlineGrant: {
            id: string;
        };
    };
};
export type FrontendModelIdleWaitArgs = {
    /**
     * - Milliseconds the transport must stay idle before resolving.
     */
    quietMs?: number;
    /**
     * - Timeout in milliseconds.
     */
    timeout?: number;
};
/** Error raised when reading an attribute that was not selected in query payloads. */
export declare class AttributeNotSelectedError extends Error {
    /**
     * Runs constructor.
     * @param {string} modelName - Model class name.
     * @param {string} attributeName - Attribute that was requested.
     */
    constructor(modelName: string, attributeName: string);
}
/**
 * Lightweight singular relationship state holder for frontend model instances.
 * @template {FrontendModelBase<any, any, any> | typeof FrontendModelBase} S
 * @template {FrontendModelBase<any, any, any> | typeof FrontendModelBase} T
 * @template {object} [TargetCreateAttributes=Record<string, FrontendModelAttributeValue>]
 */
export declare class FrontendModelSingularRelationship<S extends FrontendModelBase<any, any, any> | typeof FrontendModelBase, T extends FrontendModelBase<any, any, any> | typeof FrontendModelBase, TargetCreateAttributes extends object = Record<string, FrontendModelAttributeValue>> {
    model: FrontendModelBase<any, any, any>;
    relationshipName: string;
    targetModelClass: FrontendModelClass<FrontendModelRelationshipModel<T>, Record<string, FrontendModelTransportValue>, TargetCreateAttributes> | null;
    _preloaded: boolean;
    /** @type {FrontendModelRelationshipModel<T> | null} */
    _loadedValue: FrontendModelRelationshipModel<T> | null;
    /**
     * Runs constructor.
     * @param {FrontendModelBase} model - Parent model.
     * @param {string} relationshipName - Relationship name.
     * @param {FrontendModelClass<FrontendModelRelationshipModel<T>, Record<string, FrontendModelAttributeValue>, TargetCreateAttributes> | null} targetModelClass - Target model class.
     */
    constructor(model: FrontendModelBase, relationshipName: string, targetModelClass: FrontendModelClass<FrontendModelRelationshipModel<T>, Record<string, FrontendModelAttributeValue>, TargetCreateAttributes> | null);
    /**
     * Runs set loaded.
     * @param {FrontendModelRelationshipModel<T> | null | undefined} loadedValue - Loaded relationship value.
     * @returns {void}
     */
    setLoaded(loadedValue: FrontendModelRelationshipModel<T> | null | undefined): void;
    /**
     * Runs get preloaded.
     * @returns {boolean} - Whether relationship is preloaded.
     */
    getPreloaded(): boolean;
    /**
     * Runs loaded.
     * @returns {FrontendModelRelationshipModel<T> | null} - Loaded relationship value.
     */
    loaded(): FrontendModelRelationshipModel<T> | null;
    /**
     * Copies loaded value from another singular relationship helper.
     * @param {FrontendModelRelationship} sourceRelationship - Source relationship helper.
     * @returns {void}
     */
    copyLoadedFrom(sourceRelationship: FrontendModelRelationship): void;
    /**
     * Runs build.
     * @param {TargetCreateAttributes} [attributes] - New model attributes.
     * @returns {FrontendModelRelationshipModel<T>} - Built model.
     */
    build(attributes?: TargetCreateAttributes): FrontendModelRelationshipModel<T>;
    /**
     * Force-reload the relationship.
     * @returns {Promise<FrontendModelRelationshipModel<T> | null>} - Loaded relationship model.
     */
    load(): Promise<FrontendModelRelationshipModel<T> | null>;
    /**
     * Returns the loaded relationship or loads it.
     * @returns {Promise<FrontendModelRelationshipModel<T> | null>} - Loaded relationship model.
     */
    orLoad(): Promise<FrontendModelRelationshipModel<T> | null>;
}
/**
 * Lightweight has-many relationship state holder for frontend model instances.
 * @template {FrontendModelBase<any, any, any> | typeof FrontendModelBase} S
 * @template {FrontendModelBase<any, any, any> | typeof FrontendModelBase} T
 * @template {object} [TargetCreateAttributes=Record<string, FrontendModelAttributeValue>]
 */
export declare class FrontendModelHasManyRelationship<S extends FrontendModelBase<any, any, any> | typeof FrontendModelBase, T extends FrontendModelBase<any, any, any> | typeof FrontendModelBase, TargetCreateAttributes extends object = Record<string, FrontendModelAttributeValue>> {
    model: FrontendModelBase<any, any, any>;
    relationshipName: string;
    targetModelClass: FrontendModelClass<FrontendModelRelationshipModel<T>, Record<string, FrontendModelTransportValue>, TargetCreateAttributes> | null;
    _preloaded: boolean;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<FrontendModelRelationshipModel<T>>} */
    _loadedValue: Array<FrontendModelRelationshipModel<T>>;
    /**
     * Runs constructor.
     * @param {FrontendModelBase} model - Parent model.
     * @param {string} relationshipName - Relationship name.
     * @param {FrontendModelClass<FrontendModelRelationshipModel<T>, Record<string, FrontendModelAttributeValue>, TargetCreateAttributes> | null} targetModelClass - Target model class.
     */
    constructor(model: FrontendModelBase, relationshipName: string, targetModelClass: FrontendModelClass<FrontendModelRelationshipModel<T>, Record<string, FrontendModelAttributeValue>, TargetCreateAttributes> | null);
    /**
     * Runs set loaded.
     * @param {Array<FrontendModelRelationshipModel<T>>} loadedValue - Loaded relationship value.
     * @returns {void}
     */
    setLoaded(loadedValue: Array<FrontendModelRelationshipModel<T>>): void;
    /**
     * Runs get preloaded.
     * @returns {boolean} - Whether relationship is preloaded.
     */
    getPreloaded(): boolean;
    /**
     * Runs loaded.
     * @returns {Array<FrontendModelRelationshipModel<T>>} - Loaded relationship values.
     */
    loaded(): Array<FrontendModelRelationshipModel<T>>;
    /**
     * Copies loaded value from another has-many relationship helper.
     * @param {FrontendModelRelationship} sourceRelationship - Source relationship helper.
     * @returns {void}
     */
    copyLoadedFrom(sourceRelationship: FrontendModelRelationship): void;
    /**
     * Runs add to loaded.
     * @param {Array<FrontendModelRelationshipModel<T>>} models - Models to append.
     * @returns {void}
     */
    addToLoaded(models: Array<FrontendModelRelationshipModel<T>>): void;
    /**
     * Runs build.
     * @param {TargetCreateAttributes} [attributes] - New model attributes.
     * @returns {FrontendModelRelationshipModel<T>} - Built model.
     */
    build(attributes?: TargetCreateAttributes): FrontendModelRelationshipModel<T>;
    /**
     * Force-reload the relationship. When the parent record was loaded as part
     * of a batch, siblings that have not preloaded this relationship get
     * batched into one request via the cohort preloader. The scoped query path
     * (`Model.where(...).preload([name]).toArray()` directly from user code)
     * bypasses cohort batching by design.
     * @returns {Promise<Array<FrontendModelRelationshipModel<T>>>} - Loaded relationship models.
     */
    load(): Promise<Array<FrontendModelRelationshipModel<T>>>;
    /**
     * Runs to array.
     * @returns {Promise<Array<FrontendModelRelationshipModel<T>>>} - Loaded relationship models.
     */
    toArray(): Promise<Array<FrontendModelRelationshipModel<T>>>;
}
/**
 * Downloaded frontend-model attachment payload wrapper.
 */
export declare class FrontendModelAttachmentDownload {
    idValue: string;
    filenameValue: string;
    contentTypeValue: string | null;
    byteSizeValue: number;
    contentValue: Uint8Array<ArrayBufferLike>;
    urlValue: string | null;
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
    constructor({ byteSize, content, contentType, filename, id, url }: {
        id: string;
        filename: string;
        contentType: string | null;
        byteSize: number;
        content: Uint8Array;
        url?: string | null;
    });
    /**
     * Runs byte size.
     * @returns {number} - File size in bytes.
     */
    byteSize(): number;
    /**
     * Runs content.
     * @returns {Uint8Array} - File content bytes.
     */
    content(): Uint8Array;
    /**
     * Runs content type.
     * @returns {string | null} - Content type.
     */
    contentType(): string | null;
    /**
     * Runs filename.
     * @returns {string} - Filename.
     */
    filename(): string;
    /**
     * Runs id.
     * @returns {string} - Attachment id.
     */
    id(): string;
    /**
     * Runs url.
     * @returns {string | null} - Resolvable attachment URL.
     */
    url(): string | null;
}
/**
 * Frontend-model attachment helper for one attachment name.
 */
export declare class FrontendModelAttachmentHandle {
    model: FrontendModelBase<any, any, any>;
    attachmentName: string;
    /**
     * Pending attachment inputs queued for the next model save.
     * @type {FrontendModelAttachmentInput[]}
     */
    pendingInputs: FrontendModelAttachmentInput[];
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {FrontendModelBase} args.model - Model instance.
     * @param {string} args.attachmentName - Attachment name.
     */
    constructor({ attachmentName, model }: {
        model: FrontendModelBase;
        attachmentName: string;
    });
    /**
     * Queue attachment input for the parent model's next save.
     * @param {FrontendModelAttachmentInput | FrontendModelAttachmentInput[]} input - Attachment input.
     * @returns {void}
     */
    queueAttach(input: FrontendModelAttachmentInput | FrontendModelAttachmentInput[]): void;
    /**
     * Whether this attachment has queued inputs for the next model save.
     * @returns {boolean} Whether any pending inputs exist.
     */
    hasPendingAttachments(): boolean;
    /**
     * Builds the save payload for queued attachment inputs.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | Record<string, ReturnType<typeof JSON.parse>>[] | undefined>} Normalized attachment payload.
     */
    pendingAttachmentsPayload(): Promise<Record<string, ReturnType<typeof JSON.parse>> | Record<string, ReturnType<typeof JSON.parse>>[] | undefined>;
    /** Clears queued attachment inputs after a successful model save. */
    clearPendingAttachments(): void;
    /**
     * Runs attach.
     * @param {ReturnType<typeof JSON.parse>} input - Attachment input.
     * @returns {Promise<void>} - Resolves when attached.
     */
    attach(input: ReturnType<typeof JSON.parse>): Promise<void>;
    /**
     * Runs download.
     * @param {string} [attachmentId] - Optional attachment id for has-many attachments.
     * @returns {Promise<FrontendModelAttachmentDownload | null>} - Downloaded attachment payload.
     */
    download(attachmentId?: string): Promise<FrontendModelAttachmentDownload | null>;
    /**
     * Runs url.
     * @param {string} [attachmentId] - Optional attachment id for has-many attachments.
     * @returns {Promise<string | null>} - Resolvable attachment URL.
     */
    url(attachmentId?: string): Promise<string | null>;
    /**
     * Builds a query for this attachment handle's metadata rows.
     * @returns {import("./query.js").default<typeof VelociousAttachment>} - Attachment metadata query.
     */
    query(): import("./query.js").default<typeof VelociousAttachment>;
    /**
     * Loads all attachment metadata rows for this handle.
     * @returns {Promise<VelociousAttachment[]>} - Attachment metadata rows.
     */
    toArray(): Promise<VelociousAttachment[]>;
    /**
     * Loads the first attachment metadata row for this handle.
     * @returns {Promise<VelociousAttachment | null>} - First attachment metadata row.
     */
    first(): Promise<VelociousAttachment | null>;
    /**
     * Runs list. Returns metadata for every attachment under this attachment name
     * (no content bytes), so callers can enumerate has-many attachments and then
     * download or link to each one by id.
     * @returns {Promise<Array<{byteSize: number, contentType: string | null, filename: string, id: string, url: string | null}>>} - Attachment metadata entries.
     */
    list(): Promise<Array<{
        byteSize: number;
        contentType: string | null;
        filename: string;
        id: string;
        url: string | null;
    }>>;
    /**
     * Runs download url.
     * @returns {string} - Download URL for this attachment on the configured backend.
     */
    downloadUrl(): string;
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
export default class FrontendModelBase<Attributes extends object = any, CreateAttributes extends object = any, UpdateAttributes extends object = any> {
    static _generatedAttachmentMethods: boolean | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {string | undefined} */
    static modelName: string | undefined;
    /**
     * Autoload.
     * @type {boolean} - Global auto-batch-preload toggle. Apps can opt out via FrontendModelBase.setAutoload(false).
     */
    static _autoload: boolean;
    /**
     * Runs get autoload.
     * @returns {boolean} Whether auto-batch-preload of relationships on lazy access is enabled globally.
     */
    static getAutoload(): boolean;
    /**
     * Runs set autoload.
     * @param {boolean} newValue - Whether auto-batch-preload of relationships is enabled.
     * @returns {void}
     */
    static setAutoload(newValue: boolean): void;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, FrontendModelAttributeValue>} */
    _attributes: Record<string, FrontendModelAttributeValue>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, FrontendModelHasManyRelationship<FrontendModelBase, FrontendModelBase, Record<string, FrontendModelAttributeValue>> | FrontendModelSingularRelationship<FrontendModelBase, FrontendModelBase, Record<string, FrontendModelAttributeValue>>>} */
    _relationships: Record<string, FrontendModelHasManyRelationship<FrontendModelBase, FrontendModelBase, Record<string, FrontendModelAttributeValue>> | FrontendModelSingularRelationship<FrontendModelBase, FrontendModelBase, Record<string, FrontendModelAttributeValue>>>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, FrontendModelAttachmentHandle>} */
    _attachments: Record<string, FrontendModelAttachmentHandle>;
    /**
     * Rails-style nested attribute payloads queued for the next save.
     * @type {Record<string, ReturnType<typeof JSON.parse>>}
     */
    _pendingNestedAttributes: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Set<string> | null} */
    _selectedAttributes: Set<string> | null;
    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean} */
    _isNewRecord: boolean;
    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean} */
    _markedForDestruction: boolean;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, FrontendModelAttributeValue>} */
    _persistedAttributes: Record<string, FrontendModelAttributeValue>;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<FrontendModelBase> | undefined} - Shared reference to sibling records loaded in the same batch. Used by auto-batch-preload.
     */
    _loadCohort: Array<FrontendModelBase> | undefined;
    /**
     * Canonical backing-record attachment owner returned by the server.
     * @type {{recordId: string, recordType: string} | null}
     */
    _attachmentOwner: {
        recordId: string;
        recordType: string;
    } | null;
    /**
     * Runs constructor.
     * @param {Attributes | CreateAttributes} [attributes] - Initial attributes.
     */
    constructor(attributes?: Attributes | CreateAttributes);
    /**
     * Runs ensure generated attachment methods.
     * @this {FrontendModelClass}
     * @returns {void} - Ensures attachment helper methods exist on the prototype.
     */
    static ensureGeneratedAttachmentMethods(this: FrontendModelClass): void;
    /**
     * Runs resource config.
     * @returns {FrontendModelResourceConfig} - Resource configuration.
     */
    static resourceConfig(): FrontendModelResourceConfig;
    /**
     * Runs relationship model classes.
     * @this {FrontendModelClass}
     * @returns {Record<string, FrontendModelClass | string>} - Relationship model classes (or class name strings) keyed by relationship name.
     */
    static relationshipModelClasses(this: FrontendModelClass): Record<string, FrontendModelClass | string>;
    /**
     * Register a frontend model class so it can be resolved by name in relationship lookups.
     * @param {FrontendModelClass} modelClass - Model class to register.
     * @returns {void}
     */
    static registerModel(modelClass: FrontendModelClass): void;
    /**
     * Runs define scope.
     * @param {(...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>} callback - Scope callback.
     * @returns {((...args: Array<ReturnType<typeof JSON.parse>>) => import("./query.js").default<FrontendModelClass>) & {scope: (...args: Array<ReturnType<typeof JSON.parse>>) => import("../utils/model-scope.js").ModelScopeDescriptor}} - Scope helper.
     */
    static defineScope(callback: (...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>): ((...args: Array<ReturnType<typeof JSON.parse>>) => import("./query.js").default<FrontendModelClass>) & {
        scope: (...args: Array<ReturnType<typeof JSON.parse>>) => import("../utils/model-scope.js").ModelScopeDescriptor;
    };
    /**
     * Resolve a relationship model class value that may be a class reference or a string name.
     * @param {FrontendModelClass | string | null | undefined} value - Class or class name.
     * @returns {FrontendModelClass | null} - Resolved model class.
     */
    static resolveModelClass(value: FrontendModelClass | string | null | undefined): FrontendModelClass | null;
    /**
     * Runs relationship definitions.
     * @this {FrontendModelClass}
     * @returns {Record<string, {type: "belongsTo" | "hasOne" | "hasMany", autoload?: boolean}>} - Relationship definitions keyed by relationship name.
     */
    static relationshipDefinitions(this: FrontendModelClass): Record<string, {
        type: "belongsTo" | "hasOne" | "hasMany";
        autoload?: boolean;
    }>;
    /**
     * Runs attachment definitions.
     * @this {FrontendModelClass}
     * @returns {Record<string, FrontendModelAttachmentDefinition>} - Attachment definitions keyed by attachment name.
     */
    static attachmentDefinitions(this: FrontendModelClass): Record<string, FrontendModelAttachmentDefinition>;
    /**
     * Runs attachment definition.
     * @this {FrontendModelClass}
     * @param {string} attachmentName - Attachment name.
     * @returns {FrontendModelAttachmentDefinition | null} - Attachment definition.
     */
    static attachmentDefinition(this: FrontendModelClass, attachmentName: string): FrontendModelAttachmentDefinition | null;
    /**
     * Runs relationship definition.
     * @this {FrontendModelClass}
     * @param {string} relationshipName - Relationship name.
     * @returns {{type: "belongsTo" | "hasOne" | "hasMany", autoload?: boolean} | null} - Relationship definition.
     */
    static relationshipDefinition(this: FrontendModelClass, relationshipName: string): {
        type: "belongsTo" | "hasOne" | "hasMany";
        autoload?: boolean;
    } | null;
    /**
     * Resolves a Rails-style nested attributes key to a configured relationship.
     * @this {FrontendModelClass}
     * @param {string} attributeName - Candidate attribute name, such as `tasksAttributes`.
     * @returns {string | null} Relationship name when nested attributes are configured.
     */
    static nestedAttributesRelationshipName(this: FrontendModelClass, attributeName: string): string | null;
    /**
     * Runs relationship model class.
     * @this {FrontendModelClass}
     * @param {string} relationshipName - Relationship name.
     * @returns {FrontendModelClass | null} - Target relationship model class.
     */
    static relationshipModelClass(this: FrontendModelClass, relationshipName: string): FrontendModelClass | null;
    /**
     * Runs attributes.
     * @returns {Attributes} - Attributes hash.
     */
    attributes(): Attributes;
    /**
     * Runs is new record.
     * @returns {boolean} - Whether this model has not yet been persisted.
     */
    isNewRecord(): boolean;
    /**
     * Runs is persisted.
     * @returns {boolean} - Whether this model has been persisted.
     */
    isPersisted(): boolean;
    /**
     * Runs set is new record.
     * @param {boolean} newIsNewRecord - New persisted-state flag.
     * @returns {void}
     */
    setIsNewRecord(newIsNewRecord: boolean): void;
    /**
     * Marks this record for destruction when its parent is next saved through
     * nested-attribute support. The record is not removed from the parent's
     * relationship collection until the server confirms the delete.
     * @returns {void} - No return value.
     */
    markForDestruction(): void;
    /**
     * Runs marked for destruction.
     * @returns {boolean} - Whether this record is queued for nested destruction on next parent save.
     */
    markedForDestruction(): boolean;
    /**
     * Runs changes.
     * @returns {Record<string, Array<ReturnType<typeof JSON.parse>>>} - Changed attributes as `[oldValue, newValue]`.
     */
    changes(): Record<string, Array<ReturnType<typeof JSON.parse>>>;
    /**
     * Runs is changed.
     * @returns {boolean} - Whether any tracked attribute has changed.
     */
    isChanged(): boolean;
    /**
     * Runs get relationship by name.
     * @param {string} relationshipName - Relationship name.
     * @returns {FrontendModelRelationship} - Relationship state object.
     */
    getRelationshipByName(relationshipName: string): FrontendModelRelationship;
    /**
     * Runs get attachment by name.
     * @param {string} attachmentName - Attachment name.
     * @returns {FrontendModelAttachmentHandle} - Attachment helper.
     */
    getAttachmentByName(attachmentName: string): FrontendModelAttachmentHandle;
    /**
     * Runs load relationship.
     * @param {string} relationshipName - Relationship name.
     * @returns {Promise<FrontendModelBase | Array<FrontendModelBase> | null>} - Loaded relationship value.
     */
    loadRelationship(relationshipName: string): Promise<FrontendModelBase | Array<FrontendModelBase> | null>;
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
    preload(queryOrSpec: import("./query.js").default<FrontendModelClass> | import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>, options?: {
        force?: boolean;
    }): Promise<void>;
    /**
     * Runs relationship or load.
     * @param {string} relationshipName - Relationship name.
     * @returns {Promise<FrontendModelBase | Array<FrontendModelBase> | null>} - Loaded relationship value.
     */
    relationshipOrLoad(relationshipName: string): Promise<FrontendModelBase | Array<FrontendModelBase> | null>;
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
    _tryCohortPreload(relationshipName: string): Promise<boolean>;
    /**
     * Runs set relationship.
     * @param {string} relationshipName - Relationship name.
     * @param {FrontendModelBase | null | undefined} relationshipValue - Relationship value.
     * @returns {FrontendModelBase | null | undefined} - Assigned relationship value.
     */
    setRelationship(relationshipName: string, relationshipValue: FrontendModelBase | null | undefined): FrontendModelBase | null | undefined;
    /**
     * Runs assign attributes.
     * @param {Attributes | CreateAttributes | UpdateAttributes | Record<string, FrontendModelAttributeValue>} attributes - Attributes to assign.
     * @returns {void} - No return value.
     */
    assignAttributes(attributes: Attributes | CreateAttributes | UpdateAttributes | Record<string, FrontendModelAttributeValue>): void;
    /**
     * Runs clear relationship cache.
     * @returns {void} - Clears cached relationship state.
     */
    clearRelationshipCache(): void;
    /**
     * Runs primary key.
     * @this {FrontendModelClass}
     * @returns {import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition} - Primary key name.
     */
    static primaryKey(this: FrontendModelClass): import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition;
    /**
     * Runs primary key value.
     * @returns {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} - Primary key value.
     */
    primaryKeyValue(): import("../utils/model-primary-key.js").ModelPrimaryKeyValue;
    /**
     * Returns the scalar identity required by scalar-only frontend features.
     * @param {string} operation - Operation requiring a scalar identity.
     * @returns {import("../utils/model-primary-key.js").ModelPrimaryKeyScalar} - Scalar primary-key value.
     */
    scalarPrimaryKeyValue(operation: string): import("../utils/model-primary-key.js").ModelPrimaryKeyScalar;
    /**
     * Returns the identity represented by the last persisted frontend attributes.
     * @returns {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} - Persisted primary-key value.
     */
    persistedPrimaryKeyValue(): import("../utils/model-primary-key.js").ModelPrimaryKeyValue;
    /**
     * Runs read attribute.
     * @param {string} attributeName - Attribute name.
     * @returns {ReturnType<typeof JSON.parse>} - Attribute value.
     */
    readAttribute(attributeName: string): ReturnType<typeof JSON.parse>;
    /**
     * Whether an attribute value is currently loaded on this record. Used by the
     * preloader to decide whether a relationship can be skipped because the
     * requested columns are already present.
     * @param {string} attributeName - Attribute name.
     * @returns {boolean} - Whether the attribute is loaded.
     */
    hasLoadedAttribute(attributeName: string): boolean;
    /**
     * Read an association count attached by `.withCount(...)`. Counts
     * live on a dedicated map separate from the record's attributes so
     * a virtual count like `tasksCount` can't silently shadow a real
     * column of the same name. Returns the attached value, or 0 when
     * `.withCount(...)` wasn't requested for this attribute.
     * @param {string} attributeName - Attribute name, e.g. `"tasksCount"` or a custom name from `.withCount({customName: {...}})`.
     * @returns {number} - Attached association count, or zero when absent.
     */
    readCount(attributeName: string): number;
    /**
     * Internal setter called by `instantiateFromResponse` when hydrating
     * association counts that rode along with the record payload.
     * @param {string} attributeName - Attribute name.
     * @param {number} value - Count value.
     * @returns {void}
     */
    _setAssociationCount(attributeName: string, value: number): void;
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
    can(action: string): boolean;
    /**
     * Internal setter called by `instantiateFromResponse` when hydrating
     * per-record ability results that rode along with the record
     * payload.
     * @param {string} action - Ability action name.
     * @param {boolean} value - Whether the current ability permits the action on this record.
     * @returns {void}
     */
    _setComputedAbility(action: string, value: boolean): void;
    /**
     * Read a consumer-defined value attached by `.queryData(...)`. Stored
     * on a dedicated map rather than `_attributes`, so a virtual alias
     * like `tasksCount` cannot silently shadow a real column of the same
     * name. Returns `null` when no registered fn produced that alias for
     * this record (e.g. no child rows matched the aggregate).
     * @param {string} name - queryData alias name.
     * @returns {ReturnType<typeof JSON.parse>} - Attached query-data value.
     */
    queryData(name: string): ReturnType<typeof JSON.parse>;
    /**
     * Internal setter used by `instantiateFromResponse` when hydrating
     * queryData values that rode along with the record payload.
     * @param {string} name - queryData alias name.
     * @param {ReturnType<typeof JSON.parse>} value - Attached value.
     * @returns {void}
     */
    _setQueryData(name: string, value: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs set attribute.
     * @param {string} attributeName - Attribute name.
     * @param {ReturnType<typeof JSON.parse>} newValue - New value.
     * @returns {ReturnType<typeof JSON.parse>} - Assigned value.
     */
    setAttribute(attributeName: string, newValue: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
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
    _invalidateRelationshipsForAttribute(attributeName: string): void;
    /**
     * Runs resource path.
     * @this {FrontendModelClass}
     * @returns {string} - Derived resource path.
     */
    static resourcePath(this: FrontendModelClass): string;
    /**
     * Runs command name.
     * @this {FrontendModelClass}
     * @param {FrontendModelCommandType} commandType - Command type.
     * @returns {string} - Resolved command name.
     */
    static commandName(this: FrontendModelClass, commandType: FrontendModelCommandType): string;
    /**
     * Runs normalize custom command payload arguments.
     * @this {FrontendModelClass}
     * @param {Array<ReturnType<typeof JSON.parse>>} args - Command arguments.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Command payload.
     */
    static normalizeCustomCommandPayloadArguments(this: FrontendModelClass, args: Array<ReturnType<typeof JSON.parse>>): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Returns the model name, preferring an explicit `static modelName` declaration
     * over the JavaScript class `.name` property. This allows minified builds to
     * preserve correct model names without relying on `keep_classnames`.
     * @this {FrontendModelClass}
     * @returns {string} - The model name.
     */
    static getModelName(this: FrontendModelClass): string;
    /**
     * Runs configure transport.
     * @param {FrontendModelTransportConfig} config - Frontend model transport configuration.
     * @returns {void} - No return value.
     */
    static configureTransport(config: FrontendModelTransportConfig): void;
    /**
     * Connect the internal WebSocket and enable auto-reconnect.
     * @param {{timeoutMs?: number, signal?: AbortSignal}} [options] - Startup controls composed with the configured transport controls.
     * @returns {Promise<void>} - Resolves when connected.
     */
    static connectWebsocket(options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<void>;
    /**
     * Disconnect the internal WebSocket and disable auto-reconnect.
     * @returns {Promise<void>} - Resolves when closed.
     */
    static disconnectWebsocket(): Promise<void>;
    /**
     * Waits until queued and active frontend-model transport requests finish.
     * @param {FrontendModelIdleWaitArgs} [args] - Wait options.
     * @returns {Promise<void>} - Resolves when transport is idle.
     */
    static waitForIdle(args?: FrontendModelIdleWaitArgs): Promise<void>;
    /**
     * Returns the current WebSocket connection state.
     * @returns {{disconnectedSince: number | null, hasClient: boolean, isOpen: boolean, listenerCount: number}} - Snapshot of the managed websocket connection state.
     */
    static websocketState(): {
        disconnectedSince: number | null;
        hasClient: boolean;
        isOpen: boolean;
        listenerCount: number;
    };
    /**
     * Close the raw WebSocket without disabling auto-reconnect. Used by tests to
     * simulate an unexpected network drop and verify reconnection behavior.
     * @returns {Promise<void>} - Resolves when the socket has closed.
     */
    static dropWebsocket(): Promise<void>;
    /**
     * Sets global metadata on the WebSocket connection. Sent to the server immediately
     * over WebSocket and exposed to WebSocket-borne requests as request metadata.
     * @param {string} key - Metadata key.
     * @param {ReturnType<typeof JSON.parse>} value - Metadata value (null to clear).
     * @returns {void}
     */
    static setWebsocketMetadata(key: string, value: ReturnType<typeof JSON.parse>): void;
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
    static openManagedConnection(connectionType: string, options: {
        shouldConnect: () => boolean;
        params: () => Record<string, ReturnType<typeof JSON.parse>>;
        signal?: AbortSignal;
        onMessage?: (body: ReturnType<typeof JSON.parse>) => void;
    }): {
        sync: () => void;
        close: () => void;
    };
    /**
     * Opens a 1:1 `WebsocketConnection` of the given type. Thin
     * convenience wrapper around the internal WS client's
     * `openConnection`. Apps use this for per-session state/messaging
     * that doesn't fit the pub/sub Channel model (locale, presence).
     * @param {string} connectionType - Name the server registered the class under.
     * @param {{params?: Record<string, ReturnType<typeof JSON.parse>>, timeoutMs?: number, signal?: AbortSignal, onConnect?: () => void, onMessage?: (body: Record<string, unknown>) => void, onDisconnect?: () => void, onResume?: () => void, onClose?: (reason: string) => void}} [options] - Connection options, readiness controls, and event handlers. Connect the client first; the timeout covers server-confirmed readiness and the signal cancels readiness without entering the wire payload.
     * @returns {{ready: Promise<void>, close: () => void}} - Websocket connection handle.
     */
    static openWebsocketConnection(connectionType: string, options?: {
        params?: Record<string, ReturnType<typeof JSON.parse>>;
        timeoutMs?: number;
        signal?: AbortSignal;
        onConnect?: () => void;
        onMessage?: (body: Record<string, unknown>) => void;
        onDisconnect?: () => void;
        onResume?: () => void;
        onClose?: (reason: string) => void;
    }): {
        ready: Promise<void>;
        close: () => void;
    };
    /**
     * Subscribes to a pub/sub `WebsocketChannel`. Thin wrapper around
     * the internal client's `subscribeChannel`.
     * @param {string} channelType - Channel class name registered on the server.
     * @param {{params?: Record<string, ReturnType<typeof JSON.parse>>, timeoutMs?: number, signal?: AbortSignal, onMessage?: (body: Record<string, unknown>) => void, onDisconnect?: () => void, onResume?: () => void, onClose?: (reason: string) => void}} [options] - Channel options, startup controls, and event handlers. The timeout covers connect and server-confirmed readiness only; the signal cancels startup without entering the wire payload.
     * @returns {{ready: Promise<void>, close: () => void}} - Websocket channel handle from the configured client.
     */
    static subscribeWebsocketChannel(channelType: string, options?: {
        params?: Record<string, ReturnType<typeof JSON.parse>>;
        timeoutMs?: number;
        signal?: AbortSignal;
        onMessage?: (body: Record<string, unknown>) => void;
        onDisconnect?: () => void;
        onResume?: () => void;
        onClose?: (reason: string) => void;
    }): {
        ready: Promise<void>;
        close: () => void;
    };
    /**
     * Installs WebSocket lifecycle hooks on globalThis for system test access.
     * Tests can call `globalThis.__velocious_websocket_hooks.connect()` etc.
     * @returns {void}
     */
    static installWebsocketTestHooks(): void;
    /**
     * Runs attributes from response.
     * @this {FrontendModelClass}
     * @param {object} response - Response payload.
     * @returns {Record<string, FrontendModelAttributeValue>} - Attributes from payload.
     */
    static attributesFromResponse(this: FrontendModelClass, response: object): Record<string, FrontendModelAttributeValue>;
    /**
     * Runs model data from response.
     * @this {FrontendModelClass}
     * @param {object} response - Response payload.
     * @returns {{abilities: Record<string, boolean>, attachmentOwner: {recordId: string, recordType: string} | null, attributes: Record<string, FrontendModelAttributeValue>, associationCounts: Record<string, number>, queryData: Record<string, FrontendModelAttributeValue>, preloadedRelationships: Record<string, FrontendModelAttributeValue>, selectedAttributes: Set<string>}} - Attributes, attachment owner, preloaded relationships, association counts, queryData, abilities, and selected attributes.
     */
    static modelDataFromResponse(this: FrontendModelClass, response: object): {
        abilities: Record<string, boolean>;
        attachmentOwner: {
            recordId: string;
            recordType: string;
        } | null;
        attributes: Record<string, FrontendModelAttributeValue>;
        associationCounts: Record<string, number>;
        queryData: Record<string, FrontendModelAttributeValue>;
        preloadedRelationships: Record<string, FrontendModelAttributeValue>;
        selectedAttributes: Set<string>;
    };
    /**
     * Runs apply preloaded relationships.
     * @this {FrontendModelClass}
     * @param {FrontendModelBase} model - Model instance.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} preloadedRelationships - Preloaded relationship payload.
     * @returns {void}
     */
    static applyPreloadedRelationships(this: FrontendModelClass, model: FrontendModelBase, preloadedRelationships: Record<string, ReturnType<typeof JSON.parse>>): void;
    /**
     * Runs instantiate relationship value.
     * @this {FrontendModelClass}
     * @param {ReturnType<typeof JSON.parse>} relationshipPayload - Relationship payload value.
     * @param {FrontendModelClass | null} targetModelClass - Target model class.
     * @returns {ReturnType<typeof JSON.parse>} - Instantiated relationship value.
     */
    static instantiateRelationshipValue(this: FrontendModelClass, relationshipPayload: ReturnType<typeof JSON.parse>, targetModelClass: FrontendModelClass | null): ReturnType<typeof JSON.parse>;
    /**
     * Runs instantiate from response.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>> | InstanceType<T>} response - Response payload, or an already-hydrated instance of this class.
     * @returns {InstanceType<T>} - New model instance, or the same instance unchanged if it was already hydrated.
     */
    static instantiateFromResponse<T extends FrontendModelClass>(this: T, response: Record<string, ReturnType<typeof JSON.parse>> | InstanceType<T>): InstanceType<T>;
    /**
     * Runs find.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {number | string} id - Record identifier.
     * @returns {Promise<InstanceType<T>>} - Resolved model.
     */
    static find<T extends FrontendModelClass>(this: T, id: number | string): Promise<InstanceType<T>>;
    /**
     * Runs find by.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Attribute match conditions.
     * @returns {Promise<InstanceType<T> | null>} - Found model or null.
     */
    static findBy<T extends FrontendModelClass>(this: T, conditions: Record<string, ReturnType<typeof JSON.parse>>): Promise<InstanceType<T> | null>;
    /**
     * Runs find by or fail.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Attribute match conditions.
     * @returns {Promise<InstanceType<T>>} - Found model.
     */
    static findByOrFail<T extends FrontendModelClass>(this: T, conditions: Record<string, ReturnType<typeof JSON.parse>>): Promise<InstanceType<T>>;
    /**
     * Runs to array.
     * @template {FrontendModelClass} T
     * @this {T}
     * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
     */
    static toArray<T extends FrontendModelClass>(this: T): Promise<InstanceType<T>[]>;
    /**
     * Runs load.
     * @template {FrontendModelClass} T
     * @this {T}
     * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
     */
    static load<T extends FrontendModelClass>(this: T): Promise<InstanceType<T>[]>;
    /**
     * Runs all.
     * @template {FrontendModelClass} T
     * @this {T}
     * @returns {FrontendModelQuery<T>} - Query builder.
     */
    static all<T extends FrontendModelClass>(this: T): FrontendModelQuery<T>;
    /**
     * Runs where.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Root-model where conditions.
     * @returns {import("./query.js").default<T>} - Query with where conditions.
     */
    static where<T extends FrontendModelClass>(this: T, conditions: Record<string, ReturnType<typeof JSON.parse>>): import("./query.js").default<T>;
    /**
     * Runs joins.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} joins - Relationship descriptor joins.
     * @returns {import("./query.js").default<T>} - Query with joins.
     */
    static joins<T extends FrontendModelClass>(this: T, joins: Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>): import("./query.js").default<T>;
    /**
     * Runs limit.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {number} value - Maximum number of records.
     * @returns {import("./query.js").default<T>} - Query with limit.
     */
    static limit<T extends FrontendModelClass>(this: T, value: number): import("./query.js").default<T>;
    /**
     * Runs offset.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {number} value - Number of records to skip.
     * @returns {import("./query.js").default<T>} - Query with offset.
     */
    static offset<T extends FrontendModelClass>(this: T, value: number): import("./query.js").default<T>;
    /**
     * Runs page.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {number} pageNumber - 1-based page number.
     * @returns {import("./query.js").default<T>} - Query with page applied.
     */
    static page<T extends FrontendModelClass>(this: T, pageNumber: number): import("./query.js").default<T>;
    /**
     * Runs per page.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {number} value - Number of records per page.
     * @returns {import("./query.js").default<T>} - Query with page size.
     */
    static perPage<T extends FrontendModelClass>(this: T, value: number): import("./query.js").default<T>;
    /**
     * Runs count.
     * @template {FrontendModelClass} T
     * @this {T}
     * @returns {Promise<number>} - Number of loaded model instances.
     */
    static count<T extends FrontendModelClass>(this: T): Promise<number>;
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
    static onCreate(this: FrontendModelClass, callback: (payload: {
        id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue;
        model: FrontendModelBase;
    }) => void, options?: import("./query.js").FrontendModelEventOptions): Promise<() => void>;
    /**
     * Class-level hook fired when any record of this model is updated.
     * @this {FrontendModelClass}
     * @param {(payload: {id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue, model: FrontendModelBase}) => void} callback - Event callback.
     * @param {import("./query.js").FrontendModelEventOptions} [options] - Event query or record projection options.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    static onUpdate(this: FrontendModelClass, callback: (payload: {
        id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue;
        model: FrontendModelBase;
    }) => void, options?: import("./query.js").FrontendModelEventOptions): Promise<() => void>;
    /**
     * Class-level hook fired when any record of this model is destroyed.
     * @this {FrontendModelClass}
     * @param {(payload: {id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue}) => void} callback - Event callback.
     * @param {import("./query.js").FrontendModelEventOptions} [options] - Accepted for API symmetry; destroy events carry ids only.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    static onDestroy(this: FrontendModelClass, callback: (payload: {
        id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue;
    }) => void, options?: import("./query.js").FrontendModelEventOptions): Promise<() => void>;
    /**
     * Instance-level hook fired when THIS record is updated. The
     * instance's attributes are auto-merged with the broadcast payload
     * before the callback runs, so callers can read fresh values via
     * `this.someAttr()` without re-fetching.
     * @param {(payload: {id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue, model: FrontendModelBase}) => void} callback - Event callback.
     * @param {import("./query.js").FrontendModelEventOptions} [options] - Event query or record projection options.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    onUpdate(callback: (payload: {
        id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue;
        model: FrontendModelBase;
    }) => void, options?: import("./query.js").FrontendModelEventOptions): Promise<() => void>;
    /**
     * Instance-level hook fired when THIS record is destroyed.
     * @param {(payload: {id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue}) => void} callback - Event callback.
     * @param {import("./query.js").FrontendModelEventOptions} [options] - Accepted for API symmetry; destroy events carry ids only.
     * @returns {Promise<() => void>} - Unsubscribe callback.
     */
    onDestroy(callback: (payload: {
        id: string | import("../utils/model-primary-key.js").CompositeModelPrimaryKeyValue;
    }) => void, options?: import("./query.js").FrontendModelEventOptions): Promise<() => void>;
    /**
     * Runs pluck.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {...(string | string[] | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>)} columns - Pluck definition(s).
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Plucked values.
     */
    static pluck<T extends FrontendModelClass>(this: T, ...columns: (string | string[] | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>)[]): Promise<Array<ReturnType<typeof JSON.parse>>>;
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
    static search<T extends FrontendModelClass>(this: T, path: string[], column: string, operator: "eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | ">" | ">=" | "<" | "<=", value: ReturnType<typeof JSON.parse>): FrontendModelQuery<T>;
    /**
     * Runs ransack.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Ransack-style params hash.
     * @returns {FrontendModelQuery<T>} - Query builder with Ransack filters applied.
     */
    static ransack<T extends FrontendModelClass>(this: T, params: Record<string, ReturnType<typeof JSON.parse>>): FrontendModelQuery<T>;
    /**
     * Runs sort.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} sort - Sort definition(s).
     * @returns {FrontendModelQuery<T>} - Query builder with sort definitions.
     */
    static sort<T extends FrontendModelClass>(this: T, sort: string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>): FrontendModelQuery<T>;
    /**
     * Runs order.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} sort - Sort definition(s).
     * @returns {FrontendModelQuery<T>} - Query builder with sort definitions.
     */
    static order<T extends FrontendModelClass>(this: T, sort: string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>): FrontendModelQuery<T>;
    /**
     * Runs group.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {string | string[] | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>} group - Group definition(s).
     * @returns {FrontendModelQuery<T>} - Query builder with group definitions.
     */
    static group<T extends FrontendModelClass>(this: T, group: string | string[] | Record<string, ReturnType<typeof JSON.parse>> | Array<Record<string, ReturnType<typeof JSON.parse>>>): FrontendModelQuery<T>;
    /**
     * Runs distinct.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {boolean} [value] - Whether to request distinct rows.
     * @returns {FrontendModelQuery<T>} - Query builder with distinct flag.
     */
    static distinct<T extends FrontendModelClass>(this: T, value?: boolean): FrontendModelQuery<T>;
    /**
     * Runs query.
     * @template {FrontendModelClass} T
     * @this {T}
     * @returns {FrontendModelQuery<T>} - Query builder.
     */
    static query<T extends FrontendModelClass>(this: T): FrontendModelQuery<T>;
    /**
     * Runs preload.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>} preload - Preload graph.
     * @returns {FrontendModelQuery<T>} - Query with preload.
     */
    static preload<T extends FrontendModelClass>(this: T, preload: import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>): FrontendModelQuery<T>;
    /**
     * Runs select.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, string[] | string> | string | string[]} select - Model-aware attribute select map or root-model shorthand.
     * @returns {FrontendModelQuery<T>} - Query with selected attributes.
     */
    static select<T extends FrontendModelClass>(this: T, select: Record<string, string[] | string> | string | string[]): FrontendModelQuery<T>;
    /**
     * Runs selects extra.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, string[] | string> | string | string[]} select - Extra attributes to load in addition to the defaults, keyed by model name or root-model shorthand.
     * @returns {FrontendModelQuery<T>} - Query with extra selected attributes.
     */
    static selectsExtra<T extends FrontendModelClass>(this: T, select: Record<string, string[] | string> | string | string[]): FrontendModelQuery<T>;
    /**
     * Runs first.
     * @template {FrontendModelClass} T
     * @this {T}
     * @returns {Promise<InstanceType<T> | null>} - First model or null.
     */
    static first<T extends FrontendModelClass>(this: T): Promise<InstanceType<T> | null>;
    /**
     * Runs last.
     * @template {FrontendModelClass} T
     * @this {T}
     * @returns {Promise<InstanceType<T> | null>} - Last model or null.
     */
    static last<T extends FrontendModelClass>(this: T): Promise<InstanceType<T> | null>;
    /**
     * Runs find or initialize by.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Attribute match conditions.
     * @returns {Promise<InstanceType<T>>} - Existing or initialized model.
     */
    static findOrInitializeBy<T extends FrontendModelClass>(this: T, conditions: Record<string, ReturnType<typeof JSON.parse>>): Promise<InstanceType<T>>;
    /**
     * Runs find or create by.
     * @template {FrontendModelClass} T
     * @this {T}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Attribute match conditions.
     * @param {(model: InstanceType<T>) => Promise<void> | void} [callback] - Optional callback before save when created.
     * @returns {Promise<InstanceType<T>>} - Existing or newly created model.
     */
    static findOrCreateBy<T extends FrontendModelClass>(this: T, conditions: Record<string, ReturnType<typeof JSON.parse>>, callback?: (model: InstanceType<T>) => Promise<void> | void): Promise<InstanceType<T>>;
    /**
     * Runs create.
     * @template {FrontendModelClass} ModelClass
     * @this {ModelClass}
     * @param {FrontendModelCreateAttributesFor<InstanceType<ModelClass>>} [attributes] - Initial attributes.
     * @returns {Promise<InstanceType<ModelClass>>} - Persisted model.
     */
    static create<ModelClass extends FrontendModelClass>(this: ModelClass, attributes?: FrontendModelCreateAttributesFor<InstanceType<ModelClass>>): Promise<InstanceType<ModelClass>>;
    /**
     * Runs assert find by conditions.
     * @this {FrontendModelClass}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - findBy conditions.
     * @returns {void}
     */
    static assertFindByConditions(this: FrontendModelClass, conditions: Record<string, ReturnType<typeof JSON.parse>>): void;
    /**
     * Runs matches find by conditions.
     * @this {FrontendModelClass}
     * @param {FrontendModelBase} model - Candidate model.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} conditions - Match conditions.
     * @returns {boolean} - Whether the model matches all conditions.
     */
    static matchesFindByConditions(this: FrontendModelClass, model: FrontendModelBase, conditions: Record<string, ReturnType<typeof JSON.parse>>): boolean;
    /**
     * Runs find by condition value matches.
     * @this {FrontendModelClass}
     * @param {ReturnType<typeof JSON.parse>} actualValue - Actual model value.
     * @param {ReturnType<typeof JSON.parse>} expectedValue - Expected find condition value.
     * @returns {boolean} - Whether values match.
     */
    static findByConditionValueMatches(this: FrontendModelClass, actualValue: ReturnType<typeof JSON.parse>, expectedValue: ReturnType<typeof JSON.parse>): boolean;
    /**
     * Runs find by primitive values match.
     * @this {FrontendModelClass}
     * @param {ReturnType<typeof JSON.parse>} actualValue - Actual model value.
     * @param {ReturnType<typeof JSON.parse>} expectedValue - Expected find condition value.
     * @returns {boolean} - Whether primitive values match after safe coercion.
     */
    static findByPrimitiveValuesMatch(this: FrontendModelClass, actualValue: ReturnType<typeof JSON.parse>, expectedValue: ReturnType<typeof JSON.parse>): boolean;
    /**
     * Runs find by numeric string matches number.
     * @this {FrontendModelClass}
     * @param {string} numericString - Numeric string value.
     * @param {number} expectedNumber - Number value.
     * @returns {boolean} - Whether values represent the same number.
     */
    static findByNumericStringMatchesNumber(this: FrontendModelClass, numericString: string, expectedNumber: number): boolean;
    /**
     * Runs update.
     * @param {UpdateAttributes} [newAttributes] - New values to assign before update.
     * @returns {Promise<this>} - Updated model.
     */
    update(newAttributes?: UpdateAttributes): Promise<this>;
    /**
     * Runs attach.
     * @param {ReturnType<typeof JSON.parse>} attachmentInput - Attachment input or named attachment payload.
     * @returns {Promise<void>} - Resolves when attached.
     */
    attach(attachmentInput: ReturnType<typeof JSON.parse>): Promise<void>;
    /**
     * Runs save.
     * @returns {Promise<this>} - Saved model.
     */
    save(): Promise<this>;
    /**
     * Returns the subset of `_attributes` whose value has diverged from
     * `_persistedAttributes`. Used by `save()` so the server receives only the
     * fields the caller actually changed — avoiding strict permit rejections on
     * framework-managed fields like `id`, `createdAt`, `updatedAt`, or owner
     * foreign keys that the resource never lists in `permittedParams`.
     * @returns {Record<string, FrontendModelAttributeValue>} - Changed attributes hash.
     */
    _changedAttributesForSave(): Record<string, FrontendModelAttributeValue>;
    /**
     * Marks the current value for an attribute as already persisted so the next
     * save does not send it unless the caller changes it again.
     * @param {string} attributeName - Attribute to mark unchanged.
     * @returns {void}
     */
    markAttributeUnchanged(attributeName: string): void;
    /**
     * Runs destroy.
     * @returns {Promise<void>} - Resolves when destroyed on backend.
     */
    destroy(): Promise<void>;
    /**
     * Builds the attachment payload queued on this model for the next save.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Attachment payload keyed by attachment name.
     */
    _buildAttachmentsPayload(): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /** Clears queued attachment inputs after a successful save. */
    _clearPendingAttachments(): void;
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
    _buildNestedAttributesPayload(): Promise<Record<string, Array<Record<string, ReturnType<typeof JSON.parse>>>>>;
    /**
     * Builds the payload entry for this child when walked by a parent's
     * `_buildNestedAttributesPayload`. Returns `null` when the child has no
     * dirty state and no dirty descendants, so the parent can omit it.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Nested-attribute entry or null if clean.
     */
    _nestedAttributesEntryForParentSave(): Promise<Record<string, ReturnType<typeof JSON.parse>> | null>;
    /**
     * Builds nested entries from a Rails-style submitted `*Attributes` value.
     * @param {FrontendModelClass} ModelClass - Parent model class.
     * @param {string} relationshipName - Nested relationship name.
     * @param {ReturnType<typeof JSON.parse>} value - Submitted nested attributes value.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} Nested entries for the transport payload.
     */
    _nestedAttributesPayloadForSubmittedValue(ModelClass: FrontendModelClass, relationshipName: string, value: ReturnType<typeof JSON.parse>): Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>;
    /**
     * Converts one submitted Rails-style nested attributes object into transport payload shape.
     * @param {FrontendModelClass} ModelClass - Nested child model class.
     * @param {ReturnType<typeof JSON.parse>} submittedEntry - Submitted nested attributes entry.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Transport nested-attributes entry.
     */
    _nestedAttributesEntryPayloadForSubmittedValue(ModelClass: FrontendModelClass, submittedEntry: ReturnType<typeof JSON.parse>): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Normalizes a submitted attachment value for transport.
     * @param {FrontendModelClass} ModelClass - Model class owning the attachment.
     * @param {string} attachmentName - Attachment name.
     * @param {ReturnType<typeof JSON.parse>} value - Submitted attachment value.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | Record<string, ReturnType<typeof JSON.parse>>[]>} Normalized attachment payload.
     */
    _attachmentPayloadForSubmittedValue(ModelClass: FrontendModelClass, attachmentName: string, value: ReturnType<typeof JSON.parse>): Promise<Record<string, ReturnType<typeof JSON.parse>> | Record<string, ReturnType<typeof JSON.parse>>[]>;
    /**
     * After a parent save with `nestedAttributes`, the server response includes
     * preloaded versions of the affected relationships. This replaces the local
     * `_loadedValue` for each nested-writable relationship with the server's
     * authoritative set, so destroyed children are dropped and newly-created
     * children get their server-assigned ids + persisted state.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} response - Command response payload.
     * @returns {void}
     */
    _reconcileNestedAttributesFromResponse(response: Record<string, ReturnType<typeof JSON.parse>>): void;
    /**
     * Runs execute command.
     * @this {FrontendModelClass}
     * @param {FrontendModelCommandType} commandType - Command type.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} payload - Command payload.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Parsed JSON response.
     */
    static executeCommand(this: FrontendModelClass, commandType: FrontendModelCommandType, payload: Record<string, ReturnType<typeof JSON.parse>>): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Runs execute custom command.
     * @this {FrontendModelClass}
     * @param {{commandName: string, commandType: FrontendModelRequestCommandType, memberId?: string | number | null, payload: Record<string, ReturnType<typeof JSON.parse>>, resourcePath: string}} args - Command arguments.
     * @returns {Promise<Record<string, FrontendModelAttributeValue>>} - Decoded response payload.
     */
    static executeCustomCommand(this: FrontendModelClass, args: {
        commandName: string;
        commandType: FrontendModelRequestCommandType;
        memberId?: string | number | null;
        payload: Record<string, ReturnType<typeof JSON.parse>>;
        resourcePath: string;
    }): Promise<Record<string, FrontendModelAttributeValue>>;
    /**
     * Runs throw on error frontend model response.
     * @this {FrontendModelClass}
     * @param {{commandType: FrontendModelRequestCommandType, response: Record<string, ReturnType<typeof JSON.parse>>}} args - Arguments.
     * @returns {void}
     */
    static throwOnErrorFrontendModelResponse(this: FrontendModelClass, args: {
        commandType: FrontendModelRequestCommandType;
        response: Record<string, ReturnType<typeof JSON.parse>>;
    }): void;
    /**
     * Runs configured frontend model attribute names.
     * @this {FrontendModelClass}
     * @returns {Set<string>} - Configured frontend model attribute names.
     */
    static configuredFrontendModelAttributeNames(this: FrontendModelClass): Set<string>;
}
/** Public frontend model for safe Velocious attachment metadata. */
export declare class VelociousAttachment extends FrontendModelBase {
    /**
     * Runs resource config.
     * @returns {FrontendModelResourceConfig} - Resource config.
     */
    static resourceConfig(): FrontendModelResourceConfig;
    /**
     * Returns the attachment id.
     * @returns {string} - Attachment id.
     */
    id(): string;
    /**
     * Returns the owner model name.
     * @returns {string} - Owner model name.
     */
    recordType(): string;
    /**
     * Returns the owner record id.
     * @returns {string} - Owner record id.
     */
    recordId(): string;
    /**
     * Returns the attachment name on the owner model.
     * @returns {string} - Attachment name on the owner model.
     */
    name(): string;
    /**
     * Returns the attachment position.
     * @returns {number} - Attachment position.
     */
    position(): number;
    /**
     * Returns the attachment filename.
     * @returns {string} - Attachment filename.
     */
    filename(): string;
    /**
     * Returns the attachment content type.
     * @returns {string | null} - Attachment content type.
     */
    contentType(): string | null;
    /**
     * Returns the attachment byte size.
     * @returns {number} - Attachment byte size.
     */
    byteSize(): number;
    /**
     * Returns the created-at timestamp.
     * @returns {Date} - Created-at timestamp.
     */
    createdAt(): Date;
    /**
     * Returns the updated-at timestamp.
     * @returns {Date} - Updated-at timestamp.
     */
    updatedAt(): Date;
}
//# sourceMappingURL=base.d.ts.map