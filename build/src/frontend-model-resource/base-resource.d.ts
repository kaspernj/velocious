import AuthorizationBaseResource from "../authorization/base-resource.js";
export type FrontendModelResourceModelClass = import("../authorization/base-resource.js").AuthorizationResourceModelClass & {
    attachmentDefinitions: () => Record<string, import("../configuration-types.js").FrontendModelAttachmentConfiguration>;
    primaryKey: () => string;
};
export type FrontendModelResourceAction = "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url";
export type FrontendModelResourceController = import("../controller.js").default & {
    currentAbility: () => import("../authorization/ability.js").default | undefined;
    applyFrontendModelPagination: (args: {
        pagination: FrontendModelResourcePagination;
        query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>;
    }) => void;
    applyFrontendModelSearch: (args: {
        query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>;
        search: FrontendModelResourceSearch;
    }) => void;
    applyFrontendModelSort: (args: {
        query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>;
        sort: FrontendModelResourceSort;
    }) => void;
    frontendModelAbilityAction: (action: FrontendModelResourceAction) => string;
    frontendModelAbilityAuthorizedQuery: (action: FrontendModelResourceAction) => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>;
    frontendModelAuthorizedQuery: (action: FrontendModelResourceAction) => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>;
    frontendModelIndexQuery: (options?: FrontendModelResourceIndexQueryOptions & {
        resource?: Pick<FrontendModelBaseResource<FrontendModelResourceModelClass>, "applyFrontendModelIndexPagination" | "applyFrontendModelIndexSearch" | "applyFrontendModelIndexSort">;
    }) => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>;
    frontendModelParams: () => import("../configuration-types.js").VelociousParams;
    frontendModelPreload: () => import("../database/query/index.js").NestedPreloadRecord | null;
    frontendModelResourceConfigurationForModelClass: (modelClass: typeof import("../database/record/index.js").default) => FrontendModelResolvedResourceConfiguration | null;
    serializeFrontendModel: (model: import("../database/record/index.js").default) => Promise<Record<string, object | string | number | boolean | null>>;
};
export type FrontendModelResourceAnyQuery = import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>;
export type FrontendModelResourceIndexQueryOptions = {
    /**
     * - Whether frontend-model pagination params should be applied.
     */
    includePagination?: boolean;
    /**
     * - Whether frontend-model sort params should be applied.
     */
    includeSort?: boolean;
};
export type FrontendModelResourcePagination = {
    /**
     * - Maximum number of records.
     */
    limit: number | null;
    /**
     * - Number of records to skip.
     */
    offset: number | null;
    /**
     * - 1-based page number.
     */
    page: number | null;
    /**
     * - Page size.
     */
    perPage: number | null;
};
export type FrontendModelResourceSearch = {
    /**
     * - Column or attribute name.
     */
    column: string;
    /**
     * - Search operator.
     */
    operator: "eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq";
    /**
     * - Relationship path.
     */
    path: string[];
    /**
     * - Search value.
     */
    value: ReturnType<typeof JSON.parse>;
};
export type FrontendModelResourceSort = {
    /**
     * - Attribute name to sort by.
     */
    column: string;
    /**
     * - Sort direction.
     */
    direction: "asc" | "desc";
    /**
     * - Relationship path from root model.
     */
    path: string[];
};
export type FrontendModelResourceControllerArgs = {
    /**
     * - Frontend-model controller instance.
     */
    controller: FrontendModelResourceController;
    /**
     * - Backing model class.
     */
    modelClass: typeof import("../database/record/index.js").default;
    /**
     * - Model name.
     */
    modelName: string;
    /**
     * - Request params.
     */
    params: import("../configuration-types.js").VelociousParams;
    /**
     * - Normalized resource configuration (or raw input shape during early bootstrap).
     */
    resourceConfiguration: import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | import("../configuration-types.js").FrontendModelResourceConfiguration;
};
export type FrontendModelResourceAbilityArgs<TModelClass extends FrontendModelResourceModelClass = FrontendModelResourceModelClass> = {
    /**
     * - Ability instance when the resource is used directly for authorization.
     */
    ability?: import("../authorization/ability.js").default;
    /**
     * - Velocious configuration for controller-less construction (for example the sync websocket channel); the controller path derives it from the controller instead.
     */
    configuration?: import("../configuration.js").default;
    /**
     * - Ability context.
     */
    context?: import("../configuration-types.js").VelociousLooseObject;
    /**
     * - Ability locals.
     */
    locals?: import("../configuration-types.js").VelociousLooseObject;
    /**
     * - Optional backing model class override.
     */
    modelClass?: TModelClass;
    /**
     * - Optional model name override.
     */
    modelName?: string;
    /**
     * - Optional params override.
     */
    params?: import("../configuration-types.js").VelociousParams;
    /**
     * - Optional normalized resource configuration.
     */
    resourceConfiguration?: import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | import("../configuration-types.js").FrontendModelResourceConfiguration;
};
export type FrontendModelSyncMutation = import("../sync/sync-envelope-replay-service.js").SyncReplayMutation;
export type FrontendModelSyncAuthorization = {
    /**
     * - Whether the mutation may be applied.
     */
    allowed: boolean;
    /**
     * - Stable failure reason code when denied.
     */
    reason?: string;
};
export type FrontendModelApplySyncArgs = {
    /**
     * - Replay context.
     */
    context: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Existing sync row or null.
     */
    existingSync: import("../database/record/index.js").default | null;
    /**
     * - Normalized replay mutation.
     */
    mutation: FrontendModelSyncMutation;
};
export type FrontendModelSyncApplyResult = {
    /**
     * - Whether a record was created.
     */
    created: boolean;
    /**
     * - Whether a record was deleted.
     */
    deleted?: boolean;
    /**
     * - Applied record or null.
     */
    record: import("../database/record/index.js").default | null;
};
export type FrontendModelResolvedResourceConfiguration = {
    /**
     * - Backend project owning the resource.
     */
    backendProject: import("../configuration-types.js").BackendProjectConfiguration;
    /**
     * - Frontend model name.
     */
    modelName: string;
    /**
     * - Resource class.
     */
    resourceClass: import("../configuration-types.js").FrontendModelResourceClassType;
    /**
     * - Normalized resource configuration.
     */
    resourceConfiguration: import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration;
};
export type FrontendModelResourcePayloadValue = import("../frontend-models/base.js").FrontendModelTransportValue | import("../database/record/index.js").default | Record<string, unknown> | Array<unknown>;
export type FrontendModelResourceAttributePayload = Record<string, FrontendModelResourcePayloadValue>;
export type FrontendModelResourceVirtualSetter = (arg1: import("../database/record/index.js").default, arg2: FrontendModelResourcePayloadValue) => (void | Promise<void>);
export type WritableAttributeReceiverClass = {
    /**
     * - Resolves aliases to canonical attribute names.
     */
    resolveAttributeName: (arg: string) => string | null;
    /**
     * - Locates a setter method on the receiver.
     */
    findMemberNameInsensitive: (arg1: Record<string, ReturnType<typeof JSON.parse>>, arg2: string) => string | null;
};
export type FrontendModelResourceSaveOptions = {
    /**
     * - Uploaded attachment attributes.
     */
    attachments?: FrontendModelResourceAttributePayload | null;
    /**
     * - Controller handling the mutation.
     */
    controller?: FrontendModelResourceController | null;
    /**
     * - Nested attributes payload.
     */
    nestedAttributes?: FrontendModelResourceAttributePayload | null;
};
export type FrontendModelResourceNestedEntry = FrontendModelResourceAttributePayload & {
    id?: string | number;
    _destroy?: boolean;
    attributes?: FrontendModelResourceAttributePayload;
    attachments?: FrontendModelResourceAttributePayload;
    nestedAttributes?: FrontendModelResourceAttributePayload;
};
/**
 * Backend or frontend model class bound to a frontend-model resource.
 * @typedef {import("../authorization/base-resource.js").AuthorizationResourceModelClass & {attachmentDefinitions: () => Record<string, import("../configuration-types.js").FrontendModelAttachmentConfiguration>, primaryKey: () => string}} FrontendModelResourceModelClass
 */
/**
 * Built-in frontend-model resource action.
 * @typedef {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} FrontendModelResourceAction
 */
/**
 * Frontend-model controller methods used by resources.
 * @typedef {import("../controller.js").default & {
 *   currentAbility: () => import("../authorization/ability.js").default | undefined,
 *   applyFrontendModelPagination: (args: {pagination: FrontendModelResourcePagination, query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>}) => void,
 *   applyFrontendModelSearch: (args: {query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>, search: FrontendModelResourceSearch}) => void,
 *   applyFrontendModelSort: (args: {query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>, sort: FrontendModelResourceSort}) => void,
 *   frontendModelAbilityAction: (action: FrontendModelResourceAction) => string,
 *   frontendModelAbilityAuthorizedQuery: (action: FrontendModelResourceAction) => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>,
 *   frontendModelAuthorizedQuery: (action: FrontendModelResourceAction) => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>,
 *   frontendModelIndexQuery: (options?: FrontendModelResourceIndexQueryOptions & {resource?: Pick<FrontendModelBaseResource<FrontendModelResourceModelClass>, "applyFrontendModelIndexPagination" | "applyFrontendModelIndexSearch" | "applyFrontendModelIndexSort">}) => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>,
 *   frontendModelParams: () => import("../configuration-types.js").VelociousParams,
 *   frontendModelPreload: () => import("../database/query/index.js").NestedPreloadRecord | null,
 *   frontendModelResourceConfigurationForModelClass: (modelClass: typeof import("../database/record/index.js").default) => FrontendModelResolvedResourceConfiguration | null,
 *   serializeFrontendModel: (model: import("../database/record/index.js").default) => Promise<Record<string, object | string | number | boolean | null>>
 * }} FrontendModelResourceController
 */
/**
 * Generic frontend-model index query passed to resource query hooks.
 * @typedef {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} FrontendModelResourceAnyQuery
 */
/**
 * Options for building a frontend-model resource index query.
 * @typedef {object} FrontendModelResourceIndexQueryOptions
 * @property {boolean} [includePagination] - Whether frontend-model pagination params should be applied.
 * @property {boolean} [includeSort] - Whether frontend-model sort params should be applied.
 */
/**
 * FrontendModelResourcePagination type.
 * @typedef {object} FrontendModelResourcePagination
 * @property {number | null} limit - Maximum number of records.
 * @property {number | null} offset - Number of records to skip.
 * @property {number | null} page - 1-based page number.
 * @property {number | null} perPage - Page size.
 */
/**
 * FrontendModelResourceSearch type.
 * @typedef {object} FrontendModelResourceSearch
 * @property {string} column - Column or attribute name.
 * @property {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq"} operator - Search operator.
 * @property {string[]} path - Relationship path.
 * @property {ReturnType<typeof JSON.parse>} value - Search value.
 */
/**
 * FrontendModelResourceSort type.
 * @typedef {object} FrontendModelResourceSort
 * @property {string} column - Attribute name to sort by.
 * @property {"asc" | "desc"} direction - Sort direction.
 * @property {string[]} path - Relationship path from root model.
 */
/**
 * FrontendModelResourceControllerArgs type.
 * @typedef {object} FrontendModelResourceControllerArgs
 * @property {FrontendModelResourceController} controller - Frontend-model controller instance.
 * @property {typeof import("../database/record/index.js").default} modelClass - Backing model class.
 * @property {string} modelName - Model name.
 * @property {import("../configuration-types.js").VelociousParams} params - Request params.
 * @property {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | import("../configuration-types.js").FrontendModelResourceConfiguration} resourceConfiguration - Normalized resource configuration (or raw input shape during early bootstrap).
 */
/**
 * FrontendModelResourceAbilityArgs type.
 * @template {FrontendModelResourceModelClass} [TModelClass=FrontendModelResourceModelClass]
 * @typedef {object} FrontendModelResourceAbilityArgs
 * @property {import("../authorization/ability.js").default} [ability] - Ability instance when the resource is used directly for authorization.
 * @property {import("../configuration.js").default} [configuration] - Velocious configuration for controller-less construction (for example the sync websocket channel); the controller path derives it from the controller instead.
 * @property {import("../configuration-types.js").VelociousLooseObject} [context] - Ability context.
 * @property {import("../configuration-types.js").VelociousLooseObject} [locals] - Ability locals.
 * @property {TModelClass} [modelClass] - Optional backing model class override.
 * @property {string} [modelName] - Optional model name override.
 * @property {import("../configuration-types.js").VelociousParams} [params] - Optional params override.
 * @property {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | import("../configuration-types.js").FrontendModelResourceConfiguration} [resourceConfiguration] - Optional normalized resource configuration.
 */
/**
 * Normalized sync replay mutation passed to the resource sync hooks.
 * @typedef {import("../sync/sync-envelope-replay-service.js").SyncReplayMutation} FrontendModelSyncMutation
 */
/**
 * Sync mutation authorization result.
 * @typedef {object} FrontendModelSyncAuthorization
 * @property {boolean} allowed - Whether the mutation may be applied.
 * @property {string} [reason] - Stable failure reason code when denied.
 */
/**
 * Arguments for the applySync full-escape-hatch hook.
 * @typedef {object} FrontendModelApplySyncArgs
 * @property {Record<string, ReturnType<typeof JSON.parse>>} context - Replay context.
 * @property {import("../database/record/index.js").default | null} existingSync - Existing sync row or null.
 * @property {FrontendModelSyncMutation} mutation - Normalized replay mutation.
 */
/**
 * Apply result produced by routed sync mutation application.
 * @typedef {object} FrontendModelSyncApplyResult
 * @property {boolean} created - Whether a record was created.
 * @property {boolean} [deleted] - Whether a record was deleted.
 * @property {import("../database/record/index.js").default | null} record - Applied record or null.
 */
/**
 * Resolved frontend-model resource registration.
 * @typedef {object} FrontendModelResolvedResourceConfiguration
 * @property {import("../configuration-types.js").BackendProjectConfiguration} backendProject - Backend project owning the resource.
 * @property {string} modelName - Frontend model name.
 * @property {import("../configuration-types.js").FrontendModelResourceClassType} resourceClass - Resource class.
 * @property {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} resourceConfiguration - Normalized resource configuration.
 */
/**
 * Transport-safe value accepted in frontend-model resource mutation payloads.
 * Nested object/array values are intentionally opaque because TypeScript rejects
 * recursive JSDoc typedefs for this transport payload contract.
 * @typedef {import("../frontend-models/base.js").FrontendModelTransportValue | import("../database/record/index.js").default | Record<string, unknown> | Array<unknown>} FrontendModelResourcePayloadValue
 */
/**
 * Attribute payload accepted by frontend-model resource mutations.
 * @typedef {Record<string, FrontendModelResourcePayloadValue>} FrontendModelResourceAttributePayload
 */
/**
 * Virtual setter method on a frontend-model resource.
 * @typedef {(arg1: import("../database/record/index.js").default, arg2: FrontendModelResourcePayloadValue) => (void | Promise<void>)} FrontendModelResourceVirtualSetter
 */
/**
 * Static helpers used when checking whether a model-like receiver accepts an attribute.
 * @typedef {object} WritableAttributeReceiverClass
 * @property {(arg: string) => string | null} resolveAttributeName - Resolves aliases to canonical attribute names.
 * @property {(arg1: Record<string, ReturnType<typeof JSON.parse>>, arg2: string) => string | null} findMemberNameInsensitive - Locates a setter method on the receiver.
 */
/**
 * Options passed while saving frontend-model resource mutations.
 * @typedef {object} FrontendModelResourceSaveOptions
 * @property {FrontendModelResourceAttributePayload | null} [attachments] - Uploaded attachment attributes.
 * @property {FrontendModelResourceController | null} [controller] - Controller handling the mutation.
 * @property {FrontendModelResourceAttributePayload | null} [nestedAttributes] - Nested attributes payload.
 */
/**
 * Normalized nested attributes entry.
 * @typedef {FrontendModelResourceAttributePayload & {id?: string | number, _destroy?: boolean, attributes?: FrontendModelResourceAttributePayload, attachments?: FrontendModelResourceAttributePayload, nestedAttributes?: FrontendModelResourceAttributePayload}} FrontendModelResourceNestedEntry
 */
/**
 * Base class for backend frontend-model resources.
 * @template {FrontendModelResourceModelClass} [TModelClass=typeof import("../database/record/index.js").default]
 * @template {typeof import("../database/record/index.js").default} [TDatabaseModelClass=Extract<TModelClass, typeof import("../database/record/index.js").default>]
 */
export default class FrontendModelBaseResource<TModelClass extends FrontendModelResourceModelClass = typeof import("../database/record/index.js").default, TDatabaseModelClass extends typeof import("../database/record/index.js").default = Extract<TModelClass, typeof import("../database/record/index.js").default>> extends AuthorizationBaseResource {
    controller: FrontendModelResourceController | undefined;
    configurationValue: import("../configuration.js").default | undefined;
    modelClassValue: TModelClass;
    modelNameValue: string | undefined;
    paramsValue: import("../configuration-types.js").VelociousParams | undefined;
    resourceConfigurationValue: import("../configuration-types.js").FrontendModelResourceConfiguration | import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | undefined;
    /** @type {FrontendModelBaseResource<TModelClass, TDatabaseModelClass> | null | undefined} */
    sharedResourceInstanceValue: FrontendModelBaseResource<TModelClass, TDatabaseModelClass> | null | undefined;
    /** @type {FrontendModelResourceModelClass | undefined} */
    static ModelClass: FrontendModelResourceModelClass | undefined;
    /** @type {Record<string, ReturnType<typeof JSON.parse>> | string[] | undefined} */
    static attributes: Record<string, ReturnType<typeof JSON.parse>> | string[] | undefined;
    /** @type {string[] | undefined} */
    static abilities: string[] | undefined;
    /** @type {Record<string, import("../configuration-types.js").FrontendModelAttachmentConfiguration> | undefined} */
    static attachments: Record<string, import("../configuration-types.js").FrontendModelAttachmentConfiguration> | undefined;
    /** @type {string[] | undefined} */
    static commands: string[] | undefined;
    /** @type {string[] | undefined} */
    static collectionCommands: string[] | undefined;
    /** @type {string[] | undefined} */
    static builtInCollectionCommands: string[] | undefined;
    /** @type {string[] | undefined} */
    static memberCommands: string[] | undefined;
    /** @type {string[] | undefined} */
    static builtInMemberCommands: string[] | undefined;
    /** @type {string[] | undefined} */
    static relationships: string[] | undefined;
    /** @type {string | undefined} */
    static modelName: string | undefined;
    /** @type {string | undefined} */
    static primaryKey: string | undefined;
    /** @type {import("../configuration-types.js").FrontendModelResourceServerConfiguration | undefined} */
    static server: import("../configuration-types.js").FrontendModelResourceServerConfiguration | undefined;
    /** @type {import("../configuration-types.js").FrontendModelResourceSyncConfiguration | boolean | undefined} */
    static sync: import("../configuration-types.js").FrontendModelResourceSyncConfiguration | boolean | undefined;
    /** @type {string[] | undefined} */
    static translatedAttributes: string[] | undefined;
    /** @type {ReturnType<typeof JSON.parse>} */
    static SharedResource: ReturnType<typeof JSON.parse>;
    /**
     * Declarative writable-attribute permit list (camelCase attribute names)
     * used as the default {@link FrontendModelBaseResource#permittedParams} and
     * as the routed sync replay permit. Resolved through the shared resource
     * like the other static resource config: an undeclared environment list
     * falls back to the shared resource's list, while an explicit declaration
     * (including `null`) wins.
     * @type {string[] | null | undefined} */
    static writableAttributes: string[] | null | undefined;
    /**
     * Runs constructor.
     * @param {FrontendModelResourceAbilityArgs<FrontendModelResourceModelClass> | FrontendModelResourceControllerArgs} args - Resource args.
     */
    constructor(args: FrontendModelResourceAbilityArgs<FrontendModelResourceModelClass> | FrontendModelResourceControllerArgs);
    /**
     * Returns the configured shared resource class.
     * @returns {ReturnType<typeof JSON.parse>} - Shared resource class.
     */
    static sharedResourceClass(): ReturnType<typeof JSON.parse>;
    /**
     * Reads a static resource config value from the environment resource first,
     * then from the shared resource.
     * @param {"abilities" | "attachments" | "attributes" | "builtInCollectionCommands" | "builtInMemberCommands" | "collectionCommands" | "commands" | "memberCommands" | "modelName" | "primaryKey" | "relationships" | "server" | "sync" | "translatedAttributes" | "writableAttributes"} name - Static config property name.
     * @returns {ReturnType<typeof JSON.parse>} - Resolved config value.
     */
    static sharedResourceStaticValue(name: "abilities" | "attachments" | "attributes" | "builtInCollectionCommands" | "builtInMemberCommands" | "collectionCommands" | "commands" | "memberCommands" | "modelName" | "primaryKey" | "relationships" | "server" | "sync" | "translatedAttributes" | "writableAttributes"): ReturnType<typeof JSON.parse>;
    /**
     * Resolves translated attributes from environment and shared resources.
     * @returns {string[] | undefined} - Translated attribute names.
     */
    static translatedAttributesConfig(): string[] | undefined;
    /**
     * Resolves frontend-safe attachment declarations from the backing model.
     * Resource-level declarations remain as a fallback for frontend-only resources.
     * @returns {Record<string, import("../configuration-types.js").FrontendModelAttachmentConfiguration>} - Client attachment configuration keyed by name.
     */
    static attachmentConfigurations(): Record<string, import("../configuration-types.js").FrontendModelAttachmentConfiguration>;
    /**
     * Builds a resource instance for shared-resource fallback calls.
     * @returns {FrontendModelBaseResource<TModelClass, TDatabaseModelClass> | null} - Shared resource instance when configured.
     */
    sharedResourceInstance(): FrontendModelBaseResource<TModelClass, TDatabaseModelClass> | null;
    /**
     * Calls a shared-resource method only when the shared resource overrides the framework default.
     * @param {string} methodName - Method name to resolve.
     * @param {unknown[]} args - Method args.
     * @returns {{called: boolean, result: unknown}} - Shared method call result.
     */
    callSharedResourceMethod(methodName: string, args: unknown[]): {
        called: boolean;
        result: unknown;
    };
    /**
     * Runs shared method result or a fallback callback.
     * @template Result
     * @param {string} methodName - Shared method name.
     * @param {unknown[]} args - Shared method args.
     * @param {() => Result} fallback - Fallback callback.
     * @returns {Result} - Shared or fallback result.
     */
    sharedResourceMethodOr<Result>(methodName: string, args: unknown[], fallback: () => Result): Result;
    /**
     * Resolves a method on this resource or its shared fallback.
     * @param {string} methodName - Method name.
     * @returns {{method: (...methodArgs: unknown[]) => unknown, resource: FrontendModelBaseResource<TModelClass, TDatabaseModelClass>} | null} - Resolved method and receiver.
     */
    resourceMethod(methodName: string): {
        method: (...methodArgs: unknown[]) => unknown;
        resource: FrontendModelBaseResource<TModelClass, TDatabaseModelClass>;
    } | null;
    /**
     * Runs abilities.
     * @returns {void} - No return value.
     */
    abilities(): void;
    /**
     * Runs typed controller instance.
     * @returns {FrontendModelResourceController} - Controller instance with frontend-model helpers.
     */
    typedControllerInstance(): FrontendModelResourceController;
    /**
     * Runs resource config.
     * @returns {import("../configuration-types.js").FrontendModelResourceConfiguration} - Static resource config (raw user input shape; consumers normalize).
     */
    static resourceConfig(): import("../configuration-types.js").FrontendModelResourceConfiguration;
    /**
     * Runs controller instance.
     * @returns {import("../controller.js").default} - Controller instance.
     */
    controllerInstance(): import("../controller.js").default;
    /**
     * Returns the Velocious configuration: the controller's when the resource
     * serves a controller request, otherwise the constructor-injected
     * configuration (for example a sync websocket channel's resource).
     * @returns {import("../configuration.js").default} - Velocious configuration.
     */
    configuration(): import("../configuration.js").default;
    /**
     * Runs model class.
     * @returns {TModelClass} - Model class.
     */
    modelClass(): TModelClass;
    /**
     * Returns the database model class used by server-only resource operations.
     * @returns {TDatabaseModelClass} - Database model class.
     */
    databaseModelClass(): TDatabaseModelClass;
    /**
     * Runs required model class for authorization helpers.
     * @returns {TModelClass} - Backing model class.
     */
    requiredModelClass(): TModelClass;
    /**
     * Runs model name.
     * @returns {string} - Model name.
     */
    modelName(): string;
    /**
     * Runs params.
     * @returns {import("../configuration-types.js").VelociousParams} - Params.
     */
    params(): import("../configuration-types.js").VelociousParams;
    /**
     * Runs resource configuration.
     * @returns {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | import("../configuration-types.js").FrontendModelResourceConfiguration} - Resource config (normalized at runtime; raw during early bootstrap).
     */
    resourceConfiguration(): import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | import("../configuration-types.js").FrontendModelResourceConfiguration;
    /**
     * Returns a Rails-strong-params / api_maker-style permit spec declaring
     * which attributes and nested attributes are writable for the current
     * request. Submitting an attribute or nested-relationship key that is
     * not permitted raises an error and fails the write.
     *
     * The returned value is a flat array that mixes:
     *   - `"attributeName"` strings for plain attribute writes
     *   - `{<relationshipName>Attributes: [...]}` objects where the value
     *     is itself a permit spec for the nested relationship
     *
     * This matches Rails strong_params (`permit(:first_name, :last_name,
     * contact_attributes: [:email, details_attributes: [:detail]])`) and
     * the api_maker sister project. Include `"_destroy"` inside a nested
     * permit to allow `_destroy: true` entries for that relationship —
     * the model must also declare `acceptsNestedAttributesFor(name,
     * {allowDestroy: true})` for the destroy to be applied.
     *
     * Example:
     *
     *   class ProjectResource extends FrontendModelBaseResource {
     *     permittedParams(arg) {
     *       return [
     *         "name",
     *         "description",
     *         {tasksAttributes: ["id", "_destroy", "name",
     *           {subtasksAttributes: ["id", "_destroy", "name"]}
     *         ]}
     *       ]
     *     }
     *   }
     *
     * Default implementation returns the declared
     * {@link FrontendModelBaseResource.writableAttributes} permit list, or `[]`
     * — nothing permitted — without a declared list. Subclasses override to
     * customize; an explicit override always wins.
     * @param {{action?: "create" | "update", params?: Record<string, ReturnType<typeof JSON.parse>>, ability?: import("../authorization/ability.js").default, locals?: Record<string, ReturnType<typeof JSON.parse>>}} [arg] - Request context.
     * @returns {Array<string | Record<string, ReturnType<typeof JSON.parse>>>} - Permit spec.
     */
    permittedParams(arg?: {
        action?: "create" | "update";
        params?: Record<string, ReturnType<typeof JSON.parse>>;
        ability?: import("../authorization/ability.js").default;
        locals?: Record<string, ReturnType<typeof JSON.parse>>;
    }): Array<string | Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Resolves the declared writable-attribute permit list from the environment
     * resource first, then the shared resource — mirroring how the other
     * static resource config resolves. An explicit environment declaration
     * (including `null`) wins over the shared resource's list.
     * @returns {string[] | null} Declared permit list or null when undeclared.
     */
    declaredWritableAttributes(): string[] | null;
    /**
     * Builds the client-safe error thrown for a failed writable-attribute validation.
     * @param {string} message - Human-readable validation message.
     * @param {{cause?: Error, code: string}} details - Stable machine-readable code and optional cause.
     * @returns {Error} Client-safe error.
     */
    writableAttributeError(message: string, { cause, code }: {
        cause?: Error;
        code: string;
    }): Error;
    /**
     * Authorizes one routed sync replay mutation before it is applied.
     * Defaults to allowing every mutation; record-level authorization still
     * applies through {@link FrontendModelBaseResource#findSyncRecord} scoping
     * and the create membership check.
     * @param {object} args - Options.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.context - Replay context.
     * @param {FrontendModelSyncMutation} args.mutation - Normalized replay mutation.
     * @returns {FrontendModelSyncAuthorization | Promise<FrontendModelSyncAuthorization>} Authorization result.
     */
    authorizeSyncMutation({ context, mutation }: {
        context: Record<string, ReturnType<typeof JSON.parse>>;
        mutation: FrontendModelSyncMutation;
    }): FrontendModelSyncAuthorization | Promise<FrontendModelSyncAuthorization>;
    /**
     * Returns the per-sync failure reason reported when a routed sync mutation
     * fails record-level authorization. Defaults to null, which reports the
     * generic "access-denied" reason.
     * @param {object} args - Options.
     * @param {"create" | "destroy" | "update"} args.action - Denied action.
     * @param {FrontendModelSyncMutation} args.mutation - Normalized replay mutation.
     * @returns {string | null} Stable failure reason code or null for the generic default.
     */
    syncAuthorizationFailureReason({ action, mutation }: {
        action: "create" | "destroy" | "update";
        mutation: FrontendModelSyncMutation;
    }): string | null;
    /**
     * Finds the existing record targeted by a routed sync replay mutation.
     * Defaults to an `accessibleFor` lookup by primary key through the
     * resource's normalized ability action for update (or destroy for delete
     * mutations), falling back to an unscoped lookup without an ability.
     * @param {object} args - Options.
     * @param {import("../authorization/ability.js").default} [args.ability] - Ability override. Defaults to the resource ability.
     * @param {boolean} [args.forDelete] - Whether the lookup is for a delete mutation.
     * @param {FrontendModelSyncMutation} args.mutation - Normalized replay mutation.
     * @returns {Promise<import("../database/record/index.js").default | null>} Existing record or null.
     */
    findSyncRecord({ ability, forDelete, mutation }: {
        ability?: import("../authorization/ability.js").default;
        forDelete?: boolean;
        mutation: FrontendModelSyncMutation;
    }): Promise<import("../database/record/index.js").default | null>;
    /**
     * Maps a raw sync action to the resource's normalized ability action when
     * the resource configuration declares an abilities mapping, otherwise the
     * raw action name is used directly.
     * @param {"create" | "destroy" | "update"} action - Raw sync action.
     * @returns {string} Ability action.
     */
    syncAbilityAction(action: "create" | "destroy" | "update"): string;
    /**
     * Full escape hatch for routed sync mutation application. Returning a
     * non-null result replaces the whole default apply flow (authorization,
     * record lookup, normalization and save) with the returned apply result.
     * @param {FrontendModelApplySyncArgs} args - Apply args.
     * @returns {FrontendModelSyncApplyResult | null | Promise<FrontendModelSyncApplyResult | null>} Apply result or null for the default flow.
     */
    applySync(args: FrontendModelApplySyncArgs): FrontendModelSyncApplyResult | null | Promise<FrontendModelSyncApplyResult | null>;
    /**
     * Runs after a routed sync mutation was applied. Returned entries are
     * merged into the apply result, reaching persistExtraAttributes and
     * broadcasts.
     * @param {object} args - Options.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.context - Replay context.
     * @param {boolean} args.created - Whether the record was created.
     * @param {FrontendModelSyncMutation} args.mutation - Normalized replay mutation.
     * @param {import("../database/record/index.js").default | null} args.record - Applied record or null.
     * @returns {Record<string, ReturnType<typeof JSON.parse>> | Promise<Record<string, ReturnType<typeof JSON.parse>>>} Extra apply-result entries.
     */
    afterSyncApply({ context, created, mutation, record }: {
        context: Record<string, ReturnType<typeof JSON.parse>>;
        created: boolean;
        mutation: FrontendModelSyncMutation;
        record: import("../database/record/index.js").default | null;
    }): Record<string, ReturnType<typeof JSON.parse>> | Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Normalizes create attributes before permission filtering and saving.
     * @param {FrontendModelResourceAttributePayload} attributes - Incoming create attributes.
     * @param {FrontendModelResourceSaveOptions} options - Save options.
     * @returns {FrontendModelResourceAttributePayload | Promise<FrontendModelResourceAttributePayload>} - Normalized attributes.
     */
    normalizeCreateAttributes(attributes: FrontendModelResourceAttributePayload, options: FrontendModelResourceSaveOptions): FrontendModelResourceAttributePayload | Promise<FrontendModelResourceAttributePayload>;
    /**
     * Normalizes update attributes before permission filtering and saving.
     * @param {import("../database/record/index.js").default} model - Existing model.
     * @param {FrontendModelResourceAttributePayload} attributes - Incoming update attributes.
     * @param {FrontendModelResourceSaveOptions} options - Save options.
     * @returns {FrontendModelResourceAttributePayload | Promise<FrontendModelResourceAttributePayload>} - Normalized attributes.
     */
    normalizeUpdateAttributes(model: import("../database/record/index.js").default, attributes: FrontendModelResourceAttributePayload, options: FrontendModelResourceSaveOptions): FrontendModelResourceAttributePayload | Promise<FrontendModelResourceAttributePayload>;
    /**
     * Runs before create.
     * @param {import("../database/record/index.js").default} model - New model before assignment/save.
     * @param {FrontendModelResourceAttributePayload} attributes - Normalized create attributes.
     * @param {FrontendModelResourceSaveOptions} options - Save options.
     * @returns {void | Promise<void>} - Resolves when the hook finishes.
     */
    beforeCreate(model: import("../database/record/index.js").default, attributes: FrontendModelResourceAttributePayload, options: FrontendModelResourceSaveOptions): void | Promise<void>;
    /**
     * Runs after create.
     * @param {import("../database/record/index.js").default} model - Created model.
     * @param {FrontendModelResourceAttributePayload} attributes - Normalized create attributes.
     * @param {FrontendModelResourceSaveOptions} options - Save options.
     * @returns {void | Promise<void>} - Resolves when the hook finishes.
     */
    afterCreate(model: import("../database/record/index.js").default, attributes: FrontendModelResourceAttributePayload, options: FrontendModelResourceSaveOptions): void | Promise<void>;
    /**
     * Runs before update.
     * @param {import("../database/record/index.js").default} model - Existing model before assignment/save.
     * @param {FrontendModelResourceAttributePayload} attributes - Normalized update attributes.
     * @param {FrontendModelResourceSaveOptions} options - Save options.
     * @returns {void | Promise<void>} - Resolves when the hook finishes.
     */
    beforeUpdate(model: import("../database/record/index.js").default, attributes: FrontendModelResourceAttributePayload, options: FrontendModelResourceSaveOptions): void | Promise<void>;
    /**
     * Runs after update.
     * @param {import("../database/record/index.js").default} model - Updated model.
     * @param {FrontendModelResourceAttributePayload} attributes - Normalized update attributes.
     * @param {FrontendModelResourceSaveOptions} options - Save options.
     * @returns {void | Promise<void>} - Resolves when the hook finishes.
     */
    afterUpdate(model: import("../database/record/index.js").default, attributes: FrontendModelResourceAttributePayload, options: FrontendModelResourceSaveOptions): void | Promise<void>;
    /**
     * Runs before destroy.
     * @param {import("../database/record/index.js").default} model - Model before destroy.
     * @returns {void | Promise<void>} - Resolves when the hook finishes.
     */
    beforeDestroy(model: import("../database/record/index.js").default): void | Promise<void>;
    /**
     * Runs after destroy.
     * @param {import("../database/record/index.js").default} model - Destroyed model.
     * @returns {void | Promise<void>} - Resolves when the hook finishes.
     */
    afterDestroy(model: import("../database/record/index.js").default): void | Promise<void>;
    /**
     * Wraps create/update/destroy resource mutations.
     * @template Result
     * @param {object} args - Transaction args.
     * @param {"create" | "update" | "destroy"} args.action - Mutation action.
     * @param {import("../database/record/index.js").default} args.model - Mutated model.
     * @param {() => Promise<Result>} args.callback - Mutation callback.
     * @returns {Promise<Result>} - Callback result.
     */
    runMutationTransaction<Result>({ action, model, callback }: {
        action: "create" | "update" | "destroy";
        model: import("../database/record/index.js").default;
        callback: () => Promise<Result>;
    }): Promise<Result>;
    /**
     * Runs primary key.
     * @returns {string} - Primary key.
     */
    primaryKey(): string;
    /**
     * Runs authorized query.
     * @param {FrontendModelResourceAction} action - Ability action.
     * @returns {import("../database/query/model-class-query.js").default<TDatabaseModelClass>} - Authorized query.
     */
    authorizedQuery(action: FrontendModelResourceAction): import("../database/query/model-class-query.js").default<TDatabaseModelClass>;
    /**
     * Runs index query.
     * @param {FrontendModelResourceIndexQueryOptions} [options] - Query options.
     * @returns {import("../database/query/model-class-query.js").default<TDatabaseModelClass>} - Frontend-model index query.
     */
    indexQuery(options?: FrontendModelResourceIndexQueryOptions): import("../database/query/model-class-query.js").default<TDatabaseModelClass>;
    /**
     * Applies frontend-model index pagination.
     * @param {object} args - Pagination args.
     * @param {FrontendModelResourceController} args.controller - Controller handling the query.
     * @param {FrontendModelResourcePagination} args.pagination - Pagination params.
     * @param {FrontendModelResourceAnyQuery} args.query - Query instance.
     * @returns {void}
     */
    applyFrontendModelIndexPagination({ controller, pagination, query }: {
        controller: FrontendModelResourceController;
        pagination: FrontendModelResourcePagination;
        query: FrontendModelResourceAnyQuery;
    }): void;
    /**
     * Applies frontend-model index search.
     * @param {object} args - Search args.
     * @param {FrontendModelResourceController} args.controller - Controller handling the query.
     * @param {FrontendModelResourceAnyQuery} args.query - Query instance.
     * @param {FrontendModelResourceSearch} args.search - Search params.
     * @returns {void}
     */
    applyFrontendModelIndexSearch({ controller, query, search }: {
        controller: FrontendModelResourceController;
        query: FrontendModelResourceAnyQuery;
        search: FrontendModelResourceSearch;
    }): void;
    /**
     * Applies frontend-model index sort.
     * @param {object} args - Sort args.
     * @param {FrontendModelResourceController} args.controller - Controller handling the query.
     * @param {FrontendModelResourceAnyQuery} args.query - Query instance.
     * @param {FrontendModelResourceSort} args.sort - Sort params.
     * @returns {void}
     */
    applyFrontendModelIndexSort({ controller, query, sort }: {
        controller: FrontendModelResourceController;
        query: FrontendModelResourceAnyQuery;
        sort: FrontendModelResourceSort;
    }): void;
    /**
     * Runs supports pluck.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Action.
     * @returns {boolean | Promise<boolean>} - Whether pluck is supported.
     */
    supportsPluck(action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"): boolean | Promise<boolean>;
    /**
     * Runs supports count.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Action.
     * @returns {boolean | Promise<boolean>} - Whether count is supported.
     */
    supportsCount(action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"): boolean | Promise<boolean>;
    /**
     * Runs before action.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Action.
     * @returns {boolean | void | Promise<boolean | void>} - Continue processing unless false.
     */
    beforeAction(action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"): boolean | void | Promise<boolean | void>;
    /**
     * Runs records.
     * @returns {Promise<import("../database/record/index.js").default[]>} - Records for index action.
     */
    records(): Promise<import("../database/record/index.js").default[]>;
    /**
     * Runs index query options for count.
     * @returns {FrontendModelResourceIndexQueryOptions} - Index query options for count.
     */
    countIndexQueryOptions(): FrontendModelResourceIndexQueryOptions;
    /**
     * Runs count.
     * @returns {Promise<number>} - Records count for index action.
     */
    count(): Promise<number>;
    /**
     * Runs find.
     * @param {"find" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Action.
     * @param {string | number} id - Record id.
     * @returns {Promise<import("../database/record/index.js").default | null>} - Located model.
     */
    find(action: "find" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url", id: string | number): Promise<import("../database/record/index.js").default | null>;
    /**
     * Runs create.
     * @param {FrontendModelResourceAttributePayload} attributes - Create attributes.
     * @param {FrontendModelResourceSaveOptions} [options] - Save options.
     * @returns {Promise<import("../database/record/index.js").default>} - Created model.
     */
    create(attributes: FrontendModelResourceAttributePayload, options?: FrontendModelResourceSaveOptions): Promise<import("../database/record/index.js").default>;
    /**
     * Runs handle unauthorized created model.
     * @param {import("../database/record/index.js").default} model - Created model.
     * @returns {Promise<void>} - Cleanup after failed authorization.
     */
    handleUnauthorizedCreatedModel(model: import("../database/record/index.js").default): Promise<void>;
    /**
     * Runs update.
     * @param {import("../database/record/index.js").default} model - Existing model.
     * @param {FrontendModelResourceAttributePayload} attributes - Update attributes.
     * @param {FrontendModelResourceSaveOptions} [options] - Save options.
     * @returns {Promise<import("../database/record/index.js").default>} - Updated model.
     */
    update(model: import("../database/record/index.js").default, attributes: FrontendModelResourceAttributePayload, options?: FrontendModelResourceSaveOptions): Promise<import("../database/record/index.js").default>;
    /**
     * Saves a model and applies nested attributes in one transaction.
     * @param {{filtered: Record<string, ReturnType<typeof JSON.parse>>, model: import("../database/record/index.js").default, options: FrontendModelResourceSaveOptions, permit: {attributes: string[], nested: Record<string, ReturnType<typeof JSON.parse>>}}} args - Save arguments.
     * @returns {Promise<import("../database/record/index.js").default>} - Saved model.
     */
    _saveWithNestedAttributes({ filtered, model, options, permit }: {
        filtered: Record<string, ReturnType<typeof JSON.parse>>;
        model: import("../database/record/index.js").default;
        options: FrontendModelResourceSaveOptions;
        permit: {
            attributes: string[];
            nested: Record<string, ReturnType<typeof JSON.parse>>;
        };
    }): Promise<import("../database/record/index.js").default>;
    /**
     * Assigns attributes to a model, using virtual setters on the resource when available.
     * @param {import("../database/record/index.js").default} model - Model instance.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} attributes - Attributes to assign.
     * @returns {Promise<void>}
     */
    _assignWithVirtualSetters(model: import("../database/record/index.js").default, attributes: Record<string, ReturnType<typeof JSON.parse>>): Promise<void>;
    /**
     * Splits attachment-named attributes into the attachment payload while preserving legacy callers
     * that submitted attachments as normal frontend-model attributes.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} attributes - Incoming mutation attributes.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | null} attachments - Explicit attachment payload.
     * @returns {{attributes: Record<string, ReturnType<typeof JSON.parse>>, attachments: Record<string, ReturnType<typeof JSON.parse>> | null}} Attributes with attachment keys removed and merged attachment payload.
     */
    _extractAttachmentAttributes(attributes: Record<string, ReturnType<typeof JSON.parse>>, attachments: Record<string, ReturnType<typeof JSON.parse>> | null): {
        attributes: Record<string, ReturnType<typeof JSON.parse>>;
        attachments: Record<string, ReturnType<typeof JSON.parse>> | null;
    };
    /**
     * Queues attachment payloads on a model after validating permits and attachment definitions.
     * @param {import("../database/record/index.js").default} model - Model receiving attachments.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | null} attachments - Attachments keyed by attachment name.
     * @param {string[]} permittedAttributeNames - Attribute/attachment names permitted by the resource.
     * @returns {void}
     */
    _assignAttachments(model: import("../database/record/index.js").default, attachments: Record<string, ReturnType<typeof JSON.parse>> | null, permittedAttributeNames: string[]): void;
    /**
     * Sets a translated attribute on a model via the translations relationship.
     * @param {import("../database/record/index.js").default} model - Model instance.
     * @param {string} name - Attribute name.
     * @param {FrontendModelResourcePayloadValue} value - Attribute value.
     * @returns {Promise<void>}
     */
    _setTranslatedAttributeOnModel(model: import("../database/record/index.js").default, name: string, value: FrontendModelResourcePayloadValue): Promise<void>;
    /**
     * Runs destroy.
     * @param {import("../database/record/index.js").default} model - Existing model.
     * @returns {Promise<void>} - No return value.
     */
    destroy(model: import("../database/record/index.js").default): Promise<void>;
    /**
     * Runs serialize.
     * @param {import("../database/record/index.js").default} model - Model to serialize.
     * @param {"index" | "find" | "create" | "update"} [action] - Action.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Serialized model payload.
     */
    serialize(model: import("../database/record/index.js").default, action?: "index" | "find" | "create" | "update"): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Resolves common metadata for one nested-attributes relationship.
     * @param {object} args - Nested relationship inputs.
     * @param {import("../database/record/index.js").default} args.parent - Parent model instance.
     * @param {string} args.relationshipName - Relationship receiving nested attributes.
     * @param {FrontendModelResourcePayloadValue} args.rawEntries - Raw nested entries from the request payload.
     * @param {{attributes: string[], nested: Record<string, ReturnType<typeof JSON.parse>>}} args.childPermit - Parsed child permit.
     * @param {FrontendModelResourceController | null | undefined} args.controller - Controller instance for child resource lookup.
     * @returns {{ability: import("../authorization/ability.js").default | undefined, childResource: FrontendModelBaseResource, childResourceConfig: FrontendModelResolvedResourceConfiguration, childWritableAttributes: string[], destroyPermitted: boolean, entries: Array<FrontendModelResourceNestedEntry>, relationship: import("../database/record/relationships/base.js").default, targetModelClass: typeof import("../database/record/index.js").default}} Nested relationship context.
     */
    _nestedRelationshipContext({ parent, relationshipName, rawEntries, childPermit, controller }: {
        parent: import("../database/record/index.js").default;
        relationshipName: string;
        rawEntries: FrontendModelResourcePayloadValue;
        childPermit: {
            attributes: string[];
            nested: Record<string, ReturnType<typeof JSON.parse>>;
        };
        controller: FrontendModelResourceController | null | undefined;
    }): {
        ability: import("../authorization/ability.js").default | undefined;
        childResource: FrontendModelBaseResource;
        childResourceConfig: FrontendModelResolvedResourceConfiguration;
        childWritableAttributes: string[];
        destroyPermitted: boolean;
        entries: Array<FrontendModelResourceNestedEntry>;
        relationship: import("../database/record/relationships/base.js").default;
        targetModelClass: typeof import("../database/record/index.js").default;
    };
    /**
     * Normalizes nested entries for collection and singular relationships.
     * @param {object} args - Nested entries inputs.
     * @param {FrontendModelResourcePayloadValue} args.rawEntries - Raw nested entries value.
     * @param {string} args.relationshipName - Relationship name.
     * @param {string} args.relationshipType - Relationship type.
     * @returns {Array<FrontendModelResourceNestedEntry>} Normalized nested entry objects.
     */
    _nestedRelationshipEntries({ rawEntries, relationshipName, relationshipType }: {
        rawEntries: FrontendModelResourcePayloadValue;
        relationshipName: string;
        relationshipType: string;
    }): Array<FrontendModelResourceNestedEntry>;
    /**
     * Normalizes one nested entry from either internal transport shape
     * (`{attributes, attachments, nestedAttributes}`) or direct Rails-style
     * fields (`{name, file, commentsAttributes}`).
     * @param {object} args - Normalization inputs.
     * @param {{attributes: string[], nested: Record<string, ReturnType<typeof JSON.parse>>}} args.childPermit - Parsed child permit spec.
     * @param {FrontendModelResourceNestedEntry} args.entry - Raw nested entry.
     * @param {string} args.relationshipName - Relationship name for error messages.
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {FrontendModelResourceNestedEntry} Normalized nested entry.
     */
    _normalizeNestedRelationshipEntry({ childPermit, entry, relationshipName, targetModelClass }: {
        childPermit: {
            attributes: string[];
            nested: Record<string, ReturnType<typeof JSON.parse>>;
        };
        entry: FrontendModelResourceNestedEntry;
        relationshipName: string;
        targetModelClass: typeof import("../database/record/index.js").default;
    }): FrontendModelResourceNestedEntry;
    /**
     * Applies belongs-to nested attributes before the parent save so the parent FK can be set.
     * @param {import("../database/record/index.js").default} parent - Parent model instance.
     * @param {FrontendModelResourceAttributePayload} nestedAttributes - Nested-attribute payload keyed by relationship name.
     * @param {FrontendModelResourceController | null | undefined} controller - Controller instance for resource resolution and authorization.
     * @param {{attributes: string[], nested: Record<string, ReturnType<typeof JSON.parse>>} | null} [parentPermit] - Parsed parent permit spec.
     * @returns {Promise<void>}
     */
    _applyBelongsToNestedAttributes(parent: import("../database/record/index.js").default, nestedAttributes: FrontendModelResourceAttributePayload, controller: FrontendModelResourceController | null | undefined, parentPermit?: {
        attributes: string[];
        nested: Record<string, ReturnType<typeof JSON.parse>>;
    } | null): Promise<void>;
    /**
     * Applies a `nestedAttributes` payload to a freshly-saved parent model,
     * cascading create/update/destroy writes across the declared relationships.
     *
     * Each child is authorized against its own resource's abilities (never the
     * parent's). Destroys run before updates, updates before creates, to avoid
     * unique-constraint conflicts when replacing a child at the same natural key.
     *
     * Attribute filtering for nested children uses the parent resource's
     * permit spec for that relationship — api_maker-style. Policy options
     * (allowDestroy, limit, rejectIf) come from the MODEL's
     * `acceptedNestedAttributesFor(name)` declaration.
     * @param {import("../database/record/index.js").default} parent - Parent model instance.
     * @param {FrontendModelResourceAttributePayload} nestedAttributes - Nested-attribute payload keyed by relationship name.
     * @param {FrontendModelResourceController | null | undefined} controller - Controller instance for resource resolution and authorization.
     * @param {{attributes: string[], nested: Record<string, ReturnType<typeof JSON.parse>>} | null} [parentPermit] - Parsed parent permit spec.
     * @returns {Promise<void>}
     */
    _applyNestedAttributes(parent: import("../database/record/index.js").default, nestedAttributes: FrontendModelResourceAttributePayload, controller: FrontendModelResourceController | null | undefined, parentPermit?: {
        attributes: string[];
        nested: Record<string, ReturnType<typeof JSON.parse>>;
    } | null): Promise<void>;
    /**
     * Assigns one nested entry's attributes and attachments to a child model.
     * @param {object} args - Assignment inputs.
     * @param {import("../database/record/index.js").default} args.child - Child model receiving data.
     * @param {string[]} args.childWritableAttributes - Permitted child attribute and attachment names.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.entry - Nested entry payload.
     * @returns {Promise<void>}
     */
    _assignNestedEntryToChild({ child, childWritableAttributes, entry }: {
        child: import("../database/record/index.js").default;
        childWritableAttributes: string[];
        entry: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<void>;
    /**
     * Converts a relationship's foreign-key column/name to the target model's attribute name.
     * @param {import("../database/record/relationships/base.js").default} relationship - Relationship metadata.
     * @param {typeof import("../database/record/index.js").default} modelClass - Model class containing the FK.
     * @returns {string} Foreign-key attribute name.
     */
    _foreignKeyAttributeForModel(relationship: import("../database/record/relationships/base.js").default, modelClass: typeof import("../database/record/index.js").default): string;
    /**
     * Returns the FK attributes that bind a nested child to its parent.
     * @param {object} args - Parent-link inputs.
     * @param {import("../database/record/index.js").default} args.parent - Parent model instance.
     * @param {import("../database/record/relationships/base.js").default} args.relationship - Relationship metadata.
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {Record<string, string | number>} Attributes that scope the child to the parent.
     */
    _parentLinkAttributesForNestedChild({ parent, relationship, targetModelClass }: {
        parent: import("../database/record/index.js").default;
        relationship: import("../database/record/relationships/base.js").default;
        targetModelClass: typeof import("../database/record/index.js").default;
    }): Record<string, string | number>;
    /**
     * Converts a relationship's polymorphic type column/name to a child attribute name.
     * @param {import("../database/record/relationships/base.js").default} relationship - Relationship metadata.
     * @param {typeof import("../database/record/index.js").default} modelClass - Model class containing the type column.
     * @returns {string} Polymorphic type attribute name.
     */
    _polymorphicTypeAttributeForModel(relationship: import("../database/record/relationships/base.js").default, modelClass: typeof import("../database/record/index.js").default): string;
    /**
     * Finds an authorized nested record by id without parent scoping.
     * @param {object} args - Lookup inputs.
     * @param {import("../authorization/ability.js").default | undefined} args.ability - Current ability.
     * @param {"update" | "destroy"} args.action - Frontend action.
     * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.childResourceConfiguration - Child resource configuration.
     * @param {string | number} args.id - Child id from the payload.
     * @param {string} args.relationshipName - Parent's relationship name for error messages.
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {Promise<import("../database/record/index.js").default>} Authorized child model.
     */
    _findNestedRecord({ ability, action, childResourceConfiguration, id, relationshipName, targetModelClass }: {
        ability: import("../authorization/ability.js").default | undefined;
        action: "update" | "destroy";
        childResourceConfiguration: import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration;
        id: string | number;
        relationshipName: string;
        targetModelClass: typeof import("../database/record/index.js").default;
    }): Promise<import("../database/record/index.js").default>;
    /**
     * Resolves the ability action for a child resource using the child's own
     * `abilities` mapping — never the parent controller's. This preserves
     * custom mappings like `{update: "manage"}` and catches unmapped actions
     * instead of silently defaulting to the raw action name.
     * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} childResourceConfiguration - Child resource configuration.
     * @param {"create" | "update" | "destroy"} action - Frontend action.
     * @returns {string} - Ability action for the child resource.
     */
    _resolveChildAbilityAction(childResourceConfiguration: import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration, action: "create" | "update" | "destroy"): string;
    /**
     * Finds an existing child for a nested update/destroy, scoped to the
     * child's own model class, the parent's foreign key, AND the child
     * resource's ability mapping for the requested action. Throws when the
     * child does not exist, does not belong to the current parent, or is
     * not authorized — all of which must roll the transaction back.
     * @param {object} args - Arguments.
     * @param {import("../authorization/ability.js").default | undefined} args.ability - Current ability.
     * @param {"update" | "destroy"} args.action - Frontend action.
     * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.childResourceConfiguration - Child resource configuration.
     * @param {string | number} args.id - Child id from the payload.
     * @param {import("../database/record/index.js").default} args.parent - Parent model instance.
     * @param {Record<string, string | number>} args.parentLinkAttributes - Attributes that scope the child to the parent.
     * @param {string} args.relationshipName - Parent's relationship name (for error messages).
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {Promise<import("../database/record/index.js").default>} - Authorized, parent-linked child model.
     */
    _findScopedChild({ ability, action, childResourceConfiguration, id, parent, parentLinkAttributes, relationshipName, targetModelClass }: {
        ability: import("../authorization/ability.js").default | undefined;
        action: "update" | "destroy";
        childResourceConfiguration: import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration;
        id: string | number;
        parent: import("../database/record/index.js").default;
        parentLinkAttributes: Record<string, string | number>;
        relationshipName: string;
        targetModelClass: typeof import("../database/record/index.js").default;
    }): Promise<import("../database/record/index.js").default>;
    /**
     * Verifies an already-saved nested child is authorized under the child
     * resource's own `create` ability. Rolls back via thrown error when not
     * authorized so the outer transaction destroys the insert.
     * @param {object} args - Arguments.
     * @param {import("../authorization/ability.js").default | undefined} args.ability - Current ability.
     * @param {import("../database/record/index.js").default} args.child - Child model instance just created.
     * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.childResourceConfiguration - Child resource configuration.
     * @param {string} args.relationshipName - Parent's relationship name (for error messages).
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {Promise<void>}
     */
    _authorizeCreatedChild({ ability, child, childResourceConfiguration, relationshipName, targetModelClass }: {
        ability: import("../authorization/ability.js").default | undefined;
        child: import("../database/record/index.js").default;
        childResourceConfiguration: import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration;
        relationshipName: string;
        targetModelClass: typeof import("../database/record/index.js").default;
    }): Promise<void>;
    /**
     * After nested writes, preload every relationship declared in the
     * parent's permit so the post-save serialize step emits them and the
     * client can reconcile ids.
     * @param {import("../database/record/index.js").default} model - Saved parent model.
     * @param {{attributes: string[], nested: Record<string, ReturnType<typeof JSON.parse>>}} permit - Parsed parent permit.
     * @returns {Promise<void>}
     */
    _preloadNestedWritableRelationships(model: import("../database/record/index.js").default, permit: {
        attributes: string[];
        nested: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<void>;
}
//# sourceMappingURL=base-resource.d.ts.map